const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const PAYMENT_METHODS = new Set(['cash', 'transfer', 'mercado_pago_future']);

export function sanitizeText(value, { fallback = '', maxLength = 160 } = {}) {
  const raw = value == null ? '' : String(value);
  const cleaned = raw
    .replace(CONTROL_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim();
  const safe = cleaned || fallback;
  return safe.slice(0, maxLength);
}

export function sanitizeNotes(value, fallback = 'Sin notas') {
  return sanitizeText(value, { fallback, maxLength: 360 });
}

export function normalizePaymentMethod(value, fallback = 'cash') {
  const candidate = sanitizeText(value, { fallback, maxLength: 40 });
  return PAYMENT_METHODS.has(candidate) ? candidate : fallback;
}

export function hasText(value) {
  return sanitizeText(value).length > 0;
}
