import { normalizeMoneyValue } from './pricing.js';
import { sanitizeText } from './validators.js';

export const PROMOTION_TYPES = Object.freeze([
  'precio_promocional',
  'descuento_porcentaje',
  'pack',
  'cantidad_fija',
  'envio_gratis',
]);

export const PROMOTION_APPROVAL_STATUSES = Object.freeze(['PENDIENTE', 'APROBADA']);

const PROMOTION_TYPE_SET = new Set(PROMOTION_TYPES);
const APPROVAL_STATUS_SET = new Set(PROMOTION_APPROVAL_STATUSES);

export const DEMO_COUPON_CODE = '';
export const DEMO_COUPON_PERCENT = 0;
export const PUBLIC_COUPONS_ENABLED = false;

export function normalizeCouponCode(value) {
  return sanitizeText(value, { fallback: '', maxLength: 24 })
    .replace(/\s+/g, '')
    .toUpperCase();
}

export function validateCouponCode(value) {
  const code = normalizeCouponCode(value);
  if (!code) {
    return { ok: false, code: '', discountPercent: 0, message: '' };
  }
  return {
    ok: false,
    code,
    discountPercent: 0,
    message: 'No hay cupones activos por el momento.',
  };
}

export function previewCouponDiscount(value, subtotal = 0) {
  const validation = validateCouponCode(value);
  const safeSubtotal = normalizeMoneyValue(subtotal, 0);
  const discountAmount = validation.ok
    ? Math.min(safeSubtotal, normalizeMoneyValue(safeSubtotal * (validation.discountPercent / 100), 0))
    : 0;
  return {
    ...validation,
    discountAmount,
  };
}

export function buildAppliedCoupon(value, subtotal = 0) {
  const preview = previewCouponDiscount(value, subtotal);
  if (!preview.ok || preview.discountAmount <= 0) return null;
  return {
    code: preview.code,
    discountPercent: preview.discountPercent,
    discountAmount: preview.discountAmount,
  };
}

export function normalizeOrderCoupon(rawCoupon = null, subtotal = 0, fallbackDiscount = 0) {
  const source = rawCoupon && typeof rawCoupon === 'object' ? rawCoupon : {};
  const code = normalizeCouponCode(source.code || source.couponCode || source.label || '');
  const discountPercent = Math.max(0, Math.floor(Number(source.discountPercent) || 0));
  const discountAmount = Math.min(
    normalizeMoneyValue(subtotal, 0),
    normalizeMoneyValue(source.discountAmount ?? fallbackDiscount, 0),
  );
  if (!code || discountAmount <= 0) return null;
  return {
    code,
    discountPercent,
    discountAmount,
  };
}

function normalizePromotionId(value, fallback = '') {
  return sanitizeText(value, { fallback, maxLength: 80 })
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeSkuList(value) {
  const candidates = Array.isArray(value) ? value : String(value || '').split(/[|,\s]+/);
  return [...new Set(candidates
    .map((sku) => sanitizeText(sku, { maxLength: 80 }))
    .filter(Boolean))].slice(0, 24);
}

function normalizeDate(value) {
  const candidate = sanitizeText(value, { maxLength: 40 });
  if (!candidate) return '';
  const timestamp = Date.parse(candidate);
  return Number.isFinite(timestamp) ? candidate : '';
}

function normalizeOptionalMoney(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return normalizeMoneyValue(numeric, 0);
}

function normalizeOptionalInteger(value, { min = 0, max = 9999 } = {}) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function normalizeBoolean(value, fallback = false) {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === 'si' || normalized === 'sí') return true;
    if (normalized === 'false' || normalized === 'no' || normalized === '') return false;
  }
  return fallback;
}

export function normalizePromotion(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const promotionType = sanitizeText(source.promotionType || source.promotion_type, {
    fallback: 'precio_promocional', maxLength: 40,
  });
  const requiredQuantity = normalizeOptionalInteger(
    source.requiredQuantity ?? source.required_quantity,
    { min: 1, max: 999 },
  ) || 1;
  const approvalStatus = sanitizeText(source.approvalStatus || source.approval_status, {
    fallback: 'PENDIENTE', maxLength: 20,
  }).toUpperCase();

  return {
    promoId: normalizePromotionId(source.promoId || source.promo_id),
    title: sanitizeText(source.title, { maxLength: 80 }),
    subtitle: sanitizeText(source.subtitle, { maxLength: 140 }),
    includedSkus: normalizeSkuList(source.includedSkus || source.included_skus),
    promotionType: PROMOTION_TYPE_SET.has(promotionType) ? promotionType : 'precio_promocional',
    regularPrice: normalizeOptionalMoney(source.regularPrice ?? source.regular_price),
    promotionalPrice: normalizeOptionalMoney(source.promotionalPrice ?? source.promotional_price),
    discountPercentage: normalizeOptionalInteger(source.discountPercentage ?? source.discount_percentage, { min: 0, max: 100 }),
    requiredQuantity,
    maximumUnits: normalizeOptionalInteger(source.maximumUnits ?? source.maximum_units, { min: 1, max: 999 }),
    validFrom: normalizeDate(source.validFrom ?? source.valid_from),
    validUntil: normalizeDate(source.validUntil ?? source.valid_until),
    active: normalizeBoolean(source.active),
    priority: normalizeOptionalInteger(source.priority, { min: -999, max: 999 }) || 0,
    imagePath: sanitizeText(source.imagePath || source.image_path, { maxLength: 220 }),
    terms: sanitizeText(source.terms, { maxLength: 240 }),
    previewOnly: normalizeBoolean(source.previewOnly ?? source.preview_only, true),
    approvalStatus: APPROVAL_STATUS_SET.has(approvalStatus) ? approvalStatus : 'PENDIENTE',
    approvalReference: sanitizeText(source.approvalReference || source.approval_reference, { maxLength: 160 }),
    sourceEvidence: sanitizeText(source.sourceEvidence || source.source_evidence, { maxLength: 240 }),
  };
}

export function normalizePromotionCollection(rawPromotions = []) {
  if (!Array.isArray(rawPromotions)) return [];
  const seen = new Set();
  const normalized = [];
  for (const raw of rawPromotions) {
    const promotion = normalizePromotion(raw);
    if (!promotion.promoId || seen.has(promotion.promoId)) continue;
    seen.add(promotion.promoId);
    normalized.push(promotion);
  }
  return normalized.slice(0, 100);
}

function promotionDateRangeIsValid(promotion) {
  if (!promotion.validFrom || !promotion.validUntil) return false;
  const from = Date.parse(promotion.validFrom);
  const until = Date.parse(promotion.validUntil);
  return Number.isFinite(from) && Number.isFinite(until) && until >= from;
}

function hasVerifiedCommercialValues(promotion) {
  if (!promotion.regularPrice || promotion.regularPrice <= 0) return false;
  if (promotion.promotionType === 'descuento_porcentaje') {
    return Number.isFinite(promotion.discountPercentage) && promotion.discountPercentage > 0;
  }
  if (promotion.promotionType === 'envio_gratis') return true;
  return Number.isFinite(promotion.promotionalPrice)
    && promotion.promotionalPrice >= 0
    && promotion.promotionalPrice < promotion.regularPrice;
}

export function validatePromotionForActivation(rawPromotion = {}) {
  const promotion = normalizePromotion(rawPromotion);
  const errors = [];
  if (!promotion.promoId) errors.push('Definí un identificador de promoción.');
  if (!promotion.title) errors.push('Indicá un título de promoción.');
  if (!promotion.includedSkus.length) errors.push('Seleccioná al menos un producto.');
  if (!promotion.previewOnly) errors.push('Las promociones de esta pantalla deben permanecer aisladas a preview.');
  if (promotion.approvalStatus !== 'APROBADA' || !promotion.approvalReference) {
    errors.push('Falta aprobación humana registrada.');
  }
  if (!promotionDateRangeIsValid(promotion)) errors.push('Definí vigencia de inicio y fin válida.');
  if (!hasVerifiedCommercialValues(promotion)) errors.push('Faltan precio, descuento o condición comercial verificable.');
  return { promotion, ok: errors.length === 0, errors };
}

function endOfPromotionDay(value) {
  if (!value) return NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return Date.parse(`${value}T23:59:59.999`);
  return Date.parse(value);
}

export function isPromotionActive(rawPromotion, now = new Date()) {
  const promotion = normalizePromotion(rawPromotion);
  const validation = validatePromotionForActivation(promotion);
  if (!promotion.active || !validation.ok) return false;
  const timestamp = now instanceof Date ? now.getTime() : Date.parse(now);
  const from = Date.parse(promotion.validFrom);
  const until = endOfPromotionDay(promotion.validUntil);
  return Number.isFinite(timestamp) && timestamp >= from && timestamp <= until;
}

export function getActivePromotions(promotions = [], now = new Date()) {
  return normalizePromotionCollection(promotions)
    .filter((promotion) => isPromotionActive(promotion, now))
    .sort((left, right) => right.priority - left.priority || left.promoId.localeCompare(right.promoId));
}

function eligibleLineItems(items = [], promotion) {
  return items.filter((item) => (
    item
      && promotion.includedSkus.includes(item.product?.id || item.productId)
      && Number(item.quantity) > 0
      && Number(item.product?.price ?? item.unitPrice) >= 0
  ));
}

function lineUnitPrice(item) {
  return normalizeMoneyValue(item.product?.price ?? item.unitPrice, 0);
}

function boundedEligibleQuantity(lines, maximumUnits) {
  const total = lines.reduce((sum, line) => sum + Math.max(0, Math.floor(Number(line.quantity) || 0)), 0);
  return maximumUnits ? Math.min(total, maximumUnits) : total;
}

function discountForEachUnit(lines, promotion, usedBySku) {
  let remaining = promotion.maximumUnits || Number.POSITIVE_INFINITY;
  let discount = 0;
  let matchedQuantity = 0;
  for (const line of lines) {
    const sku = line.product?.id || line.productId;
    const alreadyUsed = usedBySku.get(sku) || 0;
    const availableQuantity = Math.max(0, Math.floor(Number(line.quantity) || 0) - alreadyUsed);
    const quantity = Math.min(availableQuantity, remaining);
    if (quantity <= 0) continue;
    const unitPrice = lineUnitPrice(line);
    const perUnit = promotion.promotionType === 'descuento_porcentaje'
      ? Math.round(unitPrice * ((promotion.discountPercentage || 0) / 100))
      : Math.max(0, unitPrice - (promotion.promotionalPrice || 0));
    discount += perUnit * quantity;
    matchedQuantity += quantity;
    remaining -= quantity;
    usedBySku.set(sku, alreadyUsed + quantity);
  }
  return { discount, matchedQuantity };
}

function discountForBundle(lines, promotion, usedBySku) {
  const availableLines = lines.map((line) => {
    const sku = line.product?.id || line.productId;
    const used = usedBySku.get(sku) || 0;
    return { ...line, availableQuantity: Math.max(0, Math.floor(Number(line.quantity) || 0) - used) };
  });
  const totalAvailable = availableLines.reduce((sum, line) => sum + line.availableQuantity, 0);
  const required = promotion.requiredQuantity || 1;
  // maximumUnits limita unidades beneficiadas, no la cantidad de packs. Con
  // requiredQuantity=6 y maximumUnits=12, por ejemplo, se aplican dos packs.
  const eligibleQuantity = promotion.maximumUnits
    ? Math.min(totalAvailable, promotion.maximumUnits)
    : totalAvailable;
  const bundles = Math.floor(eligibleQuantity / required);
  if (bundles <= 0) return { discount: 0, matchedQuantity: totalAvailable, bundles: 0 };

  const theoreticalDiscount = Math.max(0, (promotion.regularPrice || 0) - (promotion.promotionalPrice || 0)) * bundles;
  let availableValue = 0;
  let unitsToReserve = bundles * required;
  for (const line of availableLines) {
    const quantity = Math.min(line.availableQuantity, unitsToReserve);
    if (quantity <= 0) continue;
    availableValue += lineUnitPrice(line) * quantity;
    unitsToReserve -= quantity;
    const sku = line.product?.id || line.productId;
    usedBySku.set(sku, (usedBySku.get(sku) || 0) + quantity);
  }
  return {
    discount: Math.min(theoreticalDiscount, availableValue),
    matchedQuantity: bundles * required,
    bundles,
  };
}

export function evaluatePromotions(items = [], promotions = [], { now = new Date() } = {}) {
  const activePromotions = getActivePromotions(promotions, now);
  const usedBySku = new Map();
  const applied = [];
  let discountTotal = 0;
  let freeDelivery = false;

  for (const promotion of activePromotions) {
    const lines = eligibleLineItems(items, promotion);
    if (!lines.length) continue;
    const availableQuantity = boundedEligibleQuantity(lines, promotion.maximumUnits);
    if (availableQuantity < promotion.requiredQuantity) continue;

    let result = { discount: 0, matchedQuantity: availableQuantity, bundles: 0 };
    if (promotion.promotionType === 'envio_gratis') {
      freeDelivery = true;
    } else if (promotion.promotionType === 'pack' || promotion.promotionType === 'cantidad_fija') {
      result = discountForBundle(lines, promotion, usedBySku);
    } else {
      result = discountForEachUnit(lines, promotion, usedBySku);
    }
    if (promotion.promotionType !== 'envio_gratis' && result.discount <= 0) continue;
    discountTotal += result.discount;
    applied.push({
      promoId: promotion.promoId,
      title: promotion.title,
      promotionType: promotion.promotionType,
      discountAmount: result.discount,
      matchedQuantity: result.matchedQuantity,
      ...(result.bundles ? { bundles: result.bundles } : {}),
      terms: promotion.terms || formatPromotionCondition(promotion),
    });
  }
  return { discountTotal, freeDelivery, applied, activePromotions };
}

export function formatPromotionCondition(rawPromotion = {}) {
  const promotion = normalizePromotion(rawPromotion);
  if (promotion.promotionType === 'envio_gratis') return 'Envío sin cargo';
  if (promotion.promotionType === 'descuento_porcentaje') return `${promotion.discountPercentage || 0}% de descuento`;
  if (promotion.promotionType === 'pack' || promotion.promotionType === 'cantidad_fija') {
    return `Llevando ${promotion.requiredQuantity} unidades`;
  }
  return 'Precio promocional';
}

export function getProductPromotion(productId, promotions = [], now = new Date()) {
  return getActivePromotions(promotions, now)
    .find((promotion) => promotion.includedSkus.includes(productId)) || null;
}

export function findPromotionConflicts(rawPromotion, rawPromotions = []) {
  const candidate = normalizePromotion(rawPromotion);
  if (!candidate.validFrom || !candidate.validUntil || !candidate.includedSkus.length) return [];
  const candidateStart = Date.parse(candidate.validFrom);
  const candidateEnd = endOfPromotionDay(candidate.validUntil);
  if (!Number.isFinite(candidateStart) || !Number.isFinite(candidateEnd)) return [];

  return normalizePromotionCollection(rawPromotions).filter((other) => {
    if (!other.active || other.promoId === candidate.promoId) return false;
    if (!other.validFrom || !other.validUntil) return false;
    const otherStart = Date.parse(other.validFrom);
    const otherEnd = endOfPromotionDay(other.validUntil);
    const datesOverlap = Number.isFinite(otherStart)
      && Number.isFinite(otherEnd)
      && candidateStart <= otherEnd
      && otherStart <= candidateEnd;
    const skuOverlap = other.includedSkus.some((sku) => candidate.includedSkus.includes(sku));
    return datesOverlap && skuOverlap;
  });
}
