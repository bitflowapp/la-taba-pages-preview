// Conciliación de pagos La Taba ↔ Mercado Pago.
//
// POR QUÉ ESTOS TESTS
// -------------------
// La herramienta mira plata. Dos errores son inaceptables y son los que este
// archivo ata: decir «todo coincide» de algo que no se comparó, y poder escribir
// —en la base o en el proveedor— aunque sea por accidente. El resto fija cada
// código de hallazgo con un caso que produce ESE hallazgo y ningún otro.
//
// Todo corre con datos armados acá: ni la base ni Mercado Pago se tocan.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ALL_CODES, FINDING_CODES, INTEGRATION_REFERENCE, INTERNAL_STATUS_RANK, PROVIDER_STATUS_MAP, UNVERIFIED_CODE,
  classify, normalizeProviderPayment, pickAuthoritativePayment, referencesNeedingExplicitLookup, statusVerdict, toCents,
} from '../scripts/payments/reconciliation/classify.mjs';
import {
  TARGET_REFS, assertReadOnlySql, assertTokenEnvName, buildLocalSnapshotSql, createExportProvider,
  createManagementApiRunner, createMercadoPagoSearchProvider, loadLocalRows, mergeProviderRows, providerRowsFromExport,
  readOnlyRunner, resolveTarget,
} from '../scripts/payments/reconciliation/sources.mjs';
import { EXIT, parseReconcileArgs, reconcile, renderSummary, runCli } from '../scripts/payments/reconcile-payments.mjs';

const TOOL_FILES = ['scripts/payments/reconciliation/classify.mjs', 'scripts/payments/reconciliation/sources.mjs',
  'scripts/payments/reconcile-payments.mjs'];
const source = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

// ── Datos de prueba ──────────────────────────────────────────────────────────
const BUSINESS = 'a57b1c20-0f4e-4a6b-9d31-7c2e5f8a41d0';
const NOW = '2026-10-01T15:00:00.000Z';
const FROM = '2026-09-24T15:00:00.000Z';
const uuid = (kind, n) => `${String(kind).repeat(8)}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const intentId = (n) => uuid(1, n);
const sessionId = (n) => uuid(2, n);
const orderId = (n) => uuid(3, n);
const refundId = (n) => uuid(4, n);
const reference = (n) => `taba2:checkout:${sessionId(n)}`;
const paymentId = (n) => String(7_000_000_000 + n);
const minutesAgo = (minutes) => new Date(Date.parse(NOW) - minutes * 60_000).toISOString();

// Datos personales que un pago de Mercado Pago trae y que NO pueden salir.
const PAYER_PII = Object.freeze({
  payer: { email: 'cliente.real@example.com', first_name: 'Marina', last_name: 'Quiroga', phone: { area_code: '299', number: '4123456' },
    identification: { type: 'DNI', number: '30111222' } },
  card: { last_four_digits: '4242', first_six_digits: '450995', cardholder: { name: 'MARINA QUIROGA' } },
  additional_info: { payer: { address: { street_name: 'Avenida Argentina', street_number: 1234 } }, ip_address: '190.55.10.20' },
  description: 'Pedido de Marina Quiroga',
});
const PII_PATTERN = /Marina|Quiroga|cliente\.real|4123456|30111222|4242|450995|Avenida Argentina|190\.55\.10\.20|Calle Falsa/i;

function intent(n, overrides = {}) {
  return {
    payment_intent_id: intentId(n), checkout_session_id: sessionId(n), business_id: BUSINESS, order_id: null,
    environment: 'production', external_reference: reference(n), provider_payment_id: null, provider_status: null,
    provider_status_detail: null, internal_status: 'preference_created', currency: 'ARS', expected_amount: '15000.00',
    paid_amount: null, refunded_amount: '0.00', approved_at: null, provider_event_at: null, security_review_reason: null,
    created_at: '2026-10-01T10:00:00+00:00', updated_at: '2026-10-01T10:01:00+00:00', in_window: true,
    session_status: 'redirected', session_total: '15000.00', session_completed_order_id: null,
    session_expires_at: '2026-10-01T10:15:00+00:00', approved_provider_payment_ids: [], request_order_ids: [],
    ...overrides,
  };
}

function paidIntent(n, overrides = {}) {
  return intent(n, {
    order_id: orderId(n), provider_payment_id: paymentId(n), provider_status: 'approved', provider_status_detail: 'accredited',
    internal_status: 'completed', paid_amount: '15000.00', approved_at: '2026-10-01T10:03:00+00:00',
    provider_event_at: '2026-10-01T10:03:00+00:00', updated_at: '2026-10-01T10:03:05+00:00', session_status: 'completed',
    session_completed_order_id: orderId(n), approved_provider_payment_ids: [paymentId(n)], request_order_ids: [orderId(n)],
    ...overrides,
  });
}

function order(n, overrides = {}) {
  return {
    order_id: orderId(n), business_id: BUSINESS, public_code: `TB-${1000 + n}`, status: 'delivered', payment_method: 'mercadopago',
    total: '15000.00', origin: 'production', created_at: '2026-10-01T10:03:05+00:00', in_window: true, ...overrides,
  };
}

function mpPayment(n, overrides = {}) {
  return {
    id: Number(paymentId(n)), external_reference: reference(n), status: 'approved', status_detail: 'accredited',
    transaction_amount: 15000, transaction_amount_refunded: 0, currency_id: 'ARS',
    date_created: '2026-10-01T07:02:00.000-03:00', date_approved: '2026-10-01T07:03:00.000-03:00',
    date_last_updated: '2026-10-01T07:03:00.000-03:00', collector_id: 246813579, live_mode: true, refunds: [],
    ...PAYER_PII, ...overrides,
  };
}

const localRows = (parts = {}) => ({
  business_id: BUSINESS, server_time: NOW, settings: { collector_id: '246813579', environment: 'production', enabled: true },
  intents: [], orders: [], refunds: [], disputes: [], looked_up_references: [], ...parts,
});
const providerRows = (payments = [], coverage = {}) => ({
  payments, coverage: { mode: 'api', complete: true, range: { from: FROM, to: NOW, source: 'query' }, queriedReferences: [], ...coverage },
});
const OPTIONS = Object.freeze({ businessId: BUSINESS, now: NOW });
const real = (result) => result.findings.filter((finding) => finding.code !== UNVERIFIED_CODE);
const only = (result, code) => {
  assert.deepEqual(real(result).map((finding) => finding.code), [code], JSON.stringify(real(result).map((f) => `${f.code}/${f.reason}`)));
  return real(result)[0];
};
const FINDING_KEYS = ['code', 'reason', 'severity', 'business_id', 'payment_intent_id', 'provider_payment_id', 'order_id',
  'order_public_code', 'facts', 'explanation'];

// ── Contrato ─────────────────────────────────────────────────────────────────
test('los códigos son exactamente los seis del contrato, más el de cobertura', () => {
  assert.deepEqual([...FINDING_CODES], ['PAYMENT_MISSING_LOCAL', 'PAYMENT_MISSING_PROVIDER', 'STATUS_MISMATCH', 'AMOUNT_MISMATCH',
    'ORDER_PAYMENT_MISMATCH', 'REFUND_MISMATCH']);
  assert.equal(UNVERIFIED_CODE, 'UNVERIFIED_AGAINST_PROVIDER');
  assert.deepEqual([...ALL_CODES], [...FINDING_CODES, UNVERIFIED_CODE]);
});

test('la tabla de estados sale de la definición viva del snapshot y del rango', () => {
  const migrations = fs.readdirSync(new URL('../supabase/migrations/', import.meta.url)).sort()
    .map((name) => ({ name, sql: source(`supabase/migrations/${name}`) }));
  const snapshot = migrations.filter((file) => /function public\.record_mercadopago_payment_snapshot/.test(file.sql)).at(-1).sql;
  for (const [provider, entry] of Object.entries(PROVIDER_STATUS_MAP)) {
    if (provider === 'approved' || provider === 'in_mediation') continue;
    assert.match(snapshot, new RegExp(`when '${provider}' then '${entry.writes}'`), `${provider} → ${entry.writes}`);
  }
  assert.match(snapshot, /else 'approved_order_pending' end/, 'approved sin reembolsos escribe approved_order_pending');
  assert.equal(PROVIDER_STATUS_MAP.approved.writes, 'approved_order_pending');
  // `in_mediation` no está entre los estados aceptados: cae en revisión de seguridad (PAY-05).
  const accepted = snapshot.match(/v_status not in \(([^)]+)\)/)[1];
  assert.doesNotMatch(accepted, /in_mediation/);
  assert.equal(PROVIDER_STATUS_MAP.in_mediation.writes, 'security_review_required');
  for (const status of ['refunded', 'charged_back', 'in_mediation', 'cancelled', 'rejected', 'pending', 'in_process', 'authorized', 'approved', 'expired']) {
    assert.ok(PROVIDER_STATUS_MAP[status], `${status} está en la tabla`);
    assert.ok(PROVIDER_STATUS_MAP[status].consistent.every((internal) => internal in INTERNAL_STATUS_RANK), status);
  }
  const rank = migrations.filter((file) => /function public\.payment_internal_status_rank/.test(file.sql)).at(-1).sql;
  for (const [status, value] of Object.entries(INTERNAL_STATUS_RANK)) {
    assert.match(rank, new RegExp(`when '${status}' then ${value}\\b`), `rango de ${status}`);
  }
  assert.equal(normalizeProviderPayment({ id: 1, status: 'Canceled' }).status, 'cancelled', 'la grafía «canceled» es el mismo estado');
});

// ── Un conjunto coherente ────────────────────────────────────────────────────
test('un conjunto coherente no produce hallazgos y queda todo conciliado', () => {
  const local = localRows({
    intents: [
      paidIntent(1),
      intent(2),
      intent(3, { internal_status: 'cancelled', provider_payment_id: paymentId(3), provider_status: 'rejected', session_status: 'cancelled' }),
    ],
    orders: [order(1)],
  });
  const provider = providerRows([mpPayment(1), mpPayment(3, { status: 'rejected', status_detail: 'cc_rejected_other_reason', date_approved: null })]);
  const result = classify(local, provider, OPTIONS);
  assert.deepEqual(result.findings, []);
  assert.equal(result.totals.findings, 0);
  assert.equal(result.coverage.compared_against_provider, 2);
  assert.equal(result.coverage.no_provider_payment_expected, 1, 'el checkout abandonado no tiene pago y el rango lo prueba');
  assert.equal(result.coverage.unverified_against_provider, 0);
  assert.equal(result.coverage.reconciled, 3);
});

// ── Un caso por código ───────────────────────────────────────────────────────
test('PAYMENT_MISSING_LOCAL: el proveedor cobró y ningún intent usa esa referencia', () => {
  const provider = providerRows([
    mpPayment(50),
    mpPayment(51, { status: 'rejected' }),
    mpPayment(52, { external_reference: 'POS-0001-0000123' }),
  ]);
  const result = classify(localRows({ looked_up_references: [reference(50), reference(51)] }), provider, OPTIONS);
  const finding = only(result, 'PAYMENT_MISSING_LOCAL');
  assert.deepEqual(Object.keys(finding), FINDING_KEYS);
  assert.equal(finding.severity, 'critical');
  assert.equal(finding.reason, 'no_local_intent');
  assert.equal(finding.provider_payment_id, paymentId(50));
  assert.equal(finding.payment_intent_id, null);
  assert.equal(finding.business_id, BUSINESS);
  assert.equal(finding.facts.provider_transaction_amount, 15000);
  assert.equal(result.totals.provider_payments_out_of_scope, 1, 'una referencia de otro canal no es de esta conciliación');
  assert.equal(result.totals.provider_payments_in_scope, 2);
});

test('PAYMENT_MISSING_LOCAL baja a advertencia si es un pago en curso o si sólo se miró la ventana', () => {
  const pending = classify(localRows({ looked_up_references: [reference(50)] }), providerRows([mpPayment(50, { status: 'pending' })]), OPTIONS);
  assert.equal(only(pending, 'PAYMENT_MISSING_LOCAL').severity, 'warning');
  const windowOnly = only(classify(localRows(), providerRows([mpPayment(50)]), OPTIONS), 'PAYMENT_MISSING_LOCAL');
  assert.equal(windowOnly.severity, 'warning', 'sin la búsqueda por referencia no puede afirmarse que el intent no existe');
  assert.equal(windowOnly.reason, 'no_local_intent_in_window');
  assert.equal(windowOnly.facts.local_lookup, 'window_only');
});

test('PAYMENT_MISSING_PROVIDER: la base da el pago por cobrado y el proveedor no lo tiene', () => {
  const result = classify(localRows({ intents: [paidIntent(1)], orders: [order(1)] }), providerRows([]), OPTIONS);
  const finding = only(result, 'PAYMENT_MISSING_PROVIDER');
  assert.equal(finding.severity, 'critical');
  assert.equal(finding.reason, 'no_provider_record');
  assert.equal(finding.payment_intent_id, intentId(1));
  assert.equal(finding.provider_payment_id, paymentId(1), 'el id que la base dice tener');
  assert.equal(finding.order_id, orderId(1));
  assert.equal(finding.order_public_code, 'TB-1001');
  assert.equal(finding.facts.absence_established_by, 'range');
  assert.equal(result.coverage.missing_at_provider, 1);
  assert.equal(result.coverage.reconciled, 0);
});

test('PAYMENT_MISSING_PROVIDER: el id guardado no está entre los pagos de esa referencia', () => {
  const result = classify(localRows({ intents: [paidIntent(1)], orders: [order(1)] }),
    providerRows([mpPayment(1, { id: 7_000_000_999 })]), OPTIONS);
  const finding = only(result, 'PAYMENT_MISSING_PROVIDER');
  assert.equal(finding.reason, 'claimed_payment_id_not_returned');
  assert.equal(finding.facts.local_provider_payment_id, paymentId(1));
  assert.deepEqual(finding.facts.provider_payment_ids, ['7000000999']);
});

test('STATUS_MISMATCH: contracargo en el proveedor, «completed» en la base', () => {
  const result = classify(localRows({ intents: [paidIntent(1)], orders: [order(1)] }),
    providerRows([mpPayment(1, { status: 'charged_back', status_detail: 'settled' })]), OPTIONS);
  const finding = only(result, 'STATUS_MISMATCH');
  assert.equal(finding.severity, 'critical');
  assert.equal(finding.reason, 'provider_charged_back_local_not');
  assert.equal(finding.facts.provider_status, 'charged_back');
  assert.equal(finding.facts.local_internal_status, 'completed');
  assert.deepEqual(finding.facts.expected_internal_statuses, ['charged_back']);
});

test('AMOUNT_MISMATCH: el importe cobrado no es el esperado', () => {
  const result = classify(localRows({ intents: [paidIntent(1)], orders: [order(1)] }),
    providerRows([mpPayment(1, { transaction_amount: 14000 })]), OPTIONS);
  const finding = only(result, 'AMOUNT_MISMATCH');
  assert.equal(finding.severity, 'critical');
  assert.deepEqual(finding.facts.differences, ['transaction_amount_vs_expected', 'paid_amount_vs_transaction']);
  assert.equal(finding.facts.provider_transaction_amount, 14000);
  assert.equal(finding.facts.local_expected_amount, 15000);
  assert.equal(finding.facts.provider_net_amount, 14000);
  assert.equal(finding.facts.local_net_amount, 15000);
});

test('AMOUNT_MISMATCH: otra moneda es crítico; un reembolso no convierte el bruto en diferencia', () => {
  const currency = only(classify(localRows({ intents: [paidIntent(1)], orders: [order(1)] }),
    providerRows([mpPayment(1, { currency_id: 'USD' })]), OPTIONS), 'AMOUNT_MISMATCH');
  assert.deepEqual(currency.facts.differences, ['currency']);
  assert.equal(currency.severity, 'critical');
  const pendingOtherAmount = only(classify(localRows({ intents: [intent(1, { internal_status: 'pending', provider_payment_id: paymentId(1), provider_status: 'pending', session_status: 'payment_pending' })] }),
    providerRows([mpPayment(1, { status: 'pending', transaction_amount: 12000, date_approved: null })]), OPTIONS), 'AMOUNT_MISMATCH');
  assert.equal(pendingOtherAmount.severity, 'warning', 'todavía no se movió plata');
});

test('ORDER_PAYMENT_MISMATCH: el total del pedido no es el importe pagado', () => {
  const result = classify(localRows({ intents: [paidIntent(1)], orders: [order(1, { total: '16000.00' })] }), providerRows([mpPayment(1)]), OPTIONS);
  const finding = only(result, 'ORDER_PAYMENT_MISMATCH');
  assert.equal(finding.reason, 'order_total_differs_from_payment');
  assert.equal(finding.severity, 'critical');
  assert.equal(finding.facts.order_total, 16000);
  assert.equal(finding.facts.local_paid_amount, 15000);
});

test('ORDER_PAYMENT_MISMATCH: las demás incoherencias internas, sin necesitar al proveedor', () => {
  const noOrder = { order_id: null, session_completed_order_id: null, request_order_ids: [], internal_status: 'approved_order_pending', session_status: 'payment_approved' };
  const stale = paidIntent(1, { ...noOrder, approved_at: minutesAgo(180), updated_at: minutesAgo(180) });
  const paidNoOrder = only(classify(localRows({ intents: [stale] }), providerRows([mpPayment(1, { date_approved: minutesAgo(180), date_last_updated: minutesAgo(180) })]), OPTIONS), 'ORDER_PAYMENT_MISMATCH');
  assert.equal(paidNoOrder.reason, 'paid_intent_without_order');
  assert.equal(paidNoOrder.facts.minutes_since_approval, 180);

  const orphanOrder = only(classify(localRows({ orders: [order(9)] }), providerRows([]), OPTIONS), 'ORDER_PAYMENT_MISMATCH');
  assert.equal(orphanOrder.reason, 'mercadopago_order_without_paid_intent');
  assert.equal(orphanOrder.order_id, orderId(9));
  assert.equal(orphanOrder.order_public_code, 'TB-1009');
  assert.equal(orphanOrder.payment_intent_id, null);

  const cancelled = only(classify(localRows({ intents: [paidIntent(1)], orders: [order(1, { status: 'cancelled' })] }), providerRows([mpPayment(1)]), OPTIONS), 'ORDER_PAYMENT_MISMATCH');
  assert.equal(cancelled.reason, 'cancelled_order_payment_not_refunded');
  assert.equal(cancelled.severity, 'critical');

  const twoOrders = only(classify(localRows({ intents: [paidIntent(1, { request_order_ids: [orderId(1), orderId(2)] })], orders: [order(1), order(2)] }),
    providerRows([mpPayment(1)]), OPTIONS), 'ORDER_PAYMENT_MISMATCH');
  assert.equal(twoOrders.reason, 'multiple_orders_for_one_intent');
  assert.deepEqual(twoOrders.facts.order_ids, [orderId(1), orderId(2)]);

  const review = paidIntent(1, { ...noOrder, internal_status: 'security_review_required', security_review_reason: 'approved_after_reservation_expired', session_status: 'manual_review_required' });
  const charged = only(classify(localRows({ intents: [review] }), providerRows([mpPayment(1)]), OPTIONS), 'ORDER_PAYMENT_MISMATCH');
  assert.equal(charged.reason, 'charged_without_order_in_review');
  assert.equal(charged.facts.security_review_reason, 'approved_after_reservation_expired');

  // Un pedido que no es de Mercado Pago no tiene por qué tener intent.
  assert.deepEqual(real(classify(localRows({ orders: [order(9, { payment_method: 'cash' })] }), providerRows([]), OPTIONS)), []);
});

test('REFUND_MISMATCH: un reembolso trabado en «requested» pasado el umbral', () => {
  const refunds = [{ refund_id: refundId(1), payment_intent_id: intentId(1), provider_refund_id: null, amount: '5000.00', status: 'requested', requested_at: minutesAgo(180), completed_at: null }];
  const result = classify(localRows({ intents: [paidIntent(1)], orders: [order(1)], refunds }), providerRows([mpPayment(1)]), OPTIONS);
  const finding = only(result, 'REFUND_MISMATCH');
  assert.equal(finding.reason, 'refund_stuck');
  assert.equal(finding.severity, 'warning');
  assert.equal(finding.facts.minutes_open, 180);
  assert.equal(finding.facts.has_provider_refund_id, false);
  const fresh = [{ ...refunds[0], requested_at: minutesAgo(10) }];
  assert.deepEqual(classify(localRows({ intents: [paidIntent(1)], orders: [order(1)], refunds: fresh }), providerRows([mpPayment(1)]), OPTIONS).findings, [],
    'un reembolso recién pedido está en curso, no trabado');
  assert.equal(real(classify(localRows({ intents: [paidIntent(1)], orders: [order(1)], refunds: fresh }), providerRows([mpPayment(1)]), { ...OPTIONS, refundStuckMinutes: 5 })).length, 1,
    'el umbral es configurable');
});

test('REFUND_MISMATCH: reembolso local que el proveedor no tiene, o con otro importe', () => {
  const partial = paidIntent(1, { internal_status: 'partially_refunded', refunded_amount: '5000.00' });
  const refunds = [{ refund_id: refundId(1), payment_intent_id: intentId(1), provider_refund_id: '8001', amount: '5000.00', status: 'approved', requested_at: minutesAgo(200), completed_at: minutesAgo(199) }];
  const missing = classify(localRows({ intents: [partial], orders: [order(1)], refunds }), providerRows([mpPayment(1)]), OPTIONS);
  assert.deepEqual(real(missing).map((finding) => `${finding.code}/${finding.reason}/${finding.severity}`),
    ['REFUND_MISMATCH/local_refund_missing_at_provider/critical', 'REFUND_MISMATCH/refunded_total_differs/critical'],
    'el estado no se informa aparte: la diferencia es el reembolso');

  const otherAmount = classify(localRows({ intents: [partial], orders: [order(1)], refunds }),
    providerRows([mpPayment(1, { transaction_amount_refunded: 4000, refunds: [{ id: 8001, payment_id: Number(paymentId(1)), amount: 4000, status: 'approved', date_created: minutesAgo(199) }] })]), OPTIONS);
  const reasons = real(otherAmount).map((finding) => finding.reason);
  assert.deepEqual(reasons, ['refund_amount_differs', 'refunded_total_differs']);
  assert.equal(real(otherAmount)[0].facts.provider_refund.amount, 4000);
  assert.equal(real(otherAmount)[0].facts.local_refund_amount, 5000);
  assert.equal(real(otherAmount)[1].facts.provider_refunded_total, 4000);
  assert.equal(real(otherAmount)[1].facts.local_intent_refunded_amount, 5000);
});

test('REFUND_MISMATCH: reembolso hecho en el panel de Mercado Pago', () => {
  const panelRefund = { transaction_amount_refunded: 5000, refunds: [{ id: 8002, payment_id: Number(paymentId(1)), amount: 5000, status: 'approved', date_created: minutesAgo(100) }] };
  const known = classify(localRows({ intents: [paidIntent(1, { internal_status: 'partially_refunded', refunded_amount: '5000.00' })], orders: [order(1)] }),
    providerRows([mpPayment(1, panelRefund)]), OPTIONS);
  assert.deepEqual(real(known).map((finding) => `${finding.reason}/${finding.severity}`), ['provider_refund_not_recorded_locally/info'],
    'el total del intent ya lo refleja: es un aviso');
  assert.equal(known.coverage.reconciled, 1);

  const unknown = classify(localRows({ intents: [paidIntent(1)], orders: [order(1)] }), providerRows([mpPayment(1, panelRefund)]), OPTIONS);
  assert.deepEqual(real(unknown).map((finding) => `${finding.code}/${finding.reason}/${finding.severity}`),
    ['REFUND_MISMATCH/refunded_total_differs/critical', 'REFUND_MISMATCH/provider_refund_not_recorded_locally/warning'],
    'la base sigue en «completed» sin saber que se devolvió plata');
  assert.equal(unknown.coverage.reconciled, 0);
});

test('otros motivos: identidad pisada, mediación, referencia ajena y revisión sin rastro del cobro', () => {
  // PAY-04: un segundo pago rechazado pisó el id; la plata está en el primero.
  const overwritten = paidIntent(1, { provider_payment_id: '7000000998', provider_status: 'rejected' });
  const identity = only(classify(localRows({ intents: [overwritten], orders: [order(1)] }),
    providerRows([mpPayment(1), mpPayment(1, { id: 7_000_000_998, status: 'rejected' })]), OPTIONS), 'STATUS_MISMATCH');
  assert.equal(identity.reason, 'local_identity_not_authoritative');
  assert.equal(identity.provider_payment_id, paymentId(1), 'el hallazgo señala el pago que tiene la plata');
  assert.equal(identity.facts.local_provider_payment_id, '7000000998');

  // PAY-05/06: mediación abierta en el proveedor y la base sin enterarse.
  const mediation = providerRows([mpPayment(1, { status: 'in_mediation', status_detail: 'pending_documentation' })]);
  const blind = only(classify(localRows({ intents: [paidIntent(1)], orders: [order(1)] }), mediation, OPTIONS), 'STATUS_MISMATCH');
  assert.equal(blind.reason, 'provider_in_mediation_local_unaware');
  assert.equal(blind.severity, 'critical');
  const disputes = [{ payment_intent_id: intentId(1), dispute_type: 'claim', status: 'opened', resolved_at: null }];
  assert.deepEqual(classify(localRows({ intents: [paidIntent(1)], orders: [order(1)], disputes }), mediation, OPTIONS).findings, [], 'con la disputa registrada es coherente');
  const flipped = paidIntent(1, { internal_status: 'security_review_required', security_review_reason: 'unknown_provider_status', session_status: 'manual_review_required' });
  const deadEnd = only(classify(localRows({ intents: [flipped], orders: [order(1)] }), mediation, OPTIONS), 'STATUS_MISMATCH');
  assert.equal(deadEnd.reason, 'captured_payment_in_review_with_order');
  assert.equal(deadEnd.severity, 'warning');

  // El pago que la base dice tener figura en el proveedor con otra referencia.
  const foreign = only(classify(localRows({ intents: [paidIntent(1)], orders: [order(1)] }),
    providerRows([mpPayment(1, { external_reference: reference(77) })], { queriedReferences: [reference(1)] }), OPTIONS), 'STATUS_MISMATCH');
  assert.equal(foreign.reason, 'external_reference_differs');
  assert.equal(foreign.facts.provider_external_reference, reference(77));

  // Revisión por importe distinto: la base no guardó nada del cobro (camino «falla cerrada»).
  const silent = intent(1, { internal_status: 'security_review_required', security_review_reason: 'amount_mismatch', session_status: 'manual_review_required' });
  const withProvider = classify(localRows({ intents: [silent] }), providerRows([mpPayment(1, { transaction_amount: 12000 })]), OPTIONS);
  assert.deepEqual(real(withProvider).map((finding) => `${finding.code}/${finding.reason}/${finding.severity}`),
    ['AMOUNT_MISMATCH/transaction_amount_vs_expected/critical', 'ORDER_PAYMENT_MISMATCH/charged_without_order_in_review/critical']);
  assert.equal(real(withProvider)[1].facts.money_evidence, 'provider');
  const withoutProvider = real(classify(localRows({ intents: [silent] }), null, OPTIONS));
  assert.deepEqual(withoutProvider.map((finding) => `${finding.reason}/${finding.severity}`), ['review_without_order_money_unknown/warning'],
    'sin proveedor no se afirma un cobro: se pide mirarlo');

  // Coherencia interna del intent, sin proveedor.
  const contradiction = paidIntent(1, { provider_status: 'approved', internal_status: 'cancelled', order_id: null, session_completed_order_id: null, request_order_ids: [] });
  const local = real(classify(localRows({ intents: [contradiction] }), null, OPTIONS));
  assert.deepEqual(local.map((finding) => `${finding.code}/${finding.reason}/${finding.severity}`), ['STATUS_MISMATCH/local_snapshot_contradiction/critical']);
  const panelRefunded = paidIntent(1, { internal_status: 'partially_refunded', refunded_amount: '4000.00' });
  assert.deepEqual(real(classify(localRows({ intents: [panelRefunded], orders: [order(1)] }), null, OPTIONS)).map((finding) => `${finding.reason}/${finding.severity}`),
    ['intent_refunded_above_local_refunds/warning']);
  const reversed = paidIntent(1, { internal_status: 'charged_back' });
  assert.deepEqual(real(classify(localRows({ intents: [reversed], orders: [order(1, { status: 'preparing' })] }), providerRows([mpPayment(1, { status: 'charged_back' })]), OPTIONS))
    .map((finding) => `${finding.reason}/${finding.severity}`), ['active_order_payment_reversed/critical'],
  'un pedido que todavía se puede entregar sobre plata que ya se fue es crítico');
});

// ── Atrasos legítimos ────────────────────────────────────────────────────────
test('los estados en curso no se marcan: pendiente de los dos lados', () => {
  const pending = intent(1, { internal_status: 'pending', provider_payment_id: paymentId(1), provider_status: 'pending', session_status: 'payment_pending' });
  const result = classify(localRows({ intents: [pending] }), providerRows([mpPayment(1, { status: 'pending', status_detail: 'pending_waiting_payment', date_approved: null })]), OPTIONS);
  assert.deepEqual(result.findings, []);
  assert.equal(result.coverage.reconciled, 1);
  // `authorized` e `in_process` escriben `in_process`.
  for (const status of ['authorized', 'in_process']) {
    const inProcess = intent(1, { internal_status: 'in_process', provider_payment_id: paymentId(1), provider_status: status, session_status: 'payment_pending' });
    assert.deepEqual(classify(localRows({ intents: [inProcess] }), providerRows([mpPayment(1, { status, date_approved: null })]), OPTIONS).findings, [], status);
  }
});

test('un aprobado reciente que la base todavía no procesó es atraso; viejo, es crítico', () => {
  const waiting = intent(1, { internal_status: 'pending', provider_payment_id: paymentId(1), provider_status: 'pending', session_status: 'payment_pending' });
  const recent = classify(localRows({ intents: [waiting] }), providerRows([mpPayment(1, { date_approved: minutesAgo(5), date_last_updated: minutesAgo(5) })]), OPTIONS);
  assert.deepEqual(recent.findings, []);
  assert.equal(recent.coverage.lag_tolerated, 1);
  assert.equal(recent.coverage.reconciled, 0, 'en curso no es conciliado');

  const old = only(classify(localRows({ intents: [waiting] }), providerRows([mpPayment(1, { date_approved: minutesAgo(180), date_last_updated: minutesAgo(180) })]), OPTIONS), 'STATUS_MISMATCH');
  assert.equal(old.severity, 'critical');
  assert.equal(old.reason, 'provider_approved_local_not_paid');
  assert.equal(old.facts.minutes_since_provider_update, 180);
  assert.equal(old.facts.lag_minutes_allowed, 30);

  const settling = paidIntent(1, { order_id: null, session_completed_order_id: null, request_order_ids: [], internal_status: 'approved_order_pending', approved_at: minutesAgo(2), updated_at: minutesAgo(2) });
  const finalizing = classify(localRows({ intents: [settling] }), providerRows([mpPayment(1, { date_approved: minutesAgo(2), date_last_updated: minutesAgo(2) })]), OPTIONS);
  assert.deepEqual(finalizing.findings, [], 'approved_order_pending dura lo que tarda finalize');
  assert.equal(finalizing.coverage.lag_tolerated, 1);
});

test('statusVerdict: revisión, mediación y rango monotónico', () => {
  const ctx = { nowMs: Date.parse(NOW), lagMs: 30 * 60_000 };
  const payment = (status, extra = {}) => normalizeProviderPayment(mpPayment(1, { status, date_last_updated: minutesAgo(600), date_approved: minutesAgo(600), ...extra }));
  const local = (internal, extra = {}) => ({ internal_status: internal, refunded_cents: 0, ...extra });
  assert.equal(statusVerdict(local('security_review_required'), payment('approved'), ctx).kind, 'consistent', 'revisión es el sumidero «falla cerrada»');
  assert.equal(statusVerdict(local('completed'), payment('in_mediation'), ctx).reason, 'provider_in_mediation_local_unaware');
  assert.equal(statusVerdict(local('completed'), payment('in_mediation'), { ...ctx, hasOpenDispute: true }).kind, 'consistent');
  assert.equal(statusVerdict(local('charged_back'), payment('in_mediation'), ctx).kind, 'consistent');
  assert.equal(statusVerdict(local('expired'), payment('rejected'), ctx).kind, 'consistent', 'rechazado, cancelado y vencido son «sin plata»');
  assert.equal(statusVerdict(local('in_process'), payment('pending'), ctx).kind, 'consistent', 'el estado interno no baja de rango');
  assert.equal(statusVerdict(local('cancelled'), payment('pending'), ctx).reason, 'provider_in_flight_local_closed');
  assert.equal(statusVerdict(local('completed'), payment('rejected'), ctx).severity, 'critical');
  assert.equal(statusVerdict(local('completed'), payment('weird_new_status'), ctx).reason, 'unknown_provider_status');
  assert.equal(statusVerdict(local('completed'), payment('approved', { transaction_amount_refunded: 5000 }), ctx).kind, 'deferred',
    'lo explica el reembolso: lo informa REFUND_MISMATCH');
  assert.deepEqual(statusVerdict(local('partially_refunded', { refunded_cents: 500000 }), payment('approved', { transaction_amount_refunded: 5000 }), ctx).expected, ['partially_refunded']);
});

// ── Reembolsos coherentes ────────────────────────────────────────────────────
test('un pago reembolsado entero y coherente no produce hallazgos', () => {
  const refunded = paidIntent(1, { internal_status: 'refunded', refunded_amount: '15000.00' });
  const refunds = [{ refund_id: refundId(1), payment_intent_id: intentId(1), provider_refund_id: '8001', amount: '15000.00', status: 'approved', requested_at: minutesAgo(120), completed_at: minutesAgo(119) }];
  const payment = mpPayment(1, { status: 'refunded', status_detail: 'refunded', transaction_amount_refunded: 15000,
    refunds: [{ id: 8001, payment_id: Number(paymentId(1)), amount: 15000, status: 'approved', date_created: minutesAgo(119) }] });
  const result = classify(localRows({ intents: [refunded], orders: [order(1, { status: 'cancelled' })], refunds }), providerRows([payment]), OPTIONS);
  assert.deepEqual(result.findings, []);
  assert.equal(result.coverage.reconciled, 1);
});

test('reembolsos parciales: la suma del proveedor contra el total local', () => {
  const twoRefunds = [
    { id: 8001, payment_id: Number(paymentId(1)), amount: 3000, status: 'approved', date_created: minutesAgo(300) },
    { id: 8002, payment_id: Number(paymentId(1)), amount: 2000, status: 'approved', date_created: minutesAgo(200) },
    { id: 8003, payment_id: Number(paymentId(1)), amount: 1000, status: 'rejected', date_created: minutesAgo(150) },
  ];
  const rows = (ids) => ids.map(([providerId, value], index) => ({ refund_id: refundId(index + 1), payment_intent_id: intentId(1), provider_refund_id: providerId,
    amount: value, status: 'approved', requested_at: minutesAgo(301), completed_at: minutesAgo(300) }));
  const coherent = localRows({ intents: [paidIntent(1, { internal_status: 'partially_refunded', refunded_amount: '5000.00' })], orders: [order(1)],
    refunds: rows([['8001', '3000.00'], ['8002', '2000.00']]) });
  assert.deepEqual(classify(coherent, providerRows([mpPayment(1, { transaction_amount_refunded: 5000, refunds: twoRefunds })]), OPTIONS).findings, []);
  // Sin `transaction_amount_refunded`, el total sale de sumar los reembolsos aprobados (el rechazado no cuenta).
  const summed = mpPayment(1, { refunds: twoRefunds });
  delete summed.transaction_amount_refunded;
  assert.equal(normalizeProviderPayment(summed).refunded_total_cents, 500000);
  assert.deepEqual(classify(coherent, providerRows([summed]), OPTIONS).findings, []);

  const behind = localRows({ intents: [paidIntent(1, { internal_status: 'partially_refunded', refunded_amount: '3000.00' })], orders: [order(1)],
    refunds: rows([['8001', '3000.00']]) });
  const result = classify(behind, providerRows([mpPayment(1, { transaction_amount_refunded: 5000, refunds: twoRefunds })]), OPTIONS);
  assert.deepEqual(real(result).map((finding) => `${finding.code}/${finding.reason}`),
    ['REFUND_MISMATCH/refunded_total_differs', 'REFUND_MISMATCH/provider_refund_not_recorded_locally']);
  const total = real(result)[0];
  assert.equal(total.facts.provider_refunded_total, 5000);
  assert.equal(total.facts.local_intent_refunded_amount, 3000);
  assert.equal(total.facts.local_approved_refunds_total, 3000);
  assert.equal(real(result)[1].facts.provider_refund_id, '8002');
});

// ── Doble cobro ──────────────────────────────────────────────────────────────
test('doble cobro: dos pagos aprobados para una misma referencia', () => {
  const result = classify(localRows({ intents: [paidIntent(1)], orders: [order(1)] }),
    providerRows([mpPayment(1), mpPayment(1, { id: 7_000_000_999, date_created: '2026-10-01T07:04:00.000-03:00' })]), OPTIONS);
  const finding = only(result, 'ORDER_PAYMENT_MISMATCH');
  assert.equal(finding.reason, 'duplicate_approved_payment');
  assert.equal(finding.severity, 'critical');
  assert.deepEqual(finding.facts.provider_payments.map((payment) => payment.provider_payment_id).sort(), [paymentId(1), '7000000999']);
  assert.equal(finding.facts.evidence, 'provider');
  assert.equal(finding.provider_payment_id, paymentId(1), 'manda el pago que la base ya conoce');

  // Sin proveedor, la sospecha sale de los eventos locales (PAY-04).
  const localOnly = classify(localRows({ intents: [paidIntent(1, { approved_provider_payment_ids: [paymentId(1), '7000000999'] })], orders: [order(1)] }), null, OPTIONS);
  const suspected = only(localOnly, 'ORDER_PAYMENT_MISMATCH');
  assert.equal(suspected.facts.evidence, 'local_events');
  assert.equal(suspected.severity, 'critical');

  // Un aprobado y un rechazado no son doble cobro; el aprobado es el que manda.
  const retried = [normalizeProviderPayment(mpPayment(1, { id: 7_000_000_998, status: 'rejected' })), normalizeProviderPayment(mpPayment(1))];
  assert.equal(pickAuthoritativePayment(retried, '7000000998').provider_payment_id, paymentId(1));
  assert.deepEqual(classify(localRows({ intents: [paidIntent(1)], orders: [order(1)] }), providerRows([mpPayment(1), mpPayment(1, { id: 7_000_000_998, status: 'rejected' })]), OPTIONS).findings, []);
});

// ── Cobertura ────────────────────────────────────────────────────────────────
test('sin datos del proveedor nada cuenta como conciliado', () => {
  const local = localRows({ intents: [paidIntent(1), intent(2), intent(3, { internal_status: 'expired', session_status: 'expired' })], orders: [order(1)] });
  const result = classify(local, null, OPTIONS);
  assert.equal(result.coverage.provider_supplied, false);
  assert.equal(result.coverage.reconciled, 0);
  assert.equal(result.coverage.compared_against_provider, 0);
  assert.equal(result.coverage.unverified_against_provider, 3);
  assert.deepEqual(result.coverage.unverified_payment_intent_ids.sort(), [intentId(1), intentId(2), intentId(3)]);
  assert.equal(result.totals.by_code[UNVERIFIED_CODE], 3);
  assert.ok(result.findings.every((finding) => finding.code === UNVERIFIED_CODE && finding.severity === 'info' && finding.reason === 'no_provider_data'));
  assert.equal(result.totals.by_severity.critical, 0);
});

test('la cobertura distingue comparado, sin pago que comparar, faltante y no verificado', () => {
  const before = { created_at: '2026-09-20T10:00:00+00:00', updated_at: '2026-10-01T09:00:00+00:00', session_expires_at: '2026-09-20T10:15:00+00:00' };
  const local = localRows({
    intents: [
      paidIntent(1),                                                  // comparado
      intent(2),                                                      // sin pago, dentro del rango
      paidIntent(3),                                                  // dice estar pago y el proveedor no lo tiene
      intent(4, before),                                              // fuera del rango consultado
      intent(5, before),                                              // fuera del rango, pero consultado por referencia
      paidIntent(6, { environment: 'test' }),                         // otro ambiente
    ],
    orders: [order(1), order(3), order(6)],
  });
  const provider = providerRows([mpPayment(1)], { queriedReferences: [reference(5)] });
  const result = classify(local, provider, { ...OPTIONS, environment: 'production' });
  const coverage = result.coverage;
  assert.equal(coverage.local_intents, 6);
  assert.equal(coverage.compared_against_provider, 1);
  assert.equal(coverage.no_provider_payment_expected, 2);
  assert.equal(coverage.missing_at_provider, 1);
  assert.equal(coverage.unverified_against_provider, 2);
  assert.deepEqual(coverage.unverified_reasons, { outside_provider_range: 1, environment_not_covered: 1 });
  assert.equal(coverage.compared_against_provider + coverage.no_provider_payment_expected + coverage.missing_at_provider + coverage.unverified_against_provider,
    coverage.local_intents, 'cada intent cae en una sola categoría');
  assert.equal(coverage.reconciled, 3);
  assert.deepEqual(coverage.unverified_payment_intent_ids.sort(), [intentId(4), intentId(6)]);
  assert.equal(result.findings.filter((finding) => finding.code === UNVERIFIED_CODE).length, 2);
});

test('un resultado incompleto del proveedor no prueba que un pago falte', () => {
  const local = localRows({ intents: [paidIntent(1), paidIntent(2)], orders: [order(1), order(2)] });
  const result = classify(local, providerRows([mpPayment(1)], { complete: false }), OPTIONS);
  assert.deepEqual(real(result), [], 'no se inventa un PAYMENT_MISSING_PROVIDER');
  assert.equal(result.coverage.unverified_against_provider, 2);
  assert.deepEqual(result.coverage.unverified_reasons, { provider_group_incomplete: 1, provider_result_incomplete: 1 },
    'el que se vio se comparó en parte (pueden faltar pagos de su referencia); el otro no se vio');
  assert.equal(result.coverage.partially_compared, 1);
  assert.equal(result.coverage.compared_against_provider, 0);
  assert.equal(result.coverage.reconciled, 0, 'un resultado incompleto no concilia nada');
  // Si a esa referencia se la consultó, el grupo está completo aunque el rango no lo esté.
  const asked = classify(local, providerRows([mpPayment(1)], { complete: false, queriedReferences: [reference(1)] }), OPTIONS);
  assert.equal(asked.coverage.compared_against_provider, 1);
  assert.equal(asked.coverage.reconciled, 1);
  // Una lista suelta de pagos, sin cobertura declarada, se trata igual.
  const loose = classify(local, [mpPayment(1)], OPTIONS);
  assert.equal(loose.coverage.unverified_against_provider, 2);
  assert.equal(loose.coverage.reconciled, 0);
  assert.equal(loose.coverage.provider_comparison, 'partial');
});

test('qué referencias hay que preguntarle al proveedor una por una, y en qué orden', () => {
  const outside = { created_at: '2026-09-20T10:00:00+00:00', session_expires_at: '2026-09-20T10:15:00+00:00' };
  const local = localRows({ intents: [paidIntent(1), intent(2), intent(3, outside), paidIntent(4, outside)] });
  assert.deepEqual(referencesNeedingExplicitLookup(local, { from: FROM, to: NOW }), [reference(4), reference(3), reference(1)],
    'primero el pago cuya preferencia el rango no cubre, después el abandonado fuera del rango, al final el pago que el rango ya cubre; el abandonado dentro del rango no');
  // Una preferencia que vence pegada al final del rango no está cubierta: un pago de último momento puede fecharse después.
  const edge = localRows({ intents: [intent(5, { created_at: '2026-10-01T14:40:00+00:00', session_expires_at: '2026-10-01T14:55:00+00:00' })] });
  assert.deepEqual(referencesNeedingExplicitLookup(edge, { from: FROM, to: NOW }), [reference(5)]);
});

// ── Datos personales ─────────────────────────────────────────────────────────
test('ningún dato personal llega al informe, aunque la fuente lo traiga', () => {
  const leaky = paidIntent(1, { customer_name: 'Marina Quiroga', payer_email_hash: 'cliente.real@example.com', contact_snapshot: { phone: '2994123456' } });
  const leakyOrder = order(1, { status: 'cancelled', customer_name: 'Marina Quiroga', customer_phone: '2994123456', address_label: 'Calle Falsa 123' });
  const local = localRows({ intents: [leaky], orders: [leakyOrder] });
  const provider = providerRows([mpPayment(1, { status: 'charged_back' }), mpPayment(60), mpPayment(61, { transaction_amount: 9000 })]);
  const result = classify({ ...local, looked_up_references: [reference(60), reference(61)] }, provider, OPTIONS);
  assert.ok(real(result).length >= 3, 'hay hallazgos con datos de los dos lados');
  assert.doesNotMatch(JSON.stringify(result), PII_PATTERN);
  assert.deepEqual(Object.keys(normalizeProviderPayment(mpPayment(1))).sort(), ['collector_id', 'currency', 'date_approved', 'date_created',
    'date_last_updated', 'external_reference', 'live_mode', 'provider_payment_id', 'refund_detail_available', 'refunded_total_cents', 'refunds',
    'status', 'status_detail', 'transaction_amount_cents'].sort());
  assert.doesNotMatch(JSON.stringify(result), /246813579/, 'ni siquiera el id de la cuenta cobradora');
  assert.doesNotMatch(buildLocalSnapshotSql({ businessId: BUSINESS, from: FROM, to: NOW }),
    /customer_|contact_snapshot|address|phone|whatsapp|payer_email|notes|requested_by|\.reason\b/,
    'la consulta local no selecciona columnas de contacto, dirección ni texto libre');
});

// ── Importes ─────────────────────────────────────────────────────────────────
test('los importes se comparan en centavos exactos', () => {
  assert.equal(toCents('15000.00'), 1500000);
  assert.equal(toCents(19.99), 1999);
  assert.equal(toCents('0.10') + toCents('0.20'), toCents('0.30'));
  assert.equal(toCents(''), null);
  assert.equal(toCents('12,50'), null);
  assert.equal(toCents(null), null);
  assert.match(reference(1), INTEGRATION_REFERENCE);
});

// ── Garantía de sólo lectura ─────────────────────────────────────────────────
test('la consulta local es una sola lectura y pasa la guarda en sus dos modos', () => {
  for (const sql of [
    buildLocalSnapshotSql({ businessId: BUSINESS, from: FROM, to: NOW }),
    buildLocalSnapshotSql({ businessId: BUSINESS, from: FROM, to: NOW, environment: 'test' }),
    buildLocalSnapshotSql({ businessId: BUSINESS, externalReferences: [reference(1), reference(2)] }),
  ]) {
    assert.equal(assertReadOnlySql(sql), sql);
    assert.match(sql, /^with params as/);
    assert.doesNotMatch(sql, /;/);
    assert.doesNotMatch(sql, /\b(insert|update|delete|truncate|merge|alter|create|drop|grant|revoke|copy|call|do|into|set|returning|for)\b/i);
    assert.ok(sql.includes(`'${BUSINESS}'::uuid`), 'la consulta está atada al negocio pedido');
  }
});

test('la consulta no acepta valores que no sean exactamente los esperados', () => {
  assert.throws(() => buildLocalSnapshotSql({ businessId: `${BUSINESS}' or true --`, from: FROM, to: NOW }), /INVALID_UUID/);
  assert.throws(() => buildLocalSnapshotSql({ businessId: BUSINESS, from: "2026-01-01'; select 1", to: NOW }), /INVALID_INSTANT/);
  assert.throws(() => buildLocalSnapshotSql({ businessId: BUSINESS, from: '2026-09-24T15:00:00', to: NOW }), /INVALID_INSTANT/, 'sin zona horaria no');
  assert.throws(() => buildLocalSnapshotSql({ businessId: BUSINESS, from: NOW, to: FROM }), /INVALID_WINDOW/);
  assert.throws(() => buildLocalSnapshotSql({ businessId: BUSINESS, from: FROM, to: NOW, environment: "test' or 1=1" }), /INVALID_ENVIRONMENT/);
  assert.throws(() => buildLocalSnapshotSql({ businessId: BUSINESS, externalReferences: ["x' or '1'='1"] }), /INVALID_EXTERNAL_REFERENCE/);
  assert.throws(() => buildLocalSnapshotSql({ businessId: BUSINESS, from: FROM, to: NOW, maxIntents: 0 }), /INVALID_MAX_INTENTS/);
});

test('la guarda rechaza cualquier sentencia que no sea la lectura conocida', async () => {
  const refused = [
    "update public.payment_intents set internal_status = 'refunded'",
    "with x as (update public.orders set status = 'cancelled' returning id) select id from x",
    'delete from public.payment_refunds',
    "insert into public.payment_events (event_type) values ('x')",
    'select 1; drop table public.orders',
    'select public.finalize_paid_checkout_session(null)',
    'select pg_sleep(1)',
    'select o.id into temp t from public.orders o',
    'select o.id from public.orders o for update',
    'truncate public.payment_events',
    'select 1 -- comentario',
    'select $$x$$',
    '',
  ];
  for (const sql of refused) assert.throws(() => assertReadOnlySql(sql), /READ_ONLY_SQL_REFUSED/, sql);

  let executed = 0;
  const run = readOnlyRunner(async () => { executed += 1; return []; });
  await assert.rejects(run("update public.orders set status = 'cancelled'"), /READ_ONLY_SQL_REFUSED/);
  assert.equal(executed, 0, 'lo rechazado nunca llega al ejecutor inyectado');
  assert.throws(() => readOnlyRunner(null), /READ_ONLY_RUNNER_REQUIRED/);
});

test('el código de la herramienta no contiene ninguna escritura', () => {
  const sources = TOOL_FILES.map((relative) => ({ relative, text: source(relative) }));
  for (const { relative, text } of sources) {
    // Palabras de SQL que mutan, en cualquier parte del archivo: ni en un comentario.
    assert.doesNotMatch(text, /\b(insert|update|delete|truncate|upsert|alter|drop|grant|revoke|vacuum|reindex)\b/i, relative);
    assert.doesNotMatch(text, /\bcreate\s+(or\s+replace|table|function|index|schema|policy|trigger|extension|role|view)\b/i, relative);
    assert.doesNotMatch(text, /\b(merge|select)\s+into\b|\bfor\s+(update|share)\b|\breturning\b/i, relative);
    // Ningún cliente que escriba: ni RPC, ni supabase-js, ni pg.
    assert.doesNotMatch(text, /\.rpc\(|supabase-js|createClient|from 'pg'|service_role|\.upsert\(/, relative);
    // Al proveedor sólo se le hace GET, y a la base sólo se le habla por el endpoint de sólo lectura.
    for (const [, method] of text.matchAll(/method:\s*'([A-Z]+)'/g)) assert.ok(['GET', 'POST'].includes(method), `${relative}: ${method}`);
    assert.doesNotMatch(text, /PUT|PATCH|DELETE/, relative);
  }
  const all = sources.map((file) => file.text).join('\n');
  assert.equal([...all.matchAll(/method:\s*'POST'/g)].length, 1, 'un único POST en toda la herramienta');
  const post = all.slice(all.indexOf("method: 'POST'") - 200, all.indexOf("method: 'POST'"));
  assert.match(post, /database\/query\/read-only/, 'y es el endpoint de sólo lectura de la Management API');
  assert.equal([...all.matchAll(/api\.supabase\.com[^`'"]*/g)].every(([url]) => url.endsWith('/database/query/read-only')), true);
  assert.equal([...all.matchAll(/api\.mercadopago\.com[^`'"]*/g)].every(([url]) => url === 'api.mercadopago.com/v1/payments/search'), true,
    'la única ruta de Mercado Pago es la búsqueda de pagos');
  assert.equal([...all.matchAll(/api\.mercadopago\.com/g)].length, 1);
  // Lo único que la herramienta escribe es su propio informe.
  assert.doesNotMatch(sources[0].text, /node:fs|writeFile|fetch\(/, 'la lógica pura no toca disco ni red');
  assert.doesNotMatch(sources[1].text, /writeFile|appendFile|mkdir/, 'las fuentes no escriben a disco');
  assert.equal([...sources[2].text.matchAll(/writeFileSync\(/g)].length, 1);
  assert.match(sources[2].text, /writeFileSync\(options\.out,/);
});

// ── Destinos ─────────────────────────────────────────────────────────────────
test('sólo staging y producción controlada; cualquier otro destino o ref se rechaza', () => {
  assert.deepEqual({ ...TARGET_REFS }, { staging: 'ucbtjcurawxjwjdvvcvj', 'controlled-production': 'tkanbadcglszlcyfjvpv' });
  assert.deepEqual({ ...resolveTarget('staging') }, { name: 'staging', ref: 'ucbtjcurawxjwjdvvcvj' });
  assert.equal(resolveTarget('controlled-production', 'tkanbadcglszlcyfjvpv').ref, 'tkanbadcglszlcyfjvpv');
  for (const target of ['production', 'produccion', 'demo', '', 'constructor', 'toString', undefined]) {
    assert.throws(() => resolveTarget(target), /UNKNOWN_TARGET/, String(target));
  }
  assert.throws(() => resolveTarget('staging', 'tkanbadcglszlcyfjvpv'), /TARGET_REF_MISMATCH/);
  assert.throws(() => resolveTarget('controlled-production', 'wwcpogltfgzgkrlilbcd'), /TARGET_REF_MISMATCH/);
  for (const ref of ['wwcpogltfgzgkrlilbcd', 'yakhtrkukqlgzvxuvhzs', 'ukxqbgswjlibmnjemrzd', '']) {
    assert.throws(() => createManagementApiRunner({ projectRef: ref, token: 'x' }), /PROJECT_REF_NOT_ALLOWED/, ref);
  }
});

test('el ejecutor de la Management API usa el endpoint de sólo lectura y no deja pasar otra cosa', async () => {
  const calls = [];
  const cliToken = `sbp${'_'}${'k'.repeat(40)}`;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => JSON.stringify([{ payload: { business: { id: BUSINESS, slug: 'la-taba-staging' }, intent_total: 0, intents: [] } }]) };
  };
  const run = createManagementApiRunner({ projectRef: TARGET_REFS.staging, token: cliToken, fetchImpl });
  const rows = await loadLocalRows(run, { businessId: BUSINESS, from: FROM, to: NOW });
  assert.equal(rows.business_slug, 'la-taba-staging');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.supabase.com/v1/projects/ucbtjcurawxjwjdvvcvj/database/query/read-only');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${cliToken}`);
  assert.match(JSON.parse(calls[0].init.body).query, /^with params as/);
  assert.doesNotMatch(JSON.stringify(rows), new RegExp(cliToken));
  await assert.rejects(run('delete from public.orders'), /READ_ONLY_SQL_REFUSED/);
  assert.equal(calls.length, 1, 'la guarda corta antes de la red');

  const failing = createManagementApiRunner({ projectRef: TARGET_REFS.staging, token: cliToken,
    fetchImpl: async () => ({ ok: false, status: 403, text: async () => '{"message":"forbidden"}' }) });
  await assert.rejects(loadLocalRows(failing, { businessId: BUSINESS, from: FROM, to: NOW }), (error) => {
    assert.match(error.message, /LOCAL_QUERY_HTTP_403/);
    assert.doesNotMatch(error.message, new RegExp(cliToken));
    return true;
  });
});

test('la lectura local frena ante un negocio inexistente o una ventana que no entra', async () => {
  const answer = (payload) => async () => [{ payload }];
  await assert.rejects(loadLocalRows(answer({ business: null, intent_total: 0, intents: [] }), { businessId: BUSINESS, from: FROM, to: NOW }), /BUSINESS_NOT_FOUND/,
    'un uuid mal tipeado no puede devolver «cero hallazgos»');
  await assert.rejects(loadLocalRows(answer({ business: { id: BUSINESS }, intent_total: 3, intents: [intent(1)] }), { businessId: BUSINESS, from: FROM, to: NOW, maxIntents: 1 }),
    /LOCAL_WINDOW_TOO_LARGE/);
  await assert.rejects(loadLocalRows(async () => [], { businessId: BUSINESS, from: FROM, to: NOW }), /LOCAL_SNAPSHOT_SHAPE/);
  // Un cliente pg devuelve `{ rows }` y puede entregar el JSON como texto.
  const viaPg = await loadLocalRows(async () => ({ rows: [{ payload: JSON.stringify({ business: { id: BUSINESS, slug: 's' }, intent_total: 1, intents: [intent(1)], server_time: NOW }) }] }),
    { businessId: BUSINESS, from: FROM, to: NOW });
  assert.equal(viaPg.intents.length, 1);
  assert.equal(viaPg.server_time, NOW);
});

// ── Adaptador de Mercado Pago: sólo con fetch simulado ───────────────────────
function fakeToken() {
  // Se compone en tiempo de ejecución: no existe como literal en el repositorio.
  return `${['APP', 'USR'].join('_')}-${'7'.repeat(16)}-${'ab12'.repeat(8)}`;
}

function mockMercadoPago(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: new URL(url), init });
    const answer = await handler(new URL(url), calls.length);
    return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, json: async () => answer.body };
  };
  return { calls, fetchImpl };
}

test('adaptador HTTP: pagina el rango, pregunta por referencia y sólo hace GET', async () => {
  const token = fakeToken();
  const { calls, fetchImpl } = mockMercadoPago((url) => {
    if (url.searchParams.has('external_reference')) {
      const wanted = url.searchParams.get('external_reference');
      const byReference = { [reference(1)]: [mpPayment(1)], [reference(3)]: [mpPayment(3), mpPayment(4)] };
      const results = byReference[wanted] || [];
      return { status: 200, body: { paging: { total: results.length, limit: 50, offset: 0 }, results } };
    }
    const offset = Number(url.searchParams.get('offset'));
    const page = offset === 0 ? [mpPayment(1), mpPayment(2)] : [mpPayment(5)];
    return { status: 200, body: { paging: { total: 3, limit: 2, offset }, results: page } };
  });
  const fetchProviderPayments = createMercadoPagoSearchProvider({ tokenEnv: 'TABA_MP_READ_TOKEN', env: { TABA_MP_READ_TOKEN: token }, fetchImpl, pageSize: 2, sleep: async () => {} });
  const result = await fetchProviderPayments({ externalReferences: [reference(1), reference(3), reference(9), 'no-es-una-referencia'], from: FROM, to: NOW });

  assert.deepEqual(result.payments.map((payment) => String(payment.id)).sort(), [paymentId(1), paymentId(2), paymentId(3), paymentId(5)],
    'la búsqueda por referencia sólo toma la referencia exacta');
  assert.equal(result.coverage.complete, true);
  assert.equal(result.coverage.mode, 'api');
  assert.deepEqual(result.coverage.range, { from: FROM, to: NOW, source: 'query' });
  assert.deepEqual(result.coverage.queriedReferences, [reference(1), reference(3), reference(9)],
    'cada referencia pedida se consulta, también la que el rango ya trajo: puede tener otro pago fuera del rango');
  assert.equal(calls.length, 5);
  assert.equal(result.coverage.reference_lookups, 3);
  assert.equal(result.coverage.reference_lookups_inconclusive, 0);
  for (const call of calls) {
    assert.equal(call.init.method, 'GET');
    assert.equal(call.init.body, undefined);
    assert.equal(`${call.url.origin}${call.url.pathname}`, 'https://api.mercadopago.com/v1/payments/search');
    assert.equal(call.init.headers.Authorization, `Bearer ${token}`);
    assert.doesNotMatch(call.url.href, new RegExp(token), 'el token no viaja en la URL');
  }
  assert.equal(calls[0].url.searchParams.get('range'), 'date_created');
  assert.equal(calls[0].url.searchParams.get('begin_date'), FROM);
  assert.equal(calls[0].url.searchParams.get('end_date'), NOW);
  assert.equal(calls[1].url.searchParams.get('offset'), '2');
  assert.doesNotMatch(JSON.stringify(result.coverage), new RegExp(token), 'ni queda en lo que se devuelve');
});

test('adaptador HTTP: los errores no llevan el token ni el cuerpo, y lo transitorio se reintenta', async () => {
  const token = fakeToken();
  const env = { TABA_MP_READ_TOKEN: token };
  const denied = mockMercadoPago(() => ({ status: 401, body: { message: `invalid ${token}`, payer: PAYER_PII.payer } }));
  await assert.rejects(createMercadoPagoSearchProvider({ tokenEnv: 'TABA_MP_READ_TOKEN', env, fetchImpl: denied.fetchImpl })({ from: FROM, to: NOW }), (error) => {
    assert.equal(error.message, 'PROVIDER_HTTP_401');
    return true;
  });
  assert.equal(denied.calls.length, 1, 'un 401 no se reintenta');

  const flaky = mockMercadoPago((url, attempt) => (attempt < 3 ? { status: 429, body: {} } : { status: 200, body: { paging: { total: 0 }, results: [] } }));
  const waits = [];
  const recovered = await createMercadoPagoSearchProvider({ tokenEnv: 'TABA_MP_READ_TOKEN', env, fetchImpl: flaky.fetchImpl, sleep: async (ms) => { waits.push(ms); } })({ from: FROM, to: NOW });
  assert.equal(flaky.calls.length, 3);
  assert.deepEqual(waits, [1000, 2000]);
  assert.equal(recovered.coverage.complete, true);

  const broken = async () => { throw Object.assign(new TypeError(`fetch failed ${token}`), { cause: { code: 'ECONNRESET' } }); };
  await assert.rejects(createMercadoPagoSearchProvider({ tokenEnv: 'TABA_MP_READ_TOKEN', env, fetchImpl: broken, sleep: async () => {} })({ from: FROM, to: NOW }), (error) => {
    assert.equal(error.message, 'PROVIDER_REQUEST_FAILED:TypeError:ECONNRESET');
    return true;
  });

  const truncated = mockMercadoPago(() => ({ status: 200, body: { paging: { total: 500 }, results: [mpPayment(1)] } }));
  const partial = await createMercadoPagoSearchProvider({ tokenEnv: 'TABA_MP_READ_TOKEN', env, fetchImpl: truncated.fetchImpl, pageSize: 1, maxPages: 2 })({ from: FROM, to: NOW });
  assert.equal(partial.coverage.complete, false, 'si no se llegó al total, el resultado se declara incompleto');

  await assert.rejects(createMercadoPagoSearchProvider({ tokenEnv: 'TABA_MP_READ_TOKEN', env: {}, fetchImpl: denied.fetchImpl })({ from: FROM, to: NOW }), /PROVIDER_TOKEN_ENV_EMPTY:TABA_MP_READ_TOKEN/);
  assert.equal(denied.calls.length, 1, 'sin token no se llama a nadie');
});

test('el flag del token recibe un NOMBRE de variable; un token pegado se rechaza sin repetirlo', () => {
  assert.equal(assertTokenEnvName('TABA_MP_READ_TOKEN'), 'TABA_MP_READ_TOKEN');
  const token = fakeToken();
  for (const bad of [token, 'lower_case', 'A', '', 'CON ESPACIO']) {
    assert.throws(() => assertTokenEnvName(bad), (error) => {
      assert.match(error.message, /INVALID_TOKEN_ENV_NAME/);
      if (bad.length > 3) assert.ok(!error.message.includes(bad), 'el valor recibido no se repite');
      return true;
    });
  }
  assert.throws(() => parseReconcileArgs(['--target', 'staging', '--business-id', BUSINESS, '--provider-token-env', token]), (error) => {
    assert.ok(!error.message.includes(token));
    return true;
  });
});

// ── Adaptador de archivo ─────────────────────────────────────────────────────
test('export del proveedor: formas aceptadas y qué cobertura declara cada una', async () => {
  const search = { query: { begin_date: FROM, end_date: NOW }, paging: { total: 2, limit: 50, offset: 0 }, results: [mpPayment(1), mpPayment(2)] };
  const declared = providerRowsFromExport(search);
  assert.equal(declared.payments.length, 2);
  assert.deepEqual(declared.coverage, { mode: 'export', complete: true, range: { from: FROM, to: NOW, source: 'declared' }, queriedReferences: [],
    query_declared: true, filtered: false });

  // Sin la consulta declarada no hay rango: no se infiere de las fechas de los pagos.
  const undeclared = providerRowsFromExport({ paging: { total: 2 }, results: [mpPayment(1), mpPayment(2, { date_created: '2026-10-01T09:00:00.000-03:00' })] });
  assert.equal(undeclared.coverage.range, null);
  assert.equal(undeclared.coverage.query_declared, false);

  const pages = providerRowsFromExport([{ paging: { total: 3 }, results: [mpPayment(1), mpPayment(2)] }, { paging: { total: 3 }, results: [mpPayment(2), mpPayment(3)] }]);
  assert.equal(pages.payments.length, 3, 'un pago repetido entre páginas cuenta una vez');
  assert.equal(pages.coverage.complete, true);
  assert.equal(providerRowsFromExport({ paging: { total: 9 }, results: [mpPayment(1)] }).coverage.complete, false, 'faltan páginas');

  const loose = providerRowsFromExport([mpPayment(1)]);
  assert.equal(loose.coverage.complete, false, 'una lista suelta no dice si está completa');
  assert.equal(loose.coverage.range, null);
  assert.throws(() => providerRowsFromExport({ payments: [] }), /PROVIDER_EXPORT_SHAPE/);

  const read = [];
  const fetchProviderPayments = createExportProvider({ filePath: 'exports/mp.json', readFile: (file, encoding) => { read.push([file, encoding]); return `\uFEFF${JSON.stringify(search)}`; } });
  assert.equal((await fetchProviderPayments({ from: FROM, to: NOW })).payments.length, 2);
  assert.deepEqual(read, [['exports/mp.json', 'utf8']]);
  await assert.rejects(createExportProvider({ filePath: 'x.json', readFile: () => '{nope' })({}), /PROVIDER_EXPORT_UNREADABLE/);
});

// ── La corrida completa, con las dos fuentes inyectadas ──────────────────────
function fakeDatabase({ windowRows, byReference = {} }) {
  const queries = [];
  const run = async (sql) => {
    queries.push(sql);
    const base = { schema: 'taba.payment_reconciliation.local.v1', server_time: NOW, business: { id: BUSINESS, slug: 'la-taba-cp' },
      settings: { environment: 'production', enabled: true, collector_id: '246813579' }, orders: [], refunds: [], disputes: [] };
    if (sql.includes('pi.external_reference in (')) {
      const intents = Object.entries(byReference).filter(([ref]) => sql.includes(`'${ref}'`)).map(([, row]) => ({ ...row, in_window: false }));
      return [{ payload: { ...base, intents, intent_total: intents.length } }];
    }
    return [{ payload: { ...base, ...windowRows, intent_total: windowRows.intents.length } }];
  };
  return { queries, run };
}
const cliOptions = (extra = []) => parseReconcileArgs(['--target', 'controlled-production', '--business-id', BUSINESS, '--from', FROM, '--to', NOW, ...extra]);

test('corrida completa: busca por referencia antes de decir que un pago falta localmente', async () => {
  const older = paidIntent(7, { created_at: '2026-09-10T10:00:00+00:00', updated_at: '2026-09-10T10:03:00+00:00', session_expires_at: '2026-09-10T10:15:00+00:00' });
  const database = fakeDatabase({ windowRows: { intents: [paidIntent(1), intent(2)], orders: [order(1)] }, byReference: { [reference(7)]: older } });
  const asked = [];
  const fetchProviderPayments = async (query) => {
    asked.push(query);
    return providerRows([mpPayment(1), mpPayment(7, { status: 'refunded', transaction_amount_refunded: 15000 }), mpPayment(8)], { queriedReferences: query.externalReferences });
  };
  const report = await reconcile({ options: cliOptions(['--provider-token-env', 'TABA_MP_READ_TOKEN']), runReadOnlySql: database.run, fetchProviderPayments, now: NOW });

  assert.deepEqual(asked[0].externalReferences, [reference(1)], 'sólo el que dice estar pago necesita consulta propia');
  assert.equal(asked[0].from, FROM);
  assert.equal(database.queries.length, 2);
  assert.ok(database.queries[1].includes(`'${reference(7)}'`) && database.queries[1].includes(`'${reference(8)}'`));
  assert.ok(database.queries.every((sql) => assertReadOnlySql(sql) === sql));

  const codes = report.findings.map((finding) => `${finding.code}/${finding.reason}/${finding.severity}`);
  assert.ok(codes.includes('PAYMENT_MISSING_LOCAL/no_local_intent/critical'), 'el pago 8 no tiene intent en ninguna fecha');
  assert.ok(codes.includes('REFUND_MISMATCH/refunded_total_differs/critical'), 'el pago 7 existe localmente, fuera de la ventana, y se compara');
  assert.equal(report.findings.filter((finding) => finding.code === 'PAYMENT_MISSING_LOCAL').length, 1);
  assert.equal(report.result, 'CRITICAL_FINDINGS');
  assert.equal(report.exit_code, EXIT.CRITICAL);
  assert.equal(report.exit_code, 3);
  assert.equal(report.read_only, true);
  assert.deepEqual(report.target, { name: 'controlled-production', project_ref: 'tkanbadcglszlcyfjvpv' });
  assert.equal(report.mode, 'provider-api');
  assert.equal(report.coverage.local_intents, 3);
  assert.doesNotMatch(JSON.stringify(report), PII_PATTERN);

  const lines = renderSummary(report);
  assert.match(lines[0], /PAYMENT RECONCILIATION · controlled-production \(tkanbadcglszlcyfjvpv\) · business la-taba-cp/);
  assert.ok(lines.some((line) => /^PAYMENT_MISSING_LOCAL\s+1\s+0\s+0$/.test(line)));
  assert.ok(lines.some((line) => /^UNVERIFIED_AGAINST_PROVIDER\s+0\s+0\s+0$/.test(line)));
  assert.equal(lines.at(-1), 'RESULT: CRITICAL_FINDINGS (exit 3)');
  assert.doesNotMatch(lines.join('\n'), PII_PATTERN);
});

test('corrida local: sale 0, pero dice que no comparó nada contra el proveedor', async () => {
  const database = fakeDatabase({ windowRows: { intents: [paidIntent(1), intent(2)], orders: [order(1)] } });
  const report = await reconcile({ options: cliOptions(['--local-only']), runReadOnlySql: database.run, now: NOW });
  assert.equal(report.exit_code, EXIT.OK);
  assert.equal(report.result, 'NO_CRITICAL_FINDINGS');
  assert.equal(report.mode, 'local-only');
  assert.equal(report.coverage.reconciled, 0);
  assert.equal(report.coverage.unverified_against_provider, 2);
  assert.equal(database.queries.length, 1);
  const lines = renderSummary(report);
  assert.ok(lines.some((line) => /^UNVERIFIED_AGAINST_PROVIDER\s+0\s+0\s+2$/.test(line)));
  assert.ok(lines.some((line) => line.includes('NO provider data')));
  assert.ok(lines.some((line) => line.includes('reconciled 0 of 2')));
});

test('corrida completa: dos ambientes sin --environment es un error de guarda, no un informe', async () => {
  const database = fakeDatabase({ windowRows: { intents: [paidIntent(1), paidIntent(2, { environment: 'test' })], orders: [order(1), order(2)] } });
  let called = 0;
  const fetchProviderPayments = async () => { called += 1; return providerRows([]); };
  await assert.rejects(reconcile({ options: cliOptions(['--provider-export', 'mp.json']), runReadOnlySql: database.run, fetchProviderPayments, now: NOW }), /MIXED_ENVIRONMENTS/);
  assert.equal(called, 0);
  const scoped = await reconcile({ options: cliOptions(['--provider-export', 'mp.json', '--environment', 'production']), runReadOnlySql: database.run,
    fetchProviderPayments: async () => providerRows([mpPayment(1)]), now: NOW });
  assert.deepEqual(scoped.coverage.unverified_reasons, { environment_not_covered: 1 });
  assert.equal(scoped.coverage.compared_against_provider, 1);
});

test('línea de comandos: lee el export, escribe el informe y sale con el código que corresponde', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taba-reconcile-'));
  try {
    const exportFile = path.join(dir, 'mp-export.json');
    const out = path.join(dir, 'nested', 'report.json');
    const write = (payments) => fs.writeFileSync(exportFile, JSON.stringify({ query: { begin_date: FROM, end_date: NOW }, paging: { total: payments.length }, results: payments }));
    const database = fakeDatabase({ windowRows: { intents: [paidIntent(1), intent(2)], orders: [order(1)] } });
    const base = ['--target', 'staging', '--business-id', BUSINESS, '--from', FROM, '--to', NOW, '--provider-export', exportFile];
    const printed = [];
    const deps = { runReadOnlySql: database.run, now: NOW, print: (line) => printed.push(line), printError: (line) => printed.push(`ERR ${line}`) };

    write([mpPayment(1)]);
    assert.equal(await runCli([...base, '--out', out], deps), 0);
    const clean = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(clean.schema, 'taba.payment_reconciliation.report.v1');
    assert.equal(clean.result, 'NO_CRITICAL_FINDINGS');
    assert.deepEqual(clean.findings, []);
    assert.equal(clean.coverage.reconciled, 2);
    assert.equal(clean.coverage.provider_mode, 'export');
    assert.deepEqual(clean.window, { from: FROM, to: NOW, defaulted: false });
    assert.equal(printed.at(-1), 'RESULT: NO_CRITICAL_FINDINGS (exit 0)');

    write([mpPayment(1, { status: 'charged_back' })]);
    printed.length = 0;
    assert.equal(await runCli([...base, '--out', out, '--json'], deps), 3);
    const critical = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.deepEqual(JSON.parse(printed.join('\n')), critical, '--json imprime el mismo informe que escribe');
    assert.equal(critical.findings[0].code, 'STATUS_MISMATCH');
    assert.doesNotMatch(fs.readFileSync(out, 'utf8'), PII_PATTERN, 'el export trae datos del pagador y el informe no');
    assert.deepEqual(fs.readdirSync(dir).sort(), ['mp-export.json', 'nested'], 'lo único que escribe es su informe');

    // Un error de fuente no es «sin hallazgos»: sale 2.
    printed.length = 0;
    assert.equal(await runCli([...base.slice(0, -1), path.join(dir, 'no-existe.json')], deps), 2);
    assert.match(printed.join('\n'), /ERR PAYMENT_RECONCILIATION_FAILED: PROVIDER_EXPORT_UNREADABLE/);
    assert.equal(await runCli(base, { ...deps, runReadOnlySql: async () => [{ payload: { business: null, intent_total: 0, intents: [] } }] }), 2);
    assert.equal(await runCli(['--target', 'prod'], deps), 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── Guardas de la línea de comandos ──────────────────────────────────────────
test('argumentos: valores por defecto y forma de las opciones', () => {
  const options = parseReconcileArgs(['--target', 'staging', '--business-id', BUSINESS.toUpperCase()], { now: new Date(NOW) });
  assert.equal(options.target, 'staging');
  assert.equal(options.projectRef, 'ucbtjcurawxjwjdvvcvj');
  assert.equal(options.businessId, BUSINESS);
  assert.equal(options.to, NOW);
  assert.equal(options.from, '2026-09-24T15:00:00.000Z', 'por defecto, los últimos siete días');
  assert.equal(options.windowDefaulted, true);
  assert.equal(options.mode, 'local-only', 'sin fuente del proveedor declarada no se llama a nadie');
  assert.equal(options.lagMinutes, 30);
  assert.equal(options.refundStuckMinutes, 30);
  assert.equal(options.json, false);
  const full = parseReconcileArgs(['--target=controlled-production', '--business-id', BUSINESS, '--from', '2026-09-01T00:00:00-03:00', '--to', '2026-10-01T00:00:00-03:00',
    '--provider-export', 'exports/mp.json', '--environment', 'production', '--out', 'artifacts/reconciliation/report.json', '--json', '--lag-minutes', '45',
    '--refund-stuck-minutes', '120', '--project-ref', 'tkanbadcglszlcyfjvpv']);
  assert.equal(full.mode, 'provider-export');
  assert.equal(full.from, '2026-09-01T03:00:00.000Z');
  assert.equal(full.providerExport, 'exports/mp.json');
  assert.equal(full.lagMinutes, 45);
  assert.equal(full.refundStuckMinutes, 120);
  assert.equal(full.windowDefaulted, false);
  assert.equal(parseReconcileArgs(['--target', 'staging', '--business-id', BUSINESS, '--provider-token-env', 'TABA_MP_READ_TOKEN']).mode, 'provider-api');
});

test('argumentos: todo lo que no es una lectura bien definida se rechaza', () => {
  const base = ['--target', 'staging', '--business-id', BUSINESS];
  assert.throws(() => parseReconcileArgs([]), /Falta --target/);
  assert.throws(() => parseReconcileArgs(['--target', 'production', '--business-id', BUSINESS]), /UNKNOWN_TARGET/);
  assert.throws(() => parseReconcileArgs(['--target', 'staging']), /Falta --business-id/);
  assert.throws(() => parseReconcileArgs(['--target', 'staging', '--business-id', 'la-taba-cp']), /INVALID_UUID/);
  assert.throws(() => parseReconcileArgs([...base, '--project-ref', 'wwcpogltfgzgkrlilbcd']), /TARGET_REF_MISMATCH/);
  for (const flag of ['--fix', '--apply', '--write', '--repair', '--force']) {
    assert.throws(() => parseReconcileArgs([...base, flag]), /READ_ONLY_TOOL/, flag);
  }
  assert.throws(() => parseReconcileArgs([...base, '--verbose']), /Flag desconocido: --verbose/);
  assert.throws(() => parseReconcileArgs([...base, 'suelto']), /Flag desconocido/);
  assert.throws(() => parseReconcileArgs([...base, '--provider-export', 'a.json', '--local-only']), /excluyentes/);
  assert.throws(() => parseReconcileArgs([...base, '--provider-export', 'a.json', '--provider-token-env', 'TABA_MP_READ_TOKEN']), /excluyentes/);
  assert.throws(() => parseReconcileArgs([...base, '--from', FROM]), /van juntos/);
  assert.throws(() => parseReconcileArgs([...base, '--from', NOW, '--to', FROM]), /anterior/);
  assert.throws(() => parseReconcileArgs([...base, '--from', '2026-09-24', '--to', NOW]), /INVALID_INSTANT/);
  assert.throws(() => parseReconcileArgs([...base, '--environment', 'sandbox']), /--environment/);
  assert.throws(() => parseReconcileArgs([...base, '--out', 'informe.txt']), /\.json/);
  assert.throws(() => parseReconcileArgs([...base, '--out']), /necesita un valor/);
  assert.throws(() => parseReconcileArgs([...base, '--lag-minutes', 'abc']), /entero/);
  assert.throws(() => parseReconcileArgs([...base, '--target', 'staging']), /repetido/);
});

test('el proceso sale con 2 ante un error de uso, sin tocar la red', () => {
  const script = fileURLToPath(new URL('../scripts/payments/reconcile-payments.mjs', import.meta.url));
  const unknownTarget = spawnSync(process.execPath, [script, '--target', 'production', '--business-id', BUSINESS], { encoding: 'utf8' });
  assert.equal(unknownTarget.status, 2);
  assert.match(unknownTarget.stderr, /UNKNOWN_TARGET/);
  assert.equal(unknownTarget.stdout, '');
  const fix = spawnSync(process.execPath, [script, '--target', 'staging', '--business-id', BUSINESS, '--fix'], { encoding: 'utf8' });
  assert.equal(fix.status, 2);
  assert.match(fix.stderr, /READ_ONLY_TOOL/);
  // La variable del token vacía se detecta antes de leer credenciales o abrir una conexión.
  const env = { ...process.env };
  env.TABA_RECONCILE_ABSENT_TOKEN = '';
  const noToken = spawnSync(process.execPath, [script, '--target', 'staging', '--business-id', BUSINESS, '--provider-token-env', 'TABA_RECONCILE_ABSENT_TOKEN'], { encoding: 'utf8', env });
  assert.equal(noToken.status, 2);
  assert.match(noToken.stderr, /PROVIDER_TOKEN_ENV_EMPTY:TABA_RECONCILE_ABSENT_TOKEN/);
});

// ═════════════════════════════════════════════════════════════════════════════
// REGRESIONES DE LA REVISIÓN
// Cada test de acá abajo reproduce un caso que la herramienta daba por bueno
// (o por malo) sin serlo. Los nombres dicen qué se rompía.
// ═════════════════════════════════════════════════════════════════════════════
const summary = (result) => result.findings.map((finding) => `${finding.code}/${finding.reason}/${finding.severity}`);
const summaryReal = (result) => real(result).map((finding) => `${finding.code}/${finding.reason}/${finding.severity}`);
// Un checkout cuya preferencia vivió ANTES del rango consultado al proveedor.
const BEFORE_RANGE = Object.freeze({ created_at: '2026-09-24T14:50:00+00:00', session_expires_at: '2026-09-24T15:05:00+00:00' });
const SECOND_PAYMENT = '7000000099';

// Un Mercado Pago de mentira que responde como el de verdad: por rango de
// `date_created` (paginado) o por referencia exacta.
function searchableMercadoPago(allPayments, { pageCap = Infinity, referencePaging = true } = {}) {
  return mockMercadoPago((url) => {
    const query = url.searchParams;
    if (query.has('external_reference')) {
      const results = allPayments.filter((payment) => payment.external_reference === query.get('external_reference'));
      return { status: 200, body: referencePaging ? { paging: { total: results.length, limit: 50, offset: 0 }, results } : { results } };
    }
    const begin = Date.parse(query.get('begin_date'));
    const end = Date.parse(query.get('end_date'));
    const inRange = allPayments.filter((payment) => Date.parse(payment.date_created) >= begin && Date.parse(payment.date_created) <= end);
    const offset = Number(query.get('offset'));
    const limit = Math.min(Number(query.get('limit')), pageCap);
    return { status: 200, body: { paging: { total: inRange.length, limit, offset }, results: inRange.slice(offset, offset + limit) } };
  });
}

async function reconcileThroughHttpAdapter({ intents, orders, payments, from, to }) {
  const database = fakeDatabase({ windowRows: { intents, orders } });
  const provider = searchableMercadoPago(payments);
  const options = parseReconcileArgs(['--target', 'staging', '--business-id', BUSINESS, '--from', from, '--to', to, '--provider-token-env', 'TABA_MP_READ_TOKEN']);
  const fetchProviderPayments = createMercadoPagoSearchProvider({ tokenEnv: 'TABA_MP_READ_TOKEN', env: { TABA_MP_READ_TOKEN: fakeToken() }, fetchImpl: provider.fetchImpl, sleep: async () => {} });
  const report = await reconcile({ options, runReadOnlySql: database.run, fetchProviderPayments, now: NOW });
  return { report, calls: provider.calls };
}

// ── Bloqueante 1: el grupo de pagos de una referencia tiene que estar completo ─
test('regresión: un doble cobro a caballo del borde de la ventana no sale conciliado (S1) y un reintento rechazado no sale crítico (S2)', async () => {
  const from = '2026-09-30T00:00:00.000Z';
  const to = '2026-10-01T00:00:00.000Z';
  // El checkout nace 23:50 del día anterior; el primer pago (A) es de 23:54,
  // antes de --from; el segundo (B), sobre la misma preferencia, de 00:01.
  const straddling = { created_at: '2026-09-29T23:50:00+00:00', session_expires_at: '2026-09-30T00:05:00+00:00', approved_at: '2026-09-29T23:55:00+00:00',
    provider_event_at: '2026-09-30T00:02:00+00:00', updated_at: '2026-09-30T00:02:05+00:00' };
  const paymentA = mpPayment(1, { date_created: '2026-09-29T23:54:00.000Z', date_approved: '2026-09-29T23:55:00.000Z', date_last_updated: '2026-09-29T23:55:00.000Z' });
  const paymentB = mpPayment(1, { id: Number(SECOND_PAYMENT), date_created: '2026-09-30T00:01:00.000Z', date_approved: '2026-09-30T00:02:00.000Z', date_last_updated: '2026-09-30T00:02:00.000Z' });

  // S1: los dos aprobados. El rango sólo trae B; la consulta por referencia trae los dos.
  const doubleCharged = paidIntent(1, { ...straddling, provider_payment_id: SECOND_PAYMENT, approved_provider_payment_ids: [paymentId(1), SECOND_PAYMENT] });
  const s1 = await reconcileThroughHttpAdapter({ intents: [doubleCharged], orders: [order(1)], payments: [paymentA, paymentB], from, to });
  assert.equal(s1.calls.length, 2, 'una pasada por rango y una consulta por la referencia, aunque el rango ya la hubiera visto');
  assert.equal(s1.calls[1].url.searchParams.get('external_reference'), reference(1));
  assert.ok(s1.calls.every((call) => call.init.method === 'GET'));
  assert.deepEqual(summary(s1.report), ['ORDER_PAYMENT_MISMATCH/duplicate_approved_payment/critical']);
  assert.deepEqual(s1.report.findings[0].facts.provider_payments.map((payment) => payment.provider_payment_id).sort(), [paymentId(1), SECOND_PAYMENT]);
  assert.equal(s1.report.findings[0].facts.evidence, 'provider');
  assert.equal(s1.report.exit_code, 3);
  assert.equal(s1.report.coverage.reconciled, 0);

  // S2: B rechazado. El pedido está bien cobrado por A: ni crítico ni «id que no volvió».
  const paidOnce = paidIntent(1, straddling);
  const s2 = await reconcileThroughHttpAdapter({ intents: [paidOnce], orders: [order(1)], payments: [paymentA, { ...paymentB, status: 'rejected', status_detail: 'cc_rejected_other_reason', date_approved: null }], from, to });
  assert.deepEqual(summary(s2.report), []);
  assert.equal(s2.report.exit_code, 0);
  assert.equal(s2.report.coverage.reconciled, 1);
  assert.equal(s2.report.coverage.provider_references_queried, 1);
  assert.equal(s2.report.coverage.provider_comparison, 'full');

  // El mismo doble cobro contra el borde de arriba: A dentro de la ventana, B después de --to.
  const upper = { created_at: '2026-09-30T23:50:00+00:00', session_expires_at: '2026-10-01T00:05:00+00:00', approved_at: '2026-09-30T23:55:00+00:00',
    provider_event_at: '2026-10-01T00:02:00+00:00', updated_at: '2026-09-30T23:55:05+00:00' };
  const s3 = await reconcileThroughHttpAdapter({
    intents: [paidIntent(1, upper)], orders: [order(1)], from, to,
    payments: [{ ...paymentA, date_created: '2026-09-30T23:54:00.000Z', date_approved: '2026-09-30T23:55:00.000Z' }, { ...paymentB, date_created: '2026-10-01T00:01:00.000Z', date_approved: '2026-10-01T00:02:00.000Z' }],
  });
  assert.deepEqual(summary(s3.report), ['ORDER_PAYMENT_MISMATCH/duplicate_approved_payment/critical'], 'el segundo cobro cayó después de --to y se ve igual');
  assert.equal(s3.report.exit_code, 3);
});

test('regresión: dos pagos aprobados en los eventos locales y uno solo en el proveedor es un doble cobro sin desmentir', () => {
  const two = paidIntent(1, { provider_payment_id: SECOND_PAYMENT, approved_provider_payment_ids: [paymentId(1), SECOND_PAYMENT] });
  const partial = classify(localRows({ intents: [two], orders: [order(1)] }), providerRows([mpPayment(1, { id: Number(SECOND_PAYMENT) })]), OPTIONS);
  const finding = only(partial, 'ORDER_PAYMENT_MISMATCH');
  assert.equal(finding.reason, 'duplicate_approved_payment');
  assert.equal(finding.severity, 'critical');
  assert.equal(finding.facts.evidence, 'local_events');
  assert.deepEqual(finding.facts.unaccounted_provider_payment_ids, [paymentId(1)]);
  assert.deepEqual(finding.facts.provider_payment_ids_seen, [SECOND_PAYMENT]);
  assert.equal(partial.coverage.reconciled, 0, 'antes: reconciled 1 y ningún hallazgo');

  // El proveedor muestra los dos y uno ya está devuelto: explicado, no es un doble cobro vigente.
  const settled = classify(localRows({ intents: [two], orders: [order(1)] }),
    providerRows([mpPayment(1, { status: 'refunded', transaction_amount_refunded: 15000 }), mpPayment(1, { id: Number(SECOND_PAYMENT) })]), OPTIONS);
  assert.deepEqual(summary(settled), []);
  assert.equal(settled.coverage.reconciled, 1);

  // Los dos a la vista y los dos reteniendo la plata: un solo hallazgo, con evidencia del proveedor.
  const both = classify(localRows({ intents: [two], orders: [order(1)] }), providerRows([mpPayment(1), mpPayment(1, { id: Number(SECOND_PAYMENT) })]), OPTIONS);
  assert.deepEqual(summary(both), ['ORDER_PAYMENT_MISMATCH/duplicate_approved_payment/critical']);
  assert.equal(both.findings[0].facts.evidence, 'provider');
});

test('regresión: un grupo de pagos incompleto no concilia ni acusa; sólo vale lo que el pago visible prueba solo', () => {
  // Sólo se ve un rechazo y el cobro verdadero puede estar fuera del rango: no es «pagado sin cobro».
  const retry = classify(localRows({ intents: [paidIntent(1, BEFORE_RANGE)], orders: [order(1)] }),
    providerRows([mpPayment(1, { id: Number(SECOND_PAYMENT), status: 'rejected', date_approved: null })]), OPTIONS);
  assert.deepEqual(summary(retry), ['UNVERIFIED_AGAINST_PROVIDER/provider_group_incomplete/info'], 'antes: STATUS_MISMATCH crítico sobre un pedido bien cobrado');
  assert.equal(retry.findings[0].facts.partially_compared, false);
  assert.equal(retry.findings[0].facts.provider_group_incomplete_because, 'outside_provider_range');
  assert.equal(retry.totals.by_severity.critical, 0);
  assert.deepEqual([retry.coverage.compared_against_provider, retry.coverage.unverified_against_provider, retry.coverage.reconciled], [0, 1, 0]);

  // Se ve el cobro que la base conoce: se compara, pero no se da por conciliado (puede haber otro).
  const seen = classify(localRows({ intents: [paidIntent(1, BEFORE_RANGE)], orders: [order(1)] }), providerRows([mpPayment(1)]), OPTIONS);
  assert.deepEqual(summaryReal(seen), []);
  assert.deepEqual(seen.coverage.unverified_reasons, { provider_group_incomplete: 1 });
  assert.equal(seen.coverage.partially_compared, 1);
  assert.equal(seen.coverage.reconciled, 0, 'antes: reconciled 1');
  assert.deepEqual(seen.coverage.unverified_payment_intent_ids, [intentId(1)]);

  // Dos aprobados en los eventos y uno solo a la vista: el doble cobro sale aunque el grupo esté incompleto.
  const hidden = paidIntent(1, { ...BEFORE_RANGE, provider_payment_id: SECOND_PAYMENT, approved_provider_payment_ids: [paymentId(1), SECOND_PAYMENT] });
  assert.deepEqual(summary(classify(localRows({ intents: [hidden], orders: [order(1)] }), providerRows([mpPayment(1, { id: Number(SECOND_PAYMENT) })]), OPTIONS)),
    ['ORDER_PAYMENT_MISMATCH/duplicate_approved_payment/critical', 'UNVERIFIED_AGAINST_PROVIDER/provider_group_incomplete/info']);

  // Un contracargo a la vista vale por sí mismo, haya o no otros pagos.
  const chargedBack = classify(localRows({ intents: [paidIntent(1, BEFORE_RANGE)], orders: [order(1)] }), providerRows([mpPayment(1, { status: 'charged_back' })]), OPTIONS);
  assert.deepEqual(summary(chargedBack), ['STATUS_MISMATCH/provider_charged_back_local_not/critical', 'UNVERIFIED_AGAINST_PROVIDER/provider_group_incomplete/info']);

  // Con el grupo incompleto no se afirma que el id guardado «no volvió».
  const otherId = classify(localRows({ intents: [paidIntent(1, BEFORE_RANGE)], orders: [order(1)] }), providerRows([mpPayment(1, { id: Number(SECOND_PAYMENT) })]), OPTIONS);
  assert.deepEqual(summaryReal(otherId), []);
  assert.equal(otherId.coverage.reconciled, 0);
});

test('regresión: el adaptador HTTP pagina por lo recibido, exige un total para probar ausencia y admite una pasada sólo por referencias', async () => {
  const env = { TABA_MP_READ_TOKEN: fakeToken() };
  // El proveedor entrega 30 por página aunque se le pidan 50.
  const seventy = Array.from({ length: 70 }, (_, index) => mpPayment(100 + index, { date_created: new Date(Date.parse('2026-09-30T00:00:00Z') + index * 60_000).toISOString() }));
  const capped = searchableMercadoPago(seventy, { pageCap: 30 });
  const all = await createMercadoPagoSearchProvider({ tokenEnv: 'TABA_MP_READ_TOKEN', env, fetchImpl: capped.fetchImpl, sleep: async () => {} })({ from: FROM, to: NOW });
  assert.equal(all.payments.length, 70, 'antes: 50 de 70 con complete=true');
  assert.equal(all.coverage.complete, true);
  assert.deepEqual(capped.calls.map((call) => call.url.searchParams.get('offset')), ['0', '30', '60']);

  // Dice tener 70 y entrega siempre los mismos 30: no está completo.
  const stuck = mockMercadoPago(() => ({ status: 200, body: { paging: { total: 70, limit: 30, offset: 0 }, results: seventy.slice(0, 30) } }));
  const short = await createMercadoPagoSearchProvider({ tokenEnv: 'TABA_MP_READ_TOKEN', env, fetchImpl: stuck.fetchImpl, sleep: async () => {}, maxPages: 4 })({ from: FROM, to: NOW });
  assert.equal(short.coverage.complete, false, 'completo es tener tantos pagos distintos como el total declarado');
  assert.equal(short.payments.length, 30);

  // Una consulta por referencia sin `paging.total` no prueba que no haya pagos.
  const noPaging = searchableMercadoPago([], { referencePaging: false });
  const inconclusive = await createMercadoPagoSearchProvider({ tokenEnv: 'TABA_MP_READ_TOKEN', env, fetchImpl: noPaging.fetchImpl, sleep: async () => {} })({ externalReferences: [reference(1)], from: FROM, to: NOW });
  assert.deepEqual(inconclusive.coverage.queriedReferences, [], 'antes: quedaba como consultada, es decir, ausencia probada');
  assert.equal(inconclusive.coverage.reference_lookups_inconclusive, 1);
  const unproven = classify(localRows({ intents: [paidIntent(1, BEFORE_RANGE)], orders: [order(1)] }), inconclusive, OPTIONS);
  assert.deepEqual(summary(unproven), ['UNVERIFIED_AGAINST_PROVIDER/outside_provider_range/info'], 'no se inventa un PAYMENT_MISSING_PROVIDER');

  // Pasada sólo por referencias: ninguna búsqueda por rango, y no declara rango ni completitud.
  const byReference = searchableMercadoPago([mpPayment(7)]);
  const only7 = await createMercadoPagoSearchProvider({ tokenEnv: 'TABA_MP_READ_TOKEN', env, fetchImpl: byReference.fetchImpl, sleep: async () => {} })({ externalReferences: [reference(7)], from: FROM, to: NOW, referencesOnly: true });
  assert.equal(byReference.calls.length, 1);
  assert.equal(byReference.calls[0].url.searchParams.has('begin_date'), false);
  assert.deepEqual([only7.coverage.complete, only7.coverage.range, only7.coverage.queriedReferences], [false, null, [reference(7)]]);

  const merged = mergeProviderRows(all, only7);
  assert.equal(merged.payments.length, 71);
  assert.equal(merged.coverage.complete, true, 'el rango y la completitud son los de la pasada por rango');
  assert.deepEqual(merged.coverage.range, { from: FROM, to: NOW, source: 'query' });
  assert.deepEqual(merged.coverage.queriedReferences, [reference(7)]);
  assert.equal(merged.coverage.requests, 4);
});

test('regresión: un intent que entra por referencia después de la búsqueda también se consulta en el proveedor', async () => {
  // El pago 7 cae en el rango y su intent no está en la ventana (webhook perdido):
  // se lo trae por referencia, y su grupo de pagos se completa con una segunda pasada.
  const older = paidIntent(7, { created_at: '2026-09-24T14:50:00+00:00', updated_at: '2026-09-24T14:58:00+00:00', session_expires_at: '2026-09-24T15:05:00+00:00' });
  const database = fakeDatabase({ windowRows: { intents: [paidIntent(1)], orders: [order(1)] }, byReference: { [reference(7)]: older } });
  const asked = [];
  const fetchProviderPayments = async (query) => {
    asked.push(query);
    return providerRows([mpPayment(1), mpPayment(7)], { queriedReferences: query.externalReferences, ...(query.referencesOnly ? { complete: false, range: null } : {}) });
  };
  const report = await reconcile({ options: cliOptions(['--provider-token-env', 'TABA_MP_READ_TOKEN']), runReadOnlySql: database.run, fetchProviderPayments, now: NOW });
  assert.equal(asked.length, 2);
  assert.deepEqual(asked[1].externalReferences, [reference(7)]);
  assert.equal(asked[1].referencesOnly, true);
  assert.equal(report.coverage.unverified_against_provider, 0);
  assert.equal(report.coverage.compared_against_provider, 2);
  assert.equal(report.provider_comparison, 'full');
  assert.equal(report.provider_source.complete, true);
});

// ── Bloqueante 2: revisión de seguridad no es «coherente con cualquier cosa» ───
test('regresión: un intent en revisión con pedido y la plata fuera del vendedor produce hallazgo y no cuenta como conciliado', () => {
  const review = (overrides = {}) => paidIntent(1, { internal_status: 'security_review_required', security_review_reason: 'unknown_provider_status', session_status: 'manual_review_required', ...overrides });
  const run = (intentRow, orderRow, payment) => classify(localRows({ intents: [intentRow], orders: orderRow ? [orderRow] : [] }), payment ? providerRows([payment]) : null, OPTIONS);

  // A1 — PAY-05/06: completed → in_mediation → revisión → contracargo que el rango 150 no deja escribir.
  const a1 = run(review({ provider_status: 'charged_back' }), order(1), mpPayment(1, { status: 'charged_back', status_detail: 'settled' }));
  const delivered = only(a1, 'STATUS_MISMATCH');
  assert.equal(delivered.reason, 'provider_charged_back_local_in_review');
  assert.equal(delivered.severity, 'critical', 'pedido entregado y plata que se fue');
  assert.equal(delivered.facts.provider_status, 'charged_back');
  assert.equal(delivered.facts.local_internal_status, 'security_review_required');
  assert.equal(a1.coverage.reconciled, 0, 'antes: findings [] y reconciled 1');

  // A2 — el pedido todavía se puede frenar.
  const a2 = run(review({ provider_status: 'in_mediation' }), order(1, { status: 'preparing' }), mpPayment(1, { status: 'charged_back' }));
  assert.deepEqual(summary(a2), ['STATUS_MISMATCH/provider_charged_back_local_in_review/critical', 'ORDER_PAYMENT_MISMATCH/active_order_payment_reversed/critical']);
  assert.equal(a2.findings[1].facts.money_returned_via, 'chargeback');
  assert.equal(a2.coverage.reconciled, 0);

  // A5 — pago rechazado: el pedido no tiene plata detrás.
  const a5 = run(review(), order(1, { status: 'preparing' }), mpPayment(1, { status: 'rejected', date_approved: null }));
  const uncaptured = only(a5, 'ORDER_PAYMENT_MISMATCH');
  assert.equal(uncaptured.reason, 'order_payment_not_captured');
  assert.equal(uncaptured.severity, 'critical');
  assert.equal(uncaptured.facts.money_position, 'none');
  assert.equal(uncaptured.facts.money_evidence, 'provider');
  assert.equal(a5.coverage.reconciled, 0);

  // A6 — devuelto entero de los dos lados, pedido activo (PAY-02).
  const refundedBoth = mpPayment(1, { status: 'refunded', transaction_amount_refunded: 15000 });
  const a6 = run(review({ refunded_amount: '15000.00' }), order(1, { status: 'preparing' }), refundedBoth);
  const active = only(a6, 'ORDER_PAYMENT_MISMATCH');
  assert.equal(active.reason, 'active_order_payment_reversed');
  assert.equal(active.severity, 'critical');
  assert.equal(active.facts.money_returned_via, 'refund');
  assert.equal(a6.coverage.reconciled, 0);
  // …entregado: también, porque en revisión la base no puede mostrar la devolución.
  assert.deepEqual(summary(run(review({ refunded_amount: '15000.00' }), order(1), refundedBoth)), ['ORDER_PAYMENT_MISMATCH/delivered_order_payment_reversed/critical']);
  // …y cancelado: plata devuelta y pedido cerrado, no queda nada que hacer.
  const closed = run(review({ refunded_amount: '15000.00' }), order(1, { status: 'cancelled' }), refundedBoth);
  assert.deepEqual(summary(closed), []);
  assert.equal(closed.coverage.reconciled, 1);

  // Control (A4): en mediación la plata sigue retenida; era lo único que se avisaba.
  assert.deepEqual(summary(run(review({ provider_status: 'in_mediation' }), order(1), mpPayment(1, { status: 'in_mediation' }))),
    ['STATUS_MISMATCH/captured_payment_in_review_with_order/warning']);

  // Sin pedido y con contracargo: no hay nada que armar ni que devolver. Antes salía «cobrado sin pedido».
  const noOrder = review({ order_id: null, session_completed_order_id: null, request_order_ids: [] });
  assert.deepEqual(summary(run(noOrder, null, mpPayment(1, { status: 'charged_back' }))), ['STATUS_MISMATCH/provider_charged_back_local_in_review/warning']);

  // A3 — sin proveedor, con lo que la base misma guardó del contracargo.
  const a3 = run(review({ provider_status: 'charged_back' }), order(1), null);
  assert.deepEqual(summaryReal(a3), ['STATUS_MISMATCH/provider_charged_back_local_in_review/critical']);
  assert.equal(real(a3)[0].facts.evidence, 'local_snapshot');

  const ctx = { nowMs: Date.parse(NOW), lagMs: 30 * 60_000 };
  const chargedBack = normalizeProviderPayment(mpPayment(1, { status: 'charged_back' }));
  assert.deepEqual([statusVerdict({ internal_status: 'security_review_required', refunded_cents: 0 }, chargedBack, ctx).severity,
    statusVerdict({ internal_status: 'security_review_required', refunded_cents: 0 }, chargedBack, { ...ctx, hasLiveOrder: true }).severity], ['warning', 'critical']);
});

test('regresión: un pedido activo sobre plata devuelta es crítico por los importes, no sólo por el estado interno', () => {
  // PAY-02: intent «completed», pedido en preparación, todo devuelto de los dos lados.
  const built = classify(localRows({ intents: [paidIntent(1, { refunded_amount: '15000.00' })], orders: [order(1, { status: 'preparing' })] }),
    providerRows([mpPayment(1, { status: 'refunded', transaction_amount_refunded: 15000 })]), OPTIONS);
  assert.ok(summary(built).includes('ORDER_PAYMENT_MISMATCH/active_order_payment_reversed/critical'), 'antes: dos advertencias y salida 0');
  assert.equal(built.totals.by_severity.critical, 1);
  // Lo mismo sin proveedor, con los importes de la base.
  assert.ok(summaryReal(classify(localRows({ intents: [paidIntent(1, { refunded_amount: '15000.00' })], orders: [order(1, { status: 'preparing' })] }), null, OPTIONS))
    .includes('ORDER_PAYMENT_MISMATCH/active_order_payment_reversed/critical'));
  // Un reembolso posventa bien registrado sobre un pedido entregado no es un hallazgo.
  const refunds = [{ refund_id: refundId(1), payment_intent_id: intentId(1), provider_refund_id: '8001', amount: '15000.00', status: 'approved', requested_at: minutesAgo(120), completed_at: minutesAgo(119) }];
  const afterSale = classify(localRows({ intents: [paidIntent(1, { internal_status: 'refunded', refunded_amount: '15000.00' })], orders: [order(1)], refunds }),
    providerRows([mpPayment(1, { status: 'refunded', transaction_amount_refunded: 15000, refunds: [{ id: 8001, amount: 15000, status: 'approved', date_created: minutesAgo(119) }] })]), OPTIONS);
  assert.deepEqual(summary(afterSale), []);
  assert.equal(afterSale.coverage.reconciled, 1);
});

// ── Bloqueante 3: un dato que el proveedor no trajo no es un dato que coincide ─
test('regresión: sin datos de reembolsos o sin moneda del proveedor el intent no queda conciliado', () => {
  const stripRefundData = (payment) => { const copy = { ...payment }; delete copy.refunds; delete copy.transaction_amount_refunded; return copy; };
  const localRefund = [{ refund_id: refundId(1), payment_intent_id: intentId(1), provider_refund_id: '991', amount: '5000.00', status: 'approved', requested_at: minutesAgo(240), completed_at: minutesAgo(239) }];

  // Caso 1: la base dice «reembolso parcial», el proveedor «approved» sin campos de reembolso.
  const partial = classify(localRows({ intents: [paidIntent(1, { internal_status: 'partially_refunded', refunded_amount: '5000.00' })], orders: [order(1)], refunds: localRefund }),
    providerRows([stripRefundData(mpPayment(1))]), OPTIONS);
  assert.deepEqual(summary(partial), ['STATUS_MISMATCH/refund_state_not_confirmed/warning', 'UNVERIFIED_AGAINST_PROVIDER/provider_refund_data_missing/info'],
    'antes: la diferencia de estado se delegaba a una comparación de reembolsos que no corría');
  assert.deepEqual([partial.coverage.compared_against_provider, partial.coverage.unverified_against_provider, partial.coverage.partially_compared, partial.coverage.reconciled], [0, 1, 1, 0]);
  assert.equal(partial.coverage.refund_totals_not_comparable, 1);
  assert.deepEqual(partial.findings[1].facts.unverified_reasons, ['provider_refund_data_missing']);
  assert.equal(partial.findings[1].facts.partially_compared, true);

  // Caso 19: lo mismo contra un intent «completed».
  const completed = classify(localRows({ intents: [paidIntent(1)], orders: [order(1)] }), providerRows([stripRefundData(mpPayment(1))]), OPTIONS);
  assert.deepEqual(summary(completed), ['UNVERIFIED_AGAINST_PROVIDER/provider_refund_data_missing/info']);
  assert.equal(completed.coverage.reconciled, 0, 'antes: reconciled 1');
  // …y contra una fila ya normalizada con el total en null.
  const normalized = { ...normalizeProviderPayment(mpPayment(1)), refunded_total_cents: null, refund_detail_available: false };
  assert.deepEqual(summary(classify(localRows({ intents: [paidIntent(1)], orders: [order(1)] }), providerRows([normalized]), OPTIONS)),
    ['UNVERIFIED_AGAINST_PROVIDER/provider_refund_data_missing/info']);

  // Caso 4: sin moneda.
  const noCurrency = classify(localRows({ intents: [paidIntent(1)], orders: [order(1)] }), providerRows([mpPayment(1, { currency_id: undefined })]), OPTIONS);
  assert.deepEqual(summary(noCurrency), ['UNVERIFIED_AGAINST_PROVIDER/provider_currency_missing/info']);
  assert.equal(noCurrency.coverage.reconciled, 0, 'antes: reconciled 1');
  assert.deepEqual(noCurrency.coverage.unverified_reasons, { provider_currency_missing: 1 });

  // Las dos faltas juntas se nombran las dos.
  const both = classify(localRows({ intents: [paidIntent(1)], orders: [order(1)] }), providerRows([stripRefundData(mpPayment(1, { currency_id: undefined }))]), OPTIONS);
  assert.deepEqual(both.findings[0].facts.unverified_reasons, ['provider_currency_missing', 'provider_refund_data_missing']);
  assert.equal(both.coverage.provider_comparison, 'partial');

  // Un pago que nunca cobró no tiene reembolsos que traer: ahí no falta nada.
  const rejected = classify(localRows({ intents: [intent(3, { internal_status: 'cancelled', provider_payment_id: paymentId(3), provider_status: 'rejected', session_status: 'cancelled' })] }),
    providerRows([stripRefundData(mpPayment(3, { status: 'rejected', date_approved: null }))]), OPTIONS);
  assert.deepEqual(summary(rejected), []);
  assert.equal(rejected.coverage.reconciled, 1);

  // Sin total del proveedor queda la coherencia interna de los reembolsos.
  const inconsistent = classify(localRows({ intents: [paidIntent(1, { internal_status: 'partially_refunded', refunded_amount: '4000.00' })], orders: [order(1)], refunds: localRefund }),
    providerRows([stripRefundData(mpPayment(1))]), OPTIONS);
  assert.ok(summary(inconsistent).includes('REFUND_MISMATCH/intent_refunded_below_local_refunds/critical'));

  // `deferred` sólo cuando REFUND_MISMATCH de verdad puede comparar.
  const ctx = { nowMs: Date.parse(NOW), lagMs: 30 * 60_000 };
  const localPartial = { internal_status: 'partially_refunded', refunded_cents: 500000 };
  assert.equal(statusVerdict(localPartial, normalizeProviderPayment(mpPayment(1)), ctx).kind, 'deferred');
  const unknown = statusVerdict(localPartial, normalizeProviderPayment(stripRefundData(mpPayment(1))), ctx);
  assert.deepEqual([unknown.kind, unknown.reason, unknown.severity], ['mismatch', 'refund_state_not_confirmed', 'warning']);
});

// ── Observaciones no bloqueantes que se corrigieron ──────────────────────────
test('regresión: el atraso de un aprobado se mide desde date_approved, no desde el último toque del proveedor', () => {
  const waiting = intent(1, { internal_status: 'pending', provider_payment_id: paymentId(1), provider_status: 'pending', session_status: 'payment_pending',
    created_at: '2026-09-28T10:00:00+00:00', session_expires_at: '2026-09-28T10:15:00+00:00' });
  // Aprobado hace tres días; Mercado Pago tocó el pago hace cinco minutos (liberación de la plata).
  const touched = mpPayment(1, { date_created: '2026-09-28T10:02:00.000Z', date_approved: '2026-09-28T10:03:00.000Z', date_last_updated: minutesAgo(5) });
  const result = classify(localRows({ intents: [waiting] }), providerRows([touched]), OPTIONS);
  const finding = only(result, 'STATUS_MISMATCH');
  assert.equal(finding.reason, 'provider_approved_local_not_paid');
  assert.equal(finding.severity, 'critical');
  assert.ok(finding.facts.minutes_since_provider_update > 4000, 'antes: 5 minutos, atraso tolerado y salida 0');
  assert.equal(result.coverage.lag_tolerated, 0);
});

test('regresión: los mensajes de error no repiten lo que recibieron', async () => {
  const secret = fakeToken();
  const base = ['--target', 'staging', '--business-id', BUSINESS];
  const wrongPlaces = [['--target', secret, '--business-id', BUSINESS], ['--target', 'staging', '--business-id', secret], [...base, '--project-ref', secret],
    [...base, secret], [...base, `--${secret}`], [...base, `--provider-token=${secret}`], [...base, '--provider-token-env', secret], [...base, '--environment', secret],
    [...base, '--lag-minutes', secret], [...base, '--from', secret, '--to', NOW], [...base, '--out', secret]];
  for (const args of wrongPlaces) {
    assert.throws(() => parseReconcileArgs(args), (error) => {
      assert.ok(!error.message.includes(secret) && !error.message.includes(secret.slice(9, 25)), `un token pegado en ${args.at(-2)} no puede llegar al mensaje`);
      return true;
    });
  }
  assert.throws(() => resolveTarget(secret), (error) => error.message.startsWith('UNKNOWN_TARGET') && !error.message.includes(secret));
  assert.throws(() => resolveTarget('staging', secret), (error) => error.message.startsWith('TARGET_REF_MISMATCH') && !error.message.includes(secret));
  assert.throws(() => createManagementApiRunner({ projectRef: secret, token: 'x' }), (error) => error.message === 'PROJECT_REF_NOT_ALLOWED');
  assert.throws(() => buildLocalSnapshotSql({ businessId: BUSINESS, from: FROM, to: NOW, environment: secret }), (error) => !error.message.includes(secret));

  // El cuerpo de la Management API no se copia: ni el de un error ni el de un 200 que no es JSON.
  const cliToken = `sbp${'_'}${'k'.repeat(40)}`;
  const answering = (response) => createManagementApiRunner({ projectRef: TARGET_REFS.staging, token: cliToken, fetchImpl: async () => response });
  await assert.rejects(loadLocalRows(answering({ ok: false, status: 401, text: async () => JSON.stringify({ message: `Unauthorized ${cliToken}` }) }), { businessId: BUSINESS, from: FROM, to: NOW }),
    (error) => error.message === 'LOCAL_QUERY_HTTP_401');
  await assert.rejects(loadLocalRows(answering({ ok: true, status: 200, text: async () => '<html>Marina Quiroga cliente.real@example.com</html>' }), { businessId: BUSINESS, from: FROM, to: NOW }),
    (error) => error.message === 'LOCAL_QUERY_RESPONSE_NOT_JSON');
  await assert.rejects(loadLocalRows(async () => [{ payload: '{"intents": [ Marina Quiroga' }], { businessId: BUSINESS, from: FROM, to: NOW }),
    (error) => error.message === 'LOCAL_SNAPSHOT_SHAPE: el contenido no es JSON');

  // Por la línea de comandos, de punta a punta.
  const printed = [];
  const code = await runCli([...base, '--local-only'], { runReadOnlySql: answering({ ok: false, status: 500, text: async () => `boom ${cliToken} Marina Quiroga` }),
    now: NOW, print: (line) => printed.push(line), printError: (line) => printed.push(line) });
  assert.equal(code, 2);
  assert.deepEqual(printed, ['PAYMENT_RECONCILIATION_FAILED: LOCAL_QUERY_HTTP_500']);

  // Un error del motor puede citar el dato que lo causó: de ésos sólo sale el tipo.
  const failing = async (deps, args = [...base, '--local-only']) => {
    const lines = [];
    const exit = await runCli(args, { now: NOW, print: (line) => lines.push(line), printError: (line) => lines.push(line), ...deps });
    return { exit, lines };
  };
  const database = fakeDatabase({ windowRows: { intents: [paidIntent(1)], orders: [order(1)] } });
  assert.deepEqual(await failing({ runReadOnlySql: async () => { throw new TypeError(`Marina Quiroga ${secret}`); } }),
    { exit: 2, lines: ['PAYMENT_RECONCILIATION_FAILED: UNEXPECTED_TypeError'] });
  const offline = createManagementApiRunner({ projectRef: TARGET_REFS.staging, token: cliToken,
    fetchImpl: async () => { throw Object.assign(new TypeError(`fetch failed ${cliToken}`), { cause: { code: 'ENOTFOUND' } }); } });
  assert.deepEqual(await failing({ runReadOnlySql: offline }), { exit: 2, lines: ['PAYMENT_RECONCILIATION_FAILED: LOCAL_QUERY_REQUEST_FAILED:TypeError:ENOTFOUND'] });
  // Un adaptador del proveedor que no devuelve nada no es «cero pagos»: no hay informe ni salida 0.
  for (const nothing of [null, {}, { payments: [] }, { coverage: {} }]) {
    const answer = await failing({ runReadOnlySql: database.run, fetchProviderPayments: async () => nothing }, [...base, '--provider-token-env', 'TABA_MP_READ_TOKEN']);
    assert.equal(answer.exit, 2, JSON.stringify(nothing));
    assert.match(answer.lines.join('\n'), /^PAYMENT_RECONCILIATION_FAILED: PROVIDER_RESULT_SHAPE/);
  }
});

test('regresión: la lectura local exige el negocio pedido y un total entero', async () => {
  const answer = (payload) => async () => [{ payload }];
  const other = '99999999-9999-4999-8999-999999999999';
  await assert.rejects(loadLocalRows(answer({ business: { id: other, slug: 'otro' }, intent_total: 0, intents: [] }), { businessId: BUSINESS, from: FROM, to: NOW }),
    /LOCAL_SNAPSHOT_BUSINESS_MISMATCH/);
  for (const total of [null, undefined, '1', -1, 1.5]) {
    await assert.rejects(loadLocalRows(answer({ business: { id: BUSINESS }, intent_total: total, intents: [] }), { businessId: BUSINESS, from: FROM, to: NOW }),
      /LOCAL_SNAPSHOT_SHAPE: falta el total/, `intent_total ${total} ya no pasa por cero`);
  }
  const fine = await loadLocalRows(answer({ business: { id: BUSINESS.toUpperCase() }, intent_total: 0, intents: [] }), { businessId: BUSINESS, from: FROM, to: NOW });
  assert.equal(fine.intents.length, 0);
});

test('regresión: un export sin consulta declarada, o filtrado, no prueba ausencias ni concilia', () => {
  const local = localRows({ intents: [paidIntent(1), paidIntent(2), intent(3)], orders: [order(1), order(2)] });
  // La respuesta cruda de la búsqueda: completa según su `paging`, pero no dice qué se le pidió.
  const raw = providerRowsFromExport({ paging: { total: 1, limit: 30, offset: 0 }, results: [mpPayment(1)] });
  assert.deepEqual([raw.coverage.complete, raw.coverage.range, raw.coverage.query_declared], [true, null, false]);
  const undeclared = classify(local, raw, OPTIONS);
  assert.deepEqual(summaryReal(undeclared), [], 'antes: PAYMENT_MISSING_PROVIDER crítico por un rango inferido de los propios pagos');
  assert.deepEqual(undeclared.coverage.unverified_reasons, { provider_group_incomplete: 1, provider_range_unknown: 2 });
  assert.equal(undeclared.coverage.reconciled, 0, 'antes: el checkout sin pago dentro del rango inferido contaba como conciliado');

  // Un export filtrado por estado: aunque declare el rango, no está completo.
  const filtered = providerRowsFromExport({ query: { begin_date: FROM, end_date: NOW, status: 'approved' }, paging: { total: 1 }, results: [mpPayment(1)] });
  assert.deepEqual([filtered.coverage.complete, filtered.coverage.filtered], [false, true]);
  assert.deepEqual(summaryReal(classify(local, filtered, OPTIONS)), []);
  assert.equal(classify(local, filtered, OPTIONS).coverage.reconciled, 0);
  assert.equal(providerRowsFromExport({ query: { begin_date: FROM, end_date: NOW, range: 'date_approved' }, paging: { total: 0 }, results: [] }).coverage.filtered, true,
    'el rango tiene que ser por date_created, que es por donde se ubica la vida de la preferencia');

  // Declarada y sin filtros: ahí sí.
  const declared = providerRowsFromExport({ query: { begin_date: FROM, end_date: NOW, range: 'date_created', sort: 'date_created', criteria: 'asc', limit: 50, offset: 0 },
    paging: { total: 1 }, results: [mpPayment(1)] });
  assert.deepEqual([declared.coverage.complete, declared.coverage.filtered], [true, false]);
  const full = classify(local, declared, OPTIONS);
  assert.deepEqual(summaryReal(full), ['PAYMENT_MISSING_PROVIDER/no_provider_record/critical']);
  assert.equal(full.coverage.reconciled, 2);

  const lines = renderSummary({ target: { name: 'staging', project_ref: TARGET_REFS.staging }, business_id: BUSINESS, window: { from: FROM, to: NOW }, mode: 'provider-export',
    findings: undeclared.findings, totals: undeclared.totals, coverage: undeclared.coverage, provider_source: raw.coverage, result: 'NO_CRITICAL_FINDINGS', exit_code: 0 });
  assert.ok(lines.some((line) => line.includes('declares no "query"')));
  assert.equal(lines.at(-2), 'PROVIDER COMPARISON: PARTIAL — reconciled 0 of 3 intents');
});

test('regresión: una referencia ajena del proveedor no se copia al informe', () => {
  const freeText = 'Pedido de Marina Quiroga, Avenida Argentina 1234';
  const result = classify(localRows({ intents: [paidIntent(1)], orders: [order(1)] }),
    providerRows([mpPayment(1, { external_reference: freeText })], { queriedReferences: [reference(1)] }), OPTIONS);
  const finding = only(result, 'STATUS_MISMATCH');
  assert.equal(finding.reason, 'external_reference_differs');
  assert.equal(finding.facts.provider_external_reference, null);
  assert.equal(finding.facts.provider_external_reference_in_scope, false);
  assert.equal(finding.facts.local_external_reference, reference(1));
  assert.doesNotMatch(JSON.stringify(result), PII_PATTERN);
});

test('regresión: la guarda de SQL tampoco deja nombrar otra tabla ni otra columna', () => {
  const refused = [
    'select o.customer_phone as payload from public.orders o',
    'select o.customer_name as payload from public.orders o',
    'select cs.contact_snapshot as payload from public.checkout_sessions cs',
    'select p.rolpassword as payload from pg_catalog.pg_authid p',
    "select 'x' as payload from pg_catalog.pg_authid as p",
    'select o.id from public.customers o',
    'select o.id from auth.users o',
    'select lo_unlink.id from public.orders o',
    'select o.id from public.orders.id o',
    'select o . id from public.orders o',
    'select 1.5 as payload from public.orders o',
  ];
  for (const sql of refused) assert.throws(() => assertReadOnlySql(sql), /READ_ONLY_SQL_REFUSED/, sql);
  // Lo que sí pasa usa sólo las tablas y columnas de la consulta de la herramienta.
  assert.equal(assertReadOnlySql('select o.id as payload from public.orders o where o.business_id is not null'), 'select o.id as payload from public.orders o where o.business_id is not null');
});

test('regresión: --out no pisa un archivo ajeno, los interruptores no llevan valor y el resumen dice cuánto se comparó', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taba-reconcile-out-'));
  try {
    const database = fakeDatabase({ windowRows: { intents: [paidIntent(1), intent(2)], orders: [order(1)] } });
    const base = ['--target', 'staging', '--business-id', BUSINESS, '--from', FROM, '--to', NOW, '--local-only'];
    const printed = [];
    const deps = { runReadOnlySql: database.run, now: NOW, print: (line) => printed.push(line), printError: (line) => printed.push(`ERR ${line}`) };

    const victim = path.join(dir, 'package.json');
    fs.writeFileSync(victim, '{"name":"no-tocar"}');
    assert.equal(await runCli([...base, '--out', victim], deps), 2);
    assert.match(printed.join('\n'), /ERR PAYMENT_RECONCILIATION_FAILED: OUT_FILE_EXISTS/);
    assert.equal(fs.readFileSync(victim, 'utf8'), '{"name":"no-tocar"}', 'el archivo ajeno queda intacto');
    assert.equal(database.queries.length, 0, 'se rechaza antes de consultar nada');

    // Un informe anterior de la herramienta sí se reemplaza.
    const out = path.join(dir, 'report.json');
    printed.length = 0;
    assert.equal(await runCli([...base, '--out', out], deps), 0);
    assert.equal(await runCli([...base, '--out', out], deps), 0);
    const report = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(report.provider_comparison, 'none');
    assert.equal(report.provider_source, null);
    assert.equal(report.coverage.provider_comparison, 'none');
    // La salida es 0, y la línea anterior al resultado dice que no se comparó nada.
    assert.equal(printed.at(-1), 'RESULT: NO_CRITICAL_FINDINGS (exit 0)');
    assert.equal(printed.at(-2), 'PROVIDER COMPARISON: NONE — reconciled 0 of 2 intents');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const args = ['--target', 'staging', '--business-id', BUSINESS];
  assert.throws(() => parseReconcileArgs([...args, '--local-only=false', '--provider-export', 'x.json']), /--local-only no lleva valor/,
    'antes: «=false» se leía como sólo local');
  assert.throws(() => parseReconcileArgs([...args, '--json=0']), /--json no lleva valor/);
});

test('regresión: los archivos de la herramienta no llevan caracteres invisibles', () => {
  // Un U+FEFF o un carácter de control pegado dentro de una expresión regular
  // funciona hasta que un editor lo borra, o deja una aserción que nunca falla.
  const ranges = [[0x00, 0x08], [0x0B, 0x0C], [0x0E, 0x1F], [0x7F, 0x7F], [0xA0, 0xA0], [0x200B, 0x200F], [0x2028, 0x2029], [0x2060, 0x2060], [0xFEFF, 0xFEFF]];
  // Por código y no con una expresión regular: los escapes de esos caracteres son justo lo que una herramienta puede convertir en el carácter.
  const invisible = { test: (row) => [...row].some((char) => ranges.some(([from, to]) => char.codePointAt(0) >= from && char.codePointAt(0) <= to)) };
  for (const relative of [...TOOL_FILES, 'tests/payment-reconciliation.test.mjs']) {
    const text = source(relative);
    const line = text.split('\n').findIndex((row) => invisible.test(row));
    assert.equal(line, -1, `${relative}:${line + 1}`);
    assert.doesNotMatch(text, /\r/, `${relative} usa LF`);
  }
  // La aserción que el carácter de control había dejado sin efecto: la consulta no lee columnas de texto libre.
  assert.match('select r.reason from x', /\.reason\b/);
  assert.doesNotMatch(buildLocalSnapshotSql({ businessId: BUSINESS, from: FROM, to: NOW }), /\.reason\b|\.notes\b|\.details\b/);
});
