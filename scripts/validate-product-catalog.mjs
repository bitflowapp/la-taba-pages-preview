import fs from 'node:fs';
import path from 'node:path';

export const CATEGORIES = new Set([
  'Promos',
  'Gaseosas',
  'Aguas',
  'Jugos',
  'Energéticas',
  'Isotónicas',
  'Cervezas',
  'Vinos y espumantes',
  'Gins y vodkas',
  'Whisky y destilados',
  'Picadas y deli',
  'Hielo y extras',
]);

export const REQUIRED_COLUMNS = [
  'external_id', 'sku', 'brand', 'name', 'variant', 'category', 'subcategory',
  'capacity_value', 'capacity_unit', 'package_type', 'units_per_pack', 'price',
  'stock', 'available', 'alcoholic', 'minimum_age', 'chilled', 'featured',
  'sort_order', 'image_path', 'tags',
];

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  row.push(field);
  if (row.some((value) => value !== '')) rows.push(row);
  if (quoted) throw new Error('CSV inválido: comillas sin cerrar.');
  return rows;
}

export function validateCatalog(text, { allowEmpty = false, fileExists = fs.existsSync } = {}) {
  const rows = parseCsv(text);
  const errors = [];
  if (!rows.length) return { errors: ['El CSV no tiene encabezado.'], products: [] };
  const header = rows[0].map((value) => value.trim());
  for (const column of REQUIRED_COLUMNS) {
    if (!header.includes(column)) errors.push(`Falta la columna obligatoria ${column}.`);
  }
  const products = rows.slice(1).map((values) => Object.fromEntries(
    header.map((column, index) => [column, (values[index] || '').trim()]),
  ));
  if (!allowEmpty && !products.length) errors.push('El catálogo no contiene productos.');

  const ids = new Set();
  const skus = new Set();
  products.forEach((product, index) => {
    const line = index + 2;
    for (const column of ['external_id', 'sku', 'brand', 'name', 'category', 'package_type']) {
      if (!product[column]) errors.push(`Línea ${line}: ${column} está vacío.`);
    }
    if (ids.has(product.external_id)) errors.push(`Línea ${line}: external_id duplicado.`);
    if (skus.has(product.sku)) errors.push(`Línea ${line}: SKU duplicado.`);
    ids.add(product.external_id);
    skus.add(product.sku);
    if (!CATEGORIES.has(product.category)) errors.push(`Línea ${line}: categoría inexistente.`);
    if (!isNonNegativeDecimal(product.price)) errors.push(`Línea ${line}: precio inválido.`);
    if (!isNonNegativeInteger(product.stock)) errors.push(`Línea ${line}: stock inválido o negativo.`);
    if (!isPositiveDecimal(product.capacity_value)) errors.push(`Línea ${line}: capacidad incoherente.`);
    if (!['ml', 'l', 'g', 'kg', 'unidad'].includes(product.capacity_unit.toLowerCase())) {
      errors.push(`Línea ${line}: unidad de capacidad incoherente.`);
    }
    if (!isPositiveInteger(product.units_per_pack)) errors.push(`Línea ${line}: units_per_pack inválido.`);
    const alcoholic = parseBoolean(product.alcoholic);
    if (alcoholic === null) errors.push(`Línea ${line}: alcoholic debe ser true o false.`);
    if (alcoholic && (!isPositiveInteger(product.minimum_age) || Number(product.minimum_age) < 18)) {
      errors.push(`Línea ${line}: alcohol sin edad mínima válida.`);
    }
    for (const flag of ['available', 'chilled', 'featured']) {
      if (parseBoolean(product[flag]) === null) errors.push(`Línea ${line}: ${flag} debe ser true o false.`);
    }
    if (!product.image_path) errors.push(`Línea ${line}: imagen faltante.`);
    else if (
      path.isAbsolute(product.image_path)
      || product.image_path.includes('..')
      || !/^assets\/products\/[a-z0-9/_-]+\.webp$/i.test(product.image_path)
    ) errors.push(`Línea ${line}: ruta de imagen insegura.`);
    else if (!fileExists(product.image_path)) errors.push(`Línea ${line}: no existe ${product.image_path}.`);
  });
  return { errors, products };
}

const parseBoolean = (value) => /^(true|false)$/i.test(value)
  ? value.toLowerCase() === 'true'
  : null;
const isNonNegativeDecimal = (value) => /^\d+(?:\.\d{1,2})?$/.test(value);
const isPositiveDecimal = (value) => /^(?:0*[1-9]\d*)(?:\.\d+)?$/.test(value);
const isNonNegativeInteger = (value) => /^\d+$/.test(value);
const isPositiveInteger = (value) => /^[1-9]\d*$/.test(value);

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const file = process.argv[2];
  if (!file) {
    console.error('Uso: node scripts/validate-product-catalog.mjs archivo.csv [--template]');
    process.exitCode = 2;
  } else {
    const report = validateCatalog(fs.readFileSync(file, 'utf8'), {
      allowEmpty: process.argv.includes('--template'),
      fileExists: (candidate) => fs.existsSync(path.resolve(candidate)),
    });
    for (const error of report.errors) console.error(`ERROR ${error}`);
    if (report.errors.length) process.exitCode = 1;
    else console.log(`Catálogo válido: ${report.products.length} producto(s).`);
  }
}
