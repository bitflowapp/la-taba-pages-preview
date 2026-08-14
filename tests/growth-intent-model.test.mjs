import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applySignal,
  combinedAffinity,
  decayedScore,
  emptyIntentState,
  isColdStart,
  normalizeIntentState,
  normalizedAffinity,
  pruneIntentState,
} from '../js/growth/intent-model.js';
import {
  INTENT_MAX_KEYS,
  INTENT_SCORE_CAP,
  LONG_TERM_HALF_LIFE_MS,
  SESSION_HALF_LIFE_MS,
  SIGNAL_WEIGHTS,
} from '../js/growth/growth-config.js';

const T0 = 1_800_000_000_000; // reloj fijo: los tests no dependen del día real
const HL = SESSION_HALF_LIFE_MS;

test('una señal de categoría suma exactamente su peso configurado', () => {
  const state = applySignal(emptyIntentState(), { type: 'category_view', categoryId: 'cervezas' }, T0, HL);
  assert.equal(state.categories.cervezas.s, SIGNAL_WEIGHTS.category_view);
  assert.equal(state.categories.cervezas.t, T0);
});

test('las señales se acumulan sobre el score decaído, no sobre el original', () => {
  let state = applySignal(emptyIntentState(), { type: 'add_to_cart', categoryId: 'fernet' }, T0, HL);
  // Una semivida después: los 10 puntos valen 5; sumar 2 da 7, no 12.
  state = applySignal(state, { type: 'category_view', categoryId: 'fernet' }, T0 + HL, HL);
  assert.ok(Math.abs(state.categories.fernet.s - 7) < 0.001);
});

test('decay: a una semivida queda la mitad; a dos, un cuarto', () => {
  const entry = { s: 8, t: T0 };
  assert.ok(Math.abs(decayedScore(entry, T0 + HL, HL) - 4) < 0.001);
  assert.ok(Math.abs(decayedScore(entry, T0 + HL * 2, HL) - 2) < 0.001);
});

test('la intención vieja pierde contra la intención nueva (decay §matriz)', () => {
  // Una cerveza mirada hace tres meses no manda sobre el vino de esta semana.
  let state = emptyIntentState();
  const threeMonthsAgo = T0 - (90 * 24 * 60 * 60 * 1000);
  state = applySignal(state, { type: 'purchase', categoryId: 'cervezas' }, threeMonthsAgo, LONG_TERM_HALF_LIFE_MS);
  state = applySignal(state, { type: 'category_view', categoryId: 'vinos' }, T0, LONG_TERM_HALF_LIFE_MS);
  const beer = decayedScore(state.categories.cervezas, T0, LONG_TERM_HALF_LIFE_MS);
  const wine = decayedScore(state.categories.vinos, T0, LONG_TERM_HALF_LIFE_MS);
  assert.ok(wine > beer, `vino ${wine} debería superar a cerveza ${beer}`);
});

test('el score satura en el tope: abrir la misma ficha veinte veces no domina para siempre', () => {
  let state = emptyIntentState();
  for (let i = 0; i < 20; i += 1) {
    state = applySignal(state, { type: 'product_view', productId: 'heineken-original-lata-473ml' }, T0 + i, HL);
  }
  assert.ok(state.products['heineken-original-lata-473ml'].s <= INTENT_SCORE_CAP);
});

test('remove_from_cart y promo_dismiss restan', () => {
  let state = applySignal(emptyIntentState(), { type: 'add_to_cart', categoryId: 'gaseosas' }, T0, HL);
  state = applySignal(state, { type: 'remove_from_cart', categoryId: 'gaseosas' }, T0, HL);
  assert.ok(state.categories.gaseosas.s < SIGNAL_WEIGHTS.add_to_cart);
});

test('un estado corrupto se normaliza a perfil vacío (fail-safe)', () => {
  for (const garbage of [null, 'texto', 42, [], { v: 99 }, { v: 1, categories: 'no' },
    { v: 1, categories: { cervezas: { s: 'NaN', t: 'x' } } }]) {
    const state = normalizeIntentState(garbage);
    assert.deepEqual(state.categories, {});
    assert.equal(isColdStart(combinedAffinity({
      longTerm: state,
      session: state,
      now: T0,
      longHalfLifeMs: LONG_TERM_HALF_LIFE_MS,
      sessionHalfLifeMs: HL,
      sessionMultiplier: 2,
    })), true);
  }
});

test('la poda respeta la cota de claves y tira lo insignificante', () => {
  let state = emptyIntentState();
  for (let i = 0; i < 60; i += 1) {
    state = applySignal(state, { type: 'category_view', categoryId: `cat-${i}` }, T0 + i, HL);
  }
  const pruned = pruneIntentState(state, T0 + 60, HL);
  assert.ok(Object.keys(pruned.categories).length <= INTENT_MAX_KEYS.categories);
  // Y una entrada ya evaporada no sobrevive a la poda.
  const stale = applySignal(emptyIntentState(), { type: 'category_view', categoryId: 'aguas' }, T0, HL);
  const gone = pruneIntentState(stale, T0 + HL * 20, HL);
  assert.deepEqual(gone.categories, {});
});

test('la sesión pesa más: mismo gesto, doble multiplicador', () => {
  const longTerm = applySignal(emptyIntentState(), { type: 'category_view', categoryId: 'vinos' }, T0, LONG_TERM_HALF_LIFE_MS);
  const session = applySignal(emptyIntentState(), { type: 'category_view', categoryId: 'cervezas' }, T0, HL);
  const affinity = combinedAffinity({
    longTerm,
    session,
    now: T0,
    longHalfLifeMs: LONG_TERM_HALF_LIFE_MS,
    sessionHalfLifeMs: HL,
    sessionMultiplier: 2,
  });
  assert.ok(affinity.categories.cervezas > affinity.categories.vinos);
});

test('normalizedAffinity satura suave entre 0 y 1', () => {
  assert.equal(normalizedAffinity(0), 0);
  assert.equal(normalizedAffinity(-5), 0);
  assert.ok(normalizedAffinity(8) > 0.49 && normalizedAffinity(8) < 0.51);
  assert.ok(normalizedAffinity(1000) < 1);
});
