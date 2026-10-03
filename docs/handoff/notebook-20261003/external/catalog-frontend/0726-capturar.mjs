/*
 * Capturas del recorrido de compra, ANTES y DESPUES, con el mismo arnes.
 *
 * Recorre exactamente el camino que pide el encargo:
 *   home -> historias -> categoria -> busqueda -> producto -> agregar -> carrito
 *   -> volver -> recargar
 * en 320/360/390/432 sobre Chromium y WebKit movil.
 *
 * Uso:
 *   node scripts/realtime-relay.mjs 8642 &
 *   TABA_ETIQUETA=antes BASE=http://127.0.0.1:8642 node capturar.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const req = createRequire(path.join(process.env.TABA_REPO, 'package.json'));
const { chromium, webkit } = req('@playwright/test');

const BASE = process.env.BASE || 'http://127.0.0.1:8642';
const ETIQUETA = process.env.TABA_ETIQUETA || 'antes';
const ROOT = path.resolve(process.env.TABA_SALIDA || '.', ETIQUETA);
const WIDTHS = [320, 360, 390, 432];
const HEIGHTS = { 320: 720, 360: 800, 390: 844, 432: 960 };

const notas = [];
const medidas = [];

for (const engine of ['chromium', 'webkit']) {
  const browser = await (engine === 'webkit' ? webkit : chromium).launch();

  for (const w of WIDTHS) {
    const out = path.join(ROOT, engine, String(w));
    mkdirSync(out, { recursive: true });
    const context = await browser.newContext({
      viewport: { width: w, height: HEIGHTS[w] },
      deviceScaleFactor: 2,
      locale: 'es-AR',
      serviceWorkers: 'block',
      hasTouch: true,
      isMobile: engine === 'chromium' ? true : undefined,
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => notas.push(`[${engine} ${w}] pageerror: ${e.message}`));
    page.on('response', (r) => {
      if (r.status() >= 400) notas.push(`[${engine} ${w}] ${r.status()} ${r.url().slice(-70)}`);
    });

    await page.goto(`${BASE}/?reset=1&demo=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-view="home"] .home-best-card', { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(900);

    // 01 · el primer pantallazo: lo unico que decide si alguien se queda
    await tiro(page, out, '01-home-pliegue', false);
    await tiro(page, out, '02-home-completa', true);

    // Cuanto del primer pantallazo es producto comprable
    medidas.push({ engine, w, ...(await medirPliegue(page, w, HEIGHTS[w])) });

    // 03 · historias
    const historias = page.locator('[data-stories-open]:visible').first();
    if (await historias.count()) {
      await historias.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(1200);
      await tiro(page, out, '03-historias', false);
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(500);
    }

    // 04 · categoria desde el chip de la home
    const chip = page.locator('[data-home-category-strip] button').nth(1);
    if (await chip.count()) {
      await chip.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(900);
      await tiro(page, out, '04-categoria', false);
    }

    // 05/06 · catalogo completo, busqueda con y sin resultados
    await hash(page, 'catalog');
    await page.locator('[data-view="catalog"] [data-category-id="all"]').first()
      .click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(600);
    await tiro(page, out, '05-catalogo', false);
    const buscar = page.locator('[data-view="catalog"] [data-search-input]').first();
    await buscar.fill('coca').catch(() => {});
    await page.waitForTimeout(700);
    await tiro(page, out, '06-busqueda', false);
    await buscar.fill('zzzz').catch(() => {});
    await page.waitForTimeout(700);
    await tiro(page, out, '07-busqueda-vacia', false);
    await buscar.fill('').catch(() => {});
    await page.waitForTimeout(500);

    // 08 · ficha de producto
    await page.locator('[data-product-grid] [data-product-detail]').first().click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(900);
    await tiro(page, out, '08-producto', false);
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(500);

    // 09 · agregar: el instante inmediatamente posterior al tap
    const agregar = page.locator('[data-product-grid] [data-add-product]:not([disabled])').first();
    if (await agregar.count()) {
      await agregar.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(280);
      await tiro(page, out, '09-agregado', false);
      await page.waitForTimeout(1600);
      await tiro(page, out, '10-agregado-despues', false);
    }

    // 11 · carrito
    await hash(page, 'cart');
    await page.waitForTimeout(800);
    await tiro(page, out, '11-carrito', true);

    // 12 · volver y recargar: el carrito tiene que sobrevivir
    await hash(page, 'home');
    await page.waitForTimeout(600);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await tiro(page, out, '12-recarga', false);
    const persistido = await page.locator('[data-cart-count]').first().textContent().catch(() => '?');
    notas.push(`[${engine} ${w}] carrito tras recargar: ${String(persistido).trim()}`);

    await context.close();
  }
  await browser.close();
}

writeFileSync(path.join(ROOT, 'notas.txt'), notas.join('\n'));
writeFileSync(path.join(ROOT, 'pliegue.json'), JSON.stringify(medidas, null, 2));
console.log(`capturas en ${ROOT}`);
console.log(`notas: ${notas.length}`);
for (const n of notas.slice(0, 40)) console.log('  ' + n);
console.log('');
console.log('engine    ancho  productos  precios  CTAs  px-1er-precio  px-1a-CTA  alto-doc');
for (const m of medidas) {
  console.log(
    `${m.engine.padEnd(9)} ${String(m.w).padStart(5)}  ${String(m.productosVisibles).padStart(9)}  `
    + `${String(m.preciosVisibles).padStart(7)}  ${String(m.ctasVisibles).padStart(4)}  `
    + `${String(m.pxHastaPrimerPrecio ?? '—').padStart(13)}  ${String(m.pxHastaPrimeraCta ?? '—').padStart(9)}  `
    + `${String(m.altoDocumento).padStart(8)}`,
  );
}

async function medirPliegue(page, w, h) {
  return page.evaluate(({ h }) => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return r.top < h && r.bottom > 0 && r.width > 0 && r.height > 0;
    };
    const cards = [...document.querySelectorAll(
      '.product-card, .home-best-card, .offer-card, .home-promo-card, .combo-card',
    )];
    // El precio no tiene una clase unica en las cuatro tarjetas de la home; se
    // lo busca por lo que ES: el nodo hoja que dice un monto.
    const precios = [...document.querySelectorAll('.home-best-copy span, .offer-price span, .price strong, .home-product-price')]
      .filter((el) => /\$/.test(el.textContent || ''));
    const conCta = [...document.querySelectorAll('[data-add-product]')];
    const primerPrecio = precios[0]?.getBoundingClientRect();
    const primeraCta = conCta[0]?.getBoundingClientRect();
    return {
      productosVisibles: cards.filter(visible).length,
      preciosVisibles: precios.filter(visible).length,
      ctasVisibles: conCta.filter(visible).length,
      pxHastaPrimerPrecio: primerPrecio ? Math.round(primerPrecio.top + window.scrollY) : null,
      pxHastaPrimeraCta: primeraCta ? Math.round(primeraCta.top + window.scrollY) : null,
      altoDocumento: Math.round(document.documentElement.scrollHeight),
    };
  }, { h });
}

// El router lee `#catalog`, sin barra. Con `#/catalog` el hash cambia, el
// oyente no reconoce la vista y devuelve la home: las capturas del catalogo
// terminaban fotografiando el inicio.
async function hash(page, view) {
  await page.evaluate((v) => { window.location.hash = `#${v}`; }, view);
  await page.waitForTimeout(800);
  const activo = await page.evaluate(() => document.body.dataset.activeView);
  if (activo !== view) notas.push(`NAVEGACION FALLIDA: pedi ${view} y quedo en ${activo}`);
}

// Las secciones de la home entran con `is-motion-visible` cuando el
// IntersectionObserver las ve. Una captura de pagina completa sin scrollear
// las deja invisibles y fotografia metros de negro que el cliente nunca ve.
async function revelar(page) {
  await page.evaluate(async () => {
    const paso = Math.round(window.innerHeight * 0.8);
    for (let y = 0; y < document.documentElement.scrollHeight; y += paso) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((r) => setTimeout(r, 400));
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 300));
  });
}

async function tiro(page, out, nombre, completa) {
  if (completa) await revelar(page);
  await page.screenshot({ path: path.join(out, `${nombre}.png`), fullPage: Boolean(completa) });
}
