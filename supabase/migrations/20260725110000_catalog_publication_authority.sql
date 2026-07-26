-- Authoritative catalog publication and approved image registry.
--
-- Product imports are staged unpublished. Only an active owner/admin may
-- register approved assets and publish a product through the RPCs below.

create or replace function public.catalog_image_identity_sha256(
  p_external_id text,
  p_sku text,
  p_source_sha256 text
)
returns text
language sql
immutable
strict
set search_path = pg_catalog, public, extensions, pg_temp
as $$
  select encode(
    digest(
      'taba-image-identity-v1' || chr(10)
      || octet_length(p_external_id)::text || ':' || p_external_id || chr(10)
      || octet_length(p_sku)::text || ':' || p_sku || chr(10)
      || lower(p_source_sha256),
      'sha256'
    ),
    'hex'
  )
$$;

create or replace function public.catalog_asset_path(
  p_safe_sku text,
  p_identity_sha256 text,
  p_kind text,
  p_asset_sha256 text
)
returns text
language sql
immutable
strict
set search_path = pg_catalog, public, extensions, pg_temp
as $$
  select case p_kind
    when 'master' then
      'assets/products/' || p_safe_sku || '-' || left(lower(p_identity_sha256), 16)
      || '-' || left(lower(p_asset_sha256), 16) || '.webp'
    when 'thumbnail' then
      'assets/products/' || p_safe_sku || '-' || left(lower(p_identity_sha256), 16)
      || '-thumb-' || left(lower(p_asset_sha256), 16) || '.webp'
    else null
  end
$$;

create or replace function public.catalog_asset_binding_sha256(
  p_identity_sha256 text,
  p_kind text,
  p_source_sha256 text,
  p_asset_sha256 text,
  p_width integer,
  p_height integer,
  p_path text
)
returns text
language sql
immutable
strict
set search_path = pg_catalog, public, extensions, pg_temp
as $$
  select encode(
    digest(
      'taba-image-asset-binding-v1' || chr(10)
      || lower(p_identity_sha256) || chr(10)
      || p_kind || chr(10)
      || lower(p_source_sha256) || chr(10)
      || lower(p_asset_sha256) || chr(10)
      || p_width::text || 'x' || p_height::text || chr(10)
      || octet_length(p_path)::text || ':' || p_path,
      'sha256'
    ),
    'hex'
  )
$$;

create table if not exists public.catalog_assets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  external_id text not null,
  sku text not null,
  safe_sku text not null,
  identity_sha256 text not null,
  master_path text not null,
  master_sha256 text not null,
  master_binding_sha256 text not null,
  master_width integer not null default 1000,
  master_height integer not null default 1000,
  thumbnail_path text not null,
  thumbnail_sha256 text not null,
  thumbnail_binding_sha256 text not null,
  thumbnail_width integer not null default 400,
  thumbnail_height integer not null default 400,
  source_sha256 text not null,
  source_url text not null,
  rights_status text not null,
  rights_reference text not null,
  approved_at timestamptz not null,
  approved_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint catalog_assets_business_external_id_key unique (business_id, external_id),
  constraint catalog_assets_business_sku_key unique (business_id, sku),
  constraint catalog_assets_external_id_present check (btrim(external_id) <> ''),
  constraint catalog_assets_sku_present check (btrim(sku) <> ''),
  constraint catalog_assets_safe_sku_valid check (safe_sku ~ '^[a-z0-9_-]{1,80}$'),
  constraint catalog_assets_master_path_safe check (
    master_path ~ '^assets/products/[a-z0-9_-]+[.]webp$'
    and strpos(master_path, '..') = 0
  ),
  constraint catalog_assets_thumbnail_path_safe check (
    thumbnail_path ~ '^assets/products/[a-z0-9_-]+[.]webp$'
    and strpos(thumbnail_path, '..') = 0
    and thumbnail_path <> master_path
  ),
  constraint catalog_assets_hashes_valid check (
    identity_sha256 ~ '^[a-f0-9]{64}$'
    and master_sha256 ~ '^[a-f0-9]{64}$'
    and master_binding_sha256 ~ '^[a-f0-9]{64}$'
    and thumbnail_sha256 ~ '^[a-f0-9]{64}$'
    and thumbnail_binding_sha256 ~ '^[a-f0-9]{64}$'
    and source_sha256 ~ '^[a-f0-9]{64}$'
  ),
  constraint catalog_assets_identity_binding_valid check (
    identity_sha256 = public.catalog_image_identity_sha256(
      external_id,
      sku,
      source_sha256
    )
    and master_path = public.catalog_asset_path(
      safe_sku,
      identity_sha256,
      'master',
      master_sha256
    )
    and thumbnail_path = public.catalog_asset_path(
      safe_sku,
      identity_sha256,
      'thumbnail',
      thumbnail_sha256
    )
    and master_binding_sha256 = public.catalog_asset_binding_sha256(
      identity_sha256,
      'master',
      source_sha256,
      master_sha256,
      master_width,
      master_height,
      master_path
    )
    and thumbnail_binding_sha256 = public.catalog_asset_binding_sha256(
      identity_sha256,
      'thumbnail',
      source_sha256,
      thumbnail_sha256,
      thumbnail_width,
      thumbnail_height,
      thumbnail_path
    )
  ),
  constraint catalog_assets_dimensions_exact check (
    master_width = 1000
    and master_height = 1000
    and thumbnail_width = 400
    and thumbnail_height = 400
  ),
  constraint catalog_assets_source_https check (lower(source_url) ~ '^https://'),
  constraint catalog_assets_rights_valid check (
    rights_status in ('PROPIO', 'LICENCIA_COMERCIAL', 'PERMISO_DOCUMENTADO')
    and btrim(rights_reference) <> ''
  )
);

alter table public.products
  add column if not exists catalog_asset_id uuid references public.catalog_assets(id) on delete restrict;
alter table public.products add column if not exists image_sha256 text;
alter table public.products add column if not exists image_thumbnail_url text;
alter table public.products add column if not exists image_thumbnail_sha256 text;
alter table public.products add column if not exists source_image_sha256 text;
alter table public.products add column if not exists variant text;
alter table public.products add column if not exists capacity_value numeric;
alter table public.products add column if not exists capacity_unit text;

alter table public.products
  drop constraint if exists products_catalog_structured_capacity;
alter table public.products
  add constraint products_catalog_structured_capacity check (
    (
      variant is null
      and capacity_value is null
      and capacity_unit is null
    )
    or (
      variant is not null
      and btrim(variant) <> ''
      and capacity_value is not null
      and capacity_value > 0
      and capacity_unit in ('ml', 'l', 'g', 'kg', 'unidad')
    )
  );

-- Existing rows have no authoritative registry link. Preserve their source
-- data, but fail close until an owner/admin registers and republishes them.
update public.products
   set available = false,
       is_verified = false,
       verified_at = null,
       verified_by = null
 where is_verified
   and (
     external_id is null
     or btrim(external_id) = ''
     or sku is null
     or btrim(sku) = ''
     or catalog_asset_id is null
     or image_sha256 is null
     or image_thumbnail_url is null
     or image_thumbnail_sha256 is null
     or source_image_sha256 is null
     or price::text !~ '^[0-9]+([.][0-9]{1,2})?$'
     or price <= 0
     or price > 9999999999.99
     or stock is null
     or stock < 0
     or units_per_pack is null
     or units_per_pack < 1
     or sort_order is null
     or sort_order < 0
     or variant is null
     or btrim(variant) = ''
     or capacity_value is null
     or capacity_value <= 0
     or capacity_unit not in ('ml', 'l', 'g', 'kg', 'unidad')
   );

alter table public.products
  drop constraint if exists products_verified_numeric_ranges;
alter table public.products
  add constraint products_verified_numeric_ranges check (
    not is_verified
    or (
      price is not null
      and price::text ~ '^[0-9]+([.][0-9]{1,2})?$'
      and price > 0
      and price <= 9999999999.99
      and stock is not null
      and stock between 0 and 2147483647
      and units_per_pack is not null
      and units_per_pack between 1 and 2147483647
      and sort_order is not null
      and sort_order between 0 and 2147483647
      and capacity_value is not null
      and capacity_value::text ~ '^[0-9]+([.][0-9]+)?$'
      and capacity_value > 0
    )
  );

alter table public.products
  drop constraint if exists products_verified_publication_authority;
alter table public.products
  add constraint products_verified_publication_authority check (
    not is_verified
    or (
      external_id is not null
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

create or replace function public.fail_close_verified_product_master_change()
returns trigger
language plpgsql
set search_path = pg_catalog, public, extensions, pg_temp
as $$
begin
  if old.is_verified and (
    new.external_id is distinct from old.external_id
    or new.sku is distinct from old.sku
    or new.brand is distinct from old.brand
    or new.name is distinct from old.name
    or new.description is distinct from old.description
    or new.category is distinct from old.category
    or new.subcategory is distinct from old.subcategory
    or new.variant is distinct from old.variant
    or new.presentation is distinct from old.presentation
    or new.capacity_value is distinct from old.capacity_value
    or new.capacity_unit is distinct from old.capacity_unit
    or new.capacity is distinct from old.capacity
    or new.packaging_type is distinct from old.packaging_type
    or new.units_per_pack is distinct from old.units_per_pack
    or new.price is distinct from old.price
    or new.is_alcoholic is distinct from old.is_alcoholic
    or new.minimum_age is distinct from old.minimum_age
    or new.chilled is distinct from old.chilled
    or new.tags is distinct from old.tags
    or new.catalog_asset_id is distinct from old.catalog_asset_id
    or new.image_url is distinct from old.image_url
    or new.image_sha256 is distinct from old.image_sha256
    or new.image_thumbnail_url is distinct from old.image_thumbnail_url
    or new.image_thumbnail_sha256 is distinct from old.image_thumbnail_sha256
    or new.source_image_sha256 is distinct from old.source_image_sha256
  ) then
    new.available := false;
    new.is_verified := false;
    new.verified_at := null;
    new.verified_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists products_fail_close_master_change on public.products;
create trigger products_fail_close_master_change
before update on public.products
for each row execute function public.fail_close_verified_product_master_change();

create or replace function public.register_catalog_assets(
  p_business_id uuid,
  p_assets jsonb
)
returns table (
  asset_id uuid,
  registered_external_id text,
  registered_sku text
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_asset jsonb;
  v_existing public.catalog_assets%rowtype;
  v_asset_id uuid;
  v_external_id text;
  v_sku text;
  v_safe_sku text;
  v_identity_sha256 text;
  v_master_path text;
  v_master_sha256 text;
  v_master_binding_sha256 text;
  v_thumbnail_path text;
  v_thumbnail_sha256 text;
  v_thumbnail_binding_sha256 text;
  v_source_sha256 text;
  v_source_url text;
  v_rights_status text;
  v_rights_reference text;
  v_had_existing boolean;
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can register catalog assets.';
  end if;
  if p_assets is null or jsonb_typeof(p_assets) is distinct from 'array' then
    raise exception 'Catalog assets must be a non-null JSON array.';
  end if;
  if jsonb_array_length(p_assets) < 1
     or jsonb_array_length(p_assets) > 500 then
    raise exception 'Catalog assets must be a JSON array with 1 to 500 rows.';
  end if;

  for v_asset in select value from jsonb_array_elements(p_assets)
  loop
    v_external_id := btrim(coalesce(v_asset ->> 'external_id', ''));
    v_sku := btrim(coalesce(v_asset ->> 'sku', ''));
    v_safe_sku := btrim(coalesce(v_asset ->> 'safe_sku', ''));
    v_identity_sha256 := lower(btrim(coalesce(v_asset ->> 'identity_sha256', '')));
    v_master_path := btrim(coalesce(v_asset ->> 'master_path', ''));
    v_master_sha256 := lower(btrim(coalesce(v_asset ->> 'master_sha256', '')));
    v_master_binding_sha256 := lower(
      btrim(coalesce(v_asset ->> 'master_binding_sha256', ''))
    );
    v_thumbnail_path := btrim(coalesce(v_asset ->> 'thumbnail_path', ''));
    v_thumbnail_sha256 := lower(btrim(coalesce(v_asset ->> 'thumbnail_sha256', '')));
    v_thumbnail_binding_sha256 := lower(
      btrim(coalesce(v_asset ->> 'thumbnail_binding_sha256', ''))
    );
    v_source_sha256 := lower(btrim(coalesce(v_asset ->> 'source_sha256', '')));
    v_source_url := btrim(coalesce(v_asset ->> 'source_url', ''));
    v_rights_status := btrim(coalesce(v_asset ->> 'rights_status', ''));
    v_rights_reference := btrim(coalesce(v_asset ->> 'rights_reference', ''));

    if v_external_id = '' or v_sku = ''
       or v_safe_sku !~ '^[a-z0-9_-]{1,80}$'
       or v_identity_sha256 !~ '^[a-f0-9]{64}$'
       or v_master_path !~ '^assets/products/[a-z0-9_-]+[.]webp$'
       or v_thumbnail_path !~ '^assets/products/[a-z0-9_-]+[.]webp$'
       or v_master_path = v_thumbnail_path
       or v_master_sha256 !~ '^[a-f0-9]{64}$'
       or v_master_binding_sha256 !~ '^[a-f0-9]{64}$'
       or v_thumbnail_sha256 !~ '^[a-f0-9]{64}$'
       or v_thumbnail_binding_sha256 !~ '^[a-f0-9]{64}$'
       or v_source_sha256 !~ '^[a-f0-9]{64}$'
       or lower(v_source_url) !~ '^https://'
       or v_rights_status not in ('PROPIO', 'LICENCIA_COMERCIAL', 'PERMISO_DOCUMENTADO')
       or v_rights_reference = '' then
      raise exception 'Invalid approved asset for external_id %.', v_external_id;
    end if;
    if v_identity_sha256 <> public.catalog_image_identity_sha256(
         v_external_id,
         v_sku,
         v_source_sha256
       )
       or v_master_path <> public.catalog_asset_path(
         v_safe_sku,
         v_identity_sha256,
         'master',
         v_master_sha256
       )
       or v_thumbnail_path <> public.catalog_asset_path(
         v_safe_sku,
         v_identity_sha256,
         'thumbnail',
         v_thumbnail_sha256
       )
       or v_master_binding_sha256 <> public.catalog_asset_binding_sha256(
         v_identity_sha256,
         'master',
         v_source_sha256,
         v_master_sha256,
         1000,
         1000,
         v_master_path
       )
       or v_thumbnail_binding_sha256 <> public.catalog_asset_binding_sha256(
         v_identity_sha256,
         'thumbnail',
         v_source_sha256,
         v_thumbnail_sha256,
         400,
         400,
         v_thumbnail_path
       ) then
      raise exception 'Asset identity binding mismatch for external_id %.', v_external_id;
    end if;

    select *
      into v_existing
      from public.catalog_assets ca
     where ca.business_id = p_business_id
       and ca.external_id = v_external_id
     for update;
    v_had_existing := found;

    if v_had_existing and row(
      v_existing.sku,
      v_existing.safe_sku,
      v_existing.identity_sha256,
      v_existing.master_path,
      v_existing.master_sha256,
      v_existing.master_binding_sha256,
      v_existing.thumbnail_path,
      v_existing.thumbnail_sha256,
      v_existing.thumbnail_binding_sha256,
      v_existing.source_sha256,
      v_existing.source_url,
      v_existing.rights_status,
      v_existing.rights_reference
    ) is distinct from row(
      v_sku,
      v_safe_sku,
      v_identity_sha256,
      v_master_path,
      v_master_sha256,
      v_master_binding_sha256,
      v_thumbnail_path,
      v_thumbnail_sha256,
      v_thumbnail_binding_sha256,
      v_source_sha256,
      v_source_url,
      v_rights_status,
      v_rights_reference
    ) then
      update public.products
         set available = false,
             is_verified = false,
             verified_at = null,
             verified_by = null
       where catalog_asset_id = v_existing.id;
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
      thumbnail_path,
      thumbnail_sha256,
      thumbnail_binding_sha256,
      source_sha256,
      source_url,
      rights_status,
      rights_reference,
      approved_at,
      approved_by,
      updated_at
    ) values (
      p_business_id,
      v_external_id,
      v_sku,
      v_safe_sku,
      v_identity_sha256,
      v_master_path,
      v_master_sha256,
      v_master_binding_sha256,
      v_thumbnail_path,
      v_thumbnail_sha256,
      v_thumbnail_binding_sha256,
      v_source_sha256,
      v_source_url,
      v_rights_status,
      v_rights_reference,
      statement_timestamp(),
      auth.uid(),
      statement_timestamp()
    )
    on conflict (business_id, external_id) do update
      set sku = excluded.sku,
          safe_sku = excluded.safe_sku,
          identity_sha256 = excluded.identity_sha256,
          master_path = excluded.master_path,
          master_sha256 = excluded.master_sha256,
          master_binding_sha256 = excluded.master_binding_sha256,
          thumbnail_path = excluded.thumbnail_path,
          thumbnail_sha256 = excluded.thumbnail_sha256,
          thumbnail_binding_sha256 = excluded.thumbnail_binding_sha256,
          source_sha256 = excluded.source_sha256,
          source_url = excluded.source_url,
          rights_status = excluded.rights_status,
          rights_reference = excluded.rights_reference,
          approved_at = statement_timestamp(),
          approved_by = auth.uid(),
          updated_at = statement_timestamp()
    returning id into v_asset_id;

    asset_id := v_asset_id;
    registered_external_id := v_external_id;
    registered_sku := v_sku;
    return next;
  end loop;
end;
$$;

create or replace function public.stage_catalog_products(
  p_business_id uuid,
  p_products jsonb
)
returns table (
  product_id uuid,
  staged_external_id text,
  staged_sku text,
  staged_is_verified boolean,
  staged_available boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_product jsonb;
  v_asset public.catalog_assets%rowtype;
  v_product_id uuid;
  v_external_id text;
  v_sku text;
  v_category text;
  v_variant text;
  v_capacity_value numeric;
  v_capacity_unit text;
  v_units_per_pack integer;
  v_price numeric(12, 2);
  v_stock integer;
  v_sort_order integer;
  v_is_alcoholic boolean;
  v_minimum_age integer;
  v_tags text[];
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can stage catalog products.';
  end if;
  if p_products is null or jsonb_typeof(p_products) is distinct from 'array' then
    raise exception 'Catalog products must be a non-null JSON array.';
  end if;
  if jsonb_array_length(p_products) < 1
     or jsonb_array_length(p_products) > 500 then
    raise exception 'Catalog products must be a JSON array with 1 to 500 rows.';
  end if;

  for v_product in select value from jsonb_array_elements(p_products)
  loop
    v_external_id := btrim(coalesce(v_product ->> 'external_id', ''));
    v_sku := btrim(coalesce(v_product ->> 'sku', ''));
    v_category := btrim(coalesce(v_product ->> 'category', ''));
    v_variant := btrim(coalesce(v_product ->> 'variant', ''));
    v_capacity_unit := lower(btrim(coalesce(v_product ->> 'capacity_unit', '')));
    if v_external_id = '' or v_sku = ''
       or btrim(coalesce(v_product ->> 'brand', '')) = ''
       or btrim(coalesce(v_product ->> 'name', '')) = ''
       or v_variant = ''
       or btrim(coalesce(v_product ->> 'subcategory', '')) = ''
       or coalesce(v_product ->> 'capacity_value', '') !~ '^[0-9]+([.][0-9]+)?$'
       or v_capacity_unit not in ('ml', 'l', 'g', 'kg', 'unidad')
       or btrim(coalesce(v_product ->> 'packaging_type', '')) = '' then
      raise exception 'Missing catalog master data for external_id %.', v_external_id;
    end if;
    v_capacity_value := (v_product ->> 'capacity_value')::numeric;
    if v_capacity_value <= 0 then
      raise exception 'Invalid capacity for external_id %.', v_external_id;
    end if;
    if coalesce(v_product ->> 'price', '') !~ '^[0-9]+([.][0-9]{1,2})?$' then
      raise exception 'Invalid price format for external_id %.', v_external_id;
    end if;
    if coalesce(v_product ->> 'stock', '') !~ '^[0-9]+$'
       or coalesce(v_product ->> 'sort_order', '') !~ '^[0-9]+$'
       or coalesce(v_product ->> 'units_per_pack', '') !~ '^[1-9][0-9]*$' then
      raise exception 'Invalid PostgreSQL integer format for external_id %.', v_external_id;
    end if;
    if (v_product ->> 'price')::numeric <= 0
       or (v_product ->> 'price')::numeric > 9999999999.99 then
      raise exception 'Invalid numeric price for external_id %.', v_external_id;
    end if;
    if (v_product ->> 'stock')::numeric > 2147483647
       or (v_product ->> 'sort_order')::numeric > 2147483647
       or (v_product ->> 'units_per_pack')::numeric > 2147483647 then
      raise exception 'Invalid PostgreSQL integer range for external_id %.', v_external_id;
    end if;
    v_price := (v_product ->> 'price')::numeric;
    v_stock := (v_product ->> 'stock')::integer;
    v_sort_order := (v_product ->> 'sort_order')::integer;
    v_units_per_pack := (v_product ->> 'units_per_pack')::integer;
    if v_category not in (
      'Promos',
      'Gaseosas',
      'Aguas',
      'Jugos',
      'Energéticas',
      'Isotónicas',
      'Cervezas',
      'Vinos y espumantes',
      'Gins y vodkas',
      'Whisky y destilados',
      'Picadas y deli',
      'Hielo y extras'
    ) then
      raise exception 'Invalid beverage category for external_id %.', v_external_id;
    end if;
    if jsonb_typeof(v_product -> 'is_alcoholic') <> 'boolean'
       or jsonb_typeof(v_product -> 'chilled') <> 'boolean'
       or jsonb_typeof(v_product -> 'is_active') <> 'boolean'
       or jsonb_typeof(v_product -> 'tags') <> 'array' then
      raise exception 'Invalid typed catalog fields for external_id %.', v_external_id;
    end if;

    v_is_alcoholic := (v_product ->> 'is_alcoholic')::boolean;
    if nullif(v_product ->> 'minimum_age', '') is null then
      v_minimum_age := null;
    elsif coalesce(v_product ->> 'minimum_age', '') !~ '^[0-9]+$' then
      raise exception 'Invalid minimum_age format for external_id %.', v_external_id;
    elsif (v_product ->> 'minimum_age')::numeric > 2147483647 then
      raise exception 'Invalid minimum_age integer range for external_id %.', v_external_id;
    else
      v_minimum_age := (v_product ->> 'minimum_age')::integer;
    end if;
    if (v_is_alcoholic and (v_minimum_age is null or v_minimum_age not between 18 and 99))
       or (not v_is_alcoholic and v_minimum_age is not null) then
      raise exception 'Invalid alcohol age for external_id %.', v_external_id;
    end if;

    select *
      into v_asset
      from public.catalog_assets ca
     where ca.business_id = p_business_id
       and ca.external_id = v_external_id
       and ca.sku = v_sku
     for share;
    if not found then
      raise exception 'No approved asset for external_id % and SKU %.', v_external_id, v_sku;
    end if;

    select coalesce(array_agg(value order by value), '{}'::text[])
      into v_tags
      from jsonb_array_elements_text(v_product -> 'tags');

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
      updated_at
    ) values (
      p_business_id,
      v_external_id,
      v_sku,
      btrim(v_product ->> 'brand'),
      btrim(v_product ->> 'name'),
      nullif(btrim(coalesce(v_product ->> 'description', '')), ''),
      v_category,
      btrim(v_product ->> 'subcategory'),
      v_variant,
      v_variant,
      v_capacity_value,
      v_capacity_unit,
      v_capacity_value::text || ' ' || v_capacity_unit,
      btrim(v_product ->> 'packaging_type'),
      v_units_per_pack,
      v_price,
      v_stock,
      (v_product ->> 'chilled')::boolean,
      v_is_alcoholic,
      v_minimum_age,
      v_sort_order,
      v_asset.master_path,
      v_asset.master_sha256,
      v_asset.thumbnail_path,
      v_asset.thumbnail_sha256,
      v_asset.source_sha256,
      v_asset.id,
      v_tags,
      (v_product ->> 'is_active')::boolean,
      false,
      false,
      null,
      null,
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
          updated_at = statement_timestamp()
    returning id into v_product_id;

    product_id := v_product_id;
    staged_external_id := v_external_id;
    staged_sku := v_sku;
    staged_is_verified := false;
    staged_available := false;
    return next;
  end loop;
end;
$$;

-- One RPC call is one PostgreSQL transaction: if asset registration, product
-- staging, identity reconciliation or cardinality validation fails, every
-- mutation performed by this function is rolled back.
create or replace function public.import_catalog_batch(
  p_business_id uuid,
  p_assets jsonb,
  p_products jsonb
)
returns table (
  product_id uuid,
  staged_external_id text,
  staged_sku text,
  staged_is_verified boolean,
  staged_available boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_asset_count integer;
  v_product_count integer;
  v_distinct_asset_external_ids integer;
  v_distinct_asset_skus integer;
  v_distinct_product_external_ids integer;
  v_distinct_product_skus integer;
  v_registered_count integer;
  v_staged_count integer;
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can import a catalog batch.';
  end if;

  if p_assets is null or jsonb_typeof(p_assets) is distinct from 'array' then
    raise exception 'Catalog assets must be a non-null JSON array.';
  end if;
  if p_products is null or jsonb_typeof(p_products) is distinct from 'array' then
    raise exception 'Catalog products must be a non-null JSON array.';
  end if;
  v_asset_count := jsonb_array_length(p_assets);
  v_product_count := jsonb_array_length(p_products);
  if v_asset_count < 1 or v_asset_count > 500
     or v_product_count < 1 or v_product_count > 500 then
    raise exception 'Catalog import must contain 1 to 500 assets and products.';
  end if;
  if v_asset_count <> v_product_count then
    raise exception 'Catalog asset/product cardinality mismatch.';
  end if;

  select count(distinct (value ->> 'external_id')),
         count(distinct (value ->> 'sku'))
    into v_distinct_asset_external_ids, v_distinct_asset_skus
    from jsonb_array_elements(p_assets);
  select count(distinct (value ->> 'external_id')),
         count(distinct (value ->> 'sku'))
    into v_distinct_product_external_ids, v_distinct_product_skus
    from jsonb_array_elements(p_products);
  if v_distinct_asset_external_ids <> v_asset_count
     or v_distinct_asset_skus <> v_asset_count
     or v_distinct_product_external_ids <> v_product_count
     or v_distinct_product_skus <> v_product_count then
    raise exception 'Catalog import contains duplicate asset/product identities.';
  end if;

  if exists (
    with asset_identities as (
      select value ->> 'external_id' as external_id, value ->> 'sku' as sku
        from jsonb_array_elements(p_assets)
    ),
    product_identities as (
      select value ->> 'external_id' as external_id, value ->> 'sku' as sku
        from jsonb_array_elements(p_products)
    )
    select external_id, sku from asset_identities
    except
    select external_id, sku from product_identities
  ) or exists (
    with asset_identities as (
      select value ->> 'external_id' as external_id, value ->> 'sku' as sku
        from jsonb_array_elements(p_assets)
    ),
    product_identities as (
      select value ->> 'external_id' as external_id, value ->> 'sku' as sku
        from jsonb_array_elements(p_products)
    )
    select external_id, sku from product_identities
    except
    select external_id, sku from asset_identities
  ) then
    raise exception 'Catalog assets and products must have identical identities.';
  end if;

  select count(*)
    into v_registered_count
    from public.register_catalog_assets(p_business_id, p_assets);
  if v_registered_count <> v_asset_count then
    raise exception 'Catalog asset registration cardinality mismatch.';
  end if;

  return query
    select staged.product_id,
           staged.staged_external_id,
           staged.staged_sku,
           staged.staged_is_verified,
           staged.staged_available
      from public.stage_catalog_products(p_business_id, p_products) staged;
  get diagnostics v_staged_count = row_count;
  if v_staged_count <> v_product_count then
    raise exception 'Catalog product staging cardinality mismatch.';
  end if;
end;
$$;

create or replace function public.publish_catalog_product(
  p_business_id uuid,
  p_external_id text,
  p_available boolean default false
)
returns table (
  product_id uuid,
  published_external_id text,
  published_sku text,
  published_is_verified boolean,
  published_available boolean,
  published_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_product public.products%rowtype;
  v_asset public.catalog_assets%rowtype;
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can publish catalog products.';
  end if;

  select *
    into v_product
    from public.products p
   where p.business_id = p_business_id
     and p.external_id = btrim(p_external_id)
   for update;
  if not found then raise exception 'Catalog product not found.'; end if;

  if btrim(coalesce(v_product.variant, '')) = ''
     or v_product.capacity_value is null
     or v_product.capacity_value <= 0
     or v_product.capacity_unit not in ('ml', 'l', 'g', 'kg', 'unidad')
     or v_product.presentation is distinct from v_product.variant
     or v_product.capacity is distinct from (
       v_product.capacity_value::text || ' ' || v_product.capacity_unit
     ) then
    raise exception 'Catalog product has invalid structured presentation or capacity.';
  end if;

  select *
    into v_asset
    from public.catalog_assets ca
   where ca.id = v_product.catalog_asset_id
     and ca.business_id = p_business_id
     and ca.external_id = v_product.external_id
     and ca.sku = v_product.sku;
  if not found
     or v_product.image_url is distinct from v_asset.master_path
     or v_product.image_sha256 is distinct from v_asset.master_sha256
     or v_product.image_thumbnail_url is distinct from v_asset.thumbnail_path
     or v_product.image_thumbnail_sha256 is distinct from v_asset.thumbnail_sha256
     or v_product.source_image_sha256 is distinct from v_asset.source_sha256
     then
    raise exception 'Catalog product asset authority does not match.';
  end if;

  update public.products p
     set is_verified = true,
         verified_at = statement_timestamp(),
         verified_by = auth.uid(),
         available = coalesce(p_available, false) and p.is_active and coalesce(p.stock, 0) > 0,
         updated_at = statement_timestamp()
   where p.id = v_product.id
  returning
    p.id,
    p.external_id,
    p.sku,
    p.is_verified,
    p.available,
    p.verified_at
  into
    product_id,
    published_external_id,
    published_sku,
    published_is_verified,
    published_available,
    published_at;
  return next;
end;
$$;

create or replace function public.unpublish_catalog_product(
  p_business_id uuid,
  p_external_id text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_updated integer;
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can unpublish catalog products.';
  end if;
  update public.products p
     set available = false,
         is_verified = false,
         verified_at = null,
         verified_by = null,
         updated_at = statement_timestamp()
   where p.business_id = p_business_id
     and p.external_id = btrim(p_external_id);
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

alter table public.catalog_assets enable row level security;
drop policy if exists "catalog team reads approved assets" on public.catalog_assets;
create policy "catalog team reads approved assets"
on public.catalog_assets for select
to authenticated
using (public.has_business_role(business_id, array['owner', 'admin', 'staff']));

revoke all privileges on table public.catalog_assets from public, anon, authenticated;
grant select on table public.catalog_assets to authenticated;

-- Direct clients can only operate stock/visibility metadata. Creation, master
-- changes, verification and verifier stamps all go through the RPCs above.
revoke insert, update on table public.products from authenticated;
grant update (stock, available, is_active, sort_order)
on table public.products to authenticated;

revoke all on function public.fail_close_verified_product_master_change()
from public, anon, authenticated;
revoke all on function public.register_catalog_assets(uuid, jsonb)
from public, anon, authenticated;
revoke all on function public.stage_catalog_products(uuid, jsonb)
from public, anon, authenticated;
revoke all on function public.import_catalog_batch(uuid, jsonb, jsonb)
from public, anon, authenticated;
grant execute on function public.import_catalog_batch(uuid, jsonb, jsonb)
to authenticated;
revoke all on function public.publish_catalog_product(uuid, text, boolean)
from public, anon, authenticated;
grant execute on function public.publish_catalog_product(uuid, text, boolean)
to authenticated;
revoke all on function public.unpublish_catalog_product(uuid, text)
from public, anon, authenticated;
grant execute on function public.unpublish_catalog_product(uuid, text)
to authenticated;

comment on table public.catalog_assets is
  'Server-stamped registry binding product identity, approved source rights, deterministic master/thumbnail names and complete SHA-256 bindings.';
comment on function public.import_catalog_batch(uuid, jsonb, jsonb) is
  'Atomic owner/admin catalog import: asset registration and fail-closed product staging commit or roll back together.';
comment on function public.publish_catalog_product(uuid, text, boolean) is
  'The only authenticated path that transitions an approved catalog product to is_verified=true.';
