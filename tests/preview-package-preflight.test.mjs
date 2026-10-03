import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  EXPECTED,
  PERMITTED_VERSIONS,
  validatePreviewPackage,
} from '../scripts/preflight-staging-package.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const validRuntime = path.join(root, 'tests', 'fixtures', 'runtime-config-valido.js');
const releaseEntries = [
  'index.html',
  'styles.css',
  'styles',
  'manifest.webmanifest',
  'runtime-config.js',
  'sw.js',
  '.nojekyll',
  'assets',
  'js',
  'pago',
];
const temporaryPackages = [];

afterEach(() => {
  while (temporaryPackages.length) {
    fs.rmSync(temporaryPackages.pop(), { recursive: true, force: true });
  }
});

function packageFromCandidate() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'taba2-preview-preflight-'));
  temporaryPackages.push(directory);
  for (const entry of releaseEntries) {
    fs.cpSync(path.join(root, entry), path.join(directory, entry), { recursive: true });
  }
  fs.copyFileSync(validRuntime, path.join(directory, 'runtime-config.js'));
  return directory;
}

function mutateRuntime(directory, replacement) {
  fs.writeFileSync(
    path.join(directory, 'runtime-config.js'),
    fs.readFileSync(validRuntime, 'utf8').replace(
      'deploymentEnvironment: \'staging\'',
      replacement,
    ),
    'utf8',
  );
}

async function preflight(directory, live = validRuntime) {
  return validatePreviewPackage({ dir: directory, vivo: live, root });
}

test('candidate v42 + runtime staging válido pasa el preflight y separa hashes', async () => {
  const directory = packageFromCandidate();
  const result = await preflight(directory);

  assert.equal(result.ok, true, result.errors.join(' | '));
  assert.ok(result.report);
  assert.equal(result.report.sourceHead, '317bbe9dc1c987c31ea4e0915784f881f61f24b6');
  assert.equal(result.report.codeReleaseIdentity.digest.length, 64);
  assert.equal(result.report.runtime.environment, 'staging');
  assert.equal(result.report.runtime.supabaseRef, EXPECTED.supabaseRef);
  assert.equal(result.report.deploymentId, null);
  assert.notEqual(
    result.report.codeReleaseIdentity.digest,
    result.report.runtime.sha256,
    'código y runtime tienen identidades independientes',
  );
});

test('el contrato activo usa v42 y jamás vuelve a admitir la lista stale v41', () => {
  assert.equal(EXPECTED.app, '?v=42');
  assert.ok(PERMITTED_VERSIONS.has('42'));
  assert.ok(!PERMITTED_VERSIONS.has('41'));
});

test('un asset de código cambia y el digest firmado lo rechaza', async () => {
  const directory = packageFromCandidate();
  fs.appendFileSync(path.join(directory, 'js', 'app.js'), '\n// mutation outside the release\n');

  const result = await preflight(directory);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /digest firmado/.test(error)));
});

test('cambiar sólo runtime mantiene código pero rechaza el runtime no aprobado', async () => {
  const directory = packageFromCandidate();
  const altered = fs.readFileSync(validRuntime, 'utf8').replace('pollMs: 60000', 'pollMs: 5000');
  fs.writeFileSync(path.join(directory, 'runtime-config.js'), altered, 'utf8');

  const result = await preflight(directory);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /runtime-config\.js NO es el vivo/.test(error)));
});

test('runtime-config ausente falla cerrado', async () => {
  const directory = packageFromCandidate();
  fs.rmSync(path.join(directory, 'runtime-config.js'));

  const result = await preflight(directory);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /runtime del paquete: archivo ausente/.test(error)));
});

test('runtime-config malformed falla cerrado', async () => {
  const directory = packageFromCandidate();
  fs.writeFileSync(path.join(directory, 'runtime-config.js'), 'this is not valid javascript', 'utf8');

  const result = await preflight(directory);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /sintaxis\/configuración inválida/.test(error)));
});

test('runtime production es rechazado aunque config:check lo considere formalmente válido', async () => {
  const directory = packageFromCandidate();
  mutateRuntime(directory, "deploymentEnvironment: 'production'");

  const result = await preflight(directory, path.join(directory, 'runtime-config.js'));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /environment debe ser staging/.test(error)));
});

test('runtime con Supabase ref incorrecta es rechazado', async () => {
  const directory = packageFromCandidate();
  const source = fs.readFileSync(validRuntime, 'utf8')
    .replaceAll('ukxqbgswjlibmnjemrzd.supabase.co', 'aaaaaaaaaaaaaaaaaaaaaaaa.supabase.co');
  fs.writeFileSync(path.join(directory, 'runtime-config.js'), source, 'utf8');

  const result = await preflight(directory, path.join(directory, 'runtime-config.js'));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /Supabase ref inesperada/.test(error)));
});

test('Mercado Pago PROD accidental en runtime es rechazado', async () => {
  const directory = packageFromCandidate();
  const source = fs.readFileSync(validRuntime, 'utf8')
    .replace(
      'provider: \'supabase\',',
      "provider: 'supabase',\n    mercadopago: { mode: 'production', enabled: true },",
    );
  fs.writeFileSync(path.join(directory, 'runtime-config.js'), source, 'utf8');

  const result = await preflight(directory, path.join(directory, 'runtime-config.js'));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /Mercado Pago PROD/.test(error)));
});
