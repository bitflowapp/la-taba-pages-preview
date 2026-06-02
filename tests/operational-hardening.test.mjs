import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  STATE_SCHEMA_VERSION,
  createOrderId,
  getState,
  hydrateState,
  sanitizeState,
} from '../js/state.js';
import { getActiveOrderId } from '../js/orders.js';
import {
  canTransitionOrderStatus,
  getNextOrderStatus,
  isTerminalOrderStatus,
} from '../js/core/order-status.js';
import { getRiderQueueOrder, isRiderQueueOrder } from '../js/core/rider.js';
import { chooseActiveLiveOrderId } from '../js/core/realtime-sync.js';
import { hasLiveRiderLocation } from '../js/map/route_geometry.js';
import { createRiderIcon, riderMarkerClass } from '../js/map/rider_marker.js';
import { resetState } from './helpers.mjs';

function makeOrder(id, status = 'received', deliveryMode = 'delivery') {
  const at = new Date().toISOString();
  return {
    id,
    customerName: 'QA Hardening',
    customerPhone: '2995550000',
    address: 'Roca 123',
    deliveryMode,
    paymentMethod: 'Efectivo',
    notes: '',
    createdAt: at,
    status,
    items: [{ productId: 'p-vacio', name: 'Vacío', quantity: 1, unitPrice: 1000, unit: 'kg' }],
    statusHistory: [{ status: 'received', at }],
  };
}

// ===== 1. Máquina de estados: nada de estados imposibles ni terminales activos =====
test('canTransitionOrderStatus bloquea transiciones imposibles', () => {
  // Terminal no se mueve.
  assert.equal(canTransitionOrderStatus(makeOrder('A', 'delivered'), 'preparing'), false);
  assert.equal(canTransitionOrderStatus(makeOrder('A', 'cancelled'), 'on_the_way'), false);
  // No se puede saltear pasos.
  assert.equal(canTransitionOrderStatus(makeOrder('A', 'received'), 'ready'), false);
  assert.equal(canTransitionOrderStatus(makeOrder('A', 'received'), 'preparing'), true);
  // Pickup nunca sale a reparto.
  assert.equal(canTransitionOrderStatus(makeOrder('A', 'ready', 'pickup'), 'on_the_way'), false);
  assert.equal(canTransitionOrderStatus(makeOrder('A', 'ready', 'pickup'), 'arriving'), false);
  // En reparto puede llegar o entregarse; cancelar siempre disponible desde no-terminal.
  assert.equal(canTransitionOrderStatus(makeOrder('A', 'on_the_way'), 'delivered'), true);
  assert.equal(canTransitionOrderStatus(makeOrder('A', 'on_the_way'), 'arriving'), true);
  assert.equal(canTransitionOrderStatus(makeOrder('A', 'preparing'), 'cancelled'), true);
  // Estado inválido rechazado.
  assert.equal(canTransitionOrderStatus(makeOrder('A', 'ready'), 'flying'), false);
});

test('getNextOrderStatus no avanza pedidos terminales', () => {
  assert.equal(getNextOrderStatus(makeOrder('A', 'delivered')), null);
  assert.equal(getNextOrderStatus(makeOrder('A', 'cancelled')), null);
  assert.equal(getNextOrderStatus(makeOrder('A', 'received')), 'preparing');
  assert.equal(getNextOrderStatus(makeOrder('A', 'ready', 'pickup')), 'delivered');
  assert.ok(isTerminalOrderStatus('delivered') && isTerminalOrderStatus('cancelled'));
});

test('un pedido terminal nunca queda como pedido activo "live"', () => {
  const live = makeOrder('LT-OTW', 'on_the_way');
  const done = makeOrder('LT-DONE', 'delivered');
  const cancelled = makeOrder('LT-CXL', 'cancelled');
  // Solo terminales => no hay activo live.
  assert.equal(chooseActiveLiveOrderId([done, cancelled]), null);
  // Con un live presente, gana el live, no el terminal.
  assert.equal(chooseActiveLiveOrderId([done, live, cancelled]), 'LT-OTW');
  // getActiveOrderId: sin lastOrderId válido, cae al live; terminales no cuentan.
  assert.equal(getActiveOrderId({ orders: [done], lastOrderId: null }), null);
  assert.equal(getActiveOrderId({ orders: [live, done], lastOrderId: null }), 'LT-OTW');
  assert.equal(getActiveOrderId({ orders: [live], lastOrderId: 'LT-OTW' }), 'LT-OTW');
});

test('la cola del rider excluye terminales y pickup, y prioriza el reparto en curso', () => {
  const ready = makeOrder('LT-READY', 'ready');
  const otw = makeOrder('LT-OTW', 'on_the_way');
  const done = makeOrder('LT-DONE', 'delivered');
  const pickup = makeOrder('LT-PICK', 'ready', 'pickup');
  assert.equal(isRiderQueueOrder(done), false);
  assert.equal(isRiderQueueOrder(pickup), false);
  assert.equal(isRiderQueueOrder(ready), true);
  assert.equal(getRiderQueueOrder([done, pickup, ready, otw]).id, 'LT-OTW');
  assert.equal(getRiderQueueOrder([done, pickup]), null);
});

test('createOrderId genera IDs únicos (sin duplicados) sobre el estado actual', () => {
  resetState({ orders: [] });
  const id = createOrderId();
  assert.match(id, /^LT-\d{4}$/);
  resetState();
  const next = createOrderId();
  assert.match(next, /^LT-\d{4}$/);
  assert.equal(getState().orders.some((order) => order.id === next), false);
});

// ===== 2. Endurecimiento de estado / localStorage con basura =====
test('sanitizeState sobrevive a basura y siempre devuelve una forma válida', () => {
  for (const garbage of [null, undefined, 'texto', 42, [], { orders: 'no-array' }, { products: 7 }]) {
    const result = sanitizeState(garbage);
    assert.equal(result.schemaVersion, STATE_SCHEMA_VERSION);
    assert.ok(Array.isArray(result.orders), 'orders es array');
    assert.ok(Array.isArray(result.products), 'products es array');
    assert.ok(Array.isArray(result.cart), 'cart es array');
  }
});

test('hydrateState ignora entradas no-objeto sin romper', () => {
  for (const bad of ['nope', 12, null, []]) {
    const result = hydrateState(bad);
    assert.equal(result.schemaVersion, STATE_SCHEMA_VERSION);
    assert.ok(Array.isArray(result.orders));
  }
});

test('sanitizeState descarta IDs de pedido duplicados conservando el más reciente', () => {
  const reciente = makeOrder('LT-DUP', 'on_the_way');
  const viejo = makeOrder('LT-DUP', 'received');
  const result = sanitizeState({ orders: [reciente, viejo] });
  const dupes = result.orders.filter((order) => order.id === 'LT-DUP');
  assert.equal(dupes.length, 1, 'un solo pedido por ID');
  assert.equal(dupes[0].status, 'on_the_way', 'gana la primera aparición (más reciente)');
});

test('lastOrderId inválido se descarta; válido se conserva', () => {
  const order = makeOrder('LT-1');
  assert.equal(sanitizeState({ orders: [order], lastOrderId: 'NO-EXISTE' }).lastOrderId, null);
  assert.equal(sanitizeState({ orders: [order], lastOrderId: 'LT-1' }).lastOrderId, 'LT-1');
  assert.equal(sanitizeState({ orders: [order], lastOrderId: 42 }).lastOrderId, null);
});

test('la simulación solo se conserva para un pedido de delivery activo', () => {
  const active = makeOrder('LT-A', 'on_the_way');
  const delivered = makeOrder('LT-D', 'delivered');
  const pickup = makeOrder('LT-P', 'ready', 'pickup');
  assert.ok(sanitizeState({ orders: [active], simulation: { orderId: 'LT-A', running: true, source: 'simulation' } }).simulation);
  assert.equal(sanitizeState({ orders: [delivered], simulation: { orderId: 'LT-D', running: true } }).simulation, null);
  assert.equal(sanitizeState({ orders: [pickup], simulation: { orderId: 'LT-P', running: true } }).simulation, null);
  assert.equal(sanitizeState({ orders: [], simulation: { orderId: 'GHOST' } }).simulation, null);
});

// ===== 3. Tracking honesto: sin GPS real no hay rider "en vivo" =====
test('hasLiveRiderLocation: solo GPS real y reciente cuenta como en vivo', () => {
  const now = 2_000_000;
  const freshGps = { lat: -38.95, lng: -68.05, source: 'gps', timestamp: now - 4_000 };
  assert.equal(hasLiveRiderLocation(freshGps, { now }), true);
  // GPS cortado / denegado / inactivo => no en vivo (vuelve a "Sin GPS en vivo").
  assert.equal(hasLiveRiderLocation({ ...freshGps, gpsStatus: 'inactive' }, { now }), false);
  assert.equal(hasLiveRiderLocation({ ...freshGps, gpsStatus: 'denied' }, { now }), false);
  assert.equal(hasLiveRiderLocation({ ...freshGps, gpsStatus: 'unavailable' }, { now }), false);
  // Fix viejo: no se muestra ubicación vieja como si fuera actual.
  assert.equal(hasLiveRiderLocation({ ...freshGps, timestamp: now - 60_000 }, { now }), false);
  // La simulación / recorrido guiado NO es un rider real.
  assert.equal(hasLiveRiderLocation({ lat: -38.95, lng: -68.05, source: 'simulation', timestamp: now }, { now }), false);
  assert.equal(hasLiveRiderLocation(null, { now }), false);
});

// ===== 4. Guard anti regresión: marker simple "R", sin casco/moto/rojo =====
test('el marker del rider es el disco simple "R", sin casco/moto/rojo', () => {
  const icon = createRiderIcon({ divIcon: (options) => options }, { status: 'on_the_way', source: 'gps', heading: 95 });
  // Contrato esperado por el mapa.
  assert.match(icon.html, /lt-rider-marker-halo/);
  assert.match(icon.html, /lt-rider-core-letter/);
  assert.match(icon.html, />R<\/text>/);
  assert.deepEqual(icon.iconSize, [52, 52]);
  // No reintroducir el marker viejo (moto / casco / rojo).
  for (const banned of ['lt-rider-moto', 'lt-rider-box', 'lt-rider-wheel', 'lt-rider-frame', 'lt-rider-light', 'casco', '#b64c34']) {
    assert.equal(icon.html.includes(banned), false, `marker no debe contener "${banned}"`);
  }
  assert.match(riderMarkerClass('on_the_way', 'gps'), /lt-rider-marker on-the-way source-gps/);
});

test('rider_marker.js y styles.css no reintroducen el marker viejo moto/casco', () => {
  const markerSrc = readFileSync(fileURLToPath(new URL('../js/map/rider_marker.js', import.meta.url)), 'utf8');
  for (const banned of ['lt-rider-moto', 'lt-rider-box', 'lt-rider-wheel', 'lt-rider-frame', 'lt-rider-light', 'casco', '#b64c34']) {
    assert.equal(markerSrc.includes(banned), false, `rider_marker.js no debe contener "${banned}"`);
  }
  const cssSrc = readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8');
  for (const banned of ['.lt-rider-moto', '.lt-rider-box', '.lt-rider-wheel', '.lt-rider-frame', '.lt-rider-light']) {
    assert.equal(cssSrc.includes(banned), false, `styles.css no debe contener la clase moto "${banned}"`);
  }
});
