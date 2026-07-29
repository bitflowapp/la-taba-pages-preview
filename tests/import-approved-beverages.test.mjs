import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { products } from '../js/approved-beverage-demo-data.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const IMPORTER = path.join(ROOT, 'scripts', 'import-approved-beverages.mjs');

test('el importador aprobado es portable, autocontenido e idempotente', async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'taba-approved-beverages-'));
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));

  const sourceRoot = path.join(temporaryRoot, 'source');
  const outputRoot = path.join(temporaryRoot, 'output');
  await buildCanonicalFixture(sourceRoot);

  runImporter(sourceRoot, outputRoot);
  const firstManifest = await managedManifest(outputRoot);
  const firstModule = await fs.readFile(path.join(outputRoot, 'js', 'approved-beverage-demo-data.js'), 'utf8');

  assert.equal(firstManifest.length, 44);
  assert.equal(firstManifest.filter((entry) => entry.path.endsWith('/product.webp')).length, 22);
  assert.equal(firstManifest.filter((entry) => entry.path.endsWith('/thumbnail.webp')).length, 22);
  assert.ok(firstManifest.every((entry) => entry.size > 0));
  assert.ok(firstManifest.every((entry) => !/\b(?:pending|unresolved|qa-)\b|source\.(?:jpe?g|png)$/i.test(entry.path)));
  assert.equal(firstModule, await fs.readFile(path.join(ROOT, 'js', 'approved-beverage-demo-data.js'), 'utf8'));
  assert.doesNotMatch(firstModule, /[A-Za-z]:\\/);

  runImporter(sourceRoot, outputRoot);
  assert.deepEqual(await managedManifest(outputRoot), firstManifest);
  assert.equal(
    await fs.readFile(path.join(outputRoot, 'js', 'approved-beverage-demo-data.js'), 'utf8'),
    firstModule,
  );

  const catalogPath = path.join(sourceRoot, 'catalog-demo.json');
  const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
  catalog.products[0].sku = 'test-unapproved-product';
  await fs.writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  const rejected = runImporterRaw(sourceRoot, outputRoot);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /SKU fuera del catálogo aprobado/i);
});

function runImporter(sourceRoot, outputRoot) {
  const result = runImporterRaw(sourceRoot, outputRoot);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /22 producto\(s\), 44 WebP/);
}

function runImporterRaw(sourceRoot, outputRoot) {
  return spawnSync(
    process.execPath,
    [IMPORTER, sourceRoot, '--output-root', outputRoot],
    { cwd: ROOT, encoding: 'utf8' },
  );
}

async function buildCanonicalFixture(sourceRoot) {
  const catalog = { products: [] };
  for (const product of products) {
    const relativeRoot = `approved-demo/${product.sku}`;
    const sourceDirectory = path.join(sourceRoot, relativeRoot);
    await fs.mkdir(sourceDirectory, { recursive: true });
    await fs.copyFile(path.join(ROOT, product.image), path.join(sourceDirectory, 'product.webp'));
    await fs.copyFile(path.join(ROOT, product.imageThumbnail), path.join(sourceDirectory, 'thumbnail.webp'));
    await fs.writeFile(
      path.join(sourceDirectory, 'metadata.json'),
      `${JSON.stringify({
        sku: product.sku,
        offer: {
          units_per_pack: product.unitsPerPack,
          display_label: product.unitLabel,
        },
        images: {
          sha256: {
            product: product.imageSha256,
            thumbnail: product.imageThumbnailSha256,
            source: product.sourceImageSha256,
          },
          product_dimensions: {
            width: product.imageWidth,
            height: product.imageHeight,
          },
          thumbnail_dimensions: {
            width: product.thumbnailWidth,
            height: product.thumbnailHeight,
          },
        },
      }, null, 2)}\n`,
      'utf8',
    );
    catalog.products.push({
      sku: product.sku,
      brand: product.brand,
      name: product.name,
      variant: product.variant,
      category: product.categoryId,
      subcategory: product.subcategory,
      description: product.description,
      presentation: product.packageType,
      capacity_value: product.capacityValue,
      capacity_unit: product.capacityUnit,
      sold_as: product.unit === 'pack' ? 'pack' : 'unit',
      units_per_pack: product.unitsPerPack,
      display_label: product.unitLabel,
      demo_price_ars: product.pricePending ? null : product.price,
      available: product.sourceAvailable,
      stock_status: product.stockStatus,
      requires_business_confirmation: product.requiresBusinessConfirmation,
      contains_alcohol: product.alcoholic,
      requires_age_confirmation: product.requiresAgeConfirmation,
      recommendation_tags: product.recommendationTags,
      complementary_categories: product.complementaryCategories,
      rights_status: product.rightsStatus,
      metadata: `${relativeRoot}/metadata.json`,
      image: `${relativeRoot}/product.webp`,
      thumbnail: `${relativeRoot}/thumbnail.webp`,
    });
  }
  await fs.writeFile(path.join(sourceRoot, 'catalog-demo.json'), `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
}

async function managedManifest(outputRoot) {
  const assetRoot = path.join(outputRoot, 'assets', 'catalog', 'beverages');
  const entries = [];
  for (const sku of (await fs.readdir(assetRoot)).sort()) {
    const skuDirectory = path.join(assetRoot, sku);
    const stat = await fs.lstat(skuDirectory);
    assert.equal(stat.isDirectory() && !stat.isSymbolicLink(), true, `${sku}: directorio físico requerido`);
    for (const file of (await fs.readdir(skuDirectory)).sort()) {
      const absolute = path.join(skuDirectory, file);
      const fileStat = await fs.lstat(absolute);
      assert.equal(fileStat.isFile() && !fileStat.isSymbolicLink(), true, `${sku}/${file}: archivo físico requerido`);
      const bytes = await fs.readFile(absolute);
      entries.push({
        path: `${sku}/${file}`,
        size: bytes.length,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      });
    }
  }
  return entries;
}
