import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CATEGORIES = new Set(['gaseosas', 'mixers', 'energizantes', 'cervezas']);
let SOURCE_ROOT;
let OUTPUT_ROOT;
let CATALOG_PATH;
let OUTPUT_PATH;
let ASSET_ROOT;

try {
  ({ sourceRoot: SOURCE_ROOT, outputRoot: OUTPUT_ROOT } = parseArguments(process.argv.slice(2)));
  CATALOG_PATH = path.join(SOURCE_ROOT, 'catalog-demo.json');
  OUTPUT_PATH = path.join(OUTPUT_ROOT, 'js', 'approved-beverage-demo-data.js');
  ASSET_ROOT = path.join(OUTPUT_ROOT, 'assets', 'catalog', 'beverages');
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  const catalog = await readJson(CATALOG_PATH);
  const products = await validateCatalog(catalog);
  const generated = [];
  for (const product of products) {
    const metadata = await readJson(resolveApprovedPath(product.metadata, product.sku));
    validateMetadata(product, metadata);
    generated.push(mapProduct(product, metadata, await copyAssets(product)));
  }
  await fs.writeFile(OUTPUT_PATH, renderModule(generated), 'utf8');
  console.log(`Importación demo lista: ${generated.length} producto(s), ${generated.length * 2} WebP.`);
} catch (error) {
  console.error(`ERROR ${error.message}`);
  process.exitCode = 1;
}

function parseArguments(args) {
  const positional = [];
  let outputRoot = ROOT;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--output-root') {
      const target = args[index + 1];
      if (!target || target.startsWith('--')) throw new Error('Falta el valor de --output-root.');
      outputRoot = path.resolve(target);
      index += 1;
      continue;
    }
    if (value.startsWith('--')) throw new Error(`Opción desconocida: ${value}.`);
    positional.push(value);
  }
  if (positional.length !== 1) {
    throw new Error('Uso: node scripts/import-approved-beverages.mjs <biblioteca-fuente> [--output-root <directorio>].');
  }
  return {
    sourceRoot: path.resolve(positional[0]),
    outputRoot,
  };
}

async function readJson(filePath) {
  let source;
  try { source = await fs.readFile(filePath, 'utf8'); } catch (error) {
    throw new Error(`No se pudo leer ${filePath}: ${error.message}`);
  }
  try { return JSON.parse(source); } catch (error) {
    throw new Error(`JSON inválido en ${filePath}: ${error.message}`);
  }
}

async function validateCatalog(catalog) {
  const products = Array.isArray(catalog?.products) ? catalog.products : [];
  if (products.length !== 22) throw new Error(`Se esperaban 22 productos y se recibieron ${products.length}.`);
  const skus = new Set();
  for (const product of products) {
    const sku = String(product?.sku || '');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(sku) || skus.has(sku)) throw new Error(`SKU inválido o duplicado: ${sku || '(vacío)'}.`);
    skus.add(sku);
    if (!CATEGORIES.has(product.category)) throw new Error(`${sku}: categoría no aprobada.`);
    if (!Number.isFinite(Number(product.capacity_value)) || Number(product.capacity_value) <= 0) throw new Error(`${sku}: capacidad inválida.`);
    if (!['ml', 'l'].includes(String(product.capacity_unit || '').toLowerCase())) throw new Error(`${sku}: unidad de capacidad inválida.`);
    if (!['unit', 'pack'].includes(product.sold_as) || !Number.isInteger(product.units_per_pack) || product.units_per_pack < 1) throw new Error(`${sku}: oferta inválida.`);
    if (!String(product.display_label || '').trim()) throw new Error(`${sku}: display_label faltante.`);
    if (product.demo_price_ars !== null && (!Number.isInteger(product.demo_price_ars) || product.demo_price_ars < 0)) throw new Error(`${sku}: precio inválido.`);
    if (product.contains_alcohol === true && product.requires_age_confirmation !== true) throw new Error(`${sku}: alcohol sin confirmación de edad.`);
    ['metadata', 'image', 'thumbnail'].forEach((field) => resolveApprovedPath(product[field], sku));
  }
  return products;
}

function resolveApprovedPath(relativePath, sku) {
  const normalized = String(relativePath || '').replaceAll('\\', '/');
  const segments = normalized.split('/');
  if (!normalized.startsWith('approved-demo/') || segments.some((part) => !part || part === '.' || part === '..' || ['pending', 'unresolved'].includes(part))) {
    throw new Error(`${sku}: ruta no permitida (${relativePath}).`);
  }
  const absolute = path.resolve(SOURCE_ROOT, normalized);
  if (!absolute.startsWith(`${path.resolve(SOURCE_ROOT, 'approved-demo')}${path.sep}`)) throw new Error(`${sku}: la ruta escapa approved-demo.`);
  return absolute;
}

function validateMetadata(product, metadata) {
  if (metadata?.sku !== product.sku) throw new Error(`${product.sku}: metadata no coincide con el SKU.`);
  if (!metadata?.images?.sha256?.product || !metadata?.images?.sha256?.thumbnail) throw new Error(`${product.sku}: metadata sin hashes WebP.`);
  if (metadata?.offer?.units_per_pack !== product.units_per_pack || metadata?.offer?.display_label !== product.display_label) throw new Error(`${product.sku}: metadata no conserva el pack.`);
}

async function copyAssets(product) {
  const targetDirectory = path.join(ASSET_ROOT, product.sku);
  await fs.mkdir(targetDirectory, { recursive: true });
  const result = {};
  for (const [field, name] of [['image', 'product.webp'], ['thumbnail', 'thumbnail.webp']]) {
    const source = resolveApprovedPath(product[field], product.sku);
    const stat = await fs.stat(source).catch(() => null);
    if (!stat?.isFile() || stat.size <= 0) throw new Error(`${product.sku}: falta o está vacío ${field}.`);
    const target = path.join(targetDirectory, name);
    await fs.copyFile(source, target);
    result[field] = path.relative(OUTPUT_ROOT, target).replaceAll('\\', '/');
  }
  return result;
}

function mapProduct(product, metadata, assets) {
  const pricePending = product.demo_price_ars === null;
  const presentation = { 'botella-pet': 'Botella PET', lata: 'Lata', botella: 'Botella' }[product.presentation] || String(product.presentation || '').replaceAll('-', ' ');
  return {
    id: product.sku, sku: product.sku, externalId: product.sku,
    brand: product.brand, name: product.name, variant: product.variant,
    categoryId: product.category, subcategory: product.subcategory, description: product.description,
    presentation: `${presentation} · ${product.capacity_value} ${product.capacity_unit} · ${product.display_label}`, capacity: `${product.capacity_value} ${product.capacity_unit}`,
    capacityValue: product.capacity_value, capacityUnit: product.capacity_unit, packageType: product.presentation,
    unit: product.sold_as === 'pack' ? 'pack' : 'unidad', unitLabel: product.display_label, unitsPerPack: product.units_per_pack,
    price: pricePending ? 0 : product.demo_price_ars, pricePending, stock: pricePending ? 0 : 99,
    available: product.available === true && !pricePending, sourceAvailable: product.available === true,
    stockStatus: product.stock_status, requiresBusinessConfirmation: product.requires_business_confirmation === true,
    alcoholic: product.contains_alcohol === true, requiresAgeConfirmation: product.requires_age_confirmation === true,
    minimumAge: product.contains_alcohol === true ? 18 : null,
    tags: product.recommendation_tags || [], recommendationTags: product.recommendation_tags || [], complementaryCategories: product.complementary_categories || [],
    image: assets.image, imageThumbnail: assets.thumbnail,
    imageSha256: metadata.images.sha256.product, imageThumbnailSha256: metadata.images.sha256.thumbnail, sourceImageSha256: metadata.images.sha256.source || '',
    imageWidth: metadata.images.product_dimensions?.width || 1000, imageHeight: metadata.images.product_dimensions?.height || 1000,
    thumbnailWidth: metadata.images.thumbnail_dimensions?.width || 400, thumbnailHeight: metadata.images.thumbnail_dimensions?.height || 400,
    rightsStatus: product.rights_status, marketNote: 'Precio y stock sujetos a confirmación del negocio.', prepMinutes: 10,
  };
}

function renderModule(products) {
  const categories = [{ id: 'all', name: 'Todos' }, { id: 'gaseosas', name: 'Gaseosas' }, { id: 'mixers', name: 'Mixers' }, { id: 'energizantes', name: 'Energizantes' }, { id: 'cervezas', name: 'Cervezas' }];
  return `// Generado por scripts/import-approved-beverages.mjs. No editar manualmente.\n// Fuente autorizada: catalog-demo.json + approved-demo/. Sólo se carga con ?demo=1.\nexport const PREVIEW_CATALOG_VERSION = 'approved-beverages-2026-07-29-v1';\n\nexport const categories = ${JSON.stringify(categories, null, 2)};\n\nexport const products = ${JSON.stringify(products, null, 2)};\n`;
}
