/*
 * ¿Qué le pasa a la tienda si unpkg.com no contesta?
 *
 * El shell carga la hoja de estilos de MapLibre desde un CDN de terceros, en el
 * <head> y sin `media` diferido: es una petición cruzada en el camino crítico de
 * pintado de la home. Esta prueba corta ese host y mide si la tienda arranca,
 * cuánto tarda y si el cliente puede comprar igual.
 *
 * Sólo lee. No inicia sesión ni crea ningún pedido.
 */
import { chromium } from '@playwright/test';

const BASE = process.env.TABA_BASE || 'https://la-taba.pages.dev';
const MODO = process.env.TABA_MODO || 'bloqueado'; // bloqueado | lento | normal

const navegador = await chromium.launch();
const ctx = await navegador.newContext({
  viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'es-AR',
  userAgent: 'Mozilla/5.0 (Linux; Android 15; moto g15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
});

if (MODO === 'bloqueado') {
  await ctx.route('https://unpkg.com/**', (route) => route.abort('connectionfailed'));
} else if (MODO === 'lento') {
  // Un CDN que no contesta es peor que uno que falla: el navegador espera.
  await ctx.route('https://unpkg.com/**', async (route) => {
    await new Promise((listo) => { setTimeout(listo, 15_000); });
    await route.abort('timedout');
  });
} else if (MODO === 'lento-css') {
  await ctx.route('https://unpkg.com/**.css', async (route) => {
    await new Promise((listo) => { setTimeout(listo, 15_000); });
    await route.abort('timedout');
  });
} else if (MODO === 'lento-js') {
  await ctx.route('https://unpkg.com/**.js', async (route) => {
    await new Promise((listo) => { setTimeout(listo, 15_000); });
    await route.abort('timedout');
  });
}

const page = await ctx.newPage();
const errores = [];
page.on('pageerror', (e) => errores.push(`pageerror: ${e.message.slice(0, 120)}`));
page.on('console', (m) => { if (m.type() === 'error') errores.push(`console: ${m.text().slice(0, 120)}`); });

const t0 = Date.now();
await page.goto(BASE + (process.env.TABA_SUFIJO || ''), { waitUntil: 'commit' });

// Primer pintado con contenido: es lo que decide si la persona ve una tienda o
// una pantalla en blanco mientras el CDN no contesta.
let fcp = null;
try {
  fcp = await page.evaluate(() => new Promise((listo) => {
    const ya = performance.getEntriesByName('first-contentful-paint')[0];
    if (ya) { listo(Math.round(ya.startTime)); return; }
    new PerformanceObserver((lista, obs) => {
      const entrada = lista.getEntriesByName('first-contentful-paint')[0];
      if (entrada) { obs.disconnect(); listo(Math.round(entrada.startTime)); }
    }).observe({ type: 'paint', buffered: true });
    setTimeout(() => listo(null), 25_000);
  }));
} catch (_) { fcp = null; }

let arranco = true;
try {
  await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 45_000 });
} catch (_) { arranco = false; }
const listo = Date.now() - t0;
await page.waitForTimeout(2500);

const estado = await page.evaluate(() => ({
  tarjetas: document.querySelectorAll('.rail-card, .product-card, .thumb').length,
  precios: [...document.querySelectorAll('body *')]
    .filter((e) => e.children.length === 0 && /\$\s?\d/.test(e.textContent || '')).length,
  agregar: document.querySelectorAll('[data-add-product]').length,
  recuperacion: !document.querySelector('[data-app-recovery]')?.hidden,
}));

// ¿Se puede comprar igual?
let agregado = false;
const boton = page.locator('[data-add-product] >> visible=true').first();
if (await boton.count()) {
  await boton.click().catch(() => undefined);
  await page.waitForTimeout(1200);
  agregado = await page.evaluate(() => Object.keys(localStorage)
    .some((k) => /cart|carrito/i.test(k) && (localStorage.getItem(k) || '').length > 2));
}

console.log(JSON.stringify({
  modo: MODO,
  arranco,
  primerPintadoMs: fcp,
  listoMs: listo,
  ...estado,
  sePuedeAgregar: agregado,
  errores: [...new Set(errores)].slice(0, 5),
}, null, 1));
await navegador.close();
