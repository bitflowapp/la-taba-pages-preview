// Que ningún reloj externo vigile el proyecto equivocado.
//
// `wrangler.toml` declaraba un solo Worker, apuntando a staging. Desplegarlo era
// la única opción que había, así que el reloj de producción —si alguien lo
// desplegaba— iba a mirar el proyecto de QA e informar «todo bien» mientras el
// barrido de producción estaba muerto.
//
// Un vigía que mira la ventana equivocada es peor que no tener vigía, porque
// ocupa su lugar y nadie busca otro.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const STAGING_REF = 'ukxqbgswjlibmnjemrzd';
const PRODUCTION_REF = 'wwcpogltfgzgkrlilbcd';

const CONFIG = path.join(
  import.meta.dirname, '..', 'services', 'scheduler-watchdog', 'wrangler.toml',
);
const source = fs.readFileSync(CONFIG, 'utf8');

/** El archivo sin comentarios: una ausencia no puede cumplirse con prosa. */
const code = source
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n');

/** Los vars de una sección, por su encabezado exacto. */
function varsOf(header) {
  const start = code.indexOf(`[${header}]`);
  if (start === -1) return null;
  const rest = code.slice(start + header.length + 2);
  const end = rest.search(/^\[/m);
  return end === -1 ? rest : rest.slice(0, end);
}

test('el despojado de comentarios sigue viendo el archivo', () => {
  // Sin esto, un filtro que se come todo haría pasar cada ausencia de abajo.
  assert.match(code, /\[triggers\]/);
  assert.match(code, /crons/);
});

test('hay un entorno de producción declarado', () => {
  assert.match(code, /\[env\.production\]/);
  assert.match(code, /\[env\.production\.vars\]/);
});

test('staging mira staging', () => {
  const vars = varsOf('vars');
  assert.ok(vars, 'no encontré la sección [vars]');
  assert.ok(vars.includes(STAGING_REF), 'staging no apunta al proyecto de staging');
  assert.ok(!vars.includes(PRODUCTION_REF), 'staging apunta a PRODUCCIÓN');
});

test('producción mira producción, y nunca staging', () => {
  const vars = varsOf('env.production.vars');
  assert.ok(vars, 'no encontré la sección [env.production.vars]');
  assert.ok(vars.includes(PRODUCTION_REF), 'producción no apunta al proyecto productivo');
  assert.ok(
    !vars.includes(STAGING_REF),
    'el reloj de producción vigila STAGING: informaría salud mientras producción está muerta',
  );
});

test('los dos Workers tienen nombres distintos', () => {
  // Con el mismo nombre, desplegar uno pisa al otro y queda un solo reloj.
  const nombres = [...code.matchAll(/^name\s*=\s*"([^"]+)"/gm)].map((m) => m[1]);
  assert.equal(nombres.length, 2, `esperaba dos nombres, encontré ${nombres.length}`);
  assert.notEqual(nombres[0], nombres[1]);
});

test('los dos entornos conservan su disparador de cron', () => {
  // Un entorno con nombre NO hereda los triggers del nivel superior: si falta,
  // el Worker se despliega y no corre nunca. Falla en silencio, que es la peor
  // forma de fallar para un vigía.
  assert.match(code, /\[triggers\][\s\S]*?crons/);
  assert.match(code, /\[env\.production\.triggers\][\s\S]*?crons/);
});

test('ninguna clave anónima está versionada acá', () => {
  assert.ok(!/SUPABASE_ANON_KEY\s*=/.test(code), 'hay una clave escrita en el archivo');
  assert.ok(!/eyJ[A-Za-z0-9_-]{8,}\./.test(source), 'hay un JWT en el archivo');
  assert.ok(!/sb_(secret|publishable)_/.test(source), 'hay una clave de Supabase en el archivo');
});
