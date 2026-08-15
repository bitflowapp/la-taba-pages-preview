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
    await page.locator('[data-nav-view="catalog"] >> visible=true').first().click();
    await page.locator('body[data-active-view="catalog"]').waitFor({ state: 'attached' });
    await asentar(page);

    const puntos = [];
    for (const y of [0, 300, 600, 900, 1300, 2000]) {
      await page.evaluate((v) => window.scrollTo(0, v), y);
      await asentar(page);
      puntos.push(await medir(page, y));
      if ([0, 600, 1300].includes(y)) {
        await page.screenshot({ path: path.join(OUT, `${nombre}-scroll-${y}.png`) });
      }
    }
    medidas[nombre] = { puntos, overflow: await overflow(page) };
    await context.close();
  } finally { await browser.close(); }
}

function medir(page, y) {
  return page.evaluate((scrollY) => {
    const host = document.querySelector('[data-view="catalog"]');
    const card = document.querySelector('[data-product-grid] .product-card');
    const cs = card ? getComputedStyle(card) : null;
    const capasRojas = cs ? (cs.boxShadow.match(/rgba?\(2\d\d,\s*0,\s*1?\d/g) || []).length : -1;
    const alfas = cs ? (cs.boxShadow.match(/rgba\(208,\s*0,\s*13,\s*([0-9.]+)\)/g) || []).map((s) => s.match(/([0-9.]+)\)$/)[1]) : [];
    return {
      scrollY,
      glow: host?.style.getPropertyValue('--card-glow') || '(sin fijar)',
      capasRojas,
      alfas,
      boxShadow: cs ? cs.boxShadow.slice(0, 210) : null,
    };
  }, y);
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
