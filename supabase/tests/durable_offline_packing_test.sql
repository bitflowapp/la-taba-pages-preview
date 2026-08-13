begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

select has_function('public','get_packing_manifest',array['uuid'],'manifiesto de packing recuperable existe');
select has_function('public','revert_packing_scan',array['uuid','text','text'],'reversion de scan idempotente existe');
select has_function('public','confirm_packing_session_once',array['uuid','text','text'],'confirmacion de packing idempotente existe');
select ok(has_function_privilege('authenticated','public.get_packing_manifest(uuid)'::regprocedure,'execute'),'staff autenticado puede leer manifiesto mediante RPC');
select ok(not has_function_privilege('anon','public.get_packing_manifest(uuid)'::regprocedure,'execute'),'anon no puede leer manifiestos');

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('61000000-0000-4000-8000-000000000001','authenticated','authenticated','packing-staff@example.invalid','',now(),'{}','{}',now(),now()),
  ('61000000-0000-4000-8000-000000000002','authenticated','authenticated','packing-outsider@example.invalid','',now(),'{}','{}',now(),now());
insert into public.businesses(id,name,status,slug,is_active)
values
  ('62000000-0000-4000-8000-000000000001','TABA packing fixture','open','taba-packing-fixture',true),
  ('62000000-0000-4000-8000-000000000002','TABA packing outsider','open','taba-packing-outsider',true);
insert into public.business_members(business_id,user_id,role,is_active)
values
  ('62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','staff',true),
  ('62000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000002','staff',true);

-- Fixture sintético: no representa aprobación ni datos comerciales reales.
alter table public.products drop constraint products_verified_publication_authority;
insert into public.products(id,business_id,name,description,category,price,image_url,is_active,brand,subcategory,presentation,capacity,packaging_type,stock,available,is_alcoholic,tags,is_verified,verified_at,verified_by,external_id,variant,capacity_value,capacity_unit,catalog_origin,units_per_pack)
values('63000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','Producto packing sintético','Fixture aislado','Aguas',100,'https://example.invalid/packing.webp',true,'Marca sintética','Pruebas','Unidad','1 u','unidad',10,true,false,'{}',true,now(),'61000000-0000-4000-8000-000000000001','packing-fixture','Unidad',1,'unidad','test_only',1);
insert into public.product_barcodes(id,business_id,product_id,gtin,barcode_type,package_type,unit_factor,is_primary,source,verified_at,created_by)
values
  ('64000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000001','4006381333931','EAN-13','unit',1,true,'manual',now(),'61000000-0000-4000-8000-000000000001'),
  ('64000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000001','5901234123457','EAN-13','unit',1,false,'manual',now(),'61000000-0000-4000-8000-000000000001');
-- payment_method es NOT NULL desde 20260806170000, con CHECK a un vocabulario
-- fijo; 'cash' es el valor real para un retiro pagado en el mostrador y no
-- activa la restriccion de origin='qa' que exige 'qa_no_charge'.
insert into public.orders(id,business_id,code,public_code,status,fulfillment_type,delivery_mode,client_request_id,customer_name,payment_method,subtotal,delivery_fee,total)
values('65000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','PACKING-FIXTURE-1','PACKING-FIXTURE-1','accepted','pickup','pickup','packing-fixture-request-1','CLIENTE_SINTETICO_NO_CACHEAR','cash',100,0,100);
insert into public.order_items(id,order_id,product_id,product_uuid,name,quantity,unit,unit_price,subtotal)
values('66000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000001','packing-product','63000000-0000-4000-8000-000000000001','Producto packing sintético',1,'unidad',100,100);

-- El producto del fixture siempre representó una unidad discreta no alcoholica: presentacion
-- 'Unidad', packaging_type 'unidad', un item por pack y la linea del pedido en 'unidad'. La
-- capacidad estructurada y la categoria usan el vocabulario que acepta el esquema del catalogo,
-- que para un producto verificado exige categoria real coherente con el alcohol.
select is(
  (select capacity_unit || '/' || units_per_pack::text || '/' || packaging_type
     from public.products where id='63000000-0000-4000-8000-000000000001'),
  'unidad/1/unidad',
  'el fixture declara una unidad discreta con el vocabulario que el catalogo acepta'
);
select ok(
  (select is_verified and not is_alcoholic and minimum_age is null and category = 'Aguas'
     from public.products where id='63000000-0000-4000-8000-000000000001'),
  'el fixture verificado declara una categoria real y coherente con el alcohol'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"61000000-0000-4000-8000-000000000001","role":"authenticated"}';

select lives_ok(
  $$select public.start_packing_session('65000000-0000-4000-8000-000000000001',1,'packing:fixture:revision:1')$$,
  'staff inicia sesion serializada'
);
select is(
  (select public.get_packing_manifest(id)->>'schema_version' from public.order_packing_sessions where order_id='65000000-0000-4000-8000-000000000001'),
  '1','manifiesto tiene version'
);
select is(
  (select public.get_packing_manifest(id)#>>'{items,0,barcodes,0,gtin}' from public.order_packing_sessions where order_id='65000000-0000-4000-8000-000000000001'),
  '4006381333931','manifiesto contiene barcode autorizado'
);
select unalike(
  (select public.get_packing_manifest(id)::text from public.order_packing_sessions where order_id='65000000-0000-4000-8000-000000000001'),
  '%CLIENTE_SINTETICO_NO_CACHEAR%','manifiesto no expone datos del cliente'
);
select lives_ok(
  format($sql$select public.record_packing_scan(%L::uuid,'4006381333931','packing-scan:fixture:1')$sql$,(select id from public.order_packing_sessions where order_id='65000000-0000-4000-8000-000000000001')),
  'scan se registra'
);
select is((select count(*)::integer from public.order_packing_scans where scan_key='packing-scan:fixture:1'),1,'scan existe una vez');
select lives_ok(
  format($sql$select public.record_packing_scan(%L::uuid,'4006381333931','packing-scan:fixture:1')$sql$,(select id from public.order_packing_sessions where order_id='65000000-0000-4000-8000-000000000001')),
  'replay del scan es idempotente'
);
select is((select count(*)::integer from public.order_packing_scans where scan_key='packing-scan:fixture:1'),1,'replay no duplica scan');
select throws_ok(
  format($sql$select public.record_packing_scan(%L::uuid,'5901234123457','packing-scan:fixture:1')$sql$,(select id from public.order_packing_sessions where order_id='65000000-0000-4000-8000-000000000001')),
  '23505','scan_key reutilizada con otro codigo','misma clave con otro GTIN se bloquea'
);
select is(
  (select public.get_packing_manifest(id)#>>'{scans,0,scan_key}' from public.order_packing_sessions where order_id='65000000-0000-4000-8000-000000000001'),
  'packing-scan:fixture:1','manifiesto permite reconciliar por scan_key'
);
select lives_ok(
  format($sql$select public.revert_packing_scan(%L::uuid,'packing-scan:fixture:1','packing-revert:fixture:1')$sql$,(select id from public.order_packing_sessions where order_id='65000000-0000-4000-8000-000000000001')),
  'reversion apunta a un scan exacto'
);
select ok((select reverted_at is not null from public.order_packing_scans where scan_key='packing-scan:fixture:1'),'scan queda revertido');
select lives_ok(
  format($sql$select public.revert_packing_scan(%L::uuid,'packing-scan:fixture:1','packing-revert:fixture:1')$sql$,(select id from public.order_packing_sessions where order_id='65000000-0000-4000-8000-000000000001')),
  'replay de reversion es idempotente'
);
select is((select count(*)::integer from public.business_command_receipts where idempotency_key='packing-revert:fixture:1'),1,'reversion conserva un recibo');
select throws_ok(
  format($sql$select public.confirm_packing_session_once(%L::uuid,null,'packing-confirm:fixture:incomplete')$sql$,(select id from public.order_packing_sessions where order_id='65000000-0000-4000-8000-000000000001')),
  '42501','faltantes requieren excepcion owner/admin con motivo','staff no confirma packing incompleto'
);
select lives_ok(
  format($sql$select public.record_packing_scan(%L::uuid,'4006381333931','packing-scan:fixture:2')$sql$,(select id from public.order_packing_sessions where order_id='65000000-0000-4000-8000-000000000001')),
  'nuevo scan completa el pedido'
);
select lives_ok(
  format($sql$select public.confirm_packing_session_once(%L::uuid,null,'packing-confirm:fixture:complete')$sql$,(select id from public.order_packing_sessions where order_id='65000000-0000-4000-8000-000000000001')),
  'packing completo se confirma'
);
select lives_ok(
  format($sql$select public.confirm_packing_session_once(%L::uuid,null,'packing-confirm:fixture:complete')$sql$,(select id from public.order_packing_sessions where order_id='65000000-0000-4000-8000-000000000001')),
  'replay de confirmacion es idempotente'
);
select is((select status from public.order_packing_sessions where order_id='65000000-0000-4000-8000-000000000001'),'confirmed','sesion queda confirmada');
select is((select count(*)::integer from public.business_command_receipts where idempotency_key='packing-confirm:fixture:complete'),1,'confirmacion conserva un recibo');

-- El id de la sesion se resuelve mientras la ve su propio operador. Buscarlo ya como forastero
-- lo devolveria en null por RLS, y la RPC responderia 'sesion inexistente' sin llegar a ejercer
-- el guard de autorizacion que esta prueba quiere demostrar.
create temporary table packing_fixture_session on commit drop as
select id from public.order_packing_sessions where order_id='65000000-0000-4000-8000-000000000001';

set local request.jwt.claims = '{"sub":"61000000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(
  format($sql$select public.get_packing_manifest(%L::uuid)$sql$,(select id from packing_fixture_session)),
  '42501','operador no autorizado','otro negocio no obtiene el manifiesto'
);

select * from finish();
rollback;
