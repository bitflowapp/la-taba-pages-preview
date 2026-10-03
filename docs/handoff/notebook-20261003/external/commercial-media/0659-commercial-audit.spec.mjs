import { test } from 'E:/DevCache/Npm/_npx/77dbaf41d727fd82/node_modules/@playwright/test/index.mjs';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://taba2-staging.pages.dev';
const OUTPUT = 'C:/Users/marco/Documents/New project/artifacts/taba2-commercial/before';
const VIEWPORTS = [320, 360, 390, 432].map((width) => ({ width, height: 844 }));

test('commercial storefront audit', async ({ browser }) => {
  test.setTimeout(240_000);
  await mkdir(OUTPUT, { recursive: true });

  const diagnostics = {
    generatedAt: new Date().toISOString(),
    baseURL: BASE,
    browser: await browser.version(),
    viewports: VIEWPORTS,
    captures: [],
    organic: { console: [], pageErrors: [], requestsFailed: [], httpErrors: [], requests: [] },
    resilience: { console: [], pageErrors: [], requestsFailed: [], httpErrors: [] },
    milestones: {},
    persistence: {},
    clearCartDialogButtons: [],
    invalidHash: {},
    startupFailure: {},
    paymentReturn: {},
  };

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'es-AR',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  installDiagnostics(page, diagnostics.organic);
  await page.addInitScript(() => {
    window.__commercialAuditPerformance = { cls: 0, lcp: 0, longTasks: [] };
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__commercialAuditPerformance.lcp = entry.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) window.__commercialAuditPerformance.cls += entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__commercialAuditPerformance.longTasks.push({ start: entry.startTime, duration: entry.duration });
        }
      }).observe({ type: 'longtask', buffered: true });
    } catch {}
  });

  try {
    const started = Date.now();
    const response = await page.goto(`${BASE}/?commercial-audit=${Date.now()}#home`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    diagnostics.milestones.documentResponseStatus = response?.status() ?? null;
    await page.waitForSelector('[data-view="home"].is-active', { timeout: 15_000 });
    await page.locator('[data-view="home"] [data-add-product]:visible:not([disabled])').first().waitFor({ timeout: 15_000 });
    diagnostics.milestones.firstBuyableProductMsFromGoto = Date.now() - started;
    await settle(page);
    diagnostics.milestones.initialPerformance = await readPerformance(page);

    await captureWidths(page, diagnostics, '01-home', 'Home storefront');

    await restoreViewport(page);
    await page.locator('[data-view="home"] [data-category-id="cervezas"]:visible').first().click();
    await page.waitForSelector('[data-view="catalog"].is-active');
    await settle(page);
    await captureWidths(page, diagnostics, '02-category-cervezas', 'Category · Cervezas');

    await restoreViewport(page);
    const search = page.locator('[data-view="catalog"] input[type="search"]:visible').first();
    await search.fill('Heineken');
    await page.waitForTimeout(250);
    await captureWidths(page, diagnostics, '03-search-results', 'Search · Heineken');

    await restoreViewport(page);
    await search.fill('producto-inexistente-987654');
    await page.waitForTimeout(250);
    await captureWidths(page, diagnostics, '04-search-empty', 'Empty search results');

    await restoreViewport(page);
    await search.fill('');
    await page.waitForTimeout(250);
    await page.locator('[data-view="catalog"] [data-product-detail]:visible').first().click();
    await page.locator('[data-product-modal]:visible').waitFor({ timeout: 5_000 });
    await captureWidths(page, diagnostics, '05-product', 'Product detail modal');

    await restoreViewport(page);
    const productModal = page.locator('[data-product-modal]:visible');
    const closeProduct = productModal.locator('[data-close-modal]:visible');
    if (await closeProduct.count()) await closeProduct.first().click();
    else await page.keyboard.press('Escape');
    await productModal.waitFor({ state: 'hidden', timeout: 5_000 });
    await page.locator('[data-view="catalog"] [data-add-product]:visible:not([disabled])').first().click();
    await page.waitForTimeout(300);
    await captureWidths(page, diagnostics, '06-added-feedback', 'Immediate add-to-cart feedback');

    await restoreViewport(page);
    const openCart = page.locator('[data-floating-cart][data-open-cart]:visible, [data-open-cart]:visible').first();
    await openCart.click();
    await page.waitForSelector('[data-view="cart"].is-active');
    await page.evaluate(() => scrollTo(0, 0));
    await settle(page);
    diagnostics.persistence.beforeReload = await cartState(page);
    await captureWidths(page, diagnostics, '07-cart', 'Cart with one product');

    await restoreViewport(page);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('[data-view="cart"].is-active', { timeout: 15_000 });
    await page.waitForTimeout(2_500);
    await settle(page);
    diagnostics.persistence.afterReload = await cartState(page);
    diagnostics.persistence.passed = diagnostics.persistence.beforeReload.quantity === diagnostics.persistence.afterReload.quantity
      && diagnostics.persistence.beforeReload.total === diagnostics.persistence.afterReload.total
      && diagnostics.persistence.afterReload.quantity > 0;
    await captureWidths(page, diagnostics, '08-cart-after-reload', 'Cart after reload');

    if (!diagnostics.persistence.afterReload.hasHeineken) {
      await restoreViewport(page);
      await page.locator('[data-nav-view="catalog"]:visible').first().click();
      await page.waitForSelector('[data-view="catalog"].is-active');
      await page.locator('[data-view="catalog"] [data-add-product]:visible:not([disabled])').first().click();
      await page.waitForTimeout(250);
      await page.locator('[data-open-cart]:visible').first().click();
      await page.waitForSelector('[data-view="cart"].is-active');
    }

    await restoreViewport(page);
    const checkoutForm = page.locator('[data-checkout-form]:visible');
    await checkoutForm.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    await captureWidths(page, diagnostics, '09-checkout-gated', 'Checkout gated by missing customer data/address', { preserveScroll: true });

    await restoreViewport(page);
    await page.locator('[data-profile-checkout-action="edit-profile"]:visible').click();
    await page.waitForSelector('[data-view="profile"].is-active');
    await page.getByRole('button', { name: 'Completar datos' }).waitFor({ timeout: 10_000 });
    await page.evaluate(() => scrollTo(0, 0));
    await captureWidths(page, diagnostics, '10-profile-empty', 'Empty customer profile');

    await restoreViewport(page);
    await page.locator('[data-profile-action="edit-personal"]:visible').click();
    const profileView = page.locator('[data-view="profile"]');
    await profileView.getByLabel('Nombre y apellido').fill('Cliente Auditor');
    await profileView.getByLabel('Teléfono').fill('2615550101');
    await profileView.locator('[data-profile-action="save-personal"]:visible').click();
    await profileView.getByText('Cliente Auditor', { exact: true }).waitFor({ timeout: 5_000 });
    await captureWidths(page, diagnostics, '11-profile-complete', 'Customer profile with local audit data');

    await restoreViewport(page);
    await page.locator('[data-profile-action="add-address"]:visible').click();
    await profileView.locator('[name="profileAddressStreet"]:visible').waitFor({ timeout: 5_000 });
    await profileView.getByText('NUEVA DIRECCIÓN', { exact: true }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    await captureWidths(page, diagnostics, '12-address-editor', 'Address editor before map/GPS boundary', { preserveScroll: true });

    await restoreViewport(page);
    await page.locator('[data-profile-action="cancel-address"]:visible').first().click();
    await page.locator('[data-nav-view="cart"]:visible').first().click();
    await page.waitForSelector('[data-view="cart"].is-active');
    await page.getByLabel('Retiro en local').check();
    await page.getByLabel('Confirmo que soy mayor de 18 años').check();
    const submit = page.locator('[data-checkout-submit]:visible');
    await submit.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    diagnostics.milestones.pickupCheckout = {
      disabled: await submit.isDisabled(),
      text: (await submit.innerText()).trim(),
    };
    await captureWidths(page, diagnostics, '13-checkout-pickup-ready', 'Checkout ready for pickup; not submitted', { preserveScroll: true });

    await restoreViewport(page);
    await page.locator('[data-clear-cart]:visible').click();
    const clearDialog = page.locator('[data-clear-cart-modal][open]');
    await clearDialog.waitFor({ timeout: 5_000 });
    diagnostics.clearCartDialogButtons = await clearDialog.locator('button:visible').allInnerTexts();
    await captureWidths(page, diagnostics, '14-clear-cart-confirmation', 'Clear-cart confirmation');
    await restoreViewport(page);
    const explicitConfirm = clearDialog.locator('[data-clear-cart-confirm]:visible');
    if (await explicitConfirm.count()) await explicitConfirm.first().click();
    else await clearDialog.getByRole('button', { name: /vaciar|confirmar|sí/i }).last().click();
    await clearDialog.waitFor({ state: 'hidden', timeout: 5_000 });
    await page.waitForTimeout(200);
    await page.evaluate(() => scrollTo(0, 0));
    await captureWidths(page, diagnostics, '15-cart-empty', 'Empty cart state');

    await restoreViewport(page);
    const invalidResponse = await page.goto(`${BASE}/ruta-inexistente-audit`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    diagnostics.milestones.invalidRouteStatus = invalidResponse?.status() ?? null;
    await page.waitForSelector('[data-view].is-active', { timeout: 15_000 });
    await settle(page);
    diagnostics.milestones.invalidRouteResolved = {
      url: page.url(),
      activeView: await page.locator('[data-view].is-active').getAttribute('data-view'),
      heading: await page.locator('h1:visible,h2:visible').first().innerText().catch(() => ''),
      bodyExcerpt: (await page.locator('body').innerText()).slice(0, 500),
    };
    await captureWidths(page, diagnostics, '16-invalid-route', 'Direct invalid path');

    await restoreViewport(page);
    await page.goto(`${BASE}/#ruta-inexistente-audit`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('[data-view].is-active', { timeout: 15_000 });
    await settle(page);
    diagnostics.invalidHash = {
      url: page.url(),
      activeView: await page.locator('[data-view].is-active').getAttribute('data-view'),
      heading: await page.locator('h1:visible,h2:visible').first().innerText().catch(() => ''),
      bodyExcerpt: (await page.locator('body').innerText()).slice(0, 500),
    };
    await captureWidths(page, diagnostics, '17-invalid-hash', 'Direct invalid hash');
  } finally {
    await context.close();
  }

  const resilienceContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'es-AR',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  const resiliencePage = await resilienceContext.newPage();
  installDiagnostics(resiliencePage, diagnostics.resilience);
  await resiliencePage.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== BASE && ['xhr', 'fetch'].includes(request.resourceType())) {
      await route.abort('failed');
    } else {
      await route.continue();
    }
  });
  try {
    await resiliencePage.goto(`${BASE}/?commercial-audit=backend-unavailable`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await resiliencePage.waitForSelector('[data-view="home"].is-active', { timeout: 15_000 });
    await resiliencePage.waitForTimeout(3_000);
    await captureWidths(resiliencePage, diagnostics, '18-backend-unavailable', 'Simulated remote API outage', { channel: 'resilience' });
  } finally {
    await resilienceContext.close();
  }

  const startupContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'es-AR',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  const startupPage = await startupContext.newPage();
  await startupPage.route('**/js/app.js*', (route) => route.abort('failed'));
  try {
    await startupPage.goto(`${BASE}/?commercial-audit=startup-module-failure`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const recoveryPanel = startupPage.locator('[data-app-recovery]');
    const autoShown = await recoveryPanel.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false);
    if (!autoShown) {
      await startupPage.evaluate(() => window.TABA_STARTUP_RECOVERY?.show?.());
      await recoveryPanel.waitFor({ state: 'visible', timeout: 2_000 });
    }
    diagnostics.startupFailure = {
      autoShown,
      text: (await recoveryPanel.innerText()).trim(),
      code: (await recoveryPanel.locator('[data-app-recovery-code]').innerText()).trim(),
      resetVisible: await recoveryPanel.locator('[data-app-recovery-reset]').isVisible(),
      url: startupPage.url(),
    };
    await captureWidths(startupPage, diagnostics, '19-startup-module-failure', 'Forced startup module failure', { channel: 'resilience' });
  } finally {
    await startupContext.close();
  }

  const paymentContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'es-AR',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  const paymentPage = await paymentContext.newPage();
  try {
    const paymentResponse = await paymentPage.goto(`${BASE}/pago/resultado/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await paymentPage.locator('[data-payment-return-title]').waitFor({ timeout: 10_000 });
    await paymentPage.waitForFunction(() => document.querySelector('[data-payment-return-title]')?.textContent !== 'Estado del pago', null, { timeout: 10_000 });
    diagnostics.paymentReturn = {
      responseStatus: paymentResponse?.status() ?? null,
      title: (await paymentPage.locator('[data-payment-return-title]').innerText()).trim(),
      detail: (await paymentPage.locator('[data-payment-return-detail]').innerText()).trim(),
      status: (await paymentPage.locator('[data-payment-return-status]').innerText()).trim(),
      action: (await paymentPage.locator('[data-payment-return-action]').innerText()).trim(),
      actionHref: await paymentPage.locator('[data-payment-return-action]').getAttribute('href'),
    };
    await captureWidths(paymentPage, diagnostics, '20-payment-return-missing-session', 'Payment return without browser checkout session', { channel: 'resilience' });
  } finally {
    await paymentContext.close();
  }

  diagnostics.organic.requests = compactRequests(diagnostics.organic.requests);
  diagnostics.organic.console = compactMessages(diagnostics.organic.console);
  diagnostics.organic.pageErrors = compactMessages(diagnostics.organic.pageErrors);
  diagnostics.organic.requestsFailed = compactObjects(diagnostics.organic.requestsFailed);
  diagnostics.organic.httpErrors = compactObjects(diagnostics.organic.httpErrors);
  diagnostics.resilience.console = compactMessages(diagnostics.resilience.console);
  diagnostics.resilience.pageErrors = compactMessages(diagnostics.resilience.pageErrors);
  diagnostics.resilience.requestsFailed = compactObjects(diagnostics.resilience.requestsFailed);
  diagnostics.resilience.httpErrors = compactObjects(diagnostics.resilience.httpErrors);
  await writeFile(path.join(OUTPUT, 'diagnostics.json'), `${JSON.stringify(diagnostics, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    captureCount: diagnostics.captures.length,
    persistence: diagnostics.persistence,
    organicConsoleErrors: diagnostics.organic.console.length,
    organicPageErrors: diagnostics.organic.pageErrors.length,
    organicFailedRequests: diagnostics.organic.requestsFailed.length,
    organicHttpErrors: diagnostics.organic.httpErrors.length,
    maxDocumentOverflow: Math.max(...diagnostics.captures.map((capture) => capture.geometry.documentHorizontalOverflow)),
    maxUndersizedTargets: Math.max(...diagnostics.captures.map((capture) => capture.geometry.undersizedTargets.length)),
    maxCoveredTargets: Math.max(...diagnostics.captures.map((capture) => capture.geometry.coveredTargets.length)),
  }, null, 2));
});

function installDiagnostics(page, target) {
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      target.console.push({ type: message.type(), text: message.text(), url: page.url() });
    }
  });
  page.on('pageerror', (error) => target.pageErrors.push({ text: error.message, url: page.url() }));
  page.on('request', (request) => target.requests?.push({ method: request.method(), type: request.resourceType(), url: request.url() }));
  page.on('requestfailed', (request) => target.requestsFailed.push({ method: request.method(), type: request.resourceType(), url: request.url(), error: request.failure()?.errorText || '' }));
  page.on('response', (response) => {
    if (response.status() >= 400) target.httpErrors.push({ status: response.status(), url: response.url() });
  });
}

async function captureWidths(page, diagnostics, prefix, state, options = {}) {
  const originalScroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    if (options.preserveScroll) await page.evaluate(({ x, y }) => scrollTo(x, y), originalScroll);
    else await page.evaluate(() => scrollTo(0, 0));
    await settle(page);
    const filename = `${prefix}-${viewport.width}x${viewport.height}.png`;
    const filePath = path.join(OUTPUT, filename);
    const geometry = await readGeometry(page);
    await page.screenshot({ path: filePath, fullPage: false, animations: 'disabled', caret: 'hide' });
    const sha256 = createHash('sha256').update(await readFile(filePath)).digest('hex');
    diagnostics.captures.push({
      filename,
      path: filePath,
      state,
      channel: options.channel || 'organic',
      viewport: `${viewport.width}x${viewport.height}`,
      url: page.url(),
      sha256,
      geometry,
    });
  }
  await restoreViewport(page);
  if (options.preserveScroll) await page.evaluate(({ x, y }) => scrollTo(x, y), originalScroll);
}

async function restoreViewport(page) {
  await page.setViewportSize({ width: 390, height: 844 });
}

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts?.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.waitForTimeout(80);
}

async function cartState(page) {
  return page.evaluate(() => {
    const view = document.querySelector('[data-view="cart"].is-active');
    const badge = document.querySelector('[data-nav-view="cart"] [data-cart-count], [data-nav-view="cart"] .nav-badge');
    const total = [...(view?.querySelectorAll('*') || [])].find((node) => node.children.length === 0 && /^\$/.test((node.textContent || '').trim()))?.textContent?.trim() || '';
    const itemText = view?.innerText || '';
    const quantityMatch = itemText.match(/Heineken[\s\S]{0,120}?\n(\d+)\n\+/);
    return {
      quantity: Number(quantityMatch?.[1] || badge?.textContent?.trim() || (itemText.includes('Heineken') ? 1 : 0)),
      total,
      hasHeineken: itemText.includes('Heineken'),
      excerpt: itemText.slice(0, 700),
    };
  });
}

async function readPerformance(page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource');
    const transferSize = resources.reduce((sum, entry) => sum + (entry.transferSize || 0), 0);
    return {
      lcpMs: Math.round(window.__commercialAuditPerformance?.lcp || 0),
      cls: Number((window.__commercialAuditPerformance?.cls || 0).toFixed(4)),
      longTasks: window.__commercialAuditPerformance?.longTasks || [],
      domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      loadMs: nav ? Math.round(nav.loadEventEnd) : null,
      responseStartMs: nav ? Math.round(nav.responseStart) : null,
      resourceCount: resources.length,
      transferSizeBytes: transferSize,
      paints: Object.fromEntries(performance.getEntriesByType('paint').map((entry) => [entry.name, Math.round(entry.startTime)])),
    };
  });
}

async function readGeometry(page) {
  return page.evaluate(() => {
    const rendered = (node) => {
      if (!node || !node.getClientRects().length) return false;
      const style = getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
    };
    const inViewport = (rect) => rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
    const describe = (node) => {
      const rect = node.getBoundingClientRect();
      return {
        tag: node.tagName,
        text: (node.getAttribute('aria-label') || node.innerText || node.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100),
        data: Object.fromEntries(Object.entries(node.dataset || {}).slice(0, 5)),
        className: String(node.className || '').slice(0, 180),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height), right: Math.round(rect.right), bottom: Math.round(rect.bottom) },
      };
    };
    const root = document.documentElement;
    const visibleDialog = [...document.querySelectorAll('dialog,[role="dialog"],[data-product-modal],[data-clear-cart-modal]')].find((node) => rendered(node) && inViewport(node.getBoundingClientRect()));
    const activeView = document.querySelector('[data-view].is-active');
    const scope = visibleDialog || activeView || document.body;
    const interactive = [...document.querySelectorAll('button,a[href],input:not([type="hidden"]),select,textarea,[role="button"]')]
      .filter(rendered);
    const effectiveTarget = (node) => {
      if ((node.matches('input[type="checkbox"],input[type="radio"]'))) {
        const label = node.closest('label') || (node.id ? document.querySelector(`label[for="${CSS.escape(node.id)}"]`) : null);
        if (label && rendered(label)) return label;
      }
      return node;
    };
    const uniqueTargets = [...new Set(interactive.map(effectiveTarget))];
    const undersizedTargets = uniqueTargets.filter((node) => {
      const rect = node.getBoundingClientRect();
      return inViewport(rect) && (rect.width < 44 || rect.height < 44);
    }).slice(0, 40).map(describe);
    const coveredTargets = uniqueTargets.filter((node) => {
      const rect = node.getBoundingClientRect();
      if (!inViewport(rect)) return false;
      const x = Math.min(innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
      const y = Math.min(innerHeight - 1, Math.max(0, rect.top + rect.height / 2));
      const top = document.elementFromPoint(x, y);
      return top && top !== node && !node.contains(top) && !top.contains(node);
    }).slice(0, 30).map(describe);
    const bottomNav = [...document.querySelectorAll('nav,.bottom-nav,[data-bottom-nav]')].find((node) => {
      if (!rendered(node)) return false;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return ['fixed', 'sticky'].includes(style.position) && rect.bottom >= innerHeight - 2 && rect.top > innerHeight / 2;
    });
    const navRect = bottomNav?.getBoundingClientRect();
    const ctas = [...document.querySelectorAll('[data-checkout-submit],[data-floating-cart],[data-profile-action="save-personal"],[data-profile-action="save-address"],button[type="submit"]')].filter(rendered);
    const bottomNavOverlaps = navRect ? ctas.filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.bottom > navRect.top && rect.top < navRect.bottom;
    }).map(describe) : [];
    const horizontalControlClipping = uniqueTargets.filter((node) => {
      const rect = node.getBoundingClientRect();
      return inViewport(rect) && (rect.left < -1 || rect.right > innerWidth + 1);
    }).slice(0, 30).map(describe);
    const scopeRect = scope?.getBoundingClientRect();
    return {
      activeView: document.body.dataset.activeView || activeView?.dataset.view || '',
      scope: visibleDialog ? (visibleDialog.getAttribute('data-product-modal') !== null ? 'product-modal' : visibleDialog.className || visibleDialog.tagName) : activeView?.dataset.view || 'body',
      viewport: { width: innerWidth, height: innerHeight },
      scroll: { x: scrollX, y: scrollY, documentHeight: root.scrollHeight },
      documentHorizontalOverflow: Math.max(0, root.scrollWidth - root.clientWidth),
      scopeHorizontalOverflow: scope ? Math.max(0, scope.scrollWidth - scope.clientWidth) : 0,
      scopeRect: scopeRect ? { x: Math.round(scopeRect.x), y: Math.round(scopeRect.y), width: Math.round(scopeRect.width), height: Math.round(scopeRect.height) } : null,
      undersizedTargets,
      coveredTargets,
      horizontalControlClipping,
      bottomNav: navRect ? { top: Math.round(navRect.top), bottom: Math.round(navRect.bottom), height: Math.round(navRect.height) } : null,
      bottomNavOverlaps,
      visibleTextExcerpt: (scope?.innerText || '').trim().replace(/\n{3,}/g, '\n\n').slice(0, 1800),
    };
  });
}

function compactMessages(messages) {
  const map = new Map();
  for (const item of messages) {
    const key = `${item.type || ''}|${item.text}|${item.url || ''}`;
    map.set(key, { ...item, count: (map.get(key)?.count || 0) + 1 });
  }
  return [...map.values()];
}

function compactObjects(items) {
  const map = new Map();
  for (const item of items) {
    const key = JSON.stringify(item);
    map.set(key, { ...item, count: (map.get(key)?.count || 0) + 1 });
  }
  return [...map.values()];
}

function compactRequests(items) {
  const map = new Map();
  for (const item of items) {
    let url = item.url;
    try {
      const parsed = new URL(url);
      parsed.search = '';
      url = parsed.href;
    } catch {}
    const key = `${item.method}|${item.type}|${url}`;
    map.set(key, { ...item, url, count: (map.get(key)?.count || 0) + 1 });
  }
  return [...map.values()];
}
