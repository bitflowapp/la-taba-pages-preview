-- TABA · UNA NEGATIVA A UN CLIENTE LLEVA EL SQLSTATE DE LO QUE SIGNIFICA (NO P0001)
--
-- QUÉ ESTABA ROTO
--
--   46 RAISE EXCEPTION sin errcode en 5 funciones que un cliente ejecuta. PostgreSQL les pone P0001
--   y la API contesta 400 · P0001: lo mismo para «mandaste algo mal», «eso no existe» y «no se puede en el
--   estado en que está». La política del contrato HTTP (docs/ecommerce-hardening/http-contract.md) dice que
--   P0001 no debe llegar a un cliente. 20261002051000 ya les dio 42501 a las negativas de permiso de estas
--   mismas funciones; quedaban éstas.
--
-- QUÉ CAMBIA (sólo el errcode; el mensaje, la condición y todo lo demás quedan igual)
--
--   22023 (400) · entrada inválida: el lote, la fila o el teléfono que mandó el cliente está mal formado.
--     apply_commercial_catalog_batch     «Commercial rows must be a non-null JSON array.»
--     apply_commercial_catalog_batch     «Commercial rows must be a JSON array with 1 to 500 entries.»
--     apply_commercial_catalog_batch     «Commercial row without sku.»
--     apply_commercial_catalog_batch     «Duplicated sku % in the same batch.»
--     apply_commercial_catalog_batch     «Refusing a QA-looking sku in the commercial catalog: %.»
--     apply_commercial_catalog_batch     «Invalid price format for sku %.»
--     apply_commercial_catalog_batch     «Invalid price value for sku %: must be greater than zero.»
--     apply_commercial_catalog_batch     «Invalid price_pending flag for sku %.»
--     apply_commercial_catalog_batch     «Row for sku % sets a price and marks it pending at the same time.»
--     apply_commercial_catalog_batch     «Invalid stock format for sku %.»
--     apply_commercial_catalog_batch     «Invalid stock range for sku %.»
--     apply_commercial_catalog_batch     «Invalid expected_stock format for sku %.»
--     apply_commercial_catalog_batch     «Invalid publish flag for sku %.»
--     apply_commercial_catalog_batch     «Commercial row for sku % does not decide anything.»
--     import_catalog_batch               «Catalog assets must be a non-null JSON array.»
--     import_catalog_batch               «Catalog products must be a non-null JSON array.»
--     import_catalog_batch               «Catalog import must contain 1 to 500 assets and products.»
--     import_catalog_batch               «Catalog asset/product cardinality mismatch.»
--     import_catalog_batch               «Catalog import contains duplicate asset/product identities.»
--     import_catalog_batch               «Catalog assets and products must have identical identities.»
--     import_catalog_batch               «Catalog asset registration cardinality mismatch.»
--     import_catalog_batch               «Catalog product staging cardinality mismatch.»
--     set_business_whatsapp_contact      «WhatsApp phone must contain between 8 and 15 digits.»
--     set_business_whatsapp_contact      «A valid WhatsApp phone is required before verification.»
--
--   P0002 (404) · no existe: el producto o el comercio que nombra el pedido no existe para ese comercio.
--     apply_commercial_catalog_batch     «Unknown sku % for this business. Commercial import never creates products.»
--     publish_catalog_product            «Catalog product not found.»
--     set_business_whatsapp_contact      «Business not found.»
--
--   55000 (409) · estado: el producto no está en condiciones de publicarse (precio, stock, imagen, licencia
--   de alcohol, datos incompletos, conflicto de stock, origen o verificación). Definitivo para ese pedido.
--     apply_commercial_catalog_batch     «Refusing to publish sku % without a confirmed price state.»
--     apply_commercial_catalog_batch     «Refusing to publish sku % without a price.»
--     apply_commercial_catalog_batch     «Refusing to publish sku % without stock: the % counted units are all reserved by open o...»
--     apply_commercial_catalog_batch     «Refusing to publish sku % without stock.»
--     apply_commercial_catalog_batch     «Refusing to publish inactive sku %.»
--     apply_commercial_catalog_batch     «Refusing to publish sku %: it must have no image at all, or a complete image bound to a...»
--     apply_commercial_catalog_batch     «Refusing to publish sku %: alcohol sales are not enabled for this business (license gate).»
--     apply_commercial_catalog_batch     «Refusing to publish sku %: its product data is incomplete (missing: %). Complete the pr...»
--     apply_commercial_catalog_batch     «Refusing to publish sku %: it is held by an open stock conflict. Count its physical sto...»
--     apply_commercial_catalog_batch     «Refusing to publish sku %: it passed the gates but did not end available. Nothing was a...»
--     publish_catalog_product            «Catalog product has invalid structured presentation or capacity.»
--     publish_catalog_product            «Catalog product asset authority does not match.»
--     set_commercial_product_publication «Refusing to publish non-commercial sku %.»
--     set_commercial_product_publication «Sku % is not verified yet. Verify its master data first (commercial import), then publish.»
--     set_commercial_product_publication «Refusing to publish inactive sku %.»
--     set_commercial_product_publication «Refusing to publish sku % without a confirmed price.»
--     set_commercial_product_publication «Refusing to publish sku % without stock.»
--     set_commercial_product_publication «Refusing to publish sku %: it must have no image at all, or a complete image bound to a...»
--     set_commercial_product_publication «Refusing to publish sku %: alcohol sales are not enabled for this business (license gate).»
--
--   Las cuatro funciones con 55000 / P0002 ya llevan el envoltorio de la frontera (20261002090000): por la
--   API salen como 409 / 404. import_catalog_batch sólo recibe 22023 y no lo necesita.
--
-- QUÉ NO CAMBIA
--
--   · Quién pasa y quién no, ni en qué orden se pregunta: ninguna condición se toca.
--   · El cuerpo de cada función es el vigente (con el envoltorio de 20261002090000), generado de la
--     definición viva; el único cambio es ` using errcode = ...` antes del `;` de cada uno de esos RAISE.
--   · Firma, SECURITY DEFINER, search_path, permisos (no se reescribe ninguno) y comentarios.
--
-- Se niega a correr si alguna función ya no tiene el cuerpo del que se generó (ni el nuevo).
--
-- Forward-only. No toca filas. Reversión: docs/migrations/rollback/20261002091000_client_refusals_carry_their_sqlstate.rollback.sql

do $guard$
declare
  v_row record;
  v_actual text;
begin
  for v_row in
    select * from (values
      ('public.apply_commercial_catalog_batch(uuid,jsonb)', '6adbd0e78ab73e9721381b778f107381', '4e343a50cb0b67133fc54efab1b3bcd0'),
      ('public.import_catalog_batch(uuid,jsonb,jsonb)', '732c28df37eb4455095f1530b255c378', '126f48f3e742624f49c3f17840b30134'),
      ('public.publish_catalog_product(uuid,text,boolean)', '7af0c9b73b3cb6c8f4c405cea05af3b2', '764c1f296c0049c5fb2c142cce756f00'),
      ('public.set_business_whatsapp_contact(uuid,text,boolean)', '2460319f0788f5fa04727db690215471', '01d51e494a12b5a1b905a58a4d41dc3d'),
      ('public.set_commercial_product_publication(uuid,text,boolean)', '2579b9572e39f4da31aad31d8bead8f6', '8546f634adf632cc388443391b112542')
    ) as t(signature, previous, applied)
  loop
    select md5(replace(p.prosrc, E'\r', '')) into v_actual
      from pg_proc p where p.oid = to_regprocedure(v_row.signature);
    if v_actual is null or v_actual not in (v_row.applied, v_row.previous) then
      raise exception 'ROLLOUT_BLOCKED: % no tiene el cuerpo del que se genero 20261002091000; otra migracion la redefinio', v_row.signature
        using errcode = 'P0001';
    end if;
  end loop;
end
$guard$;

CREATE OR REPLACE FUNCTION public.apply_commercial_catalog_batch(p_business_id uuid, p_rows jsonb)
 RETURNS TABLE(applied_sku text, applied_price numeric, applied_stock integer, applied_available boolean, applied_is_verified boolean, applied_republished boolean, applied_price_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

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
    raise exception 'Commercial rows must be a non-null JSON array.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 500 then
    raise exception 'Commercial rows must be a JSON array with 1 to 500 entries.' using errcode = '22023';
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
      raise exception 'Commercial row without sku.' using errcode = '22023';
    end if;
    if v_sku = any (v_seen) then
      raise exception 'Duplicated sku % in the same batch.', v_sku using errcode = '22023';
    end if;
    v_seen := v_seen || v_sku;

    if v_sku ~* '(-staging-only$)|(^qa[-_])|(\yqa\y)|(\y(test|prueba|sintetica|sintetico|synthetic|fixture|dummy)\y)' then
      raise exception 'Refusing a QA-looking sku in the commercial catalog: %.', v_sku using errcode = '22023';
    end if;

    select * into v_product
      from public.products p
     where p.business_id = p_business_id
       and p.sku = v_sku
     for update;
    if not found then
      raise exception 'Unknown sku % for this business. Commercial import never creates products.', v_sku using errcode = 'P0002';
    end if;

    -- ── precio ────────────────────────────────────────────────────────────────
    if nullif(btrim(coalesce(v_row ->> 'price', '')), '') is null then
      v_price := null;
    elsif coalesce(v_row ->> 'price', '') !~ '^[0-9]+([.][0-9]{1,2})?$' then
      raise exception 'Invalid price format for sku %.', v_sku using errcode = '22023';
    else
      v_price := (v_row ->> 'price')::numeric;
      if v_price <= 0 or v_price > 9999999999.99 then
        raise exception 'Invalid price value for sku %: must be greater than zero.', v_sku using errcode = '22023';
      end if;
    end if;

    -- ── volver a pendiente ────────────────────────────────────────────────────
    if v_row -> 'price_pending' is null or jsonb_typeof(v_row -> 'price_pending') = 'null' then
      v_price_pending := null;
    elsif jsonb_typeof(v_row -> 'price_pending') is distinct from 'boolean' then
      raise exception 'Invalid price_pending flag for sku %.', v_sku using errcode = '22023';
    else
      v_price_pending := (v_row ->> 'price_pending')::boolean;
    end if;
    if coalesce(v_price_pending, false) and v_price is not null then
      raise exception 'Row for sku % sets a price and marks it pending at the same time.', v_sku using errcode = '22023';
    end if;

    -- ── stock ─────────────────────────────────────────────────────────────────
    if nullif(btrim(coalesce(v_row ->> 'stock', '')), '') is null then
      v_stock := null;
    elsif coalesce(v_row ->> 'stock', '') !~ '^[0-9]+$' then
      raise exception 'Invalid stock format for sku %.', v_sku using errcode = '22023';
    else
      if (v_row ->> 'stock')::numeric > 2147483647 then
        raise exception 'Invalid stock range for sku %.', v_sku using errcode = '22023';
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
        raise exception 'Invalid expected_stock format for sku %.', v_sku using errcode = '22023';
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
      raise exception 'Invalid publish flag for sku %.', v_sku using errcode = '22023';
    else
      v_publish := (v_row ->> 'publish')::boolean;
    end if;

    if v_price is null and v_stock is null and v_publish is null and v_price_pending is null then
      raise exception 'Commercial row for sku % does not decide anything.', v_sku using errcode = '22023';
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
        raise exception 'Refusing to publish sku % without a confirmed price state.', v_sku using errcode = '55000';
      end if;
      if v_next_price is null or v_next_price <= 0 then
        raise exception 'Refusing to publish sku % without a price.', v_sku using errcode = '55000';
      end if;
      if coalesce(v_next_stock, 0) <= 0 then
        if coalesce(v_stock, 0) > 0 then
          raise exception 'Refusing to publish sku % without stock: the % counted units are all reserved by open orders (% reserved).',
            v_sku, v_stock, v_reserved using errcode = '55000';
        end if;
        raise exception 'Refusing to publish sku % without stock.', v_sku using errcode = '55000';
      end if;
      if not v_product.is_active then
        raise exception 'Refusing to publish inactive sku %.', v_sku using errcode = '55000';
      end if;
      if not v_asset_ok then
        raise exception 'Refusing to publish sku %: it must have no image at all, or a complete image bound to an approved commercial asset — no partial or mismatched image state.', v_sku using errcode = '55000';
      end if;
      if coalesce(v_product.is_alcoholic, false) and not v_alcohol_open then
        raise exception 'Refusing to publish sku %: alcohol sales are not enabled for this business (license gate).', v_sku using errcode = '55000';
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
            v_sku, v_missing using errcode = '55000';
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
        raise exception 'Refusing to publish sku %: it is held by an open stock conflict. Count its physical stock first.', v_sku using errcode = '55000';
      end if;
      raise exception 'Refusing to publish sku %: it passed the gates but did not end available. Nothing was applied.', v_sku using errcode = '55000';
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
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

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
    raise exception 'Catalog assets must be a non-null JSON array.' using errcode = '22023';
  end if;
  if p_products is null or jsonb_typeof(p_products) is distinct from 'array' then
    raise exception 'Catalog products must be a non-null JSON array.' using errcode = '22023';
  end if;
  v_asset_count := jsonb_array_length(p_assets);
  v_product_count := jsonb_array_length(p_products);
  if v_asset_count < 1 or v_asset_count > 500
     or v_product_count < 1 or v_product_count > 500 then
    raise exception 'Catalog import must contain 1 to 500 assets and products.' using errcode = '22023';
  end if;
  if v_asset_count <> v_product_count then
    raise exception 'Catalog asset/product cardinality mismatch.' using errcode = '22023';
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
    raise exception 'Catalog import contains duplicate asset/product identities.' using errcode = '22023';
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
    raise exception 'Catalog assets and products must have identical identities.' using errcode = '22023';
  end if;

  select count(*)
    into v_registered_count
    from public.register_catalog_assets(p_business_id, p_assets);
  if v_registered_count <> v_asset_count then
    raise exception 'Catalog asset registration cardinality mismatch.' using errcode = '22023';
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
    raise exception 'Catalog product staging cardinality mismatch.' using errcode = '22023';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.publish_catalog_product(p_business_id uuid, p_external_id text, p_available boolean DEFAULT false)
 RETURNS TABLE(product_id uuid, published_external_id text, published_sku text, published_is_verified boolean, published_available boolean, published_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

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
  if not found then raise exception 'Catalog product not found.' using errcode = 'P0002'; end if;

  if btrim(coalesce(v_product.variant, '')) = ''
     or v_product.capacity_value is null
     or v_product.capacity_value <= 0
     or v_product.capacity_unit not in ('ml', 'l', 'g', 'kg', 'unidad')
     or v_product.presentation is distinct from v_product.variant
     or v_product.capacity is distinct from (
       v_product.capacity_value::text || ' ' || v_product.capacity_unit
     ) then
    raise exception 'Catalog product has invalid structured presentation or capacity.' using errcode = '55000';
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
    raise exception 'Catalog product asset authority does not match.' using errcode = '55000';
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
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_business_whatsapp_contact(p_business_id uuid, p_whatsapp_phone text, p_verified boolean DEFAULT false)
 RETURNS TABLE(whatsapp_phone text, whatsapp_verified boolean, whatsapp_verified_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_digits text;
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can authorize the business contact channel.' using errcode = '42501';
  end if;

  v_digits := regexp_replace(coalesce(p_whatsapp_phone, ''), '[^0-9]', '', 'g');
  if v_digits <> '' and char_length(v_digits) not between 8 and 15 then
    raise exception 'WhatsApp phone must contain between 8 and 15 digits.' using errcode = '22023';
  end if;
  if coalesce(p_verified, false) and v_digits = '' then
    raise exception 'A valid WhatsApp phone is required before verification.' using errcode = '22023';
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
    raise exception 'Business not found.' using errcode = 'P0002';
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
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_commercial_product_publication(p_business_id uuid, p_sku text, p_publish boolean)
 RETURNS TABLE(applied_sku text, applied_available boolean, applied_is_verified boolean, applied_price numeric, applied_stock integer, applied_price_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_sku text := btrim(coalesce(p_sku, ''));
  v_product public.products%rowtype;
  v_business public.businesses%rowtype;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can publish or hide a commercial product.'
      using errcode = '42501';
  end if;
  if v_sku = '' then
    raise exception 'Missing sku.' using errcode = '22023';
  end if;
  if p_publish is null then
    raise exception 'p_publish must be true or false.' using errcode = '22023';
  end if;

  select * into v_product
    from public.products p
   where p.business_id = p_business_id
     and p.sku = v_sku
   for update;
  if not found then
    raise exception 'Unknown sku % for this business.', v_sku using errcode = 'P0002';
  end if;

  -- ── ocultar: siempre permitido para owner/admin, marca tanto available como merchant_available ──
  if not p_publish then
    return query
      update public.products p
         set available = false,
             merchant_available = false,
             updated_at = statement_timestamp()
       where p.id = v_product.id
      returning p.sku, p.available, p.is_verified, p.price, p.stock, p.price_status;
    perform private.catalog_change_record_single('publication', v_product,
      jsonb_build_object('sku', v_sku, 'publish', false));
    return;
  end if;

  -- La publicación desde el Panel sólo opera sobre la autoridad comercial.
  if coalesce(v_product.catalog_origin, '') <> 'commercial' then
    raise exception 'Refusing to publish non-commercial sku %.', v_sku using errcode = '55000';
  end if;

  -- ── publicar: producto YA verificado, nunca se verifica acá por primera vez ─
  if not v_product.is_verified then
    raise exception 'Sku % is not verified yet. Verify its master data first (commercial import), then publish.', v_sku using errcode = '55000';
  end if;
  if not v_product.is_active then
    raise exception 'Refusing to publish inactive sku %.', v_sku using errcode = '55000';
  end if;
  if v_product.price_status <> 'confirmed' or coalesce(v_product.price, 0) <= 0 then
    raise exception 'Refusing to publish sku % without a confirmed price.', v_sku using errcode = '55000';
  end if;
  if coalesce(v_product.stock, 0) <= 0 then
    raise exception 'Refusing to publish sku % without stock.', v_sku using errcode = '55000';
  end if;
  if not public.product_commercial_image_valid(v_product) then
    raise exception 'Refusing to publish sku %: it must have no image at all, or a complete image bound to an approved commercial asset.', v_sku using errcode = '55000';
  end if;
  if v_product.is_alcoholic then
    select * into v_business from public.businesses b where b.id = p_business_id;
    if not found or coalesce(v_business.alcohol_sales_enabled, false) is not true then
      raise exception 'Refusing to publish sku %: alcohol sales are not enabled for this business (license gate).', v_sku using errcode = '55000';
    end if;
  end if;

  return query
    update public.products p
       set available = true,
           merchant_available = true,
           updated_at = statement_timestamp()
     where p.id = v_product.id
    returning p.sku, p.available, p.is_verified, p.price, p.stock, p.price_status;
  perform private.catalog_change_record_single('publication', v_product,
    jsonb_build_object('sku', v_sku, 'publish', true));
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;
