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
  if (!product || product.imageShowsMultipack === true) return false;
  const unitsPerPack = Number(product.unitsPerPack ?? 1);
  return Number.isFinite(unitsPerPack) && unitsPerPack === 1;
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
