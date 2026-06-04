import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterBusinessOrders,
  getBusinessOrderFilterCounts,
  getBusinessOrderPrimaryAction,
  getBusinessStatusMeta,
  matchesBusinessOrderSearch,
  normalizePreparationMinutes,
} from '../js/core/business-ops.js';

function order(id, status, overrides = {}) {
  return {
    id,
    status,
    customerName: overrides.customerName || 'Cliente QA',
    customerPhone: overrides.customerPhone || '2995550000',
    address: overrides.address || 'Roca 123, Centro',
    addressDetails: overrides.addressDetails,
    deliveryMode: overrides.deliveryMode || 'delivery',
    createdAt: overrides.createdAt || new Date().toISOString(),
    statusHistory: overrides.statusHistory || [{ status, at: overrides.createdAt || new Date().toISOString() }],
    items: [{ productId: 'p-vacio', name: 'Vacio', quantity: 1, unitPrice: 1000, unit: 'kg' }],
  };
}

test('business ops exposes only possible primary actions by status and fulfillment', () => {
  assert.deepEqual(getBusinessOrderPrimaryAction(order('LT-1', 'received')), {
    nextStatus: 'preparing',
    label: 'Aceptar pedido',
    copy: 'Confirma el pedido y avisa el tiempo de preparacion.',
    requiresPrepTime: true,
  });
  assert.equal(getBusinessOrderPrimaryAction(order('LT-2', 'preparing')).label, 'Marcar como listo');
  assert.equal(getBusinessOrderPrimaryAction(order('LT-3', 'ready')).label, 'Enviar a reparto');
  assert.equal(getBusinessOrderPrimaryAction(order('LT-4', 'ready', { deliveryMode: 'pickup' })).label, 'Marcar como entregado');
  assert.equal(getBusinessOrderPrimaryAction(order('LT-5', 'delivered')), null);
  assert.equal(getBusinessOrderPrimaryAction(order('LT-6', 'cancelled')), null);
});

test('business ops filters by operational buckets', () => {
  const orders = [
    order('LT-NEW', 'received'),
    order('LT-PREP', 'preparing'),
    order('LT-READY', 'ready'),
    order('LT-WAY', 'on_the_way'),
    order('LT-ARRIVING', 'arriving'),
    order('LT-DONE', 'delivered'),
    order('LT-CXL', 'cancelled'),
  ];

  assert.deepEqual(getBusinessOrderFilterCounts(orders), {
    all: 7,
    new: 1,
    preparing: 1,
    ready: 1,
    delivery: 2,
    done: 1,
    cancelled: 1,
  });
  assert.deepEqual(filterBusinessOrders(orders, { filter: 'new' }).map((item) => item.id), ['LT-NEW']);
  assert.deepEqual(filterBusinessOrders(orders, { filter: 'delivery' }).map((item) => item.id), ['LT-WAY', 'LT-ARRIVING']);
  assert.deepEqual(filterBusinessOrders(orders, { filter: 'done' }).map((item) => item.id), ['LT-DONE']);
  assert.deepEqual(filterBusinessOrders(orders, { filter: 'cancelled' }).map((item) => item.id), ['LT-CXL']);
});

test('business ops searches by id, customer and address', () => {
  const target = order('LT-2030', 'received', {
    customerName: 'Laura Mercado',
    addressDetails: {
      streetLine: 'Mendoza 851',
      neighborhood: 'Centro',
      reference: 'Porton gris',
      label: 'Mendoza 851, Centro',
    },
  });

  assert.equal(matchesBusinessOrderSearch(target, '2030'), true);
  assert.equal(matchesBusinessOrderSearch(target, 'laura'), true);
  assert.equal(matchesBusinessOrderSearch(target, 'Mendoza'), true);
  assert.equal(matchesBusinessOrderSearch(target, 'porton'), true);
  assert.equal(matchesBusinessOrderSearch(target, 'no existe'), false);
});

test('business ops normalizes prep time and status copy for merchant language', () => {
  assert.equal(normalizePreparationMinutes('15'), 15);
  assert.equal(normalizePreparationMinutes('-4'), 20);
  assert.equal(normalizePreparationMinutes('bad', 30), 30);
  assert.equal(getBusinessStatusMeta('received').label, 'Nuevo / pendiente');
  assert.match(getBusinessStatusMeta('ready').copy, /Listo para entregar/i);
});
