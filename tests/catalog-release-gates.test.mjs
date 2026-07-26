import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('release catalog gate fails closed without an explicitly supplied real catalog', () => {
  const result = spawnSync(process.execPath, ['scripts/validate-release-catalog.mjs'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    env: { ...process.env, TABA_CATALOG_FILE: '' },
  });
  assert.equal(result.status, 1);
  assert.match(`${result.stdout}${result.stderr}`, /Falta el catálogo real/);
});

test('header-only template never satisfies the commercial release gate', () => {
  const result = spawnSync(process.execPath, [
    'scripts/validate-release-catalog.mjs',
    'data/catalog-template.csv',
  ], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });
  assert.equal(result.status, 1);
  assert.match(`${result.stdout}${result.stderr}`, /no contiene productos|no contiene imágenes/i);
});

test('staging gate cannot report success without runtime and real catalog', () => {
  const result = spawnSync(process.execPath, ['scripts/validate-staging-readiness.mjs'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    env: { ...process.env, TABA_CATALOG_FILE: '' },
  });
  assert.equal(result.status, 1);
  assert.match(`${result.stdout}${result.stderr}`, /runtime de staging real/);
  assert.match(`${result.stdout}${result.stderr}`, /catálogo e imágenes comerciales reales/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /PREPARADO, NO EJECUTADO/);
});

test('release folder is guarded by technical, migration and commercial catalog checks', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(packageJson.scripts.verify, /verify:technical/);
  assert.match(packageJson.scripts.verify, /migrations:validate/);
  assert.match(packageJson.scripts.verify, /catalog:release:validate/);
  assert.match(packageJson.scripts['release:folder'], /npm run verify/);
});
