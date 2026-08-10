-- LA CADENA COMPLETA, EN UNA SOLA CORRIDA Y SIN INTERVENCION TECNICA.
--
-- Cliente -> checkout -> pago -> pedido -> Panel -> aceptar/preparar/listo ->
-- cola Rider -> claim -> retirado -> en camino -> llego -> codigo -> entregado.
--
-- Es la frase exacta de la que depende la declaracion del encargo, probada como
-- una sola cadena continua sobre UN pedido y no como piezas sueltas.
--
--   node scripts/run-order-intake-drill.mjs supabase/tests/order_end_to_end_chain.local.sql

\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function pg_temp.ok(p_condicion boolean, p_nombre text, p_detalle text default '')
returns void
language plpgsql as $$
begin
  if p_condicion then
    raise notice 'OK    %  %', rpad(p_nombre, 56, '.'), p_detalle;
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
  v_slug text := 'e2e-' || right(replace(gen_random_uuid()::text, '-', ''), 10);
  v_business uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_asset uuid := gen_random_uuid();
  v_owner uuid; v_staff uuid; v_rider uuid; v_rider2 uuid; v_cliente uuid;
  v_identity text; v_master text; v_thumb text;
  v_h1 text := encode(gen_random_bytes(32), 'hex');
  v_h2 text := encode(gen_random_bytes(32), 'hex');
  v_h3 text := encode(gen_random_bytes(32), 'hex');
  v_h4 text := encode(gen_random_bytes(32), 'hex');
  v_session uuid; v_intent uuid; v_prepare jsonb; v_res jsonb;
  v_order uuid; v_code text; v_rev bigint; v_estado text;
  v_stock integer; v_n integer; v_token text; v_entrega text;
  v_gano2 boolean;
begin
  raise notice '';
  raise notice '################ LA CADENA COMPLETA ################';
  v_owner := pg_temp.nuevo_usuario(v_slug || '-owner');
  v_staff := pg_temp.nuevo_usuario(v_slug || '-staff');
  v_rider := pg_temp.nuevo_usuario(v_slug || '-rider');
  v_rider2 := pg_temp.nuevo_usuario(v_slug || '-rider2');
  v_cliente := pg_temp.nuevo_usuario(v_slug || '-cliente');

  insert into public.businesses (
    id, name, slug, status, is_active, ordering_enabled, ordering_verified,
    ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled,
    delivery_enabled, delivery_fee, minimum_delivery_subtotal
  ) values (
    v_business, 'La Taba E2E', v_slug, 'open', true, true, true,
    clock_timestamp(), v_owner, 'ARS', true, true, 500.00, 0.00
  );
  insert into public.business_members (business_id, user_id, role, is_active) values
    (v_business, v_owner, 'owner', true), (v_business, v_staff, 'staff', true),
    (v_business, v_rider, 'rider', true), (v_business, v_rider2, 'rider', true);

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
    v_h4, 'https://example.invalid/' || v_slug || '.webp', 'PROPIO', 'cadena e2e',
    clock_timestamp(), v_owner, 'commercial'
  );
  insert into public.products (
    id, business_id, name, description, category, price, image_url, is_active,
    brand, subcategory, presentation, capacity, packaging_type, stock, available,
    is_alcoholic, is_verified, chilled, units_per_pack, external_id, sku,
    catalog_asset_id, image_sha256, image_thumbnail_url, image_thumbnail_sha256,
    source_image_sha256, variant, capacity_value, capacity_unit, catalog_origin, price_status,
    verified_at, verified_by
  ) values (
    v_product, v_business, 'Lata E2E', 'Cadena completa', 'Gaseosas', 1000.00,
    'assets/products/' || v_slug || '.webp', true, 'TABA2 QA', 'Cola', 'Lata 473 ml', '473 ml', 'lata',
    12, true, false, true, false, 1, v_slug || '-ext', v_slug || '-sku', v_asset,
    v_h1, 'assets/products/' || v_slug || '-t.webp', v_h2, v_h4,
    'Lata 473 ml', 473, 'ml', 'commercial', 'confirmed',
    clock_timestamp(), v_owner
  );
  insert into public.business_payment_settings (
    business_id, enabled, environment, checkout_mode, currency, reserve_stock,
    collector_id, application_id, configured_at, verified_at
  ) values (v_business, true, 'test', 'checkout_pro', 'ARS', true,
    'collector-' || v_slug, 'app-' || v_slug, clock_timestamp(), clock_timestamp());

  -- ── 1 · el cliente arma el carrito y va a pagar ──────────────────────────
  v_res := public.create_checkout_session(v_cliente, jsonb_build_object(
    'business_id', v_business, 'client_request_id', 'e2echain0001',
    'items', jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 2)),
    'fulfillment_type', 'delivery',
    'contact', jsonb_build_object('name', 'Cliente E2E', 'phone', '5492990000000'),
    'address', jsonb_build_object(
      'street', 'Mendoza', 'street_number', '850', 'city', 'Neuquen', 'province', 'Neuquen',
      'label', 'Casa',
      -- El punto lo confirmo la persona: DELIVERY_LOCATION_REQUIRED lo exige y
      -- este arnes lo SATISFACE, no lo relaja.
      'latitude', '-38.953900', 'longitude', '-68.059600',
      'location_source', 'map_pin', 'location_confirmed_at', clock_timestamp()::text
    ),
    'age_confirmed', false, 'payment_method', 'mercadopago'
  ));
  v_session := (v_res ->> 'checkout_session_id')::uuid;
  select stock into v_stock from public.products where id = v_product;
  perform pg_temp.ok(v_session is not null and v_stock = 10,
    '1 · el checkout reserva el stock', 'stock=' || v_stock);

  v_prepare := public.prepare_mercadopago_preference(v_session, v_cliente, false);
  perform public.record_mercadopago_preference_created(
    (v_prepare ->> 'payment_attempt_id')::uuid, 'PREF-' || right(replace(v_session::text,'-',''),16),
    'https://www.mercadopago.com/r/e2e', 'https://sandbox.mercadopago.com/r/e2e',
    encode(gen_random_bytes(32), 'hex'), 'req-e2e');
  select id into v_intent from public.payment_intents where checkout_session_id = v_session;
  perform pg_temp.ok(v_intent is not null, '2 · la preferencia queda creada en Mercado Pago');

  -- ── 2 · paga, y NO vuelve. Lo descubre el barrido, no el cliente ─────────
  update public.checkout_sessions set status = 'redirected', created_at = clock_timestamp() - interval '3 minutes'
   where id = v_session;
  update public.inventory_reservations set created_at = clock_timestamp() - interval '3 minutes'
   where checkout_session_id = v_session;
  v_n := public.enqueue_checkout_provider_probes(50);
  perform pg_temp.ok(v_n >= 1, '3 · el barrido va a preguntarle al proveedor', 'sondas=' || v_n);

  -- Lo que el worker trae de Mercado Pago.
  v_res := public.record_mercadopago_payment_snapshot(v_intent, (
    select jsonb_build_object(
      'provider_payment_id', 'PAY-E2E-' || right(replace(v_session::text,'-',''),8),
      'external_reference', 'taba2:checkout:' || v_session::text,
      'preference_id', pi.preference_id,
      'merchant_order_id', 'MO-E2E', 'collector_id', ps.collector_id, 'currency', 'ARS',
      'transaction_amount', cs.total::text, 'status', 'approved',
      'status_detail', 'accredited', 'payment_method', 'visa', 'live_mode', false,
      'provider_occurred_at', clock_timestamp()::text, 'refunded_amount', '0.00',
      'payer_email_hash', encode(gen_random_bytes(32), 'hex'),
      'raw_response_hash', encode(gen_random_bytes(32), 'hex'))
    from public.payment_intents pi
    join public.checkout_sessions cs on cs.id = pi.checkout_session_id
    join public.business_payment_settings ps on ps.business_id = pi.business_id and ps.provider = 'mercadopago'
    where pi.id = v_intent), 'reconciliation', null);
  perform pg_temp.ok(v_res ->> 'finalize_required' = 'true',
    '4 · el pago se verifica sin que el cliente vuelva');

  v_res := public.finalize_paid_checkout_session(v_session);
  v_order := (v_res ->> 'order_id')::uuid;
  v_code := v_res ->> 'order_code';
  perform pg_temp.ok(v_order is not null, '5 · el pedido nace solo', v_code);
  select stock into v_stock from public.products where id = v_product;
  perform pg_temp.ok(v_stock = 10, '   y el stock reservado se convierte, no se descuenta de nuevo', 'stock=' || v_stock);

  -- ── 3 · el Panel ─────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff::text, 'role', 'authenticated')::text, true);
  select count(*)::integer into v_n from public.list_operational_pipeline(v_business, true) p
   where p.reference_id = v_order;
  perform pg_temp.ok(v_n = 1, '6 · el Panel lo ve sin refrescar a mano');

  select revision into v_rev from public.orders where id = v_order;
  -- Las claves de idempotencia llevan al menos 8 caracteres, como el contrato.
  perform public.transition_order(v_order, v_rev, 'accepted', 'e2e-aceptado');
  select revision into v_rev from public.orders where id = v_order;
  perform public.transition_order(v_order, v_rev, 'preparing', 'e2e-preparando');
  select revision into v_rev from public.orders where id = v_order;
  perform public.transition_order(v_order, v_rev, 'ready', 'e2e-listo-ya');
  select status, revision into v_estado, v_rev from public.orders where id = v_order;
  perform pg_temp.ok(v_estado = 'ready', '7 · el Panel lo acepta, prepara y deja listo', v_estado);

  -- ── 4 · el Rider ─────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_rider::text, 'role', 'authenticated')::text, true);
  select count(*)::integer into v_n from public.list_available_rider_orders(v_business) o where o.public_code = v_code;
  perform pg_temp.ok(v_n = 1, '8 · el Rider lo recibe en su cola');

  perform pg_temp.ok(
    (public.claim_delivery_order(v_business, v_code, v_rev, 'e2e-claim') ->> 'ok')::boolean,
    '9 · el Rider lo toma');

  -- Y otro Rider no puede quedarselo.
  perform set_config('request.jwt.claims', json_build_object('sub', v_rider2::text, 'role', 'authenticated')::text, true);
  begin
    v_gano2 := coalesce((public.claim_delivery_order(v_business, v_code, v_rev, 'e2e-claim2') ->> 'ok')::boolean, false);
  exception when others then v_gano2 := false;
  end;
  perform pg_temp.ok(not v_gano2, '   y un segundo Rider no se lo puede quitar');

  perform set_config('request.jwt.claims', json_build_object('sub', v_rider::text, 'role', 'authenticated')::text, true);
  select revision into v_rev from public.orders where id = v_order;
  perform public.mark_delivery_picked_up(v_order, v_rev, 'e2e-pick');
  select revision into v_rev from public.orders where id = v_order;
  perform public.start_rider_delivery(v_order, v_rev, 'e2e-start');
  select revision into v_rev from public.orders where id = v_order;
  perform public.mark_rider_arrived(v_order, v_rev, 'e2e-arrive');
  select status, revision into v_estado, v_rev from public.orders where id = v_order;
  perform pg_temp.ok(v_estado = 'arrived', '10 · retirado, en camino y llego', v_estado);

  -- ── 5 · el cliente da su codigo y se cierra ──────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_cliente::text, 'role', 'authenticated')::text, true);
  v_token := encode(gen_random_bytes(32), 'hex');
  v_res := public.recover_order_tracking_access(v_order, v_token);
  v_entrega := coalesce(v_res ->> 'delivery_code', v_res ->> 'code');
  perform pg_temp.ok(v_entrega is not null, '11 · el cliente obtiene su codigo de entrega');

  perform set_config('request.jwt.claims', json_build_object('sub', v_rider::text, 'role', 'authenticated')::text, true);
  select revision into v_rev from public.orders where id = v_order;
  perform pg_temp.ok(
    coalesce((public.confirm_delivery_code(v_order, v_rev, '000000', 'e2e-malo') ->> 'ok')::boolean, false) = false,
    '   un codigo incorrecto no cierra el pedido');

  select revision into v_rev from public.orders where id = v_order;
  perform public.confirm_delivery_code(v_order, v_rev, v_entrega, 'e2e-bien');
  select status into v_estado from public.orders where id = v_order;
  perform pg_temp.ok(v_estado = 'delivered', '12 · ENTREGADO', v_estado);

  -- ── 6 · el dinero no se movio en todo el circuito ────────────────────────
  perform pg_temp.ok(
    (select o.total = 2500.00 and o.subtotal = 2000.00 and o.delivery_fee = 500.00
       from public.orders o where o.id = v_order),
    '13 · el dinero es el mismo del principio al final',
    (select 'subtotal=' || o.subtotal || ' envio=' || o.delivery_fee || ' total=' || o.total
       from public.orders o where o.id = v_order));
  select count(*)::integer into v_n from public.orders where business_id = v_business;
  perform pg_temp.ok(v_n = 1, '14 · un solo pedido en todo el negocio', 'pedidos=' || v_n);

  -- ── 7 · y la operacion queda limpia ──────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff::text, 'role', 'authenticated')::text, true);
  perform public.refresh_operational_alerts(v_business);
  select count(*)::integer into v_n from public.operational_alerts a
   where a.business_id = v_business and a.status <> 'resolved';
  perform pg_temp.ok(v_n = 0, '15 · sin una sola alerta abierta al terminar', 'abiertas=' || v_n);

  raise notice '';
  raise notice 'Un pedido valido recorrio Cliente -> Panel -> Rider -> entrega';
  raise notice 'sin una sola intervencion tecnica, y el cliente nunca volvio a la app.';
end $$;
