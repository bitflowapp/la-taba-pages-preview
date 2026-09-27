import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  CATALOG_IMAGE_MAX_BYTES,
  catalogImageUploadPaths,
  catalogProductImageAlias,
  catalogProductStoragePath,
  catalogStoragePathFromImageAlias,
  detectCatalogImageMime,
  parseCatalogProductImageAlias,
  resolveCatalogImageUrl,
  validateCatalogSourceImage,
  validateNormalizedCatalogWebp,
} from '../js/core/catalog-image-contract.js';
import { normalizeCatalogImageFile } from '../js/core/catalog-image-upload.js';
import {
  buildApprovedPaths as buildServerApprovedPaths,
  buildStagingPaths as buildServerStagingPaths,
  detectImageMime,
  imageDimensions,
  validateNormalizedWebp as validateServerWebp,
  validateOriginalImage as validateServerImage,
  validateSourceProvenance,
} from '../supabase/functions/_shared/catalog-image-contract.js';

const BUSINESS_ID = 'e7850ad2-a447-402c-8375-3fd74e9466ba';
const PRODUCT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const UPLOAD_ID = '11111111-2222-4333-8444-555555555555';
const HASH = '0123456789abcdef'.repeat(4);
const IDENTITY = 'abcdef0123456789'.repeat(4);

function putAscii(bytes, offset, value) {
  for (let i = 0; i < value.length; i += 1) bytes[offset + i] = value.charCodeAt(i);
}

function webpHeader(width, height) {
  const bytes = new Uint8Array(30);
  putAscii(bytes, 0, 'RIFF');
  bytes[4] = bytes.length - 8;
  putAscii(bytes, 8, 'WEBP');
  putAscii(bytes, 12, 'VP8X');
  bytes[16] = 10;
  bytes[20] = 0;
  const w = width - 1, h = height - 1;
  bytes[24] = w & 0xff; bytes[25] = (w >> 8) & 0xff; bytes[26] = (w >> 16) & 0xff;
  bytes[27] = h & 0xff; bytes[28] = (h >> 8) & 0xff; bytes[29] = (h >> 16) & 0xff;
  return bytes;
}

function pngHeader(width, height) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0, 0, 0, 13], 8);
  putAscii(bytes, 12, 'IHDR');
  bytes[16] = (width >>> 24) & 0xff; bytes[17] = (width >>> 16) & 0xff;
  bytes[18] = (width >>> 8) & 0xff; bytes[19] = width & 0xff;
  bytes[20] = (height >>> 24) & 0xff; bytes[21] = (height >>> 16) & 0xff;
  bytes[22] = (height >>> 8) & 0xff; bytes[23] = height & 0xff;
  return bytes;
}

test('server-generated staging paths bind the business, product and upload UUIDs', () => {
  assert.deepEqual(catalogImageUploadPaths({
    businessId: BUSINESS_ID, productId: PRODUCT_ID, uploadId: UPLOAD_ID, sourceMime: 'image/jpeg',
  }), {
    source: 'business/' + BUSINESS_ID + '/products/' + PRODUCT_ID + '/pending/' + UPLOAD_ID + '/source.jpg',
    master: 'business/' + BUSINESS_ID + '/products/' + PRODUCT_ID + '/pending/' + UPLOAD_ID + '/master.webp',
    thumbnail: 'business/' + BUSINESS_ID + '/products/' + PRODUCT_ID + '/pending/' + UPLOAD_ID + '/thumbnail.webp',
  });
  assert.throws(() => catalogImageUploadPaths({
    businessId: BUSINESS_ID, productId: '../other', uploadId: UPLOAD_ID, sourceMime: 'image/jpeg',
  }), /INVALID_CATALOG_IMAGE_UPLOAD_PATH/);
  assert.throws(() => catalogImageUploadPaths({
    businessId: BUSINESS_ID, productId: PRODUCT_ID, uploadId: UPLOAD_ID, sourceMime: 'application/pdf',
  }), /INVALID_CATALOG_IMAGE_UPLOAD_PATH/);
});

test('public product aliases resolve only to the matching approved storage path', () => {
  const master = catalogProductImageAlias({
    businessId: BUSINESS_ID, productId: PRODUCT_ID, identitySha256: IDENTITY, assetSha256: HASH, kind: 'master',
  });
  const thumbnail = catalogProductImageAlias({
    businessId: BUSINESS_ID, productId: PRODUCT_ID, identitySha256: IDENTITY, assetSha256: HASH, kind: 'thumbnail',
  });
  assert.equal(
    catalogStoragePathFromImageAlias(master),
    catalogProductStoragePath({ businessId: BUSINESS_ID, productId: PRODUCT_ID, sha256: HASH, kind: 'master' }),
  );
  assert.equal(
    catalogStoragePathFromImageAlias(thumbnail),
    catalogProductStoragePath({ businessId: BUSINESS_ID, productId: PRODUCT_ID, sha256: HASH, kind: 'thumbnail' }),
  );
  assert.equal(resolveCatalogImageUrl(master, 'https://tkanbadcglszlcyfjvpv.supabase.co'),
    'https://tkanbadcglszlcyfjvpv.supabase.co/storage/v1/object/public/catalog-images/'
      + 'business/' + BUSINESS_ID + '/products/' + PRODUCT_ID + '/' + HASH + '.webp');
  assert.equal(resolveCatalogImageUrl('assets/products/legacy.webp', 'https://example.test'),
    'assets/products/legacy.webp');
  assert.equal(resolveCatalogImageUrl(master, ''), '');
  assert.equal(parseCatalogProductImageAlias(master).businessId, BUSINESS_ID);
  assert.equal(catalogStoragePathFromImageAlias('assets/products/../f.webp'), null);
});

test('source bytes must match an allowed real image format, MIME and size', () => {
  const png = pngHeader(640, 480);
  assert.equal(detectCatalogImageMime(png), 'image/png');
  assert.deepEqual(validateCatalogSourceImage({ bytes: png, declaredMime: 'image/png' }), {
    ok: true, mime: 'image/png', bytes: png.length, width: 640, height: 480,
  });
  assert.equal(validateCatalogSourceImage({ bytes: png, declaredMime: 'image/jpeg' }).code, 'MIME_MISMATCH');
  assert.equal(validateCatalogSourceImage({ bytes: new TextEncoder().encode('<svg/>') }).code, 'UNSUPPORTED_FILE_TYPE');
  assert.equal(validateCatalogSourceImage({ bytes: new Uint8Array(CATALOG_IMAGE_MAX_BYTES + 1) }).code, 'FILE_TOO_LARGE');
  assert.equal(validateCatalogSourceImage({ bytes: pngHeader(12000, 10000), declaredMime: 'image/png' }).code,
    'IMAGE_DIMENSIONS_TOO_LARGE');
});

test('normalized assets must be actual WebP at the exact master and thumbnail sizes', () => {
  assert.equal(validateNormalizedCatalogWebp({ bytes: webpHeader(1000, 1000), width: 1000, height: 1000 }).ok, true);
  assert.equal(validateNormalizedCatalogWebp({ bytes: webpHeader(400, 400), width: 400, height: 400 }).ok, true);
  assert.equal(validateNormalizedCatalogWebp({ bytes: webpHeader(1000, 999), width: 1000, height: 1000 }).code,
    'IMAGE_DIMENSIONS_MISMATCH');
});

test('the Edge Function and browser agree on paths, MIME and image dimensions', () => {
  const frontendStaging = catalogImageUploadPaths({
    businessId: BUSINESS_ID, productId: PRODUCT_ID, uploadId: UPLOAD_ID, sourceMime: 'image/png',
  });
  const serverStaging = buildServerStagingPaths({
    businessId: BUSINESS_ID, productId: PRODUCT_ID, uploadId: UPLOAD_ID, sourceMime: 'image/png',
  });
  assert.deepEqual(serverStaging, frontendStaging);

  const frontendMaster = catalogProductStoragePath({
    businessId: BUSINESS_ID, productId: PRODUCT_ID, sha256: HASH, kind: 'master',
  });
  const frontendThumb = catalogProductStoragePath({
    businessId: BUSINESS_ID, productId: PRODUCT_ID, sha256: HASH, kind: 'thumbnail',
  });
  assert.deepEqual(buildServerApprovedPaths({
    businessId: BUSINESS_ID, productId: PRODUCT_ID, masterSha256: HASH, thumbnailSha256: HASH,
  }), { master: frontendMaster, thumbnail: frontendThumb });

  const png = pngHeader(640, 480);
  assert.equal(detectImageMime(png), detectCatalogImageMime(png));
  assert.deepEqual(imageDimensions(png), { width: 640, height: 480 });
  const serverImage = validateServerImage({ bytes: png, declaredMime: 'image/png' });
  const browserImage = validateCatalogSourceImage({ bytes: png, declaredMime: 'image/png' });
  assert.equal(serverImage.ok, browserImage.ok);
  assert.equal(serverImage.mime, browserImage.mime);
  assert.equal(serverImage.size, browserImage.bytes);
  assert.equal(serverImage.width, browserImage.width);
  assert.equal(serverImage.height, browserImage.height);
  assert.equal(validateServerWebp({ bytes: webpHeader(1000, 1000), expectedWidth: 1000, expectedHeight: 1000 }).ok, true);
});

test('source provenance requires HTTPS for external images and an explicit own-photo type', () => {
  assert.deepEqual(validateSourceProvenance({
    sourceType: 'manufacturer', sourceUrl: 'https://brand.example/product/packshot?v=2',
  }), {
    ok: true,
    sourceUrl: 'https://brand.example/product/packshot?v=2',
    sourceDomain: 'brand.example',
  });
  assert.equal(validateSourceProvenance({
    sourceType: 'manufacturer', sourceUrl: 'http://brand.example/photo.jpg',
  }).code, 'SOURCE_URL_MUST_BE_HTTPS');
  assert.equal(validateSourceProvenance({
    sourceType: 'manufacturer', sourceUrl: 'https://brand.example/photo.jpg?access_token=bad',
  }).code, 'SOURCE_URL_CONTAINS_CREDENTIALS');
  assert.deepEqual(validateSourceProvenance({ sourceType: 'business_owned_photo', sourceUrl: '' }), {
    ok: true, sourceUrl: null, sourceDomain: 'business-owned',
  });
});

test('browser normalization contains the whole item on white and strips other file formats', async () => {
  const drawCalls = [];
  const file = {
    type: 'image/png',
    size: pngHeader(2, 1).length,
    arrayBuffer: async () => pngHeader(2, 1).buffer,
  };
  const normalized = await normalizeCatalogImageFile(file, {
    createImageBitmapImpl: async () => ({ width: 2, height: 1, close() {} }),
    canvasFactory: (size) => ({
      width: 0,
      height: 0,
      getContext() {
        return {
          fillRect: (...args) => drawCalls.push(['white-background', ...args]),
          drawImage: (...args) => drawCalls.push(['product', ...args.slice(1)]),
        };
      },
      toBlob(callback, type) { callback(new Blob([webpHeader(size, size)], { type })); },
    }),
  });
  assert.equal(normalized.sourceMime, 'image/png');
  assert.equal(normalized.master.type, 'image/webp');
  assert.equal(normalized.thumbnail.type, 'image/webp');
  assert.deepEqual(drawCalls[1], ['product', 0, 250, 1000, 500]);
  assert.deepEqual(drawCalls[3], ['product', 0, 100, 400, 200]);
});

test('browser-visible image code never contains service-role credentials', () => {
  const repository = fs.readFileSync(new URL('../js/repositories/supabase-catalog-image-repository.js', import.meta.url), 'utf8');
  const ui = fs.readFileSync(new URL('../js/core/catalog-image-contract.js', import.meta.url), 'utf8');
  assert.match(repository, /uploadToSignedUrl/);
  assert.doesNotMatch(repository + ui, /SUPABASE_SERVICE_ROLE_KEY|sb_secret_[A-Za-z0-9_-]{20,}/);
});
