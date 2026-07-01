import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import {
  addToCart,
  clearCart,
  decrementCartItem,
  getCartItems,
  getCartSubtotal,
  getCartTotal,
  getDeliveryFee,
  incrementCartItem,
  removeCartItem,
} from '../js/cart.js';
import { BUSINESS_CONFIG } from '../js/config.js';
import { resetState, state } from './helpers.mjs';

beforeEach(() => resetState());

test('cart supports add, increment, decrement, remove, and clear', () => {
  assert.deepEqual(getCartItems(), []);

  assert.equal(addToCart('p-napolitana').ok, true);
  assert.equal(state().cart[0].quantity, 1);

  assert.equal(incrementCartItem('p-napolitana').ok, true);
  assert.equal(state().cart[0].quantity, 2);

  decrementCartItem('p-napolitana');
  assert.equal(state().cart[0].quantity, 1);

  removeCartItem('p-napolitana');
  assert.deepEqual(state().cart, []);

  addToCart('p-napolitana');
  clearCart();
  assert.deepEqual(state().cart, []);
});

test('cart rejects exhausted products and never exceeds stock', () => {
  assert.equal(addToCart('p-agua').ok, false);
  assert.deepEqual(state().cart, []);

  for (let index = 0; index < 4; index += 1) {
    assert.equal(addToCart('p-napolitana').ok, true);
  }

  const rejected = addToCart('p-napolitana');
  assert.equal(rejected.ok, false);
  assert.match(rejected.message, /Stock disponible: 4/);
  assert.equal(state().cart[0].quantity, 4);
});

test('cart rejects invalid quantities and prunes disabled products from state', () => {
  assert.equal(addToCart('p-coca', 0).ok, false);
  assert.equal(addToCart('p-coca', -2).ok, false);
  assert.deepEqual(state().cart, []);

  addToCart('p-coca', 2);
  resetState({
    products: state().products.map((product) => (
      product.id === 'p-coca' ? { ...product, available: false } : product
    )),
    cart: [{ productId: 'p-coca', quantity: 2 }],
  });

  assert.deepEqual(state().cart, []);
  assert.deepEqual(getCartItems(), []);
});

test('cart calculates subtotal, delivery fee, and totals correctly', () => {
  addToCart('p-napolitana', 2);
  addToCart('p-coca', 1);

  const subtotal = 2 * 9990 + 2900;
  assert.equal(getCartSubtotal(), subtotal);
  assert.equal(getDeliveryFee('delivery'), BUSINESS_CONFIG.deliveryFee);
  assert.equal(getCartTotal('delivery'), subtotal + BUSINESS_CONFIG.deliveryFee);
  assert.equal(getCartTotal('pickup'), subtotal);
});

test('empty cart does not charge delivery in totals', () => {
  assert.equal(getCartSubtotal(), 0);
  assert.equal(getCartTotal('delivery'), 0);
  assert.equal(getCartTotal('pickup'), 0);
});
