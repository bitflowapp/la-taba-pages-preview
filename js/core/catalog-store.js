import { categories, products as demoProducts } from '../data.js';
import { isCommerciallyPurchasable, normalizeMoneyValue, normalizeStock } from './pricing.js';
import { sanitizeText } from './validators.js';
import { applyRetailNaming, linkProcurementPacks, publishRetailUnits } from './retail-packaging.js';

export const DEFAULT_NEW_PRODUCT_STOCK = 99;
export const CATALOG_BADGE_OPTIONS = Object.freeze(['', 'Promo', 'Nuevo', 'Más vendido']);

const CATEGORY_IDS = new Set(categories.map((category) => category.id).filter((id) => id !== 'all'));
const DEMO_PRODUCT_IDS = new Set(demoProducts.map((product) => product.id));
const DEFAULT_CATEGORY_ID = 'gaseosas';
const DEFAULT_MARKET_NOTE = 'El local confirma disponibilidad antes de preparar tu pedido.';
const CATEGORY_ID_ALIASES = Object.freeze({
  'vinos-espumantes': 'vinos-y-espumantes',
  'gins-vodkas': 'gins-y-vodkas',
  'whisky-destilados': 'whisky-y-destilados',
  'picadas-deli': 'picadas-y-deli',
  'hielo-extras': 'hielo-y-extras',
});
const ALCOHOLIC_CATEGORY_IDS = new Set([
  'cervezas',
  'vinos-y-espumantes',
  'gins-y-vodkas',
  'whisky-y-destilados',
]);

const TONE_BY_CATEGORY = Object.freeze({
  gaseosas: 'drink',
  mixers: 'drink',
  energizantes: 'drink',
  aguas: 'drink',
  jugos: 'drink',
  energeticas: 'drink',
  isotonicas: 'drink',
  cervezas: 'alcoholic',
  'vinos-y-espumantes': 'alcoholic',
  'gins-y-vodkas': 'alcoholic',
  'whisky-y-destilados': 'alcoholic',
  'picadas-y-deli': 'food',
  'hielo-y-extras': 'ice',
  promos: 'promo',
});

const UNIT_BY_CATEGORY = Object.freeze({
  gaseosas: { unit: 'unidad', unitLabel: 'Unidad' },
  mixers: { unit: 'unidad', unitLabel: 'Unidad' },
  energizantes: { unit: 'unidad', unitLabel: 'Unidad' },
  aguas: { unit: 'unidad', unitLabel: 'Unidad' },
  jugos: { unit: 'unidad', unitLabel: 'Unidad' },
  energeticas: { unit: 'unidad', unitLabel: 'Unidad' },
  isotonicas: { unit: 'unidad', unitLabel: 'Unidad' },
  cervezas: { unit: 'unidad', unitLabel: 'Unidad' },
  'vinos-y-espumantes': { unit: 'unidad', unitLabel: 'Unidad' },
  'gins-y-vodkas': { unit: 'unidad', unitLabel: 'Unidad' },
  'whisky-y-destilados': { unit: 'unidad', unitLabel: 'Unidad' },
  'picadas-y-deli': { unit: 'unidad', unitLabel: 'Unidad' },
  'hielo-y-extras': { unit: 'unidad', unitLabel: 'Unidad' },
  promos: { unit: 'promo', unitLabel: 'Promo' },
});

export function getEditableCategories() {
  return categories.filter((category) => category.id !== 'all');
}

/**
 * Pasada minorista del catálogo. Es de nivel CATÁLOGO —no de producto— porque
 * las dos cosas que resuelve necesitan ver a los vecinos: desambiguar un nombre
 * exige saber con quién colisiona, y vincular un pack de compra con su unidad
 * exige encontrar esa unidad. Va después de normalizar cada fila y es
 * idempotente: correrla dos veces da el mismo catálogo.
 */
export function applyRetailCatalogModel(list) {
  // Orden: nombres → vínculo compra/venta → publicación minorista. El último
  // paso aplica la decisión comercial —el pack abastece, la unidad se vende— y
  // necesita los dos anteriores resueltos.
  return publishRetailUnits(linkProcurementPacks(applyRetailNaming(list)));
}

export function buildDemoCatalog() {
  return applyRetailCatalogModel(
    demoProducts.map((product) => normalizeCatalogProduct(product)).filter(Boolean),
  );
}

export function restoreDemoCatalog() {
  return buildDemoCatalog();
}

export function mergeCatalogProducts(baseProducts = demoProducts, savedProducts = [], { refreshBaseCatalog = false } = {}) {
  const baseCatalog = (Array.isArray(baseProducts) ? baseProducts : [])
    .map((product) => normalizeCatalogProduct(product))
    .filter(Boolean);
  const savedList = Array.isArray(savedProducts) ? savedProducts : [];
  const savedById = new Map(
    savedList
      .filter((product) => product && typeof product.id === 'string')
      .map((product) => [product.id, product]),
  );
  const baseIds = new Set(baseCatalog.map((product) => product.id));

  const merged = baseCatalog.map((baseProduct) => {
    const saved = savedById.get(baseProduct.id);
    if (!saved) return baseProduct;
    const persistedFields = refreshBaseCatalog
      ? runtimeCatalogFields(saved)
      : editableProductFields(saved);
    return normalizeCatalogProduct({ ...baseProduct, ...persistedFields }, baseProduct);
  });

  for (const saved of savedList) {
    const id = sanitizeText(saved?.id, { maxLength: 80 });
    if (!id || baseIds.has(id)) continue;
    const product = normalizeCatalogProduct(saved);
    if (product) merged.push(product);
  }

  return applyRetailCatalogModel(merged);
}

export function getCustomerCatalogProducts(products = []) {
  return (Array.isArray(products) ? products : [])
    // `outOfCatalog` se retiene SÓLO para que el carrito pueda explicar una
    // línea que se quedó sin producto publicado. La góndola no lo muestra: si
    // lo hiciera, un producto agotado aparecería en la vitrina únicamente
    // porque alguien lo tenía en el carrito, que es peor que no mostrarlo.
    .filter((product) => isProductVisibleToCustomer(product) && product?.outOfCatalog !== true);
}

export function isProductVisibleToCustomer(product) {
  // `procurementOnly` es abastecimiento: el pack con el que el local se surte
  // no es un producto de góndola. Sigue existiendo en el catálogo interno —con
  // su id, su ficha y su historial— pero no se le ofrece al cliente.
  return Boolean(product && product.archived !== true && product.procurementOnly !== true);
}

/**
 * La compuerta que decide si algo puede entrar a un carrito.
 *
 * Pregunta por el CONTRATO —`isCommerciallyPurchasable`— y no por la bandera
 * `pricePending` sola. La diferencia importa cuando el backend manda una fila
 * incoherente: `pricePending` en falso con `price` en 0 pasaba esta compuerta y
 * terminaba en una línea de carrito a cero pesos. Ahora un precio que no es un
 * número mayor a cero es pendiente, diga lo que diga la bandera.
 */
export function isProductOrderable(product) {
  return Boolean(isProductVisibleToCustomer(product) && isCommerciallyPurchasable(product));
}

export function validateCatalogProductInput(input = {}) {
  const name = sanitizeText(input.name, { maxLength: 100 });
  if (!name) return invalidProduct('Ingresá un nombre para el producto.');

  const price = parsePrice(input.price);
  if (!Number.isFinite(price) || price <= 0) {
    return invalidProduct('Ingresá un precio válido mayor a cero.');
  }

  const submittedCategoryId = sanitizeText(input.categoryId, { maxLength: 40 });
  const categoryId = canonicalCategoryId(submittedCategoryId);
  if (!CATEGORY_IDS.has(categoryId)) return invalidProduct('Elegí una categoría válida.');

  return {
    ok: true,
    value: {
      name,
      description: sanitizeText(input.description, { maxLength: 180 }),
      price,
      categoryId,
      available: input.available !== false,
      badge: sanitizeText(input.badge, { maxLength: 32 }),
    },
  };
}

export function upsertCatalogProduct(products = [], input = {}, { productId = '', now = Date.now() } = {}) {
  const currentProducts = Array.isArray(products) ? products : [];
  const cleanProductId = sanitizeText(productId, { maxLength: 80 });
  const existing = cleanProductId
    ? currentProducts.find((product) => product.id === cleanProductId)
    : null;
  if (cleanProductId && !existing) return invalidProduct('Producto no encontrado.');

  const validation = validateCatalogProductInput(input);
  if (!validation.ok) return validation;

  const product = buildEditableProduct(validation.value, currentProducts, existing, { now });
  const nextProducts = existing
    ? currentProducts.map((candidate) => (candidate.id === existing.id ? product : candidate))
    : [product, ...currentProducts];

  return {
    ok: true,
    product,
    products: nextProducts,
    message: existing ? 'Producto actualizado.' : 'Producto creado.',
  };
}

export function toggleCatalogProductAvailability(products = [], productId) {
  return updateProductById(products, productId, (product) => ({
    ...product,
    available: !product.available,
  }), 'Disponibilidad actualizada.');
}

export function archiveCatalogProduct(products = [], productId) {
  return updateProductById(products, productId, (product) => ({
    ...product,
    available: false,
    archived: true,
  }), 'Producto archivado.');
}

export function restoreArchivedCatalogProduct(products = [], productId) {
  return updateProductById(products, productId, (product) => ({
    ...product,
    available: true,
    archived: false,
    stock: Math.max(1, normalizeStock(product.stock)),
  }), 'Producto restaurado.');
}

export function normalizeCatalogProduct(raw, fallback = null) {
  if (!isPlainObject(raw)) return null;
  const source = { ...(fallback || {}), ...raw };
  const id = sanitizeText(source.id, { maxLength: 80 });
  const name = sanitizeText(source.name, { fallback: fallback?.name || '', maxLength: 100 });
  const categoryId = normalizeCategoryId(source.categoryId || fallback?.categoryId) || DEFAULT_CATEGORY_ID;
  const defaults = defaultsForCategory(categoryId);
  const pricePending = source.pricePending === true || source.price_status === 'pending';
  const price = pricePending ? null : normalizeCatalogPrice(source.price, fallback?.price ?? 0);
  if (!id || !name || (price == null && !pricePending)) return fallback ? { ...fallback } : null;

  const archived = source.archived === true;
  const stock = normalizeStock(source.stock ?? fallback?.stock ?? DEFAULT_NEW_PRODUCT_STOCK);
  const oldPrice = pricePending || source.oldPrice == null ? undefined : normalizeMoneyValue(source.oldPrice, 0);
  const badge = sanitizeText(source.badge, { maxLength: 32 });
  const image = sanitizeText(source.image || source.imageUrl || source.image_url, { maxLength: 2048 });
  const imageThumbnail = sanitizeText(
    source.imageThumbnail || source.thumbnail || source.thumbnail_url,
    { maxLength: 2048 },
  );
  const alcoholic = source.nonAlcoholic === true
    ? false
    : ALCOHOLIC_CATEGORY_IDS.has(categoryId) || isExplicitlyAlcoholic(source.alcoholic);
  const minimumAge = alcoholic
    ? normalizeMinimumAge(source.minimumAge ?? source.minimum_age)
    : null;
  const capacityValue = normalizePositiveNumber(source.capacityValue ?? source.capacity_value);
  const capacityUnit = sanitizeText(source.capacityUnit || source.capacity_unit, { maxLength: 20 });
  const capacity = sanitizeText(
    source.capacity || [capacityValue || '', capacityUnit].filter(Boolean).join(' '),
    { maxLength: 40 },
  );
  const unitsPerPack = Math.max(1, Math.floor(Number(source.unitsPerPack ?? source.units_per_pack) || 1));
  const sortOrder = Math.max(0, Math.floor(Number(source.sortOrder ?? source.sort_order) || 0));
  const categoryName = categories.find((category) => category.id === categoryId)?.name || categoryId;

  return {
    ...source,
    id,
    name,
    description: sanitizeText(source.description, { fallback: fallback?.description || '', maxLength: 180 }),
    externalId: sanitizeText(source.externalId || source.external_id, { maxLength: 100 }),
    sku: sanitizeText(source.sku, { maxLength: 100 }),
    gtin: sanitizeText(source.gtin, { maxLength: 40 }),
    brand: sanitizeText(source.brand, { maxLength: 100 }),
    variant: sanitizeText(source.variant, { maxLength: 100 }),
    categoryId,
    categoryName,
    subcategory: sanitizeText(source.subcategory || source.subcategory_id, { maxLength: 100 }),
    capacity,
    capacityValue,
    capacityUnit,
    packageType: sanitizeText(
      source.packageType || source.packagingType || source.packaging_type || source.container,
      { fallback: 'unidad', maxLength: 60 },
    ),
    unitsPerPack,
    tone: alcoholic
      ? 'alcoholic'
      : sanitizeText(source.tone, { fallback: defaults.tone, maxLength: 40 }),
    price,
    pricePending,
    priceStatus: pricePending ? 'pending' : 'confirmed',
    regularPrice: oldPrice > Number(price) ? oldPrice : null,
    oldPrice: oldPrice > Number(price) ? oldPrice : undefined,
    stock,
    available: source.available !== false && !archived,
    archived,
    // El producto ya no está en el catálogo publicado, pero alguien lo tiene en
    // el carrito y se conserva para poder DECÍRSELO. No va a la góndola —lo
    // filtra `getCustomerCatalogProducts`— y llega siempre con `available:false`
    // y `stock:0`, así que `cartItemIssue` lo explica y `addToCart` lo rechaza.
    // Tiene que sobrevivir a esta normalización: si se pierde acá, la línea
    // vuelve a desaparecer sin aviso.
    ...(source.outOfCatalog === true ? { outOfCatalog: true } : {}),
    isActive: source.isActive ?? source.is_active ?? (!archived && source.available !== false),
    isVerified: Boolean(source.isVerified ?? source.is_verified),
    featured: Boolean(source.featured),
    chilled: Boolean(source.chilled ?? source.refrigerated),
    refrigerated: Boolean(source.chilled ?? source.refrigerated),
    sortOrder,
    popular: Boolean(source.popular),
    combo: Boolean(source.combo),
    ...(badge ? { badge } : {}),
    unit: sanitizeText(source.unit, { fallback: defaults.unit, maxLength: 40 }),
    unitLabel: sanitizeText(source.unitLabel, { fallback: defaults.unitLabel, maxLength: 80 }),
    marketNote: sanitizeText(source.marketNote, { fallback: DEFAULT_MARKET_NOTE, maxLength: 180 }),
    prepMinutes: Math.max(1, Math.floor(Number(source.prepMinutes) || fallback?.prepMinutes || 10)),
    alcoholic,
    minimumAge,
    tags: normalizeCatalogTags(source.tags),
    imageAlt: sanitizeText(source.imageAlt || source.image_alt, { maxLength: 200 }),
    imageSource: source.imageSource || source.image_source || null,
    imageRightsStatus: sanitizeText(source.imageRightsStatus || source.image_rights_status || source.rightsStatus, { maxLength: 60 }),
    imageSha256: sanitizeText(source.imageSha256 || source.image_sha256, { maxLength: 64 }),
    ...(image ? { image } : {}),
    ...(imageThumbnail ? { imageThumbnail } : {}),
  };
}

function normalizePositiveNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeCatalogTags(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(/[|,]/);
  return [...new Set(values
    .map((tag) => sanitizeText(tag, { maxLength: 40 }).toLowerCase())
    .filter(Boolean))]
    .slice(0, 20);
}

function buildEditableProduct(value, products, existing, { now }) {
  const categoryDefaults = defaultsForCategory(value.categoryId);
  const id = existing?.id || uniqueProductId(value.name, products, now);
  const source = {
    ...(existing || {}),
    id,
    name: value.name,
    description: value.description,
    price: value.price,
    categoryId: value.categoryId,
    tone: existing?.tone || categoryDefaults.tone,
    stock: existing ? normalizeStock(existing.stock) : DEFAULT_NEW_PRODUCT_STOCK,
    available: value.available,
    archived: false,
    featured: Boolean(existing?.featured),
    popular: Boolean(existing?.popular),
    combo: Boolean(existing?.combo),
    badge: value.badge,
    unit: existing?.unit || categoryDefaults.unit,
    unitLabel: existing?.unitLabel || categoryDefaults.unitLabel,
    marketNote: existing?.marketNote || DEFAULT_MARKET_NOTE,
    prepMinutes: existing?.prepMinutes || 10,
    ...(existing?.image ? { image: existing.image } : {}),
  };
  return normalizeCatalogProduct(source);
}

function editableProductFields(product) {
  return {
    name: product.name,
    description: product.description,
    categoryId: product.categoryId,
    tone: product.tone,
    price: product.price,
    oldPrice: product.oldPrice,
    stock: product.stock,
    available: product.available,
    archived: product.archived,
    featured: product.featured,
    popular: product.popular,
    combo: product.combo,
    badge: product.badge,
    unit: product.unit,
    unitLabel: product.unitLabel,
    marketNote: product.marketNote,
    prepMinutes: product.prepMinutes,
    alcoholic: product.alcoholic,
    minimumAge: product.minimumAge,
    image: product.image,
  };
}

// Un cambio publicado del catálogo no debe seguir mostrando el nombre, packshot,
// precio o presentación vieja que quedaron en un navegador. Conservamos sólo
// decisiones operativas del negocio sandbox que no cambian la identidad comercial.
function runtimeCatalogFields(product) {
  return {
    stock: product.stock,
    available: product.available,
    archived: product.archived,
  };
}

function updateProductById(products, productId, updater, successMessage) {
  const cleanProductId = sanitizeText(productId, { maxLength: 80 });
  const currentProducts = Array.isArray(products) ? products : [];
  let changedProduct = null;
  const nextProducts = currentProducts.map((product) => {
    if (product.id !== cleanProductId) return product;
    changedProduct = normalizeCatalogProduct(updater(product), product);
    return changedProduct;
  });
  if (!changedProduct) return invalidProduct('Producto no encontrado.');
  return { ok: true, product: changedProduct, products: nextProducts, message: successMessage };
}

function defaultsForCategory(categoryId) {
  const unitDefaults = UNIT_BY_CATEGORY[categoryId] || UNIT_BY_CATEGORY[DEFAULT_CATEGORY_ID];
  return {
    tone: TONE_BY_CATEGORY[categoryId] || TONE_BY_CATEGORY[DEFAULT_CATEGORY_ID],
    ...unitDefaults,
  };
}

function normalizeCategoryId(value) {
  const submittedCategoryId = sanitizeText(value, { fallback: DEFAULT_CATEGORY_ID, maxLength: 40 });
  const categoryId = canonicalCategoryId(submittedCategoryId);
  // La edición de la demo sigue restringida por validateCatalogProductInput(),
  // pero el catálogo productivo puede traer categorías verificadas del comercio.
  return /^[a-z0-9][a-z0-9-]{0,39}$/.test(categoryId) ? categoryId : DEFAULT_CATEGORY_ID;
}

function canonicalCategoryId(categoryId) {
  return CATEGORY_ID_ALIASES[categoryId] || categoryId;
}

function isExplicitlyAlcoholic(value) {
  return value === true
    || value === 1
    || (typeof value === 'string' && value.trim().toLowerCase() === 'true');
}

function normalizeMinimumAge(value) {
  const age = Math.floor(Number(value));
  return Number.isFinite(age) && age >= 18 ? age : 18;
}

function parsePrice(value) {
  if (value == null) return Number.NaN;
  const text = String(value).trim().replace(',', '.');
  if (!text) return Number.NaN;
  const numeric = Number(text);
  if (!Number.isFinite(numeric)) return Number.NaN;
  return normalizeMoneyValue(numeric, 0);
}

function normalizeCatalogPrice(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return normalizeMoneyValue(fallback, 0);
  return normalizeMoneyValue(numeric, 0);
}

function uniqueProductId(name, products, now) {
  const base = slugify(name) || 'producto';
  const used = new Set((Array.isArray(products) ? products : []).map((product) => product.id));
  if (!used.has(`p-${base}`) && !DEMO_PRODUCT_IDS.has(`p-${base}`)) return `p-${base}`;
  let suffix = Math.max(1, Math.floor(Number(now) || Date.now())).toString(36);
  let id = `p-${base}-${suffix}`;
  let index = 2;
  while (used.has(id) || DEMO_PRODUCT_IDS.has(id)) {
    id = `p-${base}-${suffix}-${index}`;
    index += 1;
  }
  return id;
}

function slugify(value) {
  return sanitizeText(value, { maxLength: 80 })
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function invalidProduct(message) {
  return { ok: false, message };
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
