// READ-ONLY recon: busqueda -> tarjeta -> agregar -> carrito -> checkout (SIN confirmar).
import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const BASE = 'https://la-taba.pages.dev';
const log = [];
const say = (...a) => { const s = a.join(' '); log.push(s); console.log(s); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', locale: 'es-AR' });
await ctx.addInitScript(() => {
  try { localStorage.setItem('TABA_INSTALL_PROMPT_V1', JSON.stringify({ dismissedAt: Date.now(), choice: 'later' })); } catch (e) {}
});
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2500);

const outer = (sel, n = 1) => page.evaluate(([s, k]) => {
  const el = document.querySelectorAll(s)[k - 1];
  return el ? el.outerHTML : `(no existe: ${s} #${k})`;
}, [sel, n]);

// ---------- PASO 1: BUSQUEDA ----------
say('\n########## PASO 1 — BUSQUEDA ##########');
const searchInputs = await page.evaluate(() => [...document.querySelectorAll('[data-search-input]')].map((n, i) => ({
  index: i,
  placeholder: n.placeholder,
  visible: !!(n.offsetParent || n.getClientRects().length),
  ownerView: n.closest('[data-view]')?.getAttribute('data-view') || '(fuera de vista)',
  hasSearchJump: n.hasAttribute('data-search-jump'),
  outer: n.outerHTML,
})));
say(JSON.stringify(searchInputs, null, 1));

const search = page.locator('[data-search-input]:visible').first();
await search.click();
await search.fill('Coca-Cola');
await page.waitForTimeout(2500);
say('view activa tras buscar:', await page.evaluate(() => document.querySelector('[data-active-view]')?.getAttribute('data-active-view')
  || document.querySelector('.app-view.is-active')?.getAttribute('data-view')));
await page.screenshot({ path: `${OUT}/02-busqueda-coca.png` });

const catalogHead = await page.evaluate(() => ({
  title: document.querySelector('[data-catalog-title]')?.textContent?.trim(),
  count: document.querySelector('[data-catalog-count]')?.textContent?.trim(),
  countOuter: document.querySelector('[data-catalog-count]')?.outerHTML,
  clearSearch: document.querySelector('[data-clear-search]')?.outerHTML,
}));
say('=== CABECERA CATALOGO ===\n' + JSON.stringify(catalogHead, null, 1));

// ---------- PASO 2: TARJETA ----------
say('\n########## PASO 2 — TARJETA DE PRODUCTO ##########');
const grid = await page.evaluate(() => {
  const g = document.querySelector('[data-product-grid]');
  return { sel: '[data-product-grid]', tag: g?.tagName, cls: g?.className, cards: g?.querySelectorAll('.product-card').length };
});
say('grid:', JSON.stringify(grid));

const cards = await page.evaluate(() => [...document.querySelectorAll('[data-product-grid] .product-card')].slice(0, 4).map((c) => ({
  name: c.querySelector('h3')?.textContent?.trim(),
  presentation: c.querySelector('.product-body > p')?.textContent?.trim(),
  brand: c.querySelector('.product-brand, .brand-line')?.textContent?.trim(),
  priceStrong: c.querySelector('.price strong')?.textContent?.trim(),
  priceAll: c.querySelector('.price')?.textContent?.trim().replace(/\s+/g, ' '),
  addBtn: c.querySelector('[data-add-product]')?.outerHTML,
  productDetail: c.querySelector('[data-product-detail]')?.getAttribute('data-product-detail'),
  productNameAttr: c.querySelector('[data-product-name]')?.getAttribute('data-product-name'),
  classes: c.className,
})));
say('=== 4 TARJETAS ===\n' + JSON.stringify(cards, null, 1));
say('=== HTML COMPLETO TARJETA 1 ===\n' + await outer('[data-product-grid] .product-card'));

// donde vive data-product-name
say('=== data-product-name (nodo) ===\n' + await page.evaluate(() => {
  const n = document.querySelector('[data-product-grid] [data-product-name]');
  return n ? `${n.tagName}.${n.className} -> "${n.getAttribute('data-product-name')}" (dentro de ${n.closest('.product-card') ? '.product-card' : '???'})` : 'no hay';
}));

// ---------- PASO 3: AGREGAR ----------
say('\n########## PASO 3 — AGREGAR 1 UNIDAD ##########');
const firstBuyable = page.locator('[data-product-grid] .product-card:not(.out-of-stock)').filter({ has: page.locator('[data-add-product]:not([disabled])') }).first();
const chosenName = await firstBuyable.locator('h3').textContent();
say('producto elegido:', chosenName.trim());
await firstBuyable.locator('[data-add-product]').click();
await page.waitForTimeout(1500);

say('=== TARJETA TRAS AGREGAR ===\n' + await page.evaluate((nm) => {
  const c = [...document.querySelectorAll('.product-card')].find((x) => x.querySelector('h3')?.textContent.trim() === nm);
  return c ? c.querySelector('.product-action')?.outerHTML : 'no encontrada';
}, chosenName.trim()));

say('qty leida:', await page.evaluate((nm) => {
  const c = [...document.querySelectorAll('.product-card')].find((x) => x.querySelector('h3')?.textContent.trim() === nm);
  return c?.querySelector('.qty-stepper strong')?.textContent;
}, chosenName.trim()));

say('=== CONTADORES GLOBALES ===\n' + JSON.stringify(await page.evaluate(() => ({
  cartCount: [...document.querySelectorAll('[data-cart-count]')].map((n) => n.textContent.trim()),
  floatingCartCount: document.querySelector('[data-floating-cart-count]')?.textContent?.trim(),
  floatingCartLabel: document.querySelector('[data-floating-cart-label]')?.textContent?.trim(),
  floatingCartSummary: document.querySelector('[data-floating-cart-summary]')?.textContent?.trim().replace(/\s+/g, ' '),
  floatingCartOuter: document.querySelector('[data-floating-cart]')?.outerHTML?.slice(0, 900),
  navCart: document.querySelector('[data-nav-view="cart"]')?.innerText?.replace(/\s+/g, ' '),
  cartTotalSmall: document.querySelector('[data-cart-total-small]')?.textContent?.trim(),
})), null, 1));
await page.screenshot({ path: `${OUT}/03-agregado.png` });

// sumar y restar
await page.locator('.product-card .qty-stepper [data-cart-inc]').first().click();
await page.waitForTimeout(900);
say('tras +1:', await page.locator('.product-card .qty-stepper strong').first().textContent());
await page.locator('.product-card .qty-stepper [data-cart-dec]').first().click();
await page.waitForTimeout(900);
say('tras -1:', await page.locator('.product-card .qty-stepper strong').first().textContent());

// ---------- PASO 4: CARRITO ----------
say('\n########## PASO 4 — CARRITO ##########');
await page.locator('[data-nav-view="cart"]:visible, [data-open-cart]:visible').first().click();
await page.waitForTimeout(2000);
say('view activa:', await page.evaluate(() => document.querySelector('.app-view.is-active')?.getAttribute('data-view')));
await page.screenshot({ path: `${OUT}/04-carrito.png`, fullPage: true });

say('=== CART LIST ===\n' + await outer('[data-cart-list]'));

say('\n=== TOTALES / RESUMEN ===\n' + await page.evaluate(() => {
  const s = document.querySelector('[data-order-summary]');
  return s ? s.outerHTML : 'no hay [data-order-summary]';
}));

say('\n=== DATA ATTRS EN VISTA CART ===\n' + JSON.stringify(await page.evaluate(() => {
  const root = document.querySelector('[data-view="cart"]');
  const m = new Map();
  root.querySelectorAll('*').forEach((n) => { for (const k of Object.keys(n.dataset || {})) m.set(k, (m.get(k) || 0) + 1); });
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
})));

fs.writeFileSync(`${OUT}/recon-02-flow.txt`, log.join('\n'), 'utf8');
say('\n--- guardado, siguiendo a checkout en recon-03 ---');
await ctx.storageState({ path: `${OUT}/.state-carrito.json` });
await browser.close();
