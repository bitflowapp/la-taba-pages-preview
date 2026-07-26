-- TABA delivery handoff code.
-- The customer receives the code through the token-scoped tracking DTO. Riders
-- can only submit a candidate; they never receive the stored secret.

alter table public.orders
  add column if not exists delivery_code_required boolean;

update public.orders
   set delivery_code_required = false
 where delivery_code_required is null;

alter table public.orders
  alter column delivery_code_required set default true;

alter table public.orders
  alter column delivery_code_required set not null;

create table if not exists public.order_delivery_handoffs (
  order_id uuid primary key references public.orders(id) on delete cascade,
  code_hash text not null,
  code_ciphertext bytea not null,
  failed_attempts integer not null default 0 check (failed_attempts between 0 and 20),
  locked_until timestamptz,
  confirmed_at timestamptz,
  confirmed_by_user_id uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (expires_at > created_at)
);

alter table public.order_delivery_handoffs enable row level security;
revoke all privileges on table public.order_delivery_handoffs
from public, anon, authenticated;

create or replace function public.set_order_delivery_handoff_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public, extensions, pg_temp
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists order_delivery_handoffs_set_updated_at
on public.order_delivery_handoffs;
create trigger order_delivery_handoffs_set_updated_at
before update on public.order_delivery_handoffs
for each row execute function public.set_order_delivery_handoff_updated_at();

create or replace function public.issue_order_delivery_code(
  p_order_id uuid,
  p_tracking_token text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_token public.order_public_tokens%rowtype;
  v_handoff public.order_delivery_handoffs%rowtype;
  v_random bytea;
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if p_order_id is null
    or p_tracking_token is null
    or p_tracking_token !~ '^[A-Za-z0-9_-]{32,256}$' then
    raise exception 'credenciales de entrega invalidas' using errcode = '22023';
  end if;

  select o.*
    into v_order
    from public.orders o
   where o.id = p_order_id
     and o.customer_user_id = auth.uid()
   for update;

  if not found then
    raise exception 'pedido no encontrado o acceso denegado' using errcode = '42501';
  end if;
  if v_order.delivery_mode <> 'delivery' then
    raise exception 'codigo no requerido para retiro' using errcode = '22023';
  end if;
  if v_order.status in ('delivered', 'canceled', 'cancelled', 'rejected') then
    raise exception 'pedido terminal' using errcode = '55000';
  end if;

  select opt.*
    into v_token
    from public.order_public_tokens opt
   where opt.order_id = v_order.id
     and opt.token_hash = digest(p_tracking_token, 'sha256')
     and opt.revoked_at is null
     and opt.expires_at > clock_timestamp()
   limit 1;

  if not found then
    raise exception 'token de seguimiento invalido' using errcode = '42501';
  end if;

  select h.*
    into v_handoff
    from public.order_delivery_handoffs h
   where h.order_id = v_order.id
   for update;

  if found then
    if v_handoff.expires_at <= clock_timestamp() then
      raise exception 'codigo de entrega vencido' using errcode = '55000';
    end if;
    return jsonb_build_object(
      'delivery_code',
      pgp_sym_decrypt(v_handoff.code_ciphertext, p_tracking_token),
      'expires_at',
      v_handoff.expires_at
    );
  end if;

  v_random := gen_random_bytes(3);
  v_code := (
    1000 + (
      get_byte(v_random, 0)::bigint * 65536
      + get_byte(v_random, 1)::bigint * 256
      + get_byte(v_random, 2)::bigint
    ) % 9000
  )::text;

  insert into public.order_delivery_handoffs (
    order_id,
    code_hash,
    code_ciphertext,
    expires_at
  ) values (
    v_order.id,
    crypt(v_code, gen_salt('bf', 10)),
    pgp_sym_encrypt(v_code, p_tracking_token, 'cipher-algo=aes256,compress-algo=0'),
    least(v_token.expires_at, clock_timestamp() + interval '48 hours')
  )
  returning * into v_handoff;

  return jsonb_build_object(
    'delivery_code', v_code,
    'expires_at', v_handoff.expires_at
  );
end;
$$;

create or replace function public.prevent_unverified_delivery()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
begin
  if new.status = 'delivered'
    and old.status is distinct from 'delivered'
    and new.delivery_mode = 'delivery'
    and new.delivery_code_required
    and not exists (
      select 1
        from public.order_delivery_handoffs h
       where h.order_id = new.id
         and h.confirmed_at is not null
    ) then
    raise exception 'codigo de entrega no confirmado' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_require_verified_delivery_code on public.orders;
create trigger orders_require_verified_delivery_code
before update of status on public.orders
for each row execute function public.prevent_unverified_delivery();

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
  v_now timestamptz := clock_timestamp();
  v_attempts integer;
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
    or v_order.assigned_rider_user_id is distinct from auth.uid()
    or not public.has_business_role(v_order.business_id, array['rider']) then
    raise exception 'pedido no encontrado o acceso denegado' using errcode = '42501';
  end if;
  if v_order.status <> 'arrived'
    or lower(coalesce(p_expected_status, '')) <> 'arrived' then
    raise exception 'estado concurrente o invalido' using errcode = '40001';
  end if;

  select h.*
    into v_handoff
    from public.order_delivery_handoffs h
   where h.order_id = v_order.id
   for update;

  if not found or v_handoff.expires_at <= v_now then
    return jsonb_build_object('ok', false, 'code', 'CODE_UNAVAILABLE');
  end if;
  if v_handoff.confirmed_at is not null then
    return jsonb_build_object('ok', true, 'already_confirmed', true);
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
    update public.order_delivery_handoffs
       set failed_attempts = v_attempts,
           locked_until = case
             when v_attempts >= 5 then v_now + interval '5 minutes'
             else null
           end
     where order_id = v_order.id;
    return jsonb_build_object(
      'ok', false,
      'code', case when v_attempts >= 5 then 'LOCKED' else 'MISMATCH' end,
      'remaining_attempts', greatest(0, 5 - v_attempts)
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

  return jsonb_build_object(
    'ok', true,
    'public_code', v_order.public_code,
    'status', v_order.status,
    'confirmed_at', v_now
  );
end;
$$;

-- Effective public DTO with optional trusted ETA, fresh assigned-rider GPS and
-- a token-decrypted handoff code only when the rider has arrived.
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
   limit 1;

  if not found then return null; end if;

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

  if v_order.status in ('arrived', 'delivered') then
    begin
      select case
               when v_order.status = 'arrived' and h.confirmed_at is null
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

revoke all on function public.issue_order_delivery_code(uuid, text)
from public, anon, authenticated;
grant execute on function public.issue_order_delivery_code(uuid, text)
to authenticated;

revoke all on function public.confirm_order_delivery(uuid, text, text)
from public, anon, authenticated;
grant execute on function public.confirm_order_delivery(uuid, text, text)
to authenticated;

revoke all on function public.get_public_order_tracking(text)
from public, anon, authenticated;
grant execute on function public.get_public_order_tracking(text)
to anon, authenticated;

comment on table public.order_delivery_handoffs is
'Server-only bcrypt and token-encrypted delivery handoff secrets.';
comment on function public.confirm_order_delivery(uuid, text, text) is
'Assigned rider handoff confirmation with row lock, rate limit and atomic delivery.';
