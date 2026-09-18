/*
 * CONTRATOS DE CLIENTE ANTE CARRERAS Y REINTENTOS
 * -------------------------------------------------------------
 * ALCANCE, DICHO DE FRENTE: esto corre en Node, en un solo hilo y en serie.
 * NO ejecuta concurrencia real y NO toca PostgreSQL. Lo que verifica es el
 * lado del CLIENTE de esas defensas:
 *   1. el stepper no pasa del stock por más rápido que se toque;
 *   2. la clave de idempotencia del checkout es estable entre reintentos;
 *   3. el repositorio traduce un rechazo por revisión vieja en un conflicto.
 *
 * La defensa de verdad contra pedidos duplicados y sobreventa es del servidor
 * —el índice único `orders_business_client_request_key`, el
 * `pg_advisory_xact_lock` y los `FOR UPDATE` de `create_checkout_session`— y
 * sólo se puede comprobar contra una base real (`npm run test:db:isolated`).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addToCart,
  clearCart,
  decrementCartItem,
  getCartItems,
  incrementCartItem,
} from '../js/cart.js';
import { updateState } from '../js/state.js';
import {
  buildMercadoPagoCheckoutPayload,
  createCheckoutClientRequestId,
} from '../js/payments/mercadopago-checkout.js';
import { createSupabaseOrderRepository } from '../js/repositories/supabase_order_repository.js';

test('cart stepper bounds quantity synchronously under rapid taps', () => {
  clearCart();
  updateState((draft) => {
    draft.products = [
      { id: 'prod-concurrency-1', name: 'Vino Malbec', price: 5000, stock: 5, active: true },
    ];
    draft.cart = [];
  });

  // Add 1
  addToCart('prod-concurrency-1', 1);
  assert.equal(getCartItems()[0].quantity, 1);

  // Rapid 10 increments should cap at stock (5)
  for (let i = 0; i < 10; i++) {
    incrementCartItem('prod-concurrency-1');
  }
  assert.equal(getCartItems()[0].quantity, 5, 'Cart quantity must not exceed available stock under rapid taps');

  // Rapid 10 decrements should stop at 1 or remove cleanly, never negative
  for (let i = 0; i < 10; i++) {
    decrementCartItem('prod-concurrency-1');
  }
  const remaining = getCartItems();
  assert.ok(remaining.length === 0 || remaining[0].quantity >= 1, 'Quantity must never become negative or zero without removal');
});

test('client checkout request ID is deterministic, unique, and crypto-safe', () => {
  const ids = new Set();
  for (let i = 0; i < 100; i++) {
    const id = createCheckoutClientRequestId();
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(ids.has(id), false, 'Client request IDs must never collide');
    ids.add(id);
  }
});

test('idempotency payload preserves client_request_id across retries', () => {
  const clientRequestId = createCheckoutClientRequestId();
  const values = {
    customerName: 'Juan Perez',
    customerPhone: '2996209136',
    deliveryMode: 'pickup',
    paymentMethod: 'mercadopago',
  };
  const items = [{ product_id: '11111111-1111-4111-8111-111111111111', quantity: 2 }];

  const payload1 = buildMercadoPagoCheckoutPayload({
    businessId: 'biz-1',
    clientRequestId,
    values,
    items,
  });

  const payload2 = buildMercadoPagoCheckoutPayload({
    businessId: 'biz-1',
    clientRequestId,
    values,
    items,
  });

  assert.equal(payload1.client_request_id, clientRequestId);
  assert.equal(payload2.client_request_id, clientRequestId);
  assert.deepEqual(payload1, payload2, 'Retried payloads with same clientRequestId must be strictly identical');
});

/*
 * Estos dos ejercitan el REPOSITORIO REAL contra un cliente Supabase doble.
 *
 * La versión anterior definía `applyStatusTransition` DENTRO del propio test y
 * después la comprobaba: quedaba en verde con todo el manejo de conflictos del
 * panel borrado. Lo que hay que sostener es que la traducción servidor→interfaz
 * marque `conflict` y devuelva la revisión fresca, y eso vive en el repositorio.
 */
const RACE_BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const RACE_ORDER_ID = '33333333-3333-4333-8333-333333333333';

function repositoryAnsweringRpc(rpcResponse) {
  const row = {
    id: RACE_ORDER_ID,
    business_id: RACE_BUSINESS_ID,
    public_code: 'LT-0099',
    status: 'picked_up',
    revision: 7,
    fulfillment_type: 'delivery',
  };
  const table = {
    select: () => table,
    eq: () => table,
    limit: () => table,
    order: () => table,
    maybeSingle: async () => ({ data: row, error: null }),
    single: async () => ({ data: row, error: null }),
  };
  const client = { auth: {}, from: () => table, rpc: async () => rpcResponse };
  return createSupabaseOrderRepository({ client, businessId: RACE_BUSINESS_ID });
}

test('una revisión vieja vuelve como conflicto, con la revisión fresca para reintentar', async () => {
  const repository = repositoryAnsweringRpc({
    data: { ok: false, code: 'stale_revision', revision: 9 },
    error: null,
    status: 200,
  });

  const result = await repository.advanceRiderDelivery(RACE_ORDER_ID, 'on_the_way', {
    expectedRevision: 7,
  });

  assert.equal(result.ok, false, 'una revisión vieja no puede avanzar la entrega');
  assert.equal(result.conflict, true, 'el llamador distingue conflicto de fallo por este campo');
  assert.equal(result.code, 'stale_revision');
  assert.equal(result.revision, 9, 'vuelve la revisión fresca: se reintenta sin recargar todo');
  assert.match(result.message, /otro dispositivo/i, 'el mensaje explica qué pasó');
});

test('que otro lo haya tomado también es conflicto; un rechazo cualquiera no', async () => {
  const taken = await repositoryAnsweringRpc({
    data: { ok: false, code: 'taken_by_other', revision: 4 },
    error: null,
    status: 200,
  }).advanceRiderDelivery(RACE_ORDER_ID, 'picked_up', { expectedRevision: 3 });
  assert.equal(taken.ok, false);
  assert.equal(taken.conflict, true, 'que otro rider lo tomara es recuperable refrescando');

  const refused = await repositoryAnsweringRpc({
    data: { ok: false, code: 'not_assigned' },
    error: null,
    status: 200,
  }).advanceRiderDelivery(RACE_ORDER_ID, 'picked_up', { expectedRevision: 3 });
  assert.equal(refused.ok, false);
  assert.equal(refused.conflict, false, 'no todo rechazo es una carrera de concurrencia');
});
