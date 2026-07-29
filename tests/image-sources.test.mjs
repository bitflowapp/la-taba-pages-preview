import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { products } from '../js/approved-beverage-demo-data.js';

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

function listWebps(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return listWebps(absolute);
    return entry.isFile() && entry.name.endsWith('.webp')
      ? [path.relative(root, absolute).replaceAll('\\', '/')]
      : [];
  });
}

test('tracked storefront WebP are approved demo assets or commercial manifest entries', () => {
  const webps = listWebps(path.join(root, 'assets')).sort();
  for (const file of webps) {
    assert.doesNotMatch(file, /pizza|parrilla|carne|milanesa|chorizo|horno|combo-familiar|promo-dia|bebida-cola/i);
    assert.doesNotMatch(file, /(?:^|\/)qa-[^/]*\.webp$/i);
  }

  const manifest = JSON.parse(fs.readFileSync(
    path.join(root, 'docs/catalog/image-manifest.json'),
    'utf8',
  ));
  const manifested = manifest.sources.flatMap((source) => [
    source.assets?.master?.path,
    source.assets?.thumbnail?.path,
  ]).filter(Boolean).sort();
  const approvedDemo = products.flatMap((product) => [
    product.image,
    product.imageThumbnail,
  ]).sort();
  assert.deepEqual(webps, [...approvedDemo, ...manifested].sort());
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
  assert.equal(manifest.sources.length, 0);
});
