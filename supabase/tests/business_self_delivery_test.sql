-- TABA · EL COMERCIO CIERRA SU PROPIA ENTREGA
--
-- Lo que esta suite tiene que demostrar son dos cosas opuestas a la vez:
--
--   1. que un comercio SIN repartidor puede despachar y entregar su delivery
--      desde el Panel, con CAS por revision y con huella en `order_events`;
--   2. que eso NO abrio la puerta que el codigo de entrega cierra: un pedido
--      que lleva un repartidor sigue necesitando el codigo del cliente, y
--      ningun otro actor puede cerrarlo por el.
--
-- La segunda es la que importa. Habilitar una transicion es facil; lo dificil
-- es demostrar que la habilitacion no toco lo que protegia a otro.
--
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

-- ── Fixture ────────────────────────────────────────────────────────────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('a5000000-0000-4000-8000-0000000000e1','authenticated','authenticated','self-owner@example.invalid','',now(),'{}','{"display_name":"Walter"}',now(),now()),
  ('a5000000-0000-4000-8000-0000000000e2','authenticated','authenticated','self-rider@example.invalid','',now(),'{}','{"display_name":"Marco"}',now(),now()),
  ('a5000000-0000-4000-8000-0000000000e3','authenticated','authenticated','self-ajeno@example.invalid','',now(),'{}','{"display_name":"Ajeno"}',now(),now()),
  ('a5000000-0000-4000-8000-0000000000e4','authenticated','authenticated','self-otro-duenio@example.invalid','',now(),'{}','{"display_name":"Otro"}',now(),now());

-- El huso lo declara el NEGOCIO: es de donde sale el dia comercial desde
-- 20260814020000, y ahora tambien el recuento de cerrados.
insert into public.businesses(id,name,status,slug,is_active,operating_timezone)
values
  ('b5000000-0000-4000-8000-0000000000e1','TABA reparto propio','open','taba-reparto-propio',true,'America/Argentina/Buenos_Aires'),
  ('b5000000-0000-4000-8000-0000000000e2','TABA vecina','open','taba-vecina',true,'America/Argentina/Buenos_Aires'),
  -- Un tercero SIN huso: el recuento tiene que fallar cerrado, no inventar UTC.
  ('b5000000-0000-4000-8000-0000000000e3','TABA sin huso','open','taba-sin-huso',true,null);

insert into public.business_members(business_id,user_id,role,is_active)
values ('b5000000-0000-4000-8000-0000000000e3','a5000000-0000-4000-8000-0000000000e1','owner',true);

insert into public.business_members(business_id,user_id,role,is_active)
values
  ('b5000000-0000-4000-8000-0000000000e1','a5000000-0000-4000-8000-0000000000e1','owner',true),
  ('b5000000-0000-4000-8000-0000000000e1','a5000000-0000-4000-8000-0000000000e2','rider',true),
  ('b5000000-0000-4000-8000-0000000000e2','a5000000-0000-4000-8000-0000000000e4','owner',true);
-- `a5…e3` no es miembro de ningun comercio: es el actor sin autorizacion.

insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
values
  ('c5000000-0000-4000-8000-0000000000e1','a5000000-0000-4000-8000-0000000000e1','b5000000-0000-4000-8000-0000000000e1','owner','panel_web'),
  ('c5000000-0000-4000-8000-0000000000e2','a5000000-0000-4000-8000-0000000000e2','b5000000-0000-4000-8000-0000000000e1','rider','rider_android'),
  ('c5000000-0000-4000-8000-0000000000e4','a5000000-0000-4000-8000-0000000000e4','b5000000-0000-4000-8000-0000000000e2','owner','panel_web');

-- Cuatro pedidos de delivery listos. El 1 lo despacha el comercio; el 2 lo
-- lleva un repartidor; el 3 y el 4 son para los casos de error.
insert into public.orders(
  id,business_id,code,public_code,status,fulfillment_type,delivery_mode,
  client_request_id,customer_name,customer_neighborhood,customer_street_address,
  customer_phone,payment_method,subtotal,delivery_fee,total
)
select
  ('d5000000-0000-4000-8000-00000000000' || n)::uuid,
  'b5000000-0000-4000-8000-0000000000e1',
  'SELF-' || n, 'SELF-' || n, 'ready', 'delivery', 'delivery',
  'self-request-' || n, 'CLIENTE_SINTETICO_NO_CACHEAR', 'Centro', 'Mendoza ' || n,
  '+540000000000', 'cash', 1000, 0, 1000
from generate_series(1, 4) as n;

create or replace function pg_temp.as_user(p_user uuid, p_session uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', p_session)::text, true)::void;
$$;
create or replace function pg_temp.sin_sesion() returns void language sql as $$
  select set_config('request.jwt.claims', '', true)::void;
$$;
create or replace function pg_temp.estado(p_order uuid) returns text language sql as $$
  select status from public.orders where id = p_order;
$$;
create or replace function pg_temp.revision(p_order uuid) returns bigint language sql as $$
  select revision from public.orders where id = p_order;
$$;

-- ══ 1 · EL COMERCIO DESPACHA Y ENTREGA LO SUYO ══════════════════════════════
select pg_temp.as_user('a5000000-0000-4000-8000-0000000000e1','c5000000-0000-4000-8000-0000000000e1');

-- BUSINESS_DELIVERY_READY_TO_ON_THE_WAY
select is(
  public.transition_order('d5000000-0000-4000-8000-000000000001', pg_temp.revision('d5000000-0000-4000-8000-000000000001'),
                          'on_the_way', 'self-dispatch-0001') ->> 'status',
  'on_the_way', 'el comercio despacha su propio delivery: ready -> on_the_way');
select is(pg_temp.estado('d5000000-0000-4000-8000-000000000001'), 'on_the_way',
  'y el estado quedo escrito en la fila, no solo en la respuesta');
select is(pg_temp.revision('d5000000-0000-4000-8000-000000000001'), 2::bigint,
  'la revision avanzo: el CAS del proximo comando parte de la nueva');

-- BUSINESS_DELIVERY_ON_THE_WAY_TO_DELIVERED
--
-- La cierra CON EL CODIGO DEL CLIENTE. `orders.delivery_code_required` es NOT
-- NULL con default true, asi que `prevent_unverified_delivery` corta cualquier
-- entrega de delivery sin un handoff confirmado, sin importar quien la haga. El
-- codigo protege al CLIENTE: quien lleve el pedido no cambia que haya que
-- probar que llego.
select throws_ok(
  $$select public.transition_order('d5000000-0000-4000-8000-000000000001', 2, 'delivered', 'self-sincod-0001')$$,
  '55000', 'codigo de entrega no confirmado',
  'sin el codigo del cliente, el comercio tampoco cierra la entrega');

-- El codigo que el cliente recibio al confirmar el pedido.
insert into public.order_delivery_handoffs(order_id, code_hash, code_ciphertext, expires_at)
values ('d5000000-0000-4000-8000-000000000001',
        crypt('4417', gen_salt('bf', 10)),
        pgp_sym_encrypt('4417', 'clave-de-prueba', 'cipher-algo=aes256,compress-algo=0'),
        now() + interval '2 hours');

select is(
  public.confirm_business_delivery_code('d5000000-0000-4000-8000-000000000001', 2, '0000', 'self-malcod-0001') ->> 'code',
  'incorrect_code', 'un codigo equivocado no entrega nada');
select is(
  (select failed_attempts from public.order_delivery_handoffs where order_id='d5000000-0000-4000-8000-000000000001'),
  1, 'y el intento queda contado en la MISMA fila que usa el Rider: no hay segunda ventana');
select is(pg_temp.estado('d5000000-0000-4000-8000-000000000001'), 'on_the_way',
  'el pedido sigue en reparto');

select is(
  public.confirm_business_delivery_code('d5000000-0000-4000-8000-000000000001', 2, '4417', 'self-deliver-0001') ->> 'outcome',
  'confirmed', 'con el codigo bueno, la entrega se cierra');
select is(pg_temp.estado('d5000000-0000-4000-8000-000000000001'), 'delivered',
  'y la cierra: on_the_way -> delivered');
select is(
  public.confirm_business_delivery_code('d5000000-0000-4000-8000-000000000001', 2, '4417', 'self-deliver-0001') ->> 'idempotent_replay',
  'true', 'repetir el comando devuelve el recibo, no gasta otro intento');
select ok(
  (select delivered_at is not null from public.orders where id='d5000000-0000-4000-8000-000000000001'),
  'delivered_at lo puso el trigger de siempre: el cierre del dia lo ve igual');

-- ORDER_EVENT_WRITTEN · la huella generica y la especifica
select is(
  (select actor_role from public.order_events
    where order_id='d5000000-0000-4000-8000-000000000001' and event_type='order.status_changed'
      and metadata->>'next_status'='delivered'),
  'business', 'el cambio de estado quedo registrado con el actor que lo hizo');
select is(
  (select count(*)::integer from public.order_events
    where order_id='d5000000-0000-4000-8000-000000000001' and event_type='order.business_self_delivery'),
  1, 'y queda dicho aparte que la entrega la cerro el comercio');
select is(
  (select metadata->>'code_verified' from public.order_events
    where order_id='d5000000-0000-4000-8000-000000000001' and event_type='order.business_self_delivery'),
  'true', 'y el evento dice que esa entrega SI tiene la prueba del codigo');
select is(
  (select actor_user_id from public.order_events
    where order_id='d5000000-0000-4000-8000-000000000001' and event_type='order.business_self_delivery'),
  'a5000000-0000-4000-8000-0000000000e1'::uuid, 'con la persona que la cerro');

-- REVISION_CONFLICT
select throws_ok(
  $$select public.transition_order('d5000000-0000-4000-8000-000000000003', 99, 'on_the_way', 'self-stale-0001')$$,
  '40001', null,
  'una revision vieja se rechaza sin aplicar nada');
select is(pg_temp.estado('d5000000-0000-4000-8000-000000000003'), 'ready',
  'y el pedido quedo donde estaba');

-- ══ 2 · LO QUE LLEVA UN REPARTIDOR SIGUE SIENDO SUYO ════════════════════════
-- El comercio asigna el pedido 2. Desde ese momento no puede cerrarlo el.
select public.assign_order_rider('d5000000-0000-4000-8000-000000000002','ready',null,
                                 'a5000000-0000-4000-8000-0000000000e2');
select is(pg_temp.estado('d5000000-0000-4000-8000-000000000002'), 'assigned',
  'el comercio asigna un repartidor: el flujo de siempre no cambio');

select throws_ok(
  format($$select public.transition_order('d5000000-0000-4000-8000-000000000002', %s, 'delivered', 'self-steal-00001')$$,
         pg_temp.revision('d5000000-0000-4000-8000-000000000002')),
  '23514', null,
  'con repartidor asignado, el comercio NO puede declararlo entregado');

-- El guard simetrico, probado por el camino que no pasa por la matriz: un
-- UPDATE crudo. Es la defensa que sobrevive a que alguien edite el `or`.
select throws_ok(
  $$update public.orders set status='delivered' where id='d5000000-0000-4000-8000-000000000002'$$,
  '42501', 'la entrega la confirma el repartidor asignado con el codigo del cliente',
  'ni escribiendo la fila directamente: el guard corta igual');
select is(pg_temp.estado('d5000000-0000-4000-8000-000000000002'), 'assigned',
  'el pedido del repartidor quedo intacto');
-- Ni por la puerta nueva: el cierre del comercio se niega a tocar un pedido que
-- lleva un repartidor, aunque le pasaran el codigo correcto.
select throws_ok(
  format($$select public.confirm_business_delivery_code('d5000000-0000-4000-8000-000000000002', %s, '4417', 'self-robo-000001')$$,
         pg_temp.revision('d5000000-0000-4000-8000-000000000002')),
  '42501', 'la entrega la confirma el repartidor asignado',
  'el cierre del comercio no sirve para entregar lo que lleva un rider');

-- RIDER_FLOW_STILL_WORKS
select pg_temp.as_user('a5000000-0000-4000-8000-0000000000e2','c5000000-0000-4000-8000-0000000000e2');
select is(
  public.transition_order('d5000000-0000-4000-8000-000000000002',
                          pg_temp.revision('d5000000-0000-4000-8000-000000000002'), 'picked_up') ->> 'status',
  'picked_up', 'el repartidor sigue avanzando su cadena como siempre');
-- Y sigue necesitando el codigo para cerrarla.
select lives_ok(
  format($$select public.transition_order('d5000000-0000-4000-8000-000000000002', %s, 'on_the_way')$$,
         pg_temp.revision('d5000000-0000-4000-8000-000000000002')),
  'y la sigue recorriendo entera: picked_up -> on_the_way');

-- ══ 3 · AUTORIZACION ════════════════════════════════════════════════════════
-- UNAUTHORIZED_ROLE_REJECTED
select pg_temp.as_user('a5000000-0000-4000-8000-0000000000e3','c5000000-0000-4000-8000-0000000000e1');
select throws_ok(
  $$select public.transition_order('d5000000-0000-4000-8000-000000000004', 1, 'on_the_way', 'self-nadie-00001')$$,
  '42501', null,
  'quien no es del comercio no despacha nada');
select throws_ok(
  $$select public.confirm_business_delivery_code('d5000000-0000-4000-8000-000000000004', 1, '4417', 'self-nadie-00002')$$,
  '42501', 'operador no autorizado',
  'ni cierra una entrega ajena con un codigo adivinado');

-- MINIMO PRIVILEGIO / ANON RECHAZADO
select ok(not has_function_privilege('anon', 'public.confirm_business_delivery_code(uuid,bigint,text,text)', 'EXECUTE'),
  'anon no ejecuta confirm_business_delivery_code');
select ok(not has_function_privilege('anon', 'public.get_business_finished_today(uuid,text,date)', 'EXECUTE'),
  'anon no ejecuta get_business_finished_today');
select ok(not has_function_privilege('anon', 'public.change_order_status(uuid,text,text)', 'EXECUTE'),
  'anon no ejecuta change_order_status');
select ok(not has_function_privilege('anon', 'public.prevent_business_delivery_over_rider()', 'EXECUTE'),
  'anon no ejecuta prevent_business_delivery_over_rider');
select ok(not has_function_privilege('anon', 'public.record_business_self_delivery()', 'EXECUTE'),
  'anon no ejecuta record_business_self_delivery');

select pg_temp.sin_sesion();
select throws_ok(
  $$select public.confirm_business_delivery_code('d5000000-0000-4000-8000-000000000004', 1, '4417', 'self-anon-00001')$$,
  '42501', null,
  'anon no puede confirmar entrega');
select throws_ok(
  $$select public.get_business_finished_today('b5000000-0000-4000-8000-0000000000e1', null)$$,
  '42501', null,
  'anon no puede contar finalizados del negocio');

-- ══ 4 · FINALIZADOS HOY, CONTADO POR EL SERVIDOR ════════════════════════════
-- Un pedido cancelado hoy y uno entregado AYER, insertados con su `updated_at`
-- (el trigger solo lo pisa en UPDATE, no en INSERT).
insert into public.orders(
  id,business_id,code,public_code,status,fulfillment_type,delivery_mode,
  client_request_id,customer_name,customer_neighborhood,customer_street_address,
  customer_phone,payment_method,subtotal,delivery_fee,total,updated_at
) values
  ('d5000000-0000-4000-8000-000000000011','b5000000-0000-4000-8000-0000000000e1','SELF-11','SELF-11','cancelled','delivery','delivery',
   'self-request-11','CLIENTE_SINTETICO_NO_CACHEAR','Centro','Mendoza 11','+540000000000','cash',1000,0,1000, now()),
  ('d5000000-0000-4000-8000-000000000012','b5000000-0000-4000-8000-0000000000e1','SELF-12','SELF-12','delivered','delivery','delivery',
   'self-request-12','CLIENTE_SINTETICO_NO_CACHEAR','Centro','Mendoza 12','+540000000000','cash',1000,0,1000, now() - interval '3 days'),
  -- De otro comercio, entregado hoy: no puede sumar.
  ('d5000000-0000-4000-8000-000000000013','b5000000-0000-4000-8000-0000000000e2','SELF-13','SELF-13','delivered','delivery','delivery',
   'self-request-13','CLIENTE_SINTETICO_NO_CACHEAR','Centro','Roca 13','+540000000000','cash',1000,0,1000, now());

select pg_temp.as_user('a5000000-0000-4000-8000-0000000000e1','c5000000-0000-4000-8000-0000000000e1');

-- FINISHED_TODAY_SERVER_COUNT
select is(
  (public.get_business_finished_today('b5000000-0000-4000-8000-0000000000e1', null) ->> 'delivered')::integer,
  1, 'cuenta el entregado de hoy y no el de anteayer');
select is(
  (public.get_business_finished_today('b5000000-0000-4000-8000-0000000000e1', null) ->> 'cancelled')::integer,
  1, 'y separa los cancelados en vez de sumarlos como si fueran lo mismo');
select is(
  public.get_business_finished_today('b5000000-0000-4000-8000-0000000000e1', null) ->> 'timezone',
  'America/Argentina/Buenos_Aires', 'y declara con que huso conto, que es el del negocio');
select throws_ok(
  $$select public.get_business_finished_today('b5000000-0000-4000-8000-0000000000e2', null)$$,
  '42501', 'operador no autorizado',
  'el comercio vecino no ve el pedido del otro, ni al reves');

-- El cliente NO decide el dia comercial. Pedir otra zona no lo corre: se
-- rechaza, porque devolverle el dia del comercio como si fuera el suyo seria
-- contestar una pregunta distinta de la que hizo.
select throws_ok(
  $$select public.get_business_finished_today('b5000000-0000-4000-8000-0000000000e1','UTC')$$,
  '22023', 'la zona pedida no es la del negocio',
  'el dia comercial no se negocia con el cliente, ni siquiera con una zona real');
-- Y sin huso configurado falla cerrado en vez de suponer uno.
select throws_ok(
  $$select public.get_business_finished_today('b5000000-0000-4000-8000-0000000000e3', null)$$,
  '55000', null,
  'un negocio sin huso no recibe un numero inventado');

select pg_temp.as_user('a5000000-0000-4000-8000-0000000000e3','c5000000-0000-4000-8000-0000000000e1');
select throws_ok(
  $$select public.get_business_finished_today('b5000000-0000-4000-8000-0000000000e1', null)$$,
  '42501', 'operador no autorizado',
  'y quien no es del comercio no cuenta sus pedidos');

select * from finish();
rollback;
