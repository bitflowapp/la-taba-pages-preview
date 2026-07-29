function normalizedProductText(product) {
  return [
    product?.brand,
    product?.name,
    product?.variant,
    product?.subcategory,
    ...(Array.isArray(product?.tags) ? product.tags : []),
  ]
    .filter(Boolean)
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizedProductIds(productIds) {
  if (productIds instanceof Set) return productIds;
  return new Set(Array.isArray(productIds) ? productIds : []);
}

const UNIT_PACKAGE_TYPES = new Set(['botella', 'lata', 'bidon', 'unidad', 'envase']);
const MULTIPACK_COPY_PATTERN = /(?:\b(?:pack|multipack)\b|(?:^|[\s(])(?:x|×)\s*[2-9]\d*(?=$|[\s),.-]))/i;

function normalizedUnitText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function isPromotionalProduct(product, activePromotionProductIds = []) {
  if (!product?.id) return false;
  const price = Number(product.price);
  const oldPrice = Number(product.oldPrice);
  const hasReducedPrice = Number.isFinite(price)
    && Number.isFinite(oldPrice)
    && oldPrice > price;
  const hasHomeBadge = Boolean(String(product.homePromoBadge || '').trim());
  return hasHomeBadge
    || hasReducedPrice
    || normalizedProductIds(activePromotionProductIds).has(product.id);
}

export function isFernetProduct(product) {
  return /\bfernet\b/.test(normalizedProductText(product));
}

export function isPopularProduct(product) {
  return product?.popular === true;
}

export function isUnitStorefrontProduct(product) {
  if (!product?.id || product.imageShowsMultipack === true) return false;

  const unitsPerPack = Number(product.unitsPerPack);
  if (!Number.isFinite(unitsPerPack) || unitsPerPack !== 1) return false;

  const packageType = normalizedUnitText(product.packageType);
  if (!UNIT_PACKAGE_TYPES.has(packageType)) return false;

  const unitCopy = [
    product.name,
    product.description,
    product.presentation,
    product.unit,
    product.unitLabel,
  ].filter(Boolean).join(' ');
  if (MULTIPACK_COPY_PATTERN.test(unitCopy)) return false;

  const price = Number(product.price);
  const stock = Number(product.stock);
  return Number.isFinite(price)
    && price > 0
    && Number.isFinite(stock)
    && stock >= 0
    && typeof product.available === 'boolean';
}

export function uniqueProducts(products) {
  const seen = new Set();
  return (Array.isArray(products) ? products : []).filter((product) => {
    const id = String(product?.id || '');
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
