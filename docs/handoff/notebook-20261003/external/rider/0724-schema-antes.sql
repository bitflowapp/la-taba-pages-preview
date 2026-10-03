


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






CREATE SCHEMA IF NOT EXISTS "private";


ALTER SCHEMA "private" OWNER TO "postgres";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "private"."capture_rider_map_order_location_snapshot"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'private', 'extensions', 'pg_temp'
    AS $$
declare
  v_business private.rider_map_business_locations%rowtype;
begin
  select *
    into v_business
    from private.rider_map_business_locations
   where business_id = new.business_id;

  insert into private.rider_map_order_location_snapshots (
    order_id,
    business_latitude,
    business_longitude,
    business_source,
    business_accuracy_m,
    customer_latitude,
    customer_longitude,
    customer_source,
    customer_accuracy_m
  ) values (
    new.id,
    case when v_business.latitude between -90 and 90
              and v_business.longitude between -180 and 180
         then v_business.latitude end,
    case when v_business.latitude between -90 and 90
              and v_business.longitude between -180 and 180
         then v_business.longitude end,
    case when v_business.latitude between -90 and 90
              and v_business.longitude between -180 and 180
         then v_business.source end,
    case when v_business.latitude between -90 and 90
              and v_business.longitude between -180 and 180
         then v_business.accuracy_m end,
    case when new.delivery_latitude between -90 and 90
              and new.delivery_longitude between -180 and 180
         then new.delivery_latitude end,
    case when new.delivery_latitude between -90 and 90
              and new.delivery_longitude between -180 and 180
         then new.delivery_longitude end,
    case when new.delivery_latitude between -90 and 90
              and new.delivery_longitude between -180 and 180
         then nullif(new.delivery_address_source, '') end,
    case when new.delivery_latitude between -90 and 90
              and new.delivery_longitude between -180 and 180
         then new.delivery_geolocation_accuracy end
  )
  on conflict (order_id) do nothing;

  return new;
end;
$$;


ALTER FUNCTION "private"."capture_rider_map_order_location_snapshot"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."rider_map_location_payload"("p_order_id" "uuid", "p_reveal_customer" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'private', 'extensions', 'pg_temp'
    AS $$
declare
  v_order public.orders%rowtype;
  v_snapshot private.rider_map_order_location_snapshots%rowtype;
  v_can_reveal_customer boolean := false;
begin
  select * into v_order
    from public.orders
   where id = p_order_id;
  if not found then
    return jsonb_build_object('business_location', null, 'customer_location', null);
  end if;

  select * into v_snapshot
    from private.rider_map_order_location_snapshots
   where order_id = p_order_id;

  v_can_reveal_customer := coalesce(p_reveal_customer, false)
    and v_order.assigned_rider_user_id is not distinct from auth.uid()
    and v_order.status in ('assigned', 'picked_up', 'on_the_way', 'arrived')
    and exists (
      select 1
        from public.business_members bm
       where bm.business_id = v_order.business_id
         and bm.user_id = auth.uid()
         and bm.role = 'rider'
         and bm.is_active = true
    );

  return jsonb_build_object(
    'business_location', case
      when v_snapshot.business_latitude between -90 and 90
       and v_snapshot.business_longitude between -180 and 180 then
        jsonb_strip_nulls(jsonb_build_object(
          'latitude', v_snapshot.business_latitude,
          'longitude', v_snapshot.business_longitude,
          'source', v_snapshot.business_source,
          'accuracy_m', v_snapshot.business_accuracy_m
        ))
      else null
    end,
    'customer_location', case
      when v_can_reveal_customer
       and v_snapshot.customer_latitude between -90 and 90
       and v_snapshot.customer_longitude between -180 and 180 then
        jsonb_strip_nulls(jsonb_build_object(
          'latitude', v_snapshot.customer_latitude,
          'longitude', v_snapshot.customer_longitude,
          'source', v_snapshot.customer_source,
          'accuracy_m', v_snapshot.customer_accuracy_m
        ))
      else null
    end
  );
end;
$$;


ALTER FUNCTION "private"."rider_map_location_payload"("p_order_id" "uuid", "p_reveal_customer" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."acknowledge_order"("p_order_id" "uuid", "p_expected_revision" bigint, "p_idempotency_key" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
declare
  v_order public.orders%rowtype;
  v_existing public.business_command_receipts%rowtype;
  v_hash text;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'autenticacion requerida' using errcode = '42501'; end if;
  if p_expected_revision is null or p_expected_revision < 1 then raise exception 'expected_revision requerido' using errcode = '22023'; end if;
  if btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9:_-]{8,128}$' then raise exception 'idempotency_key invalida' using errcode = '22023'; end if;

  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'pedido inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_order.business_id, array['owner', 'admin', 'staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;

  v_hash := public.business_command_request_hash('acknowledge_order', p_order_id, jsonb_build_object('expected_revision', p_expected_revision));
  select r.* into v_existing from public.business_command_receipts r
   where r.business_id = v_order.business_id and r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_key reutilizada con otro payload' using errcode = '23505'; end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;
  if v_order.revision <> p_expected_revision then raise exception 'revision desactualizada' using errcode = '40001'; end if;
  if public.normalize_order_status_vocabulary(v_order.status) not in ('submitted', 'accepted', 'preparing') then raise exception 'pedido no reconocible en estado actual' using errcode = 'P0001'; end if;

  update public.orders set acknowledged_at = coalesce(acknowledged_at, now()), acknowledged_by = coalesce(acknowledged_by, auth.uid()) where id = p_order_id;
  insert into public.order_events(order_id, business_id, actor_user_id, actor_role, event_type, type, message, metadata)
  values (p_order_id, v_order.business_id, auth.uid(), 'business', 'business_acknowledged', 'business_acknowledged', 'Pedido reconocido por el negocio.', '{}'::jsonb);
  select to_jsonb(o) into v_result from public.orders o where o.id = p_order_id;
  insert into public.business_command_receipts(business_id, order_id, actor_user_id, command_type, idempotency_key, request_hash, result)
  values (v_order.business_id, p_order_id, auth.uid(), 'acknowledge_order', p_idempotency_key, v_hash, v_result);
  return v_result || jsonb_build_object('idempotent_replay', false);
end;
$_$;


ALTER FUNCTION "public"."acknowledge_order"("p_order_id" "uuid", "p_expected_revision" bigint, "p_idempotency_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_commercial_catalog_batch"("p_business_id" "uuid", "p_rows" "jsonb") RETURNS TABLE("applied_sku" "text", "applied_price" numeric, "applied_stock" integer, "applied_available" boolean, "applied_is_verified" boolean, "applied_republished" boolean, "applied_price_status" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
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
        raise exception 'Refusing to publish sku % without matching approved asset.', v_sku;
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
    -- TODAS las compuertas, incluida la del estado del precio.
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
$_$;


ALTER FUNCTION "public"."apply_commercial_catalog_batch"("p_business_id" "uuid", "p_rows" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."apply_commercial_catalog_batch"("p_business_id" "uuid", "p_rows" "jsonb") IS 'Atomic owner/admin update of price, price_status, stock and publication for products that already exist. Loading a price confirms it; an omitted value preserves state; nothing stays available without a confirmed price above zero and known stock above zero.';


SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."inventory_movements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "barcode_id" "uuid",
    "movement_type" "text" NOT NULL,
    "quantity_delta" integer NOT NULL,
    "previous_stock" integer NOT NULL,
    "resulting_stock" integer NOT NULL,
    "unit_factor" integer NOT NULL,
    "reference_type" "text",
    "reference_id" "uuid",
    "reason" "text",
    "operator_id" "uuid" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "inventory_adjustment_reason_required" CHECK ((("movement_type" <> ALL (ARRAY['manual_adjustment'::"text", 'stock_count'::"text", 'damage'::"text", 'loss'::"text", 'expiration'::"text", 'supplier_return'::"text"])) OR (("char_length"("btrim"(COALESCE("reason", ''::"text"))) >= 3) AND ("char_length"("btrim"(COALESCE("reason", ''::"text"))) <= 300)))),
    CONSTRAINT "inventory_movements_movement_type_check" CHECK (("movement_type" = ANY (ARRAY['purchase_receipt'::"text", 'manual_adjustment'::"text", 'stock_count'::"text", 'sale'::"text", 'online_order_reservation'::"text", 'online_order_release'::"text", 'cancellation_return'::"text", 'damage'::"text", 'loss'::"text", 'expiration'::"text", 'supplier_return'::"text"]))),
    CONSTRAINT "inventory_movements_quantity_delta_check" CHECK (("quantity_delta" <> 0)),
    CONSTRAINT "inventory_movements_unit_factor_check" CHECK (("unit_factor" > 0))
);


ALTER TABLE "public"."inventory_movements" OWNER TO "postgres";


COMMENT ON TABLE "public"."inventory_movements" IS 'Ledger inmutable; las correcciones se realizan con movimientos compensatorios.';



CREATE OR REPLACE FUNCTION "public"."apply_inventory_movement"("p_business_id" "uuid", "p_product_id" "uuid", "p_barcode_id" "uuid", "p_movement_type" "text", "p_package_quantity" integer, "p_direction" integer, "p_reference_type" "text", "p_reference_id" "uuid", "p_reason" "text", "p_idempotency_key" "text") RETURNS "public"."inventory_movements"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
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
$_$;


ALTER FUNCTION "public"."apply_inventory_movement"("p_business_id" "uuid", "p_product_id" "uuid", "p_barcode_id" "uuid", "p_movement_type" "text", "p_package_quantity" integer, "p_direction" integer, "p_reference_type" "text", "p_reference_id" "uuid", "p_reason" "text", "p_idempotency_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_pending_delivery_location"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_pending jsonb;
begin
  if coalesce(new.fulfillment_type, new.delivery_mode) is distinct from 'delivery' then
    return new;
  end if;
  if new.delivery_latitude is not null and new.delivery_location_confirmed_at is not null then
    return new;
  end if;
  v_pending := nullif(btrim(coalesce(current_setting('taba.pending_delivery_location', true), '')), '')::jsonb;
  if v_pending is null then
    return new;
  end if;
  new.delivery_latitude := coalesce(new.delivery_latitude, (v_pending ->> 'latitude')::numeric(9, 6));
  new.delivery_longitude := coalesce(new.delivery_longitude, (v_pending ->> 'longitude')::numeric(9, 6));
  new.delivery_geolocation_accuracy := coalesce(
    new.delivery_geolocation_accuracy,
    nullif(v_pending ->> 'accuracy', '')::numeric(10, 2)
  );
  new.delivery_location_source := coalesce(new.delivery_location_source, v_pending ->> 'location_source');
  new.delivery_location_confirmed_at := coalesce(
    new.delivery_location_confirmed_at,
    (v_pending ->> 'confirmed_at')::timestamptz
  );
  new.delivery_address_source := coalesce(new.delivery_address_source, v_pending ->> 'address_source');
  return new;
end;
$$;


ALTER FUNCTION "public"."apply_pending_delivery_location"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."archive_current_customer_address"("p_address_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_customer_id uuid := auth.uid();
  v_address public.customer_addresses%rowtype;
  v_replacement_id uuid;
begin
  if v_customer_id is null then
    raise exception 'autenticacion de cliente requerida' using errcode = '42501';
  end if;
  select * into v_address
    from public.customer_addresses a
   where a.id = p_address_id and a.customer_id = v_customer_id and a.deleted_at is null
   for update;
  if not found then
    raise exception 'direccion no encontrada' using errcode = '42501';
  end if;
  update public.customer_addresses
     set deleted_at = now(), is_default = false
   where id = v_address.id;
  if v_address.is_default then
    select a.id into v_replacement_id
      from public.customer_addresses a
     where a.customer_id = v_customer_id and a.deleted_at is null
     order by a.last_used_at desc nulls last, a.updated_at desc, a.id
     limit 1
     for update;
    if v_replacement_id is not null then
      update public.customer_addresses set is_default = true where id = v_replacement_id;
    end if;
  end if;
  return jsonb_build_object('id', v_address.id, 'archived', true, 'replacementId', v_replacement_id);
end;
$$;


ALTER FUNCTION "public"."archive_current_customer_address"("p_address_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assert_fiscal_execution_authorized"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_profile public.fiscal_profiles%rowtype;
begin
  select * into v_profile from public.fiscal_profiles where business_id = new.business_id for share;
  if not found then
    raise exception 'operacion fiscal no autorizada' using errcode = '42501';
  end if;

  if new.environment = 'homologation'
     and (v_profile.homologation_authorized_at is null or v_profile.homologation_authorized_by is null) then
    raise exception 'homologacion no autorizada' using errcode = '42501';
  end if;

  if new.environment = 'production'
     and (v_profile.accountant_review_status is distinct from 'approved'
          or v_profile.production_gate_status is distinct from 'approved') then
    raise exception 'produccion fiscal no autorizada' using errcode = '42501';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."assert_fiscal_execution_authorized"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."assert_fiscal_execution_authorized"() IS 'Exige autorización humana registrada antes de emitir un comprobante. Los mensajes son estables y saneados: no exponen constraints ni SQL.';



CREATE OR REPLACE FUNCTION "public"."assert_order_payment_modality"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  if new.payment_method <> 'mercadopago' then
    return null;
  end if;
  if not exists (
    select 1
      from public.payment_intents pi
     where pi.order_id = new.id
       and pi.provider = 'mercadopago'
       and pi.internal_status = 'completed'
  ) then
    raise exception
      'pedido % declara pago Mercado Pago sin intent verificado y completado', new.public_code
      using errcode = '23514';
  end if;
  return null;
end;
$$;


ALTER FUNCTION "public"."assert_order_payment_modality"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."assert_order_payment_modality"() IS 'Un pedido Mercado Pago debe tener un payment_intent verificado y completado ligado a él.';



CREATE OR REPLACE FUNCTION "public"."assign_operation_correlation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
begin
  if tg_table_name = 'payment_intents' then
    select cs.correlation_id into new.correlation_id
    from public.checkout_sessions cs
    where cs.id = new.checkout_session_id;
  elsif tg_table_name = 'order_packing_sessions' then
    select o.correlation_id into new.correlation_id
    from public.orders o
    where o.id = new.order_id;
  elsif tg_table_name = 'fiscal_print_jobs' then
    select fd.correlation_id into new.correlation_id
    from public.fiscal_documents fd
    where fd.id = new.fiscal_document_id;
  elsif tg_table_name = 'fiscal_documents' then
    if new.associated_document_id is not null then
      select fd.correlation_id into new.correlation_id
      from public.fiscal_documents fd
      where fd.id = new.associated_document_id;
    elsif new.source_type = 'online_order' then
      select o.correlation_id into new.correlation_id
      from public.orders o
      where o.id = new.source_id;
    elsif new.source_type = 'pos_sale' then
      select ps.correlation_id into new.correlation_id
      from public.pos_sales ps
      where ps.id = new.source_id;
    end if;
  end if;
  new.correlation_id := coalesce(new.correlation_id, gen_random_uuid());
  return new;
end;
$$;


ALTER FUNCTION "public"."assign_operation_correlation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assign_order_rider"("p_order_id" "uuid", "p_expected_status" "text", "p_expected_rider_user_id" "uuid", "p_new_rider_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_order public.orders%rowtype;
  v_user_id uuid := auth.uid();
  v_expected_status text := lower(btrim(coalesce(p_expected_status, '')));
begin
  if v_user_id is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if p_order_id is null or p_new_rider_user_id is null then
    raise exception 'order_id y rider requeridos' using errcode = '22023';
  end if;

  select o.*
    into v_order
    from public.orders o
   where o.id = p_order_id
   for update;

  if not found then
    raise exception 'pedido inexistente' using errcode = 'P0002';
  end if;
  perform 1
    from public.business_members bm
   where bm.business_id = v_order.business_id
     and bm.user_id = v_user_id
     and bm.role in ('owner', 'admin', 'staff')
     and bm.is_active = true
   for share;
  if not found then
    raise exception 'rol de negocio requerido' using errcode = '42501';
  end if;
  if v_order.delivery_mode <> 'delivery' then
    raise exception 'los pedidos con retiro no admiten rider' using errcode = '42501';
  end if;
  perform 1
    from public.business_members bm
   where bm.business_id = v_order.business_id
     and bm.user_id = p_new_rider_user_id
     and bm.role = 'rider'
     and bm.is_active = true
   for share;
  if not found then
    raise exception 'rider activo del negocio requerido' using errcode = '42501';
  end if;
  if v_expected_status not in ('ready', 'assigned')
    or v_order.status <> v_expected_status
    or v_order.status not in ('ready', 'assigned')
    or v_order.assigned_rider_user_id is distinct from p_expected_rider_user_id then
    raise exception 'conflicto de asignacion: estado o rider esperado cambio'
      using errcode = '40001';
  end if;

  if v_order.assigned_rider_user_id = p_new_rider_user_id
    and v_order.status = 'assigned' then
    return public.rider_order_rpc_payload(v_order.id);
  end if;

  update public.orders
     set assigned_rider_user_id = p_new_rider_user_id,
         status = 'assigned'
   where id = v_order.id;

  insert into public.order_events (
    order_id,
    business_id,
    actor_user_id,
    actor_role,
    actor_type,
    actor_id,
    event_type,
    type,
    message,
    metadata,
    payload
  ) values (
    v_order.id,
    v_order.business_id,
    v_user_id,
    'business',
    'business',
    v_user_id,
    case
      when v_order.assigned_rider_user_id is null
        then 'order.rider_assigned'
      else 'order.rider_reassigned'
    end,
    case
      when v_order.assigned_rider_user_id is null
        then 'order.rider_assigned'
      else 'order.rider_reassigned'
    end,
    case
      when v_order.assigned_rider_user_id is null
        then 'Rider asignado por el negocio'
      else 'Rider reasignado por el negocio'
    end,
    jsonb_build_object(
      'previous_rider_user_id', v_order.assigned_rider_user_id,
      'next_rider_user_id', p_new_rider_user_id
    ),
    jsonb_build_object(
      'previous_rider_user_id', v_order.assigned_rider_user_id,
      'next_rider_user_id', p_new_rider_user_id
    )
  );

  return public.rider_order_rpc_payload(v_order.id);
end;
$$;


ALTER FUNCTION "public"."assign_order_rider"("p_order_id" "uuid", "p_expected_status" "text", "p_expected_rider_user_id" "uuid", "p_new_rider_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."assign_order_rider"("p_order_id" "uuid", "p_expected_status" "text", "p_expected_rider_user_id" "uuid", "p_new_rider_user_id" "uuid") IS 'Business assignment/reassignment before pickup with row lock and status + assignee CAS.';



CREATE OR REPLACE FUNCTION "public"."authorize_arca_homologation"("p_business_id" "uuid", "p_authorization" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
declare
  v_profile public.fiscal_profiles%rowtype;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'autorizacion fiscal requiere owner o admin' using errcode = '42501';
  end if;
  if p_authorization is distinct from 'I_AUTHORIZE_ARCA_HOMOLOGATION' then
    raise exception 'autorizacion de homologacion ausente' using errcode = '22023';
  end if;

  select * into v_profile from public.fiscal_profiles where business_id = p_business_id for update;
  if not found then
    raise exception 'perfil fiscal inexistente' using errcode = 'P0002';
  end if;
  if v_profile.accountant_review_status <> 'approved' then
    raise exception 'falta la aprobacion contable' using errcode = 'P0001';
  end if;
  if coalesce(v_profile.cuit, '') !~ '^[0-9]{11}$'
     or coalesce(v_profile.point_of_sale, 0) < 1
     or coalesce(btrim(v_profile.legal_name), '') = ''
     or coalesce(btrim(v_profile.tax_condition), '') = '' then
    raise exception 'faltan datos fiscales obligatorios' using errcode = '22023';
  end if;
  if v_profile.certificate_fingerprint_sha256 is null then
    raise exception 'falta el certificado' using errcode = 'P0001';
  end if;
  if v_profile.certificate_expires_at is not null and v_profile.certificate_expires_at <= clock_timestamp() then
    raise exception 'certificado vencido' using errcode = 'P0001';
  end if;

  update public.fiscal_profiles set
    environment = 'homologation',
    is_enabled = true,
    homologation_authorized_at = clock_timestamp(),
    homologation_authorized_by = auth.uid(),
    updated_at = now()
  where business_id = p_business_id
  returning * into v_profile;

  insert into public.fiscal_profile_events (business_id, event_type, actor_id, detail)
  values (p_business_id, 'homologation_authorized', auth.uid(), jsonb_build_object('environment', v_profile.environment));

  return jsonb_build_object('ok', true, 'environment', v_profile.environment);
end;
$_$;


ALTER FUNCTION "public"."authorize_arca_homologation"("p_business_id" "uuid", "p_authorization" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."authorize_arca_homologation"("p_business_id" "uuid", "p_authorization" "text") IS 'Habilita las pruebas con ARCA sólo con la frase exacta I_AUTHORIZE_ARCA_HOMOLOGATION y deja registrado quién autorizó.';



CREATE OR REPLACE FUNCTION "public"."authorize_fiscal_artifact_access"("p_artifact_id" "uuid", "p_action" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_artifact public.fiscal_document_artifacts%rowtype;
begin
  if p_action not in ('preview','download','print') then raise exception 'accion de artefacto invalida' using errcode = '22023'; end if;
  select a.* into v_artifact from public.fiscal_document_artifacts a where a.id = p_artifact_id and a.is_current and a.state = 'artifact_ready';
  if not found then raise exception 'artefacto fiscal no disponible' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_artifact.business_id, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  insert into public.fiscal_events(fiscal_document_id, event_type, actor_type, actor_id, sanitized_detail)
  values(v_artifact.fiscal_document_id, concat('artifact_', p_action, '_authorized'), 'operator', auth.uid(), jsonb_build_object('artifact_id', v_artifact.id));
  return jsonb_build_object(
    'artifact_id', v_artifact.id,
    'mime_type', v_artifact.mime_type,
    'sha256', v_artifact.sha256,
    'expires_in_seconds', 60
  );
end;
$$;


ALTER FUNCTION "public"."authorize_fiscal_artifact_access"("p_artifact_id" "uuid", "p_action" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."build_operational_health"("p_business_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_now timestamptz := clock_timestamp();
  v_sweep record;
  v_result jsonb;
begin
  select r.status, r.started_at, r.finished_at, r.businesses_evaluated,
         r.findings, r.open_alerts, r.critical_alerts, r.failures
    into v_sweep
    from public.operational_sweep_runs r
   where r.scope = 'operational_alerts'
   order by r.started_at desc
   limit 1;

  select jsonb_build_object(
    'generated_at', v_now,
    'business_id', p_business_id,

    -- ¿Se está evaluando solo? Es la pregunta que ordena todo el resto.
    'autonomous_evaluation', jsonb_build_object(
      'expected_every_seconds', 60,
      'last_run_at', v_sweep.started_at,
      'seconds_since_last_run', case when v_sweep.started_at is null then null
        else round(extract(epoch from (v_now - v_sweep.started_at))) end,
      'last_status', v_sweep.status,
      'businesses_evaluated', v_sweep.businesses_evaluated,
      'findings', v_sweep.findings,
      'failures', coalesce(v_sweep.failures, '[]'::jsonb),
      'state', case
        when v_sweep.started_at is null then 'desconocido'
        when v_sweep.started_at < v_now - interval '5 minutes' then 'detenido'
        when v_sweep.status = 'failed' then 'fallando'
        when v_sweep.status = 'partial' then 'degradado'
        else 'al día'
      end
    ),

    -- El planificador, job por job. Sin fila, sin afirmación.
    'scheduler', coalesce((
      select jsonb_agg(jsonb_build_object(
        'job', sh.job_name,
        'schedule', sh.schedule,
        'active', sh.active,
        'last_start', sh.last_start,
        'last_success_at', sh.last_success_at,
        'seconds_since_success', case when sh.last_success_at is null then null
          else round(extract(epoch from (v_now - sh.last_success_at))) end,
        'failures_since_success', sh.failures_since_success,
        'state', case
          when not sh.active then 'apagado'
          when sh.last_success_at is null then 'sin ninguna corrida exitosa'
          when sh.last_success_at < v_now - interval '15 minutes' then 'detenido'
          when sh.failures_since_success >= 3 then 'fallando'
          when sh.failures_since_success > 0 then 'con fallos recientes'
          else 'al día'
        end
      ) order by sh.job_name)
      from public.list_scheduler_health() sh
    ), '[]'::jsonb),

    -- Cobros: la cola, el procesador y la reconciliación con el proveedor.
    'payments', jsonb_build_object(
      'outbox', (
        select jsonb_build_object(
          'pending', count(*) filter (where po.status = 'pending'),
          'retry_wait', count(*) filter (where po.status = 'retry_wait'),
          'in_flight', count(*) filter (where po.status in ('claimed','processing')),
          'failed', count(*) filter (where po.status = 'failed'),
          'dead_letter', count(*) filter (where po.status = 'dead_letter'),
          'due_now', count(*) filter (where
            (po.status in ('pending','retry_wait') and po.next_attempt_at <= v_now)
            or (po.status in ('claimed','processing') and po.lease_expires_at < v_now)),
          'oldest_due_seconds', coalesce(round(extract(epoch from (v_now - min(po.next_attempt_at) filter (where
            po.status in ('pending','retry_wait') and po.next_attempt_at <= v_now)))), 0)
        )
        from public.payment_outbox po
        join public.payment_intents pi on pi.id = po.payment_intent_id
        where pi.business_id = p_business_id
      ),
      'worker', (
        select jsonb_build_object(
          'last_success_at', max(po.completed_at),
          'seconds_since_success', case when max(po.completed_at) is null then null
            else round(extract(epoch from (v_now - max(po.completed_at)))) end,
          'completed_last_hour', count(*) filter (where po.completed_at > v_now - interval '1 hour'),
          'last_failure_at', max(po.updated_at) filter (where po.status in ('failed','dead_letter')),
          'failed_last_hour', count(*) filter (
            where po.status in ('failed','dead_letter') and po.updated_at > v_now - interval '1 hour'),
          'state', case
            when count(*) filter (where
              (po.status in ('pending','retry_wait') and po.next_attempt_at < v_now - interval '5 minutes')
              or (po.status in ('claimed','processing') and po.lease_expires_at < v_now - interval '5 minutes')) > 0
              then 'no está tomando trabajo'
            when count(*) filter (where po.status in ('dead_letter')) > 0 then 'con trabajos abandonados'
            when max(po.completed_at) is null then 'sin trabajo procesado todavía'
            else 'al día'
          end
        )
        from public.payment_outbox po
        join public.payment_intents pi on pi.id = po.payment_intent_id
        where pi.business_id = p_business_id
      ),
      'reconciliation', jsonb_build_object(
        -- Dinero adentro y ningún pedido: la definición del peor caso, contada
        -- por la misma función que ya es autoridad de eso.
        'paid_without_order', (
          select count(*)
          from public.list_unfinalized_paid_checkouts() u
          join public.checkout_sessions cs on cs.id = u.checkout_session_id
          where cs.business_id = p_business_id
        ),
        'probes_last_hour', (
          select count(*)
          from public.payment_events pe
          join public.payment_intents pi on pi.id = pe.payment_intent_id
          where pi.business_id = p_business_id
            and pe.event_type = 'payment.provider_probe_empty'
            and pe.server_recorded_at > v_now - interval '1 hour'
        ),
        'provider_answers_last_hour', (
          select count(*)
          from public.payment_events pe
          join public.payment_intents pi on pi.id = pe.payment_intent_id
          where pi.business_id = p_business_id
            and pe.server_recorded_at > v_now - interval '1 hour'
        ),
        'in_review', (
          select count(*) from public.payment_intents pi
          where pi.business_id = p_business_id
            and pi.internal_status in ('ambiguous','security_review_required','approved_order_pending')
        )
      )
    ),

    -- Pedidos que necesitan una persona, con el mismo criterio que las alertas.
    'orders_needing_attention', (
      select jsonb_build_object(
        'not_accepted', count(*) filter (
          where o.status in ('submitted','received')
            and o.acknowledged_at is null
            and o.created_at < v_now - interval '10 minutes'),
        'stalled', count(*) filter (
          where o.status in ('accepted','preparing')
            and coalesce(o.acknowledged_at, o.created_at)
                + make_interval(mins => coalesce(o.preparation_estimate_minutes, 30) + 30) < v_now),
        'ready_without_rider', count(*) filter (
          where o.status = 'ready'
            and coalesce(o.fulfillment_type, o.delivery_mode) = 'delivery'
            and o.assigned_rider_user_id is null
            and coalesce(o.ready_at, o.updated_at) < v_now - interval '15 minutes'),
        'active_deliveries', count(*) filter (
          where o.status in ('assigned','picked_up','on_the_way','arrived'))
      )
      from public.orders o
      where o.business_id = p_business_id
        and coalesce(o.origin, 'production') <> 'qa'
        and o.status not in ('delivered','canceled','cancelled','rejected','draft')
    ),

    'riders_without_signal', (
      select count(*) from public.operational_alerts a
      where a.business_id = p_business_id
        and a.alert_code = 'RIDER_SIGNAL_STALE'
        and a.status <> 'resolved'
    ),

    -- Stock retenido por checkouts que ya vencieron: se vacía la góndola sin
    -- haber vendido nada.
    'reservations', (
      select jsonb_build_object(
        'active', count(*) filter (where r.status = 'active'),
        'expired_still_held', count(*) filter (
          where r.status = 'active' and r.expires_at < v_now - interval '5 minutes'),
        'oldest_expired_minutes', coalesce(round(extract(epoch from (
          v_now - min(r.expires_at) filter (where r.status = 'active' and r.expires_at < v_now)
        )) / 60), 0)
      )
      from public.inventory_reservations r
      join public.checkout_sessions cs on cs.id = r.checkout_session_id
      where cs.business_id = p_business_id
    ),

    'alerts', (
      select jsonb_build_object(
        'open', count(*) filter (where a.status <> 'resolved'),
        'critical', count(*) filter (where a.status <> 'resolved' and a.severity = 'CRITICAL'),
        'action_required', count(*) filter (where a.status <> 'resolved' and a.severity = 'ACTION_REQUIRED'),
        'warning', count(*) filter (where a.status <> 'resolved' and a.severity = 'WARNING'),
        'acknowledged', count(*) filter (where a.status = 'acknowledged'),
        'oldest_open_at', min(a.first_seen_at) filter (where a.status <> 'resolved'),
        'detected_by_system_last_hour', (
          select count(*) from public.operational_alert_events e
          where e.business_id = p_business_id
            and e.event_type in ('detected','reopened')
            and e.actor_id is null
            and e.created_at > v_now - interval '1 hour'
        )
      )
      from public.operational_alerts a
      where a.business_id = p_business_id
    ),

    'secrets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', s.name, 'configured', s.configured, 'detail', s.detail
      ) order by s.name)
      from public.list_operational_secret_status() s
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;


ALTER FUNCTION "public"."build_operational_health"("p_business_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."build_operational_health"("p_business_id" "uuid") IS 'Salud operativa medida del negocio. Sin verificacion de rol: la usan el planificador y las pruebas. El camino humano es get_operational_health.';



CREATE OR REPLACE FUNCTION "public"."bump_checkout_session_revision"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  new.revision := old.revision;
  if new is distinct from old then
    new.revision := old.revision + 1;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."bump_checkout_session_revision"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bump_order_revision"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_masked public.orders%rowtype;
begin
  new.revision := old.revision;

  -- Sólo la reclasificación queda exenta. Cualquier update que además toque un
  -- campo operativo conserva la semántica original de avanzar la revisión.
  if (new.origin, new.origin_reason, new.origin_classified_at)
     is distinct from (old.origin, old.origin_reason, old.origin_classified_at) then
    v_masked := new;
    v_masked.origin := old.origin;
    v_masked.origin_reason := old.origin_reason;
    v_masked.origin_classified_at := old.origin_classified_at;
    v_masked.updated_at := old.updated_at;
    if not (v_masked is distinct from old) then
      return new;
    end if;
  end if;

  if new is distinct from old then
    new.revision := old.revision + 1;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."bump_order_revision"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."bump_order_revision"() IS 'Incrementa orders.revision en cada UPDATE que cambie la fila; ignora cualquier revision enviada por el cliente.';



CREATE OR REPLACE FUNCTION "public"."bump_product_combo_revision"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  new.updated_at := clock_timestamp();
  new.revision := old.revision;
  if new is distinct from old then
    new.revision := old.revision + 1;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."bump_product_combo_revision"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."business_command_request_hash"("p_command_type" "text", "p_order_id" "uuid", "p_payload" "jsonb") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
  select encode(digest(
    coalesce(p_command_type, '') || chr(10)
    || coalesce(p_order_id::text, '') || chr(10)
    || coalesce(p_payload, '{}'::jsonb)::text,
    'sha256'
  ), 'hex');
$$;


ALTER FUNCTION "public"."business_command_request_hash"("p_command_type" "text", "p_order_id" "uuid", "p_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_access_order"("target_order_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
  select exists (
    select 1
      from public.orders o
     where o.id = target_order_id
       and (
         (auth.uid() is not null and o.customer_user_id = auth.uid())
         or public.has_business_role(o.business_id, array['owner', 'admin', 'staff'])
         or (
           auth.uid() is not null
           and public.has_business_role(o.business_id, array['rider'])
           and o.delivery_mode = 'delivery'
           and o.assigned_rider_user_id = auth.uid()
           and o.status in ('assigned', 'picked_up', 'on_the_way', 'arrived')
         )
       )
  )
$$;


ALTER FUNCTION "public"."can_access_order"("target_order_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."can_access_order"("target_order_id" "uuid") IS 'Acceso a pedido por membresia, rider asignado o token publico vigente.';



CREATE OR REPLACE FUNCTION "public"."can_recover_paid_checkout"("p_payment_intent_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select exists (
    select 1
      from public.payment_intents pi
      join public.checkout_sessions cs on cs.id = pi.checkout_session_id
     where pi.id = p_payment_intent_id
       and pi.order_id is null
       and cs.completed_order_id is null
       and pi.provider_status = 'approved'
       and pi.paid_amount is not distinct from cs.total
       and pi.internal_status not in ('refunded', 'partially_refunded', 'charged_back', 'completed')
  );
$$;


ALTER FUNCTION "public"."can_recover_paid_checkout"("p_payment_intent_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."can_recover_paid_checkout"("p_payment_intent_id" "uuid") IS 'Verdadero cuando hay un cobro aprobado sin pedido que se puede rearmar desde el Panel.';



CREATE OR REPLACE FUNCTION "public"."cancel_order"("p_order_id" "uuid", "p_expected_revision" bigint, "p_reason" "text", "p_idempotency_key" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
declare
  v_order public.orders%rowtype;
  v_existing public.business_command_receipts%rowtype;
  v_hash text;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'autenticacion requerida' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 300 then raise exception 'motivo de cancelacion requerido' using errcode = '22023'; end if;
  if btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9:_-]{8,128}$' then raise exception 'idempotency_key invalida' using errcode = '22023'; end if;
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'pedido inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_order.business_id, array['owner', 'admin', 'staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  v_hash := public.business_command_request_hash('cancel_order', p_order_id, jsonb_build_object('expected_revision', p_expected_revision, 'reason', btrim(p_reason)));
  select r.* into v_existing from public.business_command_receipts r where r.business_id = v_order.business_id and r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_key reutilizada con otro payload' using errcode = '23505'; end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;
  v_result := public.transition_order(p_order_id, p_expected_revision, 'canceled');
  insert into public.order_events(order_id, business_id, actor_user_id, actor_role, event_type, type, message, metadata)
  values (p_order_id, v_order.business_id, auth.uid(), 'business', 'business_cancel_reason', 'business_cancel_reason', 'Cancelacion registrada.', jsonb_build_object('reason', btrim(p_reason)));
  insert into public.business_command_receipts(business_id, order_id, actor_user_id, command_type, idempotency_key, request_hash, result)
  values (v_order.business_id, p_order_id, auth.uid(), 'cancel_order', p_idempotency_key, v_hash, v_result);
  return v_result || jsonb_build_object('idempotent_replay', false);
end;
$_$;


ALTER FUNCTION "public"."cancel_order"("p_order_id" "uuid", "p_expected_revision" bigint, "p_reason" "text", "p_idempotency_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."catalog_asset_binding_sha256"("p_identity_sha256" "text", "p_kind" "text", "p_source_sha256" "text", "p_asset_sha256" "text", "p_width" integer, "p_height" integer, "p_path" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE STRICT
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."catalog_asset_binding_sha256"("p_identity_sha256" "text", "p_kind" "text", "p_source_sha256" "text", "p_asset_sha256" "text", "p_width" integer, "p_height" integer, "p_path" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."catalog_asset_path"("p_safe_sku" "text", "p_identity_sha256" "text", "p_kind" "text", "p_asset_sha256" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE STRICT
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."catalog_asset_path"("p_safe_sku" "text", "p_identity_sha256" "text", "p_kind" "text", "p_asset_sha256" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."catalog_image_identity_sha256"("p_external_id" "text", "p_sku" "text", "p_source_sha256" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE STRICT
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."catalog_image_identity_sha256"("p_external_id" "text", "p_sku" "text", "p_source_sha256" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."change_order_status"("p_order_id" "uuid", "p_expected_status" "text", "p_new_status" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_order public.orders%rowtype;
  v_user_id uuid := auth.uid();
  v_current_status text;
  v_expected_status text;
  v_new_status text;
  v_is_business boolean := false;
  v_is_rider boolean := false;
  v_is_customer boolean := false;
  v_allowed boolean := false;
  v_claim_rider boolean := false;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;

  v_expected_status := case lower(btrim(coalesce(p_expected_status, '')))
    when 'received' then 'submitted'
    when 'canceled' then 'cancelled'
    when 'arriving' then 'arrived'
    else lower(btrim(coalesce(p_expected_status, '')))
  end;
  v_new_status := case lower(btrim(coalesce(p_new_status, '')))
    when 'canceled' then 'cancelled'
    when 'arriving' then 'arrived'
    else lower(btrim(coalesce(p_new_status, '')))
  end;

  select o.*
    into v_order
    from public.orders o
   where o.id = p_order_id
   for update;

  if not found then
    raise exception 'pedido inexistente' using errcode = 'P0002';
  end if;

  v_current_status := case v_order.status
    when 'received' then 'submitted'
    when 'canceled' then 'cancelled'
    when 'arriving' then 'arrived'
    else v_order.status
  end;

  if v_expected_status = ''
    or v_new_status = ''
    or v_current_status <> v_expected_status then
    raise exception 'conflicto de estado: esperado %, actual %',
      v_expected_status,
      v_current_status
      using errcode = '40001';
  end if;

  if v_new_status not in (
    'accepted',
    'preparing',
    'ready',
    'assigned',
    'picked_up',
    'on_the_way',
    'arrived',
    'delivered',
    'cancelled',
    'rejected'
  ) then
    raise exception 'estado destino invalido' using errcode = '22023';
  end if;

  v_is_business := public.has_business_role(
    v_order.business_id,
    array['owner', 'admin', 'staff']
  );
  v_is_rider := public.has_business_role(
    v_order.business_id,
    array['rider']
  );
  v_is_customer := v_order.customer_user_id = v_user_id;

  if v_is_business then
    v_allowed :=
      (
        v_current_status in ('received', 'submitted')
        and v_new_status in ('accepted', 'rejected', 'cancelled')
      )
      or (
        v_current_status = 'accepted'
        and v_new_status in ('preparing', 'cancelled')
      )
      or (
        v_current_status = 'preparing'
        and v_new_status in ('ready', 'cancelled')
      )
      or (
        v_current_status = 'ready'
        and v_order.delivery_mode = 'pickup'
        and v_new_status = 'delivered'
      )
      or (
        v_current_status not in ('delivered', 'cancelled', 'rejected')
        and v_new_status = 'cancelled'
      );
  -- A rider may also be the customer who placed an order. Preserve the
  -- customer's right to cancel an initial order before evaluating rider-only
  -- transitions; later states still fall through to the rider rules.
  elsif v_is_customer
    and v_current_status in ('received', 'submitted')
    and v_new_status = 'cancelled' then
    v_allowed := true;
  elsif v_is_rider then
    if v_order.delivery_mode <> 'delivery' then
      raise exception 'los pedidos con retiro no admiten operacion de rider'
        using errcode = '42501';
    end if;

    if v_order.assigned_rider_user_id is not null
      and v_order.assigned_rider_user_id <> v_user_id then
      raise exception 'pedido asignado a otro rider' using errcode = '42501';
    end if;

    v_allowed :=
      (v_current_status = 'ready' and v_new_status in ('assigned', 'on_the_way'))
      or (v_current_status = 'assigned' and v_new_status in ('picked_up', 'on_the_way'))
      or (v_current_status = 'picked_up' and v_new_status = 'on_the_way')
      or (v_current_status = 'on_the_way' and v_new_status in ('arrived', 'delivered'))
      or (v_current_status = 'arrived' and v_new_status = 'delivered');

    v_claim_rider := v_allowed and v_order.assigned_rider_user_id is null;
  elsif v_is_customer then
    v_allowed := false;
  else
    raise exception 'sin permiso para cambiar este pedido' using errcode = '42501';
  end if;

  if not v_allowed then
    raise exception 'transicion no permitida: % -> %',
      v_current_status,
      v_new_status
      using errcode = '23514';
  end if;

  -- A pre-dispatch cancellation/rejection releases the reservation exactly
  -- once. Once picked up or dispatched, a status cancellation does not mean
  -- merchandise is physically back at the store, so stock remains unchanged
  -- until a separate, human-verified inventory adjustment. Availability remains
  -- fail-closed when stock is restored.
  if v_new_status in ('cancelled', 'rejected')
    and v_current_status not in ('picked_up', 'on_the_way', 'arrived')
    and v_order.inventory_released_at is null then
    perform p.id
      from public.products p
     where p.id in (
       select distinct oi.product_uuid
         from public.order_items oi
        where oi.order_id = v_order.id
          and oi.product_uuid is not null
     )
     order by p.id
     for update;

    update public.products p
       set stock = coalesce(p.stock, 0) + released.quantity
      from (
        select
          oi.product_uuid,
          sum(oi.quantity)::integer as quantity
        from public.order_items oi
        where oi.order_id = v_order.id
          and oi.product_uuid is not null
        group by oi.product_uuid
      ) as released
     where p.id = released.product_uuid;
  end if;

  update public.orders
     set status = v_new_status,
         assigned_rider_user_id = case
           when v_claim_rider then v_user_id
           else assigned_rider_user_id
         end,
          inventory_released_at = case
            when v_new_status in ('cancelled', 'rejected')
              and v_current_status not in ('picked_up', 'on_the_way', 'arrived')
              then coalesce(inventory_released_at, now())
            else inventory_released_at
         end
   where id = v_order.id;

  select to_jsonb(o)
         || jsonb_build_object(
              'order_items',
              coalesce(
                (
                  select jsonb_agg(to_jsonb(oi) order by oi.created_at, oi.id)
                    from public.order_items oi
                   where oi.order_id = o.id
                ),
                '[]'::jsonb
              ),
              'rider_locations',
              coalesce(
                (
                  select jsonb_agg(to_jsonb(rl) order by rl.created_at desc, rl.id)
                    from public.rider_locations rl
                   where rl.order_id = o.id
                     and rl.source = 'gps'
                ),
                '[]'::jsonb
              )
            )
    into v_result
    from public.orders o
   where o.id = v_order.id;

  return v_result;
end;
$$;


ALTER FUNCTION "public"."change_order_status"("p_order_id" "uuid", "p_expected_status" "text", "p_new_status" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."change_order_status"("p_order_id" "uuid", "p_expected_status" "text", "p_new_status" "text") IS 'Authenticated, role-aware order transition with expected-status concurrency control.';



CREATE OR REPLACE FUNCTION "public"."check_scheduler_watchdog"("p_source" "text" DEFAULT 'external'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_beat jsonb;
  v_healthy boolean;
  v_age numeric;
  v_last timestamptz;
  v_source text := left(coalesce(nullif(btrim(p_source), ''), 'external'), 40);
  v_business record;
  v_alert public.operational_alerts;
  v_fingerprint text;
  v_alert_id uuid;
  v_subject uuid := md5('scheduler_watchdog')::uuid;
  v_action text := 'ninguna';
  v_touched integer := 0;
begin
  v_beat := public.scheduler_heartbeat();
  v_healthy := coalesce((v_beat ->> 'healthy')::boolean, false);
  v_age := nullif(v_beat ->> 'age_seconds', '')::numeric;
  v_last := nullif(v_beat ->> 'last_run_at', '')::timestamptz;

  -- Dos sondas al mismo tiempo no tienen nada que agregar la una a la otra.
  if not pg_try_advisory_xact_lock(hashtext('taba:scheduler_watchdog')) then
    return v_beat || jsonb_build_object('action', 'omitida', 'reason', 'otra comprobación en curso');
  end if;

  for v_business in
    select b.id from public.businesses b where b.status <> 'closed' order by b.id
  loop
    v_fingerprint := encode(digest(
      v_business.id::text || ':SCHEDULER_WATCHDOG_STALE:' || v_subject::text, 'sha256'
    ), 'hex');

    select * into v_alert from public.operational_alerts
     where business_id = v_business.id and fingerprint = v_fingerprint
     for update;

    if v_healthy then
      -- Vuelve sola, sin esperar a que el barrido reviva.
      if v_alert.id is not null and v_alert.status <> 'resolved' then
        update public.operational_alerts
           set status = 'resolved', resolved_at = clock_timestamp(),
               resolution_note = 'El barrido volvió a correr; la sonda externa lo confirmó.',
               updated_at = clock_timestamp()
         where id = v_alert.id;
        insert into public.operational_alert_events(business_id, alert_id, event_type, detail)
        values (v_business.id, v_alert.id, 'resolved',
          jsonb_build_object('resolution', 'scheduler_recovered', 'source', v_source));
        v_action := 'resuelta';
        v_touched := v_touched + 1;
      end if;
      continue;
    end if;

    -- No sano. Se escribe como mucho una vez por minuto, la llamen las veces
    -- que la llamen: la alerta ya abierta y reciente no se vuelve a tocar.
    if v_alert.id is not null and v_alert.status <> 'resolved'
      and v_alert.last_seen_at > clock_timestamp() - interval '60 seconds' then
      v_action := 'sin cambios';
      continue;
    end if;

    insert into public.operational_alerts(
      business_id, fingerprint, severity, alert_code, subject_type, subject_id,
      status, summary, required_action, evidence
    ) values (
      v_business.id, v_fingerprint, 'CRITICAL', 'SCHEDULER_WATCHDOG_STALE',
      'service_health', v_subject, 'open',
      'La vigilancia automática dejó de correr.',
      'El sistema ya no se está revisando solo: mirá el Panel hasta que vuelva y avisá a soporte.',
      jsonb_build_object(
        'last_run_at', v_last,
        'age_seconds', v_age,
        'stale_after_seconds', 600,
        'observed_by', v_source
      )
    )
    on conflict (business_id, fingerprint) do update set
      severity = 'CRITICAL',
      status = case when operational_alerts.status = 'resolved' then 'open' else operational_alerts.status end,
      summary = excluded.summary,
      required_action = excluded.required_action,
      evidence = excluded.evidence,
      last_seen_at = clock_timestamp(),
      occurrence_count = operational_alerts.occurrence_count + case
        when operational_alerts.last_seen_at < clock_timestamp() - interval '1 minute' then 1 else 0 end,
      resolved_by = null, resolved_at = null, resolution_note = null,
      acknowledged_by = case when operational_alerts.status = 'resolved' then null else operational_alerts.acknowledged_by end,
      acknowledged_at = case when operational_alerts.status = 'resolved' then null else operational_alerts.acknowledged_at end,
      updated_at = clock_timestamp()
    returning id into v_alert_id;

    -- Un evento por episodio, no por comprobación.
    if v_alert.id is null or v_alert.status = 'resolved' then
      insert into public.operational_alert_events(business_id, alert_id, event_type, detail)
      values (
        v_business.id, v_alert_id,
        case when v_alert.id is null then 'detected' else 'reopened' end,
        jsonb_build_object('alert_code', 'SCHEDULER_WATCHDOG_STALE', 'source', v_source)
      );
    end if;
    v_action := 'abierta';
    v_touched := v_touched + 1;
  end loop;

  return v_beat || jsonb_build_object('action', v_action, 'businesses_touched', v_touched, 'source', v_source);
end;
$$;


ALTER FUNCTION "public"."check_scheduler_watchdog"("p_source" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."check_scheduler_watchdog"("p_source" "text") IS 'Sonda del planificador: mide el atraso real del barrido, abre la alerta cuando esta muerto y la cierra cuando vuelve. No confia en el llamador; escribe como mucho una vez por minuto.';



CREATE OR REPLACE FUNCTION "public"."checkout_pipeline_state"("p_session_status" "text", "p_expires_at" timestamp with time zone) RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select case lower(btrim(coalesce(p_session_status, '')))
    when 'expired' then 'expired'
    when 'cancelled' then 'cancelled'
    when 'payment_approved' then 'paid'
    when 'finalizing_order' then 'paid'
    when 'completed' then 'received'
    else case
      -- Un checkout vencido es `expired` desde el instante en que vence, no
      -- desde que el barrido lo alcanza. La verdad no espera al cron.
      when p_expires_at is not null and p_expires_at <= clock_timestamp() then 'expired'
      else 'pending'
    end
  end;
$$;


ALTER FUNCTION "public"."checkout_pipeline_state"("p_session_status" "text", "p_expires_at" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."checkout_pipeline_state"("p_session_status" "text", "p_expires_at" timestamp with time zone) IS 'Traduce un checkout sin pedido a pending/paid/expired/cancelled/received.';



CREATE OR REPLACE FUNCTION "public"."checkout_pos_sale"("p_business_id" "uuid", "p_items" "jsonb", "p_payment_method" "text", "p_idempotency_key" "text", "p_request_fiscal" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_sale public.pos_sales%rowtype;
  v_item jsonb;
  v_product public.products%rowtype;
  v_quantity integer;
  v_subtotal numeric(12,2) := 0;
begin
  if not public.has_business_role(p_business_id, array['owner','admin','staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  if p_payment_method not in ('cash','debit_card','credit_card','transfer','qr') then raise exception 'medio de pago invalido' using errcode = '22023'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 200 then raise exception 'items invalidos' using errcode = '22023'; end if;
  if (select count(distinct value->>'productId') from jsonb_array_elements(p_items)) <> jsonb_array_length(p_items) then raise exception 'productos duplicados en payload' using errcode='22023'; end if;
  select s.* into v_sale from public.pos_sales s where s.business_id = p_business_id and s.idempotency_key = p_idempotency_key;
  if found then return jsonb_build_object('sale_id', v_sale.id, 'state', v_sale.state, 'total', v_sale.total, 'idempotent_replay', true); end if;
  insert into public.pos_sales(business_id, operator_id, state, idempotency_key) values(p_business_id, auth.uid(), 'pricing', p_idempotency_key) returning * into v_sale;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if v_item - array['productId','quantity'] <> '{}'::jsonb then raise exception 'payload de item no permitido' using errcode = '22023'; end if;
    v_quantity := (v_item->>'quantity')::integer;
    if v_quantity < 1 then raise exception 'cantidad invalida' using errcode = '22023'; end if;
    select p.* into v_product from public.products p where p.id = (v_item->>'productId')::uuid and p.business_id = p_business_id and p.is_active and p.is_verified for update;
    if not found then raise exception 'producto no disponible' using errcode = 'P0002'; end if;
    if coalesce(v_product.stock,0) < v_quantity then raise exception 'stock insuficiente' using errcode = '23514'; end if;
    update public.products set stock = stock - v_quantity where id = v_product.id;
    insert into public.pos_sale_items(sale_id, product_id, product_name, quantity, unit_price, tax_snapshot, line_total)
    values(v_sale.id, v_product.id, v_product.name, v_quantity, v_product.price, jsonb_build_object('configured_by_server', true), v_quantity * v_product.price);
    insert into public.inventory_movements(business_id, product_id, movement_type, quantity_delta, previous_stock, resulting_stock, unit_factor, reference_type, reference_id, operator_id, idempotency_key)
    values(p_business_id, v_product.id, 'sale', -v_quantity, v_product.stock, v_product.stock-v_quantity, 1, 'pos_sale', v_sale.id, auth.uid(), p_idempotency_key || '-' || v_product.id::text);
    v_subtotal := v_subtotal + v_quantity * v_product.price;
  end loop;
  insert into public.pos_payments(sale_id, payment_method, amount, status) values(v_sale.id, p_payment_method, v_subtotal, 'confirmed');
  update public.pos_sales set subtotal = v_subtotal, total = v_subtotal, state = 'completed', completed_at = now() where id = v_sale.id returning * into v_sale;
  return jsonb_build_object('sale_id', v_sale.id, 'state', v_sale.state, 'total', v_sale.total, 'fiscal_requested', p_request_fiscal, 'idempotent_replay', false);
end;
$$;


ALTER FUNCTION "public"."checkout_pos_sale"("p_business_id" "uuid", "p_items" "jsonb", "p_payment_method" "text", "p_idempotency_key" "text", "p_request_fiscal" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."checkout_session_customer_payload"("p_checkout_session_id" "uuid", "p_customer_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
  select jsonb_build_object(
    'checkout_session_id', s.id,
    'status', s.status,
    'expires_at', s.expires_at,
    'currency', s.currency,
    'subtotal', s.subtotal,
    'discount_total', s.discount_total,
    'delivery_fee', s.delivery_fee,
    'total', s.total,
    'fulfillment_type', s.fulfillment_type,
    'payment_intent_id', pi.id,
    'payment_status', pi.internal_status,
    'provider_status', pi.provider_status,
    'provider_status_detail', pi.provider_status_detail,
    'latest_payment_attempt_status', (
      select pa.status
        from public.payment_attempts pa
       where pa.payment_intent_id = pi.id
         and pa.attempt_type = 'preference'
       order by pa.attempt_number desc
       limit 1
    ),
    'latest_payment_attempt_number', (
      select pa.attempt_number
        from public.payment_attempts pa
       where pa.payment_intent_id = pi.id
         and pa.attempt_type = 'preference'
       order by pa.attempt_number desc
       limit 1
    ),
    'order_id', s.completed_order_id,
    'order_public_code', o.public_code,
    'manual_review_required', s.status = 'manual_review_required',
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'product_id', si.product_id,
          'name', si.product_snapshot ->> 'name',
          'presentation', si.product_snapshot ->> 'presentation',
          'quantity', si.quantity,
          'unit_price', si.unit_price,
          'subtotal', si.subtotal
        ) order by si.created_at, si.id
      )
      from public.checkout_session_items si
      where si.checkout_session_id = s.id
    ), '[]'::jsonb),
    'delivery_code', case
      when s.completed_order_id is not null and s.fulfillment_type = 'delivery' then (
        select pgp_sym_decrypt(h.code_ciphertext, s.id::text)
          from public.order_delivery_handoffs h
         where h.order_id = s.completed_order_id
           and h.confirmed_at is null
           and h.expires_at > clock_timestamp()
      )
      else null
    end
  )
  from public.checkout_sessions s
  join public.payment_intents pi on pi.checkout_session_id = s.id
  left join public.orders o on o.id = s.completed_order_id
  where s.id = p_checkout_session_id
    and s.customer_id = p_customer_id;
$$;


ALTER FUNCTION "public"."checkout_session_customer_payload"("p_checkout_session_id" "uuid", "p_customer_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."checkout_session_status_rank"("p_status" "text") RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select case lower(btrim(coalesce(p_status, '')))
    when 'created' then 10
    when 'validating' then 20
    when 'ready_for_payment' then 30
    when 'redirected' then 40
    when 'payment_pending' then 50
    when 'expired' then 60
    when 'cancelled' then 70
    when 'payment_approved' then 100
    when 'finalizing_order' then 110
    when 'completed' then 120
    when 'manual_review_required' then 130
    else 0
  end;
$$;


ALTER FUNCTION "public"."checkout_session_status_rank"("p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_available_rider_order"("p_business_id" "uuid", "p_public_code" "text", "p_expected_revision" bigint, "p_expected_status" "text" DEFAULT 'ready'::"text", "p_expected_rider_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_order public.orders%rowtype;
  v_user_id uuid := auth.uid();
  v_expected_status text := public.normalize_order_status_vocabulary(p_expected_status);
begin
  if v_user_id is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if p_business_id is null
    or not public.has_business_role(p_business_id, array['rider']) then
    raise exception 'rol rider requerido para este negocio' using errcode = '42501';
  end if;
  if p_public_code is null or btrim(p_public_code) = '' then
    raise exception 'public_code requerido' using errcode = '22023';
  end if;
  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'expected_revision requerido' using errcode = '22023';
  end if;

  select o.*
    into v_order
    from public.orders o
   where o.business_id = p_business_id
     and o.public_code = btrim(p_public_code)
   for update;

  if not found then
    raise exception 'pedido inexistente' using errcode = 'P0002';
  end if;
  perform 1
    from public.business_members bm
   where bm.business_id = v_order.business_id
     and bm.user_id = v_user_id
     and bm.role = 'rider'
     and bm.is_active = true
   for share;
  if not found then
    raise exception 'rol rider requerido para este negocio' using errcode = '42501';
  end if;
  if v_order.delivery_mode <> 'delivery' then
    raise exception 'los pedidos con retiro no admiten rider' using errcode = '42501';
  end if;
  if v_order.origin <> 'production' then
    raise exception 'pedido de prueba: no se despacha en operacion real' using errcode = '42501';
  end if;

  -- A second tap from the same rider is a successful no-op, even when both
  -- taps carried the same old revision. A different rider never receives this
  -- exception path and is rejected below.
  if v_order.assigned_rider_user_id = v_user_id
    and v_order.status = 'assigned' then
    return public.rider_order_rpc_payload(v_order.id)
      || jsonb_build_object('idempotent_no_op', true);
  end if;

  if v_order.revision <> p_expected_revision then
    raise exception 'revision desactualizada: esperada %, actual %',
      p_expected_revision,
      v_order.revision
      using errcode = '40001';
  end if;
  if v_expected_status <> 'ready'
    or v_order.status <> v_expected_status
    or v_order.assigned_rider_user_id is distinct from p_expected_rider_user_id
    or v_order.assigned_rider_user_id is not null then
    raise exception 'conflicto de asignacion: estado, revision o rider esperado cambio'
      using errcode = '40001';
  end if;

  update public.orders
     set assigned_rider_user_id = v_user_id,
         status = 'assigned'
   where id = v_order.id
     and revision = p_expected_revision
     and status = 'ready'
     and assigned_rider_user_id is null;

  if not found then
    raise exception 'conflicto de asignacion: otro rider gano la carrera'
      using errcode = '40001';
  end if;

  insert into public.order_events (
    order_id, business_id, actor_user_id, actor_role, actor_type, actor_id,
    event_type, type, message, metadata, payload
  ) values (
    v_order.id,
    v_order.business_id,
    v_user_id,
    'rider',
    'rider',
    v_user_id,
    'order.rider_claimed',
    'order.rider_claimed',
    'Pedido tomado por un rider autenticado',
    jsonb_build_object(
      'previous_rider_user_id', v_order.assigned_rider_user_id,
      'next_rider_user_id', v_user_id,
      'expected_revision', p_expected_revision
    ),
    jsonb_build_object(
      'previous_rider_user_id', v_order.assigned_rider_user_id,
      'next_rider_user_id', v_user_id,
      'expected_revision', p_expected_revision
    )
  );

  return public.rider_order_rpc_payload(v_order.id)
    || jsonb_build_object('idempotent_no_op', false);
end;
$$;


ALTER FUNCTION "public"."claim_available_rider_order"("p_business_id" "uuid", "p_public_code" "text", "p_expected_revision" bigint, "p_expected_status" "text", "p_expected_rider_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."claim_available_rider_order"("p_business_id" "uuid", "p_public_code" "text", "p_expected_revision" bigint, "p_expected_status" "text", "p_expected_rider_user_id" "uuid") IS 'Toma atomica de rider por revision, con un solo ganador y no-op idempotente para doble toque del mismo rider.';



CREATE OR REPLACE FUNCTION "public"."claim_delivery_order"("p_business_id" "uuid", "p_public_code" "text", "p_expected_revision" bigint, "p_idempotency_key" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_order public.orders%rowtype;
  v_key text := public.rider_validate_idempotency_key(p_idempotency_key);
  v_result jsonb;
  v_fingerprint bytea;
begin
  perform public.rider_require_active_membership(p_business_id);
  if p_expected_revision is null or p_expected_revision < 1 or btrim(coalesce(p_public_code, '')) = '' then
    raise exception 'claim invalido' using errcode = '22023';
  end if;
  select o.* into v_order
    from public.orders o
   where o.business_id = p_business_id
     and o.public_code = btrim(p_public_code)
   for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_available'); end if;
  if v_order.origin <> 'production' then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;
  select result into v_result
    from public.rider_delivery_operations
   where order_id = v_order.id and rider_user_id = auth.uid()
     and operation = 'claim' and idempotency_key = v_key
   for share;
  if found then return v_result || jsonb_build_object('idempotent_no_op', true); end if;
  if exists (
    select 1 from public.orders active
    where active.assigned_rider_user_id = auth.uid()
      and active.id <> v_order.id
      and active.status in ('assigned', 'picked_up', 'on_the_way', 'arrived')
  ) then
    return jsonb_build_object('ok', false, 'code', 'active_delivery_exists');
  end if;
  if v_order.revision <> p_expected_revision then
    return jsonb_build_object('ok', false, 'code', 'stale_revision', 'revision', v_order.revision);
  end if;
  if v_order.delivery_mode <> 'delivery' or v_order.status <> 'ready' or v_order.assigned_rider_user_id is not null then
    return jsonb_build_object('ok', false, 'code', 'taken_by_other', 'revision', v_order.revision);
  end if;
  update public.orders
     set assigned_rider_user_id = auth.uid(), status = 'assigned'
   where id = v_order.id;
  v_result := jsonb_build_object(
    'ok', true,
    'outcome', 'claimed',
    'idempotent_no_op', false,
    'order', public.rider_active_delivery_payload(v_order.id)
  );
  v_fingerprint := digest(jsonb_build_object('public_code', v_order.public_code, 'revision', p_expected_revision)::text, 'sha256');
  insert into public.rider_delivery_operations(order_id, rider_user_id, operation, idempotency_key, request_fingerprint, result)
  values (v_order.id, auth.uid(), 'claim', v_key, v_fingerprint, v_result);
  return v_result;
end;
$$;


ALTER FUNCTION "public"."claim_delivery_order"("p_business_id" "uuid", "p_public_code" "text", "p_expected_revision" bigint, "p_idempotency_key" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."claim_delivery_order"("p_business_id" "uuid", "p_public_code" "text", "p_expected_revision" bigint, "p_idempotency_key" "text") IS 'Claim idempotente canónico del Rider; sólo despacha pedidos de operación real.';



CREATE TABLE IF NOT EXISTS "public"."fiscal_artifact_outbox" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fiscal_document_id" "uuid" NOT NULL,
    "state" "text" DEFAULT 'pending'::"text" NOT NULL,
    "generation_token" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lease_owner" "text",
    "lease_deadline" timestamp with time zone,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "next_attempt_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_error_code" "text",
    "last_error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processed_at" timestamp with time zone,
    CONSTRAINT "fiscal_artifact_outbox_attempt_count_check" CHECK (("attempt_count" >= 0)),
    CONSTRAINT "fiscal_artifact_outbox_state_check" CHECK (("state" = ANY (ARRAY['pending'::"text", 'leased'::"text", 'retry_wait'::"text", 'completed'::"text", 'dead_letter'::"text"])))
);


ALTER TABLE "public"."fiscal_artifact_outbox" OWNER TO "postgres";


COMMENT ON TABLE "public"."fiscal_artifact_outbox" IS 'Cola privada idempotente para generar y persistir PDFs despues de la autorizacion ARCA.';



CREATE OR REPLACE FUNCTION "public"."claim_fiscal_artifact_outbox"("p_worker_id" "text", "p_limit" integer DEFAULT 5, "p_lease_seconds" integer DEFAULT 120) RETURNS SETOF "public"."fiscal_artifact_outbox"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
begin
  if btrim(coalesce(p_worker_id,'')) !~ '^[A-Za-z0-9._-]{3,80}$'
    or p_limit not between 1 and 50
    or p_lease_seconds not between 30 and 300
  then raise exception 'parametros de lease de artefacto invalidos' using errcode = '22023'; end if;

  return query
  with candidates as (
    select o.id
    from public.fiscal_artifact_outbox o
    where (o.state in ('pending','retry_wait') and o.next_attempt_at <= now())
       or (o.state = 'leased' and o.lease_deadline < now())
    order by o.next_attempt_at, o.created_at
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.fiscal_artifact_outbox o
      set state = 'leased', lease_owner = p_worker_id,
          lease_deadline = now() + make_interval(secs => p_lease_seconds),
          attempt_count = o.attempt_count + 1
    from candidates c
    where o.id = c.id
    returning o.*
  ), documented as (
    update public.fiscal_documents d
      set artifact_state = 'artifact_generating', artifact_error_code = null,
          artifact_error_message = null, artifact_updated_at = now()
    from claimed c
    where d.id = c.fiscal_document_id
    returning d.id
  )
  select c.* from claimed c;
end;
$_$;


ALTER FUNCTION "public"."claim_fiscal_artifact_outbox"("p_worker_id" "text", "p_limit" integer, "p_lease_seconds" integer) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fiscal_outbox" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fiscal_document_id" "uuid" NOT NULL,
    "state" "text" DEFAULT 'pending'::"text" NOT NULL,
    "lease_owner" "text",
    "lease_deadline" timestamp with time zone,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "next_attempt_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_error_code" "text",
    "last_error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processed_at" timestamp with time zone,
    CONSTRAINT "fiscal_outbox_attempt_count_check" CHECK (("attempt_count" >= 0)),
    CONSTRAINT "fiscal_outbox_state_check" CHECK (("state" = ANY (ARRAY['pending'::"text", 'leased'::"text", 'retry_wait'::"text", 'completed'::"text", 'dead_letter'::"text"])))
);


ALTER TABLE "public"."fiscal_outbox" OWNER TO "postgres";


COMMENT ON TABLE "public"."fiscal_outbox" IS 'Cola fiscal privada con SKIP LOCKED, lease y dead-letter; nunca accesible al panel.';



CREATE OR REPLACE FUNCTION "public"."claim_fiscal_outbox"("p_worker_id" "text", "p_limit" integer DEFAULT 10, "p_lease_seconds" integer DEFAULT 90) RETURNS SETOF "public"."fiscal_outbox"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
begin
  if btrim(coalesce(p_worker_id,'')) !~ '^[A-Za-z0-9._-]{3,80}$' or p_limit not between 1 and 50 or p_lease_seconds not between 30 and 300 then raise exception 'parametros de lease invalidos' using errcode='22023'; end if;
  return query
  with candidates as (
    select o.id from public.fiscal_outbox o
    where ((o.state in ('pending','retry_wait') and o.next_attempt_at <= now()) or (o.state='leased' and o.lease_deadline < now()))
    order by o.next_attempt_at,o.created_at
    for update skip locked
    limit p_limit
  )
  update public.fiscal_outbox o
  set state='leased',lease_owner=p_worker_id,lease_deadline=now()+make_interval(secs=>p_lease_seconds),attempt_count=o.attempt_count+1
  from candidates c where o.id=c.id returning o.*;
end;
$_$;


ALTER FUNCTION "public"."claim_fiscal_outbox"("p_worker_id" "text", "p_limit" integer, "p_lease_seconds" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."claim_fiscal_outbox"("p_worker_id" "text", "p_limit" integer, "p_lease_seconds" integer) IS 'RPC privada para worker fiscal; reclama trabajos con FOR UPDATE SKIP LOCKED.';



CREATE TABLE IF NOT EXISTS "public"."payment_outbox" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "webhook_receipt_id" "uuid",
    "payment_intent_id" "uuid",
    "refund_id" "uuid",
    "cancellation_id" "uuid",
    "topic" "text" NOT NULL,
    "resource_id" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "owner" "text",
    "lease_expires_at" timestamp with time zone,
    "attempts" integer DEFAULT 0 NOT NULL,
    "next_attempt_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "last_error" "text",
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "payment_outbox_attempts_check" CHECK (("attempts" >= 0)),
    CONSTRAINT "payment_outbox_reference_check" CHECK ((("webhook_receipt_id" IS NOT NULL) OR ("payment_intent_id" IS NOT NULL) OR ("refund_id" IS NOT NULL) OR ("cancellation_id" IS NOT NULL))),
    CONSTRAINT "payment_outbox_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'claimed'::"text", 'processing'::"text", 'completed'::"text", 'retry_wait'::"text", 'failed'::"text", 'dead_letter'::"text"]))),
    CONSTRAINT "payment_outbox_topic_check" CHECK (("topic" = ANY (ARRAY['payment'::"text", 'chargeback'::"text", 'claim'::"text", 'refund_reconcile'::"text", 'cancellation_reconcile'::"text", 'payment_reconcile'::"text"])))
);


ALTER TABLE "public"."payment_outbox" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_payment_outbox"("p_owner" "text", "p_limit" integer DEFAULT 20, "p_lease_seconds" integer DEFAULT 90) RETURNS SETOF "public"."payment_outbox"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  if nullif(btrim(p_owner), '') is null then raise exception 'owner requerido' using errcode = '22023'; end if;
  return query
  with candidate as (
    select o.id
      from public.payment_outbox o
     where (
       (o.status in ('pending', 'retry_wait') and o.next_attempt_at <= clock_timestamp())
       or (o.status in ('claimed', 'processing') and coalesce(o.lease_expires_at, '-infinity'::timestamptz) < clock_timestamp())
     )
     order by o.next_attempt_at, o.created_at
     limit greatest(1, least(coalesce(p_limit, 20), 100))
     for update skip locked
  )
  update public.payment_outbox o
     set status = 'claimed', owner = left(btrim(p_owner), 200),
         lease_expires_at = clock_timestamp() + make_interval(secs => greatest(15, least(coalesce(p_lease_seconds, 90), 600))),
         attempts = o.attempts + 1
    from candidate c
   where o.id = c.id
  returning o.*;
end;
$$;


ALTER FUNCTION "public"."claim_payment_outbox"("p_owner" "text", "p_limit" integer, "p_lease_seconds" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."claim_payment_outbox"("p_owner" "text", "p_limit" integer, "p_lease_seconds" integer) IS 'Durable payment worker claim using FOR UPDATE SKIP LOCKED, bounded lease, retry backoff and dead-letter state.';



CREATE OR REPLACE FUNCTION "public"."classify_checkout_session_qa_origin"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  if new.product_id is null or not public.product_is_qa_fixture(new.product_id) then
    return null;
  end if;
  update public.checkout_sessions s
     set origin = 'qa',
         origin_reason = coalesce(s.origin_reason, 'qa_fixture_product')
   where s.id = new.checkout_session_id
     and s.origin <> 'qa';
  return null;
end;
$$;


ALTER FUNCTION "public"."classify_checkout_session_qa_origin"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."classify_checkout_session_qa_origin"() IS 'Marca el checkout como QA cuando entra un producto fixture de prueba.';



CREATE OR REPLACE FUNCTION "public"."classify_order_as_qa"("p_order_id" "uuid", "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
declare
  v_order public.orders%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_actor uuid := auth.uid();
begin
  if v_reason is null or char_length(v_reason) > 120 or v_reason !~ '^[a-z0-9_]+$' then
    raise exception 'motivo requerido en snake_case de hasta 120 caracteres' using errcode = '22023';
  end if;

  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'pedido inexistente' using errcode = 'P0002';
  end if;

  -- El service_role certifica sin sesión; una persona necesita rol del negocio.
  if v_actor is not null
     and not public.has_business_role(v_order.business_id, array['owner', 'admin']) then
    raise exception 'solo owner o admin pueden reclasificar un pedido' using errcode = '42501';
  end if;

  if v_order.origin = 'qa' then
    return jsonb_build_object(
      'ok', true,
      'order_id', v_order.id,
      'public_code', v_order.public_code,
      'origin', 'qa',
      'origin_reason', v_order.origin_reason,
      'idempotent_no_op', true
    );
  end if;

  -- Sólo se toca la clasificación: estado, rider, stock y tiempos quedan como
  -- están, y `bump_order_revision` deja la revisión intacta para no invalidar
  -- la vista de quien esté operando.
  update public.orders
     set origin = 'qa',
         origin_reason = v_reason,
         origin_classified_at = clock_timestamp()
   where id = v_order.id;

  update public.notification_outbox n
     set state = 'processed',
         processed_at = coalesce(n.processed_at, clock_timestamp()),
         payload = n.payload || jsonb_build_object('suppressed', true, 'suppressed_reason', v_reason)
   where n.aggregate_id = v_order.id
     and n.event_type = 'new_order'
     and n.state = 'pending';

  insert into public.order_events (
    order_id, business_id, actor_user_id, actor_role, actor_type,
    event_type, type, message, metadata, payload
  ) values (
    v_order.id,
    v_order.business_id,
    v_actor,
    case when v_actor is null then 'system' else 'business' end,
    case when v_actor is null then 'system' else 'business' end,
    'order.origin_classified',
    'order.origin_classified',
    'Pedido reclasificado como QA; se conserva como evidencia y sale de la operación real.',
    jsonb_build_object('origin', 'qa', 'origin_reason', v_reason, 'previous_origin', v_order.origin),
    jsonb_build_object('origin', 'qa', 'origin_reason', v_reason, 'previous_origin', v_order.origin)
  );

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order.id,
    'public_code', v_order.public_code,
    'origin', 'qa',
    'origin_reason', v_reason,
    'idempotent_no_op', false
  );
end;
$_$;


ALTER FUNCTION "public"."classify_order_as_qa"("p_order_id" "uuid", "p_reason" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."classify_order_as_qa"("p_order_id" "uuid", "p_reason" "text") IS 'Reclasifica un pedido como QA sin borrarlo ni tocar su estado operativo. Una sola dirección.';



CREATE OR REPLACE FUNCTION "public"."classify_order_qa_origin"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_promoted boolean := false;
begin
  if new.product_uuid is null or not public.product_is_qa_fixture(new.product_uuid) then
    return null;
  end if;

  update public.orders o
     set origin = 'qa',
         origin_reason = coalesce(o.origin_reason, 'qa_fixture_product'),
         origin_classified_at = coalesce(o.origin_classified_at, clock_timestamp())
   where o.id = new.order_id
     and o.origin <> 'qa';
  get diagnostics v_promoted = row_count;

  if not v_promoted then
    return null;
  end if;

  -- Misma transacción que la creación del pedido: el aviso se cierra antes de
  -- que ningún consumidor pueda tomarlo.
  update public.notification_outbox n
     set state = 'processed',
         processed_at = coalesce(n.processed_at, clock_timestamp()),
         payload = n.payload || jsonb_build_object(
           'suppressed', true,
           'suppressed_reason', 'qa_origin_order'
         )
   where n.aggregate_id = new.order_id
     and n.event_type = 'new_order'
     and n.state = 'pending';

  return null;
end;
$$;


ALTER FUNCTION "public"."classify_order_qa_origin"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."classify_order_qa_origin"() IS 'Promueve el pedido a origen QA por producto fixture y cierra su aviso de pedido nuevo.';



CREATE OR REPLACE FUNCTION "public"."close_daily_reconciliation"("p_reconciliation_id" "uuid", "p_expected_revision" bigint, "p_idempotency_key" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
declare
  v_run public.daily_reconciliations%rowtype;
  v_snapshot jsonb;
  v_expected numeric(14,2);
  v_difference numeric(14,2);
  v_hash text;
begin
  select * into v_run from public.daily_reconciliations where id=p_reconciliation_id for update;
  if not found then raise exception 'conciliacion inexistente' using errcode='P0002'; end if;
  if not public.has_business_role(v_run.business_id,array['owner','admin']) then
    raise exception 'cierre requiere owner o admin' using errcode='42501';
  end if;
  if btrim(coalesce(p_idempotency_key,'')) !~ '^[A-Za-z0-9:_-]{8,128}$' then
    raise exception 'idempotency_key invalida' using errcode='22023';
  end if;
  if v_run.status='closed' then
    return jsonb_build_object('ok',true,'reconciliation',to_jsonb(v_run),'idempotent_replay',true);
  end if;
  if v_run.revision<>p_expected_revision then
    raise exception 'conflicto de revision' using errcode='40001';
  end if;
  perform public.refresh_operational_alerts(v_run.business_id);
  v_snapshot := public.daily_reconciliation_snapshot_internal(v_run.business_id,v_run.window_start,v_run.window_end);
  v_expected := coalesce((v_snapshot #>> '{cash,expected}')::numeric,0);
  v_difference := round(v_run.declared_cash-v_expected,2);
  if v_difference<>0 and char_length(btrim(coalesce(v_run.difference_note,''))) not between 5 and 500 then
    raise exception 'la diferencia de caja requiere una explicacion' using errcode='22023';
  end if;
  v_hash := encode(digest(
    v_snapshot::text || '|' || v_run.declared_cash::text || '|' || v_expected::text || '|' || v_difference::text || '|' || coalesce(v_run.difference_note,''),
    'sha256'
  ),'hex');
  update public.daily_reconciliations set
    status='closed',snapshot=v_snapshot,expected_cash=v_expected,cash_difference=v_difference,
    open_alerts=(select count(*) from public.operational_alerts a where a.business_id=v_run.business_id and a.status<>'resolved'),
    critical_alerts=(select count(*) from public.operational_alerts a where a.business_id=v_run.business_id and a.status<>'resolved' and a.severity='CRITICAL'),
    snapshot_sha256=v_hash,closed_by=auth.uid(),closed_at=clock_timestamp(),close_idempotency_key=p_idempotency_key,
    refreshed_at=clock_timestamp()
  where id=v_run.id returning * into v_run;
  insert into public.daily_reconciliation_events(business_id,reconciliation_id,event_type,actor_id,revision,snapshot_sha256)
  values(v_run.business_id,v_run.id,'closed',auth.uid(),v_run.revision,v_run.snapshot_sha256);
  return jsonb_build_object('ok',true,'reconciliation',to_jsonb(v_run),'idempotent_replay',false);
end;
$_$;


ALTER FUNCTION "public"."close_daily_reconciliation"("p_reconciliation_id" "uuid", "p_expected_revision" bigint, "p_idempotency_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_fiscal_artifact"("p_artifact_outbox_id" "uuid", "p_worker_id" "text", "p_artifact" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
begin
  if not (coalesce(p_artifact, '{}'::jsonb) ?& array[
    'artifact_type','storage_provider','storage_path','mime_type','size_bytes',
    'sha256','generated_at','generated_by','generation_version'
  ]) then
    raise exception 'metadata de artefacto incompleta' using errcode = '22023';
  end if;
  return public.complete_fiscal_artifact_unchecked(p_artifact_outbox_id, p_worker_id, p_artifact);
end;
$$;


ALTER FUNCTION "public"."complete_fiscal_artifact"("p_artifact_outbox_id" "uuid", "p_worker_id" "text", "p_artifact" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."complete_fiscal_artifact"("p_artifact_outbox_id" "uuid", "p_worker_id" "text", "p_artifact" "jsonb") IS 'Exige metadata documental completa antes de persistir un artefacto privado.';



CREATE OR REPLACE FUNCTION "public"."complete_fiscal_artifact_unchecked"("p_artifact_outbox_id" "uuid", "p_worker_id" "text", "p_artifact" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
declare
  v_outbox public.fiscal_artifact_outbox%rowtype;
  v_document public.fiscal_documents%rowtype;
  v_artifact public.fiscal_document_artifacts%rowtype;
  v_supersedes uuid;
  v_expected_path text;
  v_sha256 text;
  v_size bigint;
begin
  if coalesce(p_artifact,'{}'::jsonb) - array['artifact_type','storage_provider','storage_path','mime_type','size_bytes','sha256','generated_at','generated_by','generation_version'] <> '{}'::jsonb then
    raise exception 'metadata de artefacto no permitida' using errcode = '22023';
  end if;
  select o.* into v_outbox from public.fiscal_artifact_outbox o where o.id = p_artifact_outbox_id for update;
  if not found or v_outbox.state <> 'leased' or v_outbox.lease_owner <> p_worker_id or v_outbox.lease_deadline <= now() then
    raise exception 'lease de artefacto invalido' using errcode = '40001';
  end if;
  select d.* into v_document from public.fiscal_documents d where d.id = v_outbox.fiscal_document_id for share;
  if v_document.state not in ('authorized','credited') or v_document.cae !~ '^[0-9]{14}$' or v_document.document_number is null then
    raise exception 'el comprobante no esta autorizado para generar PDF' using errcode = 'P0001';
  end if;
  v_expected_path := public.fiscal_artifact_storage_path(v_document.business_id, v_document.id, v_outbox.generation_token);
  v_sha256 := lower(coalesce(p_artifact->>'sha256',''));
  v_size := coalesce((p_artifact->>'size_bytes')::bigint, 0);
  if p_artifact->>'artifact_type' <> 'authorized_pdf'
    or p_artifact->>'storage_provider' <> 'supabase_storage'
    or p_artifact->>'storage_path' <> v_expected_path
    or p_artifact->>'mime_type' <> 'application/pdf'
    or v_sha256 !~ '^[0-9a-f]{64}$'
    or v_size not between 1 and 16777216
    or char_length(coalesce(p_artifact->>'generation_version','')) not between 1 and 80
    or char_length(coalesce(p_artifact->>'generated_by','')) not between 3 and 80
  then raise exception 'metadata de artefacto invalida' using errcode = '22023'; end if;

  select a.* into v_artifact from public.fiscal_document_artifacts a where a.generation_token = v_outbox.generation_token for update;
  if found then
    update public.fiscal_artifact_outbox set state = 'completed', processed_at = now(), lease_owner = null, lease_deadline = null where id = v_outbox.id;
    update public.fiscal_documents set artifact_state = 'artifact_ready', artifact_error_code = null, artifact_error_message = null, artifact_updated_at = now() where id = v_document.id;
    return jsonb_build_object('artifact_id', v_artifact.id, 'idempotent_replay', true);
  end if;

  select a.id into v_supersedes
  from public.fiscal_document_artifacts a
  where a.fiscal_document_id = v_document.id and a.artifact_type = 'authorized_pdf' and a.is_current
  for update;

  update public.fiscal_document_artifacts
    set is_current = false, state = 'artifact_superseded', superseded_at = now()
    where id = v_supersedes;

  insert into public.fiscal_document_artifacts(
    business_id, fiscal_document_id, artifact_type, state, storage_provider, storage_path,
    mime_type, size_bytes, sha256, document_number, generated_at, generated_by,
    generation_version, generation_token, is_current, supersedes_artifact_id
  ) values (
    v_document.business_id, v_document.id, 'authorized_pdf', 'artifact_ready', 'supabase_storage', v_expected_path,
    'application/pdf', v_size, v_sha256, v_document.document_number,
    coalesce((p_artifact->>'generated_at')::timestamptz, now()), p_artifact->>'generated_by',
    p_artifact->>'generation_version', v_outbox.generation_token, true, v_supersedes
  ) returning * into v_artifact;

  update public.fiscal_artifact_outbox
    set state = 'completed', processed_at = now(), lease_owner = null, lease_deadline = null,
        last_error_code = null, last_error_message = null
    where id = v_outbox.id;
  update public.fiscal_documents
    set artifact_state = 'artifact_ready', artifact_error_code = null, artifact_error_message = null, artifact_updated_at = now()
    where id = v_document.id;
  insert into public.fiscal_events(fiscal_document_id, event_type, actor_type, sanitized_detail)
  values (v_document.id, 'artifact_ready', 'worker', jsonb_build_object(
    'artifact_id', v_artifact.id, 'sha256', v_sha256, 'size_bytes', v_size,
    'generation_version', v_artifact.generation_version, 'supersedes_artifact_id', v_supersedes
  ));
  return jsonb_build_object('artifact_id', v_artifact.id, 'idempotent_replay', false);
end;
$_$;


ALTER FUNCTION "public"."complete_fiscal_artifact_unchecked"("p_artifact_outbox_id" "uuid", "p_worker_id" "text", "p_artifact" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_fiscal_attempt"("p_outbox_id" "uuid", "p_worker_id" "text", "p_result" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_outbox public.fiscal_outbox%rowtype;
  v_document public.fiscal_documents%rowtype;
  v_class text;
  v_cae text;
begin
  select o.* into v_outbox from public.fiscal_outbox o where o.id=p_outbox_id for update;
  if not found or v_outbox.state <> 'leased' or v_outbox.lease_owner <> p_worker_id or v_outbox.lease_deadline <= now() then raise exception 'lease fiscal invalido' using errcode='40001'; end if;
  select d.* into v_document from public.fiscal_documents d where d.id=v_outbox.fiscal_document_id for update;
  v_class := p_result->>'classification';
  v_cae := regexp_replace(coalesce(p_result->>'cae',''),'[^0-9]','','g');
  insert into public.fiscal_request_attempts(fiscal_document_id,outbox_id,request_id,operation,result_class,request_hash,response_hash,duration_ms,error_code,error_message)
  values(v_document.id,v_outbox.id,left(coalesce(p_result->>'request_id',gen_random_uuid()::text),128),left(coalesce(p_result->>'operation','FECAESolicitar'),80),v_class,left(p_result->>'request_hash',128),left(p_result->>'response_hash',128),greatest(0,coalesce((p_result->>'duration_ms')::integer,0)),left(p_result->>'error_code',80),left(p_result->>'error_message',300));
  if v_class in ('authorized','authorized_with_observations') then
    if length(v_cae) <> 14 or coalesce((p_result->>'document_number')::bigint,0) < 1 then raise exception 'autorizacion sin CAE o numero valido' using errcode='22023'; end if;
    update public.fiscal_documents set state='authorized',result=v_class,cae=v_cae,cae_expiration=(p_result->>'cae_expiration')::date,document_number=(p_result->>'document_number')::bigint,issue_date=(p_result->>'issue_date')::date,observations=coalesce(p_result->'observations','[]'::jsonb),request_hash=p_result->>'request_hash',response_hash=p_result->>'response_hash',authorized_at=now() where id=v_document.id returning * into v_document;
    if v_document.document_intent='credit_note' then update public.fiscal_credit_allocations set state='authorized' where credit_document_id=v_document.id and state='reserved'; end if;
    update public.fiscal_outbox set state='completed',processed_at=now(),lease_owner=null,lease_deadline=null where id=v_outbox.id;
  elsif v_class='ambiguous' then
    update public.fiscal_documents set state='ambiguous',result='ambiguous',errors=coalesce(p_result->'errors','[]'::jsonb) where id=v_document.id;
    update public.fiscal_outbox set state='retry_wait',next_attempt_at=now()+interval '60 seconds',lease_owner=null,lease_deadline=null,last_error_code='AMBIGUOUS',last_error_message='Se consultara antes de reenviar' where id=v_outbox.id;
  elsif v_class='rejected' then
    update public.fiscal_documents set state='rejected',result='rejected',observations=coalesce(p_result->'observations','[]'::jsonb),errors=coalesce(p_result->'errors','[]'::jsonb) where id=v_document.id;
    if v_document.document_intent='credit_note' then update public.fiscal_credit_allocations set state='released' where credit_document_id=v_document.id and state='reserved'; end if;
    update public.fiscal_outbox set state='dead_letter',processed_at=now(),lease_owner=null,lease_deadline=null,last_error_code='ARCA_REJECTED' where id=v_outbox.id;
  elsif p_result->>'error_code' in ('REQUIRES_FISCAL_REVIEW','ARCA_RECONCILIATION_MISMATCH') then
    update public.fiscal_documents set state='failed',result='configuration_error',errors=coalesce(p_result->'errors','[]'::jsonb) where id=v_document.id;
    if v_document.document_intent='credit_note' then update public.fiscal_credit_allocations set state='released' where credit_document_id=v_document.id and state='reserved'; end if;
    update public.fiscal_outbox set state='dead_letter',processed_at=now(),lease_owner=null,lease_deadline=null,last_error_code=coalesce(p_result->>'error_code','REQUIRES_FISCAL_REVIEW'),last_error_message=case when p_result->>'error_code'='ARCA_RECONCILIATION_MISMATCH' then 'La consulta ARCA no coincide; requiere revision' else 'Requiere datos fiscales o revision' end where id=v_outbox.id;
  else
    update public.fiscal_documents set state='retry_wait',result=coalesce(v_class,'service_error') where id=v_document.id;
    update public.fiscal_outbox set state=case when attempt_count>=8 then 'dead_letter' else 'retry_wait' end,next_attempt_at=now()+least(interval '30 minutes',make_interval(secs=>30*(2^least(attempt_count,6)))),lease_owner=null,lease_deadline=null,last_error_code=left(coalesce(p_result->>'error_code','SERVICE_ERROR'),80),last_error_message=left(coalesce(p_result->>'error_message',''),300) where id=v_outbox.id;
  end if;
  insert into public.fiscal_events(fiscal_document_id,event_type,actor_type,sanitized_detail)
  values(v_document.id,coalesce(v_class,'service_error'),'worker',p_result-'token'-'sign'-'certificate'-'private_key'-'service_role');
  return jsonb_build_object('fiscal_document_id',v_document.id,'state',(select state from public.fiscal_documents where id=v_document.id));
end;
$$;


ALTER FUNCTION "public"."complete_fiscal_attempt"("p_outbox_id" "uuid", "p_worker_id" "text", "p_result" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_payment_outbox_job"("p_job_id" "uuid", "p_owner" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare v_receipt_id uuid;
begin
  update public.payment_outbox set status = 'completed', completed_at = clock_timestamp(), lease_expires_at = null
   where id = p_job_id and owner = p_owner and status = 'processing'
   returning webhook_receipt_id into v_receipt_id;
  if not found then return false; end if;
  if v_receipt_id is not null then
    update public.payment_webhook_receipts set processing_status = 'completed', processed_at = clock_timestamp() where id = v_receipt_id;
  end if;
  return true;
end;
$$;


ALTER FUNCTION "public"."complete_payment_outbox_job"("p_job_id" "uuid", "p_owner" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_scanned_product"("p_product_id" "uuid", "p_details" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
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
$$;


ALTER FUNCTION "public"."complete_scanned_product"("p_product_id" "uuid", "p_details" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."complete_scanned_product"("p_product_id" "uuid", "p_details" "jsonb") IS 'Completa un producto creado por escaneo. Un precio pendiente lo deja visible pero no comprable.';



CREATE TABLE IF NOT EXISTS "public"."fiscal_profiles" (
    "business_id" "uuid" NOT NULL,
    "legal_name" "text",
    "cuit" "text",
    "tax_condition" "text",
    "gross_income_number" "text",
    "business_address" "text",
    "environment" "text" DEFAULT 'disabled'::"text" NOT NULL,
    "point_of_sale" integer,
    "default_currency" "text" DEFAULT 'PES'::"text" NOT NULL,
    "default_concept" integer,
    "invoice_policy" "text" DEFAULT 'manual'::"text" NOT NULL,
    "is_enabled" boolean DEFAULT false NOT NULL,
    "accountant_review_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "production_gate_status" "text" DEFAULT 'blocked'::"text" NOT NULL,
    "verified_at" timestamp with time zone,
    "verified_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "default_recipient_condition" "text",
    "certificate_fingerprint_sha256" "text",
    "certificate_expires_at" timestamp with time zone,
    "certificate_subject_cuit" "text",
    "credential_checked_at" timestamp with time zone,
    "delegation_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "delegation_verified_at" timestamp with time zone,
    "connection_ok_at" timestamp with time zone,
    "artifact_verified_at" timestamp with time zone,
    "print_verified_at" timestamp with time zone,
    "homologation_authorized_at" timestamp with time zone,
    "homologation_authorized_by" "uuid",
    "last_error_code" "text",
    "last_error_at" timestamp with time zone,
    CONSTRAINT "fiscal_profiles_accountant_review_status_check" CHECK (("accountant_review_status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"]))),
    CONSTRAINT "fiscal_profiles_certificate_fingerprint_check" CHECK ((("certificate_fingerprint_sha256" IS NULL) OR ("certificate_fingerprint_sha256" ~ '^[a-f0-9]{64}$'::"text"))),
    CONSTRAINT "fiscal_profiles_certificate_subject_cuit_check" CHECK ((("certificate_subject_cuit" IS NULL) OR ("certificate_subject_cuit" ~ '^[0-9]{11}$'::"text"))),
    CONSTRAINT "fiscal_profiles_delegation_status_check" CHECK (("delegation_status" = ANY (ARRAY['pending'::"text", 'verified'::"text", 'rejected'::"text"]))),
    CONSTRAINT "fiscal_profiles_enabled_verified" CHECK (((NOT "is_enabled") OR (("environment" <> 'disabled'::"text") AND ("cuit" ~ '^[0-9]{11}$'::"text") AND (("point_of_sale" >= 1) AND ("point_of_sale" <= 99999)) AND ("legal_name" IS NOT NULL) AND ("tax_condition" IS NOT NULL)))),
    CONSTRAINT "fiscal_profiles_environment_check" CHECK (("environment" = ANY (ARRAY['disabled'::"text", 'homologation'::"text", 'production'::"text"]))),
    CONSTRAINT "fiscal_profiles_homologation_authorization_pairing" CHECK (((("homologation_authorized_at" IS NULL) AND ("homologation_authorized_by" IS NULL)) OR (("homologation_authorized_at" IS NOT NULL) AND ("homologation_authorized_by" IS NOT NULL)))),
    CONSTRAINT "fiscal_profiles_invoice_policy_check" CHECK (("invoice_policy" = ANY (ARRAY['manual'::"text", 'on_payment_confirmed'::"text", 'on_order_accepted'::"text", 'on_ready'::"text", 'on_delivered'::"text"]))),
    CONSTRAINT "fiscal_profiles_last_error_code_check" CHECK ((("last_error_code" IS NULL) OR ("last_error_code" ~ '^[A-Z][A-Z0-9_]{2,63}$'::"text"))),
    CONSTRAINT "fiscal_profiles_production_gate" CHECK ((("environment" <> 'production'::"text") OR (("accountant_review_status" = 'approved'::"text") AND ("production_gate_status" = 'approved'::"text") AND ("verified_at" IS NOT NULL) AND ("verified_by" IS NOT NULL)))),
    CONSTRAINT "fiscal_profiles_production_gate_status_check" CHECK (("production_gate_status" = ANY (ARRAY['blocked'::"text", 'approved'::"text"])))
);


ALTER TABLE "public"."fiscal_profiles" OWNER TO "postgres";


COMMENT ON TABLE "public"."fiscal_profiles" IS 'Configuracion fiscal administrativa. Produccion exige accountant_review_status approved y gate del servidor.';



COMMENT ON COLUMN "public"."fiscal_profiles"."certificate_fingerprint_sha256" IS 'Huella pública del certificado. La clave privada nunca sale del puente fiscal.';



COMMENT ON COLUMN "public"."fiscal_profiles"."homologation_authorized_at" IS 'Momento en que una persona autorizó explícitamente las pruebas con ARCA. Null significa configurado pero no autorizado.';



COMMENT ON COLUMN "public"."fiscal_profiles"."homologation_authorized_by" IS 'Quién autorizó las pruebas con ARCA. Null significa configurado pero no autorizado.';



COMMENT ON COLUMN "public"."fiscal_profiles"."last_error_code" IS 'Código saneado del último problema con ARCA. Nunca contiene XML ni mensajes del proveedor.';



COMMENT ON CONSTRAINT "fiscal_profiles_homologation_authorization_pairing" ON "public"."fiscal_profiles" IS 'La autorización de homologación se registra completa (fecha y actor) o no se registra. Configurar el entorno de homologación no autoriza nada por sí solo.';



CREATE OR REPLACE FUNCTION "public"."configure_fiscal_profile"("p_business_id" "uuid", "p_profile" "jsonb") RETURNS "public"."fiscal_profiles"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
declare v_result public.fiscal_profiles%rowtype;
begin
  if not public.has_business_role(p_business_id,array['owner','admin']) then raise exception 'owner/admin requerido' using errcode='42501'; end if;
  if coalesce(p_profile,'{}'::jsonb)-array['legal_name','cuit','tax_condition','gross_income_number','business_address','environment','point_of_sale','default_currency','default_concept','invoice_policy','is_enabled','default_recipient_condition'] <> '{}'::jsonb then raise exception 'payload fiscal no permitido' using errcode='22023'; end if;
  if coalesce(p_profile->>'environment','disabled') not in ('disabled','homologation') then raise exception 'produccion no se configura desde el panel' using errcode='42501'; end if;
  -- El concepto por defecto entra validado o no entra: sin esto, un perfil con
  -- concepto nulo o fuera de (1,2,3) recién explota al emitir el comprobante.
  if coalesce((p_profile->>'default_concept')::integer, 1) not in (1, 2, 3) then
    raise exception 'concepto fiscal invalido (1=productos, 2=servicios, 3=mixto)' using errcode = '22023';
  end if;
  if (p_profile->>'is_enabled')::boolean and (
    coalesce(p_profile->>'environment','disabled')='disabled'
    or coalesce(p_profile->>'cuit','') !~ '^[0-9]{11}$'
    or coalesce((p_profile->>'point_of_sale')::integer,0) not between 1 and 99999
    or btrim(coalesce(p_profile->>'legal_name',''))=''
    or btrim(coalesce(p_profile->>'tax_condition',''))=''
    or btrim(coalesce(p_profile->>'default_recipient_condition',''))=''
  ) then raise exception 'perfil fiscal incompleto' using errcode='22023'; end if;
  insert into public.fiscal_profiles(business_id,legal_name,cuit,tax_condition,gross_income_number,business_address,environment,point_of_sale,default_currency,default_concept,invoice_policy,is_enabled,default_recipient_condition,updated_at)
  values(p_business_id,nullif(btrim(p_profile->>'legal_name'),''),nullif(regexp_replace(coalesce(p_profile->>'cuit',''),'[^0-9]','','g'),''),nullif(btrim(p_profile->>'tax_condition'),''),nullif(btrim(p_profile->>'gross_income_number'),''),nullif(btrim(p_profile->>'business_address'),''),coalesce(p_profile->>'environment','disabled'),(p_profile->>'point_of_sale')::integer,coalesce(nullif(btrim(p_profile->>'default_currency'),''),'PES'),coalesce((p_profile->>'default_concept')::integer, 1),coalesce(nullif(btrim(p_profile->>'invoice_policy'),''),'manual'),coalesce((p_profile->>'is_enabled')::boolean,false),nullif(btrim(p_profile->>'default_recipient_condition'),''),now())
  on conflict(business_id) do update set
    legal_name=excluded.legal_name,cuit=excluded.cuit,tax_condition=excluded.tax_condition,
    gross_income_number=excluded.gross_income_number,business_address=excluded.business_address,
    environment=excluded.environment,point_of_sale=excluded.point_of_sale,
    default_currency=excluded.default_currency,default_concept=excluded.default_concept,
    invoice_policy=excluded.invoice_policy,is_enabled=excluded.is_enabled,
    default_recipient_condition=excluded.default_recipient_condition,updated_at=now()
  returning * into v_result;
  return v_result;
end;
$_$;


ALTER FUNCTION "public"."configure_fiscal_profile"("p_business_id" "uuid", "p_profile" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."configure_mercadopago_settings"("p_business_id" "uuid", "p_settings" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
declare
  v_settings public.business_payment_settings%rowtype;
  v_allowed text[] := array['collector_id', 'application_id', 'installments_limit', 'preference_expiration_minutes', 'reserve_stock', 'enabled'];
  v_collector text;
  v_application text;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'configuracion de cobros requiere owner o admin' using errcode = '42501';
  end if;
  -- Cualquier clave fuera de la lista se rechaza: impide que un secreto entre por esta puerta.
  if coalesce(p_settings, '{}'::jsonb) - v_allowed <> '{}'::jsonb then
    raise exception 'payload no permitido' using errcode = '22023';
  end if;

  v_collector := nullif(btrim(coalesce(p_settings->>'collector_id', '')), '');
  v_application := nullif(btrim(coalesce(p_settings->>'application_id', '')), '');
  if v_collector is not null and v_collector !~ '^[0-9]{6,32}$' then
    raise exception 'identificador de vendedor invalido' using errcode = '22023';
  end if;
  if v_application is not null and v_application !~ '^[0-9]{6,32}$' then
    raise exception 'identificador de aplicacion invalido' using errcode = '22023';
  end if;

  insert into public.business_payment_settings (
    business_id, provider, environment, checkout_mode, currency, reserve_stock,
    collector_id, application_id, configured_at
  )
  values (
    p_business_id, 'mercadopago', 'test', 'checkout_pro', 'ARS', true,
    v_collector, v_application, clock_timestamp()
  )
  on conflict (business_id, provider) do nothing;

  select * into v_settings from public.business_payment_settings
   where business_id = p_business_id and provider = 'mercadopago' for update;

  -- El panel opera únicamente el ambiente de prueba; el pase a dinero real es una decisión aparte.
  if v_settings.environment <> 'test' then
    raise exception 'el panel no configura cobros con dinero real' using errcode = '42501';
  end if;

  update public.business_payment_settings set
    collector_id = coalesce(v_collector, collector_id),
    application_id = coalesce(v_application, application_id),
    installments_limit = case
      when p_settings ? 'installments_limit' then nullif(p_settings->>'installments_limit', '')::integer
      else installments_limit
    end,
    preference_expiration_minutes = case
      when p_settings ? 'preference_expiration_minutes' then (p_settings->>'preference_expiration_minutes')::integer
      else preference_expiration_minutes
    end,
    reserve_stock = case
      when p_settings ? 'reserve_stock' then (p_settings->>'reserve_stock')::boolean
      else reserve_stock
    end,
    enabled = case
      when p_settings ? 'enabled' then (p_settings->>'enabled')::boolean
      else enabled
    end,
    configured_at = coalesce(configured_at, clock_timestamp()),
    updated_at = clock_timestamp()
  where id = v_settings.id
  returning * into v_settings;

  return jsonb_build_object('ok', true, 'enabled', v_settings.enabled, 'environment', v_settings.environment);
end;
$_$;


ALTER FUNCTION "public"."configure_mercadopago_settings"("p_business_id" "uuid", "p_settings" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."configure_mercadopago_settings"("p_business_id" "uuid", "p_settings" "jsonb") IS 'Ajustes operativos de cobro para owner/admin. Rechaza cualquier clave fuera de la lista permitida y no admite dinero real.';



CREATE OR REPLACE FUNCTION "public"."confirm_delivery_code"("p_order_id" "uuid", "p_expected_revision" bigint, "p_delivery_code" "text", "p_idempotency_key" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
declare
  v_order public.orders%rowtype;
  v_handoff public.order_delivery_handoffs%rowtype;
  v_key text := public.rider_validate_idempotency_key(p_idempotency_key);
  v_code text := regexp_replace(coalesce(p_delivery_code, ''), '[^0-9]', '', 'g');
  v_result jsonb;
  v_now timestamptz;
  v_attempts integer;
  v_lock_level integer;
  v_retry_seconds integer;
begin
  if v_code !~ '^[0-9]{4}$' then return jsonb_build_object('ok', false, 'code', 'invalid_format'); end if;
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_assigned'); end if;
  perform public.rider_require_active_membership(v_order.business_id);
  if v_order.assigned_rider_user_id is distinct from auth.uid() then return jsonb_build_object('ok', false, 'code', 'not_assigned'); end if;
  select result into v_result from public.rider_delivery_operations
   where order_id = v_order.id and rider_user_id = auth.uid() and operation = 'confirm_code' and idempotency_key = v_key for share;
  if found then return v_result || jsonb_build_object('idempotent_no_op', true); end if;
  select h.* into v_handoff from public.order_delivery_handoffs h where h.order_id = v_order.id for update;
  v_now := clock_timestamp();
  if v_order.status = 'delivered' and v_handoff.confirmed_at is not null then
    v_result := jsonb_build_object('ok', true, 'outcome', 'already_delivered', 'idempotent_no_op', true, 'order', public.rider_active_delivery_payload(v_order.id));
    insert into public.delivery_confirmation_attempts(business_id, order_id, rider_id, request_id, result)
    values (v_order.business_id, v_order.id, auth.uid(), v_key, 'already_delivered') on conflict do nothing;
    insert into public.rider_delivery_operations(order_id, rider_user_id, operation, idempotency_key, request_fingerprint, result)
    values (v_order.id, auth.uid(), 'confirm_code', v_key, digest(jsonb_build_object('revision', p_expected_revision)::text, 'sha256'), v_result);
    return v_result;
  end if;
  if v_order.revision <> p_expected_revision then return jsonb_build_object('ok', false, 'code', 'stale_revision', 'revision', v_order.revision); end if;
  if v_order.status <> 'arrived' then return jsonb_build_object('ok', false, 'code', 'not_arrived', 'revision', v_order.revision); end if;
  if not found or v_handoff.expires_at <= v_now then return jsonb_build_object('ok', false, 'code', 'code_unavailable'); end if;
  if v_handoff.locked_until is not null and v_handoff.locked_until > v_now then
    v_retry_seconds := greatest(1, ceil(extract(epoch from (v_handoff.locked_until - v_now)))::integer);
    v_result := jsonb_build_object('ok', false, 'code', 'temporarily_locked', 'retry_after_seconds', v_retry_seconds, 'lock_until', v_handoff.locked_until);
    insert into public.delivery_confirmation_attempts(business_id, order_id, rider_id, request_id, result, lock_level, retry_after_seconds)
    values (v_order.business_id, v_order.id, auth.uid(), v_key, 'temporarily_locked', greatest(1, v_handoff.failed_attempts - 4), v_retry_seconds);
    insert into public.rider_delivery_operations(order_id, rider_user_id, operation, idempotency_key, request_fingerprint, result)
    values (v_order.id, auth.uid(), 'confirm_code', v_key, digest(jsonb_build_object('revision', p_expected_revision)::text, 'sha256'), v_result);
    return v_result;
  end if;
  if crypt(v_code, v_handoff.code_hash) <> v_handoff.code_hash then
    v_attempts := least(20, v_handoff.failed_attempts + 1);
    v_lock_level := greatest(0, v_attempts - 4);
    v_retry_seconds := case when v_attempts < 5 then null else least(86400, 300 * power(2, least(8, v_attempts - 5))::integer) end;
    update public.order_delivery_handoffs set failed_attempts = v_attempts, locked_until = case when v_retry_seconds is null then null else v_now + make_interval(secs => v_retry_seconds) end where order_id = v_order.id;
    v_result := jsonb_build_object('ok', false, 'code', case when v_retry_seconds is null then 'incorrect_code' else 'temporarily_locked' end, 'remaining_attempts', greatest(0, 5 - v_attempts), 'retry_after_seconds', v_retry_seconds, 'lock_until', case when v_retry_seconds is null then null else v_now + make_interval(secs => v_retry_seconds) end);
    insert into public.delivery_confirmation_attempts(business_id, order_id, rider_id, request_id, result, lock_level, retry_after_seconds)
    values (v_order.business_id, v_order.id, auth.uid(), v_key, case when v_retry_seconds is null then 'incorrect_code' else 'temporarily_locked' end, v_lock_level, v_retry_seconds);
    insert into public.rider_delivery_operations(order_id, rider_user_id, operation, idempotency_key, request_fingerprint, result)
    values (v_order.id, auth.uid(), 'confirm_code', v_key, digest(jsonb_build_object('revision', p_expected_revision)::text, 'sha256'), v_result);
    return v_result;
  end if;
  update public.order_delivery_handoffs set confirmed_at = v_now, confirmed_by_user_id = auth.uid(), failed_attempts = 0, locked_until = null where order_id = v_order.id;
  perform set_config('taba.delivery_code_confirmed', 'true', true);
  update public.orders set status = 'delivered', delivered_at = v_now where id = v_order.id and status = 'arrived';
  insert into public.delivery_outbox(business_id, order_id, event_type, event_key, payload)
  values (v_order.business_id, v_order.id, 'delivery_confirmed', v_key, jsonb_build_object('revision', (select revision from public.orders where id = v_order.id), 'confirmed_at', v_now))
  on conflict (order_id, event_type, event_key) do nothing;
  v_result := jsonb_build_object('ok', true, 'outcome', 'confirmed', 'idempotent_no_op', false, 'order', public.rider_active_delivery_payload(v_order.id));
  insert into public.delivery_confirmation_attempts(business_id, order_id, rider_id, request_id, result)
  values (v_order.business_id, v_order.id, auth.uid(), v_key, 'confirmed');
  insert into public.rider_delivery_operations(order_id, rider_user_id, operation, idempotency_key, request_fingerprint, result)
  values (v_order.id, auth.uid(), 'confirm_code', v_key, digest(jsonb_build_object('revision', p_expected_revision)::text, 'sha256'), v_result);
  return v_result;
end;
$_$;


ALTER FUNCTION "public"."confirm_delivery_code"("p_order_id" "uuid", "p_expected_revision" bigint, "p_delivery_code" "text", "p_idempotency_key" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."confirm_delivery_code"("p_order_id" "uuid", "p_expected_revision" bigint, "p_delivery_code" "text", "p_idempotency_key" "text") IS 'Transactional code confirmation with server rate limiting, idempotency, terminal GPS revocation and outbox intent.';



CREATE OR REPLACE FUNCTION "public"."confirm_order_delivery"("p_order_id" "uuid", "p_expected_status" "text", "p_delivery_code" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
declare
  v_order public.orders%rowtype;
  v_handoff public.order_delivery_handoffs%rowtype;
  v_code text := regexp_replace(coalesce(p_delivery_code, ''), '[^0-9]', '', 'g');
  v_now timestamptz;
  v_attempts integer;
  v_lock_minutes integer;
begin
  if auth.uid() is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if v_code !~ '^[0-9]{4}$' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_FORMAT');
  end if;

  select o.*
    into v_order
    from public.orders o
   where o.id = p_order_id
   for update;

  if not found
    or v_order.assigned_rider_user_id is distinct from auth.uid() then
    raise exception 'pedido no encontrado o acceso denegado' using errcode = '42501';
  end if;

  perform 1
    from public.business_members bm
   where bm.business_id = v_order.business_id
     and bm.user_id = auth.uid()
     and bm.role = 'rider'
     and bm.is_active = true
   for share;
  if not found then
    raise exception 'pedido no encontrado o acceso denegado' using errcode = '42501';
  end if;

  select h.*
    into v_handoff
    from public.order_delivery_handoffs h
   where h.order_id = v_order.id
   for update;

  -- Capture time only after both locks were acquired. A queued confirmation
  -- must not calculate throttles or timestamps from a stale pre-lock instant.
  v_now := clock_timestamp();

  if v_order.status = 'delivered'
    and found
    and v_handoff.confirmed_at is not null
    and v_handoff.confirmed_by_user_id = auth.uid() then
    return jsonb_build_object(
      'ok', true,
      'already_confirmed', true,
      'public_code', v_order.public_code,
      'status', v_order.status,
      'confirmed_at', v_handoff.confirmed_at
    );
  end if;

  if v_order.status <> 'arrived'
    or lower(coalesce(p_expected_status, '')) <> 'arrived' then
    raise exception 'estado concurrente o invalido' using errcode = '40001';
  end if;
  if not found or v_handoff.expires_at <= v_now then
    return jsonb_build_object('ok', false, 'code', 'CODE_UNAVAILABLE');
  end if;
  if v_handoff.confirmed_at is not null then
    return jsonb_build_object('ok', false, 'code', 'CODE_UNAVAILABLE');
  end if;
  if v_handoff.locked_until is not null and v_handoff.locked_until > v_now then
    return jsonb_build_object(
      'ok', false,
      'code', 'LOCKED',
      'locked_until', v_handoff.locked_until
    );
  end if;

  if crypt(v_code, v_handoff.code_hash) <> v_handoff.code_hash then
    v_attempts := least(20, v_handoff.failed_attempts + 1);
    v_lock_minutes := case
      when v_attempts < 5 then 0
      else least(1440, 5 * power(2, least(8, v_attempts - 5))::integer)
    end;
    update public.order_delivery_handoffs
       set failed_attempts = v_attempts,
           locked_until = case
             when v_lock_minutes > 0
               then v_now + make_interval(mins => v_lock_minutes)
             else null
           end
     where order_id = v_order.id;

    if v_lock_minutes > 0 then
      insert into public.order_events (
        order_id,
        business_id,
        actor_user_id,
        actor_role,
        actor_type,
        actor_id,
        event_type,
        type,
        message,
        metadata,
        payload
      ) values (
        v_order.id,
        v_order.business_id,
        auth.uid(),
        'rider',
        'rider',
        auth.uid(),
        'order.delivery_code_locked',
        'order.delivery_code_locked',
        'Código de entrega temporalmente bloqueado',
        jsonb_build_object(
          'failed_attempts', v_attempts,
          'locked_until', v_now + make_interval(mins => v_lock_minutes)
        ),
        jsonb_build_object(
          'failed_attempts', v_attempts,
          'locked_until', v_now + make_interval(mins => v_lock_minutes)
        )
      );
    end if;

    return jsonb_build_object(
      'ok', false,
      'code', case when v_lock_minutes > 0 then 'LOCKED' else 'MISMATCH' end,
      'remaining_attempts', greatest(0, 5 - v_attempts),
      'locked_until', case
        when v_lock_minutes > 0 then v_now + make_interval(mins => v_lock_minutes)
        else null
      end
    );
  end if;

  update public.order_delivery_handoffs
     set confirmed_at = v_now,
         confirmed_by_user_id = auth.uid(),
         failed_attempts = 0,
         locked_until = null
   where order_id = v_order.id;

  update public.orders
     set status = 'delivered',
         delivered_at = coalesce(delivered_at, v_now)
   where id = v_order.id
     and status = 'arrived'
  returning * into v_order;

  insert into public.order_events (
    order_id,
    business_id,
    actor_user_id,
    actor_role,
    actor_type,
    actor_id,
    event_type,
    type,
    message,
    metadata,
    payload
  ) values (
    v_order.id,
    v_order.business_id,
    auth.uid(),
    'rider',
    'rider',
    auth.uid(),
    'order.delivery_handoff_confirmed',
    'order.delivery_handoff_confirmed',
    'Entrega validada con código',
    jsonb_build_object('confirmed_at', v_now),
    jsonb_build_object('confirmed_at', v_now)
  );

  return jsonb_build_object(
    'ok', true,
    'public_code', v_order.public_code,
    'status', v_order.status,
    'confirmed_at', v_now
  );
end;
$_$;


ALTER FUNCTION "public"."confirm_order_delivery"("p_order_id" "uuid", "p_expected_status" "text", "p_delivery_code" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."confirm_order_delivery"("p_order_id" "uuid", "p_expected_status" "text", "p_delivery_code" "text") IS 'Assigned rider handoff confirmation with row lock, rate limit and atomic delivery.';



CREATE TABLE IF NOT EXISTS "public"."order_packing_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "order_id" "uuid" NOT NULL,
    "order_revision" bigint NOT NULL,
    "status" "text" DEFAULT 'in_progress'::"text" NOT NULL,
    "operator_id" "uuid" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "exception_reason" "text",
    "exception_authorized_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "confirmed_at" timestamp with time zone,
    "correlation_id" "uuid" NOT NULL,
    CONSTRAINT "order_packing_sessions_status_check" CHECK (("status" = ANY (ARRAY['not_started'::"text", 'in_progress'::"text", 'complete'::"text", 'exception_required'::"text", 'confirmed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."order_packing_sessions" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."confirm_packing_session"("p_session_id" "uuid", "p_exception_reason" "text" DEFAULT NULL::"text") RETURNS "public"."order_packing_sessions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_session public.order_packing_sessions%rowtype;
  v_complete boolean;
begin
  select s.* into v_session from public.order_packing_sessions s where s.id=p_session_id for update;
  if not found then raise exception 'sesion inexistente' using errcode='P0002'; end if;
  if not public.has_business_role(v_session.business_id,array['owner','admin','staff']) then raise exception 'operador no autorizado' using errcode='42501'; end if;
  select not exists(
    select 1 from public.order_items oi where oi.order_id=v_session.order_id
      and coalesce((select sum(ps.unit_factor) from public.order_packing_scans ps where ps.session_id=v_session.id and ps.order_item_id=oi.id and ps.reverted_at is null),0)<>oi.quantity
  ) into v_complete;
  if not v_complete and (not public.has_business_role(v_session.business_id,array['owner','admin']) or char_length(btrim(coalesce(p_exception_reason,''))) not between 3 and 300) then
    update public.order_packing_sessions set status='exception_required',updated_at=now() where id=p_session_id;
    raise exception 'faltantes requieren excepcion owner/admin con motivo' using errcode='42501';
  end if;
  update public.order_packing_sessions
  set status='confirmed',exception_reason=case when v_complete then null else btrim(p_exception_reason) end,
      exception_authorized_by=case when v_complete then null else auth.uid() end,confirmed_at=now(),updated_at=now()
  where id=p_session_id returning * into v_session;
  return v_session;
end;
$$;


ALTER FUNCTION "public"."confirm_packing_session"("p_session_id" "uuid", "p_exception_reason" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."confirm_packing_session"("p_session_id" "uuid", "p_exception_reason" "text") IS 'SUPERSEDED por confirm_packing_session_once: sin receipts ni request_hash. Ejecución revocada.';



CREATE OR REPLACE FUNCTION "public"."confirm_packing_session_once"("p_session_id" "uuid", "p_exception_reason" "text", "p_idempotency_key" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
declare
  v_session public.order_packing_sessions%rowtype;
  v_receipt public.business_command_receipts%rowtype;
  v_complete boolean;
  v_hash text;
  v_result jsonb;
begin
  if btrim(coalesce(p_idempotency_key,'')) !~ '^[A-Za-z0-9:_-]{8,128}$' then
    raise exception 'idempotency_key invalida' using errcode='22023';
  end if;
  select s.* into v_session from public.order_packing_sessions s where s.id=p_session_id for update;
  if not found then raise exception 'sesion inexistente' using errcode='P0002'; end if;
  if not public.has_business_role(v_session.business_id,array['owner','admin','staff']) then
    raise exception 'operador no autorizado' using errcode='42501';
  end if;
  v_hash:=public.business_command_request_hash(
    'confirm_packing_session',v_session.order_id,
    jsonb_build_object('session_id',p_session_id,'exception_reason',nullif(btrim(coalesce(p_exception_reason,'')),''))
  );
  select r.* into v_receipt from public.business_command_receipts r
  where r.business_id=v_session.business_id and r.idempotency_key=p_idempotency_key;
  if found then
    if v_receipt.request_hash<>v_hash then
      raise exception 'idempotency_key reutilizada con otro payload' using errcode='23505';
    end if;
    return v_receipt.result||jsonb_build_object('idempotent_replay',true);
  end if;
  if v_session.status='confirmed' then
    v_result:=to_jsonb(v_session)||jsonb_build_object('ok',true);
  else
    if v_session.status not in ('in_progress','complete','exception_required') then
      raise exception 'sesion cerrada' using errcode='P0001';
    end if;
    select not exists(
      select 1 from public.order_items oi where oi.order_id=v_session.order_id
        and coalesce((select sum(ps.unit_factor) from public.order_packing_scans ps where ps.session_id=v_session.id and ps.order_item_id=oi.id and ps.reverted_at is null),0)<>oi.quantity
    ) into v_complete;
    if not v_complete and (
      not public.has_business_role(v_session.business_id,array['owner','admin'])
      or char_length(btrim(coalesce(p_exception_reason,''))) not between 3 and 300
    ) then
      raise exception 'faltantes requieren excepcion owner/admin con motivo' using errcode='42501';
    end if;
    update public.order_packing_sessions
    set status='confirmed',exception_reason=case when v_complete then null else btrim(p_exception_reason) end,
        exception_authorized_by=case when v_complete then null else auth.uid() end,
        confirmed_at=coalesce(confirmed_at,now()),updated_at=now()
    where id=p_session_id returning * into v_session;
    v_result:=to_jsonb(v_session)||jsonb_build_object('ok',true);
  end if;
  insert into public.business_command_receipts(
    business_id,order_id,actor_user_id,command_type,idempotency_key,request_hash,result
  ) values (
    v_session.business_id,v_session.order_id,auth.uid(),'confirm_packing_session',p_idempotency_key,v_hash,v_result
  );
  return v_result||jsonb_build_object('idempotent_replay',false);
end;
$_$;


ALTER FUNCTION "public"."confirm_packing_session_once"("p_session_id" "uuid", "p_exception_reason" "text", "p_idempotency_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."consume_payment_rate_limit"("p_scope" "text", "p_subject_hash" "text", "p_limit" integer, "p_window_seconds" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
declare
  v_bucket timestamptz;
  v_count integer;
begin
  if p_scope not in ('checkout_session', 'preference', 'checkout_status', 'webhook', 'refund', 'cancellation', 'worker')
    or p_subject_hash !~ '^[a-f0-9]{64}$'
    or p_limit not between 1 and 1000
    or p_window_seconds not between 10 and 3600 then
    raise exception 'rate limit invalido' using errcode = '22023';
  end if;
  v_bucket := to_timestamp(floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds);
  insert into public.payment_rate_limit_buckets (
    scope, subject_hash, bucket_started_at, request_count
  ) values (
    p_scope, p_subject_hash, v_bucket, 1
  ) on conflict (scope, subject_hash, bucket_started_at)
  do update set request_count = public.payment_rate_limit_buckets.request_count + 1
  returning request_count into v_count;
  return jsonb_build_object('allowed', v_count <= p_limit, 'count', v_count, 'limit', p_limit, 'bucket_started_at', v_bucket);
end;
$_$;


ALTER FUNCTION "public"."consume_payment_rate_limit"("p_scope" "text", "p_subject_hash" "text", "p_limit" integer, "p_window_seconds" integer) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."catalog_product_drafts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "scanned_gtin" "text" NOT NULL,
    "suggested_name" "text",
    "suggested_brand" "text",
    "suggested_presentation" "text",
    "suggested_category" "text",
    "suggested_image" "text",
    "source" "text" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "confidence" numeric(4,3) DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'pending_review'::"text" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "product_id" "uuid",
    CONSTRAINT "catalog_product_drafts_confidence_check" CHECK ((("confidence" >= (0)::numeric) AND ("confidence" <= (1)::numeric))),
    CONSTRAINT "catalog_product_drafts_status_check" CHECK (("status" = ANY (ARRAY['pending_review'::"text", 'approved'::"text", 'rejected'::"text", 'merged'::"text"])))
);


ALTER TABLE "public"."catalog_product_drafts" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_catalog_product_draft"("p_business_id" "uuid", "p_gtin" "text", "p_suggestion" "jsonb", "p_idempotency_key" "text") RETURNS "public"."catalog_product_drafts"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
declare v_result public.catalog_product_drafts%rowtype;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  if coalesce(p_suggestion, '{}'::jsonb) - array['name','brand','presentation','category','image','source','confidence'] <> '{}'::jsonb then raise exception 'payload no permitido' using errcode = '22023'; end if;
  if p_gtin !~ '^[0-9]{8}$|^[0-9]{12}$|^[0-9]{13}$|^[0-9]{14}$' then raise exception 'GTIN invalido' using errcode = '22023'; end if;
  if not public.gtin_check_digit_valid(p_gtin) then raise exception 'digito verificador invalido' using errcode = '22023'; end if;
  if btrim(coalesce(p_idempotency_key,'')) !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'idempotency_key invalida' using errcode='22023'; end if;
  select d.* into v_result from public.catalog_product_drafts d
   where d.business_id=p_business_id
     and (d.idempotency_key=p_idempotency_key or (d.scanned_gtin=p_gtin and d.status='pending_review'))
   order by (d.idempotency_key=p_idempotency_key) desc limit 1 for update;
  if found then return v_result; end if;
  insert into public.catalog_product_drafts(business_id, scanned_gtin, suggested_name, suggested_brand, suggested_presentation, suggested_category, suggested_image, source, idempotency_key, confidence, created_by)
  values (p_business_id, p_gtin, nullif(btrim(p_suggestion->>'name'), ''), nullif(btrim(p_suggestion->>'brand'), ''), nullif(btrim(p_suggestion->>'presentation'), ''), nullif(btrim(p_suggestion->>'category'), ''), nullif(btrim(p_suggestion->>'image'), ''), coalesce(nullif(btrim(p_suggestion->>'source'), ''), 'manual'),p_idempotency_key,least(1, greatest(0, coalesce((p_suggestion->>'confidence')::numeric, 0))), auth.uid())
  returning * into v_result;
  return v_result;
end;
$_$;


ALTER FUNCTION "public"."create_catalog_product_draft"("p_business_id" "uuid", "p_gtin" "text", "p_suggestion" "jsonb", "p_idempotency_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_checkout_session"("p_customer_id" "uuid", "p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
declare
  v_business_id uuid;
  v_business public.businesses%rowtype;
  v_settings public.business_payment_settings%rowtype;
  v_client_request_id text;
  v_items jsonb;
  v_contact jsonb;
  v_address jsonb;
  v_fulfillment_type text;
  v_age_confirmed boolean := false;
  v_name text;
  v_phone text;
  v_address_id uuid;
  v_saved_address public.customer_addresses%rowtype;
  v_street text;
  v_street_number text;
  v_floor text;
  v_apartment text;
  v_reference text;
  v_city text;
  v_province text;
  v_postal_code text;
  v_address_label text;
  v_address_source text;
  v_location_source text;
  v_location_confirmed_at timestamptz;
  v_latitude numeric(9, 6);
  v_longitude numeric(9, 6);
  v_geolocation_accuracy numeric(10, 2);
  v_address_snapshot jsonb;
  v_contact_snapshot jsonb;
  v_normalized_items jsonb := '[]'::jsonb;
  v_request_hash text;
  v_session public.checkout_sessions%rowtype;
  v_existing public.checkout_sessions%rowtype;
  v_item record;
  v_product public.products%rowtype;
  v_subtotal numeric(12, 2) := 0;
  v_delivery_fee numeric(12, 2) := 0;
  v_total numeric(12, 2) := 0;
  v_contains_alcohol boolean := false;
  v_expires_at timestamptz;
  v_payment_intent_id uuid;
  v_unexpected_key text;
  v_rate_count integer;
  v_normalized_products jsonb := '[]'::jsonb;
  v_normalized_combos jsonb := '[]'::jsonb;
  v_combo record;
  v_combo_row public.product_combos%rowtype;
  v_combo_components jsonb;
  v_combo_component_count integer;
  v_combo_declared_count integer;
  v_combo_list_price numeric(12, 2);
  v_combo_promotional numeric(12, 2);
  v_discount_total numeric(12, 2) := 0;
begin
  if p_customer_id is null then
    raise exception 'cliente autenticado requerido' using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload de checkout invalido' using errcode = '22023';
  end if;

  select key into v_unexpected_key
    from jsonb_object_keys(p_payload) as keys(key)
   where key not in (
     'business_id', 'client_request_id', 'items', 'fulfillment_type',
     'contact', 'address', 'age_confirmed', 'payment_method'
   )
   limit 1;
  if v_unexpected_key is not null then
    raise exception 'campo no permitido en checkout: %', v_unexpected_key using errcode = '22023';
  end if;

  if coalesce(p_payload ->> 'business_id', '') !~*
     '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'business_id invalido' using errcode = '22023';
  end if;
  v_business_id := (p_payload ->> 'business_id')::uuid;
  v_client_request_id := btrim(coalesce(p_payload ->> 'client_request_id', ''));
  v_items := coalesce(p_payload -> 'items', '[]'::jsonb);
  v_contact := p_payload -> 'contact';
  v_address := coalesce(p_payload -> 'address', '{}'::jsonb);
  v_fulfillment_type := lower(btrim(coalesce(p_payload ->> 'fulfillment_type', '')));
  v_age_confirmed := coalesce((p_payload ->> 'age_confirmed')::boolean, false);

  if v_client_request_id !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception 'client_request_id invalido' using errcode = '22023';
  end if;
  if lower(btrim(coalesce(p_payload ->> 'payment_method', ''))) <> 'mercadopago' then
    raise exception 'medio de pago invalido para Checkout Pro' using errcode = '22023';
  end if;
  if v_fulfillment_type not in ('delivery', 'pickup') then
    raise exception 'modalidad de entrega invalida' using errcode = '22023';
  end if;
  if jsonb_typeof(v_items) <> 'array'
    or jsonb_array_length(v_items) < 1
    or jsonb_array_length(v_items) > 100 then
    raise exception 'items debe contener entre 1 y 100 productos' using errcode = '22023';
  end if;
  if jsonb_typeof(v_contact) <> 'object' then
    raise exception 'contacto requerido' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(v_contact) as keys(key)
     where key not in ('name', 'phone')
  ) then
    raise exception 'campo de contacto no permitido' using errcode = '22023';
  end if;
  if jsonb_typeof(v_address) <> 'object' then
    raise exception 'direccion invalida' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(v_address) as keys(key)
     where key not in (
       'customer_address_id', 'label', 'street', 'street_number', 'floor',
       'apartment', 'reference', 'city', 'province', 'postal_code',
       'latitude', 'longitude', 'geolocation_accuracy', 'source',
       'location_source', 'location_confirmed_at'
     )
  ) then
    raise exception 'campo de direccion no permitido' using errcode = '22023';
  end if;
  -- Una linea es de producto o de combo, nunca las dos. Un combo viaja por su
  -- identificador estable y NUNCA con un precio: el precio lo decide el backend.
  if exists (
    select 1
      from jsonb_array_elements(v_items) as item(value)
     where jsonb_typeof(item.value) <> 'object'
        or not (item.value ? 'quantity')
        or (item.value ->> 'quantity') !~ '^[1-9][0-9]*$'
        or (item.value ? 'product_id') = (item.value ? 'combo_id')
        or (
          (item.value ? 'product_id')
          and (
            (item.value ->> 'product_id') !~*
              '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            or (item.value ->> 'quantity')::numeric > 1000
            or exists (
              select 1 from jsonb_object_keys(item.value) as item_keys(key)
               where item_keys.key not in ('product_id', 'quantity')
            )
          )
        )
        or (
          (item.value ? 'combo_id')
          and (
            (item.value ->> 'combo_id') !~ '^[a-z0-9][a-z0-9-]{2,63}$'
            or (item.value ->> 'quantity')::numeric > 100
            or exists (
              select 1 from jsonb_object_keys(item.value) as item_keys(key)
               where item_keys.key not in ('combo_id', 'quantity')
            )
          )
        )
  ) then
    raise exception 'cada item acepta product_id UUID o combo_id, con quantity entero' using errcode = '22023';
  end if;

  v_name := nullif(regexp_replace(btrim(coalesce(v_contact ->> 'name', '')), '[[:space:]]+', ' ', 'g'), '');
  v_phone := regexp_replace(coalesce(v_contact ->> 'phone', ''), '[^0-9]', '', 'g');
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 80 or v_name !~ '[[:alpha:]]' then
    raise exception 'nombre de contacto invalido' using errcode = '22023';
  end if;
  if v_phone !~ '^[0-9]{10,13}$' or v_phone ~ '^([0-9])\1+$' then
    raise exception 'telefono de contacto invalido' using errcode = '22023';
  end if;

  if nullif(v_address ->> 'customer_address_id', '') is not null then
    if (v_address ->> 'customer_address_id') !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'identificador de direccion invalido' using errcode = '22023';
    end if;
    v_address_id := (v_address ->> 'customer_address_id')::uuid;
    select * into v_saved_address
      from public.customer_addresses a
     where a.id = v_address_id
       and a.customer_id = p_customer_id
       and a.deleted_at is null;
    if not found then
      raise exception 'direccion guardada no encontrada' using errcode = '42501';
    end if;
    v_address_label := v_saved_address.label;
    v_street := v_saved_address.street;
    v_street_number := v_saved_address.street_number;
    v_floor := v_saved_address.floor;
    v_apartment := v_saved_address.apartment;
    v_reference := v_saved_address.reference;
    v_city := v_saved_address.city;
    v_province := v_saved_address.province;
    v_postal_code := v_saved_address.postal_code;
    v_address_source := v_saved_address.source;
    v_latitude := v_saved_address.latitude;
    v_longitude := v_saved_address.longitude;
    v_geolocation_accuracy := v_saved_address.geolocation_accuracy;
    v_location_source := v_saved_address.location_source;
    v_location_confirmed_at := v_saved_address.location_confirmed_at;
    -- Una direccion cuya huella dejo de describir su propio texto no sostiene un
    -- pedido: hay que volver a marcar el pin.
    if v_location_confirmed_at is not null
      and coalesce(v_saved_address.location_confirmed_address, '') <> public.delivery_location_address_fingerprint(
        v_saved_address.street, v_saved_address.street_number,
        v_saved_address.city, v_saved_address.province, v_saved_address.postal_code
      ) then
      v_location_confirmed_at := null;
      v_location_source := null;
    end if;
  else
    v_address_label := nullif(btrim(coalesce(v_address ->> 'label', '')), '');
    v_street := nullif(btrim(coalesce(v_address ->> 'street', '')), '');
    v_street_number := nullif(btrim(coalesce(v_address ->> 'street_number', '')), '');
    v_floor := nullif(btrim(coalesce(v_address ->> 'floor', '')), '');
    v_apartment := nullif(btrim(coalesce(v_address ->> 'apartment', '')), '');
    v_reference := nullif(btrim(coalesce(v_address ->> 'reference', '')), '');
    v_city := nullif(btrim(coalesce(v_address ->> 'city', '')), '');
    v_province := nullif(btrim(coalesce(v_address ->> 'province', '')), '');
    v_postal_code := nullif(btrim(coalesce(v_address ->> 'postal_code', '')), '');
    v_address_source := nullif(btrim(coalesce(v_address ->> 'source', 'manual')), '');
    v_location_source := lower(nullif(btrim(coalesce(v_address ->> 'location_source', '')), ''));
    if nullif(v_address ->> 'latitude', '') is not null or nullif(v_address ->> 'longitude', '') is not null then
      if (v_address ->> 'latitude') !~ '^-?[0-9]+(\.[0-9]+)?$'
        or (v_address ->> 'longitude') !~ '^-?[0-9]+(\.[0-9]+)?$' then
        raise exception 'coordenadas invalidas' using errcode = '22023';
      end if;
      v_latitude := (v_address ->> 'latitude')::numeric(9, 6);
      v_longitude := (v_address ->> 'longitude')::numeric(9, 6);
    end if;
    if nullif(v_address ->> 'geolocation_accuracy', '') is not null then
      if (v_address ->> 'geolocation_accuracy') !~ '^[0-9]+(\.[0-9]+)?$' then
        raise exception 'precision invalida' using errcode = '22023';
      end if;
      v_geolocation_accuracy := (v_address ->> 'geolocation_accuracy')::numeric(10, 2);
    end if;
    if nullif(v_address ->> 'location_confirmed_at', '') is not null then
      begin
        v_location_confirmed_at := (v_address ->> 'location_confirmed_at')::timestamptz;
      exception when others then
        raise exception 'momento de confirmacion invalido' using errcode = '22023';
      end;
    end if;
  end if;

  if v_fulfillment_type = 'delivery'
    and (v_street is null or v_street_number is null or v_city is null) then
    raise exception 'direccion de delivery incompleta' using errcode = '22023';
  end if;
  if char_length(coalesce(v_address_label, '')) > 60
    or char_length(coalesce(v_street, '')) > 120
    or char_length(coalesce(v_street_number, '')) > 24
    or char_length(coalesce(v_floor, '')) > 24
    or char_length(coalesce(v_apartment, '')) > 24
    or char_length(coalesce(v_reference, '')) > 180
    or char_length(coalesce(v_city, '')) > 100
    or char_length(coalesce(v_province, '')) > 100
    or char_length(coalesce(v_postal_code, '')) > 20
    or v_address_source not in ('manual', 'gps', 'geocoder', 'previous_order') then
    raise exception 'direccion invalida' using errcode = '22023';
  end if;
  if v_location_source is not null
    and v_location_source not in ('gps', 'map_pin', 'geocoded_confirmed') then
    raise exception 'origen de ubicacion invalido' using errcode = '22023';
  end if;
  if v_location_confirmed_at is not null
    and v_location_confirmed_at > clock_timestamp() + interval '5 minutes' then
    raise exception 'momento de confirmacion en el futuro' using errcode = '22023';
  end if;
  if (v_latitude is null) <> (v_longitude is null) then
    raise exception 'coordenadas incompletas' using errcode = '22023';
  end if;
  if v_latitude is not null
    and (v_latitude not between -90 and 90 or v_longitude not between -180 and 180) then
    raise exception 'coordenadas fuera de rango' using errcode = '22023';
  end if;
  -- Una confirmacion son cuatro piezas juntas o no es nada.
  if v_latitude is null or v_location_source is null or v_location_confirmed_at is null then
    v_location_source := null;
    v_location_confirmed_at := null;
  end if;

  -- LA COMPUERTA. Antes de la sesion, antes de la reserva de stock y antes de la
  -- intencion de pago: si la entrega no tiene punto confirmado, no pasa nada.
  if v_fulfillment_type = 'delivery' and v_location_confirmed_at is null then
    raise exception 'DELIVERY_LOCATION_REQUIRED'
      using errcode = '22023',
            detail = 'la entrega necesita un punto confirmado por el cliente',
            hint = 'confirmar la ubicacion en el mapa antes de pagar';
  end if;

  -- Sin punto, el origen no puede afirmar que hubo uno. Se degrada en vez de
  -- abortar: la direccion postal sigue siendo valida y un pedido de retiro tiene
  -- que poder avanzar; lo que no puede es viajar diciendo `gps` sin coordenadas.
  if v_latitude is null and v_address_source in ('gps', 'geocoder') then
    v_address_source := 'manual';
  end if;
  if v_geolocation_accuracy is not null and v_latitude is null then
    v_geolocation_accuracy := null;
  end if;
  -- El origen del contrato manda sobre la columna historica, cuyo vocabulario no
  -- se amplia porque un consumidor remoto lo restringe.
  if v_location_confirmed_at is not null then
    v_address_source := case v_location_source
      when 'gps' then 'gps'
      when 'geocoded_confirmed' then 'geocoder'
      else 'manual'
    end;
  end if;

  v_contact_snapshot := jsonb_build_object('name', v_name, 'phone', v_phone);
  v_address_snapshot := jsonb_strip_nulls(jsonb_build_object(
    'address_id', v_address_id,
    'label', v_address_label,
    'street', v_street,
    'street_number', v_street_number,
    'floor', v_floor,
    'apartment', v_apartment,
    'reference', v_reference,
    'city', v_city,
    'province', v_province,
    'postal_code', v_postal_code,
    'source', v_address_source,
    'latitude', v_latitude,
    'longitude', v_longitude,
    'geolocation_accuracy', v_geolocation_accuracy,
    'location_source', v_location_source,
    'location_confirmed_at', v_location_confirmed_at
  ));

  select coalesce(jsonb_agg(
    jsonb_build_object('product_id', normalized.product_id, 'quantity', normalized.quantity)
    order by normalized.product_id
  ), '[]'::jsonb)
    into v_normalized_products
    from (
      select (item.value ->> 'product_id')::uuid as product_id,
             sum((item.value ->> 'quantity')::integer)::integer as quantity
        from jsonb_array_elements(v_items) as item(value)
       where item.value ? 'product_id'
       group by (item.value ->> 'product_id')::uuid
    ) as normalized;

  select coalesce(jsonb_agg(
    jsonb_build_object('combo_id', normalized.combo_id, 'quantity', normalized.quantity)
    order by normalized.combo_id
  ), '[]'::jsonb)
    into v_normalized_combos
    from (
      select (item.value ->> 'combo_id') as combo_id,
             sum((item.value ->> 'quantity')::integer)::integer as quantity
        from jsonb_array_elements(v_items) as item(value)
       where item.value ? 'combo_id'
       group by (item.value ->> 'combo_id')
    ) as normalized;

  if exists (
    select 1 from jsonb_to_recordset(v_normalized_combos) as normalized(combo_id text, quantity integer)
     where quantity > 100
  ) then
    raise exception 'quantity total demasiado alta para combo' using errcode = '22023';
  end if;

  -- El hash de intencion incluye los combos: reintentar el mismo carrito
  -- devuelve la misma sesion, y reusar el client_request_id con otros combos se
  -- rechaza igual que si hubieran cambiado los productos.
  v_request_hash := encode(digest(jsonb_build_object(
    'business_id', v_business_id,
    'items', v_normalized_products,
    'combos', v_normalized_combos,
    'fulfillment_type', v_fulfillment_type,
    'contact', v_contact_snapshot,
    'address', v_address_snapshot,
    'age_confirmed', v_age_confirmed
  )::text, 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtext(v_business_id::text), hashtext(v_client_request_id));
  select * into v_existing
    from public.checkout_sessions s
   where s.business_id = v_business_id
     and s.customer_id = p_customer_id
     and s.client_request_id = v_client_request_id
   for update;
  if found then
    if v_existing.normalized_intent_hash <> v_request_hash then
      raise exception 'client_request_id reutilizado con un checkout diferente' using errcode = '23505';
    end if;
    return public.checkout_session_customer_payload(v_existing.id, p_customer_id);
  end if;

  select b.* into v_business
    from public.businesses b
   where b.id = v_business_id
   for share;
  if not found
    or not v_business.is_active
    or v_business.status <> 'open'
    or not v_business.ordering_enabled
    or not v_business.ordering_verified
    or upper(coalesce(v_business.currency_code, '')) <> 'ARS' then
    raise exception 'negocio no habilitado para pagos online' using errcode = '55000';
  end if;
  if (v_fulfillment_type = 'delivery' and not v_business.delivery_enabled)
    or (v_fulfillment_type = 'pickup' and not v_business.pickup_enabled) then
    raise exception 'modalidad de entrega no habilitada' using errcode = '55000';
  end if;

  select s.* into v_settings
    from public.business_payment_settings s
   where s.business_id = v_business_id
     and s.provider = 'mercadopago'
   for share;
  if not found
    or not v_settings.enabled
    or not v_settings.reserve_stock
    or v_settings.checkout_mode <> 'checkout_pro'
    or v_settings.currency <> 'ARS'
    or nullif(btrim(v_settings.collector_id), '') is null
    or nullif(btrim(v_settings.application_id), '') is null
    or (v_settings.environment = 'production' and v_settings.production_review_status <> 'approved') then
    raise exception 'Mercado Pago no esta configurado para este negocio' using errcode = '55000';
  end if;

  if v_business.order_rate_limit_per_10_minutes is not null then
    select count(*) into v_rate_count
      from public.checkout_sessions s
     where s.business_id = v_business_id
       and s.customer_id = p_customer_id
       and s.created_at >= clock_timestamp() - interval '10 minutes';
    if v_rate_count >= v_business.order_rate_limit_per_10_minutes then
      raise exception 'demasiados intentos de checkout; reintenta mas tarde' using errcode = '54000';
    end if;
  end if;

  -- Los combos se expanden a componentes DESPUES de verificar que el negocio
  -- esta habilitado y ANTES de tomar los locks de producto, para que el bucle de
  -- reserva vea una sola cantidad consolidada por producto y no pueda sobrevender
  -- entre una linea suelta y la misma lata dentro de un combo.
  for v_combo in
    select * from jsonb_to_recordset(v_normalized_combos) as c(combo_id text, quantity integer)
     order by combo_id
  loop
    select * into v_combo_row
      from public.product_combos c
     where c.business_id = v_business_id
       and c.combo_id = v_combo.combo_id
     for share;
    if not found or not v_combo_row.is_active then
      raise exception 'combo no disponible: %', v_combo.combo_id using errcode = '55000';
    end if;
    if v_combo_row.approval_status <> 'APROBADO_COMERCIAL' then
      raise exception 'combo sin aprobacion comercial: %', v_combo.combo_id using errcode = '55000';
    end if;
    select count(*)::integer into v_combo_declared_count
      from public.product_combo_components cc
     where cc.combo_id = v_combo_row.id;
    if v_combo_declared_count = 0 then
      raise exception 'combo sin componentes: %', v_combo.combo_id using errcode = '55000';
    end if;
  end loop;

  select coalesce(jsonb_agg(
    jsonb_build_object('product_id', totals.product_id, 'quantity', totals.quantity)
    order by totals.product_id
  ), '[]'::jsonb)
    into v_normalized_items
    from (
      select merged.product_id, sum(merged.quantity)::integer as quantity
        from (
          select (p.value ->> 'product_id')::uuid as product_id,
                 (p.value ->> 'quantity')::integer as quantity
            from jsonb_array_elements(v_normalized_products) as p(value)
          union all
          select cc.product_id,
                 cc.quantity * (c.value ->> 'quantity')::integer
            from jsonb_array_elements(v_normalized_combos) as c(value)
            join public.product_combos pc
              on pc.business_id = v_business_id
             and pc.combo_id = (c.value ->> 'combo_id')
            join public.product_combo_components cc on cc.combo_id = pc.id
        ) as merged
       group by merged.product_id
    ) as totals;

  if jsonb_array_length(v_normalized_items) < 1 then
    raise exception 'el checkout quedo sin productos' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(v_normalized_items) as normalized(product_id uuid, quantity integer)
     where quantity > 1000
  ) then
    raise exception 'quantity total demasiado alta para producto' using errcode = '22023';
  end if;

  v_expires_at := clock_timestamp() + make_interval(mins => v_settings.preference_expiration_minutes);
  insert into public.checkout_sessions (
    business_id, customer_id, client_request_id, normalized_intent_hash,
    fulfillment_type, address_snapshot, contact_snapshot, currency,
    subtotal, discount_total, delivery_fee, total, status, expires_at
  ) values (
    v_business_id, p_customer_id, v_client_request_id, v_request_hash,
    v_fulfillment_type, v_address_snapshot, v_contact_snapshot, 'ARS',
    0, 0, 0, 0, 'validating', v_expires_at
  ) returning * into v_session;

  -- Lock products in deterministic UUID order. Reserving decrements the same
  -- authoritative stock used by the legacy direct-order RPC, so both flows see
  -- active reservations and cannot oversell each other.
  for v_item in
    select * from jsonb_to_recordset(v_normalized_items) as normalized(product_id uuid, quantity integer)
     order by product_id
  loop
    select p.* into v_product
      from public.products p
     where p.id = v_item.product_id
       and p.business_id = v_business_id
     for update;
    if not found
      or not v_product.is_active
      or not v_product.is_verified
      or not v_product.available
      or v_product.price_status <> 'confirmed'
      or v_product.stock is null
      or v_product.price is null
      or v_product.price <= 0 then
      raise exception 'producto no disponible para pago: %', v_item.product_id using errcode = '55000';
    end if;
    if v_product.stock < v_item.quantity then
      raise exception 'stock insuficiente para producto: %', v_item.product_id using errcode = '23514';
    end if;
    if v_product.is_alcoholic then
      v_contains_alcohol := true;
      if v_product.minimum_age is null then
        raise exception 'producto alcoholico sin edad minima configurada' using errcode = '55000';
      end if;
    end if;

    insert into public.checkout_session_items (
      checkout_session_id, product_id, product_snapshot, quantity, unit_price, subtotal
    ) values (
      v_session.id,
      v_product.id,
      jsonb_strip_nulls(jsonb_build_object(
        'name', v_product.name,
        'presentation', v_product.presentation,
        'category', v_product.category,
        'image_url', v_product.image_url,
        'sku', v_product.sku
      )),
      v_item.quantity,
      v_product.price,
      v_product.price * v_item.quantity
    );
    insert into public.inventory_reservations (
      checkout_session_id, product_id, quantity, expires_at
    ) values (
      v_session.id, v_product.id, v_item.quantity, v_expires_at
    );
    update public.products p
       set stock = p.stock - v_item.quantity,
           available = case when p.stock - v_item.quantity > 0 then p.available else false end
     where p.id = v_product.id;
    v_subtotal := v_subtotal + (v_product.price * v_item.quantity);
  end loop;

  -- El precio de lista del combo se calcula con los precios BLOQUEADOS recien
  -- ahora: usar el precio leido antes del lock permitiria que una actualizacion
  -- concurrente moviera el ahorro anunciado respecto del cobrado.
  for v_combo in
    select * from jsonb_to_recordset(v_normalized_combos) as c(combo_id text, quantity integer)
     order by combo_id
  loop
    select * into v_combo_row
      from public.product_combos c
     where c.business_id = v_business_id
       and c.combo_id = v_combo.combo_id;

    select
        coalesce(sum(cc.quantity * i.unit_price), 0),
        count(*)::integer,
        coalesce(jsonb_agg(jsonb_build_object(
          'product_id', cc.product_id,
          'sku', i.product_snapshot ->> 'sku',
          'name', i.product_snapshot ->> 'name',
          'quantity', cc.quantity,
          'unit_price', i.unit_price,
          'line_price', cc.quantity * i.unit_price
        ) order by cc.sort_order, cc.product_id), '[]'::jsonb)
      into v_combo_list_price, v_combo_component_count, v_combo_components
      from public.product_combo_components cc
      join public.checkout_session_items i
        on i.checkout_session_id = v_session.id
       and i.product_id = cc.product_id
     where cc.combo_id = v_combo_row.id;

    select count(*)::integer into v_combo_declared_count
      from public.product_combo_components cc
     where cc.combo_id = v_combo_row.id;

    -- Si un componente no llego a reservarse, el combo no se cobra a medias.
    if v_combo_component_count <> v_combo_declared_count or v_combo_list_price <= 0 then
      raise exception 'combo incompleto al reservar: %', v_combo.combo_id using errcode = '55000';
    end if;

    v_combo_promotional := floor(
      (v_combo_list_price * (100 - v_combo_row.discount_percentage) / 100) / v_combo_row.price_rounding
    ) * v_combo_row.price_rounding;
    if v_combo_promotional <= 0 or v_combo_promotional > v_combo_list_price then
      raise exception 'precio promocional invalido para el combo: %', v_combo.combo_id using errcode = '55000';
    end if;

    insert into public.checkout_session_combos (
      checkout_session_id, combo_uuid, combo_id, name, quantity,
      discount_percentage, list_price, promotional_price, discount_amount, combo_snapshot
    ) values (
      v_session.id, v_combo_row.id, v_combo_row.combo_id, v_combo_row.name, v_combo.quantity,
      v_combo_row.discount_percentage, v_combo_list_price, v_combo_promotional,
      (v_combo_list_price - v_combo_promotional) * v_combo.quantity,
      jsonb_build_object(
        'combo_id', v_combo_row.combo_id,
        'name', v_combo_row.name,
        'tagline', v_combo_row.tagline,
        'terms', v_combo_row.terms,
        'discount_percentage', v_combo_row.discount_percentage,
        'price_rounding', v_combo_row.price_rounding,
        'approval_status', v_combo_row.approval_status,
        'approved_at', v_combo_row.approved_at,
        'components', v_combo_components
      )
    );

    v_discount_total := v_discount_total + (v_combo_list_price - v_combo_promotional) * v_combo.quantity;
  end loop;

  if v_discount_total > v_subtotal then
    raise exception 'el descuento de combos supera el subtotal' using errcode = '23514';
  end if;

  if v_contains_alcohol then
    if not v_business.alcohol_sales_enabled
      or v_business.alcohol_minimum_age is null
      or v_business.alcohol_sales_start is null
      or v_business.alcohol_sales_end is null
      or v_business.alcohol_timezone is null
      or not v_age_confirmed then
      raise exception 'politica o confirmacion de edad incompleta' using errcode = '55000';
    end if;
    if v_business.alcohol_sales_start <= v_business.alcohol_sales_end then
      if (clock_timestamp() at time zone v_business.alcohol_timezone)::time
         not between v_business.alcohol_sales_start and v_business.alcohol_sales_end then
        raise exception 'venta de alcohol fuera de horario' using errcode = '55000';
      end if;
    elsif (clock_timestamp() at time zone v_business.alcohol_timezone)::time
      between v_business.alcohol_sales_end and v_business.alcohol_sales_start then
      raise exception 'venta de alcohol fuera de horario' using errcode = '55000';
    end if;
  end if;

  if v_fulfillment_type = 'delivery' then
    v_delivery_fee := v_business.delivery_fee;
    if v_delivery_fee is null or v_business.minimum_delivery_subtotal is null
      or (v_subtotal - v_discount_total) < v_business.minimum_delivery_subtotal then
      raise exception 'configuracion o minimo de delivery no valido' using errcode = '23514';
    end if;
  end if;
  v_total := v_subtotal - v_discount_total + v_delivery_fee;

  update public.checkout_sessions
     set subtotal = v_subtotal,
         discount_total = v_discount_total,
         delivery_fee = v_delivery_fee,
         total = v_total,
         contains_alcohol = v_contains_alcohol,
         age_confirmed_at = case when v_contains_alcohol then clock_timestamp() else null end,
         age_confirmation_policy = case when v_contains_alcohol then v_business.alcohol_minimum_age else null end,
         status = 'ready_for_payment'
   where id = v_session.id
   returning * into v_session;

  insert into public.payment_intents (
    checkout_session_id, business_id, provider, environment, external_reference,
    internal_status, currency, expected_amount, live_mode
  ) values (
    v_session.id, v_business_id, 'mercadopago', v_settings.environment,
    'taba2:checkout:' || v_session.id::text,
    'created', 'ARS', v_total, v_settings.environment = 'production'
  ) returning id into v_payment_intent_id;

  insert into public.payment_events (
    payment_intent_id, event_type, details
  ) values (
    v_payment_intent_id,
    'checkout.session_created',
    jsonb_build_object('checkout_session_id', v_session.id, 'reservation_expires_at', v_expires_at)
  );

  return public.checkout_session_customer_payload(v_session.id, p_customer_id);
end;
$_$;


ALTER FUNCTION "public"."create_checkout_session"("p_customer_id" "uuid", "p_payload" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_checkout_session"("p_customer_id" "uuid", "p_payload" "jsonb") IS 'Checkout Pro: valida contacto, direccion y punto de entrega confirmado antes de reservar stock.';



CREATE OR REPLACE FUNCTION "public"."create_order_with_items"("payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
declare
  v_customer_id uuid := auth.uid();
  v_delivery_mode text;
  v_address_id uuid;
  v_address public.customer_addresses%rowtype;
  v_latitude numeric(9, 6);
  v_longitude numeric(9, 6);
  v_accuracy numeric(10, 2);
  v_location_source text;
  v_confirmed_at timestamptz;
  v_base_payload jsonb;
  v_result jsonb;
  v_order_id uuid;
begin
  if v_customer_id is null then
    raise exception 'autenticacion de cliente requerida' using errcode = '42501';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'payload invalido' using errcode = '22023';
  end if;

  v_delivery_mode := lower(coalesce(
    nullif(payload->>'delivery_mode', ''),
    nullif(payload->>'fulfillment_type', ''),
    'delivery'
  ));

  if v_delivery_mode = 'delivery' then
    if nullif(payload->>'customer_address_id', '') is not null then
      if (payload->>'customer_address_id') !~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        raise exception 'identificador de direccion invalido' using errcode = '22023';
      end if;
      v_address_id := (payload->>'customer_address_id')::uuid;
      select * into v_address
        from public.customer_addresses a
       where a.id = v_address_id
         and a.customer_id = v_customer_id
         and a.deleted_at is null;
      if not found then
        raise exception 'direccion guardada no encontrada' using errcode = '42501';
      end if;
      v_latitude := v_address.latitude;
      v_longitude := v_address.longitude;
      v_accuracy := v_address.geolocation_accuracy;
      v_location_source := v_address.location_source;
      v_confirmed_at := v_address.location_confirmed_at;
      -- Una dirección cuya huella dejó de describir su propio texto no sostiene
      -- un pedido: hay que volver a marcar el pin.
      if v_confirmed_at is not null
        and coalesce(v_address.location_confirmed_address, '') <> public.delivery_location_address_fingerprint(
          v_address.street, v_address.street_number, v_address.city, v_address.province, v_address.postal_code
        ) then
        v_confirmed_at := null;
      end if;
    else
      if nullif(payload->>'delivery_latitude', '') is not null
        and (payload->>'delivery_latitude') ~ '^-?[0-9]+(\.[0-9]+)?$'
        and nullif(payload->>'delivery_longitude', '') is not null
        and (payload->>'delivery_longitude') ~ '^-?[0-9]+(\.[0-9]+)?$' then
        v_latitude := (payload->>'delivery_latitude')::numeric(9, 6);
        v_longitude := (payload->>'delivery_longitude')::numeric(9, 6);
      end if;
      if nullif(payload->>'delivery_geolocation_accuracy', '') is not null
        and (payload->>'delivery_geolocation_accuracy') ~ '^[0-9]+(\.[0-9]+)?$' then
        v_accuracy := (payload->>'delivery_geolocation_accuracy')::numeric(10, 2);
      end if;
      v_location_source := lower(nullif(btrim(coalesce(payload->>'delivery_location_source', '')), ''));
      if nullif(payload->>'delivery_location_confirmed_at', '') is not null then
        begin
          v_confirmed_at := (payload->>'delivery_location_confirmed_at')::timestamptz;
        exception when others then
          raise exception 'momento de confirmacion invalido' using errcode = '22023';
        end;
      end if;
    end if;

    if v_location_source is not null
      and v_location_source not in ('gps', 'map_pin', 'geocoded_confirmed') then
      raise exception 'origen de ubicacion invalido' using errcode = '22023';
    end if;
    if v_confirmed_at is not null and v_confirmed_at > clock_timestamp() + interval '5 minutes' then
      raise exception 'momento de confirmacion en el futuro' using errcode = '22023';
    end if;
    if v_latitude is null or v_longitude is null
      or v_location_source is null or v_confirmed_at is null then
      raise exception 'DELIVERY_LOCATION_REQUIRED'
        using errcode = '22023',
              detail = 'la entrega necesita un punto confirmado por el cliente',
              hint = 'confirmar la ubicacion en el mapa antes de pedir';
    end if;
    if v_latitude not between -90 and 90 or v_longitude not between -180 and 180 then
      raise exception 'coordenadas fuera de rango' using errcode = '22023';
    end if;
  end if;

  -- Las claves del contrato nuevo no llegan a las capas anteriores: la más
  -- profunda rechaza cualquier clave que no conozca.
  v_base_payload := payload - array[
    'delivery_location_source',
    'delivery_location_confirmed_at'
  ];

  -- El punto viaja al INSERT por un ajuste local a la transacción, para que la
  -- instantánea inmutable que lee el Rider —tomada en el AFTER INSERT— no salga
  -- vacía. Ver `apply_pending_delivery_location`.
  if v_delivery_mode = 'delivery' then
    perform set_config('taba.pending_delivery_location', jsonb_build_object(
      'latitude', v_latitude,
      'longitude', v_longitude,
      'accuracy', v_accuracy,
      'location_source', v_location_source,
      'confirmed_at', v_confirmed_at,
      'address_source', case v_location_source
        when 'gps' then 'gps'
        when 'geocoded_confirmed' then 'geocoder'
        else 'manual'
      end
    )::text, true);
  end if;

  v_result := public.create_order_with_items_profile_v2(v_base_payload);
  -- Se apaga apenas deja de hacer falta: ningún otro alta de la misma
  -- transacción debe heredar este punto.
  perform set_config('taba.pending_delivery_location', '', true);
  v_order_id := nullif(v_result->>'id', '')::uuid;
  if v_order_id is null then
    raise exception 'el pedido no devolvio un identificador valido' using errcode = '22023';
  end if;

  -- Nunca reemplaza la instantánea de un reintento idempotente ni la de un
  -- pedido anterior: sólo completa la que todavía no fue sellada.
  if v_delivery_mode = 'delivery' then
    update public.orders
       set delivery_location_source = v_location_source,
           delivery_location_confirmed_at = v_confirmed_at,
           delivery_latitude = coalesce(delivery_latitude, v_latitude),
           delivery_longitude = coalesce(delivery_longitude, v_longitude)
     where id = v_order_id
       and delivery_location_confirmed_at is null;
  end if;

  select v_result || to_jsonb(o) into v_result
    from public.orders o
   where o.id = v_order_id;
  return v_result;
end;
$_$;


ALTER FUNCTION "public"."create_order_with_items"("payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_order_with_items_core"("payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
declare
  v_business_id uuid;
  v_business public.businesses%rowtype;
  v_customer_user_id uuid := auth.uid();
  v_client_request_id text;
  v_request_fingerprint text;
  v_tracking_token text;
  v_tracking_token_hash bytea;
  v_items jsonb;
  v_delivery_mode text;
  v_customer_name text;
  v_customer_phone text;
  v_street_address text;
  v_neighborhood text;
  v_reference text;
  v_customer_notes text;
  v_payment_method text;
  v_age_confirmed boolean := false;
  v_contains_alcohol boolean := false;
  v_address_label text;
  v_order_id uuid := gen_random_uuid();
  v_public_code text;
  v_subtotal numeric(12, 2) := 0;
  v_delivery_fee numeric(12, 2) := 0;
  v_total numeric(12, 2) := 0;
  v_intent_items jsonb := '[]'::jsonb;
  v_locked_items jsonb := '[]'::jsonb;
  v_item record;
  v_product public.products%rowtype;
  v_line_subtotal numeric(12, 2);
  v_existing_order public.orders%rowtype;
  v_existing_token_hash bytea;
  v_result jsonb;
  v_unexpected_key text;
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'payload invalido' using errcode = '22023';
  end if;
  if v_customer_user_id is null then
    raise exception 'autenticacion de cliente requerida' using errcode = '42501';
  end if;

  select key
    into v_unexpected_key
    from jsonb_object_keys(payload) as keys(key)
   where key not in (
     'business_id',
     'client_request_id',
     'tracking_token',
     'items',
     'customer_name',
     'customer_phone',
     'delivery_mode',
     'fulfillment_type',
     'customer_street_address',
     'address_label',
     'customer_neighborhood',
     'customer_reference',
     'customer_notes',
     'notes',
     'payment_method'
     ,'age_confirmed'
   )
   limit 1;

  if v_unexpected_key is not null then
    raise exception 'campo no permitido en pedido: %', v_unexpected_key
      using errcode = '22023';
  end if;

  v_business_id := nullif(payload->>'business_id', '')::uuid;
  v_client_request_id := btrim(coalesce(payload->>'client_request_id', ''));
  v_tracking_token := btrim(coalesce(payload->>'tracking_token', ''));
  v_items := coalesce(payload->'items', '[]'::jsonb);
  v_delivery_mode := lower(coalesce(
    nullif(payload->>'delivery_mode', ''),
    nullif(payload->>'fulfillment_type', ''),
    'delivery'
  ));
  v_customer_name := nullif(btrim(coalesce(payload->>'customer_name', '')), '');
  v_customer_phone := nullif(btrim(coalesce(payload->>'customer_phone', '')), '');
  v_street_address := nullif(btrim(coalesce(
    payload->>'customer_street_address',
    payload->>'address_label',
    ''
  )), '');
  v_neighborhood := nullif(btrim(coalesce(payload->>'customer_neighborhood', '')), '');
  v_reference := nullif(btrim(coalesce(payload->>'customer_reference', '')), '');
  v_customer_notes := nullif(btrim(coalesce(
    payload->>'customer_notes',
    payload->>'notes',
    ''
  )), '');
  v_payment_method := nullif(btrim(coalesce(payload->>'payment_method', '')), '');
  v_age_confirmed := coalesce((payload->>'age_confirmed')::boolean, false);

  if v_business_id is null then
    raise exception 'business_id requerido' using errcode = '22023';
  end if;
  if v_client_request_id !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception 'client_request_id invalido' using errcode = '22023';
  end if;
  if v_tracking_token !~ '^[A-Za-z0-9_-]{32,255}[A-Za-z0-9_-]?$' then
    raise exception 'tracking_token invalido' using errcode = '22023';
  end if;
  if jsonb_typeof(v_items) <> 'array'
    or jsonb_array_length(v_items) < 1
    or jsonb_array_length(v_items) > 100 then
    raise exception 'items debe contener entre 1 y 100 productos'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(v_items) as item(value)
     where jsonb_typeof(item.value) <> 'object'
        or not (item.value ? 'product_id')
        or not (item.value ? 'quantity')
        or (item.value->>'quantity') !~ '^[1-9][0-9]*$'
        or (item.value->>'quantity')::numeric > 1000
        or exists (
          select 1
            from jsonb_object_keys(item.value) as item_keys(key)
           where item_keys.key not in ('product_id', 'quantity')
        )
  ) then
    raise exception 'cada item acepta solo product_id UUID y quantity entero'
      using errcode = '22023';
  end if;

  if v_delivery_mode not in ('delivery', 'pickup') then
    raise exception 'delivery_mode invalido' using errcode = '22023';
  end if;
  if v_customer_name is null or char_length(v_customer_name) > 120 then
    raise exception 'customer_name requerido o demasiado largo'
      using errcode = '22023';
  end if;
  if v_customer_phone is null
    or char_length(v_customer_phone) < 6
    or char_length(v_customer_phone) > 40 then
    raise exception 'customer_phone invalido' using errcode = '22023';
  end if;
  if v_delivery_mode = 'delivery' and v_street_address is null then
    raise exception 'customer_street_address requerido para delivery'
      using errcode = '22023';
  end if;
  if coalesce(char_length(v_street_address), 0) > 180
    or coalesce(char_length(v_neighborhood), 0) > 100
    or coalesce(char_length(v_reference), 0) > 180
    or coalesce(char_length(v_customer_notes), 0) > 500
    or coalesce(char_length(v_payment_method), 0) > 40 then
    raise exception 'datos del cliente demasiado largos' using errcode = '22023';
  end if;

  v_tracking_token_hash := digest(v_tracking_token, 'sha256');

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'product_id', normalized.product_id,
               'quantity', normalized.quantity
             )
             order by normalized.product_id
           ),
           '[]'::jsonb
         )
    into v_intent_items
    from (
      select
        (item.value->>'product_id')::uuid as product_id,
        sum((item.value->>'quantity')::integer)::integer as quantity
      from jsonb_array_elements(v_items) as item(value)
      group by (item.value->>'product_id')::uuid
    ) as normalized;

  -- Fingerprint the normalized intent, not raw JSON or current product prices.
  -- Equivalent retries remain equivalent even if item order or accepted legacy
  -- aliases differ.
  v_request_fingerprint := encode(
    digest(
      jsonb_build_object(
        'business_id', v_business_id,
        'items', v_intent_items,
        'customer_name', v_customer_name,
        'customer_phone', v_customer_phone,
        'delivery_mode', v_delivery_mode,
        'customer_street_address', v_street_address,
        'customer_neighborhood', v_neighborhood,
        'customer_reference', v_reference,
        'customer_notes', v_customer_notes,
        'payment_method', v_payment_method
        ,'age_confirmed', v_age_confirmed
      )::text,
      'sha256'
    ),
    'hex'
  );

  -- Serializes retries for the same business/idempotency key. Hash collisions
  -- only reduce concurrency; they cannot merge orders because the unique key
  -- and exact lookup remain authoritative.
  perform pg_advisory_xact_lock(
    hashtext(v_business_id::text),
    hashtext(v_client_request_id)
  );

  select o.*
    into v_existing_order
    from public.orders o
   where o.business_id = v_business_id
     and o.client_request_id = v_client_request_id
   for update;

  if found then
    select opt.token_hash
      into v_existing_token_hash
      from public.order_public_tokens opt
     where opt.order_id = v_existing_order.id
       and opt.revoked_at is null
     order by opt.created_at desc
     limit 1;

    if v_existing_token_hash is distinct from v_tracking_token_hash
      or v_existing_order.customer_user_id is distinct from v_customer_user_id then
      raise exception 'client_request_id ya pertenece a otro pedido'
        using errcode = '23505';
    end if;

    if v_existing_order.client_request_fingerprint is not null
      and v_existing_order.client_request_fingerprint <> v_request_fingerprint then
      raise exception 'client_request_id reutilizado con un payload diferente'
        using errcode = '23505';
    end if;

    select to_jsonb(o)
           || jsonb_build_object(
                'order_items',
                coalesce(
                  (
                    select jsonb_agg(to_jsonb(oi) order by oi.created_at, oi.id)
                      from public.order_items oi
                     where oi.order_id = o.id
                  ),
                  '[]'::jsonb
                ),
                'rider_locations', '[]'::jsonb,
                'tracking_token', v_tracking_token
              )
      into v_result
      from public.orders o
     where o.id = v_existing_order.id;

    return v_result;
  end if;

  select b.*
    into v_business
    from public.businesses b
   where b.id = v_business_id
   for share;

  if not found then
    raise exception 'business_id inexistente' using errcode = '23503';
  end if;
  if not v_business.is_active
    or v_business.status <> 'open'
    or not v_business.ordering_verified
    or not v_business.ordering_enabled then
    raise exception 'el negocio no esta habilitado para recibir pedidos'
      using errcode = '55000';
  end if;
  if v_business.currency_code is null then
    raise exception 'moneda del negocio no verificada' using errcode = '55000';
  end if;
  if v_delivery_mode = 'delivery' and not v_business.delivery_enabled then
    raise exception 'delivery no habilitado' using errcode = '55000';
  end if;
  if v_delivery_mode = 'pickup' and not v_business.pickup_enabled then
    raise exception 'retiro no habilitado' using errcode = '55000';
  end if;

  -- Lock products in deterministic UUID order to avoid deadlocks. Duplicate
  -- product lines are aggregated before checking and decrementing stock.
  for v_item in
    select
      (item.value->>'product_id')::uuid as product_id,
      sum((item.value->>'quantity')::integer)::integer as quantity
    from jsonb_array_elements(v_items) as item(value)
    group by (item.value->>'product_id')::uuid
    order by (item.value->>'product_id')::uuid
  loop
    if v_item.quantity > 1000 then
      raise exception 'quantity total demasiado alta para producto: %', v_item.product_id
        using errcode = '22023';
    end if;

    select p.*
      into v_product
      from public.products p
     where p.id = v_item.product_id
       and p.business_id = v_business_id
     for update;

    if not found then
      raise exception 'producto inexistente para el negocio: %', v_item.product_id
        using errcode = '23503';
    end if;
    if not v_product.is_active
      or not v_product.is_verified
      or not v_product.available
      or v_product.stock is null then
      raise exception 'producto no disponible: %', v_item.product_id
        using errcode = '55000';
    end if;
    if v_product.price <= 0 then
      raise exception 'precio no verificado para producto: %', v_item.product_id
        using errcode = '55000';
    end if;
    if v_product.stock < v_item.quantity then
      raise exception 'stock insuficiente para producto: %', v_item.product_id
        using errcode = '23514';
    end if;
    if v_product.is_alcoholic is true then
      v_contains_alcohol := true;
      if v_product.minimum_age is null then
        raise exception 'producto alcoholico sin edad minima configurada'
          using errcode = '55000';
      end if;
    end if;

    v_line_subtotal := v_product.price * v_item.quantity;
    v_subtotal := v_subtotal + v_line_subtotal;
    v_locked_items := v_locked_items || jsonb_build_array(
      jsonb_build_object(
        'product_id', v_product.id,
        'name', v_product.name,
        'quantity', v_item.quantity,
        'unit', v_product.presentation,
        'unit_price', v_product.price,
        'subtotal', v_line_subtotal
      )
    );
  end loop;

  if v_contains_alcohol then
    if not v_business.alcohol_sales_enabled
      or v_business.alcohol_minimum_age is null
      or v_business.alcohol_sales_start is null
      or v_business.alcohol_sales_end is null
      or v_business.alcohol_timezone is null then
      raise exception 'politica de alcohol no configurada' using errcode = '55000';
    end if;
    if not v_age_confirmed then
      raise exception 'confirmacion de mayoria de edad requerida' using errcode = '22023';
    end if;
    if v_business.alcohol_sales_start <= v_business.alcohol_sales_end then
      if (clock_timestamp() at time zone v_business.alcohol_timezone)::time
         not between v_business.alcohol_sales_start and v_business.alcohol_sales_end then
        raise exception 'venta de alcohol fuera de horario' using errcode = '55000';
      end if;
    elsif (
      (clock_timestamp() at time zone v_business.alcohol_timezone)::time
      between v_business.alcohol_sales_end and v_business.alcohol_sales_start
    ) then
      raise exception 'venta de alcohol fuera de horario' using errcode = '55000';
    end if;
  end if;

  if v_delivery_mode = 'delivery' then
    v_delivery_fee := v_business.delivery_fee;
    if v_delivery_fee is null
      or v_business.minimum_delivery_subtotal is null then
      raise exception 'configuracion de delivery no verificada'
        using errcode = '55000';
    end if;
    if v_subtotal < v_business.minimum_delivery_subtotal then
      raise exception 'subtotal inferior al minimo de delivery'
        using errcode = '23514';
    end if;
  else
    v_delivery_fee := 0;
  end if;

  v_total := v_subtotal + v_delivery_fee;
  v_address_label := v_street_address;
  if v_address_label is not null and v_neighborhood is not null then
    v_address_label := v_address_label || ', ' || v_neighborhood;
  end if;

  loop
    v_public_code := public.next_order_public_code();
    exit when not exists (
      select 1
        from public.orders o
       where o.code = v_public_code
          or (
            o.business_id = v_business_id
            and o.public_code = v_public_code
          )
    );
  end loop;

  insert into public.orders (
    id,
    business_id,
    code,
    public_code,
    status,
    fulfillment_type,
    delivery_mode,
    customer_user_id,
    client_request_id,
    client_request_fingerprint,
    currency_code,
    customer_name,
    customer_phone,
    customer_whatsapp,
    address_label,
    customer_street_address,
    customer_neighborhood,
    customer_reference,
    notes,
    customer_notes,
    payment_method,
    age_confirmed_at,
    age_confirmation_policy,
    subtotal,
    delivery_fee,
    total
  ) values (
    v_order_id,
    v_business_id,
    v_public_code,
    v_public_code,
    'received',
    v_delivery_mode,
    v_delivery_mode,
    v_customer_user_id,
    v_client_request_id,
    v_request_fingerprint,
    v_business.currency_code,
    v_customer_name,
    v_customer_phone,
    v_customer_phone,
    v_address_label,
    v_street_address,
    v_neighborhood,
    v_reference,
    v_customer_notes,
    v_customer_notes,
    v_payment_method,
    case when v_contains_alcohol then clock_timestamp() else null end,
    case when v_contains_alcohol then v_business.alcohol_minimum_age else null end,
    v_subtotal,
    v_delivery_fee,
    v_total
  );

  for v_item in
    select *
      from jsonb_to_recordset(v_locked_items) as locked_item(
        product_id uuid,
        name text,
        quantity integer,
        unit text,
        unit_price numeric,
        subtotal numeric
      )
  loop
    insert into public.order_items (
      order_id,
      product_id,
      product_uuid,
      name,
      quantity,
      unit,
      unit_price,
      subtotal
    ) values (
      v_order_id,
      v_item.product_id::text,
      v_item.product_id,
      v_item.name,
      v_item.quantity,
      v_item.unit,
      v_item.unit_price,
      v_item.subtotal
    );

    update public.products
       set stock = stock - v_item.quantity,
           available = (stock - v_item.quantity) > 0
     where id = v_item.product_id;
  end loop;

  insert into public.order_events (
    order_id,
    business_id,
    actor_user_id,
    actor_role,
    actor_type,
    event_type,
    type,
    message,
    metadata,
    payload
  ) values (
    v_order_id,
    v_business_id,
    v_customer_user_id,
    'customer',
    'customer',
    'order.received',
    'order.received',
    'Pedido recibido',
    jsonb_build_object('source', 'production_checkout'),
    jsonb_build_object('source', 'production_checkout')
  );

  insert into public.order_public_tokens (
    order_id,
    token,
    token_hash,
    expires_at
  ) values (
    v_order_id,
    null,
    v_tracking_token_hash,
    now() + interval '30 days'
  );

  select to_jsonb(o)
         || jsonb_build_object(
              'order_items',
              coalesce(
                (
                  select jsonb_agg(to_jsonb(oi) order by oi.created_at, oi.id)
                    from public.order_items oi
                   where oi.order_id = o.id
                ),
                '[]'::jsonb
              ),
              'rider_locations', '[]'::jsonb,
              'tracking_token', v_tracking_token
            )
    into v_result
    from public.orders o
   where o.id = v_order_id;

  return v_result;
end;
$_$;


ALTER FUNCTION "public"."create_order_with_items_core"("payload" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_order_with_items_core"("payload" "jsonb") IS 'Production RPC: idempotent order creation from product UUID/quantity; prices, totals and stock are authoritative in PostgreSQL.';



CREATE OR REPLACE FUNCTION "public"."create_order_with_items_legacy"("payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_result jsonb;
  v_handoff jsonb;
  v_order_id uuid;
  v_tracking_token text := nullif(payload ->> 'tracking_token', '');
  v_delivery_mode text;
  v_code_expires_at timestamptz;
begin
  v_result := public.create_order_with_items_core(payload);
  v_order_id := nullif(v_result ->> 'id', '')::uuid;
  v_delivery_mode := coalesce(
    nullif(v_result ->> 'delivery_mode', ''),
    nullif(payload ->> 'delivery_mode', '')
  );

  if v_delivery_mode = 'delivery' then
    v_handoff := public.issue_order_delivery_code(v_order_id, v_tracking_token);
    update public.order_delivery_handoffs
       set expires_at = least(
         expires_at,
         clock_timestamp() + interval '48 hours'
       )
     where order_id = v_order_id
     returning expires_at into v_code_expires_at;
    v_result := v_result || jsonb_build_object(
      'delivery_code', v_handoff ->> 'delivery_code',
      'delivery_code_expires_at', v_code_expires_at
    );
  end if;

  return v_result;
end;
$$;


ALTER FUNCTION "public"."create_order_with_items_legacy"("payload" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_order_with_items_legacy"("payload" "jsonb") IS 'Atomic production order reservation plus delivery handoff issuance.';



CREATE OR REPLACE FUNCTION "public"."create_order_with_items_profile_v1"("payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
declare
  v_customer_id uuid := auth.uid();
  v_address_id uuid;
  v_address public.customer_addresses%rowtype;
  v_base_payload jsonb;
  v_result jsonb;
  v_order_id uuid;
  v_street text;
  v_city text;
  v_reference text;
  v_formatted text;
  v_latitude numeric(9, 6);
  v_longitude numeric(9, 6);
  v_accuracy numeric(10, 2);
  v_source text := 'manual';
begin
  if v_customer_id is null then
    raise exception 'autenticacion de cliente requerida' using errcode = '42501';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'payload invalido' using errcode = '22023';
  end if;

  if nullif(payload->>'customer_address_id', '') is not null then
    if (payload->>'customer_address_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'identificador de direccion invalido' using errcode = '22023';
    end if;
    v_address_id := (payload->>'customer_address_id')::uuid;
    select * into v_address
      from public.customer_addresses a
     where a.id = v_address_id
       and a.customer_id = v_customer_id
       and a.deleted_at is null;
    if not found then
      raise exception 'direccion guardada no encontrada' using errcode = '42501';
    end if;
    v_street := concat_ws(' ', v_address.street, v_address.street_number);
    v_city := v_address.city;
    v_reference := v_address.reference;
    v_formatted := v_address.formatted_address;
    v_latitude := v_address.latitude;
    v_longitude := v_address.longitude;
    v_accuracy := v_address.geolocation_accuracy;
    v_source := v_address.source;
  else
    v_street := nullif(btrim(coalesce(payload->>'customer_street_address', payload->>'address_label', '')), '');
    v_city := nullif(btrim(coalesce(payload->>'customer_neighborhood', '')), '');
    v_reference := nullif(btrim(coalesce(payload->>'customer_reference', '')), '');
    v_formatted := nullif(btrim(coalesce(payload->>'address_label', concat_ws(', ', v_street, v_city))), '');
    v_source := lower(coalesce(nullif(payload->>'delivery_address_source', ''), 'manual'));
    if v_source not in ('manual', 'gps', 'geocoder', 'previous_order') then
      raise exception 'origen de direccion invalido' using errcode = '22023';
    end if;
    if nullif(payload->>'delivery_latitude', '') is not null or nullif(payload->>'delivery_longitude', '') is not null then
      if (payload->>'delivery_latitude') !~ '^-?[0-9]+(\.[0-9]+)?$'
        or (payload->>'delivery_longitude') !~ '^-?[0-9]+(\.[0-9]+)?$' then
        raise exception 'coordenadas invalidas' using errcode = '22023';
      end if;
      v_latitude := (payload->>'delivery_latitude')::numeric(9, 6);
      v_longitude := (payload->>'delivery_longitude')::numeric(9, 6);
      if v_latitude not between -90 and 90 or v_longitude not between -180 and 180 then
        raise exception 'coordenadas fuera de rango' using errcode = '22023';
      end if;
    end if;
    if nullif(payload->>'delivery_geolocation_accuracy', '') is not null then
      if (payload->>'delivery_geolocation_accuracy') !~ '^[0-9]+(\.[0-9]+)?$' then
        raise exception 'precision GPS invalida' using errcode = '22023';
      end if;
      v_accuracy := (payload->>'delivery_geolocation_accuracy')::numeric(10, 2);
    end if;
    if (v_latitude is null) <> (v_longitude is null) then
      raise exception 'las coordenadas deben incluir latitud y longitud' using errcode = '22023';
    end if;
    if v_source in ('gps', 'geocoder') and v_latitude is null then
      raise exception 'la ubicacion debe confirmarse antes de usarla' using errcode = '22023';
    end if;
  end if;

  v_base_payload := (payload - array[
    'customer_address_id', 'delivery_latitude', 'delivery_longitude',
    'delivery_geolocation_accuracy', 'delivery_address_source'
  ]) || jsonb_build_object(
    'customer_street_address', v_street,
    'customer_neighborhood', v_city,
    'customer_reference', v_reference,
    'address_label', v_formatted
  );

  v_result := public.create_order_with_items_legacy(v_base_payload);
  v_order_id := nullif(v_result->>'id', '')::uuid;
  if v_order_id is null then
    raise exception 'el pedido no devolvio un identificador valido' using errcode = '22023';
  end if;

  -- Never replace a snapshot returned by an idempotent retry or an old order.
  update public.orders
     set customer_address_id = v_address_id,
         delivery_address_formatted = v_formatted,
         delivery_street = case when v_address_id is not null then v_address.street else v_street end,
         delivery_street_number = case when v_address_id is not null then v_address.street_number else null end,
         delivery_floor = case when v_address_id is not null then v_address.floor else null end,
         delivery_apartment = case when v_address_id is not null then v_address.apartment else null end,
         delivery_reference = case when v_address_id is not null then v_address.reference else v_reference end,
         delivery_city = case when v_address_id is not null then v_address.city else v_city end,
         delivery_province = case when v_address_id is not null then v_address.province else null end,
         delivery_postal_code = case when v_address_id is not null then v_address.postal_code else null end,
         delivery_latitude = v_latitude,
         delivery_longitude = v_longitude,
         delivery_geolocation_accuracy = v_accuracy,
         delivery_address_source = v_source
   where id = v_order_id
     and delivery_address_formatted is null;

  if found and v_address_id is not null then
    update public.customer_addresses set last_used_at = now() where id = v_address_id;
  end if;
  update public.customers set last_order_at = now() where id = v_customer_id;

  select v_result || to_jsonb(o) into v_result
    from public.orders o
   where o.id = v_order_id;
  return v_result;
end;
$_$;


ALTER FUNCTION "public"."create_order_with_items_profile_v1"("payload" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_order_with_items_profile_v1"("payload" "jsonb") IS 'Authoritative order creation with an owned saved-address resolver and immutable delivery-address snapshot.';



CREATE OR REPLACE FUNCTION "public"."create_order_with_items_profile_v2"("payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
declare
  v_customer_id uuid := auth.uid();
  v_address_id uuid;
  v_address public.customer_addresses%rowtype;
  v_base_payload jsonb;
  v_result jsonb;
  v_order_id uuid;
  v_name text;
  v_phone text;
  v_label text;
  v_street text;
  v_street_number text;
  v_floor text;
  v_apartment text;
  v_city text;
  v_province text;
  v_postal_code text;
begin
  if v_customer_id is null then
    raise exception 'autenticacion de cliente requerida' using errcode = '42501';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'payload invalido' using errcode = '22023';
  end if;

  v_name := nullif(
    regexp_replace(btrim(coalesce(payload->>'customer_name', '')), '[[:space:]]+', ' ', 'g'),
    ''
  );
  v_phone := regexp_replace(coalesce(payload->>'customer_phone', ''), '[^0-9]', '', 'g');
  if v_name is null
    or char_length(v_name) < 2
    or char_length(v_name) > 80
    or v_name !~ '[[:alpha:]]' then
    raise exception 'customer_name invalido' using errcode = '22023';
  end if;
  if v_phone !~ '^[0-9]{10,13}$' or v_phone ~ '^([0-9])\1+$' then
    raise exception 'customer_phone invalido' using errcode = '22023';
  end if;

  if nullif(payload->>'customer_address_id', '') is not null then
    if (payload->>'customer_address_id') !~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'identificador de direccion invalido' using errcode = '22023';
    end if;
    v_address_id := (payload->>'customer_address_id')::uuid;
    select * into v_address
      from public.customer_addresses a
     where a.id = v_address_id
       and a.customer_id = v_customer_id
       and a.deleted_at is null;
    if not found then
      raise exception 'direccion guardada no encontrada' using errcode = '42501';
    end if;
    v_label := v_address.label;
    v_street := v_address.street;
    v_street_number := v_address.street_number;
    v_floor := v_address.floor;
    v_apartment := v_address.apartment;
    v_city := v_address.city;
    v_province := v_address.province;
    v_postal_code := v_address.postal_code;
  else
    v_label := nullif(btrim(coalesce(payload->>'customer_address_label', '')), '');
    v_street := nullif(btrim(coalesce(
      payload->>'delivery_street',
      payload->>'customer_street_address',
      ''
    )), '');
    v_street_number := nullif(btrim(coalesce(payload->>'delivery_street_number', '')), '');
    v_floor := nullif(btrim(coalesce(payload->>'delivery_floor', '')), '');
    v_apartment := nullif(btrim(coalesce(payload->>'delivery_apartment', '')), '');
    v_city := nullif(btrim(coalesce(
      payload->>'delivery_city',
      payload->>'customer_neighborhood',
      ''
    )), '');
    v_province := nullif(btrim(coalesce(payload->>'delivery_province', '')), '');
    v_postal_code := nullif(btrim(coalesce(payload->>'delivery_postal_code', '')), '');
  end if;

  if char_length(coalesce(v_label, '')) > 60
    or char_length(coalesce(v_street, '')) > 120
    or char_length(coalesce(v_street_number, '')) > 24
    or char_length(coalesce(v_floor, '')) > 24
    or char_length(coalesce(v_apartment, '')) > 24
    or char_length(coalesce(v_city, '')) > 100
    or char_length(coalesce(v_province, '')) > 100
    or char_length(coalesce(v_postal_code, '')) > 20 then
    raise exception 'componentes de direccion demasiado largos' using errcode = '22023';
  end if;

  v_base_payload := (
    payload - array[
      'customer_address_label',
      'delivery_street',
      'delivery_street_number',
      'delivery_floor',
      'delivery_apartment',
      'delivery_city',
      'delivery_province',
      'delivery_postal_code'
    ]
  ) || jsonb_build_object(
    'customer_name', v_name,
    'customer_phone', v_phone
  );

  v_result := public.create_order_with_items_profile_v1(v_base_payload);
  v_order_id := nullif(v_result->>'id', '')::uuid;
  if v_order_id is null then
    raise exception 'el pedido no devolvio un identificador valido' using errcode = '22023';
  end if;

  -- This predicate is the idempotency boundary. A retried request returns the
  -- original immutable snapshot instead of replacing it with current profile
  -- or address values.
  update public.orders
     set delivery_address_label = case
           when delivery_mode = 'delivery' then coalesce(v_label, 'Entrega')
           else null
         end,
         delivery_street = case
           when delivery_mode = 'delivery' then coalesce(v_street, delivery_street)
           else delivery_street
         end,
         delivery_street_number = case
           when delivery_mode = 'delivery' then coalesce(v_street_number, delivery_street_number)
           else delivery_street_number
         end,
         delivery_floor = case
           when delivery_mode = 'delivery' then coalesce(v_floor, delivery_floor)
           else delivery_floor
         end,
         delivery_apartment = case
           when delivery_mode = 'delivery' then coalesce(v_apartment, delivery_apartment)
           else delivery_apartment
         end,
         delivery_city = case
           when delivery_mode = 'delivery' then coalesce(v_city, delivery_city)
           else delivery_city
         end,
         delivery_province = case
           when delivery_mode = 'delivery' then coalesce(v_province, delivery_province)
           else delivery_province
         end,
         delivery_postal_code = case
           when delivery_mode = 'delivery' then coalesce(v_postal_code, delivery_postal_code)
           else delivery_postal_code
         end,
         delivery_snapshot_created_at = clock_timestamp()
   where id = v_order_id
     and delivery_snapshot_created_at is null;

  select v_result || to_jsonb(o) into v_result
    from public.orders o
   where o.id = v_order_id;
  return v_result;
end;
$_$;


ALTER FUNCTION "public"."create_order_with_items_profile_v2"("payload" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_order_with_items_profile_v2"("payload" "jsonb") IS 'Authoritative order creation with normalized recipient data and an immutable, owned delivery snapshot.';



CREATE TABLE IF NOT EXISTS "public"."customer_addresses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "formatted_address" "text" NOT NULL,
    "street" "text" NOT NULL,
    "street_number" "text",
    "floor" "text",
    "apartment" "text",
    "reference" "text",
    "city" "text" NOT NULL,
    "province" "text",
    "postal_code" "text",
    "latitude" numeric(9,6),
    "longitude" numeric(9,6),
    "geolocation_accuracy" numeric(10,2),
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "normalized_address" "text" NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "last_used_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "location_source" "text",
    "location_confirmed_at" timestamp with time zone,
    "location_confirmed_address" "text",
    CONSTRAINT "customer_addresses_accuracy_nonnegative" CHECK ((("geolocation_accuracy" IS NULL) OR ("geolocation_accuracy" >= (0)::numeric))),
    CONSTRAINT "customer_addresses_city_length" CHECK ((("char_length"("btrim"("city")) >= 1) AND ("char_length"("btrim"("city")) <= 100))),
    CONSTRAINT "customer_addresses_coordinates_pair" CHECK (((("latitude" IS NULL) AND ("longitude" IS NULL)) OR ((("latitude" >= ('-90'::integer)::numeric) AND ("latitude" <= (90)::numeric)) AND (("longitude" >= ('-180'::integer)::numeric) AND ("longitude" <= (180)::numeric))))),
    CONSTRAINT "customer_addresses_formatted_length" CHECK ((("char_length"("btrim"("formatted_address")) >= 1) AND ("char_length"("btrim"("formatted_address")) <= 180))),
    CONSTRAINT "customer_addresses_label_length" CHECK ((("char_length"("btrim"("label")) >= 1) AND ("char_length"("btrim"("label")) <= 60))),
    CONSTRAINT "customer_addresses_location_confirmation_complete" CHECK (((("location_confirmed_at" IS NULL) AND ("location_source" IS NULL) AND ("location_confirmed_address" IS NULL)) OR (("location_confirmed_at" IS NOT NULL) AND ("location_source" IS NOT NULL) AND ("location_confirmed_address" IS NOT NULL) AND ("latitude" IS NOT NULL) AND ("longitude" IS NOT NULL)))),
    CONSTRAINT "customer_addresses_location_source_check" CHECK ((("location_source" IS NULL) OR ("location_source" = ANY (ARRAY['gps'::"text", 'map_pin'::"text", 'geocoded_confirmed'::"text"])))),
    CONSTRAINT "customer_addresses_source_check" CHECK (("source" = ANY (ARRAY['manual'::"text", 'gps'::"text", 'geocoder'::"text", 'previous_order'::"text"]))),
    CONSTRAINT "customer_addresses_street_length" CHECK ((("char_length"("btrim"("street")) >= 1) AND ("char_length"("btrim"("street")) <= 120)))
);


ALTER TABLE "public"."customer_addresses" OWNER TO "postgres";


COMMENT ON TABLE "public"."customer_addresses" IS 'Customer-owned reusable delivery addresses. Soft-deleted rows remain detached from immutable order snapshots.';



COMMENT ON COLUMN "public"."customer_addresses"."location_source" IS 'Como se obtuvo el punto: gps, map_pin o geocoded_confirmed. NULL significa direccion sin confirmar.';



COMMENT ON COLUMN "public"."customer_addresses"."location_confirmed_at" IS 'Instante en que la persona confirmo el pin para esta direccion.';



COMMENT ON COLUMN "public"."customer_addresses"."location_confirmed_address" IS 'Huella del texto de direccion vigente al confirmar. Si el texto cambia, la confirmacion vence.';



CREATE OR REPLACE FUNCTION "public"."customer_address_json"("p_address" "public"."customer_addresses") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
  select jsonb_build_object(
    'id', p_address.id,
    'label', p_address.label,
    'formattedAddress', p_address.formatted_address,
    'street', p_address.street,
    'streetNumber', p_address.street_number,
    'floor', p_address.floor,
    'apartment', p_address.apartment,
    'reference', p_address.reference,
    'city', p_address.city,
    'province', p_address.province,
    'postalCode', p_address.postal_code,
    'latitude', p_address.latitude,
    'longitude', p_address.longitude,
    'geolocationAccuracy', p_address.geolocation_accuracy,
    'source', p_address.source,
    'locationSource', p_address.location_source,
    'locationConfirmedAt', p_address.location_confirmed_at,
    'locationConfirmedAddress', p_address.location_confirmed_address,
    'isDefault', p_address.is_default,
    'lastUsedAt', p_address.last_used_at,
    'createdAt', p_address.created_at,
    'updatedAt', p_address.updated_at
  )
$$;


ALTER FUNCTION "public"."customer_address_json"("p_address" "public"."customer_addresses") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."daily_reconciliation_snapshot_internal"("p_business_id" "uuid", "p_window_start" timestamp with time zone, "p_window_end" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select jsonb_build_object(
    'orders', jsonb_build_object(
      'created', (select count(*) from public.orders o where o.business_id = p_business_id and o.created_at >= p_window_start and o.created_at < p_window_end),
      'cancelled', (select count(*) from public.orders o where o.business_id = p_business_id and coalesce(o.cancelled_at,o.canceled_at) >= p_window_start and coalesce(o.cancelled_at,o.canceled_at) < p_window_end),
      'delivered', (select count(*) from public.orders o where o.business_id = p_business_id and o.delivered_at >= p_window_start and o.delivered_at < p_window_end),
      'returned', (select count(distinct fd.source_id) from public.fiscal_documents fd where fd.business_id = p_business_id and fd.document_intent = 'credit_note' and fd.state = 'authorized' and fd.authorized_at >= p_window_start and fd.authorized_at < p_window_end and fd.source_type = 'online_order')
    ),
    'payments', jsonb_build_object(
      'approved_count', (select count(*) from public.payment_intents pi where pi.business_id = p_business_id and pi.approved_at >= p_window_start and pi.approved_at < p_window_end),
      'approved_amount', (select coalesce(sum(pi.paid_amount),0) from public.payment_intents pi where pi.business_id = p_business_id and pi.approved_at >= p_window_start and pi.approved_at < p_window_end),
      'pending', (select count(*) from public.payment_intents pi where pi.business_id = p_business_id and pi.created_at < p_window_end and pi.internal_status in ('created','preference_creating','preference_created','redirected','pending','in_process','approved_order_pending')),
      'rejected', (select count(*) from public.payment_intents pi where pi.business_id = p_business_id and pi.rejected_at >= p_window_start and pi.rejected_at < p_window_end),
      'refunded_amount', (select coalesce(sum(pr.amount),0) from public.payment_refunds pr join public.payment_intents pi on pi.id = pr.payment_intent_id where pi.business_id = p_business_id and pr.status = 'approved' and pr.completed_at >= p_window_start and pr.completed_at < p_window_end),
      'chargebacks', (select count(*) from public.payment_disputes pd join public.payment_intents pi on pi.id = pd.payment_intent_id where pi.business_id = p_business_id and pd.dispute_type = 'chargeback' and pd.created_at >= p_window_start and pd.created_at < p_window_end)
    ),
    'cash', jsonb_build_object(
      'expected', (select coalesce(sum(pp.amount),0) from public.pos_payments pp join public.pos_sales ps on ps.id = pp.sale_id where ps.business_id = p_business_id and pp.payment_method = 'cash' and pp.status = 'confirmed' and pp.created_at >= p_window_start and pp.created_at < p_window_end)
    ),
    'inventory', jsonb_build_object(
      'sales_units', (select coalesce(abs(sum(im.quantity_delta)),0) from public.inventory_movements im where im.business_id = p_business_id and im.movement_type = 'sale' and im.created_at >= p_window_start and im.created_at < p_window_end),
      'received_units', (select coalesce(sum(im.quantity_delta),0) from public.inventory_movements im where im.business_id = p_business_id and im.movement_type in ('purchase_receipt','initial_stock') and im.created_at >= p_window_start and im.created_at < p_window_end),
      'waste_units', (select coalesce(abs(sum(im.quantity_delta)),0) from public.inventory_movements im where im.business_id = p_business_id and im.movement_type in ('damage','loss','expiration') and im.created_at >= p_window_start and im.created_at < p_window_end),
      'adjustment_units', (select coalesce(sum(im.quantity_delta),0) from public.inventory_movements im where im.business_id = p_business_id and im.movement_type = 'manual_adjustment' and im.created_at >= p_window_start and im.created_at < p_window_end),
      'counts', (select count(*) from public.inventory_movements im where im.business_id = p_business_id and im.movement_type = 'stock_count' and im.created_at >= p_window_start and im.created_at < p_window_end),
      'count_difference_units', (select coalesce(sum(im.quantity_delta),0) from public.inventory_movements im where im.business_id = p_business_id and im.movement_type = 'stock_count' and im.created_at >= p_window_start and im.created_at < p_window_end)
    ),
    'fiscal', jsonb_build_object(
      'authorized', (select count(*) from public.fiscal_documents fd where fd.business_id = p_business_id and fd.authorized_at >= p_window_start and fd.authorized_at < p_window_end and fd.state = 'authorized'),
      'pending', (select count(*) from public.fiscal_documents fd where fd.business_id = p_business_id and fd.created_at < p_window_end and fd.state in ('draft','queued','claiming','authenticating','authorizing','ambiguous','retry_wait','failed')),
      'rejected', (select count(*) from public.fiscal_documents fd where fd.business_id = p_business_id and fd.created_at >= p_window_start and fd.created_at < p_window_end and fd.state in ('observed','rejected')),
      'credit_notes', (select count(*) from public.fiscal_documents fd where fd.business_id = p_business_id and fd.document_intent = 'credit_note' and fd.created_at >= p_window_start and fd.created_at < p_window_end),
      'pdf_pending', (select count(*) from public.fiscal_documents fd where fd.business_id = p_business_id and fd.state = 'authorized' and fd.artifact_state <> 'artifact_ready' and fd.authorized_at < p_window_end)
    )
  )
$$;


ALTER FUNCTION "public"."daily_reconciliation_snapshot_internal"("p_business_id" "uuid", "p_window_start" timestamp with time zone, "p_window_end" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delivery_location_address_fingerprint"("p_value" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
  select btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          translate(lower(coalesce(p_value, '')), 'áéíóúüñ', 'aeiouun'),
          '\m(av\.?|avda\.?)\M', 'avenida', 'g'
        ),
        '\m(dpto\.?|depto\.?)\M', 'departamento', 'g'
      ),
      '[^a-z0-9]+', ' ', 'g'
    )
  )
$$;


ALTER FUNCTION "public"."delivery_location_address_fingerprint"("p_value" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delivery_location_address_fingerprint"("p_street" "text", "p_street_number" "text", "p_city" "text", "p_province" "text", "p_postal_code" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
  select public.delivery_location_address_fingerprint(
    concat_ws(' ',
      nullif(btrim(coalesce(p_street, '')), ''),
      nullif(btrim(coalesce(p_street_number, '')), ''),
      nullif(btrim(coalesce(p_city, '')), ''),
      nullif(btrim(coalesce(p_province, '')), ''),
      nullif(btrim(coalesce(p_postal_code, '')), '')
    )
  )
$$;


ALTER FUNCTION "public"."delivery_location_address_fingerprint"("p_street" "text", "p_street_number" "text", "p_city" "text", "p_province" "text", "p_postal_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dispatch_payment_outbox_worker"("p_source" "text" DEFAULT 'cron'::"text") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'vault', 'net', 'pg_temp'
    AS $_$
declare
  v_worker_url text;
  v_worker_secret text;
  v_timestamp text;
  v_nonce text;
  v_manifest text;
  v_signature text;
  v_request_id bigint;
  v_due boolean;
begin
  if p_source not in ('cron', 'outbox') then
    raise exception 'invalid payment worker dispatch source' using errcode = '22023';
  end if;

  select exists (
    select 1
      from public.payment_outbox o
     where (o.status in ('pending', 'retry_wait') and o.next_attempt_at <= clock_timestamp())
        or (o.status in ('claimed', 'processing') and coalesce(o.lease_expires_at, '-infinity'::timestamptz) < clock_timestamp())
  ) into v_due;
  if not v_due then return null; end if;

  select ds.decrypted_secret
    into v_worker_url
    from vault.decrypted_secrets ds
   where ds.name = 'taba_payment_worker_url'
   limit 1;
  select ds.decrypted_secret
    into v_worker_secret
    from vault.decrypted_secrets ds
   where ds.name = 'taba_payment_worker_hmac_secret'
   limit 1;

  -- A missing Vault configuration is a safe no-op. Deployment preflight must
  -- prove both names exist before staging certification.
  if nullif(btrim(v_worker_url), '') is null or nullif(v_worker_secret, '') is null then
    return null;
  end if;
  if v_worker_url !~ '^https://[a-z0-9-]+[.]supabase[.]co/functions/v1/mercadopago-payment-worker$' then
    raise exception 'invalid payment worker URL' using errcode = '22023';
  end if;
  if length(v_worker_secret) < 32 then
    raise exception 'payment worker secret is too short' using errcode = '22023';
  end if;

  v_timestamp := floor(extract(epoch from clock_timestamp()))::bigint::text;
  v_nonce := gen_random_uuid()::text;
  v_manifest := v_timestamp || '.' || v_nonce || '.POST./functions/v1/mercadopago-payment-worker';
  v_signature := encode(hmac(v_manifest, v_worker_secret, 'sha256'), 'hex');

  select net.http_post(
    url := v_worker_url,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-taba-worker-timestamp', v_timestamp,
      'x-taba-worker-nonce', v_nonce,
      'x-taba-worker-signature', v_signature
    ),
    body := jsonb_build_object('source', p_source, 'scheduled_at', clock_timestamp()),
    timeout_milliseconds := 5000
  ) into v_request_id;
  return v_request_id;
end;
$_$;


ALTER FUNCTION "public"."dispatch_payment_outbox_worker"("p_source" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."dispatch_payment_outbox_worker"("p_source" "text") IS 'Dispatches due Mercado Pago outbox work through pg_net using a short-lived HMAC; Vault keeps the shared secret encrypted at rest.';



CREATE OR REPLACE FUNCTION "public"."enforce_confirmed_delivery_location"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_order public.orders%rowtype;
begin
  -- Se RELEE la fila. Un trigger diferido recibe la tupla del evento, no la
  -- final, y el camino de pedido directo completa el bloque `delivery_*` con un
  -- UPDATE posterior dentro de la misma transacción.
  select * into v_order from public.orders o where o.id = new.id;
  if not found then
    return null;
  end if;
  if coalesce(v_order.fulfillment_type, v_order.delivery_mode) is distinct from 'delivery' then
    return null;
  end if;
  if v_order.delivery_latitude is null
    or v_order.delivery_longitude is null
    or v_order.delivery_location_source is null
    or v_order.delivery_location_confirmed_at is null then
    raise exception 'DELIVERY_LOCATION_REQUIRED'
      using errcode = '23514',
            detail = 'un pedido delivery necesita un punto de entrega confirmado por el cliente',
            hint = 'confirmar la ubicacion antes de crear el pedido';
  end if;
  return null;
end;
$$;


ALTER FUNCTION "public"."enforce_confirmed_delivery_location"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."enforce_confirmed_delivery_location"() IS 'Red de seguridad diferida: ningun pedido delivery queda confirmado sin punto de entrega.';



CREATE OR REPLACE FUNCTION "public"."enqueue_authorized_fiscal_artifact"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
begin
  if new.state = 'authorized' and old.state is distinct from 'authorized' then
    insert into public.fiscal_artifact_outbox(fiscal_document_id)
    values (new.id)
    on conflict(fiscal_document_id) do nothing;
    update public.fiscal_documents
      set artifact_state = 'artifact_pending', artifact_error_code = null, artifact_error_message = null, artifact_updated_at = now()
      where id = new.id;
    insert into public.fiscal_events(fiscal_document_id, event_type, actor_type, sanitized_detail)
    values (new.id, 'artifact_pending', 'system', jsonb_build_object('required', true));
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."enqueue_authorized_fiscal_artifact"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_checkout_provider_probes"("p_limit" integer DEFAULT 50) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_inserted integer;
begin
  with candidatos as (
    select pi.id, pi.provider_payment_id
      from public.payment_intents pi
      join public.checkout_sessions cs on cs.id = pi.checkout_session_id
     where cs.completed_order_id is null
       and pi.order_id is null
       -- El comprador llego a ver Mercado Pago: sin preferencia no hay nada que
       -- preguntar, porque nunca hubo donde pagar.
       and nullif(btrim(coalesce(pi.preference_id, '')), '') is not null
       and nullif(btrim(coalesce(pi.external_reference, '')), '') is not null
       and pi.internal_status not in (
         'completed', 'refunded', 'partially_refunded', 'charged_back',
         'security_review_required'
       )
       -- 48 horas, igual que la alerta CHECKOUT_PROVIDER_UNVERIFIED. Las dos
       -- ventanas tienen que coincidir: si la alerta abarcara mas que la sonda,
       -- habria checkouts marcados como �no sabemos� que nadie va a consultar.
       and cs.created_at > clock_timestamp() - interval '48 hours'
       and cs.created_at < clock_timestamp() - interval '90 seconds'
       and not exists (
         select 1 from public.payment_outbox po
          where po.payment_intent_id = pi.id
            and po.topic = 'payment_reconcile'
            and po.status in ('pending', 'claimed', 'processing', 'retry_wait')
       )
       and (
         select count(*) from public.payment_events pe
          where pe.payment_intent_id = pi.id
            and pe.event_type = 'payment.provider_probe_empty'
       ) < 8
       and not exists (
         select 1 from public.payment_events pe
          where pe.payment_intent_id = pi.id
            and pe.event_type = 'payment.provider_probe_empty'
            and pe.server_recorded_at > clock_timestamp() - interval '2 minutes'
       )
     order by cs.created_at
     limit greatest(1, least(coalesce(p_limit, 50), 200))
  )
  insert into public.payment_outbox (payment_intent_id, topic, resource_id)
  select c.id, 'payment_reconcile', c.provider_payment_id
    from candidatos c
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  return coalesce(v_inserted, 0);
end;
$$;


ALTER FUNCTION "public"."enqueue_checkout_provider_probes"("p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."enqueue_checkout_provider_probes"("p_limit" integer) IS 'Encola una consulta al proveedor por cada checkout que llego a Mercado Pago y todavia no es pedido. Acotada: 90s de gracia, 8 sondas vacias, una cada 2 minutos, 24 horas.';



CREATE OR REPLACE FUNCTION "public"."enqueue_new_order_notification"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
begin
  if public.normalize_order_status_vocabulary(new.status)='submitted' then
    insert into public.notification_outbox(business_id,event_type,aggregate_id,deduplication_key,payload)
    values(new.business_id,'new_order',new.id,'new-order-'||new.id::text,jsonb_build_object('order_id',new.id,'revision',new.revision))
    on conflict(business_id,deduplication_key) do nothing;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."enqueue_new_order_notification"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_payment_reconciliation"("p_payment_intent_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_actor uuid := auth.uid();
  v_intent public.payment_intents%rowtype;
  v_job uuid;
begin
  select * into v_intent
    from public.payment_intents pi
   where pi.id = p_payment_intent_id
   for update;
  if not found or v_actor is null
    or not public.has_business_role(v_intent.business_id, array['owner', 'admin']) then
    raise exception 'reconciliacion no autorizada' using errcode = '42501';
  end if;
  if v_intent.internal_status in ('completed', 'refunded', 'partially_refunded', 'charged_back') then
    return jsonb_build_object(
      'queued', false,
      'terminal', true,
      'idempotent', true,
      'internal_status', v_intent.internal_status,
      'order_id', v_intent.order_id
    );
  end if;
  -- Basta la referencia externa: el worker resuelve el pago por ella cuando
  -- todav�a no conocemos el identificador del proveedor.
  if v_intent.provider_payment_id is null
    and nullif(btrim(coalesce(v_intent.external_reference, '')), '') is null then
    raise exception 'pago sin referencia consultable' using errcode = '55000';
  end if;
  insert into public.payment_outbox (payment_intent_id, topic, resource_id)
  values (v_intent.id, 'payment_reconcile', v_intent.provider_payment_id)
  returning id into v_job;
  return jsonb_build_object('queued', true, 'job_id', v_job, 'idempotent', false);
exception when unique_violation then
  return jsonb_build_object('queued', true, 'idempotent', true);
end;
$$;


ALTER FUNCTION "public"."enqueue_payment_reconciliation"("p_payment_intent_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."enqueue_payment_reconciliation"("p_payment_intent_id" "uuid") IS 'Owner/admin-only exactly-once requeue. Alcanza con la referencia externa; los estados terminales de dinero siguen cerrados.';



CREATE OR REPLACE FUNCTION "public"."evaluate_operational_alerts_sweep"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_started timestamptz := clock_timestamp();
  v_business record;
  v_found integer;
  v_findings integer := 0;
  v_evaluated integer := 0;
  v_failures jsonb := '[]'::jsonb;
  v_open integer := 0;
  v_critical integer := 0;
  v_status text;
begin
  -- Dos barridos a la vez escribirian las mismas filas y se pisarian los
  -- `for update`. El que llega segundo se va: el primero ya esta haciendo su
  -- trabajo y correrlo de nuevo no agrega informacion.
  if not pg_try_advisory_xact_lock(hashtext('taba:operational_alerts_sweep')) then
    return jsonb_build_object('status', 'skipped', 'reason', 'ya hay una evaluación en curso');
  end if;

  for v_business in
    select b.id
    from public.businesses b
    where b.status <> 'closed'
       -- Un negocio cerrado con alertas abiertas se sigue evaluando: es la
       -- unica forma de que esas alertas lleguen a resolverse solas.
       or exists (
         select 1 from public.operational_alerts a
          where a.business_id = b.id and a.status <> 'resolved'
       )
    order by b.id
  loop
    begin
      v_found := public.reconcile_operational_alerts_for_business(v_business.id);
      v_findings := v_findings + coalesce(v_found, 0);
      v_evaluated := v_evaluated + 1;
    exception when others then
      -- Un negocio que falla no puede dejar a los demas sin evaluar.
      v_failures := v_failures || jsonb_build_array(jsonb_build_object(
        'business_id', v_business.id,
        'error', left(sqlerrm, 180)
      ));
    end;
  end loop;

  select
    count(*) filter (where a.status <> 'resolved'),
    count(*) filter (where a.status <> 'resolved' and a.severity = 'CRITICAL')
  into v_open, v_critical
  from public.operational_alerts a;

  v_status := case
    when jsonb_array_length(v_failures) = 0 then 'ok'
    when v_evaluated > 0 then 'partial'
    else 'failed'
  end;

  insert into public.operational_sweep_runs(
    scope, status, started_at, finished_at, businesses_evaluated,
    findings, open_alerts, critical_alerts, failures
  ) values (
    'operational_alerts', v_status, v_started, clock_timestamp(), v_evaluated,
    v_findings, v_open, v_critical, v_failures
  );

  -- Una fila por minuto: sin poda, en un mes son cuarenta mil filas que nadie
  -- va a leer. Una semana alcanza para reconstruir cualquier noche.
  delete from public.operational_sweep_runs
  where started_at < clock_timestamp() - interval '7 days';

  return jsonb_build_object(
    'status', v_status,
    'businesses_evaluated', v_evaluated,
    'findings', v_findings,
    'open_alerts', v_open,
    'critical_alerts', v_critical,
    'failures', v_failures
  );
end;
$$;


ALTER FUNCTION "public"."evaluate_operational_alerts_sweep"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."evaluate_operational_alerts_sweep"() IS 'Evalua las alertas operativas de todos los negocios activos. Idempotente, con lock consultivo y registro por corrida.';



CREATE OR REPLACE FUNCTION "public"."expire_checkout_sessions"("p_limit" integer DEFAULT 100) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_session_id uuid;
  v_count integer := 0;
begin
  for v_session_id in
    select s.id
      from public.checkout_sessions s
     where s.expires_at <= clock_timestamp()
       and s.status in ('created', 'validating', 'ready_for_payment', 'redirected', 'payment_pending')
     order by s.expires_at
     limit greatest(1, least(coalesce(p_limit, 100), 500))
     for update skip locked
  loop
    perform public.release_checkout_session_inventory(v_session_id, 'checkout_expired', 'expired');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;


ALTER FUNCTION "public"."expire_checkout_sessions"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fail_close_business_whatsapp_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
begin
  if tg_op = 'INSERT' then
    new.whatsapp_verified := false;
    new.whatsapp_verified_at := null;
    new.whatsapp_verified_by := null;
  elsif new.whatsapp_phone is distinct from old.whatsapp_phone
     or (
       old.whatsapp_verified_by is not null
       and new.whatsapp_verified_by is null
     ) then
    new.whatsapp_verified := false;
    new.whatsapp_verified_at := null;
    new.whatsapp_verified_by := null;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."fail_close_business_whatsapp_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fail_close_verified_product_master_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."fail_close_verified_product_master_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fail_fiscal_artifact"("p_artifact_outbox_id" "uuid", "p_worker_id" "text", "p_error_code" "text", "p_error_message" "text", "p_retryable" boolean DEFAULT true) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
declare
  v_outbox public.fiscal_artifact_outbox%rowtype;
  v_dead_letter boolean;
begin
  if coalesce(p_error_code,'') !~ '^[A-Z0-9_]{3,80}$' then raise exception 'codigo de artefacto invalido' using errcode = '22023'; end if;
  select o.* into v_outbox from public.fiscal_artifact_outbox o where o.id = p_artifact_outbox_id for update;
  if not found or v_outbox.state <> 'leased' or v_outbox.lease_owner <> p_worker_id then
    raise exception 'lease de artefacto invalido' using errcode = '40001';
  end if;
  v_dead_letter := not coalesce(p_retryable, true) or v_outbox.attempt_count >= 8;
  update public.fiscal_artifact_outbox
    set state = case when v_dead_letter then 'dead_letter' else 'retry_wait' end,
        processed_at = case when v_dead_letter then now() else null end,
        next_attempt_at = case when v_dead_letter then next_attempt_at else now() + least(interval '30 minutes', make_interval(secs => 30 * (2 ^ least(attempt_count, 6)))) end,
        lease_owner = null, lease_deadline = null,
        last_error_code = p_error_code, last_error_message = left(coalesce(p_error_message,''), 300)
    where id = v_outbox.id;
  update public.fiscal_documents
    set artifact_state = 'artifact_failed', artifact_error_code = p_error_code,
        artifact_error_message = left(coalesce(p_error_message,''), 300), artifact_updated_at = now()
    where id = v_outbox.fiscal_document_id;
  insert into public.fiscal_events(fiscal_document_id, event_type, actor_type, sanitized_detail)
  values (v_outbox.fiscal_document_id, 'artifact_failed', 'worker', jsonb_build_object('error_code', p_error_code, 'retryable', not v_dead_letter));
  return jsonb_build_object('fiscal_document_id', v_outbox.fiscal_document_id, 'state', case when v_dead_letter then 'artifact_failed' else 'artifact_pending' end);
end;
$_$;


ALTER FUNCTION "public"."fail_fiscal_artifact"("p_artifact_outbox_id" "uuid", "p_worker_id" "text", "p_error_code" "text", "p_error_message" "text", "p_retryable" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fail_payment_outbox_job"("p_job_id" "uuid", "p_owner" "text", "p_error_code" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare v_job public.payment_outbox%rowtype; v_status text;
begin
  select * into v_job from public.payment_outbox o where o.id = p_job_id and o.owner = p_owner for update;
  if not found or v_job.status <> 'processing' then return null; end if;
  v_status := case when v_job.attempts >= 8 then 'dead_letter' else 'retry_wait' end;
  update public.payment_outbox set status = v_status, lease_expires_at = null,
    last_error = left(coalesce(p_error_code, 'worker_failed'), 160),
    next_attempt_at = case when v_status = 'dead_letter' then next_attempt_at
      else clock_timestamp() + make_interval(secs => least(3600, 15 * (2 ^ least(v_job.attempts, 8))::integer)) end
   where id = v_job.id;
  if v_job.webhook_receipt_id is not null then
    update public.payment_webhook_receipts set processing_status = v_status, last_error = left(coalesce(p_error_code, 'worker_failed'), 160)
     where id = v_job.webhook_receipt_id;
  end if;
  return v_status;
end;
$$;


ALTER FUNCTION "public"."fail_payment_outbox_job"("p_job_id" "uuid", "p_owner" "text", "p_error_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_paid_checkout_session"("p_checkout_session_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_session public.checkout_sessions%rowtype;
  v_intent public.payment_intents%rowtype;
  v_order public.orders%rowtype;
  v_item record;
  v_reservation public.inventory_reservations%rowtype;
  v_code text;
  v_tracking_token text;
begin
  select * into v_session from public.checkout_sessions s where s.id = p_checkout_session_id for update;
  if not found then raise exception 'checkout inexistente' using errcode = 'P0002'; end if;
  if v_session.completed_order_id is not null or v_session.status = 'completed' then
    return jsonb_build_object('ok', true, 'order_id', v_session.completed_order_id, 'idempotent', true);
  end if;
  select * into v_intent from public.payment_intents pi where pi.checkout_session_id = v_session.id for update;
  if not found or v_intent.internal_status not in ('approved_order_pending', 'approved')
    or v_intent.provider_status <> 'approved' or v_intent.paid_amount <> v_session.total or v_intent.currency <> 'ARS' then
    raise exception 'pago no aprobado verificadamente' using errcode = '55000';
  end if;
  if v_session.expires_at <= clock_timestamp() or not exists (
    select 1 from public.inventory_reservations r where r.checkout_session_id = v_session.id and r.status = 'active' and r.expires_at > clock_timestamp()
  ) then
    update public.payment_intents set internal_status = 'security_review_required', security_review_reason = 'finalization_without_active_reservation' where id = v_intent.id;
    update public.checkout_sessions set status = 'manual_review_required', manual_review_reason = 'finalization_without_active_reservation' where id = v_session.id;
    return jsonb_build_object('ok', false, 'manual_review_required', true);
  end if;
  -- El dinero ya se movio: aca no se aborta. Una sesion delivery sin punto
  -- confirmado es imposible por construccion -`create_checkout_session` la
  -- rechaza antes de reservar stock-, asi que si aparece es una anomalia y la
  -- decide una persona, no un raise que revierta el pago en loop.
  if v_session.fulfillment_type = 'delivery' and (
    nullif(v_session.address_snapshot ->> 'latitude', '') is null
    or nullif(v_session.address_snapshot ->> 'longitude', '') is null
    or nullif(v_session.address_snapshot ->> 'location_source', '') is null
    or nullif(v_session.address_snapshot ->> 'location_confirmed_at', '') is null
  ) then
    update public.payment_intents set internal_status = 'security_review_required', security_review_reason = 'finalization_without_confirmed_delivery_location' where id = v_intent.id;
    update public.checkout_sessions set status = 'manual_review_required', manual_review_reason = 'finalization_without_confirmed_delivery_location' where id = v_session.id;
    return jsonb_build_object('ok', false, 'manual_review_required', true, 'code', 'DELIVERY_LOCATION_REQUIRED');
  end if;
  update public.checkout_sessions set status = 'finalizing_order' where id = v_session.id;
  loop
    v_code := public.next_order_public_code();
    exit when not exists (select 1 from public.orders o where o.code = v_code or o.public_code = v_code);
  end loop;
  insert into public.orders (
    business_id, code, public_code, status, fulfillment_type, delivery_mode,
    customer_user_id, client_request_id, client_request_fingerprint, currency_code,
    customer_name, customer_phone, customer_whatsapp, address_label,
    customer_street_address, customer_neighborhood, customer_reference,
    customer_address_id, delivery_address_formatted, delivery_street, delivery_street_number,
    delivery_floor, delivery_apartment, delivery_reference, delivery_city, delivery_province,
    delivery_postal_code, delivery_address_label, delivery_address_source, delivery_snapshot_created_at,
    delivery_latitude, delivery_longitude, delivery_geolocation_accuracy,
    delivery_location_source, delivery_location_confirmed_at,
    payment_method, subtotal, discount_total, delivery_fee, total
  ) values (
    v_session.business_id, v_code, v_code, 'received', v_session.fulfillment_type, v_session.fulfillment_type,
    v_session.customer_id, 'mp_' || replace(v_session.id::text, '-', ''), v_session.normalized_intent_hash, 'ARS',
    v_session.contact_snapshot ->> 'name', v_session.contact_snapshot ->> 'phone', v_session.contact_snapshot ->> 'phone',
    coalesce(v_session.address_snapshot ->> 'label', case when v_session.fulfillment_type = 'delivery' then 'Entrega' else null end),
    btrim(concat_ws(' ', nullif(v_session.address_snapshot ->> 'street', ''), nullif(v_session.address_snapshot ->> 'street_number', ''))),
    v_session.address_snapshot ->> 'city', v_session.address_snapshot ->> 'reference',
    nullif(v_session.address_snapshot ->> 'address_id', '')::uuid,
    case when v_session.fulfillment_type = 'delivery' then nullif(btrim(concat_ws(', ',
      nullif(btrim(concat_ws(' ', nullif(v_session.address_snapshot ->> 'street', ''), nullif(v_session.address_snapshot ->> 'street_number', ''))), ''),
      nullif(v_session.address_snapshot ->> 'city', ''),
      nullif(v_session.address_snapshot ->> 'province', ''))), '') end,
    v_session.address_snapshot ->> 'street', v_session.address_snapshot ->> 'street_number',
    v_session.address_snapshot ->> 'floor', v_session.address_snapshot ->> 'apartment',
    v_session.address_snapshot ->> 'reference', v_session.address_snapshot ->> 'city',
    v_session.address_snapshot ->> 'province', v_session.address_snapshot ->> 'postal_code',
    v_session.address_snapshot ->> 'label',
    case when v_session.fulfillment_type = 'delivery'
      then coalesce(nullif(v_session.address_snapshot ->> 'source', ''), 'checkout_session') end,
    case when v_session.fulfillment_type = 'delivery' then clock_timestamp() end,
    case when v_session.fulfillment_type = 'delivery'
      then nullif(v_session.address_snapshot ->> 'latitude', '')::numeric(9, 6) end,
    case when v_session.fulfillment_type = 'delivery'
      then nullif(v_session.address_snapshot ->> 'longitude', '')::numeric(9, 6) end,
    case when v_session.fulfillment_type = 'delivery'
      then nullif(v_session.address_snapshot ->> 'geolocation_accuracy', '')::numeric(10, 2) end,
    case when v_session.fulfillment_type = 'delivery'
      then nullif(v_session.address_snapshot ->> 'location_source', '') end,
    case when v_session.fulfillment_type = 'delivery'
      then nullif(v_session.address_snapshot ->> 'location_confirmed_at', '')::timestamptz end,
    'mercadopago', v_session.subtotal, v_session.discount_total, v_session.delivery_fee, v_session.total
  ) returning * into v_order;
  for v_item in select * from public.checkout_session_items i where i.checkout_session_id = v_session.id order by i.product_id loop
    insert into public.order_items (order_id, product_id, product_uuid, name, quantity, unit, unit_price, subtotal)
    values (v_order.id, v_item.product_id::text, v_item.product_id, coalesce(v_item.product_snapshot ->> 'name', 'Producto TABA2'),
      v_item.quantity, nullif(v_item.product_snapshot ->> 'presentation', ''), v_item.unit_price, v_item.subtotal);
  end loop;
  insert into public.order_combos (
    order_id, combo_uuid, combo_id, name, quantity, discount_percentage,
    list_price, promotional_price, discount_amount, combo_snapshot
  )
  select v_order.id, c.combo_uuid, c.combo_id, c.name, c.quantity, c.discount_percentage,
         c.list_price, c.promotional_price, c.discount_amount, c.combo_snapshot
    from public.checkout_session_combos c
   where c.checkout_session_id = v_session.id
   order by c.combo_id;
  for v_reservation in select * from public.inventory_reservations r where r.checkout_session_id = v_session.id and r.status = 'active' order by r.product_id for update loop
    update public.inventory_reservations set status = 'converted', converted_at = clock_timestamp() where id = v_reservation.id and status = 'active';
  end loop;
  insert into public.order_events (order_id, business_id, actor_user_id, actor_role, actor_type, event_type, type, message, metadata, payload)
  values (v_order.id, v_session.business_id, v_session.customer_id, 'customer', 'customer', 'order.received', 'order.received',
    'Pedido recibido y pago aprobado', jsonb_build_object('source', 'mercadopago_checkout_pro', 'payment_intent_id', v_intent.id),
    jsonb_build_object('source', 'mercadopago_checkout_pro', 'payment_intent_id', v_intent.id));
  v_tracking_token := encode(gen_random_bytes(32), 'hex');
  insert into public.order_public_tokens (order_id, token, token_hash, expires_at)
  values (v_order.id, null, digest(v_tracking_token, 'sha256'), clock_timestamp() + interval '30 days');
  update public.payment_intents set order_id = v_order.id, internal_status = 'completed' where id = v_intent.id;
  update public.checkout_sessions set completed_order_id = v_order.id, status = 'completed' where id = v_session.id;
  insert into public.payment_events (payment_intent_id, event_type, details)
  values (v_intent.id, 'payment.order_completed', jsonb_build_object('order_id', v_order.id));
  return jsonb_build_object('ok', true, 'order_id', v_order.id, 'order_code', v_order.public_code, 'idempotent', false);
end;
$$;


ALTER FUNCTION "public"."finalize_paid_checkout_session"("p_checkout_session_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."finalize_paid_checkout_session"("p_checkout_session_id" "uuid") IS 'Exactly-once paid-order finalization: locks checkout, payment and reservation, creates one operational order and never decrements stock twice.';



CREATE OR REPLACE FUNCTION "public"."find_payment_intent_by_external_reference"("p_environment" "text", "p_external_reference" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare v_intent public.payment_intents%rowtype;
begin
  select * into v_intent from public.payment_intents pi
   where pi.environment = lower(btrim(coalesce(p_environment, '')))
     and pi.external_reference = btrim(coalesce(p_external_reference, ''))
   for share;
  if not found then raise exception 'referencia de pago desconocida' using errcode = 'P0002'; end if;
  return jsonb_build_object('payment_intent_id', v_intent.id, 'checkout_session_id', v_intent.checkout_session_id);
end;
$$;


ALTER FUNCTION "public"."find_payment_intent_by_external_reference"("p_environment" "text", "p_external_reference" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fiscal_artifact_storage_path"("p_business_id" "uuid", "p_document_id" "uuid", "p_generation_token" "uuid") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select concat('fiscal/', p_business_id::text, '/', p_document_id::text, '/', p_generation_token::text, '.pdf');
$$;


ALTER FUNCTION "public"."fiscal_artifact_storage_path"("p_business_id" "uuid", "p_document_id" "uuid", "p_generation_token" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fiscal_has_current_parameter_id"("p_environment" "text", "p_parameter_type" "text", "p_id" integer) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_values jsonb;
begin
  select s.values_json into v_values
  from public.fiscal_parameter_snapshots s
  where s.environment = p_environment
    and s.parameter_type = p_parameter_type
    and s.synchronized_at >= now() - interval '7 days'
  order by s.synchronized_at desc, s.id desc
  limit 1;
  return found and public.fiscal_json_contains_parameter_id(v_values, p_id);
end;
$$;


ALTER FUNCTION "public"."fiscal_has_current_parameter_id"("p_environment" "text", "p_parameter_type" "text", "p_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fiscal_json_contains_parameter_id"("p_value" "jsonb", "p_id" integer) RETURNS boolean
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_child jsonb;
begin
  if p_value is null then return false; end if;
  if jsonb_typeof(p_value) = 'object' then
    if coalesce(p_value->>'Id', p_value->>'id') = p_id::text then return true; end if;
    for v_child in select value from jsonb_each(p_value)
    loop
      if public.fiscal_json_contains_parameter_id(v_child, p_id) then return true; end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for v_child in select value from jsonb_array_elements(p_value)
    loop
      if public.fiscal_json_contains_parameter_id(v_child, p_id) then return true; end if;
    end loop;
  end if;
  return false;
end;
$$;


ALTER FUNCTION "public"."fiscal_json_contains_parameter_id"("p_value" "jsonb", "p_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_active_rider_delivery"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_order_id uuid;
begin
  if auth.uid() is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  select o.id
    into v_order_id
    from public.orders o
    join public.business_members bm
      on bm.business_id = o.business_id
     and bm.user_id = auth.uid()
     and bm.role = 'rider'
     and bm.is_active = true
   where o.assigned_rider_user_id = auth.uid()
     and o.delivery_mode = 'delivery'
     and o.status in ('assigned', 'picked_up', 'on_the_way', 'arrived')
   order by o.updated_at desc, o.id desc
   limit 1;
  if v_order_id is null then return null; end if;
  return public.rider_active_delivery_payload(v_order_id);
end;
$$;


ALTER FUNCTION "public"."get_active_rider_delivery"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_active_rider_delivery"() IS 'Assigned active Rider delivery with exact customer coordinates gated by active membership and assignment.';



CREATE OR REPLACE FUNCTION "public"."get_arca_activation_status"("p_business_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
declare
  v_profile public.fiscal_profiles%rowtype;
  v_last_document record;
  v_result jsonb;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;

  select * into v_profile from public.fiscal_profiles where business_id = p_business_id;

  select fd.document_type, fd.document_number, fd.point_of_sale, fd.state, fd.created_at
    into v_last_document
    from public.fiscal_documents fd
   where fd.business_id = p_business_id
   order by fd.created_at desc
   limit 1;

  v_result := jsonb_build_object(
    'generated_at', clock_timestamp(),
    'legal_name', v_profile.legal_name,
    'cuit', v_profile.cuit,
    'cuit_valid', coalesce(v_profile.cuit ~ '^[0-9]{11}$', false),
    'tax_condition', v_profile.tax_condition,
    'business_address', v_profile.business_address,
    'accountant_review_status', coalesce(v_profile.accountant_review_status, 'pending'),
    'environment', coalesce(v_profile.environment, 'disabled'),
    'point_of_sale', v_profile.point_of_sale,
    'certificate_loaded', v_profile.certificate_fingerprint_sha256 is not null,
    'certificate_expires_at', v_profile.certificate_expires_at,
    'certificate_cuit_mismatch', coalesce(
      v_profile.certificate_subject_cuit is not null
      and v_profile.cuit is not null
      and v_profile.certificate_subject_cuit <> v_profile.cuit,
      false
    ),
    'delegation_status', coalesce(v_profile.delegation_status, 'pending'),
    'connection_ok_at', v_profile.connection_ok_at,
    'artifact_verified_at', v_profile.artifact_verified_at,
    'print_verified_at', v_profile.print_verified_at,
    'homologation_authorized_at', v_profile.homologation_authorized_at,
    'homologated_invoices', (
      select count(*) from public.fiscal_documents fd
       where fd.business_id = p_business_id and fd.environment = 'homologation'
         and fd.document_intent = 'invoice' and fd.state in ('authorized', 'credited')
    ),
    'homologated_credit_notes', (
      select count(*) from public.fiscal_documents fd
       where fd.business_id = p_business_id and fd.environment = 'homologation'
         and fd.document_intent = 'credit_note' and fd.state = 'authorized'
    ),
    'pending_documents', (
      select count(*) from public.fiscal_documents fd
       where fd.business_id = p_business_id
         and fd.state in ('draft', 'queued', 'claiming', 'authenticating', 'authorizing', 'retry_wait')
    ),
    'stalled_documents', (
      select count(*) from public.fiscal_outbox fo
       join public.fiscal_documents fd on fd.id = fo.fiscal_document_id
       where fd.business_id = p_business_id
         and (fo.state = 'dead_letter'
              or (fo.state in ('pending', 'retry_wait') and fo.next_attempt_at < clock_timestamp() - interval '15 minutes'))
    ),
    'last_document_label', case
      when v_last_document.document_number is null then null
      else concat_ws(' ', v_last_document.document_type, v_last_document.point_of_sale::text, v_last_document.document_number::text)
    end,
    'last_document_at', v_last_document.created_at,
    'last_document_failed', coalesce(v_last_document.state in ('failed', 'ambiguous'), false),
    'last_error_code', v_profile.last_error_code,
    'last_error_at', v_profile.last_error_at
  );
  return v_result;
end;
$_$;


ALTER FUNCTION "public"."get_arca_activation_status"("p_business_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_business_opening_status"("p_business_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_business public.businesses%rowtype;
  v_settings public.business_payment_settings%rowtype;
  v_profile public.fiscal_profiles%rowtype;
  v_stalled integer;
  v_riders integer;
  v_open_orders integer;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;

  select * into v_business from public.businesses where id = p_business_id;
  if not found then
    raise exception 'negocio inexistente' using errcode = 'P0002';
  end if;
  select * into v_settings from public.business_payment_settings
   where business_id = p_business_id and provider = 'mercadopago';
  select * into v_profile from public.fiscal_profiles where business_id = p_business_id;

  select
    (select count(*) from public.payment_outbox po
      join public.payment_intents pi on pi.id = po.payment_intent_id
     where pi.business_id = p_business_id and po.status in ('failed', 'dead_letter'))
    + (select count(*) from public.fiscal_outbox fo
        join public.fiscal_documents fd on fd.id = fo.fiscal_document_id
       where fd.business_id = p_business_id and fo.state = 'dead_letter')
    into v_stalled;

  select count(*) into v_riders from public.riders r
   where r.business_id = p_business_id and r.status = 'available';

  select count(*) into v_open_orders from public.orders o
   where o.business_id = p_business_id
     and o.status not in ('delivered', 'canceled', 'cancelled', 'rejected');

  return jsonb_build_object(
    'generated_at', clock_timestamp(),
    'business_status', v_business.status,
    'backend', jsonb_build_object('status', 'ok', 'detail', 'El sistema del negocio respondió.'),
    'payments', jsonb_build_object(
      'status', case
        when coalesce(v_settings.enabled, false)
          and v_business.ordering_enabled and v_business.ordering_verified then 'ok'
        when v_settings.id is null then 'failed'
        else 'degraded'
      end,
      'detail', case
        when v_settings.id is null then 'Los cobros por la web todavía no están configurados.'
        when not coalesce(v_settings.enabled, false) then 'Los cobros por la web están apagados.'
        when not (v_business.ordering_enabled and v_business.ordering_verified) then 'La web todavía no acepta pedidos.'
        else 'Los cobros por la web están activos.'
      end
    ),
    'fiscal', jsonb_build_object(
      'status', case
        when coalesce(v_profile.is_enabled, false) and coalesce(v_profile.environment, 'disabled') <> 'disabled' then 'ok'
        when v_profile.business_id is null then 'failed'
        else 'degraded'
      end,
      'detail', case
        when v_profile.business_id is null then 'Todavía no se cargaron los datos de facturación.'
        when not coalesce(v_profile.is_enabled, false) then 'La facturación está apagada.'
        else 'La facturación está activa.'
      end
    ),
    'riders', jsonb_build_object(
      'status', case when v_riders > 0 then 'ok' else 'degraded' end,
      'detail', case
        when v_riders > 0 then v_riders || ' repartidor(es) disponible(s).'
        else 'No hay repartidores disponibles ahora.'
      end
    ),
    'queues', jsonb_build_object(
      'status', case when v_stalled > 0 then 'degraded' else 'ok' end,
      'detail', case
        when v_stalled > 0 then v_stalled || ' cosa(s) quedaron esperando de antes.'
        else 'No quedó nada trabado de antes.'
      end
    ),
    'open_orders', v_open_orders
  );
end;
$$;


ALTER FUNCTION "public"."get_business_opening_status"("p_business_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_checkout_session_for_customer"("p_checkout_session_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_customer_id uuid := auth.uid();
  v_payload jsonb;
begin
  if v_customer_id is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  select public.checkout_session_customer_payload(p_checkout_session_id, v_customer_id)
    into v_payload;
  if v_payload is null then
    raise exception 'checkout no encontrado o acceso denegado' using errcode = '42501';
  end if;
  return v_payload;
end;
$$;


ALTER FUNCTION "public"."get_checkout_session_for_customer"("p_checkout_session_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_checkout_session_for_customer"("p_checkout_session_id" "uuid") IS 'Customer-safe checkout recovery DTO. Redirect query parameters are never payment authority.';



CREATE OR REPLACE FUNCTION "public"."get_current_customer_profile"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_customer_id uuid := auth.uid();
begin
  if v_customer_id is null then
    raise exception 'autenticacion de cliente requerida' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'profile', (
      select jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'phone', c.phone,
        'lastOrderAt', c.last_order_at,
        'createdAt', c.created_at,
        'updatedAt', c.updated_at
      )
      from public.customers c
      where c.id = v_customer_id
    ),
    'addresses', coalesce((
      select jsonb_agg(public.customer_address_json(a) order by a.is_default desc, a.updated_at desc, a.id)
      from public.customer_addresses a
      where a.customer_id = v_customer_id
        and a.deleted_at is null
    ), '[]'::jsonb)
  );
end;
$$;


ALTER FUNCTION "public"."get_current_customer_profile"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_mercadopago_activation_status"("p_business_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_settings public.business_payment_settings%rowtype;
  v_business public.businesses%rowtype;
  v_signed_at timestamptz;
  v_test_payment record;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'estado de cobros no autorizado' using errcode = '42501';
  end if;

  select * into v_business from public.businesses where id = p_business_id;
  select * into v_settings from public.business_payment_settings
   where business_id = p_business_id and provider = 'mercadopago';

  select max(r.received_at) into v_signed_at
    from public.payment_webhook_receipts r
    join public.payment_events e on e.webhook_receipt_id = r.id
    join public.payment_intents pi on pi.id = e.payment_intent_id
   where pi.business_id = p_business_id and r.signature_valid;

  select pi.approved_at, pi.order_id,
         exists (
           select 1 from public.inventory_reservations ir
            join public.checkout_sessions cs on cs.id = ir.checkout_session_id
           where cs.business_id = p_business_id and ir.checkout_session_id = pi.checkout_session_id
         ) as stock_applied
    into v_test_payment
    from public.payment_intents pi
   where pi.business_id = p_business_id
     and pi.internal_status in ('approved', 'completed')
   order by pi.approved_at desc nulls last
   limit 1;

  return jsonb_build_object(
    'generated_at', clock_timestamp(),
    'settings_present', v_settings.id is not null,
    'enabled', coalesce(v_settings.enabled, false),
    'environment', coalesce(v_settings.environment, 'test'),
    'currency', coalesce(v_settings.currency, 'ARS'),
    'reserve_stock', coalesce(v_settings.reserve_stock, false),
    'installments_limit', v_settings.installments_limit,
    'preference_expiration_minutes', v_settings.preference_expiration_minutes,
    'refund_policy', v_settings.refund_policy,
    'production_review_status', coalesce(v_settings.production_review_status, 'not_requested'),
    'collector_configured', nullif(btrim(coalesce(v_settings.collector_id, '')), '') is not null,
    'application_configured', nullif(btrim(coalesce(v_settings.application_id, '')), '') is not null,
    -- Sólo los últimos dígitos: alcanzan para reconocer la cuenta y no exponen el identificador completo.
    'collector_id_short', right(coalesce(v_settings.collector_id, ''), 4),
    'application_id_short', right(coalesce(v_settings.application_id, ''), 4),
    'configured_at', v_settings.configured_at,
    'verified_at', v_settings.verified_at,
    -- El servidor tiene credenciales cuando pudo firmar y recibir al menos una preferencia.
    'credentials_loaded', exists (
      select 1 from public.payment_intents pi
       where pi.business_id = p_business_id
         and pi.internal_status not in ('created', 'preference_creating')
    ),
    'signed_notice_at', v_signed_at,
    'rejected_notices_recent', (
      select count(*) from public.payment_webhook_receipts r
       where r.processing_status = 'rejected_signature'
         and r.received_at > clock_timestamp() - interval '24 hours'
         and r.resource_id in (
           select pi.provider_payment_id from public.payment_intents pi
            where pi.business_id = p_business_id and pi.provider_payment_id is not null
         )
    ),
    'test_payment_at', v_test_payment.approved_at,
    'test_payment_order_created', coalesce(v_test_payment.order_id is not null, false),
    'test_payment_stock_applied', coalesce(v_test_payment.stock_applied, false),
    'storefront_ready', coalesce(
      v_business.is_active and v_business.status = 'open'
      and v_business.ordering_enabled and v_business.ordering_verified,
      false
    )
  );
end;
$$;


ALTER FUNCTION "public"."get_mercadopago_activation_status"("p_business_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_mercadopago_activation_status"("p_business_id" "uuid") IS 'Estado de activación de cobros para el panel. Devuelve sólo los últimos dígitos de los identificadores y ningún secreto.';



CREATE OR REPLACE FUNCTION "public"."get_mercadopago_checkout_availability"("p_business_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select jsonb_build_object(
    'available', coalesce(
      b.is_active
      and b.status = 'open'
      and b.ordering_enabled
      and b.ordering_verified
      and s.enabled
      and s.provider = 'mercadopago'
      and s.checkout_mode = 'checkout_pro'
      and s.currency = 'ARS'
      and (s.environment <> 'production' or s.production_review_status = 'approved'),
      false
    ),
    'environment', s.environment,
    'checkout_mode', s.checkout_mode,
    'allow_offline_payment_methods', coalesce(s.allow_offline_payment_methods, false),
    'installments_limit', s.installments_limit
  )
  from public.businesses b
  left join public.business_payment_settings s
    on s.business_id = b.id
   and s.provider = 'mercadopago'
  where b.id = p_business_id;
$$;


ALTER FUNCTION "public"."get_mercadopago_checkout_availability"("p_business_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_operational_health"("p_business_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
begin
  if not public.has_business_role(p_business_id, array['owner','admin','staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  return public.build_operational_health(p_business_id);
end;
$$;


ALTER FUNCTION "public"."get_operational_health"("p_business_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_operational_health"("p_business_id" "uuid") IS 'Salud operativa para el negocio o el administrador. Nunca devuelve secretos: de la boveda sale existencia y forma.';



CREATE OR REPLACE FUNCTION "public"."get_packing_manifest"("p_session_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_session public.order_packing_sessions%rowtype;
begin
  select s.* into v_session from public.order_packing_sessions s where s.id=p_session_id;
  if not found then raise exception 'sesion inexistente' using errcode='P0002'; end if;
  if not public.has_business_role(v_session.business_id,array['owner','admin','staff']) then
    raise exception 'operador no autorizado' using errcode='42501';
  end if;
  return jsonb_build_object(
    'schema_version',1,
    'session',jsonb_build_object(
      'id',v_session.id,
      'business_id',v_session.business_id,
      'order_id',v_session.order_id,
      'order_revision',v_session.order_revision,
      'status',v_session.status,
      'operator_id',v_session.operator_id,
      'updated_at',v_session.updated_at
    ),
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_id',oi.product_uuid,
        'name',left(oi.name,100),
        'quantity',oi.quantity,
        'barcodes',coalesce((
          select jsonb_agg(jsonb_build_object('gtin',b.gtin,'unit_factor',b.unit_factor) order by b.gtin)
          from public.product_barcodes b
          where b.business_id=v_session.business_id and b.product_id=oi.product_uuid and b.is_active
        ),'[]'::jsonb)
      ) order by oi.created_at,oi.id)
      from public.order_items oi where oi.order_id=v_session.order_id
    ),'[]'::jsonb),
    'scans',coalesce((
      select jsonb_agg(jsonb_build_object(
        'scan_key',ps.scan_key,
        'gtin',b.gtin,
        'product_id',ps.product_id,
        'unit_factor',ps.unit_factor,
        'created_at',ps.created_at,
        'reverted_at',ps.reverted_at
      ) order by ps.created_at,ps.id)
      from public.order_packing_scans ps
      join public.product_barcodes b on b.id=ps.barcode_id
      where ps.session_id=v_session.id
    ),'[]'::jsonb)
  );
end;
$$;


ALTER FUNCTION "public"."get_packing_manifest"("p_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_production_operation_center"("p_business_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_result jsonb;
begin
  if not public.has_business_role(p_business_id,array['owner','admin','staff']) then
    raise exception 'operador no autorizado' using errcode='42501';
  end if;
  perform public.refresh_operational_alerts(p_business_id);
  select jsonb_build_object(
    'generated_at',clock_timestamp(),
    'business_id',p_business_id,
    'metrics',jsonb_build_object(
      'new_orders',(select count(*) from public.orders o where o.business_id=p_business_id and o.status in ('submitted','received') and o.created_at>=clock_timestamp()-interval '24 hours'),
      'delayed_orders',(select count(*) from public.orders o where o.business_id=p_business_id and o.status not in ('delivered','canceled','cancelled','rejected') and coalesce(o.acknowledged_at,o.created_at)+make_interval(mins=>coalesce(o.preparation_estimate_minutes,30))<clock_timestamp()),
      'pending_payments',(select count(*) from public.payment_intents pi where pi.business_id=p_business_id and pi.internal_status in ('created','preference_creating','preference_created','redirected','pending','in_process')),
      'payments_in_review',(select count(*) from public.payment_intents pi where pi.business_id=p_business_id and pi.internal_status in ('ambiguous','security_review_required','approved_order_pending')),
      'orders_without_stock',(select count(*) from public.checkout_sessions cs where cs.business_id=p_business_id and cs.status='manual_review_required' and coalesce(cs.manual_review_reason,'') like '%reservation%'),
      'packing_incomplete',(select count(*) from public.order_packing_sessions ps where ps.business_id=p_business_id and ps.status in ('not_started','in_progress','complete','exception_required')),
      'active_deliveries',(select count(*) from public.orders o where o.business_id=p_business_id and o.status in ('assigned','picked_up','on_the_way','arrived')),
      'riders_without_signal',(select count(*) from public.operational_alerts a where a.business_id=p_business_id and a.alert_code='RIDER_SIGNAL_STALE' and a.status<>'resolved'),
      'fiscal_documents_pending',(select count(*) from public.fiscal_documents fd where fd.business_id=p_business_id and (fd.state in ('draft','queued','claiming','authenticating','authorizing','ambiguous','retry_wait','failed') or (fd.state='authorized' and fd.artifact_state<>'artifact_ready'))),
      'failed_prints',(select count(*) from public.fiscal_print_jobs pj where pj.business_id=p_business_id and pj.status in ('failed','unknown')),
      'pending_credit_notes',(select count(*) from public.fiscal_documents fd where fd.business_id=p_business_id and fd.document_intent='credit_note' and (fd.state<>'authorized' or fd.artifact_state<>'artifact_ready')),
      'blocked_outboxes',(
        (select count(*) from public.payment_outbox po join public.payment_intents pi on pi.id=po.payment_intent_id where pi.business_id=p_business_id and po.status in ('failed','dead_letter'))
        +(select count(*) from public.fiscal_outbox fo join public.fiscal_documents fd on fd.id=fo.fiscal_document_id where fd.business_id=p_business_id and fo.state='dead_letter')
        +(select count(*) from public.fiscal_artifact_outbox fao join public.fiscal_documents fd on fd.id=fao.fiscal_document_id where fd.business_id=p_business_id and fao.state='dead_letter')
      ),
      'reconciliations_required',(
        (select count(*) from public.payment_intents pi where pi.business_id=p_business_id and pi.internal_status in ('ambiguous','security_review_required','approved_order_pending'))
        +(select count(*) from public.payment_refunds pr join public.payment_intents pi on pi.id=pr.payment_intent_id where pi.business_id=p_business_id and pr.status='ambiguous')
        +(select count(*) from public.payment_cancellations pc join public.payment_intents pi on pi.id=pc.payment_intent_id where pi.business_id=p_business_id and pc.status='ambiguous')
        +(select count(*) from public.fiscal_documents fd where fd.business_id=p_business_id and fd.state='ambiguous')
      )
    ),
    'alerts',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'severity',a.severity,'code',a.alert_code,'status',a.status,
      'summary',a.summary,'required_action',a.required_action,
      'subject_type',a.subject_type,'subject_id',a.subject_id,
      'correlation_id',a.correlation_id,'last_seen_at',a.last_seen_at,
      'occurrence_count',a.occurrence_count
    ) order by case a.severity when 'CRITICAL' then 1 when 'ACTION_REQUIRED' then 2 when 'WARNING' then 3 else 4 end,a.last_seen_at desc)
      from public.operational_alerts a where a.business_id=p_business_id and a.status<>'resolved'),'[]'::jsonb),
    'recent_closures',coalesce((select jsonb_agg(to_jsonb(r) order by r.business_date desc)
      from (select id,business_date,status,revision,declared_cash,expected_cash,cash_difference,difference_note,open_alerts,critical_alerts,snapshot_sha256,prepared_at,closed_at
        from public.daily_reconciliations where business_id=p_business_id order by business_date desc limit 14) r),'[]'::jsonb),
    'health',public.build_operational_health(p_business_id)
  ) into v_result;
  return v_result;
end;
$$;


ALTER FUNCTION "public"."get_production_operation_center"("p_business_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_production_operation_center"("p_business_id" "uuid") IS 'Estado autoritativo del Centro de operacion, ahora con la salud operativa medida en el mismo viaje.';



CREATE OR REPLACE FUNCTION "public"."get_public_business_contact"("p_business_id" "uuid") RETURNS TABLE("whatsapp_phone" "text", "whatsapp_verified" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
  select
    regexp_replace(b.whatsapp_phone, '[^0-9]', '', 'g'),
    true
  from public.businesses b
  where b.id = p_business_id
    and b.is_active = true
    and b.whatsapp_verified = true
    and b.whatsapp_verified_at is not null
    and b.whatsapp_verified_by is not null
    and char_length(
      regexp_replace(coalesce(b.whatsapp_phone, ''), '[^0-9]', '', 'g')
    ) between 8 and 15
  limit 1;
$$;


ALTER FUNCTION "public"."get_public_business_contact"("p_business_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_public_business_contact"("p_business_id" "uuid") IS 'Returns the normalized contact only for an active business with a complete server-authoritative verification stamp; otherwise returns no rows.';



CREATE OR REPLACE FUNCTION "public"."get_public_order_tracking"("p_public_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_token_hash bytea := public.request_order_token_hash();
  v_order public.orders%rowtype;
  v_location jsonb;
  v_reliable_eta boolean := false;
begin
  if v_token_hash is null or btrim(coalesce(p_public_id, '')) = '' then return null; end if;
  select o.* into v_order
    from public.orders o join public.order_public_tokens opt on opt.order_id = o.id
   where (o.id::text = btrim(p_public_id) or o.public_code = btrim(p_public_id))
     and opt.token_hash = v_token_hash and opt.revoked_at is null and opt.expires_at > clock_timestamp()
   limit 1;
  if not found then return null; end if;
  v_reliable_eta :=
    v_order.status not in ('delivered', 'canceled', 'cancelled', 'rejected')
    and v_order.estimated_arrival_source in ('business', 'routing')
    and v_order.estimated_arrival_updated_at >= clock_timestamp() - interval '15 minutes'
    and v_order.estimated_arrival_updated_at <= clock_timestamp() + interval '30 seconds'
    and v_order.estimated_arrival_at > clock_timestamp();
  if v_order.status in ('picked_up', 'on_the_way', 'arrived')
    and v_order.delivery_mode = 'delivery'
    and v_order.assigned_rider_user_id is not null then
    select jsonb_build_object(
        'lat', round(rl.lat::numeric, 4),
        'lng', round(rl.lng::numeric, 4),
        'accuracy', greatest(100, ceil(rl.accuracy))::integer,
        'source', 'gps',
        'created_at', rl.created_at,
        'captured_at', coalesce(rl.captured_at, rl.created_at))
      into v_location from public.rider_locations rl
     where rl.order_id = v_order.id and rl.rider_user_id = v_order.assigned_rider_user_id and rl.source = 'gps'
       and rl.accuracy between 0 and 250
       and coalesce(rl.captured_at, rl.created_at) >= clock_timestamp() - interval '3 minutes'
     order by coalesce(rl.captured_at, rl.created_at) desc, rl.receipt_sequence desc limit 1;
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'public_code', v_order.public_code, 'delivery_mode', v_order.delivery_mode,
    'status', v_order.status, 'revision', v_order.revision,
    'created_at', v_order.created_at, 'updated_at', v_order.updated_at,
    'accepted_at', v_order.accepted_at, 'preparing_at', v_order.preparing_at,
    'ready_at', v_order.ready_at, 'dispatched_at', coalesce(v_order.dispatched_at, v_order.picked_up_at),
    'arrived_at', v_order.arrived_at, 'delivered_at', v_order.delivered_at,
    'cancelled_at', coalesce(v_order.cancelled_at, v_order.canceled_at),
    'rejected_at', v_order.rejected_at, 'is_delivered', v_order.status = 'delivered',
    'estimated_arrival_at', case when v_reliable_eta then v_order.estimated_arrival_at else null end,
    'estimated_arrival_source', case when v_reliable_eta then v_order.estimated_arrival_source else null end,
    'estimated_arrival_updated_at', case when v_reliable_eta then v_order.estimated_arrival_updated_at else null end,
    'estimated_minutes', case when v_reliable_eta then greatest(1, ceil(extract(epoch from (v_order.estimated_arrival_at - clock_timestamp())) / 60.0))::integer else null end,
    'rider_location', v_location
  ));
end;
$$;


ALTER FUNCTION "public"."get_public_order_tracking"("p_public_id" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_public_order_tracking"("p_public_id" "text") IS 'DTO minimo tokenizado: solo snapshot actual del rider asignado, con secuencia, freshness y ventana terminal acotada.';



CREATE OR REPLACE FUNCTION "public"."get_rider_queue"("p_business_id" "uuid") RETURNS TABLE("order_id" "uuid", "public_code" "text", "business_name" "text", "pickup_summary" "text", "delivery_summary" "text", "status" "text", "revision" bigint, "collection_amount" numeric, "payment_method" "text", "item_count" integer, "estimated_minutes" integer, "ready_at" timestamp with time zone, "business_location" "jsonb", "customer_location" "jsonb")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'private', 'extensions', 'pg_temp'
    AS $$
begin
  perform public.rider_require_active_membership(p_business_id);

  return query
  select
    o.id,
    o.public_code,
    b.name,
    b.address,
    nullif(btrim(o.customer_neighborhood), ''),
    o.status,
    o.revision,
    case when o.payment_method = 'cash' then o.total else null end,
    o.payment_method,
    greatest(1, coalesce((
      select sum(oi.quantity)::integer
        from public.order_items oi
       where oi.order_id = o.id
    ), 0)),
    case
      when o.estimated_arrival_source in ('business', 'routing')
       and o.estimated_arrival_updated_at >= statement_timestamp() - interval '15 minutes'
       and o.estimated_arrival_updated_at <= statement_timestamp() + interval '30 seconds'
       and o.estimated_arrival_at > statement_timestamp()
      then greatest(1, ceil(extract(epoch from (o.estimated_arrival_at - statement_timestamp())) / 60.0))::integer
      else null
    end,
    o.ready_at,
    loc.payload->'business_location',
    null::jsonb
  from public.orders o
  join public.businesses b on b.id = o.business_id
  cross join lateral private.rider_map_location_payload(o.id, false) as loc(payload)
  where o.business_id = p_business_id
    and o.delivery_mode = 'delivery'
    and o.status = 'ready'
    and o.assigned_rider_user_id is null
    and o.origin = 'production'
  order by o.ready_at nulls last, o.created_at
  limit 50;
end;
$$;


ALTER FUNCTION "public"."get_rider_queue"("p_business_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_rider_queue"("p_business_id" "uuid") IS 'Active Rider queue with authorized business coordinates only; customer coordinates remain null before claim.';



CREATE OR REPLACE FUNCTION "public"."get_scanned_product_readiness"("p_product_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_product public.products%rowtype;
  v_barcode boolean;
  v_image boolean;
  v_details boolean;
begin
  select * into v_product from public.products where id = p_product_id;
  if not found then
    raise exception 'producto inexistente' using errcode = 'P0002';
  end if;
  if not public.has_business_role(v_product.business_id, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;

  v_barcode := exists (
    select 1 from public.product_barcodes pb
     where pb.product_id = v_product.id and pb.is_active
  );
  v_image := v_product.catalog_asset_id is not null
    and nullif(btrim(coalesce(v_product.image_url, '')), '') is not null;
  v_details := nullif(btrim(coalesce(v_product.brand, '')), '') is not null
    and nullif(btrim(coalesce(v_product.variant, '')), '') is not null
    and coalesce(v_product.capacity_value, 0) > 0
    and coalesce(v_product.units_per_pack, 0) > 0;

  return jsonb_build_object(
    'product_id', v_product.id,
    'details_complete', v_details,
    'barcode_bound', v_barcode,
    'image_bound', v_image,
    'price_status', v_product.price_status,
    'stock_positive', coalesce(v_product.stock, 0) > 0,
    'published', coalesce(v_product.is_verified, false),
    'visible', v_details and v_barcode and v_image and coalesce(v_product.is_verified, false),
    'purchasable', coalesce(v_product.available, false)
      and v_product.price_status = 'confirmed'
      and coalesce(v_product.stock, 0) > 0
  );
end;
$$;


ALTER FUNCTION "public"."get_scanned_product_readiness"("p_product_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."gtin_check_digit_valid"("p_gtin" "text") RETURNS boolean
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
declare
  v_sum integer := 0;
  v_weight integer := 3;
  v_index integer;
  v_expected integer;
begin
  if p_gtin !~ '^[0-9]+$' or length(p_gtin) not in (8,12,13,14) then return false; end if;
  for v_index in reverse length(p_gtin)-1..1 loop
    v_sum := v_sum + substr(p_gtin,v_index,1)::integer * v_weight;
    v_weight := case when v_weight=3 then 1 else 3 end;
  end loop;
  v_expected := (10-(v_sum%10))%10;
  return substr(p_gtin,length(p_gtin),1)::integer=v_expected;
end;
$_$;


ALTER FUNCTION "public"."gtin_check_digit_valid"("p_gtin" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_business_role"("target_business_id" "uuid", "roles" "text"[]) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select coalesce(
    public.identity_member_role(target_business_id) = any (coalesce(roles, array[]::text[])),
    false
  )
$$;


ALTER FUNCTION "public"."has_business_role"("target_business_id" "uuid", "roles" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."identity_accept_invitation"("p_token" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_user uuid := auth.uid();
  v_email text := lower(btrim(coalesce(public.identity_jwt_claims() ->> 'email', '')));
  v_hash text;
  v_inv public.identity_invitations%rowtype;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;
  if public.identity_is_anonymous() then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;
  if coalesce(btrim(p_token), '') = '' then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;

  if v_email = '' then
    select lower(btrim(u.email)) into v_email from auth.users u where u.id = v_user;
  end if;

  v_hash := encode(digest(btrim(p_token), 'sha256'), 'hex');

  select * into v_inv
    from public.identity_invitations i
   where i.token_hash = v_hash
   for update;

  if not found
     or v_inv.accepted_at is not null
     or v_inv.revoked_at is not null
     or v_inv.expires_at <= now() then
    -- Un solo codigo para inexistente, usada, retirada y vencida.
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;

  if v_email is null or v_email <> v_inv.invited_email then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;

  perform set_config('taba.identity_write', 'on', true);

  insert into public.business_members (business_id, user_id, role, is_active)
  values (v_inv.business_id, v_user, v_inv.invited_role, true)
  on conflict (business_id, user_id) do update
     set role = excluded.role,
         is_active = true;

  insert into public.identity_user_security (business_id, user_id)
  values (v_inv.business_id, v_user)
  on conflict (business_id, user_id) do nothing;

  if v_inv.invited_role = 'rider' then
    insert into public.rider_profiles (business_id, user_id, full_name, created_by)
    values (v_inv.business_id, v_user, v_inv.full_name, v_inv.invited_by)
    on conflict (business_id, user_id) do update
       set full_name = excluded.full_name, status = 'active';
  else
    insert into public.staff_profiles (business_id, user_id, full_name, created_by)
    values (v_inv.business_id, v_user, v_inv.full_name, v_inv.invited_by)
    on conflict (business_id, user_id) do update
       set full_name = excluded.full_name, status = 'active';
  end if;

  update public.identity_invitations
     set accepted_at = now(), accepted_user_id = v_user
   where id = v_inv.id;

  perform set_config('taba.identity_write', 'off', true);

  perform public.identity_record_audit_event(
    p_event_type => 'invitation_accepted',
    p_business_id => v_inv.business_id,
    p_actor_user_id => v_user,
    p_actor_role => v_inv.invited_role,
    p_subject_user_id => v_user,
    p_session_id => public.identity_session_id(),
    p_metadata => jsonb_build_object('invitation_id', v_inv.id, 'role', v_inv.invited_role)
  );

  return jsonb_build_object(
    'ok', true,
    'business_id', v_inv.business_id,
    'role', v_inv.invited_role
  );
end;
$$;


ALTER FUNCTION "public"."identity_accept_invitation"("p_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."identity_assert_can_administer_member"("p_business_id" "uuid", "p_target_user_id" "uuid", "p_permission" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_actor_role text := public.identity_require_permission(p_business_id, p_permission);
  v_target_role text;
begin
  select bm.role into v_target_role
    from public.business_members bm
   where bm.business_id = p_business_id
     and bm.user_id = p_target_user_id;

  if v_target_role is null then
    raise exception 'identity: la persona no pertenece al comercio'
      using errcode = 'no_data_found';
  end if;

  if v_actor_role = 'admin' and v_target_role in ('owner', 'admin') then
    raise exception 'identity: no autorizado'
      using errcode = 'insufficient_privilege';
  end if;

  return jsonb_build_object('actor_role', v_actor_role, 'target_role', v_target_role);
end;
$$;


ALTER FUNCTION "public"."identity_assert_can_administer_member"("p_business_id" "uuid", "p_target_user_id" "uuid", "p_permission" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."identity_assert_profile_role"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_expected text := case tg_table_name
                       when 'staff_profiles' then 'staff'
                       when 'rider_profiles' then 'rider'
                     end;
  v_role text;
begin
  select bm.role into v_role
    from public.business_members bm
   where bm.business_id = new.business_id
     and bm.user_id = new.user_id;

  if v_role is null then
    raise exception 'identity: no hay membresia para el perfil'
      using errcode = 'check_violation';
  end if;

  -- owner y admin tambien operan el Panel, asi que comparten el perfil de staff.
  if v_expected = 'staff' and v_role not in ('owner', 'admin', 'staff') then
    raise exception 'identity: el perfil de staff exige un rol de Panel, no %', v_role
      using errcode = 'check_violation';
  end if;

  if v_expected = 'rider' and v_role <> 'rider' then
    raise exception 'identity: el perfil de Rider exige rol rider, no %', v_role
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."identity_assert_profile_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."identity_audit_is_append_only"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  raise exception 'identity: la auditoria es solo de agregado (% no permitido)', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;


ALTER FUNCTION "public"."identity_audit_is_append_only"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."identity_close_own_session"("p_business_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_user uuid := auth.uid();
  v_session uuid := public.identity_session_id();
  v_role text;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  select bm.role into v_role
    from public.business_members bm
   where bm.business_id = p_business_id
     and bm.user_id = v_user;

  if v_session is not null then
    update public.identity_sessions
       set revoked_at = now(),
           revoked_by = v_user,
           revoked_reason = 'self_logout'
     where session_id = v_session
       and user_id = v_user
       and revoked_at is null;

    perform public.identity_kill_auth_session(v_session);

    perform public.identity_record_audit_event(
      p_event_type => 'session_closed',
      p_business_id => p_business_id,
      p_actor_user_id => v_user,
      p_actor_role => v_role,
      p_subject_user_id => v_user,
      p_session_id => v_session
    );
  end if;

  return jsonb_build_object('ok', true, 'code', 'closed');
end;
$$;


ALTER FUNCTION "public"."identity_close_own_session"("p_business_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."identity_count_active_owners"("p_business_id" "uuid") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select count(*)::integer
    from public.business_members bm
    left join public.identity_user_security us
      on us.business_id = bm.business_id and us.user_id = bm.user_id
   where bm.business_id = p_business_id
     and bm.role = 'owner'
     and bm.is_active
     and us.disabled_at is null
$$;


ALTER FUNCTION "public"."identity_count_active_owners"("p_business_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."identity_create_invitation"("p_business_id" "uuid", "p_email" "text", "p_role" "text", "p_full_name" "text", "p_valid_for" interval DEFAULT '7 days'::interval) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
declare
  v_actor uuid := auth.uid();
  v_actor_role text := public.identity_require_permission(p_business_id, 'identity.invite');
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_role text := lower(btrim(coalesce(p_role, '')));
  v_name text := btrim(coalesce(p_full_name, ''));
  v_token text;
  v_hash text;
  v_id uuid;
  v_valid interval := greatest(interval '1 hour', least(coalesce(p_valid_for, interval '7 days'), interval '30 days'));
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_email');
  end if;
  if v_role not in ('owner', 'admin', 'staff', 'rider') then
    return jsonb_build_object('ok', false, 'code', 'invalid_role');
  end if;
  if length(v_name) < 2 or length(v_name) > 120 then
    return jsonb_build_object('ok', false, 'code', 'invalid_name');
  end if;

  -- Un admin opera, no arma la conduccion: solo puede invitar staff y riders.
  -- Crear otro owner o otro admin es un acto del owner.
  if v_actor_role = 'admin' and v_role not in ('staff', 'rider') then
    return jsonb_build_object('ok', false, 'code', 'role_above_actor');
  end if;

  if exists (
    select 1
      from public.business_members bm
      join auth.users u on u.id = bm.user_id
     where bm.business_id = p_business_id
       and lower(btrim(u.email)) = v_email
       and bm.is_active = true
  ) then
    return jsonb_build_object('ok', false, 'code', 'already_member');
  end if;

  if exists (
    select 1
      from public.identity_invitations i
     where i.business_id = p_business_id
       and i.invited_email = v_email
       and i.accepted_at is null
       and i.revoked_at is null
       and i.expires_at > now()
  ) then
    return jsonb_build_object('ok', false, 'code', 'invitation_pending');
  end if;

  -- Las invitaciones vencidas del mismo correo no bloquean: se retiran.
  update public.identity_invitations
     set revoked_at = now(), revoked_by = v_actor
   where business_id = p_business_id
     and invited_email = v_email
     and accepted_at is null
     and revoked_at is null;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_hash := encode(digest(v_token, 'sha256'), 'hex');

  insert into public.identity_invitations (
    business_id, invited_email, invited_role, full_name, token_hash,
    invited_by, invited_by_role, expires_at
  ) values (
    p_business_id, v_email, v_role, v_name, v_hash,
    v_actor, v_actor_role, now() + v_valid
  )
  returning id into v_id;

  perform public.identity_record_audit_event(
    p_event_type => 'member_invited',
    p_business_id => p_business_id,
    p_actor_user_id => v_actor,
    p_actor_role => v_actor_role,
    p_session_id => public.identity_session_id(),
    p_metadata => jsonb_build_object(
      'invitation_id', v_id,
      'invited_role', v_role,
      -- El correo no se guarda entero en la auditoria: alcanza el dominio para
      -- reconocer de que alta se trata.
      'email_domain', split_part(v_email, '@', 2)
    )
  );

  -- Unica vez que el token existe en claro. Quien llama lo entrega por el
  -- canal que corresponda; la base ya no lo tiene.
  return jsonb_build_object(
    'ok', true,
    'invitation_id', v_id,
    'token', v_token,
    'expires_at', now() + v_valid,
    'invited_role', v_role
  );
end;
$_$;


ALTER FUNCTION "public"."identity_create_invitation"("p_business_id" "uuid", "p_email" "text", "p_role" "text", "p_full_name" "text", "p_valid_for" interval) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."identity_current_context"("p_business_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'business_id', p_business_id,
    'role', public.identity_member_role(p_business_id),
    'session_id', public.identity_session_id(),
    'is_anonymous', public.identity_is_anonymous(),
    'permissions', coalesce((
      select jsonb_agg(rp.permission order by rp.permission)
        from public.identity_role_permissions rp
       where rp.role = public.identity_member_role(p_business_id)
    ), '[]'::jsonb)
  )
$$;


ALTER FUNCTION "public"."identity_current_context"("p_business_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."identity_guard_membership_write"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_is_local_admin boolean;
begin
  -- Las RPC de identidad marcan la transaccion antes de escribir.
  if coalesce(current_setting('taba.identity_write', true), '') = 'on' then
    return coalesce(new, old);
  end if;

  -- Tareas de plataforma con clave de servicio. Ahora si se puede evaluar.
  if current_user = 'service_role' then
    return coalesce(new, old);
  end if;

  -- Migraciones, semillas y fixtures por conexion directa.
  select coalesce(bool_or(r.rolsuper), false) or session_user in ('postgres', 'supabase_admin')
    into v_is_local_admin
    from pg_catalog.pg_roles r
   where r.rolname = session_user;

  if v_is_local_admin then
    return coalesce(new, old);
  end if;

  raise exception 'identity: las membresias se administran por RPC de identidad'
    using errcode = 'insufficient_privilege';
end;
$$;


ALTER FUNCTION "public"."identity_guard_membership_write"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."identity_has_permission"("target_business_id" "uuid", "target_permission" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select exists (
    select 1
      from public.identity_role_permissions rp
     where rp.role = public.identity_member_role(target_business_id)
       and rp.permission = target_permission
  )
$$;


ALTER FUNCTION "public"."identity_has_permission"("target_business_id" "uuid", "target_permission" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."identity_is_anonymous"() RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select coalesce((public.identity_jwt_claims() ->> 'is_anonymous')::boolean, false)
$$;


ALTER FUNCTION "public"."identity_is_anonymous"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."identity_jwt_claims"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_raw text := nullif(current_setting('request.jwt.claims', true), '');
begin
  if v_raw is null then
    return null;
  end if;
  return v_raw::jsonb;
exception
  when others then
    -- Un claim ilegible se trata como ausencia de claim, nunca como permiso.
    return null;
end;
$$;


ALTER FUNCTION "public"."identity_jwt_claims"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."identity_kill_auth_session"("p_session_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
begin
  if p_session_id is null or to_regclass('auth.sessions') is null then
    return false;
  end if;
  execute 'delete from auth.sessions where id = $1' using p_session_id;
  return true;
exception
  when insufficient_privilege or undefined_table then
    return false;
end;
$_$;


ALTER FUNCTION "public"."identity_kill_auth_session"("p_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."identity_kill_auth_sessions_for_user"("p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
begin
  if p_user_id is null or to_regclass('auth.sessions') is null then
    return false;
  end if;
  execute 'delete from auth.sessions where user_id = $1' using p_user_id;
  return true;
exception
  when insufficient_privilege or undefined_table then
    return false;
end;
$_$;


ALTER FUNCTION "public"."identity_kill_auth_sessions_for_user"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."identity_list_audit_events"("p_business_id" "uuid", "p_limit" integer DEFAULT 100) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 500));
begin
  perform public.identity_require_permission(p_business_id, 'audit.read');
  return coalesce((
    select jsonb_agg(evento order by seq)
      from (
        select row_number() over (order by a.occurred_at desc, a.id desc) as seq,
               jsonb_build_object(
                 'occurred_at', a.occurred_at,
                 'event_type', a.event_type,
                 'actor_user_id', a.actor_user_id,
                 'actor_role', a.actor_role,
                 'subject_user_id', a.subject_user_id,
                 'session_id', a.session_id,
                 'metadata', a.metadata
               ) as evento
          from public.identity_audit_events a
         where a.business_id = p_business_id
         order by a.occurred_at desc, a.id desc
         limit v_limit
      ) ultimos
  ), '[]'::jsonb);
end;
$$;


ALTER FUNCTION "public"."identity_list_audit_events"("p_business_id" "uuid", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."identity_list_invitations"("p_business_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  perform public.identity_require_permission(p_business_id, 'identity.members.read');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'invitation_id', i.id,
             'invited_email', i.invited_email,
             'invited_role', i.invited_role,
             'full_name', i.full_name,
             'created_at', i.created_at,
             'expires_at', i.expires_at,
             'status', case
                         when i.accepted_at is not null then 'accepted'
                         when i.revoked_at is not null then 'revoked'
                         when i.expires_at <= now() then 'expired'
                         else 'pending'
                       end
           ) order by i.created_at desc)
      from public.identity_invitations i
     where i.business_id = p_business_id
  ), '[]'::jsonb);
end;
$$;


ALTER FUNCTION "public"."identity_list_invitations"("p_business_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."identity_list_members"("p_business_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  perform public.identity_require_permission(p_business_id, 'identity.members.read');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'user_id', bm.user_id,
             'role', bm.role,
             'is_active', bm.is_active,
             'full_name', coalesce(sp.full_name, rp.full_name),
             'profile_status', coalesce(sp.status, rp.status),
             'vehicle_kind', rp.vehicle_kind,
             'disabled_at', us.disabled_at,
             'sessions_valid_from', nullif(us.sessions_valid_from, '-infinity'::timestamptz),
             'active_sessions', (
               select count(*)
                 from public.identity_sessions s
                where s.user_id = bm.user_id
                  and s.business_id = bm.business_id
                  and s.revoked_at is null
             ),
             'member_since', bm.created_at
           ) order by
             case bm.role when 'owner' then 0 when 'admin' then 1 when 'staff' then 2 else 3 end,
             coalesce(sp.full_name, rp.full_name, ''))
      from public.business_members bm
      left join public.staff_profiles sp
        on sp.business_id = bm.business_id and sp.user_id = bm.user_id
      left join public.rider_profiles rp
        on rp.business_id = bm.business_id and rp.user_id = bm.user_id
      left join public.identity_user_security us
        on us.business_id = bm.business_id and us.user_id = bm.user_id
     where bm.business_id = p_business_id
  ), '[]'::jsonb);
end;
$$;


ALTER FUNCTION "public"."identity_list_members"("p_business_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."identity_list_sessions"("p_business_id" "uuid", "p_user_id" "uuid" DEFAULT NULL::"uuid", "p_include_revoked" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  perform public.identity_require_permission(p_business_id, 'identity.sessions.read');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'session_id', s.session_id,
             'user_id', s.user_id,
             'full_name', coalesce(sp.full_name, rp.full_name),
             'role_at_login', s.role_at_login,
             'client', s.client,
             'device_label', s.device_label,
             'app_version', s.app_version,
             'first_seen_at', s.first_seen_at,
             'last_seen_at', s.last_seen_at,
             'revoked_at', s.revoked_at,
             'revoked_reason', s.revoked_reason
           ) order by s.last_seen_at desc)
      from public.identity_sessions s
      left join public.staff_profiles sp
        on sp.business_id = s.business_id and sp.user_id = s.user_id
      left join public.rider_profiles rp
        on rp.business_id = s.business_id and rp.user_id = s.user_id
     where s.business_id = p_business_id
       and (p_user_id is null or s.user_id = p_user_id)
       and (coalesce(p_include_revoked, false) or s.revoked_at is null)
  ), '[]'::jsonb);
end;
$$;


ALTER FUNCTION "public"."identity_list_sessions"("p_business_id" "uuid", "p_user_id" "uuid", "p_include_revoked" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."identity_member_role"("target_business_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_valid_from timestamptz;
  v_disabled timestamptz;
  v_session uuid;
  v_revoked timestamptz;
  v_issued timestamptz;
begin
  if v_user is null or target_business_id is null then
    return null;
  end if;

  if public.identity_is_anonymous() then
    return null;
  end if;

  select bm.role into v_role
    from public.business_members bm
   where bm.business_id = target_business_id
     and bm.user_id = v_user
     and bm.is_active = true;

  if v_role is null then
    return null;
  end if;

  select s.sessions_valid_from, s.disabled_at
    into v_valid_from, v_disabled
    from public.identity_user_security s
   where s.business_id = target_business_id
     and s.user_id = v_user;

  if v_disabled is not null then
    return null;
  end if;

  v_valid_from := coalesce(v_valid_from, '-infinity'::timestamptz);

  v_session := public.identity_session_id();
  if v_session is not null then
    select ise.revoked_at into v_revoked
      from public.identity_sessions ise
     where ise.session_id = v_session;
    if v_revoked is not null then
      return null;
    end if;
  end if;

  if v_valid_from > '-infinity'::timestamptz then
    v_issued := public.identity_token_issued_at();
    -- Un token que no se puede fechar no puede demostrar que es posterior al
    -- corte. Con un corte vigente, eso es un no.
    if v_issued is null or v_issued < v_valid_from then
      return null;
    end if;
  end if;

  return v_role;
end;
$$;


ALTER FUNCTION "public"."identity_member_role"("target_business_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."identity_record_audit_event"("p_event_type" "text", "p_business_id" "uuid" DEFAULT NULL::"uuid", "p_actor_user_id" "uuid" DEFAULT NULL::"uuid", "p_actor_role" "text" DEFAULT NULL::"text", "p_subject_user_id" "uuid" DEFAULT NULL::"uuid", "p_session_id" "uuid" DEFAULT NULL::"uuid", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  insert into public.identity_audit_events (
    business_id, actor_user_id, actor_role, subject_user_id, session_id, event_type, metadata
  ) values (
    p_business_id,
    p_actor_user_id,
    p_actor_role,
    p_subject_user_id,
    p_session_id,
    p_event_type,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;


ALTER FUNCTION "public"."identity_record_audit_event"("p_event_type" "text", "p_business_id" "uuid", "p_actor_user_id" "uuid", "p_actor_role" "text", "p_subject_user_id" "uuid", "p_session_id" "uuid", "p_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."identity_register_session"("p_business_id" "uuid", "p_client" "text" DEFAULT 'unknown'::"text", "p_device_label" "text" DEFAULT NULL::"text", "p_device_key_hash" "text" DEFAULT NULL::"text", "p_app_version" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_user uuid := auth.uid();
  v_role text := public.identity_member_role(p_business_id);
  v_session uuid := public.identity_session_id();
  v_client text := coalesce(nullif(btrim(p_client), ''), 'unknown');
  v_inserted boolean := false;
begin
  if v_user is null or v_role is null then
    -- Misma respuesta para "no hay sesion", "no sos del equipo", "estas dado
    -- de baja" y "tu sesion esta revocada". El cliente no necesita el motivo y
    -- el atacante tampoco.
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  if v_client not in ('rider_android', 'panel_web', 'unknown') then
    v_client := 'unknown';
  end if;

  if v_session is null then
    -- Token sin claim de sesion (por ejemplo una llamada con clave de
    -- servicio). No hay nada que registrar y tampoco es un error.
    return jsonb_build_object('ok', true, 'code', 'no_session_claim', 'role', v_role);
  end if;

  insert into public.identity_sessions as ise (
    session_id, user_id, business_id, role_at_login, client,
    device_label, device_key_hash, app_version
  ) values (
    v_session, v_user, p_business_id, v_role, v_client,
    nullif(btrim(p_device_label), ''),
    lower(nullif(btrim(p_device_key_hash), '')),
    nullif(btrim(p_app_version), '')
  )
  on conflict (session_id) do update
     set last_seen_at = now(),
         role_at_login = excluded.role_at_login,
         device_label = coalesce(excluded.device_label, ise.device_label),
         device_key_hash = coalesce(excluded.device_key_hash, ise.device_key_hash),
         app_version = coalesce(excluded.app_version, ise.app_version)
   where ise.revoked_at is null
  returning (xmax = 0) into v_inserted;

  if v_inserted is null then
    -- El ON CONFLICT no actualizo nada: la fila existe y esta revocada.
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  if v_inserted then
    perform public.identity_record_audit_event(
      p_event_type => 'session_opened',
      p_business_id => p_business_id,
      p_actor_user_id => v_user,
      p_actor_role => v_role,
      p_subject_user_id => v_user,
      p_session_id => v_session,
      p_metadata => jsonb_build_object('client', v_client, 'app_version', nullif(btrim(p_app_version), ''))
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'registered',
    'role', v_role,
    'session_id', v_session,
    'new_session', v_inserted
  );
end;
$$;


ALTER FUNCTION "public"."identity_register_session"("p_business_id" "uuid", "p_client" "text", "p_device_label" "text", "p_device_key_hash" "text", "p_app_version" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."identity_require_permission"("target_business_id" "uuid", "target_permission" "text") RETURNS "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_role text := public.identity_member_role(target_business_id);
begin
  if v_role is null or not exists (
    select 1
      from public.identity_role_permissions rp
     where rp.role = v_role
       and rp.permission = target_permission
  ) then
    raise exception 'identity: no autorizado'
      using errcode = 'insufficient_privilege';
  end if;
  return v_role;
end;
$$;


ALTER FUNCTION "public"."identity_require_permission"("target_business_id" "uuid", "target_permission" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."identity_revoke_all_sessions"("p_business_id" "uuid", "p_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_check jsonb;
  v_revoked integer := 0;
  v_killed boolean := false;
begin
  if p_user_id = v_actor then
    v_actor_role := public.identity_member_role(p_business_id);
    if v_actor_role is null then
      return jsonb_build_object('ok', false, 'code', 'not_authorized');
    end if;
  else
    v_check := public.identity_assert_can_administer_member(
      p_business_id, p_user_id, 'identity.sessions.revoke');
    v_actor_role := v_check ->> 'actor_role';
  end if;

  insert into public.identity_user_security (business_id, user_id)
  values (p_business_id, p_user_id)
  on conflict (business_id, user_id) do nothing;

  update public.identity_user_security
     set sessions_valid_from = now()
   where business_id = p_business_id and user_id = p_user_id;

  update public.identity_sessions
     set revoked_at = now(), revoked_by = v_actor, revoked_reason = 'revoke_all'
   where business_id = p_business_id
     and user_id = p_user_id
     and revoked_at is null;
  get diagnostics v_revoked = row_count;

  v_killed := public.identity_kill_auth_sessions_for_user(p_user_id);

  perform public.identity_record_audit_event(
    p_event_type => 'sessions_revoked_all',
    p_business_id => p_business_id,
    p_actor_user_id => v_actor,
    p_actor_role => v_actor_role,
    p_subject_user_id => p_user_id,
    p_session_id => public.identity_session_id(),
    p_metadata => jsonb_build_object('sessions_revoked', v_revoked, 'auth_sessions_killed', v_killed)
  );

  return jsonb_build_object('ok', true, 'sessions_revoked', v_revoked);
end;
$$;


ALTER FUNCTION "public"."identity_revoke_all_sessions"("p_business_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."identity_revoke_invitation"("p_invitation_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_actor uuid := auth.uid();
  v_inv public.identity_invitations%rowtype;
  v_actor_role text;
begin
  select * into v_inv from public.identity_invitations where id = p_invitation_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  v_actor_role := public.identity_require_permission(v_inv.business_id, 'identity.invite');

  if v_inv.accepted_at is not null then
    return jsonb_build_object('ok', false, 'code', 'already_accepted');
  end if;
  if v_actor_role = 'admin' and v_inv.invited_role not in ('staff', 'rider') then
    return jsonb_build_object('ok', false, 'code', 'role_above_actor');
  end if;

  update public.identity_invitations
     set revoked_at = coalesce(revoked_at, now()), revoked_by = coalesce(revoked_by, v_actor)
   where id = p_invitation_id;

  perform public.identity_record_audit_event(
    p_event_type => 'invitation_revoked',
    p_business_id => v_inv.business_id,
    p_actor_user_id => v_actor,
    p_actor_role => v_actor_role,
    p_session_id => public.identity_session_id(),
    p_metadata => jsonb_build_object('invitation_id', v_inv.id, 'invited_role', v_inv.invited_role)
  );

  return jsonb_build_object('ok', true);
end;
$$;


ALTER FUNCTION "public"."identity_revoke_invitation"("p_invitation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."identity_revoke_session"("p_session_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_actor uuid := auth.uid();
  v_session public.identity_sessions%rowtype;
  v_check jsonb;
  v_actor_role text;
begin
  select * into v_session from public.identity_sessions where session_id = p_session_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  -- Cerrar la propia sesion no exige permiso de administracion.
  if v_session.user_id = v_actor then
    v_actor_role := public.identity_member_role(v_session.business_id);
  else
    v_check := public.identity_assert_can_administer_member(
      v_session.business_id, v_session.user_id, 'identity.sessions.revoke');
    v_actor_role := v_check ->> 'actor_role';
  end if;

  if v_session.revoked_at is not null then
    return jsonb_build_object('ok', true, 'code', 'already_revoked');
  end if;

  update public.identity_sessions
     set revoked_at = now(),
         revoked_by = v_actor,
         revoked_reason = case when v_session.user_id = v_actor then 'self_logout' else 'owner_revoked' end
   where session_id = p_session_id;

  perform public.identity_kill_auth_session(p_session_id);

  perform public.identity_record_audit_event(
    p_event_type => 'session_revoked',
    p_business_id => v_session.business_id,
    p_actor_user_id => v_actor,
    p_actor_role => v_actor_role,
    p_subject_user_id => v_session.user_id,
    p_session_id => p_session_id,
    p_metadata => jsonb_build_object('client', v_session.client, 'device_label', v_session.device_label)
  );

  return jsonb_build_object('ok', true, 'code', 'revoked');
end;
$$;


ALTER FUNCTION "public"."identity_revoke_session"("p_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."identity_session_id"() RETURNS "uuid"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_value text := public.identity_jwt_claims() ->> 'session_id';
begin
  if v_value is null or v_value = '' then
    return null;
  end if;
  return v_value::uuid;
exception
  when others then
    return null;
end;
$$;


ALTER FUNCTION "public"."identity_session_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."identity_set_member_active"("p_business_id" "uuid", "p_user_id" "uuid", "p_is_active" boolean, "p_reason" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_actor uuid := auth.uid();
  v_check jsonb := public.identity_assert_can_administer_member(
    p_business_id, p_user_id, 'identity.members.write');
  v_actor_role text := v_check ->> 'actor_role';
  v_target_role text := v_check ->> 'target_role';
  v_revoked integer := 0;
  v_killed boolean := false;
begin
  if p_is_active is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_state');
  end if;

  if not p_is_active
     and v_target_role = 'owner'
     and public.identity_count_active_owners(p_business_id) <= 1 then
    return jsonb_build_object('ok', false, 'code', 'last_owner');
  end if;

  perform set_config('taba.identity_write', 'on', true);
  update public.business_members
     set is_active = p_is_active
   where business_id = p_business_id
     and user_id = p_user_id;
  perform set_config('taba.identity_write', 'off', true);

  insert into public.identity_user_security (business_id, user_id)
  values (p_business_id, p_user_id)
  on conflict (business_id, user_id) do nothing;

  if p_is_active then
    update public.identity_user_security
       set disabled_at = null, disabled_by = null, disabled_reason = null
     where business_id = p_business_id and user_id = p_user_id;
    update public.staff_profiles set status = 'active'
     where business_id = p_business_id and user_id = p_user_id;
    update public.rider_profiles set status = 'active'
     where business_id = p_business_id and user_id = p_user_id;
  else
    update public.identity_user_security
       set disabled_at = now(),
           disabled_by = v_actor,
           disabled_reason = nullif(btrim(coalesce(p_reason, '')), ''),
           -- Corte por fecha: aunque exista un token de una sesion que nunca
           -- se registro, queda del lado viejo de la linea.
           sessions_valid_from = now()
     where business_id = p_business_id and user_id = p_user_id;
    update public.staff_profiles set status = 'suspended'
     where business_id = p_business_id and user_id = p_user_id;
    update public.rider_profiles set status = 'suspended'
     where business_id = p_business_id and user_id = p_user_id;

    update public.identity_sessions
       set revoked_at = now(), revoked_by = v_actor, revoked_reason = 'member_disabled'
     where business_id = p_business_id
       and user_id = p_user_id
       and revoked_at is null;
    get diagnostics v_revoked = row_count;

    v_killed := public.identity_kill_auth_sessions_for_user(p_user_id);
  end if;

  perform public.identity_record_audit_event(
    p_event_type => case when p_is_active then 'member_activated' else 'member_disabled' end,
    p_business_id => p_business_id,
    p_actor_user_id => v_actor,
    p_actor_role => v_actor_role,
    p_subject_user_id => p_user_id,
    p_session_id => public.identity_session_id(),
    p_metadata => jsonb_build_object(
      'target_role', v_target_role,
      'sessions_revoked', v_revoked,
      'auth_sessions_killed', v_killed,
      'reason', nullif(btrim(coalesce(p_reason, '')), '')
    )
  );

  return jsonb_build_object('ok', true, 'is_active', p_is_active, 'sessions_revoked', v_revoked);
end;
$$;


ALTER FUNCTION "public"."identity_set_member_active"("p_business_id" "uuid", "p_user_id" "uuid", "p_is_active" boolean, "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."identity_set_member_role"("p_business_id" "uuid", "p_user_id" "uuid", "p_role" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_actor uuid := auth.uid();
  v_role text := lower(btrim(coalesce(p_role, '')));
  v_actor_role text;
  v_target_role text;
  v_check jsonb;
  v_revoked integer := 0;
begin
  if v_role not in ('owner', 'admin', 'staff', 'rider') then
    return jsonb_build_object('ok', false, 'code', 'invalid_role');
  end if;

  -- Otorgar owner o admin es un acto de conduccion: exige identity.roles.write,
  -- que solo tiene el owner. Mover a alguien entre staff y rider alcanza con
  -- identity.members.write.
  v_check := public.identity_assert_can_administer_member(
    p_business_id,
    p_user_id,
    case when v_role in ('owner', 'admin') then 'identity.roles.write' else 'identity.members.write' end
  );
  v_actor_role := v_check ->> 'actor_role';
  v_target_role := v_check ->> 'target_role';

  if v_target_role = v_role then
    return jsonb_build_object('ok', true, 'code', 'unchanged', 'role', v_role);
  end if;

  if v_target_role = 'owner' and v_role <> 'owner'
     and public.identity_count_active_owners(p_business_id) <= 1 then
    return jsonb_build_object('ok', false, 'code', 'last_owner');
  end if;

  perform set_config('taba.identity_write', 'on', true);
  update public.business_members
     set role = v_role
   where business_id = p_business_id
     and user_id = p_user_id;
  perform set_config('taba.identity_write', 'off', true);

  -- El perfil sigue al rol: quien pasa a Rider no conserva su ficha de Panel.
  if v_role = 'rider' then
    delete from public.staff_profiles where business_id = p_business_id and user_id = p_user_id;
    insert into public.rider_profiles (business_id, user_id, full_name, created_by)
    select p_business_id, p_user_id,
           coalesce((select sp.full_name from public.staff_profiles sp
                      where sp.business_id = p_business_id and sp.user_id = p_user_id), 'Sin nombre'),
           v_actor
    on conflict (business_id, user_id) do update set status = 'active';
  else
    delete from public.rider_profiles where business_id = p_business_id and user_id = p_user_id;
    insert into public.staff_profiles (business_id, user_id, full_name, created_by)
    select p_business_id, p_user_id,
           coalesce((select rp.full_name from public.rider_profiles rp
                      where rp.business_id = p_business_id and rp.user_id = p_user_id), 'Sin nombre'),
           v_actor
    on conflict (business_id, user_id) do update set status = 'active';
  end if;

  -- Un cambio de rol invalida las sesiones abiertas: la persona vuelve a
  -- entrar y su cliente descarga los permisos nuevos desde cero.
  update public.identity_sessions
     set revoked_at = now(), revoked_by = v_actor, revoked_reason = 'role_changed'
   where business_id = p_business_id
     and user_id = p_user_id
     and revoked_at is null;
  get diagnostics v_revoked = row_count;

  perform public.identity_kill_auth_sessions_for_user(p_user_id);

  perform public.identity_record_audit_event(
    p_event_type => 'member_role_changed',
    p_business_id => p_business_id,
    p_actor_user_id => v_actor,
    p_actor_role => v_actor_role,
    p_subject_user_id => p_user_id,
    p_session_id => public.identity_session_id(),
    p_metadata => jsonb_build_object('from', v_target_role, 'to', v_role, 'sessions_revoked', v_revoked)
  );

  return jsonb_build_object('ok', true, 'role', v_role, 'sessions_revoked', v_revoked);
end;
$$;


ALTER FUNCTION "public"."identity_set_member_role"("p_business_id" "uuid", "p_user_id" "uuid", "p_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."identity_token_issued_at"() RETURNS timestamp with time zone
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_value text := public.identity_jwt_claims() ->> 'iat';
begin
  if v_value is null or v_value = '' then
    return null;
  end if;
  return to_timestamp(v_value::double precision);
exception
  when others then
    return null;
end;
$$;


ALTER FUNCTION "public"."identity_token_issued_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."identity_touch_session"("p_business_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_role text := public.identity_member_role(p_business_id);
  v_session uuid := public.identity_session_id();
begin
  if v_role is null then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if v_session is not null then
    update public.identity_sessions
       set last_seen_at = now()
     where session_id = v_session
       and revoked_at is null;
  end if;
  return jsonb_build_object('ok', true, 'role', v_role);
end;
$$;


ALTER FUNCTION "public"."identity_touch_session"("p_business_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."import_catalog_batch"("p_business_id" "uuid", "p_assets" "jsonb", "p_products" "jsonb") RETURNS TABLE("product_id" "uuid", "staged_external_id" "text", "staged_sku" "text", "staged_is_verified" boolean, "staged_available" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."import_catalog_batch"("p_business_id" "uuid", "p_assets" "jsonb", "p_products" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."import_catalog_batch"("p_business_id" "uuid", "p_assets" "jsonb", "p_products" "jsonb") IS 'Atomic owner/admin catalog import: asset registration and fail-closed product staging commit or roll back together.';



CREATE OR REPLACE FUNCTION "public"."import_qa_fixture_catalog"("p_business_id" "uuid", "p_origin" "text", "p_assets" "jsonb", "p_products" "jsonb") RETURNS TABLE("product_id" "uuid", "imported_external_id" "text", "imported_sku" "text", "catalog_origin" "text", "rights_status" "text", "is_verified" boolean, "available" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
declare
  v_asset jsonb;
  v_product jsonb;
  v_origin text := lower(btrim(coalesce(p_origin, '')));
  v_asset_count integer;
  v_product_count integer;
  v_external_id text;
  v_sku text;
  v_safe_sku text;
  v_asset_id uuid;
  v_product_id uuid;
  v_asset_source_url text;
  v_asset_rights_reference text;
  v_tags text[];
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can import staging QA fixtures.';
  end if;

  if v_origin not in ('demo_fixture', 'test_only', 'staging_only') then
    raise exception 'QA origin must be demo_fixture, test_only or staging_only.';
  end if;
  if p_assets is null or jsonb_typeof(p_assets) is distinct from 'array'
     or p_products is null or jsonb_typeof(p_products) is distinct from 'array' then
    raise exception 'QA assets and products must be JSON arrays.';
  end if;

  v_asset_count := jsonb_array_length(p_assets);
  v_product_count := jsonb_array_length(p_products);
  if v_asset_count < 1 or v_asset_count > 10
     or v_product_count < 1 or v_product_count > 10
     or v_asset_count <> v_product_count then
    raise exception 'QA import must contain 1 to 10 matching assets and products.';
  end if;

  if (
    select count(distinct value ->> 'external_id')
      from jsonb_array_elements(p_assets)
  ) <> v_asset_count
  or (
    select count(distinct value ->> 'sku')
      from jsonb_array_elements(p_assets)
  ) <> v_asset_count
  or (
    select count(distinct value ->> 'external_id')
      from jsonb_array_elements(p_products)
  ) <> v_product_count
  or (
    select count(distinct value ->> 'sku')
      from jsonb_array_elements(p_products)
  ) <> v_product_count then
    raise exception 'QA import contains duplicate identities.';
  end if;

  if exists (
    with asset_ids as (
      select value ->> 'external_id' as external_id,
             value ->> 'sku' as sku
        from jsonb_array_elements(p_assets)
    ), product_ids as (
      select value ->> 'external_id' as external_id,
             value ->> 'sku' as sku
        from jsonb_array_elements(p_products)
    )
    select external_id, sku from asset_ids
    except
    select external_id, sku from product_ids
  ) or exists (
    with asset_ids as (
      select value ->> 'external_id' as external_id,
             value ->> 'sku' as sku
        from jsonb_array_elements(p_assets)
    ), product_ids as (
      select value ->> 'external_id' as external_id,
             value ->> 'sku' as sku
        from jsonb_array_elements(p_products)
    )
    select external_id, sku from product_ids
    except
    select external_id, sku from asset_ids
  ) then
    raise exception 'QA assets and products must have identical identities.';
  end if;

  for v_asset, v_product in
    select assets.value, products.value
      from jsonb_array_elements(p_assets) with ordinality as assets(value, ordinal)
      join jsonb_array_elements(p_products) with ordinality as products(value, ordinal)
        on products.ordinal = assets.ordinal
  loop
    v_external_id := btrim(coalesce(v_asset ->> 'external_id', ''));
    v_sku := btrim(coalesce(v_asset ->> 'sku', ''));
    v_safe_sku := btrim(coalesce(v_asset ->> 'safe_sku', ''));
    if v_external_id = '' or v_sku = '' or v_safe_sku !~ '^[a-z0-9_-]{1,80}$' then
      raise exception 'Invalid QA asset identity for %.', v_external_id;
    end if;
    if btrim(coalesce(v_product ->> 'external_id', '')) <> v_external_id
       or btrim(coalesce(v_product ->> 'sku', '')) <> v_sku then
      raise exception 'QA asset/product identity mismatch for %.', v_external_id;
    end if;

    v_asset_source_url := btrim(coalesce(v_asset ->> 'source_url', ''));
    v_asset_rights_reference := btrim(coalesce(v_asset ->> 'rights_reference', ''));
    if lower(v_asset_source_url) <>
       'https://staging.qa.taba.invalid/' || v_origin || '/' || v_safe_sku
       or lower(btrim(coalesce(v_asset ->> 'rights_status', ''))) <> 'unapproved_qa'
       or v_asset_rights_reference <> 'qa_fixture:' || v_origin || ':' || v_safe_sku then
      raise exception 'QA asset % must carry the unapproved fixture provenance.', v_external_id;
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
      master_width,
      master_height,
      thumbnail_path,
      thumbnail_sha256,
      thumbnail_binding_sha256,
      thumbnail_width,
      thumbnail_height,
      source_sha256,
      source_url,
      rights_status,
      rights_reference,
      catalog_origin,
      approved_at,
      approved_by,
      updated_at
    ) values (
      p_business_id,
      v_external_id,
      v_sku,
      v_safe_sku,
      lower(btrim(v_asset ->> 'identity_sha256')),
      btrim(v_asset ->> 'master_path'),
      lower(btrim(v_asset ->> 'master_sha256')),
      lower(btrim(v_asset ->> 'master_binding_sha256')),
      coalesce((v_asset ->> 'master_width')::integer, 1000),
      coalesce((v_asset ->> 'master_height')::integer, 1000),
      btrim(v_asset ->> 'thumbnail_path'),
      lower(btrim(v_asset ->> 'thumbnail_sha256')),
      lower(btrim(v_asset ->> 'thumbnail_binding_sha256')),
      coalesce((v_asset ->> 'thumbnail_width')::integer, 400),
      coalesce((v_asset ->> 'thumbnail_height')::integer, 400),
      lower(btrim(v_asset ->> 'source_sha256')),
      v_asset_source_url,
      'UNAPPROVED_QA',
      v_asset_rights_reference,
      v_origin,
      null,
      null,
      statement_timestamp()
    )
    on conflict (business_id, external_id) do update
      set sku = excluded.sku,
          safe_sku = excluded.safe_sku,
          identity_sha256 = excluded.identity_sha256,
          master_path = excluded.master_path,
          master_sha256 = excluded.master_sha256,
          master_binding_sha256 = excluded.master_binding_sha256,
          master_width = excluded.master_width,
          master_height = excluded.master_height,
          thumbnail_path = excluded.thumbnail_path,
          thumbnail_sha256 = excluded.thumbnail_sha256,
          thumbnail_binding_sha256 = excluded.thumbnail_binding_sha256,
          thumbnail_width = excluded.thumbnail_width,
          thumbnail_height = excluded.thumbnail_height,
          source_sha256 = excluded.source_sha256,
          source_url = excluded.source_url,
          rights_status = excluded.rights_status,
          rights_reference = excluded.rights_reference,
          catalog_origin = excluded.catalog_origin,
          approved_at = null,
          approved_by = null,
          updated_at = statement_timestamp()
    returning id into v_asset_id;

    select coalesce(array_agg(value order by value), '{}'::text[])
      into v_tags
      from jsonb_array_elements_text(coalesce(v_product -> 'tags', '[]'::jsonb));

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
      catalog_origin,
      updated_at
    ) values (
      p_business_id,
      v_external_id,
      v_sku,
      btrim(v_product ->> 'brand'),
      btrim(v_product ->> 'name'),
      nullif(btrim(coalesce(v_product ->> 'description', '')), ''),
      btrim(v_product ->> 'category'),
      btrim(v_product ->> 'subcategory'),
      btrim(v_product ->> 'variant'),
      btrim(v_product ->> 'variant'),
      (v_product ->> 'capacity_value')::numeric,
      lower(btrim(v_product ->> 'capacity_unit')),
      (v_product ->> 'capacity_value')::text || ' ' || lower(btrim(v_product ->> 'capacity_unit')),
      btrim(v_product ->> 'packaging_type'),
      (v_product ->> 'units_per_pack')::integer,
      (v_product ->> 'price')::numeric,
      (v_product ->> 'stock')::integer,
      (v_product ->> 'chilled')::boolean,
      (v_product ->> 'is_alcoholic')::boolean,
      nullif(v_product ->> 'minimum_age', '')::integer,
      (v_product ->> 'sort_order')::integer,
      btrim(v_product ->> 'image_url'),
      lower(btrim(v_product ->> 'image_sha256')),
      btrim(v_product ->> 'image_thumbnail_url'),
      lower(btrim(v_product ->> 'image_thumbnail_sha256')),
      lower(btrim(v_product ->> 'source_image_sha256')),
      v_asset_id,
      v_tags,
      coalesce((v_product ->> 'is_active')::boolean, true),
      false,
      false,
      null,
      null,
      v_origin,
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
          catalog_origin = excluded.catalog_origin,
          updated_at = statement_timestamp()
    returning id into v_product_id;

    product_id := v_product_id;
    imported_external_id := v_external_id;
    imported_sku := v_sku;
    catalog_origin := v_origin;
    rights_status := 'UNAPPROVED_QA';
    is_verified := false;
    available := false;
    return next;
  end loop;
end;
$_$;


ALTER FUNCTION "public"."import_qa_fixture_catalog"("p_business_id" "uuid", "p_origin" "text", "p_assets" "jsonb", "p_products" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."import_qa_fixture_catalog"("p_business_id" "uuid", "p_origin" "text", "p_assets" "jsonb", "p_products" "jsonb") IS 'STAGING ONLY: owner/admin import of 1-10 repository fixtures with UNAPPROVED_QA rights.';



CREATE OR REPLACE FUNCTION "public"."is_assigned_rider"("target_order_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select exists (
    select 1
      from public.orders o
     where o.id = target_order_id
       and o.assigned_rider_user_id = auth.uid()
       and public.identity_member_role(o.business_id) = 'rider'
  )
$$;


ALTER FUNCTION "public"."is_assigned_rider"("target_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_business_member"("target_business_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select public.identity_member_role(target_business_id) is not null
$$;


ALTER FUNCTION "public"."is_business_member"("target_business_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."issue_order_delivery_code"("p_order_id" "uuid", "p_tracking_token" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
declare
  v_order public.orders%rowtype;
  v_token public.order_public_tokens%rowtype;
  v_handoff public.order_delivery_handoffs%rowtype;
  v_random bytea;
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if p_order_id is null
    or p_tracking_token is null
    or p_tracking_token !~ '^[A-Za-z0-9_-]{32,255}[A-Za-z0-9_-]?$' then
    raise exception 'credenciales de entrega invalidas' using errcode = '22023';
  end if;

  select o.*
    into v_order
    from public.orders o
   where o.id = p_order_id
     and o.customer_user_id = auth.uid()
   for update;

  if not found then
    raise exception 'pedido no encontrado o acceso denegado' using errcode = '42501';
  end if;
  if v_order.delivery_mode <> 'delivery' then
    raise exception 'codigo no requerido para retiro' using errcode = '22023';
  end if;
  if v_order.status in ('delivered', 'canceled', 'cancelled', 'rejected') then
    raise exception 'pedido terminal' using errcode = '55000';
  end if;

  select opt.*
    into v_token
    from public.order_public_tokens opt
   where opt.order_id = v_order.id
     and opt.token_hash = digest(p_tracking_token, 'sha256')
     and opt.revoked_at is null
     and opt.expires_at > clock_timestamp()
   limit 1;

  if not found then
    raise exception 'token de seguimiento invalido' using errcode = '42501';
  end if;

  select h.*
    into v_handoff
    from public.order_delivery_handoffs h
   where h.order_id = v_order.id
   for update;

  if found then
    if v_handoff.expires_at <= clock_timestamp() then
      raise exception 'codigo de entrega vencido' using errcode = '55000';
    end if;
    return jsonb_build_object(
      'delivery_code',
      pgp_sym_decrypt(v_handoff.code_ciphertext, p_tracking_token),
      'expires_at',
      v_handoff.expires_at
    );
  end if;

  v_random := gen_random_bytes(3);
  v_code := (
    1000 + (
      get_byte(v_random, 0)::bigint * 65536
      + get_byte(v_random, 1)::bigint * 256
      + get_byte(v_random, 2)::bigint
    ) % 9000
  )::text;

  insert into public.order_delivery_handoffs (
    order_id,
    code_hash,
    code_ciphertext,
    expires_at
  ) values (
    v_order.id,
    crypt(v_code, gen_salt('bf', 10)),
    pgp_sym_encrypt(v_code, p_tracking_token, 'cipher-algo=aes256,compress-algo=0'),
    least(v_token.expires_at, clock_timestamp() + interval '48 hours')
  )
  returning * into v_handoff;

  return jsonb_build_object(
    'delivery_code', v_code,
    'expires_at', v_handoff.expires_at
  );
end;
$_$;


ALTER FUNCTION "public"."issue_order_delivery_code"("p_order_id" "uuid", "p_tracking_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."kick_payment_outbox_worker"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  perform public.dispatch_payment_outbox_worker('outbox');
  return null;
exception when others then
  -- Never roll back a durable receipt/job because the best-effort immediate
  -- kick failed. The cron recovery path remains authoritative.
  return null;
end;
$$;


ALTER FUNCTION "public"."kick_payment_outbox_worker"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."kick_scheduler_watchdog"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  perform public.check_scheduler_watchdog('order_traffic');
  return null;
exception when others then
  -- Un pedido REAL no se cae nunca por una comprobación de salud.
  return null;
end;
$$;


ALTER FUNCTION "public"."kick_scheduler_watchdog"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."kick_scheduler_watchdog"() IS 'Comprueba la salud del planificador cuando entra un pedido. Nunca hace fallar la insercion: si algo sale mal, se traga el error.';



CREATE OR REPLACE FUNCTION "public"."list_active_business_riders"("p_business_id" "uuid") RETURNS TABLE("rider_user_id" "uuid", "display_name" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
begin
  if auth.uid() is null
    or p_business_id is null
    or not public.has_business_role(
      p_business_id,
      array['owner', 'admin', 'staff']
    ) then
    raise exception 'rol de negocio requerido' using errcode = '42501';
  end if;

  return query
  select
    bm.user_id,
    left(
      coalesce(
        nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''),
        nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
        'Rider ' || upper(right(bm.user_id::text, 8))
      ),
      80
    )
  from public.business_members bm
  left join auth.users u on u.id = bm.user_id
  where bm.business_id = p_business_id
    and bm.role = 'rider'
    and bm.is_active = true
  order by 2, bm.user_id
  limit 100;
end;
$$;


ALTER FUNCTION "public"."list_active_business_riders"("p_business_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."list_active_business_riders"("p_business_id" "uuid") IS 'Minimal active-rider directory authorized for the business assignment surface.';



CREATE OR REPLACE FUNCTION "public"."list_available_rider_orders"("p_business_id" "uuid") RETURNS TABLE("public_code" "text", "general_zone" "text", "pickup_branch" "text", "approximate_packages" integer, "payment_method" "text", "collection_amount" numeric, "estimated_minutes" integer, "operational_restrictions" "text", "revision" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
  select
    o.public_code,
    nullif(btrim(o.customer_neighborhood), ''),
    b.address,
    greatest(
      1,
      ceil(coalesce(sum(oi.quantity), 0)::numeric / 3.0)
    )::integer,
    o.payment_method,
    case when o.payment_method = 'cash' then o.total else null end,
    case
      when o.estimated_arrival_source in ('business', 'routing')
       and o.estimated_arrival_updated_at >= statement_timestamp() - interval '15 minutes'
       and o.estimated_arrival_updated_at <= statement_timestamp() + interval '30 seconds'
       and o.estimated_arrival_at > statement_timestamp()
      then greatest(
        1,
        ceil(extract(epoch from (o.estimated_arrival_at - statement_timestamp())) / 60.0)
      )::integer
      else null
    end,
    case
      when o.age_confirmation_policy is not null
        then 'Verificar mayoría de edad al entregar'
      else null
    end,
    o.revision
  from public.orders o
  join public.businesses b on b.id = o.business_id
  left join public.order_items oi on oi.order_id = o.id
  where o.business_id = p_business_id
    and public.has_business_role(p_business_id, array['rider'])
    and o.delivery_mode = 'delivery'
    and o.status = 'ready'
    and o.assigned_rider_user_id is null
    and o.origin = 'production'
  group by o.id, b.address
  order by o.ready_at nulls last, o.created_at
  limit 50
$$;


ALTER FUNCTION "public"."list_available_rider_orders"("p_business_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_business_combos"("p_business_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
  select coalesce(jsonb_agg(
           public.resolve_business_combo(c.business_id, c.combo_id, 1)
           order by c.sort_order, c.combo_id
         ), '[]'::jsonb)
    from public.product_combos c
   where c.business_id = p_business_id
     and c.is_active
     and c.approval_status = 'APROBADO_COMERCIAL';
$$;


ALTER FUNCTION "public"."list_business_combos"("p_business_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."list_business_combos"("p_business_id" "uuid") IS 'Góndola de combos aprobados con precio, ahorro y stock derivados del catálogo vivo.';



CREATE OR REPLACE FUNCTION "public"."list_business_payments"("p_business_id" "uuid") RETURNS SETOF "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_actor uuid := auth.uid();
  v_can_operate boolean;
begin
  if v_actor is null or not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'pagos no autorizados' using errcode = '42501';
  end if;
  v_can_operate := public.has_business_role(p_business_id, array['owner', 'admin']);
  return query
  select jsonb_build_object(
    'payment_intent_id', pi.id,
    'checkout_session_id', pi.checkout_session_id,
    'order_id', pi.order_id,
    'order_public_code', o.public_code,
    'customer_label', case
      when nullif(btrim(coalesce(o.customer_name, cs.contact_snapshot ->> 'customer_name', '')), '') is null then null
      else left(btrim(coalesce(o.customer_name, cs.contact_snapshot ->> 'customer_name', '')), 1) || '.'
    end,
    'amount', coalesce(pi.paid_amount, pi.expected_amount),
    'currency', pi.currency,
    'method', pi.provider_payment_method,
    'provider_status', pi.provider_status,
    'provider_status_detail', public.sanitize_payment_diagnostic(pi.provider_status_detail),
    'internal_status', pi.internal_status,
    'security_review_reason', case when pi.internal_status = 'security_review_required' then pi.security_review_reason else null end,
    'created_at', pi.created_at,
    'approved_at', pi.approved_at,
    'last_update_at', greatest(pi.updated_at, coalesce(worker.updated_at, pi.updated_at), coalesce(attempts.last_attempt_at, pi.updated_at)),
    'attempt_count', coalesce(attempts.attempt_count, 0),
    'last_attempt_at', attempts.last_attempt_at,
    'payment_id_short', case when pi.provider_payment_id is null then null else right(pi.provider_payment_id, 6) end,
    'refunded_amount', pi.refunded_amount,
    'latest_refund_status', refund.status,
    'dispute_type', dispute.dispute_type,
    'dispute_status', dispute.status,
    'documentation_required', coalesce(dispute.documentation_required, false),
    'reservation_state', case
      when exists (
        select 1 from public.inventory_reservations r
         where r.checkout_session_id = pi.checkout_session_id
           and r.status = 'active' and r.expires_at > clock_timestamp()
      ) then 'active'
      when exists (
        select 1 from public.inventory_reservations r
         where r.checkout_session_id = pi.checkout_session_id
           and r.expires_at <= clock_timestamp()
      ) then 'expired'
      else 'none'
    end,
    'processing_state', case
      when pi.internal_status in ('completed', 'refunded', 'partially_refunded', 'rejected', 'cancelled', 'expired', 'charged_back') then 'Procesamiento normal'
      when worker.status in ('failed', 'dead_letter') then 'Requiere atenci�n'
      when worker.status in ('claimed', 'processing') and coalesce(worker.lease_expires_at, '-infinity'::timestamptz) < clock_timestamp() then 'Sin progreso'
      when worker.status in ('pending', 'retry_wait') and worker.next_attempt_at > clock_timestamp() then 'Reintento programado'
      when worker.status in ('pending', 'retry_wait') then 'Procesamiento demorado'
      when pi.updated_at < clock_timestamp() - interval '15 minutes' then 'Sin progreso'
      else 'Procesamiento normal'
    end,
    'worker_status', worker.status,
    'worker_attempts', coalesce(worker.attempts, 0),
    'worker_next_attempt_at', worker.next_attempt_at,
    'worker_lease_expires_at', worker.lease_expires_at,
    'worker_last_error', public.sanitize_payment_diagnostic(worker.last_error),
    'correlation_id', 'pay_' || right(replace(pi.id::text, '-', ''), 12),
    'can_operate', v_can_operate,
    -- Alcanza con poder preguntarle al proveedor. Se habilita tambi�n sobre
    -- `expired` y `security_review_required`, que son exactamente los estados
    -- donde hace falta ir a mirar si hubo un cobro.
    'can_reconcile', v_can_operate
      and (pi.provider_payment_id is not null or nullif(btrim(coalesce(pi.external_reference, '')), '') is not null)
      and pi.internal_status not in ('completed', 'refunded', 'partially_refunded', 'charged_back'),
    'can_refund', v_can_operate and pi.provider_payment_id is not null and (
      (pi.order_id is not null and pi.internal_status in ('completed', 'partially_refunded'))
      or (pi.order_id is null and pi.internal_status = 'security_review_required' and pi.security_review_reason in ('approved_after_reservation_expired', 'finalization_without_active_reservation'))
    ) and dispute.id is null,
    'can_cancel', v_can_operate and pi.provider_payment_id is not null and pi.internal_status in ('pending', 'in_process'),
    -- Rearmar el pedido de un cobro que entr�: la salida que faltaba cuando la
    -- reserva venci� y la �nica alternativa era devolver el dinero.
    'can_recover_order', v_can_operate and public.can_recover_paid_checkout(pi.id)
  )
  from public.payment_intents pi
  left join public.checkout_sessions cs on cs.id = pi.checkout_session_id
  left join public.orders o on o.id = pi.order_id
  left join lateral (
    select r.status
      from public.payment_refunds r
     where r.payment_intent_id = pi.id
     order by r.requested_at desc
     limit 1
  ) refund on true
  left join lateral (
    select d.id, d.dispute_type, d.status, d.documentation_required
      from public.payment_disputes d
     where d.payment_intent_id = pi.id and d.resolved_at is null
     order by d.created_at desc
     limit 1
  ) dispute on true
  left join lateral (
    select count(*)::integer as attempt_count, max(pa.updated_at) as last_attempt_at
      from public.payment_attempts pa
     where pa.payment_intent_id = pi.id
  ) attempts on true
  left join lateral (
    select po.status, po.attempts, po.next_attempt_at, po.lease_expires_at, po.last_error, po.updated_at
      from public.payment_outbox po
     where po.payment_intent_id = pi.id and po.topic in ('payment', 'payment_reconcile')
     order by po.created_at desc
     limit 1
  ) worker on true
  where pi.business_id = p_business_id
  order by pi.created_at desc
  limit 200;
end;
$$;


ALTER FUNCTION "public"."list_business_payments"("p_business_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."list_business_payments"("p_business_id" "uuid") IS 'Consulta de pagos con estados humanos. can_reconcile se habilita tambi�n sobre expired y revisi�n de seguridad.';



CREATE OR REPLACE FUNCTION "public"."list_fiscal_document_artifacts"("p_business_id" "uuid") RETURNS TABLE("fiscal_document_id" "uuid", "artifact_id" "uuid", "artifact_type" "text", "artifact_state" "text", "mime_type" "text", "size_bytes" bigint, "sha256" "text", "document_number" bigint, "generated_at" timestamp with time zone, "generation_version" "text", "is_current" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  return query
  select a.fiscal_document_id, a.id, a.artifact_type, d.artifact_state, a.mime_type, a.size_bytes,
         a.sha256, a.document_number, a.generated_at, a.generation_version, a.is_current
  from public.fiscal_document_artifacts a
  join public.fiscal_documents d on d.id = a.fiscal_document_id
  where a.business_id = p_business_id and a.is_current
  order by a.generated_at desc;
end;
$$;


ALTER FUNCTION "public"."list_fiscal_document_artifacts"("p_business_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_operational_pipeline"("p_business_id" "uuid", "p_include_qa" boolean DEFAULT false) RETURNS TABLE("kind" "text", "reference_id" "uuid", "public_code" "text", "pipeline_state" "text", "origin" "text", "payment_method" "text", "delivery_mode" "text", "total" numeric, "customer_name" "text", "needs_manual_review" boolean, "revision" bigint, "occurred_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  -- La unión va envuelta: `order by` no puede resolver los nombres de los
  -- parámetros de salida de una función `returns table`.
  select
    pipeline.kind,
    pipeline.reference_id,
    pipeline.public_code,
    pipeline.pipeline_state,
    pipeline.origin,
    pipeline.payment_method,
    pipeline.delivery_mode,
    pipeline.total,
    pipeline.customer_name,
    pipeline.needs_manual_review,
    pipeline.revision,
    pipeline.occurred_at
  from (
    select
      'order'::text as kind,
      o.id as reference_id,
      o.public_code::text as public_code,
      public.order_pipeline_state(o.status) as pipeline_state,
      o.origin::text as origin,
      o.payment_method::text as payment_method,
      o.delivery_mode::text as delivery_mode,
      o.total as total,
      o.customer_name::text as customer_name,
      false as needs_manual_review,
      o.revision as revision,
      o.created_at as occurred_at
    from public.orders o
    where o.business_id = p_business_id
      and public.has_business_role(p_business_id, array['owner', 'admin', 'staff'])
      and (coalesce(p_include_qa, false) or o.origin = 'production')

    union all

    select
      'checkout'::text,
      s.id,
      null::text,
      public.checkout_pipeline_state(s.status, s.expires_at),
      s.origin::text,
      'mercadopago'::text,
      s.fulfillment_type::text,
      s.total,
      nullif(btrim(coalesce(s.contact_snapshot ->> 'name', '')), '')::text,
      s.status = 'manual_review_required',
      s.revision,
      s.created_at
    from public.checkout_sessions s
    where s.business_id = p_business_id
      and public.has_business_role(p_business_id, array['owner', 'admin', 'staff'])
      and s.completed_order_id is null
      and (coalesce(p_include_qa, false) or s.origin = 'production')
  ) as pipeline
  order by pipeline.occurred_at desc
  limit 200;
$$;


ALTER FUNCTION "public"."list_operational_pipeline"("p_business_id" "uuid", "p_include_qa" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."list_operational_pipeline"("p_business_id" "uuid", "p_include_qa" boolean) IS 'Circuito completo en un vocabulario: checkouts sin pedido y pedidos. Excluye QA salvo pedido explícito.';



CREATE OR REPLACE FUNCTION "public"."list_operational_secret_status"() RETURNS TABLE("name" "text", "configured" boolean, "detail" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
declare
  v_url text;
  v_secret text;
begin
  if to_regclass('vault.decrypted_secrets') is null then
    return query
      select s.name, false, 'la bóveda no está disponible en este entorno'::text
      from (values ('taba_payment_worker_url'), ('taba_payment_worker_hmac_secret')) as s(name);
    return;
  end if;

  execute 'select ds.decrypted_secret from vault.decrypted_secrets ds where ds.name = $1 limit 1'
    into v_url using 'taba_payment_worker_url';
  execute 'select ds.decrypted_secret from vault.decrypted_secrets ds where ds.name = $1 limit 1'
    into v_secret using 'taba_payment_worker_hmac_secret';

  -- De acá para abajo sólo salen booleanos y frases fijas. `v_url` y `v_secret`
  -- se usan para decidir, nunca para devolver.
  return query
  select
    'taba_payment_worker_url'::text,
    nullif(btrim(coalesce(v_url, '')), '') is not null,
    case
      when nullif(btrim(coalesce(v_url, '')), '') is null then 'falta cargarla'
      when v_url !~ '^https://[a-z0-9-]+[.]supabase[.]co/functions/v1/mercadopago-payment-worker$'
        then 'está cargada pero no tiene la forma que el despacho exige'
      else 'cargada y con la forma esperada'
    end::text
  union all
  select
    'taba_payment_worker_hmac_secret'::text,
    nullif(coalesce(v_secret, ''), '') is not null,
    case
      when nullif(coalesce(v_secret, ''), '') is null then 'falta cargarla'
      when length(v_secret) < 32 then 'está cargada pero es más corta que el mínimo exigido'
      else 'cargada y con el largo mínimo'
    end::text;
end;
$_$;


ALTER FUNCTION "public"."list_operational_secret_status"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."list_operational_secret_status"() IS 'Existencia y forma de los secretos operativos. NUNCA devuelve un valor ni un fragmento.';



CREATE OR REPLACE FUNCTION "public"."list_payment_outbox_operational_alerts"() RETURNS TABLE("severity" "text", "correlation_id" "uuid", "observed_at" timestamp with time zone, "state" "text", "action" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select
    case
      when o.status in ('dead_letter', 'failed') then 'critical'
      when o.status in ('claimed', 'processing') then 'high'
      else 'warning'
    end as severity,
    o.id as correlation_id,
    case
      when o.status in ('claimed', 'processing') then o.lease_expires_at
      else o.next_attempt_at
    end as observed_at,
    case
      when o.status = 'dead_letter' then 'payment_outbox_dead_letter'
      when o.status = 'failed' then 'payment_outbox_failed'
      when o.status in ('claimed', 'processing') then 'payment_outbox_lease_expired'
      else 'payment_outbox_delayed'
    end as state,
    case
      when o.status = 'dead_letter' then 'inspect_provider_state_then_queue_authorized_reconciliation'
      when o.status = 'failed' then 'inspect_worker_configuration_and_last_error'
      when o.status in ('claimed', 'processing') then 'allow_cron_to_reclaim_expired_lease'
      else 'verify_cron_and_edge_function_health'
    end as action
  from public.payment_outbox o
  where o.status in ('dead_letter', 'failed')
     or (o.status in ('claimed', 'processing') and o.lease_expires_at < clock_timestamp())
     or (o.status in ('pending', 'retry_wait') and o.next_attempt_at < clock_timestamp() - interval '2 minutes')
  order by
    case when o.status in ('dead_letter', 'failed') then 0 else 1 end,
    observed_at;
$$;


ALTER FUNCTION "public"."list_payment_outbox_operational_alerts"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."list_payment_outbox_operational_alerts"() IS 'Service-only minimal operational alerts for delayed, expired-lease, failed and dead-letter payment work.';



CREATE OR REPLACE FUNCTION "public"."list_scheduler_health"() RETURNS TABLE("job_name" "text", "schedule" "text", "active" boolean, "last_start" timestamp with time zone, "last_status" "text", "last_success_at" timestamp with time zone, "failures_since_success" integer, "last_message" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
begin
  if to_regclass('cron.job') is null or to_regclass('cron.job_run_details') is null then
    return;
  end if;

  return query execute $dynamic$
    select
      j.jobname::text,
      j.schedule::text,
      j.active,
      r.last_start,
      r.last_status,
      r.last_success_at,
      coalesce(r.failures_since_success, 0)::integer,
      r.last_message
    from cron.job j
    left join lateral (
      select
        max(d.start_time) as last_start,
        (array_agg(d.status order by d.start_time desc))[1]::text as last_status,
        max(d.end_time) filter (where d.status = 'succeeded') as last_success_at,
        count(*) filter (
          where d.status = 'failed'
            and d.start_time > coalesce(
              (select max(s.start_time) from cron.job_run_details s
                where s.jobid = j.jobid and s.status = 'succeeded'),
              '-infinity'::timestamptz
            )
        ) as failures_since_success,
        left((array_agg(coalesce(d.return_message, '') order by d.start_time desc))[1], 200) as last_message
      from cron.job_run_details d
      where d.jobid = j.jobid
    ) r on true
    where j.jobname like 'taba-%'
    order by j.jobname
  $dynamic$;
end;
$_$;


ALTER FUNCTION "public"."list_scheduler_health"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."list_scheduler_health"() IS 'Estado de los jobs propios del planificador: ultima corrida, ultimo exito y fallos acumulados desde el ultimo exito.';



CREATE OR REPLACE FUNCTION "public"."list_stock_reservation_alerts"() RETURNS TABLE("severity" "text", "checkout_session_id" "uuid", "product_id" "uuid", "quantity" integer, "expired_for" interval, "state" "text", "action" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select
    case when r.expires_at < clock_timestamp() - interval '30 minutes' then 'critical' else 'warning' end,
    r.checkout_session_id,
    r.product_id,
    r.quantity,
    clock_timestamp() - r.expires_at,
    'stock_reservation_not_released',
    'verify_taba_checkout_expiry_sweep_cron_then_run_sweep_expired_checkout_sessions'
  from public.inventory_reservations r
  where r.status = 'active'
    and r.expires_at < clock_timestamp() - interval '5 minutes'
  order by r.expires_at;
$$;


ALTER FUNCTION "public"."list_stock_reservation_alerts"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."list_stock_reservation_alerts"() IS 'Reservas de stock vencidas y no liberadas: señal de que el barrido no está corriendo.';



CREATE OR REPLACE FUNCTION "public"."list_unfinalized_paid_checkouts"() RETURNS TABLE("severity" "text", "checkout_session_id" "uuid", "pipeline_state" "text", "total" numeric, "stalled_for" interval, "action" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select
    case
      -- Dinero reconocido y sin pedido es critico desde el primer minuto: no
      -- se resuelve solo y hay una persona esperando algo que compro.
      when s.status = 'manual_review_required' then 'critical'
      when s.updated_at < clock_timestamp() - interval '15 minutes' then 'critical'
      else 'high'
    end,
    s.id,
    public.checkout_pipeline_state(s.status, s.expires_at),
    s.total,
    clock_timestamp() - s.updated_at,
    case
      when s.status = 'manual_review_required'
        then 'decide_refund_or_manual_fulfillment_the_money_is_already_in'
      else 'run_finalize_paid_checkout_session_or_inspect_payment_outbox'
    end
  from public.checkout_sessions s
  where s.completed_order_id is null
    and (
      s.status in ('payment_approved', 'finalizing_order')
      or exists (
        select 1
          from public.payment_intents pi
         where pi.checkout_session_id = s.id
           and pi.provider_status = 'approved'
           and pi.internal_status in ('approved_order_pending', 'approved')
      )
      -- El caso que faltaba: el proveedor confirmo el cobro y la finalizacion
      -- quedo bloqueada, sea por reserva vencida o por cualquier otra revision.
      or exists (
        select 1
          from public.payment_intents pi
         where pi.checkout_session_id = s.id
           and pi.provider_status = 'approved'
           and pi.internal_status = 'security_review_required'
      )
    )
    and (
      s.status = 'manual_review_required'
      or s.updated_at < clock_timestamp() - interval '3 minutes'
    )
  order by s.updated_at;
$$;


ALTER FUNCTION "public"."list_unfinalized_paid_checkouts"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."list_unfinalized_paid_checkouts"() IS 'Pagos verificados que no llegaron a pedido, incluida la revision manual: dinero cobrado sin operacion.';



CREATE OR REPLACE FUNCTION "public"."list_webhook_signature_alerts"() RETURNS TABLE("severity" "text", "environment" "text", "rejected_count" bigint, "accepted_count" bigint, "last_rejected_at" timestamp with time zone, "state" "text", "action" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select
    case when count(*) filter (where r.processing_status = 'rejected_signature') > 0
      and count(*) filter (where r.signature_valid) = 0 then 'critical' else 'warning' end,
    r.environment,
    count(*) filter (where r.processing_status = 'rejected_signature'),
    count(*) filter (where r.signature_valid),
    max(r.received_at) filter (where r.processing_status = 'rejected_signature'),
    'webhook_signature_rejected',
    'verificar MERCADOPAGO_WEBHOOK_SECRET contra el panel del proveedor'
  from public.payment_webhook_receipts r
  where r.received_at > clock_timestamp() - interval '24 hours'
  group by r.environment
  having count(*) filter (where r.processing_status = 'rejected_signature') > 0;
$$;


ALTER FUNCTION "public"."list_webhook_signature_alerts"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."list_webhook_signature_alerts"() IS 'Notificaciones cuya firma no valida en las ultimas 24 horas: la via principal de cobro puede estar muerta.';



CREATE OR REPLACE FUNCTION "public"."log_order_status_event"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_actor_user_id uuid := auth.uid();
  v_actor_role text := 'system';
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if v_actor_user_id is not null
      and public.has_business_role(new.business_id, array['owner', 'admin', 'staff']) then
      v_actor_role := 'business';
    elsif v_actor_user_id is not null
      and public.has_business_role(new.business_id, array['rider']) then
      v_actor_role := 'rider';
    elsif v_actor_user_id is not null and new.customer_user_id = v_actor_user_id then
      v_actor_role := 'customer';
    end if;

    insert into public.order_events (
      order_id,
      business_id,
      actor_user_id,
      actor_role,
      actor_type,
      event_type,
      type,
      message,
      metadata,
      payload
    ) values (
      new.id,
      new.business_id,
      v_actor_user_id,
      v_actor_role,
      v_actor_role,
      'order.status_changed',
      'order.status_changed',
      'Estado actualizado de ' || old.status || ' a ' || new.status,
      jsonb_build_object(
        'previous_status', old.status,
        'next_status', new.status,
        'inventory_released',
          new.inventory_released_at is distinct from old.inventory_released_at
      ),
      jsonb_build_object(
        'previous_status', old.status,
        'next_status', new.status,
        'inventory_released',
          new.inventory_released_at is distinct from old.inventory_released_at
      )
    );
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."log_order_status_event"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_delivery_picked_up"("p_order_id" "uuid", "p_expected_revision" bigint, "p_idempotency_key" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_order public.orders%rowtype;
  v_key text := public.rider_validate_idempotency_key(p_idempotency_key);
  v_result jsonb;
begin
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_assigned'); end if;
  perform public.rider_require_active_membership(v_order.business_id);
  if v_order.assigned_rider_user_id is distinct from auth.uid() then return jsonb_build_object('ok', false, 'code', 'not_assigned'); end if;
  select result into v_result from public.rider_delivery_operations
   where order_id = v_order.id and rider_user_id = auth.uid() and operation = 'picked_up' and idempotency_key = v_key for share;
  if found then return v_result || jsonb_build_object('idempotent_no_op', true); end if;
  if v_order.revision <> p_expected_revision then return jsonb_build_object('ok', false, 'code', 'stale_revision', 'revision', v_order.revision); end if;
  if v_order.status <> 'assigned' then return jsonb_build_object('ok', false, 'code', 'not_ready_for_pickup', 'revision', v_order.revision); end if;
  update public.orders set status = 'picked_up' where id = v_order.id;
  v_result := jsonb_build_object('ok', true, 'outcome', 'picked_up', 'idempotent_no_op', false, 'order', public.rider_active_delivery_payload(v_order.id));
  insert into public.rider_delivery_operations(order_id, rider_user_id, operation, idempotency_key, request_fingerprint, result)
  values (v_order.id, auth.uid(), 'picked_up', v_key, digest(jsonb_build_object('revision', p_expected_revision)::text, 'sha256'), v_result);
  return v_result;
end;
$$;


ALTER FUNCTION "public"."mark_delivery_picked_up"("p_order_id" "uuid", "p_expected_revision" bigint, "p_idempotency_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_payment_cancellation_ambiguous"("p_cancellation_id" "uuid", "p_request_hash" "text", "p_error_code" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
declare v_cancellation public.payment_cancellations%rowtype; v_intent public.payment_intents%rowtype;
begin
  if p_request_hash !~ '^[a-f0-9]{64}$' then raise exception 'hash invalido' using errcode = '22023'; end if;
  select * into v_cancellation from public.payment_cancellations c where c.id = p_cancellation_id for update;
  if not found then raise exception 'cancelacion inexistente' using errcode = 'P0002'; end if;
  select * into v_intent from public.payment_intents pi where pi.id = v_cancellation.payment_intent_id for share;
  update public.payment_cancellations set status = 'ambiguous', raw_response_hash = p_request_hash where id = v_cancellation.id;
  insert into public.payment_outbox (payment_intent_id, cancellation_id, topic, resource_id, last_error)
  values (v_cancellation.payment_intent_id, v_cancellation.id, 'cancellation_reconcile', v_intent.provider_payment_id, left(coalesce(p_error_code, 'network_or_timeout'), 160));
  return true;
end;
$_$;


ALTER FUNCTION "public"."mark_payment_cancellation_ambiguous"("p_cancellation_id" "uuid", "p_request_hash" "text", "p_error_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_payment_refund_ambiguous"("p_refund_id" "uuid", "p_request_hash" "text", "p_error_code" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
declare v_refund public.payment_refunds%rowtype;
begin
  if p_request_hash !~ '^[a-f0-9]{64}$' then raise exception 'hash invalido' using errcode = '22023'; end if;
  select * into v_refund from public.payment_refunds r where r.id = p_refund_id for update;
  if not found then raise exception 'reembolso inexistente' using errcode = 'P0002'; end if;
  update public.payment_refunds set status = 'ambiguous', raw_response_hash = p_request_hash where id = v_refund.id;
  insert into public.payment_outbox (payment_intent_id, refund_id, topic, resource_id, last_error)
  values (v_refund.payment_intent_id, v_refund.id, 'refund_reconcile', null, left(coalesce(p_error_code, 'network_or_timeout'), 160));
  return true;
end;
$_$;


ALTER FUNCTION "public"."mark_payment_refund_ambiguous"("p_refund_id" "uuid", "p_request_hash" "text", "p_error_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_rider_arrived"("p_order_id" "uuid", "p_expected_revision" bigint, "p_idempotency_key" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_order public.orders%rowtype;
  v_key text := public.rider_validate_idempotency_key(p_idempotency_key);
  v_result jsonb;
begin
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_assigned'); end if;
  perform public.rider_require_active_membership(v_order.business_id);
  if v_order.assigned_rider_user_id is distinct from auth.uid() then return jsonb_build_object('ok', false, 'code', 'not_assigned'); end if;
  select result into v_result from public.rider_delivery_operations
   where order_id = v_order.id and rider_user_id = auth.uid() and operation = 'arrived' and idempotency_key = v_key for share;
  if found then return v_result || jsonb_build_object('idempotent_no_op', true); end if;
  if v_order.revision <> p_expected_revision then return jsonb_build_object('ok', false, 'code', 'stale_revision', 'revision', v_order.revision); end if;
  if v_order.status <> 'on_the_way' then return jsonb_build_object('ok', false, 'code', 'not_on_the_way', 'revision', v_order.revision); end if;
  update public.orders set status = 'arrived', arrived_at = clock_timestamp() where id = v_order.id;
  v_result := jsonb_build_object('ok', true, 'outcome', 'arrived', 'idempotent_no_op', false, 'order', public.rider_active_delivery_payload(v_order.id));
  insert into public.rider_delivery_operations(order_id, rider_user_id, operation, idempotency_key, request_fingerprint, result)
  values (v_order.id, auth.uid(), 'arrived', v_key, digest(jsonb_build_object('revision', p_expected_revision)::text, 'sha256'), v_result);
  return v_result;
end;
$$;


ALTER FUNCTION "public"."mark_rider_arrived"("p_order_id" "uuid", "p_expected_revision" bigint, "p_idempotency_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."next_order_public_code"() RETURNS "text"
    LANGUAGE "sql"
    AS $$
  select 'LT-' || lpad(nextval('public.order_public_code_seq')::text, 4, '0')
$$;


ALTER FUNCTION "public"."next_order_public_code"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_customer_address_text"("p_value" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
  select regexp_replace(
    regexp_replace(
      regexp_replace(
        lower(translate(coalesce(p_value, ''), 'áéíóúüñ', 'aeiouun')),
        '\m(av\.?|avda\.?)\M',
        'avenida',
        'g'
      ),
      '\m(dpto\.?|depto\.?)\M',
      'departamento',
      'g'
    ),
    '[^a-z0-9]+',
    ' ',
    'g'
  )
$$;


ALTER FUNCTION "public"."normalize_customer_address_text"("p_value" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_order_status_vocabulary"("p_status" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select case lower(btrim(coalesce(p_status, '')))
    when 'received' then 'submitted'
    when 'canceled' then 'cancelled'
    when 'arriving' then 'arrived'
    when 'ready_for_pickup' then 'ready'
    else lower(btrim(coalesce(p_status, '')))
  end;
$$;


ALTER FUNCTION "public"."normalize_order_status_vocabulary"("p_status" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."normalize_order_status_vocabulary"("p_status" "text") IS 'Traduce el vocabulario publico del contrato (submitted/ready_for_pickup/arriving) al vocabulario almacenado.';



CREATE OR REPLACE FUNCTION "public"."order_pipeline_state"("p_order_status" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select case public.normalize_order_status_vocabulary(p_order_status)
    when 'draft' then 'received'
    when 'submitted' then 'received'
    when 'accepted' then 'accepted'
    when 'preparing' then 'preparing'
    when 'ready' then 'ready'
    when 'assigned' then 'assigned'
    when 'picked_up' then 'picked_up'
    when 'on_the_way' then 'on_the_way'
    when 'arrived' then 'arrived'
    when 'delivered' then 'delivered'
    when 'cancelled' then 'cancelled'
    when 'rejected' then 'rejected'
    else null
  end;
$$;


ALTER FUNCTION "public"."order_pipeline_state"("p_order_status" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."order_pipeline_state"("p_order_status" "text") IS 'Traduce orders.status al vocabulario canónico del circuito; total sobre orders_status_check.';



CREATE OR REPLACE FUNCTION "public"."payment_internal_status_rank"("p_status" "text") RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select case lower(btrim(coalesce(p_status, '')))
    when 'created' then 10
    when 'preference_creating' then 20
    -- ambiguous means an outbound preference request timed out before its
    -- authoritative result was reconciled; it may safely advance to a known
    -- preference without permitting any payment-state regression.
    when 'ambiguous' then 25
    when 'preference_created' then 30
    when 'redirected' then 40
    when 'pending' then 50
    when 'in_process' then 60
    when 'rejected' then 70
    when 'cancelled' then 75
    when 'expired' then 80
    when 'failed' then 85
    when 'approved' then 100
    when 'approved_order_pending' then 105
    when 'completed' then 110
    when 'partially_refunded' then 120
    when 'refunded' then 130
    when 'charged_back' then 140
    when 'security_review_required' then 150
    else 0
  end;
$$;


ALTER FUNCTION "public"."payment_internal_status_rank"("p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prepare_daily_reconciliation"("p_business_id" "uuid", "p_business_date" "date", "p_timezone" "text", "p_declared_cash" numeric, "p_difference_note" "text", "p_idempotency_key" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
declare
  v_run public.daily_reconciliations%rowtype;
  v_snapshot jsonb;
  v_start timestamptz;
  v_end timestamptz;
  v_expected numeric(14,2);
  v_difference numeric(14,2);
begin
  if not public.has_business_role(p_business_id, array['owner','admin','staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'zona horaria invalida' using errcode = '22023';
  end if;
  if p_declared_cash is null or p_declared_cash < 0 or p_declared_cash > 999999999999.99 then
    raise exception 'efectivo declarado invalido' using errcode = '22023';
  end if;
  if btrim(coalesce(p_idempotency_key,'')) !~ '^[A-Za-z0-9:_-]{8,128}$' then
    raise exception 'idempotency_key invalida' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text || ':' || p_business_date::text, 0));
  select * into v_run from public.daily_reconciliations
  where business_id = p_business_id and prepare_idempotency_key = p_idempotency_key
  for update;
  if found then
    insert into public.daily_reconciliation_events(business_id,reconciliation_id,event_type,actor_id,revision,snapshot_sha256)
    values (p_business_id,v_run.id,'idempotent_replay',auth.uid(),v_run.revision,v_run.snapshot_sha256);
    return jsonb_build_object('ok',true,'reconciliation',to_jsonb(v_run),'idempotent_replay',true);
  end if;
  v_start := p_business_date::timestamp at time zone p_timezone;
  v_end := (p_business_date + 1)::timestamp at time zone p_timezone;
  v_snapshot := public.daily_reconciliation_snapshot_internal(p_business_id,v_start,v_end);
  v_expected := coalesce((v_snapshot #>> '{cash,expected}')::numeric,0);
  v_difference := round(p_declared_cash - v_expected,2);
  if v_difference <> 0 and char_length(btrim(coalesce(p_difference_note,''))) not between 5 and 500 then
    raise exception 'la diferencia de caja requiere una explicacion' using errcode = '22023';
  end if;
  insert into public.daily_reconciliations(
    business_id,business_date,timezone,status,window_start,window_end,snapshot,
    declared_cash,expected_cash,cash_difference,difference_note,open_alerts,
    critical_alerts,prepared_by,prepare_idempotency_key
  ) values (
    p_business_id,p_business_date,p_timezone,'open',v_start,v_end,v_snapshot,
    round(p_declared_cash,2),v_expected,v_difference,nullif(btrim(coalesce(p_difference_note,'')),''),
    (select count(*) from public.operational_alerts a where a.business_id=p_business_id and a.status<>'resolved'),
    (select count(*) from public.operational_alerts a where a.business_id=p_business_id and a.status<>'resolved' and a.severity='CRITICAL'),
    auth.uid(),p_idempotency_key
  )
  on conflict (business_id,business_date) do update set
    timezone=excluded.timezone,window_start=excluded.window_start,window_end=excluded.window_end,
    snapshot=excluded.snapshot,declared_cash=excluded.declared_cash,expected_cash=excluded.expected_cash,
    cash_difference=excluded.cash_difference,difference_note=excluded.difference_note,
    open_alerts=excluded.open_alerts,critical_alerts=excluded.critical_alerts,
    refreshed_at=clock_timestamp(),revision=daily_reconciliations.revision+1,
    prepare_idempotency_key=excluded.prepare_idempotency_key
  where daily_reconciliations.status='open'
  returning * into v_run;
  if not found then
    select * into v_run from public.daily_reconciliations where business_id=p_business_id and business_date=p_business_date;
    return jsonb_build_object('ok',true,'reconciliation',to_jsonb(v_run),'idempotent_replay',true);
  end if;
  insert into public.daily_reconciliation_events(business_id,reconciliation_id,event_type,actor_id,revision)
  values (p_business_id,v_run.id,case when v_run.revision=1 then 'prepared' else 'refreshed' end,auth.uid(),v_run.revision);
  return jsonb_build_object('ok',true,'reconciliation',to_jsonb(v_run),'idempotent_replay',false);
end;
$_$;


ALTER FUNCTION "public"."prepare_daily_reconciliation"("p_business_id" "uuid", "p_business_date" "date", "p_timezone" "text", "p_declared_cash" numeric, "p_difference_note" "text", "p_idempotency_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prepare_mercadopago_preference"("p_checkout_session_id" "uuid", "p_customer_id" "uuid", "p_new_attempt" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_session public.checkout_sessions%rowtype;
  v_intent public.payment_intents%rowtype;
  v_settings public.business_payment_settings%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_number integer;
  v_items jsonb;
begin
  select * into v_session from public.checkout_sessions s where s.id = p_checkout_session_id for update;
  if not found or v_session.customer_id <> p_customer_id then
    raise exception 'checkout no autorizado' using errcode = '42501';
  end if;
  if v_session.expires_at <= clock_timestamp() then
    perform public.release_checkout_session_inventory(v_session.id, 'preference_expired', 'expired');
    raise exception 'checkout vencido' using errcode = '55000';
  end if;
  select * into v_intent from public.payment_intents pi where pi.checkout_session_id = v_session.id for update;
  if not found then raise exception 'payment intent inexistente' using errcode = 'P0002'; end if;
  select * into v_settings from public.business_payment_settings s
   where s.business_id = v_session.business_id and s.provider = 'mercadopago' for share;
  if not found or not v_settings.enabled or not v_settings.reserve_stock
    or v_settings.checkout_mode <> 'checkout_pro' or v_settings.currency <> 'ARS'
    or (v_settings.environment = 'production' and v_settings.production_review_status <> 'approved') then
    raise exception 'Mercado Pago no esta habilitado' using errcode = '55000';
  end if;
  if v_session.status in ('completed', 'payment_approved', 'finalizing_order', 'manual_review_required') then
    raise exception 'checkout no admite otra preferencia' using errcode = '55000';
  end if;
  -- Los items de la preferencia tienen que ser lo que se VENDE, no lo que se
  -- reserva. Un combo se reserva como sus componentes —el mostrador arma latas,
  -- no combos— pero se cobra como combo. Listar los componentes a precio de
  -- lista hacia que la suma de los items superara el total autoritativo, y el
  -- armador de la preferencia lanzaba
  -- `Preference items exceed the server-side checkout total`, que el Edge
  -- Function clasificaba como `network_or_timeout`. Ademas el comprador veria
  -- en Checkout Pro un total distinto del que su pedido cobra.
  select coalesce(jsonb_agg(lineas.linea order by lineas.linea ->> 'id'), '[]'::jsonb)
    into v_items
    from (
      select jsonb_build_object(
        'id', c.combo_id,
        'title', c.name,
        'description', 'Combo',
        'quantity', c.quantity,
        'currency_id', 'ARS',
        'unit_price', c.promotional_price
      ) as linea
        from public.checkout_session_combos c
       where c.checkout_session_id = v_session.id
      union all
      -- De cada producto queda lo que NO consume ningun combo: quien suma dos
      -- latas sueltas ademas del combo las paga aparte, a precio de lista.
      select jsonb_build_object(
        'id', i.product_id::text,
        'title', coalesce(i.product_snapshot ->> 'name', 'Producto TABA2'),
        'description', nullif(i.product_snapshot ->> 'presentation', ''),
        'quantity', suelto.quantity,
        'currency_id', 'ARS',
        'unit_price', i.unit_price
      )
        from public.checkout_session_items i
        cross join lateral (
          select i.quantity - coalesce((
            select sum(cc.quantity * c.quantity)
              from public.checkout_session_combos c
              join public.product_combo_components cc on cc.combo_id = c.combo_uuid
             where c.checkout_session_id = v_session.id
               and cc.product_id = i.product_id
          ), 0) as quantity
        ) as suelto
       where i.checkout_session_id = v_session.id
         and suelto.quantity > 0
    ) as lineas;
  select * into v_attempt from public.payment_attempts pa
   where pa.payment_intent_id = v_intent.id and pa.attempt_type = 'preference'
   order by pa.attempt_number desc limit 1 for update;
  if found and not p_new_attempt and v_attempt.status in ('prepared', 'request_sent', 'created', 'ambiguous') then
    return jsonb_build_object(
      'checkout_session_id', v_session.id, 'payment_intent_id', v_intent.id,
      'payment_attempt_id', v_attempt.id, 'attempt_status', v_attempt.status,
      'attempt_number', v_attempt.attempt_number, 'idempotency_key', v_attempt.idempotency_key,
      'preference_id', v_attempt.preference_id, 'init_point', v_attempt.init_point,
      'sandbox_init_point', v_attempt.sandbox_init_point, 'external_reference', v_intent.external_reference,
      'environment', v_intent.environment, 'currency', 'ARS', 'total', v_intent.expected_amount,
      'expires_at', v_session.expires_at, 'items', v_items,
      'allow_offline_payment_methods', v_settings.allow_offline_payment_methods,
      'installments_limit', v_settings.installments_limit
    );
  end if;
  if p_new_attempt then
    if v_intent.internal_status not in ('rejected', 'cancelled', 'expired', 'failed') then
      raise exception 'el pago actual no admite un nuevo intento controlado' using errcode = '55000';
    end if;
    if v_session.status in ('cancelled', 'expired', 'retrying') then
      perform public.reacquire_checkout_session_inventory(v_session.id, 'payment_retry');
      select * into v_session from public.checkout_sessions s where s.id = v_session.id for update;
    end if;
  elsif found and v_attempt.status in ('failed', 'cancelled') then
    raise exception 'solicita un nuevo intento de pago' using errcode = '55000';
  end if;
  if not exists (select 1 from public.inventory_reservations r where r.checkout_session_id = v_session.id and r.status = 'active' and r.expires_at > clock_timestamp()) then
    raise exception 'reserva de stock no valida' using errcode = '55000';
  end if;
  select coalesce(max(pa.attempt_number), 0) + 1 into v_number
    from public.payment_attempts pa where pa.payment_intent_id = v_intent.id and pa.attempt_type = 'preference';
  insert into public.payment_attempts (payment_intent_id, attempt_number, attempt_type, status)
  values (v_intent.id, v_number, 'preference', 'prepared') returning * into v_attempt;
  update public.payment_intents
     set internal_status = case when internal_status in ('created', 'ambiguous', 'preference_creating', 'preference_created', 'redirected')
                                then 'preference_creating' else internal_status end
   where id = v_intent.id;
  return jsonb_build_object(
    'checkout_session_id', v_session.id, 'payment_intent_id', v_intent.id,
    'payment_attempt_id', v_attempt.id, 'attempt_status', v_attempt.status,
    'attempt_number', v_attempt.attempt_number, 'idempotency_key', v_attempt.idempotency_key,
    'preference_id', null, 'init_point', null, 'sandbox_init_point', null,
    'external_reference', v_intent.external_reference, 'environment', v_intent.environment,
    'currency', 'ARS', 'total', v_intent.expected_amount, 'expires_at', v_session.expires_at,
    'items', v_items, 'allow_offline_payment_methods', v_settings.allow_offline_payment_methods,
    'installments_limit', v_settings.installments_limit
  );
end;
$$;


ALTER FUNCTION "public"."prepare_mercadopago_preference"("p_checkout_session_id" "uuid", "p_customer_id" "uuid", "p_new_attempt" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prepare_payment_cancellation"("p_payment_intent_id" "uuid", "p_idempotency_key" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare v_actor uuid := auth.uid(); v_intent public.payment_intents%rowtype; v_cancellation public.payment_cancellations%rowtype;
begin
  if v_actor is null then raise exception 'autenticacion requerida' using errcode = '42501'; end if;
  select * into v_intent from public.payment_intents pi where pi.id = p_payment_intent_id for update;
  if not found or not public.has_business_role(v_intent.business_id, array['owner', 'admin']) then raise exception 'cancelacion no autorizada' using errcode = '42501'; end if;
  if v_intent.provider_payment_id is null or v_intent.internal_status not in ('pending', 'in_process') then raise exception 'pago no cancelable en su estado actual' using errcode = '55000'; end if;
  select * into v_cancellation from public.payment_cancellations c where c.idempotency_key = p_idempotency_key for update;
  if found then
    if v_cancellation.payment_intent_id <> v_intent.id then raise exception 'idempotency key pertenece a otra cancelacion' using errcode = '23505'; end if;
    return jsonb_build_object('cancellation_id', v_cancellation.id, 'provider_payment_id', v_intent.provider_payment_id, 'idempotency_key', v_cancellation.idempotency_key, 'idempotent', true, 'reconciliation_required', v_cancellation.status = 'ambiguous');
  end if;
  select * into v_cancellation from public.payment_cancellations c where c.payment_intent_id = v_intent.id and c.status in ('requested', 'processing', 'ambiguous') order by c.requested_at asc limit 1 for update;
  if found then
    return jsonb_build_object('cancellation_id', v_cancellation.id, 'provider_payment_id', v_intent.provider_payment_id, 'idempotency_key', v_cancellation.idempotency_key, 'idempotent', true, 'reconciliation_required', true);
  end if;
  insert into public.payment_cancellations (payment_intent_id, idempotency_key, requested_by)
  values (v_intent.id, p_idempotency_key, v_actor) returning * into v_cancellation;
  return jsonb_build_object('cancellation_id', v_cancellation.id, 'provider_payment_id', v_intent.provider_payment_id, 'idempotency_key', v_cancellation.idempotency_key, 'idempotent', false);
end;
$$;


ALTER FUNCTION "public"."prepare_payment_cancellation"("p_payment_intent_id" "uuid", "p_idempotency_key" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prepare_payment_refund"("p_payment_intent_id" "uuid", "p_amount" numeric, "p_idempotency_key" "uuid", "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_actor uuid := auth.uid();
  v_intent public.payment_intents%rowtype;
  v_refund public.payment_refunds%rowtype;
  v_remaining numeric(12, 2);
  v_amount numeric(12, 2);
  v_refundable_without_order boolean;
begin
  if v_actor is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  select * into v_intent
    from public.payment_intents pi
   where pi.id = p_payment_intent_id
   for update;
  if not found or not public.has_business_role(v_intent.business_id, array['owner', 'admin']) then
    raise exception 'reembolso no autorizado' using errcode = '42501';
  end if;
  v_refundable_without_order := v_intent.order_id is null
    and v_intent.internal_status = 'security_review_required'
    and v_intent.security_review_reason in ('approved_after_reservation_expired', 'finalization_without_active_reservation');
  if v_intent.provider_payment_id is null
    or (
      not v_refundable_without_order
      and (v_intent.order_id is null or v_intent.internal_status not in ('completed', 'partially_refunded'))
    )
    or (v_refundable_without_order is false and v_intent.internal_status not in ('completed', 'partially_refunded')) then
    raise exception 'pago no reembolsable en su estado actual' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.payment_disputes d
     where d.payment_intent_id = v_intent.id
       and d.dispute_type = 'chargeback'
       and d.resolved_at is null
  ) then
    raise exception 'reembolso bloqueado por contracargo abierto' using errcode = '55000';
  end if;
  select * into v_refund
    from public.payment_refunds r
   where r.idempotency_key = p_idempotency_key
   for update;
  if found then
    if v_refund.payment_intent_id <> v_intent.id then
      raise exception 'idempotency key pertenece a otro reembolso' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'refund_id', v_refund.id,
      'provider_payment_id', v_intent.provider_payment_id,
      'amount', v_refund.amount,
      'idempotency_key', v_refund.idempotency_key,
      'idempotent', true,
      'reconciliation_required', v_refund.status = 'ambiguous'
    );
  end if;
  -- Never replace an ambiguous outbound financial request with a new UUID.
  select * into v_refund
    from public.payment_refunds r
   where r.payment_intent_id = v_intent.id
     and r.status in ('requested', 'processing', 'ambiguous')
   order by r.requested_at asc
   limit 1
   for update;
  if found then
    return jsonb_build_object(
      'refund_id', v_refund.id,
      'provider_payment_id', v_intent.provider_payment_id,
      'amount', v_refund.amount,
      'idempotency_key', v_refund.idempotency_key,
      'idempotent', true,
      'reconciliation_required', true
    );
  end if;
  v_remaining := coalesce(v_intent.paid_amount, v_intent.expected_amount) - v_intent.refunded_amount;
  v_amount := coalesce(p_amount, v_remaining);
  if v_amount <= 0 or v_amount > v_remaining then
    raise exception 'importe de reembolso invalido' using errcode = '22023';
  end if;
  insert into public.payment_refunds (
    payment_intent_id, order_id, idempotency_key, amount, requested_by, reason
  ) values (
    v_intent.id, v_intent.order_id, p_idempotency_key, v_amount, v_actor,
    nullif(left(btrim(coalesce(p_reason, '')), 300), '')
  ) returning * into v_refund;
  return jsonb_build_object(
    'refund_id', v_refund.id,
    'provider_payment_id', v_intent.provider_payment_id,
    'amount', v_refund.amount,
    'idempotency_key', v_refund.idempotency_key,
    'full_refund', v_refund.amount = coalesce(v_intent.paid_amount, v_intent.expected_amount),
    'idempotent', false
  );
end;
$$;


ALTER FUNCTION "public"."prepare_payment_refund"("p_payment_intent_id" "uuid", "p_amount" numeric, "p_idempotency_key" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_closed_daily_reconciliation_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  if tg_op = 'DELETE' or old.status = 'closed' then
    raise exception 'cierre diario inmutable' using errcode = '55000';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."prevent_closed_daily_reconciliation_mutation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_inventory_movement_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  raise exception 'inventory_movements es inmutable; use un movimiento compensatorio' using errcode='55000';
end;
$$;


ALTER FUNCTION "public"."prevent_inventory_movement_mutation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_payment_intent_status_regression"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  -- C�mo se cierra una revisi�n de seguridad. Cerrado a prop�sito: cualquier
  -- destino fuera de esta lista sigue siendo una regresi�n.
  v_resoluciones constant text[] := array[
    'completed', 'approved_order_pending', 'refunded', 'partially_refunded', 'charged_back'
  ];
begin
  new.revision := old.revision;
  if new is distinct from old then
    if public.payment_internal_status_rank(new.internal_status)
       < public.payment_internal_status_rank(old.internal_status)
      and not (
        old.internal_status = 'security_review_required'
        and new.internal_status = any(v_resoluciones)
      ) then
      raise exception 'payment intent status regression: % -> %', old.internal_status, new.internal_status
        using errcode = '22023';
    end if;
    new.revision := old.revision + 1;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."prevent_payment_intent_status_regression"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."prevent_payment_intent_status_regression"() IS 'Impide que un pago retroceda de estado. Una revision de seguridad si se puede RESOLVER hacia completed, approved_order_pending, refunded, partially_refunded o charged_back; nada mas.';



CREATE OR REPLACE FUNCTION "public"."prevent_rider_unverified_delivery"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
begin
  if new.status = 'delivered'
    and old.status is distinct from 'delivered'
    and new.delivery_mode = 'delivery'
    and new.assigned_rider_user_id = auth.uid()
    and public.has_business_role(new.business_id, array['rider'])
    and coalesce(current_setting('taba.delivery_code_confirmed', true), '') <> 'true' then
    raise exception 'confirmacion de codigo requerida para entregar' using errcode = '42501';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."prevent_rider_unverified_delivery"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_unverified_delivery"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
begin
  if new.status = 'delivered'
    and old.status is distinct from 'delivered'
    and new.delivery_mode = 'delivery'
    and new.delivery_code_required
    and not exists (
      select 1
        from public.order_delivery_handoffs h
       where h.order_id = new.id
         and h.confirmed_at is not null
    ) then
    raise exception 'codigo de entrega no confirmado' using errcode = '55000';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."prevent_unverified_delivery"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."product_commercial_state"("p_price_status" "text", "p_price" numeric, "p_stock" integer, "p_is_active" boolean, "p_is_verified" boolean, "p_available" boolean) RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select case
    when p_price_status is distinct from 'confirmed' or coalesce(p_price, 0) <= 0
      then 'precio_pendiente'
    when p_stock is null then 'stock_pendiente'
    when p_stock <= 0 then 'agotado'
    when not coalesce(p_is_active, false) or not coalesce(p_is_verified, false)
      then 'no_publicado'
    when not coalesce(p_available, false) then 'publicable_no_publicado'
    else 'comprable'
  end
$$;


ALTER FUNCTION "public"."product_commercial_state"("p_price_status" "text", "p_price" numeric, "p_stock" integer, "p_is_active" boolean, "p_is_verified" boolean, "p_available" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."product_commercial_state"("p_price_status" "text", "p_price" numeric, "p_stock" integer, "p_is_active" boolean, "p_is_verified" boolean, "p_available" boolean) IS 'Single authority for the commercial state of a catalog row: precio_pendiente, stock_pendiente, agotado, no_publicado, publicable_no_publicado or comprable.';



CREATE OR REPLACE FUNCTION "public"."product_is_qa_fixture"("p_product_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select exists (
    select 1
      from public.products p
     where p.id = p_product_id
       and p.catalog_origin in ('test_only', 'staging_only')
  );
$$;


ALTER FUNCTION "public"."product_is_qa_fixture"("p_product_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."product_is_qa_fixture"("p_product_id" "uuid") IS 'True para fixtures de prueba deliberados (catalog_origin test_only/staging_only).';



CREATE OR REPLACE FUNCTION "public"."propagate_paid_order_correlation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  if new.order_id is not null then
    update public.orders
    set correlation_id = new.correlation_id
    where id = new.order_id
      and correlation_id is distinct from new.correlation_id;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."propagate_paid_order_correlation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protect_authorized_fiscal_document"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  if tg_op='DELETE' and old.state in ('authorized','credited') then raise exception 'un comprobante autorizado no se elimina' using errcode='55000'; end if;
  if tg_op='UPDATE' and old.state in ('authorized','credited') and (
    new.cae is distinct from old.cae or new.document_number is distinct from old.document_number
    or new.total_amount is distinct from old.total_amount or new.net_amount is distinct from old.net_amount
    or new.tax_amount is distinct from old.tax_amount or new.exempt_amount is distinct from old.exempt_amount
    or new.non_taxed_amount is distinct from old.non_taxed_amount or new.other_taxes_amount is distinct from old.other_taxes_amount
    or new.cuit is distinct from old.cuit or new.point_of_sale is distinct from old.point_of_sale
    or new.document_type is distinct from old.document_type or new.concept is distinct from old.concept
    or new.currency is distinct from old.currency or new.currency_rate is distinct from old.currency_rate
    or new.issuer_snapshot is distinct from old.issuer_snapshot or new.recipient_snapshot is distinct from old.recipient_snapshot
    or new.associated_document_id is distinct from old.associated_document_id or new.associated_document_snapshot is distinct from old.associated_document_snapshot
  ) then raise exception 'los datos autorizados son inmutables' using errcode='55000'; end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;


ALTER FUNCTION "public"."protect_authorized_fiscal_document"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protect_authorized_fiscal_document_item"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare v_document_id uuid;
declare v_state text;
begin
  v_document_id := case when tg_op='DELETE' then old.fiscal_document_id else new.fiscal_document_id end;
  select state into v_state from public.fiscal_documents where id=v_document_id;
  if v_state in ('authorized','credited') then raise exception 'los items de un comprobante autorizado son inmutables' using errcode='55000'; end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;


ALTER FUNCTION "public"."protect_authorized_fiscal_document_item"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."publish_catalog_product"("p_business_id" "uuid", "p_external_id" "text", "p_available" boolean DEFAULT false) RETURNS TABLE("product_id" "uuid", "published_external_id" "text", "published_sku" "text", "published_is_verified" boolean, "published_available" boolean, "published_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."publish_catalog_product"("p_business_id" "uuid", "p_external_id" "text", "p_available" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."publish_catalog_product"("p_business_id" "uuid", "p_external_id" "text", "p_available" boolean) IS 'The only authenticated path that transitions an approved catalog product to is_verified=true.';



CREATE OR REPLACE FUNCTION "public"."publish_catalog_product_draft"("p_draft_id" "uuid", "p_name" "text", "p_category" "text", "p_price" numeric, "p_package_type" "text", "p_unit_factor" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_draft public.catalog_product_drafts%rowtype;
  v_product public.products%rowtype;
  v_barcode_type text;
begin
  select d.* into v_draft from public.catalog_product_drafts d where d.id = p_draft_id for update;
  if not found then raise exception 'borrador inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_draft.business_id, array['owner', 'admin']) then raise exception 'revision owner/admin requerida' using errcode = '42501'; end if;
  if v_draft.status <> 'pending_review' then raise exception 'borrador ya revisado' using errcode = 'P0001'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 160 or char_length(btrim(coalesce(p_category, ''))) not between 2 and 80 or p_price < 0 or p_unit_factor < 1 then raise exception 'datos de producto invalidos' using errcode = '22023'; end if;
  -- Antes el valor viajaba sin filtrar al insert y el operador recibía el
  -- nombre del constraint de PostgreSQL en vez de un motivo operable.
  if coalesce(p_package_type, '') not in ('unit', 'pack', 'case', 'internal') then
    raise exception 'presentacion invalida (unit, pack, case o internal)' using errcode = '22023';
  end if;
  insert into public.products(business_id, name, category, price, stock, available, is_active, is_verified, catalog_origin)
  values (v_draft.business_id, btrim(p_name), btrim(p_category), p_price, 0, false, false, false, 'commercial')
  returning * into v_product;
  v_barcode_type := case length(v_draft.scanned_gtin) when 8 then 'EAN-8' when 12 then 'UPC-A' when 13 then 'EAN-13' else 'GTIN-14' end;
  insert into public.product_barcodes(business_id, product_id, gtin, barcode_type, package_type, unit_factor, is_primary, source, verified_at, created_by)
  values (v_draft.business_id, v_product.id, v_draft.scanned_gtin, v_barcode_type, p_package_type, p_unit_factor, true, 'manual', now(), auth.uid());
  update public.catalog_product_drafts set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), product_id = v_product.id where id = v_draft.id;
  return jsonb_build_object('draft_id', v_draft.id, 'product_id', v_product.id, 'gtin', v_draft.scanned_gtin, 'published', false, 'requires_catalog_verification', true);
end;
$$;


ALTER FUNCTION "public"."publish_catalog_product_draft"("p_draft_id" "uuid", "p_name" "text", "p_category" "text", "p_price" numeric, "p_package_type" "text", "p_unit_factor" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."publish_qa_fixture_product"("p_business_id" "uuid", "p_external_id" "text", "p_available" boolean DEFAULT true) RETURNS TABLE("product_id" "uuid", "published_external_id" "text", "published_sku" "text", "catalog_origin" "text", "rights_status" "text", "is_verified" boolean, "available" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_product public.products%rowtype;
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can publish staging QA fixtures.';
  end if;

  select p.* into v_product
    from public.products p
   where p.business_id = p_business_id
     and p.external_id = btrim(p_external_id)
     and p.catalog_origin in ('demo_fixture', 'test_only', 'staging_only')
   for update;
  if not found then
    raise exception 'QA fixture product not found.';
  end if;
  if v_product.catalog_asset_id is null
     or not exists (
       select 1
         from public.catalog_assets ca
        where ca.id = v_product.catalog_asset_id
          and ca.business_id = p_business_id
          and ca.catalog_origin = v_product.catalog_origin
          and ca.rights_status = 'UNAPPROVED_QA'
          and ca.approved_at is null
          and ca.approved_by is null
     ) then
    raise exception 'QA fixture asset provenance is invalid.';
  end if;

  update public.products p
     set is_verified = true,
         verified_at = null,
         verified_by = null,
         available = coalesce(p_available, false) and p.is_active and coalesce(p.stock, 0) > 0,
         updated_at = statement_timestamp()
   where p.id = v_product.id
  returning p.id, p.external_id, p.sku, p.catalog_origin,
            (select ca.rights_status from public.catalog_assets ca where ca.id = p.catalog_asset_id),
            p.is_verified, p.available
  into product_id, published_external_id, published_sku, catalog_origin,
       rights_status, is_verified, available;
  return next;
end;
$$;


ALTER FUNCTION "public"."publish_qa_fixture_product"("p_business_id" "uuid", "p_external_id" "text", "p_available" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."publish_qa_fixture_product"("p_business_id" "uuid", "p_external_id" "text", "p_available" boolean) IS 'STAGING ONLY: makes a QA fixture orderable without commercial rights approval.';



CREATE OR REPLACE FUNCTION "public"."publish_rider_location"("p_order_id" "uuid", "p_expected_revision" bigint, "p_lat" double precision, "p_lng" double precision, "p_accuracy" double precision, "p_heading" double precision DEFAULT NULL::double precision, "p_speed" double precision DEFAULT NULL::double precision, "p_captured_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_order public.orders%rowtype;
  v_location public.rider_locations%rowtype;
  v_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
begin
  if v_user_id is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if p_order_id is null
    or p_expected_revision is null
    or p_expected_revision < 1
    or p_lat is null
    or p_lng is null
    or p_accuracy is null
    or p_lat in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
    or p_lng in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
    or p_accuracy in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
    or p_lat < -90
    or p_lat > 90
    or p_lng < -180
    or p_lng > 180
    or p_accuracy < 0
    or p_accuracy > 250
    or (p_heading is not null and (
      p_heading in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
      or p_heading < 0
      or p_heading >= 360
    ))
    or (p_speed is not null and (
      p_speed in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
      or p_speed < 0
      or p_speed > 70
    )) then
    raise exception 'ubicacion GPS invalida o imprecisa' using errcode = '22023';
  end if;
  if p_captured_at is not null and (
    p_captured_at > v_now + interval '30 seconds'
    or p_captured_at < v_now - interval '3 minutes'
  ) then
    raise exception 'muestra GPS futura o atrasada' using errcode = '22023';
  end if;

  select o.*
    into v_order
    from public.orders o
   where o.id = p_order_id
   for update;

  if not found then
    raise exception 'pedido inexistente' using errcode = 'P0002';
  end if;
  perform 1
    from public.business_members bm
   where bm.business_id = v_order.business_id
     and bm.user_id = v_user_id
     and bm.role = 'rider'
     and bm.is_active = true
   for share;
  if not found
    or v_order.delivery_mode <> 'delivery'
    or v_order.assigned_rider_user_id is distinct from v_user_id
    or v_order.status not in ('assigned', 'picked_up', 'on_the_way', 'arrived') then
    raise exception 'pedido no asignado a este rider o reparto finalizado'
      using errcode = '42501';
  end if;
  if v_order.revision <> p_expected_revision then
    raise exception 'revision desactualizada: esperada %, actual %',
      p_expected_revision,
      v_order.revision
      using errcode = '40001';
  end if;
  if p_captured_at is not null and exists (
    select 1
      from public.rider_locations rl
     where rl.order_id = v_order.id
       and rl.rider_user_id = v_user_id
       and rl.captured_at is not null
       and rl.captured_at >= p_captured_at
  ) then
    raise exception 'muestra GPS atrasada respecto de la ultima aceptada'
      using errcode = '40001';
  end if;
  if exists (
    select 1
      from public.rider_locations rl
     where rl.order_id = v_order.id
       and rl.rider_user_id = v_user_id
       and rl.source = 'gps'
       and rl.recorded_at > v_now - interval '5 seconds'
  ) then
    raise exception 'ubicacion GPS publicada demasiado pronto' using errcode = 'P0001';
  end if;

  insert into public.rider_locations (
    order_id,
    business_id,
    rider_user_id,
    order_revision,
    lat,
    lng,
    accuracy,
    heading,
    speed,
    captured_at,
    source
  ) values (
    v_order.id,
    v_order.business_id,
    v_user_id,
    v_order.revision,
    p_lat,
    p_lng,
    p_accuracy,
    p_heading,
    p_speed,
    p_captured_at,
    'gps'
  )
  returning * into v_location;

  return jsonb_strip_nulls(jsonb_build_object(
    'id', v_location.id,
    'order_id', v_location.order_id,
    'business_id', v_location.business_id,
    'rider_user_id', v_location.rider_user_id,
    'order_revision', v_location.order_revision,
    'sequence', v_location.sequence,
    'lat', v_location.lat,
    'lng', v_location.lng,
    'accuracy', v_location.accuracy,
    'heading', v_location.heading,
    'speed', v_location.speed,
    'source', 'gps',
    'recorded_at', v_location.recorded_at,
    'created_at', v_location.recorded_at
  ));
end;
$$;


ALTER FUNCTION "public"."publish_rider_location"("p_order_id" "uuid", "p_expected_revision" bigint, "p_lat" double precision, "p_lng" double precision, "p_accuracy" double precision, "p_heading" double precision, "p_speed" double precision, "p_captured_at" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."publish_rider_location"("p_order_id" "uuid", "p_expected_revision" bigint, "p_lat" double precision, "p_lng" double precision, "p_accuracy" double precision, "p_heading" double precision, "p_speed" double precision, "p_captured_at" timestamp with time zone) IS 'Publicacion GPS exclusiva por RPC, con revision, timestamp servidor, calidad, orden total, antiguedad y frecuencia.';



CREATE OR REPLACE FUNCTION "public"."publish_rider_location_receipt"("p_order_id" "uuid", "p_expected_revision" bigint, "p_lat" double precision, "p_lng" double precision, "p_accuracy" double precision, "p_heading" double precision, "p_speed" double precision, "p_captured_at" timestamp with time zone, "p_idempotency_key" "text", "p_is_mock" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_order public.orders%rowtype;
  v_previous public.rider_locations%rowtype;
  v_location public.rider_locations%rowtype;
  v_key text := public.rider_validate_idempotency_key(p_idempotency_key);
  v_now timestamptz;
  v_elapsed_seconds double precision;
  v_distance_meters double precision;
begin
  if p_lat is null or p_lng is null or p_accuracy is null
    or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180
    or p_accuracy < 0 or p_accuracy > 250
    or (p_heading is not null and (p_heading < 0 or p_heading >= 360))
    or (p_speed is not null and (p_speed < 0 or p_speed > 70)) then
    return jsonb_build_object('ok', false, 'code', 'inaccurate');
  end if;
  if coalesce(p_is_mock, false) then return jsonb_build_object('ok', false, 'code', 'mock_location_rejected'); end if;
  v_now := clock_timestamp();
  if p_captured_at is null
    or p_captured_at < v_now - interval '10 minutes'
    or p_captured_at > v_now + interval '2 minutes' then
    return jsonb_build_object('ok', false, 'code', 'stale');
  end if;
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_assigned'); end if;
  perform public.rider_require_active_membership(v_order.business_id);
  if v_order.assigned_rider_user_id is distinct from auth.uid() then return jsonb_build_object('ok', false, 'code', 'not_assigned'); end if;
  if v_order.status in ('delivered', 'cancelled', 'rejected') then return jsonb_build_object('ok', false, 'code', 'terminal'); end if;
  if v_order.status not in ('on_the_way', 'arrived') then return jsonb_build_object('ok', false, 'code', 'not_active'); end if;
  if v_order.revision <> p_expected_revision then return jsonb_build_object('ok', false, 'code', 'stale', 'revision', v_order.revision); end if;
  select rl.* into v_location from public.rider_locations rl
   where rl.order_id = v_order.id and rl.rider_user_id = auth.uid() and rl.client_request_id = v_key
   for share;
  if found then return jsonb_build_object('ok', true, 'code', 'accepted', 'idempotent_no_op', true, 'sequence', v_location.receipt_sequence, 'recorded_at', v_location.created_at); end if;
  select rl.* into v_previous from public.rider_locations rl
   where rl.order_id = v_order.id and rl.rider_user_id = auth.uid() and rl.source = 'gps'
   order by rl.created_at desc, rl.id desc limit 1 for share;
  if found then
    v_elapsed_seconds := extract(epoch from (v_now - v_previous.created_at));
    if v_elapsed_seconds < 5 then return jsonb_build_object('ok', false, 'code', 'throttled', 'retry_after_seconds', greatest(1, ceil(5 - v_elapsed_seconds))::integer); end if;
    v_distance_meters := 6371000 * 2 * asin(sqrt(
      power(sin(radians(p_lat - v_previous.lat) / 2), 2) +
      cos(radians(v_previous.lat)) * cos(radians(p_lat)) * power(sin(radians(p_lng - v_previous.lng) / 2), 2)
    ));
    if v_distance_meters > greatest(250, v_elapsed_seconds * 70 + 100) then return jsonb_build_object('ok', false, 'code', 'impossible_jump'); end if;
  end if;
  insert into public.rider_locations(
    order_id, business_id, rider_user_id, lat, lng, accuracy, heading, speed,
    source, client_request_id, order_revision, captured_at
  ) values (
    v_order.id, v_order.business_id, auth.uid(), p_lat, p_lng, p_accuracy, p_heading, p_speed,
    'gps', v_key, v_order.revision, p_captured_at
  ) returning * into v_location;
  return jsonb_build_object('ok', true, 'code', 'accepted', 'idempotent_no_op', false, 'sequence', v_location.receipt_sequence, 'recorded_at', v_location.created_at);
end;
$$;


ALTER FUNCTION "public"."publish_rider_location_receipt"("p_order_id" "uuid", "p_expected_revision" bigint, "p_lat" double precision, "p_lng" double precision, "p_accuracy" double precision, "p_heading" double precision, "p_speed" double precision, "p_captured_at" timestamp with time zone, "p_idempotency_key" "text", "p_is_mock" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."publish_rider_location_receipt"("p_order_id" "uuid", "p_expected_revision" bigint, "p_lat" double precision, "p_lng" double precision, "p_accuracy" double precision, "p_heading" double precision, "p_speed" double precision, "p_captured_at" timestamp with time zone, "p_idempotency_key" "text", "p_is_mock" boolean) IS 'Assignment- and revision-bound Rider GPS receipt with server-time validation, persistent order revision and terminal rejection.';



CREATE OR REPLACE FUNCTION "public"."purge_terminal_order_rider_locations"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_terminal_window constant interval := interval '30 minutes';
begin
  if new.status in ('delivered', 'canceled', 'cancelled', 'rejected')
    and old.status is distinct from new.status then
    delete from public.rider_locations
     where order_id = new.id;

    update public.order_public_tokens
       set terminal_visible_until = least(
         expires_at,
         clock_timestamp() + v_terminal_window
       )
     where order_id = new.id
       and revoked_at is null;
  end if;
  return null;
end;
$$;


ALTER FUNCTION "public"."purge_terminal_order_rider_locations"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reacquire_checkout_session_inventory"("p_checkout_session_id" "uuid", "p_reason" "text" DEFAULT 'payment_retry'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_session public.checkout_sessions%rowtype;
  v_settings public.business_payment_settings%rowtype;
  v_item record;
  v_product public.products%rowtype;
  v_generation integer;
  v_expires_at timestamptz;
begin
  select * into v_session from public.checkout_sessions s where s.id = p_checkout_session_id for update;
  if not found then raise exception 'checkout inexistente' using errcode = 'P0002'; end if;
  if v_session.expires_at <= clock_timestamp()
    or v_session.status not in ('cancelled', 'expired', 'retrying') then
    raise exception 'checkout no admite una nueva reserva' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.inventory_reservations r
     where r.checkout_session_id = v_session.id and r.status = 'active'
  ) then
    return jsonb_build_object('reacquired', false, 'reason', 'active_reservation_exists');
  end if;
  select * into v_settings from public.business_payment_settings s
   where s.business_id = v_session.business_id and s.provider = 'mercadopago' for share;
  if not found or not v_settings.enabled or not v_settings.reserve_stock then
    raise exception 'pagos online no configurados' using errcode = '55000';
  end if;
  v_expires_at := clock_timestamp() + make_interval(mins => v_settings.preference_expiration_minutes);
  select coalesce(max(reservation_generation), 0) + 1 into v_generation
    from public.inventory_reservations where checkout_session_id = v_session.id;
  perform 1 from public.products p
    join public.checkout_session_items i on i.product_id = p.id
   where i.checkout_session_id = v_session.id
   order by p.id for update;
  for v_item in
    select i.product_id, i.quantity from public.checkout_session_items i
     where i.checkout_session_id = v_session.id order by i.product_id
  loop
    select * into v_product from public.products p where p.id = v_item.product_id for update;
    if not found or not v_product.is_active or not v_product.is_verified or not v_product.available
      or v_product.price_status <> 'confirmed' or v_product.stock is null or v_product.stock < v_item.quantity then
      raise exception 'stock o publicacion no disponible para reintento' using errcode = '23514';
    end if;
    update public.products set stock = stock - v_item.quantity,
      available = (stock - v_item.quantity) > 0
    where id = v_item.product_id;
    insert into public.inventory_reservations (
      checkout_session_id, product_id, quantity, expires_at, reservation_generation
    ) values (v_session.id, v_item.product_id, v_item.quantity, v_expires_at, v_generation);
  end loop;
  update public.checkout_sessions
     set expires_at = v_expires_at, status = 'ready_for_payment', manual_review_reason = null
   where id = v_session.id;
  return jsonb_build_object('reacquired', true, 'expires_at', v_expires_at, 'reason', left(coalesce(p_reason, ''), 120));
end;
$$;


ALTER FUNCTION "public"."reacquire_checkout_session_inventory"("p_checkout_session_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reconcile_operational_alerts_for_business"("p_business_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_finding record;
  v_alert_id uuid;
  v_previous_status text;
  v_previous_seen timestamptz;
  v_fingerprint text;
  v_seen text[] := '{}'::text[];
  v_count integer := 0;
begin
  for v_finding in
    select * from (
      select
        'CRITICAL'::text as severity,
        'PAYMENT_APPROVED_WITHOUT_ORDER'::text as alert_code,
        'payment_intent'::text as subject_type,
        pi.id as subject_id,
        pi.correlation_id,
        'Pago aprobado sin pedido operativo.'::text as summary,
        'Reconciliar el pago y finalizar el pedido; no cobrar nuevamente.'::text as required_action,
        jsonb_build_object('payment_intent_id', pi.id, 'status', pi.internal_status) as evidence
      from public.payment_intents pi
      where pi.business_id = p_business_id
        and pi.internal_status in ('approved','approved_order_pending')
        and pi.order_id is null
        and pi.updated_at < clock_timestamp() - interval '5 minutes'

      union all

      select
        'ACTION_REQUIRED', 'PAYMENT_RECONCILIATION_REQUIRED', 'payment_intent',
        pi.id, pi.correlation_id,
        'Pago con resultado ambiguo o revisión de seguridad.',
        'Consultar el proveedor y comparar importe, moneda y referencia antes de continuar.',
        jsonb_build_object('payment_intent_id', pi.id, 'status', pi.internal_status)
      from public.payment_intents pi
      where pi.business_id = p_business_id
        and pi.internal_status in ('ambiguous','security_review_required')

      union all

      select
        'CRITICAL', 'CHECKOUT_PROVIDER_UNVERIFIED', 'payment_intent',
        pi.id, pi.correlation_id,
        'Checkout que llegó a Mercado Pago y venció sin confirmación del proveedor.',
        'Buscar el pago en Mercado Pago por la referencia externa; si existe, reembolsar o materializar el pedido.',
        jsonb_build_object(
          'payment_intent_id', pi.id,
          'checkout_session_id', pi.checkout_session_id,
          'external_reference', pi.external_reference,
          'status', pi.internal_status,
          'empty_probes', (
            select count(*) from public.payment_events pe
             where pe.payment_intent_id = pi.id
               and pe.event_type = 'payment.provider_probe_empty'
          )
        )
      from public.payment_intents pi
      join public.checkout_sessions cs on cs.id = pi.checkout_session_id
      where pi.business_id = p_business_id
        and pi.order_id is null
        and cs.completed_order_id is null
        and nullif(btrim(coalesce(pi.preference_id, '')), '') is not null
        and pi.provider_payment_id is null
        and pi.internal_status in ('expired','redirected','pending','in_process','preference_created')
        and cs.expires_at < clock_timestamp() - interval '20 minutes'
        and cs.created_at > clock_timestamp() - interval '48 hours'
        and not exists (
          select 1 from public.payment_events pe
           where pe.payment_intent_id = pi.id
             and pe.event_type = 'payment.provider_probe_empty'
        )

      union all

      select
        'ACTION_REQUIRED', 'ORDER_READY_WITHOUT_RIDER', 'order',
        o.id, o.correlation_id,
        'Pedido listo para entregar y sin Rider asignado.',
        'Asignar un Rider desde el Panel o avisar al cliente si la entrega se demora.',
        jsonb_build_object('order_id', o.id, 'public_code', o.public_code, 'ready_since', coalesce(o.ready_at, o.updated_at))
      from public.orders o
      where o.business_id = p_business_id
        and o.status = 'ready'
        and coalesce(o.fulfillment_type, o.delivery_mode) = 'delivery'
        and o.assigned_rider_user_id is null
        and coalesce(o.ready_at, o.updated_at) < clock_timestamp() - interval '15 minutes'

      union all

      select
        'ACTION_REQUIRED', 'STOCK_RESERVATION_STUCK', 'checkout_session',
        cs.id, cs.correlation_id,
        'Hay stock reservado por un checkout vencido que no se liberó.',
        'Verificar el barrido de expiración; el stock retenido no se puede vender.',
        jsonb_build_object('checkout_session_id', cs.id, 'expired_for', clock_timestamp() - cs.expires_at)
      from public.checkout_sessions cs
      where cs.business_id = p_business_id
        and exists (
          select 1 from public.inventory_reservations r
           where r.checkout_session_id = cs.id
             and r.status = 'active'
             and r.expires_at < clock_timestamp() - interval '5 minutes'
        )

      union all

      select
        'CRITICAL', 'FISCAL_AUTHORIZATION_AMBIGUOUS', 'fiscal_document',
        fd.id, fd.correlation_id,
        'La autorización fiscal es ambigua.',
        'Consultar ARCA por tipo, punto de venta y número; no volver a emitir a ciegas.',
        jsonb_build_object('fiscal_document_id', fd.id, 'state', fd.state)
      from public.fiscal_documents fd
      where fd.business_id = p_business_id and fd.state = 'ambiguous'

      union all

      select
        case when fo.state = 'dead_letter' then 'CRITICAL' else 'ACTION_REQUIRED' end,
        'FISCAL_OUTBOX_STALLED', 'fiscal_document',
        fd.id, fd.correlation_id,
        'La cola fiscal no progresa.',
        'Revisar conectividad y worker; conservar número e idempotencia antes de reintentar.',
        jsonb_build_object('fiscal_document_id', fd.id, 'outbox_state', fo.state, 'attempts', fo.attempt_count)
      from public.fiscal_outbox fo
      join public.fiscal_documents fd on fd.id = fo.fiscal_document_id
      where fd.business_id = p_business_id
        and (
          fo.state = 'dead_letter'
          or (fo.state in ('pending','retry_wait') and fo.next_attempt_at < clock_timestamp() - interval '15 minutes')
          or (fo.state = 'leased' and fo.lease_deadline < clock_timestamp())
        )

      union all

      select
        case when po.status = 'dead_letter' then 'CRITICAL' else 'ACTION_REQUIRED' end,
        'PAYMENT_OUTBOX_STALLED', 'payment_intent',
        pi.id, pi.correlation_id,
        'La cola de pagos no progresa.',
        'Revisar el worker y reconciliar con Mercado Pago usando la misma referencia.',
        jsonb_build_object('payment_intent_id', pi.id, 'outbox_status', po.status, 'attempts', po.attempts)
      from public.payment_outbox po
      join public.payment_intents pi on pi.id = po.payment_intent_id
      where pi.business_id = p_business_id
        and (
          po.status in ('failed','dead_letter')
          or (po.status in ('pending','retry_wait') and po.next_attempt_at < clock_timestamp() - interval '15 minutes')
          or (po.status in ('claimed','processing') and po.lease_expires_at < clock_timestamp())
        )

      union all

      select
        'ACTION_REQUIRED', 'FISCAL_ARTIFACT_STALLED', 'fiscal_document',
        fd.id, fd.correlation_id,
        'El PDF fiscal no está disponible.',
        'Revisar Storage y el worker de artefactos; no modificar el CAE autorizado.',
        jsonb_build_object('fiscal_document_id', fd.id, 'artifact_state', fd.artifact_state, 'outbox_state', fao.state)
      from public.fiscal_documents fd
      left join public.fiscal_artifact_outbox fao on fao.fiscal_document_id = fd.id
      where fd.business_id = p_business_id
        and fd.state = 'authorized'
        and fd.artifact_state in ('artifact_failed','artifact_pending','artifact_generating')
        and coalesce(fao.created_at, fd.authorized_at, fd.created_at) < clock_timestamp() - interval '10 minutes'

      union all

      select
        'ACTION_REQUIRED', 'PRINT_JOB_FAILED', 'print_job',
        pj.id, pj.correlation_id,
        'Una impresión fiscal falló o no pudo verificarse.',
        'Comprobar impresora y papel, abrir la vista previa y reimprimir sólo si corresponde.',
        jsonb_build_object('print_job_id', pj.id, 'status', pj.status, 'error_code', pj.error_code)
      from public.fiscal_print_jobs pj
      where pj.business_id = p_business_id and pj.status in ('failed','unknown')

      union all

      select
        'WARNING', 'RIDER_SIGNAL_STALE', 'order',
        o.id, o.correlation_id,
        'Rider sin señal reciente durante una entrega activa.',
        'Contactar al Rider y verificar el estado sin inventar una ubicación.',
        jsonb_build_object('order_id', o.id, 'status', o.status)
      from public.orders o
      left join lateral (
        select rl.created_at
        from public.rider_locations rl
        where rl.order_id = o.id
        order by rl.created_at desc
        limit 1
      ) last_location on true
      where o.business_id = p_business_id
        and o.status in ('assigned','picked_up','on_the_way','arrived')
        and coalesce(last_location.created_at, o.updated_at) < clock_timestamp() - interval '5 minutes'

      union all

      select
        shs.severity, shs.signal_code, 'service_health', shs.id,
        shs.correlation_id,
        'Un servicio operativo reportó estado degradado.',
        'Abrir diagnóstico y ejecutar el runbook indicado para el servicio.',
        jsonb_build_object('signal_id', shs.id, 'service', shs.service, 'status', shs.status)
      from public.service_health_signals shs
      where shs.business_id = p_business_id
        and shs.expires_at > clock_timestamp()
        and shs.status <> 'healthy'

      union all

      select
        'CRITICAL', 'PAYMENT_WORKER_IDLE', 'service_health',
        md5('payment_worker_idle')::uuid, null::uuid,
        'La cola de cobros tiene trabajo vencido y nadie lo está tomando.',
        'Confirmar cada pago en Mercado Pago antes de entregar; el procesamiento automático no está corriendo.',
        jsonb_build_object(
          'due_jobs', q.due_jobs,
          'oldest_due_minutes', round(q.oldest_due_minutes),
          'last_progress_at', q.last_touch
        )
      from (
        select
          count(*) as due_jobs,
          max(po.updated_at) as last_touch,
          extract(epoch from (
            clock_timestamp() - min(coalesce(po.next_attempt_at, po.lease_expires_at))
          )) / 60 as oldest_due_minutes
        from public.payment_outbox po
        join public.payment_intents pi on pi.id = po.payment_intent_id
        where pi.business_id = p_business_id
          and (
            (po.status in ('pending','retry_wait') and po.next_attempt_at < clock_timestamp() - interval '5 minutes')
            or (po.status in ('claimed','processing') and po.lease_expires_at < clock_timestamp() - interval '5 minutes')
          )
      ) q
      where q.due_jobs > 0
        and q.last_touch < clock_timestamp() - interval '5 minutes'

      union all

      select
        'CRITICAL', 'SCHEDULER_JOB_FAILING', 'service_health',
        md5(sh.job_name)::uuid, null::uuid,
        'Una tarea automática del sistema viene fallando.',
        'Revisar la configuración del servicio; mientras falle, los cobros y el stock dependen de que alguien mire el Panel.',
        jsonb_build_object(
          'job', sh.job_name,
          'schedule', sh.schedule,
          'failures_since_success', sh.failures_since_success,
          'last_success_at', sh.last_success_at
        )
      from public.list_scheduler_health() sh
      where sh.active
        and sh.failures_since_success >= 3

      union all

      select
        'CRITICAL', 'SCHEDULER_JOB_STALLED', 'service_health',
        md5(sh.job_name || ':stalled')::uuid, null::uuid,
        'Una tarea automática del sistema dejó de ejecutarse.',
        'Revisar el estado del servicio; el stock reservado y los cobros pendientes no se están destrabando solos.',
        jsonb_build_object(
          'job', sh.job_name,
          'schedule', sh.schedule,
          'last_success_at', sh.last_success_at,
          'last_start', sh.last_start
        )
      from public.list_scheduler_health() sh
      where sh.active
        and coalesce(sh.last_success_at, '-infinity'::timestamptz) < clock_timestamp() - interval '15 minutes'
        -- ===== LA CORRECCIÓN =====
        -- Detenida exige haber estado en marcha alguna vez: o hubo un éxito, o
        -- lleva más de quince minutos arrancada sin terminar nunca —una tarea
        -- colgada, que sí hay que decir—. Una tarea que arrancó hace segundos y
        -- todavía no terminó no es ninguna de las dos: es una tarea nueva.
        and (
          sh.last_success_at is not null
          or coalesce(sh.last_start, '-infinity'::timestamptz) < clock_timestamp() - interval '15 minutes'
        )
        and sh.failures_since_success < 3
        and exists (
          select 1 from public.list_scheduler_health() alive
           where alive.last_success_at > clock_timestamp() - interval '5 minutes'
        )

      union all

      select
        'ACTION_REQUIRED', 'ORDER_NOT_ACCEPTED', 'order',
        o.id, o.correlation_id,
        'Entró un pedido y todavía nadie lo aceptó.',
        'Abrí Pedidos y aceptalo o cancelalo; el cliente está esperando una respuesta.',
        jsonb_build_object(
          'order_id', o.id,
          'public_code', o.public_code,
          'waiting_minutes', round(extract(epoch from (clock_timestamp() - o.created_at)) / 60)
        )
      from public.orders o
      where o.business_id = p_business_id
        and o.status in ('submitted','received')
        and coalesce(o.origin, 'production') <> 'qa'
        and o.acknowledged_at is null
        and o.created_at < clock_timestamp() - interval '10 minutes'
        and o.created_at > clock_timestamp() - interval '24 hours'

      union all

      select
        'ACTION_REQUIRED', 'ORDER_STALLED', 'order',
        o.id, o.correlation_id,
        'Un pedido aceptado dejó de avanzar.',
        'Abrí Pedidos y movelo o avisale al cliente; pasó bastante del tiempo que le prometiste.',
        jsonb_build_object(
          'order_id', o.id,
          'public_code', o.public_code,
          'status', o.status,
          'promised_minutes', coalesce(o.preparation_estimate_minutes, 30),
          'stalled_minutes', round(extract(epoch from (
            clock_timestamp() - coalesce(o.acknowledged_at, o.created_at)
          )) / 60)
        )
      from public.orders o
      where o.business_id = p_business_id
        and o.status in ('accepted','preparing')
        and coalesce(o.origin, 'production') <> 'qa'
        and coalesce(o.acknowledged_at, o.created_at)
            + make_interval(mins => coalesce(o.preparation_estimate_minutes, 30) + 30)
            < clock_timestamp()
        and o.created_at > clock_timestamp() - interval '24 hours'
    ) findings
  loop
    v_fingerprint := encode(digest(
      p_business_id::text || ':' || v_finding.alert_code || ':' || coalesce(v_finding.subject_id::text, 'none'),
      'sha256'
    ), 'hex');
    v_seen := array_append(v_seen, v_fingerprint);
    select status,last_seen_at into v_previous_status,v_previous_seen
    from public.operational_alerts
    where business_id = p_business_id and fingerprint = v_fingerprint
    for update;

    insert into public.operational_alerts(
      business_id, fingerprint, severity, alert_code, subject_type, subject_id,
      correlation_id, status, summary, required_action, evidence
    ) values (
      p_business_id, v_fingerprint, v_finding.severity,
      v_finding.alert_code, v_finding.subject_type, v_finding.subject_id,
      v_finding.correlation_id, 'open', v_finding.summary,
      v_finding.required_action, v_finding.evidence
    )
    on conflict (business_id, fingerprint) do update set
      severity = excluded.severity,
      correlation_id = excluded.correlation_id,
      status = case when operational_alerts.status = 'resolved' then 'open' else operational_alerts.status end,
      summary = excluded.summary,
      required_action = excluded.required_action,
      evidence = excluded.evidence,
      last_seen_at = clock_timestamp(),
      occurrence_count = operational_alerts.occurrence_count + case
        when operational_alerts.last_seen_at < clock_timestamp() - interval '1 minute' then 1 else 0 end,
      resolved_by = case when operational_alerts.status = 'resolved' then null else operational_alerts.resolved_by end,
      resolved_at = case when operational_alerts.status = 'resolved' then null else operational_alerts.resolved_at end,
      resolution_note = case when operational_alerts.status = 'resolved' then null else operational_alerts.resolution_note end,
      acknowledged_by = case when operational_alerts.status = 'resolved' then null else operational_alerts.acknowledged_by end,
      acknowledged_at = case when operational_alerts.status = 'resolved' then null else operational_alerts.acknowledged_at end,
      updated_at = clock_timestamp()
    returning id into v_alert_id;

    if v_previous_status is null or v_previous_status = 'resolved'
      or v_previous_seen < clock_timestamp() - interval '15 minutes' then
      insert into public.operational_alert_events(business_id, alert_id, event_type, detail)
      values (
        p_business_id,
        v_alert_id,
        case when v_previous_status is null then 'detected' when v_previous_status = 'resolved' then 'reopened' else 'redetected' end,
        jsonb_build_object('alert_code', v_finding.alert_code)
      );
    end if;
    v_count := v_count + 1;
  end loop;

  update public.operational_alerts
  set status = 'resolved', resolved_at = clock_timestamp(), resolution_note = 'Condición ausente en la reconciliación automática.', updated_at = clock_timestamp()
  where business_id = p_business_id
    and status <> 'resolved'
    and not (fingerprint = any(v_seen));

  insert into public.operational_alert_events(business_id, alert_id, event_type, detail)
  select p_business_id, a.id, 'resolved', jsonb_build_object('resolution', 'automatic_condition_cleared')
  from public.operational_alerts a
  where a.business_id = p_business_id
    and a.status = 'resolved'
    and a.resolved_at >= transaction_timestamp()
    and a.resolved_by is null;

  return v_count;
end;
$$;


ALTER FUNCTION "public"."reconcile_operational_alerts_for_business"("p_business_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reconcile_operational_alerts_for_business"("p_business_id" "uuid") IS 'Calcula y reconcilia las alertas operativas de un negocio SIN exigir sesion. Una tarea del planificador en su primera corrida ya no se denuncia a si misma como detenida.';



CREATE OR REPLACE FUNCTION "public"."record_fiscal_credential_health"("p_business_id" "uuid", "p_certificate_fingerprint" "text", "p_certificate_expires_at" timestamp with time zone, "p_certificate_subject_cuit" "text", "p_delegation_status" "text", "p_connection_ok" boolean, "p_error_code" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
begin
  if p_certificate_fingerprint is not null and p_certificate_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'huella de certificado invalida' using errcode = '22023';
  end if;
  if p_certificate_subject_cuit is not null and p_certificate_subject_cuit !~ '^[0-9]{11}$' then
    raise exception 'cuit de certificado invalido' using errcode = '22023';
  end if;
  if p_delegation_status is not null and p_delegation_status not in ('pending', 'verified', 'rejected') then
    raise exception 'estado de delegacion invalido' using errcode = '22023';
  end if;
  -- Se acepta únicamente un código saneado; cualquier texto libre del proveedor se descarta.
  if p_error_code is not null and p_error_code !~ '^[A-Z][A-Z0-9_]{2,63}$' then
    raise exception 'codigo de error no saneado' using errcode = '22023';
  end if;

  update public.fiscal_profiles set
    certificate_fingerprint_sha256 = coalesce(p_certificate_fingerprint, certificate_fingerprint_sha256),
    certificate_expires_at = coalesce(p_certificate_expires_at, certificate_expires_at),
    certificate_subject_cuit = coalesce(p_certificate_subject_cuit, certificate_subject_cuit),
    delegation_status = coalesce(p_delegation_status, delegation_status),
    delegation_verified_at = case
      when coalesce(p_delegation_status, delegation_status) = 'verified' then clock_timestamp()
      else delegation_verified_at
    end,
    connection_ok_at = case when p_connection_ok then clock_timestamp() else connection_ok_at end,
    credential_checked_at = clock_timestamp(),
    last_error_code = p_error_code,
    last_error_at = case when p_error_code is null then last_error_at else clock_timestamp() end,
    updated_at = now()
  where business_id = p_business_id;
end;
$_$;


ALTER FUNCTION "public"."record_fiscal_credential_health"("p_business_id" "uuid", "p_certificate_fingerprint" "text", "p_certificate_expires_at" timestamp with time zone, "p_certificate_subject_cuit" "text", "p_delegation_status" "text", "p_connection_ok" boolean, "p_error_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_fiscal_verification"("p_business_id" "uuid", "p_verification" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'verificacion fiscal requiere owner o admin' using errcode = '42501';
  end if;
  if p_verification not in ('artifact', 'print') then
    raise exception 'verificacion desconocida' using errcode = '22023';
  end if;

  update public.fiscal_profiles set
    artifact_verified_at = case when p_verification = 'artifact' then clock_timestamp() else artifact_verified_at end,
    print_verified_at = case when p_verification = 'print' then clock_timestamp() else print_verified_at end,
    updated_at = now()
  where business_id = p_business_id;

  return jsonb_build_object('ok', true, 'verification', p_verification);
end;
$$;


ALTER FUNCTION "public"."record_fiscal_verification"("p_business_id" "uuid", "p_verification" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_mercadopago_dispute_snapshot"("p_payment_intent_id" "uuid", "p_dispute_type" "text", "p_snapshot" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
declare v_intent public.payment_intents%rowtype; v_type text := lower(btrim(coalesce(p_dispute_type, '')));
declare v_dispute public.payment_disputes%rowtype;
begin
  if v_type not in ('chargeback', 'claim') or p_snapshot is null
    or coalesce(p_snapshot ->> 'raw_response_hash', '') !~ '^[a-f0-9]{64}$'
    or nullif(btrim(coalesce(p_snapshot ->> 'provider_dispute_id', '')), '') is null then
    raise exception 'snapshot de disputa invalido' using errcode = '22023';
  end if;
  select * into v_intent from public.payment_intents pi where pi.id = p_payment_intent_id for update;
  if not found or p_snapshot ->> 'provider_payment_id' is distinct from v_intent.provider_payment_id then
    raise exception 'disputa no coincide con el pago' using errcode = '22023';
  end if;
  insert into public.payment_disputes (
    payment_intent_id, provider_dispute_id, dispute_type, status, coverage_eligible,
    documentation_required, documentation_status, due_at, raw_response_hash, opened_at, resolved_at
  ) values (
    v_intent.id, left(btrim(p_snapshot ->> 'provider_dispute_id'), 200), v_type,
    left(lower(coalesce(p_snapshot ->> 'status', 'open')), 120),
    coalesce((p_snapshot ->> 'coverage_eligible')::boolean, false),
    coalesce((p_snapshot ->> 'documentation_required')::boolean, false),
    nullif(left(btrim(coalesce(p_snapshot ->> 'documentation_status', '')), 120), ''),
    nullif(p_snapshot ->> 'due_at', '')::timestamptz,
    p_snapshot ->> 'raw_response_hash', nullif(p_snapshot ->> 'opened_at', '')::timestamptz,
    nullif(p_snapshot ->> 'resolved_at', '')::timestamptz
  ) on conflict (provider_dispute_id, dispute_type) do update
    set status = excluded.status, coverage_eligible = excluded.coverage_eligible,
      documentation_required = excluded.documentation_required, documentation_status = excluded.documentation_status,
      due_at = excluded.due_at, raw_response_hash = excluded.raw_response_hash,
      opened_at = coalesce(public.payment_disputes.opened_at, excluded.opened_at), resolved_at = excluded.resolved_at
  returning * into v_dispute;
  if v_type = 'chargeback' and v_dispute.resolved_at is null then
    update public.payment_intents set internal_status = 'charged_back' where id = v_intent.id;
  end if;
  insert into public.payment_events (payment_intent_id, event_type, details, raw_response_hash)
  values (v_intent.id, 'payment.' || v_type, jsonb_build_object('dispute_id', v_dispute.id, 'status', v_dispute.status), p_snapshot ->> 'raw_response_hash');
  return jsonb_build_object('ok', true, 'dispute_id', v_dispute.id);
end;
$_$;


ALTER FUNCTION "public"."record_mercadopago_dispute_snapshot"("p_payment_intent_id" "uuid", "p_dispute_type" "text", "p_snapshot" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_mercadopago_payment_snapshot"("p_payment_intent_id" "uuid", "p_snapshot" "jsonb", "p_source" "text", "p_webhook_receipt_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
declare
  v_intent public.payment_intents%rowtype;
  v_session public.checkout_sessions%rowtype;
  v_settings public.business_payment_settings%rowtype;
  v_status text;
  v_next text;
  v_effective text;
  v_amount numeric(12,2);
  v_refunded numeric(12,2);
  v_currency text;
  v_provider_time timestamptz;
  v_valid boolean := true;
  v_reason text;
  v_finalize boolean := false;
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object'
    or coalesce(p_snapshot ->> 'raw_response_hash', '') !~ '^[a-f0-9]{64}$' then
    raise exception 'snapshot de pago invalido' using errcode = '22023';
  end if;
  select * into v_intent from public.payment_intents pi where pi.id = p_payment_intent_id for update;
  if not found then raise exception 'payment intent inexistente' using errcode = 'P0002'; end if;
  select * into v_session from public.checkout_sessions s where s.id = v_intent.checkout_session_id for update;
  select * into v_settings from public.business_payment_settings ps where ps.business_id = v_intent.business_id and ps.provider = 'mercadopago' for share;
  v_status := lower(btrim(coalesce(p_snapshot ->> 'status', '')));
  v_currency := upper(btrim(coalesce(p_snapshot ->> 'currency', '')));
  v_amount := nullif(p_snapshot ->> 'transaction_amount', '')::numeric(12,2);
  v_refunded := coalesce(nullif(p_snapshot ->> 'refunded_amount', '')::numeric(12,2), 0);
  begin
    v_provider_time := coalesce(nullif(p_snapshot ->> 'provider_occurred_at', '')::timestamptz, clock_timestamp());
  exception when others then
    v_provider_time := clock_timestamp();
  end;
  if nullif(btrim(coalesce(p_snapshot ->> 'provider_payment_id', '')), '') is null then
    v_valid := false; v_reason := 'payment_id_missing';
  elsif p_snapshot ->> 'external_reference' is distinct from v_intent.external_reference then
    v_valid := false; v_reason := 'external_reference_mismatch';
  elsif nullif(btrim(coalesce(v_intent.preference_id, '')), '') is not null
    and nullif(btrim(coalesce(p_snapshot ->> 'preference_id', '')), '') is distinct from v_intent.preference_id then
    v_valid := false; v_reason := 'preference_mismatch';
  elsif v_settings.collector_id is null or p_snapshot ->> 'collector_id' is distinct from v_settings.collector_id then
    v_valid := false; v_reason := 'collector_mismatch';
  -- Mercado Pago exposes no application_id on payments or merchant orders, so
  -- the assertion runs only when the provider actually supplies one. collector_id
  -- stays mandatory and is what pins a payment to the configured account.
  elsif nullif(btrim(coalesce(p_snapshot ->> 'application_id', '')), '') is not null
    and p_snapshot ->> 'application_id' is distinct from coalesce(v_settings.application_id, '') then
    v_valid := false; v_reason := 'application_mismatch';
  elsif v_currency <> 'ARS' or v_currency <> v_intent.currency then
    v_valid := false; v_reason := 'currency_mismatch';
  elsif v_amount is null or v_amount <> v_intent.expected_amount then
    v_valid := false; v_reason := 'amount_mismatch';
  -- Checkout Pro test credentials are a Mercado Pago sandbox test user whose
  -- payments report live_mode = true, so equality with the environment can only
  -- be demanded in production. In test the collector_id assertion above already
  -- pins the payment to the sandbox user, which cannot move real money.
  elsif v_intent.environment = 'production'
    and coalesce((p_snapshot ->> 'live_mode')::boolean, false) is not true then
    v_valid := false; v_reason := 'live_mode_mismatch';
  elsif v_status not in ('approved', 'pending', 'in_process', 'authorized', 'rejected', 'cancelled', 'canceled', 'expired', 'refunded', 'charged_back') then
    v_valid := false; v_reason := 'unknown_provider_status';
  end if;
  if not v_valid then
    update public.payment_intents set internal_status = 'security_review_required', security_review_reason = v_reason,
      raw_response_hash = p_snapshot ->> 'raw_response_hash' where id = v_intent.id;
    update public.checkout_sessions set status = 'manual_review_required', manual_review_reason = v_reason where id = v_session.id;
    insert into public.payment_events (payment_intent_id, webhook_receipt_id, event_type, provider_status, provider_status_detail, provider_occurred_at, raw_response_hash, details)
    values (v_intent.id, p_webhook_receipt_id, 'payment.security_review_required', v_status,
      nullif(p_snapshot ->> 'status_detail', ''), v_provider_time, p_snapshot ->> 'raw_response_hash', jsonb_build_object('reason', v_reason, 'source', p_source));
    return jsonb_build_object('ok', false, 'manual_review_required', true, 'reason', v_reason, 'finalize_required', false);
  end if;
  v_next := case v_status
    when 'approved' then case when v_refunded >= v_amount then 'refunded' when v_refunded > 0 then 'partially_refunded' else 'approved_order_pending' end
    when 'pending' then 'pending'
    when 'in_process' then 'in_process'
    when 'authorized' then 'in_process'
    when 'rejected' then 'rejected'
    when 'cancelled' then 'cancelled'
    when 'canceled' then 'cancelled'
    when 'expired' then 'expired'
    when 'refunded' then 'refunded'
    when 'charged_back' then 'charged_back'
    else 'ambiguous'
  end;
  v_effective := case when public.payment_internal_status_rank(v_next) >= public.payment_internal_status_rank(v_intent.internal_status)
    then v_next else v_intent.internal_status end;
  update public.payment_intents set
    provider_payment_id = case when provider_event_at is null or v_provider_time >= provider_event_at then p_snapshot ->> 'provider_payment_id' else provider_payment_id end,
    provider_merchant_order_id = case when provider_event_at is null or v_provider_time >= provider_event_at then nullif(p_snapshot ->> 'merchant_order_id', '') else provider_merchant_order_id end,
    provider_status = case when provider_event_at is null or v_provider_time >= provider_event_at then v_status else provider_status end,
    provider_status_detail = case when provider_event_at is null or v_provider_time >= provider_event_at then nullif(p_snapshot ->> 'status_detail', '') else provider_status_detail end,
    provider_payment_method = case when provider_event_at is null or v_provider_time >= provider_event_at then nullif(p_snapshot ->> 'payment_method', '') else provider_payment_method end,
    provider_event_at = greatest(coalesce(provider_event_at, '-infinity'::timestamptz), v_provider_time),
    paid_amount = case when v_status = 'approved' then v_amount else paid_amount end,
    payer_email_hash = nullif(p_snapshot ->> 'payer_email_hash', ''), live_mode = (p_snapshot ->> 'live_mode')::boolean,
    approved_at = case when v_status = 'approved' then coalesce(approved_at, v_provider_time) else approved_at end,
    rejected_at = case when v_status in ('rejected', 'cancelled', 'canceled', 'expired') then coalesce(rejected_at, v_provider_time) else rejected_at end,
    refunded_amount = greatest(refunded_amount, v_refunded), internal_status = v_effective,
    raw_response_hash = p_snapshot ->> 'raw_response_hash'
  where id = v_intent.id;
  insert into public.payment_events (payment_intent_id, webhook_receipt_id, provider_event_id, event_type, provider_status, provider_status_detail, provider_occurred_at, raw_response_hash, details)
  values (v_intent.id, p_webhook_receipt_id, p_snapshot ->> 'provider_payment_id', 'payment.' || v_status,
    v_status, nullif(p_snapshot ->> 'status_detail', ''), v_provider_time, p_snapshot ->> 'raw_response_hash', jsonb_build_object('source', p_source));
  if v_status = 'approved' and v_effective = 'approved_order_pending' then
    if v_session.expires_at <= clock_timestamp() or not exists (
      select 1 from public.inventory_reservations r where r.checkout_session_id = v_session.id and r.status = 'active' and r.expires_at > clock_timestamp()
    ) then
      update public.payment_intents set internal_status = 'security_review_required', security_review_reason = 'approved_after_reservation_expired' where id = v_intent.id;
      update public.checkout_sessions set status = 'manual_review_required', manual_review_reason = 'approved_after_reservation_expired' where id = v_session.id;
      insert into public.payment_events (payment_intent_id, event_type, details, raw_response_hash)
      values (v_intent.id, 'payment.manual_review_required', jsonb_build_object('reason', 'approved_after_reservation_expired'), p_snapshot ->> 'raw_response_hash');
      return jsonb_build_object('ok', true, 'manual_review_required', true, 'finalize_required', false);
    end if;
    update public.checkout_sessions set status = 'payment_approved' where id = v_session.id;
    v_finalize := true;
  elsif v_status in ('pending', 'in_process', 'authorized') then
    update public.checkout_sessions set status = case when status in ('ready_for_payment', 'redirected') then 'payment_pending' else status end where id = v_session.id;
  elsif v_status = 'expired' then
    perform public.release_checkout_session_inventory(v_session.id, 'provider_expired', 'expired');
  elsif v_status in ('rejected', 'cancelled', 'canceled') then
    perform public.release_checkout_session_inventory(v_session.id, 'provider_' || v_status, 'cancelled');
  end if;
  return jsonb_build_object('ok', true, 'payment_intent_id', v_intent.id, 'internal_status', v_effective,
    'manual_review_required', false, 'finalize_required', v_finalize);
end;
$_$;


ALTER FUNCTION "public"."record_mercadopago_payment_snapshot"("p_payment_intent_id" "uuid", "p_snapshot" "jsonb", "p_source" "text", "p_webhook_receipt_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_mercadopago_preference_created"("p_payment_attempt_id" "uuid", "p_preference_id" "text", "p_init_point" "text", "p_sandbox_init_point" "text", "p_response_hash" "text", "p_provider_request_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
declare v_attempt public.payment_attempts%rowtype; v_intent public.payment_intents%rowtype;
begin
  if p_preference_id is null or btrim(p_preference_id) = '' or p_response_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'respuesta de preferencia invalida' using errcode = '22023';
  end if;
  select * into v_attempt from public.payment_attempts pa where pa.id = p_payment_attempt_id for update;
  if not found then raise exception 'attempt inexistente' using errcode = 'P0002'; end if;
  select * into v_intent from public.payment_intents pi where pi.id = v_attempt.payment_intent_id for update;
  update public.payment_attempts set preference_id = left(btrim(p_preference_id), 200),
    init_point = nullif(left(btrim(coalesce(p_init_point, '')), 2048), ''),
    sandbox_init_point = nullif(left(btrim(coalesce(p_sandbox_init_point, '')), 2048), ''),
    provider_request_id = nullif(left(btrim(coalesce(p_provider_request_id, '')), 200), ''),
    response_hash = p_response_hash, status = 'created' where id = v_attempt.id;
  update public.payment_intents set preference_id = left(btrim(p_preference_id), 200),
    preference_created_at = coalesce(preference_created_at, clock_timestamp()), raw_response_hash = p_response_hash,
    internal_status = case when internal_status in ('created', 'ambiguous', 'preference_creating') then 'preference_created' else internal_status end
  where id = v_intent.id;
  update public.checkout_sessions set status = case when status = 'ready_for_payment' then 'redirected' else status end where id = v_intent.checkout_session_id;
  return jsonb_build_object('ok', true, 'payment_intent_id', v_intent.id);
end;
$_$;


ALTER FUNCTION "public"."record_mercadopago_preference_created"("p_payment_attempt_id" "uuid", "p_preference_id" "text", "p_init_point" "text", "p_sandbox_init_point" "text", "p_response_hash" "text", "p_provider_request_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_mercadopago_preference_failed"("p_payment_attempt_id" "uuid", "p_response_hash" "text", "p_error_code" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
begin
  if p_response_hash !~ '^[a-f0-9]{64}$' then raise exception 'hash invalido' using errcode = '22023'; end if;
  update public.payment_attempts set status = 'failed', response_hash = p_response_hash,
    last_error_code = left(coalesce(p_error_code, 'provider_error'), 120) where id = p_payment_attempt_id;
  if not found then raise exception 'attempt inexistente' using errcode = 'P0002'; end if;
  return true;
end;
$_$;


ALTER FUNCTION "public"."record_mercadopago_preference_failed"("p_payment_attempt_id" "uuid", "p_response_hash" "text", "p_error_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_mercadopago_preference_uncertain"("p_payment_attempt_id" "uuid", "p_request_hash" "text", "p_error_code" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
declare v_intent_id uuid;
begin
  if p_request_hash !~ '^[a-f0-9]{64}$' then raise exception 'hash invalido' using errcode = '22023'; end if;
  update public.payment_attempts set status = 'ambiguous', request_hash = p_request_hash,
    last_error_code = left(coalesce(p_error_code, 'network_or_timeout'), 120)
   where id = p_payment_attempt_id returning payment_intent_id into v_intent_id;
  if v_intent_id is null then raise exception 'attempt inexistente' using errcode = 'P0002'; end if;
  update public.payment_intents set internal_status = case when internal_status = 'preference_creating' then 'ambiguous' else internal_status end where id = v_intent_id;
  return true;
end;
$_$;


ALTER FUNCTION "public"."record_mercadopago_preference_uncertain"("p_payment_attempt_id" "uuid", "p_request_hash" "text", "p_error_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_mercadopago_webhook_receipt"("p_environment" "text", "p_webhook_event_id" "text", "p_event_type" "text", "p_resource_id" "text", "p_signature_valid" boolean, "p_request_id" "text", "p_payload_hash" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
declare
  v_receipt public.payment_webhook_receipts%rowtype;
  v_topic text;
  v_job_id uuid;
begin
  if lower(btrim(coalesce(p_environment, ''))) not in ('test', 'production')
    or nullif(btrim(p_webhook_event_id), '') is null
    or nullif(btrim(p_event_type), '') is null
    or nullif(btrim(p_resource_id), '') is null
    or p_payload_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'receipt de webhook invalido' using errcode = '22023';
  end if;
  insert into public.payment_webhook_receipts (
    environment, webhook_event_id, event_type, resource_id, signature_valid,
    request_id, payload_hash, processing_status
  ) values (
    lower(btrim(p_environment)), left(btrim(p_webhook_event_id), 200),
    left(lower(btrim(p_event_type)), 120), left(btrim(p_resource_id), 200),
    p_signature_valid, nullif(left(btrim(coalesce(p_request_id, '')), 200), ''), p_payload_hash,
    case when p_signature_valid then 'received' else 'rejected_signature' end
  ) on conflict (provider, environment, webhook_event_id, event_type, resource_id) do nothing
  returning * into v_receipt;
  if not found then
    select * into v_receipt from public.payment_webhook_receipts r
     where r.provider = 'mercadopago' and r.environment = lower(btrim(p_environment))
       and r.webhook_event_id = left(btrim(p_webhook_event_id), 200)
       and r.event_type = left(lower(btrim(p_event_type)), 120)
       and r.resource_id = left(btrim(p_resource_id), 200)
     for update;
    update public.payment_webhook_receipts set attempt_count = attempt_count + 1,
      processing_status = case when processing_status = 'received' then 'duplicate' else processing_status end
    where id = v_receipt.id;
    return jsonb_build_object('receipt_id', v_receipt.id, 'duplicate', true, 'queued', false);
  end if;
  if not p_signature_valid then
    return jsonb_build_object('receipt_id', v_receipt.id, 'duplicate', false, 'queued', false);
  end if;
  v_topic := case
    when lower(p_event_type) like '%chargeback%' then 'chargeback'
    when lower(p_event_type) like '%claim%' then 'claim'
    when lower(p_event_type) like '%payment%' then 'payment'
    else null
  end;
  if v_topic is null then
    update public.payment_webhook_receipts set processing_status = 'completed', processed_at = clock_timestamp() where id = v_receipt.id;
    return jsonb_build_object('receipt_id', v_receipt.id, 'duplicate', false, 'queued', false);
  end if;
  insert into public.payment_outbox (webhook_receipt_id, topic, resource_id)
  values (v_receipt.id, v_topic, left(btrim(p_resource_id), 200))
  on conflict (webhook_receipt_id) where webhook_receipt_id is not null do nothing
  returning id into v_job_id;
  update public.payment_webhook_receipts set processing_status = 'queued' where id = v_receipt.id;
  return jsonb_build_object('receipt_id', v_receipt.id, 'duplicate', false, 'queued', v_job_id is not null);
end;
$_$;


ALTER FUNCTION "public"."record_mercadopago_webhook_receipt"("p_environment" "text", "p_webhook_event_id" "text", "p_event_type" "text", "p_resource_id" "text", "p_signature_valid" boolean, "p_request_id" "text", "p_payload_hash" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_packing_scan"("p_session_id" "uuid", "p_gtin" "text", "p_scan_key" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
declare
  v_session public.order_packing_sessions%rowtype;
  v_barcode public.product_barcodes%rowtype;
  v_item public.order_items%rowtype;
  v_existing public.order_packing_scans%rowtype;
  v_scanned integer;
  v_complete boolean;
begin
  if btrim(coalesce(p_scan_key,'')) !~ '^[A-Za-z0-9:_-]{8,128}$' then
    raise exception 'scan_key invalida' using errcode='22023';
  end if;
  select s.* into v_session
  from public.order_packing_sessions s where s.id=p_session_id for update;
  if not found then raise exception 'sesion inexistente' using errcode='P0002'; end if;
  if not public.has_business_role(v_session.business_id,array['owner','admin','staff']) then
    raise exception 'operador no autorizado' using errcode='42501';
  end if;

  select b.* into v_barcode
  from public.product_barcodes b
  where b.business_id=v_session.business_id and b.gtin=p_gtin and b.is_active;
  if not found then raise exception 'producto desconocido' using errcode='P0002'; end if;

  select s.* into v_existing
  from public.order_packing_scans s
  where s.session_id=v_session.id and s.scan_key=p_scan_key;
  if found then
    if v_existing.barcode_id<>v_barcode.id then
      raise exception 'scan_key reutilizada con otro codigo' using errcode='23505';
    end if;
    return jsonb_build_object(
      'ok',v_existing.reverted_at is null,
      'idempotent_replay',true,
      'reverted',v_existing.reverted_at is not null,
      'scan_key',v_existing.scan_key,
      'product_id',v_existing.product_id,
      'unit_factor',v_existing.unit_factor
    );
  end if;

  if v_session.status not in ('in_progress','complete') then
    raise exception 'sesion cerrada' using errcode='P0001';
  end if;
  select oi.* into v_item
  from public.order_items oi
  where oi.order_id=v_session.order_id and oi.product_uuid=v_barcode.product_id
  order by oi.id limit 1;
  if not found then raise exception 'producto equivocado' using errcode='23514'; end if;
  select coalesce(sum(s.unit_factor),0)::integer into v_scanned
  from public.order_packing_scans s
  where s.session_id=v_session.id and s.order_item_id=v_item.id and s.reverted_at is null;
  if v_scanned+v_barcode.unit_factor>v_item.quantity then
    raise exception 'cantidad excedida' using errcode='23514';
  end if;

  insert into public.order_packing_scans(
    session_id,order_item_id,product_id,barcode_id,unit_factor,operator_id,scan_key
  ) values (
    v_session.id,v_item.id,v_barcode.product_id,v_barcode.id,v_barcode.unit_factor,auth.uid(),p_scan_key
  );
  select not exists(
    select 1 from public.order_items oi
    where oi.order_id=v_session.order_id
      and coalesce((select sum(ps.unit_factor) from public.order_packing_scans ps where ps.session_id=v_session.id and ps.order_item_id=oi.id and ps.reverted_at is null),0)<>oi.quantity
  ) into v_complete;
  update public.order_packing_sessions
  set status=case when v_complete then 'complete' else 'in_progress' end,updated_at=now()
  where id=v_session.id;
  return jsonb_build_object(
    'ok',true,'complete',v_complete,'idempotent_replay',false,
    'scan_key',p_scan_key,'product_id',v_barcode.product_id,'unit_factor',v_barcode.unit_factor
  );
end;
$_$;


ALTER FUNCTION "public"."record_packing_scan"("p_session_id" "uuid", "p_gtin" "text", "p_scan_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_payment_cancellation_response"("p_cancellation_id" "uuid", "p_status" "text", "p_response_hash" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
declare v_cancellation public.payment_cancellations%rowtype; v_intent public.payment_intents%rowtype;
begin
  if p_status not in ('cancelled', 'rejected', 'ambiguous', 'failed') or p_response_hash !~ '^[a-f0-9]{64}$' then raise exception 'respuesta de cancelacion invalida' using errcode = '22023'; end if;
  select * into v_cancellation from public.payment_cancellations c where c.id = p_cancellation_id for update;
  if not found then raise exception 'cancelacion inexistente' using errcode = 'P0002'; end if;
  select * into v_intent from public.payment_intents pi where pi.id = v_cancellation.payment_intent_id for update;
  update public.payment_cancellations set status = p_status, raw_response_hash = p_response_hash,
    completed_at = case when p_status in ('cancelled', 'rejected') then clock_timestamp() else completed_at end where id = v_cancellation.id;
  if p_status = 'cancelled' then
    update public.payment_intents set internal_status = case when public.payment_internal_status_rank(internal_status) < public.payment_internal_status_rank('cancelled') then 'cancelled' else internal_status end where id = v_intent.id;
    perform public.release_checkout_session_inventory(v_intent.checkout_session_id, 'owner_cancelled_payment', 'cancelled');
  end if;
  insert into public.payment_events (payment_intent_id, event_type, details, raw_response_hash) values (v_intent.id, 'payment.cancellation_' || p_status, jsonb_build_object('cancellation_id', v_cancellation.id), p_response_hash);
  return jsonb_build_object('ok', true, 'payment_intent_id', v_intent.id);
end;
$_$;


ALTER FUNCTION "public"."record_payment_cancellation_response"("p_cancellation_id" "uuid", "p_status" "text", "p_response_hash" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_payment_refund_response"("p_refund_id" "uuid", "p_provider_refund_id" "text", "p_status" "text", "p_amount" numeric, "p_response_hash" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
declare
  v_refund public.payment_refunds%rowtype;
  v_intent public.payment_intents%rowtype;
  v_total numeric(12, 2);
begin
  if p_response_hash !~ '^[a-f0-9]{64}$'
    or p_status not in ('approved', 'rejected', 'ambiguous', 'failed')
    or p_amount is null or p_amount <= 0 then
    raise exception 'respuesta de reembolso invalida' using errcode = '22023';
  end if;
  select * into v_refund from public.payment_refunds r where r.id = p_refund_id for update;
  if not found then raise exception 'reembolso inexistente' using errcode = 'P0002'; end if;
  select * into v_intent from public.payment_intents pi where pi.id = v_refund.payment_intent_id for update;
  if p_amount <> v_refund.amount then
    update public.payment_intents
       set internal_status = 'security_review_required', security_review_reason = 'refund_amount_mismatch'
     where id = v_intent.id;
    raise exception 'importe de reembolso no coincide' using errcode = '22023';
  end if;
  update public.payment_refunds
     set provider_refund_id = nullif(left(btrim(coalesce(p_provider_refund_id, '')), 200), ''),
         status = p_status,
         raw_response_hash = p_response_hash,
         completed_at = case when p_status in ('approved', 'rejected') then clock_timestamp() else completed_at end
   where id = v_refund.id;
  if p_status = 'approved' then
    select coalesce(sum(r.amount), 0) into v_total
      from public.payment_refunds r
     where r.payment_intent_id = v_intent.id and r.status = 'approved';
    -- A payment that was held for stock review remains visibly held for review;
    -- the approved refund is exposed through the refund state without allowing
    -- the monotonic payment state trigger to erase the security hold.
    if v_intent.internal_status = 'security_review_required' then
      update public.payment_intents set refunded_amount = v_total where id = v_intent.id;
    else
      update public.payment_intents
         set refunded_amount = v_total,
             internal_status = case
               when v_total >= coalesce(v_intent.paid_amount, v_intent.expected_amount) then 'refunded'
               else 'partially_refunded'
             end
       where id = v_intent.id;
    end if;
  end if;
  insert into public.payment_events (payment_intent_id, event_type, details, raw_response_hash)
  values (v_intent.id, 'payment.refund_' || p_status, jsonb_build_object('refund_id', v_refund.id, 'amount', p_amount), p_response_hash);
  return jsonb_build_object('ok', true, 'payment_intent_id', v_intent.id);
end;
$_$;


ALTER FUNCTION "public"."record_payment_refund_response"("p_refund_id" "uuid", "p_provider_refund_id" "text", "p_status" "text", "p_amount" numeric, "p_response_hash" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_provider_probe_empty"("p_payment_intent_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  insert into public.payment_events (payment_intent_id, event_type, details)
  values (
    p_payment_intent_id,
    'payment.provider_probe_empty',
    jsonb_build_object('source', 'provider_truth_sweep')
  );
end;
$$;


ALTER FUNCTION "public"."record_provider_probe_empty"("p_payment_intent_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."record_provider_probe_empty"("p_payment_intent_id" "uuid") IS 'Marca que el proveedor no tiene ningun pago para esa referencia. Es lo que hace terminar la sonda.';



CREATE OR REPLACE FUNCTION "public"."record_service_health_signal"("p_business_id" "uuid", "p_service" "text", "p_severity" "text", "p_signal_code" "text", "p_status" "text", "p_correlation_id" "uuid", "p_observed_at" timestamp with time zone, "p_expires_at" timestamp with time zone, "p_details" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_id uuid;
begin
  if p_observed_at > clock_timestamp() + interval '5 minutes'
    or p_expires_at <= p_observed_at
    or p_expires_at > p_observed_at + interval '7 days' then
    raise exception 'ventana de health signal invalida' using errcode = '22023';
  end if;
  insert into public.service_health_signals(
    business_id, service, severity, signal_code, status, correlation_id,
    observed_at, expires_at, details
  ) values (
    p_business_id, p_service, p_severity, p_signal_code, p_status,
    p_correlation_id, p_observed_at, p_expires_at, coalesce(p_details, '{}'::jsonb)
  ) returning id into v_id;
  return v_id;
end;
$$;


ALTER FUNCTION "public"."record_service_health_signal"("p_business_id" "uuid", "p_service" "text", "p_severity" "text", "p_signal_code" "text", "p_status" "text", "p_correlation_id" "uuid", "p_observed_at" timestamp with time zone, "p_expires_at" timestamp with time zone, "p_details" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recover_order_tracking_access"("p_order_id" "uuid", "p_new_tracking_token" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
declare
  v_order public.orders%rowtype;
  v_handoff public.order_delivery_handoffs%rowtype;
  v_random bytea;
  v_code text;
  v_token_expires_at timestamptz;
  v_code_expires_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if p_order_id is null
    or p_new_tracking_token is null
    or p_new_tracking_token !~ '^[A-Za-z0-9_-]{32,255}[A-Za-z0-9_-]?$' then
    raise exception 'credenciales de seguimiento invalidas' using errcode = '22023';
  end if;

  select o.*
    into v_order
    from public.orders o
   where o.id = p_order_id
     and o.customer_user_id = auth.uid()
     and o.delivery_mode = 'delivery'
     and o.status not in ('delivered', 'canceled', 'cancelled', 'rejected')
   for update;

  if not found then
    raise exception 'pedido no encontrado o acceso denegado' using errcode = '42501';
  end if;

  select h.*
    into v_handoff
    from public.order_delivery_handoffs h
   where h.order_id = v_order.id
   for update;

  if found and v_handoff.confirmed_at is not null then
    raise exception 'entrega ya confirmada' using errcode = '55000';
  end if;

  v_token_expires_at := clock_timestamp() + interval '30 days';
  v_code_expires_at := clock_timestamp() + interval '48 hours';

  v_random := gen_random_bytes(3);
  v_code := (
    1000 + (
      get_byte(v_random, 0)::bigint * 65536
      + get_byte(v_random, 1)::bigint * 256
      + get_byte(v_random, 2)::bigint
    ) % 9000
  )::text;

  update public.order_public_tokens
     set revoked_at = coalesce(revoked_at, clock_timestamp())
   where order_id = v_order.id
     and revoked_at is null;

  insert into public.order_public_tokens (
    order_id,
    token_hash,
    expires_at
  ) values (
    v_order.id,
    digest(p_new_tracking_token, 'sha256'),
    v_token_expires_at
  );

  -- A rotated digest has no operational value. Remove prior revoked digests for
  -- this order so repeated recovery does not create indefinite bearer history.
  delete from public.order_public_tokens
   where order_id = v_order.id
     and revoked_at is not null;

  insert into public.order_delivery_handoffs (
    order_id,
    code_hash,
    code_ciphertext,
    failed_attempts,
    locked_until,
    confirmed_at,
    confirmed_by_user_id,
    expires_at
  ) values (
    v_order.id,
    crypt(v_code, gen_salt('bf', 10)),
    pgp_sym_encrypt(v_code, p_new_tracking_token, 'cipher-algo=aes256,compress-algo=0'),
    0,
    null,
    null,
    null,
    least(v_token_expires_at, v_code_expires_at)
  )
  on conflict (order_id) do update
     set code_hash = excluded.code_hash,
         code_ciphertext = excluded.code_ciphertext,
         failed_attempts = 0,
         locked_until = null,
         confirmed_at = null,
         confirmed_by_user_id = null,
         expires_at = excluded.expires_at;

  update public.orders
     set delivery_code_required = true
   where id = v_order.id;

  insert into public.order_events (
    order_id,
    business_id,
    actor_user_id,
    actor_role,
    actor_type,
    actor_id,
    event_type,
    type,
    message,
    metadata,
    payload
  ) values (
    v_order.id,
    v_order.business_id,
    auth.uid(),
    'customer',
    'customer',
    auth.uid(),
    'order.tracking_access_recovered',
    'order.tracking_access_recovered',
    'Acceso de seguimiento recuperado por el cliente',
    jsonb_build_object('rotated_at', clock_timestamp()),
    jsonb_build_object('rotated_at', clock_timestamp())
  );

  return jsonb_build_object(
    'ok', true,
    'public_code', v_order.public_code,
    'delivery_code', v_code,
    'token_expires_at', v_token_expires_at,
    'code_expires_at', least(v_token_expires_at, v_code_expires_at)
  );
end;
$_$;


ALTER FUNCTION "public"."recover_order_tracking_access"("p_order_id" "uuid", "p_new_tracking_token" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."recover_order_tracking_access"("p_order_id" "uuid", "p_new_tracking_token" "text") IS 'Authenticated customer rotation for a lost tracking bearer and unconfirmed handoff code.';



CREATE OR REPLACE FUNCTION "public"."recover_paid_checkout_order"("p_checkout_session_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_actor uuid := auth.uid();
  v_session public.checkout_sessions%rowtype;
  v_intent public.payment_intents%rowtype;
  v_item record;
  v_product public.products%rowtype;
  v_generation integer;
  v_expires timestamptz;
  v_faltantes jsonb := '[]'::jsonb;
  v_resultado jsonb;
begin
  select * into v_session
    from public.checkout_sessions s
   where s.id = p_checkout_session_id
   for update;
  if not found then
    raise exception 'checkout inexistente' using errcode = 'P0002';
  end if;
  if v_actor is null
    or not public.has_business_role(v_session.business_id, array['owner', 'admin']) then
    raise exception 'recuperacion no autorizada' using errcode = '42501';
  end if;

  -- Tocar dos veces no puede crear dos pedidos.
  if v_session.completed_order_id is not null then
    return jsonb_build_object(
      'ok', true, 'idempotent', true, 'order_id', v_session.completed_order_id
    );
  end if;

  select * into v_intent
    from public.payment_intents pi
   where pi.checkout_session_id = v_session.id
   for update;
  if not found
    or v_intent.provider_status <> 'approved'
    or v_intent.paid_amount is distinct from v_session.total
    or v_intent.currency <> 'ARS' then
    raise exception 'este checkout no tiene un cobro aprobado y verificado' using errcode = '55000';
  end if;
  if v_intent.order_id is not null then
    return jsonb_build_object('ok', true, 'idempotent', true, 'order_id', v_intent.order_id);
  end if;
  if v_intent.internal_status in ('refunded', 'partially_refunded', 'charged_back') then
    raise exception 'el dinero de este cobro ya se movio' using errcode = '55000';
  end if;

  -- Si la reserva sigue viva no hace falta nada de esto: el camino normal
  -- alcanza y es el que tiene que correr.
  if exists (
    select 1 from public.inventory_reservations r
     where r.checkout_session_id = v_session.id
       and r.status = 'active'
       and r.expires_at > clock_timestamp()
  ) then
    update public.payment_intents
       set internal_status = 'approved_order_pending', security_review_reason = null
     where id = v_intent.id
       and internal_status = 'security_review_required';
    update public.checkout_sessions
       set status = 'payment_approved', manual_review_reason = null
     where id = v_session.id;
    return public.finalize_paid_checkout_session(v_session.id) || jsonb_build_object('reused_reservation', true);
  end if;

  -- Se mira TODO el pedido antes de descontar nada: media recuperaci�n deja el
  -- stock movido y el pedido igual de inexistente.
  for v_item in
    select i.product_id, i.quantity, i.product_snapshot
      from public.checkout_session_items i
     where i.checkout_session_id = v_session.id
     order by i.product_id
  loop
    select * into v_product
      from public.products p
     where p.id = v_item.product_id
     for update;
    if not found or not v_product.is_active or v_product.stock is null
      or v_product.stock < v_item.quantity then
      v_faltantes := v_faltantes || jsonb_build_object(
        'product_id', v_item.product_id,
        'name', coalesce(v_item.product_snapshot ->> 'name', 'Producto'),
        'necesarias', v_item.quantity,
        'disponibles', coalesce(v_product.stock, 0)
      );
    end if;
  end loop;

  if jsonb_array_length(v_faltantes) > 0 then
    return jsonb_build_object(
      'ok', false,
      'reason', 'stock_insuficiente',
      'missing', v_faltantes,
      'action', 'devolver_el_dinero_desde_el_panel'
    );
  end if;

  v_expires := clock_timestamp() + interval '10 minutes';
  select coalesce(max(r.reservation_generation), 0) + 1
    into v_generation
    from public.inventory_reservations r
   where r.checkout_session_id = v_session.id;

  for v_item in
    select i.product_id, i.quantity
      from public.checkout_session_items i
     where i.checkout_session_id = v_session.id
     order by i.product_id
  loop
    update public.products p
       set stock = p.stock - v_item.quantity,
           available = case when p.stock - v_item.quantity > 0 then p.available else false end
     where p.id = v_item.product_id;
    insert into public.inventory_reservations (
      checkout_session_id, product_id, quantity, expires_at, reservation_generation
    ) values (
      v_session.id, v_item.product_id, v_item.quantity, v_expires, v_generation
    );
  end loop;

  update public.checkout_sessions
     set expires_at = v_expires,
         status = 'payment_approved',
         manual_review_reason = null
   where id = v_session.id;
  update public.payment_intents
     set internal_status = 'approved_order_pending',
         security_review_reason = null
   where id = v_intent.id;
  insert into public.payment_events (payment_intent_id, event_type, details)
  values (
    v_intent.id,
    'payment.order_recovered_by_operator',
    jsonb_build_object('actor_user_id', v_actor, 'reservation_generation', v_generation)
  );

  v_resultado := public.finalize_paid_checkout_session(v_session.id);
  return v_resultado || jsonb_build_object('recovered', true, 'reservation_generation', v_generation);
end;
$$;


ALTER FUNCTION "public"."recover_paid_checkout_order"("p_checkout_session_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."recover_paid_checkout_order"("p_checkout_session_id" "uuid") IS 'Owner/admin: rearma el pedido de un cobro aprobado cuya reserva vencio. Si el stock no alcanza no inventa el pedido: dice que falta para que el operador reembolse.';



CREATE OR REPLACE FUNCTION "public"."refresh_operational_alerts"("p_business_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
begin
  if not public.has_business_role(p_business_id, array['owner','admin','staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  return public.reconcile_operational_alerts_for_business(p_business_id);
end;
$$;


ALTER FUNCTION "public"."refresh_operational_alerts"("p_business_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."refresh_operational_alerts"("p_business_id" "uuid") IS 'Reconcilia las alertas operativas del negocio para un operador autorizado. El calculo vive en reconcile_operational_alerts_for_business y ademas corre solo cada minuto.';



CREATE OR REPLACE FUNCTION "public"."register_catalog_assets"("p_business_id" "uuid", "p_assets" "jsonb") RETURNS TABLE("asset_id" "uuid", "registered_external_id" "text", "registered_sku" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
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
$_$;


ALTER FUNCTION "public"."register_catalog_assets"("p_business_id" "uuid", "p_assets" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."release_checkout_session_inventory"("p_checkout_session_id" "uuid", "p_reason" "text", "p_terminal_status" "text" DEFAULT 'cancelled'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_session public.checkout_sessions%rowtype;
  v_reservation public.inventory_reservations%rowtype;
  v_released integer := 0;
  v_status text := lower(btrim(coalesce(p_terminal_status, 'cancelled')));
begin
  if v_status not in ('cancelled', 'expired') then
    raise exception 'estado terminal de reserva invalido' using errcode = '22023';
  end if;
  select * into v_session
    from public.checkout_sessions s
   where s.id = p_checkout_session_id
   for update;
  if not found then
    raise exception 'checkout inexistente' using errcode = 'P0002';
  end if;
  if v_session.status in ('completed', 'payment_approved', 'finalizing_order', 'manual_review_required') then
    return jsonb_build_object('released', 0, 'skipped', true, 'status', v_session.status);
  end if;

  -- Products are locked in deterministic order before stock is restored.
  perform 1
    from public.products p
    join public.inventory_reservations r on r.product_id = p.id
   where r.checkout_session_id = v_session.id and r.status = 'active'
   order by p.id
   for update;
  for v_reservation in
    select * from public.inventory_reservations r
     where r.checkout_session_id = v_session.id and r.status = 'active'
     order by r.product_id, r.reservation_generation
     for update
  loop
    update public.products p
       set stock = p.stock + v_reservation.quantity,
           available = p.is_active and p.is_verified and (p.stock + v_reservation.quantity) > 0
     where p.id = v_reservation.product_id;
    update public.inventory_reservations
       set status = 'released', released_at = clock_timestamp(),
           release_reason = left(coalesce(p_reason, 'terminal'), 120)
     where id = v_reservation.id and status = 'active';
    v_released := v_released + 1;
  end loop;
  update public.checkout_sessions
     set status = v_status
   where id = v_session.id
     and status not in ('completed', 'payment_approved', 'finalizing_order', 'manual_review_required');
  update public.payment_intents
     set internal_status = case
       when public.payment_internal_status_rank(internal_status) < public.payment_internal_status_rank(v_status)
         then v_status else internal_status end
   where checkout_session_id = v_session.id;
  return jsonb_build_object('released', v_released, 'status', v_status);
end;
$$;


ALTER FUNCTION "public"."release_checkout_session_inventory"("p_checkout_session_id" "uuid", "p_reason" "text", "p_terminal_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."release_expired_stock_reservations"("p_limit" integer DEFAULT 100) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_order public.orders%rowtype;
  v_count integer := 0;
begin
  for v_order in
    select *
      from public.orders
     where reservation_expires_at < clock_timestamp()
       and inventory_released_at is null
       and status in ('received', 'submitted')
     order by reservation_expires_at
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 100), 500))
  loop
    update public.products p
       set stock = p.stock + oi.quantity::integer,
           available = p.is_verified and p.is_active
      from public.order_items oi
     where oi.order_id = v_order.id
       and oi.product_uuid = p.id;

    update public.orders
       set status = 'canceled',
           canceled_at = clock_timestamp(),
           inventory_released_at = clock_timestamp(),
           updated_at = clock_timestamp()
     where id = v_order.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;


ALTER FUNCTION "public"."release_expired_stock_reservations"("p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."release_expired_stock_reservations"("p_limit" integer) IS 'Trusted scheduled cleanup for expired stock reservations; never expose to browser roles.';



CREATE OR REPLACE FUNCTION "public"."release_or_reassign_delivery"("p_order_id" "uuid", "p_expected_revision" bigint, "p_new_rider_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_order public.orders%rowtype;
begin
  if auth.uid() is null then raise exception 'autenticacion requerida' using errcode = '42501'; end if;
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'pedido inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_order.business_id, array['owner', 'admin', 'staff']) then raise exception 'rol de negocio requerido' using errcode = '42501'; end if;
  if v_order.revision <> p_expected_revision then raise exception 'revision desactualizada' using errcode = '40001'; end if;
  if v_order.status not in ('ready', 'assigned') or v_order.delivery_mode <> 'delivery' then raise exception 'reasignacion no permitida despues de retiro' using errcode = '23514'; end if;
  if p_new_rider_user_id is not null then
    perform 1 from public.business_members bm where bm.business_id = v_order.business_id and bm.user_id = p_new_rider_user_id and bm.role = 'rider' and bm.is_active = true for share;
    if not found then raise exception 'rider activo requerido' using errcode = '42501'; end if;
  end if;
  update public.orders set assigned_rider_user_id = p_new_rider_user_id, status = case when p_new_rider_user_id is null then 'ready' else 'assigned' end where id = v_order.id;
  return public.rider_active_delivery_payload(v_order.id);
end;
$$;


ALTER FUNCTION "public"."release_or_reassign_delivery"("p_order_id" "uuid", "p_expected_revision" bigint, "p_new_rider_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."report_rider_delivery_issue"("p_order_id" "uuid", "p_expected_revision" bigint, "p_issue_type" "text", "p_idempotency_key" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_order public.orders%rowtype;
  v_key text := public.rider_validate_idempotency_key(p_idempotency_key);
  v_issue text := lower(btrim(coalesce(p_issue_type, '')));
  v_result jsonb;
begin
  if v_issue not in ('customer_unavailable', 'unsafe_location', 'vehicle_problem', 'wrong_address', 'business_issue', 'payment_issue', 'other') then
    raise exception 'tipo de incidencia invalido' using errcode = '22023';
  end if;
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_assigned'); end if;
  perform public.rider_require_active_membership(v_order.business_id);
  if v_order.assigned_rider_user_id is distinct from auth.uid() then return jsonb_build_object('ok', false, 'code', 'not_assigned'); end if;
  select result into v_result from public.rider_delivery_operations
   where order_id = v_order.id and rider_user_id = auth.uid() and operation = 'report_issue' and idempotency_key = v_key for share;
  if found then return v_result || jsonb_build_object('idempotent_no_op', true); end if;
  if v_order.revision <> p_expected_revision then return jsonb_build_object('ok', false, 'code', 'stale_revision', 'revision', v_order.revision); end if;
  if v_order.status not in ('assigned', 'picked_up', 'on_the_way', 'arrived') then return jsonb_build_object('ok', false, 'code', 'terminal', 'revision', v_order.revision); end if;
  insert into public.rider_delivery_issues(business_id, order_id, rider_id, issue_type, request_id)
  values (v_order.business_id, v_order.id, auth.uid(), v_issue, v_key);
  insert into public.delivery_outbox(business_id, order_id, event_type, event_key, payload)
  values (v_order.business_id, v_order.id, 'rider_issue_reported', v_key, jsonb_build_object('issue_type', v_issue))
  on conflict (order_id, event_type, event_key) do nothing;
  insert into public.order_events(order_id, business_id, actor_user_id, actor_role, actor_type, actor_id, event_type, type, message, metadata, payload)
  values (v_order.id, v_order.business_id, auth.uid(), 'rider', 'rider', auth.uid(), 'order.rider_issue_reported', 'order.rider_issue_reported', 'Rider reporto una incidencia', jsonb_build_object('issue_type', v_issue), jsonb_build_object('issue_type', v_issue));
  v_result := jsonb_build_object('ok', true, 'outcome', 'issue_reported', 'idempotent_no_op', false, 'order', public.rider_active_delivery_payload(v_order.id));
  insert into public.rider_delivery_operations(order_id, rider_user_id, operation, idempotency_key, request_fingerprint, result)
  values (v_order.id, auth.uid(), 'report_issue', v_key, digest(jsonb_build_object('revision', p_expected_revision, 'issue_type', v_issue)::text, 'sha256'), v_result);
  return v_result;
end;
$$;


ALTER FUNCTION "public"."report_rider_delivery_issue"("p_order_id" "uuid", "p_expected_revision" bigint, "p_issue_type" "text", "p_idempotency_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."request_credit_note"("p_original_document_id" "uuid", "p_reason" "text", "p_credit_kind" "text", "p_lines" "jsonb", "p_idempotency_key" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'lineas de nota invalidas' using errcode = '22023';
  end if;
  return public.request_credit_note_unchecked(
    p_original_document_id, p_reason, p_credit_kind, p_lines, p_idempotency_key
  );
end;
$$;


ALTER FUNCTION "public"."request_credit_note"("p_original_document_id" "uuid", "p_reason" "text", "p_credit_kind" "text", "p_lines" "jsonb", "p_idempotency_key" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."request_credit_note"("p_original_document_id" "uuid", "p_reason" "text", "p_credit_kind" "text", "p_lines" "jsonb", "p_idempotency_key" "text") IS 'Valida lineas JSON antes de invocar el flujo idempotente de notas de credito.';



CREATE OR REPLACE FUNCTION "public"."request_credit_note_unchecked"("p_original_document_id" "uuid", "p_reason" "text", "p_credit_kind" "text", "p_lines" "jsonb", "p_idempotency_key" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
declare
  v_original public.fiscal_documents%rowtype;
  v_document public.fiscal_documents%rowtype;
  v_existing public.fiscal_documents%rowtype;
  v_profile public.fiscal_profiles%rowtype;
  v_policy public.fiscal_accounting_policies%rowtype;
  v_line jsonb;
  v_item public.fiscal_document_items%rowtype;
  v_reserved_quantity numeric(14,3);
  v_reserved_net numeric(14,2);
  v_reserved_tax numeric(14,2);
  v_reserved_exempt numeric(14,2);
  v_reserved_non_taxed numeric(14,2);
  v_reserved_other numeric(14,2);
  v_quantity numeric(14,3);
  v_net numeric(14,2);
  v_tax numeric(14,2);
  v_exempt numeric(14,2);
  v_non_taxed numeric(14,2);
  v_other numeric(14,2);
  v_total numeric(14,2) := 0;
  v_total_net numeric(14,2) := 0;
  v_total_tax numeric(14,2) := 0;
  v_total_exempt numeric(14,2) := 0;
  v_total_non_taxed numeric(14,2) := 0;
  v_total_other numeric(14,2) := 0;
  v_issuer_condition text;
  v_recipient_condition text;
begin
  if p_credit_kind not in ('total','partial','commercial_adjustment')
    or jsonb_typeof(coalesce(p_lines,'[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_lines,'[]'::jsonb)) > 200
    or char_length(btrim(coalesce(p_reason,''))) not between 5 and 300
    or coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9:_-]{8,128}$'
  then raise exception 'solicitud de nota de credito invalida' using errcode='22023'; end if;
  select d.* into v_original from public.fiscal_documents d where d.id = p_original_document_id for update;
  if not found then raise exception 'comprobante original inexistente' using errcode='P0002'; end if;
  if not public.has_business_role(v_original.business_id,array['owner','admin']) then raise exception 'owner/admin requerido' using errcode='42501'; end if;
  if v_original.state not in ('authorized','credited') or v_original.document_intent <> 'invoice' or v_original.document_type < 1 then raise exception 'solo una factura autorizada admite nota de credito' using errcode='P0001'; end if;
  select d.* into v_existing from public.fiscal_documents d where d.business_id = v_original.business_id and d.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.document_intent <> 'credit_note' or v_existing.associated_document_id <> v_original.id then raise exception 'idempotency_key reutilizada con otra solicitud' using errcode='23505'; end if;
    return jsonb_build_object('fiscal_document_id',v_existing.id,'state',v_existing.state,'idempotent_replay',true);
  end if;
  select fp.* into v_profile from public.fiscal_profiles fp where fp.business_id = v_original.business_id for share;
  v_issuer_condition := coalesce(nullif(btrim(v_original.issuer_snapshot->>'tax_condition'),''), v_profile.tax_condition, '');
  v_recipient_condition := coalesce(nullif(btrim(v_original.recipient_snapshot->>'condition'),''), nullif(btrim(v_original.recipient_type),''), '');
  v_policy := public.resolve_fiscal_accounting_policy(v_original.business_id, v_original.environment, v_issuer_condition, v_recipient_condition, v_original.concept, v_original.document_type, current_date);
  if p_credit_kind = 'commercial_adjustment' and not v_policy.allow_commercial_adjustment then raise exception 'fiscal_policy_review_required' using errcode='P0001'; end if;
  if p_credit_kind = 'total' and jsonb_array_length(p_lines) <> 0 then raise exception 'nota total no admite lineas manuales' using errcode='22023'; end if;
  if p_credit_kind <> 'total' and jsonb_array_length(p_lines) = 0 then raise exception 'nota parcial requiere lineas precisas' using errcode='22023'; end if;
  if p_credit_kind <> 'total' and (select count(distinct value->>'original_item_id') from jsonb_array_elements(p_lines)) <> jsonb_array_length(p_lines) then raise exception 'lineas de nota duplicadas' using errcode='22023'; end if;

  insert into public.fiscal_documents(
    business_id,source_type,source_id,document_intent,environment,cuit,point_of_sale,document_type,concept,currency,currency_rate,
    recipient_type,recipient_document_type,recipient_document_number,net_amount,tax_amount,exempt_amount,non_taxed_amount,other_taxes_amount,total_amount,
    state,idempotency_key,associated_document_id,issuer_snapshot,recipient_snapshot,associated_document_snapshot,fiscal_policy_version,credit_kind,credit_reason
  ) values (
    v_original.business_id,'credit_note',gen_random_uuid(),'credit_note',v_original.environment,v_original.cuit,v_original.point_of_sale,v_policy.credit_note_type,v_original.concept,v_original.currency,v_original.currency_rate,
    v_original.recipient_type,v_original.recipient_document_type,v_original.recipient_document_number,0,0,0,0,0,0,
    'queued',p_idempotency_key,v_original.id,v_original.issuer_snapshot,v_original.recipient_snapshot,
    jsonb_build_object('fiscal_document_id',v_original.id,'document_type',v_original.document_type,'point_of_sale',v_original.point_of_sale,'document_number',v_original.document_number,'issue_date',v_original.issue_date,'cae',v_original.cae),
    v_policy.policy_version,p_credit_kind,btrim(p_reason)
  ) returning * into v_document;

  if p_credit_kind = 'total' then
    for v_item in select * from public.fiscal_document_items i where i.fiscal_document_id = v_original.id order by i.id for share
    loop
      select coalesce(sum(a.quantity) filter(where a.state in ('reserved','authorized')),0),
             coalesce(sum(a.net_amount) filter(where a.state in ('reserved','authorized')),0),
             coalesce(sum(a.tax_amount) filter(where a.state in ('reserved','authorized')),0),
             coalesce(sum(a.exempt_amount) filter(where a.state in ('reserved','authorized')),0),
             coalesce(sum(a.non_taxed_amount) filter(where a.state in ('reserved','authorized')),0),
             coalesce(sum(a.other_taxes_amount) filter(where a.state in ('reserved','authorized')),0)
        into v_reserved_quantity,v_reserved_net,v_reserved_tax,v_reserved_exempt,v_reserved_non_taxed,v_reserved_other
      from public.fiscal_credit_allocations a where a.original_item_id = v_item.id;
      v_quantity := v_item.quantity - v_reserved_quantity;
      v_net := v_item.net_amount - v_reserved_net;
      v_tax := v_item.tax_amount - v_reserved_tax;
      v_exempt := v_item.exempt_amount - v_reserved_exempt;
      v_non_taxed := v_item.non_taxed_amount - v_reserved_non_taxed;
      v_other := v_item.other_taxes_amount - v_reserved_other;
      if v_quantity <= 0 or (v_net + v_tax + v_exempt + v_non_taxed + v_other) <= 0 then continue; end if;
      insert into public.fiscal_document_items(fiscal_document_id,description,quantity,unit_price,net_amount,tax_amount,tax_code,exempt_amount,non_taxed_amount,other_taxes_amount,tax_snapshot)
      values(v_document.id,concat('Nota de credito: ',v_item.description),v_quantity,round((v_net+v_tax+v_exempt+v_non_taxed+v_other)/v_quantity,2),v_net,v_tax,v_item.tax_code,v_exempt,v_non_taxed,v_other,v_item.tax_snapshot);
      insert into public.fiscal_credit_allocations(business_id,original_document_id,original_item_id,credit_document_id,quantity,net_amount,tax_amount,exempt_amount,non_taxed_amount,other_taxes_amount,total_amount,snapshot)
      values(v_original.business_id,v_original.id,v_item.id,v_document.id,v_quantity,v_net,v_tax,v_exempt,v_non_taxed,v_other,v_net+v_tax+v_exempt+v_non_taxed+v_other,jsonb_build_object('original_item_id',v_item.id,'original_quantity',v_item.quantity,'credit_kind',p_credit_kind));
      v_total_net := v_total_net + v_net; v_total_tax := v_total_tax + v_tax; v_total_exempt := v_total_exempt + v_exempt; v_total_non_taxed := v_total_non_taxed + v_non_taxed; v_total_other := v_total_other + v_other;
    end loop;
  else
    for v_line in select value from jsonb_array_elements(p_lines)
    loop
      if v_line - array['original_item_id','quantity','net_amount','tax_amount'] <> '{}'::jsonb
        or coalesce(v_line->>'original_item_id','') !~ '^[0-9a-fA-F-]{36}$'
        or coalesce(v_line->>'quantity','') !~ '^[0-9]+([.][0-9]{1,3})?$'
      then raise exception 'linea de nota invalida' using errcode='22023'; end if;
      select i.* into v_item from public.fiscal_document_items i where i.id = (v_line->>'original_item_id')::uuid and i.fiscal_document_id = v_original.id for share;
      if not found then raise exception 'item original invalido' using errcode='P0002'; end if;
      select coalesce(sum(a.quantity) filter(where a.state in ('reserved','authorized')),0),
             coalesce(sum(a.net_amount) filter(where a.state in ('reserved','authorized')),0),
             coalesce(sum(a.tax_amount) filter(where a.state in ('reserved','authorized')),0),
             coalesce(sum(a.exempt_amount) filter(where a.state in ('reserved','authorized')),0),
             coalesce(sum(a.non_taxed_amount) filter(where a.state in ('reserved','authorized')),0),
             coalesce(sum(a.other_taxes_amount) filter(where a.state in ('reserved','authorized')),0)
        into v_reserved_quantity,v_reserved_net,v_reserved_tax,v_reserved_exempt,v_reserved_non_taxed,v_reserved_other
      from public.fiscal_credit_allocations a where a.original_item_id = v_item.id;
      v_quantity := (v_line->>'quantity')::numeric;
      if v_quantity <= 0 or v_quantity > v_item.quantity - v_reserved_quantity then raise exception 'importe o cantidad excede el saldo acreditable' using errcode='23514'; end if;
      if p_credit_kind = 'partial' then
        if v_quantity = v_item.quantity - v_reserved_quantity then
          v_net := v_item.net_amount - v_reserved_net; v_tax := v_item.tax_amount - v_reserved_tax; v_exempt := v_item.exempt_amount - v_reserved_exempt; v_non_taxed := v_item.non_taxed_amount - v_reserved_non_taxed; v_other := v_item.other_taxes_amount - v_reserved_other;
        else
          v_net := round(v_item.net_amount * v_quantity / v_item.quantity,2); v_tax := round(v_item.tax_amount * v_quantity / v_item.quantity,2); v_exempt := round(v_item.exempt_amount * v_quantity / v_item.quantity,2); v_non_taxed := round(v_item.non_taxed_amount * v_quantity / v_item.quantity,2); v_other := round(v_item.other_taxes_amount * v_quantity / v_item.quantity,2);
        end if;
      else
        if coalesce(v_line->>'net_amount','') !~ '^[0-9]+([.][0-9]{1,2})?$' or coalesce(v_line->>'tax_amount','') !~ '^[0-9]+([.][0-9]{1,2})?$' then raise exception 'ajuste comercial requiere importes precisos' using errcode='22023'; end if;
        v_net := (v_line->>'net_amount')::numeric; v_tax := (v_line->>'tax_amount')::numeric; v_exempt := 0; v_non_taxed := 0; v_other := 0;
        if v_net > v_item.net_amount - v_reserved_net or v_tax > v_item.tax_amount - v_reserved_tax then raise exception 'importe o cantidad excede el saldo acreditable' using errcode='23514'; end if;
      end if;
      if v_net + v_tax + v_exempt + v_non_taxed + v_other <= 0 then raise exception 'nota de credito sin importe' using errcode='22023'; end if;
      insert into public.fiscal_document_items(fiscal_document_id,description,quantity,unit_price,net_amount,tax_amount,tax_code,exempt_amount,non_taxed_amount,other_taxes_amount,tax_snapshot)
      values(v_document.id,concat('Nota de credito: ',v_item.description),v_quantity,round((v_net+v_tax+v_exempt+v_non_taxed+v_other)/v_quantity,2),v_net,v_tax,v_item.tax_code,v_exempt,v_non_taxed,v_other,v_item.tax_snapshot);
      insert into public.fiscal_credit_allocations(business_id,original_document_id,original_item_id,credit_document_id,quantity,net_amount,tax_amount,exempt_amount,non_taxed_amount,other_taxes_amount,total_amount,snapshot)
      values(v_original.business_id,v_original.id,v_item.id,v_document.id,v_quantity,v_net,v_tax,v_exempt,v_non_taxed,v_other,v_net+v_tax+v_exempt+v_non_taxed+v_other,jsonb_build_object('original_item_id',v_item.id,'original_quantity',v_item.quantity,'credit_kind',p_credit_kind));
      v_total_net := v_total_net + v_net; v_total_tax := v_total_tax + v_tax; v_total_exempt := v_total_exempt + v_exempt; v_total_non_taxed := v_total_non_taxed + v_non_taxed; v_total_other := v_total_other + v_other;
    end loop;
  end if;
  v_total := v_total_net + v_total_tax + v_total_exempt + v_total_non_taxed + v_total_other;
  if v_total <= 0 then raise exception 'no existe saldo acreditable' using errcode='23514'; end if;
  update public.fiscal_documents
    set net_amount=v_total_net,tax_amount=v_total_tax,exempt_amount=v_total_exempt,non_taxed_amount=v_total_non_taxed,other_taxes_amount=v_total_other,total_amount=v_total
    where id=v_document.id;
  insert into public.fiscal_outbox(fiscal_document_id) values(v_document.id);
  insert into public.fiscal_events(fiscal_document_id,event_type,actor_type,actor_id,sanitized_detail)
  values(v_document.id,'credit_note_queued','operator',auth.uid(),jsonb_build_object('reason',btrim(p_reason),'associated_document_id',v_original.id,'credit_kind',p_credit_kind,'policy_version',v_policy.policy_version));
  return jsonb_build_object('fiscal_document_id',v_document.id,'state','queued','idempotent_replay',false);
end;
$_$;


ALTER FUNCTION "public"."request_credit_note_unchecked"("p_original_document_id" "uuid", "p_reason" "text", "p_credit_kind" "text", "p_lines" "jsonb", "p_idempotency_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."request_fiscal_artifact_regeneration"("p_fiscal_document_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_document public.fiscal_documents%rowtype;
  v_outbox public.fiscal_artifact_outbox%rowtype;
begin
  select d.* into v_document from public.fiscal_documents d where d.id = p_fiscal_document_id for update;
  if not found then raise exception 'comprobante fiscal inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_document.business_id, array['owner','admin']) then raise exception 'owner/admin requerido para regenerar' using errcode = '42501'; end if;
  if v_document.state not in ('authorized','credited') then raise exception 'solo se regenera un comprobante autorizado' using errcode = 'P0001'; end if;
  select o.* into v_outbox from public.fiscal_artifact_outbox o where o.fiscal_document_id = v_document.id for update;
  if found and v_outbox.state = 'leased' and v_outbox.lease_deadline > now() then raise exception 'ya existe una generacion en curso' using errcode = '40001'; end if;
  if found then
    update public.fiscal_artifact_outbox
      set state = 'pending', generation_token = gen_random_uuid(), lease_owner = null, lease_deadline = null,
          next_attempt_at = now(), last_error_code = null, last_error_message = null, processed_at = null
      where id = v_outbox.id;
  else
    insert into public.fiscal_artifact_outbox(fiscal_document_id) values (v_document.id);
  end if;
  update public.fiscal_documents
    set artifact_state = 'artifact_pending', artifact_error_code = null, artifact_error_message = null, artifact_updated_at = now()
    where id = v_document.id;
  insert into public.fiscal_events(fiscal_document_id, event_type, actor_type, actor_id, sanitized_detail)
  values(v_document.id, 'artifact_regeneration_requested', 'operator', auth.uid(), jsonb_build_object('authorized', true));
  return jsonb_build_object('fiscal_document_id', v_document.id, 'artifact_state', 'artifact_pending');
end;
$$;


ALTER FUNCTION "public"."request_fiscal_artifact_regeneration"("p_fiscal_document_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."request_fiscal_document"("p_business_id" "uuid", "p_source_type" "text", "p_source_id" "uuid", "p_document_intent" "text", "p_idempotency_key" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
declare
  v_profile public.fiscal_profiles%rowtype;
  v_sale public.pos_sales%rowtype;
  v_document public.fiscal_documents%rowtype;
  v_existing public.fiscal_documents%rowtype;
  v_policy public.fiscal_accounting_policies%rowtype;
  v_item public.pos_sale_items%rowtype;
  v_net numeric(14,2) := 0;
  v_tax numeric(14,2) := 0;
  v_exempt numeric(14,2) := 0;
  v_non_taxed numeric(14,2) := 0;
  v_other_taxes numeric(14,2) := 0;
  v_total numeric(14,2) := 0;
  v_tax_code integer;
begin
  if not public.has_business_role(p_business_id, array['owner','admin','staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  if p_source_type not in ('pos_sale','online_order') or p_document_intent <> 'invoice' or coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9:_-]{8,128}$' then raise exception 'intencion fiscal no soportada' using errcode = '22023'; end if;
  select d.* into v_existing from public.fiscal_documents d where d.business_id = p_business_id and d.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.source_type <> p_source_type or v_existing.source_id <> p_source_id or v_existing.document_intent <> p_document_intent then raise exception 'idempotency_key reutilizada con otra solicitud' using errcode = '23505'; end if;
    return jsonb_build_object('fiscal_document_id',v_existing.id,'state',v_existing.state,'idempotent_replay',true);
  end if;
  select fp.* into v_profile from public.fiscal_profiles fp where fp.business_id = p_business_id for share;
  if not found or not v_profile.is_enabled or v_profile.environment = 'disabled' then raise exception 'fiscalizacion deshabilitada' using errcode = 'P0001'; end if;
  if v_profile.environment = 'production' and (v_profile.accountant_review_status <> 'approved' or v_profile.production_gate_status <> 'approved') then raise exception 'produccion fiscal bloqueada' using errcode = '42501'; end if;
  if p_source_type <> 'pos_sale' then raise exception 'facturacion online requiere politica fiscal validada' using errcode='P0001'; end if;
  select s.* into v_sale from public.pos_sales s where s.id = p_source_id and s.business_id = p_business_id and s.state in ('completed_fiscal_pending','completed') for share;
  if not found then raise exception 'venta no confirmada' using errcode='P0002'; end if;
  if btrim(coalesce(v_profile.default_recipient_condition,'')) = '' then raise exception 'fiscal_policy_review_required' using errcode='P0001'; end if;

  select p.* into v_policy from public.fiscal_accounting_policies p
  where p.business_id = p_business_id and p.environment = v_profile.environment
    and p.issuer_condition = v_profile.tax_condition and p.recipient_condition = v_profile.default_recipient_condition
    and p.concept = v_profile.default_concept and p.enabled and p.accountant_review_status = 'approved'
    and p.valid_from <= current_date
  order by p.valid_from desc, p.created_at desc limit 1 for share;
  if not found then raise exception 'fiscal_policy_review_required' using errcode='P0001'; end if;
  v_policy := public.resolve_fiscal_accounting_policy(p_business_id, v_profile.environment, v_profile.tax_condition, v_profile.default_recipient_condition, v_profile.default_concept, v_policy.invoice_type, current_date);

  for v_item in select * from public.pos_sale_items i where i.sale_id = v_sale.id order by i.id
  loop
    if not (v_item.tax_snapshot ?& array['net_amount','tax_amount','exempt_amount','non_taxed_amount','other_taxes_amount'])
      or coalesce(v_item.tax_snapshot->>'net_amount','') !~ '^[0-9]+([.][0-9]{1,2})?$'
      or coalesce(v_item.tax_snapshot->>'tax_amount','') !~ '^[0-9]+([.][0-9]{1,2})?$'
      or coalesce(v_item.tax_snapshot->>'exempt_amount','') !~ '^[0-9]+([.][0-9]{1,2})?$'
      or coalesce(v_item.tax_snapshot->>'non_taxed_amount','') !~ '^[0-9]+([.][0-9]{1,2})?$'
      or coalesce(v_item.tax_snapshot->>'other_taxes_amount','') !~ '^[0-9]+([.][0-9]{1,2})?$'
    then raise exception 'fiscal_policy_review_required' using errcode='P0001'; end if;
    v_tax_code := case when coalesce(v_item.tax_snapshot->>'tax_code','') ~ '^[0-9]+$' then (v_item.tax_snapshot->>'tax_code')::integer else null end;
    if (v_item.tax_snapshot->>'tax_amount')::numeric > 0 and v_tax_code is null then raise exception 'fiscal_policy_review_required' using errcode='P0001'; end if;
    v_net := v_net + (v_item.tax_snapshot->>'net_amount')::numeric;
    v_tax := v_tax + (v_item.tax_snapshot->>'tax_amount')::numeric;
    v_exempt := v_exempt + (v_item.tax_snapshot->>'exempt_amount')::numeric;
    v_non_taxed := v_non_taxed + (v_item.tax_snapshot->>'non_taxed_amount')::numeric;
    v_other_taxes := v_other_taxes + (v_item.tax_snapshot->>'other_taxes_amount')::numeric;
  end loop;
  v_total := v_net + v_tax + v_exempt + v_non_taxed + v_other_taxes;
  if abs(v_total - v_sale.total) > 0.01 then raise exception 'snapshot impositivo no coincide con la venta' using errcode='23514'; end if;

  insert into public.fiscal_documents(
    business_id,source_type,source_id,document_intent,environment,cuit,point_of_sale,document_type,concept,currency,currency_rate,
    recipient_type,recipient_document_type,recipient_document_number,net_amount,tax_amount,exempt_amount,non_taxed_amount,other_taxes_amount,total_amount,
    state,idempotency_key,issuer_snapshot,recipient_snapshot,fiscal_policy_version
  ) values (
    p_business_id,p_source_type,p_source_id,p_document_intent,v_profile.environment,v_profile.cuit,v_profile.point_of_sale,v_policy.invoice_type,v_profile.default_concept,v_profile.default_currency,1,
    v_profile.default_recipient_condition,v_policy.recipient_document_type,v_policy.recipient_document_number,v_net,v_tax,v_exempt,v_non_taxed,v_other_taxes,v_total,
    'queued',p_idempotency_key,
    jsonb_build_object('legal_name',v_profile.legal_name,'cuit',v_profile.cuit,'tax_condition',v_profile.tax_condition,'address',v_profile.business_address,'gross_income_number',v_profile.gross_income_number),
    jsonb_build_object('condition',v_profile.default_recipient_condition,'document_type',v_policy.recipient_document_type,'document_number',v_policy.recipient_document_number),
    v_policy.policy_version
  ) returning * into v_document;
  for v_item in select * from public.pos_sale_items i where i.sale_id = v_sale.id order by i.id
  loop
    v_tax_code := case when coalesce(v_item.tax_snapshot->>'tax_code','') ~ '^[0-9]+$' then (v_item.tax_snapshot->>'tax_code')::integer else null end;
    insert into public.fiscal_document_items(fiscal_document_id,description,quantity,unit_price,net_amount,tax_amount,tax_code,exempt_amount,non_taxed_amount,other_taxes_amount,tax_snapshot)
    values(v_document.id,v_item.product_name,v_item.quantity,v_item.unit_price,(v_item.tax_snapshot->>'net_amount')::numeric,(v_item.tax_snapshot->>'tax_amount')::numeric,v_tax_code,(v_item.tax_snapshot->>'exempt_amount')::numeric,(v_item.tax_snapshot->>'non_taxed_amount')::numeric,(v_item.tax_snapshot->>'other_taxes_amount')::numeric,v_item.tax_snapshot);
  end loop;
  update public.pos_sales set fiscal_document_id = v_document.id, state = 'completed_fiscal_pending' where id = v_sale.id;
  insert into public.fiscal_outbox(fiscal_document_id) values(v_document.id);
  insert into public.fiscal_events(fiscal_document_id,event_type,actor_type,actor_id,sanitized_detail)
  values(v_document.id,'queued','operator',auth.uid(),jsonb_build_object('source_type',p_source_type,'policy_version',v_policy.policy_version));
  return jsonb_build_object('fiscal_document_id',v_document.id,'state','queued','idempotent_replay',false);
end;
$_$;


ALTER FUNCTION "public"."request_fiscal_document"("p_business_id" "uuid", "p_source_type" "text", "p_source_id" "uuid", "p_document_intent" "text", "p_idempotency_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."request_fiscal_print_job"("p_fiscal_document_id" "uuid", "p_artifact_id" "uuid", "p_printer_name_hash" "text", "p_format" "text", "p_copies" integer, "p_idempotency_key" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
declare
  v_document public.fiscal_documents%rowtype;
  v_artifact public.fiscal_document_artifacts%rowtype;
  v_job public.fiscal_print_jobs%rowtype;
begin
  if p_printer_name_hash !~ '^[0-9a-f]{64}$'
    or p_format not in ('a4','thermal')
    or p_copies not between 1 and 5
    or coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9:_-]{8,128}$'
  then raise exception 'solicitud de impresion invalida' using errcode = '22023'; end if;
  select d.* into v_document from public.fiscal_documents d where d.id = p_fiscal_document_id for share;
  if not found or not public.has_business_role(v_document.business_id, array['owner','admin','staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  select a.* into v_artifact from public.fiscal_document_artifacts a
    where a.id = p_artifact_id and a.fiscal_document_id = v_document.id and a.is_current and a.state = 'artifact_ready'
    for share;
  if not found then raise exception 'PDF fiscal no disponible para impresion' using errcode = 'P0001'; end if;
  select j.* into v_job from public.fiscal_print_jobs j where j.business_id = v_document.business_id and j.idempotency_key = p_idempotency_key;
  if found then return jsonb_build_object('print_job_id', v_job.id, 'status', v_job.status, 'idempotent_replay', true); end if;
  insert into public.fiscal_print_jobs(business_id, fiscal_document_id, artifact_id, printer_name_hash, format, copies, requested_by, idempotency_key)
  values(v_document.business_id, v_document.id, v_artifact.id, p_printer_name_hash, p_format, p_copies, auth.uid(), p_idempotency_key)
  returning * into v_job;
  insert into public.fiscal_events(fiscal_document_id, event_type, actor_type, actor_id, sanitized_detail)
  values(v_document.id, 'print_queued', 'operator', auth.uid(), jsonb_build_object('print_job_id', v_job.id, 'artifact_id', v_artifact.id, 'format', p_format, 'copies', p_copies));
  return jsonb_build_object('print_job_id', v_job.id, 'status', v_job.status, 'idempotent_replay', false);
end;
$_$;


ALTER FUNCTION "public"."request_fiscal_print_job"("p_fiscal_document_id" "uuid", "p_artifact_id" "uuid", "p_printer_name_hash" "text", "p_format" "text", "p_copies" integer, "p_idempotency_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."request_full_credit_note"("p_original_document_id" "uuid", "p_reason" "text", "p_idempotency_key" "text") RETURNS "jsonb"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
  select public.request_credit_note(p_original_document_id, p_reason, 'total', '[]'::jsonb, p_idempotency_key);
$$;


ALTER FUNCTION "public"."request_full_credit_note"("p_original_document_id" "uuid", "p_reason" "text", "p_idempotency_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."request_order_token"() RETURNS "text"
    LANGUAGE "plpgsql" STABLE
    AS $$
declare
  headers jsonb;
begin
  headers := nullif(current_setting('request.headers', true), '')::jsonb;
  return nullif(headers->>'x-order-token', '');
exception
  when others then
    return null;
end;
$$;


ALTER FUNCTION "public"."request_order_token"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."request_order_token_hash"() RETURNS "bytea"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
  select case
    when public.request_order_token() is null then null
    else digest(public.request_order_token(), 'sha256')
  end
$$;


ALTER FUNCTION "public"."request_order_token_hash"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fiscal_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "source_type" "text" NOT NULL,
    "source_id" "uuid" NOT NULL,
    "document_intent" "text" NOT NULL,
    "environment" "text" NOT NULL,
    "cuit" "text" NOT NULL,
    "point_of_sale" integer NOT NULL,
    "document_type" integer NOT NULL,
    "document_number" bigint,
    "issue_date" "date",
    "currency" "text" DEFAULT 'PES'::"text" NOT NULL,
    "recipient_type" "text",
    "recipient_document_type" integer,
    "recipient_document_number" "text",
    "net_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "tax_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "exempt_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "non_taxed_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "other_taxes_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "total_amount" numeric(14,2) NOT NULL,
    "state" "text" DEFAULT 'draft'::"text" NOT NULL,
    "result" "text",
    "cae" "text",
    "cae_expiration" "date",
    "observations" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "errors" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "request_hash" "text",
    "response_hash" "text",
    "idempotency_key" "text" NOT NULL,
    "associated_document_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "authorized_at" timestamp with time zone,
    "concept" integer DEFAULT 1 NOT NULL,
    "currency_rate" numeric(16,6) DEFAULT 1 NOT NULL,
    "issuer_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "recipient_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "associated_document_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "fiscal_policy_version" "text",
    "credit_kind" "text",
    "credit_reason" "text",
    "artifact_state" "text" DEFAULT 'artifact_pending'::"text" NOT NULL,
    "artifact_error_code" "text",
    "artifact_error_message" "text",
    "artifact_updated_at" timestamp with time zone,
    "correlation_id" "uuid" NOT NULL,
    CONSTRAINT "fiscal_authorized_has_cae" CHECK ((("state" <> 'authorized'::"text") OR (("cae" ~ '^[0-9]{14}$'::"text") AND ("document_number" IS NOT NULL) AND ("authorized_at" IS NOT NULL)))),
    CONSTRAINT "fiscal_documents_artifact_state_check" CHECK (("artifact_state" = ANY (ARRAY['artifact_pending'::"text", 'artifact_generating'::"text", 'artifact_ready'::"text", 'artifact_failed'::"text", 'artifact_superseded'::"text"]))),
    CONSTRAINT "fiscal_documents_cae_check" CHECK ((("cae" IS NULL) OR ("cae" ~ '^[0-9]{14}$'::"text"))),
    CONSTRAINT "fiscal_documents_concept_check" CHECK (("concept" = ANY (ARRAY[1, 2, 3]))),
    CONSTRAINT "fiscal_documents_credit_kind_check" CHECK ((("credit_kind" IS NULL) OR ("credit_kind" = ANY (ARRAY['total'::"text", 'partial'::"text", 'commercial_adjustment'::"text"])))),
    CONSTRAINT "fiscal_documents_cuit_check" CHECK (("cuit" ~ '^[0-9]{11}$'::"text")),
    CONSTRAINT "fiscal_documents_currency_rate_check" CHECK (("currency_rate" > (0)::numeric)),
    CONSTRAINT "fiscal_documents_document_intent_check" CHECK (("document_intent" = ANY (ARRAY['invoice'::"text", 'credit_note'::"text"]))),
    CONSTRAINT "fiscal_documents_environment_check" CHECK (("environment" = ANY (ARRAY['homologation'::"text", 'production'::"text"]))),
    CONSTRAINT "fiscal_documents_point_of_sale_check" CHECK ((("point_of_sale" >= 1) AND ("point_of_sale" <= 99999))),
    CONSTRAINT "fiscal_documents_source_type_check" CHECK (("source_type" = ANY (ARRAY['pos_sale'::"text", 'online_order'::"text", 'credit_note'::"text"]))),
    CONSTRAINT "fiscal_documents_state_check" CHECK (("state" = ANY (ARRAY['draft'::"text", 'queued'::"text", 'claiming'::"text", 'authenticating'::"text", 'authorizing'::"text", 'authorized'::"text", 'observed'::"text", 'rejected'::"text", 'ambiguous'::"text", 'retry_wait'::"text", 'failed'::"text", 'credited'::"text"])))
);


ALTER TABLE "public"."fiscal_documents" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reserve_fiscal_document_number"("p_document_id" "uuid", "p_worker_id" "text", "p_expected_number" bigint) RETURNS "public"."fiscal_documents"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_document public.fiscal_documents%rowtype;
  v_outbox public.fiscal_outbox%rowtype;
begin
  if p_expected_number < 1 then raise exception 'numero fiscal invalido' using errcode='22023'; end if;
  select d.* into v_document from public.fiscal_documents d where d.id=p_document_id for update;
  if not found then raise exception 'documento fiscal inexistente' using errcode='P0002'; end if;
  select o.* into v_outbox from public.fiscal_outbox o where o.fiscal_document_id=p_document_id for update;
  if not found or v_outbox.state<>'leased' or v_outbox.lease_owner<>p_worker_id or v_outbox.lease_deadline<=now() then raise exception 'lease fiscal invalido' using errcode='40001'; end if;
  if v_document.state in ('authorized','credited') or v_document.document_number is not null then return v_document; end if;
  if v_document.document_type < 1 then raise exception 'tipo de comprobante requiere revision fiscal' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':',v_document.environment,v_document.cuit,v_document.point_of_sale,v_document.document_type),0));
  if exists(select 1 from public.fiscal_documents d where d.environment=v_document.environment and d.cuit=v_document.cuit and d.point_of_sale=v_document.point_of_sale and d.document_type=v_document.document_type and d.document_number=p_expected_number and d.id<>v_document.id) then
    raise exception 'numero fiscal ya reservado localmente' using errcode='40001';
  end if;
  update public.fiscal_documents set document_number=p_expected_number,state='authorizing' where id=p_document_id returning * into v_document;
  return v_document;
end;
$$;


ALTER FUNCTION "public"."reserve_fiscal_document_number"("p_document_id" "uuid", "p_worker_id" "text", "p_expected_number" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_business_combo"("p_business_id" "uuid", "p_combo_id" "text", "p_quantity" integer DEFAULT 1) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_combo public.product_combos%rowtype;
  v_quantity integer := greatest(1, coalesce(p_quantity, 1));
  v_blockers text[] := array[]::text[];
  v_components jsonb := '[]'::jsonb;
  v_component_count integer := 0;
  v_list_price numeric(12, 2) := 0;
  v_promotional numeric(12, 2);
  v_savings numeric(12, 2);
  v_stock integer;
  v_limiting text;
  v_age_restricted boolean := false;
  v_minimum_age integer;
  v_priced boolean;
begin
  if p_business_id is null or nullif(btrim(coalesce(p_combo_id, '')), '') is null then
    raise exception 'combo invalido' using errcode = '22023';
  end if;

  select * into v_combo
    from public.product_combos c
   where c.business_id = p_business_id
     and c.combo_id = p_combo_id;
  if not found then
    return jsonb_build_object(
      'combo_id', p_combo_id,
      'exists', false,
      'purchasable', false,
      'blockers', jsonb_build_array('El combo no existe para este negocio.')
    );
  end if;

  if not v_combo.is_active then
    v_blockers := v_blockers || 'El combo está desactivado.';
  end if;
  if v_combo.approval_status <> 'APROBADO_COMERCIAL' then
    v_blockers := v_blockers || format(
      'El combo no está aprobado comercialmente (%s).', v_combo.approval_status
    );
  end if;

  -- Un componente sin precio confirmado BLOQUEA el combo en vez de completarlo
  -- con un número inventado. Lo mismo con el stock: el combo sostiene tantas
  -- unidades como el componente más escaso.
  select
      coalesce(jsonb_agg(
        jsonb_build_object(
          'product_id', d.product_id,
          'sku', d.sku,
          'name', d.name,
          'presentation', d.presentation,
          'quantity', d.quantity,
          'unit_price', case when d.sellable then d.price end,
          'line_price', case when d.sellable then d.price * d.quantity end,
          'alcoholic', d.is_alcoholic,
          'max_combos', d.max_combos
        ) order by d.sort_order, d.product_id
      ), '[]'::jsonb),
      count(*)::integer,
      coalesce(sum(case when d.sellable then d.price * d.quantity end), 0),
      min(d.max_combos),
      bool_or(d.is_alcoholic),
      max(case when d.is_alcoholic then coalesce(d.minimum_age, 18) end)
    into v_components, v_component_count, v_list_price, v_stock, v_age_restricted, v_minimum_age
    from (
      select
        cc.product_id,
        cc.quantity,
        cc.sort_order,
        p.sku,
        p.name,
        p.presentation,
        p.price,
        p.is_alcoholic,
        p.minimum_age,
        (
          p.is_active and p.is_verified and p.available
          and p.price_status = 'confirmed'
          and p.price is not null and p.price > 0
          and p.stock is not null
        ) as sellable,
        greatest(0, floor(coalesce(p.stock, 0)::numeric / cc.quantity))::integer as max_combos
        from public.product_combo_components cc
        join public.products p on p.id = cc.product_id
       where cc.combo_id = v_combo.id
    ) d;

  if v_component_count = 0 then
    v_blockers := v_blockers || 'El combo no declara componentes.';
  end if;

  -- Motivos por componente, en el mismo vocabulario que usa la góndola.
  v_blockers := v_blockers || coalesce((
    select array_agg(reason order by reason)
      from (
        select format('%s: precio pendiente de confirmación del negocio.', c.value ->> 'sku') as reason
          from jsonb_array_elements(v_components) as c(value)
         where c.value ->> 'unit_price' is null
        union all
        select format('%s: sin stock disponible.', c.value ->> 'sku')
          from jsonb_array_elements(v_components) as c(value)
         where coalesce((c.value ->> 'max_combos')::integer, 0) <= 0
      ) reasons
  ), array[]::text[]);

  -- Un componente que ya no está en `products` no aparece en el join de arriba;
  -- se detecta comparando contra la cantidad declarada.
  if v_component_count < (select count(*) from public.product_combo_components cc where cc.combo_id = v_combo.id) then
    v_blockers := v_blockers || 'Un componente ya no está en el catálogo.';
  end if;

  v_priced := array_length(v_blockers, 1) is null;
  v_stock := coalesce(v_stock, 0);

  if v_priced then
    v_promotional := floor(
      (v_list_price * (100 - v_combo.discount_percentage) / 100) / v_combo.price_rounding
    ) * v_combo.price_rounding;
    if v_promotional <= 0 or v_promotional > v_list_price then
      v_priced := false;
      v_promotional := null;
      v_blockers := v_blockers || 'El precio promocional derivado no es válido.';
    else
      v_savings := v_list_price - v_promotional;
    end if;
  end if;

  return jsonb_build_object(
    'combo_id', v_combo.combo_id,
    'combo_uuid', v_combo.id,
    'exists', true,
    'name', v_combo.name,
    'tagline', v_combo.tagline,
    'description', v_combo.description,
    'category_id', v_combo.category_id,
    'terms', v_combo.terms,
    'quantity', v_quantity,
    'discount_percentage', v_combo.discount_percentage,
    'approval_status', v_combo.approval_status,
    'components', v_components,
    'list_price', case when v_priced then v_list_price end,
    'promotional_price', case when v_priced then v_promotional end,
    'savings', case when v_priced then v_savings end,
    'savings_percentage', case
      when v_priced and v_list_price > 0
      then round((v_savings / v_list_price) * 1000) / 10
    end,
    'stock', v_stock,
    'limiting_sku', (
      select c.value ->> 'sku'
        from jsonb_array_elements(v_components) as c(value)
       where coalesce((c.value ->> 'max_combos')::integer, 0) = v_stock
       limit 1
    ),
    'age_restricted', coalesce(v_age_restricted, false),
    'minimum_age', case when coalesce(v_age_restricted, false) then coalesce(v_minimum_age, 18) end,
    'purchasable', v_priced and v_stock >= v_quantity,
    'blockers', to_jsonb(v_blockers)
  );
end;
$$;


ALTER FUNCTION "public"."resolve_business_combo"("p_business_id" "uuid", "p_combo_id" "text", "p_quantity" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."resolve_business_combo"("p_business_id" "uuid", "p_combo_id" "text", "p_quantity" integer) IS 'Resolución autoritativa de un combo contra el catálogo vivo. El navegador nunca dicta el precio.';



CREATE TABLE IF NOT EXISTS "public"."fiscal_accounting_policies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "environment" "text" NOT NULL,
    "policy_version" "text" NOT NULL,
    "valid_from" "date" NOT NULL,
    "issuer_condition" "text" NOT NULL,
    "recipient_condition" "text" NOT NULL,
    "concept" integer NOT NULL,
    "invoice_type" integer NOT NULL,
    "credit_note_type" integer NOT NULL,
    "recipient_document_type" integer NOT NULL,
    "recipient_document_number" "text" NOT NULL,
    "enabled" boolean DEFAULT false NOT NULL,
    "allow_commercial_adjustment" boolean DEFAULT false NOT NULL,
    "accountant_review_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "notes" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "fiscal_accounting_policies_accountant_review_status_check" CHECK (("accountant_review_status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"]))),
    CONSTRAINT "fiscal_accounting_policies_concept_check" CHECK (("concept" = ANY (ARRAY[1, 2, 3]))),
    CONSTRAINT "fiscal_accounting_policies_credit_note_type_check" CHECK (("credit_note_type" > 0)),
    CONSTRAINT "fiscal_accounting_policies_environment_check" CHECK (("environment" = ANY (ARRAY['homologation'::"text", 'production'::"text"]))),
    CONSTRAINT "fiscal_accounting_policies_invoice_type_check" CHECK (("invoice_type" > 0)),
    CONSTRAINT "fiscal_accounting_policies_issuer_condition_check" CHECK ((("char_length"("btrim"("issuer_condition")) >= 1) AND ("char_length"("btrim"("issuer_condition")) <= 80))),
    CONSTRAINT "fiscal_accounting_policies_notes_check" CHECK (("char_length"("notes") <= 1000)),
    CONSTRAINT "fiscal_accounting_policies_policy_version_check" CHECK ((("char_length"("btrim"("policy_version")) >= 1) AND ("char_length"("btrim"("policy_version")) <= 80))),
    CONSTRAINT "fiscal_accounting_policies_recipient_condition_check" CHECK ((("char_length"("btrim"("recipient_condition")) >= 1) AND ("char_length"("btrim"("recipient_condition")) <= 80))),
    CONSTRAINT "fiscal_accounting_policies_recipient_document_number_check" CHECK (("recipient_document_number" ~ '^[0-9]{1,20}$'::"text")),
    CONSTRAINT "fiscal_accounting_policies_recipient_document_type_check" CHECK (("recipient_document_type" > 0)),
    CONSTRAINT "fiscal_accounting_policy_approval_check" CHECK ((("accountant_review_status" <> 'approved'::"text") OR (("approved_by" IS NOT NULL) AND ("approved_at" IS NOT NULL)))),
    CONSTRAINT "fiscal_accounting_policy_enabled_check" CHECK (((NOT "enabled") OR ("accountant_review_status" = 'approved'::"text")))
);


ALTER TABLE "public"."fiscal_accounting_policies" OWNER TO "postgres";


COMMENT ON TABLE "public"."fiscal_accounting_policies" IS 'Politicas versionadas; solo una politica aprobada y validada contra tablas ARCA puede resolver tipos.';



CREATE OR REPLACE FUNCTION "public"."resolve_fiscal_accounting_policy"("p_business_id" "uuid", "p_environment" "text", "p_issuer_condition" "text", "p_recipient_condition" "text", "p_concept" integer, "p_invoice_type" integer, "p_effective_on" "date") RETURNS "public"."fiscal_accounting_policies"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_policy public.fiscal_accounting_policies%rowtype;
begin
  if p_environment not in ('homologation','production')
    or p_concept not in (1,2,3)
    or p_invoice_type < 1
    or btrim(coalesce(p_issuer_condition,'')) = ''
    or btrim(coalesce(p_recipient_condition,'')) = ''
  then
    raise exception 'fiscal_policy_review_required' using errcode = 'P0001';
  end if;

  select p.* into v_policy
  from public.fiscal_accounting_policies p
  where p.business_id = p_business_id
    and p.environment = p_environment
    and p.issuer_condition = btrim(p_issuer_condition)
    and p.recipient_condition = btrim(p_recipient_condition)
    and p.concept = p_concept
    and p.invoice_type = p_invoice_type
    and p.enabled
    and p.accountant_review_status = 'approved'
    and p.valid_from <= coalesce(p_effective_on, current_date)
  order by p.valid_from desc, p.created_at desc
  limit 1
  for share;

  if not found
    or not public.fiscal_has_current_parameter_id(p_environment, 'document_types', v_policy.invoice_type)
    or not public.fiscal_has_current_parameter_id(p_environment, 'document_types', v_policy.credit_note_type)
    or not public.fiscal_has_current_parameter_id(p_environment, 'recipient_document_types', v_policy.recipient_document_type)
  then
    raise exception 'fiscal_policy_review_required' using errcode = 'P0001';
  end if;
  return v_policy;
end;
$$;


ALTER FUNCTION "public"."resolve_fiscal_accounting_policy"("p_business_id" "uuid", "p_environment" "text", "p_issuer_condition" "text", "p_recipient_condition" "text", "p_concept" integer, "p_invoice_type" integer, "p_effective_on" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."revert_packing_scan"("p_session_id" "uuid", "p_scan_key" "text", "p_idempotency_key" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
declare
  v_session public.order_packing_sessions%rowtype;
  v_scan public.order_packing_scans%rowtype;
  v_receipt public.business_command_receipts%rowtype;
  v_hash text;
  v_result jsonb;
begin
  if btrim(coalesce(p_idempotency_key,'')) !~ '^[A-Za-z0-9:_-]{8,128}$' then
    raise exception 'idempotency_key invalida' using errcode='22023';
  end if;
  select s.* into v_session from public.order_packing_sessions s where s.id=p_session_id for update;
  if not found then raise exception 'sesion inexistente' using errcode='P0002'; end if;
  if not public.has_business_role(v_session.business_id,array['owner','admin','staff']) then
    raise exception 'operador no autorizado' using errcode='42501';
  end if;
  v_hash:=public.business_command_request_hash(
    'revert_packing_scan',v_session.order_id,
    jsonb_build_object('session_id',p_session_id,'scan_key',p_scan_key)
  );
  select r.* into v_receipt from public.business_command_receipts r
  where r.business_id=v_session.business_id and r.idempotency_key=p_idempotency_key;
  if found then
    if v_receipt.request_hash<>v_hash then
      raise exception 'idempotency_key reutilizada con otro payload' using errcode='23505';
    end if;
    return v_receipt.result||jsonb_build_object('idempotent_replay',true);
  end if;
  if v_session.status not in ('in_progress','complete') then
    raise exception 'sesion cerrada' using errcode='P0001';
  end if;
  select s.* into v_scan from public.order_packing_scans s
  where s.session_id=p_session_id and s.scan_key=p_scan_key for update;
  if not found then raise exception 'lectura inexistente' using errcode='P0002'; end if;
  update public.order_packing_scans set reverted_at=coalesce(reverted_at,now()) where id=v_scan.id;
  update public.order_packing_sessions set status='in_progress',updated_at=now() where id=p_session_id;
  v_result:=jsonb_build_object('ok',true,'scan_key',p_scan_key,'reverted',true);
  insert into public.business_command_receipts(
    business_id,order_id,actor_user_id,command_type,idempotency_key,request_hash,result
  ) values (
    v_session.business_id,v_session.order_id,auth.uid(),'revert_packing_scan',p_idempotency_key,v_hash,v_result
  );
  return v_result||jsonb_build_object('idempotent_replay',false);
end;
$_$;


ALTER FUNCTION "public"."revert_packing_scan"("p_session_id" "uuid", "p_scan_key" "text", "p_idempotency_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."revoke_public_tracking"("p_order_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
begin
  if not (
    exists (
      select 1 from public.orders o
       where o.id = p_order_id
         and o.customer_user_id = auth.uid()
    )
    or exists (
      select 1 from public.orders o
       where o.id = p_order_id
         and public.has_business_role(o.business_id, array['owner', 'admin', 'staff'])
    )
  ) then
    raise exception 'acceso denegado' using errcode = '42501';
  end if;

  update public.order_public_tokens
     set revoked_at = coalesce(revoked_at, clock_timestamp())
   where order_id = p_order_id
     and revoked_at is null;
  return found;
end;
$$;


ALTER FUNCTION "public"."revoke_public_tracking"("p_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rider_active_delivery_payload"("p_order_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'private', 'extensions', 'pg_temp'
    AS $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', o.id,
    'public_code', o.public_code,
    'business_name', b.name,
    'business_address', b.address,
    'business_location', loc.payload->'business_location',
    'customer_location', loc.payload->'customer_location',
    'pickup_summary', b.address,
    'status', o.status,
    'revision', o.revision,
    'delivery_mode', o.delivery_mode,
    'address_label', o.address_label,
    'customer_street_address', o.customer_street_address,
    'customer_neighborhood', o.customer_neighborhood,
    'customer_reference', o.customer_reference,
    'customer_notes', o.customer_notes,
    'payment_method', o.payment_method,
    'subtotal', o.subtotal,
    'delivery_fee', o.delivery_fee,
    'total', o.total,
    'currency_code', o.currency_code,
    'picked_up_at', o.picked_up_at,
    'dispatched_at', o.dispatched_at,
    'arrived_at', o.arrived_at,
    'delivered_at', o.delivered_at,
    'updated_at', o.updated_at,
    'order_items', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'name', oi.name,
        'quantity', oi.quantity,
        'unit', oi.unit,
        'unit_price', oi.unit_price
      )) order by oi.created_at, oi.id)
      from public.order_items oi
      where oi.order_id = o.id
    ), '[]'::jsonb)
  ))
  from public.orders o
  join public.businesses b on b.id = o.business_id
  cross join lateral private.rider_map_location_payload(o.id, true) as loc(payload)
  where o.id = p_order_id
$$;


ALTER FUNCTION "public"."rider_active_delivery_payload"("p_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rider_order_rpc_payload"("p_order_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'private', 'extensions', 'pg_temp'
    AS $$
  select jsonb_strip_nulls(
    jsonb_build_object(
      'id', o.id,
      'public_code', o.public_code,
      'status', o.status,
      'revision', o.revision,
      'delivery_mode', o.delivery_mode,
      'customer_name', o.customer_name,
      'customer_phone', o.customer_phone,
      'address_label', o.address_label,
      'customer_street_address', o.customer_street_address,
      'customer_neighborhood', o.customer_neighborhood,
      'customer_reference', o.customer_reference,
      'customer_notes', o.customer_notes,
      'payment_method', o.payment_method,
      'subtotal', o.subtotal,
      'delivery_fee', o.delivery_fee,
      'total', o.total,
      'currency_code', o.currency_code,
      'assigned_rider_user_id', o.assigned_rider_user_id,
      'age_confirmation_policy', o.age_confirmation_policy,
      'created_at', o.created_at,
      'updated_at', o.updated_at,
      'accepted_at', o.accepted_at,
      'preparing_at', o.preparing_at,
      'ready_at', o.ready_at,
      'dispatched_at', o.dispatched_at,
      'picked_up_at', o.picked_up_at,
      'arrived_at', o.arrived_at,
      'delivered_at', o.delivered_at,
      'cancelled_at', o.cancelled_at,
      'canceled_at', o.canceled_at,
      'rejected_at', o.rejected_at,
      'estimated_arrival_at', o.estimated_arrival_at,
      'estimated_arrival_source', o.estimated_arrival_source,
      'estimated_arrival_updated_at', o.estimated_arrival_updated_at,
      'business_name', b.name,
      'business_address', b.address,
      'business_location', loc.payload->'business_location',
      'customer_location', loc.payload->'customer_location',
      'order_items', coalesce(
        (
          select jsonb_agg(
                   jsonb_strip_nulls(jsonb_build_object(
                     'product_uuid', oi.product_uuid,
                     'product_id', oi.product_id,
                     'name', oi.name,
                     'quantity', oi.quantity,
                     'unit', oi.unit,
                     'unit_price', oi.unit_price
                   ))
                   order by oi.created_at, oi.id
                 )
            from public.order_items oi
           where oi.order_id = o.id
        ),
        '[]'::jsonb
      )
    )
  )
  from public.orders o
  join public.businesses b on b.id = o.business_id
  cross join lateral private.rider_map_location_payload(o.id, true) as loc(payload)
  where o.id = p_order_id
$$;


ALTER FUNCTION "public"."rider_order_rpc_payload"("p_order_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."rider_order_rpc_payload"("p_order_id" "uuid") IS 'Internal Rider order projection; exact customer coordinates are returned only to the assigned active Rider.';



CREATE OR REPLACE FUNCTION "public"."rider_require_active_membership"("p_business_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  perform 1
    from public.business_members bm
   where bm.business_id = p_business_id
     and bm.user_id = auth.uid()
     and bm.role = 'rider'
     and bm.is_active = true
   for share;
  if not found then
    raise exception 'membership rider activa requerida' using errcode = '42501';
  end if;
end;
$$;


ALTER FUNCTION "public"."rider_require_active_membership"("p_business_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rider_validate_idempotency_key"("p_key" "text") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
declare
  v_key text := btrim(coalesce(p_key, ''));
begin
  if v_key !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception 'idempotency_key invalida' using errcode = '22023';
  end if;
  return v_key;
end;
$_$;


ALTER FUNCTION "public"."rider_validate_idempotency_key"("p_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sanitize_payment_diagnostic"("p_value" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select nullif(left(regexp_replace(
    regexp_replace(
      coalesce(p_value, ''),
      '(?i)(authorization|access[_ -]?token|api[_ -]?key|secret|card|cvv|raw[_ -]?payload)[[:space:]]*[:=][^[:space:],;]+',
      '[oculto]',
      'g'
    ),
    '[[:space:]]+', ' ', 'g'
  ), 200), '');
$$;


ALTER FUNCTION "public"."sanitize_payment_diagnostic"("p_value" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fiscal_parameter_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "environment" "text" NOT NULL,
    "parameter_type" "text" NOT NULL,
    "version" "text" NOT NULL,
    "values_json" "jsonb" NOT NULL,
    "synchronized_at" timestamp with time zone NOT NULL,
    CONSTRAINT "fiscal_parameter_snapshots_environment_check" CHECK (("environment" = ANY (ARRAY['homologation'::"text", 'production'::"text"])))
);


ALTER TABLE "public"."fiscal_parameter_snapshots" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_fiscal_parameter_snapshot"("p_environment" "text", "p_parameter_type" "text", "p_version" "text", "p_values_json" "jsonb", "p_synchronized_at" timestamp with time zone) RETURNS "public"."fiscal_parameter_snapshots"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare v_snapshot public.fiscal_parameter_snapshots%rowtype;
begin
  if p_environment not in ('homologation','production')
    or p_parameter_type not in ('document_types','recipient_document_types','vat_types','currencies','concepts','points_of_sale')
    or char_length(coalesce(p_version,'')) not between 1 and 128
    or p_values_json is null
    or p_synchronized_at is null
    or p_synchronized_at > now() + interval '5 minutes'
  then raise exception 'snapshot de parametros fiscales invalido' using errcode='22023'; end if;
  insert into public.fiscal_parameter_snapshots(environment,parameter_type,version,values_json,synchronized_at)
  values(p_environment,p_parameter_type,left(p_version,128),p_values_json,p_synchronized_at)
  on conflict(environment,parameter_type,version) do update
    set synchronized_at=greatest(public.fiscal_parameter_snapshots.synchronized_at,excluded.synchronized_at)
  returning * into v_snapshot;
  return v_snapshot;
end;
$$;


ALTER FUNCTION "public"."save_fiscal_parameter_snapshot"("p_environment" "text", "p_parameter_type" "text", "p_version" "text", "p_values_json" "jsonb", "p_synchronized_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."scheduler_heartbeat"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select jsonb_build_object(
    'service', 'taba-operational-alerts-sweep',
    'expected_every_seconds', 60,
    'stale_after_seconds', 600,
    'last_run_at', r.started_at,
    'age_seconds', case when r.started_at is null then null
      else round(extract(epoch from (clock_timestamp() - r.started_at))) end,
    'healthy', r.started_at is not null
      and r.started_at > clock_timestamp() - interval '600 seconds',
    'checked_at', clock_timestamp()
  )
  from (
    select max(started_at) as started_at
    from public.operational_sweep_runs
    where scope = 'operational_alerts'
  ) r;
$$;


ALTER FUNCTION "public"."scheduler_heartbeat"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."scheduler_heartbeat"() IS 'Reloj del barrido de alertas: cuando corrio por ultima vez y si eso esta dentro de lo esperado. Sin ningun dato de negocio; apta para una sonda externa sin credenciales.';



CREATE OR REPLACE FUNCTION "public"."set_business_open_state"("p_business_id" "uuid", "p_status" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_business public.businesses%rowtype;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  if p_status not in ('open', 'paused', 'closed') then
    raise exception 'estado de negocio invalido' using errcode = '22023';
  end if;
  -- Abrir o pausar es operación del día y lo puede hacer el equipo; cerrar el
  -- negocio es una decisión comercial del mismo calibre que firmar el cierre.
  if p_status = 'closed' and not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'cerrar el negocio requiere owner o admin' using errcode = '42501';
  end if;

  update public.businesses set status = p_status, updated_at = now()
   where id = p_business_id
  returning * into v_business;
  if not found then
    raise exception 'negocio inexistente' using errcode = 'P0002';
  end if;

  return jsonb_build_object('ok', true, 'status', v_business.status);
end;
$$;


ALTER FUNCTION "public"."set_business_open_state"("p_business_id" "uuid", "p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_business_whatsapp_contact"("p_business_id" "uuid", "p_whatsapp_phone" "text", "p_verified" boolean DEFAULT false) RETURNS TABLE("whatsapp_phone" "text", "whatsapp_verified" boolean, "whatsapp_verified_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_digits text;
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can authorize the business contact channel.';
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
$$;


ALTER FUNCTION "public"."set_business_whatsapp_contact"("p_business_id" "uuid", "p_whatsapp_phone" "text", "p_verified" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."set_business_whatsapp_contact"("p_business_id" "uuid", "p_whatsapp_phone" "text", "p_verified" boolean) IS 'Owner/admin-only authority for a public WhatsApp channel. Validates digits, rotates the number fail-closed and records a server timestamp plus actor.';



CREATE OR REPLACE FUNCTION "public"."set_current_customer_default_address"("p_address_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_customer_id uuid := auth.uid();
  v_address public.customer_addresses%rowtype;
begin
  if v_customer_id is null then
    raise exception 'autenticacion de cliente requerida' using errcode = '42501';
  end if;
  select * into v_address
    from public.customer_addresses a
   where a.id = p_address_id and a.customer_id = v_customer_id and a.deleted_at is null
   for update;
  if not found then
    raise exception 'direccion no encontrada' using errcode = '42501';
  end if;
  update public.customer_addresses set is_default = false
   where customer_id = v_customer_id and deleted_at is null and is_default;
  update public.customer_addresses set is_default = true
   where id = v_address.id
   returning * into v_address;
  return public.customer_address_json(v_address);
end;
$$;


ALTER FUNCTION "public"."set_current_customer_default_address"("p_address_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_order_delivery_handoff_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_order_delivery_handoff_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_order_operational_defaults"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.public_code is null or btrim(new.public_code) = '' then
    new.public_code := coalesce(nullif(new.code, ''), public.next_order_public_code());
  end if;

  if new.code is null or btrim(new.code) = '' then
    new.code := new.public_code;
  end if;

  if new.delivery_mode is null or btrim(new.delivery_mode) = '' then
    new.delivery_mode := coalesce(nullif(new.fulfillment_type, ''), 'delivery');
  end if;

  if new.fulfillment_type is null or btrim(new.fulfillment_type) = '' then
    new.fulfillment_type := new.delivery_mode;
  end if;

  if new.customer_street_address is null or btrim(new.customer_street_address) = '' then
    new.customer_street_address := new.address_label;
  end if;

  if new.customer_notes is null then
    new.customer_notes := new.notes;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."set_order_operational_defaults"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_order_status_timestamps"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    if new.status = 'accepted' and new.accepted_at is null then
      new.accepted_at := clock_timestamp();
    end if;
    if new.status = 'preparing' and new.preparing_at is null then
      new.preparing_at := clock_timestamp();
    end if;
    if new.status = 'ready' and new.ready_at is null then
      new.ready_at := clock_timestamp();
    end if;
    if new.status in ('on_the_way', 'picked_up') then
      new.dispatched_at := coalesce(new.dispatched_at, clock_timestamp());
      new.picked_up_at := coalesce(new.picked_up_at, new.dispatched_at);
    end if;
    if new.status in ('arrived', 'arriving') and new.arrived_at is null then
      new.arrived_at := clock_timestamp();
    end if;
    if new.status = 'delivered' and new.delivered_at is null then
      new.delivered_at := clock_timestamp();
    end if;
    if new.status in ('cancelled', 'canceled') then
      new.cancelled_at := coalesce(new.cancelled_at, clock_timestamp());
      new.canceled_at := coalesce(new.canceled_at, new.cancelled_at);
    end if;
    if new.status = 'rejected' and new.rejected_at is null then
      new.rejected_at := clock_timestamp();
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."set_order_status_timestamps"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_payment_tables_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_payment_tables_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_preparation_estimate"("p_order_id" "uuid", "p_expected_revision" bigint, "p_minutes" integer, "p_idempotency_key" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
declare
  v_order public.orders%rowtype;
  v_existing public.business_command_receipts%rowtype;
  v_hash text;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'autenticacion requerida' using errcode = '42501'; end if;
  if p_minutes not between 1 and 240 then raise exception 'minutos fuera de rango' using errcode = '22023'; end if;
  if btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9:_-]{8,128}$' then raise exception 'idempotency_key invalida' using errcode = '22023'; end if;
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'pedido inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_order.business_id, array['owner', 'admin', 'staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  v_hash := public.business_command_request_hash('set_preparation_estimate', p_order_id, jsonb_build_object('expected_revision', p_expected_revision, 'minutes', p_minutes));
  select r.* into v_existing from public.business_command_receipts r where r.business_id = v_order.business_id and r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_key reutilizada con otro payload' using errcode = '23505'; end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;
  if v_order.revision <> p_expected_revision then raise exception 'revision desactualizada' using errcode = '40001'; end if;
  if public.normalize_order_status_vocabulary(v_order.status) not in ('submitted', 'accepted', 'preparing') then raise exception 'estado no permite estimacion' using errcode = 'P0001'; end if;
  update public.orders set preparation_estimate_minutes = p_minutes where id = p_order_id;
  insert into public.order_events(order_id, business_id, actor_user_id, actor_role, event_type, type, message, metadata)
  values (p_order_id, v_order.business_id, auth.uid(), 'business', 'preparation_estimate_set', 'preparation_estimate_set', 'Tiempo de preparacion actualizado.', jsonb_build_object('minutes', p_minutes));
  select to_jsonb(o) into v_result from public.orders o where o.id = p_order_id;
  insert into public.business_command_receipts(business_id, order_id, actor_user_id, command_type, idempotency_key, request_hash, result)
  values (v_order.business_id, p_order_id, auth.uid(), 'set_preparation_estimate', p_idempotency_key, v_hash, v_result);
  return v_result || jsonb_build_object('idempotent_replay', false);
end;
$_$;


ALTER FUNCTION "public"."set_preparation_estimate"("p_order_id" "uuid", "p_expected_revision" bigint, "p_minutes" integer, "p_idempotency_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."stage_catalog_products"("p_business_id" "uuid", "p_products" "jsonb") RETURNS TABLE("product_id" "uuid", "staged_external_id" "text", "staged_sku" "text", "staged_is_verified" boolean, "staged_available" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
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
$_$;


ALTER FUNCTION "public"."stage_catalog_products"("p_business_id" "uuid", "p_products" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."stamp_rider_location_server_time"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
begin
  new.recorded_at := clock_timestamp();
  new.created_at := new.recorded_at;
  return new;
end;
$$;


ALTER FUNCTION "public"."stamp_rider_location_server_time"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."start_packing_session"("p_order_id" "uuid", "p_expected_revision" bigint, "p_idempotency_key" "text") RETURNS "public"."order_packing_sessions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
declare
  v_order public.orders%rowtype;
  v_session public.order_packing_sessions%rowtype;
begin
  if btrim(coalesce(p_idempotency_key,'')) !~ '^[A-Za-z0-9:_-]{8,128}$' then raise exception 'idempotency_key invalida' using errcode='22023'; end if;
  select o.* into v_order from public.orders o where o.id=p_order_id for update;
  if not found then raise exception 'pedido inexistente' using errcode='P0002'; end if;
  if not public.has_business_role(v_order.business_id,array['owner','admin','staff']) then raise exception 'operador no autorizado' using errcode='42501'; end if;
  select s.* into v_session from public.order_packing_sessions s where s.business_id=v_order.business_id and s.idempotency_key=p_idempotency_key;
  if found then return v_session; end if;
  if v_order.revision<>p_expected_revision then raise exception 'conflicto de revision' using errcode='40001'; end if;
  if public.normalize_order_status_vocabulary(v_order.status) not in ('accepted','preparing') then raise exception 'estado no permite packing' using errcode='P0001'; end if;
  insert into public.order_packing_sessions(business_id,order_id,order_revision,status,operator_id,idempotency_key)
  values(v_order.business_id,v_order.id,v_order.revision,'in_progress',auth.uid(),p_idempotency_key)
  returning * into v_session;
  return v_session;
end;
$_$;


ALTER FUNCTION "public"."start_packing_session"("p_order_id" "uuid", "p_expected_revision" bigint, "p_idempotency_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."start_payment_outbox_job"("p_job_id" "uuid", "p_owner" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare v_receipt_id uuid;
begin
  update public.payment_outbox set status = 'processing'
   where id = p_job_id and owner = p_owner and status = 'claimed' and lease_expires_at > clock_timestamp()
   returning webhook_receipt_id into v_receipt_id;
  if not found then return false; end if;
  if v_receipt_id is not null then
    update public.payment_webhook_receipts set processing_status = 'processing', attempt_count = attempt_count + 1 where id = v_receipt_id;
  end if;
  return true;
end;
$$;


ALTER FUNCTION "public"."start_payment_outbox_job"("p_job_id" "uuid", "p_owner" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."start_rider_delivery"("p_order_id" "uuid", "p_expected_revision" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_order public.orders%rowtype;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if p_order_id is null or p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'pedido y expected_revision requeridos' using errcode = '22023';
  end if;

  select o.*
    into v_order
    from public.orders o
   where o.id = p_order_id
   for update;

  if not found then
    raise exception 'pedido inexistente' using errcode = 'P0002';
  end if;
  perform 1
    from public.business_members bm
   where bm.business_id = v_order.business_id
     and bm.user_id = v_user_id
     and bm.role = 'rider'
     and bm.is_active = true
   for share;
  if not found then
    raise exception 'rol rider requerido para iniciar el reparto' using errcode = '42501';
  end if;
  if v_order.delivery_mode <> 'delivery'
    or v_order.assigned_rider_user_id is distinct from v_user_id then
    raise exception 'solo el rider asignado puede iniciar el reparto'
      using errcode = '42501';
  end if;

  -- A repeated tap after the first transition is harmless and produces no
  -- second event or revision bump.
  if v_order.status = 'on_the_way' then
    return public.rider_order_rpc_payload(v_order.id)
      || jsonb_build_object('idempotent_no_op', true);
  end if;
  if v_order.status not in ('assigned', 'picked_up') then
    raise exception 'estado invalido para iniciar el reparto: %', v_order.status
      using errcode = '40001';
  end if;
  if v_order.revision <> p_expected_revision then
    raise exception 'revision desactualizada: esperada %, actual %',
      p_expected_revision,
      v_order.revision
      using errcode = '40001';
  end if;

  -- Gate 1 remains the sole transition authority: it checks revision and then
  -- delegates actor/business/transition rules to change_order_status.
  perform public.transition_order(
    v_order.id,
    p_expected_revision,
    'on_the_way'
  );

  return public.rider_order_rpc_payload(v_order.id)
    || jsonb_build_object('idempotent_no_op', false);
end;
$$;


ALTER FUNCTION "public"."start_rider_delivery"("p_order_id" "uuid", "p_expected_revision" bigint) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."start_rider_delivery"("p_order_id" "uuid", "p_expected_revision" bigint) IS 'Inicio de reparto exclusivo del rider asignado; usa revision CAS y delega la transicion en Gate 1.';



CREATE OR REPLACE FUNCTION "public"."start_rider_delivery"("p_order_id" "uuid", "p_expected_revision" bigint, "p_idempotency_key" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_order public.orders%rowtype;
  v_key text := public.rider_validate_idempotency_key(p_idempotency_key);
  v_result jsonb;
begin
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_assigned'); end if;
  perform public.rider_require_active_membership(v_order.business_id);
  if v_order.assigned_rider_user_id is distinct from auth.uid() then return jsonb_build_object('ok', false, 'code', 'not_assigned'); end if;
  select result into v_result from public.rider_delivery_operations
   where order_id = v_order.id and rider_user_id = auth.uid() and operation = 'start_route' and idempotency_key = v_key for share;
  if found then return v_result || jsonb_build_object('idempotent_no_op', true); end if;
  if v_order.revision <> p_expected_revision then return jsonb_build_object('ok', false, 'code', 'stale_revision', 'revision', v_order.revision); end if;
  if v_order.status <> 'picked_up' then return jsonb_build_object('ok', false, 'code', 'not_picked_up', 'revision', v_order.revision); end if;
  update public.orders set status = 'on_the_way' where id = v_order.id;
  v_result := jsonb_build_object('ok', true, 'outcome', 'route_started', 'idempotent_no_op', false, 'order', public.rider_active_delivery_payload(v_order.id));
  insert into public.rider_delivery_operations(order_id, rider_user_id, operation, idempotency_key, request_fingerprint, result)
  values (v_order.id, auth.uid(), 'start_route', v_key, digest(jsonb_build_object('revision', p_expected_revision)::text, 'sha256'), v_result);
  return v_result;
end;
$$;


ALTER FUNCTION "public"."start_rider_delivery"("p_order_id" "uuid", "p_expected_revision" bigint, "p_idempotency_key" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."start_rider_delivery"("p_order_id" "uuid", "p_expected_revision" bigint, "p_idempotency_key" "text") IS 'Canonical idempotent Rider route-start transition; legacy two-argument signature is not callable.';



CREATE OR REPLACE FUNCTION "public"."sweep_expired_checkout_sessions"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_released integer;
begin
  -- `expire_checkout_sessions` toma las sesiones con `for update skip locked`,
  -- así que dos barridos concurrentes no se pisan ni bloquean un checkout vivo.
  v_released := public.expire_checkout_sessions(200);
  return coalesce(v_released, 0);
end;
$$;


ALTER FUNCTION "public"."sweep_expired_checkout_sessions"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sweep_expired_checkout_sessions"() IS 'Libera el stock de los checkouts vencidos; agendada cada minuto por pg_cron.';



CREATE OR REPLACE FUNCTION "public"."transition_operational_alert"("p_alert_id" "uuid", "p_target_status" "text", "p_note" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_alert public.operational_alerts%rowtype;
begin
  select * into v_alert
  from public.operational_alerts
  where id = p_alert_id
  for update;
  if not found then raise exception 'alerta inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_alert.business_id, array['owner','admin','staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  if p_target_status not in ('acknowledged','resolved') then
    raise exception 'transicion de alerta invalida' using errcode = '22023';
  end if;
  if p_target_status = 'resolved' and char_length(btrim(coalesce(p_note, ''))) not between 5 and 500 then
    raise exception 'la resolucion requiere una nota' using errcode = '22023';
  end if;
  if v_alert.status = 'resolved' then
    return jsonb_build_object('ok', true, 'alert_id', v_alert.id, 'status', v_alert.status, 'idempotent_replay', true);
  end if;
  -- El reconocimiento registra QUIÉN la vio primero: un reintento (u otro
  -- operador repitiendo el gesto) no reescribe al actor ni la hora.
  if p_target_status = 'acknowledged' and v_alert.status = 'acknowledged' then
    return jsonb_build_object('ok', true, 'alert_id', v_alert.id, 'status', v_alert.status, 'idempotent_replay', true);
  end if;
  if p_target_status = 'acknowledged' then
    update public.operational_alerts
    set status = 'acknowledged', acknowledged_by = auth.uid(), acknowledged_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = v_alert.id;
  else
    update public.operational_alerts
    set status = 'resolved', resolved_by = auth.uid(), resolved_at = clock_timestamp(), resolution_note = btrim(p_note), updated_at = clock_timestamp()
    where id = v_alert.id;
  end if;
  insert into public.operational_alert_events(business_id, alert_id, event_type, actor_id, detail)
  values (v_alert.business_id, v_alert.id, p_target_status, auth.uid(), jsonb_build_object('note', nullif(btrim(coalesce(p_note,'')),'')));
  return jsonb_build_object('ok', true, 'alert_id', v_alert.id, 'status', p_target_status, 'idempotent_replay', false);
end;
$$;


ALTER FUNCTION "public"."transition_operational_alert"("p_alert_id" "uuid", "p_target_status" "text", "p_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."transition_order"("p_order_id" "uuid", "p_expected_revision" bigint, "p_new_status" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_order public.orders%rowtype;
  v_current_public text;
  v_target text;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'expected_revision requerido' using errcode = '22023';
  end if;

  v_target := public.normalize_order_status_vocabulary(p_new_status);
  if v_target = '' then
    raise exception 'estado destino requerido' using errcode = '22023';
  end if;

  -- Bloquea la fila antes de comparar la revisión: sin esto dos llamadas
  -- concurrentes podrían leer la misma revisión y ambas considerarse válidas.
  select o.*
    into v_order
    from public.orders o
   where o.id = p_order_id
   for update;

  if not found then
    raise exception 'pedido inexistente' using errcode = 'P0002';
  end if;

  -- Una revisión distinta significa que el actor decidió sobre una vista
  -- vieja del pedido. Se rechaza sin aplicar nada: es la regla "rechazar
  -- revisiones o eventos atrasados" del contrato.
  if v_order.revision <> p_expected_revision then
    raise exception 'revision desactualizada: esperada %, actual %',
      p_expected_revision,
      v_order.revision
      using errcode = '40001';
  end if;

  v_current_public := public.normalize_order_status_vocabulary(v_order.status);

  -- Doble toque: si el pedido ya está en el estado pedido, la operación es un
  -- no-op exitoso. No se emite evento ni se incrementa la revisión, así que
  -- reintentar nunca ensucia el historial.
  if v_current_public = v_target then
    select to_jsonb(o)
      into v_result
      from public.orders o
     where o.id = v_order.id;
    return v_result || jsonb_build_object('idempotent_no_op', true);
  end if;

  -- change_order_status valida estado previo, rol, negocio y rider, y ejecuta
  -- el UPDATE que dispara el incremento de revisión.
  v_result := public.change_order_status(
    p_order_id,
    v_current_public,
    v_target
  );

  return v_result || jsonb_build_object('idempotent_no_op', false);
end;
$$;


ALTER FUNCTION "public"."transition_order"("p_order_id" "uuid", "p_expected_revision" bigint, "p_new_status" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."transition_order"("p_order_id" "uuid", "p_expected_revision" bigint, "p_new_status" "text") IS 'Transicion de pedido con CAS por revision, vocabulario Gate 1 y doble toque idempotente. Delega reglas de rol y transicion en change_order_status.';



CREATE OR REPLACE FUNCTION "public"."transition_order"("p_order_id" "uuid", "p_expected_revision" bigint, "p_new_status" "text", "p_idempotency_key" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
declare
  v_order public.orders%rowtype;
  v_existing public.business_command_receipts%rowtype;
  v_hash text;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'autenticacion requerida' using errcode = '42501'; end if;
  if btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9:_-]{8,128}$' then raise exception 'idempotency_key invalida' using errcode = '22023'; end if;
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'pedido inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_order.business_id, array['owner', 'admin', 'staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  v_hash := public.business_command_request_hash('transition_order', p_order_id, jsonb_build_object('expected_revision', p_expected_revision, 'new_status', public.normalize_order_status_vocabulary(p_new_status)));
  select r.* into v_existing from public.business_command_receipts r where r.business_id = v_order.business_id and r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_key reutilizada con otro payload' using errcode = '23505'; end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;
  v_result := public.transition_order(p_order_id, p_expected_revision, p_new_status);
  insert into public.business_command_receipts(business_id, order_id, actor_user_id, command_type, idempotency_key, request_hash, result)
  values (v_order.business_id, p_order_id, auth.uid(), 'transition_order', p_idempotency_key, v_hash, v_result);
  return v_result || jsonb_build_object('idempotent_replay', false);
end;
$_$;


ALTER FUNCTION "public"."transition_order"("p_order_id" "uuid", "p_expected_revision" bigint, "p_new_status" "text", "p_idempotency_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."undo_last_packing_scan"("p_session_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  v_session public.order_packing_sessions%rowtype;
  v_scan_id uuid;
begin
  select s.* into v_session from public.order_packing_sessions s where s.id=p_session_id for update;
  if not found then raise exception 'sesion inexistente' using errcode='P0002'; end if;
  if not public.has_business_role(v_session.business_id,array['owner','admin','staff']) then raise exception 'operador no autorizado' using errcode='42501'; end if;
  if v_session.status not in ('in_progress','complete') then raise exception 'sesion cerrada' using errcode='P0001'; end if;
  select s.id into v_scan_id from public.order_packing_scans s where s.session_id=p_session_id and s.reverted_at is null order by s.created_at desc,s.id desc limit 1 for update;
  if not found then return jsonb_build_object('ok',false,'code','NOTHING_TO_UNDO'); end if;
  update public.order_packing_scans set reverted_at=now() where id=v_scan_id;
  update public.order_packing_sessions set status='in_progress',updated_at=now() where id=p_session_id;
  return jsonb_build_object('ok',true,'scan_id',v_scan_id);
end;
$$;


ALTER FUNCTION "public"."undo_last_packing_scan"("p_session_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."undo_last_packing_scan"("p_session_id" "uuid") IS 'SUPERSEDED por revert_packing_scan: sin receipts ni request_hash. Ejecución revocada.';



CREATE OR REPLACE FUNCTION "public"."unpublish_catalog_product"("p_business_id" "uuid", "p_external_id" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."unpublish_catalog_product"("p_business_id" "uuid", "p_external_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_fiscal_print_job"("p_print_job_id" "uuid", "p_status" "text", "p_error_code" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
declare
  v_job public.fiscal_print_jobs%rowtype;
begin
  if p_status not in ('queued','sent_to_spooler','completed_when_verifiable','failed','unknown')
    or (p_error_code is not null and p_error_code !~ '^[A-Z0-9_]{3,80}$')
  then raise exception 'estado de impresion invalido' using errcode = '22023'; end if;
  select j.* into v_job from public.fiscal_print_jobs j where j.id = p_print_job_id for update;
  if not found or not public.has_business_role(v_job.business_id, array['owner','admin','staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  if v_job.status = 'completed_when_verifiable' then return jsonb_build_object('print_job_id', v_job.id, 'status', v_job.status, 'idempotent_replay', true); end if;
  update public.fiscal_print_jobs
    set status = p_status,
        error_code = case when p_status = 'failed' then p_error_code else null end,
        completed_at = case when p_status = 'completed_when_verifiable' then now() else null end
    where id = v_job.id
    returning * into v_job;
  insert into public.fiscal_events(fiscal_document_id, event_type, actor_type, actor_id, sanitized_detail)
  values(v_job.fiscal_document_id, concat('print_', p_status), 'operator', auth.uid(), jsonb_build_object('print_job_id', v_job.id, 'error_code', case when p_status = 'failed' then p_error_code else null end));
  return jsonb_build_object('print_job_id', v_job.id, 'status', v_job.status, 'idempotent_replay', false);
end;
$_$;


ALTER FUNCTION "public"."update_fiscal_print_job"("p_print_job_id" "uuid", "p_status" "text", "p_error_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_current_customer_address"("p_address" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
declare
  v_customer_id uuid := auth.uid();
  v_address_id uuid;
  v_existing public.customer_addresses%rowtype;
  v_duplicate public.customer_addresses%rowtype;
  v_label text;
  v_formatted text;
  v_street text;
  v_street_number text;
  v_floor text;
  v_apartment text;
  v_reference text;
  v_city text;
  v_province text;
  v_postal_code text;
  v_latitude numeric(9, 6);
  v_longitude numeric(9, 6);
  v_accuracy numeric(10, 2);
  v_source text;
  v_location_source text;
  v_confirmed_at timestamptz;
  v_fingerprint text;
  v_normalized text;
  v_make_default boolean;
  v_allow_duplicate boolean := false;
  v_unexpected_key text;
  v_result public.customer_addresses%rowtype;
begin
  if v_customer_id is null then
    raise exception 'autenticacion de cliente requerida' using errcode = '42501';
  end if;
  if not exists (select 1 from public.customers c where c.id = v_customer_id) then
    raise exception 'guardá primero tu nombre y telefono' using errcode = '22023';
  end if;
  if p_address is null or jsonb_typeof(p_address) <> 'object' then
    raise exception 'direccion invalida' using errcode = '22023';
  end if;

  select key into v_unexpected_key
    from jsonb_object_keys(p_address) as keys(key)
   where key not in (
     'id', 'label', 'formattedAddress', 'street', 'streetNumber', 'floor',
     'apartment', 'reference', 'city', 'province', 'postalCode', 'latitude',
     'longitude', 'geolocationAccuracy', 'source', 'isDefault', 'allowDuplicate',
     'locationSource', 'locationConfirmedAt', 'locationConfirmedAddress'
   )
   limit 1;
  if v_unexpected_key is not null then
    raise exception 'campo no permitido en direccion: %', v_unexpected_key using errcode = '22023';
  end if;

  if nullif(p_address->>'id', '') is not null then
    if (p_address->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'identificador de direccion invalido' using errcode = '22023';
    end if;
    v_address_id := (p_address->>'id')::uuid;
    select * into v_existing
      from public.customer_addresses a
     where a.id = v_address_id
       and a.customer_id = v_customer_id
       and a.deleted_at is null
     for update;
    if not found then
      raise exception 'direccion no encontrada' using errcode = '42501';
    end if;
  end if;

  v_label := nullif(btrim(coalesce(p_address->>'label', '')), '');
  v_street := nullif(btrim(coalesce(p_address->>'street', '')), '');
  v_street_number := nullif(btrim(coalesce(p_address->>'streetNumber', '')), '');
  v_floor := nullif(btrim(coalesce(p_address->>'floor', '')), '');
  v_apartment := nullif(btrim(coalesce(p_address->>'apartment', '')), '');
  v_reference := nullif(btrim(coalesce(p_address->>'reference', '')), '');
  v_city := nullif(btrim(coalesce(p_address->>'city', '')), '');
  v_province := nullif(btrim(coalesce(p_address->>'province', '')), '');
  v_postal_code := nullif(btrim(coalesce(p_address->>'postalCode', '')), '');
  v_formatted := nullif(btrim(coalesce(p_address->>'formattedAddress', '')), '');
  v_source := lower(coalesce(nullif(p_address->>'source', ''), 'manual'));
  v_location_source := lower(nullif(btrim(coalesce(p_address->>'locationSource', '')), ''));
  v_allow_duplicate := coalesce((p_address->>'allowDuplicate')::boolean, false);

  if v_label is null or char_length(v_label) > 60
    or v_street is null or char_length(v_street) > 120
    or v_city is null or char_length(v_city) > 100
    or char_length(coalesce(v_street_number, '')) > 24
    or char_length(coalesce(v_floor, '')) > 24
    or char_length(coalesce(v_apartment, '')) > 24
    or char_length(coalesce(v_reference, '')) > 180
    or char_length(coalesce(v_province, '')) > 100
    or char_length(coalesce(v_postal_code, '')) > 20 then
    raise exception 'direccion incompleta o demasiado larga' using errcode = '22023';
  end if;
  v_formatted := coalesce(v_formatted, concat_ws(', ', concat_ws(' ', v_street, v_street_number), v_city));
  if char_length(v_formatted) > 180 then
    raise exception 'direccion demasiado larga' using errcode = '22023';
  end if;
  if v_source not in ('manual', 'gps', 'geocoder', 'previous_order') then
    raise exception 'origen de direccion invalido' using errcode = '22023';
  end if;
  if v_location_source is not null
    and v_location_source not in ('gps', 'map_pin', 'geocoded_confirmed') then
    raise exception 'origen de ubicacion invalido' using errcode = '22023';
  end if;

  if nullif(p_address->>'latitude', '') is not null or nullif(p_address->>'longitude', '') is not null then
    if (p_address->>'latitude') !~ '^-?[0-9]+(\.[0-9]+)?$'
      or (p_address->>'longitude') !~ '^-?[0-9]+(\.[0-9]+)?$' then
      raise exception 'coordenadas invalidas' using errcode = '22023';
    end if;
    v_latitude := (p_address->>'latitude')::numeric(9, 6);
    v_longitude := (p_address->>'longitude')::numeric(9, 6);
    if v_latitude not between -90 and 90 or v_longitude not between -180 and 180 then
      raise exception 'coordenadas fuera de rango' using errcode = '22023';
    end if;
  end if;
  if nullif(p_address->>'geolocationAccuracy', '') is not null then
    if (p_address->>'geolocationAccuracy') !~ '^[0-9]+(\.[0-9]+)?$' then
      raise exception 'precision GPS invalida' using errcode = '22023';
    end if;
    v_accuracy := (p_address->>'geolocationAccuracy')::numeric(10, 2);
  end if;
  if (v_latitude is null) <> (v_longitude is null) then
    raise exception 'las coordenadas deben incluir latitud y longitud' using errcode = '22023';
  end if;
  if nullif(p_address->>'locationConfirmedAt', '') is not null then
    begin
      v_confirmed_at := (p_address->>'locationConfirmedAt')::timestamptz;
    exception when others then
      raise exception 'momento de confirmacion invalido' using errcode = '22023';
    end;
    if v_confirmed_at > clock_timestamp() + interval '5 minutes' then
      raise exception 'momento de confirmacion en el futuro' using errcode = '22023';
    end if;
  end if;

  -- Una confirmación necesita las cuatro piezas. Faltando cualquiera, la
  -- dirección se guarda SIN confirmar en vez de mentir a medias.
  if v_confirmed_at is null or v_location_source is null or v_latitude is null then
    v_confirmed_at := null;
    v_location_source := null;
  end if;

  v_fingerprint := public.delivery_location_address_fingerprint(
    v_street, v_street_number, v_city, v_province, v_postal_code
  );

  -- Editar el texto sin volver a marcar el pin invalida la confirmación. Se
  -- detecta porque el cliente reenvía LA MISMA confirmación de antes mientras la
  -- huella del texto cambió: ese pin ya no describe esta puerta.
  if v_address_id is not null
    and v_confirmed_at is not null
    and v_existing.location_confirmed_at is not null
    and v_confirmed_at = v_existing.location_confirmed_at
    and coalesce(v_existing.location_confirmed_address, '') <> v_fingerprint then
    v_confirmed_at := null;
    v_location_source := null;
    v_latitude := null;
    v_longitude := null;
    v_accuracy := null;
  end if;

  -- El origen del contrato manda sobre la columna histórica, que conserva su
  -- vocabulario porque un consumidor remoto la restringe.
  if v_confirmed_at is not null then
    v_source := case v_location_source
      when 'gps' then 'gps'
      when 'geocoded_confirmed' then 'geocoder'
      else 'manual'
    end;
  elsif v_source in ('gps', 'geocoder') and v_latitude is null then
    raise exception 'la fuente de ubicacion requiere coordenadas confirmadas' using errcode = '22023';
  end if;

  v_normalized := public.normalize_customer_address_text(concat_ws(' ', v_street, v_street_number, v_floor, v_apartment, v_city, v_province, v_postal_code));
  if v_normalized = '' then
    raise exception 'direccion invalida' using errcode = '22023';
  end if;

  select * into v_duplicate
    from public.customer_addresses a
   where a.customer_id = v_customer_id
     and a.deleted_at is null
     and (v_address_id is null or a.id <> v_address_id)
     and (
       a.normalized_address = v_normalized
       or (
         v_latitude is not null
         and a.latitude is not null
         and 6371000 * 2 * asin(sqrt(
           power(sin(radians(a.latitude - v_latitude) / 2), 2)
           + cos(radians(v_latitude)) * cos(radians(a.latitude))
             * power(sin(radians(a.longitude - v_longitude) / 2), 2)
         )) <= greatest(55, coalesce(v_accuracy, 0) + coalesce(a.geolocation_accuracy, 0) + 30)
       )
     )
   order by a.is_default desc, a.updated_at desc
   limit 1;

  if found and not v_allow_duplicate then
    return jsonb_build_object(
      'ok', false,
      'code', 'duplicate',
      'address', public.customer_address_json(v_duplicate)
    );
  end if;

  v_make_default := coalesce(
    (p_address->>'isDefault')::boolean,
    case when v_address_id is not null then v_existing.is_default else null end,
    not exists (
      select 1 from public.customer_addresses a
      where a.customer_id = v_customer_id and a.deleted_at is null
    )
  );
  if v_make_default then
    update public.customer_addresses
       set is_default = false
     where customer_id = v_customer_id
       and deleted_at is null
       and (v_address_id is null or id <> v_address_id)
       and is_default;
  end if;

  if v_address_id is null then
    insert into public.customer_addresses (
      customer_id, label, formatted_address, street, street_number, floor, apartment,
      reference, city, province, postal_code, latitude, longitude, geolocation_accuracy,
      source, location_source, location_confirmed_at, location_confirmed_address,
      normalized_address, is_default
    ) values (
      v_customer_id, v_label, v_formatted, v_street, v_street_number, v_floor, v_apartment,
      v_reference, v_city, v_province, v_postal_code, v_latitude, v_longitude, v_accuracy,
      v_source, v_location_source, v_confirmed_at,
      case when v_confirmed_at is not null then v_fingerprint end,
      v_normalized, v_make_default
    ) returning * into v_result;
  else
    update public.customer_addresses
       set label = v_label,
           formatted_address = v_formatted,
           street = v_street,
           street_number = v_street_number,
           floor = v_floor,
           apartment = v_apartment,
           reference = v_reference,
           city = v_city,
           province = v_province,
           postal_code = v_postal_code,
           latitude = v_latitude,
           longitude = v_longitude,
           geolocation_accuracy = v_accuracy,
           source = v_source,
           location_source = v_location_source,
           location_confirmed_at = v_confirmed_at,
           location_confirmed_address = case when v_confirmed_at is not null then v_fingerprint end,
           normalized_address = v_normalized,
           is_default = v_make_default
     where id = v_address_id
     returning * into v_result;
  end if;

  return jsonb_build_object('ok', true, 'address', public.customer_address_json(v_result));
end;
$_$;


ALTER FUNCTION "public"."upsert_current_customer_address"("p_address" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_current_customer_profile"("p_name" "text", "p_phone" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $_$
declare
  v_customer_id uuid := auth.uid();
  v_name text := nullif(
    regexp_replace(btrim(coalesce(p_name, '')), '[[:space:]]+', ' ', 'g'),
    ''
  );
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_customer public.customers%rowtype;
begin
  if v_customer_id is null then
    raise exception 'autenticacion de cliente requerida' using errcode = '42501';
  end if;
  if v_name is null
    or char_length(v_name) < 2
    or char_length(v_name) > 80
    or v_name !~ '[[:alpha:]]' then
    raise exception 'nombre invalido: usa entre 2 y 80 caracteres e incluye letras'
      using errcode = '22023';
  end if;
  if v_phone !~ '^[0-9]{10,13}$' or v_phone ~ '^([0-9])\1+$' then
    raise exception 'telefono argentino invalido' using errcode = '22023';
  end if;

  insert into public.customers (id, name, phone)
  values (v_customer_id, v_name, v_phone)
  on conflict (id) do update
     set name = excluded.name,
         phone = excluded.phone
  returning * into v_customer;

  return jsonb_build_object(
    'id', v_customer.id,
    'name', v_customer.name,
    'phone', v_customer.phone,
    'lastOrderAt', v_customer.last_order_at,
    'createdAt', v_customer.created_at,
    'updatedAt', v_customer.updated_at
  );
end;
$_$;


ALTER FUNCTION "public"."upsert_current_customer_profile"("p_name" "text", "p_phone" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "private"."rider_map_business_locations" (
    "business_id" "uuid" NOT NULL,
    "latitude" numeric(9,6) NOT NULL,
    "longitude" numeric(9,6) NOT NULL,
    "source" "text" NOT NULL,
    "accuracy_m" numeric(10,2),
    "updated_at" timestamp with time zone DEFAULT "statement_timestamp"() NOT NULL,
    "confidence" "text",
    "human_verified" boolean DEFAULT false NOT NULL,
    "source_note" "text",
    "verified_by_rider_presence" boolean DEFAULT false NOT NULL,
    "presence_checked_at" timestamp with time zone,
    "presence_distance_m" numeric(10,2),
    "presence_accuracy_m" numeric(10,2),
    "presence_status" "text",
    CONSTRAINT "rider_map_business_locations_accuracy_check" CHECK ((("accuracy_m" IS NULL) OR ("accuracy_m" >= (0)::numeric))),
    CONSTRAINT "rider_map_business_locations_confidence_check" CHECK ((("confidence" IS NULL) OR ("confidence" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"])))),
    CONSTRAINT "rider_map_business_locations_coordinates_check" CHECK (((("latitude" >= ('-90'::integer)::numeric) AND ("latitude" <= (90)::numeric)) AND (("longitude" >= ('-180'::integer)::numeric) AND ("longitude" <= (180)::numeric)))),
    CONSTRAINT "rider_map_business_locations_human_verified_check" CHECK ((("human_verified" = false) OR ("source" = 'business_verified'::"text"))),
    CONSTRAINT "rider_map_business_locations_presence_check" CHECK (((("presence_status" IS NULL) AND ("verified_by_rider_presence" = false)) OR (("presence_status" = ANY (ARRAY['confirmed'::"text", 'discrepancy'::"text"])) AND ("presence_checked_at" IS NOT NULL) AND ("presence_distance_m" IS NOT NULL) AND ("presence_distance_m" >= (0)::numeric) AND (("verified_by_rider_presence" = false) OR ("presence_status" = 'confirmed'::"text"))))),
    CONSTRAINT "rider_map_business_locations_source_check" CHECK (("source" = ANY (ARRAY['business_verified'::"text", 'public_directory_cross_checked'::"text", 'qa_fixture'::"text"])))
);


ALTER TABLE "private"."rider_map_business_locations" OWNER TO "postgres";


COMMENT ON COLUMN "private"."rider_map_business_locations"."source" IS 'Procedencia del punto: business_verified (una persona lo confirmó contra la puerta), public_directory_cross_checked (directorio público contrastado) o qa_fixture (valor de prueba).';



COMMENT ON COLUMN "private"."rider_map_business_locations"."human_verified" IS 'Sólo puede ser verdadero con source=business_verified. Lo impone un CHECK.';



COMMENT ON COLUMN "private"."rider_map_business_locations"."presence_status" IS 'Resultado del chequeo contra el GPS del Rider parado en el local: confirmed o discrepancy. Una discrepancia NO pisa el punto.';



CREATE TABLE IF NOT EXISTS "private"."rider_map_order_location_snapshots" (
    "order_id" "uuid" NOT NULL,
    "business_latitude" numeric(9,6),
    "business_longitude" numeric(9,6),
    "business_source" "text",
    "business_accuracy_m" numeric(10,2),
    "customer_latitude" numeric(9,6),
    "customer_longitude" numeric(9,6),
    "customer_source" "text",
    "customer_accuracy_m" numeric(10,2),
    "created_at" timestamp with time zone DEFAULT "statement_timestamp"() NOT NULL,
    CONSTRAINT "rider_map_order_accuracy_check" CHECK (((("business_accuracy_m" IS NULL) OR ("business_accuracy_m" >= (0)::numeric)) AND (("customer_accuracy_m" IS NULL) OR ("customer_accuracy_m" >= (0)::numeric)))),
    CONSTRAINT "rider_map_order_business_coordinates_pair" CHECK (((("business_latitude" IS NULL) AND ("business_longitude" IS NULL)) OR ((("business_latitude" >= ('-90'::integer)::numeric) AND ("business_latitude" <= (90)::numeric)) AND (("business_longitude" >= ('-180'::integer)::numeric) AND ("business_longitude" <= (180)::numeric))))),
    CONSTRAINT "rider_map_order_customer_coordinates_pair" CHECK (((("customer_latitude" IS NULL) AND ("customer_longitude" IS NULL)) OR ((("customer_latitude" >= ('-90'::integer)::numeric) AND ("customer_latitude" <= (90)::numeric)) AND (("customer_longitude" >= ('-180'::integer)::numeric) AND ("customer_longitude" <= (180)::numeric))))),
    CONSTRAINT "rider_map_order_customer_source_check" CHECK ((("customer_source" IS NULL) OR ("customer_source" = ANY (ARRAY['manual'::"text", 'gps'::"text", 'geocoder'::"text", 'previous_order'::"text", 'qa_fixture'::"text"])))),
    CONSTRAINT "rider_map_order_location_source_check" CHECK ((("business_source" IS NULL) OR ("business_source" = ANY (ARRAY['business_verified'::"text", 'public_directory_cross_checked'::"text", 'qa_fixture'::"text"]))))
);


ALTER TABLE "private"."rider_map_order_location_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."business_command_receipts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "order_id" "uuid",
    "actor_user_id" "uuid" NOT NULL,
    "command_type" "text" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "request_hash" "text" NOT NULL,
    "result" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "business_command_receipts_request_hash_check" CHECK (("request_hash" ~ '^[a-f0-9]{64}$'::"text"))
);


ALTER TABLE "public"."business_command_receipts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."business_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "business_members_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'admin'::"text", 'staff'::"text", 'rider'::"text"])))
);


ALTER TABLE "public"."business_members" OWNER TO "postgres";


COMMENT ON TABLE "public"."business_members" IS 'Auth memberships: owner controls membership; admin operates the business and may manage only staff/rider; staff and rider have scoped operational access.';



CREATE TABLE IF NOT EXISTS "public"."business_payment_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "provider" "text" DEFAULT 'mercadopago'::"text" NOT NULL,
    "enabled" boolean DEFAULT false NOT NULL,
    "environment" "text" DEFAULT 'test'::"text" NOT NULL,
    "checkout_mode" "text" DEFAULT 'checkout_pro'::"text" NOT NULL,
    "currency" "text" DEFAULT 'ARS'::"text" NOT NULL,
    "installments_limit" integer,
    "allow_offline_payment_methods" boolean DEFAULT false NOT NULL,
    "preference_expiration_minutes" integer DEFAULT 15 NOT NULL,
    "reserve_stock" boolean DEFAULT true NOT NULL,
    "refund_policy" "text" DEFAULT 'manual_review'::"text" NOT NULL,
    "production_review_status" "text" DEFAULT 'not_requested'::"text" NOT NULL,
    "collector_id" "text",
    "application_id" "text",
    "configured_at" timestamp with time zone,
    "verified_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "business_payment_settings_checkout_mode_check" CHECK (("checkout_mode" = 'checkout_pro'::"text")),
    CONSTRAINT "business_payment_settings_currency_check" CHECK (("currency" = 'ARS'::"text")),
    CONSTRAINT "business_payment_settings_enabled_configuration_check" CHECK (((NOT "enabled") OR ("reserve_stock" AND (NULLIF("btrim"("collector_id"), ''::"text") IS NOT NULL) AND (NULLIF("btrim"("application_id"), ''::"text") IS NOT NULL) AND (("environment" <> 'production'::"text") OR ("production_review_status" = 'approved'::"text"))))),
    CONSTRAINT "business_payment_settings_environment_check" CHECK (("environment" = ANY (ARRAY['test'::"text", 'production'::"text"]))),
    CONSTRAINT "business_payment_settings_expiration_check" CHECK ((("preference_expiration_minutes" >= 5) AND ("preference_expiration_minutes" <= 60))),
    CONSTRAINT "business_payment_settings_installments_check" CHECK ((("installments_limit" IS NULL) OR (("installments_limit" >= 1) AND ("installments_limit" <= 24)))),
    CONSTRAINT "business_payment_settings_production_review_check" CHECK (("production_review_status" = ANY (ARRAY['not_requested'::"text", 'pending'::"text", 'approved'::"text", 'rejected'::"text"]))),
    CONSTRAINT "business_payment_settings_provider_check" CHECK (("provider" = 'mercadopago'::"text")),
    CONSTRAINT "business_payment_settings_refund_policy_check" CHECK (("refund_policy" = ANY (ARRAY['manual_review'::"text", 'owner_approval'::"text"])))
);


ALTER TABLE "public"."business_payment_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."businesses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "phone" "text",
    "whatsapp" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "slug" "text" NOT NULL,
    "address" "text",
    "whatsapp_phone" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "ordering_enabled" boolean DEFAULT false NOT NULL,
    "ordering_verified" boolean DEFAULT false NOT NULL,
    "ordering_verified_at" timestamp with time zone,
    "ordering_verified_by" "uuid",
    "currency_code" "text",
    "delivery_enabled" boolean DEFAULT false NOT NULL,
    "pickup_enabled" boolean DEFAULT false NOT NULL,
    "delivery_fee" numeric(12,2),
    "minimum_delivery_subtotal" numeric(12,2),
    "alcohol_sales_enabled" boolean DEFAULT false NOT NULL,
    "alcohol_minimum_age" integer,
    "alcohol_sales_start" time without time zone,
    "alcohol_sales_end" time without time zone,
    "alcohol_timezone" "text",
    "order_rate_limit_per_10_minutes" integer,
    "max_pending_orders_per_customer" integer,
    "stock_reservation_minutes" integer,
    "abandoned_order_minutes" integer,
    "captcha_required" boolean,
    "whatsapp_verified" boolean DEFAULT false NOT NULL,
    "whatsapp_verified_at" timestamp with time zone,
    "whatsapp_verified_by" "uuid",
    CONSTRAINT "businesses_abuse_limits_positive" CHECK (((("order_rate_limit_per_10_minutes" IS NULL) OR ("order_rate_limit_per_10_minutes" > 0)) AND (("max_pending_orders_per_customer" IS NULL) OR ("max_pending_orders_per_customer" > 0)) AND (("stock_reservation_minutes" IS NULL) OR (("stock_reservation_minutes" >= 5) AND ("stock_reservation_minutes" <= 1440))) AND (("abandoned_order_minutes" IS NULL) OR (("abandoned_order_minutes" >= 5) AND ("abandoned_order_minutes" <= 10080))))),
    CONSTRAINT "businesses_alcohol_policy_complete" CHECK (((NOT "alcohol_sales_enabled") OR ((("alcohol_minimum_age" >= 18) AND ("alcohol_minimum_age" <= 99)) AND ("alcohol_sales_start" IS NOT NULL) AND ("alcohol_sales_end" IS NOT NULL) AND ("alcohol_timezone" IS NOT NULL) AND ("btrim"("alcohol_timezone") <> ''::"text")))),
    CONSTRAINT "businesses_delivery_fee_nonnegative" CHECK ((("delivery_fee" IS NULL) OR ("delivery_fee" >= (0)::numeric))),
    CONSTRAINT "businesses_minimum_delivery_nonnegative" CHECK ((("minimum_delivery_subtotal" IS NULL) OR ("minimum_delivery_subtotal" >= (0)::numeric))),
    CONSTRAINT "businesses_ordering_enabled_requires_verification" CHECK (((NOT "ordering_enabled") OR ("ordering_verified" AND "is_active" AND ("status" = 'open'::"text")))),
    CONSTRAINT "businesses_ordering_verified_configuration" CHECK (((NOT "ordering_verified") OR (("ordering_verified_at" IS NOT NULL) AND ("ordering_verified_by" IS NOT NULL) AND ("currency_code" IS NOT NULL) AND ("currency_code" ~ '^[A-Z]{3}$'::"text") AND ("delivery_enabled" OR "pickup_enabled") AND ((NOT "delivery_enabled") OR (("delivery_fee" IS NOT NULL) AND ("minimum_delivery_subtotal" IS NOT NULL)))))),
    CONSTRAINT "businesses_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'paused'::"text", 'closed'::"text"]))),
    CONSTRAINT "businesses_whatsapp_verification_complete" CHECK ((((NOT "whatsapp_verified") AND ("whatsapp_verified_at" IS NULL) AND ("whatsapp_verified_by" IS NULL)) OR ("whatsapp_verified" AND ("whatsapp_verified_at" IS NOT NULL) AND ("whatsapp_verified_by" IS NOT NULL) AND (("char_length"("regexp_replace"(COALESCE("whatsapp_phone", ''::"text"), '[^0-9]'::"text", ''::"text", 'g'::"text")) >= 8) AND ("char_length"("regexp_replace"(COALESCE("whatsapp_phone", ''::"text"), '[^0-9]'::"text", ''::"text", 'g'::"text")) <= 15)))))
);

ALTER TABLE ONLY "public"."businesses" REPLICA IDENTITY FULL;


ALTER TABLE "public"."businesses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."catalog_assets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "external_id" "text" NOT NULL,
    "sku" "text" NOT NULL,
    "safe_sku" "text" NOT NULL,
    "identity_sha256" "text" NOT NULL,
    "master_path" "text" NOT NULL,
    "master_sha256" "text" NOT NULL,
    "master_binding_sha256" "text" NOT NULL,
    "master_width" integer DEFAULT 1000 NOT NULL,
    "master_height" integer DEFAULT 1000 NOT NULL,
    "thumbnail_path" "text" NOT NULL,
    "thumbnail_sha256" "text" NOT NULL,
    "thumbnail_binding_sha256" "text" NOT NULL,
    "thumbnail_width" integer DEFAULT 400 NOT NULL,
    "thumbnail_height" integer DEFAULT 400 NOT NULL,
    "source_sha256" "text" NOT NULL,
    "source_url" "text" NOT NULL,
    "rights_status" "text" NOT NULL,
    "rights_reference" "text" NOT NULL,
    "approved_at" timestamp with time zone,
    "approved_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "statement_timestamp"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "statement_timestamp"() NOT NULL,
    "catalog_origin" "text" DEFAULT 'commercial'::"text" NOT NULL,
    CONSTRAINT "catalog_assets_catalog_origin_valid" CHECK (("catalog_origin" = ANY (ARRAY['commercial'::"text", 'demo_fixture'::"text", 'test_only'::"text", 'staging_only'::"text"]))),
    CONSTRAINT "catalog_assets_dimensions_exact" CHECK ((("master_width" = 1000) AND ("master_height" = 1000) AND ("thumbnail_width" = 400) AND ("thumbnail_height" = 400))),
    CONSTRAINT "catalog_assets_external_id_present" CHECK (("btrim"("external_id") <> ''::"text")),
    CONSTRAINT "catalog_assets_hashes_valid" CHECK ((("identity_sha256" ~ '^[a-f0-9]{64}$'::"text") AND ("master_sha256" ~ '^[a-f0-9]{64}$'::"text") AND ("master_binding_sha256" ~ '^[a-f0-9]{64}$'::"text") AND ("thumbnail_sha256" ~ '^[a-f0-9]{64}$'::"text") AND ("thumbnail_binding_sha256" ~ '^[a-f0-9]{64}$'::"text") AND ("source_sha256" ~ '^[a-f0-9]{64}$'::"text"))),
    CONSTRAINT "catalog_assets_identity_binding_valid" CHECK ((("identity_sha256" = "public"."catalog_image_identity_sha256"("external_id", "sku", "source_sha256")) AND ("master_path" = "public"."catalog_asset_path"("safe_sku", "identity_sha256", 'master'::"text", "master_sha256")) AND ("thumbnail_path" = "public"."catalog_asset_path"("safe_sku", "identity_sha256", 'thumbnail'::"text", "thumbnail_sha256")) AND ("master_binding_sha256" = "public"."catalog_asset_binding_sha256"("identity_sha256", 'master'::"text", "source_sha256", "master_sha256", "master_width", "master_height", "master_path")) AND ("thumbnail_binding_sha256" = "public"."catalog_asset_binding_sha256"("identity_sha256", 'thumbnail'::"text", "source_sha256", "thumbnail_sha256", "thumbnail_width", "thumbnail_height", "thumbnail_path")))),
    CONSTRAINT "catalog_assets_master_path_safe" CHECK ((("master_path" ~ '^assets/products/[a-z0-9_-]+[.]webp$'::"text") AND ("strpos"("master_path", '..'::"text") = 0))),
    CONSTRAINT "catalog_assets_rights_valid" CHECK (((("catalog_origin" = 'commercial'::"text") AND ("rights_status" = ANY (ARRAY['PROPIO'::"text", 'LICENCIA_COMERCIAL'::"text", 'PERMISO_DOCUMENTADO'::"text"])) AND ("btrim"("rights_reference") <> ''::"text") AND ("approved_at" IS NOT NULL) AND ("approved_by" IS NOT NULL)) OR (("catalog_origin" = ANY (ARRAY['demo_fixture'::"text", 'test_only'::"text", 'staging_only'::"text"])) AND ("rights_status" = 'UNAPPROVED_QA'::"text") AND ("btrim"("rights_reference") <> ''::"text") AND ("approved_at" IS NULL) AND ("approved_by" IS NULL)))),
    CONSTRAINT "catalog_assets_safe_sku_valid" CHECK (("safe_sku" ~ '^[a-z0-9_-]{1,80}$'::"text")),
    CONSTRAINT "catalog_assets_sku_present" CHECK (("btrim"("sku") <> ''::"text")),
    CONSTRAINT "catalog_assets_source_https" CHECK (("lower"("source_url") ~ '^https://'::"text")),
    CONSTRAINT "catalog_assets_thumbnail_path_safe" CHECK ((("thumbnail_path" ~ '^assets/products/[a-z0-9_-]+[.]webp$'::"text") AND ("strpos"("thumbnail_path", '..'::"text") = 0) AND ("thumbnail_path" <> "master_path")))
);


ALTER TABLE "public"."catalog_assets" OWNER TO "postgres";


COMMENT ON TABLE "public"."catalog_assets" IS 'Server-stamped registry binding product identity, approved source rights, deterministic master/thumbnail names and complete SHA-256 bindings.';



COMMENT ON COLUMN "public"."catalog_assets"."catalog_origin" IS 'Origin boundary: commercial or staging-only QA fixture provenance.';



CREATE TABLE IF NOT EXISTS "public"."checkout_session_combos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "checkout_session_id" "uuid" NOT NULL,
    "combo_uuid" "uuid" NOT NULL,
    "combo_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "quantity" integer NOT NULL,
    "discount_percentage" numeric(5,2) NOT NULL,
    "list_price" numeric(12,2) NOT NULL,
    "promotional_price" numeric(12,2) NOT NULL,
    "discount_amount" numeric(12,2) NOT NULL,
    "combo_snapshot" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "checkout_session_combos_price_check" CHECK ((("list_price" > (0)::numeric) AND ("promotional_price" > (0)::numeric) AND ("promotional_price" <= "list_price") AND ("discount_amount" = (("list_price" - "promotional_price") * ("quantity")::numeric)))),
    CONSTRAINT "checkout_session_combos_quantity_check" CHECK ((("quantity" >= 1) AND ("quantity" <= 100)))
);


ALTER TABLE "public"."checkout_session_combos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."checkout_session_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "checkout_session_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "product_snapshot" "jsonb" NOT NULL,
    "quantity" integer NOT NULL,
    "unit_price" numeric(12,2) NOT NULL,
    "subtotal" numeric(12,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "checkout_session_items_price_check" CHECK ((("unit_price" > (0)::numeric) AND ("subtotal" = ("unit_price" * ("quantity")::numeric)))),
    CONSTRAINT "checkout_session_items_quantity_check" CHECK ((("quantity" >= 1) AND ("quantity" <= 1000)))
);


ALTER TABLE "public"."checkout_session_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."checkout_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "client_request_id" "text" NOT NULL,
    "normalized_intent_hash" "text" NOT NULL,
    "fulfillment_type" "text" NOT NULL,
    "address_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "contact_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "currency" "text" DEFAULT 'ARS'::"text" NOT NULL,
    "subtotal" numeric(12,2) NOT NULL,
    "discount_total" numeric(12,2) DEFAULT 0 NOT NULL,
    "delivery_fee" numeric(12,2) DEFAULT 0 NOT NULL,
    "total" numeric(12,2) NOT NULL,
    "status" "text" DEFAULT 'created'::"text" NOT NULL,
    "contains_alcohol" boolean DEFAULT false NOT NULL,
    "age_confirmed_at" timestamp with time zone,
    "age_confirmation_policy" integer,
    "expires_at" timestamp with time zone NOT NULL,
    "completed_order_id" "uuid",
    "manual_review_reason" "text",
    "revision" bigint DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "correlation_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "origin" "text" DEFAULT 'production'::"text" NOT NULL,
    "origin_reason" "text",
    CONSTRAINT "checkout_sessions_age_confirmation_check" CHECK (((NOT "contains_alcohol") OR (("age_confirmed_at" IS NOT NULL) AND (("age_confirmation_policy" >= 18) AND ("age_confirmation_policy" <= 99))))),
    CONSTRAINT "checkout_sessions_client_request_format" CHECK (("client_request_id" ~ '^[A-Za-z0-9_-]{8,128}$'::"text")),
    CONSTRAINT "checkout_sessions_currency_check" CHECK (("currency" = 'ARS'::"text")),
    CONSTRAINT "checkout_sessions_expiry_check" CHECK (("expires_at" > "created_at")),
    CONSTRAINT "checkout_sessions_fulfillment_check" CHECK (("fulfillment_type" = ANY (ARRAY['delivery'::"text", 'pickup'::"text"]))),
    CONSTRAINT "checkout_sessions_intent_hash_format" CHECK (("normalized_intent_hash" ~ '^[a-f0-9]{64}$'::"text")),
    CONSTRAINT "checkout_sessions_money_check" CHECK ((("subtotal" >= (0)::numeric) AND ("discount_total" >= (0)::numeric) AND ("delivery_fee" >= (0)::numeric) AND ("total" = (("subtotal" - "discount_total") + "delivery_fee")) AND ("total" >= (0)::numeric) AND (("status" = ANY (ARRAY['created'::"text", 'validating'::"text"])) OR ("total" > (0)::numeric)))),
    CONSTRAINT "checkout_sessions_origin_valid" CHECK (("origin" = ANY (ARRAY['production'::"text", 'qa'::"text"]))),
    CONSTRAINT "checkout_sessions_status_check" CHECK (("status" = ANY (ARRAY['created'::"text", 'validating'::"text", 'ready_for_payment'::"text", 'redirected'::"text", 'payment_pending'::"text", 'payment_approved'::"text", 'finalizing_order'::"text", 'completed'::"text", 'expired'::"text", 'cancelled'::"text", 'retrying'::"text", 'manual_review_required'::"text"])))
);


ALTER TABLE "public"."checkout_sessions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."checkout_sessions"."origin" IS 'Hereda al pedido: un checkout con fixtures QA no puede producir un pedido de operación real.';



CREATE TABLE IF NOT EXISTS "public"."commercial_contract_remediation" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "migration" "text" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "business_id" "uuid" NOT NULL,
    "sku" "text",
    "reason" "text" NOT NULL,
    "previous_price" numeric(12,2),
    "previous_price_status" "text",
    "previous_stock" integer,
    "remediated_at" timestamp with time zone DEFAULT "statement_timestamp"() NOT NULL
);


ALTER TABLE "public"."commercial_contract_remediation" OWNER TO "postgres";


COMMENT ON TABLE "public"."commercial_contract_remediation" IS 'Audit trail of rows switched to available=false when the commercial price contract was hardened. Empty means the catalog was already coherent.';



CREATE TABLE IF NOT EXISTS "public"."customers" (
    "id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "phone" "text" NOT NULL,
    "last_order_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."customers" OWNER TO "postgres";


COMMENT ON TABLE "public"."customers" IS 'One persistent customer profile per Supabase Auth user, including anonymous customer sessions.';



CREATE TABLE IF NOT EXISTS "public"."daily_reconciliation_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "reconciliation_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "actor_id" "uuid" NOT NULL,
    "revision" bigint NOT NULL,
    "snapshot_sha256" "text",
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "daily_reconciliation_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['prepared'::"text", 'refreshed'::"text", 'closed'::"text", 'idempotent_replay'::"text"]))),
    CONSTRAINT "daily_reconciliation_events_revision_check" CHECK (("revision" > 0)),
    CONSTRAINT "daily_reconciliation_events_snapshot_sha256_check" CHECK ((("snapshot_sha256" IS NULL) OR ("snapshot_sha256" ~ '^[a-f0-9]{64}$'::"text")))
);


ALTER TABLE "public"."daily_reconciliation_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_reconciliations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "business_date" "date" NOT NULL,
    "timezone" "text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "revision" bigint DEFAULT 1 NOT NULL,
    "window_start" timestamp with time zone NOT NULL,
    "window_end" timestamp with time zone NOT NULL,
    "snapshot" "jsonb" NOT NULL,
    "declared_cash" numeric(14,2) NOT NULL,
    "expected_cash" numeric(14,2) NOT NULL,
    "cash_difference" numeric(14,2) NOT NULL,
    "difference_note" "text",
    "open_alerts" integer DEFAULT 0 NOT NULL,
    "critical_alerts" integer DEFAULT 0 NOT NULL,
    "snapshot_sha256" "text",
    "prepared_by" "uuid" NOT NULL,
    "prepared_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "refreshed_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "closed_by" "uuid",
    "closed_at" timestamp with time zone,
    "prepare_idempotency_key" "text" NOT NULL,
    "close_idempotency_key" "text",
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "daily_reconciliation_closed_consistency" CHECK (((("status" = 'open'::"text") AND ("closed_by" IS NULL) AND ("closed_at" IS NULL) AND ("snapshot_sha256" IS NULL) AND ("close_idempotency_key" IS NULL)) OR (("status" = 'closed'::"text") AND ("closed_by" IS NOT NULL) AND ("closed_at" IS NOT NULL) AND ("snapshot_sha256" IS NOT NULL) AND ("close_idempotency_key" IS NOT NULL)))),
    CONSTRAINT "daily_reconciliation_difference_note" CHECK ((("cash_difference" = (0)::numeric) OR (("char_length"("btrim"(COALESCE("difference_note", ''::"text"))) >= 5) AND ("char_length"("btrim"(COALESCE("difference_note", ''::"text"))) <= 500)))),
    CONSTRAINT "daily_reconciliation_window" CHECK (("window_end" > "window_start")),
    CONSTRAINT "daily_reconciliations_close_idempotency_key_check" CHECK ((("close_idempotency_key" IS NULL) OR ("close_idempotency_key" ~ '^[A-Za-z0-9:_-]{8,128}$'::"text"))),
    CONSTRAINT "daily_reconciliations_critical_alerts_check" CHECK (("critical_alerts" >= 0)),
    CONSTRAINT "daily_reconciliations_declared_cash_check" CHECK (("declared_cash" >= (0)::numeric)),
    CONSTRAINT "daily_reconciliations_expected_cash_check" CHECK (("expected_cash" >= (0)::numeric)),
    CONSTRAINT "daily_reconciliations_open_alerts_check" CHECK (("open_alerts" >= 0)),
    CONSTRAINT "daily_reconciliations_prepare_idempotency_key_check" CHECK (("prepare_idempotency_key" ~ '^[A-Za-z0-9:_-]{8,128}$'::"text")),
    CONSTRAINT "daily_reconciliations_revision_check" CHECK (("revision" > 0)),
    CONSTRAINT "daily_reconciliations_snapshot_sha256_check" CHECK ((("snapshot_sha256" IS NULL) OR ("snapshot_sha256" ~ '^[a-f0-9]{64}$'::"text"))),
    CONSTRAINT "daily_reconciliations_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."daily_reconciliations" OWNER TO "postgres";


COMMENT ON TABLE "public"."daily_reconciliations" IS 'Immutable-after-close daily operational reconciliation; snapshots contain aggregate business data only.';



CREATE TABLE IF NOT EXISTS "public"."delivery_confirmation_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "order_id" "uuid" NOT NULL,
    "rider_id" "uuid" NOT NULL,
    "request_id" "text" NOT NULL,
    "attempted_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "result" "text" NOT NULL,
    "lock_level" integer DEFAULT 0 NOT NULL,
    "retry_after_seconds" integer,
    CONSTRAINT "delivery_confirmation_attempts_lock_level_check" CHECK (("lock_level" >= 0)),
    CONSTRAINT "delivery_confirmation_attempts_request_id_check" CHECK (("request_id" ~ '^[A-Za-z0-9_-]{8,128}$'::"text")),
    CONSTRAINT "delivery_confirmation_attempts_result_check" CHECK (("result" = ANY (ARRAY['incorrect_code'::"text", 'temporarily_locked'::"text", 'confirmed'::"text", 'already_delivered'::"text"])))
);


ALTER TABLE "public"."delivery_confirmation_attempts" OWNER TO "postgres";


COMMENT ON TABLE "public"."delivery_confirmation_attempts" IS 'Audit-only delivery-code attempts. The submitted code is never stored.';



CREATE TABLE IF NOT EXISTS "public"."delivery_outbox" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "order_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "event_key" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "dispatched_at" timestamp with time zone,
    CONSTRAINT "delivery_outbox_event_key_check" CHECK (("event_key" ~ '^[A-Za-z0-9_-]{8,128}$'::"text")),
    CONSTRAINT "delivery_outbox_event_type_check" CHECK (("event_type" = ANY (ARRAY['delivery_confirmed'::"text", 'rider_issue_reported'::"text"])))
);


ALTER TABLE "public"."delivery_outbox" OWNER TO "postgres";


COMMENT ON TABLE "public"."delivery_outbox" IS 'Transactional notification/outbox intent. Dispatching remains asynchronous and idempotent.';



CREATE TABLE IF NOT EXISTS "public"."fiscal_credit_allocations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "original_document_id" "uuid" NOT NULL,
    "original_item_id" "uuid" NOT NULL,
    "credit_document_id" "uuid" NOT NULL,
    "quantity" numeric(14,3) NOT NULL,
    "net_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "tax_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "exempt_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "non_taxed_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "other_taxes_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "total_amount" numeric(14,2) NOT NULL,
    "state" "text" DEFAULT 'reserved'::"text" NOT NULL,
    "snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "fiscal_credit_allocations_exempt_amount_check" CHECK (("exempt_amount" >= (0)::numeric)),
    CONSTRAINT "fiscal_credit_allocations_net_amount_check" CHECK (("net_amount" >= (0)::numeric)),
    CONSTRAINT "fiscal_credit_allocations_non_taxed_amount_check" CHECK (("non_taxed_amount" >= (0)::numeric)),
    CONSTRAINT "fiscal_credit_allocations_other_taxes_amount_check" CHECK (("other_taxes_amount" >= (0)::numeric)),
    CONSTRAINT "fiscal_credit_allocations_quantity_check" CHECK (("quantity" > (0)::numeric)),
    CONSTRAINT "fiscal_credit_allocations_state_check" CHECK (("state" = ANY (ARRAY['reserved'::"text", 'authorized'::"text", 'released'::"text"]))),
    CONSTRAINT "fiscal_credit_allocations_tax_amount_check" CHECK (("tax_amount" >= (0)::numeric)),
    CONSTRAINT "fiscal_credit_allocations_total_amount_check" CHECK (("total_amount" > (0)::numeric))
);


ALTER TABLE "public"."fiscal_credit_allocations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fiscal_document_artifacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "fiscal_document_id" "uuid" NOT NULL,
    "artifact_type" "text" NOT NULL,
    "state" "text" DEFAULT 'artifact_ready'::"text" NOT NULL,
    "storage_provider" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "mime_type" "text" NOT NULL,
    "size_bytes" bigint NOT NULL,
    "sha256" "text" NOT NULL,
    "document_number" bigint NOT NULL,
    "generated_at" timestamp with time zone NOT NULL,
    "generated_by" "text" NOT NULL,
    "generation_version" "text" NOT NULL,
    "generation_token" "uuid" NOT NULL,
    "is_current" boolean DEFAULT true NOT NULL,
    "supersedes_artifact_id" "uuid",
    "superseded_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "fiscal_document_artifacts_artifact_type_check" CHECK (("artifact_type" = 'authorized_pdf'::"text")),
    CONSTRAINT "fiscal_document_artifacts_document_number_check" CHECK (("document_number" > 0)),
    CONSTRAINT "fiscal_document_artifacts_generated_by_check" CHECK ((("char_length"("generated_by") >= 3) AND ("char_length"("generated_by") <= 80))),
    CONSTRAINT "fiscal_document_artifacts_generation_version_check" CHECK ((("char_length"("generation_version") >= 1) AND ("char_length"("generation_version") <= 80))),
    CONSTRAINT "fiscal_document_artifacts_mime_type_check" CHECK (("mime_type" = 'application/pdf'::"text")),
    CONSTRAINT "fiscal_document_artifacts_sha256_check" CHECK (("sha256" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "fiscal_document_artifacts_size_bytes_check" CHECK ((("size_bytes" > 0) AND ("size_bytes" <= 16777216))),
    CONSTRAINT "fiscal_document_artifacts_state_check" CHECK (("state" = ANY (ARRAY['artifact_ready'::"text", 'artifact_superseded'::"text"]))),
    CONSTRAINT "fiscal_document_artifacts_storage_path_check" CHECK (("storage_path" ~ '^fiscal/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}[.]pdf$'::"text")),
    CONSTRAINT "fiscal_document_artifacts_storage_provider_check" CHECK (("storage_provider" = 'supabase_storage'::"text"))
);


ALTER TABLE "public"."fiscal_document_artifacts" OWNER TO "postgres";


COMMENT ON TABLE "public"."fiscal_document_artifacts" IS 'Metadatos inmutables de PDF fiscal autorizado; storage_path no se expone al panel.';



CREATE TABLE IF NOT EXISTS "public"."fiscal_document_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fiscal_document_id" "uuid" NOT NULL,
    "description" "text" NOT NULL,
    "quantity" numeric(14,3) NOT NULL,
    "unit_price" numeric(14,2) NOT NULL,
    "net_amount" numeric(14,2) NOT NULL,
    "tax_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "tax_code" integer,
    "exempt_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "non_taxed_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "other_taxes_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "tax_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "fiscal_document_items_quantity_check" CHECK (("quantity" > (0)::numeric))
);


ALTER TABLE "public"."fiscal_document_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fiscal_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fiscal_document_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "actor_type" "text" NOT NULL,
    "actor_id" "uuid",
    "request_id" "text",
    "sanitized_detail" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "fiscal_events_actor_type_check" CHECK (("actor_type" = ANY (ARRAY['operator'::"text", 'worker'::"text", 'arca'::"text", 'system'::"text"])))
);


ALTER TABLE "public"."fiscal_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fiscal_print_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "fiscal_document_id" "uuid" NOT NULL,
    "artifact_id" "uuid" NOT NULL,
    "printer_name_hash" "text" NOT NULL,
    "format" "text" NOT NULL,
    "copies" integer NOT NULL,
    "requested_by" "uuid" NOT NULL,
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "completed_at" timestamp with time zone,
    "error_code" "text",
    "idempotency_key" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "correlation_id" "uuid" NOT NULL,
    CONSTRAINT "fiscal_print_jobs_copies_check" CHECK ((("copies" >= 1) AND ("copies" <= 5))),
    CONSTRAINT "fiscal_print_jobs_format_check" CHECK (("format" = ANY (ARRAY['a4'::"text", 'thermal'::"text"]))),
    CONSTRAINT "fiscal_print_jobs_idempotency_key_check" CHECK (("idempotency_key" ~ '^[A-Za-z0-9:_-]{8,128}$'::"text")),
    CONSTRAINT "fiscal_print_jobs_printer_name_hash_check" CHECK (("printer_name_hash" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "fiscal_print_jobs_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'sent_to_spooler'::"text", 'completed_when_verifiable'::"text", 'failed'::"text", 'unknown'::"text"])))
);


ALTER TABLE "public"."fiscal_print_jobs" OWNER TO "postgres";


COMMENT ON TABLE "public"."fiscal_print_jobs" IS 'Auditoria de reimpresion. sent_to_spooler no equivale a completado.';



CREATE TABLE IF NOT EXISTS "public"."fiscal_profile_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "actor_id" "uuid" NOT NULL,
    "detail" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "fiscal_profile_events_event_type_check" CHECK (("event_type" = 'homologation_authorized'::"text"))
);


ALTER TABLE "public"."fiscal_profile_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fiscal_request_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fiscal_document_id" "uuid" NOT NULL,
    "outbox_id" "uuid" NOT NULL,
    "request_id" "text" NOT NULL,
    "operation" "text" NOT NULL,
    "result_class" "text",
    "request_hash" "text",
    "response_hash" "text",
    "duration_ms" integer,
    "error_code" "text",
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."fiscal_request_attempts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."identity_audit_events" (
    "id" bigint NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "business_id" "uuid",
    "actor_user_id" "uuid",
    "actor_role" "text",
    "subject_user_id" "uuid",
    "session_id" "uuid",
    "event_type" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "identity_audit_events_actor_role_check" CHECK ((("actor_role" IS NULL) OR ("actor_role" = ANY (ARRAY['owner'::"text", 'admin'::"text", 'staff'::"text", 'rider'::"text", 'system'::"text"])))),
    CONSTRAINT "identity_audit_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['session_opened'::"text", 'session_closed'::"text", 'session_revoked'::"text", 'sessions_revoked_all'::"text", 'session_rejected'::"text", 'member_invited'::"text", 'invitation_accepted'::"text", 'invitation_revoked'::"text", 'member_activated'::"text", 'member_disabled'::"text", 'member_role_changed'::"text", 'profile_updated'::"text", 'authorization_denied'::"text"]))),
    CONSTRAINT "identity_audit_events_metadata_is_object" CHECK (("jsonb_typeof"("metadata") = 'object'::"text")),
    CONSTRAINT "identity_audit_events_metadata_is_small" CHECK (("length"(("metadata")::"text") <= 2000))
);


ALTER TABLE "public"."identity_audit_events" OWNER TO "postgres";


COMMENT ON COLUMN "public"."identity_audit_events"."business_id" IS 'Comercio al que pertenecia el evento. Sin clave foranea a proposito: la auditoria sobrevive al borrado del comercio.';



COMMENT ON COLUMN "public"."identity_audit_events"."actor_user_id" IS 'Quien hizo la accion. Sin clave foranea a proposito: la auditoria sobrevive al borrado de la cuenta.';



COMMENT ON COLUMN "public"."identity_audit_events"."subject_user_id" IS 'Sobre quien se hizo la accion. Sin clave foranea, por el mismo motivo.';



ALTER TABLE "public"."identity_audit_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."identity_audit_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."identity_invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "invited_email" "text" NOT NULL,
    "invited_role" "text" NOT NULL,
    "full_name" "text" NOT NULL,
    "token_hash" "text" NOT NULL,
    "invited_by" "uuid",
    "invited_by_role" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "accepted_at" timestamp with time zone,
    "accepted_user_id" "uuid",
    "revoked_at" timestamp with time zone,
    "revoked_by" "uuid",
    CONSTRAINT "identity_invitations_acceptance_is_complete" CHECK ((("accepted_at" IS NULL) = ("accepted_user_id" IS NULL))),
    CONSTRAINT "identity_invitations_expiry_is_future" CHECK (("expires_at" > "created_at")),
    CONSTRAINT "identity_invitations_full_name_check" CHECK ((("length"("btrim"("full_name")) >= 2) AND ("length"("btrim"("full_name")) <= 120))),
    CONSTRAINT "identity_invitations_invited_by_role_check" CHECK ((("invited_by_role" IS NULL) OR ("invited_by_role" = ANY (ARRAY['owner'::"text", 'admin'::"text"])))),
    CONSTRAINT "identity_invitations_invited_email_check" CHECK ((("invited_email" = "lower"("btrim"("invited_email"))) AND ("invited_email" ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'::"text"))),
    CONSTRAINT "identity_invitations_invited_role_check" CHECK (("invited_role" = ANY (ARRAY['owner'::"text", 'admin'::"text", 'staff'::"text", 'rider'::"text"]))),
    CONSTRAINT "identity_invitations_not_both_accepted_and_revoked" CHECK ((("accepted_at" IS NULL) OR ("revoked_at" IS NULL))),
    CONSTRAINT "identity_invitations_token_hash_check" CHECK (("token_hash" ~ '^[0-9a-f]{64}$'::"text"))
);


ALTER TABLE "public"."identity_invitations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."identity_permissions" (
    "permission" "text" NOT NULL,
    "description" "text" NOT NULL,
    CONSTRAINT "identity_permissions_permission_check" CHECK (("permission" ~ '^[a-z]+(\.[a-z_]+)+$'::"text"))
);


ALTER TABLE "public"."identity_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."identity_role_permissions" (
    "role" "text" NOT NULL,
    "permission" "text" NOT NULL,
    CONSTRAINT "identity_role_permissions_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'admin'::"text", 'staff'::"text", 'rider'::"text"])))
);


ALTER TABLE "public"."identity_role_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."identity_sessions" (
    "session_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "business_id" "uuid" NOT NULL,
    "role_at_login" "text" NOT NULL,
    "client" "text" NOT NULL,
    "device_label" "text",
    "device_key_hash" "text",
    "app_version" "text",
    "first_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "revoked_at" timestamp with time zone,
    "revoked_by" "uuid",
    "revoked_reason" "text",
    CONSTRAINT "identity_sessions_app_version_check" CHECK ((("app_version" IS NULL) OR (("length"("btrim"("app_version")) >= 1) AND ("length"("btrim"("app_version")) <= 40)))),
    CONSTRAINT "identity_sessions_client_check" CHECK (("client" = ANY (ARRAY['rider_android'::"text", 'panel_web'::"text", 'unknown'::"text"]))),
    CONSTRAINT "identity_sessions_device_key_hash_check" CHECK ((("device_key_hash" IS NULL) OR ("device_key_hash" ~ '^[0-9a-f]{64}$'::"text"))),
    CONSTRAINT "identity_sessions_device_label_check" CHECK ((("device_label" IS NULL) OR (("length"("btrim"("device_label")) >= 2) AND ("length"("btrim"("device_label")) <= 80)))),
    CONSTRAINT "identity_sessions_revocation_is_complete" CHECK ((("revoked_at" IS NULL) = ("revoked_reason" IS NULL))),
    CONSTRAINT "identity_sessions_revoked_reason_check" CHECK ((("revoked_reason" IS NULL) OR ("revoked_reason" = ANY (ARRAY['owner_revoked'::"text", 'revoke_all'::"text", 'member_disabled'::"text", 'role_changed'::"text", 'self_logout'::"text"])))),
    CONSTRAINT "identity_sessions_role_at_login_check" CHECK (("role_at_login" = ANY (ARRAY['owner'::"text", 'admin'::"text", 'staff'::"text", 'rider'::"text"])))
);


ALTER TABLE "public"."identity_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."identity_user_security" (
    "business_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "sessions_valid_from" timestamp with time zone DEFAULT '-infinity'::timestamp with time zone NOT NULL,
    "disabled_at" timestamp with time zone,
    "disabled_by" "uuid",
    "disabled_reason" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "identity_user_security_disabled_reason_check" CHECK ((("disabled_reason" IS NULL) OR (("length"("btrim"("disabled_reason")) >= 3) AND ("length"("btrim"("disabled_reason")) <= 200))))
);


ALTER TABLE "public"."identity_user_security" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inventory_receipt_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "receipt_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "barcode_id" "uuid",
    "package_quantity" integer NOT NULL,
    "unit_factor" integer NOT NULL,
    "base_units" integer GENERATED ALWAYS AS (("package_quantity" * "unit_factor")) STORED,
    "unit_cost" numeric(12,2),
    "lot_reference" "text",
    "expires_on" "date",
    CONSTRAINT "inventory_receipt_items_package_quantity_check" CHECK (("package_quantity" > 0)),
    CONSTRAINT "inventory_receipt_items_unit_factor_check" CHECK (("unit_factor" > 0))
);


ALTER TABLE "public"."inventory_receipt_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inventory_receipts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "supplier_reference" "text",
    "created_by" "uuid" NOT NULL,
    "confirmed_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "confirmed_at" timestamp with time zone,
    CONSTRAINT "inventory_receipts_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'confirming'::"text", 'confirmed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."inventory_receipts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inventory_reservations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "checkout_session_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "quantity" integer NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "released_at" timestamp with time zone,
    "release_reason" "text",
    "converted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "reservation_generation" integer DEFAULT 1 NOT NULL,
    CONSTRAINT "inventory_reservations_expiry_check" CHECK (("expires_at" > "created_at")),
    CONSTRAINT "inventory_reservations_quantity_check" CHECK ((("quantity" >= 1) AND ("quantity" <= 1000))),
    CONSTRAINT "inventory_reservations_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'released'::"text", 'converted'::"text"]))),
    CONSTRAINT "inventory_reservations_transition_check" CHECK (((("status" = 'active'::"text") AND ("released_at" IS NULL) AND ("converted_at" IS NULL)) OR (("status" = 'released'::"text") AND ("released_at" IS NOT NULL) AND ("converted_at" IS NULL)) OR (("status" = 'converted'::"text") AND ("converted_at" IS NOT NULL) AND ("released_at" IS NULL))))
);


ALTER TABLE "public"."inventory_reservations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_outbox" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "aggregate_id" "uuid",
    "deduplication_key" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "state" "text" DEFAULT 'pending'::"text" NOT NULL,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "next_attempt_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_error" "text",
    "processed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "notification_outbox_state_check" CHECK (("state" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'processed'::"text", 'failed'::"text", 'dead_letter'::"text"])))
);


ALTER TABLE "public"."notification_outbox" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."operational_alert_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "alert_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "actor_id" "uuid",
    "detail" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "operational_alert_events_detail_size" CHECK (("octet_length"(("detail")::"text") <= 2048)),
    CONSTRAINT "operational_alert_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['detected'::"text", 'redetected'::"text", 'acknowledged'::"text", 'resolved'::"text", 'reopened'::"text"])))
);


ALTER TABLE "public"."operational_alert_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."operational_alerts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "fingerprint" "text" NOT NULL,
    "severity" "text" NOT NULL,
    "alert_code" "text" NOT NULL,
    "subject_type" "text" NOT NULL,
    "subject_id" "uuid",
    "correlation_id" "uuid",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "summary" "text" NOT NULL,
    "required_action" "text" NOT NULL,
    "evidence" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "first_seen_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "occurrence_count" integer DEFAULT 1 NOT NULL,
    "acknowledged_by" "uuid",
    "acknowledged_at" timestamp with time zone,
    "resolved_by" "uuid",
    "resolved_at" timestamp with time zone,
    "resolution_note" "text",
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "operational_alerts_ack_consistency" CHECK (((("status" = 'open'::"text") AND ("acknowledged_by" IS NULL) AND ("acknowledged_at" IS NULL) AND ("resolved_by" IS NULL) AND ("resolved_at" IS NULL)) OR (("status" = 'acknowledged'::"text") AND ("acknowledged_by" IS NOT NULL) AND ("acknowledged_at" IS NOT NULL) AND ("resolved_by" IS NULL) AND ("resolved_at" IS NULL)) OR (("status" = 'resolved'::"text") AND ("resolved_at" IS NOT NULL)))),
    CONSTRAINT "operational_alerts_alert_code_check" CHECK (("alert_code" ~ '^[A-Z0-9_]{3,80}$'::"text")),
    CONSTRAINT "operational_alerts_evidence_size" CHECK (("octet_length"(("evidence")::"text") <= 4096)),
    CONSTRAINT "operational_alerts_fingerprint_check" CHECK (("fingerprint" ~ '^[a-f0-9]{64}$'::"text")),
    CONSTRAINT "operational_alerts_occurrence_count_check" CHECK (("occurrence_count" > 0)),
    CONSTRAINT "operational_alerts_required_action_check" CHECK ((("char_length"("required_action") >= 3) AND ("char_length"("required_action") <= 300))),
    CONSTRAINT "operational_alerts_severity_check" CHECK (("severity" = ANY (ARRAY['INFO'::"text", 'WARNING'::"text", 'ACTION_REQUIRED'::"text", 'CRITICAL'::"text"]))),
    CONSTRAINT "operational_alerts_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'acknowledged'::"text", 'resolved'::"text"]))),
    CONSTRAINT "operational_alerts_subject_type_check" CHECK (("subject_type" ~ '^[a-z0-9_]{2,40}$'::"text")),
    CONSTRAINT "operational_alerts_summary_check" CHECK ((("char_length"("summary") >= 3) AND ("char_length"("summary") <= 240)))
);


ALTER TABLE "public"."operational_alerts" OWNER TO "postgres";


COMMENT ON TABLE "public"."operational_alerts" IS 'Durable sanitized operational alerts with concrete remediation actions.';



CREATE TABLE IF NOT EXISTS "public"."operational_sweep_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "scope" "text" DEFAULT 'operational_alerts'::"text" NOT NULL,
    "status" "text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "finished_at" timestamp with time zone,
    "businesses_evaluated" integer DEFAULT 0 NOT NULL,
    "findings" integer DEFAULT 0 NOT NULL,
    "open_alerts" integer DEFAULT 0 NOT NULL,
    "critical_alerts" integer DEFAULT 0 NOT NULL,
    "failures" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    CONSTRAINT "operational_sweep_runs_businesses_evaluated_check" CHECK (("businesses_evaluated" >= 0)),
    CONSTRAINT "operational_sweep_runs_critical_alerts_check" CHECK (("critical_alerts" >= 0)),
    CONSTRAINT "operational_sweep_runs_failures_size" CHECK (("octet_length"(("failures")::"text") <= 4096)),
    CONSTRAINT "operational_sweep_runs_findings_check" CHECK (("findings" >= 0)),
    CONSTRAINT "operational_sweep_runs_open_alerts_check" CHECK (("open_alerts" >= 0)),
    CONSTRAINT "operational_sweep_runs_scope_check" CHECK (("scope" ~ '^[a-z0-9_]{3,40}$'::"text")),
    CONSTRAINT "operational_sweep_runs_status_check" CHECK (("status" = ANY (ARRAY['ok'::"text", 'partial'::"text", 'failed'::"text", 'skipped'::"text"])))
);


ALTER TABLE "public"."operational_sweep_runs" OWNER TO "postgres";


COMMENT ON TABLE "public"."operational_sweep_runs" IS 'Una fila por evaluacion automatica de alertas. La antiguedad de la ultima fila es la prueba de que el sistema se esta mirando solo.';



CREATE TABLE IF NOT EXISTS "public"."order_abuse_events" (
    "id" bigint NOT NULL,
    "business_id" "uuid" NOT NULL,
    "customer_user_id" "uuid",
    "fingerprint_hash" "bytea",
    "event_type" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "order_abuse_events_no_raw_fingerprint" CHECK ((("fingerprint_hash" IS NULL) OR ("octet_length"("fingerprint_hash") = 32)))
);


ALTER TABLE "public"."order_abuse_events" OWNER TO "postgres";


ALTER TABLE "public"."order_abuse_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."order_abuse_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."order_combos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "combo_uuid" "uuid",
    "combo_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "quantity" integer NOT NULL,
    "discount_percentage" numeric(5,2) NOT NULL,
    "list_price" numeric(12,2) NOT NULL,
    "promotional_price" numeric(12,2) NOT NULL,
    "discount_amount" numeric(12,2) NOT NULL,
    "combo_snapshot" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "order_combos_price_check" CHECK ((("list_price" > (0)::numeric) AND ("promotional_price" > (0)::numeric) AND ("promotional_price" <= "list_price") AND ("discount_amount" = (("list_price" - "promotional_price") * ("quantity")::numeric)))),
    CONSTRAINT "order_combos_quantity_check" CHECK ((("quantity" >= 1) AND ("quantity" <= 100)))
);


ALTER TABLE "public"."order_combos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_delivery_handoffs" (
    "order_id" "uuid" NOT NULL,
    "code_hash" "text" NOT NULL,
    "code_ciphertext" "bytea" NOT NULL,
    "failed_attempts" integer DEFAULT 0 NOT NULL,
    "locked_until" timestamp with time zone,
    "confirmed_at" timestamp with time zone,
    "confirmed_by_user_id" "uuid",
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "order_delivery_handoffs_check" CHECK (("expires_at" > "created_at")),
    CONSTRAINT "order_delivery_handoffs_failed_attempts_check" CHECK ((("failed_attempts" >= 0) AND ("failed_attempts" <= 20)))
);


ALTER TABLE "public"."order_delivery_handoffs" OWNER TO "postgres";


COMMENT ON TABLE "public"."order_delivery_handoffs" IS 'Server-only bcrypt and token-encrypted delivery handoff secrets.';



CREATE TABLE IF NOT EXISTS "public"."order_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "actor_type" "text",
    "actor_id" "uuid",
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "actor_user_id" "uuid",
    "actor_role" "text",
    "event_type" "text" NOT NULL,
    "message" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "sequence" bigint NOT NULL,
    CONSTRAINT "order_events_actor_role_check" CHECK (("actor_role" = ANY (ARRAY['customer'::"text", 'business'::"text", 'rider'::"text", 'system'::"text"])))
);

ALTER TABLE ONLY "public"."order_events" REPLICA IDENTITY FULL;


ALTER TABLE "public"."order_events" OWNER TO "postgres";


COMMENT ON COLUMN "public"."order_events"."sequence" IS 'Orden total de eventos. Desempata eventos escritos en la misma transaccion, donde created_at es identico.';



CREATE SEQUENCE IF NOT EXISTS "public"."order_events_sequence_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."order_events_sequence_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."order_events_sequence_seq" OWNED BY "public"."order_events"."sequence";



CREATE TABLE IF NOT EXISTS "public"."order_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "product_id" "text",
    "name" "text" NOT NULL,
    "quantity" numeric(12,3) NOT NULL,
    "unit" "text",
    "unit_price" numeric(12,2) NOT NULL,
    "subtotal" numeric(12,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "product_uuid" "uuid",
    CONSTRAINT "order_items_quantity_check" CHECK (("quantity" > (0)::numeric)),
    CONSTRAINT "order_items_subtotal_check" CHECK (("subtotal" >= (0)::numeric)),
    CONSTRAINT "order_items_subtotal_matches_parts" CHECK (("subtotal" = ("quantity" * "unit_price"))),
    CONSTRAINT "order_items_unit_price_check" CHECK (("unit_price" >= (0)::numeric))
);


ALTER TABLE "public"."order_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_packing_scans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "order_item_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "barcode_id" "uuid" NOT NULL,
    "unit_factor" integer NOT NULL,
    "operator_id" "uuid" NOT NULL,
    "scan_key" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reverted_at" timestamp with time zone,
    CONSTRAINT "order_packing_scans_unit_factor_check" CHECK (("unit_factor" > 0))
);


ALTER TABLE "public"."order_packing_scans" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."order_public_code_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."order_public_code_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_public_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "token" "text",
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "token_hash" "bytea" NOT NULL,
    "revoked_at" timestamp with time zone,
    "terminal_visible_until" timestamp with time zone,
    CONSTRAINT "order_public_tokens_hash_size" CHECK (("octet_length"("token_hash") = 32))
);


ALTER TABLE "public"."order_public_tokens" OWNER TO "postgres";


COMMENT ON TABLE "public"."order_public_tokens" IS 'Token publico opaco para que un cliente anonimo lea solo su pedido.';



COMMENT ON COLUMN "public"."order_public_tokens"."token_hash" IS 'SHA-256 digest of the caller-generated tracking bearer token; plaintext is never persisted.';



COMMENT ON COLUMN "public"."order_public_tokens"."terminal_visible_until" IS 'Read-only public visibility deadline after a terminal order transition. Explicit revoked_at and expires_at always take precedence.';



CREATE TABLE IF NOT EXISTS "public"."orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "status" "text" DEFAULT 'submitted'::"text" NOT NULL,
    "fulfillment_type" "text" DEFAULT 'delivery'::"text" NOT NULL,
    "customer_name" "text",
    "customer_phone" "text",
    "customer_whatsapp" "text",
    "address_label" "text",
    "address_lat" double precision,
    "address_lng" double precision,
    "notes" "text",
    "payment_method" "text" NOT NULL,
    "subtotal" numeric(12,2) DEFAULT 0 NOT NULL,
    "delivery_fee" numeric(12,2) DEFAULT 0 NOT NULL,
    "total" numeric(12,2) DEFAULT 0 NOT NULL,
    "assigned_rider_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "accepted_at" timestamp with time zone,
    "ready_at" timestamp with time zone,
    "picked_up_at" timestamp with time zone,
    "arrived_at" timestamp with time zone,
    "delivered_at" timestamp with time zone,
    "canceled_at" timestamp with time zone,
    "public_code" "text" NOT NULL,
    "customer_street_address" "text",
    "customer_neighborhood" "text",
    "customer_reference" "text",
    "customer_notes" "text",
    "delivery_mode" "text" NOT NULL,
    "assigned_rider_user_id" "uuid",
    "preparing_at" timestamp with time zone,
    "dispatched_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "rejected_at" timestamp with time zone,
    "customer_user_id" "uuid",
    "client_request_id" "text" NOT NULL,
    "client_request_fingerprint" "text",
    "currency_code" "text",
    "inventory_released_at" timestamp with time zone,
    "age_confirmed_at" timestamp with time zone,
    "age_confirmation_policy" integer,
    "reservation_expires_at" timestamp with time zone,
    "abuse_fingerprint_hash" "bytea",
    "estimated_arrival_at" timestamp with time zone,
    "estimated_arrival_source" "text",
    "estimated_arrival_updated_at" timestamp with time zone,
    "delivery_code_required" boolean DEFAULT true NOT NULL,
    "customer_address_id" "uuid",
    "delivery_address_formatted" "text",
    "delivery_street" "text",
    "delivery_street_number" "text",
    "delivery_floor" "text",
    "delivery_apartment" "text",
    "delivery_reference" "text",
    "delivery_city" "text",
    "delivery_province" "text",
    "delivery_postal_code" "text",
    "delivery_latitude" numeric(9,6),
    "delivery_longitude" numeric(9,6),
    "delivery_geolocation_accuracy" numeric(10,2),
    "delivery_address_source" "text",
    "delivery_address_label" "text",
    "delivery_snapshot_created_at" timestamp with time zone,
    "revision" bigint DEFAULT 1 NOT NULL,
    "acknowledged_at" timestamp with time zone,
    "acknowledged_by" "uuid",
    "preparation_estimate_minutes" integer,
    "correlation_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "origin" "text" DEFAULT 'production'::"text" NOT NULL,
    "origin_reason" "text",
    "origin_classified_at" timestamp with time zone,
    "discount_total" numeric(12,2) DEFAULT 0 NOT NULL,
    "delivery_location_source" "text",
    "delivery_location_confirmed_at" timestamp with time zone,
    CONSTRAINT "orders_address_lat_check" CHECK ((("address_lat" IS NULL) OR (("address_lat" >= ('-90'::integer)::double precision) AND ("address_lat" <= (90)::double precision)))),
    CONSTRAINT "orders_address_lng_check" CHECK ((("address_lng" IS NULL) OR (("address_lng" >= ('-180'::integer)::double precision) AND ("address_lng" <= (180)::double precision)))),
    CONSTRAINT "orders_age_confirmation_complete" CHECK (((("age_confirmed_at" IS NULL) AND ("age_confirmation_policy" IS NULL)) OR (("age_confirmed_at" IS NOT NULL) AND (("age_confirmation_policy" >= 18) AND ("age_confirmation_policy" <= 99))))),
    CONSTRAINT "orders_client_request_id_format" CHECK (("client_request_id" ~ '^[A-Za-z0-9_-]{8,128}$'::"text")),
    CONSTRAINT "orders_delivery_fee_check" CHECK (("delivery_fee" >= (0)::numeric)),
    CONSTRAINT "orders_delivery_location_source_check" CHECK ((("delivery_location_source" IS NULL) OR ("delivery_location_source" = ANY (ARRAY['gps'::"text", 'map_pin'::"text", 'geocoded_confirmed'::"text"])))),
    CONSTRAINT "orders_delivery_mode_check" CHECK (("delivery_mode" = ANY (ARRAY['delivery'::"text", 'pickup'::"text"]))),
    CONSTRAINT "orders_delivery_snapshot_coordinates_pair" CHECK (((("delivery_latitude" IS NULL) AND ("delivery_longitude" IS NULL)) OR ((("delivery_latitude" >= ('-90'::integer)::numeric) AND ("delivery_latitude" <= (90)::numeric)) AND (("delivery_longitude" >= ('-180'::integer)::numeric) AND ("delivery_longitude" <= (180)::numeric))))),
    CONSTRAINT "orders_delivery_snapshot_source_check" CHECK ((("delivery_address_source" IS NULL) OR ("delivery_address_source" = ANY (ARRAY['manual'::"text", 'gps'::"text", 'geocoder'::"text", 'previous_order'::"text"])))),
    CONSTRAINT "orders_discount_total_check" CHECK ((("discount_total" >= (0)::numeric) AND ("discount_total" <= "subtotal"))),
    CONSTRAINT "orders_estimated_arrival_metadata_consistent" CHECK (((("estimated_arrival_at" IS NULL) AND ("estimated_arrival_source" IS NULL) AND ("estimated_arrival_updated_at" IS NULL)) OR (("estimated_arrival_at" IS NOT NULL) AND ("estimated_arrival_source" IS NOT NULL) AND ("estimated_arrival_updated_at" IS NOT NULL)))),
    CONSTRAINT "orders_estimated_arrival_source_check" CHECK ((("estimated_arrival_source" IS NULL) OR ("estimated_arrival_source" = ANY (ARRAY['business'::"text", 'routing'::"text"])))),
    CONSTRAINT "orders_fulfillment_type_check" CHECK (("fulfillment_type" = ANY (ARRAY['delivery'::"text", 'pickup'::"text"]))),
    CONSTRAINT "orders_origin_reason_present" CHECK ((("origin" = 'production'::"text") OR (("origin_reason" IS NOT NULL) AND ("btrim"("origin_reason") <> ''::"text") AND ("origin_classified_at" IS NOT NULL)))),
    CONSTRAINT "orders_origin_valid" CHECK (("origin" = ANY (ARRAY['production'::"text", 'qa'::"text"]))),
    CONSTRAINT "orders_payment_method_valid" CHECK (("payment_method" = ANY (ARRAY['mercadopago'::"text", 'cash'::"text", 'coordinate'::"text", 'qa_no_charge'::"text"]))),
    CONSTRAINT "orders_preparation_estimate_range" CHECK ((("preparation_estimate_minutes" IS NULL) OR (("preparation_estimate_minutes" >= 1) AND ("preparation_estimate_minutes" <= 240)))),
    CONSTRAINT "orders_qa_payment_method_requires_qa_origin" CHECK ((("payment_method" <> 'qa_no_charge'::"text") OR ("origin" = 'qa'::"text"))),
    CONSTRAINT "orders_status_check" CHECK (("status" = ANY (ARRAY['received'::"text", 'accepted'::"text", 'preparing'::"text", 'ready'::"text", 'on_the_way'::"text", 'delivered'::"text", 'cancelled'::"text", 'rejected'::"text", 'draft'::"text", 'submitted'::"text", 'assigned'::"text", 'picked_up'::"text", 'arrived'::"text", 'arriving'::"text", 'canceled'::"text"]))),
    CONSTRAINT "orders_subtotal_check" CHECK (("subtotal" >= (0)::numeric)),
    CONSTRAINT "orders_total_check" CHECK (("total" >= (0)::numeric)),
    CONSTRAINT "orders_total_matches_parts" CHECK (("total" = (("subtotal" - "discount_total") + "delivery_fee"))),
    CONSTRAINT "orders_total_not_below_subtotal" CHECK (("total" >= ("subtotal" - "discount_total")))
);

ALTER TABLE ONLY "public"."orders" REPLICA IDENTITY FULL;


ALTER TABLE "public"."orders" OWNER TO "postgres";


COMMENT ON COLUMN "public"."orders"."client_request_id" IS 'Caller-generated idempotency key, unique inside a business.';



COMMENT ON COLUMN "public"."orders"."delivery_address_label" IS 'Immutable customer-facing label captured for this order, such as Casa or Trabajo.';



COMMENT ON COLUMN "public"."orders"."delivery_snapshot_created_at" IS 'Server timestamp at which the immutable delivery snapshot was accepted.';



COMMENT ON COLUMN "public"."orders"."revision" IS 'Version monotona del pedido. La incrementa el trigger orders_zz_bump_revision en cada UPDATE efectivo; el cliente nunca la escribe.';



COMMENT ON COLUMN "public"."orders"."origin" IS 'production = pedido operativo real; qa = fixture de prueba, se conserva como evidencia y nunca se despacha.';



COMMENT ON COLUMN "public"."orders"."origin_reason" IS 'Evidencia de por qué el pedido quedó clasificado como QA.';



COMMENT ON COLUMN "public"."orders"."discount_total" IS 'Descuento decidido por el backend (hoy: combos). El total nunca lo dicta el navegador.';



COMMENT ON COLUMN "public"."orders"."delivery_location_source" IS 'Origen del punto de entrega del pedido: gps, map_pin o geocoded_confirmed.';



COMMENT ON COLUMN "public"."orders"."delivery_location_confirmed_at" IS 'Instante en que el cliente confirmo el punto de entrega de este pedido.';



COMMENT ON CONSTRAINT "orders_payment_method_valid" ON "public"."orders" IS 'Modalidad de pago explícita: Mercado Pago, efectivo, coordinado o QA sin cargo.';



COMMENT ON CONSTRAINT "orders_total_matches_parts" ON "public"."orders" IS 'El total es exactamente subtotal - descuento + envio. El descuento lo decide el backend.';



CREATE TABLE IF NOT EXISTS "public"."payment_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "payment_intent_id" "uuid" NOT NULL,
    "attempt_number" integer NOT NULL,
    "attempt_type" "text" DEFAULT 'preference'::"text" NOT NULL,
    "idempotency_key" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "preference_id" "text",
    "init_point" "text",
    "sandbox_init_point" "text",
    "status" "text" DEFAULT 'prepared'::"text" NOT NULL,
    "provider_request_id" "text",
    "request_hash" "text",
    "response_hash" "text",
    "last_error_code" "text",
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "payment_attempts_hash_check" CHECK (((("request_hash" IS NULL) OR ("request_hash" ~ '^[a-f0-9]{64}$'::"text")) AND (("response_hash" IS NULL) OR ("response_hash" ~ '^[a-f0-9]{64}$'::"text")))),
    CONSTRAINT "payment_attempts_number_check" CHECK (("attempt_number" >= 1)),
    CONSTRAINT "payment_attempts_status_check" CHECK (("status" = ANY (ARRAY['prepared'::"text", 'request_sent'::"text", 'created'::"text", 'ambiguous'::"text", 'failed'::"text", 'completed'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "payment_attempts_type_check" CHECK (("attempt_type" = ANY (ARRAY['preference'::"text", 'refund'::"text", 'cancellation'::"text", 'reconciliation'::"text"])))
);


ALTER TABLE "public"."payment_attempts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment_cancellations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "payment_intent_id" "uuid" NOT NULL,
    "idempotency_key" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "status" "text" DEFAULT 'requested'::"text" NOT NULL,
    "requested_by" "uuid",
    "raw_response_hash" "text",
    "requested_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "completed_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "payment_cancellations_hash_check" CHECK ((("raw_response_hash" IS NULL) OR ("raw_response_hash" ~ '^[a-f0-9]{64}$'::"text"))),
    CONSTRAINT "payment_cancellations_status_check" CHECK (("status" = ANY (ARRAY['requested'::"text", 'processing'::"text", 'cancelled'::"text", 'rejected'::"text", 'ambiguous'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."payment_cancellations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment_disputes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "payment_intent_id" "uuid" NOT NULL,
    "provider_dispute_id" "text" NOT NULL,
    "dispute_type" "text" NOT NULL,
    "status" "text" NOT NULL,
    "coverage_eligible" boolean,
    "documentation_required" boolean,
    "documentation_status" "text",
    "due_at" timestamp with time zone,
    "raw_response_hash" "text",
    "opened_at" timestamp with time zone,
    "resolved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "payment_disputes_hash_check" CHECK ((("raw_response_hash" IS NULL) OR ("raw_response_hash" ~ '^[a-f0-9]{64}$'::"text"))),
    CONSTRAINT "payment_disputes_type_check" CHECK (("dispute_type" = ANY (ARRAY['chargeback'::"text", 'claim'::"text"])))
);


ALTER TABLE "public"."payment_disputes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "payment_intent_id" "uuid" NOT NULL,
    "webhook_receipt_id" "uuid",
    "provider_event_id" "text",
    "event_type" "text" NOT NULL,
    "provider_status" "text",
    "provider_status_detail" "text",
    "provider_occurred_at" timestamp with time zone,
    "server_recorded_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "sequence" bigint NOT NULL,
    "raw_response_hash" "text",
    "details" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "payment_events_hash_check" CHECK ((("raw_response_hash" IS NULL) OR ("raw_response_hash" ~ '^[a-f0-9]{64}$'::"text")))
);


ALTER TABLE "public"."payment_events" OWNER TO "postgres";


ALTER TABLE "public"."payment_events" ALTER COLUMN "sequence" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."payment_events_sequence_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."payment_intents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "checkout_session_id" "uuid" NOT NULL,
    "business_id" "uuid" NOT NULL,
    "order_id" "uuid",
    "provider" "text" DEFAULT 'mercadopago'::"text" NOT NULL,
    "environment" "text" NOT NULL,
    "idempotency_key" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "external_reference" "text" NOT NULL,
    "preference_id" "text",
    "provider_payment_id" "text",
    "provider_merchant_order_id" "text",
    "provider_status" "text",
    "provider_status_detail" "text",
    "provider_payment_method" "text",
    "internal_status" "text" DEFAULT 'created'::"text" NOT NULL,
    "currency" "text" DEFAULT 'ARS'::"text" NOT NULL,
    "expected_amount" numeric(12,2) NOT NULL,
    "paid_amount" numeric(12,2),
    "payer_email_hash" "text",
    "live_mode" boolean,
    "preference_created_at" timestamp with time zone,
    "approved_at" timestamp with time zone,
    "rejected_at" timestamp with time zone,
    "refunded_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "provider_event_at" timestamp with time zone,
    "raw_response_hash" "text",
    "security_review_reason" "text",
    "revision" bigint DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "correlation_id" "uuid" NOT NULL,
    CONSTRAINT "payment_intents_amount_check" CHECK ((("expected_amount" > (0)::numeric) AND (("paid_amount" IS NULL) OR ("paid_amount" >= (0)::numeric)) AND ("refunded_amount" >= (0)::numeric))),
    CONSTRAINT "payment_intents_currency_check" CHECK (("currency" = 'ARS'::"text")),
    CONSTRAINT "payment_intents_environment_check" CHECK (("environment" = ANY (ARRAY['test'::"text", 'production'::"text"]))),
    CONSTRAINT "payment_intents_external_reference_format" CHECK (("external_reference" ~ '^taba2:checkout:[0-9a-f-]{36}$'::"text")),
    CONSTRAINT "payment_intents_provider_check" CHECK (("provider" = 'mercadopago'::"text")),
    CONSTRAINT "payment_intents_raw_response_hash_format" CHECK ((("raw_response_hash" IS NULL) OR ("raw_response_hash" ~ '^[a-f0-9]{64}$'::"text"))),
    CONSTRAINT "payment_intents_status_check" CHECK (("internal_status" = ANY (ARRAY['created'::"text", 'preference_creating'::"text", 'preference_created'::"text", 'redirected'::"text", 'pending'::"text", 'in_process'::"text", 'approved'::"text", 'approved_order_pending'::"text", 'completed'::"text", 'rejected'::"text", 'cancelled'::"text", 'expired'::"text", 'refunded'::"text", 'partially_refunded'::"text", 'charged_back'::"text", 'ambiguous'::"text", 'security_review_required'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."payment_intents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment_rate_limit_buckets" (
    "scope" "text" NOT NULL,
    "subject_hash" "text" NOT NULL,
    "bucket_started_at" timestamp with time zone NOT NULL,
    "request_count" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "payment_rate_limit_count_check" CHECK (("request_count" >= 0)),
    CONSTRAINT "payment_rate_limit_scope_check" CHECK (("scope" = ANY (ARRAY['checkout_session'::"text", 'preference'::"text", 'checkout_status'::"text", 'webhook'::"text", 'refund'::"text", 'cancellation'::"text", 'worker'::"text"]))),
    CONSTRAINT "payment_rate_limit_subject_hash_check" CHECK (("subject_hash" ~ '^[a-f0-9]{64}$'::"text"))
);


ALTER TABLE "public"."payment_rate_limit_buckets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment_refunds" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "payment_intent_id" "uuid" NOT NULL,
    "order_id" "uuid",
    "provider_refund_id" "text",
    "idempotency_key" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "amount" numeric(12,2),
    "status" "text" DEFAULT 'requested'::"text" NOT NULL,
    "requested_by" "uuid",
    "reason" "text",
    "raw_response_hash" "text",
    "requested_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "completed_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "payment_refunds_amount_check" CHECK ((("amount" IS NULL) OR ("amount" > (0)::numeric))),
    CONSTRAINT "payment_refunds_hash_check" CHECK ((("raw_response_hash" IS NULL) OR ("raw_response_hash" ~ '^[a-f0-9]{64}$'::"text"))),
    CONSTRAINT "payment_refunds_status_check" CHECK (("status" = ANY (ARRAY['requested'::"text", 'processing'::"text", 'approved'::"text", 'rejected'::"text", 'ambiguous'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."payment_refunds" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment_webhook_receipts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider" "text" DEFAULT 'mercadopago'::"text" NOT NULL,
    "environment" "text" NOT NULL,
    "webhook_event_id" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "resource_id" "text" NOT NULL,
    "signature_valid" boolean NOT NULL,
    "request_id" "text",
    "payload_hash" "text" NOT NULL,
    "received_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "processed_at" timestamp with time zone,
    "processing_status" "text" DEFAULT 'received'::"text" NOT NULL,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "last_error" "text",
    CONSTRAINT "payment_webhook_receipts_attempt_count_check" CHECK (("attempt_count" >= 0)),
    CONSTRAINT "payment_webhook_receipts_environment_check" CHECK (("environment" = ANY (ARRAY['test'::"text", 'production'::"text"]))),
    CONSTRAINT "payment_webhook_receipts_hash_check" CHECK (("payload_hash" ~ '^[a-f0-9]{64}$'::"text")),
    CONSTRAINT "payment_webhook_receipts_provider_check" CHECK (("provider" = 'mercadopago'::"text")),
    CONSTRAINT "payment_webhook_receipts_status_check" CHECK (("processing_status" = ANY (ARRAY['received'::"text", 'duplicate'::"text", 'rejected_signature'::"text", 'queued'::"text", 'processing'::"text", 'completed'::"text", 'retry_wait'::"text", 'failed'::"text", 'dead_letter'::"text"])))
);


ALTER TABLE "public"."payment_webhook_receipts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sale_id" "uuid" NOT NULL,
    "payment_method" "text" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "status" "text" DEFAULT 'confirmed'::"text" NOT NULL,
    "external_reference" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "pos_payments_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "pos_payments_payment_method_check" CHECK (("payment_method" = ANY (ARRAY['cash'::"text", 'debit_card'::"text", 'credit_card'::"text", 'transfer'::"text", 'qr'::"text"]))),
    CONSTRAINT "pos_payments_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'confirmed'::"text", 'voided'::"text", 'refunded'::"text"])))
);


ALTER TABLE "public"."pos_payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_sale_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sale_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "product_name" "text" NOT NULL,
    "quantity" integer NOT NULL,
    "unit_price" numeric(12,2) NOT NULL,
    "tax_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "line_total" numeric(12,2) NOT NULL,
    CONSTRAINT "pos_sale_items_line_total_check" CHECK (("line_total" >= (0)::numeric)),
    CONSTRAINT "pos_sale_items_quantity_check" CHECK (("quantity" > 0)),
    CONSTRAINT "pos_sale_items_unit_price_check" CHECK (("unit_price" >= (0)::numeric))
);


ALTER TABLE "public"."pos_sale_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_sales" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "operator_id" "uuid" NOT NULL,
    "state" "text" DEFAULT 'draft'::"text" NOT NULL,
    "subtotal" numeric(12,2) DEFAULT 0 NOT NULL,
    "discount_total" numeric(12,2) DEFAULT 0 NOT NULL,
    "total" numeric(12,2) DEFAULT 0 NOT NULL,
    "currency" "text" DEFAULT 'PES'::"text" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "fiscal_document_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "correlation_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    CONSTRAINT "pos_sales_state_check" CHECK (("state" = ANY (ARRAY['draft'::"text", 'pricing'::"text", 'awaiting_payment'::"text", 'payment_confirmed'::"text", 'completed_fiscal_pending'::"text", 'completed'::"text", 'cancelled'::"text", 'refunded'::"text"])))
);


ALTER TABLE "public"."pos_sales" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_barcodes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "gtin" "text" NOT NULL,
    "barcode_type" "text" NOT NULL,
    "package_type" "text" DEFAULT 'unit'::"text" NOT NULL,
    "unit_factor" integer DEFAULT 1 NOT NULL,
    "is_primary" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "verified_at" timestamp with time zone,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "product_barcodes_barcode_type_check" CHECK (("barcode_type" = ANY (ARRAY['EAN-8'::"text", 'UPC-A'::"text", 'EAN-13'::"text", 'GTIN-14'::"text", 'INTERNAL'::"text"]))),
    CONSTRAINT "product_barcodes_gtin_format" CHECK (((("barcode_type" = 'EAN-8'::"text") AND ("gtin" ~ '^[0-9]{8}$'::"text") AND "public"."gtin_check_digit_valid"("gtin")) OR (("barcode_type" = 'UPC-A'::"text") AND ("gtin" ~ '^[0-9]{12}$'::"text") AND "public"."gtin_check_digit_valid"("gtin")) OR (("barcode_type" = 'EAN-13'::"text") AND ("gtin" ~ '^[0-9]{13}$'::"text") AND "public"."gtin_check_digit_valid"("gtin")) OR (("barcode_type" = 'GTIN-14'::"text") AND ("gtin" ~ '^[0-9]{14}$'::"text") AND "public"."gtin_check_digit_valid"("gtin")) OR (("barcode_type" = 'INTERNAL'::"text") AND ("gtin" ~ '^[A-Z0-9][A-Z0-9._-]{2,31}$'::"text")))),
    CONSTRAINT "product_barcodes_package_type_check" CHECK (("package_type" = ANY (ARRAY['unit'::"text", 'pack'::"text", 'case'::"text", 'internal'::"text"]))),
    CONSTRAINT "product_barcodes_source_check" CHECK (("source" = ANY (ARRAY['manual'::"text", 'taba_catalog'::"text", 'gs1_authorized'::"text", 'migration'::"text"]))),
    CONSTRAINT "product_barcodes_unit_factor_check" CHECK (("unit_factor" > 0))
);


ALTER TABLE "public"."product_barcodes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_combo_components" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "combo_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "quantity" integer NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "product_combo_components_quantity_check" CHECK ((("quantity" >= 1) AND ("quantity" <= 100)))
);


ALTER TABLE "public"."product_combo_components" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_combo_substitutions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "component_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL
);


ALTER TABLE "public"."product_combo_substitutions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_combos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "combo_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "tagline" "text",
    "description" "text",
    "category_id" "text",
    "terms" "text",
    "discount_percentage" numeric(5,2) DEFAULT 0 NOT NULL,
    "price_rounding" integer DEFAULT 100 NOT NULL,
    "approval_status" "text" DEFAULT 'PENDIENTE_APROBACION_COMERCIAL'::"text" NOT NULL,
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "approval_note" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "revision" bigint DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "product_combos_approval_evidence_check" CHECK ((("approval_status" <> 'APROBADO_COMERCIAL'::"text") OR ("approved_at" IS NOT NULL))),
    CONSTRAINT "product_combos_approval_status_check" CHECK (("approval_status" = ANY (ARRAY['PENDIENTE_APROBACION_COMERCIAL'::"text", 'APROBADO_COMERCIAL'::"text", 'SUSPENDIDO'::"text"]))),
    CONSTRAINT "product_combos_combo_id_format" CHECK (("combo_id" ~ '^[a-z0-9][a-z0-9-]{2,63}$'::"text")),
    CONSTRAINT "product_combos_discount_range" CHECK ((("discount_percentage" >= (0)::numeric) AND ("discount_percentage" <= (90)::numeric))),
    CONSTRAINT "product_combos_name_length" CHECK ((("char_length"("btrim"("name")) >= 2) AND ("char_length"("btrim"("name")) <= 120))),
    CONSTRAINT "product_combos_rounding_check" CHECK (("price_rounding" = ANY (ARRAY[1, 10, 100])))
);


ALTER TABLE "public"."product_combos" OWNER TO "postgres";


COMMENT ON TABLE "public"."product_combos" IS 'Definición autoritativa de combos. Declara componentes y descuento; nunca precios.';



COMMENT ON COLUMN "public"."product_combos"."discount_percentage" IS 'Descuento aprobado por el comercio. El precio promocional se deriva del catálogo vivo.';



CREATE TABLE IF NOT EXISTS "public"."products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "category" "text",
    "price" numeric(12,2) NOT NULL,
    "image_url" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "brand" "text",
    "subcategory" "text",
    "presentation" "text",
    "capacity" "text",
    "packaging_type" "text",
    "stock" integer,
    "available" boolean DEFAULT false NOT NULL,
    "is_alcoholic" boolean,
    "minimum_age" integer,
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "is_verified" boolean DEFAULT false NOT NULL,
    "verified_at" timestamp with time zone,
    "verified_by" "uuid",
    "chilled" boolean DEFAULT false NOT NULL,
    "units_per_pack" integer DEFAULT 1 NOT NULL,
    "external_id" "text",
    "sku" "text",
    "catalog_asset_id" "uuid",
    "image_sha256" "text",
    "image_thumbnail_url" "text",
    "image_thumbnail_sha256" "text",
    "source_image_sha256" "text",
    "variant" "text",
    "capacity_value" numeric,
    "capacity_unit" "text",
    "catalog_origin" "text" DEFAULT 'commercial'::"text" NOT NULL,
    "price_status" "text" DEFAULT 'confirmed'::"text" NOT NULL,
    "unit_cost" numeric(12,2),
    CONSTRAINT "products_alcohol_requires_age" CHECK ((("is_alcoholic" IS DISTINCT FROM true) OR (("minimum_age" IS NOT NULL) AND ("minimum_age" >= 18) AND ("minimum_age" <= 99)))),
    CONSTRAINT "products_available_requires_verification" CHECK (((NOT "available") OR ("is_verified" AND "is_active" AND ("stock" IS NOT NULL) AND ("stock" > 0) AND ("price_status" = 'confirmed'::"text") AND ("price" > (0)::numeric)))),
    CONSTRAINT "products_catalog_origin_valid" CHECK (("catalog_origin" = ANY (ARRAY['commercial'::"text", 'demo_fixture'::"text", 'test_only'::"text", 'staging_only'::"text"]))),
    CONSTRAINT "products_catalog_structured_capacity" CHECK (((("variant" IS NULL) AND ("capacity_value" IS NULL) AND ("capacity_unit" IS NULL)) OR (("variant" IS NOT NULL) AND ("btrim"("variant") <> ''::"text") AND ("capacity_value" IS NOT NULL) AND ("capacity_value" > (0)::numeric) AND ("capacity_unit" = ANY (ARRAY['ml'::"text", 'l'::"text", 'g'::"text", 'kg'::"text", 'unidad'::"text"]))))),
    CONSTRAINT "products_price_check" CHECK (("price" >= (0)::numeric)),
    CONSTRAINT "products_price_status_check" CHECK (("price_status" = ANY (ARRAY['confirmed'::"text", 'pending'::"text"]))),
    CONSTRAINT "products_stock_nonnegative" CHECK ((("stock" IS NULL) OR ("stock" >= 0))),
    CONSTRAINT "products_unit_cost_check" CHECK ((("unit_cost" IS NULL) OR ("unit_cost" >= (0)::numeric))),
    CONSTRAINT "products_units_per_pack_positive" CHECK (("units_per_pack" > 0)),
    CONSTRAINT "products_verified_alcohol_coherence" CHECK (((NOT "is_verified") OR (((("category" = ANY (ARRAY['Cervezas'::"text", 'Vinos y espumantes'::"text", 'Gins y vodkas'::"text", 'Whisky y destilados'::"text"])) AND ("is_alcoholic" IS TRUE)) OR (("category" = ANY (ARRAY['Gaseosas'::"text", 'Aguas'::"text", 'Jugos'::"text", 'Energéticas'::"text", 'Isotónicas'::"text", 'Picadas y deli'::"text", 'Hielo y extras'::"text"])) AND ("is_alcoholic" IS FALSE)) OR (("category" = 'Promos'::"text") AND ("is_alcoholic" IS NOT NULL))) AND ((("is_alcoholic" IS TRUE) AND ("minimum_age" IS NOT NULL) AND (("minimum_age" >= 18) AND ("minimum_age" <= 99))) OR (("is_alcoholic" IS FALSE) AND ("minimum_age" IS NULL)))))),
    CONSTRAINT "products_verified_canonical_beverage_category" CHECK (((NOT "is_verified") OR ("category" = ANY (ARRAY['Promos'::"text", 'Gaseosas'::"text", 'Aguas'::"text", 'Jugos'::"text", 'Energéticas'::"text", 'Isotónicas'::"text", 'Cervezas'::"text", 'Vinos y espumantes'::"text", 'Gins y vodkas'::"text", 'Whisky y destilados'::"text", 'Picadas y deli'::"text", 'Hielo y extras'::"text"])))),
    CONSTRAINT "products_verified_master_data" CHECK (((NOT "is_verified") OR (("catalog_origin" = ANY (ARRAY['demo_fixture'::"text", 'test_only'::"text", 'staging_only'::"text"])) AND ("btrim"("name") <> ''::"text") AND ("brand" IS NOT NULL) AND ("btrim"("brand") <> ''::"text") AND ("category" IS NOT NULL) AND ("btrim"("category") <> ''::"text") AND ("subcategory" IS NOT NULL) AND ("btrim"("subcategory") <> ''::"text") AND ("presentation" IS NOT NULL) AND ("btrim"("presentation") <> ''::"text") AND ("capacity" IS NOT NULL) AND ("btrim"("capacity") <> ''::"text") AND ("packaging_type" IS NOT NULL) AND ("btrim"("packaging_type") <> ''::"text") AND ("price" > (0)::numeric) AND ("stock" IS NOT NULL) AND ("is_alcoholic" IS NOT NULL) AND ("image_url" IS NOT NULL) AND ("btrim"("image_url") <> ''::"text")) OR (("catalog_origin" = 'commercial'::"text") AND ("btrim"("name") <> ''::"text") AND ("brand" IS NOT NULL) AND ("btrim"("brand") <> ''::"text") AND ("category" IS NOT NULL) AND ("btrim"("category") <> ''::"text") AND ("subcategory" IS NOT NULL) AND ("btrim"("subcategory") <> ''::"text") AND ("presentation" IS NOT NULL) AND ("btrim"("presentation") <> ''::"text") AND ("capacity" IS NOT NULL) AND ("btrim"("capacity") <> ''::"text") AND ("packaging_type" IS NOT NULL) AND ("btrim"("packaging_type") <> ''::"text") AND ("price" > (0)::numeric) AND ("stock" IS NOT NULL) AND ("is_alcoholic" IS NOT NULL) AND ("image_url" IS NOT NULL) AND ("btrim"("image_url") <> ''::"text") AND ("verified_at" IS NOT NULL) AND ("verified_by" IS NOT NULL)))),
    CONSTRAINT "products_verified_numeric_ranges" CHECK (((NOT "is_verified") OR (("price" IS NOT NULL) AND (("price")::"text" ~ '^[0-9]+([.][0-9]{1,2})?$'::"text") AND ("price" > (0)::numeric) AND ("price" <= 9999999999.99) AND ("stock" IS NOT NULL) AND (("stock" >= 0) AND ("stock" <= 2147483647)) AND ("units_per_pack" IS NOT NULL) AND (("units_per_pack" >= 1) AND ("units_per_pack" <= 2147483647)) AND ("sort_order" IS NOT NULL) AND (("sort_order" >= 0) AND ("sort_order" <= 2147483647)) AND ("capacity_value" IS NOT NULL) AND (("capacity_value")::"text" ~ '^[0-9]+([.][0-9]+)?$'::"text") AND ("capacity_value" > (0)::numeric)))),
    CONSTRAINT "products_verified_publication_authority" CHECK (((NOT "is_verified") OR (("catalog_origin" = ANY (ARRAY['demo_fixture'::"text", 'test_only'::"text", 'staging_only'::"text"])) AND ("catalog_asset_id" IS NOT NULL) AND ("image_url" IS NOT NULL) AND ("image_sha256" ~ '^[a-f0-9]{64}$'::"text") AND ("image_thumbnail_url" IS NOT NULL) AND ("image_thumbnail_sha256" ~ '^[a-f0-9]{64}$'::"text") AND ("source_image_sha256" ~ '^[a-f0-9]{64}$'::"text")) OR (("catalog_origin" = 'commercial'::"text") AND ("external_id" IS NOT NULL) AND ("btrim"("external_id") <> ''::"text") AND ("sku" IS NOT NULL) AND ("btrim"("sku") <> ''::"text") AND ("variant" IS NOT NULL) AND ("btrim"("variant") <> ''::"text") AND ("capacity_value" IS NOT NULL) AND ("capacity_value" > (0)::numeric) AND ("capacity_unit" = ANY (ARRAY['ml'::"text", 'l'::"text", 'g'::"text", 'kg'::"text", 'unidad'::"text"])) AND ("presentation" = "variant") AND ("capacity" = ((("capacity_value")::"text" || ' '::"text") || "capacity_unit")) AND ("catalog_asset_id" IS NOT NULL) AND ("image_url" IS NOT NULL) AND ("image_url" ~ '^assets/products/[a-z0-9_-]+[.]webp$'::"text") AND ("image_sha256" IS NOT NULL) AND ("image_sha256" ~ '^[a-f0-9]{64}$'::"text") AND ("image_thumbnail_url" IS NOT NULL) AND ("image_thumbnail_url" ~ '^assets/products/[a-z0-9_-]+[.]webp$'::"text") AND ("image_thumbnail_url" <> "image_url") AND ("image_thumbnail_sha256" IS NOT NULL) AND ("image_thumbnail_sha256" ~ '^[a-f0-9]{64}$'::"text") AND ("source_image_sha256" IS NOT NULL) AND ("source_image_sha256" ~ '^[a-f0-9]{64}$'::"text"))))
);

ALTER TABLE ONLY "public"."products" REPLICA IDENTITY FULL;


ALTER TABLE "public"."products" OWNER TO "postgres";


COMMENT ON TABLE "public"."products" IS 'Master beverage catalog. Rows remain unavailable until commercial data and product identity are verified.';



COMMENT ON COLUMN "public"."products"."available" IS 'Operational availability; can only be true for a verified, active product with positive stock.';



COMMENT ON COLUMN "public"."products"."is_verified" IS 'Human verification gate for brand, category, presentation, capacity, packaging, price, stock, alcohol flag and image.';



COMMENT ON COLUMN "public"."products"."catalog_origin" IS 'Origin boundary: commercial or staging-only QA fixture provenance.';



COMMENT ON COLUMN "public"."products"."price_status" IS 'Commercial price state. pending products may be published but are never reservable or payable.';



COMMENT ON CONSTRAINT "products_available_requires_verification" ON "public"."products" IS 'A purchasable product is verified, active, has known stock above zero, a confirmed price state and a price above zero.';



COMMENT ON CONSTRAINT "products_verified_alcohol_coherence" ON "public"."products" IS 'Verified alcohol metadata is category-consistent; alcohol requires an age from 18 to 99.';



COMMENT ON CONSTRAINT "products_verified_canonical_beverage_category" ON "public"."products" IS 'Verified products use one of the twelve canonical TABA beverage categories.';



COMMENT ON CONSTRAINT "products_verified_master_data" ON "public"."products" IS 'Commercial rows require human verification stamps; staging QA rows may use the operational flag without commercial rights approval.';



CREATE TABLE IF NOT EXISTS "public"."rider_delivery_issues" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "order_id" "uuid" NOT NULL,
    "rider_id" "uuid" NOT NULL,
    "issue_type" "text" NOT NULL,
    "request_id" "text" NOT NULL,
    "reported_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "rider_delivery_issues_issue_type_check" CHECK (("issue_type" = ANY (ARRAY['customer_unavailable'::"text", 'unsafe_location'::"text", 'vehicle_problem'::"text", 'wrong_address'::"text", 'business_issue'::"text", 'payment_issue'::"text", 'other'::"text"]))),
    CONSTRAINT "rider_delivery_issues_request_id_check" CHECK (("request_id" ~ '^[A-Za-z0-9_-]{8,128}$'::"text"))
);


ALTER TABLE "public"."rider_delivery_issues" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rider_delivery_operations" (
    "order_id" "uuid" NOT NULL,
    "rider_user_id" "uuid" NOT NULL,
    "operation" "text" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "request_fingerprint" "bytea" NOT NULL,
    "result" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "rider_delivery_operations_idempotency_key_check" CHECK (("idempotency_key" ~ '^[A-Za-z0-9_-]{8,128}$'::"text")),
    CONSTRAINT "rider_delivery_operations_operation_check" CHECK (("operation" = ANY (ARRAY['claim'::"text", 'picked_up'::"text", 'start_route'::"text", 'arrived'::"text", 'confirm_code'::"text", 'report_issue'::"text"])))
);


ALTER TABLE "public"."rider_delivery_operations" OWNER TO "postgres";


COMMENT ON TABLE "public"."rider_delivery_operations" IS 'Persistent idempotency receipts for Rider mutations. Results never contain a delivery code.';



CREATE SEQUENCE IF NOT EXISTS "public"."rider_location_receipt_sequence_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."rider_location_receipt_sequence_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rider_locations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "rider_id" "uuid",
    "lat" double precision NOT NULL,
    "lng" double precision NOT NULL,
    "accuracy" double precision,
    "heading" double precision,
    "speed" double precision,
    "source" "text" DEFAULT 'gps'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "rider_user_id" "uuid",
    "sequence" bigint NOT NULL,
    "order_revision" bigint NOT NULL,
    "recorded_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "captured_at" timestamp with time zone,
    "client_request_id" "text",
    "receipt_sequence" bigint DEFAULT "nextval"('"public"."rider_location_receipt_sequence_seq"'::"regclass") NOT NULL,
    CONSTRAINT "rider_locations_accuracy_check" CHECK ((("accuracy" IS NULL) OR ("accuracy" >= (0)::double precision))),
    CONSTRAINT "rider_locations_heading_check" CHECK ((("heading" IS NULL) OR (("heading" >= (0)::double precision) AND ("heading" < (360)::double precision)))),
    CONSTRAINT "rider_locations_lat_check" CHECK ((("lat" >= ('-90'::integer)::double precision) AND ("lat" <= (90)::double precision))),
    CONSTRAINT "rider_locations_lng_check" CHECK ((("lng" >= ('-180'::integer)::double precision) AND ("lng" <= (180)::double precision))),
    CONSTRAINT "rider_locations_order_revision_positive" CHECK (("order_revision" > 0)),
    CONSTRAINT "rider_locations_sequence_positive" CHECK (("sequence" > 0)),
    CONSTRAINT "rider_locations_source_check" CHECK (("source" = ANY (ARRAY['gps'::"text", 'simulation'::"text", 'manual'::"text"]))),
    CONSTRAINT "rider_locations_speed_check" CHECK ((("speed" IS NULL) OR ("speed" >= (0)::double precision)))
);


ALTER TABLE "public"."rider_locations" OWNER TO "postgres";


COMMENT ON TABLE "public"."rider_locations" IS 'Ubicaciones GPS reales asociadas a un pedido y rider; no almacena rutas ni ETA.';



COMMENT ON COLUMN "public"."rider_locations"."sequence" IS 'Orden total de muestras GPS; admite huecos pero nunca duplicados.';



COMMENT ON COLUMN "public"."rider_locations"."order_revision" IS 'Revision de orders validada al publicar la muestra; evita publicar sobre una vista vieja.';



COMMENT ON COLUMN "public"."rider_locations"."recorded_at" IS 'Marca de recepcion generada por PostgreSQL; el cliente no puede elegirla.';



COMMENT ON COLUMN "public"."rider_locations"."captured_at" IS 'Marca declarada por el dispositivo, solo para rechazar muestras futuras o atrasadas; no es la autoridad temporal.';



CREATE SEQUENCE IF NOT EXISTS "public"."rider_locations_sequence_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."rider_locations_sequence_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."rider_locations_sequence_seq" OWNED BY "public"."rider_locations"."sequence";



CREATE TABLE IF NOT EXISTS "public"."rider_profiles" (
    "business_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "full_name" "text" NOT NULL,
    "contact_phone" "text",
    "vehicle_kind" "text" DEFAULT 'motorcycle'::"text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "onboarded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "rider_profiles_contact_phone_check" CHECK ((("contact_phone" IS NULL) OR ("contact_phone" ~ '^[0-9+][0-9 +().-]{5,29}$'::"text"))),
    CONSTRAINT "rider_profiles_full_name_check" CHECK ((("length"("btrim"("full_name")) >= 2) AND ("length"("btrim"("full_name")) <= 120))),
    CONSTRAINT "rider_profiles_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'suspended'::"text"]))),
    CONSTRAINT "rider_profiles_vehicle_kind_check" CHECK (("vehicle_kind" = ANY (ARRAY['motorcycle'::"text", 'bicycle'::"text", 'car'::"text", 'walking'::"text"])))
);


ALTER TABLE "public"."rider_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."riders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "phone" "text",
    "whatsapp" "text",
    "status" "text" DEFAULT 'available'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "riders_status_check" CHECK (("status" = ANY (ARRAY['available'::"text", 'assigned'::"text", 'offline'::"text", 'paused'::"text"])))
);


ALTER TABLE "public"."riders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."scanned_product_audit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "draft_id" "uuid",
    "gtin" "text" NOT NULL,
    "action" "text" NOT NULL,
    "actor_id" "uuid" NOT NULL,
    "detail" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "scanned_product_audit_action_check" CHECK (("action" = ANY (ARRAY['completed'::"text", 'price_confirmed'::"text", 'published'::"text", 'unpublished'::"text"])))
);


ALTER TABLE "public"."scanned_product_audit" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."service_health_signals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "service" "text" NOT NULL,
    "severity" "text" NOT NULL,
    "signal_code" "text" NOT NULL,
    "status" "text" NOT NULL,
    "correlation_id" "uuid",
    "observed_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "details" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "service_health_signal_details_size" CHECK (("octet_length"(("details")::"text") <= 4096)),
    CONSTRAINT "service_health_signal_window" CHECK (("expires_at" > "observed_at")),
    CONSTRAINT "service_health_signals_service_check" CHECK (("service" = ANY (ARRAY['storefront'::"text", 'supabase'::"text", 'mercadopago'::"text", 'rider'::"text", 'arca'::"text", 'fiscal_artifact'::"text", 'windows'::"text", 'printing'::"text", 'backup'::"text"]))),
    CONSTRAINT "service_health_signals_severity_check" CHECK (("severity" = ANY (ARRAY['INFO'::"text", 'WARNING'::"text", 'ACTION_REQUIRED'::"text", 'CRITICAL'::"text"]))),
    CONSTRAINT "service_health_signals_signal_code_check" CHECK (("signal_code" ~ '^[A-Z0-9_]{3,80}$'::"text")),
    CONSTRAINT "service_health_signals_status_check" CHECK (("status" = ANY (ARRAY['healthy'::"text", 'degraded'::"text", 'unavailable'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."service_health_signals" OWNER TO "postgres";


COMMENT ON COLUMN "public"."service_health_signals"."details" IS 'Sanitized bounded metadata only; secrets and customer data are forbidden.';



CREATE TABLE IF NOT EXISTS "public"."staff_profiles" (
    "business_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "full_name" "text" NOT NULL,
    "contact_phone" "text",
    "job_title" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "onboarded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "staff_profiles_contact_phone_check" CHECK ((("contact_phone" IS NULL) OR ("contact_phone" ~ '^[0-9+][0-9 +().-]{5,29}$'::"text"))),
    CONSTRAINT "staff_profiles_full_name_check" CHECK ((("length"("btrim"("full_name")) >= 2) AND ("length"("btrim"("full_name")) <= 120))),
    CONSTRAINT "staff_profiles_job_title_check" CHECK ((("job_title" IS NULL) OR (("length"("btrim"("job_title")) >= 2) AND ("length"("btrim"("job_title")) <= 60)))),
    CONSTRAINT "staff_profiles_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'suspended'::"text"])))
);


ALTER TABLE "public"."staff_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stock_count_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "theoretical_stock" integer NOT NULL,
    "physical_stock" integer NOT NULL,
    "difference" integer GENERATED ALWAYS AS (("physical_stock" - "theoretical_stock")) STORED,
    CONSTRAINT "stock_count_items_physical_stock_check" CHECK (("physical_stock" >= 0))
);


ALTER TABLE "public"."stock_count_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stock_count_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'in_progress'::"text" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "confirmed_at" timestamp with time zone,
    CONSTRAINT "stock_count_sessions_status_check" CHECK (("status" = ANY (ARRAY['in_progress'::"text", 'review'::"text", 'confirmed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."stock_count_sessions" OWNER TO "postgres";


ALTER TABLE ONLY "public"."order_events" ALTER COLUMN "sequence" SET DEFAULT "nextval"('"public"."order_events_sequence_seq"'::"regclass");



ALTER TABLE ONLY "public"."rider_locations" ALTER COLUMN "sequence" SET DEFAULT "nextval"('"public"."rider_locations_sequence_seq"'::"regclass");



ALTER TABLE ONLY "private"."rider_map_business_locations"
    ADD CONSTRAINT "rider_map_business_locations_pkey" PRIMARY KEY ("business_id");



ALTER TABLE ONLY "private"."rider_map_order_location_snapshots"
    ADD CONSTRAINT "rider_map_order_location_snapshots_pkey" PRIMARY KEY ("order_id");



ALTER TABLE ONLY "public"."business_command_receipts"
    ADD CONSTRAINT "business_command_receipts_business_id_idempotency_key_key" UNIQUE ("business_id", "idempotency_key");



ALTER TABLE ONLY "public"."business_command_receipts"
    ADD CONSTRAINT "business_command_receipts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."business_members"
    ADD CONSTRAINT "business_members_business_id_user_id_key" UNIQUE ("business_id", "user_id");



ALTER TABLE ONLY "public"."business_members"
    ADD CONSTRAINT "business_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."business_payment_settings"
    ADD CONSTRAINT "business_payment_settings_business_id_provider_key" UNIQUE ("business_id", "provider");



ALTER TABLE ONLY "public"."business_payment_settings"
    ADD CONSTRAINT "business_payment_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."businesses"
    ADD CONSTRAINT "businesses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."catalog_assets"
    ADD CONSTRAINT "catalog_assets_business_external_id_key" UNIQUE ("business_id", "external_id");



ALTER TABLE ONLY "public"."catalog_assets"
    ADD CONSTRAINT "catalog_assets_business_sku_key" UNIQUE ("business_id", "sku");



ALTER TABLE ONLY "public"."catalog_assets"
    ADD CONSTRAINT "catalog_assets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."catalog_product_drafts"
    ADD CONSTRAINT "catalog_product_drafts_business_id_idempotency_key_key" UNIQUE ("business_id", "idempotency_key");



ALTER TABLE ONLY "public"."catalog_product_drafts"
    ADD CONSTRAINT "catalog_product_drafts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."checkout_session_combos"
    ADD CONSTRAINT "checkout_session_combos_checkout_session_id_combo_id_key" UNIQUE ("checkout_session_id", "combo_id");



ALTER TABLE ONLY "public"."checkout_session_combos"
    ADD CONSTRAINT "checkout_session_combos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."checkout_session_items"
    ADD CONSTRAINT "checkout_session_items_checkout_session_id_product_id_key" UNIQUE ("checkout_session_id", "product_id");



ALTER TABLE ONLY "public"."checkout_session_items"
    ADD CONSTRAINT "checkout_session_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."checkout_sessions"
    ADD CONSTRAINT "checkout_sessions_business_id_customer_id_client_request_id_key" UNIQUE ("business_id", "customer_id", "client_request_id");



ALTER TABLE ONLY "public"."checkout_sessions"
    ADD CONSTRAINT "checkout_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."commercial_contract_remediation"
    ADD CONSTRAINT "commercial_contract_remediation_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."customer_addresses"
    ADD CONSTRAINT "customer_addresses_active_street_number_required" CHECK ((("deleted_at" IS NOT NULL) OR (("char_length"("btrim"(COALESCE("street_number", ''::"text"))) >= 1) AND ("char_length"("btrim"(COALESCE("street_number", ''::"text"))) <= 24)))) NOT VALID;



ALTER TABLE ONLY "public"."customer_addresses"
    ADD CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."customers"
    ADD CONSTRAINT "customers_name_length" CHECK (((("char_length"("btrim"("name")) >= 2) AND ("char_length"("btrim"("name")) <= 80)) AND ("name" ~ '[[:alpha:]]'::"text"))) NOT VALID;



ALTER TABLE "public"."customers"
    ADD CONSTRAINT "customers_phone_length" CHECK ((("phone" ~ '^[0-9]{10,13}$'::"text") AND ("phone" !~ '^([0-9])\1+$'::"text"))) NOT VALID;



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_reconciliation_events"
    ADD CONSTRAINT "daily_reconciliation_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_reconciliations"
    ADD CONSTRAINT "daily_reconciliations_business_id_business_date_key" UNIQUE ("business_id", "business_date");



ALTER TABLE ONLY "public"."daily_reconciliations"
    ADD CONSTRAINT "daily_reconciliations_business_id_close_idempotency_key_key" UNIQUE ("business_id", "close_idempotency_key");



ALTER TABLE ONLY "public"."daily_reconciliations"
    ADD CONSTRAINT "daily_reconciliations_business_id_prepare_idempotency_key_key" UNIQUE ("business_id", "prepare_idempotency_key");



ALTER TABLE ONLY "public"."daily_reconciliations"
    ADD CONSTRAINT "daily_reconciliations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."delivery_confirmation_attempts"
    ADD CONSTRAINT "delivery_confirmation_attempts_order_id_rider_id_request_id_key" UNIQUE ("order_id", "rider_id", "request_id");



ALTER TABLE ONLY "public"."delivery_confirmation_attempts"
    ADD CONSTRAINT "delivery_confirmation_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."delivery_outbox"
    ADD CONSTRAINT "delivery_outbox_order_id_event_type_event_key_key" UNIQUE ("order_id", "event_type", "event_key");



ALTER TABLE ONLY "public"."delivery_outbox"
    ADD CONSTRAINT "delivery_outbox_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fiscal_accounting_policies"
    ADD CONSTRAINT "fiscal_accounting_policies_business_id_environment_policy_v_key" UNIQUE ("business_id", "environment", "policy_version", "invoice_type", "recipient_condition", "concept");



ALTER TABLE ONLY "public"."fiscal_accounting_policies"
    ADD CONSTRAINT "fiscal_accounting_policies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fiscal_artifact_outbox"
    ADD CONSTRAINT "fiscal_artifact_outbox_fiscal_document_id_key" UNIQUE ("fiscal_document_id");



ALTER TABLE ONLY "public"."fiscal_artifact_outbox"
    ADD CONSTRAINT "fiscal_artifact_outbox_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fiscal_credit_allocations"
    ADD CONSTRAINT "fiscal_credit_allocations_credit_document_id_original_item__key" UNIQUE ("credit_document_id", "original_item_id");



ALTER TABLE ONLY "public"."fiscal_credit_allocations"
    ADD CONSTRAINT "fiscal_credit_allocations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fiscal_document_artifacts"
    ADD CONSTRAINT "fiscal_document_artifacts_generation_token_key" UNIQUE ("generation_token");



ALTER TABLE ONLY "public"."fiscal_document_artifacts"
    ADD CONSTRAINT "fiscal_document_artifacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fiscal_document_artifacts"
    ADD CONSTRAINT "fiscal_document_artifacts_storage_provider_storage_path_key" UNIQUE ("storage_provider", "storage_path");



ALTER TABLE ONLY "public"."fiscal_document_items"
    ADD CONSTRAINT "fiscal_document_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fiscal_documents"
    ADD CONSTRAINT "fiscal_documents_business_id_source_type_source_id_document_key" UNIQUE ("business_id", "source_type", "source_id", "document_intent");



ALTER TABLE ONLY "public"."fiscal_documents"
    ADD CONSTRAINT "fiscal_documents_environment_cuit_point_of_sale_document_ty_key" UNIQUE ("environment", "cuit", "point_of_sale", "document_type", "document_number");



ALTER TABLE ONLY "public"."fiscal_documents"
    ADD CONSTRAINT "fiscal_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fiscal_events"
    ADD CONSTRAINT "fiscal_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fiscal_outbox"
    ADD CONSTRAINT "fiscal_outbox_fiscal_document_id_key" UNIQUE ("fiscal_document_id");



ALTER TABLE ONLY "public"."fiscal_outbox"
    ADD CONSTRAINT "fiscal_outbox_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fiscal_parameter_snapshots"
    ADD CONSTRAINT "fiscal_parameter_snapshots_environment_parameter_type_versi_key" UNIQUE ("environment", "parameter_type", "version");



ALTER TABLE ONLY "public"."fiscal_parameter_snapshots"
    ADD CONSTRAINT "fiscal_parameter_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fiscal_print_jobs"
    ADD CONSTRAINT "fiscal_print_jobs_business_id_idempotency_key_key" UNIQUE ("business_id", "idempotency_key");



ALTER TABLE ONLY "public"."fiscal_print_jobs"
    ADD CONSTRAINT "fiscal_print_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fiscal_profile_events"
    ADD CONSTRAINT "fiscal_profile_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fiscal_profiles"
    ADD CONSTRAINT "fiscal_profiles_pkey" PRIMARY KEY ("business_id");



ALTER TABLE ONLY "public"."fiscal_request_attempts"
    ADD CONSTRAINT "fiscal_request_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."identity_audit_events"
    ADD CONSTRAINT "identity_audit_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."identity_invitations"
    ADD CONSTRAINT "identity_invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."identity_invitations"
    ADD CONSTRAINT "identity_invitations_token_hash_key" UNIQUE ("token_hash");



ALTER TABLE ONLY "public"."identity_permissions"
    ADD CONSTRAINT "identity_permissions_pkey" PRIMARY KEY ("permission");



ALTER TABLE ONLY "public"."identity_role_permissions"
    ADD CONSTRAINT "identity_role_permissions_pkey" PRIMARY KEY ("role", "permission");



ALTER TABLE ONLY "public"."identity_sessions"
    ADD CONSTRAINT "identity_sessions_pkey" PRIMARY KEY ("session_id");



ALTER TABLE ONLY "public"."identity_user_security"
    ADD CONSTRAINT "identity_user_security_pkey" PRIMARY KEY ("business_id", "user_id");



ALTER TABLE ONLY "public"."inventory_movements"
    ADD CONSTRAINT "inventory_movements_business_id_idempotency_key_key" UNIQUE ("business_id", "idempotency_key");



ALTER TABLE ONLY "public"."inventory_movements"
    ADD CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inventory_receipt_items"
    ADD CONSTRAINT "inventory_receipt_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inventory_receipt_items"
    ADD CONSTRAINT "inventory_receipt_items_receipt_id_product_id_barcode_id_key" UNIQUE ("receipt_id", "product_id", "barcode_id");



ALTER TABLE ONLY "public"."inventory_receipts"
    ADD CONSTRAINT "inventory_receipts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inventory_reservations"
    ADD CONSTRAINT "inventory_reservations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inventory_reservations"
    ADD CONSTRAINT "inventory_reservations_session_product_generation_key" UNIQUE ("checkout_session_id", "product_id", "reservation_generation");



ALTER TABLE ONLY "public"."notification_outbox"
    ADD CONSTRAINT "notification_outbox_business_id_deduplication_key_key" UNIQUE ("business_id", "deduplication_key");



ALTER TABLE ONLY "public"."notification_outbox"
    ADD CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."operational_alert_events"
    ADD CONSTRAINT "operational_alert_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."operational_alerts"
    ADD CONSTRAINT "operational_alerts_business_id_fingerprint_key" UNIQUE ("business_id", "fingerprint");



ALTER TABLE ONLY "public"."operational_alerts"
    ADD CONSTRAINT "operational_alerts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."operational_sweep_runs"
    ADD CONSTRAINT "operational_sweep_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_abuse_events"
    ADD CONSTRAINT "order_abuse_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_combos"
    ADD CONSTRAINT "order_combos_order_id_combo_id_key" UNIQUE ("order_id", "combo_id");



ALTER TABLE ONLY "public"."order_combos"
    ADD CONSTRAINT "order_combos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_delivery_handoffs"
    ADD CONSTRAINT "order_delivery_handoffs_pkey" PRIMARY KEY ("order_id");



ALTER TABLE ONLY "public"."order_events"
    ADD CONSTRAINT "order_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_packing_scans"
    ADD CONSTRAINT "order_packing_scans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_packing_scans"
    ADD CONSTRAINT "order_packing_scans_session_id_scan_key_key" UNIQUE ("session_id", "scan_key");



ALTER TABLE ONLY "public"."order_packing_sessions"
    ADD CONSTRAINT "order_packing_sessions_business_id_idempotency_key_key" UNIQUE ("business_id", "idempotency_key");



ALTER TABLE ONLY "public"."order_packing_sessions"
    ADD CONSTRAINT "order_packing_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_public_tokens"
    ADD CONSTRAINT "order_public_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_public_tokens"
    ADD CONSTRAINT "order_public_tokens_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_code_key" UNIQUE ("code");



ALTER TABLE "public"."orders"
    ADD CONSTRAINT "orders_delivery_address_label_length" CHECK ((("delivery_address_label" IS NULL) OR (("char_length"("btrim"("delivery_address_label")) >= 1) AND ("char_length"("btrim"("delivery_address_label")) <= 60)))) NOT VALID;



ALTER TABLE "public"."orders"
    ADD CONSTRAINT "orders_delivery_location_confirmation_complete" CHECK ((("delivery_location_confirmed_at" IS NULL) OR (("delivery_location_source" IS NOT NULL) AND ("delivery_latitude" IS NOT NULL) AND ("delivery_longitude" IS NOT NULL)))) NOT VALID;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_attempts"
    ADD CONSTRAINT "payment_attempts_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "public"."payment_attempts"
    ADD CONSTRAINT "payment_attempts_payment_intent_id_attempt_number_attempt_t_key" UNIQUE ("payment_intent_id", "attempt_number", "attempt_type");



ALTER TABLE ONLY "public"."payment_attempts"
    ADD CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_cancellations"
    ADD CONSTRAINT "payment_cancellations_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "public"."payment_cancellations"
    ADD CONSTRAINT "payment_cancellations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_disputes"
    ADD CONSTRAINT "payment_disputes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_disputes"
    ADD CONSTRAINT "payment_disputes_provider_dispute_id_dispute_type_key" UNIQUE ("provider_dispute_id", "dispute_type");



ALTER TABLE ONLY "public"."payment_events"
    ADD CONSTRAINT "payment_events_payment_intent_id_webhook_receipt_id_event_t_key" UNIQUE ("payment_intent_id", "webhook_receipt_id", "event_type");



ALTER TABLE ONLY "public"."payment_events"
    ADD CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_intents"
    ADD CONSTRAINT "payment_intents_checkout_session_id_key" UNIQUE ("checkout_session_id");



ALTER TABLE ONLY "public"."payment_intents"
    ADD CONSTRAINT "payment_intents_external_reference_key" UNIQUE ("external_reference");



ALTER TABLE ONLY "public"."payment_intents"
    ADD CONSTRAINT "payment_intents_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "public"."payment_intents"
    ADD CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_outbox"
    ADD CONSTRAINT "payment_outbox_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_rate_limit_buckets"
    ADD CONSTRAINT "payment_rate_limit_buckets_pkey" PRIMARY KEY ("scope", "subject_hash", "bucket_started_at");



ALTER TABLE ONLY "public"."payment_refunds"
    ADD CONSTRAINT "payment_refunds_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "public"."payment_refunds"
    ADD CONSTRAINT "payment_refunds_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_webhook_receipts"
    ADD CONSTRAINT "payment_webhook_receipts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_webhook_receipts"
    ADD CONSTRAINT "payment_webhook_receipts_provider_environment_webhook_event_key" UNIQUE ("provider", "environment", "webhook_event_id", "event_type", "resource_id");



ALTER TABLE ONLY "public"."pos_payments"
    ADD CONSTRAINT "pos_payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_sale_items"
    ADD CONSTRAINT "pos_sale_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_sales"
    ADD CONSTRAINT "pos_sales_business_id_idempotency_key_key" UNIQUE ("business_id", "idempotency_key");



ALTER TABLE ONLY "public"."pos_sales"
    ADD CONSTRAINT "pos_sales_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_barcodes"
    ADD CONSTRAINT "product_barcodes_business_id_gtin_key" UNIQUE ("business_id", "gtin");



ALTER TABLE ONLY "public"."product_barcodes"
    ADD CONSTRAINT "product_barcodes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_combo_components"
    ADD CONSTRAINT "product_combo_components_combo_id_product_id_key" UNIQUE ("combo_id", "product_id");



ALTER TABLE ONLY "public"."product_combo_components"
    ADD CONSTRAINT "product_combo_components_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_combo_substitutions"
    ADD CONSTRAINT "product_combo_substitutions_component_id_product_id_key" UNIQUE ("component_id", "product_id");



ALTER TABLE ONLY "public"."product_combo_substitutions"
    ADD CONSTRAINT "product_combo_substitutions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_combos"
    ADD CONSTRAINT "product_combos_business_id_combo_id_key" UNIQUE ("business_id", "combo_id");



ALTER TABLE ONLY "public"."product_combos"
    ADD CONSTRAINT "product_combos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rider_delivery_issues"
    ADD CONSTRAINT "rider_delivery_issues_order_id_rider_id_request_id_key" UNIQUE ("order_id", "rider_id", "request_id");



ALTER TABLE ONLY "public"."rider_delivery_issues"
    ADD CONSTRAINT "rider_delivery_issues_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rider_delivery_operations"
    ADD CONSTRAINT "rider_delivery_operations_pkey" PRIMARY KEY ("order_id", "rider_user_id", "operation", "idempotency_key");



ALTER TABLE ONLY "public"."rider_locations"
    ADD CONSTRAINT "rider_locations_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."rider_locations"
    ADD CONSTRAINT "rider_locations_source_operational_check" CHECK (("source" = 'gps'::"text")) NOT VALID;



ALTER TABLE ONLY "public"."rider_profiles"
    ADD CONSTRAINT "rider_profiles_pkey" PRIMARY KEY ("business_id", "user_id");



ALTER TABLE ONLY "public"."riders"
    ADD CONSTRAINT "riders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scanned_product_audit"
    ADD CONSTRAINT "scanned_product_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_health_signals"
    ADD CONSTRAINT "service_health_signals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staff_profiles"
    ADD CONSTRAINT "staff_profiles_pkey" PRIMARY KEY ("business_id", "user_id");



ALTER TABLE ONLY "public"."stock_count_items"
    ADD CONSTRAINT "stock_count_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stock_count_items"
    ADD CONSTRAINT "stock_count_items_session_id_product_id_key" UNIQUE ("session_id", "product_id");



ALTER TABLE ONLY "public"."stock_count_sessions"
    ADD CONSTRAINT "stock_count_sessions_pkey" PRIMARY KEY ("id");



CREATE INDEX "business_command_receipts_order_created_idx" ON "public"."business_command_receipts" USING "btree" ("order_id", "created_at" DESC);



CREATE INDEX "business_members_user_idx" ON "public"."business_members" USING "btree" ("user_id");



CREATE INDEX "business_payment_settings_enabled_idx" ON "public"."business_payment_settings" USING "btree" ("business_id", "enabled") WHERE "enabled";



CREATE UNIQUE INDEX "businesses_slug_key" ON "public"."businesses" USING "btree" ("slug");



CREATE INDEX "businesses_status_idx" ON "public"."businesses" USING "btree" ("status");



CREATE UNIQUE INDEX "catalog_product_drafts_pending_gtin_key" ON "public"."catalog_product_drafts" USING "btree" ("business_id", "scanned_gtin") WHERE ("status" = 'pending_review'::"text");



CREATE INDEX "checkout_session_combos_session_idx" ON "public"."checkout_session_combos" USING "btree" ("checkout_session_id", "combo_id");



CREATE INDEX "checkout_session_items_session_idx" ON "public"."checkout_session_items" USING "btree" ("checkout_session_id", "created_at", "id");



CREATE UNIQUE INDEX "checkout_sessions_correlation_key" ON "public"."checkout_sessions" USING "btree" ("correlation_id");



CREATE INDEX "checkout_sessions_customer_created_idx" ON "public"."checkout_sessions" USING "btree" ("customer_id", "created_at" DESC);



CREATE INDEX "checkout_sessions_expiry_idx" ON "public"."checkout_sessions" USING "btree" ("expires_at") WHERE ("status" = ANY (ARRAY['created'::"text", 'validating'::"text", 'ready_for_payment'::"text", 'redirected'::"text", 'payment_pending'::"text"]));



CREATE INDEX "customer_addresses_confirmed_idx" ON "public"."customer_addresses" USING "btree" ("customer_id") WHERE (("deleted_at" IS NULL) AND ("location_confirmed_at" IS NOT NULL));



CREATE INDEX "customer_addresses_customer_active_idx" ON "public"."customer_addresses" USING "btree" ("customer_id", "updated_at" DESC) WHERE ("deleted_at" IS NULL);



CREATE INDEX "customer_addresses_normalized_idx" ON "public"."customer_addresses" USING "btree" ("customer_id", "normalized_address") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "customer_addresses_one_default_idx" ON "public"."customer_addresses" USING "btree" ("customer_id") WHERE ("is_default" AND ("deleted_at" IS NULL));



CREATE INDEX "customers_last_order_idx" ON "public"."customers" USING "btree" ("last_order_at" DESC NULLS LAST);



CREATE INDEX "daily_reconciliation_events_run_idx" ON "public"."daily_reconciliation_events" USING "btree" ("reconciliation_id", "created_at" DESC);



CREATE INDEX "daily_reconciliations_business_date_idx" ON "public"."daily_reconciliations" USING "btree" ("business_id", "business_date" DESC);



CREATE INDEX "delivery_confirmation_attempts_order_attempted_idx" ON "public"."delivery_confirmation_attempts" USING "btree" ("order_id", "attempted_at" DESC);



CREATE INDEX "fiscal_accounting_policies_lookup_idx" ON "public"."fiscal_accounting_policies" USING "btree" ("business_id", "environment", "issuer_condition", "recipient_condition", "concept", "invoice_type", "valid_from" DESC) WHERE ("enabled" AND ("accountant_review_status" = 'approved'::"text"));



CREATE INDEX "fiscal_artifact_outbox_claim_idx" ON "public"."fiscal_artifact_outbox" USING "btree" ("state", "next_attempt_at") WHERE ("state" = ANY (ARRAY['pending'::"text", 'retry_wait'::"text", 'leased'::"text"]));



CREATE INDEX "fiscal_credit_allocations_original_idx" ON "public"."fiscal_credit_allocations" USING "btree" ("original_document_id", "original_item_id", "state");



CREATE INDEX "fiscal_document_artifacts_business_document_idx" ON "public"."fiscal_document_artifacts" USING "btree" ("business_id", "fiscal_document_id", "generated_at" DESC);



CREATE UNIQUE INDEX "fiscal_document_artifacts_one_current_idx" ON "public"."fiscal_document_artifacts" USING "btree" ("fiscal_document_id", "artifact_type") WHERE "is_current";



CREATE UNIQUE INDEX "fiscal_documents_business_idempotency_idx" ON "public"."fiscal_documents" USING "btree" ("business_id", "idempotency_key");



CREATE INDEX "fiscal_documents_correlation_idx" ON "public"."fiscal_documents" USING "btree" ("correlation_id");



CREATE UNIQUE INDEX "fiscal_documents_one_invoice_per_source_idx" ON "public"."fiscal_documents" USING "btree" ("business_id", "source_type", "source_id", "document_intent") WHERE ("document_intent" = 'invoice'::"text");



CREATE INDEX "fiscal_outbox_claim_idx" ON "public"."fiscal_outbox" USING "btree" ("state", "next_attempt_at") WHERE ("state" = ANY (ARRAY['pending'::"text", 'retry_wait'::"text", 'leased'::"text"]));



CREATE INDEX "fiscal_print_jobs_correlation_idx" ON "public"."fiscal_print_jobs" USING "btree" ("correlation_id");



CREATE INDEX "fiscal_print_jobs_document_idx" ON "public"."fiscal_print_jobs" USING "btree" ("business_id", "fiscal_document_id", "requested_at" DESC);



CREATE INDEX "fiscal_profile_events_business_idx" ON "public"."fiscal_profile_events" USING "btree" ("business_id", "created_at" DESC);



CREATE INDEX "identity_audit_events_business_time_idx" ON "public"."identity_audit_events" USING "btree" ("business_id", "occurred_at" DESC);



CREATE INDEX "identity_audit_events_subject_time_idx" ON "public"."identity_audit_events" USING "btree" ("subject_user_id", "occurred_at" DESC);



CREATE INDEX "identity_audit_events_type_time_idx" ON "public"."identity_audit_events" USING "btree" ("event_type", "occurred_at" DESC);



CREATE INDEX "identity_invitations_business_idx" ON "public"."identity_invitations" USING "btree" ("business_id", "created_at" DESC);



CREATE UNIQUE INDEX "identity_invitations_one_live_per_email" ON "public"."identity_invitations" USING "btree" ("business_id", "invited_email") WHERE (("accepted_at" IS NULL) AND ("revoked_at" IS NULL));



CREATE INDEX "identity_sessions_business_active_idx" ON "public"."identity_sessions" USING "btree" ("business_id", "revoked_at", "last_seen_at" DESC);



CREATE INDEX "identity_sessions_device_idx" ON "public"."identity_sessions" USING "btree" ("business_id", "device_key_hash") WHERE ("device_key_hash" IS NOT NULL);



CREATE INDEX "identity_sessions_user_idx" ON "public"."identity_sessions" USING "btree" ("user_id", "last_seen_at" DESC);



CREATE INDEX "identity_user_security_user_idx" ON "public"."identity_user_security" USING "btree" ("user_id");



CREATE INDEX "inventory_movements_product_created_idx" ON "public"."inventory_movements" USING "btree" ("product_id", "created_at" DESC);



CREATE INDEX "inventory_reservations_active_expiry_idx" ON "public"."inventory_reservations" USING "btree" ("expires_at", "checkout_session_id") WHERE ("status" = 'active'::"text");



CREATE INDEX "operational_alert_events_alert_idx" ON "public"."operational_alert_events" USING "btree" ("alert_id", "created_at" DESC);



CREATE INDEX "operational_alerts_open_idx" ON "public"."operational_alerts" USING "btree" ("business_id", "severity", "last_seen_at" DESC) WHERE ("status" <> 'resolved'::"text");



CREATE INDEX "operational_sweep_runs_recent_idx" ON "public"."operational_sweep_runs" USING "btree" ("scope", "started_at" DESC);



CREATE INDEX "order_combos_order_idx" ON "public"."order_combos" USING "btree" ("order_id", "combo_id");



CREATE INDEX "order_events_order_created_idx" ON "public"."order_events" USING "btree" ("order_id", "created_at" DESC);



CREATE INDEX "order_events_order_sequence_idx" ON "public"."order_events" USING "btree" ("order_id", "sequence" DESC);



CREATE UNIQUE INDEX "order_events_sequence_key" ON "public"."order_events" USING "btree" ("sequence");



CREATE INDEX "order_items_order_idx" ON "public"."order_items" USING "btree" ("order_id");



CREATE UNIQUE INDEX "order_packing_one_open_session" ON "public"."order_packing_sessions" USING "btree" ("order_id") WHERE ("status" = ANY (ARRAY['not_started'::"text", 'in_progress'::"text", 'complete'::"text", 'exception_required'::"text"]));



CREATE INDEX "order_public_tokens_order_idx" ON "public"."order_public_tokens" USING "btree" ("order_id");



CREATE UNIQUE INDEX "order_public_tokens_token_hash_key" ON "public"."order_public_tokens" USING "btree" ("token_hash");



CREATE UNIQUE INDEX "orders_business_client_request_key" ON "public"."orders" USING "btree" ("business_id", "client_request_id");



CREATE INDEX "orders_business_created_idx" ON "public"."orders" USING "btree" ("business_id", "created_at" DESC);



CREATE INDEX "orders_business_origin_status_idx" ON "public"."orders" USING "btree" ("business_id", "origin", "status");



CREATE INDEX "orders_business_public_code_idx" ON "public"."orders" USING "btree" ("business_id", "public_code");



CREATE UNIQUE INDEX "orders_business_public_code_key" ON "public"."orders" USING "btree" ("business_id", "public_code");



CREATE INDEX "orders_business_status_idx" ON "public"."orders" USING "btree" ("business_id", "status");



CREATE INDEX "orders_correlation_idx" ON "public"."orders" USING "btree" ("correlation_id");



CREATE INDEX "orders_customer_address_idx" ON "public"."orders" USING "btree" ("customer_address_id") WHERE ("customer_address_id" IS NOT NULL);



CREATE INDEX "orders_customer_created_idx" ON "public"."orders" USING "btree" ("customer_user_id", "created_at" DESC) WHERE ("customer_user_id" IS NOT NULL);



CREATE INDEX "packing_sessions_correlation_idx" ON "public"."order_packing_sessions" USING "btree" ("correlation_id");



CREATE INDEX "payment_attempts_intent_idx" ON "public"."payment_attempts" USING "btree" ("payment_intent_id", "created_at" DESC);



CREATE UNIQUE INDEX "payment_attempts_preference_key" ON "public"."payment_attempts" USING "btree" ("preference_id") WHERE ("preference_id" IS NOT NULL);



CREATE INDEX "payment_cancellations_intent_idx" ON "public"."payment_cancellations" USING "btree" ("payment_intent_id", "requested_at" DESC);



CREATE INDEX "payment_disputes_intent_idx" ON "public"."payment_disputes" USING "btree" ("payment_intent_id", "created_at" DESC);



CREATE INDEX "payment_events_intent_sequence_idx" ON "public"."payment_events" USING "btree" ("payment_intent_id", "sequence" DESC);



CREATE INDEX "payment_intents_business_created_idx" ON "public"."payment_intents" USING "btree" ("business_id", "created_at" DESC);



CREATE INDEX "payment_intents_correlation_idx" ON "public"."payment_intents" USING "btree" ("correlation_id");



CREATE UNIQUE INDEX "payment_intents_provider_payment_key" ON "public"."payment_intents" USING "btree" ("provider", "environment", "provider_payment_id") WHERE ("provider_payment_id" IS NOT NULL);



CREATE INDEX "payment_intents_reconciliation_idx" ON "public"."payment_intents" USING "btree" ("environment", "internal_status", "updated_at") WHERE ("internal_status" = ANY (ARRAY['pending'::"text", 'in_process'::"text", 'approved_order_pending'::"text", 'ambiguous'::"text"]));



CREATE INDEX "payment_outbox_claim_idx" ON "public"."payment_outbox" USING "btree" ("next_attempt_at", "created_at") WHERE ("status" = ANY (ARRAY['pending'::"text", 'retry_wait'::"text", 'claimed'::"text", 'processing'::"text"]));



CREATE UNIQUE INDEX "payment_outbox_reconciliation_active_key" ON "public"."payment_outbox" USING "btree" ("payment_intent_id", "topic") WHERE (("topic" = 'payment_reconcile'::"text") AND ("status" = ANY (ARRAY['pending'::"text", 'claimed'::"text", 'processing'::"text", 'retry_wait'::"text"])));



CREATE UNIQUE INDEX "payment_outbox_webhook_receipt_key" ON "public"."payment_outbox" USING "btree" ("webhook_receipt_id") WHERE ("webhook_receipt_id" IS NOT NULL);



CREATE INDEX "payment_refunds_intent_idx" ON "public"."payment_refunds" USING "btree" ("payment_intent_id", "requested_at" DESC);



CREATE UNIQUE INDEX "payment_refunds_provider_key" ON "public"."payment_refunds" USING "btree" ("provider_refund_id") WHERE ("provider_refund_id" IS NOT NULL);



CREATE INDEX "payment_webhook_receipts_processing_idx" ON "public"."payment_webhook_receipts" USING "btree" ("processing_status", "received_at");



CREATE INDEX "pos_sales_correlation_idx" ON "public"."pos_sales" USING "btree" ("correlation_id");



CREATE UNIQUE INDEX "product_barcodes_one_primary_per_product" ON "public"."product_barcodes" USING "btree" ("product_id") WHERE ("is_primary" AND "is_active");



CREATE INDEX "product_barcodes_product_active_idx" ON "public"."product_barcodes" USING "btree" ("product_id") WHERE "is_active";



CREATE INDEX "product_combo_components_combo_idx" ON "public"."product_combo_components" USING "btree" ("combo_id", "sort_order", "product_id");



CREATE INDEX "product_combos_business_active_idx" ON "public"."product_combos" USING "btree" ("business_id", "sort_order", "combo_id") WHERE "is_active";



CREATE INDEX "products_business_active_idx" ON "public"."products" USING "btree" ("business_id", "is_active");



CREATE UNIQUE INDEX "products_business_external_id_key" ON "public"."products" USING "btree" ("business_id", "external_id");



CREATE UNIQUE INDEX "products_business_sku_key" ON "public"."products" USING "btree" ("business_id", "sku");



CREATE INDEX "rider_delivery_issues_order_reported_idx" ON "public"."rider_delivery_issues" USING "btree" ("order_id", "reported_at" DESC);



CREATE INDEX "rider_locations_business_rider_created_idx" ON "public"."rider_locations" USING "btree" ("business_id", "rider_user_id", "created_at" DESC);



CREATE UNIQUE INDEX "rider_locations_client_request_key" ON "public"."rider_locations" USING "btree" ("order_id", "rider_user_id", "client_request_id") WHERE ("client_request_id" IS NOT NULL);



CREATE INDEX "rider_locations_order_created_idx" ON "public"."rider_locations" USING "btree" ("order_id", "created_at" DESC);



CREATE INDEX "rider_locations_order_recorded_at_idx" ON "public"."rider_locations" USING "btree" ("order_id", "recorded_at" DESC);



CREATE INDEX "rider_locations_order_sequence_idx" ON "public"."rider_locations" USING "btree" ("order_id", "sequence" DESC);



CREATE UNIQUE INDEX "rider_locations_receipt_sequence_key" ON "public"."rider_locations" USING "btree" ("receipt_sequence");



CREATE UNIQUE INDEX "rider_locations_sequence_key" ON "public"."rider_locations" USING "btree" ("sequence");



CREATE INDEX "rider_profiles_business_status_idx" ON "public"."rider_profiles" USING "btree" ("business_id", "status");



CREATE INDEX "riders_business_status_idx" ON "public"."riders" USING "btree" ("business_id", "status");



CREATE INDEX "scanned_product_audit_business_idx" ON "public"."scanned_product_audit" USING "btree" ("business_id", "created_at" DESC);



CREATE INDEX "service_health_signals_business_current_idx" ON "public"."service_health_signals" USING "btree" ("business_id", "service", "observed_at" DESC);



CREATE INDEX "staff_profiles_business_status_idx" ON "public"."staff_profiles" USING "btree" ("business_id", "status");



CREATE OR REPLACE TRIGGER "business_members_identity_guard" BEFORE INSERT OR DELETE OR UPDATE ON "public"."business_members" FOR EACH ROW EXECUTE FUNCTION "public"."identity_guard_membership_write"();



CREATE OR REPLACE TRIGGER "business_payment_settings_set_updated_at" BEFORE UPDATE ON "public"."business_payment_settings" FOR EACH ROW EXECUTE FUNCTION "public"."set_payment_tables_updated_at"();



CREATE OR REPLACE TRIGGER "businesses_fail_close_whatsapp_change" BEFORE INSERT OR UPDATE OF "whatsapp_phone", "whatsapp_verified_by" ON "public"."businesses" FOR EACH ROW EXECUTE FUNCTION "public"."fail_close_business_whatsapp_change"();



CREATE OR REPLACE TRIGGER "businesses_set_updated_at" BEFORE UPDATE ON "public"."businesses" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "checkout_session_items_classify_qa_origin" AFTER INSERT ON "public"."checkout_session_items" FOR EACH ROW EXECUTE FUNCTION "public"."classify_checkout_session_qa_origin"();



CREATE OR REPLACE TRIGGER "checkout_sessions_assign_correlation" BEFORE INSERT ON "public"."checkout_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."assign_operation_correlation"();



CREATE OR REPLACE TRIGGER "checkout_sessions_set_updated_at" BEFORE UPDATE ON "public"."checkout_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."set_payment_tables_updated_at"();



CREATE OR REPLACE TRIGGER "checkout_sessions_zz_bump_revision" BEFORE UPDATE ON "public"."checkout_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."bump_checkout_session_revision"();



CREATE OR REPLACE TRIGGER "customer_addresses_set_updated_at" BEFORE UPDATE ON "public"."customer_addresses" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "customers_set_updated_at" BEFORE UPDATE ON "public"."customers" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "daily_reconciliations_immutable" BEFORE DELETE OR UPDATE ON "public"."daily_reconciliations" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_closed_daily_reconciliation_mutation"();



CREATE OR REPLACE TRIGGER "fiscal_document_items_protect_authorized" BEFORE DELETE OR UPDATE ON "public"."fiscal_document_items" FOR EACH ROW EXECUTE FUNCTION "public"."protect_authorized_fiscal_document_item"();



CREATE OR REPLACE TRIGGER "fiscal_documents_assign_correlation" BEFORE INSERT OR UPDATE OF "source_id", "associated_document_id" ON "public"."fiscal_documents" FOR EACH ROW EXECUTE FUNCTION "public"."assign_operation_correlation"();



CREATE OR REPLACE TRIGGER "fiscal_documents_enqueue_authorized_artifact" AFTER UPDATE OF "state" ON "public"."fiscal_documents" FOR EACH ROW EXECUTE FUNCTION "public"."enqueue_authorized_fiscal_artifact"();



CREATE OR REPLACE TRIGGER "fiscal_documents_protect_authorized" BEFORE DELETE OR UPDATE ON "public"."fiscal_documents" FOR EACH ROW EXECUTE FUNCTION "public"."protect_authorized_fiscal_document"();



CREATE OR REPLACE TRIGGER "fiscal_documents_require_execution_authorization" BEFORE INSERT ON "public"."fiscal_documents" FOR EACH ROW EXECUTE FUNCTION "public"."assert_fiscal_execution_authorized"();



CREATE OR REPLACE TRIGGER "fiscal_print_jobs_assign_correlation" BEFORE INSERT OR UPDATE OF "fiscal_document_id" ON "public"."fiscal_print_jobs" FOR EACH ROW EXECUTE FUNCTION "public"."assign_operation_correlation"();



CREATE OR REPLACE TRIGGER "identity_audit_events_append_only" BEFORE DELETE OR UPDATE ON "public"."identity_audit_events" FOR EACH ROW EXECUTE FUNCTION "public"."identity_audit_is_append_only"();



CREATE OR REPLACE TRIGGER "identity_user_security_set_updated_at" BEFORE UPDATE ON "public"."identity_user_security" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "inventory_movements_immutable" BEFORE DELETE OR UPDATE ON "public"."inventory_movements" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_inventory_movement_mutation"();



CREATE OR REPLACE TRIGGER "inventory_reservations_set_updated_at" BEFORE UPDATE ON "public"."inventory_reservations" FOR EACH ROW EXECUTE FUNCTION "public"."set_payment_tables_updated_at"();



CREATE OR REPLACE TRIGGER "order_delivery_handoffs_set_updated_at" BEFORE UPDATE ON "public"."order_delivery_handoffs" FOR EACH ROW EXECUTE FUNCTION "public"."set_order_delivery_handoff_updated_at"();



CREATE OR REPLACE TRIGGER "order_items_classify_qa_origin" AFTER INSERT ON "public"."order_items" FOR EACH ROW EXECUTE FUNCTION "public"."classify_order_qa_origin"();



CREATE OR REPLACE TRIGGER "orders_apply_pending_delivery_location" BEFORE INSERT ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."apply_pending_delivery_location"();



CREATE CONSTRAINT TRIGGER "orders_assert_payment_modality" AFTER INSERT OR UPDATE OF "payment_method", "id" ON "public"."orders" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "public"."assert_order_payment_modality"();



CREATE OR REPLACE TRIGGER "orders_assign_correlation" BEFORE INSERT ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."assign_operation_correlation"();



CREATE OR REPLACE TRIGGER "orders_enqueue_new_order_notification" AFTER INSERT ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."enqueue_new_order_notification"();



CREATE CONSTRAINT TRIGGER "orders_keep_confirmed_delivery_location" AFTER UPDATE ON "public"."orders" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (("old"."delivery_location_confirmed_at" IS NOT NULL)) EXECUTE FUNCTION "public"."enforce_confirmed_delivery_location"();



CREATE OR REPLACE TRIGGER "orders_kick_scheduler_watchdog" AFTER INSERT ON "public"."orders" FOR EACH STATEMENT EXECUTE FUNCTION "public"."kick_scheduler_watchdog"();



CREATE OR REPLACE TRIGGER "orders_log_status_event" AFTER UPDATE ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."log_order_status_event"();



CREATE OR REPLACE TRIGGER "orders_prevent_rider_unverified_delivery" BEFORE UPDATE OF "status" ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_rider_unverified_delivery"();



CREATE OR REPLACE TRIGGER "orders_purge_terminal_rider_locations" AFTER UPDATE OF "status" ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."purge_terminal_order_rider_locations"();



CREATE CONSTRAINT TRIGGER "orders_require_confirmed_delivery_location" AFTER INSERT ON "public"."orders" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "public"."enforce_confirmed_delivery_location"();



CREATE OR REPLACE TRIGGER "orders_require_verified_delivery_code" BEFORE UPDATE OF "status" ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_unverified_delivery"();



CREATE OR REPLACE TRIGGER "orders_set_operational_defaults" BEFORE INSERT OR UPDATE ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."set_order_operational_defaults"();



CREATE OR REPLACE TRIGGER "orders_set_status_timestamps" BEFORE INSERT OR UPDATE ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."set_order_status_timestamps"();



CREATE OR REPLACE TRIGGER "orders_set_updated_at" BEFORE UPDATE ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "orders_zz_bump_revision" BEFORE UPDATE ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."bump_order_revision"();



CREATE OR REPLACE TRIGGER "packing_sessions_assign_correlation" BEFORE INSERT OR UPDATE OF "order_id" ON "public"."order_packing_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."assign_operation_correlation"();



CREATE OR REPLACE TRIGGER "payment_attempts_set_updated_at" BEFORE UPDATE ON "public"."payment_attempts" FOR EACH ROW EXECUTE FUNCTION "public"."set_payment_tables_updated_at"();



CREATE OR REPLACE TRIGGER "payment_cancellations_set_updated_at" BEFORE UPDATE ON "public"."payment_cancellations" FOR EACH ROW EXECUTE FUNCTION "public"."set_payment_tables_updated_at"();



CREATE OR REPLACE TRIGGER "payment_disputes_set_updated_at" BEFORE UPDATE ON "public"."payment_disputes" FOR EACH ROW EXECUTE FUNCTION "public"."set_payment_tables_updated_at"();



CREATE OR REPLACE TRIGGER "payment_intents_assign_correlation" BEFORE INSERT OR UPDATE OF "checkout_session_id" ON "public"."payment_intents" FOR EACH ROW EXECUTE FUNCTION "public"."assign_operation_correlation"();



CREATE OR REPLACE TRIGGER "payment_intents_propagate_order_correlation" AFTER INSERT OR UPDATE OF "order_id", "correlation_id" ON "public"."payment_intents" FOR EACH ROW EXECUTE FUNCTION "public"."propagate_paid_order_correlation"();



CREATE OR REPLACE TRIGGER "payment_intents_set_updated_at" BEFORE UPDATE ON "public"."payment_intents" FOR EACH ROW EXECUTE FUNCTION "public"."set_payment_tables_updated_at"();



CREATE OR REPLACE TRIGGER "payment_intents_zz_monotonic_status" BEFORE UPDATE ON "public"."payment_intents" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_payment_intent_status_regression"();



CREATE OR REPLACE TRIGGER "payment_outbox_set_updated_at" BEFORE UPDATE ON "public"."payment_outbox" FOR EACH ROW EXECUTE FUNCTION "public"."set_payment_tables_updated_at"();



CREATE OR REPLACE TRIGGER "payment_outbox_worker_kick" AFTER INSERT ON "public"."payment_outbox" FOR EACH STATEMENT EXECUTE FUNCTION "public"."kick_payment_outbox_worker"();



CREATE OR REPLACE TRIGGER "payment_refunds_set_updated_at" BEFORE UPDATE ON "public"."payment_refunds" FOR EACH ROW EXECUTE FUNCTION "public"."set_payment_tables_updated_at"();



CREATE OR REPLACE TRIGGER "pos_sales_assign_correlation" BEFORE INSERT ON "public"."pos_sales" FOR EACH ROW EXECUTE FUNCTION "public"."assign_operation_correlation"();



CREATE OR REPLACE TRIGGER "product_combos_revision" BEFORE UPDATE ON "public"."product_combos" FOR EACH ROW EXECUTE FUNCTION "public"."bump_product_combo_revision"();



CREATE OR REPLACE TRIGGER "products_fail_close_master_change" BEFORE UPDATE ON "public"."products" FOR EACH ROW EXECUTE FUNCTION "public"."fail_close_verified_product_master_change"();



CREATE OR REPLACE TRIGGER "products_set_updated_at" BEFORE UPDATE ON "public"."products" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "rider_locations_server_time" BEFORE INSERT ON "public"."rider_locations" FOR EACH ROW EXECUTE FUNCTION "public"."stamp_rider_location_server_time"();



CREATE OR REPLACE TRIGGER "rider_map_capture_order_location" AFTER INSERT ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "private"."capture_rider_map_order_location_snapshot"();



CREATE OR REPLACE TRIGGER "rider_profiles_assert_role" BEFORE INSERT OR UPDATE ON "public"."rider_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."identity_assert_profile_role"();



CREATE OR REPLACE TRIGGER "rider_profiles_set_updated_at" BEFORE UPDATE ON "public"."rider_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "riders_set_updated_at" BEFORE UPDATE ON "public"."riders" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "staff_profiles_assert_role" BEFORE INSERT OR UPDATE ON "public"."staff_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."identity_assert_profile_role"();



CREATE OR REPLACE TRIGGER "staff_profiles_set_updated_at" BEFORE UPDATE ON "public"."staff_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "private"."rider_map_business_locations"
    ADD CONSTRAINT "rider_map_business_locations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "private"."rider_map_order_location_snapshots"
    ADD CONSTRAINT "rider_map_order_location_snapshots_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."business_command_receipts"
    ADD CONSTRAINT "business_command_receipts_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."business_command_receipts"
    ADD CONSTRAINT "business_command_receipts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."business_command_receipts"
    ADD CONSTRAINT "business_command_receipts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."business_members"
    ADD CONSTRAINT "business_members_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."business_members"
    ADD CONSTRAINT "business_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."business_payment_settings"
    ADD CONSTRAINT "business_payment_settings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."businesses"
    ADD CONSTRAINT "businesses_ordering_verified_by_fkey" FOREIGN KEY ("ordering_verified_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."businesses"
    ADD CONSTRAINT "businesses_whatsapp_verified_by_fkey" FOREIGN KEY ("whatsapp_verified_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."catalog_assets"
    ADD CONSTRAINT "catalog_assets_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."catalog_assets"
    ADD CONSTRAINT "catalog_assets_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."catalog_product_drafts"
    ADD CONSTRAINT "catalog_product_drafts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."catalog_product_drafts"
    ADD CONSTRAINT "catalog_product_drafts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."catalog_product_drafts"
    ADD CONSTRAINT "catalog_product_drafts_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."catalog_product_drafts"
    ADD CONSTRAINT "catalog_product_drafts_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."checkout_session_combos"
    ADD CONSTRAINT "checkout_session_combos_checkout_session_id_fkey" FOREIGN KEY ("checkout_session_id") REFERENCES "public"."checkout_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."checkout_session_combos"
    ADD CONSTRAINT "checkout_session_combos_combo_uuid_fkey" FOREIGN KEY ("combo_uuid") REFERENCES "public"."product_combos"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."checkout_session_items"
    ADD CONSTRAINT "checkout_session_items_checkout_session_id_fkey" FOREIGN KEY ("checkout_session_id") REFERENCES "public"."checkout_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."checkout_session_items"
    ADD CONSTRAINT "checkout_session_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."checkout_sessions"
    ADD CONSTRAINT "checkout_sessions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."checkout_sessions"
    ADD CONSTRAINT "checkout_sessions_completed_order_id_fkey" FOREIGN KEY ("completed_order_id") REFERENCES "public"."orders"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."checkout_sessions"
    ADD CONSTRAINT "checkout_sessions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."customer_addresses"
    ADD CONSTRAINT "customer_addresses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."daily_reconciliation_events"
    ADD CONSTRAINT "daily_reconciliation_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."daily_reconciliation_events"
    ADD CONSTRAINT "daily_reconciliation_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."daily_reconciliation_events"
    ADD CONSTRAINT "daily_reconciliation_events_reconciliation_id_fkey" FOREIGN KEY ("reconciliation_id") REFERENCES "public"."daily_reconciliations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."daily_reconciliations"
    ADD CONSTRAINT "daily_reconciliations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."daily_reconciliations"
    ADD CONSTRAINT "daily_reconciliations_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."daily_reconciliations"
    ADD CONSTRAINT "daily_reconciliations_prepared_by_fkey" FOREIGN KEY ("prepared_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."delivery_confirmation_attempts"
    ADD CONSTRAINT "delivery_confirmation_attempts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."delivery_confirmation_attempts"
    ADD CONSTRAINT "delivery_confirmation_attempts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."delivery_confirmation_attempts"
    ADD CONSTRAINT "delivery_confirmation_attempts_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."delivery_outbox"
    ADD CONSTRAINT "delivery_outbox_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."delivery_outbox"
    ADD CONSTRAINT "delivery_outbox_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fiscal_accounting_policies"
    ADD CONSTRAINT "fiscal_accounting_policies_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."fiscal_artifact_outbox"
    ADD CONSTRAINT "fiscal_artifact_outbox_fiscal_document_id_fkey" FOREIGN KEY ("fiscal_document_id") REFERENCES "public"."fiscal_documents"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."fiscal_credit_allocations"
    ADD CONSTRAINT "fiscal_credit_allocations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."fiscal_credit_allocations"
    ADD CONSTRAINT "fiscal_credit_allocations_credit_document_id_fkey" FOREIGN KEY ("credit_document_id") REFERENCES "public"."fiscal_documents"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."fiscal_credit_allocations"
    ADD CONSTRAINT "fiscal_credit_allocations_original_document_id_fkey" FOREIGN KEY ("original_document_id") REFERENCES "public"."fiscal_documents"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."fiscal_credit_allocations"
    ADD CONSTRAINT "fiscal_credit_allocations_original_item_id_fkey" FOREIGN KEY ("original_item_id") REFERENCES "public"."fiscal_document_items"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."fiscal_document_artifacts"
    ADD CONSTRAINT "fiscal_document_artifacts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."fiscal_document_artifacts"
    ADD CONSTRAINT "fiscal_document_artifacts_fiscal_document_id_fkey" FOREIGN KEY ("fiscal_document_id") REFERENCES "public"."fiscal_documents"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."fiscal_document_artifacts"
    ADD CONSTRAINT "fiscal_document_artifacts_supersedes_artifact_id_fkey" FOREIGN KEY ("supersedes_artifact_id") REFERENCES "public"."fiscal_document_artifacts"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."fiscal_document_items"
    ADD CONSTRAINT "fiscal_document_items_fiscal_document_id_fkey" FOREIGN KEY ("fiscal_document_id") REFERENCES "public"."fiscal_documents"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."fiscal_documents"
    ADD CONSTRAINT "fiscal_documents_associated_document_id_fkey" FOREIGN KEY ("associated_document_id") REFERENCES "public"."fiscal_documents"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."fiscal_documents"
    ADD CONSTRAINT "fiscal_documents_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."fiscal_events"
    ADD CONSTRAINT "fiscal_events_fiscal_document_id_fkey" FOREIGN KEY ("fiscal_document_id") REFERENCES "public"."fiscal_documents"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."fiscal_outbox"
    ADD CONSTRAINT "fiscal_outbox_fiscal_document_id_fkey" FOREIGN KEY ("fiscal_document_id") REFERENCES "public"."fiscal_documents"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."fiscal_print_jobs"
    ADD CONSTRAINT "fiscal_print_jobs_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "public"."fiscal_document_artifacts"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."fiscal_print_jobs"
    ADD CONSTRAINT "fiscal_print_jobs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."fiscal_print_jobs"
    ADD CONSTRAINT "fiscal_print_jobs_fiscal_document_id_fkey" FOREIGN KEY ("fiscal_document_id") REFERENCES "public"."fiscal_documents"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."fiscal_print_jobs"
    ADD CONSTRAINT "fiscal_print_jobs_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."fiscal_profile_events"
    ADD CONSTRAINT "fiscal_profile_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."fiscal_profile_events"
    ADD CONSTRAINT "fiscal_profile_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fiscal_profiles"
    ADD CONSTRAINT "fiscal_profiles_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."fiscal_profiles"
    ADD CONSTRAINT "fiscal_profiles_homologation_authorized_by_fkey" FOREIGN KEY ("homologation_authorized_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."fiscal_profiles"
    ADD CONSTRAINT "fiscal_profiles_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."fiscal_request_attempts"
    ADD CONSTRAINT "fiscal_request_attempts_fiscal_document_id_fkey" FOREIGN KEY ("fiscal_document_id") REFERENCES "public"."fiscal_documents"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."fiscal_request_attempts"
    ADD CONSTRAINT "fiscal_request_attempts_outbox_id_fkey" FOREIGN KEY ("outbox_id") REFERENCES "public"."fiscal_outbox"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."identity_invitations"
    ADD CONSTRAINT "identity_invitations_accepted_user_id_fkey" FOREIGN KEY ("accepted_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."identity_invitations"
    ADD CONSTRAINT "identity_invitations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."identity_invitations"
    ADD CONSTRAINT "identity_invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."identity_invitations"
    ADD CONSTRAINT "identity_invitations_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."identity_role_permissions"
    ADD CONSTRAINT "identity_role_permissions_permission_fkey" FOREIGN KEY ("permission") REFERENCES "public"."identity_permissions"("permission") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."identity_sessions"
    ADD CONSTRAINT "identity_sessions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."identity_sessions"
    ADD CONSTRAINT "identity_sessions_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."identity_sessions"
    ADD CONSTRAINT "identity_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."identity_user_security"
    ADD CONSTRAINT "identity_user_security_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."identity_user_security"
    ADD CONSTRAINT "identity_user_security_disabled_by_fkey" FOREIGN KEY ("disabled_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."identity_user_security"
    ADD CONSTRAINT "identity_user_security_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inventory_movements"
    ADD CONSTRAINT "inventory_movements_barcode_id_fkey" FOREIGN KEY ("barcode_id") REFERENCES "public"."product_barcodes"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."inventory_movements"
    ADD CONSTRAINT "inventory_movements_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."inventory_movements"
    ADD CONSTRAINT "inventory_movements_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."inventory_movements"
    ADD CONSTRAINT "inventory_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."inventory_receipt_items"
    ADD CONSTRAINT "inventory_receipt_items_barcode_id_fkey" FOREIGN KEY ("barcode_id") REFERENCES "public"."product_barcodes"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."inventory_receipt_items"
    ADD CONSTRAINT "inventory_receipt_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."inventory_receipt_items"
    ADD CONSTRAINT "inventory_receipt_items_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "public"."inventory_receipts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inventory_receipts"
    ADD CONSTRAINT "inventory_receipts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."inventory_receipts"
    ADD CONSTRAINT "inventory_receipts_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."inventory_receipts"
    ADD CONSTRAINT "inventory_receipts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."inventory_reservations"
    ADD CONSTRAINT "inventory_reservations_checkout_session_id_fkey" FOREIGN KEY ("checkout_session_id") REFERENCES "public"."checkout_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inventory_reservations"
    ADD CONSTRAINT "inventory_reservations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."notification_outbox"
    ADD CONSTRAINT "notification_outbox_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."operational_alert_events"
    ADD CONSTRAINT "operational_alert_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."operational_alert_events"
    ADD CONSTRAINT "operational_alert_events_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "public"."operational_alerts"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."operational_alert_events"
    ADD CONSTRAINT "operational_alert_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."operational_alerts"
    ADD CONSTRAINT "operational_alerts_acknowledged_by_fkey" FOREIGN KEY ("acknowledged_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."operational_alerts"
    ADD CONSTRAINT "operational_alerts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."operational_alerts"
    ADD CONSTRAINT "operational_alerts_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."order_abuse_events"
    ADD CONSTRAINT "order_abuse_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_abuse_events"
    ADD CONSTRAINT "order_abuse_events_customer_user_id_fkey" FOREIGN KEY ("customer_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."order_combos"
    ADD CONSTRAINT "order_combos_combo_uuid_fkey" FOREIGN KEY ("combo_uuid") REFERENCES "public"."product_combos"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."order_combos"
    ADD CONSTRAINT "order_combos_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_delivery_handoffs"
    ADD CONSTRAINT "order_delivery_handoffs_confirmed_by_user_id_fkey" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."order_delivery_handoffs"
    ADD CONSTRAINT "order_delivery_handoffs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_events"
    ADD CONSTRAINT "order_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."order_events"
    ADD CONSTRAINT "order_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_events"
    ADD CONSTRAINT "order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_product_uuid_fkey" FOREIGN KEY ("product_uuid") REFERENCES "public"."products"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."order_packing_scans"
    ADD CONSTRAINT "order_packing_scans_barcode_id_fkey" FOREIGN KEY ("barcode_id") REFERENCES "public"."product_barcodes"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."order_packing_scans"
    ADD CONSTRAINT "order_packing_scans_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."order_packing_scans"
    ADD CONSTRAINT "order_packing_scans_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."order_packing_scans"
    ADD CONSTRAINT "order_packing_scans_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."order_packing_scans"
    ADD CONSTRAINT "order_packing_scans_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."order_packing_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_packing_sessions"
    ADD CONSTRAINT "order_packing_sessions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."order_packing_sessions"
    ADD CONSTRAINT "order_packing_sessions_exception_authorized_by_fkey" FOREIGN KEY ("exception_authorized_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."order_packing_sessions"
    ADD CONSTRAINT "order_packing_sessions_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."order_packing_sessions"
    ADD CONSTRAINT "order_packing_sessions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."order_public_tokens"
    ADD CONSTRAINT "order_public_tokens_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_acknowledged_by_fkey" FOREIGN KEY ("acknowledged_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_assigned_rider_id_fkey" FOREIGN KEY ("assigned_rider_id") REFERENCES "public"."riders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_assigned_rider_user_id_fkey" FOREIGN KEY ("assigned_rider_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_customer_address_id_fkey" FOREIGN KEY ("customer_address_id") REFERENCES "public"."customer_addresses"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_customer_user_id_fkey" FOREIGN KEY ("customer_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payment_attempts"
    ADD CONSTRAINT "payment_attempts_payment_intent_id_fkey" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_cancellations"
    ADD CONSTRAINT "payment_cancellations_payment_intent_id_fkey" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."payment_cancellations"
    ADD CONSTRAINT "payment_cancellations_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payment_disputes"
    ADD CONSTRAINT "payment_disputes_payment_intent_id_fkey" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."payment_events"
    ADD CONSTRAINT "payment_events_payment_intent_id_fkey" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_events"
    ADD CONSTRAINT "payment_events_webhook_receipt_id_fkey" FOREIGN KEY ("webhook_receipt_id") REFERENCES "public"."payment_webhook_receipts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payment_intents"
    ADD CONSTRAINT "payment_intents_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."payment_intents"
    ADD CONSTRAINT "payment_intents_checkout_session_id_fkey" FOREIGN KEY ("checkout_session_id") REFERENCES "public"."checkout_sessions"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."payment_intents"
    ADD CONSTRAINT "payment_intents_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."payment_outbox"
    ADD CONSTRAINT "payment_outbox_cancellation_id_fkey" FOREIGN KEY ("cancellation_id") REFERENCES "public"."payment_cancellations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_outbox"
    ADD CONSTRAINT "payment_outbox_payment_intent_id_fkey" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_outbox"
    ADD CONSTRAINT "payment_outbox_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "public"."payment_refunds"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_outbox"
    ADD CONSTRAINT "payment_outbox_webhook_receipt_id_fkey" FOREIGN KEY ("webhook_receipt_id") REFERENCES "public"."payment_webhook_receipts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_refunds"
    ADD CONSTRAINT "payment_refunds_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."payment_refunds"
    ADD CONSTRAINT "payment_refunds_payment_intent_id_fkey" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."payment_refunds"
    ADD CONSTRAINT "payment_refunds_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pos_payments"
    ADD CONSTRAINT "pos_payments_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "public"."pos_sales"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pos_sale_items"
    ADD CONSTRAINT "pos_sale_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pos_sale_items"
    ADD CONSTRAINT "pos_sale_items_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "public"."pos_sales"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pos_sales"
    ADD CONSTRAINT "pos_sales_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pos_sales"
    ADD CONSTRAINT "pos_sales_fiscal_document_id_fkey" FOREIGN KEY ("fiscal_document_id") REFERENCES "public"."fiscal_documents"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pos_sales"
    ADD CONSTRAINT "pos_sales_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."product_barcodes"
    ADD CONSTRAINT "product_barcodes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_barcodes"
    ADD CONSTRAINT "product_barcodes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."product_barcodes"
    ADD CONSTRAINT "product_barcodes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."product_combo_components"
    ADD CONSTRAINT "product_combo_components_combo_id_fkey" FOREIGN KEY ("combo_id") REFERENCES "public"."product_combos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_combo_components"
    ADD CONSTRAINT "product_combo_components_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."product_combo_substitutions"
    ADD CONSTRAINT "product_combo_substitutions_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "public"."product_combo_components"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_combo_substitutions"
    ADD CONSTRAINT "product_combo_substitutions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."product_combos"
    ADD CONSTRAINT "product_combos_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."product_combos"
    ADD CONSTRAINT "product_combos_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_catalog_asset_id_fkey" FOREIGN KEY ("catalog_asset_id") REFERENCES "public"."catalog_assets"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."rider_delivery_issues"
    ADD CONSTRAINT "rider_delivery_issues_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rider_delivery_issues"
    ADD CONSTRAINT "rider_delivery_issues_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rider_delivery_issues"
    ADD CONSTRAINT "rider_delivery_issues_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."rider_delivery_operations"
    ADD CONSTRAINT "rider_delivery_operations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rider_delivery_operations"
    ADD CONSTRAINT "rider_delivery_operations_rider_user_id_fkey" FOREIGN KEY ("rider_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rider_locations"
    ADD CONSTRAINT "rider_locations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rider_locations"
    ADD CONSTRAINT "rider_locations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rider_locations"
    ADD CONSTRAINT "rider_locations_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."rider_locations"
    ADD CONSTRAINT "rider_locations_rider_user_id_fkey" FOREIGN KEY ("rider_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rider_profiles"
    ADD CONSTRAINT "rider_profiles_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rider_profiles"
    ADD CONSTRAINT "rider_profiles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."rider_profiles"
    ADD CONSTRAINT "rider_profiles_membership_fkey" FOREIGN KEY ("business_id", "user_id") REFERENCES "public"."business_members"("business_id", "user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rider_profiles"
    ADD CONSTRAINT "rider_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."riders"
    ADD CONSTRAINT "riders_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."scanned_product_audit"
    ADD CONSTRAINT "scanned_product_audit_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."scanned_product_audit"
    ADD CONSTRAINT "scanned_product_audit_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."scanned_product_audit"
    ADD CONSTRAINT "scanned_product_audit_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "public"."catalog_product_drafts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."scanned_product_audit"
    ADD CONSTRAINT "scanned_product_audit_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."service_health_signals"
    ADD CONSTRAINT "service_health_signals_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."staff_profiles"
    ADD CONSTRAINT "staff_profiles_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staff_profiles"
    ADD CONSTRAINT "staff_profiles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."staff_profiles"
    ADD CONSTRAINT "staff_profiles_membership_fkey" FOREIGN KEY ("business_id", "user_id") REFERENCES "public"."business_members"("business_id", "user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staff_profiles"
    ADD CONSTRAINT "staff_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stock_count_items"
    ADD CONSTRAINT "stock_count_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."stock_count_items"
    ADD CONSTRAINT "stock_count_items_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."stock_count_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stock_count_sessions"
    ADD CONSTRAINT "stock_count_sessions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."stock_count_sessions"
    ADD CONSTRAINT "stock_count_sessions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE "private"."rider_map_business_locations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "private"."rider_map_order_location_snapshots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "approved combos are public" ON "public"."product_combos" FOR SELECT TO "authenticated", "anon" USING (("is_active" AND ("approval_status" = 'APROBADO_COMERCIAL'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."businesses" "b"
  WHERE (("b"."id" = "product_combos"."business_id") AND "b"."is_active" AND ("b"."status" = 'open'::"text") AND "b"."ordering_verified" AND "b"."ordering_enabled")))));



CREATE POLICY "authorized team reads abuse events" ON "public"."order_abuse_events" FOR SELECT TO "authenticated" USING ("public"."has_business_role"("business_id", ARRAY['owner'::"text", 'admin'::"text"]));



CREATE POLICY "business reads approved fiscal policies" ON "public"."fiscal_accounting_policies" FOR SELECT TO "authenticated" USING ("public"."has_business_role"("business_id", ARRAY['owner'::"text", 'admin'::"text"]));



CREATE POLICY "business reads barcode catalog" ON "public"."product_barcodes" FOR SELECT TO "authenticated" USING ("public"."is_business_member"("business_id"));



CREATE POLICY "business reads command audit" ON "public"."business_command_receipts" FOR SELECT TO "authenticated" USING ("public"."is_business_member"("business_id"));



CREATE POLICY "business reads daily reconciliation events" ON "public"."daily_reconciliation_events" FOR SELECT TO "authenticated" USING ("public"."is_business_member"("business_id"));



CREATE POLICY "business reads daily reconciliations" ON "public"."daily_reconciliations" FOR SELECT TO "authenticated" USING ("public"."is_business_member"("business_id"));



CREATE POLICY "business reads fiscal artifact metadata" ON "public"."fiscal_document_artifacts" FOR SELECT TO "authenticated" USING ("public"."is_business_member"("business_id"));



CREATE POLICY "business reads fiscal credit allocations" ON "public"."fiscal_credit_allocations" FOR SELECT TO "authenticated" USING ("public"."is_business_member"("business_id"));



CREATE POLICY "business reads fiscal documents" ON "public"."fiscal_documents" FOR SELECT TO "authenticated" USING ("public"."is_business_member"("business_id"));



CREATE POLICY "business reads fiscal events" ON "public"."fiscal_events" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."fiscal_documents" "d"
  WHERE (("d"."id" = "fiscal_events"."fiscal_document_id") AND "public"."is_business_member"("d"."business_id")))));



CREATE POLICY "business reads fiscal items" ON "public"."fiscal_document_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."fiscal_documents" "d"
  WHERE (("d"."id" = "fiscal_document_items"."fiscal_document_id") AND "public"."is_business_member"("d"."business_id")))));



CREATE POLICY "business reads fiscal print audit" ON "public"."fiscal_print_jobs" FOR SELECT TO "authenticated" USING ("public"."is_business_member"("business_id"));



CREATE POLICY "business reads fiscal profile events" ON "public"."fiscal_profile_events" FOR SELECT TO "authenticated" USING ("public"."is_business_member"("business_id"));



CREATE POLICY "business reads fiscal profiles" ON "public"."fiscal_profiles" FOR SELECT TO "authenticated" USING ("public"."is_business_member"("business_id"));



CREATE POLICY "business reads inventory ledger" ON "public"."inventory_movements" FOR SELECT TO "authenticated" USING ("public"."is_business_member"("business_id"));



CREATE POLICY "business reads notification status" ON "public"."notification_outbox" FOR SELECT TO "authenticated" USING ("public"."is_business_member"("business_id"));



CREATE POLICY "business reads operational alert events" ON "public"."operational_alert_events" FOR SELECT TO "authenticated" USING ("public"."is_business_member"("business_id"));



CREATE POLICY "business reads operational alerts" ON "public"."operational_alerts" FOR SELECT TO "authenticated" USING ("public"."is_business_member"("business_id"));



CREATE POLICY "business reads packing" ON "public"."order_packing_sessions" FOR SELECT TO "authenticated" USING ("public"."is_business_member"("business_id"));



CREATE POLICY "business reads packing scans" ON "public"."order_packing_scans" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."order_packing_sessions" "s"
  WHERE (("s"."id" = "order_packing_scans"."session_id") AND "public"."is_business_member"("s"."business_id")))));



CREATE POLICY "business reads pos items" ON "public"."pos_sale_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."pos_sales" "s"
  WHERE (("s"."id" = "pos_sale_items"."sale_id") AND "public"."is_business_member"("s"."business_id")))));



CREATE POLICY "business reads pos payments" ON "public"."pos_payments" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."pos_sales" "s"
  WHERE (("s"."id" = "pos_payments"."sale_id") AND "public"."is_business_member"("s"."business_id")))));



CREATE POLICY "business reads pos sales" ON "public"."pos_sales" FOR SELECT TO "authenticated" USING ("public"."is_business_member"("business_id"));



CREATE POLICY "business reads product drafts" ON "public"."catalog_product_drafts" FOR SELECT TO "authenticated" USING ("public"."is_business_member"("business_id"));



CREATE POLICY "business reads receipt items" ON "public"."inventory_receipt_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."inventory_receipts" "r"
  WHERE (("r"."id" = "inventory_receipt_items"."receipt_id") AND "public"."is_business_member"("r"."business_id")))));



CREATE POLICY "business reads receipts" ON "public"."inventory_receipts" FOR SELECT TO "authenticated" USING ("public"."is_business_member"("business_id"));



CREATE POLICY "business reads scanned product audit" ON "public"."scanned_product_audit" FOR SELECT TO "authenticated" USING ("public"."is_business_member"("business_id"));



CREATE POLICY "business reads stock count items" ON "public"."stock_count_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."stock_count_sessions" "s"
  WHERE (("s"."id" = "stock_count_items"."session_id") AND "public"."is_business_member"("s"."business_id")))));



CREATE POLICY "business reads stock counts" ON "public"."stock_count_sessions" FOR SELECT TO "authenticated" USING ("public"."is_business_member"("business_id"));



ALTER TABLE "public"."business_command_receipts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."business_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."business_payment_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."businesses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "catalog team reads approved assets" ON "public"."catalog_assets" FOR SELECT TO "authenticated" USING ("public"."has_business_role"("business_id", ARRAY['owner'::"text", 'admin'::"text", 'staff'::"text"]));



ALTER TABLE "public"."catalog_assets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."catalog_product_drafts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "checkout session items follow checkout session access" ON "public"."checkout_session_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."checkout_sessions" "s"
  WHERE (("s"."id" = "checkout_session_items"."checkout_session_id") AND (("s"."customer_id" = "auth"."uid"()) OR "public"."has_business_role"("s"."business_id", ARRAY['owner'::"text", 'admin'::"text"]))))));



CREATE POLICY "checkout sessions readable by their customer or finance roles" ON "public"."checkout_sessions" FOR SELECT TO "authenticated" USING ((("customer_id" = "auth"."uid"()) OR "public"."has_business_role"("business_id", ARRAY['owner'::"text", 'admin'::"text"])));



ALTER TABLE "public"."checkout_session_combos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."checkout_session_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."checkout_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "combo components follow combo access" ON "public"."product_combo_components" FOR SELECT TO "authenticated", "anon" USING ((EXISTS ( SELECT 1
   FROM "public"."product_combos" "c"
  WHERE (("c"."id" = "product_combo_components"."combo_id") AND "c"."is_active" AND ("c"."approval_status" = 'APROBADO_COMERCIAL'::"text")))));



CREATE POLICY "combo substitutions follow component access" ON "public"."product_combo_substitutions" FOR SELECT TO "authenticated", "anon" USING ((EXISTS ( SELECT 1
   FROM ("public"."product_combo_components" "cc"
     JOIN "public"."product_combos" "c" ON (("c"."id" = "cc"."combo_id")))
  WHERE (("cc"."id" = "product_combo_substitutions"."component_id") AND "c"."is_active" AND ("c"."approval_status" = 'APROBADO_COMERCIAL'::"text")))));



CREATE POLICY "commercial team reads every combo" ON "public"."product_combos" FOR SELECT TO "authenticated" USING ("public"."has_business_role"("business_id", ARRAY['owner'::"text", 'admin'::"text", 'staff'::"text"]));



CREATE POLICY "commercial team reads every combo component" ON "public"."product_combo_components" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."product_combos" "c"
  WHERE (("c"."id" = "product_combo_components"."combo_id") AND "public"."has_business_role"("c"."business_id", ARRAY['owner'::"text", 'admin'::"text", 'staff'::"text"])))));



CREATE POLICY "customer addresses readable by owner" ON "public"."customer_addresses" FOR SELECT TO "authenticated" USING ((("customer_id" = "auth"."uid"()) AND ("deleted_at" IS NULL)));



ALTER TABLE "public"."customer_addresses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "customers readable by owner" ON "public"."customers" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



ALTER TABLE "public"."daily_reconciliation_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."daily_reconciliations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."delivery_confirmation_attempts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."delivery_outbox" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fiscal_accounting_policies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fiscal_artifact_outbox" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fiscal_credit_allocations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fiscal_document_artifacts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fiscal_document_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fiscal_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fiscal_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fiscal_outbox" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fiscal_parameter_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fiscal_print_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fiscal_profile_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fiscal_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fiscal_request_attempts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."identity_audit_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."identity_invitations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."identity_permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."identity_role_permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."identity_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."identity_user_security" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inventory_movements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inventory_receipt_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inventory_receipts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inventory_reservations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notification_outbox" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "operational team reads legacy riders" ON "public"."riders" FOR SELECT TO "authenticated" USING ("public"."is_business_member"("business_id"));



ALTER TABLE "public"."operational_alert_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."operational_alerts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."operational_sweep_runs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "order combos follow order access" ON "public"."order_combos" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."orders" "o"
  WHERE (("o"."id" = "order_combos"."order_id") AND (("o"."customer_user_id" = "auth"."uid"()) OR "public"."has_business_role"("o"."business_id", ARRAY['owner'::"text", 'admin'::"text", 'staff'::"text"]))))));



ALTER TABLE "public"."order_abuse_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_combos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_delivery_handoffs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_packing_scans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_packing_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_public_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payment cancellations readable by finance roles" ON "public"."payment_cancellations" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."payment_intents" "pi"
  WHERE (("pi"."id" = "payment_cancellations"."payment_intent_id") AND "public"."has_business_role"("pi"."business_id", ARRAY['owner'::"text", 'admin'::"text"])))));



CREATE POLICY "payment disputes readable by finance roles" ON "public"."payment_disputes" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."payment_intents" "pi"
  WHERE (("pi"."id" = "payment_disputes"."payment_intent_id") AND "public"."has_business_role"("pi"."business_id", ARRAY['owner'::"text", 'admin'::"text"])))));



CREATE POLICY "payment intents readable by finance roles" ON "public"."payment_intents" FOR SELECT TO "authenticated" USING ("public"."has_business_role"("business_id", ARRAY['owner'::"text", 'admin'::"text"]));



CREATE POLICY "payment refunds readable by finance roles" ON "public"."payment_refunds" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."payment_intents" "pi"
  WHERE (("pi"."id" = "payment_refunds"."payment_intent_id") AND "public"."has_business_role"("pi"."business_id", ARRAY['owner'::"text", 'admin'::"text"])))));



CREATE POLICY "payment settings readable by owners and admins" ON "public"."business_payment_settings" FOR SELECT TO "authenticated" USING ("public"."has_business_role"("business_id", ARRAY['owner'::"text", 'admin'::"text"]));



ALTER TABLE "public"."payment_attempts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payment_cancellations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payment_disputes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payment_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payment_intents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payment_outbox" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payment_rate_limit_buckets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payment_refunds" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payment_webhook_receipts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_sale_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_sales" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."product_barcodes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."product_combo_components" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."product_combo_substitutions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."product_combos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "production active businesses are public" ON "public"."businesses" FOR SELECT TO "authenticated", "anon" USING (("is_active" = true));



CREATE POLICY "production admins add staff and riders" ON "public"."business_members" FOR INSERT TO "authenticated" WITH CHECK (("public"."has_business_role"("business_id", ARRAY['admin'::"text"]) AND ("role" = ANY (ARRAY['staff'::"text", 'rider'::"text"]))));



CREATE POLICY "production admins remove staff and riders" ON "public"."business_members" FOR DELETE TO "authenticated" USING (("public"."has_business_role"("business_id", ARRAY['admin'::"text"]) AND ("role" = ANY (ARRAY['staff'::"text", 'rider'::"text"]))));



CREATE POLICY "production admins update staff and riders" ON "public"."business_members" FOR UPDATE TO "authenticated" USING (("public"."has_business_role"("business_id", ARRAY['admin'::"text"]) AND ("role" = ANY (ARRAY['staff'::"text", 'rider'::"text"])))) WITH CHECK (("public"."has_business_role"("business_id", ARRAY['admin'::"text"]) AND ("role" = ANY (ARRAY['staff'::"text", 'rider'::"text"]))));



CREATE POLICY "production members read permitted rows" ON "public"."business_members" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."has_business_role"("business_id", ARRAY['owner'::"text", 'admin'::"text"])));



CREATE POLICY "production order events readable by business" ON "public"."order_events" FOR SELECT TO "authenticated" USING ("public"."has_business_role"("business_id", ARRAY['owner'::"text", 'admin'::"text", 'staff'::"text"]));



CREATE POLICY "production order items readable with order" ON "public"."order_items" FOR SELECT TO "authenticated", "anon" USING ("public"."can_access_order"("order_id"));



CREATE POLICY "production orders readable by owner" ON "public"."orders" FOR SELECT TO "authenticated", "anon" USING ("public"."can_access_order"("id"));



CREATE POLICY "production owners manage members" ON "public"."business_members" TO "authenticated" USING ("public"."has_business_role"("business_id", ARRAY['owner'::"text"])) WITH CHECK ("public"."has_business_role"("business_id", ARRAY['owner'::"text"]));



CREATE POLICY "production owners update business ordering" ON "public"."businesses" FOR UPDATE TO "authenticated" USING ("public"."has_business_role"("id", ARRAY['owner'::"text", 'admin'::"text"])) WITH CHECK ("public"."has_business_role"("id", ARRAY['owner'::"text", 'admin'::"text"]));



CREATE POLICY "production team adds products" ON "public"."products" FOR INSERT TO "authenticated" WITH CHECK ("public"."has_business_role"("business_id", ARRAY['owner'::"text", 'admin'::"text", 'staff'::"text"]));



CREATE POLICY "production team reads products" ON "public"."products" FOR SELECT TO "authenticated" USING ("public"."has_business_role"("business_id", ARRAY['owner'::"text", 'admin'::"text", 'staff'::"text"]));



CREATE POLICY "production team updates products" ON "public"."products" FOR UPDATE TO "authenticated" USING ("public"."has_business_role"("business_id", ARRAY['owner'::"text", 'admin'::"text", 'staff'::"text"])) WITH CHECK ("public"."has_business_role"("business_id", ARRAY['owner'::"text", 'admin'::"text", 'staff'::"text"]));



CREATE POLICY "production verified products are public" ON "public"."products" FOR SELECT TO "authenticated", "anon" USING (("is_active" AND "is_verified" AND "available" AND ("stock" IS NOT NULL) AND ("stock" > 0) AND (EXISTS ( SELECT 1
   FROM "public"."businesses" "b"
  WHERE (("b"."id" = "products"."business_id") AND "b"."is_active" AND ("b"."status" = 'open'::"text") AND "b"."ordering_verified" AND "b"."ordering_enabled")))));



ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rider_delivery_issues" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rider_delivery_operations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rider_locations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rider_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."riders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."scanned_product_audit" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."service_health_signals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "session combos follow checkout session access" ON "public"."checkout_session_combos" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."checkout_sessions" "s"
  WHERE (("s"."id" = "checkout_session_combos"."checkout_session_id") AND (("s"."customer_id" = "auth"."uid"()) OR "public"."has_business_role"("s"."business_id", ARRAY['owner'::"text", 'admin'::"text"]))))));



ALTER TABLE "public"."staff_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stock_count_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stock_count_sessions" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."businesses";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."fiscal_documents";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."inventory_movements";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."notification_outbox";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."order_events";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."orders";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."pos_sales";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."product_barcodes";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."products";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."rider_locations";









GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";











































































































































































REVOKE ALL ON FUNCTION "public"."acknowledge_order"("p_order_id" "uuid", "p_expected_revision" bigint, "p_idempotency_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."acknowledge_order"("p_order_id" "uuid", "p_expected_revision" bigint, "p_idempotency_key" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."acknowledge_order"("p_order_id" "uuid", "p_expected_revision" bigint, "p_idempotency_key" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."apply_commercial_catalog_batch"("p_business_id" "uuid", "p_rows" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_commercial_catalog_batch"("p_business_id" "uuid", "p_rows" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."apply_commercial_catalog_batch"("p_business_id" "uuid", "p_rows" "jsonb") TO "authenticated";



GRANT ALL ON TABLE "public"."inventory_movements" TO "service_role";
GRANT SELECT ON TABLE "public"."inventory_movements" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."apply_inventory_movement"("p_business_id" "uuid", "p_product_id" "uuid", "p_barcode_id" "uuid", "p_movement_type" "text", "p_package_quantity" integer, "p_direction" integer, "p_reference_type" "text", "p_reference_id" "uuid", "p_reason" "text", "p_idempotency_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_inventory_movement"("p_business_id" "uuid", "p_product_id" "uuid", "p_barcode_id" "uuid", "p_movement_type" "text", "p_package_quantity" integer, "p_direction" integer, "p_reference_type" "text", "p_reference_id" "uuid", "p_reason" "text", "p_idempotency_key" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."apply_inventory_movement"("p_business_id" "uuid", "p_product_id" "uuid", "p_barcode_id" "uuid", "p_movement_type" "text", "p_package_quantity" integer, "p_direction" integer, "p_reference_type" "text", "p_reference_id" "uuid", "p_reason" "text", "p_idempotency_key" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."apply_pending_delivery_location"() TO "anon";
GRANT ALL ON FUNCTION "public"."apply_pending_delivery_location"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_pending_delivery_location"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."archive_current_customer_address"("p_address_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."archive_current_customer_address"("p_address_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."archive_current_customer_address"("p_address_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."assert_fiscal_execution_authorized"() TO "anon";
GRANT ALL ON FUNCTION "public"."assert_fiscal_execution_authorized"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."assert_fiscal_execution_authorized"() TO "service_role";



GRANT ALL ON FUNCTION "public"."assert_order_payment_modality"() TO "anon";
GRANT ALL ON FUNCTION "public"."assert_order_payment_modality"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."assert_order_payment_modality"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."assign_operation_correlation"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."assign_operation_correlation"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."assign_order_rider"("p_order_id" "uuid", "p_expected_status" "text", "p_expected_rider_user_id" "uuid", "p_new_rider_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."assign_order_rider"("p_order_id" "uuid", "p_expected_status" "text", "p_expected_rider_user_id" "uuid", "p_new_rider_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_order_rider"("p_order_id" "uuid", "p_expected_status" "text", "p_expected_rider_user_id" "uuid", "p_new_rider_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."authorize_arca_homologation"("p_business_id" "uuid", "p_authorization" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."authorize_arca_homologation"("p_business_id" "uuid", "p_authorization" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."authorize_arca_homologation"("p_business_id" "uuid", "p_authorization" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."authorize_fiscal_artifact_access"("p_artifact_id" "uuid", "p_action" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."authorize_fiscal_artifact_access"("p_artifact_id" "uuid", "p_action" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."authorize_fiscal_artifact_access"("p_artifact_id" "uuid", "p_action" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."build_operational_health"("p_business_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."build_operational_health"("p_business_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."bump_checkout_session_revision"() TO "anon";
GRANT ALL ON FUNCTION "public"."bump_checkout_session_revision"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."bump_checkout_session_revision"() TO "service_role";



GRANT ALL ON FUNCTION "public"."bump_order_revision"() TO "anon";
GRANT ALL ON FUNCTION "public"."bump_order_revision"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."bump_order_revision"() TO "service_role";



GRANT ALL ON FUNCTION "public"."bump_product_combo_revision"() TO "anon";
GRANT ALL ON FUNCTION "public"."bump_product_combo_revision"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."bump_product_combo_revision"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."business_command_request_hash"("p_command_type" "text", "p_order_id" "uuid", "p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."business_command_request_hash"("p_command_type" "text", "p_order_id" "uuid", "p_payload" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_access_order"("target_order_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_access_order"("target_order_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."can_access_order"("target_order_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_access_order"("target_order_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."can_recover_paid_checkout"("p_payment_intent_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_recover_paid_checkout"("p_payment_intent_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_recover_paid_checkout"("p_payment_intent_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cancel_order"("p_order_id" "uuid", "p_expected_revision" bigint, "p_reason" "text", "p_idempotency_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_order"("p_order_id" "uuid", "p_expected_revision" bigint, "p_reason" "text", "p_idempotency_key" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."cancel_order"("p_order_id" "uuid", "p_expected_revision" bigint, "p_reason" "text", "p_idempotency_key" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."catalog_asset_binding_sha256"("p_identity_sha256" "text", "p_kind" "text", "p_source_sha256" "text", "p_asset_sha256" "text", "p_width" integer, "p_height" integer, "p_path" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."catalog_asset_binding_sha256"("p_identity_sha256" "text", "p_kind" "text", "p_source_sha256" "text", "p_asset_sha256" "text", "p_width" integer, "p_height" integer, "p_path" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."catalog_asset_binding_sha256"("p_identity_sha256" "text", "p_kind" "text", "p_source_sha256" "text", "p_asset_sha256" "text", "p_width" integer, "p_height" integer, "p_path" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."catalog_asset_path"("p_safe_sku" "text", "p_identity_sha256" "text", "p_kind" "text", "p_asset_sha256" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."catalog_asset_path"("p_safe_sku" "text", "p_identity_sha256" "text", "p_kind" "text", "p_asset_sha256" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."catalog_asset_path"("p_safe_sku" "text", "p_identity_sha256" "text", "p_kind" "text", "p_asset_sha256" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."catalog_image_identity_sha256"("p_external_id" "text", "p_sku" "text", "p_source_sha256" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."catalog_image_identity_sha256"("p_external_id" "text", "p_sku" "text", "p_source_sha256" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."catalog_image_identity_sha256"("p_external_id" "text", "p_sku" "text", "p_source_sha256" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."change_order_status"("p_order_id" "uuid", "p_expected_status" "text", "p_new_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."change_order_status"("p_order_id" "uuid", "p_expected_status" "text", "p_new_status" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."change_order_status"("p_order_id" "uuid", "p_expected_status" "text", "p_new_status" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."check_scheduler_watchdog"("p_source" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_scheduler_watchdog"("p_source" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."check_scheduler_watchdog"("p_source" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_scheduler_watchdog"("p_source" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."checkout_pipeline_state"("p_session_status" "text", "p_expires_at" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."checkout_pipeline_state"("p_session_status" "text", "p_expires_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."checkout_pipeline_state"("p_session_status" "text", "p_expires_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."checkout_pos_sale"("p_business_id" "uuid", "p_items" "jsonb", "p_payment_method" "text", "p_idempotency_key" "text", "p_request_fiscal" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."checkout_pos_sale"("p_business_id" "uuid", "p_items" "jsonb", "p_payment_method" "text", "p_idempotency_key" "text", "p_request_fiscal" boolean) TO "service_role";
GRANT ALL ON FUNCTION "public"."checkout_pos_sale"("p_business_id" "uuid", "p_items" "jsonb", "p_payment_method" "text", "p_idempotency_key" "text", "p_request_fiscal" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."checkout_session_customer_payload"("p_checkout_session_id" "uuid", "p_customer_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."checkout_session_customer_payload"("p_checkout_session_id" "uuid", "p_customer_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."checkout_session_status_rank"("p_status" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."checkout_session_status_rank"("p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."checkout_session_status_rank"("p_status" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_available_rider_order"("p_business_id" "uuid", "p_public_code" "text", "p_expected_revision" bigint, "p_expected_status" "text", "p_expected_rider_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_available_rider_order"("p_business_id" "uuid", "p_public_code" "text", "p_expected_revision" bigint, "p_expected_status" "text", "p_expected_rider_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_delivery_order"("p_business_id" "uuid", "p_public_code" "text", "p_expected_revision" bigint, "p_idempotency_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_delivery_order"("p_business_id" "uuid", "p_public_code" "text", "p_expected_revision" bigint, "p_idempotency_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_delivery_order"("p_business_id" "uuid", "p_public_code" "text", "p_expected_revision" bigint, "p_idempotency_key" "text") TO "service_role";



GRANT ALL ON TABLE "public"."fiscal_artifact_outbox" TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_fiscal_artifact_outbox"("p_worker_id" "text", "p_limit" integer, "p_lease_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_fiscal_artifact_outbox"("p_worker_id" "text", "p_limit" integer, "p_lease_seconds" integer) TO "service_role";



GRANT ALL ON TABLE "public"."fiscal_outbox" TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_fiscal_outbox"("p_worker_id" "text", "p_limit" integer, "p_lease_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_fiscal_outbox"("p_worker_id" "text", "p_limit" integer, "p_lease_seconds" integer) TO "service_role";



GRANT ALL ON TABLE "public"."payment_outbox" TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_payment_outbox"("p_owner" "text", "p_limit" integer, "p_lease_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_payment_outbox"("p_owner" "text", "p_limit" integer, "p_lease_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."classify_checkout_session_qa_origin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."classify_checkout_session_qa_origin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."classify_order_as_qa"("p_order_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."classify_order_as_qa"("p_order_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."classify_order_as_qa"("p_order_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."classify_order_qa_origin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."classify_order_qa_origin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."close_daily_reconciliation"("p_reconciliation_id" "uuid", "p_expected_revision" bigint, "p_idempotency_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."close_daily_reconciliation"("p_reconciliation_id" "uuid", "p_expected_revision" bigint, "p_idempotency_key" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."close_daily_reconciliation"("p_reconciliation_id" "uuid", "p_expected_revision" bigint, "p_idempotency_key" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."complete_fiscal_artifact"("p_artifact_outbox_id" "uuid", "p_worker_id" "text", "p_artifact" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_fiscal_artifact"("p_artifact_outbox_id" "uuid", "p_worker_id" "text", "p_artifact" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_fiscal_artifact_unchecked"("p_artifact_outbox_id" "uuid", "p_worker_id" "text", "p_artifact" "jsonb") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."complete_fiscal_attempt"("p_outbox_id" "uuid", "p_worker_id" "text", "p_result" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_fiscal_attempt"("p_outbox_id" "uuid", "p_worker_id" "text", "p_result" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_payment_outbox_job"("p_job_id" "uuid", "p_owner" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_payment_outbox_job"("p_job_id" "uuid", "p_owner" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_scanned_product"("p_product_id" "uuid", "p_details" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_scanned_product"("p_product_id" "uuid", "p_details" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."complete_scanned_product"("p_product_id" "uuid", "p_details" "jsonb") TO "service_role";



GRANT ALL ON TABLE "public"."fiscal_profiles" TO "service_role";
GRANT SELECT ON TABLE "public"."fiscal_profiles" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."configure_fiscal_profile"("p_business_id" "uuid", "p_profile" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."configure_fiscal_profile"("p_business_id" "uuid", "p_profile" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."configure_fiscal_profile"("p_business_id" "uuid", "p_profile" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."configure_mercadopago_settings"("p_business_id" "uuid", "p_settings" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."configure_mercadopago_settings"("p_business_id" "uuid", "p_settings" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."configure_mercadopago_settings"("p_business_id" "uuid", "p_settings" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."confirm_delivery_code"("p_order_id" "uuid", "p_expected_revision" bigint, "p_delivery_code" "text", "p_idempotency_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirm_delivery_code"("p_order_id" "uuid", "p_expected_revision" bigint, "p_delivery_code" "text", "p_idempotency_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."confirm_delivery_code"("p_order_id" "uuid", "p_expected_revision" bigint, "p_delivery_code" "text", "p_idempotency_key" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."confirm_order_delivery"("p_order_id" "uuid", "p_expected_status" "text", "p_delivery_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirm_order_delivery"("p_order_id" "uuid", "p_expected_status" "text", "p_delivery_code" "text") TO "service_role";



GRANT ALL ON TABLE "public"."order_packing_sessions" TO "service_role";
GRANT SELECT ON TABLE "public"."order_packing_sessions" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."confirm_packing_session"("p_session_id" "uuid", "p_exception_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirm_packing_session"("p_session_id" "uuid", "p_exception_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."confirm_packing_session_once"("p_session_id" "uuid", "p_exception_reason" "text", "p_idempotency_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirm_packing_session_once"("p_session_id" "uuid", "p_exception_reason" "text", "p_idempotency_key" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."confirm_packing_session_once"("p_session_id" "uuid", "p_exception_reason" "text", "p_idempotency_key" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."consume_payment_rate_limit"("p_scope" "text", "p_subject_hash" "text", "p_limit" integer, "p_window_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."consume_payment_rate_limit"("p_scope" "text", "p_subject_hash" "text", "p_limit" integer, "p_window_seconds" integer) TO "service_role";



GRANT ALL ON TABLE "public"."catalog_product_drafts" TO "service_role";
GRANT SELECT ON TABLE "public"."catalog_product_drafts" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_catalog_product_draft"("p_business_id" "uuid", "p_gtin" "text", "p_suggestion" "jsonb", "p_idempotency_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_catalog_product_draft"("p_business_id" "uuid", "p_gtin" "text", "p_suggestion" "jsonb", "p_idempotency_key" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."create_catalog_product_draft"("p_business_id" "uuid", "p_gtin" "text", "p_suggestion" "jsonb", "p_idempotency_key" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_checkout_session"("p_customer_id" "uuid", "p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_checkout_session"("p_customer_id" "uuid", "p_payload" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_order_with_items"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_order_with_items"("payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_order_with_items"("payload" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_order_with_items_core"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_order_with_items_core"("payload" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_order_with_items_legacy"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_order_with_items_legacy"("payload" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_order_with_items_profile_v1"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_order_with_items_profile_v1"("payload" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_order_with_items_profile_v2"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_order_with_items_profile_v2"("payload" "jsonb") TO "service_role";



GRANT ALL ON TABLE "public"."customer_addresses" TO "service_role";
GRANT SELECT ON TABLE "public"."customer_addresses" TO "authenticated";



GRANT ALL ON FUNCTION "public"."customer_address_json"("p_address" "public"."customer_addresses") TO "anon";
GRANT ALL ON FUNCTION "public"."customer_address_json"("p_address" "public"."customer_addresses") TO "authenticated";
GRANT ALL ON FUNCTION "public"."customer_address_json"("p_address" "public"."customer_addresses") TO "service_role";



REVOKE ALL ON FUNCTION "public"."daily_reconciliation_snapshot_internal"("p_business_id" "uuid", "p_window_start" timestamp with time zone, "p_window_end" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."daily_reconciliation_snapshot_internal"("p_business_id" "uuid", "p_window_start" timestamp with time zone, "p_window_end" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."delivery_location_address_fingerprint"("p_value" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."delivery_location_address_fingerprint"("p_value" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delivery_location_address_fingerprint"("p_value" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."delivery_location_address_fingerprint"("p_street" "text", "p_street_number" "text", "p_city" "text", "p_province" "text", "p_postal_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."delivery_location_address_fingerprint"("p_street" "text", "p_street_number" "text", "p_city" "text", "p_province" "text", "p_postal_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delivery_location_address_fingerprint"("p_street" "text", "p_street_number" "text", "p_city" "text", "p_province" "text", "p_postal_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."dispatch_payment_outbox_worker"("p_source" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."dispatch_payment_outbox_worker"("p_source" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_confirmed_delivery_location"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_confirmed_delivery_location"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_confirmed_delivery_location"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enqueue_authorized_fiscal_artifact"() TO "anon";
GRANT ALL ON FUNCTION "public"."enqueue_authorized_fiscal_artifact"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enqueue_authorized_fiscal_artifact"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."enqueue_checkout_provider_probes"("p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enqueue_checkout_provider_probes"("p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."enqueue_new_order_notification"() TO "anon";
GRANT ALL ON FUNCTION "public"."enqueue_new_order_notification"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enqueue_new_order_notification"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."enqueue_payment_reconciliation"("p_payment_intent_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enqueue_payment_reconciliation"("p_payment_intent_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."enqueue_payment_reconciliation"("p_payment_intent_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."evaluate_operational_alerts_sweep"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."evaluate_operational_alerts_sweep"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."expire_checkout_sessions"("p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."expire_checkout_sessions"("p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fail_close_business_whatsapp_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fail_close_business_whatsapp_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fail_close_verified_product_master_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fail_close_verified_product_master_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fail_fiscal_artifact"("p_artifact_outbox_id" "uuid", "p_worker_id" "text", "p_error_code" "text", "p_error_message" "text", "p_retryable" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fail_fiscal_artifact"("p_artifact_outbox_id" "uuid", "p_worker_id" "text", "p_error_code" "text", "p_error_message" "text", "p_retryable" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fail_payment_outbox_job"("p_job_id" "uuid", "p_owner" "text", "p_error_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fail_payment_outbox_job"("p_job_id" "uuid", "p_owner" "text", "p_error_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_paid_checkout_session"("p_checkout_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_paid_checkout_session"("p_checkout_session_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."find_payment_intent_by_external_reference"("p_environment" "text", "p_external_reference" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."find_payment_intent_by_external_reference"("p_environment" "text", "p_external_reference" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fiscal_artifact_storage_path"("p_business_id" "uuid", "p_document_id" "uuid", "p_generation_token" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fiscal_artifact_storage_path"("p_business_id" "uuid", "p_document_id" "uuid", "p_generation_token" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fiscal_has_current_parameter_id"("p_environment" "text", "p_parameter_type" "text", "p_id" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fiscal_has_current_parameter_id"("p_environment" "text", "p_parameter_type" "text", "p_id" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fiscal_json_contains_parameter_id"("p_value" "jsonb", "p_id" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fiscal_json_contains_parameter_id"("p_value" "jsonb", "p_id" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_active_rider_delivery"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_active_rider_delivery"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_active_rider_delivery"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_arca_activation_status"("p_business_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_arca_activation_status"("p_business_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_arca_activation_status"("p_business_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_business_opening_status"("p_business_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_business_opening_status"("p_business_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_business_opening_status"("p_business_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_checkout_session_for_customer"("p_checkout_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_checkout_session_for_customer"("p_checkout_session_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_checkout_session_for_customer"("p_checkout_session_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_current_customer_profile"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_current_customer_profile"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_current_customer_profile"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_mercadopago_activation_status"("p_business_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_mercadopago_activation_status"("p_business_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_mercadopago_activation_status"("p_business_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_mercadopago_checkout_availability"("p_business_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_mercadopago_checkout_availability"("p_business_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_mercadopago_checkout_availability"("p_business_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_operational_health"("p_business_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_operational_health"("p_business_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_operational_health"("p_business_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_packing_manifest"("p_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_packing_manifest"("p_session_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."get_packing_manifest"("p_session_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_production_operation_center"("p_business_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_production_operation_center"("p_business_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."get_production_operation_center"("p_business_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_public_business_contact"("p_business_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_public_business_contact"("p_business_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."get_public_business_contact"("p_business_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_business_contact"("p_business_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_public_order_tracking"("p_public_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_public_order_tracking"("p_public_id" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."get_public_order_tracking"("p_public_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_order_tracking"("p_public_id" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_rider_queue"("p_business_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_rider_queue"("p_business_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_rider_queue"("p_business_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_scanned_product_readiness"("p_product_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_scanned_product_readiness"("p_product_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_scanned_product_readiness"("p_product_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtin_check_digit_valid"("p_gtin" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."gtin_check_digit_valid"("p_gtin" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtin_check_digit_valid"("p_gtin" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."has_business_role"("target_business_id" "uuid", "roles" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."has_business_role"("target_business_id" "uuid", "roles" "text"[]) TO "service_role";
GRANT ALL ON FUNCTION "public"."has_business_role"("target_business_id" "uuid", "roles" "text"[]) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."identity_accept_invitation"("p_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."identity_accept_invitation"("p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."identity_accept_invitation"("p_token" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."identity_assert_can_administer_member"("p_business_id" "uuid", "p_target_user_id" "uuid", "p_permission" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."identity_assert_can_administer_member"("p_business_id" "uuid", "p_target_user_id" "uuid", "p_permission" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."identity_assert_profile_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."identity_assert_profile_role"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."identity_audit_is_append_only"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."identity_audit_is_append_only"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."identity_close_own_session"("p_business_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."identity_close_own_session"("p_business_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."identity_close_own_session"("p_business_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."identity_count_active_owners"("p_business_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."identity_count_active_owners"("p_business_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."identity_create_invitation"("p_business_id" "uuid", "p_email" "text", "p_role" "text", "p_full_name" "text", "p_valid_for" interval) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."identity_create_invitation"("p_business_id" "uuid", "p_email" "text", "p_role" "text", "p_full_name" "text", "p_valid_for" interval) TO "authenticated";
GRANT ALL ON FUNCTION "public"."identity_create_invitation"("p_business_id" "uuid", "p_email" "text", "p_role" "text", "p_full_name" "text", "p_valid_for" interval) TO "service_role";



REVOKE ALL ON FUNCTION "public"."identity_current_context"("p_business_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."identity_current_context"("p_business_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."identity_current_context"("p_business_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."identity_guard_membership_write"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."identity_guard_membership_write"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."identity_has_permission"("target_business_id" "uuid", "target_permission" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."identity_has_permission"("target_business_id" "uuid", "target_permission" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."identity_has_permission"("target_business_id" "uuid", "target_permission" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."identity_is_anonymous"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."identity_is_anonymous"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."identity_jwt_claims"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."identity_jwt_claims"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."identity_kill_auth_session"("p_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."identity_kill_auth_session"("p_session_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."identity_kill_auth_sessions_for_user"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."identity_kill_auth_sessions_for_user"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."identity_list_audit_events"("p_business_id" "uuid", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."identity_list_audit_events"("p_business_id" "uuid", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."identity_list_audit_events"("p_business_id" "uuid", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."identity_list_invitations"("p_business_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."identity_list_invitations"("p_business_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."identity_list_invitations"("p_business_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."identity_list_members"("p_business_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."identity_list_members"("p_business_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."identity_list_members"("p_business_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."identity_list_sessions"("p_business_id" "uuid", "p_user_id" "uuid", "p_include_revoked" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."identity_list_sessions"("p_business_id" "uuid", "p_user_id" "uuid", "p_include_revoked" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."identity_list_sessions"("p_business_id" "uuid", "p_user_id" "uuid", "p_include_revoked" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."identity_member_role"("target_business_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."identity_member_role"("target_business_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."identity_member_role"("target_business_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."identity_record_audit_event"("p_event_type" "text", "p_business_id" "uuid", "p_actor_user_id" "uuid", "p_actor_role" "text", "p_subject_user_id" "uuid", "p_session_id" "uuid", "p_metadata" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."identity_record_audit_event"("p_event_type" "text", "p_business_id" "uuid", "p_actor_user_id" "uuid", "p_actor_role" "text", "p_subject_user_id" "uuid", "p_session_id" "uuid", "p_metadata" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."identity_register_session"("p_business_id" "uuid", "p_client" "text", "p_device_label" "text", "p_device_key_hash" "text", "p_app_version" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."identity_register_session"("p_business_id" "uuid", "p_client" "text", "p_device_label" "text", "p_device_key_hash" "text", "p_app_version" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."identity_register_session"("p_business_id" "uuid", "p_client" "text", "p_device_label" "text", "p_device_key_hash" "text", "p_app_version" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."identity_require_permission"("target_business_id" "uuid", "target_permission" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."identity_require_permission"("target_business_id" "uuid", "target_permission" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."identity_revoke_all_sessions"("p_business_id" "uuid", "p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."identity_revoke_all_sessions"("p_business_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."identity_revoke_all_sessions"("p_business_id" "uuid", "p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."identity_revoke_invitation"("p_invitation_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."identity_revoke_invitation"("p_invitation_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."identity_revoke_invitation"("p_invitation_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."identity_revoke_session"("p_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."identity_revoke_session"("p_session_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."identity_revoke_session"("p_session_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."identity_session_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."identity_session_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."identity_set_member_active"("p_business_id" "uuid", "p_user_id" "uuid", "p_is_active" boolean, "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."identity_set_member_active"("p_business_id" "uuid", "p_user_id" "uuid", "p_is_active" boolean, "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."identity_set_member_active"("p_business_id" "uuid", "p_user_id" "uuid", "p_is_active" boolean, "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."identity_set_member_role"("p_business_id" "uuid", "p_user_id" "uuid", "p_role" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."identity_set_member_role"("p_business_id" "uuid", "p_user_id" "uuid", "p_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."identity_set_member_role"("p_business_id" "uuid", "p_user_id" "uuid", "p_role" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."identity_token_issued_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."identity_token_issued_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."identity_touch_session"("p_business_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."identity_touch_session"("p_business_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."identity_touch_session"("p_business_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."import_catalog_batch"("p_business_id" "uuid", "p_assets" "jsonb", "p_products" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."import_catalog_batch"("p_business_id" "uuid", "p_assets" "jsonb", "p_products" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."import_catalog_batch"("p_business_id" "uuid", "p_assets" "jsonb", "p_products" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."import_qa_fixture_catalog"("p_business_id" "uuid", "p_origin" "text", "p_assets" "jsonb", "p_products" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."import_qa_fixture_catalog"("p_business_id" "uuid", "p_origin" "text", "p_assets" "jsonb", "p_products" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."import_qa_fixture_catalog"("p_business_id" "uuid", "p_origin" "text", "p_assets" "jsonb", "p_products" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."is_assigned_rider"("target_order_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_assigned_rider"("target_order_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."is_assigned_rider"("target_order_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."is_business_member"("target_business_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_business_member"("target_business_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."is_business_member"("target_business_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."issue_order_delivery_code"("p_order_id" "uuid", "p_tracking_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."issue_order_delivery_code"("p_order_id" "uuid", "p_tracking_token" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."issue_order_delivery_code"("p_order_id" "uuid", "p_tracking_token" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."kick_payment_outbox_worker"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kick_payment_outbox_worker"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."kick_scheduler_watchdog"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kick_scheduler_watchdog"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_active_business_riders"("p_business_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_active_business_riders"("p_business_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."list_active_business_riders"("p_business_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."list_available_rider_orders"("p_business_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_available_rider_orders"("p_business_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_available_rider_orders"("p_business_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_business_combos"("p_business_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_business_combos"("p_business_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."list_business_combos"("p_business_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_business_combos"("p_business_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_business_payments"("p_business_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_business_payments"("p_business_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_business_payments"("p_business_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."list_fiscal_document_artifacts"("p_business_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."list_fiscal_document_artifacts"("p_business_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_fiscal_document_artifacts"("p_business_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_operational_pipeline"("p_business_id" "uuid", "p_include_qa" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_operational_pipeline"("p_business_id" "uuid", "p_include_qa" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_operational_pipeline"("p_business_id" "uuid", "p_include_qa" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_operational_secret_status"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_operational_secret_status"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_payment_outbox_operational_alerts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_payment_outbox_operational_alerts"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_scheduler_health"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_scheduler_health"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_stock_reservation_alerts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_stock_reservation_alerts"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_unfinalized_paid_checkouts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_unfinalized_paid_checkouts"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_webhook_signature_alerts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_webhook_signature_alerts"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_order_status_event"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_order_status_event"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_delivery_picked_up"("p_order_id" "uuid", "p_expected_revision" bigint, "p_idempotency_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_delivery_picked_up"("p_order_id" "uuid", "p_expected_revision" bigint, "p_idempotency_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_delivery_picked_up"("p_order_id" "uuid", "p_expected_revision" bigint, "p_idempotency_key" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_payment_cancellation_ambiguous"("p_cancellation_id" "uuid", "p_request_hash" "text", "p_error_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_payment_cancellation_ambiguous"("p_cancellation_id" "uuid", "p_request_hash" "text", "p_error_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_payment_refund_ambiguous"("p_refund_id" "uuid", "p_request_hash" "text", "p_error_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_payment_refund_ambiguous"("p_refund_id" "uuid", "p_request_hash" "text", "p_error_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_rider_arrived"("p_order_id" "uuid", "p_expected_revision" bigint, "p_idempotency_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_rider_arrived"("p_order_id" "uuid", "p_expected_revision" bigint, "p_idempotency_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_rider_arrived"("p_order_id" "uuid", "p_expected_revision" bigint, "p_idempotency_key" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."next_order_public_code"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."next_order_public_code"() TO "service_role";



GRANT ALL ON FUNCTION "public"."normalize_customer_address_text"("p_value" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."normalize_customer_address_text"("p_value" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_customer_address_text"("p_value" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."normalize_order_status_vocabulary"("p_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."normalize_order_status_vocabulary"("p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_order_status_vocabulary"("p_status" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."order_pipeline_state"("p_order_status" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."order_pipeline_state"("p_order_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."order_pipeline_state"("p_order_status" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."payment_internal_status_rank"("p_status" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."payment_internal_status_rank"("p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."payment_internal_status_rank"("p_status" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."prepare_daily_reconciliation"("p_business_id" "uuid", "p_business_date" "date", "p_timezone" "text", "p_declared_cash" numeric, "p_difference_note" "text", "p_idempotency_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prepare_daily_reconciliation"("p_business_id" "uuid", "p_business_date" "date", "p_timezone" "text", "p_declared_cash" numeric, "p_difference_note" "text", "p_idempotency_key" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."prepare_daily_reconciliation"("p_business_id" "uuid", "p_business_date" "date", "p_timezone" "text", "p_declared_cash" numeric, "p_difference_note" "text", "p_idempotency_key" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."prepare_mercadopago_preference"("p_checkout_session_id" "uuid", "p_customer_id" "uuid", "p_new_attempt" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prepare_mercadopago_preference"("p_checkout_session_id" "uuid", "p_customer_id" "uuid", "p_new_attempt" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."prepare_payment_cancellation"("p_payment_intent_id" "uuid", "p_idempotency_key" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prepare_payment_cancellation"("p_payment_intent_id" "uuid", "p_idempotency_key" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."prepare_payment_cancellation"("p_payment_intent_id" "uuid", "p_idempotency_key" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."prepare_payment_refund"("p_payment_intent_id" "uuid", "p_amount" numeric, "p_idempotency_key" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prepare_payment_refund"("p_payment_intent_id" "uuid", "p_amount" numeric, "p_idempotency_key" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."prepare_payment_refund"("p_payment_intent_id" "uuid", "p_amount" numeric, "p_idempotency_key" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."prevent_closed_daily_reconciliation_mutation"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prevent_closed_daily_reconciliation_mutation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_inventory_movement_mutation"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_inventory_movement_mutation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_inventory_movement_mutation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_payment_intent_status_regression"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_payment_intent_status_regression"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_payment_intent_status_regression"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."prevent_rider_unverified_delivery"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prevent_rider_unverified_delivery"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_unverified_delivery"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_unverified_delivery"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_unverified_delivery"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."product_commercial_state"("p_price_status" "text", "p_price" numeric, "p_stock" integer, "p_is_active" boolean, "p_is_verified" boolean, "p_available" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."product_commercial_state"("p_price_status" "text", "p_price" numeric, "p_stock" integer, "p_is_active" boolean, "p_is_verified" boolean, "p_available" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."product_commercial_state"("p_price_status" "text", "p_price" numeric, "p_stock" integer, "p_is_active" boolean, "p_is_verified" boolean, "p_available" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."product_is_qa_fixture"("p_product_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."product_is_qa_fixture"("p_product_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."product_is_qa_fixture"("p_product_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."propagate_paid_order_correlation"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."propagate_paid_order_correlation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."protect_authorized_fiscal_document"() TO "anon";
GRANT ALL ON FUNCTION "public"."protect_authorized_fiscal_document"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."protect_authorized_fiscal_document"() TO "service_role";



GRANT ALL ON FUNCTION "public"."protect_authorized_fiscal_document_item"() TO "anon";
GRANT ALL ON FUNCTION "public"."protect_authorized_fiscal_document_item"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."protect_authorized_fiscal_document_item"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."publish_catalog_product"("p_business_id" "uuid", "p_external_id" "text", "p_available" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."publish_catalog_product"("p_business_id" "uuid", "p_external_id" "text", "p_available" boolean) TO "service_role";
GRANT ALL ON FUNCTION "public"."publish_catalog_product"("p_business_id" "uuid", "p_external_id" "text", "p_available" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."publish_catalog_product_draft"("p_draft_id" "uuid", "p_name" "text", "p_category" "text", "p_price" numeric, "p_package_type" "text", "p_unit_factor" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."publish_catalog_product_draft"("p_draft_id" "uuid", "p_name" "text", "p_category" "text", "p_price" numeric, "p_package_type" "text", "p_unit_factor" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."publish_catalog_product_draft"("p_draft_id" "uuid", "p_name" "text", "p_category" "text", "p_price" numeric, "p_package_type" "text", "p_unit_factor" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."publish_qa_fixture_product"("p_business_id" "uuid", "p_external_id" "text", "p_available" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."publish_qa_fixture_product"("p_business_id" "uuid", "p_external_id" "text", "p_available" boolean) TO "service_role";
GRANT ALL ON FUNCTION "public"."publish_qa_fixture_product"("p_business_id" "uuid", "p_external_id" "text", "p_available" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."publish_rider_location"("p_order_id" "uuid", "p_expected_revision" bigint, "p_lat" double precision, "p_lng" double precision, "p_accuracy" double precision, "p_heading" double precision, "p_speed" double precision, "p_captured_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."publish_rider_location"("p_order_id" "uuid", "p_expected_revision" bigint, "p_lat" double precision, "p_lng" double precision, "p_accuracy" double precision, "p_heading" double precision, "p_speed" double precision, "p_captured_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."publish_rider_location_receipt"("p_order_id" "uuid", "p_expected_revision" bigint, "p_lat" double precision, "p_lng" double precision, "p_accuracy" double precision, "p_heading" double precision, "p_speed" double precision, "p_captured_at" timestamp with time zone, "p_idempotency_key" "text", "p_is_mock" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."publish_rider_location_receipt"("p_order_id" "uuid", "p_expected_revision" bigint, "p_lat" double precision, "p_lng" double precision, "p_accuracy" double precision, "p_heading" double precision, "p_speed" double precision, "p_captured_at" timestamp with time zone, "p_idempotency_key" "text", "p_is_mock" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."publish_rider_location_receipt"("p_order_id" "uuid", "p_expected_revision" bigint, "p_lat" double precision, "p_lng" double precision, "p_accuracy" double precision, "p_heading" double precision, "p_speed" double precision, "p_captured_at" timestamp with time zone, "p_idempotency_key" "text", "p_is_mock" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."purge_terminal_order_rider_locations"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."purge_terminal_order_rider_locations"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."reacquire_checkout_session_inventory"("p_checkout_session_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reacquire_checkout_session_inventory"("p_checkout_session_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reconcile_operational_alerts_for_business"("p_business_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reconcile_operational_alerts_for_business"("p_business_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_fiscal_credential_health"("p_business_id" "uuid", "p_certificate_fingerprint" "text", "p_certificate_expires_at" timestamp with time zone, "p_certificate_subject_cuit" "text", "p_delegation_status" "text", "p_connection_ok" boolean, "p_error_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_fiscal_credential_health"("p_business_id" "uuid", "p_certificate_fingerprint" "text", "p_certificate_expires_at" timestamp with time zone, "p_certificate_subject_cuit" "text", "p_delegation_status" "text", "p_connection_ok" boolean, "p_error_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_fiscal_verification"("p_business_id" "uuid", "p_verification" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_fiscal_verification"("p_business_id" "uuid", "p_verification" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_fiscal_verification"("p_business_id" "uuid", "p_verification" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_mercadopago_dispute_snapshot"("p_payment_intent_id" "uuid", "p_dispute_type" "text", "p_snapshot" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_mercadopago_dispute_snapshot"("p_payment_intent_id" "uuid", "p_dispute_type" "text", "p_snapshot" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_mercadopago_payment_snapshot"("p_payment_intent_id" "uuid", "p_snapshot" "jsonb", "p_source" "text", "p_webhook_receipt_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_mercadopago_payment_snapshot"("p_payment_intent_id" "uuid", "p_snapshot" "jsonb", "p_source" "text", "p_webhook_receipt_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_mercadopago_preference_created"("p_payment_attempt_id" "uuid", "p_preference_id" "text", "p_init_point" "text", "p_sandbox_init_point" "text", "p_response_hash" "text", "p_provider_request_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_mercadopago_preference_created"("p_payment_attempt_id" "uuid", "p_preference_id" "text", "p_init_point" "text", "p_sandbox_init_point" "text", "p_response_hash" "text", "p_provider_request_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_mercadopago_preference_failed"("p_payment_attempt_id" "uuid", "p_response_hash" "text", "p_error_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_mercadopago_preference_failed"("p_payment_attempt_id" "uuid", "p_response_hash" "text", "p_error_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_mercadopago_preference_uncertain"("p_payment_attempt_id" "uuid", "p_request_hash" "text", "p_error_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_mercadopago_preference_uncertain"("p_payment_attempt_id" "uuid", "p_request_hash" "text", "p_error_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_mercadopago_webhook_receipt"("p_environment" "text", "p_webhook_event_id" "text", "p_event_type" "text", "p_resource_id" "text", "p_signature_valid" boolean, "p_request_id" "text", "p_payload_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_mercadopago_webhook_receipt"("p_environment" "text", "p_webhook_event_id" "text", "p_event_type" "text", "p_resource_id" "text", "p_signature_valid" boolean, "p_request_id" "text", "p_payload_hash" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_packing_scan"("p_session_id" "uuid", "p_gtin" "text", "p_scan_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_packing_scan"("p_session_id" "uuid", "p_gtin" "text", "p_scan_key" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."record_packing_scan"("p_session_id" "uuid", "p_gtin" "text", "p_scan_key" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."record_payment_cancellation_response"("p_cancellation_id" "uuid", "p_status" "text", "p_response_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_payment_cancellation_response"("p_cancellation_id" "uuid", "p_status" "text", "p_response_hash" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_payment_refund_response"("p_refund_id" "uuid", "p_provider_refund_id" "text", "p_status" "text", "p_amount" numeric, "p_response_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_payment_refund_response"("p_refund_id" "uuid", "p_provider_refund_id" "text", "p_status" "text", "p_amount" numeric, "p_response_hash" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_provider_probe_empty"("p_payment_intent_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_provider_probe_empty"("p_payment_intent_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_service_health_signal"("p_business_id" "uuid", "p_service" "text", "p_severity" "text", "p_signal_code" "text", "p_status" "text", "p_correlation_id" "uuid", "p_observed_at" timestamp with time zone, "p_expires_at" timestamp with time zone, "p_details" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_service_health_signal"("p_business_id" "uuid", "p_service" "text", "p_severity" "text", "p_signal_code" "text", "p_status" "text", "p_correlation_id" "uuid", "p_observed_at" timestamp with time zone, "p_expires_at" timestamp with time zone, "p_details" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."recover_order_tracking_access"("p_order_id" "uuid", "p_new_tracking_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."recover_order_tracking_access"("p_order_id" "uuid", "p_new_tracking_token" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."recover_order_tracking_access"("p_order_id" "uuid", "p_new_tracking_token" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."recover_paid_checkout_order"("p_checkout_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."recover_paid_checkout_order"("p_checkout_session_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."recover_paid_checkout_order"("p_checkout_session_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."refresh_operational_alerts"("p_business_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."refresh_operational_alerts"("p_business_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."refresh_operational_alerts"("p_business_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."register_catalog_assets"("p_business_id" "uuid", "p_assets" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."register_catalog_assets"("p_business_id" "uuid", "p_assets" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."release_checkout_session_inventory"("p_checkout_session_id" "uuid", "p_reason" "text", "p_terminal_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."release_checkout_session_inventory"("p_checkout_session_id" "uuid", "p_reason" "text", "p_terminal_status" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."release_expired_stock_reservations"("p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."release_expired_stock_reservations"("p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."release_or_reassign_delivery"("p_order_id" "uuid", "p_expected_revision" bigint, "p_new_rider_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."release_or_reassign_delivery"("p_order_id" "uuid", "p_expected_revision" bigint, "p_new_rider_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."release_or_reassign_delivery"("p_order_id" "uuid", "p_expected_revision" bigint, "p_new_rider_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."report_rider_delivery_issue"("p_order_id" "uuid", "p_expected_revision" bigint, "p_issue_type" "text", "p_idempotency_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."report_rider_delivery_issue"("p_order_id" "uuid", "p_expected_revision" bigint, "p_issue_type" "text", "p_idempotency_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."report_rider_delivery_issue"("p_order_id" "uuid", "p_expected_revision" bigint, "p_issue_type" "text", "p_idempotency_key" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."request_credit_note"("p_original_document_id" "uuid", "p_reason" "text", "p_credit_kind" "text", "p_lines" "jsonb", "p_idempotency_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."request_credit_note"("p_original_document_id" "uuid", "p_reason" "text", "p_credit_kind" "text", "p_lines" "jsonb", "p_idempotency_key" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."request_credit_note"("p_original_document_id" "uuid", "p_reason" "text", "p_credit_kind" "text", "p_lines" "jsonb", "p_idempotency_key" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."request_credit_note_unchecked"("p_original_document_id" "uuid", "p_reason" "text", "p_credit_kind" "text", "p_lines" "jsonb", "p_idempotency_key" "text") FROM PUBLIC;



GRANT ALL ON FUNCTION "public"."request_fiscal_artifact_regeneration"("p_fiscal_document_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."request_fiscal_artifact_regeneration"("p_fiscal_document_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."request_fiscal_artifact_regeneration"("p_fiscal_document_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."request_fiscal_document"("p_business_id" "uuid", "p_source_type" "text", "p_source_id" "uuid", "p_document_intent" "text", "p_idempotency_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."request_fiscal_document"("p_business_id" "uuid", "p_source_type" "text", "p_source_id" "uuid", "p_document_intent" "text", "p_idempotency_key" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."request_fiscal_document"("p_business_id" "uuid", "p_source_type" "text", "p_source_id" "uuid", "p_document_intent" "text", "p_idempotency_key" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."request_fiscal_print_job"("p_fiscal_document_id" "uuid", "p_artifact_id" "uuid", "p_printer_name_hash" "text", "p_format" "text", "p_copies" integer, "p_idempotency_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."request_fiscal_print_job"("p_fiscal_document_id" "uuid", "p_artifact_id" "uuid", "p_printer_name_hash" "text", "p_format" "text", "p_copies" integer, "p_idempotency_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."request_fiscal_print_job"("p_fiscal_document_id" "uuid", "p_artifact_id" "uuid", "p_printer_name_hash" "text", "p_format" "text", "p_copies" integer, "p_idempotency_key" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."request_full_credit_note"("p_original_document_id" "uuid", "p_reason" "text", "p_idempotency_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."request_full_credit_note"("p_original_document_id" "uuid", "p_reason" "text", "p_idempotency_key" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."request_full_credit_note"("p_original_document_id" "uuid", "p_reason" "text", "p_idempotency_key" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."request_order_token"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."request_order_token"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."request_order_token_hash"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."request_order_token_hash"() TO "service_role";



GRANT ALL ON TABLE "public"."fiscal_documents" TO "service_role";
GRANT SELECT ON TABLE "public"."fiscal_documents" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."reserve_fiscal_document_number"("p_document_id" "uuid", "p_worker_id" "text", "p_expected_number" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reserve_fiscal_document_number"("p_document_id" "uuid", "p_worker_id" "text", "p_expected_number" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_business_combo"("p_business_id" "uuid", "p_combo_id" "text", "p_quantity" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_business_combo"("p_business_id" "uuid", "p_combo_id" "text", "p_quantity" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."resolve_business_combo"("p_business_id" "uuid", "p_combo_id" "text", "p_quantity" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_business_combo"("p_business_id" "uuid", "p_combo_id" "text", "p_quantity" integer) TO "service_role";



GRANT ALL ON TABLE "public"."fiscal_accounting_policies" TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_fiscal_accounting_policy"("p_business_id" "uuid", "p_environment" "text", "p_issuer_condition" "text", "p_recipient_condition" "text", "p_concept" integer, "p_invoice_type" integer, "p_effective_on" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_fiscal_accounting_policy"("p_business_id" "uuid", "p_environment" "text", "p_issuer_condition" "text", "p_recipient_condition" "text", "p_concept" integer, "p_invoice_type" integer, "p_effective_on" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."revert_packing_scan"("p_session_id" "uuid", "p_scan_key" "text", "p_idempotency_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."revert_packing_scan"("p_session_id" "uuid", "p_scan_key" "text", "p_idempotency_key" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."revert_packing_scan"("p_session_id" "uuid", "p_scan_key" "text", "p_idempotency_key" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."revoke_public_tracking"("p_order_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."revoke_public_tracking"("p_order_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."revoke_public_tracking"("p_order_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rider_active_delivery_payload"("p_order_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rider_active_delivery_payload"("p_order_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rider_order_rpc_payload"("p_order_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rider_order_rpc_payload"("p_order_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rider_require_active_membership"("p_business_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rider_require_active_membership"("p_business_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rider_validate_idempotency_key"("p_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rider_validate_idempotency_key"("p_key" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."sanitize_payment_diagnostic"("p_value" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sanitize_payment_diagnostic"("p_value" "text") TO "service_role";



GRANT ALL ON TABLE "public"."fiscal_parameter_snapshots" TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_fiscal_parameter_snapshot"("p_environment" "text", "p_parameter_type" "text", "p_version" "text", "p_values_json" "jsonb", "p_synchronized_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_fiscal_parameter_snapshot"("p_environment" "text", "p_parameter_type" "text", "p_version" "text", "p_values_json" "jsonb", "p_synchronized_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."scheduler_heartbeat"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."scheduler_heartbeat"() TO "anon";
GRANT ALL ON FUNCTION "public"."scheduler_heartbeat"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."scheduler_heartbeat"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_business_open_state"("p_business_id" "uuid", "p_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_business_open_state"("p_business_id" "uuid", "p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_business_open_state"("p_business_id" "uuid", "p_status" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_business_whatsapp_contact"("p_business_id" "uuid", "p_whatsapp_phone" "text", "p_verified" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_business_whatsapp_contact"("p_business_id" "uuid", "p_whatsapp_phone" "text", "p_verified" boolean) TO "service_role";
GRANT ALL ON FUNCTION "public"."set_business_whatsapp_contact"("p_business_id" "uuid", "p_whatsapp_phone" "text", "p_verified" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."set_current_customer_default_address"("p_address_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_current_customer_default_address"("p_address_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_current_customer_default_address"("p_address_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_order_delivery_handoff_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_order_delivery_handoff_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_order_delivery_handoff_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_order_operational_defaults"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_order_operational_defaults"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_order_status_timestamps"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_order_status_timestamps"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_payment_tables_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_payment_tables_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_payment_tables_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_preparation_estimate"("p_order_id" "uuid", "p_expected_revision" bigint, "p_minutes" integer, "p_idempotency_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_preparation_estimate"("p_order_id" "uuid", "p_expected_revision" bigint, "p_minutes" integer, "p_idempotency_key" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."set_preparation_estimate"("p_order_id" "uuid", "p_expected_revision" bigint, "p_minutes" integer, "p_idempotency_key" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."set_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."stage_catalog_products"("p_business_id" "uuid", "p_products" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."stage_catalog_products"("p_business_id" "uuid", "p_products" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."stamp_rider_location_server_time"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."stamp_rider_location_server_time"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."start_packing_session"("p_order_id" "uuid", "p_expected_revision" bigint, "p_idempotency_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."start_packing_session"("p_order_id" "uuid", "p_expected_revision" bigint, "p_idempotency_key" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."start_packing_session"("p_order_id" "uuid", "p_expected_revision" bigint, "p_idempotency_key" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."start_payment_outbox_job"("p_job_id" "uuid", "p_owner" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."start_payment_outbox_job"("p_job_id" "uuid", "p_owner" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."start_rider_delivery"("p_order_id" "uuid", "p_expected_revision" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."start_rider_delivery"("p_order_id" "uuid", "p_expected_revision" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."start_rider_delivery"("p_order_id" "uuid", "p_expected_revision" bigint, "p_idempotency_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."start_rider_delivery"("p_order_id" "uuid", "p_expected_revision" bigint, "p_idempotency_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."start_rider_delivery"("p_order_id" "uuid", "p_expected_revision" bigint, "p_idempotency_key" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."sweep_expired_checkout_sessions"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sweep_expired_checkout_sessions"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."transition_operational_alert"("p_alert_id" "uuid", "p_target_status" "text", "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."transition_operational_alert"("p_alert_id" "uuid", "p_target_status" "text", "p_note" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."transition_operational_alert"("p_alert_id" "uuid", "p_target_status" "text", "p_note" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."transition_order"("p_order_id" "uuid", "p_expected_revision" bigint, "p_new_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."transition_order"("p_order_id" "uuid", "p_expected_revision" bigint, "p_new_status" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."transition_order"("p_order_id" "uuid", "p_expected_revision" bigint, "p_new_status" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."transition_order"("p_order_id" "uuid", "p_expected_revision" bigint, "p_new_status" "text", "p_idempotency_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."transition_order"("p_order_id" "uuid", "p_expected_revision" bigint, "p_new_status" "text", "p_idempotency_key" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."transition_order"("p_order_id" "uuid", "p_expected_revision" bigint, "p_new_status" "text", "p_idempotency_key" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."undo_last_packing_scan"("p_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."undo_last_packing_scan"("p_session_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."unpublish_catalog_product"("p_business_id" "uuid", "p_external_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."unpublish_catalog_product"("p_business_id" "uuid", "p_external_id" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."unpublish_catalog_product"("p_business_id" "uuid", "p_external_id" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."update_fiscal_print_job"("p_print_job_id" "uuid", "p_status" "text", "p_error_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."update_fiscal_print_job"("p_print_job_id" "uuid", "p_status" "text", "p_error_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_fiscal_print_job"("p_print_job_id" "uuid", "p_status" "text", "p_error_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."upsert_current_customer_address"("p_address" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."upsert_current_customer_address"("p_address" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_current_customer_address"("p_address" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."upsert_current_customer_profile"("p_name" "text", "p_phone" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."upsert_current_customer_profile"("p_name" "text", "p_phone" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_current_customer_profile"("p_name" "text", "p_phone" "text") TO "service_role";
























GRANT ALL ON TABLE "public"."business_command_receipts" TO "service_role";
GRANT SELECT ON TABLE "public"."business_command_receipts" TO "authenticated";



GRANT ALL ON TABLE "public"."business_members" TO "service_role";
GRANT SELECT ON TABLE "public"."business_members" TO "authenticated";



GRANT ALL ON TABLE "public"."business_payment_settings" TO "service_role";



GRANT ALL ON TABLE "public"."businesses" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."businesses" TO "anon";
GRANT SELECT("id") ON TABLE "public"."businesses" TO "authenticated";



GRANT SELECT("name") ON TABLE "public"."businesses" TO "anon";
GRANT SELECT("name"),UPDATE("name") ON TABLE "public"."businesses" TO "authenticated";



GRANT SELECT("status") ON TABLE "public"."businesses" TO "anon";
GRANT SELECT("status"),UPDATE("status") ON TABLE "public"."businesses" TO "authenticated";



GRANT UPDATE("phone") ON TABLE "public"."businesses" TO "authenticated";



GRANT SELECT("address") ON TABLE "public"."businesses" TO "anon";
GRANT SELECT("address"),UPDATE("address") ON TABLE "public"."businesses" TO "authenticated";



GRANT SELECT("is_active") ON TABLE "public"."businesses" TO "anon";
GRANT SELECT("is_active"),UPDATE("is_active") ON TABLE "public"."businesses" TO "authenticated";



GRANT SELECT("ordering_enabled") ON TABLE "public"."businesses" TO "anon";
GRANT SELECT("ordering_enabled"),UPDATE("ordering_enabled") ON TABLE "public"."businesses" TO "authenticated";



GRANT SELECT("ordering_verified") ON TABLE "public"."businesses" TO "anon";
GRANT SELECT("ordering_verified") ON TABLE "public"."businesses" TO "authenticated";



GRANT SELECT("currency_code") ON TABLE "public"."businesses" TO "anon";
GRANT SELECT("currency_code"),UPDATE("currency_code") ON TABLE "public"."businesses" TO "authenticated";



GRANT SELECT("delivery_enabled") ON TABLE "public"."businesses" TO "anon";
GRANT SELECT("delivery_enabled"),UPDATE("delivery_enabled") ON TABLE "public"."businesses" TO "authenticated";



GRANT SELECT("pickup_enabled") ON TABLE "public"."businesses" TO "anon";
GRANT SELECT("pickup_enabled"),UPDATE("pickup_enabled") ON TABLE "public"."businesses" TO "authenticated";



GRANT SELECT("delivery_fee") ON TABLE "public"."businesses" TO "anon";
GRANT SELECT("delivery_fee"),UPDATE("delivery_fee") ON TABLE "public"."businesses" TO "authenticated";



GRANT SELECT("minimum_delivery_subtotal") ON TABLE "public"."businesses" TO "anon";
GRANT SELECT("minimum_delivery_subtotal"),UPDATE("minimum_delivery_subtotal") ON TABLE "public"."businesses" TO "authenticated";



GRANT UPDATE("alcohol_sales_enabled") ON TABLE "public"."businesses" TO "authenticated";



GRANT UPDATE("alcohol_minimum_age") ON TABLE "public"."businesses" TO "authenticated";



GRANT UPDATE("alcohol_sales_start") ON TABLE "public"."businesses" TO "authenticated";



GRANT UPDATE("alcohol_sales_end") ON TABLE "public"."businesses" TO "authenticated";



GRANT UPDATE("alcohol_timezone") ON TABLE "public"."businesses" TO "authenticated";



GRANT UPDATE("order_rate_limit_per_10_minutes") ON TABLE "public"."businesses" TO "authenticated";



GRANT UPDATE("max_pending_orders_per_customer") ON TABLE "public"."businesses" TO "authenticated";



GRANT UPDATE("stock_reservation_minutes") ON TABLE "public"."businesses" TO "authenticated";



GRANT UPDATE("abandoned_order_minutes") ON TABLE "public"."businesses" TO "authenticated";



GRANT UPDATE("captcha_required") ON TABLE "public"."businesses" TO "authenticated";



GRANT ALL ON TABLE "public"."catalog_assets" TO "service_role";
GRANT SELECT ON TABLE "public"."catalog_assets" TO "authenticated";



GRANT ALL ON TABLE "public"."checkout_session_combos" TO "service_role";
GRANT SELECT ON TABLE "public"."checkout_session_combos" TO "authenticated";



GRANT ALL ON TABLE "public"."checkout_session_items" TO "service_role";



GRANT ALL ON TABLE "public"."checkout_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."commercial_contract_remediation" TO "anon";
GRANT ALL ON TABLE "public"."commercial_contract_remediation" TO "authenticated";
GRANT ALL ON TABLE "public"."commercial_contract_remediation" TO "service_role";



GRANT ALL ON TABLE "public"."customers" TO "service_role";
GRANT SELECT ON TABLE "public"."customers" TO "authenticated";



GRANT ALL ON TABLE "public"."daily_reconciliation_events" TO "service_role";
GRANT SELECT ON TABLE "public"."daily_reconciliation_events" TO "authenticated";



GRANT ALL ON TABLE "public"."daily_reconciliations" TO "service_role";
GRANT SELECT ON TABLE "public"."daily_reconciliations" TO "authenticated";



GRANT ALL ON TABLE "public"."delivery_confirmation_attempts" TO "service_role";



GRANT ALL ON TABLE "public"."delivery_outbox" TO "service_role";



GRANT ALL ON TABLE "public"."fiscal_credit_allocations" TO "service_role";



GRANT ALL ON TABLE "public"."fiscal_document_artifacts" TO "service_role";



GRANT ALL ON TABLE "public"."fiscal_document_items" TO "service_role";
GRANT SELECT ON TABLE "public"."fiscal_document_items" TO "authenticated";



GRANT ALL ON TABLE "public"."fiscal_events" TO "service_role";
GRANT SELECT ON TABLE "public"."fiscal_events" TO "authenticated";



GRANT ALL ON TABLE "public"."fiscal_print_jobs" TO "service_role";
GRANT SELECT ON TABLE "public"."fiscal_print_jobs" TO "authenticated";



GRANT ALL ON TABLE "public"."fiscal_profile_events" TO "anon";
GRANT ALL ON TABLE "public"."fiscal_profile_events" TO "authenticated";
GRANT ALL ON TABLE "public"."fiscal_profile_events" TO "service_role";



GRANT ALL ON TABLE "public"."fiscal_request_attempts" TO "service_role";



GRANT ALL ON TABLE "public"."identity_audit_events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."identity_audit_events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."identity_audit_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."identity_audit_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."identity_invitations" TO "service_role";



GRANT ALL ON TABLE "public"."identity_permissions" TO "service_role";
GRANT SELECT ON TABLE "public"."identity_permissions" TO "authenticated";



GRANT ALL ON TABLE "public"."identity_role_permissions" TO "service_role";
GRANT SELECT ON TABLE "public"."identity_role_permissions" TO "authenticated";



GRANT ALL ON TABLE "public"."identity_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."identity_user_security" TO "service_role";



GRANT ALL ON TABLE "public"."inventory_receipt_items" TO "service_role";
GRANT SELECT ON TABLE "public"."inventory_receipt_items" TO "authenticated";



GRANT ALL ON TABLE "public"."inventory_receipts" TO "service_role";
GRANT SELECT ON TABLE "public"."inventory_receipts" TO "authenticated";



GRANT ALL ON TABLE "public"."inventory_reservations" TO "service_role";



GRANT ALL ON TABLE "public"."notification_outbox" TO "service_role";
GRANT SELECT ON TABLE "public"."notification_outbox" TO "authenticated";



GRANT ALL ON TABLE "public"."operational_alert_events" TO "service_role";
GRANT SELECT ON TABLE "public"."operational_alert_events" TO "authenticated";



GRANT ALL ON TABLE "public"."operational_alerts" TO "service_role";
GRANT SELECT ON TABLE "public"."operational_alerts" TO "authenticated";



GRANT ALL ON TABLE "public"."operational_sweep_runs" TO "service_role";



GRANT ALL ON TABLE "public"."order_abuse_events" TO "service_role";
GRANT SELECT ON TABLE "public"."order_abuse_events" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."order_abuse_events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."order_abuse_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."order_abuse_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."order_combos" TO "service_role";
GRANT SELECT ON TABLE "public"."order_combos" TO "authenticated";



GRANT ALL ON TABLE "public"."order_delivery_handoffs" TO "service_role";



GRANT ALL ON TABLE "public"."order_events" TO "service_role";
GRANT SELECT ON TABLE "public"."order_events" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."order_events_sequence_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."order_events_sequence_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."order_events_sequence_seq" TO "service_role";



GRANT ALL ON TABLE "public"."order_items" TO "service_role";
GRANT SELECT ON TABLE "public"."order_items" TO "anon";
GRANT SELECT ON TABLE "public"."order_items" TO "authenticated";



GRANT ALL ON TABLE "public"."order_packing_scans" TO "service_role";
GRANT SELECT ON TABLE "public"."order_packing_scans" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."order_public_code_seq" TO "service_role";



GRANT ALL ON TABLE "public"."order_public_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."orders" TO "service_role";
GRANT SELECT ON TABLE "public"."orders" TO "anon";
GRANT SELECT ON TABLE "public"."orders" TO "authenticated";



GRANT ALL ON TABLE "public"."payment_attempts" TO "service_role";



GRANT ALL ON TABLE "public"."payment_cancellations" TO "service_role";



GRANT ALL ON TABLE "public"."payment_disputes" TO "service_role";



GRANT ALL ON TABLE "public"."payment_events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."payment_events_sequence_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."payment_events_sequence_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."payment_events_sequence_seq" TO "service_role";



GRANT ALL ON TABLE "public"."payment_intents" TO "service_role";



GRANT ALL ON TABLE "public"."payment_rate_limit_buckets" TO "service_role";



GRANT ALL ON TABLE "public"."payment_refunds" TO "service_role";



GRANT ALL ON TABLE "public"."payment_webhook_receipts" TO "service_role";



GRANT ALL ON TABLE "public"."pos_payments" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_payments" TO "authenticated";



GRANT ALL ON TABLE "public"."pos_sale_items" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_sale_items" TO "authenticated";



GRANT ALL ON TABLE "public"."pos_sales" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_sales" TO "authenticated";



GRANT ALL ON TABLE "public"."product_barcodes" TO "service_role";
GRANT SELECT ON TABLE "public"."product_barcodes" TO "authenticated";



GRANT ALL ON TABLE "public"."product_combo_components" TO "service_role";
GRANT SELECT ON TABLE "public"."product_combo_components" TO "anon";
GRANT SELECT ON TABLE "public"."product_combo_components" TO "authenticated";



GRANT ALL ON TABLE "public"."product_combo_substitutions" TO "service_role";
GRANT SELECT ON TABLE "public"."product_combo_substitutions" TO "anon";
GRANT SELECT ON TABLE "public"."product_combo_substitutions" TO "authenticated";



GRANT ALL ON TABLE "public"."product_combos" TO "service_role";
GRANT SELECT ON TABLE "public"."product_combos" TO "anon";
GRANT SELECT ON TABLE "public"."product_combos" TO "authenticated";



GRANT ALL ON TABLE "public"."products" TO "service_role";
GRANT SELECT ON TABLE "public"."products" TO "anon";
GRANT SELECT ON TABLE "public"."products" TO "authenticated";



GRANT UPDATE("is_active") ON TABLE "public"."products" TO "authenticated";



GRANT UPDATE("sort_order") ON TABLE "public"."products" TO "authenticated";



GRANT UPDATE("stock") ON TABLE "public"."products" TO "authenticated";



GRANT UPDATE("available") ON TABLE "public"."products" TO "authenticated";



GRANT ALL ON TABLE "public"."rider_delivery_issues" TO "service_role";



GRANT ALL ON TABLE "public"."rider_delivery_operations" TO "service_role";



GRANT ALL ON SEQUENCE "public"."rider_location_receipt_sequence_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."rider_location_receipt_sequence_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."rider_location_receipt_sequence_seq" TO "service_role";



GRANT ALL ON TABLE "public"."rider_locations" TO "service_role";



GRANT ALL ON SEQUENCE "public"."rider_locations_sequence_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."rider_locations_sequence_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."rider_locations_sequence_seq" TO "service_role";



GRANT ALL ON TABLE "public"."rider_profiles" TO "service_role";
GRANT SELECT ON TABLE "public"."rider_profiles" TO "authenticated";



GRANT ALL ON TABLE "public"."riders" TO "service_role";
GRANT SELECT ON TABLE "public"."riders" TO "authenticated";



GRANT ALL ON TABLE "public"."scanned_product_audit" TO "service_role";
GRANT SELECT ON TABLE "public"."scanned_product_audit" TO "authenticated";



GRANT ALL ON TABLE "public"."service_health_signals" TO "service_role";



GRANT ALL ON TABLE "public"."staff_profiles" TO "service_role";
GRANT SELECT ON TABLE "public"."staff_profiles" TO "authenticated";



GRANT ALL ON TABLE "public"."stock_count_items" TO "service_role";
GRANT SELECT ON TABLE "public"."stock_count_items" TO "authenticated";



GRANT ALL ON TABLE "public"."stock_count_sessions" TO "service_role";
GRANT SELECT ON TABLE "public"."stock_count_sessions" TO "authenticated";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































