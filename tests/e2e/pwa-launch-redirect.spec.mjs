/*
 * LA PWA INSTALADA ABRE: `/index.html` bajo un service worker REAL.
 *
 * El gate corre con `serviceWorkers: 'block'`, así que ningún navegador veía lo
 * que veía el Moto G15: lanzada desde el ícono, la app instalada mostraba
 * `ERR_FAILED`. La causa y su medición están en
 * `tests/service-worker-navigation-redirect.test.mjs`; acá se prueba lo mismo
 * con Chromium y un worker de verdad, contra un servidor que se comporta como
 * Cloudflare Pages: `/index.html` responde 308 a `/`.
 *
 *   control negativo  el worker de PRODUCCIÓN (v97, bytes idénticos) reproduce
 *                     el error. Si alguna vez deja de fallar, la prueba de la
 *                     migración deja de demostrar algo y hay que enterarse.
 *   migración         un cliente controlado por v97 que relanza la app recibe el
 *                     worker nuevo sin borrar nada y abre.
 *   arranque          con red y sin red, por `/` y por `/index.html`.
 */
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORKER_V97 = fs.readFileSync(path.join(root, 'tests/fixtures/sw-runtime-v97-production.js'), 'utf8');
const WORKER_ACTUAL = () => fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const CACHE_ACTUAL = () => WORKER_ACTUAL().match(/const CACHE_NAME = '([^']+)'/)[1];
const CACHE_V97 = 'la-taba-runtime-v97-explicit-seller-status';
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon', '.txt': 'text/plain',
};

test.use({ serviceWorkers: 'allow', viewport: { width: 390, height: 844 } });
test.describe.configure({ timeout: 120_000 });

let server;
let origin;
let publicado = 'v97';

test.beforeAll(async () => {
  server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const sinCache = { 'cache-control': 'no-cache' };
    if (url.pathname === '/sw.js') {
      response.writeHead(200, { ...sinCache, 'content-type': TIPOS['.js'] });
      response.end(publicado === 'v97' ? WORKER_V97 : WORKER_ACTUAL());
      return;
    }
    // Cloudflare Pages: el alias del documento redirige a la raíz.
    if (url.pathname === '/index.html') {
      response.writeHead(308, { ...sinCache, location: `/${url.search}` });
      response.end();
      return;
    }
    let relativa = decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, ''));
    let destino = path.resolve(root, relativa);
    if (!destino.startsWith(root) || relativa.includes('..')) { response.writeHead(403); response.end(); return; }
    try { if (fs.statSync(destino).isDirectory()) destino = path.join(destino, 'index.html'); } catch { /* 404 abajo */ }
    fs.readFile(destino, (error, data) => {
      if (error) { response.writeHead(404, sinCache); response.end('no'); return; }
      response.writeHead(200, { ...sinCache, 'content-type': TIPOS[path.extname(destino).toLowerCase()] || 'application/octet-stream' });
      response.end(data);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => { if (server) await new Promise((resolve) => server.close(resolve)); });
test.beforeEach(() => { publicado = 'v97'; });

async function abrirControlada(context, ruta = '/') {
  const page = await context.newPage();
  await page.addInitScript(() => {
    try { localStorage.setItem('TABA_INSTALL_PROMPT_V1', JSON.stringify({ v: 1, decision: 'declined', at: '2026-01-01', platform: 'e2e' })); } catch { /* sin storage */ }
  });
  await page.goto(`${origin}${ruta}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30_000 });
  return page;
}

async function precacheTerminado(page, nombre) {
  await page.waitForFunction(async (cache) => {
    if (!(await caches.keys()).includes(cache)) return false;
    return (await (await caches.open(cache)).keys()).length > 100;
  }, nombre, { timeout: 40_000 });
}

const intentarIr = async (page, ruta) => page.goto(`${origin}${ruta}`, { waitUntil: 'load', timeout: 20_000 })
  .then(() => ({ ok: true }), (error) => ({ ok: false, error: error.message.split('\n')[0] }));

async function tiendaLista(page) {
  await expect(page.locator('html')).toHaveAttribute('data-taba-startup', 'ready', { timeout: 30_000 });
}

test('el manifiesto arranca en la raíz, conserva la identidad y /index.html redirige a /', async ({ request }) => {
  publicado = 'actual';
  const manifiesto = await (await request.get(`${origin}/manifest.webmanifest`)).json();
  expect(new URL(manifiesto.start_url, `${origin}/manifest.webmanifest`).href).toBe(`${origin}/`);
  expect(new URL(manifiesto.scope, `${origin}/manifest.webmanifest`).href).toBe(`${origin}/`);
  // La identidad que ya tienen los teléfonos con la app instalada.
  expect(new URL(manifiesto.id, `${origin}/manifest.webmanifest`).href).toBe(`${origin}/index.html`);
  const alias = await request.get(`${origin}/index.html?x=1`, { maxRedirects: 0 });
  expect(alias.status()).toBe(308);
  expect(alias.headers().location).toBe('/?x=1');
});

test('CONTROL NEGATIVO: el worker de producción v97 deja la app en ERR_FAILED al abrir /index.html', async ({ context }) => {
  const page = await abrirControlada(context);
  await precacheTerminado(page, CACHE_V97);
  const resultado = await intentarIr(page, '/index.html');
  expect(resultado.ok, 'si esto abre, esta prueba ya no demuestra el defecto de producción').toBe(false);
  expect(resultado.error).toContain('ERR_FAILED');
});

test('worker actual: /index.html abre (se canoniza a /) y la raíz arranca', async ({ context }) => {
  publicado = 'actual';
  const page = await abrirControlada(context);
  await precacheTerminado(page, CACHE_ACTUAL());
  const resultado = await intentarIr(page, '/index.html');
  expect(resultado, JSON.stringify(resultado)).toEqual({ ok: true });
  expect(new URL(page.url()).pathname).toBe('/');
  await tiendaLista(page);
});

test('worker actual SIN RED: la app abre por / y por /index.html', async ({ context }) => {
  publicado = 'actual';
  const page = await abrirControlada(context);
  await precacheTerminado(page, CACHE_ACTUAL());
  await context.setOffline(true);
  try {
    const raiz = await intentarIr(page, '/');
    expect(raiz, 'arranque offline por /').toEqual({ ok: true });
    await tiendaLista(page);
    const alias = await intentarIr(page, '/index.html');
    expect(alias, 'arranque offline por /index.html').toEqual({ ok: true });
    expect(new URL(page.url()).pathname).toBe('/');
    await tiendaLista(page);
  } finally {
    await context.setOffline(false);
  }
});

test('MIGRACIÓN v97 → actual: relanzar la app instalada recupera el arranque sin borrar nada', async ({ context }) => {
  const page = await abrirControlada(context);
  await precacheTerminado(page, CACHE_V97);
  const datos = {
    'la_taba_production_cart_v1': JSON.stringify({ businessId: 'qa', items: [{ productId: 'qa-product', quantity: 2 }] }),
    'taba_qa_sesion': 'sesion-que-no-se-puede-perder',
  };
  await page.evaluate((valores) => Object.entries(valores).forEach(([k, v]) => localStorage.setItem(k, v)), datos);

  // Se publica la versión nueva y el usuario relanza la app: el worker viejo falla
  // en `/index.html`, pero esa navegación es la que dispara la búsqueda del nuevo.
  publicado = 'actual';
  const primerIntento = await intentarIr(page, '/index.html');
  expect(primerIntento.ok).toBe(false);

  // Cierra la app (ya no hay clientes del worker viejo) y la vuelve a lanzar desde
  // el ícono. El worker viejo falla en la primera navegación, pero esa misma
  // navegación hace que el navegador busque e instale el nuevo; en cuanto no hay
  // pestañas controladas por el viejo, el nuevo se activa. Se mide cuántos
  // relanzamientos hacen falta, que es lo que vive una persona.
  await page.close();
  let reabierta;
  let relanzamientosFallidos = 0;
  for (; relanzamientosFallidos < 5; relanzamientosFallidos++) {
    reabierta = await context.newPage();
    const intento = await intentarIr(reabierta, '/index.html');
    if (intento.ok) break;
    await reabierta.close();
    await new Promise((resolve) => setTimeout(resolve, 2_500));
  }
  test.info().annotations.push({ type: 'relanzamientos-fallidos', description: String(relanzamientosFallidos) });
  expect(relanzamientosFallidos, 'la app relanzada tiene que abrir en pocos intentos, no quedarse en ERR_FAILED').toBeLessThan(4);
  expect(new URL(reabierta.url()).pathname).toBe('/');
  await tiendaLista(reabierta);
  const estado = await reabierta.evaluate(async (claves) => ({
    caches: await caches.keys(),
    datos: Object.fromEntries(claves.map((k) => [k, localStorage.getItem(k)])),
    version: (await (await fetch('/sw.js', { cache: 'no-store' })).text()).match(/const CACHE_NAME = '([^']+)'/)[1],
  }), Object.keys(datos));
  expect(estado.caches).toContain(CACHE_ACTUAL());
  expect(estado.caches).not.toContain(CACHE_V97);
  expect(estado.datos, 'carrito y sesión intactos').toEqual(datos);
  expect(estado.version).toBe(CACHE_ACTUAL());
});
