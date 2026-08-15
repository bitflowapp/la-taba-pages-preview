-- TABA2 · Rider multi-pedido · TRES PEDIDOS QUE NO SE MEZCLAN
--
-- Un Rider con A, B y C encima. Lo que esta suite tiene que demostrar es que
-- «tres pedidos» no significa «un pedido más grande»: cada uno conserva su
-- estado, su PIN, su cobro y su tracking, y ninguna operación sobre uno toca a
-- los otros.
--
-- Lo que más importa acá es el GPS. El Rider tiene UNA posición física, y el
-- reparto de esa muestra a los tres pedidos es exactamente el punto donde un
-- error mezclaría clientes. Se comprueba desde el lado del cliente, que es
-- quien no tiene que ver nada de los otros.
--
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

-- ── Fixture ────────────────────────────────────────────────────────────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('a3000000-0000-4000-8000-0000000000e1','authenticated','authenticated','iso-staff@example.invalid','',now(),'{}','{"display_name":"Staff"}',now(),now()),
  ('a3000000-0000-4000-8000-0000000000e2','authenticated','authenticated','iso-rider@example.invalid','',now(),'{}','{"display_name":"Marco"}',now(),now());

insert into public.businesses(id,name,status,slug,is_active)
values('b3000000-0000-4000-8000-0000000000e1','TABA aislamiento multi','open','taba-aislamiento-multi',true);

insert into public.business_members(business_id,user_id,role,is_active)
values
  ('b3000000-0000-4000-8000-0000000000e1','a3000000-0000-4000-8000-0000000000e1','staff',true),
  ('b3000000-0000-4000-8000-0000000000e1','a3000000-0000-4000-8000-0000000000e2','rider',true);

insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
values
  ('c3000000-0000-4000-8000-0000000000e1','a3000000-0000-4000-8000-0000000000e1','b3000000-0000-4000-8000-0000000000e1','staff','panel_web'),
  ('c3000000-0000-4000-8000-0000000000e2','a3000000-0000-4000-8000-0000000000e2','b3000000-0000-4000-8000-0000000000e1','rider','rider_android');

-- A efectivo, B digital, C efectivo. Totales distintos a proposito: si algo se
-- mezclara, el numero lo delata.
insert into public.orders(
  id,business_id,code,public_code,status,fulfillment_type,delivery_mode,
  client_request_id,customer_name,customer_neighborhood,customer_street_address,
  customer_phone,payment_method,subtotal,delivery_fee,total
) values
  ('d3000000-0000-4000-8000-0000000000ea','b3000000-0000-4000-8000-0000000000e1','ISO-A','ISO-A','ready','delivery','delivery',
   'iso-request-a','Cliente A','Centro','Calle A 111','+540000000001','cash',1100,0,1100),
  ('d3000000-0000-4000-8000-0000000000eb','b3000000-0000-4000-8000-0000000000e1','ISO-B','ISO-B','ready','delivery','delivery',
   'iso-request-b','Cliente B','Norte','Calle B 222','+540000000002','mercadopago',2200,0,2200),
  ('d3000000-0000-4000-8000-0000000000ec','b3000000-0000-4000-8000-0000000000e1','ISO-C','ISO-C','ready','delivery','delivery',
   'iso-request-c','Cliente C','Sur','Calle C 333','+540000000003','cash',3300,0,3300);

-- Tokens publicos: cada cliente con el suyo.
insert into public.order_public_tokens(order_id,token,token_hash,expires_at) values
  ('d3000000-0000-4000-8000-0000000000ea',null,extensions.digest('iso_token_cliente_a_0123456789','sha256'),clock_timestamp()+interval '30 days'),
  ('d3000000-0000-4000-8000-0000000000eb',null,extensions.digest('iso_token_cliente_b_0123456789','sha256'),clock_timestamp()+interval '30 days'),
  ('d3000000-0000-4000-8000-0000000000ec',null,extensions.digest('iso_token_cliente_c_0123456789','sha256'),clock_timestamp()+interval '30 days');

-- PIN propio por pedido. Tres codigos distintos, y eso es todo el punto.
insert into public.order_delivery_handoffs(order_id,code_hash,code_ciphertext,expires_at) values
  ('d3000000-0000-4000-8000-0000000000ea',extensions.crypt('1111',extensions.gen_salt('bf')),'\x00'::bytea,clock_timestamp()+interval '1 day'),
  ('d3000000-0000-4000-8000-0000000000eb',extensions.crypt('2222',extensions.gen_salt('bf')),'\x00'::bytea,clock_timestamp()+interval '1 day'),
  ('d3000000-0000-4000-8000-0000000000ec',extensions.crypt('3333',extensions.gen_salt('bf')),'\x00'::bytea,clock_timestamp()+interval '1 day');

create or replace function pg_temp.as_user(p_user text, p_session text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', p_session)::text, true)::void;
$$;
create or replace function pg_temp.as_staff() returns void language sql as $$
  select pg_temp.as_user('a3000000-0000-4000-8000-0000000000e1','c3000000-0000-4000-8000-0000000000e1'); $$;
create or replace function pg_temp.as_rider() returns void language sql as $$
  select pg_temp.as_user('a3000000-0000-4000-8000-0000000000e2','c3000000-0000-4000-8000-0000000000e2'); $$;
create or replace function pg_temp.rev(p_order uuid) returns bigint language sql as $$
  select revision from public.orders where id = p_order; $$;
create or replace function pg_temp.st(p_order uuid) returns text language sql as $$
  select status from public.orders where id = p_order; $$;

create or replace function pg_temp.take(p_order uuid, p_key text) returns text language plpgsql as $$
declare v_offer jsonb;
begin
  perform pg_temp.as_staff();
  v_offer := public.offer_order_to_rider(p_order,'ready',null,'a3000000-0000-4000-8000-0000000000e2');
  perform pg_temp.as_rider();
  return public.accept_rider_order_offer((v_offer ->> 'offer_id')::uuid, 1, p_key) ->> 'code';
end;
$$;

-- ══ TRES PEDIDOS, TRES ESTADOS ═════════════════════════════════════════════
select is(pg_temp.take('d3000000-0000-4000-8000-0000000000ea','iso-acc-000000a'), 'accepted', 'A aceptado');
select is(pg_temp.take('d3000000-0000-4000-8000-0000000000eb','iso-acc-000000b'), 'accepted', 'B aceptado');
select is(pg_temp.take('d3000000-0000-4000-8000-0000000000ec','iso-acc-000000c'), 'accepted', 'C aceptado');

select pg_temp.as_rider();
-- A avanza hasta on_the_way, B se queda en picked_up, C queda en assigned.
select is(public.mark_delivery_picked_up('d3000000-0000-4000-8000-0000000000ea',pg_temp.rev('d3000000-0000-4000-8000-0000000000ea'),'iso-pick-00000a') ->> 'outcome',
  'picked_up', 'A pasa a picked_up');
select is(public.start_rider_delivery('d3000000-0000-4000-8000-0000000000ea',pg_temp.rev('d3000000-0000-4000-8000-0000000000ea'),'iso-start-0000a') ->> 'outcome',
  'route_started', 'A pasa a on_the_way');
select is(public.mark_delivery_picked_up('d3000000-0000-4000-8000-0000000000eb',pg_temp.rev('d3000000-0000-4000-8000-0000000000eb'),'iso-pick-00000b') ->> 'outcome',
  'picked_up', 'B pasa a picked_up');

select is(pg_temp.st('d3000000-0000-4000-8000-0000000000ea'), 'on_the_way', 'A queda on_the_way');
select is(pg_temp.st('d3000000-0000-4000-8000-0000000000eb'), 'picked_up',  'B queda picked_up');
select is(pg_temp.st('d3000000-0000-4000-8000-0000000000ec'), 'assigned',   'C queda assigned');

-- Cada transicion se valida contra SU pedido, no contra el conjunto.
select is(
  public.start_rider_delivery('d3000000-0000-4000-8000-0000000000ec',pg_temp.rev('d3000000-0000-4000-8000-0000000000ec'),'iso-start-0000c') ->> 'code',
  'not_picked_up',
  'C no puede saltar a on_the_way porque A ya lo hizo: cada pedido se valida solo');
select is(pg_temp.st('d3000000-0000-4000-8000-0000000000ec'), 'assigned', 'y C sigue donde estaba');

-- El board los devuelve a los tres, ordenados por etapa.
select is(jsonb_array_length(public.get_rider_delivery_board() -> 'orders'), 3,
  'el board devuelve los tres pedidos');
select is(
  public.get_rider_delivery_board() -> 'orders' -> 0 ->> 'public_code',
  'ISO-A', 'y arriba el mas avanzado: orden visual simple y predecible');

-- ══ PAGOS ══════════════════════════════════════════════════════════════════
select is(
  (select count(distinct payload ->> 'total') from jsonb_array_elements(public.get_rider_delivery_board() -> 'orders') as payload),
  3::bigint, 'los tres totales siguen siendo tres numeros distintos');
select is(
  (select payload ->> 'total' from jsonb_array_elements(public.get_rider_delivery_board() -> 'orders') as payload
    where payload ->> 'public_code' = 'ISO-B'),
  '2200.00', 'B conserva su total');
select is(
  (select payload ->> 'payment_method' from jsonb_array_elements(public.get_rider_delivery_board() -> 'orders') as payload
    where payload ->> 'public_code' = 'ISO-B'),
  'mercadopago', 'y su forma de pago: mezcla efectivo/digital sin contagio');
select is(
  (select count(*)::integer from jsonb_array_elements(public.get_rider_delivery_board() -> 'orders') as payload
    where payload ->> 'payment_method' = 'cash'),
  2, 'los dos en efectivo siguen siendo dos');

-- ══ GPS: una ubicacion, N pedidos ══════════════════════════════════════════
-- Solo A esta en un estado publicable (on_the_way). B y C no.
select is(
  (public.publish_rider_location_fanout(
     -38.9460616, -68.0533209, 12, null, null, clock_timestamp(), 'iso-gps-00000001') ->> 'published')::integer,
  1, 'la muestra se publica en el unico pedido publicable');

select is(public.mark_rider_arrived('d3000000-0000-4000-8000-0000000000ea',pg_temp.rev('d3000000-0000-4000-8000-0000000000ea'),'iso-arr-000000a') ->> 'outcome',
  'arrived', 'A llega');
select is(public.start_rider_delivery('d3000000-0000-4000-8000-0000000000eb',pg_temp.rev('d3000000-0000-4000-8000-0000000000eb'),'iso-start-0000b') ->> 'outcome',
  'route_started', 'B sale a la calle');

-- Ahora hay dos publicables, pero A acaba de publicar. El reparto NO relaja
-- ninguna validacion de `publish_rider_location_receipt`, y el throttle de 5 s
-- es POR PEDIDO: A queda frenado y B entra. Esto es lo que debe pasar, y es la
-- razon por la que el cliente publica cada 5 s o mas.
select is(
  (public.publish_rider_location_fanout(
     -38.9461000, -68.0534000, 12, null, null, clock_timestamp(), 'iso-gps-00000002') ->> 'published')::integer,
  1, 'el reparto no saltea el throttle: A viene de publicar y queda frenado');
select is(
  (select r ->> 'code' from jsonb_array_elements(
     public.publish_rider_location_fanout(
       -38.9462000, -68.0535000, 12, null, null, clock_timestamp(), 'iso-gps-00000003') -> 'receipts') as r
    where (r ->> 'order_id') = 'd3000000-0000-4000-8000-0000000000ea'),
  'throttled', 'y lo dice pedido por pedido, no en bloque');

-- Con la ventana cumplida, una sola llamada alimenta a los dos.
update public.rider_locations set created_at = created_at - interval '30 seconds'
 where rider_user_id = 'a3000000-0000-4000-8000-0000000000e2';
select is(
  (public.publish_rider_location_fanout(
     -38.9463000, -68.0536000, 12, null, null, clock_timestamp(), 'iso-gps-00000004') ->> 'published')::integer,
  2, 'una sola llamada, una sola muestra, los dos pedidos publicables');
select is(
  (select count(*)::integer from public.rider_locations
    where order_id='d3000000-0000-4000-8000-0000000000ec'),
  0, 'y no escribe nada en el pedido que todavia no salio');
select is(
  (select count(distinct client_request_id)::integer from public.rider_locations
    where rider_user_id='a3000000-0000-4000-8000-0000000000e2'),
  (select count(*)::integer from public.rider_locations
    where rider_user_id='a3000000-0000-4000-8000-0000000000e2'),
  'cada fila lleva su propia clave derivada: el reintento sigue siendo idempotente por pedido');

-- ══ EL CLIENTE A NO VE NADA DEL CLIENTE B ══════════════════════════════════
select set_config('request.headers','{"x-order-token":"iso_token_cliente_a_0123456789"}',true)::void;
select is(
  public.get_public_order_tracking('ISO-A') ->> 'public_code', 'ISO-A',
  'el cliente A ve su pedido');
select is(
  public.get_public_order_tracking('ISO-B'), null,
  'y con su token NO ve el pedido B');
select is(
  public.get_public_order_tracking('ISO-C'), null,
  'ni el C');
select ok(
  public.get_public_order_tracking('ISO-A')::text not like '%ISO-B%'
  and public.get_public_order_tracking('ISO-A')::text not like '%ISO-C%'
  and public.get_public_order_tracking('ISO-A')::text not like '%d3000000-0000-4000-8000-0000000000eb%',
  'y su DTO no arrastra ni el codigo ni el id de los otros pedidos del mismo rider');

select set_config('request.headers','{"x-order-token":"iso_token_cliente_b_0123456789"}',true)::void;
select isnt(
  public.get_public_order_tracking('ISO-B') -> 'rider_location', null,
  'el cliente B ve la posicion del mismo rider, porque su pedido lo habilita');
select is(
  public.get_public_order_tracking('ISO-A'), null,
  'pero no ve el pedido A');
select set_config('request.headers','{}',true)::void;

-- ══ PIN: cada pedido el suyo ═══════════════════════════════════════════════
select pg_temp.as_rider();
select is(
  public.confirm_delivery_code('d3000000-0000-4000-8000-0000000000ea',pg_temp.rev('d3000000-0000-4000-8000-0000000000ea'),'2222','iso-pin-00000x1') ->> 'code',
  'incorrect_code', 'el PIN de B contra el pedido A: DENY');
select is(
  public.confirm_delivery_code('d3000000-0000-4000-8000-0000000000ea',pg_temp.rev('d3000000-0000-4000-8000-0000000000ea'),'3333','iso-pin-00000x2') ->> 'code',
  'incorrect_code', 'el PIN de C contra el pedido A: DENY');
select is(
  public.confirm_delivery_code('d3000000-0000-4000-8000-0000000000ea',pg_temp.rev('d3000000-0000-4000-8000-0000000000ea'),'1111','iso-pin-00000ok') ->> 'outcome',
  'confirmed', 'y el suyo entrega A');

-- Entregar A no toca B ni C.
select is(pg_temp.st('d3000000-0000-4000-8000-0000000000ea'), 'delivered', 'A entregado');
select is(pg_temp.st('d3000000-0000-4000-8000-0000000000eb'), 'on_the_way', 'B sigue en la calle');
select is(pg_temp.st('d3000000-0000-4000-8000-0000000000ec'), 'assigned',   'C sigue asignado');
select is(
  (select confirmed_at from public.order_delivery_handoffs where order_id='d3000000-0000-4000-8000-0000000000eb'),
  null, 'y el PIN de B sigue sin confirmar');

select * from finish();
rollback;
