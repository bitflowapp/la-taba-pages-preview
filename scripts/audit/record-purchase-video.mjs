/*
 * VIDEO CORTO: «el cliente ve una promoción y quiere comprarla».
 *
 * Graba el mismo recorrido en dos servidores —el árbol que tiene el defecto y el
 * que lo corrige— con el catálogo real observado, a 390×844 y con toques de
 * verdad. Deja dos .webm y, si el ffmpeg de Playwright lo permite, uno lado a
 * lado.
 *
 *   node scripts/audit/record-purchase-video.mjs \
 *        --before=http://127.0.0.1:8098 --after=http://127.0.0.1:8099 --out=<dir>
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { openRuntimeCatalog } from '../../tests/e2e/catalog-runtime-fixture.mjs';

const arg = (name, fallback = '') => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const OUT = arg('out', 'artifacts/catalog-commercial-audit-20261009/VIDEO');
fs.mkdirSync(OUT, { recursive: true });
const live = JSON.parse(fs.readFileSync('tests/fixtures/catalog-live.json', 'utf8')).products;

const caption = (page, text, tone) => page.evaluate(([label, color]) => {
  let node = document.querySelector('#audit-caption');
  if (!node) {
    node = document.createElement('div');
    node.id = 'audit-caption';
    node.style.cssText = 'position:fixed;left:8px;right:8px;bottom:84px;z-index:2147483647;padding:10px 12px;border-radius:12px;font:700 14px/1.25 system-ui;color:#fff;text-align:center;pointer-events:none;box-shadow:0 6px 18px rgba(0,0,0,.45)';
    document.body.appendChild(node);
  }
  node.textContent = label;
  node.style.background = color;
}, [text, tone]);

async function record(label, base, steps) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, baseURL: base, serviceWorkers: 'block',
    recordVideo: { dir: path.join(OUT, `raw-${label}`), size: { width: 390, height: 844 } },
  });
  const page = await context.newPage();
  await openRuntimeCatalog(page, { catalogRows: live, view: 'home', waitForCatalog: false, navigationWaitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-home-hero-promo] [data-campaign]', { timeout: 20_000 });
  await page.waitForTimeout(1800);
  await steps(page);
  const video = page.video();
  await context.close();
  const target = path.join(OUT, `${label}.webm`);
  await video.saveAs(target);
  fs.rmSync(path.join(OUT, `raw-${label}`), { recursive: true, force: true });
  await browser.close();
  return target;
}

const pause = (page, ms = 1100) => page.waitForTimeout(ms);

const before = await record('antes', arg('before', 'http://127.0.0.1:8098'), async (page) => {
  await caption(page, 'ANTES · la pieza muestra foto y $ 2.800… pero sólo dice «Ver Red Bull →»', '#8a1f1f');
  await pause(page, 2200);
  const piece = page.locator('[data-home-hero-promo] [data-campaign-cta]');
  await caption(page, 'Toque 1: abre una ficha (todavía no agregó nada)', '#8a1f1f');
  await piece.tap();
  await pause(page, 1600);
  await caption(page, 'Toque 2: «Agregar» recién está acá', '#8a1f1f');
  await pause(page, 900);
  await page.locator('[data-product-modal] .modal-cart-control').first().tap();
  await pause(page, 1200);
  await caption(page, 'Toque 3: ir al carrito', '#8a1f1f');
  await page.locator('[data-nav-view="cart"]:visible').first().tap();
  await pause(page, 1800);
});

const after = await record('despues', arg('after', 'http://127.0.0.1:8099'), async (page) => {
  await caption(page, 'DESPUÉS · la pieza trae su «Agregar» con el precio', '#1f6a3a');
  await pause(page, 2200);
  await caption(page, 'Toque 1: agrega el producto que la pieza muestra', '#1f6a3a');
  await page.locator('[data-home-hero-promo] [data-campaign-add]').tap();
  await pause(page, 1500);
  await caption(page, 'La pieza ya muestra la cantidad; la ficha sigue a un toque', '#1f6a3a');
  await pause(page, 1500);
  await caption(page, 'Toque 2: ir al carrito', '#1f6a3a');
  await page.locator('[data-nav-view="cart"]:visible').first().tap();
  await pause(page, 1800);
});

console.log(JSON.stringify({ before, after }, null, 1));
