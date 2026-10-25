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

/*
 * Clave canónica `assets/promos/<archivo>` de una referencia, o '' si no es
 * fotografía editorial. Las historias llegan del backend con la URL que haya
 * guardado el comercio, así que la MISMA pieza puede venir absoluta, desde otro
 * host de La Taba, con `//host`, con `..`, codificada, en mayúsculas o con
 * barras invertidas: se resuelve como URL, se decodifica y se busca el segmento
 * `/assets/promos/` en cualquier posición y en cualquier host. Lo que no se deja
 * resolver y aun así menciona `promos` se trata como editorial (falla cerrado).
 * También se mira la consulta: un proxy de imágenes (`/p?url=…/assets/promos/x`)
 * bajaría la misma pieza de nuestro origen. El hash no se mira: no se envía.
 */
const UNRESOLVED = 'assets/promos/<sin-resolver>';

/*
 * Una referencia que ROMPE EL CONTEXTO donde se pinta no es una ruta: es texto que
 * intenta salirse de él. La miniatura de una historia se interpola en
 * `style="background-image:url('…')"`, y un valor como
 * `x');background-image:url('assets/promos/<archivo>` cierra el `url()` y agrega un
 * segundo `background-image` editorial. Ningún control de ruta lo veía: delante de
 * `assets` no hay una barra, hay una comilla. Una referencia que mencione `promos` y
 * traiga comillas, paréntesis, punto y coma, ángulos, acento grave o llaves se trata
 * como editorial sin resolver (falla cerrado). Una URL legítima con paréntesis, como
 * `foto(1).webp` en Storage, no menciona `promos` y sigue pasando. El escape real del
 * valor está en `js/core/css-url.js`; esto es la segunda capa.
 */
const ROMPE_CONTEXTO = /['"();<>`{}]/;

function decodificarTodo(texto) {
  let actual = texto;
  for (let i = 0; i < 3 && /%[0-9a-f]{2}/i.test(actual); i += 1) {
    try {
      actual = decodeURIComponent(actual);
    } catch (_) {
      break;
    }
  }
  return actual;
}

export function editorialPromoKey(path) {
  const raw = String(path ?? '').replace(/[\u0000-\u0020]+/g, '').replace(/\\/g, '/');
  if (!raw) return '';
  const decodificada = decodificarTodo(raw);
  if (ROMPE_CONTEXTO.test(decodificada) && /promos/i.test(decodificada)) return UNRESOLVED;
  let pathname;
  let search;
  try {
    ({ pathname, search } = new URL(raw, 'https://origen.invalid/'));
  } catch (_) {
    return /promos/i.test(raw) ? UNRESOLVED : '';
  }
  // Hasta tres pasadas: `%252F` es `%2F` codificado otra vez.
  for (let i = 0; i < 3 && /%[0-9a-f]{2}/i.test(pathname); i += 1) {
    try {
      pathname = decodeURIComponent(pathname);
    } catch (_) {
      return /promos/i.test(pathname) ? UNRESOLVED : '';
    }
  }
  // Lo decodificado puede traer `/`, `\` o `..` nuevos: se vuelve a resolver.
  try {
    pathname = new URL(pathname.replace(/\\/g, '/').replace(/\/{2,}/g, '/'), 'https://origen.invalid/').pathname;
  } catch (_) {
    return /promos/i.test(pathname) ? UNRESOLVED : '';
  }
  const lower = pathname.toLowerCase().replace(/\/{2,}/g, '/');
  const at = lower.indexOf(`/${EDITORIAL_PREFIX}`);
  if (at >= 0) return lower.slice(at + 1);
  return editorialKeyInQuery(search);
}

function editorialKeyInQuery(search) {
  let query = String(search || '');
  for (let i = 0; i < 3 && /%[0-9a-f]{2}/i.test(query); i += 1) {
    try {
      query = decodeURIComponent(query);
    } catch (_) {
      return /promos/i.test(query) ? UNRESOLVED : '';
    }
  }
  query = query.replace(/\\/g, '/').replace(/\/{2,}/g, '/').toLowerCase();
  const at = query.indexOf(EDITORIAL_PREFIX);
  if (at < 0) return '';
  // La pieza envuelta llega hasta el próximo separador de la consulta.
  const wrapped = query.slice(at).split(/[?&#\s"'<>]/)[0];
  return editorialPromoKey(wrapped) || UNRESOLVED;
}

export function isEditorialPromoPath(path) {
  return Boolean(editorialPromoKey(path));
}

const CLEARED_KEYS = new Set([...CLEARED_PROMO_PHOTOS].map((key) => key.toLowerCase()));

export function promoPhotoCleared(path, { production = isProductionMode() } = {}) {
  const key = editorialPromoKey(path);
  if (!key) return true;
  if (!production) return true;
  return CLEARED_KEYS.has(key);
}

/*
 * Una historia se publica sólo si su medio Y su miniatura (que también es el
 * póster del video) pasan la compuerta. Se descarta entera: una historia sin su
 * foto no tiene nada que mostrar, y pintarla a medias seguiría pidiendo la pieza.
 */
export function storyMediaCleared(story, options = {}) {
  if (!story || typeof story !== 'object') return false;
  return promoPhotoCleared(story.mediaUrl, options) && promoPhotoCleared(story.thumbnailUrl, options);
}
