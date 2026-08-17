-- Retrato de seguridad del alta autogestionada, en una sola consulta de LECTURA.
--
-- Es el retrato de la remediacion (scripts/production-security-portrait.sql) mas
-- un bloque propio para lo que agrega esta mision. Se copia en vez de editarse
-- para que la evidencia de la mision anterior siga siendo reproducible con el
-- texto exacto que uso.
--
-- Se corre con el MISMO texto contra los dos destinos, para que el drift se mida
-- comparando dos retratos y no dos procedimientos distintos:
--
--   supabase db query --linked -f scripts/registration-security-portrait.sql
--   docker exec -i <shadow-db> psql -U postgres -d postgres -f - < este archivo
--
-- No escribe nada. No lee ningun dato humano ni comercial: solo catalogo,
-- privilegios y recuentos.

select jsonb_build_object(

  'ledger', (select count(*) from supabase_migrations.schema_migrations),
  'ledger_last', (select max(version) from supabase_migrations.schema_migrations),

  'counts', (select jsonb_build_object(
    'tables', count(*) filter (where relkind = 'r'),
    'rls_enabled', count(*) filter (where relkind = 'r' and relrowsecurity),
    'rls_missing', count(*) filter (where relkind = 'r' and not relrowsecurity))
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'),

  'policies', (select count(*) from pg_policies where schemaname = 'public'),

  'security_definer', (select jsonb_build_object(
    'total', count(*),
    'without_search_path', count(*) filter (
      where not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
    'anon_execute', count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE')))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef),

  'security_definer_anon_list', (select coalesce(jsonb_agg(x.proname order by x.proname), '[]'::jsonb)
    from (select p.proname::text
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prosecdef
             and has_function_privilege('anon', p.oid, 'EXECUTE')) x),

  'qa_surface', (select coalesce(jsonb_agg(jsonb_build_object(
      'name', p.proname,
      'anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
      'authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'))
      order by p.proname), '[]'::jsonb)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('import_qa_fixture_catalog', 'publish_qa_fixture_product', 'product_is_qa_fixture')),

  'staging_only_comments', (select count(*)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and coalesce(obj_description(p.oid, 'pg_proc'), '') like '%STAGING ONLY%'),

  'client_write_grants', (select coalesce(jsonb_agg(jsonb_build_object(
      'table', table_name, 'grantee', grantee, 'privilege', privilege_type)
      order by table_name, grantee, privilege_type), '[]'::jsonb)
    from information_schema.role_table_grants
   where table_schema = 'public'
     and grantee in ('anon', 'authenticated')
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')),

  'fiscal_profile_events_grants', (select coalesce(jsonb_object_agg(grantee, privs), '{}'::jsonb)
    from (select grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
            from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'fiscal_profile_events'
             and grantee in ('anon', 'authenticated', 'service_role')
           group by grantee) g),

  'schema_create', jsonb_build_object(
    'anon_public', has_schema_privilege('anon', 'public', 'CREATE'),
    'authenticated_public', has_schema_privilege('authenticated', 'public', 'CREATE')),

  'vault', jsonb_build_object(
    'anon_usage', has_schema_privilege('anon', 'vault', 'USAGE'),
    'authenticated_usage', has_schema_privilege('authenticated', 'vault', 'USAGE'),
    'secrets', (select count(*) from vault.secrets)),

  'cron_jobs', (select coalesce(jsonb_agg(jsonb_build_object(
      'jobname', jobname, 'schedule', schedule, 'command', command, 'active', active)
      order by jobid), '[]'::jsonb) from cron.job),

  'data_counts', jsonb_build_object(
    'auth_users', (select count(*) from auth.users),
    'storage_objects', (select count(*) from storage.objects),
    'businesses', (select count(*) from public.businesses),
    'customers', (select count(*) from public.customers),
    'orders', (select count(*) from public.orders),
    'order_items', (select count(*) from public.order_items),
    'riders', (select count(*) from public.riders),
    'rider_order_offers', (select count(*) from public.rider_order_offers),
    'payment_intents', (select count(*) from public.payment_intents),
    'rider_locations', (select count(*) from public.rider_locations),
    'products', (select count(*) from public.products),
    'catalog_assets', (select count(*) from public.catalog_assets),
    'fiscal_profile_events', (select count(*) from public.fiscal_profile_events),
    'operational_sweep_runs', (select count(*) from public.operational_sweep_runs)),

  -- ── Lo que agrega esta mision ──────────────────────────────────────────────

  'registration', jsonb_build_object(

    'table', (select jsonb_build_object(
        'exists', count(*) > 0,
        'rls_enabled', coalesce(bool_or(c.relrowsecurity), false),
        'policies', (select count(*) from pg_policies
                      where schemaname = 'public' and tablename = 'business_access_requests'))
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'business_access_requests'),

    -- La tabla no se toca desde ningun cliente: cero grants, de cualquier tipo.
    'table_grants', (select coalesce(jsonb_agg(jsonb_build_object(
        'grantee', grantee, 'privilege', privilege_type) order by grantee, privilege_type), '[]'::jsonb)
      from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'business_access_requests'
       and grantee in ('anon', 'authenticated')),

    'constraints', (select coalesce(jsonb_agg(conname order by conname), '[]'::jsonb)
      from pg_constraint
     where conrelid = to_regclass('public.business_access_requests')),

    'indexes', (select coalesce(jsonb_agg(indexname order by indexname), '[]'::jsonb)
      from pg_indexes
     where schemaname = 'public' and tablename = 'business_access_requests'),

    'functions', (select coalesce(jsonb_object_agg(x.proname, x.info), '{}'::jsonb)
      from (select p.proname::text,
                   jsonb_build_object(
                     'definer', p.prosecdef,
                     'search_path', exists (
                       select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'),
                     'anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
                     'authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
                     'public', has_function_privilege('public', p.oid, 'EXECUTE')) as info
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public'
               and p.proname in (
                 'request_business_access',
                 'get_my_business_access_request',
                 'identity_list_access_requests',
                 'identity_review_access_request',
                 'business_access_request_retry_delay')) x),

    -- El vocabulario cerrado de la auditoria, entero y tal cual esta escrito:
    -- sirve para ver que los tres eventos nuevos existan y que no se haya
    -- perdido ninguno de los trece viejos.
    'audit_event_type_check', (select pg_get_constraintdef(oid)
      from pg_constraint
     where conrelid = to_regclass('public.identity_audit_events')
       and conname = 'identity_audit_events_event_type_check'),

    'counts', jsonb_build_object(
      'business_access_requests', (select count(*) from public.business_access_requests),
      'business_members', (select count(*) from public.business_members),
      'staff_profiles', (select count(*) from public.staff_profiles),
      'rider_profiles', (select count(*) from public.rider_profiles),
      'identity_sessions', (select count(*) from public.identity_sessions),
      'identity_audit_events', (select count(*) from public.identity_audit_events),
      'customer_addresses', (select count(*) from public.customer_addresses)))

) as portrait;
