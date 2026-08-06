// Reglas de venta complementaria locales, legibles y deterministas. No usan
// perfiles personales ni servicios remotos: sólo catálogo, carrito y stock.
// Los ids son los del catálogo de bebidas real. Antes esta lista arrastraba
// los del catálogo heredado —`energeticas`, `vinos-y-espumantes`,
// `gins-y-vodkas`, `whisky-y-destilados`, `hielo-y-extras`, `picadas-y-deli`—
// que no existen acá: la regla de "no sumar más alcohol" no reconocía un
// fernet ni un gin, y los destinos apuntaban a rubros inexistentes.
const DRINK_CATEGORIES = new Set([
  'gaseosas',
  'aguas',
  'aguas-saborizadas',
  'isotonicas',
  'energizantes',
  'mixers',
  'cervezas',
  'fernet',
  'aperitivos',
  'vinos',
  'espumantes',
  'gin',
  'whisky',
]);

const ALCOHOL_CATEGORIES = new Set([
  'cervezas',
  'fernet',
  'aperitivos',
  'vinos',
  'espumantes',
  'gin',
  'whisky',
]);

// Cómo se acompaña cada compra en un autoservicio de bebidas. El orden de
// `targetCategories` es la prioridad comercial. `snacks` todavía no existe como
// rubro: queda declarado para que la regla se encienda sola el día que el local
// cargue papas y picadas, sin volver a tocar código.
export const CART_RECOMMENDATION_RULES = Object.freeze([
  Object.freeze({
    id: 'fernet-cola-hielo',
    when: 'fernet',
    targetCategories: ['gaseosas', 'complementos', 'mixers'],
    targetTags: ['cola', 'hielo', 'ice', 'mixer'],
    priority: 120,
    title: 'Para el fernet',
    copy: 'La cola y el hielo que faltan, disponibles ahora.',
  }),
  Object.freeze({
    id: 'alcohol-accompaniments',
    when: 'alcohol',
    targetCategories: ['snacks', 'complementos', 'gaseosas', 'mixers'],
    targetTags: ['snack', 'snacks', 'papas', 'mani', 'picada', 'golosina', 'golosinas', 'hielo', 'ice', 'mixer'],
    priority: 100,
    title: 'Completá tu pedido',
    copy: 'Elegimos acompañamientos sin alcohol disponibles para tu compra.',
  }),
  Object.freeze({
    id: 'soft-drink-accompaniments',
    when: 'soft-drinks',
    targetCategories: ['complementos', 'snacks'],
    targetTags: ['hielo', 'ice', 'snack', 'snacks', 'papas', 'mani', 'golosina', 'golosinas'],
    priority: 80,
    title: 'Podés sumar',
    copy: 'Una selección disponible para acompañar tus bebidas.',
  }),
  Object.freeze({
    id: 'energy-snacks',
    when: 'energy',
    targetCategories: ['snacks', 'aguas'],
    targetTags: ['snack', 'snacks', 'papas', 'mani', 'golosina', 'golosinas', 'agua'],
    priority: 70,
    title: 'Para acompañar',
    copy: 'Productos disponibles que combinan con tus energizantes.',
  }),
]);

function normalizedTags(product = {}) {
  return new Set((Array.isArray(product.tags) ? product.tags : [])
    .map((tag) => String(tag || '').trim().toLocaleLowerCase('es-AR'))
    .filter(Boolean));
}

// Sólo puede sugerirse lo que el cliente puede COMPRAR ahora: disponible, con
// stock y con precio publicado (P1-3 de la auditoría comercial — sugerir un
// "Precio próximamente" sería ofrecer lo invendible en el paso de pagar).
// Tampoco entra un pack de abastecimiento: no está en la góndola, así que no
// puede aparecer como sugerencia en el paso de pagar.
function isOrderable(product) {
  return Boolean(
    product
      && product.available !== false
      && !product.archived
      && product.procurementOnly !== true
      && Number(product.stock) > 0
      && product.pricePending !== true
      && Number(product.price) > 0,
  );
}

function isAlcohol(product = {}) {
  return product.alcoholic === true || ALCOHOL_CATEGORIES.has(product.categoryId);
}

function matchesRule(rule, cartProducts) {
  // El fernet tiene su propia regla porque su acompañamiento es específico —la
  // cola y el hielo— y no cualquier snack. Se evalúa antes que la de alcohol.
  if (rule.when === 'fernet') {
    return cartProducts.some((product) => product.categoryId === 'fernet');
  }
  if (rule.when === 'alcohol') return cartProducts.some(isAlcohol);
  if (rule.when === 'soft-drinks') {
    return cartProducts.some((product) => product.categoryId === 'gaseosas');
  }
  if (rule.when === 'energy') {
    return cartProducts.some((product) => product.categoryId === 'energizantes');
  }
  return false;
}

function scoreCandidate(product, rules) {
  const tags = normalizedTags(product);
  return rules.reduce((best, rule) => {
    const categoryIndex = rule.targetCategories.indexOf(product.categoryId);
    const tagIndex = rule.targetTags.findIndex((tag) => tags.has(tag));
    const categoryScore = categoryIndex >= 0 ? rule.priority - categoryIndex * 4 : 0;
    const tagScore = tagIndex >= 0 ? rule.priority + 8 - tagIndex : 0;
    return Math.max(best, categoryScore, tagScore);
  }, 0);
}

/**
 * Devuelve sólo artículos comprables (disponibles, con stock y con precio
 * publicado) que todavía no están en el carrito, ordenados por precio
 * ascendente. La lista es estable: a igual precio decide la relevancia de la
 * regla y después nombre e id.
 */
export function getCartRecommendations({ products = [], cart = [], maxItems = 6 } = {}) {
  const productById = new Map((Array.isArray(products) ? products : []).map((product) => [product.id, product]));
  const cartIds = new Set((Array.isArray(cart) ? cart : []).map((line) => line?.productId).filter(Boolean));
  const cartProducts = [...cartIds].map((id) => productById.get(id)).filter(Boolean);
  const rules = CART_RECOMMENDATION_RULES.filter((rule) => matchesRule(rule, cartProducts));
  if (!rules.length) return { title: '', copy: '', products: [], rules: [] };

  const sourceHasAlcohol = cartProducts.some(isAlcohol);
  const candidates = (Array.isArray(products) ? products : [])
    .filter(isOrderable)
    .filter((product) => !cartIds.has(product.id))
    // Nunca sugerimos sumar más alcohol: priorizamos acompañamientos seguros.
    .filter((product) => !sourceHasAlcohol || !isAlcohol(product))
    .map((product) => ({ product, score: scoreCandidate(product, rules) }))
    .filter((entry) => entry.score > 0)
    // Primero lo más accesible: la sugerencia acompaña el pedido, no lo
    // agranda a la fuerza (P1-3 — antes se ofrecían packs de $19.999 para una
    // brecha de mínimo de $1.100). A igual precio decide la relevancia.
    .sort((left, right) => (
      (Number(left.product.price) || 0) - (Number(right.product.price) || 0)
      || right.score - left.score
      || String(left.product.name || '').localeCompare(String(right.product.name || ''), 'es')
      || String(left.product.id || '').localeCompare(String(right.product.id || ''))
    ))
    .slice(0, Math.max(1, Math.min(8, Math.floor(Number(maxItems) || 6))));

  const primary = rules[0];
  return {
    title: candidates.length ? primary.title : '',
    copy: candidates.length ? primary.copy : '',
    products: candidates.map((entry) => entry.product),
    rules: rules.map((rule) => rule.id),
  };
}

export function cartContainsComplementaryProducts({ products = [], cart = [] } = {}) {
  const productById = new Map((Array.isArray(products) ? products : []).map((product) => [product.id, product]));
  return (Array.isArray(cart) ? cart : [])
    .map((line) => productById.get(line?.productId))
    .filter(Boolean)
    .some((product) => (
      product.categoryId === 'hielo-y-extras'
      || product.categoryId === 'picadas-y-deli'
      || normalizedTags(product).has('hielo')
      || normalizedTags(product).has('ice')
    ));
}

export function cartNeedsComplementPrompt({ products = [], cart = [] } = {}) {
  const cartProducts = (Array.isArray(cart) ? cart : [])
    .map((line) => (Array.isArray(products) ? products : []).find((product) => product.id === line?.productId))
    .filter(Boolean);
  if (!cartProducts.some((product) => DRINK_CATEGORIES.has(product.categoryId))) return false;
  if (cartContainsComplementaryProducts({ products, cart })) return false;
  return getCartRecommendations({ products, cart, maxItems: 4 }).products.length > 0;
}
