/**
 * El carrito, medido de verdad: que guarda, donde, y que sobrevive a la recarga.
 * No se asume nada: se mira el almacenamiento antes y despues.
 */
import { chromium } from 'playwright';

const U = 'https://taba2-staging.pages.dev/';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
p.on('console', (m) => { if (m.type() === 'error' && !/favicon/i.test(m.text())) errs.push(m.text().slice(0, 200)); });

const esperar = async () => {
  await p.waitForFunction(() => {
    const g = document.querySelector('[data-production-catalog-gate]');
    return g && g.hidden === true;
  }, null, { timeout: 60_000 });
  await p.waitForFunction(() => document.querySelectorAll('[data-add-product]').length > 0, null, { timeout: 60_000 });
};

const foto = () => p.evaluate(() => ({
  badge: Math.max(0, ...[...document.querySelectorAll('[data-cart-count]')].map((e) => Number((e.textContent || '').replace(/\D/g, '') || 0))),
  local: Object.fromEntries(Object.entries(localStorage).filter(([k]) => /cart|carrito|taba/i.test(k)).map(([k, v]) => [k, String(v).slice(0, 220)])),
  sesion: Object.keys(sessionStorage).filter((k) => /cart|carrito|taba/i.test(k)),
}));

await p.goto(U, { waitUntil: 'load', timeout: 90_000 });
await esperar();
console.log('--- ANTES DE AGREGAR ---');
console.log(JSON.stringify(await foto(), null, 2));

const btn = p.locator('[data-add-product]:visible:not([disabled])').first();
const id = await btn.getAttribute('data-add-product');
await btn.click();
await p.waitForTimeout(3000);
console.log(`\n--- DESPUES DE AGREGAR (producto ${id}) ---`);
console.log(JSON.stringify(await foto(), null, 2));

await p.reload({ waitUntil: 'load', timeout: 90_000 });
await esperar();
await p.waitForTimeout(4000);
console.log('\n--- DESPUES DE RECARGAR ---');
console.log(JSON.stringify(await foto(), null, 2));

// Y lo que ve el cliente en la vista de carrito
await p.locator('[data-nav-view="cart"]:visible').first().click();
await p.waitForTimeout(2500);
const enCarrito = await p.evaluate(() => ({
  items: document.querySelectorAll('[data-cart-list] .cart-item').length,
  texto: (document.querySelector('[data-cart-list]')?.innerText || document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 300),
}));
console.log('\n--- VISTA CARRITO TRAS RECARGAR ---');
console.log(JSON.stringify(enCarrito, null, 2));
console.log('\nerrores:', errs.length ? errs.slice(0, 5) : 'ninguno');
await b.close();
