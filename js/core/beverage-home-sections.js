import { getActivePromotions } from './promotions.js';

// Orden de negocio para la home. Las categorías del catálogo siguen siendo la
// fuente de verdad de cada SKU; este orden sólo decide qué se prioriza en la
// superficie de bebidas.
export const BEVERAGE_HOME_CATEGORY_ORDER = Object.freeze([
  'gaseosas',
  'cervezas',
  'aguas',
  'energizantes',
  'fernet',
  'aperitivos',
  'vinos',
  'whisky',
  'gin',
  'mixers',
  'complementos',
]);

export const BEVERAGE_HOME_SECTION_DEFINITIONS = Object.freeze([
  Object.freeze({ id: 'offers', title: 'Ofertas del día', kind: 'offers' }),
  Object.freeze({ id: 'popular', title: 'Lo más pedido', kind: 'popular' }),
  Object.freeze({ id: 'gaseosas', title: 'Gaseosas', kind: 'category', categoryIds: ['gaseosas'] }),
  Object.freeze({ id: 'cervezas', title: 'Cervezas', kind: 'category', categoryIds: ['cervezas'] }),
  Object.freeze({ id: 'aguas', title: 'Aguas', kind: 'category', categoryIds: ['aguas', 'aguas-saborizadas'] }),
  Object.freeze({ id: 'energizantes', title: 'Energizantes', kind: 'category', categoryIds: ['energizantes'] }),
  Object.freeze({
    id: 'fernet-y-aperitivos',
    title: 'Fernet y aperitivos',
    kind: 'category',
    categoryIds: ['fernet', 'aperitivos'],
  }),
  Object.freeze({
    id: 'vinos-y-whisky',
    title: 'Vinos y whisky',
    kind: 'category',
    categoryIds: ['vinos', 'whisky'],
  }),
  Object.freeze({ id: 'mixers', title: 'Mixers', kind: 'category', categoryIds: ['mixers'] }),
  Object.freeze({ id: 'hielo', title: 'Hielo', kind: 'category', categoryIds: ['complementos'] }),
  Object.freeze({ id: 'combos', title: 'Combos', kind: 'combos' }),
]);

const REQUESTED_PRODUCT_PRIORITY = Object.freeze([
  'coca-cola',
  'pepsi',
  'sprite',
  'fanta',
  '7up',
  'quilmes',
  'brahma',
  'heineken',
  'stella artois',
  'patagonia',
  'corona',
  'red bull',
  'monster',
  'speed',
  'fernet branca',
  'fernet 1882',
  'campari',
  'gancia',
  'trapiche',
  'rutini',
  'johnnie walker',
  'jack daniel',
  'tanqueray',
  'schweppes',
  'soda',
  'hielo',
]);

const PRODUCT_PRIORITY = new Map(REQUESTED_PRODUCT_PRIORITY.map((term, index) => [term, index]));

// `procurementOnly` marca el pack con el que el local se surte. No es un
// producto de góndola, así que ninguna superficie del cliente puede mostrarlo
// ni ofrecerlo: dejarlo afuera acá alcanza para las tres —vidriera, carrusel y
// destino de una pieza editorial— porque todas parten de esta definición.
export function isVisibleBeverageProduct(product) {
  return Boolean(
    product
      && product.archived !== true
      && product.procurementOnly !== true
      && (String(product.image || '').trim() || String(product.imageThumbnail || '').trim()),
  );
}

export function isPurchasableBeverageProduct(product) {
  return Boolean(
    isVisibleBeverageProduct(product)
      && product.pricePending !== true
      && Number(product.price) > 0
      && product.available === true
      && Number(product.stock) > 0,
  );
}

export function uniqueBeverageProducts(products = []) {
  const seen = new Set();
  return (Array.isArray(products) ? products : []).filter((product) => {
    const key = String(product?.sku || product?.id || '').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function productPriority(product) {
  const text = [product?.brand, product?.name, product?.variant]
    .filter(Boolean)
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  let best = REQUESTED_PRODUCT_PRIORITY.length;
  for (const [term, rank] of PRODUCT_PRIORITY) {
    if (text.includes(term)) best = Math.min(best, rank);
  }
  return best;
}

function compareBeverageProducts(left, right) {
  const leftPriority = productPriority(left);
  const rightPriority = productPriority(right);
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;

  const leftOrderable = isPurchasableBeverageProduct(left) ? 0 : 1;
  const rightOrderable = isPurchasableBeverageProduct(right) ? 0 : 1;
  if (leftOrderable !== rightOrderable) return leftOrderable - rightOrderable;

  const leftSort = Number.isFinite(Number(left?.sortOrder)) ? Number(left.sortOrder) : 0;
  const rightSort = Number.isFinite(Number(right?.sortOrder)) ? Number(right.sortOrder) : 0;
  return leftSort - rightSort
    || String(left?.brand || left?.name || '').localeCompare(String(right?.brand || right?.name || ''), 'es')
    || String(left?.sku || left?.id || '').localeCompare(String(right?.sku || right?.id || ''), 'es');
}

function promotionProductKeys(promotions) {
  return new Set(promotions.flatMap((promotion) => promotion.includedSkus || []));
}

function productsForSection(definition, products, promotionKeys) {
  if (definition.kind === 'offers') {
    return products.filter((product) => (
      promotionKeys.has(product.id)
        || promotionKeys.has(product.sku)
    ) && isPurchasableBeverageProduct(product));
  }
  if (definition.kind === 'popular') {
    return products.filter((product) => product.popular === true && isVisibleBeverageProduct(product));
  }
  if (definition.kind === 'combos') {
    return products.filter((product) => product.combo === true && isVisibleBeverageProduct(product));
  }
  const categoryIds = new Set(definition.categoryIds || []);
  return products.filter((product) => categoryIds.has(product.categoryId) && isVisibleBeverageProduct(product));
}

/**
 * Builds the home sections from the current catalog and promotion state.
 *
 * Pending-price products intentionally remain in category sections. They are
 * visible and searchable, but `isPurchasableBeverageProduct` keeps them out
 * of the buyable/offer paths. Promotions are obtained through the validated
 * active-promotion contract, never from a product badge or old price.
 */
export function buildBeverageHomeSections(
  products = [],
  promotions = [],
  { now = new Date(), limit = Number.POSITIVE_INFINITY } = {},
) {
  const catalog = uniqueBeverageProducts(products);
  const activePromotions = getActivePromotions(promotions, now);
  const promotionKeys = promotionProductKeys(activePromotions);
  const safeLimit = Number.isFinite(Number(limit))
    ? Math.max(1, Math.floor(Number(limit)))
    : Number.MAX_SAFE_INTEGER;

  return BEVERAGE_HOME_SECTION_DEFINITIONS.map((definition) => {
    const sectionProducts = productsForSection(definition, catalog, promotionKeys)
      .sort(compareBeverageProducts)
      .slice(0, safeLimit);
    return {
      id: definition.id,
      title: definition.title,
      kind: definition.kind,
      categoryIds: [...(definition.categoryIds || [])],
      products: sectionProducts,
      hidden: sectionProducts.length === 0,
    };
  });
}

export function visibleBeverageHomeSections(products = [], promotions = [], options = {}) {
  return buildBeverageHomeSections(products, promotions, options).filter((section) => !section.hidden);
}

/**
 * Vidriera de "Destacados": lo comprable HOY, ordenado por prioridad comercial
 * y con una marca por tarjeta antes de repetir.
 *
 * Por qué la vuelta por marca: el orden comercial puro abre con las tres
 * variantes de Coca-Cola, así que el primer carrusel —el único que muchos ven
 * sin scrollear— parecía un solo producto repetido en vez del surtido del
 * local. Primero entra un representante de cada marca y recién después se
 * completan las variantes, así el cupo se gasta en surtido.
 *
 * Sólo entra lo comprable: un precio pendiente sigue vivo en el catálogo y en
 * la búsqueda, pero la vidriera es la superficie de compra.
 */
export function featuredBeverageProducts(products = [], { limit = 8 } = {}) {
  const ordered = uniqueBeverageProducts(products)
    .filter(isPurchasableBeverageProduct)
    .sort(compareBeverageProducts);

  const safeLimit = Number.isFinite(Number(limit)) ? Math.max(0, Math.floor(Number(limit))) : ordered.length;
  // Igualdad exacta de marca: alcanza con normalizar caja y espacios. No se
  // quitan diacríticos porque acá no se comparan cadenas parecidas sino la
  // misma marca escrita igual, y "Andes" nunca se confunde con "Andés".
  const brandKey = (product) => String(product?.brand || product?.name || product?.id || '')
    .toLowerCase()
    .trim();

  const seenBrands = new Set();
  const firstPerBrand = [];
  const rest = [];
  for (const product of ordered) {
    const key = brandKey(product);
    if (key && seenBrands.has(key)) rest.push(product);
    else {
      seenBrands.add(key);
      firstPerBrand.push(product);
    }
  }
  return [...firstPerBrand, ...rest].slice(0, safeLimit);
}

export function getBeverageHomeSection(sectionId, products = [], promotions = [], options = {}) {
  return buildBeverageHomeSections(products, promotions, options)
    .find((section) => section.id === sectionId) || null;
}
