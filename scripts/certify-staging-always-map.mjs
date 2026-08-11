/*
 * Certificación del cliente publicado en staging.
 *
 * Corre contra el sitio PÚBLICO en modo producción real —sin `?demo=1`, con la
 * base viva detrás—, que es el único lugar donde el gate significa algo: local
 * y demo ya están certificados, y lo que falta demostrar es que el artefacto
 * servido reproduce eso.
 *
 * Gate principal: cliente nuevo, sin pedidos, entra a «Seguir» y el mapa está.
 *
 * No crea pedidos, no toca la base, no confirma ningún checkout. Agregar al
 * carrito es enteramente del lado del cliente hasta que alguien paga.
 *
 * Uso:
 *   node scripts/certify-staging-always-map.mjs
 *   ENGINE=webkit node scripts/certify-staging-always-map.mjs
 *
 * Variables: BASE, OUT, WIDTHS, ENGINE (chromium|webkit).
 */
import { chromium, webkit } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const BASE = (process.env.BASE || 'https://taba2-staging.pages.dev').replace(/\/$/, '');
const OUT = path.resolve(process.env.OUT || 'artifacts/ci/staging-v61/certificacion');
const WIDTHS = (process.env.WIDTHS || '320,360,390,432').split(',').map(Number);
const ENGINE_NAME = process.env.ENGINE === 'webkit' ? 'webkit' : 'chromium';
const ENGINE = ENGINE_NAME === 'webkit' ? webkit : chromium;
const HEIGHTS = { 320: 720, 360: 800, 390: 844, 432: 960 };

// Ruido del entorno, no del producto: tiles y fuentes del mapa base vienen de
// un CDN externo, y el favicon no está publicado.
const RUIDO = [/favicon/i, /tiles?\.|basemaps|openstreetmap|demotiles|maplibre/i, /\/fonts?\//i, /\/glyphs?\//i, /sprite/i];
const esRuido = (t) => RUIDO.some((p) => p.test(String(t)));

const lineas = [];
const fallas = [];
const anota = (l) => { lineas.push(l); console.log(l); };
const falla = (l) => { fallas.push(l); anota(`   ✗ ${l}`); };

/*
 * Qué muestra «Seguir». Cada dato que se cuenta acá tiene que salir del DOM,
 * no de una promesa: rider dibujado, destino dibujado y ETA anunciada son
 * exactamente las tres cosas que el contrato de honestidad prohíbe inventar.
 */
const PROBE = () => {
  const vista = document.querySelector('[data-view="tracking"]');
  const nav = document.querySelector('.mobile-nav, [data-mobile-nav]');
  const vis = (el) => {
    if (!el) return false;
    const s = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && b.width > 1 && b.height > 1;
  };
  const texto = vista?.innerText || '';
  return {
    hayVista: Boolean(vista && !vista.hidden),
    mapas: vista ? vista.querySelectorAll('[data-real-map]').length : 0,
    mapaVisible: vista ? [...vista.querySelectorAll('[data-real-map]')].some(vis) : false,
    lienzoPintado: Boolean(vista?.querySelector('[data-map-canvas] canvas, [data-map-canvas] .maplibregl-canvas')),
    negocio: document.querySelectorAll('[data-map-role*="business"], .map-marker-business').length,
    rider: document.querySelectorAll('.map-marker-rider, [data-map-role="rider"], [data-rider-marker]').length,
    destino: document.querySelectorAll('.map-marker-destination, [data-map-role="destination"]').length,
    eta: /\b\d+\s*(min|minutos)\b/i.test(texto),
    recentrar: vista ? vista.querySelectorAll('[data-map-recenter]:not([hidden])').length : 0,
    navVisible: vis(nav),
    estado: vista?.querySelector('[data-tracking-status]')?.dataset.trackingStatus
      || vista?.querySelector('.track-layout')?.dataset.trackingStatus || '',
    tarjetaIdle: /Seguí tu pedido|Cuando hagas una compra/i.test(texto),
    tecnico: /TABA2?-BOOT-\d+|undefined|\[object Object\]|NaN/.test(texto),
    htmlCrudo: /<[a-z/][^>]*>/i.test(texto),
  };
};

const PROBE_ALCANCE = () => {
  const capa = document.querySelector('.modal-card:not([hidden])') || document.querySelector('.app-view:not([hidden])');
  if (!capa) return [];
  const nom = (n) => {
    const c = typeof n?.className === 'string' ? n.className.trim().split(/\s+/)[0] : '';
    return n ? `${n.tagName.toLowerCase()}${c ? `.${c}` : ''}` : 'nada';
  };
  const malos = [];
  capa.querySelectorAll('.primary-button, .secondary-button, [type="submit"], [data-add-product], [data-nav-view]').forEach((el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.pointerEvents === 'none') return;
    if (el.disabled || el.closest('[hidden]') || el.closest('details:not([open])')) return;
    if (el.getBoundingClientRect().width < 1) return;
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    const b = el.getBoundingClientRect();
    const x = Math.min(Math.max(b.left + b.width / 2, 1), window.innerWidth - 1);
    const y = Math.min(Math.max(b.top + b.height / 2, 1), window.innerHeight - 1);
    const arriba = document.elementFromPoint(x, y);
    if (arriba && (arriba === el || el.contains(arriba) || arriba.contains(el))) return;
    malos.push(`${nom(el)} "${(el.textContent || '').trim().slice(0, 24)}" → ${nom(arriba)}`);
  });
  return [...new Set(malos)];
};

const browser = await ENGINE.launch();

for (const width of WIDTHS) {
  const dir = path.join(OUT, ENGINE_NAME, String(width));
  mkdirSync(dir, { recursive: true });
  anota(`\n## ${ENGINE_NAME} · ${width}px · ${BASE}`);

  // Contexto nuevo = navegador en incógnito: sin storage, sin worker, sin nada.
  const context = await browser.newContext({
    viewport: { width, height: HEIGHTS[width] || 844 },
    deviceScaleFactor: 2,
    locale: 'es-AR',
  });
  const page = await context.newPage();
  const errores = [];
  const malas = [];
  page.on('console', (m) => { if (m.type() === 'error' && !esRuido(m.text())) errores.push(m.text()); });
  page.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400 && !esRuido(r.url())) malas.push(`${r.status()} ${r.url()}`); });

  const foto = async (n) => { await page.waitForTimeout(700); await page.screenshot({ path: path.join(dir, `${n}.png`) }); };
  const revisar = async (etq) => {
    const d = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (d > 1) falla(`${etq}: overflow ${d}px`);
    (await page.evaluate(PROBE_ALCANCE)).forEach((t) => falla(`${etq}: CTA tapado — ${t}`));
  };
  /*
   * Esperar a que el mapa esté PINTADO, no a que exista la caja.
   *
   * Local sirve las teselas desde el disco y pinta en un par de frames;
   * staging las trae de un CDN externo y tarda segundos. Medir a los 1,2 s
   * fotografiaba un rectángulo vacío y lo reportaba como "el mapa no aparece",
   * que era falso. Se espera a que dejen de llegar teselas y se registra
   * cuánto tardó, porque ese número es lo que ve una persona.
   */
  const esperarMapa = async () => {
    const arranque = Date.now();
    await page.waitForFunction(() => {
      const s = document.querySelector('[data-view="tracking"] [data-real-map]');
      return Boolean(s) && s.getBoundingClientRect().height > 1;
    }, null, { timeout: 10_000 }).catch(() => {});
    let ultimaTesela = Date.now();
    const escucha = (r) => { if (/openfreemap|\.pbf|tiles?\./.test(r.url())) ultimaTesela = Date.now(); };
    page.on('response', escucha);
    const techo = Date.now() + 20_000;
    while (Date.now() < techo && Date.now() - ultimaTesela < 1800) {
      await page.waitForTimeout(300);
    }
    page.off('response', escucha);
    await page.waitForTimeout(600);
    return Date.now() - arranque;
  };

  /*
   * ¿El lienzo tiene un mapa o es un rectángulo liso? Se mide la desviación
   * estándar de la región del mapa en la captura: una calle, un río y una
   * etiqueta dan varianza; un rectángulo plano no da ninguna.
   */
  const mapaTieneContenido = async (archivo) => {
    const caja = await page.locator('[data-view="tracking"] [data-map-canvas]').first().boundingBox().catch(() => null);
    if (!caja || caja.width < 10 || caja.height < 10) return { ok: false, motivo: 'sin caja de lienzo' };
    const escala = 2;
    const { channels } = await sharp(archivo)
      .extract({
        left: Math.round(caja.x * escala) + 4,
        top: Math.round(caja.y * escala) + 4,
        width: Math.round(caja.width * escala) - 8,
        height: Math.round(caja.height * escala) - 8,
      })
      .stats();
    const desvio = Math.max(...channels.map((c) => c.stdev));
    return { ok: desvio > 6, desvio: Number(desvio.toFixed(2)) };
  };

  // ── GATE PRINCIPAL · cliente nuevo, sin pedidos, toca «Seguir» ────────────
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const modo = await page.evaluate(() => document.body.dataset.appMode);
  anota(`   modo de la app servida: ${modo}`);
  if (modo !== 'production') falla(`la app servida no está en producción (modo="${modo}")`);
  await foto('01-home');
  await revisar('home');

  // Se entra por la barra, como entra una persona.
  const navSeguir = page.locator('.mobile-nav [data-nav-view="tracking"]');
  if (await navSeguir.count()) await navSeguir.first().click();
  else await page.evaluate(() => { window.location.hash = '#tracking'; });
  const tardo = await esperarMapa();

  const g = await page.evaluate(PROBE);
  const verificada = await page.evaluate(async () => {
    const { getBusinessConfig } = await import('/js/core/business-config-store.js');
    return Boolean(getBusinessConfig().businessLocationVerified);
  });
  anota(`   GATE · mapa=${g.mapas} visible=${g.mapaVisible} lienzo=${g.lienzoPintado} negocio=${g.negocio} rider=${g.rider} destino=${g.destino} eta=${g.eta} barra=${g.navVisible} estado="${g.estado}" tarjetaIdle=${g.tarjetaIdle} · pintó en ${tardo} ms`);
  if (!g.mapaVisible) falla('GATE: un cliente sin pedidos NO ve el mapa en Seguir');
  if (!g.lienzoPintado) falla('GATE: el lienzo del mapa no llegó a pintarse');
  /*
   * El pin del negocio se EXIGE sólo si la ubicación está publicada como
   * verificada. Hoy staging la sirve sin verificar (`human_verified=false` en
   * el contrato de ubicación), y dibujarla igual sería inventar geografía:
   * exactamente lo que prohíben las tres líneas siguientes de este mismo gate.
   * El contexto del negocio se cumple por la píldora y por el encuadre.
   */
  anota(`   GATE · ubicación del negocio publicada como verificada: ${verificada}`);
  if (verificada && !g.negocio) falla('GATE: la ubicación está verificada y aun así no se dibuja el pin del negocio');
  if (!verificada && g.negocio) falla('GATE: se dibuja un pin de una ubicación NO verificada');
  const pildoraNombra = await page.evaluate(() => /taba/i.test(document.querySelector('[data-map-meta-text]')?.textContent || ''));
  if (!pildoraNombra) falla('GATE: la píldora del mapa no declara de qué negocio es este mapa');
  if (g.rider) falla(`GATE: rider inventado (${g.rider})`);
  if (g.destino) falla(`GATE: destino inventado (${g.destino})`);
  if (g.eta) falla('GATE: ETA inventada sin pedido');
  if (g.recentrar) falla(`GATE: control de recentrar sin rider (${g.recentrar})`);
  if (!g.navVisible) falla('GATE: la barra inferior no está en Seguir');
  if (!g.tarjetaIdle) falla('GATE: falta la tarjeta idle que explica qué va a pasar');
  if (g.tecnico || g.htmlCrudo) falla('GATE: texto técnico o HTML crudo en Seguir');
  await foto('02-seguir-sin-pedido');
  const contenido = await mapaTieneContenido(path.join(dir, '02-seguir-sin-pedido.png'));
  anota(`   GATE · el lienzo tiene mapa dibujado: ${contenido.ok} (desvío ${contenido.desvio ?? contenido.motivo})`);
  if (!contenido.ok) falla('GATE: el lienzo está pintado pero vacío — el cliente ve un rectángulo liso, no un mapa');
  await revisar('seguir-sin-pedido');

  // ── salida de Seguir por la barra ─────────────────────────────────────────
  const navCatalogo = page.locator('.mobile-nav [data-nav-view="catalog"]');
  if (await navCatalogo.count()) {
    await navCatalogo.first().click();
    await page.waitForTimeout(1200);
    const vista = await page.evaluate(() => document.body.dataset.activeView);
    anota(`   salida de Seguir por la barra → vista="${vista}"`);
    if (vista !== 'catalog') falla(`salida de Seguir: quedó en "${vista}"`);
  } else falla('no hay barra inferior para salir de Seguir');

  // ── carrito productivo: agregar → recargar → sigue ────────────────────────
  await page.evaluate(() => { window.location.hash = '#catalog'; });
  await page.waitForTimeout(2000);
  const agregables = page.locator('[data-product-grid] [data-add-product]:not([disabled])');
  const hay = await agregables.count();
  if (!hay) {
    falla('el catálogo verificado no ofreció ningún producto comprable: no se pudo probar el carrito');
  } else {
    await agregables.first().click({ timeout: 8000 });
    await page.waitForTimeout(800);
    const antes = await page.evaluate(async () => (await import('/js/state.js')).getState().cart.length);
    const guardado = await page.evaluate(() => localStorage.getItem('la_taba_production_cart_v1'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const despues = await page.evaluate(async () => (await import('/js/state.js')).getState().cart.length);
    anota(`   carrito productivo: antes=${antes} después de recargar=${despues} · clave ${guardado ? 'escrita' : 'AUSENTE'}`);
    if (!antes) falla('no se pudo sembrar el carrito en producción');
    else if (despues !== antes) falla(`el carrito productivo no sobrevivió la recarga (${antes} → ${despues})`);
    if (!guardado) falla('no se escribió la clave del carrito productivo');
    await page.evaluate(() => { window.location.hash = '#cart'; });
    await page.waitForTimeout(1500);
    await foto('03-carrito');
    await revisar('carrito');
  }

  // ── los cuatro estados de Seguir ──────────────────────────────────────────
  const identidades = [];
  for (const estado of ['idle', 'preparing', 'on_the_way', 'delivered']) {
    const sembrado = estado === 'idle' ? true : await sembrar(page, estado);
    await page.evaluate(() => { window.location.hash = '#tracking'; });
    await esperarMapa();
    const r = await page.evaluate(PROBE);
    identidades.push(await page.evaluate(() => {
      if (typeof window.__seq !== 'number') window.__seq = 0;
      const l = document.querySelector('[data-view="tracking"] [data-map-canvas]');
      if (!l) return 0;
      if (!l.__id) l.__id = (window.__seq += 1);
      return l.__id;
    }));
    anota(`   ${estado.padEnd(11)} → sembrado=${sembrado} mapa=${r.mapas} visible=${r.mapaVisible} negocio=${r.negocio} rider=${r.rider} estado="${r.estado}" barra=${r.navVisible} lienzo#${identidades[identidades.length - 1]}`);
    if (!sembrado) { falla(`${estado}: no se pudo poner el pedido en ese estado`); continue; }
    if (!r.mapaVisible) falla(`${estado}: sin mapa visible`);
    if (r.mapas !== 1) falla(`${estado}: ${r.mapas} mapas en la vista`);
    if (!r.navVisible) falla(`${estado}: la barra inferior no está`);
    if (r.tecnico || r.htmlCrudo) falla(`${estado}: texto técnico o HTML crudo`);
    // Sin GPS real no puede haber rider dibujado en NINGUNO de los estados:
    // el arnés cambia el estado del pedido y no inventa una posición.
    if (r.rider) falla(`${estado}: rider dibujado sin GPS real (${r.rider})`);
    await foto(`04-seguir-${estado}`);
    const dibujado = await mapaTieneContenido(path.join(dir, `04-seguir-${estado}.png`));
    if (!dibujado.ok) falla(`${estado}: el lienzo quedó liso (desvío ${dibujado.desvio ?? dibujado.motivo})`);
    await revisar(`seguir-${estado}`);
  }
  const distintos = new Set(identidades.filter(Boolean)).size;
  anota(`   identidad del lienzo por estado: [${identidades.join(', ')}] → ${distintos} distinto(s)`);
  if (distintos > 1) falla(`el lienzo se reemplazó entre estados (${distintos} nodos)`);

  errores.forEach((e) => falla(`consola: ${e}`));
  malas.forEach((r) => falla(`respuesta: ${r}`));
  await context.close();
}

// ── cliente recurrente: worker instalado, caché vieja, segunda visita ───────
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-AR' });
  const page = await context.newPage();
  anota(`\n## ${ENGINE_NAME} · cliente recurrente (service worker activo)`);

  /*
   * El orden importa y es el que rompe la prueba si se invierte.
   *
   * Un cliente recurrente llega con la caché de la versión ANTERIOR ya en el
   * disco y sin worker nuevo todavía; recién entonces el worker nuevo instala
   * y su `activate` la barre. Si la caché vieja se planta DESPUÉS de que el
   * worker activó, `activate` ya corrió y no vuelve a correr: la caché queda,
   * y eso no dice nada del producto —dice que la prueba llegó tarde—.
   *
   * Por eso se planta sobre una URL del mismo origen que NO registra worker
   * (el manifiesto), y recién después se entra a la aplicación.
   */
  await page.goto(`${BASE}/manifest.webmanifest`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    const vieja = await caches.open('la-taba-runtime-v60-seguimiento-sin-replay');
    await vieja.put('/index.html', new Response('<html>artefacto viejo</html>', { headers: { 'content-type': 'text/html' } }));
  });
  const plantada = await page.evaluate(() => caches.keys());
  anota(`   cachés antes de entrar: ${JSON.stringify(plantada)}`);

  // Primera visita real: acá instala y activa el worker nuevo.
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => navigator.serviceWorker?.controller || performance.now() > 20000, null, { timeout: 25_000 }).catch(() => {});
  await page.waitForTimeout(5000);

  // Segunda visita: es el cliente que vuelve.
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.waitForTimeout(4000);
  const estadoSW = await page.evaluate(async () => ({
    controlado: Boolean(navigator.serviceWorker?.controller),
    caches: await caches.keys(),
    versionApp: [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')).find((s) => s.includes('app.js')) || '',
  }));
  anota(`   controlado por worker=${estadoSW.controlado} · cachés=${JSON.stringify(estadoSW.caches)} · ${estadoSW.versionApp}`);
  if (!estadoSW.versionApp.includes('?v=41')) falla(`cliente recurrente: sigue cargando ${estadoSW.versionApp}`);
  const viejas = estadoSW.caches.filter((k) => k.startsWith('la-taba-runtime-') && k !== 'la-taba-runtime-v61-cliente-comercial-mapa-permanente');
  if (estadoSW.controlado && viejas.length) falla(`cliente recurrente: quedaron cachés viejas ${JSON.stringify(viejas)}`);

  await page.evaluate(() => { window.location.hash = '#tracking'; });
  await page.waitForFunction(() => {
    const s = document.querySelector('[data-view="tracking"] [data-real-map]');
    return Boolean(s) && s.getBoundingClientRect().height > 1;
  }, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const r = await page.evaluate(PROBE);
  anota(`   recurrente en Seguir → mapa=${r.mapas} visible=${r.mapaVisible} negocio=${r.negocio} rider=${r.rider} barra=${r.navVisible}`);
  if (!r.mapaVisible) falla('cliente recurrente: no ve el mapa en Seguir');
  if (r.rider) falla('cliente recurrente: rider inventado');
  mkdirSync(path.join(OUT, ENGINE_NAME), { recursive: true });
  await page.screenshot({ path: path.join(OUT, ENGINE_NAME, 'recurrente-seguir-sin-pedido.png') });
  await context.close();
}

await browser.close();
mkdirSync(OUT, { recursive: true });
writeFileSync(
  path.join(OUT, `certificacion-${ENGINE_NAME}.md`),
  `${lineas.join('\n')}\n\n${fallas.length ? `FALLAS (${fallas.length}):\n${fallas.map((f) => `  - ${f}`).join('\n')}` : 'SIN FALLAS'}\n`,
  'utf8',
);
console.log(`\n${fallas.length ? `FALLAS: ${fallas.length}` : 'SIN FALLAS'}`);
if (fallas.length) process.exitCode = 1;

/*
 * Pone el pedido activo en un estado. No toca la base: escribe el estado en
 * memoria del cliente, que es lo que la vista lee para decidir qué capas
 * dibuja. Deliberadamente NO inventa una posición del rider.
 */
async function sembrar(page, status) {
  return page.evaluate(async (estado) => {
    const { getState, setState, normalizeOrderForStorage } = await import('/js/state.js');
    const actual = getState();
    const base = actual.orders[0] || {
      id: 'LT-STAGING-GATE',
      code: 'LT-STAGING-GATE',
      createdAt: new Date().toISOString(),
      items: [],
      total: 0,
      deliveryMode: 'delivery',
      customerName: 'Gate',
      customerPhone: '2990000000',
    };
    const pedido = normalizeOrderForStorage({ ...base, id: base.id, status: estado });
    if (!pedido) return false;
    setState({ ...actual, orders: [pedido], lastOrderId: pedido.id });
    const despues = getState();
    return despues.orders[0]?.status === estado;
  }, status);
}
