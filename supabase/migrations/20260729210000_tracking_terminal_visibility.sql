-- TABA public tracking terminal visibility.
--
-- A delivery becomes operationally terminal immediately, but its token remains
-- read-only for a short final-state acknowledgement window. Manual revocation
-- remains the only security revocation mechanism and always wins.

alter table public.orders
  add column if not exists terminal_visible_until timestamptz;

create or replace function public.set_order_terminal_tracking_visibility()
returns trigger
language plpgsql
set search_path = pg_catalog, public, extensions, pg_temp
as $$
begin
  if new.status = 'delivered'
    and old.status is distinct from 'delivered' then
    -- This is intentionally based on the first successful transition. A retry
    -- of delivered must not turn a short acknowledgement window into a lease.
    new.terminal_visible_until := coalesce(
      old.terminal_visible_until,
      new.delivered_at + interval '30 minutes',
      clock_timestamp() + interval '30 minutes'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists orders_set_terminal_tracking_visibility on public.orders;
create trigger orders_set_terminal_tracking_visibility
before update of status on public.orders
for each row execute function public.set_order_terminal_tracking_visibility();

-- Effective token DTO. A terminal delivery remains visible only until the
-- bounded window expires. Cancelled and rejected orders remain fail-closed;
-- their public visibility contract is intentionally not expanded here.
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
  v_location jsonb;
  v_delivery_code text;
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
         o.status = 'delivered'
         and o.terminal_visible_until > clock_timestamp()
       )
     )
   limit 1;

  if not found then
    return null;
  end if;

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

  -- The handoff code is an arrived-only secret. Delivered DTOs do not read or
  -- expose it, even during the acknowledgement window.
  if v_order.status = 'arrived' then
    begin
      select pgp_sym_decrypt(h.code_ciphertext, v_raw_token)
        into v_delivery_code
        from public.order_delivery_handoffs h
       where h.order_id = v_order.id
         and h.confirmed_at is null
         and h.expires_at > clock_timestamp();
    exception when others then
      v_delivery_code := null;
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
    'terminal_visible_until', case
      when v_order.status = 'delivered' then v_order.terminal_visible_until
      else null
    end,
    'is_delivered', v_order.status = 'delivered',
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
    'delivery_code', v_delivery_code
  ));
end;
$$;

revoke execute on function public.set_order_terminal_tracking_visibility()
from public, anon, authenticated;

revoke all on function public.get_public_order_tracking(text)
from public;
grant execute on function public.get_public_order_tracking(text)
to anon, authenticated;

comment on column public.orders.terminal_visible_until is
  'Natural expiration for the bounded, read-only delivered tracking DTO; distinct from manual token revocation.';
comment on function public.get_public_order_tracking(text) is
  'Minimized token-scoped tracking DTO; delivered remains read-only for 30 minutes unless manually revoked.';
