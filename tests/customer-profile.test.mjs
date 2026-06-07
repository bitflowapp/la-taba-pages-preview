import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { addToCart } from '../js/cart.js';
import {
  buildCustomerSignals,
  clearCustomerProfileForTests,
  getCustomerProfile,
  getRememberedCheckoutValues,
} from '../js/core/customer-profile.js';
import { clearCustomerHistoryForTests, getCustomerOrderHistory } from '../js/core/customer-history.js';
import { createOrderFromCheckout } from '../js/orders.js';
import { STORAGE_KEYS } from '../js/config.js';
import { resetRepositoryFactoryForTests } from '../js/repositories/repository_factory.js';
import { getState, normalizeOrderForStorage } from '../js/state.js';
import { resetState } from './helpers.mjs';

beforeEach(() => {
  installStorageMock();
  clearCustomerHistoryForTests();
  clearCustomerProfileForTests();
  resetRepositoryFactoryForTests();
  resetState();
});

test('customer profile: crea y actualiza perfil local con consentimiento', () => {
  addToCart('p-vacio', 1);
  const first = createTestOrder({ rememberCustomer: true });
  addToCart('p-matambre', 2);
  const second = createTestOrder({ rememberCustomer: true, customerReference: 'Porton verde' });

  const profile = getCustomerProfile();

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(profile.name, 'Cliente QA');
  assert.equal(profile.phone, '2995550000');
  assert.equal(profile.orderCount, 2);
  assert.equal(profile.lastOrder.id, second.order.id);
  assert.equal(profile.totalSpent, first.order.total + second.order.total);
  assert.equal(profile.addressDetails.reference, 'Porton verde');
  assert.equal(profile.topProducts[0].productId, 'p-matambre');
  assert.match(globalThis.localStorage.getItem(STORAGE_KEYS.customerProfile), /2995550000/);
});

test('customer profile: sin consentimiento no guarda perfil ni historial de recompra', () => {
  addToCart('p-vacio', 1);
  const created = createTestOrder({ rememberCustomer: false });

  assert.equal(created.ok, true);
  assert.equal(getCustomerProfile(), null);
  assert.deepEqual(getCustomerOrderHistory(), []);
});

test('customer profile: expone datos recordados para autollenar checkout', () => {
  addToCart('p-vacio', 1);
  createTestOrder({ rememberCustomer: true, customerStreetAddress: 'Roca 123', customerNeighborhood: 'Centro' });

  const remembered = getRememberedCheckoutValues();

  assert.equal(remembered.customerName, 'Cliente QA');
  assert.equal(remembered.customerPhone, '2995550000');
  assert.equal(remembered.customerStreetAddress, 'Roca 123');
  assert.equal(remembered.customerNeighborhood, 'Centro');
  assert.equal(remembered.rememberCustomer, true);
});

test('customer signals: cuenta pedidos previos y cliente recurrente desde pedidos reales', () => {
  addToCart('p-vacio', 1);
  createTestOrder({ rememberCustomer: true });
  addToCart('p-matambre', 1);
  const second = createTestOrder({ rememberCustomer: true });

  const signals = buildCustomerSignals(getState().orders, second.order, new Date(second.order.createdAt));

  assert.equal(signals.previousOrderCount, 1);
  assert.equal(signals.orderCount, 2);
  assert.equal(signals.isRecurringCustomer, true);
  assert.equal(signals.isNewCustomer, false);
  assert.equal(signals.benefitAvailable, false);
});

test('customer signals: detecta beneficio disponible con el quinto pedido real', () => {
  let fifth = null;
  for (let index = 0; index < 5; index += 1) {
    addToCart(index % 2 === 0 ? 'p-vacio' : 'p-matambre', 1);
    fifth = createTestOrder({ rememberCustomer: true });
  }

  const signals = buildCustomerSignals(getState().orders, fifth.order, new Date(fifth.order.createdAt));

  assert.equal(signals.orderCount, 5);
  assert.equal(signals.benefitAvailable, true);
  assert.match(signals.loyaltyCopy, /comercio revisa/);
});

test('customer profile: normaliza pedidos viejos sin campos nuevos', () => {
  const oldOrder = normalizeOrderForStorage({
    id: 'LT-OLD',
    customerName: 'Cliente Viejo',
    customerPhone: '2991112222',
    address: 'Roca 1',
    items: [{ productId: 'p-vacio', name: 'Vacio', quantity: 1, unitPrice: 1000, unit: 'kg' }],
    createdAt: '2026-06-01T12:00:00.000Z',
  });

  const signals = buildCustomerSignals([oldOrder], oldOrder, new Date('2026-06-02T12:00:00.000Z'));

  assert.equal(signals.orderCount, 1);
  assert.equal(signals.isNewCustomer, true);
  assert.equal(signals.topProducts[0].productId, 'p-vacio');
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
