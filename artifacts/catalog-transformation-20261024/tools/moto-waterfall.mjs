// Cascada de la carga fría en el Moto (camino productivo simulado), en «4G rápido».
import { connect, cdpDe, sleep, BASE } from './moto.mjs';
import { openRuntimeCatalog } from '../../../tests/e2e/catalog-runtime-fixture.mjs';
const { browser, page } = await connect();
const cdp = await cdpDe(page);
await page.evaluate(async () => {
  localStorage.clear(); sessionStorage.clear(); indexedDB.deleteDatabase('taba-sandbox');
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  for (const k of await caches.keys()) await caches.delete(k);
});
await cdp.send('Network.enable');
await cdp.send('Network.clearBrowserCache');
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 170, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 });
await page.addInitScript(() => {
  window.__lcp = null;
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = Math.round(e.startTime); }).observe({ type: 'largest-contentful-paint', buffered: true });
});
const origGoto = page.goto.bind(page);
page.goto = (u, o) => origGoto(u.startsWith('/') ? BASE + u : u, o);
await openRuntimeCatalog(page, { view: 'home', waitForCatalog: false });
await sleep(3000);
const out = await page.evaluate(() => {
  const nav = performance.getEntriesByType('navigation')[0];
  const res = performance.getEntriesByType('resource').map((r) => ({
    f: new URL(r.name).pathname.replace(/^\//, '').slice(0, 60), type: /\.css/.test(r.name) ? 'css' : /\.m?js/.test(r.name) ? 'js' : /\.(webp|jpg|png|svg)/.test(r.name) ? 'img' : 'otro',
    s: Math.round(r.startTime), e: Math.round(r.responseEnd), kb: Math.round((r.encodedBodySize || 0) / 1024), init: r.initiatorType,
  }));
  const by = (t) => res.filter((r) => r.type === t);
  const span = (a) => a.length ? { n: a.length, from: Math.min(...a.map((r) => r.s)), to: Math.max(...a.map((r) => r.e)), kb: a.reduce((s, r) => s + r.kb, 0) } : null;
  const js = by('js').sort((a, b) => a.s - b.s);
  // olas de JS: una ola nueva empieza cuando una petición arranca después de que terminó alguna anterior
  const waves = []; for (const r of js) { const w = waves.find((x) => r.s >= x.end - 1) ; if (!w) waves.push({ start: r.s, end: r.e, n: 1 }); else { w.n++; w.end = Math.max(w.end, r.e); } }
  const hero = res.find((r) => /hero|promo/i.test(r.f) && r.type === 'img');
  return { htmlEnd: Math.round(nav.responseEnd), dcl: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd), lcp: window.__lcp,
    css: span(by('css')), js: span(js), img: span(by('img')), jsWaves: waves.length, firstJs: js.slice(0, 3), hero,
    primerasImg: by('img').sort((a, b) => a.s - b.s).slice(0, 5), ultimasJs: js.slice(-3) };
});
console.log(JSON.stringify(out, null, 1));
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
await browser.close();
