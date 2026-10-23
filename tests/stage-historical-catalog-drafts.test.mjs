// Pure parts of scripts/recovery/stage-historical-catalog-drafts.mjs: target
// refusal, row -> draft mapping, category normalization, source-row hashing and
// the single staging transaction. No network, credentials or database.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  CANDIDATE_KEYS, DRAFT_TARGET_PROJECT_REF, EXPECTED_BACKUP_SHA256, EXPECTED_PRODUCT_ROWS, HISTORICAL_BUSINESS_ID,
  PRODUCT_SOURCE_KEYS, assertDraftTarget, buildDraftStagingSql, canonicalCategory, draftCandidates, extractReceipt,
  mapProductToDraft, offlinePlan, planAgainstExisting, sourcePayloadSha256, stageHistoricalDrafts, verifySourceRows,
} from '../scripts/recovery/stage-historical-catalog-drafts.mjs';
import { ROOT } from '../scripts/recovery/plan.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const target = { purpose: 'la-taba-recovery-test', projectName: 'la-taba-recovery-test', environment: 'test',
  commercialPaymentsEnabled: false, mercadoPagoApplicationId: '4861627125869370', projectRef: DRAFT_TARGET_PROJECT_REF,
  organizationId: 'tpdpuvnasszkcpdanxpk', organizationPlan: 'free', infrastructureBudgetUSD: 0, region: 'sa-east-1',
  createdAt: '2026-10-21T01:57:49.636323Z', checkoutOrigin: 'https://recovery-20261020.taba2-staging.pages.dev' };

// Same columns and order as data.products in the backup; values are synthetic.
function product(index, overrides = {}) {
  const beer = index % 3 === 0;
  return { id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    sku: beer ? `cerveza-rubia-${index}-lata-473ml` : `agua-mineral-${index}-500ml`,
    name: beer ? `Cerveza Rubia ${index}` : `Agua Mineral ${index}`, brand: 'Marca', presentation: beer ? 'Lager' : 'Sin gas',
    description: beer ? 'Cerveza en lata de 473 ml.' : 'Agua en botella PET de 500 ml.', category: beer ? 'Cervezas' : 'Aguas',
    price: '1234.00', price_status: 'confirmed', stock: 17, available: !beer, is_active: true, is_verified: true,
    is_alcoholic: beer, sort_order: index * 10, catalog_origin: 'commercial',
    created_at: '2026-08-18T02:09:17.961Z', updated_at: '2026-09-15T04:53:43.048Z', ...overrides };
}
// jsonb stores object keys by length, then bytewise: the payload comes back reordered.
const jsonbOrder = payload => Object.fromEntries(Object.entries(payload)
  .sort(([a], [b]) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)));
const products = Array.from({ length: EXPECTED_PRODUCT_ROWS }, (_, index) => product(index));
const sourceRows = products.map((payload, ordinal) => ({ backup_sha256: EXPECTED_BACKUP_SHA256, ordinal,
  payload: jsonbOrder(payload), row_sha256: sha(JSON.stringify(payload)) }));

test('refuses every target except the bound test recovery project, before any access', () => {
  assert.equal(assertDraftTarget(target), target);
  assertDraftTarget(JSON.parse(fs.readFileSync(path.join(ROOT, 'deploy/recovery-free-hosted.json'), 'utf8')));
  for (const patch of [{ environment: 'production' }, { environment: undefined }, { projectRef: 'wwcpogltfgzgkrlilbcd' },
    { projectRef: 'abcdefghijklmnopqrst' }, { commercialPaymentsEnabled: true }, { organizationPlan: 'pro' }]) {
    assert.throws(() => assertDraftTarget({ ...target, ...patch }));
  }
  assert.throws(() => assertDraftTarget(null));
});

test('maps identity only: historical price, stock, availability and verification never travel', () => {
  const water = mapProductToDraft(product(1, { name: "  Gordon's  ", brand: '', description: null }));
  assert.deepEqual(Object.keys(water).sort(), CANDIDATE_KEYS.filter(k => !['ordinal', 'row_sha256'].includes(k)).sort());
  assert.equal(water.name, "Gordon's");
  assert.equal(water.brand, null);
  assert.equal(water.description, null);
  assert.equal(water.external_id, water.sku);
  assert.equal(water.minimum_age, null);
  for (const key of ['price', 'price_status', 'stock', 'available', 'is_verified', 'is_active', 'sort_order', 'id', 'created_at']) {
    assert.equal(Object.hasOwn(water, key), false, key);
  }
  const beer = mapProductToDraft(product(3));
  assert.equal(beer.is_alcoholic, true);
  assert.equal(beer.minimum_age, 18, 'products_alcohol_requires_age applies even to hidden rows');
  assert.equal(beer.category, 'Cervezas');
});

test('category normalization accepts the live vocabulary and sends anything else to a human', () => {
  assert.equal(canonicalCategory('Isotónicas'), 'Isotónicas');
  assert.equal(canonicalCategory('isotonicas'), 'Isotónicas');
  assert.equal(canonicalCategory('Isotónicas'), 'Isotónicas'); // NFD accent
  assert.equal(canonicalCategory('  Aguas   saborizadas '), 'Aguas saborizadas');
  assert.equal(canonicalCategory('ALMACEN'), 'Almacén');
  assert.equal(canonicalCategory('Fernet y amargos'), 'Fernet'); // storefront display name
  assert.equal(canonicalCategory('Higiene personal'), 'Higiene personal');
  for (const value of ['', null, 'Energéticas', 'Vinos y espumantes', 'Promos', 'Bebidas raras']) {
    assert.throws(() => canonicalCategory(value), /human review/);
  }
});

test('refuses unstable or QA-looking SKUs, incoherent alcohol flags and nameless rows', () => {
  for (const patch of [{ sku: 'Agua-Mineral-500' }, { sku: 'qa-agua-500ml' }, { sku: 'agua-test-500ml' },
    { sku: 'ab' }, { name: ' ' }, { name: 'A' }, { name: 'Agua\u0007' }, { is_alcoholic: true }, { is_alcoholic: null },
    { category: 'Promos' }, { brand: 7 }]) {
    assert.throws(() => mapProductToDraft(product(1, patch)), undefined, JSON.stringify(patch));
  }
  assert.throws(() => mapProductToDraft(product(3, { is_alcoholic: false })), /disagree/);
  assert.throws(() => mapProductToDraft(null));
});

test('row hashes are checked in the backup column order even though jsonb reorders the keys', () => {
  assert.notEqual(JSON.stringify(sourceRows[0].payload), JSON.stringify(products[0]));
  assert.equal(sourcePayloadSha256(sourceRows[0].payload), sourceRows[0].row_sha256);
  const verified = verifySourceRows(sourceRows);
  assert.equal(verified.length, EXPECTED_PRODUCT_ROWS);
  assert.deepEqual(verified.map(row => row.ordinal), [...Array(EXPECTED_PRODUCT_ROWS).keys()]);
  assert.equal(verifySourceRows(sourceRows.map(row => ({ ...row, payload: JSON.stringify(row.payload) }))).length, EXPECTED_PRODUCT_ROWS);
  const tampered = sourceRows.map((row, i) => (i === 5 ? { ...row, payload: { ...row.payload, price: '1.00' } } : row));
  assert.throws(() => verifySourceRows(tampered), /SHA-256/);
  assert.throws(() => verifySourceRows(sourceRows.slice(1)), /Expected 72/);
  assert.throws(() => verifySourceRows(sourceRows.map(row => ({ ...row, backup_sha256: 'f'.repeat(64) }))), /unexpected backup/);
  assert.throws(() => verifySourceRows(sourceRows.map(row => ({ ...row, ordinal: 0 }))), /ordinals/);
  const extraColumn = { ...sourceRows[0], payload: { ...sourceRows[0].payload, unit_cost: '10.00' } };
  assert.throws(() => verifySourceRows([extraColumn, ...sourceRows.slice(1)]), /unexpected columns/);
  assert.equal(PRODUCT_SOURCE_KEYS.length, Object.keys(products[0]).length);
});

test('one transaction inserts hidden drafts, skips existing SKUs and proves nothing is sellable or public', () => {
  const candidates = draftCandidates(verifySourceRows(sourceRows));
  const sql = buildDraftStagingSql(candidates);
  assert.ok(sql.startsWith('begin;\n'));
  assert.ok(sql.endsWith('\ncommit;'));
  assert.equal(sql.match(/^begin;$/gm).length, 1);
  assert.equal(sql.match(/^commit;$/gm).length, 1);
  assert.match(sql, /pg_advisory_xact_lock\(1413562945, 21\)/);
  assert.match(sql, /on conflict \(business_id, sku\) do nothing/);
  assert.match(sql, /0, 'pending', null, null, true, false, false, false,\s+null, null, c\.is_alcoholic, c\.minimum_age, 'commercial'/);
  for (const code of ['RECOVERY_DRAFT_TARGET_MISMATCH', 'RECOVERY_DRAFT_SOURCE_CHANGED', 'RECOVERY_DRAFT_EXTERNAL_ID_COLLISION',
    'RECOVERY_DRAFT_STATE_MISMATCH', 'RECOVERY_DRAFT_SELLABLE_OR_VISIBLE', 'RECOVERY_DRAFT_VISIBLE_TO_PUBLIC']) {
    assert.ok(sql.includes(`raise exception '${code}`), code);
  }
  assert.match(sql, /set local role anon;[\s\S]+reset role;[\s\S]+set local role authenticated;[\s\S]+reset role;/);
  assert.ok(sql.includes(`'${HISTORICAL_BUSINESS_ID}'::uuid`));
  // The embedded candidates carry identity only and none of the historical commercial values.
  const literal = /jsonb_to_recordset\('((?:[^']|'')*)'::jsonb\)/.exec(sql)[1].replaceAll("''", "'");
  const embedded = JSON.parse(literal);
  assert.equal(embedded.length, EXPECTED_PRODUCT_ROWS);
  assert.ok(embedded.every(row => Object.keys(row).join() === CANDIDATE_KEYS.join()));
  assert.ok(!sql.includes('1234.00') && !sql.includes("'confirmed'") && !/available\s*=\s*true/.test(sql));
  const quoted = buildDraftStagingSql(candidates.map((c, i) => (i === 0 ? { ...c, name: "Gordon's London Dry" } : c)));
  assert.ok(quoted.includes("Gordon''s London Dry") && !quoted.includes("Gordon's London Dry"));
  assert.throws(() => buildDraftStagingSql(candidates.slice(1)));
  assert.throws(() => buildDraftStagingSql(candidates, { businessId: '00000000-0000-4000-8000-000000000002' }));
  assert.throws(() => buildDraftStagingSql(candidates, { projectRef: 'abcdefghijklmnopqrst' }));
  assert.throws(() => buildDraftStagingSql(candidates.map((c, i) => (i === 0 ? { ...c, price: '1234.00' } : c))), /unexpected field/);
  assert.throws(() => buildDraftStagingSql(candidates.map((c, i) => (i === 1 ? { ...c, sku: candidates[0].sku } : c))));
});

function fakeDatabase({ existing = [], receipt = true } = {}) {
  const calls = [];
  const query = async sql => {
    calls.push(sql);
    if (sql.startsWith('select project_ref')) return [{ project_ref: DRAFT_TARGET_PROJECT_REF }];
    if (sql.startsWith('select backup_sha256')) return sourceRows;
    if (sql.startsWith('select id, status')) return [{ id: HISTORICAL_BUSINESS_ID, status: 'paused', ordering_enabled: false, alcohol_sales_enabled: false }];
    if (sql.startsWith('select p.sku')) return existing;
    if (sql.startsWith('begin;')) {
      return receipt ? [{ recovery_draft_receipt: { inserted: EXPECTED_PRODUCT_ROWS - existing.length, skipped: existing.length,
        insertedSkus: [], publicProbe: { anon: 0, authenticated: 0 } } }] : [];
    }
    if (sql.startsWith('select count(*)::int as present')) return [{ present: EXPECTED_PRODUCT_ROWS, hidden_drafts: EXPECTED_PRODUCT_ROWS, sellable_or_visible: 0 }];
    throw new Error(`unexpected SQL: ${sql.slice(0, 40)}`);
  };
  return { calls, query };
}

test('dry run only reads; --apply sends exactly one write transaction and re-checks the result', async () => {
  const dry = fakeDatabase();
  const { report } = await stageHistoricalDrafts({ target, query: dry.query });
  assert.equal(report.mode, 'dry-run');
  assert.equal(report.wouldInsert, EXPECTED_PRODUCT_ROWS);
  assert.equal(report.sqlBytes > 0 && report.transactions, 1);
  assert.ok(dry.calls.every(sql => sql.startsWith('select ') && !/\binsert\b|\bupdate\b|\bdelete\b/i.test(sql)));

  const skipped = { sku: products[0].sku, external_id: products[0].sku, name: 'Otro nombre', available: false, is_verified: false };
  const live = fakeDatabase({ existing: [skipped] });
  const { report: applied } = await stageHistoricalDrafts({ target, query: live.query, apply: true });
  assert.equal(live.calls.filter(sql => sql.startsWith('begin;')).length, 1);
  assert.equal(live.calls.filter(sql => !sql.startsWith('select ')).length, 1);
  assert.equal(applied.inserted, EXPECTED_PRODUCT_ROWS - 1);
  assert.equal(applied.skipped, 1);
  assert.deepEqual(applied.skippedWithDifferentName, [products[0].sku]);
  assert.equal(applied.receiptSource, 'transaction');
  assert.deepEqual(applied.publicProbe, { anon: 0, authenticated: 0 });

  const silent = fakeDatabase({ receipt: false });
  const { report: fallback } = await stageHistoricalDrafts({ target, query: silent.query, apply: true });
  assert.equal(fallback.receiptSource, 'post-check');
  assert.equal(fallback.inserted, EXPECTED_PRODUCT_ROWS);
});

test('apply refuses before writing when a SKU is already sellable or an external id collides', async () => {
  for (const existing of [
    [{ sku: products[2].sku, external_id: products[2].sku, name: products[2].name, available: true, is_verified: true }],
    [{ sku: 'otro-producto-500ml', external_id: products[4].sku, name: 'Otro', available: false, is_verified: false }],
  ]) {
    const db = fakeDatabase({ existing });
    const { report } = await stageHistoricalDrafts({ target, query: db.query });
    assert.equal(report.externalIdCollisions.length + report.existingSellableOrVisible.length, 1);
    const refused = fakeDatabase({ existing });
    await assert.rejects(() => stageHistoricalDrafts({ target, query: refused.query, apply: true }), /Refusing to apply/);
    assert.equal(refused.calls.some(sql => sql.startsWith('begin;')), false);
  }
  await assert.rejects(() => stageHistoricalDrafts({ target: { ...target, environment: 'staging' }, query: async () => [] }));
  const wrongMarker = { query: async () => [{ project_ref: 'abcdefghijklmnopqrst' }] };
  await assert.rejects(() => stageHistoricalDrafts({ target, ...wrongMarker }), /receipt mismatch/);
});

test('receipt extraction tolerates the shapes the Management API may return', () => {
  const receipt = { inserted: 3 };
  assert.deepEqual(extractReceipt([{ recovery_draft_receipt: receipt }]), receipt);
  assert.deepEqual(extractReceipt([[], [{ recovery_draft_receipt: JSON.stringify(receipt) }]]), receipt);
  assert.equal(extractReceipt([]), null);
  assert.equal(extractReceipt({}), null);
  const plan = planAgainstExisting(draftCandidates(verifySourceRows(sourceRows)), null);
  assert.equal(plan.insert.length, EXPECTED_PRODUCT_ROWS);
});

test('the offline plan accepts only the reviewed backup bytes', () => {
  assert.throws(() => offlinePlan(Buffer.from(JSON.stringify({ data: { products } }))), /reviewed SHA-256/);
});
