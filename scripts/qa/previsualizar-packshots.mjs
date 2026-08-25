/*
 * BEFORE / AFTER de la góndola, con el componente REAL de la tarjeta.
 *
 * POR QUÉ HACE FALTA UNA PREVISUALIZACIÓN Y NO ALCANZA UNA CAPTURA
 * ---------------------------------------------------------------
 * Las fotografías nuevas ya viajan en el paquete publicado, pero la tienda las
 * pide a la BASE, y asociarlas a sus productos exige una sesión de owner: el
 * `UPDATE` sobre `products` está revocado para `authenticated` y la única
 * puerta es `import_catalog_batch`. Hasta que alguien con esa credencial
 * aplique el lote, la tienda sigue dibujando el marcador.
 *
 * Esto no inventa una maqueta: carga la tienda de verdad y, en la página,
 * reemplaza la imagen de cada tarjeta por el archivo que le corresponde según
 * `docs/catalog/image-manifest.json`. Mismo CSS, misma tarjeta, misma grilla.
 * Es exactamente lo que se va a ver, y por eso sirve para decidir.
 *
 *   node scripts/qa/previsualizar-packshots.mjs --origen http://127.0.0.1:8080
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const ORIGEN = arg('--origen', 'http://127.0.0.1:8200');
const SALIDA = path.resolve(ROOT, arg('--salida', 'artifacts/taba-premium-catalog/packshots'));

const manifiesto = JSON.parse(await fs.readFile(path.join(ROOT, 'docs/catalog/image-manifest.json'), 'utf8'));
const porSku = Object.fromEntries(manifiesto.sources.map((s) => [s.sku, {
  master: s.assets.master.path,
  thumbnail: s.assets.thumbnail.path,
}]));

const navegador = await chromium.launch();
const contexto = await navegador.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
  locale: 'es-AR',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
});
const pagina = await contexto.newPage();
await pagina.goto(ORIGEN, { waitUntil: 'networkidle', timeout: 120_000 });
await pagina.waitForSelector('[data-add-product]', { timeout: 60_000 });
await pagina.waitForTimeout(2200);
for (const cerrar of ['[data-install-close]', '[data-install-decline]']) {
  const boton = pagina.locator(`${cerrar}:visible`).first();
  if (await boton.count()) { await boton.click({ timeout: 4000 }).catch(() => {}); break; }
}
await pagina.keyboard.press('Escape').catch(() => {});
await pagina.locator('.mobile-nav [data-nav-view="catalog"]').first().click();
await pagina.waitForTimeout(1200);

await fs.mkdir(SALIDA, { recursive: true });
await pagina.screenshot({ path: path.join(SALIDA, 'ANTES-catalogo.png') });

/*
 * El id del producto en el DOM es un UUID; el manifiesto habla en SKU. El puente
 * lo da el estado de la tienda, que es donde conviven los dos.
 */
const cambiadas = await pagina.evaluate(async (mapa) => {
  const { getState } = await import('./js/state.js');
  const porId = new Map(getState().products.map((p) => [p.id, p.sku || p.externalId || p.id]));
  let n = 0;
  for (const tarjeta of document.querySelectorAll('[data-product-grid] .product-card')) {
    const id = tarjeta.querySelector('[data-product-detail]')?.dataset.productDetail;
    const sku = porId.get(id);
    const rutas = sku ? mapa[sku] : null;
    if (!rutas) continue;
    const img = tarjeta.querySelector('img.thumb-img');
    const marco = tarjeta.querySelector('.thumb');
    if (!img || !marco) continue;
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    img.classList.remove('is-placeholder');
    marco.classList.remove('uses-placeholder');
    marco.classList.add('has-photo');
    img.src = rutas.thumbnail;
    n += 1;
  }
  return n;
}, porSku);

await pagina.waitForTimeout(1500);
await pagina.screenshot({ path: path.join(SALIDA, 'DESPUES-catalogo.png') });

// Y la home, que es la primera pantalla.
await pagina.locator('.mobile-nav [data-nav-view="home"]').first().click();
await pagina.waitForTimeout(1200);
await pagina.screenshot({ path: path.join(SALIDA, 'ANTES-home.png') });
await pagina.evaluate(async (mapa) => {
  const { getState } = await import('./js/state.js');
  const porId = new Map(getState().products.map((p) => [p.id, p.sku || p.externalId || p.id]));
  for (const boton of document.querySelectorAll('[data-product-detail]')) {
    const sku = porId.get(boton.dataset.productDetail);
    const rutas = sku ? mapa[sku] : null;
    const img = boton.querySelector('img');
    if (!rutas || !img) continue;
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    img.classList.remove('is-placeholder');
    img.src = rutas.thumbnail;
  }
}, porSku);
await pagina.waitForTimeout(1500);
await pagina.screenshot({ path: path.join(SALIDA, 'DESPUES-home.png') });

await navegador.close();
console.log(`${cambiadas} tarjetas del catálogo con fotografía real`);
console.log(`capturas en ${path.relative(ROOT, SALIDA).replaceAll('\\', '/')}`);
