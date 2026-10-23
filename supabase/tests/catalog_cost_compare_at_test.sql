-- CATÁLOGO · COSTO PRIVADO Y PRECIO REGULAR (20261021234000)
--
-- El dueño carga y lee su costo; el equipo y el público no lo leen. El precio
-- regular es público como el precio, nunca queda por debajo del precio de
-- venta y ni él ni el costo despublican. La planilla sigue rechazando lo que
-- rechazaba y la negativa de autorización sale con 42501.
--
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('cd000000-0000-4000-8000-0000000000a1','authenticated','authenticated','owner@costs.invalid','',now(),'{}','{}',now(),now()),
  ('cd000000-0000-4000-8000-0000000000a2','authenticated','authenticated','staff@costs.invalid','',now(),'{}','{}',now(),now());
insert into public.businesses(id,name,status,slug,is_active,operating_timezone,currency_code,hours_enforced,
  delivery_zone_enforced,rider_presence_required)
values ('cd000000-0000-4000-8000-0000000000b1','Costos','closed','costs-compare-at',true,'America/Argentina/Buenos_Aires','ARS',
  true,false,false);
insert into public.business_members(business_id,user_id,role,is_active)
values
  ('cd000000-0000-4000-8000-0000000000b1','cd000000-0000-4000-8000-0000000000a1','owner',true),
  ('cd000000-0000-4000-8000-0000000000b1','cd000000-0000-4000-8000-0000000000a2','staff',true);
insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
values
  ('cd000000-0000-4000-8000-0000000000c1','cd000000-0000-4000-8000-0000000000a1','cd000000-0000-4000-8000-0000000000b1',
    'owner','panel_web'),
  ('cd000000-0000-4000-8000-0000000000c2','cd000000-0000-4000-8000-0000000000a2','cd000000-0000-4000-8000-0000000000b1',
    'staff','panel_web');

-- La forma de los borradores comerciales (como commercial_publish_merchant_intent_test).
insert into public.products(id,business_id,name,category,price,price_status,is_active,brand,subcategory,presentation,capacity,
  packaging_type,stock,available,merchant_available,is_alcoholic,minimum_age,tags,is_verified,external_id,sku,variant,
  capacity_value,capacity_unit,catalog_origin,units_per_pack)
values
  ('cd000000-0000-4000-8000-0000000000d1','cd000000-0000-4000-8000-0000000000b1','Cola 1 L','Gaseosas',0,'pending',true,
    'Marca','Cola','Botella','1 l','botella',null,false,false,false,null,'{}',false,'cc-cola-1l','cc-cola-1l','Botella',1,'l',
    'commercial',1),
  ('cd000000-0000-4000-8000-0000000000d2','cd000000-0000-4000-8000-0000000000b1','Agua 1 L','Aguas',0,'pending',true,
    'Marca','Sin gas','Botella','1 l','botella',null,false,false,false,null,'{}',false,'cc-agua-1l','cc-agua-1l','Botella',1,'l',
    'commercial',1);

create function pg_temp.state(p_id uuid) returns text language sql stable as $$
  select format('available=%s merchant=%s verified=%s', available::text, merchant_available::text, is_verified::text)
    from public.products where id = p_id
$$;

-- ── 0 · Esquema y permisos ──────────────────────────────────────────────────
select has_column('public', 'products', 'compare_at_price', 'products tiene precio regular');
select col_type_is('public', 'products', 'compare_at_price', 'numeric(12,2)', 'el precio regular es numeric(12,2) como el precio');
select ok(has_column_privilege('anon', 'public.products', 'compare_at_price', 'SELECT'), 'anon lee el precio regular, como el precio');
select ok(has_column_privilege('authenticated', 'public.products', 'compare_at_price', 'SELECT'), 'authenticated lee el precio regular');
select ok(not has_column_privilege('anon', 'public.products', 'unit_cost', 'SELECT'), 'anon sigue sin leer unit_cost');
select ok(not has_column_privilege('authenticated', 'public.products', 'unit_cost', 'SELECT'), 'authenticated sigue sin leer unit_cost');
select ok(not has_function_privilege('anon', 'public.get_catalog_costs(uuid)', 'EXECUTE'), 'anon no ejecuta la lectura de costos');
select ok(has_function_privilege('authenticated', 'public.get_catalog_costs(uuid)', 'EXECUTE'), 'authenticated la ejecuta; la función exige el rol');
select ok(not has_column_privilege('authenticated', 'public.products', 'compare_at_price', 'UPDATE'), 'el navegador no escribe el precio regular directo');
select is(pg_get_function_result('public.apply_commercial_catalog_batch(uuid,jsonb)'::regprocedure),
  'TABLE(applied_sku text, applied_price numeric, applied_stock integer, applied_available boolean, applied_is_verified boolean, applied_republished boolean, applied_price_status text)',
  'la planilla conserva su retorno: los que ya la llaman no cambian');

set local role authenticated;
set local request.jwt.claims = '{"sub":"cd000000-0000-4000-8000-0000000000a1","role":"authenticated","session_id":"cd000000-0000-4000-8000-0000000000c1"}';

-- ── 1 · El dueño carga el costo y lo lee ────────────────────────────────────
select lives_ok($$select * from public.apply_commercial_catalog_batch('cd000000-0000-4000-8000-0000000000b1',
  '[{"sku":"cc-cola-1l","price":"1500","stock":"10","unit_cost":"1000","publish":true}]')$$,
  'precio, stock, costo y publicar en la misma fila');
select is((select c.unit_cost from public.get_catalog_costs('cd000000-0000-4000-8000-0000000000b1') c where c.sku = 'cc-cola-1l'),
  1000.00::numeric, 'el dueño lee el costo que cargó');
select is(pg_temp.state('cd000000-0000-4000-8000-0000000000d1'), 'available=true merchant=true verified=true',
  'y el producto quedó publicado como siempre');

-- ── 2 · Cambiar el costo no despublica ──────────────────────────────────────
select is((select applied_republished from public.apply_commercial_catalog_batch('cd000000-0000-4000-8000-0000000000b1',
  '[{"sku":"cc-cola-1l","unit_cost":"1100.50"}]')), false, 'una fila de sólo costo no necesita republicar');
select is(pg_temp.state('cd000000-0000-4000-8000-0000000000d1'), 'available=true merchant=true verified=true',
  'cambiar el costo no despublica ni desverifica');
select is((select c.unit_cost from public.get_catalog_costs('cd000000-0000-4000-8000-0000000000b1') c where c.sku = 'cc-cola-1l'),
  1100.50::numeric, 'el costo nuevo quedó guardado');

-- ── 3 · En blanco no decide; JSON null borra; cero vale ─────────────────────
select throws_ok($$select * from public.apply_commercial_catalog_batch('cd000000-0000-4000-8000-0000000000b1',
  '[{"sku":"cc-cola-1l","unit_cost":""}]')$$, 'P0001', 'Commercial row for sku cc-cola-1l does not decide anything.',
  'un costo en blanco no decide nada');
select lives_ok($$select * from public.apply_commercial_catalog_batch('cd000000-0000-4000-8000-0000000000b1',
  '[{"sku":"cc-cola-1l","unit_cost":null}]')$$, 'JSON null en el costo se acepta');
select is((select c.unit_cost from public.get_catalog_costs('cd000000-0000-4000-8000-0000000000b1') c where c.sku = 'cc-cola-1l'),
  null::numeric, 'y borra el costo');
select lives_ok($$select * from public.apply_commercial_catalog_batch('cd000000-0000-4000-8000-0000000000b1',
  '[{"sku":"cc-cola-1l","unit_cost":"0"}]')$$, 'un costo de cero se acepta');
select is((select c.unit_cost from public.get_catalog_costs('cd000000-0000-4000-8000-0000000000b1') c where c.sku = 'cc-cola-1l'),
  0.00::numeric, 'costo cero guardado como cero, no como vacío');

-- ── 4 · Costos inválidos ────────────────────────────────────────────────────
select throws_ok($$select * from public.apply_commercial_catalog_batch('cd000000-0000-4000-8000-0000000000b1',
  '[{"sku":"cc-cola-1l","unit_cost":"-5"}]')$$, '22023', 'Invalid unit_cost format for sku cc-cola-1l.',
  'un costo negativo se rechaza');
select throws_ok($$select * from public.apply_commercial_catalog_batch('cd000000-0000-4000-8000-0000000000b1',
  '[{"sku":"cc-cola-1l","unit_cost":"12.345"}]')$$, '22023', 'Invalid unit_cost format for sku cc-cola-1l.',
  'un costo con tres decimales se rechaza');
select throws_ok($$select * from public.apply_commercial_catalog_batch('cd000000-0000-4000-8000-0000000000b1',
  '[{"sku":"cc-cola-1l","unit_cost":true}]')$$, '22023', 'Invalid unit_cost format for sku cc-cola-1l.',
  'un costo que no es número ni texto se rechaza');

-- ── 5 · Precio regular ──────────────────────────────────────────────────────
select throws_ok($$select * from public.apply_commercial_catalog_batch('cd000000-0000-4000-8000-0000000000b1',
  '[{"sku":"cc-cola-1l","compare_at_price":"1500"}]')$$, '22023', 'compare_at_price for sku cc-cola-1l must be greater than the price.',
  'un precio regular igual al de venta no es una promo');
select throws_ok($$select * from public.apply_commercial_catalog_batch('cd000000-0000-4000-8000-0000000000b1',
  '[{"sku":"cc-cola-1l","compare_at_price":"0"}]')$$, '22023', 'Invalid compare_at_price value for sku cc-cola-1l.',
  'un precio regular de cero se rechaza');
select lives_ok($$select * from public.apply_commercial_catalog_batch('cd000000-0000-4000-8000-0000000000b1',
  '[{"sku":"cc-cola-1l","compare_at_price":"1800"}]')$$, 'antes 1800, ahora 1500');
select is(pg_temp.state('cd000000-0000-4000-8000-0000000000d1'), 'available=true merchant=true verified=true',
  'poner una promo no despublica');
select is((select c.compare_at_price from public.get_catalog_costs('cd000000-0000-4000-8000-0000000000b1') c where c.sku = 'cc-cola-1l'),
  1800.00::numeric, 'el precio regular quedó guardado');
select throws_ok($$select * from public.apply_commercial_catalog_batch('cd000000-0000-4000-8000-0000000000b1',
  '[{"sku":"cc-cola-1l","price":"1900"}]')$$, '22023', 'compare_at_price for sku cc-cola-1l must be greater than the price.',
  'subir el precio por encima del regular guardado se rechaza con mensaje propio, no con el CHECK');
select is((select p.price from public.products p where p.id = 'cd000000-0000-4000-8000-0000000000d1'), 1500.00::numeric,
  'el lote rechazado no cambió el precio');
select lives_ok($$select * from public.apply_commercial_catalog_batch('cd000000-0000-4000-8000-0000000000b1',
  '[{"sku":"cc-cola-1l","price":"1900","compare_at_price":null}]')$$, 'terminar la promo y subir el precio en la misma fila');
select is((select c.compare_at_price from public.get_catalog_costs('cd000000-0000-4000-8000-0000000000b1') c where c.sku = 'cc-cola-1l'),
  null::numeric, 'JSON null termina la promo');
select is(pg_temp.state('cd000000-0000-4000-8000-0000000000d1'), 'available=true merchant=true verified=true',
  'el cambio de precio se republica como siempre');

-- ── 6 · Lo que la planilla rechazaba lo sigue rechazando ────────────────────
select throws_ok($$select * from public.apply_commercial_catalog_batch('cd000000-0000-4000-8000-0000000000b1',
  '[{"sku":"cc-cola-1l","price":"0"}]')$$, 'P0001', 'Invalid price value for sku cc-cola-1l: must be greater than zero.',
  'precio cero');
select throws_ok($$select * from public.apply_commercial_catalog_batch('cd000000-0000-4000-8000-0000000000b1',
  '[{"sku":"cc-cola-1l","price":"12.345"}]')$$, 'P0001', 'Invalid price format for sku cc-cola-1l.',
  'precio con tres decimales');
select throws_ok($$select * from public.apply_commercial_catalog_batch('cd000000-0000-4000-8000-0000000000b1',
  '[{"sku":"cc-cola-1l","price":"1.234,50"}]')$$, 'P0001', 'Invalid price format for sku cc-cola-1l.',
  'el servidor no interpreta separadores: eso lo resuelve el Panel antes de mandar');
select throws_ok($$select * from public.apply_commercial_catalog_batch('cd000000-0000-4000-8000-0000000000b1',
  '[{"sku":"no-existe-1l","unit_cost":"10"}]')$$, 'P0001', 'Unknown sku no-existe-1l for this business. Commercial import never creates products.',
  'un SKU desconocido sigue sin crear productos, aunque traiga costo');
select throws_ok($$select * from public.apply_commercial_catalog_batch('cd000000-0000-4000-8000-0000000000b1',
  '[{"sku":"cc-agua-1l","price":"900","publish":true}]')$$, 'P0001', 'Refusing to publish sku cc-agua-1l without stock.',
  'la compuerta de stock para publicar sigue en pie');

-- ── 7 · El equipo y el público no leen costos ───────────────────────────────
set local request.jwt.claims = '{"sub":"cd000000-0000-4000-8000-0000000000a2","role":"authenticated","session_id":"cd000000-0000-4000-8000-0000000000c2"}';
select throws_ok($$select * from public.get_catalog_costs('cd000000-0000-4000-8000-0000000000b1')$$,
  '42501', 'Only an active owner/admin can read catalog costs.', 'el equipo no lee costos');
select throws_ok($$select * from public.apply_commercial_catalog_batch('cd000000-0000-4000-8000-0000000000b1',
  '[{"sku":"cc-cola-1l","unit_cost":"1"}]')$$, '42501', 'Only an active owner/admin can apply commercial catalog values.',
  'el equipo no cambia precios ni costos, y la negativa es 42501');
select throws_ok($$select unit_cost from public.products where id = 'cd000000-0000-4000-8000-0000000000d1'$$,
  '42501', null, 'el equipo tampoco lee unit_cost de la tabla');
reset role;

set local role anon;
select throws_ok($$select * from public.get_catalog_costs('cd000000-0000-4000-8000-0000000000b1')$$,
  '42501', null, 'anon no puede ejecutar la lectura de costos');
select lives_ok($$select compare_at_price from public.products where id = 'cd000000-0000-4000-8000-0000000000d1'$$,
  'anon puede pedir el precio regular, como el precio');
select throws_ok($$select unit_cost from public.products where id = 'cd000000-0000-4000-8000-0000000000d1'$$,
  '42501', null, 'anon no lee unit_cost');
reset role;

-- ── 8 · La base sostiene la regla aunque alguien escriba directo ────────────
select throws_ok($$update public.products set compare_at_price = price where id = 'cd000000-0000-4000-8000-0000000000d1'$$,
  '23514', null, 'el CHECK rechaza un precio regular que no supera al de venta');
select ok(position('unit_cost' in pg_get_functiondef('public.fail_close_verified_product_master_change()'::regprocedure)) = 0
  and position('compare_at_price' in pg_get_functiondef('public.fail_close_verified_product_master_change()'::regprocedure)) = 0,
  'costo y precio regular no son datos maestros: no están en el disparador que despublica');

select * from finish();
rollback;
