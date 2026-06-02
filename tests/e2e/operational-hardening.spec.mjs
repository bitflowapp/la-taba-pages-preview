import { expect, test } from '@playwright/test';
import { fillCheckout, installBrowserStubs, installPageGuards, waitForToast } from './helpers.mjs';

// Hardening operativo v1: invariantes que NO deben romperse en producción.

function liveTrackingState(now) {
  const createdAt = new Date(now - 90_000).toISOString();
  const fixAt = new Date(now - 2_000).toISOString();
  const location = {
    lat: -38.9462, lng: -68.0418, accuracy: 8, heading: 95,
    timestamp: now - 2_000, lastFixAt: fixAt, source: 'gps', gpsStatus: 'active',
  };
  return {
    orders: [{
      id: 'LT-LIVE-1', customerName: 'Marco Luna', customerPhone: '2996209136',
      address: 'Mendoza 851, Centro',
      addressDetails: { streetLine: 'Mendoza 851', neighborhood: 'Centro', reference: 'Casa azul', label: 'Mendoza 851, Centro' },
      deliveryMode: 'delivery', paymentMethod: 'Efectivo', notes: 'Tocar timbre',
      createdAt, status: 'on_the_way',
      items: [{ productId: 'p-vacio', name: 'Vacío premium', icon: '', quantity: 1, unitPrice: 31890, unit: 'kg' }],
      subtotal: 31890, deliveryFee: 0, total: 31890,
      statusHistory: [
        { status: 'received', at: createdAt }, { status: 'preparing', at: createdAt },
        { status: 'ready', at: createdAt }, { status: 'on_the_way', at: createdAt },
      ],
      delivery: { driverName: 'Sin asignar', driverPhone: '', currentLocationLabel: 'En camino' },
      tracking: { lastLocation: location, updatedAt: fixAt },
    }],
    lastOrderId: 'LT-LIVE-1', cart: [],
    simulation: {
      orderId: 'LT-LIVE-1', running: false, mode: 'gps', source: 'gps',
      routeId: 'neuquen-centro', timestamp: now - 2_000, lastFixAt: fixAt,
      lastGpsFixAt: fixAt, lastPublishedAt: fixAt, gpsStatus: 'active',
      lat: location.lat, lng: location.lng, accuracy: location.accuracy, heading: location.heading,
    },
  };
}

test('con GPS real válido el marker es el disco "R" limpio (sin casco/moto/rojo)', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const guards = installPageGuards(page);
  await page.addInitScript((state) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('la_taba_mvp_v4_state', JSON.stringify(state));
  }, liveTrackingState(Date.now()));

  await page.goto('/#tracking');
  await expect(page.locator('[data-view="tracking"]')).toBeVisible();

  const tracking = page.locator('[data-tracking-panel]');
  // Mapa + marker premium presente y centrado dentro del mapa.
  await expect(tracking.locator('[data-real-map]')).toHaveCount(1);
  const marker = tracking.locator('.lt-rider-marker');
  await expect(marker).toHaveCount(1, { timeout: 10_000 });
  // Es el disco simple con la letra R.
  await expect(marker.locator('.lt-rider-core-letter')).toHaveText('R');
  // NO reintroduce el marker viejo: nada de moto/casco/ruedas.
  await expect(tracking.locator('.lt-rider-moto-core, .lt-rider-box, .lt-rider-wheel, .lt-rider-frame')).toHaveCount(0);

  // Marker centrado dentro del recuadro del mapa.
  const mapBox = await tracking.locator('[data-real-map]').boundingBox();
  const markerBox = await marker.boundingBox();
  expect(markerBox.x).toBeGreaterThan(mapBox.x);
  expect(markerBox.x + markerBox.width).toBeLessThan(mapBox.x + mapBox.width);
  expect(markerBox.y).toBeGreaterThan(mapBox.y);
  expect(markerBox.y + markerBox.height).toBeLessThan(mapBox.y + mapBox.height);

  // Sin overflow horizontal ni errores JS fatales.
  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(noOverflow).toBeTruthy();
  await guards.assertClean();
  await context.close();
});

test('?reset=1 limpia el pedido previo y deja el tracking en estado vacío honesto', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const guards = installPageGuards(page);
  await installBrowserStubs(page);

  // 1. Crear un pedido real.
  await page.goto('/?reset=1');
  await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.locator('.mobile-nav [data-nav-view="cart"]').click();
  await fillCheckout(page, {
    name: 'Reset QA', phone: '2995550000', street: 'Mendoza 851', neighborhood: 'Centro',
    reference: 'Casa azul', notes: 'Tocar timbre', payment: 'cash', deliveryMode: 'delivery',
  });
  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, 'Pedido creado. Ya podés seguirlo en tiempo real.');
  await expect(page.locator('[data-tracking-panel]')).toContainText('LT-0002');

  // 2. Abrir con ?reset=1 => arranca limpio (recarga a URL sin el parámetro).
  await page.goto('/?reset=1');
  await expect(page.locator('[data-view="home"]')).toBeVisible();
  await expect(page).toHaveURL(/#?$|\/$|index/);

  // 3. El pedido viejo ya no existe: tracking vacío honesto, sin mapa ni marker.
  await page.goto('/#tracking');
  const tracking = page.locator('[data-tracking-panel]');
  await expect(tracking).toContainText('No hay un pedido activo');
  await expect(tracking).not.toContainText('LT-0002');
  await expect(tracking.locator('[data-real-map]')).toHaveCount(0);
  await expect(tracking.locator('.lt-rider-marker')).toHaveCount(0);

  await guards.assertClean();
  await context.close();
});
