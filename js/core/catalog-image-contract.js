export const CATALOG_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const CATALOG_IMAGE_MAX_PIXELS = 40_000_000;
export const CATALOG_IMAGE_MAX_DIMENSION = 12_000;

const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_RE = new RegExp('^' + UUID_SOURCE + '$', 'i');
const PRODUCT_ALIAS_RE = new RegExp(
  '^assets/products/c_(' + UUID_SOURCE + ')_(' + UUID_SOURCE + ')-([a-f0-9]{16})(-thumb)?-([a-f0-9]{64})[.]webp$',
  'i',
);
const SOURCE_MIME_EXTENSIONS = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
});

function bytesOf(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

function uint32be(bytes, offset) {
  return (((bytes[offset] << 24) >>> 0) | (bytes[offset + 1] << 16)
    | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function uint32le(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function ascii(bytes, offset, length) {
  let value = '';
  for (let i = 0; i < length; i += 1) value += String.fromCharCode(bytes[offset + i]);
  return value;
}

export function detectCatalogImageMime(input) {
  const bytes = bytesOf(input);
  if (!bytes || bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 24
    && bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG'
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return 'image/png';
  if (
    ascii(bytes, 0, 4) === 'RIFF'
    && ascii(bytes, 8, 4) === 'WEBP'
    && uint32le(bytes, 4) + 8 === bytes.length
  ) return 'image/webp';
  return null;
}

export function readCatalogImageDimensions(input, mime = detectCatalogImageMime(input)) {
  const bytes = bytesOf(input);
  if (!bytes) return null;

  if (mime === 'image/png' && bytes.length >= 24) {
    return { width: uint32be(bytes, 16), height: uint32be(bytes, 20) };
  }

  if (mime === 'image/jpeg' && bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length && offset < 2 * 1024 * 1024) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) return null;
      const marker = bytes[offset];
      offset += 1;
      if (marker === 0xd9 || marker === 0xda) return null;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) return null;
      const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
      if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)
      ) {
        if (segmentLength < 7) return null;
        return {
          height: (bytes[offset + 3] << 8) | bytes[offset + 4],
          width: (bytes[offset + 5] << 8) | bytes[offset + 6],
        };
      }
      offset += segmentLength;
    }
    return null;
  }

  if (mime === 'image/webp' && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const kind = ascii(bytes, offset, 4);
      const size = uint32le(bytes, offset + 4);
      const data = offset + 8;
      if (size < 1 || data + size > bytes.length) return null;
      if (kind === 'VP8X' && size >= 10) {
        return {
          width: 1 + bytes[data + 4] + (bytes[data + 5] << 8) + (bytes[data + 6] << 16),
          height: 1 + bytes[data + 7] + (bytes[data + 8] << 8) + (bytes[data + 9] << 16),
        };
      }
      if (kind === 'VP8L' && size >= 5 && bytes[data] === 0x2f) {
        const b1 = bytes[data + 1], b2 = bytes[data + 2], b3 = bytes[data + 3], b4 = bytes[data + 4];
        return {
          width: 1 + b1 + ((b2 & 0x3f) << 8),
          height: 1 + ((b2 & 0xc0) >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10),
        };
      }
      if (kind === 'VP8 ' && size >= 10
          && bytes[data + 3] === 0x9d && bytes[data + 4] === 0x01 && bytes[data + 5] === 0x2a) {
        return {
          width: ((bytes[data + 7] & 0x3f) << 8) | bytes[data + 6],
          height: ((bytes[data + 9] & 0x3f) << 8) | bytes[data + 8],
        };
      }
      offset = data + size + (size & 1);
    }
  }
  return null;
}

export function validateCatalogSourceImage({ bytes, declaredMime = '', declaredSize = null } = {}) {
  const data = bytesOf(bytes);
  if (!data || data.length === 0) return { ok: false, code: 'EMPTY_FILE' };
  if (data.length > CATALOG_IMAGE_MAX_BYTES) return { ok: false, code: 'FILE_TOO_LARGE' };
  if (declaredSize !== null && Number(declaredSize) !== data.length) return { ok: false, code: 'SIZE_MISMATCH' };
  const mime = detectCatalogImageMime(data);
  if (!mime || !Object.hasOwn(SOURCE_MIME_EXTENSIONS, mime)) return { ok: false, code: 'UNSUPPORTED_FILE_TYPE' };
  if (declaredMime && declaredMime !== mime) return { ok: false, code: 'MIME_MISMATCH' };
  const dimensions = readCatalogImageDimensions(data, mime);
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1) return { ok: false, code: 'INVALID_IMAGE' };
  if (
    dimensions.width > CATALOG_IMAGE_MAX_DIMENSION
    || dimensions.height > CATALOG_IMAGE_MAX_DIMENSION
    || dimensions.width * dimensions.height > CATALOG_IMAGE_MAX_PIXELS
  ) return { ok: false, code: 'IMAGE_DIMENSIONS_TOO_LARGE' };
  return { ok: true, mime, bytes: data.length, ...dimensions };
}

export function validateNormalizedCatalogWebp({ bytes, width, height } = {}) {
  const data = bytesOf(bytes);
  if (!data || data.length === 0) return { ok: false, code: 'EMPTY_FILE' };
  if (data.length > CATALOG_IMAGE_MAX_BYTES) return { ok: false, code: 'FILE_TOO_LARGE' };
  if (detectCatalogImageMime(data) !== 'image/webp') return { ok: false, code: 'WEBP_REQUIRED' };
  const dimensions = readCatalogImageDimensions(data, 'image/webp');
  if (!dimensions || dimensions.width !== Number(width) || dimensions.height !== Number(height)) {
    return { ok: false, code: 'IMAGE_DIMENSIONS_MISMATCH' };
  }
  return { ok: true, mime: 'image/webp', bytes: data.length, ...dimensions };
}

export function catalogImageUploadPaths({ businessId, productId, uploadId, sourceMime } = {}) {
  const business = normalizeUuid(businessId);
  const product = normalizeUuid(productId);
  const upload = normalizeUuid(uploadId);
  const extension = SOURCE_MIME_EXTENSIONS[sourceMime];
  if (!business || !product || !upload || !extension) throw new Error('INVALID_CATALOG_IMAGE_UPLOAD_PATH');
  const root = 'business/' + business + '/products/' + product + '/pending/' + upload + '/';
  return {
    source: root + 'source.' + extension,
    master: root + 'master.webp',
    thumbnail: root + 'thumbnail.webp',
  };
}

export function catalogProductStoragePath({ businessId, productId, kind, sha256 } = {}) {
  const business = normalizeUuid(businessId);
  const product = normalizeUuid(productId);
  const digest = normalizeSha256(sha256);
  if (!business || !product || !digest || !['master', 'thumbnail'].includes(kind)) {
    throw new Error('INVALID_CATALOG_IMAGE_STORAGE_PATH');
  }
  return 'business/' + business + '/products/' + product + '/'
    + (kind === 'thumbnail' ? 'thumb-' : '') + digest + '.webp';
}

export function catalogProductImageAlias({ businessId, productId, identitySha256, assetSha256, kind } = {}) {
  const business = normalizeUuid(businessId);
  const product = normalizeUuid(productId);
  const identity = normalizeSha256(identitySha256);
  const asset = normalizeSha256(assetSha256);
  if (!business || !product || !identity || !asset || !['master', 'thumbnail'].includes(kind)) {
    throw new Error('INVALID_CATALOG_IMAGE_ALIAS');
  }
  return 'assets/products/c_' + business + '_' + product + '-' + identity.slice(0, 16)
    + (kind === 'thumbnail' ? '-thumb-' : '-') + asset + '.webp';
}

export function parseCatalogProductImageAlias(value) {
  const match = String(value || '').match(PRODUCT_ALIAS_RE);
  if (!match) return null;
  return {
    businessId: normalizeUuid(match[1]),
    productId: normalizeUuid(match[2]),
    identityPrefix: match[3].toLowerCase(),
    kind: match[4] ? 'thumbnail' : 'master',
    assetSha256: match[5].toLowerCase(),
  };
}

export function catalogStoragePathFromImageAlias(value) {
  const parsed = parseCatalogProductImageAlias(value);
  if (!parsed) return null;
  return catalogProductStoragePath({
    businessId: parsed.businessId,
    productId: parsed.productId,
    kind: parsed.kind,
    sha256: parsed.assetSha256,
  });
}

export function resolveCatalogImageUrl(value, supabaseUrl) {
  const imagePath = String(value || '').trim();
  const objectPath = catalogStoragePathFromImageAlias(imagePath);
  if (!objectPath) return imagePath;
  try {
    const base = new URL(String(supabaseUrl || ''));
    const local = ['localhost', '127.0.0.1', '::1'].includes(base.hostname);
    if (base.protocol !== 'https:' && !(local && base.protocol === 'http:')) return '';
    const path = objectPath.split('/').map(encodeURIComponent).join('/');
    return new URL('/storage/v1/object/public/catalog-images/' + path, base.origin).toString();
  } catch (_) {
    return '';
  }
}

export function normalizeUuid(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return UUID_RE.test(normalized) ? normalized : '';
}

export function normalizeSha256(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : '';
}
