// Read-only public smoke for an already deployed, isolated commercial PILOT.
// Never defaults to Staging or Production; requires the owner's approved SKU list.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { resolveRuntimeConfig } from '../../js/core/runtime-config.js';
import { resolveCatalogImageUrl } from '../../js/core/catalog-image-contract.js';
import { foreignPublicTenants, publicCatalogTenants } from '../controlled-production/qa-window.mjs';

const KNOWN_REFS = new Set([
  'ucbtjcurawxjwjdvvcvj', // Staging QA
  'wwcpogltfgzgkrlilbcd', // Production
  'yakhtrkukqlgzvxuvhzs', // DEMO
]);
const KNOWN_HOSTS = new Set(['la-taba.pages.dev', 'taba2-staging.pages.dev']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validatePilotTarget({ origin, ref, businessId, runtime }) {
  const url = new URL(origin);
  assert.equal(url.protocol, 'https:', 'PILOT_HTTPS_REQUIRED');
  assert.equal(url.pathname, '/', 'PILOT_ORIGIN_ONLY');
  assert.ok(!url.search && !url.hash && !url.username && !url.password, 'PILOT_ORIGIN_ONLY');
  assert.ok(!KNOWN_HOSTS.has(url.hostname), 'PILOT_HOST_MUST_BE_ISOLATED');
  assert.equal(url.hostname, 'la-taba-commercial-pilot.pages.dev',
    'PILOT_HOST_MUST_BE_DEDICATED_PROJECT');
  assert.match(ref, /^[a-z0-9]{20}$/, 'PILOT_REF_REQUIRED');
  assert.ok(!KNOWN_REFS.has(ref), 'PILOT_REF_MUST_BE_ISOLATED');
  assert.match(businessId, UUID, 'PILOT_BUSINESS_ID_REQUIRED');
  const resolved = resolveRuntimeConfig(runtime);
  assert.ok(resolved.isProductionReady, 'PILOT_RUNTIME_INVALID');
  assert.equal(resolved.repository.deploymentEnvironment, 'pilot', 'NOT_PILOT_RUNTIME');
  assert.equal(resolved.repository.supabaseUrl, `https://${ref}.supabase.co`, 'PILOT_REF_MISMATCH');
  assert.equal(resolved.repository.businessId, businessId, 'PILOT_BUSINESS_MISMATCH');
  return url.origin;
}

const SKU = /^[a-z0-9][a-z0-9-]{2,100}$/;
const IMAGE_PATH = /^assets\/[A-Za-z0-9_./-]+$/;

/**
 * El catálogo que ve el público en modo `live`: el que publicó el dueño, con 0
 * productos o con 46. No se compara contra una lista; se exige que cada producto
 * visible sea vendible de verdad (precio, stock y foto) y que las rutas de imagen
 * sean las del repo o las del pipeline de imágenes, nunca una URL arbitraria.
 */
export function assertLivePublicCatalog(products) {
  assert.ok(Array.isArray(products), 'PUBLIC_CATALOG_UNREADABLE');
  for (const row of products) {
    assert.match(String(row?.sku || ''), SKU, 'PUBLIC_SKU_INVALID');
    assert.ok(Number(row.price) > 0, `PUBLIC_PRODUCT_WITHOUT_PRICE:${row.sku}`);
    assert.ok(Number.isInteger(Number(row.stock)) && Number(row.stock) > 0, `PUBLIC_PRODUCT_WITHOUT_STOCK:${row.sku}`);
    assert.ok(IMAGE_PATH.test(String(row.image_url || '')) && !String(row.image_url).split('/').includes('..'),
      `PUBLIC_PRODUCT_IMAGE_INVALID:${row.sku}`);
    assert.ok(row.image_thumbnail_url == null || (IMAGE_PATH.test(String(row.image_thumbnail_url))
      && !String(row.image_thumbnail_url).split('/').includes('..')), `PUBLIC_PRODUCT_THUMBNAIL_INVALID:${row.sku}`);
  }
  return { publicProducts: products.length };
}

/** Dónde carga el navegador una imagen: las del pipeline viven en Storage, las del repo en el sitio. */
export function browserImageUrl(imagePath, supabaseUrl) {
  const resolved = resolveCatalogImageUrl(imagePath, supabaseUrl);
  return /^https:\/\//.test(resolved) ? resolved : `/${imagePath}`;
}

function value(flag) {
  const index = process.argv.indexOf(flag);
  return index < 0 ? '' : process.argv[index + 1] || '';
}

async function main() {
  const origin = value('--origin');
  const ref = value('--project-ref');
  const businessId = value('--business-id');
  const approvedPath = value('--approved-skus-file');
  // Technical deployment before catalog approval: the exact allowlist is empty,
  // so ANY visible product fails the smoke. `live`: the store run by its owner;
  // every visible product must be sellable (see assertLivePublicCatalog).
  const mode = value('--catalog-mode');
  const techReady = mode === 'none';
  const live = mode === 'live';
  assert.ok(origin && ref && businessId && (techReady || live ? !approvedPath : approvedPath),
    'Usage: --origin <pilot-url> --project-ref <ref> --business-id <uuid> (--approved-skus-file <json> | --catalog-mode none|live)');
  let approval = { products: [] };
  if (!techReady && !live) {
    approval = JSON.parse(readFileSync(path.resolve(approvedPath), 'utf8'));
    assert.equal(approval.schemaVersion, 1, 'CATALOG_APPROVAL_SCHEMA_INVALID');
    assert.equal(approval.environment, 'pilot', 'CATALOG_APPROVAL_ENVIRONMENT_INVALID');
    assert.equal(approval.approval?.source, 'BUSINESS_OWNER', 'CATALOG_OWNER_APPROVAL_REQUIRED');
    assert.ok(approval.approval?.receivedAt && approval.approval?.evidenceRef
      && Array.isArray(approval.products), 'CATALOG_APPROVAL_INCOMPLETE');
    assert.ok(approval.products.every((item) => item.publish !== true
      || item.identityAndImageApproved === true), 'CATALOG_IMAGE_APPROVAL_INCOMPLETE');
  }
  const published = approval.products.filter((item) => item.publish === true
    && item.identityAndImageApproved === true).map((item) => item.sku);
  const approvedBySku = new Map(approval.products.map((item) => [item.sku, item]));
  const expected = new Set(published);
  assert.ok(techReady || live ? expected.size === 0
    : expected.size >= 5 && expected.size <= 10 && expected.size === published.length,
  'PILOT_APPROVED_SKU_COUNT_INVALID');
  assert.ok([...expected].every((sku) => /^[a-z0-9][a-z0-9-]{2,100}$/.test(sku)),
    'PILOT_APPROVED_SKU_INVALID');

  const response = await fetch(`${origin.replace(/\/$/, '')}/runtime-config.js`, {
    cache: 'no-store', signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.status, 200, 'PILOT_PUBLIC_RUNTIME_UNAVAILABLE');
  const sandbox = { globalThis: {} };
  vm.runInNewContext(await response.text(), sandbox, { timeout: 1000 });
  const runtime = sandbox.globalThis.__LA_TABA_RUNTIME_CONFIG__;
  const safeOrigin = validatePilotTarget({ origin, ref, businessId, runtime });
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(`https://${ref}.supabase.co`, runtime.repository.publishableKey,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const listed = await client.from('products')
    .select('sku,image_url,image_thumbnail_url,price,stock')
    .eq('business_id', businessId).eq('is_active', true).eq('available', true).eq('is_verified', true);
  assert.ifError(listed.error);
  const products = listed.data || [];
  if (live) {
    assertLivePublicCatalog(products);
  } else {
    assert.deepEqual(products.map((row) => row.sku).sort(), [...expected].sort(),
      'PUBLIC_CATALOG_DIFFERS_FROM_OWNER_APPROVAL');
    assert.ok(products.every((row) => Number(row.price) > 0
      && Number(row.price) === Number(approvedBySku.get(row.sku)?.price)
      && Number(row.stock) > 0
      && row.image_url === approvedBySku.get(row.sku)?.image),
    'PUBLIC_PRICE_STOCK_OR_IMAGE_DIFFERS_FROM_APPROVAL');
  }
  // Only the real business may have a public catalog: an open QA tenant in the
  // same database exposes its QA products and takes anonymous orders.
  const foreign = foreignPublicTenants(await publicCatalogTenants(client), businessId);
  assert.deepEqual(foreign, [], 'PUBLIC_CATALOG_OF_ANOTHER_TENANT_VISIBLE');
  const images = [...new Set(products.flatMap((row) => [row.image_url, row.image_thumbnail_url]).filter(Boolean))];
  assert.ok(images.every((image) => typeof image === 'string'
    && /^assets\/[A-Za-z0-9_./-]+$/.test(image) && !image.split('/').includes('..')),
  'PUBLIC_IMAGE_PATH_INVALID');

  const { chromium, webkit, devices } = await import('@playwright/test');
  const browserResults = {};
  // Desktop panel, Chrome on Android and Safari on iPhone: the three surfaces
  // customers and the business actually use.
  for (const [name, engine, device] of [['chromium', chromium, {}],
    ['chrome_android', chromium, devices['Pixel 7']], ['webkit', webkit, devices['iPhone 13']]]) {
    const browser = await engine.launch({ headless: true });
    try {
      const context = await browser.newContext({ ...device, serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(safeOrigin, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      const imageFailures = await page.evaluate(async (paths) => {
        const failures = [];
        for (const file of paths) {
          const image = new Image();
          image.src = file;
          try {
            await Promise.race([
              image.decode(),
              new Promise((_, reject) => setTimeout(() => reject(Error('IMAGE_TIMEOUT')), 20_000)),
            ]);
          } catch { failures.push(file); }
        }
        return failures;
      }, images.map((image) => browserImageUrl(image, `https://${ref}.supabase.co`)));
      await page.goto(`${safeOrigin}/#business`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      assert.deepEqual(errors, [], `${name.toUpperCase()}_PAGE_ERROR`);
      assert.deepEqual(imageFailures, [], `${name.toUpperCase()}_CATALOG_IMAGE_ERROR`);
      browserResults[name] = 'PASS';
      await context.close();
    } finally {
      await browser.close();
    }
  }
  console.log(JSON.stringify({ pilotPublicSmoke: 'PASS', catalogMode: techReady ? 'none' : live ? 'live' : 'approved', origin: safeOrigin, ref,
    businessId, approvedProducts: products.length, images: images.length, browsers: browserResults }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`PILOT_SMOKE_FAIL:${error.message}`);
    process.exitCode = 1;
  });
}
