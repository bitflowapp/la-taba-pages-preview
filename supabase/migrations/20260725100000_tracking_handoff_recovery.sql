-- TABA tracking handoff recovery and rollout hardening.
--
-- This migration keeps the public DTO as the only customer-facing GPS surface,
-- makes delivery confirmation retry-safe and issues handoff credentials in the
-- same transaction as the order reservation.

-- Authenticated customers may read their own order, but never the base GPS
-- table. Exact history is restricted to the business team and the currently
-- assigned rider while the delivery remains active.
drop policy if exists "production rider locations readable with order"
on public.rider_locations;

drop policy if exists "tracking rider locations readable by operators"
on public.rider_locations;

create policy "tracking rider locations readable by operators"
on public.rider_locations for select
to authenticated
using (
  source = 'gps'
  and exists (
    select 1
      from public.orders o
     where o.id = rider_locations.order_id
       and o.business_id = rider_locations.business_id
       and (
         public.has_business_role(
           o.business_id,
           array['owner', 'admin', 'staff']
         )
         or (
           public.has_business_role(o.business_id, array['rider'])
           and o.assigned_rider_user_id = auth.uid()
           and rider_locations.rider_user_id = auth.uid()
           and o.status in ('assigned', 'picked_up', 'on_the_way', 'arrived')
         )
       )
  )
);

revoke select on table public.rider_locations from anon;
grant select on table public.rider_locations to authenticated;

-- Business assignment needs a minimal directory, not direct access to Auth or
-- the complete membership table. Only an operational display name and the UUID
-- required by the assignment CAS leave this SECURITY DEFINER boundary.
create or replace function public.list_active_business_riders(p_business_id uuid)
returns table (
  rider_user_id uuid,
  display_name text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
begin
  if auth.uid() is null
    or p_business_id is null
    or not public.has_business_role(
      p_business_id,
      array['owner', 'admin', 'staff']
    ) then
    raise exception 'rol de negocio requerido' using errcode = '42501';
  end if;

  return query
  select
    bm.user_id,
    left(
      coalesce(
        nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''),
        nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
        'Rider ' || upper(right(bm.user_id::text, 8))
      ),
      80
    )
  from public.business_members bm
  left join auth.users u on u.id = bm.user_id
  where bm.business_id = p_business_id
    and bm.role = 'rider'
    and bm.is_active = true
  order by 2, bm.user_id
  limit 100;
end;
$$;

revoke all on function public.list_active_business_riders(uuid)
from public, anon, authenticated;
grant execute on function public.list_active_business_riders(uuid)
to authenticated;

-- A customer whose tab/session storage was lost can rotate both the bearer
-- token and the still-unconfirmed handoff code. No old raw token is stored.
create or replace function public.recover_order_tracking_access(
  p_order_id uuid,
  p_new_tracking_token text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_handoff public.order_delivery_handoffs%rowtype;
  v_random bytea;
  v_code text;
  v_token_expires_at timestamptz;
  v_code_expires_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if p_order_id is null
    or p_new_tracking_token is null
    or p_new_tracking_token !~ '^[A-Za-z0-9_-]{32,256}$' then
    raise exception 'credenciales de seguimiento invalidas' using errcode = '22023';
  end if;

  select o.*
    into v_order
    from public.orders o
   where o.id = p_order_id
     and o.customer_user_id = auth.uid()
     and o.delivery_mode = 'delivery'
     and o.status not in ('delivered', 'canceled', 'cancelled', 'rejected')
   for update;

  if not found then
    raise exception 'pedido no encontrado o acceso denegado' using errcode = '42501';
  end if;

  select h.*
    into v_handoff
    from public.order_delivery_handoffs h
   where h.order_id = v_order.id
   for update;

  if found and v_handoff.confirmed_at is not null then
    raise exception 'entrega ya confirmada' using errcode = '55000';
  end if;

  v_token_expires_at := clock_timestamp() + interval '30 days';
  v_code_expires_at := clock_timestamp() + interval '48 hours';

  v_random := gen_random_bytes(3);
  v_code := (
    1000 + (
      get_byte(v_random, 0)::bigint * 65536
      + get_byte(v_random, 1)::bigint * 256
      + get_byte(v_random, 2)::bigint
    ) % 9000
  )::text;

  update public.order_public_tokens
     set revoked_at = coalesce(revoked_at, clock_timestamp())
   where order_id = v_order.id
     and revoked_at is null;

  insert into public.order_public_tokens (
    order_id,
    token_hash,
    expires_at
  ) values (
    v_order.id,
    digest(p_new_tracking_token, 'sha256'),
    v_token_expires_at
  );

  -- A rotated digest has no operational value. Remove prior revoked digests for
  -- this order so repeated recovery does not create indefinite bearer history.
  delete from public.order_public_tokens
   where order_id = v_order.id
     and revoked_at is not null;

  insert into public.order_delivery_handoffs (
    order_id,
    code_hash,
    code_ciphertext,
    failed_attempts,
    locked_until,
    confirmed_at,
    confirmed_by_user_id,
    expires_at
  ) values (
    v_order.id,
    crypt(v_code, gen_salt('bf', 10)),
    pgp_sym_encrypt(v_code, p_new_tracking_token, 'cipher-algo=aes256,compress-algo=0'),
    0,
    null,
    null,
    null,
    least(v_token_expires_at, v_code_expires_at)
  )
  on conflict (order_id) do update
     set code_hash = excluded.code_hash,
         code_ciphertext = excluded.code_ciphertext,
         failed_attempts = 0,
         locked_until = null,
         confirmed_at = null,
         confirmed_by_user_id = null,
         expires_at = excluded.expires_at;

  update public.orders
     set delivery_code_required = true
   where id = v_order.id;

  insert into public.order_events (
    order_id,
    business_id,
    actor_user_id,
    actor_role,
    actor_type,
    actor_id,
    event_type,
    type,
    message,
    metadata,
    payload
  ) values (
    v_order.id,
    v_order.business_id,
    auth.uid(),
    'customer',
    'customer',
    auth.uid(),
    'order.tracking_access_recovered',
    'order.tracking_access_recovered',
    'Acceso de seguimiento recuperado por el cliente',
    jsonb_build_object('rotated_at', clock_timestamp()),
    jsonb_build_object('rotated_at', clock_timestamp())
  );

  return jsonb_build_object(
    'ok', true,
    'public_code', v_order.public_code,
    'delivery_code', v_code,
    'token_expires_at', v_token_expires_at,
    'code_expires_at', least(v_token_expires_at, v_code_expires_at)
  );
end;
$$;

revoke all on function public.recover_order_tracking_access(uuid, text)
from public, anon, authenticated;
grant execute on function public.recover_order_tracking_access(uuid, text)
to authenticated;

-- Retry-safe confirmation. A response lost after commit can be repeated by the
-- same assigned rider and reconciles as success without exposing the order row.
create or replace function public.confirm_order_delivery(
  p_order_id uuid,
  p_expected_status text,
  p_delivery_code text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_handoff public.order_delivery_handoffs%rowtype;
  v_code text := regexp_replace(coalesce(p_delivery_code, ''), '[^0-9]', '', 'g');
  v_now timestamptz;
  v_attempts integer;
  v_lock_minutes integer;
begin
  if auth.uid() is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if v_code !~ '^[0-9]{4}$' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_FORMAT');
  end if;

  select o.*
    into v_order
    from public.orders o
   where o.id = p_order_id
   for update;

  if not found
    or v_order.assigned_rider_user_id is distinct from auth.uid() then
    raise exception 'pedido no encontrado o acceso denegado' using errcode = '42501';
  end if;

  perform 1
    from public.business_members bm
   where bm.business_id = v_order.business_id
     and bm.user_id = auth.uid()
     and bm.role = 'rider'
     and bm.is_active = true
   for share;
  if not found then
    raise exception 'pedido no encontrado o acceso denegado' using errcode = '42501';
  end if;

  select h.*
    into v_handoff
    from public.order_delivery_handoffs h
   where h.order_id = v_order.id
   for update;

  -- Capture time only after both locks were acquired. A queued confirmation
  -- must not calculate throttles or timestamps from a stale pre-lock instant.
  v_now := clock_timestamp();

  if v_order.status = 'delivered'
    and found
    and v_handoff.confirmed_at is not null
    and v_handoff.confirmed_by_user_id = auth.uid() then
    return jsonb_build_object(
      'ok', true,
      'already_confirmed', true,
      'public_code', v_order.public_code,
      'status', v_order.status,
      'confirmed_at', v_handoff.confirmed_at
    );
  end if;

  if v_order.status <> 'arrived'
    or lower(coalesce(p_expected_status, '')) <> 'arrived' then
    raise exception 'estado concurrente o invalido' using errcode = '40001';
  end if;
  if not found or v_handoff.expires_at <= v_now then
    return jsonb_build_object('ok', false, 'code', 'CODE_UNAVAILABLE');
  end if;
  if v_handoff.confirmed_at is not null then
    return jsonb_build_object('ok', false, 'code', 'CODE_UNAVAILABLE');
  end if;
  if v_handoff.locked_until is not null and v_handoff.locked_until > v_now then
    return jsonb_build_object(
      'ok', false,
      'code', 'LOCKED',
      'locked_until', v_handoff.locked_until
    );
  end if;

  if crypt(v_code, v_handoff.code_hash) <> v_handoff.code_hash then
    v_attempts := least(20, v_handoff.failed_attempts + 1);
    v_lock_minutes := case
      when v_attempts < 5 then 0
      else least(1440, 5 * power(2, least(8, v_attempts - 5))::integer)
    end;
    update public.order_delivery_handoffs
       set failed_attempts = v_attempts,
           locked_until = case
             when v_lock_minutes > 0
               then v_now + make_interval(mins => v_lock_minutes)
             else null
           end
     where order_id = v_order.id;

    if v_lock_minutes > 0 then
      insert into public.order_events (
        order_id,
        business_id,
        actor_user_id,
        actor_role,
        actor_type,
        actor_id,
        event_type,
        type,
        message,
        metadata,
        payload
      ) values (
        v_order.id,
        v_order.business_id,
        auth.uid(),
        'rider',
        'rider',
        auth.uid(),
        'order.delivery_code_locked',
        'order.delivery_code_locked',
        'Código de entrega temporalmente bloqueado',
        jsonb_build_object(
          'failed_attempts', v_attempts,
          'locked_until', v_now + make_interval(mins => v_lock_minutes)
        ),
        jsonb_build_object(
          'failed_attempts', v_attempts,
          'locked_until', v_now + make_interval(mins => v_lock_minutes)
        )
      );
    end if;

    return jsonb_build_object(
      'ok', false,
      'code', case when v_lock_minutes > 0 then 'LOCKED' else 'MISMATCH' end,
      'remaining_attempts', greatest(0, 5 - v_attempts),
      'locked_until', case
        when v_lock_minutes > 0 then v_now + make_interval(mins => v_lock_minutes)
        else null
      end
    );
  end if;

  update public.order_delivery_handoffs
     set confirmed_at = v_now,
         confirmed_by_user_id = auth.uid(),
         failed_attempts = 0,
         locked_until = null
   where order_id = v_order.id;

  update public.orders
     set status = 'delivered',
         delivered_at = coalesce(delivered_at, v_now)
   where id = v_order.id
     and status = 'arrived'
  returning * into v_order;

  insert into public.order_events (
    order_id,
    business_id,
    actor_user_id,
    actor_role,
    actor_type,
    actor_id,
    event_type,
    type,
    message,
    metadata,
    payload
  ) values (
    v_order.id,
    v_order.business_id,
    auth.uid(),
    'rider',
    'rider',
    auth.uid(),
    'order.delivery_handoff_confirmed',
    'order.delivery_handoff_confirmed',
    'Entrega validada con código',
    jsonb_build_object('confirmed_at', v_now),
    jsonb_build_object('confirmed_at', v_now)
  );

  return jsonb_build_object(
    'ok', true,
    'public_code', v_order.public_code,
    'status', v_order.status,
    'confirmed_at', v_now
  );
end;
$$;

revoke all on function public.confirm_order_delivery(uuid, text, text)
from public, anon, authenticated;
grant execute on function public.confirm_order_delivery(uuid, text, text)
to authenticated;

-- Exact rider coordinates are operational transient data. Once an order
-- reaches a terminal state, public tracking no longer uses them and the exact
-- history is deleted; status timestamps and audit events remain available.
create or replace function public.purge_terminal_order_rider_locations()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
begin
  if new.status in ('delivered', 'canceled', 'cancelled', 'rejected')
    and old.status is distinct from new.status then
    delete from public.rider_locations
     where order_id = new.id;
  end if;
  return null;
end;
$$;

drop trigger if exists orders_purge_terminal_rider_locations
on public.orders;
create trigger orders_purge_terminal_rider_locations
after update of status on public.orders
for each row execute function public.purge_terminal_order_rider_locations();

revoke execute on function public.purge_terminal_order_rider_locations()
from public, anon, authenticated;

-- Preserve the proven reservation implementation as an internal core and put
-- handoff issuance around it. Both operations now commit or roll back together.
do $migration$
begin
  if to_regprocedure('public.create_order_with_items_core(jsonb)') is null then
    alter function public.create_order_with_items(jsonb)
      rename to create_order_with_items_core;
  end if;
end;
$migration$;

revoke all on function public.create_order_with_items_core(jsonb)
from public, anon, authenticated;

create or replace function public.create_order_with_items(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_result jsonb;
  v_handoff jsonb;
  v_order_id uuid;
  v_tracking_token text := nullif(payload ->> 'tracking_token', '');
  v_delivery_mode text;
  v_code_expires_at timestamptz;
begin
  v_result := public.create_order_with_items_core(payload);
  v_order_id := nullif(v_result ->> 'id', '')::uuid;
  v_delivery_mode := coalesce(
    nullif(v_result ->> 'delivery_mode', ''),
    nullif(payload ->> 'delivery_mode', '')
  );

  if v_delivery_mode = 'delivery' then
    v_handoff := public.issue_order_delivery_code(v_order_id, v_tracking_token);
    update public.order_delivery_handoffs
       set expires_at = least(
         expires_at,
         clock_timestamp() + interval '48 hours'
       )
     where order_id = v_order_id
     returning expires_at into v_code_expires_at;
    v_result := v_result || jsonb_build_object(
      'delivery_code', v_handoff ->> 'delivery_code',
      'delivery_code_expires_at', v_code_expires_at
    );
  end if;

  return v_result;
end;
$$;

revoke all on function public.create_order_with_items(jsonb)
from public, anon, authenticated;
grant execute on function public.create_order_with_items(jsonb)
to authenticated;

comment on function public.recover_order_tracking_access(uuid, text) is
'Authenticated customer rotation for a lost tracking bearer and unconfirmed handoff code.';
comment on function public.list_active_business_riders(uuid) is
'Minimal active-rider directory authorized for the business assignment surface.';
comment on function public.create_order_with_items(jsonb) is
'Atomic production order reservation plus delivery handoff issuance.';
