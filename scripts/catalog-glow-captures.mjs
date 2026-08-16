/**
 * Capturas y medidas del brillo de la góndola.
 *   node scripts/catalog-glow-captures.mjs before|after
 * Levanta el servidor estático del repo. No toca red externa ni staging.
 *
 * POR QUÉ ADEMÁS DE LAS CAPTURAS SE MIDEN PÍXELES.
 *
 * El alfa declarado no dice cuánto rojo se VE. Entre el número y la pantalla
 * están el desenfoque, el `spread`, la sombra negra que se pinta encima y —esto
 * costó una tarde— el recorte del contenedor: el rail de Destacados tiene
 * `overflow-x: auto`, así que recorta en su caja de relleno y con 4px de
 * `padding` dejaba el efecto en una tira invisible mientras el estilo computado
 * seguía diciendo que estaba encendido. Un brillo puede estar «bien» en el
 * `box-shadow` y no existir para nadie.
 *
 * La medida que sí decide es la RESTA: la misma pantalla con las capas rojas y
 * sin ellas. La diferencia por canal es el brillo, en unidades de pantalla
 * (0…255), y de ahí sale el perfil por distancia al borde: cuánto asoma abajo,
 * cuánto al costado y cuánto arriba. Eso es lo que distingue «profundidad» de
 * «aro rojo», y es lo que hay que mirar antes de tocar un alfa.
 */
import { chromium, devices, webkit } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const SELECTOR_GLOW = 'body:not([data-active-view="business"]):not([data-active-view="rider"]) .app-view [data-glow-shelf] :is(.product-card, .home-best-card)';
const APAGADO = `${SELECTOR_GLOW} { box-shadow: var(--shadow-shelf-flat), inset 0 0 0 1px var(--shelf-line) !important; }`;

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
      home.push(await medir(page, y, '.home-best-card:not(.out-of-stock)', opciones));
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
      catalogo.push(await medir(page, y, '[data-product-grid] .product-card:not(.out-of-stock)', opciones));
      if (y === 0) await page.screenshot({ path: path.join(OUT, `${nombre}-catalogo-scroll-0.png`) });
    }

    medidas[nombre] = { home, catalogo, overflow: await overflow(page) };
    await context.close();
  } finally { await browser.close(); }
}

async function medir(page, y, selector, opciones) {
  const declarado = await page.evaluate(({ scrollY, sel }) => {
    const cards = [...document.querySelectorAll(sel)];
    const dentro = cards.filter((c) => {
      const r = c.getBoundingClientRect();
      return r.top > 34 && r.bottom < window.innerHeight - 34 && r.left >= -2 && r.width > 40;
    });
    const card = dentro[0] || cards[0];
    const shelf = card?.closest('[data-glow-shelf]');
    const cs = card ? getComputedStyle(card) : null;
    const alfas = cs
      ? (cs.boxShadow.match(/rgba\(208,\s*0,\s*13,\s*([0-9.]+)\)/g) || []).map((s2) => s2.match(/([0-9.]+)\)$/)[1])
      : [];
    const r = card && dentro.length ? card.getBoundingClientRect() : null;
    return {
      scrollY,
      hayTarjeta: Boolean(card),
      glow: shelf?.style.getPropertyValue('--card-glow') || '(sin fijar)',
      alfas,
      caja: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null,
    };
  }, { scrollY: y, sel: selector });
  return { ...declarado, visto: declarado.caja ? await restar(page, declarado.caja, opciones) : null };
}

/*
 * La resta: dos capturas idénticas salvo por las capas rojas. Devuelve el
 * perfil de ΔR (rojo, 0…255) por distancia al borde de la tarjeta. Un efecto
 * sano cae rápido HACIA ABAJO, poco al costado y nada arriba; si los tres se
 * parecen, lo que hay es un aro alrededor de la tarjeta.
 */
async function restar(page, caja, opciones) {
  const dsf = opciones.deviceScaleFactor || (opciones.isMobile ? 2 : 1) || 1;
  const con = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  const apagado = await page.addStyleTag({ content: APAGADO });
  await page.waitForTimeout(60);
  const sin = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  await apagado.evaluate((n) => n.remove());
  await page.waitForTimeout(40);

  const a = await sharp(con).raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(sin).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = a.info;
  const dr = (cssX, cssY) => {
    const ix = Math.round(cssX * dsf);
    const iy = Math.round(cssY * dsf);
    if (ix < 0 || iy < 0 || ix >= width || iy >= height) return null;
    const i = (iy * width + ix) * channels;
    return a.data[i] - b.data[i];
  };
  const promedio = (muestras) => {
    const v = muestras.filter((n) => n !== null);
    return v.length ? +(v.reduce((s2, n) => s2 + n, 0) / v.length).toFixed(1) : null;
  };
  const cx = caja.x + caja.w / 2;
  const abajoY = caja.y + caja.h;
  const franja = (cssY) => promedio(
    Array.from({ length: 61 }, (_, k) => dr(cx - caja.w * 0.35 + (k * caja.w * 0.7) / 60, cssY)),
  );
  const columna = (cssX) => promedio(
    Array.from({ length: 31 }, (_, k) => dr(cssX, caja.y + caja.h * 0.55 + (k * caja.h * 0.45) / 30)),
  );
  return {
    abajo: Object.fromEntries([1, 3, 6, 10, 16].map((d) => [`${d}px`, franja(abajoY + d)])),
    arriba: Object.fromEntries([1, 3, 6].map((d) => [`${d}px`, franja(caja.y - d)])),
    costado: Object.fromEntries([1, 3, 6, 10].map((d) => [`${d}px`, columna(caja.x - d)])),
  };
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
