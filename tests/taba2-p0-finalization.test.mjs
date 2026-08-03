import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'catalog/products.json'), 'utf8'));

test('P0 finalization emits separate authority states and price-safe records', () => {
  const approved = catalog.filter((p) => p.catalog_status === 'approved');
  assert.ok(approved.length >= 60);
  assert.equal(new Set(approved.map((p) => p.sku)).size, approved.length);
  assert.equal(new Set(approved.map((p) => p.slug)).size, approved.length);
  assert.ok(approved.every((p) => p.price === null && p.regular_price === null && p.price_status === 'pending'));
  assert.ok(approved.every((p) => p.publication_status === 'blocked' && p.rights_status === 'pending_review'));
  assert.ok(approved.every((p) => p.image_status === 'verified' && p.identity_status === 'verified'));
  assert.ok(approved.every((p) => (p.category_id === 'complementos' ? p.capacity_unit === 'g' : p.capacity_unit === 'ml') && p.capacity_value > 0 && p.pack_count >= 1));
});

test('Heineken x6 remains rejected and is not reused', () => {
  const product = catalog.find((p) => p.sku === 'heineken-original-lata-473ml-pack-6');
  assert.equal(product.catalog_status, 'rejected');
  assert.equal(product.publication_status, 'blocked');
  assert.doesNotMatch(product.image_master || '', /products\/cervezas/);
});

test('versioned finalization outputs and photo capture package exist', () => {
  for (const file of ['products.json', 'publication-readiness.csv', 'image-rights.csv', 'image-manifest.json', 'rejected-assets.csv']) assert.ok(fs.existsSync(path.join(root, 'catalog', file)), file);
  for (const file of ['PHOTO_CAPTURE_SHOT_LIST.csv', 'PHOTO_CAPTURE_GUIDE.md', 'PHOTO_CAPTURE_LABELS.pdf']) assert.ok(fs.existsSync(path.join(root, 'catalog/photo-capture', file)), file);
  assert.match(fs.readFileSync(path.join(root, 'catalog/photo-capture/PHOTO_CAPTURE_LABELS.pdf'), 'latin1'), /^%PDF-1\.4/);
});

test('photo intake pipeline is reproducible and empty input validates closed-safe', () => {
  const readme = fs.readFileSync(path.join(root, 'catalog/photo-intake/README.md'), 'utf8');
  assert.match(readme, /<sku>__front/);
  const intake = fs.mkdtempSync(path.join(os.tmpdir(), 'taba2-photo-intake-'));
  try {
    const result = spawnSync(process.execPath, ['scripts/catalog-photos.mjs', 'validate'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, TABA_CATALOG_PHOTO_INTAKE_DIR: intake },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const validation = JSON.parse(fs.readFileSync(path.join(intake, 'validation.json'), 'utf8'));
    assert.equal(validation.files, 0);
    assert.deepEqual(validation.valid, []);
  } finally {
    fs.rmSync(intake, { recursive: true, force: true });
  }
});
