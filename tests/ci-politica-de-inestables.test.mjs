import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { decidir, nombreCompleto } from '../tests/e2e-infra/reporter-inestables.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/*
 * LA POLÍTICA DE REINTENTOS, Y EL AGUJERO QUE NO PUEDE ABRIR.
 *
 * Reintentar recupera señal: tres corridas de `main` murieron por el gate de
 * navegador sin que hubiera una regresión, y dos de ellas sobre un árbol de
 * hash IDÉNTICO a otro que había pasado 462/462.
 *
 * Pero reintentar sin más convierte «verde» en dos cosas distintas: la corrida
 * limpia y la que necesitó una segunda oportunidad. Estas pruebas fijan que se
 * puedan distinguir, y que un reintento no pueda tapar una regresión.
 */

test('en local no se reintenta: la carrera se ve la primera vez', () => {
  const config = fs.readFileSync(path.join(root, 'playwright.config.mjs'), 'utf8');
  assert.match(config, /retries:\s*process\.env\.CI\s*\?\s*1\s*:\s*0/);

  // Y comprobado de verdad, resolviendo la configuración con y sin CI.
  const leer = (entorno) => Number(execFileSync(process.execPath, [
    '-e',
    "import('./playwright.config.mjs').then((m) => process.stdout.write(String(m.default.retries)))",
  ], { cwd: root, encoding: 'utf8', env: { ...process.env, ...entorno } }));

  assert.equal(leer({ CI: '' }), 0, 'en local, 0');
  assert.equal(leer({ CI: 'true' }), 1, 'en CI, 1');
});

test('el reporter de inestables está declarado en la configuración', () => {
  const config = fs.readFileSync(path.join(root, 'playwright.config.mjs'), 'utf8');
  assert.match(config, /reporter-inestables\.mjs/);
});

test('corrida limpia: verde, y verde quiere decir verde', () => {
  const { estado, lineas } = decidir({ inestables: [], estado: 'passed' });
  assert.equal(estado, 'passed');
  assert.match(lineas.join('\n'), /ninguna prueba necesitó reintento/);
});

test('una inestable aislada: verde CON AVISO, y con nombre y error', () => {
  const { estado, lineas } = decidir({
    inestables: [{ nombre: '[mobile-webkit] catalog-card-glow › rail', error: 'WebKit encountered an internal error' }],
    estado: 'passed',
  });
  assert.equal(estado, 'passed');
  const salida = lineas.join('\n');
  assert.match(salida, /::warning::PRUEBA INESTABLE/);
  assert.match(salida, /catalog-card-glow/, 'sin el nombre, el aviso no sirve para investigar');
  assert.match(salida, /WebKit encountered an internal error/);
  assert.match(salida, /NO es un verde limpio/);
});

test('demasiadas inestables: la corrida es ROJA, no «verde con aviso»', () => {
  /*
   * El punto donde la tolerancia dejaría de ser tolerancia. Una corrida con
   * media suite recuperándose por reintento no está sana, y llamarla verde es
   * el mismo silencio que esta política existe para romper.
   */
  const muchas = Array.from({ length: 4 }, (_, i) => ({ nombre: `prueba ${i}`, error: 'x' }));
  const { estado, lineas } = decidir({ inestables: muchas, estado: 'passed', umbral: 3 });
  assert.equal(estado, 'failed');
  assert.match(lineas.join('\n'), /::error::4 inestables supera el umbral de 3/);
});

test('una prueba rota de verdad sigue roja: el reintento no la salva', () => {
  // Playwright ya la marcó `failed` porque falló las DOS veces. El reporter no
  // puede pisar ese estado, ni siquiera si no hubo ninguna inestable.
  for (const inestables of [[], [{ nombre: 'a', error: 'x' }]]) {
    const { estado } = decidir({ inestables, estado: 'failed' });
    assert.equal(estado, 'failed', 'una corrida roja se queda roja');
  }
});

test('el nombre incluye el proyecto: la misma prueba en dos motores no se confunde', () => {
  const falso = {
    titlePath: () => ['', 'tests/e2e/catalog-card-glow.spec.mjs', 'HOME · el rail'],
    parent: { project: () => ({ name: 'mobile-webkit' }) },
  };
  assert.equal(
    nombreCompleto(falso),
    '[mobile-webkit] tests/e2e/catalog-card-glow.spec.mjs › HOME · el rail',
  );
});

test('el informe queda en disco para poder contar entre corridas', async () => {
  const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'taba-flaky-'));
  try {
    const salida = path.join(temporal, 'e2e-flaky.json');
    const { default: Reporter } = await import('../tests/e2e-infra/reporter-inestables.mjs');
    const reporter = new Reporter({ salida, umbral: 3 });
    reporter.inestables = [{ nombre: 'una', error: 'timeout' }];
    const veredicto = await reporter.onEnd({ status: 'passed' });

    assert.equal(veredicto.status, 'passed');
    const escrito = JSON.parse(fs.readFileSync(salida, 'utf8'));
    assert.equal(escrito.total, 1);
    assert.equal(escrito.umbral, 3);
    assert.deepEqual(escrito.pruebas, [{ nombre: 'una', error: 'timeout' }]);
  } finally {
    fs.rmSync(temporal, { force: true, recursive: true });
  }
});

test('CI graba la traza del reintento y sube el censo de inestables', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  assert.match(workflow, /--trace=on-first-retry/, 'la traza que importa es la del intento que se recupera');
  assert.doesNotMatch(workflow, /--trace=retain-on-failure/);
  // Nombrar reporters en la línea de comandos REEMPLAZA los del config: si el
  // de inestables no viaja acá, la política queda sin quien la aplique.
  assert.match(workflow, /reporter=line,html,\.\/tests\/e2e-infra\/reporter-inestables\.mjs/);
  assert.match(workflow, /e2e-flaky-\$\{\{ github\.run_id \}\}/, 'el censo se sube como artefacto');
});

test('las aserciones del gate siguen intactas: no se saltea ni se marca nada', () => {
  /*
   * El modo de falla que esta política NO puede tener: que alguien «estabilice»
   * el gate marcando pruebas como `fixme`/`skip` en vez de repararlas.
   */
  const specs = fs.readdirSync(path.join(root, 'tests/e2e')).filter((n) => n.endsWith('.spec.mjs'));
  const marcadas = [];
  for (const nombre of specs) {
    const fuente = fs.readFileSync(path.join(root, 'tests/e2e', nombre), 'utf8');
    if (/\btest\.(skip|fixme|fail)\s*\(\s*['"`]/.test(fuente)) marcadas.push(nombre);
  }
  assert.deepEqual(marcadas, [], 'una prueba apagada no es una prueba estable');
});
