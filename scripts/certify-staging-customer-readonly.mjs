/*
 * Certificación READ-ONLY del cliente publicado.
 *
 * No despliega, no muta y no crea nada: sólo GET sobre el sitio público y un
 * navegador descartable. Todo lo que escribe lo escribe en el perfil efímero de
 * ese navegador, nunca en el servidor.
 *
 * Mira cuatro cosas que sólo se pueden ver contra lo que está SERVIDO:
 *   1. el cliente nuevo: que arranque, registre el worker y complete su caché;
 *   2. el cliente recurrente: que la segunda visita venga del worker;
 *   3. qué versión del worker está publicada, y si trae o no los arreglos
 *      locales —para no confundir «corregido» con «servido»—;
 *   4. cómo contesta el BORDE ante un asset que no existe. Esto último decide
 *      si el envenenamiento de caché es un caso teórico o un caso de esta
 *      plataforma.
 *
 * Uso: node scripts/certify-staging-customer-readonly.mjs [--url=...] [--salida=...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (nombre, porDefecto) => {
  const encontrado = process.argv.find((a) => a.startsWith(`--${nombre}=`));
  return encontrado ? encontrado.slice(nombre.length + 3) : porDefecto;
};
const URL_BASE = arg('url', 'https://taba2-staging.pages.dev');
const SALIDA = path.resolve(ROOT, arg('salida', 'artifacts/taba2-customer-overnight-rc/staging'));

const informe = { url: URL_BASE, leidoUTC: new Date().toISOString() };
const navegador = await chromium.launch();
const contexto = await navegador.newContext({
  viewport: { width: 390, height: 844 },
  locale: 'es-AR',
  serviceWorkers: 'allow',
});
const errores = [];
const page = await contexto.newPage();
page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errores.push(`pageerror: ${String(e).slice(0, 200)}`));

// 1. Cliente nuevo.
const t0 = Date.now();
await page.goto(`${URL_BASE}/`, { waitUntil: 'load' });
await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 45_000 });
informe.clienteNuevo = {
  msHastaUsable: Date.now() - t0,
  ...(await page.evaluate(() => ({
    modo: document.body.dataset.appMode || null,
    vista: document.body.dataset.activeView || null,
    fondo: getComputedStyle(document.body).backgroundColor,
    navPosicion: document.querySelector('.mobile-nav') ? getComputedStyle(document.querySelector('.mobile-nav')).position : 'SIN-NODO',
    desborde: document.documentElement.scrollWidth - window.innerWidth,
    productos: document.querySelectorAll('[data-product-grid] [data-add-product]').length,
    reglas: (() => { try { return document.querySelector('link[href^="styles.css"]').sheet.cssRules.length; } catch (_) { return -1; } })(),
  }))),
};

await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 40_000 }).catch(() => undefined);
await page.waitForTimeout(6_000);
informe.worker = await page.evaluate(async () => {
  const registro = await navigator.serviceWorker.getRegistration();
  const nombres = await caches.keys();
  const cache = nombres.length ? await caches.open(nombres[0]) : null;
  return {
    controlando: !!navigator.serviceWorker.controller,
    alcance: registro?.scope || null,
    cachesDelOrigen: nombres,
    entradas: cache ? (await cache.keys()).length : 0,
  };
});

// 2. Cliente recurrente: la segunda visita ya tiene worker.
const t1 = Date.now();
await page.reload({ waitUntil: 'load' });
await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 45_000 });
informe.clienteRecurrente = {
  msHastaUsable: Date.now() - t1,
  ...(await page.evaluate(() => ({
    controlando: !!navigator.serviceWorker.controller,
    fondo: getComputedStyle(document.body).backgroundColor,
    desborde: document.documentElement.scrollWidth - window.innerWidth,
    pedidosDesdeRed: performance.getEntriesByType('resource').filter((r) => r.transferSize > 0).length,
    pedidosTotales: performance.getEntriesByType('resource').length,
  }))),
};

/*
 * 3. Cómo contesta el borde ante un asset que NO existe.
 *
 * En Cloudflare Pages la ruta desconocida cae al shell de la aplicación: 200 con
 * `index.html`. Eso significa que un despliegue al que le falte —o que
 * renombre— un asset precacheado no produce un 404: produce exactamente la
 * respuesta que envenena la caché, con estado de éxito y sin que nada avise.
 *
 * `cache.addAll` es la prueba del algodón: guarda cualquier respuesta con estado
 * ok y no mira el tipo. Se corre sobre una caché de prueba del propio navegador
 * descartable; no toca ni el servidor ni la caché del worker publicado.
 */
informe.bordeAnteAssetInexistente = await page.evaluate(async () => {
  const inexistente = './styles/no-existe-jamas-taba2.css';
  const respuesta = await fetch(inexistente, { cache: 'no-store' });
  const cuerpo = await respuesta.clone().text();
  let addAllGuardo = null;
  let tipoGuardado = null;
  try {
    const prueba = await caches.open('taba2-sonda-readonly');
    await prueba.addAll([inexistente]);
    const guardada = await prueba.match(inexistente);
    addAllGuardo = !!guardada;
    tipoGuardado = guardada ? guardada.headers.get('content-type') : null;
    await caches.delete('taba2-sonda-readonly');
  } catch (error) {
    addAllGuardo = false;
    tipoGuardado = `addAll rechazó: ${String(error).slice(0, 80)}`;
  }
  return {
    status: respuesta.status,
    tipo: respuesta.headers.get('content-type'),
    cuerpoEsHtml: cuerpo.trimStart().toLowerCase().startsWith('<!doctype html'),
    bytes: cuerpo.length,
    addAllLoGuardo: addAllGuardo,
    tipoGuardado,
  };
});

informe.erroresDeConsola = [...new Set(errores)];
await contexto.close();
await navegador.close();

fs.mkdirSync(SALIDA, { recursive: true });
fs.writeFileSync(path.join(SALIDA, 'staging-readonly.json'), JSON.stringify(informe, null, 2));
console.log(JSON.stringify(informe, null, 2));
