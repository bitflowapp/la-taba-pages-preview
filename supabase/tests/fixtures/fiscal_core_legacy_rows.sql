-- TABA · ADOPCION DEL CORE FISCAL · filas fiscales LEGADAS
--
-- Se cargan sobre el esquema de La Taba ANTES de las migraciones de adopcion
-- (cabeza 20260926160000), como las pudo dejar el worker anterior, y quedan
-- confirmadas: supabase/tests/fiscal_core_upgrade_test.sql verifica despues
-- que la adopcion no pierde datos, no duplica comprobantes, no reutiliza
-- numeros, no pierde asignaciones de notas de credito y no deja estados
-- invalidos. Las carga scripts/run-release-v5-db.mjs justo antes de la primera
-- migracion posterior a 20260926160000.
--
-- Negocio y CUIT propios (20333333334, punto de venta 3): ningun otro test los
-- toca. Ninguna cola de PDF queda reclamable (los tests de PDF reclaman sin CUIT).
--
--   L1  queued       sin numero           cola pending
--   L2  retry_wait   sin numero           cola retry_wait
--   L3  authorizing  numero 10            cola leased VENCIDA (worker caido a mitad del envio)
--   L4  ambiguous    numero 11            cola retry_wait
--   L5  authorizing  sin numero           cola leased vencida
--   L6  ambiguous    sin numero           cola dead_letter
--   L7  authorized   numero 9, CAE        PDF listo, impresion fiscal y tickets del agente
--   L8  rejected     numero 12            cola dead_letter (el worker anterior no liberaba el numero)
--   L9  failed       numero 13, NC de L7  asignaciones LIBERADAS por el codigo anterior
--   L10 failed       sin numero           cola dead_letter
--   L11 rejected     sin numero           cola dead_letter

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('a1e90000-0000-4000-8000-000000000001','authenticated','authenticated','legacy-fiscal-owner@example.invalid','',now(),'{}','{}',now(),now());

insert into public.businesses(id,name,status,slug,is_active,operating_timezone)
values ('b1e90000-0000-4000-8000-000000000001','TABA FISCAL LEGADO','open','taba-fiscal-legado',true,'America/Argentina/Buenos_Aires');

insert into public.business_members(business_id,user_id,role,is_active)
values ('b1e90000-0000-4000-8000-000000000001','a1e90000-0000-4000-8000-000000000001','owner',true);

insert into public.fiscal_profiles(
  business_id,legal_name,cuit,tax_condition,business_address,environment,point_of_sale,default_currency,default_concept,
  invoice_policy,is_enabled,default_recipient_condition,accountant_review_status,certificate_fingerprint_sha256,certificate_expires_at,
  homologation_authorized_at,homologation_authorized_by
) values (
  'b1e90000-0000-4000-8000-000000000001','TABA FISCAL LEGADO SRL','20333333334','Responsable Inscripto','Direccion legada','homologation',3,'PES',1,
  'manual',true,'Consumidor Final','approved',repeat('c',64),now()+interval '90 days',now(),'a1e90000-0000-4000-8000-000000000001'
);

insert into public.fiscal_documents(
  id,business_id,source_type,source_id,document_intent,environment,cuit,point_of_sale,document_type,document_number,issue_date,
  concept,currency,currency_rate,recipient_type,recipient_document_type,recipient_document_number,
  net_amount,tax_amount,exempt_amount,non_taxed_amount,other_taxes_amount,total_amount,
  state,result,cae,cae_expiration,authorized_at,idempotency_key,issuer_snapshot,recipient_snapshot,artifact_state
) values
  ('f1e90000-0000-4000-8000-000000000001','b1e90000-0000-4000-8000-000000000001','pos_sale','d1e90000-0000-4000-8000-000000000001','invoice','homologation','20333333334',3,6,null,null,
   1,'PES',1,'Consumidor Final',99,'0', 826.45,173.55,0,0,0,1000, 'queued',null,null,null,null,'legacy:queued:0001','{"legal_name":"TABA FISCAL LEGADO SRL"}','{"condition":"Consumidor Final"}','artifact_pending'),
  ('f1e90000-0000-4000-8000-000000000002','b1e90000-0000-4000-8000-000000000001','pos_sale','d1e90000-0000-4000-8000-000000000002','invoice','homologation','20333333334',3,6,null,null,
   1,'PES',1,'Consumidor Final',99,'0', 826.45,173.55,0,0,0,1000, 'retry_wait','service_error',null,null,null,'legacy:retry:0002','{"legal_name":"TABA FISCAL LEGADO SRL"}','{"condition":"Consumidor Final"}','artifact_pending'),
  ('f1e90000-0000-4000-8000-000000000003','b1e90000-0000-4000-8000-000000000001','pos_sale','d1e90000-0000-4000-8000-000000000003','invoice','homologation','20333333334',3,6,10,current_date,
   1,'PES',1,'Consumidor Final',99,'0', 826.45,173.55,0,0,0,1000, 'authorizing',null,null,null,null,'legacy:inflight:0003','{"legal_name":"TABA FISCAL LEGADO SRL"}','{"condition":"Consumidor Final"}','artifact_pending'),
  ('f1e90000-0000-4000-8000-000000000004','b1e90000-0000-4000-8000-000000000001','pos_sale','d1e90000-0000-4000-8000-000000000004','invoice','homologation','20333333334',3,6,11,current_date,
   1,'PES',1,'Consumidor Final',99,'0', 826.45,173.55,0,0,0,1000, 'ambiguous','ambiguous',null,null,null,'legacy:ambiguous:0004','{"legal_name":"TABA FISCAL LEGADO SRL"}','{"condition":"Consumidor Final"}','artifact_pending'),
  ('f1e90000-0000-4000-8000-000000000005','b1e90000-0000-4000-8000-000000000001','pos_sale','d1e90000-0000-4000-8000-000000000005','invoice','homologation','20333333334',3,6,null,null,
   1,'PES',1,'Consumidor Final',99,'0', 826.45,173.55,0,0,0,1000, 'authorizing',null,null,null,null,'legacy:inflight-unnumbered:0005','{"legal_name":"TABA FISCAL LEGADO SRL"}','{"condition":"Consumidor Final"}','artifact_pending'),
  ('f1e90000-0000-4000-8000-000000000006','b1e90000-0000-4000-8000-000000000001','pos_sale','d1e90000-0000-4000-8000-000000000006','invoice','homologation','20333333334',3,6,null,null,
   1,'PES',1,'Consumidor Final',99,'0', 826.45,173.55,0,0,0,1000, 'ambiguous','ambiguous',null,null,null,'legacy:ambiguous-unnumbered:0006','{"legal_name":"TABA FISCAL LEGADO SRL"}','{"condition":"Consumidor Final"}','artifact_pending'),
  ('f1e90000-0000-4000-8000-000000000007','b1e90000-0000-4000-8000-000000000001','pos_sale','d1e90000-0000-4000-8000-000000000007','invoice','homologation','20333333334',3,6,9,'2026-09-20',
   1,'PES',1,'Consumidor Final',99,'0', 826.45,173.55,0,0,0,1000, 'authorized','authorized','74000000000009','2026-09-30','2026-09-20 12:00:00-03','legacy:authorized:0007','{"legal_name":"TABA FISCAL LEGADO SRL"}','{"condition":"Consumidor Final"}','artifact_ready'),
  ('f1e90000-0000-4000-8000-000000000008','b1e90000-0000-4000-8000-000000000001','pos_sale','d1e90000-0000-4000-8000-000000000008','invoice','homologation','20333333334',3,6,12,current_date,
   1,'PES',1,'Consumidor Final',99,'0', 826.45,173.55,0,0,0,1000, 'rejected','rejected',null,null,null,'legacy:rejected:0008','{"legal_name":"TABA FISCAL LEGADO SRL"}','{"condition":"Consumidor Final"}','artifact_pending'),
  ('f1e90000-0000-4000-8000-000000000010','b1e90000-0000-4000-8000-000000000001','pos_sale','d1e90000-0000-4000-8000-000000000010','invoice','homologation','20333333334',3,6,null,null,
   1,'PES',1,'Consumidor Final',99,'0', 826.45,173.55,0,0,0,1000, 'failed','configuration_error',null,null,null,'legacy:failed-unnumbered:0010','{"legal_name":"TABA FISCAL LEGADO SRL"}','{"condition":"Consumidor Final"}','artifact_pending'),
  ('f1e90000-0000-4000-8000-000000000011','b1e90000-0000-4000-8000-000000000001','pos_sale','d1e90000-0000-4000-8000-000000000011','invoice','homologation','20333333334',3,6,null,null,
   1,'PES',1,'Consumidor Final',99,'0', 826.45,173.55,0,0,0,1000, 'rejected','rejected',null,null,null,'legacy:rejected-unnumbered:0011','{"legal_name":"TABA FISCAL LEGADO SRL"}','{"condition":"Consumidor Final"}','artifact_pending');

insert into public.fiscal_document_items(id,fiscal_document_id,description,quantity,unit_price,net_amount,tax_amount,tax_code,exempt_amount,non_taxed_amount,other_taxes_amount,tax_snapshot)
values ('f1e90000-0000-4000-8000-0000000000a7','f1e90000-0000-4000-8000-000000000007','Item legado',1,1000,826.45,173.55,5,0,0,0,
  '{"net_amount":"826.45","tax_amount":"173.55","tax_code":"5","exempt_amount":"0.00","non_taxed_amount":"0.00","other_taxes_amount":"0.00"}');

-- L9: nota de credito de L7 que fallo DESPUES de reservar numero; el codigo anterior libero sus asignaciones.
insert into public.fiscal_documents(
  id,business_id,source_type,source_id,document_intent,environment,cuit,point_of_sale,document_type,document_number,issue_date,
  concept,currency,currency_rate,recipient_type,recipient_document_type,recipient_document_number,
  net_amount,tax_amount,exempt_amount,non_taxed_amount,other_taxes_amount,total_amount,
  state,result,idempotency_key,associated_document_id,issuer_snapshot,recipient_snapshot,associated_document_snapshot,credit_kind,credit_reason,artifact_state
) values (
  'f1e90000-0000-4000-8000-000000000009','b1e90000-0000-4000-8000-000000000001','credit_note','d1e90000-0000-4000-8000-000000000009','credit_note','homologation','20333333334',3,8,13,current_date,
  1,'PES',1,'Consumidor Final',99,'0', 826.45,173.55,0,0,0,1000,
  'failed','configuration_error','legacy:credit-note:0009','f1e90000-0000-4000-8000-000000000007',
  '{"legal_name":"TABA FISCAL LEGADO SRL"}','{"condition":"Consumidor Final"}',
  '{"fiscal_document_id":"f1e90000-0000-4000-8000-000000000007","document_type":6,"point_of_sale":3,"document_number":9}','total','Devolucion legada','artifact_pending'
);
insert into public.fiscal_credit_allocations(business_id,original_document_id,original_item_id,credit_document_id,quantity,net_amount,tax_amount,exempt_amount,non_taxed_amount,other_taxes_amount,total_amount,state,snapshot)
values ('b1e90000-0000-4000-8000-000000000001','f1e90000-0000-4000-8000-000000000007','f1e90000-0000-4000-8000-0000000000a7','f1e90000-0000-4000-8000-000000000009',
  1,826.45,173.55,0,0,0,1000,'released','{"legacy":true}');

insert into public.fiscal_outbox(fiscal_document_id,state,attempt_count,next_attempt_at,lease_owner,lease_deadline,processed_at) values
  ('f1e90000-0000-4000-8000-000000000001','pending',0,now(),null,null,null),
  ('f1e90000-0000-4000-8000-000000000002','retry_wait',2,now()+interval '1 minute',null,null,null),
  ('f1e90000-0000-4000-8000-000000000003','leased',1,now()-interval '20 minutes','legacy-worker',now()-interval '10 minutes',null),
  ('f1e90000-0000-4000-8000-000000000004','retry_wait',3,now()+interval '5 minutes',null,null,null),
  ('f1e90000-0000-4000-8000-000000000005','leased',1,now()-interval '20 minutes','legacy-worker',now()-interval '10 minutes',null),
  ('f1e90000-0000-4000-8000-000000000006','dead_letter',8,now()-interval '1 hour',null,null,now()-interval '1 hour'),
  ('f1e90000-0000-4000-8000-000000000007','completed',1,now()-interval '7 days',null,null,now()-interval '7 days'),
  ('f1e90000-0000-4000-8000-000000000008','dead_letter',1,now()-interval '2 hours',null,null,now()-interval '2 hours'),
  ('f1e90000-0000-4000-8000-000000000009','dead_letter',1,now()-interval '3 hours',null,null,now()-interval '3 hours'),
  ('f1e90000-0000-4000-8000-000000000010','dead_letter',1,now()-interval '4 hours',null,null,now()-interval '4 hours'),
  ('f1e90000-0000-4000-8000-000000000011','dead_letter',1,now()-interval '5 hours',null,null,now()-interval '5 hours');

-- L7: PDF listo (cola de PDF completada: nada reclamable), impresion fiscal A4 y tickets del agente local.
insert into public.fiscal_artifact_outbox(id,fiscal_document_id,state,attempt_count,generation_token,processed_at)
values ('f1e90000-0000-4000-8000-0000000000b7','f1e90000-0000-4000-8000-000000000007','completed',1,'f1e90000-0000-4000-8000-0000000000c7',now()-interval '7 days');
insert into public.fiscal_document_artifacts(
  id,business_id,fiscal_document_id,artifact_type,state,storage_provider,storage_path,mime_type,size_bytes,sha256,document_number,
  generated_at,generated_by,generation_version,generation_token,is_current
) values (
  'f1e90000-0000-4000-8000-0000000000d7','b1e90000-0000-4000-8000-000000000001','f1e90000-0000-4000-8000-000000000007','authorized_pdf','artifact_ready','supabase_storage',
  public.fiscal_artifact_storage_path('b1e90000-0000-4000-8000-000000000001','f1e90000-0000-4000-8000-000000000007','f1e90000-0000-4000-8000-0000000000c7'),
  'application/pdf',2048,repeat('d',64),9,now()-interval '7 days','legacy-artifact-worker','legacy-v1','f1e90000-0000-4000-8000-0000000000c7',true
);
insert into public.fiscal_print_jobs(id,business_id,fiscal_document_id,artifact_id,printer_name_hash,format,copies,requested_by,idempotency_key,status,completed_at)
values ('f1e90000-0000-4000-8000-0000000000e7','b1e90000-0000-4000-8000-000000000001','f1e90000-0000-4000-8000-000000000007','f1e90000-0000-4000-8000-0000000000d7',
  repeat('e',64),'a4',1,'a1e90000-0000-4000-8000-000000000001','legacy:fiscal-print:0007','completed_when_verifiable',now()-interval '7 days');
insert into public.print_jobs(id,business_id,document_type,source_entity_id,payload,request_source,idempotency_key)
values
  ('f1e90000-0000-4000-8000-0000000000f1','b1e90000-0000-4000-8000-000000000001','fiscal_receipt','f1e90000-0000-4000-8000-000000000007','{"legacy":true}','automatic','legacy:print:printed:0007'),
  ('f1e90000-0000-4000-8000-0000000000f2','b1e90000-0000-4000-8000-000000000001','fiscal_receipt','f1e90000-0000-4000-8000-000000000007','{"legacy":true}','operator','legacy:print:claimed:0007');
-- Antes de la adopcion no habia maquina de estados de impresion: el agente las dejo asi
-- (una impresa, otra reclamada en vuelo por la PC del mostrador).
insert into public.local_devices(id,business_id,device_name,agent_version,status,secret_hash)
values ('f1e90000-0000-4000-8000-0000000000aa','b1e90000-0000-4000-8000-000000000001','PC mostrador legado','0.1.0','active',repeat('a',64));
update public.print_jobs set status = 'printed', printed_at = now() - interval '7 days' where id = 'f1e90000-0000-4000-8000-0000000000f1';
update public.print_jobs set status = 'claimed', claimed_at = now() - interval '1 minute', lease_expires_at = now() + interval '5 minutes',
       claim_token = 'f1e90000-0000-4000-8000-0000000000ab', claimed_by_device_id = 'f1e90000-0000-4000-8000-0000000000aa'
 where id = 'f1e90000-0000-4000-8000-0000000000f2';
