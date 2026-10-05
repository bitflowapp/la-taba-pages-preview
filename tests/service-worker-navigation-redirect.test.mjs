/*
 * La PWA instalada no abría: `ERR_FAILED` al lanzarla desde el ícono.
 *
 * Causa raíz, medida en el Moto G15 con el worker de producción (v97) y
 * reproducida acá sin navegador:
 *
 *   1. El `start_url` del manifiesto era `./index.html`, y Cloudflare Pages
 *      contesta `/index.html` con un 308 a `/`.
 *   2. `install` precacheaba `./index.html` con `fetch` que SIGUE la redirección:
 *      la respuesta guardada trae `redirected === true`.
 *   3. Una navegación pasa por `networkFirst`; la red devuelve el redirect sin
 *      seguir (`opaqueredirect`, no `ok`), así que el worker cae en
 *      `cachedFallback` y entrega la copia guardada.
 *   4. El navegador PROHÍBE responder una navegación con una respuesta
 *      `redirected`: la trata como error de red. `ERR_FAILED`.
 *
 * Con red o sin red el resultado era el mismo para esa URL, y el respaldo de
 * cualquier OTRA navegación sin copia propia (`caches.match('./index.html')`)
 * heredaba el mismo defecto: sin conexión, la PWA tampoco abría en `/`.
 *
 * El fallback correcto es la shell canónica `./` (la que sirve la red) y nunca
 * una respuesta marcada como redirigida.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGEN = 'https://taba.test';
const FUENTE = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const NOMBRE_CACHE = FUENTE.match(/const CACHE_NAME = '([^']+)'/)[1];

const absoluta = (url) => new URL(typeof url === 'string' ? url : url.url, `${ORIGEN}/`).href;

/** Una respuesta que el navegador marcaría `redirected`: seguía un 308. */
class RespuestaRedirigida extends Response {
  get redirected() { return true; }
  clone() {
    const copia = super.clone();
    return new RespuestaRedirigida(copia.body, { status: copia.status, statusText: copia.statusText, headers: copia.headers });
  }
}
const html = (cuerpo = '<!doctype html><title>TABA2</title>') => new Response(cuerpo, {
  status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
});
const htmlRedirigido = (cuerpo = '<!doctype html><title>TABA2</title>') => new RespuestaRedirigida(cuerpo, {
  status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
});
const css = () => new Response('body{background:#090b0e}', { status: 200, headers: { 'content-type': 'text/css' } });
const js = () => new Response('export const ok = 1;', { status: 200, headers: { 'content-type': 'text/javascript' } });
/** Lo que `fetch` devuelve a un worker para una navegación con `redirect: manual`. */
const redireccionSinSeguir = () => ({
  type: 'opaqueredirect', status: 0, ok: false, redirected: false, headers: new Headers(), body: null, clone() { return this; },
});

/** Borde de Cloudflare Pages: `/index.html` redirige a `/`; el resto sirve normal. */
function redPages() {
  return async (solicitud) => {
    const url = absoluta(solicitud);
    const ruta = url.split('?')[0];
    // Una navegación llega con `redirect: manual` y recibe el redirect sin seguir;
    // cualquier otro pedido (el precache de `install`) lo sigue y trae `redirected`.
    if (ruta === `${ORIGEN}/index.html`) return solicitud.mode === 'navigate' ? redireccionSinSeguir() : htmlRedirigido();
    if (ruta.endsWith('.css')) return css();
    if (ruta.endsWith('.js') || ruta.endsWith('.mjs')) return js();
    return html();
  };
}

function cargarWorker({ red, cachesPrevias = {} }) {
  const almacenes = new Map();
  for (const [nombre, entradas] of Object.entries(cachesPrevias)) {
    almacenes.set(nombre, new Map(entradas.map(([u, r]) => [absoluta(u), r])));
  }
  const abrir = (nombre) => {
    if (!almacenes.has(nombre)) almacenes.set(nombre, new Map());
    const mapa = almacenes.get(nombre);
    return {
      put: async (s, r) => { mapa.set(absoluta(s), r); },
      match: async (s) => mapa.get(absoluta(s)),
      keys: async () => [...mapa.keys()].map((url) => ({ url })),
      delete: async (s) => mapa.delete(absoluta(s)),
    };
  };
  const caches = {
    open: async (n) => abrir(n),
    match: async (s) => {
      for (const mapa of almacenes.values()) {
        const hallada = mapa.get(absoluta(s));
        if (hallada) return hallada;
      }
      return undefined;
    },
    keys: async () => [...almacenes.keys()],
    delete: async (n) => almacenes.delete(n),
  };
  const oyentes = new Map();
  const self = {
    location: new URL(`${ORIGEN}/`),
    registration: { scope: `${ORIGEN}/` },
    addEventListener: (tipo, oyente) => oyentes.set(tipo, oyente),
    clients: { claim: async () => undefined },
    skipWaiting: () => undefined,
  };
  class RequestDeWorker {
    constructor(entrada, opciones = {}) {
      this.url = absoluta(entrada);
      this.method = String(opciones.method || 'GET').toUpperCase();
      this.mode = opciones.mode || 'no-cors';
      this.destination = opciones.destination || '';
      this.cache = opciones.cache || 'default';
    }
  }
  // eslint-disable-next-line no-new-func
  const ejecutar = new Function('self', 'caches', 'fetch', 'Response', 'Request', 'URL', 'setTimeout', 'clearTimeout', 'TextDecoder', FUENTE);
  ejecutar(self, caches, red, Response, RequestDeWorker, URL, setTimeout, clearTimeout, TextDecoder);
  const disparar = async (tipo) => {
    let esperado;
    await oyentes.get(tipo)({ waitUntil: (v) => { esperado = v; } });
    await esperado;
  };
  return {
    instalar: () => disparar('install'),
    activar: () => disparar('activate'),
    /** Lo que el navegador recibe. Aplica SU regla: una navegación no admite `redirected`. */
    navegar: async (url) => {
      let prometida;
      oyentes.get('fetch')({
        request: { url: absoluta(url), mode: 'navigate', destination: 'document', method: 'GET', redirect: 'manual' },
        respondWith: (v) => { prometida = v; },
      });
      const respuesta = await prometida;
      return { respuesta, errorDeRed: !respuesta || respuesta.type === 'error' || respuesta.redirected === true };
    },
    guardada: (url) => almacenes.get(NOMBRE_CACHE)?.get(absoluta(url)),
  };
}

const sinRed = async () => { throw new TypeError('sin red'); };

test('install no guarda ninguna respuesta marcada como redirigida', async () => {
  const worker = cargarWorker({ red: redPages() });
  await worker.instalar();
  for (const entrada of ['./', './index.html']) {
    const guardada = worker.guardada(entrada);
    assert.ok(guardada, `${entrada} debe estar precacheada`);
    assert.equal(guardada.redirected, false, `${entrada}: una copia redirigida rompe cualquier navegación que la use`);
  }
});

test('con red: /index.html canoniza a / y nunca queda en error de red', async () => {
  const worker = cargarWorker({ red: redPages() });
  await worker.instalar();
  await worker.activar();
  const { respuesta, errorDeRed } = await worker.navegar('/index.html');
  assert.equal(errorDeRed, false, 'ERR_FAILED: el worker respondió la navegación con una respuesta redirigida');
  assert.ok([301, 302, 303, 307, 308].includes(respuesta.status), 'la salida canónica es una redirección a la raíz');
  assert.equal(new URL(respuesta.headers.get('location'), ORIGEN).href, `${ORIGEN}/`);
});

test('sin red: / abre desde la caché y /index.html canoniza a / (arranque offline de la PWA)', async () => {
  let enLinea = true;
  const worker = cargarWorker({ red: (s) => (enLinea ? redPages()(s) : sinRed()) });
  await worker.instalar();
  await worker.activar();
  enLinea = false;
  const raiz = await worker.navegar('/');
  assert.equal(raiz.errorDeRed, false);
  assert.equal(raiz.respuesta.status, 200);
  assert.match(await raiz.respuesta.clone().text(), /TABA2/);
  const indice = await worker.navegar('/index.html');
  assert.equal(indice.errorDeRed, false, 'ERR_FAILED sin red');
  assert.equal(new URL(indice.respuesta.headers.get('location'), ORIGEN).href, `${ORIGEN}/`);
});

test('el respaldo de una navegación sin copia propia es la shell canónica, no una redirigida', async () => {
  let enLinea = true;
  const worker = cargarWorker({ red: (s) => (enLinea ? redPages()(s) : sinRed()) });
  await worker.instalar();
  await worker.activar();
  enLinea = false;
  const { respuesta, errorDeRed } = await worker.navegar('/pedido-que-nunca-se-guardo');
  assert.equal(errorDeRed, false);
  assert.equal(respuesta.status, 200);
});

test('una redirección del borde a otra ruta se entrega tal cual, no se reemplaza por la shell', async () => {
  const redireccion = redireccionSinSeguir();
  const worker = cargarWorker({
    red: async (s) => (absoluta(s) === `${ORIGEN}/cuenta` && s.mode === 'navigate' ? redireccion : redPages()(s)),
  });
  await worker.instalar();
  await worker.activar();
  const { respuesta } = await worker.navegar('/cuenta');
  assert.equal(respuesta, redireccion, 'el navegador tiene que poder seguir el 308 a /cuenta/');
});

test('actualización desde un worker viejo: una copia redirigida heredada no llega al navegador', async () => {
  // El estado que dejó v97: `./index.html` guardado con `redirected === true`.
  const worker = cargarWorker({
    red: sinRed,
    cachesPrevias: {
      [NOMBRE_CACHE]: [['./index.html', htmlRedirigido()], ['./', htmlRedirigido('<!doctype html><title>TABA2 viejo</title>')]],
    },
  });
  const raiz = await worker.navegar('/');
  assert.equal(raiz.errorDeRed, false, 'una copia heredada marcada como redirigida debe sanearse al leerla');
  const otra = await worker.navegar('/otra-ruta');
  assert.equal(otra.errorDeRed, false);
});

