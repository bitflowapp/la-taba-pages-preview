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
  // Un precio anterior o un badge del producto no es evidencia comercial
  // suficiente. Una promo visible exige una regla activa y validada.
  return normalizedProductIds(activePromotionProductIds).has(product.id);
}

export function isFernetProduct(product) {
  return /\bfernet\b/.test(normalizedProductText(product));
}

/*
 * LA VIDRIERA SE CURA EN LA BASE, NO ACÁ.
 *
 * «Recomendados del local» son los productos que el comercio eligió mostrar
 * primero, y el orden importa tanto como la selección. Ese dato viaja en un
 * tag posicional del propio producto —`recomendado-01` … `recomendado-12`—,
 * así que cambiar la vidriera es cambiar filas, no desplegar el cliente.
 *
 * Por qué NO se reusó el tag anterior, `más vendido`: afirmaba una métrica de
 * ventas que no existía —el comercio tenía UN pedido en toda su historia— y
 * además no lleva orden. Un rótulo que miente sobre lo que hicieron otros
 * clientes es el tipo de cosa que este proyecto no publica.
 *
 * `popular` (el `más vendido` heredado) se sigue aceptando: mientras no haya
 * ningún producto curado, la vidriera anterior sigue en pie y no hay ventana
 * en la que la home quede sin su primer carrusel.
 */
const RECOMMENDED_TAG = /^recomendado-(\d{1,2})$/;

export function recommendedRank(product) {
  const tags = Array.isArray(product?.tags) ? product.tags : [];
  for (const tag of tags) {
    const match = RECOMMENDED_TAG.exec(String(tag).trim().toLowerCase());
    if (match) return Number(match[1]);
  }
  return null;
}

export function isPopularProduct(product) {
  return recommendedRank(product) !== null || product?.popular === true;
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
