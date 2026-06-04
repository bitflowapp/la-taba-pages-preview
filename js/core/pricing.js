import { BUSINESS_CONFIG } from '../config.js';

export function normalizeDeliveryMode(value) {
  return value === 'pickup' ? 'pickup' : 'delivery';
}

export function normalizeStock(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.floor(numeric));
}

export function normalizeQuantity(value, fallback = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.floor(numeric));
}

export function normalizeMoneyValue(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.round(numeric));
}

export function getDeliveryFeeForMode(deliveryMode = 'delivery') {
  return normalizeDeliveryMode(deliveryMode) === 'pickup' ? 0 : normalizeMoneyValue(BUSINESS_CONFIG.deliveryFee);
}

export function calculateItemsSubtotal(items = []) {
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, item) => {
    const rawQuantity = Number(item?.quantity);
    const quantity = Number.isFinite(rawQuantity) ? Math.max(0, Math.floor(rawQuantity)) : 0;
    const unitPrice = normalizeMoneyValue(item?.unitPrice ?? item?.product?.price, 0);
    return sum + quantity * unitPrice;
  }, 0);
}

export function normalizeDiscountAmount(value, subtotal = 0) {
  const safeSubtotal = normalizeMoneyValue(subtotal, 0);
  const discount = normalizeMoneyValue(value, 0);
  return Math.min(safeSubtotal, discount);
}

export function calculateTotals(itemsOrSubtotal = [], deliveryMode = 'delivery', options = {}) {
  const subtotal = Array.isArray(itemsOrSubtotal)
    ? calculateItemsSubtotal(itemsOrSubtotal)
    : normalizeMoneyValue(itemsOrSubtotal, 0);
  const deliveryFee = getDeliveryFeeForMode(deliveryMode);
  const discountTotal = normalizeDiscountAmount(options.discountAmount ?? options.discountTotal, subtotal);
  return {
    subtotal,
    discountTotal,
    deliveryFee,
    total: Math.max(0, subtotal - discountTotal) + deliveryFee,
  };
}
