// Se carga antes de los módulos de test. Nunca forma parte del bundle web.
import * as legacyQaCatalog from './fixtures/legacy-qa-catalog.mjs';

globalThis.__TABA_TEST_CATALOG__ = legacyQaCatalog;
