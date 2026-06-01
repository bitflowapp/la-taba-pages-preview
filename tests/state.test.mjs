import assert from 'node:assert/strict';
import test from 'node:test';
import { BUSINESS_CONFIG } from '../js/config.js';
import { safeJsonParse } from '../js/core/storage.js';
import { hydrateState } from '../js/state.js';

test('safeJsonParse returns fallback for corrupted storage payloads', () => {
  const fallback = { ok: true };
  assert.equal(safeJsonParse('{not-json', fallback), fallback);
  assert.equal(safeJsonParse('', fallback), fallback);
});

test('hydrateState repairs corrupted persisted state without crashing', () => {
  const hydrated = hydrateState({
    products: [
      { id: 'p-coca', stock: 2, available: true, price: -999 },
      { id: 'p-vacio', stock: 3, available: false },
      { id: 'p-matambre', stock: -5, available: true },
    ],
    cart: [
      { productId: 'missing-product', quantity: 4 },
      { productId: 'p-coca', quantity: 99 },
      { productId: 'p-vacio', quantity: 1 },
      { productId: 'p-matambre', quantity: 1 },
      { productId: 'p-coca', quantity: -2 },
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
          { productId: 'p-coca', name: 'Coca-Cola 2.25L', icon: '', quantity: 2, unitPrice: 2800, unit: 'unidad' },
          { productId: 'p-vacio', name: 'Vacio', icon: '', quantity: -1, unitPrice: 1, unit: 'kg' },
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

  const coca = hydrated.products.find((product) => product.id === 'p-coca');
  assert.equal(coca.stock, 2);
  assert.equal(coca.price, 2800);
  assert.deepEqual(hydrated.cart, [{ productId: 'p-coca', quantity: 2 }]);

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
