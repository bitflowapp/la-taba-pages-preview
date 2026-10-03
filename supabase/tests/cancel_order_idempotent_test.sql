-- TABA · CANCELAR UN PEDIDO YA CANCELADO NO ESCRIBE UN SEGUNDO MOTIVO
--
-- `cancel_order` sobre un pedido ya cancelado, con la revisión vigente, una clave
-- nueva y otro motivo, respondía éxito y además agregaba un segundo evento
-- `business_cancel_reason` y un segundo recibo: el historial quedaba con dos
-- motivos que se contradicen. Acá se prueba que:
--
--   · la primera cancelación deja un motivo y un recibo, como siempre;
--   · reintentar con la misma clave devuelve el recibo guardado;
--   · volver a cancelar con otra clave es un no-op: ni evento, ni recibo, ni
--     revisión, lo pida el dueño o el encargado (los que pueden cancelar: el
--     empleado, sin `orders.cancel`, recibe 42501; ver authorization_matrix_test.sql);
--   · las barreras de siempre siguen: revisión vieja, motivo corto, pedido
--     rechazado, operador de otro comercio.
--
-- Todo transaccional: termina en rollback.

begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

-- ── Fixture ────────────────────────────────────────────────────────────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('a9200000-0000-4000-8000-0000000000e1','authenticated','authenticated','cancelar-owner@example.invalid','',now(),'{}','{}',now(),now()),
  ('a9200000-0000-4000-8000-0000000000e2','authenticated','authenticated','cancelar-admin@example.invalid','',now(),'{}','{}',now(),now()),
  ('a9200000-0000-4000-8000-0000000000e3','authenticated','authenticated','cancelar-vecino@example.invalid','',now(),'{}','{}',now(),now());

insert into public.businesses(id,name,status,slug,is_active)
values
  ('b9200000-0000-4000-8000-0000000000e1','TABA cancelar una vez','open','taba-cancelar-una-vez',true),
  ('b9200000-0000-4000-8000-0000000000e2','TABA vecina de cancelar','open','taba-vecina-de-cancelar',true);

insert into public.business_members(business_id,user_id,role,is_active)
values
  ('b9200000-0000-4000-8000-0000000000e1','a9200000-0000-4000-8000-0000000000e1','owner',true),
  ('b9200000-0000-4000-8000-0000000000e1','a9200000-0000-4000-8000-0000000000e2','admin',true),
  ('b9200000-0000-4000-8000-0000000000e2','a9200000-0000-4000-8000-0000000000e3','owner',true);

insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
values
  ('c9200000-0000-4000-8000-0000000000e1','a9200000-0000-4000-8000-0000000000e1','b9200000-0000-4000-8000-0000000000e1','owner','panel_web'),
  ('c9200000-0000-4000-8000-0000000000e2','a9200000-0000-4000-8000-0000000000e2','b9200000-0000-4000-8000-0000000000e1','admin','panel_web'),
  ('c9200000-0000-4000-8000-0000000000e3','a9200000-0000-4000-8000-0000000000e3','b9200000-0000-4000-8000-0000000000e2','owner','panel_web');

-- Dos pedidos de retiro en efectivo recién recibidos: el 1 se cancela, el 2 se rechaza.
insert into public.orders(
  id,business_id,code,public_code,status,fulfillment_type,delivery_mode,
  client_request_id,customer_name,customer_phone,payment_method,subtotal,delivery_fee,total)
select
  ('d9200000-0000-4000-8000-00000000000' || n)::uuid,
  'b9200000-0000-4000-8000-0000000000e1',
  'CANC-' || n, 'CANC-' || n, 'received', 'pickup', 'pickup',
  'cancelar-request-' || n, 'CLIENTE_SINTETICO_NO_CACHEAR', '+540000000000', 'cash', 1000, 0, 1000
from generate_series(1, 2) as n;

create function pg_temp.as_user(p_user uuid, p_session uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', p_session)::text, true)::void;
$$;
create function pg_temp.revision(p_order uuid) returns bigint language sql as $$
  select revision from public.orders where id = p_order;
$$;
create function pg_temp.motivos(p_order uuid) returns text[] language sql as $$
  select coalesce(array_agg(metadata ->> 'reason' order by sequence), '{}') from public.order_events
   where order_id = p_order and event_type = 'business_cancel_reason';
$$;
create function pg_temp.recibos(p_order uuid) returns integer language sql as $$
  select count(*)::integer from public.business_command_receipts
   where order_id = p_order and command_type = 'cancel_order';
$$;

-- ══ 1 · PERMISOS ════════════════════════════════════════════════════════════
select ok(
  has_function_privilege('authenticated', 'public.cancel_order(uuid, bigint, text, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.cancel_order(uuid, bigint, text, text)', 'EXECUTE'),
  'cancel_order conserva sus permisos: operadores autenticados, nunca anon');

-- ══ 2 · LA PRIMERA CANCELACIÓN ══════════════════════════════════════════════
select pg_temp.as_user('a9200000-0000-4000-8000-0000000000e1','c9200000-0000-4000-8000-0000000000e1');

select throws_ok(
  $$select public.cancel_order('d9200000-0000-4000-8000-000000000001', 1, 'no', 'cancelar-corto-0001')$$,
  '22023', 'motivo de cancelacion requerido', 'un motivo de dos letras no alcanza');

create temporary table primera on commit drop as
select public.cancel_order('d9200000-0000-4000-8000-000000000001', 1, 'cliente no retira', 'cancelar-clave-0001') as r;

select is((select r ->> 'status' from primera), 'cancelled', 'el comercio cancela el pedido');
select is((select (r ->> 'idempotent_no_op') || '/' || (r ->> 'idempotent_replay') from primera), 'false/false',
  'la primera cancelacion no es ni un no-op ni una repeticion');
select is(pg_temp.motivos('d9200000-0000-4000-8000-000000000001'), array['cliente no retira'],
  'deja un motivo');
select is(pg_temp.recibos('d9200000-0000-4000-8000-000000000001'), 1, 'y un recibo');
select is(pg_temp.revision('d9200000-0000-4000-8000-000000000001'), 2::bigint, 'la revision avanzo una vez');

-- ══ 3 · LA MISMA CLAVE DEVUELVE EL RECIBO ═══════════════════════════════════
select is(
  public.cancel_order('d9200000-0000-4000-8000-000000000001', 1, 'cliente no retira', 'cancelar-clave-0001') ->> 'idempotent_replay',
  'true', 'reintentar con la misma clave devuelve el recibo guardado');
select throws_ok(
  $$select public.cancel_order('d9200000-0000-4000-8000-000000000001', 1, 'otro motivo distinto', 'cancelar-clave-0001')$$,
  '23505', 'idempotency_key reutilizada con otro payload', 'la misma clave con otro motivo se rechaza');

-- ══ 4 · OTRA CLAVE, OTRO MOTIVO: NO-OP ══════════════════════════════════════
create temporary table segunda on commit drop as
select public.cancel_order('d9200000-0000-4000-8000-000000000001', 2, 'otro motivo distinto', 'cancelar-clave-0002') as r;

select is((select r ->> 'status' from segunda), 'cancelled', 'volver a cancelar devuelve el pedido como esta');
select is((select r ->> 'idempotent_no_op' from segunda), 'true', 'y avisa que no hizo nada');
select is(pg_temp.motivos('d9200000-0000-4000-8000-000000000001'), array['cliente no retira'],
  'el historial conserva UN motivo: el de quien cancelo');
select is(pg_temp.recibos('d9200000-0000-4000-8000-000000000001'), 1, 'no se guarda un segundo recibo');
select is(pg_temp.revision('d9200000-0000-4000-8000-000000000001'), 2::bigint, 'la revision no se movio');

-- Otro operador del mismo comercio que también puede cancelar (el encargado), misma respuesta.
select pg_temp.as_user('a9200000-0000-4000-8000-0000000000e2','c9200000-0000-4000-8000-0000000000e2');
select is(
  public.cancel_order('d9200000-0000-4000-8000-000000000001', 2, 'lo cancelo yo tambien', 'cancelar-clave-0003') ->> 'idempotent_no_op',
  'true', 'otro operador que llega tarde tambien recibe un no-op');
select is(
  public.cancel_order('d9200000-0000-4000-8000-000000000001', 2, 'lo cancelo yo tambien', 'cancelar-clave-0003') ->> 'idempotent_no_op',
  'true', 'y repetir esa llamada sigue siendo un no-op');
select is(
  pg_temp.motivos('d9200000-0000-4000-8000-000000000001') || pg_temp.recibos('d9200000-0000-4000-8000-000000000001')::text,
  array['cliente no retira', '1'], 'sigue habiendo un motivo y un recibo');

-- ══ 5 · LAS BARRERAS DE SIEMPRE ═════════════════════════════════════════════
select throws_ok(
  $$select public.cancel_order('d9200000-0000-4000-8000-000000000001', 1, 'con revision vieja', 'cancelar-clave-0004')$$,
  'PT409', null, 'una revision vieja sigue siendo un conflicto, aun sobre un pedido cancelado');

select pg_temp.as_user('a9200000-0000-4000-8000-0000000000e1','c9200000-0000-4000-8000-0000000000e1');
select is(
  public.transition_order('d9200000-0000-4000-8000-000000000002', 1, 'rejected', 'cancelar-rechazo-0002') ->> 'status',
  'rejected', 'el segundo pedido se rechaza');
select throws_ok(
  $$select public.cancel_order('d9200000-0000-4000-8000-000000000002', 2, 'ya estaba rechazado', 'cancelar-clave-0005')$$,
  '23514', null, 'un pedido rechazado no se cancela: no es un no-op, es una transicion invalida');

select pg_temp.as_user('a9200000-0000-4000-8000-0000000000e3','c9200000-0000-4000-8000-0000000000e3');
select throws_ok(
  $$select public.cancel_order('d9200000-0000-4000-8000-000000000001', 2, 'desde otro comercio', 'cancelar-clave-0006')$$,
  '42501', 'operador no autorizado', 'un operador de otro comercio sigue sin poder tocarlo');

select * from finish();
rollback;
