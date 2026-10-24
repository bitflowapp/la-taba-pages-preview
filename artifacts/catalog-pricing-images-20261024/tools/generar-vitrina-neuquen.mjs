/*
 * GENERADOR · Vitrina Neuquén 2026-10-24 (vista local funcional de la góndola).
 *
 * PARA QUÉ
 * --------
 * La góndola comercial de Neuquén (52 SKU, `catalog/gondola-neuquen.mjs`) no está
 * publicada en ningún storefront —sólo se carga tras aprobación comercial—. Para
 * poder REVISARLA Y COMPRARLA visualmente (con fotos reales, precios vigentes,
 * búsqueda, categorías, carrito y fichas), este script genera un catálogo
 * PREVIEW que la vitrina real del storefront sirve con `?demo=1&vitrina=neuquen20261024`.
 *
 * DE DÓNDE SALE CADA DATO (sin inventar nada):
 *   · identidad, presentación y precio ...... la autoridad de la góndola
 *   · imagen, hashes y derechos ............. docs/catalog/image-manifest.json
 *     (42 SKU con cadena completa) y el mapa auditado docs/catalog/
 *     gondola-publica-imagenes.json (29 de esos 42 además están auditados).
 *   · los 10 SKU sin foto verificada quedan FALLBACK con placeholder propio de
 *     TABA (estado honesto) y un motivo escrito. NO se les busca una imagen
 *     parecida: una imagen parecida es una imagen incorrecta.
 *
 * REGENERAR:
 *   node artifacts/catalog-pricing-images-20261024/tools/generar-vitrina-neuquen.mjs
 *
 * Qué toca: sólo escribe `js/vitrina-neuquen-20261024.js` y el resumen JSON al
 * lado de este script. No toca catálogo, ni base, ni storefront runtime
 * (el gancho de activación es una bandera de URL, ver beverage-demo-data).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GONDOLA } from '../../../catalog/gondola-neuquen.mjs';
import { detectCatalogImageMime, readCatalogImageDimensions } from '../../../js/core/catalog-image-contract.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const leer = (ruta) => JSON.parse(fs.readFileSync(path.join(RAIZ, ruta), 'utf8'));

const MANIFIESTO = leer('docs/catalog/image-manifest.json').sources;
const MAPA_AUDITADO = leer('docs/catalog/gondola-publica-imagenes.json').filas;

const porSkuManifiesto = new Map(MANIFIESTO.map((fila) => [fila.sku, fila]));
const porSkuAuditoria = new Map(MAPA_AUDITADO.map((fila) => [fila.sku, fila]));

/** Categorías de la góndola → ids de la taxonomía de la tienda. */
const CATEGORIA_ID = Object.freeze({
  Gaseosas: 'gaseosas',
  Mixers: 'mixers',
  Aguas: 'aguas',
  'Aguas saborizadas': 'aguas-saborizadas',
  Energizantes: 'energizantes',
  Isotónicas: 'isotonicas',
  Cervezas: 'cervezas',
  Fernet: 'fernet',
  Aperitivos: 'aperitivos',
  Vinos: 'vinos',
  Destilados: 'destilados',
});

const MOTIVO_SIN_FOTO = 'Sin fuente de fabricante/distribuidor auditada en la allowlist. No se publica una imagen parecida; se resuelve con foto propia del comercio o aprobación por activo.';

const errores = [];
const conFoto = [];
const conFotoAuditada = [];
const sinFoto = [];

const productos = GONDOLA.map((fila) => {
  const alcoholic = fila.alcoholic === true;
  const soldAsPack = fila.soldAsPack === true;
  const categoryId = CATEGORIA_ID[fila.category];
  if (!categoryId) errores.push(`${fila.sku}: categoría desconocida "${fila.category}"`);

  const manifiesto = porSkuManifiesto.get(fila.sku);
  const auditoria = porSkuAuditoria.get(fila.sku);
  const master = manifiesto?.assets?.master;
  const thumbnail = manifiesto?.assets?.thumbnail;

  const base = {
    id: fila.sku,
    sku: fila.sku,
    externalId: fila.sku,
    brand: fila.brand,
    name: fila.name,
    variant: fila.variant,
    categoryId,
    subcategory: fila.subcategory,
    description: fila.description,
    presentation: fila.presentation,
    capacity: fila.capacity,
    capacityValue: fila.capacityValue,
    capacityUnit: fila.capacityUnit,
    packageType: fila.packagingType,
    unit: soldAsPack ? 'pack' : 'unidad',
    unitLabel: soldAsPack ? `Pack x${fila.unitsPerPack}` : 'Unidad',
    unitsPerPack: fila.unitsPerPack,
    soldAsPack,
    // PRECIO: el vigente de la autoridad. La propuesta (conflictos de margen y
    // pendientes) NO entra: vive en artifacts + ficha, pendiente de aprobación.
    price: fila.price,
    pricePending: false,
    stock: fila.stock,
    available: true,
    sourceAvailable: true,
    stockStatus: 'BUSINESS_CONFIRMATION_REQUIRED',
    requiresBusinessConfirmation: true,
    chilled: fila.chilled === true,
    alcoholic,
    requiresAgeConfirmation: alcoholic,
    minimumAge: alcoholic ? (fila.minimumAge || 18) : null,
    tags: fila.tags,
    recommendationTags: fila.tags,
    prepMinutes: 10,
    sortOrder: fila.sortOrder,
    // Proveniencia de la vitrina (para revisión comercial y QA).
    vitrinaCobertura: 'FALBACK',
  };

  if (master && thumbnail && master.sha256 && thumbnail.sha256 && manifiesto.sourceSha256) {
    // El mapa auditado no puede contradecir al manifiesto: misma foto o error.
    if (auditoria?.imageUrl && auditoria.imageUrl !== master.path) {
      errores.push(`${fila.sku}: mapa auditado y manifiesto no coinciden (${auditoria.imageUrl} vs ${master.path})`);
    }
    // La compuerta productPhotoIsOfficial exige WEbp real: confirmamos en frío.
    const rutaMaster = path.join(RAIZ, master.path);
    const bytes = fs.readFileSync(rutaMaster);
    if (detectCatalogImageMime(bytes) !== 'image/webp') errores.push(`${fila.sku}: master no es webp`);
    const dims = readCatalogImageDimensions(bytes, 'image/webp');
    if (!dims || dims.width !== master.width || dims.height !== master.height) {
      errores.push(`${fila.sku}: dimensiones del master difieren del manifiesto`);
    }

    conFoto.push(fila.sku);
    if (auditoria?.imageUrl) conFotoAuditada.push(fila.sku);
    return {
      ...base,
      vitrinaCobertura: auditoria?.imageUrl ? 'AUDITADA' : 'MANIFIESTO_PREPARADO',
      image: master.path,
      imageThumbnail: thumbnail.path,
      imageSha256: master.sha256,
      imageThumbnailSha256: thumbnail.sha256,
      sourceImageSha256: manifiesto.sourceSha256,
      imageWidth: master.width,
      imageHeight: master.height,
      thumbnailWidth: thumbnail.width,
      thumbnailHeight: thumbnail.height,
      rightsStatus: manifiesto.rightsStatus,
      imageRightsReference: manifiesto.rightsReference,
      imageSourceType: manifiesto.sourceType,
      imageSourceUrl: manifiesto.sourceUrl,
      imageClasificacion: auditoria?.clasificacion || 'MANIFIESTO_PREPARADO',
    };
  }

  if (auditoria?.imageUrl) errores.push(`${fila.sku}: el mapa auditado trae imagen que el manifiesto no respalda`);
  sinFoto.push(fila.sku);
  return { ...base, imagePendiente: true, imagePendienteMotivo: MOTIVO_SIN_FOTO };
});

if (errores.length) {
  console.error('ERRORES DE CONSISTENCIA:\n' + errores.map((e) => ` ✗ ${e}`).join('\n'));
  process.exit(1);
}

const categoriasUsadas = [];
for (const fila of GONDOLA) {
  const id = CATEGORIA_ID[fila.category];
  if (!categoriasUsadas.some((c) => c.id === id)) {
    categoriasUsadas.push({ id, name: fila.category });
  }
}
const categories = [{ id: 'all', name: 'Todos' }, ...categoriasUsadas];

const meta = {
  version: 'vitrina-neuquen-20261024-v1',
  generadoPor: 'artifacts/catalog-pricing-images-20261024/tools/generar-vitrina-neuquen.mjs',
  generadoEl: '2026-10-24',
  autoridades: [
    'catalog/gondola-neuquen.mjs (52 SKU, precios vigentes)',
    'docs/catalog/image-manifest.json (assets, hashes y derechos)',
    'docs/catalog/gondola-publica-imagenes.json (mapa auditado: 29 de los 42)',
  ],
  derechos: 'TABA-AUT-2026-08-001 · LICENCIA_COMERCIAL (42/52)',
  precios: 'Vigentes del criterio publicado (costo × 1,45 / × 1,35 pack). La propuesta comercial quedó pendiente de aprobación y NO entra a la vitrina.',
  compuertasModoDemo: {
    activar: '?demo=1&vitrina=neuquen20261024',
    antes: '?demo=1&vitrina=neuquen20261024&fotos=antes (placeholder en toda la góndola, como estaría sin el trabajo de fotos)',
  },
  skus: GONDOLA.length,
  conFoto: conFoto.length,
  conFotoAuditada: conFotoAuditada.length,
  sinFoto: [...sinFoto],
};

// ── Serialización estable (JSON es un literal de objeto JS válido) ───────────
const modulo = `// Generado por scripts de artifacts. NO editar manualmente.
// Vitrina Neuquén 2026-10-24: la góndola comercial autoridad (52 SKU) con sus
// fotos reales verificadas, lista para la vitrina del storefront en modo demo.
//
//   activación:  index.html?demo=1&vitrina=neuquen20261024
//   antes/despu:  ...&fotos=antes   (toda la góndola con placeholder)
//   sin bandera:  el catálogo demo aprobado sirve como siempre (sin cambios).
//
// Los precios son LOS VIGENTES de catalog/gondola-neuquen.mjs. La propuesta de
// precios commerciale (conflictos de margen y pendientes) no está acá: vive en
// artifacts/catalog-pricing-images-20261024/{propuesta-precios.json,ficha/} y
// espera aprobación del comercio (estadoGeneral pendiente_aprobacion_comercial).

export const VITRINA_ID = 'neuquen20261024';

export const vitrinaSolicitada = (search = '') => {
  try {
    return new URLSearchParams(String(search || '')).get('vitrina') === VITRINA_ID;
  } catch (_) {
    return false;
  }
};

export const fotosAntesSolicitadas = (search = '') => {
  try {
    return new URLSearchParams(String(search || '')).get('fotos') === 'antes';
  } catch (_) {
    return false;
  }
};

export const VITRINA_META = ${JSON.stringify(meta, null, 2)};

export const PREVIEW_CATALOG_VERSION = ${JSON.stringify(meta.version)};

export const categories = ${JSON.stringify(categories, null, 2)};

export const products = ${JSON.stringify(productos, null, 2)};
`;

const destinoJs = path.join(RAIZ, 'js', 'vitrina-neuquen-20261024.js');
fs.writeFileSync(destinoJs, modulo, 'utf8');

const resumen = {
  generadoEl: new Date().toISOString(),
  destino: 'js/vitrina-neuquen-20261024.js',
  skus: GONDOLA.length,
  conFoto: conFoto.length,
  conFotoAuditada: conFotoAuditada.length,
  conFotoManifiesto: conFoto.length - conFotoAuditada.length,
  sinFoto,
  coberturas: productos.reduce((acc, fila) => { acc[fila.vitrinaCobertura] = (acc[fila.vitrinaCobertura] || 0) + 1; return acc; }, {}),
};
fs.writeFileSync(
  path.join(RAIZ, 'artifacts/catalog-pricing-images-20261024/vitrina-neuquen.json'),
  `${JSON.stringify(resumen, null, 2)}\n`,
  'utf8',
);
console.log(`Vitrina generada: js/vitrina-neuquen-20261024.js · ${resumen.skus} SKU · ${resumen.conFoto} con foto (${resumen.conFotoAuditada} auditadas) · ${resumen.sinFoto.length} fallback`);
console.log(`Fallback: ${resumen.sinFoto.join(', ')}`);
