import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyCatalogImport,
  createCatalogImportPlan,
  parseImportArgs,
  validateImportCredentials,
} from '../scripts/import-product-catalog.mjs';
import { REQUIRED_COLUMNS } from '../scripts/validate-product-catalog.mjs';
import {
  catalogAssetBindingSha256,
  catalogAssetPath,
  catalogImageIdentitySha256,
  normalizeSku,
} from '../scripts/catalog-images/lib.mjs';

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const IMAGE_MANIFEST = imageManifest();

test('catalog import requires one explicit non-mutating or mutating mode', () => {
  assert.throws(
    () => parseImportArgs(['catalog.csv', '--business-id', BUSINESS_ID]),
    /exactamente un modo/,
  );
  assert.throws(
    () => parseImportArgs(['catalog.csv', '--dry-run', '--apply']),
    /exactamente un modo/,
  );
  assert.deepEqual(
    parseImportArgs(['catalog.csv', '--business-id', BUSINESS_ID, '--dry-run']),
    { file: 'catalog.csv', mode: 'dry-run', businessId: BUSINESS_ID },
  );
  assert.throws(
    () => parseImportArgs(['catalog.csv', '--dry-run', '--unknown']),
    /Flag desconocido/,
  );
});

test('catalog import plan rejects duplicate CSV headers', () => {
  const plan = createCatalogImportPlan(`${REQUIRED_COLUMNS.join(',')},sku\n`, {
    businessId: BUSINESS_ID,
    imageManifest: { schemaVersion: 1, sources: [] },
  });
  assert.ok(plan.errors.some((error) => /columna sku.*repetida/i.test(error)));
});

test('catalog import plan maps CSV deterministically and always stages fail closed', () => {
  const text = csv(
    product({
      external_id: 'zeta',
      sku: 'SKU-Z',
      category: 'Aguas',
      alcoholic: 'false',
      minimum_age: '',
      image_path: manifestSource('zeta', 'SKU-Z').assets.master.path,
    }),
    product({
      external_id: 'alpha',
      sku: 'SKU-A',
      featured: 'true',
      image_path: manifestSource('alpha', 'SKU-A').assets.master.path,
    }),
  );
  const first = createCatalogImportPlan(text, {
    businessId: BUSINESS_ID,
    fileExists: () => true,
    imageManifest: IMAGE_MANIFEST,
  });
  const second = createCatalogImportPlan(text, {
    businessId: BUSINESS_ID,
    fileExists: () => true,
    imageManifest: IMAGE_MANIFEST,
  });

  assert.deepEqual(first.errors, []);
  assert.equal(first.payloadSha256, second.payloadSha256);
  assert.deepEqual(first.entries.map((entry) => entry.row.external_id), ['alpha', 'zeta']);

  const beer = first.entries[0];
  assert.equal(beer.requestedAvailable, true);
  assert.equal(beer.row.available, false);
  assert.equal(beer.row.is_verified, false);
  assert.equal(beer.row.verified_at, null);
  assert.equal(beer.row.verified_by, null);
  assert.equal(beer.row.variant, beer.row.presentation);
  assert.equal(beer.row.capacity_value, 473);
  assert.equal(beer.row.capacity_unit, 'ml');
  assert.equal(beer.row.presentation, 'Clásica');
  assert.equal(beer.row.capacity, '473 ml');
  assert.equal(beer.row.packaging_type, 'lata');
  assert.equal(beer.row.is_alcoholic, true);
  assert.equal(beer.row.minimum_age, 18);
  assert.equal(
    beer.row.image_thumbnail_url,
    manifestSource('alpha', 'SKU-A').assets.thumbnail.path,
  );
  assert.equal(beer.row.image_sha256, 'b'.repeat(64));
  assert.equal(beer.assetRegistration.rights_reference, 'RIGHTS-2026-001');
  assert.deepEqual(beer.row.tags, ['destacado', 'fría', 'qa']);
});

test('catalog apply imports assets and products in one atomic RPC', async () => {
  const plan = createCatalogImportPlan(csv(product()), {
    businessId: BUSINESS_ID,
    fileExists: () => true,
    imageManifest: IMAGE_MANIFEST,
  });
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push({ name, args });
      assert.equal(name, 'import_catalog_batch');
      return {
        data: args.p_products.map((row) => ({
          product_id: '22222222-2222-4222-8222-222222222222',
          staged_external_id: row.external_id,
          staged_sku: row.sku,
          staged_is_verified: false,
          staged_available: false,
        })),
        error: null,
      };
    },
  };

  const result = await applyCatalogImport(client, plan);
  assert.equal(result.imported, 1);
  assert.deepEqual(calls.map((call) => call.name), ['import_catalog_batch']);
  assert.equal(calls[0].args.p_business_id, BUSINESS_ID);
  assert.equal(
    calls[0].args.p_assets[0].thumbnail_path,
    IMAGE_MANIFEST.sources[0].assets.thumbnail.path,
  );
  assert.equal(
    calls[0].args.p_assets[0].thumbnail_binding_sha256,
    IMAGE_MANIFEST.sources[0].assets.thumbnail.bindingSha256,
  );
  assert.equal(calls[0].args.p_products[0].available, false);
  assert.equal('is_verified' in calls[0].args.p_products[0], false);
  assert.equal(calls[0].args.p_products[0].variant, calls[0].args.p_products[0].presentation);
  assert.equal(calls[0].args.p_products[0].capacity_value, 473);
  assert.equal(calls[0].args.p_products[0].capacity_unit, 'ml');
});

test('catalog import refuses invalid, empty, or non-UUID plans', async () => {
  const invalid = createCatalogImportPlan('', { businessId: 'not-a-uuid' });
  assert.ok(invalid.errors.length > 0);
  await assert.rejects(() => applyCatalogImport({ from() {} }, invalid), /catálogo inválido/);
  await assert.rejects(() => applyCatalogImport({ rpc() {} }, null), /objeto no nulo/);
  await assert.rejects(
    () => applyCatalogImport({ rpc() {} }, { errors: [], entries: null, businessId: BUSINESS_ID }),
    /catálogo vacío/,
  );
});

test('catalog import rejects null, short or inconsistent atomic RPC responses', async () => {
  const plan = createCatalogImportPlan(csv(product()), {
    businessId: BUSINESS_ID,
    fileExists: () => true,
    imageManifest: IMAGE_MANIFEST,
  });
  await assert.rejects(
    () => applyCatalogImport({ rpc: async () => ({ data: null, error: null }) }, plan),
    /respuesta de importación no nula/,
  );
  await assert.rejects(
    () => applyCatalogImport({ rpc: async () => ({ data: [], error: null }) }, plan),
    /0 de 1 filas esperadas/,
  );
  await assert.rejects(
    () => applyCatalogImport({
      rpc: async () => ({
        data: [{
          product_id: '22222222-2222-4222-8222-222222222222',
          staged_external_id: 'otro',
          staged_sku: 'OTRO',
          staged_is_verified: false,
          staged_available: false,
        }],
        error: null,
      }),
    }, plan),
    /respuesta de importación inconsistente/,
  );
});

test('catalog import rejects non-finite and PostgreSQL out-of-range numbers before RPC', async () => {
  for (const [field, value] of [
    ['price', Number.POSITIVE_INFINITY],
    ['capacity_value', Number.NaN],
    ['stock', 2_147_483_648],
    ['units_per_pack', 2_147_483_648],
    ['sort_order', 2_147_483_648],
  ]) {
    const plan = createCatalogImportPlan(csv(product()), {
      businessId: BUSINESS_ID,
      fileExists: () => true,
      imageManifest: IMAGE_MANIFEST,
    });
    plan.entries[0].row[field] = value;
    let calls = 0;
    await assert.rejects(
      () => applyCatalogImport({
        rpc: async () => {
          calls += 1;
          return { data: [], error: null };
        },
      }, plan),
      /antes del RPC/,
    );
    assert.equal(calls, 0, `${field} no debe alcanzar Supabase`);
  }
});

test('catalog import accepts only a public key plus authenticated user JWT', () => {
  const authenticated = fakeJwt('authenticated');
  assert.deepEqual(validateImportCredentials({
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    SUPABASE_ACCESS_TOKEN: authenticated,
  }), {
    accessToken: authenticated,
    publishableKey: 'sb_publishable_test',
    url: 'https://project.supabase.co',
  });

  assert.throws(() => validateImportCredentials({
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_ANON_KEY: fakeJwt('service_role'),
    SUPABASE_ACCESS_TOKEN: authenticated,
  }), /service_role/);
  assert.throws(() => validateImportCredentials({
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    SUPABASE_ACCESS_TOKEN: fakeJwt('anon'),
  }), /authenticated/);
});

function csv(...products) {
  return `${REQUIRED_COLUMNS.join(',')}\n${products.map((candidate) => (
    REQUIRED_COLUMNS.map((column) => candidate[column] ?? '').join(',')
  )).join('\n')}\n`;
}

function product(overrides = {}) {
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
    image_path: IMAGE_MANIFEST.sources[0].assets.master.path,
    tags: 'qa|fría',
    ...overrides,
  };
}

function fakeJwt(role) {
  return [
    Buffer.from('{"alg":"none"}').toString('base64url'),
    Buffer.from(JSON.stringify({ role })).toString('base64url'),
    'signature',
  ].join('.');
}

function imageManifest() {
  const source = (externalId, sku, file) => {
    const candidate = {
      externalId,
      sku,
      safeSku: normalizeSku(sku),
      checkedAt: '2026-07-25',
      sourceSha256: 'a'.repeat(64),
      sourceType: 'fabricante',
      sourceUrl: `https://manufacturer.example/${file}.webp`,
      rightsStatus: 'LICENCIA_COMERCIAL',
      rightsReference: 'RIGHTS-2026-001',
    };
    candidate.identitySha256 = catalogImageIdentitySha256(candidate);
    candidate.assets = {
      master: boundAsset(candidate, 'master', 'b'.repeat(64), 1000),
      thumbnail: boundAsset(candidate, 'thumbnail', 'c'.repeat(64), 400),
    };
    return candidate;
  };
  return {
    schemaVersion: 1,
    sources: [
      source('qa-beer-473', 'QA-BEER-473', 'qa-beer'),
      source('alpha', 'SKU-A', 'qa-alpha'),
      source('zeta', 'SKU-Z', 'qa-zeta'),
    ],
  };
}

function manifestSource(externalId, sku) {
  return IMAGE_MANIFEST.sources.find((source) => (
    source.externalId === externalId && source.sku === sku
  ));
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
