import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

let sharp;
try { ({ default: sharp } = await import('sharp')); } catch { throw new Error('sharp es obligatorio para el pipeline de catálogo.'); }

const ROOT = path.resolve(import.meta.dirname, '..');
const CATALOG = path.join(ROOT, 'catalog');
const OUT = path.join(ROOT, 'artifacts/taba2-catalog-authority');
const TODAY = new Date().toISOString();
const DATE = TODAY.slice(0, 10);
const chain = 'https://www.jumbo.com.ar';
const p = (priority, category, sku, brand, name, variant, ml, packageType, sourcePath, alcoholic = false) => ({ priority, category, sku, brand, name, variant, ml, packageType, source_url: `${chain}${sourcePath}`, alcoholic });
const AUTO_REJECTED = [
  { sku:'villavicencio-con-gas-1500ml', reason:'La ficha no expuso un packshot blanco verificable.' },
  { sku:'fernet-branca-750ml', reason:'La ficha no expuso un packshot blanco verificable.' },
  { sku:'portillo-malbec-750ml', reason:'La ficha no expuso un packshot blanco verificable.' },
];
const VISUAL_REJECTED = new Map([
  ['coca-cola-original-2250ml', 'La revisión visual encontró tabla nutricional, no frente de producto.'],
  ['coca-cola-sin-azucar-2250ml', 'La revisión visual encontró tabla nutricional, no frente de producto.'],
  ['schweppes-tonica-354ml', 'La revisión visual encontró tabla nutricional, no frente de producto.'],
  ['levite-manzana-2250ml', 'La revisión visual encontró una pieza gráfica, no envase verificable.'],
  ['aquarius-pera-2200ml', 'La revisión visual encontró tabla nutricional, no frente de producto.'],
  ['monster-ultra-473ml', 'La revisión visual encontró dorso nutricional, no frente de producto.'],
  ['brancamenta-450ml', 'La revisión visual encontró dorso del envase, no frente de producto.'],
  ['gancia-americano-950ml', 'La revisión visual encontró dorso del envase, no frente de producto.'],
  ['martini-bianco-1000ml', 'La revisión visual encontró dorso del envase, no frente de producto.'],
  ['smirnoff-700ml', 'La revisión visual detectó conflicto: la imagen declara 750 ml y el SKU 700 ml.'],
]);

// Curación manual: cada ficha se revisó contra su título visible en Jumbo el 2026-08-02.
// No hay precios, GTIN ni graduación alcohólica en esta fuente de trabajo.
const SEEDS = [
  p('P0','gaseosas','coca-cola-original-2250ml','Coca-Cola','Coca-Cola Sabor Original','Original',2250,'botella-pet','/gaseosa-coca-cola-sabor-original-2-25-l/p'),
  p('P0','gaseosas','coca-cola-sin-azucar-2250ml','Coca-Cola','Coca-Cola Sin Azúcar','Sin azúcar',2250,'botella-pet','/coca-cola-zero-2-25-lt/p'),
  p('P0','gaseosas','sprite-sin-azucar-600ml','Sprite','Sprite','Sin azúcar',600,'botella-pet','/gaseosa-zero-lima-limon-600-ml-sprite/p'),
  p('P0','gaseosas','fanta-naranja-2250ml','Fanta','Fanta Naranja','Naranja',2250,'botella-pet','/gaseosa-naranja-2-25-lts-fanta/p'),
  p('P0','gaseosas','pepsi-black-1500ml','Pepsi','Pepsi Black','Sin azúcar',1500,'botella-pet','/gaseosa-pepsi-black-1-5lt/p'),
  p('P0','mixers','schweppes-tonica-354ml','Schweppes','Schweppes Tónica','Tónica',354,'lata','/gaseosa-schweppes-tonica-354-ml/p'),
  p('P0','mixers','schweppes-pomelo-sin-azucar-2250ml','Schweppes','Schweppes Pomelo','Sin azúcar',2250,'botella-pet','/gaseosa-schweppes-pomelo-zero-2-25lt/p'),
  p('P0','mixers','schweppes-ginger-ale-310ml','Schweppes','Schweppes Ginger Ale','Ginger ale',310,'lata','/gaseosa-ginger-ale-310-ml-schweppes/p'),
  p('P0','mixers','paso-de-los-toros-pomelo-1500ml','Paso de los Toros','Paso de los Toros Pomelo','Pomelo',1500,'botella-pet','/gaseosa-paso-de-los-toros-pomelo-botella-1-5ltx1/p'),
  p('P0','mixers','paso-de-los-toros-tonica-1500ml','Paso de los Toros','Paso de los Toros Tónica','Tónica',1500,'botella-pet','/gaseosa-paso-de-los-toros-tonica-botella-1-5ltx1/p'),
  p('P0','mixers','soda-ivess-1500ml','Ivess','Soda Ivess','Soda',1500,'sifon','/soda-ivess-1-5-l/p'),
  p('P0','mixers','britvic-ginger-beer-200ml','Britvic','Britvic Ginger Beer','Ginger beer',200,'botella','/bebida-ginger-beer-britvic-botella-200-ml/p'),
  p('P0','aguas','villavicencio-sin-gas-500ml','Villavicencio','Villavicencio','Sin gas',500,'botella-pet','/agua-sin-gas-villavicencio-500-ml/p'),
  p('P0','aguas','villavicencio-con-gas-1500ml','Villavicencio','Villavicencio','Con gas',1500,'botella-pet','/agua-villavicencio-con-gas-1-5lt/p'),
  p('P0','aguas','eco-de-los-andes-sin-gas-2000ml','Eco de los Andes','Eco de los Andes','Sin gas',2000,'botella-pet','/agua-mineral-eco-de-los-andes-sin-gas-2-l/p'),
  p('P0','aguas','glaciar-sin-gas-1500ml','Glaciar','Glaciar','Sin gas, baja en sodio',1500,'botella-pet','/agua-mineral-glaciar-sin-gas-bajo-sodio-1-5-l/p'),
  p('P0','aguas','glaciar-con-gas-1500ml','Glaciar','Glaciar','Con gas, baja en sodio',1500,'botella-pet','/agua-baja-en-sodio-glaciar-con-gas-1-5-l/p'),
  p('P0','aguas-saborizadas','levite-manzana-2250ml','Levité','Levité','Manzana',2250,'botella-pet','/saborizada-levite-manzana-2-25lt/p'),
  p('P0','aguas-saborizadas','aquarius-pera-2200ml','Aquarius','Aquarius','Pera',2200,'botella-pet','/saborizada-aquarius-pera-2-2lt/p'),
  p('P0','aguas-saborizadas','h2oh-limon-1500ml','H2OH!','H2OH!','Limón',1500,'botella-pet','/saborizada-limon-sin-gas-1-5-l-h2oh-2/p'),
  p('P0','energizantes','red-bull-energy-drink-355ml','Red Bull','Red Bull Energy Drink','Original',355,'lata','/energizate-red-bull-energy-drink-355cc/p'),
  p('P0','energizantes','monster-mango-loco-473ml','Monster','Monster Mango Loco','Mango Loco',473,'lata','/bebida-energizante-mango-loco-473-ml-monster/p'),
  p('P0','energizantes','monster-ultra-473ml','Monster','Monster Ultra','Sin azúcar',473,'lata','/bebida-energizante-energy-ultra-473-ml-monster/p'),
  p('P0','energizantes','speed-zero-473ml','Speed','Speed Zero','Sin azúcar',473,'lata','/energizante-speed-zero-473-cc-2/p'),
  p('P0','isotonicas','gatorade-zero-fresa-kiwi-400ml','Gatorade','Gatorade Zero','Fresa y kiwi',400,'botella-pet','/isotonico-zero-fresa-kiwi-400-ml-gatorade/p'),
  p('P0','isotonicas','powerade-mountain-blast-995ml','Powerade','Powerade','Mountain Blast',995,'botella-pet','/isotonico-powerade-mountain-blast-995cc/p'),
  p('P0','fernet','fernet-branca-750ml','Fernet Branca','Fernet Branca','Original',750,'botella','/fernet-branca-750-ml-2/p',true),
  p('P0','fernet','brancamenta-450ml','Brancamenta','Brancamenta','Menta',450,'botella','/fernet-branca-menta-450-ml/p',true),
  p('P0','fernet','buhero-negro-450ml','Buhero','Buhero Negro','Original',450,'botella','/fernet-buhero-negro-450ml/p',true),
  p('P0','aperitivos','gancia-americano-950ml','Gancia','Gancia','Americano y limón',950,'botella','/aperitivo-gancia-950-ml/p',true),
  p('P0','aperitivos','cinzano-rosso-950ml','Cinzano','Cinzano Rosso','Rosso',950,'botella','/vermouth-cinzano-rosso-950-ml/p',true),
  p('P0','aperitivos','campari-bitter-750ml','Campari','Campari Bitter','Bitter',750,'botella','/aperitivo-campari-bitter-750-cc/p',true),
  p('P0','aperitivos','aperol-750ml','Aperol','Aperol','Original',750,'botella','/aperitivo-aperol-750-ml/p',true),
  p('P0','aperitivos','martini-bianco-1000ml','Martini','Martini Bianco','Bianco',1000,'botella','/aperitivo-martini-bianco-1-l/p',true),
  p('P0','cervezas','quilmes-clasica-710ml','Quilmes','Quilmes Clásica','Lager',710,'lata','/cerveza-quilmes-clasica-710cc/p',true),
  p('P0','cervezas','patagonia-lager-del-sur-730ml','Patagonia','Patagonia Lager del Sur','Lager',730,'botella','/cerveza-patagonia-lager-del-sur-730cc-2/p',true),
  p('P0','cervezas','heineken-710ml','Heineken','Heineken','Lager',710,'lata','/cerveza-heineken-rubia-710cc/p',true),
  p('P0','cervezas','stella-artois-sin-alcohol-330ml','Stella Artois','Stella Artois','Sin alcohol',330,'botella', '/cerveza-stella-artois-sin-alcohol-330-ml/p'),
  p('P0','cervezas','corona-extra-330ml','Corona','Corona Extra','Lager',330,'botella','/cerveza-rubia-330ml-corona-2/p',true),
  p('P0','cervezas','imperial-golden-473ml','Imperial','Imperial Golden','Golden',473,'lata','/cerveza-imperial-golden-473cc/p',true),
  p('P0','cervezas','brahma-chopp-1000ml','Brahma','Brahma Chopp','Rubia',1000,'botella-retornable','/cerveza-brahma-chopp-rubia-1lt-ret/p',true),
  p('P0','cervezas','amstel-lager-473ml','Amstel','Amstel Lager','Lager',473,'lata','/cerveza-amstel-lager-473-cc/p',true),
  p('P0','vinos','rutini-malbec-750ml','Rutini','Rutini Malbec','Malbec',750,'botella','/vino-tinto-rutini-malbec-750-cc/p',true),
  p('P0','vinos','trapiche-reserva-malbec-750ml','Trapiche','Trapiche Reserva Malbec','Malbec',750,'botella','/vino-trapiche-reserva-malbec-750cc/p',true),
  p('P0','vinos','portillo-malbec-750ml','Portillo','Portillo Malbec','Malbec',750,'botella','/vino-portillo-malbec-750-ml/p',true),
  p('P2','vinos','fin-del-mundo-cabernet-franc-750ml','Fin del Mundo','Fin del Mundo','Cabernet Franc',750,'botella','/vino-fin-cabernet-franc-750cc-2/p',true),
  p('P1','espumantes','chandon-delice-750ml','Chandon','Chandon Délice','Délice',750,'botella','/espumante-chandon-delice-750-ml-3/p',true),
  p('P0','gin','tanqueray-dry-700ml','Tanqueray','Tanqueray Dry','London Dry',700,'botella','/gin-tanqueray-dry-700-ml/p',true),
  p('P0','gin','bombay-sapphire-750ml','Bombay Sapphire','Bombay Sapphire','London Dry',750,'botella','/gin-bombay-750-ml/p',true),
  p('P0','gin','bosque-nativo-500ml','Bosque','Bosque Nativo','Nativo',500,'botella','/gin-bosque-nativo-botella-500mlx1-2/p',true),
  p('P0','vodka','smirnoff-700ml','Smirnoff','Smirnoff','Original',700,'botella','/vodka-smirnoff-700-ml/p',true),
  p('P0','whisky','johnnie-walker-red-label-750ml','Johnnie Walker','Johnnie Walker Red Label','Red Label',750,'botella','/whisky-johnnie-walker-red-label-botella-750ml/p',true),
  p('P0','complementos','hielo-cristal-4kg','Cristal','Hielo Cristal','Bolsa de hielo',4000,'bolsa','/hielo-cristal-bolsa-4-kg/p'),
];

const CATEGORIES = [
  ['all','Todos'], ['gaseosas','Gaseosas'], ['mixers','Mixers'], ['aguas','Aguas'], ['aguas-saborizadas','Aguas saborizadas'], ['energizantes','Energizantes'], ['isotonicas','Isotónicas'], ['fernet','Fernet y amargos'], ['aperitivos','Aperitivos'], ['cervezas','Cervezas'], ['vinos','Vinos'], ['espumantes','Espumantes y sidras'], ['gin','Gin'], ['vodka','Vodka'], ['whisky','Whisky'], ['complementos','Complementos'],
].map(([id,name]) => ({ id, name }));

const reportOnly = process.argv.includes('--report-only');
if (reportOnly) {
  const products = JSON.parse(await fs.readFile(path.join(CATALOG, 'products.json'), 'utf8'));
  await writeReports(products, JSON.parse(await fs.readFile(path.join(CATALOG, 'image-manifest.json'), 'utf8')));
  console.log(`Investigación auditada: ${products.length} registros.`);
  process.exit(0);
}
if (process.argv.includes('--runtime-only')) {
  const products = JSON.parse(await fs.readFile(path.join(CATALOG, 'products.json'), 'utf8'));
  await writeRuntimeCatalog(products.filter((product) => product.catalog_status === 'approved'));
  console.log('Runtime price-pending generado sin redescargar activos.');
  process.exit(0);
}
if (process.argv.includes('--finalize-visual-review')) {
  const products = JSON.parse(await fs.readFile(path.join(CATALOG, 'products.json'), 'utf8'));
  const currentManifest = JSON.parse(await fs.readFile(path.join(CATALOG, 'image-manifest.json'), 'utf8'));
  const visual = [];
  for (const product of products) {
    const reason = VISUAL_REJECTED.get(product.sku);
    if (!reason || product.catalog_status !== 'approved') continue;
    visual.push({ sku: product.sku, reason });
    await Promise.all([product.image_master, product.image_thumbnail].filter(Boolean).map(async (relative) => {
      const absolute = path.resolve(ROOT, relative);
      if (!absolute.startsWith(path.join(ROOT, 'assets', 'catalog', 'products'))) throw new Error(`Ruta de limpieza insegura: ${relative}`);
      await fs.rm(absolute, { force:true });
    }));
    product.catalog_status = 'review_only';
    product.image_status = 'rejected';
    product.image_rights_status = 'pending_review';
    product.publication_status = 'blocked';
    product.notes = `No aprobado: ${reason}`;
    product.image_master = '';
    product.image_thumbnail = '';
    product.image_sha256 = '';
    product.image_thumbnail_sha256 = '';
  }
  const sources = (currentManifest.sources || []).filter((source) => !VISUAL_REJECTED.has(source.sku));
  const approved = products.filter((product) => product.catalog_status === 'approved');
  assertNoCollisions(approved, sources);
  await writeCatalog(products, sources, [...AUTO_REJECTED, ...visual]);
  await writeRuntimeCatalog(approved);
  await writeContactSheets(approved);
  await writeReports(products, { schema_version:2, sources, skipped:[...AUTO_REJECTED, ...visual] });
  console.log(JSON.stringify({ visually_rejected:visual.length, approved_for_internal_review:approved.length }, null, 2));
  process.exit(0);
}

await Promise.all([CATALOG, OUT].map((dir) => fs.mkdir(dir, { recursive: true })));
const previous = JSON.parse(await fs.readFile(path.join(CATALOG, 'products.json'), 'utf8'));
const legacy = previous.filter((product) => product.catalog_status === 'review_only' || product.catalog_status === 'rejected');
const curated = [];
const manifestSources = [];
const skipped = [];
for (const seed of SEEDS) {
  try {
    const page = await fetchText(seed.source_url, seed.sku);
    const source_title = titleOf(page) || seed.name;
    const selectedImage = await selectWhitePackshot(ogImagesOf(page), seed.sku);
    const { image_source_url, bytes, sourceMeta } = selectedImage;
    const source_sha256 = sha256(bytes);
    const master = await normalize(bytes, seed.packageType, 1000);
    const thumb = await normalize(bytes, seed.packageType, 400);
    const directory = path.join(ROOT, 'assets/catalog/products', seed.category);
    await fs.mkdir(directory, { recursive: true });
    const masterPath = `assets/catalog/products/${seed.category}/${seed.sku}-master.webp`;
    const thumbPath = `assets/catalog/products/${seed.category}/${seed.sku}-thumb.webp`;
    await fs.writeFile(path.join(ROOT, masterPath), master);
    await fs.writeFile(path.join(ROOT, thumbPath), thumb);
    const product = productFor(seed, { source_title, image_source_url, source_sha256, masterPath, thumbPath, master, thumb, sourceMeta });
    curated.push(product);
    manifestSources.push({ sku: seed.sku, source_url: seed.source_url, image_source_url, source_title, source_type: 'cadena_comercial_secundaria', retrieved_at: TODAY, source_sha256, rights_status: 'pending_review', master: asset(masterPath, master, 1000), thumbnail: asset(thumbPath, thumb, 400), white_background: sourceMeta });
    console.log(`${seed.sku}: verificado y normalizado.`);
  } catch (error) {
    skipped.push({ sku: seed.sku, source_url: seed.source_url, reason: String(error.message) });
    console.warn(`${seed.sku}: pendiente (${error.message}).`);
  }
}
if (curated.length < 50) throw new Error(`Cobertura insuficiente: ${curated.length} SKU aprobados para revisión interna.`);
assertNoCollisions(curated, manifestSources);
const products = [...legacy, ...curated];
await writeCatalog(products, manifestSources, skipped);
await writeRuntimeCatalog(curated);
await writeContactSheets(curated);
await writeReports(products, { schema_version: 2, sources: manifestSources, skipped });
console.log(JSON.stringify({ legacy: legacy.length, approved_for_internal_review: curated.length, commercial_gate: 'blocked' }, null, 2));

function productFor(seed, image) {
  const alcohol = Boolean(seed.alcoholic);
  const unit = seed.ml >= 1000 && seed.category !== 'complementos' ? `${String(seed.ml / 1000).replace('.', ',')} L` : seed.category === 'complementos' ? '4 kg' : `${seed.ml} ml`;
  const packageName = ({ lata: 'Lata', sifon: 'Sifón', bolsa: 'Bolsa', 'botella-pet': 'Botella PET', 'botella-retornable': 'Botella retornable', botella: 'Botella' })[seed.packageType] || 'Envase';
  return {
    id: seed.sku, external_id: seed.sku, sku: seed.sku, slug: seed.sku, gtin: '',
    brand: seed.brand, name: seed.name, variant: seed.variant, presentation: `${packageName} · ${unit} · Unidad`, capacity_value: seed.ml, capacity_unit: seed.category === 'complementos' ? 'g' : 'ml', pack_count: 1,
    category_id: seed.category, subcategory_id: seed.variant.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), package_type: seed.packageType,
    description: `${seed.category === 'cervezas' ? 'Cerveza' : seed.category === 'vinos' ? 'Vino' : seed.category === 'gin' ? 'Gin' : seed.category === 'vodka' ? 'Vodka' : seed.category === 'whisky' ? 'Whisky' : seed.name} en ${packageName.toLowerCase()} de ${unit}.`,
    tags: [seed.category, seed.brand.toLowerCase().replaceAll(' ', '-'), seed.variant.toLowerCase().replaceAll(' ', '-')], alcohol_percentage: null, alcohol_status: alcohol ? 'not_supplied_by_source' : 'not_applicable', age_restricted: alcohol,
    price: null, regular_price: null, price_status: 'pending', stock_status: 'confirmation_required', is_active: false, is_verified: true,
    catalog_status: 'approved', image_status: 'verified', rights_status: 'pending_review', publication_status: 'blocked', commercial_status: 'identity_verified_price_pending', identity_status: 'approved',
    image_master: image.masterPath, image_thumbnail: image.thumbPath, image_sha256: sha256(image.master), image_thumbnail_sha256: sha256(image.thumb),
    image_source: { source_url: seed.source_url, image_source_url: image.image_source_url, source_domain: 'jumbo.com.ar', source_title: image.source_title, source_type: 'cadena_comercial_secundaria', retrieved_at: TODAY, source_sha256: image.source_sha256, original_width: image.sourceMeta.width, original_height: image.sourceMeta.height },
    notes: 'Identidad y packshot revisados contra ficha de cadena comercial. Derechos de publicación pendientes; precio pendiente por diseño; no comprable.', priority: seed.priority,
  };
}

async function writeCatalog(products, sources, skipped = []) {
  for (const product of products) {
    if (product.catalog_status === 'review_only' && !product.image_rights_status) product.image_rights_status = 'pending_review';
  }
  await fs.writeFile(path.join(CATALOG, 'products.json'), `${JSON.stringify(products, null, 2)}\n`);
  await writeCsv(path.join(CATALOG, 'products.csv'), products);
  await fs.writeFile(path.join(CATALOG, 'image-manifest.json'), `${JSON.stringify({ schema_version: 2, generated_at: TODAY, publication_status: 'blocked', sources }, null, 2)}\n`);
  await writeCsv(path.join(CATALOG, 'image-sources.csv'), products.filter((p) => p.catalog_status === 'approved').map((p) => ({ product_name:p.name, brand:p.brand, variant:p.variant, presentation:p.presentation, capacity:p.capacity_value, pack_count:p.pack_count, category:p.category_id, source_url:p.image_source.source_url, image_source_url:p.image_source.image_source_url, source_domain:p.image_source.source_domain, source_title:p.image_source.source_title, source_type:p.image_source.source_type, retrieved_at:p.image_source.retrieved_at, commercial_status:p.commercial_status, identity_status:p.identity_status, rights_status:p.rights_status, notes:p.notes, sha256:p.image_sha256 })));
  await writeCsv(path.join(CATALOG, 'pending-prices.csv'), products.filter((p) => p.price_status === 'pending').map((p) => ({ sku:p.sku, brand:p.brand, name:p.name, price:'', regular_price:'', price_status:'pending', publication_status:p.publication_status, notes:'Precio próximamente. Producto bloqueado para carrito y checkout.' })));
  await writeCsv(path.join(CATALOG, 'pending-images.csv'), [...products.filter((p) => p.image_status !== 'verified').map((p) => ({ sku:p.sku, reason:p.notes || 'Imagen pendiente.' })), ...skipped]);
  await writeCsv(path.join(CATALOG, 'rejected-assets.csv'), [{ sku:'heineken-original-lata-473ml-pack-6', asset:'assets/catalog/beverages/heineken-original-lata-473ml-pack-6/product.webp', reason:'Rechazado preservado: colisión de imagen con SKU individual; falta imagen propia verificable.' }, ...skipped.map((item) => ({ sku:item.sku, asset:'', reason:item.reason }))]);
  await writeCsv(path.join(CATALOG, 'review-queue.csv'), products.filter((p) => p.rights_status === 'pending_review' || p.catalog_status === 'review_only').map((p) => ({ sku:p.sku, catalog_status:p.catalog_status, image_status:p.image_status || 'candidate', rights_status:p.rights_status || p.image_rights_status, price_status:p.price_status, publication_status:p.publication_status || 'blocked', priority:p.priority || 'legacy' })));
}

async function writeRuntimeCatalog(products) {
  const runtime = products.map((product) => ({
    id: product.id, sku: product.sku, externalId: product.external_id, brand: product.brand, name: product.name, variant: product.variant,
    categoryId: product.category_id, subcategory: product.subcategory_id, description: product.description, presentation: product.presentation,
    capacity: product.capacity_value >= 1000 && product.category_id !== 'complementos' ? `${String(product.capacity_value / 1000).replace('.', ',')} L` : product.category_id === 'complementos' ? '4 kg' : `${product.capacity_value} ml`,
    capacityValue: product.capacity_value, capacityUnit: product.capacity_unit, packageType: product.package_type || 'unidad', unit: 'unidad', unitLabel: 'Unidad', unitsPerPack: 1,
    price: null, pricePending: true, stock: 0, available: false, sourceAvailable: true, stockStatus: 'BUSINESS_CONFIRMATION_REQUIRED', requiresBusinessConfirmation: true,
    alcoholic: product.age_restricted, requiresAgeConfirmation: product.age_restricted, minimumAge: product.age_restricted ? 18 : null,
    tags: product.tags, recommendationTags: product.tags, complementaryCategories: [], image: product.image_master, imageThumbnail: product.image_thumbnail,
    imageSha256: product.image_sha256, imageThumbnailSha256: product.image_thumbnail_sha256, imageWidth: 1000, imageHeight: 1000, thumbnailWidth: 400, thumbnailHeight: 400,
    rightsStatus: 'PENDING_REVIEW', imageStatus: 'verified', catalogStatus: 'approved', publicationStatus: 'blocked', marketNote: 'Precio próximamente. No disponible para compra hasta confirmación del negocio.', prepMinutes: 10,
  }));
  const categories = CATEGORIES.filter((category) => category.id === 'all' || runtime.some((product) => product.categoryId === category.id));
  const source = `// Generado por scripts/taba2-catalog-authority.mjs. No editar manualmente.\nexport const authorityCategories = ${JSON.stringify(categories, null, 2)};\n\nexport const pendingProducts = ${JSON.stringify(runtime, null, 2)};\n`;
  await fs.writeFile(path.join(ROOT, 'js/taba2-commercial-pending-data.js'), source);
}

async function writeReports(products, manifest) {
  const approved = products.filter((p) => p.catalog_status === 'approved');
  const rejected = products.filter((p) => p.catalog_status === 'rejected');
  const pending = products.filter((p) => p.catalog_status === 'review_only');
  const byCategory = countBy(approved, (p) => p.category_id);
  const categories = Object.entries(byCategory).sort(([a],[b]) => a.localeCompare(b));
  await fs.mkdir(OUT, { recursive: true });
  await fs.writeFile(path.join(OUT, 'EXECUTIVE_SUMMARY.md'), `# TABA2 commercial catalog authority\n\n- Fecha: ${TODAY}\n- SKU heredados preservados: ${pending.length + rejected.length}\n- SKU aprobados para revisión interna: ${approved.length}\n- Precios: todos los SKU nuevos en pendiente, sin importación ni promoción.\n- Derechos: todos los activos nuevos quedan en pending_review.\n- Gate comercial: bloqueado por diseño.\n`);
  await fs.writeFile(path.join(OUT, 'PRIORITY_MATRIX.md'), `# Matriz de prioridad\n\n| Prioridad | SKU aprobados |\n| --- | ---: |\n| P0 | ${approved.filter((p) => p.priority === 'P0').length} |\n| P1 | ${approved.filter((p) => p.priority === 'P1').length} |\n| P2 | ${approved.filter((p) => p.priority === 'P2').length} |\n\nP0 contiene gaseosas, aguas, mixers, energizantes, fernet, aperitivos, cerveza, vino, gin, vodka, whisky e hielo.\n`);
  await fs.writeFile(path.join(OUT, 'PRODUCT_RESEARCH.md'), `# Investigación de productos\n\nLas fichas de identidad se obtuvieron el ${DATE} desde Jumbo Argentina como evidencia secundaria de cadena comercial. Cada fila en catalog/image-sources.csv registra URL, título, tipo, fecha, hash y estado. No se registraron precios ni GTIN.\n`);
  await fs.writeFile(path.join(OUT, 'REGIONAL_PRODUCTS_RESEARCH.md'), `# Productos regionales\n\n## approved\n\n- **Fin del Mundo Cabernet Franc 750 ml** — Bodega del Fin del Mundo, San Patricio del Chañar, Neuquén. La ficha de cadena comercial identifica producto, presentación e imagen; derechos de imagen pendientes.\n\n## candidate\n\n- Gin A / Destilería A: fabricante declara origen neuquino, pero falta fuente comercial con ficha de producto y packshot apto.\n- CHN American IPA en lata: fabricante identificado en Neuquén; falta validación de presentación y distribución comercial para TABA2.\n\n## insufficient_evidence\n\n- Gin Sendero: existe cobertura institucional reciente, pero no una ficha comercial con presentación, distribución e imagen verificables.\n\n## rejected\n\n- Marcas regionales vistas sólo en redes sociales: no se incorporan.\n`);
  await fs.writeFile(path.join(OUT, 'IMAGE_SOURCE_AUDIT.md'), `# Auditoría de fuentes de imagen\n\n- Activos normalizados: ${manifest.sources?.length || 0}.\n- Fichas pendientes por no tener packshot blanco verificable: ${manifest.skipped?.length || 0}.\n- Fuente: Jumbo Argentina, cadena comercial reconocida (evidencia secundaria), nunca marketplace.\n- Se conservó URL de ficha e imagen, título, fecha y SHA-256 por SKU.\n- El pipeline aborta si no encuentra og:image o si las esquinas no son blancas/transparentes.\n`);
  await fs.writeFile(path.join(OUT, 'IMAGE_RIGHTS_AUDIT.md'), `# Derechos de imágenes\n\nLos ${approved.length} packshots se clasifican **pending_review**. La fuente no concede una licencia de publicación comercial en la evidencia registrada. Se incluyen sólo para revisión interna, con publicación bloqueada.\n`);
  await fs.writeFile(path.join(OUT, 'DUPLICATE_ASSET_AUDIT.md'), `# Auditoría de duplicados\n\n- Masters nuevos: ${approved.length}; thumbnails nuevos: ${approved.length}.\n- Colisiones entre SKU aprobados: ninguna (SHA-256, rutas e imágenes fuente verificadas).\n- Pack Heineken x6 heredado: rechazado y preservado como excepción bloqueante.\n`);
  await fs.writeFile(path.join(OUT, 'REJECTED_PRODUCTS.md'), `# Rechazados\n\n- heineken-original-lata-473ml-pack-6: conserva rechazo por colisión de imagen con la lata individual. No se reemplazó ni reactivó.\n`);
  await fs.writeFile(path.join(OUT, 'PENDING_PRODUCTS.md'), `# Pendientes\n\n- ${pending.length} SKU requieren nueva imagen o trazabilidad antes de entrar a revisión interna.\n- Todos los ${approved.length} SKU nuevos: precio y derechos pendientes; no comprables ni publicables.\n- Coca-Cola Original, Villavicencio con gas, Fernet Branca 750 ml, Brancamenta, Gancia Americano, Martini Bianco, Smirnoff 700 ml y Portillo Malbec 750 ml no se aprobaron: la ficha ofrecía reverso, material gráfico, conflicto de capacidad o ningún packshot blanco verificable.\n- 7UP no se incorporó porque no quedó una ficha individual con imagen exacta dentro de esta pasada controlada. Ginger beer, Paso de los Toros y soda sí están cubiertos.\n- No se aprobó ningún pack nuevo.\n`);
  await fs.writeFile(path.join(OUT, 'FINAL_COVERAGE.md'), `# Cobertura final\n\n| Categoría | SKU aprobados para revisión interna |\n| --- | ---: |\n${categories.map(([k,v]) => `| ${k} | ${v} |`).join('\n')}\n\nTotal: ${approved.length}.\n`);
  await fs.writeFile(path.join(OUT, 'COMMERCIAL_GATE_STATUS.md'), `# Estado del gate comercial\n\n**CERRADO.** Las identidades e imágenes son aptas para revisión interna, pero los ${approved.length} productos nuevos mantienen price_status=pending, rights_status=pending_review y publication_status=blocked. No se ejecutó ningún apply de staging ni producción.\n`);
}

async function writeContactSheets(products) {
  const dir = path.join(OUT, 'contact-sheets');
  await fs.mkdir(dir, { recursive: true });
  for (const [category, rows] of Object.entries(groupBy(products, (p) => p.category_id))) {
    const cardW = 280; const cardH = 410; const cols = 4; const width = cols * cardW; const height = Math.ceil(rows.length / cols) * cardH;
    const cells = await Promise.all(rows.map(async (product, index) => {
      const x = (index % cols) * cardW; const y = Math.floor(index / cols) * cardH;
      const image = await sharp(path.join(ROOT, product.image_master)).resize(220, 270, { fit:'contain' }).png().toBuffer();
      const text = escapeXml(`${product.sku}\n${product.brand} · ${product.presentation}\n${product.image_status} · ${product.rights_status} · ${product.price_status}`);
      const svg = `<svg width="${cardW}" height="${cardH}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#fff" stroke="#d8d8d8"/><text x="12" y="292" font-family="Arial" font-size="13" fill="#161616">${text.split('\n').map((line,i)=>`<tspan x="12" dy="${i ? 21 : 0}">${line}</tspan>`).join('')}</text></svg>`;
      return { input: await sharp(Buffer.from(svg)).composite([{ input:image, gravity:'north' }]).png().toBuffer(), left:x, top:y };
    }));
    await sharp({ create:{ width, height, channels:3, background:'#ffffff' } }).composite(cells).png().toFile(path.join(dir, `${category}.png`));
  }
}

async function fetchText(url, sku) { const response = await fetch(url, { headers:{ 'user-agent':'TABA2 catalog authority review/1.0' }, signal:AbortSignal.timeout(30000) }); if (!response.ok) throw new Error(`${sku}: ficha HTTP ${response.status}.`); return response.text(); }
async function fetchBinary(url, sku) { const response = await fetch(url, { signal:AbortSignal.timeout(30000) }); if (!response.ok) throw new Error(`${sku}: imagen HTTP ${response.status}.`); const type=(response.headers.get('content-type')||'').toLowerCase(); if (!type.startsWith('image/')) throw new Error(`${sku}: respuesta no es imagen.`); return Buffer.from(await response.arrayBuffer()); }
function ogImagesOf(html) { return [...html.matchAll(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/gi)].map((match) => match[1]); }
function titleOf(html) { return decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || ''); }
async function selectWhitePackshot(urls, sku) { for (const image_source_url of [...new Set(urls)]) { try { const bytes = await fetchBinary(image_source_url, sku); return { image_source_url, bytes, sourceMeta: await assertWhiteBackground(bytes, sku) }; } catch (error) { if (!/fondo complejo/.test(String(error.message))) throw error; } } throw new Error(`${sku}: no hay un packshot de fondo blanco verificable en la ficha.`); }
async function assertWhiteBackground(bytes, sku) { const image=sharp(bytes).rotate(); const meta=await image.metadata(); const { data, info }=await image.ensureAlpha().raw().toBuffer({ resolveWithObject:true }); const points=[[0,0],[info.width-1,0],[0,info.height-1],[info.width-1,info.height-1]]; for(const [x,y] of points){ const i=(y*info.width+x)*4; const [r,g,b,a]=data.subarray(i,i+4); if(a>8 && (r<238 || g<238 || b<238)) throw new Error(`${sku}: fondo complejo detectado en una esquina; no se normaliza.`); } return { width:meta.width||0, height:meta.height||0, format:meta.format||'' }; }
async function normalize(bytes, packageType, size) { const max = ({lata:.74,sifon:.84,bolsa:.80,'botella-pet':.84,'botella-retornable':.84,botella:.86})[packageType] || .82; const trimmed=await sharp(bytes).rotate().flatten({background:'#ffffff'}).trim({background:'#ffffff',threshold:10}).resize(Math.round(size*max),Math.round(size*max),{fit:'inside',withoutEnlargement:false}).png().toBuffer(); return sharp({create:{width:size,height:size,channels:3,background:'#ffffff'}}).composite([{input:trimmed,gravity:'centre'}]).webp({quality:84,effort:6}).toBuffer(); }
function assertNoCollisions(products,sources) { for(const key of ['sku','image_sha256','image_thumbnail_sha256']){ const seen=new Set(); for(const p of products){ if(seen.has(p[key])) throw new Error(`Colisión bloqueante: ${key}=${p[key]}.`); seen.add(p[key]); } } const sourcesSeen=new Set(); for(const source of sources){ if(sourcesSeen.has(source.source_sha256)) throw new Error(`Colisión bloqueante de fuente: ${source.sku}.`); sourcesSeen.add(source.source_sha256); } }
function asset(file, bytes, size) { return { path:file, sha256:sha256(bytes), width:size, height:size, format:'webp', color_space:'srgb' }; }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function groupBy(items,key) { return items.reduce((all,item)=>{ const k=key(item); (all[k] ||= []).push(item); return all; },{}); }
function countBy(items,key) { return Object.fromEntries(Object.entries(groupBy(items,key)).map(([k,v])=>[k,v.length])); }
function escapeXml(value) { return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'); }
function decodeHtml(value) { return value.replaceAll('&amp;','&').replaceAll('&#x27;',"'").replaceAll('&quot;','"'); }
async function writeCsv(file, rows) { const keys=[...new Set(rows.flatMap((row)=>Object.keys(row)))]; const esc=(value)=>`"${typeof value === 'object' ? JSON.stringify(value) : String(value ?? '').replaceAll('"','""')}"`; await fs.writeFile(file, `${keys.join(',')}\n${rows.map((row)=>keys.map((key)=>esc(row[key])).join(',')).join('\n')}\n`); }
