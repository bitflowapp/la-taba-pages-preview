-- Isolated local database certification for the PostgreSQL checkout core.
-- Run only against a disposable database after all migrations.
begin;

do $$
declare
  v_user uuid := '10000000-0000-4000-8000-000000000001';
  v_business uuid := '20000000-0000-4000-8000-000000000001';
  v_product uuid := '30000000-0000-4000-8000-000000000001';
  v_asset uuid := '40000000-0000-4000-8000-000000000001';
  v_session uuid;
  v_second_session uuid;
  v_intent uuid;
  v_result jsonb;
  v_prepare jsonb;
  v_order uuid;
  v_stock integer;
  v_count integer;
  v_hash text := repeat('a', 64);
  v_master_hash text := repeat('b', 64);
  v_thumbnail_hash text := repeat('c', 64);
  v_source_hash text := repeat('d', 64);
  v_identity text;
  v_master_path text;
  v_thumbnail_path text;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.payment_intents'::regclass) then
    raise exception 'payment_intents must have RLS enabled';
  end if;
  if has_table_privilege('authenticated', 'public.payment_intents', 'insert')
    or has_table_privilege('anon', 'public.payment_webhook_receipts', 'insert') then
    raise exception 'browser roles must not write payment tables directly';
  end if;
  if has_function_privilege('authenticated', 'public.create_checkout_session(uuid,jsonb)'::regprocedure, 'execute')
    or not has_function_privilege('service_role', 'public.create_checkout_session(uuid,jsonb)'::regprocedure, 'execute') then
    raise exception 'checkout session RPC grants are not least-privilege';
  end if;

  insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v_user, 'authenticated', 'authenticated', 'mp-checkout-test@example.invalid', '', '{}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp());

  insert into public.businesses (
    id, name, slug, status, is_active, ordering_enabled, ordering_verified,
    ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled
  ) values (
    v_business, 'MP lifecycle fixture', 'mp-lifecycle-fixture', 'open', true, true, true,
    clock_timestamp(), v_user, 'ARS', true
  );

  v_identity := public.catalog_image_identity_sha256('mp-fixture-external', 'mp-fixture-sku', v_source_hash);
  v_master_path := public.catalog_asset_path('mp-fixture-sku', v_identity, 'master', v_master_hash);
  v_thumbnail_path := public.catalog_asset_path('mp-fixture-sku', v_identity, 'thumbnail', v_thumbnail_hash);
  insert into public.catalog_assets (
    id, business_id, external_id, sku, safe_sku, identity_sha256, master_path,
    master_sha256, master_binding_sha256, thumbnail_path, thumbnail_sha256,
    thumbnail_binding_sha256, source_sha256, source_url, rights_status,
    rights_reference, approved_at, approved_by, catalog_origin
  ) values (
    v_asset, v_business, 'mp-fixture-external', 'mp-fixture-sku', 'mp-fixture-sku', v_identity,
    v_master_path, v_master_hash,
    public.catalog_asset_binding_sha256(v_identity, 'master', v_source_hash, v_master_hash, 1000, 1000, v_master_path),
    v_thumbnail_path, v_thumbnail_hash,
    public.catalog_asset_binding_sha256(v_identity, 'thumbnail', v_source_hash, v_thumbnail_hash, 400, 400, v_thumbnail_path),
    v_source_hash, 'https://example.invalid/mp-fixture.webp', 'UNAPPROVED_QA', 'isolated local fixture', null, null, 'test_only'
  );
  insert into public.products (
    id, business_id, name, description, category, price, image_url, is_active,
    brand, subcategory, presentation, capacity, packaging_type, stock, available,
    is_alcoholic, is_verified, chilled, units_per_pack, external_id, sku,
    catalog_asset_id, image_sha256, image_thumbnail_url, image_thumbnail_sha256,
    source_image_sha256, variant, capacity_value, capacity_unit, catalog_origin, price_status
  ) values (
    v_product, v_business, 'Bebida de prueba', 'Fixture local aislado', 'Gaseosas', 1250.00,
    'assets/products/mp-fixture.webp', true, 'TABA2 QA', 'Cola', 'Botella 1 l', '1 l', 'botella',
    10, true, false, true, false, 1, 'mp-fixture-external', 'mp-fixture-sku', v_asset,
    v_hash, 'assets/products/mp-fixture-thumb.webp', v_master_hash, v_source_hash,
    'Botella 1 l', 1, 'l', 'test_only', 'confirmed'
  );
  insert into public.business_payment_settings (
    business_id, enabled, environment, checkout_mode, currency, reserve_stock,
    collector_id, application_id, configured_at, verified_at
  ) values (v_business, true, 'test', 'checkout_pro', 'ARS', true, 'collector-fixture', 'application-fixture', clock_timestamp(), clock_timestamp());

  v_result := public.create_checkout_session(v_user, jsonb_build_object(
    'business_id', v_business, 'client_request_id', 'mpfixturecheckout0001',
    'items', jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 2)),
    'fulfillment_type', 'pickup', 'contact', jsonb_build_object('name', 'Cliente Fixture', 'phone', '5491100000000'),
    'address', '{}'::jsonb, 'age_confirmed', false, 'payment_method', 'mercadopago'
  ));
  v_session := (v_result ->> 'checkout_session_id')::uuid;
  if v_session is null or v_result ->> 'status' <> 'ready_for_payment' then raise exception 'session was not authoritatively prepared'; end if;
  select stock into v_stock from public.products where id = v_product;
  if v_stock <> 8 then raise exception 'reservation did not decrement once: %', v_stock; end if;
  if exists (select 1 from public.orders where business_id = v_business) then raise exception 'operational order was created before payment'; end if;
  if (public.create_checkout_session(v_user, jsonb_build_object(
    'business_id', v_business, 'client_request_id', 'mpfixturecheckout0001',
    'items', jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 2)),
    'fulfillment_type', 'pickup', 'contact', jsonb_build_object('name', 'Cliente Fixture', 'phone', '5491100000000'),
    'address', '{}'::jsonb, 'age_confirmed', false, 'payment_method', 'mercadopago'
  )) ->> 'checkout_session_id')::uuid <> v_session then raise exception 'checkout idempotency failed'; end if;
  select stock into v_stock from public.products where id = v_product;
  if v_stock <> 8 then raise exception 'double tap changed stock'; end if;

  begin
    perform public.create_checkout_session(v_user, jsonb_build_object(
      'business_id', v_business, 'client_request_id', 'mpfixturecheckoutbad1',
      'items', jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 1)),
      'fulfillment_type', 'pickup', 'contact', jsonb_build_object('name', 'Cliente Fixture', 'phone', '5491100000000'),
      'address', '{}'::jsonb, 'payment_method', 'mercadopago', 'total', 1
    ));
    raise exception 'client supplied total was accepted';
  exception when sqlstate '22023' then null;
  end;

  v_prepare := public.prepare_mercadopago_preference(v_session, v_user, false);
  if coalesce(jsonb_array_length(v_prepare -> 'items'), 0) <> 1 or v_prepare ->> 'currency' <> 'ARS' then raise exception 'preference snapshot invalid'; end if;
  perform public.record_mercadopago_preference_created(
    (v_prepare ->> 'payment_attempt_id')::uuid, 'PREF-FIXTURE-1', 'https://www.mercadopago.com/checkout/v1/redirect?pref_id=PREF-FIXTURE-1',
    'https://sandbox.mercadopago.com/checkout/v1/redirect?pref_id=PREF-FIXTURE-1', repeat('e', 64), 'request-fixture'
  );
  select id into v_intent from public.payment_intents where checkout_session_id = v_session;
  v_result := public.record_mercadopago_payment_snapshot(v_intent, jsonb_build_object(
    'provider_payment_id', '90000000001', 'external_reference', 'taba2:checkout:' || v_session::text,
    'preference_id', 'PREF-FIXTURE-1', 'merchant_order_id', 'MO-FIXTURE',
    'collector_id', 'collector-fixture', 'application_id', 'application-fixture',
    'currency', 'ARS', 'transaction_amount', '2500.00', 'status', 'approved',
    'status_detail', 'accredited', 'payment_method', 'visa', 'live_mode', false,
    'provider_occurred_at', clock_timestamp()::text, 'refunded_amount', '0.00',
    'payer_email_hash', repeat('f', 64), 'raw_response_hash', repeat('1', 64)
  ), 'reconciliation', null);
  if v_result ->> 'finalize_required' <> 'true' then raise exception 'approved verified payment was not finalizable'; end if;
  v_result := public.finalize_paid_checkout_session(v_session);
  v_order := (v_result ->> 'order_id')::uuid;
  if v_order is null or v_result ->> 'ok' <> 'true' then raise exception 'paid order finalization failed'; end if;
  if (public.finalize_paid_checkout_session(v_session) ->> 'idempotent') <> 'true' then raise exception 'finalization is not idempotent'; end if;
  select count(*) into v_count from public.orders where business_id = v_business;
  if v_count <> 1 then raise exception 'duplicate finalization created % orders', v_count; end if;
  select stock into v_stock from public.products where id = v_product;
  if v_stock <> 8 then raise exception 'finalization decremented reserved stock twice'; end if;
  if (select count(*) from public.inventory_reservations where checkout_session_id = v_session and status = 'converted') <> 1 then raise exception 'reservation was not converted exactly once'; end if;

  v_result := public.create_checkout_session(v_user, jsonb_build_object(
    'business_id', v_business, 'client_request_id', 'mpfixturecheckout0002',
    'items', jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 1)),
    'fulfillment_type', 'pickup', 'contact', jsonb_build_object('name', 'Cliente Fixture', 'phone', '5491100000000'),
    'address', '{}'::jsonb, 'age_confirmed', false, 'payment_method', 'mercadopago'
  ));
  v_second_session := (v_result ->> 'checkout_session_id')::uuid;
  select stock into v_stock from public.products where id = v_product;
  if v_stock <> 7 then raise exception 'second reservation was not applied'; end if;
  perform public.release_checkout_session_inventory(v_second_session, 'local_test_cancelled', 'cancelled');
  perform public.release_checkout_session_inventory(v_second_session, 'local_test_duplicate', 'cancelled');
  select stock into v_stock from public.products where id = v_product;
  if v_stock <> 8 then raise exception 'reservation release was not exactly once'; end if;

  v_result := public.record_mercadopago_webhook_receipt('test', 'evt-fixture-valid', 'payment', '90000000001', true, 'request-fixture', repeat('2', 64));
  if v_result ->> 'queued' <> 'true' then raise exception 'valid signed receipt was not queued'; end if;
  if (public.record_mercadopago_webhook_receipt('test', 'evt-fixture-valid', 'payment', '90000000001', true, 'request-fixture', repeat('2', 64)) ->> 'duplicate') <> 'true' then raise exception 'duplicate webhook was not deduplicated'; end if;
  if (public.record_mercadopago_webhook_receipt('test', 'evt-fixture-invalid', 'payment', '90000000001', false, 'request-invalid', repeat('3', 64)) ->> 'queued') <> 'false' then raise exception 'invalid webhook entered worker queue'; end if;
end;
$$;

rollback;
