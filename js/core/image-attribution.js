// Créditos de fotos de producto con licencia abierta (CC BY / CC BY-SA).
//
// Una foto que no es propia ni cedida por la marca sólo se puede mostrar si se
// cumple su licencia. CC BY-SA 3.0 exige:
//   · nombrar al autor y la fuente;
//   · enlazar la licencia;
//   · avisar si la imagen se modificó.
//
// La base ya guarda la evidencia en `catalog_assets.rights_reference`, pero la
// tienda sólo lee `products`. Por eso el crédito visible vive acá, atado al hash
// del ARCHIVO ORIGINAL que se aprobó (`products.source_image_sha256`). Si la
// foto se reemplaza, el hash cambia y el crédito deja de aplicarse solo.
//
// Agregar una entrada es parte de aprobar una foto con licencia abierta: sin
// ella, el Panel no ofrece publicar el producto (ver business-catalog-editor).

const SHA256 = /^[a-f0-9]{64}$/;
const OPEN_LICENSE_REFERENCE = /\bCC[\s-]*BY\b/i;

function frozenAttribution(entry) {
  return Object.freeze({ ...entry });
}

export const IMAGE_ATTRIBUTIONS = Object.freeze({
  // Campari Bitter 750 ml. Foto de Open Food Facts (colaborador smoothie-app,
  // 2026-04-24), producto 7791200200781; se reemplazó el fondo por blanco.
  ccc2d1bac09400804fb83c9f54b7f15a7a082e3aa2e6ddcfaebb540efe77fe92: frozenAttribution({
    author: 'smoothie-app',
    source: 'Open Food Facts',
    sourceUrl: 'https://world.openfoodfacts.org/product/7791200200781',
    license: 'CC BY-SA 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/deed.es',
    changes: 'fondo reemplazado por blanco',
  }),
});

function httpsUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch (_) {
    return '';
  }
}

/**
 * El crédito de la foto aprobada de este producto, o `null` si no hay uno.
 * Acepta tanto el producto de la tienda (`sourceImageSha256`) como la fila de
 * la base (`source_image_sha256`). Un crédito sin enlaces HTTPS válidos no se
 * devuelve: mostrarlo a medias no cumple la licencia.
 */
export function imageAttributionFor(product, registry = IMAGE_ATTRIBUTIONS) {
  const hash = String(product?.sourceImageSha256 || product?.source_image_sha256 || '').trim().toLowerCase();
  if (!SHA256.test(hash) || !Object.prototype.hasOwnProperty.call(registry, hash)) return null;
  const entry = registry[hash];
  const sourceUrl = httpsUrl(entry?.sourceUrl);
  const licenseUrl = httpsUrl(entry?.licenseUrl);
  const author = String(entry?.author || '').trim();
  const source = String(entry?.source || '').trim();
  const license = String(entry?.license || '').trim();
  if (!sourceUrl || !licenseUrl || !source || !license) return null;
  return { author, source, sourceUrl, license, licenseUrl, changes: String(entry?.changes || '').trim() };
}

/** ¿La referencia de derechos aprobada declara una licencia CC que exige atribución? */
export function rightsReferenceRequiresAttribution(reference) {
  return OPEN_LICENSE_REFERENCE.test(String(reference || ''));
}

/** Texto plano del crédito, para lectores de pantalla, tests y documentación. */
export function imageAttributionText(attribution) {
  if (!attribution) return '';
  return [
    `Foto: ${attribution.source}${attribution.author ? ` (${attribution.author})` : ''}`,
    attribution.license,
    attribution.changes,
  ].filter(Boolean).join(' · ');
}
