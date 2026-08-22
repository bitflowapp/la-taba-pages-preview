// READ-ONLY: verifica que el JS servido == JS local, y cierra selectores sueltos.
import { chromium } from 'playwright';
import fs from 'node:fs';
import crypto from 'node:crypto';

const OUT = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const ROOT = new URL('../../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const BASE = 'https://la-taba.pages.dev';
const log = [];
const say = (...a) => { const s = a.join(' '); log.push(s); console.log(s); };
const sha = (t) => crypto.createHash('sha256').update(t.replace(/\r\n/g, '\n'), 'utf8').digest('hex').slice(0, 16);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', locale: 'es-AR' });
await ctx.addInitScript(() => { try { localStorage.setItem('TABA_INSTALL_PROMPT_V1', JSON.stringify({ dismissedAt: Date.now(), choice: 'later' })); } catch (e) {} });
const page = await ctx.newPage();

try {
  // ---- comparacion servido vs local ----
  say('########## JS SERVIDO vs LOCAL ##########');
  for (const rel of ['js/ui.js', 'js/cart.js', 'js/orders.js', 'js/app.js', 'js/core/order-timeline.js', 'js/core/delivery-code.js', 'js/core/order-status.js']) {
    const res = await page.request.get(`${BASE}/${rel}`);
    const served = await res.text();
    const local = fs.readFileSync(`${ROOT}/${rel}`, 'utf8');
    say(`${rel}: HTTP ${res.status()} · servido ${sha(served)} (${served.length}b) · local ${sha(local)} (${local.length}b) · ${sha(served) === sha(local) ? 'IDENTICO' : '*** DIFERENTE ***'}`);
  }

  // marcadores clave en el ui.js servido
  const uiServed = await (await page.request.get(`${BASE}/js/ui.js`)).text();
  for (const marker of ['data-delivery-code-card', 'data-delivery-code="', 'delivery-code-card', 'data-tracking-status', 'data-checkout-submit', 'qty-stepper', 'quantity-control', 'cart-line', 'cart-title', 'cart-meta']) {
    say(`  marcador "${marker}" en ui.js servido: ${uiServed.includes(marker) ? 'SI' : 'NO'}`);
  }

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);

  // ---- buscador del catalogo (el 3ro, dentro de [data-view=catalog]) ----
  say('\n########## BUSCADOR DENTRO DEL CATALOGO ##########');
  await page.locator('[data-nav-view="catalog"]:visible').first().click();
  await page.waitForTimeout(2000);
  say('view activa:', await page.evaluate(() => document.querySelector('.app-view.is-active')?.getAttribute('data-view')));
  say('inputs de busqueda VISIBLES ahora:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[data-search-input]')]
    .map((n) => ({ ph: n.placeholder, vis: !!(n.offsetParent || n.getClientRects().length), view: n.closest('[data-view]')?.dataset.view || 'topbar' })))));

  const catSearch = page.locator('[data-view="catalog"] [data-search-input]');
  await catSearch.fill('Coca-Cola');
  await page.waitForTimeout(2200);
  say('conteo:', await page.locator('[data-catalog-count]').textContent());
  say('tarjetas:', await page.locator('[data-product-grid] .product-card').count());
  await page.screenshot({ path: `${OUT}/09-catalogo-busqueda.png`, fullPage: true });

  // ---- desambiguacion por nombre + presentacion ----
  say('\n########## AMBIGUEDAD DE NOMBRES ##########');
  say(JSON.stringify(await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-product-grid] .product-card')];
    const byName = new Map();
    cards.forEach((c) => {
      const n = c.querySelector('h3')?.textContent.trim();
      byName.set(n, (byName.get(n) || 0) + 1);
    });
    return {
      nombres: cards.map((c) => ({
        h3: c.querySelector('h3')?.textContent.trim(),
        p: c.querySelector('.product-body > p')?.textContent.trim(),
        precio: c.querySelector('.price strong')?.textContent,
        precioCodigos: [...(c.querySelector('.price strong')?.textContent || '')].map((ch) => ch.charCodeAt(0)),
        id: c.querySelector('[data-add-product]')?.getAttribute('data-add-product'),
      })),
      duplicados: [...byName.entries()].filter(([, v]) => v > 1),
    };
  }), null, 1));

  // ---- minimo de compra / avisos que pueden frenar ----
  say('\n########## MINIMO DE COMPRA ##########');
  const id = await page.locator('[data-product-grid] [data-add-product]').first().getAttribute('data-add-product');
  await page.locator(`[data-product-grid] [data-add-product="${id}"]`).click();
  await page.waitForTimeout(1200);
  await page.locator('[data-nav-view="cart"]:visible, [data-open-cart]:visible').first().click();
  await page.waitForTimeout(2200);
  say('[data-cart-minimum-progress]:\n' + await page.evaluate(() => document.querySelector('[data-cart-minimum-progress]')?.outerHTML || 'vacio/NO EXISTE'));
  say('[data-cart-notice]:\n' + await page.evaluate(() => document.querySelector('[data-cart-notice]')?.outerHTML || 'NO EXISTE'));
  say('submit disabled con 1 solo producto?:', await page.evaluate(() => {
    const b = document.querySelector('[data-checkout-submit]');
    return b ? `disabled=${b.disabled} text="${b.textContent.trim()}"` : 'NO EXISTE';
  }));

  // ---- carrito vacio ----
  say('\n########## CARRITO VACIO ##########');
  await page.locator('[data-clear-cart]').click();
  await page.waitForTimeout(900);
  const confirmClear = page.locator('[data-clear-cart-confirm]');
  if (await confirmClear.count()) { await confirmClear.click(); await page.waitForTimeout(1500); }
  say('innerText carrito vacio:\n' + await page.evaluate(() => document.querySelector('[data-view="cart"]')?.innerText));
  say('[data-checkout-phase]:', await page.evaluate(() => document.querySelector('[data-checkout-phase]')?.getAttribute('data-checkout-phase') || '(sin nodo)'));
  say('existe [data-checkout-submit] con carrito vacio?:', await page.evaluate(() => {
    const b = document.querySelector('[data-checkout-submit]');
    return b ? `si, disabled=${b.disabled}, visible=${!!(b.offsetParent || b.getClientRects().length)}` : 'NO';
  }));
  await page.screenshot({ path: `${OUT}/10-carrito-vacio.png`, fullPage: true });
} catch (err) {
  say('\n!!! ERROR:', err.message);
} finally {
  fs.writeFileSync(`${OUT}/recon-04-verificacion.txt`, log.join('\n'), 'utf8');
  await browser.close();
}
