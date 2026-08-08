import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { addToCart, getCartSummary, repeatCustomerOrder } from '../js/cart.js';
import { buildReorderPreview } from '../js/core/reorder.js';
import { clearCustomerHistoryForTests } from '../js/core/customer-history.js';
import { clearCustomerProfileForTests } from '../js/core/customer-profile.js';
import { createOrderFromCheckout } from '../js/orders.js';
import { resetRepositoryFactoryForTests } from '../js/repositories/repository_factory.js';
import { setState } from '../js/state.js';
import { CONFIRMED_DELIVERY_POINT, resetState, state } from './helpers.mjs';

beforeEach(() => {
  installStorageMock();
  clearCustomerHistoryForTests();
  clearCustomerProfileForTests();
  resetRepositoryFactoryForTests();
  resetState();
});

test('reorder: recalcula precios actuales al repetir', () => {
  addToCart('qa-gaseosa-cola', 1);
  const created = createTestOrder();
  setState({
    products: state().products.map((product) => (
      product.id === 'qa-gaseosa-cola' ? { ...product, price: 13000, stock: 5 } : product
    )),
  });

  const preview = buildReorderPreview(created.order, state().products);
  const repeated = repeatCustomerOrder(created.order.id);

  assert.equal(preview.priceChanged, true);
  assert.equal(preview.totals.subtotal, 13000);
  assert.equal(repeated.ok, true);
  assert.equal(getCartSummary('pickup').subtotal, 13000);
});

test('reorder: informa productos faltantes sin agregarlos al carrito', () => {
  addToCart('qa-gaseosa-cola', 1);
  const created = createTestOrder();
  setState({
    products: state().products.map((product) => (
      product.id === 'qa-gaseosa-cola' ? { ...product, available: false } : product
    )),
  });

  const preview = buildReorderPreview(created.order, state().products);
  const repeated = repeatCustomerOrder(created.order.id);

  assert.equal(preview.canRepeat, false);
  assert.equal(preview.skipped[0].productId, 'qa-gaseosa-cola');
  assert.equal(repeated.ok, false);
  assert.deepEqual(state().cart, []);
});

test('reorder: evita duplicados por doble toque', () => {
  addToCart('qa-gaseosa-cola', 1);
  const created = createTestOrder();

  const first = repeatCustomerOrder(created.order.id);
  const second = repeatCustomerOrder(created.order.id, { force: true });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(state().cart, [{ productId: 'qa-gaseosa-cola', quantity: 1 }]);
});

test('reorder: si el carrito tiene productos pide confirmacion antes de reemplazar', () => {
  addToCart('qa-gaseosa-cola', 1);
  const created = createTestOrder();
  addToCart('qa-jugo-naranja', 1);

  const repeated = repeatCustomerOrder(created.order.id);

  assert.equal(repeated.ok, false);
  assert.equal(repeated.needsConfirmation, true);
  assert.deepEqual(state().cart, [{ productId: 'qa-jugo-naranja', quantity: 1 }]);
});

test('reorder: el nuevo pedido queda marcado como pedido repetido real', () => {
  addToCart('qa-gaseosa-cola', 1);
  const first = createTestOrder();
  setState({
    products: state().products.map((product) => (
      product.id === 'qa-gaseosa-cola' ? { ...product, price: 13000, stock: 5 } : product
    )),
  });
  repeatCustomerOrder(first.order.id);
  addToCart('qa-jugo-naranja', 1);
  const second = createTestOrder();

  assert.equal(second.order.reorder.sourceOrderId, first.order.id);
  assert.equal(second.order.reorder.priceChanged, true);
  assert.equal(second.order.reorder.editedBeforeConfirm, true);
});

function createTestOrder(overrides = {}) {
  return createOrderFromCheckout({
    ...CONFIRMED_DELIVERY_POINT,
    customerName: 'Cliente Reorder',
    customerPhone: '2995551212',
    customerStreetAddress: 'Roca 123',
    customerNeighborhood: 'Neuquen centro',
    customerReference: '',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
    customerNotes: '',
    couponCode: '',
    cashChange: '',
    rememberCustomer: true,
    ...overrides,
  });
}

function installStorageMock() {
  const store = new Map();
  globalThis.localStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}
