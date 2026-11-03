-- Mobbex ledger: contract of 20261103010000_mobbex_checkout_foundation.sql against the REAL schema.
-- Runs inside the transaction the runner opens (scripts/mobbex/run-mobbex-db-tests.mjs) and is rolled back.
-- The runner also fingerprints every pre-existing function before and after the migration and compares them.
-- No real provider is involved: snapshots are what the Edge Function would hand over AFTER a confirmed read.

create or replace function pg_temp.check(p_ok boolean, p_name text) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'FAILED: %', p_name; end if;
  raise notice 'ok - %', p_name;
end $$;

create or replace function pg_temp.raises(p_sql text, p_needle text, p_name text) returns void language plpgsql as $$
declare v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if position(lower(p_needle) in lower(v_msg)) = 0 then raise exception 'FAILED: % (wrong error: %)', p_name, v_msg; end if;
    raise notice 'ok - % (%)', p_name, left(v_msg, 70);
    return;
  end;
  raise exception 'FAILED: % (did not raise)', p_name;
end $$;

-- The project's identity gate (identity_member_role) only authorizes a back-office role for a REGISTERED session whose
-- session_id is in the token, so the fixture registers one per owner (make_tenant) and as_user sends it.
create or replace function pg_temp.as_user(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_user::text, true), set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated',
           'session_id', md5('mbx-session-' || p_user::text)::uuid)::text, true) $$;
create or replace function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claim.sub', '', true), set_config('role', 'service_role', true) $$;
create or replace function pg_temp.as_admin() returns void language sql as $$
  select set_config('request.jwt.claim.sub', '', true), set_config('role', 'postgres', true) $$;

-- ── fixtures ─────────────────────────────────────────────────────────────────────────────────────────────
create or replace function pg_temp.make_tenant(p_tag text, p_stock integer) returns jsonb language plpgsql as $$
declare
  v_user uuid := gen_random_uuid(); v_owner uuid := gen_random_uuid(); v_business uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid(); v_asset uuid := gen_random_uuid();
  v_master_hash text := repeat('b', 64); v_thumbnail_hash text := repeat('c', 64); v_source_hash text := repeat('d', 64);
  v_identity text; v_master_path text; v_thumbnail_path text;
begin
  insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v_user, 'authenticated', 'authenticated', p_tag || '-buyer@example.invalid', '', '{}', '{}', clock_timestamp(), clock_timestamp()),
         (v_owner, 'authenticated', 'authenticated', p_tag || '-owner@example.invalid', '', '{}', '{}', clock_timestamp(), clock_timestamp());
  insert into public.businesses (id, name, slug, status, is_active, ordering_enabled, ordering_verified,
    ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled)
  values (v_business, 'Mobbex ' || p_tag, 'mbx-' || p_tag, 'open', true, true, true, clock_timestamp(), v_owner, 'ARS', true);
  insert into public.business_members (business_id, user_id, role) values (v_business, v_owner, 'owner');
  insert into public.identity_sessions (session_id, user_id, business_id, role_at_login, client)
  values (md5('mbx-session-' || v_owner::text)::uuid, v_owner, v_business, 'owner', 'panel_web');
  v_identity := public.catalog_image_identity_sha256(p_tag || '-ext', p_tag || '-sku', v_source_hash);
  v_master_path := public.catalog_asset_path(p_tag || '-sku', v_identity, 'master', v_master_hash);
  v_thumbnail_path := public.catalog_asset_path(p_tag || '-sku', v_identity, 'thumbnail', v_thumbnail_hash);
  insert into public.catalog_assets (id, business_id, external_id, sku, safe_sku, identity_sha256, master_path, master_sha256,
    master_binding_sha256, thumbnail_path, thumbnail_sha256, thumbnail_binding_sha256, source_sha256, source_url, rights_status,
    rights_reference, approved_at, approved_by, catalog_origin)
  values (v_asset, v_business, p_tag || '-ext', p_tag || '-sku', p_tag || '-sku', v_identity, v_master_path, v_master_hash,
    public.catalog_asset_binding_sha256(v_identity, 'master', v_source_hash, v_master_hash, 1000, 1000, v_master_path),
    v_thumbnail_path, v_thumbnail_hash,
    public.catalog_asset_binding_sha256(v_identity, 'thumbnail', v_source_hash, v_thumbnail_hash, 400, 400, v_thumbnail_path),
    v_source_hash, 'https://example.invalid/mbx.webp', 'UNAPPROVED_QA', 'isolated local fixture', null, null, 'test_only');
  insert into public.products (id, business_id, name, description, category, price, image_url, is_active, brand, subcategory,
    presentation, capacity, packaging_type, stock, available, is_alcoholic, is_verified, chilled, units_per_pack, external_id, sku,
    catalog_asset_id, image_sha256, image_thumbnail_url, image_thumbnail_sha256, source_image_sha256, variant, capacity_value,
    capacity_unit, catalog_origin, price_status)
  values (v_product, v_business, 'Bebida ' || p_tag, 'Fixture local aislado', 'Gaseosas', 1250.00, v_master_path, true, 'TABA2 QA',
    'Cola', 'Botella 1 l', '1 l', 'botella', p_stock, true, false, true, false, 1, p_tag || '-ext', p_tag || '-sku', v_asset,
    v_master_hash, v_thumbnail_path, v_thumbnail_hash, v_source_hash, 'Botella 1 l', 1, 'l', 'test_only', 'confirmed');
  return jsonb_build_object('buyer', v_user, 'owner', v_owner, 'business', v_business, 'product', v_product);
end $$;

create or replace function pg_temp.new_checkout(p_t jsonb, p_qty integer, p_request text) returns jsonb language plpgsql as $$
declare v_payload jsonb; v_res jsonb;
begin
  v_payload := jsonb_build_object('business_id', p_t ->> 'business', 'client_request_id', p_request,
    'items', jsonb_build_array(jsonb_build_object('product_id', p_t ->> 'product', 'quantity', p_qty)),
    'fulfillment_type', 'pickup', 'contact', jsonb_build_object('name', 'Cliente Mobbex', 'phone', '5491100000000'),
    'address', '{}'::jsonb, 'age_confirmed', false, 'payment_method', 'mobbex');
  v_res := public.create_mobbex_checkout_session((p_t ->> 'buyer')::uuid, v_payload);
  return v_res || jsonb_build_object('reference', 'taba2-mbx-' || (v_res ->> 'checkout_session_id'));
end $$;

create or replace function pg_temp.snap(p_ref text, p_class text, p_code text, p_pid text, p_amount text, p_seconds integer, p_hash char)
returns jsonb language sql as $$
  select jsonb_build_object('reference', p_ref, 'status_class', p_class, 'status_code', p_code, 'provider_payment_id', p_pid,
    'amount', p_amount, 'currency', 'ARS', 'provider_occurred_at', (clock_timestamp() + make_interval(secs => p_seconds))::text,
    'raw_response_hash', repeat(p_hash::text, 64), 'approved_operation_count', case when p_class = 'approved' then 1 else 0 end) $$;

create or replace function pg_temp.intent_of(p_session uuid) returns uuid language sql as $$
  select id from public.mobbex_payment_intents where checkout_session_id = p_session $$;

select pg_temp.as_admin();

do $$
declare
  t jsonb; t2 jsonb; c jsonb; s uuid; i uuid; r jsonb; ref text; v_stock integer; v_orders integer;
begin
  -- ═══ 0. Nothing that already existed has changed (function/constraint fingerprint: checked by the runner) ═══
  perform pg_temp.check(not exists (select 1 from pg_trigger where tgname like 'mobbex%' and tgrelid::regclass::text in
    ('public.payment_intents', 'public.payment_outbox', 'public.payment_webhook_receipts')), 'no Mobbex trigger on a Mercado Pago table');

  -- ═══ 1. Disabled by default, enabled by an explicit act ═════════════════════════════════════════════════
  t := pg_temp.make_tenant('a', 10);
  t2 := pg_temp.make_tenant('b', 10);
  perform pg_temp.as_user((t ->> 'buyer')::uuid);
  perform pg_temp.check((public.get_mobbex_checkout_availability((t ->> 'business')::uuid) ->> 'available')::boolean = false, 'Mobbex is not offered by default');
  perform pg_temp.as_admin();
  perform pg_temp.raises(format($q$select public.create_mobbex_checkout_session(%L, %L::jsonb)$q$, t ->> 'buyer',
    jsonb_build_object('business_id', t ->> 'business', 'client_request_id', 'mbxdisabled0001', 'payment_method', 'mobbex',
      'items', jsonb_build_array(jsonb_build_object('product_id', t ->> 'product', 'quantity', 1)), 'fulfillment_type', 'pickup',
      'contact', jsonb_build_object('name', 'X Y', 'phone', '5491100000000'), 'address', '{}'::jsonb, 'age_confirmed', false)),
    'Mobbex no esta configurado', 'a checkout cannot be created while Mobbex is disabled for the business');
  select stock into v_stock from public.products where id = (t ->> 'product')::uuid;
  perform pg_temp.check(v_stock = 10, 'the refused checkout took no stock');
  perform public.configure_mobbex_business((t ->> 'business')::uuid, true, 'test', 'not_requested', 'ENT-WALTER-TEST', 'qa-runner');
  perform public.configure_mobbex_business((t2 ->> 'business')::uuid, true, 'test', 'not_requested', null, 'qa-runner');
  perform pg_temp.raises($q$select public.configure_mobbex_business(gen_random_uuid(), true, 'production', 'not_requested', null, 'qa-runner')$q$,
    'comercio inexistente', 'unknown business cannot be configured');
  perform pg_temp.raises(format($q$select public.configure_mobbex_business(%L, true, 'production', 'not_requested', null, 'qa-runner')$q$, t ->> 'business'),
    'mobbex_settings_enabled_check', 'production cannot be enabled without an approved review');
  perform pg_temp.as_user((t ->> 'buyer')::uuid);
  perform pg_temp.check((public.get_mobbex_checkout_availability((t ->> 'business')::uuid) ->> 'available')::boolean, 'Mobbex is offered once enabled');
  perform pg_temp.as_admin();

  -- ═══ 2. The amount is the server's, the browser sends none ══════════════════════════════════════════════
  perform pg_temp.raises(format($q$select public.create_mobbex_checkout_session(%L, %L::jsonb)$q$, t ->> 'buyer',
    jsonb_build_object('business_id', t ->> 'business', 'client_request_id', 'mbxforgedtotal01', 'payment_method', 'mobbex', 'total', 1,
      'items', jsonb_build_array(jsonb_build_object('product_id', t ->> 'product', 'quantity', 1)), 'fulfillment_type', 'pickup',
      'contact', jsonb_build_object('name', 'X Y', 'phone', '5491100000000'), 'address', '{}'::jsonb, 'age_confirmed', false)),
    'campo no permitido', 'a client-supplied total is rejected outright');
  perform pg_temp.raises(format($q$select public.create_mobbex_checkout_session(%L, %L::jsonb)$q$, t ->> 'buyer',
    jsonb_build_object('business_id', t ->> 'business', 'client_request_id', 'mbxwrongmethod01', 'payment_method', 'mercadopago',
      'items', jsonb_build_array(jsonb_build_object('product_id', t ->> 'product', 'quantity', 1)), 'fulfillment_type', 'pickup',
      'contact', jsonb_build_object('name', 'X Y', 'phone', '5491100000000'), 'address', '{}'::jsonb, 'age_confirmed', false)),
    'medio de pago invalido', 'the Mobbex path refuses another provider''s payment method');
  c := pg_temp.new_checkout(t, 2, 'mbxcheckout00001');
  s := (c ->> 'checkout_session_id')::uuid; i := pg_temp.intent_of(s); ref := c ->> 'reference';
  perform pg_temp.check((c ->> 'total')::numeric = 2500.00 and (select expected_amount from public.mobbex_payment_intents where id = i) = 2500.00,
    'total = price x quantity, computed from the catalog by the database');
  select stock into v_stock from public.products where id = (t ->> 'product')::uuid;
  perform pg_temp.check(v_stock = 8, 'stock is reserved at checkout creation');
  perform pg_temp.check(not exists (select 1 from public.payment_intents where checkout_session_id = s), 'no Mercado Pago intent exists for a Mobbex checkout');
  perform pg_temp.check(c ->> 'payment_provider' = 'mobbex', 'the payload says which provider owns the checkout');

  -- ═══ 3. Hosted checkout preparation: one dispatcher, lost responses are safe ════════════════════════════
  r := public.mobbex_prepare_checkout(s, (t ->> 'buyer')::uuid);
  perform pg_temp.check((r ->> 'claimed')::boolean and (r ->> 'expected_amount')::numeric = 2500.00, 'the first request claims the dispatch with the server amount');
  perform pg_temp.check((public.mobbex_prepare_checkout(s, (t ->> 'buyer')::uuid) ->> 'in_flight')::boolean, 'a concurrent request does not dispatch a second POST');
  perform pg_temp.raises(format($q$select public.mobbex_prepare_checkout(%L, %L)$q$, s, t2 ->> 'buyer'), 'no pertenece', 'another customer cannot prepare my checkout');
  perform pg_temp.raises(format($q$select public.mobbex_record_checkout_created(%L, 'CHK:1', 'https://evil.example/p/checkout/1', %L)$q$, i, repeat('a', 64)),
    'respuesta de checkout invalida', 'a checkout URL outside Mobbex is refused');
  perform public.mobbex_record_checkout_uncertain(i, 'network');
  perform pg_temp.check((select checkout_status from public.mobbex_payment_intents where id = i) = 'ambiguous', 'a lost response is recorded as uncertain, never as failed');
  update public.mobbex_payment_intents set checkout_requested_at = clock_timestamp() - interval '2 minutes' where id = i;
  perform pg_temp.check((public.mobbex_prepare_checkout(s, (t ->> 'buyer')::uuid) ->> 'claimed')::boolean, 'after an uncertain POST a new one may be claimed (same reference)');
  perform public.mobbex_record_checkout_created(i, 'CHK:ABC123', 'https://mobbex.com/p/checkout/v2/CHK:ABC123', repeat('a', 64));
  perform pg_temp.check((public.mobbex_prepare_checkout(s, (t ->> 'buyer')::uuid) ->> 'reuse')::boolean, 'reopening the payment reuses the same hosted checkout');
  perform pg_temp.check(exists (select 1 from public.mobbex_jobs where payment_intent_id = i and status = 'pending'), 'a lost-webhook safety net job is scheduled');
  perform pg_temp.check((select status from public.checkout_sessions where id = s) = 'redirected', 'the session is marked redirected');

  -- ═══ 4. Approval: exact money, one order, idempotent, duplicate payment recorded ═══════════════════════
  r := public.mobbex_record_provider_snapshot(i, pg_temp.snap(ref, 'approved', '200', 'OP-100', '2500.00', 0, '1'), 'webhook');
  perform pg_temp.check((r ->> 'finalized')::boolean and r ->> 'order_id' is not null, 'an approved, matching payment becomes an order in the same transaction');
  select count(*) into v_orders from public.orders where business_id = (t ->> 'business')::uuid;
  perform pg_temp.check(v_orders = 1 and (select payment_method from public.orders where business_id = (t ->> 'business')::uuid) = 'mobbex', 'exactly one order, declared as Mobbex');
  select stock into v_stock from public.products where id = (t ->> 'product')::uuid;
  perform pg_temp.check(v_stock = 8, 'stock was reserved once and converted, not taken twice');
  perform pg_temp.check((select internal_status from public.mobbex_payment_intents where id = i) = 'completed'
    and (select status from public.checkout_sessions where id = s) = 'completed', 'intent and session are completed');
  r := public.mobbex_record_provider_snapshot(i, pg_temp.snap(ref, 'approved', '200', 'OP-100', '2500.00', 1, '2'), 'reconciliation');
  perform pg_temp.check((r ->> 'idempotent')::boolean and (select count(*) from public.orders where business_id = (t ->> 'business')::uuid) = 1, 'the same approval read again creates nothing');
  r := public.mobbex_record_provider_snapshot(i, pg_temp.snap(ref, 'approved', '200', 'OP-200', '2500.00', 2, '3'), 'reconciliation');
  perform pg_temp.check((r ->> 'duplicate_payment')::boolean and (select count(*) from public.orders where business_id = (t ->> 'business')::uuid) = 1
    and (select attention_reason from public.mobbex_payment_intents where id = i) = 'duplicate_approved_payment',
    'a second approved payment is recorded for a refund and never creates a second order');
  perform pg_temp.check((select count(*) from public.mobbex_payment_intents where provider_payment_id = 'OP-100') = 1, 'one provider payment, one checkout');

  -- ═══ 5. Forged / inconsistent confirmations never approve ═══════════════════════════════════════════════
  c := pg_temp.new_checkout(t, 1, 'mbxcheckout00002');
  s := (c ->> 'checkout_session_id')::uuid; i := pg_temp.intent_of(s); ref := c ->> 'reference';
  r := public.mobbex_record_provider_snapshot(i, pg_temp.snap(ref, 'approved', '200', 'OP-AMT', '1.00', 0, '4'), 'webhook');
  perform pg_temp.check((r ->> 'manual_review_required')::boolean and r ->> 'reason' = 'amount_mismatch' and not exists (select 1 from public.orders where id::text = coalesce(r ->> 'order_id', '')),
    'an arbitrary amount is never approved (amount_mismatch -> review)');
  perform pg_temp.check((select internal_status from public.mobbex_payment_intents where id = i) = 'security_review_required', 'the intent waits for a person');
  c := pg_temp.new_checkout(t, 1, 'mbxcheckout00003');
  s := (c ->> 'checkout_session_id')::uuid; i := pg_temp.intent_of(s); ref := c ->> 'reference';
  r := public.mobbex_record_provider_snapshot(i, pg_temp.snap('taba2-mbx-' || gen_random_uuid(), 'approved', '200', 'OP-REF', '1250.00', 0, '5'), 'webhook');
  perform pg_temp.check(r ->> 'reason' = 'reference_mismatch', 'a payment for another reference is refused');
  c := pg_temp.new_checkout(t, 1, 'mbxcheckout00004');
  s := (c ->> 'checkout_session_id')::uuid; i := pg_temp.intent_of(s); ref := c ->> 'reference';
  r := public.mobbex_record_provider_snapshot(i, jsonb_set(pg_temp.snap(ref, 'approved', '200', 'OP-CUR', '1250.00', 0, '6'), '{currency}', '"USD"'), 'webhook');
  perform pg_temp.check(r ->> 'reason' = 'currency_mismatch', 'a payment in another currency is refused');
  c := pg_temp.new_checkout(t, 1, 'mbxcheckout00005');
  s := (c ->> 'checkout_session_id')::uuid; i := pg_temp.intent_of(s); ref := c ->> 'reference';
  r := public.mobbex_record_provider_snapshot(i, pg_temp.snap(ref, 'unknown', '201', 'OP-UNK', '1250.00', 0, '7'), 'reconciliation');
  perform pg_temp.check((select internal_status from public.mobbex_payment_intents where id = i) = 'ambiguous' and (select paid_amount from public.mobbex_payment_intents where id = i) is null,
    'an undocumented status never approves');
  r := public.mobbex_record_provider_snapshot(i, jsonb_set(pg_temp.snap(ref, 'approved', '200', 'OP-ENT', '1250.00', 1, '8'), '{entity_uid}', '"ENT-SOMEONE-ELSE"'), 'webhook');
  perform pg_temp.check(r ->> 'reason' = 'entity_mismatch', 'a payment received by another Mobbex entity is refused');
  c := pg_temp.new_checkout(t, 1, 'mbxcheckout00006');
  s := (c ->> 'checkout_session_id')::uuid; i := pg_temp.intent_of(s); ref := c ->> 'reference';
  r := public.mobbex_record_provider_snapshot(i, pg_temp.snap(ref, 'authorized', '3', 'OP-AUTH', '1250.00', 0, '9'), 'reconciliation');
  perform pg_temp.check((select internal_status from public.mobbex_payment_intents where id = i) = 'in_process' and not exists (select 1 from public.orders where customer_user_id = (t ->> 'buyer')::uuid and client_request_id = 'mbx_' || replace(s::text, '-', '')),
    'an authorization that was not captured is not money');

  -- ═══ 6. Out of order, rejected-then-approved, regressions after payment ════════════════════════════════
  c := pg_temp.new_checkout(t, 1, 'mbxcheckout00007');
  s := (c ->> 'checkout_session_id')::uuid; i := pg_temp.intent_of(s); ref := c ->> 'reference';
  r := public.mobbex_record_provider_snapshot(i, pg_temp.snap(ref, 'pending', '2', 'OP-PEND', '1250.00', 10, 'a'), 'webhook');
  perform pg_temp.check((select internal_status from public.mobbex_payment_intents where id = i) = 'pending', 'pending is recorded');
  r := public.mobbex_record_provider_snapshot(i, pg_temp.snap(ref, 'rejected', '400', 'OP-OLD', '1250.00', 5, 'b'), 'webhook');
  perform pg_temp.check((r ->> 'stale')::boolean and (select internal_status from public.mobbex_payment_intents where id = i) = 'pending', 'an older reading arriving late changes nothing');
  r := public.mobbex_record_provider_snapshot(i, pg_temp.snap(ref, 'rejected', '400', 'OP-REJ', '1250.00', 20, 'c'), 'webhook');
  perform pg_temp.check((select internal_status from public.mobbex_payment_intents where id = i) = 'rejected'
    and (select status from public.checkout_sessions where id = s) = 'payment_pending'
    and (select count(*) from public.inventory_reservations where checkout_session_id = s and status = 'active') = 1, 'a rejected card keeps the reservation while the checkout is live');
  r := public.mobbex_record_provider_snapshot(i, pg_temp.snap(ref, 'approved', '200', 'OP-RETRY', '1250.00', 30, 'd'), 'webhook');
  perform pg_temp.check((r ->> 'finalized')::boolean, 'a retry with another card inside the same checkout is approved');
  perform pg_temp.check((select count(*) from public.orders where business_id = (t ->> 'business')::uuid) = 2, 'rejected-then-approved is exactly one new order');
  r := public.mobbex_record_provider_snapshot(i, pg_temp.snap(ref, 'rejected', '400', 'OP-LATE', '1250.00', 40, 'e'), 'webhook');
  perform pg_temp.check((r ->> 'stale')::boolean and (select internal_status from public.mobbex_payment_intents where id = i) = 'completed'
    and (select attention_reason from public.mobbex_payment_intents where id = i) like 'paid_operation_regressed:%',
    'a rejection after the payment is flagged for a person, the paid order is untouched');
  r := public.mobbex_record_provider_snapshot(i, pg_temp.snap(ref, 'pending', '299', 'OP-SETTLE', '1250.00', 50, 'f'), 'webhook');
  perform pg_temp.check((r ->> 'stale')::boolean and (select internal_status from public.mobbex_payment_intents where id = i) = 'completed', 'settlement states after payment are ignored');

  -- ═══ 7. Late payment (after the reservation ran out) and stock exhaustion ═══════════════════════════════
  -- Sections 1-6 consume the tenant's starting stock; restock so this section tests expiry, not a drained fixture.
  update public.products set stock = 10, available = true where id = (t ->> 'product')::uuid;
  c := pg_temp.new_checkout(t, 3, 'mbxcheckout00008');
  s := (c ->> 'checkout_session_id')::uuid; i := pg_temp.intent_of(s); ref := c ->> 'reference';
  select stock into v_stock from public.products where id = (t ->> 'product')::uuid;
  update public.checkout_sessions set created_at = clock_timestamp() - interval '2 hours', expires_at = clock_timestamp() - interval '1 second' where id = s;
  perform public.expire_checkout_sessions(50);
  perform pg_temp.check((select status from public.checkout_sessions where id = s) = 'expired' and (select stock from public.products where id = (t ->> 'product')::uuid) = v_stock + 3,
    'the shared expiry sweep releases a Mobbex checkout''s stock');
  r := public.mobbex_record_provider_snapshot(i, pg_temp.snap(ref, 'approved', '200', 'OP-LATE1', '3750.00', 0, '1'), 'reconciliation');
  perform pg_temp.check((r ->> 'finalized')::boolean and (select stock from public.products where id = (t ->> 'product')::uuid) = v_stock,
    'a payment that lands after expiry takes the stock again and becomes an order');
  c := pg_temp.new_checkout(t, 2, 'mbxcheckout00009');
  s := (c ->> 'checkout_session_id')::uuid; i := pg_temp.intent_of(s); ref := c ->> 'reference';
  update public.checkout_sessions set created_at = clock_timestamp() - interval '2 hours', expires_at = clock_timestamp() - interval '1 second' where id = s;
  perform public.expire_checkout_sessions(50);
  update public.products set stock = 1, available = true where id = (t ->> 'product')::uuid;
  r := public.mobbex_record_provider_snapshot(i, pg_temp.snap(ref, 'approved', '200', 'OP-NOSTOCK', '2500.00', 0, '2'), 'reconciliation');
  perform pg_temp.check((r ->> 'manual_review_required')::boolean and r ->> 'reason' = 'stock_insuficiente'
    and (select stock from public.products where id = (t ->> 'product')::uuid) = 1
    and (select internal_status from public.mobbex_payment_intents where id = i) = 'security_review_required',
    'paid without stock: no order, no negative stock, a written reason and a refund instruction');
  perform pg_temp.as_user((t ->> 'buyer')::uuid);
  perform pg_temp.raises(format($q$select public.mobbex_prepare_refund(%L, null, gen_random_uuid(), 'sin stock')$q$, i), 'no autorizado', 'a customer cannot refund');
  perform pg_temp.as_user((t ->> 'owner')::uuid);
  r := public.mobbex_prepare_refund(i, null, '00000000-0000-4000-8000-0000000000aa', 'sin stock');
  perform pg_temp.check((r ->> 'full')::boolean and (r ->> 'idempotent')::boolean is false, 'the owner can refund money taken without an order');
  perform pg_temp.as_admin();
  perform public.mobbex_record_refund_result((r ->> 'refund_id')::uuid, 'approved', repeat('9', 64));
  perform pg_temp.check((select internal_status from public.mobbex_payment_intents where id = i) = 'refunded', 'the refund closes the intent');

  -- ═══ 8. Refunds on a completed order, idempotency and the cancellation guard ═══════════════════════════
  c := pg_temp.new_checkout(t, 1, 'mbxcheckout00010');
  update public.products set stock = 20, available = true where id = (t ->> 'product')::uuid;
  c := pg_temp.new_checkout(t, 2, 'mbxcheckout00011');
  s := (c ->> 'checkout_session_id')::uuid; i := pg_temp.intent_of(s); ref := c ->> 'reference';
  r := public.mobbex_record_provider_snapshot(i, pg_temp.snap(ref, 'approved', '200', 'OP-REF-1', '2500.00', 0, '1'), 'webhook');
  perform pg_temp.check((r ->> 'finalized')::boolean, 'order for the refund scenarios');
  perform pg_temp.as_admin();
  perform pg_temp.raises(format($q$update public.orders set status = 'cancelled' where id = %L$q$, r ->> 'order_id'), 'gestionar reembolso', 'a Mobbex-paid order cannot be cancelled before the money is returned');
  perform pg_temp.as_user((t ->> 'owner')::uuid);
  perform pg_temp.raises(format($q$select public.mobbex_prepare_refund(%L, 99999, gen_random_uuid(), 'x')$q$, i), 'importe de reembolso invalido', 'a refund above what remains is refused');
  r := public.mobbex_prepare_refund(i, 500, '00000000-0000-4000-8000-0000000000bb', 'devolucion parcial');
  perform pg_temp.check((r ->> 'amount')::numeric = 500 and not (r ->> 'idempotent')::boolean, 'a partial refund is recorded before anything is sent');
  perform pg_temp.check((public.mobbex_prepare_refund(i, 500, '00000000-0000-4000-8000-0000000000bb', 'devolucion parcial') ->> 'reconciliation_required')::boolean,
    'the same request is never sent twice: it is reconciled');
  perform pg_temp.raises(format($q$select public.mobbex_prepare_refund(%L, 100, gen_random_uuid(), 'otra')$q$, i), 'ya hay un reembolso en curso', 'two refunds cannot be in flight');
  perform pg_temp.as_admin();
  perform public.mobbex_mark_refund_sent((r ->> 'refund_id')::uuid);
  perform public.mobbex_record_refund_result((r ->> 'refund_id')::uuid, 'approved', repeat('8', 64));
  perform pg_temp.check((select refunded_amount from public.mobbex_payment_intents where id = i) = 500 and (select internal_status from public.mobbex_payment_intents where id = i) = 'partially_refunded', 'partial refund tracked');
  r := public.mobbex_record_provider_snapshot(i, pg_temp.snap(ref, 'partially_refunded', '605', 'OP-REF-1', '2500.00', 5, '2'), 'reconciliation');
  perform pg_temp.check((select refunded_amount from public.mobbex_payment_intents where id = i) = 500 and (select internal_status from public.mobbex_payment_intents where id = i) = 'partially_refunded', 'the provider''s partial-refund status does not double count');
  r := public.mobbex_record_provider_snapshot(i, pg_temp.snap(ref, 'refunded', '602', 'OP-REF-1', '2500.00', 10, '3'), 'reconciliation');
  perform pg_temp.check((select internal_status from public.mobbex_payment_intents where id = i) = 'refunded' and (select refunded_amount from public.mobbex_payment_intents where id = i) = 2500, 'a full refund observed at the provider closes the payment');
  update public.orders set status = 'cancelled' where id = (select order_id from public.mobbex_payment_intents where id = i);
  perform pg_temp.check((select status from public.orders where id = (select order_id from public.mobbex_payment_intents where id = i)) = 'cancelled', 'once the money is back the order can be cancelled');
  c := pg_temp.new_checkout(t, 1, 'mbxcheckout00012');
  s := (c ->> 'checkout_session_id')::uuid; i := pg_temp.intent_of(s); ref := c ->> 'reference';
  r := public.mobbex_record_provider_snapshot(i, pg_temp.snap(ref, 'refunded', '602', 'OP-OOO', '1250.00', 0, '4'), 'reconciliation');
  perform pg_temp.check((select internal_status from public.mobbex_payment_intents where id = i) = 'refunded'
    and not exists (select 1 from public.orders where client_request_id = 'mbx_' || replace(s::text, '-', '')), 'a refund seen before the approval creates no order');
  r := public.mobbex_record_provider_snapshot(i, pg_temp.snap(ref, 'approved', '200', 'OP-OOO', '1250.00', -5, '5'), 'reconciliation');
  perform pg_temp.check(not exists (select 1 from public.orders where client_request_id = 'mbx_' || replace(s::text, '-', '')), 'the approval that arrives after the refund still creates no order');

  -- ═══ 9. Webhook receipts and the job queue ═════════════════════════════════════════════════════════════
  c := pg_temp.new_checkout(t, 1, 'mbxcheckout00013');
  s := (c ->> 'checkout_session_id')::uuid; i := pg_temp.intent_of(s); ref := c ->> 'reference';
  perform pg_temp.check((public.mobbex_record_webhook_receipt('test', 'taba2-mbx-' || gen_random_uuid(), repeat('a', 64), '200', 'X') ->> 'unknown_reference')::boolean
    and (select count(*) from public.mobbex_webhook_receipts) = 0, 'a notice for a reference that does not exist stores nothing');
  r := public.mobbex_record_webhook_receipt('test', ref, repeat('a', 64), '200', 'OP-X');
  perform pg_temp.check(not (r ->> 'duplicate')::boolean and (r ->> 'queued')::boolean, 'a notice is recorded and queued');
  r := public.mobbex_record_webhook_receipt('test', ref, repeat('a', 64), '200', 'OP-X');
  perform pg_temp.check((r ->> 'duplicate')::boolean and (select count(*) from public.mobbex_jobs where payment_intent_id = i and status in ('pending', 'claimed', 'retry_wait')) = 1,
    'a duplicate notice does not multiply work: one open job per payment');
  perform pg_temp.check((select count(*) from public.mobbex_claim_jobs('worker-a', 50, 60) where payment_intent_id = i) = 1, 'a worker claims the job');
  perform pg_temp.check((select count(*) from public.mobbex_claim_jobs('worker-b', 50, 60) where payment_intent_id = i) = 0, 'a second worker cannot claim a leased job');
  perform public.mobbex_record_webhook_receipt('test', ref, repeat('b', 64), '200', 'OP-X');
  perform pg_temp.check((select dirty from public.mobbex_jobs where payment_intent_id = i and status = 'claimed'), 'news arriving while a job runs mark it dirty');
  perform pg_temp.check(public.mobbex_finish_job((select id from public.mobbex_jobs where payment_intent_id = i and status = 'claimed'), 'worker-a', 'done') = 'pending',
    'a dirty job runs again instead of being considered done');
  perform pg_temp.check(public.mobbex_finish_job((select id from public.mobbex_jobs where payment_intent_id = i and status = 'pending'), 'worker-z', 'done') = 'lost_lease', 'only the lease owner can finish a job');
  update public.mobbex_jobs set next_attempt_at = clock_timestamp() where payment_intent_id = i and status = 'pending';
  perform public.mobbex_claim_jobs('worker-a', 50, 60);
  perform pg_temp.check(public.mobbex_finish_job((select id from public.mobbex_jobs where payment_intent_id = i and status = 'claimed'), 'worker-a', 'again', 60) = 'retry_wait', 'no news = look again later');
  for k in 1..12 loop
    update public.mobbex_jobs set next_attempt_at = clock_timestamp() - interval '1 second' where payment_intent_id = i and status in ('retry_wait', 'pending');
    perform public.mobbex_claim_jobs('worker-a', 50, 60);
    exit when public.mobbex_finish_job((select id from public.mobbex_jobs where payment_intent_id = i and status = 'claimed'), 'worker-a', 'failed', 0, 'provider down') = 'dead_letter';
  end loop;
  perform pg_temp.check((select status from public.mobbex_jobs where payment_intent_id = i order by created_at desc limit 1) = 'dead_letter' and (public.mobbex_pipeline_health() ->> 'needs_attention')::boolean,
    'a job that keeps failing ends in dead-letter and raises the alert');
  perform pg_temp.check(public.mobbex_requeue_dead_letter(10) >= 1, 'a human can requeue dead-lettered jobs once the cause is fixed');

  -- ═══ 10. No evidence of payment never counts as payment ═════════════════════════════════════════════════
  c := pg_temp.new_checkout(t, 1, 'mbxcheckout00014');
  s := (c ->> 'checkout_session_id')::uuid; i := pg_temp.intent_of(s);
  perform public.mobbex_record_checkout_created(i, 'CHK:NOOP', 'https://mobbex.com/p/checkout/v2/CHK:NOOP', repeat('a', 64));
  r := public.mobbex_record_no_operation(i, 'GENERIC:EFCS');
  perform pg_temp.check(not (r ->> 'closed')::boolean and (select internal_status from public.mobbex_payment_intents where id = i) = 'checkout_created', 'no operation inside the window changes nothing');
  update public.checkout_sessions set created_at = clock_timestamp() - interval '9 hours', expires_at = clock_timestamp() - interval '4 hours' where id = s;
  update public.mobbex_payment_intents set reconcile_misses = 5 where id = i;
  r := public.mobbex_record_no_operation(i, 'GENERIC:EFCS');
  perform pg_temp.check((r ->> 'closed')::boolean and (select internal_status from public.mobbex_payment_intents where id = i) = 'expired', 'long after the window and after several empty reads the intent is closed as expired');

  -- ═══ 11. Production gate: closed by default, one authorized purchase at a time ═════════════════════════
  t := pg_temp.make_tenant('p', 10);
  perform public.configure_mobbex_business((t ->> 'business')::uuid, true, 'production', 'approved', 'ENT-WALTER-LIVE', 'owner');
  perform pg_temp.as_user((t ->> 'buyer')::uuid);
  perform pg_temp.check((public.get_mobbex_checkout_availability((t ->> 'business')::uuid) ->> 'available')::boolean = false, 'production Mobbex is not offered without an authorization');
  perform pg_temp.as_admin();
  perform pg_temp.raises(format($q$select pg_temp.new_checkout(%L::jsonb, 1, 'mbxlive00000001')$q$, t), 'MOBBEX_LIVE_NOT_AUTHORIZED', 'production refuses a purchase nobody authorized');
  select stock into v_stock from public.products where id = (t ->> 'product')::uuid;
  perform pg_temp.check(v_stock = 10 and not exists (select 1 from public.checkout_sessions where business_id = (t ->> 'business')::uuid), 'the refused production checkout returned its stock and left no session');
  perform pg_temp.raises(format($q$select public.authorize_mobbex_live_payment(%L, %L, %L::jsonb, 1.00, 'compra piloto', 'ENT-WALTER-LIVE', 'api', 'devolver por la API y avisar al titular', 'Titular', %L, 30)$q$,
    t ->> 'business', t ->> 'buyer', jsonb_build_array(jsonb_build_object('product_id', t ->> 'product', 'quantity', 1)), repeat('a', 64)),
    'is not the live catalog total', 'an authorization with the wrong amount is refused');
  r := public.authorize_mobbex_live_payment((t ->> 'business')::uuid, (t ->> 'buyer')::uuid,
    jsonb_build_array(jsonb_build_object('product_id', t ->> 'product', 'quantity', 1)), 1250.00, 'compra piloto', 'ENT-WALTER-LIVE', 'api',
    'devolver por la API y avisar al titular', 'Titular', repeat('a', 64), 30);
  perform pg_temp.as_user((t ->> 'buyer')::uuid);
  perform pg_temp.check((public.get_mobbex_checkout_availability((t ->> 'business')::uuid) ->> 'available')::boolean, 'the authorized person (and only them) sees Mobbex');
  perform pg_temp.as_user((t2 ->> 'buyer')::uuid);
  perform pg_temp.check((public.get_mobbex_checkout_availability((t ->> 'business')::uuid) ->> 'available')::boolean = false, 'another person does not see it');
  perform pg_temp.as_admin();
  perform pg_temp.raises(format($q$select pg_temp.new_checkout(jsonb_set(%L::jsonb, '{buyer}', to_jsonb(%L::text)), 1, 'mbxlive00000002')$q$, t, t2 ->> 'buyer'), 'MOBBEX_LIVE_CUSTOMER_NOT_AUTHORIZED', 'a different customer cannot use the authorization');
  c := pg_temp.new_checkout(t, 1, 'mbxlive00000003');
  perform pg_temp.check((select status from public.mobbex_live_authorizations where id = (r ->> 'authorization_id')::uuid) = 'consumed', 'the authorization is consumed by the checkout it allows');
  perform pg_temp.raises(format($q$select pg_temp.new_checkout(%L::jsonb, 1, 'mbxlive00000004')$q$, t), 'MOBBEX_LIVE_NOT_AUTHORIZED', 'a second purchase needs a new signature');
  perform pg_temp.raises(format($q$update public.mobbex_live_authorizations set amount = 5 where id = %L$q$, r ->> 'authorization_id'), 'cannot change', 'the terms of an authorization are immutable');

  -- ═══ 12. Isolation between tenants and from the browser ════════════════════════════════════════════════
  t := pg_temp.make_tenant('i1', 10); t2 := pg_temp.make_tenant('i2', 10);
  perform public.configure_mobbex_business((t ->> 'business')::uuid, true, 'test', 'not_requested', null, 'qa-runner');
  c := pg_temp.new_checkout(t, 1, 'mbxisolation0001');
  s := (c ->> 'checkout_session_id')::uuid; i := pg_temp.intent_of(s);
  perform pg_temp.as_user((t2 ->> 'buyer')::uuid);
  perform pg_temp.check(public.get_mobbex_checkout_status(s) is null, 'another customer cannot read my checkout status');
  perform pg_temp.raises(format($q$select public.mobbex_request_reconcile(%L)$q$, s), 'checkout inexistente', 'another customer cannot trigger work on my checkout');
  perform pg_temp.raises(format($q$select public.mobbex_prepare_refund(%L, null, gen_random_uuid(), 'x')$q$, i), 'no autorizado', 'a customer of another business cannot refund');
  perform pg_temp.raises($q$select count(*) from public.mobbex_payment_intents$q$, 'permission denied', 'the browser role cannot read the ledger');
  perform pg_temp.raises(format($q$select public.mobbex_record_provider_snapshot(%L, '{}'::jsonb, 'browser')$q$, i), 'permission denied', 'the browser role cannot record provider facts');
  perform pg_temp.raises($q$select public.create_mobbex_checkout_session(gen_random_uuid(), '{}'::jsonb)$q$, 'permission denied', 'the browser role cannot create a session with an arbitrary customer id');
  perform pg_temp.as_service();
  perform pg_temp.raises($q$update public.mobbex_payment_intents set paid_amount = 1$q$, 'permission denied', 'even the service role writes only through the functions');
  perform pg_temp.as_admin();
  perform pg_temp.raises($q$update public.mobbex_payment_events set details = '{}'::jsonb$q$, 'append-only', 'the event ledger is append-only');
  perform pg_temp.raises($q$delete from public.mobbex_payment_events$q$, 'append-only', 'events cannot be deleted');

  -- ═══ 13. Cash, pickup and Mercado Pago are untouched ═══════════════════════════════════════════════════
  perform pg_temp.check(exists (select 1 from pg_constraint where conname = 'orders_payment_method_valid'
    and pg_get_constraintdef(oid) like '%mercadopago%' and pg_get_constraintdef(oid) like '%cash%' and pg_get_constraintdef(oid) like '%coordinate%'), 'every previous payment method is still valid');
  perform pg_temp.check((select count(*) from public.mobbex_payment_intents where internal_status = 'completed' and order_id is null) = 0, 'no completed Mobbex payment without an order');
  perform pg_temp.check((select count(*) from (select order_id from public.mobbex_payment_intents where order_id is not null group by order_id having count(*) > 1) x) = 0
    and (select count(*) from (select provider_payment_id from public.mobbex_payment_intents where provider_payment_id is not null group by environment, provider_payment_id having count(*) > 1) y) = 0,
    'never two paid orders for one payment, never one order for two payments');
  raise notice 'MOBBEX_LEDGER_ALL_PASS';
end $$;
