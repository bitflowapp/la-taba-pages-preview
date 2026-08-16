-- TABA2 · PRODUCCION · MENOR PRIVILEGIO ANTES DE EJECUTAR
--
-- Certifica los contratos que cierran la remediacion forward-only de
-- produccion (migrations 101-103). Cada bloque esta escrito para FALLAR contra
-- la migration 100 y pasar contra la 103: son control negativo, no decoracion.
--
-- Los privilegios se preguntan con has_function_privilege / has_table_privilege
-- sobre los roles REALES (anon, authenticated, service_role), no desde postgres,
-- que responderia que si a todo.
--
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(44);

-- ══════════════════════════════════════════════════════════════════════════
--  1 · SUPERFICIE QA (migration 101)
-- ══════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'import_qa_fixture_catalog'),
  0, 'import_qa_fixture_catalog no existe en produccion');

select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'publish_qa_fixture_product'),
  0, 'publish_qa_fixture_product no existe en produccion');

-- Ninguna RPC puede quedar con «STAGING ONLY» en el comentario y seguir viva.
select is(
  (select count(*)::integer from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and coalesce(obj_description(p.oid, 'pg_proc'), '') like '%STAGING ONLY%'),
  0, 'no queda ninguna funcion marcada STAGING ONLY en public');

-- La red de seguridad del rider NO se borro junto con la superficie QA.
select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'product_is_qa_fixture'),
  1, 'product_is_qa_fixture sigue viva: aisla pedidos QA del reparto real');

select ok(
  has_function_privilege('authenticated', 'public.product_is_qa_fixture(uuid)', 'EXECUTE'),
  'product_is_qa_fixture sigue ejecutable por authenticated');

-- ══════════════════════════════════════════════════════════════════════════
--  2 · UNAPPROVED_QA: ningun rol de cliente puede introducirlo
-- ══════════════════════════════════════════════════════════════════════════
-- Sin las dos RPC, la unica via seria escribir la tabla directo. No se puede.

select ok(
  not has_table_privilege('anon', 'public.catalog_assets', 'INSERT')
  and not has_table_privilege('anon', 'public.catalog_assets', 'UPDATE'),
  'anon no puede escribir catalog_assets');

select ok(
  not has_table_privilege('authenticated', 'public.catalog_assets', 'INSERT')
  and not has_table_privilege('authenticated', 'public.catalog_assets', 'UPDATE'),
  'authenticated no puede escribir catalog_assets');

select ok(
  not has_table_privilege('anon', 'public.products', 'INSERT')
  and not has_table_privilege('anon', 'public.products', 'UPDATE'),
  'anon no puede escribir products');

select ok(
  not has_table_privilege('authenticated', 'public.products', 'INSERT'),
  'authenticated no puede insertar products');

-- El UPDATE de authenticated sobre products es por columna, y catalog_origin /
-- is_verified NO estan entre ellas: sin eso no hay forma de fabricar un origen QA.
select ok(
  not has_column_privilege('authenticated', 'public.products', 'catalog_origin', 'UPDATE'),
  'authenticated no puede cambiar products.catalog_origin');

select ok(
  not has_column_privilege('authenticated', 'public.products', 'is_verified', 'UPDATE'),
  'authenticated no puede cambiar products.is_verified');

select ok(
  not has_column_privilege('authenticated', 'public.catalog_assets', 'rights_status', 'UPDATE'),
  'authenticated no puede cambiar catalog_assets.rights_status');

-- El camino comercial legitimo sigue abierto: lo que el Panel si puede tocar.
select ok(
  has_column_privilege('authenticated', 'public.products', 'stock', 'UPDATE')
  and has_column_privilege('authenticated', 'public.products', 'available', 'UPDATE')
  and has_column_privilege('authenticated', 'public.products', 'is_active', 'UPDATE')
  and has_column_privilege('authenticated', 'public.products', 'sort_order', 'UPDATE'),
  'el Panel conserva stock/available/is_active/sort_order sobre products');

select ok(
  has_table_privilege('anon', 'public.products', 'SELECT'),
  'la vidriera publica sigue leyendo products');

-- ══════════════════════════════════════════════════════════════════════════
--  3 · fiscal_profile_events (migration 102)
-- ══════════════════════════════════════════════════════════════════════════
-- TRUNCATE es el que importa: no pasa por RLS, asi que el grant era la unica
-- defensa y no estaba puesta.

select ok(not has_table_privilege('anon', 'public.fiscal_profile_events', 'TRUNCATE'),
  'anon no puede TRUNCATE fiscal_profile_events (RLS no lo cubriria)');
select ok(not has_table_privilege('authenticated', 'public.fiscal_profile_events', 'TRUNCATE'),
  'authenticated no puede TRUNCATE fiscal_profile_events');

select ok(not has_table_privilege('anon', 'public.fiscal_profile_events', 'SELECT'),
  'anon no puede leer fiscal_profile_events');
select ok(not has_table_privilege('anon', 'public.fiscal_profile_events', 'INSERT'),
  'anon no puede insertar en fiscal_profile_events');
select ok(not has_table_privilege('anon', 'public.fiscal_profile_events', 'UPDATE'),
  'anon no puede actualizar fiscal_profile_events');
select ok(not has_table_privilege('anon', 'public.fiscal_profile_events', 'DELETE'),
  'anon no puede borrar fiscal_profile_events');
select ok(not has_table_privilege('anon', 'public.fiscal_profile_events', 'REFERENCES'),
  'anon no conserva REFERENCES sobre fiscal_profile_events');

select ok(not has_table_privilege('authenticated', 'public.fiscal_profile_events', 'INSERT'),
  'authenticated no puede insertar en fiscal_profile_events');
select ok(not has_table_privilege('authenticated', 'public.fiscal_profile_events', 'UPDATE'),
  'authenticated no puede actualizar fiscal_profile_events');
select ok(not has_table_privilege('authenticated', 'public.fiscal_profile_events', 'DELETE'),
  'authenticated no puede borrar fiscal_profile_events');

-- Lo que si tiene que seguir: el Panel lee su propio rastro.
select ok(has_table_privilege('authenticated', 'public.fiscal_profile_events', 'SELECT'),
  'authenticated conserva SELECT sobre fiscal_profile_events');

select is(
  (select count(*)::integer from pg_policies
    where schemaname = 'public' and tablename = 'fiscal_profile_events'),
  1, 'fiscal_profile_events conserva su policy de lectura');

-- Ninguna tabla de public puede quedar con escritura para un rol de cliente.
select is(
  (select count(*)::integer
     from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee in ('anon', 'authenticated')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')),
  0, 'ninguna tabla de public da INSERT/UPDATE/DELETE/TRUNCATE a anon o authenticated');

-- ══════════════════════════════════════════════════════════════════════════
--  4 · SECURITY DEFINER ejecutable por anon (migration 103)
-- ══════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and has_function_privilege('anon', p.oid, 'EXECUTE')),
  8, 'quedan exactamente 8 SECURITY DEFINER ejecutables por anon');

select bag_eq(
  $$select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and has_function_privilege('anon', p.oid, 'EXECUTE')$$,
  $$values ('can_access_order'), ('check_scheduler_watchdog'), ('commerce_availability'),
           ('get_public_business_contact'), ('get_public_order_tracking'),
           ('list_business_combos'), ('resolve_business_combo'), ('scheduler_heartbeat')$$,
  'y son exactamente las 8 del contrato publico escrito');

-- B · las 5 RPC fiscales: authenticated si, anon no.
select ok(not has_function_privilege('anon', 'public.authorize_fiscal_artifact_access(uuid,text)', 'EXECUTE'),
  'anon no ejecuta authorize_fiscal_artifact_access');
select ok(not has_function_privilege('anon', 'public.list_fiscal_document_artifacts(uuid)', 'EXECUTE'),
  'anon no ejecuta list_fiscal_document_artifacts');
select ok(not has_function_privilege('anon', 'public.request_fiscal_artifact_regeneration(uuid)', 'EXECUTE'),
  'anon no ejecuta request_fiscal_artifact_regeneration');
select ok(not has_function_privilege('anon', 'public.request_fiscal_print_job(uuid,uuid,text,text,integer,text)', 'EXECUTE'),
  'anon no ejecuta request_fiscal_print_job');
select ok(not has_function_privilege('anon', 'public.update_fiscal_print_job(uuid,text,text)', 'EXECUTE'),
  'anon no ejecuta update_fiscal_print_job');

select ok(
  has_function_privilege('authenticated', 'public.authorize_fiscal_artifact_access(uuid,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.list_fiscal_document_artifacts(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.request_fiscal_artifact_regeneration(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.request_fiscal_print_job(uuid,uuid,text,text,integer,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.update_fiscal_print_job(uuid,text,text)', 'EXECUTE'),
  'el Panel autenticado conserva las 5 RPC fiscales');

-- C · funciones de trigger: ningun rol de cliente, y el trigger sigue atado.
select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('assert_fiscal_execution_authorized', 'assert_order_payment_modality',
                        'enqueue_authorized_fiscal_artifact', 'enqueue_new_order_notification',
                        'prevent_unverified_delivery')
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  0, 'ninguna funcion de trigger es ejecutable por anon o authenticated');

select is(
  (select count(distinct p.proname)::integer
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     join pg_trigger t on t.tgfoid = p.oid
    where n.nspname = 'public'
      and p.proname in ('assert_fiscal_execution_authorized', 'assert_order_payment_modality',
                        'enqueue_authorized_fiscal_artifact', 'enqueue_new_order_notification',
                        'prevent_unverified_delivery')),
  5, 'las 5 siguen atadas a su trigger: revocar EXECUTE no las desconecta');

-- A · lo que anon NO puede perder.
select ok(has_function_privilege('anon', 'public.can_access_order(uuid)', 'EXECUTE'),
  'anon conserva can_access_order: lo evaluan las policies del seguimiento publico');
select ok(has_function_privilege('anon', 'public.get_public_order_tracking(text)', 'EXECUTE'),
  'anon conserva get_public_order_tracking');
select ok(has_function_privilege('anon', 'public.scheduler_heartbeat()', 'EXECUTE'),
  'anon conserva scheduler_heartbeat: es la sonda externa sin credenciales');

-- ══════════════════════════════════════════════════════════════════════════
--  5 · INVARIANTES QUE NO SE PUEDEN REGRESIONAR
-- ══════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
  0, 'cero SECURITY DEFINER sin search_path fijado');

select ok(
  not has_schema_privilege('anon', 'public', 'CREATE')
  and not has_schema_privilege('authenticated', 'public', 'CREATE'),
  'CREATE sobre schema public sigue negado a anon y authenticated');

select ok(
  not has_schema_privilege('anon', 'vault', 'USAGE')
  and not has_schema_privilege('authenticated', 'vault', 'USAGE'),
  'vault sigue inaccesible para anon y authenticated');

select is(
  (select count(*)::integer from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0, 'cero tablas de public sin RLS');

select * from finish();
rollback;
