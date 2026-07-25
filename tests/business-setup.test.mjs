import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { BUSINESS_CONFIG, STORAGE_KEYS } from '../js/config.js';
import {
  buildDefaultBusinessConfig,
  getBusinessConfig,
} from '../js/core/business-config-store.js';
import {
  restoreBusinessSetupDemo,
  saveBusinessSetup,
  validateBusinessSetup,
} from '../js/core/business-setup.js';
import { lockAdmin, unlockAdmin } from '../js/business.js';
import {
  createOrderId,
  getProductById,
  getState,
  updateBusinessConfig,
} from '../js/state.js';
import { addToCart, getCartSummary, validateCartForCheckout } from '../js/cart.js';
import { createOrderFromCheckout } from '../js/orders.js';
import { applyBusinessConfig } from '../js/ui.js';
import { resetState } from './helpers.mjs';

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    clear() { values.clear(); },
  };
}

globalThis.localStorage = globalThis.localStorage || memoryStorage();
globalThis.sessionStorage = globalThis.sessionStorage || memoryStorage();

const validValues = Object.freeze({
  businessName: 'QA Store',
  subtitle: 'Almacen de pruebas',
  orderPrefix: 'QA',
  address: 'Roca 123, Neuquen',
  whatsappNumber: '+54 9 299 555 1234',
  deliveryZone: 'Centro y alrededores',
  openingHoursLabel: 'Lunes a viernes 10 a 20',
  openHour: '10',
  closeHour: '20',
  deliveryFee: '777',
  minDeliveryOrder: '1000',
  adminPin: '4567',
});

beforeEach(() => {
  Object.defineProperty(globalThis, 'location', {
    value: { search: '?demo=1' },
    configurable: true,
  });
  globalThis.localStorage.clear();
  globalThis.sessionStorage.clear();
  resetState();
  updateBusinessConfig(buildDefaultBusinessConfig());
});

test('business setup valida formulario antes de guardar', () => {
  const cases = [
    ['nombre vacio falla', { businessName: ' ' }, /nombre/i],
    ['WhatsApp vacio falla', { whatsappNumber: '' }, /WhatsApp/i],
    ['WhatsApp claramente invalido falla', { whatsappNumber: 'abc' }, /WhatsApp/i],
    ['fee negativo falla', { deliveryFee: '-1' }, /env[ií]o/i],
    ['minimo negativo falla', { minDeliveryOrder: '-1' }, /pedido.*delivery/i],
    ['PIN no numerico falla', { adminPin: '12ab' }, /PIN/i],
    ['PIN corto falla', { adminPin: '123' }, /PIN/i],
    ['PIN largo falla', { adminPin: '1234567' }, /PIN/i],
    ['orderPrefix invalido falla', { orderPrefix: 'Q-' }, /prefijo/i],
    ['orderPrefix de siete caracteres falla', { orderPrefix: 'ABCDEFG' }, /prefijo/i],
    ['openHour fuera de rango falla', { openHour: '25' }, /apertura/i],
    ['closeHour fuera de rango falla', { closeHour: '-1' }, /cierre/i],
  ];

  for (const [name, patch, expected] of cases) {
    const result = validateBusinessSetup({ ...validValues, ...patch });
    assert.equal(result.ok, false, name);
    assert.match(result.errors.join(' '), expected, name);
  }
});

test('business setup guarda datos validos con updateBusinessConfig y persiste aliases canonicos', () => {
  const calls = [];
  const fakeUpdate = (patch) => {
    calls.push(patch);
    return { ...patch };
  };

  const dryRun = saveBusinessSetup(validValues, fakeUpdate);
  assert.equal(dryRun.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].businessName, 'QA Store');
  assert.equal(calls[0].name, 'QA Store');
  assert.equal(calls[0].openingHoursLabel, 'Lunes a viernes 10 a 20');
  assert.equal(calls[0].openingHours, 'Lunes a viernes 10 a 20');

  const saved = saveBusinessSetup(validValues);
  assert.equal(saved.ok, true);
  assert.equal(getBusinessConfig().businessName, 'QA Store');
  assert.equal(getBusinessConfig().name, 'QA Store');
  assert.equal(getBusinessConfig().openingHoursLabel, 'Lunes a viernes 10 a 20');
  assert.equal(getBusinessConfig().openingHours, 'Lunes a viernes 10 a 20');
  assert.equal(getBusinessConfig().whatsappNumber, '5492995551234');
  assert.equal(getBusinessConfig().deliveryFee, 777);
  assert.equal(getBusinessConfig().minDeliveryOrder, 1000);

  const persisted = JSON.parse(globalThis.localStorage.getItem(STORAGE_KEYS.state));
  assert.equal(persisted.businessConfig.businessName, 'QA Store');
  assert.equal(persisted.businessConfig.name, 'QA Store');
  assert.equal(persisted.businessConfig.openingHoursLabel, 'Lunes a viernes 10 a 20');
  assert.equal(persisted.businessConfig.openingHours, 'Lunes a viernes 10 a 20');
});

test('business setup acepta prefijos de seis caracteres y mantiene los codigos viejos', () => {
  resetState({ orders: [], cart: [] });
  saveBusinessSetup({ ...validValues, orderPrefix: 'ABCDEF', minDeliveryOrder: 0, deliveryFee: 0 });

  const productId = getState().products.find((product) => getProductById(product.id) && product.available && product.stock > 0)?.id;
  assert.ok(productId, 'hay al menos un producto demo vendible');

  addToCart(productId, 1);
  const firstOrder = createOrderFromCheckout({
    customerName: 'Cliente Uno',
    customerPhone: '2995551000',
    customerStreetAddress: 'Roca 123',
    customerNeighborhood: 'Centro',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
  });
  assert.equal(firstOrder.ok, true);
  assert.equal(firstOrder.order.id, 'ABCDEF-0001');

  updateBusinessConfig({ orderPrefix: 'GHIJKL' });
  addToCart(productId, 1);
  const secondOrder = createOrderFromCheckout({
    customerName: 'Cliente Dos',
    customerPhone: '2995552000',
    customerStreetAddress: 'Roca 456',
    customerNeighborhood: 'Centro',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
  });
  assert.equal(secondOrder.ok, true);
  assert.equal(secondOrder.order.id, 'GHIJKL-0001');
  assert.equal(getState().orders.find((order) => order.id === firstOrder.order.id).id, 'ABCDEF-0001');
  assert.equal(createOrderId(), 'GHIJKL-0002');
});

test('business setup restore demo requiere confirmacion y no borra estado operativo', () => {
  resetState({
    orders: [{
      id: 'QA-0001',
      deliveryMode: 'delivery',
      status: 'received',
      items: [{ productId: 'p-napolitana', name: 'Matambre', quantity: 1, unitPrice: 9000, unit: 'kg' }],
    }],
    cart: [{ productId: 'p-napolitana', quantity: 1 }],
  });
  saveBusinessSetup({ ...validValues, minDeliveryOrder: 0, deliveryFee: 777 });
  const productId = getState().products.find((product) => getProductById(product.id) && product.available && product.stock > 0)?.id;
  assert.ok(productId, 'hay al menos un producto demo vendible');
  addToCart(productId, 1);
  const created = createOrderFromCheckout({
    customerName: 'Cliente QA',
    customerPhone: '2995550000',
    customerStreetAddress: 'Roca 123',
    customerNeighborhood: 'Centro',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
  });
  assert.equal(created.ok, true);
  globalThis.localStorage.setItem(STORAGE_KEYS.cashboxClosures, JSON.stringify([{ id: 'close-1', total: 100 }]));

  const ordersBefore = getState().orders.map((order) => order.id);
  const productsBefore = getState().products.map((product) => ({ id: product.id, stock: product.stock }));
  const cartBefore = getState().cart.map((item) => ({ ...item }));
  const cashboxBefore = globalThis.localStorage.getItem(STORAGE_KEYS.cashboxClosures);
  const historyBefore = globalThis.localStorage.getItem(STORAGE_KEYS.customerHistory);
  let called = false;

  const request = restoreBusinessSetupDemo({
    confirmed: false,
    updateConfig: () => {
      called = true;
    },
  });
  assert.equal(request.needsConfirmation, true);
  assert.equal(called, false);
  assert.equal(getBusinessConfig().businessName, 'QA Store');

  const restored = restoreBusinessSetupDemo({ confirmed: true });
  assert.equal(restored.ok, true);
  assert.equal(getBusinessConfig().businessName, BUSINESS_CONFIG.businessName);
  assert.equal(getBusinessConfig().orderPrefix, BUSINESS_CONFIG.orderPrefix);
  assert.deepEqual(getState().orders.map((order) => order.id), ordersBefore);
  assert.deepEqual(getState().products.map((product) => ({ id: product.id, stock: product.stock })), productsBefore);
  assert.deepEqual(getState().cart.map((item) => ({ ...item })), cartBefore);
  assert.equal(globalThis.localStorage.getItem(STORAGE_KEYS.cashboxClosures), cashboxBefore);
  assert.equal(globalThis.localStorage.getItem(STORAGE_KEYS.customerHistory), historyBefore);
});

test('business setup integra prefijo, delivery fee, minimo y render de UI', () => {
  resetState({ orders: [], cart: [] });
  saveBusinessSetup({ ...validValues, orderPrefix: 'QS', deliveryFee: '1234', minDeliveryOrder: '999999' });

  assert.equal(createOrderId(), 'QS-0001');

  const productId = getState().products.find((product) => getProductById(product.id) && product.available && product.stock > 0)?.id;
  assert.ok(productId, 'hay al menos un producto demo vendible');
  addToCart(productId, 1);
  assert.equal(getCartSummary('delivery').deliveryFee, 1234);
  assert.equal(validateCartForCheckout('delivery').ok, false);
  assert.match(validateCartForCheckout('delivery').message, /pedido m.nimo/i);

  updateBusinessConfig({ minDeliveryOrder: 0 });
  const order = createOrderFromCheckout({
    customerName: 'Cliente QA',
    customerPhone: '2995551234',
    customerStreetAddress: 'Roca 123',
    customerNeighborhood: 'Centro',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
  });
  assert.equal(order.ok, true);
  assert.equal(order.order.id, 'QS-0001');
  assert.equal(order.order.deliveryFee, 1234);

  const businessNameNode = { textContent: '' };
  globalThis.document = {
    querySelectorAll(selector) {
      const nodes = {
        '[data-business-name]': [businessNameNode],
        '[data-business-subtitle]': [{ textContent: '' }],
        '[data-business-profile-name]': [{ textContent: '' }],
        '[data-business-address]': [{ textContent: '' }],
        '[data-business-hours]': [{ textContent: '' }],
        '[data-business-zone]': [{ textContent: '' }],
        '[data-business-whatsapp]': [{ textContent: '' }],
        '[data-rider-business-name]': [{ textContent: '' }],
      };
      if (nodes[selector]) return nodes[selector];
      return [];
    },
    querySelector() { return null; },
  };
  applyBusinessConfig();
  assert.equal(businessNameNode.textContent, 'QA Store');
  delete globalThis.document;
});

test('business setup actualiza el PIN y invalida el anterior despues del cambio', () => {
  lockAdmin();
  assert.equal(unlockAdmin('1234'), true);
  lockAdmin();

  saveBusinessSetup({ ...validValues, adminPin: '654321' });
  lockAdmin();

  assert.equal(unlockAdmin('1234'), false);
  assert.equal(getState().adminUnlocked, false);
  assert.equal(unlockAdmin('654321'), true);
  assert.equal(getState().adminUnlocked, true);
  lockAdmin();
  assert.equal(unlockAdmin('654321'), true);
});
