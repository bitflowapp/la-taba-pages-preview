/*
 * QA FORMAL — Vitrina Neuquén 2026-10-24 con fotos reales verificadas.
 *
 * Qué prueba (y cómo):
 *   · DATOS (Node): la vitrina generada es fiel a sus autoridades —52 SKU de
 *     catalog/gondola-neuquen.mjs, `precioDeVenta` como única fuente de precio,
 *     cobertura 42 fotos + 10 sin foto declaradas, alcohol rotulado con edad 18.
 *   · MODO DESPUÉS (Playwright, móvil 390 y desktop 1280): cada tarjeta muestra
 *     LA miniatura declarada para ESE SKU (per-SKU image correctness, no sólo
 *     una cuenta), precios DOM = vigentes, buscador filtra, chips de categoría
 *     filtran, alta al carrito + carrito, ficha con foto + precio + aviso +18,
 *     imágenes realmente decodificadas (naturalWidth), cero <img> remotos, cero
 *     pageerrors y cero respuestas fallidas del propio servidor, sin overflow.
 *   · MODO ANTES (&fotos=antes): 52/52 placeholder, cero fotos, MISMO mapa de
 *     precios —demostración visual honesta del antes/después.
 *
 * Salida: qa/qa-vitrina-neuquen-20261024.json + capturas en qa/capturas-neuquen/.
 * No toca producción ni la base ni pedidos: storefront demo local (?reset=1) con
 * service worker bloqueado; el estado vive en la memoria del navegador.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GONDOLA, precioDeVenta, CATEGORIAS_CON_ALCOHOL } from '../../../catalog/gondola-neuquen.mjs';
import { products as vitrina, VITRINA_META } from '../../../js/vitrina-neuquen-20261024.js';

const BASE = (process.env.BASE || 'http://127.0.0.1:8231').replace(/\/+$/, '');
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const CAPS_DIR = path.join(AQUI, 'capturas-neuquen');
const RESULT_JSON = path.join(AQUI, 'qa-vitrina-neuquen-20261024.json');
mkdirSync(CAPS_DIR, { recursive: true });

const PLACEHOLDER = 'beverage-placeholder';
const afirnaciones = [];
const fallos = [];
let secuencia = 0;
function chequear(nombre, cond, detalle = '') {
  secuencia += 1;
  const id = `${String(secuencia).padStart(2, '0')} · ${nombre}`;
  afirnaciones.push({ id, ok: Boolean(cond), detalle: detalle ? String(detalle).slice(0, 2000) : undefined });
  if (!cond) fallos.push(id);
  return Boolean(cond);
}
const digitos = (texto) => String(texto ?? '').replace(/\D+/g, '');
const basename = (ruta) => String(ruta || '').split('/').pop();

/* ───────────────────────── 1 · Autoridades (Node) ───────────────────────── */

const porSkuAutoridad = new Map(GONDOLA.map((fila) => [
  fila.sku,
  {
    esAlcoholico: CATEGORIAS_CON_ALCOHOL.includes(fila.category),
    precio: precioDeVenta(fila),
    fila,
  },
]));

const SKUS_SIN_FOTO = new Set(VITRINA_META.sinFoto);
const esperado = new Map(vitrina.map((producto) => [producto.id, {
  cobertura: producto.vitrinaCobertura,
  thumb: basename(producto.imageThumbnail),
  master: basename(producto.image),
}]));
const SKUS_CERVEZAS = vitrina.filter((p) => p.categoryId === 'cervezas').map((p) => p.id);

chequear('vitrina cubre los 52 SKU de la autoridad',
  GONDOLA.length === 52 && vitrina.length === 52
    && GONDOLA.every((fila) => esperado.has(fila.sku)));
chequear('precios vitrina = precioDeVenta (52/52)',
  vitrina.every((p) => Object.is(p.price, porSkuAutoridad.get(p.id).precio)));
chequear('cobertura 42 con foto · 10 sin foto · nada mixto',
  vitrina.filter((p) => !SKUS_SIN_FOTO.has(p.id)).length === 42
    && SKUS_CERVEZAS.length >= 10 && SKUS_SIN_FOTO.size === 10
    && vitrina.every((p) => SKUS_SIN_FOTO.has(p.id) === (p.vitrinaCobertura === 'FALBACK'))
    && vitrina.every((p) => !SKUS_SIN_FOTO.has(p.id)
      === (p.vitrinaCobertura === 'AUDITADA' || p.vitrinaCobertura === 'MANIFIESTO_PREPARADO')));
chequear('los 42 con foto traen cadena completa y ruta propia assets/products/',
  vitrina.filter((p) => !SKUS_SIN_FOTO.has(p.id)).every((p) => Boolean(
    p.image && p.imageThumbnail
      && p.imageSha256 && p.imageThumbnailSha256 && p.sourceImageSha256
      && p.rightsStatus === 'LICENCIA_COMERCIAL'
      && p.image.startsWith('assets/products/')
      && p.imageThumbnail.startsWith('assets/products/'),
  )));
chequear('los 10 sin foto traen CERO campos de imagen (honestidad del fallback)',
  vitrina.filter((p) => SKUS_SIN_FOTO.has(p.id)).every((p) => !p.image && !p.imageThumbnail
    && !p.imageSha256 && !p.imageThumbnailSha256 && !p.sourceImageSha256
    && p.rightsStatus !== 'LICENCIA_COMERCIAL'));
chequear('alcohol: etiqueta y edad correctas, y nada de alcohol mal clasificado',
  vitrina.every((p) => {
    const { esAlcoholico } = porSkuAutoridad.get(p.id);
    return esAlcoholico === (p.alcoholic === true)
      && (!esAlcoholico
        ? p.minimumAge === null && p.requiresAgeConfirmation === false
        : Number(p.minimumAge) === 18 && p.requiresAgeConfirmation === true);
  }));

const coca = vitrina.find((p) => p.id === 'coca-cola-original-2250ml');
const ganciaLata = vitrina.find((p) => p.id === 'gancia-lima-limon-lata-473ml');
chequear('los casos de uso QA existen y son del tipo correcto',
  Boolean(coca) && coca.alcoholic === false
    && Boolean(ganciaLata) && ganciaLata.alcoholic === true
    && !SKUS_SIN_FOTO.has('gancia-lima-limon-lata-473ml'));

function busquedaTexto(fila) {
  return [fila.brand, fila.name, fila.variant, fila.category].filter(Boolean).join(' ');
}

if (fallos.length) {
  escribirResultados('datos');
  console.error('QA detenido: los datos generados no son fieles a las autoridades.');
  for (const fallo of fallos) console.error(`  ✗ ${fallo}`);
  process.exit(1);
}

/* ─────────────────────────── 2 · Playwright ─────────────────────────────── */

const urlCon = (extra = '') => `${BASE}/?reset=1&demo=1&vitrina=neuquen20261024${extra}`;
const conFotoIds = vitrina.filter((p) => !SKUS_SIN_FOTO.has(p.id)).map((p) => p.id);
const sinFotoIds = vitrina.filter((p) => SKUS_SIN_FOTO.has(p.id)).map((p) => p.id);
let erroresPaginaTotal = 0;

/** Analiza la góndola completa desde el DOM vivo. */
function inventarioDOM() {
  const tarjetas = [...document.querySelectorAll('[data-product-grid] article[data-card-product]')];
  const porSku = {};
  for (const tarjeta of tarjetas) {
    const sku = tarjeta.getAttribute('data-card-product');
    const img = tarjeta.querySelector('.thumb-img');
    const pulgar = tarjeta.querySelector('.thumb');
    const nodoPrecio = tarjeta.querySelector('.price .price-amounts strong');
    porSku[sku] = {
      src: img?.getAttribute('src') || '',
      actual: img?.currentSrc || '',
      cargada: Boolean(img?.complete && img?.naturalWidth > 0),
      marcador: pulgar?.classList?.contains('has-photo') ? 'foto'
        : pulgar?.classList?.contains('uses-placeholder') ? 'placeholder' : '?',
      clase: img?.classList?.contains('is-placeholder') ? 'placeholder' : 'foto',
      precioTexto: nodoPrecio?.textContent || '',
      edad: Boolean(tarjeta.querySelector('.product-age-tag')),
    };
  }
  return {
    total: tarjetas.length,
    porSku,
    // Ban: <img> que apunten a OTRO origen que el storefront local. Los absurls
    // de este propio servidor (emblem, assets) son el canal bueno.
    urlsRemotas: [...document.querySelectorAll('img')]
      .map((img) => img.currentSrc || img.src || '')
      .filter((url) => {
        try { return Boolean(url && new URL(url, location.origin).origin !== location.origin); }
        catch (_) { return false; }
      }),
    overflow: Math.max(
      document.documentElement.scrollWidth - window.innerWidth,
      document.body.scrollWidth - window.innerWidth,
    ),
  };
}

async function scrollFull(page, pausa = 120) {
  // Lazy-load: bajar de a pantallas para que cada foto pida su archivo.
  const alto = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < alto; y += 700) {
    await page.evaluate((pos) => window.scrollTo(0, pos), y);
    await page.waitForTimeout(80);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(pausa);
}

async function esperarLayout(page, pausa = 150) {
  await page.waitForSelector('[data-view="catalog"] [data-product-grid] article[data-card-product]', { timeout: 30_000 });
  await page.waitForFunction(
    (total) => document.querySelectorAll('[data-product-grid] article[data-card-product]').length === total,
    52,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(400);
  await scrollFull(page, pausa);
}

/** Escribe la búsqueda en el input VISIBLE (hay un campo por forma factor). */
async function escribirBusqueda(page, valor) {
  await page.evaluate((consulta) => {
    const inputs = [...document.querySelectorAll('[data-search-input]')];
    const input = inputs.find((node) => node.offsetParent !== null) || inputs[0];
    if (!input) throw new Error('sin [data-search-input] en el DOM');
    input.value = consulta;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, valor);
  await page.waitForTimeout(150);
}

/** Click tolerante a dos cascarones (móvil escritorio) sobre un mismo selector. */
async function clickPrimero(page, selector) {
  await page.locator(selector).first().click();
}

/** Verificaciones de góndola en el modo correspondiente (antes = todo placeholder). */
function reclamoGondola(dom, modo, { antes = false } = {}) {
  chequear(`${modo}: tarjetas visibles = 52`, dom.total === 52, `vistas: ${dom.total}`);
  const faltantes = vitrina.filter((p) => !dom.porSku[p.id]);
  chequear(`${modo}: no falta ninguna tarjeta de la góndola`, faltantes.length === 0, faltantes.slice(0, 6).join(','));
  const malasImg = vitrina.filter((p) => {
    const fila = dom.porSku[p.id];
    if (!fila) return false;
    // En el modo antes (fotos=antes) la góndola enteramente con placeholder es
    // EL RESULTADO ESPERADO, no una falla: demuestra qué pasaría sin el trabajo.
    const debeSerPlaceholder = antes || SKUS_SIN_FOTO.has(p.id);
    if (debeSerPlaceholder) {
      return !(fila.clase === 'placeholder' && fila.marcador === 'placeholder' && fila.src.includes(PLACEHOLDER));
    }
    return !(fila.clase === 'foto' && fila.marcador === 'foto'
      && (fila.src.endsWith(esperado.get(p.id).thumb) || fila.src.endsWith(esperado.get(p.id).master)));
  });
  chequear(`${modo}: imagen por SKU EXACTA (${antes ? 'antes: 52/52 placeholder' : 'después: 42 foto declarada; 10 placeholder propio'})`,
    malasImg.length === 0, malasImg.map((p) => {
      const esperadoAhora = p.imageThumbnail && !antes ? basename(p.imageThumbnail) : '(placeholder propio)';
      return `${p.id}: clase=${dom.porSku[p.id]?.clase} marcador=${dom.porSku[p.id]?.marcador} DOM=${dom.porSku[p.id]?.src} esperado=${esperadoAhora}`;
    }).slice(0, 10).join(' · '));
  const malosPrecios = vitrina.filter((p) => {
    const fila = dom.porSku[p.id];
    return !fila || digitos(fila.precioTexto) !== String(porSkuAutoridad.get(p.id).precio);
  });
  chequear(`${modo}: precio vigente por SKU = precioDeVenta (52/52)`,
    malosPrecios.length === 0, malosPrecios.map((p) => `${p.id}: DOM=${dom.porSku[p.id]?.precioTexto} esperado=${porSkuAutoridad.get(p.id).precio}`).slice(0, 6).join(' · '));
  const malasEdad = vitrina.filter((p) => {
    const fila = dom.porSku[p.id];
    return fila && fila.edad !== porSkuAutoridad.get(p.id).esAlcoholico;
  });
  chequear(`${modo}: etiqueta +18 presente SÓLO en los alcohólicos`,
    malasEdad.length === 0, malasEdad.map((p) => {
      const falta = porSkuAutoridad.get(p.id).esAlcoholico ? 'FALTA' : 'SOBRA';
      return `${p.id}:${falta}`;
    }).slice(0, 6).join(' · '));
  chequear(`${modo}: cero <img> con URL remota`, dom.urlsRemotas.length === 0, dom.urlsRemotas.slice(0, 4).join(' · '));
  return dom;
}

async function abrirCatalogo(page, { antes = false } = {}) {
  const erroresPagina = [];
  const respuestasMalas = [];
  page.on('pageerror', (error) => erroresPagina.push(error.message));
  page.on('response', (respuesta) => {
    const url = respuesta.url() || '';
    if (url.startsWith(BASE) && respuesta.status() >= 400) {
      respuestasMalas.push(`${respuesta.status()} ${url.replace(BASE, '')}`);
    }
  });

  await page.goto(urlCon(antes ? '&fotos=antes' : ''), { waitUntil: 'domcontentloaded', timeout: 30_000 });
  // ?reset=1 dispara la limpieza de sesión demo: la app arranca, borra el estado y
  // RECARGA sin el parámetro (app.js · maybeResetDemoSession). Toda evaluación
  // en el primer documento se pierde con "Execution context was destroyed":
  // esperar primero la URL canónica SIN reset, y recién ahí tocar la página.
  await page.waitForURL(
    (url) => url.searchParams.get('vitrina') === 'neuquen20261024' && !url.searchParams.has('reset'),
    { timeout: 20_000 },
  );
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('[data-view="home"]', { timeout: 30_000 });
  await page.evaluate(() => { window.location.hash = '#catalog'; });
  await esperarLayout(page, antes ? 400 : 150);
  return { erroresPagina, respuestasMalas };
}

const browser = await chromium.launch();
const summary = { esquema: 'qa-vitrina-neuquen-20261024', base: BASE, modos: {}, capturas: [] };
async function capturar(page, nombre, { fullPage = false } = {}) {
  await page.waitForTimeout(120);
  const archivo = path.join(CAPS_DIR, nombre);
  await page.screenshot({ path: archivo, fullPage });
  summary.capturas.push(path.relative(AQUI, archivo));
}

try {
  /* — MODO DESPUÉS · móvil 390 — */
  {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'es-AR', serviceWorkers: 'block',
    });
    const page = await context.newPage();
    const { erroresPagina, respuestasMalas } = await abrirCatalogo(page);
    const dom = reclamoGondola(await page.evaluate(inventarioDOM), 'después móvil 390');

    await capturar(page, 'despues-movil-home.png').catch(() => {});
    await page.evaluate(() => { window.location.hash = '#catalog'; });
    await page.waitForSelector('[data-view="catalog"]', { timeout: 10_000 });
    await capturar(page, 'despues-movil-gondola.png');

    // Las 42 fotos realmente decodificaron (no sólo pedidas).
    await scrollFull(page, 200);
    const fotosSinDecod = await page.evaluate(
      (ids) => ids.filter((id) => {
        const img = document.querySelector(`[data-card-product="${id}"] .thumb-img`);
        return !(img?.complete && img?.naturalWidth > 0);
      }),
      conFotoIds,
    );
    chequear('después: las 42 fotos cargaron (naturalWidth > 0)', fotosSinDecod.length === 0, fotosSinDecod.join(','));
    const placeholdersDecod = await page.evaluate(
      (ids) => ids.map((id) => {
        const img = document.querySelector(`[data-card-product="${id}"] .thumb-img`);
        return img?.complete && img?.naturalWidth > 0 ? 'cargada' : 'no';
      }),
      sinFotoIds,
    );
    chequear('después: los 10 placeholders se pintan con el SVG propio (naturalWidth > 0)',
      placeholdersDecod.every((m) => m === 'cargada'), placeholdersDecod.join(','));

    // Búsqueda: quedan sólo SKU relacionados con "coca", sin ruido.
    await escribirBusqueda(page, 'coca');
    await page.waitForFunction(
      (n) => document.querySelectorAll('[data-product-grid] article[data-card-product]').length !== n,
      52,
      { timeout: 15_000 },
    );
    await page.waitForTimeout(250);
    const vistaBusqueda = await page.evaluate(
      () => [...document.querySelectorAll('[data-product-grid] article[data-card-product]')]
        .map((tarjeta) => tarjeta.getAttribute('data-card-product')),
    );
    const busquedaCoherente = vistaBusqueda.length >= 3 && vistaBusqueda.every((sku) => {
      const fila = porSkuAutoridad.get(sku)?.fila;
      return /coca/i.test(sku) || (fila && /coca|cola/i.test(busquedaTexto(fila)));
    });
    chequear('después móvil: búsqueda "coca" filtra la góndola sin resultados ajenos',
      busquedaCoherente, `${vistaBusqueda.length}: ${vistaBusqueda.slice(0, 8).join(',')}`);
    await capturar(page, 'despues-movil-busqueda.png');

    // Limpiar búsqueda: vuelve la góndola completa.
    await escribirBusqueda(page, '');
    await page.waitForFunction(
      (n) => document.querySelectorAll('[data-product-grid] article[data-card-product]').length === n,
      52,
      { timeout: 15_000 },
    );

    // Chip de categoría: cervezas muestra SÓLO su categoría; "Todas" vuelve.
    await clickPrimero(page, '[data-view="catalog"] [data-category-id="cervezas"]');
    await page.waitForFunction(
      (n) => document.querySelectorAll('[data-product-grid] article[data-card-product]').length !== n,
      52,
      { timeout: 15_000 },
    );
    await page.waitForTimeout(250);
    const vistaCervezas = await page.evaluate(
      () => [...document.querySelectorAll('[data-product-grid] article[data-card-product]')]
        .map((tarjeta) => tarjeta.getAttribute('data-card-product')),
    );
    chequear('después móvil: chip Cervezas muestra exactamente su categoría',
      vistaCervezas.length === SKUS_CERVEZAS.length && vistaCervezas.every((sku) => SKUS_CERVEZAS.includes(sku)),
      `${vistaCervezas.length}/${SKUS_CERVEZAS.length}: ${vistaCervezas.slice(0, 8).join(',')}`);
    await capturar(page, 'despues-movil-categoria-cervezas.png');
    await clickPrimero(page, '[data-view="catalog"] [data-category-id="all"]');
    await page.waitForFunction(
      (n) => document.querySelectorAll('[data-product-grid] article[data-card-product]').length === n,
      52,
      { timeout: 15_000 },
    );

    // Alta al carrito con producto NO alcohólico y revisión del carrito.
    await clickPrimero(page, '[data-product-grid] [data-add-product="coca-cola-original-2250ml"]');
    await page.waitForFunction(
      () => (document.querySelector('[data-cart-count]')?.textContent || '').trim() === '1',
      null,
      { timeout: 10_000 },
    );
    const totalChico = digitos(await page.locator('[data-cart-total-small]').first().textContent());
    chequear('después móvil: sumar al carrito refleja el subtotal vigente',
      totalChico === String(porSkuAutoridad.get('coca-cola-original-2250ml').precio), `header=${totalChico}`);
    await page.evaluate(() => { window.location.hash = '#cart'; });
    await page.waitForSelector('[data-view="cart"] [data-cart-list] .cart-item', { timeout: 10_000 });
    const carrito = await page.evaluate(() => {
      const linea = document.querySelector('[data-cart-list] .cart-item .cart-line');
      const resumen = document.querySelector('[data-order-summary] .summary-row strong');
      const titulo = document.querySelector('[data-cart-list] .cart-item .cart-title');
      return {
        lineas: document.querySelectorAll('[data-cart-list] .cart-item').length,
        lineaTexto: linea?.textContent || '',
        subtotalTexto: resumen?.textContent || '',
        titulo: titulo?.textContent || '',
        overflow: Math.max(
          document.documentElement.scrollWidth - window.innerWidth,
          document.body.scrollWidth - window.innerWidth,
        ),
      };
    });
    chequear('después móvil: carrito 1 línea, título correcto, línea y subtotal en vigente',
      carrito.lineas === 1
        && /coca/i.test(carrito.titulo)
        && digitos(carrito.lineaTexto) === String(coca.price)
        && digitos(carrito.subtotalTexto) === String(coca.price),
      JSON.stringify(carrito));
    chequear('después móvil: sin overflow horizontal en el carrito', carrito.overflow <= 0, `overflow=${carrito.overflow}`);
    await capturar(page, 'despues-movil-carrito.png');

    // Ficha de producto: foto del SKU + precio vigente + aviso de alcohol (+18).
    await page.evaluate(() => { window.location.hash = '#catalog'; });
    await page.waitForFunction(
      (n) => document.querySelectorAll('[data-product-grid] article[data-card-product]').length === n,
      52,
      { timeout: 15_000 },
    );
    await clickPrimero(page, '[data-product-grid] [data-product-detail="gancia-lima-limon-lata-473ml"]');
    await page.waitForSelector('[data-modal-product-id="gancia-lima-limon-lata-473ml"]', { timeout: 10_000 });
    const ficha = await page.evaluate(() => {
      const media = document.querySelector('[data-modal-product-id] .modal-media');
      return {
        src: media?.querySelector('img')?.getAttribute('src') || '',
        marcador: media?.querySelector('.thumb')?.classList?.contains('has-photo') ? 'foto' : 'placeholder',
        precio: document.querySelector('[data-modal-product-id] .modal-price strong')?.textContent || '',
        alcohol: Boolean(document.querySelector('[data-modal-product-id] .product-alcohol-notice')),
        disponible: document.querySelector('[data-modal-product-id] .modal-availability')?.textContent || '',
        overflow: Math.max(
          document.documentElement.scrollWidth - window.innerWidth,
          document.body.scrollWidth - window.innerWidth,
        ),
      };
    });
    chequear('después móvil: ficha muestra LA foto de Gancia Lima Limón, precio vigente y aviso +18',
      ficha.src.endsWith(esperado.get('gancia-lima-limon-lata-473ml').thumb)
        && ficha.marcador === 'foto'
        && digitos(ficha.precio) === String(porSkuAutoridad.get('gancia-lima-limon-lata-473ml').precio)
        && ficha.alcohol === true
        && /disponible/i.test(ficha.disponible),
      JSON.stringify(ficha));
    chequear('después móvil: sin overflow horizontal (góndola + ficha)', dom.overflow <= 0 && ficha.overflow <= 0, `dom=${dom.overflow} ficha=${ficha.overflow}`);
    await capturar(page, 'despues-movil-ficha.png');
    await clickPrimero(page, '[data-modal-product-id] [data-close-modal]');
    await page.waitForTimeout(250);

    // Ficha del fallback: placeholder honesto, sin fingir foto.
    await clickPrimero(page, '[data-product-grid] [data-product-detail="quilmes-clasica-botella-710ml"]');
    await page.waitForSelector('[data-modal-product-id="quilmes-clasica-botella-710ml"]', { timeout: 10_000 });
    const fichaFallback = await page.evaluate(() => {
      const media = document.querySelector('[data-modal-product-id] .modal-media');
      return {
        marcador: media?.querySelector('.thumb')?.classList?.contains('uses-placeholder') ? 'placeholder' : 'foto',
        precio: document.querySelector('[data-modal-product-id] .modal-price strong')?.textContent || '',
      };
    });
    chequear('después móvil: ficha del SKU sin foto queda placeholder y con su precio vigente',
      fichaFallback.marcador === 'placeholder'
        && digitos(fichaFallback.precio) === String(porSkuAutoridad.get('quilmes-clasica-botella-710ml').precio),
      JSON.stringify(fichaFallback));
    await clickPrimero(page, '[data-modal-product-id] [data-close-modal]').catch(() => {});

    const sinFallosReq = respuestasMalas.filter((url) => !/favicon|\.map$/.test(url));
    chequear('después móvil 390: cero pageerrors', erroresPagina.length === 0, erroresPagina.join(' | '));
    chequear('después móvil 390: cero respuestas fallidas del propio servidor', sinFallosReq.length === 0, sinFallosReq.slice(0, 6).join(' · '));
    erroresPaginaTotal += erroresPagina.length;
    summary.modos.despuesMovil = { overflowGondola: dom.overflow, respuestasFallidas: respuestasMalas.length };
    await context.close();
  }

  /* — MODO DESPUÉS · desktop 1280 — */
  {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 920 }, locale: 'es-AR', serviceWorkers: 'block',
    });
    const page = await context.newPage();
    const { erroresPagina, respuestasMalas } = await abrirCatalogo(page);
    const escritorio = reclamoGondola(await page.evaluate(inventarioDOM), 'después desktop 1280');
    chequear('después desktop: sin overflow horizontal', escritorio.overflow <= 0, `overflow=${escritorio.overflow}`);
    chequear('después desktop 1280: cero pageerrors', erroresPagina.length === 0, erroresPagina.join(' | '));
    chequear('después desktop 1280: cero respuestas fallidas del propio servidor',
      respuestasMalas.filter((url) => !/favicon|\.map$/.test(url)).length === 0);
    erroresPaginaTotal += erroresPagina.length;
    await capturar(page, 'despues-desktop-gondola.png', { fullPage: true });
    await context.close();
  }

  /* — MODO ANTES (&fotos=antes) · móvil — */
  {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'es-AR', serviceWorkers: 'block',
    });
    const page = await context.newPage();
    const { erroresPagina } = await abrirCatalogo(page, { antes: true });
    const domAntes = reclamoGondola(await page.evaluate(inventarioDOM), 'antes móvil 390', { antes: true });
    const fotosEnAntes = await page.evaluate(
      (ids) => ids.filter((id) => {
        const img = document.querySelector(`[data-card-product="${id}"] .thumb-img`);
        return img && !img.classList.contains('is-placeholder');
      }),
      conFotoIds,
    );
    chequear('antes: CERO fotos aunque los datos traigan 42 SKU con foto', fotosEnAntes.length === 0, fotosEnAntes.join(','));
    chequear('antes móvil: sin overflow horizontal', domAntes.overflow <= 0, `overflow=${domAntes.overflow}`);
    chequear('antes móvil: cero pageerrors', erroresPagina.length === 0, erroresPagina.join(' | '));
    chequear('antes móvil: cero <img> con URL remota', domAntes.urlsRemotas.length === 0, domAntes.urlsRemotas.slice(0, 4).join(' · '));
    erroresPaginaTotal += erroresPagina.length;
    // La ficha también queda honesta en "antes".
    await clickPrimero(page, '[data-product-grid] [data-product-detail="gancia-lima-limon-lata-473ml"]');
    await page.waitForSelector('[data-modal-product-id="gancia-lima-limon-lata-473ml"]', { timeout: 10_000 });
    const fichaAntes = await page.evaluate(() => (document
      .querySelector('[data-modal-product-id] .modal-media')
      ?.querySelector('.thumb')?.classList?.contains('uses-placeholder') ? 'placeholder' : 'foto'));
    chequear('antes: la ficha del SKU con foto en datos queda placeholder', fichaAntes === 'placeholder', fichaAntes);
    await capturar(page, 'antes-movil-gondola.png');
    await context.close();
  }

  /* — MODO ANTES · desktop — */
  {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 920 }, locale: 'es-AR', serviceWorkers: 'block',
    });
    const page = await context.newPage();
    const { erroresPagina } = await abrirCatalogo(page, { antes: true });
    const domAntes = reclamoGondola(await page.evaluate(inventarioDOM), 'antes desktop 1280', { antes: true });
    chequear('antes desktop: sin overflow horizontal', domAntes.overflow <= 0, `overflow=${domAntes.overflow}`);
    chequear('antes desktop: cero pageerrors', erroresPagina.length === 0, erroresPagina.join(' | '));
    erroresPaginaTotal += erroresPagina.length;
    await capturar(page, 'antes-desktop-gondola.png', { fullPage: true });
    await context.close();
  }
} catch (errorEjecucion) {
  chequear('ejecución completa sin agotarse', false, `${errorEjecucion?.message || errorEjecucion}`);
} finally {
  await browser.close();
  chequear('cierre: cero pageerrors en las cuatro corridas', erroresPaginaTotal === 0, `total=${erroresPaginaTotal}`);
  escribirResultados();
  const ok = afirnaciones.filter((r) => r.ok).length;
  console.log(`QA vitrina Neuquén: ${ok}/${afirnaciones.length} afirmaciones OK.`);
  if (fallos.length) {
    console.error(`FALLOS (${fallos.length}):`);
    for (const fallo of fallos) console.error(`  ✗ ${fallo}`);
    console.log(`capturas: ${CAPS_DIR}`);
    console.log(`resultado: ${RESULT_JSON}`);
    process.exit(1);
  } else {
    console.log(`capturas: ${CAPS_DIR}`);
    console.log(`resultado: ${RESULT_JSON}`);
  }
}

/* ─────────────────────── 3 · Salida JSON ────────────────────────────────── */

function escribirResultados(etapa = 'completa') {
  try {
    writeFileSync(RESULT_JSON, JSON.stringify({
      esquema: 'qa-vitrina-neuquen-20261024',
      etapa,
      generadoEl: new Date().toISOString(),
      base: BASE,
      total: afirnaciones.length,
      ok: afirnaciones.filter((r) => r.ok).length,
      fallos,
      afirnaciones,
      capturas: summary?.capturas || [],
    }, null, 2));
  } catch (_) {
    // Si el JSON no se puede escribir, el exit-code y el stdout siguen siendo
    // la señal de verdad; no enmascarar un fallo con otro.
  }
}
