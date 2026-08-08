import { expect, test } from '@playwright/test';
import { fillCheckout, gotoDemoReset, installBrowserStubs, installPageGuards, seedCartAboveMinimum, waitForToast } from './helpers.mjs';

const TRACKING_GPS_NOTE = 'El pedido sigue en el local. La ubicación aparecerá cuando comience el reparto.';
const OUT_FOR_DELIVERY_GPS_NOTE = 'El rider está en camino. La ubicación aparecerá cuando esté disponible.';

// Garantiza que sin GPS real el mapa no muestra geografía inventada
// (ni ruta, ni marcadores LT/CL, ni "En vivo", ni Map/km/ETA falsos) y que el
// negocio expone su dirección textual real.

test('sin GPS real: el tracking es honesto (sin mapa, ruta ni puntos falsos)', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const guards = installPageGuards(page);
  await installBrowserStubs(page);

  await gotoDemoReset(page, '/?reset=1&demo=1');
  await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
  await seedCartAboveMinimum(page);
  await page.locator('[data-floating-cart]').click();
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
  await waitForToast(page, 'Pedido confirmado. Seguilo en Seguimiento.');
  await expect(page.locator('[data-view="tracking"]')).toBeVisible();

  const tracking = page.locator('[data-tracking-panel]');

  // Dirección textual real cargada por el cliente.
  await expect(tracking).toContainText('Mendoza 851, Centro');
  await expect(tracking).toContainText('Casa azul');

  // La confirmación inicial usa copy comercial sin afirmar una recepción remota.
  await expect(tracking.locator('.tracking-hero h1')).toHaveText('Tu pedido fue confirmado');
  await expect(tracking).not.toContainText(/pedido de muestra|no se envió|presentación/i);
  await expect(tracking.locator('[data-tracking-gps-note]')).toHaveText(TRACKING_GPS_NOTE);
  await expect(tracking).not.toContainText('En vivo');

  // No hay mapa montado, fallback en inglés, manija, marcadores falsos (LT/CL) ni ruta sin GPS real.
  await expect(tracking.locator('[data-real-map]')).toHaveCount(0);
  await expect(tracking.locator('.map-marker')).toHaveCount(0);
  await expect(tracking.locator('.lt-rider-marker')).toHaveCount(0);
  await expect(tracking.locator('.map-route')).toHaveCount(0);
  await expect(tracking.locator('.sheet-handle')).toHaveCount(0);
  await expect(tracking).not.toContainText(/\bMap\b/);

  // Una muestra recién creada no afirma que el local la recibió.
  await expect(tracking).not.toContainText('Recibido');
  await expect(tracking.locator('.sheet-head .status-chip')).toHaveCount(0);

  // No hay kilómetros ni ETA inventados. El tiempo estimado textual puede existir si el pedido lo trae.
  const text = await tracking.innerText();
  expect(text).not.toMatch(/\d+([.,]\d+)?\s*km/i);
  expect(text).not.toMatch(/\bETA\b/i);

  // En camino sin GPS: header y hero comerciales, política GPS sólo en la nota única.
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

  await expect(tracking.locator('.tracking-brand-row > strong')).toHaveText('La Taba 2');
  await expect(tracking.getByRole('button', { name: 'Abrir menú' })).toBeVisible();
  await expect(tracking.locator('.tracking-hero h1')).toHaveText('Tu pedido está en camino');
  await expect(tracking.locator('.tracking-hero')).not.toContainText(/GPS|mapa|no mostramos/i);
  await expect(tracking.locator('.customer-progress .track-step')).toHaveCount(4);
  await expect(tracking.locator('.customer-progress')).toContainText('Confirmado');
  await expect(tracking.locator('.customer-progress')).toContainText('Preparando');
  await expect(tracking.locator('.customer-progress')).toContainText('En camino');
  await expect(tracking.locator('.customer-progress')).toContainText('Entregado');
  await expect(tracking.locator('[data-tracking-gps-note]')).toHaveCount(1);
  await expect(tracking.locator('[data-tracking-gps-note]')).toHaveText(OUT_FOR_DELIVERY_GPS_NOTE);
  await expect(tracking.locator('[data-real-map]')).toHaveCount(0);
  await expect(tracking.locator('[data-delivery-code-card]')).toHaveCount(0);
  await expect(tracking.locator('.sheet-handle')).toHaveCount(0);

  // No hay overflow horizontal en 390x844.
  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(noOverflow).toBeTruthy();

  await guards.assertClean();
  await context.close();
});

// La dirección POSTAL y la COORDENADA salen las dos del contrato central
// (data/business-location.json) desde el 2026-08-08; antes la coordenada estaba
// escrita a mano en cuatro lugares y caía a 793 m de la puerta. Lo que este test
// cuida sigue siendo lo mismo: que la ficha publique la dirección que declara la
// config, y que la vista de perfil no dibuje un marcador de local por su cuenta.
test('el local publica su dirección desde la config y no inventa su ubicación en el mapa', async ({ page }) => {
  await installBrowserStubs(page);
  const guards = installPageGuards(page);
  await page.goto('/?demo=1#profile');
  await expect(page.locator('[data-view="profile"]')).toBeVisible();
  await expect(page.locator('[data-business-address]').first()).toContainText('Mendoza 827, Neuquén');
  const businessMarkers = await page.evaluate(() => (
    document.querySelectorAll('[data-map-role*="business"], .map-marker-business').length
  ));
  expect(businessMarkers).toBe(0);
  await guards.assertClean();
});
