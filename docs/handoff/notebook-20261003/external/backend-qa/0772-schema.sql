


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



CREATE OR REPLACE FUNCTION "public"."bump_order_revision"() RETURNS "trigger"
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


ALTER FUNCTION "public"."bump_order_revision"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."bump_order_revision"() IS 'Incrementa orders.revision en cada UPDATE que cambie la fila; ignora cualquier revision enviada por el cliente.';



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


COMMENT ON FUNCTION "public"."claim_delivery_order"("p_business_id" "uuid", "p_public_code" "text", "p_expected_revision" bigint, "p_idempotency_key" "text") IS 'Canonical idempotent Rider claim; legacy claim_available_rider_order overload is not callable.';



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



CREATE OR REPLACE FUNCTION "public"."create_order_with_items"("payload" "jsonb") RETURNS "jsonb"
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


ALTER FUNCTION "public"."create_order_with_items"("payload" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_order_with_items"("payload" "jsonb") IS 'Authoritative order creation with normalized recipient data and an immutable, owned delivery snapshot.';



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


SET default_tablespace = '';

SET default_table_access_method = "heap";


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
    CONSTRAINT "customer_addresses_accuracy_nonnegative" CHECK ((("geolocation_accuracy" IS NULL) OR ("geolocation_accuracy" >= (0)::numeric))),
    CONSTRAINT "customer_addresses_city_length" CHECK ((("char_length"("btrim"("city")) >= 1) AND ("char_length"("btrim"("city")) <= 100))),
    CONSTRAINT "customer_addresses_coordinates_pair" CHECK (((("latitude" IS NULL) AND ("longitude" IS NULL)) OR ((("latitude" >= ('-90'::integer)::numeric) AND ("latitude" <= (90)::numeric)) AND (("longitude" >= ('-180'::integer)::numeric) AND ("longitude" <= (180)::numeric))))),
    CONSTRAINT "customer_addresses_formatted_length" CHECK ((("char_length"("btrim"("formatted_address")) >= 1) AND ("char_length"("btrim"("formatted_address")) <= 180))),
    CONSTRAINT "customer_addresses_label_length" CHECK ((("char_length"("btrim"("label")) >= 1) AND ("char_length"("btrim"("label")) <= 60))),
    CONSTRAINT "customer_addresses_source_check" CHECK (("source" = ANY (ARRAY['manual'::"text", 'gps'::"text", 'geocoder'::"text", 'previous_order'::"text"]))),
    CONSTRAINT "customer_addresses_street_length" CHECK ((("char_length"("btrim"("street")) >= 1) AND ("char_length"("btrim"("street")) <= 120)))
);


ALTER TABLE "public"."customer_addresses" OWNER TO "postgres";


COMMENT ON TABLE "public"."customer_addresses" IS 'Customer-owned reusable delivery addresses. Soft-deleted rows remain detached from immutable order snapshots.';



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
    'isDefault', p_address.is_default,
    'lastUsedAt', p_address.last_used_at,
    'createdAt', p_address.created_at,
    'updatedAt', p_address.updated_at
  )
$$;


ALTER FUNCTION "public"."customer_address_json"("p_address" "public"."customer_addresses") OWNER TO "postgres";


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
    select jsonb_build_object('lat', round(rl.lat::numeric, 3), 'lng', round(rl.lng::numeric, 3), 'accuracy', greatest(100, ceil(rl.accuracy))::integer, 'source', 'gps', 'created_at', rl.created_at)
      into v_location from public.rider_locations rl
     where rl.order_id = v_order.id and rl.rider_user_id = v_order.assigned_rider_user_id and rl.source = 'gps'
       and rl.accuracy between 0 and 250 and rl.created_at >= clock_timestamp() - interval '3 minutes'
     order by rl.created_at desc, rl.id desc limit 1;
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
  order by o.ready_at nulls last, o.created_at
  limit 50;
end;
$$;


ALTER FUNCTION "public"."get_rider_queue"("p_business_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_rider_queue"("p_business_id" "uuid") IS 'Active Rider queue with authorized business coordinates only; customer coordinates remain null before claim.';



CREATE OR REPLACE FUNCTION "public"."has_business_role"("target_business_id" "uuid", "roles" "text"[]) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select exists (
    select 1
      from public.business_members bm
     where bm.business_id = target_business_id
       and bm.user_id = auth.uid()
       and bm.is_active = true
       and bm.role = any (roles)
  )
$$;


ALTER FUNCTION "public"."has_business_role"("target_business_id" "uuid", "roles" "text"[]) OWNER TO "postgres";


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
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select exists (
    select 1
      from public.orders o
     where o.id = target_order_id
       and o.assigned_rider_user_id = auth.uid()
  )
$$;


ALTER FUNCTION "public"."is_assigned_rider"("target_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_business_member"("target_business_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select exists (
    select 1
      from public.business_members bm
     where bm.business_id = target_business_id
       and bm.user_id = auth.uid()
       and bm.is_active = true
  )
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
  group by o.id, b.address
  order by o.ready_at nulls last, o.created_at
  limit 50
$$;


ALTER FUNCTION "public"."list_available_rider_orders"("p_business_id" "uuid") OWNER TO "postgres";


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
     'longitude', 'geolocationAccuracy', 'source', 'isDefault', 'allowDuplicate'
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
  if v_source in ('gps', 'geocoder') and v_latitude is null then
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
      source, normalized_address, is_default
    ) values (
      v_customer_id, v_label, v_formatted, v_street, v_street_number, v_floor, v_apartment,
      v_reference, v_city, v_province, v_postal_code, v_latitude, v_longitude, v_accuracy,
      v_source, v_normalized, v_make_default
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
    CONSTRAINT "rider_map_business_locations_accuracy_check" CHECK ((("accuracy_m" IS NULL) OR ("accuracy_m" >= (0)::numeric))),
    CONSTRAINT "rider_map_business_locations_coordinates_check" CHECK (((("latitude" >= ('-90'::integer)::numeric) AND ("latitude" <= (90)::numeric)) AND (("longitude" >= ('-180'::integer)::numeric) AND ("longitude" <= (180)::numeric)))),
    CONSTRAINT "rider_map_business_locations_source_check" CHECK (("source" = ANY (ARRAY['business_verified'::"text", 'qa_fixture'::"text"])))
);


ALTER TABLE "private"."rider_map_business_locations" OWNER TO "postgres";


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
    CONSTRAINT "rider_map_order_location_source_check" CHECK ((("business_source" IS NULL) OR ("business_source" = ANY (ARRAY['business_verified'::"text", 'qa_fixture'::"text"]))))
);


ALTER TABLE "private"."rider_map_order_location_snapshots" OWNER TO "postgres";


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
    "payment_method" "text",
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
    CONSTRAINT "orders_address_lat_check" CHECK ((("address_lat" IS NULL) OR (("address_lat" >= ('-90'::integer)::double precision) AND ("address_lat" <= (90)::double precision)))),
    CONSTRAINT "orders_address_lng_check" CHECK ((("address_lng" IS NULL) OR (("address_lng" >= ('-180'::integer)::double precision) AND ("address_lng" <= (180)::double precision)))),
    CONSTRAINT "orders_age_confirmation_complete" CHECK (((("age_confirmed_at" IS NULL) AND ("age_confirmation_policy" IS NULL)) OR (("age_confirmed_at" IS NOT NULL) AND (("age_confirmation_policy" >= 18) AND ("age_confirmation_policy" <= 99))))),
    CONSTRAINT "orders_client_request_id_format" CHECK (("client_request_id" ~ '^[A-Za-z0-9_-]{8,128}$'::"text")),
    CONSTRAINT "orders_delivery_fee_check" CHECK (("delivery_fee" >= (0)::numeric)),
    CONSTRAINT "orders_delivery_mode_check" CHECK (("delivery_mode" = ANY (ARRAY['delivery'::"text", 'pickup'::"text"]))),
    CONSTRAINT "orders_delivery_snapshot_coordinates_pair" CHECK (((("delivery_latitude" IS NULL) AND ("delivery_longitude" IS NULL)) OR ((("delivery_latitude" >= ('-90'::integer)::numeric) AND ("delivery_latitude" <= (90)::numeric)) AND (("delivery_longitude" >= ('-180'::integer)::numeric) AND ("delivery_longitude" <= (180)::numeric))))),
    CONSTRAINT "orders_delivery_snapshot_source_check" CHECK ((("delivery_address_source" IS NULL) OR ("delivery_address_source" = ANY (ARRAY['manual'::"text", 'gps'::"text", 'geocoder'::"text", 'previous_order'::"text"])))),
    CONSTRAINT "orders_estimated_arrival_metadata_consistent" CHECK (((("estimated_arrival_at" IS NULL) AND ("estimated_arrival_source" IS NULL) AND ("estimated_arrival_updated_at" IS NULL)) OR (("estimated_arrival_at" IS NOT NULL) AND ("estimated_arrival_source" IS NOT NULL) AND ("estimated_arrival_updated_at" IS NOT NULL)))),
    CONSTRAINT "orders_estimated_arrival_source_check" CHECK ((("estimated_arrival_source" IS NULL) OR ("estimated_arrival_source" = ANY (ARRAY['business'::"text", 'routing'::"text"])))),
    CONSTRAINT "orders_fulfillment_type_check" CHECK (("fulfillment_type" = ANY (ARRAY['delivery'::"text", 'pickup'::"text"]))),
    CONSTRAINT "orders_status_check" CHECK (("status" = ANY (ARRAY['received'::"text", 'accepted'::"text", 'preparing'::"text", 'ready'::"text", 'on_the_way'::"text", 'delivered'::"text", 'cancelled'::"text", 'rejected'::"text", 'draft'::"text", 'submitted'::"text", 'assigned'::"text", 'picked_up'::"text", 'arrived'::"text", 'arriving'::"text", 'canceled'::"text"]))),
    CONSTRAINT "orders_subtotal_check" CHECK (("subtotal" >= (0)::numeric)),
    CONSTRAINT "orders_total_check" CHECK (("total" >= (0)::numeric)),
    CONSTRAINT "orders_total_matches_parts" CHECK (("total" = ("subtotal" + "delivery_fee"))),
    CONSTRAINT "orders_total_not_below_subtotal" CHECK (("total" >= "subtotal"))
);

ALTER TABLE ONLY "public"."orders" REPLICA IDENTITY FULL;


ALTER TABLE "public"."orders" OWNER TO "postgres";


COMMENT ON COLUMN "public"."orders"."client_request_id" IS 'Caller-generated idempotency key, unique inside a business.';



COMMENT ON COLUMN "public"."orders"."delivery_address_label" IS 'Immutable customer-facing label captured for this order, such as Casa or Trabajo.';



COMMENT ON COLUMN "public"."orders"."delivery_snapshot_created_at" IS 'Server timestamp at which the immutable delivery snapshot was accepted.';



COMMENT ON COLUMN "public"."orders"."revision" IS 'Version monotona del pedido. La incrementa el trigger orders_zz_bump_revision en cada UPDATE efectivo; el cliente nunca la escribe.';



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
    CONSTRAINT "products_alcohol_requires_age" CHECK ((("is_alcoholic" IS DISTINCT FROM true) OR (("minimum_age" IS NOT NULL) AND ("minimum_age" >= 18) AND ("minimum_age" <= 99)))),
    CONSTRAINT "products_available_requires_verification" CHECK (((NOT "available") OR ("is_verified" AND "is_active" AND ("stock" IS NOT NULL) AND ("stock" > 0)))),
    CONSTRAINT "products_catalog_origin_valid" CHECK (("catalog_origin" = ANY (ARRAY['commercial'::"text", 'demo_fixture'::"text", 'test_only'::"text", 'staging_only'::"text"]))),
    CONSTRAINT "products_catalog_structured_capacity" CHECK (((("variant" IS NULL) AND ("capacity_value" IS NULL) AND ("capacity_unit" IS NULL)) OR (("variant" IS NOT NULL) AND ("btrim"("variant") <> ''::"text") AND ("capacity_value" IS NOT NULL) AND ("capacity_value" > (0)::numeric) AND ("capacity_unit" = ANY (ARRAY['ml'::"text", 'l'::"text", 'g'::"text", 'kg'::"text", 'unidad'::"text"]))))),
    CONSTRAINT "products_price_check" CHECK (("price" >= (0)::numeric)),
    CONSTRAINT "products_stock_nonnegative" CHECK ((("stock" IS NULL) OR ("stock" >= 0))),
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


ALTER TABLE ONLY "public"."order_events" ALTER COLUMN "sequence" SET DEFAULT "nextval"('"public"."order_events_sequence_seq"'::"regclass");



ALTER TABLE ONLY "public"."rider_locations" ALTER COLUMN "sequence" SET DEFAULT "nextval"('"public"."rider_locations_sequence_seq"'::"regclass");



ALTER TABLE ONLY "private"."rider_map_business_locations"
    ADD CONSTRAINT "rider_map_business_locations_pkey" PRIMARY KEY ("business_id");



ALTER TABLE ONLY "private"."rider_map_order_location_snapshots"
    ADD CONSTRAINT "rider_map_order_location_snapshots_pkey" PRIMARY KEY ("order_id");



ALTER TABLE ONLY "public"."business_members"
    ADD CONSTRAINT "business_members_business_id_user_id_key" UNIQUE ("business_id", "user_id");



ALTER TABLE ONLY "public"."business_members"
    ADD CONSTRAINT "business_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."businesses"
    ADD CONSTRAINT "businesses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."catalog_assets"
    ADD CONSTRAINT "catalog_assets_business_external_id_key" UNIQUE ("business_id", "external_id");



ALTER TABLE ONLY "public"."catalog_assets"
    ADD CONSTRAINT "catalog_assets_business_sku_key" UNIQUE ("business_id", "sku");



ALTER TABLE ONLY "public"."catalog_assets"
    ADD CONSTRAINT "catalog_assets_pkey" PRIMARY KEY ("id");



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



ALTER TABLE ONLY "public"."delivery_confirmation_attempts"
    ADD CONSTRAINT "delivery_confirmation_attempts_order_id_rider_id_request_id_key" UNIQUE ("order_id", "rider_id", "request_id");



ALTER TABLE ONLY "public"."delivery_confirmation_attempts"
    ADD CONSTRAINT "delivery_confirmation_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."delivery_outbox"
    ADD CONSTRAINT "delivery_outbox_order_id_event_type_event_key_key" UNIQUE ("order_id", "event_type", "event_key");



ALTER TABLE ONLY "public"."delivery_outbox"
    ADD CONSTRAINT "delivery_outbox_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_abuse_events"
    ADD CONSTRAINT "order_abuse_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_delivery_handoffs"
    ADD CONSTRAINT "order_delivery_handoffs_pkey" PRIMARY KEY ("order_id");



ALTER TABLE ONLY "public"."order_events"
    ADD CONSTRAINT "order_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_public_tokens"
    ADD CONSTRAINT "order_public_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_public_tokens"
    ADD CONSTRAINT "order_public_tokens_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_code_key" UNIQUE ("code");



ALTER TABLE "public"."orders"
    ADD CONSTRAINT "orders_delivery_address_label_length" CHECK ((("delivery_address_label" IS NULL) OR (("char_length"("btrim"("delivery_address_label")) >= 1) AND ("char_length"("btrim"("delivery_address_label")) <= 60)))) NOT VALID;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");



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



ALTER TABLE ONLY "public"."riders"
    ADD CONSTRAINT "riders_pkey" PRIMARY KEY ("id");



CREATE INDEX "business_members_user_idx" ON "public"."business_members" USING "btree" ("user_id");



CREATE UNIQUE INDEX "businesses_slug_key" ON "public"."businesses" USING "btree" ("slug");



CREATE INDEX "businesses_status_idx" ON "public"."businesses" USING "btree" ("status");



CREATE INDEX "customer_addresses_customer_active_idx" ON "public"."customer_addresses" USING "btree" ("customer_id", "updated_at" DESC) WHERE ("deleted_at" IS NULL);



CREATE INDEX "customer_addresses_normalized_idx" ON "public"."customer_addresses" USING "btree" ("customer_id", "normalized_address") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "customer_addresses_one_default_idx" ON "public"."customer_addresses" USING "btree" ("customer_id") WHERE ("is_default" AND ("deleted_at" IS NULL));



CREATE INDEX "customers_last_order_idx" ON "public"."customers" USING "btree" ("last_order_at" DESC NULLS LAST);



CREATE INDEX "delivery_confirmation_attempts_order_attempted_idx" ON "public"."delivery_confirmation_attempts" USING "btree" ("order_id", "attempted_at" DESC);



CREATE INDEX "order_events_order_created_idx" ON "public"."order_events" USING "btree" ("order_id", "created_at" DESC);



CREATE INDEX "order_events_order_sequence_idx" ON "public"."order_events" USING "btree" ("order_id", "sequence" DESC);



CREATE UNIQUE INDEX "order_events_sequence_key" ON "public"."order_events" USING "btree" ("sequence");



CREATE INDEX "order_items_order_idx" ON "public"."order_items" USING "btree" ("order_id");



CREATE INDEX "order_public_tokens_order_idx" ON "public"."order_public_tokens" USING "btree" ("order_id");



CREATE UNIQUE INDEX "order_public_tokens_token_hash_key" ON "public"."order_public_tokens" USING "btree" ("token_hash");



CREATE UNIQUE INDEX "orders_business_client_request_key" ON "public"."orders" USING "btree" ("business_id", "client_request_id");



CREATE INDEX "orders_business_created_idx" ON "public"."orders" USING "btree" ("business_id", "created_at" DESC);



CREATE INDEX "orders_business_public_code_idx" ON "public"."orders" USING "btree" ("business_id", "public_code");



CREATE UNIQUE INDEX "orders_business_public_code_key" ON "public"."orders" USING "btree" ("business_id", "public_code");



CREATE INDEX "orders_business_status_idx" ON "public"."orders" USING "btree" ("business_id", "status");



CREATE INDEX "orders_customer_address_idx" ON "public"."orders" USING "btree" ("customer_address_id") WHERE ("customer_address_id" IS NOT NULL);



CREATE INDEX "orders_customer_created_idx" ON "public"."orders" USING "btree" ("customer_user_id", "created_at" DESC) WHERE ("customer_user_id" IS NOT NULL);



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



CREATE INDEX "riders_business_status_idx" ON "public"."riders" USING "btree" ("business_id", "status");



CREATE OR REPLACE TRIGGER "businesses_fail_close_whatsapp_change" BEFORE INSERT OR UPDATE OF "whatsapp_phone", "whatsapp_verified_by" ON "public"."businesses" FOR EACH ROW EXECUTE FUNCTION "public"."fail_close_business_whatsapp_change"();



CREATE OR REPLACE TRIGGER "businesses_set_updated_at" BEFORE UPDATE ON "public"."businesses" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "customer_addresses_set_updated_at" BEFORE UPDATE ON "public"."customer_addresses" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "customers_set_updated_at" BEFORE UPDATE ON "public"."customers" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "order_delivery_handoffs_set_updated_at" BEFORE UPDATE ON "public"."order_delivery_handoffs" FOR EACH ROW EXECUTE FUNCTION "public"."set_order_delivery_handoff_updated_at"();



CREATE OR REPLACE TRIGGER "orders_log_status_event" AFTER UPDATE ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."log_order_status_event"();



CREATE OR REPLACE TRIGGER "orders_prevent_rider_unverified_delivery" BEFORE UPDATE OF "status" ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_rider_unverified_delivery"();



CREATE OR REPLACE TRIGGER "orders_purge_terminal_rider_locations" AFTER UPDATE OF "status" ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."purge_terminal_order_rider_locations"();



CREATE OR REPLACE TRIGGER "orders_require_verified_delivery_code" BEFORE UPDATE OF "status" ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_unverified_delivery"();



CREATE OR REPLACE TRIGGER "orders_set_operational_defaults" BEFORE INSERT OR UPDATE ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."set_order_operational_defaults"();



CREATE OR REPLACE TRIGGER "orders_set_status_timestamps" BEFORE INSERT OR UPDATE ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."set_order_status_timestamps"();



CREATE OR REPLACE TRIGGER "orders_set_updated_at" BEFORE UPDATE ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "orders_zz_bump_revision" BEFORE UPDATE ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."bump_order_revision"();



CREATE OR REPLACE TRIGGER "products_fail_close_master_change" BEFORE UPDATE ON "public"."products" FOR EACH ROW EXECUTE FUNCTION "public"."fail_close_verified_product_master_change"();



CREATE OR REPLACE TRIGGER "products_set_updated_at" BEFORE UPDATE ON "public"."products" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "rider_locations_server_time" BEFORE INSERT ON "public"."rider_locations" FOR EACH ROW EXECUTE FUNCTION "public"."stamp_rider_location_server_time"();



CREATE OR REPLACE TRIGGER "rider_map_capture_order_location" AFTER INSERT ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "private"."capture_rider_map_order_location_snapshot"();



CREATE OR REPLACE TRIGGER "riders_set_updated_at" BEFORE UPDATE ON "public"."riders" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "private"."rider_map_business_locations"
    ADD CONSTRAINT "rider_map_business_locations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "private"."rider_map_order_location_snapshots"
    ADD CONSTRAINT "rider_map_order_location_snapshots_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."business_members"
    ADD CONSTRAINT "business_members_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."business_members"
    ADD CONSTRAINT "business_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."businesses"
    ADD CONSTRAINT "businesses_ordering_verified_by_fkey" FOREIGN KEY ("ordering_verified_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."businesses"
    ADD CONSTRAINT "businesses_whatsapp_verified_by_fkey" FOREIGN KEY ("whatsapp_verified_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."catalog_assets"
    ADD CONSTRAINT "catalog_assets_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."catalog_assets"
    ADD CONSTRAINT "catalog_assets_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_addresses"
    ADD CONSTRAINT "customer_addresses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



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



ALTER TABLE ONLY "public"."order_abuse_events"
    ADD CONSTRAINT "order_abuse_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_abuse_events"
    ADD CONSTRAINT "order_abuse_events_customer_user_id_fkey" FOREIGN KEY ("customer_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



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



ALTER TABLE ONLY "public"."order_public_tokens"
    ADD CONSTRAINT "order_public_tokens_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



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



ALTER TABLE ONLY "public"."riders"
    ADD CONSTRAINT "riders_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE "private"."rider_map_business_locations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "private"."rider_map_order_location_snapshots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "authorized team reads abuse events" ON "public"."order_abuse_events" FOR SELECT TO "authenticated" USING ("public"."has_business_role"("business_id", ARRAY['owner'::"text", 'admin'::"text"]));



ALTER TABLE "public"."business_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."businesses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "catalog team reads approved assets" ON "public"."catalog_assets" FOR SELECT TO "authenticated" USING ("public"."has_business_role"("business_id", ARRAY['owner'::"text", 'admin'::"text", 'staff'::"text"]));



ALTER TABLE "public"."catalog_assets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "customer addresses readable by owner" ON "public"."customer_addresses" FOR SELECT TO "authenticated" USING ((("customer_id" = "auth"."uid"()) AND ("deleted_at" IS NULL)));



ALTER TABLE "public"."customer_addresses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "customers readable by owner" ON "public"."customers" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



ALTER TABLE "public"."delivery_confirmation_attempts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."delivery_outbox" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "operational team reads legacy riders" ON "public"."riders" FOR SELECT TO "authenticated" USING ("public"."is_business_member"("business_id"));



ALTER TABLE "public"."order_abuse_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_delivery_handoffs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_public_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;


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


ALTER TABLE "public"."riders" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."businesses";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."order_events";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."orders";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."products";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."rider_locations";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































REVOKE ALL ON FUNCTION "public"."archive_current_customer_address"("p_address_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."archive_current_customer_address"("p_address_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."archive_current_customer_address"("p_address_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."assign_order_rider"("p_order_id" "uuid", "p_expected_status" "text", "p_expected_rider_user_id" "uuid", "p_new_rider_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."assign_order_rider"("p_order_id" "uuid", "p_expected_status" "text", "p_expected_rider_user_id" "uuid", "p_new_rider_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_order_rider"("p_order_id" "uuid", "p_expected_status" "text", "p_expected_rider_user_id" "uuid", "p_new_rider_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."bump_order_revision"() TO "anon";
GRANT ALL ON FUNCTION "public"."bump_order_revision"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."bump_order_revision"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_access_order"("target_order_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_access_order"("target_order_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."can_access_order"("target_order_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_access_order"("target_order_id" "uuid") TO "authenticated";



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



REVOKE ALL ON FUNCTION "public"."claim_available_rider_order"("p_business_id" "uuid", "p_public_code" "text", "p_expected_revision" bigint, "p_expected_status" "text", "p_expected_rider_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_available_rider_order"("p_business_id" "uuid", "p_public_code" "text", "p_expected_revision" bigint, "p_expected_status" "text", "p_expected_rider_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_delivery_order"("p_business_id" "uuid", "p_public_code" "text", "p_expected_revision" bigint, "p_idempotency_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_delivery_order"("p_business_id" "uuid", "p_public_code" "text", "p_expected_revision" bigint, "p_idempotency_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_delivery_order"("p_business_id" "uuid", "p_public_code" "text", "p_expected_revision" bigint, "p_idempotency_key" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."confirm_delivery_code"("p_order_id" "uuid", "p_expected_revision" bigint, "p_delivery_code" "text", "p_idempotency_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirm_delivery_code"("p_order_id" "uuid", "p_expected_revision" bigint, "p_delivery_code" "text", "p_idempotency_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."confirm_delivery_code"("p_order_id" "uuid", "p_expected_revision" bigint, "p_delivery_code" "text", "p_idempotency_key" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."confirm_order_delivery"("p_order_id" "uuid", "p_expected_status" "text", "p_delivery_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirm_order_delivery"("p_order_id" "uuid", "p_expected_status" "text", "p_delivery_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_order_with_items"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_order_with_items"("payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_order_with_items"("payload" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_order_with_items_core"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_order_with_items_core"("payload" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_order_with_items_legacy"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_order_with_items_legacy"("payload" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_order_with_items_profile_v1"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_order_with_items_profile_v1"("payload" "jsonb") TO "service_role";



GRANT ALL ON TABLE "public"."customer_addresses" TO "service_role";
GRANT SELECT ON TABLE "public"."customer_addresses" TO "authenticated";



GRANT ALL ON FUNCTION "public"."customer_address_json"("p_address" "public"."customer_addresses") TO "anon";
GRANT ALL ON FUNCTION "public"."customer_address_json"("p_address" "public"."customer_addresses") TO "authenticated";
GRANT ALL ON FUNCTION "public"."customer_address_json"("p_address" "public"."customer_addresses") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fail_close_business_whatsapp_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fail_close_business_whatsapp_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fail_close_verified_product_master_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fail_close_verified_product_master_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_active_rider_delivery"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_active_rider_delivery"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_active_rider_delivery"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_current_customer_profile"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_current_customer_profile"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_current_customer_profile"() TO "service_role";



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



REVOKE ALL ON FUNCTION "public"."has_business_role"("target_business_id" "uuid", "roles" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."has_business_role"("target_business_id" "uuid", "roles" "text"[]) TO "service_role";
GRANT ALL ON FUNCTION "public"."has_business_role"("target_business_id" "uuid", "roles" "text"[]) TO "authenticated";



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



REVOKE ALL ON FUNCTION "public"."list_active_business_riders"("p_business_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_active_business_riders"("p_business_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."list_active_business_riders"("p_business_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."list_available_rider_orders"("p_business_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_available_rider_orders"("p_business_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_available_rider_orders"("p_business_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_order_status_event"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_order_status_event"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_delivery_picked_up"("p_order_id" "uuid", "p_expected_revision" bigint, "p_idempotency_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_delivery_picked_up"("p_order_id" "uuid", "p_expected_revision" bigint, "p_idempotency_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_delivery_picked_up"("p_order_id" "uuid", "p_expected_revision" bigint, "p_idempotency_key" "text") TO "service_role";



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



REVOKE ALL ON FUNCTION "public"."prevent_rider_unverified_delivery"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prevent_rider_unverified_delivery"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_unverified_delivery"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_unverified_delivery"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_unverified_delivery"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."publish_catalog_product"("p_business_id" "uuid", "p_external_id" "text", "p_available" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."publish_catalog_product"("p_business_id" "uuid", "p_external_id" "text", "p_available" boolean) TO "service_role";
GRANT ALL ON FUNCTION "public"."publish_catalog_product"("p_business_id" "uuid", "p_external_id" "text", "p_available" boolean) TO "authenticated";



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



REVOKE ALL ON FUNCTION "public"."recover_order_tracking_access"("p_order_id" "uuid", "p_new_tracking_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."recover_order_tracking_access"("p_order_id" "uuid", "p_new_tracking_token" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."recover_order_tracking_access"("p_order_id" "uuid", "p_new_tracking_token" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."register_catalog_assets"("p_business_id" "uuid", "p_assets" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."register_catalog_assets"("p_business_id" "uuid", "p_assets" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."release_expired_stock_reservations"("p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."release_expired_stock_reservations"("p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."release_or_reassign_delivery"("p_order_id" "uuid", "p_expected_revision" bigint, "p_new_rider_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."release_or_reassign_delivery"("p_order_id" "uuid", "p_expected_revision" bigint, "p_new_rider_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."release_or_reassign_delivery"("p_order_id" "uuid", "p_expected_revision" bigint, "p_new_rider_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."report_rider_delivery_issue"("p_order_id" "uuid", "p_expected_revision" bigint, "p_issue_type" "text", "p_idempotency_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."report_rider_delivery_issue"("p_order_id" "uuid", "p_expected_revision" bigint, "p_issue_type" "text", "p_idempotency_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."report_rider_delivery_issue"("p_order_id" "uuid", "p_expected_revision" bigint, "p_issue_type" "text", "p_idempotency_key" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."request_order_token"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."request_order_token"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."request_order_token_hash"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."request_order_token_hash"() TO "service_role";



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



REVOKE ALL ON FUNCTION "public"."set_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."stage_catalog_products"("p_business_id" "uuid", "p_products" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."stage_catalog_products"("p_business_id" "uuid", "p_products" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."stamp_rider_location_server_time"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."stamp_rider_location_server_time"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."start_rider_delivery"("p_order_id" "uuid", "p_expected_revision" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."start_rider_delivery"("p_order_id" "uuid", "p_expected_revision" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."start_rider_delivery"("p_order_id" "uuid", "p_expected_revision" bigint, "p_idempotency_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."start_rider_delivery"("p_order_id" "uuid", "p_expected_revision" bigint, "p_idempotency_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."start_rider_delivery"("p_order_id" "uuid", "p_expected_revision" bigint, "p_idempotency_key" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."transition_order"("p_order_id" "uuid", "p_expected_revision" bigint, "p_new_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."transition_order"("p_order_id" "uuid", "p_expected_revision" bigint, "p_new_status" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."transition_order"("p_order_id" "uuid", "p_expected_revision" bigint, "p_new_status" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."unpublish_catalog_product"("p_business_id" "uuid", "p_external_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."unpublish_catalog_product"("p_business_id" "uuid", "p_external_id" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."unpublish_catalog_product"("p_business_id" "uuid", "p_external_id" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."upsert_current_customer_address"("p_address" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."upsert_current_customer_address"("p_address" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_current_customer_address"("p_address" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."upsert_current_customer_profile"("p_name" "text", "p_phone" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."upsert_current_customer_profile"("p_name" "text", "p_phone" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_current_customer_profile"("p_name" "text", "p_phone" "text") TO "service_role";


















GRANT ALL ON TABLE "public"."business_members" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."business_members" TO "authenticated";



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



GRANT ALL ON TABLE "public"."customers" TO "service_role";
GRANT SELECT ON TABLE "public"."customers" TO "authenticated";



GRANT ALL ON TABLE "public"."delivery_confirmation_attempts" TO "service_role";



GRANT ALL ON TABLE "public"."delivery_outbox" TO "service_role";



GRANT ALL ON TABLE "public"."order_abuse_events" TO "service_role";
GRANT SELECT ON TABLE "public"."order_abuse_events" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."order_abuse_events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."order_abuse_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."order_abuse_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."order_delivery_handoffs" TO "service_role";



GRANT ALL ON TABLE "public"."order_events" TO "service_role";
GRANT SELECT ON TABLE "public"."order_events" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."order_events_sequence_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."order_events_sequence_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."order_events_sequence_seq" TO "service_role";



GRANT ALL ON TABLE "public"."order_items" TO "service_role";
GRANT SELECT ON TABLE "public"."order_items" TO "anon";
GRANT SELECT ON TABLE "public"."order_items" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."order_public_code_seq" TO "service_role";



GRANT ALL ON TABLE "public"."order_public_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."orders" TO "service_role";
GRANT SELECT ON TABLE "public"."orders" TO "anon";
GRANT SELECT ON TABLE "public"."orders" TO "authenticated";



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



GRANT ALL ON TABLE "public"."riders" TO "service_role";
GRANT SELECT ON TABLE "public"."riders" TO "authenticated";









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































