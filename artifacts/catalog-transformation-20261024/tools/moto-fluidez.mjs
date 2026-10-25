// Fluidez de scroll en el Moto G15 físico: gestos táctiles reales (CDP) y un registrador de
// cuadros (requestAnimationFrame) dentro de la página. Uso:
//   node moto-fluidez.mjs <etapa>
// Mide, por pantalla: cuadros, mediana, p95, máximo, cuadros largos (>33 ms) y tareas largas.
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { connect, sleep, tap, swipeY, BASE, personaTocando } from './moto.mjs';

const etapa = process.argv[2] || 'despues';
const out = path.resolve('artifacts/catalog-transformation-20261024/rendimiento', etapa);
mkdirSync(out, { recursive: true });
if (personaTocando(3)) { console.error('Hay una persona tocando el Moto.'); process.exit(3); }

const { browser, page } = await connect();
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); indexedDB.deleteDatabase('taba-sandbox'); });
await page.goto(`${BASE}/?demo=1&vitrina=neuquen20261024&n=${Date.now()}`, { waitUntil: 'load' });
await page.waitForSelector('[data-view="home"] .home-best-card', { timeout: 30000 });
await sleep(2500);

async function despejar() {
  for (let i = 0; i < 3; i += 1) {
    if (!(await page.evaluate(() => !!document.querySelector('[data-install-sheet][open]')))) return;
    await tap(page, page.locator('[data-install-sheet] [data-install-decline]:visible').first());
    await sleep(500);
  }
}

async function medir(nombre, gestos = 8) {
  await despejar();
  await page.evaluate(() => {
    window.__frames = []; window.__long = [];
    let last = performance.now();
    const loop = (t) => { window.__frames.push(t - last); last = t; if (!window.__stop) requestAnimationFrame(loop); };
    window.__stop = false; requestAnimationFrame(loop);
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: false });
  });
  for (let i = 0; i < gestos; i += 1) {
    await swipeY(page, 640, 160, 216, 10, 260);
    await sleep(520);
  }
  const m = await page.evaluate(() => {
    window.__stop = true;
    const f = window.__frames.slice(2).sort((a, b) => a - b);
    const q = (p) => Math.round(f[Math.min(f.length - 1, Math.floor(f.length * p))] * 10) / 10;
    return { cuadros: f.length, mediana: q(0.5), p95: q(0.95), p99: q(0.99), maximo: Math.round(f[f.length - 1]), largos33: f.filter((x) => x > 33.4).length, largos50: f.filter((x) => x > 50).length, tareasLargas: window.__long.length, scrollY: Math.round(scrollY) };
  });
  console.log(nombre.padEnd(22), JSON.stringify(m));
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(500);
  return { nombre, ...m };
}

const resultados = [];
resultados.push(await medir('home'));
await page.evaluate(() => { window.location.hash = '#catalog'; });
await page.waitForSelector('[data-view="catalog"] [data-product-grid] article[data-card-product]');
await sleep(800);
resultados.push(await medir('catalogo-grilla'));
const tiene = await page.locator('[data-view="catalog"] [data-catalog-layout-toggle]').count();
if (tiene) {
  await tap(page, '[data-view="catalog"] [data-catalog-layout-toggle]');
  await sleep(800);
  resultados.push(await medir('catalogo-lista'));
}
writeFileSync(path.join(out, 'moto-fluidez.json'), JSON.stringify({ etapa, fecha: new Date().toISOString(), resultados }, null, 2));
await browser.close();
