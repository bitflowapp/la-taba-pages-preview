import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('static recovery shell is loaded before the application module', () => {
  const index = read('index.html');
  assert.match(index, /data-app-recovery/);
  assert.match(index, /startup-recovery\.js\?v=3/);
  // El orden es el contrato; el número de versión de `app.js` no. Fijarlo acá
  // convertía cada bump de caché —que el gate de identidad de release ya
  // vigila— en una prueba roja que no dice nada sobre el arranque.
  assert.match(index, /startup-recovery\.js\?v=3[\s\S]*app\.js\?v=\d+/);
  // El panel nace OCULTO en el shell servido. Si vuelve a nacer visible, la
  // primera pantalla de una carga lenta es otra vez un cartel de error.
  assert.match(index, /<section class="card app-recovery"[^>]*\shidden>/);
  // El código interno viaja en el atributo, no en el texto que se pinta.
  assert.match(index, /data-app-recovery-code="TABA2-BOOT-01"/);
  assert.doesNotMatch(index, /<small data-app-recovery-code>/);
});

test('bootstrap renders before sandbox synchronization and resets after that first paint', () => {
  const app = read('js/app.js');
  assert.match(app, /renderAll\(\);[\s\S]*?TABA_STARTUP_RECOVERY\?\.hide\(\);[\s\S]*?startOrderRepositorySync\(\)/);
  assert.match(app, /if \(resetRequested\)[\s\S]*?maybeResetDemoSession\(\)/);
});

test('sandbox storage has a bounded IndexedDB open and a memory fallback', () => {
  const repository = read('js/repositories/sandbox_order_repository.js');
  assert.match(repository, /INDEXED_DB_OPEN_TIMEOUT_MS/);
  assert.match(repository, /database = null;[\s\S]*?writeToDatabase\(null/);
  assert.match(repository, /resetSandbox\(\)[\s\S]*?catch \(_\)/);
});

test('production mode never selects the sandbox repository', () => {
  const factory = read('js/repositories/repository_factory.js');
  assert.match(factory, /if \(mode === 'demo'\)[\s\S]*?createSandboxOrderRepository/);
  assert.match(factory, /if \(mode === 'supabase'\)/);
  assert.match(factory, /createUnavailableOrderRepository/);
});

test('el motor del mapa no retiene el arranque y su falla no es una falla del arranque', () => {
  const index = read('index.html');
  const etiqueta = index.match(/<script[^>]*maplibre-gl\.js[^>]*>/)?.[0];
  assert.ok(etiqueta, 'no se encontró el script del motor del mapa');
  // `defer` comparte UNA cola ordenada con el módulo `app.js`: con él, la tienda
  // no ejecutaba una línea hasta que unpkg entregaba el mapa (16 s con el CDN
  // colgado 15 s, medido).
  assert.doesNotMatch(etiqueta, /\sdefer\b/);
  assert.match(etiqueta, /\sasync\b/);
  assert.match(etiqueta, /\sdata-boot-optional\b/);
  assert.match(etiqueta, /onload="window\.dispatchEvent\(new Event\('taba:maplibre-ready'\)\)"/);
  // La cadena de suministro no se negocia.
  assert.match(etiqueta, /integrity="sha384-/);
  assert.match(etiqueta, /crossorigin="anonymous"/);
  // Y un mapa pintado antes que el motor se rearma cuando el motor llega.
  assert.match(read('js/map/map_view.js'), /addEventListener\?\.\('taba:maplibre-ready', \(\) => remountMapsWaitingForEngine\(\)\)/);
});

/*
 * El script se ejecuta de verdad, con un DOM mínimo: lo que se prueba es la
 * escucha en fase de captura, no un texto del archivo.
 */
function arrancarRecuperacion() {
  const escuchas = {};
  const panel = { hidden: true, dataset: {}, querySelector: () => null, closest: () => null };
  const document = {
    querySelector: (selector) => (selector === '[data-app-recovery]' ? panel : null),
    documentElement: { dataset: {} },
  };
  const window = { location: { search: '' }, addEventListener: (tipo, fn) => { escuchas[tipo] = fn; } };
  vm.runInNewContext(read('js/startup-recovery.js'), {
    window, document, URLSearchParams, console: { warn() {} }, setTimeout: () => 0, clearTimeout() {},
  });
  return { panel, fallaDeCarga: (target) => escuchas.error({ target }) };
}

test('la falla de un script opcional no muestra el panel; la de uno del arranque, sí', () => {
  const opcional = { tagName: 'SCRIPT', hasAttribute: (nombre) => nombre === 'data-boot-optional' };
  const delArranque = { tagName: 'SCRIPT', hasAttribute: () => false };

  const conMapa = arrancarRecuperacion();
  conMapa.fallaDeCarga(opcional);
  assert.equal(conMapa.panel.hidden, true, 'unpkg caído mostraba «Puede ser tu conexión» sobre una tienda sana');

  const sinModulo = arrancarRecuperacion();
  sinModulo.fallaDeCarga(delArranque);
  assert.equal(sinModulo.panel.hidden, false, 'un módulo del arranque que no baja tiene que seguir dando salida');
  assert.equal(sinModulo.panel.dataset.appRecoveryCode, 'TABA2-BOOT-01');
});
