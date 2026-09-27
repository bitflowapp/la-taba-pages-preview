import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

// La Taba adopta el core fiscal de bitflowapp/taba-fiscal: UN solo motor y UN solo worker.
// Estas pruebas impiden que vuelva una copia del worker, que el manifiesto mienta sobre lo
// adoptado o que las migraciones de adopcion inventen un rol que La Taba no tiene.
const ROOT = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'fiscal-core.json'), 'utf8'));
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const migrationFiles = fs.readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort();
const baselineHead = manifest.baseline_migration_head.slice(0, 14);
const adoptionFiles = [
  ...Object.keys(manifest.adopted_migrations),
  ...manifest.la_taba_extensions.map((extension) => extension.migration),
];

test('el core fiscal adoptado esta fijado a un SHA del repositorio canonico', () => {
  assert.equal(manifest.canonical_source.repository, 'bitflowapp/taba-fiscal');
  assert.match(manifest.canonical_source.sha, /^[0-9a-f]{40}$/);
  assert.equal(manifest.worker.la_taba_copy, 'REMOVED');
});

test('La Taba no mantiene una copia del worker fiscal ni scripts que la construyan', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'services', 'arca-fiscal-bridge')), false);
  const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;
  for (const name of ['fiscal:install', 'fiscal:build', 'fiscal:test']) assert.equal(scripts[name], undefined, name);
  for (const [name, command] of Object.entries(scripts)) assert.doesNotMatch(command, /fiscal:(install|build|test)\b|arca-fiscal-bridge/, name);
});

test('el worker canonico se verifica contra el esquema de La Taba en el SHA fijado', () => {
  const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;
  assert.match(scripts['fiscal:core:verify'], /--experimental-transform-types .*scripts\/fiscal-core\/verify-canonical-worker\.mjs$/);
  assert.match(manifest.worker.verification, /npm run fiscal:core:verify/);
  const harness = fs.readFileSync(path.join(ROOT, 'scripts', 'fiscal-core', 'verify-canonical-worker.mjs'), 'utf8');
  // El SHA sale del manifiesto (no de una copia) y la corrida exige una base local descartable.
  assert.match(harness, /manifest\.canonical_source\.sha/);
  assert.match(harness, /TABA_LOCAL_FISCAL_DB/);
  assert.match(harness, /solo bases locales descartables/);
  for (const scenario of ['E2E', 'RECOVERY_RESPONSE_LOST', 'RECOVERY_CRASH_BEFORE_PERSIST', 'CONCURRENT_WORKERS', 'TENANT_ISOLATION', 'LEGACY_WORKER_CONTRACT']) {
    assert.match(harness, new RegExp(`FISCAL_CORE_(WORKER_)?${scenario}: PASS`), scenario);
  }
});

test('cada migracion de adopcion existe, es posterior a la cabeza y declara su fuente', () => {
  for (const name of adoptionFiles) {
    assert.ok(migrationFiles.includes(name), `${name} no existe`);
    assert.ok(name.slice(0, 14) > baselineHead, `${name} no es posterior a ${baselineHead}`);
  }
  for (const [name, sources] of Object.entries(manifest.adopted_migrations)) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, name), 'utf8');
    assert.match(sql, new RegExp(`bitflowapp/taba-fiscal@${manifest.canonical_source.sha}`), `${name} sin SHA canonico`);
    for (const source of sources) assert.ok(sql.includes(source), `${name} no nombra ${source}`);
  }
});

test('el manifiesto no omite ninguna migracion de adopcion', () => {
  const unlisted = migrationFiles.filter((name) => name.slice(0, 14) > baselineHead && name.includes('_fiscal_core_') && !adoptionFiles.includes(name));
  assert.deepEqual(unlisted, []);
});

test('lo historico no se reaplica: las versiones de base existen y ninguna adopcion las repite', () => {
  for (const version of manifest.baseline_not_reapplied) {
    assert.equal(migrationFiles.filter((name) => name.startsWith(`${version}_`)).length, 1, version);
  }
  for (const { source } of manifest.core_only_not_applied) {
    assert.equal(migrationFiles.filter((name) => name.startsWith(source.slice(0, 15))).length, 0, source);
  }
  const versions = migrationFiles.map((name) => name.slice(0, 14));
  assert.equal(new Set(versions).size, versions.length, 'versiones de migracion repetidas');
});

test('el documento de adopcion describe el mismo SHA, las mismas migraciones y los mismos bloqueos', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'TABA-FISCAL-CORE-ADOPTION.md'), 'utf8');
  assert.ok(doc.includes(manifest.canonical_source.sha), 'SHA del core');
  for (const name of adoptionFiles) assert.ok(doc.includes(name.replace(/\.sql$/, '')), name);
  for (const status of ['PRODUCTION_READY | **NO**', 'ONLINE_ORDER | **BLOCKED_PENDING_ACCOUNTING_POLICY**', 'PHYSICAL_PRINT | **NOT_VERIFIED**']) {
    assert.ok(doc.includes(status), status);
  }
  assert.doesNotMatch(doc, /OVERLOAD|REVIEW \(/, 'la matriz RPC no tiene sobrecargas ni filas sin clasificar');
});

test("las migraciones de adopcion no introducen el rol 'viewer' que La Taba no tiene", () => {
  for (const name of adoptionFiles) {
    const code = fs.readFileSync(path.join(MIGRATIONS, name), 'utf8').split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n');
    assert.doesNotMatch(code, /'viewer'/, name);
  }
});
