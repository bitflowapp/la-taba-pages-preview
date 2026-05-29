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

async function readPercent(locator) {
  const text = (await locator.textContent()) || '0';
  return Number.parseInt(text.replace('%', '').trim(), 10) || 0;
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
  await waitForToast(page, 'Pedido creado. Ya podés seguirlo en tiempo real.');
}

test('rider demo: iniciar simulación, avanzar, llegar y entregar', async ({ page }) => {
  await installPersistentStubs(page);
  const guards = installPageGuards(page);

  await page.goto('/');
  await createDeliveryOrder(page);

  // El negocio marca el pedido como listo para que aparezca en la vista rider.
  await page.locator('[data-admin-toggle]').click();
  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  await expect(page.locator('[data-view="business"]')).toBeVisible();
  await page.locator('[data-order-advance="LT-0002"]').click();
  await waitForToast(page, 'Estado del pedido actualizado.');
  await page.locator('[data-order-advance="LT-0002"]').click();
  await waitForToast(page, 'Estado del pedido actualizado.');

  // Abrir la vista del repartidor.
  await page.getByRole('button', { name: /Vista rider/i }).click();
  await expect(page.locator('[data-view="rider"]')).toBeVisible();
  await expect(page.locator('[data-delivery-panel]')).toContainText('LT-0002');

  // Iniciar simulación y verificar que el progreso avanza.
  const progress = page.locator('[data-sim-progress]');
  const initial = await readPercent(progress);
  await page.locator('[data-sim-start]').click();
  await waitForToast(page, /Simulación iniciada/);
  await expect.poll(async () => readPercent(progress), { timeout: 15_000 }).toBeGreaterThan(initial);
  await expect(page.locator('[data-delivery-panel]')).toContainText(/En camino|Llegando/);

  // Llegué al domicilio.
  await page.locator('[data-delivery-arrive="LT-0002"]').click();
  await waitForToast(page, 'Llegada al domicilio registrada.');
  await expect(page.locator('[data-delivery-panel]')).toContainText('Llegando');

  // Pedido entregado. El rider deja de mostrar LT-0002 y pasa al siguiente en cola.
  await page.locator('[data-delivery-done="LT-0002"]').click();
  await waitForToast(page, 'Pedido marcado como entregado.');
  await expect(page.locator('[data-delivery-panel]')).not.toContainText('LT-0002');

  await guards.assertClean();
});

test('persistencia del pedido tras recargar la página', async ({ page }) => {
  await installPersistentStubs(page);

  await page.goto('/');
  await createDeliveryOrder(page);
  await expect(page.locator('[data-tracking-panel]')).toContainText('LT-0002');

  // Recargar: el storage NO se limpia y el pedido debe seguir disponible.
  await page.reload();
  await expect(page.locator('[data-cart-count]')).toHaveText('0');
  await page.locator('.desktop-nav [data-nav-view="tracking"]').click();
  await expect(page.locator('[data-view="tracking"]')).toBeVisible();
  await expect(page.locator('[data-tracking-panel]')).toContainText('LT-0002');
});
