import assert from 'node:assert/strict';
import test from 'node:test';

import {
  auditReleaseHygiene,
  findPersonalLocalPaths,
  findPrivateIdentifiers,
  findPublicQaAssets,
} from '../scripts/check-release-hygiene.mjs';

test('release hygiene rejects a real device identifier without exposing its value', () => {
  const key = ['ser', 'ial'].join('');
  const source = JSON.stringify({ device: { [key]: ['phy', 'sical-device-123'].join('') } });
  const findings = findPrivateIdentifiers('evidence.json', source);

  assert.deepEqual(findings, [{
    file: 'evidence.json',
    location: '$.device.serial',
    category: 'private-device-identifier',
  }]);
  assert.doesNotMatch(JSON.stringify(findings), /physical-device-123/);
});

test('release hygiene accepts omitted and explicitly redacted identifiers', () => {
  assert.deepEqual(findPrivateIdentifiers('evidence.json', JSON.stringify({ device: {} })), []);
  assert.deepEqual(
    findPrivateIdentifiers('evidence.json', JSON.stringify({ device: { serial: '<redacted>' } })),
    [],
  );
});

test('release hygiene rejects local drive paths and personal homes without exposing values', () => {
  const drivePath = ['Z', ':', '\\', 'Users', '\\', 'private-operator', '\\', 'release'].join('');
  const homePath = ['', 'home', 'private-operator', 'release'].join('/');
  const source = [`Repo: \`${drivePath}\``, `Backup: \`${homePath}\``].join('\n');
  const findings = findPersonalLocalPaths('portable-doc.md', source);

  assert.deepEqual(findings, [
    {
      file: 'portable-doc.md',
      location: 'line 1',
      category: 'local-drive-path',
    },
    {
      file: 'portable-doc.md',
      location: 'line 2',
      category: 'personal-home-path',
    },
  ]);
  assert.doesNotMatch(JSON.stringify(findings), /private-operator/);
});

test('release hygiene accepts portable placeholders and relative paths', () => {
  const source = [
    'Repo: `<REPO_ROOT>`',
    'Backup: `<EXTERNAL_BACKUP_ROOT>/release`',
    'Fixture: `tests/fixtures/catalog.mjs`',
  ].join('\n');

  assert.deepEqual(findPersonalLocalPaths('portable-doc.md', source), []);
});

test('release hygiene rejects public QA WebP assets and runtime references', () => {
  const qaFileName = ['q', 'a-legacy-product', '.', 'webp'].join('');
  const runtimeSource = `const image = "assets/catalog/products/${qaFileName}";`;

  assert.deepEqual(findPublicQaAssets(`assets/catalog/products/${qaFileName}`), [{
    file: `assets/catalog/products/${qaFileName}`,
    location: 'tracked path',
    category: 'public-qa-asset',
  }]);
  assert.deepEqual(findPublicQaAssets('js/catalog.js', runtimeSource), [{
    file: 'js/catalog.js',
    location: 'line 1',
    category: 'public-qa-runtime-reference',
  }]);
});

test('release hygiene permits QA-only fixture paths outside public runtime', () => {
  const qaFileName = ['q', 'a-legacy-product', '.', 'webp'].join('');
  const fixtureSource = `export const image = "tests/fixtures/${qaFileName}";`;

  assert.deepEqual(findPublicQaAssets(`tests/fixtures/${qaFileName}`), []);
  assert.deepEqual(findPublicQaAssets('tests/fixtures/catalog.mjs', fixtureSource), []);
});

test('tracked release files satisfy every hygiene rule', () => {
  assert.deepEqual(auditReleaseHygiene(), []);
});
