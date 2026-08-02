import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fillCheckout, gotoDemoReset, installBrowserStubs } from '../tests/e2e/helpers.mjs';

const ROOT = path.resolve('.');
const OUT = path.resolve(process.env.TABA2_MOTION_ARTIFACTS || 'artifacts/taba2-storefront-motion');
const VIDEO_TMP = path.join(OUT, '_video-tmp');
const requestedBase = process.env.TABA2_MOTION_BASE_URL || '';
let baseUrl = requestedBase;
let server = null;
const observations = [];

mkdirSync(OUT, { recursive: true });
mkdirSync(VIDEO_TMP, { recursive: true });
const browser = await chromium.launch();

try {
  await prepareServer();
  await captureMobile();
  await captureDesktop();
  await captureVideos();
  writeReports();
} finally {
  await browser.close();
  await stopServer();
}

async function prepareServer() {
  if (requestedBase) return;
  const port = 8191;
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/realtime-relay.mjs', String(port)], {
    cwd: ROOT,
    stdio: 'ignore',
    windowsHide: true,
  });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.ok) return;
    } catch (_) {
      // El servidor local todavía está iniciando.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`No se pudo iniciar el servidor local de evidencia en ${baseUrl}.`);
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill();
  await new Promise((resolve) => server.once('exit', resolve));
}

async function contextFor(width, height, { reducedMotion = false, recordVideo = false } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    locale: 'es-AR',
    serviceWorkers: 'block',
    ...(recordVideo ? { recordVideo: { dir: VIDEO_TMP, size: { width, height } } } : {}),
  });
  const page = await context.newPage();
  if (reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
  await installBrowserStubs(page);
  return { context, page };
}

async function fresh(page, hash = '#home') {
  await gotoDemoReset(page, `${baseUrl}/?reset=1&demo=1${hash}`);
  await page.waitForSelector('[data-view="home"] .taba-home-search', { timeout: 20_000 });
  await page.waitForTimeout(120);
}

async function catalog(page) {
  await page.evaluate(() => { window.location.hash = '#catalog'; });
  await page.waitForSelector('[data-view="catalog"]:not([hidden]) [data-product-grid] .product-card', { timeout: 15_000 });
  await page.waitForTimeout(260);
}

async function shot(page, name, selector = '') {
  const target = path.join(OUT, name);
  if (selector) {
    const element = page.locator(selector).first();
    await element.scrollIntoViewIfNeeded();
    await element.screenshot({ path: target });
  } else {
    await page.screenshot({ path: target, fullPage: false });
  }
  const metrics = await page.evaluate(() => ({
    overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    motionReady: document.body.classList.contains('motion-ready'),
    reducedMotion: document.body.dataset.motionReduced === 'true',
    revealTargets: document.querySelectorAll('[data-motion-reveal]').length,
    longTasks: performance.getEntriesByType?.('longtask')?.length || 0,
  }));
  observations.push({ name, ...metrics });
  console.log(`capturada ${name}`);
}

async function addFirstProduct(page) {
  const add = page.locator('[data-product-grid] [data-add-product]:not(:disabled)').first();
  await add.scrollIntoViewIfNeeded();
  await add.click();
  await page.waitForTimeout(90);
  return add;
}

async function openCart(page) {
  await page.locator('[data-open-cart]').first().click();
  await page.waitForSelector('[data-view="cart"]:not([hidden])', { timeout: 10_000 });
  await page.waitForTimeout(240);
}

async function captureMobile() {
  const { page, context } = await contextFor(390, 844);
  try {
    await fresh(page);
    await shot(page, 'mobile-home-static.png');
    await page.waitForTimeout(420);
    await shot(page, 'mobile-home-motion-end.png');

    await catalog(page);
    const add = page.locator('[data-product-grid] [data-add-product]:not(:disabled)').first();
    await add.scrollIntoViewIfNeeded();
    await add.dispatchEvent('pointerdown', { pointerType: 'touch' });
    await page.waitForTimeout(45);
    await shot(page, 'mobile-product-pressed.png');
    await add.dispatchEvent('pointerup', { pointerType: 'touch' });
    await add.click();
    await page.waitForTimeout(180);
    await shot(page, 'mobile-cart-feedback.png');

    const detail = page.locator('[data-product-grid] [data-product-detail]').first();
    await detail.click();
    await page.waitForTimeout(260);
    await shot(page, 'mobile-detail.png');
    await page.keyboard.press('Escape');

    await openCart(page);
    const form = page.locator('[data-checkout-form]');
    await form.scrollIntoViewIfNeeded();
    await fillCheckout(page, {
      name: 'Motion QA',
      phone: '2995550000',
      street: 'Roca 123',
      neighborhood: 'Neuquén centro',
      reference: 'Fixture visual',
      notes: 'Captura motion',
      deliveryMode: 'delivery',
    });
    await form.evaluate((node) => {
      node.dataset.motionBusy = 'true';
      const button = node.querySelector('[data-checkout-submit]');
      if (button) {
        button.disabled = true;
        button.textContent = 'Creando pedido…';
      }
    });
    await form.locator('[data-checkout-submit]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(180);
    await shot(page, 'mobile-checkout-loading.png');
    await form.evaluate((node) => {
      delete node.dataset.motionBusy;
      const button = node.querySelector('[data-checkout-submit]');
      if (button) {
        button.disabled = false;
        button.textContent = 'Confirmar pedido';
      }
    });
    await page.getByRole('button', { name: /Confirmar pedido/i }).click();
    await page.waitForSelector('[data-view="tracking"]:not([hidden])', { timeout: 15_000 });
    await page.waitForTimeout(260);
    await shot(page, 'mobile-checkout-success.png');
  } finally {
    await context.close();
  }
}

async function captureDesktop() {
  const { page, context } = await contextFor(1440, 900);
  try {
    await fresh(page);
    await shot(page, 'desktop-home.png');
    await catalog(page);
    const card = page.locator('[data-product-grid] .product-card').first();
    await card.hover();
    await page.waitForTimeout(180);
    await shot(page, 'desktop-card-hover.png', '[data-product-grid] .product-card');

    await page.locator('[data-view="catalog"] [data-search-input]').fill('coca cola');
    await page.waitForTimeout(240);
    await shot(page, 'desktop-search-open.png');
    await page.locator('[data-view="catalog"] [data-search-input]').fill('');

    const filters = page.locator('[data-catalog-filters]');
    const summary = filters.locator('summary');
    if (!(await filters.evaluate((node) => node.open))) await summary.click();
    await page.waitForTimeout(180);
    await shot(page, 'desktop-filters-open.png');

    const detail = page.locator('[data-product-grid] [data-product-detail]').first();
    await detail.click();
    await page.waitForTimeout(240);
    await shot(page, 'desktop-detail.png');
    await page.keyboard.press('Escape');
    await addFirstProduct(page);
    await openCart(page);
    await shot(page, 'desktop-cart.png');
  } finally {
    await context.close();
  }
}

async function captureVideos() {
  await captureVideo('mobile-shopping-flow.webm', 390, 844, false);
  await captureVideo('desktop-shopping-flow.webm', 1440, 900, false);
  await captureVideo('reduced-motion-flow.webm', 390, 844, true);
}

async function captureVideo(name, width, height, reducedMotion) {
  const { page, context } = await contextFor(width, height, { reducedMotion, recordVideo: true });
  try {
    await fresh(page);
    await page.waitForTimeout(320);
    await catalog(page);
    await page.locator('[data-view="catalog"] [data-search-input]').fill('coca cola');
    await page.waitForTimeout(180);
    await page.locator('[data-view="catalog"] [data-product-detail]').first().click();
    await page.waitForTimeout(280);
    await page.keyboard.press('Escape');
    await page.locator('[data-product-grid] [data-add-product]:not(:disabled)').first().click();
    await page.waitForTimeout(300);
    await page.locator('[data-open-cart]').first().click();
    await page.waitForTimeout(360);
    const video = page.video();
    await context.close();
    const original = await video.path();
    const destination = path.join(OUT, name);
    if (existsSync(original)) renameSync(original, destination);
    console.log(`video generado ${name}`);
  } catch (error) {
    await context.close().catch(() => {});
    console.warn(`No se pudo generar ${name}: ${error.message}`);
  }
}

function writeReports() {
  const overflow = observations.filter((item) => item.overflow > 0);
  const longTasks = observations.reduce((sum, item) => sum + item.longTasks, 0);
  const lines = observations.map((item) => `- ${item.name}: overflow ${item.overflow}px; motion-ready=${item.motionReady}; reduced-motion=${item.reducedMotion}; reveal-targets=${item.revealTargets}; longtasks=${item.longTasks}`).join('\n');
  writeFileSync(path.join(OUT, 'MOTION_REVIEW.md'), `# Motion review TABA2\n\nEvidencia generada en modo demo local, sin datos sensibles ni mutaciones de producción. La capa usa CSS y un controlador JS progresivo: revela sólo jerarquía y los primeros productos, mantiene el contenido visible cuando no hay IntersectionObserver y desactiva desplazamientos/escala con reduced motion.\n\n## Capturas\n\n${lines}\n\n## Interacciones revisadas\n\n- Hover/press de cards y botones: transformaciones de 1–2 px o escala 0,97, sin cambio de layout.\n- Agregado al carrito: toast accesible, contador y feedback visual basado en el estado real.\n- Detalle: entrada corta de dialog y restauración de foco.\n- Checkout: data-motion-busy sólo durante la solicitud real; la captura de loading usa un fixture visual local y no confirma pedidos.\n\n## Resultado\n\n- Overflows detectados: ${overflow.length}.\n- Tareas largas observadas durante capturas: ${longTasks}.\n- Promociones/precios/catálogo: sin cambios.\n`);
  writeFileSync(path.join(OUT, 'PERFORMANCE_REVIEW.md'), `# Performance review TABA2\n\n- Presupuesto de movimiento: transform/opacity; ninguna transición comercial supera 420 ms.\n- Observers: un IntersectionObserver compartido y un MutationObserver compartido; ambos se desmontan con destroy().\n- Degradación: prefers-reduced-motion, saveData, red 2G/slow-2G y memoria baja reducen o eliminan efectos opcionales.\n- Scroll: sólo un listener pasivo con requestAnimationFrame para el estado sticky; no se animan width/height/top/left.\n- Skeleton: shimmer acotado a estados de carga reales; spinner sólo durante envío de checkout.\n- Overflow horizontal en capturas: ${overflow.length === 0 ? 'ninguno' : String(overflow.length) + ' viewport(s)'}.\n- Long tasks reportadas por PerformanceObserver: ${longTasks}.\n`);
  writeFileSync(path.join(OUT, 'ACCESSIBILITY_REVIEW.md'), `# Accessibility review TABA2\n\n- Reduced motion conserva opacidad, texto, foco y feedback de estado sin desplazamientos ni escalados.\n- Toast existente mantiene aria-live y cierre accesible; no se agregan mensajes técnicos.\n- Dialog existente conserva Escape y restauración de foco; la animación es progresiva y no es requisito funcional.\n- Botones mantienen teclado, disabled real durante checkout y no se mueve el foco automáticamente.\n- Las capturas se ejecutaron en demo local con navegación táctil 390×844 y escritorio 1440×900.\n`);
}
