import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { BUSINESS_CONFIG } from '../js/config.js';
import { setState, getState } from '../js/state.js';
import { unlockAdmin, lockAdmin, handleBusinessAction, getActiveOrders, getLowStockProducts } from '../js/business.js';
import { resetState, makeTarget } from './helpers.mjs';

beforeEach(() => resetState());

test('PIN 1234 unlocks business mode and incorrect PINs are rejected', () => {
  lockAdmin();
  assert.equal(unlockAdmin('0000'), false);
  assert.equal(getState().adminUnlocked, false);
  assert.equal(unlockAdmin(BUSINESS_CONFIG.adminPin), true);
  assert.equal(getState().adminUnlocked, true);
  lockAdmin();
  assert.equal(getState().adminUnlocked, false);
});

test('active orders exclude delivered and cancelled orders', () => {
  const orders = [
    { id: 'LT-1001', status: 'received', items: [], createdAt: new Date().toISOString(), deliveryMode: 'delivery' },
    { id: 'LT-1002', status: 'preparing', items: [], createdAt: new Date().toISOString(), deliveryMode: 'delivery' },
    { id: 'LT-1003', status: 'ready', items: [], createdAt: new Date().toISOString(), deliveryMode: 'delivery' },
    { id: 'LT-1004', status: 'on_the_way', items: [], createdAt: new Date().toISOString(), deliveryMode: 'delivery' },
    { id: 'LT-1005', status: 'delivered', items: [], createdAt: new Date().toISOString(), deliveryMode: 'delivery' },
    { id: 'LT-1006', status: 'cancelled', items: [], createdAt: new Date().toISOString(), deliveryMode: 'delivery' },
  ];

  setState({ ...getState(), orders });

  const activeIds = getActiveOrders().map((order) => order.id);
  assert.deepEqual(activeIds, ['LT-1001', 'LT-1002', 'LT-1003', 'LT-1004']);
});

test('business actions advance status, cancel orders, edit stock, and toggle products', () => {
  const order = {
    id: 'LT-2001',
    customerName: 'Cliente demo',
    customerPhone: '2990000000',
    address: 'Neuquén',
    deliveryMode: 'delivery',
    paymentMethod: 'Efectivo',
    notes: '',
    createdAt: new Date().toISOString(),
    status: 'received',
    items: [],
    subtotal: 0,
    deliveryFee: 0,
    total: 0,
    statusHistory: [{ status: 'received', at: new Date().toISOString() }],
    delivery: {
      driverName: 'Juli',
      driverPhone: '2991112233',
      estimatedMinutes: 20,
      currentLocationLabel: 'En el local',
    },
  };

  setState({ ...getState(), orders: [order], lastOrderId: order.id });

  let result = handleBusinessAction(makeTarget({
    '[data-order-advance]': { orderAdvance: order.id },
  }));
  assert.equal(result.handled, true);
  assert.match(result.message, /Estado del pedido actualizado/);
  assert.equal(getState().orders[0].status, 'preparing');

  result = handleBusinessAction(makeTarget({
    '[data-order-cancel]': { orderCancel: order.id },
  }));
  assert.equal(result.handled, true);
  assert.equal(getState().orders[0].status, 'cancelled');

  const productBefore = getState().products.find((product) => product.id === 'p-agua');
  assert.equal(productBefore.stock, 0);

  result = handleBusinessAction(makeTarget({
    '[data-stock-inc]': { stockInc: 'p-agua' },
  }));
  assert.equal(result.handled, true);
  assert.equal(getState().products.find((product) => product.id === 'p-agua').stock, 1);

  result = handleBusinessAction(makeTarget({
    '[data-stock-dec]': { stockDec: 'p-agua' },
  }));
  assert.equal(result.handled, true);
  assert.equal(getState().products.find((product) => product.id === 'p-agua').stock, 0);

  const availabilityBefore = getState().products.find((product) => product.id === 'p-agua').available;
  result = handleBusinessAction(makeTarget({
    '[data-product-toggle]': { productToggle: 'p-agua' },
  }));
  assert.equal(result.handled, true);
  assert.equal(getState().products.find((product) => product.id === 'p-agua').available, !availabilityBefore);
});

test('low-stock detection includes scarce products and excludes out-of-stock ones', () => {
  const lowStock = getLowStockProducts();
  assert.ok(lowStock.some((product) => product.id === 'p-matambre'));
  assert.ok(lowStock.some((product) => product.id === 'p-chorizo-parrillero'));
  assert.ok(!lowStock.some((product) => product.id === 'p-agua'));
});
