import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const repo = 'C:\\1212\\la-taba-ux-ultra-showcase';
const output = 'C:\\1212\\artifacts\\taba-ux-ultra-showcase\\final';
const port = 18101;
const baseURL = `http://127.0.0.1:${port}`;
const require = createRequire(path.join(repo, 'package.json'));
const { chromium } = require('@playwright/test');

await mkdir(output, { recursive: true });
const stdout = await open(path.join(output, 'server.stdout.log'), 'w');
const stderr = await open(path.join(output, 'server.stderr.log'), 'w');
const server = spawn(process.execPath, ['scripts/realtime-relay.mjs', String(port)], {
  cwd: repo,
  windowsHide: true,
  stdio: ['ignore', stdout.fd, stderr.fd],
});

try {
  await waitUntilReady(`${baseURL}/`);
  const diagnostics = await captureEvidence();
  await writeFile(
    path.join(output, 'diagnostics.json'),
    `${JSON.stringify(diagnostics, null, 2)}\n`,
    'utf8',
  );
  console.log(JSON.stringify({
    screenshots: diagnostics.captures.length,
    consoleErrors: diagnostics.consoleErrors.length,
    pageErrors: diagnostics.pageErrors.length,
    failedRequests: diagnostics.failedRequests.length,
    httpErrors: diagnostics.httpErrors.length,
    supabaseRequests: diagnostics.remoteSupabaseRequests.length,
    maxHorizontalOverflow: Math.max(...diagnostics.captures.map((item) => item.horizontalOverflow)),
  }, null, 2));
} finally {
  server.kill();
  await stdout.close();
  await stderr.close();
}

async function captureEvidence() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const diagnostics = {
    generatedAt: new Date().toISOString(),
    browser: await browser.version(),
    project: 'Chromium via @playwright/test (desktop/mobile viewport emulation)',
    baseURL,
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    httpErrors: [],
    externalHosts: [],
    remoteSupabaseRequests: [],
    captures: [],
  };
  const externalHosts = new Set();

  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== baseURL) externalHosts.add(url.hostname);
    if (url.hostname.endsWith('.supabase.co')) diagnostics.remoteSupabaseRequests.push(request.url());
  });
  page.on('requestfailed', (request) => {
    diagnostics.failedRequests.push({
      method: request.method(),
      url: request.url(),
      error: request.failure()?.errorText || '',
    });
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      diagnostics.httpErrors.push({
        status: response.status(),
        url: response.url(),
      });
    }
  });

  try {
    await page.goto(`${baseURL}/?showcase=1&reset=1#home`);
    await page.waitForFunction(() => (
      document.querySelector('[data-showcase-root]')
      && !new URL(location.href).searchParams.has('reset')
    ));
    await closeTour(page);
    await capture(page, diagnostics, '01-home-390x844.png', 'Home', 'Cliente sin pedido activo');

    await selectStep(page, 'catalog');
    await capture(page, diagnostics, '02-catalogo-390x844.png', 'Catálogo', '22 productos demo aprobados');

    await page.locator('[data-product-grid] [data-product-detail]').first().click();
    await page.waitForSelector('[data-product-modal]:not([hidden])');
    await capture(page, diagnostics, '03-producto-390x844.png', 'Producto', 'Primer producto disponible del catálogo demo');
    await page.locator('[data-product-modal]:not([hidden]) [data-close-modal]').click();

    await selectStep(page, 'pending-price');
    await page.waitForSelector('[data-modal-product-id="red-bull-original-lata-250ml-pack-4"]');
    await capture(
      page,
      diagnostics,
      '04-producto-precio-pendiente-390x844.png',
      'Producto con precio pendiente',
      'red-bull-original-lata-250ml-pack-4',
    );
    await page.locator('[data-modal-product-id="red-bull-original-lata-250ml-pack-4"] [data-close-modal]').click();

    await selectStep(page, 'cart');
    await capture(page, diagnostics, '05-carrito-390x844.png', 'Carrito', 'Un producto sintético');
    await page.locator('[data-clear-cart]').click();
    await page.waitForSelector('[data-clear-cart-modal][open]');
    await capture(
      page,
      diagnostics,
      '06-carrito-confirmar-vaciado-390x844.png',
      'Confirmación para vaciar carrito',
      'Un producto sintético',
    );
    await page.locator('[data-clear-cart-dismiss]').click();

    await selectStep(page, 'checkout');
    await page.waitForSelector('[data-checkout-form]');
    await capture(
      page,
      diagnostics,
      '07-checkout-envio-390x844.png',
      'Checkout · envío',
      'Cliente Demo y dirección sintética',
    );

    await page.setViewportSize({ width: 412, height: 915 });
    await selectStep(page, 'delivery-pickup');
    await page.getByLabel('Retiro en local').check();
    await capture(
      page,
      diagnostics,
      '08-checkout-retiro-412x915.png',
      'Checkout · retiro',
      'Carrito sintético sin domicilio',
    );

    await selectStep(page, 'profile');
    await capture(
      page,
      diagnostics,
      '09-perfil-412x915.png',
      'Perfil',
      'Perfil local Cliente Demo',
    );

    await selectStep(page, 'addresses');
    await page.locator('.addresses-card').scrollIntoViewIfNeeded();
    await capture(
      page,
      diagnostics,
      '10-direcciones-412x915.png',
      'Direcciones',
      'Dos direcciones locales sintéticas',
      { fullPage: false },
    );

    await page.setViewportSize({ width: 1280, height: 900 });
    await selectStep(page, 'business');
    await page.waitForSelector('[data-business-dashboard]');
    await capture(
      page,
      diagnostics,
      '11-negocio-pedidos-1280x900.png',
      'Panel del negocio',
      'Pedido recibido de Cliente de demostración',
    );

    await page.setViewportSize({ width: 412, height: 915 });
    await selectStep(page, 'rider');
    await page.waitForSelector('[data-rider-assignment-preview]');
    await capture(
      page,
      diagnostics,
      '12-rider-asignacion-412x915.png',
      'Rider',
      'Pedido sintético listo para asignar; GPS real desactivado',
    );

    await page.locator('[data-rider-accept]').click();
    await page.waitForSelector('[data-delivery-leave]');
    await page.locator('[data-delivery-leave]').click();
    await page.waitForFunction(async () => {
      const { getState } = await import('/js/state.js');
      return getState().orders.find((order) => !order.internalSeed)?.status === 'on_the_way';
    });
    await page.evaluate(() => {
      location.hash = '#tracking';
    });
    await page.waitForSelector('[data-view="tracking"].is-active');
    await page.waitForSelector('[data-tracking-status="on_the_way"]');
    await page.locator('[data-toast]').waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined);
    await capture(
      page,
      diagnostics,
      '13-mapa-sin-gps-412x915.png',
      'Tracking sin GPS',
      'Pedido en camino sin recorrido ni coordenadas reales',
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await openTour(page);
    const reloaded = page.waitForEvent('load');
    await page.locator('[data-showcase-step="session-recovery"]').click();
    await reloaded;
    await page.waitForSelector('[data-view="tracking"].is-active');
    await page.waitForSelector('[data-tracking-status="preparing"]');
    await capture(
      page,
      diagnostics,
      '14-tracking-preparando-390x844.png',
      'Tracking preparando y recuperación',
      'Mismo pedido sintético recuperado tras recarga',
    );

    await page.setViewportSize({ width: 412, height: 915 });
    await selectStep(page, 'tracking-map');
    await page.waitForSelector('[data-tracking-status="on_the_way"]');
    await page.waitForSelector('[data-real-map][data-map-engine="maplibre"][data-route-source="simulation"]');
    await page.waitForFunction(() => {
      const map = document.querySelector('[data-real-map][data-map-engine="maplibre"]');
      return ['ready', 'unavailable'].includes(map?.dataset.mapStatus || '');
    }, null, { timeout: 12_000 }).catch(() => undefined);
    await capture(
      page,
      diagnostics,
      '15-tracking-en-camino-maplibre-412x915.png',
      'Tracking en camino · MapLibre',
      'Recorrido geográfico sintético local',
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await selectStep(page, 'delivered');
    await page.waitForSelector('[data-tracking-status="delivered"]');
    await capture(
      page,
      diagnostics,
      '16-tracking-entregado-390x844.png',
      'Tracking entregado',
      'Pedido sintético en estado terminal',
    );

    await page.setViewportSize({ width: 1280, height: 900 });
    await openTour(page);
    await page.locator('[data-showcase-dialog] .showcase-dialog-scroll').evaluate((node) => {
      node.scrollTop = 0;
    });
    await capture(
      page,
      diagnostics,
      '17-modo-showcase-recorrido-1280x900.png',
      'Modo showcase · recorrido',
      'Recorrido guiado de 14 paradas',
    );
    await page.locator('#taba-showcase-release-title').scrollIntoViewIfNeeded();
    await capture(
      page,
      diagnostics,
      '18-modo-showcase-novedades-1280x900.png',
      'Modo showcase · novedades y límites',
      'Matriz honesta de release: integrado, pendiente, certificado y rechazado',
    );
    await page.locator('.showcase-limitations').scrollIntoViewIfNeeded();
    await capture(
      page,
      diagnostics,
      '19-modo-showcase-limites-1280x900.png',
      'Modo showcase · límites honestos',
      'Limitaciones explícitas de datos, MapLibre, Mercado Pago y producción',
    );

    diagnostics.externalHosts = [...externalHosts].sort();
    diagnostics.navigation = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const paints = Object.fromEntries(
        performance.getEntriesByType('paint').map((entry) => [entry.name, Math.round(entry.startTime)]),
      );
      return nav ? {
        responseStartMs: Math.round(nav.responseStart),
        domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
        loadMs: Math.round(nav.loadEventEnd),
        paints,
      } : { paints };
    });
    return diagnostics;
  } finally {
    await context.close();
    await browser.close();
  }
}

async function selectStep(page, stepId) {
  await openTour(page);
  const step = page.locator(`[data-showcase-step="${stepId}"]`);
  await step.waitFor({ state: 'visible' });
  await step.click();
  await page.locator('[data-showcase-dialog]').waitFor({ state: 'hidden' });
  await settle(page);
}

async function openTour(page) {
  const dialog = page.locator('[data-showcase-dialog]');
  if (!(await dialog.isVisible())) {
    await page.getByRole('button', { name: 'Volver al recorrido' }).click();
  }
  await dialog.waitFor({ state: 'visible' });
}

async function closeTour(page) {
  const dialog = page.locator('[data-showcase-dialog]');
  if (await dialog.isVisible()) {
    await page.getByRole('button', { name: 'Cerrar recorrido' }).click();
    await dialog.waitFor({ state: 'hidden' });
  }
}

async function capture(page, diagnostics, filename, state, syntheticData, {
  fullPage = true,
} = {}) {
  await settle(page);
  const viewport = page.viewportSize();
  const geometry = await page.evaluate(() => {
    const root = document.documentElement;
    const activeView = document.querySelector('.app-view.is-active');
    return {
      activeView: document.body.dataset.activeView || '',
      activeViewSelector: activeView?.getAttribute('data-view') || '',
      clientWidth: root.clientWidth,
      scrollWidth: root.scrollWidth,
      scrollHeight: root.scrollHeight,
      horizontalOverflow: Math.max(0, root.scrollWidth - root.clientWidth),
      showcaseVisible: Boolean(document.querySelector('[data-showcase-dialog][open]')),
      liveExternalLinks: [...document.querySelectorAll(
        'a[href^="tel:"], a[href*="wa.me"], a[href*="google.com/maps"]',
      )].filter((node) => node.getClientRects().length > 0).length,
      maplibreCanvasCount: document.querySelectorAll('.maplibregl-canvas').length,
      mountedMapCount: document.querySelectorAll('[data-real-map][data-map-engine="maplibre"]').length,
      maps: [...document.querySelectorAll('[data-real-map]')].map((map) => ({
        role: map.dataset.mapRole || '',
        engine: map.dataset.mapEngine || '',
        status: map.dataset.mapStatus || '',
        failure: map.dataset.mapFailure || '',
        source: map.dataset.mapSource || '',
        routeSource: map.dataset.routeSource || '',
      })),
    };
  });
  const filePath = path.join(output, filename);
  await page.screenshot({
    path: filePath,
    fullPage,
    animations: 'disabled',
  });
  const sha256 = createHash('sha256').update(await readFile(filePath)).digest('hex');
  diagnostics.captures.push({
    filename,
    path: filePath,
    state,
    viewport: `${viewport.width}x${viewport.height}`,
    syntheticData,
    ...geometry,
    sha256,
  });
}

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts?.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.waitForLoadState('networkidle', { timeout: 2_500 }).catch(() => undefined);
}

async function waitUntilReady(url) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Local server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Local TABA server did not become ready at ${url}`);
}
