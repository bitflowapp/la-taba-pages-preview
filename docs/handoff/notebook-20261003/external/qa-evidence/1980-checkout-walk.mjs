/* Camina la compra como un cliente nuevo. NO confirma el pedido: se detiene
 * justo antes del submit y reporta qué pide, qué muestra y qué bloquea. */
import { chromium, webkit } from '@playwright/test';

const BASE = process.env.TABA_BASE || 'https://la-taba.pages.dev';
const OUT = process.env.TABA_OUT || 'artifacts/weekend-launch';
const MOTOR = process.env.TABA_MOTOR || 'chromium';
const { mkdirSync } = await import('node:fs');
mkdirSync(OUT, { recursive: true });

const pasos = [];
const log = (t, extra) => { pasos.push({ t, ...extra }); console.error('· ' + t + (extra ? ' ' + JSON.stringify(extra).slice(0,300) : '')); };

const motor = MOTOR === 'webkit' ? webkit : chromium;
const browser = await motor.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3,
  userAgent: MOTOR === 'chromium' ? 'Mozilla/5.0 (Linux; Android 15; moto g15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36' : undefined,
  serviceWorkers: 'allow', locale: 'es-AR',
});
const page = await ctx.newPage();
const errores = [];
page.on('pageerror', (e) => errores.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errores.push('console: ' + m.text().slice(0, 240)); });
const red = [];
page.on('response', (r) => { if (r.status() >= 400) red.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 150)}`); });

const shot = (n) => page.screenshot({ path: `${OUT}/walk-${MOTOR}-${n}.png` });

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 90_000 });
  await page.waitForTimeout(2500);
  log('home listo');

  // 1 · agregar el primer producto del riel
  const agregar = page.locator('[data-add-product] >> visible=true').first();
  const nombreProd = await page.evaluate(() => {
    const b = [...document.querySelectorAll('[data-add-product]')].find((e)=>e.getBoundingClientRect().width>0);
    const card = b?.closest('article, .rail-card, .product-card, li, div[class*="card"]');
    return (card?.textContent || '').trim().replace(/\s+/g,' ').slice(0, 80);
  });
  await agregar.click();
  await page.waitForTimeout(1200);
  log('agregado', { producto: nombreProd });
  await shot('01-agregado');

  // 2 · abrir el carrito
  const irCarrito = page.locator('[data-open-cart] >> visible=true').first();
  if (await irCarrito.count()) { await irCarrito.click(); } else { await page.evaluate(()=>{location.hash='#cart';}); }
  await page.waitForTimeout(1800);
  await shot('02-carrito');
  const carrito = await page.evaluate(() => {
    const vis = (el)=>{const s=getComputedStyle(el);const r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;};
    const txt = [...document.querySelectorAll('body *')].filter((e)=>e.children.length===0&&vis(e)).map((e)=>(e.textContent||'').trim().replace(/\s+/g,' ')).filter(Boolean);
    return { hash: location.hash, textos: txt.slice(0, 60) };
  });
  log('carrito', carrito);

  // 3 · ir al checkout
  const irCheckout = page.locator('[data-go-checkout], [data-checkout-open], button:has-text("Continuar"), button:has-text("Finalizar"), a:has-text("Continuar")').filter({ has: undefined });
  const candidatos = await page.evaluate(() => {
    const vis = (el)=>{const s=getComputedStyle(el);const r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;};
    return [...document.querySelectorAll('button, a[href], [role=button]')].filter(vis).map((e)=>({ txt:(e.textContent||'').trim().replace(/\s+/g,' ').slice(0,50), attrs: [...e.attributes].map(a=>a.name).filter(n=>n.startsWith('data-')).join(',') }));
  });
  log('botones del carrito', { candidatos: candidatos.slice(0, 25) });
} catch (e) {
  log('EXCEPCION', { msg: String(e.message).slice(0, 300) });
}

console.log(JSON.stringify({ pasos, errores: [...new Set(errores)].slice(0,10), red: [...new Set(red)].slice(0,10) }, null, 1));
await browser.close();
