begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

select has_table('public', 'product_barcodes', 'barcodes persistidos');
select has_table('public', 'inventory_movements', 'ledger de inventario persistido');
select has_table('public', 'fiscal_outbox', 'outbox fiscal persistida');
select has_table('public', 'fiscal_request_attempts', 'intentos fiscales persistidos');
select has_function('public', 'checkout_pos_sale', array['uuid','jsonb','text','text','boolean'], 'checkout POS existe');
select has_function('public', 'reserve_fiscal_document_number', array['uuid','text','bigint'], 'reserva fiscal privada existe');

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('10000000-0000-4000-8000-000000000001','authenticated','authenticated','operator@example.invalid','',now(),'{}','{}',now(),now());
insert into public.businesses(id,name,status,slug,is_active)
values('20000000-0000-4000-8000-000000000001','TABA integración','open','taba-integration',true);
insert into public.business_members(business_id,user_id,role,is_active)
values('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','staff',true);
-- El test aísla POS/inventario: relaja sólo el vínculo de imagen comercial dentro
-- de esta transacción y lo restaura con ROLLBACK. El resto de las reglas maestras sigue activo.
alter table public.products drop constraint products_verified_publication_authority;
insert into public.products(id,business_id,name,description,category,price,image_url,is_active,brand,subcategory,presentation,capacity,packaging_type,stock,available,is_alcoholic,tags,is_verified,verified_at,verified_by,external_id,variant,capacity_value,capacity_unit,catalog_origin,units_per_pack)
values('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Producto integración','Fixture transaccional','Gaseosas',100,'https://example.invalid/product.webp',true,'Marca integración','Cola','Botella','1 l','botella',10,true,false,'{}',true,now(),'10000000-0000-4000-8000-000000000001','integration-product','Botella',1,'l','test_only',1);

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';

select lives_ok(
  $$select public.checkout_pos_sale('20000000-0000-4000-8000-000000000001','[{"productId":"30000000-0000-4000-8000-000000000001","quantity":2}]'::jsonb,'cash','integration-checkout-1',true)$$,
  'checkout POS confirma venta, pago y stock'
);
select is((select stock from public.products where id='30000000-0000-4000-8000-000000000001'), 8, 'checkout descuenta stock una vez');
select is((select count(*)::integer from public.inventory_movements where reference_type='pos_sale'), 1, 'checkout crea un movimiento inmutable');
select is((select count(*)::integer from public.pos_sales where idempotency_key='integration-checkout-1'), 1, 'checkout crea una venta');
select is((select state from public.pos_sales where idempotency_key='integration-checkout-1'), 'completed', 'venta queda confirmada antes de fiscalizar');

select lives_ok(
  $$select public.checkout_pos_sale('20000000-0000-4000-8000-000000000001','[{"productId":"30000000-0000-4000-8000-000000000001","quantity":2}]'::jsonb,'cash','integration-checkout-1',true)$$,
  'replay POS es idempotente'
);
select is((select stock from public.products where id='30000000-0000-4000-8000-000000000001'), 8, 'replay no descuenta stock otra vez');

select throws_ok(
  format($sql$select public.request_fiscal_document('20000000-0000-4000-8000-000000000001','pos_sale',%L::uuid,'invoice','integration-fiscal-1')$sql$,
    (select id from public.pos_sales where idempotency_key='integration-checkout-1')),
  'P0001', 'fiscalizacion deshabilitada', 'fiscal falla cerrado sin perfil habilitado'
);
select is((select state from public.pos_sales where idempotency_key='integration-checkout-1'), 'completed', 'falla fiscal no revierte la venta');
select is((select count(*)::integer from public.fiscal_documents), 0, 'falla fiscal no inventa comprobante');

set local role postgres;

select is((select relrowsecurity from pg_class where oid='public.fiscal_outbox'::regclass), true, 'outbox fiscal tiene RLS');

select has_table('public', 'fiscal_document_artifacts', 'artefactos fiscales persistidos');
select has_table('public', 'fiscal_artifact_outbox', 'outbox de artefactos persistida');
select has_table('public', 'fiscal_print_jobs', 'auditoria de impresion persistida');
select has_table('public', 'fiscal_accounting_policies', 'politicas contables versionadas');
select has_table('public', 'fiscal_credit_allocations', 'saldo acreditable persistido');
select has_function('public', 'request_credit_note', array['uuid','text','text','jsonb','text'], 'nota de credito parcial existe');
select has_function('public', 'claim_fiscal_artifact_outbox', array['text','integer','integer'], 'worker de artefactos privado existe');
select has_function('public', 'complete_fiscal_artifact', array['uuid','text','jsonb'], 'persistencia de artefacto existe');
select has_function('public', 'authorize_fiscal_artifact_access', array['uuid','text'], 'autorizacion de descarga privada existe');
select has_function('public', 'request_fiscal_print_job', array['uuid','uuid','text','text','integer','text'], 'solicitud de reimpresion existe');
select is((select public from storage.buckets where id='fiscal-documents'), false, 'bucket fiscal es privado');
select is((select relrowsecurity from pg_class where oid='public.fiscal_document_artifacts'::regclass), true, 'artefactos fiscales tienen RLS');
select is((select relrowsecurity from pg_class where oid='public.fiscal_print_jobs'::regclass), true, 'auditoria de impresion tiene RLS');

select * from finish();
rollback;
