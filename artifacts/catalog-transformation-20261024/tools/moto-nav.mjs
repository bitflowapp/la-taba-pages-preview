// Navegación ad-hoc en el Moto por comandos. Uso:
//   node moto-nav.mjs <etapa> "catalog" "cat:cervezas" "list" "scroll:600" "shot:nombre" "eval:<js>"
// Cada comando corre en orden sobre la pestaña de la tienda. Siempre parte de un
// almacenamiento limpio y declina la hoja de instalación si aparece.
import path from 'node:path';
import { connect, sleep, tap, screencap, adb, BASE } from './moto.mjs';

const [etapa, ...comandos] = process.argv.slice(2);
const out = path.resolve('artifacts/catalog-transformation-20261024/capturas', etapa, 'moto-real');
const { browser, page } = await connect();

async function despejar() {
  for (let i = 0; i < 3; i += 1) {
    const abierta = await page.evaluate(() => !!document.querySelector('[data-install-sheet][open]'));
    if (!abierta) return;
    await tap(page, page.locator('[data-install-sheet] [data-install-decline]:visible').first());
    await sleep(500);
  }
}

const URL_BASE = process.env.NAV_URL || `${BASE}/?demo=1&vitrina=neuquen20261024`;
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); indexedDB.deleteDatabase('taba-sandbox'); });
await page.goto(`${URL_BASE}&n=${Date.now()}`, { waitUntil: 'load' });
await page.waitForSelector('[data-view="home"] .home-best-card', { timeout: 30000 });
await sleep(1500);

for (const comando of comandos) {
  await despejar();
  const [nombre, ...resto] = comando.split(':');
  const arg = resto.join(':');
  if (nombre === 'catalog') {
    await page.evaluate(() => { window.location.hash = '#catalog'; });
    await page.waitForSelector('[data-view="catalog"] [data-product-grid] article[data-card-product]', { timeout: 20000 });
    await sleep(600);
  } else if (nombre === 'cat') {
    await tap(page, page.locator(`[data-view="catalog"] [data-category-id="${arg}"]`).first());
    await sleep(700);
  } else if (nombre === 'list' || nombre === 'grid') {
    const actual = await page.evaluate(() => document.querySelector('[data-product-grid]')?.dataset.catalogLayout || 'grid');
    if (actual !== nombre) { await tap(page, '[data-view="catalog"] [data-catalog-layout-toggle]'); await sleep(700); }
  } else if (nombre === 'scroll') {
    await page.evaluate((y) => window.scrollTo(0, Number(y)), arg);
    await sleep(500);
  } else if (nombre === 'tap') {
    await tap(page, page.locator(arg).first());
    await sleep(700);
  } else if (nombre === 'shot') {
    await sleep(400);
    console.log('captura', screencap(path.join(out, `${arg}.png`)));
  } else if (nombre === 'pshot') {
    // Captura de la PÁGINA por DevTools: sólo píxeles de la web (nunca el sistema ni sus notificaciones).
    await sleep(400);
    await page.screenshot({ path: path.join(out, `${arg}.png`) });
    console.log('captura de página', path.join(out, `${arg}.png`));
  } else if (nombre === 'eval') {
    console.log(JSON.stringify(await page.evaluate(arg)));
  } else if (nombre === 'type') {
    await tap(page, page.locator('[data-view="catalog"] [data-search-input]').first());
    await sleep(1000);
    adb('shell', 'input', 'text', arg);
    await sleep(1200);
  } else if (nombre === 'enter') {
    adb('shell', 'input', 'keyevent', 'KEYCODE_ENTER');
    await sleep(900);
  } else if (nombre === 'blur') {
    await page.evaluate(() => document.activeElement?.blur());
    await sleep(600);
  } else if (nombre === 'wait') {
    await sleep(Number(arg));
  }
}
await browser.close();
