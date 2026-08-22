import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BEVERAGE_HOME_SECTION_DEFINITIONS,
  buildBeverageHomeSections,
} from '../js/core/beverage-home-sections.js';
import { isPopularProduct, recommendedRank } from '../js/core/storefront-filters.js';

/*
 * «Recomendados del local»: la vidriera la cura el comercio en la base, con un
 * tag posicional por producto, y el cliente respeta esa selección y ESE ORDEN.
 * Estos casos son el contrato; la curación de apertura del 2026-08-22 depende
 * de que se cumpla exactamente.
 */

const producto = (sku, extra = {}) => ({
  id: sku,
  sku,
  name: sku,
  brand: sku,
  categoryId: 'gaseosas',
  categoryName: 'Gaseosas',
  price: 1000,
  stock: 10,
  available: true,
  priceStatus: 'confirmed',
  unitsPerPack: 1,
  tags: [],
  ...extra,
});

const seccionPopular = (products) => buildBeverageHomeSections(products, [])
  .find((section) => section.id === 'popular');

test('la sección se llama «Recomendados del local», no «Lo más pedido»', () => {
  const definicion = BEVERAGE_HOME_SECTION_DEFINITIONS.find((s) => s.id === 'popular');
  assert.equal(definicion.title, 'Recomendados del local');
  // El rótulo anterior afirmaba una métrica de ventas inexistente.
  for (const s of BEVERAGE_HOME_SECTION_DEFINITIONS) {
    assert.notEqual(s.title, 'Lo más pedido');
  }
});

test('recommendedRank lee el tag posicional y sólo ése', () => {
  assert.equal(recommendedRank(producto('a', { tags: ['recomendado-01'] })), 1);
  assert.equal(recommendedRank(producto('b', { tags: ['gaseosa', 'recomendado-12'] })), 12);
  assert.equal(recommendedRank(producto('c', { tags: ['RECOMENDADO-03'] })), 3);
  assert.equal(recommendedRank(producto('d', { tags: ['recomendado'] })), null);
  assert.equal(recommendedRank(producto('e', { tags: ['recomendado-x'] })), null);
  assert.equal(recommendedRank(producto('f', { tags: [] })), null);
  assert.equal(recommendedRank(null), null);
});

test('un producto curado es popular aunque no tenga el tag heredado', () => {
  assert.equal(isPopularProduct(producto('a', { tags: ['recomendado-05'] })), true);
  assert.equal(isPopularProduct(producto('b', { popular: true })), true);
  assert.equal(isPopularProduct(producto('c')), false);
});

test('la vidriera curada respeta el orden del comercio, no el comercial', () => {
  // Orden comercial: Coca-Cola tiene prioridad de marca sobre Pepsi y Sprite,
  // y dentro del mismo rango manda sortOrder. La curación lo pisa a propósito.
  const catalogo = [
    producto('coca', { brand: 'Coca-Cola', name: 'Coca-Cola', sortOrder: 10, tags: ['recomendado-01'] }),
    producto('sprite', { brand: 'Sprite', name: 'Sprite', sortOrder: 40, tags: ['recomendado-03'] }),
    producto('pepsi', { brand: 'Pepsi', name: 'Pepsi', sortOrder: 70, tags: ['recomendado-02'] }),
    producto('agua', { brand: 'Benedictino', name: 'Benedictino', sortOrder: 270, tags: ['recomendado-04'] }),
    producto('lata', { brand: 'Coca-Cola', name: 'Coca-Cola lata', sortOrder: 210 }),
  ];
  const seccion = seccionPopular(catalogo);
  assert.deepEqual(seccion.products.map((p) => p.sku), ['coca', 'pepsi', 'sprite', 'agua']);
  assert.equal(seccion.hidden, false);
});

test('sin ningún curado sigue en pie la vidriera heredada: nunca queda vacía', () => {
  const catalogo = [
    producto('a', { popular: true, sortOrder: 10 }),
    producto('b', { sortOrder: 20 }),
  ];
  const seccion = seccionPopular(catalogo);
  assert.deepEqual(seccion.products.map((p) => p.sku), ['a']);
});

test('un producto oculto o agotado no entra a la vidriera aunque esté curado', () => {
  const catalogo = [
    producto('curado-ok', { sortOrder: 10, tags: ['recomendado-01'] }),
    producto('curado-oculto', { sortOrder: 20, available: false, tags: ['recomendado-02'] }),
    producto('curado-sin-stock', { sortOrder: 30, stock: 0, tags: ['recomendado-03'] }),
  ];
  const seccion = seccionPopular(catalogo);
  assert.deepEqual(seccion.products.map((p) => p.sku), ['curado-ok']);
});

test('la curación de apertura entra completa y en su orden exacto', () => {
  // Los 12 aprobados el 2026-08-22, con el sortOrder real de producción, que a
  // propósito NO coincide con el orden pedido.
  const aprobados = [
    ['coca-cola-original-2250ml', 10],
    ['coca-cola-zero-2250ml', 20],
    ['sprite-original-2250ml', 40],
    ['fanta-naranja-2250ml', 30],
    ['pepsi-original-2000ml', 70],
    ['benedictino-sin-gas-2250ml', 270],
    ['villavicencio-sin-gas-1500ml', 290],
    ['coca-cola-original-botella-pet-500-ml-pack-x12', 150],
    ['paso-de-los-toros-tonica-1500ml', 260],
    ['aquarius-pomelo-2250ml', 350],
    ['red-bull-original-250ml', 410],
    ['speed-original-473ml', 390],
  ];
  const catalogo = aprobados.map(([sku, sortOrder], indice) => producto(sku, {
    sortOrder,
    tags: [`recomendado-${String(indice + 1).padStart(2, '0')}`],
  }));
  // Ruido: productos vendibles sin curar, en medio del catálogo.
  catalogo.push(producto('coca-cola-original-lata-354ml', { brand: 'Coca-Cola', sortOrder: 210 }));

  const seccion = buildBeverageHomeSections(catalogo, [], { limit: 12 })
    .find((s) => s.id === 'popular');
  assert.deepEqual(seccion.products.map((p) => p.sku), aprobados.map(([sku]) => sku));
});
