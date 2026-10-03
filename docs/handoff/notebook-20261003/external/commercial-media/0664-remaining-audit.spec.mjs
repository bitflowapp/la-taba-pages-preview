import { test } from 'E:/DevCache/Npm/_npx/77dbaf41d727fd82/node_modules/@playwright/test/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://taba2-staging.pages.dev';
const OUTPUT = 'C:/Users/marco/Documents/New project/artifacts/taba2-commercial/before';
const SIZES = [320, 360, 390, 432].map((width) => ({ width, height: 844 }));
const report = { generatedAt: new Date().toISOString(), scenarios: {}, console: [], pageErrors: [], requestFailures: [], httpErrors: [], captures: [] };

test.beforeAll(async () => mkdir(OUTPUT, { recursive: true }));
test.afterAll(async () => writeFile(path.join(OUTPUT, 'remaining-diagnostics.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8'));

test('address editor', async ({ browser }) => {
  test.setTimeout(60_000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-AR', reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await context.newPage();
  watch(page, 'address');
  try {
    await page.goto(`${BASE}/?commercial-audit=address#profile`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForSelector('[data-view="profile"].is-active', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Completar datos' }).waitFor({ timeout: 12_000 });
    await page.locator('[data-profile-action="edit-personal"]:visible').click();
    const profile = page.locator('[data-view="profile"]');
    await profile.getByLabel('Nombre y apellido').fill('Cliente Auditor');
    await profile.getByLabel('Teléfono').fill('2615550101');
    await profile.locator('[data-profile-action="save-personal"]:visible').click();
    await profile.getByText('Cliente Auditor', { exact: true }).waitFor({ timeout: 12_000 });
    await page.locator('[data-profile-action="add-address"]:visible').click({ timeout: 5_000 });
    await profile.locator('[name="profileAddressStreet"]:visible').waitFor({ timeout: 5_000 });
    await profile.getByText('NUEVA DIRECCIÓN', { exact: true }).scrollIntoViewIfNeeded();
    report.scenarios.address = { body: (await profile.innerText()).slice(0, 3000) };
    await capture(page, '12-address-editor', 'Address editor before map/GPS boundary');
  } finally {
    await context.close();
  }
});

test('empty and invalid routes', async ({ browser }) => {
  test.setTimeout(60_000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-AR', reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await context.newPage();
  watch(page, 'routes');
  try {
    await page.goto(`${BASE}/?commercial-audit=empty#cart`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForSelector('[data-view="cart"].is-active', { timeout: 15_000 });
    await page.waitForTimeout(1_000);
    report.scenarios.emptyCart = { body: (await page.locator('[data-view="cart"]').innerText()).slice(0, 1500) };
    await capture(page, '15-cart-empty', 'Empty cart state');

    const pathResponse = await page.goto(`${BASE}/ruta-inexistente-audit`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForSelector('[data-view].is-active', { timeout: 15_000 });
    await page.waitForTimeout(500);
    report.scenarios.invalidPath = await routeState(page, pathResponse?.status());
    await capture(page, '16-invalid-route', 'Direct invalid path');

    await page.goto(`${BASE}/#ruta-inexistente-audit`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForSelector('[data-view].is-active', { timeout: 15_000 });
    await page.waitForTimeout(500);
    report.scenarios.invalidHash = await routeState(page, null);
    await capture(page, '17-invalid-hash', 'Direct invalid hash');
  } finally {
    await context.close();
  }
});

test('backend unavailable', async ({ browser }) => {
  test.setTimeout(45_000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-AR', reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await context.newPage();
  watch(page, 'backend-unavailable');
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== BASE && ['xhr', 'fetch'].includes(request.resourceType())) await route.abort('failed');
    else await route.continue();
  });
  try {
    await page.goto(`${BASE}/?commercial-audit=backend-unavailable`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForSelector('[data-view="home"].is-active', { timeout: 15_000 });
    await page.waitForTimeout(3_000);
    report.scenarios.backendUnavailable = { body: (await page.locator('body').innerText()).slice(0, 2500) };
    await capture(page, '18-backend-unavailable', 'Simulated remote API outage');
  } finally {
    await context.close();
  }
});

test('startup module failure', async ({ browser }) => {
  test.setTimeout(45_000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-AR', reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await context.newPage();
  watch(page, 'startup-failure');
  await page.route('**/js/app.js*', (route) => route.abort('failed'));
  try {
    await page.goto(`${BASE}/?commercial-audit=startup-module-failure`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    const panel = page.locator('[data-app-recovery]');
    const autoShown = await panel.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false);
    if (!autoShown) {
      await page.evaluate(() => window.TABA_STARTUP_RECOVERY?.show?.());
      await panel.waitFor({ state: 'visible', timeout: 2_000 });
    }
    report.scenarios.startupFailure = {
      autoShown,
      text: (await panel.innerText()).trim(),
      code: (await panel.locator('[data-app-recovery-code]').innerText()).trim(),
      resetVisible: await panel.locator('[data-app-recovery-reset]').isVisible(),
    };
    await capture(page, '19-startup-module-failure', 'Forced startup module failure');
  } finally {
    await context.close();
  }
});

test('payment return missing session', async ({ browser }) => {
  test.setTimeout(45_000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-AR', reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await context.newPage();
  watch(page, 'payment-return');
  try {
    const response = await page.goto(`${BASE}/pago/resultado/`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForFunction(() => document.querySelector('[data-payment-return-title]')?.textContent !== 'Estado del pago', null, { timeout: 10_000 });
    report.scenarios.paymentReturn = {
      responseStatus: response?.status() ?? null,
      title: (await page.locator('[data-payment-return-title]').innerText()).trim(),
      detail: (await page.locator('[data-payment-return-detail]').innerText()).trim(),
      status: (await page.locator('[data-payment-return-status]').innerText()).trim(),
      action: (await page.locator('[data-payment-return-action]').innerText()).trim(),
    };
    await capture(page, '20-payment-return-missing-session', 'Payment return without browser checkout session');
  } finally {
    await context.close();
  }
});

function watch(page, scenario) {
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) report.console.push({ scenario, type: message.type(), text: message.text(), url: page.url() });
  });
  page.on('pageerror', (error) => report.pageErrors.push({ scenario, text: error.message, url: page.url() }));
  page.on('requestfailed', (request) => report.requestFailures.push({ scenario, method: request.method(), type: request.resourceType(), url: request.url(), error: request.failure()?.errorText || '' }));
  page.on('response', (response) => {
    if (response.status() >= 400) report.httpErrors.push({ scenario, status: response.status(), url: response.url() });
  });
}

async function capture(page, prefix, state) {
  const original = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await page.evaluate(({ x, y }) => scrollTo(x, y), original);
    await page.evaluate(async () => { await document.fonts?.ready; await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
    const geometry = await page.evaluate(() => {
      const root = document.documentElement;
      const visible = (node) => node?.getClientRects().length && getComputedStyle(node).visibility !== 'hidden' && getComputedStyle(node).display !== 'none';
      const targets = [...document.querySelectorAll('button,a[href],input:not([type="hidden"]),select,textarea,[role="button"]')].filter(visible);
      const labelTarget = (node) => node.matches('input[type="checkbox"],input[type="radio"]') ? node.closest('label') || node : node;
      const unique = [...new Set(targets.map(labelTarget))];
      const describe = (node) => { const r = node.getBoundingClientRect(); return { text: (node.getAttribute('aria-label') || node.innerText || node.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100), tag: node.tagName, width: Math.round(r.width), height: Math.round(r.height), x: Math.round(r.x), right: Math.round(r.right), y: Math.round(r.y), bottom: Math.round(r.bottom) }; };
      return {
        activeView: document.querySelector('[data-view].is-active')?.getAttribute('data-view') || '',
        viewport: { width: innerWidth, height: innerHeight },
        scrollY,
        documentHeight: root.scrollHeight,
        horizontalOverflow: Math.max(0, root.scrollWidth - root.clientWidth),
        undersizedVisibleTargets: unique.filter((node) => { const r = node.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && (r.width < 44 || r.height < 44); }).slice(0, 40).map(describe),
        horizontallyClippedTargets: unique.filter((node) => { const r = node.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && (r.left < -1 || r.right > innerWidth + 1); }).slice(0, 30).map(describe),
        bodyExcerpt: document.body.innerText.slice(0, 1800),
      };
    });
    const filename = `${prefix}-${size.width}x${size.height}.png`;
    await page.screenshot({ path: path.join(OUTPUT, filename), fullPage: false, animations: 'disabled', caret: 'hide' });
    report.captures.push({ filename, state, url: page.url(), viewport: `${size.width}x${size.height}`, geometry });
  }
}

async function routeState(page, responseStatus) {
  return {
    responseStatus,
    url: page.url(),
    activeView: await page.locator('[data-view].is-active').getAttribute('data-view'),
    heading: await page.locator('h1:visible,h2:visible').first().innerText().catch(() => ''),
    body: (await page.locator('body').innerText()).slice(0, 1000),
  };
}
