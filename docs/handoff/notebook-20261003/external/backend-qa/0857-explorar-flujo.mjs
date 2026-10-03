// Sonda de exploración: qué ofrece el storefront público paso a paso, para
// certificar el checkout y la ubicación por donde pasa una persona de verdad.
// Sólo mira y hace clic en navegación; no confirma ningún pedido.
import path from 'node:path';
import { createRequire } from 'node:module';

const REPO = process.env.TABA_REPO;
const requireDelRepo = createRequire(path.join(REPO, 'package.json'));
const { chromium, devices } = requireDelRepo('@playwright/test');
const SITIO = process.env.TABA_SITIO || 'https://taba2-staging.pages.dev';
const SALIDA = process.env.TABA_SALIDA;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  ...devices['iPhone 13'], locale: 'es-AR', serviceWorkers: 'allow',
});
const page = await context.newPage();
const errores = [];
page.on('pageerror', (e) => errores.push(String(e)));

const foto = async (n) => page.screenshot({ path: path.join(SALIDA, `flujo-${n}.png`) });
const botones = () => page.evaluate(() => [...document.querySelectorAll('button, a[href^="#"], [role="button"]')]
  .map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim())
  .filter((t) => t && t.length < 42).slice(0, 28));

await page.goto(`${SITIO}/#catalog`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(9000);
console.log('— CATALOGO —');
console.log('botones:', (await botones()).join(' | '));

// agregar dos productos
for (const i of [0, 1]) {
  await page.evaluate((idx) => {
    const bs = [...document.querySelectorAll('button')].filter((b) => /agregar/i.test(b.textContent || ''));
    if (bs[idx]) bs[idx].click();
  }, i);
  await page.waitForTimeout(2500);
}
console.log('contador tras agregar:', await page.evaluate(() => {
  const m = (document.body.innerText || '').match(/carrito[^\d]{0,24}(\d+)/i); return m ? m[1] : null;
}));
await foto('1-catalogo');

// abrir el carrito por donde lo abre una persona
const abrio = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button, a')]
    .find((x) => /(^|\s)carrito/i.test((x.textContent || '')) || x.matches('[data-view="cart"], [href="#cart"]'));
  if (!b) return null;
  b.click();
  return (b.textContent || '').trim().slice(0, 40);
});
await page.waitForTimeout(6000);
console.log('\n— CARRITO — (abierto con:', abrio, ')');
const enCarrito = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 400));
console.log(enCarrito);
console.log('botones:', (await botones()).join(' | '));
await foto('2-carrito');

// buscar el CTA que lleva a pagar / finalizar
const aCheckout = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button, a')]
    .find((x) => /finalizar|continuar|pagar|checkout|hacer pedido|comprar/i.test(x.textContent || ''));
  if (!b) return null;
  b.click();
  return (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
});
await page.waitForTimeout(7000);
console.log('\n— TRAS EL CTA — (', aCheckout, ')');
const enCheckout = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 700));
console.log(enCheckout);
console.log('botones:', (await botones()).join(' | '));
await foto('3-checkout');

console.log('\nerrores de pagina:', errores.length ? errores.slice(0, 3).join(' | ') : 'ninguno');
await context.close();
await browser.close();
