-- CERTIFICACION de los P0 del circuito de intake y despacho.
-- A diferencia del archivo de auditoria, este FALLA si algo no se cumple.
--
--   node scripts/run-order-intake-drill.mjs supabase/tests/order_intake_dispatch_p0.local.sql

\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function pg_temp.ok(p_condicion boolean, p_nombre text, p_detalle text default '')
returns void
language plpgsql as $$
begin
  if p_condicion then
    raise notice 'OK    %  %', rpad(p_nombre, 58, '.'), p_detalle;
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

create or replace function pg_temp.fixture(p_stock integer)
returns table (business_id uuid, product_id uuid, owner_id uuid)
language plpgsql as $$
declare
  v_slug text := 'p0-' || right(replace(gen_random_uuid()::text, '-', ''), 10);
  v_business uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_owner uuid;
  v_asset uuid := gen_random_uuid();
  v_identity text; v_master text; v_thumb text;
  v_h1 text := encode(gen_random_bytes(32), 'hex');
  v_h2 text := encode(gen_random_bytes(32), 'hex');
  v_h3 text := encode(gen_random_bytes(32), 'hex');
  v_h4 text := encode(gen_random_bytes(32), 'hex');
begin
  v_owner := pg_temp.nuevo_usuario(v_slug || '-owner');
  insert into public.businesses (
    id, name, slug, status, is_active, ordering_enabled, ordering_verified,
    ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled,
    delivery_enabled, delivery_fee, minimum_delivery_subtotal
  ) values (
    v_business, 'Fixture ' || v_slug, v_slug, 'open', true, true, true,
    clock_timestamp(), v_owner, 'ARS', true, true, 500.00, 0.00
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
    rights_reference, catalog_origin
  ) values (
    v_asset, v_business, v_slug || '-ext', v_slug || '-sku', v_slug || '-sku', v_identity,
    v_master, v_h2, public.catalog_asset_binding_sha256(v_identity, 'master', v_h4, v_h2, 1000, 1000, v_master),
    v_thumb, v_h3, public.catalog_asset_binding_sha256(v_identity, 'thumbnail', v_h4, v_h3, 400, 400, v_thumb),
    v_h4, 'https://example.invalid/' || v_slug || '.webp', 'UNAPPROVED_QA', 'fixture aislado', 'test_only'
  );
  insert into public.products (
    id, business_id, name, description, category, price, image_url, is_active,
    brand, subcategory, presentation, capacity, packaging_type, stock, available,
    is_alcoholic, is_verified, chilled, units_per_pack, external_id, sku,
    catalog_asset_id, image_sha256, image_thumbnail_url, image_thumbnail_sha256,
    source_image_sha256, variant, capacity_value, capacity_unit, catalog_origin, price_status
  ) values (
    v_product, v_business, 'Lata fixture', 'Certificacion P0', 'Gaseosas', 1000.00,
    'assets/products/' || v_slug || '.webp', true, 'TABA2 QA', 'Cola', 'Lata 473 ml', '473 ml', 'lata',
    p_stock, true, false, true, false, 1, v_slug || '-ext', v_slug || '-sku', v_asset,
    v_h1, 'assets/products/' || v_slug || '-t.webp', v_h2, v_h4,
    'Lata 473 ml', 473, 'ml', 'test_only', 'confirmed'
  );
  insert into public.business_payment_settings (
    business_id, enabled, environment, checkout_mode, currency, reserve_stock,
    collector_id, application_id, configured_at, verified_at
  ) values (v_business, true, 'test', 'checkout_pro', 'ARS', true, 'collector-' || v_slug, 'app-' || v_slug, clock_timestamp(), clock_timestamp());
  return query select v_business, v_product, v_owner;
end;
$$;

create or replace function pg_temp.hasta_preferencia(p_business uuid, p_product uuid, p_customer uuid, p_rid text, p_qty integer default 1)
returns table (session_id uuid, intent_id uuid)
language plpgsql as $$
declare v_session uuid; v_prepare jsonb; v_intent uuid;
begin
  v_session := (public.create_checkout_session(p_customer, jsonb_build_object(
    'business_id', p_business, 'client_request_id', p_rid,
    'items', jsonb_build_array(jsonb_build_object('product_id', p_product, 'quantity', p_qty)),
    'fulfillment_type', 'pickup', 'contact', jsonb_build_object('name', 'QA P0', 'phone', '5492990000000'),
    'address', '{}'::jsonb, 'age_confirmed', false, 'payment_method', 'mercadopago'
  )) ->> 'checkout_session_id')::uuid;
  v_prepare := public.prepare_mercadopago_preference(v_session, p_customer, false);
  perform public.record_mercadopago_preference_created(
    (v_prepare ->> 'payment_attempt_id')::uuid, 'PREF-' || right(replace(v_session::text, '-', ''), 16),
    'https://www.mercadopago.com/r/' || p_rid, 'https://sandbox.mercadopago.com/r/' || p_rid,
    encode(gen_random_bytes(32), 'hex'), 'req-' || right(replace(v_session::text, '-', ''), 12)
  );
  select id into v_intent from public.payment_intents where checkout_session_id = v_session;
  return query select v_session, v_intent;
end;
$$;

create or replace function pg_temp.snapshot(p_session uuid, p_amount numeric, p_when timestamptz, p_status text default 'approved')
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

-- Envejece una sesion y sus reservas respetando `expires_at > created_at`.
create or replace function pg_temp.envejecer(p_session uuid, p_edad interval, p_vencida_hace interval)
returns void
language sql as $$
  with s as (
    update public.checkout_sessions
       set created_at = clock_timestamp() - p_edad,
           expires_at = clock_timestamp() - p_vencida_hace
     where id = p_session returning id
  )
  update public.inventory_reservations
     set created_at = clock_timestamp() - p_edad,
         expires_at = clock_timestamp() - p_vencida_hace
   where checkout_session_id = (select id from s);
$$;

-- ============================================================
-- P0-1/2/3/4  exactly-once, duplicados y fuera de orden
do $$
declare
  f record; c uuid; s record; r jsonb; n integer; st integer;
  pi public.payment_intents%rowtype; h text := encode(gen_random_bytes(32), 'hex');
begin
  raise notice '';
  raise notice '===== P0-1..4 · UN PAGO, UN PEDIDO =====';
  select * into f from pg_temp.fixture(40);
  c := pg_temp.nuevo_usuario('p0-cust');
  select * into s from pg_temp.hasta_preferencia(f.business_id, f.product_id, c, 'p0rid0001', 2);

  select stock into st from public.products where id = f.product_id;
  perform pg_temp.ok(st = 38, 'P0-4 doble click: la reserva descuenta una sola vez', 'stock=' || st);
  perform pg_temp.ok(
    (public.create_checkout_session(c, jsonb_build_object(
      'business_id', f.business_id, 'client_request_id', 'p0rid0001',
      'items', jsonb_build_array(jsonb_build_object('product_id', f.product_id, 'quantity', 2)),
      'fulfillment_type', 'pickup', 'contact', jsonb_build_object('name', 'QA P0', 'phone', '5492990000000'),
      'address', '{}'::jsonb, 'age_confirmed', false, 'payment_method', 'mercadopago'
    )) ->> 'checkout_session_id')::uuid = s.session_id,
    'P0-4 reintentar el mismo carrito devuelve la MISMA sesion');
  select stock into st from public.products where id = f.product_id;
  perform pg_temp.ok(st = 38, 'P0-4 el reintento no vuelve a descontar', 'stock=' || st);

  r := public.record_mercadopago_payment_snapshot(s.intent_id, pg_temp.snapshot(s.session_id, 2000.00, clock_timestamp()), 'webhook', null);
  perform pg_temp.ok(r ->> 'finalize_required' = 'true', 'P0-1 pago aprobado habilita la finalizacion');
  r := public.finalize_paid_checkout_session(s.session_id);
  perform pg_temp.ok(r ->> 'ok' = 'true' and r ->> 'idempotent' = 'false', 'P0-1 se crea el pedido');
  r := public.finalize_paid_checkout_session(s.session_id);
  perform pg_temp.ok(r ->> 'idempotent' = 'true', 'P0-2 finalizar de nuevo es idempotente');
  select count(*)::integer into n from public.orders where business_id = f.business_id;
  perform pg_temp.ok(n = 1, 'P0-1 existe EXACTAMENTE un pedido', 'pedidos=' || n);
  select stock into st from public.products where id = f.product_id;
  perform pg_temp.ok(st = 38, 'P0-2 el stock no se descuenta dos veces', 'stock=' || st);
  select count(*)::integer into n from public.inventory_reservations
   where checkout_session_id = s.session_id and status = 'converted';
  perform pg_temp.ok(n = 1, 'P0-2 la reserva se convierte una sola vez');

  r := public.record_mercadopago_payment_snapshot(s.intent_id,
    pg_temp.snapshot(s.session_id, 2000.00, clock_timestamp() - interval '10 minutes', 'pending'), 'webhook', null);
  select * into pi from public.payment_intents where id = s.intent_id;
  select count(*)::integer into n from public.orders where business_id = f.business_id;
  perform pg_temp.ok(pi.internal_status = 'completed' and n = 1,
    'P0-3 un aviso viejo no hace retroceder el pago', pi.internal_status || ' pedidos=' || n);
end $$;

-- ============================================================
-- P0-2  webhook duplicado
do $$
declare r1 jsonb; r2 jsonb; n integer; h text := encode(gen_random_bytes(32), 'hex'); e text;
begin
  raise notice '';
  raise notice '===== P0-2 · WEBHOOK DUPLICADO =====';
  e := 'evt-' || right(replace(gen_random_uuid()::text, '-', ''), 12);
  r1 := public.record_mercadopago_webhook_receipt('test', e, 'payment.updated', 'res-' || e, true, 'rq1', h);
  r2 := public.record_mercadopago_webhook_receipt('test', e, 'payment.updated', 'res-' || e, true, 'rq2', h);
  perform pg_temp.ok(r1 ->> 'duplicate' = 'false' and r1 ->> 'queued' = 'true', 'el primer recibo encola trabajo');
  perform pg_temp.ok(r2 ->> 'duplicate' = 'true' and r2 ->> 'queued' = 'false', 'el repetido se reconoce y no encola');
  select count(*)::integer into n from public.payment_outbox where resource_id = 'res-' || e;
  perform pg_temp.ok(n = 1, 'queda UN solo trabajo para ese recurso', 'trabajos=' || n);
end $$;

-- ============================================================
-- P0-NUEVO  el pago huerfano se busca solo
do $$
declare
  f record; c uuid; s record; n integer; probes integer; job record;
begin
  raise notice '';
  raise notice '===== P0-NUEVO · EL PAGO QUE NADIE FUE A BUSCAR =====';
  select * into f from pg_temp.fixture(10);
  c := pg_temp.nuevo_usuario('p0-orphan');
  select * into s from pg_temp.hasta_preferencia(f.business_id, f.product_id, c, 'p0orph001', 3);
  update public.checkout_sessions set status = 'redirected' where id = s.session_id;
  perform pg_temp.envejecer(s.session_id, interval '20 minutes', interval '5 minutes');
  perform public.sweep_expired_checkout_sessions();

  -- Antes de esta mision: cero. Ahora el barrido tiene que encolar la consulta.
  n := public.enqueue_checkout_provider_probes(50);
  perform pg_temp.ok(n >= 1, 'el barrido encola una consulta al proveedor', 'encoladas=' || n);
  select count(*)::integer into n from public.payment_outbox
   where payment_intent_id = s.intent_id and topic = 'payment_reconcile' and status = 'pending';
  perform pg_temp.ok(n = 1, 'hay exactamente una sonda activa para ese intent', 'sondas=' || n);

  -- Correrlo otra vez no puede duplicarla.
  perform public.enqueue_checkout_provider_probes(50);
  select count(*)::integer into n from public.payment_outbox
   where payment_intent_id = s.intent_id and topic = 'payment_reconcile'
     and status in ('pending', 'claimed', 'processing', 'retry_wait');
  perform pg_temp.ok(n = 1, 'un segundo barrido NO duplica la sonda', 'sondas=' || n);

  -- El worker responde "no hay pago": la sonda tiene que terminar alguna vez.
  update public.payment_outbox set status = 'completed', completed_at = clock_timestamp()
   where payment_intent_id = s.intent_id and topic = 'payment_reconcile';
  for i in 1..9 loop
    perform public.record_provider_probe_empty(s.intent_id);
  end loop;
  select count(*)::integer into probes from public.payment_events
   where payment_intent_id = s.intent_id and event_type = 'payment.provider_probe_empty';
  perform pg_temp.ok(probes = 9, 'se registran las consultas vacias', 'vacias=' || probes);
  n := public.enqueue_checkout_provider_probes(50);
  select count(*)::integer into n from public.payment_outbox
   where payment_intent_id = s.intent_id and topic = 'payment_reconcile' and status = 'pending';
  perform pg_temp.ok(n = 0, 'tras agotarse, deja de consultar al proveedor', 'sondas=' || n);
end $$;

-- ============================================================
-- P0-NUEVO  el cobro sin pedido es visible
do $$
declare
  f record; c uuid; s record; r jsonb; n integer; sess public.checkout_sessions%rowtype;
  alerta record; encontrada boolean := false;
begin
  raise notice '';
  raise notice '===== P0-NUEVO · COBRADO Y SIN PEDIDO: TIENE QUE GRITAR =====';
  select * into f from pg_temp.fixture(10);
  c := pg_temp.nuevo_usuario('p0-cobrado');
  select * into s from pg_temp.hasta_preferencia(f.business_id, f.product_id, c, 'p0cob0001', 2);
  perform pg_temp.envejecer(s.session_id, interval '20 minutes', interval '5 minutes');
  perform public.sweep_expired_checkout_sessions();

  -- Llega la verdad tarde: el pago estaba aprobado.
  r := public.record_mercadopago_payment_snapshot(s.intent_id, pg_temp.snapshot(s.session_id, 2000.00, clock_timestamp()), 'reconciliation', null);
  select * into sess from public.checkout_sessions where id = s.session_id;
  perform pg_temp.ok(r ->> 'manual_review_required' = 'true'
    and sess.manual_review_reason = 'approved_after_reservation_expired',
    'el cobro tardio va a revision manual', sess.manual_review_reason);
  select count(*)::integer into n from public.orders where business_id = f.business_id;
  perform pg_temp.ok(n = 0, 'no se crea un pedido sobre stock que ya se libero');

  -- ESTO es lo que fallaba: devolvia 0 filas.
  select count(*)::integer into n from public.list_unfinalized_paid_checkouts()
   where checkout_session_id = s.session_id;
  perform pg_temp.ok(n = 1, 'aparece en la lista de cobrado-sin-pedido', 'filas=' || n);
  perform pg_temp.ok(
    (select severity from public.list_unfinalized_paid_checkouts() where checkout_session_id = s.session_id) = 'critical',
    'y lo hace como critico, no como aviso');

  -- Y el operador puede accionar desde la UI.
  perform set_config('request.jwt.claims', json_build_object('sub', f.owner_id::text, 'role', 'authenticated')::text, true);
  for alerta in select value from public.list_business_payments(f.business_id) value loop
    if (alerta.value ->> 'payment_intent_id')::uuid = s.intent_id then
      encontrada := true;
      perform pg_temp.ok((alerta.value ->> 'can_reconcile')::boolean,
        'el operador puede reconciliarlo desde el Panel', 'internal=' || (alerta.value ->> 'internal_status'));
      perform pg_temp.ok((alerta.value ->> 'can_refund')::boolean,
        'y puede reembolsarlo sin haber creado el pedido');
    end if;
  end loop;
  perform pg_temp.ok(encontrada, 'el pago figura en la consulta del Panel');
end $$;

-- ============================================================
-- P0-NUEVO  la carrera contra el barrido deja de costar pedidos
do $$
declare
  f record; c uuid; s record; r jsonb; n integer;
begin
  raise notice '';
  raise notice '===== P0-NUEVO · DESCUBRIR EL PAGO MIENTRAS LA RESERVA VIVE =====';
  select * into f from pg_temp.fixture(10);
  c := pg_temp.nuevo_usuario('p0-carrera');
  select * into s from pg_temp.hasta_preferencia(f.business_id, f.product_id, c, 'p0car0001', 2);
  update public.checkout_sessions set status = 'redirected' where id = s.session_id;
  -- La sesion sigue viva: se creo hace 3 minutos y vence en 12.
  update public.checkout_sessions set created_at = clock_timestamp() - interval '3 minutes' where id = s.session_id;
  update public.inventory_reservations set created_at = clock_timestamp() - interval '3 minutes' where checkout_session_id = s.session_id;

  n := public.enqueue_checkout_provider_probes(50);
  perform pg_temp.ok(n >= 1, 'se consulta al proveedor ANTES de que venza la sesion', 'encoladas=' || n);

  -- El worker trae el pago aprobado: la reserva todavia esta activa.
  r := public.record_mercadopago_payment_snapshot(s.intent_id, pg_temp.snapshot(s.session_id, 2000.00, clock_timestamp()), 'reconciliation', null);
  perform pg_temp.ok(r ->> 'manual_review_required' = 'false' and r ->> 'finalize_required' = 'true',
    'no hay revision manual: la reserva sigue viva');
  r := public.finalize_paid_checkout_session(s.session_id);
  perform pg_temp.ok(r ->> 'ok' = 'true', 'el pedido se crea solo, sin intervencion');
  select count(*)::integer into n from public.orders where business_id = f.business_id;
  perform pg_temp.ok(n = 1, 'un pedido, del cliente que no volvio nunca', 'pedidos=' || n);
end $$;

-- ============================================================
-- P0-5  no hay sobreventa
do $$
declare f record; c1 uuid; c2 uuid; s record; st integer; fallo boolean := false;
begin
  raise notice '';
  raise notice '===== P0-5 · STOCK INSUFICIENTE =====';
  select * into f from pg_temp.fixture(3);
  c1 := pg_temp.nuevo_usuario('p0-s1');
  c2 := pg_temp.nuevo_usuario('p0-s2');
  select * into s from pg_temp.hasta_preferencia(f.business_id, f.product_id, c1, 'p0stk0001', 3);
  select stock into st from public.products where id = f.product_id;
  perform pg_temp.ok(st = 0, 'la primera compra toma todo el stock', 'stock=' || st);
  begin
    perform public.create_checkout_session(c2, jsonb_build_object(
      'business_id', f.business_id, 'client_request_id', 'p0stk0002',
      'items', jsonb_build_array(jsonb_build_object('product_id', f.product_id, 'quantity', 1)),
      'fulfillment_type', 'pickup', 'contact', jsonb_build_object('name', 'QA P0', 'phone', '5492990000001'),
      'address', '{}'::jsonb, 'age_confirmed', false, 'payment_method', 'mercadopago'));
  exception when others then fallo := true;
  end;
  perform pg_temp.ok(fallo, 'la segunda compra se rechaza en vez de sobrevender');
  select stock into st from public.products where id = f.product_id;
  perform pg_temp.ok(st = 0, 'el stock nunca queda negativo', 'stock=' || st);
end $$;

-- ============================================================
-- P0-10  cancelacion y expiracion devuelven el stock
do $$
declare f record; c uuid; s record; st integer; n integer;
begin
  raise notice '';
  raise notice '===== P0-10 · EXPIRACION Y RESERVAS =====';
  select * into f from pg_temp.fixture(10);
  c := pg_temp.nuevo_usuario('p0-exp');
  select * into s from pg_temp.hasta_preferencia(f.business_id, f.product_id, c, 'p0exp0001', 4);
  select stock into st from public.products where id = f.product_id;
  perform pg_temp.ok(st = 6, 'la reserva descuenta', 'stock=' || st);
  perform pg_temp.envejecer(s.session_id, interval '20 minutes', interval '5 minutes');
  perform public.sweep_expired_checkout_sessions();
  select stock into st from public.products where id = f.product_id;
  perform pg_temp.ok(st = 10, 'el barrido devuelve el stock entero', 'stock=' || st);
  select count(*)::integer into n from public.inventory_reservations
   where checkout_session_id = s.session_id and status = 'active';
  perform pg_temp.ok(n = 0, 'no queda ninguna reserva activa');
  -- Liberar dos veces no puede devolver stock de mas.
  perform public.release_checkout_session_inventory(s.session_id, 'p0_doble', 'cancelled');
  select stock into st from public.products where id = f.product_id;
  perform pg_temp.ok(st = 10, 'liberar dos veces no infla el stock', 'stock=' || st);
end $$;

-- ============================================================
-- P0-11/12  el trabajo sobrevive al reinicio y el fallo se ve
do $$
declare h text := encode(gen_random_bytes(32), 'hex'); e text; n integer; r jsonb;
begin
  raise notice '';
  raise notice '===== P0-11/12 · REINICIO Y OBSERVABILIDAD =====';
  e := 'evt-' || right(replace(gen_random_uuid()::text, '-', ''), 12);
  r := public.record_mercadopago_webhook_receipt('test', e, 'payment.created', 'res-' || e, true, 'rq', h);
  select count(*)::integer into n from public.claim_payment_outbox('w1-' || e, 10, 90);
  perform pg_temp.ok(n >= 1, 'P0-11 un worker reclama el trabajo', 'reclamados=' || n);
  update public.payment_outbox set lease_expires_at = clock_timestamp() - interval '1 second'
   where resource_id = 'res-' || e and status in ('claimed', 'processing');
  select count(*)::integer into n from public.claim_payment_outbox('w2-' || e, 10, 90);
  perform pg_temp.ok(n >= 1, 'P0-11 si el worker muere, otro lo retoma', 'reclamados=' || n);

  update public.payment_outbox set status = 'dead_letter'
   where resource_id = 'res-' || e;
  select count(*)::integer into n from public.list_payment_outbox_operational_alerts()
   where state = 'payment_outbox_dead_letter';
  perform pg_temp.ok(n >= 1, 'P0-12 un trabajo muerto queda visible y con accion', 'alertas=' || n);
end $$;

-- ============================================================
-- P0-6/8  Panel y Rider, con las alertas nuevas
do $$
declare
  b uuid := gen_random_uuid(); own uuid; staff uuid; rider uuid; cust uuid;
  o uuid; rev bigint; n integer; center jsonb;
begin
  raise notice '';
  raise notice '===== P0-6/8 · PANEL, RIDER Y LISTO-SIN-RIDER =====';
  own := pg_temp.nuevo_usuario('p0-own');
  staff := pg_temp.nuevo_usuario('p0-staff');
  rider := pg_temp.nuevo_usuario('p0-rider');
  cust := pg_temp.nuevo_usuario('p0-c');
  insert into public.businesses (
    id, name, slug, status, is_active, ordering_enabled, ordering_verified,
    ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled,
    delivery_enabled, delivery_fee, minimum_delivery_subtotal
  ) values (b, 'P0 despacho', 'p0-desp-' || right(replace(b::text, '-', ''), 8),
    'open', true, true, true, clock_timestamp(), own, 'ARS', true, true, 500.00, 0.00);
  insert into public.business_members (business_id, user_id, role, is_active) values
    (b, own, 'owner', true), (b, staff, 'staff', true), (b, rider, 'rider', true);
  insert into public.orders (
    business_id, code, public_code, status, fulfillment_type, delivery_mode,
    customer_user_id, client_request_id, currency_code, customer_name, customer_phone,
    payment_method, subtotal, discount_total, delivery_fee, total,
    delivery_latitude, delivery_longitude, delivery_location_source, delivery_location_confirmed_at
  ) values (b, 'P0-D-1', 'P0-D-1', 'received', 'delivery', 'delivery', cust,
    'p0d_' || right(replace(b::text, '-', ''), 10), 'ARS', 'Cliente QA', '5492990000000',
    'cash', 1000.00, 0, 500.00, 1500.00, -38.9539, -68.0596, 'map_pin', clock_timestamp())
  returning id, revision into o, rev;

  perform set_config('request.jwt.claims', json_build_object('sub', staff::text, 'role', 'authenticated')::text, true);
  select count(*)::integer into n from public.list_operational_pipeline(b, true) p where p.reference_id = o;
  perform pg_temp.ok(n = 1, 'P0-6 el Panel ve el pedido apenas nace');

  perform public.transition_order(o, rev, 'accepted', 'p0-a-' || right(replace(o::text,'-',''),8));
  select revision into rev from public.orders where id = o;
  perform public.transition_order(o, rev, 'preparing', 'p0-p-' || right(replace(o::text,'-',''),8));
  select revision into rev from public.orders where id = o;
  perform public.transition_order(o, rev, 'ready', 'p0-r-' || right(replace(o::text,'-',''),8));
  select revision into rev from public.orders where id = o;

  -- Listo hace rato y sin rider: antes no producia ninguna alerta.
  -- Se envejece `ready_at`: `updated_at` lo repisa el trigger orders_set_updated_at.
  update public.orders set ready_at = clock_timestamp() - interval '30 minutes' where id = o;
  perform public.refresh_operational_alerts(b);
  select count(*)::integer into n from public.operational_alerts a
   where a.business_id = b and a.alert_code = 'ORDER_READY_WITHOUT_RIDER' and a.status = 'open';
  perform pg_temp.ok(n = 1, 'listo sin rider produce una alerta accionable', 'alertas=' || n);

  perform set_config('request.jwt.claims', json_build_object('sub', rider::text, 'role', 'authenticated')::text, true);
  select count(*)::integer into n from public.list_available_rider_orders(b) x where x.public_code = 'P0-D-1';
  perform pg_temp.ok(n = 1, 'P0-8 el Rider recibe el pedido que el Panel dejo listo');

  -- Al tomarlo, la alerta se cierra sola. Se relee la revision: envejecer
  -- `ready_at` es una escritura y el trigger orders_zz_bump_revision la sube.
  select revision into rev from public.orders where id = o;
  perform pg_temp.ok(
    (public.claim_delivery_order(b, 'P0-D-1', rev, 'p0-claim-' || right(replace(o::text,'-',''),8)) ->> 'ok')::boolean,
    'P0-9 el Rider toma el pedido');

  -- Un segundo Rider intenta el mismo pedido con la revision que tenia.
  declare
    rider2 uuid := pg_temp.nuevo_usuario('p0-rider2');
    gano boolean := false;
    duenio uuid;
  begin
    insert into public.business_members (business_id, user_id, role, is_active)
    values (b, rider2, 'rider', true);
    perform set_config('request.jwt.claims', json_build_object('sub', rider2::text, 'role', 'authenticated')::text, true);
    begin
      gano := coalesce((public.claim_delivery_order(b, 'P0-D-1', rev, 'p0-claim2-' || right(replace(o::text,'-',''),8)) ->> 'ok')::boolean, false);
    exception when others then gano := false;
    end;
    select assigned_rider_user_id into duenio from public.orders where id = o;
    perform pg_temp.ok(not gano, 'P0-9 el segundo Rider NO gana el mismo pedido');
    perform pg_temp.ok(duenio = rider, 'P0-9 el pedido queda con el primero', 'duenio=' || coalesce(duenio::text, 'NADIE'));
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', staff::text, 'role', 'authenticated')::text, true);
  perform public.refresh_operational_alerts(b);
  select count(*)::integer into n from public.operational_alerts a
   where a.business_id = b and a.alert_code = 'ORDER_READY_WITHOUT_RIDER' and a.status = 'open';
  perform pg_temp.ok(n = 0, 'cuando el Rider lo toma, la alerta se resuelve sola', 'abiertas=' || n);
end $$;

-- ============================================================
-- La alerta del huerfano, por si el barrido no corre
do $$
declare
  f record; c uuid; s record; n integer;
begin
  raise notice '';
  raise notice '===== RED DE LA RED · CHECKOUT SIN CONFIRMAR =====';
  select * into f from pg_temp.fixture(10);
  c := pg_temp.nuevo_usuario('p0-unver');
  select * into s from pg_temp.hasta_preferencia(f.business_id, f.product_id, c, 'p0unv0001', 2);
  update public.checkout_sessions set status = 'redirected' where id = s.session_id;
  perform pg_temp.envejecer(s.session_id, interval '60 minutes', interval '45 minutes');
  perform public.sweep_expired_checkout_sessions();

  perform set_config('request.jwt.claims', json_build_object('sub', f.owner_id::text, 'role', 'authenticated')::text, true);
  perform public.refresh_operational_alerts(f.business_id);
  select count(*)::integer into n from public.operational_alerts a
   where a.business_id = f.business_id and a.alert_code = 'CHECKOUT_PROVIDER_UNVERIFIED' and a.status = 'open';
  perform pg_temp.ok(n = 1, 'un checkout vencido sin respuesta del proveedor grita', 'alertas=' || n);
  perform pg_temp.ok(
    (select severity from public.operational_alerts a
      where a.business_id = f.business_id and a.alert_code = 'CHECKOUT_PROVIDER_UNVERIFIED') = 'CRITICAL',
    'y lo hace como critico');

  -- Cuando el barrido pregunta y el proveedor dice que no hay pago, la duda se
  -- termina y la alerta tiene que apagarse sola. Sin esto se acumularian: la
  -- medicion de staging encontro 47 checkouts en esa situacion de una sola vez.
  perform public.record_provider_probe_empty(s.intent_id);
  perform public.refresh_operational_alerts(f.business_id);
  select count(*)::integer into n from public.operational_alerts a
   where a.business_id = f.business_id and a.alert_code = 'CHECKOUT_PROVIDER_UNVERIFIED' and a.status = 'open';
  perform pg_temp.ok(n = 0, 'contestada por el proveedor, la alerta se apaga sola', 'abiertas=' || n);

  -- Y un checkout mas viejo que la ventana de la sonda no puede gritar: nadie
  -- lo va a consultar nunca, asi que seria ruido permanente.
  declare v_viejo record; c2 uuid; s2 record;
  begin
    c2 := pg_temp.nuevo_usuario('p0-viejo');
    select * into s2 from pg_temp.hasta_preferencia(f.business_id, f.product_id, c2, 'p0vjo0001', 1);
    update public.checkout_sessions set status = 'redirected' where id = s2.session_id;
    perform pg_temp.envejecer(s2.session_id, interval '5 days', interval '5 days' - interval '15 minutes');
    perform public.sweep_expired_checkout_sessions();
    perform public.refresh_operational_alerts(f.business_id);
    select count(*)::integer into n from public.operational_alerts a
     where a.business_id = f.business_id and a.alert_code = 'CHECKOUT_PROVIDER_UNVERIFIED' and a.status = 'open';
    perform pg_temp.ok(n = 0, 'un checkout viejo fuera de la ventana no genera ruido', 'abiertas=' || n);
    -- El barrido es global, asi que se comprueba sobre ESTA sesion: otras
    -- sesiones del drill si son consultables y contarlas seria medir otra cosa.
    perform public.enqueue_checkout_provider_probes(200);
    select count(*)::integer into n from public.payment_outbox po
     where po.payment_intent_id = s2.intent_id and po.topic = 'payment_reconcile';
    perform pg_temp.ok(n = 0, 'y tampoco se lo consulta: las dos ventanas coinciden', 'sondas=' || n);
  end;
end $$;

-- ============================================================
-- Observabilidad: stock atrapado y webhook con firma rechazada
do $$
declare
  f record; c uuid; s record; n integer; h text := encode(gen_random_bytes(32), 'hex');
begin
  raise notice '';
  raise notice '===== OBSERVABILIDAD · STOCK ATRAPADO Y WEBHOOK MUDO =====';
  select * into f from pg_temp.fixture(10);
  c := pg_temp.nuevo_usuario('p0-atrap');
  select * into s from pg_temp.hasta_preferencia(f.business_id, f.product_id, c, 'p0atr0001', 4);
  -- La reserva vence y NADIE la libera: es el barrido caido.
  perform pg_temp.envejecer(s.session_id, interval '40 minutes', interval '25 minutes');
  perform set_config('request.jwt.claims', json_build_object('sub', f.owner_id::text, 'role', 'authenticated')::text, true);
  perform public.refresh_operational_alerts(f.business_id);
  select count(*)::integer into n from public.operational_alerts a
   where a.business_id = f.business_id and a.alert_code = 'STOCK_RESERVATION_STUCK' and a.status = 'open';
  perform pg_temp.ok(n = 1, 'el stock retenido por un checkout vencido se ve en el Panel', 'alertas=' || n);

  -- Y al liberarlo, la alerta se cierra sola.
  perform public.sweep_expired_checkout_sessions();
  perform public.refresh_operational_alerts(f.business_id);
  select count(*)::integer into n from public.operational_alerts a
   where a.business_id = f.business_id and a.alert_code = 'STOCK_RESERVATION_STUCK' and a.status = 'open';
  perform pg_temp.ok(n = 0, 'liberado el stock, la alerta se resuelve sola', 'abiertas=' || n);

  -- Firma rechazada: la via principal de cobro esta muerta y tiene que verse.
  perform public.record_mercadopago_webhook_receipt('test',
    'evt-badsig-' || right(replace(gen_random_uuid()::text, '-', ''), 10),
    'payment.updated', 'res-badsig', false, 'rq', h);
  select count(*)::integer into n from public.list_webhook_signature_alerts();
  perform pg_temp.ok(n >= 1, 'una notificacion con firma invalida queda visible', 'filas=' || n);
end $$;

-- ============================================================
-- La revision de seguridad se puede RESOLVER, y nada mas se afloja
do $$
declare
  v_owner uuid; v_business uuid := gen_random_uuid(); v_session uuid := gen_random_uuid();
  v_intent uuid := gen_random_uuid(); v_destino text; v_ok boolean;
begin
  raise notice '';
  raise notice '===== GUARDIAN · SALIR DE LA REVISION DE SEGURIDAD =====';
  v_owner := pg_temp.nuevo_usuario('p0-guard');
  insert into public.businesses (id, name, slug, status, is_active, ordering_enabled, ordering_verified,
    ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled, delivery_enabled, delivery_fee, minimum_delivery_subtotal)
  values (v_business, 'Guardian', 'guardian-' || right(replace(v_business::text,'-',''),8), 'open', true, true, true,
    clock_timestamp(), v_owner, 'ARS', true, true, 500.00, 0.00);
  insert into public.checkout_sessions (id, business_id, customer_id, client_request_id, normalized_intent_hash,
    fulfillment_type, address_snapshot, contact_snapshot, currency, subtotal, discount_total, delivery_fee, total,
    status, expires_at)
  values (v_session, v_business, v_owner, 'guard0001', repeat('a', 64), 'pickup', '{}'::jsonb,
    jsonb_build_object('name','Guardian'), 'ARS', 1000, 0, 0, 1000, 'manual_review_required', clock_timestamp() + interval '1 hour');
  insert into public.payment_intents (id, business_id, checkout_session_id, environment, currency,
    expected_amount, paid_amount, external_reference, internal_status, provider_status, security_review_reason)
  values (v_intent, v_business, v_session, 'test', 'ARS', 1000, 1000,
    'taba2:checkout:' || v_session::text, 'security_review_required', 'approved', 'approved_after_reservation_expired');

  -- Las cinco resoluciones tienen que estar permitidas.
  foreach v_destino in array array['refunded','partially_refunded','completed','approved_order_pending','charged_back'] loop
    v_ok := true;
    begin
      update public.payment_intents set internal_status = v_destino where id = v_intent;
      update public.payment_intents set internal_status = 'security_review_required' where id = v_intent;
    exception when others then v_ok := false;
    end;
    perform pg_temp.ok(v_ok, 'una revision se puede resolver hacia ' || v_destino);
  end loop;

  -- Y nada mas. Un destino cualquiera de rango menor sigue bloqueado.
  foreach v_destino in array array['pending','redirected','expired','rejected'] loop
    v_ok := false;
    begin
      update public.payment_intents set internal_status = v_destino where id = v_intent;
    exception when others then v_ok := true;
    end;
    perform pg_temp.ok(v_ok, 'sigue bloqueado retroceder a ' || v_destino);
  end loop;

  -- El resto de la escala no se aflojo: un pago normal no puede retroceder.
  update public.payment_intents set internal_status = 'security_review_required' where id = v_intent;
  update public.payment_intents set internal_status = 'completed' where id = v_intent;
  v_ok := false;
  begin
    update public.payment_intents set internal_status = 'pending' where id = v_intent;
  exception when others then v_ok := true;
  end;
  perform pg_temp.ok(v_ok, 'un pago completado tampoco puede retroceder a pending');
end $$;

-- ============================================================
-- El cobro que entró y se quedó sin reserva: rearmarlo desde el Panel
do $$
declare
  f record; c uuid; s record; r jsonb; n integer; st integer;
  fila record; encontrada boolean := false;
begin
  raise notice '';
  raise notice '===== RECUPERACION · ARMAR EL PEDIDO DE UN COBRO QUE ENTRO =====';
  select * into f from pg_temp.fixture(10);
  c := pg_temp.nuevo_usuario('p0-recup');
  select * into s from pg_temp.hasta_preferencia(f.business_id, f.product_id, c, 'p0rec0001', 3);
  perform pg_temp.envejecer(s.session_id, interval '20 minutes', interval '5 minutes');
  perform public.sweep_expired_checkout_sessions();
  select stock into st from public.products where id = f.product_id;
  perform pg_temp.ok(st = 10, 'el barrido devolvio el stock antes del cobro tardio', 'stock=' || st);

  r := public.record_mercadopago_payment_snapshot(s.intent_id, pg_temp.snapshot(s.session_id, 3000.00, clock_timestamp()), 'reconciliation', null);
  perform pg_temp.ok(r ->> 'manual_review_required' = 'true', 'queda en revision manual: dinero adentro, sin pedido');

  -- El Panel tiene que ofrecer la accion.
  perform set_config('request.jwt.claims', json_build_object('sub', f.owner_id::text, 'role', 'authenticated')::text, true);
  for fila in select value from public.list_business_payments(f.business_id) value loop
    if (fila.value ->> 'payment_intent_id')::uuid = s.intent_id then
      encontrada := true;
      perform pg_temp.ok((fila.value ->> 'can_recover_order')::boolean,
        'el Panel ofrece armar el pedido de este cobro');
    end if;
  end loop;
  perform pg_temp.ok(encontrada, 'el cobro figura en la consulta del Panel');

  -- Y armarlo tiene que funcionar de verdad.
  r := public.recover_paid_checkout_order(s.session_id);
  perform pg_temp.ok(r ->> 'ok' = 'true', 'el pedido se arma', coalesce(r ->> 'reason', r ->> 'order_code'));
  select count(*)::integer into n from public.orders where business_id = f.business_id;
  perform pg_temp.ok(n = 1, 'existe exactamente un pedido', 'pedidos=' || n);
  select stock into st from public.products where id = f.product_id;
  perform pg_temp.ok(st = 7, 'el stock se descuenta una sola vez al rearmar', 'stock=' || st);
  select count(*)::integer into n from public.inventory_reservations
   where checkout_session_id = s.session_id and status = 'converted';
  perform pg_temp.ok(n = 1, 'la reserva nueva queda convertida', 'convertidas=' || n);

  -- Tocarlo dos veces no puede crear un segundo pedido.
  r := public.recover_paid_checkout_order(s.session_id);
  select count(*)::integer into n from public.orders where business_id = f.business_id;
  perform pg_temp.ok(r ->> 'idempotent' = 'true' and n = 1, 'rearmarlo de nuevo es idempotente', 'pedidos=' || n);
end $$;

do $$
declare
  f record; c uuid; c2 uuid; s record; s2 record; r jsonb; n integer; st integer;
begin
  raise notice '';
  raise notice '===== RECUPERACION · CUANDO YA NO HAY STOCK, NO SE INVENTA =====';
  select * into f from pg_temp.fixture(4);
  c := pg_temp.nuevo_usuario('p0-sinstock');
  select * into s from pg_temp.hasta_preferencia(f.business_id, f.product_id, c, 'p0sst0001', 4);
  perform pg_temp.envejecer(s.session_id, interval '20 minutes', interval '5 minutes');
  perform public.sweep_expired_checkout_sessions();
  -- Mientras tanto, otra persona se lleva todo el stock.
  c2 := pg_temp.nuevo_usuario('p0-otro');
  select * into s2 from pg_temp.hasta_preferencia(f.business_id, f.product_id, c2, 'p0sst0002', 4);
  select stock into st from public.products where id = f.product_id;
  perform pg_temp.ok(st = 0, 'otro cliente se llevo el stock', 'stock=' || st);

  r := public.record_mercadopago_payment_snapshot(s.intent_id, pg_temp.snapshot(s.session_id, 4000.00, clock_timestamp()), 'reconciliation', null);
  perform pg_temp.ok(r ->> 'manual_review_required' = 'true', 'el cobro tardio queda en revision');

  perform set_config('request.jwt.claims', json_build_object('sub', f.owner_id::text, 'role', 'authenticated')::text, true);
  r := public.recover_paid_checkout_order(s.session_id);
  perform pg_temp.ok(r ->> 'ok' = 'false' and r ->> 'reason' = 'stock_insuficiente',
    'se niega a armar un pedido que no se puede cumplir', r ->> 'reason');
  perform pg_temp.ok(jsonb_array_length(r -> 'missing') = 1, 'y dice exactamente que falta',
    (r -> 'missing' -> 0 ->> 'name') || ': hay ' || (r -> 'missing' -> 0 ->> 'disponibles'));
  select count(*)::integer into n from public.orders where business_id = f.business_id;
  perform pg_temp.ok(n = 0, 'no se creo ningun pedido', 'pedidos=' || n);
  select stock into st from public.products where id = f.product_id;
  perform pg_temp.ok(st = 0, 'y el stock del otro cliente quedo intacto', 'stock=' || st);
  perform pg_temp.ok(
    (select (value ->> 'can_refund')::boolean from public.list_business_payments(f.business_id) value
      where (value ->> 'payment_intent_id')::uuid = s.intent_id),
    'la salida que queda -devolver el dinero- esta disponible');
end $$;

do $$ begin raise notice ''; raise notice '===== TODOS LOS P0 VERDES ====='; end $$;
