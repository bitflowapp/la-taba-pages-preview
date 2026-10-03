import { resolveCatalogImageUrl } from './catalog-image-contract.js';

const RIGHTS = new Set(['PROPIO', 'LICENCIA_COMERCIAL', 'PERMISO_DOCUMENTADO']);
const HASH = /^[a-f0-9]{64}$/i;
export const PRODUCT_PLACEHOLDER = 'assets/products/beverage-placeholder.svg';
const resolvedUrls = new Map();

// Hash-addressed aliases recur across cards, details and identical updates.
// Cache only this pure URL conversion; rights/hash decisions remain live.
export function resolveProductPhotoUrl(value, supabaseUrl = '') {
  const key = `${supabaseUrl}\0${String(value || '').trim()}`;
  if (resolvedUrls.has(key)) return resolvedUrls.get(key);
  const url = resolveCatalogImageUrl(value, supabaseUrl);
  resolvedUrls.set(key, url);
  if (resolvedUrls.size > 256) resolvedUrls.delete(resolvedUrls.keys().next().value);
  return url;
}

export function productImageRightsCleared(product) {
  return RIGHTS.has(String(product?.rightsStatus || '').toUpperCase());
}

// One publication decision for cards, details, showcases and campaigns.
export function productPhotoIsOfficial(product = {}, supabaseUrl = '') {
  return Boolean(resolveProductPhotoUrl(product.image || '', supabaseUrl)
    && resolveProductPhotoUrl(product.imageThumbnail || product.thumbnail || '', supabaseUrl)
    && (!product.qaFixture || product.previewCatalogApproved === true)
    && product.imageShowsMultipack !== true
    && [product.imageSha256, product.imageThumbnailSha256, product.sourceImageSha256]
      .every(hash => HASH.test(String(hash || '')))
    && productImageRightsCleared(product));
}

export function productPhoto(product = {}, supabaseUrl = '') {
  const official = productPhotoIsOfficial(product, supabaseUrl);
  return {
    official,
    src: official ? resolveProductPhotoUrl(product.imageThumbnail || product.thumbnail, supabaseUrl) : PRODUCT_PLACEHOLDER,
    master: official ? resolveProductPhotoUrl(product.image, supabaseUrl) : '',
    name: product.name || 'bebida',
  };
}
