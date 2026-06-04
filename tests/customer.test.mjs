import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { addToCart, getCartSummary, repeatCustomerOrder } from '../js/cart.js';
import { previewCouponDiscount } from '../js/core/promotions.js';
import {
  clearFavoriteProductsForTests,
  getFavoriteProductIds,
  toggleFavoriteProduct,
} from '../js/core/customer-preferences.js';
import {
  clearCustomerHistoryForTests,
  getCustomerOrderHistory,
} from '../js/core/customer-history.js';
import { getDataMode, resetRepositoryFactoryForTests } from '../js/repositories/repository_factory.js';
import { createOrderFromCheckout } from '../js/orders.js';
import { renderBusinessDashboard } from '../js/business.js';
import { BUSINESS_CONFIG, STORAGE_KEYS } from '../js/config.js';
import { getState, setState } from '../js/state.js';
import { resetState, state } from './helpers.mjs';

beforeEach(() => {
  installStorageMock();
  clearFavoriteProductsForTests();
  clearCustomerHistoryForTests();
  resetRepositoryFactoryForTests();
  resetState();
});

test('favoritos se guardan localmente y se pueden alternar', () => {
  const saved = toggleFavoriteProduct('p-vacio');

  assert.equal(saved.ok, true);
  assert.deepEqual(getFavoriteProductIds(), ['p-vacio']);
  assert.match(globalThis.localStorage.getItem(STORAGE_KEYS.customerFavorites), /p-vacio/);

  const removed = toggleFavoriteProduct('p-vacio');
  assert.equal(removed.ok, true);
  assert.deepEqual(getFavoriteProductIds(), []);
});

test('repetir pedido usa precio actual del catalogo', () => {
  addToCart('p-vacio', 1);
  const created = createTestOrder();
  assert.equal(created.ok, true);

  setState({
    products: state().products.map((product) => (
      product.id === 'p-vacio' ? { ...product, price: 13000, stock: 5 } : product
    )),
  });

  const repeated = repeatCustomerOrder(created.order.id);

  assert.equal(repeated.ok, true);
  assert.deepEqual(state().cart, [{ productId: 'p-vacio', quantity: 1 }]);
  assert.equal(getCartSummary('pickup').subtotal, 13000);
});

test('repetir pedido no agrega productos no disponibles', () => {
  addToCart('p-vacio', 1);
  const created = createTestOrder();
  assert.equal(created.ok, true);

  setState({
    products: state().products.map((product) => (
      product.id === 'p-vacio' ? { ...product, available: false, stock: 5 } : product
    )),
  });

  const repeated = repeatCustomerOrder(created.order.id);

  assert.equal(repeated.ok, false);
  assert.deepEqual(state().cart, []);
  assert.match(repeated.message, /No se agregaron|no estan disponibles/i);
});

test('cupon TABA10 aplica 10% sobre productos y queda en el pedido', () => {
  addToCart('p-vacio', 1);

  const created = createTestOrder({ couponCode: 'taba10' });

  assert.equal(created.ok, true);
  assert.equal(created.order.coupon.code, 'TABA10');
  assert.equal(created.order.discountTotal, 1120);
  assert.equal(created.order.total, 11200 - 1120 + BUSINESS_CONFIG.deliveryFee);
});

test('cupon invalido informa error y no descuenta', () => {
  const preview = previewCouponDiscount('NOPE', 10000);
  assert.equal(preview.ok, false);
  assert.equal(preview.discountAmount, 0);
  assert.match(preview.message, /Cupon invalido/i);

  addToCart('p-vacio', 1);
  const created = createTestOrder({ couponCode: 'NOPE' });
  assert.equal(created.ok, true);
  assert.equal(created.order.discountTotal, 0);
  assert.equal(created.order.coupon, null);
});

test('metodo de pago queda guardado en el pedido', () => {
  addToCart('p-vacio', 1);

  const created = createTestOrder({ paymentMethod: 'transfer' });

  assert.equal(created.ok, true);
  assert.equal(created.order.paymentMethodCode, 'transfer');
  assert.equal(getState().orders[0].paymentMethod, 'Transferencia');
});

test('observaciones, referencia y cambio efectivo quedan guardados', () => {
  addToCart('p-vacio', 1);

  const created = createTestOrder({
    customerNotes: 'Sin cebolla',
    customerReference: 'Porton negro',
    cashChange: 'Cambio de 20000',
    paymentMethod: 'cash',
  });

  assert.equal(created.ok, true);
  assert.equal(created.order.notes, 'Sin cebolla');
  assert.equal(created.order.addressDetails.reference, 'Porton negro');
  assert.equal(created.order.cashChange, 'Cambio de 20000');
});

test('negocio ve metodo de pago y descuento', () => {
  addToCart('p-vacio', 1);
  const created = createTestOrder({ paymentMethod: 'transfer', couponCode: 'TABA10' });
  assert.equal(created.ok, true);

  const previousDocument = globalThis.document;
  const container = { innerHTML: '' };
  globalThis.document = {
    querySelector(selector) {
      return selector === '[data-business-dashboard]' ? container : null;
    },
  };
  try {
    renderBusinessDashboard();
  } finally {
    globalThis.document = previousDocument;
  }

  assert.match(container.innerHTML, /Transferencia/);
  assert.match(container.innerHTML, /TABA10/);
  assert.match(container.innerHTML, /1\.120|1120/);
});

test('historial del cliente guarda pedidos recientes', () => {
  addToCart('p-vacio', 1);
  const first = createTestOrder({ customerName: 'Historial Uno' });
  addToCart('p-matambre', 1);
  const second = createTestOrder({ customerName: 'Historial Dos' });

  const history = getCustomerOrderHistory();
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(history[0].id, second.order.id);
  assert.equal(history[1].id, first.order.id);
  assert.equal(history.length, 2);
});

test('Supabase sigue opt-in: el modo default es demo local', () => {
  const previousLocation = globalThis.location;
  globalThis.location = { search: '' };
  try {
    assert.equal(getDataMode(), 'demo');
  } finally {
    globalThis.location = previousLocation;
  }
});

function createTestOrder(overrides = {}) {
  return createOrderFromCheckout({
    customerName: 'Cliente QA',
    customerPhone: '2995550000',
    customerStreetAddress: 'Roca 123',
    customerNeighborhood: 'Neuquen centro',
    customerReference: '',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
    customerNotes: '',
    couponCode: '',
    cashChange: '',
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
