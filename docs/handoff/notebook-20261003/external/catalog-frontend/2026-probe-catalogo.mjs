import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
const err = [];
p.on('pageerror', e => err.push(String(e).slice(0,200)));
p.on('response', r => { if (r.status() >= 400) err.push(`${r.status()} ${r.url()}`); });
await p.goto('https://taba2-staging.pages.dev/', { waitUntil: 'load', timeout: 90000 });
try {
  await p.waitForFunction(() => {
    const g = document.querySelector('[data-production-catalog-gate]');
    return g && g.hidden === true;
  }, null, { timeout: 45000 });
  console.log('GATE LEVANTADO: el catalogo cargo');
} catch { console.log('GATE SIGUE PUESTO tras 45 s'); }
const info = await p.evaluate(() => ({
  gateOculto: document.querySelector('[data-production-catalog-gate]')?.hidden,
  tarjetas: document.querySelectorAll('[data-product-id], [data-product-card]').length,
  texto: (document.body.innerText||'').replace(/\s+/g,' ').slice(0,260),
}));
console.log(JSON.stringify(info, null, 2));
console.log('errores/4xx:', err.length ? err.slice(0,5) : 'ninguno');
await b.close();
