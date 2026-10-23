// Stages the 72 recovered historical products as HIDDEN, non-purchasable drafts
// of the historical business in the hosted QA recovery project, so the Panel
// importer can later match Walter's spreadsheet by SKU.
//
//   node scripts/recovery/stage-historical-catalog-drafts.mjs            dry run: reads only, prints the plan
//   node scripts/recovery/stage-historical-catalog-drafts.mjs --apply    ONE transaction
//   node scripts/recovery/stage-historical-catalog-drafts.mjs --offline-backup <backup.json> [--sql-out <file>]
//                                                                         no credentials, no network: builds the
//                                                                         same SQL from the local backup for review
//
// DRAFT STATE (the same one catalog_admin.import_pending_catalog gives the CP
// drafts in 20260927004347, and close to apply_commercial_catalog_plan):
//   is_active=true          the commercial batch refuses to publish inactive rows; is_active alone exposes nothing
//   available=false         purchasable only through products_available_requires_verification
//   merchant_available=false  the first publication turns it on (20260928160000)
//   is_verified=false       both public SELECT policies require is_verified, so anon/authenticated never see it
//   price=0, price_status='pending'  price is NOT NULL but its CHECK is price >= 0: no expired price is copied
//   stock=null, unit_cost=null       unknown, not counted; nothing historical enters the commercial circuit
//   catalog_origin='commercial', no image, variant/capacity null (sizes are only suggestions in the workbook)
//   minimum_age=18 only for alcohol: products_alcohol_requires_age is a CHECK even on hidden rows
// The historical price, stock and availability remain ONLY in
// private.la_taba_recovery_source_rows and, labelled as expired reference, in
// Walter's workbook.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, assertRecoveryTarget, sha256 } from './plan.mjs';
import { STORE_CATEGORIES, slugifyCategoryName } from '../../js/core/store-taxonomy.js';

export const DRAFT_TARGET_PROJECT_REF = 'ixewllzzuzpqrkxzmfzx';
export const HISTORICAL_BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
export const EXPECTED_BACKUP_SHA256 = '6983957294de53c7cb3c59ba7aefcc605d2bfb2673b0c5288b6568322b231219';
export const EXPECTED_PRODUCT_ROWS = 72;
export const DEFAULT_TARGET = 'deploy/recovery-free-hosted.json';
// Column order of data.products in the backup: quarantineSql hashed
// JSON.stringify(payload) in this order, while jsonb returns keys reordered.
export const PRODUCT_SOURCE_KEYS = Object.freeze(['id', 'sku', 'name', 'brand', 'presentation', 'description',
  'category', 'price', 'price_status', 'stock', 'available', 'is_active', 'is_verified', 'is_alcoholic',
  'sort_order', 'catalog_origin', 'created_at', 'updated_at']);
export const DRAFT_STATE = Object.freeze({ is_active: true, available: false, merchant_available: false,
  is_verified: false, price: 0, price_status: 'pending', stock: null, unit_cost: null, catalog_origin: 'commercial' });
export const CANDIDATE_KEYS = Object.freeze(['ordinal', 'row_sha256', 'sku', 'external_id', 'name', 'brand',
  'presentation', 'description', 'category', 'is_alcoholic', 'minimum_age']);

const ADVISORY_LOCK = '1413562945, 21'; // bootstrap-hosted uses (1413562945, 20)
const SKU_PATTERN = /^[a-z0-9][a-z0-9-]{2,79}$/;
// Same refusal as apply_commercial_catalog_batch / _plan: the batch would reject these later anyway.
const QA_LOOKING_SKU = /(-staging-only$)|(^qa[-_])|(\bqa\b)|(\b(test|prueba|sintetica|sintetico|synthetic|fixture|dummy)\b)/i;
const LINE_CONTROL = /[\u0000-\u001f\u007f]/;
const TEXT_CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;
const ALCOHOLIC_CATEGORY_NAMES = new Set(STORE_CATEGORIES.filter(entry => entry.alcoholic).map(entry => entry.name));
const LIVE_CATEGORY_BY_SLUG = new Map(STORE_CATEGORIES.flatMap(entry => [
  [entry.id, entry.name], [slugifyCategoryName(entry.name), entry.name], [slugifyCategoryName(entry.displayName), entry.name],
]));
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";

export function assertDraftTarget(target) {
  if (!target || typeof target !== 'object' || target.environment !== 'test' || target.projectRef !== DRAFT_TARGET_PROJECT_REF) {
    throw new Error(`Refusing: historical drafts are staged only in the test recovery project ${DRAFT_TARGET_PROJECT_REF}`);
  }
  assertRecoveryTarget(target); // Full receipt contract: Free org, test payments only, bound origin.
  return target;
}

// Exact live store name, or the live name whose slug matches (accents, case,
// spacing: the same transformation the storefront applies to products.category).
// Legacy names (Energéticas, Vinos y espumantes, …) and unknown ones need a human.
export function canonicalCategory(value) {
  const text = String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('Category is empty and needs human review');
  const name = LIVE_CATEGORY_BY_SLUG.get(slugifyCategoryName(text));
  if (!name) throw new Error(`Category "${text.slice(0, 60)}" is not in the live store vocabulary and needs human review`);
  return name;
}

function cleanText(value, field, { required = false, min = 1, max = 160, multiline = false } = {}) {
  if (value === null || value === undefined) {
    if (required) throw new Error(`Recovered product ${field} is missing`);
    return null;
  }
  if (typeof value !== 'string') throw new Error(`Recovered product ${field} must be text`);
  const text = value.normalize('NFC').trim();
  if (!text) {
    if (required) throw new Error(`Recovered product ${field} is empty`);
    return null;
  }
  if (text.length < min || text.length > max || (multiline ? TEXT_CONTROL : LINE_CONTROL).test(text)) {
    throw new Error(`Recovered product ${field} has an invalid length or control characters`);
  }
  return text;
}

// Identity only. Price, stock, availability, verification, sort order and
// timestamps of the payload are deliberately never read.
export function mapProductToDraft(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Recovered product must be an object');
  const sku = cleanText(payload.sku, 'sku', { required: true, max: 80 });
  if (!SKU_PATTERN.test(sku)) throw new Error(`Unstable SKU "${sku}": lowercase letters, digits and dashes only`);
  if (QA_LOOKING_SKU.test(sku)) throw new Error(`Refusing a QA-looking SKU in the commercial catalog: ${sku}`);
  const name = cleanText(payload.name, 'name', { required: true, min: 2, max: 160 });
  const category = canonicalCategory(payload.category);
  if (typeof payload.is_alcoholic !== 'boolean') throw new Error(`SKU ${sku}: is_alcoholic must be an explicit boolean`);
  if (payload.is_alcoholic !== ALCOHOLIC_CATEGORY_NAMES.has(category)) {
    throw new Error(`SKU ${sku}: category ${category} and is_alcoholic=${payload.is_alcoholic} disagree`);
  }
  return Object.freeze({
    sku, external_id: sku, name,
    brand: cleanText(payload.brand, 'brand', { max: 120 }),
    presentation: cleanText(payload.presentation, 'presentation', { max: 160 }),
    description: cleanText(payload.description, 'description', { max: 2000, multiline: true }),
    category, is_alcoholic: payload.is_alcoholic,
    minimum_age: payload.is_alcoholic ? 18 : null, // Legal minimum (Ley 24.788), same default as every catalog import.
  });
}

export function sourcePayloadSha256(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Recovered product payload must be an object');
  const keys = Object.keys(payload);
  if (keys.length !== PRODUCT_SOURCE_KEYS.length || !PRODUCT_SOURCE_KEYS.every(key => Object.hasOwn(payload, key))) {
    throw new Error('Recovered product payload has unexpected columns');
  }
  return sha256(JSON.stringify(Object.fromEntries(PRODUCT_SOURCE_KEYS.map(key => [key, payload[key]]))));
}

export const sourceRowsDigest = verified => sha256(verified.map(row => row.rowSha256).join('\n'));

export function verifySourceRows(rows, { backupSha256 = EXPECTED_BACKUP_SHA256, expectedRows = EXPECTED_PRODUCT_ROWS } = {}) {
  if (!Array.isArray(rows)) throw new Error('Recovery source rows must be an array');
  if (rows.some(row => row?.backup_sha256 !== backupSha256)) throw new Error('Recovery source rows come from an unexpected backup');
  if (rows.length !== expectedRows) throw new Error(`Expected ${expectedRows} recovered products, found ${rows.length}`);
  const ordinals = new Set(), skus = new Set();
  return rows.map(row => {
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    const ordinal = Number(row.ordinal);
    if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= expectedRows || ordinals.has(ordinal)) {
      throw new Error('Recovery source rows have missing or repeated ordinals');
    }
    ordinals.add(ordinal);
    if (!/^[a-f0-9]{64}$/.test(row.row_sha256 || '') || sourcePayloadSha256(payload) !== row.row_sha256) {
      throw new Error(`Recovered product row ${ordinal} does not match its recorded SHA-256`);
    }
    if (skus.has(payload.sku)) throw new Error(`Recovered SKU ${payload.sku} is duplicated`);
    skus.add(payload.sku);
    return { ordinal, rowSha256: row.row_sha256, payload };
  }).sort((a, b) => a.ordinal - b.ordinal);
}

export function draftCandidates(verified) {
  return verified.map(({ ordinal, rowSha256, payload }) => ({ ordinal, row_sha256: rowSha256, ...mapProductToDraft(payload) }));
}

// Mirrors quarantineSql: ordinal = index in data.products, row hash over the backup's own key order.
export function sourceRowsFromBackup(bytes) {
  const digest = sha256(bytes);
  const products = JSON.parse(Buffer.from(bytes).toString('utf8'))?.data?.products;
  if (!Array.isArray(products)) throw new Error('Expected data.products in the La Taba partial backup');
  return { digest, rows: products.map((payload, ordinal) => ({ backup_sha256: digest, ordinal, payload,
    row_sha256: sha256(JSON.stringify(payload)) })) };
}

const skuArray = candidates => `array[${candidates.map(c => quote(c.sku)).join(',')}]::text[]`;
const DRAFT_PREDICATE = `p.is_active and not p.available and not p.merchant_available and not p.is_verified
       and p.price = 0 and p.price_status = 'pending' and p.stock is null and p.unit_cost is null
       and p.verified_at is null and p.verified_by is null and p.catalog_origin = 'commercial'
       and p.catalog_asset_id is null and p.image_url is null`;

export const SOURCE_ROWS_SQL = `select backup_sha256, ordinal, payload, row_sha256
from private.la_taba_recovery_source_rows where source_table = 'products' order by backup_sha256, ordinal`;
export const BUSINESS_SQL = `select id, status, ordering_enabled, ordering_verified, alcohol_sales_enabled
from public.businesses where id = ${quote(HISTORICAL_BUSINESS_ID)}::uuid`;
export function existingProductsSql(candidates) {
  return `select p.sku, p.external_id, p.name, p.is_active, p.available, p.merchant_available, p.is_verified, p.price_status
from public.products p where p.business_id = ${quote(HISTORICAL_BUSINESS_ID)}::uuid
  and (p.sku = any(${skuArray(candidates)}) or p.external_id = any(${skuArray(candidates)})) order by p.sku`;
}
export function postCheckSql(candidates) {
  return `select count(*)::int as present,
  count(*) filter (where ${DRAFT_PREDICATE})::int as hidden_drafts,
  count(*) filter (where p.available or p.is_verified)::int as sellable_or_visible
from public.products p where p.business_id = ${quote(HISTORICAL_BUSINESS_ID)}::uuid and p.sku = any(${skuArray(candidates)})`;
}

export function buildDraftStagingSql(candidates, { businessId = HISTORICAL_BUSINESS_ID, projectRef = DRAFT_TARGET_PROJECT_REF,
  backupSha256 = EXPECTED_BACKUP_SHA256, expectedRows = EXPECTED_PRODUCT_ROWS } = {}) {
  if (businessId !== HISTORICAL_BUSINESS_ID || projectRef !== DRAFT_TARGET_PROJECT_REF) {
    throw new Error('Historical drafts belong only to the historical business of the test recovery project');
  }
  if (!/^[a-f0-9]{64}$/.test(backupSha256)) throw new Error('A reviewed backup SHA-256 is required');
  if (!Array.isArray(candidates) || candidates.length !== expectedRows ||
    new Set(candidates.map(c => c.sku)).size !== expectedRows) throw new Error(`Exactly ${expectedRows} distinct draft candidates are required`);
  for (const candidate of candidates) {
    if (Object.keys(candidate).sort().join() !== [...CANDIDATE_KEYS].sort().join()) throw new Error('Draft candidate carries an unexpected field');
    if (!SKU_PATTERN.test(candidate.sku) || candidate.external_id !== candidate.sku) throw new Error('Draft candidate has an unstable identity');
  }
  const json = JSON.stringify(candidates.map(c => Object.fromEntries(CANDIDATE_KEYS.map(key => [key, c[key]]))));
  if (json.includes('\\u0000')) throw new Error('Draft candidates contain a NUL character');
  const biz = `${quote(businessId)}::uuid`, skus = skuArray(candidates), source = quote(backupSha256), n = expectedRows;
  return `begin;
set local statement_timeout = '60s';
set local lock_timeout = '10s';
select pg_advisory_xact_lock(${ADVISORY_LOCK});
create temporary table recovery_draft_candidates on commit drop as
select * from jsonb_to_recordset(${quote(json)}::jsonb) as c(
  ordinal integer, row_sha256 text, sku text, external_id text, name text, brand text,
  presentation text, description text, category text, is_alcoholic boolean, minimum_age integer);
create temporary table recovery_draft_inserted(sku text primary key) on commit drop;
create temporary table recovery_draft_public_probe(role_name text not null, visible integer not null) on commit drop;
do $recovery_draft_guard$
begin
  if (select project_ref from private.la_taba_recovery_target where singleton) is distinct from ${quote(projectRef)} then
    raise exception 'RECOVERY_DRAFT_TARGET_MISMATCH';
  end if;
  if not exists (select 1 from public.businesses where id = ${biz}) then
    raise exception 'RECOVERY_DRAFT_BUSINESS_MISSING';
  end if;
  if (select count(*) from recovery_draft_candidates) <> ${n}
     or (select count(distinct sku) from recovery_draft_candidates) <> ${n} then
    raise exception 'RECOVERY_DRAFT_CANDIDATE_COUNT';
  end if;
  -- The quarantined rows must be exactly the ones read and hashed before this transaction.
  if (select count(*) from private.la_taba_recovery_source_rows r where r.source_table = 'products') <> ${n}
     or (select count(*) from private.la_taba_recovery_source_rows r
          where r.source_table = 'products' and r.backup_sha256 = ${source}) <> ${n}
     or exists (select 1 from recovery_draft_candidates c
       left join private.la_taba_recovery_source_rows r on r.backup_sha256 = ${source}
        and r.source_table = 'products' and r.ordinal = c.ordinal
      where r.row_sha256 is distinct from c.row_sha256 or (r.payload ->> 'sku') is distinct from c.sku) then
    raise exception 'RECOVERY_DRAFT_SOURCE_CHANGED';
  end if;
  if exists (select 1 from public.products p join recovery_draft_candidates c
      on p.business_id = ${biz} and p.external_id = c.external_id
      where p.sku is distinct from c.sku) then
    raise exception 'RECOVERY_DRAFT_EXTERNAL_ID_COLLISION';
  end if;
end $recovery_draft_guard$;
with inserted as (
  insert into public.products (business_id, sku, external_id, name, brand, presentation, description, category,
    price, price_status, stock, unit_cost, is_active, available, merchant_available, is_verified,
    verified_at, verified_by, is_alcoholic, minimum_age, catalog_origin)
  select ${biz}, c.sku, c.external_id, c.name, c.brand, c.presentation, c.description, c.category,
    0, 'pending', null, null, true, false, false, false,
    null, null, c.is_alcoholic, c.minimum_age, 'commercial'
  from recovery_draft_candidates c order by c.ordinal
  on conflict (business_id, sku) do nothing
  returning sku
)
insert into recovery_draft_inserted(sku) select sku from inserted;
do $recovery_draft_verify$
declare v_bad integer; v_present integer; v_unsafe integer;
begin
  select count(*) into v_bad from public.products p join recovery_draft_inserted i on i.sku = p.sku
   where p.business_id = ${biz} and not (${DRAFT_PREDICATE});
  if v_bad <> 0 then raise exception 'RECOVERY_DRAFT_STATE_MISMATCH %', v_bad; end if;
  select count(*) into v_present from public.products p join recovery_draft_candidates c on c.sku = p.sku
   where p.business_id = ${biz};
  if v_present <> ${n} then raise exception 'RECOVERY_DRAFT_INCOMPLETE %', v_present; end if;
  -- None of the ${n} SKUs may be purchasable or published, inserted now or already there.
  select count(*) into v_unsafe from public.products p join recovery_draft_candidates c on c.sku = p.sku
   where p.business_id = ${biz} and (p.available or p.is_verified);
  if v_unsafe <> 0 then raise exception 'RECOVERY_DRAFT_SELLABLE_OR_VISIBLE %', v_unsafe; end if;
end $recovery_draft_verify$;
-- RLS probe with the browser roles (same pattern as supabase/tests/anon_internal_product_columns_test.sql).
grant insert on recovery_draft_public_probe to anon, authenticated;
set local role anon;
insert into recovery_draft_public_probe(role_name, visible)
  select 'anon', count(p.sku)::int from public.products p where p.business_id = ${biz} and p.sku = any(${skus});
reset role;
set local role authenticated;
insert into recovery_draft_public_probe(role_name, visible)
  select 'authenticated', count(p.sku)::int from public.products p where p.business_id = ${biz} and p.sku = any(${skus});
reset role;
do $recovery_draft_probe$
begin
  if (select count(*) from recovery_draft_public_probe) <> 2
     or exists (select 1 from recovery_draft_public_probe where visible <> 0) then
    raise exception 'RECOVERY_DRAFT_VISIBLE_TO_PUBLIC';
  end if;
end $recovery_draft_probe$;
select jsonb_build_object(
  'inserted', (select count(*) from recovery_draft_inserted),
  'skipped', ${n} - (select count(*) from recovery_draft_inserted),
  'insertedSkus', (select coalesce(jsonb_agg(sku order by sku), '[]'::jsonb) from recovery_draft_inserted),
  'publicProbe', (select jsonb_object_agg(role_name, visible) from recovery_draft_public_probe)
) as recovery_draft_receipt;
commit;`;
}

// The Management API may return only the last result set; search any nesting.
export function extractReceipt(result) {
  if (Array.isArray(result)) {
    for (const item of result) {
      const found = extractReceipt(item);
      if (found) return found;
    }
    return null;
  }
  if (result && typeof result === 'object' && result.recovery_draft_receipt) {
    const receipt = result.recovery_draft_receipt;
    return typeof receipt === 'string' ? JSON.parse(receipt) : receipt;
  }
  return null;
}

export function planAgainstExisting(candidates, existing) {
  const rows = Array.isArray(existing) ? existing : [];
  const bySku = new Map(rows.map(row => [row.sku, row]));
  const candidateSkus = new Set(candidates.map(c => c.sku));
  return {
    insert: candidates.filter(c => !bySku.has(c.sku)).map(c => c.sku),
    skip: candidates.filter(c => bySku.has(c.sku)).map(c => c.sku),
    // Skipped rows are never rewritten; a different name is only reported for review.
    skippedWithDifferentName: candidates.filter(c => bySku.has(c.sku) && bySku.get(c.sku).name !== c.name).map(c => c.sku),
    externalIdCollisions: rows.filter(row => candidateSkus.has(row.external_id) && row.sku !== row.external_id)
      .map(row => ({ sku: row.sku, external_id: row.external_id })),
    sellableOrVisible: rows.filter(row => candidateSkus.has(row.sku) && (row.available || row.is_verified)).map(row => row.sku),
  };
}

function describe(candidates, verified, sql, digest) {
  const categories = {};
  for (const c of candidates) categories[c.category] = (categories[c.category] || 0) + 1;
  return {
    projectRef: DRAFT_TARGET_PROJECT_REF, businessId: HISTORICAL_BUSINESS_ID,
    backupSha256: digest, backupSha256Matches: digest === EXPECTED_BACKUP_SHA256,
    sourceRows: verified.length, rowSha256Verified: verified.length, sourceRowsDigest: sourceRowsDigest(verified),
    draftState: { ...DRAFT_STATE, minimum_age: '18 only when is_alcoholic' }, alcoholicDrafts: candidates.filter(c => c.is_alcoholic).length,
    categories, sqlBytes: Buffer.byteLength(sql), sqlSha256: sha256(sql), transactions: 1,
    historicalValuesCopied: { price: false, stock: false, available: false, is_verified: false, sort_order: false },
  };
}

export async function stageHistoricalDrafts({ target, query, apply = false }) {
  assertDraftTarget(target);
  const marker = await query('select project_ref from private.la_taba_recovery_target where singleton');
  if (!Array.isArray(marker) || marker.length !== 1 || marker[0].project_ref !== target.projectRef) {
    throw new Error('Recovery database receipt mismatch');
  }
  const verified = verifySourceRows(await query(SOURCE_ROWS_SQL));
  const candidates = draftCandidates(verified);
  const business = await query(BUSINESS_SQL);
  if (!Array.isArray(business) || business.length !== 1) throw new Error('Historical business is missing from the recovery project');
  const plan = planAgainstExisting(candidates, await query(existingProductsSql(candidates)));
  const sql = buildDraftStagingSql(candidates);
  const report = { ...describe(candidates, verified, sql, EXPECTED_BACKUP_SHA256),
    business: { status: business[0].status, ordering_enabled: business[0].ordering_enabled,
      alcohol_sales_enabled: business[0].alcohol_sales_enabled },
    wouldInsert: plan.insert.length, wouldSkip: plan.skip.length, wouldInsertSkus: plan.insert, skippedSkus: plan.skip,
    skippedWithDifferentName: plan.skippedWithDifferentName,
    externalIdCollisions: plan.externalIdCollisions, existingSellableOrVisible: plan.sellableOrVisible };
  if (!apply) return { sql, report: { mode: 'dry-run', applied: false, ...report } };
  if (plan.externalIdCollisions.length || plan.sellableOrVisible.length) {
    throw new Error('Refusing to apply: an existing product collides with a draft or is already sellable/visible');
  }
  const receipt = extractReceipt(await query(sql)); // The one write: a single explicit transaction.
  const [post] = await query(postCheckSql(candidates));
  if (!post || post.present !== EXPECTED_PRODUCT_ROWS || post.sellable_or_visible !== 0) {
    throw new Error('Post-check failed: the drafts are incomplete or sellable/visible');
  }
  const inserted = receipt ? Number(receipt.inserted) : post.present - plan.skip.length;
  return { sql, report: { mode: 'applied', applied: true, ...report, inserted, skipped: EXPECTED_PRODUCT_ROWS - inserted,
    insertedSkus: receipt?.insertedSkus ?? null, publicProbe: receipt?.publicProbe ?? null,
    receiptSource: receipt ? 'transaction' : 'post-check',
    postCheck: { present: post.present, hiddenDrafts: post.hidden_drafts, sellableOrVisible: post.sellable_or_visible } } };
}

export function offlinePlan(bytes) {
  const { digest, rows } = sourceRowsFromBackup(bytes);
  if (digest !== EXPECTED_BACKUP_SHA256) throw new Error('Backup does not match the reviewed SHA-256');
  const verified = verifySourceRows(rows, { backupSha256: digest });
  const candidates = draftCandidates(verified);
  const sql = buildDraftStagingSql(candidates, { backupSha256: digest });
  return { sql, report: { mode: 'offline-plan', applied: false, existingProductsChecked: false,
    ...describe(candidates, verified, sql, digest), wouldInsertAtMost: candidates.length,
    wouldInsertSkus: candidates.map(c => c.sku) } };
}

function writeOutsideRepository(file, text) {
  const resolved = path.resolve(file);
  const relative = path.relative(ROOT, resolved);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) throw new Error('Generated SQL stays outside the public repository');
  fs.writeFileSync(resolved, text, { flag: 'wx' });
  return resolved;
}

const safeMessage = error => String(error?.message || error).split('\n')[0]
  .replace(/(?:sbp_|sb_secret_|APP_USR-|TEST-|eyJ)[A-Za-z0-9._-]+/g, '[redacted]').slice(0, 400);

async function main(argv = process.argv.slice(2)) {
  const valued = new Set(['--target', '--offline-backup', '--sql-out']);
  const option = name => {
    const value = argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined;
    return value && !value.startsWith('--') ? value : undefined;
  };
  const unknown = argv.filter((arg, index) => arg.startsWith('--') && !valued.has(arg) && arg !== '--apply' && !valued.has(argv[index - 1]));
  if (argv.includes('--help') || unknown.length || [...valued].some(name => argv.includes(name) && !option(name))) {
    console.log('Usage: [--target deploy/recovery-free-hosted.json] [--apply] [--sql-out <file outside the repo>]\n' +
      '       --offline-backup <backup.json> [--sql-out <file outside the repo>]   (no credentials, no network)');
    if (!argv.includes('--help')) process.exitCode = 2;
    return;
  }
  const target = JSON.parse(fs.readFileSync(path.resolve(ROOT, option('--target') || DEFAULT_TARGET), 'utf8'));
  assertDraftTarget(target); // Before any credential, network access or backup read.
  let outcome;
  if (option('--offline-backup')) {
    if (argv.includes('--apply')) throw new Error('--apply never runs from a local backup');
    outcome = offlinePlan(fs.readFileSync(option('--offline-backup')));
  } else {
    const { withRecoveryProject } = await import('./hosted-client.mjs');
    outcome = await withRecoveryProject(target, ({ query }) => stageHistoricalDrafts({ target, query, apply: argv.includes('--apply') }));
  }
  if (option('--sql-out')) outcome.report.sqlWrittenTo = writeOutsideRepository(option('--sql-out'), outcome.sql);
  console.log(JSON.stringify(outcome.report, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`Historical draft staging stopped; nothing is committed unless the receipt says applied: ${safeMessage(error)}`);
    process.exitCode = 1;
  });
}
