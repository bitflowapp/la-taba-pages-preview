begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('41000000-0000-4000-8000-000000000001','authenticated','authenticated','fiscal-owner@example.invalid','',now(),'{}','{}',now(),now());
insert into public.businesses(id,name,status,slug,is_active)
values ('42000000-0000-4000-8000-000000000001','TABA fiscal fixture','open','taba-fiscal-fixture',true);
insert into public.business_members(business_id,user_id,role,is_active)
values ('42000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','owner',true);
insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
values ('43000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000001','owner','panel_web');
insert into public.fiscal_profiles(
  business_id,legal_name,cuit,tax_condition,business_address,environment,point_of_sale,default_currency,default_concept,
  invoice_policy,is_enabled,default_recipient_condition
) values (
  '42000000-0000-4000-8000-000000000001','TABA Fiscal Fixture','20123456789','Responsable Inscripto','Direccion fiscal fixture',
  'homologation',1,'PES',1,'manual',true,'Consumidor Final'
);
insert into public.fiscal_parameter_snapshots(environment,parameter_type,version,values_json,synchronized_at) values
  ('homologation','document_types','fixture-v1','[{"Id":11},{"Id":13}]'::jsonb,now()),
  ('homologation','recipient_document_types','fixture-v1','[{"Id":96}]'::jsonb,now());
insert into public.fiscal_accounting_policies(
  business_id,environment,policy_version,valid_from,issuer_condition,recipient_condition,concept,invoice_type,credit_note_type,
  recipient_document_type,recipient_document_number,enabled,accountant_review_status,approved_by,approved_at,notes
) values (
  '42000000-0000-4000-8000-000000000001','homologation','fixture-approved-v1',current_date,'Responsable Inscripto','Consumidor Final',1,11,13,
  96,'0',true,'approved','41000000-0000-4000-8000-000000000001',now(),'Fixture sintetico; no constituye aprobacion comercial.'
);

select is(
  (select (public.resolve_fiscal_accounting_policy('42000000-0000-4000-8000-000000000001','homologation','Responsable Inscripto','Consumidor Final',1,11,current_date)).credit_note_type),
  13,
  'la politica aprobada resuelve una nota de credito no cero'
);
select throws_ok(
  $$select public.resolve_fiscal_accounting_policy('42000000-0000-4000-8000-000000000001','homologation','Responsable Inscripto','Sin Politica',1,11,current_date)$$,
  'P0001','fiscal_policy_review_required','sin politica no inventa un tipo fiscal'
);

-- ===== Configurar homologacion no es autorizarla, y autorizarla no es emitir =====
-- El fixture de arriba ya dejo el perfil en homologation sin autorizacion: ese estado intermedio
-- es legitimo y la base tiene que admitirlo.
select is(
  (select environment from public.fiscal_profiles where business_id='42000000-0000-4000-8000-000000000001'),
  'homologation',
  'la base admite un perfil configurado para homologacion'
);
select ok(
  (select homologation_authorized_at is null from public.fiscal_profiles where business_id='42000000-0000-4000-8000-000000000001'),
  'configurar homologacion no inventa una fecha de autorizacion'
);
select ok(
  (select homologation_authorized_by is null from public.fiscal_profiles where business_id='42000000-0000-4000-8000-000000000001'),
  'configurar homologacion no inventa un actor autorizante'
);

-- Emitir de verdad si exige la autorizacion humana registrada.
select throws_ok(
  $$insert into public.fiscal_documents(
      business_id,source_type,source_id,document_intent,environment,cuit,point_of_sale,document_type,concept,currency,currency_rate,
      recipient_type,recipient_document_type,recipient_document_number,net_amount,tax_amount,exempt_amount,non_taxed_amount,other_taxes_amount,total_amount,
      state,idempotency_key,issuer_snapshot,recipient_snapshot,fiscal_policy_version
    ) values (
      '42000000-0000-4000-8000-000000000001','pos_sale','44000000-0000-4000-8000-000000000009','invoice',
      'homologation','20123456789',1,11,1,'PES',1,'Consumidor Final',96,'0',100,21,0,0,0,121,
      'queued','fixture-invoice-unauthorized-1','{}'::jsonb,'{}'::jsonb,'fixture-approved-v1'
    )$$,
  '42501','homologacion no autorizada','sin autorizacion registrada no se emite ningun comprobante'
);

-- Media autorizacion no es autorizacion: el par viaja completo o no viaja.
select throws_ok(
  $$update public.fiscal_profiles set homologation_authorized_at = now()
    where business_id='42000000-0000-4000-8000-000000000001'$$,
  '23514',
  null::text,
  'la base rechaza metadata de autorizacion parcial'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"41000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"43000000-0000-4000-8000-000000000001"}';

-- Guardar "Datos fiscales" con homologacion elegida es configuracion valida y no autoriza nada.
select lives_ok(
  $$select public.configure_fiscal_profile('42000000-0000-4000-8000-000000000001', jsonb_build_object(
      'legal_name','TABA Fiscal Fixture','cuit','20123456789','tax_condition','Responsable Inscripto',
      'business_address','Direccion fiscal fixture','environment','homologation','point_of_sale',1,
      'default_currency','PES','default_concept',1,'invoice_policy','manual','is_enabled',true,
      'default_recipient_condition','Consumidor Final'
    ))$$,
  'se puede guardar un perfil de homologacion sin autorizar ARCA'
);
select ok(
  (select homologation_authorized_at is null and homologation_authorized_by is null
     from public.fiscal_profiles where business_id='42000000-0000-4000-8000-000000000001'),
  'guardar datos fiscales no autoriza la homologacion de forma implicita'
);

-- La produccion sigue sin ruta de activacion desde el panel.
select throws_ok(
  $$select public.configure_fiscal_profile('42000000-0000-4000-8000-000000000001', jsonb_build_object(
      'legal_name','TABA Fiscal Fixture','cuit','20123456789','tax_condition','Responsable Inscripto',
      'environment','production','point_of_sale',1,'is_enabled',true,
      'default_recipient_condition','Consumidor Final'
    ))$$,
  '42501','produccion no se configura desde el panel','la facturacion real sigue apagada desde el panel'
);

select throws_ok(
  $$select public.authorize_arca_homologation('42000000-0000-4000-8000-000000000001','I_AUTHORIZE_ARCA')$$,
  '22023','autorizacion de homologacion ausente','una frase aproximada no autoriza'
);
select throws_ok(
  $$select public.authorize_arca_homologation('42000000-0000-4000-8000-000000000001','I_AUTHORIZE_ARCA_HOMOLOGATION')$$,
  'P0001','falta la aprobacion contable','la autorizacion exige revision contable aprobada'
);

set local role postgres;
update public.fiscal_profiles set
  accountant_review_status='approved',
  certificate_fingerprint_sha256=repeat('b',64),
  certificate_expires_at=now()+interval '90 days'
where business_id='42000000-0000-4000-8000-000000000001';

set local role authenticated;
set local request.jwt.claims = '{"sub":"41000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"43000000-0000-4000-8000-000000000001"}';
select lives_ok(
  $$select public.authorize_arca_homologation('42000000-0000-4000-8000-000000000001','I_AUTHORIZE_ARCA_HOMOLOGATION')$$,
  'la frase exacta con revision contable aprobada autoriza la homologacion'
);
select ok(
  (select homologation_authorized_at is not null and homologation_authorized_by = '41000000-0000-4000-8000-000000000001'
     from public.fiscal_profiles where business_id='42000000-0000-4000-8000-000000000001'),
  'la autorizacion deja fecha y actor reales, no inventados'
);
select is(
  (select count(*)::integer from public.fiscal_profile_events
    where business_id='42000000-0000-4000-8000-000000000001' and event_type='homologation_authorized'),
  1,
  'la autorizacion queda auditada con su actor'
);

set local role postgres;

insert into public.fiscal_documents(
  id,business_id,source_type,source_id,document_intent,environment,cuit,point_of_sale,document_type,concept,currency,currency_rate,
  recipient_type,recipient_document_type,recipient_document_number,net_amount,tax_amount,exempt_amount,non_taxed_amount,other_taxes_amount,total_amount,
  state,idempotency_key,issuer_snapshot,recipient_snapshot,fiscal_policy_version
) values (
  '43000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000001','pos_sale','44000000-0000-4000-8000-000000000001','invoice',
  'homologation','20123456789',1,11,1,'PES',1,'Consumidor Final',96,'0',100,21,0,0,0,121,
  'queued','fixture-invoice-authorized-1',
  '{"legal_name":"TABA Fiscal Fixture","cuit":"20123456789","address":"Direccion fiscal fixture","tax_condition":"Responsable Inscripto"}'::jsonb,
  '{"condition":"Consumidor Final","document_type":96,"document_number":"0"}'::jsonb,'fixture-approved-v1'
);
insert into public.fiscal_document_items(
  id,fiscal_document_id,description,quantity,unit_price,net_amount,tax_amount,tax_code,exempt_amount,non_taxed_amount,other_taxes_amount,tax_snapshot
) values (
  '45000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001','Item fiscal sintetico',2,50,100,21,5,0,0,0,
  '{"net_amount":"100.00","tax_amount":"21.00","exempt_amount":"0.00","non_taxed_amount":"0.00","other_taxes_amount":"0.00","tax_code":"5"}'::jsonb
);
update public.fiscal_documents
set state='authorized',cae='12345678901234',cae_expiration=current_date+10,document_number=1,issue_date=current_date,authorized_at=now()
where id='43000000-0000-4000-8000-000000000001';

select is((select artifact_state from public.fiscal_documents where id='43000000-0000-4000-8000-000000000001'), 'artifact_pending', 'CAE deja el PDF pendiente sin revertir autorizacion');
select is((select state from public.fiscal_artifact_outbox where fiscal_document_id='43000000-0000-4000-8000-000000000001'), 'pending', 'autorizacion encola el artefacto privado');

set local role authenticated;
set local request.jwt.claims = '{"sub":"41000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"43000000-0000-4000-8000-000000000001"}';

select throws_ok(
  $$select public.request_credit_note('43000000-0000-4000-8000-000000000001','Lineas nulas fixture','total',null,'fixture-credit-null-lines-1')$$,
  '22023','lineas de nota invalidas','la API rechaza lineas nulas antes de emitir'
);
select lives_ok(
  $$select public.request_credit_note('43000000-0000-4000-8000-000000000001','Devolucion parcial fixture','partial','[{"original_item_id":"45000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,'fixture-credit-partial-1')$$,
  'una nota parcial precisa se encola'
);
select is((select document_type from public.fiscal_documents where idempotency_key='fixture-credit-partial-1'), 13, 'la nota parcial usa el tipo resuelto por politica');
select is((select total_amount from public.fiscal_documents where idempotency_key='fixture-credit-partial-1'), 60.50::numeric, 'la nota parcial conserva impuesto y redondeo');
select is((select state from public.fiscal_documents where id='43000000-0000-4000-8000-000000000001'), 'authorized', 'la factura original queda intacta');
select is(
  (select (public.request_credit_note('43000000-0000-4000-8000-000000000001','Devolucion parcial fixture','partial','[{"original_item_id":"45000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,'fixture-credit-partial-1')->>'idempotent_replay')::boolean),
  true,
  'repetir la misma clave no duplica la nota'
);
select throws_ok(
  $$select public.request_credit_note('43000000-0000-4000-8000-000000000001','Exceso parcial fixture','partial','[{"original_item_id":"45000000-0000-4000-8000-000000000001","quantity":2}]'::jsonb,'fixture-credit-overflow-1')$$,
  '23514','importe o cantidad excede el saldo acreditable','no permite acreditar mas cantidad que el saldo'
);
select lives_ok(
  $$select public.request_credit_note('43000000-0000-4000-8000-000000000001','Saldo total fixture','total','[]'::jsonb,'fixture-credit-total-1')$$,
  'la nota total acredita exactamente el remanente'
);
set local role postgres;
select is(
  (select sum(total_amount) from public.fiscal_credit_allocations where original_document_id='43000000-0000-4000-8000-000000000001' and state='reserved'),
  121.00::numeric,
  'las reservas no exceden el total acreditable'
);

set local role service_role;
select is((select count(*)::integer from public.claim_fiscal_artifact_outbox('fixture-artifact-worker',1,30)), 1, 'un worker reclama una sola generacion de PDF');
set local role postgres;
select throws_ok(
  $$select public.complete_fiscal_artifact('00000000-0000-4000-8000-000000000009','fixture-artifact-worker','{}'::jsonb)$$,
  '22023','metadata de artefacto incompleta','la metadata de PDF exige fecha y campos completos'
);
select lives_ok(
  $$select public.complete_fiscal_artifact(
    (select id from public.fiscal_artifact_outbox where fiscal_document_id='43000000-0000-4000-8000-000000000001'),
    'fixture-artifact-worker',
    jsonb_build_object(
      'artifact_type','authorized_pdf','storage_provider','supabase_storage',
      'storage_path',(select public.fiscal_artifact_storage_path(business_id,id,(select generation_token from public.fiscal_artifact_outbox where fiscal_document_id='43000000-0000-4000-8000-000000000001')) from public.fiscal_documents where id='43000000-0000-4000-8000-000000000001'),
      'mime_type','application/pdf','size_bytes',512,'sha256',repeat('a',64),'generated_at',now(),
      'generated_by','fixture-artifact-worker','generation_version','fixture-pdf-v1'
    )
  )$$,
  'el worker persiste metadata de un PDF autorizado'
);
select is((select artifact_state from public.fiscal_documents where id='43000000-0000-4000-8000-000000000001'), 'artifact_ready', 'PDF disponible despues de persistir metadata');
select is((select sha256 from public.fiscal_document_artifacts where fiscal_document_id='43000000-0000-4000-8000-000000000001' and is_current), repeat('a',64), 'el hash SHA-256 queda persistido');

set local role authenticated;
set local request.jwt.claims = '{"sub":"41000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"43000000-0000-4000-8000-000000000001"}';
select is(
  (select public.authorize_fiscal_artifact_access((select artifact_id from public.list_fiscal_document_artifacts('42000000-0000-4000-8000-000000000001') where fiscal_document_id='43000000-0000-4000-8000-000000000001'),'preview') ? 'storage_path'),
  false,
  'la autorizacion de preview no expone la ruta privada'
);
select throws_ok(
  $$select storage_path from public.fiscal_document_artifacts where fiscal_document_id='43000000-0000-4000-8000-000000000001'$$,
  '42501','permission denied for table fiscal_document_artifacts','el panel no tiene SELECT directo de rutas privadas'
);
select lives_ok(
  $$select public.request_fiscal_print_job(
    '43000000-0000-4000-8000-000000000001',
    (select artifact_id from public.list_fiscal_document_artifacts('42000000-0000-4000-8000-000000000001') where fiscal_document_id='43000000-0000-4000-8000-000000000001'),
    repeat('b',64),'a4',1,'fixture-print-job-1'
  )$$,
  'la reimpresion crea una auditoria antes del spooler'
);
select is((select status from public.fiscal_print_jobs where idempotency_key='fixture-print-job-1'), 'queued', 'la auditoria inicia en cola');
select is(
  (select (public.update_fiscal_print_job((select id from public.fiscal_print_jobs where idempotency_key='fixture-print-job-1'),'sent_to_spooler',null)->>'status')),
  'sent_to_spooler',
  'enviar al spooler no se declara impresion completada'
);

select lives_ok(
  $$select public.request_fiscal_artifact_regeneration('43000000-0000-4000-8000-000000000001')$$,
  'owner solicita una regeneracion auditada'
);
set local role service_role;
select is((select count(*)::integer from public.claim_fiscal_artifact_outbox('fixture-artifact-worker-2',1,30)), 1, 'un reinicio usa una nueva lease de regeneracion');
set local role postgres;
select lives_ok(
  $$select public.complete_fiscal_artifact(
    (select id from public.fiscal_artifact_outbox where fiscal_document_id='43000000-0000-4000-8000-000000000001'),
    'fixture-artifact-worker-2',
    jsonb_build_object(
      'artifact_type','authorized_pdf','storage_provider','supabase_storage',
      'storage_path',(select public.fiscal_artifact_storage_path(business_id,id,(select generation_token from public.fiscal_artifact_outbox where fiscal_document_id='43000000-0000-4000-8000-000000000001')) from public.fiscal_documents where id='43000000-0000-4000-8000-000000000001'),
      'mime_type','application/pdf','size_bytes',513,'sha256',repeat('c',64),'generated_at',now(),
      'generated_by','fixture-artifact-worker-2','generation_version','fixture-pdf-v2'
    )
  )$$,
  'la regeneracion crea un nuevo artefacto inmutable'
);
select is((select count(*)::integer from public.fiscal_document_artifacts where fiscal_document_id='43000000-0000-4000-8000-000000000001' and is_current), 1, 'solo queda un artefacto actual por tipo');
select is((select count(*)::integer from public.fiscal_document_artifacts where fiscal_document_id='43000000-0000-4000-8000-000000000001' and state='artifact_superseded'), 1, 'la regeneracion conserva la cadena auditada');

select * from finish();
rollback;
