// Red caída en el Moto G15 físico (emulada SÓLO en esta pestaña por DevTools; no se toca la
// conectividad del teléfono): recarga sin conexión desde el Service Worker, compra de prueba en
// demo y estado de las cachés. Uso: node moto-offline.mjs <etapa>
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { connect, cdpDe, sleep, tap, screencap, BASE, personaTocando } from './moto.mjs';

const etapa = process.argv[2] || 'despues';
const out = path.resolve('artifacts/catalog-transformation-20261024', 'rendimiento', etapa);
const shots = path.resolve('artifacts/catalog-transformation-20261024/capturas', etapa, 'moto-real');
mkdirSync(out, { recursive: true });
if (personaTocando(3)) { console.error('Hay una persona tocando el Moto.'); process.exit(3); }

const { browser, page } = await connect();
const cdp = await cdpDe(page);
await cdp.send('Network.enable');
const informe = { etapa, fecha: new Date().toISOString(), pasos: [] };
const paso = async (nombre, fn) => { try { const r = await fn(); informe.pasos.push({ nombre, ok: true, ...r }); console.log('ok   ', nombre, JSON.stringify(r || {})); } catch (e) { informe.pasos.push({ nombre, ok: false, error: String(e.message).split('\n')[0] }); console.log('FALLA', nombre, String(e.message).split('\n')[0]); } };
async function despejar() { for (let i = 0; i < 3; i += 1) { if (!(await page.evaluate(() => !!document.querySelector('[data-install-sheet][open]')))) return; await tap(page, page.locator('[data-install-sheet] [data-install-decline]:visible').first()); await sleep(500); } }

await paso('carga en línea y precaché completo', async () => {
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); indexedDB.deleteDatabase('taba-sandbox'); });
  await page.goto(`${BASE}/?demo=1&vitrina=neuquen20261024&n=${Date.now()}`, { waitUntil: 'load' });
  await page.waitForSelector('[data-view="home"] .home-best-card');
  let cache = null;
  for (let i = 0; i < 40; i += 1) {
    cache = await page.evaluate(async () => {
      const claves = await caches.keys();
      const actual = claves.filter((k) => k.startsWith('la-taba-runtime-'));
      const sizes = {};
      for (const k of actual) sizes[k] = (await (await caches.open(k)).keys()).length;
      const reg = await navigator.serviceWorker.getRegistration();
      return { sizes, controlador: !!navigator.serviceWorker.controller, activo: reg?.active?.state || null, esperando: !!reg?.waiting };
    });
    if (Object.values(cache.sizes).some((n) => n >= 200) && cache.controlador) break;
    await sleep(1000);
  }
  return cache;
});

await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
await paso('recarga SIN conexión: la tienda arranca desde el worker', async () => {
  await page.reload({ waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('[data-view="home"] .home-best-card', { timeout: 30000 });
  await sleep(1500);
  screencap(path.join(shots, 'offline-home.png'));
  return { tarjetas: await page.locator('[data-view="home"] .home-best-card').count(), titulo: await page.title() };
});
await paso('catálogo y lista funcionan sin conexión', async () => {
  await despejar();
  await page.evaluate(() => { window.location.hash = '#catalog'; });
  await page.waitForSelector('[data-view="catalog"] [data-product-grid] article[data-card-product]', { timeout: 20000 });
  await tap(page, '[data-view="catalog"] [data-catalog-layout-toggle]');
  await sleep(700);
  const imgs = await page.evaluate(() => [...document.querySelectorAll('[data-view="catalog"] article[data-card-product] img.thumb-img')].slice(0, 6).filter((i) => i.complete && i.naturalWidth > 0).length);
  return { productos: await page.locator('[data-view="catalog"] article[data-card-product]').count(), imagenesCargadas: imgs };
});
await paso('agregar, carrito y confirmar pedido de prueba sin conexión', async () => {
  await despejar();
  await tap(page, page.locator('[data-view="catalog"] article[data-card-product] [data-add-product]').nth(0));
  await tap(page, page.locator('[data-view="catalog"] article[data-card-product] [data-add-product]').nth(1));
  await tap(page, '[data-floating-cart]');
  await page.waitForSelector('[data-view="cart"]', { state: 'visible' });
  await sleep(600);
  const total = await page.locator('[data-view="cart"] .checkout-form .button-row').getAttribute('data-checkout-total');
  await tap(page, '[data-view="cart"] [data-checkout-submit]');
  await sleep(1500);
  screencap(path.join(shots, 'offline-pedido.png'));
  const toast = await page.locator('.toast:visible').first().textContent().catch(() => null);
  return { total, toast };
});
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await paso('cachés: sólo la versión vigente', async () => page.evaluate(async () => ({ claves: (await caches.keys()).filter((k) => k.startsWith('la-taba-runtime-')) })));
writeFileSync(path.join(out, 'moto-offline.json'), JSON.stringify(informe, null, 2));
await browser.close();
