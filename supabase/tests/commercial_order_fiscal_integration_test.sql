-- TABA · PUENTE COMERCIAL -> FISCAL: bill_commercial_order
--
-- Regresión de la revisión cruzada (2026-09-27): bill_commercial_order es
-- SECURITY DEFINER y quedaba ejecutable por anon; con p_command_source
-- 'WHATSAPP' o 'AUTOMATION' cualquier llamador se salteaba has_business_role y
-- llegaba a service_request_fiscal_document, que sólo protege su GRANT (y el
-- GRANT no rige dentro de una función SECURITY DEFINER).
--
-- anon se verifica con has_*_privilege: un `set local role anon` seguido de
-- throws_ok tiró abajo el servidor de CI (ver alta_propuesta_comercial_test).
--
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

-- ── Fixture ────────────────────────────────────────────────────────────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('a9100000-0000-4000-8000-000000000001','authenticated','authenticated','bill-owner-a@example.invalid','',now(),'{}','{}',now(),now()),
  ('a9100000-0000-4000-8000-000000000002','authenticated','authenticated','bill-staff-a@example.invalid','',now(),'{}','{}',now(),now()),
  ('a9100000-0000-4000-8000-000000000003','authenticated','authenticated','bill-rider-a@example.invalid','',now(),'{}','{}',now(),now()),
  ('a9100000-0000-4000-8000-000000000004','authenticated','authenticated','bill-owner-b@example.invalid','',now(),'{}','{}',now(),now());

insert into public.businesses(id,name,status,slug,is_active,operating_timezone)
values
  ('b9100000-0000-4000-8000-000000000001','TABA FACTURA A','open','taba-factura-a',true,'America/Argentina/Buenos_Aires'),
  ('b9100000-0000-4000-8000-000000000002','TABA FACTURA B','open','taba-factura-b',true,'America/Argentina/Buenos_Aires');

insert into public.business_members(business_id,user_id,role,is_active)
values
  ('b9100000-0000-4000-8000-000000000001','a9100000-0000-4000-8000-000000000001','owner',true),
  ('b9100000-0000-4000-8000-000000000001','a9100000-0000-4000-8000-000000000002','staff',true),
  ('b9100000-0000-4000-8000-000000000001','a9100000-0000-4000-8000-000000000003','rider',true),
  ('b9100000-0000-4000-8000-000000000002','a9100000-0000-4000-8000-000000000004','owner',true);

insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
values
  ('c9100000-0000-4000-8000-000000000001','a9100000-0000-4000-8000-000000000001','b9100000-0000-4000-8000-000000000001','owner','panel_web'),
  ('c9100000-0000-4000-8000-000000000002','a9100000-0000-4000-8000-000000000002','b9100000-0000-4000-8000-000000000001','staff','panel_web'),
  ('c9100000-0000-4000-8000-000000000003','a9100000-0000-4000-8000-000000000003','b9100000-0000-4000-8000-000000000001','rider','rider_android'),
  ('c9100000-0000-4000-8000-000000000004','a9100000-0000-4000-8000-000000000004','b9100000-0000-4000-8000-000000000002','owner','panel_web');

insert into public.orders(
  id,business_id,code,public_code,status,fulfillment_type,delivery_mode,
  client_request_id,customer_name,customer_neighborhood,customer_street_address,
  customer_phone,payment_method,subtotal,delivery_fee,total
) values (
  'd9100000-0000-4000-8000-000000000001','b9100000-0000-4000-8000-000000000001','BILL-1','BILL-1','submitted','pickup','pickup',
  'bill-request-0001','CLIENTE_SINTETICO','Centro','Mendoza 1','+540000000000','cash',2500,0,2500
);
insert into public.order_items(order_id,product_id,name,quantity,unit,unit_price,subtotal)
values ('d9100000-0000-4000-8000-000000000001','sku-bill','Producto sintetico',2,'u',1250,2500);

-- ══ 1 · SUPERFICIE ═══════════════════════════════════════════════════════════
select ok(not has_function_privilege('anon', 'public.bill_commercial_order(uuid,text,text,boolean)', 'EXECUTE'),
  'anon no ejecuta bill_commercial_order');
select ok(not has_function_privilege('anon', 'public.create_whatsapp_pairing_code(uuid)', 'EXECUTE'),
  'anon no ejecuta create_whatsapp_pairing_code');
select ok(has_function_privilege('authenticated', 'public.bill_commercial_order(uuid,text,text,boolean)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.bill_commercial_order(uuid,text,text,boolean)', 'EXECUTE'),
  'el Panel (authenticated) y el servidor (service_role) conservan bill_commercial_order');

-- ══ 2 · UN OPERADOR NO SE DECLARA CANAL DE SERVIDOR ══════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9100000-0000-4000-8000-000000000002","role":"authenticated","session_id":"c9100000-0000-4000-8000-000000000002"}';
select throws_ok(
  $$select public.bill_commercial_order('d9100000-0000-4000-8000-000000000001', null, 'WHATSAPP', false)$$,
  '42501', 'canal de servidor no autorizado', 'el cajero no puede facturar como WHATSAPP');
select throws_ok(
  $$select public.bill_commercial_order('d9100000-0000-4000-8000-000000000001', null, 'AUTOMATION', false)$$,
  '42501', 'canal de servidor no autorizado', 'el cajero no puede facturar como AUTOMATION');
select throws_ok(
  $$select public.bill_commercial_order('00000000-0000-4000-8000-000000000999', null, 'AUTOMATION', false)$$,
  '42501', 'canal de servidor no autorizado', 'un canal de servidor falso se rechaza antes de revelar si el pedido existe');
select throws_ok(
  $$select public.bill_commercial_order('d9100000-0000-4000-8000-000000000001', null, 'SMS', false)$$,
  '22023', 'canal comercial no reconocido', 'un canal inventado es 22023');

-- ══ 3 · EL PANEL SIGUE ATADO AL NEGOCIO Y AL ROL ═════════════════════════════
set local request.jwt.claims = '{"sub":"a9100000-0000-4000-8000-000000000004","role":"authenticated","session_id":"c9100000-0000-4000-8000-000000000004"}';
select throws_ok(
  $$select public.bill_commercial_order('d9100000-0000-4000-8000-000000000001', null, 'PANEL', false)$$,
  '42501', 'operador no autorizado', 'el dueno de OTRO negocio no factura este pedido');
set local request.jwt.claims = '{"sub":"a9100000-0000-4000-8000-000000000003","role":"authenticated","session_id":"c9100000-0000-4000-8000-000000000003"}';
select throws_ok(
  $$select public.bill_commercial_order('d9100000-0000-4000-8000-000000000001', null, 'PANEL', false)$$,
  '42501', 'operador no autorizado', 'el repartidor no factura');

-- ══ 4 · service_role SÍ entra por el canal de servidor ══════════════════════
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(
  $$select public.bill_commercial_order('00000000-0000-4000-8000-000000000999', null, 'WHATSAPP', false)$$,
  'P0002', 'pedido no encontrado', 'service_role pasa la compuerta de canal (y el pedido inexistente sigue siendo P0002)');

set local role postgres;
select is((select count(*)::integer from public.pos_sales where idempotency_key = 'order-sale:d9100000-0000-4000-8000-000000000001'),
  0, 'ningun intento rechazado dejo una venta POS sintetica');

select * from finish();
rollback;
