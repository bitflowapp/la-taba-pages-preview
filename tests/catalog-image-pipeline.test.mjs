import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  IMAGE_AUDIT_COLUMNS,
  catalogAssetBindingSha256,
  catalogAssetPath,
  catalogImageIdentitySha256,
  normalizeSku,
  recordsFromCsvRows,
  sha256,
  stableJson,
  validateFinalImageManifest,
  validateImageSourceAudit,
} from '../scripts/catalog-images/lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('image source audit accepts an explicit empty template', () => {
  const { header, records } = recordsFromCsvRows([IMAGE_AUDIT_COLUMNS]);
  const report = validateImageSourceAudit(header, records);
  assert.deepEqual(report, { errors: [], approved: [] });
});

test('image source audit rejects duplicate headers before record mapping', () => {
  const duplicateHeader = [...IMAGE_AUDIT_COLUMNS, 'sku'];
  const report = validateImageSourceAudit(duplicateHeader, []);
  assert.ok(report.errors.some((error) => /columna sku.*repetida/i.test(error)));
});

test('approved image requires rights, exact identity flags and expected SHA-256', () => {
  const invalid = approvedSource({
    rights_status: 'PENDIENTE',
    expected_sha256: 'abc',
    pack_verified: 'false',
  });
  const report = validateImageSourceAudit(IMAGE_AUDIT_COLUMNS, [invalid]);
  assert.ok(report.errors.some((error) => /rights_status/.test(error)));
  assert.ok(report.errors.some((error) => /expected_sha256/.test(error)));
  assert.ok(report.errors.some((error) => /pack_verified/.test(error)));
});

test('approved sources are normalized, collision checked and sorted deterministically', () => {
  const report = validateImageSourceAudit(IMAGE_AUDIT_COLUMNS, [
    approvedSource({ external_id: 'z', sku: 'Z SKU' }),
    approvedSource({ external_id: 'a', sku: 'A-SKU' }),
  ]);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.approved.map((source) => source.safeSku), ['a-sku', 'z-sku']);

  const collision = validateImageSourceAudit(IMAGE_AUDIT_COLUMNS, [
    approvedSource({ external_id: 'one', sku: 'Á SKU' }),
    approvedSource({ external_id: 'two', sku: 'A-SKU' }),
  ]);
  assert.ok(collision.errors.some((error) => /colisiona al normalizarse/.test(error)));
});

test('hash and manifest serialization are stable', () => {
  assert.equal(
    sha256(Buffer.from('TABA')),
    'b35c0f2c30668154bd4239a45381baa3d91748646e460ff927f9f2010305fb0b',
  );
  assert.equal(stableJson({ z: 1, a: { y: 2, b: 3 } }), [
    '{',
    '  "a": {',
    '    "b": 3,',
    '    "y": 2',
    '  },',
    '  "z": 1',
    '}',
    '',
  ].join('\n'));
  assert.equal(normalizeSku('  Edición Nº 1  '), 'edicion-no-1');
});

test('final manifest binds one safe 1000 master and one safe 400 thumbnail', () => {
  const valid = finalManifest();
  assert.deepEqual(validateFinalImageManifest(valid).errors, []);

  const unsafe = finalManifest();
  unsafe.sources[0].assets.thumbnail.path = '../outside.webp';
  unsafe.sources[0].assets.thumbnail.width = 1000;
  const report = validateFinalImageManifest(unsafe);
  assert.ok(report.errors.some((error) => /ruta thumbnail insegura/.test(error)));
  assert.ok(report.errors.some((error) => /thumbnail debe medir 400x400/.test(error)));
});

test('complete master and thumbnail swap between SKUs breaks deterministic identity binding', () => {
  const manifest = {
    schemaVersion: 1,
    sources: [
      finalSource({ externalId: 'external-1', sku: 'SKU-1', hashMarker: 'b' }),
      finalSource({ externalId: 'external-2', sku: 'SKU-2', hashMarker: 'd' }),
    ],
  };
  assert.deepEqual(validateFinalImageManifest(manifest).errors, []);

  const firstAssets = manifest.sources[0].assets;
  manifest.sources[0].assets = manifest.sources[1].assets;
  manifest.sources[1].assets = firstAssets;
  const report = validateFinalImageManifest(manifest);
  assert.ok(report.errors.some((error) => /nombre master no vincula identidad/.test(error)));
  assert.ok(report.errors.some((error) => /bindingSha256 master/.test(error)));
});

test('image verification accepts the approved demo and keeps the commercial template fail-closed', () => {
  const approvedDemo = spawnSync(
    process.execPath,
    ['scripts/catalog-images/verify-approved-demo.mjs'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(approvedDemo.status, 0, `${approvedDemo.stdout}\n${approvedDemo.stderr}`);

  const commercialArgs = ['scripts/catalog-images/verify.mjs'];
  const commercialWithoutApproval = spawnSync(process.execPath, commercialArgs, {
    cwd: root,
    encoding: 'utf8',
  });
  assert.notEqual(commercialWithoutApproval.status, 0);
  assert.match(
    `${commercialWithoutApproval.stdout}\n${commercialWithoutApproval.stderr}`,
    /no contiene im[aá]genes|allow-empty/i,
  );

  const templateOnly = spawnSync(process.execPath, [...commercialArgs, '--allow-empty'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(templateOnly.status, 0);
});

function approvedSource(overrides = {}) {
  return {
    external_id: 'external-1',
    sku: 'SKU-1',
    source_url: 'https://manufacturer.example/product.webp',
    source_type: 'fabricante',
    rights_status: 'LICENCIA_COMERCIAL',
    rights_reference: 'RIGHTS-2026-001',
    expected_sha256: 'a'.repeat(64),
    variant_verified: 'true',
    capacity_verified: 'true',
    package_verified: 'true',
    pack_verified: 'true',
    status: 'APROBADA',
    checked_at: '2026-07-25',
    notes: '',
    ...overrides,
  };
}

function finalManifest() {
  return {
    schemaVersion: 1,
    sources: [finalSource()],
  };
}

function finalSource({
  externalId = 'external-1',
  sku = 'SKU-1',
  hashMarker = 'b',
} = {}) {
  const source = {
    externalId,
    sku,
    safeSku: normalizeSku(sku),
    checkedAt: '2026-07-25',
    sourceSha256: 'a'.repeat(64),
    sourceType: 'fabricante',
    sourceUrl: `https://manufacturer.example/${externalId}.webp`,
    rightsStatus: 'LICENCIA_COMERCIAL',
    rightsReference: 'RIGHTS-2026-001',
  };
  source.identitySha256 = catalogImageIdentitySha256(source);
  source.assets = {
    master: boundAsset(source, 'master', hashMarker.repeat(64), 1000),
    thumbnail: boundAsset(
      source,
      'thumbnail',
      String.fromCharCode(hashMarker.charCodeAt(0) + 1).repeat(64),
      400,
    ),
  };
  return source;
}

function boundAsset(source, kind, sha, size) {
  const asset = {
    path: catalogAssetPath(source, kind, sha),
    sha256: sha,
    width: size,
    height: size,
  };
  asset.bindingSha256 = catalogAssetBindingSha256(source, kind, asset);
  return asset;
}
