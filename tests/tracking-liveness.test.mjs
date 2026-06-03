import assert from 'node:assert/strict';
import test from 'node:test';
import { activeTrackingLiveness } from '../js/map/route_geometry.js';

// Vivacidad del seguimiento: decide cuándo el cliente/negocio deben volver a un
// fallback honesto ("Sin GPS en vivo") porque el GPS real se enfrió, sin
// depender de que llegue un nuevo evento de estado. Es la base del tick de
// frescura de app.js, por eso se testea como función pura.

const NOW = 2_000_000;

function gpsSim(orderId, ageMs, extra = {}) {
  const ts = NOW - ageMs;
  return {
    orderId,
    lat: -38.95,
    lng: -68.05,
    source: 'gps',
    mode: 'gps',
    gpsStatus: 'active',
    timestamp: ts,
    lastFixAt: new Date(ts).toISOString(),
    ...extra,
  };
}

function order(id, status, tracking = null) {
  return { id, status, ...(tracking ? { tracking } : {}) };
}

test('activeTrackingLiveness: sin pedido (o sin id) => none', () => {
  assert.equal(activeTrackingLiveness(null, null, { now: NOW }), 'none');
  assert.equal(activeTrackingLiveness({ status: 'on_the_way' }, null, { now: NOW }), 'none');
});

test('activeTrackingLiveness: pedido terminal no se sigue', () => {
  assert.equal(activeTrackingLiveness(order('LT-1', 'delivered'), gpsSim('LT-1', 1000), { now: NOW }), 'terminal');
  assert.equal(activeTrackingLiveness(order('LT-1', 'cancelled'), gpsSim('LT-1', 1000), { now: NOW }), 'terminal');
});

test('activeTrackingLiveness: GPS real fresco del pedido => live', () => {
  assert.equal(activeTrackingLiveness(order('LT-1', 'on_the_way'), gpsSim('LT-1', 4000), { now: NOW }), 'live');
});

test('activeTrackingLiveness: GPS viejo (sobre 30s) => idle, fallback honesto', () => {
  assert.equal(activeTrackingLiveness(order('LT-1', 'on_the_way'), gpsSim('LT-1', 31_000), { now: NOW }), 'idle');
});

test('activeTrackingLiveness: el mismo fix se enfría con el tiempo (live -> idle)', () => {
  const sim = gpsSim('LT-1', 0); // fix "ahora"
  const o = order('LT-1', 'on_the_way');
  assert.equal(activeTrackingLiveness(o, sim, { now: NOW }), 'live');
  // 40s después, sin un nuevo fix, debe degradar a idle aunque nada cambió el estado.
  assert.equal(activeTrackingLiveness(o, sim, { now: NOW + 40_000 }), 'idle');
});

test('activeTrackingLiveness: sin GPS o GPS de otro pedido => idle', () => {
  assert.equal(activeTrackingLiveness(order('LT-1', 'ready'), null, { now: NOW }), 'idle');
  assert.equal(activeTrackingLiveness(order('LT-1', 'on_the_way'), gpsSim('LT-OTHER', 1000), { now: NOW }), 'idle');
});

test('activeTrackingLiveness: GPS detenido/denegado => idle aunque el fix sea reciente', () => {
  assert.equal(activeTrackingLiveness(order('LT-1', 'on_the_way'), gpsSim('LT-1', 2000, { gpsStatus: 'inactive' }), { now: NOW }), 'idle');
  assert.equal(activeTrackingLiveness(order('LT-1', 'on_the_way'), gpsSim('LT-1', 2000, { gpsStatus: 'denied' }), { now: NOW }), 'idle');
});

test('activeTrackingLiveness: usa order.tracking.lastLocation cuando no hay sim (vista cliente)', () => {
  const ts = NOW - 3000;
  const tracking = {
    lastLocation: {
      lat: -38.95, lng: -68.05, source: 'gps', gpsStatus: 'active',
      timestamp: ts, lastFixAt: new Date(ts).toISOString(),
    },
  };
  assert.equal(activeTrackingLiveness(order('LT-1', 'on_the_way', tracking), null, { now: NOW }), 'live');
});
