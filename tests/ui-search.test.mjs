import assert from 'node:assert/strict';
import test from 'node:test';

import { getFilteredProducts } from '../js/ui.js';

const catalogProducts = [
  {
    id: 'fernet-branca-750ml',
    name: 'Fernet Branca 750 ml',
    brand: 'Fernet Branca',
    variant: '750 ml',
    categoryId: 'fernet-y-aperitivos',
    categoryName: 'Fernet y aperitivos',
    subcategory: 'aperitivo',
    price: 18000,
    stock: 12,
    available: true,
    alcoholic: true,
    pricePending: false,
  },
  {
    id: 'vodka-skyy-1lt',
    name: 'Vodka Skyy 1 l',
    brand: 'Skyy',
    categoryId: 'vodkas',
    categoryName: 'Vodkas',
    variant: '1 l',
    price: 17000,
    stock: 6,
    available: true,
    alcoholic: true,
    pricePending: false,
  },
  {
    id: 'gin-bombay-700ml',
    name: 'Gin Bombay Sapphire 700 ml',
    brand: 'Bombay Sapphire',
    categoryId: 'gin',
    categoryName: 'Gin',
    variant: '700 ml',
    price: 24000,
    stock: 5,
    available: true,
    alcoholic: true,
    pricePending: false,
  },
  {
    id: 'whisky-jameson-700ml',
    name: 'Jameson 700 ml',
    brand: 'Jameson',
    categoryId: 'whisky',
    categoryName: 'Whisky',
    variant: '700 ml',
    price: 26000,
    stock: 4,
    available: true,
    alcoholic: true,
    pricePending: false,
  },
  {
    id: 'vino-malbec',
    name: 'Malbec 750 ml',
    brand: 'Bodega Norte',
    categoryId: 'vinos',
    categoryName: 'Vinos',
    variant: '750 ml',
    price: 22000,
    stock: 8,
    available: true,
    alcoholic: true,
    pricePending: false,
  },
  {
    id: 'cerveza-heineken-473ml',
    name: 'Heineken',
    brand: 'Heineken',
    categoryId: 'cervezas',
    categoryName: 'Cervezas',
    variant: '473 ml',
    price: 2900,
    stock: 20,
    available: true,
    alcoholic: true,
    pricePending: false,
  },
  {
    id: 'agua-villa-1500',
    name: 'Villavicencio Agua',
    brand: 'Villavicencio',
    categoryId: 'aguas-y-sodas',
    categoryName: 'Aguas y sodas',
    variant: '1500 ml',
    price: 1800,
    stock: 18,
    available: true,
    alcoholic: false,
    pricePending: false,
  },
  {
    id: 'energizante-monster',
    name: 'Monster Energy',
    brand: 'Monster Energy',
    categoryId: 'energeticas',
    categoryName: 'Energizantes',
    variant: '473 ml',
    price: 3400,
    stock: 10,
    available: true,
    alcoholic: false,
    pricePending: false,
  },
];

const baseState = {
  activeCategory: 'all',
  sortBy: 'recommended',
  promotions: [],
  products: catalogProducts,
};

function idsForSearch(query) {
  return getFilteredProducts({ ...baseState, searchQuery: query })
    .map((product) => product.id);
}

test('la búsqueda por texto encuentra productos por familia objetivo', () => {
  const expectations = [
    ['fernet', ['fernet-branca-750ml']],
    ['VODKA', ['vodka-skyy-1lt']],
    ['gin', ['gin-bombay-700ml']],
    ['WhIsKy', ['whisky-jameson-700ml']],
    ['vino', ['vino-malbec']],
    ['cerveza', ['cerveza-heineken-473ml']],
    ['agua', ['agua-villa-1500']],
    ['energizante', ['energizante-monster']],
    ['F\u00e9rnet  ', ['fernet-branca-750ml']],
  ];

  for (const [query, expectedIds] of expectations) {
    const ids = idsForSearch(query);
    assert.deepEqual(new Set(expectedIds.filter((id) => ids.includes(id))), new Set(expectedIds));
    assert.equal(ids.length >= expectedIds.length, true);
  }
});

test('el query de Fernet devuelve un producto comprable y no solo un marcador', () => {
  const fernet = getFilteredProducts({
    ...baseState,
    searchQuery: 'fernet',
  }).find((product) => product.id === 'fernet-branca-750ml');

  assert.ok(Boolean(fernet));
  assert.equal(fernet.price > 0, true);
  assert.equal(fernet.pricePending, false);
  assert.equal(fernet.alcoholic, true);
  assert.equal(fernet.available, true);
});
