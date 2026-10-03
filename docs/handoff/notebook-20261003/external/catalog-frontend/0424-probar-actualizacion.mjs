import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:4599/index.html';
const FLAG = '.local/PUBLICACION';
const log = (...a) => console.log(...a);

const ctx = await chromium.launchPersistentContext('.local/perfil-pwa', { headless: true });
const page = await ctx.newPage();

const estado = () => page.evaluate(async () => {
  const r = await navigator.serviceWorker.getRegistration();
  const nombres = await caches.keys();
  const detalle = {};
  for (const n of nombres) detalle[n] = (await (await caches.open(n)).keys()).length;
  const css = await caches.match('./styles.css?v=53').then((x) => !!x);
  const css54 = await caches.match('./styles.css?v=54').then((x) => !!x);
  return {
    controlado: !!navigator.serviceWorker.controller,
    activo: r?.active?.scriptURL ? 'si' : 'no',
    esperando: !!r?.waiting,
    caches: detalle,
    tieneV53: css, tieneV54: css54,
    bannerVisible: !document.querySelector('[data-app-update-banner]')?.hidden,
  };
});

log('--- 1) instalacion inicial (v85) ---');
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 30000 }).catch(() => log('  (sin control aun)'));
await page.waitForTimeout(4000);
log(JSON.stringify(await estado(), null, 1));

log('--- 2) se publica v86 (CACHE_NAME + ?v=54 + css nuevo) ---');
fs.writeFileSync(FLAG, 'v86');
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(8000);
const e2 = await estado();
log(JSON.stringify(e2, null, 1));
log('  BANNER VISIBLE SIN TOCAR NADA:', e2.bannerVisible);

if (e2.bannerVisible) {
  log('--- 3) la persona toca "Actualizar ahora" ---');
  await page.click('[data-app-update-now]');
  await page.waitForTimeout(6000);
  log(JSON.stringify(await estado(), null, 1));
}

log('--- 4) el CSS que ve el documento trae la regla nueva? ---');
log(await page.evaluate(async () => {
  const r = await fetch('./styles.css?v=54').then((x) => x.text()).catch((e) => 'error ' + e.message);
  return { nuevo: r.includes('taba-marca-nueva'), bytes: r.length };
}));

await ctx.close();
