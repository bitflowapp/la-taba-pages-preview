export const CATALOG_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const CATALOG_IMAGE_MAX_PIXELS = 40_000_000;
export const CATALOG_IMAGE_MAX_DIMENSION = 12_000;
export const CATALOG_IMAGE_SOURCE_TYPES = Object.freeze([
  'brand', 'manufacturer', 'official_distributor', 'retail_reference', 'business_owned_photo',
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCE_EXTENSIONS = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
});

export function normalizeUuid(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return UUID_RE.test(normalized) ? normalized : '';
}

export function normalizeSha256(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : '';
}

export function validateSourceProvenance({ sourceType, sourceUrl = '' } = {}) {
  if (!CATALOG_IMAGE_SOURCE_TYPES.includes(sourceType)) return { ok: false, code: 'INVALID_SOURCE_TYPE' };
  if (sourceType === 'business_owned_photo') {
    if (String(sourceUrl || '').trim()) return { ok: false, code: 'OWN_PHOTO_MUST_NOT_HAVE_EXTERNAL_URL' };
    return { ok: true, sourceUrl: null, sourceDomain: 'business-owned' };
  }
  let url;
  try { url = new URL(String(sourceUrl || '').trim()); } catch { return { ok: false, code: 'SOURCE_URL_REQUIRED' }; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    return { ok: false, code: 'SOURCE_URL_MUST_BE_HTTPS' };
  }
  if (url.hash || [...url.searchParams.keys()].some((key) =>
    /^(?:token|token_hash|access_token|refresh_token|authorization|auth|apikey|api_key|key|sig|signature|code)$/i.test(key)
  )) {
    return { ok: false, code: 'SOURCE_URL_CONTAINS_CREDENTIALS' };
  }
  if (url.href.length > 2048 || !url.hostname || url.hostname.endsWith('.')) {
    return { ok: false, code: 'INVALID_SOURCE_URL' };
  }
  return { ok: true, sourceUrl: url.href, sourceDomain: url.hostname.toLowerCase() };
}

export function buildStagingPaths({ businessId, productId, uploadId, sourceMime } = {}) {
  const business = normalizeUuid(businessId);
  const product = normalizeUuid(productId);
  const upload = normalizeUuid(uploadId);
  const extension = SOURCE_EXTENSIONS[sourceMime];
  if (!business || !product || !upload || !extension) throw new Error('INVALID_CATALOG_IMAGE_PATH');
  const root = 'business/' + business + '/products/' + product + '/pending/' + upload + '/';
  return { source: root + 'source.' + extension, master: root + 'master.webp', thumbnail: root + 'thumbnail.webp' };
}

export function buildApprovedPaths({ businessId, productId, masterSha256, thumbnailSha256 } = {}) {
  const business = normalizeUuid(businessId);
  const product = normalizeUuid(productId);
  const master = normalizeSha256(masterSha256);
  const thumbnail = normalizeSha256(thumbnailSha256);
  if (!business || !product || !master || !thumbnail) throw new Error('INVALID_CATALOG_IMAGE_PATH');
  const root = 'business/' + business + '/products/' + product + '/';
  return { master: root + master + '.webp', thumbnail: root + 'thumb-' + thumbnail + '.webp' };
}

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

function ascii(bytes, offset, length) {
  let value = '';
  for (let i = 0; i < length; i += 1) value += String.fromCharCode(bytes[offset + i]);
  return value;
}

function uint32le(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function uint32be(bytes, offset) {
  return (((bytes[offset] << 24) >>> 0) | (bytes[offset + 1] << 16)
    | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

export function detectImageMime(input) {
  const bytes = asBytes(input);
  if (!bytes || bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 24 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG'
      && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return 'image/png';
  }
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP'
      && uint32le(bytes, 4) + 8 === bytes.length) return 'image/webp';
  return null;
}

export function imageDimensions(input, mime = detectImageMime(input)) {
  const bytes = asBytes(input);
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
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) return null;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) return null;
      const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
      if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
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

export function validateOriginalImage({ bytes, declaredMime, maxBytes = CATALOG_IMAGE_MAX_BYTES }) {
  const data = asBytes(bytes);
  if (!data || data.length === 0) return { ok: false, code: 'EMPTY_FILE' };
  if (data.length > maxBytes) return { ok: false, code: 'FILE_TOO_LARGE' };
  const mime = detectImageMime(data);
  if (!mime || !Object.hasOwn(SOURCE_EXTENSIONS, mime)) return { ok: false, code: 'UNSUPPORTED_FILE_TYPE' };
  if (declaredMime && mime !== declaredMime) return { ok: false, code: 'MIME_MISMATCH' };
  const dimensions = imageDimensions(data, mime);
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1) return { ok: false, code: 'INVALID_IMAGE' };
  if (dimensions.width > CATALOG_IMAGE_MAX_DIMENSION
      || dimensions.height > CATALOG_IMAGE_MAX_DIMENSION
      || dimensions.width * dimensions.height > CATALOG_IMAGE_MAX_PIXELS) {
    return { ok: false, code: 'IMAGE_DIMENSIONS_TOO_LARGE' };
  }
  return { ok: true, mime, size: data.length, ...dimensions };
}

export function validateNormalizedWebp({ bytes, expectedWidth, expectedHeight, maxBytes = CATALOG_IMAGE_MAX_BYTES }) {
  const data = asBytes(bytes);
  if (!data || data.length === 0) return { ok: false, code: 'EMPTY_FILE' };
  if (data.length > maxBytes) return { ok: false, code: 'FILE_TOO_LARGE' };
  if (detectImageMime(data) !== 'image/webp') return { ok: false, code: 'WEBP_REQUIRED' };
  const dimensions = imageDimensions(data, 'image/webp');
  if (!dimensions || dimensions.width !== expectedWidth || dimensions.height !== expectedHeight) {
    return { ok: false, code: 'IMAGE_DIMENSIONS_MISMATCH' };
  }
  return { ok: true, mime: 'image/webp', size: data.length, ...dimensions };
}

export async function sha256Hex(input) {
  const bytes = asBytes(input);
  if (!bytes) throw new Error('INVALID_IMAGE_BYTES');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
