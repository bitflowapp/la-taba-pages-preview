import fs from 'node:fs';
import path from 'node:path';
import {
  findManifestSource,
  isSafeProductAssetPath,
  validateFinalImageManifest,
} from './catalog-images/lib.mjs';

export const CATEGORY_NAMES = Object.freeze([
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

export const CATEGORIES = new Set(CATEGORY_NAMES);
export const POSTGRES_INTEGER_MAX = 2_147_483_647;
export const PRODUCT_PRICE_MAX = 9_999_999_999.99;
export const ALCOHOL_REQUIRED_CATEGORIES = new Set([
  'Cervezas',
  'Vinos y espumantes',
  'Gins y vodkas',
  'Whisky y destilados',
]);
export const ALCOHOL_FORBIDDEN_CATEGORIES = new Set([
  'Gaseosas',
  'Aguas',
  'Jugos',
  'Energéticas',
  'Isotónicas',
  'Picadas y deli',
  'Hielo y extras',
]);

export const REQUIRED_COLUMNS = [
  'external_id', 'sku', 'brand', 'name', 'variant', 'category', 'subcategory',
  'capacity_value', 'capacity_unit', 'package_type', 'units_per_pack', 'price',
  'stock', 'available', 'alcoholic', 'minimum_age', 'chilled', 'featured',
  'sort_order', 'image_path', 'tags',
];

export const REQUIRED_VALUES = Object.freeze([
  'external_id',
  'sku',
  'brand',
  'name',
  'variant',
  'category',
  'subcategory',
  'capacity_value',
  'capacity_unit',
  'package_type',
  'units_per_pack',
  'price',
  'stock',
  'available',
  'alcoholic',
  'chilled',
  'featured',
  'sort_order',
  'image_path',
]);

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

export function validateCatalog(text, {
  allowEmpty = false,
  fileExists = fs.existsSync,
  imageManifest,
} = {}) {
  const rows = parseCsv(text);
  const errors = [];
  if (!rows.length) return { errors: ['El CSV no tiene encabezado.'], products: [] };
  const header = rows[0].map((value, index) => (
    index === 0 ? value.replace(/^\uFEFF/, '').trim() : value.trim()
  ));
  const duplicateColumns = header.filter((column, index) => header.indexOf(column) !== index);
  for (const column of new Set(duplicateColumns)) {
    errors.push(`La columna ${column || '(vacía)'} está repetida.`);
  }
  for (const column of REQUIRED_COLUMNS) {
    if (!header.includes(column)) errors.push(`Falta la columna obligatoria ${column}.`);
  }
  const products = rows.slice(1).map((values, index) => {
    if (values.length !== header.length) {
      errors.push(`Línea ${index + 2}: cantidad de columnas inválida.`);
    }
    return Object.fromEntries(
      header.map((column, columnIndex) => [column, (values[columnIndex] || '').trim()]),
    );
  });
  if (!allowEmpty && !products.length) errors.push('El catálogo no contiene productos.');

  if (imageManifest !== undefined) {
    const manifestReport = validateFinalImageManifest(imageManifest, {
      allowEmpty: products.length === 0 && allowEmpty,
    });
    for (const error of manifestReport.errors) errors.push(`Imágenes: ${error}`);
  } else if (products.length) {
    errors.push('Falta el manifiesto final de imágenes para reconciliar el catálogo.');
  }

  const ids = new Set();
  const skus = new Set();
  products.forEach((product, index) => {
    const line = index + 2;
    for (const column of REQUIRED_VALUES) {
      if (!product[column]) errors.push(`Línea ${line}: ${column} está vacío.`);
    }
    if (product.external_id) {
      if (ids.has(product.external_id)) errors.push(`Línea ${line}: external_id duplicado.`);
      ids.add(product.external_id);
    }
    if (product.sku) {
      if (skus.has(product.sku)) errors.push(`Línea ${line}: SKU duplicado.`);
      skus.add(product.sku);
    }
    if (!CATEGORIES.has(product.category)) errors.push(`Línea ${line}: categoría inexistente.`);
    if (!isPositiveMoney(product.price)) errors.push(`Línea ${line}: precio inválido; debe ser mayor a cero.`);
    if (!isNonNegativeInteger(product.stock)) errors.push(`Línea ${line}: stock inválido o negativo.`);
    if (!isPositiveDecimal(product.capacity_value)) errors.push(`Línea ${line}: capacidad incoherente.`);
    if (!['ml', 'l', 'g', 'kg', 'unidad'].includes((product.capacity_unit || '').toLowerCase())) {
      errors.push(`Línea ${line}: unidad de capacidad incoherente.`);
    }
    if (!isPositiveInteger(product.units_per_pack)) errors.push(`Línea ${line}: units_per_pack inválido.`);
    if (!isNonNegativeInteger(product.sort_order)) errors.push(`Línea ${line}: sort_order inválido o negativo.`);
    const alcoholic = parseCatalogBoolean(product.alcoholic);
    if (alcoholic === null) errors.push(`Línea ${line}: alcoholic debe ser true o false.`);
    if (ALCOHOL_REQUIRED_CATEGORIES.has(product.category) && alcoholic !== true) {
      errors.push(`Línea ${line}: ${product.category} debe marcarse como alcohólica.`);
    }
    if (ALCOHOL_FORBIDDEN_CATEGORIES.has(product.category) && alcoholic !== false) {
      errors.push(`Línea ${line}: ${product.category} no puede marcarse como alcohólica.`);
    }
    if (alcoholic === true && (
      !isPositiveInteger(product.minimum_age)
      || Number(product.minimum_age) < 18
      || Number(product.minimum_age) > 99
    )) {
      errors.push(`Línea ${line}: alcohol sin edad mínima válida entre 18 y 99.`);
    }
    if (alcoholic === false && product.minimum_age) {
      errors.push(`Línea ${line}: un producto sin alcohol no debe declarar minimum_age.`);
    }
    for (const flag of ['available', 'chilled', 'featured']) {
      if (parseCatalogBoolean(product[flag]) === null) {
        errors.push(`Línea ${line}: ${flag} debe ser true o false.`);
      }
    }
    if (!product.image_path) errors.push(`Línea ${line}: imagen faltante.`);
    else if (!isSafeProductAssetPath(product.image_path)) {
      errors.push(`Línea ${line}: ruta de imagen insegura.`);
    } else if (!fileExists(product.image_path)) {
      errors.push(`Línea ${line}: no existe ${product.image_path}.`);
    }

    if (imageManifest !== undefined) {
      const source = findManifestSource(imageManifest, product.external_id, product.sku);
      if (!source) {
        errors.push(`Línea ${line}: external_id/SKU no tienen una imagen aprobada en el manifiesto.`);
      } else {
        const masterPath = source.assets?.master?.path || '';
        const thumbnailPath = source.assets?.thumbnail?.path || '';
        if (product.image_path !== masterPath) {
          errors.push(`Línea ${line}: image_path no coincide con el master aprobado.`);
        }
        if (!isSafeProductAssetPath(thumbnailPath)) {
          errors.push(`Línea ${line}: thumbnail aprobado ausente o inseguro.`);
        } else if (!fileExists(thumbnailPath)) {
          errors.push(`Línea ${line}: no existe ${thumbnailPath}.`);
        }
      }
    }
  });
  return { errors, products };
}

export const parseCatalogBoolean = (value) => /^(true|false)$/i.test(String(value || ''))
  ? String(value).toLowerCase() === 'true'
  : null;

export function parseCatalogTags(value) {
  return [...new Set(String(value || '')
    .split(/[|;]/)
    .map((tag) => tag.trim())
    .filter(Boolean))]
    .sort();
}

const isPositiveMoney = (value) => (
  /^\d+(?:\.\d{1,2})?$/.test(value)
  && Number.isFinite(Number(value))
  && Number(value) > 0
  && Number(value) <= PRODUCT_PRICE_MAX
);
const isPositiveDecimal = (value) => (
  /^\d+(?:\.\d+)?$/.test(value)
  && Number.isFinite(Number(value))
  && Number(value) > 0
);
const isNonNegativeInteger = (value) => (
  /^\d+$/.test(value)
  && Number.isSafeInteger(Number(value))
  && Number(value) <= POSTGRES_INTEGER_MAX
);
const isPositiveInteger = (value) => (
  /^[1-9]\d*$/.test(value)
  && Number.isSafeInteger(Number(value))
  && Number(value) <= POSTGRES_INTEGER_MAX
);

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const file = process.argv[2];
  if (!file) {
    console.error('Uso: node scripts/validate-product-catalog.mjs archivo.csv [--template]');
    process.exitCode = 2;
  } else {
    let imageManifest;
    try {
      imageManifest = JSON.parse(fs.readFileSync(
        path.resolve('docs/catalog/image-manifest.json'),
        'utf8',
      ));
    } catch (error) {
      console.error(`ERROR No se pudo leer el manifiesto de imágenes: ${error.message}`);
      process.exitCode = 1;
      imageManifest = undefined;
    }
    const report = validateCatalog(fs.readFileSync(file, 'utf8'), {
      allowEmpty: process.argv.includes('--template'),
      fileExists: (candidate) => fs.existsSync(path.resolve(candidate)),
      imageManifest,
    });
    for (const error of report.errors) console.error(`ERROR ${error}`);
    if (report.errors.length) process.exitCode = 1;
    else console.log(`Catálogo válido: ${report.products.length} producto(s).`);
  }
}
