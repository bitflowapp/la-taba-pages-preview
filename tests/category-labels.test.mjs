// El chip de categoría es lo primero que lee una persona en la góndola.
//
// Medido en staging: dos de doce productos llegan con `category_name` igual al
// id, así que el chip decía «energeticas» —minúscula, sin acento— al lado de
// «Cervezas» y «Gaseosas». El dato lo arregla el negocio; la góndola, mientras
// tanto, no puede mostrar un slug crudo, porque el día que se carguen
// categorías nuevas vuelve a pasar.
import test from 'node:test';
import assert from 'node:assert/strict';

import { nombreVisibleDeCategoria } from '../js/ui.js';
import { mergeCatalogProducts, normalizeCatalogProduct } from '../js/core/catalog-store.js';
import { findCategory } from '../js/core/store-taxonomy.js';

test('un nombre que es el propio id no se muestra como slug', () => {
  const visible = nombreVisibleDeCategoria('energeticas', 'energeticas');
  assert.notEqual(visible, 'energeticas');
  assert.match(visible, /^[A-ZÁÉÍÓÚÑ]/);
});

test('un nombre bueno del backend se respeta tal cual', () => {
  assert.equal(nombreVisibleDeCategoria('cervezas', 'Cervezas'), 'Cervezas');
  assert.equal(nombreVisibleDeCategoria('gaseosas', 'Gaseosas'), 'Gaseosas');
});

test('si el id está en el diccionario que la app ya conoce, gana ese nombre', () => {
  // El nombre lo pone el diccionario, no una transformación del slug, así que
  // acá sí aparece la ortografía que el negocio declaró.
  assert.equal(nombreVisibleDeCategoria('energizantes', 'energizantes'), 'Energizantes');
  assert.equal(nombreVisibleDeCategoria('cervezas', 'cervezas'), 'Cervezas');
});

/*
 * OJO al leer esta prueba: qué devuelve `nombreVisibleDeCategoria` para un id
 * dado depende primero de QUÉ DICCIONARIO esté cargado —en Node es el catálogo
 * de test que instala `tests/test-bootstrap.mjs`, en el navegador el de la
 * vitrina de bebidas— y, si el id no está ahí, de la taxonomía de la tienda
 * (`core/store-taxonomy.js`). Por eso acá no se fija ninguna cadena para ids
 * que puedan estar o no en el diccionario: se prueba el contrato.
 *
 * Antes la taxonomía no se consultaba, y en el navegador «energeticas» —que el
 * diccionario de la vitrina no tiene: conoce «energizantes»— quedaba
 * «Energeticas», sin acento. Ahora resuelve por el vocabulario anterior que
 * declara la taxonomía y se lee «Energéticas». La capitalización sin acentos
 * queda sólo para un id que NADIE declara (más abajo).
 */

test('los guiones del id se leen como palabras, no como guiones', () => {
  const visible = nombreVisibleDeCategoria('aguas-saborizadas', 'aguas-saborizadas');
  assert.ok(!visible.includes('-'), `no debería quedar un guion: ${visible}`);
  assert.match(visible, /^Aguas saborizadas$/);
});

test('con un id que nadie conoce, se capitaliza y nada más: no se inventa ortografía', () => {
  // Una categoría que el negocio invente mañana y que no esté en ningún
  // diccionario. Se la deja legible, pero no se le agregan acentos ni se le
  // cambian palabras: cómo se llama lo decide el negocio, no el storefront.
  assert.equal(nombreVisibleDeCategoria('sidras-artesanales', 'sidras-artesanales'), 'Sidras artesanales');
  assert.equal(nombreVisibleDeCategoria('bebida-rara', 'bebida-rara'), 'Bebida rara');
});

test('un nombre vacío tampoco deja el chip mudo', () => {
  assert.equal(nombreVisibleDeCategoria('cervezas', ''), 'Cervezas');
  assert.equal(nombreVisibleDeCategoria('cervezas', null), 'Cervezas');
});

/*
 * LAS CATEGORÍAS QUE NO SON BEBIDA.
 *
 * Medido en la vista previa: el chip decía «Almacen» y el carrusel de al lado,
 * «Almacén». Fallaban dos capas a la vez. `normalizeCatalogProduct` reescribía
 * `categoryName` en CADA commit con el diccionario de la vitrina —que es de
 * bebidas—, así que «Almacén» llegaba del backend y salía como `almacen`; y
 * este helper, al ver el slug, tampoco lo encontraba en ese diccionario y lo
 * capitalizaba. Lo mismo con golosinas, limpieza, higiene personal, hogar,
 * mascotas, otros y el título del catálogo. Ninguno de estos ids está en el
 * diccionario de la vitrina ni en el de test, así que acá sí se fija la cadena:
 * es la de la taxonomía.
 */
const NO_BEBIDA = [
  ['almacen', 'Almacén'],
  ['golosinas', 'Golosinas'],
  ['higiene-personal', 'Higiene personal'],
  ['limpieza', 'Limpieza'],
];

test('una categoría que no es bebida se lee con la ortografía de la taxonomía', () => {
  for (const [id, nombre] of NO_BEBIDA) {
    assert.equal(findCategory(id)?.displayName, nombre, `la taxonomía cambió el nombre de «${id}»`);
    assert.equal(nombreVisibleDeCategoria(id, id), nombre);
    assert.equal(nombreVisibleDeCategoria(id, ''), nombre);
  }
});

test('el vocabulario anterior también recupera su acento', () => {
  assert.equal(nombreVisibleDeCategoria('energeticas', 'energeticas'), 'Energéticas');
});

const fila = (categoryId, categoryName) => ({
  id: `p-prueba-${categoryId}`,
  name: 'Producto de prueba',
  price: 5200,
  stock: 8,
  categoryId,
  categoryName,
});

test('el catálogo conserva «Almacén» en cada commit: el nombre ya no vuelve a ser el slug', () => {
  // Así lo entrega el repositorio de producción: el nombre que guarda la base y
  // su slug como id.
  const producto = normalizeCatalogProduct(fila('almacen', 'Almacén'));
  assert.equal(producto.categoryId, 'almacen', 'el id sigue siendo ASCII');
  assert.equal(producto.categoryName, 'Almacén');
  // Idempotente: el commit siguiente vuelve a pasar por la misma normalización.
  assert.equal(normalizeCatalogProduct(producto).categoryName, 'Almacén');
  assert.equal(mergeCatalogProducts([], [producto])[0].categoryName, 'Almacén');
  // Y lo que dibuja el chip a partir de ese producto.
  assert.equal(nombreVisibleDeCategoria(producto.categoryId, producto.categoryName), 'Almacén');
});

test('si la fila trae el slug como nombre, la ortografía la pone la taxonomía', () => {
  for (const [id, nombre] of NO_BEBIDA) {
    assert.equal(normalizeCatalogProduct(fila(id, id)).categoryName, nombre);
  }
});

test('un producto recategorizado no arrastra el nombre de su categoría anterior', () => {
  const antes = normalizeCatalogProduct(fila('almacen', 'Almacén'));
  const despues = normalizeCatalogProduct({ ...antes, categoryId: 'limpieza' });
  assert.equal(despues.categoryId, 'limpieza');
  assert.equal(despues.categoryName, 'Limpieza');
});

test('una categoría que la taxonomía no declara conserva el nombre que le puso el comercio', () => {
  assert.equal(normalizeCatalogProduct(fila('lacteos', 'Lácteos')).categoryName, 'Lácteos');
  assert.equal(normalizeCatalogProduct(fila('fiambres', 'Fiambres')).categoryName, 'Fiambres');
  // Sin nombre usable, el id; el chip lo vuelve legible sin inventar acentos.
  const sinNombre = normalizeCatalogProduct(fila('sidras-artesanales', ''));
  assert.equal(sinNombre.categoryName, 'sidras-artesanales');
  assert.equal(nombreVisibleDeCategoria(sinNombre.categoryId, sinNombre.categoryName), 'Sidras artesanales');
});

test('el diccionario cargado sigue mandando sobre el nombre de la fila', () => {
  // `cervezas` está en el diccionario de test (y en el de la vitrina): gana su
  // nombre, igual que antes de este cambio.
  assert.equal(normalizeCatalogProduct(fila('cervezas', 'CERVEZAS')).categoryName, 'Cervezas');
});
