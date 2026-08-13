// El día comercial lo define el negocio, no el aparato que abre el Panel (F32).
//
// EL DEFECTO
// ----------
// El cierre de caja es el único registro de día que este sistema congela para
// siempre: `close_daily_reconciliation` firma la ventana en un SHA-256 y un
// trigger de inmutabilidad más `unique (business_id, business_date)` impiden
// corregirla, borrarla o reemplazarla. Esa ventana se calculaba con la zona que
// mandaba el navegador (`Intl.DateTimeFormat().resolvedOptions().timeZone`).
//
// Un teléfono en UTC corría el día tres horas: la noche entera del día anterior
// —el horario pico de una bebida— quedaba fuera de su propio cierre, aparecía
// una diferencia de caja fantasma, y el operador quedaba obligado a escribir
// una explicación falsa que también se firmaba.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const leer = (...partes) => fs.readFileSync(path.join(root, ...partes), 'utf8');

function cuerpoDeLaUltimaDefinicion(nombre) {
  const dir = path.join(root, 'supabase', 'migrations');
  const todo = fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()
    .map((n) => leer('supabase', 'migrations', n))
    .join('\n');
  // Se ancla al CREATE y no a cualquier mención: un `comment on function` al
  // final del archivo también contiene el nombre y dejaría el cuerpo afuera.
  const indice = todo.toLowerCase().lastIndexOf(`create or replace function public.${nombre}`);
  assert.notEqual(indice, -1, `no se encontró la definición de ${nombre}`);
  return todo.slice(indice);
}

test('el Panel ya no deriva el día comercial del reloj del navegador', () => {
  const centro = leer('js', 'business', 'business-operations-center.js');
  const desde = centro.indexOf('function operationTimezone');
  assert.notEqual(desde, -1, 'no se encontró operationTimezone');
  const cuerpo = centro.slice(desde, centro.indexOf('function operationBusinessDate'));
  const codigo = cuerpo.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
  assert.doesNotMatch(codigo, /resolvedOptions\(\)/,
    'la zona del cierre volvió a salir del navegador');
  assert.match(codigo, /PANEL_TIMEZONE/,
    'debe reusar la zona que el Panel ya declara, no una copia nueva');
});

test('la zona del Panel es una sola constante, compartida', () => {
  const render = leer('js', 'business', 'business-panel-render.js');
  assert.match(render, /export const PANEL_TIMEZONE = 'America\/Argentina\/Buenos_Aires'/);
  const centro = leer('js', 'business', 'business-operations-center.js');
  assert.match(centro, /import \{[\s\S]*?PANEL_TIMEZONE[\s\S]*?\} from '\.\/business-panel-render\.js'/);
});

test('la ventana del cierre sale del negocio y no del parámetro del cliente', () => {
  const cuerpo = cuerpoDeLaUltimaDefinicion('prepare_daily_reconciliation');
  // El huso se lee de la fila del negocio...
  assert.match(cuerpo, /b\.operating_timezone/);
  // ...y es ése el que recorta el día.
  assert.match(cuerpo, /v_start := p_business_date::timestamp at time zone v_timezone/);
  assert.match(cuerpo, /v_end := \(p_business_date \+ 1\)::timestamp at time zone v_timezone/);
  // El parámetro del cliente ya no decide nada.
  assert.doesNotMatch(cuerpo, /at time zone p_timezone/);
});

test('sin huso configurado el cierre no se prepara: falla cerrado', () => {
  const cuerpo = cuerpoDeLaUltimaDefinicion('prepare_daily_reconciliation');
  assert.match(cuerpo, /el negocio no tiene huso horario configurado/);
  // Y la fila guarda el huso realmente usado, no el que llegó del cliente.
  assert.match(cuerpo, /p_business_date,v_timezone,'open'/);
});

test('los husos se validan contra el catálogo de PostgreSQL, no contra una lista a mano', () => {
  const cuerpo = cuerpoDeLaUltimaDefinicion('businesses_validate_timezones');
  assert.match(cuerpo, /pg_catalog\.pg_timezone_names/);
  assert.match(cuerpo, /operating_timezone invalida/);
  assert.match(cuerpo, /alcohol_timezone invalida/);
});
