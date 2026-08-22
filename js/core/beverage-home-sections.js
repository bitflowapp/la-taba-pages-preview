import { getActivePromotions } from './promotions.js';
import { recommendedRank } from './storefront-filters.js';

// Orden de negocio para la home. Las categorías del catálogo siguen siendo la
// fuente de verdad de cada SKU; este orden sólo decide qué se prioriza en la
// superficie de bebidas.
export const BEVERAGE_HOME_CATEGORY_ORDER = Object.freeze([
  'gaseosas',
  'cervezas',
  'aguas',
  // La góndola final trae jugos (Cepita 1,5 L): la sección existe desde ya y
  // se dibuja sola el día que haya uno comprable — una categoría sin nada
  // efectivamente comprable no aparece en la home, como todas.
  'jugos',
  'energizantes',
  'fernet',
  'aperitivos',
  'vinos',
  'espumantes',
  'destilados',
  'mixers',
  'hielo',
]);

export const BEVERAGE_HOME_SECTION_DEFINITIONS = Object.freeze([
  Object.freeze({ id: 'offers', title: 'Ofertas del día', kind: 'offers' }),
  // «Recomendados del local», no «Lo más pedido»: es una selección del
  // comercio, y el comercio no tiene métrica de ventas que respalde un ranking.
  Object.freeze({ id: 'popular', title: 'Recomendados del local', kind: 'popular' }),
  Object.freeze({ id: 'gaseosas', title: 'Gaseosas', kind: 'category', categoryIds: ['gaseosas'] }),
  Object.freeze({ id: 'cervezas', title: 'Cervezas', kind: 'category', categoryIds: ['cervezas'] }),
  Object.freeze({ id: 'aguas', title: 'Aguas', kind: 'category', categoryIds: ['aguas', 'aguas-saborizadas'] }),
  Object.freeze({ id: 'jugos', title: 'Jugos', kind: 'category', categoryIds: ['jugos'] }),
  Object.freeze({ id: 'energizantes', title: 'Energizantes', kind: 'category', categoryIds: ['energizantes'] }),
  Object.freeze({
    id: 'fernet-y-aperitivos',
    title: 'Fernet y aperitivos',
    kind: 'category',
    categoryIds: ['fernet', 'aperitivos'],
  }),
  Object.freeze({
    id: 'vinos-y-espumantes',
    title: 'Vinos y espumantes',
    kind: 'category',
    categoryIds: ['vinos', 'espumantes'],
  }),
  Object.freeze({ id: 'destilados', title: 'Destilados', kind: 'category', categoryIds: ['destilados'] }),
  Object.freeze({ id: 'mixers', title: 'Mixers', kind: 'category', categoryIds: ['mixers'] }),
  Object.freeze({ id: 'hielo', title: 'Hielo', kind: 'category', categoryIds: ['hielo'] }),
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
//
// LA FOTO NO DECIDE SI UN PRODUCTO EXISTE, y hasta hoy acá decidía.
//
// Esta función exigía `image || imageThumbnail`, que es el MISMO acople que la
// migración 108 vino a romper —sin foto no se vende— sobreviviendo en la
// vidriera. La base dejó de exigir imagen, `rowToCatalogProduct` dejó de
// exigirla y `productThumb` aprendió a dibujar el recurso propio de TABA; esta
// línea se quedó atrás y nadie lo vio, porque el catálogo con el que se probó
// siempre tuvo fotos.
//
// Medido el 2026-08-18 con un catálogo real sin fotografías: las 52 filas
// entraban, la vista de catálogo las dibujaba con su precio, y la HOME quedaba
// vacía entera —cero carruseles, cero «lo más pedido», cero banners, cero
// destinos editoriales— porque las once secciones parten de acá. La tienda se
// leía como si no vendiera nada.
//
// Una tarjeta sin foto no es una tarjeta rota: `productThumb` le pone el
// placeholder propio de TABA, con el mismo alto y su etiqueta accesible. Lo que
// decide si un producto se puede mostrar es que exista y esté en góndola; lo
// que decide si se puede comprar sigue estando en `isPurchasableBeverageProduct`.
export function isVisibleBeverageProduct(product) {
  return Boolean(
    product
      && product.archived !== true
      && product.procurementOnly !== true,
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

/**
 * El orden de «Recomendados del local»: el número del tag posicional manda, y
 * lo que no esté curado cae detrás con el orden comercial de siempre.
 */
function compareRecommended(left, right) {
  const leftRank = recommendedRank(left);
  const rightRank = recommendedRank(right);
  if (leftRank !== null && rightRank !== null) return leftRank - rightRank;
  if (leftRank !== null) return -1;
  if (rightRank !== null) return 1;
  return compareBeverageProducts(left, right);
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
    // Si el comercio curó su vidriera, manda su selección y su orden. Se exige
    // que sea COMPRABLE: recomendar en la primera pantalla algo agotado u
    // oculto es mandar al cliente a una pared. Si el comercio ocultó un
    // recomendado o se le acabó, la vidriera se acorta sola y sigue siendo
    // verdadera.
    const curados = products.filter((product) => (
      recommendedRank(product) !== null && isPurchasableBeverageProduct(product)
    ));
    if (curados.length) return curados;
    // Sin ninguno curado sigue en pie la selección heredada: no hay ventana en
    // la que la home quede sin su primer carrusel.
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
    // La vidriera curada respeta el orden que eligió el comercio; todo lo demás
    // sigue ordenándose por prioridad comercial.
    const comparador = definition.kind === 'popular' ? compareRecommended : compareBeverageProducts;
    const sectionProducts = productsForSection(definition, catalog, promotionKeys)
      .sort(comparador)
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
