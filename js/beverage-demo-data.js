/*
 * DEMO · qué catálogo le entrega la vitrina al navegador
 * ─────────────────────────────────────────────────────────────────────────────
 * Tres superficies, en orden de prioridad ESTRICTA:
 *
 *   1. `globalThis.__TABA_TEST_CATALOG__` — los tests Node inyectan su catálogo
 *      aislado antes de importar la aplicación. Gana SIEMPRE, esté o no metida
 *      la bandera de vitrina: un test no puede verse sorprendido por datos de
 *      revisión comercial.
 *
 *   2. `?demo=1&vitrina=neuquen20261024` — la góndola de Neuquén (52 SKU) como
 *      vista de revisión comercial. Es un PREVIEW: los precios son los vigentes
 *      de la autoridad y la propuesta de precios no entra. Con `&fotos=antes`
 *      toda la góndola se sirve con placeholder: es el antes, para la
 *      comparación visual con las fotos integradas. Sin la bandera NO cambia
 *      nada de lo que ya existe.
 *
 *   3. El catálogo demo aprobado (`approved-beverage-demo-data`): el modo demo
 *      de todo el mundo, byte por byte como siempre.
 *
 * Este módulo no conoce rutas de fixtures; la vitrina se activa sólo con URL
 * explícita y en navegador (en Node la búsqueda es inexistente y cae al modo 3).
 */
import * as approvedCatalog from './approved-beverage-demo-data.js';
import { isDemoMode } from './core/app-mode.js';
import {
  categories as vitrinaCategories,
  products as vitrinaProducts,
  PREVIEW_CATALOG_VERSION as vitrinaCatalogVersion,
  vitrinaSolicitada,
  fotosAntesSolicitadas,
} from './vitrina-neuquen-20261024.js';

const testCatalog = (
  globalThis.__TABA_TEST_CATALOG__
  && typeof globalThis.__TABA_TEST_CATALOG__ === 'object'
)
  ? globalThis.__TABA_TEST_CATALOG__
  : null;

const busquedaViva = (typeof window !== 'undefined' && window.location)
  ? window.location.search
  : '';
// La vitrina es material de revisión: exige el modo demostración EFECTIVO (demo
// pedido y despliegue no productivo), no sólo el parámetro. En producción
// `?demo=1` se ignora y con él la vitrina: catálogo, categorías y versión base.
const usarVitrina = !testCatalog && vitrinaSolicitada(busquedaViva) && isDemoMode(busquedaViva);

/*
 * El antes/después se decide UNA vez, al leer la URL: la góndola entera se sirve
 * en un modo o en el otro, nunca mezclada. Sacar la foto (no inventarla) es lo
 * único que cambia: la identidad, el precio y la disponibilidad son los mismos
 * en los dos modos, para que la comparación sea sólo visual.
 */
function gandolaSinFotos(filas) {
  return filas.map((fila) => {
    const {
      image: _image,
      imageThumbnail: _imageThumbnail,
      imageSha256: _imageSha256,
      imageThumbnailSha256: _imageThumbnailSha256,
      sourceImageSha256: _sourceImageSha256,
      imageWidth: _imageWidth,
      imageHeight: _imageHeight,
      thumbnailWidth: _thumbnailWidth,
      thumbnailHeight: _thumbnailHeight,
      ...resto
    } = fila;
    return resto;
  });
}

export const categories = testCatalog?.categories
  || (usarVitrina ? vitrinaCategories : approvedCatalog.categories);
export const products = testCatalog?.products
  || (usarVitrina
    ? (fotosAntesSolicitadas(busquedaViva) ? gandolaSinFotos(vitrinaProducts) : vitrinaProducts)
    : approvedCatalog.products);
export const PREVIEW_CATALOG_VERSION = testCatalog?.PREVIEW_CATALOG_VERSION
  || (usarVitrina ? vitrinaCatalogVersion : approvedCatalog.PREVIEW_CATALOG_VERSION);
