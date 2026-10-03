import { chromium } from 'playwright';
const ctx = await chromium.launchPersistentContext('.local/perfil-prod', { headless: true });
const page = await ctx.newPage();
const img = [];
page.on('response', async (r) => {
  const ct = (r.headers()['content-type'] || '');
  if (/image\//.test(ct)) {
    let n = 0; try { n = (await r.body()).length; } catch {}
    img.push({ url: r.url(), ct, bytes: n, desdeSW: r.fromServiceWorker?.() });
  }
});
await page.goto('https://la-taba.pages.dev/', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(6000);
const total = img.reduce((a, b) => a + b.bytes, 0);
console.log('respuestas de imagen:', img.length, '·', (total / 1024).toFixed(0), 'KB');
const porHost = {};
img.forEach((i) => { const h = new URL(i.url).host; porHost[h] = (porHost[h] || 0) + 1; });
console.log('por host:', porHost);
console.log('packshots de producto:', img.filter((i) => i.url.includes('/assets/products/') && i.url.endsWith('.webp')).length);
console.log('placeholder servido:', img.filter((i) => i.url.includes('beverage-placeholder')).length, 'veces');
console.log('imagenes cuyo content-type NO es imagen real:', img.filter((i) => /text\/html/.test(i.ct)).length);
// cuanto pesa la cache en runtime tras la visita
console.log(await page.evaluate(async () => {
  const out = {};
  for (const n of await caches.keys()) {
    const c = await caches.open(n); const ks = await c.keys();
    out[n] = { entradas: ks.length, imagenes: ks.filter((r) => /\.(webp|png|svg|jpg)$/.test(new URL(r.url).pathname)).length };
  }
  return out;
}));
await ctx.close();
