// Prueba rápida de la vista lista en el Moto: abre el catálogo, toca el botón y captura.
import path from 'node:path';
import { connect, sleep, tap, screencap, BASE, adb } from './moto.mjs';
const etapa = process.argv[2] || 'despues';
const out = path.resolve('artifacts/catalog-transformation-20261024/capturas', etapa, 'moto-real');
const { browser, page } = await connect();
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); indexedDB.deleteDatabase('taba-sandbox'); });
await page.goto(`${BASE}/?demo=1&vitrina=neuquen20261024&n=${Date.now()}#catalog`, { waitUntil: 'load' });
await page.waitForSelector('[data-view="catalog"] [data-product-grid] article[data-card-product]', { timeout: 30000 });
await sleep(1500);
for (let i = 0; i < 3; i++) { const o = await page.evaluate(() => !!document.querySelector('[data-install-sheet][open]')); if (!o) break; await tap(page, page.locator('[data-install-sheet] [data-install-decline]:visible').first()); await sleep(500); }
screencap(path.join(out, 'lista-0-grilla.png'));
await tap(page, '[data-view="catalog"] [data-catalog-layout-toggle]');
await sleep(900);
screencap(path.join(out, 'lista-1-lista.png'));
const m = await page.evaluate(() => {
  const nav = document.querySelector('.mobile-nav').getBoundingClientRect();
  const top = document.querySelector('.topbar').getBoundingClientRect();
  const cards = [...document.querySelectorAll('[data-view="catalog"] [data-product-grid] article[data-card-product]')];
  const rows = cards.slice(0, 10).map((c) => { const r = c.getBoundingClientRect(); const a = c.querySelector('[data-add-product]')?.getBoundingClientRect(); const p = c.querySelector('.price strong')?.getBoundingClientRect(); return { y: Math.round(r.y), h: Math.round(r.height), visible: r.top >= top.bottom - 1 && r.bottom <= nav.top + 1, addH: a && Math.round(a.height), addW: a && Math.round(a.width), priceOk: p && p.bottom <= nav.top }; });
  return { layout: document.querySelector('[data-product-grid]').dataset.catalogLayout, completas: rows.filter((r) => r.visible).length, rows, overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth };
});
console.log(JSON.stringify(m));
await browser.close();
