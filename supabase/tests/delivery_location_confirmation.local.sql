-- Certificación local del contrato «ningún pedido delivery sin punto confirmado».
--
-- Corre sobre una base efímera con TODAS las migraciones aplicadas y termina en
-- ROLLBACK: no deja filas. Los fixtures son sintéticos; no se lee ningún dato
-- real.
--
-- El trigger de respaldo es DIFERIDO: en una transacción que termina en rollback
-- nunca se dispararía por su cuenta. Donde hace falta probarlo se fuerza con
-- `set constraints all immediate`, que es exactamente el momento en que se
-- ejecutaría al confirmar.
begin;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

create temporary table verificacion (n serial primary key, detalle text not null) on commit drop;
-- La traza del pedido QA demostrativo: qué ve cada superficie del mismo punto.
create temporary table demostracion (n serial primary key, superficie text not null, dato text not null) on commit drop;

do $certificacion$
declare
  v_user uuid := '10000000-0000-4000-8000-000000000001';
  v_business uuid := '20000000-0000-4000-8000-000000000001';
  v_product uuid := '30000000-0000-4000-8000-000000000001';
  v_asset uuid := '40000000-0000-4000-8000-000000000001';
  v_hash text := repeat('a', 64);
  v_master_hash text := repeat('b', 64);
  v_thumbnail_hash text := repeat('c', 64);
  v_source_hash text := repeat('d', 64);
  v_identity text;
  v_master_path text;
  v_thumbnail_path text;

  v_lat numeric := -38.953900;
  v_lng numeric := -68.059600;
  v_confirmado timestamptz := clock_timestamp();
  v_address jsonb;
  v_address_id uuid;
  v_result jsonb;
  v_order public.orders%rowtype;
  v_session uuid;
  v_snapshot jsonb;
  v_prepare jsonb;
  v_intent uuid;
  v_stock integer;
  v_stock_previo integer;
  v_sesiones integer;
  v_legacy uuid;
  v_paso boolean;
  v_rider uuid := '10000000-0000-4000-8000-000000000002';
  v_payload jsonb;
begin
  -- ── fixtures ──────────────────────────────────────────────────────────────
  insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v_user, 'authenticated', 'authenticated', 'ubicacion-test@example.invalid', '', '{}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp());

  insert into public.businesses (
    id, name, slug, status, is_active, ordering_enabled, ordering_verified,
    ordering_verified_at, ordering_verified_by, currency_code,
    pickup_enabled, delivery_enabled, delivery_fee, minimum_delivery_subtotal
  ) values (
    v_business, 'Fixture de ubicacion', 'fixture-ubicacion', 'open', true, true, true,
    clock_timestamp(), v_user, 'ARS', true, true, 900.00, 1000.00
  );

  v_identity := public.catalog_image_identity_sha256('loc-fixture-external', 'loc-fixture-sku', v_source_hash);
  v_master_path := public.catalog_asset_path('loc-fixture-sku', v_identity, 'master', v_master_hash);
  v_thumbnail_path := public.catalog_asset_path('loc-fixture-sku', v_identity, 'thumbnail', v_thumbnail_hash);
  insert into public.catalog_assets (
    id, business_id, external_id, sku, safe_sku, identity_sha256, master_path,
    master_sha256, master_binding_sha256, thumbnail_path, thumbnail_sha256,
    thumbnail_binding_sha256, source_sha256, source_url, rights_status,
    rights_reference, approved_at, approved_by, catalog_origin
  ) values (
    v_asset, v_business, 'loc-fixture-external', 'loc-fixture-sku', 'loc-fixture-sku', v_identity,
    v_master_path, v_master_hash,
    public.catalog_asset_binding_sha256(v_identity, 'master', v_source_hash, v_master_hash, 1000, 1000, v_master_path),
    v_thumbnail_path, v_thumbnail_hash,
    public.catalog_asset_binding_sha256(v_identity, 'thumbnail', v_source_hash, v_thumbnail_hash, 400, 400, v_thumbnail_path),
    v_source_hash, 'https://example.invalid/loc-fixture.webp', 'UNAPPROVED_QA', 'fixture local aislado', null, null, 'test_only'
  );
  insert into public.products (
    id, business_id, name, description, category, price, image_url, is_active,
    brand, subcategory, presentation, capacity, packaging_type, stock, available,
    is_alcoholic, is_verified, chilled, units_per_pack, external_id, sku,
    catalog_asset_id, image_sha256, image_thumbnail_url, image_thumbnail_sha256,
    source_image_sha256, variant, capacity_value, capacity_unit, catalog_origin, price_status
  ) values (
    v_product, v_business, 'Bebida de prueba', 'Fixture local aislado', 'Gaseosas', 2500.00,
    'assets/products/loc-fixture.webp', true, 'TABA2 QA', 'Cola', 'Botella 1 l', '1 l', 'botella',
    40, true, false, true, false, 1, 'loc-fixture-external', 'loc-fixture-sku', v_asset,
    v_hash, 'assets/products/loc-fixture-thumb.webp', v_master_hash, v_source_hash,
    'Botella 1 l', 1, 'l', 'test_only', 'confirmed'
  );
  insert into public.business_payment_settings (
    business_id, enabled, environment, checkout_mode, currency, reserve_stock,
    collector_id, application_id, configured_at, verified_at
  ) values (v_business, true, 'test', 'checkout_pro', 'ARS', true, 'collector-fixture', 'application-fixture', clock_timestamp(), clock_timestamp());

  perform public.upsert_current_customer_profile('Cliente Ubicacion', '2996209136');

  -- ── 1. una dirección escrita a mano NO queda confirmada ───────────────────
  v_result := public.upsert_current_customer_address(jsonb_build_object(
    'label', 'Casa', 'street', 'Antartida Argentina', 'streetNumber', '1450',
    'city', 'Neuquen', 'province', 'Neuquen', 'isDefault', true
  ));
  v_address := v_result -> 'address';
  v_address_id := (v_address ->> 'id')::uuid;
  if v_address ->> 'locationConfirmedAt' is not null or v_address ->> 'locationSource' is not null then
    raise exception 'escribir una direccion no puede dejarla confirmada';
  end if;
  insert into verificacion(detalle) values ('escribir una direccion no la deja confirmada');

  -- ── 2. delivery con dirección sin confirmar: rechazo antes del stock ──────
  select stock into v_stock_previo from public.products where id = v_product;
  begin
    perform public.create_order_with_items(jsonb_build_object(
      'business_id', v_business, 'client_request_id', 'locfixture0000001',
      'tracking_token', repeat('t', 40),
      'items', jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 1)),
      'customer_name', 'Cliente Ubicacion', 'customer_phone', '2996209136',
      'delivery_mode', 'delivery', 'payment_method', 'cash',
      'customer_address_id', v_address_id
    ));
    raise exception 'un delivery sin punto confirmado fue aceptado';
  exception when sqlstate '22023' then
    if sqlerrm not like '%DELIVERY_LOCATION_REQUIRED%' then
      raise exception 'el rechazo no fue DELIVERY_LOCATION_REQUIRED: %', sqlerrm;
    end if;
  end;
  select stock into v_stock from public.products where id = v_product;
  if v_stock <> v_stock_previo then
    raise exception 'el rechazo movio el stock: % -> %', v_stock_previo, v_stock;
  end if;
  if exists (select 1 from public.orders where business_id = v_business) then
    raise exception 'el rechazo dejo un pedido creado';
  end if;
  insert into verificacion(detalle) values ('delivery sin punto confirmado: DELIVERY_LOCATION_REQUIRED, sin pedido y sin mover stock');

  -- ── 3. coordenadas sueltas, sin confirmación, tampoco alcanzan ────────────
  begin
    perform public.create_order_with_items(jsonb_build_object(
      'business_id', v_business, 'client_request_id', 'locfixture0000002',
      'tracking_token', repeat('t', 40),
      'items', jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 1)),
      'customer_name', 'Cliente Ubicacion', 'customer_phone', '2996209136',
      'delivery_mode', 'delivery', 'payment_method', 'cash',
      'customer_street_address', 'Antartida Argentina 1450',
      'customer_neighborhood', 'Neuquen',
      'delivery_latitude', v_lat::text, 'delivery_longitude', v_lng::text
    ));
    raise exception 'coordenadas sin confirmacion fueron aceptadas';
  exception when sqlstate '22023' then
    if sqlerrm not like '%DELIVERY_LOCATION_REQUIRED%' then
      raise exception 'el rechazo no fue DELIVERY_LOCATION_REQUIRED: %', sqlerrm;
    end if;
  end;
  insert into verificacion(detalle) values ('coordenadas sin origen ni momento de confirmacion no son una confirmacion');

  -- ── 4. confirmar el pin sella la dirección ────────────────────────────────
  v_result := public.upsert_current_customer_address(jsonb_build_object(
    'id', v_address_id,
    'label', 'Casa', 'street', 'Antartida Argentina', 'streetNumber', '1450',
    'city', 'Neuquen', 'province', 'Neuquen', 'isDefault', true,
    'latitude', v_lat::text, 'longitude', v_lng::text,
    'geolocationAccuracy', '12', 'locationSource', 'gps',
    'locationConfirmedAt', v_confirmado::text
  ));
  v_address := v_result -> 'address';
  if (v_address ->> 'locationConfirmedAt') is null
    or (v_address ->> 'locationSource') <> 'gps'
    or (v_address ->> 'source') <> 'gps'
    or (v_address ->> 'latitude')::numeric <> v_lat then
    raise exception 'la confirmacion no quedo sellada: %', v_address;
  end if;
  if (select location_confirmed_address from public.customer_addresses where id = v_address_id)
     <> public.delivery_location_address_fingerprint('Antartida Argentina', '1450', 'Neuquen', 'Neuquen', null) then
    raise exception 'la huella del texto no coincide con la direccion confirmada';
  end if;
  insert into verificacion(detalle) values ('confirmar el pin sella coordenadas, origen, momento y huella del texto');

  -- ── 5. con punto confirmado el pedido nace con el mismo punto ─────────────
  v_result := public.create_order_with_items(jsonb_build_object(
    'business_id', v_business, 'client_request_id', 'locfixture0000003',
    'tracking_token', repeat('t', 40),
    'items', jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 1)),
    'customer_name', 'Cliente Ubicacion', 'customer_phone', '2996209136',
    'delivery_mode', 'delivery', 'payment_method', 'cash',
    'customer_address_id', v_address_id
  ));
  select * into v_order from public.orders where id = (v_result ->> 'id')::uuid;
  if v_order.delivery_latitude <> v_lat or v_order.delivery_longitude <> v_lng then
    raise exception 'el pedido no nacio con el punto confirmado: %, %', v_order.delivery_latitude, v_order.delivery_longitude;
  end if;
  if v_order.delivery_location_source <> 'gps' or v_order.delivery_location_confirmed_at is null then
    raise exception 'el pedido no conserva el origen ni el momento de la confirmacion';
  end if;
  if v_order.delivery_geolocation_accuracy <> 12 then
    raise exception 'el pedido no conserva la precision declarada';
  end if;
  if v_order.delivery_address_source <> 'gps' then
    raise exception 'la columna historica no recibio la proyeccion del origen: %', v_order.delivery_address_source;
  end if;
  insert into verificacion(detalle) values ('el pedido directo nace con latitud, longitud, precision, origen y momento');

  -- El Rider NO lee las columnas del pedido: lee la instantánea que el trigger
  -- remoto saca en el INSERT y que después es inmutable. Si el punto llegara
  -- por un UPDATE posterior, la foto saldría vacía y el mapa del Rider diría
  -- «no hay coordenadas» con el dato ya guardado al lado.
  if not exists (
    select 1 from private.rider_map_order_location_snapshots s
     where s.order_id = v_order.id
       and s.customer_latitude = v_lat
       and s.customer_longitude = v_lng
       and s.customer_source = 'gps'
  ) then
    raise exception 'la instantanea del Rider no capturo el punto del pedido directo: %',
      (select to_jsonb(s) from private.rider_map_order_location_snapshots s where s.order_id = v_order.id);
  end if;
  insert into verificacion(detalle) values ('la instantanea que lee el Rider captura el punto en el alta del pedido directo');

  -- El respaldo diferido acepta este pedido: se fuerza el momento de comprobación.
  set constraints all immediate;
  set constraints all deferred;
  insert into verificacion(detalle) values ('el respaldo diferido acepta un pedido delivery con punto confirmado');

  -- ── 6. la dirección confirmada se reutiliza en la compra siguiente ────────
  v_result := public.create_order_with_items(jsonb_build_object(
    'business_id', v_business, 'client_request_id', 'locfixture0000004',
    'tracking_token', repeat('u', 40),
    'items', jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 1)),
    'customer_name', 'Cliente Ubicacion', 'customer_phone', '2996209136',
    'delivery_mode', 'delivery', 'payment_method', 'cash',
    'customer_address_id', v_address_id
  ));
  select * into v_order from public.orders where id = (v_result ->> 'id')::uuid;
  if v_order.delivery_latitude <> v_lat or v_order.delivery_location_confirmed_at is null then
    raise exception 'la direccion confirmada no se reutilizo con su punto';
  end if;
  insert into verificacion(detalle) values ('una direccion confirmada se reutiliza en la compra siguiente');

  -- ── 7. cambiar el texto sin volver a confirmar invalida el pin ────────────
  v_result := public.upsert_current_customer_address(jsonb_build_object(
    'id', v_address_id,
    'label', 'Casa', 'street', 'Antartida Argentina', 'streetNumber', '2600',
    'city', 'Neuquen', 'province', 'Neuquen', 'isDefault', true,
    'latitude', v_lat::text, 'longitude', v_lng::text,
    'geolocationAccuracy', '12', 'locationSource', 'gps',
    'locationConfirmedAt', v_confirmado::text,
    'allowDuplicate', true
  ));
  v_address := v_result -> 'address';
  if (v_address ->> 'locationConfirmedAt') is not null
    or (v_address ->> 'latitude') is not null then
    raise exception 'cambiar la calle no invalido la confirmacion: %', v_address;
  end if;
  insert into verificacion(detalle) values ('cambiar el numero de la calle sin reconfirmar invalida el pin y borra el punto');

  -- ── 8. y entonces el pedido vuelve a estar bloqueado ──────────────────────
  begin
    perform public.create_order_with_items(jsonb_build_object(
      'business_id', v_business, 'client_request_id', 'locfixture0000005',
      'tracking_token', repeat('v', 40),
      'items', jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 1)),
      'customer_name', 'Cliente Ubicacion', 'customer_phone', '2996209136',
      'delivery_mode', 'delivery', 'payment_method', 'cash',
      'customer_address_id', v_address_id
    ));
    raise exception 'una direccion con confirmacion vencida sostuvo un pedido';
  exception when sqlstate '22023' then
    if sqlerrm not like '%DELIVERY_LOCATION_REQUIRED%' then
      raise exception 'el rechazo no fue DELIVERY_LOCATION_REQUIRED: %', sqlerrm;
    end if;
  end;
  insert into verificacion(detalle) values ('con la confirmacion vencida el pedido vuelve a estar bloqueado');

  -- Se restituye la confirmación sobre el texto nuevo para lo que sigue.
  v_confirmado := clock_timestamp();
  v_result := public.upsert_current_customer_address(jsonb_build_object(
    'id', v_address_id,
    'label', 'Casa', 'street', 'Antartida Argentina', 'streetNumber', '2600',
    'city', 'Neuquen', 'province', 'Neuquen', 'isDefault', true,
    'latitude', v_lat::text, 'longitude', v_lng::text,
    'geolocationAccuracy', '12', 'locationSource', 'map_pin',
    'locationConfirmedAt', v_confirmado::text
  ));
  if ((v_result -> 'address') ->> 'source') <> 'manual' then
    raise exception 'map_pin no se proyecto a manual en la columna historica';
  end if;
  insert into verificacion(detalle) values ('map_pin se proyecta a manual en la columna historica, que no cambia de vocabulario');

  -- ── 9. retiro en local no exige nada geográfico ───────────────────────────
  v_result := public.create_order_with_items(jsonb_build_object(
    'business_id', v_business, 'client_request_id', 'locfixture0000006',
    'tracking_token', repeat('w', 40),
    'items', jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 1)),
    'customer_name', 'Cliente Ubicacion', 'customer_phone', '2996209136',
    'delivery_mode', 'pickup', 'payment_method', 'cash'
  ));
  select * into v_order from public.orders where id = (v_result ->> 'id')::uuid;
  if v_order.delivery_mode <> 'pickup' then
    raise exception 'el pedido de retiro no se creo';
  end if;
  insert into verificacion(detalle) values ('retiro en local no exige punto: el encuentro es el mostrador');

  -- ── 10. Checkout Pro: sin punto no hay sesion ni reserva ──────────────────
  select stock into v_stock_previo from public.products where id = v_product;
  select count(*) into v_sesiones from public.checkout_sessions where business_id = v_business;
  begin
    perform public.create_checkout_session(v_user, jsonb_build_object(
      'business_id', v_business, 'client_request_id', 'locfixturecheckout01',
      'items', jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 1)),
      'fulfillment_type', 'delivery',
      'contact', jsonb_build_object('name', 'Cliente Ubicacion', 'phone', '2996209136'),
      'address', jsonb_build_object(
        'street', 'Antartida Argentina', 'street_number', '2600', 'city', 'Neuquen'
      ),
      'age_confirmed', false, 'payment_method', 'mercadopago'
    ));
    raise exception 'Checkout Pro acepto un delivery sin punto confirmado';
  exception when sqlstate '22023' then
    if sqlerrm not like '%DELIVERY_LOCATION_REQUIRED%' then
      raise exception 'el rechazo de Checkout Pro no fue DELIVERY_LOCATION_REQUIRED: %', sqlerrm;
    end if;
  end;
  select stock into v_stock from public.products where id = v_product;
  if v_stock <> v_stock_previo then
    raise exception 'Checkout Pro reservo stock para un pedido que no podia existir';
  end if;
  if (select count(*) from public.checkout_sessions where business_id = v_business) <> v_sesiones then
    raise exception 'Checkout Pro dejo una sesion abierta tras el rechazo';
  end if;
  insert into verificacion(detalle) values ('Checkout Pro rechaza antes de crear la sesion y antes de reservar stock');

  -- ── 11. Checkout Pro con punto: viaja en el snapshot y llega al pedido ────
  v_result := public.create_checkout_session(v_user, jsonb_build_object(
    'business_id', v_business, 'client_request_id', 'locfixturecheckout02',
    'items', jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 1)),
    'fulfillment_type', 'delivery',
    'contact', jsonb_build_object('name', 'Cliente Ubicacion', 'phone', '2996209136'),
    'address', jsonb_build_object('customer_address_id', v_address_id),
    'age_confirmed', false, 'payment_method', 'mercadopago'
  ));
  v_session := (v_result ->> 'checkout_session_id')::uuid;
  select address_snapshot into v_snapshot from public.checkout_sessions where id = v_session;
  if (v_snapshot ->> 'latitude')::numeric <> v_lat
    or (v_snapshot ->> 'longitude')::numeric <> v_lng
    or (v_snapshot ->> 'location_source') <> 'map_pin'
    or (v_snapshot ->> 'location_confirmed_at') is null then
    raise exception 'el snapshot de la sesion no lleva el punto confirmado: %', v_snapshot;
  end if;
  insert into verificacion(detalle) values ('la sesion de Checkout Pro transporta el punto, su origen y su momento');

  v_prepare := public.prepare_mercadopago_preference(v_session, v_user, false);
  perform public.record_mercadopago_preference_created(
    (v_prepare ->> 'payment_attempt_id')::uuid, 'PREF-LOC-1',
    'https://www.mercadopago.com/checkout/v1/redirect?pref_id=PREF-LOC-1',
    'https://sandbox.mercadopago.com/checkout/v1/redirect?pref_id=PREF-LOC-1',
    repeat('e', 64), 'request-loc'
  );
  select id into v_intent from public.payment_intents where checkout_session_id = v_session;
  perform public.record_mercadopago_payment_snapshot(v_intent, jsonb_build_object(
    'provider_payment_id', '90000000777', 'external_reference', 'taba2:checkout:' || v_session::text,
    'preference_id', 'PREF-LOC-1', 'merchant_order_id', 'MO-LOC',
    'collector_id', 'collector-fixture', 'application_id', 'application-fixture',
    'currency', 'ARS', 'transaction_amount',
    (select total from public.checkout_sessions where id = v_session)::text,
    'status', 'approved', 'status_detail', 'accredited', 'payment_method', 'visa',
    'live_mode', false, 'provider_occurred_at', clock_timestamp()::text,
    'refunded_amount', '0.00', 'payer_email_hash', repeat('f', 64), 'raw_response_hash', repeat('1', 64)
  ), 'reconciliation', null);
  v_result := public.finalize_paid_checkout_session(v_session);
  if (v_result ->> 'ok') <> 'true' then
    raise exception 'la finalizacion del pago no creo el pedido: %', v_result;
  end if;
  select * into v_order from public.orders where id = (v_result ->> 'order_id')::uuid;
  if v_order.delivery_latitude <> v_lat
    or v_order.delivery_longitude <> v_lng
    or v_order.delivery_location_source <> 'map_pin'
    or v_order.delivery_location_confirmed_at is null then
    raise exception 'el pedido de Checkout Pro no nacio con el punto confirmado';
  end if;
  insert into verificacion(detalle) values ('el pedido pagado con Checkout Pro nace con el mismo punto que confirmo el cliente');

  if not exists (
    select 1 from private.rider_map_order_location_snapshots s
     where s.order_id = v_order.id
       and s.customer_latitude = v_lat
       and s.customer_source = 'manual'
  ) then
    raise exception 'la instantanea del Rider no capturo el punto del pedido de Checkout Pro';
  end if;
  insert into verificacion(detalle) values ('la instantanea del Rider captura el punto del pedido pagado, con el origen proyectado al vocabulario que su CHECK acepta');

  set constraints all immediate;
  set constraints all deferred;
  insert into verificacion(detalle) values ('el respaldo diferido acepta el pedido pagado');

  -- ── 12. el respaldo diferido aborta un delivery que perdio su punto ───────
  -- Se crea un pedido de retiro por la via normal y se lo convierte a delivery
  -- sin punto. El evento diferido del alta todavia esta pendiente, asi que al
  -- forzar el momento de comprobacion el trigger RELEE la fila y ve lo que la
  -- transaccion iba a dejar escrito: un delivery sin destino.
  v_paso := false;
  begin
    v_result := public.create_order_with_items(jsonb_build_object(
      'business_id', v_business, 'client_request_id', 'locbackstop000001',
      'tracking_token', repeat('x', 40),
      'items', jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 1)),
      'customer_name', 'Cliente Ubicacion', 'customer_phone', '2996209136',
      'delivery_mode', 'pickup', 'payment_method', 'cash'
    ));
    update public.orders
       set fulfillment_type = 'delivery', delivery_mode = 'delivery'
     where id = (v_result ->> 'id')::uuid;
    set constraints all immediate;
    v_paso := true;
  exception when sqlstate '23514' then
    if sqlerrm not like '%DELIVERY_LOCATION_REQUIRED%' then
      raise exception 'el respaldo aborto por otra razon: %', sqlerrm;
    end if;
  end;
  if v_paso then
    raise exception 'el respaldo diferido dejo pasar un delivery sin punto';
  end if;
  insert into verificacion(detalle) values ('el respaldo diferido aborta un delivery que quedaria sin destino');

  -- ── 13. los pedidos anteriores al contrato siguen siendo operables ────────
  -- Una fila de delivery SIN confirmacion, cuyo evento de alta ya paso: es lo
  -- que hoy hay en la base. El Panel y el Rider tienen que poder avanzarla.
  v_result := public.create_order_with_items(jsonb_build_object(
    'business_id', v_business, 'client_request_id', 'loclegacy00000001',
    'tracking_token', repeat('y', 40),
    'items', jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 1)),
    'customer_name', 'Cliente Anterior', 'customer_phone', '2996209136',
    'delivery_mode', 'pickup', 'payment_method', 'cash'
  ));
  v_legacy := (v_result ->> 'id')::uuid;
  set constraints all immediate;
  set constraints all deferred;
  update public.orders
     set fulfillment_type = 'delivery', delivery_mode = 'delivery', status = 'preparing'
   where id = v_legacy;
  set constraints all immediate;
  set constraints all deferred;
  if (select status from public.orders where id = v_legacy) <> 'preparing' then
    raise exception 'no se pudo avanzar un pedido anterior al contrato';
  end if;
  insert into verificacion(detalle) values ('un pedido de delivery anterior al contrato sigue avanzando de estado sin ser bloqueado');

  -- ── 14. PEDIDO QA DEMOSTRATIVO ────────────────────────────────────────────
  -- Un pedido nuevo, creado por el camino real, para mostrar el mismo punto
  -- recorriendo la cadena: dirección confirmada -> pedido -> lo que lee el
  -- Panel -> lo que lee el Rider después de tomar la entrega -> el enlace de
  -- Google Maps. Los productos del fixture son `catalog_origin='test_only'`, así
  -- que el pedido se clasifica como QA y no suena en el Panel del comercio.
  v_confirmado := clock_timestamp();
  v_result := public.upsert_current_customer_address(jsonb_build_object(
    'id', v_address_id,
    'label', 'Casa', 'street', 'Antartida Argentina', 'streetNumber', '2600',
    'city', 'Neuquen', 'province', 'Neuquen', 'isDefault', true,
    'latitude', v_lat::text, 'longitude', v_lng::text,
    'geolocationAccuracy', '12', 'locationSource', 'gps',
    'locationConfirmedAt', v_confirmado::text
  ));
  insert into demostracion(superficie, dato)
  values ('1. cliente confirma', format('%s -> %s, %s  origen=%s  precision=%s m  confirmado=%s',
    (v_result -> 'address') ->> 'formattedAddress',
    (v_result -> 'address') ->> 'latitude',
    (v_result -> 'address') ->> 'longitude',
    (v_result -> 'address') ->> 'locationSource',
    (v_result -> 'address') ->> 'geolocationAccuracy',
    (v_result -> 'address') ->> 'locationConfirmedAt'));

  v_result := public.create_order_with_items(jsonb_build_object(
    'business_id', v_business, 'client_request_id', 'locqademostracion1',
    'tracking_token', repeat('z', 40),
    'items', jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 1)),
    'customer_name', 'Cliente Ubicacion', 'customer_phone', '2996209136',
    'delivery_mode', 'delivery', 'payment_method', 'cash',
    'customer_address_id', v_address_id
  ));
  select * into v_order from public.orders where id = (v_result ->> 'id')::uuid;
  insert into demostracion(superficie, dato)
  values ('2. pedido', format('%s  origen_clasificado=%s  destino=%s, %s  origen=%s  confirmado=%s',
    v_order.public_code, v_order.origin,
    v_order.delivery_latitude, v_order.delivery_longitude,
    v_order.delivery_location_source, v_order.delivery_location_confirmed_at));

  insert into demostracion(superficie, dato)
  select '3. Panel', format('direccion=%s  punto=%s, %s',
    o.delivery_address_formatted, o.delivery_latitude, o.delivery_longitude)
    from public.orders o where o.id = v_order.id;

  -- Lo que la app del Rider lee. La revelación del punto del cliente exige TRES
  -- cosas a la vez: ser el rider asignado, tener membresía activa de rider y que
  -- el pedido esté después del claim. Se comprueban los dos lados: antes no, y
  -- después sí.
  insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v_rider, 'authenticated', 'authenticated', 'rider-ubicacion@example.invalid', '', '{}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp());
  insert into public.business_members (business_id, user_id, role, is_active)
  values (v_business, v_rider, 'rider', true);

  perform set_config('request.jwt.claim.sub', v_rider::text, true);
  if (private.rider_map_location_payload(v_order.id, true) -> 'customer_location') is distinct from 'null'::jsonb then
    raise exception 'el Rider vio el punto exacto ANTES de tomar la entrega';
  end if;
  insert into demostracion(superficie, dato)
  values ('4. Rider pre-claim', 'customer_location = null (el punto exacto no se revela antes del claim)');
  insert into verificacion(detalle) values ('el Rider no ve el punto exacto antes de tomar la entrega');

  -- Un pedido QA está deliberadamente fuera de la cola del Rider, así que el
  -- claim se escribe a mano: lo que se demuestra acá es la revelación del punto,
  -- no la cola.
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  update public.orders
     set assigned_rider_user_id = v_rider, status = 'on_the_way'
   where id = v_order.id;
  perform set_config('request.jwt.claim.sub', v_rider::text, true);

  v_payload := private.rider_map_location_payload(v_order.id, true);
  if (v_payload -> 'customer_location' ->> 'latitude') is null
    or (v_payload -> 'customer_location' ->> 'latitude')::numeric is distinct from v_lat
    or (v_payload -> 'customer_location' ->> 'longitude')::numeric is distinct from v_lng then
    raise exception 'el Rider no lee el mismo punto que confirmo el cliente: %', v_payload;
  end if;
  insert into demostracion(superficie, dato)
  values ('5. Rider post-claim', (v_payload -> 'customer_location')::text);
  insert into verificacion(detalle) values ('pedido QA demostrativo: el punto que confirmo el cliente es exactamente el que lee el Rider tras el claim');

  perform set_config('request.jwt.claim.sub', v_user::text, true);
  insert into demostracion(superficie, dato)
  values ('6. Google Maps', format(
    'https://www.google.com/maps/dir/?api=1&destination=%s',
    replace(format('%s,%s', to_char(v_order.delivery_latitude, 'FM990.0000000'),
                            to_char(v_order.delivery_longitude, 'FM990.0000000')), ',', '%2C')));
end;
$certificacion$;

select format('OK %s %s', n, detalle) from verificacion order by n;
select format('TRAZA %s %s | %s', n, superficie, dato) from demostracion order by n;
select format('CERTIFICADO %s afirmaciones sobre PostgreSQL real', count(*)) from verificacion;

rollback;
