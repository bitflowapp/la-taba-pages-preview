/*
 * EL PANEL TIENE QUE PODER OPERAR CIENTOS DE PRODUCTOS.
 *
 * La lista del catálogo del Panel era «los primeros ocho» y un botón «Ver los
 * 38». Con 38 productos alcanza. Con la tienda 24/7 multi-rubro, la operación
 * diaria —encontrar un producto, cambiarle el precio o el stock, guardar— pasaba
 * por desplegar la lista entera y usar el Ctrl+F del navegador, que no es una
 * interfaz.
 *
 * Lo que se agregó es la mesa de trabajo mínima: buscar por texto, acotar por
 * góndola y acotar por estado. NO es un ERP: no hay columnas configurables, ni
 * exportación, ni edición masiva. Estas pruebas fijan el comportamiento del
 * filtro —que es lógica pura y se puede probar sin DOM— y el contrato de la
 * superficie, leyendo el marcado que produce el panel.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { CATALOG_PANEL_STATES, filterBusinessCatalog } from '../js/business.js';

const business = fs.readFileSync(new URL('../js/business.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../styles/business.css', import.meta.url), 'utf8');

const GONDOLA = [
  { id: '1', name: 'Ayudín', brand: 'Ayudín', sku: 'lavandina-ayudin-1000ml', categoryId: 'limpieza', categoryName: 'Limpieza', subcategory: 'lavandina', available: true, stock: 24 },
  { id: '2', name: 'Magistral', brand: 'Magistral', sku: 'detergente-magistral-750ml', categoryId: 'limpieza', categoryName: 'Limpieza', subcategory: 'detergente', available: true, stock: 3 },
  { id: '3', name: 'Sedal', brand: 'Sedal', sku: 'shampoo-sedal-340ml', categoryId: 'higiene-personal', categoryName: 'Higiene personal', subcategory: 'shampoo', available: true, stock: 0 },
  { id: '4', name: 'Coca-Cola', brand: 'Coca-Cola', sku: 'coca-cola-1500ml', categoryId: 'gaseosas', categoryName: 'Gaseosas', subcategory: 'cola', available: false, stock: 12 },
];

const ids = (resultado) => resultado.map((product) => product.id);

test('sin filtros, la mesa de trabajo no esconde nada', () => {
  assert.deepEqual(ids(filterBusinessCatalog(GONDOLA)), ['1', '2', '3', '4']);
  assert.deepEqual(ids(filterBusinessCatalog(GONDOLA, { query: '   ' })), ['1', '2', '3', '4']);
  assert.deepEqual(filterBusinessCatalog(null), []);
});

test('buscar encuentra por nombre, marca, SKU, categoría y subcategoría', () => {
  assert.deepEqual(ids(filterBusinessCatalog(GONDOLA, { query: 'ayudin' })), ['1']);
  // Sin acentos y sin importar la caja: es lo que se escribe con el pulgar.
  assert.deepEqual(ids(filterBusinessCatalog(GONDOLA, { query: 'AYUDÍN' })), ['1']);
  // El SKU es lo que el comercio tiene en la etiqueta del estante y en la
  // planilla: sin él, buscar el producto del que habla el proveedor es adivinar.
  assert.deepEqual(ids(filterBusinessCatalog(GONDOLA, { query: 'shampoo-sedal-340ml' })), ['3']);
  assert.deepEqual(ids(filterBusinessCatalog(GONDOLA, { query: 'detergente' })), ['2']);
  assert.deepEqual(ids(filterBusinessCatalog(GONDOLA, { query: 'Limpieza' })), ['1', '2']);
  assert.deepEqual(ids(filterBusinessCatalog(GONDOLA, { query: 'no existe' })), []);
});

test('los cuatro estados que un comercio necesita mirar', () => {
  // Visible para el cliente es disponible Y con stock: un producto disponible
  // con cero unidades no se puede comprar, y contarlo como visible sería mentir.
  assert.deepEqual(ids(filterBusinessCatalog(GONDOLA, { estado: 'published' })), ['1', '2']);
  assert.deepEqual(ids(filterBusinessCatalog(GONDOLA, { estado: 'paused' })), ['4']);
  assert.deepEqual(ids(filterBusinessCatalog(GONDOLA, { estado: 'low' })), ['2']);
  assert.deepEqual(ids(filterBusinessCatalog(GONDOLA, { estado: 'out' })), ['3']);
  // «Stock bajo» no incluye el agotado: son dos acciones distintas —reponer
  // pronto y reponer ya— y mezclarlas hace que la lista no sirva para ninguna.
  assert.ok(!ids(filterBusinessCatalog(GONDOLA, { estado: 'low' })).includes('3'));
});

test('los filtros se combinan y se cruzan', () => {
  assert.deepEqual(ids(filterBusinessCatalog(GONDOLA, { categoryId: 'limpieza' })), ['1', '2']);
  assert.deepEqual(
    ids(filterBusinessCatalog(GONDOLA, { categoryId: 'limpieza', estado: 'low' })),
    ['2'],
  );
  assert.deepEqual(
    ids(filterBusinessCatalog(GONDOLA, { categoryId: 'limpieza', query: 'ayudin', estado: 'published' })),
    ['1'],
  );
  // Un cruce imposible devuelve vacío en vez de aflojar alguno de los filtros.
  assert.deepEqual(
    ids(filterBusinessCatalog(GONDOLA, { categoryId: 'gaseosas', estado: 'low' })),
    [],
  );
});

test('la superficie del Panel ofrece los tres controles y el SKU de cada fila', () => {
  assert.match(business, /data-catalog-panel-search/);
  assert.match(business, /data-catalog-panel-category/);
  assert.match(business, /data-catalog-panel-state/);
  assert.match(business, /data-catalog-panel-clear/);
  // El contador dice cuántos se ven de cuántos hay: sin eso, un filtro activo
  // se lee como un catálogo que se achicó.
  assert.match(business, /\$\{visibles\} de \$\{products\.length\} productos/);
  // El SKU se dibuja en la fila.
  assert.match(business, /catalog-admin-sku/);
  assert.match(css, /\.catalog-admin-sku/);
  // Y los controles mantienen el objetivo táctil del resto del panel.
  assert.match(css, /\.catalog-admin-workbench input\[type="search"\][\s\S]{0,120}min-height: 44px/);
});

test('el buscador del catálogo no pierde el foco al escribir', () => {
  // Es la única razón por la que existe `redrawCatalogPanel`: el panel se
  // redibuja entero en cada tecla —es el patrón de este archivo— y sin devolver
  // el foco y el cursor hay que volver a tocar el campo por cada letra.
  assert.match(business, /function redrawCatalogPanel\(selector\)/);
  assert.match(business, /restored\.focus\(\);[\s\S]{0,240}setSelectionRange\(end, end\)/);
  assert.match(business, /redrawCatalogPanel\('\[data-catalog-panel-search\]'\)/);
});

test('las categorías del filtro salen de lo que el comercio tiene, no de la taxonomía', () => {
  // Ofrecer «Mascotas» a quien no vende nada de mascotas es un filtro que sólo
  // puede devolver cero.
  assert.match(business, /function renderCatalogWorkbench\(products, visibles\)/);
  assert.match(business, /for \(const product of products\)[\s\S]{0,200}categorias\.set\(product\.categoryId/);
});

test('los estados declarados son los que el filtro sabe aplicar', () => {
  const declarados = CATALOG_PANEL_STATES.map((estado) => estado.value);
  assert.deepEqual(declarados, ['all', 'published', 'paused', 'low', 'out']);
  // Cada uno tiene que estar implementado: un estado en el selector que el
  // filtro no conoce devuelve la lista entera y se lee como un filtro roto.
  for (const estado of declarados) {
    const resultado = filterBusinessCatalog(GONDOLA, { estado });
    assert.ok(Array.isArray(resultado), `el estado ${estado} no devuelve una lista`);
    if (estado !== 'all') {
      assert.ok(resultado.length < GONDOLA.length, `el estado ${estado} no filtra nada`);
    }
  }
});
