-- TABA2 · Rider multi-pedido · SEGURIDAD Y PRIVACIDAD DE LA OFERTA
--
-- Dos preguntas, y las dos tienen que contestarse del lado del servidor:
--
--   1. ¿Puede un Rider responder una oferta que no es suya, o de otro comercio,
--      o con una sesión revocada, o adulterando el id? (BOLA)
--   2. Antes de aceptar, ¿qué llega a ver? Ésta es la que justifica que la
--      oferta sea una fila aparte: mientras el pedido no lo nombra, el Rider no
--      pasa `can_access_order` y NO PUEDE leer la calle, el teléfono ni las
--      notas ni aunque consulte la tabla directamente.
--
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

-- ── Fixture: dos comercios ─────────────────────────────────────────────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('a2000000-0000-4000-8000-0000000000d1','authenticated','authenticated','sec-staff1@example.invalid','',now(),'{}','{"display_name":"Staff Uno"}',now(),now()),
  ('a2000000-0000-4000-8000-0000000000d2','authenticated','authenticated','sec-rider1@example.invalid','',now(),'{}','{"display_name":"Marco"}',now(),now()),
  ('a2000000-0000-4000-8000-0000000000d3','authenticated','authenticated','sec-rider2@example.invalid','',now(),'{}','{"display_name":"Ana"}',now(),now()),
  ('a2000000-0000-4000-8000-0000000000d4','authenticated','authenticated','sec-staff-b2@example.invalid','',now(),'{}','{"display_name":"Staff Ajeno"}',now(),now()),
  ('a2000000-0000-4000-8000-0000000000d5','authenticated','authenticated','sec-rider-b2@example.invalid','',now(),'{}','{"display_name":"Rider Ajeno"}',now(),now());

insert into public.businesses(id,name,status,slug,is_active)
values
  ('b2000000-0000-4000-8000-0000000000d1','TABA seguridad','open','taba-seguridad',true),
  ('b2000000-0000-4000-8000-0000000000d2','Comercio ajeno','open','comercio-ajeno',true);

insert into public.business_members(business_id,user_id,role,is_active)
values
  ('b2000000-0000-4000-8000-0000000000d1','a2000000-0000-4000-8000-0000000000d1','staff',true),
  ('b2000000-0000-4000-8000-0000000000d1','a2000000-0000-4000-8000-0000000000d2','rider',true),
  ('b2000000-0000-4000-8000-0000000000d1','a2000000-0000-4000-8000-0000000000d3','rider',true),
  ('b2000000-0000-4000-8000-0000000000d2','a2000000-0000-4000-8000-0000000000d4','staff',true),
  ('b2000000-0000-4000-8000-0000000000d2','a2000000-0000-4000-8000-0000000000d5','rider',true);

insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
values
  ('c2000000-0000-4000-8000-0000000000d1','a2000000-0000-4000-8000-0000000000d1','b2000000-0000-4000-8000-0000000000d1','staff','panel_web'),
  ('c2000000-0000-4000-8000-0000000000d2','a2000000-0000-4000-8000-0000000000d2','b2000000-0000-4000-8000-0000000000d1','rider','rider_android'),
  ('c2000000-0000-4000-8000-0000000000d3','a2000000-0000-4000-8000-0000000000d3','b2000000-0000-4000-8000-0000000000d1','rider','rider_android'),
  ('c2000000-0000-4000-8000-0000000000d4','a2000000-0000-4000-8000-0000000000d4','b2000000-0000-4000-8000-0000000000d2','staff','panel_web'),
  ('c2000000-0000-4000-8000-0000000000d5','a2000000-0000-4000-8000-0000000000d5','b2000000-0000-4000-8000-0000000000d2','rider','rider_android');

insert into public.orders(
  id,business_id,code,public_code,status,fulfillment_type,delivery_mode,
  client_request_id,customer_name,customer_neighborhood,customer_street_address,
  customer_reference,customer_phone,customer_notes,payment_method,subtotal,delivery_fee,total
) values
  ('d2000000-0000-4000-8000-0000000000d1','b2000000-0000-4000-8000-0000000000d1','SEC-1','SEC-1','ready','delivery','delivery',
   'sec-request-1','Roberto Gomez','Centro','Mendoza 827 piso 3 dpto B','Porton negro','+5492996209136',
   'Timbre roto, golpear fuerte','cash',1000,0,1000),
  ('d2000000-0000-4000-8000-0000000000d2','b2000000-0000-4000-8000-0000000000d2','SEC-2','SEC-2','ready','delivery','delivery',
   'sec-request-2','Cliente Ajeno','Otra zona','Calle Ajena 1','ref','+540000000000','notas','cash',1000,0,1000);

create or replace function pg_temp.as_user(p_user text, p_session text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', p_session)::text, true)::void;
$$;

-- ── La oferta nace ─────────────────────────────────────────────────────────
select pg_temp.as_user('a2000000-0000-4000-8000-0000000000d1','c2000000-0000-4000-8000-0000000000d1');
select is(
  public.offer_order_to_rider('d2000000-0000-4000-8000-0000000000d1','ready',null,'a2000000-0000-4000-8000-0000000000d2') ->> 'code',
  'offered', 'el staff del comercio ofrece a su rider');

-- ══ PRIVACIDAD PREVIA A LA ACEPTACION ══════════════════════════════════════
-- La proyeccion de la oferta: lo justo para decidir.
select pg_temp.as_user('a2000000-0000-4000-8000-0000000000d2','c2000000-0000-4000-8000-0000000000d2');

select is(
  (public.get_rider_delivery_board() -> 'offers' -> 0 ->> 'delivery_summary'),
  'Centro', 'la oferta dice la ZONA');
select is(
  (public.get_rider_delivery_board() -> 'offers' -> 0 ->> 'collection_amount')::numeric,
  1000::numeric, 'y el monto a cobrar, que es informacion operativa que necesita');

-- Lo que NO lleva. Se comprueba sobre el texto entero del payload, no campo por
-- campo: asi un campo nuevo que arrastre PII rompe esta prueba en vez de pasar
-- desapercibido.
select ok(
  (public.get_rider_delivery_board() -> 'offers' -> 0)::text not like '%2996209136%',
  'la oferta NO lleva el telefono del cliente');
select ok(
  (public.get_rider_delivery_board() -> 'offers' -> 0)::text not like '%Mendoza 827%',
  'la oferta NO lleva la calle y la altura');
select ok(
  (public.get_rider_delivery_board() -> 'offers' -> 0)::text not like '%Timbre roto%',
  'la oferta NO lleva las notas privadas');
select ok(
  (public.get_rider_delivery_board() -> 'offers' -> 0)::text not like '%Roberto Gomez%',
  'la oferta NO lleva el nombre del cliente');
select ok(
  (public.get_rider_delivery_board() -> 'offers' -> 0)::text not like '%Porton negro%',
  'la oferta NO lleva la referencia del domicilio');

-- Y no es que la proyeccion los oculte: es que el Rider no puede llegar a
-- ellos. Esta es la razon por la que el pedido no lo nombra todavia.
set local role authenticated;
select is(
  (select count(*)::integer from public.orders where id='d2000000-0000-4000-8000-0000000000d1'),
  0, 'con la oferta viva el Rider NO puede leer el pedido: RLS no lo deja');
-- Mas fuerte que «devuelve cero filas»: la tabla no tiene grants, asi que la
-- consulta ni siquiera se planifica.
select throws_ok(
  $$select count(*) from public.rider_order_offers$$,
  '42501', null,
  'ni la tabla de ofertas: sin grants y sin policies, no se llega');
reset role;

-- Despues de aceptar, el contrato autorizado de siempre.
select pg_temp.as_user('a2000000-0000-4000-8000-0000000000d2','c2000000-0000-4000-8000-0000000000d2');
select is(
  public.accept_rider_order_offer(
    (select id from public.rider_order_offers where order_id='d2000000-0000-4000-8000-0000000000d1'),
    1,'sec-acc-0000001') ->> 'code',
  'accepted', 'el rider acepta');
select ok(
  (public.get_rider_delivery_board() -> 'orders' -> 0)::text like '%Mendoza 827%',
  'recien despues de aceptar aparece la direccion exacta');
set local role authenticated;
select is(
  (select count(*)::integer from public.orders where id='d2000000-0000-4000-8000-0000000000d1'),
  1, 'y recien ahora RLS lo deja leer el pedido');
reset role;

-- ══ BOLA ═══════════════════════════════════════════════════════════════════
-- El pedido 1 ya esta aceptado. Las pruebas cruzadas usan una oferta viva del
-- OTRO comercio, que es el caso que interesa.
select pg_temp.as_user('a2000000-0000-4000-8000-0000000000d4','c2000000-0000-4000-8000-0000000000d4');
select public.offer_order_to_rider('d2000000-0000-4000-8000-0000000000d2','ready',null,'a2000000-0000-4000-8000-0000000000d5');

select pg_temp.as_user('a2000000-0000-4000-8000-0000000000d2','c2000000-0000-4000-8000-0000000000d2');
select throws_ok(
  format($$select public.accept_rider_order_offer(%L::uuid, 1, 'sec-acc-cross01')$$,
         (select id from public.rider_order_offers where order_id='d2000000-0000-4000-8000-0000000000d2')),
  'P0002', null,
  'un Rider no puede aceptar la oferta de otro: es indistinguible de una inexistente');
select throws_ok(
  format($$select public.reject_rider_order_offer(%L::uuid, 1, 'too_far', 'sec-rej-cross01')$$,
         (select id from public.rider_order_offers where order_id='d2000000-0000-4000-8000-0000000000d2')),
  'P0002', null,
  'ni rechazarla');
select is(
  (select status from public.rider_order_offers where order_id='d2000000-0000-4000-8000-0000000000d2'),
  'pending', 'la oferta ajena quedo intacta');

-- Id inventado.
select throws_ok(
  $$select public.accept_rider_order_offer('00000000-0000-4000-8000-000000000000'::uuid, 1, 'sec-acc-bogus1')$$,
  'P0002', null, 'un offer_id inventado responde igual que uno ajeno');

-- Staff de otro comercio sobre un pedido que no es suyo.
select pg_temp.as_user('a2000000-0000-4000-8000-0000000000d4','c2000000-0000-4000-8000-0000000000d4');
select throws_ok(
  $$select public.offer_order_to_rider('d2000000-0000-4000-8000-0000000000d1','ready',null,'a2000000-0000-4000-8000-0000000000d5')$$,
  '42501', 'rol de negocio requerido',
  'el staff de otro comercio no puede ofrecer un pedido ajeno');
select throws_ok(
  $$select public.list_rider_order_offers('b2000000-0000-4000-8000-0000000000d1')$$,
  '42501', 'rol de negocio requerido',
  'ni leer las ofertas del comercio ajeno');

-- Ofrecer a alguien que no es rider de ese comercio.
select pg_temp.as_user('a2000000-0000-4000-8000-0000000000d1','c2000000-0000-4000-8000-0000000000d1');
select throws_ok(
  $$select public.offer_order_to_rider('d2000000-0000-4000-8000-0000000000d1','ready',null,'a2000000-0000-4000-8000-0000000000d5')$$,
  '42501', null,
  'un rider_user_id adulterado, de otro comercio, se rechaza');

-- ══ SESION ═════════════════════════════════════════════════════════════════
-- Sesion revocada: el token sigue firmado y vigente, y aun asi no autoriza.
update public.identity_sessions
   set revoked_at = clock_timestamp(), revoked_reason = 'owner_revoked'
 where session_id = 'c2000000-0000-4000-8000-0000000000d3';
select pg_temp.as_user('a2000000-0000-4000-8000-0000000000d3','c2000000-0000-4000-8000-0000000000d3');
select throws_ok(
  $$select public.get_rider_delivery_board()$$,
  '42501', 'membership rider activa requerida',
  'una sesion revocada no lee el board');

-- Token sin session_id: no registrada, mismo resultado.
select set_config('request.jwt.claims',
  '{"sub":"a2000000-0000-4000-8000-0000000000d2","role":"authenticated"}', true)::void;
select throws_ok(
  $$select public.get_rider_delivery_board()$$,
  '42501', 'membership rider activa requerida',
  'un token sin sesion registrada tampoco');

-- Sin token.
select set_config('request.jwt.claims','',true)::void;
select throws_ok(
  $$select public.get_rider_delivery_board()$$,
  '42501', 'autenticacion requerida',
  'sin autenticacion no hay board');

-- ══ GRANTS ═════════════════════════════════════════════════════════════════
select ok(
  not has_function_privilege('anon', 'public.accept_rider_order_offer(uuid,bigint,text)', 'execute'),
  'anon no puede ejecutar la aceptacion');
select ok(
  not has_function_privilege('anon', 'public.offer_order_to_rider(uuid,text,uuid,uuid)', 'execute'),
  'anon no puede ejecutar la oferta');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.rider_order_offers'::regclass),
  'la tabla de ofertas tiene RLS activa');
select is(
  (select count(*)::integer from pg_policies where schemaname='public' and tablename='rider_order_offers'),
  0, 'y cero policies: solo se llega por las RPC SECURITY DEFINER');

select * from finish();
rollback;
