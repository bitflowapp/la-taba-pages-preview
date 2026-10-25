import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CATALOG_LAYOUT_STORAGE_KEY,
  DEFAULT_CATALOG_LAYOUT,
  nextCatalogLayout,
  normalizeCatalogLayout,
  readCatalogLayout,
  writeCatalogLayout,
} from '../js/catalog-layout.js';

// La vista de la grilla (cuadrícula o lista) se recuerda por navegador. La grilla es la
// vista de entrada: la foto vende. Cualquier valor raro, o un almacenamiento que falla,
// vuelve a ella sin romper nada.

const memoria = (inicial = {}) => {
  const datos = new Map(Object.entries(inicial));
  return { getItem: (k) => (datos.has(k) ? datos.get(k) : null), setItem: (k, v) => { datos.set(k, String(v)); }, datos };
};

test('la vista de entrada es la cuadrícula', () => {
  assert.equal(DEFAULT_CATALOG_LAYOUT, 'grid');
  assert.equal(readCatalogLayout(memoria()), 'grid');
});

test('sólo «grid» y «list» son válidos; cualquier otra cosa vuelve a la cuadrícula', () => {
  assert.equal(normalizeCatalogLayout('list'), 'list');
  assert.equal(normalizeCatalogLayout('grid'), 'grid');
  for (const raro of [undefined, null, '', 'LIST', 'tabla', 3, {}]) assert.equal(normalizeCatalogLayout(raro), 'grid');
});

test('el botón alterna entre las dos vistas', () => {
  assert.equal(nextCatalogLayout('grid'), 'list');
  assert.equal(nextCatalogLayout('list'), 'grid');
  assert.equal(nextCatalogLayout('???'), 'list');
});

test('se escribe y se vuelve a leer, y un valor guardado inválido se ignora', () => {
  const almacenamiento = memoria();
  assert.equal(writeCatalogLayout('list', almacenamiento), true);
  assert.equal(almacenamiento.datos.get(CATALOG_LAYOUT_STORAGE_KEY), 'list');
  assert.equal(readCatalogLayout(almacenamiento), 'list');
  assert.equal(readCatalogLayout(memoria({ [CATALOG_LAYOUT_STORAGE_KEY]: 'cualquiera' })), 'grid');
});

test('un almacenamiento que lanza o no existe no rompe nada', () => {
  const roto = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); } };
  assert.equal(readCatalogLayout(roto), 'grid');
  assert.equal(writeCatalogLayout('list', roto), false);
  assert.equal(readCatalogLayout(null), 'grid');
  assert.doesNotThrow(() => writeCatalogLayout('list', null));
});
