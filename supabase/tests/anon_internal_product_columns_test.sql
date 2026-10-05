-- PRODUCTOS · LAS COLUMNAS INTERNAS NO SON PÚBLICAS
--
-- Control negativo sobre los roles REALES: con un `unit_cost` SINTÉTICO NO NULO en un
-- producto publicado, ni `anon` ni `authenticated` pueden leerlo ni verlo aparecer,
-- y la vidriera pública sigue funcionando. `service_role` y el dueño de la tabla
-- conservan el acceso (backend interno, auditoría e importación).
--
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- ── Fixture (mismo esquema que controlled_production_qa_window_test) ──────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('c9100000-0000-4000-8000-0000000000a1','authenticated','authenticated','owner-cols@example.invalid','',now(),'{}','{}',now(),now());

insert into public.businesses(id,name,status,slug,is_active,operating_timezone,ordering_enabled,ordering_verified,
  ordering_verified_at,ordering_verified_by,currency_code,pickup_enabled,qa_fixture)
values
  ('c9100000-0000-4000-8000-0000000000b1','Real abierto cols','open','cp-cols-abierto',true,'America/Argentina/Buenos_Aires',true,true,
    now(),'c9100000-0000-4000-8000-0000000000a1','ARS',true,false);

insert into public.business_members(business_id,user_id,role,is_active)
values ('c9100000-0000-4000-8000-0000000000b1','c9100000-0000-4000-8000-0000000000a1','owner',true);
insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
values ('c9100000-0000-4000-8000-0000000000c1','c9100000-0000-4000-8000-0000000000a1','c9100000-0000-4000-8000-0000000000b1','owner','panel_web');

alter table public.products drop constraint products_verified_publication_authority;
insert into public.products(id,business_id,name,category,price,image_url,is_active,brand,subcategory,presentation,capacity,
  packaging_type,stock,available,is_alcoholic,tags,is_verified,verified_at,verified_by,external_id,variant,capacity_value,
  capacity_unit,catalog_origin,units_per_pack,unit_cost)
values
  -- publicado, con un costo SINTÉTICO no nulo: el valor que no debe filtrarse
  ('c9100000-0000-4000-8000-0000000000d1','c9100000-0000-4000-8000-0000000000b1','Publicado con costo','Gaseosas',100,'assets/p.webp',true,
    'Marca','Cola','Botella','1 l','botella',10,true,false,'{}',true,now(),'c9100000-0000-4000-8000-0000000000a1','cp-cols-pub','Botella',1,'l','test_only',1,55.5);

-- ── 1 · Los permisos, por columna ────────────────────────────────────────────
select ok(not has_column_privilege('anon', 'public.products', 'unit_cost', 'SELECT'), 'anon no lee unit_cost');
select ok(not has_column_privilege('authenticated', 'public.products', 'unit_cost', 'SELECT'), 'authenticated no lee unit_cost');
select ok(not has_column_privilege('anon', 'public.products', 'verified_by', 'SELECT'), 'anon no lee verified_by');
select ok(not has_column_privilege('authenticated', 'public.products', 'verified_by', 'SELECT'), 'authenticated no lee verified_by');
select ok(has_column_privilege('anon', 'public.products', 'price', 'SELECT')
  and has_column_privilege('anon', 'public.products', 'stock', 'SELECT')
  and has_column_privilege('anon', 'public.products', 'name', 'SELECT')
  and has_column_privilege('anon', 'public.products', 'image_url', 'SELECT')
  and has_column_privilege('anon', 'public.products', 'is_verified', 'SELECT'),
  'anon sí lee lo necesario para comprar: precio, stock, nombre, imagen y si está verificado');

-- ── 2 · Con el costo sintético puesto, el público no lo ve ───────────────────
create temporary table anon_row(doc jsonb) on commit drop;
grant insert, select on anon_row to anon;
set local role anon;
select throws_ok($$select unit_cost from public.products where id = 'c9100000-0000-4000-8000-0000000000d1'$$,
  '42501', null, 'anon: pedir unit_cost es permiso denegado');
select throws_ok($$select verified_by from public.products where id = 'c9100000-0000-4000-8000-0000000000d1'$$,
  '42501', null, 'anon: pedir verified_by es permiso denegado');
select throws_ok($$select * from public.products where id = 'c9100000-0000-4000-8000-0000000000d1'$$,
  '42501', null, 'anon: select * (lo que hace select=* de la API) es permiso denegado');
select throws_ok($$select count(*) from public.products where unit_cost is not null$$,
  '42501', null, 'anon: ni siquiera filtrando por unit_cost puede averiguar si hay costos cargados');
select throws_ok($$select to_jsonb(p) from public.products p limit 1$$,
  '42501', null, 'anon: la fila entera como JSON también es permiso denegado');
insert into anon_row
  select to_jsonb(t) from (select id, name, price, stock, is_verified from public.products
   where id = 'c9100000-0000-4000-8000-0000000000d1') t;
reset role;

select is((select count(*)::int from anon_row), 1, 'anon ve la fila publicada por sus columnas públicas');
select ok(not ((select doc from anon_row) ? 'unit_cost') and not ((select doc from anon_row) ? 'verified_by')
  and (select (doc->>'price')::numeric from anon_row) = 100, 'lo que recibe anon no trae ni unit_cost ni verified_by, y trae el precio');

set local role authenticated;
select throws_ok($$select unit_cost from public.products where id = 'c9100000-0000-4000-8000-0000000000d1'$$,
  '42501', null, 'authenticated: pedir unit_cost es permiso denegado');
select throws_ok($$select verified_by from public.products where id = 'c9100000-0000-4000-8000-0000000000d1'$$,
  '42501', null, 'authenticated: pedir verified_by es permiso denegado');
reset role;

-- ── 3 · Lo interno sigue funcionando ─────────────────────────────────────────
select ok(has_column_privilege('service_role', 'public.products', 'unit_cost', 'SELECT')
  and has_column_privilege('service_role', 'public.products', 'verified_by', 'SELECT'),
  'service_role conserva la lectura de las columnas internas (backend, auditoría, importación)');
select is((select unit_cost from public.products where id = 'c9100000-0000-4000-8000-0000000000d1'), 55.5::numeric,
  'el costo sigue guardado: el dueño de la tabla lo lee intacto');

select * from finish();
rollback;
