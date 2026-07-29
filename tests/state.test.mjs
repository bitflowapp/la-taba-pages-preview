import assert from 'node:assert/strict';
import test from 'node:test';
import { BUSINESS_CONFIG } from '../js/config.js';
import { safeJsonParse } from '../js/core/storage.js';
import { products as testCatalogProducts } from '../js/beverage-demo-data.js';
import {
  hydrateState,
  isDemoStateMigratable,
  requiresCatalogRefresh,
} from '../js/state.js';

test('safeJsonParse returns fallback for corrupted storage payloads', () => {
  const fallback = { ok: true };
  assert.equal(safeJsonParse('{not-json', fallback), fallback);
  assert.equal(safeJsonParse('', fallback), fallback);
});

test('hydrateState repairs corrupted persisted state without crashing', () => {
  Object.defineProperty(globalThis, 'location', {
    value: { search: '?demo=1' },
    configurable: true,
  });
  const hydrated = hydrateState({
    products: [
      { id: 'qa-agua-mineral', stock: 2, available: true, price: -999 },
      { id: 'qa-gaseosa-cola', stock: 3, available: false },
      { id: 'qa-jugo-naranja', stock: -5, available: true },
    ],
    cart: [
      { productId: 'missing-product', quantity: 4 },
      { productId: 'qa-agua-mineral', quantity: 99 },
      { productId: 'qa-gaseosa-cola', quantity: 1 },
      { productId: 'qa-jugo-naranja', quantity: 1 },
      { productId: 'qa-agua-mineral', quantity: -2 },
    ],
    orders: [
      { id: '', items: [] },
      {
        id: 'LT-9000',
        customerName: ' Cliente demo ',
        customerPhone: '2990000000',
        address: 'Roca 123',
        addressDetails: {
          streetLine: 'Roca 123',
          neighborhood: 'Centro',
          reference: 'Casa verde',
        },
        deliveryMode: 'delivery',
        paymentMethod: 'Efectivo',
        notes: '',
        createdAt: 'bad-date',
        status: 'bad-status',
        items: [
          { productId: 'qa-agua-mineral', name: 'Coca-Cola 2.25L', icon: '', quantity: 2, unitPrice: 2800, unit: 'unidad' },
          { productId: 'qa-gaseosa-cola', name: 'Bebida QA', icon: '', quantity: -1, unitPrice: 1, unit: 'unidad' },
        ],
        subtotal: 1,
        deliveryFee: 1,
        total: 1,
        statusHistory: [{ status: 'bad-status', at: 'bad-date' }],
        delivery: { estimatedMinutes: 'bad' },
      },
    ],
    lastOrderId: 'missing-order',
    activeCategory: 'missing-category',
  });

  const coca = hydrated.products.find((product) => product.id === 'qa-agua-mineral');
  assert.equal(coca.stock, 2);
  assert.equal(coca.price, 5000);
  assert.deepEqual(hydrated.cart, [{ productId: 'qa-agua-mineral', quantity: 2 }]);

  assert.equal(hydrated.orders.length, 1);
  assert.equal(hydrated.orders[0].status, 'received');
  assert.equal(hydrated.orders[0].subtotal, 5600);
  assert.equal(hydrated.orders[0].deliveryFee, BUSINESS_CONFIG.deliveryFee);
  assert.equal(hydrated.orders[0].total, 5600 + BUSINESS_CONFIG.deliveryFee);
  assert.equal(hydrated.orders[0].statusHistory.at(-1).status, 'received');
  assert.equal(hydrated.orders[0].address, 'Roca 123, Centro');
  assert.equal(hydrated.orders[0].addressDetails.reference, 'Casa verde');
  assert.equal(hydrated.lastOrderId, null);
  assert.equal(hydrated.activeCategory, 'all');
});

test('a legacy demo catalog upgrades exact products without dropping a valid cart or order', () => {
  Object.defineProperty(globalThis, 'location', {
    value: { search: '?demo=1' },
    configurable: true,
  });
  const legacy = {
    schemaVersion: 4,
    dataVersion: 'la-taba-runtime-v2',
    appMode: 'demo',
    products: [{
      id: 'qa-promo-bebidas',
      name: 'Gaseosa cola',
      description: 'Producto viejo',
      price: 999,
      stock: 4,
      available: true,
      image: 'assets/products/beverage-placeholder.svg',
    }],
    cart: [{ productId: 'qa-promo-bebidas', quantity: 2 }],
    orders: [{
      id: 'LT-9010',
      customerName: 'Cliente sandbox',
      customerPhone: '2990000000',
      address: 'Calle de prueba 1',
      deliveryMode: 'delivery',
      paymentMethod: 'Efectivo',
      createdAt: '2026-07-26T12:00:00.000Z',
      status: 'received',
      items: [{ productId: 'qa-promo-bebidas', name: 'Gaseosa cola', quantity: 1, unitPrice: 999, unit: 'unidad' }],
      statusHistory: [{ status: 'received', at: '2026-07-26T12:00:00.000Z' }],
      delivery: {},
    }],
    lastOrderId: 'LT-9010',
  };

  assert.equal(isDemoStateMigratable(legacy), true);
  assert.equal(requiresCatalogRefresh(legacy), true);

  const hydrated = hydrateState(legacy, undefined, { refreshBaseCatalog: true });
  const coca = hydrated.products.find((product) => product.id === 'qa-promo-bebidas');
  const fixtureProduct = testCatalogProducts.find((product) => product.id === 'qa-promo-bebidas');
  assert.ok(fixtureProduct, 'Expected the isolated legacy QA fixture');
  assert.equal(coca.name, fixtureProduct.name);
  assert.equal(coca.image, fixtureProduct.image);
  assert.equal(coca.stock, 4);
  assert.deepEqual(hydrated.cart, [{ productId: 'qa-promo-bebidas', quantity: 2 }]);
  assert.equal(hydrated.lastOrderId, 'LT-9010');
  assert.equal(hydrated.orders[0].items[0].name, 'Gaseosa cola');
});
