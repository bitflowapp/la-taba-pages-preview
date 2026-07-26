import assert from 'node:assert/strict';
import test from 'node:test';
import { STORAGE_KEYS } from '../js/config.js';
import { buildBusinessReport } from '../js/core/business-reports.js';
import {
  readCashboxClosures,
  saveCashboxClosure,
} from '../js/core/cashbox-store.js';

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function deliveredOrder() {
  return {
    id: 'LT-1',
    status: 'delivered',
    createdAt: '2026-06-04T12:00:00.000Z',
    customerName: 'Cliente Caja',
    customerPhone: '2995550000',
    paymentMethodCode: 'cash',
    paymentMethod: 'Efectivo',
    items: [{ productId: 'qa-gaseosa-cola', name: 'Bebida QA snapshot', quantity: 1, unitPrice: 1000 }],
    subtotal: 1000,
    discountTotal: 100,
    deliveryFee: 200,
    total: 1100,
  };
}

test('cashbox guarda snapshot de cierre sin borrar ni modificar pedidos', () => {
  const storage = createStorage();
  const orders = [deliveredOrder()];
  const before = JSON.stringify(orders);
  const report = buildBusinessReport(orders, {
    now: new Date('2026-06-04T15:00:00.000Z'),
  });

  const result = saveCashboxClosure(report, {
    storage,
    now: new Date('2026-06-04T16:00:00.000Z'),
  });

  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(orders), before);
  assert.equal(result.closure.metrics.netSales, 1100);
  assert.equal(result.closure.metrics.salesByPaymentMethod.cash, 1100);
  assert.equal(result.closure.metrics.deliveredOrders, 1);

  const persisted = JSON.parse(storage.getItem(STORAGE_KEYS.cashboxClosures));
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].metrics.totalDiscounts, 100);
});

test('cashbox tolera localStorage corrupto', () => {
  const storage = createStorage({ [STORAGE_KEYS.cashboxClosures]: '{no json' });

  assert.deepEqual(readCashboxClosures({ storage }), []);
});

test('cashbox conserva historial simple de cierres recientes', () => {
  const storage = createStorage();
  const report = buildBusinessReport([deliveredOrder()], {
    now: new Date('2026-06-04T15:00:00.000Z'),
  });

  saveCashboxClosure(report, { storage, now: new Date('2026-06-04T16:00:00.000Z') });
  saveCashboxClosure(report, { storage, now: new Date('2026-06-05T16:00:00.000Z') });
  const closures = readCashboxClosures({ storage });

  assert.equal(closures.length, 2);
  assert.equal(closures[0].closedAt, '2026-06-05T16:00:00.000Z');
  assert.equal(closures[1].closedAt, '2026-06-04T16:00:00.000Z');
});
