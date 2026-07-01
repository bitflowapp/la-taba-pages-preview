import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { BUSINESS_CONFIG } from '../js/config.js';
import { getBusinessMetrics } from '../js/core/business-metrics.js';
import { setState, getState } from '../js/state.js';
import { unlockAdmin, lockAdmin, handleBusinessAction, getActiveOrders, getLowStockProducts, confirmOrderCancellation } from '../js/business.js';
import { createOrderFromCheckout } from '../js/orders.js';
import { addToCart } from '../js/cart.js';
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
  assert.equal(getState().orders[0].delivery.estimatedPreparationMinutes, 20);
  assert.match(getState().orders[0].delivery.currentLocationLabel, /20 min/);

  // Confirmación segura: el primer tap en "Rechazar" NO cancela (abre el modal).
  result = handleBusinessAction(makeTarget({
    '[data-order-cancel]': { orderCancel: order.id },
  }));
  assert.equal(result.handled, true);
  assert.equal(getState().orders[0].status, 'preparing', 'el primer tap no cancela');

  // "Volver" tampoco cambia el estado.
  result = handleBusinessAction(makeTarget({ '[data-cancel-dismiss]': {} }));
  assert.equal(result.handled, true);
  assert.equal(getState().orders[0].status, 'preparing', 'volver no cancela');

  // Confirmar con motivo: recién ahí pasa a cancelled y registra el motivo.
  result = confirmOrderCancellation(order.id, 'Sin stock');
  assert.equal(result.ok, true);
  assert.equal(getState().orders[0].status, 'cancelled');
  assert.equal(getState().orders[0].cancelReason, 'Sin stock', 'el motivo queda registrado');

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

function cancelTestOrder(id, status, deliveryMode = 'delivery') {
  const at = new Date().toISOString();
  return {
    id, customerName: 'QA Cancel', customerPhone: '2990000000', address: 'Roca 123',
    deliveryMode, paymentMethod: 'Efectivo', notes: '', createdAt: at, status,
    items: [{ productId: 'p-muzzarella', name: 'Vacío', quantity: 1, unitPrice: 1000, unit: 'kg' }],
    subtotal: 1000, deliveryFee: 0, total: 1000,
    statusHistory: [{ status: 'received', at }],
  };
}

test('cancelación segura: un pedido entregado no se puede cancelar', () => {
  setState({ ...getState(), orders: [cancelTestOrder('LT-DONE', 'delivered')], lastOrderId: 'LT-DONE' });
  // Primer tap (request): rechazado con mensaje claro, sin abrir confirmación.
  const requested = handleBusinessAction(makeTarget({ '[data-order-cancel]': { orderCancel: 'LT-DONE' } }));
  assert.equal(requested.handled, true);
  assert.equal(requested.ok, false);
  assert.match(requested.message, /entregado/i);
  // Confirmación directa también bloqueada.
  const confirmed = confirmOrderCancellation('LT-DONE', 'lo que sea');
  assert.equal(confirmed.ok, false);
  assert.equal(getState().orders[0].status, 'delivered');
});

test('cancelación segura: un pedido terminal (cancelado) no se re-cancela', () => {
  setState({ ...getState(), orders: [cancelTestOrder('LT-CXL', 'cancelled')], lastOrderId: 'LT-CXL' });
  const result = confirmOrderCancellation('LT-CXL', 'motivo nuevo');
  assert.equal(result.ok, false);
  assert.equal(getState().orders[0].status, 'cancelled');
});

test('cancelación segura: confirmar sin motivo no cambia el estado', () => {
  setState({ ...getState(), orders: [cancelTestOrder('LT-NR', 'preparing')], lastOrderId: 'LT-NR' });
  const result = confirmOrderCancellation('LT-NR', '   ');
  assert.equal(result.ok, false);
  assert.match(result.message, /motivo/i);
  assert.equal(getState().orders[0].status, 'preparing');
});

test('low-stock detection includes scarce products and excludes out-of-stock ones', () => {
  const lowStock = getLowStockProducts();
  assert.ok(lowStock.some((product) => product.id === 'p-napolitana'));
  assert.ok(lowStock.some((product) => product.id === 'p-calabresa'));
  assert.ok(!lowStock.some((product) => product.id === 'p-agua'));
});

test('business metrics tolerate invalid dates and count active statuses consistently', () => {
  const now = new Date('2026-05-29T15:00:00.000Z');
  const metrics = getBusinessMetrics([
    { id: 'LT-1', status: 'received', total: 1000, createdAt: '2026-05-29T10:00:00.000Z' },
    { id: 'LT-2', status: 'arriving', total: 2000, createdAt: '2026-05-29T11:00:00.000Z' },
    { id: 'LT-3', status: 'cancelled', total: 3000, createdAt: '2026-05-29T12:00:00.000Z' },
    { id: 'LT-4', status: 'delivered', total: Number.NaN, createdAt: 'bad-date' },
  ], [
    { id: 'p-1', available: true, stock: 1 },
    { id: 'p-2', available: true, stock: 0 },
    { id: 'p-3', available: false, stock: 1 },
  ], now);

  assert.equal(metrics.todayOrderCount, 2);
  assert.equal(metrics.todayTotal, 3000);
  assert.equal(metrics.ordersToHandle, 2);
  assert.equal(metrics.ordersByStatus.arriving, 1);
  assert.equal(metrics.activeOrders.length, 2);
  assert.deepEqual(metrics.lowStock.map((product) => product.id), ['p-1']);
});

test('business metrics compute ticket promedio, delivery vs retiro y productos más pedidos', () => {
  const now = new Date('2026-05-29T15:00:00.000Z');
  const today = '2026-05-29T10:00:00.000Z';
  const metrics = getBusinessMetrics([
    {
      id: 'LT-10', status: 'preparing', total: 10000, deliveryMode: 'delivery', createdAt: today,
      items: [
        { productId: 'p-asado', name: 'Asado', quantity: 2 },
        { productId: 'p-coca', name: 'Coca', quantity: 1 },
      ],
    },
    {
      id: 'LT-11', status: 'delivered', total: 6000, deliveryMode: 'pickup', createdAt: today,
      items: [{ productId: 'p-asado', name: 'Asado', quantity: 1 }],
    },
    {
      id: 'LT-12', status: 'cancelled', total: 99999, deliveryMode: 'delivery', createdAt: today,
      items: [{ productId: 'p-asado', name: 'Asado', quantity: 50 }],
    },
  ], [], now);

  assert.equal(metrics.todayOrderCount, 2);
  assert.equal(metrics.todayTotal, 16000);
  assert.equal(metrics.avgTicket, 8000);
  assert.equal(metrics.todayDeliveryCount, 1);
  assert.equal(metrics.todayPickupCount, 1);
  // El cancelado no cuenta ni en ventas ni en top de productos.
  assert.equal(metrics.topProducts[0].productId, 'p-asado');
  assert.equal(metrics.topProducts[0].quantity, 3);
  assert.equal(metrics.topProducts.length, 2);
});

test('business metrics avoid division by zero with no orders today', () => {
  const metrics = getBusinessMetrics([], [], new Date('2026-05-29T15:00:00.000Z'));
  assert.equal(metrics.avgTicket, 0);
  assert.deepEqual(metrics.topProducts, []);
});

test('un pedido confirmado entra como activo en el negocio, conserva sus datos y avanza de estado', () => {
  addToCart('p-muzzarella', 2);
  const created = createOrderFromCheckout({
    customerName: 'Walter Cliente',
    customerPhone: '2995551234',
    customerStreetAddress: 'Mendoza 851',
    customerNeighborhood: 'Centro',
    customerReference: 'Portón gris',
    customerNotes: 'Sin sal',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
  });
  assert.equal(created.ok, true);

  // Aparece como pedido activo del negocio, "recibido" y como pedido activo (lastOrderId).
  const active = getActiveOrders();
  assert.ok(active.some((order) => order.id === created.order.id));
  assert.equal(getState().lastOrderId, created.order.id);

  // Conserva los datos del cliente / dirección / productos / total.
  const stored = getState().orders.find((order) => order.id === created.order.id);
  assert.equal(stored.status, 'received');
  assert.equal(stored.customerName, 'Walter Cliente');
  assert.equal(stored.customerPhone, '2995551234');
  assert.match(stored.address, /Mendoza 851/);
  assert.match(stored.address, /Centro/);
  assert.equal(stored.addressDetails.reference, 'Portón gris');
  assert.equal(stored.items.reduce((sum, item) => sum + item.quantity, 0), 2);
  assert.ok(stored.total > 0);

  // El negocio cambia el estado y el pedido sigue siendo el activo.
  const advanced = handleBusinessAction(makeTarget({ '[data-order-advance]': { orderAdvance: created.order.id } }));
  assert.equal(advanced.ok, true);
  assert.equal(getState().orders.find((order) => order.id === created.order.id).status, 'preparing');
  assert.equal(getState().lastOrderId, created.order.id);
});
