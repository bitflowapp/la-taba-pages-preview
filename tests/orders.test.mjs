import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { BUSINESS_CONFIG } from '../js/config.js';
import { addToCart } from '../js/cart.js';
import {
  createOrderFromCheckout,
  buildKitchenTicket,
  buildWhatsAppMessage,
  buildWhatsAppUrl,
  allowActiveOrderFallback,
  getActiveOrder,
  getActiveOrderId,
  persistActiveOrderId,
  suppressActiveOrderFallback,
  updateOrderStatus,
} from '../js/orders.js';
import { dateTime, getState, setState } from '../js/state.js';
import { CONFIRMED_DELIVERY_POINT, resetState, state } from './helpers.mjs';

beforeEach(() => {
  Object.defineProperty(globalThis, 'location', {
    value: { search: '?demo=1' },
    configurable: true,
  });
  resetState();
  allowActiveOrderFallback();
});

test('creates a valid delivery order and builds a complete WhatsApp message', () => {
  addToCart('qa-gaseosa-cola', 1);
  const currentPrice = state().products.find((product) => product.id === 'qa-gaseosa-cola').price;

  const result = createOrderFromCheckout({
    ...CONFIRMED_DELIVERY_POINT,
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
  assert.equal(result.order.subtotal, currentPrice);
  assert.equal(result.order.deliveryFee, BUSINESS_CONFIG.deliveryFee);
  assert.equal(result.order.total, currentPrice + BUSINESS_CONFIG.deliveryFee);

  const message = buildWhatsAppMessage(result.order);
  assert.match(message, /Pedido: LT-0002/);
  assert.match(message, /Nombre: María López/);
  assert.match(message, /Teléfono: 2995551234/);
  assert.match(message, /Entrega: Envío a domicilio/);
  assert.match(message, /Dirección: Fotheringham 123/);
  assert.match(message, /Sprite 1,5 L/);
  assert.match(message, /Subtotal: /);
  assert.match(message, /Envío: /);
  assert.match(message, /Total: /);
  assert.match(message, /Pago: Efectivo/);
  assert.match(message, /Notas: Sin cebolla/);
  assert.ok(message.includes(dateTime(result.order.createdAt)));
});

test('pickup orders do not require a delivery address and do not charge shipping', () => {
  addToCart('qa-agua-mineral', 1);

  const result = createOrderFromCheckout({
    ...CONFIRMED_DELIVERY_POINT,
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
  addToCart('qa-gaseosa-cola', 1);

  const result = createOrderFromCheckout({
    ...CONFIRMED_DELIVERY_POINT,
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
  // El punto confirmado viaja DENTRO de la dirección del pedido: es lo que deja
  // al Panel, al Rider y al seguimiento con un destino y no sólo con texto.
  assert.deepEqual(result.order.addressDetails, {
    streetLine: 'Mitre 456',
    neighborhood: 'Area centro',
    reference: 'Casa verde',
    label: 'Mitre 456, Area centro',
    usesStructured: true,
    latitude: CONFIRMED_DELIVERY_POINT.deliveryLatitude,
    longitude: CONFIRMED_DELIVERY_POINT.deliveryLongitude,
    geolocationAccuracy: CONFIRMED_DELIVERY_POINT.deliveryGeolocationAccuracy,
    locationSource: CONFIRMED_DELIVERY_POINT.deliveryLocationSource,
    locationConfirmedAt: CONFIRMED_DELIVERY_POINT.deliveryLocationConfirmedAt,
  });

  const message = buildWhatsAppMessage(result.order);
  assert.match(message, /Dirección: Mitre 456, Area centro/);
  assert.match(message, /Referencia: Casa verde/);
});

test('delivery orders require a delivery address and a minimum subtotal', () => {
  resetState();
  addToCart('qa-gaseosa-cola', 1);

  const missingAddress = createOrderFromCheckout({
    ...CONFIRMED_DELIVERY_POINT,
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
    ...CONFIRMED_DELIVERY_POINT,
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

  const productsWithBelowMinimumItem = state().products.map((product) => (
    product.id === 'qa-agua-mineral' ? { ...product, price: 1000 } : product
  ));
  resetState({
    products: productsWithBelowMinimumItem,
  });
  addToCart('qa-agua-mineral', 1);

  const belowMinimum = createOrderFromCheckout({
    ...CONFIRMED_DELIVERY_POINT,
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
  addToCart('qa-gaseosa-cola', 1);

  const result = createOrderFromCheckout({
    ...CONFIRMED_DELIVERY_POINT,
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
  assert.equal(result.order.paymentMethod, 'Pago a coordinar con el local');
  assert.equal(result.order.notes, 'Sin grasa');
  assert.deepEqual(state().cart, []);
});

test('kitchen ticket does not expose the delivery verification code', () => {
  addToCart('qa-gaseosa-cola', 1);
  const created = createOrderFromCheckout({
    ...CONFIRMED_DELIVERY_POINT,
    customerName: 'Cliente QA',
    customerPhone: '2995550000',
    customerAddress: 'Roca 321',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
    customerNotes: 'Sin cebolla',
  });
  assert.equal(created.ok, true);
  const ticket = buildKitchenTicket(created.order);
  assert.ok(!ticket.includes('Codigo entrega'));
  assert.ok(!ticket.includes('ABCD-1234'));
});

test('orders with discount but missing coupon code use Promo fallback', () => {
  const message = buildWhatsAppMessage({
    id: 'LT-TEST',
    createdAt: '2026-07-27T12:00:00.000Z',
    customerName: 'Cliente QA',
    customerPhone: '2995550000',
    deliveryMode: 'delivery',
    address: 'Roca 321',
    addressDetails: {
      streetLine: 'Roca 321',
      neighborhood: 'Centro',
      usesStructured: true,
      label: 'Roca 321, Centro',
      reference: '',
    },
    items: [
      { name: 'Gaseosa QA', quantity: 1, unitPrice: 12000 },
    ],
    subtotal: 12000,
    discountTotal: 2000,
    deliveryFee: 1200,
    total: 10000,
    coupon: { code: '', discountPercent: 15, discountAmount: 2000 },
    paymentMethod: 'Efectivo',
    cashChange: '',
    notes: 'Sin notas',
  });

  assert.ok(!message.includes('TABA10'));
  assert.match(message, /Cup.*Promo/);
});

test('double checkout confirmation cannot create a duplicate order', () => {
  addToCart('qa-gaseosa-cola', 1);
  const initialOrderCount = getState().orders.length;

  const first = createOrderFromCheckout({
    ...CONFIRMED_DELIVERY_POINT,
    customerName: 'Cliente QA',
    customerPhone: '2995550000',
    customerAddress: 'Roca 321',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
    customerNotes: '',
  });
  const second = createOrderFromCheckout({
    ...CONFIRMED_DELIVERY_POINT,
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
  addToCart('qa-gaseosa-cola', 1);
  const created = createOrderFromCheckout({
    ...CONFIRMED_DELIVERY_POINT,
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

test('active order falls back to the live delivery order when lastOrderId is missing', () => {
  const now = Date.now();
  const receivedAt = new Date(now - 10_000).toISOString();
  const onTheWayAt = new Date(now - 60_000).toISOString();
  resetState({
    orders: [
      {
        id: 'LT-RECEIVED',
        status: 'received',
        createdAt: receivedAt,
        statusHistory: [{ status: 'received', at: receivedAt }],
        items: [{ productId: 'qa-gaseosa-cola', name: 'Bebida QA', quantity: 1, unitPrice: 11200, unit: 'unidad' }],
        deliveryMode: 'delivery',
        customerName: 'Cliente nuevo',
        customerPhone: '2995551111',
        address: 'Roca 321',
        paymentMethod: 'Efectivo',
      },
      {
        id: 'LT-WAY',
        status: 'on_the_way',
        createdAt: onTheWayAt,
        statusHistory: [{ status: 'on_the_way', at: onTheWayAt }],
        items: [{ productId: 'qa-gaseosa-cola', name: 'Bebida QA', quantity: 1, unitPrice: 11200, unit: 'unidad' }],
        deliveryMode: 'delivery',
        customerName: 'Cliente en reparto',
        customerPhone: '2995552222',
        address: 'Mendoza 851, Centro',
        paymentMethod: 'Efectivo',
      },
    ],
    lastOrderId: null,
  });

  assert.equal(getActiveOrderId(), 'LT-WAY');
  assert.equal(getActiveOrder()?.id, 'LT-WAY');
});

test('valid lastOrderId stays authoritative over another live order', () => {
  const oldAt = new Date(Date.now() - 60_000).toISOString();
  const freshAt = new Date().toISOString();
  resetState({
    orders: [
      {
        id: 'LT-READY',
        status: 'ready',
        createdAt: oldAt,
        statusHistory: [{ status: 'ready', at: oldAt }],
        items: [{ productId: 'qa-gaseosa-cola', name: 'Bebida QA', quantity: 1, unitPrice: 11200, unit: 'unidad' }],
        deliveryMode: 'delivery',
        customerName: 'Pedido fijado',
        customerPhone: '2995551111',
        address: 'Roca 321',
        paymentMethod: 'Efectivo',
      },
      {
        id: 'LT-ARRIVING',
        status: 'arriving',
        createdAt: freshAt,
        statusHistory: [{ status: 'arriving', at: freshAt }],
        items: [{ productId: 'qa-gaseosa-cola', name: 'Bebida QA', quantity: 1, unitPrice: 11200, unit: 'unidad' }],
        deliveryMode: 'delivery',
        customerName: 'Pedido nuevo',
        customerPhone: '2995552222',
        address: 'Mendoza 851, Centro',
        paymentMethod: 'Efectivo',
      },
    ],
    lastOrderId: 'LT-READY',
  });

  assert.equal(getActiveOrderId(), 'LT-READY');
  assert.equal(getActiveOrder()?.id, 'LT-READY');
});

test('selector global de orden activa no selecciona fallback cuando está suprimido', () => {
  resetState({
    orders: [
      {
        id: 'LT-ACTIVE-B',
        status: 'preparing',
        createdAt: new Date().toISOString(),
        statusHistory: [{ status: 'preparing', at: new Date().toISOString() }],
        items: [{ productId: 'qa-gaseosa-cola', name: 'Bebida QA', quantity: 1, unitPrice: 11200, unit: 'unidad' }],
        deliveryMode: 'delivery',
        customerName: 'Cliente activo',
        customerPhone: '2995559999',
        address: 'Roca 500',
        paymentMethod: 'Efectivo',
      },
    ],
    lastOrderId: null,
  });
  suppressActiveOrderFallback();

  assert.equal(getActiveOrderId(), null);
  assert.equal(getActiveOrder(), null);
});

test('actualización de estado automática no reabre fallback', () => {
  const orderId = 'LT-B';
  resetState({
    orders: [
      {
        id: orderId,
        status: 'preparing',
        createdAt: new Date().toISOString(),
        statusHistory: [{ status: 'preparing', at: new Date().toISOString() }],
        items: [{ productId: 'qa-gaseosa-cola', name: 'Bebida QA', quantity: 1, unitPrice: 11200, unit: 'unidad' }],
        deliveryMode: 'delivery',
        customerName: 'Cliente activo',
        customerPhone: '2995559999',
        address: 'Roca 500',
        paymentMethod: 'Efectivo',
      },
    ],
    lastOrderId: null,
  });
  suppressActiveOrderFallback();

  assert.equal(getActiveOrderId(), null);
  assert.equal(getActiveOrder(), null);

  const transition = updateOrderStatus(orderId, 'ready');
  const stateAfter = getState();
  const targetOrder = stateAfter.orders.find((candidate) => candidate.id === orderId);

  assert.equal(transition.ok, true);
  assert.equal(targetOrder?.status, 'ready');
  assert.equal(stateAfter.lastOrderId, null);
  assert.equal(getActiveOrderId(), null);
  assert.equal(getActiveOrder(), null);
});

test('la supresión explícita se desactiva con selección explícita por id', () => {
  resetState({
    orders: [
      {
        id: 'LT-ACTIVE-B',
        status: 'preparing',
        createdAt: new Date().toISOString(),
        statusHistory: [{ status: 'preparing', at: new Date().toISOString() }],
        items: [{ productId: 'qa-gaseosa-cola', name: 'Bebida QA', quantity: 1, unitPrice: 11200, unit: 'unidad' }],
        deliveryMode: 'delivery',
        customerName: 'Cliente activo',
        customerPhone: '2995559999',
        address: 'Roca 500',
        paymentMethod: 'Efectivo',
      },
    ],
    lastOrderId: null,
  });

  suppressActiveOrderFallback();
  const hasSelection = persistActiveOrderId('LT-ACTIVE-B');
  assert.equal(hasSelection, true);
  assert.equal(getActiveOrderId(), 'LT-ACTIVE-B');
  assert.equal(getActiveOrder()?.id, 'LT-ACTIVE-B');
});

test('una nueva selección explícita vuelve a habilitar fallback normal', () => {
  const now = Date.now();
  const activeStatusAt = new Date(now - 10_000).toISOString();
  const nextStatusAt = new Date(now - 20_000).toISOString();
  resetState({
    orders: [
      {
        id: 'LT-B',
        status: 'preparing',
        createdAt: activeStatusAt,
        statusHistory: [{ status: 'preparing', at: activeStatusAt }],
        items: [{ productId: 'qa-gaseosa-cola', name: 'Bebida QA', quantity: 1, unitPrice: 11200, unit: 'unidad' }],
        deliveryMode: 'delivery',
        customerName: 'Cliente activo',
        customerPhone: '2995554444',
        address: 'Roca 500',
        paymentMethod: 'Efectivo',
      },
      {
        id: 'LT-NEW',
        status: 'on_the_way',
        createdAt: nextStatusAt,
        statusHistory: [{ status: 'on_the_way', at: nextStatusAt }],
        items: [{ productId: 'qa-gaseosa-cola', name: 'Bebida QA', quantity: 1, unitPrice: 11200, unit: 'unidad' }],
        deliveryMode: 'delivery',
        customerName: 'Cliente nuevo',
        customerPhone: '2995558888',
        address: 'Mendoza 10',
        paymentMethod: 'Efectivo',
      },
    ],
    lastOrderId: null,
  });

  suppressActiveOrderFallback();
  assert.equal(getActiveOrderId(), null);

  const selected = persistActiveOrderId('LT-NEW');
  assert.equal(selected, true);
  assert.equal(getActiveOrderId(), 'LT-NEW');
  assert.equal(getActiveOrder()?.id, 'LT-NEW');
});

test('después de una actualización con fallback suprimido, sólo persistir manualmente vuelve a habilitarlo', () => {
  const orderId = 'LT-CONTROL';
  resetState({
    orders: [
      {
        id: orderId,
        status: 'preparing',
        createdAt: new Date().toISOString(),
        statusHistory: [{ status: 'preparing', at: new Date().toISOString() }],
        items: [{ productId: 'qa-gaseosa-cola', name: 'Bebida QA', quantity: 1, unitPrice: 11200, unit: 'unidad' }],
        deliveryMode: 'delivery',
        customerName: 'Cliente activo',
        customerPhone: '2995559999',
        address: 'Roca 500',
        paymentMethod: 'Efectivo',
      },
    ],
    lastOrderId: null,
  });
  suppressActiveOrderFallback();

  assert.equal(updateOrderStatus(orderId, 'ready').ok, true);
  assert.equal(getState().lastOrderId, null);
  assert.equal(getActiveOrderId(), null);
  assert.equal(getActiveOrder(), null);

  const wasPersisted = persistActiveOrderId(orderId);
  assert.equal(wasPersisted, true);
  assert.equal(getActiveOrderId(), orderId);
  assert.equal(getActiveOrder()?.id, orderId);
});

test('simulación: actualizar a arriving conserva la supresión y no reaparece como fallback', () => {
  const orderId = 'LT-SIM-ARRIVING';
  resetState({
    orders: [
      {
        id: orderId,
        status: 'on_the_way',
        createdAt: new Date().toISOString(),
        statusHistory: [{ status: 'on_the_way', at: new Date().toISOString() }],
        items: [{ productId: 'qa-gaseosa-cola', name: 'Bebida QA', quantity: 1, unitPrice: 11200, unit: 'unidad' }],
        deliveryMode: 'delivery',
        customerName: 'Cliente de simulación',
        customerPhone: '2995557777',
        address: 'San Martín 900',
        paymentMethod: 'Efectivo',
      },
    ],
    lastOrderId: null,
  });
  suppressActiveOrderFallback();

  assert.equal(updateOrderStatus(orderId, 'arriving').ok, true);
  assert.equal(getState().orders.find((candidate) => candidate.id === orderId)?.status, 'arriving');
  assert.equal(getActiveOrderId(), null);
  assert.equal(getActiveOrder(), null);
  assert.equal(getState().lastOrderId, null);
});

test('la supresión aislada en una prueba no afecta al resto del selector', () => {
  resetState({
    orders: [
      {
        id: 'LT-ACTIVE-B',
        status: 'preparing',
        createdAt: new Date().toISOString(),
        statusHistory: [{ status: 'preparing', at: new Date().toISOString() }],
        items: [{ productId: 'qa-gaseosa-cola', name: 'Bebida QA', quantity: 1, unitPrice: 11200, unit: 'unidad' }],
        deliveryMode: 'delivery',
        customerName: 'Cliente activo',
        customerPhone: '2995551111',
        address: 'Roca 500',
        paymentMethod: 'Efectivo',
      },
    ],
    lastOrderId: null,
  });

  suppressActiveOrderFallback();
  assert.equal(getActiveOrderId(), null);
  allowActiveOrderFallback();
  assert.equal(getActiveOrderId(), 'LT-ACTIVE-B');
  assert.equal(getActiveOrder()?.id, 'LT-ACTIVE-B');
});

test('status transitions no persisten ni activan la orden de forma automática', () => {
  addToCart('qa-gaseosa-cola', 1);
  const created = createOrderFromCheckout({
    ...CONFIRMED_DELIVERY_POINT,
    customerName: 'Activo QA',
    customerPhone: '2995550000',
    customerAddress: 'Roca 321',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
    customerNotes: '',
  });
  setState({ lastOrderId: null });

  assert.equal(updateOrderStatus(created.order.id, 'preparing').ok, true);
  assert.equal(getState().lastOrderId, null);
});

test('order status transitions reject invalid jumps and preserve history', () => {
  addToCart('qa-gaseosa-cola', 1);
  const created = createOrderFromCheckout({
    ...CONFIRMED_DELIVERY_POINT,
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
