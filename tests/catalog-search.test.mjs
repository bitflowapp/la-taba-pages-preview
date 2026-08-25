/*
 * Buscar en la góndola con las palabras del cliente.
 *
 * Los dos casos que abren este archivo son defectos MEDIDOS en la tienda viva
 * el 2026-08-25, escribiendo en el buscador de producción: «energética» no
 * devolvía ningún energizante y «500 ml» devolvía botellas de 1,5 L. Los dos
 * costaban ventas y ninguno era visible desde el código.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { normalizeSearchText, productMatchesQuery, searchHaystack } from '../js/core/catalog-search.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'catalog/production-catalog-snapshot.json'), 'utf8'));

/** El catálogo productivo, con la forma que tiene el producto en la tienda. */
const catalogo = snapshot.productos.map((producto) => ({
  ...producto,
  packageType: producto.packagingType,
  unitsPerPack: producto.unitsPerPack,
  categoryName: producto.category,
  categoryId: producto.category
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-'),
}));

const buscar = (consulta) => catalogo.filter((producto) => productMatchesQuery(producto, consulta));
const nombres = (consulta) => buscar(consulta).map((producto) => producto.sku).sort();

test('normalizeSearchText unifica el litraje: «1,5 L» y «1500 ml» son lo mismo', () => {
  assert.equal(normalizeSearchText('1,5 L'), '1500ml');
  assert.equal(normalizeSearchText('1500 ml'), '1500ml');
  assert.equal(normalizeSearchText('2,25 L'), '2250ml');
  assert.equal(normalizeSearchText('Sin Azúcar'), 'sin azucar');
  assert.equal(normalizeSearchText(''), '');
  assert.equal(normalizeSearchText(null), '');
});

test('«energética» encuentra los energizantes: era 0 resultados en producción', () => {
  const esperado = [
    'monster-green-zero-473ml',
    'red-bull-original-250ml',
    'red-bull-sin-azucar-250ml',
    'speed-original-473ml',
    'speed-zero-473ml',
  ];
  assert.deepEqual(nombres('energética'), esperado);
  assert.deepEqual(nombres('energetica'), esperado, 'sin tilde tiene que dar lo mismo');
  assert.deepEqual(nombres('energizante'), esperado);
});

test('«500 ml» no devuelve botellas de 1,5 L: la capacidad coincide como palabra entera', () => {
  const encontrados = buscar('500 ml');
  assert.ok(encontrados.length > 0);
  for (const producto of encontrados) {
    assert.equal(producto.capacityValue, 500, `${producto.sku} no es de 500 ml`);
  }
  // La comprobación al revés: el familiar de 1,5 L existe y NO está.
  assert.ok(catalogo.some((producto) => producto.capacityValue === 1500));
  assert.equal(encontrados.some((producto) => producto.capacityValue === 1500), false);
});

test('el litraje se busca como lo muestra la tarjeta: «1,5» y «2,25»', () => {
  for (const producto of buscar('1,5')) assert.equal(producto.capacityValue, 1500, producto.sku);
  for (const producto of buscar('2,25')) assert.equal(producto.capacityValue, 2250, producto.sku);
  assert.ok(buscar('1,5').length >= 5);
});

test('la marca se encuentra por prefijo: «coc» alcanza para Coca-Cola', () => {
  assert.ok(buscar('coc').length >= 6);
  assert.equal(buscar('coca').every((producto) => producto.brand === 'Coca-Cola'), true);
});

test('«zero» y «sin azúcar» encuentran lo mismo, se llame como se llame la línea', () => {
  const zero = nombres('zero');
  const sinAzucar = nombres('sin azucar');
  assert.deepEqual(zero, sinAzucar);
  // Pepsi Black y Red Bull Sugarfree no dicen «zero» en ninguna parte y tienen
  // que estar igual: el cliente pide por concepto, no por el nombre de la línea.
  assert.ok(zero.includes('pepsi-black-1500ml'));
  assert.ok(zero.includes('red-bull-sin-azucar-250ml'));
});

test('el envase es buscable: «lata» y «sifón» son formas de pedir', () => {
  assert.equal(buscar('lata').every((producto) => producto.packagingType === 'lata'), true);
  assert.deepEqual(nombres('sifon'), ['soda-manaos-sifon-2000ml']);
  assert.deepEqual(nombres('sifón'), ['soda-manaos-sifon-2000ml']);
});

test('«bebida deportiva» encuentra las isotónicas', () => {
  assert.deepEqual(nombres('bebida deportiva'), [
    'gatorade-cool-blue-500ml',
    'gatorade-manzana-1250ml',
    'powerade-mountain-blast-500ml',
  ]);
});

test('«pack» encuentra los packs cerrados y ninguna unidad suelta', () => {
  const packs = buscar('pack');
  assert.ok(packs.length >= 3);
  assert.equal(packs.every((producto) => producto.unitsPerPack > 1), true);
});

test('todos los términos tienen que coincidir: una palabra de más acota, no ensancha', () => {
  assert.ok(buscar('coca zero').length > 0);
  assert.equal(buscar('coca zero').every((producto) => /zero/i.test(producto.name)), true);
  assert.deepEqual(buscar('coca sifon'), []);
});

test('una consulta vacía no filtra nada', () => {
  assert.equal(buscar('').length, catalogo.length);
  assert.equal(buscar('   ').length, catalogo.length);
  assert.equal(productMatchesQuery({ name: 'X' }, null), true);
});

test('los sinónimos NO ensanchan de más: «cola» y «tónica» no son de todos', () => {
  // Deliberadamente fuera del diccionario: harían que media góndola respondiera
  // a una búsqueda de marca. Se comprueba que sigan afuera.
  for (const producto of catalogo) {
    const indice = searchHaystack(producto);
    if (!/coca/.test(indice)) assert.doesNotMatch(indice, /\bcola\b/, `${producto.sku} responde a «cola» sin serlo`);
  }
  assert.deepEqual(nombres('tonica'), ['paso-de-los-toros-tonica-1500ml']);
});

test('los 33 productos de producción son encontrables por su marca', () => {
  for (const producto of catalogo) {
    const porMarca = buscar(producto.brand);
    assert.ok(porMarca.some((hallado) => hallado.sku === producto.sku), `${producto.sku} no aparece buscando «${producto.brand}»`);
  }
});
