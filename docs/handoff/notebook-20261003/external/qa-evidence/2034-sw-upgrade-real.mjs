/**
 * El upgrade POR EL CAMINO DISENIADO: el SW nuevo queda en waiting (no hay
 * skipWaiting en install), la pagina ofrece «Actualizar ahora», y recien al
 * aceptarlo el SW activa, purga la cache vieja y toma el control.
 *
 * Corre sobre el perfil que ya venia de v56, que es el de un cliente que ya
 * tenia la app instalada.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const URL_STAGING = 'https://taba2-staging.pages.dev/';
const PERFIL = 'D:/1212/_claude-tmp/rc1/perfil-sw';
const SALIDA = 'D:/1212/artifacts/taba2-pilot-rc1/sw-upgrade-real.json';

const ctx = await chromium.launchPersistentContext(PERFIL, {
  headless: true, viewport: { width: 390, height: 844 },
});
const page = ctx.pages()[0] || (await ctx.newPage());
const errores = []; const malas = [];
page.on('pageerror', (e) => errores.push(String(e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') errores.push(`console: ${m.text().slice(0, 300)}`); });
page.on('response', (r) => { if (r.status() >= 400) malas.push(`${r.status()} ${r.url()}`); });

await page.goto(URL_STAGING, { waitUntil: 'load', timeout: 90_000 });

const antes = await estado(page);

// 1) Hay un SW esperando?
const hayEspera = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  await reg?.update().catch(() => undefined);
  await new Promise((r) => setTimeout(r, 2500));
  const reg2 = await navigator.serviceWorker.getRegistration();
  return { waiting: Boolean(reg2?.waiting), active: Boolean(reg2?.active) };
});

// 2) La pagina lo ofrece?
const banner = page.locator('[data-app-update-banner]');
const boton = page.locator('[data-app-update-now]');
const ofrecido = await banner.isVisible().catch(() => false);
const botonVisible = await boton.isVisible().catch(() => false);

// 3) Aceptar la actualizacion por el camino del producto, si esta ofrecida;
//    si no, mandar el mensaje que el propio boton manda.
let via = 'ninguna';
if (botonVisible) { await boton.click(); via = 'boton «Actualizar ahora» del producto'; }
else {
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    reg?.waiting?.postMessage('skip-waiting');
  });
  via = 'postMessage skip-waiting (el mismo que manda el boton)';
}

// El controllerchange dispara un reload en pwa-update.js
await page.waitForTimeout(4000);
await page.waitForLoadState('load').catch(() => undefined);
await page.waitForTimeout(2000);

const despues = await estado(page);

let catalogo = 'no evaluado';
try {
  await page.waitForFunction(() => {
    const g = document.querySelector('[data-production-catalog-gate]');
    return g && g.hidden === true;
  }, null, { timeout: 45_000 });
  catalogo = 'gate levantado: el catalogo carga';
} catch { catalogo = 'EL GATE SIGUE PUESTO'; }

const informe = {
  momento: new Date().toISOString(),
  antes, hayEspera, bannerOfrecido: ofrecido, botonVisible, via, despues, catalogo,
  cacheViejaPurgada: !despues.caches.some((c) => c.includes('v56')),
  soloUnaCache: despues.caches.length === 1,
  errores, respuestas4xx: malas,
};
fs.writeFileSync(SALIDA, JSON.stringify(informe, null, 2), 'utf8');
console.log(JSON.stringify(informe, null, 2));
await ctx.close();

async function estado(p) {
  return p.evaluate(async () => ({
    caches: await caches.keys(),
    controlador: Boolean(navigator.serviceWorker.controller),
    hojas: [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.getAttribute('href')).filter((h) => !h.startsWith('http')),
    modulos: [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')).filter((h) => !h.startsWith('http')),
  }));
}
