-- La Taba image pipeline for Controlled Production.
-- Pending files stay private. Only reviewed files are copied into the public
-- catalog-images bucket; the existing products/catalog_assets publication
-- contract remains authoritative.

create or replace function public.catalog_product_storage_path(
  p_business_id uuid,
  p_product_id uuid,
  p_kind text,
  p_asset_sha256 text
)
returns text
language sql
immutable
strict
set search_path = pg_catalog, public, pg_temp
as $$
  select case
    when p_asset_sha256 ~ '^[a-f0-9]{64}$' and p_kind = 'master' then
      'business/' || lower(p_business_id::text) || '/products/' || lower(p_product_id::text)
      || '/' || lower(p_asset_sha256) || '.webp'
    when p_asset_sha256 ~ '^[a-f0-9]{64}$' and p_kind = 'thumbnail' then
      'business/' || lower(p_business_id::text) || '/products/' || lower(p_product_id::text)
      || '/thumb-' || lower(p_asset_sha256) || '.webp'
    else null
  end
$$;

-- Existing static assets keep their old deterministic paths. Storage-backed
-- catalog_assets use safe_sku = "c_<business UUID>_<product UUID>"; their image
-- URLs remain under assets/products for backward compatibility, while the
-- browser resolves this marked alias to the approved Storage object.
create or replace function public.catalog_asset_path(
  p_safe_sku text,
  p_identity_sha256 text,
  p_kind text,
  p_asset_sha256 text
)
returns text
language plpgsql
immutable
strict
set search_path = pg_catalog, public, extensions, pg_temp
as $$
begin
  if p_safe_sku ~ '^c_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    if p_identity_sha256 !~ '^[a-f0-9]{64}$' or p_asset_sha256 !~ '^[a-f0-9]{64}$' then
      return null;
    end if;
    if p_kind = 'master' then
      return 'assets/products/' || p_safe_sku || '-' || left(lower(p_identity_sha256), 16)
        || '-' || lower(p_asset_sha256) || '.webp';
    elsif p_kind = 'thumbnail' then
      return 'assets/products/' || p_safe_sku || '-' || left(lower(p_identity_sha256), 16)
        || '-thumb-' || lower(p_asset_sha256) || '.webp';
    end if;
    return null;
  end if;

  if p_kind = 'master' then
    return 'assets/products/' || p_safe_sku || '-' || left(lower(p_identity_sha256), 16)
      || '-' || left(lower(p_asset_sha256), 16) || '.webp';
  elsif p_kind = 'thumbnail' then
    return 'assets/products/' || p_safe_sku || '-' || left(lower(p_identity_sha256), 16)
      || '-thumb-' || left(lower(p_asset_sha256), 16) || '.webp';
  end if;
  return null;
end;
$$;

alter table public.catalog_assets
  add column if not exists product_id uuid references public.products(id) on delete restrict;
alter table public.catalog_assets
  add column if not exists master_storage_path text;
alter table public.catalog_assets
  add column if not exists thumbnail_storage_path text;
alter table public.catalog_assets
  alter column source_url drop not null;

drop index if exists public.catalog_assets_business_product_id_key;
create unique index catalog_assets_business_product_id_key
  on public.catalog_assets (business_id, product_id)
  where product_id is not null;

create or replace function public.catalog_assets_validate_product_binding()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_product public.products%rowtype;
begin
  if new.product_id is not null
     and new.safe_sku !~ '^c_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and new.master_path = public.catalog_asset_path(new.safe_sku, new.identity_sha256, 'master', new.master_sha256)
     and new.thumbnail_path = public.catalog_asset_path(new.safe_sku, new.identity_sha256, 'thumbnail', new.thumbnail_sha256) then
    -- A legacy static-pipeline upsert may replace a Storage-backed registry
    -- row for the same SKU. Clear only the Storage binding; do not strand it.
    new.product_id := null;
    new.master_storage_path := null;
    new.thumbnail_storage_path := null;
  end if;

  if new.product_id is null then
    if new.master_storage_path is not null or new.thumbnail_storage_path is not null then
      raise exception 'catalog image storage paths require a product binding'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  select * into v_product
    from public.products
   where id = new.product_id
   for key share;

  if not found
     or v_product.business_id is distinct from new.business_id
     or v_product.sku is distinct from new.sku
     or coalesce(nullif(v_product.external_id, ''), v_product.sku) is distinct from new.external_id
     or v_product.catalog_origin is distinct from new.catalog_origin then
    raise exception 'catalog image product binding does not match the catalog asset'
      using errcode = 'check_violation';
  end if;

  if new.safe_sku <> 'c_' || lower(new.business_id::text) || '_' || lower(new.product_id::text) then
    raise exception 'catalog image path identity is invalid'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.catalog_assets_validate_product_binding() from public, anon, authenticated;
drop trigger if exists catalog_assets_validate_product_binding on public.catalog_assets;
create trigger catalog_assets_validate_product_binding
  before insert or update of business_id, external_id, sku, product_id, safe_sku, catalog_origin,
    master_path, thumbnail_path, master_storage_path, thumbnail_storage_path
  on public.catalog_assets
  for each row execute function public.catalog_assets_validate_product_binding();

create or replace function public.products_validate_catalog_asset_binding()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_asset public.catalog_assets%rowtype;
begin
  if new.catalog_asset_id is null then
    return new;
  end if;

  select * into v_asset
    from public.catalog_assets
   where id = new.catalog_asset_id;
  if not found
     or v_asset.business_id is distinct from new.business_id
     or v_asset.sku is distinct from new.sku
     or v_asset.external_id is distinct from coalesce(nullif(new.external_id, ''), new.sku)
     or v_asset.catalog_origin is distinct from new.catalog_origin
     or (v_asset.product_id is not null and v_asset.product_id is distinct from new.id)
     or v_asset.master_path is distinct from new.image_url
     or v_asset.master_sha256 is distinct from new.image_sha256
     or v_asset.thumbnail_path is distinct from new.image_thumbnail_url
     or v_asset.thumbnail_sha256 is distinct from new.image_thumbnail_sha256
     or v_asset.source_sha256 is distinct from new.source_image_sha256 then
    raise exception 'product image association does not match its approved catalog asset'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.products_validate_catalog_asset_binding() from public, anon, authenticated;
drop trigger if exists products_validate_catalog_asset_binding on public.products;
create trigger products_validate_catalog_asset_binding
  before insert or update of business_id, external_id, sku, catalog_origin, catalog_asset_id,
    image_url, image_sha256, image_thumbnail_url, image_thumbnail_sha256, source_image_sha256
  on public.products
  for each row execute function public.products_validate_catalog_asset_binding();

alter table public.catalog_assets
  drop constraint if exists catalog_assets_identity_binding_valid;
alter table public.catalog_assets
  drop constraint if exists catalog_assets_storage_path_pair;
alter table public.catalog_assets
  drop constraint if exists catalog_assets_source_https;

alter table public.catalog_assets
  add constraint catalog_assets_storage_path_pair check (
    (product_id is null and master_storage_path is null and thumbnail_storage_path is null)
    or
    (product_id is not null
      and master_storage_path is not null
      and thumbnail_storage_path is not null
      and master_storage_path = public.catalog_product_storage_path(business_id, product_id, 'master', master_sha256)
      and thumbnail_storage_path = public.catalog_product_storage_path(business_id, product_id, 'thumbnail', thumbnail_sha256))
  ),
  add constraint catalog_assets_identity_binding_valid check (
    identity_sha256 = public.catalog_image_identity_sha256(external_id, sku, source_sha256)
    and master_path = public.catalog_asset_path(safe_sku, identity_sha256, 'master', master_sha256)
    and thumbnail_path = public.catalog_asset_path(safe_sku, identity_sha256, 'thumbnail', thumbnail_sha256)
    and master_binding_sha256 = public.catalog_asset_binding_sha256(
      identity_sha256, 'master', source_sha256, master_sha256, master_width, master_height, master_path
    )
    and thumbnail_binding_sha256 = public.catalog_asset_binding_sha256(
      identity_sha256, 'thumbnail', source_sha256, thumbnail_sha256, thumbnail_width, thumbnail_height, thumbnail_path
    )
  ),
  add constraint catalog_assets_source_https check (
    (source_url is null and rights_status = 'PROPIO')
    or (source_url is not null and lower(source_url) ~ '^https://')
  );

create table if not exists public.catalog_image_uploads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  source_type text not null check (source_type in (
    'brand', 'manufacturer', 'official_distributor', 'retail_reference', 'business_owned_photo'
  )),
  source_url text,
  source_domain text not null,
  original_mime text not null check (original_mime in ('image/jpeg', 'image/png', 'image/webp')),
  original_bytes bigint not null check (original_bytes between 1 and 5242880),
  source_sha256 text,
  master_sha256 text,
  thumbnail_sha256 text,
  master_width integer,
  master_height integer,
  thumbnail_width integer,
  thumbnail_height integer,
  master_bytes bigint,
  thumbnail_bytes bigint,
  staging_source_path text not null unique,
  staging_master_path text not null unique,
  staging_thumbnail_path text not null unique,
  public_master_path text,
  public_thumbnail_path text,
  previous_master_path text,
  previous_thumbnail_path text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  license_status text not null default 'pending' check (license_status in ('pending', 'approved', 'rejected')),
  rights_status text check (rights_status is null or rights_status in ('PROPIO', 'LICENCIA_COMERCIAL', 'PERMISO_DOCUMENTADO')),
  rights_reference text,
  idempotency_key uuid not null,
  upload_completed_at timestamptz,
  review_previewed_at timestamptz,
  review_previewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete restrict,
  catalog_asset_id uuid references public.catalog_assets(id) on delete restrict,
  cleanup_status text not null default 'pending' check (cleanup_status in ('pending', 'complete', 'retry_needed')),
  rejection_reason text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint catalog_image_uploads_business_product_idempotency_key
    unique (business_id, product_id, idempotency_key),
  constraint catalog_image_uploads_source_provenance check (
    (source_type = 'business_owned_photo' and source_url is null and source_domain = 'business-owned')
    or
    (source_type <> 'business_owned_photo' and source_url is not null
      and lower(source_url) ~ '^https://' and source_domain <> '')
  ),
  constraint catalog_image_uploads_generated_paths check (
    staging_source_path = 'business/' || business_id::text || '/products/' || product_id::text
      || '/pending/' || id::text || '/source.' ||
        case original_mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end
    and staging_master_path = 'business/' || business_id::text || '/products/' || product_id::text
      || '/pending/' || id::text || '/master.webp'
    and staging_thumbnail_path = 'business/' || business_id::text || '/products/' || product_id::text
      || '/pending/' || id::text || '/thumbnail.webp'
  ),
  constraint catalog_image_uploads_completion_hashes check (
    (upload_completed_at is null
      and source_sha256 is null and master_sha256 is null and thumbnail_sha256 is null
      and master_width is null and master_height is null
      and thumbnail_width is null and thumbnail_height is null)
    or
    (upload_completed_at is not null
      and source_sha256 is not null and source_sha256 ~ '^[a-f0-9]{64}$'
      and master_sha256 is not null and master_sha256 ~ '^[a-f0-9]{64}$'
      and thumbnail_sha256 is not null and thumbnail_sha256 ~ '^[a-f0-9]{64}$'
      and master_width = 1000 and master_height = 1000
      and thumbnail_width = 400 and thumbnail_height = 400
      and master_bytes is not null and master_bytes between 1 and 5242880
      and thumbnail_bytes is not null and thumbnail_bytes between 1 and 5242880)
  ),
  constraint catalog_image_uploads_review_state check (
    (status = 'pending' and license_status = 'pending' and reviewed_at is null and reviewed_by is null
      and catalog_asset_id is null and public_master_path is null and public_thumbnail_path is null
      and previous_master_path is null and previous_thumbnail_path is null)
    or
    (status = 'approved' and license_status = 'approved' and upload_completed_at is not null
      and rights_status is not null and btrim(coalesce(rights_reference, '')) <> ''
      and reviewed_at is not null and reviewed_by is not null
      and catalog_asset_id is not null
      and public_master_path is not null and public_thumbnail_path is not null
      and public_master_path = public.catalog_product_storage_path(business_id, product_id, 'master', master_sha256)
      and public_thumbnail_path = public.catalog_product_storage_path(business_id, product_id, 'thumbnail', thumbnail_sha256)
      and (previous_master_path is null or previous_master_path ~ (
        '^business/' || business_id::text || '/products/' || product_id::text || '/[a-f0-9]{64}[.]webp$'))
      and (previous_thumbnail_path is null or previous_thumbnail_path ~ (
        '^business/' || business_id::text || '/products/' || product_id::text || '/thumb-[a-f0-9]{64}[.]webp$')))
    or
    (status = 'rejected' and reviewed_at is not null and reviewed_by is not null
      and catalog_asset_id is null and public_master_path is null and public_thumbnail_path is null
      and previous_master_path is null and previous_thumbnail_path is null
      and btrim(coalesce(rejection_reason, '')) <> '')
  )
);

create index if not exists catalog_image_uploads_business_product_created_idx
  on public.catalog_image_uploads (business_id, product_id, created_at desc);
create index if not exists catalog_image_uploads_pending_review_idx
  on public.catalog_image_uploads (business_id, status, created_at desc)
  where status = 'pending';
create unique index if not exists catalog_image_uploads_one_open_review_per_product
  on public.catalog_image_uploads (business_id, product_id)
  where status = 'pending' or (status = 'approved' and cleanup_status <> 'complete');

create or replace function public.catalog_image_uploads_validate_product()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_product public.products%rowtype;
begin
  select * into v_product from public.products where id = new.product_id for key share;
  if not found or v_product.business_id is distinct from new.business_id
     or v_product.catalog_origin is distinct from 'commercial' then
    raise exception 'catalog image upload must reference a commercial product in its business'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.catalog_image_uploads_validate_product() from public, anon, authenticated;
drop trigger if exists catalog_image_uploads_validate_product on public.catalog_image_uploads;
create trigger catalog_image_uploads_validate_product
  before insert or update of business_id, product_id on public.catalog_image_uploads
  for each row execute function public.catalog_image_uploads_validate_product();

alter table public.catalog_image_uploads enable row level security;
revoke all privileges on table public.catalog_image_uploads from public, anon, authenticated;
grant select on table public.catalog_image_uploads to authenticated;
grant select, insert, update, delete on table public.catalog_image_uploads to service_role;
drop policy if exists catalog_image_uploads_owner_admin_read on public.catalog_image_uploads;
create policy catalog_image_uploads_owner_admin_read
  on public.catalog_image_uploads for select to authenticated
  using (public.has_business_role(business_id, array['owner', 'admin']));

create or replace function public.catalog_image_upload_actor_allowed(
  p_business_id uuid,
  p_product_id uuid,
  p_actor_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
      from public.business_members bm
      join public.products p on p.id = p_product_id and p.business_id = p_business_id
     where bm.business_id = p_business_id
       and bm.user_id = p_actor_user_id
       and bm.is_active
       and bm.role in ('owner', 'admin')
       and p.catalog_origin = 'commercial'
  )
$$;

revoke all on function public.catalog_image_upload_actor_allowed(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.catalog_image_upload_actor_allowed(uuid, uuid, uuid) to service_role;

create or replace function public.complete_catalog_image_upload(
  p_upload_id uuid,
  p_actor_user_id uuid,
  p_source_sha256 text,
  p_master_sha256 text,
  p_thumbnail_sha256 text,
  p_source_bytes bigint,
  p_master_bytes bigint,
  p_thumbnail_bytes bigint
)
returns public.catalog_image_uploads
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_upload public.catalog_image_uploads%rowtype;
begin
  select * into v_upload from public.catalog_image_uploads where id = p_upload_id for update;
  if not found
     or not public.catalog_image_upload_actor_allowed(v_upload.business_id, v_upload.product_id, p_actor_user_id) then
    raise exception 'catalog image upload not found' using errcode = 'no_data_found';
  end if;
  if v_upload.status <> 'pending' or v_upload.upload_completed_at is not null then
    raise exception 'catalog image upload cannot be finalized in its current state' using errcode = 'check_violation';
  end if;
  if p_source_sha256 is null or p_source_sha256 !~ '^[a-f0-9]{64}$'
     or p_master_sha256 is null or p_master_sha256 !~ '^[a-f0-9]{64}$'
     or p_thumbnail_sha256 is null or p_thumbnail_sha256 !~ '^[a-f0-9]{64}$'
     or p_source_bytes is null or p_source_bytes not between 1 and 5242880
     or p_master_bytes is null or p_master_bytes not between 1 and 5242880
     or p_thumbnail_bytes is null or p_thumbnail_bytes not between 1 and 5242880 then
    raise exception 'catalog image upload metadata is invalid' using errcode = 'check_violation';
  end if;

  update public.catalog_image_uploads
     set source_sha256 = p_source_sha256,
         master_sha256 = p_master_sha256,
         thumbnail_sha256 = p_thumbnail_sha256,
         original_bytes = p_source_bytes,
         master_bytes = p_master_bytes,
         thumbnail_bytes = p_thumbnail_bytes,
         master_width = 1000,
         master_height = 1000,
         thumbnail_width = 400,
         thumbnail_height = 400,
         upload_completed_at = statement_timestamp(),
         updated_at = statement_timestamp()
   where id = p_upload_id
   returning * into v_upload;
  return v_upload;
end;
$$;

revoke all on function public.complete_catalog_image_upload(uuid, uuid, text, text, text, bigint, bigint, bigint)
  from public, anon, authenticated;
grant execute on function public.complete_catalog_image_upload(uuid, uuid, text, text, text, bigint, bigint, bigint)
  to service_role;

create or replace function public.approve_catalog_image_upload(
  p_upload_id uuid,
  p_actor_user_id uuid,
  p_rights_status text,
  p_rights_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_upload public.catalog_image_uploads%rowtype;
  v_product public.products%rowtype;
  v_asset_id uuid;
  v_external_id text;
  v_safe_sku text;
  v_identity_sha256 text;
  v_master_path text;
  v_thumbnail_path text;
  v_master_storage_path text;
  v_thumbnail_storage_path text;
  v_master_binding_sha256 text;
  v_thumbnail_binding_sha256 text;
  v_old_master_storage_path text;
  v_old_thumbnail_storage_path text;
begin
  select * into v_upload from public.catalog_image_uploads where id = p_upload_id for update;
  if not found
     or not public.catalog_image_upload_actor_allowed(v_upload.business_id, v_upload.product_id, p_actor_user_id) then
    raise exception 'catalog image upload not found' using errcode = 'no_data_found';
  end if;
  if v_upload.status <> 'pending' or v_upload.upload_completed_at is null
     or v_upload.license_status <> 'pending'
     or v_upload.review_previewed_by is distinct from p_actor_user_id
     or v_upload.review_previewed_at is null
     or v_upload.review_previewed_at < statement_timestamp() - interval '5 minutes' then
    raise exception 'catalog image upload is not ready for approval' using errcode = 'check_violation';
  end if;
  if p_rights_status not in ('PROPIO', 'LICENCIA_COMERCIAL', 'PERMISO_DOCUMENTADO')
     or btrim(coalesce(p_rights_reference, '')) = '' then
    raise exception 'documented image rights are required for approval' using errcode = 'check_violation';
  end if;
  if v_upload.source_type = 'business_owned_photo'
     and (p_rights_status <> 'PROPIO' or v_upload.source_url is not null) then
    raise exception 'business-owned photos require PROPIO rights and no external URL' using errcode = 'check_violation';
  end if;
  if v_upload.source_type <> 'business_owned_photo'
     and (p_rights_status = 'PROPIO' or v_upload.source_url is null) then
    raise exception 'external image sources require commercial license or written permission' using errcode = 'check_violation';
  end if;

  select * into v_product from public.products
   where id = v_upload.product_id and business_id = v_upload.business_id
   for update;
  if not found or v_product.catalog_origin <> 'commercial'
     or v_product.available or v_product.is_verified then
    raise exception 'catalog images can only be associated to unpublished, unverified commercial products'
      using errcode = 'check_violation';
  end if;
  v_external_id := coalesce(nullif(v_product.external_id, ''), v_product.sku);
  if btrim(coalesce(v_external_id, '')) = '' or btrim(coalesce(v_product.sku, '')) = '' then
    raise exception 'catalog image target has no stable product identity' using errcode = 'check_violation';
  end if;
  v_safe_sku := 'c_' || lower(v_product.business_id::text) || '_' || lower(v_product.id::text);
  v_identity_sha256 := public.catalog_image_identity_sha256(v_external_id, v_product.sku, v_upload.source_sha256);
  v_master_path := public.catalog_asset_path(v_safe_sku, v_identity_sha256, 'master', v_upload.master_sha256);
  v_thumbnail_path := public.catalog_asset_path(v_safe_sku, v_identity_sha256, 'thumbnail', v_upload.thumbnail_sha256);
  v_master_storage_path := public.catalog_product_storage_path(v_upload.business_id, v_upload.product_id, 'master', v_upload.master_sha256);
  v_thumbnail_storage_path := public.catalog_product_storage_path(v_upload.business_id, v_upload.product_id, 'thumbnail', v_upload.thumbnail_sha256);
  v_master_binding_sha256 := public.catalog_asset_binding_sha256(
    v_identity_sha256, 'master', v_upload.source_sha256, v_upload.master_sha256, 1000, 1000, v_master_path
  );
  v_thumbnail_binding_sha256 := public.catalog_asset_binding_sha256(
    v_identity_sha256, 'thumbnail', v_upload.source_sha256, v_upload.thumbnail_sha256, 400, 400, v_thumbnail_path
  );

  select master_storage_path, thumbnail_storage_path
    into v_old_master_storage_path, v_old_thumbnail_storage_path
    from public.catalog_assets
   where business_id = v_upload.business_id and sku = v_product.sku
   for update;

  insert into public.catalog_assets (
    business_id, external_id, sku, safe_sku, identity_sha256, product_id,
    master_path, master_sha256, master_binding_sha256, master_width, master_height,
    thumbnail_path, thumbnail_sha256, thumbnail_binding_sha256, thumbnail_width, thumbnail_height,
    master_storage_path, thumbnail_storage_path, source_sha256, source_url,
    rights_status, rights_reference, approved_at, approved_by, catalog_origin
  ) values (
    v_upload.business_id, v_external_id, v_product.sku, v_safe_sku, v_identity_sha256, v_upload.product_id,
    v_master_path, v_upload.master_sha256, v_master_binding_sha256, 1000, 1000,
    v_thumbnail_path, v_upload.thumbnail_sha256, v_thumbnail_binding_sha256, 400, 400,
    v_master_storage_path, v_thumbnail_storage_path, v_upload.source_sha256, v_upload.source_url,
    p_rights_status, btrim(p_rights_reference), statement_timestamp(), p_actor_user_id, 'commercial'
  )
  on conflict (business_id, sku) do update set
    external_id = excluded.external_id,
    safe_sku = excluded.safe_sku,
    identity_sha256 = excluded.identity_sha256,
    product_id = excluded.product_id,
    master_path = excluded.master_path,
    master_sha256 = excluded.master_sha256,
    master_binding_sha256 = excluded.master_binding_sha256,
    master_width = excluded.master_width,
    master_height = excluded.master_height,
    thumbnail_path = excluded.thumbnail_path,
    thumbnail_sha256 = excluded.thumbnail_sha256,
    thumbnail_binding_sha256 = excluded.thumbnail_binding_sha256,
    thumbnail_width = excluded.thumbnail_width,
    thumbnail_height = excluded.thumbnail_height,
    master_storage_path = excluded.master_storage_path,
    thumbnail_storage_path = excluded.thumbnail_storage_path,
    source_sha256 = excluded.source_sha256,
    source_url = excluded.source_url,
    rights_status = excluded.rights_status,
    rights_reference = excluded.rights_reference,
    approved_at = excluded.approved_at,
    approved_by = excluded.approved_by,
    catalog_origin = excluded.catalog_origin,
    updated_at = statement_timestamp()
  returning id into v_asset_id;

  update public.products
     set catalog_asset_id = v_asset_id,
         image_url = v_master_path,
         image_sha256 = v_upload.master_sha256,
         image_thumbnail_url = v_thumbnail_path,
         image_thumbnail_sha256 = v_upload.thumbnail_sha256,
         source_image_sha256 = v_upload.source_sha256
   where id = v_product.id
     and business_id = v_upload.business_id
     and not available
     and not is_verified;
  if not found then
    raise exception 'catalog image target changed before association' using errcode = 'serialization_failure';
  end if;

  update public.catalog_image_uploads
     set status = 'approved',
         license_status = 'approved',
         rights_status = p_rights_status,
         rights_reference = btrim(p_rights_reference),
         reviewed_at = statement_timestamp(),
    reviewed_by = p_actor_user_id,
    catalog_asset_id = v_asset_id,
    public_master_path = v_master_storage_path,
    public_thumbnail_path = v_thumbnail_storage_path,
    previous_master_path = v_old_master_storage_path,
    previous_thumbnail_path = v_old_thumbnail_storage_path,
         cleanup_status = 'pending',
         updated_at = statement_timestamp()
   where id = p_upload_id;

  return jsonb_build_object(
    'catalog_asset_id', v_asset_id,
    'master_path', v_master_storage_path,
    'thumbnail_path', v_thumbnail_storage_path,
    'old_master_path', v_old_master_storage_path,
    'old_thumbnail_path', v_old_thumbnail_storage_path,
    'business_id', v_upload.business_id,
    'product_id', v_upload.product_id
  );
end;
$$;

revoke all on function public.approve_catalog_image_upload(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.approve_catalog_image_upload(uuid, uuid, text, text)
  to service_role;

create or replace function public.reject_catalog_image_upload(
  p_upload_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_upload public.catalog_image_uploads%rowtype;
begin
  select * into v_upload from public.catalog_image_uploads where id = p_upload_id for update;
  if not found
     or not public.catalog_image_upload_actor_allowed(v_upload.business_id, v_upload.product_id, p_actor_user_id) then
    raise exception 'catalog image upload not found' using errcode = 'no_data_found';
  end if;
  if v_upload.status <> 'pending' or btrim(coalesce(p_reason, '')) = '' or length(p_reason) > 300 then
    raise exception 'catalog image rejection is invalid' using errcode = 'check_violation';
  end if;

  update public.catalog_image_uploads
     set status = 'rejected',
         reviewed_at = statement_timestamp(),
         reviewed_by = p_actor_user_id,
         rejection_reason = btrim(p_reason),
         cleanup_status = 'pending',
         updated_at = statement_timestamp()
   where id = p_upload_id;

  return jsonb_build_object(
    'upload_id', p_upload_id,
    'business_id', v_upload.business_id,
    'product_id', v_upload.product_id,
    'source_path', v_upload.staging_source_path,
    'master_path', v_upload.staging_master_path,
    'thumbnail_path', v_upload.staging_thumbnail_path
  );
end;
$$;

revoke all on function public.reject_catalog_image_upload(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.reject_catalog_image_upload(uuid, uuid, text)
  to service_role;

-- Signed upload URLs are issued only by the authenticated Edge Function. The
-- function uses service_role server-side after validating business membership.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('catalog-image-staging', 'catalog-image-staging', false, 5242880,
    array['image/jpeg', 'image/png', 'image/webp']::text[]),
  ('catalog-images', 'catalog-images', true, 5242880,
    array['image/webp']::text[])
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  updated_at = statement_timestamp();

drop policy if exists catalog_image_staging_service_role_only on storage.objects;
create policy catalog_image_staging_service_role_only
  on storage.objects for all to service_role
  using (bucket_id = 'catalog-image-staging')
  with check (bucket_id = 'catalog-image-staging');

drop policy if exists catalog_images_service_role_only on storage.objects;
create policy catalog_images_service_role_only
  on storage.objects for all to service_role
  using (bucket_id = 'catalog-images')
  with check (bucket_id = 'catalog-images');

comment on table public.catalog_image_uploads is
  'Owner/admin upload and review queue for catalog images. Pending originals and normalized files live only in private catalog-image-staging; approved WebP assets are copied to public catalog-images and associated through catalog_assets.';
comment on column public.catalog_assets.master_storage_path is
  'Private source-of-truth object path in the public-read catalog-images bucket for storage-backed product assets; NULL means the legacy static assets/products path.';
comment on column public.catalog_assets.thumbnail_storage_path is
  'Object path in catalog-images for the 400x400 storage-backed thumbnail; NULL means the legacy static pipeline.';
