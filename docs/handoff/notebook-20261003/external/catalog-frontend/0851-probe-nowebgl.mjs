/*
 * MISIÓN 6 · el mapa que no puede dibujarse.
 *
 * Sin WebGL el lienzo no monta. Lo que este probe mide es que en ese caso el
 * cliente vea un estado comercial y comprensible —no un rectángulo vacío ni un
 * texto de error prestado de otro estado— y que la copia diga la verdad de ESE
 * estado: sin pedido no se puede prometer que «seguimos actualizando tu pedido».
 */
import { chromium } from '@playwright/test';

const BASE = process.env.BASE || 'http://127.0.0.1:8248';
const OUT = process.env.OUT || 'D:/1212/artifacts/taba2-seguir-mapa-permanente/fallos';

const browser = await chromium.launch({ args: ['--disable-gpu', '--disable-webgl'] });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  reducedMotion: 'reduce',
  serviceWorkers: 'block',
  locale: 'es-AR',
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));

// Se apaga WebGL antes de que corra un solo módulo de la app.
await page.addInitScript(() => {
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function patched(type, ...rest) {
    if (String(type).toLowerCase().includes('webgl')) return null;
    return original.call(this, type, ...rest);
  };
});

await page.goto(`${BASE}/?reset=1&demo=1#tracking`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-tracking-status="idle"]');
await page.waitForTimeout(2500);

const report = await page.evaluate(() => {
  const shell = document.querySelector('[data-real-map]');
  const fallback = document.querySelector('[data-map-fallback]');
  const canvas = document.querySelector('[data-map-canvas]');
  const rect = fallback?.getBoundingClientRect();
  return {
    mapStatus: shell?.dataset.mapStatus || null,
    mapFailure: shell?.dataset.mapFailure || null,
    canvasHidden: canvas?.hasAttribute('hidden') ?? null,
    fallbackVisible: Boolean(rect && rect.height > 0),
    fallbackText: fallback?.textContent?.trim() || null,
    idleTitle: document.querySelector('.tracking-idle-title')?.textContent?.trim() || null,
    idleLead: document.querySelector('.tracking-idle-lead')?.textContent?.trim() || null,
    navVisible: (document.querySelector('.mobile-nav')?.getBoundingClientRect().height || 0) > 0,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});

await page.screenshot({ path: `${OUT}/sin-webgl-sin-pedido-390.png` });
console.log(JSON.stringify(report, null, 2));
console.log('errores:', errors.length ? errors : 'ninguno');
await context.close();
await browser.close();
