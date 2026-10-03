/**
 * Reabre EL MISMO perfil que quedo con v56 instalado y mide el upgrade a v58.
 * Es el camino de un cliente que ya tenia la app, no una instalacion limpia.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const URL_STAGING = 'https://taba2-staging.pages.dev/';
const PERFIL = 'D:/1212/_claude-tmp/rc1/perfil-sw';
const SALIDA = 'D:/1212/artifacts/taba2-pilot-rc1/sw-despues.json';

const ctx = await chromium.launchPersistentContext(PERFIL, {
  headless: true,
  viewport: { width: 390, height: 844 },
});
const page = ctx.pages()[0] || (await ctx.newPage());

const errores = [];
const malas = [];
page.on('pageerror', (e) => errores.push(String(e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') errores.push(`console: ${m.text().slice(0, 300)}`); });
page.on('response', (r) => { if (r.status() >= 400) malas.push({ url: r.url(), status: r.status() }); });

const pasos = [];
let recargas = 0;
let estado = null;

await page.goto(URL_STAGING, { waitUntil: 'load', timeout: 90_000 });
pasos.push({ paso: 'primera visita tras el despliegue', ...(await leer(page)) });

// El SW nuevo se instala en segundo plano; toma el control en la navegacion siguiente.
for (let i = 0; i < 4; i += 1) {
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) await reg.update();
  }).catch(() => undefined);
  await page.waitForTimeout(1500);
  await page.reload({ waitUntil: 'load', timeout: 90_000 });
  recargas += 1;
  estado = await leer(page);
  pasos.push({ paso: `recarga ${recargas}`, ...estado });
  if (estado.caches.some((c) => c.includes('v58'))) break;
}

// Con el SW nuevo controlando, esperar a que el catalogo real cargue.
let catalogo = 'no evaluado';
try {
  await page.waitForFunction(() => {
    const g = document.querySelector('[data-production-catalog-gate]');
    return g && g.hidden === true;
  }, null, { timeout: 45_000 });
  catalogo = 'el gate se levanta: el catalogo carga';
} catch {
  catalogo = 'EL GATE SIGUE PUESTO tras 45 s';
}

const final = await page.evaluate(() => ({
  caches: [],
  productosVisibles: document.querySelectorAll('[data-product-id]').length,
  texto: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 240),
}));

const informe = {
  momento: new Date().toISOString(),
  recargasHastaElUpgrade: recargas,
  estadoFinal: estado,
  catalogo,
  productosVisibles: final.productosVisibles,
  textoVisible: final.texto,
  errores,
  respuestas4xx: malas,
  pasos,
};
fs.writeFileSync(SALIDA, JSON.stringify(informe, null, 2), 'utf8');
console.log(JSON.stringify(informe, null, 2));
await ctx.close();

async function leer(p) {
  return p.evaluate(async () => ({
    caches: await caches.keys(),
    controlador: Boolean(navigator.serviceWorker.controller),
    hojas: [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.getAttribute('href')),
    modulos: [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')),
  }));
}
