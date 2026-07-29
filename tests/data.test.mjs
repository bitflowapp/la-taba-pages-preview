import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { categories, products } from '../js/data.js';
import {
  isFernetProduct,
  isPopularProduct,
  isPromotionalProduct,
  isUnitStorefrontProduct,
  uniqueProducts,
} from '../js/core/storefront-filters.js';

const EXPECTED_CATEGORY_IDS = [
  'all',
  'promos',
  'gaseosas',
  'aguas',
  'jugos',
  'energeticas',
  'isotonicas',
  'cervezas',
  'vinos-y-espumantes',
  'gins-y-vodkas',
  'whisky-y-destilados',
  'picadas-y-deli',
  'hielo-y-extras',
];
const ALCOHOLIC_CATEGORY_IDS = new Set([
  'cervezas',
  'vinos-y-espumantes',
  'gins-y-vodkas',
  'whisky-y-destilados',
]);

test('catalog data is internally consistent', () => {
  assert.ok(Array.isArray(categories) && categories.length > 0);
  assert.ok(Array.isArray(products) && products.length > 0);

  const categoryIds = new Set(categories.map((category) => category.id));
  const productIds = new Set();
  const productCountByCategory = new Map(categories.map((category) => [category.id, 0]));

  for (const product of products) {
    assert.ok(typeof product.id === 'string' && product.id.length > 0);
    assert.ok(!productIds.has(product.id), `duplicate product id: ${product.id}`);
    productIds.add(product.id);

    assert.ok(typeof product.name === 'string' && product.name.trim().length > 0);
    assert.ok(typeof product.categoryId === 'string' && product.categoryId.length > 0);
    assert.ok(categoryIds.has(product.categoryId), `missing category: ${product.categoryId}`);
    assert.ok(Number.isFinite(product.price) && product.price > 0);
    assert.ok(Number.isFinite(product.stock) && product.stock >= 0);
    assert.equal(typeof product.available, 'boolean');
    if ('featured' in product) assert.equal(typeof product.featured, 'boolean');

    if (productCountByCategory.has(product.categoryId)) {
      productCountByCategory.set(product.categoryId, productCountByCategory.get(product.categoryId) + 1);
    }
  }

  assert.equal(products.length, 14);
  assert.ok(productCountByCategory.get('gaseosas') > 0);
  assert.ok(productCountByCategory.get('energeticas') > 0);
});

test('preview catalog is concrete beverages and internally marked as QA', () => {
  const categoryNames = new Set(categories.map((category) => category.name));
  for (const expected of ['Promos', 'Gaseosas', 'Aguas', 'Jugos', 'Cervezas', 'Hielo y extras']) {
    assert.ok(categoryNames.has(expected), `missing category: ${expected}`);
  }
  assert.ok(products.every((product) => product.qaFixture === true));
  assert.ok(products.every((product) => /Precio y stock QA/.test(product.marketNote)));
  assert.ok(products.every((product) => product.id.startsWith('qa-')));
  for (const product of products) {
    if (product.image) {
      if (product.previewCatalogApproved) {
        assert.match(product.image, /^assets\/(?:catalog\/products\/.+\.webp|products\/bebidas\/.+\.jpg)$/);
        assert.match(product.imageThumbnail || '', /^assets\/(?:catalog\/thumbnails\/.+\.webp|products\/bebidas\/.+\.jpg)$/);
        assert.match(product.imageSha256 || '', /^[a-f0-9]{64}$/);
        assert.match(product.imageThumbnailSha256 || '', /^[a-f0-9]{64}$/);
        assert.match(product.sourceImageSha256 || '', /^[a-f0-9]{64}$/);
      } else {
        assert.equal(product.image, 'assets/products/beverage-placeholder.svg');
      }
    }
  }
  assert.equal(products.filter((product) => product.previewCatalogApproved).length, 12);
  assert.equal(products.filter((product) => product.identityStatus === 'EXACTA').length, 12);
  assert.equal(products.filter((product) => product.identityStatus === 'PARCIAL').length, 2);
  assert.ok(products.every((product) => !/^(gaseosa|energética|cerveza|agua mineral)$/i.test(product.name)));
});

test('preview catalog sells beverages only by unit and never renders multipacks', () => {
  for (const product of products) {
    assert.equal(product.unitsPerPack, 1, `unexpected multipack quantity for ${product.id}`);
    assert.notEqual(product.unit, 'pack', `unexpected pack unit for ${product.id}`);
    assert.notEqual(product.packageType, 'pack', `unexpected pack presentation for ${product.id}`);
    assert.doesNotMatch(
      `${product.name} ${product.description} ${product.unitLabel}`,
      /\b(?:pack|x\s?\d+)\b/i,
      `multipack copy in active product ${product.id}`,
    );
  }
});

test('el storefront publicado deriva una única colección de unidades válidas', () => {
  const storefrontProducts = products.filter(isUnitStorefrontProduct);
  const categoryIds = new Set(categories.map((category) => category.id));
  const blockedIds = products
    .filter((product) => !isUnitStorefrontProduct(product))
    .map((product) => product.id)
    .sort();

  assert.deepEqual(blockedIds, [
    'qa-hielo',
    'qa-isotonica',
    'qa-jugo-naranja',
    'qa-picada',
    'qa-whisky',
  ]);
  assert.equal(uniqueProducts(storefrontProducts).length, storefrontProducts.length);

  for (const product of storefrontProducts) {
    assert.equal(product.unitsPerPack, 1, `cantidad no unitaria en ${product.id}`);
    assert.equal(product.imageShowsMultipack, false, `imagen multipack publicada en ${product.id}`);
    assert.doesNotMatch(product.name, /(?:\b(?:pack|multipack)\b|(?:^|\s)(?:x|×)\s*[2-9]\d*)/i);
    assert.doesNotMatch(
      `${product.description} ${product.presentation || ''} ${product.unitLabel}`,
      /\b(?:pack|multipack)\b/i,
      `presentación multipack publicada en ${product.id}`,
    );
    assert.ok(categoryIds.has(product.categoryId), `categoría inválida en ${product.id}`);
  }
});

test('promociones, más vendidos y Fernet usan señales reales del catálogo unitario', () => {
  const storefrontProducts = products.filter(isUnitStorefrontProduct);
  const promotions = storefrontProducts.filter((product) => isPromotionalProduct(product));
  const popular = storefrontProducts.filter(isPopularProduct);
  const fernet = storefrontProducts.filter(isFernetProduct);

  assert.ok(promotions.length > 0);
  assert.ok(promotions.every((product) => (
    String(product.homePromoBadge || '').trim()
    || Number(product.oldPrice) > Number(product.price)
  )));
  assert.ok(popular.length > 0);
  assert.ok(popular.every((product) => product.popular === true));
  assert.equal(fernet.length, 0);
  assert.equal(
    storefrontProducts.some((product) => /gin/i.test(product.name) && isFernetProduct(product)),
    false,
  );
});

test('preview categories use the canonical beverage ids', () => {
  assert.deepEqual(categories.map((category) => category.id), EXPECTED_CATEGORY_IDS);
});

test('preview alcohol metadata is inferred consistently from category', () => {
  for (const product of products) {
    const alcoholic = ALCOHOLIC_CATEGORY_IDS.has(product.categoryId);
    assert.equal(product.alcoholic, alcoholic, `unexpected alcoholic flag for ${product.id}`);
    assert.equal(product.minimumAge, alcoholic ? 18 : null, `unexpected minimum age for ${product.id}`);
  }
});

test('preview prices are neutral QA tiers, not market estimates', () => {
  const allowedPrices = new Set([5000, 7500, 10000, 15000]);
  assert.ok(products.every((product) => allowedPrices.has(product.price)));
});

test('active catalog and data module have no inherited pizzeria identifiers or names', () => {
  const forbidden = /\b(?:pizza|muzzarella|fugazzeta|calabresa|pepperoni|combo-pizza)\b/i;
  for (const category of categories) {
    assert.doesNotMatch(`${category.id} ${category.name}`, forbidden);
  }
  for (const product of products) {
    assert.doesNotMatch(
      `${product.id} ${product.name} ${product.categoryId}`,
      forbidden,
      `inherited pizzeria identifier in active product ${product.id}`,
    );
  }
  const dataSource = fs.readFileSync(new URL('../js/data.js', import.meta.url), 'utf8');
  assert.doesNotMatch(dataSource, forbidden);
  assert.doesNotMatch(dataSource, /historicalPizzeria/i);
});
