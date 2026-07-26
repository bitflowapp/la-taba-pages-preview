import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsPath = path.join(root, 'docs/image-sources.md');
const placeholderPath = path.join(root, 'assets/products/beverage-placeholder.svg');
const assetAuditPath = path.join(root, 'docs/final-commercial-release/catalog-asset-audit.csv');

test('preview uses one neutral documented placeholder with a matching SHA-256', () => {
  assert.equal(fs.existsSync(docsPath), true);
  assert.equal(fs.existsSync(placeholderPath), true);
  assert.ok(fs.statSync(placeholderPath).size < 20 * 1024);

  const docs = fs.readFileSync(docsPath, 'utf8');
  assert.match(docs, /beverage-placeholder\.svg/);
  assert.match(docs, /Preview privado únicamente/);
  assert.doesNotMatch(docs, /pizzería|carnicería|pizza|parrilla|carne/i);

  const digest = crypto.createHash('sha256')
    .update(fs.readFileSync(placeholderPath))
    .digest('hex');
  const audit = fs.readFileSync(assetAuditPath, 'utf8');
  assert.match(audit, new RegExp(digest));
  assert.match(audit, /APPROVED_PREVIEW_ONLY/);
});

test('tracked storefront assets contain no legacy food WebP and match the manifest', () => {
  const candidates = [
    path.join(root, 'assets/hero'),
    path.join(root, 'assets/products'),
    path.join(root, 'assets/catalog/products'),
    path.join(root, 'assets/catalog/thumbnails'),
  ];
  const webps = candidates.flatMap((directory) => (
    fs.existsSync(directory)
      ? fs.readdirSync(directory)
        .filter((name) => name.endsWith('.webp'))
        .map((name) => path.relative(root, path.join(directory, name)).replaceAll('\\', '/'))
      : []
  )).sort();
  for (const file of webps) {
    assert.doesNotMatch(file, /pizza|parrilla|carne|milanesa|chorizo|horno|combo-familiar|promo-dia|bebida-cola/i);
  }

  const manifest = JSON.parse(fs.readFileSync(
    path.join(root, 'docs/catalog/image-manifest.json'),
    'utf8',
  ));
  const manifested = manifest.sources.flatMap((source) => [
    source.assets?.master?.path,
    source.assets?.thumbnail?.path,
  ]).filter(Boolean).sort();
  assert.deepEqual(webps, manifested);
});

test('commercial image audit and manifest are explicit and traceable', () => {
  const audit = fs.readFileSync(
    path.join(root, 'docs/catalog/image-source-audit.csv'),
    'utf8',
  );
  for (const field of [
    'rights_reference',
    'expected_sha256',
    'variant_verified',
    'capacity_verified',
    'package_verified',
    'pack_verified',
  ]) {
    assert.match(audit, new RegExp(`\\b${field}\\b`));
  }

  const manifest = JSON.parse(fs.readFileSync(
    path.join(root, 'docs/catalog/image-manifest.json'),
    'utf8',
  ));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.sources.length, 8);
});
