import { webkit, devices } from 'playwright';
const U = 'https://taba2-staging.pages.dev/';
const b = await webkit.launch({ headless: true });
const p = await (await b.newContext({ ...devices['iPhone 13'] })).newPage();
await p.goto(U, { waitUntil: 'load', timeout: 60000 });
await p.waitForFunction(() => { const g=document.querySelector('[data-production-catalog-gate]'); return g&&g.hidden===true; },null,{timeout:60000});
await p.waitForTimeout(6000);

const banner = await p.evaluate(() => {
  const el = document.querySelector('[data-app-update-banner]');
  if (!el || el.hidden) return null;
  const r = el.getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), alto: Math.round(r.height), vh: innerHeight };
});
console.log('aviso pegado:', JSON.stringify(banner));

const contar = () => p.evaluate(() => Math.max(0, ...[...document.querySelectorAll('[data-cart-count]')].map(e=>Number((e.textContent||'').replace(/\D/g,'')||0))));
const btn = p.locator('[data-add-product]:visible:not([disabled])').first();

console.log('\nA · scroll minimo (scrollIntoViewIfNeeded), click con 8 s de tope');
await btn.scrollIntoViewIfNeeded();
await p.waitForTimeout(400);
let a = 'ok';
try { await btn.click({ timeout: 8000 }); } catch (e) { a = 'BLOQUEADO: ' + String(e.message).split('\n')[0].slice(0,80); }
console.log('   resultado:', a, '· carrito =', await contar());

console.log('\nB · centrando el boton, click con 8 s de tope');
await btn.evaluate((el) => el.scrollIntoView({ block: 'center' }));
await p.waitForTimeout(600);
let c = 'ok';
try { await btn.click({ timeout: 8000 }); } catch (e) { c = 'BLOQUEADO: ' + String(e.message).split('\n')[0].slice(0,80); }
console.log('   resultado:', c, '· carrito =', await contar());
await b.close();
