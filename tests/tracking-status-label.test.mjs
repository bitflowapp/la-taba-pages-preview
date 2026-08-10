import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TRACKING_STATE,
  WEAK_SIGNAL_ACCURACY_METERS,
  relativeAge,
  trackingStatus,
} from '../js/map/tracking_status.js';

const NOW = Date.parse('2026-08-09T18:45:00.000Z');

function fix({ ageMs = 0, accuracy = 12 } = {}) {
  return {
    lat: -38.9459,
    lng: -68.0533,
    accuracy,
    source: 'gps',
    timestamp: NOW - ageMs,
    lastFixAt: new Date(NOW - ageMs).toISOString(),
  };
}

test('la antigüedad se dice en la unidad que corresponde y sin decimales', () => {
  assert.equal(relativeAge(0), 'hace 0 s');
  assert.equal(relativeAge(8.4), 'hace 8 s');
  assert.equal(relativeAge(59), 'hace 59 s');
  assert.equal(relativeAge(95), 'hace 2 min');
  assert.equal(relativeAge(3_600), 'hace 1 h');
  assert.equal(relativeAge(-5), 'hace 0 s', 'un reloj corrido no produce edades negativas');
});

test('un fix recién llegado se anuncia en vivo', () => {
  const status = trackingStatus(fix({ ageMs: 900 }), { now: NOW });
  assert.equal(status.state, TRACKING_STATE.LIVE);
  assert.equal(status.label, 'Ubicación en vivo · ahora');
});

test('en vivo con unos segundos encima lleva la antigüedad a la vista', () => {
  const status = trackingStatus(fix({ ageMs: 8_000 }), { now: NOW });
  assert.equal(status.state, TRACKING_STATE.LIVE);
  assert.equal(status.label, 'Ubicación en vivo · hace 8 s');
});

test('pasados los 15 s el texto deja de prometer que es en vivo', () => {
  const status = trackingStatus(fix({ ageMs: 22_000 }), { now: NOW });
  assert.equal(status.state, TRACKING_STATE.DELAYED);
  assert.equal(status.label, 'Actualizado hace 22 s');
});

test('la precisión pobre se dice, no se disimula', () => {
  const status = trackingStatus(
    fix({ ageMs: 4_000, accuracy: WEAK_SIGNAL_ACCURACY_METERS + 20 }),
    { now: NOW },
  );
  assert.equal(status.state, TRACKING_STATE.WEAK);
  assert.ok(status.label.startsWith('Señal GPS débil · '), status.label);
  assert.equal(status.accuracy, WEAK_SIGNAL_ACCURACY_METERS + 20);
});

test('la precisión normal del Moto G15 nunca se marca como débil', () => {
  // Precisión mediana medida en las trazas reales: 11,8 m.
  const status = trackingStatus(fix({ ageMs: 3_000, accuracy: 11.8 }), { now: NOW });
  assert.equal(status.state, TRACKING_STATE.LIVE);
});

test('cuando deja de llegar señal se dice sin conexión y con la antigüedad', () => {
  const status = trackingStatus(fix({ ageMs: 95_000 }), { now: NOW });
  assert.equal(status.state, TRACKING_STATE.OFFLINE);
  assert.equal(status.label, 'Sin conexión · última ubicación hace 2 min');
});

test('el cliente sin red ve lo mismo aunque el fix sea fresco', () => {
  const status = trackingStatus(fix({ ageMs: 3_000 }), { now: NOW, online: false });
  assert.equal(status.state, TRACKING_STATE.OFFLINE);
  assert.equal(status.label, 'Sin conexión · última ubicación hace 3 s');
});

test('estar sin conexión gana sobre tener poca precisión', () => {
  const status = trackingStatus(
    fix({ ageMs: 5_000, accuracy: 200 }),
    { now: NOW, online: false },
  );
  assert.equal(status.state, TRACKING_STATE.OFFLINE);
});

test('sin ubicación no se inventa un estado', () => {
  const status = trackingStatus(null, { now: NOW });
  assert.equal(status.state, TRACKING_STATE.NONE);
  assert.equal(status.ageSeconds, null);
});

test('un fix sin GPS real no se presenta como seguimiento', () => {
  const status = trackingStatus({ ...fix(), source: 'simulation' }, { now: NOW });
  assert.equal(status.state, TRACKING_STATE.NONE);
});

test('ningún estado deja al cliente sin la última ubicación conocida', () => {
  // La regla de producto: perder señal cambia el TEXTO, nunca borra el dato.
  for (const opciones of [{ online: false }, {}]) {
    for (const ageMs of [1_000, 20_000, 120_000]) {
      const status = trackingStatus(fix({ ageMs }), { now: NOW, ...opciones });
      assert.notEqual(status.state, TRACKING_STATE.NONE);
      assert.ok(Number.isFinite(status.ageSeconds));
    }
  }
});
