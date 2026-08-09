/*
 * Readiness comercial del catálogo: qué falta, SKU por SKU, para poder vender.
 *
 * POR QUÉ EXISTE
 * --------------
 * El catálogo tiene 91 registros y once productos comprables. Saber cuáles son
 * los otros ochenta —y sobre todo QUÉ le falta a cada uno— era, hasta acá, un
 * ejercicio de cruzar cinco planillas a mano. Este reporte lo resuelve de una
 * sola lectura y sin escribir nada: es la foto que se mira antes de pedirle
 * datos al negocio y otra vez después de cargarlos.
 *
 * NO INVENTA NADA. Cada campo sale de una planilla del repositorio; lo que no
 * está cargado se reporta como faltante, nunca se completa con un valor por
 * defecto. Un precio ausente es «falta precio», no «$ 0».
 *
 * FUENTES
 *   catalog/products.csv ......... identidad, categoría, precio y estado
 *   catalog/image-manifest.json .. imagen candidata y estado de derechos
 *   data/combos.csv .............. qué SKU participa de un combo aprobado
 *
 * SALIDA
 *   catalog/readiness-report.csv   una fila por SKU, legible por herramientas
 *   stdout                         el resumen por bucket
 *
 *   node scripts/catalog-readiness.mjs
 *   node scripts/catalog-readiness.mjs --json
 *   node scripts/catalog-readiness.mjs --check   (falla si el CSV envejeció)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from './validate-product-catalog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRODUCTS_CSV = path.join(ROOT, 'catalog/products.csv');
const IMAGE_MANIFEST = path.join(ROOT, 'catalog/image-manifest.json');
const COMBOS_CSV = path.join(ROOT, 'data/combos.csv');
const REPORT_CSV = path.join(ROOT, 'catalog/readiness-report.csv');

// Derechos que acreditan uso comercial de la foto. Hoy NINGÚN producto los
// tiene: las 92 filas están en `pending_review` o en blanco, y las imágenes que
// el storefront sirve son de fuente secundaria. No bloquea la venta —el sistema
// las publica igual— pero es una decisión pendiente del negocio y se cuenta
// aparte para que no quede escondida detrás del precio.
export const PUBLISHABLE_RIGHTS = Object.freeze([
  'owned', 'propio', 'brand_authorized', 'licensed', 'licencia_comercial', 'permiso_documentado',
]);

// Un pack de abastecimiento no es un producto de góndola: el local se surte con
// él, el cliente no lo compra. Se reporta aparte para que no ensucie el
// denominador de «cuánto del catálogo es vendible».
export const PROCUREMENT_SUFFIX = /-pack-\d+$/;

export const READINESS_BUCKETS = Object.freeze([
  'listo_para_publicar',
  'falta_precio',
  'falta_foto',
  'falta_stock',
  'no_vendible',
]);

export function rowsToObjects(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0].map((value, index) => (
    index === 0 ? value.replace(/^﻿/, '').trim() : value.trim()
  ));
  return rows.slice(1).map((values) => Object.fromEntries(
    header.map((column, index) => [column, (values[index] ?? '').trim()]),
  ));
}

/** Precio utilizable: positivo y con a lo sumo dos decimales. Nada más cuenta. */
export function usablePrice(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const amount = Number(text);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/** Stock utilizable: entero, cero o más. `''` no es 0: es «no cargado». */
export function usableStock(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const amount = Number(text);
  return Number.isSafeInteger(amount) ? amount : null;
}

export function buildImageIndex(manifest) {
  const index = new Map();
  for (const source of manifest?.sources || []) {
    const sku = String(source?.sku || '').trim();
    if (!sku) continue;
    index.set(sku, {
      master: source?.master?.path || '',
      thumbnail: source?.thumbnail?.path || '',
      rightsStatus: String(source?.rights_status || '').trim(),
    });
  }
  return index;
}

export function buildComboIndex(comboRows) {
  const index = new Map();
  for (const row of comboRows) {
    if (String(row.approval_status || '').trim() !== 'APROBADO_COMERCIAL') continue;
    for (const sku of parseComboComponents(row.components)) {
      const list = index.get(sku) || [];
      list.push(String(row.combo_id || '').trim());
      index.set(sku, list);
    }
  }
  return index;
}

// «imperial-golden-lata-473ml x6 | sub: a, b, c» → el SKU principal y sus
// sustitutos. El manifiesto es la fuente; acá sólo se lee.
export function parseComboComponents(value) {
  const skus = new Set();
  for (const part of String(value || '').split('|')) {
    const clean = part.trim();
    if (!clean) continue;
    if (/^sub:/i.test(clean)) {
      for (const sub of clean.replace(/^sub:/i, '').split(',')) {
        const sku = sub.trim();
        if (sku) skus.add(sku);
      }
      continue;
    }
    const sku = clean.replace(/\s*x\s*\d+$/i, '').trim();
    if (sku) skus.add(sku);
  }
  return [...skus];
}

/**
 * Clasifica un SKU. El orden de los faltantes no es alfabético: es el orden en
 * que hay que resolverlos. Sin precio no se vende aunque sobre stock, y sin
 * derechos de imagen no se publica aunque haya precio.
 */
export function classifyProduct(product, { imageExists, combos }) {
  const sku = String(product.sku || '').trim();
  const procurementOnly = PROCUREMENT_SUFFIX.test(sku);
  const price = usablePrice(product.price);
  const stock = usableStock(product.stock);
  // La foto que importa es la que el storefront sirve de verdad, no la
  // candidata del manifiesto de investigación: son dos pistas distintas y la
  // segunda apunta a archivos que la app nunca pide.
  const imagePath = String(product.image_master || '').trim();
  const thumbnailPath = String(product.image_thumbnail || '').trim();
  const hasImageFile = Boolean(imagePath) && imageExists(imagePath);
  const rights = String(product.image_rights_status || product.rights_status || '').trim().toLowerCase();
  const rightsOk = PUBLISHABLE_RIGHTS.includes(rights);
  const missing = [];

  if (price === null) missing.push('precio');
  if (!hasImageFile) missing.push('foto');
  if (stock === null) missing.push('stock');

  const bucket = procurementOnly
    ? 'no_vendible'
    : missing.includes('precio')
      ? 'falta_precio'
      : missing.includes('foto')
        ? 'falta_foto'
        : missing.includes('stock')
          ? 'falta_stock'
          : 'listo_para_publicar';

  return {
    sku,
    brand: product.brand || '',
    name: product.name || '',
    variant: product.variant || '',
    presentation: product.presentation || '',
    category: product.category_id || product.category_name || '',
    alcohol: normalizeAlcohol(product),
    price,
    stock,
    imagePath,
    thumbnailPath,
    hasImageFile,
    imageRights: rights,
    rightsOk,
    combos: combos || [],
    procurementOnly,
    missing,
    bucket,
    // Lo que esta planilla PUEDE afirmar. El stock no vive acá, así que hoy
    // esto es cero para todos: es justamente el hueco que hay que cerrar.
    sellableWithSheetOnly: !procurementOnly && price !== null && stock !== null && hasImageFile,
  };
}

// `age_restricted` es el campo que decide; `alcohol_percentage` sólo lo
// respalda. Si ninguno de los dos está cargado, se reporta desconocido en vez
// de asumir que no tiene alcohol: asumir «sin alcohol» es lo único que puede
// terminar vendiéndole cerveza a un menor sin pedir el +18.
export function normalizeAlcohol(product) {
  const flag = String(product.age_restricted || '').trim().toLowerCase();
  if (flag === 'true') return 'si';
  if (flag === 'false') return 'no';
  const percentage = Number(String(product.alcohol_percentage || '').trim());
  if (Number.isFinite(percentage) && percentage > 0) return 'si';
  return 'desconocido';
}

export function buildReadiness({
  productsCsv,
  combosCsv,
  imageExists = (candidate) => fs.existsSync(path.join(ROOT, candidate)),
}) {
  const products = rowsToObjects(productsCsv);
  const combos = buildComboIndex(rowsToObjects(combosCsv));

  const seen = new Map();
  const duplicates = [];
  const entries = [];
  for (const product of products) {
    const sku = String(product.sku || '').trim();
    if (!sku) continue;
    if (seen.has(sku)) {
      duplicates.push(sku);
      continue;
    }
    seen.set(sku, true);
    entries.push(classifyProduct(product, {
      imageExists,
      combos: combos.get(sku),
    }));
  }

  const totals = Object.fromEntries(READINESS_BUCKETS.map((bucket) => [bucket, 0]));
  for (const entry of entries) totals[entry.bucket] += 1;

  const gondola = entries.filter((entry) => !entry.procurementOnly);
  return {
    entries,
    duplicates,
    totals,
    gondolaCount: gondola.length,
    sellableCount: gondola.filter((entry) => entry.sellableWithSheetOnly).length,
    missingPriceCount: gondola.filter((entry) => entry.missing.includes('precio')).length,
    missingPhotoCount: gondola.filter((entry) => entry.missing.includes('foto')).length,
    missingStockCount: gondola.filter((entry) => entry.missing.includes('stock')).length,
    pendingRightsCount: gondola.filter((entry) => entry.hasImageFile && !entry.rightsOk).length,
    unknownAlcoholCount: gondola.filter((entry) => entry.alcohol === 'desconocido').length,
    comboSkuCount: gondola.filter((entry) => entry.combos.length).length,
  };
}

export function renderReportCsv(report) {
  const header = [
    'sku', 'marca', 'nombre', 'presentacion', 'categoria', 'alcohol',
    'precio', 'stock', 'foto', 'derechos_foto', 'combos', 'falta', 'estado',
  ];
  const lines = [header.join(',')];
  for (const entry of [...report.entries].sort((a, b) => a.sku.localeCompare(b.sku, 'es'))) {
    lines.push([
      entry.sku,
      entry.brand,
      entry.name,
      entry.presentation,
      entry.category,
      entry.alcohol,
      entry.price === null ? '' : entry.price,
      entry.stock === null ? '' : entry.stock,
      entry.imagePath ? 'si' : 'no',
      entry.imageRights,
      entry.combos.join(' '),
      entry.missing.join(' '),
      entry.bucket,
    ].map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function readReadinessSources() {
  return {
    productsCsv: fs.readFileSync(PRODUCTS_CSV, 'utf8'),
    combosCsv: fs.readFileSync(COMBOS_CSV, 'utf8'),
  };
}

function main(args) {
  const report = buildReadiness(readReadinessSources());
  const csv = renderReportCsv(report);

  if (args.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (args.includes('--check')) {
    const current = fs.existsSync(REPORT_CSV) ? fs.readFileSync(REPORT_CSV, 'utf8') : '';
    if (current !== csv) {
      console.error('ERROR catalog/readiness-report.csv envejeció. Regeneralo con: node scripts/catalog-readiness.mjs');
      process.exitCode = 1;
      return;
    }
    console.log('Reporte de readiness al día.');
    return;
  }

  fs.writeFileSync(REPORT_CSV, csv, 'utf8');

  const line = (label, value) => console.log(`  ${label.padEnd(34, '.')} ${value}`);
  console.log(`Góndola: ${report.gondolaCount} productos de venta al cliente`);
  console.log(`  (${report.entries.length - report.gondolaCount} packs de abastecimiento quedan fuera del denominador)`);
  console.log('');
  line('listos para publicar', report.totals.listo_para_publicar);
  line('falta precio', report.totals.falta_precio);
  line('falta foto o sus derechos', report.totals.falta_foto);
  line('falta stock', report.totals.falta_stock);
  console.log('');
  line('con precio cargado', report.gondolaCount - report.missingPriceCount);
  line('con archivo de foto en disco', report.gondolaCount - report.missingPhotoCount);
  line('con stock cargado', report.gondolaCount - report.missingStockCount);
  line('alcohol sin declarar', report.unknownAlcoholCount);
  line('participan de un combo aprobado', report.comboSkuCount);
  console.log('');
  line('foto SIN derechos acreditados', report.pendingRightsCount);
  console.log('    (no bloquea la venta: el sistema las publica igual.');
  console.log('     Es una decisión comercial pendiente, no un defecto.)');
  if (report.duplicates.length) {
    console.log('');
    console.log(`  SKU duplicados en products.csv: ${report.duplicates.join(', ')}`);
  }
  console.log('');
  console.log(`Escrito: catalog/readiness-report.csv (${report.entries.length} filas)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2));
}
