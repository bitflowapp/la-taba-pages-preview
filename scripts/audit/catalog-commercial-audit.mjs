/*
 * AUDITORÍA COMERCIAL DEL CATÁLOGO, TOCANDO LA TIENDA COMO UN CLIENTE.
 *
 * Recorre CADA producto que la tienda muestra (la lista sale de las filas
 * públicas de producción y se contrasta con el DOM) y para cada uno ejecuta la
 * acción de verdad: toca la imagen, abre la ficha, toca el nombre, busca el
 * control de compra, lo toca y comprueba el carrito.
 *
 * Es de SÓLO LECTURA contra producción: el carrito vive en el navegador y no se
 * confirma ningún pedido. No escribe nada en el servidor.
 *
 *   node scripts/audit/catalog-commercial-audit.mjs \
 *        --base=https://la-taba.pages.dev/ --engine=chromium --viewport=390x844 \
 *        --rows=<prod-products.json> --out=<dir> [--only=sku1,sku2]
 *
 * Escribe `<out>/products-<engine>-<viewport>.json`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, webkit } from '@playwright/test';
import { openRuntimeCatalog } from '../../tests/e2e/catalog-runtime-fixture.mjs';

const arg = (name, fallback = '') => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

// `--local=http://127.0.0.1:8099` ejecuta el MISMO recorrido contra el código del
// árbol de trabajo, con las filas de `--fixture` servidas por el backend en
// memoria de las pruebas (nada sale a la red). Sin `--local`, producción.
const LOCAL = arg('local');
const FIXTURE = LOCAL ? JSON.parse(fs.readFileSync(arg('fixture', 'tests/fixtures/catalog-live.json'), 'utf8')).products : null;
const BASE = LOCAL || arg('base', 'https://la-taba.pages.dev/');
const ENGINE = arg('engine', 'chromium');
const [VW, VH] = arg('viewport', '390x844').split('x').map(Number);
const OUT = arg('out', 'artifacts/catalog-commercial-audit-20261009/raw');
const ROWS = JSON.parse(fs.readFileSync(arg('rows'), 'utf8')).rows;
const ONLY = arg('only').split(',').filter(Boolean);
const MOBILE = VW < 700;
const TAG = `${ENGINE}-${VW}x${VH}`;

fs.mkdirSync(OUT, { recursive: true });

function launch() {
  return (ENGINE === 'webkit' ? webkit : chromium).launch();
}

async function freshPage(browser, hash = '#catalog') {
  const origin = new URL(BASE).origin;
  const context = await browser.newContext({
    viewport: { width: VW, height: VH },
    deviceScaleFactor: MOBILE ? 2 : 1,
    hasTouch: MOBILE,
    isMobile: MOBILE && ENGINE !== 'firefox',
    serviceWorkers: 'block',
    locale: 'es-AR',
    ...(LOCAL ? { baseURL: LOCAL } : {
      storageState: { cookies: [], origins: [{ origin, localStorage: [{ name: 'TABA_INSTALL_PROMPT_V1', value: '{"outcome":"dismissed"}' }] }] },
    }),
  });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message.slice(0, 160)}`));
  page.on('console', (message) => { if (message.type() === 'error') problems.push(`console: ${message.text().slice(0, 160)}`); });
  page.on('response', (response) => {
    if (response.status() >= 400 && !/supabase\.co\/(auth|realtime)/.test(response.url())) problems.push(`http ${response.status()}: ${response.url().slice(0, 140)}`);
  });
  if (LOCAL) {
    await openRuntimeCatalog(page, { catalogRows: FIXTURE, view: hash === '#catalog' ? 'catalog' : 'home', waitForCatalog: hash === '#catalog' });
  } else {
    await page.goto(new URL(hash, BASE).toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 });
  }
  return { page, context, problems };
}

const tap = (locator) => (MOBILE ? locator.tap({ timeout: 8000 }) : locator.click({ timeout: 8000 }));

/** Lo que el cliente ve en una tarjeta del catálogo. */
async function readCard(page, id) {
  return page.evaluate((productId) => {
    const card = document.querySelector(`[data-view="catalog"] [data-card-product="${CSS.escape(productId)}"]`);
    if (!card) return null;
    card.scrollIntoView({ block: 'center' });
    const img = card.querySelector('img');
    const media = card.querySelector('[data-product-detail]');
    const action = card.querySelector('.product-action button');
    const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const hit = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return top ? (el === top || el.contains(top)) : false;
    };
    return {
      cls: card.className,
      title: card.querySelector('h3')?.innerText.trim() ?? '',
      line: card.querySelector('.product-body > p')?.innerText.trim() ?? '',
      brand: card.querySelector('.product-brand')?.innerText.trim() ?? '',
      priceText: card.querySelector('.product-foot')?.innerText.replace(/\s+/g, ' ').trim() ?? '',
      pill: card.querySelector('.product-stock-tag')?.innerText.trim() ?? '',
      age: Boolean(card.querySelector('.product-age-tag')),
      img: img ? { src: img.currentSrc || img.src, complete: img.complete, nw: img.naturalWidth, nh: img.naturalHeight, rw: Math.round(img.getBoundingClientRect().width), rh: Math.round(img.getBoundingClientRect().height), placeholder: /placeholder/.test(img.currentSrc || img.src) || img.classList.contains('is-placeholder'), fit: getComputedStyle(img).objectFit } : null,
      media: { box: box(media), clickable: hit(media), label: media?.getAttribute('aria-label') ?? '' },
      action: action ? { text: action.innerText.replace(/\s+/g, ' ').trim(), disabled: action.disabled, label: action.getAttribute('aria-label') ?? '', box: box(action), clickable: hit(action), cls: action.className } : null,
    };
  }, id);
}

async function readModal(page) {
  return page.evaluate(() => {
    const modal = document.querySelector('[data-product-modal]');
    if (!modal?.open) return null;
    const q = (s) => modal.querySelector(s);
    const control = q('.modal-cart-control');
    const r = control?.getBoundingClientRect();
    const hit = r ? document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) : null;
    const img = q('.modal-media img');
    return {
      id: q('[data-modal-product-id]')?.dataset.modalProductId ?? '',
      title: q('h2')?.innerText.trim() ?? '',
      presentation: q('.modal-presentation')?.innerText.trim() ?? '',
      price: q('.modal-price')?.innerText.replace(/\s+/g, ' ').trim() ?? '',
      availability: q('.modal-availability')?.innerText.trim() ?? '',
      pending: Boolean(q('[data-price-pending-message]')),
      variants: [...modal.querySelectorAll('[data-product-variant]')].map((v) => ({ id: v.value, disabled: v.disabled, checked: v.checked })),
      control: control ? { tag: control.tagName, text: control.innerText.replace(/\s+/g, ' ').trim(), disabled: control.disabled === true, isStepper: control.classList.contains('qty-stepper'), reachable: hit ? (control === hit || control.contains(hit)) : false, y: Math.round(r.y), h: Math.round(r.height), vh: innerHeight } : null,
      note: q('.modal-pending-note')?.innerText.trim() ?? '',
      img: img ? { src: img.currentSrc, nw: img.naturalWidth, complete: img.complete, placeholder: /placeholder/.test(img.currentSrc) } : null,
    };
  });
}

async function readCart(page) {
  return page.evaluate(() => [...document.querySelectorAll('[data-view="cart"] .cart-item')].map((item) => ({
    text: item.innerText.replace(/\s+/g, ' ').trim().slice(0, 160),
    qty: (item.querySelector('.quantity-control strong, [data-combo-quantity]')?.innerText || '').trim() || null,
    line: item.querySelector('.cart-line')?.innerText.trim() ?? null,
  })));
}

async function auditProduct(browser, row) {
  const result = { sku: row.sku, id: row.id, steps: {}, problems: [] };
  const { page, context, problems } = await freshPage(browser);
  try {
    await page.waitForSelector('[data-view="catalog"] [data-card-product]', { timeout: 30_000 });
    await page.waitForTimeout(600);
    const card = await readCard(page, row.id);
    result.card = card;
    if (!card) { result.steps.card = 'NO-CARD'; return result; }
    result.steps.card = 'OK';
    await page.waitForTimeout(250);
    const cardSel = `[data-view="catalog"] [data-card-product="${row.id}"]`;

    // 1 · la imagen: tocarla abre la ficha correcta.
    await tap(page.locator(`${cardSel} [data-product-detail]`).first());
    await page.waitForTimeout(500);
    let modal = await readModal(page);
    result.modal = modal;
    result.steps.openFromImage = modal ? (modal.id === row.id ? 'OK' : `WRONG(${modal.id})`) : 'NO-MODAL';
    if (modal) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      result.steps.closeEscape = (await readModal(page)) ? 'STILL-OPEN' : 'OK';
    }

    // 2 · el nombre también abre la ficha.
    await tap(page.locator(`${cardSel} .product-name-link`));
    await page.waitForTimeout(400);
    modal = await readModal(page);
    result.steps.openFromName = modal?.id === row.id ? 'OK' : (modal ? `WRONG(${modal.id})` : 'NO-MODAL');
    if (modal) { await tap(page.locator('[data-product-modal] [data-close-modal]').first()); await page.waitForTimeout(250); }

    // 3 · la compra directa desde la tarjeta.
    const action = card.action;
    if (!action) { result.steps.add = 'NO-ACTION'; }
    else if (action.disabled) { result.steps.add = `BLOCKED(${action.text})`; }
    else {
      await tap(page.locator(`${cardSel} .product-action button`).first());
      await page.waitForTimeout(500);
      const qtyText = await page.locator(`${cardSel} .qty-stepper strong`).first().innerText().catch(() => '');
      result.steps.add = /^\d+$/.test(String(qtyText).trim()) ? 'OK' : 'NO-RESPONSE';
      result.afterAdd = qtyText;
      // 4 · carrito.
      await tap(page.locator('[data-nav-view="cart"]:visible').first());
      await page.waitForTimeout(500);
      const lines = await readCart(page);
      result.cart = lines;
      result.steps.cart = lines.length === 1 && lines[0].qty === '1' ? 'OK' : `LINES(${lines.length})`;
    }
  } catch (error) {
    result.steps.error = String(error.message).split('\n')[0].slice(0, 200);
  } finally {
    result.problems = problems.slice(0, 8);
    await context.close();
  }
  return result;
}

const browser = await launch();
const rows = ROWS.filter((row) => !ONLY.length || ONLY.includes(row.sku));
const out = [];
for (const row of rows) {
  const r = await auditProduct(browser, row);
  out.push(r);
  console.log(`${r.sku}  card=${r.steps.card} img=${r.steps.openFromImage} name=${r.steps.openFromName} add=${r.steps.add} cart=${r.steps.cart ?? '-'} ${r.steps.error ?? ''}`);
}
fs.writeFileSync(path.join(OUT, `products-${TAG}.json`), JSON.stringify(out, null, 1));
await browser.close();
