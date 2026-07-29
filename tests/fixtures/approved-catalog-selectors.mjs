import assert from 'node:assert/strict';

function findCompatibleProduct(catalog, description, predicate) {
  assert.ok(Array.isArray(catalog), 'Expected a product catalog array');
  const product = catalog.find(predicate);
  assert.ok(product, `Expected ${description} in the approved demo catalog`);
  return product;
}

export function getPurchasableUnitProduct(catalog) {
  return findCompatibleProduct(catalog, 'one purchasable unit product', (product) => (
    product.available === true && product.unitsPerPack === 1 && product.price > 0 && product.pricePending !== true
  ));
}

export function getPurchasablePackProduct(catalog) {
  return findCompatibleProduct(catalog, 'one purchasable pack product', (product) => (
    product.available === true && product.unitsPerPack > 1 && product.price > 0 && product.pricePending !== true
  ));
}

export function getAlcoholProduct(catalog) {
  return findCompatibleProduct(catalog, 'one alcoholic product', (product) => product.alcoholic === true);
}

export function getNonAlcoholProduct(catalog) {
  return findCompatibleProduct(catalog, 'one non-alcoholic product', (product) => product.alcoholic === false);
}

export function getPricePendingProduct(catalog) {
  return findCompatibleProduct(catalog, 'one price-pending product', (product) => (
    product.pricePending === true && product.available === false && product.price === 0
  ));
}
