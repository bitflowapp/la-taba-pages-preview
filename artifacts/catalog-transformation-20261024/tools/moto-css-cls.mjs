// Cobertura de CSS por archivo y orígenes del CLS en el Moto (carga fría).
import { connect, cdpDe, sleep, BASE } from './moto.mjs';
const slow = process.argv[2] === 'slow';
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
if (slow) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
await cdp.send('CSS.startRuleUsageTracking');
await page.addInitScript(() => {
  window.__shifts = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (e.hadRecentInput) continue;
      window.__shifts.push({ t: Math.round(e.startTime), v: Math.round(e.value * 1000) / 1000, src: (e.sources || []).slice(0, 3).map((s) => ({ n: (s.node?.tagName || '?') + '.' + String(s.node?.className || '').slice(0, 45), from: s.previousRect && [Math.round(s.previousRect.y), Math.round(s.previousRect.height)], to: s.currentRect && [Math.round(s.currentRect.y), Math.round(s.currentRect.height)] })) });
    }
  }).observe({ type: 'layout-shift', buffered: true });
});
const sheets = new Map();
cdp.on('CSS.styleSheetAdded', (e) => sheets.set(e.header.styleSheetId, e.header));
await page.goto(`${BASE}/?demo=1&vitrina=neuquen20261024&n=${Date.now()}`, { waitUntil: 'load', timeout: 120000 });
await page.waitForSelector('[data-view="home"] .home-best-card', { timeout: 120000 });
await sleep(4000);
const { ruleUsage } = await cdp.send('CSS.stopRuleUsageTracking');
const used = new Map();
for (const r of ruleUsage) if (r.used) used.set(r.styleSheetId, (used.get(r.styleSheetId) || 0) + (r.endOffset - r.startOffset));
const rows = [];
for (const [id, h] of sheets) {
  if (!h.sourceURL) continue;
  rows.push({ f: h.sourceURL.split('/').slice(-2).join('/'), kb: Math.round(h.length / 1024), usedKB: Math.round((used.get(id) || 0) / 1024) });
}
rows.sort((a, b) => b.kb - a.kb);
console.log('CSS (usado en la home al cargar):');
for (const r of rows) console.log(`  ${r.f.padEnd(34)} ${String(r.kb).padStart(4)} KB  usado ${String(r.usedKB).padStart(4)} KB  (${r.kb ? Math.round((r.usedKB / r.kb) * 100) : 0}%)`);
console.log('total', rows.reduce((s, r) => s + r.kb, 0), 'KB, usado', rows.reduce((s, r) => s + r.usedKB, 0), 'KB');
console.log('Desplazamientos de diseño:', JSON.stringify(await page.evaluate(() => window.__shifts), null, 1));
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
await browser.close();
