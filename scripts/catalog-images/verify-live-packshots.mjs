/*
 * Las cuatro fotografías, en el sitio PUBLICADO y en un navegador de verdad.
 *
 * QUÉ MIDE QUE LOS TESTS NO PUEDEN
 * --------------------------------
 * Un test comprueba el contrato; esto comprueba lo que llega por la red. Que el
 * archivo esté en el paquete no dice que el borde lo sirva, y que la ficha pida
 * una URL no dice que esa URL devuelva LA foto correcta y no otra con el mismo
 * nombre. Por eso cada imagen se descarga y se le calcula el SHA-256: un 200 con
 * el contenido equivocado es exactamente el fallo que un chequeo de status deja
 * pasar.
 *
 * NO ESCRIBE NADA. El carrito vive en el almacenamiento del navegador: sumar una
 * unidad no crea ningún pedido. No inicia sesión, no toca la base, no compra.
 *
 *   node scripts/catalog-images/verify-live-packshots.mjs
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';
import { OBJETIVOS, SKUS_OBJETIVO } from './lote-objetivo.mjs';
import { stableJson } from './lib.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const BASE = process.env.TABA_PUBLIC_ORIGIN || 'https://la-taba.pages.dev';
const INFORME = path.join(ROOT, 'artifacts/taba2-catalog-images/LIVE-VERIFY.json');
const RETAILERS = /jumbo|carrefour|disco|vea|coto|cotodigital|mercadolibre|mlstatic|supermercadosdia/i;

const comprobaciones = [];
const ok = (t) => { comprobaciones.push({ ok: true, t }); console.log(`  OK    ${t}`); };
const mal = (t) => { comprobaciones.push({ ok: false, t }); console.error(`  FALLA ${t}`); };
const nota = (t) => console.log(`        ${t}`);

const manifiesto = JSON.parse(await fs.readFile(path.join(ROOT, 'docs/catalog/image-manifest.json'), 'utf8'));
const identidad = JSON.parse(await fs.readFile(path.join(ROOT, 'release-identity.json'), 'utf8'));
const porSku = new Map(manifiesto.sources.map((f) => [f.sku, f]));

console.log(`\n── IMÁGENES SERVIDAS · ${BASE}`);
const servidas = [];
for (const sku of SKUS_OBJETIVO) {
  const fuente = porSku.get(sku);
  for (const [clase, asset] of [['master', fuente.assets.master], ['thumbnail', fuente.assets.thumbnail]]) {
    const url = `${BASE}/${asset.path}`;
    let estado = 0;
    let sha = null;
    let tipo = '';
    let bytes = 0;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(45_000) });
      estado = r.status;
      tipo = (r.headers.get('content-type') || '').split(';')[0].trim();
      const cuerpo = Buffer.from(await r.arrayBuffer());
      bytes = cuerpo.length;
      sha = createHash('sha256').update(cuerpo).digest('hex');
    } catch (error) {
      mal(`${sku} ${clase}: la descarga falló (${error.message})`);
      continue;
    }
    servidas.push({ bytes, clase, estado, sha256: sha, sku, tipo, url });
    if (estado !== 200) { mal(`${sku} ${clase}: HTTP ${estado}`); continue; }
    if (tipo !== 'image/webp') { mal(`${sku} ${clase}: content-type ${tipo}`); continue; }
    // El SHA-256 es lo que distingue «hay una imagen» de «hay ESTA imagen».
    if (sha !== asset.sha256) { mal(`${sku} ${clase}: el contenido servido NO es el aprobado`); continue; }
    if (RETAILERS.test(url)) { mal(`${sku} ${clase}: la URL es de un retailer`); continue; }
    ok(`${OBJETIVOS.get(sku).nombre} · ${clase} · 200 · ${(bytes / 1024).toFixed(1)} KB · SHA-256 exacto`);
  }
}

console.log('\n── LA TIENDA, EN UN NAVEGADOR REAL');
const navegador = await chromium.launch();
const contexto = await navegador.newContext({
  hasTouch: true,
  serviceWorkers: 'allow',
  userAgent: 'Mozilla/5.0 (Linux; Android 15; moto g15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
  viewport: { width: 390, height: 844 },
});
const pagina = await contexto.newPage();
const erroresConsola = [];
pagina.on('pageerror', (e) => erroresConsola.push(String(e.message)));
pagina.on('console', (m) => { if (m.type() === 'error') erroresConsola.push(m.text()); });

// Toda imagen que el navegador pida, anotada. Si un retailer sigue vivo en
// alguna superficie, aparece acá aunque ningún producto lo referencie.
const pedidas = new Set();
pagina.on('request', (r) => { if (r.resourceType() === 'image') pedidas.add(r.url()); });

let resumen = {};
try {
  await pagina.goto(BASE, { waitUntil: 'domcontentloaded' });
  await pagina.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 90_000 });
  ok('el sitio arranca');

  await pagina.evaluate(() => { window.location.hash = '#catalog'; });
  await pagina.waitForTimeout(3000);

  const tarjetas = await pagina.locator('.thumb').count();
  if (tarjetas >= 30) ok(`catálogo visible · ${tarjetas} productos`);
  else mal(`el catálogo trajo ${tarjetas} productos`);

  const conFoto = await pagina.locator('.thumb.has-photo').count();
  const conPlaceholder = await pagina.locator('.thumb.uses-placeholder').count();
  if (conFoto === SKUS_OBJETIVO.length) ok(`${conFoto} tarjetas con fotografía propia`);
  else mal(`se esperaban ${SKUS_OBJETIVO.length} tarjetas con foto y hay ${conFoto}`);
  if (conPlaceholder >= 25) ok(`${conPlaceholder} tarjetas siguen con el recurso propio de TABA`);
  else mal(`sólo ${conPlaceholder} tarjetas usan el placeholder: el fallback no estaría funcionando`);

  // Qué imagen dibuja cada tarjeta con foto, y de qué producto es.
  const dibujadas = await pagina.evaluate(() => [...document.querySelectorAll('.thumb.has-photo img')]
    .map((img) => ({ alt: img.getAttribute('data-product-name') || '', src: img.getAttribute('src') || '' })));
  for (const { alt, src } of dibujadas) nota(`dibuja: ${alt} → ${src.split('/').pop()}`);
  const esperadas = new Set(SKUS_OBJETIVO.map((sku) => porSku.get(sku).assets.thumbnail.path.split('/').pop()));
  const dibujadasOk = dibujadas.every(({ src }) => esperadas.has(src.split('/').pop().split('?')[0]));
  if (dibujadasOk && dibujadas.length === SKUS_OBJETIVO.length) ok('cada tarjeta con foto dibuja el thumbnail de SU producto');
  else mal('alguna tarjeta dibuja una imagen que no es la de su producto');

  // Ficha y carrito, sobre uno de los cuatro.
  const objetivo = OBJETIVOS.get(SKUS_OBJETIVO[0]).nombre;
  const tarjeta = pagina.locator('.thumb.has-photo').first();
  await tarjeta.click();
  await pagina.waitForTimeout(1800);
  const enFicha = await pagina.locator('.thumb-modal img, [role="dialog"] img').count();
  if (enFicha > 0) ok(`la ficha de ${objetivo} muestra su fotografía`);
  else mal('la ficha no muestra fotografía');

  const precioVisible = await pagina.evaluate(() => document.body.innerText.match(/\$\s?[\d.]{3,}/g)?.slice(0, 6) || []);
  nota(`precios a la vista: ${precioVisible.join(' · ')}`);

  await pagina.keyboard.press('Escape');
  await pagina.waitForTimeout(600);
  const agregar = pagina.locator('[data-add-product] >> visible=true').first();
  if (await agregar.count() === 0) {
    mal('no se encontró el control para agregar al carrito');
  } else {
    await agregar.click();
    await pagina.waitForTimeout(1500);
    const carrito = await pagina.evaluate(() => {
      for (const k of Object.keys(localStorage)) {
        if (/cart|carrito/i.test(k)) {
          const v = localStorage.getItem(k) || '';
          if (v.length > 2) return v.slice(0, 400);
        }
      }
      return '';
    });
    if (carrito) ok('el carrito guarda el producto (en el navegador, sin crear pedido)');
    else mal('el carrito no guardó nada');
  }

  // PWA: lo que se prometió que no se tocaba.
  const manifiestoWeb = await pagina.evaluate(async () => {
    const r = await fetch('/manifest.webmanifest');
    return { estado: r.status, tipo: r.headers.get('content-type'), cuerpo: await r.json() };
  });
  if (manifiestoWeb.estado === 200 && manifiestoWeb.cuerpo?.name === 'La Taba') ok(`manifest intacto · ${manifiestoWeb.cuerpo.name} · ${manifiestoWeb.cuerpo.display}`);
  else mal(`manifest inesperado: ${JSON.stringify(manifiestoWeb).slice(0, 160)}`);

  const sw = await pagina.evaluate(async () => {
    const r = await fetch('/sw.js');
    const t = await r.text();
    return { cache: t.match(/CACHE_NAME\s*=\s*'([^']+)'/)?.[1] || null, estado: r.status };
  });
  if (sw.cache === identidad.cacheName) ok(`service worker intacto · ${sw.cache}`);
  else mal(`el service worker sirve ${sw.cache} y el release declara ${identidad.cacheName}`);

  const registrado = await pagina.evaluate(() => navigator.serviceWorker?.controller ? 'controlando' : 'sin controlar');
  nota(`service worker: ${registrado}`);

  const deRetailer = [...pedidas].filter((u) => RETAILERS.test(u));
  if (deRetailer.length === 0) ok(`ninguna de las ${pedidas.size} imágenes pedidas viene de un retailer`);
  else { mal(`${deRetailer.length} imágenes de retailer`); for (const u of deRetailer.slice(0, 5)) nota(u); }

  if (erroresConsola.length === 0) ok('consola limpia');
  else { mal(`${erroresConsola.length} error(es) en consola`); for (const e of erroresConsola.slice(0, 4)) nota(e); }

  await pagina.screenshot({ path: path.join(ROOT, 'artifacts/taba2-catalog-images/live-catalogo.png'), fullPage: false });
  resumen = { conFoto, conPlaceholder, tarjetas };
} finally {
  await contexto.close();
  await navegador.close();
}

const rotas = comprobaciones.filter((c) => !c.ok);
await fs.writeFile(INFORME, stableJson({
  base: BASE,
  cacheName: identidad.cacheName,
  comprobaciones,
  imagenes: servidas,
  resumen,
  rotas: rotas.length,
  schemaVersion: 1,
  veredicto: rotas.length === 0 ? '4 OFFICIAL PACKSHOTS LIVE' : 'REVISAR',
}), 'utf8');

console.log(`\n  informe: ${path.relative(ROOT, INFORME).replaceAll('\\', '/')}`);
console.log(rotas.length === 0
  ? '  4 OFFICIAL PACKSHOTS LIVE'
  : `  ${rotas.length} comprobación(es) rota(s)`);
process.exit(rotas.length === 0 ? 0 : 1);
