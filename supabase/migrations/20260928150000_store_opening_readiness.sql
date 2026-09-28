-- ============================================================================
-- PREPARAR LA APERTURA: QUÉ FALTA, EN UN SOLO LUGAR Y SIN PASOS SECRETOS
-- ============================================================================
--
-- EL PROBLEMA
-- -----------
-- Abrir el comercio real dependía de requisitos que no estaban escritos en
-- ningún lugar que el dueño pudiera ver. La noche del 2026-09-28 aparecieron
-- tres de golpe (primera publicación sólo por la planilla, horarios exigidos
-- sin franjas, verificación de plataforma sin herramienta) y, mirando los
-- contratos, había más:
--
--   · el Panel guardaba los horarios SÓLO del canal delivery: un comercio de
--     retiro con horario exigido quedaba cerrado para siempre (BUSINESS_CLOSED);
--   · no había forma de encender delivery o retiro sin tocar la base;
--   · `businesses_ordering_verified_configuration` exige envío y mínimo del
--     COMERCIO con delivery encendido aunque las zonas tengan los suyos;
--   · la verificación de plataforma se escribía con un UPDATE suelto.
--
-- QUÉ AGREGA
-- ----------
--   · `get_store_opening_readiness`: la lista de compuertas, derivada de los
--     mismos contratos que deciden si un pedido nace (`create_order_with_items`,
--     `business_is_open`, `resolve_delivery_zone`), si un producto se publica
--     (`apply_commercial_catalog_batch`, `cp_published_requires_approved_image`)
--     y si el negocio queda verificado (`businesses_ordering_verified_configuration`).
--     Devuelve códigos y hechos contados, nunca identificadores de personas.
--     La leen el Panel (dueño, encargado y equipo) y la herramienta operativa
--     (clave de servicio). Es la ÚNICA fuente: nadie recalcula las reglas.
--   · `platform_verify_business_ordering` / `platform_revoke_business_ordering`:
--     la verificación de plataforma, sólo con clave de servicio, con
--     confirmación escrita, falla cerrada si falta cualquier compuerta y deja
--     auditoría con quién y cuándo. NO abre el comercio.
--   · `set_business_fulfillment`: delivery y retiro desde el Panel.
--   · `set_business_opening_hours`: la grilla del Panel para los DOS canales en
--     una sola transacción (reusa `set_business_service_hours`).
--   · `set_business_address`: la dirección que ve el cliente para retirar.
--   · `set_business_open_state` audita quién abrió, pausó o cerró.
--   · `apply_commercial_catalog_batch` exige la venta de alcohol habilitada para
--     publicar (o republicar) un producto con alcohol, igual que ya lo exigía
--     `set_commercial_product_publication`.
--   · `team_invitation_lookup` / `team_invitation_record_activation`: lo que la
--     función `team-invitation` necesita para que una persona invitada cree su
--     cuenta sin SMTP y sin terminal. Sólo clave de servicio.
--
-- REVERSIÓN: docs/migrations/rollback/20260928150000_store_opening_readiness.rollback.sql
-- (compensatoria, probada en el arnés). No cambia ni borra filas existentes.
-- ============================================================================

-- ── 1 · Auditoría: los nuevos ámbitos y el nuevo evento de identidad ──────────
alter table public.business_config_audit drop constraint if exists business_config_audit_scope_check;
alter table public.business_config_audit add constraint business_config_audit_scope_check check (
  scope = any (array[
    'hours', 'exception', 'zone', 'delivery_pricing', 'enforcement', 'permission', 'payments', 'printing',
    'fulfillment', 'contact', 'open_state', 'platform_verification'
  ])
);

alter table public.identity_audit_events drop constraint if exists identity_audit_events_event_type_check;
alter table public.identity_audit_events add constraint identity_audit_events_event_type_check check (
  event_type = any (array[
    'session_opened', 'session_closed', 'session_revoked', 'sessions_revoked_all', 'session_rejected',
    'member_invited', 'invitation_accepted', 'invitation_revoked', 'member_activated', 'member_disabled',
    'member_role_changed', 'profile_updated', 'authorization_denied', 'access_requested',
    'access_request_approved', 'access_request_rejected', 'invitation_account_activated'
  ])
);

-- ── 2 · Cómo entrega el comercio: delivery, retiro o los dos ─────────────────
create or replace function public.set_business_fulfillment(
  p_business_id uuid,
  p_delivery_enabled boolean,
  p_pickup_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $set_business_fulfillment$
declare
  v_before public.businesses%rowtype;
  v_after public.businesses%rowtype;
begin
  if not public.can_manage_commercial_settings(p_business_id) then
    raise exception 'Sólo el dueño o el encargado pueden cambiar cómo entrega el comercio.' using errcode = '42501';
  end if;
  if p_delivery_enabled is null or p_pickup_enabled is null then
    raise exception 'Indicá si hay delivery y si hay retiro en el local.' using errcode = '22023';
  end if;

  select * into v_before from public.businesses where id = p_business_id for update;
  if not found then
    raise exception 'comercio inexistente' using errcode = 'P0002';
  end if;

  -- Con los pedidos online verificados, la base prohíbe un comercio que no
  -- entrega de ninguna forma (businesses_ordering_verified_configuration). Para
  -- dejar de vender se pausa o se cierra: se dice eso antes de chocar el CHECK.
  if v_before.ordering_verified and not p_delivery_enabled and not p_pickup_enabled then
    raise exception 'Con los pedidos online habilitados tiene que quedar delivery o retiro. Para dejar de vender, pausá o cerrá el negocio.'
      using errcode = '22023';
  end if;
  -- Y con delivery encendido exige el envío y el mínimo DEL COMERCIO, aunque
  -- las zonas tengan los suyos. El mínimo puede ser 0.
  if v_before.ordering_verified and p_delivery_enabled
     and (v_before.delivery_fee is null or v_before.minimum_delivery_subtotal is null) then
    raise exception 'Para encender el delivery primero cargá el costo de envío y el pedido mínimo del comercio (el mínimo puede ser 0).'
      using errcode = '22023';
  end if;

  update public.businesses
     set delivery_enabled = p_delivery_enabled,
         pickup_enabled = p_pickup_enabled,
         updated_at = now()
   where id = p_business_id
  returning * into v_after;

  if v_before.delivery_enabled is distinct from v_after.delivery_enabled
     or v_before.pickup_enabled is distinct from v_after.pickup_enabled then
    insert into public.business_config_audit (business_id, scope, action, actor_kind, actor_id, before, after)
    values (
      p_business_id, 'fulfillment', 'updated',
      case when auth.uid() is null then 'service' else 'user' end, auth.uid(),
      jsonb_build_object('delivery_enabled', v_before.delivery_enabled, 'pickup_enabled', v_before.pickup_enabled),
      jsonb_build_object('delivery_enabled', v_after.delivery_enabled, 'pickup_enabled', v_after.pickup_enabled)
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'delivery_enabled', v_after.delivery_enabled,
    'pickup_enabled', v_after.pickup_enabled
  );
end;
$set_business_fulfillment$;

-- ── 3 · La grilla del Panel para los dos canales, en una transacción ─────────
--
-- `business_is_open` evalúa el canal del pedido. El Panel guardaba sólo
-- `delivery`, así que con el horario exigido un pedido de RETIRO no nacía
-- nunca. Una sola grilla para los dos canales es lo que el dueño entiende por
-- «horario del local»; los dos se reemplazan juntos o no se reemplaza ninguno.
create or replace function public.set_business_opening_hours(p_business_id uuid, p_hours jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $set_business_opening_hours$
declare
  v_delivery jsonb;
  v_pickup jsonb;
begin
  -- Cada llamada autoriza, valida y audita por su cuenta.
  v_delivery := public.set_business_service_hours(p_business_id, 'delivery', p_hours);
  v_pickup := public.set_business_service_hours(p_business_id, 'pickup', p_hours);
  return jsonb_build_object(
    'ok', true,
    'channels', jsonb_build_array('delivery', 'pickup'),
    'count', (v_delivery ->> 'count')::integer,
    'hours', v_delivery -> 'hours',
    'same_for_pickup', (v_delivery -> 'hours') = (v_pickup -> 'hours')
  );
end;
$set_business_opening_hours$;

-- ── 4 · La dirección que ve el cliente para retirar ──────────────────────────
create or replace function public.set_business_address(p_business_id uuid, p_address text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $set_business_address$
declare
  v_address text := regexp_replace(btrim(coalesce(p_address, '')), '\s+', ' ', 'g');
  v_before text;
begin
  if not public.can_manage_commercial_settings(p_business_id) then
    raise exception 'Sólo el dueño o el encargado pueden cambiar la dirección del local.' using errcode = '42501';
  end if;
  if char_length(v_address) < 5 or char_length(v_address) > 180 then
    raise exception 'Escribí la dirección del local: calle, número y ciudad (entre 5 y 180 caracteres).' using errcode = '22023';
  end if;
  -- Un marcador de «todavía no» no es una dirección: la tienda lo escondería y
  -- el retiro quedaría sin lugar al que ir.
  if v_address ~* '(a confirmar|no publicad|sin direcci)' then
    raise exception 'Escribí la dirección real del local, no un texto provisorio.' using errcode = '22023';
  end if;

  select address into v_before from public.businesses where id = p_business_id for update;
  if not found then
    raise exception 'comercio inexistente' using errcode = 'P0002';
  end if;

  update public.businesses set address = v_address, updated_at = now() where id = p_business_id;

  if v_before is distinct from v_address then
    insert into public.business_config_audit (business_id, scope, action, actor_kind, actor_id, before, after)
    values (
      p_business_id, 'contact', 'updated',
      case when auth.uid() is null then 'service' else 'user' end, auth.uid(),
      jsonb_build_object('address', v_before),
      jsonb_build_object('address', v_address)
    );
  end if;

  return jsonb_build_object('ok', true, 'address', v_address);
end;
$set_business_address$;

-- ── 5 · Abrir, pausar y cerrar quedan auditados ──────────────────────────────
-- Mismo contrato que 20260925085000; sólo agrega la fila de auditoría.
create or replace function public.set_business_open_state(p_business_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $set_business_open_state$
declare
  v_business public.businesses%rowtype;
  v_before text;
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

  select status into v_before from public.businesses where id = p_business_id for update;

  update public.businesses set status = p_status, updated_at = now()
   where id = p_business_id
  returning * into v_business;
  if not found then
    raise exception 'negocio inexistente' using errcode = 'P0002';
  end if;

  if v_before is distinct from v_business.status then
    insert into public.business_config_audit (business_id, scope, action, actor_kind, actor_id, before, after)
    values (
      p_business_id, 'open_state', 'updated',
      case when auth.uid() is null then 'service' else 'user' end, auth.uid(),
      jsonb_build_object('status', v_before),
      jsonb_build_object('status', v_business.status)
    );
  end if;

  return jsonb_build_object('ok', true, 'status', v_business.status);
end;
$set_business_open_state$;

-- ── 6 · La planilla y el Panel no publican alcohol con la venta cerrada ──────
-- Mismo cuerpo que el vigente; agrega la compuerta de licencia en la
-- publicación y en la republicación explícita.
create or replace function public.apply_commercial_catalog_batch(p_business_id uuid, p_rows jsonb)
returns table(applied_sku text, applied_price numeric, applied_stock integer, applied_available boolean,
  applied_is_verified boolean, applied_republished boolean, applied_price_status text)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $apply_commercial_catalog_batch$
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
    if v_was_published and not applied_is_verified then
      if applied_price_status = 'confirmed'
         and applied_price > 0
         and coalesce(applied_stock, 0) > 0
         and v_product.is_active
         and v_asset_ok
         and (not coalesce(v_product.is_alcoholic, false) or v_alcohol_open) then
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
$apply_commercial_catalog_batch$;

-- ── 7 · Qué falta para abrir: la única fuente ────────────────────────────────
--
-- Códigos estables (el texto para personas lo pone el Panel y la herramienta
-- operativa a partir del código). `status`:
--   pass    · cumplido
--   pending · falta, y si `blocking` impide verificar o abrir
--   warn    · no impide, pero conviene resolverlo antes de abrir
--   info    · dato para decidir, no es un requisito
--   na      · no aplica a cómo entrega este comercio
--
-- `ready_for_platform_verification`: todas las compuertas bloqueantes salvo la
-- propia verificación. `can_open`: además la verificación de plataforma.
-- `accepting_orders`: abierto, verificado y dentro de horario ahora mismo.
create or replace function public.get_store_opening_readiness(p_business_id uuid, p_min_products integer default 1)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $get_store_opening_readiness$
declare
  v_b public.businesses%rowtype;
  v_min integer := coalesce(p_min_products, 1);
  v_items jsonb := '[]'::jsonb;
  v_pending text[] := '{}';
  v_status text;
  v_blocking boolean;
  v_address text;
  v_address_ok boolean;
  v_contact_digits text;
  v_contact_ok boolean;
  v_tz_ok boolean;
  v_windows_delivery integer;
  v_windows_pickup integer;
  v_checked_channels text[];
  v_missing_channels text[] := '{}';
  v_zones_active integer := 0;
  v_zones_with_fee integer := 0;
  v_point_verified boolean := false;
  v_riders integer := 0;
  v_riders_available integer := 0;
  v_alcohol_open boolean;
  v_image_required boolean;
  v_total integer;
  v_alcoholic integer;
  v_candidates integer;
  v_with_price integer;
  v_with_stock integer;
  v_uncounted integer;
  v_sold_out integer;
  v_with_photo integer;
  v_verified integer;
  v_published integer;
  v_ready_to_publish integer;
  v_settings public.business_payment_settings%rowtype;
  v_seller text;
  v_mp_ready boolean;
  v_ready_for_verification boolean;
  v_can_open boolean;
  v_accepting boolean;
begin
  if v_min < 1 or v_min > 500 then
    raise exception 'el mínimo de productos va de 1 a 500' using errcode = '22023';
  end if;
  -- EXECUTE lo tienen sólo `authenticated` y `service_role`. Una sesión de
  -- persona siempre trae `sub`: sin `sub` sólo puede ser la clave de servicio.
  if auth.uid() is not null
     and not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'sin autorizacion para ver la preparacion de la apertura' using errcode = '42501';
  end if;

  select * into v_b from public.businesses where id = p_business_id;
  if not found then
    raise exception 'comercio inexistente' using errcode = 'P0002';
  end if;

  -- ── Comercio ────────────────────────────────────────────────────────────────
  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'code', 'BUSINESS_ACTIVE', 'group', 'business', 'blocking', true,
    'status', case when v_b.is_active then 'pass' else 'pending' end,
    'facts', '{}'::jsonb));

  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'code', 'CURRENCY', 'group', 'business', 'blocking', true,
    'status', case when coalesce(v_b.currency_code, '') ~ '^[A-Z]{3}$' then 'pass' else 'pending' end,
    'facts', jsonb_build_object('currency', v_b.currency_code)));

  v_address := regexp_replace(btrim(coalesce(v_b.address, '')), '\s+', ' ', 'g');
  v_address_ok := char_length(v_address) >= 5 and v_address !~* '(a confirmar|no publicad|sin direcci)';
  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'code', 'BUSINESS_ADDRESS', 'group', 'business', 'blocking', coalesce(v_b.pickup_enabled, false),
    'status', case when v_address_ok then 'pass' when coalesce(v_b.pickup_enabled, false) then 'pending' else 'warn' end,
    'facts', jsonb_build_object('present', v_address_ok, 'required_for_pickup', coalesce(v_b.pickup_enabled, false))));

  v_contact_digits := regexp_replace(coalesce(v_b.whatsapp_phone, ''), '[^0-9]', '', 'g');
  v_contact_ok := coalesce(v_b.whatsapp_verified, false) and char_length(v_contact_digits) between 8 and 15;
  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'code', 'BUSINESS_CONTACT', 'group', 'business', 'blocking', false,
    'status', case when v_contact_ok then 'pass' else 'warn' end,
    'facts', jsonb_build_object('configured', char_length(v_contact_digits) > 0, 'confirmed', v_contact_ok)));

  -- ── Entrega ─────────────────────────────────────────────────────────────────
  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'code', 'FULFILLMENT_MODE', 'group', 'fulfillment', 'blocking', true,
    'status', case when coalesce(v_b.delivery_enabled, false) or coalesce(v_b.pickup_enabled, false) then 'pass' else 'pending' end,
    'facts', jsonb_build_object('delivery', coalesce(v_b.delivery_enabled, false), 'pickup', coalesce(v_b.pickup_enabled, false))));

  v_tz_ok := v_b.operating_timezone is not null
    and exists (select 1 from pg_catalog.pg_timezone_names where name = v_b.operating_timezone);
  select count(*) filter (where h.channel = 'delivery'), count(*) filter (where h.channel = 'pickup')
    into v_windows_delivery, v_windows_pickup
    from public.business_service_hours h
   where h.business_id = p_business_id;
  v_checked_channels := array_remove(array[
    case when coalesce(v_b.delivery_enabled, false) then 'delivery' end,
    case when coalesce(v_b.pickup_enabled, false) then 'pickup' end], null);
  if cardinality(v_checked_channels) = 0 then
    v_checked_channels := array['delivery', 'pickup'];
  end if;
  if 'delivery' = any (v_checked_channels) and v_windows_delivery = 0 then
    v_missing_channels := array_append(v_missing_channels, 'delivery');
  end if;
  if 'pickup' = any (v_checked_channels) and v_windows_pickup = 0 then
    v_missing_channels := array_append(v_missing_channels, 'pickup');
  end if;
  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'code', 'SERVICE_HOURS', 'group', 'fulfillment', 'blocking', coalesce(v_b.hours_enforced, false),
    'status', case
      when not coalesce(v_b.hours_enforced, false) then 'warn'
      when v_tz_ok and cardinality(v_missing_channels) = 0 then 'pass'
      else 'pending' end,
    'facts', jsonb_build_object(
      'enforced', coalesce(v_b.hours_enforced, false),
      'timezone_ok', v_tz_ok,
      'delivery_windows', v_windows_delivery,
      'pickup_windows', v_windows_pickup,
      'missing_channels', to_jsonb(v_missing_channels),
      'open_now_delivery', public.business_is_open(p_business_id, 'delivery', now()),
      'open_now_pickup', public.business_is_open(p_business_id, 'pickup', now()),
      'next_open_delivery', public.business_next_open_at(p_business_id, 'delivery', now()),
      'next_open_pickup', public.business_next_open_at(p_business_id, 'pickup', now()))));

  if coalesce(v_b.delivery_enabled, false) then
    -- `businesses_ordering_verified_configuration`: con delivery encendido el
    -- comercio verificado necesita envío y mínimo propios (el mínimo puede ser 0).
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'code', 'DELIVERY_PRICING', 'group', 'fulfillment', 'blocking', true,
      'status', case when v_b.delivery_fee is not null and v_b.minimum_delivery_subtotal is not null then 'pass' else 'pending' end,
      'facts', jsonb_build_object(
        'fee_set', v_b.delivery_fee is not null, 'minimum_set', v_b.minimum_delivery_subtotal is not null,
        'fee', v_b.delivery_fee, 'minimum', v_b.minimum_delivery_subtotal)));

    select count(*) filter (where z.is_active),
           count(*) filter (where z.is_active and coalesce(z.delivery_fee, v_b.delivery_fee) is not null)
      into v_zones_active, v_zones_with_fee
      from public.delivery_zones z
     where z.business_id = p_business_id;
    select exists (
      select 1 from private.rider_map_business_locations l
       where l.business_id = p_business_id and l.human_verified
         and l.latitude is not null and l.longitude is not null)
      into v_point_verified;
    if v_b.delivery_max_radius_meters is not null and not v_point_verified then
      v_status := 'pending';
      v_blocking := true;
    elsif coalesce(v_b.delivery_zone_enforced, false) then
      v_status := case when v_zones_with_fee > 0 then 'pass' else 'pending' end;
      v_blocking := true;
    else
      -- Sin exigir zonas, `resolve_delivery_zone` acepta cualquier dirección
      -- con el envío del comercio. Es legítimo, pero conviene decidirlo.
      v_status := 'warn';
      v_blocking := false;
    end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'code', 'DELIVERY_COVERAGE', 'group', 'fulfillment', 'blocking', v_blocking, 'status', v_status,
      'facts', jsonb_build_object(
        'enforced', coalesce(v_b.delivery_zone_enforced, false),
        'active_zones', v_zones_active, 'zones_with_fee', v_zones_with_fee,
        'max_radius_set', v_b.delivery_max_radius_meters is not null, 'point_verified', v_point_verified)));

    select count(*) into v_riders
      from public.business_members bm
      left join public.identity_user_security us on us.business_id = bm.business_id and us.user_id = bm.user_id
     where bm.business_id = p_business_id and bm.role = 'rider' and bm.is_active and us.disabled_at is null;
    select count(*) into v_riders_available
      from public.business_members bm
     where bm.business_id = p_business_id and bm.role = 'rider' and bm.is_active
       and public.rider_availability_effective(p_business_id, bm.user_id);
    -- Sin repartidores el comercio puede entregar por su cuenta y cerrar con
    -- el código del cliente (20260919120000): no es una compuerta.
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'code', 'RIDERS', 'group', 'fulfillment', 'blocking', false,
      'status', case when v_riders > 0 then 'pass' else 'warn' end,
      'facts', jsonb_build_object('riders', v_riders, 'available_now', v_riders_available,
        'presence_required', coalesce(v_b.rider_presence_required, false))));
  else
    v_items := v_items
      || jsonb_build_array(jsonb_build_object('code', 'DELIVERY_PRICING', 'group', 'fulfillment', 'blocking', false,
           'status', 'na', 'facts', '{}'::jsonb))
      || jsonb_build_array(jsonb_build_object('code', 'DELIVERY_COVERAGE', 'group', 'fulfillment', 'blocking', false,
           'status', 'na', 'facts', '{}'::jsonb))
      || jsonb_build_array(jsonb_build_object('code', 'RIDERS', 'group', 'fulfillment', 'blocking', false,
           'status', 'na', 'facts', '{}'::jsonb));
  end if;

  -- ── Catálogo ────────────────────────────────────────────────────────────────
  -- Misma política de alcohol que exige `create_order_with_items`.
  v_alcohol_open := coalesce(v_b.alcohol_sales_enabled, false)
    and v_b.alcohol_minimum_age is not null and v_b.alcohol_sales_start is not null
    and v_b.alcohol_sales_end is not null and v_b.alcohol_timezone is not null;
  -- Espejo exacto de `cp_published_requires_approved_image`: sólo el comercio
  -- real de CONTROLLED_PRODUCTION publica con foto aprobada obligatoria.
  v_image_required := p_business_id = 'e7850ad2-a447-402c-8375-3fd74e9466ba'::uuid;

  with catalog as (
    select p.*,
           p.is_active and (not coalesce(p.is_alcoholic, false) or v_alcohol_open) as sellable,
           p.price_status = 'confirmed' and coalesce(p.price, 0) > 0 as priced,
           p.stock is not null and p.stock > 0 as stocked,
           p.catalog_asset_id is not null and p.image_url is not null and public.product_commercial_image_valid(p) as with_image
      from public.products p
     where p.business_id = p_business_id
  )
  select count(*),
         count(*) filter (where coalesce(is_alcoholic, false)),
         count(*) filter (where sellable),
         count(*) filter (where sellable and priced),
         count(*) filter (where sellable and stocked),
         count(*) filter (where sellable and stock is null),
         count(*) filter (where sellable and stock = 0),
         count(*) filter (where sellable and with_image),
         count(*) filter (where sellable and is_verified),
         count(*) filter (where sellable and available),
         count(*) filter (where sellable and not available and priced and stocked
                           and (with_image or not v_image_required))
    into v_total, v_alcoholic, v_candidates, v_with_price, v_with_stock, v_uncounted, v_sold_out,
         v_with_photo, v_verified, v_published, v_ready_to_publish
    from catalog;

  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'code', 'CATALOG_PRICES', 'group', 'catalog', 'blocking', true,
    'status', case when v_with_price >= v_min then 'pass' else 'pending' end,
    'facts', jsonb_build_object('with_price', v_with_price, 'candidates', v_candidates, 'min', v_min)));
  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'code', 'CATALOG_STOCK', 'group', 'catalog', 'blocking', true,
    'status', case when v_with_stock >= v_min then 'pass' else 'pending' end,
    'facts', jsonb_build_object('with_stock', v_with_stock, 'uncounted', v_uncounted, 'sold_out', v_sold_out,
      'candidates', v_candidates, 'min', v_min)));
  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'code', 'CATALOG_PHOTOS', 'group', 'catalog', 'blocking', v_image_required,
    'status', case when not v_image_required then 'na' when v_with_photo >= v_min then 'pass' else 'pending' end,
    'facts', jsonb_build_object('required', v_image_required, 'with_photo', v_with_photo,
      'candidates', v_candidates, 'min', v_min)));
  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'code', 'CATALOG_PUBLISHED', 'group', 'catalog', 'blocking', true,
    'status', case when v_published >= v_min then 'pass' else 'pending' end,
    'facts', jsonb_build_object('published', v_published, 'verified', v_verified,
      'ready_to_publish', v_ready_to_publish, 'min', v_min)));

  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'code', 'ALCOHOL_POLICY', 'group', 'catalog', 'blocking', false,
    'status', case when v_alcohol_open then 'pass' else 'info' end,
    'facts', jsonb_build_object('enabled', v_alcohol_open, 'alcoholic_products', v_alcoholic)));

  -- ── Pagos ───────────────────────────────────────────────────────────────────
  -- Efectivo y «a coordinar» (que el comercio confirma como efectivo o
  -- transferencia) no dependen de ninguna configuración.
  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'code', 'PAYMENT_MANUAL', 'group', 'payments', 'blocking', true, 'status', 'pass',
    'facts', jsonb_build_object('methods', jsonb_build_array('cash', 'coordinate'))));

  select * into v_settings from public.business_payment_settings s
   where s.business_id = p_business_id and s.provider = 'mercadopago';
  select c.status into v_seller
    from public.mp_seller_connections c
   where c.business_id = p_business_id
   order by (c.status = 'connected') desc, (c.environment = coalesce(v_settings.environment, 'production')) desc
   limit 1;
  v_mp_ready := coalesce((public.get_mercadopago_checkout_availability(p_business_id) ->> 'available')::boolean, false)
    or (
      coalesce(v_settings.enabled, false)
      and v_settings.checkout_mode = 'checkout_pro'
      and v_settings.currency = 'ARS'
      and (v_settings.environment <> 'production' or v_settings.production_review_status = 'approved')
      and exists (
        select 1 from public.mp_seller_connections c
         where c.business_id = p_business_id and c.environment = v_settings.environment
           and c.status = 'connected' and c.protected_tokens is not null
           and c.seller_id = v_settings.collector_id and c.application_id = v_settings.application_id)
    );
  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'code', 'PAYMENT_MERCADOPAGO', 'group', 'payments', 'blocking', false,
    'status', case when v_mp_ready then 'pass' else 'info' end,
    'facts', jsonb_build_object(
      'seller', coalesce(v_seller, 'none'),
      'platform_enabled', coalesce(v_settings.enabled, false),
      'review_approved', coalesce(v_settings.production_review_status, '') = 'approved',
      'ready', v_mp_ready)));

  -- ── Plataforma y apertura ───────────────────────────────────────────────────
  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'code', 'PLATFORM_VERIFICATION', 'group', 'platform', 'blocking', true,
    'status', case when v_b.ordering_verified and v_b.ordering_enabled then 'pass' else 'pending' end,
    'facts', jsonb_build_object('verified', v_b.ordering_verified, 'enabled', v_b.ordering_enabled,
      'verified_at', v_b.ordering_verified_at)));

  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'code', 'STORE_OPEN', 'group', 'open', 'blocking', false,
    'status', case when v_b.status = 'open' then 'pass' else 'info' end,
    'facts', jsonb_build_object('status', v_b.status)));

  select coalesce(array_agg(item ->> 'code' order by ordinality), '{}')
    into v_pending
    from jsonb_array_elements(v_items) with ordinality as e(item, ordinality)
   where (item ->> 'blocking')::boolean and item ->> 'status' <> 'pass';

  v_ready_for_verification := not exists (
    select 1 from unnest(v_pending) as code where code <> 'PLATFORM_VERIFICATION');
  v_can_open := cardinality(v_pending) = 0;
  v_accepting := v_can_open and v_b.status = 'open' and v_b.is_active and (
    (coalesce(v_b.delivery_enabled, false) and public.business_is_open(p_business_id, 'delivery', now()))
    or (coalesce(v_b.pickup_enabled, false) and public.business_is_open(p_business_id, 'pickup', now())));

  return jsonb_build_object(
    'generated_at', clock_timestamp(),
    'business_id', p_business_id,
    'business', jsonb_build_object('slug', v_b.slug, 'name', v_b.name, 'status', v_b.status),
    'min_products', v_min,
    'items', v_items,
    'counts', jsonb_build_object(
      'products', v_total, 'alcoholic', v_alcoholic, 'candidates', v_candidates,
      'with_price', v_with_price, 'with_stock', v_with_stock, 'uncounted', v_uncounted, 'sold_out', v_sold_out,
      'with_photo', v_with_photo, 'verified', v_verified, 'published', v_published,
      'ready_to_publish', v_ready_to_publish),
    'pending', to_jsonb(v_pending),
    'ready_for_platform_verification', v_ready_for_verification,
    'can_open', v_can_open,
    'accepting_orders', v_accepting
  );
end;
$get_store_opening_readiness$;

-- ── 8 · Verificación de plataforma: sólo clave de servicio, falla cerrada ────
create or replace function public.platform_verify_business_ordering(
  p_business_id uuid,
  p_verifier_email text,
  p_confirm_slug text,
  p_min_products integer default 1,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $platform_verify_business_ordering$
declare
  v_b public.businesses%rowtype;
  v_verifier uuid;
  v_readiness jsonb;
  v_pending text[];
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  -- EXECUTE es sólo de `service_role`. Una sesión de persona nunca llega acá.
  if auth.uid() is not null then
    raise exception 'la verificacion de plataforma no se hace desde una sesion de persona' using errcode = '42501';
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'la nota va hasta 300 caracteres' using errcode = '22023';
  end if;

  select * into v_b from public.businesses where id = p_business_id for update;
  if not found then
    raise exception 'comercio inexistente' using errcode = 'P0002';
  end if;
  if coalesce(btrim(p_confirm_slug), '') <> v_b.slug then
    raise exception 'CONFIRMATION_MISMATCH' using errcode = '22023',
      detail = 'para confirmar hay que escribir el identificador exacto del comercio';
  end if;

  select u.id into v_verifier
    from auth.users u
   where lower(btrim(coalesce(u.email, ''))) = lower(btrim(coalesce(p_verifier_email, '')))
     and btrim(coalesce(p_verifier_email, '')) <> ''
     and not coalesce(u.is_anonymous, false)
     and u.email_confirmed_at is not null
     and u.deleted_at is null
     and (u.banned_until is null or u.banned_until <= now())
   limit 1;
  if v_verifier is null then
    raise exception 'VERIFIER_NOT_FOUND' using errcode = '22023',
      detail = 'quien verifica tiene que tener una cuenta confirmada y activa';
  end if;

  if v_b.ordering_verified and v_b.ordering_enabled then
    return jsonb_build_object('ok', true, 'changed', false, 'status', v_b.status,
      'verified_at', v_b.ordering_verified_at);
  end if;

  v_readiness := public.get_store_opening_readiness(p_business_id, p_min_products);
  select coalesce(array_agg(code), '{}') into v_pending
    from jsonb_array_elements_text(v_readiness -> 'pending') as code
   where code <> 'PLATFORM_VERIFICATION';
  if cardinality(v_pending) > 0 then
    raise exception 'OPENING_NOT_READY' using errcode = '55000', detail = array_to_string(v_pending, ',');
  end if;

  update public.businesses
     set ordering_verified = true,
         ordering_verified_at = now(),
         ordering_verified_by = v_verifier,
         ordering_enabled = true,
         updated_at = now()
   where id = p_business_id
  returning * into v_b;

  insert into public.business_config_audit (business_id, scope, action, actor_kind, actor_id, before, after)
  values (
    p_business_id, 'platform_verification', 'enabled', 'user', v_verifier,
    jsonb_build_object('ordering_verified', false, 'ordering_enabled', false),
    jsonb_build_object('ordering_verified', true, 'ordering_enabled', true,
      'min_products', v_readiness -> 'min_products', 'note', v_note,
      'counts', v_readiness -> 'counts')
  );

  -- No abre el comercio: abrir es el botón del dueño.
  return jsonb_build_object('ok', true, 'changed', true, 'status', v_b.status,
    'verified_at', v_b.ordering_verified_at, 'ordering_enabled', v_b.ordering_enabled);
end;
$platform_verify_business_ordering$;

create or replace function public.platform_revoke_business_ordering(
  p_business_id uuid,
  p_actor_email text,
  p_confirm_slug text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $platform_revoke_business_ordering$
declare
  v_b public.businesses%rowtype;
  v_actor uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is not null then
    raise exception 'la verificacion de plataforma no se hace desde una sesion de persona' using errcode = '42501';
  end if;
  if v_reason is null or char_length(v_reason) < 3 or char_length(v_reason) > 300 then
    raise exception 'el motivo va de 3 a 300 caracteres' using errcode = '22023';
  end if;
  select * into v_b from public.businesses where id = p_business_id for update;
  if not found then
    raise exception 'comercio inexistente' using errcode = 'P0002';
  end if;
  if coalesce(btrim(p_confirm_slug), '') <> v_b.slug then
    raise exception 'CONFIRMATION_MISMATCH' using errcode = '22023',
      detail = 'para confirmar hay que escribir el identificador exacto del comercio';
  end if;
  select u.id into v_actor
    from auth.users u
   where lower(btrim(coalesce(u.email, ''))) = lower(btrim(coalesce(p_actor_email, '')))
     and btrim(coalesce(p_actor_email, '')) <> ''
     and not coalesce(u.is_anonymous, false)
     and u.email_confirmed_at is not null
     and u.deleted_at is null
   limit 1;
  if v_actor is null then
    raise exception 'VERIFIER_NOT_FOUND' using errcode = '22023',
      detail = 'quien revoca tiene que tener una cuenta confirmada';
  end if;
  if not v_b.ordering_verified and not v_b.ordering_enabled then
    return jsonb_build_object('ok', true, 'changed', false, 'status', v_b.status);
  end if;

  update public.businesses
     set ordering_enabled = false,
         ordering_verified = false,
         ordering_verified_at = null,
         ordering_verified_by = null,
         updated_at = now()
   where id = p_business_id
  returning * into v_b;

  insert into public.business_config_audit (business_id, scope, action, actor_kind, actor_id, before, after)
  values (
    p_business_id, 'platform_verification', 'disabled', 'user', v_actor,
    jsonb_build_object('ordering_verified', true, 'ordering_enabled', true),
    jsonb_build_object('ordering_verified', false, 'ordering_enabled', false, 'reason', v_reason)
  );
  return jsonb_build_object('ok', true, 'changed', true, 'status', v_b.status);
end;
$platform_revoke_business_ordering$;

-- ── 9 · Invitaciones sin SMTP: lo que necesita la función `team-invitation` ──
--
-- CP exige confirmar el correo y no tiene SMTP. Hasta acá, cada persona nueva
-- del equipo necesitaba que un operador con la clave de servicio le creara la
-- cuenta y le pasara un enlace de un solo uso. La invitación que genera el
-- dueño desde el Panel ya es ese vínculo de confianza: quien la tiene, y sabe
-- a qué correo está dirigida, puede crear su cuenta.
--
-- Estas dos funciones sólo LEEN y AUDITAN. Crear la identidad y el enlace de
-- contraseña lo hace la función de borde con la API de administración; la
-- membresía la sigue otorgando `identity_accept_invitation`, con la sesión de
-- la persona, igual que siempre.
create or replace function public.team_invitation_lookup(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $team_invitation_lookup$
declare
  v_hash text;
  v_inv public.identity_invitations%rowtype;
  v_business_name text;
  v_user_id uuid;
  v_last_sign_in timestamptz;
  v_invitation_marker text;
  v_banned_until timestamptz;
begin
  if auth.uid() is not null then
    raise exception 'sin autorizacion' using errcode = '42501';
  end if;
  if coalesce(btrim(p_token), '') !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('found', false);
  end if;
  v_hash := encode(digest(btrim(p_token), 'sha256'), 'hex');
  select * into v_inv from public.identity_invitations i where i.token_hash = v_hash;
  if not found then
    return jsonb_build_object('found', false);
  end if;
  select b.name into v_business_name from public.businesses b where b.id = v_inv.business_id;

  select u.id, u.last_sign_in_at, u.raw_user_meta_data ->> 'taba_invitation_id', u.banned_until
    into v_user_id, v_last_sign_in, v_invitation_marker, v_banned_until
    from auth.users u
   where lower(btrim(coalesce(u.email, ''))) = v_inv.invited_email
     and not coalesce(u.is_anonymous, false)
     and u.deleted_at is null
   order by u.created_at
   limit 1;

  return jsonb_build_object(
    'found', true,
    'status', case
      when v_inv.accepted_at is not null then 'accepted'
      when v_inv.revoked_at is not null then 'revoked'
      when v_inv.expires_at <= now() then 'expired'
      else 'pending' end,
    'invitation_id', v_inv.id,
    'business_id', v_inv.business_id,
    'business_name', v_business_name,
    'invited_email', v_inv.invited_email,
    'invited_role', v_inv.invited_role,
    'full_name', v_inv.full_name,
    'expires_at', v_inv.expires_at,
    'account', jsonb_build_object(
      'exists', v_user_id is not null,
      'user_id', v_user_id,
      'created_by_invitation', v_invitation_marker is not null and v_invitation_marker = v_inv.id::text,
      'ever_signed_in', v_last_sign_in is not null,
      'banned', v_banned_until is not null and v_banned_until > now()
    )
  );
end;
$team_invitation_lookup$;

create or replace function public.team_invitation_record_activation(p_token text, p_user_id uuid, p_account_created boolean)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $team_invitation_record_activation$
declare
  v_inv public.identity_invitations%rowtype;
begin
  if auth.uid() is not null then
    raise exception 'sin autorizacion' using errcode = '42501';
  end if;
  if coalesce(btrim(p_token), '') !~ '^[0-9a-f]{64}$' or p_user_id is null or p_account_created is null then
    raise exception 'datos de activacion invalidos' using errcode = '22023';
  end if;
  select * into v_inv from public.identity_invitations i
   where i.token_hash = encode(digest(btrim(p_token), 'sha256'), 'hex');
  if not found or v_inv.accepted_at is not null or v_inv.revoked_at is not null or v_inv.expires_at <= now() then
    raise exception 'invitacion no vigente' using errcode = '22023';
  end if;
  perform public.identity_record_audit_event(
    p_event_type => 'invitation_account_activated',
    p_business_id => v_inv.business_id,
    p_actor_user_id => null,
    p_actor_role => 'system',
    p_subject_user_id => p_user_id,
    p_session_id => null,
    p_metadata => jsonb_build_object('invitation_id', v_inv.id, 'invited_role', v_inv.invited_role,
      'account_created', p_account_created)
  );
  return jsonb_build_object('ok', true);
end;
$team_invitation_record_activation$;

-- ── 11 · La configuración que lee el Panel trae los datos del local ─────────
-- Mismo contrato que el vigente; agrega dirección, WhatsApp y si quien mira
-- puede confirmarlo, para que «Horarios y cobertura» muestre lo que hay.
create or replace function public.get_business_operations_config(p_business_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_business public.businesses%rowtype;
  v_can_manage boolean := public.can_manage_commercial_settings(p_business_id);
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'sin autorizacion para leer la configuracion' using errcode = '42501';
  end if;
  select * into v_business from public.businesses where id = p_business_id;
  if not found then
    raise exception 'comercio inexistente' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'business_id', p_business_id,
    'can_manage', v_can_manage,
    'operating_timezone', v_business.operating_timezone,
    'hours_enforced', v_business.hours_enforced,
    'delivery_zone_enforced', v_business.delivery_zone_enforced,
    'alcohol_hours_enforced', v_business.alcohol_hours_enforced,
    -- Las cinco que `create_order` exige juntas. Se devuelven juntas, y con el
    -- mismo nombre que tienen en la tabla, para que quien lea esto pueda
    -- comparar contra el mensaje de error sin traducir nada.
    'alcohol_sales_enabled', v_business.alcohol_sales_enabled,
    'alcohol_minimum_age', v_business.alcohol_minimum_age,
    'alcohol_sales_start', to_char(v_business.alcohol_sales_start, 'HH24:MI'),
    'alcohol_sales_end', to_char(v_business.alcohol_sales_end, 'HH24:MI'),
    'alcohol_timezone', v_business.alcohol_timezone,
    -- Y la conclusión ya sacada, que es lo que de verdad se quiere saber: si un
    -- pedido con alcohol puede entrar AHORA. Calcularla acá evita que cada
    -- superficie la reimplemente y se equivoque distinto.
    'alcohol_policy_complete', (
      v_business.alcohol_minimum_age is not null
      and v_business.alcohol_sales_start is not null
      and v_business.alcohol_sales_end is not null
      and v_business.alcohol_timezone is not null
      and btrim(coalesce(v_business.alcohol_timezone, '')) <> ''
    ),
    'delivery_enabled', v_business.delivery_enabled,
    'pickup_enabled', v_business.pickup_enabled,
    -- Los datos del local que ve el cliente: dirección para retirar y WhatsApp.
    -- El WhatsApp lo confirma sólo el dueño o el encargado (set_business_whatsapp_contact).
    'address', v_business.address,
    'whatsapp_phone', v_business.whatsapp_phone,
    'whatsapp_verified', coalesce(v_business.whatsapp_verified, false),
    'can_manage_contact', public.has_business_role(p_business_id, array['owner', 'admin']),
    'delivery_fee', v_business.delivery_fee,
    'minimum_delivery_subtotal', v_business.minimum_delivery_subtotal,
    'delivery_max_radius_meters', v_business.delivery_max_radius_meters,
    'is_open_delivery', public.business_is_open(p_business_id, 'delivery', now()),
    'is_open_pickup', public.business_is_open(p_business_id, 'pickup', now()),
    'next_open_at', public.business_next_open_at(p_business_id, 'delivery', now()),
    'hours', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', h.id, 'channel', h.channel, 'weekday', h.weekday,
               'opens_at', to_char(h.opens_at, 'HH24:MI'), 'closes_at', to_char(h.closes_at, 'HH24:MI'))
             order by h.channel, h.weekday, h.opens_at), '[]'::jsonb)
        from public.business_service_hours h where h.business_id = p_business_id),
    'exceptions', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', e.id, 'channel', e.channel, 'on_date', e.on_date, 'is_closed', e.is_closed,
               'opens_at', to_char(e.opens_at, 'HH24:MI'), 'closes_at', to_char(e.closes_at, 'HH24:MI'),
               'note', e.note)
             order by e.on_date, e.channel), '[]'::jsonb)
        from public.business_service_exceptions e
       where e.business_id = p_business_id and e.on_date >= (now() - interval '30 days')::date),
    'zones', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', z.id, 'name', z.name, 'is_active', z.is_active, 'match_kind', z.match_kind,
               'area', z.area_normalized, 'boundary_points', case when z.boundary is null then 0 else npoints(z.boundary) end,
               'delivery_fee', z.delivery_fee, 'minimum_subtotal', z.minimum_subtotal,
               'priority', z.priority, 'notes', z.notes)
             order by z.priority, z.name), '[]'::jsonb)
        from public.delivery_zones z where z.business_id = p_business_id),
    -- La auditoría la ve quien puede cambiar la configuración. Un staff sin
    -- delegación no ve quién movió los precios.
    'audit', case when v_can_manage then (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', a.id, 'scope', a.scope, 'action', a.action,
               'actor_kind', a.actor_kind, 'actor_id', a.actor_id,
               'before', a.before, 'after', a.after, 'created_at', a.created_at)
             order by a.created_at desc), '[]'::jsonb)
        from (select * from public.business_config_audit
               where business_id = p_business_id
               order by created_at desc limit 50) a
    ) else '[]'::jsonb end);
end;
$function$;

-- ── 10 · Superficie de ejecución ─────────────────────────────────────────────
revoke all on function public.set_business_fulfillment(uuid, boolean, boolean) from public, anon;
revoke all on function public.set_business_opening_hours(uuid, jsonb) from public, anon;
revoke all on function public.set_business_address(uuid, text) from public, anon;
revoke all on function public.get_store_opening_readiness(uuid, integer) from public, anon;
revoke all on function public.platform_verify_business_ordering(uuid, text, text, integer, text) from public, anon, authenticated;
revoke all on function public.platform_revoke_business_ordering(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.team_invitation_lookup(text) from public, anon, authenticated;
revoke all on function public.team_invitation_record_activation(text, uuid, boolean) from public, anon, authenticated;

grant execute on function public.set_business_fulfillment(uuid, boolean, boolean) to authenticated, service_role;
grant execute on function public.set_business_opening_hours(uuid, jsonb) to authenticated, service_role;
grant execute on function public.set_business_address(uuid, text) to authenticated, service_role;
grant execute on function public.get_store_opening_readiness(uuid, integer) to authenticated, service_role;
grant execute on function public.platform_verify_business_ordering(uuid, text, text, integer, text) to service_role;
grant execute on function public.platform_revoke_business_ordering(uuid, text, text, text) to service_role;
grant execute on function public.team_invitation_lookup(text) to service_role;
grant execute on function public.team_invitation_record_activation(text, uuid, boolean) to service_role;
