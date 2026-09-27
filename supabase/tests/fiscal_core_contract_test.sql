-- TABA · ADOPCION DEL CORE FISCAL: el contrato de taba-fiscal@26d2f4c sobre el esquema REAL
--
-- Lo que esta suite tiene que demostrar, con la cadena real de migraciones de
-- La Taba (sesiones de identidad, roles owner/admin/staff/rider, pos_sales,
-- productos), no con los stubs del core:
--
--   1. las RPC del worker canonico existen con las firmas y los NOMBRES de
--      argumento que manda SupabaseFiscalStore por PostgREST, sin sobrecargas
--      viejas que un worker anterior pueda llamar; grants exactos;
--   2. ninguna funcion ejecutable por anon o authenticated envuelve la entrada
--      de servidor ni las RPC del worker (el agujero de bill_commercial_order);
--   3. una venta, una intencion, un comprobante: PANEL, MOBILE, WHATSAPP y
--      AUTOMATION convergen; CommandSource solo queda como auditoria;
--   4. falla cerrado: online_order bloqueado; sin snapshot impositivo (lo que
--      hoy escribe checkout_pos_sale) no hay factura (ACCOUNTING_POLICY_REQUIRED
--      = P0001 fiscal_policy_review_required);
--   5. aislamiento entre negocios y guardas de La Taba en el canal de servidor;
--   6. fencing del worker y maquina de estados.
--
-- La concurrencia real (10/50/100 conexiones) no entra en pgTAP: la corre
-- scripts/fiscal-core/intent-race.mjs. anon se verifica con has_*_privilege.
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(50);

-- ── Fixture ────────────────────────────────────────────────────────────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('a0c10000-0000-4000-8000-000000000001','authenticated','authenticated','core-owner-a@example.invalid','',now(),'{}','{}',now(),now()),
  ('a0c10000-0000-4000-8000-000000000002','authenticated','authenticated','core-staff-a@example.invalid','',now(),'{}','{}',now(),now()),
  ('a0c10000-0000-4000-8000-000000000003','authenticated','authenticated','core-rider-a@example.invalid','',now(),'{}','{}',now(),now()),
  ('a0c10000-0000-4000-8000-000000000004','authenticated','authenticated','core-exstaff-a@example.invalid','',now(),'{}','{}',now(),now()),
  ('a0c10000-0000-4000-8000-000000000005','authenticated','authenticated','core-owner-b@example.invalid','',now(),'{}','{}',now(),now()),
  ('a0c10000-0000-4000-8000-000000000006','authenticated','authenticated','core-staff2-a@example.invalid','',now(),'{}','{}',now(),now());

insert into public.businesses(id,name,status,slug,is_active,operating_timezone)
values
  ('b0c10000-0000-4000-8000-000000000001','TABA CORE A','open','taba-core-a',true,'America/Argentina/Buenos_Aires'),
  ('b0c10000-0000-4000-8000-000000000002','TABA CORE B','open','taba-core-b',true,'America/Argentina/Buenos_Aires');

insert into public.business_members(business_id,user_id,role,is_active)
values
  ('b0c10000-0000-4000-8000-000000000001','a0c10000-0000-4000-8000-000000000001','owner',true),
  ('b0c10000-0000-4000-8000-000000000001','a0c10000-0000-4000-8000-000000000002','staff',true),
  ('b0c10000-0000-4000-8000-000000000001','a0c10000-0000-4000-8000-000000000003','rider',true),
  ('b0c10000-0000-4000-8000-000000000001','a0c10000-0000-4000-8000-000000000004','staff',false),
  ('b0c10000-0000-4000-8000-000000000002','a0c10000-0000-4000-8000-000000000005','owner',true),
  ('b0c10000-0000-4000-8000-000000000001','a0c10000-0000-4000-8000-000000000006','staff',true);

insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
values
  ('c0c10000-0000-4000-8000-000000000002','a0c10000-0000-4000-8000-000000000002','b0c10000-0000-4000-8000-000000000001','staff','panel_web'),
  ('c0c10000-0000-4000-8000-000000000003','a0c10000-0000-4000-8000-000000000003','b0c10000-0000-4000-8000-000000000001','rider','rider_android'),
  ('c0c10000-0000-4000-8000-000000000005','a0c10000-0000-4000-8000-000000000005','b0c10000-0000-4000-8000-000000000002','owner','panel_web'),
  ('c0c10000-0000-4000-8000-000000000006','a0c10000-0000-4000-8000-000000000006','b0c10000-0000-4000-8000-000000000001','staff','panel_web');

insert into public.products(id,business_id,name,description,category,price,image_url,is_active,brand,subcategory,presentation,capacity,packaging_type,stock,available,is_alcoholic,tags,is_verified,verified_at,verified_by,external_id,variant,capacity_value,capacity_unit,catalog_origin,units_per_pack)
values('e0c10000-0000-4000-8000-000000000001','b0c10000-0000-4000-8000-000000000001','Producto contrato','Fixture','Aguas',1250,'https://example.invalid/p.webp',true,'Marca','Pruebas','Unidad','1 u','unidad',100,false,false,'{}',false,null,null,'core-contract-fixture','Unidad',1,'unidad','test_only',1);

-- Perfil de homologacion autorizado (el gate de La Taba lo exige) y politica aprobada con RG 5616.
insert into public.fiscal_profiles(
  business_id,legal_name,cuit,tax_condition,business_address,environment,point_of_sale,default_currency,default_concept,
  invoice_policy,is_enabled,default_recipient_condition,accountant_review_status,certificate_fingerprint_sha256,certificate_expires_at,
  homologation_authorized_at,homologation_authorized_by
) values (
  'b0c10000-0000-4000-8000-000000000001','TABA CORE A SRL','20123456786','Responsable Inscripto','Direccion fiscal fixture','homologation',5,'PES',1,
  'manual',true,'Consumidor Final','approved',repeat('b',64),now()+interval '90 days',now(),'a0c10000-0000-4000-8000-000000000001'
);
insert into public.fiscal_parameter_snapshots(environment,parameter_type,version,values_json,synchronized_at) values
  ('homologation','document_types','core-contract-v1','[{"Id":6},{"Id":8},{"Id":11},{"Id":13}]'::jsonb,now()),
  ('homologation','recipient_document_types','core-contract-v1','[{"Id":96},{"Id":99}]'::jsonb,now()),
  ('homologation','recipient_vat_conditions','core-contract-v1','[{"Id":5}]'::jsonb,now());
insert into public.fiscal_accounting_policies(
  business_id,environment,policy_version,valid_from,issuer_condition,recipient_condition,concept,invoice_type,credit_note_type,
  recipient_document_type,recipient_document_number,enabled,accountant_review_status,approved_by,approved_at,notes,recipient_vat_condition_id
) values (
  'b0c10000-0000-4000-8000-000000000001','homologation','core-contract-v1',current_date,'Responsable Inscripto','Consumidor Final',1,6,8,
  99,'0',true,'approved','a0c10000-0000-4000-8000-000000000001',now(),'Fixture sintetico; no constituye politica contable.',5
);

-- S1 y S3: ventas con un snapshot impositivo SINTETICO de prueba (no es politica contable de nadie).
-- S2: exactamente lo que hoy escribe checkout_pos_sale, sin importes impositivos.
insert into public.pos_sales(id,business_id,operator_id,state,subtotal,total,currency,idempotency_key,completed_at) values
  ('d0c10000-0000-4000-8000-000000000001','b0c10000-0000-4000-8000-000000000001','a0c10000-0000-4000-8000-000000000002','completed',2500,2500,'PES','core-contract-sale-1',now()),
  ('d0c10000-0000-4000-8000-000000000002','b0c10000-0000-4000-8000-000000000001','a0c10000-0000-4000-8000-000000000002','completed',2500,2500,'PES','core-contract-sale-2',now()),
  ('d0c10000-0000-4000-8000-000000000003','b0c10000-0000-4000-8000-000000000001','a0c10000-0000-4000-8000-000000000002','completed',2500,2500,'PES','core-contract-sale-3',now());
insert into public.pos_sale_items(sale_id,product_id,product_name,quantity,unit_price,line_total,tax_snapshot) values
  ('d0c10000-0000-4000-8000-000000000001','e0c10000-0000-4000-8000-000000000001','Producto contrato',2,1250,2500,
   '{"net_amount":"2066.12","tax_amount":"433.88","tax_code":"5","exempt_amount":"0.00","non_taxed_amount":"0.00","other_taxes_amount":"0.00","fixture":"SINTETICO_NO_ES_POLITICA_CONTABLE"}'),
  ('d0c10000-0000-4000-8000-000000000002','e0c10000-0000-4000-8000-000000000001','Producto contrato',2,1250,2500,
   '{"configured_by_server":true}'),
  ('d0c10000-0000-4000-8000-000000000003','e0c10000-0000-4000-8000-000000000001','Producto contrato',2,1250,2500,
   '{"net_amount":"2066.12","tax_amount":"433.88","tax_code":"5","exempt_amount":"0.00","non_taxed_amount":"0.00","other_taxes_amount":"0.00","fixture":"SINTETICO_NO_ES_POLITICA_CONTABLE"}');

create temporary table t_ctx(k text primary key, v text) on commit drop;
grant all on t_ctx to authenticated, service_role;
create or replace function pg_temp.ctx(p_key text) returns text language sql as $$ select v from t_ctx where k = p_key $$;
create or replace function pg_temp.put(p_key text, p_value text) returns text language sql as $$
  insert into t_ctx values (p_key, p_value) on conflict (k) do update set v = excluded.v returning v $$;
create or replace function pg_temp.as_staff(p_user uuid, p_session uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', p_session)::text, true)::void $$;
create or replace function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true)::void $$;

-- ══ 1 · SUPERFICIE: firmas, nombres de argumento, sobrecargas y grants ═══════
select has_function('public', 'request_fiscal_document', array['uuid','text','uuid','text','text','text'],
  'request_fiscal_document: entrada unica del Panel y el celular (p_command_source opcional)');
select has_function('public', 'service_request_fiscal_document', array['uuid','text','uuid','text','text','text','uuid'],
  'service_request_fiscal_document: entrada de los canales de servidor');

select is((
  select count(*)::integer from (values
    ('claim_fiscal_outbox','p_worker_id,p_environment,p_cuit,p_limit,p_lease_seconds'),
    ('reserve_fiscal_document_number','p_document_id,p_worker_id,p_lease_epoch,p_expected_number,p_issue_date'),
    ('begin_fiscal_resend','p_document_id,p_worker_id,p_lease_epoch,p_expected_number'),
    ('complete_fiscal_attempt','p_outbox_id,p_worker_id,p_lease_epoch,p_result'),
    ('claim_fiscal_artifact_outbox','p_worker_id,p_limit,p_lease_seconds'),
    ('complete_fiscal_artifact','p_artifact_outbox_id,p_worker_id,p_lease_epoch,p_artifact'),
    ('fail_fiscal_artifact','p_artifact_outbox_id,p_worker_id,p_lease_epoch,p_error_code,p_error_message,p_retryable'),
    ('save_fiscal_parameter_snapshot','p_environment,p_parameter_type,p_version,p_values_json,p_synchronized_at')
  ) e(name, args)
  where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname = e.name and array_to_string(p.proargnames, ',') = e.args)),
  0, 'las 8 RPC del worker canonico existen con los nombres de argumento que envia SupabaseFiscalStore (PostgREST)');

select ok(
  to_regprocedure('public.claim_fiscal_outbox(text,integer,integer)') is null
  and to_regprocedure('public.reserve_fiscal_document_number(uuid,text,bigint)') is null
  and to_regprocedure('public.complete_fiscal_attempt(uuid,text,jsonb)') is null
  and to_regprocedure('public.request_fiscal_document(uuid,text,uuid,text,text)') is null
  and to_regprocedure('public.complete_fiscal_artifact(uuid,text,jsonb)') is null
  and to_regprocedure('public.complete_fiscal_artifact_unchecked(uuid,text,jsonb)') is null
  and to_regprocedure('public.fail_fiscal_artifact(uuid,text,text,text,boolean)') is null,
  'las firmas del worker anterior no existen: un worker viejo falla cerrado, no reclama ni emite');

select is((
  select count(*)::integer from (
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in (
       'request_fiscal_document','service_request_fiscal_document','claim_fiscal_outbox','reserve_fiscal_document_number',
       'begin_fiscal_resend','complete_fiscal_attempt','claim_fiscal_artifact_outbox','complete_fiscal_artifact',
       'fail_fiscal_artifact','save_fiscal_parameter_snapshot','request_credit_note','request_fiscal_print_job')
     group by p.proname having count(*) > 1) dup),
  0, 'ninguna RPC fiscal tiene sobrecargas: PostgREST no puede elegir una version vieja');

select ok(not exists (
  select 1 from unnest(array[
    'public.claim_fiscal_outbox(text,text,text,integer,integer)','public.reserve_fiscal_document_number(uuid,text,bigint,bigint,date)',
    'public.begin_fiscal_resend(uuid,text,bigint,bigint)','public.complete_fiscal_attempt(uuid,text,bigint,jsonb)',
    'public.claim_fiscal_artifact_outbox(text,integer,integer)','public.complete_fiscal_artifact(uuid,text,bigint,jsonb)',
    'public.fail_fiscal_artifact(uuid,text,bigint,text,text,boolean)','public.service_request_fiscal_document(uuid,text,uuid,text,text,text,uuid)']) f
   where has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
      or not has_function_privilege('service_role', f, 'EXECUTE')),
  'worker y canales de servidor: solo service_role');

select ok(not exists (
  select 1 from unnest(array[
    'public.request_fiscal_document(uuid,text,uuid,text,text,text)','public.request_credit_note(uuid,text,text,jsonb,text)',
    'public.request_fiscal_print_job(uuid,uuid,text,text,integer,text)','public.update_fiscal_print_job(uuid,text,text)',
    'public.list_fiscal_document_artifacts(uuid)','public.authorize_fiscal_artifact_access(uuid,text)',
    'public.request_fiscal_artifact_regeneration(uuid)']) f
   where has_function_privilege('anon', f, 'EXECUTE') or not has_function_privilege('authenticated', f, 'EXECUTE')),
  'RPC del Panel: authenticated si, anon no');

select ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname ~ '^fiscal_'
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  'ninguna funcion private.fiscal_* es ejecutable por anon o authenticated');

select is((
  select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public','private')
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
     and p.prosrc ~ '(service_request_fiscal_document|claim_fiscal_outbox|reserve_fiscal_document_number|begin_fiscal_resend|complete_fiscal_attempt|claim_fiscal_artifact_outbox|complete_fiscal_artifact|fail_fiscal_artifact)\s*\('),
  0, 'ninguna funcion que anon o authenticated puedan ejecutar envuelve la entrada de servidor o el worker');

select is((
  select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public','private') and p.prosrc ~ 'private\.fiscal_request_invoice\s*\('),
  array['request_fiscal_document','service_request_fiscal_document'],
  'una sola ruta de emision: solo las dos entradas llegan a private.fiscal_request_invoice');

select ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'fiscal_documents_state_check') ~ 'manual_review',
  'manual_review es un estado propio del comprobante');

-- ══ 2 · UNA VENTA, UNA INTENCION, UN COMPROBANTE ═════════════════════════════
set local role authenticated;
select pg_temp.as_staff('a0c10000-0000-4000-8000-000000000002','c0c10000-0000-4000-8000-000000000002');
select is((select pg_temp.put('panel', public.request_fiscal_document('b0c10000-0000-4000-8000-000000000001','pos_sale','d0c10000-0000-4000-8000-000000000001','invoice','core-contract:panel:0001','PANEL')::text))::jsonb->>'idempotent_replay',
  'false', 'PANEL crea la intencion');
select pg_temp.put('doc', pg_temp.ctx('panel')::jsonb->>'fiscal_document_id');
select is(public.request_fiscal_document('b0c10000-0000-4000-8000-000000000001','pos_sale','d0c10000-0000-4000-8000-000000000001','invoice','core-contract:panel:0001','PANEL')->>'fiscal_document_id',
  pg_temp.ctx('doc'), 'doble clic (misma clave): el mismo comprobante');
select pg_temp.as_staff('a0c10000-0000-4000-8000-000000000006','c0c10000-0000-4000-8000-000000000006');
select is(public.request_fiscal_document('b0c10000-0000-4000-8000-000000000001','pos_sale','d0c10000-0000-4000-8000-000000000001','invoice','core-contract:mobile:0001','MOBILE')->>'fiscal_document_id',
  pg_temp.ctx('doc'), 'otro cajero en el celular, otra clave: converge en el mismo comprobante');
set local role service_role;
select pg_temp.as_service();
select is(public.service_request_fiscal_document('b0c10000-0000-4000-8000-000000000001','pos_sale','d0c10000-0000-4000-8000-000000000001','invoice','core-contract:wa:0001','WHATSAPP','a0c10000-0000-4000-8000-000000000002')->>'fiscal_document_id',
  pg_temp.ctx('doc'), 'WHATSAPP con su usuario: el mismo comprobante');
select is(public.service_request_fiscal_document('b0c10000-0000-4000-8000-000000000001','pos_sale','d0c10000-0000-4000-8000-000000000001','invoice','core-contract:auto:0001','AUTOMATION',null)->>'fiscal_document_id',
  pg_temp.ctx('doc'), 'AUTOMATION sin persona: el mismo comprobante');
set local role postgres;
select is((select count(*)::integer from public.fiscal_documents where source_type = 'pos_sale' and source_id = 'd0c10000-0000-4000-8000-000000000001'),
  1, 'cuatro canales, una venta: exactamente 1 comprobante');
select is((select count(*)::integer from public.fiscal_outbox where fiscal_document_id = pg_temp.ctx('doc')::uuid),
  1, 'y una sola fila en la cola del worker');
select is((select count(*)::integer from public.fiscal_idempotency_keys where fiscal_document_id = pg_temp.ctx('doc')::uuid),
  4, 'las 4 claves distintas quedaron ligadas al mismo comprobante (el doble clic no suma otra)');
select is((select array_agg(distinct e.sanitized_detail->>'command_source' order by e.sanitized_detail->>'command_source')
             from public.fiscal_events e where e.fiscal_document_id = pg_temp.ctx('doc')::uuid),
  array['AUTOMATION','MOBILE','PANEL','WHATSAPP'], 'CommandSource queda auditado por canal, nunca como identidad');
select ok(
  (select actor_id from public.fiscal_idempotency_keys where idempotency_key = 'core-contract:wa:0001') = 'a0c10000-0000-4000-8000-000000000002'
  and (select actor_id is null from public.fiscal_idempotency_keys where idempotency_key = 'core-contract:auto:0001')
  and exists (select 1 from public.fiscal_events e where e.fiscal_document_id = pg_temp.ctx('doc')::uuid
               and e.actor_type = 'system' and e.actor_id is null and e.sanitized_detail->>'command_source' = 'AUTOMATION'),
  'WHATSAPP conserva a la persona; AUTOMATION queda como sistema explicito (actor_type system, sin actor)');
set local role authenticated;
select pg_temp.as_staff('a0c10000-0000-4000-8000-000000000002','c0c10000-0000-4000-8000-000000000002');
select throws_ok(
  $$select public.request_fiscal_document('b0c10000-0000-4000-8000-000000000001','pos_sale','d0c10000-0000-4000-8000-000000000003','invoice','core-contract:panel:0001','PANEL')$$,
  '23505', 'idempotency_key reutilizada con otra solicitud', 'la misma clave para OTRA venta es un conflicto explicito, nunca otro comprobante');

-- ══ 3 · FALLA CERRADO ════════════════════════════════════════════════════════
select throws_ok(
  $$select public.request_fiscal_document('b0c10000-0000-4000-8000-000000000001','online_order','d0c10000-0000-4000-8000-0000000000aa','invoice','core-contract:online:0001','PANEL')$$,
  'P0001', 'facturacion online requiere politica fiscal validada', 'online_order: identidad valida, emision BLOQUEADA hasta tener politica contable');
select throws_ok(
  $$select public.request_fiscal_document('b0c10000-0000-4000-8000-000000000001','pos_sale','d0c10000-0000-4000-8000-000000000002','invoice','core-contract:pos2:0001','PANEL')$$,
  'P0001', 'fiscal_policy_review_required', 'la venta POS real de hoy (sin snapshot impositivo) no se factura: ACCOUNTING_POLICY_REQUIRED');
set local role postgres;
select is((select count(*)::integer from public.fiscal_documents
            where source_id in ('d0c10000-0000-4000-8000-0000000000aa','d0c10000-0000-4000-8000-000000000002')),
  0, 'ninguna de las dos dejo un comprobante, ni una venta inventada');

-- ══ 4 · AISLAMIENTO Y GUARDAS DE LOS CANALES ═════════════════════════════════
set local role authenticated;
select pg_temp.as_staff('a0c10000-0000-4000-8000-000000000003','c0c10000-0000-4000-8000-000000000003');
select throws_ok(
  $$select public.request_fiscal_document('b0c10000-0000-4000-8000-000000000001','pos_sale','d0c10000-0000-4000-8000-000000000003','invoice','core-contract:rider:0001','PANEL')$$,
  '42501', 'operador no autorizado', 'el repartidor no factura');
select pg_temp.as_staff('a0c10000-0000-4000-8000-000000000005','c0c10000-0000-4000-8000-000000000005');
select throws_ok(
  $$select public.request_fiscal_document('b0c10000-0000-4000-8000-000000000001','pos_sale','d0c10000-0000-4000-8000-000000000003','invoice','core-contract:other:0001','PANEL')$$,
  '42501', 'operador no autorizado', 'el dueno de otro negocio no factura una venta ajena');
select throws_ok(
  $$select public.request_fiscal_document('b0c10000-0000-4000-8000-000000000002','pos_sale','d0c10000-0000-4000-8000-000000000003','invoice','core-contract:other:0002','PANEL')$$,
  'P0001', 'fiscalizacion deshabilitada', 'por su propio negocio tampoco llega a la venta ajena');
select is((select count(*)::integer from public.fiscal_documents), 0, 'otro negocio no ve ningun comprobante (RLS)');
select pg_temp.as_staff('a0c10000-0000-4000-8000-000000000002','c0c10000-0000-4000-8000-000000000002');
select is((select count(*)::integer from public.fiscal_documents), 1, 'el cajero del negocio ve su comprobante');
select throws_ok(
  $$select public.request_fiscal_document('b0c10000-0000-4000-8000-000000000001','pos_sale','d0c10000-0000-4000-8000-000000000003','invoice','core-contract:fake:0001','WHATSAPP')$$,
  '22023', 'canal no permitido para un operador', 'un operador no se declara canal de servidor');
select throws_ok(
  $$select public.service_request_fiscal_document('b0c10000-0000-4000-8000-000000000001','pos_sale','d0c10000-0000-4000-8000-000000000003','invoice','core-contract:fake:0002','AUTOMATION',null)$$,
  '42501', null, 'authenticated no ejecuta la entrada de servidor');
set local role service_role;
select set_config('request.jwt.claims', '', true);
select throws_ok(
  $$select public.service_request_fiscal_document('b0c10000-0000-4000-8000-000000000001','pos_sale','d0c10000-0000-4000-8000-000000000003','invoice','core-contract:nojwt:0001','AUTOMATION',null)$$,
  '42501', 'canal de servidor no autorizado', 'sin JWT de service_role no hay canal de servidor (el GRANT no alcanza)');
select pg_temp.as_service();
select throws_ok(
  $$select public.service_request_fiscal_document('b0c10000-0000-4000-8000-000000000001','pos_sale','d0c10000-0000-4000-8000-000000000003','invoice','core-contract:wa:0002','WHATSAPP',null)$$,
  '22023', 'un pedido por WhatsApp requiere el usuario que lo hizo', 'WhatsApp nunca es system: exige la persona');
select throws_ok(
  $$select public.service_request_fiscal_document('b0c10000-0000-4000-8000-000000000001','pos_sale','d0c10000-0000-4000-8000-000000000003','invoice','core-contract:wa:0003','WHATSAPP','a0c10000-0000-4000-8000-000000000003')$$,
  '42501', 'actor ajeno al negocio', 'un repartidor no figura como quien pidio la factura');
select throws_ok(
  $$select public.service_request_fiscal_document('b0c10000-0000-4000-8000-000000000001','pos_sale','d0c10000-0000-4000-8000-000000000003','invoice','core-contract:wa:0004','WHATSAPP','a0c10000-0000-4000-8000-000000000004')$$,
  '42501', 'actor ajeno al negocio', 'un usuario dado de baja no factura');
select throws_ok(
  $$select public.service_request_fiscal_document('b0c10000-0000-4000-8000-000000000001','pos_sale','d0c10000-0000-4000-8000-000000000003','invoice','core-contract:wa:0005','WHATSAPP','a0c10000-0000-4000-8000-000000000005')$$,
  '42501', 'actor ajeno al negocio', 'el dueno de otro negocio no es actor de este');

-- ══ 5 · WORKER: fencing, reserva, resultado y maquina de estados ═════════════
select is((select count(*)::integer from public.claim_fiscal_outbox('core-contract-worker','homologation','20111111112',5,120)),
  0, 'un worker de otro CUIT no reclama este comprobante');
select pg_temp.put('epoch', (select lease_epoch::text from public.claim_fiscal_outbox('core-contract-worker','homologation','20123456786',5,120)
                              where fiscal_document_id = pg_temp.ctx('doc')::uuid));
select is(pg_temp.ctx('epoch'), '1', 'el claim de su CUIT y entorno lo toma con lease_epoch 1');
select throws_ok(
  format($$select public.reserve_fiscal_document_number(%L,'core-contract-worker',0,1,(now() at time zone 'America/Argentina/Buenos_Aires')::date)$$, pg_temp.ctx('doc')),
  'TF001', 'lease fiscal perdido: no reservar ni emitir', 'reservar con un epoch viejo: TF001');
select is((public.reserve_fiscal_document_number(pg_temp.ctx('doc')::uuid,'core-contract-worker',1,1,(now() at time zone 'America/Argentina/Buenos_Aires')::date)).document_number,
  1::bigint, 'con el epoch vigente reserva el numero 1');
select ok((select state = 'authorizing' and dispatch_count = 1 and last_dispatch_at is not null from public.fiscal_documents where id = pg_temp.ctx('doc')::uuid),
  'la reserva registra el envio antes de hablar con ARCA (write-ahead)');
select is((select count(*)::integer from public.claim_fiscal_outbox('core-contract-worker-2','homologation','20123456786',5,120)),
  0, 'con el lease vigente nadie mas lo reclama');
select throws_ok(
  format($$select public.complete_fiscal_attempt((select id from public.fiscal_outbox where fiscal_document_id = %L),'core-contract-worker',0,'{"classification":"authorized","cae":"74000000000001","document_number":1}'::jsonb)$$, pg_temp.ctx('doc')),
  'TF001', 'lease fiscal perdido: resultado descartado', 'un resultado con epoch viejo se descarta: TF001');
select throws_ok(
  format($$select public.complete_fiscal_attempt((select id from public.fiscal_outbox where fiscal_document_id = %L),'core-contract-worker',1,'{"classification":"authorized","cae":"74000000000001","document_number":2}'::jsonb)$$, pg_temp.ctx('doc')),
  'TF004', 'la autorizacion no corresponde al numero reservado', 'una autorizacion de otro numero no se acepta');
select is(public.complete_fiscal_attempt((select id from public.fiscal_outbox where fiscal_document_id = pg_temp.ctx('doc')::uuid),'core-contract-worker',1,
          '{"classification":"authorized","cae":"74000000000001","document_number":1,"cae_expiration":"2026-10-07"}'::jsonb)->>'state',
  'authorized', 'el resultado del epoch vigente autoriza');
set local role postgres;
select ok((select artifact_state = 'artifact_pending' from public.fiscal_documents where id = pg_temp.ctx('doc')::uuid)
          and exists (select 1 from public.fiscal_artifact_outbox where fiscal_document_id = pg_temp.ctx('doc')::uuid),
  'autorizado: el PDF queda encolado sin tocar la autorizacion');
select throws_ok(
  format($$update public.fiscal_documents set cae = '74000000000999' where id = %L$$, pg_temp.ctx('doc')),
  '55000', 'los datos autorizados son inmutables', 'un CAE autorizado no se reescribe');
set local role authenticated;
select pg_temp.as_staff('a0c10000-0000-4000-8000-000000000002','c0c10000-0000-4000-8000-000000000002');
select pg_temp.put('doc3', public.request_fiscal_document('b0c10000-0000-4000-8000-000000000001','pos_sale','d0c10000-0000-4000-8000-000000000003','invoice','core-contract:panel:0003','PANEL')->>'fiscal_document_id');
set local role postgres;
select throws_ok(
  format($$update public.fiscal_documents set state = 'authorized', cae = '74000000000002', document_number = 2, authorized_at = now() where id = %L$$, pg_temp.ctx('doc3')),
  'TF004', 'transicion fiscal invalida: queued -> authorized', 'queued no salta a authorized: no hay CAE sin envio');
select throws_ok(
  $$insert into public.fiscal_documents(business_id,source_type,source_id,document_intent,environment,cuit,point_of_sale,document_type,
      concept,currency,currency_rate,net_amount,tax_amount,exempt_amount,non_taxed_amount,other_taxes_amount,total_amount,state,idempotency_key,cae,document_number,authorized_at)
    values ('b0c10000-0000-4000-8000-000000000001','pos_sale',gen_random_uuid(),'invoice','homologation','20123456786',5,6,
      1,'PES',1,100,0,0,0,0,100,'authorized','core-contract:born:0001','74000000000003',3,now())$$,
  'TF004', null, 'un comprobante nunca nace autorizado');

select * from finish();
rollback;
