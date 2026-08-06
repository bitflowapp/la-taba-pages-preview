-- ============================================================================
--  FIXTURE DE TEST — representa la migración SÓLO-REMOTA
--  20260804090000_rider_map_location_contracts
-- ============================================================================
--
--  Este archivo NO es una migración y no debe moverse a supabase/migrations/.
--  Vive acá para que el escenario de simulación de staging pueda reproducir el
--  estado real de `la-taba-staging`, donde la versión 20260804090000 está
--  ocupada por una migración que no existe en este repositorio.
--
--  Reconstruido en solo lectura desde staging el 2026-08-06 a partir de
--  information_schema, pg_constraint y pg_get_functiondef. Sin datos: las
--  tablas se crean vacías. Ninguna coordenada real se copia acá.
--
--  Ver: docs/migrations/remote-only/20260804090000_rider_map_location_contracts.README.sql
-- ============================================================================

create schema if not exists private;

create table if not exists private.rider_map_business_locations (
  business_id uuid not null,
  latitude numeric(9,6) not null,
  longitude numeric(9,6) not null,
  source text not null,
  accuracy_m numeric(10,2),
  updated_at timestamptz not null default statement_timestamp(),
  constraint rider_map_business_locations_pkey primary key (business_id),
  constraint rider_map_business_locations_business_id_fkey
    foreign key (business_id) references public.businesses(id) on delete cascade,
  constraint rider_map_business_locations_coords_check
    check (latitude >= -90 and latitude <= 90 and longitude >= -180 and longitude <= 180),
  constraint rider_map_business_locations_accuracy_check
    check (accuracy_m is null or accuracy_m >= 0),
  constraint rider_map_business_locations_source_check
    check (source = any (array['business_verified'::text, 'qa_fixture'::text]))
);

create table if not exists private.rider_map_order_location_snapshots (
  order_id uuid not null,
  business_latitude numeric(9,6),
  business_longitude numeric(9,6),
  business_source text,
  business_accuracy_m numeric(10,2),
  customer_latitude numeric(9,6),
  customer_longitude numeric(9,6),
  customer_source text,
  customer_accuracy_m numeric(10,2),
  created_at timestamptz not null default statement_timestamp(),
  constraint rider_map_order_location_snapshots_pkey primary key (order_id),
  constraint rider_map_order_location_snapshots_order_id_fkey
    foreign key (order_id) references public.orders(id) on delete cascade,
  constraint rider_map_order_location_snapshots_business_coords_check
    check ((business_latitude is null and business_longitude is null)
           or (business_latitude >= -90 and business_latitude <= 90
               and business_longitude >= -180 and business_longitude <= 180)),
  constraint rider_map_order_location_snapshots_customer_coords_check
    check ((customer_latitude is null and customer_longitude is null)
           or (customer_latitude >= -90 and customer_latitude <= 90
               and customer_longitude >= -180 and customer_longitude <= 180)),
  constraint rider_map_order_location_snapshots_accuracy_check
    check ((business_accuracy_m is null or business_accuracy_m >= 0)
           and (customer_accuracy_m is null or customer_accuracy_m >= 0)),
  constraint rider_map_order_location_snapshots_business_source_check
    check (business_source is null
           or business_source = any (array['business_verified'::text, 'qa_fixture'::text])),
  constraint rider_map_order_location_snapshots_customer_source_check
    check (customer_source is null
           or customer_source = any (array['manual'::text, 'gps'::text, 'geocoder'::text,
                                           'previous_order'::text, 'qa_fixture'::text]))
);

alter table private.rider_map_business_locations enable row level security;
alter table private.rider_map_order_location_snapshots enable row level security;

create or replace function private.capture_rider_map_order_location_snapshot()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'extensions', 'pg_temp'
as $function$
declare
  v_business private.rider_map_business_locations%rowtype;
begin
  select *
    into v_business
    from private.rider_map_business_locations
   where business_id = new.business_id;

  insert into private.rider_map_order_location_snapshots (
    order_id,
    business_latitude, business_longitude, business_source, business_accuracy_m,
    customer_latitude, customer_longitude, customer_source, customer_accuracy_m
  ) values (
    new.id,
    case when v_business.latitude between -90 and 90
              and v_business.longitude between -180 and 180
         then v_business.latitude end,
    case when v_business.latitude between -90 and 90
              and v_business.longitude between -180 and 180
         then v_business.longitude end,
    case when v_business.latitude between -90 and 90
              and v_business.longitude between -180 and 180
         then v_business.source end,
    case when v_business.latitude between -90 and 90
              and v_business.longitude between -180 and 180
         then v_business.accuracy_m end,
    case when new.delivery_latitude between -90 and 90
              and new.delivery_longitude between -180 and 180
         then new.delivery_latitude end,
    case when new.delivery_latitude between -90 and 90
              and new.delivery_longitude between -180 and 180
         then new.delivery_longitude end,
    case when new.delivery_latitude between -90 and 90
              and new.delivery_longitude between -180 and 180
         then nullif(new.delivery_address_source, '') end,
    case when new.delivery_latitude between -90 and 90
              and new.delivery_longitude between -180 and 180
         then new.delivery_geolocation_accuracy end
  )
  on conflict (order_id) do nothing;

  return new;
end;
$function$;

create or replace function private.rider_map_location_payload(p_order_id uuid, p_reveal_customer boolean)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'extensions', 'pg_temp'
as $function$
declare
  v_order public.orders%rowtype;
  v_snapshot private.rider_map_order_location_snapshots%rowtype;
  v_can_reveal_customer boolean := false;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    return jsonb_build_object('business_location', null, 'customer_location', null);
  end if;

  select * into v_snapshot
    from private.rider_map_order_location_snapshots
   where order_id = p_order_id;

  v_can_reveal_customer := coalesce(p_reveal_customer, false)
    and v_order.assigned_rider_user_id is not distinct from auth.uid()
    and v_order.status in ('assigned', 'picked_up', 'on_the_way', 'arrived')
    and exists (
      select 1 from public.business_members bm
       where bm.business_id = v_order.business_id
         and bm.user_id = auth.uid()
         and bm.role = 'rider'
         and bm.is_active = true
    );

  return jsonb_build_object(
    'business_location', case
      when v_snapshot.business_latitude between -90 and 90
       and v_snapshot.business_longitude between -180 and 180 then
        jsonb_strip_nulls(jsonb_build_object(
          'latitude', v_snapshot.business_latitude,
          'longitude', v_snapshot.business_longitude,
          'source', v_snapshot.business_source,
          'accuracy_m', v_snapshot.business_accuracy_m))
      else null end,
    'customer_location', case
      when v_can_reveal_customer
       and v_snapshot.customer_latitude between -90 and 90
       and v_snapshot.customer_longitude between -180 and 180 then
        jsonb_strip_nulls(jsonb_build_object(
          'latitude', v_snapshot.customer_latitude,
          'longitude', v_snapshot.customer_longitude,
          'source', v_snapshot.customer_source,
          'accuracy_m', v_snapshot.customer_accuracy_m))
      else null end
  );
end;
$function$;

drop trigger if exists rider_map_capture_order_location on public.orders;
create trigger rider_map_capture_order_location
  after insert on public.orders
  for each row
  execute function private.capture_rider_map_order_location_snapshot();

-- Registro del historial, tal como está en staging: la versión 20260804090000
-- queda ocupada por ESTA migración, no por business_operations_panel.
insert into supabase_migrations.schema_migrations (version, name)
values ('20260804090000', 'rider_map_location_contracts')
on conflict (version) do nothing;
