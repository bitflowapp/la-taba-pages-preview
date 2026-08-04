import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPaymentDiagnostic,
  classifyBusinessPayment,
  evaluateMercadoPagoSetup,
  MERCADOPAGO_STEPS,
  paymentActionsFor,
  PAYMENT_STATES,
  REFUND_CONFIRMATION_PHRASE,
  validateRefundRequest,
} from '../js/business/business-payments-console.js';
import { containsForbiddenVocabulary } from '../js/business/business-operation-language.js';

const CONNECTED = Object.freeze({
  settings_present: true,
  collector_configured: true,
  application_configured: true,
  collector_id_short: '998877',
  application_id_short: '112233',
  credentials_loaded: true,
  environment: 'test',
  signed_notice_at: '2026-08-04T10:00:00.000Z',
  test_payment_at: '2026-08-04T10:05:00.000Z',
  test_payment_order_created: true,
  test_payment_stock_applied: true,
  enabled: true,
  reserve_stock: true,
  storefront_ready: true,
});

test('el asistente tiene los siete pasos en el orden pedido', () => {
  assert.deepEqual([...MERCADOPAGO_STEPS], [
    'authorize', 'seller', 'test-credentials', 'notifications', 'test-payment', 'order-and-stock', 'ready',
  ]);
  const { steps } = evaluateMercadoPagoSetup(CONNECTED);
  assert.equal(steps.length, 7);
  assert.deepEqual(steps.map((step) => step.index), [1, 2, 3, 4, 5, 6, 7]);
});

test('con todo verificado el asistente declara Mercado Pago listo', () => {
  const result = evaluateMercadoPagoSetup(CONNECTED);
  assert.equal(result.ready, true);
  assert.equal(result.headline, 'Mercado Pago está listo para cobrar');
  assert.ok(result.steps.every((step) => step.state === 'done'));
});

test('sin credenciales de prueba el asistente frena en ese paso y no avanza solo', () => {
  const result = evaluateMercadoPagoSetup({
    ...CONNECTED,
    credentials_loaded: false,
    signed_notice_at: null,
    test_payment_at: null,
    test_payment_order_created: false,
    test_payment_stock_applied: false,
  });
  assert.equal(result.ready, false);
  assert.equal(result.currentStep, 'test-credentials');
  assert.equal(result.steps.find((step) => step.id === 'test-credentials').state, 'current');
  assert.equal(result.steps.find((step) => step.id === 'notifications').state, 'waiting');
});

test('un paso posterior verificado se muestra cumplido aunque falte uno anterior', () => {
  // El asistente refleja lo que realmente pasó; no reordena la realidad para contar una historia prolija.
  const result = evaluateMercadoPagoSetup({ ...CONNECTED, credentials_loaded: false });
  assert.equal(result.currentStep, 'test-credentials');
  assert.equal(result.steps.find((step) => step.id === 'notifications').state, 'done');
  assert.equal(result.ready, false);
});

test('un asistente vacío arranca en el primer paso sin inventar avances', () => {
  const result = evaluateMercadoPagoSetup({});
  assert.equal(result.currentStep, 'authorize');
  assert.equal(result.ready, false);
  assert.equal(result.steps.filter((step) => step.state === 'done').length, 0);
});

test('el asistente avisa los riesgos sin nombrar la plomería interna', () => {
  const result = evaluateMercadoPagoSetup({
    ...CONNECTED, reserve_stock: false, rejected_notices_recent: 2, storefront_ready: false,
  });
  assert.equal(result.warnings.length, 3);
  for (const warning of result.warnings) {
    assert.deepEqual(containsForbiddenVocabulary(warning), []);
  }
  for (const step of result.steps) {
    assert.deepEqual(containsForbiddenVocabulary(`${step.title} ${step.why} ${step.todo} ${step.detail}`), []);
  }
});

test('apuntar a dinero real sin revisión aprobada se marca como advertencia', () => {
  const result = evaluateMercadoPagoSetup({ ...CONNECTED, environment: 'production', production_review_status: 'pending' });
  assert.ok(result.warnings.some((warning) => /dinero real/i.test(warning)));
});

test('los pagos del día se clasifican en los siete estados operativos', () => {
  const cases = [
    [{ internal_status: 'preference_created' }, 'checking'],
    [{ internal_status: 'completed', order_public_code: 'LT-9' }, 'approved'],
    [{ internal_status: 'rejected' }, 'rejected'],
    [{ internal_status: 'in_process' }, 'pending'],
    [{ internal_status: 'refunded' }, 'refunded'],
    [{ internal_status: 'security_review_required' }, 'in-review'],
    [{ internal_status: 'approved_order_pending' }, 'approved-without-order'],
  ];
  for (const [payment, expected] of cases) {
    assert.equal(classifyBusinessPayment(payment).state, expected, JSON.stringify(payment));
  }
  assert.equal(new Set(cases.map(([, state]) => state)).size, PAYMENT_STATES.length);
});

test('un pago aprobado sin pedido nunca se muestra como aprobado a secas', () => {
  const classified = classifyBusinessPayment({ internal_status: 'approved', order_public_code: null });
  assert.equal(classified.state, 'approved-without-order');
  assert.equal(classified.blocksDelivery, true);
  assert.equal(classified.orderLabel, 'Sin pedido armado');
});

test('las acciones sensibles no se le ofrecen al equipo', () => {
  const payment = { can_reconcile: true, can_refund: true, internal_status: 'approved_order_pending' };
  const staff = paymentActionsFor(payment, { elevated: false }).map((action) => action.id);
  assert.deepEqual(staff, ['refresh', 'diagnostic']);

  const owner = paymentActionsFor(payment, { elevated: true }).map((action) => action.id);
  assert.deepEqual(owner, ['refresh', 'reconcile', 'diagnostic', 'refund']);
  assert.equal(paymentActionsFor(payment, { elevated: true }).find((action) => action.id === 'refund').requiresConfirmation, true);
});

test('actualizar la lista y consultar al proveedor son dos acciones distintas', () => {
  const actions = paymentActionsFor({ can_reconcile: true, internal_status: 'in_process' }, { elevated: true });
  const refresh = actions.find((action) => action.id === 'refresh');
  const reconcile = actions.find((action) => action.id === 'reconcile');
  assert.equal(refresh.kind, 'safe');
  assert.match(refresh.hint, /No cambia nada/i);
  assert.equal(reconcile.kind, 'elevated');
  assert.match(reconcile.label, /Mercado Pago/);

  // Releer siempre se puede, incluso en un pago que el proveedor ya no acepta consultar.
  const closed = paymentActionsFor({ internal_status: 'rejected' }, { elevated: true }).map((action) => action.id);
  assert.ok(closed.includes('refresh'));
  assert.equal(closed.includes('reconcile'), false);
});

test('el reembolso exige motivo, confirmación escrita y tope del importe cobrado', () => {
  assert.equal(validateRefundRequest({ reason: 'ok', confirmation: REFUND_CONFIRMATION_PHRASE }).ok, false);
  assert.equal(validateRefundRequest({ reason: 'Producto roto', confirmation: 'si' }).ok, false);
  assert.match(validateRefundRequest({ reason: 'Producto roto', confirmation: 'si' }).message, /DEVOLVER/);

  const partial = validateRefundRequest({ reason: 'Faltó un ítem', confirmation: 'devolver', amount: '150.556', maximum: 1000 });
  assert.equal(partial.ok, true);
  assert.equal(partial.amount, 150.56);

  const excessive = validateRefundRequest({ reason: 'Faltó un ítem', confirmation: 'DEVOLVER', amount: 5000, maximum: 1000 });
  assert.equal(excessive.ok, false);
  assert.match(excessive.message, /más de lo que se cobró/i);

  const total = validateRefundRequest({ reason: 'Cancelado por el cliente', confirmation: 'DEVOLVER' });
  assert.deepEqual({ ok: total.ok, amount: total.amount }, { ok: true, amount: null });
});

test('el diagnóstico para soporte no arrastra datos del cliente', () => {
  const diagnostic = buildPaymentDiagnostic({
    internal_status: 'ambiguous',
    order_public_code: 'LT-42',
    currency: 'ARS',
    payment_id_short: '445566',
    provider_status_detail: 'pending_review',
    created_at: '2026-08-04T09:00:00.000Z',
  });
  assert.deepEqual(Object.keys(diagnostic).sort(), [
    'currency', 'hasOrder', 'providerNote', 'reference', 'state', 'stateLabel', 'updatedAt',
  ]);
  assert.equal(diagnostic.state, 'in-review');
  assert.equal(diagnostic.reference, '445566');
});
