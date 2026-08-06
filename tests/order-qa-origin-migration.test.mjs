import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (name) => fs.readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');

const origin = read('20260806160000_order_qa_origin_classification.sql');
const modality = read('20260806170000_order_payment_modality_integrity.sql');
const sweep = read('20260806180000_checkout_expiry_stock_recovery.sql');
const pipeline = read('20260806190000_operational_pipeline_projection.sql');
const silence = read('20260806200000_qa_orders_do_not_ring_the_panel.sql');
const manual = read('20260806210000_manual_qa_reclassification.sql');
const riderClaim = read('20260806220000_rider_canonical_claim_excludes_qa.sql');
const lockdown = read('20260806230000_lock_down_classification_triggers.sql');

const all = [origin, modality, sweep, pipeline, silence, manual, riderClaim, lockdown];
const branch = all.join('\n');

test('ninguna migración destruye evidencia', () => {
  for (const sql of all) {
    assert.doesNotMatch(sql, /drop table|truncate table/i);
    assert.doesNotMatch(sql, /delete from public[.](orders|order_items|order_events|checkout_sessions|payment_intents|rider_locations)/i);
  }
});

test('la clasificación QA sale del catálogo, nunca del navegador', () => {
  assert.match(origin, /catalog_origin in \('test_only', 'staging_only'\)/);
  // `demo_fixture` es el catálogo de demostración comercial: marcarlo QA
  // escondería pedidos legítimos de la operación.
  assert.doesNotMatch(origin, /catalog_origin in \([^)]*'demo_fixture'/);
  assert.match(origin, /create or replace function public[.]product_is_qa_fixture/);
});

test('la clasificación es de una sola dirección', () => {
  // Se promueve production -> qa y nada la devuelve.
  assert.match(origin, /set origin = 'qa'[\s\S]{0,400}?and o[.]origin <> 'qa'/);
  assert.doesNotMatch(origin, /set origin = 'production'/);
  assert.doesNotMatch(manual, /set origin = 'production'/);
  assert.match(manual, /if v_order[.]origin = 'qa' then[\s\S]{0,300}idempotent_no_op', true/);
});

test('reclasificar no mueve la revisión ni el estado operativo', () => {
  assert.match(origin, /create or replace function public[.]bump_order_revision/);
  assert.match(origin, /new[.]origin, new[.]origin_reason, new[.]origin_classified_at\)\s*\n\s*is distinct from \(old[.]origin, old[.]origin_reason, old[.]origin_classified_at\)/);
  // Cualquier update que además toque un campo operativo conserva el bump.
  assert.match(origin, /if new is distinct from old then\s*\n\s*new[.]revision := old[.]revision \+ 1;/);
  for (const forbidden of [/set[\s\S]{0,80}status = /, /assigned_rider_user_id =/]) {
    assert.doesNotMatch(manual.slice(manual.indexOf('update public.orders'), manual.indexOf('update public.notification_outbox')), forbidden);
  }
});

test('el rider nunca recibe un pedido QA', () => {
  for (const fn of ['get_rider_queue', 'list_available_rider_orders']) {
    const block = origin.slice(origin.indexOf(`function public.${fn}`));
    assert.match(block.slice(0, 3000), /o[.]origin = 'production'/, `${fn} debería filtrar por origen`);
  }
  // El claim canónico es claim_delivery_order; la sobrecarga legacy quedó
  // revocada en 20260802102000 y no alcanza como única defensa.
  assert.match(riderClaim, /create or replace function public[.]claim_delivery_order/);
  assert.match(riderClaim, /if v_order[.]origin <> 'production' then\s*\n\s*return jsonb_build_object\('ok', false, 'code', 'not_available'\);/);
});

test('un pedido QA no suena en el Panel pero deja rastro', () => {
  assert.match(silence, /state = 'processed'/);
  assert.match(silence, /'suppressed_reason', 'qa_origin_order'/);
  // Se cierra el aviso, no se lo borra.
  assert.doesNotMatch(silence, /delete from public[.]notification_outbox/i);
});

test('la modalidad de pago es obligatoria y Mercado Pago es verificable', () => {
  assert.match(modality, /alter column payment_method set not null/);
  assert.match(modality, /payment_method in \('mercadopago', 'cash', 'coordinate', 'qa_no_charge'\)/);
  assert.match(modality, /payment_method <> 'qa_no_charge' or origin = 'qa'/);
  // La atadura con el pago real se valida al COMMIT, porque la finalización
  // liga el intent después de insertar el pedido.
  assert.match(modality, /create constraint trigger orders_assert_payment_modality[\s\S]{0,200}deferrable initially deferred/);
  assert.match(modality, /pi[.]internal_status = 'completed'/);
});

test('el stock de un checkout abandonado vuelve solo', () => {
  assert.match(sweep, /cron[.]schedule\(\s*\n?\s*'taba-checkout-expiry-sweep'/);
  assert.match(sweep, /create or replace function public[.]sweep_expired_checkout_sessions/);
  assert.match(sweep, /public[.]expire_checkout_sessions\(200\)/);
  // Y si el barrido deja de correr, tiene que gritar.
  assert.match(sweep, /create or replace function public[.]list_stock_reservation_alerts/);
  assert.match(sweep, /r[.]status = 'active'\s*\n\s*and r[.]expires_at < clock_timestamp\(\) - interval '5 minutes'/);
});

test('el vocabulario canónico cubre los estados del circuito', () => {
  const required = [
    'pending', 'paid', 'received', 'accepted', 'assigned',
    'picked_up', 'delivered', 'cancelled', 'rejected', 'expired',
  ];
  for (const state of required) {
    assert.match(pipeline, new RegExp(`'${state}'`), `falta el estado ${state}`);
  }
  // La proyección traduce; no inventa transiciones ni toca orders.status.
  assert.doesNotMatch(pipeline, /update public[.]orders/i);
  assert.match(pipeline, /create or replace function public[.]order_pipeline_state/);
  assert.match(pipeline, /create or replace function public[.]checkout_pipeline_state/);
});

test('el circuito operativo excluye QA salvo pedido explícito', () => {
  assert.match(pipeline, /p_include_qa boolean default false/);
  assert.match(pipeline, /coalesce\(p_include_qa, false\) or o[.]origin = 'production'/);
  assert.match(pipeline, /coalesce\(p_include_qa, false\) or s[.]origin = 'production'/);
  assert.match(pipeline, /has_business_role\(p_business_id, array\['owner', 'admin', 'staff'\]\)/);
});

test('un pago verificado sin pedido es una alerta, no un silencio', () => {
  assert.match(pipeline, /create or replace function public[.]list_unfinalized_paid_checkouts/);
  assert.match(pipeline, /pi[.]provider_status = 'approved'/);
  assert.match(pipeline, /s[.]completed_order_id is null/);
});

test('las funciones nuevas cierran search_path y permisos', () => {
  const definers = [
    [origin, 'product_is_qa_fixture'],
    [origin, 'classify_order_qa_origin'],
    [sweep, 'sweep_expired_checkout_sessions'],
    [sweep, 'list_stock_reservation_alerts'],
    [pipeline, 'list_operational_pipeline'],
    [pipeline, 'list_unfinalized_paid_checkouts'],
    [manual, 'classify_order_as_qa'],
  ];
  for (const [sql, fn] of definers) {
    const block = sql.slice(sql.indexOf(`function public.${fn}`));
    assert.match(block.slice(0, 600), /set search_path = pg_catalog, public/, `${fn} debería fijar search_path`);
  }
  // Ninguna `security definer` de la rama queda con el execute PUBLIC que
  // PostgreSQL otorga por defecto.
  for (const [, fn] of [...definers, [null, 'classify_checkout_session_qa_origin']]) {
    assert.match(branch, new RegExp(`revoke all on function public[.]${fn}`), `${fn} debería revocar el execute por defecto`);
  }
});

test('la reclasificación manual exige rol del negocio y motivo auditable', () => {
  assert.match(manual, /has_business_role\(v_order[.]business_id, array\['owner', 'admin'\]\)/);
  assert.match(manual, /v_reason !~ '\^\[a-z0-9_\]\+\$'/);
  assert.match(manual, /event_type[\s\S]{0,400}'order[.]origin_classified'/);
});
