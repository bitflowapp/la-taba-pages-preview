-- TABA2 · Rider multi-pedido · CONTRATO DE LA OFERTA
--
-- Aceptar, rechazar, y todo lo que pasa cuando el mismo botón se toca dos
-- veces o en el orden equivocado. Lo que se demuestra acá:
--
--   * mientras la oferta está viva el pedido NO nombra al rider, que es lo que
--     hace cumplible la privacidad previa a la aceptación;
--   * rechazar es terminal para ese rider y deja el pedido listo para otro,
--     sin auto-asignar a nadie;
--   * dos operadores no pueden ofrecer el mismo pedido a dos riders.
--
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

-- ── Fixture ────────────────────────────────────────────────────────────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('a1000000-0000-4000-8000-0000000000f1','authenticated','authenticated','of-staff1@example.invalid','',now(),'{}','{"display_name":"Staff Uno"}',now(),now()),
  ('a1000000-0000-4000-8000-0000000000f2','authenticated','authenticated','of-staff2@example.invalid','',now(),'{}','{"display_name":"Staff Dos"}',now(),now()),
  ('a1000000-0000-4000-8000-0000000000f3','authenticated','authenticated','of-rider1@example.invalid','',now(),'{}','{"display_name":"Marco"}',now(),now()),
  ('a1000000-0000-4000-8000-0000000000f4','authenticated','authenticated','of-rider2@example.invalid','',now(),'{}','{"display_name":"Ana"}',now(),now());

insert into public.businesses(id,name,status,slug,is_active)
values('b1000000-0000-4000-8000-0000000000f1','TABA ofertas','open','taba-ofertas',true);

insert into public.business_members(business_id,user_id,role,is_active)
values
  ('b1000000-0000-4000-8000-0000000000f1','a1000000-0000-4000-8000-0000000000f1','staff',true),
  ('b1000000-0000-4000-8000-0000000000f1','a1000000-0000-4000-8000-0000000000f2','staff',true),
  ('b1000000-0000-4000-8000-0000000000f1','a1000000-0000-4000-8000-0000000000f3','rider',true),
  ('b1000000-0000-4000-8000-0000000000f1','a1000000-0000-4000-8000-0000000000f4','rider',true);

insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
values
  ('c1000000-0000-4000-8000-0000000000f1','a1000000-0000-4000-8000-0000000000f1','b1000000-0000-4000-8000-0000000000f1','staff','panel_web'),
  ('c1000000-0000-4000-8000-0000000000f2','a1000000-0000-4000-8000-0000000000f2','b1000000-0000-4000-8000-0000000000f1','staff','panel_web'),
  ('c1000000-0000-4000-8000-0000000000f3','a1000000-0000-4000-8000-0000000000f3','b1000000-0000-4000-8000-0000000000f1','rider','rider_android'),
  ('c1000000-0000-4000-8000-0000000000f4','a1000000-0000-4000-8000-0000000000f4','b1000000-0000-4000-8000-0000000000f1','rider','rider_android');

insert into public.orders(
  id,business_id,code,public_code,status,fulfillment_type,delivery_mode,
  client_request_id,customer_name,customer_neighborhood,customer_street_address,
  customer_phone,customer_notes,payment_method,subtotal,delivery_fee,total
)
select
  ('d1000000-0000-4000-8000-00000000000' || n)::uuid,
  'b1000000-0000-4000-8000-0000000000f1',
  'OF-' || n, 'OF-' || n, 'ready', 'delivery', 'delivery',
  'of-request-' || n, 'CLIENTE_SINTETICO_NO_CACHEAR', 'Centro', 'Mendoza 827 dpto ' || n,
  '+5492996209136', 'Timbre roto, golpear', 'cash', 1000, 0, 1000
from generate_series(1, 5) as n;

create or replace function pg_temp.as_user(p_user text, p_session text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', p_session)::text, true)::void;
$$;
create or replace function pg_temp.as_staff1() returns void language sql as $$
  select pg_temp.as_user('a1000000-0000-4000-8000-0000000000f1','c1000000-0000-4000-8000-0000000000f1'); $$;
create or replace function pg_temp.as_staff2() returns void language sql as $$
  select pg_temp.as_user('a1000000-0000-4000-8000-0000000000f2','c1000000-0000-4000-8000-0000000000f2'); $$;
create or replace function pg_temp.as_rider1() returns void language sql as $$
  select pg_temp.as_user('a1000000-0000-4000-8000-0000000000f3','c1000000-0000-4000-8000-0000000000f3'); $$;
create or replace function pg_temp.as_rider2() returns void language sql as $$
  select pg_temp.as_user('a1000000-0000-4000-8000-0000000000f4','c1000000-0000-4000-8000-0000000000f4'); $$;

create or replace function pg_temp.offer_id(p_order uuid) returns uuid language sql as $$
  select f.id from public.rider_order_offers f
   where f.order_id = p_order and f.status = 'pending' order by f.offered_at desc limit 1;
$$;

-- ══ ACCEPT ═════════════════════════════════════════════════════════════════
select pg_temp.as_staff1();
select is(
  public.offer_order_to_rider('d1000000-0000-4000-8000-000000000001','ready',null,'a1000000-0000-4000-8000-0000000000f3') ->> 'code',
  'offered', 'el Panel ofrece');

-- LA PROPIEDAD CENTRAL DEL MODELO ELEGIDO: ofrecer no toca el pedido.
select is(
  (select assigned_rider_user_id from public.orders where id='d1000000-0000-4000-8000-000000000001'),
  null, 'mientras la oferta esta viva el pedido NO nombra al rider');
select is(
  (select status from public.orders where id='d1000000-0000-4000-8000-000000000001'),
  'ready', 'y sigue en ready, no en un estado inventado');

select pg_temp.as_rider1();
select is(
  public.accept_rider_order_offer(pg_temp.offer_id('d1000000-0000-4000-8000-000000000001'),1,'of-acc-0000001') ->> 'code',
  'accepted', 'el rider acepta');
select is(
  (select assigned_rider_user_id from public.orders where id='d1000000-0000-4000-8000-000000000001'),
  'a1000000-0000-4000-8000-0000000000f3', 'recien ahora el pedido lo nombra');
select is(
  (select status from public.orders where id='d1000000-0000-4000-8000-000000000001'),
  'assigned', 'y pasa a assigned');
select is(
  (select status from public.rider_order_offers where order_id='d1000000-0000-4000-8000-000000000001'),
  'accepted', 'la oferta queda aceptada');

-- ── Duplicate accept: misma clave, y clave distinta ────────────────────────
select is(
  (public.accept_rider_order_offer(
     (select id from public.rider_order_offers where order_id='d1000000-0000-4000-8000-000000000001'),
     1,'of-acc-0000001') ->> 'idempotent_no_op')::boolean,
  true, 'repetir el accept con la MISMA clave devuelve el recibo, no un segundo efecto');
select is(
  public.accept_rider_order_offer(
    (select id from public.rider_order_offers where order_id='d1000000-0000-4000-8000-000000000001'),
    1,'of-acc-0000001-bis') ->> 'code',
  'already_accepted', 'y con OTRA clave dice que ya estaba aceptada');
select is(
  (select count(*)::integer from public.orders
    where assigned_rider_user_id='a1000000-0000-4000-8000-0000000000f3'
      and status = any(public.rider_active_order_statuses())),
  1, 'dos taps, una sola entrega');

-- ── Reject after accept ────────────────────────────────────────────────────
select is(
  public.reject_rider_order_offer(
    (select id from public.rider_order_offers where order_id='d1000000-0000-4000-8000-000000000001'),
    2,'too_far','of-rej-0000001') ->> 'code',
  'already_accepted', 'no se puede rechazar lo que ya se acepto');

-- ══ REJECT ═════════════════════════════════════════════════════════════════
select pg_temp.as_staff1();
select is(
  public.offer_order_to_rider('d1000000-0000-4000-8000-000000000002','ready',null,'a1000000-0000-4000-8000-0000000000f3') ->> 'code',
  'offered', 'segunda oferta al mismo rider');

select pg_temp.as_rider1();
select is(
  public.reject_rider_order_offer(pg_temp.offer_id('d1000000-0000-4000-8000-000000000002'),1,'too_far','of-rej-0000002') ->> 'code',
  'rejected', 'el rider rechaza');
select is(
  (select assigned_rider_user_id from public.orders where id='d1000000-0000-4000-8000-000000000002'),
  null, 'el pedido no quedo asignado a nadie: no hubo auto-asignacion');
select is(
  (select status from public.orders where id='d1000000-0000-4000-8000-000000000002'),
  'ready', 'y volvio a estar disponible para el Panel sin necesidad de revertir nada');

-- Duplicate reject, y accept after reject.
select is(
  (public.reject_rider_order_offer(
    (select id from public.rider_order_offers where order_id='d1000000-0000-4000-8000-000000000002'),
    1,'too_far','of-rej-0000002') ->> 'idempotent_no_op')::boolean,
  true, 'repetir el reject con la misma clave es un no-op');
select is(
  public.reject_rider_order_offer(
    (select id from public.rider_order_offers where order_id='d1000000-0000-4000-8000-000000000002'),
    2,'too_far','of-rej-0000002-bis') ->> 'code',
  'already_rejected', 'y con otra clave dice que ya estaba rechazada');
select is(
  public.accept_rider_order_offer(
    (select id from public.rider_order_offers where order_id='d1000000-0000-4000-8000-000000000002'),
    2,'of-acc-0000002') ->> 'code',
  'offer_not_available', 'aceptar despues de rechazar no revive la oferta');

-- El rechazo es terminal PARA ESE RIDER.
select pg_temp.as_staff1();
select is(
  public.offer_order_to_rider('d1000000-0000-4000-8000-000000000002','ready',null,'a1000000-0000-4000-8000-0000000000f3') ->> 'code',
  'already_rejected_by_rider', 'el Panel no puede volver a ofrecerselo al que ya dijo que no');
-- Pero SI a otro. Esto es lo que pide el contrato al rechazar.
select is(
  public.offer_order_to_rider('d1000000-0000-4000-8000-000000000002','ready',null,'a1000000-0000-4000-8000-0000000000f4') ->> 'code',
  'offered', 'y si puede ofrecerselo a otro rider');
select pg_temp.as_rider2();
select is(
  public.accept_rider_order_offer(pg_temp.offer_id('d1000000-0000-4000-8000-000000000002'),1,'of-acc-0000002b') ->> 'code',
  'accepted', 'que lo acepta sin arrastrar nada del rechazo anterior');

-- ── Motivo cerrado, nunca texto libre ──────────────────────────────────────
select pg_temp.as_staff1();
select public.offer_order_to_rider('d1000000-0000-4000-8000-000000000003','ready',null,'a1000000-0000-4000-8000-0000000000f3');
select pg_temp.as_rider1();
select throws_ok(
  format($$select public.reject_rider_order_offer(%L::uuid, 1, 'el cliente se llama Juan y vive en Mendoza 827', 'of-rej-0000003')$$,
         pg_temp.offer_id('d1000000-0000-4000-8000-000000000003')),
  '22023', null,
  'el motivo es un codigo cerrado: no entra texto libre con datos personales');
-- Rechazar sin motivo tambien vale: rechazar tiene que ser rapido.
select is(
  public.reject_rider_order_offer(pg_temp.offer_id('d1000000-0000-4000-8000-000000000003'),1,null,'of-rej-0000003') ->> 'code',
  'rejected', 'rechazar sin motivo esta permitido: no hay formulario obligatorio');

-- ── Oferta vencida por movimiento del pedido ───────────────────────────────
select pg_temp.as_staff1();
select public.offer_order_to_rider('d1000000-0000-4000-8000-000000000004','ready',null,'a1000000-0000-4000-8000-0000000000f3');
select set_config('request.jwt.claims','',true)::void;
update public.orders set status = 'cancelled', canceled_at = clock_timestamp()
 where id = 'd1000000-0000-4000-8000-000000000004';
select pg_temp.as_rider1();
select is(
  public.accept_rider_order_offer(pg_temp.offer_id('d1000000-0000-4000-8000-000000000004'),1,'of-acc-0000004') ->> 'code',
  'order_unavailable', 'una oferta sobre un pedido cancelado no se puede aceptar');
select is(
  jsonb_array_length(public.get_rider_delivery_board() -> 'offers'),
  0, 'y el board tampoco se la muestra: no es una decision que pueda tomar');

-- ── CAS de version ─────────────────────────────────────────────────────────
select pg_temp.as_staff1();
select public.offer_order_to_rider('d1000000-0000-4000-8000-000000000005','ready',null,'a1000000-0000-4000-8000-0000000000f3');
select pg_temp.as_rider1();
select is(
  public.accept_rider_order_offer(pg_temp.offer_id('d1000000-0000-4000-8000-000000000005'),99,'of-acc-0000005') ->> 'code',
  'stale_version', 'una version vieja de la oferta no acepta');

-- ── Concurrencia entre operadores ──────────────────────────────────────────
select pg_temp.as_staff2();
select is(
  public.offer_order_to_rider('d1000000-0000-4000-8000-000000000005','ready',null,'a1000000-0000-4000-8000-0000000000f4') ->> 'code',
  'offer_in_flight',
  'el Staff B no puede ofrecer a otro rider un pedido que el Staff A ya ofrecio');
select is(
  public.offer_order_to_rider('d1000000-0000-4000-8000-000000000005','ready',null,'a1000000-0000-4000-8000-0000000000f3') ->> 'code',
  'already_offered',
  'ni repetir la misma oferta al mismo rider');
select is(
  (select count(*)::integer from public.rider_order_offers
    where order_id='d1000000-0000-4000-8000-000000000005' and status='pending'),
  1, 'un unico resultado coherente: una sola oferta viva por pedido');

-- El operador puede retirarla y ofrecersela a otro.
select is(
  public.withdraw_rider_order_offer(pg_temp.offer_id('d1000000-0000-4000-8000-000000000005')) ->> 'code',
  'withdrawn', 'el operador retira la oferta colgada');
select is(
  public.offer_order_to_rider('d1000000-0000-4000-8000-000000000005','ready',null,'a1000000-0000-4000-8000-0000000000f4') ->> 'code',
  'offered', 'y ahora si se la puede ofrecer a otro');
select pg_temp.as_rider1();
select is(
  public.accept_rider_order_offer(
    (select id from public.rider_order_offers
      where order_id='d1000000-0000-4000-8000-000000000005' and status='withdrawn'),
    2,'of-acc-0000005b') ->> 'code',
  'offer_not_available', 'la oferta retirada ya no se puede aceptar');

select * from finish();
rollback;
