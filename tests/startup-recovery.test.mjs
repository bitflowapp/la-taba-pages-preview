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
  assert.match(index, /startup-recovery\.js\?v=1/);
  assert.match(index, /startup-recovery\.js\?v=1[\s\S]*app\.js\?v=36/);
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
