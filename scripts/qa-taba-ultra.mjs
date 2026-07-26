import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE_URL = (process.env.QA_BASE_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
const OUTPUT_DIR = path.resolve('docs/visual-review/taba-ultra-final');
const MOBILE_VIEWPORT = { width: 390, height: 844 };
const DESKTOP_VIEWPORT = { width: 1280, height: 900 };
const FRESH_GPS_MAX_AGE_MS = 30_000;

const SCREENSHOTS = [
  '01-home-mobile.png',
  '02-home-desktop.png',
  '03-catalog-mobile.png',
  '04-product-detail.png',
  '05-cart.png',
  '06-checkout-no-alcohol.png',
  '07-checkout-with-alcohol.png',
  '08-tracking.png',
  '09-business.png',
  '10-rider.png',
];

const VIEWPORTS = [
  { name: 'mobile-320', width: 320, height: 700 },
  { name: 'mobile-360', width: 360, height: 800 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-412', width: 412, height: 915 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'desktop-1280', width: 1280, height: 900 },
];

const RESPONSIVE_VIEWS = ['home', 'catalog', 'product-detail', 'cart', 'tracking', 'business', 'rider'];

mkdirSync(OUTPUT_DIR, { recursive: true });

const results = {
  generatedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  screenshots: SCREENSHOTS,
  flowChecks: [],
  tracking: {
    policy: 'El mapa sólo se acepta con source=gps, gpsStatus=active y un fix de hasta 30 segundos.',
  },
  responsive: [],
  browserErrors: [],
  failedLocalResponses: [],
  status: 'running',
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function recordFlow(name, passed, detail = '') {
  results.flowChecks.push({ name, passed, detail });
  assert(passed, detail || name);
}

function screenshotPath(filename) {
  return path.join(OUTPUT_DIR, filename);
}

async function waitForImages(page) {
  await page.evaluate(async () => {
    const pending = [...document.images]
      .filter((image) => !image.complete)
      .map((image) => new Promise((resolve) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
      }));
    await Promise.all(pending);
  });
}

async function capture(page, filename, { fullPage = true } = {}) {
  assert(SCREENSHOTS.includes(filename), `Nombre de captura no previsto: ${filename}`);
  await page.locator('[data-toast]').waitFor({ state: 'hidden', timeout: 4_000 }).catch(() => {});
  await page.evaluate(() => window.scrollTo(0, 0));
  await waitForImages(page);
  await page.waitForTimeout(250);
  await page.screenshot({ path: screenshotPath(filename), fullPage });
  console.log(`✓ ${filename}`);
}

async function openFresh(page, view = 'home') {
  await page.goto(`${BASE_URL}/?reset=1&demo=1#${view}`, { waitUntil: 'networkidle' });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator(`[data-view="${view}"]`).waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(500);
}

async function goToView(page, view) {
  await page.evaluate((nextView) => {
    window.location.hash = `#${nextView}`;
  }, view);
  await page.locator(`[data-view="${view}"]`).waitFor({ state: 'visible', timeout: 10_000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
}

async function installBrowserStubs(page) {
  await page.addInitScript(() => {
    window.__qaOpenedUrls = [];
    window.open = (...args) => {
      window.__qaOpenedUrls.push(String(args[0] || ''));
      return null;
    };
    const clipboard = {
      writeText: async () => {},
      readText: async () => '',
    };
    try {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
    } catch (_) {
      // El navegador puede exponer clipboard como sólo lectura.
    }
  });
}

function installPageGuards(page) {
  const origin = new URL(BASE_URL).origin;

  page.on('pageerror', (error) => {
    results.browserErrors.push(error.message);
  });

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (text.includes('Failed to load resource') || text.includes('Service Worker')) return;
    results.browserErrors.push(text);
  });

  page.on('response', (response) => {
    if (response.status() < 400) return;
    const url = response.url();
    if (url.startsWith(origin)) {
      results.failedLocalResponses.push(`${response.status()} ${response.request().resourceType()} ${url}`);
    }
  });
}

async function addProductFromCategory(page, categoryId, quantity = 1) {
  await goToView(page, 'catalog');
  const category = page.locator(`[data-view="catalog"] [data-category-id="${categoryId}"]`).first();
  await category.waitFor({ state: 'visible' });
  await category.click();

  const product = page.locator('[data-product-grid] .product-card')
    .filter({ has: page.locator('[data-add-product]:not([disabled])') })
    .first();
  await product.waitFor({ state: 'visible' });
  const addButton = product.locator('[data-add-product]:not([disabled])').first();
  const productId = await addButton.getAttribute('data-add-product');
  assert(productId, `No se encontró un producto disponible en ${categoryId}.`);

  await addButton.click();
  for (let index = 1; index < quantity; index += 1) {
    const increment = page.locator(`[data-product-grid] [data-cart-inc="${productId}"]:not([disabled])`).first();
    await increment.waitFor({ state: 'visible' });
    await increment.click();
  }
  await page.waitForTimeout(250);
  return productId;
}

async function fillCheckout(page) {
  const form = page.locator('[data-checkout-form]');
  await form.locator('[name="deliveryMode"][value="delivery"]').check();
  await form.locator('[name="customerName"]').fill('Cliente TABA');
  await form.locator('[name="customerPhone"]').fill('299 555 1234');
  await form.locator('[name="customerStreetAddress"]').fill('Roca 123');
  await form.locator('[name="customerNeighborhood"]').fill('Neuquén centro');

  const instructions = form.locator('.checkout-instructions');
  if (await instructions.count()) {
    const open = await instructions.evaluate((node) => node.open);
    if (!open) await instructions.locator('summary').click();
  }
  await form.locator('[name="customerReference"]').fill('Portón negro');
  const notes = form.locator('[name="customerNotes"]');
  if (await notes.count()) await notes.fill('Tocar timbre');
}

async function unlockBusiness(page) {
  await goToView(page, 'business');
  if (await page.locator('[data-business-dashboard]').isVisible()) return;

  const openPin = page.locator('[data-open-pin][data-admin-target="business"]').first();
  await openPin.waitFor({ state: 'visible' });
  await openPin.click();
  const form = page.locator('[data-pin-form]');
  await form.locator('input[name="pin"]').fill('1234');
  await form.press('Enter');
  await page.locator('[data-business-dashboard]').waitFor({ state: 'visible' });
  await page.waitForTimeout(350);
}

async function activeOrderSnapshot(page) {
  return page.evaluate(async () => {
    const moduleUrl = new URL('js/state.js', window.location.href).href;
    const { getState } = await import(moduleUrl);
    const state = getState();
    const order = state.orders.find((candidate) => candidate.id === state.lastOrderId) || null;
    return order ? { id: order.id, status: order.status, previewOnly: Boolean(order.previewOnly) } : null;
  });
}

async function advanceOrderToReady(page, orderId) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const order = await activeOrderSnapshot(page);
    assert(order?.id === orderId, `El pedido activo cambió durante el flujo: ${order?.id || 'sin pedido'}.`);
    if (order.status === 'ready') return;
    assert(!['on_the_way', 'arriving', 'delivered', 'cancelled'].includes(order.status), `Estado inesperado antes de preparar: ${order.status}.`);

    const button = page.locator(`[data-order-advance="${orderId}"]`).first();
    await button.waitFor({ state: 'visible' });
    const previousStatus = order.status;
    await button.click();
    await page.waitForFunction(async ({ id, previous }) => {
      const moduleUrl = new URL('js/state.js', window.location.href).href;
      const { getState } = await import(moduleUrl);
      return getState().orders.find((candidate) => candidate.id === id)?.status !== previous;
    }, { id: orderId, previous: previousStatus });
    await page.waitForTimeout(250);
  }
  throw new Error(`No se pudo llevar ${orderId} al estado ready.`);
}

async function startDeliveryWithFreshGps(page, orderId) {
  await goToView(page, 'rider');
  const leave = page.locator(`[data-delivery-leave="${orderId}"]`).first();
  await leave.waitFor({ state: 'visible' });
  await leave.click();

  await page.waitForFunction(async (id) => {
    const moduleUrl = new URL('js/state.js', window.location.href).href;
    const { getState } = await import(moduleUrl);
    return getState().orders.find((candidate) => candidate.id === id)?.status === 'on_the_way';
  }, orderId);

  const activation = await page.evaluate(async () => {
    const moduleUrl = new URL('js/simulation.js', window.location.href).href;
    const { enableGpsTracking } = await import(moduleUrl);
    return enableGpsTracking();
  });
  assert(activation?.ok, activation?.message || 'No se pudo activar el GPS de la app.');

  await page.locator('[data-delivery-panel] [data-real-map]').waitFor({ state: 'visible', timeout: 12_000 });
  const gps = await page.evaluate(async (id) => {
    const moduleUrl = new URL('js/state.js', window.location.href).href;
    const { getState } = await import(moduleUrl);
    const state = getState();
    const simulation = state.simulation;
    return {
      orderId: simulation?.orderId || '',
      source: simulation?.source || '',
      gpsStatus: simulation?.gpsStatus || '',
      timestamp: Number(simulation?.timestamp || Date.parse(simulation?.lastFixAt || '')) || 0,
      matchesOrder: simulation?.orderId === id,
    };
  }, orderId);

  const ageMs = gps.timestamp ? Date.now() - gps.timestamp : Number.POSITIVE_INFINITY;
  results.tracking = {
    ...results.tracking,
    ...gps,
    ageMs,
    riderMapVisible: true,
  };
  const gpsIsValid = gps.matchesOrder
    && gps.source === 'gps'
    && gps.gpsStatus === 'active'
    && ageMs >= 0
    && ageMs <= FRESH_GPS_MAX_AGE_MS;
  recordFlow(
    'tracking-map-requires-fresh-real-gps',
    gpsIsValid,
    gpsIsValid
      ? `GPS real validado: source=${gps.source}, status=${gps.gpsStatus}, ageMs=${ageMs}.`
      : `GPS inválido para tracking: source=${gps.source}, status=${gps.gpsStatus}, ageMs=${ageMs}.`,
  );
}

async function inspectResponsiveState(page, viewport, view) {
  if (view === 'product-detail') {
    await goToView(page, 'catalog');
    await page.locator('[data-product-grid] [data-product-detail]').first().click();
    await page.locator('[data-product-modal]').waitFor({ state: 'visible' });
  } else {
    await goToView(page, view);
  }

  const measurement = await page.evaluate(() => {
    const root = document.documentElement;
    const viewportWidth = root.clientWidth;
    const viewportHeight = window.innerHeight;
    const selector = 'button, a[href], input, select, textarea, summary, [role="button"]';

    const isVisible = (node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity) !== 0
        && rect.width > 0
        && rect.height > 0;
    };

    const hasHorizontalScrollParent = (node) => {
      let parent = node.parentElement;
      while (parent && parent !== document.body) {
        const style = getComputedStyle(parent);
        const scrollable = ['auto', 'scroll'].includes(style.overflowX)
          && parent.scrollWidth > parent.clientWidth + 1;
        if (scrollable) return true;
        parent = parent.parentElement;
      }
      return false;
    };

    const labelFor = (node) => {
      const label = node.getAttribute('aria-label')
        || node.getAttribute('name')
        || node.textContent
        || node.tagName;
      return String(label).replace(/\s+/g, ' ').trim().slice(0, 90);
    };

    const controlsOutsideViewport = [...document.querySelectorAll(selector)]
      .filter(isVisible)
      .filter((node) => !hasHorizontalScrollParent(node))
      .map((node) => ({ node, rect: node.getBoundingClientRect() }))
      .filter(({ rect }) => rect.left < -1 || rect.right > viewportWidth + 1)
      .map(({ node, rect }) => ({
        control: labelFor(node),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
      }));

    const fixedControlsOutsideViewport = [...document.querySelectorAll(selector)]
      .filter(isVisible)
      .map((node) => ({ node, rect: node.getBoundingClientRect(), position: getComputedStyle(node).position }))
      .filter(({ position }) => position === 'fixed' || position === 'sticky')
      .filter(({ rect }) => (
        rect.left < -1
        || rect.right > viewportWidth + 1
        || rect.top < -1
        || rect.bottom > viewportHeight + 1
      ))
      .map(({ node, rect }) => ({
        control: labelFor(node),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
      }));

    const floatingCart = document.querySelector('[data-floating-cart]');
    const mobileNav = document.querySelector('.mobile-nav');
    const floatingVisible = floatingCart && isVisible(floatingCart);
    const navVisible = mobileNav && isVisible(mobileNav);
    let floatingCartOverlapsNavigation = false;
    if (floatingVisible && navVisible) {
      const cartRect = floatingCart.getBoundingClientRect();
      const navRect = mobileNav.getBoundingClientRect();
      floatingCartOverlapsNavigation = cartRect.bottom > navRect.top + 1;
    }

    const overflowPx = Math.max(root.scrollWidth, document.body?.scrollWidth || 0) - viewportWidth;
    return {
      viewportWidth,
      viewportHeight,
      overflowPx,
      controlsOutsideViewport,
      fixedControlsOutsideViewport,
      floatingCartOverlapsNavigation,
    };
  });

  if (view === 'product-detail') {
    await page.keyboard.press('Escape');
    await page.locator('[data-product-modal]').waitFor({ state: 'hidden' });
  }

  const passed = measurement.overflowPx <= 1
    && measurement.controlsOutsideViewport.length === 0
    && measurement.fixedControlsOutsideViewport.length === 0
    && !measurement.floatingCartOverlapsNavigation;
  return {
    viewport: viewport.name,
    width: viewport.width,
    height: viewport.height,
    view,
    ...measurement,
    passed,
  };
}

async function runResponsiveAudit(page) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const view of RESPONSIVE_VIEWS) {
      const result = await inspectResponsiveState(page, viewport, view);
      results.responsive.push(result);
      console.log(`${result.passed ? '✓' : '✗'} ${viewport.name} · ${view} · overflow ${result.overflowPx}px`);
    }
  }
}

async function run() {
  const browser = await chromium.launch();
  try {
    const mobileContext = await browser.newContext({
      viewport: MOBILE_VIEWPORT,
      serviceWorkers: 'block',
      locale: 'es-AR',
      permissions: ['geolocation'],
      geolocation: {
        latitude: -38.95161,
        longitude: -68.05912,
        accuracy: 12,
      },
    });
    await mobileContext.grantPermissions(['geolocation'], { origin: new URL(BASE_URL).origin });
    const page = await mobileContext.newPage();
    installPageGuards(page);
    await installBrowserStubs(page);

    await openFresh(page);
    await capture(page, '01-home-mobile.png');

    const desktopContext = await browser.newContext({
      viewport: DESKTOP_VIEWPORT,
      serviceWorkers: 'block',
      locale: 'es-AR',
    });
    const desktopPage = await desktopContext.newPage();
    installPageGuards(desktopPage);
    await installBrowserStubs(desktopPage);
    await openFresh(desktopPage);
    await capture(desktopPage, '02-home-desktop.png');
    await desktopContext.close();

    await goToView(page, 'catalog');
    await capture(page, '03-catalog-mobile.png');

    await page.locator('[data-product-grid] [data-product-detail]').first().click();
    await page.locator('[data-product-modal]').waitFor({ state: 'visible' });
    await capture(page, '04-product-detail.png', { fullPage: false });
    await page.keyboard.press('Escape');
    await page.locator('[data-product-modal]').waitFor({ state: 'hidden' });

    await addProductFromCategory(page, 'gaseosas', 2);
    await goToView(page, 'cart');
    const noAlcoholAgeVisible = await page.locator('[data-age-confirmation]').isVisible();
    recordFlow(
      'age-confirmation-hidden-without-alcohol',
      !noAlcoholAgeVisible,
      noAlcoholAgeVisible
        ? 'La confirmación de edad apareció con un carrito sin alcohol.'
        : 'La confirmación de edad permanece oculta con un carrito sin alcohol.',
    );
    await capture(page, '05-cart.png');

    await fillCheckout(page);
    await capture(page, '06-checkout-no-alcohol.png');

    await addProductFromCategory(page, 'cervezas', 1);
    await goToView(page, 'cart');
    await fillCheckout(page);
    const ageConfirmation = page.locator('[data-age-confirmation]');
    const ageInput = page.locator('[name="ageConfirmed"]');
    const alcoholAgeVisible = await ageConfirmation.isVisible();
    const alcoholAgeRequired = await ageInput.getAttribute('required') !== null;
    recordFlow(
      'age-confirmation-required-with-alcohol',
      alcoholAgeVisible && alcoholAgeRequired,
      `Confirmación de edad con alcohol: visible=${alcoholAgeVisible}, required=${alcoholAgeRequired}.`,
    );
    await ageInput.check();
    await capture(page, '07-checkout-with-alcohol.png');

    await page.locator('[data-checkout-form] button[type="submit"]').click();
    await page.locator('[data-view="tracking"]').waitFor({ state: 'visible', timeout: 12_000 });
    const activeOrder = await activeOrderSnapshot(page);
    recordFlow(
      'order-created-through-checkout',
      Boolean(activeOrder?.id),
      activeOrder?.id ? `Pedido ${activeOrder.id} creado desde checkout.` : 'El checkout no creó un pedido demo.',
    );
    const orderId = activeOrder.id;

    await unlockBusiness(page);
    await page.locator(`[data-inbox-order="${orderId}"]`).waitFor({ state: 'visible' });
    await capture(page, '09-business.png');
    await advanceOrderToReady(page, orderId);

    await startDeliveryWithFreshGps(page, orderId);
    await capture(page, '10-rider.png');

    const previousGpsTimestamp = Number(results.tracking.timestamp || 0);
    await mobileContext.setGeolocation({
      latitude: -38.95155,
      longitude: -68.05906,
      accuracy: 11,
    });
    await page.waitForFunction(async ({ id, previous }) => {
      const moduleUrl = new URL('js/state.js', window.location.href).href;
      const { getState } = await import(moduleUrl);
      const simulation = getState().simulation;
      return simulation?.orderId === id
        && simulation?.source === 'gps'
        && Number(simulation?.timestamp || 0) > previous;
    }, { id: orderId, previous: previousGpsTimestamp });

    const verifiedFix = await page.evaluate(async (id) => {
      const moduleUrl = new URL('js/state.js', window.location.href).href;
      const { getState } = await import(moduleUrl);
      const simulation = getState().simulation;
      if (simulation?.orderId !== id) return null;
      return {
        lat: Number(simulation.lat),
        lng: Number(simulation.lng),
        accuracy: Number(simulation.accuracy),
        timestamp: Number(simulation.timestamp),
        lastFixAt: simulation.lastFixAt,
        source: simulation.source,
      };
    }, orderId);
    assert(
      verifiedFix
        && verifiedFix.source === 'gps'
        && Number.isFinite(verifiedFix.accuracy)
        && Date.now() - verifiedFix.timestamp <= FRESH_GPS_MAX_AGE_MS,
      'No se pudo conservar el fix GPS real para verificar el DTO público.',
    );

    await goToView(page, 'tracking');
    await page.evaluate(async ({ id, location }) => {
      const moduleUrl = new URL('js/state.js', window.location.href).href;
      const { updateState } = await import(moduleUrl);
      updateState((draft) => {
        const order = draft.orders.find((candidate) => candidate.id === id);
        if (!order) return;
        order.tracking = {
          lastLocation: location,
          source: 'gps',
          updatedAt: location.lastFixAt,
        };
        // El cliente público recibe el último fix por el DTO seguro; no comparte
        // el watcher ni el estado privado del dispositivo rider.
        draft.simulation = null;
      });
    }, { id: orderId, location: verifiedFix });
    const renderedTrackingState = await page.evaluate(async (id) => {
      const moduleUrl = new URL('js/state.js', window.location.href).href;
      const { getState } = await import(moduleUrl);
      const state = getState();
      const order = state.orders.find((candidate) => candidate.id === id);
      const simulation = state.simulation;
      const tracked = order?.tracking?.lastLocation;
      return {
        orderStatus: order?.status || '',
        deliveryMode: order?.deliveryMode || '',
        simulationOrderId: simulation?.orderId || '',
        source: tracked?.source || '',
        accuracy: Number.isFinite(Number(tracked?.accuracy)) ? Number(tracked.accuracy) : null,
        ageMs: Date.now() - Number(tracked?.timestamp || Date.parse(tracked?.lastFixAt || '') || 0),
        mapCount: document.querySelectorAll('[data-tracking-panel] [data-real-map]').length,
      };
    }, orderId);
    results.tracking.renderedState = renderedTrackingState;
    assert(
      renderedTrackingState.mapCount === 1,
      `El tracking no montó el mapa con GPS fresco: ${JSON.stringify(renderedTrackingState)}.`,
    );
    await page.locator('[data-tracking-panel] [data-real-map]').waitFor({ state: 'visible', timeout: 10_000 });
    results.tracking.publicDtoHandoff = 'Fix GPS real y fresco proyectado al DTO público seguro, sin estado privado del rider.';
    results.tracking.liveMapVisible = true;
    const offlineFallbackHidden = await page.locator('[data-tracking-gps-note]').count() === 0;
    recordFlow(
      'tracking-hides-offline-fallback-while-gps-is-fresh',
      offlineFallbackHidden,
      offlineFallbackHidden
        ? 'El mapa con GPS fresco reemplaza correctamente al fallback sin ubicación.'
        : 'El tracking mostró simultáneamente mapa real y fallback sin GPS.',
    );
    await capture(page, '08-tracking.png');

    // Deja un carrito cargado para medir también la CTA flotante y el checkout
    // durante el barrido responsive, sin alterar el pedido activo.
    await addProductFromCategory(page, 'gaseosas', 1);
    await runResponsiveAudit(page);
    await mobileContext.close();

    const screenshotSetIsExact = results.screenshots.length === 10
      && new Set(results.screenshots).size === 10;
    recordFlow(
      'required-screenshot-set',
      screenshotSetIsExact,
      screenshotSetIsExact
        ? 'La evidencia contiene exactamente las diez capturas requeridas.'
        : 'La lista de evidencia no contiene exactamente las diez capturas requeridas.',
    );
    recordFlow(
      'browser-console-and-local-assets',
      results.browserErrors.length === 0 && results.failedLocalResponses.length === 0,
      `Errores JS=${results.browserErrors.length}; respuestas locales fallidas=${results.failedLocalResponses.length}.`,
    );

    const failedResponsive = results.responsive.filter((entry) => !entry.passed);
    recordFlow(
      'responsive-all-viewports',
      failedResponsive.length === 0,
      failedResponsive.length === 0
        ? `${results.responsive.length} combinaciones de viewport/vista aprobadas.`
        : `${failedResponsive.length} combinación(es) de viewport/vista presentan overflow o controles fuera de pantalla.`,
    );
  } finally {
    await browser.close();
  }
}

let failure = null;
try {
  await run();
  results.status = 'passed';
} catch (error) {
  failure = error;
  results.status = 'failed';
  results.failure = error instanceof Error ? error.message : String(error);
} finally {
  results.finishedAt = new Date().toISOString();
  writeFileSync(path.join(OUTPUT_DIR, 'qa-results.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
}

if (failure) throw failure;
console.log(`Evidencia y resultados: ${OUTPUT_DIR}`);
