import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeStoryRecord } from '../js/core/stories.js';
import {
  resolveStoryDestination,
  storyAgeRestriction,
  storyDestinationOptions,
  storyPublishability,
} from '../js/core/story-destination.js';

// Catálogo mínimo pero realista: un comprable alcohólico, uno sin alcohol, uno
// con precio pendiente y uno sin stock. Es el estado que motivó el P1-2.
const HEINEKEN = Object.freeze({
  id: 'heineken-lata', name: 'Heineken Original', categoryId: 'cervezas',
  price: 3900, stock: 20, available: true, pricePending: false, alcoholic: true,
  image: 'assets/products/heineken.webp',
});
const MONSTER = Object.freeze({
  id: 'monster-lata', name: 'Monster Mango Loco', categoryId: 'energizantes',
  price: 3390, stock: 12, available: true, pricePending: false, alcoholic: false,
  image: 'assets/products/monster.webp',
});
const WHISKY_SIN_PRECIO = Object.freeze({
  id: 'jw-red', name: 'Johnnie Walker Red', categoryId: 'destilados',
  price: 0, stock: 5, available: true, pricePending: true, alcoholic: true,
  image: 'assets/products/jw.webp',
});
const CORONA_SIN_STOCK = Object.freeze({
  id: 'corona-lata', name: 'Corona Extra', categoryId: 'cervezas',
  price: 4100, stock: 0, available: true, pricePending: false, alcoholic: true,
  image: 'assets/products/corona.webp',
});

const COMBO_DISPONIBLE = Object.freeze({
  comboId: 'combo-heineken-x6', name: 'Heineken x6', available: true, ageRestricted: true, minimumAge: 18,
});
const COMBO_BLOQUEADO = Object.freeze({
  comboId: 'combo-noche-larga', name: 'Noche larga', available: false, ageRestricted: true, minimumAge: 18,
});

const CATEGORIES = Object.freeze([
  { id: 'cervezas', name: 'Cervezas' },
  { id: 'energizantes', name: 'Energizantes' },
  { id: 'destilados', name: 'Destilados' },
]);

const CATALOG = Object.freeze({
  products: [HEINEKEN, MONSTER, WHISKY_SIN_PRECIO, CORONA_SIN_STOCK],
  combos: [COMBO_DISPONIBLE, COMBO_BLOQUEADO],
  categories: CATEGORIES,
});

function story(extra = {}) {
  return normalizeStoryRecord({
    id: 'story-1',
    title: 'Historia',
    media_type: 'image',
    media_url: 'assets/promos/x.webp',
    enabled: true,
    ...extra,
  });
}

test('VER PRODUCTO resuelve contra el producto real y hereda su +18', () => {
  const destination = resolveStoryDestination(
    story({ cta_type: 'product', cta_target: 'heineken-lata' }).cta,
    CATALOG,
  );
  assert.equal(destination.kind, 'product');
  assert.equal(destination.label, 'Heineken Original');
  assert.equal(destination.exists, true);
  assert.equal(destination.purchasable, true);
  assert.equal(destination.ageRestricted, true);
  assert.equal(destination.minimumAge, 18);
});

test('COMPRAR apunta al mismo producto que VER PRODUCTO', () => {
  const ver = resolveStoryDestination(story({ cta_type: 'product', cta_target: 'monster-lata' }).cta, CATALOG);
  const comprar = resolveStoryDestination(story({ cta_type: 'buy', cta_target: 'monster-lata' }).cta, CATALOG);
  assert.equal(ver.id, comprar.id);
  assert.equal(comprar.purchasable, true);
  assert.equal(comprar.ageRestricted, false);
});

test('VER COMBO exige un combo con precio y stock', () => {
  const disponible = resolveStoryDestination(story({ cta_type: 'combo', cta_target: 'combo-heineken-x6' }).cta, CATALOG);
  assert.equal(disponible.exists, true);
  assert.equal(disponible.purchasable, true);
  assert.equal(disponible.ageRestricted, true);

  const bloqueado = resolveStoryDestination(story({ cta_type: 'combo', cta_target: 'combo-noche-larga' }).cta, CATALOG);
  assert.equal(bloqueado.exists, true, 'existe, y por eso se puede explicar');
  assert.equal(bloqueado.purchasable, false);
});

test('VER CATEGORÍA sólo es +18 si TODO lo comprable del rubro es alcohólico', () => {
  const cervezas = resolveStoryDestination(story({ cta_type: 'category', cta_target: 'cervezas' }).cta, CATALOG);
  assert.equal(cervezas.purchasable, true, 'Heineken sostiene el rubro');
  assert.equal(cervezas.ageRestricted, true, 'lo único comprable del rubro es alcohol');

  const energizantes = resolveStoryDestination(story({ cta_type: 'category', cta_target: 'energizantes' }).cta, CATALOG);
  assert.equal(energizantes.ageRestricted, false);

  const destilados = resolveStoryDestination(story({ cta_type: 'category', cta_target: 'destilados' }).cta, CATALOG);
  assert.equal(destilados.exists, true, 'el rubro existe');
  assert.equal(destilados.purchasable, false, 'pero no hay nada con precio confirmado');
  assert.equal(destilados.ageRestricted, false, 'sin nada comprable, no se afirma restricción');
});

test('"todo el catálogo" es un destino válido mientras haya algo comprable', () => {
  const todo = resolveStoryDestination(story({ cta_type: 'category', cta_target: 'all' }).cta, CATALOG);
  assert.equal(todo.exists, true);
  assert.equal(todo.purchasable, true);

  const vacio = resolveStoryDestination(
    story({ cta_type: 'category', cta_target: 'all' }).cta,
    { products: [WHISKY_SIN_PRECIO], combos: [], categories: CATEGORIES },
  );
  assert.equal(vacio.purchasable, false);
});

test('el +18 declarado es un piso: no puede apagar el del catálogo', () => {
  const alcoholica = story({ cta_type: 'product', cta_target: 'heineken-lata', age_restricted: false });
  const destination = resolveStoryDestination(alcoholica.cta, CATALOG);
  const age = storyAgeRestriction(alcoholica, destination);
  assert.equal(age.restricted, true, 'el catálogo gana sobre la declaración');
  assert.equal(age.derived, true);
  assert.equal(age.declared, false);
  assert.equal(age.minimumAge, 18);
});

test('el +18 declarado SÍ puede agregarse donde el catálogo no lo impone', () => {
  const editorial = story({ cta_type: 'product', cta_target: 'monster-lata', age_restricted: true });
  const age = storyAgeRestriction(editorial, resolveStoryDestination(editorial.cta, CATALOG));
  assert.equal(age.restricted, true);
  assert.equal(age.derived, false);
  assert.equal(age.declared, true);
});

test('una edad mínima mayor que 18 en el catálogo se respeta; una menor no', () => {
  const catalogo = { ...CATALOG, products: [{ ...HEINEKEN, minimumAge: 21 }] };
  const alta = storyAgeRestriction(
    story({ cta_type: 'product', cta_target: 'heineken-lata' }),
    resolveStoryDestination(story({ cta_type: 'product', cta_target: 'heineken-lata' }).cta, catalogo),
  );
  assert.equal(alta.minimumAge, 21);

  const baja = { ...CATALOG, products: [{ ...HEINEKEN, minimumAge: 12 }] };
  const piso = storyAgeRestriction(
    story({ cta_type: 'product', cta_target: 'heineken-lata' }),
    resolveStoryDestination(story({ cta_type: 'product', cta_target: 'heineken-lata' }).cta, baja),
  );
  assert.equal(piso.minimumAge, 18, 'nunca por debajo de 18');
});

test('una historia con CTA a un destino no comprable no se publica', () => {
  assert.equal(storyPublishability(story({ cta_type: 'product', cta_target: 'jw-red' }), CATALOG).ok, false);
  assert.equal(storyPublishability(story({ cta_type: 'buy', cta_target: 'corona-lata' }), CATALOG).ok, false);
  assert.equal(storyPublishability(story({ cta_type: 'combo', cta_target: 'combo-noche-larga' }), CATALOG).ok, false);
  assert.equal(storyPublishability(story({ cta_type: 'category', cta_target: 'destilados' }), CATALOG).ok, false);
  assert.equal(storyPublishability(story({ cta_type: 'product', cta_target: 'no-existe' }), CATALOG).ok, false);
});

test('una historia sin CTA es editorial válida: no promete acción', () => {
  const novedad = story({ cta_type: '', cta_target: '' });
  assert.equal(novedad.cta, null);
  assert.equal(storyPublishability(novedad, CATALOG).ok, true);
});

test('una historia con CTA comprable se publica', () => {
  assert.equal(storyPublishability(story({ cta_type: 'product', cta_target: 'heineken-lata' }), CATALOG).ok, true);
  assert.equal(storyPublishability(story({ cta_type: 'combo', cta_target: 'combo-heineken-x6' }), CATALOG).ok, true);
  assert.equal(storyPublishability(story({ cta_type: 'category', cta_target: 'cervezas' }), CATALOG).ok, true);
});

test('el formulario sólo ofrece destinos reales y comprables', () => {
  const options = storyDestinationOptions(CATALOG);
  assert.deepEqual(options.product.map((option) => option.id), ['heineken-lata', 'monster-lata']);
  assert.deepEqual(options.combo.map((option) => option.id), ['combo-heineken-x6']);
  assert.deepEqual(options.category.map((option) => option.id), ['all', 'cervezas', 'energizantes']);
  assert.equal(options.product.find((option) => option.id === 'heineken-lata').ageRestricted, true);
  assert.equal(options.category.find((option) => option.id === 'cervezas').ageRestricted, true);
  assert.equal(options.category.find((option) => option.id === 'energizantes').ageRestricted, false);
});

test('sin catálogo el formulario no ofrece nada: no se puede inventar un destino', () => {
  const options = storyDestinationOptions({});
  assert.deepEqual(options.product, []);
  assert.deepEqual(options.combo, []);
  assert.deepEqual(options.category, []);
});
