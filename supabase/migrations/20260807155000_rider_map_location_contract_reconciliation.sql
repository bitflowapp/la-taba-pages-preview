-- ============================================================================
--  Reconciliación del contrato remote-only del mapa del Rider.
--  P0.2 del TABA2 Master Release Plan (sha256 d756fdbf...), Fase D.
-- ============================================================================
--
--  QUÉ RESUELVE
--  ------------
--  Staging tiene registrada la versión 20260804090000 con el nombre
--  `rider_map_location_contracts`, aplicada desde el repositorio del Rider
--  (commit 898cea6d444e63adeed61f8079cead750036da0c). Este repositorio usa esa
--  MISMA versión para `business_operations_panel`, así que el número está
--  ocupado y la migración remota no puede reejecutarse ni renombrarse.
--
--  Consecuencia medida el 2026-08-08 sobre este árbol: ninguna migración de
--  este repositorio crea el schema `private` ni las tablas del mapa, y sin
--  embargo tres las consumen:
--
--    20260806160000_order_qa_origin_classification   (lee el payload)
--    20260807160000_checkout_pro_delivery_coordinates (documenta la dependencia)
--    20260807170000_pickup_point_provenance           (ALTER TABLE sobre ellas)
--
--  Una base creada sólo desde este repositorio aborta en 20260807170000. Esta
--  migración cierra ese hueco hacia adelante, sin tocar la historia remota.
--
--  POR QUÉ ESTA VERSIÓN
--  --------------------
--  20260807155000 ordena DESPUÉS de la última migración de Observabilidad
--  (20260807150000) y ANTES de las migraciones físicas que dependen del mapa
--  (20260807160000 y 20260807170000). El inventario global confirmó que el
--  número está libre.
--
--  QUÉ NO HACE
--  -----------
--  No redefine `public.get_rider_queue`. Esa función es propiedad de
--  20260806160000, que además trae la corrección de Observabilidad (drop previo
--  y revocación de EXECUTE a `anon`). Reescribirla acá revertiría ese arreglo.
--
--  No renombra, borra ni reejecuta 20260804090000_rider_map_location_contracts.
--  Esa fila del historial remoto se conserva tal cual.
--
--  CÓMO SE COMPORTA
--  ----------------
--  * Base limpia (nada del contrato presente): lo crea completo.
--  * Staging (contrato completo ya presente): valida y no toca nada.
--  * Estado parcial: aborta con excepción ANTES de mutar. Un contrato a medias
--    no se "completa" a ciegas, porque no se sabe qué lo dejó así.
-- ============================================================================

do $reconcile$
declare
  v_tables    int;
  v_functions int;
  v_triggers  int;
  v_present   int;
begin
  select count(*) into v_tables
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'private'
     and c.relkind = 'r'
     and c.relname in (
       'rider_map_business_locations',
       'rider_map_order_location_snapshots'
     );

  select count(*) into v_functions
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private'
     and p.proname in (
       'rider_map_location_payload',
       'capture_rider_map_order_location_snapshot'
     );

  select count(*) into v_triggers
    from pg_trigger t
   where not t.tgisinternal
     and t.tgname = 'rider_map_capture_order_location'
     and t.tgrelid = 'public.orders'::regclass;

  v_present := v_tables + v_functions + v_triggers;

  if v_present = 5 then
    raise notice
      'rider_map: contrato ya presente y completo; esta migracion es no-op.';
    return;
  end if;

  if v_present <> 0 then
    raise exception
      'rider_map: contrato PARCIAL (tablas=%, funciones=%, triggers=%). '
      'Se aborta antes de mutar: revisar el origen del estado incompleto.',
      v_tables, v_functions, v_triggers;
  end if;

  raise notice 'rider_map: contrato ausente; se crea desde cero.';

  -- -------------------------------------------------------------------------
  -- Esquema y tablas. Forma base, idéntica a la procedencia 898cea6d: las
  -- columnas de verificación humana del punto de retiro las agrega después
  -- 20260807170000, que es forward-only sobre esto.
  -- -------------------------------------------------------------------------
  execute $ddl_schema$
    create schema if not exists private;
  $ddl_schema$;

  execute $ddl_business$
    create table private.rider_map_business_locations (
      business_id uuid primary key references public.businesses(id) on delete cascade,
      latitude numeric(9, 6) not null,
      longitude numeric(9, 6) not null,
      source text not null,
      accuracy_m numeric(10, 2),
      updated_at timestamptz not null default statement_timestamp(),
      constraint rider_map_business_locations_coordinates_check check (
        latitude between -90 and 90
        and longitude between -180 and 180
      ),
      constraint rider_map_business_locations_source_check check (
        source in ('business_verified', 'qa_fixture')
      ),
      constraint rider_map_business_locations_accuracy_check check (
        accuracy_m is null or accuracy_m >= 0
      )
    );
  $ddl_business$;

  execute $ddl_snapshots$
    create table private.rider_map_order_location_snapshots (
      order_id uuid primary key references public.orders(id) on delete cascade,
      business_latitude numeric(9, 6),
      business_longitude numeric(9, 6),
      business_source text,
      business_accuracy_m numeric(10, 2),
      customer_latitude numeric(9, 6),
      customer_longitude numeric(9, 6),
      customer_source text,
      customer_accuracy_m numeric(10, 2),
      created_at timestamptz not null default statement_timestamp(),
      constraint rider_map_order_business_coordinates_pair check (
        (business_latitude is null and business_longitude is null)
        or (
          business_latitude between -90 and 90
          and business_longitude between -180 and 180
        )
      ),
      constraint rider_map_order_customer_coordinates_pair check (
        (customer_latitude is null and customer_longitude is null)
        or (
          customer_latitude between -90 and 90
          and customer_longitude between -180 and 180
        )
      ),
      constraint rider_map_order_location_source_check check (
        business_source is null
        or business_source in ('business_verified', 'qa_fixture')
      ),
      constraint rider_map_order_customer_source_check check (
        customer_source is null
        or customer_source in ('manual', 'gps', 'geocoder', 'previous_order', 'qa_fixture')
      ),
      constraint rider_map_order_accuracy_check check (
        (business_accuracy_m is null or business_accuracy_m >= 0)
        and (customer_accuracy_m is null or customer_accuracy_m >= 0)
      )
    );
  $ddl_snapshots$;

  -- Las coordenadas viven fuera de `public` y nadie las alcanza por PostgREST.
  execute $ddl_acl$
    alter table private.rider_map_business_locations enable row level security;
    alter table private.rider_map_order_location_snapshots enable row level security;
    revoke all on schema private from public, anon, authenticated;
    revoke all on table private.rider_map_business_locations from public, anon, authenticated;
    revoke all on table private.rider_map_order_location_snapshots from public, anon, authenticated;
  $ddl_acl$;

  -- -------------------------------------------------------------------------
  -- Captura inmutable por pedido, en el INSERT del pedido.
  -- -------------------------------------------------------------------------
  execute $ddl_capture$
    create or replace function private.capture_rider_map_order_location_snapshot()
    returns trigger
    language plpgsql
    security definer
    set search_path = pg_catalog, public, private, extensions, pg_temp
    as $snapshot$
    declare
      v_business private.rider_map_business_locations%rowtype;
    begin
      select *
        into v_business
        from private.rider_map_business_locations
       where business_id = new.business_id;

      insert into private.rider_map_order_location_snapshots (
        order_id,
        business_latitude,
        business_longitude,
        business_source,
        business_accuracy_m,
        customer_latitude,
        customer_longitude,
        customer_source,
        customer_accuracy_m
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
    $snapshot$;
  $ddl_capture$;

  execute $ddl_trigger$
    drop trigger if exists rider_map_capture_order_location on public.orders;
    create trigger rider_map_capture_order_location
    after insert on public.orders
    for each row execute function private.capture_rider_map_order_location_snapshot();
  $ddl_trigger$;

  -- -------------------------------------------------------------------------
  -- Lectura con privacidad: el punto del negocio es visible para la cola; el
  -- del cliente sólo para el rider asignado, activo y con membresía vigente.
  -- -------------------------------------------------------------------------
  execute $ddl_payload$
    create or replace function private.rider_map_location_payload(
      p_order_id uuid,
      p_reveal_customer boolean
    )
    returns jsonb
    language plpgsql
    stable
    security definer
    set search_path = pg_catalog, public, private, extensions, pg_temp
    as $payload$
    declare
      v_order public.orders%rowtype;
      v_snapshot private.rider_map_order_location_snapshots%rowtype;
      v_can_reveal_customer boolean := false;
    begin
      select * into v_order
        from public.orders
       where id = p_order_id;
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
          select 1
            from public.business_members bm
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
              'accuracy_m', v_snapshot.business_accuracy_m
            ))
          else null
        end,
        'customer_location', case
          when v_can_reveal_customer
           and v_snapshot.customer_latitude between -90 and 90
           and v_snapshot.customer_longitude between -180 and 180 then
            jsonb_strip_nulls(jsonb_build_object(
              'latitude', v_snapshot.customer_latitude,
              'longitude', v_snapshot.customer_longitude,
              'source', v_snapshot.customer_source,
              'accuracy_m', v_snapshot.customer_accuracy_m
            ))
          else null
        end
      );
    end;
    $payload$;
  $ddl_payload$;

  -- -------------------------------------------------------------------------
  -- Proyecciones del Rider con coordenadas.
  --
  -- Medido el 2026-08-08: las versiones vigentes en este repositorio
  -- (20260801040000 y 20260802100000) NO leen el mapa, mientras que las
  -- desplegadas en staging SÍ. Sin esto, una base creada desde cero pasaría el
  -- replay pero dejaría al Rider sin `business_location` ni `customer_location`,
  -- que es justo lo que el piloto tiene que demostrar. Se canonizan acá, dentro
  -- del mismo contrato remote-only del que provienen.
  -- -------------------------------------------------------------------------
  execute $ddl_rpc$
    create or replace function public.rider_order_rpc_payload(p_order_id uuid)
    returns jsonb
    language sql
    stable
    security definer
    set search_path = pg_catalog, public, private, extensions, pg_temp
    as $rpc$
      select jsonb_strip_nulls(
        jsonb_build_object(
          'id', o.id,
          'public_code', o.public_code,
          'status', o.status,
          'revision', o.revision,
          'delivery_mode', o.delivery_mode,
          'customer_name', o.customer_name,
          'customer_phone', o.customer_phone,
          'address_label', o.address_label,
          'customer_street_address', o.customer_street_address,
          'customer_neighborhood', o.customer_neighborhood,
          'customer_reference', o.customer_reference,
          'customer_notes', o.customer_notes,
          'payment_method', o.payment_method,
          'subtotal', o.subtotal,
          'delivery_fee', o.delivery_fee,
          'total', o.total,
          'currency_code', o.currency_code,
          'assigned_rider_user_id', o.assigned_rider_user_id,
          'age_confirmation_policy', o.age_confirmation_policy,
          'created_at', o.created_at,
          'updated_at', o.updated_at,
          'accepted_at', o.accepted_at,
          'preparing_at', o.preparing_at,
          'ready_at', o.ready_at,
          'dispatched_at', o.dispatched_at,
          'picked_up_at', o.picked_up_at,
          'arrived_at', o.arrived_at,
          'delivered_at', o.delivered_at,
          'cancelled_at', o.cancelled_at,
          'canceled_at', o.canceled_at,
          'rejected_at', o.rejected_at,
          'estimated_arrival_at', o.estimated_arrival_at,
          'estimated_arrival_source', o.estimated_arrival_source,
          'estimated_arrival_updated_at', o.estimated_arrival_updated_at,
          'business_name', b.name,
          'business_address', b.address,
          'business_location', loc.payload->'business_location',
          'customer_location', loc.payload->'customer_location',
          'order_items', coalesce(
            (
              select jsonb_agg(
                       jsonb_strip_nulls(jsonb_build_object(
                         'product_uuid', oi.product_uuid,
                         'product_id', oi.product_id,
                         'name', oi.name,
                         'quantity', oi.quantity,
                         'unit', oi.unit,
                         'unit_price', oi.unit_price
                       ))
                       order by oi.created_at, oi.id
                     )
                from public.order_items oi
               where oi.order_id = o.id
            ),
            '[]'::jsonb
          )
        )
      )
      from public.orders o
      join public.businesses b on b.id = o.business_id
      cross join lateral private.rider_map_location_payload(o.id, true) as loc(payload)
      where o.id = p_order_id
    $rpc$;
  $ddl_rpc$;

  execute $ddl_active$
    create or replace function public.rider_active_delivery_payload(p_order_id uuid)
    returns jsonb
    language sql
    stable
    security definer
    set search_path = pg_catalog, public, private, extensions, pg_temp
    as $active$
      select jsonb_strip_nulls(jsonb_build_object(
        'id', o.id,
        'public_code', o.public_code,
        'business_name', b.name,
        'business_address', b.address,
        'business_location', loc.payload->'business_location',
        'customer_location', loc.payload->'customer_location',
        'pickup_summary', b.address,
        'status', o.status,
        'revision', o.revision,
        'delivery_mode', o.delivery_mode,
        'address_label', o.address_label,
        'customer_street_address', o.customer_street_address,
        'customer_neighborhood', o.customer_neighborhood,
        'customer_reference', o.customer_reference,
        'customer_notes', o.customer_notes,
        'payment_method', o.payment_method,
        'subtotal', o.subtotal,
        'delivery_fee', o.delivery_fee,
        'total', o.total,
        'currency_code', o.currency_code,
        'picked_up_at', o.picked_up_at,
        'dispatched_at', o.dispatched_at,
        'arrived_at', o.arrived_at,
        'delivered_at', o.delivered_at,
        'updated_at', o.updated_at,
        'order_items', coalesce((
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'name', oi.name,
            'quantity', oi.quantity,
            'unit', oi.unit,
            'unit_price', oi.unit_price
          )) order by oi.created_at, oi.id)
          from public.order_items oi
          where oi.order_id = o.id
        ), '[]'::jsonb)
      ))
      from public.orders o
      join public.businesses b on b.id = o.business_id
      cross join lateral private.rider_map_location_payload(o.id, true) as loc(payload)
      where o.id = p_order_id
    $active$;
  $ddl_active$;

  -- Proyecciones internas: nadie las llama directamente por PostgREST.
  execute $ddl_grants$
    revoke all on function public.rider_active_delivery_payload(uuid) from public, anon, authenticated;
    revoke all on function public.rider_order_rpc_payload(uuid) from public, anon, authenticated;
  $ddl_grants$;

  execute $ddl_comments$
    comment on function private.rider_map_location_payload(uuid, boolean) is
      'Coordenadas por pedido; el punto del cliente sale sólo para el rider asignado y activo.';
    comment on function public.rider_order_rpc_payload(uuid) is
      'Proyección interna del pedido para el Rider; coordenadas exactas del cliente sólo al rider asignado.';
    comment on function public.rider_active_delivery_payload(uuid) is
      'Reparto activo del rider asignado, con coordenadas exactas condicionadas a membresía y asignación.';
  $ddl_comments$;
end
$reconcile$;
