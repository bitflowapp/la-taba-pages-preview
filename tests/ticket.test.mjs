import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { addToCart } from '../js/cart.js';
import { buildKitchenTicket, createOrderFromCheckout } from '../js/orders.js';
import { resetState } from './helpers.mjs';

beforeEach(() => resetState());

test('buildKitchenTicket incluye los datos clave del pedido para la cocina', () => {
  addToCart('p-muzzarella', 2);
  const { order } = createOrderFromCheckout({
    customerName: 'Cocina QA',
    customerPhone: '2995550000',
    customerStreetAddress: 'Roca 321',
    customerNeighborhood: 'Centro',
    customerReference: 'Porton negro',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
    customerNotes: 'Sin sal',
  });

  const ticket = buildKitchenTicket(order);
  assert.match(ticket, /LA TABA/);
  assert.ok(ticket.includes(order.id));
  assert.match(ticket, /Cocina QA/);
  assert.match(ticket, /2995550000/);
  assert.match(ticket, /Roca 321, Centro/);
  assert.match(ticket, /Porton negro/);
  assert.match(ticket, /2 x Muzzarella/);
  assert.match(ticket, /TOTAL:/);
  assert.match(ticket, /Sin sal/);
});

test('buildKitchenTicket marca retiro en local sin dirección de envío', () => {
  addToCart('p-coca', 1);
  const { order } = createOrderFromCheckout({
    customerName: 'Retiro QA',
    customerPhone: '2995551111',
    customerAddress: '',
    deliveryMode: 'pickup',
    paymentMethod: 'cash',
    customerNotes: '',
  });

  const ticket = buildKitchenTicket(order);
  assert.match(ticket, /Retiro en el local/);
});

test('buildKitchenTicket no rompe con un pedido nulo', () => {
  assert.equal(buildKitchenTicket(null), '');
});
