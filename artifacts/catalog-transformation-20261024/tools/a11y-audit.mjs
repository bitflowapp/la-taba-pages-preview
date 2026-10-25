// Auditoría de accesibilidad de la vidriera con axe-core (instalado FUERA del repo, en
// AXE_PATH) más una medición propia de zonas táctiles. Uso:
//   AXE_PATH=<ruta a axe-core/axe.min.js instalado fuera del repo> \
//   BASE=http://127.0.0.1:8265 node artifacts/catalog-transformation-20261024/tools/a11y-audit.mjs antes|despues
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const etapa = process.argv[2] || 'antes';
const BASE = process.env.BASE || 'http://127.0.0.1:8265';
const AXE = process.env.AXE_PATH;
if (!AXE) throw new Error('Definí AXE_PATH con la ruta a axe-core/axe.min.js (instalado fuera del repo).');
const out = path.resolve('artifacts/catalog-transformation-20261024/accesibilidad', etapa);
mkdirSync(out, { recursive: true });
const VITRINA = `${BASE}/?reset=1&demo=1&vitrina=neuquen20261024`;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 432, height: 815 }, deviceScaleFactor: 2.5, isMobile: true, hasTouch: true, locale: 'es-AR',
  serviceWorkers: 'block',
  storageState: { cookies: [], origins: [{ origin: BASE, localStorage: [{ name: 'TABA_INSTALL_PROMPT_V1', value: JSON.stringify({ v: 1, decision: 'declined', at: '2026-01-01T00:00:00.000Z', platform: 'a11y' }) }] }] },
});
const page = await context.newPage();
const resultados = [];

async function auditar(nombre, preparar) {
  if (preparar) await preparar();
  await page.waitForTimeout(700);
  await page.addScriptTag({ path: AXE }).catch(() => {});
  const axe = await page.evaluate(async () => {
    const r = await window.axe.run(document, { resultTypes: ['violations'] });
    return r.violations.map((v) => ({
      id: v.id, impacto: v.impact, ayuda: v.help, nodos: v.nodes.length,
      ejemplos: v.nodes.slice(0, 3).map((n) => ({ sel: n.target.join(' '), resumen: (n.failureSummary || '').split('\n').slice(1, 3).join(' | ').slice(0, 220) })),
    }));
  });
  const tactiles = await page.evaluate(() => {
    const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.bottom > 0 && r.top < innerHeight * 3; };
    const items = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], summary')].filter(visible);
    const chicos = items.map((el) => { const r = el.getBoundingClientRect(); return { sel: el.tagName.toLowerCase() + (el.getAttribute('data-nav-view') ? `[nav=${el.getAttribute('data-nav-view')}]` : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''), w: Math.round(r.width), h: Math.round(r.height), txt: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30) }; })
      .filter((x) => x.w < 44 || x.h < 44);
    const agrupado = {};
    for (const x of chicos) { const k = `${x.sel} ${x.w}x${x.h}`; agrupado[k] = agrupado[k] || { n: 0, ej: x.txt }; agrupado[k].n += 1; }
    return { total: items.length, menoresA44: chicos.length, grupos: agrupado };
  });
  const sinNombre = await page.evaluate(() => [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, [role=button]')]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; })
    .filter((el) => !(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (el.textContent || '').trim() || (el.labels && el.labels.length) || el.getAttribute('title') || el.getAttribute('placeholder')))
    .map((el) => el.outerHTML.slice(0, 120)).slice(0, 6));
  resultados.push({ pantalla: nombre, violaciones: axe, tactiles, sinNombreAccesible: sinNombre });
  const resumen = axe.map((v) => `${v.id}(${v.impacto},${v.nodos})`).join(' ') || 'sin violaciones';
  console.log(`${nombre.padEnd(28)} axe: ${resumen} | táctiles<44: ${tactiles.menoresA44}/${tactiles.total} | sin nombre: ${sinNombre.length}`);
}

await page.goto(VITRINA, { waitUntil: 'load' });
await page.waitForSelector('[data-view="home"] .home-best-card');
await auditar('home');
await auditar('catalogo-grilla', async () => { await page.evaluate(() => { location.hash = '#catalog'; }); await page.waitForSelector('[data-view="catalog"] article[data-card-product]'); });
await auditar('catalogo-lista', async () => { await page.locator('[data-view="catalog"] [data-catalog-layout-toggle]').click().catch(() => {}); });
await auditar('catalogo-busqueda-vacia', async () => { await page.locator('[data-view="catalog"] [data-search-input]').fill('zzzz'); });
await auditar('catalogo-busqueda-alcance', async () => {
  await page.locator('[data-view="catalog"] [data-search-input]').fill('');
  await page.locator('[data-view="catalog"] [data-category-id="cervezas"]').first().click();
  await page.locator('[data-view="catalog"] [data-search-input]').fill('quilmes');
});
await auditar('ficha-producto', async () => {
  await page.locator('[data-view="catalog"] [data-search-input]').fill('');
  await page.locator('[data-view="catalog"] [data-search-everywhere], [data-view="catalog"] [data-clear-search]').first().click().catch(() => {});
  await page.locator('[data-view="catalog"] article[data-card-product] .product-media').first().click();
  await page.waitForSelector('[data-modal-product-id]', { state: 'visible' });
});
await auditar('carrito-con-productos', async () => {
  await page.locator('[data-modal-product-id] [data-add-product]').first().click();
  await page.locator('[data-modal-product-id] [data-close-modal]').first().click().catch(() => {});
  await page.locator('[data-view="catalog"] article[data-card-product] [data-add-product]').nth(1).click();
  await page.locator('[data-floating-cart]').click();
  await page.waitForSelector('[data-view="cart"]', { state: 'visible' });
});
await auditar('checkout-formulario', async () => { await page.evaluate(() => document.querySelector('[data-view="cart"] .checkout-form')?.scrollIntoView()); });

writeFileSync(path.join(out, 'axe-y-tactiles.json'), JSON.stringify({ etapa, fecha: new Date().toISOString(), base: BASE, resultados }, null, 2));
await browser.close();
