import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MOTION_CONVERGE_MS,
  MOTION_MAX_DURATION_MS,
  MOTION_MIN_DURATION_MS,
  MOTION_REJECTIONS,
  classifyFix,
  createRiderMotion,
  easeInOutCubic,
  travelDurationMs,
} from '../js/map/rider_motion.js';

const BASE = Date.parse('2026-08-09T18:40:00.000Z');

/* Un fix medido, en la forma en que llega desde el backend. */
function fix({ at = 0, lat = -38.9459, lng = -68.0533, accuracy = 12 } = {}) {
  return {
    lat,
    lng,
    accuracy,
    source: 'gps',
    timestamp: BASE + at,
    lastFixAt: new Date(BASE + at).toISOString(),
  };
}

/* Metros -> grados, a la latitud de Neuquén. Alcanza para mover un punto. */
const METER_LAT = 1 / 111_320;

function reloj(inicial = BASE) {
  let t = inicial;
  return { now: () => t, avanzar: (ms) => { t += ms; return t; } };
}

test('un fix con coordenadas inválidas no entra', () => {
  const verdict = classifyFix(null, { lat: 'x', lng: -68, source: 'gps' }, { now: BASE });
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, MOTION_REJECTIONS.INVALID);
});

test('un fix con el reloj adelantado no entra', () => {
  const verdict = classifyFix(null, fix({ at: 60_000 }), { now: BASE });
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, MOTION_REJECTIONS.FUTURE);
});

test('un fix más viejo que el último aceptado no entra', () => {
  const verdict = classifyFix(fix({ at: 10_000 }), fix({ at: 5_000 }), { now: BASE + 20_000 });
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, MOTION_REJECTIONS.BACKWARDS);
});

test('un fix con precisión fuera de rango no entra', () => {
  const verdict = classifyFix(null, fix({ accuracy: 900 }), { now: BASE });
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, MOTION_REJECTIONS.ACCURACY);
});

test('un salto a velocidad imposible no entra', () => {
  // 5 km en 10 s son 500 m/s: ningún repartidor hace eso.
  const lejos = fix({ at: 10_000, lat: -38.9459 + 5_000 * METER_LAT });
  const verdict = classifyFix(fix({ at: 0 }), lejos, { now: BASE + 10_000 });
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, MOTION_REJECTIONS.IMPOSSIBLE);
});

test('un fix feo pero posible SÍ entra: la coordenada del backend es la verdad', () => {
  // 90 m en 10 s son 9 m/s (32 km/h en moto) con precisión pobre pero legal.
  const siguiente = fix({ at: 10_000, lat: -38.9459 + 90 * METER_LAT, accuracy: 140 });
  const verdict = classifyFix(fix({ at: 0 }), siguiente, { now: BASE + 10_000 });
  assert.equal(verdict.accepted, true);
});

test('la duración del tramo sale de la cadencia real y queda acotada', () => {
  assert.equal(travelDurationMs(12_400), 12_400 * 0.9);
  assert.equal(travelDurationMs(50), MOTION_MIN_DURATION_MS);
  assert.equal(travelDurationMs(600_000), MOTION_MAX_DURATION_MS);
  assert.equal(travelDurationMs(null), MOTION_MIN_DURATION_MS);
});

test('el easing arranca y frena suave', () => {
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(1), 1);
  assert.ok(easeInOutCubic(0.5) > 0.49 && easeInOutCubic(0.5) < 0.51);
  assert.ok(easeInOutCubic(0.1) < 0.1, 'arranca más lento que lineal');
  assert.ok(easeInOutCubic(0.9) > 0.9, 'frena llegando');
});

test('el primer fix se planta sin animar: no hay de dónde venir', () => {
  const t = reloj();
  const motion = createRiderMotion({ now: t.now });
  const result = motion.pushFix(fix({ at: 0 }));
  assert.equal(result.mode, 'instant');
  assert.equal(motion.isMoving(), false);
  assert.deepEqual(motion.visualPositionAt(), { lat: -38.9459, lng: -68.0533 });
});

test('entre dos fixes el marcador recorre el tramo en vez de teletransportarse', () => {
  const t = reloj();
  const motion = createRiderMotion({ now: t.now });
  motion.pushFix(fix({ at: 0 }));
  t.avanzar(12_400);
  const destino = -38.9459 + 60 * METER_LAT;
  const result = motion.pushFix(fix({ at: 12_400, lat: destino }));

  assert.equal(result.mode, 'travel');
  assert.ok(result.durationMs >= 8_000, `el tramo dura lo que la cadencia: ${result.durationMs}`);

  // A mitad de camino el marcador está EN EL MEDIO, no en ninguno de los dos.
  t.avanzar(result.durationMs / 2);
  const medio = motion.visualPositionAt();
  assert.ok(medio.lat < destino, 'todavía no llegó');
  assert.ok(medio.lat > -38.9459, 'ya salió del punto anterior');
  assert.equal(motion.isMoving(), true);

  // Al terminar el tramo, el marcador está EXACTAMENTE sobre el fix medido.
  t.avanzar(result.durationMs / 2 + 1);
  assert.equal(motion.isMoving(), false);
  assert.equal(motion.visualPositionAt().lat, destino);
});

test('la posición visual nunca se adelanta al último fix medido', () => {
  const t = reloj();
  const motion = createRiderMotion({ now: t.now });
  motion.pushFix(fix({ at: 0 }));
  t.avanzar(12_000);
  const destino = -38.9459 + 60 * METER_LAT;
  motion.pushFix(fix({ at: 12_000, lat: destino }));

  // Pasa MUCHO más tiempo del que dura el tramo y no llega ningún fix nuevo.
  t.avanzar(120_000);
  const visual = motion.visualPositionAt();
  assert.equal(visual.lat, destino, 'se queda quieto sobre la última coordenada real');
  assert.equal(motion.measuredPosition().lat, destino);
  assert.equal(motion.isMoving(), false);
});

test('la posición medida y la visual son cosas distintas y no se contaminan', () => {
  const t = reloj();
  const motion = createRiderMotion({ now: t.now });
  motion.pushFix(fix({ at: 0 }));
  t.avanzar(12_000);
  const destino = -38.9459 + 60 * METER_LAT;
  motion.pushFix(fix({ at: 12_000, lat: destino, accuracy: 9 }));
  t.avanzar(1_000);

  const medida = motion.measuredPosition();
  const visual = motion.visualPositionAt();
  assert.equal(medida.lat, destino, 'la medida es SIEMPRE el fix del backend');
  assert.equal(medida.accuracy, 9);
  assert.notEqual(visual.lat, medida.lat, 'la visual va en camino');
  assert.equal(visual.accuracy, undefined, 'la visual no lleva metadatos de medición');
});

test('un salto largo converge acotado en vez de fingir un recorrido', () => {
  const t = reloj();
  const motion = createRiderMotion({ now: t.now });
  motion.pushFix(fix({ at: 0 }));
  t.avanzar(90_000);
  // 900 m en 90 s: velocidad plausible, pero no es un tramo que hayamos visto.
  const result = motion.pushFix(fix({ at: 90_000, lat: -38.9459 + 900 * METER_LAT }));
  assert.equal(result.mode, 'converge');
  assert.equal(result.durationMs, MOTION_CONVERGE_MS);
});

test('volver de una desconexión converge rápido en vez de recorrer el hueco', () => {
  // El contrato público entrega SÓLO la última coordenada: al volver la red el
  // cliente recibe un único punto, el más nuevo. El hueco de tiempo es lo que
  // delata que hubo un corte.
  const t = reloj();
  const motion = createRiderMotion({ now: t.now });
  motion.pushFix(fix({ at: 0 }));
  t.avanzar(12_000);
  motion.pushFix(fix({ at: 12_000, lat: -38.9459 + 40 * METER_LAT }));

  // 75 s sin nada: seis veces la cadencia normal. Aunque la distancia sea
  // chica, esto es una recuperación y no un tramo del reparto.
  t.avanzar(75_000);
  const destino = -38.9459 + 140 * METER_LAT;
  const resultado = motion.pushFix(fix({ at: 87_000, lat: destino }));

  assert.equal(resultado.mode, 'converge');
  assert.equal(resultado.durationMs, MOTION_CONVERGE_MS);
  t.avanzar(MOTION_CONVERGE_MS + 1);
  assert.equal(motion.visualPositionAt().lat, destino);
  assert.equal(motion.isMoving(), false);
});

test('el hueco de la reconexión no sube la vara para el fix siguiente', () => {
  const t = reloj();
  const motion = createRiderMotion({ now: t.now });
  motion.pushFix(fix({ at: 0 }));
  t.avanzar(12_000);
  motion.pushFix(fix({ at: 12_000, lat: -38.9459 + 40 * METER_LAT }));
  t.avanzar(75_000);
  motion.pushFix(fix({ at: 87_000, lat: -38.9459 + 140 * METER_LAT }));

  // Se restablece la cadencia normal: el tramo siguiente vuelve a recorrerse.
  t.avanzar(12_000);
  const resultado = motion.pushFix(fix({ at: 99_000, lat: -38.9459 + 180 * METER_LAT }));
  assert.equal(resultado.mode, 'travel', 'la reconexión no deja el motor convergiendo para siempre');
});

test('un fix nuevo a mitad de tramo arranca desde donde SE VE el marcador', () => {
  const t = reloj();
  const motion = createRiderMotion({ now: t.now });
  motion.pushFix(fix({ at: 0 }));
  t.avanzar(12_000);
  motion.pushFix(fix({ at: 12_000, lat: -38.9459 + 60 * METER_LAT }));

  t.avanzar(3_000);
  const enElMedio = motion.visualPositionAt();
  motion.pushFix(fix({ at: 24_000, lat: -38.9459 + 120 * METER_LAT }));

  // Sin salto hacia atrás: el tramo nuevo empieza donde el ojo dejó el marcador.
  const apenasDespues = motion.visualPositionAt();
  assert.ok(
    Math.abs(apenasDespues.lat - enElMedio.lat) < 1e-9,
    'el marcador no vuelve atrás para arrancar el tramo siguiente',
  );
});

test('con prefers-reduced-motion no se interpola nada', () => {
  const t = reloj();
  const motion = createRiderMotion({ now: t.now, reducedMotion: true });
  motion.pushFix(fix({ at: 0 }));
  t.avanzar(12_000);
  const destino = -38.9459 + 60 * METER_LAT;
  const result = motion.pushFix(fix({ at: 12_000, lat: destino }));
  assert.equal(result.mode, 'instant');
  assert.equal(motion.isMoving(), false);
  assert.equal(motion.visualPositionAt().lat, destino);
});

test('el jitter real del equipo quieto no dispara movimiento visible', () => {
  // Traza REAL del Moto G15 en LT-0101, con el equipo detenido: cinco fixes
  // consecutivos tal como los guardó el backend.
  const quieto = [
    { at: 0, lat: -38.9459212, lng: -68.0532894, accuracy: 13.434 },
    { at: 10_433, lat: -38.9459188, lng: -68.0532905, accuracy: 8.945 },
    { at: 20_848, lat: -38.9459174, lng: -68.0532906, accuracy: 6.573 },
    { at: 33_264, lat: -38.9459127, lng: -68.0533004, accuracy: 12.892 },
    { at: 45_677, lat: -38.9459131, lng: -68.0532979, accuracy: 11.548 },
  ];
  const t = reloj();
  const motion = createRiderMotion({ now: t.now });
  let anterior = null;
  for (const punto of quieto) {
    t.avanzar(punto.at - (anterior?.at ?? 0));
    const result = motion.pushFix(fix(punto));
    assert.equal(result.accepted, true, 'ningún fix real del equipo quieto se descarta');
    if (anterior) assert.equal(result.mode, 'travel', 'se interpola, no se salta');
    anterior = punto;
  }
  // Todo el jitter medido cabe en pocos metros: nunca se convierte en un salto.
  const medida = motion.measuredPosition();
  assert.ok(Math.abs(medida.lat - quieto.at(-1).lat) < 1e-9);
  assert.equal(motion.debugState().rejected, 0);
});

test('reset deja el motor como recién creado', () => {
  const t = reloj();
  const motion = createRiderMotion({ now: t.now });
  motion.pushFix(fix({ at: 0 }));
  motion.reset();
  assert.equal(motion.measuredPosition(), null);
  assert.equal(motion.visualPositionAt(), null);
  assert.equal(motion.isMoving(), false);
});
