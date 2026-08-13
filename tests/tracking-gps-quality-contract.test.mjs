// El cliente deja de adivinar la calidad del GPS sobre un número que el
// servidor ya degradó (F26 + F36).
//
// EL DEFECTO, EN UNA LÍNEA
// ------------------------
// `get_public_order_tracking` publica `greatest(100, ceil(accuracy))`: un piso
// de privacidad, no una medición. `tracking_status.js` llamaba «Señal GPS
// débil» a todo lo que superara 80 m. Como 100 > 80, la rama WEAK se cumplía
// SIEMPRE y «Ubicación en vivo» era inalcanzable para cualquier cliente real.
//
// POR QUÉ LA SUITE NO LO VEÍA
// ---------------------------
// Cada fixture sembraba `accuracy: 12`, un valor que el contrato público NO
// PUEDE EMITIR. Los tests medían un mundo que no existe. Por eso este archivo
// usa 100 —lo que de verdad llega— en todos los casos frescos.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { TRACKING_STATE, trackingStatus } from '../js/map/tracking_status.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOW = Date.parse('2026-08-14T12:00:00.000Z');

/** Un fix como el que realmente llega del servidor: precisión ya con piso. */
function fixPublico({ quality, ageSeconds = 1, accuracy = 100 } = {}) {
  const at = new Date(NOW - ageSeconds * 1000).toISOString();
  return {
    lat: -38.9461,
    lng: -68.0533,
    accuracy,
    source: 'gps',
    lastFixAt: at,
    capturedAt: at,
    createdAt: at,
    ...(quality ? { quality } : {}),
  };
}

test('con el contrato nuevo, «Ubicación en vivo» vuelve a ser alcanzable', () => {
  // Éste es el caso que el producto no podía mostrar: precisión publicada 100
  // —la única que el servidor emite para un fix bueno— y el servidor diciendo
  // que el fix original era válido.
  const estado = trackingStatus(fixPublico({ quality: 'valid' }), { now: NOW });
  assert.equal(estado.state, TRACKING_STATE.LIVE);
  assert.match(estado.label, /Ubicación en vivo/);
});

test('el mismo 100 con calidad pobre NO se anuncia como en vivo', () => {
  // Mismo número publicado que el caso anterior. Lo único que cambia es lo que
  // el servidor sabe del dato original. Si el cliente dedujera la calidad del
  // número, estos dos casos serían indistinguibles.
  const estado = trackingStatus(fixPublico({ quality: 'low_accuracy' }), { now: NOW });
  assert.equal(estado.state, TRACKING_STATE.WEAK);
  assert.match(estado.label, /débil/);
});

test('un fix declarado stale no se presenta como bueno', () => {
  const estado = trackingStatus(fixPublico({ quality: 'stale', ageSeconds: 4 }), { now: NOW });
  assert.notEqual(estado.state, TRACKING_STATE.LIVE);
});

test('sin calidad del servidor no se inventa ninguna: falla cerrado', () => {
  // Respuesta de un servidor viejo: no manda la clave. Con precisión 100 el
  // umbral histórico da «débil», que es conservador y nunca promete «en vivo».
  const estado = trackingStatus(fixPublico({ quality: undefined }), { now: NOW });
  assert.notEqual(estado.state, TRACKING_STATE.LIVE);
});

test('una calidad desconocida tampoco habilita a prometer en vivo', () => {
  const estado = trackingStatus(fixPublico({ quality: 'brillante' }), { now: NOW });
  assert.notEqual(estado.state, TRACKING_STATE.LIVE);
});

test('quedarse sin conexión sigue ganando sobre la calidad del fix', () => {
  const estado = trackingStatus(fixPublico({ quality: 'valid' }), { now: NOW, online: false });
  assert.equal(estado.state, TRACKING_STATE.OFFLINE);
});

test('el repositorio sólo acepta los cuatro estados del contrato', () => {
  const repo = fs.readFileSync(path.join(root, 'js', 'repositories', 'supabase_order_repository.js'), 'utf8');
  assert.match(repo, /PUBLIC_TRACKING_QUALITY_STATES = new Set\(\['valid', 'low_accuracy', 'stale', 'unavailable'\]\)/);
  // Un valor fuera del contrato no se propaga como si fuera calidad conocida.
  assert.match(repo, /PUBLIC_TRACKING_QUALITY_STATES\.has\(dto\.location_quality\)\s*\?\s*dto\.location_quality\s*:\s*null/);
});

test('la definición vigente calcula la calidad sobre el dato ORIGINAL', () => {
  // Se afirma sobre la ÚLTIMA definición de la función, no sobre un archivo
  // histórico: las migraciones no se editan, así que un test atado a un archivo
  // fijo queda verde para siempre aunque un `create or replace` posterior
  // rompa el contrato. Es la lección de F25.
  const dir = path.join(root, 'supabase', 'migrations');
  const cuerpos = fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()
    .map((n) => fs.readFileSync(path.join(dir, n), 'utf8'))
    .join('\n');
  const marca = 'create or replace function public.get_public_order_tracking';
  const ultima = cuerpos.toLowerCase().lastIndexOf(marca);
  assert.notEqual(ultima, -1, 'no se encontró la definición de get_public_order_tracking');
  const cuerpo = cuerpos.slice(ultima);

  // La calidad sale de la accuracy sin degradar y del corte de frescura...
  assert.match(cuerpo, /v_fix_accuracy <= c_good_accuracy/);
  assert.match(cuerpo, /v_fix_at < v_fresh_cutoff/);
  // ...y NO del número que se publica.
  assert.doesNotMatch(cuerpo, /greatest\(100[^)]*\)[^;]*<=\s*c_good_accuracy/);
  // El degradado público sigue intacto: piso de 100 m y 4 decimales.
  assert.match(cuerpo, /greatest\(100, ceil\(rl\.accuracy\)\)::integer/);
  assert.match(cuerpo, /round\(rl\.lat::numeric, 4\)/);
  // La clave viaja siempre, así que su ausencia sólo puede ser servidor viejo.
  assert.match(cuerpo, /'location_quality', v_location_quality/);
});
