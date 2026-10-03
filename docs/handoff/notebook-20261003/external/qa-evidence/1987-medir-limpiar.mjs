/* ¿Por qué «Limpiar» mide 33 px de ancho a 320 px? */
import { chromium } from '@playwright/test';

const BASE = process.env.TABA_BASE || 'https://la-taba.pages.dev';
const nav = await chromium.launch();
const ctx = await nav.newContext({ viewport: { width: 320, height: 608 }, hasTouch: true, isMobile: true, locale: 'es-AR', serviceWorkers: 'allow' });
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 90_000 });
await page.waitForTimeout(2500);
await page.evaluate(() => { window.location.hash = '#catalog'; });
await page.waitForTimeout(2500);
if (process.env.ABRIR === '1') {
  await page.locator('.catalog-filters > summary').first().click();
  await page.waitForTimeout(1500);
}

const datos = await page.evaluate(() => {
  const boton = [...document.querySelectorAll('.ghost-button')]
    .find((b) => (b.textContent || '').trim() === 'Limpiar');
  if (!boton) return { encontrado: false };
  const cadena = [];
  let nodo = boton;
  for (let i = 0; i < 5 && nodo; i += 1) {
    const r = nodo.getBoundingClientRect();
    const s = getComputedStyle(nodo);
    cadena.push({
      tag: nodo.tagName.toLowerCase(),
      cls: String(nodo.className).slice(0, 60),
      w: Math.round(r.width), h: Math.round(r.height),
      display: s.display,
      columnas: s.gridTemplateColumns,
      padding: s.padding,
      overflow: s.overflow,
    });
    nodo = nodo.parentElement;
  }
  const hermano = boton.nextElementSibling;
  return {
    encontrado: true,
    cadena,
    hermano: hermano ? { txt: (hermano.textContent || '').trim(), w: Math.round(hermano.getBoundingClientRect().width) } : null,
    abierto: Boolean(boton.closest('details')?.open),
  };
});
console.log(JSON.stringify(datos, null, 1));
await page.screenshot({ path: '.local/qa/limpiar-320.png' });
await nav.close();
