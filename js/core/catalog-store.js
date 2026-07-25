import { categories, products as demoProducts } from '../data.js';
import { normalizeMoneyValue, normalizeStock } from './pricing.js';
import { sanitizeText } from './validators.js';

export const DEFAULT_NEW_PRODUCT_STOCK = 99;
export const CATALOG_BADGE_OPTIONS = Object.freeze(['', 'Promo', 'Nuevo', 'Más vendido']);

const CATEGORY_IDS = new Set(categories.map((category) => category.id).filter((id) => id !== 'all'));
const DEMO_PRODUCT_IDS = new Set(demoProducts.map((product) => product.id));
const DEFAULT_CATEGORY_ID = 'gaseosas';
const DEFAULT_MARKET_NOTE = 'El local confirma disponibilidad antes de preparar tu pedido.';

const TONE_BY_CATEGORY = Object.freeze({
  gaseosas: 'drink',
  aguas: 'drink',
  jugos: 'drink',
  energeticas: 'drink',
  isotonicas: 'drink',
  cervezas: 'alcoholic',
  'vinos-espumantes': 'alcoholic',
  'gins-vodkas': 'alcoholic',
  'whisky-destilados': 'alcoholic',
  'picadas-deli': 'food',
  'hielo-extras': 'ice',
  promos: 'promo',
});

const UNIT_BY_CATEGORY = Object.freeze({
  gaseosas: { unit: 'unidad', unitLabel: 'Unidad' },
  aguas: { unit: 'unidad', unitLabel: 'Unidad' },
  jugos: { unit: 'unidad', unitLabel: 'Unidad' },
  energeticas: { unit: 'unidad', unitLabel: 'Unidad' },
  isotonicas: { unit: 'unidad', unitLabel: 'Unidad' },
  cervezas: { unit: 'unidad', unitLabel: 'Unidad' },
  'vinos-espumantes': { unit: 'unidad', unitLabel: 'Unidad' },
  'gins-vodkas': { unit: 'unidad', unitLabel: 'Unidad' },
  'whisky-destilados': { unit: 'unidad', unitLabel: 'Unidad' },
  'picadas-deli': { unit: 'unidad', unitLabel: 'Unidad' },
  'hielo-extras': { unit: 'unidad', unitLabel: 'Unidad' },
  promos: { unit: 'promo', unitLabel: 'Promo' },
});

export function getEditableCategories() {
  return categories.filter((category) => category.id !== 'all');
}

export function buildDemoCatalog() {
  return demoProducts.map((product) => normalizeCatalogProduct(product)).filter(Boolean);
}

export function restoreDemoCatalog() {
  return buildDemoCatalog();
}

export function mergeCatalogProducts(baseProducts = demoProducts, savedProducts = []) {
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
    return saved ? normalizeCatalogProduct({ ...baseProduct, ...editableProductFields(saved) }, baseProduct) : baseProduct;
  });

  for (const saved of savedList) {
    const id = sanitizeText(saved?.id, { maxLength: 80 });
    if (!id || baseIds.has(id)) continue;
    const product = normalizeCatalogProduct(saved);
    if (product) merged.push(product);
  }

  return merged;
}

export function getCustomerCatalogProducts(products = []) {
  return (Array.isArray(products) ? products : []).filter((product) => isProductVisibleToCustomer(product));
}

export function isProductVisibleToCustomer(product) {
  return Boolean(product && product.archived !== true);
}

export function isProductOrderable(product) {
  return Boolean(isProductVisibleToCustomer(product) && product.available && Number(product.stock) > 0);
}

export function validateCatalogProductInput(input = {}) {
  const name = sanitizeText(input.name, { maxLength: 100 });
  if (!name) return invalidProduct('Ingresá un nombre para el producto.');

  const price = parsePrice(input.price);
  if (!Number.isFinite(price) || price <= 0) {
    return invalidProduct('Ingresá un precio válido mayor a cero.');
  }

  const categoryId = sanitizeText(input.categoryId, { maxLength: 40 });
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
  const price = normalizeCatalogPrice(source.price, fallback?.price ?? 0);
  if (!id || !name || price <= 0) return fallback ? { ...fallback } : null;

  const archived = source.archived === true;
  const stock = normalizeStock(source.stock ?? fallback?.stock ?? DEFAULT_NEW_PRODUCT_STOCK);
  const oldPrice = source.oldPrice == null ? undefined : normalizeMoneyValue(source.oldPrice, 0);
  const badge = sanitizeText(source.badge, { maxLength: 32 });
  const image = sanitizeText(source.image, { maxLength: 180 });

  return {
    ...source,
    id,
    name,
    description: sanitizeText(source.description, { fallback: fallback?.description || '', maxLength: 180 }),
    categoryId,
    tone: sanitizeText(source.tone, { fallback: defaults.tone, maxLength: 40 }),
    price,
    oldPrice: oldPrice > price ? oldPrice : undefined,
    stock,
    available: source.available !== false && !archived,
    archived,
    featured: Boolean(source.featured),
    popular: Boolean(source.popular),
    combo: Boolean(source.combo || categoryId === 'combos'),
    ...(badge ? { badge } : {}),
    unit: sanitizeText(source.unit, { fallback: defaults.unit, maxLength: 40 }),
    unitLabel: sanitizeText(source.unitLabel, { fallback: defaults.unitLabel, maxLength: 80 }),
    marketNote: sanitizeText(source.marketNote, { fallback: DEFAULT_MARKET_NOTE, maxLength: 180 }),
    prepMinutes: Math.max(1, Math.floor(Number(source.prepMinutes) || fallback?.prepMinutes || 10)),
    ...(image ? { image } : {}),
  };
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
    combo: Boolean(existing?.combo || value.categoryId === 'combos'),
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
    image: product.image,
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
  const categoryId = sanitizeText(value, { fallback: DEFAULT_CATEGORY_ID, maxLength: 40 });
  // La edición de la demo sigue restringida por validateCatalogProductInput(),
  // pero el catálogo productivo puede traer categorías verificadas del comercio.
  return /^[a-z0-9][a-z0-9-]{0,39}$/.test(categoryId) ? categoryId : DEFAULT_CATEGORY_ID;
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
