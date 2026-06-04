import { expect, test } from '@playwright/test';
import { fillCheckout, installBrowserStubs, installPageGuards, waitForToast } from './helpers.mjs';

// Garantiza que sin GPS real el mapa no muestra geografía inventada
// (ni ruta, ni marcadores LT/CL, ni "En vivo", ni km/ETA falsos) y que el
// negocio expone su dirección textual real.

test('sin GPS real: el tracking es honesto (sin mapa, ruta ni puntos falsos)', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const guards = installPageGuards(page);
  await installBrowserStubs(page);

  await page.goto('/?reset=1');
  await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.locator('.mobile-nav [data-nav-view="cart"]').click();
  await fillCheckout(page, {
    name: 'Cliente Honesto',
    phone: '2995550000',
    street: 'Mendoza 851',
    neighborhood: 'Centro',
    reference: 'Casa azul',
    notes: 'Tocar timbre',
    payment: 'cash',
    deliveryMode: 'delivery',
  });
  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, 'Pedido creado. Ya podés seguirlo en tiempo real.');
  await expect(page.locator('[data-view="tracking"]')).toBeVisible();

  const tracking = page.locator('[data-tracking-panel]');

  // Dirección textual real cargada por el cliente.
  await expect(tracking).toContainText('Mendoza 851, Centro');
  await expect(tracking).toContainText('Casa azul');

  // Honesto: sin GPS en vivo y sin "En vivo".
  await expect(tracking).toContainText('Sin GPS en vivo');
  await expect(tracking).not.toContainText('En vivo');

  // No hay mapa montado ni marcadores falsos (LT/CL) ni ruta sin GPS real.
  await expect(tracking.locator('[data-real-map]')).toHaveCount(0);
  await expect(tracking.locator('.map-marker')).toHaveCount(0);

  // No hay kilómetros inventados. El tiempo estimado textual puede existir si el pedido lo trae.
  const text = await tracking.innerText();
  expect(text).not.toMatch(/\d+([.,]\d+)?\s*km/i);

  // No hay overflow horizontal en 390x844.
  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(noOverflow).toBeTruthy();

  await guards.assertClean();
  await context.close();
});

test('el local muestra la dirección real Mendoza 845/851', async ({ page }) => {
  await installBrowserStubs(page);
  const guards = installPageGuards(page);
  await page.goto('/#profile');
  await expect(page.locator('[data-view="profile"]')).toBeVisible();
  await expect(page.locator('[data-business-address]')).toContainText('Mendoza 845/851');
  await guards.assertClean();
});
