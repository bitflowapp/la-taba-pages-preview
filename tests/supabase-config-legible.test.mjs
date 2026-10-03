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

/*
 * Corre la guardia sobre un config (y un workflow) dados. Devuelve código de
 * salida y salida. Lo que cambia va a COPIAS en `test-results/` (en
 * .gitignore): escribir sobre los archivos del repositorio y restaurarlos en un
 * `finally` dejaba el árbol modificado si la prueba se cortaba a mitad (TOOL-05).
 */
function correrGuardia(contenido, { workflow } = {}) {
  const base = path.join(root, 'test-results');
  fs.mkdirSync(base, { recursive: true });
  const copias = fs.mkdtempSync(path.join(base, 'guardia-supabase-'));
  const argumentos = [GUARDIA];
  if (contenido !== undefined) {
    const copia = path.join(copias, 'config.toml');
    fs.writeFileSync(copia, contenido, 'utf8');
    argumentos.push('--config', copia);
  }
  if (workflow !== undefined) {
    const copia = path.join(copias, 'ci.yml');
    fs.writeFileSync(copia, workflow, 'utf8');
    argumentos.push('--workflow', copia);
  }
  try {
    const salida = execFileSync(process.execPath, argumentos, { encoding: 'utf8', stdio: 'pipe' });
    return { codigo: 0, salida };
  } catch (error) {
    return { codigo: error.status ?? 1, salida: `${error.stdout || ''}${error.stderr || ''}` };
  } finally {
    fs.rmSync(copias, { recursive: true, force: true });
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
  // TOOL-05: la prueba trabaja sobre copias. Escribir y restaurar en un `finally` deja el mismo contenido pero
  // cambia la fecha de modificación: por eso se mira la fecha, no sólo el texto.
  const antes = [workflow, CONFIG].map((archivo) => [fs.readFileSync(archivo, 'utf8'), fs.statSync(archivo).mtimeMs]);
  const { codigo, salida } = correrGuardia(undefined, { workflow: movido });
  assert.equal(codigo, 1, 'mover el CLI sin rederivar el vocabulario tiene que fallar');
  assert.match(salida, /9\.9\.9/);
  assert.match(salida, /rederivarlo|derivar/i);
  const despues = [workflow, CONFIG].map((archivo) => [fs.readFileSync(archivo, 'utf8'), fs.statSync(archivo).mtimeMs]);
  assert.deepEqual(despues, antes, 'ni el workflow ni el config del repositorio se reescriben, ni siquiera un instante');
});

test('la guardia lee las rutas que se le dan y rechaza una opción sin ruta', () => {
  const roto = `${fs.readFileSync(CONFIG, 'utf8')}\n[telemetria_inventada]\nenabled = true\n`;
  const conCopia = correrGuardia(roto);
  assert.equal(conCopia.codigo, 1, 'la copia rota tiene que fallar aunque el config del repositorio esté bien');
  assert.equal(correrGuardia().codigo, 0, 'sin opciones, la guardia lee el config del repositorio');
  let sinRuta;
  try {
    execFileSync(process.execPath, [GUARDIA, '--config'], { encoding: 'utf8', stdio: 'pipe' });
    sinRuta = { codigo: 0 };
  } catch (error) {
    sinRuta = { codigo: error.status, salida: `${error.stdout || ''}${error.stderr || ''}` };
  }
  assert.equal(sinRuta.codigo, 2);
  assert.match(sinRuta.salida, /--config necesita una ruta/);
});

test('el paso de CI que fija el CLI es el mismo que este guion lee', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  assert.match(workflow, /npm run test:release:platform/, 'CI ejercita además el protocolo del CLI real');
  assert.match(workflow, /npm run check/, 'la guardia vive en `npm run check`: CI tiene que correrlo');
});
