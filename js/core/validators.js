const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const PAYMENT_METHODS = new Set(['coordinate', 'cash', 'transfer', 'mercado_pago_future']);

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

export function normalizePaymentMethod(value, fallback = 'coordinate') {
  const candidate = sanitizeText(value, { fallback, maxLength: 40 });
  return PAYMENT_METHODS.has(candidate) ? candidate : fallback;
}

export function hasText(value) {
  return sanitizeText(value).length > 0;
}

export function normalizePhoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

export function isValidArgentinePhone(value) {
  const digits = normalizePhoneDigits(value);
  return digits.length >= 10
    && digits.length <= 13
    && !/^(\d)\1+$/.test(digits);
}

export function isPlausibleStreetAddress(value) {
  const text = sanitizeText(value, { maxLength: 120 });
  return text.length >= 6 && /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(text) && /\d/.test(text);
}

export function isValidDeliveryZone(value) {
  return sanitizeText(value, { maxLength: 80 }).length >= 3;
}
