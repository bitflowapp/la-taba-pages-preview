-- REVERSIÓN de 20261001215000_opening_gate_requires_rules.sql
--
-- Qué hace: devuelve `get_store_opening_readiness`, `platform_verify_business_ordering` y
-- `get_business_opening_status` a su definición anterior, capturada con
-- pg_get_functiondef sobre las 159 migraciones previas.
--
-- Ojo con lo que vuelve a quedar abierto:
--   · la plataforma vuelve a verificar un comercio que no exige horario ni cobertura
--     (los dos ítems vuelven a ser sólo una advertencia) y un comercio sin dueño;
--   · la preparación deja de traer `configuration`, `verification_blockers` y
--     `verification_ready`: revertir primero lo que las lea (Panel, opening:check);
--   · el estado para abrir el día vuelve a contar repartidores en la tabla heredada
--     `public.riders` y a marcar los cobros como falla sin Mercado Pago.
--
-- Qué NO hace: no toca una fila y no revoca ninguna verificación. Un comercio verificado
-- con la regla nueva sigue siendo válido para la anterior. Las filas de auditoría de
-- `platform_verification` que guardaron `configuration` quedan: la auditoría es inmutable
-- y la clave extra no molesta a ningún lector.
-- No depende de las otras dos migraciones del paquete ni ellas de ésta.
--
-- No toca supabase_migrations.schema_migrations. Después:
--   supabase migration repair --status reverted 20261001215000
begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('la-taba:rollback:20261001215000', 0)
);

-- get_store_opening_readiness anterior. CREATE OR REPLACE conserva los privilegios de las tres.
CREATE OR REPLACE FUNCTION public.get_store_opening_readiness(p_business_id uuid, p_min_products integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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
$function$;

-- platform_verify_business_ordering anterior.
CREATE OR REPLACE FUNCTION public.platform_verify_business_ordering(p_business_id uuid, p_verifier_email text, p_confirm_slug text, p_min_products integer DEFAULT 1, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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
$function$;

-- get_business_opening_status anterior.
CREATE OR REPLACE FUNCTION public.get_business_opening_status(p_business_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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
$function$;

-- Se retira también a service_role para volver a concederlos en el orden original de la lista.
revoke all on function public.get_store_opening_readiness(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.get_store_opening_readiness(uuid, integer) to authenticated, service_role;
revoke all on function public.platform_verify_business_ordering(uuid, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.platform_verify_business_ordering(uuid, text, text, integer, text) to service_role;
revoke all on function public.get_business_opening_status(uuid) from public, anon, authenticated;
grant execute on function public.get_business_opening_status(uuid) to authenticated;

commit;
