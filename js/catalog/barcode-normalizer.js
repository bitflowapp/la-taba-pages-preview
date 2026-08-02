const GTIN_FORMATS = Object.freeze({
  8: 'EAN-8',
  12: 'UPC-A',
  13: 'EAN-13',
  14: 'GTIN-14',
});

export const SUPPORTED_GTIN_FORMATS = Object.freeze(Object.values(GTIN_FORMATS));

export function calculateGtinCheckDigit(body) {
  const digits = String(body ?? '').trim();
  if (!/^\d+$/.test(digits)) return null;
  let sum = 0;
  let weight = 3;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    sum += Number(digits[index]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return String((10 - (sum % 10)) % 10);
}

export function normalizeBarcode(rawValue, {
  allowedFormats = SUPPORTED_GTIN_FORMATS,
  allowInternalCodes = false,
  internalPattern = /^[A-Z0-9][A-Z0-9._-]{2,31}$/,
} = {}) {
  const raw = String(rawValue ?? '');
  const value = raw.trim();
  const allowed = new Set(Array.isArray(allowedFormats) ? allowedFormats : SUPPORTED_GTIN_FORMATS);
  const explicitInternal = allowInternalCodes
    && !/^\d+$/.test(value)
    && internalPattern instanceof RegExp
    && internalPattern.test(value);
  if (explicitInternal) {
    return Object.freeze({
      rawValue: raw,
      normalizedValue: value,
      format: 'INTERNAL',
      isValid: true,
      checkDigitValid: null,
      reason: '',
    });
  }
  const format = GTIN_FORMATS[value.length] || '';

  if (format) {
    const numeric = /^\d+$/.test(value);
    const expected = numeric ? calculateGtinCheckDigit(value.slice(0, -1)) : null;
    const checkDigitValid = numeric && expected === value.at(-1);
    const formatAllowed = allowed.has(format);
    return Object.freeze({
      rawValue: raw,
      normalizedValue: value,
      format,
      isValid: numeric && checkDigitValid && formatAllowed,
      checkDigitValid,
      reason: !numeric
        ? 'NON_NUMERIC_GTIN'
        : !checkDigitValid
          ? 'INVALID_CHECK_DIGIT'
          : !formatAllowed
            ? 'FORMAT_NOT_ALLOWED'
            : '',
    });
  }

  return Object.freeze({
    rawValue: raw,
    normalizedValue: value,
    format: '',
    isValid: false,
    checkDigitValid: false,
    reason: 'UNSUPPORTED_FORMAT',
  });
}

export function assertValidBarcode(rawValue, options) {
  const result = normalizeBarcode(rawValue, options);
  if (!result.isValid) {
    const error = new Error(`C\u00f3digo de barras inv\u00e1lido: ${result.reason}.`);
    error.code = result.reason;
    throw error;
  }
  return result;
}
