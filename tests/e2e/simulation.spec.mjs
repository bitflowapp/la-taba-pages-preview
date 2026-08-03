import { expect, test } from '@playwright/test';
import { fillCheckout, installPageGuards, seedCartAboveMinimum, waitForToast } from './helpers.mjs';

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
  await seedCartAboveMinimum(page);
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
  await waitForToast(page, 'Pedido confirmado. Seguilo en Seguimiento.');
}

test('persistencia del pedido tras recargar la página', async ({ page }) => {
  await installPersistentStubs(page);

  await page.goto('/?demo=1');
  await createDeliveryOrder(page);
  await expect(page.locator('[data-tracking-panel]')).toContainText('LT-0002');

  // Recargar: el storage NO se limpia y el pedido debe seguir disponible.
  await page.reload();
  await expect(page.locator('[data-cart-count]').first()).toHaveText('0');
  await page.goto('/?demo=1#tracking');
  await expect(page.locator('[data-view="tracking"]')).toBeVisible();
  await expect(page.locator('[data-tracking-panel]')).toContainText('LT-0002');
});

test('el modo demo ofrece GPS local y recorrido geográfico de respaldo', async ({ page }) => {
  await installPersistentStubs(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
  });

  await page.goto('/?demo=1');
  await createDeliveryOrder(page);

  await page.evaluate(() => { window.location.hash = '#business'; });
  await page.locator('[data-open-pin][data-admin-target="business"]').click();
  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  await page.locator('[data-order-advance="LT-0002"]').click();
  await page.locator('[data-order-advance="LT-0002"]').click();
  await page.getByRole('button', { name: /Vista rider/i }).click();

  // Sin compartir GPS el rider no ve mapa (no hay ubicación real).
  await expect(page.locator('[data-delivery-panel] [data-real-map]')).toHaveCount(0);

  await expect(page.locator('[data-rider-assignment-preview="LT-0002"]')).toBeVisible();
  await page.locator('[data-rider-accept="LT-0002"]').click();
  await expect(page.locator('[data-delivery-panel]')).toContainText('Entrega aceptada.');
  await expect(page.locator('[data-delivery-panel] [data-sim-gps]')).toHaveCount(0);
  await page.locator('[data-delivery-leave="LT-0002"]').click();
  await waitForToast(page, 'Pedido marcado como en camino.');
  await expect(page.locator('[data-delivery-panel] [data-sim-gps]')).toHaveCount(1);
  await expect(page.locator('[data-delivery-panel] [data-real-map]')).toHaveCount(0);
  await page.locator('[data-delivery-panel] [data-sim-start]').click();
  await expect(page.locator('[data-delivery-panel] [data-real-map][data-map-source="sandbox"][data-map-engine="maplibre"]')).toHaveCount(1);
  await expect(page.locator('[data-delivery-panel] [data-real-map][data-map-status="ready"][data-route-source="simulation"]')).toHaveCount(1, { timeout: 15_000 });
});

test('abandono de rider y pagehide cortan el watchPosition local', async ({ page }) => {
  await installPersistentStubs(page);
  await page.addInitScript(() => {
    window.__gpsLifecycle = { watches: [], cleared: [] };
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        watchPosition() {
          const id = 700 + window.__gpsLifecycle.watches.length + 1;
          window.__gpsLifecycle.watches.push(id);
          return id;
        },
        clearWatch(id) {
          window.__gpsLifecycle.cleared.push(id);
        },
      },
    });
  });

  await page.goto('/?demo=1');
  await createDeliveryOrder(page);
  await page.goto('/?demo=1#business');
  await page.locator('[data-open-pin][data-admin-target="business"]').click();
  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  await page.locator('[data-order-advance="LT-0002"]').click();
  await page.locator('[data-order-advance="LT-0002"]').click();
  await page.getByRole('button', { name: 'Abrir reparto' }).click();
  await page.locator('[data-rider-accept="LT-0002"]').click();
  await expect(page.locator('[data-view="rider"]')).toBeVisible();

  const firstStart = await page.evaluate(async () => {
    const { enableGpsTracking } = await import('/js/simulation.js');
    return enableGpsTracking();
  });
  expect(firstStart.ok).toBe(true);

  await page.evaluate(() => {
    window.location.hash = '#tracking';
  });
  await expect(page.locator('[data-view="tracking"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__gpsLifecycle.cleared)).toEqual([701]);

  await page.evaluate(() => {
    window.location.hash = '#rider';
  });
  await expect(page.locator('[data-view="rider"]')).toBeVisible();
  const secondStart = await page.evaluate(async () => {
    const { enableGpsTracking } = await import('/js/simulation.js');
    return enableGpsTracking();
  });
  expect(secondStart.ok).toBe(true);

  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
  });
  await expect.poll(() => page.evaluate(() => window.__gpsLifecycle.cleared)).toEqual([701, 702]);
});
