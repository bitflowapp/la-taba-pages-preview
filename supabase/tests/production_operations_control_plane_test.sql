begin;
create extension if not exists pgtap with schema extensions;
select plan(50);

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
-- El huso es obligatorio desde 20260814020000: el dia comercial lo define el
-- negocio y no el aparato que abre el Panel, asi que un negocio sin huso ya no
-- puede preparar un cierre. El fixture lo declara como lo hace el negocio real.
insert into public.businesses(id,name,status,slug,is_active,operating_timezone)
values
  ('52000000-0000-4000-8000-000000000001','TABA operaciones fixture','open','taba-operations-fixture',true,'America/Argentina/Buenos_Aires'),
  ('52000000-0000-4000-8000-000000000002','TABA operaciones ajeno','open','taba-operations-other',true,'America/Argentina/Buenos_Aires');
insert into public.business_members(business_id,user_id,role,is_active)
values
  ('52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','owner',true),
  ('52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002','staff',true),
  ('52000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000003','owner',true);
insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
values
  ('51100000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','owner','panel_web'),
  ('51100000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000002','52000000-0000-4000-8000-000000000001','staff','panel_web'),
  ('51100000-0000-4000-8000-000000000003','51000000-0000-4000-8000-000000000003','52000000-0000-4000-8000-000000000002','owner','panel_web');

insert into public.orders(id,business_id,code,public_code,status,fulfillment_type,delivery_mode,client_request_id,customer_name,payment_method,subtotal,delivery_fee,total)
values
  ('55000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','OPS-MP-1','OPS-MP-1','received','pickup','pickup','operations-mp-order-1','CLIENTE_SINTETICO_MP','mercadopago',100,0,100),
  ('55000000-0000-4000-8000-000000000002','52000000-0000-4000-8000-000000000001','OPS-CASH-1','OPS-CASH-1','received','pickup','pickup','operations-cash-order-1','CLIENTE_SINTETICO_CASH','cash',100,0,100),
  ('55000000-0000-4000-8000-000000000003','52000000-0000-4000-8000-000000000001','OPS-CASH-2','OPS-CASH-2','received','pickup','pickup','operations-cash-order-2','CLIENTE_SINTETICO_CASH','cash',100,0,100),
  ('55000000-0000-4000-8000-000000000004','52000000-0000-4000-8000-000000000001','OPS-MP-REFUND','OPS-MP-REFUND','received','pickup','pickup','operations-mp-order-refunded','CLIENTE_SINTETICO_MP_REFUND','mercadopago',100,0,100),
  ('55000000-0000-4000-8000-000000000005','52000000-0000-4000-8000-000000000001','OPS-MP-CHARGEBACK','OPS-MP-CHARGEBACK','received','pickup','pickup','operations-mp-order-chargeback','CLIENTE_SINTETICO_MP_CHARGEBACK','mercadopago',100,0,100);

insert into public.checkout_sessions(
  id,business_id,customer_id,client_request_id,normalized_intent_hash,fulfillment_type,
  currency,subtotal,total,status,expires_at
) values (
  '53000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001','operationscheckout01',repeat('a',64),'pickup',
  'ARS',100,100,'payment_approved',now()+interval '1 hour'
);
insert into public.checkout_sessions(
  id,business_id,customer_id,client_request_id,normalized_intent_hash,fulfillment_type,
  currency,subtotal,total,status,expires_at
) values (
  '53000000-0000-4000-8000-000000000002','52000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001','operationscheckout02',repeat('b',64),'pickup',
  'ARS',100,100,'completed',now()+interval '1 hour'
);
insert into public.checkout_sessions(
  id,business_id,customer_id,client_request_id,normalized_intent_hash,fulfillment_type,
  currency,subtotal,total,status,expires_at
) values (
  '53000000-0000-4000-8000-000000000003','52000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001','operationscheckout03',repeat('c',64),'pickup',
  'ARS',100,100,'completed',now()+interval '1 hour'
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
insert into public.payment_intents(
  id,checkout_session_id,business_id,order_id,environment,external_reference,internal_status,
  currency,expected_amount,paid_amount,refunded_amount,approved_at,updated_at
) values (
  '54000000-0000-4000-8000-000000000002','53000000-0000-4000-8000-000000000002',
  '52000000-0000-4000-8000-000000000001','55000000-0000-4000-8000-000000000004','test',
  'taba2:checkout:53000000-0000-4000-8000-000000000002','refunded',
  'ARS',100,100,100,now()-interval '10 minutes',now()-interval '5 minutes'
);
insert into public.payment_intents(
  id,checkout_session_id,business_id,order_id,environment,external_reference,internal_status,
  currency,expected_amount,paid_amount,refunded_amount,approved_at,updated_at
) values (
  '54000000-0000-4000-8000-000000000003','53000000-0000-4000-8000-000000000003',
  '52000000-0000-4000-8000-000000000001','55000000-0000-4000-8000-000000000005','test',
  'taba2:checkout:53000000-0000-4000-8000-000000000003','charged_back',
  'ARS',100,100,0,now()-interval '10 minutes',now()-interval '5 minutes'
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
set local request.jwt.claims = '{"sub":"51000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"51100000-0000-4000-8000-000000000001"}';

select is(
  public.identity_current_context('52000000-0000-4000-8000-000000000001')->>'role',
  'owner',
  'sesion registrada conserva el rol de equipo'
);
set local request.jwt.claims = '{"sub":"51000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"51100000-0000-4000-8000-000000000009"}';
select is(
  public.identity_current_context('52000000-0000-4000-8000-000000000001')->>'role',
  null,
  'sesion no registrada falla cerrada en la autoridad'
);
select is(
  (public.identity_register_session('52000000-0000-4000-8000-000000000001','panel_web',null,null,'test')->>'ok')::boolean,
  true,
  'alta bootstrap registra la sesion despues de validar la membresia'
);
select is(
  public.identity_current_context('52000000-0000-4000-8000-000000000001')->>'role',
  'owner',
  'la sesion recien registrada abre la compuerta'
);
set local request.jwt.claims = '{"sub":"51000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"51100000-0000-4000-8000-000000000003"}';
select is(
  public.identity_current_context('52000000-0000-4000-8000-000000000001')->>'role',
  null,
  'session_id de otra persona y comercio no autoriza'
);
set local request.jwt.claims = '{"sub":"51000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (public.identity_register_session('52000000-0000-4000-8000-000000000001','panel_web',null,null,'test')->>'ok')::boolean,
  false,
  'un token sin session_id no se puede registrar ni operar'
);
set local request.jwt.claims = '{"sub":"51000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"51100000-0000-4000-8000-000000000001"}';

select throws_ok(
  $$select public.cancel_order('55000000-0000-4000-8000-000000000001',1,'motivo valido','ops:cancel:mp:1')$$,
  '55000','pedido cobrado por Mercado Pago: gestionar reembolso antes de cancelar',
  'pedido cobrado por Mercado Pago exige reembolso'
);
select lives_ok(
  $$select public.cancel_order('55000000-0000-4000-8000-000000000002',1,'motivo valido','ops:cancel:cash:1')$$,
  'pedido en efectivo conserva cancelacion operativa'
);
select throws_ok(
  $$select public.transition_order('55000000-0000-4000-8000-000000000001',1,'canceled','ops:transition:mp:cancel')$$,
  '55000','pedido cobrado por Mercado Pago: gestionar reembolso desde Pagos',
  'transition_order no evade la barrera con canceled'
);
select throws_ok(
  $$select public.transition_order('55000000-0000-4000-8000-000000000001',1,'cancelled','ops:transition:mp:cancelled')$$,
  '55000','pedido cobrado por Mercado Pago: gestionar reembolso desde Pagos',
  'transition_order no evade la barrera con cancelled'
);
select throws_ok(
  $$select public.transition_order('55000000-0000-4000-8000-000000000001',1,'rejected','ops:transition:mp:reject')$$,
  '55000','pedido cobrado por Mercado Pago: gestionar reembolso desde Pagos',
  'transition_order no evade la barrera con rejected'
);
select lives_ok(
  $$select public.transition_order('55000000-0000-4000-8000-000000000003',1,'rejected','ops:transition:cash:reject')$$,
  'pedido en efectivo conserva rechazo operativo'
);
select throws_ok(
  format(
    $sql$select public.transition_order('55000000-0000-4000-8000-000000000004',%s,'accepted','ops:transition:mp:refunded:advance')$sql$,
    (select revision from public.orders where id='55000000-0000-4000-8000-000000000004')
  ),
  '55000','pago revertido: el pedido solo admite cierre operativo',
  'pedido totalmente reembolsado no puede volver a preparacion o entrega'
);
select lives_ok(
  format(
    $sql$select public.cancel_order('55000000-0000-4000-8000-000000000004',%s,'reembolso total confirmado','ops:cancel:mp:refunded')$sql$,
    (select revision from public.orders where id='55000000-0000-4000-8000-000000000004')
  ),
  'pedido Mercado Pago admite cancelacion solo despues del reembolso total'
);
select is(
  (select public.normalize_order_status_vocabulary(status) from public.orders where id='55000000-0000-4000-8000-000000000004'),
  'cancelled',
  'pedido totalmente reembolsado sale de la cola operativa'
);
select throws_ok(
  format(
    $sql$select public.transition_order('55000000-0000-4000-8000-000000000005',%s,'accepted','ops:transition:mp:chargeback:advance')$sql$,
    (select revision from public.orders where id='55000000-0000-4000-8000-000000000005')
  ),
  '55000','pago revertido: el pedido solo admite cierre operativo',
  'pedido con contracargo no puede volver a preparacion o entrega'
);
select lives_ok(
  format(
    $sql$select public.cancel_order('55000000-0000-4000-8000-000000000005',%s,'contracargo confirmado','ops:cancel:mp:chargeback')$sql$,
    (select revision from public.orders where id='55000000-0000-4000-8000-000000000005')
  ),
  'pedido con contracargo admite cierre operativo'
);
select is(
  (select public.normalize_order_status_vocabulary(status) from public.orders where id='55000000-0000-4000-8000-000000000005'),
  'cancelled',
  'pedido con contracargo sale de la cola operativa'
);

select cmp_ok(public.refresh_operational_alerts('52000000-0000-4000-8000-000000000001'),'>=',1,'reconciliacion detecta pago aprobado sin pedido');
select is((select severity from public.operational_alerts where alert_code='PAYMENT_APPROVED_WITHOUT_ORDER'),'CRITICAL','pago sin pedido es critico');
select is((select required_action<>'' from public.operational_alerts where alert_code='PAYMENT_APPROVED_WITHOUT_ORDER'),true,'alerta incluye accion concreta');
select is((public.transition_operational_alert((select id from public.operational_alerts where alert_code='PAYMENT_APPROVED_WITHOUT_ORDER'),'acknowledged',null)->>'status'),'acknowledged','operador acusa recibo con auditoria');

select lives_ok(
  $$select public.prepare_daily_reconciliation('52000000-0000-4000-8000-000000000001',current_date,'America/Argentina/Buenos_Aires',0,null,'operations-close-prepare-1')$$,
  'owner prepara conciliacion diaria'
);
select is((select status from public.daily_reconciliations where business_id='52000000-0000-4000-8000-000000000001'),'open','cierre inicia abierto');
select is((select (public.prepare_daily_reconciliation('52000000-0000-4000-8000-000000000001',current_date,'America/Argentina/Buenos_Aires',0,null,'operations-close-prepare-1')->>'idempotent_replay')::boolean),true,'preparacion es idempotente');

set local request.jwt.claims = '{"sub":"51000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"51100000-0000-4000-8000-000000000002"}';
select throws_ok(
  format($sql$select public.close_daily_reconciliation(%L::uuid,1,'operations-close-staff-1')$sql$,(select id from public.daily_reconciliations where business_id='52000000-0000-4000-8000-000000000001')),
  '42501','cierre requiere owner o admin','staff no puede cerrar caja'
);

set local request.jwt.claims = '{"sub":"51000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"51100000-0000-4000-8000-000000000001"}';
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
set local request.jwt.claims = '{"sub":"51000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"51100000-0000-4000-8000-000000000003"}';
select is((select count(*)::integer from public.daily_reconciliations where business_id='52000000-0000-4000-8000-000000000001'),0,'otro negocio no lee el cierre por RLS');

select * from finish();
rollback;
