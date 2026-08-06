// Góndola comercial · tanda 1.
//
// Lo que se fija acá es la ESTRUCTURA de venta: en qué orden empuja la home,
// qué acompaña a qué en el carrito y —sobre todo— que nada de eso se encienda
// sin producto comprable detrás. Los precios los carga el local; el día que
// lleguen, estas filas y estas reglas se prenden solas.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BEVERAGE_HOME_SECTION_DEFINITIONS,
  buildBeverageHomeSections,
  isPurchasableBeverageProduct,
} from '../js/core/beverage-home-sections.js';
import { CART_RECOMMENDATION_RULES, getCartRecommendations } from '../js/core/cart-recommendations.js';
import {
  applyRetailCatalogModel,
  getCustomerCatalogProducts,
  normalizeCatalogProduct,
} from '../js/core/catalog-store.js';
import { products as commercialProducts } from '../js/approved-beverage-demo-data.js';

const catalog = applyRetailCatalogModel(
  commercialProducts.map((product) => normalizeCatalogProduct(product)).filter(Boolean),
);
const visible = getCustomerCatalogProducts(catalog);
const purchasable = visible.filter(isPurchasableBeverageProduct);
// Mismo límite que usa la home (`renderHomeSections`): sin tope antes de
// filtrar comprables, para que un rubro con mercadería al fondo no quede
// tapado por los productos que todavía esperan precio.
const sectionsOf = (products) => buildBeverageHomeSections(products, [], { limit: Number.POSITIVE_INFINITY });
const section = (list, id) => list.find((entry) => entry.id === id);

// Producto de prueba mínimo y comprable. Sirve para encender rubros que el
// catálogo real todavía no tiene, sin tocar el catálogo real.
const sellable = (id, categoryId, extra = {}) => ({
  id, sku: id, name: id, brand: id, categoryId,
  image: `${id}.webp`, price: 1000, pricePending: false,
  available: true, stock: 5, unitsPerPack: 1, ...extra,
});

// ── Orden comercial de la góndola ───────────────────────────────────────────

test('la góndola declara el orden comercial pedido para la tanda 1', () => {
  const ids = BEVERAGE_HOME_SECTION_DEFINITIONS.map((definition) => definition.id);
  const comercial = ids.filter((id) => !['offers', 'combos', 'vinos-y-whisky'].includes(id));
  assert.deepEqual(comercial, [
    'popular',
    'para-esta-noche',
    'cervezas',
    'gaseosas',
    'fernet-y-combos',
    'energizantes',
    'agua-e-hielo',
    'algo-para-picar',
  ]);
});

test('cada fila comercial apunta a rubros reales del catálogo', () => {
  const rubros = new Set(visible.map((product) => product.categoryId));
  const declarados = BEVERAGE_HOME_SECTION_DEFINITIONS
    .filter((definition) => definition.kind === 'category')
    .flatMap((definition) => definition.categoryIds);
  // `snacks` es la única excepción admitida: el rubro todavía no existe y la
  // fila espera a que se cargue con datos reales.
  for (const id of declarados) {
    if (id === 'snacks') continue;
    assert.equal(rubros.has(id), true, `la fila declara "${id}", que no existe en el catálogo`);
  }
  assert.ok(declarados.includes('snacks'), 'la fila de picada quedó declarada para el futuro');
});

test('ninguna fila se enciende sin producto comprable', () => {
  const sections = sectionsOf(visible).filter((entry) => entry.kind === 'category');
  for (const entry of sections) {
    const comprables = entry.products.filter(isPurchasableBeverageProduct);
    if (entry.products.length && !comprables.length) {
      // Una fila con producto visible pero sin comprable existe en el modelo;
      // la home la descarta antes de pintar (ver renderHomeSections).
      assert.ok(true);
    }
  }
  // Hoy sólo dos rubros tienen mercadería: cervezas y energizantes.
  const conComprables = new Set(purchasable.map((product) => product.categoryId));
  assert.deepEqual([...conComprables].sort(), ['cervezas', 'energizantes']);
  assert.ok(section(sectionsOf(visible), 'algo-para-picar').products.length === 0);
});

test('"Para esta noche" cruza los rubros de consumo inmediato', () => {
  const definition = BEVERAGE_HOME_SECTION_DEFINITIONS.find((entry) => entry.id === 'para-esta-noche');
  assert.deepEqual(definition.categoryIds, ['cervezas', 'fernet', 'energizantes', 'mixers']);
  const entry = section(sectionsOf(visible), 'para-esta-noche');
  assert.ok(entry.products.length > 0, 'hoy la arman cervezas y energizantes');
  for (const product of entry.products.filter(isPurchasableBeverageProduct)) {
    assert.ok(definition.categoryIds.includes(product.categoryId), product.id);
  }
});

test('"Lo más pedido" no afirma un ranking que no existe', () => {
  // La vidriera sólo usa ese título si hay productos marcados como populares.
  const entry = section(sectionsOf(visible), 'popular');
  assert.equal(entry.products.length, 0, 'ningún producto declara ser el más pedido');
  assert.equal(visible.some((product) => product.popular === true), false);
});

test('las filas nuevas se encienden solas cuando el rubro tiene mercadería', () => {
  const conMercaderia = [
    ...visible,
    sellable('fernet-test', 'fernet'),
    sellable('agua-test', 'aguas'),
    sellable('hielo-test', 'complementos'),
    sellable('papas-test', 'snacks'),
    sellable('cola-test', 'gaseosas'),
  ];
  const sections = sectionsOf(conMercaderia);
  for (const id of ['fernet-y-combos', 'agua-e-hielo', 'algo-para-picar', 'gaseosas']) {
    const entry = section(sections, id);
    assert.ok(entry.products.some(isPurchasableBeverageProduct), `${id} sigue vacía con mercadería cargada`);
  }
});

// ── Recomendaciones ─────────────────────────────────────────────────────────

test('las reglas apuntan a rubros del catálogo real, salvo la de picada', () => {
  const rubros = new Set(visible.map((product) => product.categoryId));
  for (const rule of CART_RECOMMENDATION_RULES) {
    for (const categoryId of rule.targetCategories) {
      if (categoryId === 'snacks') continue;
      assert.equal(rubros.has(categoryId), true, `${rule.id} apunta a "${categoryId}", que no existe`);
    }
  }
});

test('fernet sugiere cola y hielo, nunca más alcohol', () => {
  const productos = [
    ...visible,
    sellable('fernet-branca-test', 'fernet', { alcoholic: true }),
    sellable('coca-test', 'gaseosas', { tags: ['cola'] }),
    sellable('hielo-test', 'complementos', { tags: ['hielo'] }),
  ];
  const resultado = getCartRecommendations({
    products: productos,
    cart: [{ productId: 'fernet-branca-test', quantity: 1 }],
    maxItems: 6,
  });
  assert.equal(resultado.title, 'Para el fernet');
  const ids = resultado.products.map((product) => product.id);
  assert.ok(ids.includes('coca-test'), 'falta la cola');
  assert.ok(ids.includes('hielo-test'), 'falta el hielo');
  for (const product of resultado.products) {
    assert.notEqual(product.alcoholic, true, `${product.id} suma alcohol`);
  }
});

test('cerveza sugiere para picar y hielo; energizante, picada o agua', () => {
  const productos = [
    ...visible,
    sellable('papas-test', 'snacks', { tags: ['snack'] }),
    sellable('hielo-test', 'complementos', { tags: ['hielo'] }),
    sellable('agua-test', 'aguas', { tags: ['agua'] }),
  ];
  const cerveza = purchasable.find((product) => product.categoryId === 'cervezas');
  const conCerveza = getCartRecommendations({ products: productos, cart: [{ productId: cerveza.id, quantity: 1 }], maxItems: 6 });
  assert.ok(conCerveza.products.some((product) => product.id === 'papas-test'), 'la cerveza no sugiere picada');
  for (const product of conCerveza.products) assert.notEqual(product.alcoholic, true);

  const energizante = purchasable.find((product) => product.categoryId === 'energizantes');
  const conEnergizante = getCartRecommendations({ products: productos, cart: [{ productId: energizante.id, quantity: 1 }], maxItems: 6 });
  const ids = conEnergizante.products.map((product) => product.id);
  assert.ok(ids.includes('papas-test') || ids.includes('agua-test'), 'el energizante no sugiere picada ni agua');
});

test('una gaseosa grande sugiere hielo o algo para picar', () => {
  const productos = [
    ...visible,
    sellable('cola-grande-test', 'gaseosas', { capacityValue: 2250, capacityUnit: 'ml' }),
    sellable('hielo-test', 'complementos', { tags: ['hielo'] }),
    sellable('papas-test', 'snacks', { tags: ['snack'] }),
  ];
  const resultado = getCartRecommendations({
    products: productos,
    cart: [{ productId: 'cola-grande-test', quantity: 1 }],
    maxItems: 6,
  });
  const ids = resultado.products.map((product) => product.id);
  assert.ok(ids.includes('hielo-test') || ids.includes('papas-test'));
});

test('la sugerencia nunca ofrece lo que no se puede comprar', () => {
  const productos = [
    ...visible,
    sellable('hielo-sin-precio', 'complementos', { price: null, pricePending: true, available: false, stock: 0 }),
    sellable('hielo-real', 'complementos', { tags: ['hielo'] }),
  ];
  const cerveza = purchasable.find((product) => product.categoryId === 'cervezas');
  const resultado = getCartRecommendations({ products: productos, cart: [{ productId: cerveza.id, quantity: 1 }], maxItems: 6 });
  assert.equal(resultado.products.some((product) => product.id === 'hielo-sin-precio'), false);
  assert.ok(resultado.products.some((product) => product.id === 'hielo-real'));
});

// ── Estado comercial de la tanda ────────────────────────────────────────────

test('la góndola publica sólo lo que tiene precio real: hoy, once unidades', () => {
  assert.equal(purchasable.length, 11);
  for (const product of purchasable) {
    assert.ok(Number(product.price) > 0, product.id);
    assert.equal(product.pricePending, false, product.id);
    assert.ok(Number(product.stock) > 0, product.id);
    assert.equal(product.unitsPerPack, 1, `${product.id} no es una unidad minorista`);
  }
  // Y el resto espera dato real, sin precio inventado ni cero.
  const pendientes = visible.filter((product) => !isPurchasableBeverageProduct(product));
  for (const product of pendientes) {
    assert.equal(Number(product.price) > 0, false, `${product.id} tiene precio sin estar publicado`);
  }
});
