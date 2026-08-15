/**
 * Capturas y medidas del brillo de la góndola.
 *   node scripts/catalog-glow-captures.mjs before|after
 * Levanta el servidor estático del repo. No toca red externa ni staging.
 */
import { chromium, devices, webkit } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const fase = (process.argv[2] || 'after').replace(/[^a-z]/g, '') || 'after';
const PORT = Number(process.env.TABA_GLOW_PORT || 8262);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.resolve('artifacts/catalog-glow', fase);
mkdirSync(OUT, { recursive: true });
const medidas = {};
let server = null;

try {
  await levantar();
  await recorrido('chromium-390', chromium, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await recorrido('webkit-iphone', webkit, { ...devices['iPhone 13'] });
  await recorrido('chromium-1280', chromium, { viewport: { width: 1280, height: 900 } });
} finally { await parar(); }

writeFileSync(path.join(OUT, 'MEDIDAS.json'), `${JSON.stringify(medidas, null, 2)}\n`);
console.log(`Capturas en ${OUT}`);

async function recorrido(nombre, motor, opciones) {
  const browser = await motor.launch();
  try {
    const context = await browser.newContext({ ...opciones, serviceWorkers: 'block' });
    const page = await context.newPage();
    await abrir(page);

    // HOME primero: es la pantalla donde se detecto que el rail "Destacados"
    // quedaba sin brillo, asi que es la que manda en la comparacion.
    const home = [];
    for (const y of [0, 400, 900, 1600]) {
      await page.evaluate((v) => window.scrollTo(0, v), y);
      await asentar(page);
      home.push(await medir(page, y, '.home-best-card:not(.out-of-stock)'));
      if ([0, 900].includes(y)) await page.screenshot({ path: path.join(OUT, `${nombre}-home-scroll-${y}.png`) });
    }
    // Recorte del rail, que es donde se mira el efecto de cerca.
    await page.evaluate(() => window.scrollTo(0, 0));
    await asentar(page);
    const rail = await page.locator('.home-best-card').first().boundingBox();
    if (rail) {
      await page.screenshot({
        path: path.join(OUT, `${nombre}-home-destacados.png`),
        clip: {
          x: Math.max(0, rail.x - 12),
          y: Math.max(0, rail.y - 34),
          width: Math.min(opciones.viewport?.width || 390, rail.width * 2 + 40),
          height: Math.min(240, rail.height + 60),
        },
      });
    }

    await page.locator('[data-nav-view="catalog"] >> visible=true').first().click();
    await page.locator('body[data-active-view="catalog"]').waitFor({ state: 'attached' });
    await asentar(page);
    const catalogo = [];
    for (const y of [0, 600, 1300]) {
      await page.evaluate((v) => window.scrollTo(0, v), y);
      await asentar(page);
      catalogo.push(await medir(page, y, '[data-product-grid] .product-card:not(.out-of-stock)'));
      if (y === 0) await page.screenshot({ path: path.join(OUT, `${nombre}-catalogo-scroll-0.png`) });
    }

    medidas[nombre] = { home, catalogo, overflow: await overflow(page) };
    await context.close();
  } finally { await browser.close(); }
}

function medir(page, y, selector) {
  return page.evaluate(({ scrollY, sel }) => {
    const card = document.querySelector(sel);
    const shelf = card?.closest('[data-glow-shelf]');
    const cs = card ? getComputedStyle(card) : null;
    const alfas = cs
      ? (cs.boxShadow.match(/rgba\(208,\s*0,\s*13,\s*([0-9.]+)\)/g) || []).map((s2) => s2.match(/([0-9.]+)\)$/)[1])
      : [];
    return {
      scrollY,
      hayTarjeta: Boolean(card),
      glow: shelf?.style.getPropertyValue('--card-glow') || '(sin fijar)',
      alfas,
    };
  }, { scrollY: y, sel: selector });
}

function overflow(page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    desborda: document.documentElement.scrollWidth > window.innerWidth,
  }));
}

async function abrir(page) {
  await page.addInitScript(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(`${BASE}/?reset=1&demo=1`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForURL((u) => !u.searchParams.has('reset'), { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForLoadState('load');
  await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 30_000 });
  await asentar(page);
}

async function asentar(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.race([
      Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
      new Promise((r) => setTimeout(r, 400)),
    ]);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  await page.waitForTimeout(220);
}

async function levantar() {
  server = spawn(process.execPath, ['scripts/realtime-relay.mjs', String(PORT)], { cwd: path.resolve('.'), stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 40; i += 1) {
    try { if ((await fetch(`${BASE}/`)).ok) return; } catch (_) { /* todavía no */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('El servidor estático no respondió.');
}
async function parar() { if (server) { server.kill(); server = null; } }
