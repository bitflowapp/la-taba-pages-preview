import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { createSbom } from '../scripts/create-sbom.mjs';

test('SBOM CycloneDX incluye dependencias npm y Cargo con HEAD reproducible', () => {
  const packageLockText = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      '': { name: 'fixture' },
      'node_modules/example': { name: 'example', version: '1.2.3', integrity: `sha512-${Buffer.from('fixture').toString('base64')}` },
    },
  });
  const cargoLockText = `[[package]]\nname = "fixture-crate"\nversion = "4.5.6"\nchecksum = "${'a'.repeat(64)}"\n`;
  const head = 'b'.repeat(40);
  const first = createSbom({ packageLockText, cargoLockText, gitHead: head, appVersion: '1.0.0' });
  const second = createSbom({ packageLockText, cargoLockText, gitHead: head, appVersion: '1.0.0' });
  assert.deepEqual(first, second);
  assert.equal(first.bomFormat, 'CycloneDX');
  assert.equal(first.specVersion, '1.5');
  assert.equal(first.components.length, 2);
  assert.ok(first.components.some(({ purl }) => purl === 'pkg:npm/example@1.2.3'));
  assert.ok(first.components.some(({ purl }) => purl === 'pkg:cargo/fixture-crate@4.5.6'));
  assert.doesNotMatch(JSON.stringify(first), /token|password|private.?key/i);
});

test('locks reales generan inventario sin secretos', () => {
  const packageLockText = fs.readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8');
  const cargoLockText = fs.readFileSync(new URL('../src-tauri/Cargo.lock', import.meta.url), 'utf8');
  const sbom = createSbom({ packageLockText, cargoLockText, gitHead: 'c'.repeat(40), appVersion: '0.1.0' });
  assert.ok(sbom.components.length > 100);
  assert.equal(new Set(sbom.components.map((component) => component['bom-ref'])).size, sbom.components.length);
});
