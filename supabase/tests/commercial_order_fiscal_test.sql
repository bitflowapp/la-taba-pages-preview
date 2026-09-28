-- LA TABA · FACTURAR PEDIDOS ONLINE CON EL CORE FISCAL (esquema REAL)
--
-- online_order <> pos_sale: el pedido se factura como pedido, con su pago REAL, bajo una
-- politica contable DECLARADA y con la clasificacion de cada producto. Esta suite fija:
--   1. una sola evaluacion con razones estructuradas (fail closed, sin defaults);
--   2. el origen congelado: lineas al centavo, IVA por alicuota, 0,5 kg, descuento
--      prorrateado, envio como linea o excluido con motivo, producto legado o por uuid;
--   3. la factura nace del pedido (no hay venta POS), converge por intencion y registra
--      actor y canal reales;
--   4. canales de servidor con sus guardas; aislamiento entre negocios;
--   5. facturar e imprimir: pedido durable, un solo primer ticket al autorizar, y la
--      reimpresion real (nuevo trabajo con reprint_of, sin pedir otro CAE).
--
-- La politica y los importes son FIXTURES SINTETICOS de prueba: no son la politica contable
-- de ningun comercio. La autorizacion de la seccion 5 es SIMULADA (CAE de prueba).
-- Todo transaccional: termina en rollback.

begin;
create extension if not exists pgtap with schema extensions;
select plan(54);

-- ── Fixture ─────────────────────────────────────────────────────────────────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
  ('a6000000-0000-4000-8000-000000000001','authenticated','authenticated','v2-owner-a@example.invalid','',now(),'{}','{}',now(),now()),
  ('a6000000-0000-4000-8000-000000000002','authenticated','authenticated','v2-staff-a@example.invalid','',now(),'{}','{}',now(),now()),
  ('a6000000-0000-4000-8000-000000000003','authenticated','authenticated','v2-rider-a@example.invalid','',now(),'{}','{}',now(),now()),
  ('a6000000-0000-4000-8000-000000000004','authenticated','authenticated','v2-cliente@example.invalid','',now(),'{}','{}',now(),now()),
  ('a6000000-0000-4000-8000-000000000005','authenticated','authenticated','v2-owner-b@example.invalid','',now(),'{}','{}',now(),now());
insert into public.businesses(id,name,status,slug,is_active,operating_timezone) values
  ('b6000000-0000-4000-8000-000000000001','TABA V2 A','open','taba-v2-a',true,'America/Argentina/Buenos_Aires'),
  ('b6000000-0000-4000-8000-000000000002','TABA V2 B','open','taba-v2-b',true,'America/Argentina/Buenos_Aires'),
  ('b6000000-0000-4000-8000-000000000003','TABA V2 C','open','taba-v2-c',true,'America/Argentina/Buenos_Aires');
insert into public.business_members(business_id,user_id,role,is_active) values
  ('b6000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001','owner',true),
  ('b6000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000002','staff',true),
  ('b6000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000003','rider',true),
  ('b6000000-0000-4000-8000-000000000002','a6000000-0000-4000-8000-000000000005','owner',true),
  ('b6000000-0000-4000-8000-000000000003','a6000000-0000-4000-8000-000000000001','owner',true);
insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client) values
  ('c6000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000001','owner','panel_web'),
  ('c6000000-0000-4000-8000-000000000002','a6000000-0000-4000-8000-000000000002','b6000000-0000-4000-8000-000000000001','staff','panel_web'),
  ('c6000000-0000-4000-8000-000000000003','a6000000-0000-4000-8000-000000000003','b6000000-0000-4000-8000-000000000001','rider','rider_android'),
  ('c6000000-0000-4000-8000-000000000005','a6000000-0000-4000-8000-000000000005','b6000000-0000-4000-8000-000000000002','owner','panel_web');
insert into public.products(id,business_id,name,description,category,price,image_url,is_active,brand,subcategory,presentation,capacity,packaging_type,stock,available,is_alcoholic,tags,is_verified,verified_at,verified_by,external_id,sku,variant,capacity_value,capacity_unit,catalog_origin,units_per_pack)
select ('e6000000-0000-4000-8000-00000000000' || n)::uuid,
       case when n = 9 then 'b6000000-0000-4000-8000-000000000002' when n = 8 then 'b6000000-0000-4000-8000-000000000003' else 'b6000000-0000-4000-8000-000000000001' end::uuid,
       name, 'Fixture V2', 'Aguas', 1000, 'https://example.invalid/p.webp', true, 'Marca', 'Pruebas', 'Unidad', '1 u', 'unidad', 100, false, false, '{}', false, null, null,
       ext, sku, 'Unidad', 1, 'unidad', origin, 1
  from (values (1,'Gaseosa 2,25 L','v2-ext-gaseosa','SKU-GAS','commercial'), (2,'Queso por kg','LEG-QUESO',null,'commercial'), (3,'Hielo 2 kg','v2-ext-hielo',null,'commercial'),
               (4,'Libro de recetas','v2-ext-libro',null,'commercial'), (5,'Producto QA','v2-ext-qa',null,'test_only'), (8,'Agua C','v2-ext-agua-c',null,'commercial'),
               (9,'Producto B','v2-ext-b',null,'commercial')) as p(n, name, ext, sku, origin);

insert into public.fiscal_profiles(business_id,legal_name,cuit,tax_condition,business_address,environment,point_of_sale,default_currency,default_concept,
  invoice_policy,is_enabled,default_recipient_condition,accountant_review_status,certificate_fingerprint_sha256,certificate_expires_at,homologation_authorized_at,homologation_authorized_by)
select b, 'TABA V2 SRL', cuit, 'Responsable Inscripto', 'Direccion fixture', 'homologation', 6, 'PES', 1, 'manual', true, 'Consumidor Final', 'approved',
       repeat('d',64), now()+interval '90 days', now(), 'a6000000-0000-4000-8000-000000000001'
  from (values ('b6000000-0000-4000-8000-000000000001'::uuid,'20123456786'), ('b6000000-0000-4000-8000-000000000003'::uuid,'20333333334')) as t(b, cuit);
insert into public.fiscal_parameter_snapshots(environment,parameter_type,version,values_json,synchronized_at) values
  ('homologation','document_types','v2-fixture','[{"Id":6},{"Id":8}]'::jsonb,now()),
  ('homologation','recipient_document_types','v2-fixture','[{"Id":99}]'::jsonb,now()),
  ('homologation','recipient_vat_conditions','v2-fixture','[{"Id":5}]'::jsonb,now()),
  ('homologation','vat_types','v2-fixture','{"IvaTipo":[{"Id":"4","Desc":"10.5%"},{"Id":"5","Desc":"21%"}]}'::jsonb,now());
insert into public.fiscal_accounting_policies(business_id,environment,policy_version,valid_from,issuer_condition,recipient_condition,concept,invoice_type,credit_note_type,
  recipient_document_type,recipient_document_number,enabled,accountant_review_status,approved_by,approved_at,notes,recipient_vat_condition_id)
select b, 'homologation', 'v2-fixture', current_date, 'Responsable Inscripto', 'Consumidor Final', 1, 6, 8, 99, '0', true, 'approved',
       'a6000000-0000-4000-8000-000000000001', now(), 'Fixture sintetico; no constituye politica contable.', 5
  from unnest(array['b6000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000003']::uuid[]) b;
-- Politica comercial FIXTURE (A). NO es la politica de ningun comercio: la decide su contador.
insert into public.commercial_fiscal_policies(business_id,policy_version,valid_from,status,billing_moment,mercadopago_rule,cash_rule,coordinate_rule,
  vat_computation,delivery_treatment,delivery_vat_code,delivery_line_description,discount_treatment,final_consumer_id_threshold,credit_note_policy,
  accountant_reference,approved_by,approved_at,notes)
values ('b6000000-0000-4000-8000-000000000001','fixture-a-v1',current_date,'approved','after_payment_confirmed','require_approved','require_confirmed','require_confirmed',
  'price_includes_vat_per_rate','invoice_as_line',5,'Envío','prorate_by_item_gross',1000000.00,'manual_review_only',
  'FIXTURE DE PRUEBA - no es politica contable','a6000000-0000-4000-8000-000000000001',now(),'Solo para pruebas automatizadas.');
insert into public.product_fiscal_classifications(business_id,product_id,classification,vat_code,source,classified_by) values
  ('b6000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','taxed',5,'accountant','a6000000-0000-4000-8000-000000000001'),
  ('b6000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000002','taxed',4,'accountant','a6000000-0000-4000-8000-000000000001'),
  ('b6000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000004','exempt',null,'accountant','a6000000-0000-4000-8000-000000000001'),
  ('b6000000-0000-4000-8000-000000000003','e6000000-0000-4000-8000-000000000008','taxed',5,'accountant','a6000000-0000-4000-8000-000000000001');

-- Pedidos (A): O1 envio + 0,5 kg legado + cliente registrado + efectivo cobrado; O2 invitado + MP aprobado + descuento;
-- O3 cancelado; O4 efectivo sin cobrar; O5 producto sin clasificar; O6 referencia rota; O7 QA; O8 MP reembolsado; O9 exento.
insert into public.orders(id,business_id,code,public_code,status,fulfillment_type,delivery_mode,client_request_id,customer_name,customer_phone,
  payment_method,subtotal,discount_total,delivery_fee,total,customer_user_id,origin,origin_reason,origin_classified_at)
values
  ('d6000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000001','V2-1','V2-1','accepted','delivery','delivery','v2-order-0001','CLIENTE_SINTETICO','+540000000000','cash',7400,0,1210,8610,'a6000000-0000-4000-8000-000000000004','production',null,null),
  ('d6000000-0000-4000-8000-000000000002','b6000000-0000-4000-8000-000000000001','V2-2','V2-2','accepted','pickup','pickup','v2-order-0002','INVITADO','+540000000000','mercadopago',2500,250,0,2250,null,'production',null,null),
  ('d6000000-0000-4000-8000-000000000003','b6000000-0000-4000-8000-000000000001','V2-3','V2-3','cancelled','pickup','pickup','v2-order-0003','X','+540000000000','cash',1250,0,0,1250,null,'production',null,null),
  ('d6000000-0000-4000-8000-000000000004','b6000000-0000-4000-8000-000000000001','V2-4','V2-4','accepted','pickup','pickup','v2-order-0004','X','+540000000000','cash',1250,0,0,1250,null,'production',null,null),
  ('d6000000-0000-4000-8000-000000000005','b6000000-0000-4000-8000-000000000001','V2-5','V2-5','accepted','pickup','pickup','v2-order-0005','X','+540000000000','cash',1000,0,0,1000,null,'production',null,null),
  ('d6000000-0000-4000-8000-000000000006','b6000000-0000-4000-8000-000000000001','V2-6','V2-6','accepted','pickup','pickup','v2-order-0006','X','+540000000000','cash',1000,0,0,1000,null,'production',null,null),
  ('d6000000-0000-4000-8000-000000000007','b6000000-0000-4000-8000-000000000001','V2-7','V2-7','accepted','pickup','pickup','v2-order-0007','QA','+540000000000','qa_no_charge',1250,0,0,1250,null,'qa','pedido de prueba QA',now()),
  ('d6000000-0000-4000-8000-000000000008','b6000000-0000-4000-8000-000000000001','V2-8','V2-8','accepted','pickup','pickup','v2-order-0008','X','+540000000000','mercadopago',1250,0,0,1250,null,'production',null,null),
  ('d6000000-0000-4000-8000-000000000009','b6000000-0000-4000-8000-000000000001','V2-9','V2-9','accepted','pickup','pickup','v2-order-0009','X','+540000000000','cash',3000,0,0,3000,null,'production',null,null),
  ('d6000000-0000-4000-8000-00000000000b','b6000000-0000-4000-8000-000000000002','V2-B','V2-B','accepted','pickup','pickup','v2-order-000b','X','+540000000000','cash',1000,0,0,1000,null,'production',null,null),
  ('d6000000-0000-4000-8000-00000000000c','b6000000-0000-4000-8000-000000000003','V2-C','V2-C','accepted','delivery','delivery','v2-order-000c','X','+540000000000','cash',2000,0,500,2500,null,'production',null,null),
  ('d6000000-0000-4000-8000-00000000000a','b6000000-0000-4000-8000-000000000001','V2-A','V2-A','accepted','pickup','pickup','v2-order-000a','X','+540000000000','cash',1000,0,0,1000,null,'production',null,null);
insert into public.order_items(order_id,product_id,product_uuid,name,quantity,unit,unit_price,subtotal) values
  ('d6000000-0000-4000-8000-000000000001', null, 'e6000000-0000-4000-8000-000000000001', 'Gaseosa 2,25 L', 2, 'u', 1250, 2500),
  ('d6000000-0000-4000-8000-000000000001', 'LEG-QUESO', null, 'Queso por kg', 0.5, 'kg', 9800, 4900),
  ('d6000000-0000-4000-8000-000000000002', 'e6000000-0000-4000-8000-000000000001', null, 'Gaseosa 2,25 L', 2, 'u', 1250, 2500),
  ('d6000000-0000-4000-8000-000000000003', null, 'e6000000-0000-4000-8000-000000000001', 'Gaseosa 2,25 L', 1, 'u', 1250, 1250),
  ('d6000000-0000-4000-8000-000000000004', 'SKU-GAS', null, 'Gaseosa 2,25 L', 1, 'u', 1250, 1250),
  ('d6000000-0000-4000-8000-000000000005', null, 'e6000000-0000-4000-8000-000000000003', 'Hielo 2 kg', 1, 'u', 1000, 1000),
  ('d6000000-0000-4000-8000-000000000006', 'NO-EXISTE', null, 'Producto borrado', 1, 'u', 1000, 1000),
  ('d6000000-0000-4000-8000-000000000007', null, 'e6000000-0000-4000-8000-000000000001', 'Gaseosa 2,25 L', 1, 'u', 1250, 1250),
  ('d6000000-0000-4000-8000-000000000008', null, 'e6000000-0000-4000-8000-000000000001', 'Gaseosa 2,25 L', 1, 'u', 1250, 1250),
  ('d6000000-0000-4000-8000-000000000009', null, 'e6000000-0000-4000-8000-000000000004', 'Libro de recetas', 1, 'u', 3000, 3000),
  ('d6000000-0000-4000-8000-00000000000b', null, 'e6000000-0000-4000-8000-000000000009', 'Producto B', 1, 'u', 1000, 1000),
  ('d6000000-0000-4000-8000-00000000000c', null, 'e6000000-0000-4000-8000-000000000008', 'Agua C', 2, 'u', 1000, 2000),
  -- O10: un producto de PRUEBA referenciado por el id legado en texto (la clasificacion QA del pedido no lo ve).
  ('d6000000-0000-4000-8000-00000000000a', 'e6000000-0000-4000-8000-000000000005', null, 'Producto QA', 1, 'u', 1000, 1000);
-- Pagos REALES: efectivo registrado (O1, O9), MP aprobado (O2) y reembolsado (O8); O4 queda sin cobrar.
update public.orders set manual_payment_status = 'confirmed', manual_payment_method = 'cash', manual_payment_confirmed_at = now(),
       manual_payment_confirmed_by = 'a6000000-0000-4000-8000-000000000002'
 where id in ('d6000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000005','d6000000-0000-4000-8000-000000000006',
              'd6000000-0000-4000-8000-000000000009','d6000000-0000-4000-8000-00000000000a');
insert into public.checkout_sessions(id,business_id,customer_id,client_request_id,normalized_intent_hash,fulfillment_type,address_snapshot,contact_snapshot,currency,subtotal,discount_total,delivery_fee,total,status,expires_at)
select s, 'b6000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000004', 'v2-checkout-' || right(s::text, 4), repeat('b',64), 'pickup', '{}', '{}', 'ARS', t, 0, 0, t, 'completed', now()+interval '1 hour'
  from (values ('e6100000-0000-4000-8000-000000000002'::uuid, 2250), ('e6100000-0000-4000-8000-000000000008'::uuid, 1250)) as x(s, t);
insert into public.payment_intents(checkout_session_id,business_id,order_id,provider,environment,idempotency_key,external_reference,internal_status,currency,expected_amount,paid_amount,refunded_amount) values
  ('e6100000-0000-4000-8000-000000000002','b6000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000002','mercadopago','test',gen_random_uuid(),'taba2:checkout:e6100000-0000-4000-8000-000000000002','approved','ARS',2250,2250,0),
  ('e6100000-0000-4000-8000-000000000008','b6000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000008','mercadopago','test',gen_random_uuid(),'taba2:checkout:e6100000-0000-4000-8000-000000000008','refunded','ARS',1250,1250,1250);

create temporary table t_ctx(k text primary key, v text) on commit drop;
grant all on t_ctx to authenticated, service_role;
create or replace function pg_temp.ctx(p_key text) returns text language sql as $$ select v from t_ctx where k = p_key $$;
create or replace function pg_temp.put(p_key text, p_value text) returns text language sql as $$
  insert into t_ctx values (p_key, p_value) on conflict (k) do update set v = excluded.v returning v $$;
create or replace function pg_temp.as_user(p_user uuid, p_session uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', p_session)::text, true)::void $$;
create or replace function pg_temp.eval(p_order text, p_business text default 'b6000000-0000-4000-8000-000000000001') returns jsonb language sql as $$
  select private.commercial_order_fiscal_evaluation(p_business::uuid, ('d6000000-0000-4000-8000-00000000000' || p_order)::uuid, true) $$;
create or replace function pg_temp.h(p_secret text) returns text language sql as $$
  select encode(extensions.digest(convert_to(p_secret, 'UTF8'), 'sha256'), 'hex') $$;
create or replace function pg_temp.codes(p_eval jsonb) returns text[] language sql as $$
  select coalesce(array_agg(r->>'code' order by r->>'code'), '{}') from jsonb_array_elements(p_eval->'reasons') r $$;

-- ══ 1 · Una sola evaluacion, fail closed ════════════════════════════════════════════
select is(pg_temp.eval('1')->>'status', 'READY', 'O1: envio + 0,5 kg (producto legado por external_id) + efectivo registrado: READY');
select is(pg_temp.eval('2')->>'status', 'READY', 'O2: invitado + MP aprobado + descuento + producto por uuid en texto: READY');
select is(pg_temp.codes(pg_temp.eval('3')), array['ORDER_CANCELLED'], 'O3 cancelado: ORDER_CANCELLED');
select is(pg_temp.codes(pg_temp.eval('4')), array['ORDER_NOT_BILLABLE_YET','PAYMENT_REQUIRED'], 'O4 efectivo sin cobrar: PAYMENT_REQUIRED y todavia no es el momento fiscal');
select is(pg_temp.codes(pg_temp.eval('5')), array['MISSING_TAX_CLASSIFICATION'], 'O5 producto sin clasificar: MISSING_TAX_CLASSIFICATION (nunca un IVA por defecto)');
select is(pg_temp.codes(pg_temp.eval('6')), array['INVALID_PRODUCT_REFERENCE'], 'O6 referencia que no es un producto del negocio: INVALID_PRODUCT_REFERENCE');
select is(pg_temp.codes(pg_temp.eval('7')), array['QA_ORDER_NOT_BILLABLE'], 'O7 pedido QA: nunca se factura');
select is(pg_temp.codes(pg_temp.eval('8')), array['ORDER_NOT_BILLABLE_YET','PAYMENT_REQUIRED'], 'O8 MP reembolsado: el pago no habilita la factura');
select is(pg_temp.eval('9')->>'status', 'READY', 'O9 producto exento: READY');
select is(pg_temp.codes(pg_temp.eval('a')), array['QA_ORDER_NOT_BILLABLE'],
  'O10: un producto de prueba no se factura aunque llegue por la referencia legada (el pedido no quedo marcado QA)');
select is(pg_temp.codes(pg_temp.eval('c', 'b6000000-0000-4000-8000-000000000003')), array['ACCOUNTING_POLICY_REQUIRED'],
  'negocio sin politica comercial aprobada: ACCOUNTING_POLICY_REQUIRED');
select is(pg_temp.eval('c', 'b6000000-0000-4000-8000-000000000003')->'reasons'->0->>'scope', 'commercial', 'y dice cual falta');
select throws_ok($$select pg_temp.eval('b')$$, 'P0002', 'pedido inexistente', 'un pedido de otro negocio no se evalua en este');

-- ══ 2 · El origen congelado: lineas al centavo ══════════════════════════════════════
select is((pg_temp.eval('1')->'snapshot'->>'source_total'), '8610.00', 'O1: el origen reconcilia con el total del pedido');
select is((select jsonb_agg(jsonb_build_array(l->>'kind', l->>'quantity', l->>'net_amount', l->>'tax_amount', l->'tax_code') order by l->>'kind' desc, l->>'quantity')
             from jsonb_array_elements(pg_temp.eval('1')->'snapshot'->'lines') l),
  '[["item","0.5","4434.39","465.61",4],["item","2","2066.12","433.88",5],["delivery","1","1000.00","210.00",5]]'::jsonb,
  'O1: 0,5 kg al 10,5 %, gaseosa y envio al 21 % (IVA por alicuota, repartido al centavo)');
select is((select jsonb_agg(jsonb_build_array(l->>'gross_amount', l->>'discount_amount', l->>'net_amount', l->>'tax_amount'))
             from jsonb_array_elements(pg_temp.eval('2')->'snapshot'->'lines') l),
  '[["2500.00","250.00","1859.50","390.50"]]'::jsonb, 'O2: descuento prorrateado sobre el bruto del item');
select is((select jsonb_agg(jsonb_build_array(l->'tax_code', l->>'exempt_amount', l->>'net_amount'))
             from jsonb_array_elements(pg_temp.eval('9')->'snapshot'->'lines') l),
  '[[null,"3000.00","0.00"]]'::jsonb, 'O9: la linea exenta va a exento, sin alicuota');
select is((select count(*)::integer from jsonb_array_elements(pg_temp.eval('1')->'snapshot'->'lines') l where l->'reference' ? 'product_id'), 2,
  'cada item referencia su producto canonico');

-- ══ 3 · La factura nace del pedido ═════════════════════════════════════════════════
select pg_temp.put('pos_before', (select count(*)::text from public.pos_sales));
set local role authenticated;
select pg_temp.as_user('a6000000-0000-4000-8000-000000000002','c6000000-0000-4000-8000-000000000002');
select throws_ok($$select public.request_order_invoice('b6000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000004','v2:panel:o4:0001','PANEL')$$,
  'P0001', 'pedido no facturable', 'un pedido no listo falla cerrado (P0001 ORDER_NOT_FISCALLY_READY)');
select pg_temp.put('doc1', public.request_order_invoice('b6000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000001','v2:panel:o1:0001','PANEL',true)->>'fiscal_document_id');
select is(public.request_order_invoice('b6000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000001','v2:mobile:o1:0001','MOBILE')->>'fiscal_document_id',
  pg_temp.ctx('doc1'), 'mismo pedido, otro canal y otra clave: el mismo comprobante');
select pg_temp.put('doc2', public.request_order_invoice('b6000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000002','v2:panel:o2:0001','PANEL')->>'fiscal_document_id');
select is((select jsonb_agg(jsonb_build_object('order', x->>'order_id', 'status', x->'readiness'->>'status', 'state', x->'document'->>'state') order by x->>'order_id')
             from jsonb_array_elements(public.get_order_fiscal_states('b6000000-0000-4000-8000-000000000001',
               array['d6000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000003']::uuid[])) x),
  '[{"order":"d6000000-0000-4000-8000-000000000001","state":"queued","status":"ALREADY_REQUESTED"},{"order":"d6000000-0000-4000-8000-000000000003","state":null,"status":"BLOCKED"}]'::jsonb,
  'el Panel lee el estado REAL: el comprobante encolado y el pedido bloqueado');
set local role postgres;
select is((select (source_type, source_id::text, state, document_type, net_amount, tax_amount, total_amount)::text from public.fiscal_documents where id = pg_temp.ctx('doc1')::uuid),
  '(online_order,d6000000-0000-4000-8000-000000000001,queued,6,7500.51,1109.49,8610.00)', 'la factura es del PEDIDO (online_order), con los totales del origen');
select is((select count(*)::text from public.pos_sales), pg_temp.ctx('pos_before'), 'no se creo ninguna venta POS');
select ok((select s.frozen_by = 'a6000000-0000-4000-8000-000000000002' and s.frozen_by_type = 'operator' and s.policy_ref->>'policy_version' = 'fixture-a-v1'
             from public.fiscal_source_snapshots s join public.fiscal_documents d on d.source_snapshot_id = s.id where d.id = pg_temp.ctx('doc1')::uuid),
  'el origen congelado registra al operador real y la politica aplicada');
select is((select array_agg(k.command_source || ':' || k.actor_id::text order by k.command_source) from public.fiscal_idempotency_keys k where k.fiscal_document_id = pg_temp.ctx('doc1')::uuid),
  array['MOBILE:a6000000-0000-4000-8000-000000000002','PANEL:a6000000-0000-4000-8000-000000000002'], 'cada clave registra canal y actor reales');
select is((select actor_type || ':' || actor_id::text from public.fiscal_events where fiscal_document_id = pg_temp.ctx('doc1')::uuid and event_type = 'queued'),
  'operator:a6000000-0000-4000-8000-000000000002', 'la auditoria del core registra al operador (nunca un cliente ni un UUID cero)');
select is((select array_agg(tax_code order by net_amount) from public.fiscal_document_items where fiscal_document_id = pg_temp.ctx('doc1')::uuid),
  array[5, 5, 4], 'sus items son las lineas del pedido, con su alicuota');

-- ══ 4 · Canales de servidor y aislamiento ═══════════════════════════════════════════
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok($$select public.service_request_order_invoice('b6000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000009','v2:wa:o9:0001','WHATSAPP')$$,
  '22023', 'un pedido por WhatsApp requiere el usuario que lo hizo', 'WhatsApp sin el actor real: no');
select throws_ok($$select public.service_request_order_invoice('b6000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000009','v2:wa:o9:0002','WHATSAPP','a6000000-0000-4000-8000-000000000005')$$,
  '42501', 'actor ajeno al negocio', 'un actor de otro negocio: no');
select throws_ok($$select public.service_request_order_invoice('b6000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000009','v2:wa:o9:0003','WHATSAPP','a6000000-0000-4000-8000-000000000003')$$,
  '42501', 'actor ajeno al negocio', 'un rider no factura');
select pg_temp.put('doc9', public.service_request_order_invoice('b6000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000009','v2:auto:o9:0001','AUTOMATION')->>'fiscal_document_id');
select is((select actor_type || ':' || coalesce(actor_id::text, 'null') from public.fiscal_events where fiscal_document_id = pg_temp.ctx('doc9')::uuid and event_type = 'queued'),
  'system:null', 'una automatizacion es identidad de sistema explicita');
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$select public.service_request_order_invoice('b6000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000009','v2:auto:o9:0002','AUTOMATION')$$,
  '42501', 'canal de servidor no autorizado', 'sin JWT de service_role, el GRANT no alcanza');
set local role authenticated;
select pg_temp.as_user('a6000000-0000-4000-8000-000000000003','c6000000-0000-4000-8000-000000000003');
select throws_ok($$select public.request_order_invoice('b6000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000009','v2:rider:o9:0001')$$,
  '42501', 'operador no autorizado', 'un rider no factura');
select pg_temp.as_user('a6000000-0000-4000-8000-000000000004', null);
select throws_ok($$select public.request_order_invoice('b6000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000001','v2:cliente:o1:0001')$$,
  '42501', 'operador no autorizado', 'el cliente del pedido no es un operador');
select pg_temp.as_user('a6000000-0000-4000-8000-000000000005','c6000000-0000-4000-8000-000000000005');
select throws_ok($$select public.request_order_invoice('b6000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000001','v2:ajeno:o1:0001')$$,
  '42501', 'operador no autorizado', 'otro negocio no factura un pedido ajeno');
select throws_ok($$select public.get_order_fiscal_states('b6000000-0000-4000-8000-000000000001', array['d6000000-0000-4000-8000-000000000001']::uuid[])$$,
  '42501', 'operador no autorizado', 'ni lee su estado fiscal');
select is((select jsonb_array_length(public.get_order_fiscal_states('b6000000-0000-4000-8000-000000000002', array['d6000000-0000-4000-8000-000000000001']::uuid[]))),
  0, 'y un id ajeno pedido desde su negocio no devuelve nada');
select is((select count(*)::integer from public.commercial_fiscal_policies where business_id = 'b6000000-0000-4000-8000-000000000001'), 0,
  'la politica de otro negocio no se lee (RLS)');
set local role postgres;
select throws_ok($$insert into public.product_fiscal_classifications(business_id,product_id,classification,vat_code,source,classified_by)
  values ('b6000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000009','taxed',5,'accountant','a6000000-0000-4000-8000-000000000001')$$,
  '42501', 'el producto no es de este negocio', 'no se clasifica un producto de otro negocio');
select throws_ok($$update public.commercial_fiscal_policies set cash_rule = 'allow_pending' where business_id = 'b6000000-0000-4000-8000-000000000001'$$,
  '55000', 'una politica aprobada no se edita: se retira y se aprueba otra', 'una politica aprobada no se edita');
select throws_ok($$insert into public.commercial_fiscal_policies(business_id,policy_version,valid_from,status,approved_by,approved_at)
  values ('b6000000-0000-4000-8000-000000000003','incompleta',current_date,'approved','a6000000-0000-4000-8000-000000000001',now())$$,
  '23514', null, 'no se aprueba una politica incompleta: no hay defaults');

-- ══ 5 · Facturar e imprimir; reimprimir ═══════════════════════════════════════════════
select is((select count(*)::integer from public.print_jobs where source_entity_id = pg_temp.ctx('doc1')::uuid), 0,
  'pedida la impresion, no hay ticket antes de autorizar (sin CAE no se imprime)');
select ok(exists (select 1 from public.fiscal_print_requests where fiscal_document_id = pg_temp.ctx('doc1')::uuid and fulfilled_at is null
                    and requested_by = 'a6000000-0000-4000-8000-000000000002' and command_source = 'PANEL'), 'el pedido de impresion es durable y tiene actor');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select pg_temp.put('epoch', (select lease_epoch::text from public.claim_fiscal_outbox('v2-test-worker','homologation','20123456786',5,120)
                              where fiscal_document_id = pg_temp.ctx('doc1')::uuid));
select is((public.reserve_fiscal_document_number(pg_temp.ctx('doc1')::uuid,'v2-test-worker',pg_temp.ctx('epoch')::bigint,1,(now() at time zone 'America/Argentina/Buenos_Aires')::date)).document_number,
  1::bigint, 'el worker reserva el numero');
select is(public.complete_fiscal_attempt((select id from public.fiscal_outbox where fiscal_document_id = pg_temp.ctx('doc1')::uuid),'v2-test-worker',pg_temp.ctx('epoch')::bigint,
  '{"classification":"authorized","cae":"74000000000001","document_number":1,"cae_expiration":"2026-10-07","simulated":"CAE_SINTETICO_DE_PRUEBA"}'::jsonb)->>'state',
  'authorized', 'autorizacion SIMULADA de prueba');
set local role postgres;
select is((select count(*)::integer || ':' || min(idempotency_key) from public.print_jobs where source_entity_id = pg_temp.ctx('doc1')::uuid and document_type = 'fiscal_receipt'),
  '1:auto:fiscal_receipt:' || pg_temp.ctx('doc1'), 'al autorizar se crea UN ticket real, con la clave de la impresion automatica');
select ok(exists (select 1 from public.fiscal_print_requests r join public.print_jobs j on j.id = r.print_job_id
                    where r.fiscal_document_id = pg_temp.ctx('doc1')::uuid and r.fulfilled_at is not null), 'y el pedido de impresion queda cumplido');
-- El agente REAL del mostrador imprime el primer ticket: el owner vincula la PC; el agente reclama e imprime.
set local role authenticated;
select pg_temp.as_user('a6000000-0000-4000-8000-000000000001','c6000000-0000-4000-8000-000000000001');
select pg_temp.put('pair', public.create_local_device_pairing('b6000000-0000-4000-8000-000000000001', 'Mostrador V2')->>'pairing_code');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select pg_temp.put('dev', public.agent_register_device(pg_temp.ctx('pair'), pg_temp.h('secreto-v2'), 'Mostrador V2', 'windows', '0.1.0')->>'device_id');
select pg_temp.put('claim', public.agent_claim_print_jobs(pg_temp.ctx('dev')::uuid, pg_temp.h('secreto-v2'), array['fiscal_receipt'], 5)::text);
select is((pg_temp.ctx('claim')::jsonb->'jobs'->0->'payload'->>'cae'), '74000000000001', 'el agente reclama el ticket fiscal, con el CAE autorizado');
select lives_ok(format($$select public.agent_update_print_job(%L, %L, %L, %L, 'printing')$$, pg_temp.ctx('dev'), pg_temp.h('secreto-v2'),
  pg_temp.ctx('claim')::jsonb->'jobs'->0->>'id', pg_temp.ctx('claim')::jsonb->'jobs'->0->>'claim_token'), 'imprime');
select lives_ok(format($$select public.agent_update_print_job(%L, %L, %L, %L, 'printed', null, 800)$$, pg_temp.ctx('dev'), pg_temp.h('secreto-v2'),
  pg_temp.ctx('claim')::jsonb->'jobs'->0->>'id', pg_temp.ctx('claim')::jsonb->'jobs'->0->>'claim_token'), 'y confirma impreso (agente SIMULADO en la prueba)');
set local role authenticated;
select pg_temp.as_user('a6000000-0000-4000-8000-000000000002','c6000000-0000-4000-8000-000000000002');
select lives_ok(format($$select public.request_print_job_reprint(%L, 'Reimpresion pedida por el cliente', 'v2-reprint-0001')$$,
  (select id from public.print_jobs where source_entity_id = pg_temp.ctx('doc1')::uuid)), 'reimprimir usa la RPC real');
set local role postgres;
select is((select count(*)::integer from public.print_jobs j where j.source_entity_id = pg_temp.ctx('doc1')::uuid and j.reprint_of is not null
             and j.reprint_reason = 'Reimpresion pedida por el cliente'), 1, 'la reimpresion es un trabajo nuevo con reprint_of y su motivo');
select is((select count(*)::integer from public.fiscal_documents where source_type = 'online_order' and source_id = 'd6000000-0000-4000-8000-000000000001'), 1,
  'reimprimir no pide otro CAE ni crea otro comprobante');
select is((select jsonb_build_object('state', x->'document'->>'state', 'cae', x->'document'->>'cae', 'jobs', x->'print'->'jobs')
             from jsonb_array_elements(public.get_order_fiscal_states('b6000000-0000-4000-8000-000000000001', array['d6000000-0000-4000-8000-000000000001']::uuid[])) x),
  '{"state":"authorized","cae":"74000000000001","jobs":2}'::jsonb, 'el estado leido refleja autorizacion e impresiones reales');

select * from finish();
rollback;
