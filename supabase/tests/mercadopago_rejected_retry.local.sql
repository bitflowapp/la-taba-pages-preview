-- Checkout Pro: a rejected card followed by an approved retry inside the SAME preference must become one order,
-- with stock reserved once. A rejection after expiry and a cancellation still release the stock immediately.
-- Isolated fixtures; everything rolls back.
begin;

do $$
declare
  v_user uuid := '10000000-0000-4000-8000-0000000000e1';
  v_business uuid := '20000000-0000-4000-8000-0000000000e1';
  v_product uuid := '30000000-0000-4000-8000-0000000000e1';
  v_asset uuid := '40000000-0000-4000-8000-0000000000e1';
  v_session uuid;
  v_intent uuid;
  v_result jsonb;
  v_prepare jsonb;
  v_order uuid;
  v_stock integer;
  v_master_hash text := repeat('b', 64);
  v_thumbnail_hash text := repeat('c', 64);
  v_source_hash text := repeat('d', 64);
  v_identity text;
  v_master_path text;
  v_thumbnail_path text;
  v_counter integer := 0;
begin
  insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v_user, 'authenticated', 'authenticated', 'mp-retry-test@example.invalid', '', '{}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp());
  insert into public.businesses (id, name, slug, status, is_active, ordering_enabled, ordering_verified,
    ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled)
  values (v_business, 'MP retry fixture', 'mp-retry-fixture', 'open', true, true, true, clock_timestamp(), v_user, 'ARS', true);
  v_identity := public.catalog_image_identity_sha256('mp-retry-external', 'mp-retry-sku', v_source_hash);
  v_master_path := public.catalog_asset_path('mp-retry-sku', v_identity, 'master', v_master_hash);
  v_thumbnail_path := public.catalog_asset_path('mp-retry-sku', v_identity, 'thumbnail', v_thumbnail_hash);
  insert into public.catalog_assets (id, business_id, external_id, sku, safe_sku, identity_sha256, master_path,
    master_sha256, master_binding_sha256, thumbnail_path, thumbnail_sha256, thumbnail_binding_sha256, source_sha256,
    source_url, rights_status, rights_reference, approved_at, approved_by, catalog_origin)
  values (v_asset, v_business, 'mp-retry-external', 'mp-retry-sku', 'mp-retry-sku', v_identity, v_master_path, v_master_hash,
    public.catalog_asset_binding_sha256(v_identity, 'master', v_source_hash, v_master_hash, 1000, 1000, v_master_path),
    v_thumbnail_path, v_thumbnail_hash,
    public.catalog_asset_binding_sha256(v_identity, 'thumbnail', v_source_hash, v_thumbnail_hash, 400, 400, v_thumbnail_path),
    v_source_hash, 'https://example.invalid/mp-retry.webp', 'UNAPPROVED_QA', 'isolated local fixture', null, null, 'test_only');
  insert into public.products (id, business_id, name, description, category, price, image_url, is_active,
    brand, subcategory, presentation, capacity, packaging_type, stock, available, is_alcoholic, is_verified, chilled,
    units_per_pack, external_id, sku, catalog_asset_id, image_sha256, image_thumbnail_url, image_thumbnail_sha256,
    source_image_sha256, variant, capacity_value, capacity_unit, catalog_origin, price_status)
  values (v_product, v_business, 'Bebida de reintento', 'Fixture local aislado', 'Gaseosas', 1250.00, v_master_path, true,
    'TABA2 QA', 'Cola', 'Botella 1 l', '1 l', 'botella', 10, true, false, true, false, 1, 'mp-retry-external', 'mp-retry-sku',
    v_asset, v_master_hash, v_thumbnail_path, v_thumbnail_hash, v_source_hash, 'Botella 1 l', 1, 'l', 'test_only', 'confirmed');
  insert into public.business_payment_settings (business_id, enabled, environment, checkout_mode, currency, reserve_stock,
    collector_id, application_id, configured_at, verified_at)
  values (v_business, true, 'test', 'checkout_pro', 'ARS', true, 'collector-retry', 'application-retry', clock_timestamp(), clock_timestamp());

  -- Three purchases of 2 units: rejected-then-approved, rejected-after-expiry and cancelled.
  foreach v_counter in array array[1, 2, 3] loop
    v_result := public.create_checkout_session(v_user, jsonb_build_object(
      'business_id', v_business, 'client_request_id', 'mpretrycheckout000' || v_counter,
      'items', jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 2)),
      'fulfillment_type', 'pickup', 'contact', jsonb_build_object('name', 'Cliente Reintento', 'phone', '5491100000000'),
      'address', '{}'::jsonb, 'age_confirmed', false, 'payment_method', 'mercadopago'));
    v_session := (v_result ->> 'checkout_session_id')::uuid;
    if v_session is null then raise exception 'scenario %: session not prepared', v_counter; end if;
    v_prepare := public.prepare_mercadopago_preference(v_session, v_user, false);
    perform public.record_mercadopago_preference_created((v_prepare ->> 'payment_attempt_id')::uuid, 'PREF-RETRY-' || v_counter,
      'https://www.mercadopago.com/checkout/v1/redirect?pref_id=PREF-RETRY-' || v_counter,
      'https://sandbox.mercadopago.com/checkout/v1/redirect?pref_id=PREF-RETRY-' || v_counter, repeat('e', 64), 'request-retry');
    select id into v_intent from public.payment_intents where checkout_session_id = v_session;
    if v_counter = 2 then
      update public.checkout_sessions set created_at = clock_timestamp() - interval '2 hours',
        expires_at = clock_timestamp() - interval '1 second' where id = v_session;
    end if;

    v_result := public.record_mercadopago_payment_snapshot(v_intent, jsonb_build_object(
      'provider_payment_id', '9100000000' || v_counter, 'external_reference', 'taba2:checkout:' || v_session::text,
      'preference_id', 'PREF-RETRY-' || v_counter, 'merchant_order_id', 'MO-RETRY-' || v_counter,
      'collector_id', 'collector-retry', 'currency', 'ARS', 'transaction_amount', '2500.00',
      'status', case v_counter when 3 then 'cancelled' else 'rejected' end,
      'status_detail', case v_counter when 3 then 'by_collector' else 'cc_rejected_other_reason' end,
      'payment_method', 'visa', 'live_mode', true, 'provider_occurred_at', clock_timestamp()::text,
      'refunded_amount', '0.00', 'payer_email_hash', repeat('f', 64), 'raw_response_hash', repeat('1', 64)), 'reconciliation', null);
    select stock into v_stock from public.products where id = v_product;

    if v_counter = 1 then
      if v_stock <> 8 then raise exception 'rejection inside the session released the reservation (stock %)', v_stock; end if;
      if (select status from public.checkout_sessions where id = v_session) <> 'payment_pending' then
        raise exception 'rejected session should wait for a retry, got %', (select status from public.checkout_sessions where id = v_session);
      end if;
      if (select internal_status from public.payment_intents where id = v_intent) <> 'rejected' then raise exception 'rejection not recorded'; end if;
      -- The retry with another card, same preference, new provider payment id.
      v_result := public.record_mercadopago_payment_snapshot(v_intent, jsonb_build_object(
        'provider_payment_id', '9200000000' || v_counter, 'external_reference', 'taba2:checkout:' || v_session::text,
        'preference_id', 'PREF-RETRY-' || v_counter, 'merchant_order_id', 'MO-RETRY-' || v_counter,
        'collector_id', 'collector-retry', 'currency', 'ARS', 'transaction_amount', '2500.00', 'status', 'approved',
        'status_detail', 'accredited', 'payment_method', 'master', 'live_mode', true,
        'provider_occurred_at', (clock_timestamp() + interval '1 second')::text,
        'refunded_amount', '0.00', 'payer_email_hash', repeat('f', 64), 'raw_response_hash', repeat('2', 64)), 'reconciliation', null);
      if coalesce(v_result ->> 'manual_review_required', 'false') = 'true' or v_result ->> 'finalize_required' <> 'true' then
        raise exception 'approved retry went to manual review: %', v_result;
      end if;
      v_result := public.finalize_paid_checkout_session(v_session);
      v_order := (v_result ->> 'order_id')::uuid;
      if v_order is null or v_result ->> 'ok' <> 'true' then raise exception 'approved retry did not become an order: %', v_result; end if;
      if (select count(*) from public.orders where business_id = v_business) <> 1 then raise exception 'retry created more than one order'; end if;
      select stock into v_stock from public.products where id = v_product;
      if v_stock <> 8 then raise exception 'retry changed stock twice (stock %)', v_stock; end if;
      if (select count(*) from public.inventory_reservations where checkout_session_id = v_session and status = 'converted') <> 1 then
        raise exception 'reservation was not converted exactly once';
      end if;
    elsif v_counter = 2 then
      -- Expired session: nothing to retry, stock comes back now (8 reserved by #1 converted, this one released).
      if v_stock <> 8 then raise exception 'rejection after expiry kept the reservation (stock %)', v_stock; end if;
      if (select status from public.checkout_sessions where id = v_session) <> 'cancelled' then raise exception 'expired rejection not cancelled'; end if;
    else
      if v_stock <> 8 then raise exception 'cancellation kept the reservation (stock %)', v_stock; end if;
      if (select status from public.checkout_sessions where id = v_session) <> 'cancelled' then raise exception 'cancellation not cancelled'; end if;
    end if;
  end loop;
end;
$$;

rollback;
