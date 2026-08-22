// READ-ONLY: navegacion por hash + capturas finales.
import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = 'D:/1212/la-taba2-gondola-retail-final/artifacts/taba2-go-live-audit/reconocimiento-customer';
const BASE = 'https://la-taba.pages.dev';
const log = [];
const say = (...a) => { const s = a.join(' '); log.push(s); console.log(s); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', locale: 'es-AR' });
await ctx.addInitScript(() => { try { localStorage.setItem('TABA_INSTALL_PROMPT_V1', JSON.stringify({ dismissedAt: Date.now(), choice: 'later' })); } catch (e) {} });
const page = await ctx.newPage();

try {
  say('########## NAVEGACION POR HASH ##########');
  for (const hash of ['#catalog', '#cart', '#tracking', '#profile', '#carrito', '#seguir', '#business']) {
    await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2200);
    const v = await page.evaluate(() => document.querySelector('.app-view.is-active')?.getAttribute('data-view'));
    say(`  ${hash.padEnd(12)} -> vista "${v}" (url final: ${page.url ? '' : ''}${await page.evaluate(() => location.hash)})`);
  }

  // hash sobre pagina ya cargada (sin recargar)
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  say('\n  cambio de hash EN CALIENTE:');
  for (const hash of ['#cart', '#tracking', '#catalog']) {
    await page.evaluate((h) => { window.location.hash = h; }, hash);
    await page.waitForTimeout(1200);
    say(`    ${hash} -> ${await page.evaluate(() => document.querySelector('.app-view.is-active')?.getAttribute('data-view'))}`);
  }

  // ---- captura final del carrito con items ----
  say('\n########## CAPTURA CARRITO CON ITEMS ##########');
  await page.evaluate(() => { window.location.hash = '#catalog'; });
  await page.waitForTimeout(1200);
  await page.locator('[data-view="catalog"] [data-search-input]').fill('Coca-Cola');
  await page.waitForTimeout(2200);
  const ids = await page.locator('[data-product-grid] [data-add-product]').evaluateAll((ns) => ns.slice(0, 2).map((n) => n.getAttribute('data-add-product')));
  for (const id of ids) { await page.locator(`[data-product-grid] [data-add-product="${id}"]`).click(); await page.waitForTimeout(1000); }
  await page.locator(`[data-product-grid] [data-cart-inc="${ids[0]}"]`).click();
  await page.waitForTimeout(1200);
  await page.evaluate(() => { window.location.hash = '#cart'; });
  await page.waitForTimeout(2200);

  // lectura de las lineas TAL COMO la hara el harness
  say('lectura del harness:\n' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[data-cart-list] .cart-item')].map((it) => ({
    nombre: it.querySelector('.cart-title')?.textContent.trim(),
    presentacion: it.querySelector('.cart-meta')?.textContent.trim(),
    cantidad: it.querySelector('.quantity-control strong')?.textContent.trim(),
    totalLinea: it.querySelector('.cart-line')?.textContent.trim(),
    productId: it.querySelector('[data-cart-inc]')?.getAttribute('data-cart-inc'),
  }))), null, 1));

  say('\ntotales del harness:\n' + JSON.stringify(await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-order-summary] .summary-row')];
    const pick = (label) => rows.find((r) => r.querySelector('span')?.textContent.trim().toLowerCase().startsWith(label))?.querySelector('strong')?.textContent.trim();
    return {
      filas: rows.map((r) => [r.className, r.querySelector('span')?.textContent.trim(), r.querySelector('strong')?.textContent.trim()]),
      subtotal: pick('subtotal'),
      envio: pick('env'),
      total: document.querySelector('[data-order-summary] .summary-row.total strong')?.textContent.trim(),
    };
  }), null, 1));

  await page.screenshot({ path: `${OUT}/11-carrito-con-items.png`, fullPage: true });
  await page.locator('[data-profile-checkout]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/12-gate-perfil.png` });
} catch (err) {
  say('\n!!! ERROR:', err.message);
} finally {
  fs.writeFileSync(`${OUT}/recon-05-rutas.txt`, log.join('\n'), 'utf8');
  await browser.close();
}
