// Growth engine · RANKING DE PRODUCTOS.
// -----------------------------------------------------------------------------
// Ordena el primer nivel de merchandising con la misma afinidad agregada que
// usan las campañas. Es una hoja pura: no lee state, storage ni DOM.
//
// La disponibilidad se resuelve antes del score. Los productos no comprables
// siguen pudiendo aparecer en el catálogo para explicar su estado, pero nunca
// entran en la recomendación ni desplazan a un producto que sí se puede pedir.
import { isPurchasableBeverageProduct } from '../core/beverage-home-sections.js';
import { normalizedAffinity } from './intent-model.js';
import {
  CATEGORY_INTENT_THRESHOLD,
  PRODUCT_RANKING_WEIGHTS,
} from './growth-config.js';

function key(value) {
  return String(value || '').trim().toLowerCase();
}

function presentationKey(product) {
  const units = Number(product?.unitsPerPack);
  const count = Number.isFinite(units) && units > 1 ? `pack-${units}` : 'single';
  const packageType = key(product?.packageType || product?.unitLabel || '');
  const capacity = [product?.capacityValue, product?.capacityUnit]
    .map((value) => key(value))
    .filter(Boolean)
    .join('-');
  return [count, packageType, capacity].filter(Boolean).join(':');
}

function affinityValue(bucket, value) {
  return Number(bucket?.[key(value)]) || 0;
}

function bestCategoryAffinity(product, affinity) {
  const ids = [product?.categoryId, ...(Array.isArray(product?.categoryIds) ? product.categoryIds : [])]
    .map(key)
    .filter(Boolean);
  return Math.max(0, ...ids.map((id) => affinityValue(affinity?.categories, id)));
}

function merchandisingScore(product) {
  let score = 0;
  if (product?.featured) score += 2;
  if (product?.popular) score += 2;
  if (Number(product?.regularPrice) > Number(product?.price) && Number(product?.price) > 0) score += 1;
  if (product?.chilled || product?.refrigerated) score += 1;
  return score;
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

/**
 * Score individual de merchandising. `available` es deliberadamente parte del
 * resultado: el consumidor de ranking debe poder auditar que el gate ocurrió
 * antes de ordenar.
 */
export function scoreProduct(product, { affinity = null } = {}) {
  const categoryRaw = bestCategoryAffinity(product, affinity);
  const brandRaw = affinityValue(affinity?.brands, product?.brand);
  const productRaw = affinityValue(affinity?.products, product?.id);
  const available = isPurchasableBeverageProduct(product);
  const category = normalizedAffinity(categoryRaw) * PRODUCT_RANKING_WEIGHTS.categoryIntent;
  const brand = normalizedAffinity(brandRaw) * PRODUCT_RANKING_WEIGHTS.brandIntent;
  const productIntent = normalizedAffinity(productRaw) * PRODUCT_RANKING_WEIGHTS.productIntent;
  const merchandising = merchandisingScore(product) * PRODUCT_RANKING_WEIGHTS.merchandising;
  const availability = available ? PRODUCT_RANKING_WEIGHTS.availability : 0;
  const explain = [
    { factor: 'category intent', value: round2(category), rawAffinity: round2(categoryRaw) },
    { factor: 'brand intent', value: round2(brand), rawAffinity: round2(brandRaw) },
    { factor: 'product intent', value: round2(productIntent), rawAffinity: round2(productRaw) },
    { factor: 'merchandising', value: round2(merchandising) },
  ];
  if (availability) explain.push({ factor: 'availability', value: round2(availability) });
  return {
    product,
    available,
    categoryAffinity: normalizedAffinity(categoryRaw),
    intentScore: category + brand + productIntent,
    score: available ? category + brand + productIntent + merchandising + availability : Number.NEGATIVE_INFINITY,
    explain,
  };
}

function hasMeaningfulIntent(entries) {
  return entries.some((entry) => (
    entry.categoryAffinity >= CATEGORY_INTENT_THRESHOLD
    || entry.explain.some((factor) => factor.factor === 'brand intent' && factor.rawAffinity > 0 && factor.value > 0)
    || entry.explain.some((factor) => factor.factor === 'product intent' && factor.rawAffinity > 0 && factor.value > 0)
  ));
}

function stableProductId(product) {
  return key(product?.id || product?.sku || product?.name);
}

/**
 * Devuelve candidatos comprables ya ordenados y deja los no comprables al
 * final, conservando su orden de catálogo. Con cold start devuelve la lista
 * original: la vidriera general no se disfraza de personalización.
 */
export function rankProductCandidates(products = [], { affinity = null } = {}) {
  const input = Array.isArray(products) ? products : [];
  const scored = input.map((product, index) => ({
    ...scoreProduct(product, { affinity }),
    index,
  }));
  if (!hasMeaningfulIntent(scored)) {
    return scored.map((entry) => ({ ...entry, adjustedScore: entry.score }));
  }

  const available = scored.filter((entry) => entry.available);
  const unavailable = scored.filter((entry) => !entry.available);
  const picked = [];
  const remaining = [...available];
  const pickedBrands = new Set();
  const pickedCategories = new Set();
  const pickedPresentations = new Set();

  while (remaining.length) {
    const adjusted = remaining.map((entry) => {
      const brandKey = key(entry.product?.brand);
      const categoryKey = key(entry.product?.categoryId);
      const productPresentationKey = presentationKey(entry.product);
      const repeatBrand = brandKey && pickedBrands.has(brandKey);
      const repeatCategory = categoryKey && pickedCategories.has(categoryKey);
      const repeatPresentation = productPresentationKey && pickedPresentations.has(productPresentationKey);
      const diversityPenalty = (
        (repeatBrand ? PRODUCT_RANKING_WEIGHTS.diversityRepeatBrand : 0)
        + (repeatCategory && !repeatBrand ? PRODUCT_RANKING_WEIGHTS.diversityRepeatCategory : 0)
        + (repeatPresentation ? PRODUCT_RANKING_WEIGHTS.diversityRepeatPresentation : 0)
      );
      return {
        ...entry,
        adjustedScore: entry.score - diversityPenalty,
        diversityPenalty,
      };
    }).sort((left, right) => (
      right.adjustedScore - left.adjustedScore
      || right.score - left.score
      || left.index - right.index
      || stableProductId(left.product).localeCompare(stableProductId(right.product), 'es')
    ));
    const winner = adjusted[0];
    picked.push(winner);
    const brand = key(winner.product?.brand);
    const category = key(winner.product?.categoryId);
    if (brand) pickedBrands.add(brand);
    if (category) pickedCategories.add(category);
    const productPresentationKey = presentationKey(winner.product);
    if (productPresentationKey) pickedPresentations.add(productPresentationKey);
    remaining.splice(remaining.findIndex((entry) => entry.index === winner.index), 1);
  }

  return [...picked, ...unavailable].map((entry) => ({
    ...entry,
    explain: entry.diversityPenalty
      ? [...entry.explain, { factor: 'diversity', value: round2(-entry.diversityPenalty) }]
      : entry.explain,
  }));
}

export function rankProductsByIntent(products = [], options = {}) {
  return rankProductCandidates(products, options).map((entry) => entry.product);
}

export function explainProductRanking(ranked = []) {
  return (Array.isArray(ranked) ? ranked : []).map((entry) => ({
    productId: entry.product?.id || '',
    score: Number.isFinite(entry.adjustedScore) ? round2(entry.adjustedScore) : null,
    available: entry.available,
    factors: (entry.explain || []).map(({ factor, value }) => `${factor} ${value >= 0 ? '+' : ''}${value}`),
  }));
}
