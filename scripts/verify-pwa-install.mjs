/*
 * COMPROBACIÓN REAL DE LA INSTALACIÓN, CONTRA UN NAVEGADOR DE VERDAD.
 *
 * Los tests fijan el contrato; esto mira lo que el navegador entiende, que no
 * es lo mismo. En particular:
 *
 *   · `Page.getAppManifest` es la lectura de CHROME, no la nuestra: devuelve el
 *     manifest ya parseado y la lista de errores/avisos que normalmente sólo se
 *     ven en DevTools. Un manifest sintácticamente válido puede tener un icono
 *     que Chrome descarta y nada en el repositorio lo diría.
 *   · Los iconos se piden por HTTP y se miden: un 404 o un tipo equivocado no
 *     rompe ninguna prueba de archivos, pero deja la instalación sin logo.
 *   · La consola se escucha entera: un error de módulo en el arranque anula la
 *     invitación aunque el manifest esté perfecto.
 *
 * Lo que esto NO puede comprobar, y hay que decirlo: que Android muestre el
 * prompt (depende de criterios del navegador que ningún arnés reproduce) y que
 * iOS agregue el icono al inicio (no hay API). Eso es prueba física.
 *
 * Uso:  node scripts/verify-pwa-install.mjs [--port 8199]
 *       node scripts/verify-pwa-install.mjs --base https://la-taba.pages.dev
 *
 * Con `--base` no se levanta nada: se mide el sitio PUBLICADO, que es el único
 * que tiene el borde de Cloudflare delante —el `Content-Type` del manifest sale
 * de `_headers`, y eso un servidor de archivos local no lo reproduce—. Ahí
 * tampoco se pide `?demo=1`: se mide la tienda real, con su catálogo real.
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';

const port = Number(readArg('--port', '8199'));
const baseRemoto = readArg('--base', '').replace(/\/$/, '');
const BASE = baseRemoto || `http://127.0.0.1:${port}`;
// La tienda local no tiene Supabase detrás y necesita el modo demo; la
// publicada tiene el suyo y hay que mirarla como la mira un cliente.
const ENTRADA = `${BASE}/${baseRemoto ? '' : '?demo=1'}`;
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 15; moto g15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';

const lineas = [];
let fallas = 0;
const ok = (texto) => lineas.push(`  OK    ${texto}`);
const mal = (texto) => { fallas += 1; lineas.push(`  FALLA ${texto}`); };
const dato = (texto) => lineas.push(`        ${texto}`);

let server = null;
let browser = null;
try {
  if (!baseRemoto) server = await startServer();
  browser = await chromium.launch();
  /*
   * Cada bloque se corre por separado y su excepción se convierte en una falla
   * del informe, en vez de tumbar el proceso.
   *
   * No es cosmético: el informe se imprime AL FINAL, así que una excepción a
   * mitad de camino se llevaba puestas todas las comprobaciones ya hechas y
   * dejaba una traza de pila donde tenía que haber un diagnóstico. Lo destapó
   * el control negativo del manifest roto: fallaba —bien—, pero sin decir qué.
   * Y un manifest roto es justamente el caso en que hace falta leer el informe.
   */
  for (const [nombre, comprobar] of [
    ['el manifest', verificarManifest],
    ['los iconos', verificarIconos],
    ['el documento', verificarDocumento],
    ['la invitación', verificarInvitacion],
  ]) {
    try {
      await comprobar();
    } catch (error) {
      mal(`${nombre}: la comprobación no pudo completarse — ${error?.message || error}`);
    }
  }
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
}

console.log(`\nCOMPROBACIÓN DE INSTALACIÓN — ${BASE}\n`);
console.log(lineas.join('\n'));
console.log(fallas ? `\n${fallas} comprobación(es) fallaron.\n` : '\nTodo en orden.\n');
process.exit(fallas ? 1 : 0);

/* ------------------------------------------------------------------------ */

async function verificarManifest() {
  lineas.push('MANIFEST (leído por Chrome, no por nosotros)');
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${ENTRADA}`, { waitUntil: 'load' });
  const cdp = await page.context().newCDPSession(page);
  const respuesta = await cdp.send('Page.getAppManifest');
  const errores = respuesta.errors || [];
  const criticos = errores.filter((error) => error.critical);
  const parsed = respuesta.parsed || JSON.parse(respuesta.data || '{}');

  if (criticos.length) mal(`Chrome reporta ${criticos.length} error(es) crítico(s): ${criticos.map((e) => e.message).join(' · ')}`);
  else ok('Chrome parsea el manifest sin errores críticos');
  for (const aviso of errores.filter((error) => !error.critical)) dato(`aviso de Chrome: ${aviso.message}`);

  const crudo = JSON.parse(respuesta.data || '{}');
  igual('name', crudo.name, 'La Taba');
  igual('short_name', crudo.short_name, 'La Taba');
  igual('display', crudo.display, 'standalone');
  igual('background_color', crudo.background_color, '#d0000d');
  dato(`scope resuelto: ${parsed.scope || '(el navegador no lo expuso)'}`);
  dato(`start_url: ${crudo.start_url}`);
  dato(`iconos declarados: ${(crudo.icons || []).length}`);

  const respuestaHttp = await page.request.get(`${BASE}/manifest.webmanifest`);
  const tipo = respuestaHttp.headers()['content-type'] || '';
  if (tipo.includes('application/manifest+json')) ok(`el manifest se sirve como ${tipo}`);
  else mal(`el manifest se sirve como "${tipo}" y debería ser application/manifest+json`);
  await page.context().close();
}

async function verificarIconos() {
  lineas.push('');
  lineas.push('ICONOS');
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${ENTRADA}`, { waitUntil: 'load' });
  const manifest = await (await page.request.get(`${BASE}/manifest.webmanifest`)).json();

  for (const icon of manifest.icons) {
    const url = new URL(icon.src, `${BASE}/`).href;
    const respuesta = await page.request.get(url);
    if (!respuesta.ok()) { mal(`${icon.src} contestó ${respuesta.status()}`); continue; }
    const tipo = respuesta.headers()['content-type'] || '';
    // Las dimensiones se leen de la cabecera IHDR del PNG: los 8 bytes de firma,
    // 4 de longitud, 4 de tipo, y ahí ancho y alto en big endian.
    const bytes = Buffer.from(await respuesta.body());
    const ancho = bytes.readUInt32BE(16);
    const alto = bytes.readUInt32BE(20);
    const declarado = icon.sizes;
    if (tipo.includes('image/png') && `${ancho}x${alto}` === declarado) {
      ok(`${icon.src} · ${declarado} · ${icon.purpose} · ${bytes.length} bytes`);
    } else {
      mal(`${icon.src} llegó como ${tipo} de ${ancho}x${alto} y declara ${declarado}`);
    }
  }

  const apple = await page.getAttribute('link[rel="apple-touch-icon"]', 'href');
  const appleUrl = new URL(apple, `${BASE}/`).href;
  const appleResp = await page.request.get(appleUrl);
  const appleTipo = appleResp.headers()['content-type'] || '';
  if (appleResp.ok() && appleTipo.includes('image/png')) ok(`apple-touch-icon ${apple} · ${appleTipo}`);
  else mal(`apple-touch-icon ${apple} llegó ${appleResp.status()} como ${appleTipo}`);
  await page.context().close();
}

async function verificarDocumento() {
  lineas.push('');
  lineas.push('DOCUMENTO Y SERVICE WORKER');
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  const page = await context.newPage();
  const errores = [];
  page.on('pageerror', (error) => errores.push(String(error.message)));
  page.on('console', (mensaje) => {
    if (mensaje.type() === 'error') errores.push(mensaje.text());
  });
  await page.goto(`${ENTRADA}`, { waitUntil: 'load' });
  await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 60_000 });

  /*
   * Se espera a `ready`, no a `getRegistration()`.
   *
   * Registrado y activo no son lo mismo: el precache son 130 archivos y la
   * primera visita tarda en instalarlos. Preguntar por el registro devuelve
   * "sí, activo: false" y eso no dice nada sobre si la app quedó controlada.
   */
  const registrado = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return null;
    const registro = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((resolve) => setTimeout(() => resolve(null), 45_000)),
    ]);
    return registro ? { scope: registro.scope, activo: Boolean(registro.active) } : null;
  });
  if (registrado?.activo) ok(`service worker activo y controlando ${registrado.scope}`);
  else if (registrado) mal(`el service worker quedó registrado en ${registrado.scope} pero sin activar`);
  else mal('no hay service worker activo');

  const precacheado = await page.evaluate(async () => {
    const claves = await caches.keys();
    if (!claves.length) return { cache: '', entradas: 0 };
    const cache = await caches.open(claves[0]);
    return { cache: claves[0], entradas: (await cache.keys()).length };
  });
  if (precacheado.entradas > 100) ok(`precache "${precacheado.cache}" con ${precacheado.entradas} entradas`);
  else mal(`el precache quedó en ${precacheado.entradas} entrada(s)`);
  // Lo que NO tiene que estar guardado: cualquier respuesta de datos vivos.
  const sospechosas = await page.evaluate(async () => {
    const claves = await caches.keys();
    const urls = [];
    for (const clave of claves) {
      const cache = await caches.open(clave);
      for (const pedido of await cache.keys()) urls.push(pedido.url);
    }
    return urls.filter((url) => /\/rest\/v1\/|\/auth\/v1\/|\/functions\/v1\/|supabase\.co/.test(url));
  });
  if (sospechosas.length) mal(`el worker guardó ${sospechosas.length} respuesta(s) de API: ${sospechosas.slice(0, 3).join(', ')}`);
  else ok('el precache no contiene ninguna respuesta de pedidos, sesión ni API');

  const modo = await page.getAttribute('html', 'data-taba-display-mode');
  if (modo === 'browser') ok('en una pestaña normal el modo se marca como "browser"');
  else mal(`el modo de visualización dice "${modo}" en una pestaña normal`);

  // Enlaces internos que abrirían una pestaña del navegador estando instalada.
  const fuera = await page.evaluate(() => [...document.querySelectorAll('a[target="_blank"]')]
    .map((a) => a.getAttribute('href') || '')
    .filter((href) => href && !/^(https?:)?\/\//.test(href) && !href.startsWith('mailto:') && !href.startsWith('tel:')));
  if (fuera.length) mal(`${fuera.length} enlace(s) internos abren pestaña nueva: ${fuera.join(', ')}`);
  else ok('ningún enlace interno abre una pestaña del navegador');

  if (errores.length) mal(`la consola registró ${errores.length} error(es): ${errores.slice(0, 3).join(' · ')}`);
  else ok('la consola queda limpia durante el arranque');
  await context.close();
}

async function verificarInvitacion() {
  lineas.push('');
  lineas.push('INVITACIÓN');

  // Android con el evento disponible.
  const android = await browser.newContext({ userAgent: ANDROID_UA, viewport: { width: 390, height: 844 }, hasTouch: true });
  const pageAndroid = await android.newPage();
  await pageAndroid.addInitScript(() => {
    window.__prompts = 0;
    window.__fire = () => {
      const evento = new Event('beforeinstallprompt');
      evento.prompt = async () => { window.__prompts += 1; return { outcome: 'dismissed' }; };
      evento.userChoice = Promise.resolve({ outcome: 'dismissed' });
      window.dispatchEvent(evento);
    };
  });
  await pageAndroid.goto(`${ENTRADA}`, { waitUntil: 'load' });
  await pageAndroid.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 60_000 });
  await pageAndroid.evaluate(() => window.__fire());
  const hojaAndroid = pageAndroid.locator('[data-install-sheet]');
  await hojaAndroid.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
  if (await hojaAndroid.isVisible()) ok('Android: la hoja se abre con el evento del navegador capturado');
  else mal('Android: la hoja no se abrió con el evento disponible');
  const titulo = await pageAndroid.locator('[data-install-view="android"] .install-sheet-title').textContent().catch(() => '');
  dato(`título: ${String(titulo || '').trim()}`);
  await android.close();

  // iPhone sin instalar.
  const ios = await browser.newContext({ userAgent: IPHONE_UA, viewport: { width: 390, height: 844 }, hasTouch: true });
  const pageIos = await ios.newPage();
  await pageIos.goto(`${ENTRADA}`, { waitUntil: 'load' });
  await pageIos.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 60_000 });
  const hojaIos = pageIos.locator('[data-install-view="ios"]');
  await hojaIos.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
  if (await hojaIos.isVisible()) ok('iPhone: se ofrece la guía y no un prompt inexistente');
  else mal('iPhone: no apareció la guía');
  const hayBotonNativo = await pageIos.locator('[data-install-accept]').isVisible();
  if (!hayBotonNativo) ok('iPhone: el botón de instalación nativa NO se muestra');
  else mal('iPhone: se está mostrando un botón de instalación que iOS no puede honrar');
  await ios.close();

  // Escritorio.
  const escritorio = await browser.newContext();
  const pageDesktop = await escritorio.newPage();
  await pageDesktop.goto(`${ENTRADA}`, { waitUntil: 'load' });
  await pageDesktop.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 60_000 });
  await pageDesktop.waitForTimeout(4000);
  if (!(await pageDesktop.locator('[data-install-sheet]').isVisible())) ok('Escritorio: no aparece ninguna invitación');
  else mal('Escritorio: apareció la invitación de teléfono');
  await escritorio.close();
}

function igual(campo, actual, esperado) {
  if (actual === esperado) ok(`${campo} = ${JSON.stringify(actual)}`);
  else mal(`${campo} = ${JSON.stringify(actual)} y debería ser ${JSON.stringify(esperado)}`);
}

function startServer() {
  return new Promise((resolve, reject) => {
    const proceso = spawn(process.execPath, [path.resolve('scripts/realtime-relay.mjs'), String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
    const listo = setTimeout(() => resolve(proceso), 1200);
    proceso.on('error', (error) => { clearTimeout(listo); reject(error); });
  });
}

function readArg(nombre, porDefecto) {
  const argumentos = process.argv.slice(2);
  const indice = argumentos.indexOf(nombre);
  return indice >= 0 && argumentos[indice + 1] ? argumentos[indice + 1] : porDefecto;
}
