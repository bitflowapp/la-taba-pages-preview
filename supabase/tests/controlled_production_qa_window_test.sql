-- CONTROLLED_PRODUCTION · QUÉ VE EL PÚBLICO DEL CATÁLOGO Y LA VENTANA QA
--
-- Positivo y negativo sobre los roles REALES (anon, authenticated):
--   - anon ve el producto publicado de un negocio real abierto;
--   - anon NO ve borradores, productos ocultos, productos de un negocio
--     cerrado ni los de un tenant QA fuera de su ventana;
--   - dentro de la ventana el tenant QA se ve; al vencer deja de verse aunque
--     siga `open`, y el barrido lo cierra;
--   - nadie lee unit_cost ni verified_by por la API;
--   - la marca QA y la ventana no se cambian con un UPDATE directo y sólo un
--     owner abre/cierra la ventana, sólo en un tenant QA y por 1–60 minutos.
--
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

-- ── Fixture ────────────────────────────────────────────────────────────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('c9000000-0000-4000-8000-0000000000a1','authenticated','authenticated','qa-owner@example.invalid','',now(),'{}','{}',now(),now()),
  ('c9000000-0000-4000-8000-0000000000a2','authenticated','authenticated','real-owner@example.invalid','',now(),'{}','{}',now(),now());

-- R: negocio real abierto y verificado. Q: tenant QA con la misma
-- configuración. C: negocio real cerrado.
insert into public.businesses(id,name,status,slug,is_active,operating_timezone,ordering_enabled,ordering_verified,
  ordering_verified_at,ordering_verified_by,currency_code,pickup_enabled,qa_fixture)
values
  ('c9000000-0000-4000-8000-0000000000b1','Real abierto','open','cp-real-abierto',true,'America/Argentina/Buenos_Aires',true,true,
    now(),'c9000000-0000-4000-8000-0000000000a2','ARS',true,false),
  ('c9000000-0000-4000-8000-0000000000b2','QA control','open','cp-qa-control',true,'America/Argentina/Buenos_Aires',true,true,
    now(),'c9000000-0000-4000-8000-0000000000a1','ARS',true,true),
  ('c9000000-0000-4000-8000-0000000000b3','Real cerrado','closed','cp-real-cerrado',true,'America/Argentina/Buenos_Aires',true,true,
    now(),'c9000000-0000-4000-8000-0000000000a2','ARS',true,false);

insert into public.business_members(business_id,user_id,role,is_active)
values
  ('c9000000-0000-4000-8000-0000000000b2','c9000000-0000-4000-8000-0000000000a1','owner',true),
  ('c9000000-0000-4000-8000-0000000000b1','c9000000-0000-4000-8000-0000000000a2','owner',true);
insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
values
  ('c9000000-0000-4000-8000-0000000000c1','c9000000-0000-4000-8000-0000000000a1','c9000000-0000-4000-8000-0000000000b2','owner','panel_web'),
  ('c9000000-0000-4000-8000-0000000000c2','c9000000-0000-4000-8000-0000000000a2','c9000000-0000-4000-8000-0000000000b1','owner','panel_web');

-- Aísla la visibilidad del vínculo de imagen comercial dentro de la transacción
-- (mismo criterio que business_windows_scanner_fiscal_test); el resto de las
-- reglas maestras de producto sigue activo.
alter table public.products drop constraint products_verified_publication_authority;
insert into public.products(id,business_id,name,category,price,image_url,is_active,brand,subcategory,presentation,capacity,
  packaging_type,stock,available,is_alcoholic,tags,is_verified,verified_at,verified_by,external_id,variant,capacity_value,
  capacity_unit,catalog_origin,units_per_pack,unit_cost)
values
  -- publicado en el negocio real abierto: el único visible
  ('c9000000-0000-4000-8000-0000000000d1','c9000000-0000-4000-8000-0000000000b1','Publicado','Gaseosas',100,'assets/p.webp',true,
    'Marca','Cola','Botella','1 l','botella',10,true,false,'{}',true,now(),'c9000000-0000-4000-8000-0000000000a2','cp-pub','Botella',1,'l','test_only',1,55),
  -- borrador: sin verificar ni disponible
  ('c9000000-0000-4000-8000-0000000000d2','c9000000-0000-4000-8000-0000000000b1','Borrador','Gaseosas',100,'assets/p.webp',true,
    'Marca','Cola','Botella','1 l','botella',10,false,false,'{}',false,null,null,'cp-draft','Botella',1,'l','test_only',1,null),
  -- oculto: verificado pero no disponible
  ('c9000000-0000-4000-8000-0000000000d3','c9000000-0000-4000-8000-0000000000b1','Oculto','Gaseosas',100,'assets/p.webp',true,
    'Marca','Cola','Botella','1 l','botella',10,false,false,'{}',true,now(),'c9000000-0000-4000-8000-0000000000a2','cp-hidden','Botella',1,'l','test_only',1,null),
  -- publicado en el tenant QA
  ('c9000000-0000-4000-8000-0000000000d4','c9000000-0000-4000-8000-0000000000b2','QA publicado','Gaseosas',100,'assets/p.webp',true,
    'Marca','Cola','Botella','1 l','botella',10,true,false,'{}',true,now(),'c9000000-0000-4000-8000-0000000000a1','cp-qa','Botella',1,'l','test_only',1,null),
  -- publicado en un negocio real cerrado
  ('c9000000-0000-4000-8000-0000000000d5','c9000000-0000-4000-8000-0000000000b3','Cerrado','Gaseosas',100,'assets/p.webp',true,
    'Marca','Cola','Botella','1 l','botella',10,true,false,'{}',true,now(),'c9000000-0000-4000-8000-0000000000a2','cp-closed','Botella',1,'l','test_only',1,null);

create temporary table anon_view(label text, ids uuid[]) on commit drop;
grant insert, select on anon_view to anon;

-- ── 1 · Columnas privadas ──────────────────────────────────────────────────
select ok(not has_column_privilege('anon', 'public.products', 'unit_cost', 'SELECT'), 'anon no lee unit_cost');
select ok(not has_column_privilege('authenticated', 'public.products', 'unit_cost', 'SELECT'), 'authenticated no lee unit_cost');
select ok(not has_column_privilege('anon', 'public.products', 'verified_by', 'SELECT'), 'anon no lee verified_by');
select ok(not has_column_privilege('authenticated', 'public.products', 'verified_by', 'SELECT'), 'authenticated no lee verified_by');
select ok(has_column_privilege('anon', 'public.products', 'price', 'SELECT')
  and has_column_privilege('anon', 'public.products', 'stock', 'SELECT')
  and has_column_privilege('anon', 'public.products', 'name', 'SELECT')
  and has_column_privilege('anon', 'public.products', 'image_url', 'SELECT'), 'anon sí lee precio, stock, nombre e imagen');

-- ── 2 · Qué ve anon: sin ventana QA ────────────────────────────────────────
set local role anon;
insert into anon_view select 'sin ventana', array_agg(id order by id) from public.products
 where id::text like 'c9000000-%';
select throws_ok($$select unit_cost from public.products limit 1$$, '42501', null, 'anon: pedir unit_cost es permiso denegado');
select lives_ok($$select id, name, price, stock from public.products limit 1$$, 'anon: las columnas públicas se leen');
reset role;

select is((select ids from anon_view where label = 'sin ventana'), array['c9000000-0000-4000-8000-0000000000d1'::uuid],
  'anon ve sólo el publicado del negocio real abierto (no borrador, no oculto, no cerrado, no QA sin ventana)');

-- ── 3 · Ventana QA vigente y vencida ───────────────────────────────────────
update public.businesses set qa_window_until = now() + interval '10 minutes' where id = 'c9000000-0000-4000-8000-0000000000b2';
set local role anon;
insert into anon_view select 'ventana vigente', array_agg(id order by id) from public.products
 where id::text like 'c9000000-%';
reset role;
select is((select ids from anon_view where label = 'ventana vigente'),
  array['c9000000-0000-4000-8000-0000000000d1'::uuid, 'c9000000-0000-4000-8000-0000000000d4'::uuid],
  'dentro de su ventana el tenant QA se ve');

update public.businesses set qa_window_until = now() - interval '1 second' where id = 'c9000000-0000-4000-8000-0000000000b2';
set local role anon;
insert into anon_view select 'ventana vencida', array_agg(id order by id) from public.products
 where id::text like 'c9000000-%';
reset role;
select is((select ids from anon_view where label = 'ventana vencida'), array['c9000000-0000-4000-8000-0000000000d1'::uuid],
  'ventana vencida: el tenant QA deja de verse aunque siga open (sin esperar al cron)');

select is(public.close_expired_qa_windows(), 1, 'el barrido cierra el tenant QA vencido');
select is((select status from public.businesses where id = 'c9000000-0000-4000-8000-0000000000b2'), 'closed', 'tenant QA cerrado');
select is((select status from public.businesses where id = 'c9000000-0000-4000-8000-0000000000b1'), 'open', 'el barrido no toca el negocio real');
select is(public.close_expired_qa_windows(), 0, 'barrido idempotente');

-- Un tenant QA abierto por fuera de la ventana (set_business_open_state, o un
-- runner muerto) también lo cierra el barrido.
update public.businesses set status = 'open', qa_window_until = null where id = 'c9000000-0000-4000-8000-0000000000b2';
select is(public.close_expired_qa_windows(), 1, 'tenant QA abierto sin ventana: el barrido lo cierra');

select is((select count(*)::integer from cron.job where jobname = 'taba-qa-window-expiry' and schedule = '* * * * *'), 1,
  'el barrido corre cada minuto');

-- ── 4 · Abrir y cerrar la ventana ──────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"c9000000-0000-4000-8000-0000000000a1","role":"authenticated","session_id":"c9000000-0000-4000-8000-0000000000c1"}';
select throws_ok($$select public.open_qa_window('c9000000-0000-4000-8000-0000000000b2', 61)$$, '22023', null,
  'la ventana no pasa de 60 minutos');
select throws_ok($$select public.open_qa_window('c9000000-0000-4000-8000-0000000000b2', 0)$$, '22023', null,
  'la ventana dura al menos 1 minuto');
select is((public.open_qa_window('c9000000-0000-4000-8000-0000000000b2', 30)) ->> 'status', 'open', 'el owner QA abre su ventana');
select ok((select qa_window_until > now() + interval '29 minutes' and qa_window_until <= now() + interval '31 minutes'
  from public.businesses where id = 'c9000000-0000-4000-8000-0000000000b2'), 'la ventana vence a los 30 minutos');
select throws_ok($$update public.businesses set qa_fixture = false where id = 'c9000000-0000-4000-8000-0000000000b2'$$, '42501', null,
  'el owner QA no puede desmarcar su tenant');
select throws_ok($$update public.businesses set qa_window_until = now() + interval '1 day' where id = 'c9000000-0000-4000-8000-0000000000b2'$$, '42501', null,
  'el owner QA no puede estirar su ventana');
select is((public.close_qa_window('c9000000-0000-4000-8000-0000000000b2')) ->> 'status', 'closed', 'el owner QA cierra su ventana');
select is((select qa_window_until from public.businesses where id = 'c9000000-0000-4000-8000-0000000000b2'), null, 'sin ventana al cerrar');
select throws_ok($$select public.open_qa_window('c9000000-0000-4000-8000-0000000000b1', 30)$$, '42501', null,
  'un owner ajeno no abre ventana en otro negocio');

-- El owner del negocio real: su negocio no es QA.
set local request.jwt.claims = '{"sub":"c9000000-0000-4000-8000-0000000000a2","role":"authenticated","session_id":"c9000000-0000-4000-8000-0000000000c2"}';
select throws_ok($$select public.open_qa_window('c9000000-0000-4000-8000-0000000000b1', 30)$$, '42501', null,
  'un negocio real no abre ventana QA');
select throws_ok($$select public.close_qa_window('c9000000-0000-4000-8000-0000000000b1')$$, '42501', null,
  'un negocio real no se cierra por close_qa_window');
select throws_ok($$update public.businesses set qa_fixture = true where id = 'c9000000-0000-4000-8000-0000000000b1'$$, '42501', null,
  'el owner real no puede esconder su catálogo marcándolo QA');
reset role;

-- ── 5 · Superficie de ejecución ────────────────────────────────────────────
select ok(not has_function_privilege('anon', 'public.open_qa_window(uuid,integer)', 'EXECUTE'), 'anon no abre ventanas QA');
select ok(not has_function_privilege('anon', 'public.close_qa_window(uuid)', 'EXECUTE'), 'anon no cierra ventanas QA');
select ok(not has_function_privilege('authenticated', 'public.close_expired_qa_windows()', 'EXECUTE'), 'el barrido no es una API');
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('open_qa_window', 'close_qa_window', 'close_expired_qa_windows')
    and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')), 3,
  'las tres funciones SECURITY DEFINER fijan search_path');

select * from finish();
rollback;
