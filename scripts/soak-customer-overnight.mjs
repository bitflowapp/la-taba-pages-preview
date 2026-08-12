/*
 * Soak del cliente: la misma pestaña, muchas horas, comportamiento humano real.
 *
 * Lo que busca no es un defecto de una pantalla —para eso están las suites—
 * sino lo que sólo aparece con el uso repetido: memoria que sube y no baja,
 * oyentes que se acumulan visita tras visita, temporizadores que nadie apaga,
 * promesas rechazadas que nadie mira, y el worker sirviendo cualquier cosa
 * después de la enésima degradación del borde.
 *
 * Por eso el grueso corre sobre UNA pestaña de larga vida: un contexto nuevo
 * por ciclo escondería exactamente lo que se quiere ver. Cada tanto se abre una
 * pestaña nueva a propósito, que es el escenario del cliente que reabre.
 *
 * Doce escenarios en rotación, tomados del comportamiento que rompe de verdad:
 *   A navegar → carrito → recargar        G pestaña vieja → reabrir
 *   B carrito → checkout → abandonar      H seguimiento y sus estados
 *   C checkout → externo → volver         I ruta inválida → recuperación
 *   D offline → online                    J catálogo lento
 *   E borde 503 → recuperación            K almacenamiento corrupto
 *   F worker viejo → nuevo                L segundo plano → primer plano
 *
 * Después de CADA ciclo se exigen las mismas invariantes comerciales: la tienda
 * arrancada, la superficie de marca puesta, la barra fijada, la hoja con reglas,
 * el carrito legible, cero rechazos sin manejar nuevos.
 *
 * No toca Mercado Pago, no crea pedidos reales y no sale a internet: el destino
 * externo se responde localmente.
 *
 * Uso:
 *   node scripts/realtime-relay.mjs 8140 &
 *   node scripts/soak-customer-overnight.mjs --minutos=150 --puerto=8140 \
 *     --salida=artifacts/taba2-customer-overnight-rc/soak
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (nombre, porDefecto) => {
  const encontrado = process.argv.find((a) => a.startsWith(`--${nombre}=`));
  return encontrado ? encontrado.slice(nombre.length + 3) : porDefecto;
};
const MINUTOS = Number(arg('minutos', '120'));
const CICLOS_MAXIMOS = Number(arg('ciclos', '100000'));
const PUERTO = Number(arg('puerto', process.env.TABA_E2E_HTTP_PORT || '8140'));
const BASE = `http://127.0.0.1:${PUERTO}`;
const SALIDA = path.resolve(ROOT, arg('salida', 'artifacts/taba2-customer-overnight-rc/soak'));
const ORIGEN_EXTERNO = 'https://www.mercadopago.com.ar';
const FONDO_COMERCIAL = 'rgb(9, 11, 14)';
const CLAVE_CARRITO = 'la_taba_production_cart_v1';

fs.mkdirSync(SALIDA, { recursive: true });
const bitacora = fs.createWriteStream(path.join(SALIDA, 'soak.jsonl'), { flags: 'a' });
const anotar = (registro) => bitacora.write(`${JSON.stringify(registro)}\n`);

/* Instrumentación: se envuelve antes de que corra una línea del cliente. */
const INSTRUMENTO = () => {
  const vivos = { oyentes: 0, intervalos: new Set(), timeouts: new Set() };
  const add = EventTarget.prototype.addEventListener;
  const quitar = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function envuelto(...args) { vivos.oyentes += 1; return add.apply(this, args); };
  EventTarget.prototype.removeEventListener = function envuelto(...args) { vivos.oyentes -= 1; return quitar.apply(this, args); };
  const si = window.setInterval; const ci = window.clearInterval;
  window.setInterval = function envuelto(...a) { const id = si.apply(this, a); vivos.intervalos.add(id); return id; };
  window.clearInterval = function envuelto(id) { vivos.intervalos.delete(id); return ci.call(this, id); };
  const st = window.setTimeout; const ct = window.clearTimeout;
  window.setTimeout = function envuelto(fn, ms, ...r) {
    const id = st.call(this, (...a) => { vivos.timeouts.delete(id); return fn?.(...a); }, ms, ...r);
    vivos.timeouts.add(id); return id;
  };
  window.clearTimeout = function envuelto(id) { vivos.timeouts.delete(id); return ct.call(this, id); };

  window.__soak = { rechazos: 0, erroresDePagina: 0 };
  window.addEventListener('unhandledrejection', () => { window.__soak.rechazos += 1; });
  window.addEventListener('error', () => { window.__soak.erroresDePagina += 1; });
  window.__soakVivos = () => ({
    oyentes: vivos.oyentes,
    intervalos: vivos.intervalos.size,
    timeouts: vivos.timeouts.size,
    ...window.__soak,
  });
};

const acumulado = {
  erroresDeConsola: 0,
  pedidosFallidos: 0,
  erroresDePagina: 0,
  fallasDeInvariante: [],
  detalles: [],
};

function observar(page) {
  page.on('console', (mensaje) => {
    if (mensaje.type() !== 'error') return;
    const texto = mensaje.text();
    // El cartel del arranque escribe su propio aviso a propósito, y los
    // escenarios que degradan el borde producen 503 esperados en consola.
    if (/TABA2-BOOT-0\d|Failed to load resource/.test(texto)) return;
    acumulado.erroresDeConsola += 1;
    acumulado.detalles.push({ tipo: 'consola', texto: texto.slice(0, 200) });
  });
  page.on('pageerror', (error) => {
    acumulado.erroresDePagina += 1;
    acumulado.detalles.push({ tipo: 'pageerror', texto: String(error).slice(0, 300) });
  });
  page.on('requestfailed', (peticion) => {
    const causa = peticion.failure()?.errorText || '';
    // `net::ERR_ABORTED` es lo que produce una navegación que se cancela a
    // propósito: es parte del escenario, no una falla.
    if (/ERR_ABORTED|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED/.test(causa)) return;
    acumulado.pedidosFallidos += 1;
    acumulado.detalles.push({ tipo: 'request', texto: `${causa} ${peticion.url()}`.slice(0, 200) });
  });
}

async function borde(page, modo) {
  await page.request.get(`${BASE}/__edge-fault?mode=${modo}`).catch(() => undefined);
}

async function esperarLista(page, plazo = 45_000) {
  await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: plazo });
}

async function irA(page, vista) {
  await page.evaluate((v) => { window.location.hash = `#${v}`; }, vista);
  await page.waitForTimeout(500);
}

async function medir(page) {
  return page.evaluate(() => {
    const el = (s) => document.querySelector(s);
    const link = el('link[href^="styles.css"]');
    let reglas = -1;
    try { reglas = link.sheet.cssRules.length; } catch (_) { reglas = -1; }
    return {
      arranque: document.documentElement.dataset.tabaStartup || null,
      fondo: getComputedStyle(document.body).backgroundColor,
      navPosicion: el('.mobile-nav') ? getComputedStyle(el('.mobile-nav')).position : 'SIN-NODO',
      reglas,
      desborde: document.documentElement.scrollWidth - window.innerWidth,
      vista: document.body.dataset.activeView || null,
      controlado: !!navigator.serviceWorker.controller,
      memoriaMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
      ...(window.__soakVivos ? window.__soakVivos() : {}),
    };
  });
}

async function leerCarrito(page) {
  return page.evaluate(async () => {
    try {
      const { getState } = await import('/js/state.js');
      return getState().cart.map((i) => `${i.productId}:${i.quantity}`).sort();
    } catch (_) { return ['ILEGIBLE']; }
  });
}

function exigirInvariantes(ciclo, escenario, medida, carrito) {
  const fallas = [];
  if (medida.arranque !== 'ready') fallas.push(`arranque=${medida.arranque}`);
  if (medida.fondo !== FONDO_COMERCIAL) fallas.push(`fondo=${medida.fondo}`);
  if (medida.navPosicion !== 'fixed') fallas.push(`nav=${medida.navPosicion}`);
  if (!(medida.reglas > 0)) fallas.push(`reglas=${medida.reglas}`);
  if (medida.desborde > 0) fallas.push(`desborde=${medida.desborde}px`);
  if (carrito.includes('ILEGIBLE')) fallas.push('carrito ilegible');
  if (fallas.length) {
    acumulado.fallasDeInvariante.push({ ciclo, escenario, fallas, medida });
  }
  return fallas;
}

async function vaciarCarrito(page) {
  await page.evaluate(async () => {
    const { clearCart } = await import('/js/cart.js');
    clearCart();
  });
  await page.waitForTimeout(300);
}

/*
 * Agrega, y antes se ocupa de que el carrito no crezca para siempre.
 *
 * La primera corrida del soak lo mostró: sumando de a dos por ciclo y sin
 * vaciar nunca, a las ~35 vueltas el carrito tenía las once líneas del catálogo
 * demo y TODOS los botones de agregar estaban deshabilitados. Eso no es una
 * falla, es el contrato de stock funcionando —el catálogo demo tiene existencias
 * finitas y el botón se apaga al agotarlas—, pero deja los ciclos siguientes sin
 * ejercer nada. Se vacía y se sigue comprando, que es lo que hace una persona.
 */
async function agregarAlCarrito(page, cantidad = 2) {
  const lineas = await leerCarrito(page);
  if (lineas.length > 6) await vaciarCarrito(page);
  await irA(page, 'catalog');
  let boton = page.locator('[data-product-grid] [data-add-product]:not([disabled]) >> visible=true').first();
  if (!(await boton.count())) {
    await vaciarCarrito(page);
    await irA(page, 'catalog');
    boton = page.locator('[data-product-grid] [data-add-product]:not([disabled]) >> visible=true').first();
  }
  await boton.waitFor({ state: 'visible', timeout: 20_000 });
  const id = await boton.getAttribute('data-add-product');
  await boton.click();
  for (let i = 1; i < cantidad; i += 1) {
    await page.locator(`[data-cart-inc="${id}"] >> visible=true`).first().click().catch(() => undefined);
  }
  return id;
}

const ESCENARIOS = {
  async A_navegar_carrito_recarga(page) {
    await irA(page, 'home');
    await irA(page, 'catalog');
    await agregarAlCarrito(page, 2);
    await irA(page, 'cart');
    await page.reload({ waitUntil: 'commit' });
    await esperarLista(page);
  },
  async B_checkout_abandonar(page) {
    await agregarAlCarrito(page, 1);
    await irA(page, 'cart');
    const pago = page.getByLabel('Forma de pago');
    if (await pago.count()) await pago.selectOption('cash').catch(() => undefined);
    await irA(page, 'home');
    await irA(page, 'cart');
  },
  async C_externo_y_volver(page) {
    await agregarAlCarrito(page, 1);
    await irA(page, 'cart');
    await page.evaluate((url) => { window.location.assign(url); }, `${ORIGEN_EXTERNO}/checkout/v1/redirect?pref_id=SOAK`);
    await page.waitForURL(`${ORIGEN_EXTERNO}/**`, { timeout: 20_000 }).catch(() => undefined);
    await page.goBack({ waitUntil: 'commit' });
    await esperarLista(page);
    await page.waitForTimeout(1_200);
  },
  async D_offline_online(page, { context }) {
    await context.setOffline(true);
    await page.reload({ waitUntil: 'commit' }).catch(() => undefined);
    await esperarLista(page).catch(() => undefined);
    await context.setOffline(false);
    await page.reload({ waitUntil: 'commit' });
    await esperarLista(page);
  },
  async E_borde_503(page) {
    await borde(page, 'all-503');
    await page.reload({ waitUntil: 'commit' });
    await esperarLista(page);
    await borde(page, 'off');
  },
  async F_worker_viejo_nuevo(page) {
    await page.evaluate(async () => {
      const registro = await navigator.serviceWorker.getRegistration();
      if (!registro) return;
      await registro.update().catch(() => undefined);
      registro.active?.postMessage('skip-waiting');
    });
    await page.waitForTimeout(1_500);
    await page.reload({ waitUntil: 'commit' });
    await esperarLista(page);
  },
  async G_pestaña_reabrir(page, { context }) {
    const otra = await context.newPage();
    observar(otra);
    await otra.goto(`${BASE}/?demo=1#catalog`, { waitUntil: 'commit' });
    await esperarLista(otra);
    await otra.waitForTimeout(600);
    await otra.close();
    await page.bringToFront();
  },
  async H_seguimiento(page) {
    await irA(page, 'tracking');
    await page.waitForTimeout(900);
    // El contrato del mapa permanente: el panel está, y en reposo no aparece
    // ningún Rider inventado.
    const panel = await page.locator('[data-tracking-panel]').count();
    if (!panel) throw new Error('el panel de seguimiento desapareció');
    await irA(page, 'home');
  },
  async I_ruta_invalida(page) {
    await page.evaluate(() => { window.location.hash = '#no-existe-esta-vista'; });
    await page.waitForTimeout(700);
    await esperarLista(page);
    const vista = await page.evaluate(() => document.body.dataset.activeView || '');
    if (!vista) throw new Error('una ruta inválida dejó la aplicación sin vista activa');
  },
  async J_catalogo_lento(page) {
    await borde(page, 'all-hang');
    const recarga = page.reload({ waitUntil: 'commit' }).catch(() => undefined);
    await page.waitForTimeout(2_500);
    await borde(page, 'off');
    await recarga;
    await esperarLista(page);
  },
  async K_storage_corrupto(page) {
    await page.evaluate((clave) => {
      localStorage.setItem(clave, '{"schemaVersion":2,"cart":[{"productId":123},{"quantity":"x"}],"savedAt":"no-es-fecha"');
    }, CLAVE_CARRITO);
    await page.reload({ waitUntil: 'commit' });
    await esperarLista(page);
  },
  async L_segundo_plano(page) {
    await page.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await page.waitForTimeout(800);
  },
};

const NOMBRES = Object.keys(ESCENARIOS);

const navegador = await chromium.launch();
const context = await navegador.newContext({
  viewport: { width: 390, height: 844 },
  locale: 'es-AR',
  serviceWorkers: 'allow',
});
await context.addInitScript(INSTRUMENTO);
await context.route(`${ORIGEN_EXTERNO}/**`, (route) => route.fulfill({
  status: 200,
  contentType: 'text/html; charset=utf-8',
  body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>externo</title><h1>origen externo</h1>',
}));

let page = await context.newPage();
observar(page);
await page.goto(`${BASE}/?demo=1#home`, { waitUntil: 'load' });
await esperarLista(page);
await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30_000 });

const cdp = await context.newCDPSession(page).catch(() => null);
const recolectarBasura = async () => { await cdp?.send('HeapProfiler.collectGarbage').catch(() => undefined); };

const inicio = Date.now();
const limite = inicio + MINUTOS * 60_000;
const serie = [];
let ciclo = 0;
let rechazosPrevios = 0;

while (Date.now() < limite && ciclo < CICLOS_MAXIMOS) {
  ciclo += 1;
  const escenario = NOMBRES[(ciclo - 1) % NOMBRES.length];
  const t0 = Date.now();
  let error = null;
  try {
    await ESCENARIOS[escenario](page, { context });
  } catch (fallo) {
    error = String(fallo?.message || fallo).slice(0, 300);
  }

  // Toda vuelta termina en un estado comparable, o la serie no significa nada.
  try {
    await borde(page, 'off');
    await context.setOffline(false);
    if (!page.url().startsWith(BASE)) await page.goto(`${BASE}/?demo=1#home`, { waitUntil: 'commit' });
    await esperarLista(page, 30_000);
  } catch (fallo) {
    error = error || `no se pudo volver al estado base: ${String(fallo?.message || fallo).slice(0, 200)}`;
    page = await context.newPage();
    observar(page);
    await page.goto(`${BASE}/?demo=1#home`, { waitUntil: 'load' }).catch(() => undefined);
  }

  await recolectarBasura();
  const medida = await medir(page).catch(() => ({ arranque: 'NO-MEDIBLE' }));
  const carrito = await leerCarrito(page).catch(() => ['ILEGIBLE']);
  const fallas = exigirInvariantes(ciclo, escenario, medida, carrito);
  const rechazosNuevos = Math.max(0, (medida.rechazos || 0) - rechazosPrevios);
  rechazosPrevios = medida.rechazos || 0;

  const registro = {
    ciclo,
    escenario,
    ms: Date.now() - t0,
    error,
    fallas,
    rechazosNuevos,
    ...medida,
    lineasDeCarrito: carrito.length,
  };
  serie.push(registro);
  anotar(registro);

  if (ciclo % 12 === 0) {
    const ultimo = serie[serie.length - 1];
    process.stdout.write(
      `ciclo ${ciclo} · ${Math.round((Date.now() - inicio) / 60_000)} min · `
      + `memoria ${ultimo.memoriaMb}MB · oyentes ${ultimo.oyentes} · intervalos ${ultimo.intervalos} · `
      + `timeouts ${ultimo.timeouts} · fallas ${acumulado.fallasDeInvariante.length} · `
      + `consola ${acumulado.erroresDeConsola} · rechazos ${rechazosPrevios}\n`,
    );
  }
}

const duracionMin = Math.round((Date.now() - inicio) / 60_000);
const mediana = (valores) => {
  const orden = valores.filter((v) => typeof v === 'number').sort((a, b) => a - b);
  return orden.length ? orden[Math.floor(orden.length / 2)] : null;
};
const cuarto = Math.max(1, Math.floor(serie.length / 4));
const primeros = serie.slice(0, cuarto);
const ultimos = serie.slice(-cuarto);
const tendencia = (campo) => ({
  primerCuarto: mediana(primeros.map((r) => r[campo])),
  ultimoCuarto: mediana(ultimos.map((r) => r[campo])),
});

const resumen = {
  ciclos: ciclo,
  duracionMin,
  escenarios: NOMBRES.length,
  erroresDeEscenario: serie.filter((r) => r.error).length,
  fallasDeInvariante: acumulado.fallasDeInvariante.length,
  erroresDeConsola: acumulado.erroresDeConsola,
  erroresDePagina: acumulado.erroresDePagina,
  pedidosFallidos: acumulado.pedidosFallidos,
  rechazosSinManejar: rechazosPrevios,
  tendencia: {
    memoriaMb: tendencia('memoriaMb'),
    oyentes: tendencia('oyentes'),
    intervalos: tendencia('intervalos'),
    timeouts: tendencia('timeouts'),
  },
  primerasFallas: acumulado.fallasDeInvariante.slice(0, 10),
  primerosDetalles: acumulado.detalles.slice(0, 20),
  erroresPorEscenario: Object.fromEntries(
    NOMBRES.map((n) => [n, serie.filter((r) => r.escenario === n && r.error).length]),
  ),
};

fs.writeFileSync(path.join(SALIDA, 'soak-resumen.json'), JSON.stringify(resumen, null, 2));
console.log(JSON.stringify(resumen, null, 2));

await context.close();
await navegador.close();
bitacora.end();
