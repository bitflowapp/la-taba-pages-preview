-- ─────────────────────────────────────────────────────────────────────────────
-- LA PUERTA COMERCIAL SE QUEDÓ EN EL VOCABULARIO DE ANTES DE LA 108
--
-- ## El defecto
-- --------------
-- La migración 20260818020000 («La foto deja de ser condición para vender»)
-- reescribió `products_verified_publication_authority` para que un producto
-- comercial pudiera quedar verificado SIN imagen —las seis columnas de imagen
-- en null, todo lo demás en regla— y sólo exigiera el contrato completo
-- (asset con derechos, hashes, binding) cuando SÍ hay imagen. Esa es hoy la
-- autoridad real de la base.
--
-- `apply_commercial_catalog_batch` —la única puerta seguray no privilegiada
-- para mover precio, stock y publicación de un producto que YA existe— es de
-- ANTES de esa migración (20260809050000, con un ajuste de price_status en
-- 20260809070000) y nunca se enteró. Su propio `v_asset_ok` sigue exigiendo
-- una fila de `catalog_assets` que haga match, sin ninguna rama para «no hay
-- imagen y está bien así»:
--
--     select exists (
--       select 1 from public.catalog_assets ca
--        where ca.id = v_product.catalog_asset_id ...
--     ) into v_asset_ok;
--     ...
--     if not v_asset_ok then
--       raise exception 'Refusing to publish sku % without matching approved asset.';
--
-- Con `catalog_asset_id is null` (el estado normal de un producto sin foto,
-- que es válido desde la 108) esa subconsulta nunca encuentra nada:
-- `v_asset_ok` da `false` siempre, y publicar —o REpublicar después de subir
-- el stock— queda bloqueado para cualquier producto sin foto, aunque tenga
-- precio confirmado, stock real y esté activo. Es el mismo defecto que ya
-- estaba documentado para `import_catalog_batch`/`stage_catalog_products`
-- (ver artifacts/taba2-retail-normalization/RETAIL-DATA-REQUIRED.md), pero en
-- la puerta que se usa para REPUBLICAR, no para dar de alta. Encontrado el
-- 2026-08-19 tratando de poner disponibles, con stock real, los 4 SKU
-- minoristas de `feature/taba2-retail-catalog-normalization` — los cuatro
-- usan el recurso propio de TABA a propósito, igual que 52 de los 56
-- productos que ya están vivos.
--
-- `publish_catalog_product` (20260725110000) tiene el mismo defecto y NO se
-- toca acá: no es la puerta que se usa hoy para este flujo, y tocarla es
-- decisión de otra misión.
--
-- ## El contrato correcto, citado literal de la 108
-- ---------------------------------------------------
-- `products_verified_publication_authority`, rama `catalog_origin =
-- 'commercial'`, ya distingue exactamente dos casos válidos y ninguno más:
--
--   CASO A · sin imagen — las SEIS columnas coherentemente en null:
--     catalog_asset_id is null and image_url is null and image_sha256 is null
--     and image_thumbnail_url is null and image_thumbnail_sha256 is null
--     and source_image_sha256 is null
--
--   CASO B · con imagen — formato completo, todo o nada:
--     catalog_asset_id is not null and image_url is not null
--     and image_url ~ '^assets/products/[a-z0-9_-]+[.]webp$' and ...
--     (los seis campos, con sus regex de hash y `thumbnail <> master`)
--
-- Eso es lo que puede vivir en la COLUMNA. Lo que la columna no puede
-- verificar —porque es otra tabla— es que esos valores sean de verdad los que
-- un asset real y aprobado tiene: eso lo impone `catalog_assets_rights_valid`
-- sobre la fila de `catalog_assets`, no sobre `products`. Y esa restricción
-- hace que la pregunta «¿este asset está aprobado, con derechos válidos, sin
-- pending_review ni referencia de retailer no autorizado?» ya esté contestada
-- por el simple hecho de que la fila EXISTA en `catalog_assets` con
-- `catalog_origin = 'commercial'`:
--
--     constraint catalog_assets_rights_valid check (
--       (catalog_origin = 'commercial' and rights_status in
--         ('PROPIO','LICENCIA_COMERCIAL','PERMISO_DOCUMENTADO')
--         and btrim(rights_reference) <> '' and approved_at is not null
--         and approved_by is not null)
--       or (catalog_origin in ('demo_fixture','test_only','staging_only')
--         and rights_status = 'UNAPPROVED_QA' ...)
--     )
--
-- No existe un estado intermedio: una fila `catalog_assets` comercial es
-- imposible de crear sin derechos válidos, referencia, aprobador y fecha. Los
-- estados «pending_review» / «RETAILER_SOLO_REFERENCIA» que el pipeline de
-- imágenes maneja (ver js/ui.js PUBLISHABLE_IMAGE_RIGHTS) son de ANTES de
-- llegar a esta tabla —candidatos en el manifiesto—, nunca de una fila que ya
-- está acá. Por eso «existe una fila que hace binding» alcanza para dar por
-- ciertos «aprobado» y «derechos válidos»: no hace falta, y sería redundante,
-- volver a preguntar por un `rights_status`/`review_status` que la propia
-- tabla ya garantiza.
--
-- ## Lo que cambia
-- -----------------
-- Se agrega UNA función nueva, `product_commercial_image_valid`, que es la
-- MISMA fórmula de arriba (CASO A / CASO B, literal) más el binding contra
-- `catalog_assets` que sólo una función puede mirar. No es una segunda
-- definición del contrato: es la primera vez que el contrato de la 108 se
-- puede invocar en vez de copiarse a mano. `apply_commercial_catalog_batch`
-- pasa a llamarla en el único lugar donde antes recalculaba `v_asset_ok` con
-- su propia subconsulta —y esa misma variable ya alimentaba tanto la
-- publicación normal como la republicación automática, así que las dos se
-- corrigen con el mismo cambio—.
--
-- Tres endurecimientos chicos, deliberados, en la misma función nueva —van en
-- la dirección de exigir MÁS, nunca menos, así que no son un relajamiento—:
-- el binding ahora también exige `ca.catalog_origin = 'commercial'` (antes no
-- se pedía; hoy no puede fallar porque el trigger
-- `assert_product_asset_origin` ya lo garantiza al asociar la foto, pero
-- verificarlo acá también no depende de esa garantía externa), exige
-- `ca.external_id = p_product.external_id` (lo que ya exige
-- `publish_catalog_product`, y `apply_commercial_catalog_batch` no pedía) y
-- suma el binding de `source_image_sha256` contra `ca.source_sha256` (el
-- único de los cinco hashes que `v_asset_ok` no comparaba).
--
-- ## Lo que NO cambia
-- --------------------
--   · publicar sin precio confirmado, sin stock > 0 o con el producto inactivo
--     sigue rechazado exactamente igual;
--   · un producto CON imagen sigue exigiendo el contrato completo, sin ningún
--     estado intermedio — ni una de las seis columnas puede faltar ni sobrar;
--   · `products_verified_publication_authority` no se toca: sigue siendo la
--     autoridad de la COLUMNA. Esta migración no la redefine, sólo le agrega
--     una función que dice lo mismo y que otra función puede invocar;
--   · ninguna fila de `products` ni de `catalog_assets` se toca. Esto es
--     código, no datos;
--   · `alcohol_sales_enabled`, RLS y los grants existentes: intactos. No hay
--     ningún `grant`/`revoke` nuevo sobre tablas, sólo el `execute` de la
--     función nueva, con el mismo patrón que ya usa el resto del archivo.
--
-- Forward-only. No toca 1..110.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. La autoridad de imagen de la 108, invocable — no reescrita a mano otra vez.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.product_commercial_image_valid(
  p_product public.products
)
returns boolean
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $$
  select
    -- CASO A · sin imagen. Válido desde la 108: las seis columnas coherentemente
    -- en null. No exige nada de catalog_assets porque no hay nada que ligar.
    (
      p_product.catalog_asset_id is null
      and p_product.image_url is null
      and p_product.image_sha256 is null
      and p_product.image_thumbnail_url is null
      and p_product.image_thumbnail_sha256 is null
      and p_product.source_image_sha256 is null
    )
    or
    -- CASO B · con imagen. Mismo formato que products_verified_publication_authority
    -- exige en la columna, más el binding real contra catalog_assets —existencia,
    -- negocio, origen comercial (o sea: catalog_assets_rights_valid ya certificó
    -- derechos válidos, referencia, aprobador y fecha), external_id, sku y los
    -- cinco hashes/paths— que un CHECK de una sola tabla no puede mirar.
    (
      p_product.catalog_asset_id is not null
      and p_product.image_url is not null
      and p_product.image_url ~ '^assets/products/[a-z0-9_-]+[.]webp$'
      and p_product.image_sha256 is not null
      and p_product.image_sha256 ~ '^[a-f0-9]{64}$'
      and p_product.image_thumbnail_url is not null
      and p_product.image_thumbnail_url ~ '^assets/products/[a-z0-9_-]+[.]webp$'
      and p_product.image_thumbnail_url <> p_product.image_url
      and p_product.image_thumbnail_sha256 is not null
      and p_product.image_thumbnail_sha256 ~ '^[a-f0-9]{64}$'
      and p_product.source_image_sha256 is not null
      and p_product.source_image_sha256 ~ '^[a-f0-9]{64}$'
      and exists (
        select 1
          from public.catalog_assets ca
         where ca.id = p_product.catalog_asset_id
           and ca.business_id = p_product.business_id
           and ca.catalog_origin = 'commercial'
           and ca.external_id = p_product.external_id
           and ca.sku = p_product.sku
           and ca.master_path = p_product.image_url
           and ca.master_sha256 = p_product.image_sha256
           and ca.thumbnail_path = p_product.image_thumbnail_url
           and ca.thumbnail_sha256 = p_product.image_thumbnail_sha256
           and ca.source_sha256 = p_product.source_image_sha256
      )
    )
$$;

revoke all on function public.product_commercial_image_valid(public.products)
from public, anon;
grant execute on function public.product_commercial_image_valid(public.products)
to authenticated;

comment on function public.product_commercial_image_valid(public.products) is
  'Misma semántica de imagen que products_verified_publication_authority (migración 108) para catalog_origin = commercial: sin imagen, las seis columnas en null; con imagen, formato completo Y binding real contra catalog_assets. catalog_assets_rights_valid ya garantiza que toda fila comercial ahí tiene derechos válidos y está aprobada — no existe un estado pending_review dentro de esa tabla — así que la existencia de la fila con el binding correcto alcanza para dar por ciertos "aprobado" y "derechos válidos".';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. apply_commercial_catalog_batch pasa a preguntarle a la función de arriba
--    en vez de recalcular su propio v_asset_ok. Mismo nombre, misma firma
--    (uuid, jsonb) → create or replace, sin ventana sin función.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.apply_commercial_catalog_batch(
  p_business_id uuid,
  p_rows jsonb
)
returns table (
  applied_sku text,
  applied_price numeric(12, 2),
  applied_stock integer,
  applied_available boolean,
  applied_is_verified boolean,
  applied_republished boolean,
  applied_price_status text
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_row jsonb;
  v_sku text;
  v_product public.products%rowtype;
  v_price numeric(12, 2);
  v_stock integer;
  v_publish boolean;
  v_price_pending boolean;
  v_next_price numeric(12, 2);
  v_next_stock integer;
  v_next_available boolean;
  v_next_verified boolean;
  v_next_price_status text;
  v_was_published boolean;
  v_asset_ok boolean;
  v_seen text[] := '{}';
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can apply commercial catalog values.';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Commercial rows must be a non-null JSON array.';
  end if;
  if jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 500 then
    raise exception 'Commercial rows must be a JSON array with 1 to 500 entries.';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_sku := btrim(coalesce(v_row ->> 'sku', ''));
    if v_sku = '' then
      raise exception 'Commercial row without sku.';
    end if;
    if v_sku = any (v_seen) then
      raise exception 'Duplicated sku % in the same batch.', v_sku;
    end if;
    v_seen := v_seen || v_sku;

    if v_sku ~* '(-staging-only$)|(^qa[-_])|(\yqa\y)|(\y(test|prueba|sintetica|sintetico|synthetic|fixture|dummy)\y)' then
      raise exception 'Refusing a QA-looking sku in the commercial catalog: %.', v_sku;
    end if;

    select * into v_product
      from public.products p
     where p.business_id = p_business_id
       and p.sku = v_sku
     for update;
    if not found then
      raise exception 'Unknown sku % for this business. Commercial import never creates products.', v_sku;
    end if;

    -- ── precio ────────────────────────────────────────────────────────────────
    if nullif(btrim(coalesce(v_row ->> 'price', '')), '') is null then
      v_price := null;
    elsif coalesce(v_row ->> 'price', '') !~ '^[0-9]+([.][0-9]{1,2})?$' then
      raise exception 'Invalid price format for sku %.', v_sku;
    else
      v_price := (v_row ->> 'price')::numeric;
      if v_price <= 0 or v_price > 9999999999.99 then
        raise exception 'Invalid price value for sku %: must be greater than zero.', v_sku;
      end if;
    end if;

    -- ── volver a pendiente ────────────────────────────────────────────────────
    if v_row -> 'price_pending' is null or jsonb_typeof(v_row -> 'price_pending') = 'null' then
      v_price_pending := null;
    elsif jsonb_typeof(v_row -> 'price_pending') is distinct from 'boolean' then
      raise exception 'Invalid price_pending flag for sku %.', v_sku;
    else
      v_price_pending := (v_row ->> 'price_pending')::boolean;
    end if;
    if coalesce(v_price_pending, false) and v_price is not null then
      raise exception 'Row for sku % sets a price and marks it pending at the same time.', v_sku;
    end if;

    -- ── stock ─────────────────────────────────────────────────────────────────
    if nullif(btrim(coalesce(v_row ->> 'stock', '')), '') is null then
      v_stock := null;
    elsif coalesce(v_row ->> 'stock', '') !~ '^[0-9]+$' then
      raise exception 'Invalid stock format for sku %.', v_sku;
    else
      if (v_row ->> 'stock')::numeric > 2147483647 then
        raise exception 'Invalid stock range for sku %.', v_sku;
      end if;
      v_stock := (v_row ->> 'stock')::integer;
    end if;

    -- ── publicación ───────────────────────────────────────────────────────────
    if v_row -> 'publish' is null or jsonb_typeof(v_row -> 'publish') = 'null' then
      v_publish := null;
    elsif jsonb_typeof(v_row -> 'publish') is distinct from 'boolean' then
      raise exception 'Invalid publish flag for sku %.', v_sku;
    else
      v_publish := (v_row ->> 'publish')::boolean;
    end if;

    if v_price is null and v_stock is null and v_publish is null and v_price_pending is null then
      raise exception 'Commercial row for sku % does not decide anything.', v_sku;
    end if;

    -- Cargar un precio ES confirmarlo. Marcarlo pendiente lo devuelve al otro
    -- estado. Sin ninguna de las dos cosas, el estado no se toca.
    v_next_price_status := case
      when v_price is not null then 'confirmed'
      when coalesce(v_price_pending, false) then 'pending'
      else v_product.price_status
    end;
    v_next_price := coalesce(v_price, v_product.price);
    v_next_stock := coalesce(v_stock, v_product.stock);
    v_next_verified := v_product.is_verified;
    v_was_published := v_product.is_verified and v_product.available;

    -- Un producto sin precio confirmado no puede quedar disponible, pase lo que
    -- pase con el resto de la fila.
    if v_next_price_status <> 'confirmed' or coalesce(v_next_price, 0) <= 0 then
      v_next_available := false;
    else
      v_next_available := coalesce(v_publish, v_product.available);
    end if;

    -- La autoridad de imagen de la 108, invocada — no recalculada acá.
    v_asset_ok := public.product_commercial_image_valid(v_product);

    if coalesce(v_publish, false) then
      if v_next_price_status <> 'confirmed' then
        raise exception 'Refusing to publish sku % without a confirmed price state.', v_sku;
      end if;
      if v_next_price is null or v_next_price <= 0 then
        raise exception 'Refusing to publish sku % without a price.', v_sku;
      end if;
      if coalesce(v_next_stock, 0) <= 0 then
        raise exception 'Refusing to publish sku % without stock.', v_sku;
      end if;
      if not v_product.is_active then
        raise exception 'Refusing to publish inactive sku %.', v_sku;
      end if;
      if not v_asset_ok then
        raise exception 'Refusing to publish sku %: it must have no image at all, or a complete image bound to an approved commercial asset — no partial or mismatched image state.', v_sku;
      end if;
      v_next_verified := true;
    end if;

    update public.products p
       set price = v_next_price,
           price_status = v_next_price_status,
           stock = v_next_stock,
           available = v_next_available
             and p.is_active
             and coalesce(v_next_stock, 0) > 0
             and v_next_price_status = 'confirmed'
             and coalesce(v_next_price, 0) > 0,
           is_verified = v_next_verified,
           verified_at = case
             when v_next_verified and not v_product.is_verified then statement_timestamp()
             else p.verified_at
           end,
           verified_by = case
             when v_next_verified and not v_product.is_verified then auth.uid()
             else p.verified_by
           end,
           updated_at = statement_timestamp()
     where p.id = v_product.id
    returning p.sku, p.price, p.stock, p.available, p.is_verified, p.price_status
      into applied_sku, applied_price, applied_stock, applied_available,
           applied_is_verified, applied_price_status;

    -- ── REPUBLICACIÓN EXPLÍCITA ───────────────────────────────────────────────
    -- `products_fail_close_master_change` cuenta el precio como dato maestro y
    -- despublica al cambiarlo. El disparador está bien y no se toca; acá se
    -- vuelve a publicar sólo lo que YA estaba publicado y sigue cumpliendo
    -- TODAS las compuertas, incluida la de imagen —ahora también correcta para
    -- un producto sin foto—.
    applied_republished := false;
    if v_was_published and not applied_is_verified then
      if applied_price_status = 'confirmed'
         and applied_price > 0
         and coalesce(applied_stock, 0) > 0
         and v_product.is_active
         and v_asset_ok then
        update public.products p
           set is_verified = true,
               available = true,
               verified_at = statement_timestamp(),
               verified_by = auth.uid(),
               updated_at = statement_timestamp()
         where p.id = v_product.id
        returning p.price, p.stock, p.available, p.is_verified, p.price_status
          into applied_price, applied_stock, applied_available,
               applied_is_verified, applied_price_status;
        applied_republished := true;
      end if;
    end if;
    return next;
  end loop;
end;
$$;

revoke all on function public.apply_commercial_catalog_batch(uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.apply_commercial_catalog_batch(uuid, jsonb)
to authenticated;

comment on function public.apply_commercial_catalog_batch(uuid, jsonb) is
  'Atomic owner/admin update of price, price_status, stock and publication for products that already exist. Loading a price confirms it; an omitted value preserves state; nothing stays available without a confirmed price above zero and known stock above zero. The image is optional (product_commercial_image_valid): no image at all is fine, but a present image must fully and correctly match an approved commercial catalog_assets row — no partial or mismatched state is ever accepted.';
