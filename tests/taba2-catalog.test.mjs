import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { products } from '../js/approved-beverage-demo-data.js';
import { getCustomerCatalogProducts, isProductOrderable, normalizeCatalogProduct } from '../js/core/catalog-store.js';
import { defaultCatalogFilters, normalizeCatalogFilters } from '../js/state.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('TABA2 keeps price-pending products non-purchasable without a zero price', () => {
  const pending = products.find((product) => product.sku === 'red-bull-original-lata-250ml-pack-4');
  const normalized = normalizeCatalogProduct(pending);
  assert.equal(pending.price, null);
  assert.equal(normalized.price, null);
  assert.equal(normalized.priceStatus, 'pending');
  assert.equal(isProductOrderable(normalized), false);
});

test('TABA2 excludes a pack with an image-identity collision from customer catalog', () => {
  const rejected = products.find((product) => product.sku === 'heineken-original-lata-473ml-pack-6');
  assert.equal(rejected.archived, true);
  assert.equal(rejected.imageQualityStatus, 'rejected_duplicate_identity');
  assert.ok(!getCustomerCatalogProducts(products).some((product) => product.sku === rejected.sku));
});

test('commercial filter state accepts only supported values and defaults safely', () => {
  assert.deepEqual(defaultCatalogFilters(), {
    brand: 'all', capacity: 'all', presentation: 'all', pack: 'all', alcohol: 'all',
    availability: 'all', price: 'all', promotion: 'all',
  });
  assert.deepEqual(normalizeCatalogFilters({ alcohol: 'with', price: 'pending', pack: 'invalid' }), {
    brand: 'all', capacity: 'all', presentation: 'all', pack: 'all', alcohol: 'with',
    availability: 'all', price: 'pending', promotion: 'all',
  });
});

test('versioned catalog evidence and normalized price handoff are present', () => {
  for (const relative of [
    'catalog/products.json',
    'catalog/pending-prices.csv',
    'catalog/image-sources.csv',
    'catalog/publication-readiness.csv',
    'catalog/review-queue.csv',
  ]) assert.ok(fs.existsSync(path.join(root, relative)), relative);
  const handoff = fs.readFileSync(path.join(root, 'catalog/pending-prices.csv'), 'utf8');
  assert.match(handoff, /price_status/);
  assert.match(handoff, /pending/);
  assert.doesNotMatch(handoff, /,0(?:,|\r?\n)/);
});

test('public storefront shell separates the product name from the business name', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  /*
   * El título es lo que se lee en la pestaña, en el marcador y en la vista
   * previa de un enlace compartido por WhatsApp. Decía «TABA2 · Tienda de
   * bebidas»: el nombre interno de la plataforma, con número de versión, en el
   * lugar más público del sitio. Ahora dice el comercio y lo que vende.
   *
   * «Bebidas con delivery» era verdad cuando la tienda vendía sólo bebida y
   * dejó de serlo: el título es lo primero que se lee de un enlace compartido, y
   * anunciar un rubro más chico que la góndola es perder el pedido de alguien
   * que buscaba lavandina un domingo a las tres de la mañana.
   */
  assert.match(html, /<title>La Taba · Tienda 24\/7 con delivery en Neuquén<\/title>/);
  assert.doesNotMatch(html, /TABA2(?!-BOOT)/);
  /*
   * EL MANIFEST ES LA EXCEPCIÓN, Y ES DELIBERADA.
   *
   * Hasta la versión anterior declaraba el nombre del PRODUCTO ("TABA2"), por
   * la misma regla que gobierna el resto del shell. Pero el manifest no nombra
   * una pantalla: nombra el ICONO que queda en el teléfono de un cliente, y ahí
   * "TABA2" no le dice nada a nadie —es el nombre interno de la plataforma—.
   * Lo que la persona instaló es el comercio. Por eso la identidad de
   * instalación es "La Taba" —el nombre del comercio— y sólo ella cambia de lado.
   */
  assert.equal(manifest.name, 'La Taba');
  assert.equal(manifest.short_name, 'La Taba');
  // Comercio: el fallback de primer pintado dice el nombre del local y luego
  // `applyBusinessConfig` lo reemplaza con el valor real de la config.
  assert.match(html, /data-business-name>La Taba</);
  assert.doesNotMatch(html, /data-business-name>TABA</);
});
