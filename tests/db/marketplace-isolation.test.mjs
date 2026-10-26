/*
 * R-MKT: aislamiento financiero entre dos comercios del mismo marketplace, medido en la base real.
 *
 * Dos comercios (A y B) con su dueño, su producto, su stock y su vendedor (`collector_id`) propios, en una sola
 * transacción que siempre termina en rollback. Mercado Pago está simulado (los snapshots los arma esta prueba y se
 * entregan a las funciones SQL reales), así que lo que se mide es la regla de la base, no al proveedor.
 *
 * Lo que fija:
 *   - un pago cobrado por el vendedor de A NO acredita el checkout de B (collector_mismatch): ni pedido, ni cierre
 *     de la reserva, ni descuento de stock en ninguno de los dos;
 *   - el pago legítimo de B crea UN pedido, en B, y mueve el stock de B solamente;
 *   - el dueño de A no puede iniciar la devolución del pago de B (42501) y el de B sí;
 *   - con el rol `authenticated` y las políticas RLS, el dueño de A no ve pedidos, intentos de pago, checkouts,
 *     devoluciones ni reservas de B (y el dueño de B sí los ve: la prueba no es vacía).
 *
 * Requiere el clúster descartable de scripts/local-db (TABA_PG_BIN) y una base taba_local_*.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { psqlRaw } from '../../scripts/local-db/lib.mjs';
import { DB } from './harness.mjs';

const SQL = String.raw`
begin;
set local statement_timeout = '90s';
set local search_path = public, extensions;
create temp table iso_out(k text, v jsonb);

create function pg_temp.uid(s text) returns uuid language sql as $$ select ('10000000-0000-4000-8000-0000000000' || s)::uuid $$;
create function pg_temp.bid(s text) returns uuid language sql as $$ select ('20000000-0000-4000-8000-0000000000' || s)::uuid $$;
create function pg_temp.pid(s text) returns uuid language sql as $$ select ('30000000-0000-4000-8000-0000000000' || s)::uuid $$;
create function pg_temp.aid(s text) returns uuid language sql as $$ select ('40000000-0000-4000-8000-0000000000' || s)::uuid $$;

create function pg_temp.mk(s text) returns void language plpgsql as $f$
declare
  v_user uuid := pg_temp.uid(s); v_business uuid := pg_temp.bid(s);
  v_product uuid := pg_temp.pid(s); v_asset uuid := pg_temp.aid(s);
  v_mh text := repeat('b', 64); v_th text := repeat('c', 64); v_sh text := repeat('d', 64);
  v_identity text; v_mp text; v_tp text;
begin
  insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v_user, 'authenticated', 'authenticated', 'iso-' || s || '@example.invalid', '', '{}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp());
  insert into public.businesses (id, name, slug, status, is_active, ordering_enabled, ordering_verified,
    ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled)
  values (v_business, 'Aislamiento ' || s, 'aislamiento-' || s, 'open', true, true, true, clock_timestamp(), v_user, 'ARS', true);
  v_identity := public.catalog_image_identity_sha256('iso-ext-' || s, 'iso-sku-' || s, v_sh);
  v_mp := public.catalog_asset_path('iso-sku-' || s, v_identity, 'master', v_mh);
  v_tp := public.catalog_asset_path('iso-sku-' || s, v_identity, 'thumbnail', v_th);
  insert into public.catalog_assets (id, business_id, external_id, sku, safe_sku, identity_sha256, master_path,
    master_sha256, master_binding_sha256, thumbnail_path, thumbnail_sha256, thumbnail_binding_sha256, source_sha256,
    source_url, rights_status, rights_reference, approved_at, approved_by, catalog_origin)
  values (v_asset, v_business, 'iso-ext-' || s, 'iso-sku-' || s, 'iso-sku-' || s, v_identity, v_mp, v_mh,
    public.catalog_asset_binding_sha256(v_identity, 'master', v_sh, v_mh, 1000, 1000, v_mp),
    v_tp, v_th,
    public.catalog_asset_binding_sha256(v_identity, 'thumbnail', v_sh, v_th, 400, 400, v_tp),
    v_sh, 'https://example.invalid/iso.webp', 'UNAPPROVED_QA', 'isolated local fixture', null, null, 'test_only');
  insert into public.products (id, business_id, name, description, category, price, image_url, is_active,
    brand, subcategory, presentation, capacity, packaging_type, stock, available, is_alcoholic, is_verified, chilled,
    units_per_pack, external_id, sku, catalog_asset_id, image_sha256, image_thumbnail_url, image_thumbnail_sha256,
    source_image_sha256, variant, capacity_value, capacity_unit, catalog_origin, price_status)
  values (v_product, v_business, 'Bebida ' || s, 'Fixture local aislado', 'Gaseosas', 1250.00, v_mp, true,
    'TABA2 QA', 'Cola', 'Botella 1 l', '1 l', 'botella', 10, true, false, true, false, 1, 'iso-ext-' || s, 'iso-sku-' || s,
    v_asset, v_mh, v_tp, v_th, v_sh, 'Botella 1 l', 1, 'l', 'test_only', 'confirmed');
  insert into public.business_payment_settings (business_id, enabled, environment, checkout_mode, currency, reserve_stock,
    collector_id, application_id, configured_at, verified_at)
  values (v_business, true, 'test', 'checkout_pro', 'ARS', true, 'collector-' || s, 'application-iso', clock_timestamp(), clock_timestamp());
end $f$;

create function pg_temp.buy(s text, req text, qty integer, pref text) returns jsonb language plpgsql as $f$
declare v_result jsonb; v_session uuid; v_prepare jsonb; v_intent uuid;
begin
  v_result := public.create_checkout_session(pg_temp.uid(s), jsonb_build_object(
    'business_id', pg_temp.bid(s), 'client_request_id', req,
    'items', jsonb_build_array(jsonb_build_object('product_id', pg_temp.pid(s), 'quantity', qty)),
    'fulfillment_type', 'pickup', 'contact', jsonb_build_object('name', 'Cliente Aislamiento', 'phone', '5491100000000'),
    'address', '{}'::jsonb, 'age_confirmed', false, 'payment_method', 'mercadopago'));
  v_session := (v_result ->> 'checkout_session_id')::uuid;
  v_prepare := public.prepare_mercadopago_preference(v_session, pg_temp.uid(s), false);
  perform public.record_mercadopago_preference_created((v_prepare ->> 'payment_attempt_id')::uuid, pref,
    'https://www.mercadopago.com/checkout/v1/redirect?pref_id=' || pref, null, repeat('e', 64), 'request-iso');
  select id into v_intent from public.payment_intents where checkout_session_id = v_session;
  return jsonb_build_object('session', v_session, 'intent', v_intent);
end $f$;

create function pg_temp.snap(p_buy jsonb, collector text, pay_id text, pref text, amount text) returns jsonb language sql as $f$
  select public.record_mercadopago_payment_snapshot((p_buy ->> 'intent')::uuid, jsonb_build_object(
    'provider_payment_id', pay_id, 'external_reference', 'taba2:checkout:' || (p_buy ->> 'session'),
    'preference_id', pref, 'merchant_order_id', 'MO-' || pay_id, 'collector_id', collector, 'currency', 'ARS',
    'transaction_amount', amount, 'status', 'approved', 'status_detail', 'accredited', 'payment_method', 'visa',
    'live_mode', true, 'provider_occurred_at', clock_timestamp()::text, 'refunded_amount', '0.00',
    'payer_email_hash', repeat('f', 64), 'raw_response_hash', repeat('1', 64)), 'reconciliation', null)
$f$;

create function pg_temp.act(s text) returns void language plpgsql as $f$
declare v_key uuid := gen_random_uuid();
begin
  insert into public.business_members(business_id, user_id, role, is_active)
  select pg_temp.bid(s), pg_temp.uid(s), 'owner', true
   where not exists (select 1 from public.business_members m where m.business_id = pg_temp.bid(s) and m.user_id = pg_temp.uid(s));
  perform set_config('request.jwt.claim.sub', pg_temp.uid(s)::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.uid(s), 'role', 'authenticated',
    'session_id', v_key, 'iat', extract(epoch from clock_timestamp()))::text, true);
  insert into public.identity_sessions(session_id, user_id, business_id, role_at_login, client)
  values (v_key, pg_temp.uid(s), pg_temp.bid(s), 'owner', 'panel_web');
end $f$;

create function pg_temp.stock(s text) returns integer language sql as $$ select stock from public.products where id = pg_temp.pid(s) $$;
create function pg_temp.orders_of(s text) returns integer language sql as $$ select count(*)::integer from public.orders where business_id = pg_temp.bid(s) $$;

-- Lo que el dueño de un comercio VE de otro, con el rol y las políticas reales. -1 = acceso denegado (42501).
create function pg_temp.vis(tbl text, cond text) returns integer language plpgsql as $f$
declare n integer;
begin
  execute format('select count(*)::integer from public.%I where %s', tbl, cond) into n;
  return n;
exception when insufficient_privilege then return -1;
end $f$;

-- El Panel lee los pagos por la función del negocio, no por las tablas. Devuelve filas visibles o el SQLSTATE.
create function pg_temp.panel_payments(p_business uuid) returns jsonb language plpgsql as $f$
declare n integer;
begin
  execute format('select count(*)::integer from public.list_business_payments(%L)', p_business) into n;
  return jsonb_build_object('rows', n);
exception when others then return jsonb_build_object('rows', 0, 'sqlstate', SQLSTATE);
end $f$;

do $t$
declare
  v_b1 jsonb; v_b2 jsonb; v_r jsonb; v_a_before integer; v_state text;
  v_a_seen jsonb := '{}'::jsonb; v_b_seen jsonb := '{}'::jsonb; v_a_panel jsonb; v_b_panel jsonb;
  v_conds text[][];
  i integer;
begin
  perform pg_temp.mk('a1'); perform pg_temp.mk('b1');
  insert into iso_out values ('initial', jsonb_build_object('stockA', pg_temp.stock('a1'), 'stockB', pg_temp.stock('b1')));

  -- 1) B abre un checkout de 2 unidades: la reserva descuenta el stock de B y sólo el de B.
  v_b1 := pg_temp.buy('b1', 'isob000000000001', 2, 'PREF-ISO-1');
  insert into iso_out values ('after_reserve_b', jsonb_build_object('stockA', pg_temp.stock('a1'), 'stockB', pg_temp.stock('b1')));

  -- 2) Un pago aprobado COBRADO POR EL VENDEDOR DE A se entrega a la intención de B.
  begin
    v_r := pg_temp.snap(v_b1, 'collector-a1', '992000001', 'PREF-ISO-1', '2500.00');
    insert into iso_out values ('mismatch_result', coalesce(v_r, '{}'::jsonb));
  exception when others then
    insert into iso_out values ('mismatch_result', jsonb_build_object('error', SQLSTATE));
  end;
  begin
    perform public.finalize_paid_checkout_session((v_b1 ->> 'session')::uuid);
    insert into iso_out values ('mismatch_finalize', jsonb_build_object('raised', false));
  exception when others then
    insert into iso_out values ('mismatch_finalize', jsonb_build_object('raised', true, 'sqlstate', SQLSTATE));
  end;
  insert into iso_out select 'after_mismatch', jsonb_build_object('ordersA', pg_temp.orders_of('a1'), 'ordersB', pg_temp.orders_of('b1'),
    'stockA', pg_temp.stock('a1'), 'stockB', pg_temp.stock('b1'),
    'intent', (select internal_status from public.payment_intents where id = (v_b1 ->> 'intent')::uuid),
    'session', (select status from public.checkout_sessions where id = (v_b1 ->> 'session')::uuid));

  -- 3) El pago legítimo de B (cobrado por su vendedor) en otro checkout de 1 unidad.
  v_b2 := pg_temp.buy('b1', 'isob000000000002', 1, 'PREF-ISO-2');
  v_r := pg_temp.snap(v_b2, 'collector-b1', '992000002', 'PREF-ISO-2', '1250.00');
  if (v_r ->> 'finalize_required')::boolean then
    perform public.finalize_paid_checkout_session((v_b2 ->> 'session')::uuid);
  end if;
  set constraints all immediate;
  insert into iso_out select 'after_legit_b', jsonb_build_object('ordersA', pg_temp.orders_of('a1'), 'ordersB', pg_temp.orders_of('b1'),
    'stockA', pg_temp.stock('a1'), 'stockB', pg_temp.stock('b1'),
    'order_business_ok', (select bool_and(o.business_id = pg_temp.bid('b1')) from public.orders o where o.id in (
      select completed_order_id from public.checkout_sessions where id = (v_b2 ->> 'session')::uuid)),
    'intent', (select internal_status from public.payment_intents where id = (v_b2 ->> 'intent')::uuid));

  -- 4) Devoluciones: el dueño de A contra el pago de B, y el dueño de B contra el suyo.
  perform pg_temp.act('a1');
  begin
    v_r := public.prepare_payment_refund_v2((v_b2 ->> 'intent')::uuid, null, gen_random_uuid(), 'isolation');
    insert into iso_out values ('refund_by_A', jsonb_build_object('allowed', true));
  exception when others then
    insert into iso_out values ('refund_by_A', jsonb_build_object('allowed', false, 'sqlstate', SQLSTATE));
  end;
  insert into iso_out select 'refund_rows_after_A', jsonb_build_object('n',
    (select count(*) from public.payment_refunds where payment_intent_id = (v_b2 ->> 'intent')::uuid));
  perform pg_temp.act('b1');
  begin
    v_r := public.prepare_payment_refund_v2((v_b2 ->> 'intent')::uuid, null, gen_random_uuid(), 'isolation');
    insert into iso_out values ('refund_by_B', jsonb_build_object('allowed', v_r ? 'refund_id'));
  exception when others then
    insert into iso_out values ('refund_by_B', jsonb_build_object('allowed', false, 'sqlstate', SQLSTATE));
  end;

  -- 5) Visibilidad con el rol real y RLS: lo de B según el dueño de A y según el dueño de B.
  v_conds := array[
    ['orders', format('business_id = %L', pg_temp.bid('b1'))],
    ['payment_intents', format('business_id = %L', pg_temp.bid('b1'))],
    ['checkout_sessions', format('business_id = %L', pg_temp.bid('b1'))],
    ['payment_refunds', format('payment_intent_id = %L', (v_b2 ->> 'intent')::uuid)],
    ['inventory_reservations', format('checkout_session_id in (%L, %L)', (v_b1 ->> 'session')::uuid, (v_b2 ->> 'session')::uuid)]];
  perform pg_temp.act('a1');
  set local role authenticated;
  for i in 1 .. array_length(v_conds, 1) loop
    v_a_seen := v_a_seen || jsonb_build_object(v_conds[i][1], pg_temp.vis(v_conds[i][1], v_conds[i][2]));
  end loop;
  v_a_panel := pg_temp.panel_payments(pg_temp.bid('b1'));
  reset role;
  perform pg_temp.act('b1');
  set local role authenticated;
  for i in 1 .. array_length(v_conds, 1) loop
    v_b_seen := v_b_seen || jsonb_build_object(v_conds[i][1], pg_temp.vis(v_conds[i][1], v_conds[i][2]));
  end loop;
  v_b_panel := pg_temp.panel_payments(pg_temp.bid('b1'));
  reset role;
  insert into iso_out values ('seen_by_A', v_a_seen), ('seen_by_B', v_b_seen), ('panel_payments_A', v_a_panel), ('panel_payments_B', v_b_panel);
end $t$;

select jsonb_object_agg(k, v)::text from iso_out;
rollback;
`;

let evidence;
function run() {
  if (evidence) return evidence;
  const r = psqlRaw(DB, SQL, { tuples: true, timeout: 240000 });
  const line = r.stdout.split('\n').map((s) => s.trim()).filter((s) => s.startsWith('{')).pop();
  assert.ok(line, `la prueba no produjo evidencia: ${r.stdout.slice(0, 400)}`);
  evidence = JSON.parse(line);
  if (process.env.TABA_DEBUG_ISOLATION) console.log(JSON.stringify(evidence, null, 1));
  return evidence;
}

test('R-MKT: un pago cobrado por el vendedor de A no acredita el checkout de B', () => {
  const e = run();
  assert.deepEqual(e.initial, { stockA: 10, stockB: 10 });
  assert.deepEqual(e.after_reserve_b, { stockA: 10, stockB: 8 }, 'la reserva de B no toca el stock de A');
  // El snapshot con otro cobrador se registra como inválido (o se rechaza), pero nunca cierra el checkout.
  assert.notEqual(e.after_mismatch.intent, 'completed', JSON.stringify(e.after_mismatch));
  assert.notEqual(e.after_mismatch.session, 'completed', JSON.stringify(e.after_mismatch));
  assert.equal(e.after_mismatch.ordersA, 0);
  assert.equal(e.after_mismatch.ordersB, 0, 'ningún pedido de B por el pago de otro vendedor');
  assert.equal(e.after_mismatch.stockA, 10);
});

test('R-MKT: el pago legítimo de B crea un pedido en B y mueve sólo el stock de B', () => {
  const e = run();
  assert.equal(e.after_legit_b.intent, 'completed', JSON.stringify(e.after_legit_b));
  assert.equal(e.after_legit_b.ordersA, 0, 'A no recibe ningún pedido');
  assert.equal(e.after_legit_b.ordersB, 1, 'B recibe exactamente uno');
  assert.equal(e.after_legit_b.order_business_ok, true);
  assert.equal(e.after_legit_b.stockA, 10, 'el stock de A no se mueve');
});

test('R-MKT: devoluciones — el dueño de A no puede devolver el pago de B; el de B sí', () => {
  const e = run();
  assert.deepEqual(e.refund_by_A, { allowed: false, sqlstate: '42501' });
  assert.equal(e.refund_rows_after_A.n, 0, 'el intento de A no deja ninguna fila de devolución');
  assert.deepEqual(e.refund_by_B, { allowed: true });
});

test('R-MKT: con RLS, el dueño de A no ve nada de B y el dueño de B sí ve lo suyo', () => {
  const e = run();
  for (const [table, count] of Object.entries(e.seen_by_A)) {
    assert.ok(count <= 0, `A no debe ver ${table} de B (vio ${count}; -1 = acceso denegado)`);
  }
  assert.ok(e.seen_by_B.orders >= 1, `la prueba no es vacía: B ve su pedido ${JSON.stringify(e.seen_by_B)}`);
});

test('R-MKT: el listado de pagos del Panel de B no le sirve nada al dueño de A', () => {
  const e = run();
  // Las tablas de pago no se leen directo con el rol del Panel (acceso denegado para los dos): se leen por esta función.
  assert.equal(e.panel_payments_A.rows, 0, `A no debe listar los pagos de B: ${JSON.stringify(e.panel_payments_A)}`);
  assert.ok(e.panel_payments_B.rows >= 1, `la prueba no es vacía: B lista sus pagos ${JSON.stringify(e.panel_payments_B)}`);
});
