/*
 * FOTOGRAFÍA EDITORIAL: SÓLO SE PUBLICA CON AUTORIZACIÓN COMERCIAL DOCUMENTADA.
 *
 * Qué problema cierra
 * -------------------
 * Los banners de la home, la banda del hero y las historias usan 19 fotografías
 * de `assets/promos/` que salen de portfolios y sitios de terceros (otaphotography.com,
 * behance.net, schweppes.it, passionspirits.com, kotyhu.com): el manifiesto
 * `docs/catalog/promo-image-manifest.json` conserva la página fuente de cada una,
 * y eso acredita DE DÓNDE vienen, no que La Taba tenga derecho a usarlas en una
 * tienda que vende. La única autorización declarada (`TABA-AUT-2026-08-001`,
 * catalog/autorizaciones-comerciales.json) cubre imágenes de producto con fondo
 * blanco (packshot) de las marcas y sus fabricantes: otro formato, otra
 * contraparte. Una imagen pública, o su SHA-256, no es un permiso.
 *
 * Qué hace
 * --------
 * En PRODUCCIÓN, una foto de `assets/promos/` sólo se pinta si su ruta figura en
 * `CLEARED_PROMO_PHOTOS`, y esa lista sólo admite piezas cuyo manifiesto declara
 * `derechos_comerciales.estado = "DOCUMENTADOS"` con su referencia
 * (`tests/promo-rights.test.mjs` exige que las dos listas coincidan). Hoy no hay
 * ninguna: los banners salen con su copy y su puerta de categoría, sin foto, y el
 * hero con su fondo de marca. En demostración y en el recorrido guiado todo se ve
 * como siempre: ahí las piezas son material de muestra, y el aviso de modo
 * demostración lo dice.
 *
 * Cómo se habilita una pieza: el responsable del negocio documenta la
 * autorización (quién la cede, alcance, referencia), se completa el campo del
 * manifiesto y la ruta se agrega acá. Las fotos de PRODUCTO no pasan por acá: las
 * gobierna su propio estado de derechos (`productPhotoIsOfficial`).
 */
import { isProductionMode } from './app-mode.js';

const EDITORIAL_PREFIX = 'assets/promos/';

// Vacío a propósito: ninguna pieza editorial tiene hoy autorización comercial documentada.
export const CLEARED_PROMO_PHOTOS = Object.freeze(new Set([]));

function normalize(path) {
  return String(path || '').replace(/^\.?\//, '').split(/[?#]/)[0];
}

export function isEditorialPromoPath(path) {
  return normalize(path).startsWith(EDITORIAL_PREFIX);
}

export function promoPhotoCleared(path, { production = isProductionMode() } = {}) {
  const key = normalize(path);
  if (!key.startsWith(EDITORIAL_PREFIX)) return true;
  if (!production) return true;
  return CLEARED_PROMO_PHOTOS.has(key);
}
