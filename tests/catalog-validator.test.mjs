import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REQUIRED_COLUMNS,
  validateCatalog,
} from '../scripts/validate-product-catalog.mjs';
import {
  catalogAssetBindingSha256,
  catalogAssetPath,
  catalogImageIdentitySha256,
} from '../scripts/catalog-images/lib.mjs';

const template = fs.readFileSync(new URL('../data/catalog-template.csv', import.meta.url), 'utf8');
const masterTemplate = fs.readFileSync(new URL('../templates/la-taba-products-template.csv', import.meta.url), 'utf8');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const approvedImageManifest = manifest();

test('catalog template has every required column and intentionally no commercial rows', () => {
  for (const candidate of [template, masterTemplate]) {
    const report = validateCatalog(candidate, { allowEmpty: true });
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.products, []);
    for (const column of REQUIRED_COLUMNS) assert.match(candidate, new RegExp(`\\b${column}\\b`));
  }
  assert.equal(masterTemplate.trim(), template.trim());
});

test('catalog validator rejects an empty catalog unless template mode is explicit', () => {
  const report = validateCatalog(template);
  assert.ok(report.errors.some((error) => /no contiene productos/.test(error)));
  assert.deepEqual(validateCatalog(template, { allowEmpty: true }).errors, []);
});

test('catalog validator CLI requires --template to approve a header-only file', () => {
  const args = ['scripts/validate-product-catalog.mjs', 'data/catalog-template.csv'];
  const rejected = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  assert.equal(rejected.status, 1);
  assert.match(`${rejected.stdout}${rejected.stderr}`, /no contiene productos/);

  const templateOnly = spawnSync(process.execPath, [...args, '--template'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(templateOnly.status, 0);
});

test('catalog validator accepts a complete canonical beverage row', () => {
  const report = validateCatalog(catalogCsv(validProduct()), {
    fileExists: () => true,
    imageManifest: approvedImageManifest,
  });
  assert.deepEqual(report.errors, []);
  assert.equal(report.products.length, 1);
});

test('catalog validator requires exact manifest identity, master and 400 thumbnail', () => {
  const withoutManifest = validateCatalog(catalogCsv(validProduct()), {
    fileExists: () => true,
  });
  assert.ok(withoutManifest.errors.some((error) => /Falta el manifiesto final/.test(error)));

  const mismatch = manifest();
  mismatch.sources[0].externalId = 'another-product';
  const report = validateCatalog(catalogCsv(validProduct()), {
    fileExists: () => true,
    imageManifest: mismatch,
  });
  assert.ok(report.errors.some((error) => /external_id\/SKU no tienen una imagen aprobada/.test(error)));
});

test('catalog validator accepts fractional capacity such as 0.5 L', () => {
  const report = validateCatalog(catalogCsv(validProduct({
    capacity_value: '0.5',
    capacity_unit: 'l',
  })), { fileExists: () => true, imageManifest: approvedImageManifest });
  assert.deepEqual(report.errors, []);
});

test('catalog validator aligns numeric boundaries with PostgreSQL storage', () => {
  const boundary = validateCatalog(catalogCsv(validProduct({
    price: '9999999999.99',
    stock: '2147483647',
    units_per_pack: '2147483647',
    sort_order: '2147483647',
  })), { fileExists: () => true, imageManifest: approvedImageManifest });
  assert.deepEqual(boundary.errors, []);

  for (const [field, value, expected] of [
    ['price', '10000000000', /precio/i],
    ['price', 'Infinity', /precio/i],
    ['stock', '2147483648', /stock/i],
    ['units_per_pack', '2147483648', /units_per_pack/i],
    ['sort_order', '2147483648', /sort_order/i],
    ['capacity_value', '9'.repeat(400), /capacidad incoherente/],
    ['capacity_value', 'NaN', /capacidad incoherente/],
  ]) {
    const report = validateCatalog(catalogCsv(validProduct({ [field]: value })), {
      fileExists: () => true,
      imageManifest: approvedImageManifest,
    });
    assert.ok(report.errors.some((error) => expected.test(error)), `${field}=${value}`);
  }
});

test('catalog validator rejects duplicates, alcohol without age and unsafe image path', () => {
  const row = validProduct({
    minimum_age: '',
    image_path: '../secret.webp',
  });
  const report = validateCatalog(catalogCsv(row, row), {
    fileExists: () => true,
    imageManifest: approvedImageManifest,
  });
  assert.ok(report.errors.some((error) => /external_id duplicado/.test(error)));
  assert.ok(report.errors.some((error) => /SKU duplicado/.test(error)));
  assert.ok(report.errors.some((error) => /alcohol sin edad/.test(error)));
  assert.ok(report.errors.some((error) => /ruta de imagen insegura/.test(error)));
});

test('catalog validator rejects duplicate CSV headers before mapping rows', () => {
  const duplicateHeader = `${template.trim()},sku\n`;
  const report = validateCatalog(duplicateHeader, { allowEmpty: true });
  assert.ok(report.errors.some((error) => /columna sku.*repetida/i.test(error)));
});

test('catalog validator rejects zero price and missing verified master fields', () => {
  const report = validateCatalog(catalogCsv(validProduct({
    price: '0',
    variant: '',
    subcategory: '',
    sort_order: '',
  })), { fileExists: () => true, imageManifest: approvedImageManifest });

  assert.ok(report.errors.some((error) => /precio inválido/.test(error)));
  assert.ok(report.errors.some((error) => /variant está vacío/.test(error)));
  assert.ok(report.errors.some((error) => /subcategory está vacío/.test(error)));
  assert.ok(report.errors.some((error) => /sort_order está vacío/.test(error)));
});

test('catalog validator enforces category and alcohol coherence', () => {
  const beerAsSoftDrink = validateCatalog(catalogCsv(validProduct({
    alcoholic: 'false',
    minimum_age: '',
  })), { fileExists: () => true, imageManifest: approvedImageManifest });
  assert.ok(beerAsSoftDrink.errors.some((error) => /Cervezas debe marcarse como alcohólica/.test(error)));

  const waterAsAlcohol = validateCatalog(catalogCsv(validProduct({
    category: 'Aguas',
    alcoholic: 'true',
  })), { fileExists: () => true, imageManifest: approvedImageManifest });
  assert.ok(waterAsAlcohol.errors.some((error) => /Aguas no puede marcarse como alcohólica/.test(error)));

  const softDrinkWithAge = validateCatalog(catalogCsv(validProduct({
    category: 'Gaseosas',
    alcoholic: 'false',
    minimum_age: '18',
  })), { fileExists: () => true, imageManifest: approvedImageManifest });
  assert.ok(softDrinkWithAge.errors.some((error) => /sin alcohol no debe declarar minimum_age/.test(error)));

  const alcoholicPromotion = validateCatalog(catalogCsv(validProduct({
    category: 'Promos',
    alcoholic: 'true',
  })), { fileExists: () => true, imageManifest: approvedImageManifest });
  assert.deepEqual(alcoholicPromotion.errors, []);
});

function catalogCsv(...products) {
  return `${template.trim()}\n${products.map((product) => (
    REQUIRED_COLUMNS.map((column) => product[column] ?? '').join(',')
  )).join('\n')}\n`;
}

function validProduct(overrides = {}) {
  return {
    external_id: 'qa-beer-473',
    sku: 'QA-BEER-473',
    brand: 'Marca QA',
    name: 'Bebida QA',
    variant: 'Clásica',
    category: 'Cervezas',
    subcategory: 'Lager',
    capacity_value: '473',
    capacity_unit: 'ml',
    package_type: 'lata',
    units_per_pack: '1',
    price: '1000',
    stock: '5',
    available: 'true',
    alcoholic: 'true',
    minimum_age: '18',
    chilled: 'true',
    featured: 'false',
    sort_order: '10',
    image_path: approvedImageManifest.sources[0].assets.master.path,
    tags: 'qa|fría',
    ...overrides,
  };
}

function manifest(overrides = {}) {
  const source = {
    externalId: 'qa-beer-473',
    sku: 'QA-BEER-473',
    safeSku: 'qa-beer-473',
    checkedAt: '2026-07-25',
    sourceSha256: 'a'.repeat(64),
    sourceType: 'fabricante',
    sourceUrl: 'https://manufacturer.example/qa-beer.webp',
    rightsStatus: 'LICENCIA_COMERCIAL',
    rightsReference: 'RIGHTS-2026-001',
    ...overrides,
  };
  source.identitySha256 = catalogImageIdentitySha256(source);
  source.assets = {
    master: boundAsset(source, 'master', 'b'.repeat(64), 1000),
    thumbnail: boundAsset(source, 'thumbnail', 'c'.repeat(64), 400),
  };
  return { schemaVersion: 1, sources: [source] };
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
