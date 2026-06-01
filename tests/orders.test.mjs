import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { BUSINESS_CONFIG } from '../js/config.js';
import { addToCart } from '../js/cart.js';
import { createOrderFromCheckout, buildWhatsAppMessage, buildWhatsAppUrl, updateOrderStatus } from '../js/orders.js';
import { dateTime, getState } from '../js/state.js';
import { resetState, state } from './helpers.mjs';

beforeEach(() => resetState());

test('creates a valid delivery order and builds a complete WhatsApp message', () => {
  addToCart('p-vacio', 1);

  const result = createOrderFromCheckout({
    customerName: 'María López',
    customerPhone: '2995551234',
    customerAddress: 'Fotheringham 123',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
    customerNotes: 'Sin cebolla',
  });

  assert.equal(result.ok, true);
  assert.equal(result.order.id, 'LT-0002');
  assert.equal(result.order.items.length, 1);
  assert.equal(result.order.subtotal, 11200);
  assert.equal(result.order.deliveryFee, BUSINESS_CONFIG.deliveryFee);
  assert.equal(result.order.total, 11200 + BUSINESS_CONFIG.deliveryFee);

  const message = buildWhatsAppMessage(result.order);
  assert.match(message, /Pedido: LT-0002/);
  assert.match(message, /Nombre: María López/);
  assert.match(message, /Teléfono: 2995551234/);
  assert.match(message, /Entrega: Envío a domicilio/);
  assert.match(message, /Dirección: Fotheringham 123/);
  assert.match(message, /Vacío/);
  assert.match(message, /Subtotal: /);
  assert.match(message, /Envío: /);
  assert.match(message, /Total: /);
  assert.match(message, /Pago: Efectivo/);
  assert.match(message, /Notas: Sin cebolla/);
  assert.ok(message.includes(dateTime(result.order.createdAt)));
});

test('pickup orders do not require a delivery address and do not charge shipping', () => {
  addToCart('p-coca', 1);

  const result = createOrderFromCheckout({
    customerName: 'Carlos Pérez',
    customerPhone: '2991112233',
    customerAddress: '',
    deliveryMode: 'pickup',
    paymentMethod: 'transfer',
    customerNotes: '',
  });

  assert.equal(result.ok, true);
  assert.equal(result.order.address, BUSINESS_CONFIG.address);
  assert.equal(result.order.deliveryFee, 0);
  assert.equal(result.order.total, result.order.subtotal);
});

test('delivery orders store structured customer address and rider reference', () => {
  addToCart('p-vacio', 1);

  const result = createOrderFromCheckout({
    customerName: 'Direccion QA',
    customerPhone: '2995551234',
    customerStreetAddress: 'Mitre 456',
    customerNeighborhood: 'Area centro',
    customerReference: 'Casa verde',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
    customerNotes: 'Sin grasa',
  });

  assert.equal(result.ok, true);
  assert.equal(result.order.address, 'Mitre 456, Area centro');
  assert.deepEqual(result.order.addressDetails, {
    streetLine: 'Mitre 456',
    neighborhood: 'Area centro',
    reference: 'Casa verde',
    label: 'Mitre 456, Area centro',
    usesStructured: true,
  });

  const message = buildWhatsAppMessage(result.order);
  assert.match(message, /Dirección: Mitre 456, Area centro/);
  assert.match(message, /Referencia: Casa verde/);
});

test('delivery orders require a delivery address and a minimum subtotal', () => {
  resetState();
  addToCart('p-vacio', 1);

  const missingAddress = createOrderFromCheckout({
    customerName: 'Ana',
    customerPhone: '2993334444',
    customerAddress: '',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
    customerNotes: '',
  });

  assert.equal(missingAddress.ok, false);
  assert.match(missingAddress.message, /calle|número/i);

  const missingNeighborhood = createOrderFromCheckout({
    customerName: 'Ana',
    customerPhone: '2993334444',
    customerStreetAddress: 'Roca 321',
    customerNeighborhood: '',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
    customerNotes: '',
  });

  assert.equal(missingNeighborhood.ok, false);
  assert.match(missingNeighborhood.message, /barrio|zona/i);

  resetState();
  addToCart('p-coca', 1);

  const belowMinimum = createOrderFromCheckout({
    customerName: 'Ana',
    customerPhone: '2993334444',
    customerAddress: 'Roca 321',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
    customerNotes: '',
  });

  assert.equal(belowMinimum.ok, false);
  assert.match(belowMinimum.message, /pedido mínimo de delivery/);
});

test('checkout sanitizes text and normalizes invalid payment methods', () => {
  addToCart('p-vacio', 1);

  const result = createOrderFromCheckout({
    customerName: '  Ana\u0000 QA  ',
    customerPhone: ' 2995550000 ',
    customerAddress: '  Roca 321 ',
    deliveryMode: 'bad-mode',
    paymentMethod: 'unknown',
    customerNotes: '  Sin\u0007 grasa  ',
  });

  assert.equal(result.ok, true);
  assert.equal(result.order.deliveryMode, 'delivery');
  assert.equal(result.order.customerName, 'Ana QA');
  assert.equal(result.order.customerPhone, '2995550000');
  assert.equal(result.order.address, 'Roca 321');
  assert.equal(result.order.paymentMethod, 'Efectivo');
  assert.equal(result.order.notes, 'Sin grasa');
  assert.deepEqual(state().cart, []);
});

test('double checkout confirmation cannot create a duplicate order', () => {
  addToCart('p-vacio', 1);
  const initialOrderCount = getState().orders.length;

  const first = createOrderFromCheckout({
    customerName: 'Cliente QA',
    customerPhone: '2995550000',
    customerAddress: 'Roca 321',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
    customerNotes: '',
  });
  const second = createOrderFromCheckout({
    customerName: 'Cliente QA',
    customerPhone: '2995550000',
    customerAddress: 'Roca 321',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
    customerNotes: '',
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(getState().orders.length, initialOrderCount + 1);
  assert.equal(getState().orders[0].id, first.order.id);
  assert.deepEqual(getState().cart, []);
});

test('secondary WhatsApp copy uses an existing order without creating another one', () => {
  addToCart('p-vacio', 1);
  const created = createOrderFromCheckout({
    customerName: 'Cliente WhatsApp',
    customerPhone: '2995550000',
    customerAddress: 'Roca 321',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
    customerNotes: 'Copia secundaria',
  });
  const orderCount = getState().orders.length;

  const url = buildWhatsAppUrl(created.order);

  assert.equal(created.ok, true);
  assert.equal(getState().orders.length, orderCount);
  assert.match(decodeURIComponent(url), /Pedido: LT-0002/);
  assert.match(decodeURIComponent(url), /Cliente WhatsApp/);
  assert.match(decodeURIComponent(url), /Copia secundaria/);
});

test('order status transitions reject invalid jumps and preserve history', () => {
  addToCart('p-vacio', 1);
  const created = createOrderFromCheckout({
    customerName: 'Rider QA',
    customerPhone: '2995550000',
    customerAddress: 'Roca 321',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
    customerNotes: '',
  });

  const orderId = created.order.id;
  const invalid = updateOrderStatus(orderId, 'delivered');
  assert.equal(invalid.ok, false);
  assert.equal(getState().orders[0].status, 'received');

  assert.equal(updateOrderStatus(orderId, 'preparing').ok, true);
  assert.equal(updateOrderStatus(orderId, 'ready').ok, true);
  assert.equal(updateOrderStatus(orderId, 'on_the_way').ok, true);
  assert.equal(updateOrderStatus(orderId, 'delivered').ok, true);

  const order = getState().orders[0];
  assert.equal(order.status, 'delivered');
  assert.deepEqual(order.statusHistory.map((entry) => entry.status), [
    'received',
    'preparing',
    'ready',
    'on_the_way',
    'delivered',
  ]);
  assert.equal(order.delivery.estimatedMinutes, 0);
});
