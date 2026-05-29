import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { BUSINESS_CONFIG } from '../js/config.js';
import { addToCart } from '../js/cart.js';
import { createOrderFromCheckout, buildWhatsAppMessage } from '../js/orders.js';
import { dateTime } from '../js/state.js';
import { resetState } from './helpers.mjs';

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
  assert.match(missingAddress.message, /dirección/);

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
