// Compatibilidad exclusiva para tests heredados. El runtime no importa este
// módulo; el bootstrap de Node inyecta el fixture antes de evaluarlo.
const testCatalog = globalThis.__TABA_TEST_CATALOG__;

if (!testCatalog) {
  throw new Error('beverage-qa-data.js is test-only and requires tests/test-bootstrap.mjs');
}

export const categories = testCatalog.categories;
export const products = testCatalog.products;
export const PREVIEW_CATALOG_VERSION = testCatalog.PREVIEW_CATALOG_VERSION;
