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
import { getState, normalizeOrderForStorage, setState } from '../js/state.js';
import { resetState, state } from './helpers.mjs';

beforeEach(() => {
  installStorageMock();
  clearFavoriteProductsForTests();
  clearCustomerHistoryForTests();
  resetRepositoryFactoryForTests();
  resetState();
});

test('favoritos se guardan localmente y se pueden alternar', () => {
  const saved = toggleFavoriteProduct('p-muzzarella');

  assert.equal(saved.ok, true);
  assert.deepEqual(getFavoriteProductIds(), ['p-muzzarella']);
  assert.match(globalThis.localStorage.getItem(STORAGE_KEYS.customerFavorites), /p-muzzarella/);

  const removed = toggleFavoriteProduct('p-muzzarella');
  assert.equal(removed.ok, true);
  assert.deepEqual(getFavoriteProductIds(), []);
});

test('repetir pedido usa precio actual del catalogo', () => {
  addToCart('p-muzzarella', 1);
  const created = createTestOrder();
  assert.equal(created.ok, true);

  setState({
    products: state().products.map((product) => (
      product.id === 'p-muzzarella' ? { ...product, price: 13000, stock: 5 } : product
    )),
  });

  const repeated = repeatCustomerOrder(created.order.id);

  assert.equal(repeated.ok, true);
  assert.deepEqual(state().cart, [{ productId: 'p-muzzarella', quantity: 1 }]);
  assert.equal(getCartSummary('pickup').subtotal, 13000);
});

test('repetir pedido no agrega productos no disponibles', () => {
  addToCart('p-muzzarella', 1);
  const created = createTestOrder();
  assert.equal(created.ok, true);

  setState({
    products: state().products.map((product) => (
      product.id === 'p-muzzarella' ? { ...product, available: false, stock: 5 } : product
    )),
  });

  const repeated = repeatCustomerOrder(created.order.id);

  assert.equal(repeated.ok, false);
  assert.deepEqual(state().cart, []);
  assert.match(repeated.message, /No se agregaron|no estan disponibles/i);
});

test('cupon publico desactivado no aplica descuentos', () => {
  addToCart('p-muzzarella', 1);

  const created = createTestOrder({ couponCode: 'taba10' });

  assert.equal(created.ok, true);
  assert.equal(created.order.coupon, null);
  assert.equal(created.order.discountTotal, 0);
  assert.equal(created.order.total, 8990);
});

test('cupon invalido informa error y no descuenta', () => {
  const preview = previewCouponDiscount('NOPE', 10000);
  assert.equal(preview.ok, false);
  assert.equal(preview.discountAmount, 0);
  assert.match(preview.message, /No hay cupones activos/i);

  addToCart('p-muzzarella', 1);
  const created = createTestOrder({ couponCode: 'NOPE' });
  assert.equal(created.ok, true);
  assert.equal(created.order.discountTotal, 0);
  assert.equal(created.order.coupon, null);
});

test('metodo de pago queda guardado en el pedido', () => {
  addToCart('p-muzzarella', 1);

  const created = createTestOrder({ paymentMethod: 'transfer' });

  assert.equal(created.ok, true);
  assert.equal(created.order.paymentMethodCode, 'transfer');
  assert.equal(getState().orders[0].paymentMethod, 'Transferencia');
});

test('observaciones, referencia y cambio efectivo quedan guardados', () => {
  addToCart('p-muzzarella', 1);

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

test('negocio ve metodo de pago sin inventar descuento', () => {
  addToCart('p-muzzarella', 1);
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
  assert.doesNotMatch(container.innerHTML, /TABA10/);
});

test('historial del cliente guarda pedidos recientes', () => {
  addToCart('p-muzzarella', 1);
  const first = createTestOrder({ customerName: 'Historial Uno' });
  addToCart('p-napolitana', 1);
  const second = createTestOrder({ customerName: 'Historial Dos' });

  const history = getCustomerOrderHistory();
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(history[0].id, second.order.id);
  assert.equal(history[1].id, first.order.id);
  assert.equal(history.length, 2);
});

test('repetir con carrito vacio arma el carrito sin pedir confirmacion', () => {
  addToCart('p-muzzarella', 1);
  const created = createTestOrder(); // crear pedido vacia el carrito
  assert.equal(created.ok, true);
  assert.deepEqual(state().cart, []);

  const repeated = repeatCustomerOrder(created.order.id);
  assert.equal(repeated.ok, true);
  assert.equal(repeated.needsConfirmation, undefined);
  assert.deepEqual(state().cart, [{ productId: 'p-muzzarella', quantity: 1 }]);
});

test('repetir con carrito no vacio no reemplaza sin confirmacion', () => {
  addToCart('p-muzzarella', 1);
  const created = createTestOrder();
  assert.equal(created.ok, true);

  // El cliente vuelve a cargar algo distinto en el carrito.
  addToCart('p-napolitana', 2);
  const before = state().cart.map((item) => ({ ...item }));

  const repeated = repeatCustomerOrder(created.order.id);
  assert.equal(repeated.ok, false);
  assert.equal(repeated.needsConfirmation, true);
  assert.equal(repeated.orderId, created.order.id);
  assert.match(repeated.message, /reemplazar/i);
  // El carrito actual queda intacto (cancelar = no hacer nada).
  assert.deepEqual(state().cart, before);
});

test('repetir con force reemplaza el carrito usando precios actuales', () => {
  addToCart('p-muzzarella', 1);
  const created = createTestOrder();
  assert.equal(created.ok, true);

  setState({
    products: state().products.map((product) => (
      product.id === 'p-muzzarella' ? { ...product, price: 13000, stock: 5 } : product
    )),
  });
  addToCart('p-napolitana', 2);

  const repeated = repeatCustomerOrder(created.order.id, { force: true });
  assert.equal(repeated.ok, true);
  assert.deepEqual(state().cart, [{ productId: 'p-muzzarella', quantity: 1 }]);
  assert.equal(getCartSummary('pickup').subtotal, 13000);
});

test('cashChange defensivo: un pedido viejo con transferencia se normaliza sin cambio', () => {
  const items = [{ productId: 'p-muzzarella', name: 'Vacio', quantity: 1, unitPrice: 1000, unit: 'kg' }];
  const transfer = normalizeOrderForStorage({
    id: 'LT-OLD-1',
    items,
    paymentMethodCode: 'transfer',
    paymentMethod: 'Transferencia',
    cashChange: '20000',
  });
  assert.equal(transfer.paymentMethodCode, 'transfer');
  assert.equal(transfer.cashChange, '');

  const cash = normalizeOrderForStorage({
    id: 'LT-OLD-2',
    items,
    paymentMethodCode: 'cash',
    paymentMethod: 'Efectivo',
    cashChange: '20000',
  });
  assert.equal(cash.paymentMethodCode, 'cash');
  assert.equal(cash.cashChange, '20000');
});

test('Supabase sigue opt-in: el modo default es preview local', () => {
  const previousLocation = globalThis.location;
  globalThis.location = { search: '' };
  try {
    assert.equal(getDataMode(), 'preview');
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
