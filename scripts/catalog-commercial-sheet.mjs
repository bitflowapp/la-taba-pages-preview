/*
 * La planilla que se le manda al negocio.
 *
 * POR QUÉ EXISTE
 * --------------
 * `data/catalog-template.csv` tiene veintiún columnas: external_id, capacity_value,
 * package_type, units_per_pack, sort_order, image_path, tags… Es el formato que
 * necesita el importador técnico, y es exactamente lo que NO se le puede mandar
 * a alguien que vende bebidas. Un error de tipeo en `sort_order` no significa
 * nada para él y rompe la importación entera.
 *
 * Esta planilla tiene cuatro columnas que se completan y cuatro que sólo se
 * leen. Las de contexto —producto, presentación, categoría, alcohol— vienen
 * llenas para que sepa qué está cotizando sin abrir otra cosa.
 *
 * SE GENERA, NO SE ESCRIBE A MANO. Una planilla escrita a mano envejece: el día
 * que un precio se confirma, la fila sigue pidiéndolo. `--check` falla si la
 * committeada se desvió del generador.
 *
 *   node scripts/catalog-commercial-sheet.mjs           # genera
 *   node scripts/catalog-commercial-sheet.mjs --check   # verifica que no envejeció
 *   node scripts/catalog-commercial-sheet.mjs --all     # incluye lo que ya tiene precio
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReadiness, readReadinessSources } from './catalog-readiness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHEET = path.join(ROOT, 'catalog/planilla-negocio.csv');

// Las cuatro primeras se leen; las cuatro últimas se completan. El orden no es
// cosmético: primero hay que saber QUÉ es el producto y recién después decidir.
export const SHEET_COLUMNS = Object.freeze([
  'sku', 'producto', 'categoria', 'alcohol',
  'precio', 'stock', 'publicar', 'notas',
]);

export const READ_ONLY_COLUMNS = Object.freeze(['sku', 'producto', 'categoria', 'alcohol']);
export const DECISION_COLUMNS = Object.freeze(['precio', 'stock', 'publicar', 'notas']);

// Nombres comerciales de las categorías. El catálogo las guarda con id técnico
// (`aguas-saborizadas`); la planilla las muestra como se llaman en el mostrador.
const CATEGORY_LABELS = Object.freeze({
  gaseosas: 'Gaseosas',
  mixers: 'Mixers',
  aguas: 'Aguas',
  'aguas-saborizadas': 'Aguas saborizadas',
  isotonicas: 'Isotónicas',
  energizantes: 'Energizantes',
  cervezas: 'Cervezas',
  fernet: 'Fernet y amargos',
  aperitivos: 'Aperitivos',
  vinos: 'Vinos',
  espumantes: 'Espumantes y sidras',
  destilados: 'Destilados',
  hielo: 'Hielo',
});

export function categoryLabel(id) {
  const key = String(id || '').trim();
  return CATEGORY_LABELS[key] || key;
}

/**
 * «Glaciar Sin gas, baja en sodio · Botella PET · 1,5 L». Lo que alguien
 * reconoce sin leer un id.
 *
 * La variante entra cuando el nombre no la contiene. Sin ella, «Glaciar Con
 * gas» y «Glaciar Sin gas» salían como dos filas idénticas de 1,5 L y quien
 * completa la planilla no tenía forma de saber cuál estaba cotizando.
 */
export function productLabel(entry) {
  const brand = String(entry.brand || '').trim();
  const name = String(entry.name || '').trim();
  const variant = String(entry.variant || '').trim();
  const presentation = String(entry.presentation || '').trim();
  const head = !brand || name.toLowerCase().startsWith(brand.toLowerCase()) ? name : `${brand} ${name}`;
  const withVariant = variant && !head.toLowerCase().includes(variant.toLowerCase())
    ? `${head} ${variant}`
    : head;
  return [withVariant, presentation].filter(Boolean).join(' · ');
}

export function buildSheet(report, { includePriced = false } = {}) {
  const rows = report.entries
    .filter((entry) => !entry.procurementOnly)
    .filter((entry) => includePriced || entry.price === null || entry.stock === null)
    .sort((a, b) => (
      categoryLabel(a.category).localeCompare(categoryLabel(b.category), 'es')
      || productLabel(a).localeCompare(productLabel(b), 'es')
    ));

  const lines = [SHEET_COLUMNS.join(',')];
  for (const entry of rows) {
    lines.push([
      entry.sku,
      productLabel(entry),
      categoryLabel(entry.category),
      entry.alcohol === 'si' ? 'si' : 'no',
      // Lo ya cargado viaja como valor inicial: si el precio está confirmado no
      // hay que volver a escribirlo, y si cambió se pisa. Lo que falta va vacío
      // a propósito: un cero acá sería un precio inventado.
      entry.price === null ? '' : entry.price,
      entry.stock === null ? '' : entry.stock,
      '',
      '',
    ].map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function main(args) {
  const report = buildReadiness(readReadinessSources());
  const sheet = buildSheet(report, { includePriced: args.includes('--all') });
  const rowCount = sheet.trim().split('\n').length - 1;

  if (args.includes('--check')) {
    const current = fs.existsSync(SHEET) ? fs.readFileSync(SHEET, 'utf8') : '';
    if (current !== sheet) {
      console.error('ERROR catalog/planilla-negocio.csv envejeció. Regeneralo con: node scripts/catalog-commercial-sheet.mjs');
      process.exitCode = 1;
      return;
    }
    console.log(`Planilla al día: ${rowCount} producto(s) esperando decisión del negocio.`);
    return;
  }

  fs.writeFileSync(SHEET, sheet, 'utf8');
  console.log(`Escrito: catalog/planilla-negocio.csv (${rowCount} filas)`);
  console.log('');
  console.log('Se completan cuatro columnas y nada más:');
  console.log('  precio ..... en pesos, sin puntos ni signo. Ej: 3900 o 3900.50');
  console.log('  stock ...... unidades enteras. 0 es válido y significa agotado.');
  console.log('  publicar ... si / no. Sólo «si» hace que aparezca en la tienda.');
  console.log('  notas ...... opcional, para el equipo. No se muestra al cliente.');
  console.log('');
  console.log('Las otras cuatro son de lectura: sku, producto, categoria, alcohol.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2));
}
