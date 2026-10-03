/**
 * El service worker de la release, en la URL pública.
 *
 *  A · instalación limpia: una sola caché, la nueva, sin errores ni 4xx.
 *  B · cliente que VENÍA de la publicación anterior: se le siembra la caché
 *      `v58` con contenido, se registra el worker publicado y se comprueba que
 *      al activar la purga la borra y deja UNA sola. Es el camino que recorre
 *      de verdad quien ya tenía la app instalada.
 *  C · el aviso de actualización no aparece donde no corresponde: en una
 *      instalación limpia no hay nada que actualizar.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const URL_PUBLICA = 'https://taba2-staging.pages.dev';
const CACHE_NUEVA = 'la-taba-runtime-v59-aviso-de-actualizacion';
const CACHE_VIEJA = 'la-taba-runtime-v58-panel-operativo';
const SALIDA = 'D:/1212/artifacts/taba2-operational-resilience/certificacion-sw-publico.json';

const pasos = [];
const anotar = (nombre, ok, detalle = '') => {
  pasos.push({ nombre, ok, detalle });
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre.padEnd(58, '.')} ${detalle}`);
};

const esperarWorker = (pagina) => pagina.waitForFunction(
  () => navigator.serviceWorker.controller !== null,
  null, { timeout: 60_000 },
);

const navegador = await chromium.launch({ headless: true });

// ===== A · instalación limpia =====
let contexto = await navegador.newContext({ serviceWorkers: 'allow', viewport: { width: 390, height: 844 } });
let pagina = await contexto.newPage();
const errores = []; const malas = [];
pagina.on('pageerror', (e) => errores.push(String(e).slice(0, 160)));
pagina.on('console', (m) => { if (m.type() === 'error' && !/favicon/i.test(m.text())) errores.push(m.text().slice(0, 160)); });
pagina.on('response', (r) => { if (r.status() >= 400 && !/favicon/i.test(r.url())) malas.push(`${r.status()} ${r.url().replace(/\?.*/, '')}`); });

await pagina.goto(`${URL_PUBLICA}/`, { waitUntil: 'load', timeout: 90_000 });
await esperarWorker(pagina).catch(() => {});
await pagina.waitForTimeout(9000);

const limpia = await pagina.evaluate(async () => ({
  caches: await caches.keys(),
  controlado: Boolean(navigator.serviceWorker.controller),
  aviso: document.querySelector('[data-app-update-banner]')?.hidden,
}));
anotar('instalación limpia: el worker toma el control', limpia.controlado, `cachés: ${limpia.caches.join(', ')}`);
anotar('queda UNA sola caché y es la de esta release',
  limpia.caches.filter((c) => c.startsWith('la-taba-runtime-')).length === 1 && limpia.caches.includes(CACHE_NUEVA),
  limpia.caches.join(', '));
anotar('sin nada que actualizar, el aviso no aparece', limpia.aviso === true, `hidden=${limpia.aviso}`);
await contexto.close();

// ===== B · el que ya tenía la app =====
contexto = await navegador.newContext({ serviceWorkers: 'allow', viewport: { width: 390, height: 844 } });
pagina = await contexto.newPage();
pagina.on('pageerror', (e) => errores.push(String(e).slice(0, 160)));
pagina.on('response', (r) => { if (r.status() >= 400 && !/favicon/i.test(r.url())) malas.push(`${r.status()} ${r.url().replace(/\?.*/, '')}`); });

// Se siembra la caché de la publicación anterior ANTES de que el worker exista.
await pagina.addInitScript(async ({ vieja }) => {
  const cache = await caches.open(vieja);
  await cache.put('/index.html', new Response('<!doctype html><p>versión anterior</p>', {
    headers: { 'content-type': 'text/html' },
  }));
}, { vieja: CACHE_VIEJA });

await pagina.goto(`${URL_PUBLICA}/`, { waitUntil: 'load', timeout: 90_000 });
const sembrada = await pagina.evaluate(() => caches.keys());
await esperarWorker(pagina).catch(() => {});
await pagina.waitForTimeout(12_000);

const despues = await pagina.evaluate(async () => ({
  caches: await caches.keys(),
  entradas: (await (await caches.open('la-taba-runtime-v59-aviso-de-actualizacion')).keys()).length,
}));
anotar('el perfil arrancó con la caché anterior sembrada', sembrada.includes(CACHE_VIEJA), sembrada.join(', '));
anotar('al activar, la publicación anterior se borra sola',
  !despues.caches.includes(CACHE_VIEJA), despues.caches.join(', '));
anotar('y queda precacheada la release completa',
  despues.caches.includes(CACHE_NUEVA) && despues.entradas > 100, `${despues.entradas} entradas`);

anotar('cero errores de página en los dos caminos', errores.length === 0, errores.slice(0, 2).join(' | '));
anotar('cero respuestas 4xx o 5xx', malas.length === 0, malas.slice(0, 3).join(' | '));

await contexto.close();
await navegador.close();

const resultado = {
  momento: new Date().toISOString(),
  url: URL_PUBLICA,
  cache: CACHE_NUEVA,
  pasos,
  verdes: pasos.filter((p) => p.ok).length,
  total: pasos.length,
  errores,
  respuestas4xx: malas,
};
fs.writeFileSync(SALIDA, `${JSON.stringify(resultado, null, 2)}\n`, 'utf8');
console.log(`\n${resultado.verdes}/${resultado.total} · evidencia en ${SALIDA}`);
process.exit(resultado.verdes === resultado.total ? 0 : 1);
