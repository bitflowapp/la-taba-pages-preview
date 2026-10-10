/*
 * AUDITORÍA DE PROMOCIONES Y PIEZAS PUBLICITARIAS, TOCANDO COMO UN CLIENTE.
 *
 * Encuentra TODAS las piezas que prometen un producto en las superficies
 * públicas (banda de la home, franja intermedia, pieza de grilla, puerta
 * editorial, historias, carrusel de promociones, combos) y para cada una:
 *
 *   1 · mapa de impactos: qué recibe un toque en cada punto de la pieza
 *   2 · toca el centro, la foto, el precio y la acción
 *   3 · comprueba qué se abre y si es el producto prometido
 *   4 · busca el control de compra y lo toca
 *   5 · comprueba el carrito (línea, cantidad, precio)
 *
 * SÓLO LECTURA contra producción (carrito local, ningún pedido).
 *
 *   node scripts/audit/promotion-audit.mjs --base=https://la-taba.pages.dev/ \
 *        --engine=webkit --viewport=390x844 --out=<dir>
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
const SHOTS = arg('shots', '');
const MOBILE = VW < 700;
const TAG = `${ENGINE}-${VW}x${VH}`;
fs.mkdirSync(OUT, { recursive: true });
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

async function freshPage(browser, hash = '') {
  const origin = new URL(BASE).origin;
  const context = await browser.newContext({
    viewport: { width: VW, height: VH }, deviceScaleFactor: MOBILE ? 2 : 1, hasTouch: MOBILE, isMobile: MOBILE,
    serviceWorkers: 'block', locale: 'es-AR',
    ...(LOCAL ? { baseURL: LOCAL } : {
      storageState: { cookies: [], origins: [{ origin, localStorage: [{ name: 'TABA_INSTALL_PROMPT_V1', value: '{"outcome":"dismissed"}' }] }] },
    }),
  });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message.slice(0, 160)}`));
  page.on('console', (message) => { if (message.type() === 'error') problems.push(`console: ${message.text().slice(0, 160)}`); });
  if (LOCAL) {
    await openRuntimeCatalog(page, { catalogRows: FIXTURE, view: hash === '#catalog' ? 'catalog' : 'home', waitForCatalog: hash === '#catalog' });
  } else {
    await page.goto(new URL(hash, BASE).toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 });
  }
  await page.waitForSelector('[data-product-detail]', { state: 'attached', timeout: 30_000 });
  await page.waitForTimeout(1800);
  return { page, context, problems };
}

const tapAt = async (page, x, y) => {
  if (MOBILE) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
};

const modalState = (page) => page.evaluate(() => {
  const modal = document.querySelector('[data-product-modal]');
  if (!modal?.open) return null;
  const control = modal.querySelector('.modal-cart-control');
  const r = control?.getBoundingClientRect();
  const top = r ? document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) : null;
  return {
    id: modal.querySelector('[data-modal-product-id]')?.dataset.modalProductId ?? '',
    title: modal.querySelector('h2')?.innerText.trim() ?? '',
    price: modal.querySelector('.modal-price')?.innerText.replace(/\s+/g, ' ').trim() ?? '',
    control: control ? { text: control.innerText.replace(/\s+/g, ' ').trim(), disabled: control.disabled === true, reachable: Boolean(top && (control === top || control.contains(top))), visibleWithoutScroll: r.y + r.height <= innerHeight && r.y >= 0 } : null,
  };
});

/** Qué recibe cada punto de la pieza: cta, dismiss, legal u otra cosa. */
async function hitMap(page, selector) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return null;
    root.scrollIntoView({ block: 'center' });
    const r = root.getBoundingClientRect();
    const counts = {};
    const cols = 16, rows = 6;
    for (let i = 0; i < cols; i += 1) {
      for (let j = 0; j < rows; j += 1) {
        const x = r.x + (r.width * (i + 0.5)) / cols;
        const y = r.y + (r.height * (j + 0.5)) / rows;
        const el = document.elementFromPoint(x, y);
        let kind = 'outside';
        if (el) {
          if (el.closest('[data-campaign-cta]')) kind = 'cta';
          else if (el.closest('[data-campaign-dismiss]')) kind = 'dismiss';
          else if (el.closest(sel)) kind = `other:${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`;
        }
        counts[kind] = (counts[kind] || 0) + 1;
      }
    }
    return { rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, counts, cells: cols * rows };
  }, selector);
}

async function pieces(page) {
  return page.evaluate(() => [...document.querySelectorAll('[data-campaign]')].map((node) => {
    const r = node.getBoundingClientRect();
    const cta = node.querySelector('[data-campaign-cta]');
    return {
      id: node.dataset.campaign, placement: node.dataset.campaignPlacement,
      visible: r.width > 0 && r.height > 0,
      productId: cta?.dataset.productDetail ?? '',
      text: node.innerText.replace(/\s+/g, ' ').trim(),
      ctaLabel: node.querySelector('.cmp-cta')?.innerText.replace(/\s+/g, ' ').trim() ?? '',
      aria: cta?.getAttribute('aria-label') ?? '',
      price: node.querySelector('.cmp-price-now')?.innerText.trim() ?? '',
      hasAddControl: Boolean(node.querySelector('[data-add-product]')),
      legal: Boolean(node.querySelector('.cmp-legal')),
      box: { w: Math.round(r.width), h: Math.round(r.height) },
    };
  }));
}

async function exercise(browser, surface) {
  const { page, context, problems } = await freshPage(browser, surface.hash);
  const rows = [];
  try {
    if (surface.category) {
      await page.locator(`[data-view="catalog"] [data-category-strip] [data-category-id="${surface.category}"]`).first().click();
      await page.waitForTimeout(800);
    }
    const all = (await pieces(page)).filter((piece) => piece.visible);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${TAG}-${surface.name}.png`) });
    if (!all.length) rows.push({ surface: surface.name, piece: null, note: 'sin pieza visible', problems });
    for (const piece of all) {
      const sel = `[data-campaign="${piece.id}"][data-campaign-placement="${piece.placement}"]`;
      const row = { surface: surface.name, ...piece, hit: await hitMap(page, sel), taps: {} };
      const positions = {
        center: [0.5, 0.5], packshot: [0.82, 0.5], price: [0.22, 0.78], cta: [0.3, 0.88], leftEdge: [0.06, 0.5], topRight: [0.93, 0.18],
        // El control de compra de la pieza, si lo tiene: su centro, no una fracción.
        agregar: null,
      };
      for (const [name, pos] of Object.entries(positions)) {
        const [fx, fy] = pos || [0, 0];
        const { page: p2, context: c2 } = await freshPage(browser, surface.hash);
        try {
          if (surface.category) { await p2.locator(`[data-view="catalog"] [data-category-strip] [data-category-id="${surface.category}"]`).first().click(); await p2.waitForTimeout(800); }
          const info = await p2.evaluate((s) => {
            const el = document.querySelector(s);
            if (!el) return null;
            el.scrollIntoView({ block: 'center' });
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height };
          }, sel);
          if (!info) { row.taps[name] = 'sin-pieza'; continue; }
          await p2.waitForTimeout(250);
          let point;
          if (name === 'agregar') {
            point = await p2.evaluate((s) => {
              const add = document.querySelector(`${s} [data-campaign-add]`);
              if (!add) return null;
              const r = add.getBoundingClientRect();
              return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
            }, sel);
            if (!point) { row.taps[name] = 'sin-control-de-compra'; continue; }
          } else {
            const info2 = await p2.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
            point = { x: info2.x + info2.w * fx, y: info2.y + info2.h * fy };
          }
          await tapAt(p2, point.x, point.y);
          await p2.waitForTimeout(700);
          const state = await modalState(p2);
          const stillThere = await p2.locator(sel).count();
          if (name === 'agregar') {
            const qty = await p2.locator(`${sel} [data-campaign-qty] strong`).first().innerText().catch(() => '');
            await p2.locator('[data-nav-view="cart"]:visible').first().tap().catch(() => p2.locator('[data-nav-view="cart"]:visible').first().click());
            await p2.waitForTimeout(500);
            const lines = await p2.evaluate(() => [...document.querySelectorAll('[data-view="cart"] .cart-item')].map((item) => ({
              text: item.innerText.replace(/\s+/g, ' ').trim().slice(0, 100),
              qty: (item.querySelector('.quantity-control strong')?.innerText || '').trim(),
              line: item.querySelector('.cart-line')?.innerText.trim() ?? '',
            })));
            row.taps[name] = { opened: state ? 'abrio-ficha' : 'agrego-directo', pieceQty: qty.trim(), cartLines: lines };
            continue;
          }
          if (state) row.taps[name] = { opened: state.id === piece.productId ? 'ficha-correcta' : `ficha-OTRA(${state.id})`, control: state.control, price: state.price };
          else if (!stillThere) row.taps[name] = 'pieza-ocultada';
          else if (await p2.locator(`${sel} [data-campaign-qty]`).count()) row.taps[name] = 'agrego-directo (el toque cayó sobre «Agregar»)';
          else row.taps[name] = 'nada';
          if (name === 'center' && state?.control && !state.control.disabled) {
            await p2.locator('[data-product-modal] .modal-cart-control').first().click();
            await p2.waitForTimeout(600);
            await p2.locator('[data-nav-view="cart"]:visible').first().click();
            await p2.waitForTimeout(500);
            row.cart = await p2.evaluate(() => [...document.querySelectorAll('[data-view="cart"] .cart-item')].map((item) => ({
              text: item.innerText.replace(/\s+/g, ' ').trim().slice(0, 120),
              qty: (item.querySelector('.quantity-control strong')?.innerText || '').trim(),
              line: item.querySelector('.cart-line')?.innerText.trim() ?? '',
            })));
          }
        } finally { await c2.close(); }
      }
      rows.push(row);
    }
  } catch (error) {
    rows.push({ surface: surface.name, error: String(error.message).split('\n')[0] });
  } finally {
    await context.close();
  }
  return rows;
}

const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch();
const surfaces = [
  { name: 'home', hash: '' },
  { name: 'catalogo-todo', hash: '#catalog' },
  { name: 'catalogo-gaseosas', hash: '#catalog', category: 'gaseosas' },
  { name: 'catalogo-energizantes', hash: '#catalog', category: 'energizantes' },
  { name: 'catalogo-aguas-saborizadas', hash: '#catalog', category: 'aguas-saborizadas' },
];
const all = [];
for (const surface of surfaces) {
  const rows = await exercise(browser, surface);
  all.push(...rows);
  for (const r of rows) console.log(`${surface.name}: ${r.id ?? r.note ?? r.error}  taps=${JSON.stringify(r.taps ?? {}).slice(0, 400)}`);
}
fs.writeFileSync(path.join(OUT, `promotions-${TAG}.json`), JSON.stringify(all, null, 1));
await browser.close();
