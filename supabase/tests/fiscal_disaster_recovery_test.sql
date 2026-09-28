-- LA TABA · RECUPERACIÓN ANTE DESASTRE FISCAL: LA PC DEL MOSTRADOR SE DESTRUYE
--
-- Nada fiscal vive sólo en la PC. Esta suite recorre el procedimiento de
-- docs/FISCAL-DISASTER-RECOVERY.md sobre el esquema real:
--   1. una factura de un pedido online se autoriza y se imprime en la PC vieja;
--   2. la PC se destruye: el dueño revoca el dispositivo; su credencial deja de valer y el
--      Panel sigue leyendo TODO desde el servidor (CAE, número, origen congelado, PDF, eventos);
--   3. PC nueva: código nuevo, dispositivo nuevo;
--   4. la factura vieja se reimprime desde la PC nueva: trabajo con reprint_of, el mismo CAE,
--      ningún CAE nuevo; la credencial vieja sigue sin valer;
--   5. una factura nueva se emite e imprime en la PC nueva;
--   6. repetir un paso del procedimiento no duplica nada.
--
-- Política, clasificación y CUIT: FIXTURES SINTÉTICOS. Las autorizaciones son SIMULADAS (CAE de
-- prueba) y el PDF es una fila de fixture. Los agentes son simulados con sus RPC reales; no hay
-- impresora (PHYSICAL_PRINT: NOT_VERIFIED). Todo transaccional: rollback.

begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

-- ── Fixture ─────────────────────────────────────────────────────────────────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
  ('a8d00000-0000-4000-8000-000000000001','authenticated','authenticated','dr-owner@example.invalid','',now(),'{}','{}',now(),now()),
  ('a8d00000-0000-4000-8000-000000000002','authenticated','authenticated','dr-staff@example.invalid','',now(),'{}','{}',now(),now());
insert into public.businesses(id,name,status,slug,is_active,operating_timezone) values
  ('b8d00000-0000-4000-8000-000000000001','TABA DR','open','taba-dr',true,'America/Argentina/Buenos_Aires');
insert into public.business_members(business_id,user_id,role,is_active) values
  ('b8d00000-0000-4000-8000-000000000001','a8d00000-0000-4000-8000-000000000001','owner',true),
  ('b8d00000-0000-4000-8000-000000000001','a8d00000-0000-4000-8000-000000000002','staff',true);
insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client) values
  ('c8d00000-0000-4000-8000-000000000001','a8d00000-0000-4000-8000-000000000001','b8d00000-0000-4000-8000-000000000001','owner','panel_web'),
  ('c8d00000-0000-4000-8000-000000000002','a8d00000-0000-4000-8000-000000000002','b8d00000-0000-4000-8000-000000000001','staff','panel_web');
insert into public.products(id,business_id,name,description,category,price,image_url,is_active,brand,subcategory,presentation,capacity,packaging_type,stock,available,is_alcoholic,tags,is_verified,verified_at,verified_by,external_id,variant,capacity_value,capacity_unit,catalog_origin,units_per_pack) values
  ('e8d00000-0000-4000-8000-000000000001','b8d00000-0000-4000-8000-000000000001','Gaseosa 2,25 L','Fixture DR','Aguas',1250,'https://example.invalid/p.webp',true,'Marca','Pruebas','Unidad','1 u','unidad',100,false,false,'{}',false,null,null,'dr-ext-gaseosa','Unidad',1,'unidad','commercial',1);
insert into public.fiscal_profiles(business_id,legal_name,cuit,tax_condition,business_address,environment,point_of_sale,default_currency,default_concept,
  invoice_policy,is_enabled,default_recipient_condition,accountant_review_status,certificate_fingerprint_sha256,certificate_expires_at,homologation_authorized_at,homologation_authorized_by)
values ('b8d00000-0000-4000-8000-000000000001','TABA DR SRL','20123456786','Responsable Inscripto','Direccion fixture','homologation',4,'PES',1,'manual',true,'Consumidor Final','approved',
  repeat('d',64),now()+interval '90 days',now(),'a8d00000-0000-4000-8000-000000000001');
insert into public.fiscal_parameter_snapshots(environment,parameter_type,version,values_json,synchronized_at) values
  ('homologation','document_types','dr-fixture','[{"Id":6},{"Id":8}]'::jsonb,now()),
  ('homologation','recipient_document_types','dr-fixture','[{"Id":99}]'::jsonb,now()),
  ('homologation','recipient_vat_conditions','dr-fixture','[{"Id":5}]'::jsonb,now()),
  ('homologation','vat_types','dr-fixture','{"IvaTipo":[{"Id":"5","Desc":"21%"}]}'::jsonb,now());
insert into public.fiscal_accounting_policies(business_id,environment,policy_version,valid_from,issuer_condition,recipient_condition,concept,invoice_type,credit_note_type,
  recipient_document_type,recipient_document_number,enabled,accountant_review_status,approved_by,approved_at,notes,recipient_vat_condition_id)
values ('b8d00000-0000-4000-8000-000000000001','homologation','dr-fixture',current_date,'Responsable Inscripto','Consumidor Final',1,6,8,99,'0',true,'approved',
  'a8d00000-0000-4000-8000-000000000001',now(),'Fixture sintetico; no constituye politica contable.',5);
insert into public.commercial_fiscal_policies(business_id,policy_version,valid_from,status,billing_moment,mercadopago_rule,cash_rule,coordinate_rule,
  vat_computation,delivery_treatment,delivery_vat_code,delivery_line_description,discount_treatment,final_consumer_id_threshold,credit_note_policy,
  accountant_reference,approved_by,approved_at,notes)
values ('b8d00000-0000-4000-8000-000000000001','dr-fixture-v1',current_date,'approved','after_payment_confirmed','require_approved','require_confirmed','require_confirmed',
  'price_includes_vat_per_rate','invoice_as_line',5,'Envío','prorate_by_item_gross',1000000.00,'manual_review_only',
  'FIXTURE DE PRUEBA - no es politica contable','a8d00000-0000-4000-8000-000000000001',now(),'Solo para pruebas automatizadas.');
insert into public.product_fiscal_classifications(business_id,product_id,classification,vat_code,source,classified_by) values
  ('b8d00000-0000-4000-8000-000000000001','e8d00000-0000-4000-8000-000000000001','taxed',5,'accountant','a8d00000-0000-4000-8000-000000000001');
insert into public.orders(id,business_id,code,public_code,status,fulfillment_type,delivery_mode,client_request_id,customer_name,customer_phone,payment_method,subtotal,discount_total,delivery_fee,total,origin) values
  ('d8d00000-0000-4000-8000-000000000001','b8d00000-0000-4000-8000-000000000001','DR-1','DR-1','accepted','pickup','pickup','dr-order-0001','CLIENTE_SINTETICO','+540000000000','cash',2500,0,0,2500,'production'),
  ('d8d00000-0000-4000-8000-000000000002','b8d00000-0000-4000-8000-000000000001','DR-2','DR-2','accepted','pickup','pickup','dr-order-0002','CLIENTE_SINTETICO','+540000000000','cash',1250,0,0,1250,'production');
insert into public.order_items(order_id,product_id,product_uuid,name,quantity,unit,unit_price,subtotal) values
  ('d8d00000-0000-4000-8000-000000000001', null, 'e8d00000-0000-4000-8000-000000000001', 'Gaseosa 2,25 L', 2, 'u', 1250, 2500),
  ('d8d00000-0000-4000-8000-000000000002', null, 'e8d00000-0000-4000-8000-000000000001', 'Gaseosa 2,25 L', 1, 'u', 1250, 1250);
update public.orders set manual_payment_status = 'confirmed', manual_payment_method = 'cash', manual_payment_confirmed_at = now(),
       manual_payment_confirmed_by = 'a8d00000-0000-4000-8000-000000000002'
 where business_id = 'b8d00000-0000-4000-8000-000000000001';

create temporary table t_ctx(k text primary key, v text) on commit drop;
grant all on t_ctx to authenticated, service_role;
create or replace function pg_temp.ctx(p_key text) returns text language sql as $$ select v from t_ctx where k = p_key $$;
create or replace function pg_temp.put(p_key text, p_value text) returns text language sql as $$
  insert into t_ctx values (p_key, p_value) on conflict (k) do update set v = excluded.v returning v $$;
create or replace function pg_temp.as_user(p_user uuid, p_session uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', p_session)::text, true)::void $$;
create or replace function pg_temp.service() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true)::void $$;
create or replace function pg_temp.h(p_secret text) returns text language sql as $$
  select encode(extensions.digest(convert_to(p_secret, 'UTF8'), 'sha256'), 'hex') $$;
-- Autorización SIMULADA por las RPC del worker (claim → reserva → cierre), como en producción.
create or replace function pg_temp.authorize(p_document uuid, p_number bigint, p_cae text) returns text language plpgsql as $$
declare v_epoch bigint;
begin
  select lease_epoch into v_epoch from public.claim_fiscal_outbox('dr-test-worker','homologation','20123456786',5,120) where fiscal_document_id = p_document;
  perform public.reserve_fiscal_document_number(p_document,'dr-test-worker',v_epoch,p_number,(now() at time zone 'America/Argentina/Buenos_Aires')::date);
  return public.complete_fiscal_attempt((select id from public.fiscal_outbox where fiscal_document_id = p_document),'dr-test-worker',v_epoch,
    jsonb_build_object('classification','authorized','cae',p_cae,'document_number',p_number,'cae_expiration','2026-10-07','simulated','CAE_SINTETICO_DE_PRUEBA'))->>'state';
end $$;

-- ══ 1 · La factura vive en el servidor ════════════════════════════════════════════════
set local role authenticated;
select pg_temp.as_user('a8d00000-0000-4000-8000-000000000002','c8d00000-0000-4000-8000-000000000002');
select pg_temp.put('doc1', public.request_order_invoice('b8d00000-0000-4000-8000-000000000001','d8d00000-0000-4000-8000-000000000001','dr-o1-0001','PANEL',true)->>'fiscal_document_id');
set local role service_role;
select pg_temp.service();
select is(pg_temp.authorize(pg_temp.ctx('doc1')::uuid, 1, '74000000000011'), 'authorized', 'la factura del pedido DR-1 se autoriza (SIMULADA)');
set local role postgres;
-- FIXTURE: la fila que deja el worker de PDF.
insert into public.fiscal_document_artifacts(business_id, fiscal_document_id, artifact_type, state, storage_provider, storage_path, mime_type, size_bytes, sha256,
  document_number, generated_at, generated_by, generation_version, generation_token, is_current)
values ('b8d00000-0000-4000-8000-000000000001', pg_temp.ctx('doc1')::uuid, 'authorized_pdf', 'artifact_ready', 'supabase_storage',
  'fiscal/b8d00000-0000-4000-8000-000000000001/' || pg_temp.ctx('doc1') || '/' || gen_random_uuid() || '.pdf', 'application/pdf', 2048, repeat('b', 64),
  1, now(), 'pgtap-fixture', 'fixture-1', gen_random_uuid(), true);
set local role authenticated;
select pg_temp.as_user('a8d00000-0000-4000-8000-000000000001','c8d00000-0000-4000-8000-000000000001');
select pg_temp.put('pairA', public.create_local_device_pairing('b8d00000-0000-4000-8000-000000000001', 'Mostrador (PC vieja)')->>'pairing_code');
set local role service_role;
select pg_temp.service();
select pg_temp.put('devA', public.agent_register_device(pg_temp.ctx('pairA'), pg_temp.h('secreto-pc-vieja'), 'Mostrador (PC vieja)', 'windows', '0.1.0')->>'device_id');
select pg_temp.put('claimA', public.agent_claim_print_jobs(pg_temp.ctx('devA')::uuid, pg_temp.h('secreto-pc-vieja'), array['fiscal_receipt'], 5)::text);
select pg_temp.put('job1', pg_temp.ctx('claimA')::jsonb->'jobs'->0->>'id');
select lives_ok(format($$select public.agent_update_print_job(%L, %L, %L, %L, 'printing')$$, pg_temp.ctx('devA'), pg_temp.h('secreto-pc-vieja'),
  pg_temp.ctx('job1'), pg_temp.ctx('claimA')::jsonb->'jobs'->0->>'claim_token'), 'la PC vieja empieza a imprimir el ticket fiscal');
select lives_ok(format($$select public.agent_update_print_job(%L, %L, %L, %L, 'printed', null, 700)$$, pg_temp.ctx('devA'), pg_temp.h('secreto-pc-vieja'),
  pg_temp.ctx('job1'), pg_temp.ctx('claimA')::jsonb->'jobs'->0->>'claim_token'), 'y lo imprime (agente SIMULADO)');

-- ══ 2 · La PC se destruye ═══════════════════════════════════════════════════════════
set local role authenticated;
select pg_temp.as_user('a8d00000-0000-4000-8000-000000000001','c8d00000-0000-4000-8000-000000000001');
select is(public.revoke_local_device(pg_temp.ctx('devA')::uuid, 'PC del mostrador destruida')->>'status', 'revoked', 'el dueño revoca la PC destruida');
select is(public.get_local_print_status('b8d00000-0000-4000-8000-000000000001')->>'agent', 'OFFLINE', 'el Panel dice que no hay PC de impresión activa');
select is((select jsonb_build_object('state', x->'document'->>'state', 'cae', x->'document'->>'cae', 'number', x->'document'->>'document_number',
                                     'pdf', x->'document'->>'artifact_id' is not null, 'print', x->'print'->'latest_job'->>'status')
             from jsonb_array_elements(public.get_order_fiscal_states('b8d00000-0000-4000-8000-000000000001', array['d8d00000-0000-4000-8000-000000000001']::uuid[])) x),
  '{"state":"authorized","cae":"74000000000011","number":"1","pdf":true,"print":"printed"}'::jsonb,
  'sin la PC, el Panel lee la factura entera desde el servidor: estado, CAE, número, PDF e impresión');
set local role service_role;
select pg_temp.service();
select throws_ok(format($$select public.agent_claim_print_jobs(%L, %L, array['fiscal_receipt'], 5)$$, pg_temp.ctx('devA'), pg_temp.h('secreto-pc-vieja')),
  '42501', 'dispositivo no autorizado', 'la credencial de la PC destruida ya no vale');
set local role postgres;
select ok(exists (select 1 from public.fiscal_source_snapshots s where s.source_type = 'online_order' and s.source_id = 'd8d00000-0000-4000-8000-000000000001'),
  'el origen congelado del pedido está en el servidor');
select is((select array_agg(distinct event_type order by event_type) @> array['authorized', 'queued'] from public.fiscal_events where fiscal_document_id = pg_temp.ctx('doc1')::uuid),
  true, 'y la historia de eventos del comprobante también');
select ok(exists (select 1 from public.fiscal_document_artifacts a where a.fiscal_document_id = pg_temp.ctx('doc1')::uuid and a.is_current
                    and a.sha256 ~ '^[0-9a-f]{64}$' and a.storage_path like 'fiscal/%'), 'y los metadatos del PDF vigente (ruta privada y hash)');

-- ══ 3 · PC nueva ═══════════════════════════════════════════════════════════════════
set local role authenticated;
select pg_temp.as_user('a8d00000-0000-4000-8000-000000000001','c8d00000-0000-4000-8000-000000000001');
select pg_temp.put('pairB', public.create_local_device_pairing('b8d00000-0000-4000-8000-000000000001', 'Mostrador (PC nueva)')->>'pairing_code');
set local role service_role;
select pg_temp.service();
select pg_temp.put('devB', public.agent_register_device(pg_temp.ctx('pairB'), pg_temp.h('secreto-pc-nueva'), 'Mostrador (PC nueva)', 'windows', '0.1.0')->>'device_id');
select isnt(pg_temp.ctx('devB'), pg_temp.ctx('devA'), 'la PC nueva es otro dispositivo, con otra credencial');
set local role authenticated;
select pg_temp.as_user('a8d00000-0000-4000-8000-000000000001','c8d00000-0000-4000-8000-000000000001');
select is(public.get_local_print_status('b8d00000-0000-4000-8000-000000000001')->>'agent', 'ONLINE', 'con la PC nueva, el Panel vuelve a tener impresión');

-- ══ 4 · Reimprimir la factura vieja desde la PC nueva ══════════════════════════════════
select pg_temp.as_user('a8d00000-0000-4000-8000-000000000002','c8d00000-0000-4000-8000-000000000002');
select pg_temp.put('job2', public.request_print_job_reprint(pg_temp.ctx('job1')::uuid, 'PC reemplazada: copia para el cliente', 'dr-reprint-0001')->>'print_job_id');
select is((select reprint_of::text || ':' || reprint_reason || ':' || status from public.print_jobs where id = pg_temp.ctx('job2')::uuid),
  pg_temp.ctx('job1') || ':PC reemplazada: copia para el cliente:queued', 'la reimpresión es un trabajo nuevo, con reprint_of y motivo');
select is(public.request_print_job_reprint(pg_temp.ctx('job1')::uuid, 'PC reemplazada: copia para el cliente', 'dr-reprint-0001')->>'print_job_id',
  pg_temp.ctx('job2'), 'repetir el pedido con la misma clave no crea otra reimpresión');
set local role service_role;
select pg_temp.service();
select pg_temp.put('claimB', public.agent_claim_print_jobs(pg_temp.ctx('devB')::uuid, pg_temp.h('secreto-pc-nueva'), array['fiscal_receipt'], 5)::text);
select is((select jsonb_build_object('job', x->>'id', 'reprint_of', x->>'reprint_of', 'cae', x->'payload'->>'cae', 'number', x->'payload'->'voucher'->>'number')
             from jsonb_array_elements(pg_temp.ctx('claimB')::jsonb->'jobs') x),
  jsonb_build_object('job', pg_temp.ctx('job2'), 'reprint_of', pg_temp.ctx('job1'), 'cae', '74000000000011', 'number', '1'),
  'la PC nueva toma la reimpresión de la factura vieja: mismo CAE, marcada como reimpresión');
select lives_ok(format($$select public.agent_update_print_job(%L, %L, %L, %L, 'printing')$$, pg_temp.ctx('devB'), pg_temp.h('secreto-pc-nueva'),
  pg_temp.ctx('job2'), pg_temp.ctx('claimB')::jsonb->'jobs'->0->>'claim_token')
  || format($$; select public.agent_update_print_job(%L, %L, %L, %L, 'printed', null, 650)$$, pg_temp.ctx('devB'), pg_temp.h('secreto-pc-nueva'),
  pg_temp.ctx('job2'), pg_temp.ctx('claimB')::jsonb->'jobs'->0->>'claim_token'), 'y la imprime');
set local role postgres;
select is((select count(*)::integer || ':' || max(dispatch_count) from public.fiscal_documents where source_type = 'online_order' and source_id = 'd8d00000-0000-4000-8000-000000000001'),
  '1:1', 'reimprimir no pide otro CAE ni crea otro comprobante');

-- ══ 5 · Una factura nueva, con la PC nueva ═══════════════════════════════════════════
set local role authenticated;
select pg_temp.as_user('a8d00000-0000-4000-8000-000000000002','c8d00000-0000-4000-8000-000000000002');
select pg_temp.put('doc2', public.request_order_invoice('b8d00000-0000-4000-8000-000000000001','d8d00000-0000-4000-8000-000000000002','dr-o2-0001','PANEL',true)->>'fiscal_document_id');
set local role service_role;
select pg_temp.service();
select is(pg_temp.authorize(pg_temp.ctx('doc2')::uuid, 2, '74000000000012'), 'authorized', 'la factura nueva se autoriza con el número siguiente');
select pg_temp.put('claimB2', public.agent_claim_print_jobs(pg_temp.ctx('devB')::uuid, pg_temp.h('secreto-pc-nueva'), array['fiscal_receipt'], 5)::text);
select is((select jsonb_build_object('document', x->'payload'->'voucher'->>'number', 'cae', x->'payload'->>'cae', 'reprint_of', x->>'reprint_of')
             from jsonb_array_elements(pg_temp.ctx('claimB2')::jsonb->'jobs') x),
  '{"document":"2","cae":"74000000000012","reprint_of":null}'::jsonb, 'y su primer ticket sale por la PC nueva');

-- ══ 6 · Repetir un paso no duplica nada ═════════════════════════════════════════════
set local role authenticated;
select pg_temp.as_user('a8d00000-0000-4000-8000-000000000001','c8d00000-0000-4000-8000-000000000001');
select is(public.revoke_local_device(pg_temp.ctx('devA')::uuid, 'PC del mostrador destruida')->>'status', 'revoked', 'revocar otra vez es inocuo');
set local role service_role;
select pg_temp.service();
select throws_ok(format($$select public.agent_claim_print_jobs(%L, %L, array['fiscal_receipt'], 5)$$, pg_temp.ctx('devA'), pg_temp.h('secreto-pc-vieja')),
  '42501', 'dispositivo no autorizado', 'y la PC vieja sigue afuera');

select * from finish();
rollback;
