/*
 * Regresión de la candidata cliente: storefront comercial + carrito persistente
 * + mapa permanente en «Seguir», los tres en el MISMO árbol.
 *
 * Cada rama por separado ya tiene sus pruebas. Esto verifica lo que sólo puede
 * fallar cuando conviven: que el enrutado nuevo no rompa el montaje del mapa,
 * que el mapa permanente no reviva el cartel de arranque, que la barra inferior
 * siga en «Seguir» y que el lienzo se monte UNA sola vez a lo largo del pedido.
 *
 * A  cliente nuevo, sin pedidos → Seguir → mapa visible ya
 * B  agregar producto → recargar → el carrito sigue
 * E  arranque demorado y arranque caído → nunca UI técnica
 * F  ruta inválida → recuperación comercial + URL corregida
 * G  Seguir en idle / preparing / on_the_way / delivered → mapa en los cuatro
 *
 * (C y D —catálogo 503 y producto que deja de venderse— viven en
 * `tests/e2e/production-cart-persistence.spec.mjs`, que corre en los dos
 * motores: necesitan el backend productivo simulado y no se duplican acá.)
 *
 * En cada estado, además: overflow horizontal, CTA tapado por hit test real,
 * errores de consola, respuestas 4xx/5xx inesperadas, rider fantasma y barra
 * inferior. Capturas focales de Home, carrito, Perfil y los estados de Seguir.
 *
 * Uso:
 *   node scripts/realtime-relay.mjs 8231 &
 *   node scripts/taba2-candidata-cliente-regresion.mjs
 *
 * Variables: BASE, OUT, WIDTHS, ENGINE (chromium|webkit).
 */
import { chromium, webkit } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8231';
const OUT = path.resolve(process.env.OUT || 'artifacts/taba2-candidata-cliente');
const WIDTHS = (process.env.WIDTHS || '320,360,390,432').split(',').map(Number);
const ENGINE_NAME = process.env.ENGINE === 'webkit' ? 'webkit' : 'chromium';
const ENGINE = ENGINE_NAME === 'webkit' ? webkit : chromium;
const HEIGHTS = { 320: 720, 360: 800, 390: 844, 432: 960 };

// Ruido conocido del entorno local, no del producto: el relay de demo no sirve
// tiles ni fuentes de mapa, y el navegador reclama por el favicon.
const RUIDO_ESPERADO = [
  /favicon/i,
  /maplibre|tiles?\.|basemaps|openstreetmap|demotiles/i,
  /\/fonts?\//i,
  /Failed to load resource/i,
  /WebGL|webgl/i,
];
const esRuido = (texto) => RUIDO_ESPERADO.some((patron) => patron.test(String(texto)));

const fallas = [];
const lineas = [];
const anota = (linea) => { lineas.push(linea); console.log(linea); };
const falla = (linea) => { fallas.push(linea); anota(`   ✗ ${linea}`); };

/* Contrato de «Seguir»: mapa presente, y lo que se dibuja sale de datos. */
const PROBE_SEGUIR = () => {
  const vista = document.querySelector('[data-view="tracking"]');
  const nav = document.querySelector('.mobile-nav, [data-mobile-nav]');
  const navVisible = Boolean(nav && getComputedStyle(nav).display !== 'none'
    && getComputedStyle(nav).visibility !== 'hidden' && nav.getBoundingClientRect().height > 0);
  const mapas = vista ? [...vista.querySelectorAll('[data-real-map]')] : [];
  const lienzos = vista ? [...vista.querySelectorAll('[data-map-canvas]')] : [];
  const visible = (el) => {
    if (!el) return false;
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 1 && box.height > 1;
  };
  return {
    vistaActiva: Boolean(vista && !vista.hidden),
    mapas: mapas.length,
    mapaVisible: mapas.some(visible),
    lienzos: lienzos.length,
    riders: document.querySelectorAll('.map-marker-rider, [data-map-role="rider"], [data-rider-marker]').length,
    navVisible,
    estado: vista?.querySelector('[data-tracking-status]')?.dataset.trackingStatus
      || vista?.querySelector('.track-layout')?.dataset.trackingStatus || '',
    textoCrudo: /<[a-z/][^>]*>/i.test(vista?.innerText || ''),
    tecnico: /TABA2?-BOOT-\d+|undefined|\[object Object\]|NaN/.test(vista?.innerText || ''),
  };
};

/* CTA alcanzable: se lleva al centro y se toca. Mismo criterio que la
   auditoría responsive del storefront. */
const PROBE_ALCANCE = () => {
  const capa = document.querySelector('.modal-card:not([hidden])')
    || document.querySelector('.app-view:not([hidden])');
  if (!capa) return [];
  const nombre = (nodo) => {
    const clase = typeof nodo?.className === 'string' ? nodo.className.trim().split(/\s+/)[0] : '';
    return nodo ? `${nodo.tagName.toLowerCase()}${clase ? `.${clase}` : ''}` : 'nada';
  };
  const malos = [];
  capa.querySelectorAll('.primary-button, .secondary-button, [type="submit"], [data-add-product], [data-nav-view]').forEach((el) => {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') return;
    if (el.disabled || el.closest('[hidden]') || el.closest('details:not([open])')) return;
    const inicial = el.getBoundingClientRect();
    if (inicial.width < 1 || inicial.height < 1) return;
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    const box = el.getBoundingClientRect();
    const x = Math.min(Math.max(box.left + box.width / 2, 1), window.innerWidth - 1);
    const y = Math.min(Math.max(box.top + box.height / 2, 1), window.innerHeight - 1);
    const encima = document.elementFromPoint(x, y);
    if (encima && (encima === el || el.contains(encima) || encima.contains(el))) return;
    malos.push(`${nombre(el)} "${(el.textContent || '').trim().slice(0, 26)}" → ${nombre(encima)}`);
  });
  return [...new Set(malos)];
};

const browser = await ENGINE.launch();

for (const width of WIDTHS) {
  const dir = path.join(OUT, ENGINE_NAME, String(width));
  mkdirSync(dir, { recursive: true });
  anota(`\n## ${ENGINE_NAME} · ${width}px`);

  const context = await browser.newContext({
    viewport: { width, height: HEIGHTS[width] || 844 },
    deviceScaleFactor: 2,
    locale: 'es-AR',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const errores = [];
  const respuestasMalas = [];
  page.on('console', (mensaje) => {
    if (mensaje.type() === 'error' && !esRuido(mensaje.text())) errores.push(mensaje.text());
  });
  page.on('pageerror', (error) => errores.push(`pageerror: ${error.message}`));
  page.on('response', (respuesta) => {
    if (respuesta.status() >= 400 && !esRuido(respuesta.url())) {
      respuestasMalas.push(`${respuesta.status()} ${respuesta.url()}`);
    }
  });

  const foto = async (nombre) => {
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(dir, `${nombre}.png`) });
  };
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const revisar = async (etiqueta) => {
    const desborde = await overflow();
    if (desborde > 1) falla(`${etiqueta}: overflow ${desborde}px`);
    const tapados = await page.evaluate(PROBE_ALCANCE);
    tapados.forEach((t) => falla(`${etiqueta}: CTA tapado — ${t}`));
  };

  // ── A · cliente nuevo, sin pedidos, entra a Seguir ────────────────────────
  await page.goto(`${BASE}/?reset=1&demo=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-view="home"] .home-best-card', { timeout: 25_000 });
  await page.waitForTimeout(900);
  await foto('01-home');
  await revisar('home');

  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto(`${BASE}/?demo=1#tracking`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-view="tracking"]', { timeout: 20_000 });
  await page.waitForTimeout(1800);
  const sinPedido = await page.evaluate(PROBE_SEGUIR);
  anota(`   A · Seguir sin pedido → mapa=${sinPedido.mapas} visible=${sinPedido.mapaVisible} rider=${sinPedido.riders} barra=${sinPedido.navVisible} estado="${sinPedido.estado}"`);
  if (!sinPedido.mapaVisible) falla('A: un cliente sin pedidos no ve el mapa en Seguir');
  if (sinPedido.riders) falla(`A: rider fantasma sin pedido (${sinPedido.riders})`);
  if (!sinPedido.navVisible) falla('A: la barra inferior no está en Seguir');
  if (sinPedido.tecnico || sinPedido.textoCrudo) falla('A: Seguir muestra texto técnico o HTML crudo');
  await foto('02-seguir-sin-pedido');
  await revisar('seguir-sin-pedido');

  // ── B · agregar producto, recargar, el carrito sigue ──────────────────────
  await page.goto(`${BASE}/?reset=1&demo=1#catalog`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-product-grid] [data-add-product]:not([disabled])', { timeout: 20_000 });
  const agregables = page.locator('[data-product-grid] [data-add-product]:not([disabled])');
  const cuantos = Math.min(await agregables.count(), 2);
  for (let i = 0; i < cuantos; i += 1) {
    await agregables.nth(i).click({ timeout: 8000 });
    await page.waitForTimeout(300);
  }
  const antes = await page.evaluate(async () => {
    const { getState } = await import('/js/state.js');
    return getState().cart.length;
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1600);
  const despues = await page.evaluate(async () => {
    const { getState } = await import('/js/state.js');
    return getState().cart.length;
  });
  anota(`   B · carrito antes=${antes} después de recargar=${despues}`);
  if (!antes || despues !== antes) falla(`B: el carrito no sobrevivió la recarga (${antes} → ${despues})`);
  await page.evaluate(() => { window.location.hash = '#cart'; });
  await page.waitForTimeout(900);
  await foto('03-carrito');
  await revisar('carrito');

  await page.evaluate(() => { window.location.hash = '#profile'; });
  await page.waitForTimeout(1000);
  await foto('04-perfil');
  await revisar('perfil');

  // ── F · ruta inválida ─────────────────────────────────────────────────────
  await page.evaluate(() => { window.location.hash = '#no-existe-esta-ruta'; });
  await page.waitForTimeout(1200);
  const hash = await page.evaluate(() => window.location.hash);
  const avisa = await page.locator('.toast, [data-toast]').filter({ hasText: 'No encontramos esa página' }).count();
  anota(`   F · ruta inválida → hash="${hash}" aviso=${avisa}`);
  if (hash !== '#home') falla(`F: la URL quedó en "${hash}"`);
  if (!avisa) falla('F: la ruta inválida no avisó nada');
  await foto('05-ruta-invalida');

  // ── G · los cuatro estados de Seguir, contando montajes del lienzo ────────
  await page.goto(`${BASE}/?reset=1&demo=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-view="home"] .home-best-card', { timeout: 25_000 });
  /*
   * "Montado una sola vez" se mide por IDENTIDAD del nodo vivo, no contando
   * inserciones. `renderWithStableRealMap` reescribe el HTML del contenedor en
   * cada render y después trasplanta de vuelta el lienzo vivo: el markup
   * intermedio se inserta y se descarta sin recibir nunca una instancia de
   * mapa, así que contar inserciones da ocho y no significa nada. Lo que
   * importa es que el lienzo que sobrevive sea SIEMPRE el mismo objeto.
   */
  await page.evaluate(() => { window.__seq = 0; });

  const estados = [
    ['idle', async () => { await ir(page, 'tracking'); }],
    ['preparing', async () => { await sembrarPedido(page, 'preparing'); await ir(page, 'tracking'); }],
    ['on_the_way', async () => { await sembrarPedido(page, 'on_the_way'); await ir(page, 'tracking'); }],
    ['delivered', async () => { await sembrarPedido(page, 'delivered'); await ir(page, 'tracking'); }],
  ];

  const identidades = [];
  for (const [estado, correr] of estados) {
    await correr();
    // La sección entra con animación y el lienzo tarda un frame en tomar caja.
    // Se ESPERA a que la tome, con techo: si en cuatro segundos el mapa no
    // ocupa espacio, eso sí es el defecto que esta prueba busca, y el probe de
    // abajo lo reporta igual. Sin esta espera, medir a ciegas a los 1,6 s daba
    // un falso negativo en WebKit a 432 px.
    const espera = Date.now();
    await page.waitForFunction(() => {
      const shell = document.querySelector('[data-view="tracking"] [data-real-map]');
      return Boolean(shell) && shell.getBoundingClientRect().height > 1;
    }, null, { timeout: 4000 }).catch(() => {});
    const tardo = Date.now() - espera;
    await page.waitForTimeout(900);
    const r = await page.evaluate(PROBE_SEGUIR);
    if (tardo > 1500) anota(`   G · ${estado}: el mapa tardó ${tardo} ms en tomar caja`);
    identidades.push(await page.evaluate(() => {
      // El contador se inicializa acá y no antes: `?reset=1` puede recargar la
      // pestaña después de sembrarlo —en WebKit lo hace— y cualquier variable
      // puesta antes se pierde con la navegación.
      if (typeof window.__seq !== 'number') window.__seq = 0;
      const lienzo = document.querySelector('[data-view="tracking"] [data-map-canvas]');
      if (!lienzo) return 0;
      if (!lienzo.__tabaId) lienzo.__tabaId = (window.__seq += 1);
      return lienzo.__tabaId;
    }));
    anota(`   G · ${estado.padEnd(11)} → mapa=${r.mapas} visible=${r.mapaVisible} lienzos=${r.lienzos} rider=${r.riders} barra=${r.navVisible} lienzo#${identidades[identidades.length - 1]}`);
    if (!r.mapaVisible) falla(`G/${estado}: sin mapa visible`);
    if (r.mapas !== 1) falla(`G/${estado}: ${r.mapas} mapas en la vista, se espera 1`);
    if (!r.navVisible) falla(`G/${estado}: la barra inferior no está`);
    if (r.tecnico || r.textoCrudo) falla(`G/${estado}: texto técnico o HTML crudo`);
    if (estado !== 'on_the_way' && r.riders) falla(`G/${estado}: rider fantasma (${r.riders})`);
    await foto(`06-seguir-${estado}`);
    await revisar(`seguir-${estado}`);
  }

  const distintos = new Set(identidades.filter(Boolean)).size;
  anota(`   G · identidad del lienzo por estado: [${identidades.join(', ')}] → ${distintos} lienzo(s) distintos`);
  if (distintos !== 1) falla(`G: el lienzo se reemplazó entre estados (${distintos} nodos distintos); el contrato es uno solo`);

  if (errores.length) errores.forEach((e) => falla(`consola: ${e}`));
  if (respuestasMalas.length) respuestasMalas.forEach((r) => falla(`respuesta: ${r}`));
  await context.close();

  // ── E · arranque demorado y arranque caído ────────────────────────────────
  for (const [nombre, instalar, espera] of [
    ['demorado', async (p) => p.route('**/js/app.js*', async (route) => {
      await new Promise((resolve) => { setTimeout(resolve, 3000); });
      await route.continue();
    }), 1500],
    ['caido', async (p) => p.route('**/js/app.js*', (route) => route.fulfill({
      status: 503, contentType: 'text/javascript', body: '/* caído */',
    })), 9000],
  ]) {
    const ctx = await browser.newContext({
      viewport: { width, height: HEIGHTS[width] || 844 },
      deviceScaleFactor: 2,
      locale: 'es-AR',
      serviceWorkers: 'block',
    });
    const p = await ctx.newPage();
    await instalar(p);
    await p.goto(`${BASE}/?demo=1#home`, { waitUntil: 'commit' });
    await p.waitForTimeout(espera);
    const texto = await p.locator('body').innerText().catch(() => '');
    const panelVisible = await p.locator('[data-app-recovery]').isVisible().catch(() => false);
    anota(`   E · arranque ${nombre} → panel visible=${panelVisible}`);
    if (/TABA2?-BOOT-\d+/.test(texto)) falla(`E/${nombre}: se pinta un código interno`);
    if (/<[a-z/][^>]*>/i.test(texto)) falla(`E/${nombre}: HTML crudo a la vista`);
    if (/undefined|\[object Object\]|NaN/.test(texto)) falla(`E/${nombre}: valores internos a la vista`);
    if (nombre === 'demorado' && panelVisible) falla('E/demorado: el cartel aparece en una carga que iba a terminar bien');
    if (nombre === 'caido' && !panelVisible) falla('E/caido: no hay salida para el cliente');
    if (nombre === 'caido' && !texto.trim()) falla('E/caido: pantalla en blanco');
    await p.screenshot({ path: path.join(dir, `07-arranque-${nombre}.png`) });
    await ctx.close();
  }
}

await browser.close();
mkdirSync(OUT, { recursive: true });
const informe = `${lineas.join('\n')}\n\n${fallas.length ? `FALLAS (${fallas.length}):\n${fallas.map((f) => `  - ${f}`).join('\n')}` : 'SIN FALLAS'}\n`;
writeFileSync(path.join(OUT, `regresion-${ENGINE_NAME}.md`), informe, 'utf8');
console.log(`\n${fallas.length ? `FALLAS: ${fallas.length}` : 'SIN FALLAS'}`);
if (fallas.length) process.exitCode = 1;

async function ir(page, vista) {
  await page.evaluate((v) => { window.location.hash = `#${v}`; }, vista);
  await page.waitForTimeout(900);
}

/*
 * Siembra un pedido en el estado pedido usando el MISMO camino que la demo:
 * `setState` sobre el estado saneado. No inyecta geografía: el destino y el
 * recorrido salen de la sandbox, que es lo que la vista puede dibujar.
 */
async function sembrarPedido(page, status) {
  await page.evaluate(async (estado) => {
    const { getState, setState, normalizeOrderForStorage } = await import('/js/state.js');
    const actual = getState();
    const base = actual.orders[0];
    if (!base) return;
    const pedido = normalizeOrderForStorage({ ...base, status: estado });
    setState({ ...actual, orders: [pedido, ...actual.orders.slice(1)], lastOrderId: pedido.id });
  }, status);
  await page.waitForTimeout(600);
}
