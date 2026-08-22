-- TABA2 · UNA LECTURA DEL CLIENTE NO INVALIDA LA OFERTA DEL REPARTIDOR
--
-- El defecto que este archivo fija para siempre, medido en producción el
-- 2026-08-22 con el pedido LT-0002:
--
--   19:10:02  order.rider_offered              → expected_order_revision = 7
--   19:13:18  order.tracking_access_recovered  → orders.revision = 8
--   desde ahí «Aceptar» en el teléfono devolvía stale_revision, para siempre
--
-- El cliente había abierto su pantalla de seguimiento. Nada más. La aplicación
-- llamó a `recover_order_tracking_access` para emitirle un token —eso es
-- legítimo— y esa función hacía un `update public.orders set
-- delivery_code_required = true` SIN condición. Como `orders_set_updated_at`
-- mueve `updated_at` en cada UPDATE, el trigger de revisión veía la fila
-- distinta y la subía aunque el valor escrito ya fuera el que estaba.
--
-- Lo que se demuestra acá:
--
--   * el cliente puede abrir y refrescar su seguimiento las veces que quiera y
--     la revisión del pedido NO se mueve;
--   * la oferta emitida ANTES de esas lecturas se sigue pudiendo aceptar;
--   * la asignación ocurre exactamente una vez;
--   * y la concurrencia optimista sigue entera: un cambio REAL del pedido sí
--     sube la revisión y sí invalida la oferta vieja, un segundo repartidor no
--     puede quedarse con el mismo pedido, y una oferta obsoleta se sigue
--     rechazando.
--
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- ── Fixture ────────────────────────────────────────────────────────────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('a2000000-0000-4000-8000-0000000000e1','authenticated','authenticated','cro-staff@example.invalid','',now(),'{}','{"display_name":"Staff"}',now(),now()),
  ('a2000000-0000-4000-8000-0000000000e2','authenticated','authenticated','cro-rider1@example.invalid','',now(),'{}','{"display_name":"Rider Uno"}',now(),now()),
  ('a2000000-0000-4000-8000-0000000000e3','authenticated','authenticated','cro-rider2@example.invalid','',now(),'{}','{"display_name":"Rider Dos"}',now(),now()),
  ('a2000000-0000-4000-8000-0000000000e4','authenticated','authenticated','cro-cliente@example.invalid','',now(),'{}','{"display_name":"Cliente"}',now(),now());

insert into public.businesses(id,name,status,slug,is_active)
values('b2000000-0000-4000-8000-0000000000e1','TABA lectura','open','taba-lectura',true);

insert into public.business_members(business_id,user_id,role,is_active)
values
  ('b2000000-0000-4000-8000-0000000000e1','a2000000-0000-4000-8000-0000000000e1','staff',true),
  ('b2000000-0000-4000-8000-0000000000e1','a2000000-0000-4000-8000-0000000000e2','rider',true),
  ('b2000000-0000-4000-8000-0000000000e1','a2000000-0000-4000-8000-0000000000e3','rider',true);

insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
values
  ('c2000000-0000-4000-8000-0000000000e1','a2000000-0000-4000-8000-0000000000e1','b2000000-0000-4000-8000-0000000000e1','staff','panel_web'),
  ('c2000000-0000-4000-8000-0000000000e2','a2000000-0000-4000-8000-0000000000e2','b2000000-0000-4000-8000-0000000000e1','rider','rider_android'),
  ('c2000000-0000-4000-8000-0000000000e3','a2000000-0000-4000-8000-0000000000e3','b2000000-0000-4000-8000-0000000000e1','rider','rider_android');

-- Dos pedidos: el de la prueba y uno AJENO, para comprobar que nada lo mueve.
insert into public.orders(
  id,business_id,code,public_code,status,fulfillment_type,delivery_mode,
  client_request_id,customer_user_id,customer_name,customer_neighborhood,
  customer_street_address,customer_phone,payment_method,subtotal,delivery_fee,total,
  delivery_code_required
)
values
  ('d2000000-0000-4000-8000-0000000000e1','b2000000-0000-4000-8000-0000000000e1','CRO-1','CRO-1','ready','delivery','delivery',
   'cro-request-1','a2000000-0000-4000-8000-0000000000e4','CLIENTE_SINTETICO_NO_CACHEAR','Centro',
   'Mendoza 851','+5492996209136','cash',1000,0,1000,true),
  ('d2000000-0000-4000-8000-0000000000e2','b2000000-0000-4000-8000-0000000000e1','CRO-2','CRO-2','ready','delivery','delivery',
   'cro-request-2','a2000000-0000-4000-8000-0000000000e4','CLIENTE_SINTETICO_NO_CACHEAR','Centro',
   'Mendoza 900','+5492996209136','cash',1000,0,1000,true);

create or replace function pg_temp.como(p_user text, p_session text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', p_session)::text, true)::void;
$$;
create or replace function pg_temp.staff() returns void language sql as $$
  select pg_temp.como('a2000000-0000-4000-8000-0000000000e1','c2000000-0000-4000-8000-0000000000e1'); $$;
create or replace function pg_temp.rider1() returns void language sql as $$
  select pg_temp.como('a2000000-0000-4000-8000-0000000000e2','c2000000-0000-4000-8000-0000000000e2'); $$;
create or replace function pg_temp.rider2() returns void language sql as $$
  select pg_temp.como('a2000000-0000-4000-8000-0000000000e3','c2000000-0000-4000-8000-0000000000e3'); $$;
-- El cliente NO es del comercio: no tiene sesión de equipo, sólo su identidad.
create or replace function pg_temp.cliente() returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub','a2000000-0000-4000-8000-0000000000e4','role','authenticated')::text, true)::void;
$$;
create or replace function pg_temp.revision(p_order uuid) returns bigint language sql as $$
  select revision from public.orders where id = p_order; $$;
create or replace function pg_temp.oferta(p_order uuid) returns uuid language sql as $$
  select f.id from public.rider_order_offers f
   where f.order_id = p_order and f.status = 'pending' order by f.offered_at desc limit 1; $$;
create or replace function pg_temp.token(n int) returns text language sql as $$
  select 'cro-token-' || lpad(n::text, 4, '0') || repeat('x', 22); $$;

-- ══ 1 · el comercio ofrece, y la oferta queda atada a la revisión de HOY ════
select pg_temp.staff();
select is(
  public.offer_order_to_rider('d2000000-0000-4000-8000-0000000000e1','ready',null,'a2000000-0000-4000-8000-0000000000e2') ->> 'code',
  'offered', 'el comercio ofrece el pedido al repartidor');

select is(
  (select expected_order_revision from public.rider_order_offers where id = pg_temp.oferta('d2000000-0000-4000-8000-0000000000e1')),
  pg_temp.revision('d2000000-0000-4000-8000-0000000000e1'),
  'la oferta guarda la revisión que el pedido tiene en este momento');

-- ══ 2 · el cliente entra a mirar su pedido, varias veces ════════════════════
select pg_temp.cliente();
select lives_ok(
  $$ select public.recover_order_tracking_access('d2000000-0000-4000-8000-0000000000e1', pg_temp.token(1)) $$,
  'el cliente abre su seguimiento');
select lives_ok(
  $$ select public.recover_order_tracking_access('d2000000-0000-4000-8000-0000000000e1', pg_temp.token(2)) $$,
  'y lo refresca');
select lives_ok(
  $$ select public.recover_order_tracking_access('d2000000-0000-4000-8000-0000000000e1', pg_temp.token(3)) $$,
  'y lo vuelve a refrescar');

-- LA PROPIEDAD QUE ESTE ARCHIVO EXISTE PARA DEFENDER.
select is(
  pg_temp.revision('d2000000-0000-4000-8000-0000000000e1'),
  (select expected_order_revision from public.rider_order_offers where id = pg_temp.oferta('d2000000-0000-4000-8000-0000000000e1')),
  'tres lecturas del cliente y la revisión del pedido NO se movió');

-- Y el pedido ajeno ni se enteró.
select is(
  pg_temp.revision('d2000000-0000-4000-8000-0000000000e2'), 1::bigint,
  'el pedido de al lado no se tocó');

-- ══ 3 · el repartidor acepta la oferta ORIGINAL ═════════════════════════════
select pg_temp.rider1();
select is(
  public.accept_rider_order_offer(pg_temp.oferta('d2000000-0000-4000-8000-0000000000e1'), 1, 'cro-acc-000001') ->> 'code',
  'accepted', 'el repartidor acepta la oferta que ya tenía, sin reofrecer nada');
select is(
  (select assigned_rider_user_id from public.orders where id='d2000000-0000-4000-8000-0000000000e1'),
  'a2000000-0000-4000-8000-0000000000e2'::uuid, 'el pedido queda asignado a ese repartidor');
select is(
  (select status from public.orders where id='d2000000-0000-4000-8000-0000000000e1'),
  'assigned', 'y pasa a asignado');

-- ══ 4 · exactamente una vez ════════════════════════════════════════════════
select is(
  (select count(*) from public.order_events
    where order_id='d2000000-0000-4000-8000-0000000000e1' and type='order.rider_accepted_offer')::int,
  1, 'la asignación ocurrió una sola vez');
select is(
  public.accept_rider_order_offer(pg_temp.oferta('d2000000-0000-4000-8000-0000000000e1'), 1, 'cro-acc-000001') ->> 'idempotent_no_op',
  'true', 'reintentar con la misma clave no asigna de nuevo');

-- ══ 5 · dos repartidores no se quedan con el mismo pedido ══════════════════
select pg_temp.rider2();
select throws_ok(
  $$ select public.accept_rider_order_offer(
       (select id from public.rider_order_offers where order_id='d2000000-0000-4000-8000-0000000000e1' limit 1),
       1, 'cro-acc-000002') $$,
  'P0002', null, 'el segundo repartidor no puede aceptar una oferta ajena');

-- ══ 6 · la concurrencia optimista sigue entera ═════════════════════════════
-- Un cambio REAL del pedido sí tiene que invalidar una oferta vieja.
select pg_temp.staff();
select is(
  public.offer_order_to_rider('d2000000-0000-4000-8000-0000000000e2','ready',null,'a2000000-0000-4000-8000-0000000000e3') ->> 'code',
  'offered', 'se ofrece el segundo pedido');

update public.orders set customer_notes = 'el comercio cambió algo de verdad'
 where id = 'd2000000-0000-4000-8000-0000000000e2';

select cmp_ok(
  pg_temp.revision('d2000000-0000-4000-8000-0000000000e2'), '>',
  (select expected_order_revision from public.rider_order_offers where order_id='d2000000-0000-4000-8000-0000000000e2'),
  'un cambio real del pedido SÍ sube la revisión');

select pg_temp.rider2();
select is(
  public.accept_rider_order_offer(pg_temp.oferta('d2000000-0000-4000-8000-0000000000e2'), 1, 'cro-acc-000003') ->> 'code',
  'stale_revision', 'y una oferta obsoleta se sigue rechazando');

select * from finish();
rollback;
