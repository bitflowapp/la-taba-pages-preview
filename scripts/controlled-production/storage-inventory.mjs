// Storage recovery inventory for CONTROLLED_PRODUCTION. READ ONLY.
//
// Where every file the product needs lives, and proof that it can be rebuilt:
//   · legacy approved catalog files remain content-addressed in git and in the
//     public asset manifest;
//   · new uploads pass through private catalog-image-staging and only approved
//     WebP files are copied into public catalog-images with SHA-256 bindings;
//   · fiscal PDFs remain isolated in fiscal-documents.
// For each referenced catalog image this inventory checks the active database
// binding, the repo/manifest or Storage object as appropriate, and anonymous
// delivery of the exact bytes.
//
//   node scripts/controlled-production/storage-inventory.mjs --target controlled-production [--out file]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadTargetKeys } from './target-keys.mjs';
import { catalogStoragePathFromImageAlias } from '../../js/core/catalog-image-contract.js';

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
const storageObjectsByBucket = new Map();
for (const bucket of await q(admin.storage.listBuckets())) {
  const objects = await listAll(bucket.id);
  storageObjectsByBucket.set(bucket.id, objects);
  report.storage.push({ bucket: bucket.id, public: bucket.public, objects: objects.length,
    bytes: objects.reduce((a, o) => a + (o.bytes || 0), 0),
    maxBytes: bucket.file_size_limit ?? null,
    allowedMimeTypes: bucket.allowed_mime_types || null,
    sample: objects.slice(0, 5).map((o) => o.name) });
}

const manifest = JSON.parse(readFileSync('catalog/PUBLIC-PRODUCT-ASSETS.json', 'utf8'));
const published = new Set((manifest.publicables || []).map((p) => p.ruta));
const products = await q(admin.from('products').select('id,business_id,sku,catalog_asset_id,image_url,image_sha256,image_thumbnail_url,image_thumbnail_sha256,source_image_sha256'));
const assets = await q(admin.from('catalog_assets').select('id,business_id,product_id,sku,master_path,master_sha256,master_storage_path,thumbnail_path,thumbnail_sha256,thumbnail_storage_path,source_sha256,rights_status,source_url'));
const imageUploads = await q(admin.from('catalog_image_uploads').select('business_id,product_id,status,cleanup_status,staging_source_path,staging_master_path,staging_thumbnail_path,public_master_path,public_thumbnail_path,previous_master_path,previous_thumbnail_path'));
const fiscalArtifacts = await q(admin.from('fiscal_document_artifacts').select('storage_path'));
const refs = new Map();
const want = (file, digest, from, storagePath = null) => {
  if (!file) return;
  const entry = refs.get(file) || { file, digests: new Set(), from: new Set(), storagePath: null };
  if (digest) entry.digests.add(digest);
  if (storagePath) entry.storagePath = storagePath;
  entry.from.add(from);
  refs.set(file, entry);
};
const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
const productImageBindings = [];
for (const product of products) {
  const asset = assetsById.get(product.catalog_asset_id);
  const storageMaster = asset?.master_storage_path || catalogStoragePathFromImageAlias(product.image_url);
  const storageThumbnail = asset?.thumbnail_storage_path || catalogStoragePathFromImageAlias(product.image_thumbnail_url);
  want(product.image_url, product.image_sha256, 'products.image_url', storageMaster);
  want(product.image_thumbnail_url, product.image_thumbnail_sha256, 'products.image_thumbnail_url', storageThumbnail);
  if (product.catalog_asset_id && (!asset || asset.master_path !== product.image_url
      || asset.thumbnail_path !== product.image_thumbnail_url
      || asset.master_sha256 !== product.image_sha256
      || asset.thumbnail_sha256 !== product.image_thumbnail_sha256
      || asset.source_sha256 !== product.source_image_sha256
      || (asset.product_id && asset.product_id !== product.id))) {
    productImageBindings.push(product.sku || product.id);
  }
}
for (const asset of assets) {
  want(asset.master_path, asset.master_sha256, 'catalog_assets.master_path', asset.master_storage_path);
  want(asset.thumbnail_path, asset.thumbnail_sha256, 'catalog_assets.thumbnail_path', asset.thumbnail_storage_path);
}

const files = [];
for (const entry of refs.values()) {
  const storageBacked = Boolean(entry.storagePath);
  const local = storageBacked ? null : path.resolve(entry.file);
  const inRepo = storageBacked ? false : existsSync(local);
  const localSha = inRepo ? sha(readFileSync(local)) : null;
  let storedSha = null;
  let storagePresent = false;
  let servedSha = null; let status = 0;
  let publicUrl = '';
  if (storageBacked) {
    const { data: stored, error: storageError } = await admin.storage.from('catalog-images').download(entry.storagePath);
    if (!storageError && stored) {
      storagePresent = true;
      storedSha = sha(Buffer.from(await stored.arrayBuffer()));
    }
    publicUrl = admin.storage.from('catalog-images').getPublicUrl(entry.storagePath).data.publicUrl;
  }
  try {
    const response = await fetch(storageBacked ? publicUrl : new URL(entry.file, ORIGIN), {
      signal: AbortSignal.timeout(30_000),
    });
    status = response.status;
    if (response.ok) servedSha = sha(Buffer.from(await response.arrayBuffer()));
  } catch { status = -1; }
  const digests = [...entry.digests];
  files.push({
    file: entry.file,
    from: [...entry.from],
    storagePath: entry.storagePath,
    storagePresent,
    storageMatchesDb: storageBacked && storagePresent && digests.every((d) => d === storedSha),
    inRepo,
    repoMatchesDb: inRepo && digests.every((d) => d === localSha),
    inPublicManifest: storageBacked ? true : published.has(entry.file),
    served: status,
    servedMatchesDb: servedSha !== null && digests.every((d) => d === servedSha),
  });
}
report.catalog = { products: products.length, catalogAssets: assets.length, referencedFiles: files.length,
  storageBackedFiles: files.filter((f) => f.storagePath).length,
  storageMissingOrHashMismatch: files.filter((f) => f.storagePath && !f.storageMatchesDb).map((f) => f.storagePath),
  productImageBindingMismatch: productImageBindings,
  pendingImageReviews: imageUploads.filter((upload) => upload.status === 'pending').length,
  cleanupPending: imageUploads.filter((upload) => upload.status !== 'pending' && upload.cleanup_status !== 'complete').length,
  rights: [...new Set(assets.map((a) => a.rights_status))], withSourceUrl: assets.filter((a) => a.source_url).length,
  missingInRepo: files.filter((f) => !f.storagePath && !f.inRepo).map((f) => f.file),
  repoHashMismatch: files.filter((f) => !f.storagePath && f.inRepo && !f.repoMatchesDb).map((f) => f.file),
  notInPublicManifest: files.filter((f) => !f.storagePath && !f.inPublicManifest).map((f) => f.file),
  notServedOrMismatch: files.filter((f) => !f.servedMatchesDb).map((f) => `${f.file}:${f.served}`) };
report.checks.STORAGE_BUCKETS_INVENTORIED = 'PASS';
const knownStorageObjects = new Set();
for (const asset of assets) {
  if (asset.master_storage_path) knownStorageObjects.add('catalog-images:' + asset.master_storage_path);
  if (asset.thumbnail_storage_path) knownStorageObjects.add('catalog-images:' + asset.thumbnail_storage_path);
}
for (const upload of imageUploads) {
  const cleanupPending = upload.cleanup_status !== 'complete';
  if (upload.status === 'pending' || cleanupPending) {
    for (const name of [upload.staging_source_path, upload.staging_master_path, upload.staging_thumbnail_path]) {
      if (name) knownStorageObjects.add('catalog-image-staging:' + name);
    }
  }
  if (upload.public_master_path) knownStorageObjects.add('catalog-images:' + upload.public_master_path);
  if (upload.public_thumbnail_path) knownStorageObjects.add('catalog-images:' + upload.public_thumbnail_path);
  if (upload.status === 'approved' && cleanupPending) {
    if (upload.previous_master_path) knownStorageObjects.add('catalog-images:' + upload.previous_master_path);
    if (upload.previous_thumbnail_path) knownStorageObjects.add('catalog-images:' + upload.previous_thumbnail_path);
  }
}
for (const artifact of fiscalArtifacts) {
  if (artifact.storage_path) knownStorageObjects.add('fiscal-documents:' + artifact.storage_path);
}
const orphanStorageObjects = [];
for (const bucket of ['catalog-image-staging', 'catalog-images', 'fiscal-documents']) {
  for (const object of storageObjectsByBucket.get(bucket) || []) {
    if (!knownStorageObjects.has(bucket + ':' + object.name)) orphanStorageObjects.push(bucket + ':' + object.name);
  }
}
const stagingBucket = report.storage.find((bucket) => bucket.bucket === 'catalog-image-staging');
const imageBucket = report.storage.find((bucket) => bucket.bucket === 'catalog-images');
report.checks.CATALOG_IMAGE_BUCKETS_CONFIGURED = stagingBucket?.public === false
  && imageBucket?.public === true
  && stagingBucket.maxBytes === 5242880
  && imageBucket.maxBytes === 5242880
  && ['image/jpeg', 'image/png', 'image/webp'].every((mime) => stagingBucket.allowedMimeTypes?.includes(mime))
  && imageBucket.allowedMimeTypes?.length === 1 && imageBucket.allowedMimeTypes[0] === 'image/webp'
  ? 'PASS' : 'FAIL';
report.checks.CATALOG_IMAGE_STORAGE_OBJECTS_MAPPED = orphanStorageObjects.length === 0 ? 'PASS' : 'FAIL';
report.checks.CATALOG_IMAGE_PRODUCT_BINDINGS_MATCH = productImageBindings.length === 0 ? 'PASS' : 'FAIL';
report.checks.STORAGE_OBJECTS_WITHOUT_SOURCE = orphanStorageObjects.length;
report.checks.CATALOG_FILES_IN_GIT_WITH_DB_HASH = !report.catalog.missingInRepo.length && !report.catalog.repoHashMismatch.length ? 'PASS' : 'FAIL';
report.checks.CATALOG_FILES_IN_PUBLIC_MANIFEST = !report.catalog.notInPublicManifest.length ? 'PASS' : 'FAIL';
report.checks.CATALOG_FILES_IN_STORAGE_WITH_DB_HASH = !report.catalog.storageMissingOrHashMismatch.length ? 'PASS' : 'FAIL';
report.checks.CATALOG_FILES_SERVED_IDENTICAL = !report.catalog.notServedOrMismatch.length ? 'PASS' : 'FAIL';
report.files = files;
report.STORAGE_BACKUP_STRATEGY = report.checks.STORAGE_OBJECTS_WITHOUT_SOURCE === 0
  && report.catalog.cleanupPending === 0
  && report.checks.CATALOG_IMAGE_BUCKETS_CONFIGURED === 'PASS'
  && report.checks.CATALOG_IMAGE_PRODUCT_BINDINGS_MATCH === 'PASS'
  && ['CATALOG_FILES_IN_GIT_WITH_DB_HASH', 'CATALOG_FILES_IN_PUBLIC_MANIFEST',
    'CATALOG_FILES_IN_STORAGE_WITH_DB_HASH', 'CATALOG_FILES_SERVED_IDENTICAL'].every((k) => report.checks[k] === 'PASS')
  ? 'PASS' : 'FAIL';
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ out: OUT, STORAGE_BACKUP_STRATEGY: report.STORAGE_BACKUP_STRATEGY, checks: report.checks, storage: report.storage,
  catalog: { ...report.catalog, missingInRepo: report.catalog.missingInRepo.length, repoHashMismatch: report.catalog.repoHashMismatch.length,
    storageMissingOrHashMismatch: report.catalog.storageMissingOrHashMismatch.length,
    productImageBindingMismatch: report.catalog.productImageBindingMismatch.length,
    notInPublicManifest: report.catalog.notInPublicManifest.length, notServedOrMismatch: report.catalog.notServedOrMismatch.length } }));
process.exit(report.STORAGE_BACKUP_STRATEGY === 'PASS' ? 0 : 1);
