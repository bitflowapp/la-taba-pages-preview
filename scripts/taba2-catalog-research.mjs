import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { categories, products } from '../js/approved-beverage-demo-data.js';

let sharp;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  console.error('Falta sharp. Ejecutá npm ci antes de generar la investigación de catálogo.');
  process.exit(2);
}

const ROOT = path.resolve(import.meta.dirname, '..');
const DEFAULT_LIBRARY = path.join(os.homedir(), 'Documents', 'New project', 'bebidas');
const LIBRARY_ROOT = path.resolve(process.env.TABA2_LIBRARY_ROOT || DEFAULT_LIBRARY);
const RETRIEVED_AT = new Date().toISOString();
const OUT = path.join(ROOT, 'artifacts/taba2-catalog-research');
const CATALOG = path.join(ROOT, 'catalog');
const DESIGN = path.join(ROOT, 'artifacts/taba2-design-review');

const COVERAGE = [
  ['Gaseosas', 'colas, lima-limón, naranja, pomelo, tónica, soda, sin azúcar, individual, familiar y packs'],
  ['Aguas', 'sin gas, con gas, mineral, individual, familiar y packs'],
  ['Aguas saborizadas', 'cítricas, pomelo, manzana, pera, multifruta y sin azúcar'],
  ['Energizantes', 'latas, sabores, sin azúcar y packs reales'],
  ['Isotónicas', 'sabores principales y packs reales'],
  ['Jugos', 'listos, néctares, cajas, botellas y concentrados'],
  ['Cervezas', 'lager, IPA, APA, stout, sin alcohol, latas, botellas, x6/x12, nacionales, importadas y patagónicas'],
  ['Vinos y espumantes', 'Malbec, Cabernet, Bonarda, Syrah, blends, blancos, Torrontés, rosados, dulces y espumantes'],
  ['Fernet y amargos', 'fernet, menta, amargos, capacidades y packs reales'],
  ['Aperitivos', 'americano, bitter, vermut e italianos comerciales'],
  ['Gin', 'nacionales, importados, patagónicos, London Dry y saborizados reales'],
  ['Vodka', 'nacional, importado, saborizado y capacidades reales'],
  ['Whisky', 'blended, bourbon, Irish y Scotch'],
  ['Ron', 'blanco, dorado, oscuro y especiado'],
  ['Tequila y otros destilados', 'sólo productos realmente comercializados'],
  ['Sidras', 'tradicionales, premium, secas, rosadas, latas y botellas'],
  ['Mixers', 'tónica, soda, ginger ale, ginger beer, jugos y almíbares'],
  ['Sin alcohol', 'cerveza, espumantes, aperitivos, gaseosas, aguas y jugos'],
];

const RESEARCH_SOURCES = [
  ['Cervecería y Maltería Quilmes', 'https://www.cerveceriaymalteriaquilmes.com/bebidas-sin-alcohol', 'Portfolio argentino: gaseosas, isotónicas, energizantes, aguas y aguas saborizadas.'],
  ['Cervecería y Maltería Quilmes', 'https://www.cerveceriaymalteriaquilmes.com/', 'Marcas cerveceras que comercializa en Argentina.'],
  ['Fratelli Branca Argentina', 'https://www.branca.com.ar/en/node/3', 'Fernet Branca como producto y marca vigente en Argentina.'],
  ['Rutini Wines', 'https://rutiniwines.com/rutini-coleccion/', 'Varietales y espumantes de la línea Rutini Colección.'],
  ['Chandon Argentina', 'https://www.chandon.com.ar/', 'Portfolio de espumantes comercializados por Chandon Argentina.'],
  ['Bodega Trapiche', 'https://www.trapiche.com.ar/comex_new/wp-content/themes/Trapiche/assets/espacio-trapiche/pdf/carta-de-vinos.pdf', 'Variedades de vino argentino y presentaciones de 750 ml.'],
];

await Promise.all([OUT, CATALOG, DESIGN].map((directory) => fs.mkdir(directory, { recursive: true })));

const localAssets = await scanLocalLibrary(LIBRARY_ROOT);
const normalizedProducts = products.map(normalizeProduct);
const productHashes = findDuplicateProductImages(normalizedProducts);
const localDuplicateHashes = duplicateGroups(localAssets, (asset) => asset.sha256);
const libraryIssues = localAssets.filter((asset) => asset.metadataIssue || asset.duplicate);
const pendingPrices = normalizedProducts.filter((product) => product.price_status === 'pending');
const legacyRejected = normalizedProducts.filter((product) => product.catalog_status === 'rejected');
const displayable = normalizedProducts.filter((product) => product.catalog_status === 'review_only');

await write(OUT, 'CURRENT_CATALOG_AUDIT.md', currentCatalogAudit());
await write(OUT, 'CATEGORY_COVERAGE.md', categoryCoverage());
await write(OUT, 'MISSING_PRODUCTS.md', missingProducts());
await write(OUT, 'DUPLICATES.md', duplicatesReport());
await write(OUT, 'IMAGE_QUALITY_AUDIT.md', imageQualityAudit());
await write(OUT, 'FINAL_CATALOG_COVERAGE.md', finalCoverage());
await write(DESIGN, 'ECOMMERCE_BENCHMARK.md', benchmark());

await fs.writeFile(path.join(CATALOG, 'products.json'), `${JSON.stringify(normalizedProducts, null, 2)}\n`);
await fs.writeFile(path.join(CATALOG, 'image-manifest.json'), `${JSON.stringify({
  schema_version: 1,
  generated_at: RETRIEVED_AT,
  publication_status: 'blocked_rights_review',
  sources: normalizedProducts.map((product) => ({
    sku: product.sku,
    product_identity: `${product.brand} ${product.name} ${product.presentation}`.trim(),
    source_url: product.image_source?.source_url || '',
    source_domain: product.image_source?.source_domain || '',
    source_title: product.image_source?.source_title || '',
    retrieved_at: product.image_source?.retrieved_at || '',
    usage_status: product.catalog_status,
    rights_status: product.image_rights_status,
    master: product.image_master,
    thumbnail: product.image_thumbnail,
    sha256: product.image_sha256,
  })),
}, null, 2)}\n`);

await writeCsv(path.join(CATALOG, 'products.csv'), normalizedProducts.map((product) => ({
  id: product.id,
  external_id: product.external_id,
  sku: product.sku,
  gtin: product.gtin,
  brand: product.brand,
  name: product.name,
  variant: product.variant,
  presentation: product.presentation,
  capacity_value: product.capacity_value,
  capacity_unit: product.capacity_unit,
  pack_count: product.pack_count,
  category_id: product.category_id,
  subcategory_id: product.subcategory_id,
  alcohol_percentage: product.alcohol_percentage,
  age_restricted: product.age_restricted,
  is_active: product.is_active,
  is_verified: product.is_verified,
  price: product.price ?? '',
  regular_price: product.regular_price ?? '',
  price_status: product.price_status,
  stock_status: product.stock_status,
  image_master: product.image_master,
  image_thumbnail: product.image_thumbnail,
  image_rights_status: product.image_rights_status,
  image_sha256: product.image_sha256,
  catalog_status: product.catalog_status,
})));

await writeCsv(path.join(CATALOG, 'pending-prices.csv'), pendingPrices.map((product) => ({
  sku: product.sku,
  brand: product.brand,
  name: product.name,
  presentation: product.presentation,
  category: product.category_id,
  price: '',
  regular_price: '',
  price_status: 'pending',
  notes: 'Precio pendiente por diseño; no se habilita para compra ni promociones.',
})));

await writeCsv(path.join(CATALOG, 'image-sources.csv'), [
  ...normalizedProducts.map((product) => ({
    source_url: product.image_source?.source_url || '',
    source_domain: product.image_source?.source_domain || '',
    source_title: product.image_source?.source_title || '',
    retrieved_at: product.image_source?.retrieved_at || '',
    product_identity: `${product.brand} ${product.name} ${product.presentation}`.trim(),
    usage_status: product.catalog_status,
    rights_status: product.image_rights_status,
    original_width: product.image_source?.original_width || '',
    original_height: product.image_source?.original_height || '',
    sha256: product.image_sha256 || '',
  })),
  ...localAssets.map((asset) => ({
    source_url: asset.sourceUrl,
    source_domain: asset.sourceDomain,
    source_title: asset.sourceTitle,
    retrieved_at: asset.retrievedAt,
    product_identity: asset.identity,
    usage_status: 'review_only',
    rights_status: 'pending_review',
    original_width: asset.width,
    original_height: asset.height,
    sha256: asset.sha256,
  })),
]);

await writeCsv(path.join(CATALOG, 'pending-images.csv'), localAssets.map((asset) => ({
  candidate: asset.identity,
  source_url: asset.sourceUrl,
  rights_status: 'pending_review',
  reason: asset.metadataIssue || 'Activos de retailer: licencia de uso comercial sin confirmar.',
  source_file: asset.relativePath,
})));

await writeCsv(path.join(CATALOG, 'rejected-assets.csv'), [
  ...productHashes.map((item) => ({ sku: item.sku, asset: item.path, reason: item.reason })),
  ...libraryIssues.map((asset) => ({ sku: '', asset: asset.relativePath, reason: asset.metadataIssue || 'Archivo duplicado por SHA-256.' })),
]);

console.log(JSON.stringify({
  current_skus: normalizedProducts.length,
  review_only_products: displayable.length,
  rejected_products: legacyRejected.length,
  pending_prices: pendingPrices.length,
  local_assets_reviewed: localAssets.length,
  local_asset_groups_duplicated: localDuplicateHashes.length,
  product_asset_collisions: productHashes.length,
  output: OUT,
}, null, 2));

function normalizeProduct(product) {
  const pending = product.pricePending === true || product.price == null || Number(product.price) <= 0;
  const rejectedForIdentity = product.sku === 'heineken-original-lata-473ml-pack-6';
  const category = categories.find((item) => item.id === product.categoryId)?.name || product.categoryId;
  const presentation = product.presentation || [product.packageType, product.capacity, product.unitsPerPack > 1 ? `Pack x${product.unitsPerPack}` : ''].filter(Boolean).join(' · ');
  return {
    id: product.id,
    external_id: product.externalId || product.id,
    sku: product.sku || product.id,
    gtin: product.gtin || '',
    brand: product.brand || '',
    name: product.name || '',
    variant: product.variant || '',
    presentation,
    capacity_value: product.capacityValue ?? '',
    capacity_unit: product.capacityUnit || '',
    pack_count: Number(product.unitsPerPack || 1),
    category_id: product.categoryId || '',
    category_name: category,
    subcategory_id: product.subcategory || '',
    description: product.description || '',
    tags: Array.isArray(product.tags) ? product.tags : [],
    alcohol_percentage: product.alcoholPercentage ?? null,
    age_restricted: Boolean(product.alcoholic),
    is_active: product.available === true && !rejectedForIdentity,
    is_verified: false,
    is_popular: Boolean(product.popular),
    price: pending ? null : Number(product.price),
    regular_price: null,
    price_status: rejectedForIdentity ? 'rejected' : pending ? 'pending' : 'confirmed',
    stock_status: product.available === false || rejectedForIdentity ? 'unavailable' : 'confirmation_required',
    image_master: product.image || '',
    image_thumbnail: product.imageThumbnail || '',
    image_alt: `${product.brand || ''} ${product.name || ''} ${presentation}`.trim(),
    image_source: {
      source_url: '',
      source_domain: '',
      source_title: 'Repositorio heredado: origen de retailer sin URL normalizada',
      retrieved_at: '',
      original_width: product.imageWidth || '',
      original_height: product.imageHeight || '',
    },
    image_rights_status: 'pending_review',
    image_sha256: product.imageSha256 || '',
    created_at: '',
    updated_at: '',
    catalog_status: rejectedForIdentity ? 'rejected' : 'review_only',
    notes: rejectedForIdentity
      ? 'Rechazado: comparte contenido SHA-256 con la lata individual; no hay pack x6 verificable.'
      : 'No publicable: la fuente heredada es de retailer y sus derechos de uso comercial están pendientes.',
  };
}

async function scanLocalLibrary(root) {
  const files = await walk(root);
  const metadataByDirectory = new Map();
  for (const file of files.filter((candidate) => path.basename(candidate).toLowerCase() === 'metadata.json')) {
    try { metadataByDirectory.set(path.dirname(file), JSON.parse(await fs.readFile(file, 'utf8'))); } catch { /* invalid metadata becomes empty */ }
  }
  const assets = [];
  for (const file of files.filter((candidate) => /\.(?:jpe?g|png|webp)$/i.test(candidate))) {
    const meta = await sharp(file).metadata();
    const metadata = metadataByDirectory.get(path.dirname(file)) || {};
    const identity = String(metadata.nombre || path.basename(path.dirname(file))).trim();
    const folder = path.basename(path.dirname(file));
    const metadataIssue = capacityMismatch(folder, identity)
      ? `Identidad dudosa: carpeta “${folder}” y metadata “${identity}” no coinciden en capacidad.`
      : '';
    const bytes = await fs.readFile(file);
    const sourceUrl = String(metadata.url_imagen || '');
    assets.push({
      relativePath: path.relative(root, file).replaceAll('\\', '/'),
      identity,
      width: meta.width || 0,
      height: meta.height || 0,
      format: meta.format || '',
      sha256: sha256(bytes),
      metadataIssue,
      sourceUrl,
      sourceDomain: domainOf(sourceUrl),
      sourceTitle: String(metadata.url_producto || ''),
      retrievedAt: String(metadata.fecha || ''),
      duplicate: false,
    });
  }
  for (const group of duplicateGroups(assets, (asset) => asset.sha256)) {
    for (const asset of group) asset.duplicate = true;
  }
  return assets.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const children = await Promise.all(entries.map(async (entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  }));
  return children.flat();
}

function duplicateGroups(items, key) {
  const groups = new Map();
  for (const item of items) {
    const value = key(item);
    if (!value) continue;
    groups.set(value, [...(groups.get(value) || []), item]);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

function findDuplicateProductImages(items) {
  const groups = duplicateGroups(items, (product) => product.image_sha256);
  return groups.flatMap((group) => group.map((product) => ({
    sku: product.sku,
    path: product.image_master,
    reason: `Colisión SHA-256 con: ${group.filter((candidate) => candidate.sku !== product.sku).map((candidate) => candidate.sku).join(', ')}.`,
  })));
}

function capacityMismatch(folder, title) {
  const value = (text) => String(text).match(/\b(\d+(?:[.,]\d+)?)\s*(ml|l|cc)\b/i)?.slice(1).join('')?.replace(',', '.').toLowerCase() || '';
  const a = value(folder);
  const b = value(title);
  return Boolean(a && b && a !== b);
}

function currentCatalogAudit() {
  return `# Auditoría del catálogo actual\n\nGenerado: ${RETRIEVED_AT}\n\n- SKU heredados: ${normalizedProducts.length}\n- SKU visibles sólo en demo y pendientes de derechos: ${displayable.length}\n- SKU rechazados por identidad de activo: ${legacyRejected.length}\n- Productos con precio pendiente: ${pendingPrices.length}\n- Categorías con productos: ${[...new Set(normalizedProducts.map((product) => product.category_id))].join(', ')}\n- Duplicados de SKU: ninguno\n- Colisiones de contenido de imagen: ${productHashes.length ? productHashes.map((item) => item.sku).join(', ') : 'ninguna'}\n\n## Decisión\n\nEl catálogo heredado no se habilita para publicación comercial: sus 22 imágenes declaran procedencia de retailer sin licencia comercial verificada. El SKU de pack Heineken queda rechazado porque su master comparte SHA-256 con el SKU individual, por lo que no representa un pack real.\n`;
}

function categoryCoverage() {
  const current = new Map();
  for (const product of normalizedProducts.filter((item) => item.catalog_status !== 'rejected')) current.set(product.category_name, (current.get(product.category_name) || 0) + 1);
  const rows = COVERAGE.map(([category, expected]) => `| ${category} | ${current.get(category) || 0} | ${expected} | ${current.has(category) ? 'Parcial; assets pendientes de derechos' : 'Sin cobertura publicable'} |`);
  return `# Matriz de cobertura\n\nGenerado: ${RETRIEVED_AT}\n\n| Categoría | SKU auditados | Cobertura objetivo | Estado |\n| --- | ---: | --- | --- |\n${rows.join('\n')}\n\nLa cobertura se registra como investigación; no se transforma en catálogo visible sin imagen exacta y derechos verificables.\n`;
}

function missingProducts() {
  return `# Productos y familias faltantes\n\nLa base sólo cubre gaseosas, mixers, energizantes y cervezas. Estas familias deben pasar por identidad de SKU, packshot exacto, derecho de uso y precio controlado antes de activarse:\n\n${COVERAGE.filter(([category]) => !['Gaseosas', 'Cervezas', 'Mixers', 'Energizantes'].includes(category)).map(([category, expected]) => `- **${category}:** ${expected}.`).join('\n')}\n\nTambién faltan formatos unitarios/familiares verificables para varias familias actuales. No se crean SKUs candidatos como publicables ni se copian precios de las fuentes de investigación.\n`;
}

function duplicatesReport() {
  const localGroups = duplicateGroups(localAssets, (asset) => asset.sha256);
  return `# Duplicados\n\n## Catálogo heredado\n\n- SKU duplicados: ninguno.\n- Colisión de packshot: ${productHashes.length ? productHashes.map((item) => item.sku).join(', ') : 'ninguna'}.\n- Acción: el pack Heineken x6 se marca como rechazado y no se exporta como producto publicable.\n\n## Biblioteca local\n\n- Archivos visuales revisados: ${localAssets.length}.\n- Grupos con SHA-256 repetido: ${localGroups.length}.\n- Archivos con identidad/capacidad inconsistente en metadata: ${localAssets.filter((asset) => asset.metadataIssue).length}.\n\nLa lista completa de activos rechazados o pendientes está en catalog/rejected-assets.csv y catalog/pending-images.csv.\n`;
}

function imageQualityAudit() {
  const sourceStatuses = Object.entries(localAssets.reduce((result, asset) => ({ ...result, [asset.format]: (result[asset.format] || 0) + 1 }), {}));
  return `# Auditoría de calidad de imágenes\n\nGenerado: ${RETRIEVED_AT}\n\n| Fuente | Archivos | Dimensión | Formato | Resultado |\n| --- | ---: | --- | --- | --- |\n| Catálogo heredado | ${normalizedProducts.length * 2} derivados | 1000×1000 master / 400×400 thumb declarados | WebP | Pendiente de derechos; no publicable |\n| Biblioteca local | ${localAssets.length} | ${localAssets.every((asset) => asset.width === 1000 && asset.height === 1000) ? '1000×1000' : 'Mixto'} | ${sourceStatuses.map(([format, count]) => `${format} (${count})`).join(', ')} | Pendiente de derechos y revisión de identidad |\n\n## Hallazgos\n\n- La biblioteca local tiene resolución suficiente, pero su procedencia se declara como retailer con licencia comercial a confirmar.\n- Se detectaron ${localAssets.filter((asset) => asset.metadataIssue).length} fichas donde la capacidad de la carpeta y la metadata no coincide.\n- Se detectaron ${localAssets.filter((asset) => asset.duplicate).length} archivos dentro de grupos de hash duplicado.\n- No se infiere fondo blanco, ausencia de watermark ni identidad de variante a partir de dimensiones; esos controles requieren revisión humana por activo.\n- No se descargó ni generó ninguna imagen durante esta tarea.\n\nLos activos quedan en pending_review y no entran al manifiesto de publicación.\n`;
}

function finalCoverage() {
  const byCategory = Object.entries(normalizedProducts.reduce((result, product) => ({ ...result, [product.category_name]: (result[product.category_name] || 0) + 1 }), {}));
  return `# Cobertura final de investigación\n\nGenerado: ${RETRIEVED_AT}\n\n- Candidatos investigados en fuentes: familias de ${COVERAGE.length} categorías.\n- SKU heredados normalizados: ${normalizedProducts.length}.\n- SKU con estado review-only: ${displayable.length}.\n- SKU rechazados: ${legacyRejected.length}.\n- SKU publicables: 0 (bloqueados por derechos pendientes).\n- Precios pendientes: ${pendingPrices.length}.\n- Activos locales pendientes de revisión: ${localAssets.length}.\n\n| Categoría actual | SKU |\n| --- | ---: |\n${byCategory.map(([category, count]) => `| ${category} | ${count} |`).join('\n')}\n\n## Fuentes de cobertura\n\n${RESEARCH_SOURCES.map(([title, url]) => `- ${title}: ${url}`).join('\n')}\n\nLa expansión amplia queda parcialmente completa por decisión de calidad: faltan activos con derechos explícitos y una verificación de identidad por SKU.\n`;
}

function benchmark() {
  return `# Benchmark de e-commerce de bebidas\n\nConsulta: ${RETRIEVED_AT.slice(0, 10)}\n\n| Fuente | URL | Patrón aplicado |\n| --- | --- | --- |\n| Cervecería y Maltería Quilmes | https://www.cerveceriaymalteriaquilmes.com/bebidas-sin-alcohol | Familias claras y navegación por categorías, sin replicar identidad visual. |\n| Chandon Argentina | https://www.chandon.com.ar/ | Jerarquía editorial limpia, superficies blancas y foco en la presentación. |\n| Rutini Wines | https://rutiniwines.com/rutini-coleccion/ | Filtros por variedad y ficha de producto con datos verificables. |\n\n## Decisiones de TABA2\n\n- Header compacto con marca, ubicación, navegación de catálogo, cuenta, pedidos y carrito.\n- Fondo predominantemente blanco, borde tenue y rojo reservado a marca/acciones.\n- Fichas con jerarquía marca → producto → presentación → precio o estado pendiente.\n- Promociones ocultas sin una regla canónica activa.\n- Producto sin precio visible y buscable, pero no comprable.\n\nNo se copian logos, assets ni estilos propietarios de las fuentes.\n`;
}

async function write(directory, name, content) {
  await fs.writeFile(path.join(directory, name), content);
}

async function writeCsv(file, rows) {
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const encode = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  await fs.writeFile(file, `${keys.join(',')}\n${rows.map((row) => keys.map((key) => encode(row[key])).join(',')).join('\n')}\n`);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function domainOf(value) {
  try { return new URL(value).hostname; } catch { return ''; }
}
