// Capturas antes/después de los dos fixes de iPhone físico.
// "Antes" sirve desde el worktree congelado en HEAD (sin los cambios de esta
// sesión); "después" sirve desde el worktree de trabajo ya corregido.
// Vive FUERA del repositorio de producto.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'screenshots');
const BEFORE = 'http://127.0.0.1:8399';
const AFTER = 'http://127.0.0.1:8099';
const device = devices['iPhone 13'];

const browser = await chromium.launch();

async function shot(base, name, hash, act, seedPayload) {
  const context = await browser.newContext({ ...device });
  const page = await context.newPage();
  // Cada worktree (antes/después) sirve desde un puerto propio, pero un
  // service worker de una corrida previa contra ESE MISMO puerto puede haber
  // quedado registrado en el perfil del navegador y servir un bundle viejo.
  await context.addInitScript(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister())).catch(() => {});
    }
  });
  if (seedPayload) {
    await page.addInitScript((payload) => {
      try {
        localStorage.setItem('la_taba_mvp_v4_state', JSON.stringify(payload.state));
        if (payload.admin) sessionStorage.setItem('la_taba_mvp_v4_admin_unlocked', 'true');
      } catch (_) { /* ignore */ }
    }, seedPayload);
  }
  await page.goto(`${base}/?demo=1${hash}`, { waitUntil: 'load', timeout: 20000 });
  await page.addStyleTag({ content: '[data-app-update-banner]{display:none!important;}' }).catch(() => {});
  if (act) await act(page);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  await context.close();
}

async function scrollToBottom(page) {
  await page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    window.scrollTo({ top: root.scrollHeight, behavior: 'instant' });
  });
}

async function focusCatalogSearch(page) {
  await page.waitForSelector('[data-product-grid] .product-card', { timeout: 15000 });
  await page.locator('[data-view="catalog"] [data-search-input]').focus();
}

async function openCheckoutWithKeyboard(page) {
  await page.waitForSelector('[data-product-grid] .product-card', { timeout: 15000 });
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.waitForTimeout(300);
  await page.locator('[data-floating-cart]').click();
  await page.waitForSelector('[data-checkout-form]', { timeout: 15000 });
  await page.locator('.checkout-instructions summary').click().catch(() => {});
  await page.locator('[name="customerNotes"]').focus();
  await page.setViewportSize({ width: device.viewport.width, height: Math.round(device.viewport.height * 0.55) });
}

async function openProfileEditWithKeyboard(page) {
  await page.waitForSelector('[data-customer-profile]', { timeout: 15000 });
  const editButton = page.locator('[data-customer-profile] button', { hasText: 'Editar' }).first();
  await editButton.click();
  await page.locator('[name="profileFullName"]').focus();
  await page.setViewportSize({ width: device.viewport.width, height: Math.round(device.viewport.height * 0.55) });
}

function seedTrackingState(status) {
  const now = Date.now();
  const at = (min) => new Date(now - min * 60000).toISOString();
  return {
    schemaVersion: 4, dataVersion: 'la-taba-runtime-v2', appMode: 'demo',
    orders: [{
      id: 'LT-7050', customerName: 'Cliente Demo', customerPhone: '2990000007',
      address: 'Mendoza 851, Centro',
      addressDetails: { streetLine: 'Mendoza 851', neighborhood: 'Centro', label: 'Mendoza 851, Centro' },
      deliveryMode: 'delivery', paymentMethod: 'Efectivo al recibir', paymentMethodCode: 'cash', notes: '',
      createdAt: at(18), status,
      items: [{ productId: 'red-bull-original-lata-250ml', name: 'Red Bull', quantity: 2, unitPrice: 3576, unit: 'unidad' }],
      subtotal: 7152, deliveryFee: 0, total: 7152,
      statusHistory: [
        { status: 'received', at: at(18) }, { status: 'preparing', at: at(14) },
        { status: 'ready', at: at(9) }, { status: 'on_the_way', at: at(5) },
      ],
      delivery: { driverName: 'Juli Reparto', driverPhone: '2991112233' },
    }],
    lastOrderId: 'LT-7050', cart: [],
  };
}

function seedBusinessState(count) {
  const now = Date.now();
  const at = (min) => new Date(now - min * 60000).toISOString();
  const statuses = ['received', 'preparing', 'ready', 'on_the_way'];
  const orders = Array.from({ length: count }, (_, i) => ({
    id: `LT-70${i}`, customerName: `Cliente ${i + 1}`, customerPhone: '2990000007',
    address: 'Mendoza 851, Centro',
    addressDetails: { streetLine: 'Mendoza 851', neighborhood: 'Centro', label: 'Mendoza 851, Centro' },
    deliveryMode: i % 2 === 0 ? 'delivery' : 'pickup',
    paymentMethod: 'Efectivo al recibir', paymentMethodCode: 'cash', notes: '',
    createdAt: at(10 + i), status: statuses[i % statuses.length],
    items: [{ productId: 'red-bull-original-lata-250ml', name: 'Red Bull', quantity: 1, unitPrice: 3576, unit: 'unidad' }],
    subtotal: 3576, deliveryFee: 0, total: 3576,
    statusHistory: [{ status: 'received', at: at(10 + i) }],
  }));
  return {
    schemaVersion: 4, dataVersion: 'la-taba-runtime-v2', appMode: 'demo',
    orders, lastOrderId: orders.length ? orders[0].id : null, cart: [],
  };
}

async function seedAdminAndUnlock(page, state) {
  await page.addInitScript((payload) => {
    try {
      localStorage.setItem('la_taba_mvp_v4_state', JSON.stringify(payload));
      sessionStorage.setItem('la_taba_mvp_v4_admin_unlocked', 'true');
    } catch (_) { /* ignore */ }
  }, state);
}

for (const [base, tag] of [[BEFORE, 'before'], [AFTER, 'after']]) {
  await shot(base, `${tag}-catalog-focused`, '#catalog', focusCatalogSearch);
  await shot(base, `${tag}-checkout-keyboard`, '#catalog', openCheckoutWithKeyboard);
  await shot(base, `${tag}-profile-keyboard`, '#profile', openProfileEditWithKeyboard);
  await shot(base, `${tag}-catalog-end`, '#catalog', async (page) => {
    await page.waitForSelector('[data-product-grid] .product-card', { timeout: 15000 });
    await scrollToBottom(page);
  });
  await shot(base, `${tag}-profile-end`, '#profile', async (page) => {
    await page.waitForSelector('[data-customer-profile]', { timeout: 15000 });
    await scrollToBottom(page);
  });
  await shot(base, `${tag}-tracking-end`, '#tracking', async (page) => {
    await page.waitForSelector('[data-tracking-panel] .track-layout', { timeout: 15000 });
    await scrollToBottom(page);
  }, { state: seedTrackingState('on_the_way'), admin: false });
  await shot(base, `${tag}-business-end`, '#business', async (page) => {
    await page.waitForSelector('[data-order-inbox]', { timeout: 15000 });
    await scrollToBottom(page);
  }, { state: seedBusinessState(3), admin: true });
}

await browser.close();
console.log('capturas antes/después generadas');
