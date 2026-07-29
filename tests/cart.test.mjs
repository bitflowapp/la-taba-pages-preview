import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import {
  addToCart,
  clearCart,
  decrementCartItem,
  getCartItems,
  getDeliveryMinimumProgress,
  getCartSubtotal,
  getCartTotal,
  getDeliveryFee,
  incrementCartItem,
  removeCartItem,
} from '../js/cart.js';
import { BUSINESS_CONFIG } from '../js/config.js';
import { resetState, state } from './helpers.mjs';

beforeEach(() => {
  Object.defineProperty(globalThis, 'location', {
    value: { search: '?demo=1' },
    configurable: true,
  });
  resetState();
});

test('cart supports add, increment, decrement, remove, and clear', () => {
  assert.deepEqual(getCartItems(), []);

  assert.equal(addToCart('qa-jugo-naranja').ok, true);
  assert.equal(state().cart[0].quantity, 1);

  assert.equal(incrementCartItem('qa-jugo-naranja').ok, true);
  assert.equal(state().cart[0].quantity, 2);

  decrementCartItem('qa-jugo-naranja');
  assert.equal(state().cart[0].quantity, 1);

  removeCartItem('qa-jugo-naranja');
  assert.deepEqual(state().cart, []);

  addToCart('qa-jugo-naranja');
  clearCart();
  assert.deepEqual(state().cart, []);
});

test('cart rejects exhausted products and never exceeds stock', () => {
  resetState({
    products: state().products.map((product) => (
      product.id === 'qa-hielo' ? { ...product, stock: 0, available: false } : product
    )),
  });
  assert.equal(addToCart('qa-hielo').ok, false);
  assert.deepEqual(state().cart, []);

  for (let index = 0; index < 4; index += 1) {
    assert.equal(addToCart('qa-jugo-naranja').ok, true);
  }

  const rejected = addToCart('qa-jugo-naranja');
  assert.equal(rejected.ok, false);
  assert.match(rejected.message, /Stock disponible: 4/);
  assert.equal(state().cart[0].quantity, 4);
});

test('cart rejects invalid quantities and prunes disabled products from state', () => {
  assert.equal(addToCart('qa-agua-mineral', 0).ok, false);
  assert.equal(addToCart('qa-agua-mineral', -2).ok, false);
  assert.deepEqual(state().cart, []);

  addToCart('qa-agua-mineral', 2);
  resetState({
    products: state().products.map((product) => (
      product.id === 'qa-agua-mineral' ? { ...product, available: false } : product
    )),
    cart: [{ productId: 'qa-agua-mineral', quantity: 2 }],
  });

  assert.deepEqual(state().cart, []);
  assert.deepEqual(getCartItems(), []);
});

test('cart calculates subtotal, delivery fee, and totals correctly', () => {
  addToCart('qa-jugo-naranja', 2);
  addToCart('qa-agua-mineral', 1);

  const juicePrice = state().products.find((product) => product.id === 'qa-jugo-naranja').price;
  const waterPrice = state().products.find((product) => product.id === 'qa-agua-mineral').price;
  const subtotal = 2 * juicePrice + waterPrice;
  assert.equal(getCartSubtotal(), subtotal);
  assert.equal(getDeliveryFee('delivery'), BUSINESS_CONFIG.deliveryFee);
  assert.equal(getCartTotal('delivery'), subtotal + BUSINESS_CONFIG.deliveryFee);
  assert.equal(getCartTotal('pickup'), subtotal);
});

test('delivery minimum progress reports the missing amount and caps at completion', () => {
  const belowMinimum = getDeliveryMinimumProgress(3_000, BUSINESS_CONFIG.minDeliveryOrder);
  assert.deepEqual(belowMinimum, {
    subtotal: 3_000,
    minimum: BUSINESS_CONFIG.minDeliveryOrder,
    missing: 2_000,
    reached: false,
    progress: 60,
  });

  const aboveMinimum = getDeliveryMinimumProgress(7_000, BUSINESS_CONFIG.minDeliveryOrder);
  assert.equal(aboveMinimum.missing, 0);
  assert.equal(aboveMinimum.reached, true);
  assert.equal(aboveMinimum.progress, 100);
});

test('empty cart does not charge delivery in totals', () => {
  assert.equal(getCartSubtotal(), 0);
  assert.equal(getCartTotal('delivery'), 0);
  assert.equal(getCartTotal('pickup'), 0);
});
