import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { MOTION_REJECTIONS, createRiderMotion } from '../js/map/rider_motion.js';

/*
 * El contrato: una vez aceptado un fix F, ningún fix capturado antes que F
 * puede volver a mover el rider hacia atrás.
 *
 * Lo que estas pruebas NO hacen: filtrar por distancia. Si el rider vuelve
 * físicamente por la misma calle, eso tiene que verse. Lo único que distingue
 * «fix viejo que llegó tarde» de «fix nuevo donde el rider volvió» es la hora
 * de captura, y por eso el cursor canónico es temporal, nunca geométrico.
 */

const BASE = Date.parse('2026-08-11T01:26:46.000Z');
const METER_LAT = 1 / 111_320;

/* Un fix como lo entrega el contrato público: sellado con su hora de CAPTURA. */
function fix(nombre, { at, metros }) {
  return {
    nombre,
    lat: -38.9459 + (metros * METER_LAT),
    lng: -68.0533,
    accuracy: 12,
    source: 'gps',
    timestamp: BASE + at,
    lastFixAt: new Date(BASE + at).toISOString(),
  };
}

const A = fix('A', { at: 0, metros: 0 });
const B = fix('B', { at: 12_000, metros: 30 });
const C = fix('C', { at: 24_000, metros: 60 });
const D = fix('D', { at: 36_000, metros: 90 });
const E = fix('E', { at: 48_000, metros: 120 });

/*
 * Corre una secuencia de LLEGADAS. El reloj de quien mira avanza hasta la hora
 * en que el fix pudo llegar —su captura más la latencia de publicación— y nunca
 * retrocede: un fix viejo que llega tarde llega TARDE, no en el pasado.
 */
const LATENCIA_MS = 400;

function correr(llegadas) {
  let reloj = BASE;
  const motion = createRiderMotion({ now: () => reloj });
  const diario = [];
  for (const { fix: f } of llegadas) {
    reloj = Math.max(reloj + LATENCIA_MS, Number(f.timestamp || BASE) + LATENCIA_MS);
    const veredicto = motion.pushFix(f);
    diario.push({
      nombre: f.nombre,
      aceptado: veredicto.accepted,
      razon: veredicto.reason || '',
      modo: veredicto.mode || '',
      medido: motion.measuredPosition(),
    });
  }
  return { diario, motion, reloj };
}

const posicionDe = (motion) => motion.measuredPosition()?.lat;

test('A → B → C avanza en orden y termina en C', () => {
  const { diario, motion } = correr([{ fix: A }, { fix: B }, { fix: C }]);
  assert.deepEqual(diario.map((d) => d.aceptado), [true, true, true]);
  assert.equal(posicionDe(motion), C.lat);
});

test('A → B → C → B(viejo): se queda en C y no retrocede', () => {
  const { diario, motion } = correr([{ fix: A }, { fix: B }, { fix: C }, { fix: B }]);
  assert.equal(diario.at(-1).aceptado, false);
  assert.equal(diario.at(-1).razon, MOTION_REJECTIONS.BACKWARDS);
  assert.equal(posicionDe(motion), C.lat, 'el marcador tiene que seguir en C');
});

test('A → B → C y después un poll con [A, B, C]: ninguno vuelve a moverlo', () => {
  const { diario, motion } = correr([
    { fix: A }, { fix: B }, { fix: C },
    { fix: A }, { fix: B }, { fix: C },
  ]);
  assert.deepEqual(diario.map((d) => d.aceptado), [true, true, true, false, false, false]);
  assert.equal(posicionDe(motion), C.lat);
  assert.deepEqual(diario.slice(3).map((d) => d.razon), [
    MOTION_REJECTIONS.BACKWARDS, MOTION_REJECTIONS.BACKWARDS, MOTION_REJECTIONS.DUPLICATE,
  ]);
});

test('realtime entrega C y el poll llega con B: no retrocede', () => {
  const { diario, motion } = correr([{ fix: A }, { fix: C }, { fix: B }]);
  assert.equal(diario.at(-1).aceptado, false);
  assert.equal(posicionDe(motion), C.lat);
});

test('cola offline: A,B,C,D drenados DESPUÉS de E en vivo no reproducen el camino', () => {
  const { diario, motion } = correr([
    { fix: E },
    { fix: A }, { fix: B }, { fix: C }, { fix: D },
  ]);
  assert.equal(diario[0].aceptado, true);
  assert.deepEqual(diario.slice(1).map((d) => d.aceptado), [false, false, false, false]);
  assert.equal(posicionDe(motion), E.lat, 'el cliente converge al fix canónico más reciente');
});

test('duplicados: el mismo fix dos veces no reinicia la animación', () => {
  let reloj = BASE + LATENCIA_MS;
  const motion = createRiderMotion({ now: () => reloj });
  motion.pushFix(A);
  reloj = B.timestamp + LATENCIA_MS;
  motion.pushFix(B);
  reloj += 200;
  const enVuelo = motion.visualPositionAt();
  const repetido = motion.pushFix(B);
  assert.equal(repetido.accepted, false);
  assert.equal(repetido.reason, MOTION_REJECTIONS.DUPLICATE);
  assert.deepEqual(motion.visualPositionAt(), enVuelo, 'la animación no se reinicia');
});

test('remount con último fix C: arranca en C, no en el punto de retiro', () => {
  const { motion: primero } = correr([{ fix: A }, { fix: B }, { fix: C }]);
  const ultimoConocido = primero.measuredPosition();

  let reloj = C.timestamp + 6_000;
  const remontado = createRiderMotion({ now: () => reloj });
  const veredicto = remontado.pushFix({ ...C, ...ultimoConocido });
  assert.equal(veredicto.accepted, true);
  assert.equal(veredicto.mode, 'instant', 'el primer fix tras el remount no se camina');
  assert.equal(posicionDe(remontado), C.lat);
  assert.notEqual(posicionDe(remontado), A.lat, 'no puede empezar desde el retiro');
});

test('un regreso REAL sí se ve: C → B con captura nueva mueve el marcador', () => {
  const regresoReal = { ...B, timestamp: BASE + 36_000, lastFixAt: new Date(BASE + 36_000).toISOString() };
  const { diario, motion } = correr([{ fix: A }, { fix: B }, { fix: C }, { fix: regresoReal }]);
  assert.equal(diario.at(-1).aceptado, true, 'volver por la misma calle no es un fix viejo');
  assert.equal(posicionDe(motion), B.lat);
});

test('un fix sin hora de captura no se sella con el reloj de quien mira', () => {
  const sinFecha = { lat: A.lat, lng: A.lng, accuracy: 12, source: 'gps' };
  const { diario, motion } = correr([{ fix: A }, { fix: B }, { fix: C }, { fix: { ...sinFecha, nombre: 'sin-fecha' } }]);
  assert.equal(diario.at(-1).aceptado, false);
  assert.equal(diario.at(-1).razon, MOTION_REJECTIONS.UNDATED);
  assert.equal(posicionDe(motion), C.lat);
});

test('el contrato público ordena y sella por hora de CAPTURA, no de llegada', () => {
  const sql = fs.readFileSync(
    new URL('../supabase/migrations/20260811020000_public_tracking_canonical_capture_order.sql', import.meta.url),
    'utf8',
  );
  assert.match(sql, /order by coalesce\(rl\.captured_at, rl\.created_at\) desc, rl\.receipt_sequence desc/);
  assert.match(sql, /'captured_at', coalesce\(rl\.captured_at, rl\.created_at\)/);
  assert.match(sql, /coalesce\(rl\.captured_at, rl\.created_at\) >= clock_timestamp\(\) - interval '3 minutes'/);
  // receipt_sequence desempata del lado del servidor, pero NO viaja: es un
  // contador global del negocio y diría cuántos fixes publica.
  assert.doesNotMatch(sql, /'receipt_sequence'/);
});

test('la coordenada pública se redondea a 4 decimales y no viaja cruda', () => {
  const sql = fs.readFileSync(
    new URL('../supabase/migrations/20260811020000_public_tracking_canonical_capture_order.sql', import.meta.url),
    'utf8',
  );
  assert.match(sql, /round\(rl\.lat::numeric, 4\)/);
  assert.match(sql, /round\(rl\.lng::numeric, 4\)/);
  // Ni una coordenada sin redondear en el DTO.
  assert.doesNotMatch(sql, /'lat',\s*rl\.lat\b/);
  assert.doesNotMatch(sql, /'lng',\s*rl\.lng\b/);
  // El piso de precisión sigue en pie: se dice dónde, no con cuánta certeza.
  assert.match(sql, /greatest\(100, ceil\(rl\.accuracy\)\)/);
  // Y el resto de las protecciones no se aflojó al pasar por acá.
  assert.match(sql, /rl\.accuracy between 0 and 250/);
  assert.match(sql, /v_order\.status in \('picked_up', 'on_the_way', 'arrived'\)/);
  assert.match(sql, /opt\.revoked_at is null and opt\.expires_at > clock_timestamp\(\)/);
  assert.match(sql, /rl\.rider_user_id = v_order\.assigned_rider_user_id/);
});

test('la documentación de privacidad dice lo mismo que el código', () => {
  const modelo = fs.readFileSync(new URL('../docs/security/public-tracking-threat-model.md', import.meta.url), 'utf8');
  const revision = fs.readFileSync(new URL('../docs/final-commercial-release/tracking-security-review.md', import.meta.url), 'utf8');
  for (const [nombre, texto] of [['threat model', modelo], ['security review', revision]]) {
    assert.match(texto, /cuatro decimales/i, `${nombre} tiene que declarar los cuatro decimales`);
    assert.match(texto, /~11 m/, `${nombre} tiene que declarar la granularidad real`);
    assert.doesNotMatch(texto, /redondeada \(~100 m\)|redondean a tres decimales/i,
      `${nombre} no puede seguir afirmando la granularidad vieja`);
  }
});
