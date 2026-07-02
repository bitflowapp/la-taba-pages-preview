import { normalizeMoneyValue } from './pricing.js';
import { sanitizeText } from './validators.js';

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
