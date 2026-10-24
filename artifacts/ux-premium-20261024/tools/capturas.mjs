/*
 * Capturas BASELINE — polish frontend 2026-10-24.
 *
 * Recorre las superficies del storefront en los dos modos que existen hoy
 * (?demo=1 con combos + historias, y vitrina=neuquen20261024 con fotos reales)
 * a móvil 390 y desktop 1280, tomando:
 *   home · góndola (top + full) · ficha · carrito · checkout · historias ·_combo
 *
 * Sólo captura y mide: no cambia estado (service worker bloqueado, estado en
 * memoria, navegador cerrado al final). Salida: baseline/*.png + baseline.json.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.env.BASE || 'http://127.0.0.1:8231').replace(/\/+$/, '');
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(AQUI, '..', 'capturas', process.env.ETAPA || 'despues');
mkdirSync(OUT, { recursive: true });

const manifest = { esquema: 'polish-baseline-20261024', base: BASE, capturas: [] };
const registrar = (nombre, ok, extra = {}) => {
  manifest.capturas.push({ nombre, ok, ...extra });
  console.log(`${ok ? 'OK  ' : 'FALLO'}  ${nombre}${extra.error ? ` — ${extra.error}` : ''}`);
};

/* Sube en pasos para disparar el lazy-load antes de un fullPage. */
async function scrollFull(page, pausa = 120) {
  const alto = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < alto; y += 700) {
    await page.evaluate((pos) => window.scrollTo(0, pos), y);
    await page.waitForTimeout(70);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(pausa);
}

/* ?reset=1 → la app limpia y RECARGA sin el parámetro: esperar la URL canónica. */
/* Estabilidad de pintura: el shell oscuro lo aplica brand-home.css al final de
   la cascada; las capturas han salido blancas por dispararse antes de que esa
   hoja termine de aplicar. Hoy el estado real es el oscuro: esperar `body` con
   fondo rgb(16,19,23) y el grano de marca cargado evita capturar la cascada a
   media aplicación. */
async function estabilizarPintura(page) {
  await page.waitForFunction(() => {
    const body = getComputedStyle(document.body).backgroundColor;
    const shell = document.querySelector('.app-shell');
    const grano = Boolean(shell && getComputedStyle(shell).backgroundImage.includes('brand/ambient'));
    return body === 'rgb(16, 19, 23)' && grano;
  }, null, { timeout: 15_000 });
  await page.waitForTimeout(250);
}

async function boot(page, params) {
  await page.goto(`${BASE}/?reset=1&${params}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForURL((url) => !url.searchParams.has('reset'), { timeout: 20_000 });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('[data-view="home"]', { timeout: 30_000 });
  await page.waitForTimeout(300);
  await estabilizarPintura(page);
}

async function shot(page, nombre, { fullPage = false } = {}) {
  if (SOLO && !nombre.includes(SOLO)) return true;
  const archivo = path.join(OUT, `${nombre}.png`);
  try {
    await page.waitForTimeout(150);
    await page.screenshot({ path: archivo, fullPage });
    registrar(nombre, true, { archivo: path.basename(archivo) });
    return true;
  } catch (error) {
    registrar(nombre, false, { error: error.message });
    return false;
  }
}

async function irCatalogo(page, { pausa = 150 } = {}) {
  await page.evaluate(() => { window.location.hash = '#catalog'; });
  await page.waitForSelector('[data-view="catalog"] [data-product-grid] article[data-card-product]', { timeout: 30_000 });
  await page.waitForTimeout(350);
  await scrollFull(page, pausa);
  await estabilizarPintura(page);
}

async function abrirFichaPrimera(page) {
  // La ficha abre tocando la tarjeta (área media, no el botón sumar).
  await page.locator('[data-product-grid] article[data-card-product] .thumb').first().click();
  await page.waitForSelector('[data-modal-product-id]', { timeout: 12_000 });
  await page.waitForTimeout(350);
}

async function cerrarFicha(page) {
  const cerrar = page.locator('[data-modal-product-id] [data-close-modal]').first();
  if (await cerrar.count()) await cerrar.click().catch(() => {});
  await page.waitForSelector('[data-modal-product-id]', { state: 'detached', timeout: 8_000 }).catch(() => {});
}

const SOLO = process.env.SOLO || '';
const browser = await chromium.launch();

async function recorrer(params, prefijo, { vitrina = false } = {}) {
  /* ---------- Móvil 390, dsf 2 (tipografía legible en la imagen) ---------- */
  {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'es-AR', serviceWorkers: 'block',
    });
    const page = await context.newPage();
    try {
      await boot(page, params);
      await shot(page, `${prefijo}-m-home-full`, { fullPage: true });
      await irCatalogo(page);
      await shot(page, `${prefijo}-m-gondola-top`);
      await shot(page, `${prefijo}-m-gondola-full`, { fullPage: true });

      // Ficha: el SKU 2 de la lista (foto real en modo vitrina).
      await abrirFichaPrimera(page);
      await shot(page, `${prefijo}-m-ficha`);
      await cerrarFicha(page);

      // Carrito con 2 líneas y checkout.
      const botones = page.locator('[data-product-grid] [data-add-product]');
      for (let i = 0; i < 2; i += 1) await botones.nth(i).click().catch(() => {});
      await page.waitForFunction(
        () => Number((document.querySelector('[data-cart-count]')?.textContent || '0').replace(/\D/g, '')) >= 1,
        null, { timeout: 10_000 },
      );
      await page.evaluate(() => { window.location.hash = '#cart'; });
      await page.waitForSelector('[data-view="cart"]', { timeout: 10_000 });
      await page.waitForTimeout(300);
      await shot(page, `${prefijo}-m-carrito`);
      await page.locator('[data-checkout-form]').scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      await shot(page, `${prefijo}-m-checkout`);

      // Historias (sólo deben existir en el demo aprobado).
      if (vitrina === false) {
        await page.evaluate(() => { window.location.hash = '#home'; });
        await page.waitForTimeout(400);
        const circulo = page.locator('[data-stories-open]').first();
        if (await circulo.count()) {
          await circulo.click();
          await page.waitForTimeout(900);
          await shot(page, `${prefijo}-m-historia`);
        } else {
          registrar(`${prefijo}-m-historia`, false, { error: 'sin [data-stories-open] en home' });
        }
      }
    } catch (error) {
      registrar(`${prefijo}-m-flujo`, false, { error: error.message });
    }
    await context.close();
  }

  /* ---------- Desktop 1280, dsf 1.5 ---------- */
  {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5, locale: 'es-AR', serviceWorkers: 'block',
    });
    const page = await context.newPage();
    try {
      await boot(page, params);
      await shot(page, `${prefijo}-d-home-full`, { fullPage: true });
      await irCatalogo(page);
      await shot(page, `${prefijo}-d-gondola-top`);
      await shot(page, `${prefijo}-d-gondola-full`, { fullPage: true });

      await abrirFichaPrimera(page);
      await shot(page, `${prefijo}-d-ficha`);
      await cerrarFicha(page);

      const botones = page.locator('[data-product-grid] [data-add-product]');
      for (let i = 0; i < 2; i += 1) await botones.nth(i).click().catch(() => {});
      await page.waitForFunction(
        () => Number((document.querySelector('[data-cart-count]')?.textContent || '0').replace(/\D/g, '')) >= 1,
        null, { timeout: 10_000 },
      );
      await page.evaluate(() => { window.location.hash = '#cart'; });
      await page.waitForSelector('[data-view="cart"]', { timeout: 10_000 });
      await page.waitForTimeout(300);
      await shot(page, `${prefijo}-d-carrito`);
      await page.locator('[data-checkout-form]').scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      await shot(page, `${prefijo}-d-checkout`);

      if (vitrina === false) {
        await page.evaluate(() => { window.location.hash = '#home'; });
        await page.waitForTimeout(400);
        const circulo = page.locator('[data-stories-open]').first();
        if (await circulo.count()) {
          await circulo.click();
          await page.waitForTimeout(900);
          await shot(page, `${prefijo}-d-historia`);
        } else {
          registrar(`${prefijo}-d-historia`, false, { error: 'sin [data-stories-open] en home' });
        }
      }
    } catch (error) {
      registrar(`${prefijo}-d-flujo`, false, { error: error.message });
    }
    await context.close();
  }
}

/* Modo A: demo aprobado (combos + historias + buscador de demo). */
await recorrer('demo=1', 'demo', { vitrina: false });
/* Modo B: vitrina Neuquén con fotos reales (52 SKU). */
await recorrer('demo=1&vitrina=neuquen20261024', 'vitrina', { vitrina: true });

await browser.close();
writeFileSync(path.join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`listo: ${manifest.capturas.filter((c) => c.ok).length}/${manifest.capturas.length} capturas en ${OUT}`);
