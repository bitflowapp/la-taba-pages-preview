// Actualización del PWA en el Moto G15 físico, desde la versión que YA tiene instalada hasta la que sirve el
// relay: detección del worker nuevo, aviso «Hay una actualización disponible», activación por toque,
// borrado de la caché vieja, precaché completo y recarga sin conexión (red emulada sólo en esta pestaña).
//   TABA_BASE=http://localhost:8261 node moto-actualizacion.mjs <etapa>
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { connect, cdpDe, sleep, tap, BASE, personaTocando, chromeAlFrente } from './moto.mjs';

const etapa = process.argv[2] || 'despues';
const out = path.resolve('artifacts/catalog-transformation-20261024', 'rendimiento', etapa);
mkdirSync(out, { recursive: true });
if (!chromeAlFrente()) { console.error('Chrome no está al frente: no se toca el teléfono personal.'); process.exit(4); }
if (personaTocando(3)) { console.error('Hay una persona tocando el Moto.'); process.exit(3); }

const { browser, page } = await connect();
const cdp = await cdpDe(page);
await cdp.send('Network.enable');
const informe = { etapa, fecha: new Date().toISOString(), pasos: [] };
const paso = async (nombre, fn) => {
  try { const r = await fn(); informe.pasos.push({ nombre, ok: true, ...r }); console.log('ok   ', nombre, JSON.stringify(r || {})); return r; }
  catch (e) { informe.pasos.push({ nombre, ok: false, error: String(e.message).split('\n')[0] }); console.log('FALLA', nombre, String(e.message).split('\n')[0]); return null; }
};
const estado = () => page.evaluate(async () => {
  const claves = (await caches.keys()).filter((k) => k.startsWith('la-taba-runtime-'));
  const tam = {};
  for (const k of claves) tam[k] = (await (await caches.open(k)).keys()).length;
  const reg = await navigator.serviceWorker.getRegistration();
  return { cachés: tam, activo: reg?.active?.state || null, esperando: !!reg?.waiting, instalando: !!reg?.installing, controlada: !!navigator.serviceWorker.controller };
});
async function despejar() {
  for (let i = 0; i < 3; i += 1) {
    if (!(await page.evaluate(() => !!document.querySelector('[data-install-sheet][open]')))) return;
    await tap(page, page.locator('[data-install-sheet] [data-install-decline]:visible').first());
    await sleep(500);
  }
}

// El punto de partida es el que ya tiene el teléfono: NO se limpia nada.
await paso('estado inicial (lo que el teléfono ya tiene instalado)', async () => {
  await page.goto(`${BASE}/?demo=1&vitrina=neuquen20261024&n=${Date.now()}`, { waitUntil: 'load' });
  await page.waitForSelector('[data-view="home"] .home-best-card', { timeout: 30000 });
  await sleep(1500);
  return estado();
});

await paso('el worker nuevo se detecta y queda esperando', async () => {
  await page.evaluate(async () => { const reg = await navigator.serviceWorker.getRegistration(); await reg.update(); });
  let e;
  for (let i = 0; i < 60; i += 1) { e = await estado(); if (e.esperando) break; await sleep(1000); }
  return { ...e, avisoVisible: await page.locator('[data-app-update-banner]:not([hidden])').count() };
});

await paso('el aviso «Hay una actualización disponible» y la activación por toque', async () => {
  await despejar();
  const antes = await estado();
  await tap(page, '[data-app-update-now]');
  // La página se recarga sola cuando el worker nuevo toma el control.
  let despues;
  for (let i = 0; i < 60; i += 1) {
    await sleep(1000);
    try { despues = await estado(); } catch { continue; }
    if (despues.controlada && !despues.esperando && Object.keys(despues.cachés).length === 1) break;
  }
  return { antes: antes.cachés, despues };
});

await paso('sólo queda la caché vigente y completa', async () => {
  const e = await estado();
  const claves = Object.keys(e.cachés);
  if (claves.length !== 1) throw new Error(`quedaron ${claves.length} cachés: ${claves.join(', ')}`);
  return { vigente: claves[0], entradas: e.cachés[claves[0]] };
});

await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
await paso('recarga SIN conexión desde la versión nueva', async () => {
  await page.reload({ waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('[data-view="home"] .home-best-card', { timeout: 30000 });
  await despejar();
  await page.evaluate(() => { window.location.hash = '#catalog'; });
  await page.waitForSelector('[data-view="catalog"] [data-product-grid] article[data-card-product]', { timeout: 20000 });
  return { tarjetas: await page.locator('[data-view="catalog"] [data-product-grid] article[data-card-product]').count() };
});
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

writeFileSync(path.join(out, 'moto-actualizacion.json'), JSON.stringify(informe, null, 2));
await browser.close();
