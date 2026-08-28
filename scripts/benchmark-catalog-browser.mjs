/*
 * LA MISMA PREGUNTA, PERO EN UN NAVEGADOR DE VERDAD.
 *
 * `benchmark-catalog-scale.mjs` mide los algoritmos en Node: sirve para
 * encontrar uno que crece mal —encontró el vínculo pack↔unidad, que era
 * cuadrático— y no sirve para afirmar nada sobre la pantalla. No hay layout, no
 * hay pintado y no hay DOM.
 *
 * Esto abre Chromium contra el sitio servido, le inyecta un catálogo sintético
 * del tamaño pedido ANTES de que arranquen los módulos, y mide lo que sólo se
 * puede medir ahí:
 *
 *   arranque   · de la navegación a `data-taba-startup="ready"`.
 *   home       · nodos del DOM cuando la primera pantalla terminó de pintarse.
 *   catalogo   · abrir «Todas» y esperar la grilla: cuánto tarda y con cuántos
 *                nodos queda la página. Es la magnitud que decide si hace falta
 *                paginar, y hasta acá se estimaba a ojo.
 *   busqueda   · escribir una consulta y esperar el resultado.
 *   categoria  · cambiar de categoría.
 *   memoria    · `performance.memory.usedJSHeapSize`, cuando el navegador la
 *                expone. Es una lectura orientativa: el recolector corre cuando
 *                quiere y el número se lee como orden de magnitud, no como cifra.
 *
 * NO ES UNA PRUEBA. No afirma un umbral ni falla: imprime números para decidir.
 * Los umbrales que sí fallan viven en `tests/catalog-scale.test.mjs`.
 *
 * Uso:
 *   node scripts/benchmark-catalog-browser.mjs
 *   node scripts/benchmark-catalog-browser.mjs --sizes 100,1000 --json
 *   node scripts/benchmark-catalog-browser.mjs --out artifacts/escala.json
 *
 * El binario de Chromium sale de `PLAYWRIGHT_CHROMIUM_EXECUTABLE` si está
 * definida, y si no del que Playwright resuelva solo.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';
import { buildSyntheticCatalog, DEFAULT_SIZES } from './benchmark-catalog-scale.mjs';
import { STORE_CATEGORIES } from '../js/core/store-taxonomy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.TABA_BENCH_PORT || 4321);

/** El catálogo con la forma que espera `js/beverage-demo-data.js`. */
function browserCatalog(size) {
  const products = buildSyntheticCatalog(size);
  const usadas = new Set(products.map((product) => product.categoryId));
  return {
    PREVIEW_CATALOG_VERSION: `benchmark-${size}`,
    categories: [
      { id: 'all', name: 'Todos' },
      ...STORE_CATEGORIES
        .filter((categoria) => usadas.has(categoria.id))
        .map((categoria) => ({ id: categoria.id, name: categoria.displayName })),
    ],
    products,
  };
}

async function withServer(run) {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/realtime-relay.mjs'), String(PORT)], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  try {
    await waitForServer();
    return await run();
  } finally {
    server.kill('SIGTERM');
  }
}

async function waitForServer(attempts = 60) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/index.html`);
      if (response.ok) return;
    } catch { /* todavía no levantó */ }
    await new Promise((resolve) => { setTimeout(resolve, 250); });
  }
  throw new Error(`el servidor local no respondió en el puerto ${PORT}`);
}

const nodos = (page) => page.evaluate(() => document.querySelectorAll('*').length);
const heapKb = (page) => page.evaluate(() => (
  performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1024) : null
));

async function measureSize(browser, size) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const catalogo = browserCatalog(size);
  await page.addInitScript((payload) => {
    globalThis.__TABA_TEST_CATALOG__ = payload;
  }, catalogo);

  const arranqueDesde = Date.now();
  await page.goto(`http://127.0.0.1:${PORT}/index.html?demo=1`, { waitUntil: 'domcontentloaded' });
  await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 60000 });
  const arranque = Date.now() - arranqueDesde;
  // La home reemplaza su esqueleto por los carruseles definitivos poco después
  // de estar lista; medir antes contaría los nodos del esqueleto.
  await page.waitForTimeout(700);
  const nodosHome = await nodos(page);

  const catalogoDesde = Date.now();
  await page.evaluate(() => { globalThis.location.hash = '#catalogo'; });
  await page.locator('[data-product-grid] .product-card, [data-product-grid] article').first()
    .waitFor({ state: 'attached', timeout: 60000 });
  await page.waitForFunction(
    (esperados) => document.querySelectorAll('[data-product-grid] [data-add-product]').length >= esperados,
    Math.min(size, 1) ,
    { timeout: 60000 },
  );
  const catalogoMs = Date.now() - catalogoDesde;
  const nodosCatalogo = await nodos(page);
  const tarjetas = await page.locator('[data-product-grid] [data-add-product]').count();

  const buscador = page.locator('[data-view="catalog"] [data-search-input]').first();
  const busquedaDesde = Date.now();
  await buscador.fill('coca original');
  await page.waitForTimeout(50);
  await page.waitForFunction(
    () => document.querySelectorAll('[data-product-grid] [data-add-product]').length >= 0,
    undefined,
    { timeout: 30000 },
  );
  const busquedaMs = Date.now() - busquedaDesde;
  const resultados = await page.locator('[data-product-grid] [data-add-product]').count();
  await buscador.fill('');
  await page.waitForTimeout(50);

  const categoriaDesde = Date.now();
  const chip = page.locator('[data-view="catalog"] [data-category-id="limpieza"]').first();
  const hayChip = await chip.count();
  if (hayChip) {
    await chip.click();
    await page.waitForTimeout(50);
  }
  const categoriaMs = Date.now() - categoriaDesde;

  const memoria = await heapKb(page);
  await context.close();

  return {
    size,
    ms: { arranque, catalogo: catalogoMs, busqueda: busquedaMs, categoria: categoriaMs },
    nodos: { home: nodosHome, catalogo: nodosCatalogo },
    tarjetas,
    resultadosBusqueda: resultados,
    heapKb: memoria,
  };
}

export async function runBrowserBenchmark(sizes = DEFAULT_SIZES) {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
  return withServer(async () => {
    const browser = await chromium.launch(executablePath ? { executablePath } : {});
    try {
      const medidas = [];
      for (const size of sizes) medidas.push(await measureSize(browser, size));
      return { generado: new Date().toISOString(), navegador: browser.version(), medidas };
    } finally {
      await browser.close();
    }
  });
}

function render(report) {
  const filas = report.medidas.map((medida) => [
    String(medida.size).padStart(5),
    String(medida.ms.arranque).padStart(9),
    String(medida.ms.catalogo).padStart(9),
    String(medida.ms.busqueda).padStart(9),
    String(medida.ms.categoria).padStart(10),
    String(medida.nodos.home).padStart(11),
    String(medida.nodos.catalogo).padStart(14),
    String(medida.tarjetas).padStart(9),
    String(medida.heapKb ?? '—').padStart(9),
  ].join(' '));
  return [
    '',
    '  SKU  arranque  catálogo  búsqueda  categoría  nodos home  nodos catálogo  tarjetas  heap KB',
    '  ------------------------------------------------------------------------------------------',
    ...filas.map((fila) => `  ${fila}`),
    '',
    '  Milisegundos medidos en Chromium sobre el sitio servido, viewport de 390×844.',
    '  El heap es orientativo: el recolector corre cuando quiere.',
    '',
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const sizesIndex = args.indexOf('--sizes');
  const sizes = sizesIndex >= 0
    ? String(args[sizesIndex + 1] || '').split(',').map(Number).filter((value) => Number.isInteger(value) && value > 0)
    : [...DEFAULT_SIZES];
  const outIndex = args.indexOf('--out');
  const report = await runBrowserBenchmark(sizes);
  if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else console.log(render(report));
  if (outIndex >= 0 && args[outIndex + 1]) {
    const destino = path.resolve(ROOT, args[outIndex + 1]);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`  Escrito en ${path.relative(ROOT, destino)}`);
  }
}
