/*
 * QA 2026-10-24 · dos vistas, un script.
 *
 * A · VITRINA DEL STOREFRONT (preview local)
 *   El preview en BASE sirve el catálogo DEMO (js/beverage-demo-data.js): es la
 *   superficie real del storefront sin backend. El trabajo de precios/imágenes no
 *   tocó ningún archivo del storefront, así que acá se valida que la superficie
 *   sigue sana: navegación, fichas, overflow, fotos no-placeholder cargan, sin
 *   errores de página. Las fotos placeholder del catálogo demo SON esperables
 *   (SKUs históricos sin foto) y se cuentan, no se marcan como falla.
 *
 * B · FICHA DE PROPUESTA (estática, en artifacts/)
 *   La góndola autoridad (catalog/gondola-neuquen.mjs, 52 SKU) NO está publicada
 *   en ningún storefront todavía —sólo se publica tras aprobación comercial—.
 *   Para poder VER qué se propone, el script genera una ficha estática que cruza
 *   el mapa de imágenes auditado (docs/catalog/gondola-publica-imagenes.csv) con
 *   los precios vigentes y los estados de la propuesta. Las imágenes se sirven
 *   por el relay vía <base href="...">: exactamente las mismas rutas que usa la
 *   tienda. Acá los asserts son estrictos: 33 tarjetas auditadas, imagen cargada
 *   por tarjeta y precio mostrado == vigente de la autoridad.
 *
 * Uso: node artifacts/catalog-pricing-images-20261024/qa/qa-vitrina-20261024.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GONDOLA } from '../../../catalog/gondola-neuquen.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8231';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(HERE, '..', '..', '..'); // raíz del worktree
const CAP = path.join(HERE, 'capturas');
const FICHA_DIR = path.join(HERE, 'ficha');
mkdirSync(CAP, { recursive: true });
mkdirSync(FICHA_DIR, { recursive: true });

const GONDOLA_POR_SKU = new Map(GONDOLA.map((p) => [p.sku, p]));

// Mapa de imágenes auditado (33 SKUs): la fuente de verdad visual.
// Parser CSV con comillas: los nombres/frames citados contienen comas («2,25 L»).
const mapaImagenes = readFileSync(path.join(RAIZ, 'docs', 'catalog', 'gondola-publica-imagenes.csv'), 'utf8');
const [cabeceraMapa, ...filasMapa] = mapaImagenes.trim().split(/\r?\n/);
function parseCsvLine(linea) {
  const celdas = [];
  let celda = '';
  let enComillas = false;
  for (let i = 0; i < linea.length; i += 1) {
    const char = linea[i];
    if (char === '"') {
      if (enComillas && linea[i + 1] === '"') { celda += '"'; i += 1; }
      else enComillas = !enComillas;
    } else if (char === ',' && !enComillas) {
      celdas.push(celda);
      celda = '';
    } else celda += char;
  }
  celdas.push(celda);
  return celdas;
}
const columnasMapa = parseCsvLine(cabeceraMapa);
const col = (nombre) => columnasMapa.indexOf(nombre);
const AUDITADOS = filasMapa.map((linea) => {
  const partes = parseCsvLine(linea);
  return {
    sku: partes[col('sku')],
    nombre: partes[col('nombre')],
    presentacion: partes[col('presentacion')],
    imagenUrl: partes[col('image_url')],
    clasificacion: partes[col('clasificacion')],
  };
});

// Propuesta: estado/motivo por SKU (la propuesta JAMÁS entra al catálogo: acá
// sólo se muestra en la ficha de trabajo).
const propuesta = JSON.parse(readFileSync(path.join(HERE, '..', 'propuesta-precios.json'), 'utf8'));
const PROPUESTA_POR_SKU = new Map(propuesta.filas.map((fila) => [fila.sku, fila]));

const digitos = (texto) => (texto || '').replace(/\D+/g, '');
const errores = [];

const browser = await chromium.launch();
try {
  // ══ A · VITRINA DEL STOREFRONT (catálogo demo del preview) ══════════════════
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'es-AR', serviceWorkers: 'block',
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`));

  await gotoConReintentos(page, `${BASE}/?reset=1&demo=1`);
  await page.waitForSelector('[data-view="home"] .home-best-card', { timeout: 20000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(CAP, '01-home-390.png') });

  await page.evaluate(() => { window.location.hash = '#catalog'; });
  await page.waitForSelector('[data-view="catalog"] [data-product-grid] article[data-card-product]', { timeout: 20000 });
  let clicksVerMas = 0;
  for (;;) {
    const boton = page.locator('[data-view="catalog"] [data-catalog-show-more]');
    if ((await boton.count()) === 0 || clicksVerMas >= 40) break;
    await boton.first().click();
    clicksVerMas += 1;
    await page.waitForTimeout(400);
  }
  const mostrando = (await page.locator('[data-view="catalog"] .catalog-more-count').textContent().catch(() => '') || '').trim();

  await page.waitForTimeout(2000);

  const tarjetasDemo = await page.evaluate(() => {
    const limpiar = (texto) => (texto || '').replace(/\s+/g, ' ').trim();
    return [...document.querySelectorAll('[data-product-grid] article[data-card-product]')].map((card) => {
      const img = card.querySelector('.product-media img');
      const src = img?.getAttribute('src') || null;
      return {
        sku: card.getAttribute('data-card-product'),
        titulo: limpiar(card.querySelector('h3')?.textContent),
        precioTexto: limpiar(card.querySelector('.price .price-amounts strong')?.textContent),
        esPlaceholder: Boolean(src && src.includes('beverage-placeholder')),
        imagenUrl: src,
        imagenCargada: Boolean(img && img.complete && img.naturalWidth > 0),
      };
    });
  });
  const overflow390 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await page.screenshot({ path: path.join(CAP, '02-catalogo-390.png') });

  // Ficha (modal) sobre la primera tarjeta de la grilla del catálogo.
  let fichaDemo = null;
  const primero = tarjetasDemo[0];
  if (primero) {
    const triggerGrilla = page.locator(`[data-view="catalog"] [data-product-grid] [data-product-detail="${primero.sku}"]`).first();
    if ((await triggerGrilla.count()) > 0) {
      await triggerGrilla.click();
      await page.waitForSelector(`[data-modal-product-id="${primero.sku}"]`, { timeout: 8000 });
      await page.waitForTimeout(700);
      fichaDemo = {
        sku: primero.sku,
        precioTexto: ((await page.locator(`[data-modal-product-id="${primero.sku}"] .modal-price strong`).first().textContent().catch(() => '')) || '').trim(),
        imagenCargada: await page.evaluate((id) => {
          const media = document.querySelector(`[data-modal-product-id="${id}"] .modal-media img`);
          return Boolean(media && media.complete && media.naturalWidth > 0);
        }, primero.sku),
      };
      await page.screenshot({ path: path.join(CAP, '03-ficha-producto.png') });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    }
  }

  // Desktop 1280.
  const escritorio = await browser.newContext({
    viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, locale: 'es-AR', serviceWorkers: 'block',
  });
  const pageD = await escritorio.newPage();
  // Navegar directo a la vista de catálogo: tras `?reset=1` la app limpia el
  // parámetro con una navegación asincrónica, y un `location.hash = ...` por
  // evaluate puede aterrizar dentro de esa destrucción de contexto.
  await gotoConReintentos(pageD, `${BASE}/?reset=1&demo=1#catalog`);
  await pageD.waitForSelector('[data-view="catalog"] [data-product-grid] article[data-card-product]', { timeout: 20000 });
  await pageD.waitForTimeout(900);
  const overflow1280 = await pageD.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await pageD.screenshot({ path: path.join(CAP, '04-catalogo-desktop.png') });
  await escritorio.close();
  await context.close();

  const fotosReales = tarjetasDemo.filter((t) => !t.esPlaceholder);
  const fotosRotas = fotosReales.filter((t) => t.imagenUrl && !t.imagenCargada);
  const resumenVitrina = {
    tarjetasTotales: tarjetasDemo.length,
    conFotoReal: fotosReales.length,
    conPlaceholder: tarjetasDemo.length - fotosReales.length,
    fotosRotas,
    overflow390, overflow1280, mostrando, fichaDemo,
  };

  // ══ B · FICHA DE PROPUESTA (estática) ════════════════════════════════════════
  const tarjetasFicha = AUDITADOS.map((aud) => {
    const g = GONDOLA_POR_SKU.get(aud.sku) || {};
    const p = PROPUESTA_POR_SKU.get(aud.sku) || {};
    const enGondola = GONDOLA_POR_SKU.has(aud.sku);
    const enPropuesta = PROPUESTA_POR_SKU.has(aud.sku);
    const porUnidad = Number(g.unitsPerPack) > 1 && !g.soldAsPack;
    const estado = String(p.estado || (enGondola ? 'sin dato' : 'fuera de la propuesta · SKU de otra ola'));
    const clase = estado.replace(/_/g, '-').replace(/ /g, '-').toLowerCase();
    return `
      <article class="sku ${enGondola ? '' : 'fuera'}" id="${esc(aud.sku)}">
        <img class="foto" src="${esc(aud.imagenUrl)}" alt="${esc(aud.nombre)}" />
        <div class="datos">
          <h3>${esc(aud.nombre)}${enGondola ? '' : ' · <span class="fuera-tag">fuera de la góndola 52</span>'}</h3>
          <p class="pres">${esc(aud.presentacion)} · ${esc(g.packagingType || '')}</p>
          <p class="precio">Vigente <b>${enGondola ? `$${fmt(g.price)}` : '—'}</b>${enGondola && porUnidad ? ` <small>(pack x${g.unitsPerPack} · $${fmt(Math.round(g.price / g.unitsPerPack))}/u)</small>` : ''}</p>
          <p class="estado ${clase}">${esc(estado)}</p>
          <p class="comp">${enPropuesta ? `Más barato: $${fmt(p.comparadorMasBarato)} · ${esc(p.tiendaMasBarata || '')}${p.descuentoVigenteVsMasBaratoPct != null ? ` · vigente ${p.descuentoVigenteVsMasBaratoPct > 0 ? '−' : ''}${p.descuentoVigenteVsMasBaratoPct}%` : ''}` : 'No forma parte de la propuesta de precios de esta rama (sólo imagen auditada)'}</p>
          <p class="clasi">${esc(aud.clasificacion)}</p>
        </div>
      </article>`;
  }).join('');

  // Los que estan en el mapa auditado pero NO en la góndola de 52: se verifican
  // por imagen y derechos, y se declaran fuera del alcance del precio.
  const auditadosFueraGondola = AUDITADOS.filter((a) => !GONDOLA_POR_SKU.has(a.sku)).map((a) => a.sku);
  const AUDITADOS_EN_GONDOLA = AUDITADOS.filter((a) => GONDOLA_POR_SKU.has(a.sku));

  // Resto de la góndola: alcohol detrás de la compuerta de licencia + sin imagen auditada.
  const resto = GONDOLA.filter((p) => !AUDITADOS.some((a) => a.sku === p.sku));
  const tablaResto = resto.map((p) => {
    const prop = PROPUESTA_POR_SKU.get(p.sku) || {};
    return `<tr id="${esc(p.sku)}"><td>${esc(p.name)}</td><td>${esc(p.presentacion || p.variant || '')}</td><td class="num">$${fmt(p.price)}</td><td>${esc(prop.estado || '—')}</td></tr>`;
  }).join('');

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<base href="${BASE}/" />
<title>Ficha de propuesta · 2026-10-24 · NO PÚBLICO</title>
<style>
  :root { color-scheme: light; }
  body { font: 14px/1.45 system-ui, sans-serif; margin: 0; background: #f4f1ec; color: #1d1d1f; }
  header { padding: 14px 16px; background: #1f2a44; color: #fff; }
  header h1 { font-size: 18px; margin: 0 0 4px; }
  header p { margin: 0; opacity: .85; font-size: 12.5px; }
  .aviso { margin: 0; padding: 8px 16px; background: #b3541e; color: #fff; font-weight: 600; font-size: 13px; }
  main { padding: 12px 16px 40px; }
  .skus { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
  .sku { background: #fff; border: 1px solid #ddd5c8; border-radius: 10px; overflow: hidden; display: flex; }
  .sku img.foto { width: 96px; height: 96px; object-fit: contain; background: #fff; flex: 0 0 96px; }
  .datos { padding: 8px 10px; min-width: 0; }
  .datos h3 { margin: 0 0 2px; font-size: 13.5px; }
  .pres, .comp, .clasi { margin: 2px 0 0; font-size: 11px; color: #6b6257; }
  .precio { margin: 4px 0 2px; font-size: 13px; }
  .estado { display: inline-block; margin: 4px 0 0; padding: 1px 8px; border-radius: 999px; font-size: 10.5px; font-weight: 700; background: #e7e2d8; }
  .estado.mantiene-vigente { background: #dcead7; }
  .estado.conflicto-margen { background: #f3d9cf; }
  .estado.pendiente-sin-comparador, .estado.pendiente-coincidencia-parcial { background: #e5e0f5; }
  table { width: 100%; border-collapse: collapse; background: #fff; font-size: 12.5px; }
  th, td { border: 1px solid #e3dcd2; padding: 5px 8px; text-align: left; }
  td.num, th.num { text-align: right; }
  h2 { font-size: 15px; margin: 22px 0 8px; }
</style></head>
<body>
<header>
  <h1>Ficha de propuesta · góndola Neuquén · 2026-10-24</h1>
  <p>Precios VIGENTES (sin modificar) y estados de la propuesta: pendiente_aprobacion_comercial.</p>
</header>
<p class="aviso">PÁGINA DE TRABAJO · NO es el storefront · nada de esto está publicado</p>
<main>
  <h2>Góndola con vidriera auditada (33 SKUs con imagen autorizada real)</h2>
  <section class="skus">${tarjetasFicha}</section>
  <h2>Resto de la góndola (misma propuesta; alcohol detrás de la compuerta de licencia / sin imagen auditada)</h2>
  <table><thead><tr><th>Producto</th><th>Presentación</th><th class="num">Vigente</th><th>Estado propuesta</th></tr></thead>
  <tbody>${tablaResto}</tbody></table>
</main>
</body></html>`;

  const fichaPath = path.join(FICHA_DIR, 'ficha-propuesta.html');
  writeFileSync(fichaPath, html);

  // Captura y asserts de la ficha (file:// con base href hacia el relay).
  // Primero: ¿cada imagen auditada existe en disco?
  const archivosFaltantes = [];
  for (const aud of AUDITADOS) {
    const enDisco = path.join(RAIZ, aud.imagenUrl.replaceAll('/', path.sep));
    if (!existsSync(enDisco)) archivosFaltantes.push(`${aud.sku}: ${aud.imagenUrl} (NO existe en disco)`);
  }
  const contextoFicha = await browser.newContext({
    viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, serviceWorkers: 'block',
  });
  const pageF = await contextoFicha.newPage();
  pageF.on('pageerror', (e) => errores.push(`ficha pageerror: ${e.message}`));
  await pageF.goto(`file:///${fichaPath.replace(/\\/g, '/')}`);
  try {
    await pageF.waitForFunction(() => {
      const imgs = [...document.querySelectorAll('.sku img.foto')];
      return imgs.length > 0 && imgs.every((img) => img.complete);
    }, { timeout: 15000 });
  } catch { /* lo que quedó sin terminar se reporta abajo */ }
  await pageF.waitForTimeout(500);

  const resumenFicha = await pageF.evaluate(() => {
    return [...document.querySelectorAll('.sku')].map((card) => ({
      sku: card.id,
      precioDigitos: (card.querySelector('.precio b')?.textContent || '').replace(/\D+/g, ''),
      imagenOk: (() => {
        const img = card.querySelector('img.foto');
        return Boolean(img && img.complete && img.naturalWidth > 0);
      })(),
    }));
  });
  await pageF.screenshot({ path: path.join(CAP, '05-ficha-propuesta-completa.png'), fullPage: true });
  await contextoFicha.close();

  const fichaVeredicto = {
    tarjetasEsperadas: AUDITADOS.length,
    tarjetasRender: resumenFicha.length,
    imagenesCargadas: resumenFicha.filter((f) => f.imagenOk).length,
    imagenesFallando: resumenFicha.filter((f) => !f.imagenOk).map((f) => f.sku),
    auditadosFueraGondola,
    preciosCoincidenConVigente: resumenFicha.filter((f) => {
      const g = GONDOLA_POR_SKU.get(f.sku);
      return g ? f.precioDigitos === String(g.price) : false;
    }).length,
  };
  const preciosDiscrepantes = resumenFicha
    .filter((f) => GONDOLA_POR_SKU.has(f.sku) && f.precioDigitos !== String(GONDOLA_POR_SKU.get(f.sku).price))
    .map((f) => `${f.sku}: mostrado ${f.precioDigitos || '—'} vs vigente ${GONDOLA_POR_SKU.get(f.sku)?.price ?? '—'}`);

  // ── RESULTADO ──────────────────────────────────────────────────────────────
  const resultado = {
    schemaVersion: 1, generadoEl: '2026-10-24', base: BASE,
    vitrina: resumenVitrina,
    ficha: { ...fichaVeredicto, archivosFaltantes, preciosDiscrepantes },
  };
  writeFileSync(path.join(HERE, 'qa-resultados.json'), `${JSON.stringify(resultado, null, 2)}\n`);

  console.log('── A · Vitrina storefront (catálogo demo del preview) ──');
  console.log(`tarjetas demo: ${tarjetasDemo.length} · foto real: ${fotosReales.length} · placeholder: ${resumenVitrina.conPlaceholder}`);
  console.log(`fotos rotas: ${fotosRotas.length === 0 ? 'ninguna' : JSON.stringify(fotosRotas)}`);
  console.log(`overflow 390: ${overflow390}px · 1280: ${overflow1280}px`);
  console.log(`ficha demo: ${JSON.stringify(fichaDemo)}`);
  console.log(`pageerrors: ${errores.length ? errores.join(' | ') : 'ninguno'}`);
  console.log('── B · Ficha de propuesta (estática) ──');
  console.log(`tarjetas: ${fichaVeredicto.tarjetasRender}/${fichaVeredicto.tarjetasEsperadas} · img cargadas: ${fichaVeredicto.imagenesCargadas} · fallando: ${fichaVeredicto.imagenesFallando.length === 0 ? 'ninguna' : fichaVeredicto.imagenesFallando.join(', ')}`);
  console.log(`fuera de la góndola 52 (sólo imagen auditada): ${auditadosFueraGondola.join(', ') || 'ninguno'}`);
  console.log(`archivos faltantes en disco: ${archivosFaltantes.length === 0 ? 'ninguno' : archivosFaltantes.join('; ')}`);
  console.log(`precios ficha == vigente (29 SKUs en góndola): ${fichaVeredicto.preciosCoincidenConVigente}/${AUDITADOS_EN_GONDOLA.length} · discrepantes: ${preciosDiscrepantes.length === 0 ? 'ninguno' : preciosDiscrepantes.join('; ')}`);

  const ok =
    fotosRotas.length === 0
    && errores.length === 0
    && archivosFaltantes.length === 0
    && fichaVeredicto.tarjetasRender === AUDITADOS.length
    && fichaVeredicto.imagenesFallando.length === 0
    && fichaVeredicto.preciosCoincidenConVigente === AUDITADOS_EN_GONDOLA.length;
  console.log(ok ? 'QA OK' : 'QA CON PROBLEMAS');
} finally {
  await browser.close();
}

function esc(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function fmt(valor) {
  if (valor == null || valor === '') return '—';
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(Number(valor));
}
async function gotoConReintentos(page, url) {
  for (let intento = 0; intento < 6; intento += 1) {
    const listo = await fetch(`${BASE}/`).then((r) => r.ok).catch(() => false);
    if (listo || intento === 0) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      return;
    }
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new Error(`El servidor ${BASE} no respondió`);
}
