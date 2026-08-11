import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('static recovery shell is loaded before the application module', () => {
  const index = read('index.html');
  assert.match(index, /data-app-recovery/);
  assert.match(index, /startup-recovery\.js\?v=2/);
  assert.match(index, /startup-recovery\.js\?v=2[\s\S]*app\.js\?v=41/);
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
