import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { installBrowserStubs, installPageGuards } from './helpers.mjs';

const ARTIFACT_DIR = path.resolve('artifacts/rider-map-qa');
const RIDER_FIXTURE = Object.freeze({
  id: 'LT-RIDER-2048',
  code: 'LT-RIDER-2048',
  publicCode: 'LT-RIDER-2048',
  status: 'on_the_way',
  workflowStatus: 'on_the_way',
  deliveryMode: 'delivery',
  customerName: 'Cliente QA',
  customerPhone: '2995550101',
  address: 'Av. Argentina 245, Centro',
  addressDetails: {
    streetLine: 'Av. Argentina 245',
    neighborhood: 'Centro',
    floor: '4',
    apartment: 'B',
    reference: 'Portón negro',
    label: 'Av. Argentina 245, Centro',
  },
  locality: 'Neuquén',
  notes: 'Tocar timbre y esperar en recepción',
  destinationLocation: {
    lat: -38.9568,
    lng: -68.0648,
    accuracy: 16,
  },
  paymentMethod: 'Efectivo',
  total: 6990,
  currencyCode: 'ARS',
  createdAt: '2026-07-28T14:00:00.000Z',
  updatedAt: '2026-07-28T14:08:00.000Z',
  delivery: {
    etaMinutes: 8,
    etaSource: 'routing',
  },
});

const RIDER_LOCATION = Object.freeze({
  lat: -38.9519,
  lng: -68.0589,
  accuracy: 11,
  heading: 32,
  speed: 2.4,
  source: 'gps',
  origin: 'local_gps',
  lastFixAt: '2026-07-28T14:08:00.000Z',
});

const BUSINESS_CONFIG = Object.freeze({
  businessName: 'TABA',
  address: 'Diagonal 9 de Julio 120',
  businessLocationVerified: true,
  businessLocation: {
    lat: -38.9489,
    lng: -68.0558,
    name: 'Negocio',
  },
});

test.beforeAll(() => {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
});

for (const device of [
  {
    name: 'galaxy-s23',
    viewport: { width: 360, height: 780 },
    userAgent: 'Mozilla/5.0 (Linux; Android 15; SM-S911B) AppleWebKit/537.36 Chrome/136 Mobile Safari/537.36',
  },
  {
    name: 'iphone-13-pro',
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Version/18.5 Mobile/15E148 Safari/604.1',
  },
]) {
  test(`mapa rider operativo en ${device.name}`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: device.viewport,
      userAgent: device.userAgent,
      hasTouch: true,
      isMobile: true,
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    const guards = installPageGuards(page);
    await installBrowserStubs(page);
    await page.goto('/?demo=1');
    await mountOperationalRider(page, {
      order: RIDER_FIXTURE,
      riderLocation: RIDER_LOCATION,
      businessConfig: BUSINESS_CONFIG,
    });

    const rider = page.locator('.rider-operational-view');
    const map = rider.locator('[data-real-map]');
    await expect(map).toHaveAttribute('data-map-status', 'ready', { timeout: 12_000 });
    await expect(rider.locator('.rider-self-marker[aria-label="Tu ubicación"]')).toHaveCount(1);
    await expect(rider.locator('.rider-place-marker.is-client[aria-label="Cliente"]')).toHaveCount(1);
    await expect(rider.locator('.rider-place-marker.is-business')).toHaveCount(1);
    await expect(rider.locator('.lt-rider-helmet-icon, .lt-rider-marker')).toHaveCount(0);
    await expect(rider.getByRole('heading', { name: 'Av. Argentina 245' })).toBeVisible();

    const navigation = rider.locator('[data-rider-navigation]');
    const navigationUrl = new URL(await navigation.getAttribute('href'));
    if (device.name === 'iphone-13-pro') {
      expect(navigationUrl.hostname).toBe('maps.apple.com');
      expect(navigationUrl.searchParams.get('daddr')).toBe('-38.9568,-68.0648');
    } else {
      expect(navigationUrl.hostname).toBe('www.google.com');
      expect(navigationUrl.searchParams.get('destination')).toBe('-38.9568,-68.0648');
    }
    await expect(navigation).toHaveAttribute('target', '_blank');
    await expect(navigation).toHaveAttribute('rel', /noopener/);
    await expect(navigation).toHaveAttribute('rel', /noreferrer/);

    const arrived = rider.getByRole('button', { name: 'Llegué' });
    await expect(arrived).toHaveAttribute('data-production-rider-next', RIDER_FIXTURE.id);
    await expect(arrived).toHaveAttribute('data-next-status', 'arrived');

    const metrics = await page.evaluate(() => {
      const mapStage = document.querySelector('.rider-operational-map-stage');
      const sheet = document.querySelector('.rider-operational-sheet');
      const actions = document.querySelector('.rider-primary-actions');
      return {
        bodyScrollWidth: document.body.scrollWidth,
        viewportWidth: window.innerWidth,
        mapHeight: mapStage?.getBoundingClientRect().height || 0,
        sheetTop: sheet?.getBoundingClientRect().top || 0,
        actionsBottom: actions?.getBoundingClientRect().bottom || 0,
        viewportHeight: window.innerHeight,
      };
    });
    expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.mapHeight).toBeGreaterThanOrEqual(430);
    expect(metrics.sheetTop).toBeLessThan(metrics.viewportHeight);
    expect(metrics.actionsBottom).toBeLessThanOrEqual(metrics.viewportHeight + 1);

    await page.screenshot({
      path: path.join(ARTIFACT_DIR, `rider-${device.name}.png`),
      fullPage: false,
      animations: 'disabled',
    });
    if (device.name === 'iphone-13-pro') {
      await rider.locator('.rider-operational-map-stage').screenshot({
        path: path.join(ARTIFACT_DIR, 'rider-three-markers.png'),
        animations: 'disabled',
      });
      await rider.locator('.rider-operational-sheet').screenshot({
        path: path.join(ARTIFACT_DIR, 'rider-address-actions.png'),
        animations: 'disabled',
      });
    }

    await guards.assertClean();
    await context.close();
  });
}

test('rider sin GPS conserva lugares, navegación y tarjeta operativa', async ({ page }) => {
  const guards = installPageGuards(page);
  await installBrowserStubs(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?demo=1');
  await mountOperationalRider(page, {
    order: RIDER_FIXTURE,
    riderLocation: null,
    businessConfig: BUSINESS_CONFIG,
  });

  const rider = page.locator('.rider-operational-view');
  await expect(rider.locator('[data-real-map]')).toHaveAttribute('data-map-status', 'ready', {
    timeout: 12_000,
  });
  await expect(rider.locator('.rider-self-marker')).toHaveCount(0);
  await expect(rider.locator('.rider-place-marker.is-client')).toHaveCount(1);
  await expect(rider.locator('.rider-place-marker.is-business')).toHaveCount(1);
  await expect(rider.getByText('Activá la ubicación para verte en el mapa.')).toBeVisible();
  await expect(rider.getByRole('button', { name: 'Activar ubicación' })).toBeVisible();
  await expect(rider.getByRole('button', { name: 'Centrar mi ubicación' })).toBeDisabled();
  await expect(rider.locator('[data-rider-navigation]')).toBeVisible();

  await page.screenshot({
    path: path.join(ARTIFACT_DIR, 'rider-without-gps.png'),
    fullPage: false,
    animations: 'disabled',
  });
  await guards.assertClean();
});

test('rider continúa sin coordenadas del negocio y no crea un punto ficticio', async ({ page }) => {
  const guards = installPageGuards(page);
  await installBrowserStubs(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?demo=1');
  await mountOperationalRider(page, {
    order: RIDER_FIXTURE,
    riderLocation: RIDER_LOCATION,
    businessConfig: {
      ...BUSINESS_CONFIG,
      businessLocationVerified: false,
    },
  });

  const rider = page.locator('.rider-operational-view');
  await expect(rider.locator('[data-real-map]')).toHaveAttribute('data-map-status', 'ready', {
    timeout: 12_000,
  });
  await expect(rider.locator('.rider-self-marker')).toHaveCount(1);
  await expect(rider.locator('.rider-place-marker.is-client')).toHaveCount(1);
  await expect(rider.locator('.rider-place-marker.is-business')).toHaveCount(0);
  await expect(rider.locator('[data-rider-navigation]')).toBeVisible();
  await guards.assertClean();
});

test('el mapa del cliente sigue mostrando exclusivamente el casco', async ({ page }) => {
  const guards = installPageGuards(page);
  await installBrowserStubs(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?demo=1');
  await mountCustomerTracking(page, {
    ...RIDER_FIXTURE,
    tracking: {
      lastLocation: {
        ...RIDER_LOCATION,
        timestamp: Date.now(),
        lastFixAt: new Date().toISOString(),
      },
    },
  });

  const tracking = page.locator('[data-client-map-fixture]');
  await expect(tracking.locator('[data-real-map]')).toHaveAttribute('data-map-status', 'ready', {
    timeout: 12_000,
  });
  await expect(tracking.locator('.lt-rider-marker .lt-rider-helmet-icon')).toHaveCount(1);
  await expect(tracking.locator('.rider-self-marker, .rider-place-marker')).toHaveCount(0);

  await tracking.screenshot({
    path: path.join(ARTIFACT_DIR, 'client-map-helmet-preserved.png'),
    animations: 'disabled',
  });
  await guards.assertClean();
});

async function mountOperationalRider(page, {
  order,
  riderLocation,
  businessConfig,
}) {
  await page.evaluate(async (payload) => {
    const {
      buildRiderMapContext,
      clearRiderMapContexts,
      setRiderMapContext,
    } = await import('/js/map/rider_operational_map.js');
    const {
      disposeMapViews,
      ensureTrackingMap,
      scheduleTrackingVisualUpdate,
    } = await import('/js/map/map_view.js');
    const { riderOperationalOrderMarkup } = await import('/js/production-operations.js');

    disposeMapViews(document);
    clearRiderMapContexts();
    const context = setRiderMapContext(
      payload.order.id,
      buildRiderMapContext(payload.order, {
        businessConfig: payload.businessConfig,
        localLocation: payload.riderLocation,
      }),
    );

    document.body.dataset.appMode = 'production';
    document.body.dataset.activeView = 'rider';
    const main = document.querySelector('main[data-app-main]');
    main.innerHTML = `
      <section class="section app-view is-active" data-view="rider" aria-hidden="false">
        <div data-production-workspace="rider">
          <div class="production-rider-workspace has-active-map">
            ${riderOperationalOrderMarkup(payload.order, context)}
          </div>
        </div>
      </section>`;
    const shell = main.querySelector('[data-real-map]');
    shell.dataset.mapTheme = 'light';
    shell.classList.add('map-theme-light');
    const view = {
      container: shell,
      fallback: shell.querySelector('[data-map-fallback]'),
      canvas: shell.querySelector('[data-map-canvas]'),
      emptyMap: false,
      role: 'rider',
      order: payload.order,
      sim: null,
      riderLocation: context.riderLocation,
      destination: context.destination,
      points: [],
      preferredTheme: 'light',
      theme: 'light',
      freshness: context.riderLocation ? 'fresh' : 'missing',
      sandbox: false,
      store: context.store,
      priority: context.priority,
      sandboxScenario: null,
    };
    const entry = ensureTrackingMap(shell, view);
    entry?.adapter?.resize?.();
    scheduleTrackingVisualUpdate(entry, view);
  }, { order, riderLocation, businessConfig });
}

async function mountCustomerTracking(page, order) {
  await page.evaluate(async (payload) => {
    const {
      disposeMapViews,
      ensureTrackingMap,
      scheduleTrackingVisualUpdate,
    } = await import('/js/map/map_view.js');
    const { clearRiderMapContexts } = await import('/js/map/rider_operational_map.js');

    disposeMapViews(document);
    clearRiderMapContexts();
    document.body.dataset.appMode = 'production';
    document.body.dataset.activeView = 'tracking';
    const main = document.querySelector('main[data-app-main]');
    main.innerHTML = `
      <section class="section app-view is-active tracking-premium" data-view="tracking" aria-hidden="false">
        <div class="delivery-map-stage tracking-map-stage" data-map-shell="tracking" data-client-map-fixture>
          <div class="real-map-shell" data-real-map data-map-role="tracking" data-order-id="${payload.id}">
            <div class="real-map-canvas" data-map-canvas role="region" aria-label="Mapa de seguimiento de tu pedido"></div>
            <div class="real-map-fallback" data-map-fallback role="status">
              <p>Mapa no disponible.</p>
            </div>
            <div class="real-map-meta" data-map-meta role="status">
              <span data-map-meta-text>Última ubicación</span>
            </div>
          </div>
        </div>
      </section>`;
    const shell = main.querySelector('[data-real-map]');
    shell.dataset.mapTheme = 'light';
    shell.classList.add('map-theme-light');
    const view = {
      container: shell,
      fallback: shell.querySelector('[data-map-fallback]'),
      canvas: shell.querySelector('[data-map-canvas]'),
      emptyMap: false,
      role: 'tracking',
      order: payload,
      sim: null,
      riderLocation: payload.tracking?.lastLocation || null,
      destination: null,
      points: [],
      preferredTheme: 'light',
      theme: 'light',
      freshness: 'fresh',
      sandbox: false,
      store: null,
      priority: 'client',
      sandboxScenario: null,
    };
    const entry = ensureTrackingMap(shell, view);
    entry?.adapter?.resize?.();
    scheduleTrackingVisualUpdate(entry, view);
  }, order);
}
