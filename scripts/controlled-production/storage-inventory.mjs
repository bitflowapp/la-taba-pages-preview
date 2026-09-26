// Storage recovery inventory for CONTROLLED_PRODUCTION. READ ONLY.
//
// Where every file the product needs lives, and proof that it can be rebuilt:
//   · Supabase Storage: every bucket and object (today only the private
//     `fiscal-documents` bucket, unused in the pilot);
//   · catalog images: content-addressed files in git (assets/products/*.webp),
//     referenced by products.image_* and catalog_assets.* with their sha256, and
//     published with the web. For each referenced file: present in this
//     checkout, sha256 equal to the database, listed in the public asset
//     manifest, and served by the live web with the same bytes.
// Restoring = redeploy the web from any commit that has the files + restore the
// database rows (backup-drill) — or re-run the catalog import, which is idempotent.
//
//   node scripts/controlled-production/storage-inventory.mjs --target controlled-production [--out file]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadTargetKeys } from './target-keys.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback = '') => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
assert.equal(opt('--target'), 'controlled-production', 'EXPLICIT_TARGET_REQUIRED');
const OUT = opt('--out', `artifacts/controlled-production/storage-inventory-${Date.now()}.json`);
const config = JSON.parse(readFileSync('deploy/controlled-production.json', 'utf8'));
const ORIGIN = config.customerUrl;
const keys = await loadTargetKeys('controlled-production');
assert.equal(keys.ref, config.supabaseProjectRef, 'NOT_CONTROLLED_PRODUCTION');
const admin = createClient(keys.url, keys.secret, { auth: { persistSession: false, autoRefreshToken: false } });
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const q = async (promise) => { const { data, error } = await promise; if (error) throw Error(error.code || error.message); return data; };

async function listAll(bucket, prefix = '') {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await q(admin.storage.from(bucket).list(prefix, { limit: 1000, offset }));
    for (const item of page) {
      const full = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) out.push(...await listAll(bucket, full)); // folder
      else out.push({ name: full, bytes: item.metadata?.size ?? null, updatedAt: item.updated_at });
    }
    if (page.length < 1000) return out;
  }
}

const report = { at: new Date().toISOString(), ref: keys.ref, origin: ORIGIN, storage: [], catalog: {}, checks: {} };
for (const bucket of await q(admin.storage.listBuckets())) {
  const objects = await listAll(bucket.id);
  report.storage.push({ bucket: bucket.id, public: bucket.public, objects: objects.length,
    bytes: objects.reduce((a, o) => a + (o.bytes || 0), 0), sample: objects.slice(0, 5).map((o) => o.name) });
}

const manifest = JSON.parse(readFileSync('catalog/PUBLIC-PRODUCT-ASSETS.json', 'utf8'));
const published = new Set((manifest.publicables || []).map((p) => p.ruta));
const products = await q(admin.from('products').select('business_id,sku,image_url,image_sha256,image_thumbnail_url,image_thumbnail_sha256'));
const assets = await q(admin.from('catalog_assets').select('sku,master_path,master_sha256,thumbnail_path,thumbnail_sha256,rights_status,source_url'));
const refs = new Map();
const want = (file, digest, from) => {
  if (!file) return;
  const entry = refs.get(file) || { file, digests: new Set(), from: new Set() };
  if (digest) entry.digests.add(digest);
  entry.from.add(from);
  refs.set(file, entry);
};
for (const p of products) { want(p.image_url, p.image_sha256, 'products.image_url'); want(p.image_thumbnail_url, p.image_thumbnail_sha256, 'products.image_thumbnail_url'); }
for (const a of assets) { want(a.master_path, a.master_sha256, 'catalog_assets.master_path'); want(a.thumbnail_path, a.thumbnail_sha256, 'catalog_assets.thumbnail_path'); }

const files = [];
for (const entry of refs.values()) {
  const local = path.resolve(entry.file);
  const inRepo = existsSync(local);
  const localSha = inRepo ? sha(readFileSync(local)) : null;
  let servedSha = null; let status = 0;
  try {
    const response = await fetch(new URL(entry.file, ORIGIN), { signal: AbortSignal.timeout(30_000) });
    status = response.status;
    if (response.ok) servedSha = sha(Buffer.from(await response.arrayBuffer()));
  } catch { status = -1; }
  const digests = [...entry.digests];
  files.push({ file: entry.file, from: [...entry.from], inRepo, repoMatchesDb: inRepo && digests.every((d) => d === localSha),
    inPublicManifest: published.has(entry.file), served: status, servedMatchesDb: servedSha !== null && digests.every((d) => d === servedSha) });
}
report.catalog = { products: products.length, catalogAssets: assets.length, referencedFiles: files.length,
  rights: [...new Set(assets.map((a) => a.rights_status))], withSourceUrl: assets.filter((a) => a.source_url).length,
  missingInRepo: files.filter((f) => !f.inRepo).map((f) => f.file),
  repoHashMismatch: files.filter((f) => f.inRepo && !f.repoMatchesDb).map((f) => f.file),
  notInPublicManifest: files.filter((f) => !f.inPublicManifest).map((f) => f.file),
  notServedOrMismatch: files.filter((f) => !f.servedMatchesDb).map((f) => `${f.file}:${f.served}`) };
report.checks.STORAGE_BUCKETS_INVENTORIED = 'PASS';
report.checks.STORAGE_OBJECTS_WITHOUT_SOURCE = report.storage.reduce((a, b) => a + b.objects, 0);
report.checks.CATALOG_FILES_IN_GIT_WITH_DB_HASH = !report.catalog.missingInRepo.length && !report.catalog.repoHashMismatch.length ? 'PASS' : 'FAIL';
report.checks.CATALOG_FILES_IN_PUBLIC_MANIFEST = !report.catalog.notInPublicManifest.length ? 'PASS' : 'FAIL';
report.checks.CATALOG_FILES_SERVED_IDENTICAL = !report.catalog.notServedOrMismatch.length ? 'PASS' : 'FAIL';
report.files = files;
report.STORAGE_BACKUP_STRATEGY = report.checks.STORAGE_OBJECTS_WITHOUT_SOURCE === 0
  && ['CATALOG_FILES_IN_GIT_WITH_DB_HASH', 'CATALOG_FILES_IN_PUBLIC_MANIFEST', 'CATALOG_FILES_SERVED_IDENTICAL'].every((k) => report.checks[k] === 'PASS')
  ? 'PASS' : 'FAIL';
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ out: OUT, STORAGE_BACKUP_STRATEGY: report.STORAGE_BACKUP_STRATEGY, checks: report.checks, storage: report.storage,
  catalog: { ...report.catalog, missingInRepo: report.catalog.missingInRepo.length, repoHashMismatch: report.catalog.repoHashMismatch.length,
    notInPublicManifest: report.catalog.notInPublicManifest.length, notServedOrMismatch: report.catalog.notServedOrMismatch.length } }));
process.exit(report.STORAGE_BACKUP_STRATEGY === 'PASS' ? 0 : 1);
