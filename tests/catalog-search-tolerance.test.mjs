/*
 * Buscar con las palabras —y los errores— de quien escribe con el pulgar.
 *
 * Todo lo que hay acá se midió contra las 46 fichas reales el 2026-09-30,
 * escribiendo en el buscador de la tienda en modo producción. Tres familias de
 * consulta devolvían una góndola vacía sobre productos que el local SÍ vende:
 *
 *   · la marca escrita de corrido («cocacola», «redbull», «lays»);
 *   · el tamaño dicho en palabras («1 litro», «710 cc», «2.25»);
 *   · un error de tipeo («heiniken», «kilmes», «schweps», «pesi»).
 *
 * Y una regla que no se negocia: tolerar errores no es inventar surtido. Lo que
 * el local no vende sigue devolviendo cero.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  normalizeSearchQuery,
  productMatchesQuery,
  productMatchesQueryLoosely,
  searchProducts,
} from '../js/core/catalog-search.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/catalog-cp-46.json'), 'utf8'));
const slug = (value) => String(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Las 46 fichas con la forma que tienen en la tienda. */
const catalogo = snapshot.products.map((row) => ({
  id: row.id,
  sku: row.sku,
  externalId: row.external_id,
  name: row.name,
  brand: row.brand,
  variant: row.variant,
  presentation: row.presentation,
  capacityValue: row.capacity_value,
  capacityUnit: row.capacity_unit,
  capacity: row.capacity,
  packagingType: row.packaging_type,
  unitsPerPack: row.units_per_pack,
  subcategory: row.subcategory,
  categoryName: row.category,
  categoryId: slug(row.category),
  tags: row.tags,
}));

const buscar = (consulta) => searchProducts(catalogo, consulta);
const nombres = (consulta) => buscar(consulta).products.map((producto) => producto.name);

test('la marca escrita de corrido encuentra lo mismo que con su guion o su espacio', () => {
  assert.deepEqual(nombres('cocacola'), nombres('coca cola'));
  assert.equal(nombres('cocacola').length, 2);
  assert.deepEqual(nombres('redbull'), ['Red Bull Energy Drink 355 ml']);
  assert.equal(nombres('lays').length, 2, '«lays» sin apóstrofo no encontraba Lay’s');
  assert.deepEqual(nombres('bon aqua'), ['Bonaqua Sin Gas 2,25 L']);
  for (const consulta of ['cocacola', 'redbull', 'lays', 'bon aqua']) {
    assert.equal(buscar(consulta).approximate, false, `«${consulta}» es una coincidencia exacta, no un parecido`);
  }
});

test('el tamaño se entiende como se dice: litros, centímetros cúbicos y punto decimal', () => {
  assert.equal(normalizeSearchQuery('1 litro'), '1000ml');
  assert.equal(normalizeSearchQuery('2 Litros'), '2000ml');
  assert.equal(normalizeSearchQuery('litro y medio'), '1500ml');
  assert.equal(normalizeSearchQuery('medio litro'), '500ml');
  assert.equal(normalizeSearchQuery('710 cc'), '710ml');
  assert.equal(normalizeSearchQuery('2.25'), '2,25');
  assert.deepEqual(nombres('1 litro'), nombres('1 L'));
  assert.equal(nombres('710cc').length, 3);
  assert.deepEqual(nombres('2.25'), nombres('2,25'));
  assert.deepEqual(nombres('sprite 2.25'), ['Sprite Sin Azúcar 2,25 L']);
  assert.deepEqual(nombres('medio litro'), ['Villavicencio Sin Gas 500 ml']);
  // El defecto original sigue cerrado: «500 ml» no es «1500 ml».
  assert.ok(nombres('500 ml').every((nombre) => !/1,5 L/.test(nombre)));
});

test('«vino tinto» y «agua tónica» encuentran lo que nombran', () => {
  assert.equal(nombres('tinto').length, 4, 'Malbec, Cabernet y Red Blend son tintos');
  assert.deepEqual(nombres('blanco'), ['Santa Julia Chenin Dulce Natural 750 ml']);
  assert.equal(nombres('vino tinto').length, 4);
  assert.equal(nombres('agua tonica').length, 2);
  // Y «agua» sola sigue siendo agua: las tónicas no se cuelan.
  assert.equal(nombres('agua').length, 5);
  assert.ok(nombres('agua').every((nombre) => !/Tónica/.test(nombre)));
});

test('un error de tipeo encuentra el producto, y lo declara como parecido', () => {
  const casos = {
    heiniken: 'Heineken', heinken: 'Heineken', heinekn: 'Heineken',
    coka: 'Coca-Cola', esprite: 'Sprite', schweps: 'Schweppes', shweppes: 'Schweppes',
    kilmes: 'Quilmes', stela: 'Stella', campary: 'Campari', pesi: 'Pepsi', spid: 'Speed',
    braham: 'Brahma', trapice: 'Trapiche', villavisencio: 'Villavicencio', shneider: 'Schneider',
    cavernet: 'Cabernet', malvec: 'Malbec', moster: 'Monster',
  };
  for (const [consulta, esperado] of Object.entries(casos)) {
    const resultado = buscar(consulta);
    assert.ok(resultado.products.length > 0, `«${consulta}» no encontró nada`);
    assert.equal(resultado.approximate, true, `«${consulta}» se presentó como coincidencia exacta`);
    assert.ok(
      resultado.products.every((producto) => producto.name.includes(esperado)),
      `«${consulta}» trajo ${resultado.products.map((producto) => producto.name).join(' | ')}`,
    );
  }
  // Una categoría mal escrita también: «cervesa» son las ocho cervezas.
  assert.equal(buscar('cervesa').products.length, 8);
  assert.equal(buscar('energisante').products.length, 4);
});

test('todavía escribiendo: el parecido aparece antes de terminar la palabra', () => {
  assert.deepEqual(nombres('heini'), ['Heineken Lager 710 ml']);
  assert.deepEqual(nombres('kilm'), ['Quilmes Clásica 710 ml']);
});

test('lo que el local no vende sigue devolviendo CERO: tolerar no es inventar surtido', () => {
  const huecos = ['vodka', 'whisky', 'wisky', 'gin', 'ron', 'sidra', 'champan', 'leche', 'pan', 'arroz', 'yerba',
    'harina', 'aceite', 'galletitas', 'fiambre', 'salame', 'carbon', 'cigarrillos', 'papel', 'soda', 'chica'];
  for (const consulta of huecos) {
    assert.deepEqual(nombres(consulta), [], `«${consulta}» no está en la góndola y devolvió algo`);
    assert.equal(buscar(consulta).approximate, false);
  }
  // Un formato que no existe tampoco: no hay Coca-Cola en lata ni de dos litros.
  assert.deepEqual(nombres('lata de coca'), []);
  assert.deepEqual(nombres('coca 2 litros'), []);
});

test('lo parecido es un RESPALDO: si hay coincidencia exacta, no se mezcla nada', () => {
  const exacta = buscar('fanta');
  assert.equal(exacta.approximate, false);
  assert.deepEqual(exacta.products.map((producto) => producto.name), ['Fanta Naranja 2,25 L']);
  // «fanta» se parece a «santa» (Julia), pero la exacta manda y Santa Julia no aparece.
  assert.ok(catalogo.some((producto) => productMatchesQueryLoosely(producto, 'manta')));
  assert.ok(!exacta.products.some((producto) => /Santa Julia/.test(producto.name)));
});

test('los números y los tamaños no se aproximan', () => {
  assert.deepEqual(nombres('471'), [], '«471» no es «473»');
  assert.deepEqual(nombres('heiniken 500 ml'), [], 'no hay Heineken de 500 ml: el tamaño tiene que coincidir');
  assert.deepEqual(nombres('heiniken 710'), ['Heineken Lager 710 ml']);
});

test('las reglas de siempre siguen valiendo', () => {
  assert.equal(nombres('energetica').length, 4);
  assert.equal(nombres('coca zero').length, 1);
  assert.equal(nombres('').length, 46, 'sin consulta se ve todo');
  assert.equal(buscar('').approximate, false);
  assert.equal(buscar('   ').approximate, false);
  const heineken = catalogo.find((producto) => producto.sku === 'heineken-710ml');
  assert.equal(productMatchesQuery(heineken, 'heineken-710ml'), true, 'el código exacto sigue abriendo');
  assert.equal(productMatchesQueryLoosely(heineken, ''), false);
  assert.deepEqual(searchProducts(null, 'coca'), { products: [], approximate: false });
});
