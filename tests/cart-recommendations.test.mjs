import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cartNeedsComplementPrompt,
  getCartRecommendations,
} from '../js/core/cart-recommendations.js';

const products = [
  { id: 'beer', name: 'Cerveza', categoryId: 'cervezas', alcoholic: true, available: true, stock: 6, price: 1000 },
  { id: 'ice', name: 'Hielo en cubos', categoryId: 'hielo-y-extras', tags: ['hielo'], available: true, stock: 8, price: 500 },
  { id: 'candy', name: 'Golosinas', categoryId: 'picadas-y-deli', tags: ['golosinas'], available: true, stock: 5, price: 700 },
  { id: 'cola', name: 'Gaseosa cola', categoryId: 'gaseosas', available: true, stock: 9, price: 1200 },
  { id: 'gin', name: 'Gin', categoryId: 'gins-y-vodkas', alcoholic: true, available: true, stock: 4, price: 4000 },
  { id: 'sold-out-snack', name: 'Snack agotado', categoryId: 'picadas-y-deli', tags: ['snack'], available: true, stock: 0, price: 300 },
];

test('cerveza prioriza hielo y acompañamientos disponibles, sin sugerir más alcohol', () => {
  const result = getCartRecommendations({ products, cart: [{ productId: 'beer', quantity: 1 }] });
  assert.equal(result.title, 'Completá tu pedido');
  assert.equal(result.products[0].id, 'ice');
  assert.ok(result.products.some((product) => product.id === 'candy'));
  assert.ok(result.products.some((product) => product.id === 'cola'));
  assert.ok(!result.products.some((product) => product.id === 'gin'));
  assert.ok(!result.products.some((product) => product.id === 'sold-out-snack'));
});

test('no vuelve a abrir el paso previo si el carrito ya tiene un acompañamiento', () => {
  assert.equal(cartNeedsComplementPrompt({
    products,
    cart: [{ productId: 'beer', quantity: 1 }],
  }), true);
  assert.equal(cartNeedsComplementPrompt({
    products,
    cart: [{ productId: 'beer', quantity: 1 }, { productId: 'ice', quantity: 1 }],
  }), false);
});

test('sin productos compatibles disponibles no se inventa una recomendación', () => {
  const unavailable = products.map((product) => (
    product.id === 'beer' ? product : { ...product, available: false, stock: 0 }
  ));
  const result = getCartRecommendations({ products: unavailable, cart: [{ productId: 'beer', quantity: 1 }] });
  assert.deepEqual(result.products, []);
  assert.equal(cartNeedsComplementPrompt({ products: unavailable, cart: [{ productId: 'beer', quantity: 1 }] }), false);
});
