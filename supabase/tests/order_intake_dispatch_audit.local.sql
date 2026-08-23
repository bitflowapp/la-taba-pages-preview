-- MEDICION del circuito de intake y despacho tal como esta hoy.
-- No corrige nada: observa y reporta. Corre sobre base efimera con todas las
-- migraciones. Cada bloque imprime evidencia con RAISE NOTICE.
--
--   node scripts/run-order-intake-drill.mjs supabase/tests/order_intake_dispatch_audit.local.sql

\set ON_ERROR_STOP on
set client_min_messages = notice;

-- ===== Fixture compartido =====
create or replace function pg_temp.fixture_business(p_slug text, p_stock integer)
returns table (business_id uuid, product_id uuid, owner_id uuid)
language plpgsql as $$
declare
  v_suffix text := right(replace(gen_random_uuid()::text, '-', ''), 8);
  v_business uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_asset uuid := gen_random_uuid();
  v_identity text; v_master text; v_thumb text;
  v_h1 text := encode(gen_random_bytes(32), 'hex');
  v_h2 text := encode(gen_random_bytes(32), 'hex');
  v_h3 text := encode(gen_random_bytes(32), 'hex');
  v_h4 text := encode(gen_random_bytes(32), 'hex');
begin
  p_slug := p_slug || '-' || v_suffix;
  insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v_owner, 'authenticated', 'authenticated', p_slug || '-owner@example.invalid', '', '{}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp());

  insert into public.businesses (
    id, name, slug, status, is_active, ordering_enabled, ordering_verified,
    ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled, delivery_enabled,
    delivery_fee, minimum_delivery_subtotal
  ) values (
    v_business, 'Fixture ' || p_slug, p_slug, 'open', true, true, true,
    clock_timestamp(), v_owner, 'ARS', true, true,
    500.00, 0.00
  );
  insert into public.business_members (business_id, user_id, role, is_active)
  values (v_business, v_owner, 'owner', true);

  v_identity := public.catalog_image_identity_sha256(p_slug || '-ext', p_slug || '-sku', v_h4);
  v_master := public.catalog_asset_path(p_slug || '-sku', v_identity, 'master', v_h2);
  v_thumb := public.catalog_asset_path(p_slug || '-sku', v_identity, 'thumbnail', v_h3);
  insert into public.catalog_assets (
    id, business_id, external_id, sku, safe_sku, identity_sha256, master_path,
    master_sha256, master_binding_sha256, thumbnail_path, thumbnail_sha256,
    thumbnail_binding_sha256, source_sha256, source_url, rights_status,
    rights_reference, catalog_origin
  ) values (
    v_asset, v_business, p_slug || '-ext', p_slug || '-sku', p_slug || '-sku', v_identity,
    v_master, v_h2, public.catalog_asset_binding_sha256(v_identity, 'master', v_h4, v_h2, 1000, 1000, v_master),
    v_thumb, v_h3, public.catalog_asset_binding_sha256(v_identity, 'thumbnail', v_h4, v_h3, 400, 400, v_thumb),
    v_h4, 'https://example.invalid/' || p_slug || '.webp', 'UNAPPROVED_QA', 'fixture aislado', 'test_only'
  );
  insert into public.products (
    id, business_id, name, description, category, price, image_url, is_active,
    brand, subcategory, presentation, capacity, packaging_type, stock, available,
    is_alcoholic, is_verified, chilled, units_per_pack, external_id, sku,
    catalog_asset_id, image_sha256, image_thumbnail_url, image_thumbnail_sha256,
    source_image_sha256, variant, capacity_value, capacity_unit, catalog_origin, price_status
  ) values (
    v_product, v_business, 'Lata fixture', 'Medicion aislada', 'Gaseosas', 1000.00,
    'assets/products/' || p_slug || '.webp', true, 'TABA2 QA', 'Cola', 'Lata 473 ml', '473 ml', 'lata',
    p_stock, true, false, true, false, 1, p_slug || '-ext', p_slug || '-sku', v_asset,
    v_h1, 'assets/products/' || p_slug || '-t.webp', v_h2, v_h4,
    'Lata 473 ml', 473, 'ml', 'test_only', 'confirmed'
  );
  insert into public.business_payment_settings (
    business_id, enabled, environment, checkout_mode, currency, reserve_stock,
    collector_id, application_id, configured_at, verified_at
  ) values (v_business, true, 'test', 'checkout_pro', 'ARS', true, 'collector-' || p_slug, 'app-' || p_slug, clock_timestamp(), clock_timestamp());

  return query select v_business, v_product, v_owner;
end;
$$;

-- Lleva una sesion hasta tener payment_intent con preferencia creada.
create or replace function pg_temp.hasta_preferencia(p_business uuid, p_product uuid, p_customer uuid, p_rid text, p_qty integer default 1)
returns table (session_id uuid, intent_id uuid)
language plpgsql as $$
declare
  v_session uuid; v_prepare jsonb; v_intent uuid;
begin
  v_session := (public.create_checkout_session(p_customer, jsonb_build_object(
    'business_id', p_business, 'client_request_id', p_rid,
    'items', jsonb_build_array(jsonb_build_object('product_id', p_product, 'quantity', p_qty)),
    'fulfillment_type', 'pickup', 'contact', jsonb_build_object('name', 'QA Intake', 'phone', '5492990000000'),
    'address', '{}'::jsonb, 'age_confirmed', false, 'payment_method', 'mercadopago'
  )) ->> 'checkout_session_id')::uuid;
  v_prepare := public.prepare_mercadopago_preference(v_session, p_customer, false);
  -- La preferencia es unica por sesion: hay un unique sobre payment_attempts.
  perform public.record_mercadopago_preference_created(
    (v_prepare ->> 'payment_attempt_id')::uuid, 'PREF-' || right(replace(v_session::text, '-', ''), 16),
    'https://www.mercadopago.com/r/' || p_rid, 'https://sandbox.mercadopago.com/r/' || p_rid,
    encode(gen_random_bytes(32), 'hex'), 'req-' || right(replace(v_session::text, '-', ''), 12)
  );
  select id into v_intent from public.payment_intents where checkout_session_id = v_session;
  return query select v_session, v_intent;
end;
$$;

-- Resuelve collector y preference reales de la sesion: el fixture les pone un
-- sufijo unico por corrida y un valor fijo daria collector_mismatch.
create or replace function pg_temp.snapshot_aprobado(p_session uuid, p_amount numeric, p_when timestamptz, p_status text default 'approved')
returns jsonb
language sql as $$
  select jsonb_build_object(
    'provider_payment_id', 'PAY-' || right(replace(p_session::text, '-', ''), 12),
    'external_reference', 'taba2:checkout:' || p_session::text,
    'preference_id', pi.preference_id, 'merchant_order_id', 'MO-' || right(replace(p_session::text, '-', ''), 8),
    'collector_id', ps.collector_id, 'currency', 'ARS',
    'transaction_amount', p_amount::text, 'status', p_status,
    'status_detail', 'accredited', 'payment_method', 'visa', 'live_mode', false,
    'provider_occurred_at', p_when::text, 'refunded_amount', '0.00',
    'payer_email_hash', encode(gen_random_bytes(32), 'hex'),
    'raw_response_hash', encode(gen_random_bytes(32), 'hex')
  )
  from public.payment_intents pi
  join public.business_payment_settings ps
    on ps.business_id = pi.business_id and ps.provider = 'mercadopago'
  where pi.checkout_session_id = p_session;
$$;

-- Cliente sintetico con correo unico por corrida.
create or replace function pg_temp.nuevo_cliente()
returns uuid
language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v_id, 'authenticated', 'authenticated', 'qa-' || replace(v_id::text, '-', '') || '@example.invalid',
    '', '{}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp());
  return v_id;
end;
$$;

-- ============================================================
do $$
declare
  f record; v_customer uuid;
  s record; v_res jsonb; v_order uuid; v_count integer; v_stock integer;
  v_intent public.payment_intents%rowtype;
begin
  raise notice '';
  raise notice '########## A · CAMINO FELIZ Y EXACTLY-ONCE ##########';
  select * into f from pg_temp.fixture_business('audit-a', 40);
  v_customer := pg_temp.nuevo_cliente();

  select * into s from pg_temp.hasta_preferencia(f.business_id, f.product_id, v_customer, 'auditA0001', 2);
  select stock into v_stock from public.products where id = f.product_id;
  raise notice 'A1 reserva descuenta al crear la sesion: stock=% (esperado 38)', v_stock;

  v_res := public.record_mercadopago_payment_snapshot(s.intent_id,
    pg_temp.snapshot_aprobado(s.session_id, 2000.00, clock_timestamp()),
    'reconciliation', null);
  raise notice 'A2 snapshot aprobado -> finalize_required=%', v_res ->> 'finalize_required';

  v_res := public.finalize_paid_checkout_session(s.session_id);
  v_order := (v_res ->> 'order_id')::uuid;
  raise notice 'A3 finalize -> ok=% idempotent=%', v_res ->> 'ok', v_res ->> 'idempotent';

  v_res := public.finalize_paid_checkout_session(s.session_id);
  select count(*) into v_count from public.orders where business_id = f.business_id;
  select stock into v_stock from public.products where id = f.product_id;
  raise notice 'A4 finalize repetido -> idempotent=% | pedidos=% | stock=%', v_res ->> 'idempotent', v_count, v_stock;

  -- Webhook fuera de orden: un 'pending' VIEJO llega despues del aprobado.
  v_res := public.record_mercadopago_payment_snapshot(s.intent_id,
    pg_temp.snapshot_aprobado(s.session_id, 2000.00, clock_timestamp() - interval '10 minutes', 'pending'),
    'webhook', null);
  select * into v_intent from public.payment_intents where id = s.intent_id;
  select count(*) into v_count from public.orders where business_id = f.business_id;
  raise notice 'A5 webhook TARDIO (pending viejo) -> internal_status=% provider_status=% pedidos=%',
    v_intent.internal_status, v_intent.provider_status, v_count;
end $$;

-- ============================================================
do $$
declare
  v_r1 jsonb; v_r2 jsonb; v_jobs integer; v_hash text := encode(gen_random_bytes(32), 'hex');
begin
  raise notice '';
  raise notice '########## B · WEBHOOK DUPLICADO ##########';
  v_r1 := public.record_mercadopago_webhook_receipt('test', 'evt-dup-1', 'payment.updated', '123456', true, 'rq-1', v_hash);
  v_r2 := public.record_mercadopago_webhook_receipt('test', 'evt-dup-1', 'payment.updated', '123456', true, 'rq-2', v_hash);
  select count(*)::integer into v_jobs from public.payment_outbox where resource_id = '123456';
  raise notice 'B1 primer recibo: duplicate=% queued=%', v_r1 ->> 'duplicate', v_r1 ->> 'queued';
  raise notice 'B2 recibo repetido: duplicate=% queued=%', v_r2 ->> 'duplicate', v_r2 ->> 'queued';
  raise notice 'B3 trabajos encolados para ese recurso: % (esperado 1)', v_jobs;
end $$;

-- ============================================================
do $$
declare
  f record; v_customer uuid;
  s record; v_stock integer; v_liberadas integer; v_res jsonb;
  v_session public.checkout_sessions%rowtype;
  v_intent public.payment_intents%rowtype;
  v_alertas integer; v_pipeline integer; v_huerfanos integer;
begin
  raise notice '';
  raise notice '########## C · EL CLIENTE PAGA Y NO VUELVE ##########';
  raise notice 'Escenario: la sesion se fue al proveedor, el pago se aprueba alla,';
  raise notice 'y de este lado nadie se entera (en TEST la notificacion no valida firma).';
  select * into f from pg_temp.fixture_business('audit-c', 10);
  v_customer := pg_temp.nuevo_cliente();

  select * into s from pg_temp.hasta_preferencia(f.business_id, f.product_id, v_customer, 'auditC0001', 3);
  update public.checkout_sessions set status = 'redirected' where id = s.session_id;
  select stock into v_stock from public.products where id = f.product_id;
  raise notice 'C1 sesion redirigida al proveedor, stock reservado: % (de 10)', v_stock;

  -- El tiempo pasa. La sesion vence (la ventana real es de 15 minutos).
  update public.checkout_sessions
     set created_at = clock_timestamp() - interval '20 minutes',
         expires_at = clock_timestamp() - interval '5 minutes'
   where id = s.session_id;
  update public.inventory_reservations
     set created_at = clock_timestamp() - interval '20 minutes',
         expires_at = clock_timestamp() - interval '5 minutes'
   where checkout_session_id = s.session_id;
  v_liberadas := public.sweep_expired_checkout_sessions();
  select stock into v_stock from public.products where id = f.product_id;
  select * into v_session from public.checkout_sessions where id = s.session_id;
  raise notice 'C2 barrido de expiracion: liberadas=% stock=% status=%', v_liberadas, v_stock, v_session.status;

  -- Pregunta central: el sistema sabe que hay un pago aprobado esperando?
  select count(*)::integer into v_alertas from public.list_unfinalized_paid_checkouts();
  select count(*)::integer into v_huerfanos from public.payment_outbox
   where payment_intent_id = s.intent_id or resource_id like 'PAY-%';
  select count(*)::integer into v_pipeline from public.list_payment_outbox_operational_alerts();
  select * into v_intent from public.payment_intents where id = s.intent_id;
  raise notice 'C3 intent: internal_status=% provider_payment_id=%', v_intent.internal_status, coalesce(v_intent.provider_payment_id, 'NULL');
  raise notice 'C4 list_unfinalized_paid_checkouts -> % filas', v_alertas;
  raise notice 'C5 trabajos de reconciliacion encolados automaticamente -> %', v_huerfanos;
  raise notice 'C6 alertas de outbox -> % filas', v_pipeline;
  raise notice 'C7 >>> el pago existe en Mercado Pago y aca no hay NADA que lo busque <<<';

  -- Y si el operador quisiera reconciliar a mano desde el Panel?
  raise notice 'C8 can_reconcile exige provider_payment_id no nulo; aca es NULL -> boton apagado';

  -- Ahora si: llega el aprobado tarde (el cliente vuelve una hora despues).
  v_res := public.record_mercadopago_payment_snapshot(s.intent_id,
    pg_temp.snapshot_aprobado(s.session_id, 3000.00, clock_timestamp()),
    'reconciliation', null);
  select * into v_session from public.checkout_sessions where id = s.session_id;
  select count(*)::integer into v_alertas from public.list_unfinalized_paid_checkouts();
  raise notice 'C9 aprobado tardio -> manual_review=% razon=%', v_res ->> 'manual_review_required', v_session.manual_review_reason;
  raise notice 'C10 list_unfinalized_paid_checkouts tras el aprobado tardio -> % filas', v_alertas;
  raise notice 'C11 >>> cobrado, sin pedido, y NO aparece en la alerta de pagos sin pedido <<<';
end $$;

-- ============================================================
do $$
declare
  f record; v_customer uuid; s record;
  v_res jsonb; v_stock integer; v_session public.checkout_sessions%rowtype;
begin
  raise notice '';
  raise notice '########## D · CARRERA: BARRIDO CONTRA PAGO APROBADO ##########';
  select * into f from pg_temp.fixture_business('audit-d', 10);
  v_customer := pg_temp.nuevo_cliente();
  select * into s from pg_temp.hasta_preferencia(f.business_id, f.product_id, v_customer, 'auditD0001', 2);
  update public.checkout_sessions set status = 'payment_pending' where id = s.session_id;

  -- El pago se aprueba en el proveedor 1 segundo ANTES de que venza la sesion,
  -- pero el aviso llega despues del barrido.
  update public.checkout_sessions
     set created_at = clock_timestamp() - interval '15 minutes',
         expires_at = clock_timestamp() - interval '1 second'
   where id = s.session_id;
  update public.inventory_reservations
     set created_at = clock_timestamp() - interval '15 minutes',
         expires_at = clock_timestamp() - interval '1 second'
   where checkout_session_id = s.session_id;
  perform public.sweep_expired_checkout_sessions();
  v_res := public.record_mercadopago_payment_snapshot(s.intent_id,
    pg_temp.snapshot_aprobado(s.session_id, 2000.00, clock_timestamp() - interval '2 seconds'),
    'webhook', null);
  select * into v_session from public.checkout_sessions where id = s.session_id;
  select stock into v_stock from public.products where id = f.product_id;
  raise notice 'D1 pago aprobado ANTES de vencer, avisado DESPUES del barrido';
  raise notice 'D2 -> manual_review=% razon=% stock devuelto=%',
    v_res ->> 'manual_review_required', v_session.manual_review_reason, v_stock;
  raise notice 'D3 >>> el dinero entro; el pedido no existe; hace falta una persona <<<';
end $$;

-- ============================================================
do $$
declare
  v_owner uuid; v_job_id uuid; v_claimed integer; v_recl integer;
  v_hash text := encode(gen_random_bytes(32), 'hex'); v_r jsonb;
begin
  raise notice '';
  raise notice '########## E · REINICIO DEL CONSUMIDOR (lease del outbox) ##########';
  v_r := public.record_mercadopago_webhook_receipt('test', 'evt-lease-1', 'payment.created', '777777', true, 'rq-lease', v_hash);
  select count(*)::integer into v_claimed from public.claim_payment_outbox('worker-uno', 10, 90);
  raise notice 'E1 worker-uno reclama % trabajo(s)', v_claimed;

  -- El worker muere sin completar. El lease vence.
  update public.payment_outbox set lease_expires_at = clock_timestamp() - interval '1 second'
   where status in ('claimed', 'processing');
  select count(*)::integer into v_recl from public.claim_payment_outbox('worker-dos', 10, 90);
  raise notice 'E2 tras vencer el lease, worker-dos reclama % trabajo(s)', v_recl;
  raise notice 'E3 el trabajo sobrevive al reinicio: %', case when v_recl > 0 then 'SI' else 'NO' end;
end $$;

-- ============================================================
do $$
declare v_c integer;
begin
  raise notice '';
  raise notice '########## F · OBSERVABILIDAD DISPONIBLE HOY ##########';
  select count(*)::integer into v_c from public.list_stock_reservation_alerts();
  raise notice 'F1 list_stock_reservation_alerts ....... % filas', v_c;
  select count(*)::integer into v_c from public.list_payment_outbox_operational_alerts();
  raise notice 'F2 list_payment_outbox_operational_alerts % filas', v_c;
  select count(*)::integer into v_c from public.list_unfinalized_paid_checkouts();
  raise notice 'F3 list_unfinalized_paid_checkouts ..... % filas', v_c;
  raise notice 'F4 no existe funcion para: pago en el proveedor que este lado nunca registro';
  raise notice 'F5 no existe funcion para: pedido listo sin rider / rider con GPS viejo (a verificar)';
end $$;
