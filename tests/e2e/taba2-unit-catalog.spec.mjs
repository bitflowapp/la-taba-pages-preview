// Presentación minorista a lo largo del flujo de compra.
//
// El modelo separa compra de venta en `js/core/retail-packaging.js`; acá se
// verifica lo único que le importa al cliente: que vea la unidad que compra,
// con su contenido y su precio, y que ningún dato del proveedor —costo,
// multiplicador de compra, nombre mayorista— se filtre a la pantalla.
import { expect, test } from '@playwright/test';
import { gotoDemoReset, installBrowserStubs, installPageGuards } from './helpers.mjs';

const PHONE = { width: 390, height: 844 };

async function openHome(page, viewport = PHONE) {
  await page.setViewportSize(viewport);
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await page.waitForSelector('[data-view="home"] .home-best-card');
}

async function openCatalog(page) {
  await page.evaluate(() => { window.location.hash = '#catalog'; });
  await page.waitForSelector('[data-view="catalog"]:not([hidden]) [data-product-grid] .product-card');
}

test('la góndola no repite una tarjeta comprable idéntica a otra', async ({ page }) => {
  const guards = installPageGuards(page);
  await openHome(page);
  await openCatalog(page);

  const firmas = await page.evaluate(() => [...document.querySelectorAll('[data-product-grid] .product-card')]
    .filter((card) => card.querySelector('[data-add-product]:not([disabled])'))
    .map((card) => card.innerText.replace(/\s+/g, ' ').trim()));

  expect(firmas.length).toBeGreaterThan(0);
  expect(new Set(firmas).size, 'dos tarjetas comprables con el mismo texto').toBe(firmas.length);

  // Las dos latas de Speed dejaron de ser indistinguibles.
  await expect(page.locator('[data-product-grid] .product-card', { hasText: 'Speed Unlimited Original' })).toHaveCount(1);
  await expect(page.locator('[data-product-grid] .product-card', { hasText: 'Speed Unlimited Zero Sugar' })).toHaveCount(1);
  await guards.assertClean();
});

test('ningún nombre visible arrastra el empaque del proveedor', async ({ page }) => {
  const guards = installPageGuards(page);
  await openHome(page);
  await openCatalog(page);

  const nombres = await page.evaluate(() => [...document.querySelectorAll('[data-product-grid] .product-card h3')]
    .map((node) => node.textContent.trim()));
  expect(nombres.length).toBeGreaterThan(0);
  for (const nombre of nombres) {
    expect(nombre, `nombre público con logística: ${nombre}`).not.toMatch(/\bpack\b|\bcaja\b|\bbulto\b|\bbandeja\b|\bx\s?\d{1,3}\b/i);
  }
  await guards.assertClean();
});

test('el carrito y el checkout muestran la presentación minorista y el precio de esa presentación', async ({ page }) => {
  const guards = installPageGuards(page);
  await openHome(page);
  await openCatalog(page);

  // Una lata suelta: la unidad que compra el cliente.
  await page.locator('[data-view="catalog"] [data-product-grid] [data-add-product="heineken-original-lata-473ml"]').first().click();
  await page.locator('[data-open-cart]').first().click();
  await expect(page.locator('[data-view="cart"]')).toBeVisible();

  const linea = page.locator('[data-cart-list] li, [data-cart-list] article, [data-cart-list] > *').first();
  await expect(linea).toContainText('Heineken');
  await expect(linea).toContainText('Unidad');
  await expect(linea).toContainText('$ 3.900');
  await expect(linea).not.toContainText('Pack');

  // El resumen del checkout habla del mismo producto y del mismo importe.
  await expect(page.locator('[data-order-summary]')).toContainText('$ 3.900');
  await guards.assertClean();
});

test('ningún pack de abastecimiento queda en la góndola ni se puede pedir', async ({ page }) => {
  const guards = installPageGuards(page);
  await openHome(page);
  await openCatalog(page);

  // Decisión comercial: el pack abastece al local, el cliente compra la
  // unidad. Ninguna tarjeta comprable declara un formato de pack.
  await expect(page.locator('[data-product-grid] [data-add-product="coca-cola-original-pet-1500ml-pack-6"]')).toHaveCount(0);
  const packsEnGondola = await page.evaluate(() => [...document.querySelectorAll('[data-product-grid] .product-card')]
    .filter((card) => /pack x\d/i.test(card.innerText))
    .map((card) => ({
      texto: card.innerText.replace(/\s+/g, ' ').trim().slice(0, 60),
      comprable: Boolean(card.querySelector('[data-add-product]:not([disabled])')),
    })));
  // Única excepción admitida: el producto de empaque contradictorio, que no se
  // convierte por regla —sin multiplicador confiable no hay unidad que
  // derivar— y que por no tener precio tampoco se puede comprar.
  expect(packsEnGondola.length).toBeLessThanOrEqual(1);
  for (const pack of packsEnGondola) expect(pack.comprable, pack.texto).toBe(false);

  // Y en su lugar está la unidad de 1,5 L, esperando precio.
  const unidad = page.locator('[data-product-grid] .product-card').filter({
    has: page.locator('[data-add-product="coca-cola-original-pet-1500ml"]'),
  });
  await expect(unidad).toContainText('1,5 L');
  await expect(unidad).toContainText('Unidad');
  await expect(unidad).toContainText('Precio próximamente');
  await expect(unidad.locator('[data-add-product]')).toBeDisabled();
  await guards.assertClean();
});

test('el pack de compra no se ofrece como si fuera la unidad de venta', async ({ page }) => {
  const guards = installPageGuards(page);
  await openHome(page);
  await openCatalog(page);

  // El pack x4 de Red Bull existe como referencia, sin precio y sin compra:
  // la unidad que se vende es la lata suelta, que sí tiene precio.
  const packBoton = page.locator('[data-view="catalog"] [data-product-grid] [data-add-product="red-bull-original-lata-250ml-pack-4"]');
  if (await packBoton.count()) await expect(packBoton.first()).toBeDisabled();
  await expect(page.locator('[data-view="catalog"] [data-product-grid] [data-add-product="red-bull-original-lata-250ml"]').first()).toBeEnabled();

  const packCard = page.locator('[data-product-grid] .product-card').filter({ has: packBoton });
  if (await packCard.count()) {
    await expect(packCard.first()).toContainText('Precio próximamente');
    await expect(packCard.first()).not.toContainText('$ 0');
  }
  await guards.assertClean();
});

test('la pantalla nunca muestra costo, proveedor ni multiplicador de compra', async ({ page }) => {
  const guards = installPageGuards(page);
  await openHome(page);

  const recorrer = async () => {
    const texto = await page.evaluate(() => document.body.innerText);
    expect(texto).not.toMatch(/proveedor|costo de compra|precio mayorista|supplier|units per pack|unidades por caja/i);
  };

  await recorrer();
  await openCatalog(page);
  await recorrer();
  await page.locator('[data-view="catalog"] [data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.locator('[data-open-cart]').first().click();
  await recorrer();

  // Y tampoco viaja en el DOM: el bloque de compra es interno.
  const filtrado = await page.evaluate(() => document.documentElement.outerHTML);
  expect(filtrado).not.toMatch(/supplierPackCost|supplierProductName|unitsPerPurchasePack/);
  await guards.assertClean();
});

test('la búsqueda encuentra la unidad por su nombre completo y el favorito sigue resolviendo', async ({ page }) => {
  const guards = installPageGuards(page);
  await openHome(page);
  await openCatalog(page);

  const buscador = page.locator('[data-view="catalog"] [data-search-input]').first();
  await buscador.fill('speed unlimited zero');
  await expect(page.locator('[data-product-grid] .product-card')).toHaveCount(1);
  await expect(page.locator('[data-product-grid] .product-card').first()).toContainText('Zero Sugar');

  // El favorito se guarda por id. La normalización no toca ids ni skus —eso lo
  // fija la prueba unitaria del modelo—, así que el guardado sigue resolviendo
  // al mismo producto después de navegar. (La recarga no sirve como evidencia
  // acá: `installBrowserStubs` limpia el almacenamiento en cada navegación.)
  const favorito = page.locator('[data-product-grid] .product-card [data-favorite-toggle]').first();
  const favoritoId = await favorito.getAttribute('data-favorite-toggle');
  expect(favoritoId).toBe('speed-zero-lata-473ml');
  await favorito.click();

  await page.locator('.mobile-nav [data-nav-view="home"]').click();
  await expect(page.locator('[data-view="home"]')).toBeVisible();
  await openCatalog(page);
  await page.locator('[data-view="catalog"] [data-search-input]').first().fill('');
  await page.locator('[data-view="catalog"] [data-category-id="favorites"]').click();
  await expect(page.locator('[data-product-grid] .product-card')).toHaveCount(1);
  await expect(page.locator('[data-product-grid] .product-card').first()).toContainText('Speed Unlimited Zero Sugar');
  await guards.assertClean();
});

test('el deep link a un producto sigue resolviendo tras la normalización', async ({ page }) => {
  const guards = installPageGuards(page);
  await openHome(page);
  await openCatalog(page);

  await page.locator('[data-view="catalog"] [data-product-grid] [data-product-detail="heineken-original-lata-473ml"]').first().click();
  const modal = page.locator('[data-product-modal]');
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('Heineken');
  await expect(modal).toContainText('473 ml');
  await expect(modal).toContainText('$ 3.900');
  await guards.assertClean();
});

test('a 320 y 432 la presentación minorista se lee sin overflow', async ({ page }) => {
  for (const viewport of [{ width: 320, height: 568 }, { width: 432, height: 960 }]) {
    await openHome(page, viewport);
    await openCatalog(page);
    const card = page.locator('[data-product-grid] .product-card').first();
    await expect(card).toContainText('$');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `overflow a ${viewport.width}px`).toBeLessThanOrEqual(1);
  }
});
