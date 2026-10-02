-- La plataforma no verifica un comercio sin reglas, y la preparación de la apertura dice cada
-- dato de configuración que falta.
--
-- QUÉ ESTABA ABIERTO (medido el 2026-10-01 sobre las 159 migraciones anteriores)
--
--   1. `platform_verify_business_ordering` sólo se niega por los ítems BLOQUEANTES de
--      `get_store_opening_readiness`. SERVICE_HOURS es bloqueante únicamente cuando
--      `hours_enforced` ya está encendido, y DELIVERY_COVERAGE únicamente cuando
--      `delivery_zone_enforced` ya lo está o hay un tope de distancia. Con las dos exigencias
--      apagadas —el valor por defecto de las dos columnas— los dos ítems son `warn`. Un
--      comercio con delivery encendido, envío y mínimo cargados, un producto publicado, CERO
--      franjas horarias y CERO zonas quedaba verificado: desde ahí, abierto a mano, toma
--      pedidos a cualquier hora y a cualquier dirección con el envío del comercio.
--      Los casos «horario exigido sin franjas» y «cobertura exigida sin zonas» ya se
--      rechazaban; el agujero era no exigir.
--   2. La preparación no decía nada del dueño, del equipo, de la configuración fiscal, de la
--      impresión ni del plazo de pedidos abandonados, y no distinguía «no hace falta» de
--      «falta».
--   3. `get_business_opening_status` contaba repartidores en `public.riders`, una tabla
--      anterior a la que nadie le escribe: con dos repartidores conectados decía «No hay
--      repartidores disponibles ahora». Y marcaba los cobros como `failed` en un comercio
--      que cobra en efectivo o por transferencia y nunca configuró Mercado Pago.
--
-- QUÉ QUEDA
--
--   · La verificación de plataforma se niega (55000, OPENING_NOT_READY, con los códigos de
--     siempre en `detail`) mientras:
--       SERVICE_HOURS      el horario no se exija, no haya huso válido o le falte al menos
--                          una franja a un canal encendido;
--       DELIVERY_COVERAGE  con delivery encendido, la cobertura no se exija o no haya una
--                          zona activa con costo de envío (o haya un tope de distancia sin
--                          el punto del local verificado);
--       BUSINESS_OWNER     el comercio no tenga un dueño activo.
--     Un comercio que atiende las 24 horas lo dice con la grilla 00:00–24:00, que ya existe:
--     lo que deja de valer es no decir nada.
--   · `get_store_opening_readiness` suma tres claves y no cambia ninguna de las que tenía:
--       configuration          una entrada por dato (OWNER, SERVICE_HOURS, DELIVERY_ZONES,
--                              DELIVERY_FEES, MINIMUM_ORDER, PICKUP, STAFF, RIDERS,
--                              MERCADOPAGO_SELLER, FISCAL_CONFIG, PRINTER_CONFIG,
--                              ABANDONED_ORDER_POLICY) con `status` CONFIGURED / MISSING /
--                              NOT_REQUIRED, `blocks_opening`, `gate` y `facts`;
--       verification_blockers  los códigos por los que la verificación se va a negar;
--       verification_ready     si esa lista está vacía.
--     `blocks_opening` es verdadero sólo donde la verificación de verdad se niega: no hay
--     un bloqueo anunciado que la base no aplique, ni uno aplicado que no se anuncie.
--   · La verificación deja en su auditoría la configuración con la que se verificó.
--   · `get_business_opening_status` cuenta repartidores igual que la preparación
--     (integrantes activos con disponibilidad vigente) y no llama falla a cobrar en mano.
--
-- QUÉ NO CAMBIA
--
--   · `items`, `counts`, `pending`, `ready_for_platform_verification`, `can_open` y
--     `accepting_orders` salen exactamente como salían, para el Panel y los scripts que ya
--     los leen. Por eso `ready_for_platform_verification` puede seguir en true mientras
--     `verification_ready` es false: quien decide es la verificación, y contesta con los
--     códigos. El Panel y `opening:check` tienen que pasar a leer `verification_ready` y
--     `verification_blockers` para anunciar «listo para verificar».
--   · Un comercio YA verificado no se toca: esta migración no revoca nada ni cambia una
--     fila. La verificación idempotente sigue contestando `changed: false`.
--   · No se inventa un horario, una zona, un envío, un mínimo ni un plazo: se exige que
--     estén, no se escriben.
--   · Los privilegios de las tres funciones quedan como estaban.
--
-- LO QUE ESTO NO CIERRA
--
--   Un comercio verificado sólo con retiro puede encender el delivery después, sin
--   cobertura exigida, por `set_business_fulfillment` o con un UPDATE directo de la columna
--   `delivery_enabled` (el dueño y el encargado la tienen concedida). Esas dos puertas no
--   se tocan acá. La preparación lo muestra (DELIVERY_ZONES en MISSING con
--   `blocks_opening`, y el código en `verification_blockers`), pero nada lo impide.
--
-- Forward-only. No toca filas.
-- Reversión: docs/migrations/rollback/20261001215000_opening_gate_requires_rules.rollback.sql

-- ── 1. La preparación de la apertura: lo que ya decía, más cada dato de configuración ────
create or replace function public.get_store_opening_readiness(
  p_business_id uuid,
  p_min_products integer default 1
) returns jsonb
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
  v_owners integer := 0;
  v_team integer := 0;
  v_commercial_managers integer := 0;
  v_declared_zones integer := 0;
  v_polygon_zones integer := 0;
  v_zones_own_fee integer := 0;
  v_declared_prices integer := 0;
  v_hours_ready boolean;
  v_coverage_ready boolean;
  v_delivery boolean;
  v_pickup boolean;
  v_fiscal_enabled boolean := false;
  v_fiscal_environment text;
  v_auto_print boolean := false;
  v_print_devices integer := 0;
  v_configuration jsonb := '[]'::jsonb;
  v_config_gates text[] := '{}';
  v_verification_blockers text[] := '{}';
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

  -- ── Configuración que el comercio tiene que tener antes de tomar pedidos ────
  -- Es ADITIVO: `items`, `pending`, `ready_for_platform_verification`, `can_open`
  -- y `accepting_orders` salen exactamente como salían. Acá cada dato se dice con
  -- tres estados (CONFIGURED, MISSING, NOT_REQUIRED) y con `blocks_opening`, que
  -- es verdadero sólo donde `platform_verify_business_ordering` se niega mientras
  -- falte. `gate` es el código con el que esa negativa lo nombra.
  v_delivery := coalesce(v_b.delivery_enabled, false);
  v_pickup := coalesce(v_b.pickup_enabled, false);

  select count(*) filter (where bm.role = 'owner'),
         count(*) filter (where bm.role in ('admin', 'staff'))
    into v_owners, v_team
    from public.business_members bm
    left join public.identity_user_security us on us.business_id = bm.business_id and us.user_id = bm.user_id
   where bm.business_id = p_business_id and bm.is_active and us.disabled_at is null;
  select count(*) into v_commercial_managers
    from public.business_commercial_managers m
   where m.business_id = p_business_id;

  -- Sin horario exigido el comercio toma pedidos a cualquier hora mientras esté
  -- abierto a mano; sin cobertura exigida, a cualquier dirección. Las dos cosas
  -- eran una advertencia y la plataforma verificaba igual.
  v_hours_ready := coalesce(v_b.hours_enforced, false) and v_tz_ok and cardinality(v_missing_channels) = 0;
  v_coverage_ready := coalesce(v_b.delivery_zone_enforced, false) and v_zones_with_fee > 0
    and (v_b.delivery_max_radius_meters is null or v_point_verified);

  select count(*) filter (where z.match_kind = 'declared_area'),
         count(*) filter (where z.match_kind = 'polygon'),
         count(*) filter (where z.delivery_fee is not null),
         count(distinct coalesce(coalesce(z.delivery_fee, v_b.delivery_fee)::text, '-') || '|'
                        || coalesce(coalesce(z.minimum_subtotal, v_b.minimum_delivery_subtotal)::text, '-'))
           filter (where z.match_kind = 'declared_area')
    into v_declared_zones, v_polygon_zones, v_zones_own_fee, v_declared_prices
    from public.delivery_zones z
   where z.business_id = p_business_id and z.is_active;

  select coalesce(fp.is_enabled, false) and coalesce(fp.environment, 'disabled') <> 'disabled', fp.environment
    into v_fiscal_enabled, v_fiscal_environment
    from public.fiscal_profiles fp
   where fp.business_id = p_business_id;
  v_fiscal_enabled := coalesce(v_fiscal_enabled, false);

  select coalesce(ps.auto_print_enabled, false) into v_auto_print
    from public.business_print_settings ps
   where ps.business_id = p_business_id;
  v_auto_print := coalesce(v_auto_print, false);
  select count(*) into v_print_devices
    from public.local_devices ld
   where ld.business_id = p_business_id and ld.status = 'active';

  v_configuration := jsonb_build_array(
    -- Sin un dueño activo nadie puede cerrar el negocio, cambiar horarios o
    -- zonas, ni responder por la caja.
    jsonb_build_object('code', 'OWNER', 'gate', 'BUSINESS_OWNER', 'blocks_opening', true,
      'status', case when v_owners > 0 then 'CONFIGURED' else 'MISSING' end,
      'facts', jsonb_build_object('owners', v_owners)),
    jsonb_build_object('code', 'SERVICE_HOURS', 'gate', 'SERVICE_HOURS', 'blocks_opening', true,
      'status', case when v_hours_ready then 'CONFIGURED' else 'MISSING' end,
      'facts', jsonb_build_object(
        'enforced', coalesce(v_b.hours_enforced, false),
        'timezone_ok', v_tz_ok,
        'delivery_windows', v_windows_delivery,
        'pickup_windows', v_windows_pickup,
        'missing_channels', to_jsonb(v_missing_channels))),
    jsonb_build_object('code', 'DELIVERY_ZONES', 'gate', 'DELIVERY_COVERAGE', 'blocks_opening', v_delivery,
      'status', case when not v_delivery then 'NOT_REQUIRED' when v_coverage_ready then 'CONFIGURED' else 'MISSING' end,
      'facts', jsonb_build_object(
        'enforced', coalesce(v_b.delivery_zone_enforced, false),
        'active_zones', v_zones_active,
        'zones_with_fee', v_zones_with_fee,
        'declared_zones', v_declared_zones,
        'polygon_zones', v_polygon_zones,
        'max_radius_set', v_b.delivery_max_radius_meters is not null,
        'point_verified', v_point_verified,
        -- Con barrios declarados de distinto precio el cliente elige el barrio y
        -- con él el envío y el mínimo; el tope de distancia no distingue zonas.
        'declared_prices', v_declared_prices,
        'customer_selects_price', coalesce(v_b.delivery_zone_enforced, false) and v_declared_prices > 1)),
    jsonb_build_object('code', 'DELIVERY_FEES', 'gate', 'DELIVERY_PRICING', 'blocks_opening', v_delivery,
      'status', case when not v_delivery then 'NOT_REQUIRED' when v_b.delivery_fee is not null then 'CONFIGURED' else 'MISSING' end,
      'facts', jsonb_build_object('business_fee_set', v_b.delivery_fee is not null, 'fee', v_b.delivery_fee,
        'zones_with_own_fee', v_zones_own_fee)),
    jsonb_build_object('code', 'MINIMUM_ORDER', 'gate', 'DELIVERY_PRICING', 'blocks_opening', v_delivery,
      'status', case when not v_delivery then 'NOT_REQUIRED' when v_b.minimum_delivery_subtotal is not null then 'CONFIGURED' else 'MISSING' end,
      'facts', jsonb_build_object('minimum_set', v_b.minimum_delivery_subtotal is not null,
        'minimum', v_b.minimum_delivery_subtotal)),
    jsonb_build_object('code', 'PICKUP', 'gate', 'BUSINESS_ADDRESS', 'blocks_opening', v_pickup,
      'status', case when not v_pickup then 'NOT_REQUIRED' when v_address_ok then 'CONFIGURED' else 'MISSING' end,
      'facts', jsonb_build_object('enabled', v_pickup, 'address_present', v_address_ok)),
    -- El dueño puede operar solo: el equipo no es una compuerta.
    jsonb_build_object('code', 'STAFF', 'gate', null, 'blocks_opening', false,
      'status', case when v_team > 0 then 'CONFIGURED' else 'NOT_REQUIRED' end,
      'facts', jsonb_build_object('members', v_team, 'commercial_managers', v_commercial_managers)),
    -- Sin repartidores el comercio entrega por su cuenta (20260919120000). Sólo
    -- faltan si el propio comercio pidió repartidor presente.
    jsonb_build_object('code', 'RIDERS', 'gate', null, 'blocks_opening', false,
      'status', case
        when not v_delivery then 'NOT_REQUIRED'
        when v_riders > 0 then 'CONFIGURED'
        when coalesce(v_b.rider_presence_required, false) then 'MISSING'
        else 'NOT_REQUIRED' end,
      'facts', jsonb_build_object('riders', v_riders, 'available_now', v_riders_available,
        'presence_required', coalesce(v_b.rider_presence_required, false))),
    -- Efectivo y «a coordinar» no dependen de configuración: Mercado Pago sólo
    -- falta cuando la plataforma lo encendió y la cuenta no está lista.
    jsonb_build_object('code', 'MERCADOPAGO_SELLER', 'gate', null, 'blocks_opening', false,
      'status', case
        when v_mp_ready then 'CONFIGURED'
        when coalesce(v_settings.enabled, false) then 'MISSING'
        else 'NOT_REQUIRED' end,
      'facts', jsonb_build_object('seller', coalesce(v_seller, 'none'),
        'platform_enabled', coalesce(v_settings.enabled, false), 'ready', v_mp_ready)),
    -- La facturación electrónica se enciende después de abrir.
    jsonb_build_object('code', 'FISCAL_CONFIG', 'gate', null, 'blocks_opening', false,
      'status', case when v_fiscal_enabled then 'CONFIGURED' else 'NOT_REQUIRED' end,
      'facts', jsonb_build_object('enabled', v_fiscal_enabled, 'environment', coalesce(v_fiscal_environment, 'none'))),
    jsonb_build_object('code', 'PRINTER_CONFIG', 'gate', null, 'blocks_opening', false,
      'status', case
        when not v_auto_print then 'NOT_REQUIRED'
        when v_print_devices > 0 then 'CONFIGURED'
        else 'MISSING' end,
      'facts', jsonb_build_object('auto_print_enabled', v_auto_print, 'active_devices', v_print_devices)),
    -- El valor es del comercio: acá no se inventa un plazo.
    jsonb_build_object('code', 'ABANDONED_ORDER_POLICY', 'gate', null, 'blocks_opening', false,
      'status', case when v_b.abandoned_order_minutes is not null then 'CONFIGURED' else 'MISSING' end,
      'facts', jsonb_build_object('minutes', v_b.abandoned_order_minutes)));

  select coalesce(array_agg(distinct entry ->> 'gate'), '{}')
    into v_config_gates
    from jsonb_array_elements(v_configuration) as c(entry)
   where (entry ->> 'blocks_opening')::boolean and entry ->> 'status' = 'MISSING';

  -- Lo que hace que la plataforma se niegue a verificar, en el orden de la lista:
  -- lo que ya bloqueaba más lo que falta de la configuración.
  select coalesce(array_agg(code order by ord), '{}')
    into v_verification_blockers
    from (
      select 'BUSINESS_OWNER'::text as code, 0::bigint as ord
       where 'BUSINESS_OWNER' = any (v_config_gates)
      union all
      select item ->> 'code', ordinality
        from jsonb_array_elements(v_items) with ordinality as e(item, ordinality)
       where item ->> 'code' <> 'PLATFORM_VERIFICATION'
         and (((item ->> 'blocking')::boolean and item ->> 'status' <> 'pass')
              or item ->> 'code' = any (v_config_gates))
    ) blockers;

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
    'accepting_orders', v_accepting,
    'configuration', v_configuration,
    'verification_blockers', to_jsonb(v_verification_blockers),
    'verification_ready', cardinality(v_verification_blockers) = 0
  );
end;
$get_store_opening_readiness$;

-- ── 2. La verificación de plataforma ────────────────────────────────────────────────────
create or replace function public.platform_verify_business_ordering(
  p_business_id uuid,
  p_verifier_email text,
  p_confirm_slug text,
  p_min_products integer default 1,
  p_note text default null
) returns jsonb
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
  -- `verification_blockers` trae lo que ya bloqueaba (las compuertas de `pending`)
  -- más lo que antes era sólo una advertencia: horario sin exigir, cobertura sin
  -- exigir con el delivery encendido, comercio sin dueño. Si la preparación no
  -- trae esa lista no se verifica a ciegas: se falla cerrado.
  if jsonb_typeof(v_readiness -> 'verification_blockers') is distinct from 'array' then
    raise exception 'OPENING_NOT_READY' using errcode = '55000', detail = 'READINESS_CONTRACT';
  end if;
  select coalesce(array_agg(code order by ord), '{}') into v_pending
    from jsonb_array_elements_text(v_readiness -> 'verification_blockers') with ordinality as blockers(code, ord);
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
      'counts', v_readiness -> 'counts',
      'configuration', v_readiness -> 'configuration')
  );

  -- No abre el comercio: abrir es el botón del dueño.
  return jsonb_build_object('ok', true, 'changed', true, 'status', v_b.status,
    'verified_at', v_b.ordering_verified_at, 'ordering_enabled', v_b.ordering_enabled);
end;
$platform_verify_business_ordering$;

-- ── 3. El estado para abrir el día ──────────────────────────────────────────────────────
create or replace function public.get_business_opening_status(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $get_business_opening_status$
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

  -- Los repartidores reales son integrantes del equipo con su disponibilidad; la
  -- tabla `public.riders` es anterior y nadie le escribe. Se cuenta igual que la
  -- preparación de la apertura.
  select count(*) into v_riders
    from public.business_members bm
    left join public.identity_user_security us on us.business_id = bm.business_id and us.user_id = bm.user_id
   where bm.business_id = p_business_id and bm.role = 'rider' and bm.is_active and us.disabled_at is null
     and public.rider_availability_effective(p_business_id, bm.user_id);

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
        -- Sin Mercado Pago la tienda cobra en efectivo o por transferencia, que
        -- no dependen de ninguna configuración: no es una falla.
        when v_settings.id is null then 'ok'
        else 'degraded'
      end,
      'detail', case
        when v_settings.id is null then 'La tienda cobra en efectivo o por transferencia. Mercado Pago no está configurado.'
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
$get_business_opening_status$;

-- ── 4. Privilegios: los mismos que tenían ───────────────────────────────────────────────
revoke all on function public.get_store_opening_readiness(uuid, integer) from public, anon, authenticated;
grant execute on function public.get_store_opening_readiness(uuid, integer) to authenticated, service_role;

revoke all on function public.platform_verify_business_ordering(uuid, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.platform_verify_business_ordering(uuid, text, text, integer, text) to service_role;

revoke all on function public.get_business_opening_status(uuid) from public, anon, authenticated;
grant execute on function public.get_business_opening_status(uuid) to authenticated;
