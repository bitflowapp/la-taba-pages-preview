import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildCommercialEdit, catalogPublicationReadiness, catalogStockLabel,
  normalizeCatalogProduct, renderCatalogEditor,
} from '../js/business/business-catalog-editor.js';
import { allowedBusinessOperationViews } from '../js/business/business-operations-center.js';

const pending = normalizeCatalogProduct({
  sku: 'coca-cola-original-2250ml-local', name: 'Coca-Cola Sabor Original 2,25 L',
  brand: 'Coca-Cola', price: 0, price_status: 'pending', stock: null,
  available: false, is_verified: false, is_active: true, catalog_origin: 'commercial',
});

test('NULL, cero y cantidad contada conservan tres etiquetas distintas', () => {
  assert.equal(pending.stock, null);
  assert.equal(catalogStockLabel(null), 'Sin contar');
  assert.equal(catalogStockLabel(0), 'Agotado');
  assert.equal(catalogStockLabel(5), '5 unidades');
});

test('campos vacíos no cambian precio ni convierten stock desconocido en cero', () => {
  assert.deepEqual(buildCommercialEdit(pending, { price: '', stock: '' }), { value: null });
});

test('precio y conteo se guardan sin publicar; cero requiere una entrada explícita', () => {
  assert.deepEqual(buildCommercialEdit(pending, { price: '3590', stock: '0' }), {
    value: { sku: pending.sku, price: '3590', stock: 0 },
  });
  assert.deepEqual(buildCommercialEdit(pending, { price: '', stock: '5' }), {
    value: { sku: pending.sku, stock: 5 },
  });
  assert.deepEqual(buildCommercialEdit({ ...pending, price: 3590, priceStatus: 'confirmed', stock: 5 },
    { price: '3590', stock: '5' }), { value: null });
});

test('precio y stock inválidos frenan el lote antes de llamar al servidor', () => {
  assert.match(buildCommercialEdit(pending, { price: '0' }).error, /precio positivo/);
  assert.match(buildCommercialEdit(pending, { stock: '-1' }).error, /entero no negativo/);
  assert.match(buildCommercialEdit(pending, { stock: '5.5' }).error, /entero no negativo/);
});

test('un borrador sin imagen ni verificación no ofrece publicar', () => {
  assert.equal(catalogPublicationReadiness(pending).ready, false);
  const html = renderCatalogEditor({ products: [{
    sku: pending.sku, name: pending.name, brand: pending.brand, price: 0,
    price_status: 'pending', stock: null, available: false, is_verified: false,
    is_active: true, catalog_origin: 'commercial',
  }], phase: 'ready' });
  assert.match(html, /Sin contar/);
  assert.match(html, /Precio pendiente/);
  assert.match(html, /No disponible · borrador/);
  assert.match(html, /Imagen pendiente/);
  assert.match(html, /data-catalog-search/);
  assert.doesNotMatch(html, /data-publish="true"/);
});

test('sólo una ficha confirmada, contada, con foto y verificada ofrece publicar', () => {
  const ready = { ...pending, price: 3590, priceStatus: 'confirmed', stock: 5,
    verified: true, hasApprovedImage: true };
  assert.equal(catalogPublicationReadiness(ready).ready, true);
  assert.equal(catalogPublicationReadiness({ ...ready, alcoholic: true }).ready, false);
});

test('la vista puede dibujar los 46 borradores del lote sin esconder SKU', () => {
  const candidates = JSON.parse(readFileSync(new URL('../docs/catalog/catalog-source-2026-09.json', import.meta.url), 'utf8')).products;
  const html = renderCatalogEditor({ products: candidates.map((candidate) => ({
    sku: candidate.sku, name: candidate.product, brand: candidate.brand,
    category: candidate.category, price: 0, price_status: 'pending', stock: null,
    available: false, is_verified: false, is_active: true, catalog_origin: 'commercial',
  })), phase: 'ready' });
  assert.equal((html.match(/data-catalog-row=/g) || []).length, 46);
  assert.equal((html.match(/data-catalog-stock/g) || []).length, 46);
  assert.doesNotMatch(html, /data-publish="true"/);
});

test('Catálogo comercial aparece sólo para owner y admin', () => {
  assert.ok(allowedBusinessOperationViews('owner').includes('catalog'));
  assert.ok(allowedBusinessOperationViews('admin').includes('catalog'));
  assert.ok(!allowedBusinessOperationViews('staff').includes('catalog'));
});
