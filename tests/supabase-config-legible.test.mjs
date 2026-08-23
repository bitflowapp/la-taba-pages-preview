import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const GUARDIA = path.join(root, 'scripts/check-supabase-config.mjs');
const CONFIG = path.join(root, 'supabase/config.toml');

/*
 * EL CONFIG DE SUPABASE TIENE QUE PODER LEERLO EL CLI QUE FIJAMOS.
 *
 * No es una preferencia de estilo: si no parsea, `supabase start` no arranca y
 * el job de migraciones y pgTAP se cae entero antes de correr una sola de sus
 * 162 aserciones. Como el archivo vive en `main`, se cae en todas las ramas a
 * la vez y ningún PR puede llegar a verde.
 *
 * El guion no necesita Docker ni red, así que esto se puede afirmar acá.
 */

/** Corre la guardia sobre un config dado. Devuelve código de salida y salida. */
function correrGuardia(contenido) {
  const original = fs.readFileSync(CONFIG, 'utf8');
  const temporal = contenido !== undefined;
  if (temporal) fs.writeFileSync(CONFIG, contenido, 'utf8');
  try {
    const salida = execFileSync(process.execPath, [GUARDIA], { encoding: 'utf8', stdio: 'pipe' });
    return { codigo: 0, salida };
  } catch (error) {
    return { codigo: error.status ?? 1, salida: `${error.stdout || ''}${error.stderr || ''}` };
  } finally {
    if (temporal) fs.writeFileSync(CONFIG, original, 'utf8');
  }
}

test('el config que está en el repositorio lo puede leer el CLI fijado', () => {
  const { codigo, salida } = correrGuardia();
  assert.equal(codigo, 0, `la guardia rechazó el config real:\n${salida}`);
  assert.match(salida, /legible por el CLI/);
});

test('la sección de mail se llama como la nombra el CLI fijado, no como la nombra una versión nueva', () => {
  /*
   * El defecto exacto del 2026-08-22. `[local_smtp]` es el mismo bloque que
   * `[inbucket]` —mismos campos, mismo comentario— con otro encabezado, y el
   * CLI fijado no lo conoce.
   */
  const config = fs.readFileSync(CONFIG, 'utf8');
  assert.match(config, /^\[inbucket\]$/m, 'el servidor de correo local tiene que declararse como [inbucket]');
  assert.doesNotMatch(config, /^\[local_smtp\]$/m);

  const roto = config.replace(/^\[inbucket\]$/m, '[local_smtp]');
  const { codigo, salida } = correrGuardia(roto);
  assert.equal(codigo, 1, 'la guardia dejó pasar el nombre que rompe el parseo');
  assert.match(salida, /local_smtp/);
  assert.match(salida, /inbucket/, 'el error tiene que decir qué nombre poner, no sólo cuál está mal');
});

test('un espacio de sección inventado no pasa, y el error dice dónde', () => {
  const config = fs.readFileSync(CONFIG, 'utf8');
  const { codigo, salida } = correrGuardia(`${config}\n[telemetria_inventada]\nenabled = true\n`);
  assert.equal(codigo, 1);
  assert.match(salida, /telemetria_inventada/);
  assert.match(salida, /Línea \d+/, 'sin número de línea, encontrarlo en un config de 440 líneas es a ojo');
});

test('una sección repetida no pasa: en TOML es un error de sintaxis', () => {
  const config = fs.readFileSync(CONFIG, 'utf8');
  const { codigo, salida } = correrGuardia(`${config}\n[inbucket]\nenabled = false\n`);
  assert.equal(codigo, 1);
  assert.match(salida, /ya estaba declarada/);
});

test('las subsecciones anidadas siguen valiendo: se mira el espacio, no el camino entero', () => {
  // `[auth.email.template.invite]` y `[functions.mercadopago-webhook]` son
  // nuestras y son válidas. Una guardia que las rechazara sería peor que el
  // defecto que repara.
  const config = fs.readFileSync(CONFIG, 'utf8');
  assert.match(config, /^\[auth\.email\.template\.[a-z_]+\]$/m);
  assert.match(config, /^\[functions\.[a-z0-9-]+\]$/m);
  assert.equal(correrGuardia().codigo, 0);
});

test('si alguien mueve el CLI fijado sin rederivar el vocabulario, la guardia lo dice', () => {
  /*
   * Un vocabulario que no sabe de qué versión habla no comprueba nada. La
   * guardia lee `SUPABASE_CLI_VERSION` del workflow y la compara con la versión
   * de la que se derivó su lista.
   */
  const workflow = path.join(root, '.github/workflows/ci.yml');
  const original = fs.readFileSync(workflow, 'utf8');
  const fijada = original.match(/SUPABASE_CLI_VERSION:\s*'?([\d.]+)'?/);
  assert.ok(fijada, 'el workflow tiene que fijar una versión de CLI');

  const guardia = fs.readFileSync(GUARDIA, 'utf8');
  const derivada = guardia.match(/CLI_DERIVADO_DE\s*=\s*'([\d.]+)'/);
  assert.ok(derivada, 'la guardia tiene que declarar de qué versión derivó su vocabulario');
  assert.equal(derivada[1], fijada[1], 'el vocabulario y el CLI fijado hablan de versiones distintas');

  const movido = original.replace(/SUPABASE_CLI_VERSION:\s*'?[\d.]+'?/, "SUPABASE_CLI_VERSION: '9.9.9'");
  fs.writeFileSync(workflow, movido, 'utf8');
  try {
    const { codigo, salida } = correrGuardia();
    assert.equal(codigo, 1, 'mover el CLI sin rederivar el vocabulario tiene que fallar');
    assert.match(salida, /9\.9\.9/);
    assert.match(salida, /rederivarlo|derivar/i);
  } finally {
    fs.writeFileSync(workflow, original, 'utf8');
  }
});

test('el paso de CI que fija el CLI es el mismo que este guion lee', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  assert.match(workflow, /supabase start/, 'si CI dejó de correr `supabase start`, esta guardia sobra');
  assert.match(workflow, /npm run check/, 'la guardia vive en `npm run check`: CI tiene que correrlo');
});
