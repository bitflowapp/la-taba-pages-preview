-- Circuito fiscal ARCA de punta a punta, con los contratos reales.
--
-- No inserta comprobantes a mano: recorre configure_fiscal_profile ->
-- upsert/approve de política -> checkout_pos_sale -> intención -> promotor ->
-- outbox -> reserva de número -> complete_fiscal_attempt, y verifica que cada
-- puerta cierre cuando falta una decisión humana.

begin;
create extension if not exists pgtap with schema extensions;
select plan(91);

-- ===== Fixture =====
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('51000000-0000-4000-8000-000000000001','authenticated','authenticated','arca-owner@example.invalid','',now(),'{}','{}',now(),now()),
  ('51000000-0000-4000-8000-000000000002','authenticated','authenticated','arca-staff@example.invalid','',now(),'{}','{}',now(),now());
insert into public.businesses(id,name,status,slug,is_active)
values ('52000000-0000-4000-8000-000000000001','TABA ARCA fixture','open','taba-arca-fixture',true);
insert into public.business_members(business_id,user_id,role,is_active) values
  ('52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','owner',true),
  ('52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002','staff',true);
-- Igual que el resto de las suites POS: se relaja SOLO el vinculo de imagen
-- comercial dentro de esta transaccion, que el ROLLBACK restaura. Todas las
-- reglas fiscales siguen activas.
alter table public.products drop constraint products_verified_publication_authority;
insert into public.products(id,business_id,name,description,category,price,image_url,is_active,brand,subcategory,presentation,capacity,packaging_type,stock,available,is_alcoholic,minimum_age,tags,is_verified,verified_at,verified_by,external_id,variant,capacity_value,capacity_unit,catalog_origin,units_per_pack)
values
  ('53000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','Cerveza 473ml','Fixture fiscal','Cervezas',1210.00,'https://example.invalid/a.webp',true,'Marca','Rubia','Lata','473 ml','lata',50,true,true,18,'{}',true,now(),'51000000-0000-4000-8000-000000000001','arca-prod-1','Lata',473,'ml','test_only',1),
  ('53000000-0000-4000-8000-000000000002','52000000-0000-4000-8000-000000000001','Gaseosa 500ml','Fixture fiscal','Gaseosas',605.00,'https://example.invalid/b.webp',true,'Marca','Cola','Botella','500 ml','botella',50,true,false,null,'{}',true,now(),'51000000-0000-4000-8000-000000000001','arca-prod-2','Botella',500,'ml','test_only',1);

set local role authenticated;
set local request.jwt.claims = '{"sub":"51000000-0000-4000-8000-000000000001","role":"authenticated"}';

select lives_ok(
  $$select public.configure_fiscal_profile('52000000-0000-4000-8000-000000000001', jsonb_build_object(
      'legal_name','TABA ARCA Fixture','cuit','20123456789','tax_condition','Responsable Inscripto',
      'business_address','Calle Falsa 123','environment','homologation','point_of_sale',3,
      'default_currency','PES','default_concept',1,'invoice_policy','on_payment_confirmed',
      'is_enabled',true,'default_recipient_condition','Consumidor Final'))$$,
  'el perfil fiscal de homologacion se configura sin autorizar nada'
);

-- ===== 1. Sin politica aprobada, el mostrador vende y NO finge un precio fiscal =====
select lives_ok(
  $$select public.checkout_pos_sale('52000000-0000-4000-8000-000000000001',
      '[{"productId":"53000000-0000-4000-8000-000000000001","quantity":2}]'::jsonb,'cash','arca-sale-nopolicy-1',true)$$,
  'el mostrador cobra aunque la facturacion no este lista'
);
select is(
  (select tax_snapshot->>'fiscal_pricing' from public.pos_sale_items i
     join public.pos_sales s on s.id=i.sale_id where s.idempotency_key='arca-sale-nopolicy-1'),
  'unavailable',
  'sin politica el snapshot dice explicitamente que no hay precio fiscal'
);
select is(
  (select total from public.pos_sales where idempotency_key='arca-sale-nopolicy-1'),
  2420.00::numeric,
  'sin politica el total cobrado es el precio de lista'
);
select is(
  (select count(*)::int from public.fiscal_emission_intents where business_id='52000000-0000-4000-8000-000000000001'),
  0,
  'sin politica no se encola ninguna intencion fiscal'
);
select throws_ok(
  $$select public.request_fiscal_document('52000000-0000-4000-8000-000000000001','pos_sale',
      (select id from public.pos_sales where idempotency_key='arca-sale-nopolicy-1'),'invoice','arca-doc-nopolicy-1')$$,
  'P0001','fiscal_policy_review_required','sin politica aprobada no se arma ningun comprobante'
);

-- ===== 2. La politica se declara, no se deduce =====
select lives_ok(
  $$select public.upsert_fiscal_accounting_policy('52000000-0000-4000-8000-000000000001', jsonb_build_object(
      'environment','homologation','policy_version','arca-v1','issuer_condition','Responsable Inscripto',
      'recipient_condition','Consumidor Final','concept',1,'invoice_type',6,'credit_note_type',8,
      'recipient_document_type',99,'recipient_document_number','0','recipient_vat_condition_id',5,
      'vat_computation','discriminated','vat_rate_id',5,'vat_rate_percent',21,'prices_include_vat',true,
      'delivery_vat_rate_id',5,'delivery_vat_rate_percent',21,
      'authorized_sources',jsonb_build_array('pos_sale','online_order'),
      'notes','Fixture sintetico; no constituye aprobacion contable real.'))$$,
  'owner declara una politica contable'
);
-- La tabla de politicas no es legible directamente ni por owner: el Panel la ve
-- por RPC. El test usa el mismo camino, y guarda el id para las llamadas siguientes.
select is(
  (select count(*)::int from public.list_fiscal_accounting_policies('52000000-0000-4000-8000-000000000001')),
  1,
  'el Panel ve la politica por RPC, no leyendo la tabla'
);
select is(
  (select enabled from public.list_fiscal_accounting_policies('52000000-0000-4000-8000-000000000001') limit 1),
  false,
  'declarar una politica no la habilita'
);
select is(
  (select accountant_review_status from public.list_fiscal_accounting_policies('52000000-0000-4000-8000-000000000001') limit 1),
  'pending',
  'una politica recien declarada queda pendiente de revision'
);
create temporary table arca_policy on commit drop as
  select id from public.list_fiscal_accounting_policies('52000000-0000-4000-8000-000000000001') limit 1;
grant select on arca_policy to authenticated;
select throws_ok(
  $$select public.approve_fiscal_accounting_policy((select id from arca_policy),
      'I_APPROVE_THIS_FISCAL_ACCOUNTING_POLICY','')$$,
  'P0001','fiscal_parameters_not_synchronized',
  'sin tablas oficiales sincronizadas la politica no se aprueba'
);

-- El puente sincroniza las tablas oficiales (aca, sinteticas: el test no habla con ARCA).
set local role postgres;
select lives_ok(
  $$select public.save_fiscal_parameter_snapshot('homologation','document_types','arca-fixture-1','[{"Id":6},{"Id":8}]'::jsonb,now())$$,
  'el puente guarda la tabla oficial de tipos de comprobante'
);
select lives_ok(
  $$select public.save_fiscal_parameter_snapshot('homologation','recipient_document_types','arca-fixture-1','[{"Id":99}]'::jsonb,now())$$,
  'el puente guarda la tabla oficial de documentos del receptor'
);
select lives_ok(
  $$select public.save_fiscal_parameter_snapshot('homologation','vat_types','arca-fixture-1','[{"Id":5}]'::jsonb,now())$$,
  'el puente guarda la tabla oficial de alicuotas'
);
select lives_ok(
  $$select public.save_fiscal_parameter_snapshot('homologation','vat_receptor_conditions','arca-fixture-1','[{"Id":5}]'::jsonb,now())$$,
  'el puente guarda la tabla oficial de condicion IVA del receptor'
);
-- El puente sincroniza las siete tablas; el Panel considera "sincronizado" solo
-- cuando estan las siete y ninguna tiene mas de siete dias.
select lives_ok(
  $$select public.save_fiscal_parameter_snapshot('homologation','currencies','arca-fixture-1','[{"Id":"PES"}]'::jsonb,now())
    ; select public.save_fiscal_parameter_snapshot('homologation','concepts','arca-fixture-1','[{"Id":1},{"Id":2},{"Id":3}]'::jsonb,now())
    ; select public.save_fiscal_parameter_snapshot('homologation','points_of_sale','arca-fixture-1','[{"Nro":3}]'::jsonb,now())$$,
  'el puente guarda tambien monedas, conceptos y puntos de venta'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"51000000-0000-4000-8000-000000000001","role":"authenticated"}';

select throws_ok(
  $$select public.approve_fiscal_accounting_policy((select id from arca_policy),'SI, APROBAR','')$$,
  '22023','aprobacion de politica fiscal ausente','aprobar exige la frase exacta'
);
select lives_ok(
  $$select public.approve_fiscal_accounting_policy((select id from arca_policy),
      'I_APPROVE_THIS_FISCAL_ACCOUNTING_POLICY','Revisado con el contador.')$$,
  'con parametros sincronizados y frase exacta la politica queda aprobada'
);
select is(
  (select enabled and accountant_review_status='approved' and approved_at is not null
     from public.list_fiscal_accounting_policies('52000000-0000-4000-8000-000000000001') limit 1),
  true,
  'la aprobacion queda registrada completa: habilitada y con fecha'
);

-- ===== 3. El snapshot impositivo del mostrador es real (corte 1) =====
select lives_ok(
  $$select public.checkout_pos_sale('52000000-0000-4000-8000-000000000001',
      '[{"productId":"53000000-0000-4000-8000-000000000001","quantity":2},
        {"productId":"53000000-0000-4000-8000-000000000002","quantity":1}]'::jsonb,'cash','arca-sale-1',true)$$,
  'el mostrador cobra con politica aprobada'
);
select is(
  (select count(*)::int from public.pos_sale_items i join public.pos_sales s on s.id=i.sale_id
    where s.idempotency_key='arca-sale-1'
      and i.tax_snapshot ?& array['net_amount','tax_amount','exempt_amount','non_taxed_amount','other_taxes_amount']),
  2,
  'cada item lleva las cinco claves de importes que exige el contrato fiscal'
);
select is(
  (select (i.tax_snapshot->>'net_amount')::numeric from public.pos_sale_items i join public.pos_sales s on s.id=i.sale_id
    where s.idempotency_key='arca-sale-1' and i.unit_price=1210.00),
  2000.00::numeric,
  'IVA 21% incluido en el precio se desagrega exacto: 2420 cobrados -> 2000 de neto'
);
select is(
  (select (i.tax_snapshot->>'tax_amount')::numeric from public.pos_sale_items i join public.pos_sales s on s.id=i.sale_id
    where s.idempotency_key='arca-sale-1' and i.unit_price=1210.00),
  420.00::numeric,
  'el IVA desagregado del item es exacto'
);
select is(
  (select sum((i.tax_snapshot->>'net_amount')::numeric + (i.tax_snapshot->>'tax_amount')::numeric)
     from public.pos_sale_items i join public.pos_sales s on s.id=i.sale_id where s.idempotency_key='arca-sale-1'),
  (select total from public.pos_sales where idempotency_key='arca-sale-1'),
  'neto mas IVA cierra exactamente contra lo cobrado'
);
select is(
  (select (i.tax_snapshot->>'tax_code')::integer from public.pos_sale_items i join public.pos_sales s on s.id=i.sale_id
    where s.idempotency_key='arca-sale-1' limit 1),
  5,
  'el codigo de alicuota es el declarado en la politica, no uno inventado'
);

-- ===== 4. Intencion idempotente: doble click no factura dos veces =====
select is(
  (select count(*)::int from public.fiscal_emission_intents
    where source_type='pos_sale' and source_id=(select id from public.pos_sales where idempotency_key='arca-sale-1')),
  1,
  'la venta con pedido de comprobante encola exactamente una intencion'
);
select is(
  ((select public.checkout_pos_sale('52000000-0000-4000-8000-000000000001',
      '[{"productId":"53000000-0000-4000-8000-000000000001","quantity":2},
        {"productId":"53000000-0000-4000-8000-000000000002","quantity":1}]'::jsonb,'cash','arca-sale-1',true))->>'idempotent_replay')::boolean,
  true,
  'el doble click sobre la misma venta es replay'
);
select is(
  (select count(*)::int from public.fiscal_emission_intents where business_id='52000000-0000-4000-8000-000000000001'),
  1,
  'el replay no encola una segunda intencion'
);

-- ===== 5. Sin autorizacion humana de homologacion no se emite (y la intencion lo dice) =====
set local role postgres;
select is(
  ((select public.promote_fiscal_emission_intents('taba-fiscal-test',5,90))->>'manual_review')::int,
  1,
  'sin autorizacion registrada la intencion va a revision humana, no a ARCA'
);
select is(
  (select count(*)::int from public.fiscal_documents where business_id='52000000-0000-4000-8000-000000000001'),
  0,
  'y no se crea ningun comprobante'
);

-- El puente publica la salud de credenciales (corte 3): sin esto el boton de
-- homologacion era inalcanzable para siempre.
select lives_ok(
  $$select public.record_fiscal_credential_health('52000000-0000-4000-8000-000000000001',
      repeat('a',64), now() + interval '300 days','20123456789','verified',true,null)$$,
  'el puente publica huella, vencimiento y CUIT del certificado'
);
select is(
  (select certificate_fingerprint_sha256 is not null from public.fiscal_profiles where business_id='52000000-0000-4000-8000-000000000001'),
  true,
  'la huella del certificado queda registrada sin exponer la clave privada'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"51000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$select public.authorize_arca_homologation('52000000-0000-4000-8000-000000000001','I_AUTHORIZE_ARCA_HOMOLOGATION')$$,
  'P0001','falta la aprobacion contable','con certificado pero sin revision contable la homologacion sigue cerrada'
);
select throws_ok(
  $$select public.record_fiscal_accountant_review('52000000-0000-4000-8000-000000000001','approved','SI','')$$,
  '22023','confirmacion de revision contable ausente','la revision contable exige la frase exacta'
);
select lives_ok(
  $$select public.record_fiscal_accountant_review('52000000-0000-4000-8000-000000000001','approved','I_CONFIRM_THE_FISCAL_DATA_WERE_REVIEWED','Datos revisados.')$$,
  'la revision contable se registra con frase, actor y fecha'
);
select throws_ok(
  $$select public.authorize_arca_homologation('52000000-0000-4000-8000-000000000001','ok dale')$$,
  '22023','autorizacion de homologacion ausente','autorizar homologacion exige la frase exacta'
);
select lives_ok(
  $$select public.authorize_arca_homologation('52000000-0000-4000-8000-000000000001','I_AUTHORIZE_ARCA_HOMOLOGATION')$$,
  'con certificado, revision contable y frase exacta la homologacion queda autorizada'
);

-- ===== 6. El promotor crea el comprobante encolado =====
set local role postgres;
update public.fiscal_emission_intents set state='pending', next_attempt_at=now(), attempt_count=0
  where business_id='52000000-0000-4000-8000-000000000001';
select is(
  ((select public.promote_fiscal_emission_intents('taba-fiscal-test',5,90))->>'promoted')::int,
  1,
  'con todo autorizado la intencion se convierte en comprobante'
);
select is(
  (select state from public.fiscal_documents where business_id='52000000-0000-4000-8000-000000000001'),
  'queued',
  'el comprobante nace encolado, nunca autorizado'
);
select is(
  (select total_amount from public.fiscal_documents where business_id='52000000-0000-4000-8000-000000000001'),
  (select total from public.pos_sales where idempotency_key='arca-sale-1'),
  'el total del comprobante es exactamente lo cobrado'
);
select is(
  (select net_amount + tax_amount + exempt_amount + non_taxed_amount + other_taxes_amount
     from public.fiscal_documents where business_id='52000000-0000-4000-8000-000000000001'),
  (select total_amount from public.fiscal_documents where business_id='52000000-0000-4000-8000-000000000001'),
  'los componentes del comprobante suman su total'
);
select is(
  (select recipient_vat_condition_id from public.fiscal_documents where business_id='52000000-0000-4000-8000-000000000001'),
  5,
  'la condicion IVA del receptor viaja congelada desde la politica'
);
select is(
  (select count(*)::int from public.fiscal_outbox o join public.fiscal_documents d on d.id=o.fiscal_document_id
    where d.business_id='52000000-0000-4000-8000-000000000001' and o.state='pending'),
  1,
  'queda un trabajo pendiente en la outbox fiscal'
);
select is(
  ((select public.promote_fiscal_emission_intents('taba-fiscal-test',5,90))->>'claimed')::int,
  0,
  'una intencion ya promovida no se vuelve a tomar'
);

-- ===== 7. La outbox esta acotada por ambiente y CUIT =====
select is(
  (select count(*)::int from public.claim_fiscal_outbox('taba-otro-cuit',5,90,'homologation','20999999999')),
  0,
  'un worker con otro CUIT no reclama comprobantes ajenos'
);
select is(
  (select count(*)::int from public.claim_fiscal_outbox('taba-produccion',5,90,'production','20123456789')),
  0,
  'un worker de produccion no reclama comprobantes de homologacion'
);

-- ===== 8. Numeracion, CAE y cierre del intento =====
create temporary table arca_claim on commit drop as
  select * from public.claim_fiscal_outbox('taba-fiscal-test',5,90,'homologation','20123456789');
select is((select count(*)::int from arca_claim), 1, 'el worker correcto reclama el trabajo');

select is(
  (select document_number from public.reserve_fiscal_document_number(
     (select fiscal_document_id from arca_claim),'taba-fiscal-test',1)),
  1::bigint,
  'la reserva de numero es local, correlativa y con advisory lock'
);
select is(
  (select state from public.fiscal_documents where id=(select fiscal_document_id from arca_claim)),
  'authorizing',
  'reservar numero deja el comprobante en autorizacion, no autorizado'
);
select throws_ok(
  format($$select public.complete_fiscal_attempt(%L,'taba-fiscal-test',
    jsonb_build_object('classification','authorized','cae','1234567890123','document_number',1))$$,
    (select id from arca_claim)),
  '22023','autorizacion sin CAE o numero valido','un CAE de 13 digitos no autoriza nada'
);
select lives_ok(
  format($$select public.complete_fiscal_attempt(%L,'taba-fiscal-test', jsonb_build_object(
      'classification','authorized','cae','75123456789012','cae_expiration','2026-08-20',
      'issue_date','2026-08-07','document_number',1,'request_hash',repeat('a',64),'response_hash',repeat('b',64),
      'operation','FECAESolicitar','duration_ms',120))$$,
    (select id from arca_claim)),
  'con CAE de 14 digitos el comprobante queda autorizado'
);
select is(
  (select state || ':' || cae from public.fiscal_documents where id=(select fiscal_document_id from arca_claim)),
  'authorized:75123456789012',
  'el CAE queda persistido junto al estado autorizado'
);
select is(
  (select cae_expiration from public.fiscal_documents where id=(select fiscal_document_id from arca_claim)),
  '2026-08-20'::date,
  'el vencimiento del CAE queda persistido'
);
select is(
  (select state from public.pos_sales where idempotency_key='arca-sale-1'),
  'completed',
  'la venta sale de completed_fiscal_pending cuando el comprobante se resuelve'
);
select is(
  (select state from public.fiscal_outbox where id=(select id from arca_claim)),
  'completed',
  'el trabajo de la outbox queda cerrado'
);
select is(
  (select count(*)::int from public.fiscal_request_attempts where fiscal_document_id=(select fiscal_document_id from arca_claim)),
  1,
  'el intento contra ARCA queda auditado (el rechazo por CAE invalido revierte entero, como debe)'
);

-- ===== 9. Inmutabilidad y proyeccion honesta de estados =====
select throws_ok(
  format($$update public.fiscal_documents set total_amount = 1 where id = %L$$, (select fiscal_document_id from arca_claim)),
  '55000','los datos autorizados son inmutables','un comprobante autorizado no se puede reescribir'
);
select is(public.fiscal_public_state('authorized','75123456789012'), 'authorized', 'autorizado con CAE se muestra autorizado');
select is(public.fiscal_public_state('authorized',null), 'attention', 'autorizado sin CAE nunca se muestra autorizado');
select is(public.fiscal_public_state('authorized','123'), 'attention', 'un CAE corto no alcanza para decir autorizado');
select is(public.fiscal_public_state('queued',null), 'pending', 'encolado se muestra pendiente');
select is(public.fiscal_public_state('authorizing',null), 'processing', 'autorizando se muestra procesando');
select is(public.fiscal_public_state('retry_wait',null), 'processing', 'esperando reintento se muestra procesando');
select is(public.fiscal_public_state('ambiguous',null), 'processing', 'ambiguo se muestra procesando mientras se consulta');
select is(public.fiscal_public_state('rejected',null), 'rejected', 'rechazado se muestra rechazado');
select is(public.fiscal_public_state('manual_review',null), 'attention', 'revision manual se muestra como requiere atencion');
select is(public.fiscal_public_state('failed',null), 'attention', 'fallado se muestra como requiere atencion');
select is(
  (select count(*)::int from unnest(array['draft','queued','claiming','authenticating','authorizing','authorized',
    'observed','rejected','ambiguous','retry_wait','failed','manual_review','credited']) as s
   where public.fiscal_public_state(s, null) not in ('pending','processing','authorized','rejected','attention')),
  0,
  'ningun estado real cae fuera de las cinco palabras que la UI puede decir'
);

-- ===== 10. Cero doble emision sobre el mismo origen =====
set local role authenticated;
set local request.jwt.claims = '{"sub":"51000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  ((select public.request_fiscal_document('52000000-0000-4000-8000-000000000001','pos_sale',
      (select id from public.pos_sales where idempotency_key='arca-sale-1'),'invoice','arca-otra-clave-distinta'))->>'idempotent_replay')::boolean,
  true,
  'otra clave de idempotencia sobre una venta ya facturada devuelve el mismo comprobante'
);
select is(
  (select count(*)::int from public.fiscal_documents where business_id='52000000-0000-4000-8000-000000000001'),
  1,
  'sigue existiendo un solo comprobante para esa venta'
);

-- ===== 11. Permisos: el navegador no toca nada del worker =====
select throws_ok(
  $$select public.promote_fiscal_emission_intents('taba-fiscal-test',5,90)$$,
  '42501',null,'un usuario autenticado no puede correr el promotor'
);
select throws_ok(
  $$select public.claim_fiscal_outbox('taba-fiscal-test',5,90,'homologation','20123456789')$$,
  '42501',null,'un usuario autenticado no puede reclamar la outbox fiscal'
);
select throws_ok(
  $$select public.internal_create_fiscal_document('52000000-0000-4000-8000-000000000001','pos_sale',
      gen_random_uuid(),'clave-directa-1',null,'system')$$,
  '42501',null,'un usuario autenticado no puede saltear la puerta de autorizacion'
);

-- ===== 12. Pedido pagado online: el circuito arranca solo y verifica el pago =====
set local role postgres;
insert into public.checkout_sessions(id,business_id,customer_id,client_request_id,normalized_intent_hash,fulfillment_type,
  subtotal,discount_total,delivery_fee,total,status,expires_at)
values ('54000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002',
  'arca-checkout-0001',repeat('c',64),'delivery',3025.00,25.00,500.00,3500.00,'completed',now()+interval '1 hour');
insert into public.orders(id,business_id,code,public_code,status,fulfillment_type,delivery_mode,payment_method,
  subtotal,discount_total,delivery_fee,total,client_request_id,currency_code,customer_name,customer_phone)
values ('55000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','LT-ARCA-1','LT-ARCA-1','received',
  'delivery','delivery','mercadopago',3025.00,25.00,500.00,3500.00,'arca-order-0001','ARS','Cliente','1130000000');
insert into public.order_items(order_id,product_id,name,quantity,unit,unit_price,subtotal) values
  ('55000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000001','Cerveza 473ml',2,'lata',1210.00,2420.00),
  ('55000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000002','Gaseosa 500ml',1,'botella',605.00,605.00);

select is(
  (select count(*)::int from public.fiscal_emission_intents
    where source_type='online_order' and source_id='55000000-0000-4000-8000-000000000001'),
  1,
  'el pedido pagado encola su intencion fiscal sin que nadie apriete nada'
);
select is(
  (select trigger_reason from public.fiscal_emission_intents where source_type='online_order'),
  'payment_confirmed',
  'la intencion registra por que se disparo'
);
-- El webhook del pago puede llegar despues que el pedido: no verificarlo todavia
-- es transitorio, asi que la intencion espera con backoff en vez de darse por muerta.
select is(
  ((select public.promote_fiscal_emission_intents('taba-fiscal-test',5,90))->>'retry')::int,
  1,
  'sin pago verificado por el servidor el pedido no se factura'
);
select is(
  (select last_error_code from public.fiscal_emission_intents where source_type='online_order'),
  'FISCAL_INTENT_RETRY',
  'y la intencion queda con un codigo saneado, no con el SQL crudo'
);
select is(
  (select count(*)::int from public.fiscal_documents where source_type='online_order'),
  0,
  'mientras el pago no este verificado no existe ningun comprobante del pedido'
);

insert into public.payment_intents(checkout_session_id,business_id,environment,external_reference,order_id,
  provider_status,internal_status,expected_amount,paid_amount)
values ('54000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','test','taba2:checkout:54000000-0000-4000-8000-000000000001',
  '55000000-0000-4000-8000-000000000001','approved','completed',3500.00,3500.00);
update public.fiscal_emission_intents set state='pending', next_attempt_at=now(), attempt_count=0
  where source_type='online_order';
select is(
  ((select public.promote_fiscal_emission_intents('taba-fiscal-test',5,90))->>'promoted')::int,
  1,
  'con el pago verificado el pedido se convierte en comprobante'
);
select is(
  (select total_amount from public.fiscal_documents where source_type='online_order'),
  3500.00::numeric,
  'el comprobante del pedido vale exactamente lo cobrado (subtotal - descuento + envio)'
);
select is(
  (select net_amount + tax_amount from public.fiscal_documents where source_type='online_order'),
  3500.00::numeric,
  'neto mas IVA cierra al centavo con el descuento prorrateado'
);
select is(
  (select count(*)::int from public.fiscal_document_items i
     join public.fiscal_documents d on d.id=i.fiscal_document_id
    where d.source_type='online_order' and i.tax_snapshot->>'line_kind'='delivery_fee'),
  1,
  'el envio viaja como su propia linea con el tratamiento declarado'
);
select is(
  (select sum((i.tax_snapshot->>'net_amount')::numeric + (i.tax_snapshot->>'tax_amount')::numeric)
     from public.fiscal_document_items i join public.fiscal_documents d on d.id=i.fiscal_document_id
    where d.source_type='online_order'),
  3500.00::numeric,
  'la suma de las lineas fiscales reproduce el total sin perder un centavo'
);
select is(
  (select count(*)::int from public.fiscal_documents where source_type='online_order'),
  1,
  'un pedido pagado produce un unico comprobante'
);
select is(
  (select state from public.fiscal_emission_intents where source_type='online_order'),
  'promoted',
  'la intencion queda cerrada apuntando a su comprobante'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"51000000-0000-4000-8000-000000000001","role":"authenticated"}';
-- ===== 13. Tocar una politica aprobada la devuelve a revision =====
select lives_ok(
  $$select public.upsert_fiscal_accounting_policy('52000000-0000-4000-8000-000000000001', jsonb_build_object(
      'environment','homologation','policy_version','arca-v1','issuer_condition','Responsable Inscripto',
      'recipient_condition','Consumidor Final','concept',1,'invoice_type',6,'credit_note_type',8,
      'recipient_document_type',99,'recipient_document_number','0','recipient_vat_condition_id',5,
      'vat_computation','discriminated','vat_rate_id',5,'vat_rate_percent',10.5,'prices_include_vat',true,
      'authorized_sources',jsonb_build_array('pos_sale')))$$,
  'la politica se puede corregir'
);
select is(
  (select enabled or accountant_review_status='approved'
     from public.list_fiscal_accounting_policies('52000000-0000-4000-8000-000000000001') limit 1),
  false,
  'cambiar un dato fiscal exige que alguien lo vuelva a aprobar'
);


-- ===== 14. El Panel ve si se puede facturar, no solo si hay certificado =====
set local role authenticated;
set local request.jwt.claims = '{"sub":"51000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  ((select public.get_fiscal_policy_status('52000000-0000-4000-8000-000000000001'))->>'fiscal_parameters_synchronized')::boolean,
  true,
  'el Panel sabe que las tablas oficiales estan sincronizadas'
);
select is(
  ((select public.get_fiscal_policy_status('52000000-0000-4000-8000-000000000001'))->>'accounting_policy_ready')::boolean,
  false,
  'tras corregir la politica sin volver a aprobarla, el Panel deja de decir que se puede facturar'
);
select is(
  ((select public.get_fiscal_policy_status('52000000-0000-4000-8000-000000000001'))->>'accounting_policy_declared')::boolean,
  true,
  'pero distingue "declarada sin aprobar" de "no existe"'
);
select is(
  ((select public.get_fiscal_policy_status('52000000-0000-4000-8000-000000000001'))->>'documents_requiring_attention')::int,
  0,
  'ningun comprobante de esta corrida quedo pidiendo atencion'
);

select * from finish();
rollback;
