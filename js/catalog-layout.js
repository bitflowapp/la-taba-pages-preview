/*
 * VISTA DEL CATÁLOGO: CUADRÍCULA O LISTA.
 *
 * Por qué existe
 * --------------
 * Medido en un Moto G15 físico (viewport útil de 432 × 687 px), la grilla de dos
 * columnas deja ver DOS productos por pantalla: la cabecera del catálogo ocupa
 * 256 px y cada tarjeta mide 334 px. Para quien mira fotos eso es lo correcto;
 * para quien ya sabe qué busca y quiere comparar precios entre veinte
 * presentaciones, es tener que desplazarse diez pantallas. La lista (foto chica,
 * nombre, presentación, precio y «Agregar» en un renglón) muestra cinco o seis
 * productos a la vez.
 *
 * La grilla sigue siendo la vista de entrada: la foto vende. Esto sólo ofrece
 * la otra, y recuerda la elección de ESTE navegador.
 *
 * Qué NO hace
 * -----------
 * No toca el markup de las tarjetas ni el filtrado: cambia UN atributo
 * (`data-catalog-layout`) en la grilla y el CSS hace el resto. Por eso todo lo
 * que ya fijan las pruebas de la tarjeta (`article[data-card-product]`, el
 * precio, el botón, el stepper) existe igual en las dos vistas.
 */
import { getStorageArea, safeStorageGet, safeStorageSet } from './core/storage.js';

export const CATALOG_LAYOUT_STORAGE_KEY = 'la_taba_catalog_layout_v1';
export const CATALOG_LAYOUTS = Object.freeze(['grid', 'list']);
export const DEFAULT_CATALOG_LAYOUT = 'grid';

export function normalizeCatalogLayout(value) {
  return CATALOG_LAYOUTS.includes(value) ? value : DEFAULT_CATALOG_LAYOUT;
}

export function nextCatalogLayout(layout) {
  return normalizeCatalogLayout(layout) === 'grid' ? 'list' : 'grid';
}

export function readCatalogLayout(storage = getStorageArea('localStorage')) {
  return normalizeCatalogLayout(safeStorageGet(storage, CATALOG_LAYOUT_STORAGE_KEY));
}

export function writeCatalogLayout(layout, storage = getStorageArea('localStorage')) {
  return safeStorageSet(storage, CATALOG_LAYOUT_STORAGE_KEY, normalizeCatalogLayout(layout));
}

/*
 * El botón dice a dónde LLEVA, no dónde está: en la grilla ofrece «lista» y en la
 * lista ofrece «cuadrícula». Es un botón de acción con nombre cambiante, no un
 * interruptor, así que no usa `aria-pressed`.
 */
const TOGGLE_COPY = Object.freeze({
  grid: 'Ver los productos en lista',
  list: 'Ver los productos en cuadrícula',
});

export function applyCatalogLayout(layout, root = document) {
  const value = normalizeCatalogLayout(layout);
  for (const grid of root.querySelectorAll('[data-product-grid]')) grid.dataset.catalogLayout = value;
  for (const toggle of root.querySelectorAll('[data-catalog-layout-toggle]')) {
    toggle.dataset.catalogLayoutCurrent = value;
    toggle.setAttribute('aria-label', TOGGLE_COPY[value]);
    toggle.setAttribute('title', TOGGLE_COPY[value]);
  }
  return value;
}

export function initCatalogLayout(root = document) {
  let current = applyCatalogLayout(readCatalogLayout(), root);
  root.addEventListener('click', (event) => {
    const toggle = event.target instanceof Element ? event.target.closest('[data-catalog-layout-toggle]') : null;
    if (!toggle) return;
    current = applyCatalogLayout(nextCatalogLayout(current), root);
    writeCatalogLayout(current);
  });
  return { current: () => current };
}
