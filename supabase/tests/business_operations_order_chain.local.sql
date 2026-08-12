-- ============================================================================
--  El pedido de verdad: horario, cobertura, tarifa y mínimo sobre la cadena real
-- ============================================================================
--
--  Lo anterior prueba las funciones. Esto prueba que están ENCHUFADAS: se crean
--  sesiones de checkout reales, con reserva de stock real, contra un comercio
--  con la exigencia encendida.
--
--  Lo que se demuestra:
--    · la tarifa que termina en la sesión sale de la ZONA, no de la columna del
--      negocio, y son números distintos a propósito para que no se puedan
--      confundir;
--    · una dirección fuera de la lista blanca no crea sesión NI retiene stock;
--    · fuera de horario tampoco;
--    · por debajo del mínimo de la zona tampoco;
--    · el pedido nace con el nombre de la zona congelado;
--    · y apagar la zona a mitad de camino bloquea el checkout siguiente sin
--      tocar el pedido anterior.
--
--  Fixture sintético. Ni un dato comercial real.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function pg_temp.ok(p_condicion boolean, p_nombre text, p_detalle text default '')
returns void
language plpgsql as $$
begin
  if p_condicion then
    raise notice 'OK    %  %', rpad(p_nombre, 62, '.'), p_detalle;
  else
    raise exception 'FALLA: % — %', p_nombre, p_detalle;
  end if;
end;
$$;

create or replace function pg_temp.nuevo_usuario(p_prefix text)
returns uuid
language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v_id, 'authenticated', 'authenticated', p_prefix || '-' || replace(v_id::text, '-', '') || '@example.invalid',
    '', '{}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp());
  return v_id;
end;
$$;

do $$
declare
  v_slug text := 'ops-' || right(replace(gen_random_uuid()::text, '-', ''), 10);
  v_business uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_asset uuid := gen_random_uuid();
  v_owner uuid; v_cliente uuid;
  v_identity text; v_master text; v_thumb text;
  v_h1 text := encode(gen_random_bytes(32), 'hex');
  v_h2 text := encode(gen_random_bytes(32), 'hex');
  v_h3 text := encode(gen_random_bytes(32), 'hex');
  v_h4 text := encode(gen_random_bytes(32), 'hex');
  v_res jsonb; v_session uuid; v_row public.checkout_sessions%rowtype;
  v_stock integer; v_zona uuid; v_error text; v_n integer;
  v_hoy smallint;
begin
  raise notice '';
  raise notice '######## HORARIO Y COBERTURA SOBRE LA CADENA REAL ########';
  v_owner := pg_temp.nuevo_usuario(v_slug || '-owner');
  v_cliente := pg_temp.nuevo_usuario(v_slug || '-cliente');

  insert into public.businesses (
    id, name, slug, status, is_active, ordering_enabled, ordering_verified,
    ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled,
    delivery_enabled, delivery_fee, minimum_delivery_subtotal,
    operating_timezone
  ) values (
    v_business, 'La Taba operaciones', v_slug, 'open', true, true, true,
    clock_timestamp(), v_owner, 'ARS', true, true, 999.00, 0.00,
    'America/Argentina/Buenos_Aires'
  );
  insert into public.business_members (business_id, user_id, role, is_active)
  values (v_business, v_owner, 'owner', true);

  v_identity := public.catalog_image_identity_sha256(v_slug || '-ext', v_slug || '-sku', v_h4);
  v_master := public.catalog_asset_path(v_slug || '-sku', v_identity, 'master', v_h2);
  v_thumb := public.catalog_asset_path(v_slug || '-sku', v_identity, 'thumbnail', v_h3);
  insert into public.catalog_assets (
    id, business_id, external_id, sku, safe_sku, identity_sha256, master_path,
    master_sha256, master_binding_sha256, thumbnail_path, thumbnail_sha256,
    thumbnail_binding_sha256, source_sha256, source_url, rights_status,
    rights_reference, approved_at, approved_by, catalog_origin
  ) values (
    v_asset, v_business, v_slug || '-ext', v_slug || '-sku', v_slug || '-sku', v_identity,
    v_master, v_h2, public.catalog_asset_binding_sha256(v_identity, 'master', v_h4, v_h2, 1000, 1000, v_master),
    v_thumb, v_h3, public.catalog_asset_binding_sha256(v_identity, 'thumbnail', v_h4, v_h3, 400, 400, v_thumb),
    v_h4, 'https://example.invalid/' || v_slug || '.webp', 'PROPIO', 'operaciones',
    clock_timestamp(), v_owner, 'commercial'
  );
  insert into public.products (
    id, business_id, name, description, category, price, image_url, is_active,
    brand, subcategory, presentation, capacity, packaging_type, stock, available,
    is_alcoholic, is_verified, chilled, units_per_pack, external_id, sku,
    catalog_asset_id, image_sha256, image_thumbnail_url, image_thumbnail_sha256,
    source_image_sha256, variant, capacity_value, capacity_unit, catalog_origin,
    price_status, verified_at, verified_by
  ) values (
    v_product, v_business, 'Lata operaciones', 'Fixture', 'Gaseosas', 1000.00,
    'assets/products/' || v_slug || '.webp', true, 'TABA2 QA', 'Cola', 'Lata 473 ml', '473 ml', 'lata',
    50, true, false, true, false, 1, v_slug || '-ext', v_slug || '-sku', v_asset,
    v_h1, 'assets/products/' || v_slug || '-t.webp', v_h2, v_h4,
    'Lata 473 ml', 473, 'ml', 'commercial', 'confirmed', clock_timestamp(), v_owner
  );
  insert into public.business_payment_settings (
    business_id, enabled, environment, checkout_mode, currency, reserve_stock,
    collector_id, application_id, configured_at, verified_at
  ) values (v_business, true, 'test', 'checkout_pro', 'ARS', true,
    'collector-' || v_slug, 'app-' || v_slug, clock_timestamp(), clock_timestamp());

  -- ── Configuración: la carga el owner por las RPC del Panel ─────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  -- Abierto todo el día de HOY para que el ensayo no dependa de la hora en que
  -- corre. El corte del mediodía y el cruce de medianoche ya están probados con
  -- instantes fijos en la otra suite; acá lo que se prueba es el enchufe.
  v_hoy := extract(dow from (clock_timestamp() at time zone 'America/Argentina/Buenos_Aires'))::smallint;
  perform public.set_business_service_hours(v_business, 'delivery',
    jsonb_build_array(jsonb_build_object('weekday', v_hoy, 'opens_at', '00:00', 'closes_at', '23:59')));

  -- Tarifa de la zona DISTINTA de la del negocio: si al final se cobra 999, es
  -- que la zona no decidió nada.
  v_res := public.upsert_delivery_zone(v_business, jsonb_build_object(
    'name', 'Barrio cubierto', 'match_kind', 'declared_area',
    'delivery_fee', '2500', 'minimum_subtotal', '4000'));
  v_zona := (v_res ->> 'zone_id')::uuid;
  perform public.set_service_enforcement(v_business, true, true, null, 'America/Argentina/Buenos_Aires');
  perform pg_temp.ok(true, '0 · configuración cargada por el Panel', 'zona=' || v_zona);

  perform set_config('request.jwt.claims', '', true);

  -- ── 1 · dirección FUERA de la lista blanca ─────────────────────────────────
  select stock into v_stock from public.products where id = v_product;
  begin
    v_res := public.create_checkout_session(v_cliente, jsonb_build_object(
      'business_id', v_business, 'client_request_id', 'opsfuera00001',
      'items', jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 6)),
      'fulfillment_type', 'delivery',
      'contact', jsonb_build_object('name', 'Cliente ops', 'phone', '5492990000000'),
      'address', jsonb_build_object(
        'street', 'Calle sintetica', 'street_number', '100', 'city', 'Neuquen',
        'neighborhood', 'Barrio que no esta en la lista',
        'latitude', '-38.953900', 'longitude', '-68.059600',
        'location_source', 'map_pin', 'location_confirmed_at', clock_timestamp()::text),
      'age_confirmed', false, 'payment_method', 'mercadopago'));
    raise exception 'FALLA: una direccion fuera de cobertura creo una sesion';
  exception when others then
    v_error := sqlerrm;
  end;
  perform pg_temp.ok(v_error like '%OUT_OF_DELIVERY_ZONE%',
    '1 · fuera de la lista blanca no hay sesión', v_error);
  perform pg_temp.ok((select stock from public.products where id = v_product) = v_stock,
    '1b · y el stock quedó intacto: no se reservó nada', 'stock=' || v_stock);
  perform pg_temp.ok((select count(*) from public.checkout_sessions where business_id = v_business) = 0,
    '1c · no quedó ninguna sesión colgada');

  -- ── 2 · por debajo del mínimo DE LA ZONA ───────────────────────────────────
  -- El mínimo del negocio es 0; el de la zona, 4000. Dos latas son 2000.
  begin
    v_res := public.create_checkout_session(v_cliente, jsonb_build_object(
      'business_id', v_business, 'client_request_id', 'opsminimo0001',
      'items', jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 2)),
      'fulfillment_type', 'delivery',
      'contact', jsonb_build_object('name', 'Cliente ops', 'phone', '5492990000000'),
      'address', jsonb_build_object(
        'street', 'Calle sintetica', 'street_number', '100', 'city', 'Neuquen',
        'neighborhood', 'Barrio cubierto',
        'latitude', '-38.953900', 'longitude', '-68.059600',
        'location_source', 'map_pin', 'location_confirmed_at', clock_timestamp()::text),
      'age_confirmed', false, 'payment_method', 'mercadopago'));
    raise exception 'FALLA: un carrito bajo el minimo de la zona creo una sesion';
  exception when others then
    v_error := sqlerrm;
  end;
  perform pg_temp.ok(v_error like '%minimo de delivery no valido%',
    '2 · el mínimo que se impone es el de la ZONA, no el del negocio', v_error);

  -- ── 3 · dirección cubierta, por encima del mínimo ──────────────────────────
  v_res := public.create_checkout_session(v_cliente, jsonb_build_object(
    'business_id', v_business, 'client_request_id', 'opsbueno00001',
    'items', jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 6)),
    'fulfillment_type', 'delivery',
    'contact', jsonb_build_object('name', 'Cliente ops', 'phone', '5492990000000'),
    'address', jsonb_build_object(
      'street', 'Calle sintetica', 'street_number', '100', 'city', 'Neuquen',
      'neighborhood', 'Barrio cubierto',
      'latitude', '-38.953900', 'longitude', '-68.059600',
      'location_source', 'map_pin', 'location_confirmed_at', clock_timestamp()::text),
    'age_confirmed', false, 'payment_method', 'mercadopago'));
  v_session := (v_res ->> 'checkout_session_id')::uuid;
  select * into v_row from public.checkout_sessions where id = v_session;
  perform pg_temp.ok(v_row.delivery_fee = 2500.00,
    '3 · la tarifa cobrada es la de la zona (2500), no la del negocio (999)',
    'delivery_fee=' || v_row.delivery_fee);
  perform pg_temp.ok(v_row.delivery_zone_id = v_zona and v_row.delivery_zone_name = 'Barrio cubierto',
    '3b · la sesión guarda qué zona decidió', v_row.delivery_zone_name);
  perform pg_temp.ok(v_row.delivery_minimum_subtotal = 4000.00,
    '3c · y con qué mínimo se aceptó', 'minimo=' || v_row.delivery_minimum_subtotal);
  perform pg_temp.ok(v_row.total = v_row.subtotal - v_row.discount_total + 2500.00,
    '3d · el total incluye exactamente esa tarifa', 'total=' || v_row.total);

  -- ── 4 · el pedido nace con la zona congelada ───────────────────────────────
  update public.payment_intents
     set internal_status = 'approved_order_pending', provider_status = 'approved',
         paid_amount = v_row.total, currency = 'ARS'
   where checkout_session_id = v_session;
  update public.checkout_sessions set status = 'payment_approved' where id = v_session;
  v_res := public.finalize_paid_checkout_session(v_session);
  perform pg_temp.ok((v_res ->> 'ok')::boolean,
    '4 · la sesión pagada se convierte en pedido', v_res ->> 'order_code');
  perform pg_temp.ok(
    (select delivery_zone_name from public.orders where id = (v_res ->> 'order_id')::uuid) = 'Barrio cubierto',
    '4b · el pedido congela el nombre de la zona');
  perform pg_temp.ok(
    (select delivery_area_declared from public.orders where id = (v_res ->> 'order_id')::uuid) = 'Barrio cubierto',
    '4c · y también el barrio que declaró la persona');
  perform pg_temp.ok(
    (select delivery_fee from public.orders where id = (v_res ->> 'order_id')::uuid) = 2500.00,
    '4d · con la tarifa que decidió el backend');

  -- ── 5 · apagar la zona bloquea lo siguiente, no lo anterior ────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform public.set_delivery_zone_active(v_business, v_zona, false);
  perform set_config('request.jwt.claims', '', true);
  begin
    v_res := public.create_checkout_session(v_cliente, jsonb_build_object(
      'business_id', v_business, 'client_request_id', 'opsapagada001',
      'items', jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 6)),
      'fulfillment_type', 'delivery',
      'contact', jsonb_build_object('name', 'Cliente ops', 'phone', '5492990000000'),
      'address', jsonb_build_object(
        'street', 'Calle sintetica', 'street_number', '100', 'city', 'Neuquen',
        'neighborhood', 'Barrio cubierto',
        'latitude', '-38.953900', 'longitude', '-68.059600',
        'location_source', 'map_pin', 'location_confirmed_at', clock_timestamp()::text),
      'age_confirmed', false, 'payment_method', 'mercadopago'));
    raise exception 'FALLA: una zona apagada siguio dando cobertura';
  exception when others then
    v_error := sqlerrm;
  end;
  perform pg_temp.ok(v_error like '%OUT_OF_DELIVERY_ZONE%',
    '5 · apagar la zona bloquea el checkout siguiente', v_error);
  perform pg_temp.ok(
    (select delivery_zone_name from public.orders where id is not null
      and business_id = v_business limit 1) = 'Barrio cubierto',
    '5b · y no toca el pedido que ya se había tomado');

  -- ── 6 · fuera de horario ───────────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform public.set_delivery_zone_active(v_business, v_zona, true);
  -- Un día cerrado hoy: la puerta se cierra sin tocar el horario recurrente.
  perform public.set_business_service_exception(
    v_business, 'all', (clock_timestamp() at time zone 'America/Argentina/Buenos_Aires')::date,
    true, null, null, 'cierre sintetico del ensayo');
  perform set_config('request.jwt.claims', '', true);
  select stock into v_stock from public.products where id = v_product;
  begin
    v_res := public.create_checkout_session(v_cliente, jsonb_build_object(
      'business_id', v_business, 'client_request_id', 'opscerrado001',
      'items', jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 6)),
      'fulfillment_type', 'delivery',
      'contact', jsonb_build_object('name', 'Cliente ops', 'phone', '5492990000000'),
      'address', jsonb_build_object(
        'street', 'Calle sintetica', 'street_number', '100', 'city', 'Neuquen',
        'neighborhood', 'Barrio cubierto',
        'latitude', '-38.953900', 'longitude', '-68.059600',
        'location_source', 'map_pin', 'location_confirmed_at', clock_timestamp()::text),
      'age_confirmed', false, 'payment_method', 'mercadopago'));
    raise exception 'FALLA: con el comercio cerrado se creo una sesion';
  exception when others then
    v_error := sqlerrm;
  end;
  perform pg_temp.ok(v_error like '%BUSINESS_CLOSED%',
    '6 · con el comercio cerrado no hay sesión', v_error);
  perform pg_temp.ok((select stock from public.products where id = v_product) = v_stock,
    '6b · y tampoco se retuvo stock', 'stock=' || v_stock);

  -- ── 7 · la respuesta al cliente dice cerrado, y cuándo abre ────────────────
  v_res := public.commerce_availability(v_business, 'delivery',
    jsonb_build_object('neighborhood', 'Barrio cubierto'));
  perform pg_temp.ok((v_res ->> 'is_open')::boolean = false,
    '7 · la tienda pregunta y recibe «cerrado»');
  perform pg_temp.ok((v_res -> 'delivery' ->> 'eligible')::boolean,
    '7b · pero la cobertura sigue siendo válida: el carrito no se rompe');
  perform pg_temp.ok((v_res -> 'delivery' ->> 'delivery_fee')::numeric = 2500,
    '7c · con la tarifa de la zona ya resuelta por el backend');

  select count(*)::int into v_n from public.business_config_audit where business_id = v_business;
  perform pg_temp.ok(v_n >= 6, '8 · todo el camino quedó auditado', v_n || ' filas');

  raise notice '######## FIN ########';
  raise notice '';
end;
$$;
