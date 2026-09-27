-- Storage publication is separate from catalog editing: pending objects are
-- private, while the public bucket contains only assets promoted by the
-- owner/admin image-review Edge Function.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

select has_table('public', 'catalog_image_uploads', 'la cola de imágenes tiene tabla propia');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.catalog_image_uploads'::regclass),
  'catalog_image_uploads aplica RLS'
);
select ok(
  has_table_privilege('authenticated', 'public.catalog_image_uploads', 'SELECT'),
  'authenticated puede leer la cola sólo a través de RLS'
);
select ok(
  not has_table_privilege('authenticated', 'public.catalog_image_uploads', 'INSERT'),
  'el navegador no inserta filas de revisión directamente'
);
select ok(
  not has_table_privilege('authenticated', 'public.catalog_image_uploads', 'UPDATE'),
  'el navegador no aprueba ni cambia estados directamente'
);
select ok(
  not has_table_privilege('anon', 'public.catalog_image_uploads', 'SELECT'),
  'anon no puede leer la cola privada'
);
select ok(
  not has_table_privilege('anon', 'public.catalog_image_uploads', 'INSERT'),
  'anon no puede abrir cargas de imágenes'
);
select is(
  (select count(*)::integer from pg_policies
    where schemaname = 'public' and tablename = 'catalog_image_uploads'
      and policyname = 'catalog_image_uploads_owner_admin_read'
      and cmd = 'SELECT' and roles @> array['authenticated']::name[]
      and qual like '%has_business_role%owner%admin%'),
  1,
  'la lectura de la cola consulta membership owner/admin del negocio'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.complete_catalog_image_upload(uuid,uuid,text,text,text,bigint,bigint,bigint)',
    'EXECUTE'
  ),
  'authenticated no puede falsear hashes de archivos completados'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.complete_catalog_image_upload(uuid,uuid,text,text,text,bigint,bigint,bigint)',
    'EXECUTE'
  ),
  'sólo el Edge Function puede cerrar la validación binaria'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.approve_catalog_image_upload(uuid,uuid,text,text)',
    'EXECUTE'
  ),
  'el navegador no puede asociar una imagen sin pasar por el flujo del Edge Function'
);
select ok(
  has_function_privilege('service_role', 'public.approve_catalog_image_upload(uuid,uuid,text,text)', 'EXECUTE'),
  'el Edge Function puede llamar la asociación transaccional protegida'
);

select is(
  (select public.catalog_product_storage_path(
    'e7850ad2-a447-402c-8375-3fd74e9466ba',
    'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    'master',
    repeat('1', 64)
  )),
  'business/e7850ad2-a447-402c-8375-3fd74e9466ba/products/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/'
    || repeat('1', 64) || '.webp',
  'el master queda bajo el negocio y producto exactos'
);
select is(
  (select public.catalog_product_storage_path(
    'e7850ad2-a447-402c-8375-3fd74e9466ba',
    'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    'thumbnail',
    repeat('2', 64)
  )),
  'business/e7850ad2-a447-402c-8375-3fd74e9466ba/products/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/thumb-'
    || repeat('2', 64) || '.webp',
  'la miniatura tiene ruta propia, no reutiliza el master'
);
select is(
  (select public.catalog_asset_path(
    'c_e7850ad2-a447-402c-8375-3fd74e9466ba_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    repeat('a', 64), 'master', repeat('1', 64)
  )),
  'assets/products/c_e7850ad2-a447-402c-8375-3fd74e9466ba_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee-'
    || repeat('a', 16) || '-' || repeat('1', 64) || '.webp',
  'el alias de products preserva el contrato existente e identifica Storage'
);
select is(
  (select public.catalog_asset_path(
    'c_e7850ad2-a447-402c-8375-3fd74e9466ba_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    repeat('a', 64), 'thumbnail', repeat('2', 64)
  )),
  'assets/products/c_e7850ad2-a447-402c-8375-3fd74e9466ba_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee-'
    || repeat('a', 16) || '-thumb-' || repeat('2', 64) || '.webp',
  'el alias de miniatura distingue la variante'
);

select is(
  (select public || ':' || file_size_limit::text || ':' || array_to_string(allowed_mime_types, ',')
     from storage.buckets where id = 'catalog-image-staging'),
  'false:5242880:image/jpeg,image/png,image/webp',
  'el bucket de revisión es privado, con MIME explícitos y tope de 5 MB por objeto'
);
select is(
  (select public || ':' || file_size_limit::text || ':' || array_to_string(allowed_mime_types, ',')
     from storage.buckets where id = 'catalog-images'),
  'true:5242880:image/webp',
  'el bucket público contiene únicamente WebP ya revisados'
);
select is(
  (select count(*)::integer from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname in ('catalog_image_staging_service_role_only', 'catalog_images_service_role_only')
      and cmd = 'ALL' and roles @> array['service_role']::name[]
      and not roles && array['anon', 'authenticated']::name[]),
  2,
  'ningún cliente anon/authenticated tiene políticas directas de escritura en Storage'
);

select * from finish();
rollback;
