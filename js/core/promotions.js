import { normalizeMoneyValue } from './pricing.js';
import { sanitizeText } from './validators.js';

export const DEMO_COUPON_CODE = 'TABA10';
export const DEMO_COUPON_PERCENT = 10;

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
  if (code === DEMO_COUPON_CODE) {
    return {
      ok: true,
      code: DEMO_COUPON_CODE,
      discountPercent: DEMO_COUPON_PERCENT,
      message: 'Cupon TABA10 aplicado.',
    };
  }
  return {
    ok: false,
    code,
    discountPercent: 0,
    message: 'Cupon invalido. En esta demo podes usar TABA10.',
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
