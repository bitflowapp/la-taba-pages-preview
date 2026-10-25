// Rendimiento real en el Moto G15. Uso:
//   node artifacts/catalog-transformation-20261024/tools/moto-perf.mjs antes|despues
// Mide carga fría (sin caché, sin Service Worker, almacenamiento vacío) y caliente,
// con la red real (USB) y con «4G lento» emulado SOLO en esa pestaña por DevTools:
// no se toca la conectividad ni el plan de datos del teléfono.
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { connect, cdpDe, sleep, BASE, personaTocando } from './moto.mjs';
import { openRuntimeCatalog } from '../../../tests/e2e/catalog-runtime-fixture.mjs';

// MODO=prod mide el camino productivo (catálogo de Supabase simulado por el arnés de las e2e):
// el panel del negocio NO se descarga, que es lo que vive un cliente real.
const PROD = process.env.MODO === 'prod';

const etapa = process.argv[2] || 'antes';
const out = path.resolve('artifacts/catalog-transformation-20261024/rendimiento', etapa);
mkdirSync(out, { recursive: true });
if (personaTocando(3)) { console.error('Hay una persona tocando el Moto.'); process.exit(3); }

const URL = `${BASE}/?demo=1&vitrina=neuquen20261024`;
const PERFILES = {
  'usb-real': null,
  // «Fast 4G» (9 Mbps, 170 ms): una conexión móvil corriente.
  'fast-4g': { offline: false, latency: 170, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 },
  // Chrome DevTools «Slow 4G»: 1,6 Mbps bajada, 750 kbps subida, 150 ms de latencia.
  'slow-4g': { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 },
  // «Fast 3G»
  'fast-3g': { offline: false, latency: 562, downloadThroughput: (1.6 * 1024 * 1024) / 8 * 0.9, uploadThroughput: (750 * 1024) / 8 * 0.9 },
};

const { browser, page } = await connect();
const cdp = await cdpDe(page);

async function limpiarTodo() {
  await page.evaluate(async () => {
    localStorage.clear(); sessionStorage.clear();
    for (const db of (await indexedDB.databases?.().catch(() => [])) || []) indexedDB.deleteDatabase(db.name);
    for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister();
    for (const key of await caches.keys()) await caches.delete(key);
  });
  await cdp.send('Network.clearBrowserCache').catch(() => {});
}

async function cargar(perfil, { fria }) {
  await cdp.send('Network.enable');
  const cond = PERFILES[perfil];
  await cdp.send('Network.emulateNetworkConditions', cond || { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: !!fria });
  await page.addInitScript(() => {
    window.__perf = { lcp: null, cls: 0, longTasks: [], fcp: null };
    new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__perf.lcp = { t: Math.round(e.startTime), el: e.element?.tagName + '.' + (e.element?.className || '').toString().slice(0, 40), url: e.url, size: e.size }; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__perf.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__perf.longTasks.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: true });
    new PerformanceObserver((list) => { for (const e of list.getEntries()) if (e.name === 'first-contentful-paint') window.__perf.fcp = Math.round(e.startTime); }).observe({ type: 'paint', buffered: true });
  });
  const t0 = Date.now();
  let loadMs;
  if (PROD) {
    const origGoto = page.goto.bind(page);
    page.goto = async (u, o) => { const r = await origGoto(u.startsWith('/') ? BASE + u : u, o); loadMs = Date.now() - t0; return r; };
    await openRuntimeCatalog(page, { view: 'home', waitForCatalog: false });
    page.goto = origGoto;
  } else {
    await page.goto(`${URL}&n=${Date.now()}`, { waitUntil: 'load', timeout: 120000 });
    loadMs = Date.now() - t0;
  }
  await page.waitForSelector(PROD ? '[data-view="home"] .home-best-card, [data-view="home"] article' : '[data-view="home"] .home-best-card', { timeout: 120000 });
  const interactiveMs = Date.now() - t0;
  await sleep(4000);
  const data = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const res = performance.getEntriesByType('resource');
    const kind = (r) => (/\.(png|jpe?g|webp|avif|svg|gif)(\?|$)/i.test(r.name) ? 'img' : /\.css(\?|$)/i.test(r.name) ? 'css' : /\.m?js(\?|$)/i.test(r.name) ? 'js' : /font|\.woff2?/i.test(r.name) ? 'font' : 'otro');
    const agg = {};
    for (const r of res) {
      const k = kind(r);
      agg[k] = agg[k] || { n: 0, transfer: 0, decoded: 0 };
      agg[k].n += 1; agg[k].transfer += r.transferSize || 0; agg[k].decoded += r.decodedBodySize || 0;
    }
    const topImgs = res.filter((r) => kind(r) === 'img').sort((a, b) => (b.encodedBodySize || 0) - (a.encodedBodySize || 0)).slice(0, 6)
      .map((r) => ({ f: r.name.split('/').slice(-2).join('/'), kb: Math.round((r.encodedBodySize || 0) / 1024) }));
    const imgsEnPantalla = [...document.images].filter((i) => i.complete && i.naturalWidth).map((i) => ({ nat: i.naturalWidth, shown: Math.round(i.getBoundingClientRect().width) })).filter((i) => i.shown > 0);
    const sobre = imgsEnPantalla.length ? Math.round((imgsEnPantalla.reduce((s, i) => s + i.nat / i.shown, 0) / imgsEnPantalla.length) * 10) / 10 : null;
    return {
      ttfb: Math.round(nav.responseStart), dcl: Math.round(nav.domContentLoadedEventEnd), loadEvent: Math.round(nav.loadEventEnd),
      perf: window.__perf, requests: res.length, totalKB: Math.round(res.reduce((s, r) => s + (r.transferSize || 0), 0) / 1024),
      porTipo: Object.fromEntries(Object.entries(agg).map(([k, v]) => [k, { n: v.n, transferKB: Math.round(v.transfer / 1024), decodedKB: Math.round(v.decoded / 1024) }])),
      topImgs, imagenesVisibles: imgsEnPantalla.length, resolucionSobreTamano: sobre,
      swController: !!navigator.serviceWorker.controller, scrollHeight: document.documentElement.scrollHeight,
      domNodes: document.getElementsByTagName('*').length,
    };
  });
  return { perfil, fria: !!fria, loadMs, interactiveMs, ...data };
}

const resultados = [];
for (const perfil of (process.env.PERFILES || 'usb-real,fast-4g,slow-4g').split(',')) {
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await limpiarTodo();
  const reps = Number(process.env.REPS || 1);
  const lote = [];
  for (let i = 0; i < reps; i += 1) {
    if (i > 0) await limpiarTodo();
    lote.push(await cargar(perfil, { fria: true }));
  }
  if (!process.env.SOLO_FRIA) lote.push(await cargar(perfil, { fria: false }));
  for (const r of lote) {
    resultados.push(r);
    console.log(`${r.perfil} ${r.fria ? 'FRÍA ' : 'CALIENTE'} load=${r.loadMs}ms listo=${r.interactiveMs}ms FCP=${r.perf.fcp} LCP=${r.perf.lcp?.t} (${r.perf.lcp?.el}) CLS=${r.perf.cls.toFixed(3)} longtasks=${r.perf.longTasks.length}(máx ${Math.max(0, ...r.perf.longTasks)}ms) req=${r.requests} ${r.totalKB}KB img×${r.porTipo.img?.n}=${r.porTipo.img?.transferKB}KB js×${r.porTipo.js?.n}=${r.porTipo.js?.transferKB}KB nodos=${r.domNodes}`);
  }
}
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
writeFileSync(path.join(out, `moto-rendimiento${process.env.SUFIJO || ''}.json`), JSON.stringify({ etapa, fecha: new Date().toISOString(), resultados }, null, 2));
await browser.close();
