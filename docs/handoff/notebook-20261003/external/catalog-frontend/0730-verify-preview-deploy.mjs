/**
 * Verificación de un despliegue de preview, desde el servidor publicado.
 *
 * No mira el repo: abre la URL como la abriría un iPhone, con el service worker
 * HABILITADO (que es justamente una de las cosas a comprobar), y responde las
 * preguntas del checklist: ¿carga el CSS nuevo?, ¿hay 404?, ¿abre el catálogo?,
 * ¿siguen andando filtros, orden y carrito?, ¿qué caché deja el worker?
 *
 * Uso: node scripts/verify-preview-deploy.mjs <url> [--out <dir>]
 */
import { webkit } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const BASE = (args[0] || '').replace(/\/$/, '');
if (!BASE.startsWith('http')) {
  console.error('Falta la URL. Uso: node scripts/verify-preview-deploy.mjs https://…');
  process.exit(2);
}
const outIndex = args.indexOf('--out');
const OUT = path.resolve(outIndex === -1 ? 'artifacts/taba2-catalog-visual-polish/preview-qa' : args[outIndex + 1]);
mkdirSync(OUT, { recursive: true });

const fallos = [];
const notas = [];
const red = { fallidas: [], noOk: [] };

const browser = await webkit.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'es-AR',
  // A propósito NO se bloquean: el worker es parte de lo que hay que verificar.
  serviceWorkers: 'allow',
});
const page = await context.newPage();

const consola = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consola.push(msg.text());
});
page.on('pageerror', (error) => consola.push(`pageerror: ${error.message}`));
page.on('requestfailed', (request) => {
  red.fallidas.push(`${request.method()} ${request.url()} — ${request.failure()?.errorText}`);
});
page.on('response', (response) => {
  if (response.status() >= 400) red.noOk.push(`${response.status()} ${response.url()}`);
});

try {
  await paso('la home abre y pinta la marca', async () => {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForSelector('[data-view="home"] .taba-home-search', { timeout: 30_000 });
    await page.waitForTimeout(1500);
    const marca = await page.locator('.brand-word').first().innerText();
    notas.push(`marca en la barra: "${marca.trim()}"`);
  });

  await paso('el CSS servido es el del pulido (tokens nuevos aplicados de verdad)', async () => {
    const medido = await page.evaluate(() => {
      const raiz = getComputedStyle(document.documentElement);
      const buscador = document.querySelector('.taba-home-search');
      return {
        controlH: raiz.getPropertyValue('--control-h').trim(),
        radiusControl: raiz.getPropertyValue('--radius-control').trim(),
        cardPad: raiz.getPropertyValue('--card-pad').trim(),
        altoBuscador: buscador ? Math.round(buscador.getBoundingClientRect().height) : null,
      };
    });
    notas.push(`tokens vivos: --control-h=${medido.controlH} --radius-control=${medido.radiusControl} --card-pad=${medido.cardPad}`);
    notas.push(`alto real del buscador: ${medido.altoBuscador}px`);
    if (medido.controlH !== '48px') throw new Error(`--control-h llegó como "${medido.controlH}", se esperaba 48px (¿CSS viejo cacheado?)`);
    if (medido.altoBuscador !== 48) throw new Error(`el buscador mide ${medido.altoBuscador}px, no 48`);
  });

  await paso('el catálogo abre con producto real del backend', async () => {
    await page.evaluate(() => { window.location.hash = '#catalog'; });
    await page.waitForSelector('[data-view="catalog"]:not([hidden]) [data-product-grid] .product-card', { timeout: 30_000 });
    await page.waitForTimeout(800);
    const n = await page.locator('[data-product-grid] .product-card').count();
    notas.push(`tarjetas de producto en el catálogo: ${n}`);
    if (n === 0) throw new Error('el catálogo abrió vacío (¿runtime-config sin backend?)');
  });

  await paso('el "Agregar" es la píldora nueva y el precio la tipografía nueva', async () => {
    const forma = await page.evaluate(() => {
      const cta = document.querySelector('[data-product-grid] .add-button');
      const precio = document.querySelector('[data-product-grid] .price strong, [data-product-grid] .price-amounts strong');
      const plato = document.querySelector('[data-product-grid] .product-media');
      const titulo = document.querySelector('[data-product-grid] .product-body h3');
      const r = (n) => (n ? Math.round(n.getBoundingClientRect().left) : null);
      return {
        radioCta: cta ? getComputedStyle(cta).borderRadius.split(' ')[0] : null,
        precioPx: precio ? getComputedStyle(precio).fontSize : null,
        bordePlato: r(plato),
        bordeTitulo: r(titulo),
      };
    });
    notas.push(`radio del "Agregar": ${forma.radioCta} · precio: ${forma.precioPx}`);
    notas.push(`borde izq. plato ${forma.bordePlato} vs título ${forma.bordeTitulo}`);
    if (forma.radioCta === '10px') throw new Error('el "Agregar" sigue siendo el rectángulo viejo: CSS anterior');
    if (forma.bordePlato !== forma.bordeTitulo) throw new Error('plato y título no comparten borde izquierdo');
  });

  await paso('los filtros abren y aplican', async () => {
    const antes = await page.locator('[data-product-grid] .product-card').count();
    await page.locator('[data-catalog-filters] summary').first().click();
    await page.waitForTimeout(500);
    const sheetVisible = await page.locator('.catalog-filters-sheet').isVisible();
    if (!sheetVisible) throw new Error('el panel de filtros no se abrió');
    await page.locator('[data-catalog-filter="alcohol"]').selectOption({ index: 1 }).catch(() => {});
    await page.waitForTimeout(700);
    const despues = await page.locator('[data-product-grid] .product-card').count();
    notas.push(`filtro de alcohol: ${antes} -> ${despues} tarjetas`);
    await page.locator('[data-catalog-filter="alcohol"]').selectOption({ index: 0 }).catch(() => {});
    await page.waitForTimeout(400);
  });

  /* El panel es un <details> modal: mientras esté abierto, su sheet está por
     encima de la grilla y se queda con el toque. Cerrarlo tocando "Filtros" es
     el gesto real —y de paso comprueba que el disparador sigue alcanzable por
     encima de su propio panel, que es lo que esta rama corrigió. */
  await paso('tocar "Filtros" cierra el panel y devuelve el toque a la grilla', async () => {
    await page.locator('[data-catalog-filters] summary').first().click();
    await page.waitForTimeout(600);
    const abierto = await page.locator('[data-catalog-filters]').evaluate((node) => node.open);
    if (abierto) throw new Error('el panel siguió abierto tras tocar "Filtros"');
    const sobreLaGrilla = await page.evaluate(() => {
      const cta = document.querySelector('[data-product-grid] [data-add-product]:not([disabled])');
      if (!cta) return 'sin CTA';
      const r = cta.getBoundingClientRect();
      const encima = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return cta.contains(encima) || encima === cta ? 'el propio botón' : (encima?.tagName || '?');
    });
    notas.push(`quién recibe el toque sobre "Agregar": ${sobreLaGrilla}`);
    if (sobreLaGrilla !== 'el propio botón') throw new Error(`algo tapa el "Agregar": ${sobreLaGrilla}`);
  });

  await paso('el orden cambia la grilla', async () => {
    const primero = async () => (await page.locator('[data-product-grid] .product-body h3').first().innerText()).trim();
    const a = await primero();
    await page.locator('[data-sort-select]').selectOption('price_asc');
    await page.waitForTimeout(800);
    const b = await primero();
    notas.push(`orden recomendados="${a}" -> menor precio="${b}"`);
    await page.locator('[data-sort-select]').selectOption('recommended');
    await page.waitForTimeout(600);
  });

  await paso('el carrito suma', async () => {
    const contador = async () => (await page.locator('[data-cart-count]').first().innerText()).trim();
    const antes = await contador();
    await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
    await page.waitForTimeout(900);
    const despues = await contador();
    notas.push(`contador del carrito: ${antes} -> ${despues}`);
    if (antes === despues) throw new Error('el carrito no cambió al agregar');
  });

  await paso('Perfil abre', async () => {
    await page.evaluate(() => { window.location.hash = '#profile'; });
    await page.waitForTimeout(1200);
    const visible = await page.locator('[data-view="profile"]').isVisible();
    if (!visible) throw new Error('Perfil no abrió');
    const pastilla = await page.evaluate(() => {
      const b = document.querySelector('[data-view="profile"] .text-button');
      if (!b) return null;
      const s = getComputedStyle(b);
      return { radio: s.borderRadius.split(' ')[0], subrayado: s.textDecorationLine };
    });
    notas.push(`control de Perfil: radio ${pastilla?.radio}, decoración "${pastilla?.subrayado}"`);
  });

  await paso('el service worker no deja una versión anterior pegada', async () => {
    const estado = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return { soportado: false };
      const reg = await navigator.serviceWorker.getRegistration();
      const cachés = 'caches' in window ? await caches.keys() : [];
      return {
        soportado: true,
        registrado: Boolean(reg),
        enEspera: Boolean(reg?.waiting),
        controlando: Boolean(navigator.serviceWorker.controller),
        cachés,
      };
    });
    notas.push(`worker: registrado=${estado.registrado} controlando=${estado.controlando} enEspera=${estado.enEspera}`);
    notas.push(`cachés en este origen: ${JSON.stringify(estado.cachés)}`);
    if (estado.enEspera) throw new Error('quedó un worker EN ESPERA: hay una versión anterior pegada');
    if (estado.cachés && estado.cachés.length > 1) {
      throw new Error(`hay más de una caché en el origen: ${estado.cachés.join(', ')}`);
    }
  });

  await paso('recarga en caliente: con el worker ya activo la tienda vuelve entera', async () => {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForSelector('[data-view="home"] .taba-home-search', { timeout: 30_000 });
    await page.waitForTimeout(1200);
    const controlH = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--control-h').trim());
    if (controlH !== '48px') throw new Error(`tras la recarga el CSS llegó viejo (--control-h="${controlH}")`);
    await page.evaluate(() => { window.location.hash = '#catalog'; });
    await page.waitForSelector('[data-view="catalog"]:not([hidden]) [data-product-grid] .product-card', { timeout: 30_000 });
    const n = await page.locator('[data-product-grid] .product-card').count();
    notas.push(`tras recarga con worker activo: ${n} tarjetas`);
    if (n === 0) throw new Error('tras la recarga el catálogo quedó vacío');
    await page.screenshot({ path: path.join(OUT, 'preview-catalogo.png') });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(() => { window.location.hash = '#home'; });
    await page.waitForTimeout(1400);
    await page.screenshot({ path: path.join(OUT, 'preview-home.png') });
  });
} finally {
  await context.close();
  await browser.close();
}

const erroresRelevantes = consola.filter((linea) => !/favicon|Download the React|\[vite\]/i.test(linea));
const informe = [
  `# Verificación del preview publicado`,
  ``,
  `URL: ${BASE}`,
  ``,
  `## Comprobaciones`,
  ...fallos.map((f) => `- ${f}`),
  ``,
  `## Medido`,
  ...notas.map((n) => `- ${n}`),
  ``,
  `## Red`,
  `- peticiones fallidas: ${red.fallidas.length}`,
  ...red.fallidas.slice(0, 15).map((r) => `  - ${r}`),
  `- respuestas >=400: ${red.noOk.length}`,
  ...red.noOk.slice(0, 15).map((r) => `  - ${r}`),
  ``,
  `## Consola`,
  `- errores: ${erroresRelevantes.length}`,
  ...erroresRelevantes.slice(0, 15).map((r) => `  - ${r}`),
  ``,
].join('\n');
writeFileSync(path.join(OUT, 'VERIFICACION.md'), informe);
console.log(informe);

const rotos = fallos.filter((f) => f.startsWith('FALLA'));
if (rotos.length || red.noOk.length || erroresRelevantes.length) process.exitCode = 1;

async function paso(nombre, fn) {
  try {
    await fn();
    fallos.push(`OK    ${nombre}`);
    console.log(`OK    ${nombre}`);
  } catch (error) {
    fallos.push(`FALLA ${nombre} — ${error.message}`);
    console.log(`FALLA ${nombre} — ${error.message}`);
  }
}
