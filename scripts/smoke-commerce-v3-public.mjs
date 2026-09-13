// Public HTTPS smoke. Live catalogue/cart/address; fixture-only repeat order.
// Never submits an order or invokes Mercado Pago. Only the existing staging host.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chromium, webkit, devices } from '@playwright/test';

const ROOT = path.resolve(import.meta.dirname, '..');
const BASE = new URL(process.env.TABA_PUBLIC_TEST_URL || 'https://taba2-staging.pages.dev');
assert.equal(BASE.protocol, 'https:');
assert.match(BASE.hostname, /^(?:[a-z0-9-]+\.)?taba2-staging\.pages\.dev$/);
const expected = process.env.TABA_EXPECTED_COMMIT || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
const engine = process.env.ENGINE === 'webkit' ? 'webkit' : 'chromium';
const output = path.resolve(process.env.TABA_COMMERCE_REPORT_DIR || path.join(ROOT, 'artifacts/commerce-v3/public', engine));
fs.mkdirSync(output, { recursive: true });
const report = { url: BASE.origin, expectedCommit: expected, engine, checkedAt: new Date().toISOString(), checks: [], consoleErrors: [], pageErrors: [], forbiddenRequests: [], address: 'not tested', repeatOrder: 'fixture on published app', realMoneyMovement: false };
const check = (name, condition) => { report.checks.push({ name, pass: Boolean(condition) }); assert.ok(condition, name); };
let browser, context, page, addressId = '';
try {
  const versionResponse = await fetch(new URL('/version.json', BASE));
  check('HTTPS version endpoint', versionResponse.ok);
  const version = await versionResponse.json();
  check('published commit matches candidate', version.commit === expected);
  report.publishedCommit = version.commit;
  browser = await (engine === 'webkit' ? webkit : chromium).launch();
  context = await browser.newContext({
    ...(engine === 'webkit' ? devices['iPhone 13'] : { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }),
    serviceWorkers: 'block', locale: 'es-AR',
    geolocation: { latitude: -38.9460616, longitude: -68.0533209, accuracy: 8 }, permissions: ['geolocation'],
  });
  await context.route('**/*', async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (/mercadopago\./.test(url.hostname)
      || /\/functions\/v1\/mercadopago-/.test(url.pathname)
      || /\/rpc\/(create_order|create_checkout|create_mercadopago)/.test(url.pathname)) {
      report.forbiddenRequests.push({ method: request.method(), path: url.pathname });
      return route.abort();
    }
    return route.continue();
  });
  page = await context.newPage();
  page.on('pageerror', (error) => report.pageErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') report.consoleErrors.push(message.text().slice(0, 240)); });
  await page.addInitScript(() => localStorage.setItem('TABA_INSTALL_PROMPT_V1', JSON.stringify({ v: 1, decision: 'declined', at: new Date().toISOString() })));
  const response = await page.goto(BASE.origin, { waitUntil: 'domcontentloaded' });
  await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 45000 });
  check('home loads over HTTPS', response.ok() && new URL(page.url()).protocol === 'https:');
  const runtime = await page.evaluate(() => ({ mode: document.body.dataset.appMode, host: new URL(globalThis.__LA_TABA_RUNTIME_CONFIG__.repository.supabaseUrl).hostname }));
  check('real staging repository, not demo or production DB', runtime.mode === 'production' && runtime.host === 'ukxqbgswjlibmnjemrzd.supabase.co');
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    check(`home no horizontal overflow ${width}`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(output, `home-${width}.png`) });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
  await page.locator('[data-product-grid] .product-card').first().waitFor();
  const product = await page.evaluate(async () => {
    const { getState } = await import('/js/state.js');
    const { isProductOrderable } = await import('/js/core/catalog-store.js');
    const product = getState().products.find((item) => isProductOrderable(item) && item.stock >= 2);
    return product ? { id: product.id, name: product.name, brand: product.brand, price: product.price } : null;
  });
  check('live purchasable catalogue', Boolean(product));
  const search = page.locator('[data-view="catalog"] [data-search-input]');
  await search.fill(product.brand || product.name);
  await page.locator(`[data-product-grid] [data-add-product="${product.id}"]`).waitFor();
  check('search finds real brand/product', await page.locator(`[data-product-grid] [data-add-product="${product.id}"]`).isVisible());
  await search.fill('zzzz-no-existe-commerce');
  check('search empty state', await page.locator('[data-product-grid] .product-card').count() === 0);
  await search.fill('');
  await page.locator(`[data-product-grid] [data-add-product="${product.id}"]`).click();
  await page.locator(`[data-product-grid] [data-cart-inc="${product.id}"]`).click();
  const subtotal = await page.evaluate(async () => (await import('/js/cart.js')).getCartSummary('pickup').subtotal);
  check('cart quantity and current subtotal', subtotal === product.price * 2);
  check('floating cart appears', await page.locator('[data-floating-cart]').isVisible());
  await page.screenshot({ path: path.join(output, 'catalog-cart-390.png') });
  await page.locator('[data-floating-cart]').click();
  check('checkout reached without submitting', await page.locator('[data-checkout-submit]').isVisible());

  // An isolated anonymous QA profile in staging; no order and no notification.
  await page.locator('[data-home-address]').click();
  const editor = page.locator('[data-address-capture="sheet"]');
  await editor.waitFor();
  for (const [field, value] of [['captureCustomerName', 'Prueba Commerce'], ['captureCustomerPhone', '2990000123'], ['captureAddressStreet', 'Mendoza'], ['captureAddressNumber', '827']]) {
    const input = editor.locator(`[name="${field}"]`);
    if (await input.count()) await input.fill(value);
  }
  await editor.locator('[data-profile-action="use-location"]').click();
  await editor.locator('[data-profile-action="confirm-location"]').click();
  await page.screenshot({ path: path.join(output, 'address-390.png') });
  await editor.locator('[data-profile-action="save-address"]').click();
  await page.locator('[data-address-sheet]').waitFor({ state: 'hidden', timeout: 20000 });
  const address = await page.evaluate(async () => (await import('/js/customer-delivery.js')).getActiveDeliveryAddress());
  check('address persisted and selected in live staging', Boolean(address?.id));
  addressId = address.id;
  report.address = 'saved and selected through live staging RPC; QA profile only';
  check('address flow preserves checkout and cart', await page.locator('[data-checkout-submit]').isVisible() && await page.locator('[data-cart-list] .cart-item').count() > 0);
  const total = await page.locator('[data-order-summary] .summary-row.total strong').innerText();
  check('explicit checkout action includes total', (await page.locator('[data-checkout-submit]').innerText()).includes(total));
  await page.screenshot({ path: path.join(output, 'checkout-390.png'), fullPage: true });
  await page.locator('.mobile-nav [data-nav-view="orders"]').click();
  check('owned history route loads', await page.locator('[data-customer-history]').isVisible());
  await page.screenshot({ path: path.join(output, 'orders-live-390.png') });
  await page.evaluate(() => { location.hash = 'business'; });
  await page.locator('[data-view="business"]').waitFor({ state: 'visible', timeout: 15000 });
  check('panel remains gated for a customer', await page.locator('[data-product-complete]').count() === 0);
  await page.screenshot({ path: path.join(output, 'panel-access-390.png') });

  // Cleanup while still on the live repository, before the explicit demo fixture.
  const archived = await page.evaluate(async (id) => (await import('/js/repositories/repository_factory.js')).getOrderRepository().customerProfiles.archive(id), addressId);
  check('QA address archived using ownership-checked RPC', archived?.ok);
  addressId = '';
  await page.goto(`${BASE.origin}/?demo=1#home`, { waitUntil: 'domcontentloaded' });
  await page.locator('html[data-taba-startup="ready"]').waitFor();
  const fixture = await page.evaluate(async () => {
    const { getState, setState } = await import('/js/state.js');
    const { isProductOrderable } = await import('/js/core/catalog-store.js');
    const { recordCustomerOrder } = await import('/js/core/customer-history.js');
    const product = getState().products.find(isProductOrderable);
    recordCustomerOrder({ id: 'LT-PUBLIC-FIXTURE', createdAt: new Date().toISOString(), status: 'delivered', deliveryMode: 'pickup', total: 1,
      items: [{ productId: product.id, name: product.name, quantity: 1, unitPrice: 1 }, { productId: 'missing-fixture', name: 'Producto retirado', quantity: 1, unitPrice: 1 }] });
    setState({ cart: [], comboSelections: [] });
    return { price: product.price, orders: getState().orders.length };
  });
  await page.locator('.mobile-nav [data-nav-view="orders"]').click();
  await page.locator('[data-repeat-order="LT-PUBLIC-FIXTURE"]').click();
  const repeated = await page.evaluate(async () => ({ subtotal: (await import('/js/cart.js')).getCartSummary('pickup').subtotal, orders: (await import('/js/state.js')).getState().orders.length }));
  check('repeat uses current price on published app (fixture)', repeated.subtotal === fixture.price);
  check('repeat requires final confirmation, no automatic order (fixture)', repeated.orders === fixture.orders);
  check('repeat reports unavailable product', (await page.locator('[data-cart-reorder-notice]').innerText()).includes('Producto retirado'));
  await page.screenshot({ path: path.join(output, 'repeat-fixture-390.png') });
  check('no financial/order creation request attempted', report.forbiddenRequests.length === 0);
  check('no uncaught browser error', report.pageErrors.length === 0);
  report.pass = true;
} catch (error) {
  report.pass = false;
  report.failure = error.message;
  process.exitCode = 1;
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
} finally {
  if (addressId && page) {
    await page.evaluate(async (id) => (await import('/js/repositories/repository_factory.js')).getOrderRepository().customerProfiles?.archive(id), addressId).catch(() => {});
  }
  await context?.close();
  await browser?.close();
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ pass: report.pass, checks: report.checks.filter((item) => item.pass).length, total: report.checks.length, engine, failure: report.failure || null, output }));
}
