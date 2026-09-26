// Initial commercial PILOT import. The committed template cannot pass its gate.
// Only a separate owner-approved copy may stage products, using existing RPCs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSheetPrice, parseSheetStock } from './import-commercial-catalog.mjs';
import { applyCatalogImport, mapCatalogProduct } from './import-product-catalog.mjs';
import { findManifestSource } from './catalog-images/lib.mjs';
import { leerSecreto } from './e2e-production-sale/secretos-windows.mjs';
import { GONDOLA } from '../catalog/gondola-neuquen.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const REF_PATTERN = /^[a-z0-9]{20}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BLOCKED_REFS = new Set(['ucbtjcurawxjwjdvvcvj', 'wwcpogltfgzgkrlilbcd', 'yakhtrkukqlgzvxuvhzs']);
const BLOCKED_BUSINESSES = new Set(['a57b1c20-0f4e-4a6b-9d31-7c2e5f8a41d0',
  '00000000-0000-4000-8000-000000000001']);
export const PROPOSED_PILOT_SKUS = Object.freeze([
  'benedictino-sin-gas-2250ml', 'villa-del-sur-sin-gas-600ml',
  'aquarius-manzana-1500ml', 'coca-cola-original-2250ml',
  'coca-cola-zero-2250ml', 'fanta-naranja-2250ml',
  'sprite-original-2250ml', 'pepsi-original-2000ml',
  'seven-up-original-2000ml', 'red-bull-original-250ml',
]);

// stage_catalog_products requires a non-empty subcategory. The historical
// snapshot has none; the repo's gondola taxonomy is the technical source.
const SUBCATEGORY_BY_SKU = new Map(GONDOLA.filter((item) => item?.sku && item.subcategory)
  .map((item) => [item.sku, item.subcategory]));

export function assertPilotIdentity(projectRef, businessId) {
  assert.ok(REF_PATTERN.test(projectRef) && !BLOCKED_REFS.has(projectRef),
    'PILOT_BACKEND_MUST_BE_NEW_AND_ISOLATED');
  assert.ok(UUID_PATTERN.test(businessId) && !BLOCKED_BUSINESSES.has(businessId.toLowerCase()),
    'PILOT_BUSINESS_MUST_BE_NEW_AND_ISOLATED');
}

// Assisted reconciliation only: it never marks an item approved or writes an
// approval file. Lines with multiple/no unique product matches remain manual.
export function reconcilePilotOwnerReply(text, template) {
  const aliases = new Map([
    ['benedictino-sin-gas-2250ml', ['benedictino']],
    ['villa-del-sur-sin-gas-600ml', ['villa del sur']],
    ['aquarius-manzana-1500ml', ['aquarius manzana']],
    ['coca-cola-original-2250ml', ['coca cola original', 'coca cola 2 25']],
    ['coca-cola-zero-2250ml', ['coca cola zero']],
    ['fanta-naranja-2250ml', ['fanta naranja']],
    ['sprite-original-2250ml', ['sprite original', 'sprite 2 25']],
    ['pepsi-original-2000ml', ['pepsi original', 'pepsi 2 l']],
    ['seven-up-original-2000ml', ['7up', '7 up']],
    ['red-bull-original-250ml', ['red bull original', 'red bull 250']],
  ]);
  const suggestions = [];
  const unresolved = [];
  for (const [index, raw] of String(text || '').split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    const folded = ` ${foldedLine(line)} `;
    const matches = (template?.products || []).filter((item) =>
      line.toLowerCase().includes(item.sku)
      || (aliases.get(item.sku) || []).some((alias) => folded.includes(` ${alias} `)));
    if (matches.length !== 1) {
      unresolved.push({ line: index + 1, reason: matches.length ? 'MULTIPLE_PRODUCTS' : 'NO_UNIQUE_PRODUCT' });
      continue;
    }
    const priceText = line.match(/\bprecio\s*[:=]?\s*\$?\s*([0-9][0-9.,]*)/i)?.[1] || null;
    const stockText = line.match(/\bstock\s*[:=]?\s*([0-9]+)/i)?.[1] || null;
    const publication = folded.match(/\bpublicar\s+(si|no)\b/)?.[1] || null;
    suggestions.push({ sku: matches[0].sku, line: index + 1,
      priceCandidate: priceText, stockCandidate: stockText,
      publishCandidate: publication ? /^s/i.test(publication) : null,
      requiresHumanInterpretation: true });
  }
  return { suggestions, unresolved, approvalCreated: false };
}

function foldedLine(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function buildPilotCatalogPlan(approval, { projectRef, businessId, snapshot,
  imageManifest, fileExists = existsSync, readAsset = readFileSync } = {}) {
  assertPilotIdentity(projectRef, businessId);
  assert.equal(approval?.schemaVersion, 1, 'PILOT_APPROVAL_SCHEMA_REQUIRED');
  assert.equal(approval?.environment, 'pilot', 'PILOT_APPROVAL_ENVIRONMENT_REQUIRED');
  assert.equal(approval?.approval?.source, 'BUSINESS_OWNER', 'EXPLICIT_OWNER_APPROVAL_REQUIRED');
  assert.ok(Number.isFinite(Date.parse(approval?.approval?.receivedAt)),
    'OWNER_APPROVAL_TIMESTAMP_REQUIRED');
  assert.ok(typeof approval?.approval?.evidenceRef === 'string'
    && approval.approval.evidenceRef.trim().length >= 8,
  'PRIVATE_APPROVAL_EVIDENCE_REFERENCE_REQUIRED');
  assert.ok(Array.isArray(approval.products) && approval.products.length === 10,
    'TEN_HISTORICAL_CANDIDATES_REQUIRED');
  assert.deepEqual(approval.products.map((item) => item.sku).sort(), [...PROPOSED_PILOT_SKUS].sort(),
    'PILOT_CANDIDATES_DIFFER_FROM_REVIEWED_TEN');
  const source = new Map((snapshot?.productos || []).map((item) => [item.sku, item]));
  const seen = new Set();
  const entries = [];
  for (const proposal of approval.products) {
    const sku = proposal?.sku;
    assert.ok(typeof sku === 'string' && !seen.has(sku), 'DUPLICATE_OR_MISSING_SKU');
    seen.add(sku);
    const historical = source.get(sku);
    assert.ok(historical, `UNKNOWN_HISTORICAL_SKU:${sku}`);
    // The owner approved the reviewed identity. A changed photo/name/category
    // needs a separate audited asset and product review, never silent import.
    assert.equal(proposal.name, historical.name, `NAME_CHANGED_REQUIRES_NEW_REVIEW:${sku}`);
    assert.equal(proposal.category, historical.category, `CATEGORY_CHANGED_REQUIRES_NEW_REVIEW:${sku}`);
    assert.equal(proposal.image, historical.imageUrl, `IMAGE_CHANGED_REQUIRES_NEW_REVIEW:${sku}`);
    assert.ok(proposal.publish === true || proposal.publish === false || proposal.publish === null,
      `EXPLICIT_PUBLISH_DECISION_REQUIRED:${sku}`);
    if (proposal.publish !== true) continue;
    assert.equal(proposal.identityAndImageApproved, true, `IDENTITY_IMAGE_APPROVAL_REQUIRED:${sku}`);
    const price = parseSheetPrice(proposal.price);
    const stock = parseSheetStock(proposal.stock);
    assert.ok(price.value > 0 && !price.error && !price.empty, `CURRENT_PRICE_REQUIRED:${sku}`);
    assert.ok(stock.value > 0 && !stock.error && !stock.empty, `POSITIVE_INITIAL_STOCK_REQUIRED:${sku}`);
    const description = typeof proposal.description === 'string' ? proposal.description.trim() : '';
    assert.ok(description.length >= 3 && description.length <= 280 && !/[\x00-\x1f]/.test(description),
      `APPROVED_DESCRIPTION_REQUIRED:${sku}`);
    assert.equal(historical.isAlcoholic, false, `ALCOHOL_OUTSIDE_PILOT_SCOPE:${sku}`);
    const asset = findManifestSource(imageManifest, historical.externalId, sku);
    assert.ok(asset && asset.rightsStatus === 'LICENCIA_COMERCIAL', `LICENSED_IMAGE_REQUIRED:${sku}`);
    assert.equal(asset.assets?.master?.path, proposal.image, `IMAGE_BINDING_MISMATCH:${sku}`);
    for (const part of [asset.assets.master, asset.assets.thumbnail]) {
      const absolute = path.resolve(ROOT, part.path);
      assert.ok(absolute.startsWith(path.join(ROOT, 'assets', 'products') + path.sep)
        && fileExists(absolute), `IMAGE_FILE_MISSING:${sku}`);
      assert.equal(createHash('sha256').update(readAsset(absolute)).digest('hex'), part.sha256,
        `IMAGE_HASH_MISMATCH:${sku}`);
    }
    const subcategory = SUBCATEGORY_BY_SKU.get(sku);
    assert.ok(subcategory, `TAXONOMY_SUBCATEGORY_REQUIRED:${sku}`);
    const mapped = mapCatalogProduct({
      external_id: historical.externalId, sku, brand: historical.brand,
      name: historical.name, variant: historical.variant, category: historical.category,
      subcategory, capacity_value: historical.capacityValue,
      capacity_unit: historical.capacityUnit, package_type: historical.packagingType,
      units_per_pack: historical.unitsPerPack, price: price.value, stock: stock.value,
      chilled: false, alcoholic: false, minimum_age: '', featured: false,
      tags: '', sort_order: entries.length + 1, available: true,
    }, businessId, asset);
    mapped.row.description = description;
    entries.push(mapped);
  }
  assert.ok(entries.length >= 5 && entries.length <= 10, 'PILOT_NEEDS_5_TO_10_EXPLICIT_PRODUCTS');
  return { errors: [], entries, businessId, projectRef,
    approvedSkus: entries.map((entry) => entry.row.sku),
    approvalEvidenceRef: approval.approval.evidenceRef };
}

function jwtPayload(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); }
  catch { return null; }
}

export function readPilotOwnerCredentials(projectRef, { requireOwnerToken = true } = {}) {
  const key = leerSecreto('PILOT SUPABASE PUBLISHABLE KEY');
  assert.ok(key?.usuario === projectRef && key.secreto?.startsWith('sb_publishable_'),
    'PILOT_PUBLIC_KEY_MISSING_OR_WRONG_PROJECT');
  if (!requireOwnerToken) return { publishableKey: key.secreto, accessToken: null };
  const owner = leerSecreto('PILOT OWNER ACCESS TOKEN');
  assert.ok(owner?.usuario === projectRef && owner.secreto, 'PILOT_OWNER_SESSION_MISSING');
  const jwt = jwtPayload(owner.secreto);
  assert.ok(jwt?.role === 'authenticated' && jwt.exp > Date.now() / 1000
    && jwt.iss === `https://${projectRef}.supabase.co/auth/v1`,
  'PILOT_OWNER_SESSION_WRONG_PROJECT_OR_EXPIRED');
  return { publishableKey: key.secreto, accessToken: owner.secreto };
}

export async function applyPilotCatalog(client, plan) {
  const existing = await client.from('products').select('sku,available,catalog_origin')
    .eq('business_id', plan.businessId);
  assert.ifError(existing.error);
  const before = existing.data || [];
  if (before.length) {
    assert.deepEqual(before.map((row) => row.sku).sort(), [...plan.approvedSkus].sort(),
      'PILOT_EXISTING_CATALOG_MUST_BE_ONLY_THIS_ALLOWLIST');
    assert.ok(before.every((row) => row.available === false
      && row.catalog_origin === 'commercial'), 'PILOT_RETRY_REQUIRES_HIDDEN_COMMERCIAL_ROWS');
  }
  await applyCatalogImport(client, plan); // One RPC transaction, all rows hidden.
  const published = [];
  try {
    for (const entry of plan.entries) {
      const verified = await client.rpc('publish_catalog_product', {
        p_business_id: plan.businessId, p_external_id: entry.row.external_id, p_available: false,
      });
      assert.ifError(verified.error);
      const row = Array.isArray(verified.data) ? verified.data[0] : verified.data;
      assert.ok(row?.published_is_verified && row?.published_available === false
        && row?.published_sku === entry.row.sku, `PILOT_PUBLICATION_FAILED:${entry.row.sku}`);
      // Current backend separates verification from merchant availability.
      // This RPC sets merchant_available=true even after a compensated retry.
      const offered = await client.rpc('set_commercial_product_publication', {
        p_business_id: plan.businessId, p_sku: entry.row.sku, p_publish: true,
      });
      assert.ifError(offered.error);
      const visibleRow = Array.isArray(offered.data) ? offered.data[0] : offered.data;
      assert.ok(visibleRow?.applied_sku === entry.row.sku
        && visibleRow?.applied_available === true
        && visibleRow?.applied_is_verified === true,
      `PILOT_PUBLICATION_FAILED:${entry.row.sku}`);
      published.push(entry.row.external_id);
    }
    const visible = await client.from('products').select('sku').eq('business_id', plan.businessId)
      .eq('is_active', true).eq('available', true).eq('is_verified', true);
    assert.ifError(visible.error);
    assert.deepEqual((visible.data || []).map((row) => row.sku).sort(), [...plan.approvedSkus].sort(),
      'PILOT_PUBLIC_CATALOG_NOT_EXACT_ALLOWLIST');
  } catch (error) {
    // Compensate with the supported owner RPC; never force states by SQL.
    const compensationErrors = [];
    for (const entry of plan.entries) {
      const undone = await client.rpc('unpublish_catalog_product', {
        p_business_id: plan.businessId, p_external_id: entry.row.external_id,
      });
      if (undone.error) compensationErrors.push(entry.row.sku);
    }
    if (compensationErrors.length) throw new Error(`PILOT_PUBLICATION_AND_COMPENSATION_FAILED:${compensationErrors.join(',')}`, { cause: error });
    throw error;
  }
  return { staged: plan.entries.length, published: published.length };
}

function option(args, name) {
  const at = args.indexOf(name);
  return at < 0 ? '' : args[at + 1] || '';
}

async function main(args) {
  assert.ok(args.includes('--dry-run') !== args.includes('--apply'),
    'CHOOSE_EXACTLY_DRY_RUN_OR_APPLY');
  assert.equal(option(args, '--target'), 'pilot', 'EXPLICIT_PILOT_TARGET_REQUIRED');
  const projectRef = option(args, '--project-ref');
  const businessId = option(args, '--business-id');
  const file = option(args, '--approval');
  const configFile = option(args, '--config');
  assert.ok(file, 'APPROVAL_FILE_REQUIRED');
  const approval = JSON.parse(readFileSync(path.resolve(file), 'utf8'));
  const snapshot = JSON.parse(readFileSync(path.join(ROOT, 'catalog', 'production-catalog-snapshot.json')));
  const imageManifest = JSON.parse(readFileSync(path.join(ROOT, 'docs', 'catalog', 'image-manifest.json')));
  const plan = buildPilotCatalogPlan(approval, { projectRef, businessId, snapshot, imageManifest });
  if (args.includes('--dry-run')) {
    console.log(JSON.stringify({ pilotCatalogDryRun: 'PASS', projectRef, businessId,
      approvedSkus: plan.approvedSkus, writes: false }));
    return;
  }
  assert.ok(configFile, 'PILOT_PREFLIGHT_CONFIG_REQUIRED');
  const { loadPilotPreflight } = await import('./deploy/pilot-preflight.mjs');
  const preflight = loadPilotPreflight({ configFile, approvalFile: file, phase: 'catalog' });
  assert.deepEqual(preflight.plan.approvedSkus, plan.approvedSkus, 'PILOT_PREFLIGHT_PLAN_MISMATCH');
  const { publishableKey, accessToken } = preflight.ownerCredentials;
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(`https://${projectRef}.supabase.co`, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const user = await client.auth.getUser(accessToken);
  assert.ifError(user.error);
  assert.ok(user.data?.user?.id, 'PILOT_OWNER_AUTH_FAILED');
  const result = await applyPilotCatalog(client, plan);
  console.log(JSON.stringify({ pilotCatalogImport: 'PASS', projectRef,
    businessId, approvedSkus: plan.approvedSkus, ...result }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`PILOT_CATALOG_BLOCKED:${error.message}`);
    process.exitCode = 1;
  });
}
