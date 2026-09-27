-- Keep the draft importer aligned with the verified store taxonomy.
create or replace function public.apply_commercial_catalog_plan(
  p_business_id uuid,
  p_creates jsonb default '[]'::jsonb,
  p_updates jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $apply_commercial_catalog_plan$
declare
  v_row jsonb;
  v_sku text;
  v_name text;
  v_category text;
  v_subcategory text;
  v_alcoholic boolean;
  v_minimum_age integer;
  v_price numeric(12, 2);
  v_stock integer;
  v_seen text[] := '{}';
  v_created integer := 0;
  v_updated integer := 0;
  v_creadas jsonb := '[]'::jsonb;
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can apply a commercial catalog plan.'
      using errcode = '42501';
  end if;
  if p_creates is null or jsonb_typeof(p_creates) is distinct from 'array'
     or p_updates is null or jsonb_typeof(p_updates) is distinct from 'array' then
    raise exception 'Both creates and updates must be JSON arrays.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_creates) > 500 then
    raise exception 'A plan proposes at most 500 new products.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_creates) = 0 and jsonb_array_length(p_updates) = 0 then
    raise exception 'A plan that decides nothing is not applied.' using errcode = '22023';
  end if;

  -- ── ALTAS ──────────────────────────────────────────────────────────────────
  for v_row in select value from jsonb_array_elements(p_creates)
  loop
    v_sku := btrim(coalesce(v_row ->> 'sku', ''));
    if v_sku !~ '^[a-z0-9][a-z0-9-]{2,79}$' then
      raise exception 'Unstable sku for a new product: %. Use lowercase letters, digits and dashes.', v_sku
        using errcode = '22023';
    end if;
    if v_sku = any (v_seen) then
      raise exception 'Duplicated new sku % in the same plan.', v_sku using errcode = '22023';
    end if;
    v_seen := v_seen || v_sku;

    -- Un fixture de QA nunca entra al catálogo comercial. Es la misma regla que
    -- ya aplica el lote de modificaciones, con el mismo patrón.
    if v_sku ~* '(-staging-only$)|(^qa[-_])|(\yqa\y)|(\y(test|prueba|sintetica|sintetico|synthetic|fixture|dummy)\y)' then
      raise exception 'Refusing a QA-looking sku in the commercial catalog: %.', v_sku
        using errcode = '22023';
    end if;
    -- El pack con el que el local se surte no es un producto de góndola.
    if v_sku ~* '-(pack|bulto|caja)-[0-9]+$' then
      raise exception 'Sku % looks like a procurement pack, not a shelf product.', v_sku
        using errcode = '22023';
    end if;

    if exists (select 1 from public.products p
                where p.business_id = p_business_id and p.sku = v_sku) then
      raise exception 'Sku % already exists for this business. A plan never overwrites by creating.', v_sku
        using errcode = '23505';
    end if;

    v_name := btrim(coalesce(v_row ->> 'name', ''));
    if char_length(v_name) not between 2 and 160 then
      raise exception 'Invalid name for new sku %.', v_sku using errcode = '22023';
    end if;

    v_category := btrim(coalesce(v_row ->> 'category', ''));
    if v_category not in (
      'Gaseosas', 'Jugos', 'Mixers', 'Energizantes', 'Aguas', 'Aguas saborizadas', 'Isotónicas', 'Hielo',
      'Cervezas', 'Fernet', 'Aperitivos', 'Vinos', 'Espumantes', 'Destilados',
      'Snacks', 'Golosinas', 'Almacén', 'Limpieza', 'Higiene personal', 'Hogar', 'Mascotas', 'Otros'
    ) then
      raise exception 'Unknown category % for new sku %.', v_category, v_sku using errcode = '22023';
    end if;

    if jsonb_typeof(v_row -> 'is_alcoholic') is distinct from 'boolean' then
      raise exception 'New sku % must declare is_alcoholic explicitly as a boolean.', v_sku
        using errcode = '22023';
    end if;
    v_alcoholic := (v_row ->> 'is_alcoholic')::boolean;

    -- La góndola y la bandera tienen que decir lo mismo: es la misma partición
    -- que exige `products_verified_alcohol_coherence`, adelantada al alta para
    -- que el producto no nazca imposible de verificar.
    if v_alcoholic <> (v_category in ('Cervezas', 'Fernet', 'Aperitivos', 'Vinos', 'Espumantes', 'Destilados')) then
      raise exception 'Category % and is_alcoholic=% disagree for new sku %.', v_category, v_alcoholic, v_sku
        using errcode = '22023';
    end if;

    if v_alcoholic then
      v_minimum_age := coalesce(nullif(btrim(coalesce(v_row ->> 'minimum_age', '')), '')::integer, 18);
      if v_minimum_age not between 18 and 99 then
        raise exception 'Invalid minimum_age for new sku %.', v_sku using errcode = '22023';
      end if;
    else
      v_minimum_age := null;
      if nullif(btrim(coalesce(v_row ->> 'minimum_age', '')), '') is not null then
        raise exception 'New sku % is not alcoholic and cannot carry a minimum age.', v_sku
          using errcode = '22023';
      end if;
    end if;

    if nullif(btrim(coalesce(v_row ->> 'price', '')), '') is null then
      v_price := null;
    elsif coalesce(v_row ->> 'price', '') !~ '^[0-9]+([.][0-9]{1,2})?$' then
      raise exception 'Invalid price format for new sku %.', v_sku using errcode = '22023';
    else
      v_price := (v_row ->> 'price')::numeric;
      if v_price <= 0 or v_price > 9999999999.99 then
        raise exception 'Invalid price value for new sku %.', v_sku using errcode = '22023';
      end if;
    end if;

    v_stock := public.commercial_catalog_parse_stock(v_row);

    -- Publicar no viaja en un alta. Si alguien lo manda igual, se dice por qué
    -- no, en vez de ignorar la clave en silencio.
    if coalesce((v_row ->> 'publish')::text, 'false') not in ('false', '') then
      raise exception 'A newly proposed product is always created hidden: publish sku % in a second pass.', v_sku
        using errcode = '22023';
    end if;

    v_subcategory := nullif(btrim(coalesce(v_row ->> 'subcategory', '')), '');
    if v_subcategory is not null and char_length(v_subcategory) > 80 then
      raise exception 'Invalid subcategory for new sku %.', v_sku using errcode = '22023';
    end if;

    insert into public.products (
      business_id, sku, external_id, name, category, subcategory,
      price, price_status, stock,
      -- Nace ACTIVO pero NO disponible y NO verificado: existe para el Panel,
      -- no existe para la góndola. `available` es lo que decide si se puede
      -- comprar, y sólo lo enciende la segunda pasada con sus compuertas.
      is_active, available, is_verified,
      is_alcoholic, minimum_age, catalog_origin
    ) values (
      p_business_id, v_sku, v_sku, v_name, v_category, v_subcategory,
      coalesce(v_price, 0),
      case when v_price is null then 'pending' else 'confirmed' end,
      v_stock,
      true, false, false,
      v_alcoholic, v_minimum_age, 'commercial'
    );

    v_created := v_created + 1;
    v_creadas := v_creadas || jsonb_build_array(jsonb_build_object(
      'sku', v_sku, 'name', v_name, 'category', v_category,
      'is_alcoholic', v_alcoholic, 'available', false, 'is_verified', false
    ));
  end loop;

  -- ── MODIFICACIONES ─────────────────────────────────────────────────────────
  -- Se delegan tal cual. La misma transacción, las mismas compuertas.
  if jsonb_array_length(p_updates) > 0 then
    select count(*) into v_updated
      from public.apply_commercial_catalog_batch(p_business_id, p_updates);
  end if;

  return jsonb_build_object(
    'ok', true,
    'created', v_created,
    'updated', v_updated,
    'rows', v_creadas
  );
end;
$apply_commercial_catalog_plan$;

create or replace function catalog_admin.import_pending_catalog(p_business_id uuid, p_rows jsonb)
returns jsonb
language plpgsql security invoker
set search_path = pg_catalog, public, catalog_admin, pg_temp
as $import_pending$
declare
  v_created integer := 0;
  v_matched integer := 0;
  v_total integer := 0;
begin
  if current_user <> 'postgres' then
    raise exception 'Admin catalog import requires the database operator.' using errcode = '42501';
  end if;
  if p_business_id <> 'e7850ad2-a447-402c-8375-3fd74e9466ba'::uuid then
    raise exception 'Wrong CP business.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.businesses b
    where b.id = p_business_id and b.status = 'closed'
      and b.ordering_enabled = false and b.alcohol_sales_enabled = false
  ) then
    raise exception 'CP safety state changed; re-audit before importing.' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) <> 46 then
    raise exception 'Exactly 46 reviewed draft candidates are required.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) e
    where jsonb_typeof(e.value) <> 'object'
       or e.value ?| array['price','price_status','stock','available','is_verified','image_url','catalog_asset_id','merchant_available']
       or e.value - array['sku','brand','name','variant','capacity_value','capacity_unit','packaging_type','category','subcategory','is_alcoholic'] <> '{}'::jsonb
  ) then
    raise exception 'Draft payload includes a commercial or unexpected field.' using errcode = '22023';
  end if;

  with candidate as (
    select * from jsonb_to_recordset(p_rows) as r(
      sku text, brand text, name text, variant text, capacity_value numeric,
      capacity_unit text, packaging_type text, category text, subcategory text, is_alcoholic boolean
    )
  )
  select count(*) into v_total from candidate c
  where c.sku ~ '^[a-z0-9][a-z0-9-]{2,79}$'
    and c.sku !~* '(^qa[-_])|(-staging-only$)|(test|prueba|synthetic|fixture|dummy)'
    and nullif(btrim(c.brand),'') is not null
    and nullif(btrim(c.name),'') is not null
    and char_length(c.name) between 2 and 160
    and nullif(btrim(c.variant),'') is not null
    and nullif(btrim(c.packaging_type),'') is not null
    and nullif(btrim(c.subcategory),'') is not null
    and c.capacity_value > 0
    and c.capacity_unit in ('ml','l','g','kg','unidad')
    and c.category in ('Gaseosas','Jugos','Mixers','Energizantes','Aguas','Aguas saborizadas','Isotónicas','Hielo',
      'Cervezas','Fernet','Aperitivos','Vinos','Espumantes','Destilados','Snacks','Golosinas','Almacén')
    and c.is_alcoholic is not null
    and c.is_alcoholic = (c.category in ('Cervezas','Fernet','Aperitivos','Vinos','Espumantes','Destilados'));
  if v_total <> 46 then raise exception 'One or more draft identities are incomplete or incoherent.' using errcode = '22023'; end if;

  with candidate as (
    select * from jsonb_to_recordset(p_rows) as r(
      sku text, brand text, name text, variant text, capacity_value numeric,
      capacity_unit text, packaging_type text, category text, subcategory text, is_alcoholic boolean
    )
  )
  select count(distinct sku) into v_total from candidate;
  if v_total <> 46 then raise exception 'Duplicate candidate SKU.' using errcode = '23505'; end if;
  with candidate as (
    select * from jsonb_to_recordset(p_rows) as r(
      sku text, brand text, name text, variant text, capacity_value numeric,
      capacity_unit text, packaging_type text, category text, subcategory text, is_alcoholic boolean
    )
  )
  select count(distinct lower(btrim(brand)) || '|' || lower(btrim(name)) || '|' ||
    lower(btrim(variant)) || '|' || capacity_value::text || '|' || capacity_unit)
    into v_total from candidate;
  if v_total <> 46 then raise exception 'Duplicate candidate presentation.' using errcode = '23505'; end if;

  -- A matching SKU may be reused, never overwritten. A name collision with a
  -- different SKU is rejected before INSERT.
  if exists (
    with candidate as (
      select * from jsonb_to_recordset(p_rows) as r(
        sku text, brand text, name text, variant text, capacity_value numeric,
        capacity_unit text, packaging_type text, category text, subcategory text, is_alcoholic boolean
      )
    )
    select 1 from candidate c join public.products p on p.business_id = p_business_id
      and lower(btrim(p.brand)) = lower(btrim(c.brand))
      and lower(btrim(p.name)) = lower(btrim(c.name))
      and lower(btrim(p.variant)) = lower(btrim(c.variant))
      and p.capacity_value = c.capacity_value and p.capacity_unit = c.capacity_unit
    where p.sku is distinct from c.sku
  ) then raise exception 'Existing product has the same identity under another SKU.' using errcode = '23505'; end if;

  insert into public.products (
    business_id, sku, external_id, brand, name, variant, presentation,
    capacity_value, capacity_unit, capacity, packaging_type, category, subcategory,
    price, price_status, stock, available, merchant_available, is_verified, is_active,
    is_alcoholic, minimum_age, catalog_origin, sort_order
  )
  select p_business_id, c.sku, c.sku, c.brand, c.name, c.variant, c.variant,
    c.capacity_value, c.capacity_unit, c.capacity_value::text || ' ' || c.capacity_unit,
    c.packaging_type, c.category, c.subcategory,
    0, 'pending', null, false, false, false, true,
    c.is_alcoholic, case when c.is_alcoholic then 18 else null end, 'commercial', 0
  from jsonb_to_recordset(p_rows) as c(
    sku text, brand text, name text, variant text, capacity_value numeric,
    capacity_unit text, packaging_type text, category text, subcategory text, is_alcoholic boolean
  )
  on conflict (business_id, sku) do nothing;
  get diagnostics v_created = row_count;

  with candidate as (
    select * from jsonb_to_recordset(p_rows) as r(
      sku text, brand text, name text, variant text, capacity_value numeric,
      capacity_unit text, packaging_type text, category text, subcategory text, is_alcoholic boolean
    )
  )
  select count(*) into v_matched
  from candidate c join public.products p on p.business_id = p_business_id and p.sku = c.sku
  where p.external_id = c.sku and p.brand = c.brand and p.name = c.name
    and p.variant = c.variant and p.presentation = c.variant
    and p.capacity_value = c.capacity_value and p.capacity_unit = c.capacity_unit
    and p.capacity = c.capacity_value::text || ' ' || c.capacity_unit
    and p.packaging_type = c.packaging_type and p.category = c.category and p.subcategory = c.subcategory
    and p.is_alcoholic = c.is_alcoholic and p.minimum_age is not distinct from
      case when c.is_alcoholic then 18 else null end
    and p.catalog_origin = 'commercial' and p.price_status = 'pending' and p.price = 0
    and p.stock is null and p.available = false and p.merchant_available = false
    and p.is_verified = false and p.is_active = true
    and p.image_url is null and p.catalog_asset_id is null;
  if v_matched <> 46 then
    raise exception 'An existing draft differs from the reviewed candidate; no rows imported.' using errcode = '23505';
  end if;
  return jsonb_build_object('created',v_created,'reused',46-v_created,'matched',v_matched);
end;
$import_pending$;
