import { assertValidBarcode } from './barcode-normalizer.js';

export function createProductLookupService({ providers = [] } = {}) {
  const orderedProviders = providers.filter((provider) => typeof provider?.lookup === 'function');
  return Object.freeze({
    async lookup(rawCode, context = {}) {
      const barcode = assertValidBarcode(rawCode, context.barcodeOptions);
      const attempts = [];
      for (const provider of orderedProviders) {
        const source = String(provider.name || provider.constructor?.name || 'provider');
        try {
          const result = await provider.lookup(barcode.normalizedValue, context);
          attempts.push({ source, status: result ? 'found' : 'not_found' });
          if (result) return normalizeLookupResult(result, barcode, source, attempts);
        } catch (error) {
          attempts.push({ source, status: 'unavailable', code: String(error?.code || 'PROVIDER_ERROR') });
        }
      }
      return Object.freeze({
        kind: 'unknown',
        barcode,
        message: 'Producto no identificado autom\u00e1ticamente',
        attempts: Object.freeze(attempts),
      });
    },
  });
}

function normalizeLookupResult(result, barcode, source, attempts) {
  const confidence = Number(result.confidence);
  return Object.freeze({
    kind: result.productId ? 'local_product' : 'suggestion',
    barcode,
    productId: String(result.productId || ''),
    suggestedName: String(result.name || '').trim(),
    suggestedBrand: String(result.brand || '').trim(),
    suggestedPresentation: String(result.presentation || '').trim(),
    suggestedCategory: String(result.category || '').trim(),
    suggestedImage: String(result.image || '').trim(),
    packageType: String(result.packageType || 'unit'),
    unitFactor: positiveInteger(result.unitFactor, 1),
    stock: Number.isInteger(result.stock) ? result.stock : null,
    source,
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
    requiresConfirmation: result.verified !== true,
    attempts: Object.freeze([...attempts]),
  });
}

function positiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : fallback;
}
