-- Escenario sintético para el drill de recuperación y la certificación de la
-- superficie operativa del piloto.
--
-- Cero datos humanos. Cada fila lleva "FIXTURE" en el nombre y un dominio
-- `.invalid`, que por RFC 2606 no puede resolverse nunca. No se copia, deriva
-- ni anonimiza nada de una persona real: todo se inventa acá.
--
-- El escenario está calibrado para que cada número del tablero tenga un valor
-- esperado y verificable; `pilot-ops-contract-assertions.sql` los comprueba uno
-- por uno y aborta si alguno se corre.

-- Publicar un producto exige activo de catálogo con hashes y binding
-- consistentes. El fixture los construye con las mismas funciones del catálogo
-- real, así que el producto queda publicado por la puerta legítima.
create or replace function pg_temp.fixture_publish_product(
  p_id uuid, p_name text, p_category text, p_price numeric, p_stock integer
) returns void
language plpgsql
as $fixture_publish_product$
declare
  v_biz uuid := '00000000-0000-4000-8000-000000000001';
  v_sku text := 'fixture-' || replace(p_id::text, '-', '');
  v_src text := encode(sha256(('src' || p_id::text)::bytea), 'hex');
  v_master text := encode(sha256(('master' || p_id::text)::bytea), 'hex');
  v_thumb text := encode(sha256(('thumb' || p_id::text)::bytea), 'hex');
  v_identity text;
  v_master_path text;
  v_thumb_path text;
  v_asset uuid;
begin
  v_identity := public.catalog_image_identity_sha256(v_sku, v_sku, v_src);
  v_master_path := public.catalog_asset_path(v_sku, v_identity, 'master', v_master);
  v_thumb_path := public.catalog_asset_path(v_sku, v_identity, 'thumbnail', v_thumb);

  insert into public.catalog_assets (
    business_id, external_id, sku, safe_sku, identity_sha256, master_path, master_sha256,
    master_binding_sha256, thumbnail_path, thumbnail_sha256, thumbnail_binding_sha256,
    source_sha256, source_url, rights_status, rights_reference, catalog_origin
  ) values (
    v_biz, v_sku, v_sku, v_sku, v_identity, v_master_path, v_master,
    public.catalog_asset_binding_sha256(v_identity, 'master', v_src, v_master, 1000, 1000, v_master_path),
    v_thumb_path, v_thumb,
    public.catalog_asset_binding_sha256(v_identity, 'thumbnail', v_src, v_thumb, 400, 400, v_thumb_path),
    v_src, 'https://fixture.invalid/' || v_sku || '.webp', 'UNAPPROVED_QA', 'fixture sintetico', 'demo_fixture'
  )
  returning id into v_asset;

  insert into public.products (
    id, business_id, name, brand, category, subcategory, presentation, variant, capacity,
    capacity_value, capacity_unit, packaging_type, price, stock, units_per_pack, sort_order,
    is_active, is_verified, available, is_alcoholic, minimum_age, catalog_origin, catalog_asset_id,
    image_url, image_sha256, image_thumbnail_url, image_thumbnail_sha256, source_image_sha256
  ) values (
    p_id, v_biz, p_name, 'FIXTURE', p_category, 'General', '500 ml', '500 ml', '500 ml',
    500, 'ml', 'botella', p_price, p_stock, 1, 0,
    true, true, p_stock > 0, false, null,
    'demo_fixture', v_asset,
    v_master_path, v_master, v_thumb_path, v_thumb, v_src
  );
end;
$fixture_publish_product$;

do $scenario$
declare
  v_biz uuid := '00000000-0000-4000-8000-000000000001';
  v_tz text := 'America/Argentina/Buenos_Aires';
  v_t0 timestamptz;
  v_yesterday timestamptz;
  v_owner uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  v_rider uuid := 'aaaaaaaa-0000-4000-8000-000000000002';
  v_customer uuid := 'aaaaaaaa-0000-4000-8000-000000000003';
  v_o1 uuid;
  v_order uuid;
  v_cs record;
  v_p_low uuid := 'bbbbbbbb-0000-4000-8000-000000000001';
  v_p_zero uuid := 'bbbbbbbb-0000-4000-8000-000000000002';
  v_p_ok uuid := 'bbbbbbbb-0000-4000-8000-000000000003';
  i integer;
begin
  -- ===== Actores sintéticos =====
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values
    (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ops-owner@fixture.invalid', '', now(), now()),
    (v_rider, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ops-rider@fixture.invalid', '', now(), now()),
    (v_customer, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ops-customer@fixture.invalid', '', now(), now())
  on conflict (id) do nothing;

  insert into public.business_members (business_id, user_id, role, is_active)
  values (v_biz, v_owner, 'owner', true), (v_biz, v_rider, 'rider', true)
  on conflict do nothing;

  -- Los guards de rol evalúan igual que en producción.
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  v_t0 := (date_trunc('day', clock_timestamp() at time zone v_tz)) at time zone v_tz + interval '2 minutes';
  v_yesterday := (date_trunc('day', clock_timestamp() at time zone v_tz) - interval '1 day') at time zone v_tz + interval '3 hours';

  -- Umbrales de un minuto: el escenario deja de depender del reloj.
  perform public.configure_pilot_ops_thresholds(v_biz, jsonb_build_object(
    'order_acceptance_minutes', '1', 'rider_assignment_minutes', '1',
    'delivery_minutes', '1', 'rider_signal_stale_minutes', '1', 'low_stock_units', '5'
  ));

  -- ===== Catálogo publicado =====
  perform pg_temp.fixture_publish_product(v_p_low, 'FIXTURE Gaseosa 500 ml', 'Gaseosas', 1500, 2);
  perform pg_temp.fixture_publish_product(v_p_zero, 'FIXTURE Agua 1 l', 'Aguas', 1200, 0);
  perform pg_temp.fixture_publish_product(v_p_ok, 'FIXTURE Jugo 1 l', 'Jugos', 2500, 50);
  -- Sin publicar: comprueba que el conteo de stock mira sólo lo vendible.
  insert into public.products (id, business_id, name, price, is_active, is_verified, available, stock, category)
  values ('bbbbbbbb-0000-4000-8000-000000000004', v_biz, 'FIXTURE Borrador sin publicar', 900, true, false, false, null, 'Picadas y deli');

  -- ===== Pedidos de hoy =====
  insert into public.orders (business_id, client_request_id, status, payment_method, delivery_mode,
                             subtotal, total, customer_name, created_at, updated_at, delivered_at, origin)
  values (v_biz, 'fixture-ops-o1', 'delivered', 'cash', 'delivery', 15000, 15000,
          'FIXTURE Cliente Uno', v_t0, v_t0, v_t0 + interval '30 minutes', 'production')
  returning id into v_o1;

  insert into public.orders (business_id, client_request_id, status, payment_method, delivery_mode,
                             subtotal, total, customer_name, created_at, updated_at, cancelled_at, origin)
  values (v_biz, 'fixture-ops-o2', 'cancelled', 'cash', 'delivery', 9000, 9000,
          'FIXTURE Cliente Dos', v_t0, v_t0, v_t0 + interval '5 minutes', 'production');

  insert into public.orders (business_id, client_request_id, status, payment_method, delivery_mode,
                             subtotal, total, customer_name, created_at, updated_at, origin)
  values (v_biz, 'fixture-ops-o3', 'submitted', 'cash', 'delivery', 5000, 5000,
          'FIXTURE Cliente Tres', v_t0, v_t0, 'production');

  insert into public.orders (business_id, client_request_id, status, payment_method, delivery_mode,
                             subtotal, total, customer_name, created_at, updated_at, ready_at, origin)
  values (v_biz, 'fixture-ops-o4', 'ready', 'cash', 'delivery', 7000, 7000,
          'FIXTURE Cliente Cuatro', v_t0, v_t0, v_t0, 'production');

  insert into public.orders (business_id, client_request_id, status, payment_method, delivery_mode,
                             subtotal, total, customer_name, created_at, updated_at, ready_at,
                             assigned_rider_user_id, origin)
  values (v_biz, 'fixture-ops-o5', 'assigned', 'cash', 'delivery', 8000, 8000,
          'FIXTURE Cliente Cinco', v_t0, v_t0, v_t0, v_rider, 'production');

  -- Pedido QA: se conserva como evidencia y no cuenta en ningún número comercial.
  insert into public.orders (business_id, client_request_id, status, payment_method, delivery_mode,
                             subtotal, total, customer_name, created_at, updated_at, delivered_at,
                             origin, origin_reason, origin_classified_at)
  values (v_biz, 'fixture-ops-qa1', 'delivered', 'qa_no_charge', 'delivery', 99999, 99999,
          'FIXTURE QA Synthetic', v_t0, v_t0, v_t0 + interval '10 minutes',
          'qa', 'fixture_scenario', v_t0);

  insert into public.order_items (order_id, product_id, product_uuid, name, quantity, unit_price, subtotal)
  select o.id, v_p_ok::text, v_p_ok, 'FIXTURE Jugo 1 l', 1, 2500, 2500
    from public.orders o
   where o.business_id = v_biz
     and o.client_request_id in ('fixture-ops-o1', 'fixture-ops-o4', 'fixture-ops-o5');

  -- ===== Checkouts y pagos =====
  -- Las sesiones que el barrido de expiración puede tocar llevan vencimiento
  -- futuro: el escenario mide el tablero, no al cron.
  insert into public.checkout_sessions (business_id, customer_id, client_request_id, normalized_intent_hash,
                                        fulfillment_type, subtotal, total, status, expires_at, created_at,
                                        updated_at, completed_order_id, origin)
  values
    (v_biz, v_customer, 'fixture-cs-0001', repeat('a', 64), 'delivery', 15000, 15000,
     'completed', v_t0 + interval '6 hours', v_t0, v_t0, v_o1, 'production'),
    (v_biz, v_customer, 'fixture-cs-0002', repeat('b', 64), 'delivery', 12000, 12000,
     'finalizing_order', v_t0 + interval '6 hours', v_t0, v_t0, null, 'production'),
    (v_biz, v_customer, 'fixture-cs-0003', repeat('c', 64), 'delivery', 6000, 6000,
     'redirected', v_t0 + interval '6 hours', v_t0, v_t0, null, 'production'),
    (v_biz, v_customer, 'fixture-cs-0004', repeat('d', 64), 'delivery', 3000, 3000,
     'cancelled', v_t0 + interval '6 hours', v_t0, v_t0, null, 'production'),
    (v_biz, v_customer, 'fixture-cs-0005', repeat('e', 64), 'delivery', 4000, 4000,
     'payment_approved', v_t0 + interval '6 hours', v_t0, v_t0, null, 'production'),
    (v_biz, v_customer, 'fixture-cs-0006', repeat('f', 64), 'delivery', 200, 200,
     'completed', v_t0 + interval '6 hours', v_t0, v_t0, null, 'production'),
    (v_biz, v_customer, 'fixture-cs-00qa', repeat('9', 64), 'delivery', 99999, 99999,
     'completed', v_t0 + interval '6 hours', v_t0, v_t0, null, 'qa');

  for v_cs in
    select id, client_request_id from public.checkout_sessions
     where business_id = v_biz and client_request_id like 'fixture-cs-%'
  loop
    if v_cs.client_request_id = 'fixture-cs-0001' then
      insert into public.payment_intents (checkout_session_id, business_id, order_id, environment, external_reference,
                                          internal_status, expected_amount, paid_amount, approved_at,
                                          preference_created_at, created_at, updated_at, provider_payment_id)
      values (v_cs.id, v_biz, v_o1, 'test', 'taba2:checkout:' || v_cs.id::text, 'completed', 15000, 15000,
              v_t0 + interval '3 minutes', v_t0, v_t0, v_t0, 'fixture-mp-1');
    elsif v_cs.client_request_id = 'fixture-cs-0002' then
      -- Aprobado y sin pedido: es la excepción más cara del circuito.
      insert into public.payment_intents (checkout_session_id, business_id, order_id, environment, external_reference,
                                          internal_status, expected_amount, paid_amount, approved_at,
                                          preference_created_at, created_at, updated_at, provider_payment_id)
      values (v_cs.id, v_biz, null, 'test', 'taba2:checkout:' || v_cs.id::text, 'approved_order_pending', 12000, 12000,
              v_t0 + interval '3 minutes', v_t0, v_t0, v_t0, 'fixture-mp-2');
    elsif v_cs.client_request_id = 'fixture-cs-0003' then
      insert into public.payment_intents (checkout_session_id, business_id, order_id, environment, external_reference,
                                          internal_status, expected_amount, preference_created_at,
                                          created_at, updated_at, provider_payment_id)
      values (v_cs.id, v_biz, null, 'test', 'taba2:checkout:' || v_cs.id::text, 'pending', 6000, v_t0,
              v_t0, v_t0, 'fixture-mp-3');
    elsif v_cs.client_request_id = 'fixture-cs-0004' then
      insert into public.payment_intents (checkout_session_id, business_id, order_id, environment, external_reference,
                                          internal_status, expected_amount, rejected_at, preference_created_at,
                                          created_at, updated_at, provider_payment_id)
      values (v_cs.id, v_biz, null, 'test', 'taba2:checkout:' || v_cs.id::text, 'rejected', 3000,
              v_t0 + interval '4 minutes', v_t0, v_t0, v_t0, 'fixture-mp-4');
    elsif v_cs.client_request_id = 'fixture-cs-0006' then
      -- Cobrado un importe distinto del autorizado.
      insert into public.payment_intents (checkout_session_id, business_id, order_id, environment, external_reference,
                                          internal_status, expected_amount, paid_amount, approved_at,
                                          preference_created_at, created_at, updated_at, provider_payment_id)
      values (v_cs.id, v_biz, v_o1, 'test', 'taba2:checkout:' || v_cs.id::text, 'approved', 200, 100,
              v_t0 + interval '3 minutes', v_t0, v_t0, v_t0, 'fixture-mp-6');
    elsif v_cs.client_request_id = 'fixture-cs-00qa' then
      -- Aprobado y sin pedido, pero QA: no puede aparecer en ningún número.
      insert into public.payment_intents (checkout_session_id, business_id, order_id, environment, external_reference,
                                          internal_status, expected_amount, paid_amount, approved_at,
                                          preference_created_at, created_at, updated_at, provider_payment_id)
      values (v_cs.id, v_biz, null, 'test', 'taba2:checkout:' || v_cs.id::text, 'approved', 99999, 99999,
              v_t0 + interval '3 minutes', v_t0, v_t0, v_t0, 'fixture-mp-qa');
    end if;
  end loop;

  -- Reserva vencida y no liberada: stock comprometido que nadie compró.
  insert into public.inventory_reservations (checkout_session_id, product_id, quantity, status, expires_at, created_at)
  select cs.id, v_p_ok, 3, 'active', clock_timestamp() - interval '10 minutes', v_t0
    from public.checkout_sessions cs
   where cs.business_id = v_biz and cs.client_request_id = 'fixture-cs-0003';

  -- Cola de pagos trabada: uno abandonado y uno vencido.
  insert into public.payment_outbox (payment_intent_id, topic, status, attempts, next_attempt_at, created_at)
  select pi.id, 'payment', 'dead_letter', 8, clock_timestamp() - interval '1 hour', v_t0
    from public.payment_intents pi where pi.provider_payment_id = 'fixture-mp-2';
  insert into public.payment_outbox (payment_intent_id, topic, status, attempts, next_attempt_at, created_at)
  select pi.id, 'payment', 'pending', 3, clock_timestamp() - interval '20 minutes', v_t0
    from public.payment_intents pi where pi.provider_payment_id = 'fixture-mp-3';

  -- Avisos del proveedor: uno procesado y uno con firma inválida.
  insert into public.payment_webhook_receipts (environment, webhook_event_id, event_type, resource_id,
                                               signature_valid, payload_hash, received_at, processing_status)
  values
    ('test', 'fixture-wh-1', 'payment', 'fixture-mp-1', true, repeat('1', 64), clock_timestamp() - interval '5 minutes', 'completed'),
    ('test', 'fixture-wh-2', 'payment', 'fixture-mp-3', false, repeat('2', 64), clock_timestamp() - interval '2 minutes', 'rejected_signature');

  -- Un comando real del Panel: sin esto su salud es "sin señal", no "sana".
  insert into public.business_command_receipts (business_id, order_id, actor_user_id, command_type,
                                                idempotency_key, request_hash, result, created_at)
  values (v_biz, v_o1, v_owner, 'order.transition', 'fixture-cmd-0001', repeat('3', 64),
          '{"ok":true}'::jsonb, clock_timestamp() - interval '2 minutes');

  -- ===== Volumen del día anterior =====
  -- Le da al reporte comercial una muestra suficiente para ordenar por ventas,
  -- y así se prueban las dos ramas del guard de muestra.
  for i in 1..25 loop
    insert into public.orders (business_id, client_request_id, status, payment_method, delivery_mode,
                               subtotal, total, customer_name, created_at, updated_at,
                               accepted_at, ready_at, delivered_at, origin)
    values (v_biz, 'fixture-vol-' || lpad(i::text, 4, '0'), 'delivered', 'cash', 'delivery',
            1000 * i, 1000 * i, 'FIXTURE Volumen ' || i,
            v_yesterday + make_interval(mins => i), v_yesterday + make_interval(mins => i),
            v_yesterday + make_interval(mins => i + 2),
            v_yesterday + make_interval(mins => i + 12),
            v_yesterday + make_interval(mins => i + 30), 'production')
    returning id into v_order;

    insert into public.order_items (order_id, product_id, product_uuid, name, quantity, unit_price, subtotal)
    values (v_order, v_p_ok::text, v_p_ok, 'FIXTURE Jugo 1 l', 2, 2500, 5000);
    if i % 5 = 0 then
      insert into public.order_items (order_id, product_id, product_uuid, name, quantity, unit_price, subtotal)
      values (v_order, v_p_low::text, v_p_low, 'FIXTURE Gaseosa 500 ml', 1, 1500, 1500);
    end if;
    if i % 4 = 0 then
      insert into public.order_combos (order_id, combo_id, name, quantity, discount_percentage,
                                       list_price, promotional_price, discount_amount, combo_snapshot)
      values (v_order, 'fixture-combo-noche', 'FIXTURE Combo noche', 1, 10,
              10000, 9000, 1000, '{"fixture": true}'::jsonb);
    end if;
  end loop;

  raise notice 'fixture sintetico del piloto cargado';
end;
$scenario$;
