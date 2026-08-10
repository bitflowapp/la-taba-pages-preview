// Rearmar el pedido de un cobro que entró y se quedó sin reserva.
//
// La superficie llegó de fix/taba2-order-intake-dispatch (a186d29) partida en dos
// mitades que no se tocaban: el botón se ofrecía y el click terminaba en la
// reconciliación. Estas pruebas fijan la unión, y sobre todo fijan que el
// operador se entere de por qué NO se puede rearmar cuando no se puede.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  configureBusinessOperations,
  handleBusinessOperationsAction,
  renderBusinessOperations,
  resetBusinessOperationsForTests,
} from '../js/business/business-operations-center.js';
import { containsForbiddenVocabulary, humanizeFailure } from '../js/business/business-operation-language.js';
import { createSupabaseOrderRepository } from '../js/repositories/supabase_order_repository.js';

const READY_PAYMENTS = Object.freeze({
  settings_present: true, collector_configured: true, application_configured: true,
  collector_id_short: '8877', application_id_short: '2233', credentials_loaded: true,
  environment: 'test', signed_notice_at: '2026-08-04T10:00:00.000Z',
  test_payment_at: '2026-08-04T10:05:00.000Z', test_payment_order_created: true,
  test_payment_stock_applied: true, enabled: true, reserve_stock: true, storefront_ready: true,
});

// Un cobro aprobado cuya reserva venció: el servidor lo marca recuperable.
const RECOVERABLE = Object.freeze({
  payment_intent_id: 'p-9',
  checkout_session_id: 'cs-9',
  internal_status: 'security_review_required',
  security_review_reason: 'approved_after_reservation_expired',
  provider_status: 'approved',
  amount: 5000,
  currency: 'ARS',
  can_recover_order: true,
});

function target(dataset) {
  const node = { dataset, closest: (c) => (c === '[data-payment-action]' ? node : null) };
  return node;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function mountPayments({ role = 'owner', payments = [RECOVERABLE], ...overrides } = {}) {
  configureBusinessOperations({
    role,
    listPayments: async () => ({ ok: true, data: payments }),
    getPaymentsActivation: async () => ({ ok: true, data: READY_PAYMENTS }),
    onChange() {},
    ...overrides,
  });
  renderBusinessOperations('payments');
  await settle();
  return renderBusinessOperations('payments');
}

const click = (paymentIntent = 'p-9') => handleBusinessOperationsAction(
  target({ paymentAction: 'recover-order', paymentIntent }),
);

test('el Panel ofrece rearmar sólo cuando el servidor lo habilita', async () => {
  const habilitado = await mountPayments();
  assert.match(habilitado, /Armar el pedido de este cobro/);
  resetBusinessOperationsForTests();

  // Misma fila, sin la bandera del servidor: la acción no existe.
  const sinBandera = await mountPayments({
    payments: [{ ...RECOVERABLE, can_recover_order: false }],
  });
  assert.doesNotMatch(sinBandera, /Armar el pedido de este cobro/);
  resetBusinessOperationsForTests();

  // El equipo no la ve aunque el servidor la habilite: es una acción elevada.
  const equipo = await mountPayments({ role: 'staff' });
  assert.doesNotMatch(equipo, /Armar el pedido de este cobro/);
  resetBusinessOperationsForTests();
});

test('el equipo no rearma un pedido aunque dispare la acción a mano', async () => {
  const llamadas = [];
  await mountPayments({
    role: 'staff',
    recoverOrder: async (id) => { llamadas.push(id); return { ok: true }; },
  });
  const denied = await click();
  assert.equal(denied.ok, false);
  assert.match(denied.message, /dueño o el encargado/);
  assert.deepEqual(llamadas, [], 'no debería haber llegado al servidor');
  resetBusinessOperationsForTests();
});

test('rearmar el pedido va al rearmado y no a la reconciliación', async () => {
  // Ésta es la regresión: antes el click caía en el reconcile de más abajo y
  // contestaba "en unos segundos se actualiza solo" sin armar ningún pedido.
  const llamadas = [];
  await mountPayments({
    reconcilePayment: async (id) => { llamadas.push(['reconcilePayment', id]); return { ok: true }; },
    recoverOrder: async (id) => {
      llamadas.push(['recoverOrder', id]);
      return { ok: true, order_code: 'LT-0003', message: 'Pedido LT-0003 armado.' };
    },
  });
  const done = await click();
  assert.deepEqual(llamadas, [['recoverOrder', 'cs-9']], 'tiene que ir al rearmado y con el id de la compra');
  assert.equal(done.ok, true);
  assert.match(done.message, /LT-0003/);
  assert.doesNotMatch(done.message, /se actualiza solo/);
  resetBusinessOperationsForTests();
});

test('sin stock suficiente el operador se entera de qué falta y cuánto', async () => {
  await mountPayments({
    recoverOrder: async () => ({
      ok: false,
      reason: 'stock_insuficiente',
      message: 'No hay stock para armarlo: Fernet Branca 750 ml (hay 1, hacen falta 4). Devolvé el dinero desde el Panel.',
    }),
  });
  const sinStock = await click();
  assert.equal(sinStock.ok, false);
  assert.match(sinStock.message, /Fernet Branca 750 ml/);
  assert.match(sinStock.message, /hay 1, hacen falta 4/);
  assert.match(sinStock.message, /Devolvé el dinero/, 'tiene que decir qué hacer, no sólo que no se pudo');
  assert.deepEqual(containsForbiddenVocabulary(sinStock.message), []);
  resetBusinessOperationsForTests();
});

test('rearmar dos veces no crea un segundo pedido', async () => {
  let veces = 0;
  await mountPayments({
    recoverOrder: async () => {
      veces += 1;
      // El servidor es idempotente: la segunda vez reconoce el pedido ya armado.
      return veces === 1
        ? { ok: true, order_code: 'LT-0003', message: 'Pedido LT-0003 armado.' }
        : { ok: true, idempotent: true, order_code: 'LT-0003', message: 'El pedido de este cobro ya estaba armado.' };
    },
  });
  const primera = await click();
  const segunda = await click();
  assert.equal(primera.ok, true);
  assert.match(primera.message, /LT-0003 armado/);
  assert.equal(segunda.ok, true);
  assert.match(segunda.message, /ya estaba armado/, 'la segunda no puede anunciar un pedido nuevo');
  resetBusinessOperationsForTests();
});

test('mientras el rearmado está en vuelo el segundo click no dispara otro', async () => {
  let enVuelo;
  let veces = 0;
  await mountPayments({
    recoverOrder: async () => {
      veces += 1;
      await enVuelo;
      return { ok: true, message: 'Pedido LT-0003 armado.' };
    },
  });
  let liberar;
  enVuelo = new Promise((resolve) => { liberar = resolve; });
  const primera = click();
  await settle();
  const segunda = await click();
  assert.equal(segunda.ok, false);
  assert.match(segunda.message, /Ya hay algo en curso/);
  liberar();
  await primera;
  assert.equal(veces, 1, 'el servidor tiene que haber recibido una sola orden de rearmado');
  resetBusinessOperationsForTests();
});

test('un cobro sin compra asociada no intenta rearmar nada', async () => {
  const llamadas = [];
  await mountPayments({
    payments: [{ ...RECOVERABLE, checkout_session_id: null }],
    recoverOrder: async (id) => { llamadas.push(id); return { ok: true }; },
  });
  const sinCompra = await click();
  assert.equal(sinCompra.ok, false);
  assert.match(sinCompra.message, /no tiene una compra asociada/);
  assert.deepEqual(llamadas, []);
  assert.deepEqual(containsForbiddenVocabulary(sinCompra.message), []);
  resetBusinessOperationsForTests();
});

// ---------------------------------------------------------------------------
// El mensaje de faltantes, en el repositorio: tiene que llegar entero al Panel.
// ---------------------------------------------------------------------------

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const CHECKOUT_ID = '22222222-2222-4222-8222-222222222222';

function repositoryWithMissing(missing) {
  const client = {
    // recoverPaidCheckoutOrder no consulta la sesión: le alcanza con el cliente
    // armado. El permiso lo vuelve a exigir el servidor en la propia función.
    auth: {},
    from: () => ({}),
    rpc: async (name) => (name === 'recover_paid_checkout_order'
      ? { data: { ok: false, reason: 'stock_insuficiente', missing }, error: null }
      : { data: null, error: null }),
  };
  return createSupabaseOrderRepository({ client, businessId: BUSINESS_ID });
}

const faltante = (name, i) => ({ name, disponibles: i, necesarias: i + 3 });

test('con pocos faltantes se nombran todos', async () => {
  const repository = repositoryWithMissing([faltante('Fernet Branca 750 ml', 1)]);
  const res = await repository.recoverPaidCheckoutOrder(CHECKOUT_ID);
  assert.equal(res.ok, false);
  assert.match(res.message, /Fernet Branca 750 ml \(hay 1, hacen falta 4\)/);
  assert.equal(humanizeFailure(res.message, 'generico'), res.message, 'no puede caer en el genérico');
});

test('con muchos faltantes el detalle sigue llegando al operador', async () => {
  // Sin cortar la lista, cuatro faltantes daban 261 caracteres y humanizeFailure
  // devolvía un genérico: el operador perdía justo el dato que necesitaba.
  const repository = repositoryWithMissing([
    faltante('Cerveza Heineken lata 473 ml', 0),
    faltante('Fernet Branca 750 ml', 1),
    faltante('Coca-Cola retornable 1,25 L', 2),
    faltante('Vino Malbec Reserva 750 ml', 3),
    faltante('Agua Villavicencio 1,5 L', 4),
  ]);
  const res = await repository.recoverPaidCheckoutOrder(CHECKOUT_ID);
  assert.equal(res.ok, false);
  assert.ok(res.message.length <= 240, `el mensaje mide ${res.message.length} y se perdería entero`);
  assert.equal(humanizeFailure(res.message, 'generico'), res.message, 'tiene que sobrevivir al saneador');
  assert.match(res.message, /Cerveza Heineken lata 473 ml \(hay 0, hacen falta 3\)/);
  assert.match(res.message, /y \d+ más/, 'tiene que decir cuántos faltantes no entraron');
  assert.match(res.message, /Devolvé el dinero/);
  assert.deepEqual(containsForbiddenVocabulary(res.message), []);
});
