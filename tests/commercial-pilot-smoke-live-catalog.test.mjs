// El smoke de cada deploy de CONTROLLED_PRODUCTION en modo `live`: el catálogo
// que publicó el dueño, con 0 productos o con 46, tiene que ser vendible de
// verdad. Y las fotos del pipeline se cargan desde Storage, como en la tienda.
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertLivePublicCatalog, browserImageUrl } from '../scripts/deploy/smoke-commercial-pilot.mjs';

const BUSINESS = 'e7850ad2-a447-402c-8375-3fd74e9466ba';
const PRODUCT = 'd98aa694-f0eb-4986-9249-408ae8036f6a';
const SHA = 'a'.repeat(64);
const ALIAS = `assets/products/c_${BUSINESS}_${PRODUCT}-0123456789abcdef-${SHA}.webp`;
const THUMB = `assets/products/c_${BUSINESS}_${PRODUCT}-0123456789abcdef-thumb-${SHA}.webp`;
const product = (patch = {}) => ({ sku: 'campari-bitter-750ml', price: 18500, stock: 6, image_url: ALIAS, image_thumbnail_url: THUMB, ...patch });

test('una tienda cerrada, sin nada público, pasa', () => {
  assert.deepEqual(assertLivePublicCatalog([]), { publicProducts: 0 });
});

test('un producto publicado con precio, stock y foto del pipeline pasa', () => {
  assert.deepEqual(assertLivePublicCatalog([product(), product({ sku: 'agua-500ml', image_thumbnail_url: null })]), { publicProducts: 2 });
});

test('lo que no se puede vender no puede estar a la vista', () => {
  assert.throws(() => assertLivePublicCatalog([product({ price: 0 })]), /PUBLIC_PRODUCT_WITHOUT_PRICE/);
  assert.throws(() => assertLivePublicCatalog([product({ stock: 0 })]), /PUBLIC_PRODUCT_WITHOUT_STOCK/);
  assert.throws(() => assertLivePublicCatalog([product({ stock: null })]), /PUBLIC_PRODUCT_WITHOUT_STOCK/);
  assert.throws(() => assertLivePublicCatalog([product({ image_url: null })]), /PUBLIC_PRODUCT_IMAGE_INVALID/);
  assert.throws(() => assertLivePublicCatalog([product({ image_url: 'https://evil.example/x.png' })]), /PUBLIC_PRODUCT_IMAGE_INVALID/);
  assert.throws(() => assertLivePublicCatalog([product({ image_url: 'assets/../secret' })]), /PUBLIC_PRODUCT_IMAGE_INVALID/);
  assert.throws(() => assertLivePublicCatalog([product({ sku: 'QA Algo' })]), /PUBLIC_SKU_INVALID/);
});

test('las fotos del pipeline se cargan desde Storage; las del repo, desde el sitio', () => {
  assert.equal(browserImageUrl(ALIAS, 'https://tkanbadcglszlcyfjvpv.supabase.co'),
    `https://tkanbadcglszlcyfjvpv.supabase.co/storage/v1/object/public/catalog-images/business/${BUSINESS}/products/${PRODUCT}/${SHA}.webp`);
  assert.equal(browserImageUrl('assets/products/agua.webp', 'https://tkanbadcglszlcyfjvpv.supabase.co'), '/assets/products/agua.webp');
});
