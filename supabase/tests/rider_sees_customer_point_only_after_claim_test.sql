-- TABA · EL REPARTIDOR VE EL PUNTO EXACTO DEL CLIENTE SÓLO DESPUÉS DE TOMAR LA ENTREGA
--
-- Lo afirmaba delivery_location_confirmation.local.sql (paso 4, «el Rider no ve el punto exacto antes de
-- tomar la entrega»), que nunca corrió en un gate: quedó en el mapa de TOOL-04 como prueba sin portar.
-- rider_multi_order_security_test.sql ya prueba que una OFERTA no deja leer la calle, el teléfono ni las
-- notas; esto prueba el punto (latitud y longitud que confirmó el cliente) por la COLA ABIERTA y por
-- private.rider_map_location_payload, la única función que lo arma para el repartidor:
--
--   A  antes de tomarla: la cola muestra el pedido con el barrio y sin calle ni coordenadas; pedir el
--      punto a la función no lo revela aunque esté guardado; la tabla no le muestra el pedido
--   B  después de tomarla: el que la tomó lee exactamente el punto confirmado (en la respuesta del
--      claim y en su entrega activa) y el pedido; otro repartidor del mismo comercio, no; y si al que
--      la tomó lo dan de baja a mitad de camino, deja de verlos
--   C  terminada la entrega, el que la tomó deja de ver el punto
--
-- Todo transaccional (rollback). Ids aleatorios: corre igual sobre la base del gate, que nunca está vacía.

begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

-- ── Fixture ────────────────────────────────────────────────────────────────
create temporary table rpt_ids (name text primary key, id uuid not null) on commit drop;
create temporary table rpt_actores (actor text primary key, claims text not null) on commit drop;

create function pg_temp.id(p_name text) returns uuid language sql stable as $$
  select id from rpt_ids where name = p_name
$$;

create function pg_temp.usuario(p_name text) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values (v_id,'authenticated','authenticated','rpt-' || left(v_id::text, 8) || '@example.invalid','',now(),'{}','{}',now(),now());
  insert into rpt_ids values (p_name, v_id);
  return v_id;
end $$;

-- Un comercio abierto con su ubicación para el mapa, el dueño y dos repartidores con sesión en la app.
do $$
declare
  v_business uuid := gen_random_uuid();
  v_member record;
begin
  perform pg_temp.usuario('owner');
  perform pg_temp.usuario('rider_a');
  perform pg_temp.usuario('rider_b');
  insert into public.businesses (
    id, name, slug, status, is_active, ordering_enabled, ordering_verified,
    ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled,
    delivery_enabled, delivery_fee, minimum_delivery_subtotal, order_intake_guard_mode, alcohol_sales_enabled
  ) values (
    v_business, 'TABA punto exacto', 'rpt-' || right(replace(v_business::text, '-', ''), 8), 'open', true, true, true,
    clock_timestamp(), pg_temp.id('owner'), 'ARS', true, false, 0.00, 0.00, 'off', false
  );
  insert into rpt_ids values ('business', v_business);
  insert into private.rider_map_business_locations (business_id, latitude, longitude, source, accuracy_m)
  values (v_business, -38.946062, -68.053321, 'qa_fixture', 20);
  for v_member in
    select * from (values ('owner', 'owner', 'panel_web'), ('rider_a', 'rider', 'rider_android'),
                          ('rider_b', 'rider', 'rider_android')) as t(k, role, client)
  loop
    insert into public.business_members (business_id, user_id, role, is_active)
    values (v_business, pg_temp.id(v_member.k), v_member.role, true);
    insert into public.identity_sessions(session_id, user_id, business_id, role_at_login, client)
    values (gen_random_uuid(), pg_temp.id(v_member.k), v_business, v_member.role, v_member.client);
    insert into rpt_actores
    select v_member.k, json_build_object('sub', s.user_id, 'role', 'authenticated', 'session_id', s.session_id)::text
      from public.identity_sessions s
     where s.user_id = pg_temp.id(v_member.k) and s.business_id = v_business;
  end loop;
end $$;

create function pg_temp.como(p_actor text) returns void language sql as $$
  select set_config('request.jwt.claims', (select claims from rpt_actores where actor = p_actor), true)::void
$$;
create function pg_temp.sin_sesion() returns void language sql as $$
  select set_config('request.jwt.claims', '', true)::void
$$;

-- Un delivery LISTO y sin repartidor, con el punto que confirmó el cliente (insertado directo: lo que se
-- prueba es quién lo lee, no la admisión). El disparador de alta guarda el punto para el mapa.
do $$
declare
  v_order uuid := gen_random_uuid();
  v_code text := 'RPT-' || upper(left(replace(v_order::text, '-', ''), 8));
begin
  insert into public.orders(
    id,business_id,code,public_code,status,fulfillment_type,delivery_mode,
    client_request_id,customer_user_id,customer_name,customer_neighborhood,
    customer_street_address,customer_phone,payment_method,subtotal,delivery_fee,total,
    delivery_code_required,ready_at,
    delivery_latitude,delivery_longitude,delivery_location_source,delivery_location_confirmed_at,
    delivery_address_source,delivery_geolocation_accuracy
  ) values (
    v_order, pg_temp.id('business'), v_code, v_code, 'ready', 'delivery', 'delivery',
    'rpt-' || left(v_order::text, 8), pg_temp.usuario('customer'), 'CLIENTE_SINTETICO_NO_CACHEAR', 'Centro',
    'Mendoza 851', '+5492996209136', 'cash', 1000, 0, 1000,
    true, clock_timestamp() - interval '2 minutes',
    -38.9539000, -68.0596000, 'map_pin', clock_timestamp() - interval '10 minutes',
    'gps', 12
  );
  insert into rpt_ids values ('order', v_order);
end $$;

create function pg_temp.punto(p_actor text) returns jsonb language plpgsql as $$
declare v_out jsonb;
begin
  perform pg_temp.como(p_actor);
  v_out := private.rider_map_location_payload(pg_temp.id('order'), true);
  perform pg_temp.sin_sesion();
  return v_out;
end $$;

-- Lo que la tabla le muestra (RLS) a un repartidor: cuántas filas de ese pedido ve.
create function pg_temp.filas_visibles(p_actor text) returns bigint language plpgsql as $$
declare
  v_order uuid := pg_temp.id('order');
  v_count bigint;
begin
  perform pg_temp.como(p_actor);
  set local role authenticated;
  select count(*) into v_count from public.orders o where o.id = v_order;
  reset role;
  perform pg_temp.sin_sesion();
  return v_count;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
--  A · antes de tomarla
-- ══════════════════════════════════════════════════════════════════════════
select is(
  (select customer_latitude from private.rider_map_order_location_snapshots where order_id = pg_temp.id('order')),
  -38.9539000::numeric,
  'A0 el punto confirmado está guardado para el mapa (lo que sigue es un permiso, no una ausencia)');

select pg_temp.como('rider_a');
create temporary table rpt_cola on commit drop as
  select q.*, to_jsonb(q) as fila from public.get_rider_queue(pg_temp.id('business')) q
   where q.order_id = pg_temp.id('order');
select pg_temp.sin_sesion();

select is((select count(*) from rpt_cola), 1::bigint, 'A1 la cola abierta le muestra el pedido listo al repartidor');
select is((select delivery_summary from rpt_cola), 'Centro', 'A2 la cola dice el barrio');
select ok((select customer_location is null from rpt_cola), 'A3 la cola no da el punto del cliente');
select ok((select fila::text !~ '(Mendoza 851|38\.9539|68\.0596|\+5492996209136)' from rpt_cola),
  'A4 ninguna columna de la cola trae la calle, el teléfono ni las coordenadas del cliente');
select ok(pg_temp.punto('rider_a') -> 'customer_location' = 'null'::jsonb,
  'A5 pedirle el punto a la función que arma el mapa no lo revela antes del claim');
select is((pg_temp.punto('rider_a') -> 'business_location' ->> 'latitude')::numeric, -38.946062::numeric,
  'A6 el mapa sí trae el punto del comercio');
select is(pg_temp.filas_visibles('rider_a'), 0::bigint, 'A7 leyendo la tabla directo, el repartidor no ve el pedido');

-- ══════════════════════════════════════════════════════════════════════════
--  B · después de tomarla
-- ══════════════════════════════════════════════════════════════════════════
select pg_temp.como('rider_a');
create temporary table rpt_claim on commit drop as
  select public.claim_delivery_order(pg_temp.id('business'),
           (select public_code from public.orders where id = pg_temp.id('order')),
           (select revision from public.orders where id = pg_temp.id('order')), 'rpt-claim-a') as r;
create temporary table rpt_activa on commit drop as select public.get_active_rider_delivery() as r;
select pg_temp.sin_sesion();

select is((select r ->> 'ok' from rpt_claim), 'true', 'B1 el repartidor A toma la entrega');
select is((select r -> 'order' -> 'customer_location' from rpt_claim),
  jsonb_build_object('latitude', -38.9539000, 'longitude', -68.0596000, 'source', 'gps', 'accuracy_m', 12),
  'B2 la respuesta del claim trae exactamente el punto que confirmó el cliente');
select is((select r -> 'customer_location' from rpt_activa), (select r -> 'order' -> 'customer_location' from rpt_claim),
  'B3 su entrega activa trae el mismo punto');
select is((select r ->> 'customer_street_address' from rpt_activa), 'Mendoza 851', 'B4 y la calle');
select is(pg_temp.filas_visibles('rider_a'), 1::bigint, 'B5 el que la tomó ve el pedido en la tabla');
select ok(pg_temp.punto('rider_b') -> 'customer_location' = 'null'::jsonb,
  'B6 otro repartidor del mismo comercio no ve el punto');
select is(pg_temp.filas_visibles('rider_b'), 0::bigint, 'B7 ni el pedido');

update public.business_members set is_active = false
 where business_id = pg_temp.id('business') and user_id = pg_temp.id('rider_a');
select ok(pg_temp.punto('rider_a') -> 'customer_location' = 'null'::jsonb,
  'B8 dado de baja a mitad de la entrega, el que la tomó deja de ver el punto');
select is(pg_temp.filas_visibles('rider_a'), 0::bigint, 'B9 y el pedido');
update public.business_members set is_active = true
 where business_id = pg_temp.id('business') and user_id = pg_temp.id('rider_a');

-- ══════════════════════════════════════════════════════════════════════════
--  C · terminada la entrega
-- ══════════════════════════════════════════════════════════════════════════
-- Cerrada a mano, sin el código de entrega (lo que se prueba es la lectura después del cierre, no el cierre).
update public.orders set delivery_code_required = false, status = 'delivered' where id = pg_temp.id('order');
select ok(pg_temp.punto('rider_a') -> 'customer_location' = 'null'::jsonb,
  'C1 entregado el pedido, el que lo llevó deja de ver el punto');

select * from finish();
rollback;
