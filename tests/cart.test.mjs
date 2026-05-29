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

  assert.equal(addToCart('p-matambre').ok, true);
  assert.equal(state().cart[0].quantity, 1);

  assert.equal(incrementCartItem('p-matambre').ok, true);
  assert.equal(state().cart[0].quantity, 2);

  decrementCartItem('p-matambre');
  assert.equal(state().cart[0].quantity, 1);

  removeCartItem('p-matambre');
  assert.deepEqual(state().cart, []);

  addToCart('p-matambre');
  clearCart();
  assert.deepEqual(state().cart, []);
});

test('cart rejects exhausted products and never exceeds stock', () => {
  assert.equal(addToCart('p-agua').ok, false);
  assert.deepEqual(state().cart, []);

  for (let index = 0; index < 4; index += 1) {
    assert.equal(addToCart('p-matambre').ok, true);
  }

  const rejected = addToCart('p-matambre');
  assert.equal(rejected.ok, false);
  assert.match(rejected.message, /Stock disponible: 4/);
  assert.equal(state().cart[0].quantity, 4);
});

test('cart calculates subtotal, delivery fee, and totals correctly', () => {
  addToCart('p-matambre', 2);
  addToCart('p-coca', 1);

  const subtotal = 2 * 8900 + 2800;
  assert.equal(getCartSubtotal(), subtotal);
  assert.equal(getDeliveryFee('delivery'), BUSINESS_CONFIG.deliveryFee);
  assert.equal(getCartTotal('delivery'), subtotal + BUSINESS_CONFIG.deliveryFee);
  assert.equal(getCartTotal('pickup'), subtotal);
});
