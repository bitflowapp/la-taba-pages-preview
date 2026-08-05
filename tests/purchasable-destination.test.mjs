import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasPurchasableDestination,
  storyCtaDestination,
} from '../js/core/purchasable-destination.js';

// Un comprable real y dos pendientes (el estado exacto del catálogo que motivó
// P1-2: whisky y fernet existen pero no publican precio).
const PURCHASABLE = Object.freeze({
  id: 'heineken-lata',
  categoryId: 'cervezas',
  brand: 'Heineken',
  image: 'assets/heineken.webp',
  archived: false,
  pricePending: false,
  price: 3900,
  available: true,
  stock: 9,
});

const PENDING_WHISKY = Object.freeze({
  id: 'jw-red',
  categoryId: 'whisky',
  brand: 'Johnnie Walker',
  image: 'assets/jw.webp',
  archived: false,
  pricePending: true,
  price: null,
  available: false,
  stock: 0,
});

const PENDING_FERNET = Object.freeze({
  id: 'branca-750',
  categoryId: 'fernet',
  brand: 'Fernet Branca',
  image: 'assets/branca.webp',
  archived: false,
  pricePending: true,
  price: null,
  available: false,
  stock: 0,
});

const CATALOG = [PURCHASABLE, PENDING_WHISKY, PENDING_FERNET];

test('una categoría con producto comprable es destino válido', () => {
  assert.equal(hasPurchasableDestination(CATALOG, { categoryId: 'cervezas' }), true);
});

test('una categoría con productos pero sin precio publicado NO es destino válido', () => {
  assert.equal(hasPurchasableDestination(CATALOG, { categoryId: 'whisky' }), false);
  assert.equal(hasPurchasableDestination(CATALOG, { categoryId: 'fernet' }), false);
});

test('una categoría inexistente NO es destino válido', () => {
  assert.equal(hasPurchasableDestination(CATALOG, { categoryId: 'jugos' }), false);
});

test('"all" es destino válido sólo si el catálogo tiene algún comprable', () => {
  assert.equal(hasPurchasableDestination(CATALOG, { categoryId: 'all' }), true);
  assert.equal(hasPurchasableDestination([PENDING_WHISKY, PENDING_FERNET], { categoryId: 'all' }), false);
});

test('una marca con comprable es destino válido, sin importar caja ni acentos', () => {
  assert.equal(hasPurchasableDestination(CATALOG, { brandQuery: 'Heineken' }), true);
  assert.equal(hasPurchasableDestination(CATALOG, { brandQuery: 'HEINEKEN' }), true);
  assert.equal(hasPurchasableDestination(CATALOG, { brandQuery: 'heinekén' }), true);
});

test('una marca presente pero sin comprables NO es destino válido', () => {
  assert.equal(hasPurchasableDestination(CATALOG, { brandQuery: 'Johnnie Walker' }), false);
});

test('un producto puntual vale como destino según su propio estado comprable', () => {
  assert.equal(hasPurchasableDestination(CATALOG, { productId: 'heineken-lata' }), true);
  assert.equal(hasPurchasableDestination(CATALOG, { productId: 'jw-red' }), false);
  assert.equal(hasPurchasableDestination(CATALOG, { productId: 'no-existe' }), false);
});

test('sin destino declarado no hay promesa válida', () => {
  assert.equal(hasPurchasableDestination(CATALOG, {}), false);
  assert.equal(hasPurchasableDestination(CATALOG), false);
  assert.equal(hasPurchasableDestination(undefined, { categoryId: 'cervezas' }), false);
});

test('storyCtaDestination traduce las acciones normalizadas del contrato de historias', () => {
  assert.deepEqual(storyCtaDestination({ action: 'category', target: 'cervezas' }), { categoryId: 'cervezas' });
  assert.deepEqual(storyCtaDestination({ action: 'product', target: 'heineken-lata' }), { productId: 'heineken-lata' });
  assert.deepEqual(storyCtaDestination({ action: 'add', target: 'heineken-lata' }), { productId: 'heineken-lata' });
  assert.equal(storyCtaDestination({ action: 'social', target: 'x' }), null);
  assert.equal(storyCtaDestination({ action: 'category', target: '' }), null);
  assert.equal(storyCtaDestination(null), null);
});
