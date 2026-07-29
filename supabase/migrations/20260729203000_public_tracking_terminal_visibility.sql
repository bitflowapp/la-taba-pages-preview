-- Keep the final public tracking state observable for a short, read-only
-- window without weakening explicit security revocation.

alter table public.order_public_tokens
  add column if not exists terminal_visible_until timestamptz;

comment on column public.order_public_tokens.terminal_visible_until is
'Read-only public visibility deadline after a terminal order transition. Explicit revoked_at and expires_at always take precedence.';

-- Preserve an already-established terminal window on replay. This backfill
-- deliberately excludes revoked tokens: a security revocation is irreversible.
update public.order_public_tokens opt
   set terminal_visible_until = least(
     opt.expires_at,
     coalesce(
       o.delivered_at,
       o.cancelled_at,
       o.canceled_at,
       o.rejected_at,
       o.updated_at,
       clock_timestamp()
     ) + interval '30 minutes'
   )
  from public.orders o
 where opt.order_id = o.id
   and opt.revoked_at is null
   and opt.terminal_visible_until is null
   and o.status in ('delivered', 'canceled', 'cancelled', 'rejected');

-- Exact GPS data remains operational and transient. Terminal transitions purge
-- it immediately, while unrevoked tokens receive a bounded final-state window.
create or replace function public.purge_terminal_order_rider_locations()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_terminal_window constant interval := interval '30 minutes';
begin
  if new.status in ('delivered', 'canceled', 'cancelled', 'rejected')
    and old.status is distinct from new.status then
    delete from public.rider_locations
     where order_id = new.id;

    update public.order_public_tokens
       set terminal_visible_until = least(
         expires_at,
         clock_timestamp() + v_terminal_window
       )
     where order_id = new.id
       and revoked_at is null;
  end if;
  return null;
end;
$$;

revoke execute on function public.purge_terminal_order_rider_locations()
from public, anon, authenticated;

-- Public tracking remains token-scoped and minimized. Active orders use the
-- existing token expiry; terminal orders additionally require their bounded
-- visibility window. Explicit revoked_at denies access immediately in both.
create or replace function public.get_public_order_tracking(p_public_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_raw_token text := public.request_order_token();
  v_token_hash bytea := public.request_order_token_hash();
  v_order public.orders%rowtype;
  v_terminal_visible_until timestamptz;
  v_location jsonb;
  v_delivery_code text;
  v_code_confirmed_at timestamptz;
  v_reliable_eta boolean := false;
begin
  if v_token_hash is null or p_public_id is null or btrim(p_public_id) = '' then
    return null;
  end if;

  select o.*
    into v_order
    from public.orders o
    join public.order_public_tokens opt on opt.order_id = o.id
   where (o.id::text = btrim(p_public_id) or o.public_code = btrim(p_public_id))
     and opt.token_hash = v_token_hash
     and opt.revoked_at is null
     and opt.expires_at > clock_timestamp()
     and (
       o.status not in ('delivered', 'canceled', 'cancelled', 'rejected')
       or (
         opt.terminal_visible_until is not null
         and opt.terminal_visible_until > clock_timestamp()
       )
     )
   limit 1;

  if not found then return null; end if;

  select opt.terminal_visible_until
    into v_terminal_visible_until
    from public.order_public_tokens opt
   where opt.order_id = v_order.id
     and opt.token_hash = v_token_hash
   limit 1;

  v_reliable_eta :=
    v_order.status not in ('delivered', 'canceled', 'cancelled', 'rejected')
    and v_order.estimated_arrival_source in ('business', 'routing')
    and v_order.estimated_arrival_updated_at >= clock_timestamp() - interval '15 minutes'
    and v_order.estimated_arrival_updated_at <= clock_timestamp() + interval '30 seconds'
    and v_order.estimated_arrival_at > clock_timestamp();

  if v_order.status in ('picked_up', 'on_the_way', 'arrived')
    and v_order.delivery_mode = 'delivery'
    and v_order.assigned_rider_user_id is not null then
    select jsonb_build_object(
      'lat', round(rl.lat::numeric, 3),
      'lng', round(rl.lng::numeric, 3),
      'accuracy', greatest(100, ceil(rl.accuracy))::integer,
      'source', 'gps',
      'created_at', rl.created_at
    )
      into v_location
      from public.rider_locations rl
     where rl.order_id = v_order.id
       and rl.rider_user_id = v_order.assigned_rider_user_id
       and rl.source = 'gps'
       and rl.accuracy is not null
       and rl.accuracy between 0 and 250
       and rl.created_at >= clock_timestamp() - interval '3 minutes'
       and rl.created_at <= clock_timestamp() + interval '30 seconds'
     order by rl.created_at desc
     limit 1;
  end if;

  if v_order.status = 'arrived' then
    begin
      select case
               when h.confirmed_at is null
                 then pgp_sym_decrypt(h.code_ciphertext, v_raw_token)
               else null
             end,
             h.confirmed_at
        into v_delivery_code, v_code_confirmed_at
        from public.order_delivery_handoffs h
       where h.order_id = v_order.id
         and h.expires_at > clock_timestamp();
    exception when others then
      v_delivery_code := null;
      v_code_confirmed_at := null;
    end;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'public_code', v_order.public_code,
    'delivery_mode', v_order.delivery_mode,
    'status', v_order.status,
    'created_at', v_order.created_at,
    'updated_at', v_order.updated_at,
    'accepted_at', v_order.accepted_at,
    'preparing_at', v_order.preparing_at,
    'ready_at', v_order.ready_at,
    'dispatched_at', coalesce(v_order.dispatched_at, v_order.picked_up_at),
    'arrived_at', v_order.arrived_at,
    'delivered_at', v_order.delivered_at,
    'cancelled_at', coalesce(v_order.cancelled_at, v_order.canceled_at),
    'rejected_at', v_order.rejected_at,
    'is_delivered', v_order.status = 'delivered',
    'terminal_visible_until', case
      when v_order.status in ('delivered', 'canceled', 'cancelled', 'rejected')
        then v_terminal_visible_until
      else null
    end,
    'estimated_arrival_at', case when v_reliable_eta then v_order.estimated_arrival_at else null end,
    'estimated_arrival_source', case when v_reliable_eta then v_order.estimated_arrival_source else null end,
    'estimated_arrival_updated_at', case when v_reliable_eta then v_order.estimated_arrival_updated_at else null end,
    'estimated_minutes', case
      when v_reliable_eta then greatest(
        1,
        ceil(extract(epoch from (v_order.estimated_arrival_at - clock_timestamp())) / 60.0)
      )::integer
      else null
    end,
    'rider_location', v_location,
    'delivery_code', v_delivery_code,
    'delivery_code_confirmed_at', v_code_confirmed_at
  ));
end;
$$;

revoke all on function public.get_public_order_tracking(text)
from public, anon, authenticated;
grant execute on function public.get_public_order_tracking(text)
to anon, authenticated;

comment on function public.get_public_order_tracking(text) is
'Minimized token-scoped tracking DTO with immediate security revocation and a bounded read-only terminal visibility window.';
