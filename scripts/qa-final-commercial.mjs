import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const BASE_URL = (process.env.QA_BASE_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
const RELEASE_DIR = path.resolve(process.env.QA_RELEASE_DIR || 'docs/final-commercial-release');
const seedVisualPromotion = process.env.QA_SEED_PROMOTION === '1';
const manifestName = process.env.QA_MANIFEST_NAME || 'manifest.json';
const round = process.argv[2] || 'round-1';
const validRounds = new Set(['round-1', 'round-2']);
if (!validRounds.has(round)) {
  throw new Error(`Ronda inválida: ${round}. Usá round-1 o round-2.`);
}

const VIEWPORTS = [
  { tag: 'm320', width: 320, height: 700 },
  { tag: 'm360', width: 360, height: 800 },
  { tag: 'm390', width: 390, height: 844 },
  { tag: 'm412', width: 412, height: 915 },
  { tag: 't768', width: 768, height: 1024 },
  { tag: 'd1280', width: 1280, height: 900 },
];
const requestedTags = new Set(
  String(process.env.QA_VIEWPORT_TAGS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);
const activeViewports = requestedTags.size
  ? VIEWPORTS.filter((viewport) => requestedTags.has(viewport.tag))
  : VIEWPORTS;
if (!activeViewports.length) throw new Error('QA_VIEWPORT_TAGS no coincide con ningún viewport.');

const SCENES = [
  'home-new',
  'catalog',
  'no-results',
  'product',
  'cart',
  'checkout-no-alcohol',
  'checkout-alcohol',
  'business',
  'rider-before-accept',
  'tracking-no-gps',
  'tracking-with-gps',
  'rider-delivering',
  'tracking-arriving',
  'tracking-delivered',
  'home-recurrent',
];
const CLIENT_SCENES = new Set([
  'home-new',
  'catalog',
  'no-results',
  'product',
  'cart',
  'checkout-no-alcohol',
  'checkout-alcohol',
  'tracking-no-gps',
  'tracking-with-gps',
  'tracking-arriving',
  'tracking-delivered',
  'home-recurrent',
]);
const FORBIDDEN_CUSTOMER_COPY = /\b(?:demo|qa|fixture|técnic[oa]s?|no comercial|no publicar|pedido de muestra)\b/i;
const outDir = path.join(RELEASE_DIR, `visual-review-${round}`);
mkdirSync(outDir, { recursive: true });

const report = {
  schemaVersion: 1,
  round,
  generatedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  viewports: activeViewports,
  requiredScenes: SCENES,
  captures: [],
  errors: [],
  failedResponses: [],
  result: 'running',
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForApp(page, view = 'home') {
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator(`[data-view="${view}"]`).waitFor({ state: 'visible', timeout: 12_000 });
  await page.waitForTimeout(250);
}

async function openFresh(page) {
  await page.goto(`${BASE_URL}/?reset=1&demo=1#home`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await waitForApp(page, 'home');
  if (!seedVisualPromotion) return;
  await page.evaluate(async () => {
    const stateUrl = new URL('js/state.js', location.href).href;
    const { updateState } = await import(stateUrl);
    updateState((draft) => {
      draft.promotions = [{
        promoId: 'visual-review-coca-cola-x6',
        title: 'Coca-Cola Original 1,5 L x6',
        subtitle: 'Precio especial por pack x6',
        includedSkus: ['qa-promo-bebidas'],
        promotionType: 'precio_promocional',
        regularPrice: 5000,
        promotionalPrice: 4200,
        discountPercentage: null,
        requiredQuantity: 1,
        maximumUnits: null,
        validFrom: '2020-01-01',
        validUntil: '2099-12-31',
        active: true,
        priority: 100,
        imagePath: '',
        terms: 'Precio especial por pack x6.',
        previewOnly: true,
        approvalStatus: 'APROBADA',
        approvalReference: 'VISUAL-REVIEW-2026',
        sourceEvidence: 'Escenario efímero de revisión visual.',
      }];
    });
  });
  await page.waitForTimeout(180);
}

async function goToView(page, view) {
  await page.evaluate((nextView) => {
    window.location.hash = `#${nextView}`;
  }, view);
  await waitForApp(page, view);
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function waitForImages(page) {
  await page.evaluate(async () => {
    const visibleImages = [...document.images].filter((image) => {
      const rect = image.getBoundingClientRect();
      const style = getComputedStyle(image);
      return rect.width > 0
        && rect.height > 0
        && style.display !== 'none'
        && style.visibility !== 'hidden';
    });
    await Promise.all(visibleImages.map((image) => {
      if (image.complete) return Promise.resolve();
      return new Promise((resolve) => {
        const timeout = setTimeout(resolve, 3_000);
        const finish = () => {
          clearTimeout(timeout);
          resolve();
        };
        image.addEventListener('load', finish, { once: true });
        image.addEventListener('error', finish, { once: true });
      });
    }));
  });
}

async function inspectSurface(page, scene) {
  return page.evaluate(({ currentScene, customerScene, forbiddenSource }) => {
    const forbidden = new RegExp(forbiddenSource, 'i');
    const visible = (node) => {
      if (!(node instanceof Element)) return false;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity) !== 0
        && rect.width > 0
        && rect.height > 0;
    };
    const activeView = document.querySelector('[data-view].is-active:not([hidden])');
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;
    const pageWidth = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0);
    const controls = [...document.querySelectorAll(
      'button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"]',
    )].filter(visible);
    const unnamed = controls.filter((node) => {
      const label = node.getAttribute('aria-label')
        || node.getAttribute('title')
        || node.textContent?.trim()
        || (node.id ? document.querySelector(`label[for="${CSS.escape(node.id)}"]`)?.textContent?.trim() : '')
        || node.closest('label')?.textContent?.trim();
      return !label;
    }).map((node) => node.outerHTML.slice(0, 160));
    const brokenImages = [...document.images]
      .filter(visible)
      .filter((image) => image.complete && image.naturalWidth === 0)
      .map((image) => image.currentSrc || image.src);
    const fixed = controls
      .filter((node) => ['fixed', 'sticky'].includes(getComputedStyle(node).position))
      .map((node) => ({ node, rect: node.getBoundingClientRect() }));
    const fixedOutside = fixed
      .filter(({ rect }) => (
        rect.left < -1
        || rect.right > viewportWidth + 1
        || rect.top < -1
        || rect.bottom > viewportHeight + 1
      ))
      .map(({ node, rect }) => ({
        label: node.getAttribute('aria-label') || node.textContent?.trim().slice(0, 60),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
      }));
    const intersect = (a, b) => (
      Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
      * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
    );
    const fixedOverlaps = [];
    for (let left = 0; left < fixed.length; left += 1) {
      for (let right = left + 1; right < fixed.length; right += 1) {
        const first = fixed[left];
        const second = fixed[right];
        if (first.node.contains(second.node) || second.node.contains(first.node)) continue;
        const area = intersect(first.rect, second.rect);
        const smaller = Math.min(
          first.rect.width * first.rect.height,
          second.rect.width * second.rect.height,
        );
        if (smaller > 0 && area / smaller > 0.2) {
          fixedOverlaps.push([
            first.node.getAttribute('aria-label') || first.node.textContent?.trim().slice(0, 40),
            second.node.getAttribute('aria-label') || second.node.textContent?.trim().slice(0, 40),
          ]);
        }
      }
    }
    const operationHasPublicNav = ['business', 'rider'].includes(activeView?.dataset.view)
      && visible(document.querySelector('.mobile-nav'));
    const activeText = activeView?.innerText || '';
    const forbiddenCopy = customerScene && forbidden.test(activeText)
      ? activeText.match(forbidden)?.[0] || 'texto interno'
      : '';
    const headings = activeView ? [...activeView.querySelectorAll('h1')].filter(visible).length : 0;
    return {
      scene: currentScene,
      activeView: activeView?.dataset.view || '',
      viewportWidth,
      viewportHeight,
      overflowPx: pageWidth - viewportWidth,
      unnamed,
      brokenImages,
      fixedOutside,
      fixedOverlaps,
      operationHasPublicNav,
      forbiddenCopy,
      h1Count: headings,
    };
  }, {
    currentScene: scene,
    customerScene: CLIENT_SCENES.has(scene),
    forbiddenSource: FORBIDDEN_CUSTOMER_COPY.source,
  });
}

async function capture(page, viewport, scene, index) {
  assert(SCENES.includes(scene), `Escena desconocida: ${scene}`);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.locator('[data-toast]').waitFor({ state: 'hidden', timeout: 4_000 }).catch(() => {});
  await waitForImages(page);
  await page.waitForTimeout(180);
  const audit = await inspectSurface(page, scene);
  const failures = [];
  if (audit.overflowPx > 1) failures.push(`overflow ${audit.overflowPx}px`);
  if (audit.unnamed.length) failures.push(`${audit.unnamed.length} controles sin nombre`);
  if (audit.brokenImages.length) failures.push(`${audit.brokenImages.length} imágenes rotas`);
  if (audit.fixedOutside.length) failures.push(`${audit.fixedOutside.length} controles fijos fuera del viewport`);
  if (audit.fixedOverlaps.length) failures.push(`${audit.fixedOverlaps.length} superposiciones fijas`);
  if (audit.operationHasPublicNav) failures.push('navegación pública visible en operación');
  if (audit.forbiddenCopy) failures.push(`copy interno visible: ${audit.forbiddenCopy}`);
  if (!audit.h1Count) failures.push('vista activa sin h1');

  const filename = `${viewport.tag}-${String(index).padStart(2, '0')}-${scene}.png`;
  const target = path.join(outDir, filename);
  await page.screenshot({ path: target, fullPage: false, animations: 'disabled' });
  const hash = createHash('sha256').update(readFileSync(target)).digest('hex');
  report.captures.push({
    file: filename,
    sha256: hash,
    bytes: statSync(target).size,
    audit,
    passed: failures.length === 0,
    failures,
  });
  console.log(`${failures.length ? '✗' : '✓'} ${filename}${failures.length ? ` — ${failures.join('; ')}` : ''}`);
}

async function selectCategory(page, categoryId) {
  await goToView(page, 'catalog');
  const button = page.locator(`[data-view="catalog"] [data-category-id="${categoryId}"]`).first();
  await button.waitFor({ state: 'visible' });
  await button.click();
  await page.waitForTimeout(180);
}

async function addFirstAvailable(page, categoryId) {
  await selectCategory(page, categoryId);
  const add = page.locator('[data-product-grid] [data-add-product]:not([disabled])').first();
  await add.waitFor({ state: 'visible' });
  await add.click();
  await page.waitForTimeout(180);
}

async function fillCheckout(page) {
  const form = page.locator('[data-checkout-form]');
  await form.locator('[name="deliveryMode"][value="delivery"]').check();
  await form.locator('[name="customerName"]').fill('María López');
  await form.locator('[name="customerPhone"]').fill('2995551234');
  await form.locator('[name="customerStreetAddress"]').fill('Roca 123');
  await form.locator('[name="customerNeighborhood"]').fill('Neuquén centro');
  const payment = form.locator('[name="paymentMethod"]');
  if (await payment.count()) {
    const option = await payment.locator('option[value="cash"]').count() ? 'cash' : 'coordinate';
    await payment.selectOption(option);
  }
}

async function activeOrder(page) {
  return page.evaluate(async () => {
    const { getState } = await import(new URL('js/state.js', location.href).href);
    const state = getState();
    const order = state.orders.find((candidate) => candidate.id === state.lastOrderId) || null;
    return order ? { id: order.id, status: order.status } : null;
  });
}

async function unlockBusiness(page) {
  await goToView(page, 'business');
  const dashboard = page.locator('[data-business-dashboard]');
  if (await dashboard.isVisible()) return;
  await page.locator('[data-open-pin][data-admin-target="business"]').first().click();
  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  await dashboard.waitFor({ state: 'visible', timeout: 8_000 });
}

async function advanceToReady(page, orderId) {
  await unlockBusiness(page);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const snapshot = await activeOrder(page);
    if (snapshot?.status === 'ready') return;
    assert(snapshot?.id === orderId, `Pedido activo inesperado: ${snapshot?.id || 'ninguno'}`);
    const action = page.locator(`[data-order-advance="${orderId}"]`).first();
    await action.waitFor({ state: 'visible' });
    await action.click();
    await page.waitForFunction(async ({ id, previous }) => {
      const { getState } = await import(new URL('js/state.js', location.href).href);
      return getState().orders.find((order) => order.id === id)?.status !== previous;
    }, { id: orderId, previous: snapshot.status });
  }
  throw new Error(`No se pudo preparar ${orderId}.`);
}

async function acceptDelivery(page, orderId) {
  await goToView(page, 'rider');
  const accept = page.locator(`[data-rider-accept="${orderId}"]`).first();
  await accept.waitFor({ state: 'visible' });
  await accept.click();
  await page.locator(`[data-delivery-leave="${orderId}"]`).waitFor({ state: 'visible' });
}

async function startDeliveryWithGps(page, orderId) {
  await goToView(page, 'rider');
  await page.locator(`[data-delivery-leave="${orderId}"]`).first().click();
  await page.waitForFunction(async (id) => {
    const { getState } = await import(new URL('js/state.js', location.href).href);
    return getState().orders.find((order) => order.id === id)?.status === 'on_the_way';
  }, orderId);
  const result = await page.evaluate(async () => {
    const { enableGpsTracking } = await import(new URL('js/simulation.js', location.href).href);
    return enableGpsTracking();
  });
  assert(result?.ok, result?.message || 'No se pudo iniciar el GPS explícito de preview.');
  await page.waitForFunction(async (id) => {
    const { getState } = await import(new URL('js/state.js', location.href).href);
    const simulation = getState().simulation;
    const timestamp = Number(simulation?.timestamp || Date.parse(simulation?.lastFixAt || '')) || 0;
    return simulation?.orderId === id
      && simulation?.source === 'gps'
      && simulation?.gpsStatus === 'active'
      && Date.now() - timestamp <= 30_000;
  }, orderId, { timeout: 15_000 });
  // En el preview de evidencia cliente y rider comparten pestaña. La app corta
  // correctamente el watcher al salir de la vista rider, así que conservamos
  // el último fix real recibido como lo haría el DTO público del backend.
  await page.evaluate(async (id) => {
    const { getState, updateState } = await import(new URL('js/state.js', location.href).href);
    const simulation = getState().simulation;
    const timestamp = Date.now();
    updateState((draft) => {
      const order = draft.orders.find((candidate) => candidate.id === id);
      if (!order || !simulation) return;
      order.tracking = {
        ...(order.tracking || {}),
        lastLocation: {
          lat: simulation.lat,
          lng: simulation.lng,
          accuracy: simulation.accuracy,
          heading: simulation.heading,
          speed: simulation.speed,
          source: 'gps',
          gpsStatus: 'active',
          timestamp,
          lastFixAt: new Date(timestamp).toISOString(),
        },
      };
    });
  }, orderId);
}

async function arriveDelivery(page, orderId) {
  await goToView(page, 'rider');
  await page.locator(`[data-delivery-arrive="${orderId}"]`).first().click();
  await page.waitForFunction(async (id) => {
    const { getState } = await import(new URL('js/state.js', location.href).href);
    return getState().orders.find((order) => order.id === id)?.status === 'arriving';
  }, orderId);
  await goToView(page, 'tracking');
  const codeNode = page.locator('[data-delivery-code]').first();
  await codeNode.waitFor({ state: 'visible' });
  const code = await codeNode.getAttribute('data-delivery-code');
  assert(/^\d{4}$/.test(code || ''), 'El código de entrega no está disponible al llegar.');
  return code;
}

async function finishDelivery(page, orderId, code) {
  await goToView(page, 'rider');
  await page.locator(`[data-delivery-code-input="${orderId}"]`).fill(code);
  await page.locator(`[data-delivery-code-confirm="${orderId}"]`).click();
  await page.locator(`[data-delivery-done="${orderId}"]`).waitFor({ state: 'visible' });
  await page.locator(`[data-delivery-done="${orderId}"]`).click();
  await page.waitForFunction(async (id) => {
    const { getState } = await import(new URL('js/state.js', location.href).href);
    return getState().orders.find((order) => order.id === id)?.status === 'delivered';
  }, orderId);
}

async function persistReorderHistory(page, orderId) {
  const result = await page.evaluate(async (id) => {
    const [
      { getState },
      { rememberCustomerProfileFromOrder },
      { recordCustomerOrder },
    ] = await Promise.all([
      import(new URL('js/state.js', location.href).href),
      import(new URL('js/core/customer-profile.js', location.href).href),
      import(new URL('js/core/customer-history.js', location.href).href),
    ]);
    const order = getState().orders.find((candidate) => candidate.id === id);
    const profile = rememberCustomerProfileFromOrder(order, { rememberCustomer: true });
    const history = recordCustomerOrder(order);
    return { profile, history };
  }, orderId);
  assert(
    result?.profile?.ok
      && result?.profile?.remembered
      && result?.history?.ok,
    'No se pudo preparar la recompra consentida para la evidencia.',
  );
}

async function runViewport(browser, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    locale: 'es-AR',
    serviceWorkers: 'block',
    permissions: ['geolocation'],
    geolocation: {
      latitude: -38.95161,
      longitude: -68.05912,
      accuracy: 11,
    },
  });
  await context.grantPermissions(['geolocation'], { origin: new URL(BASE_URL).origin });
  const page = await context.newPage();
  page.on('pageerror', (error) => report.errors.push(`${viewport.tag}: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (!text.includes('Service Worker') && !text.includes('Failed to load resource')) {
      report.errors.push(`${viewport.tag}: console: ${text}`);
    }
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    const url = response.url();
    if (url.startsWith(new URL(BASE_URL).origin)) {
      report.failedResponses.push(`${viewport.tag}: ${response.status()} ${url}`);
    }
  });
  await page.addInitScript(() => {
    window.open = () => null;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => {}, readText: async () => '' },
    });
  });

  try {
    let sceneIndex = 1;
    await openFresh(page);
    await capture(page, viewport, 'home-new', sceneIndex++);

    await goToView(page, 'catalog');
    await capture(page, viewport, 'catalog', sceneIndex++);

    const search = page.locator('[data-view="catalog"] [data-search-input]');
    await search.fill('producto que no existe');
    await page.waitForTimeout(180);
    await capture(page, viewport, 'no-results', sceneIndex++);
    await search.fill('');
    await page.waitForTimeout(180);

    await page.locator('[data-product-grid] [data-product-detail]').first().click();
    await page.locator('[data-product-modal]').waitFor({ state: 'visible' });
    await capture(page, viewport, 'product', sceneIndex++);
    await page.keyboard.press('Escape');
    await page.locator('[data-product-modal]').waitFor({ state: 'hidden' });

    await addFirstAvailable(page, 'gaseosas');
    await goToView(page, 'cart');
    await capture(page, viewport, 'cart', sceneIndex++);
    await fillCheckout(page);
    assert(!(await page.locator('[data-age-confirmation]').isVisible()), 'Edad visible sin alcohol.');
    await capture(page, viewport, 'checkout-no-alcohol', sceneIndex++);

    await addFirstAvailable(page, 'cervezas');
    await goToView(page, 'cart');
    await fillCheckout(page);
    const age = page.locator('[name="ageConfirmed"]');
    assert(await page.locator('[data-age-confirmation]').isVisible(), 'Edad oculta con alcohol.');
    assert(await age.getAttribute('required') !== null, 'Edad no requerida con alcohol.');
    await age.check();
    await capture(page, viewport, 'checkout-alcohol', sceneIndex++);

    await page.locator('[data-checkout-submit]').click();
    await waitForApp(page, 'tracking');
    const order = await activeOrder(page);
    assert(order?.id, 'Checkout no creó el pedido aislado de preview.');

    await unlockBusiness(page);
    await page.locator(`[data-inbox-order="${order.id}"]`).waitFor({ state: 'visible' });
    await capture(page, viewport, 'business', sceneIndex++);
    await advanceToReady(page, order.id);

    await goToView(page, 'rider');
    await page.locator(`[data-rider-accept="${order.id}"]`).waitFor({ state: 'visible' });
    await capture(page, viewport, 'rider-before-accept', sceneIndex++);
    await acceptDelivery(page, order.id);

    await goToView(page, 'tracking');
    assert(!(await page.locator('[data-real-map]').isVisible()), 'Mapa visible antes de un GPS válido.');
    await capture(page, viewport, 'tracking-no-gps', sceneIndex++);

    await startDeliveryWithGps(page, order.id);
    await goToView(page, 'tracking');
    await page.locator('[data-tracking-panel] [data-real-map]').waitFor({ state: 'visible', timeout: 12_000 }).catch(async (error) => {
      const debug = await page.evaluate(async (id) => {
        const { getState } = await import(new URL('js/state.js', location.href).href);
        const state = getState();
        return {
          order: state.orders.find((candidate) => candidate.id === id),
          simulation: state.simulation,
          trackingText: document.querySelector('[data-tracking-panel]')?.innerText,
        };
      }, order.id);
      throw new Error(`GPS válido sin mapa visible: ${JSON.stringify(debug)}\n${error.message}`);
    });
    await capture(page, viewport, 'tracking-with-gps', sceneIndex++);

    await goToView(page, 'rider');
    const resumedGps = await page.evaluate(async () => {
      const { enableGpsTracking } = await import(new URL('js/simulation.js', location.href).href);
      return enableGpsTracking();
    });
    assert(resumedGps?.ok, resumedGps?.message || 'No se pudo reanudar el GPS al volver a rider.');
    await page.locator('[data-delivery-panel] [data-real-map]').waitFor({ state: 'visible', timeout: 12_000 });
    await capture(page, viewport, 'rider-delivering', sceneIndex++);
    const deliveryCode = await arriveDelivery(page, order.id);
    await capture(page, viewport, 'tracking-arriving', sceneIndex++);
    await finishDelivery(page, order.id, deliveryCode);

    await goToView(page, 'tracking');
    assert(!(await page.locator('[data-real-map]').isVisible()), 'Mapa sigue visible tras entregar.');
    await capture(page, viewport, 'tracking-delivered', sceneIndex++);

    await persistReorderHistory(page, order.id);
    await goToView(page, 'home');
    await page.locator('[data-customer-actions] .reorder-card').waitFor({ state: 'visible' });
    await capture(page, viewport, 'home-recurrent', sceneIndex++);
  } finally {
    await context.close();
  }
}

let failure;
const browser = await chromium.launch();
try {
  for (const viewport of activeViewports) {
    console.log(`\n— ${round}: ${viewport.tag} ${viewport.width}×${viewport.height} —`);
    await runViewport(browser, viewport);
  }
  const expected = activeViewports.length * SCENES.length;
  assert(report.captures.length === expected, `Se generaron ${report.captures.length}/${expected} capturas.`);
  const failedAudits = report.captures.filter((entry) => !entry.passed);
  assert(!failedAudits.length, `${failedAudits.length} capturas no aprobaron el audit visual automático.`);
  assert(!report.errors.length, `${report.errors.length} errores de consola/página.`);
  assert(!report.failedResponses.length, `${report.failedResponses.length} rutas locales fallaron.`);
  report.result = 'passed';
} catch (error) {
  failure = error;
  report.result = 'failed';
  report.failure = error instanceof Error ? error.stack : String(error);
} finally {
  await browser.close();
  report.finishedAt = new Date().toISOString();
  writeFileSync(path.join(outDir, manifestName), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

if (failure) throw failure;
console.log(`\n${round}: ${report.captures.length} capturas aprobadas en ${outDir}`);
