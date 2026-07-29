// El navegador siempre recibe los 22 productos aprobados. Los tests Node
// pueden inyectar un catálogo legacy aislado antes de importar la aplicación;
// este módulo no conoce ni importa rutas de fixtures.
import * as approvedCatalog from './approved-beverage-demo-data.js';

const testCatalog = (
  globalThis.__TABA_TEST_CATALOG__
  && typeof globalThis.__TABA_TEST_CATALOG__ === 'object'
)
  ? globalThis.__TABA_TEST_CATALOG__
  : null;

export const categories = testCatalog?.categories || approvedCatalog.categories;
export const products = testCatalog?.products || approvedCatalog.products;
export const PREVIEW_CATALOG_VERSION = testCatalog?.PREVIEW_CATALOG_VERSION || approvedCatalog.PREVIEW_CATALOG_VERSION;
