-- TABA2 · Rider multi-pedido · CAPACIDAD
--
-- Lo que esta suite tiene que demostrar: que el máximo de 3 no es una condición
-- dentro de una función, sino un invariante de `public.orders`. Por eso se
-- prueba por los TRES caminos que asignan —la aceptación de una oferta, la
-- asignación manual del Panel y el claim de cola— y además con un `UPDATE`
-- crudo, que es el que no pasa por ninguna RPC.
--
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

-- ── Fixture ────────────────────────────────────────────────────────────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('a0000000-0000-4000-8000-0000000000c1','authenticated','authenticated','cap-staff@example.invalid','',now(),'{}','{"display_name":"Staff Cap"}',now(),now()),
  ('a0000000-0000-4000-8000-0000000000c2','authenticated','authenticated','cap-rider@example.invalid','',now(),'{}','{"display_name":"Marco"}',now(),now());

insert into public.businesses(id,name,status,slug,is_active)
values('b0000000-0000-4000-8000-0000000000c1','TABA capacidad','open','taba-capacidad',true);

insert into public.business_members(business_id,user_id,role,is_active)
values
  ('b0000000-0000-4000-8000-0000000000c1','a0000000-0000-4000-8000-0000000000c1','staff',true),
  ('b0000000-0000-4000-8000-0000000000c1','a0000000-0000-4000-8000-0000000000c2','rider',true);

insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
values
  ('c0000000-0000-4000-8000-0000000000c1','a0000000-0000-4000-8000-0000000000c1','b0000000-0000-4000-8000-0000000000c1','staff','panel_web'),
  ('c0000000-0000-4000-8000-0000000000c2','a0000000-0000-4000-8000-0000000000c2','b0000000-0000-4000-8000-0000000000c1','rider','rider_android');

-- Cinco pedidos listos, idénticos salvo el código.
insert into public.orders(
  id,business_id,code,public_code,status,fulfillment_type,delivery_mode,
  client_request_id,customer_name,customer_neighborhood,customer_street_address,
  customer_phone,payment_method,subtotal,delivery_fee,total
)
select
  ('d0000000-0000-4000-8000-00000000000' || n)::uuid,
  'b0000000-0000-4000-8000-0000000000c1',
  'CAP-' || n, 'CAP-' || n, 'ready', 'delivery', 'delivery',
  'cap-request-' || n, 'CLIENTE_SINTETICO_NO_CACHEAR', 'Centro', 'Calle Falsa ' || n,
  '+540000000000', 'cash', 1000, 0, 1000
from generate_series(1, 5) as n;

create or replace function pg_temp.as_staff() returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"a0000000-0000-4000-8000-0000000000c1","role":"authenticated","session_id":"c0000000-0000-4000-8000-0000000000c1"}', true)::void;
$$;
create or replace function pg_temp.as_rider() returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"a0000000-0000-4000-8000-0000000000c2","role":"authenticated","session_id":"c0000000-0000-4000-8000-0000000000c2"}', true)::void;
$$;
create or replace function pg_temp.as_postgres() returns void language sql as $$
  select set_config('request.jwt.claims', '', true)::void;
$$;

create or replace function pg_temp.active_count() returns integer language sql as $$
  select public.count_rider_active_orders(
    'b0000000-0000-4000-8000-0000000000c1', 'a0000000-0000-4000-8000-0000000000c2', null);
$$;

-- Ofrecer + aceptar en un paso, que es el camino real.
create or replace function pg_temp.offer_and_accept(p_order uuid, p_key text)
returns jsonb language plpgsql as $$
declare v_offer jsonb; v_id uuid;
begin
  perform pg_temp.as_staff();
  v_offer := public.offer_order_to_rider(p_order, 'ready', null, 'a0000000-0000-4000-8000-0000000000c2');
  if not coalesce((v_offer ->> 'ok')::boolean, false) then return v_offer; end if;
  v_id := (v_offer ->> 'offer_id')::uuid;
  perform pg_temp.as_rider();
  return public.accept_rider_order_offer(v_id, 1, p_key);
end;
$$;

-- ── La constante es una sola, y es 3 ───────────────────────────────────────
select is(public.rider_max_active_orders(), 3,
  'MAX_ACTIVE_RIDER_ORDERS = 3, en un unico lugar');
select is(public.rider_active_order_statuses(),
  array['assigned','picked_up','on_the_way','arrived']::text[],
  'lo que ocupa cupo son los cuatro estados no terminales');

-- ── 0 → 1 → 2 → 3 ──────────────────────────────────────────────────────────
select is(pg_temp.active_count(), 0, '0/3 al empezar');

select is(pg_temp.offer_and_accept('d0000000-0000-4000-8000-000000000001','cap-accept-001') ->> 'code',
  'accepted', '0/3 acepta');
select is(pg_temp.active_count(), 1, 'ahora 1/3');

select is(pg_temp.offer_and_accept('d0000000-0000-4000-8000-000000000002','cap-accept-002') ->> 'code',
  'accepted', '1/3 acepta');
select is(pg_temp.active_count(), 2, 'ahora 2/3');

select is(pg_temp.offer_and_accept('d0000000-0000-4000-8000-000000000003','cap-accept-003') ->> 'code',
  'accepted', '2/3 acepta');
select is(pg_temp.active_count(), 3, 'ahora 3/3');

-- ── El cuarto lo rechaza el servidor, no la app ────────────────────────────
-- Ofrecer un cuarto a un Rider lleno se corta ya en la oferta.
select pg_temp.as_staff();
select is(
  public.offer_order_to_rider('d0000000-0000-4000-8000-000000000004','ready',null,'a0000000-0000-4000-8000-0000000000c2') ->> 'code',
  'rider_at_capacity',
  'el Panel no puede ni ofrecer un cuarto a un rider 3/3');

-- Y si la oferta hubiera nacido cuando todavia habia lugar, la aceptacion
-- tampoco pasa: se recuenta al aceptar, no al ofrecer.
select pg_temp.as_postgres();
insert into public.rider_order_offers(business_id,order_id,rider_user_id,offered_by_user_id,expected_order_revision)
values('b0000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-000000000004',
       'a0000000-0000-4000-8000-0000000000c2','a0000000-0000-4000-8000-0000000000c1',
       (select revision from public.orders where id='d0000000-0000-4000-8000-000000000004'));
select pg_temp.as_rider();
select is(
  public.accept_rider_order_offer(
    (select id from public.rider_order_offers where order_id='d0000000-0000-4000-8000-000000000004'),
    1, 'cap-accept-004') ->> 'code',
  'at_capacity',
  'una oferta viva sobre un rider que se lleno mientras tanto NO se puede aceptar');
select is(pg_temp.active_count(), 3, 'sigue 3/3: la aceptacion no escribio nada');

-- ── El invariante vive en la tabla, no en la RPC ───────────────────────────
select pg_temp.as_postgres();
select throws_ok($$
  update public.orders set assigned_rider_user_id = 'a0000000-0000-4000-8000-0000000000c2', status = 'assigned'
   where id = 'd0000000-0000-4000-8000-000000000005'
$$, '23514', null,
  'un UPDATE crudo, sin pasar por ninguna RPC, tampoco puede hacer 4/3');

select pg_temp.as_staff();
select throws_ok($$
  select public.assign_order_rider('d0000000-0000-4000-8000-000000000005','ready',null,'a0000000-0000-4000-8000-0000000000c2')
$$, '23514', null,
  'la asignacion manual del Panel tampoco: era el camino que no contaba nada');

select pg_temp.as_rider();
select is(
  public.claim_delivery_order('b0000000-0000-4000-8000-0000000000c1','CAP-5',
    (select revision from public.orders where id='d0000000-0000-4000-8000-000000000005'),
    'cap-claim-00005') ->> 'code',
  'at_capacity',
  'el claim de cola devuelve at_capacity, no el viejo active_delivery_exists');

select is(pg_temp.active_count(), 3, 'tras los tres intentos sigue habiendo 3, nunca 4');

-- ── Completar uno libera cupo ──────────────────────────────────────────────
select pg_temp.as_postgres();
update public.orders set status = 'picked_up' where id = 'd0000000-0000-4000-8000-000000000001';
select is(pg_temp.active_count(), 3, 'picked_up sigue ocupando cupo');
update public.orders set status = 'on_the_way' where id = 'd0000000-0000-4000-8000-000000000001';
select is(pg_temp.active_count(), 3, 'on_the_way sigue ocupando cupo');
update public.orders set status = 'arrived', arrived_at = clock_timestamp() where id = 'd0000000-0000-4000-8000-000000000001';
select is(pg_temp.active_count(), 3, 'arrived sigue ocupando cupo');

-- La entrega real exige codigo confirmado (dos triggers distintos lo piden).
-- Aca se prueba capacidad, no PIN: el PIN tiene su propia suite y ahi se
-- confirma con la RPC de verdad.
insert into public.order_delivery_handoffs(order_id,code_hash,code_ciphertext,expires_at,confirmed_at)
values('d0000000-0000-4000-8000-000000000001', extensions.crypt('1234', extensions.gen_salt('bf')),
       '\x00'::bytea, clock_timestamp() + interval '1 day', clock_timestamp());
select set_config('taba.delivery_code_confirmed','true',true)::void;
update public.orders set status = 'delivered', delivered_at = clock_timestamp()
 where id = 'd0000000-0000-4000-8000-000000000001';
select is(pg_temp.active_count(), 2, 'entregado libera cupo: 3/3 -> 2/3');

-- Y ahora el cuarto entra.
select is(pg_temp.offer_and_accept('d0000000-0000-4000-8000-000000000005','cap-accept-005') ->> 'code',
  'accepted', 'con un cupo libre, el pedido que antes se rechazaba entra');
select is(pg_temp.active_count(), 3, 'y vuelve a ser 3/3');

-- Cancelar tambien libera.
select pg_temp.as_postgres();
update public.orders set status = 'cancelled', canceled_at = clock_timestamp()
 where id = 'd0000000-0000-4000-8000-000000000002';
select is(pg_temp.active_count(), 2, 'cancelado libera cupo igual que entregado');

-- ── La foto del Rider y la del Panel dicen lo mismo ────────────────────────
select pg_temp.as_rider();
select is((public.get_rider_delivery_board() ->> 'active_orders')::integer, 2,
  'el board del Rider cuenta 2 activos');
select is((public.get_rider_delivery_board() ->> 'max_active_orders')::integer, 3,
  'y publica el maximo autoritativo');
select is((public.get_rider_delivery_board() ->> 'at_capacity')::boolean, false,
  'con 2/3 no esta al tope');

select pg_temp.as_staff();
select is(
  (select active_orders from public.list_active_business_riders('b0000000-0000-4000-8000-0000000000c1')
    where rider_user_id = 'a0000000-0000-4000-8000-0000000000c2'),
  2, 'el Panel ve la misma cuenta, derivada del servidor');

select * from finish();
rollback;
