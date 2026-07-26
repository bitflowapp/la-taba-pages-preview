import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const baseUrl = (process.env.QA_BASE_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
const outputDir = path.resolve(
  process.env.QA_PROMOTION_OUTPUT_DIR
    || 'docs/catalog/visual-review/final-products-promotions-2026-07-26/promotion-states-m390',
);
mkdirSync(outputDir, { recursive: true });

const report = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  viewport: { width: 390, height: 844 },
  screenshots: [],
  errors: [],
  failedResponses: [],
  result: 'running',
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function currentPromotion(overrides = {}) {
  return {
    promoId: 'visual-coca-cola-confirmada',
    title: 'Coca-Cola Original 1,5 L x6',
    subtitle: 'Precio especial por pack x6',
    includedSkus: ['qa-promo-bebidas'],
    promotionType: 'precio_promocional',
    regularPrice: 5000,
    promotionalPrice: 4200,
    requiredQuantity: 1,
    active: true,
    priority: 100,
    validFrom: '2020-01-01',
    validUntil: '2099-12-31',
    terms: 'Precio especial por pack x6.',
    previewOnly: true,
    approvalStatus: 'APROBADA',
    approvalReference: 'VISUAL-REVIEW-2026',
    sourceEvidence: 'Escenario efímero de revisión visual.',
    ...overrides,
  };
}

function packPromotion() {
  return currentPromotion({
    promoId: 'visual-monster-pack-confirmado',
    title: 'Monster Energy Original Green x6',
    subtitle: 'Precio especial llevando seis packs',
    includedSkus: ['qa-energetica'],
    promotionType: 'pack',
    regularPrice: 15000,
    promotionalPrice: 12600,
    requiredQuantity: 6,
    maximumUnits: 6,
    priority: 90,
    terms: 'Llevando 6 unidades.',
  });
}

function expiredPromotion() {
  return currentPromotion({
    promoId: 'visual-coca-cola-vencida',
    title: 'Coca-Cola Original 1,5 L x6',
    validFrom: '2020-01-01',
    validUntil: '2020-01-31',
    priority: 10,
  });
}

async function waitForView(page, view) {
  await page.locator(`[data-view="${view}"]`).waitFor({ state: 'visible', timeout: 12_000 });
  await page.waitForTimeout(180);
}

async function goToView(page, view) {
  await page.evaluate((nextView) => { window.location.hash = `#${nextView}`; }, view);
  await waitForView(page, view);
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function setPromotionState(page, promotions) {
  await page.evaluate(async (nextPromotions) => {
    const { updateState } = await import(new URL('js/state.js', location.href).href);
    updateState((draft) => {
      draft.promotions = nextPromotions;
      draft.cart = [];
    });
  }, promotions);
  await page.waitForTimeout(180);
}

async function addProduct(page, productId) {
  await page.evaluate(async (id) => {
    const { addToCart } = await import(new URL('js/cart.js', location.href).href);
    const result = addToCart(id);
    if (!result.ok) throw new Error(result.message || 'No se pudo agregar el producto.');
  }, productId);
  await page.waitForTimeout(180);
}

async function screenshot(page, name, selector = null) {
  if (selector) await page.locator(selector).scrollIntoViewIfNeeded();
  await page.locator('[data-toast]').waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {});
  await page.waitForTimeout(160);
  const target = path.join(outputDir, name);
  await page.screenshot({ path: target, fullPage: false, animations: 'disabled' });
  report.screenshots.push(name);
  console.log(`✓ ${name}`);
}

async function unlockBusiness(page) {
  await goToView(page, 'business');
  if (await page.locator('[data-business-dashboard]').isVisible()) return;
  await page.locator('[data-open-pin][data-admin-target="business"]').first().click();
  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  await page.locator('[data-business-dashboard]').waitFor({ state: 'visible', timeout: 8_000 });
}

const browser = await chromium.launch();
let failure;
try {
  const context = await browser.newContext({ viewport: report.viewport, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('pageerror', (error) => report.errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('Service Worker')) report.errors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && response.url().startsWith(new URL(baseUrl).origin)) {
      report.failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.goto(`${baseUrl}/?reset=1&demo=1#home`, { waitUntil: 'domcontentloaded' });
  await page.locator('.app-shell').waitFor({ state: 'visible' });
  await waitForView(page, 'home');
  await setPromotionState(page, [currentPromotion()]);
  await page.locator('[data-promo-banner]').waitFor({ state: 'visible' });
  await screenshot(page, '01-home-promotion.png');

  await goToView(page, 'catalog');
  await page.locator('[data-view="catalog"] [data-category-id="promos"]').first().click();
  await page.locator('[data-product-grid]').waitFor({ state: 'visible' });
  await screenshot(page, '02-catalog-promotion.png');

  const promoted = page.locator('[data-product-grid] .product-card', { hasText: 'Coca-Cola Original 1,5 L x6' });
  await promoted.locator('[data-product-detail]').click();
  await page.locator('[data-product-modal]').waitFor({ state: 'visible' });
  await screenshot(page, '03-product-promoted.png');
  await page.keyboard.press('Escape');

  await page.locator('[data-view="catalog"] [data-category-id="gaseosas"]').first().click();
  const regular = page.locator('[data-product-grid] .product-card', { hasText: 'Sprite 1,5 L x6' });
  await regular.locator('[data-product-detail]').click();
  await page.locator('[data-product-modal]').waitFor({ state: 'visible' });
  await screenshot(page, '04-product-regular.png');
  await page.keyboard.press('Escape');

  await addProduct(page, 'qa-promo-bebidas');
  await goToView(page, 'cart');
  await page.locator('[data-order-summary]').waitFor({ state: 'visible' });
  assert((await page.locator('[data-order-summary]').innerText()).includes('800'), 'El descuento aprobado no se aplicó en el carrito.');
  await screenshot(page, '05-cart-discount.png', '[data-order-summary]');

  await setPromotionState(page, [packPromotion()]);
  await addProduct(page, 'qa-energetica');
  await goToView(page, 'cart');
  await page.locator('[data-order-summary]').waitFor({ state: 'visible' });
  await page.locator('[data-order-summary]').scrollIntoViewIfNeeded();
  assert((await page.locator('[data-order-summary]').innerText()).includes('Llevando 6 unidades'), 'No se informó la condición de pack incumplida.');
  await screenshot(page, '06-cart-condition-unmet.png', '[data-order-summary]');

  await setPromotionState(page, [expiredPromotion()]);
  await unlockBusiness(page);
  await page.locator('[data-business-view="promotions"]').click();
  const expiredRow = page.locator('[data-promotion-row="visual-coca-cola-vencida"]');
  await expiredRow.waitFor({ state: 'visible' });
  assert((await expiredRow.innerText()).includes('Vencida'), 'La promoción vencida no se distinguió en el negocio.');
  await screenshot(page, '07-promotion-expired.png', '[data-promotion-manager]');

  await expiredRow.locator('[data-promotion-edit]').click();
  await page.locator('[data-promotion-form]').waitFor({ state: 'visible' });
  await screenshot(page, '08-business-edit-promotion.png', '[data-promotion-form]');

  assert(report.errors.length === 0, `Errores de consola: ${report.errors.join(' | ')}`);
  assert(report.failedResponses.length === 0, `Rutas locales fallidas: ${report.failedResponses.join(' | ')}`);
  report.result = 'passed';
  await context.close();
} catch (error) {
  failure = error;
  report.result = 'failed';
  report.failure = error instanceof Error ? error.stack : String(error);
} finally {
  await browser.close();
  report.finishedAt = new Date().toISOString();
  writeFileSync(path.join(outputDir, 'manifest.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

if (failure) throw failure;
console.log(`Promociones revisadas visualmente: ${outputDir}`);
