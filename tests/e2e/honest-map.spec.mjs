import { expect, test } from '@playwright/test';
import { fillCheckout, installBrowserStubs, installPageGuards, waitForToast } from './helpers.mjs';

const TRACKING_GPS_NOTE = 'Seguimiento por estados, sin GPS ni ubicación en vivo.';

// Garantiza que sin GPS real el mapa no muestra geografía inventada
// (ni ruta, ni marcadores LT/CL, ni "En vivo", ni Map/km/ETA falsos) y que el
// negocio expone su dirección textual real.

test('sin GPS real: el tracking es honesto (sin mapa, ruta ni puntos falsos)', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const guards = installPageGuards(page);
  await installBrowserStubs(page);

  await page.goto('/?reset=1&demo=1');
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
  await waitForToast(page, 'Pedido creado. Simulación en este dispositivo.');
  await expect(page.locator('[data-view="tracking"]')).toBeVisible();

  const tracking = page.locator('[data-tracking-panel]');

  // Dirección textual real cargada por el cliente.
  await expect(tracking).toContainText('Mendoza 851, Otra localidad');
  await expect(tracking).toContainText('Casa azul');

  // Honesto: una sola nota de confianza y sin "En vivo".
  await expect(tracking.locator('[data-tracking-gps-note]')).toHaveCount(1);
  await expect(tracking.locator('[data-tracking-gps-note]')).toHaveText(TRACKING_GPS_NOTE);
  await expect(tracking).not.toContainText('En vivo');

  // No hay mapa montado, fallback en inglés, manija, marcadores falsos (LT/CL) ni ruta sin GPS real.
  await expect(tracking.locator('[data-real-map]')).toHaveCount(0);
  await expect(tracking.locator('.map-marker')).toHaveCount(0);
  await expect(tracking.locator('.lt-rider-marker')).toHaveCount(0);
  await expect(tracking.locator('.map-route')).toHaveCount(0);
  await expect(tracking.locator('.sheet-handle')).toHaveCount(0);
  await expect(tracking).not.toContainText(/\bMap\b/);

  // Estado visible amable y consistente con Negocio/Rider: "Recibido" para el estado inicial.
  await expect(tracking).toContainText('Recibido');
  await expect(tracking.locator('.sheet-head .status-chip')).toHaveCount(0);

  // No hay kilómetros ni ETA inventados. El tiempo estimado textual puede existir si el pedido lo trae.
  const text = await tracking.innerText();
  expect(text).not.toMatch(/\d+([.,]\d+)?\s*km/i);
  expect(text).not.toMatch(/\bETA\b/i);

  // En reparto sin GPS: hero humano, política GPS sólo en la nota única.
  await page.evaluate(async () => {
    const { updateState } = await import('/js/state.js');
    updateState((draft) => {
      const order = draft.orders?.find((candidate) => candidate.id === draft.lastOrderId) || draft.orders?.[0];
      if (!order) return;
      const now = new Date().toISOString();
      order.status = 'on_the_way';
      order.statusHistory = [...(order.statusHistory || []), { status: 'on_the_way', at: now }];
      order.delivery = {
        ...(order.delivery || {}),
        currentLocationLabel: 'El pedido salió del local',
        estimatedMinutes: 18,
      };
      delete order.tracking;
      draft.simulation = null;
    });
  });

  await expect(tracking.locator('.sheet-head')).toContainText('Tu pedido salió del local y va camino a tu dirección.');
  await expect(tracking.locator('.sheet-head')).not.toContainText(/GPS|mapa|no mostramos/i);
  await expect(tracking.locator('[data-tracking-gps-note]')).toHaveCount(1);
  await expect(tracking.locator('[data-tracking-gps-note]')).toHaveText(TRACKING_GPS_NOTE);
  await expect(tracking.locator('[data-real-map]')).toHaveCount(0);
  await expect(tracking.locator('.sheet-handle')).toHaveCount(0);

  // No hay overflow horizontal en 390x844.
  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(noOverflow).toBeTruthy();

  await guards.assertClean();
  await context.close();
});

test('el local no inventa una dirección todavía no verificada', async ({ page }) => {
  await installBrowserStubs(page);
  const guards = installPageGuards(page);
  await page.goto('/?demo=1#profile');
  await expect(page.locator('[data-view="profile"]')).toBeVisible();
  await expect(page.locator('[data-business-address]').first()).toContainText('Dirección a confirmar con el local');
  await guards.assertClean();
});
