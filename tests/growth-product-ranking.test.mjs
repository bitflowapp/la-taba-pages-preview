import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  explainProductRanking,
  rankProductCandidates,
  rankProductsByIntent,
} from '../js/growth/product-ranking.js';

function product(id, categoryId, brand, overrides = {}) {
  return {
    id,
    categoryId,
    brand,
    name: id,
    image: 'fixture.webp',
    price: 100,
    pricePending: false,
    available: true,
    archived: false,
    stock: 10,
    ...overrides,
  };
}

test('beer intent ordena el shelf por categoría y mantiene variedad dentro de la intención', () => {
  const products = [
    product('red-bull', 'energizantes', 'Red Bull'),
    product('imperial-apa', 'cervezas', 'Imperial'),
    product('heineken', 'cervezas', 'Heineken'),
  ];
  const ranked = rankProductsByIntent(products, {
    affinity: { categories: { cervezas: 12 }, brands: {}, products: {} },
  });
  assert.deepEqual(ranked.map((item) => item.id), ['imperial-apa', 'heineken', 'red-bull']);

  const varied = rankProductsByIntent([
    product('beer-a', 'cervezas', 'Marca A'),
    product('beer-b', 'cervezas', 'Marca A'),
    product('beer-c', 'cervezas', 'Marca B'),
  ], { affinity: { categories: { cervezas: 12 }, brands: {}, products: {} } });
  assert.equal(varied[0].brand, 'Marca A');
  assert.equal(varied[1].brand, 'Marca B');
  assert.equal(varied[2].brand, 'Marca A');
});

test('la intención cambia de cerveza a vino sin quedar pegada', () => {
  const products = [
    product('beer', 'cervezas', 'Imperial'),
    product('wine', 'vinos', 'Trapiche'),
  ];
  const beerFirst = rankProductsByIntent(products, {
    affinity: { categories: { cervezas: 12, vinos: 2 }, brands: {}, products: {} },
  });
  const wineFirst = rankProductsByIntent(products, {
    affinity: { categories: { cervezas: 3, vinos: 14 }, brands: {}, products: {} },
  });
  assert.equal(beerFirst[0].id, 'beer');
  assert.equal(wineFirst[0].id, 'wine');
});

test('cold start conserva el orden comercial y no hiperpersonaliza', () => {
  const products = [product('first', 'gaseosas', 'A'), product('second', 'cervezas', 'B')];
  assert.deepEqual(
    rankProductsByIntent(products, { affinity: { categories: {}, brands: {}, products: {} } }),
    products,
  );
});

test('stock se filtra antes del ranking: agotado nunca queda recomendado', () => {
  const ranked = rankProductCandidates([
    product('sold-out-beer', 'cervezas', 'Imperial', { stock: 0 }),
    product('available-energy', 'energizantes', 'Speed'),
  ], { affinity: { categories: { cervezas: 60 }, brands: {}, products: {} } });
  assert.deepEqual(ranked.map((entry) => entry.product.id), ['available-energy', 'sold-out-beer']);
  assert.equal(ranked[0].available, true);
  assert.equal(ranked[1].available, false);
  assert.equal(ranked[1].score, Number.NEGATIVE_INFINITY);
  assert.match(explainProductRanking(ranked)[0].factors.join(' '), /availability \+/);
});

