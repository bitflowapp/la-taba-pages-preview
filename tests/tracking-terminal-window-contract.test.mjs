// El pedido entregado se sigue viendo, y la próxima reescritura de la función
// no puede volver a borrarlo en silencio (F25).
//
// POR QUÉ EXISTE ESTE ARCHIVO, Y NO ALCANZABA CON EL QUE YA HABÍA
// --------------------------------------------------------------
// `tests/tracking-terminal-visibility.test.mjs` afirma sobre un ARCHIVO FIJO:
// `20260729203000_public_tracking_terminal_visibility.sql`. Ese archivo sigue
// conteniendo `terminal_visible_until` y siempre lo va a contener, porque las
// migraciones no se editan. Así que el test quedó en verde para siempre
// mientras DOS `create or replace` posteriores —20260802100000 y
// 20260811020000— reescribían la función entera sin esa clave.
//
// O sea: el gate no medía la función vigente, medía un archivo histórico. Por
// eso este archivo no nombra ninguna migración: concatena todas en orden y
// afirma sobre la ÚLTIMA definición, que es la que realmente corre.
//
// LO QUE SE PERDÍA: el cliente lee la ausencia de esa clave como acceso
// revocado —`markTrackingUnavailable`—, así que en el momento exacto de la
// entrega se le borraba la pantalla, se le borraba el token de sessionStorage y
// no volvía ni recargando, porque la recuperación descarta pedidos terminales.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migraciones = path.join(root, 'supabase', 'migrations');

/**
 * La última definición de una función, recorriendo las migraciones en el mismo
 * orden en que las aplica Supabase. Es la única forma honesta de preguntar
 * «¿qué corre hoy?» leyendo el árbol.
 */
function definicionVigente(nombre) {
  const archivos = fs.readdirSync(migraciones).filter((f) => f.endsWith('.sql')).sort();
  let ultima = null;
  for (const archivo of archivos) {
    const sql = fs.readFileSync(path.join(migraciones, archivo), 'utf8');
    const marca = new RegExp(`create or replace function public\\.${nombre}\\(`, 'i');
    if (!marca.test(sql)) continue;
    const desde = sql.search(marca);
    ultima = { archivo, cuerpo: sql.slice(desde) };
  }
  assert.ok(ultima, `no hay ninguna definición de ${nombre}`);
  return ultima;
}

test('la definición vigente del seguimiento público emite terminal_visible_until', () => {
  const { archivo, cuerpo } = definicionVigente('get_public_order_tracking');
  assert.match(
    cuerpo,
    /'terminal_visible_until',\s*case\s*\n\s*when v_order\.status in \('delivered', 'canceled', 'cancelled', 'rejected'\)/,
    `la última definición (${archivo}) dejó de emitir terminal_visible_until: `
    + 'el cliente lo lee como acceso revocado y le borra el seguimiento al entregar',
  );
});

test('la ventana terminal ACOTA el acceso, no sólo informa', () => {
  // Emitir la clave sin filtrar por ella dejaría el pedido entregado visible
  // para siempre. Las dos mitades tienen que estar.
  const { cuerpo } = definicionVigente('get_public_order_tracking');
  assert.match(
    cuerpo,
    /o\.status not in \('delivered', 'canceled', 'cancelled', 'rejected'\)\s*\n\s*or \(opt\.terminal_visible_until is not null and opt\.terminal_visible_until > clock_timestamp\(\)\)/,
  );
});

test('la corrección conserva lo que arregló la definición anterior', () => {
  // No se revirtió a la versión vieja: `captured_at`, las 4 decimales y el
  // orden por captura son las correcciones del 11/08, las que evitaron que el
  // marcador del rider caminara hacia atrás. Perderlas sería cambiar un defecto
  // por otro.
  const { cuerpo } = definicionVigente('get_public_order_tracking');
  assert.match(cuerpo, /'captured_at', coalesce\(rl\.captured_at, rl\.created_at\)/);
  assert.match(cuerpo, /round\(rl\.lat::numeric, 4\)/);
  assert.match(cuerpo, /order by coalesce\(rl\.captured_at, rl\.created_at\) desc, rl\.receipt_sequence desc/);
  // Y la compuerta del rider sigue: sin rider asignado no hay ubicación.
  assert.match(cuerpo, /v_order\.assigned_rider_user_id is not null/);
});

test('el cliente degrada en vez de borrar si la clave volviera a faltar', () => {
  // La red de seguridad: aunque la migración no esté aplicada, la ausencia de
  // la clave ya no destruye el acceso. `onUnavailable` queda reservado para lo
  // que significa —token revocado o vencido—.
  const poll = fs.readFileSync(path.join(root, 'js', 'tracking', 'customer_tracking_poll.js'), 'utf8');
  const desde = poll.indexOf('function startTerminalVisibility');
  assert.notEqual(desde, -1, 'no se encontró startTerminalVisibility');
  const sinVentana = poll.slice(desde).match(/if \(!terminalVisibleUntil\) \{([\s\S]*?)\n    \}/);
  assert.ok(sinVentana, 'no se encontró la rama sin ventana terminal');
  // Sin los comentarios: la rama EXPLICA por qué ya no llama a `onUnavailable`,
  // así que la palabra aparece ahí a propósito. Lo que importa es el código.
  const codigo = sinVentana[1]
    .split('\n')
    .filter((linea) => !linea.trim().startsWith('//'))
    .join('\n');
  assert.doesNotMatch(
    codigo,
    /onUnavailable/,
    'que falte la ventana no es un token revocado: no puede borrar el seguimiento',
  );
  assert.match(codigo, /stop\(\);/);
});

test('onUnavailable sigue existiendo para lo que sí lo merece', () => {
  // El arreglo no es apagar la señal: un token de verdad revocado o vencido
  // tiene que seguir borrando el acceso.
  const poll = fs.readFileSync(path.join(root, 'js', 'tracking', 'customer_tracking_poll.js'), 'utf8');
  assert.match(poll, /kind === 'unavailable'|'unavailable'/);
  assert.match(poll, /onUnavailable\(/);
});
