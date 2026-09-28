import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  IMAGE_ATTRIBUTIONS, imageAttributionFor, imageAttributionText, rightsReferenceRequiresAttribution,
} from '../js/core/image-attribution.js';
import { productImageCredit } from '../js/ui.js';
import {
  catalogImageAttributionStatus, catalogPublicationReadiness, normalizeCatalogProduct, renderCatalogEditor,
} from '../js/business/business-catalog-editor.js';

const CAMPARI_SOURCE = 'ccc2d1bac09400804fb83c9f54b7f15a7a082e3aa2e6ddcfaebb540efe77fe92';
const HASH = (char) => char.repeat(64);

function storefrontProduct(overrides = {}) {
  return {
    id: 'p-campari', name: 'Campari Bitter 750 ml', sku: 'campari-bitter-750ml',
    image: 'assets/products/campari-master.webp', imageThumbnail: 'assets/products/campari-thumb.webp',
    imageSha256: HASH('a'), imageThumbnailSha256: HASH('b'), sourceImageSha256: CAMPARI_SOURCE,
    rightsStatus: 'PERMISO_DOCUMENTADO',
    ...overrides,
  };
}

test('el registro sólo acepta hashes SHA-256, enlaces HTTPS y licencias CC', () => {
  const entries = Object.entries(IMAGE_ATTRIBUTIONS);
  assert.ok(entries.length >= 1);
  for (const [hash, entry] of entries) {
    assert.match(hash, /^[a-f0-9]{64}$/);
    assert.match(entry.sourceUrl, /^https:\/\//);
    assert.match(entry.licenseUrl, /^https:\/\/creativecommons\.org\/licenses\//);
    assert.match(entry.license, /^CC BY/);
    assert.ok(entry.source);
    assert.ok(Object.isFrozen(entry));
  }
  assert.ok(Object.isFrozen(IMAGE_ATTRIBUTIONS));
});

test('el crédito se encuentra por el hash del archivo original aprobado', () => {
  const credit = imageAttributionFor({ sourceImageSha256: CAMPARI_SOURCE });
  assert.equal(credit.source, 'Open Food Facts');
  assert.equal(credit.license, 'CC BY-SA 3.0');
  assert.equal(credit.sourceUrl, 'https://world.openfoodfacts.org/product/7791200200781');
  assert.deepEqual(imageAttributionFor({ source_image_sha256: CAMPARI_SOURCE.toUpperCase() }), credit);
  assert.equal(imageAttributionFor({ sourceImageSha256: HASH('c') }), null);
  assert.equal(imageAttributionFor({ sourceImageSha256: 'no-es-un-hash' }), null);
  assert.equal(imageAttributionFor({}), null);
  assert.equal(imageAttributionText(credit), 'Foto: Open Food Facts (smoothie-app) · CC BY-SA 3.0 · fondo reemplazado por blanco');
});

test('un registro con enlaces no HTTPS no produce un crédito a medias', () => {
  const registry = { [HASH('d')]: { source: 'X', sourceUrl: 'http://example.org', license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' } };
  assert.equal(imageAttributionFor({ sourceImageSha256: HASH('d') }, registry), null);
});

test('sólo las referencias CC exigen atribución', () => {
  assert.equal(rightsReferenceRequiresAttribution('CC BY-SA 3.0 (uso comercial con atribución) · Open Food Facts'), true);
  assert.equal(rightsReferenceRequiresAttribution('licencia cc-by 4.0'), true);
  assert.equal(rightsReferenceRequiresAttribution('Foto propia del local, 2026-09-28'), false);
  assert.equal(rightsReferenceRequiresAttribution('Permiso escrito del distribuidor, nota 2026-09'), false);
  assert.equal(rightsReferenceRequiresAttribution(''), false);
});

test('la ficha pública muestra autor, fuente, licencia enlazada y cambios', () => {
  const html = productImageCredit(storefrontProduct());
  assert.match(html, /data-image-credit/);
  assert.match(html, /href="https:\/\/world\.openfoodfacts\.org\/product\/7791200200781"/);
  assert.match(html, /rel="license noopener noreferrer"[^>]*>CC BY-SA 3\.0<\/a>/);
  assert.match(html, /\(smoothie-app\)/);
  assert.match(html, /fondo reemplazado por blanco/);
});

test('sin foto oficial o sin registro no se inventa un crédito', () => {
  assert.equal(productImageCredit(storefrontProduct({ sourceImageSha256: HASH('e') })), '');
  assert.equal(productImageCredit(storefrontProduct({ imageSha256: '' })), '');
  assert.equal(productImageCredit(storefrontProduct({ rightsStatus: '' })), '');
});

function panelProduct(overrides = {}) {
  return normalizeCatalogProduct({
    id: 'p1', sku: 'campari-bitter-750ml', name: 'Campari Bitter 750 ml', brand: 'Campari',
    price: 9900, price_status: 'confirmed', stock: 4, available: false, is_verified: true,
    is_active: true, is_alcoholic: false, catalog_origin: 'commercial',
    image_url: 'assets/products/c.webp', image_thumbnail_url: 'assets/products/t.webp',
    catalog_asset_id: 'asset-1', source_image_sha256: CAMPARI_SOURCE,
    ...overrides,
  });
}
const ccUpload = {
  id: 'u1', product_id: 'p1', status: 'approved', rights_status: 'LICENCIA_COMERCIAL',
  rights_reference: 'CC BY-SA 3.0 · Open Food Facts', reviewed_at: '2026-09-28T04:00:00Z',
};

test('el Panel no ofrece publicar una foto CC cuyo crédito la tienda no muestra', () => {
  const missing = panelProduct({ source_image_sha256: HASH('f') });
  assert.deepEqual(catalogImageAttributionStatus(missing, [ccUpload]), { required: true, ready: false });
  const blocked = catalogPublicationReadiness(missing, { imageUploads: [ccUpload] });
  assert.equal(blocked.ready, false);
  assert.match(blocked.reason, /licencia CC/);
  const html = renderCatalogEditor({ products: [{
    id: 'p1', sku: 'campari-bitter-750ml', name: 'Campari Bitter 750 ml', price: 9900, price_status: 'confirmed',
    stock: 4, available: false, is_verified: true, is_active: true, catalog_origin: 'commercial',
    image_url: 'assets/products/c.webp', image_thumbnail_url: 'assets/products/t.webp', catalog_asset_id: 'asset-1',
    source_image_sha256: HASH('f'),
  }], imageUploads: [ccUpload], canManageImages: true, phase: 'ready' });
  assert.match(html, /data-catalog-image-attribution="missing"/);
  assert.doesNotMatch(html, /data-publish="true"/);
});

test('con el crédito registrado, la licencia CC deja de bloquear la publicación', () => {
  const product = panelProduct();
  assert.deepEqual(catalogImageAttributionStatus(product, [ccUpload]), { required: true, ready: true });
  assert.equal(catalogPublicationReadiness(product, { imageUploads: [ccUpload] }).ready, true);
  const own = { ...ccUpload, rights_status: 'PROPIO', rights_reference: 'Foto propia del local' };
  assert.deepEqual(catalogImageAttributionStatus(panelProduct({ source_image_sha256: HASH('f') }), [own]),
    { required: false, ready: true });
});

test('el Panel lee la miniatura y el hash original de la foto asociada', () => {
  const repository = readFileSync(new URL('../js/repositories/supabase-inventory-repository.js', import.meta.url), 'utf8');
  const select = repository.match(/listCatalogProducts\(\) \{[\s\S]*?\.select\('([^']+)'\)/)?.[1] || '';
  for (const column of ['image_url', 'image_thumbnail_url', 'source_image_sha256', 'catalog_asset_id']) {
    assert.ok(select.split(',').includes(column), `falta ${column} en el select del catálogo del Panel`);
  }
  const html = renderCatalogEditor({ products: [{
    id: 'p1', sku: 's1', name: 'Con foto', price: 0, price_status: 'pending', stock: null,
    available: false, is_verified: false, is_active: true, catalog_origin: 'commercial',
    image_url: 'assets/products/c.webp', image_thumbnail_url: 'assets/products/t.webp', catalog_asset_id: 'asset-1',
  }], canManageImages: true, phase: 'ready' });
  assert.match(html, /<img class="business-catalog-image-preview" src="assets\/products\/t\.webp"/);
  assert.doesNotMatch(html, /Sin imagen aprobada/);
});
