-- ============================================================================
-- CATÁLOGO · COSTO PRIVADO, PRECIO REGULAR (PROMO) Y LECTURA DE COSTOS
-- ============================================================================
--
-- POR QUÉ
-- -------
-- El Panel calcula ganancia, margen sobre venta y recargo sobre costo, e
-- importa la planilla «Productos» con costo, precio de venta, precio regular,
-- stock y publicación. Hasta acá no había cómo: `unit_cost` existía pero sólo
-- lo escribía el alta por escáner y nadie lo podía leer (20261005210000 le
-- sacó el SELECT a anon y authenticated, con razón), y no había dónde guardar
-- el precio de antes de una promo.
--
-- QUÉ AGREGA
-- ----------
-- 1. `products.compare_at_price` numeric(12, 2), nulo por defecto: el PRECIO
--    REGULAR que la tienda puede mostrar como «Antes $ X». Lo que se cobra es
--    SIEMPRE `products.price` —ni el checkout ni los pedidos leen esta
--    columna—, así que no existe una promo de mentira: el precio promocional
--    ES el precio. La base exige `compare_at_price is null or compare_at_price
--    > price`. Es pública como el precio: SELECT por columna para anon y
--    authenticated (desde 20261005210000 una columna nueva nace sin leer).
--
-- 2. `apply_commercial_catalog_batch`: MISMA firma `(uuid, jsonb)`, MISMO
--    retorno, mismas validaciones y compuertas. Acepta dos claves OPCIONALES
--    por fila:
--      · `unit_cost`         costo del comercio: ^[0-9]+([.][0-9]{1,2})?$, cero o más;
--      · `compare_at_price`  precio regular: mismo formato, mayor que cero y
--                            mayor que el precio de venta que deja la fila.
--    En las dos: clave ausente o texto en blanco → no se toca (igual que
--    precio y stock); JSON null → se BORRA (sin costo / fin de la promo).
--    Ninguna despublica: no están en la lista de datos maestros de
--    `fail_close_verified_product_master_change` (20260725110000, que no se
--    toca). Una fila que deja el precio de venta en o por encima del precio
--    regular guardado se rechaza con un mensaje propio (22023) antes de que la
--    frene el CHECK con un mensaje crudo.
--    La negativa de autorización ahora sale con errcode 42501: antes salía
--    como P0001 y el Panel no la distinguía de un dato inválido.
--
-- 3. `get_catalog_costs(p_business_id)`: sku, price, unit_cost y
--    compare_at_price del catálogo comercial del negocio, sólo para dueño o
--    encargado (42501 para cualquier otro). `unit_cost` sigue sin SELECT para
--    anon y authenticated: ésta es su única lectura y exige el rol.
--
-- QUÉ NO CAMBIA
--   · Checkout, pedidos, reservas y stock: no leen ninguna columna nueva.
--   · Quien manda las filas de siempre obtiene exactamente lo mismo que antes.
--   · Los mensajes existentes de la planilla (los leen los ensayos y el Panel).
--
-- Forward-only e idempotente. No cambia ni borra filas.
-- REVERSIÓN (sólo si hiciera falta, en este orden):
--   1. recrear `apply_commercial_catalog_batch` con el cuerpo de
--      20260928160000_publish_sets_merchant_intent.sql (misma firma);
--   2. drop function public.get_catalog_costs(uuid);
--   3. alter table public.products drop constraint products_compare_at_price_check;
--      alter table public.products drop column compare_at_price;
-- ============================================================================

-- ── 1 · Precio regular ──────────────────────────────────────────────────────
alter table public.products add column if not exists compare_at_price numeric(12, 2);

alter table public.products drop constraint if exists products_compare_at_price_check;
alter table public.products add constraint products_compare_at_price_check
  check (compare_at_price is null or compare_at_price > price);

comment on column public.products.compare_at_price is
  'PÚBLICA: precio regular que la tienda muestra como «Antes» en una promo. Se cobra siempre price; la base exige compare_at_price > price. Se escribe por apply_commercial_catalog_batch.';

grant select (compare_at_price) on table public.products to anon, authenticated;

-- ── 2 · La planilla escribe costo y precio regular ──────────────────────────
create or replace function public.apply_commercial_catalog_batch(p_business_id uuid, p_rows jsonb)
returns table(applied_sku text, applied_price numeric, applied_stock integer, applied_available boolean,
  applied_is_verified boolean, applied_republished boolean, applied_price_status text)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $apply_commercial_catalog_batch$
declare
  v_row jsonb;
  v_sku text;
  v_product public.products%rowtype;
  v_price numeric(12, 2);
  v_stock integer;
  v_publish boolean;
  v_price_pending boolean;
  v_cost numeric(12, 2);
  v_cost_set boolean;
  v_compare numeric(12, 2);
  v_compare_set boolean;
  v_next_price numeric(12, 2);
  v_next_stock integer;
  v_next_available boolean;
  v_next_verified boolean;
  v_next_price_status text;
  v_next_compare numeric(12, 2);
  v_was_published boolean;
  v_asset_ok boolean;
  v_alcohol_open boolean;
  v_seen text[] := '{}';
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can apply commercial catalog values.'
      using errcode = '42501';
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

    -- ── costo (privado del comercio) ─────────────────────────────────────────
    -- Clave ausente o texto en blanco: no se toca. JSON null: se borra.
    -- `v_row -> 'x' is not null` es «la clave está», aunque valga JSON null.
    v_cost := null;
    v_cost_set := false;
    if v_row -> 'unit_cost' is not null then
      if jsonb_typeof(v_row -> 'unit_cost') = 'null' then
        v_cost_set := true;
      elsif jsonb_typeof(v_row -> 'unit_cost') not in ('string', 'number') then
        raise exception 'Invalid unit_cost format for sku %.', v_sku using errcode = '22023';
      elsif btrim(v_row ->> 'unit_cost') <> '' then
        if (v_row ->> 'unit_cost') !~ '^[0-9]+([.][0-9]{1,2})?$' then
          raise exception 'Invalid unit_cost format for sku %.', v_sku using errcode = '22023';
        end if;
        if (v_row ->> 'unit_cost')::numeric > 9999999999.99 then
          raise exception 'Invalid unit_cost value for sku %.', v_sku using errcode = '22023';
        end if;
        v_cost := (v_row ->> 'unit_cost')::numeric;
        v_cost_set := true;
      end if;
    end if;

    -- ── precio regular (el «Antes» de una promo) ─────────────────────────────
    v_compare := null;
    v_compare_set := false;
    if v_row -> 'compare_at_price' is not null then
      if jsonb_typeof(v_row -> 'compare_at_price') = 'null' then
        v_compare_set := true;
      elsif jsonb_typeof(v_row -> 'compare_at_price') not in ('string', 'number') then
        raise exception 'Invalid compare_at_price format for sku %.', v_sku using errcode = '22023';
      elsif btrim(v_row ->> 'compare_at_price') <> '' then
        if (v_row ->> 'compare_at_price') !~ '^[0-9]+([.][0-9]{1,2})?$' then
          raise exception 'Invalid compare_at_price format for sku %.', v_sku using errcode = '22023';
        end if;
        if (v_row ->> 'compare_at_price')::numeric <= 0
           or (v_row ->> 'compare_at_price')::numeric > 9999999999.99 then
          raise exception 'Invalid compare_at_price value for sku %.', v_sku using errcode = '22023';
        end if;
        v_compare := (v_row ->> 'compare_at_price')::numeric;
        v_compare_set := true;
      end if;
    end if;

    if v_price is null and v_stock is null and v_publish is null and v_price_pending is null
       and not v_cost_set and not v_compare_set then
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

    -- El precio regular tiene que quedar por ENCIMA del precio que se cobra,
    -- también cuando la fila sólo cambia el precio y la promo ya estaba.
    v_next_compare := case when v_compare_set then v_compare else v_product.compare_at_price end;
    if v_next_compare is not null and v_next_compare <= coalesce(v_next_price, 0) then
      raise exception 'compare_at_price for sku % must be greater than the price.', v_sku
        using errcode = '22023';
    end if;

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
           -- Costo y precio regular: ninguno es dato maestro, ninguno despublica.
           unit_cost = case when v_cost_set then v_cost else p.unit_cost end,
           compare_at_price = v_next_compare,
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
$apply_commercial_catalog_batch$;

revoke all on function public.apply_commercial_catalog_batch(uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.apply_commercial_catalog_batch(uuid, jsonb)
to authenticated;

comment on function public.apply_commercial_catalog_batch(uuid, jsonb) is
  'Atomic owner/admin update of price, price_status, stock, publication, unit_cost and compare_at_price for products that already exist (1 to 500 rows, keyed by sku). Loading a price confirms it; an omitted value preserves state; JSON null on unit_cost or compare_at_price clears it. compare_at_price must stay above the price. Nothing stays available without a confirmed price above zero and known stock above zero; publishing keeps every gate (image, alcohol licence). unit_cost and compare_at_price never unpublish. Unauthorized callers get 42501.';

-- ── 3 · Lectura de costos para el Panel ─────────────────────────────────────
create or replace function public.get_catalog_costs(p_business_id uuid)
returns table(sku text, price numeric, unit_cost numeric, compare_at_price numeric)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $get_catalog_costs$
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can read catalog costs.'
      using errcode = '42501';
  end if;
  return query
    select p.sku, p.price, p.unit_cost, p.compare_at_price
      from public.products p
     where p.business_id = p_business_id
       and p.catalog_origin = 'commercial'
       and p.sku is not null
     order by p.sku;
end;
$get_catalog_costs$;

revoke all on function public.get_catalog_costs(uuid) from public, anon, authenticated;
grant execute on function public.get_catalog_costs(uuid) to authenticated;

comment on function public.get_catalog_costs(uuid) is
  'Owner/admin read of the commercial catalog costs: sku, price, unit_cost (private: no column SELECT for anon/authenticated) and compare_at_price. Anyone else gets 42501.';
