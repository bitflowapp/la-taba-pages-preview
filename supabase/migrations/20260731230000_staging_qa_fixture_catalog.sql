-- STAGING-ONLY QA fixture catalog.
--
-- This migration is intentionally not a commercial publication path. It adds
-- an explicit origin and a tightly scoped owner/admin RPC so an isolated
-- staging project can exercise checkout and delivery with repository fixtures
-- whose rights are still unapproved. Production catalog publication remains
-- governed by 20260725110000_catalog_publication_authority.sql.

alter table public.catalog_assets
  add column if not exists catalog_origin text not null default 'commercial';

alter table public.catalog_assets
  drop constraint if exists catalog_assets_catalog_origin_valid;
alter table public.catalog_assets
  add constraint catalog_assets_catalog_origin_valid check (
    catalog_origin in ('commercial', 'demo_fixture', 'test_only', 'staging_only')
  );

alter table public.products
  add column if not exists catalog_origin text not null default 'commercial';

alter table public.products
  drop constraint if exists products_catalog_origin_valid;
alter table public.products
  add constraint products_catalog_origin_valid check (
    catalog_origin in ('commercial', 'demo_fixture', 'test_only', 'staging_only')
  );

-- QA assets deliberately have no commercial approval stamp. Commercial rows
-- retain the original strict rights contract.
alter table public.catalog_assets
  alter column approved_at drop not null;
alter table public.catalog_assets
  alter column approved_by drop not null;

alter table public.catalog_assets
  drop constraint if exists catalog_assets_rights_valid;
alter table public.catalog_assets
  add constraint catalog_assets_rights_valid check (
    (
      catalog_origin = 'commercial'
      and rights_status in ('PROPIO', 'LICENCIA_COMERCIAL', 'PERMISO_DOCUMENTADO')
      and btrim(rights_reference) <> ''
      and approved_at is not null
      and approved_by is not null
    )
    or (
      catalog_origin in ('demo_fixture', 'test_only', 'staging_only')
      and rights_status = 'UNAPPROVED_QA'
      and btrim(rights_reference) <> ''
      and approved_at is null
      and approved_by is null
    )
  );

-- A QA product may be operationally visible for a private staging test while
-- its asset remains explicitly UNAPPROVED_QA. The product still has to point
-- to the registered asset and carry deterministic hashes; only commercial
-- path/approval checks are bypassed for QA origins.
alter table public.products
  drop constraint if exists products_verified_publication_authority;
alter table public.products
  add constraint products_verified_publication_authority check (
    not is_verified
    or (
      catalog_origin in ('demo_fixture', 'test_only', 'staging_only')
      and catalog_asset_id is not null
      and image_url is not null
      and image_sha256 ~ '^[a-f0-9]{64}$'
      and image_thumbnail_url is not null
      and image_thumbnail_sha256 ~ '^[a-f0-9]{64}$'
      and source_image_sha256 ~ '^[a-f0-9]{64}$'
    )
    or (
      catalog_origin = 'commercial'
      and external_id is not null
      and btrim(external_id) <> ''
      and sku is not null
      and btrim(sku) <> ''
      and variant is not null
      and btrim(variant) <> ''
      and capacity_value is not null
      and capacity_value > 0
      and capacity_unit in ('ml', 'l', 'g', 'kg', 'unidad')
      and presentation = variant
      and capacity = capacity_value::text || ' ' || capacity_unit
      and catalog_asset_id is not null
      and image_url is not null
      and image_url ~ '^assets/products/[a-z0-9_-]+[.]webp$'
      and image_sha256 is not null
      and image_sha256 ~ '^[a-f0-9]{64}$'
      and image_thumbnail_url is not null
      and image_thumbnail_url ~ '^assets/products/[a-z0-9_-]+[.]webp$'
      and image_thumbnail_url <> image_url
      and image_thumbnail_sha256 is not null
      and image_thumbnail_sha256 ~ '^[a-f0-9]{64}$'
      and source_image_sha256 is not null
      and source_image_sha256 ~ '^[a-f0-9]{64}$'
    )
  );

create or replace function public.import_qa_fixture_catalog(
  p_business_id uuid,
  p_origin text,
  p_assets jsonb,
  p_products jsonb
)
returns table (
  product_id uuid,
  imported_external_id text,
  imported_sku text,
  catalog_origin text,
  rights_status text,
  is_verified boolean,
  available boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_asset jsonb;
  v_product jsonb;
  v_origin text := lower(btrim(coalesce(p_origin, '')));
  v_asset_count integer;
  v_product_count integer;
  v_external_id text;
  v_sku text;
  v_safe_sku text;
  v_asset_id uuid;
  v_product_id uuid;
  v_asset_source_url text;
  v_asset_rights_reference text;
  v_tags text[];
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can import staging QA fixtures.';
  end if;

  if v_origin not in ('demo_fixture', 'test_only', 'staging_only') then
    raise exception 'QA origin must be demo_fixture, test_only or staging_only.';
  end if;
  if p_assets is null or jsonb_typeof(p_assets) is distinct from 'array'
     or p_products is null or jsonb_typeof(p_products) is distinct from 'array' then
    raise exception 'QA assets and products must be JSON arrays.';
  end if;

  v_asset_count := jsonb_array_length(p_assets);
  v_product_count := jsonb_array_length(p_products);
  if v_asset_count < 1 or v_asset_count > 10
     or v_product_count < 1 or v_product_count > 10
     or v_asset_count <> v_product_count then
    raise exception 'QA import must contain 1 to 10 matching assets and products.';
  end if;

  if (
    select count(distinct value ->> 'external_id')
      from jsonb_array_elements(p_assets)
  ) <> v_asset_count
  or (
    select count(distinct value ->> 'sku')
      from jsonb_array_elements(p_assets)
  ) <> v_asset_count
  or (
    select count(distinct value ->> 'external_id')
      from jsonb_array_elements(p_products)
  ) <> v_product_count
  or (
    select count(distinct value ->> 'sku')
      from jsonb_array_elements(p_products)
  ) <> v_product_count then
    raise exception 'QA import contains duplicate identities.';
  end if;

  if exists (
    with asset_ids as (
      select value ->> 'external_id' as external_id,
             value ->> 'sku' as sku
        from jsonb_array_elements(p_assets)
    ), product_ids as (
      select value ->> 'external_id' as external_id,
             value ->> 'sku' as sku
        from jsonb_array_elements(p_products)
    )
    select external_id, sku from asset_ids
    except
    select external_id, sku from product_ids
  ) or exists (
    with asset_ids as (
      select value ->> 'external_id' as external_id,
             value ->> 'sku' as sku
        from jsonb_array_elements(p_assets)
    ), product_ids as (
      select value ->> 'external_id' as external_id,
             value ->> 'sku' as sku
        from jsonb_array_elements(p_products)
    )
    select external_id, sku from product_ids
    except
    select external_id, sku from asset_ids
  ) then
    raise exception 'QA assets and products must have identical identities.';
  end if;

  for v_asset, v_product in
    select assets.value, products.value
      from jsonb_array_elements(p_assets) with ordinality as assets(value, ordinal)
      join jsonb_array_elements(p_products) with ordinality as products(value, ordinal)
        on products.ordinal = assets.ordinal
  loop
    v_external_id := btrim(coalesce(v_asset ->> 'external_id', ''));
    v_sku := btrim(coalesce(v_asset ->> 'sku', ''));
    v_safe_sku := btrim(coalesce(v_asset ->> 'safe_sku', ''));
    if v_external_id = '' or v_sku = '' or v_safe_sku !~ '^[a-z0-9_-]{1,80}$' then
      raise exception 'Invalid QA asset identity for %.', v_external_id;
    end if;
    if btrim(coalesce(v_product ->> 'external_id', '')) <> v_external_id
       or btrim(coalesce(v_product ->> 'sku', '')) <> v_sku then
      raise exception 'QA asset/product identity mismatch for %.', v_external_id;
    end if;

    v_asset_source_url := btrim(coalesce(v_asset ->> 'source_url', ''));
    v_asset_rights_reference := btrim(coalesce(v_asset ->> 'rights_reference', ''));
    if lower(v_asset_source_url) <>
       'https://staging.qa.taba.invalid/' || v_origin || '/' || v_safe_sku
       or lower(btrim(coalesce(v_asset ->> 'rights_status', ''))) <> 'unapproved_qa'
       or v_asset_rights_reference <> 'qa_fixture:' || v_origin || ':' || v_safe_sku then
      raise exception 'QA asset % must carry the unapproved fixture provenance.', v_external_id;
    end if;

    insert into public.catalog_assets (
      business_id,
      external_id,
      sku,
      safe_sku,
      identity_sha256,
      master_path,
      master_sha256,
      master_binding_sha256,
      master_width,
      master_height,
      thumbnail_path,
      thumbnail_sha256,
      thumbnail_binding_sha256,
      thumbnail_width,
      thumbnail_height,
      source_sha256,
      source_url,
      rights_status,
      rights_reference,
      catalog_origin,
      approved_at,
      approved_by,
      updated_at
    ) values (
      p_business_id,
      v_external_id,
      v_sku,
      v_safe_sku,
      lower(btrim(v_asset ->> 'identity_sha256')),
      btrim(v_asset ->> 'master_path'),
      lower(btrim(v_asset ->> 'master_sha256')),
      lower(btrim(v_asset ->> 'master_binding_sha256')),
      coalesce((v_asset ->> 'master_width')::integer, 1000),
      coalesce((v_asset ->> 'master_height')::integer, 1000),
      btrim(v_asset ->> 'thumbnail_path'),
      lower(btrim(v_asset ->> 'thumbnail_sha256')),
      lower(btrim(v_asset ->> 'thumbnail_binding_sha256')),
      coalesce((v_asset ->> 'thumbnail_width')::integer, 400),
      coalesce((v_asset ->> 'thumbnail_height')::integer, 400),
      lower(btrim(v_asset ->> 'source_sha256')),
      v_asset_source_url,
      'UNAPPROVED_QA',
      v_asset_rights_reference,
      v_origin,
      null,
      null,
      statement_timestamp()
    )
    on conflict (business_id, external_id) do update
      set sku = excluded.sku,
          safe_sku = excluded.safe_sku,
          identity_sha256 = excluded.identity_sha256,
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
          source_sha256 = excluded.source_sha256,
          source_url = excluded.source_url,
          rights_status = excluded.rights_status,
          rights_reference = excluded.rights_reference,
          catalog_origin = excluded.catalog_origin,
          approved_at = null,
          approved_by = null,
          updated_at = statement_timestamp()
    returning id into v_asset_id;

    select coalesce(array_agg(value order by value), '{}'::text[])
      into v_tags
      from jsonb_array_elements_text(coalesce(v_product -> 'tags', '[]'::jsonb));

    insert into public.products (
      business_id,
      external_id,
      sku,
      brand,
      name,
      description,
      category,
      subcategory,
      variant,
      presentation,
      capacity_value,
      capacity_unit,
      capacity,
      packaging_type,
      units_per_pack,
      price,
      stock,
      chilled,
      is_alcoholic,
      minimum_age,
      sort_order,
      image_url,
      image_sha256,
      image_thumbnail_url,
      image_thumbnail_sha256,
      source_image_sha256,
      catalog_asset_id,
      tags,
      is_active,
      available,
      is_verified,
      verified_at,
      verified_by,
      catalog_origin,
      updated_at
    ) values (
      p_business_id,
      v_external_id,
      v_sku,
      btrim(v_product ->> 'brand'),
      btrim(v_product ->> 'name'),
      nullif(btrim(coalesce(v_product ->> 'description', '')), ''),
      btrim(v_product ->> 'category'),
      btrim(v_product ->> 'subcategory'),
      btrim(v_product ->> 'variant'),
      btrim(v_product ->> 'variant'),
      (v_product ->> 'capacity_value')::numeric,
      lower(btrim(v_product ->> 'capacity_unit')),
      (v_product ->> 'capacity_value')::text || ' ' || lower(btrim(v_product ->> 'capacity_unit')),
      btrim(v_product ->> 'packaging_type'),
      (v_product ->> 'units_per_pack')::integer,
      (v_product ->> 'price')::numeric,
      (v_product ->> 'stock')::integer,
      (v_product ->> 'chilled')::boolean,
      (v_product ->> 'is_alcoholic')::boolean,
      nullif(v_product ->> 'minimum_age', '')::integer,
      (v_product ->> 'sort_order')::integer,
      btrim(v_product ->> 'image_url'),
      lower(btrim(v_product ->> 'image_sha256')),
      btrim(v_product ->> 'image_thumbnail_url'),
      lower(btrim(v_product ->> 'image_thumbnail_sha256')),
      lower(btrim(v_product ->> 'source_image_sha256')),
      v_asset_id,
      v_tags,
      coalesce((v_product ->> 'is_active')::boolean, true),
      false,
      false,
      null,
      null,
      v_origin,
      statement_timestamp()
    )
    on conflict (business_id, external_id) do update
      set sku = excluded.sku,
          brand = excluded.brand,
          name = excluded.name,
          description = excluded.description,
          category = excluded.category,
          subcategory = excluded.subcategory,
          variant = excluded.variant,
          presentation = excluded.presentation,
          capacity_value = excluded.capacity_value,
          capacity_unit = excluded.capacity_unit,
          capacity = excluded.capacity,
          packaging_type = excluded.packaging_type,
          units_per_pack = excluded.units_per_pack,
          price = excluded.price,
          stock = excluded.stock,
          chilled = excluded.chilled,
          is_alcoholic = excluded.is_alcoholic,
          minimum_age = excluded.minimum_age,
          sort_order = excluded.sort_order,
          image_url = excluded.image_url,
          image_sha256 = excluded.image_sha256,
          image_thumbnail_url = excluded.image_thumbnail_url,
          image_thumbnail_sha256 = excluded.image_thumbnail_sha256,
          source_image_sha256 = excluded.source_image_sha256,
          catalog_asset_id = excluded.catalog_asset_id,
          tags = excluded.tags,
          is_active = excluded.is_active,
          available = false,
          is_verified = false,
          verified_at = null,
          verified_by = null,
          catalog_origin = excluded.catalog_origin,
          updated_at = statement_timestamp()
    returning id into v_product_id;

    product_id := v_product_id;
    imported_external_id := v_external_id;
    imported_sku := v_sku;
    catalog_origin := v_origin;
    rights_status := 'UNAPPROVED_QA';
    is_verified := false;
    available := false;
    return next;
  end loop;
end;
$$;

create or replace function public.publish_qa_fixture_product(
  p_business_id uuid,
  p_external_id text,
  p_available boolean default true
)
returns table (
  product_id uuid,
  published_external_id text,
  published_sku text,
  catalog_origin text,
  rights_status text,
  is_verified boolean,
  available boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_product public.products%rowtype;
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can publish staging QA fixtures.';
  end if;

  select p.* into v_product
    from public.products p
   where p.business_id = p_business_id
     and p.external_id = btrim(p_external_id)
     and p.catalog_origin in ('demo_fixture', 'test_only', 'staging_only')
   for update;
  if not found then
    raise exception 'QA fixture product not found.';
  end if;
  if v_product.catalog_asset_id is null
     or not exists (
       select 1
         from public.catalog_assets ca
        where ca.id = v_product.catalog_asset_id
          and ca.business_id = p_business_id
          and ca.catalog_origin = v_product.catalog_origin
          and ca.rights_status = 'UNAPPROVED_QA'
          and ca.approved_at is null
          and ca.approved_by is null
     ) then
    raise exception 'QA fixture asset provenance is invalid.';
  end if;

  update public.products p
     set is_verified = true,
         verified_at = null,
         verified_by = null,
         available = coalesce(p_available, false) and p.is_active and coalesce(p.stock, 0) > 0,
         updated_at = statement_timestamp()
   where p.id = v_product.id
  returning p.id, p.external_id, p.sku, p.catalog_origin,
            (select ca.rights_status from public.catalog_assets ca where ca.id = p.catalog_asset_id),
            p.is_verified, p.available
  into product_id, published_external_id, published_sku, catalog_origin,
       rights_status, is_verified, available;
  return next;
end;
$$;

revoke all on function public.import_qa_fixture_catalog(uuid, text, jsonb, jsonb)
from public, anon, authenticated;
grant execute on function public.import_qa_fixture_catalog(uuid, text, jsonb, jsonb)
to authenticated;

revoke all on function public.publish_qa_fixture_product(uuid, text, boolean)
from public, anon, authenticated;
grant execute on function public.publish_qa_fixture_product(uuid, text, boolean)
to authenticated;

comment on column public.catalog_assets.catalog_origin is
  'Origin boundary: commercial or staging-only QA fixture provenance.';
comment on column public.products.catalog_origin is
  'Origin boundary: commercial or staging-only QA fixture provenance.';
comment on function public.import_qa_fixture_catalog(uuid, text, jsonb, jsonb) is
  'STAGING ONLY: owner/admin import of 1-10 repository fixtures with UNAPPROVED_QA rights.';
comment on function public.publish_qa_fixture_product(uuid, text, boolean) is
  'STAGING ONLY: makes a QA fixture orderable without commercial rights approval.';
