/*
 * La hoja del mapa pasó a `media="print"` con un `onload` que la devuelve a
 * `all`. Esta prueba comprueba las dos mitades: que la hoja QUEDE aplicada, y
 * que sus reglas lleguen de verdad a los controles del mapa.
 *
 * Sin esto el arreglo de rendimiento sería un mapa sin estilo, que es peor que
 * un primer pintado lento.
 */
import { chromium } from '@playwright/test';

const BASE = process.env.TABA_BASE || 'http://127.0.0.1:4599';
const navegador = await chromium.launch();
const ctx = await navegador.newContext({
  viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'es-AR',
});
const page = await ctx.newPage();
await page.goto(`${BASE}/?demo=1#home`, { waitUntil: 'domcontentloaded' });
await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 60_000 });
await page.waitForTimeout(2500);

const hoja = await page.evaluate(() => {
  const link = [...document.querySelectorAll('link[rel="stylesheet"]')]
    .find((l) => l.href.includes('maplibre-gl.css'));
  return link ? { media: link.media, cargada: Boolean(link.sheet) } : null;
});

// La regla tiene que estar viva en el CSSOM, no sólo el archivo bajado.
const reglas = await page.evaluate(() => {
  for (const hoja of document.styleSheets) {
    if (!String(hoja.href || '').includes('maplibre-gl.css')) continue;
    try { return hoja.cssRules.length; } catch (_) { return 'no legible (cruzada)'; }
  }
  return 0;
});

await page.evaluate(() => { window.location.hash = '#tracking'; });
await page.waitForTimeout(4000);

const mapa = await page.evaluate(() => {
  const canvas = document.querySelector('.maplibregl-canvas, canvas.maplibregl-canvas');
  const contenedor = document.querySelector('.maplibregl-map');
  const estilo = contenedor ? getComputedStyle(contenedor) : null;
  return {
    hayContenedor: Boolean(contenedor),
    hayCanvas: Boolean(canvas),
    // `.maplibregl-map { position: relative; overflow: hidden }` sale de la hoja
    // del CDN: si no se aplicó, estas dos propiedades vuelven al default.
    position: estilo?.position || null,
    overflow: estilo?.overflow || null,
  };
});

console.log(JSON.stringify({ hoja, reglasEnCSSOM: reglas, mapa }, null, 1));
const bien = hoja?.media === 'all' && hoja.cargada && mapa.position === 'relative';
console.log(bien ? '\nOK · la hoja quedó aplicada y el mapa la usa' : '\nFALLA · revisar');
await navegador.close();
process.exit(bien ? 0 : 1);
