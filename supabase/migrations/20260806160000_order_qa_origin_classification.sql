-- Separa la operación real de la operación QA en el propio pedido.
--
-- Medido el 2026-08-06 sobre la-taba-staging: ningún pedido llevaba marca de
-- origen. LT-0033, LT-0034 y LT-0035 (checkout Pro con productos "QA TEST
-- iPhone - compra de prueba" y "Bebida QA sintética Task 04") llegaban al Panel
-- indistinguibles de un pedido de un cliente real, y la cola del rider los
-- ofrecía para reparto. Un piloto no puede despachar una moto a una dirección
-- inventada porque alguien corrió un E2E.
--
-- La señal de clasificación no la aporta el navegador: sale del catálogo. Un
-- producto con catalog_origin en ('test_only', 'staging_only') es un fixture de
-- prueba deliberado (20260731230000). 'demo_fixture' NO alcanza: es el catálogo
-- de demostración comercial y marcarlo QA escondería pedidos legítimos.
--
-- La clasificación es de una sola dirección: production -> qa. Nada puede
-- volver un pedido QA a producción, así que un fixture nunca se lava.

alter table public.orders
  add column if not exists origin text not null default 'production';
alter table public.orders
  add column if not exists origin_reason text;
alter table public.orders
  add column if not exists origin_classified_at timestamptz;

alter table public.orders drop constraint if exists orders_origin_valid;
alter table public.orders add constraint orders_origin_valid check (
  origin in ('production', 'qa')
);

alter table public.orders drop constraint if exists orders_origin_reason_present;
alter table public.orders add constraint orders_origin_reason_present check (
  origin = 'production'
  or (origin_reason is not null and btrim(origin_reason) <> '' and origin_classified_at is not null)
);

alter table public.checkout_sessions
  add column if not exists origin text not null default 'production';
alter table public.checkout_sessions
  add column if not exists origin_reason text;

alter table public.checkout_sessions drop constraint if exists checkout_sessions_origin_valid;
alter table public.checkout_sessions add constraint checkout_sessions_origin_valid check (
  origin in ('production', 'qa')
);

create index if not exists orders_business_origin_status_idx
  on public.orders (business_id, origin, status);

-- ===== La revisión no se mueve por reclasificar =====
-- `revision` es el token de concurrencia optimista que sostienen el Panel y el
-- Rider. Reclasificar un pedido es metadata, no un cambio operativo: si lo
-- hiciera avanzar, el backfill invalidaría la vista que ya tiene en pantalla
-- quien esté operando, incluido el fixture protegido LT-0030 que está `arrived`
-- con rider asignado.
create or replace function public.bump_order_revision()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_masked public.orders%rowtype;
begin
  new.revision := old.revision;

  -- Sólo la reclasificación queda exenta. Cualquier update que además toque un
  -- campo operativo conserva la semántica original de avanzar la revisión.
  if (new.origin, new.origin_reason, new.origin_classified_at)
     is distinct from (old.origin, old.origin_reason, old.origin_classified_at) then
    v_masked := new;
    v_masked.origin := old.origin;
    v_masked.origin_reason := old.origin_reason;
    v_masked.origin_classified_at := old.origin_classified_at;
    v_masked.updated_at := old.updated_at;
    if not (v_masked is distinct from old) then
      return new;
    end if;
  end if;

  if new is distinct from old then
    new.revision := old.revision + 1;
  end if;
  return new;
end;
$$;

-- ===== Señal de fixture QA =====
create or replace function public.product_is_qa_fixture(p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
      from public.products p
     where p.id = p_product_id
       and p.catalog_origin in ('test_only', 'staging_only')
  );
$$;

create or replace function public.classify_order_qa_origin()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.product_uuid is null or not public.product_is_qa_fixture(new.product_uuid) then
    return null;
  end if;
  update public.orders o
     set origin = 'qa',
         origin_reason = coalesce(o.origin_reason, 'qa_fixture_product'),
         origin_classified_at = coalesce(o.origin_classified_at, clock_timestamp())
   where o.id = new.order_id
     and o.origin <> 'qa';
  return null;
end;
$$;

drop trigger if exists order_items_classify_qa_origin on public.order_items;
create trigger order_items_classify_qa_origin
after insert on public.order_items
for each row execute function public.classify_order_qa_origin();

create or replace function public.classify_checkout_session_qa_origin()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.product_id is null or not public.product_is_qa_fixture(new.product_id) then
    return null;
  end if;
  update public.checkout_sessions s
     set origin = 'qa',
         origin_reason = coalesce(s.origin_reason, 'qa_fixture_product')
   where s.id = new.checkout_session_id
     and s.origin <> 'qa';
  return null;
end;
$$;

drop trigger if exists checkout_session_items_classify_qa_origin on public.checkout_session_items;
create trigger checkout_session_items_classify_qa_origin
after insert on public.checkout_session_items
for each row execute function public.classify_checkout_session_qa_origin();

-- ===== Backfill con evidencia, sin borrar nada =====
-- Se conserva cada pedido, cada item y cada evento. Sólo se agrega la marca de
-- origen y un evento que deja registrado quién la puso y por qué.
with classified as (
  select
    o.id,
    case
      when exists (
        select 1
          from public.order_items oi
          join public.products p on p.id = oi.product_uuid
         where oi.order_id = o.id
           and p.catalog_origin in ('test_only', 'staging_only')
      ) then 'qa_fixture_product'
      when o.payment_method = 'qa_no_charge' then 'qa_no_charge_payment_method'
      when o.customer_name ~* '(^|\s)(qa|smoke)(\s|$)'
        or o.customer_name ilike 'TABA intake smoke%'
        or o.customer_name ilike '%QA Rider%'
        or o.customer_name ilike 'Demo Walter QA%'
        or o.customer_name ilike 'Cliente QA%'
        or o.customer_name ilike 'RIDER MAP DEVICE SMOKE%'
        then 'qa_synthetic_customer_identity'
      else null
    end as reason
  from public.orders o
)
update public.orders o
   set origin = 'qa',
       origin_reason = classified.reason,
       origin_classified_at = clock_timestamp()
  from classified
 where classified.id = o.id
   and classified.reason is not null
   and o.origin <> 'qa';

insert into public.order_events (order_id, business_id, actor_role, actor_type, event_type, type, message, metadata, payload)
select
  o.id,
  o.business_id,
  'system',
  'system',
  'order.origin_classified',
  'order.origin_classified',
  'Pedido clasificado como QA; se conserva como evidencia y queda fuera de la operación real.',
  jsonb_build_object('origin', o.origin, 'origin_reason', o.origin_reason, 'migration', '20260806160000'),
  jsonb_build_object('origin', o.origin, 'origin_reason', o.origin_reason, 'migration', '20260806160000')
from public.orders o
where o.origin = 'qa'
  and not exists (
    select 1 from public.order_events e
     where e.order_id = o.id and e.event_type = 'order.origin_classified'
  );

-- ===== Aislamiento del Rider =====
-- Un rider no puede recibir para reparto un pedido QA: la dirección es
-- inventada y el cobro no existe.
--
-- REPARACIÓN DE REPLAY (agregada después, sin cambiar el esquema resultante)
-- ------------------------------------------------------------------------
-- Las dos funciones de abajo AMPLÍAN su `returns table`. `create or replace`
-- no puede cambiar el tipo de retorno: sobre una base vacía esta migración
-- abortaba con «cannot change return type of existing function», y con ella
-- toda la cadena posterior. Se midió al intentar aplicar las migraciones desde
-- cero en una base local.
--
-- Se antepone el DROP y, después de crear, se restituyen los permisos que la
-- función traía de su migración original —el DROP se los lleva puestos—, para
-- que una base reconstruida desde cero termine idéntica a una que aplicó las
-- migraciones una por una. En una base que ya aplicó esta migración no cambia
-- nada: las migraciones no se vuelven a ejecutar.
drop function if exists public.get_rider_queue(uuid);

create or replace function public.get_rider_queue(p_business_id uuid)
returns table (
  order_id uuid,
  public_code text,
  business_name text,
  pickup_summary text,
  delivery_summary text,
  status text,
  revision bigint,
  collection_amount numeric,
  payment_method text,
  item_count integer,
  estimated_minutes integer,
  ready_at timestamptz,
  business_location jsonb,
  customer_location jsonb
)
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $$
begin
  perform public.rider_require_active_membership(p_business_id);

  return query
  select
    o.id,
    o.public_code,
    b.name,
    b.address,
    nullif(btrim(o.customer_neighborhood), ''),
    o.status,
    o.revision,
    case when o.payment_method = 'cash' then o.total else null end,
    o.payment_method,
    greatest(1, coalesce((
      select sum(oi.quantity)::integer
        from public.order_items oi
       where oi.order_id = o.id
    ), 0)),
    case
      when o.estimated_arrival_source in ('business', 'routing')
       and o.estimated_arrival_updated_at >= statement_timestamp() - interval '15 minutes'
       and o.estimated_arrival_updated_at <= statement_timestamp() + interval '30 seconds'
       and o.estimated_arrival_at > statement_timestamp()
      then greatest(1, ceil(extract(epoch from (o.estimated_arrival_at - statement_timestamp())) / 60.0))::integer
      else null
    end,
    o.ready_at,
    loc.payload->'business_location',
    null::jsonb
  from public.orders o
  join public.businesses b on b.id = o.business_id
  cross join lateral private.rider_map_location_payload(o.id, false) as loc(payload)
  where o.business_id = p_business_id
    and o.delivery_mode = 'delivery'
    and o.status = 'ready'
    and o.assigned_rider_user_id is null
    and o.origin = 'production'
  order by o.ready_at nulls last, o.created_at
  limit 50;
end;
$$;

revoke all on function public.get_rider_queue(uuid) from public, anon;
grant execute on function public.get_rider_queue(uuid) to authenticated;

drop function if exists public.list_available_rider_orders(uuid);

create or replace function public.list_available_rider_orders(p_business_id uuid)
returns table (
  public_code text,
  general_zone text,
  pickup_branch text,
  approximate_packages integer,
  payment_method text,
  collection_amount numeric,
  estimated_minutes integer,
  operational_restrictions text,
  revision bigint
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
    greatest(
      1,
      ceil(coalesce(sum(oi.quantity), 0)::numeric / 3.0)
    )::integer,
    o.payment_method,
    case when o.payment_method = 'cash' then o.total else null end,
    case
      when o.estimated_arrival_source in ('business', 'routing')
       and o.estimated_arrival_updated_at >= statement_timestamp() - interval '15 minutes'
       and o.estimated_arrival_updated_at <= statement_timestamp() + interval '30 seconds'
       and o.estimated_arrival_at > statement_timestamp()
      then greatest(
        1,
        ceil(extract(epoch from (o.estimated_arrival_at - statement_timestamp())) / 60.0)
      )::integer
      else null
    end,
    case
      when o.age_confirmation_policy is not null
        then 'Verificar mayoría de edad al entregar'
      else null
    end,
    o.revision
  from public.orders o
  join public.businesses b on b.id = o.business_id
  left join public.order_items oi on oi.order_id = o.id
  where o.business_id = p_business_id
    and public.has_business_role(p_business_id, array['rider'])
    and o.delivery_mode = 'delivery'
    and o.status = 'ready'
    and o.assigned_rider_user_id is null
    and o.origin = 'production'
  group by o.id, b.address
  order by o.ready_at nulls last, o.created_at
  limit 50
$$;

revoke all on function public.list_available_rider_orders(uuid) from public, anon;
grant execute on function public.list_available_rider_orders(uuid) to authenticated;

-- Un rider tampoco puede tomar por código un pedido QA que nunca vio en la cola.
create or replace function public.claim_available_rider_order(
  p_business_id uuid,
  p_public_code text,
  p_expected_revision bigint,
  p_expected_status text default 'ready',
  p_expected_rider_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_user_id uuid := auth.uid();
  v_expected_status text := public.normalize_order_status_vocabulary(p_expected_status);
begin
  if v_user_id is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if p_business_id is null
    or not public.has_business_role(p_business_id, array['rider']) then
    raise exception 'rol rider requerido para este negocio' using errcode = '42501';
  end if;
  if p_public_code is null or btrim(p_public_code) = '' then
    raise exception 'public_code requerido' using errcode = '22023';
  end if;
  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'expected_revision requerido' using errcode = '22023';
  end if;

  select o.*
    into v_order
    from public.orders o
   where o.business_id = p_business_id
     and o.public_code = btrim(p_public_code)
   for update;

  if not found then
    raise exception 'pedido inexistente' using errcode = 'P0002';
  end if;
  perform 1
    from public.business_members bm
   where bm.business_id = v_order.business_id
     and bm.user_id = v_user_id
     and bm.role = 'rider'
     and bm.is_active = true
   for share;
  if not found then
    raise exception 'rol rider requerido para este negocio' using errcode = '42501';
  end if;
  if v_order.delivery_mode <> 'delivery' then
    raise exception 'los pedidos con retiro no admiten rider' using errcode = '42501';
  end if;
  if v_order.origin <> 'production' then
    raise exception 'pedido de prueba: no se despacha en operacion real' using errcode = '42501';
  end if;

  -- A second tap from the same rider is a successful no-op, even when both
  -- taps carried the same old revision. A different rider never receives this
  -- exception path and is rejected below.
  if v_order.assigned_rider_user_id = v_user_id
    and v_order.status = 'assigned' then
    return public.rider_order_rpc_payload(v_order.id)
      || jsonb_build_object('idempotent_no_op', true);
  end if;

  if v_order.revision <> p_expected_revision then
    raise exception 'revision desactualizada: esperada %, actual %',
      p_expected_revision,
      v_order.revision
      using errcode = '40001';
  end if;
  if v_expected_status <> 'ready'
    or v_order.status <> v_expected_status
    or v_order.assigned_rider_user_id is distinct from p_expected_rider_user_id
    or v_order.assigned_rider_user_id is not null then
    raise exception 'conflicto de asignacion: estado, revision o rider esperado cambio'
      using errcode = '40001';
  end if;

  update public.orders
     set assigned_rider_user_id = v_user_id,
         status = 'assigned'
   where id = v_order.id
     and revision = p_expected_revision
     and status = 'ready'
     and assigned_rider_user_id is null;

  if not found then
    raise exception 'conflicto de asignacion: otro rider gano la carrera'
      using errcode = '40001';
  end if;

  insert into public.order_events (
    order_id, business_id, actor_user_id, actor_role, actor_type, actor_id,
    event_type, type, message, metadata, payload
  ) values (
    v_order.id,
    v_order.business_id,
    v_user_id,
    'rider',
    'rider',
    v_user_id,
    'order.rider_claimed',
    'order.rider_claimed',
    'Pedido tomado por un rider autenticado',
    jsonb_build_object(
      'previous_rider_user_id', v_order.assigned_rider_user_id,
      'next_rider_user_id', v_user_id,
      'expected_revision', p_expected_revision
    ),
    jsonb_build_object(
      'previous_rider_user_id', v_order.assigned_rider_user_id,
      'next_rider_user_id', v_user_id,
      'expected_revision', p_expected_revision
    )
  );

  return public.rider_order_rpc_payload(v_order.id)
    || jsonb_build_object('idempotent_no_op', false);
end;
$$;

revoke all on function public.product_is_qa_fixture(uuid) from public, anon;
grant execute on function public.product_is_qa_fixture(uuid) to authenticated, service_role;

comment on column public.orders.origin is
  'production = pedido operativo real; qa = fixture de prueba, se conserva como evidencia y nunca se despacha.';
comment on column public.orders.origin_reason is
  'Evidencia de por qué el pedido quedó clasificado como QA.';
comment on column public.checkout_sessions.origin is
  'Hereda al pedido: un checkout con fixtures QA no puede producir un pedido de operación real.';
comment on function public.product_is_qa_fixture(uuid) is
  'True para fixtures de prueba deliberados (catalog_origin test_only/staging_only).';
