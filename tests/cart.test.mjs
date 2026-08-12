import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import {
  addToCart,
  cartItemIssue,
  clearCart,
  decrementCartItem,
  getCartItems,
  getDeliveryMinimumProgress,
  getCartSubtotal,
  getCartTotal,
  getDeliveryFee,
  incrementCartItem,
  removeCartItem,
  setCartItemQuantity,
  validateCartForCheckout,
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

test('cart rejects invalid quantities, y un producto deshabilitado se avisa en vez de borrarse', () => {
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

  // Este test afirmaba `state().cart === []`: un producto deshabilitado se
  // borraba del carrito en cada commit. La INTENCIÓN era buena —que no se pueda
  // comprar algo deshabilitado— pero el mecanismo era borrar en silencio, y eso
  // le edita el pedido a alguien que lo está mirando (H-08). La intención se
  // conserva entera; lo que cambia es cómo se cumple.
  const linea = getCartItems().find((item) => item.productId === 'qa-agua-mineral');
  assert.ok(linea, 'la línea sigue, para poder explicarla');
  assert.equal(cartItemIssue(linea)?.kind, 'unavailable', 'y viene marcada como no disponible');
  assert.equal(
    validateCartForCheckout('delivery').ok,
    false,
    'que es lo que de verdad protegía el borrado: no se puede confirmar',
  );
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

// El aviso que se ve EN la línea del carrito y el error que devuelve el botón
// de confirmar salen del mismo criterio. Si se separan, el cliente ve una línea
// tranquila y un botón que la rechaza, que es exactamente lo que pasaba cuando
// el único que hablaba era el checkout.
test('una línea que ya no se puede pedir se explica y ofrece la salida', () => {
  addToCart('qa-jugo-naranja', 2);
  const [linea] = getCartItems();
  assert.equal(cartItemIssue(linea), null, 'con stock suficiente no hay nada que avisar');

  const agotado = { ...linea, product: { ...linea.product, stock: 0 } };
  const avisoAgotado = cartItemIssue(agotado);
  assert.equal(avisoAgotado.kind, 'unavailable');
  assert.equal(avisoAgotado.quantity, 0);
  assert.match(avisoAgotado.message, /agot/i);

  const pausado = { ...linea, product: { ...linea.product, available: false } };
  assert.equal(cartItemIssue(pausado).kind, 'unavailable');

  const excedido = { ...linea, quantity: 5, product: { ...linea.product, stock: 3 } };
  const avisoExcedido = cartItemIssue(excedido);
  assert.equal(avisoExcedido.kind, 'over');
  assert.equal(avisoExcedido.quantity, 3);
  assert.equal(avisoExcedido.actionLabel, 'Dejar 3');
  assert.match(avisoExcedido.message, /Quedan 3 unidades/);

  // Y una sola unidad se dice en singular: el aviso no puede sonar a plantilla.
  const unaSola = { ...linea, quantity: 4, product: { ...linea.product, stock: 1 } };
  assert.match(cartItemIssue(unaSola).message, /Queda 1 unidad\./);
});

test('ajustar la cantidad al stock recorta la línea, y en cero la quita', () => {
  addToCart('qa-jugo-naranja', 3);
  assert.equal(setCartItemQuantity('qa-jugo-naranja', 2).ok, true);
  assert.equal(state().cart[0].quantity, 2);

  // No sirve para pedir MÁS de lo que hay: el ajuste es una salida, no una
  // puerta trasera al stock.
  const excede = setCartItemQuantity('qa-jugo-naranja', 9_999);
  assert.equal(excede.ok, false);
  assert.equal(state().cart[0].quantity, 2);

  assert.equal(setCartItemQuantity('qa-jugo-naranja', 0).ok, true);
  assert.deepEqual(state().cart, []);
  assert.equal(setCartItemQuantity('qa-jugo-naranja', 1).ok, false);
});
