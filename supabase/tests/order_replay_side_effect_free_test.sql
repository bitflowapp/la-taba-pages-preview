-- TABA · REINTENTAR UN PEDIDO NO VUELVE A ESCRIBIRLO
--
-- El alta es idempotente por `client_request_id`. Para un pedido de RETIRO el
-- reintento devolvía el mismo pedido pero volvía a escribirlo: `updated_at` y la
-- revisión avanzaban, cuatro columnas que no entran en la huella de idempotencia
-- se podían reescribir, y el operador que tenía el pedido abierto recibía PT409.
-- Acá se prueba, para un retiro y para un envío, que un reintento:
--
--   · devuelve el mismo pedido;
--   · no mueve la revisión ni `updated_at`, ni cambia ninguna columna;
--   · no reescribe latitud, longitud, precisión ni origen aunque el reintento
--     traiga otros valores;
--   · no agrega eventos ni ítems, no toca el stock y no mueve la fecha del último
--     pedido del cliente;
--   · deja al operador aceptar con la revisión que había leído.
--
-- CÓMO SE HACE VISIBLE DENTRO DE UNA TRANSACCIÓN: `updated_at` se llena con now(),
-- que no avanza dentro de una transacción, así que una reescritura inmediata no
-- se notaría. Por eso, después de crear cada pedido, la suite atrasa una hora su
-- `updated_at` (con el trigger de `updated_at` desactivado sólo para ese UPDATE):
-- desde ahí cualquier UPDATE sobre el pedido cambia `updated_at` y la revisión.
-- La suite no depende de la hora en que corre. Todo termina en rollback.

begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

-- ── Fixture ────────────────────────────────────────────────────────────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('a9600000-0000-4000-8000-0000000000ff','authenticated','authenticated','reintento-owner@example.invalid','',now(),'{}','{}',now(),now());
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
values
  ('a9600000-0000-4000-8000-000000000001','authenticated','authenticated',null,'',null,'{}','{}',true,now(),now()),
  ('a9600000-0000-4000-8000-000000000002','authenticated','authenticated',null,'',null,'{}','{}',true,now(),now());

-- El guardián de admisión no es lo que se prueba acá.
insert into public.businesses (
  id, name, slug, status, is_active, ordering_enabled, ordering_verified,
  ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled,
  delivery_enabled, delivery_fee, minimum_delivery_subtotal, order_intake_guard_mode
) values (
  'b9600000-0000-4000-8000-0000000000a1', 'TABA reintento limpio', 'taba-reintento-limpio', 'open', true, true, true,
  clock_timestamp(), 'a9600000-0000-4000-8000-0000000000ff', 'ARS', true, true, 500.00, 0.00, 'off');
insert into public.business_members (business_id, user_id, role, is_active)
values ('b9600000-0000-4000-8000-0000000000a1', 'a9600000-0000-4000-8000-0000000000ff', 'owner', true);
insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
values ('e9600000-0000-4000-8000-0000000000a1', 'a9600000-0000-4000-8000-0000000000ff', 'b9600000-0000-4000-8000-0000000000a1', 'owner', 'panel_web');

insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
  variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
  stock,available,merchant_available,is_alcoholic,tags,is_verified,verified_at,verified_by,
  external_id,sku,catalog_origin,units_per_pack)
values ('c9600000-0000-4000-8000-000000000001','b9600000-0000-4000-8000-0000000000a1','Lata reintento','Gaseosas','Cola',1000,'confirmed',true,'Marca',
  'Lata','Lata',473,'ml','473 ml','lata',
  100,true,true,false,'{}',true,now(),'a9600000-0000-4000-8000-0000000000ff','reintento-sku','reintento-sku','commercial',1);

-- Los dos clientes tienen perfil: ahí vive la fecha de su último pedido.
insert into public.customers(id, name, phone)
values ('a9600000-0000-4000-8000-000000000001', 'Cliente Retiro', '2996209137'),
       ('a9600000-0000-4000-8000-000000000002', 'Cliente Envio', '2996209138');

-- Los dos envíos que hace la tienda. Mismo payload = mismo pedido.
create function pg_temp.retiro(p_extra jsonb default '{}'::jsonb) returns jsonb language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'a9600000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
  return public.create_order_with_items(jsonb_build_object(
    'business_id', 'b9600000-0000-4000-8000-0000000000a1',
    'client_request_id', 'reintento-retiro-0001',
    'tracking_token', md5('reintento-retiro') || md5('reintento-retiro-token'),
    'items', jsonb_build_array(jsonb_build_object('product_id', 'c9600000-0000-4000-8000-000000000001', 'quantity', 1)),
    'customer_name', 'Cliente Retiro',
    'customer_phone', '2996209137',
    'delivery_mode', 'pickup',
    'payment_method', 'cash') || p_extra);
end;
$$;
create function pg_temp.envio() returns jsonb language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'a9600000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
  return public.create_order_with_items(jsonb_build_object(
    'business_id', 'b9600000-0000-4000-8000-0000000000a1',
    'client_request_id', 'reintento-envio-0001',
    'tracking_token', md5('reintento-envio') || md5('reintento-envio-token'),
    'items', jsonb_build_array(jsonb_build_object('product_id', 'c9600000-0000-4000-8000-000000000001', 'quantity', 2)),
    'customer_name', 'Cliente Envio',
    'customer_phone', '2996209138',
    'delivery_mode', 'delivery',
    'payment_method', 'cash',
    'customer_street_address', 'Mendoza 850',
    'customer_neighborhood', 'Neuquen',
    'delivery_latitude', '-38.953900',
    'delivery_longitude', '-68.059600',
    'delivery_location_source', 'map_pin',
    -- Relativa al reloj y fija dentro de la transacción (now() no avanza): los
    -- reintentos mandan exactamente el mismo payload, corra cuando corra la suite.
    'delivery_location_confirmed_at',
      to_char((now() - interval '5 minutes') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
end;
$$;
-- La fila entera del pedido, para comparar sin elegir columnas.
create function pg_temp.fila(p_order uuid) returns jsonb language sql as $$
  select to_jsonb(o) from public.orders o where o.id = p_order;
$$;
-- Lo que rodea al pedido: eventos, ítems, stock y la fecha del último pedido del cliente.
create function pg_temp.entorno(p_order uuid) returns text language sql as $$
  select format('%s eventos, %s items, stock %s, ultimo pedido %s',
    (select count(*) from public.order_events e where e.order_id = p_order),
    (select count(*) from public.order_items i where i.order_id = p_order),
    (select stock from public.products where id = 'c9600000-0000-4000-8000-000000000001'),
    (select to_char(c.last_order_at at time zone 'utc', 'YYYY-MM-DD') from public.customers c
      join public.orders o on o.customer_user_id = c.id where o.id = p_order));
$$;

-- ══ 1 · EL ALTA NO CAMBIÓ ═══════════════════════════════════════════════════
create temporary table pedidos on commit drop as
select 'retiro'::text as tipo, (pg_temp.retiro() ->> 'id')::uuid as id
union all
select 'envio', (pg_temp.envio() ->> 'id')::uuid;

select is(
  (select format('%s rev %s origen %s sellado %s', o.status, o.revision, o.delivery_address_source, (o.delivery_snapshot_created_at is not null)::text)
     from public.orders o join pedidos p on p.id = o.id where p.tipo = 'retiro'),
  'received rev 3 origen manual sellado true',
  'un retiro nace como siempre: revision 3, origen manual, instantanea sellada');
select is(
  (select format('%s rev %s %s (%s, %s)', o.status, o.revision, o.delivery_address_formatted, o.delivery_latitude, o.delivery_longitude)
     from public.orders o join pedidos p on p.id = o.id where p.tipo = 'envio'),
  'received rev 3 Mendoza 850, Neuquen (-38.953900, -68.059600)',
  'un envio nace como siempre, con su direccion y su punto confirmado');
select is(
  (select count(*)::integer from public.customers c where c.last_order_at is not null
    and c.id in ('a9600000-0000-4000-8000-000000000001', 'a9600000-0000-4000-8000-000000000002')),
  2, 'el alta sigue anotando la fecha del ultimo pedido de cada cliente');

-- Pasa una hora (ver la nota del encabezado). `set constraints` descarga los
-- triggers diferidos del alta para poder tocar el trigger; después vuelven a diferirse.
select set_config('request.jwt.claims', '', true);
set constraints all immediate;
alter table public.orders disable trigger orders_set_updated_at;
update public.orders set updated_at = updated_at - interval '1 hour' where id in (select id from pedidos);
alter table public.orders enable trigger orders_set_updated_at;
set constraints all deferred;
update public.customers set last_order_at = '2020-01-01T00:00:00Z'
 where id in ('a9600000-0000-4000-8000-000000000001', 'a9600000-0000-4000-8000-000000000002');

create temporary table antes on commit drop as
select p.tipo, p.id, pg_temp.fila(p.id) as fila, pg_temp.entorno(p.id) as entorno from pedidos p;

select is((select (fila ->> 'revision')::bigint from antes where tipo = 'retiro'), 4::bigint,
  'punto de partida del retiro: revision 4, una hora despues');

-- ══ 2 · CINCO REINTENTOS IDÉNTICOS DE UN RETIRO ═════════════════════════════
select is(
  (select array_agg(distinct pg_temp.retiro() ->> 'id') from generate_series(1, 5)),
  array[(select id::text from antes where tipo = 'retiro')],
  'cinco reintentos del retiro devuelven el mismo pedido');
select is(
  (select array_agg(distinct pg_temp.retiro() ->> 'revision') from generate_series(1, 2)),
  array['4'], 'y la respuesta trae la revision que ya tenia');

select is(
  (select o.revision from public.orders o join antes a on a.id = o.id where a.tipo = 'retiro'),
  4::bigint, 'la revision del retiro no se movio');
select is(
  (select o.updated_at from public.orders o join antes a on a.id = o.id where a.tipo = 'retiro'),
  (select (fila ->> 'updated_at')::timestamptz from antes where tipo = 'retiro'),
  'updated_at tampoco');
select is(
  pg_temp.fila((select id from antes where tipo = 'retiro')),
  (select fila from antes where tipo = 'retiro'),
  'ninguna columna del pedido cambio');
select is(
  pg_temp.entorno((select id from antes where tipo = 'retiro')),
  (select entorno from antes where tipo = 'retiro'),
  'ni eventos, ni items, ni stock, ni la fecha del ultimo pedido del cliente');
select is(
  (select entorno from antes where tipo = 'retiro'),
  '1 eventos, 1 items, stock 97, ultimo pedido 2020-01-01',
  'el entorno es el esperado: un evento, un item, tres unidades vendidas');

-- ══ 3 · UN REINTENTO CON OTROS DATOS DE UBICACIÓN ═══════════════════════════
-- Estas cuatro claves no entran en la huella de idempotencia: el reintento se
-- acepta, pero no puede reescribir el pedido.
select is(
  pg_temp.retiro('{"delivery_latitude":"-38.951000","delivery_longitude":"-68.059000","delivery_geolocation_accuracy":"7.5","delivery_address_source":"gps"}'::jsonb) ->> 'id',
  (select id::text from antes where tipo = 'retiro'),
  'un reintento con otra latitud, longitud, precision y origen devuelve el mismo pedido');
select is(
  (select format('%s/%s/%s/%s', coalesce(o.delivery_latitude::text, 'null'), coalesce(o.delivery_longitude::text, 'null'),
      coalesce(o.delivery_geolocation_accuracy::text, 'null'), o.delivery_address_source)
     from public.orders o join antes a on a.id = o.id where a.tipo = 'retiro'),
  'null/null/null/manual', 'y no reescribe esas cuatro columnas');
select is(
  pg_temp.fila((select id from antes where tipo = 'retiro')),
  (select fila from antes where tipo = 'retiro'),
  'el pedido sigue identico, revision incluida');

-- ══ 4 · EL OPERADOR NO PIERDE SU REVISIÓN ═══════════════════════════════════
-- Devuelve el estado, o el error: una revision vieja es PT409.
create function pg_temp.aceptar(p_order uuid, p_revision bigint) returns text language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', 'a9600000-0000-4000-8000-0000000000ff', 'role', 'authenticated',
    'session_id', 'e9600000-0000-4000-8000-0000000000a1')::text, true);
  return public.transition_order(p_order, p_revision, 'accepted', 'reintento-acepta-0001') ->> 'status';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$f$;
select is(
  pg_temp.aceptar((select id from antes where tipo = 'retiro'), 4),
  'accepted', 'el operador acepta con la revision que habia leido antes de los reintentos');

create temporary table aceptado on commit drop as
select pg_temp.fila((select id from antes where tipo = 'retiro')) as fila;
select is(pg_temp.retiro() ->> 'status', 'accepted', 'un reintento despues de la aceptacion devuelve el pedido aceptado');
select is(
  pg_temp.fila((select id from antes where tipo = 'retiro')), (select fila from aceptado),
  'y tampoco lo vuelve a escribir');

-- ══ 5 · UN ENVÍO, IGUAL ═════════════════════════════════════════════════════
select is(
  (select array_agg(distinct pg_temp.envio() ->> 'id') from generate_series(1, 5)),
  array[(select id::text from antes where tipo = 'envio')],
  'cinco reintentos del envio devuelven el mismo pedido');
select is(
  (select o.revision from public.orders o join antes a on a.id = o.id where a.tipo = 'envio'),
  (select (fila ->> 'revision')::bigint from antes where tipo = 'envio'),
  'la revision del envio no se movio');
select is(
  (select o.updated_at from public.orders o join antes a on a.id = o.id where a.tipo = 'envio'),
  (select (fila ->> 'updated_at')::timestamptz from antes where tipo = 'envio'),
  'updated_at tampoco');
select is(
  pg_temp.fila((select id from antes where tipo = 'envio')),
  (select fila from antes where tipo = 'envio'),
  'ninguna columna del envio cambio');
select is(
  pg_temp.entorno((select id from antes where tipo = 'envio')),
  (select entorno from antes where tipo = 'envio'),
  'ni su entorno: la fecha del ultimo pedido del cliente no la mueve un reintento');

-- ══ 6 · NADA SE DUPLICÓ ═════════════════════════════════════════════════════
select is(
  (select count(*)::integer from public.orders where business_id = 'b9600000-0000-4000-8000-0000000000a1'),
  2, 'despues de trece reintentos sigue habiendo dos pedidos');

select * from finish();
rollback;
