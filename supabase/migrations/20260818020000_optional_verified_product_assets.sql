-- TABA2 · La foto deja de ser condición para vender.
--
-- ## El defecto
--
-- `products_verified_master_data` y `products_verified_publication_authority`
-- exigían `image_url` para que un producto pudiera estar `is_verified`, y sin
-- `is_verified` no puede estar `available` —eso lo impone
-- `products_available_requires_verification`—. O sea que la cadena real era:
--
--     sin foto  ->  no verificado  ->  no disponible  ->  NO SE PUEDE VENDER
--
-- Eso acopla dos cosas que no tienen por qué viajar juntas: **la publicación
-- comercial** (que este producto existe, tiene precio, stock e identificadores)
-- y **la disponibilidad de un asset fotográfico** (que además tiene su propio
-- modelo de derechos).
--
-- Medido el 2026-08-18 en producción: el comercio no pudo abrir con cuatro
-- gaseosas reales, con precio confirmado y stock, porque no había una foto con
-- derechos para ninguna. Las 60 del manifiesto están en `pending_review`
-- —fotos de un sitio comercial ajeno— y el manifiesto entero dice
-- `publication_status: blocked`. La única salida que el contrato dejaba era
-- marcar los productos como `demo_fixture`/`UNAPPROVED_QA`, es decir, meter
-- fixtures en producción. Peor el remedio.
--
-- Y no escala: fotografiar SKU por SKU no es un plan para miles de productos.
--
-- ## Lo que cambia, y lo que NO
--
-- CAMBIA: un producto comercial puede estar verificado y disponible **sin
-- imagen**, si cumple todo lo demás. La vitrina muestra un recurso propio de
-- TABA en su lugar.
--
-- NO CAMBIA, y se refuerza:
--
--   · si hay imagen, se exigen las SEIS piezas de metadata, con sus rutas
--     `assets/products/*.webp`, sus tres SHA-256 y la miniatura distinta del
--     master. **No se admite metadata parcial**: o los seis en null, o los seis
--     completos. Un `image_url` suelto ahora falla igual que antes;
--   · los derechos siguen viviendo en `catalog_assets`
--     (`catalog_assets_rights_valid`): un asset comercial exige
--     `PROPIO` / `LICENCIA_COMERCIAL` / `PERMISO_DOCUMENTADO`, con referencia,
--     aprobador y fecha. Nada de eso se toca;
--   · las ramas `demo_fixture` / `test_only` / `staging_only` quedan idénticas.
--
-- SE AGREGA una garantía que faltaba: hasta hoy un producto `commercial` podía
-- apuntar a un asset `UNAPPROVED_QA`, porque un CHECK no puede mirar otra
-- tabla. Ahora un trigger lo impide. Esta migración deja el modelo MÁS
-- estricto en ese punto, no menos.
--
-- Forward-only. No toca 1..107.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Master data: la imagen sale de la lista de datos maestros obligatorios.
--    Todo lo demás queda exactamente igual.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.products
  drop constraint if exists products_verified_master_data;
alter table public.products
  add constraint products_verified_master_data check (
    not is_verified
    or (
      catalog_origin in ('demo_fixture', 'test_only', 'staging_only')
      and btrim(name) <> ''
      and brand is not null and btrim(brand) <> ''
      and category is not null and btrim(category) <> ''
      and subcategory is not null and btrim(subcategory) <> ''
      and presentation is not null and btrim(presentation) <> ''
      and capacity is not null and btrim(capacity) <> ''
      and packaging_type is not null and btrim(packaging_type) <> ''
      and price > 0
      and stock is not null
      and is_alcoholic is not null
      -- Un fixture sí sigue exigiendo imagen: nace de un importador que la trae.
      and image_url is not null and btrim(image_url) <> ''
    )
    or (
      catalog_origin = 'commercial'
      and btrim(name) <> ''
      and brand is not null and btrim(brand) <> ''
      and category is not null and btrim(category) <> ''
      and subcategory is not null and btrim(subcategory) <> ''
      and presentation is not null and btrim(presentation) <> ''
      and capacity is not null and btrim(capacity) <> ''
      and packaging_type is not null and btrim(packaging_type) <> ''
      and price > 0
      and stock is not null
      and is_alcoholic is not null
      and verified_at is not null
      and verified_by is not null
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Publication authority: la identidad comercial sigue siendo obligatoria;
--    la imagen pasa a ser «todo o nada».
-- ─────────────────────────────────────────────────────────────────────────────
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
      -- Identidad comercial: intacta.
      and external_id is not null and btrim(external_id) <> ''
      and sku is not null and btrim(sku) <> ''
      and variant is not null and btrim(variant) <> ''
      and capacity_value is not null and capacity_value > 0
      and capacity_unit in ('ml', 'l', 'g', 'kg', 'unidad')
      and presentation = variant
      and capacity = capacity_value::text || ' ' || capacity_unit
      and (
        -- CASO A · sin imagen. Los seis campos coherentemente nulos: no hay
        -- forma de dejar metadata a medias.
        (
          catalog_asset_id is null
          and image_url is null
          and image_sha256 is null
          and image_thumbnail_url is null
          and image_thumbnail_sha256 is null
          and source_image_sha256 is null
        )
        or
        -- CASO B · con imagen. Exactamente las garantías que ya regían.
        (
          catalog_asset_id is not null
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
      )
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Un producto comercial no puede vestirse con una imagen de QA.
--
--    Un CHECK no puede mirar `catalog_assets`, así que esto faltaba: nada
--    impedía que un producto `commercial` apuntara a un asset `UNAPPROVED_QA`.
--    El origen del asset y el del producto tienen que coincidir, y con eso el
--    modelo de derechos de `catalog_assets_rights_valid` se vuelve efectivo
--    también del lado del producto.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.assert_product_asset_origin()
returns trigger
language plpgsql
stable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_asset_origin text;
  v_rights text;
begin
  if new.catalog_asset_id is null then
    return new;
  end if;

  select a.catalog_origin, a.rights_status
    into v_asset_origin, v_rights
    from public.catalog_assets a
   where a.id = new.catalog_asset_id;

  if not found then
    raise exception 'catalogo: el asset % no existe', new.catalog_asset_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_asset_origin is distinct from new.catalog_origin then
    raise exception 'catalogo: un producto % no puede usar un asset % (asset %)',
      new.catalog_origin, v_asset_origin, new.catalog_asset_id
      using errcode = 'check_violation';
  end if;

  if new.catalog_origin = 'commercial' and v_rights = 'UNAPPROVED_QA' then
    raise exception 'catalogo: una imagen UNAPPROVED_QA no puede publicarse en un producto comercial'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.assert_product_asset_origin() from public, anon, authenticated;

drop trigger if exists products_assert_asset_origin on public.products;
create trigger products_assert_asset_origin
  before insert or update of catalog_asset_id, catalog_origin on public.products
  for each row execute function public.assert_product_asset_origin();

comment on constraint products_verified_publication_authority on public.products is
  'Un producto comercial verificado exige identidad comercial completa. La imagen es opcional: o los seis campos de asset en null, o los seis completos con rutas assets/products/*.webp y sus SHA-256. Los derechos se exigen en catalog_assets.';
