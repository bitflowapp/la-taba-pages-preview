import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { BUSINESS_CONFIG, STORAGE_KEYS } from '../js/config.js';
import {
  BUSINESS_CONFIG_SCHEMA_VERSION,
  buildDefaultBusinessConfig,
  mergeBusinessConfig,
  normalizeBusinessConfig,
  getBusinessConfig,
} from '../js/core/business-config-store.js';
import {
  STATE_SCHEMA_VERSION,
  createOrderId,
  getState,
  hydrateState,
  normalizeOrderForStorage,
  updateBusinessConfig,
} from '../js/state.js';
import { getDeliveryFeeForMode } from '../js/core/pricing.js';
import { createSupabaseOrderRepository } from '../js/repositories/supabase_order_repository.js';
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

// state.js persiste vía globalThis.localStorage en runtime. En node lo simulamos.
globalThis.localStorage = globalThis.localStorage || memoryStorage();
globalThis.sessionStorage = globalThis.sessionStorage || memoryStorage();

beforeEach(() => {
  resetState();
  // resetState() no toca businessConfig: lo devolvemos al default entre tests.
  updateBusinessConfig(buildDefaultBusinessConfig());
});

test('1 · el default se siembra desde BUSINESS_CONFIG y conserva todos los campos', () => {
  const def = buildDefaultBusinessConfig();
  for (const key of Object.keys(BUSINESS_CONFIG)) {
    assert.ok(key in def, `falta el campo "${key}" en el default`);
  }
  assert.equal(def.businessName, BUSINESS_CONFIG.businessName);
  assert.equal(def.adminPin, BUSINESS_CONFIG.adminPin);
  assert.equal(def.orderPrefix, BUSINESS_CONFIG.orderPrefix);
  assert.equal(def.deliveryFee, BUSINESS_CONFIG.deliveryFee);
  assert.equal(def.currency, BUSINESS_CONFIG.currency);
  assert.deepEqual(def.businessLocation, BUSINESS_CONFIG.businessLocation);
  // Infraestructura mapa/demo preservada tal cual desde la semilla.
  assert.deepEqual(def.demoStreetTestDestinations, BUSINESS_CONFIG.demoStreetTestDestinations);
  assert.deepEqual(def.mapProvider, BUSINESS_CONFIG.mapProvider);
  assert.equal(BUSINESS_CONFIG_SCHEMA_VERSION, 1);
});

test('2 · normalizeBusinessConfig sanea tipos inválidos y rellena faltantes con fallback', () => {
  const def = buildDefaultBusinessConfig();
  const dirty = normalizeBusinessConfig({
    businessName: '   ',
    deliveryFee: -50,
    minDeliveryOrder: 'abc',
    openHour: 'x',
    adminPin: '12',
    currency: 'pesos',
    orderPrefix: 'lt-99$',
  }, def);
  assert.equal(dirty.businessName, def.businessName, 'vacío → fallback');
  assert.equal(dirty.deliveryFee, def.deliveryFee, 'negativo → fallback');
  assert.equal(dirty.minDeliveryOrder, def.minDeliveryOrder, 'no numérico → fallback');
  assert.equal(dirty.openHour, def.openHour, 'no entero → fallback');
  assert.equal(dirty.adminPin, def.adminPin, 'PIN corto → fallback');
  assert.equal(dirty.currency, def.currency, 'moneda inválida → fallback');
  assert.equal(dirty.orderPrefix, 'LT99', 'prefijo saneado a alfanumérico en mayúsculas');

  const ok = mergeBusinessConfig(def, { businessName: 'Rotisería Pepe', deliveryFee: 2500 });
  assert.equal(ok.businessName, 'Rotisería Pepe');
  assert.equal(ok.deliveryFee, 2500);
  // El merge no pierde la infraestructura no editable.
  assert.deepEqual(ok.mapProvider, def.mapProvider);
});

test('3 · estado viejo sin businessConfig hidrata con el default', () => {
  const hydrated = hydrateState({ activeCategory: 'all', cart: [] });
  assert.deepEqual(hydrated.businessConfig, buildDefaultBusinessConfig());
  assert.equal(hydrated.schemaVersion, STATE_SCHEMA_VERSION);
});

test('4 · la migración conserva orders/products/cart', () => {
  const hydrated = hydrateState({
    products: [{ id: 'p-matambre', stock: 5, available: true, price: 9000 }],
    cart: [{ productId: 'p-matambre', quantity: 2 }],
    orders: [{
      id: 'LT-0001',
      deliveryMode: 'delivery',
      status: 'received',
      items: [{ productId: 'p-matambre', name: 'Matambre', quantity: 1, unitPrice: 9000, unit: 'kg' }],
    }],
  });
  assert.ok(hydrated.orders.some((order) => order.id === 'LT-0001'), 'conserva el pedido');
  assert.ok(hydrated.products.some((product) => product.id === 'p-matambre'), 'conserva productos');
  assert.ok(hydrated.cart.some((line) => line.productId === 'p-matambre'), 'conserva el carrito');
  assert.deepEqual(hydrated.businessConfig, buildDefaultBusinessConfig());
});

test('5 · updateBusinessConfig persiste y getBusinessConfig refleja el cambio', () => {
  updateBusinessConfig({ businessName: 'Rotisería Pepe', deliveryFee: 2500 });
  assert.equal(getBusinessConfig().businessName, 'Rotisería Pepe');
  assert.equal(getBusinessConfig().deliveryFee, 2500);

  const persisted = JSON.parse(globalThis.localStorage.getItem(STORAGE_KEYS.state));
  assert.equal(persisted.businessConfig.businessName, 'Rotisería Pepe');
  assert.equal(persisted.businessConfig.deliveryFee, 2500);
});

test('6 · cambiar businessConfig.name no altera pedidos ni catálogo', () => {
  const orderIdsBefore = getState().orders.map((order) => order.id);
  const productSnapshotBefore = getState().products.map((product) => ({
    id: product.id,
    price: product.price,
    stock: product.stock,
  }));

  updateBusinessConfig({ businessName: 'Market X' });

  assert.equal(getBusinessConfig().businessName, 'Market X');
  assert.deepEqual(getState().orders.map((order) => order.id), orderIdsBefore);
  assert.deepEqual(
    getState().products.map((product) => ({ id: product.id, price: product.price, stock: product.stock })),
    productSnapshotBefore,
  );
});

test('7 · delivery fee y pedido mínimo siguen funcionando desde el store', () => {
  assert.equal(getDeliveryFeeForMode('delivery'), getBusinessConfig().deliveryFee);
  assert.equal(getDeliveryFeeForMode('pickup'), 0);
  assert.equal(getBusinessConfig().minDeliveryOrder, BUSINESS_CONFIG.minDeliveryOrder);

  updateBusinessConfig({ deliveryFee: 3333, minDeliveryOrder: 8000 });
  assert.equal(getDeliveryFeeForMode('delivery'), 3333);
  assert.equal(getBusinessConfig().minDeliveryOrder, 8000);
});

test('8 · orderPrefix sigue generando códigos correctos desde el store', () => {
  resetState({ orders: [] });
  assert.equal(createOrderId(), `${getBusinessConfig().orderPrefix}-0001`);

  updateBusinessConfig({ orderPrefix: 'RP' });
  assert.equal(createOrderId(), 'RP-0001');
});

test('9 · Supabase sigue siendo opt-in (requiere url + key explícitas)', () => {
  assert.throws(() => createSupabaseOrderRepository({}), /Supabase repository requiere/);
  assert.throws(
    () => createSupabaseOrderRepository({ supabaseUrl: 'https://x.supabase.co' }),
    /requiere/,
  );
});

test('10 · el config store no inventa rider/GPS: el tracking honesto sigue intacto', () => {
  const cfg = getBusinessConfig();
  for (const key of ['rider', 'gps', 'driverName', 'tracking', 'lastLocation']) {
    assert.ok(!(key in cfg), `la config no debe inventar "${key}"`);
  }
  const stored = normalizeOrderForStorage({
    id: 'LT-7777',
    deliveryMode: 'delivery',
    status: 'on_the_way',
    items: [{ productId: 'p-matambre', name: 'Matambre', quantity: 1, unitPrice: 9000, unit: 'kg' }],
  });
  assert.equal(stored.delivery.driverName, 'Sin asignar');
  assert.equal(stored.delivery.driverPhone, '');
});
