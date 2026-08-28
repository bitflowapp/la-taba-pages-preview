/*
 * BUSCAR EN UNA TIENDA QUE YA NO ES SÓLO DE BEBIDA.
 *
 * El buscador se probó con un catálogo de bebidas y con las palabras de una
 * góndola de bebidas. Cuando entren lavandina, papel higiénico y alimento para
 * perro, las consultas van a ser otras y hay dos formas de fallar:
 *
 *   · POR DEFECTO — «lavandina» no encuentra la lavandina porque la palabra no
 *     está en ningún campo indexado;
 *   · POR EXCESO — «lavandina» devuelve los treinta artículos de limpieza
 *     porque alguien la puso como sinónimo de la categoría.
 *
 * Las dos arruinan la búsqueda, y la segunda además no se nota: el resultado
 * «parece» razonable. Por eso cada caso del encargo se prueba con su
 * contraprueba, verificando qué NO tiene que aparecer.
 *
 * Los productos de acá son maquetas mínimas: no hay ningún artículo de limpieza
 * en el catálogo real, y este archivo no da de alta ninguno. Prueban el
 * MECANISMO, que es lo que tiene que estar listo antes de que Walter cargue el
 * primero.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeCatalogProduct } from '../js/core/catalog-store.js';
import { productMatchesCode, productMatchesQuery } from '../js/core/catalog-search.js';

const producto = (fields) => normalizeCatalogProduct({
  price: 1500, stock: 6, available: true, ...fields,
});

/*
 * Una góndola multi-rubro chica pero representativa: dos artículos por rubro,
 * para que un sinónimo demasiado ancho se note al traer al vecino.
 */
const GONDOLA = [
  producto({
    id: 'lavandina-ayudin-1000ml', sku: 'lavandina-ayudin-1000ml', brand: 'Ayudín', name: 'Ayudín',
    variant: 'Original', categoryId: 'limpieza', subcategory: 'lavandina',
    capacityValue: 1000, capacityUnit: 'ml',
  }),
  producto({
    id: 'detergente-magistral-750ml', sku: 'detergente-magistral-750ml', brand: 'Magistral', name: 'Magistral',
    variant: 'Limón', categoryId: 'limpieza', subcategory: 'detergente',
    capacityValue: 750, capacityUnit: 'ml',
  }),
  producto({
    id: 'papel-higienico-elite-4un', sku: 'papel-higienico-elite-4un', brand: 'Elite', name: 'Elite',
    variant: 'Doble hoja', categoryId: 'higiene-personal', subcategory: 'papel higiénico',
    unitsPerPack: 4,
  }),
  producto({
    id: 'shampoo-sedal-340ml', sku: 'shampoo-sedal-340ml', brand: 'Sedal', name: 'Sedal',
    variant: 'Rizos obedientes', categoryId: 'higiene-personal', subcategory: 'shampoo',
    capacityValue: 340, capacityUnit: 'ml',
  }),
  producto({
    id: 'galletitas-oreo-118g', sku: 'galletitas-oreo-118g', brand: 'Oreo', name: 'Oreo',
    variant: 'Original', categoryId: 'golosinas', subcategory: 'galletitas',
  }),
  producto({
    id: 'yerba-playadito-1000g', sku: 'yerba-playadito-1000g', brand: 'Playadito', name: 'Playadito',
    variant: 'Con palo', categoryId: 'almacen', subcategory: 'yerba',
  }),
  producto({
    id: 'coca-cola-original-1500ml', sku: 'coca-cola-original-1500ml', brand: 'Coca-Cola', name: 'Coca-Cola',
    variant: 'Original', categoryId: 'gaseosas', subcategory: 'cola',
    capacityValue: 1500, capacityUnit: 'ml',
  }),
  producto({
    id: 'agua-villavicencio-500ml', sku: 'agua-villavicencio-500ml', brand: 'Villavicencio', name: 'Villavicencio',
    variant: 'Sin gas', categoryId: 'aguas', subcategory: 'sin gas',
    capacityValue: 500, capacityUnit: 'ml',
  }),
  producto({
    id: 'alimento-perro-dogui-3000g', sku: 'alimento-perro-dogui-3000g', brand: 'Dogui', name: 'Dogui',
    variant: 'Adultos', categoryId: 'mascotas', subcategory: 'alimento para perro',
  }),
];

const buscar = (consulta) => GONDOLA.filter((item) => productMatchesQuery(item, consulta)).map((item) => item.id);

test('los ocho casos del encargo encuentran lo que se pidió', () => {
  // Cada fila: consulta, lo que TIENE que aparecer.
  const CASOS = [
    ['lavandina', ['lavandina-ayudin-1000ml']],
    ['detergente', ['detergente-magistral-750ml']],
    ['coca', ['coca-cola-original-1500ml']],
    ['coca cola', ['coca-cola-original-1500ml']],
    ['agua', ['agua-villavicencio-500ml']],
    ['papel higienico', ['papel-higienico-elite-4un']],
    ['galletitas', ['galletitas-oreo-118g']],
    ['shampoo', ['shampoo-sedal-340ml']],
  ];
  for (const [consulta, esperado] of CASOS) {
    assert.deepEqual(buscar(consulta), esperado, `«${consulta}» no devolvió lo esperado`);
  }
});

test('la normalización cubre acentos, mayúsculas y espacios de más', () => {
  // Son las tres formas en las que la misma persona escribe la misma palabra
  // según el teclado que tenga a mano.
  for (const consulta of ['papel higiénico', 'PAPEL HIGIENICO', '  papel   higienico  ', 'Papel Higiénico']) {
    assert.deepEqual(buscar(consulta), ['papel-higienico-elite-4un'], `«${consulta}» tendría que encontrarlo`);
  }
  assert.deepEqual(buscar('AYUDÍN'), ['lavandina-ayudin-1000ml']);
});

test('un nombre de producto no arrastra el rubro entero', () => {
  /*
   * La contraprueba que le da sentido a la anterior. «lavandina» tiene que
   * devolver la lavandina y NO el detergente: si alguien pone los nombres de
   * producto como sinónimos de la categoría, esta prueba lo detecta.
   */
  assert.ok(!buscar('lavandina').includes('detergente-magistral-750ml'));
  assert.ok(!buscar('shampoo').includes('papel-higienico-elite-4un'));
  assert.ok(!buscar('galletitas').includes('yerba-playadito-1000g'));
  assert.ok(!buscar('coca').includes('agua-villavicencio-500ml'));
});

test('la palabra del rubro sí devuelve el rubro entero', () => {
  // Es la otra mitad del contrato: «limpieza» es una familia, no un producto.
  assert.deepEqual(buscar('limpieza'), ['lavandina-ayudin-1000ml', 'detergente-magistral-750ml']);
  assert.deepEqual(buscar('articulos de limpieza'), ['lavandina-ayudin-1000ml', 'detergente-magistral-750ml']);
  assert.deepEqual(buscar('higiene personal'), ['papel-higienico-elite-4un', 'shampoo-sedal-340ml']);
  assert.deepEqual(buscar('mascotas'), ['alimento-perro-dogui-3000g']);
  assert.deepEqual(buscar('almacen'), ['yerba-playadito-1000g']);
  assert.deepEqual(buscar('despensa'), ['yerba-playadito-1000g']);
});

test('el código del producto encuentra por coincidencia exacta y nada más', () => {
  /*
   * Con cientos de artículos, quien atiende el mostrador tiene el código en la
   * planilla o en la etiqueta y lo pega en el buscador. Es EXACTO a propósito:
   * meter el SKU en el índice haría que «12» devolviera productos por un pedazo
   * de su identificador.
   */
  assert.deepEqual(buscar('lavandina-ayudin-1000ml'), ['lavandina-ayudin-1000ml']);
  assert.deepEqual(buscar('  LAVANDINA-AYUDIN-1000ML  '), ['lavandina-ayudin-1000ml']);

  /*
   * MEDIO CÓDIGO NO ES UN CÓDIGO.
   *
   * La comparación es contra el identificador completo. Un pedazo puede seguir
   * encontrando el producto —«ayudin 1000ml» son dos palabras que el índice
   * tiene por otro lado— pero eso es la búsqueda de texto de siempre, no la
   * puerta del código. La diferencia importa: si el SKU entrara al índice, un
   * fragmento como «pack 12» empezaría a devolver productos por un pedazo de su
   * identificador y nadie entendería por qué.
   */
  assert.equal(productMatchesCode(GONDOLA[0], 'ayudin-1000ml'), false);
  assert.equal(productMatchesCode(GONDOLA[0], 'lavandina'), false);
  assert.equal(productMatchesCode(GONDOLA[0], ''), false);
  assert.deepEqual(buscar('lavandina-ayudin-1000ml-x'), []);
  // Y el GTIN también, cuando el catálogo lo trae.
  const conGtin = producto({
    id: 'jabon-x', sku: 'jabon-x', name: 'Jabón', categoryId: 'limpieza', gtin: '7790040000019',
  });
  assert.equal(productMatchesQuery(conGtin, '7790040000019'), true);
  assert.equal(productMatchesQuery(conGtin, '779004'), false);
});

test('la búsqueda de bebida que ya funcionaba sigue funcionando', () => {
  // La generalización no puede costarle nada al rubro histórico.
  const gaseosa = GONDOLA.find((item) => item.id === 'coca-cola-original-1500ml');
  assert.equal(productMatchesQuery(gaseosa, 'gaseosa'), true);
  assert.equal(productMatchesQuery(gaseosa, '1,5'), true);
  assert.equal(productMatchesQuery(gaseosa, '1500ml'), true);
  // «500 ml» adentro de «1500ml» es una coincidencia de dígitos, no de tamaño.
  assert.equal(productMatchesQuery(gaseosa, '500 ml'), false);
  const agua = GONDOLA.find((item) => item.id === 'agua-villavicencio-500ml');
  assert.equal(productMatchesQuery(agua, '500 ml'), true);
  assert.equal(productMatchesQuery(agua, 'agua mineral'), true);
});

test('una consulta vacía no filtra nada', () => {
  assert.equal(buscar('').length, GONDOLA.length);
  assert.equal(buscar('   ').length, GONDOLA.length);
});
