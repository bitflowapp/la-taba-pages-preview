import { expect, test } from '@playwright/test';
import { fillCheckout, installPageGuards, waitForToast } from './helpers.mjs';

// Stub que limpia el storage SOLO en la primera carga del contexto, para poder
// probar la persistencia tras recargar la página.
async function installPersistentStubs(page) {
  await page.addInitScript(() => {
    window.__openedUrls = window.__openedUrls || [];
    window.open = (...args) => {
      window.__openedUrls.push(String(args[0] || ''));
      return null;
    };
    try {
      if (!window.sessionStorage.getItem('__pw_booted')) {
        window.localStorage.clear();
        window.sessionStorage.clear();
        window.sessionStorage.setItem('__pw_booted', '1');
      }
    } catch (_) {
      /* no-op */
    }
  });
}

async function createDeliveryOrder(page) {
  await page.locator('.desktop-nav [data-nav-view="catalog"]').click();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.locator('.desktop-nav [data-nav-view="cart"]').click();
  await fillCheckout(page, {
    name: 'Rider QA',
    phone: '2995550000',
    address: 'Roca 123',
    notes: 'Tocar timbre',
    payment: 'cash',
    deliveryMode: 'delivery',
  });
  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, 'Pedido creado. Simulación en este dispositivo.');
}

test('persistencia del pedido tras recargar la página', async ({ page }) => {
  await installPersistentStubs(page);

  await page.goto('/?demo=1');
  await createDeliveryOrder(page);
  await expect(page.locator('[data-tracking-panel]')).toContainText('LT-0002');

  // Recargar: el storage NO se limpia y el pedido debe seguir disponible.
  await page.reload();
  await expect(page.locator('[data-cart-count]')).toHaveText('0');
  await page.locator('.desktop-nav [data-nav-view="tracking"]').click();
  await expect(page.locator('[data-view="tracking"]')).toBeVisible();
  await expect(page.locator('[data-tracking-panel]')).toContainText('LT-0002');
});

test('el modo demo no ofrece GPS ni simula movimiento', async ({ page }) => {
  await installPersistentStubs(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
  });

  await page.goto('/?demo=1');
  await createDeliveryOrder(page);

  await page.locator('[data-admin-toggle]').click();
  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  await page.locator('[data-order-advance="LT-0002"]').click();
  await page.locator('[data-order-advance="LT-0002"]').click();
  await page.getByRole('button', { name: /Vista rider/i }).click();

  // Sin compartir GPS el rider no ve mapa (no hay ubicación real).
  await expect(page.locator('[data-delivery-panel] [data-real-map]')).toHaveCount(0);

  await expect(page.locator('[data-delivery-panel]')).toContainText('No se usa GPS, ETA ni ubicación en vivo.');
  await expect(page.locator('[data-delivery-panel] [data-sim-gps], [data-delivery-panel] [data-sim-gps-off]')).toHaveCount(0);
  await expect(page.locator('[data-delivery-panel] [data-real-map]')).toHaveCount(0);
});
