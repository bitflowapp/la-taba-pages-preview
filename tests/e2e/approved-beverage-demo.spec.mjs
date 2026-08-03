import { expect, test } from '@playwright/test';
import { gotoDemoReset, installBrowserStubs, installPageGuards } from './helpers.mjs';
import { products as catalogProducts } from '../../js/approved-beverage-demo-data.js';
import {
  applyRetailCatalogModel,
  getCustomerCatalogProducts,
  normalizeCatalogProduct,
} from '../../js/core/catalog-store.js';

// La góndola ya no es "el catálogo menos lo archivado": desde la decisión
// comercial de publicación minorista, el pack de abastecimiento sale de la
// vista y en su lugar aparece la unidad que representa. Los conteos salen del
// mismo funnel que arma el catálogo del cliente, para que el test siga al
// contrato y no a una lista escrita a mano.
const retailCatalog = applyRetailCatalogModel(
  catalogProducts.map((product) => normalizeCatalogProduct(product)).filter(Boolean),
);
const visibleCatalog = getCustomerCatalogProducts(retailCatalog);
const visibleProducts = visibleCatalog.length;
const pendingProducts = visibleCatalog.filter((product) => product.pricePending).length;
const packProducts = visibleCatalog.filter((product) => Number(product.unitsPerPack) > 1).length;

test('demo aprobado muestra SKU publicables, unidades minoristas y assets locales sin hotlinks', async ({ page }) => {
  const guards = installPageGuards(page);
  const requestedUrls = [];
  page.on('request', (request) => requestedUrls.push(request.url()));
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1#catalog');
  await expect(page.locator('[data-product-grid] .product-card')).toHaveCount(visibleProducts);
  await expect(page.locator('[data-view="catalog"] [data-category-id="mixers"]')).toBeVisible();
  await expect(page.locator('[data-view="catalog"] [data-category-id="energizantes"]')).toBeVisible();

  // Ningún pack de abastecimiento queda en la góndola: el filtro de formato
  // "pack" no devuelve nada.
  expect(packProducts).toBe(0);

  // En su lugar está la unidad, con su presentación y su estado honesto.
  const unidad = page.locator('[data-product-grid] .product-card').filter({
    has: page.locator('[data-add-product="coca-cola-original-pet-1500ml"]'),
  });
  await expect(unidad).toContainText('Coca-Cola Original');
  await expect(unidad).toContainText('1,5 L');
  await expect(unidad).toContainText('Unidad');
  const unidadImagen = unidad.locator('img');
  await expect(unidadImagen).toHaveAttribute('loading', 'lazy');
  // La foto del pack muestra seis botellas: la unidad usa el marcador neutro
  // hasta que el local entregue la suya.
  await expect(unidadImagen).toHaveAttribute('src', /beverage-placeholder\.svg$/);

  const pendingMessage = unidad.locator('[data-price-pending-message]');
  await expect(pendingMessage).toHaveCount(1);
  await expect(pendingMessage).toContainText('Precio próximamente');
  await expect(pendingMessage).toContainText('Este producto todavía no está disponible para compra.');
  const pendingAction = unidad.locator('[data-add-product="coca-cola-original-pet-1500ml"]');
  await expect(pendingAction).toBeDisabled();
  await expect(pendingAction).toHaveText('Precio pendiente');
  await expect(unidad).not.toContainText('$ 0');

  await unidad.locator('[data-product-detail]').click();
  const pendingModal = page.locator('[data-modal-product-id="coca-cola-original-pet-1500ml"]');
  await expect(pendingModal).toBeVisible();
  await expect(pendingModal.locator('[data-price-pending-message]')).toHaveCount(1);
  await expect(pendingModal.locator('[data-price-pending-message]')).toContainText('Precio próximamente');
  await expect(pendingModal.locator('[data-add-product="coca-cola-original-pet-1500ml"]')).toBeDisabled();
  await pendingModal.locator('[data-close-modal]').click();

  const qaMarker = ['q', 'a', '-'].join('');
  const renderedQaReferences = await page.locator(`[data-product-id^="${qaMarker}"], [data-product-sku^="${qaMarker}"], img[src*="/${qaMarker}"]`).count();
  expect(renderedQaReferences).toBe(0);
  expect(requestedUrls.some((url) => url.includes(`/${qaMarker}`))).toBe(false);
  await guards.assertClean();
});

test('carrito arma el pedido con unidades y exige edad para cerveza', async ({ page }) => {
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1#catalog');
  await page.locator('[data-product-grid] [data-add-product="red-bull-original-lata-250ml"]').click();
  await page.locator('[data-open-cart]').first().click();
  await expect(page.locator('[data-view="cart"]')).toContainText('Unidad');
  // El pack de abastecimiento ya no existe como control de compra.
  await expect(page.locator('[data-add-product="coca-cola-original-pet-500ml-pack-12"]')).toHaveCount(0);
  await page.locator('[data-nav-view="catalog"]:visible').first().click();
  await page.locator('[data-view="catalog"] [data-category-id="cervezas"]').click();
  await page.locator('[data-product-grid] [data-add-product="heineken-original-lata-473ml"]').click();
  await expect(page.locator('.topbar .cart-button-count')).toHaveText('3');
  await page.locator('[data-open-cart]').first().click();
  await expect(page.locator('[data-age-confirmation]')).toBeVisible();
  await expect(page.locator('[name="ageConfirmed"]')).toHaveAttribute('required', '');
});

test('filtros comerciales distinguen precio pendiente y formatos reales', async ({ page }) => {
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1#catalog');
  await page.locator('[data-catalog-filters] summary').click();
  await page.locator('[data-catalog-filter="price"]').selectOption('pending');
  await expect(page.locator('[data-product-grid] .product-card')).toHaveCount(pendingProducts);
  await expect(page.locator('[data-product-grid]')).toContainText('Precio próximamente');
});

test('el filtro de formato desaparece: la góndola es toda de unidades', async ({ page }) => {
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1#catalog');
  await page.locator('[data-catalog-filters] summary').click();

  // El panel sólo ofrece un filtro cuando hay más de un valor que elegir. Sin
  // packs en góndola queda un único formato —Unidad— y el campo se retira
  // solo: no hay filtro que devuelva una lista vacía.
  expect(packProducts).toBe(0);
  await expect(page.locator('[data-catalog-filter-field="pack"]')).toBeHidden();
  const formatos = await page.locator('[data-catalog-filter="pack"] option').allTextContents();
  expect(formatos).not.toContain('Pack');

  // Los filtros que sí tienen variedad siguen funcionando.
  await expect(page.locator('[data-catalog-filter-field="price"]')).toBeVisible();
});

test('busqueda normaliza marca y capacidad con puntuacion local', async ({ page }) => {
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1#catalog');
  await page.locator('[data-view="catalog"] [data-search-input]').fill('coca cola 1,5 l');
  // Ahora la búsqueda encuentra las unidades de 1,5 L, no los packs de seis.
  await expect(page.locator('[data-product-grid] .product-card')).toHaveCount(2);
  await expect(page.locator('[data-product-grid]')).toContainText('Coca-Cola Original');
  await expect(page.locator('[data-product-grid]')).toContainText('Coca-Cola Zero');
  await expect(page.locator('[data-product-grid]')).toContainText('Unidad');
});
