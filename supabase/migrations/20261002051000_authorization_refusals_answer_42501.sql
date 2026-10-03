-- TABA · UNA NEGATIVA POR PERMISOS CONTESTA 42501
--
-- QUÉ ESTABA ROTO (certificación contra el destino local, defecto C-1; reproducido en
-- PG17 local con un cliente sin membresía y con un empleado)
--
--   Cinco funciones del catálogo y del contacto del comercio rechazaban a quien no es
--   dueño ni encargado con un `raise exception` sin código. PostgreSQL le pone P0001,
--   que la API contesta como 400, lo mismo que contesta a un dato mal escrito:
--
--     apply_commercial_catalog_batch   P0001  «Only an active owner/admin can apply commercial catalog values.»
--     import_catalog_batch             P0001  «Only an active owner/admin can import a catalog batch.»
--     publish_catalog_product          P0001  «Only an active owner/admin can publish catalog products.»
--     unpublish_catalog_product        P0001  «Only an active owner/admin can unpublish catalog products.»
--     set_business_whatsapp_contact    P0001  «Only an active owner/admin can authorize the business contact channel.»
--
--   A la misma persona, sus hermanas le contestan 42501, que la API devuelve como 403:
--   `set_commercial_product_publication`, `rollback_commercial_catalog_batch`,
--   `apply_inventory_movement`. Un cliente que separa «no tenés permiso» de «mandaste
--   algo mal» por el código leía estas cinco negativas como un error de validación.
--
--   No se escribía nada: el rechazo era correcto. Lo que estaba mal era su código.
--
--   Son las únicas: en las 160 funciones plpgsql que un cliente puede ejecutar hay 91
--   negativas detrás de una prueba de rol o de permiso; 86 ya salían con 42501 y estas
--   cinco sin código.
--
-- QUÉ CAMBIA
--
--   En cada una de las cinco, la línea de esa negativa lleva `using errcode = '42501'`.
--   El mensaje es el mismo.
--
-- QUÉ NO CAMBIA
--
--   · Quién pasa y quién no: la condición no se toca.
--   · Los demás rechazos de esas funciones (un lote mal formado, un producto que no
--     existe, un teléfono inválido): siguen saliendo sin código. Son validaciones y 400
--     es su respuesta.
--   · Firma, SECURITY DEFINER, `search_path`, permisos y comentarios.
--   · `register_catalog_assets` y `stage_catalog_products` tienen la misma línea, pero
--     ningún cliente puede ejecutarlas: sólo las llama `import_catalog_batch`, que
--     rechaza antes con la misma condición. No se tocan.
--
--   Cada función es su definición vigente (20261001210000 para el lote comercial y para
--   publicar y despublicar, 20260725110000 para el alta, 20260725120000 para el
--   contacto), letra por letra, con ese único reemplazo: se generaron de la definición
--   viva, con la línea contada.
--
-- Forward-only. No toca filas. Reversión:
--   docs/migrations/rollback/20261002051000_authorization_refusals_answer_42501.rollback.sql

CREATE OR REPLACE FUNCTION public.apply_commercial_catalog_batch(p_business_id uuid, p_rows jsonb)
 RETURNS TABLE(applied_sku text, applied_price numeric, applied_stock integer, applied_available boolean, applied_is_verified boolean, applied_republished boolean, applied_price_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
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
  v_was_held boolean;
  v_asset_ok boolean;
  v_alcohol_open boolean;
  v_seen text[] := '{}';
  v_batch_id uuid;
  v_expected_stock integer;
  v_reserved integer;
  v_missing text;
  v_settled jsonb;
  v_after public.products%rowtype;
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can apply commercial catalog values.' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Commercial rows must be a non-null JSON array.';
  end if;
  if jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 500 then
    raise exception 'Commercial rows must be a JSON array with 1 to 500 entries.';
  end if;

  -- La compuerta de licencia es la misma que usa set_commercial_product_publication.
  select coalesce(b.alcohol_sales_enabled, false) into v_alcohol_open
    from public.businesses b where b.id = p_business_id;
  v_alcohol_open := coalesce(v_alcohol_open, false);

  -- El rastro nace con el lote y muere con él: si una fila falla, la excepción se
  -- lleva las dos cosas. No existe un lote aplicado sin rastro ni al revés.
  v_batch_id := private.catalog_change_begin(p_business_id, 'commercial_batch', p_rows);

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

    -- ── stock que el cliente tenía a la vista (opcional) ──────────────────────
    -- La fila ya está bloqueada: lo que se compara es el disponible de ESTE
    -- instante. `null` o vacío quiere decir «lo vi sin contar». El mensaje va en
    -- castellano y sin jerga porque el Panel lo muestra tal cual.
    if v_row ? 'expected_stock' then
      if jsonb_typeof(v_row -> 'expected_stock') = 'null' or btrim(v_row ->> 'expected_stock') = '' then
        v_expected_stock := null;
      elsif (v_row ->> 'expected_stock') !~ '^[0-9]+$' or (v_row ->> 'expected_stock')::numeric > 2147483647 then
        raise exception 'Invalid expected_stock format for sku %.', v_sku;
      else
        v_expected_stock := (v_row ->> 'expected_stock')::integer;
      end if;
      if v_product.stock is distinct from v_expected_stock then
        raise exception 'El stock de % (%) cambió mientras lo editabas: la pantalla mostraba % y ahora hay %. Actualizá el catálogo y volvé a contar; no se guardó ningún cambio del lote.',
          v_product.name, v_sku,
          coalesce(v_expected_stock::text, 'sin contar'), coalesce(v_product.stock::text, 'sin contar')
          using errcode = 'PT409';
      end if;
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
    -- El stock de la fila es un CONTEO FÍSICO. `products.stock` es el disponible:
    -- lo que hay en la góndola menos lo que ya está comprometido con pedidos que
    -- todavía no salieron y con checkouts vivos. Escribir el conteo tal cual volvía
    -- a poner en venta unidades reservadas.
    if v_stock is null then
      v_reserved := null;
      v_next_stock := v_product.stock;
    else
      v_reserved := private.pos_reserved_quantity(v_product.id);
      v_next_stock := greatest(v_stock - v_reserved, 0);
    end if;
    v_next_verified := v_product.is_verified;
    v_was_published := v_product.is_verified and v_product.available;
    -- Retenido por el sistema: verificado, el comercio lo quiere a la venta, y lo
    -- único que lo tiene afuera es un conflicto de stock abierto.
    v_was_held := v_product.is_verified and v_product.merchant_available and not v_product.available
      and exists (select 1 from public.pos_stock_conflicts c
                   where c.product_id = v_product.id and c.status = 'open');

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
        if coalesce(v_stock, 0) > 0 then
          raise exception 'Refusing to publish sku % without stock: the % counted units are all reserved by open orders (% reserved).',
            v_sku, v_stock, v_reserved;
        end if;
        raise exception 'Refusing to publish sku % without stock.', v_sku;
      end if;
      if not v_product.is_active then
        raise exception 'Refusing to publish inactive sku %.', v_sku;
      end if;
      if not v_asset_ok then
        raise exception 'Refusing to publish sku %: it must have no image at all, or a complete image bound to an approved commercial asset — no partial or mismatched image state.', v_sku;
      end if;
      if coalesce(v_product.is_alcoholic, false) and not v_alcohol_open then
        raise exception 'Refusing to publish sku %: alcohol sales are not enabled for this business (license gate).', v_sku;
      end if;
      -- Publicar verifica la ficha. Si a la ficha le falta un dato, la base lo
      -- rechaza con el nombre de una restricción; acá se dice cuál, antes.
      if v_product.catalog_origin = 'commercial' then
        v_missing := concat_ws(', ',
          case when nullif(btrim(coalesce(v_product.brand, '')), '') is null then 'brand' end,
          case when nullif(btrim(coalesce(v_product.category, '')), '') is null then 'category' end,
          case when nullif(btrim(coalesce(v_product.subcategory, '')), '') is null then 'subcategory' end,
          case when nullif(btrim(coalesce(v_product.variant, '')), '') is null
                 or v_product.presentation is distinct from v_product.variant then 'variant' end,
          case when coalesce(v_product.capacity_value, 0) <= 0
                 or v_product.capacity_unit is null
                 or v_product.capacity_unit not in ('ml', 'l', 'g', 'kg', 'unidad')
                 or v_product.capacity is distinct from (v_product.capacity_value::text || ' ' || v_product.capacity_unit)
               then 'capacity' end,
          case when nullif(btrim(coalesce(v_product.packaging_type, '')), '') is null then 'packaging_type' end,
          case when nullif(btrim(coalesce(v_product.external_id, '')), '') is null then 'external_id' end,
          case when v_product.is_alcoholic is null then 'is_alcoholic' end);
        if v_missing <> '' then
          raise exception 'Refusing to publish sku %: its product data is incomplete (missing: %). Complete the product before publishing.',
            v_sku, v_missing;
        end if;
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
           -- La intención del comercio: publicar la enciende, ocultar la apaga y
           -- una fila que no decide publicación la deja como estaba. Sin esto,
           -- un borrador de CP (merchant_available = false) no se publicaba nunca.
           merchant_available = coalesce(v_publish, p.merchant_available),
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
    -- vuelve a publicar lo que YA estaba publicado y lo que ESTA fila pidió
    -- publicar, siempre que siga cumpliendo TODAS las compuertas, incluida la de
    -- imagen y la de licencia de alcohol. Antes sólo se miraba lo ya publicado:
    -- «precio nuevo + publicar» sobre un producto verificado y agotado terminaba
    -- oculto y sin verificar, sin error.
    applied_republished := false;
    -- Una fila que pide OCULTAR no se republica aunque el precio haya cambiado.
    if (v_was_published or v_was_held or coalesce(v_publish, false)) and not applied_is_verified and v_publish is distinct from false then
      if applied_price_status = 'confirmed'
         and applied_price > 0
         and v_product.is_active
         and v_asset_ok
         and (not coalesce(v_product.is_alcoholic, false) or v_alcohol_open) then
        if coalesce(applied_stock, 0) > 0 and (v_was_published or coalesce(v_publish, false)) then
          update public.products p
             set is_verified = true,
                 available = true,
                 merchant_available = true,
                 verified_at = statement_timestamp(),
                 verified_by = auth.uid(),
                 updated_at = statement_timestamp()
           where p.id = v_product.id
          returning p.price, p.stock, p.available, p.is_verified, p.price_status
            into applied_price, applied_stock, applied_available,
                 applied_is_verified, applied_price_status;
          applied_republished := true;
        else
          -- No puede quedar a la venta en este paso: el conteo de la fila no dejó
          -- disponible (todo lo contado está reservado), o lo retiene un conflicto.
          -- Pero estaba verificado y a la venta, y el precio lo cambió el dueño por
          -- esta misma puerta: conserva la verificación. Medido antes: quedaba SIN
          -- VERIFICAR sin aviso, y no volvía cuando se liberaban los pedidos, se
          -- recibía mercadería o un conteo cerraba el conflicto. Acá no se enciende
          -- `available`: eso lo hace quien devuelva el stock o cierre el conflicto.
          update public.products p
             set is_verified = true,
                 verified_at = statement_timestamp(),
                 verified_by = auth.uid(),
                 updated_at = statement_timestamp()
           where p.id = v_product.id
          returning p.price, p.stock, p.available, p.is_verified, p.price_status
            into applied_price, applied_stock, applied_available,
                 applied_is_verified, applied_price_status;
        end if;
      end if;
    end if;

    -- ── CONTEO: libro y conflicto ─────────────────────────────────────────────
    v_settled := null;
    if v_stock is not null then
      v_settled := private.catalog_stock_count_settle(
        p_business_id, v_product.id, v_product.stock, v_next_stock, v_stock, v_reserved,
        format('Conteo físico desde el catálogo comercial: contado %s, reservado %s', v_stock, v_reserved),
        'catalog_change_batch', v_batch_id,
        'ccb_' || md5(v_batch_id::text || ':' || v_product.id::text),
        v_publish is distinct from false);
    end if;

    select * into v_after from public.products p where p.id = v_product.id;
    applied_price := v_after.price;
    applied_stock := v_after.stock;
    applied_available := v_after.available;
    applied_is_verified := v_after.is_verified;
    applied_price_status := v_after.price_status;

    -- Publicar es publicar: una fila que lo pidió y pasó las compuertas no puede
    -- volver «aplicada» con el producto escondido.
    if coalesce(v_publish, false) and not v_after.available then
      if exists (select 1 from public.pos_stock_conflicts c where c.product_id = v_product.id and c.status = 'open') then
        raise exception 'Refusing to publish sku %: it is held by an open stock conflict. Count its physical stock first.', v_sku;
      end if;
      raise exception 'Refusing to publish sku %: it passed the gates but did not end available. Nothing was applied.', v_sku;
    end if;

    perform private.catalog_change_log_item(
      v_batch_id, 'updated', v_product, v_after, v_stock, v_reserved,
      (v_settled ->> 'movement_id')::uuid,
      jsonb_build_object(
        -- Si la fila decidió la publicación (`publish` true o false). La reversión lo
        -- necesita: `available` también lo mueve el sistema, y por la imagen sola no
        -- se distingue «la planilla lo publicó» de «un conteo lo reofreció».
        'publish', v_publish,
        'republished', applied_republished,
        'shortfall', nullif((v_settled ->> 'shortfall')::integer, 0),
        'conflict_id', v_settled ->> 'conflict_id',
        'conflict_resolved', case when (v_settled ->> 'conflict_resolved')::boolean then true end,
        'reoffered', case when (v_settled ->> 'reoffered')::boolean then true end));
    return next;
  end loop;
end;
$function$;

revoke all on function public.apply_commercial_catalog_batch(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_commercial_catalog_batch(uuid, jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.import_catalog_batch(p_business_id uuid, p_assets jsonb, p_products jsonb)
 RETURNS TABLE(product_id uuid, staged_external_id text, staged_sku text, staged_is_verified boolean, staged_available boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
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
    raise exception 'Only an active owner/admin can import a catalog batch.' using errcode = '42501';
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
$function$;

revoke all on function public.import_catalog_batch(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.import_catalog_batch(uuid, jsonb, jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.publish_catalog_product(p_business_id uuid, p_external_id text, p_available boolean DEFAULT false)
 RETURNS TABLE(product_id uuid, published_external_id text, published_sku text, published_is_verified boolean, published_available boolean, published_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_product public.products%rowtype;
  v_asset public.catalog_assets%rowtype;
  v_alcohol_open boolean;
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can publish catalog products.' using errcode = '42501';
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

  select coalesce(b.alcohol_sales_enabled, false) into v_alcohol_open
    from public.businesses b where b.id = p_business_id;
  v_alcohol_open := coalesce(v_alcohol_open, false);

  update public.products p
     set is_verified = true,
         verified_at = statement_timestamp(),
         verified_by = auth.uid(),
         -- Verificar no es vender: queda disponible sólo si además se puede vender
         -- (precio confirmado, licencia de alcohol). Sin esas dos condiciones un
         -- precio pendiente daba un 23514 crudo y un alcohólico quedaba ofrecido
         -- con la licencia cerrada.
         available = coalesce(p_available, false) and p.is_active and coalesce(p.stock, 0) > 0
           and p.price_status = 'confirmed' and p.price > 0
           and (not coalesce(p.is_alcoholic, false) or v_alcohol_open),
         -- Pedir que quede disponible ES la intención del comercio, y sacar de la
         -- venta algo que hoy se vende también (si no, la próxima reserva vencida lo
         -- volvía a ofrecer). Sobre un producto que ya no estaba a la venta,
         -- `p_available = false` no toca la intención: esta puerta también se usa para
         -- volver a verificar sin decidir qué se vende.
         merchant_available = case
           when coalesce(p_available, false) then true
           when p.available then false
           else p.merchant_available
         end,
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
  perform private.catalog_change_record_single('verification', v_product,
    jsonb_build_object('external_id', btrim(p_external_id), 'available', coalesce(p_available, false)));
  return next;
end;
$function$;

revoke all on function public.publish_catalog_product(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.publish_catalog_product(uuid, text, boolean) to authenticated;

CREATE OR REPLACE FUNCTION public.unpublish_catalog_product(p_business_id uuid, p_external_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_updated integer;
  v_product public.products%rowtype;
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can unpublish catalog products.' using errcode = '42501';
  end if;
  -- La fila se lee bloqueada antes de escribir para poder guardar su imagen previa.
  select * into v_product
    from public.products p
   where p.business_id = p_business_id
     and p.external_id = btrim(p_external_id)
   for update;
  update public.products p
     set available = false,
         merchant_available = false,
         is_verified = false,
         verified_at = null,
         verified_by = null,
         updated_at = statement_timestamp()
   where p.business_id = p_business_id
     and p.external_id = btrim(p_external_id);
  get diagnostics v_updated = row_count;
  if v_updated = 1 then
    perform private.catalog_change_record_single('unpublish', v_product,
      jsonb_build_object('external_id', btrim(p_external_id)));
  end if;
  return v_updated = 1;
end;
$function$;

revoke all on function public.unpublish_catalog_product(uuid, text) from public, anon, authenticated;
grant execute on function public.unpublish_catalog_product(uuid, text) to authenticated;

CREATE OR REPLACE FUNCTION public.set_business_whatsapp_contact(p_business_id uuid, p_whatsapp_phone text, p_verified boolean DEFAULT false)
 RETURNS TABLE(whatsapp_phone text, whatsapp_verified boolean, whatsapp_verified_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_digits text;
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can authorize the business contact channel.' using errcode = '42501';
  end if;

  v_digits := regexp_replace(coalesce(p_whatsapp_phone, ''), '[^0-9]', '', 'g');
  if v_digits <> '' and char_length(v_digits) not between 8 and 15 then
    raise exception 'WhatsApp phone must contain between 8 and 15 digits.';
  end if;
  if coalesce(p_verified, false) and v_digits = '' then
    raise exception 'A valid WhatsApp phone is required before verification.';
  end if;

  -- First rotate the number and invalidate the previous authority stamp.
  update public.businesses b
     set whatsapp_phone = nullif(v_digits, ''),
         whatsapp_verified = false,
         whatsapp_verified_at = null,
         whatsapp_verified_by = null,
         updated_at = statement_timestamp()
   where b.id = p_business_id;
  if not found then
    raise exception 'Business not found.';
  end if;

  -- Verification is a separate update so the phone-change trigger cannot
  -- preserve an old stamp or override this newly authenticated decision.
  if coalesce(p_verified, false) then
    update public.businesses b
       set whatsapp_verified = true,
           whatsapp_verified_at = statement_timestamp(),
           whatsapp_verified_by = auth.uid(),
           updated_at = statement_timestamp()
     where b.id = p_business_id;
  end if;

  return query
  select b.whatsapp_phone, b.whatsapp_verified, b.whatsapp_verified_at
    from public.businesses b
   where b.id = p_business_id;
end;
$function$;

revoke all on function public.set_business_whatsapp_contact(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.set_business_whatsapp_contact(uuid, text, boolean) to authenticated;
