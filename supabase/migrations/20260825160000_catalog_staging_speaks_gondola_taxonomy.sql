-- TABA2 · La puerta del catálogo también aprende el vocabulario de la góndola.
--
-- ## El defecto
--
-- La misma regla —qué categorías de bebida son válidas— está escrita en DOS
-- lugares, y el 2026-08-18 se actualizó uno solo.
--
-- La migración 20260818040000 («la góndola y la base dejan de hablar dos
-- idiomas distintos») amplió el vocabulario a los nombres que usa la vitrina
-- —`Mixers`, `Energizantes`, `Aguas saborizadas`, `Hielo`, `Fernet`,
-- `Aperitivos`, `Vinos`, `Espumantes`, `Destilados`— y lo hizo donde se ve:
-- los CHECK `products_verified_canonical_beverage_category` y
-- `products_verified_alcohol_coherence` de la tabla `products`.
--
-- Pero `stage_catalog_products` (20260725110000) lleva su PROPIA copia de la
-- lista, escrita adentro del cuerpo, y nadie la tocó. Quedó en los doce
-- nombres de julio.
--
-- ## Qué rompe, medido en producción el 2026-08-25
--
-- La tabla ACEPTA que un producto viva con `category = 'Mixers'`; la función
-- se NIEGA a re-escribir esa misma fila. Hoy hay 23 productos de 72 en esa
-- situación, y para ninguno de ellos existe forma de asociarle una fotografía:
--
--   · `import_catalog_batch` es la única puerta con `grant execute` que escribe
--     las seis columnas de imagen, y por dentro llama a `stage_catalog_products`;
--   · `apply_commercial_catalog_batch` sólo mueve precio, stock y publicación;
--   · el `UPDATE` directo sobre `products` está revocado para `authenticated`.
--
-- El síntoma con el que apareció:
--
--     P0001  Invalid beverage category for external_id aquarius-manzana-1500ml.
--
-- al aplicar el lote de fotografías del PR #75. De sus diecinueve productos,
-- doce pasaban y siete no: los tres Aquarius («Aguas saborizadas»), los dos
-- Paso de los Toros y la Soda Manaos («Mixers») y el Monster («Energizantes»).
-- Nadie lo había visto porque el lote anterior eran cuatro packs, y los cuatro
-- son `Gaseosas` —uno de los doce nombres que sí estaban—.
--
-- ## Lo que cambia, y lo que NO
--
-- La lista de adentro de la función pasa a ser LA MISMA que la del CHECK.
-- Nada más: el cuerpo es idéntico byte a byte en todo lo demás, verificado
-- contra la definición DESPLEGADA (`pg_get_functiondef`), no contra el archivo.
--
-- Esto no afloja ninguna compuerta, y la razón es estructural: los dos CHECK de
-- la tabla siguen corriendo en cada UPDATE, así que la función NO PUEDE admitir
-- una categoría que la tabla rechace. Ser más ancha es imposible; ser más
-- angosta —lo que estaba pasando— era el defecto.
--
-- Tampoco se toca la coherencia con el alcohol. La comprobación que vive en
-- esta función nunca miró la categoría: sólo exige que `is_alcoholic` y
-- `minimum_age` sean coherentes entre sí. La partición categoría↔alcohol vive
-- en `products_verified_alcohol_coherence` y queda intacta.
--
-- No se tocan `register_catalog_assets`, `import_catalog_batch`,
-- `publish_catalog_product`, `fail_close_verified_product_master_change`, los
-- permisos, ni una sola fila de datos.

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
    /*
     * LA MISMA LISTA QUE EL CHECK DE LA TABLA, Y POR ESO ESTÁ ESCRITA ENTERA.
     *
     * Vocabulario anterior más el de la góndola, exactamente como los declara
     * `products_verified_canonical_beverage_category` desde la 20260818040000.
     * Esta función no puede ser más ancha que ese CHECK —que sigue corriendo
     * en cada UPDATE— así que repetirlo no afloja nada; ser más ANGOSTA sí
     * rompía, y es lo que estaba pasando.
     */
    if v_category not in (
      -- Vocabulario anterior, conservado para datos ya guardados.
      'Promos',
      'Jugos',
      'Energéticas',
      'Vinos y espumantes',
      'Gins y vodkas',
      'Whisky y destilados',
      'Picadas y deli',
      'Hielo y extras',
      -- Vocabulario de la góndola. Cada uno slugifica a un id de la vitrina.
      'Gaseosas',
      'Mixers',
      'Energizantes',
      'Aguas',
      'Aguas saborizadas',
      'Isotónicas',
      'Hielo',
      'Cervezas',
      'Fernet',
      'Aperitivos',
      'Vinos',
      'Espumantes',
      'Destilados'
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

-- Los permisos no cambian: `create or replace` los conserva, y se vuelven a
-- declarar acá para que esta migración sea legible sola.
revoke all on function public.stage_catalog_products(uuid, jsonb)
from public, anon, authenticated;

comment on function public.stage_catalog_products(uuid, jsonb) is
  'Fail-closed catalog staging. Its beverage vocabulary is the same one products_verified_canonical_beverage_category accepts.';
