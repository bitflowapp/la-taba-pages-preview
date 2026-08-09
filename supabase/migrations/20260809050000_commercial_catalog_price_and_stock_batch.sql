-- ─────────────────────────────────────────────────────────────────────────────
-- CARGA COMERCIAL DE PRECIO, STOCK Y PUBLICACIÓN SOBRE PRODUCTOS QUE YA EXISTEN
--
-- POR QUÉ EXISTE
-- --------------
-- Hoy no hay forma segura de ponerle precio a un producto que ya está en el
-- catálogo. Las dos puertas que existen no sirven para esto:
--
--   1. `grant update (stock, available, is_active, sort_order) on public.products`
--      deja mover stock y visibilidad, pero NO precio. A propósito: el precio no
--      podía quedar expuesto a un UPDATE directo sin reglas.
--
--   2. `import_catalog_batch` sí escribe precio, pero es la puerta de ALTA: exige
--      la fila técnica completa (identidad, capacidad, envase, tags, orden) más un
--      asset aprobado, y su `on conflict do update` termina en
--      `available = false, is_verified = false`. Es decir: cargar un precio por
--      ahí DESPUBLICA el producto. Cargar los 70 precios que faltan bajaría la
--      góndola entera y obligaría a republicar de a uno.
--
-- Esta función es la puerta que faltaba, y sólo esa: toma productos que YA
-- existen y les cambia lo único que el negocio decide —precio, stock y si se
-- publican—. No da de alta, no toca identidad, no toca imagen, no toca
-- categoría. Y no despublica por cambiar un precio, porque cambiar un precio no
-- cambia qué es el producto.
--
-- INVARIANTES QUE IMPONE EL SERVIDOR
-- ----------------------------------
-- El importador del repositorio valida lo mismo antes de llamar, pero la
-- autoridad es esta función: es lo que queda en pie si mañana llama otra cosa.
--
--   · precio ausente = no se toca. NUNCA se interpreta como cero.
--   · precio presente = mayor a cero. La columna acepta `>= 0`, así que el cero
--     lo tiene que frenar acá alguien: un producto a $0 se vende gratis.
--   · stock ausente = no se toca; stock presente = entero, cero o más.
--   · publicar ausente = no se toca. Publicar NUNCA es un efecto secundario.
--   · publicar = true exige precio > 0, stock > 0 y asset registrado y ligado,
--     el mismo control de autoridad de imagen que `publish_catalog_product`.
--   · un SKU que no existe ABORTA el lote entero. No se da de alta por acá.
--   · un SKU con pinta de fixture de QA aborta el lote entero.
--
-- UNA LLAMADA ES UNA TRANSACCIÓN. Cualquier `raise` deshace todo el lote: no
-- existe la importación a medias. Cargar sesenta precios y que tres queden mal
-- es peor que no cargar ninguno, porque esos tres se descubren vendiendo.
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
  applied_republished boolean
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
  v_next_price numeric(12, 2);
  v_next_stock integer;
  v_next_available boolean;
  v_next_verified boolean;
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

    -- Guarda de fixtures. El 8 de agosto dos productos de prueba llegaron a la
    -- góndola publicada y una persona real compró uno. Que el catálogo no los
    -- tenga hoy no es una garantía: esto lo es.
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
      v_price := null;                        -- ausente: no se toca
    elsif coalesce(v_row ->> 'price', '') !~ '^[0-9]+([.][0-9]{1,2})?$' then
      raise exception 'Invalid price format for sku %.', v_sku;
    else
      v_price := (v_row ->> 'price')::numeric;
      if v_price <= 0 or v_price > 9999999999.99 then
        raise exception 'Invalid price value for sku %: must be greater than zero.', v_sku;
      end if;
    end if;

    -- ── stock ─────────────────────────────────────────────────────────────────
    if nullif(btrim(coalesce(v_row ->> 'stock', '')), '') is null then
      v_stock := null;                        -- ausente: no se toca
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
      v_publish := null;                      -- ausente: no se toca
    elsif jsonb_typeof(v_row -> 'publish') is distinct from 'boolean' then
      raise exception 'Invalid publish flag for sku %.', v_sku;
    else
      v_publish := (v_row ->> 'publish')::boolean;
    end if;

    if v_price is null and v_stock is null and v_publish is null then
      raise exception 'Commercial row for sku % does not decide anything.', v_sku;
    end if;

    v_next_price := coalesce(v_price, v_product.price);
    v_next_stock := coalesce(v_stock, v_product.stock);
    v_next_available := coalesce(v_publish, v_product.available);
    v_next_verified := v_product.is_verified;
    v_was_published := v_product.is_verified and v_product.available;

    -- ¿La imagen que sirve el producto sigue siendo la que el registro aprobó?
    -- Es el mismo control de autoridad que `publish_catalog_product`, y hace
    -- falta en los dos caminos de abajo: publicar y republicar.
    select exists (
      select 1
        from public.catalog_assets ca
       where ca.id = v_product.catalog_asset_id
         and ca.business_id = p_business_id
         and ca.sku = v_product.sku
         and v_product.image_url is not distinct from ca.master_path
         and v_product.image_sha256 is not distinct from ca.master_sha256
         and v_product.image_thumbnail_url is not distinct from ca.thumbnail_path
         and v_product.image_thumbnail_sha256 is not distinct from ca.thumbnail_sha256
    ) into v_asset_ok;

    if coalesce(v_publish, false) then
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
        raise exception 'Refusing to publish sku % without matching approved asset.', v_sku;
      end if;
      v_next_verified := true;
    end if;

    update public.products p
       set price = v_next_price,
           stock = v_next_stock,
           available = v_next_available and p.is_active and coalesce(v_next_stock, 0) > 0,
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
    returning p.sku, p.price, p.stock, p.available, p.is_verified
      into applied_sku, applied_price, applied_stock, applied_available, applied_is_verified;

    -- ── REPUBLICACIÓN EXPLÍCITA ───────────────────────────────────────────────
    -- `products_fail_close_master_change` cuenta el PRECIO como dato maestro:
    -- cambiárselo a un producto verificado lo despublica. Para una tienda eso
    -- es inviable —los precios se mueven todas las semanas y bajaría la góndola
    -- entera cada vez— pero el disparador está bien: nada verificado puede
    -- cambiar en silencio.
    --
    -- Así que no se toca el disparador. Se lo deja actuar y, sólo si el producto
    -- YA ESTABA publicado y sigue cumpliendo TODAS las compuertas de
    -- publicación, se lo vuelve a publicar acá, explícitamente y en la misma
    -- transacción. Nada se publica que no pase los mismos controles que
    -- `publish_catalog_product`; lo único que se evita es que una tienda tenga
    -- que republicar setenta productos a mano por haber actualizado la lista.
    applied_republished := false;
    if v_was_published and not applied_is_verified then
      if applied_price > 0
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
        returning p.price, p.stock, p.available, p.is_verified
          into applied_price, applied_stock, applied_available, applied_is_verified;
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
  'Atomic owner/admin update of price, stock and publication for products that already exist. Never creates, never touches identity or imagery, never reads an absent value as zero, and never publishes without price, stock and a matching approved asset.';
