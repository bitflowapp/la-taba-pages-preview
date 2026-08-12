/*
 * La actualización del service worker vista desde un cliente que YA tenía el
 * anterior.
 *
 * Es el caso de todos los clientes que hoy usan staging: tienen el worker de
 * `1d26c4b` instalado y su caché llena. El candidato cambia `sw.js` y NO cambia
 * `CACHE_NAME` —los assets son los mismos—, así que el `activate` del worker
 * nuevo no debe borrar nada. Lo que se demuestra acá:
 *
 *   · el navegador detecta el `sw.js` nuevo y lo instala;
 *   · la caché existente NO queda vacía en ningún momento;
 *   · no quedan dos cachés conviviendo (mezcla);
 *   · el cliente actualizado hace el recorrido de vuelta desde el origen
 *     externo con la tienda intacta.
 *
 * Cómo se monta el "cliente anterior": se intercepta la petición de `sw.js` y
 * se le entrega los bytes de `1d26c4b`. Después se levanta la intercepción y el
 * origen sirve el candidato, que es exactamente lo que le pasa a una persona
 * que vuelve a entrar después de la publicación.
 *
 * No confirma checkouts, no crea pedidos y no toca el backend.
 */
import { chromium, webkit } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const BASE = (process.env.BASE || 'https://taba2-staging.pages.dev').replace(/\/$/, '');
const ENGINE_NAME = process.env.ENGINE === 'webkit' ? 'webkit' : 'chromium';
const ENGINE = ENGINE_NAME === 'webkit' ? webkit : chromium;
const ANTERIOR = process.env.ANTERIOR || '1d26c4b';

const fallas = [];
const anota = (condicion, detalle) => { if (!condicion) fallas.push(detalle); return condicion; };

const swAnterior = execFileSync('git', ['show', `${ANTERIOR}:sw.js`], { encoding: 'utf8', maxBuffer: 1e8 });
const firmaAnterior = /async function networkFirst/.test(swAnterior);
if (firmaAnterior) {
  console.error(`el sw.js de ${ANTERIOR} ya trae el arreglo: no sirve como "cliente anterior"`);
  process.exit(1);
}

const estado = async (pagina) => pagina.evaluate(async () => {
  const claves = await caches.keys();
  const entradas = {};
  for (const clave of claves) entradas[clave] = (await (await caches.open(clave)).keys()).length;
  const registro = await navigator.serviceWorker.getRegistration();
  return {
    claves,
    entradas,
    controlado: !!navigator.serviceWorker.controller,
    scriptControlador: navigator.serviceWorker.controller?.scriptURL || null,
    instalando: !!registro?.installing,
    esperando: !!registro?.waiting,
    activo: !!registro?.active,
  };
});

const navegador = await ENGINE.launch();
const contexto = await navegador.newContext({
  viewport: { width: 390, height: 844 },
  serviceWorkers: 'allow',
  isMobile: ENGINE_NAME === 'webkit',
  hasTouch: true,
});
const pagina = await contexto.newPage();

console.log(`## ${ENGINE_NAME} · actualización del worker · ${BASE}`);

// 1 · el cliente anterior: se le sirve el sw.js de la base desplegada
let sirviendoAnterior = true;
await contexto.route(`${BASE}/sw.js`, (ruta) => {
  if (!sirviendoAnterior) return ruta.fallback();
  return ruta.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: swAnterior });
});

await pagina.goto(`${BASE}/#home`, { waitUntil: 'load', timeout: 60_000 });
await pagina.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 60_000 });
await pagina.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 60_000 });
await pagina.waitForFunction(async () => {
  const claves = await caches.keys();
  return claves.length ? (await (await caches.open(claves[0])).keys()).length > 100 : false;
}, null, { timeout: 90_000 });

const antes = await estado(pagina);
console.log(`   cliente ANTERIOR · cachés=${JSON.stringify(antes.entradas)} controlado=${antes.controlado} esperando=${antes.esperando}`);
anota(antes.controlado, 'el worker anterior no llegó a controlar la pestaña');
/*
 * Que el cliente tenía OTROS bytes se demuestra en diferencial, no preguntándole
 * al origen: acá no hay ningún worker en espera, y aparece uno recién después de
 * cambiar lo que sirve el origen. Un worker en espera sólo nace cuando el
 * `sw.js` publicado difiere del instalado; si este cliente ya tuviera el
 * candidato, la comparación daría igual y no habría nada esperando.
 *
 * Preguntarle al origen desde la página no sirve: esa petición ATRAVIESA al
 * worker instalado, que es red-primero, así que devuelve lo que el origen tenga
 * en ese momento y no lo que el registro usó.
 */
anota(!antes.esperando, 'el cliente anterior ya arrancó con un worker en espera: el punto de partida no es limpio');
const entradasAntes = Object.values(antes.entradas)[0] || 0;
anota(entradasAntes > 100, `el cliente anterior quedó con ${entradasAntes} entradas en caché`);

// 2 · se publica: el origen vuelve a servir el candidato
sirviendoAnterior = false;
console.log('   (el origen pasa a servir el candidato)');

// 3 · la persona vuelve a entrar. `pwa-update.js` revisa la publicación en
//     `load`, `pageshow`, `focus` y `visibilitychange`.
await pagina.reload({ waitUntil: 'load', timeout: 60_000 });
await pagina.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 60_000 });

// El worker nuevo tiene que INSTALARSE. No se fuerza la activación destructiva:
// se espera a que aparezca, como le pasaría a cualquiera.
const aparecio = await pagina.waitForFunction(async () => {
  const registro = await navigator.serviceWorker.getRegistration();
  return !!(registro?.waiting || registro?.installing)
    || !!(registro?.active && registro.active.scriptURL);
}, null, { timeout: 90_000 }).then(() => true).catch(() => false);
anota(aparecio, 'el navegador no llegó a detectar el sw.js nuevo');

// Durante toda la instalación la caché NO puede quedar vacía.
let minimoDurante = Infinity;
for (let i = 0; i < 12; i += 1) {
  const foto = await estado(pagina);
  const total = Object.values(foto.entradas).reduce((a, b) => a + b, 0);
  minimoDurante = Math.min(minimoDurante, total);
  if (foto.esperando || foto.instalando) await pagina.waitForTimeout(1_000);
  else break;
}
console.log(`   durante la instalación · mínimo de entradas en caché=${minimoDurante}`);
anota(minimoDurante > 100, `la caché bajó a ${minimoDurante} entradas durante la actualización`);

const durante = await estado(pagina);
console.log(`   worker nuevo · esperando=${durante.esperando} instalando=${durante.instalando} activo=${durante.activo}`);
// La otra mitad del diferencial: antes del cambio no había nada esperando y
// ahora sí. Eso es el navegador diciendo «este sw.js no es el que tengo».
anota(durante.esperando || durante.instalando, 'no apareció ningún worker nuevo tras cambiar lo que sirve el origen');

// 4 · la actualización se toma como la tomaría una persona: recargando. No se
//     fuerza `skipWaiting` desde acá.
if (durante.esperando) {
  await pagina.evaluate(async () => {
    const registro = await navigator.serviceWorker.getRegistration();
    registro?.waiting?.postMessage('skip-waiting');
  });
  await pagina.waitForTimeout(3_000);
}
await pagina.reload({ waitUntil: 'load', timeout: 60_000 });
await pagina.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 60_000 });
await pagina.waitForTimeout(3_000);

const despues = await estado(pagina);
const entradasDespues = Object.values(despues.entradas).reduce((a, b) => a + b, 0);
console.log(`   cliente ACTUALIZADO · cachés=${JSON.stringify(despues.entradas)} controlado=${despues.controlado}`);
anota(despues.claves.length === 1, `quedaron ${despues.claves.length} cachés conviviendo: ${despues.claves.join(', ')}`);
anota(entradasDespues > 100, `la caché quedó en ${entradasDespues} entradas`);
anota(despues.controlado, 'la pestaña quedó sin worker que la controle');

const workerServido = await pagina.evaluate(async (base) => {
  const respuesta = await fetch(`${base}/sw.js`, { cache: 'no-store' });
  const texto = await respuesta.text();
  return {
    arreglo: texto.includes('async function networkFirst') && texto.includes('function isUsable'),
    cache: texto.match(/CACHE_NAME = '([^']+)'/)?.[1] || null,
  };
}, BASE);
console.log(`   sw.js servido · arreglo=${workerServido.arreglo} CACHE_NAME=${workerServido.cache}`);
anota(workerServido.arreglo, 'el origen no está sirviendo el worker con el arreglo');

// 5 · y el cliente actualizado hace el recorrido de vuelta con la tienda intacta
await pagina.evaluate(() => { window.location.hash = '#catalog'; });
const agregar = pagina.locator('[data-product-grid] [data-add-product]:not([disabled]) >> visible=true').first();
await agregar.waitFor({ state: 'visible', timeout: 60_000 });
await agregar.click();
await pagina.evaluate(() => { window.location.hash = '#cart'; });
await pagina.locator('[data-checkout-form]').waitFor({ state: 'visible', timeout: 30_000 });
const carritoAntes = await pagina.evaluate(async () => {
  const { getState } = await import('/js/state.js');
  return getState().cart.map((i) => `${i.productId}:${i.quantity}`).sort();
});

await pagina.evaluate(() => { window.location.assign('https://www.mercadopago.com.ar/'); });
await pagina.waitForURL(/mercadopago\.com/, { timeout: 60_000 });
await pagina.goBack({ waitUntil: 'commit', timeout: 60_000 });
await pagina.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 60_000 });
await pagina.waitForTimeout(2_500);

const vuelta = await pagina.evaluate(() => {
  const link = document.querySelector('link[href^="styles.css"]');
  let vivos = 0;
  let totales = -1;
  try {
    const imports = [...link.sheet.cssRules].filter((r) => r.type === CSSRule.IMPORT_RULE);
    totales = imports.length;
    imports.forEach((r) => { try { if (r.styleSheet?.cssRules.length) vivos += 1; } catch (_) { /* perdida */ } });
  } catch (_) { /* sin hoja */ }
  return {
    fondo: getComputedStyle(document.body).backgroundColor,
    nav: document.querySelector('.mobile-nav') ? getComputedStyle(document.querySelector('.mobile-nav')).position : 'SIN-NODO',
    vivos,
    totales,
  };
});
const carritoDespues = await pagina.evaluate(async () => {
  const { getState } = await import('/js/state.js');
  return getState().cart.map((i) => `${i.productId}:${i.quantity}`).sort();
});
console.log(`   recorrido con el worker actualizado · fondo=${vuelta.fondo} imports=${vuelta.vivos}/${vuelta.totales} nav=${vuelta.nav} carrito=${carritoDespues.length}`);
anota(vuelta.fondo === 'rgb(9, 11, 14)', `al volver se perdió la superficie de marca: ${vuelta.fondo}`);
anota(vuelta.vivos === vuelta.totales && vuelta.totales > 0, `cadena de @import incompleta al volver: ${vuelta.vivos}/${vuelta.totales}`);
anota(vuelta.nav === 'fixed', `la barra inferior quedó ${vuelta.nav}`);
anota(JSON.stringify(carritoDespues) === JSON.stringify(carritoAntes), 'el carrito cambió al volver');

await navegador.close();

console.log(`\n${fallas.length ? `FALLAS (${fallas.length}):` : 'SIN FALLAS'}`);
fallas.forEach((linea) => console.log(`  ✗ ${linea}`));
process.exit(fallas.length ? 1 : 0);
