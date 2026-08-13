// La inferencia de alcohol tiene que conocer las categorías que el catálogo usa
// de verdad (F42).
//
// POR QUÉ EXISTE ESTE ARCHIVO
// ---------------------------
// `ALCOHOLIC_CATEGORY_IDS` es la ÚNICA fuente de verdad cuando la fila del
// catálogo no trae bandera `alcoholic`, y estaba desfasada del vocabulario real:
//
//   decía:  cervezas · vinos-y-espumantes · gins-y-vodkas · whisky-y-destilados
//   usa:    cervezas · fernet · aperitivos · vinos · espumantes · destilados
//
// Tres de los cuatro ids NO EXISTEN en la autoridad. De las categorías con
// alcohol que el comercio usa, la lista sólo acertaba `cervezas`, así que un
// fernet, un vino o un aperitivo sin bandera explícita se inferían SIN alcohol
// y perdían el +18 y la edad mínima.
//
// El test que importa es el último: cruza la lista contra la autoridad para que
// una categoría nueva no pueda colarse como «sin alcohol» por olvido.
import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeCatalogProduct } from '../js/core/catalog-store.js';
import { authorityCategories } from '../js/taba2-commercial-pending-data.js';

/** Un producto sin bandera `alcoholic`: la inferencia es lo único que decide. */
function productoDeCategoria(categoryId) {
  return normalizeCatalogProduct({
    id: `sku-${categoryId}`,
    name: `Producto de ${categoryId}`,
    categoryId,
    price: 1000,
    stock: 5,
    available: true,
  });
}

const CON_ALCOHOL = ['cervezas', 'fernet', 'aperitivos', 'vinos', 'espumantes', 'destilados'];
const SIN_ALCOHOL = ['gaseosas', 'aguas', 'aguas-saborizadas', 'isotonicas', 'energizantes', 'mixers', 'hielo'];

test('las categorías con alcohol se infieren con alcohol y con edad mínima', () => {
  for (const categoria of CON_ALCOHOL) {
    const producto = productoDeCategoria(categoria);
    assert.equal(producto.alcoholic, true, `${categoria} tiene alcohol`);
    assert.equal(producto.minimumAge, 18, `${categoria} tiene que exigir edad`);
  }
});

test('las que no llevan alcohol siguen sin llevarlo', () => {
  // El arreglo no puede ser «marcar todo como alcohol»: eso pondría un +18 en
  // el agua y haría que la compuerta deje de significar algo.
  for (const categoria of SIN_ALCOHOL) {
    const producto = productoDeCategoria(categoria);
    assert.equal(producto.alcoholic, false, `${categoria} no tiene alcohol`);
    assert.equal(producto.minimumAge, null);
  }
});

test('una bandera explícita sigue mandando sobre la inferencia', () => {
  const sinAlcohol = normalizeCatalogProduct({
    id: 'sku-cerveza-0',
    name: 'Cerveza sin alcohol',
    categoryId: 'cervezas',
    price: 1000,
    stock: 5,
    available: true,
    nonAlcoholic: true,
  });
  assert.equal(sinAlcohol.alcoholic, false, 'la cerveza 0,0 existe y el dato explícito manda');
});

test('toda categoría de la autoridad está clasificada a propósito', () => {
  // La regla, y no una revisión: si mañana la autoridad suma una categoría y
  // nadie la clasifica, este test falla en vez de dejarla pasar como sin
  // alcohol. Es exactamente la forma en que se desfasó la lista original.
  const conocidas = new Set([...CON_ALCOHOL, ...SIN_ALCOHOL, 'all']);
  const sinClasificar = authorityCategories
    .map((categoria) => categoria.id)
    .filter((id) => !conocidas.has(id));
  assert.deepEqual(
    sinClasificar,
    [],
    `categorías nuevas sin clasificar como con/sin alcohol: ${sinClasificar.join(', ')}`,
  );
});
