import assert from 'node:assert/strict';
import test from 'node:test';

import { products } from '../js/approved-beverage-demo-data.js';
import {
  BEVERAGE_HOME_CATEGORY_ORDER,
  BEVERAGE_HOME_SECTION_DEFINITIONS,
  buildBeverageHomeSections,
  isPurchasableBeverageProduct,
  uniqueBeverageProducts,
} from '../js/core/beverage-home-sections.js';

const section = (sections, id) => sections.find((candidate) => candidate.id === id);

test('la home abre con la bebida y sigue con el resto de la tienda', () => {
  /*
   * LAS CATORCE PRIMERAS SON LAS DE SIEMPRE, EN EL MISMO ORDEN.
   *
   * TABA pasó de vender sólo bebida a vender lo que se compra a cualquier hora,
   * y el riesgo de esa mudanza es que la góndola por la que el comercio es
   * conocido pierda el lugar que tenía. Por eso el orden de bebida se afirma
   * ENTERO y COMO PREFIJO: cualquier reordenamiento accidental del rubro
   * histórico rompe acá antes de llegar a la primera pantalla de un cliente.
   *
   * `aguas-saborizadas` es la única incorporación al tramo de bebida: tenía
   * productos y chip pero no figuraba en la prioridad, así que caía al final por
   * la puerta de «lo que no está en la lista se suma igual». Ahora va donde
   * corresponde, al lado de las aguas, y comparte carrusel con ellas.
   */
  const BEBIDA = [
    'gaseosas',
    'cervezas',
    'aguas',
    'aguas-saborizadas',
    // La góndola final trae jugos (Cepita 1,5 L); la sección se dibuja sola
    // el día que haya uno comprable.
    'jugos',
    'energizantes',
    // Las isotónicas tenían chip en la tira de categorías y ninguna sección
    // detrás: en la home los tres productos no aparecían en ningún carrusel.
    'isotonicas',
    'fernet',
    'aperitivos',
    'vinos',
    'espumantes',
    'destilados',
    'mixers',
    'hielo',
  ];
  // Los ocho rubros del resto de la tienda 24/7. Van DETRÁS de la bebida: una
  // categoría sin productos comprables no se dibuja, así que declararlas no
  // pone un carrusel vacío en la home.
  const RESTO = [
    'snacks',
    'golosinas',
    'almacen',
    'limpieza',
    'higiene-personal',
    'hogar',
    'mascotas',
    'otros',
  ];
  assert.deepEqual(BEVERAGE_HOME_CATEGORY_ORDER.slice(0, BEBIDA.length), BEBIDA);
  assert.deepEqual(BEVERAGE_HOME_CATEGORY_ORDER, [...BEBIDA, ...RESTO]);

  assert.deepEqual(
    BEVERAGE_HOME_SECTION_DEFINITIONS.map((definition) => definition.id),
    [
      'offers',
      'popular',
      'gaseosas',
      'cervezas',
      'aguas',
      'jugos',
      'energizantes',
      'isotonicas',
      'fernet-y-aperitivos',
      'vinos-y-espumantes',
      'destilados',
      'mixers',
      'hielo',
      ...RESTO,
      'combos',
    ],
  );

  // Las secciones que fusionan dos categorías lo siguen haciendo. Se deriva de
  // la taxonomía —dos categorías que declaran la misma sección comparten rail—
  // así que esto verifica la derivación, no una lista copiada.
  const porId = new Map(BEVERAGE_HOME_SECTION_DEFINITIONS.map((definition) => [definition.id, definition]));
  assert.deepEqual([...porId.get('aguas').categoryIds], ['aguas', 'aguas-saborizadas']);
  assert.deepEqual([...porId.get('fernet-y-aperitivos').categoryIds], ['fernet', 'aperitivos']);
  assert.deepEqual([...porId.get('vinos-y-espumantes').categoryIds], ['vinos', 'espumantes']);
});

test('productos comprables requieren precio confirmado, disponibilidad y stock', () => {
  const coca = products.find((product) => product.sku === 'coca-cola-original-pet-500ml-pack-12');
  const pending = products.find((product) => product.sku === 'sprite-sin-azucar-600ml');
  const noStock = { ...coca, sku: 'no-stock', id: 'no-stock', stock: 0 };

  assert.equal(isPurchasableBeverageProduct(coca), true);
  assert.equal(isPurchasableBeverageProduct(pending), false);
  assert.equal(isPurchasableBeverageProduct(noStock), false);
});

test('precio pendiente permanece visible en su sección pero no entra en ofertas', () => {
  const pending = products.find((product) => product.sku === 'sprite-sin-azucar-600ml');
  const sections = buildBeverageHomeSections(products, [], { limit: 20 });

  assert.ok(section(sections, 'gaseosas').products.some((product) => product.sku === pending.sku));
  assert.equal(section(sections, 'offers').products.length, 0);
  assert.equal(isPurchasableBeverageProduct(pending), false);
});

test('sólo una promoción aprobada, vigente y con valores reales alimenta Ofertas del día', () => {
  const product = products.find((candidate) => candidate.sku === 'coca-cola-original-pet-500ml-pack-12');
  const validPromotion = {
    promoId: 'promo-coca-real',
    title: 'Coca-Cola confirmada',
    includedSkus: [product.sku],
    promotionType: 'precio_promocional',
    regularPrice: product.price,
    promotionalPrice: product.price - 100,
    validFrom: '2026-08-01',
    validUntil: '2026-08-31',
    active: true,
    priority: 1,
    previewOnly: true,
    approvalStatus: 'APROBADA',
    approvalReference: 'TABA2-REVIEW-001',
  };
  const invalidPromotion = {
    ...validPromotion,
    promoId: 'promo-coca-pendiente',
    approvalStatus: 'PENDIENTE',
    approvalReference: '',
  };

  const validSections = buildBeverageHomeSections(products, [validPromotion], {
    now: new Date('2026-08-04T12:00:00-03:00'),
  });
  const invalidSections = buildBeverageHomeSections(products, [invalidPromotion], {
    now: new Date('2026-08-04T12:00:00-03:00'),
  });

  assert.deepEqual(section(validSections, 'offers').products.map((candidate) => candidate.sku), [product.sku]);
  assert.equal(section(invalidSections, 'offers').products.length, 0);
});

test('secciones sin datos válidos se ocultan y no se rellenan con productos ajenos', () => {
  const sections = buildBeverageHomeSections(products, [], { limit: 20 });
  const visibleIds = sections.filter((candidate) => !candidate.hidden).map((candidate) => candidate.id);

  assert.equal(section(sections, 'popular').hidden, true);
  assert.equal(section(sections, 'combos').hidden, true);
  assert.ok(!visibleIds.includes('offers'));
  assert.ok(!section(sections, 'gaseosas').products.some((product) => product.categoryId !== 'gaseosas'));
});

test('el catálogo de home no duplica SKU y mantiene foco en bebidas', () => {
  const unique = uniqueBeverageProducts(products);
  assert.equal(unique.length, products.length);
  assert.equal(new Set(unique.map((product) => product.sku)).size, unique.length);
  assert.ok(unique.every((product) => !/arroz|limpieza|almac[eé]n general/i.test(
    `${product.name} ${product.categoryId} ${(product.tags || []).join(' ')}`,
  )));
  assert.ok(unique.some((product) => /Coca-Cola/i.test(product.name)));
  assert.ok(unique.some((product) => /Quilmes|Brahma|Heineken|Corona/i.test(product.name)));
  assert.ok(unique.some((product) => /Red Bull|Monster|Speed/i.test(product.name)));
});
