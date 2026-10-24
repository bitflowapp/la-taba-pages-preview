import assert from 'node:assert/strict';
import test from 'node:test';

import {
  configureBusinessOperations,
  handleBusinessOperationsAction,
  mercadoPagoFailureMessage,
  renderBusinessOperations,
  resetBusinessOperationsForTests,
  setMercadoPagoReturn,
} from '../js/business/business-operations-center.js';
import { renderPaymentsSetupSurface } from '../js/business/business-panel-render.js';
import { containsForbiddenVocabulary } from '../js/business/business-operation-language.js';
import {
  CANCEL_SERVER_CONFIRMATION, paymentActionsFor, REFUND_SERVER_CONFIRMATION, validateCancelRequest,
} from '../js/business/business-payments-console.js';

const CONNECTED = Object.freeze({
  status: 'connected', seller_id: '3594962708', connected_at: '2026-10-21T23:10:00Z', environment: 'test',
  account_label: 'TESTUSER2708 · t•••@testuser.com',
});
const ENABLED = Object.freeze({ enabled: true, environment: 'test' });
const visibleText = (html) => html.replace(/<[^>]+>/g, ' ');
const actions = (html) => [...html.matchAll(/data-mp-connection-action="([a-z-]+)"/g)].map((m) => m[1]);

function target(selector, dataset = {}, root = null) {
  const node = {
    dataset,
    closest(candidate) {
      if (candidate === selector) return node;
      if (root && ['[data-business-ops-center]', '[data-payment-refund-form]', '[data-payment-cancel-form]'].includes(candidate)) return root;
      return null;
    },
  };
  return node;
}

function fieldRoot(values) {
  return {
    querySelector(selector) {
      const name = selector.match(/name="([^"]+)/)?.[1];
      return name && Object.hasOwn(values, name) ? values[name] : null;
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const mpAction = (action) => target('[data-mp-connection-action]', { mpConnectionAction: action });

test('la tarjeta dice el entorno y la cuenta vinculada, nunca el número de vendedor', () => {
  const html = renderPaymentsSetupSurface({ role: 'owner', connection: CONNECTED, activation: ENABLED });
  assert.match(html, /data-mp-environment="test"/);
  assert.match(html, /Modo prueba: no se mueve dinero real/);
  assert.match(html, /Vinculada con <strong>TESTUSER2708 · t•••@testuser\.com<\/strong>/);
  assert.doesNotMatch(html, /3594962708/);
  assert.deepEqual(actions(html), ['verify', 'pause', 'disconnect']);
  const production = renderPaymentsSetupSurface({ role: 'owner', connection: { ...CONNECTED, environment: 'production' } });
  assert.match(production, /data-mp-environment="production"/);
  assert.match(production, />Dinero real</);
  // Sin habilitación no se ofrece pausar: no hay nada que pausar.
  assert.deepEqual(actions(production), ['verify', 'disconnect']);
});

test('sin cuenta vinculada se aclara que vincular no activa los cobros', () => {
  const html = renderPaymentsSetupSurface({ role: 'owner', connection: { status: 'disconnected' } });
  assert.deepEqual(actions(html), ['connect']);
  assert.match(html, /Vincular la cuenta no activa los cobros/);
  assert.match(html, /TABA nunca recibe tu contraseña/);
});

test('cada resultado de la vuelta de Mercado Pago tiene su mensaje y ninguno usa jerga', () => {
  const cases = [
    ['connected', { ...CONNECTED, verification: { seller_identity_verified: true, blocking_reason: 'payments_not_enabled' } }, /Mercado Pago confirmó la cuenta y quedó vinculada/],
    ['connected', CONNECTED, /Tocá «Verificar conexión» para confirmar/],
    ['connected', { ...CONNECTED, verification: { seller_identity_verified: true, blocking_reason: 'seller_is_integrator' } }, /encontró algo para resolver/],
    ['connected', { ...CONNECTED, verification: { credentials_usable: false, blocking_reason: 'provider_unavailable' } }, /encontró algo para resolver/],
    ['connected', { status: 'disconnected' }, /la vinculación no figura/],
    ['cancelled', { status: 'disconnected' }, /Cancelaste la autorización/],
    ['expired', { status: 'disconnected' }, /venció o ya se usó/],
    ['session', { status: 'disconnected' }, /sesión del panel venció/],
    ['account', { status: 'disconnected' }, /no se puede usar en este entorno/],
    ['seller_changed', CONNECTED, /otra cuenta de Mercado Pago y no se cambió nada/],
    ['integrator_account', { status: 'disconnected' }, /cuenta de La Taba, no con la de tu comercio/],
    ['seller_in_use', { status: 'disconnected' }, /ya recibe los cobros de otro comercio/],
    ['error', { status: 'disconnected' }, /No pudimos completar la vinculación/],
  ];
  for (const [returnResult, connection, expected] of cases) {
    const html = renderPaymentsSetupSurface({ role: 'owner', connection, connectionUi: { returnResult } });
    assert.match(html, expected, returnResult);
    assert.deepEqual(containsForbiddenVocabulary(visibleText(html)), [], returnResult);
  }
  // Un valor desconocido no inventa un mensaje.
  const unknown = renderPaymentsSetupSurface({ role: 'owner', connection: CONNECTED, connectionUi: { returnResult: 'hack<script>' } });
  assert.doesNotMatch(unknown, /data-mp-connection-notice/);
});

test('el resultado guardado al volver se muestra una vez y se olvida con la próxima acción', async () => {
  setMercadoPagoReturn('cancelled');
  configureBusinessOperations({
    role: 'owner',
    mercadoPagoConnectionAction: async () => ({ ok: true, data: { connection: { status: 'disconnected' } } }),
    getPaymentsActivation: async () => ({ ok: true, data: { enabled: false } }),
    listPayments: async () => ({ ok: true, data: [] }),
    onChange() {},
  });
  renderBusinessOperations('payments-setup');
  await settle();
  assert.match(renderBusinessOperations('payments-setup'), /Cancelaste la autorización/);
  setMercadoPagoReturn('<img src=x>');
  assert.doesNotMatch(renderBusinessOperations('payments-setup'), /Cancelaste|data-mp-connection-notice/);
  resetBusinessOperationsForTests();
});

test('desvincular: primero revisa sin desvincular; «Mejor no» no cambia nada; «Sí» lo pide con la frase', async () => {
  const calls = [];
  let connection = { ...CONNECTED };
  configureBusinessOperations({
    role: 'owner',
    mercadoPagoConnectionAction: async (action, confirmation) => {
      calls.push([action, confirmation]);
      if (action === 'disconnect_preview') {
        return { ok: true, data: { connection, blocking: 0, pending: { open_payments: 0, approved_last_180_days: 3 } } };
      }
      if (action === 'disconnect') connection = { status: 'disconnected' };
      return { ok: true, data: { connection } };
    },
    getPaymentsActivation: async () => ({ ok: true, data: { enabled: false } }),
    listPayments: async () => ({ ok: true, data: [] }),
    onChange() {},
  });
  renderBusinessOperations('payments-setup');
  await settle();
  await handleBusinessOperationsAction(mpAction('disconnect'));
  let html = renderBusinessOperations('payments-setup');
  assert.match(html, /data-mp-disconnect-review="ready"/);
  assert.match(html, /3 cobro\(s\) de los últimos 6 meses/);
  assert.deepEqual(actions(html), ['disconnect-confirm', 'disconnect-cancel']);
  assert.deepEqual(calls.map(([action]) => action).filter((a) => a === 'disconnect'), []);
  await handleBusinessOperationsAction(mpAction('disconnect-cancel'));
  html = renderBusinessOperations('payments-setup');
  assert.doesNotMatch(html, /data-mp-disconnect-review/);
  assert.match(html, /La cuenta sigue vinculada/);
  await handleBusinessOperationsAction(mpAction('disconnect'));
  await handleBusinessOperationsAction(mpAction('disconnect-confirm'));
  assert.deepEqual(calls.filter(([action]) => action === 'disconnect'), [['disconnect', 'DISCONNECT_MERCADOPAGO']]);
  html = renderBusinessOperations('payments-setup');
  assert.match(html, /quedó desvinculado/);
  assert.deepEqual(actions(html), ['connect']);
  resetBusinessOperationsForTests();
});

test('con cobros pendientes no se desvincula: se explica qué falta y que se pausaron los cobros nuevos', async () => {
  configureBusinessOperations({
    role: 'owner',
    mercadoPagoConnectionAction: async (action) => {
      if (action === 'disconnect_preview') return { ok: true, data: { connection: CONNECTED, blocking: 0, pending: {} } };
      if (action === 'disconnect') {
        return { ok: false, code: 'DISCONNECT_PENDING_OPERATIONS',
          data: { paused: true, blocking: 3, pending: { open_payments: 2, refunds_in_progress: 1 } } };
      }
      return { ok: true, data: { connection: CONNECTED } };
    },
    getPaymentsActivation: async () => ({ ok: true, data: { enabled: false } }),
    listPayments: async () => ({ ok: true, data: [] }),
    onChange() {},
  });
  renderBusinessOperations('payments-setup');
  await settle();
  await handleBusinessOperationsAction(mpAction('disconnect'));
  const outcome = await handleBusinessOperationsAction(mpAction('disconnect-confirm'));
  assert.equal(outcome.ok, false);
  const html = renderBusinessOperations('payments-setup');
  assert.match(html, /data-mp-disconnect-review="blocked"/);
  assert.match(html, /2 cobro\(s\) sin cerrar/);
  assert.match(html, /1 devolución\(es\) en curso/);
  assert.match(html, /Pausamos los cobros online nuevos/);
  assert.deepEqual(containsForbiddenVocabulary(visibleText(html)), []);
  resetBusinessOperationsForTests();
});

test('pausar los cobros online usa su propia acción y relee el estado', async () => {
  let enabled = true;
  let paused = 0;
  configureBusinessOperations({
    role: 'owner',
    mercadoPagoConnectionAction: async () => ({ ok: true, data: { connection: CONNECTED } }),
    getPaymentsActivation: async () => ({ ok: true, data: { enabled } }),
    pauseOnlinePayments: async () => { paused += 1; enabled = false; return { ok: true, data: { enabled: false } }; },
    listPayments: async () => ({ ok: true, data: [] }),
    onChange() {},
  });
  renderBusinessOperations('payments-setup');
  await settle();
  assert.ok(actions(renderBusinessOperations('payments-setup')).includes('pause'));
  const outcome = await handleBusinessOperationsAction(mpAction('pause'));
  assert.equal(outcome.ok, true);
  assert.equal(paused, 1);
  const html = renderBusinessOperations('payments-setup');
  assert.match(html, /Cobros online pausados/);
  assert.equal(actions(html).includes('pause'), false);
  resetBusinessOperationsForTests();
});

test('una verificación que encuentra la autorización revocada lo dice y ofrece reconectar', async () => {
  configureBusinessOperations({
    role: 'owner',
    mercadoPagoConnectionAction: async () => ({ ok: true, data: {
      verification: { credentials_usable: false, online_payments_enabled: false, blocking_reason: 'reauthorization_required' },
      connection: { status: 'requires_reauthorization', deauthorized_at: '2026-10-21T23:30:00Z' },
    } }),
    getPaymentsActivation: async () => ({ ok: true, data: { enabled: false } }),
    listPayments: async () => ({ ok: true, data: [] }),
    onChange() {},
  });
  renderBusinessOperations('payments-setup');
  await settle();
  await handleBusinessOperationsAction(mpAction('verify'));
  const html = renderBusinessOperations('payments-setup');
  assert.match(html, /Requiere reconexión/);
  assert.match(html, /venció o fue revocada/);
  assert.match(html, /El permiso se quitó desde la cuenta de Mercado Pago/);
  assert.deepEqual(actions(html), ['connect']);
  assert.match(html, />Reconectar</);
  resetBusinessOperationsForTests();
});

// 2026-10-23: the QA link looked healthy while the integrator application belonged to the other environment and
// Mercado Pago refused every payment. The owner is told, without jargon, and nothing reads «cobros funcionan».
test('una verificación que encuentra la aplicación de otro entorno lo dice sin prometer cobros', async () => {
  configureBusinessOperations({
    role: 'owner',
    mercadoPagoConnectionAction: async () => ({ ok: true, data: {
      verification: { credentials_usable: true, online_payments_enabled: false, integrator_environment_matches: false,
        blocking_reason: 'integrator_environment_mismatch' },
      connection: CONNECTED,
    } }),
    getPaymentsActivation: async () => ({ ok: true, data: { enabled: false } }),
    listPayments: async () => ({ ok: true, data: [] }),
    onChange() {},
  });
  renderBusinessOperations('payments-setup');
  await settle();
  await handleBusinessOperationsAction(mpAction('verify'));
  const html = renderBusinessOperations('payments-setup');
  assert.match(html, /Mercado Pago rechazaría cada pago/);
  assert.doesNotMatch(html, /los cobros online funcionan/);
  assert.deepEqual(containsForbiddenVocabulary(visibleText(html)), []);
  resetBusinessOperationsForTests();
});

test('los errores del servidor llegan como mensajes con qué hacer, sin jerga', () => {
  for (const code of ['BUSINESS_FORBIDDEN', 'RATE_LIMITED', 'AUTH_REQUIRED', 'SESSION_REFRESH_REQUIRED', 'SELLER_REFRESHING',
    'ORIGIN_NOT_ALLOWED', 'DISCONNECT_PENDING_OPERATIONS', 'NETWORK', 'PAYMENT_UNAVAILABLE', '', 'X']) {
    const message = mercadoPagoFailureMessage(code);
    assert.ok(message.length > 20, code);
    assert.deepEqual(containsForbiddenVocabulary(message), [], code);
  }
  assert.match(mercadoPagoFailureMessage('RATE_LIMITED'), /Esperá unos minutos/);
  assert.match(mercadoPagoFailureMessage('BUSINESS_FORBIDDEN'), /dueño o el encargado/);
  assert.notEqual(mercadoPagoFailureMessage('RATE_LIMITED'), mercadoPagoFailureMessage('BUSINESS_FORBIDDEN'));
});

test('la devolución manda la frase del servidor y reusa la clave hasta tener respuesta', async () => {
  const requested = [];
  let answer = { ok: false, message: 'No pudimos procesar el pago en este momento.' };
  configureBusinessOperations({
    role: 'owner',
    listPayments: async () => ({ ok: true, data: [{ payment_intent_id: 'p-2', internal_status: 'completed', order_public_code: 'LT-9', amount: 3200, can_refund: true }] }),
    getPaymentsActivation: async () => ({ ok: true, data: { enabled: true } }),
    mercadoPagoConnectionAction: async () => ({ ok: true, data: { connection: CONNECTED } }),
    refundPayment: async (input) => { requested.push(input); return answer; },
    onChange() {},
  });
  renderBusinessOperations('payments');
  await settle();
  const form = (amount) => fieldRoot({ refundAmount: { value: amount }, refundReason: { value: 'Faltó un producto en la entrega' }, refundConfirmation: { value: 'DEVOLVER' } });
  const confirm = (amount) => handleBusinessOperationsAction(target('[data-payment-refund-confirm]', { paymentRefundConfirm: 'p-2' }, form(amount)));
  await confirm('1000');
  await confirm('1000');
  assert.equal(requested.length, 2);
  assert.equal(requested[0].confirmation, REFUND_SERVER_CONFIRMATION);
  assert.match(requested[0].idempotencyKey, /^[0-9a-f-]{36}$/);
  assert.equal(requested[1].idempotencyKey, requested[0].idempotencyKey, 'un reintento no es una devolución nueva');
  await confirm('900');
  assert.notEqual(requested[2].idempotencyKey, requested[0].idempotencyKey, 'otro importe es otra devolución');
  answer = { ok: true };
  await confirm('900');
  assert.equal(requested[3].idempotencyKey, requested[2].idempotencyKey);
  await confirm('900');
  assert.notEqual(requested[4].idempotencyKey, requested[3].idempotencyKey, 'después de una devolución confirmada, la siguiente es nueva');
  resetBusinessOperationsForTests();
});

test('cancelar un pago pendiente: sólo si el servidor lo permite, con CANCELAR escrito', async () => {
  assert.ok(paymentActionsFor({ can_cancel: true }, { elevated: true }).some((action) => action.id === 'cancel'));
  assert.equal(paymentActionsFor({ can_cancel: true }, { elevated: false }).some((action) => action.id === 'cancel'), false);
  assert.equal(paymentActionsFor({ can_cancel: false }, { elevated: true }).some((action) => action.id === 'cancel'), false);
  assert.equal(validateCancelRequest({ confirmation: 'si' }).ok, false);
  assert.equal(validateCancelRequest({ confirmation: ' cancelar ' }).ok, true);

  const requested = [];
  configureBusinessOperations({
    role: 'owner',
    listPayments: async () => ({ ok: true, data: [{ payment_intent_id: 'p-3', internal_status: 'in_process', amount: 500, can_cancel: true }] }),
    getPaymentsActivation: async () => ({ ok: true, data: { enabled: true } }),
    mercadoPagoConnectionAction: async () => ({ ok: true, data: { connection: CONNECTED } }),
    cancelPayment: async (input) => { requested.push(input); return { ok: true }; },
    onChange() {},
  });
  renderBusinessOperations('payments');
  await settle();
  await handleBusinessOperationsAction(target('[data-payment-action]', { paymentAction: 'cancel', paymentIntent: 'p-3' }));
  assert.match(renderBusinessOperations('payments'), /data-payment-cancel-form="p-3"/);
  const wrong = await handleBusinessOperationsAction(target('[data-payment-cancel-confirm]', { paymentCancelConfirm: 'p-3' },
    fieldRoot({ cancelConfirmation: { value: 'ok' } })));
  assert.equal(wrong.ok, false);
  assert.equal(requested.length, 0);
  const done = await handleBusinessOperationsAction(target('[data-payment-cancel-confirm]', { paymentCancelConfirm: 'p-3' },
    fieldRoot({ cancelConfirmation: { value: 'CANCELAR' } })));
  assert.equal(done.ok, true);
  assert.equal(requested[0].confirmation, CANCEL_SERVER_CONFIRMATION);
  assert.match(requested[0].idempotencyKey, /^[0-9a-f-]{36}$/);
  resetBusinessOperationsForTests();
});

// 2026-10-24: «Listo» se decía con sólo releer el estado. Ahora, al volver, se pide UNA verificación real.
test('al volver de Mercado Pago se verifica una sola vez y «Listo» depende de esa verificación', async () => {
  const calls = [];
  const verification = { seller_identity_verified: true, credentials_usable: true, blocking_reason: 'production_execution_not_enabled' };
  setMercadoPagoReturn('connected');
  configureBusinessOperations({
    role: 'owner',
    mercadoPagoConnectionAction: async (action) => {
      calls.push(action);
      return { ok: true, data: { connection: { ...CONNECTED, ...(action === 'verify' ? { verification } : {}) } } };
    },
    getPaymentsActivation: async () => ({ ok: true, data: { enabled: false } }),
    listPayments: async () => ({ ok: true, data: [] }),
    listManualPayments: async () => ({ ok: true, data: [] }),
    onChange() {},
  });
  renderBusinessOperations('payments-setup');
  await settle();
  const html = renderBusinessOperations('payments-setup');
  assert.deepEqual(calls, ['verify']);
  assert.match(html, /Mercado Pago confirmó la cuenta y quedó vinculada/);
  assert.match(html, /El cobro con dinero real todavía no está habilitado/);
  assert.deepEqual(containsForbiddenVocabulary(visibleText(html)), []);
  await handleBusinessOperationsAction(target('[data-payments-refresh]'));
  await settle();
  assert.equal(calls.filter((action) => action === 'verify').length, 1, 'no second provider verification');
  resetBusinessOperationsForTests();
});

test('la cuenta de La Taba vinculada por error se informa y no se dice «Listo»', async () => {
  setMercadoPagoReturn('connected');
  configureBusinessOperations({
    role: 'owner',
    mercadoPagoConnectionAction: async () => ({ ok: true, data: { connection: { ...CONNECTED, environment: 'production',
      verification: { seller_identity_verified: true, credentials_usable: true, seller_is_integrator: true, blocking_reason: 'seller_is_integrator' } } } }),
    getPaymentsActivation: async () => ({ ok: true, data: { enabled: false } }),
    listPayments: async () => ({ ok: true, data: [] }),
    listManualPayments: async () => ({ ok: true, data: [] }),
    onChange() {},
  });
  renderBusinessOperations('payments-setup');
  await settle();
  const html = renderBusinessOperations('payments-setup');
  assert.doesNotMatch(html, /Listo/);
  assert.match(html, /vinculada con la cuenta de La Taba en vez de la del comercio/);
  resetBusinessOperationsForTests();
});

test('la tarjeta no promete un cambio de cuenta que el servidor rechaza y aconseja la cuenta del comercio', () => {
  const linked = renderPaymentsSetupSurface({ role: 'owner', connection: CONNECTED });
  assert.doesNotMatch(linked, /Desvinculá y volvé a conectar con la correcta/);
  assert.match(linked, /el cambio de cuenta lo hace soporte/);
  const unlinked = renderPaymentsSetupSurface({ role: 'owner', connection: { status: 'disconnected' } });
  assert.match(unlinked, /data-mp-account-advice/);
  assert.match(unlinked, /la que va a recibir el dinero/);
  assert.deepEqual(containsForbiddenVocabulary(visibleText(unlinked)), []);
});
