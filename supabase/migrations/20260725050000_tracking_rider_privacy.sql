-- TABA public tracking and rider privacy boundary.
-- Apply only after 20260725030000_taba_production_orders.sql.

-- Public bearer tokens must never authorize SELECT on the base order tables.
-- Authenticated customers keep access to their own order; team members keep
-- their scoped operational access. Unassigned riders use the minimized RPC.
create or replace function public.can_access_order(target_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
  select exists (
    select 1
      from public.orders o
     where o.id = target_order_id
       and (
         (auth.uid() is not null and o.customer_user_id = auth.uid())
         or public.has_business_role(o.business_id, array['owner', 'admin', 'staff'])
         or (
           auth.uid() is not null
           and public.has_business_role(o.business_id, array['rider'])
           and o.delivery_mode = 'delivery'
           and o.assigned_rider_user_id = auth.uid()
           and o.status in ('assigned', 'picked_up', 'on_the_way', 'arrived')
         )
       )
  )
$$;

-- Token-authenticated tracking is a deliberately small JSON DTO. Coordinates
-- are rounded and included only during active delivery. No customer contact,
-- exact address, notes, internal user IDs, memberships, token data or history
-- are returned.
create or replace function public.get_public_order_tracking(p_public_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_token_hash bytea := public.request_order_token_hash();
  v_order public.orders%rowtype;
  v_location jsonb;
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
   limit 1;

  if not found then return null; end if;

  if v_order.status in ('picked_up', 'on_the_way', 'arrived') then
    select jsonb_build_object(
      'lat', round(rl.lat::numeric, 3),
      'lng', round(rl.lng::numeric, 3),
      'accuracy', greatest(100, ceil(coalesce(rl.accuracy, 100)))::integer,
      'source', 'gps',
      'created_at', rl.created_at
    )
      into v_location
      from public.rider_locations rl
     where rl.order_id = v_order.id
       and rl.source = 'gps'
     order by rl.created_at desc
     limit 1;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'public_code', v_order.public_code,
    'status', v_order.status,
    'created_at', v_order.created_at,
    'accepted_at', v_order.accepted_at,
    'preparing_at', v_order.preparing_at,
    'ready_at', v_order.ready_at,
    'dispatched_at', coalesce(v_order.dispatched_at, v_order.picked_up_at),
    'arrived_at', v_order.arrived_at,
    'delivered_at', v_order.delivered_at,
    'is_delivered', v_order.status = 'delivered',
    'estimated_minutes', case
      when v_order.status in ('delivered', 'canceled', 'cancelled', 'rejected') then 0
      else 25
    end,
    'rider_location', v_location
  ));
end;
$$;

create or replace function public.list_available_rider_orders(p_business_id uuid)
returns table (
  public_code text,
  general_zone text,
  pickup_branch text,
  approximate_packages integer,
  payment_method text,
  collection_amount numeric,
  estimated_minutes integer,
  operational_restrictions text
)
language sql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
  select
    o.public_code,
    nullif(btrim(o.customer_neighborhood), ''),
    b.address,
    greatest(1, ceil(count(oi.id)::numeric / 3.0))::integer,
    o.payment_method,
    case when o.payment_method = 'cash' then o.total else null end,
    25,
    null::text
  from public.orders o
  join public.businesses b on b.id = o.business_id
  left join public.order_items oi on oi.order_id = o.id
  where o.business_id = p_business_id
    and public.has_business_role(p_business_id, array['rider'])
    and o.delivery_mode = 'delivery'
    and o.status in ('ready', 'assigned')
    and o.assigned_rider_user_id is null
  group by o.id, b.address
  order by o.ready_at nulls last, o.created_at
  limit 50
$$;

create or replace function public.revoke_public_tracking(p_order_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
begin
  if not (
    exists (
      select 1 from public.orders o
       where o.id = p_order_id
         and o.customer_user_id = auth.uid()
    )
    or exists (
      select 1 from public.orders o
       where o.id = p_order_id
         and public.has_business_role(o.business_id, array['owner', 'admin', 'staff'])
    )
  ) then
    raise exception 'acceso denegado' using errcode = '42501';
  end if;

  update public.order_public_tokens
     set revoked_at = coalesce(revoked_at, clock_timestamp())
   where order_id = p_order_id
     and revoked_at is null;
  return found;
end;
$$;

revoke all on function public.get_public_order_tracking(text) from public;
grant execute on function public.get_public_order_tracking(text) to anon, authenticated;
revoke all on function public.list_available_rider_orders(uuid) from public, anon;
grant execute on function public.list_available_rider_orders(uuid) to authenticated;
revoke all on function public.revoke_public_tracking(uuid) from public, anon;
grant execute on function public.revoke_public_tracking(uuid) to authenticated;

comment on function public.get_public_order_tracking(text) is
  'Minimized public tracking DTO authorized by a hashed, revocable, expiring bearer token.';
comment on function public.list_available_rider_orders(uuid) is
  'Minimized queue for an authenticated rider before assignment; excludes customer PII and precise location.';
