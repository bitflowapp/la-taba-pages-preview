begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

select has_table('public','operational_alerts','alertas operativas durables');
select has_table('public','operational_alert_events','auditoria de alertas durable');
select has_table('public','daily_reconciliations','conciliacion diaria persistida');
select has_table('public','daily_reconciliation_events','auditoria del cierre persistida');
select has_table('public','service_health_signals','señales sanitizadas de servicios');
select has_column('public','checkout_sessions','correlation_id','checkout tiene correlacion');
select has_column('public','payment_intents','correlation_id','pago tiene correlacion');
select has_column('public','orders','correlation_id','pedido tiene correlacion');
select has_column('public','order_packing_sessions','correlation_id','packing tiene correlacion');
select has_column('public','fiscal_documents','correlation_id','fiscal tiene correlacion');
select has_column('public','fiscal_print_jobs','correlation_id','impresion tiene correlacion');
select has_function('public','get_production_operation_center',array['uuid'],'snapshot del centro de operacion existe');
select has_function('public','prepare_daily_reconciliation',array['uuid','date','text','numeric','text','text'],'preparacion del cierre existe');
select has_function('public','close_daily_reconciliation',array['uuid','bigint','text'],'cierre serializado existe');

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('51000000-0000-4000-8000-000000000001','authenticated','authenticated','operations-owner@example.invalid','',now(),'{}','{}',now(),now()),
  ('51000000-0000-4000-8000-000000000002','authenticated','authenticated','operations-staff@example.invalid','',now(),'{}','{}',now(),now()),
  ('51000000-0000-4000-8000-000000000003','authenticated','authenticated','operations-outsider@example.invalid','',now(),'{}','{}',now(),now());
insert into public.businesses(id,name,status,slug,is_active)
values
  ('52000000-0000-4000-8000-000000000001','TABA operaciones fixture','open','taba-operations-fixture',true),
  ('52000000-0000-4000-8000-000000000002','TABA operaciones ajeno','open','taba-operations-other',true);
insert into public.business_members(business_id,user_id,role,is_active)
values
  ('52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','owner',true),
  ('52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002','staff',true),
  ('52000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000003','owner',true);

insert into public.checkout_sessions(
  id,business_id,customer_id,client_request_id,normalized_intent_hash,fulfillment_type,
  currency,subtotal,total,status,expires_at
) values (
  '53000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001','operationscheckout01',repeat('a',64),'pickup',
  'ARS',100,100,'payment_approved',now()+interval '1 hour'
);
insert into public.payment_intents(
  id,checkout_session_id,business_id,environment,external_reference,internal_status,
  currency,expected_amount,paid_amount,approved_at,updated_at
) values (
  '54000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000001',
  '52000000-0000-4000-8000-000000000001','test',
  'taba2:checkout:53000000-0000-4000-8000-000000000001','approved_order_pending',
  'ARS',100,100,now()-interval '10 minutes',now()-interval '10 minutes'
);

select is(
  (select pi.correlation_id from public.payment_intents pi where pi.id='54000000-0000-4000-8000-000000000001'),
  (select cs.correlation_id from public.checkout_sessions cs where cs.id='53000000-0000-4000-8000-000000000001'),
  'pago hereda correlacion del checkout'
);
select is((select relrowsecurity from pg_class where oid='public.operational_alerts'::regclass),true,'alertas tienen RLS');
select is((select relrowsecurity from pg_class where oid='public.daily_reconciliations'::regclass),true,'cierres tienen RLS');
select ok(not has_table_privilege('authenticated','public.operational_alerts','insert'),'panel no inserta alertas directamente');
select ok(not has_table_privilege('authenticated','public.daily_reconciliations','update'),'panel no altera cierres directamente');
select ok(not has_function_privilege('authenticated','public.record_service_health_signal(uuid,text,text,text,text,uuid,timestamptz,timestamptz,jsonb)'::regprocedure,'execute'),'panel no escribe health signals privados');

set local role authenticated;
set local request.jwt.claims = '{"sub":"51000000-0000-4000-8000-000000000001","role":"authenticated"}';

select is(public.refresh_operational_alerts('52000000-0000-4000-8000-000000000001'),1,'reconciliacion detecta pago aprobado sin pedido');
select is((select severity from public.operational_alerts where alert_code='PAYMENT_APPROVED_WITHOUT_ORDER'),'CRITICAL','pago sin pedido es critico');
select is((select required_action<>'' from public.operational_alerts where alert_code='PAYMENT_APPROVED_WITHOUT_ORDER'),true,'alerta incluye accion concreta');
select is((public.transition_operational_alert((select id from public.operational_alerts where alert_code='PAYMENT_APPROVED_WITHOUT_ORDER'),'acknowledged',null)->>'status'),'acknowledged','operador acusa recibo con auditoria');

select lives_ok(
  $$select public.prepare_daily_reconciliation('52000000-0000-4000-8000-000000000001',current_date,'America/Argentina/Buenos_Aires',0,null,'operations-close-prepare-1')$$,
  'owner prepara conciliacion diaria'
);
select is((select status from public.daily_reconciliations where business_id='52000000-0000-4000-8000-000000000001'),'open','cierre inicia abierto');
select is((select (public.prepare_daily_reconciliation('52000000-0000-4000-8000-000000000001',current_date,'America/Argentina/Buenos_Aires',0,null,'operations-close-prepare-1')->>'idempotent_replay')::boolean),true,'preparacion es idempotente');

set local request.jwt.claims = '{"sub":"51000000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(
  format($sql$select public.close_daily_reconciliation(%L::uuid,1,'operations-close-staff-1')$sql$,(select id from public.daily_reconciliations where business_id='52000000-0000-4000-8000-000000000001')),
  '42501','cierre requiere owner o admin','staff no puede cerrar caja'
);

set local request.jwt.claims = '{"sub":"51000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  format($sql$select public.close_daily_reconciliation(%L::uuid,1,'operations-close-final-1')$sql$,(select id from public.daily_reconciliations where business_id='52000000-0000-4000-8000-000000000001')),
  'owner cierra conciliacion con CAS'
);
select matches((select snapshot_sha256 from public.daily_reconciliations where business_id='52000000-0000-4000-8000-000000000001'),'^[a-f0-9]{64}$','cierre conserva hash SHA-256');
set local role postgres;
select throws_ok(
  $$update public.daily_reconciliations set declared_cash=1 where business_id='52000000-0000-4000-8000-000000000001'$$,
  '55000','cierre diario inmutable','cierre final no se modifica'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"51000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select count(*)::integer from public.daily_reconciliations where business_id='52000000-0000-4000-8000-000000000001'),0,'otro negocio no lee el cierre por RLS');

select * from finish();
rollback;
