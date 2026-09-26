-- TABA · RG 5616 · CONDICIÓN FRENTE AL IVA DEL RECEPTOR
--
-- ARCA rechaza con 10246 un comprobante sin CondicionIVAReceptorId. Esta suite
-- fija que el dato viaja de punta a punta y que nadie puede fabricarlo:
--
--   1. la tabla oficial (FEParamGetCondicionIvaReceptor) se guarda como snapshot;
--   2. una política que declara una condición inexistente no resuelve;
--   3. una factura nueva no se encola sin la condición (y no inventa comprobante);
--   4. con la condición, la factura la lleva en la fila y en el snapshot del receptor;
--   5. la nota de crédito la hereda de la factura (o de la política si la factura es anterior);
--   6. autorizada, la condición es inmutable.
--
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('71000000-0000-4000-8000-000000000001','authenticated','authenticated','rg5616-owner@example.invalid','',now(),'{}','{}',now(),now());
insert into public.businesses(id,name,status,slug,is_active)
values ('72000000-0000-4000-8000-000000000001','TABA RG 5616','open','taba-rg5616',true);
insert into public.business_members(business_id,user_id,role,is_active)
values ('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','owner',true);
insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
values ('73000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','owner','panel_web');
insert into public.fiscal_profiles(business_id,legal_name,cuit,tax_condition,business_address,environment,point_of_sale,default_currency,
  default_concept,invoice_policy,is_enabled,default_recipient_condition,accountant_review_status,homologation_authorized_at,homologation_authorized_by)
values ('72000000-0000-4000-8000-000000000001','TABA RG 5616 SA','20123456789','Responsable Monotributo','Neuquen','homologation',3,'PES',
  1,'manual',true,'Consumidor Final','approved',now(),'71000000-0000-4000-8000-000000000001');

-- ══ 1 · Tabla oficial de condiciones ═══════════════════════════════════════
select lives_ok(
  $$select public.save_fiscal_parameter_snapshot('homologation','recipient_vat_conditions','fixture-rg5616-v1',
      '{"operation":"FEParamGetCondicionIvaReceptor","values":{"CondicionIvaReceptor":[{"Id":5,"Desc":"Consumidor Final","Cmp_Clase":"B/C"},{"Id":6,"Desc":"Responsable Monotributo","Cmp_Clase":"A/M/C"}]}}'::jsonb, now())$$,
  'el snapshot de FEParamGetCondicionIvaReceptor se guarda');
select throws_ok(
  $$select public.save_fiscal_parameter_snapshot('homologation','condiciones_inventadas','x','{}'::jsonb, now())$$,
  '22023', null, 'un tipo de tabla desconocido se rechaza');
insert into public.fiscal_parameter_snapshots(environment,parameter_type,version,values_json,synchronized_at) values
  ('homologation','document_types','fixture-rg5616-v1','[{"Id":11},{"Id":13}]'::jsonb,now()),
  ('homologation','recipient_document_types','fixture-rg5616-v1','[{"Id":99}]'::jsonb,now());

-- ══ 2 · Política: la condición tiene que existir en ARCA ═══════════════════
insert into public.fiscal_accounting_policies(business_id,environment,policy_version,valid_from,issuer_condition,recipient_condition,concept,
  invoice_type,credit_note_type,recipient_document_type,recipient_document_number,enabled,accountant_review_status,approved_by,approved_at,notes,recipient_vat_condition_id)
values ('72000000-0000-4000-8000-000000000001','homologation','rg5616-inexistente',current_date - 1,'Responsable Monotributo','Consumidor Final',1,
  11,13,99,'0',true,'approved','71000000-0000-4000-8000-000000000001',now(),'Condicion que ARCA no publica',77);
select throws_ok(
  $$select public.resolve_fiscal_accounting_policy('72000000-0000-4000-8000-000000000001','homologation','Responsable Monotributo','Consumidor Final',1,11,current_date)$$,
  'P0001', 'fiscal_policy_review_required', 'una condicion IVA que no esta en la tabla vigente de ARCA no resuelve');

-- ══ 3 · Factura nueva sin condición: no se encola ══════════════════════════
update public.fiscal_accounting_policies set recipient_vat_condition_id = null, policy_version = 'rg5616-sin-condicion'
 where business_id = '72000000-0000-4000-8000-000000000001';

alter table public.products drop constraint products_verified_publication_authority;
insert into public.products(id,business_id,name,description,category,price,image_url,is_active,brand,subcategory,presentation,capacity,packaging_type,stock,available,is_alcoholic,tags,is_verified,verified_at,verified_by,external_id,variant,capacity_value,capacity_unit,catalog_origin,units_per_pack)
values('74000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','Producto RG 5616','Fixture','Gaseosas',121,'https://example.invalid/p.webp',true,'Marca','Cola','Botella','1 l','botella',10,true,false,'{}',true,now(),'71000000-0000-4000-8000-000000000001','rg5616-product','Botella',1,'l','test_only',1);
insert into public.pos_sales(id,business_id,operator_id,state,subtotal,total,currency,idempotency_key,completed_at)
values ('75000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','completed',121,121,'ARS','rg5616-sale-0001',now());
insert into public.pos_sale_items(sale_id,product_id,product_name,quantity,unit_price,line_total,tax_snapshot)
values ('75000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','Producto RG 5616',1,121,121,
  '{"net_amount":"121.00","tax_amount":"0.00","exempt_amount":"0.00","non_taxed_amount":"0.00","other_taxes_amount":"0.00"}'::jsonb);

set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"73000000-0000-4000-8000-000000000001"}';
select throws_ok(
  $$select public.request_fiscal_document('72000000-0000-4000-8000-000000000001','pos_sale','75000000-0000-4000-8000-000000000001','invoice','rg5616-invoice-0001')$$,
  'P0001', 'fiscal_policy_review_required', 'sin CondicionIVAReceptorId en la politica no se encola la factura');
reset role;
select is((select count(*)::integer from public.fiscal_documents where business_id = '72000000-0000-4000-8000-000000000001'), 0,
  'y no se invento ningun comprobante');

-- ══ 4 · Con la condición: viaja en la factura ═══════════════════════════════
update public.fiscal_accounting_policies set recipient_vat_condition_id = 5, policy_version = 'rg5616-v1'
 where business_id = '72000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"73000000-0000-4000-8000-000000000001"}';
select is(
  public.request_fiscal_document('72000000-0000-4000-8000-000000000001','pos_sale','75000000-0000-4000-8000-000000000001','invoice','rg5616-invoice-0002') ->> 'state',
  'queued', 'con la condicion aprobada la factura se encola');
reset role;
select is(
  (select recipient_vat_condition_id from public.fiscal_documents where idempotency_key = 'rg5616-invoice-0002'),
  5, 'la factura lleva CondicionIVAReceptorId = 5 (Consumidor Final)');
select is(
  (select (recipient_snapshot->>'vat_condition_id')::integer from public.fiscal_documents where idempotency_key = 'rg5616-invoice-0002'),
  5, 'y el snapshot del receptor la conserva para el PDF y la auditoria');
select ok(
  exists (select 1 from public.fiscal_events e join public.fiscal_documents d on d.id = e.fiscal_document_id
           where d.idempotency_key = 'rg5616-invoice-0002' and e.event_type = 'queued' and (e.sanitized_detail->>'recipient_vat_condition_id')::integer = 5),
  'el evento de encolado registra la condicion usada');

-- ══ 5 · Nota de crédito: hereda la condición ════════════════════════════════
update public.fiscal_documents
   set state = 'authorized', cae = '12345678901234', cae_expiration = current_date + 10, document_number = 7, issue_date = current_date, authorized_at = now()
 where idempotency_key = 'rg5616-invoice-0002';
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"73000000-0000-4000-8000-000000000001"}';
select lives_ok(
  $$select public.request_full_credit_note((select id from public.fiscal_documents where idempotency_key = 'rg5616-invoice-0002'), 'Devolucion total fixture', 'rg5616-credit-0001')$$,
  'la nota de credito total se encola');
reset role;
select is(
  (select recipient_vat_condition_id from public.fiscal_documents where idempotency_key = 'rg5616-credit-0001'),
  5, 'la nota de credito hereda la condicion de la factura');

-- Factura anterior a RG 5616 (sin condición): la nota toma la de la política vigente.
insert into public.fiscal_documents(id,business_id,source_type,source_id,document_intent,environment,cuit,point_of_sale,document_type,concept,
  currency,currency_rate,recipient_type,recipient_document_type,recipient_document_number,net_amount,total_amount,state,idempotency_key,
  issuer_snapshot,recipient_snapshot,fiscal_policy_version,cae,cae_expiration,document_number,issue_date,authorized_at)
values ('76000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','pos_sale','76000000-0000-4000-8000-0000000000aa','invoice',
  'homologation','20123456789',3,11,1,'PES',1,'Consumidor Final',99,'0',50,50,'authorized','rg5616-legacy-0001','{}','{"condition":"Consumidor Final"}',
  'rg5616-v1','12345678901235',current_date + 10,6,current_date,now());
insert into public.fiscal_document_items(fiscal_document_id,description,quantity,unit_price,net_amount,tax_amount)
values ('76000000-0000-4000-8000-000000000001','Producto legado',1,50,50,0);
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"73000000-0000-4000-8000-000000000001"}';
select lives_ok(
  $$select public.request_full_credit_note('76000000-0000-4000-8000-000000000001', 'Devolucion factura legada', 'rg5616-credit-0002')$$,
  'una factura anterior a RG 5616 tambien admite nota de credito');
reset role;
select is(
  (select recipient_vat_condition_id from public.fiscal_documents where idempotency_key = 'rg5616-credit-0002'),
  5, 'y la nota toma la condicion de la politica vigente');

-- ══ 6 · Autorizada, la condición es inmutable ═══════════════════════════════
select throws_ok(
  $$update public.fiscal_documents set recipient_vat_condition_id = 1 where idempotency_key = 'rg5616-invoice-0002'$$,
  '55000', 'los datos autorizados son inmutables', 'la condicion IVA de un comprobante autorizado no se edita');

select * from finish();
rollback;
