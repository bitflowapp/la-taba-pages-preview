-- REVERSIÓN de 20261001210000_catalog_stock_authority.sql
--
-- Devuelve las siete funciones del catálogo a su cuerpo anterior (copiado de la base
-- con pg_get_functiondef, byte por byte), devuelve a `authenticated` el UPDATE directo
-- sobre `products (stock, available, is_active)` y retira la reversión de lotes y las
-- piezas privadas.
--
-- Ojo con lo que vuelve a quedar abierto: el stock del Panel y de la planilla vuelve a
-- escribirse como valor absoluto (un conteo vuelve a poner en venta lo reservado), una
-- pantalla vieja vuelve a pisar el stock, «precio nuevo + publicar» sobre un verificado
-- agotado vuelve a dejar el producto oculto sin avisar, la rotura de la última unidad
-- publicada vuelve a fallar con 23514, y staff vuelve a poder escribir stock y
-- available directo. Sólo usar para volver atrás un despliegue.
--
-- El rastro NO se pierde. Si `catalog_change_batches` está vacía, las dos tablas se
-- van (no hay nada que conservar y el esquema queda como antes). Si tiene filas, las
-- dos tablas QUEDAN, inmutables y sin permisos para `authenticated`: son la única
-- constancia de quién cambió qué precio. Por eso este archivo no necesita negarse a
-- correr: no hay camino en el que borre un dato durable.
--
-- No toca filas de `products`, `inventory_movements` ni `pos_stock_conflicts`: los
-- conteos aplicados fueron conteos reales y siguen en el libro. Un conflicto
-- `count_below_reserved` que haya abierto un conteo del Panel sigue abierto y lo cierra
-- un conteo de Caja Clara (`pos_apply_stock_count`), igual que antes.
--
-- supabase/tests/production_least_privilege_test.sql reconoce este estado por la
-- ausencia de `rollback_commercial_catalog_batch` (acá se retira siempre) y vuelve a
-- exigir el permiso por columna: pasa antes de la migración, con ella y revertida,
-- queden o no las tablas del rastro. Las dos suites nuevas (catalog_stock_authority y
-- catalog_change_rollback) prueban la migración: sobre una base revertida fallan y
-- hay que sacarlas de la lista mientras dure la reversión.
--
-- No toca supabase_migrations.schema_migrations. Después:
--   supabase migration repair --status reverted 20261001210000
begin;

-- Primero el permiso: mientras las funciones viejas vuelven, nadie queda sin camino.
grant update (stock, available, is_active) on table public.products to authenticated;

drop function if exists public.rollback_commercial_catalog_batch(uuid, uuid);

-- public.apply_commercial_catalog_batch(uuid,jsonb)
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
  v_asset_ok boolean;
  v_alcohol_open boolean;
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

  -- La compuerta de licencia es la misma que usa set_commercial_product_publication.
  select coalesce(b.alcohol_sales_enabled, false) into v_alcohol_open
    from public.businesses b where b.id = p_business_id;
  v_alcohol_open := coalesce(v_alcohol_open, false);

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
      if coalesce(v_product.is_alcoholic, false) and not v_alcohol_open then
        raise exception 'Refusing to publish sku %: alcohol sales are not enabled for this business (license gate).', v_sku;
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
    -- vuelve a publicar sólo lo que YA estaba publicado y sigue cumpliendo
    -- TODAS las compuertas, incluida la de imagen y la de licencia de alcohol.
    applied_republished := false;
    -- Una fila que pide OCULTAR no se republica aunque el precio haya cambiado.
    if v_was_published and not applied_is_verified and v_publish is distinct from false then
      if applied_price_status = 'confirmed'
         and applied_price > 0
         and coalesce(applied_stock, 0) > 0
         and v_product.is_active
         and v_asset_ok
         and (not coalesce(v_product.is_alcoholic, false) or v_alcohol_open) then
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
      end if;
    end if;
    return next;
  end loop;
end;
$function$;

revoke all on function public.apply_commercial_catalog_batch(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.apply_commercial_catalog_batch(uuid,jsonb) to authenticated;

-- public.apply_commercial_catalog_plan(uuid,jsonb,jsonb)
CREATE OR REPLACE FUNCTION public.apply_commercial_catalog_plan(p_business_id uuid, p_creates jsonb DEFAULT '[]'::jsonb, p_updates jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
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
$function$;

revoke all on function public.apply_commercial_catalog_plan(uuid,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.apply_commercial_catalog_plan(uuid,jsonb,jsonb) to authenticated;

-- public.complete_scanned_product(uuid,jsonb)
CREATE OR REPLACE FUNCTION public.complete_scanned_product(p_product_id uuid, p_details jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_product public.products%rowtype;
  v_allowed text[] := array['name', 'brand', 'category', 'variant', 'capacity_value', 'capacity_unit', 'units_per_pack', 'price', 'price_pending', 'unit_cost', 'stock'];
  v_price numeric(12, 2);
  v_price_pending boolean;
  v_stock integer;
  v_units integer;
  v_capacity_value numeric;
  v_capacity_unit text;
begin
  select * into v_product from public.products where id = p_product_id for update;
  if not found then
    raise exception 'producto inexistente' using errcode = 'P0002';
  end if;
  if not public.has_business_role(v_product.business_id, array['owner', 'admin']) then
    raise exception 'completar el producto requiere owner o admin' using errcode = '42501';
  end if;
  if coalesce(p_details, '{}'::jsonb) - v_allowed <> '{}'::jsonb then
    raise exception 'payload no permitido' using errcode = '22023';
  end if;

  v_price_pending := coalesce((p_details->>'price_pending')::boolean, false);
  v_price := case when v_price_pending then 0 else round(coalesce((p_details->>'price')::numeric, -1), 2) end;
  v_stock := coalesce((p_details->>'stock')::integer, -1);
  v_units := coalesce((p_details->>'units_per_pack')::integer, 0);
  v_capacity_value := coalesce((p_details->>'capacity_value')::numeric, 0);
  v_capacity_unit := btrim(coalesce(p_details->>'capacity_unit', ''));

  if char_length(btrim(coalesce(p_details->>'name', ''))) not between 2 and 160
     or char_length(btrim(coalesce(p_details->>'brand', ''))) not between 2 and 80
     or char_length(btrim(coalesce(p_details->>'category', ''))) not between 2 and 80
     or char_length(btrim(coalesce(p_details->>'variant', ''))) not between 1 and 80 then
    raise exception 'faltan datos obligatorios del producto' using errcode = '22023';
  end if;
  if v_capacity_value <= 0 or v_capacity_unit not in ('ml', 'l', 'g', 'kg', 'unidad') then
    raise exception 'presentacion invalida' using errcode = '22023';
  end if;
  if v_units < 1 then
    raise exception 'unidades por pack invalidas' using errcode = '22023';
  end if;
  if v_stock < 0 then
    raise exception 'stock invalido' using errcode = '22023';
  end if;
  if not v_price_pending and v_price <= 0 then
    raise exception 'precio invalido' using errcode = '22023';
  end if;

  update public.products set
    name = btrim(p_details->>'name'),
    brand = btrim(p_details->>'brand'),
    category = btrim(p_details->>'category'),
    variant = btrim(p_details->>'variant'),
    presentation = btrim(p_details->>'variant'),
    capacity_value = v_capacity_value,
    capacity_unit = v_capacity_unit,
    capacity = v_capacity_value::text || ' ' || v_capacity_unit,
    units_per_pack = v_units,
    price = v_price,
    price_status = case when v_price_pending then 'pending' else 'confirmed' end,
    unit_cost = nullif(p_details->>'unit_cost', '')::numeric,
    stock = v_stock,
    -- Disponible sólo cuando hay precio confirmado, stock y verificación de catálogo.
    available = (not v_price_pending) and v_stock > 0 and is_verified,
    updated_at = now()
  where id = v_product.id
  returning * into v_product;

  insert into public.scanned_product_audit (business_id, product_id, gtin, action, actor_id, detail)
  values (
    v_product.business_id,
    v_product.id,
    coalesce((select pb.gtin from public.product_barcodes pb where pb.product_id = v_product.id and pb.is_primary limit 1), ''),
    case when v_price_pending then 'completed' else 'price_confirmed' end,
    auth.uid(),
    jsonb_build_object('price_status', v_product.price_status, 'stock', v_product.stock)
  );

  return public.get_scanned_product_readiness(v_product.id);
end;
$function$;

revoke all on function public.complete_scanned_product(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.complete_scanned_product(uuid,jsonb) to authenticated;

-- public.apply_inventory_movement(uuid,uuid,uuid,text,integer,integer,text,uuid,text,text)
CREATE OR REPLACE FUNCTION public.apply_inventory_movement(p_business_id uuid, p_product_id uuid, p_barcode_id uuid, p_movement_type text, p_package_quantity integer, p_direction integer, p_reference_type text, p_reference_id uuid, p_reason text, p_idempotency_key text)
 RETURNS inventory_movements
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_product public.products%rowtype;
  v_barcode public.product_barcodes%rowtype;
  v_existing public.inventory_movements%rowtype;
  v_result public.inventory_movements%rowtype;
  v_factor integer := 1;
  v_delta integer;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  if p_movement_type not in ('purchase_receipt','manual_adjustment','stock_count','sale','online_order_reservation','online_order_release','cancellation_return','damage','loss','expiration','supplier_return') then raise exception 'tipo de movimiento invalido' using errcode = '22023'; end if;
  if p_package_quantity < 1 or p_direction not in (-1, 1) then raise exception 'cantidad o direccion invalida' using errcode = '22023'; end if;
  if btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'idempotency_key invalida' using errcode = '22023'; end if;
  select m.* into v_existing from public.inventory_movements m where m.business_id = p_business_id and m.idempotency_key = p_idempotency_key;
  if found then return v_existing; end if;
  select p.* into v_product from public.products p where p.id = p_product_id and p.business_id = p_business_id for update;
  if not found then raise exception 'producto inexistente' using errcode = 'P0002'; end if;
  if p_barcode_id is not null then
    select b.* into v_barcode from public.product_barcodes b where b.id = p_barcode_id and b.business_id = p_business_id and b.product_id = p_product_id and b.is_active;
    if not found then raise exception 'barcode no corresponde al producto' using errcode = '22023'; end if;
    v_factor := v_barcode.unit_factor;
  end if;
  v_delta := p_package_quantity * v_factor * p_direction;
  if coalesce(v_product.stock, 0) + v_delta < 0 then raise exception 'stock negativo bloqueado' using errcode = '23514'; end if;
  if p_movement_type in ('manual_adjustment','stock_count','damage','loss','expiration','supplier_return') and char_length(btrim(coalesce(p_reason, ''))) not between 3 and 300 then raise exception 'motivo requerido' using errcode = '22023'; end if;
  update public.products set stock = coalesce(stock, 0) + v_delta where id = p_product_id;
  insert into public.inventory_movements(business_id, product_id, barcode_id, movement_type, quantity_delta, previous_stock, resulting_stock, unit_factor, reference_type, reference_id, reason, operator_id, idempotency_key)
  values (p_business_id, p_product_id, p_barcode_id, p_movement_type, v_delta, coalesce(v_product.stock,0), coalesce(v_product.stock,0)+v_delta, v_factor, nullif(btrim(coalesce(p_reference_type,'')),''), p_reference_id, nullif(btrim(coalesce(p_reason,'')),''), auth.uid(), p_idempotency_key)
  returning * into v_result;
  return v_result;
end;
$function$;

revoke all on function public.apply_inventory_movement(uuid,uuid,uuid,text,integer,integer,text,uuid,text,text) from public, anon, authenticated;
grant execute on function public.apply_inventory_movement(uuid,uuid,uuid,text,integer,integer,text,uuid,text,text) to authenticated;

-- public.set_commercial_product_publication(uuid,text,boolean)
CREATE OR REPLACE FUNCTION public.set_commercial_product_publication(p_business_id uuid, p_sku text, p_publish boolean)
 RETURNS TABLE(applied_sku text, applied_available boolean, applied_is_verified boolean, applied_price numeric, applied_stock integer, applied_price_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
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
    return;
  end if;

  -- La publicación desde el Panel sólo opera sobre la autoridad comercial.
  if coalesce(v_product.catalog_origin, '') <> 'commercial' then
    raise exception 'Refusing to publish non-commercial sku %.', v_sku;
  end if;

  -- ── publicar: producto YA verificado, nunca se verifica acá por primera vez ─
  if not v_product.is_verified then
    raise exception 'Sku % is not verified yet. Verify its master data first (commercial import), then publish.', v_sku;
  end if;
  if not v_product.is_active then
    raise exception 'Refusing to publish inactive sku %.', v_sku;
  end if;
  if v_product.price_status <> 'confirmed' or coalesce(v_product.price, 0) <= 0 then
    raise exception 'Refusing to publish sku % without a confirmed price.', v_sku;
  end if;
  if coalesce(v_product.stock, 0) <= 0 then
    raise exception 'Refusing to publish sku % without stock.', v_sku;
  end if;
  if not public.product_commercial_image_valid(v_product) then
    raise exception 'Refusing to publish sku %: it must have no image at all, or a complete image bound to an approved commercial asset.', v_sku;
  end if;
  if v_product.is_alcoholic then
    select * into v_business from public.businesses b where b.id = p_business_id;
    if not found or coalesce(v_business.alcohol_sales_enabled, false) is not true then
      raise exception 'Refusing to publish sku %: alcohol sales are not enabled for this business (license gate).', v_sku;
    end if;
  end if;

  return query
    update public.products p
       set available = true,
           merchant_available = true,
           updated_at = statement_timestamp()
     where p.id = v_product.id
    returning p.sku, p.available, p.is_verified, p.price, p.stock, p.price_status;
end;
$function$;

revoke all on function public.set_commercial_product_publication(uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.set_commercial_product_publication(uuid,text,boolean) to authenticated;

-- public.publish_catalog_product(uuid,text,boolean)
CREATE OR REPLACE FUNCTION public.publish_catalog_product(p_business_id uuid, p_external_id text, p_available boolean DEFAULT false)
 RETURNS TABLE(product_id uuid, published_external_id text, published_sku text, published_is_verified boolean, published_available boolean, published_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
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
$function$;

revoke all on function public.publish_catalog_product(uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.publish_catalog_product(uuid,text,boolean) to authenticated;

-- public.unpublish_catalog_product(uuid,text)
CREATE OR REPLACE FUNCTION public.unpublish_catalog_product(p_business_id uuid, p_external_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_updated integer;
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can unpublish catalog products.';
  end if;
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
  return v_updated = 1;
end;
$function$;

revoke all on function public.unpublish_catalog_product(uuid,text) from public, anon, authenticated;
grant execute on function public.unpublish_catalog_product(uuid,text) to authenticated;

-- Las piezas privadas ya no las llama nadie.
drop function if exists private.catalog_stock_count_settle(uuid, uuid, integer, integer, integer, integer, text, text, uuid, text, boolean);
drop function if exists private.catalog_change_record_single(text, public.products, jsonb, integer, integer, uuid, jsonb);
drop function if exists private.catalog_change_log_item(uuid, text, public.products, public.products, integer, integer, uuid, jsonb);
drop function if exists private.catalog_change_begin(uuid, text, jsonb);
drop function if exists private.catalog_change_image(public.products);

-- El rastro: se va sólo si está vacío.
do $catalog_change_trail$
begin
  if exists (select 1 from public.catalog_change_batches) then
    revoke all on table public.catalog_change_batches, public.catalog_change_items
      from public, anon, authenticated;
    raise notice 'catalog_change_batches tiene filas: las tablas del rastro se conservan, sin permisos para clientes';
  else
    drop table public.catalog_change_items;
    drop table public.catalog_change_batches;
    drop function private.catalog_change_item_immutable();
    drop function private.catalog_change_batch_guard();
  end if;
end
$catalog_change_trail$;

commit;
