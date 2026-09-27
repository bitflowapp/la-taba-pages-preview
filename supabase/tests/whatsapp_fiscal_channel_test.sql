-- LA TABA · WHATSAPP COMO CANAL FISCAL (V2), sobre el esquema REAL
--
-- WhatsApp no decide nada fiscal: pide con un actor real y una confirmación explícita, por la
-- misma entrada de servidor que las automatizaciones. Esta suite fija:
--   1. vincular: códigos de un solo uso (solo el hash), intentos, vencimiento, bloqueo por teléfono;
--   2. comandos deterministas con datos reales (estado, ventas hoy, pendientes, estado/facturar <código>);
--   3. confirmaciones persistentes, con vencimiento, atadas a un pedido; SI duplicado o vencido;
--   4. la membresía se revalida en cada mensaje y al confirmar; revocar desde el Panel;
--   5. varios negocios: elección explícita;
--   6. el PDF por el id del ARTEFACTO vigente;
--   7. dedup atómico por wa_message_id, permisos y privacidad.
--
-- La política, las clasificaciones y el CUIT son FIXTURES SINTÉTICOS. La autorización de la
-- sección 6 es SIMULADA (CAE de prueba) y el PDF es una fila de fixture: el worker de PDF real
-- lo prueba scripts/whatsapp/verify-whatsapp-channel.mjs. Todo transaccional: rollback.

begin;
create extension if not exists pgtap with schema extensions;
select plan(68);

-- ── Fixture ─────────────────────────────────────────────────────────────────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
  ('a7000000-0000-4000-8000-000000000001','authenticated','authenticated','wa-owner@example.invalid','',now(),'{}','{}',now(),now()),
  ('a7000000-0000-4000-8000-000000000002','authenticated','authenticated','wa-staff@example.invalid','',now(),'{}','{}',now(),now()),
  ('a7000000-0000-4000-8000-000000000003','authenticated','authenticated','wa-rider@example.invalid','',now(),'{}','{}',now(),now());
insert into public.businesses(id,name,status,slug,is_active,operating_timezone) values
  ('b7000000-0000-4000-8000-000000000001','TABA WA A','open','taba-wa-a',true,'America/Argentina/Buenos_Aires'),
  ('b7000000-0000-4000-8000-000000000002','TABA WA B','open','taba-wa-b',true,'America/Argentina/Buenos_Aires');
insert into public.business_members(business_id,user_id,role,is_active) values
  ('b7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000001','owner',true),
  ('b7000000-0000-4000-8000-000000000002','a7000000-0000-4000-8000-000000000001','owner',true),
  ('b7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000002','staff',true),
  ('b7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000003','rider',true);
insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client) values
  ('c7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000001','owner','panel_web'),
  ('c7000000-0000-4000-8000-00000000000b','a7000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000002','owner','panel_web'),
  ('c7000000-0000-4000-8000-000000000002','a7000000-0000-4000-8000-000000000002','b7000000-0000-4000-8000-000000000001','staff','panel_web'),
  ('c7000000-0000-4000-8000-000000000003','a7000000-0000-4000-8000-000000000003','b7000000-0000-4000-8000-000000000001','rider','rider_android');
insert into public.products(id,business_id,name,description,category,price,image_url,is_active,brand,subcategory,presentation,capacity,packaging_type,stock,available,is_alcoholic,tags,is_verified,verified_at,verified_by,external_id,variant,capacity_value,capacity_unit,catalog_origin,units_per_pack) values
  ('e7000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000001','Gaseosa 2,25 L','Fixture WA','Aguas',1250,'https://example.invalid/p.webp',true,'Marca','Pruebas','Unidad','1 u','unidad',100,false,false,'{}',false,null,null,'wa-ext-gaseosa','Unidad',1,'unidad','commercial',1),
  ('e7000000-0000-4000-8000-000000000002','b7000000-0000-4000-8000-000000000002','Producto B','Fixture WA','Aguas',1000,'https://example.invalid/p.webp',true,'Marca','Pruebas','Unidad','1 u','unidad',100,false,false,'{}',false,null,null,'wa-ext-b','Unidad',1,'unidad','commercial',1);
insert into public.fiscal_profiles(business_id,legal_name,cuit,tax_condition,business_address,environment,point_of_sale,default_currency,default_concept,
  invoice_policy,is_enabled,default_recipient_condition,accountant_review_status,certificate_fingerprint_sha256,certificate_expires_at,homologation_authorized_at,homologation_authorized_by)
values ('b7000000-0000-4000-8000-000000000001','TABA WA SRL','20123456786','Responsable Inscripto','Direccion fixture','homologation',6,'PES',1,'manual',true,'Consumidor Final','approved',
  repeat('f',64),now()+interval '90 days',now(),'a7000000-0000-4000-8000-000000000001');
insert into public.fiscal_parameter_snapshots(environment,parameter_type,version,values_json,synchronized_at) values
  ('homologation','document_types','wa-fixture','[{"Id":6},{"Id":8}]'::jsonb,now()),
  ('homologation','recipient_document_types','wa-fixture','[{"Id":99}]'::jsonb,now()),
  ('homologation','recipient_vat_conditions','wa-fixture','[{"Id":5}]'::jsonb,now()),
  ('homologation','vat_types','wa-fixture','{"IvaTipo":[{"Id":"5","Desc":"21%"}]}'::jsonb,now());
insert into public.fiscal_accounting_policies(business_id,environment,policy_version,valid_from,issuer_condition,recipient_condition,concept,invoice_type,credit_note_type,
  recipient_document_type,recipient_document_number,enabled,accountant_review_status,approved_by,approved_at,notes,recipient_vat_condition_id)
values ('b7000000-0000-4000-8000-000000000001','homologation','wa-fixture',current_date,'Responsable Inscripto','Consumidor Final',1,6,8,99,'0',true,'approved',
  'a7000000-0000-4000-8000-000000000001',now(),'Fixture sintetico; no constituye politica contable.',5);
insert into public.commercial_fiscal_policies(business_id,policy_version,valid_from,status,billing_moment,mercadopago_rule,cash_rule,coordinate_rule,
  vat_computation,delivery_treatment,delivery_vat_code,delivery_line_description,discount_treatment,final_consumer_id_threshold,credit_note_policy,
  accountant_reference,approved_by,approved_at,notes)
values ('b7000000-0000-4000-8000-000000000001','wa-fixture-v1',current_date,'approved','after_payment_confirmed','require_approved','require_confirmed','require_confirmed',
  'price_includes_vat_per_rate','invoice_as_line',5,'Envío','prorate_by_item_gross',1000000.00,'manual_review_only',
  'FIXTURE DE PRUEBA - no es politica contable','a7000000-0000-4000-8000-000000000001',now(),'Solo para pruebas automatizadas.');
insert into public.product_fiscal_classifications(business_id,product_id,classification,vat_code,source,classified_by) values
  ('b7000000-0000-4000-8000-000000000001','e7000000-0000-4000-8000-000000000001','taxed',5,'accountant','a7000000-0000-4000-8000-000000000001');
insert into public.orders(id,business_id,code,public_code,status,fulfillment_type,delivery_mode,client_request_id,customer_name,customer_phone,payment_method,subtotal,discount_total,delivery_fee,total,origin) values
  ('d7000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000001','WA-1','WA-1','accepted','pickup','pickup','wa-order-0001','Cliente WA 1','+540000000000','cash',2500,0,0,2500,'production'),
  ('d7000000-0000-4000-8000-000000000002','b7000000-0000-4000-8000-000000000001','WA-2','WA-2','accepted','pickup','pickup','wa-order-0002','Cliente WA 2','+540000000000','cash',1250,0,0,1250,'production'),
  ('d7000000-0000-4000-8000-000000000003','b7000000-0000-4000-8000-000000000001','WA-3','WA-3','accepted','pickup','pickup','wa-order-0003','Cliente WA 3','+540000000000','cash',1250,0,0,1250,'production'),
  ('d7000000-0000-4000-8000-000000000004','b7000000-0000-4000-8000-000000000001','WA-4','WA-4','accepted','pickup','pickup','wa-order-0004','Cliente WA 4','+540000000000','cash',1250,0,0,1250,'production'),
  ('d7000000-0000-4000-8000-00000000000b','b7000000-0000-4000-8000-000000000002','WB-1','WB-1','accepted','pickup','pickup','wa-order-000b','Cliente WB','+540000000000','cash',1000,0,0,1000,'production');
insert into public.order_items(order_id,product_id,product_uuid,name,quantity,unit,unit_price,subtotal) values
  ('d7000000-0000-4000-8000-000000000001', null, 'e7000000-0000-4000-8000-000000000001', 'Gaseosa 2,25 L', 2, 'u', 1250, 2500),
  ('d7000000-0000-4000-8000-000000000002', null, 'e7000000-0000-4000-8000-000000000001', 'Gaseosa 2,25 L', 1, 'u', 1250, 1250),
  ('d7000000-0000-4000-8000-000000000003', null, 'e7000000-0000-4000-8000-000000000001', 'Gaseosa 2,25 L', 1, 'u', 1250, 1250),
  ('d7000000-0000-4000-8000-000000000004', null, 'e7000000-0000-4000-8000-000000000001', 'Gaseosa 2,25 L', 1, 'u', 1250, 1250),
  ('d7000000-0000-4000-8000-00000000000b', null, 'e7000000-0000-4000-8000-000000000002', 'Producto B', 1, 'u', 1000, 1000);
update public.orders set manual_payment_status = 'confirmed', manual_payment_method = 'cash', manual_payment_confirmed_at = now(),
       manual_payment_confirmed_by = 'a7000000-0000-4000-8000-000000000002'
 where id in ('d7000000-0000-4000-8000-000000000001','d7000000-0000-4000-8000-000000000003','d7000000-0000-4000-8000-000000000004',
              'd7000000-0000-4000-8000-00000000000b');

create temporary table t_ctx(k text primary key, v text) on commit drop;
grant all on t_ctx to authenticated, service_role;
create or replace function pg_temp.ctx(p_key text) returns text language sql as $$ select v from t_ctx where k = p_key $$;
create or replace function pg_temp.put(p_key text, p_value text) returns text language sql as $$
  insert into t_ctx values (p_key, p_value) on conflict (k) do update set v = excluded.v returning v $$;
create or replace function pg_temp.as_user(p_user uuid, p_session uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', p_session)::text, true)::void $$;
-- Un mensaje de WhatsApp tal como lo entrega la Edge Function (service_role).
create or replace function pg_temp.wa(p_id text, p_phone text, p_text text, p_type text default 'text') returns jsonb language sql as $$
  select public.whatsapp_handle_inbound(p_id, p_phone, '109876543210', p_type, p_text) $$;
create or replace function pg_temp.say(p_id text, p_phone text, p_text text) returns text language sql as $$
  select pg_temp.put(p_id, pg_temp.wa(p_id, p_phone, p_text)::text) $$;
create or replace function pg_temp.body(p_id text, p_n integer default 0) returns text language sql as $$
  select pg_temp.ctx(p_id)::jsonb->'replies'->p_n->>'body' $$;
create or replace function pg_temp.secret(p_code text) returns text language sql as $$ select replace(substr(p_code, 6), '-', '') $$;
create or replace function pg_temp.service() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true)::void $$;

-- ══ 1 · Vincular ════════════════════════════════════════════════════════════════════
set local role authenticated;
select pg_temp.as_user('a7000000-0000-4000-8000-000000000003','c7000000-0000-4000-8000-000000000003');
select throws_ok($$select public.create_whatsapp_pairing('b7000000-0000-4000-8000-000000000001')$$, '42501', 'operador no autorizado',
  'un rider no vincula un WhatsApp al back office');
select pg_temp.as_user('a7000000-0000-4000-8000-000000000002','c7000000-0000-4000-8000-000000000002');
select pg_temp.put('code1', public.create_whatsapp_pairing('b7000000-0000-4000-8000-000000000001')->>'code');
select matches(pg_temp.ctx('code1'), '^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$', 'el código se muestra una sola vez, sin 0/O ni 1/I');
set local role postgres;
select ok(exists (select 1 from public.whatsapp_pairings p where p.selector = left(pg_temp.ctx('code1'), 4)
                    and p.code_hash = private.whatsapp_sha256(pg_temp.secret(pg_temp.ctx('code1')))
                    and p.user_id = 'a7000000-0000-4000-8000-000000000002' and p.expires_at <= now() + interval '10 minutes'),
  'la base guarda el selector y el HASH del secreto, con dueño y vencimiento; nunca el código');

set local role service_role;
select pg_temp.service();
select pg_temp.say('wamid.u1', '5492995550003', 'hola');
select is(pg_temp.body('wamid.u1'), 'Este WhatsApp no está vinculado a ningún negocio. Pedí un código en el Panel y mandá: vincular CÓDIGO',
  'un número sin vínculo recibe cómo vincularse');
select pg_temp.say('wamid.u2', '5492995550003', 'facturar lt-1');
select is(pg_temp.ctx('wamid.u2')::jsonb->>'outcome', 'unlinked_silent', 'y no se le vuelve a contestar enseguida: no es un canal abierto');
select pg_temp.say('wamid.p1', '5492995550001', 'vincular ' || left(pg_temp.ctx('code1'), 5) || 'ZZZZ-ZZZZ');
select is(pg_temp.body('wamid.p1'), 'El código no es válido o venció. Pedí uno nuevo en el Panel.', 'un secreto equivocado no vincula');
select pg_temp.say('wamid.p2', '5492995550001', 'Vincular ' || lower(pg_temp.ctx('code1')));
select is(pg_temp.body('wamid.p2'), 'Listo: este WhatsApp quedó vinculado a TABA WA A. Escribí ayuda para ver qué podés hacer.',
  'el código correcto vincula (sin importar mayúsculas)');
set local role postgres;
select is((select attempt_count || ':' || (consumed_by_phone = '5492995550001') from public.whatsapp_pairings where selector = left(pg_temp.ctx('code1'), 4)),
  '1:true', 'el intento fallido quedó contado; el canje, con el teléfono que firmó Meta');
select ok(exists (select 1 from public.whatsapp_links where phone_e164 = '5492995550001' and business_id = 'b7000000-0000-4000-8000-000000000001'
                    and user_id = 'a7000000-0000-4000-8000-000000000002' and revoked_at is null), 'el vínculo persiste: teléfono, usuario y negocio');
set local role service_role;
select pg_temp.service();
select pg_temp.say('wamid.p3', '5492995550003', 'vincular ' || pg_temp.ctx('code1'));
select is(pg_temp.body('wamid.p3'), 'El código no es válido o venció. Pedí uno nuevo en el Panel.', 'un código ya canjeado no sirve dos veces');

-- Fuerza bruta: 5 secretos malos anulan el código; después, el correcto ya no sirve.
set local role authenticated;
select pg_temp.as_user('a7000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000001');
select pg_temp.put('codebf', public.create_whatsapp_pairing('b7000000-0000-4000-8000-000000000001')->>'code');
set local role service_role;
select pg_temp.service();
select pg_temp.say('wamid.bf' || n, '5492995550004', 'vincular ' || left(pg_temp.ctx('codebf'), 5) || 'ZZZZ-ZZZZ') from generate_series(1, 5) n;
set local role postgres;
select is((select attempt_count || ':' || (revoked_at is not null) from public.whatsapp_pairings where selector = left(pg_temp.ctx('codebf'), 4)),
  '5:true', 'cinco intentos malos anulan el código');
set local role service_role;
select pg_temp.service();
select pg_temp.say('wamid.bf6', '5492995550004', 'vincular ' || pg_temp.ctx('codebf'));
select is(pg_temp.body('wamid.bf6'), 'El código no es válido o venció. Pedí uno nuevo en el Panel.', 'y el secreto correcto ya no lo revive');
select pg_temp.say('wamid.bf' || n, '5492995550004', 'vincular 1234567890ab') from generate_series(7, 10) n;
select pg_temp.say('wamid.bf11', '5492995550004', 'vincular ' || pg_temp.ctx('codebf'));
select is(pg_temp.body('wamid.bf11'), 'Demasiados intentos con códigos inválidos. Probá de nuevo en una hora.',
  'diez fallas bloquean al teléfono una hora');

-- Vencido: no se canjea.
set local role authenticated;
select pg_temp.as_user('a7000000-0000-4000-8000-000000000002','c7000000-0000-4000-8000-000000000002');
select pg_temp.put('codeold', public.create_whatsapp_pairing('b7000000-0000-4000-8000-000000000001')->>'code');
set local role postgres;
update public.whatsapp_pairings set created_at = now() - interval '20 minutes', expires_at = now() - interval '10 minutes'
 where selector = left(pg_temp.ctx('codeold'), 4);
set local role service_role;
select pg_temp.service();
select pg_temp.say('wamid.old', '5492995550005', 'vincular ' || pg_temp.ctx('codeold'));
select is(pg_temp.body('wamid.old'), 'El código no es válido o venció. Pedí uno nuevo en el Panel.', 'un código vencido no vincula');

-- ══ 2 · Comandos con datos reales ════════════════════════════════════════════════════
select pg_temp.say('wamid.c1', '5492995550001', 'Ayuda');
select ok(pg_temp.body('wamid.c1') like '%facturar LT-1234 — pide la factura de un pedido (te pido confirmación)%', 'ayuda lista los comandos');
select pg_temp.say('wamid.c2', '5492995550001', 'estado');
select is(pg_temp.body('wamid.c2'), E'TABA WA A\nFacturación: homologación (sin validez fiscal)\nConfiguración fiscal: aprobada (wa-fixture-v1)\nPC de impresión: no vinculada\nComprobantes en curso o a revisar: 0',
  'estado del negocio: ambiente, política, PC de impresión y cola real');
select pg_temp.say('wamid.c3', '5492995550001', 'ventas hoy');
select ok(pg_temp.body('wamid.c3') like E'%Pedidos online (sin cancelados): 4 por $ 6.250,00\nMostrador: 0 ventas por $ 0,00\nComprobantes autorizados hoy: 0',
  'ventas de hoy: números reales del negocio, no inventados');
select pg_temp.say('wamid.c4', '5492995550001', 'pendientes');
select ok(pg_temp.body('wamid.c4') like '%WA-1 · Listo para facturar%' and pg_temp.body('wamid.c4') not like '%WA-2%',
  'pendientes: solo lo que el servidor evalúa listo');
select pg_temp.say('wamid.c5', '5492995550001', 'estado wa-1');
select is(pg_temp.body('wamid.c5'), 'WA-1 · Listo para facturar. Para pedir la factura: facturar WA-1', 'estado de un pedido listo');
select pg_temp.say('wamid.c6', '5492995550001', 'estado WA-2');
select is(pg_temp.body('wamid.c6'), 'WA-2 · No se puede facturar todavía: Falta confirmar el pago · Se factura cuando el pago esté confirmado',
  'las mismas razones que ve el Panel');
select pg_temp.say('wamid.c7', '5492995550001', 'facturar wa-2');
select is(pg_temp.ctx('wamid.c7')::jsonb->>'outcome', 'order_not_ready', 'facturar un pedido bloqueado no abre confirmación');
select pg_temp.say('wamid.c8', '5492995550001', 'facturar wa-9999');
select is(pg_temp.body('wamid.c8'), 'No encontré el pedido WA-9999.', 'un código inexistente se dice como tal');
select pg_temp.say('wamid.c9', '5492995550001', 'facturar lt-1,status.eq.x');
select is(pg_temp.ctx('wamid.c9')::jsonb->>'outcome', 'unknown_command', 'un código con sintaxis de consulta no llega a ninguna consulta');

-- ══ 3 · Confirmación persistente, atada a un pedido ════════════════════════════════════
select pg_temp.say('wamid.f1', '5492995550001', 'facturar wa-1');
select is(pg_temp.body('wamid.f1'), E'Vas a pedir la factura del pedido WA-1 (Cliente WA 1, $ 2.500,00) — HOMOLOGACIÓN, sin validez fiscal.\nRespondé SI para confirmar o NO para cancelar. Vence en 5 minutos.',
  'facturar pide confirmación, con monto y ambiente');
select is((pg_temp.wa('wamid.f1', '5492995550001', 'facturar wa-1'))->>'duplicate', 'true', 'Meta reenvía el mismo mensaje: duplicado, no se procesa');
set local role postgres;
select is((select count(*)::integer from public.whatsapp_outbound_messages where inbound_message_id = 'wamid.f1'), 1, 'y no se contesta dos veces');
select is((select order_code || ':' || action || ':' || (expires_at = now() + interval '5 minutes') from public.whatsapp_pending_actions
            where phone_e164 = '5492995550001' and closed_at is null), 'WA-1:invoice:true', 'la confirmación vive en la base: pedido, acción, vencimiento');
set local role service_role;
select pg_temp.service();
select pg_temp.say('wamid.f2', '5492995550001', 'si wa-3');
select is(pg_temp.body('wamid.f2'), 'La confirmación abierta es para WA-1. Respondé SI para ese pedido, o pedí: facturar WA-3',
  'un SI para otro pedido no confirma el abierto');
select pg_temp.say('wamid.f3', '5492995550001', 'Sí');
select is(pg_temp.body('wamid.f3'), E'Solicitud recibida. La factura del pedido WA-1 queda pendiente hasta que ARCA la autorice.\nWA-1 · Pendiente\nHOMOLOGACIÓN · sin validez fiscal\nPara ver cómo va: estado WA-1',
  'SI: la solicitud se recibe; nada se da por emitido');
set local role postgres;
select pg_temp.put('docw1', (select id::text from public.fiscal_documents where source_type = 'online_order' and source_id = 'd7000000-0000-4000-8000-000000000001'));
select is((select array_agg(k.command_source || ':' || k.actor_id::text) from public.fiscal_idempotency_keys k where k.fiscal_document_id = pg_temp.ctx('docw1')::uuid),
  array['WHATSAPP:a7000000-0000-4000-8000-000000000002'], 'el comprobante es del PEDIDO, por WhatsApp, con el usuario vinculado como actor');
select is((select closed_reason || ':' || (result->>'fiscal_document_id') from public.whatsapp_pending_actions where source_message_id = 'wamid.f1'),
  'confirmed:' || pg_temp.ctx('docw1'), 'la confirmación queda cerrada con el comprobante');
set local role service_role;
select pg_temp.service();
select pg_temp.say('wamid.f4', '5492995550001', 'si');
select is(pg_temp.body('wamid.f4'), 'No hay nada para confirmar. Para pedir una factura: facturar LT-1234', 'un segundo SI no pide nada');
select is((pg_temp.wa('wamid.f3', '5492995550001', 'si'))->>'duplicate', 'true', 'el SI reenviado por Meta es un duplicado');
set local role postgres;
select is((select count(*)::integer from public.fiscal_documents where source_type = 'online_order' and source_id = 'd7000000-0000-4000-8000-000000000001'),
  1, 'un solo comprobante para el pedido');
set local role service_role;
select pg_temp.service();
select pg_temp.say('wamid.f5', '5492995550001', 'facturar wa-1');
select is(pg_temp.body('wamid.f5'), E'Ese pedido ya tiene la factura pedida.\nWA-1 · Pendiente\nHOMOLOGACIÓN · sin validez fiscal',
  'ya pedida: se informa el estado, no se abre otra confirmación');

-- Vencida, reemplazada, cancelada.
select pg_temp.say('wamid.v1', '5492995550001', 'facturar wa-3');
set local role postgres;
update public.whatsapp_pending_actions set created_at = now() - interval '10 minutes', expires_at = now() - interval '5 minutes'
 where source_message_id = 'wamid.v1';
set local role service_role;
select pg_temp.service();
select pg_temp.say('wamid.v2', '5492995550001', 'si');
select is(pg_temp.body('wamid.v2'), 'La confirmación venció. Pedila de nuevo: facturar WA-3', 'un SI tardío no factura');
select pg_temp.say('wamid.v3', '5492995550001', 'facturar wa-3 e imprimir');
select pg_temp.say('wamid.v4', '5492995550001', 'facturar wa-4');
set local role postgres;
select is((select string_agg(order_code || ':' || action || ':' || coalesce(closed_reason, 'open'), ',' order by created_at, order_code)
             from public.whatsapp_pending_actions where source_message_id in ('wamid.v1', 'wamid.v3', 'wamid.v4')),
  'WA-3:invoice:expired,WA-3:invoice_and_print:superseded,WA-4:invoice:open', 'una sola confirmación abierta por teléfono');
set local role service_role;
select pg_temp.service();
select pg_temp.say('wamid.v5', '5492995550001', 'no');
select is(pg_temp.body('wamid.v5'), 'Cancelado: no se pidió la factura de WA-4.', 'NO cancela');
set local role postgres;
select is((select count(*)::integer from public.fiscal_documents where source_type = 'online_order'
             and source_id in ('d7000000-0000-4000-8000-000000000003', 'd7000000-0000-4000-8000-000000000004')), 0,
  'ni la vencida, ni la reemplazada, ni la cancelada pidieron factura');

-- ══ 4 · La membresía se revalida ═════════════════════════════════════════════════════
set local role service_role;
select pg_temp.service();
select pg_temp.say('wamid.m1', '5492995550001', 'facturar wa-4');
set local role postgres;
update public.business_members set is_active = false where business_id = 'b7000000-0000-4000-8000-000000000001' and user_id = 'a7000000-0000-4000-8000-000000000002';
set local role service_role;
select pg_temp.service();
select pg_temp.say('wamid.m2', '5492995550001', 'si');
select is(pg_temp.body('wamid.m2'), 'Tu usuario ya no puede facturar en ese negocio. No se pidió nada.', 'dado de baja entre el facturar y el SI: no factura');
select pg_temp.say('wamid.m3', '5492995550001', 'estado');
select is(pg_temp.body('wamid.m3'), 'Tu usuario ya no está activo en el negocio vinculado. Si es un error, pedile al dueño que te habilite de nuevo.',
  'dado de baja: WhatsApp no opera');
set local role postgres;
update public.business_members set is_active = true where business_id = 'b7000000-0000-4000-8000-000000000001' and user_id = 'a7000000-0000-4000-8000-000000000002';
insert into public.identity_user_security(business_id, user_id, sessions_valid_from)
values ('b7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000002', now() + interval '1 second');
set local role service_role;
select pg_temp.service();
select pg_temp.say('wamid.m4', '5492995550001', 'estado');
select is(pg_temp.ctx('wamid.m4')::jsonb->>'outcome', 'inactive_silent', 'cerrarle las sesiones después de vincular también corta WhatsApp');
set local role postgres;
delete from public.identity_user_security where business_id = 'b7000000-0000-4000-8000-000000000001' and user_id = 'a7000000-0000-4000-8000-000000000002';
select is((select count(*)::integer from public.fiscal_documents where source_type = 'online_order' and source_id = 'd7000000-0000-4000-8000-000000000004'), 0,
  'el pedido de un miembro dado de baja no se facturó');
select pg_temp.put('link1', (select id::text from public.whatsapp_links where phone_e164 = '5492995550001' and revoked_at is null));
set local role authenticated;
select pg_temp.as_user('a7000000-0000-4000-8000-000000000003','c7000000-0000-4000-8000-000000000003');
select throws_ok(format($$select public.revoke_whatsapp_link(%L)$$, pg_temp.ctx('link1')), '42501', 'operador no autorizado', 'un rider no revoca vínculos');
select pg_temp.as_user('a7000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000001');
select is((public.revoke_whatsapp_link(pg_temp.ctx('link1')::uuid, 'perdió el teléfono'))->>'idempotent_replay',
  'false', 'el dueño revoca el vínculo desde el Panel');
set local role service_role;
select pg_temp.service();
select pg_temp.say('wamid.m5', '5492995550001', 'facturar wa-4');
select is(pg_temp.ctx('wamid.m5')::jsonb->>'outcome', 'unlinked_silent', 'revocado: ese teléfono ya no opera');

-- ══ 5 · Varios negocios: elección explícita ═════════════════════════════════════════════
set local role authenticated;
select pg_temp.as_user('a7000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000001');
select pg_temp.put('codeA', public.create_whatsapp_pairing('b7000000-0000-4000-8000-000000000001')->>'code');
set local role service_role;
select pg_temp.service();
select pg_temp.say('wamid.n1', '5492995550002', 'vincular ' || pg_temp.ctx('codeA'));
set local role authenticated;
select pg_temp.as_user('a7000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-00000000000b');
select pg_temp.put('codeB', public.create_whatsapp_pairing('b7000000-0000-4000-8000-000000000002')->>'code');
set local role service_role;
select pg_temp.service();
select pg_temp.say('wamid.n2', '5492995550002', 'vincular ' || pg_temp.ctx('codeB'));
set local role postgres;
delete from public.whatsapp_sessions where phone_e164 = '5492995550002';
set local role service_role;
select pg_temp.service();
select pg_temp.say('wamid.n3', '5492995550002', 'pendientes');
select is(pg_temp.body('wamid.n3'), E'Este WhatsApp está vinculado a más de un negocio. Elegí uno antes de seguir:\n1) TABA WA A\n2) TABA WA B\nRespondé: negocio 1',
  'con dos negocios y sin elección, no se adivina');
select pg_temp.say('wamid.n4', '5492995550002', 'negocio 2');
select is(pg_temp.body('wamid.n4'), 'Listo: ahora hablás por TABA WA B.', 'la elección es explícita');
select pg_temp.say('wamid.n5', '5492995550002', 'facturar wb-1');
select ok(pg_temp.body('wamid.n5') like '[TABA WA B] WB-1 · Configuración fiscal pendiente: La facturación está desactivada%',
  'cada respuesta dice de qué negocio habla; B no factura sin configuración');
select pg_temp.say('wamid.n6', '5492995550002', 'negocio taba-wa-a');
select pg_temp.say('wamid.n7', '5492995550002', 'facturar wa-1');
select ok(pg_temp.body('wamid.n7') like E'[TABA WA A] Ese pedido ya tiene la factura pedida.%', 'también se elige por el slug');

-- ══ 6 · Autorizado: el PDF por el id del ARTEFACTO ══════════════════════════════════════
select pg_temp.put('epoch', (select lease_epoch::text from public.claim_fiscal_outbox('wa-test-worker','homologation','20123456786',5,120)
                              where fiscal_document_id = pg_temp.ctx('docw1')::uuid));
select is((public.reserve_fiscal_document_number(pg_temp.ctx('docw1')::uuid,'wa-test-worker',pg_temp.ctx('epoch')::bigint,1,(now() at time zone 'America/Argentina/Buenos_Aires')::date)).document_number,
  1::bigint, 'el worker reserva el número');
select is(public.complete_fiscal_attempt((select id from public.fiscal_outbox where fiscal_document_id = pg_temp.ctx('docw1')::uuid),'wa-test-worker',pg_temp.ctx('epoch')::bigint,
  '{"classification":"authorized","cae":"74000000000009","document_number":1,"cae_expiration":"2026-10-07","simulated":"CAE_SINTETICO_DE_PRUEBA"}'::jsonb)->>'state',
  'authorized', 'autorización SIMULADA de prueba');
set local role postgres;
-- FIXTURE: la fila que deja el worker de PDF (el worker real lo prueba el script de verificación).
with artifact as (
  insert into public.fiscal_document_artifacts(business_id, fiscal_document_id, artifact_type, state, storage_provider, storage_path, mime_type, size_bytes, sha256,
    document_number, generated_at, generated_by, generation_version, generation_token, is_current)
  values ('b7000000-0000-4000-8000-000000000001', pg_temp.ctx('docw1')::uuid, 'authorized_pdf', 'artifact_ready', 'supabase_storage',
    'fiscal/b7000000-0000-4000-8000-000000000001/' || pg_temp.ctx('docw1') || '/' || gen_random_uuid() || '.pdf', 'application/pdf', 1024, repeat('a', 64),
    1, now(), 'pgtap-fixture', 'fixture-1', gen_random_uuid(), true)
  returning id)
select pg_temp.put('artifact', (select id::text from artifact));
set local role service_role;
select pg_temp.service();
select pg_temp.say('wamid.a1', '5492995550002', 'estado wa-1');
select is(pg_temp.body('wamid.a1'), E'[TABA WA A] WA-1 · Factura emitida\nFactura B 00006-00000001 · CAE de homologación 74000000000009\nHOMOLOGACIÓN · sin validez fiscal',
  'emitida: número, CAE de homologación y la marca de que no es fiscal');
select is((pg_temp.ctx('wamid.a1')::jsonb->'replies'->1->>'kind') || ':' || (pg_temp.ctx('wamid.a1')::jsonb->'replies'->1->>'artifact_id'),
  'document:' || pg_temp.ctx('artifact'), 'el PDF sale por el id del ARTEFACTO vigente, no el del comprobante');
select is((public.whatsapp_outbound_artifact((pg_temp.ctx('wamid.a1')::jsonb->'replies'->1->>'id')::uuid))->>'filename',
  'comprobante-00006-00000001.pdf', 'la función de envío obtiene la ruta privada del artefacto de ESE negocio');

-- ══ 7 · Entradas, permisos, privacidad ══════════════════════════════════════════════════
set local role authenticated;
select pg_temp.as_user('a7000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000001');
select throws_ok($$select public.whatsapp_handle_inbound('wamid.x1','5492995550009','1','text','estado')$$, '42501', null,
  'un usuario autenticado no inyecta mensajes');
select is((select count(*)::integer from jsonb_array_elements(public.list_whatsapp_links('b7000000-0000-4000-8000-000000000001'))), 1,
  'el dueño ve los vínculos activos del negocio');
select is((public.list_whatsapp_links('b7000000-0000-4000-8000-000000000001')->0->>'phone_hint'), '+54 ••• 0002', 'el número vuelve enmascarado');
select pg_temp.as_user('a7000000-0000-4000-8000-000000000002','c7000000-0000-4000-8000-000000000002');
select is(jsonb_array_length(public.list_whatsapp_links('b7000000-0000-4000-8000-000000000001')), 0, 'un empleado solo ve los suyos');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$select public.whatsapp_handle_inbound('wamid.x2','5492995550009','1','text','estado')$$, '42501', 'canal de servidor no autorizado',
  'sin JWT de service_role, el GRANT no alcanza');
select pg_temp.service();
select throws_ok($$select public.whatsapp_handle_inbound('wamid.x3','+54 9 299','1','text','estado')$$, '22023', 'mensaje de WhatsApp invalido',
  'un teléfono que no es un wa_id se rechaza');
select is((pg_temp.wa('wamid.x4', '5492995550007', null, 'image'))->>'outcome', 'unsupported_type_silent', 'una imagen de un número sin vínculo: silencio');
select is(((pg_temp.wa('wamid.x5', '5492995550002', null, 'image'))->'replies'->0->>'body'), 'Por ahora solo entiendo mensajes de texto. Escribí: ayuda',
  'a un vinculado se le explica');
select lives_ok(format($$select public.whatsapp_mark_outbound(%L, 'sent', 'wamid.provider.1')$$, pg_temp.ctx('wamid.a1')::jsonb->'replies'->0->>'id'),
  'la función marca lo que envió');
set local role postgres;
update public.whatsapp_outbound_messages set created_at = now() - interval '1 minute';
set local role service_role;
select pg_temp.service();
select ok(not (public.whatsapp_pending_outbound(50) @> jsonb_build_array(jsonb_build_object('id', pg_temp.ctx('wamid.a1')::jsonb->'replies'->0->>'id')))
          and jsonb_array_length(public.whatsapp_pending_outbound(50)) > 0,
  'lo enviado no se reintenta; lo pendiente sí');
select pg_temp.say('wamid.x6', '5492995550002', 'facturar wa-3');
set local role postgres;
select ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'whatsapp_inbound_messages'
                        and column_name in ('text', 'body', 'message', 'payload')), 'el texto libre de los mensajes no se guarda');
select throws_ok($$insert into public.whatsapp_pending_actions(business_id,user_id,link_id,phone_e164,action,order_id,order_code,order_total,source_message_id,expires_at)
  select business_id,user_id,link_id,phone_e164,action,order_id,order_code,order_total,'wamid.n7',now()+interval '5 minutes'
    from public.whatsapp_pending_actions where closed_at is null limit 1$$, '23505', null,
  'la base no admite dos confirmaciones abiertas para el mismo teléfono');
set local role authenticated;
select pg_temp.as_user('a7000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000001');
select is((public.get_order_fiscal_states('b7000000-0000-4000-8000-000000000001', array['d7000000-0000-4000-8000-000000000001']::uuid[])->0->'document'->>'artifact_id'),
  pg_temp.ctx('artifact'), 'el Panel lee el mismo estado (una sola implementación)');

select * from finish();
rollback;
