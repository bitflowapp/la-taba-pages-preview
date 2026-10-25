// Home del camino PRODUCTIVO (catálogo de Supabase simulado por el arnés de las e2e) en el Moto.
//   node moto-prod-shot.mjs <etapa> [vista]   → capturas reales de la home y de lo que sigue
import path from 'node:path';
import { connect, sleep, screencap, BASE } from './moto.mjs';
import { openRuntimeCatalog } from '../../../tests/e2e/catalog-runtime-fixture.mjs';

const etapa = process.argv[2] || 'despues';
const out = path.resolve('artifacts/catalog-transformation-20261024/capturas', etapa, 'moto-real');
const { browser, page } = await connect();
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); indexedDB.deleteDatabase('taba-sandbox'); });
const origGoto = page.goto.bind(page);
page.goto = (u, o) => origGoto(u.startsWith('/') ? BASE + u : u, o);
await openRuntimeCatalog(page, { view: 'home', waitForCatalog: false });
await sleep(1500);
screencap(path.join(out, 'prod-home-arriba.png'));
await page.evaluate(() => window.scrollTo(0, 700));
await sleep(600);
screencap(path.join(out, 'prod-home-700.png'));
const datos = await page.evaluate(() => ({
  hero: document.querySelector('.home-hero-promo')?.className,
  fondoHero: getComputedStyle(document.querySelector('.home-hero-promo-media') || document.body).backgroundImage.slice(0, 80),
  banners: [...document.querySelectorAll('.home-brand-banner')].map((b) => b.className),
  imagenesEditoriales: performance.getEntriesByType('resource').filter((r) => /assets\/promos\//.test(r.name)).length,
}));
console.log(JSON.stringify(datos));
await browser.close();
