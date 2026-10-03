/**
 * Registra el Service Worker VIGENTE (v56) en un perfil persistente, antes de
 * publicar la RC. El mismo perfil se reabre despues del despliegue: asi el
 * upgrade que se mide es el que vive un cliente real que ya tenia la app
 * instalada, no una instalacion limpia.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const URL_STAGING = 'https://taba2-staging.pages.dev/';
const PERFIL = 'D:\\1212\\_claude-tmp\\rc1\\perfil-sw';
const SALIDA = 'D:\\1212\\artifacts\\taba2-pilot-rc1\\sw-antes.json';

const ctx = await chromium.launchPersistentContext(PERFIL, {
  headless: true,
  viewport: { width: 390, height: 844 },
});
const page = ctx.pages()[0] || (await ctx.newPage());

const errores = [];
const respuestas = [];
page.on('pageerror', (e) => errores.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errores.push(`console: ${m.text()}`); });
page.on('response', (r) => {
  if (r.status() >= 400) respuestas.push({ url: r.url(), status: r.status() });
});

await page.goto(URL_STAGING, { waitUntil: 'load', timeout: 90_000 });
await page.evaluate(() => navigator.serviceWorker.ready);
// El primer registro no controla la pagina hasta la siguiente navegacion.
await page.reload({ waitUntil: 'load', timeout: 90_000 });
await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 60_000 });

const estado = await page.evaluate(async () => ({
  caches: await caches.keys(),
  controlador: Boolean(navigator.serviceWorker.controller),
  scriptURL: navigator.serviceWorker.controller?.scriptURL || '',
  hojas: [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.getAttribute('href')),
  modulos: [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')),
  titulo: document.title,
  textoVisible: (document.body.innerText || '').slice(0, 300),
}));

const informe = { momento: new Date().toISOString(), url: URL_STAGING, ...estado, errores, respuestas4xx: respuestas };
fs.writeFileSync(SALIDA, JSON.stringify(informe, null, 2), 'utf8');
console.log(JSON.stringify(informe, null, 2));

await ctx.close();
