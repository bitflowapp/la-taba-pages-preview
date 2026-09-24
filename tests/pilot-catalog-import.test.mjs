import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildPilotCatalogPlan, PROPOSED_PILOT_SKUS, assertPilotIdentity,
  applyPilotCatalog, reconcilePilotOwnerReply } from '../scripts/import-pilot-catalog.mjs';

const ref = 'abcdefghijklmnopqrst';
const businessId = '116d8f37-29f5-40f1-a692-81b86b69a72c';
const template = JSON.parse(readFileSync('catalog/pilot-approved-template.json', 'utf8'));
const snapshot = JSON.parse(readFileSync('catalog/production-catalog-snapshot.json', 'utf8'));
const imageManifest = JSON.parse(readFileSync('docs/catalog/image-manifest.json', 'utf8'));
const opts = { projectRef: ref, businessId, snapshot, imageManifest };
const syntheticApproval = (count = 5) => {
  const input = structuredClone(template);
  input.approval = { source: 'BUSINESS_OWNER', receivedAt: '2026-09-24T12:00:00Z',
    evidenceRef: 'TEST_ONLY_SYNTHETIC_NOT_FOR_DEPLOY' };
  input.products.slice(0, count).forEach((product) => {
    product.publish = true;
    product.identityAndImageApproved = true;
    product.description = `${product.name} · descripción de prueba`;
    product.price = 100;
    product.stock = 5;
  });
  return input;
};

test('committed pilot template is exactly ten reviewed SKUs and cannot import', () => {
  assert.deepEqual(template.products.map((item) => item.sku), PROPOSED_PILOT_SKUS);
  assert.ok(template.products.every((item) => item.price === null && item.stock === null
    && item.publish === null && item.identityAndImageApproved === null));
  assert.throws(() => buildPilotCatalogPlan(template, opts), /EXPLICIT_OWNER_APPROVAL_REQUIRED/);
  const result = spawnSync(process.execPath, ['scripts/import-pilot-catalog.mjs',
    '--target', 'pilot', '--project-ref', ref, '--business-id', businessId,
    '--approval', 'catalog/pilot-approved-template.json', '--dry-run'], {
    encoding: 'utf8', windowsHide: true, timeout: 10_000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /EXPLICIT_OWNER_APPROVAL_REQUIRED/);
});

test('synthetic approval exercises dry-run plan without backend writes', () => {
  const plan = buildPilotCatalogPlan(syntheticApproval(), opts);
  assert.equal(plan.entries.length, 5);
  assert.ok(plan.entries.every((entry) => entry.row.available === false
    && entry.row.is_verified === false && entry.row.price === 100
    && entry.row.stock === 5 && entry.row.description.includes('prueba')));
});

test('CLI dry-run accepts a synthetic external approval file and writes nothing', () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'taba-pilot-import-test-'));
  try {
    const file = path.join(temp, 'synthetic-approval.json');
    writeFileSync(file, JSON.stringify(syntheticApproval()));
    const result = spawnSync(process.execPath, ['scripts/import-pilot-catalog.mjs',
      '--target', 'pilot', '--project-ref', ref, '--business-id', businessId,
      '--approval', file, '--dry-run'], {
      encoding: 'utf8', windowsHide: true, timeout: 10_000,
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /"pilotCatalogDryRun":"PASS"/);
    assert.match(result.stdout, /"writes":false/);
  } finally {
    const resolved = path.resolve(temp);
    assert.ok(resolved.startsWith(path.resolve(tmpdir()) + path.sep)
      && path.basename(resolved).startsWith('taba-pilot-import-test-'));
    rmSync(resolved, { recursive: true, force: true });
  }
});

test('pilot import rejects incomplete or mismatched merchant data', () => {
  assert.throws(() => buildPilotCatalogPlan(syntheticApproval(4), opts),
    /PILOT_NEEDS_5_TO_10_EXPLICIT_PRODUCTS/);
  const missingPrice = syntheticApproval();
  missingPrice.products[0].price = null;
  assert.throws(() => buildPilotCatalogPlan(missingPrice, opts), /CURRENT_PRICE_REQUIRED/);
  const wrongImage = syntheticApproval();
  wrongImage.products[0].image = 'assets/products/wrong.webp';
  assert.throws(() => buildPilotCatalogPlan(wrongImage, opts), /IMAGE_CHANGED_REQUIRES_NEW_REVIEW/);
  const noPhotoApproval = syntheticApproval();
  noPhotoApproval.products[0].identityAndImageApproved = null;
  assert.throws(() => buildPilotCatalogPlan(noPhotoApproval, opts), /IDENTITY_IMAGE_APPROVAL_REQUIRED/);
  for (const blocked of ['ucbtjcurawxjwjdvvcvj', 'wwcpogltfgzgkrlilbcd', 'yakhtrkukqlgzvxuvhzs']) {
    assert.throws(() => assertPilotIdentity(blocked, businessId), /PILOT_BACKEND_MUST_BE_NEW/);
  }
});

test('initial import refuses a business with pre-existing catalog', async () => {
  const client = { from: () => ({ select: () => ({ eq: async () => ({
    data: [{ sku: 'unapproved-qa-product', available: false, catalog_origin: 'test_only' }], error: null,
  }) }) }) };
  await assert.rejects(applyPilotCatalog(client, buildPilotCatalogPlan(syntheticApproval(), opts)),
    /PILOT_EXISTING_CATALOG_MUST_BE_ONLY_THIS_ALLOWLIST/);
});

test('catalog import uses hidden staging RPC and compensates failed publication', async () => {
  const plan = buildPilotCatalogPlan(syntheticApproval(), opts);
  const calls = [];
  let published = 0;
  const client = {
    from: () => ({ select: (_fields, options) => ({
      eq: async () => ({ data: [], error: null }),
    }) }),
    rpc: async (name, args) => {
      calls.push(name);
      if (name === 'import_catalog_batch') return { data: plan.entries.map((entry) => ({
        product_id: businessId, staged_external_id: entry.row.external_id,
        staged_sku: entry.row.sku, staged_is_verified: false, staged_available: false,
      })), error: null };
      if (name === 'publish_catalog_product') {
        published += 1;
        return published === 2 ? { error: { code: 'QA_FAIL' } }
          : { data: [{ published_is_verified: true, published_available: false,
            published_sku: args.p_external_id }], error: null };
      }
      if (name === 'set_commercial_product_publication') return { data: [{
        applied_sku: args.p_sku, applied_available: true, applied_is_verified: true,
      }], error: null };
      if (name === 'unpublish_catalog_product') return { data: true, error: null };
      throw Error(`Unexpected RPC ${name}`);
    },
  };
  await assert.rejects(applyPilotCatalog(client, plan), /QA_FAIL/);
  assert.equal(calls.filter((name) => name === 'import_catalog_batch').length, 1);
  assert.equal(calls.filter((name) => name === 'unpublish_catalog_product').length, 5);
});

test('informal owner text yields suggestions only, not inferred approval', () => {
  const result = reconcilePilotOwnerReply('Aquarius Manzana precio $2000 stock 4 publicar sí\n'
    + 'Coca-Cola Original y Coca-Cola Zero: sí, esos dos', template);
  assert.equal(result.approvalCreated, false);
  assert.equal(result.suggestions.length, 1);
  assert.deepEqual(result.suggestions[0], {
    sku: 'aquarius-manzana-1500ml', line: 1, priceCandidate: '2000',
    stockCandidate: '4', publishCandidate: true, requiresHumanInterpretation: true,
  });
  assert.deepEqual(result.unresolved, [{ line: 2, reason: 'MULTIPLE_PRODUCTS' }]);
});
