/*
 * Certificación en staging del recorrido que corrige el P1:
 *
 *   tienda → carrito → checkout → origen externo → «atrás» → tienda intacta
 *
 * Corre contra el sitio PÚBLICO en modo producción real, con el service worker
 * VIVO —el gate de Playwright los bloquea, así que este es el único lugar donde
 * el worker publicado se ejerce de verdad—.
 *
 * Lo que NO hace, a propósito:
 *   · no confirma el checkout, así que no crea sesión de pago ni preferencia;
 *   · no crea pedidos ni mueve dinero;
 *   · la salida al origen externo es una navegación cruzada REAL a la portada
 *     pública de Mercado Pago: un GET a una página que no sabe quiénes somos.
 *     Lo que decide el ciclo de vida es la navegación cruzada, no el destino.
 *
 * Vigila además que no salga ni una MUTACIÓN al backend durante todo el
 * recorrido. Mirar el verbo HTTP no alcanza: PostgREST manda toda RPC por POST,
 * incluso las de sólo lectura. Se vigila la superficie que de verdad escribe.
 *
 * Uso:
 *   node scripts/certify-staging-mp-back-navigation.mjs
 *   ENGINE=webkit node scripts/certify-staging-mp-back-navigation.mjs
 */
import { chromium, webkit } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { brandSurfaceRgb } from './brand-surface.mjs';

const BASE = (process.env.BASE || 'https://taba2-staging.pages.dev').replace(/\/$/, '');
const OUT = path.resolve(process.env.OUT || 'artifacts/ci/staging-mp-back/recorrido');
const WIDTHS = (process.env.WIDTHS || '320,360,390,432').split(',').map(Number);
const ENGINE_NAME = process.env.ENGINE === 'webkit' ? 'webkit' : 'chromium';
const ENGINE = ENGINE_NAME === 'webkit' ? webkit : chromium;
const HEIGHTS = { 320: 720, 360: 800, 390: 844, 432: 960 };
const EXTERNO = 'https://www.mercadopago.com.ar/';
// Derivado del token de ESTA rama, no copiado: si staging todavía sirve la
// superficie anterior, la certificación tiene que fallar. Es el punto.
const FONDO_COMERCIAL = brandSurfaceRgb();

const fallas = [];
const anota = (etiqueta, condicion, detalle) => {
  if (!condicion) fallas.push(`${etiqueta}: ${detalle}`);
  return condicion;
};

const medir = () => {
  const el = (s) => document.querySelector(s);
  const ancho = (s) => { const n = el(s); return n ? Math.round(n.getBoundingClientRect().width) : -1; };
  const link = el('link[href^="styles.css"]');
  let reglas = -1;
  let importsVivos = -1;
  let importsTotales = -1;
  const perdidas = [];
  try {
    reglas = link.sheet.cssRules.length;
    const imports = [...link.sheet.cssRules].filter((r) => r.type === CSSRule.IMPORT_RULE);
    importsTotales = imports.length;
    importsVivos = 0;
    imports.forEach((r) => {
      let vivo = false;
      try { vivo = !!(r.styleSheet && r.styleSheet.cssRules.length > 0); } catch (_) { vivo = false; }
      if (vivo) importsVivos += 1;
      else perdidas.push(String(r.href || '').split('/').pop().split('?')[0]);
    });
  } catch (_) { /* la hoja no está: queda en -1 y el gate lo dice */ }
  const icono = el('.mobile-nav svg');
  return {
    fondo: getComputedStyle(document.body).backgroundColor,
    navPosicion: el('.mobile-nav') ? getComputedStyle(el('.mobile-nav')).position : 'SIN-NODO',
    barraSuperior: el('.topbar') ? getComputedStyle(el('.topbar')).position : 'SIN-NODO',
    iconoAncho: icono ? Math.round(parseFloat(getComputedStyle(icono).width)) : -1,
    marcaAncho: ancho('.brand'),
    reglas,
    importsVivos,
    importsTotales,
    perdidas,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    arranque: document.documentElement.dataset.tabaStartup || null,
    modo: document.body.dataset.appMode || null,
    worker: !!navigator.serviceWorker.controller,
    navType: performance.getEntriesByType('navigation')[0]?.type || '?',
  };
};

// El estado del checkout que la persona ve: sus datos, su dirección y la
// modalidad de entrega elegida.
const leerDireccion = () => ({
  bloque: document.querySelector('[data-profile-checkout]')?.textContent?.replace(/\s+/g, ' ').trim() || '',
  origen: document.querySelector('[data-checkout-form]')?.dataset?.addressSource || null,
  entrega: document.querySelector('input[name="deliveryMode"]:checked')?.value || null,
});

async function recorrido(ancho) {
  const navegador = await ENGINE.launch();
  const contexto = await navegador.newContext({
    viewport: { width: ancho, height: HEIGHTS[ancho] || 800 },
    serviceWorkers: 'allow',
    isMobile: ENGINE_NAME === 'webkit',
    hasTouch: true,
  });
  const pagina = await contexto.newPage();

  /*
   * Ninguna MUTACIÓN puede salir de este recorrido. Mirar el verbo HTTP no
   * alcanza y engaña: PostgREST exige POST para toda RPC, incluso para las que
   * están declaradas `stable` y sólo leen —`get_public_business_contact`,
   * `get_mercadopago_checkout_availability`, `get_current_customer_profile`
   * salen como POST en cada carga de página—. Lo que se vigila es la superficie
   * que de verdad escribe: las RPC que mutan, cualquier Edge Function —por ahí
   * salen `mercadopago-create-checkout-session` y `-create-preference`, o sea
   * el único camino que podría nacer un pago— y cualquier escritura directa a
   * una tabla.
   */
  const RPC_QUE_MUTAN = [
    'create_order_with_items', 'cancel_order', 'transition_order', 'assign_order_rider',
    'claim_delivery_order', 'confirm_delivery_code', 'issue_order_delivery_code',
    'enqueue_payment_reconciliation', 'publish_rider_location_receipt',
    'recover_paid_checkout_order', 'recover_order_tracking_access',
  ];
  const mutaciones = [];
  pagina.on('request', (peticion) => {
    const url = peticion.url();
    if (!/supabase\.co/.test(url)) return;
    const metodo = peticion.method();
    const ruta = url.split('?')[0].replace(/https:\/\/[^/]+/, '');
    if (/\/functions\/v1\//.test(ruta)) { mutaciones.push(`${metodo} ${ruta}`); return; }
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(metodo)) return;
    if (/\/auth\/v1\//.test(ruta)) return; // sesión anónima: no es negocio
    const rpc = ruta.match(/\/rest\/v1\/rpc\/([a-z_]+)/)?.[1];
    if (rpc) { if (RPC_QUE_MUTAN.includes(rpc)) mutaciones.push(`${metodo} rpc/${rpc}`); return; }
    if (/\/rest\/v1\//.test(ruta)) mutaciones.push(`${metodo} ${ruta}`);
  });
  const rotos = [];
  pagina.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(BASE)) rotos.push(`${r.status()} ${r.url().replace(BASE, '')}`); });

  console.log(`\n## ${ENGINE_NAME} · ${ancho}px · ${BASE}`);

  // 1 · cliente que llega y deja el worker instalado
  await pagina.goto(`${BASE}/#home`, { waitUntil: 'load', timeout: 60_000 });
  await pagina.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 60_000 });
  await pagina.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 60_000 }).catch(() => {});
  await pagina.waitForFunction(async () => {
    const claves = await caches.keys();
    if (!claves.length) return false;
    return (await caches.open(claves[0])).keys().then((k) => k.length > 100);
  }, null, { timeout: 90_000 }).catch(() => {});
  const cacheAntes = await pagina.evaluate(async () => {
    const claves = await caches.keys();
    if (!claves.length) return { nombre: null, entradas: 0 };
    return { nombre: claves[0], entradas: (await (await caches.open(claves[0])).keys()).length };
  });
  console.log(`   worker=${cacheAntes.nombre} · ${cacheAntes.entradas} entradas en caché`);

  // 2 · carrito por la interfaz real
  await pagina.evaluate(() => { window.location.hash = '#catalog'; });
  const agregar = pagina.locator('[data-product-grid] [data-add-product]:not([disabled]) >> visible=true').first();
  await agregar.waitFor({ state: 'visible', timeout: 60_000 });
  await agregar.click();
  await pagina.evaluate(() => { window.location.hash = '#cart'; });
  await pagina.locator('[data-checkout-form]').waitFor({ state: 'visible', timeout: 30_000 });

  const carritoAntes = await pagina.evaluate(async () => {
    const { getState } = await import('/js/state.js');
    return getState().cart.map((i) => `${i.productId}:${i.quantity}`).sort();
  });
  /*
   * El bloque de dirección se hidrata de forma asíncrona, así que las dos
   * lecturas tienen que darle el MISMO tiempo de asentarse. Sin esta espera el
   * "antes" cae sobre un estado a medio hidratar y la comparación acusa un
   * cambio que no existe: medido, con tiempos iguales el bloque vuelve idéntico
   * carácter por carácter.
   */
  await pagina.waitForTimeout(2_500);
  const direccionAntes = await pagina.evaluate(leerDireccion);
  const antes = await pagina.evaluate(medir);
  console.log(`   antes de salir · fondo=${antes.fondo} imports=${antes.importsVivos}/${antes.importsTotales} nav=${antes.navPosicion} icono=${antes.iconoAncho}px carrito=${carritoAntes.length}`);
  anota(`${ancho}px antes`, antes.fondo === FONDO_COMERCIAL, `la referencia ya venía sin la superficie de marca (${antes.fondo})`);
  anota(`${ancho}px antes`, carritoAntes.length > 0, 'el carrito quedó vacío antes de salir');
  mkdirSync(OUT, { recursive: true });
  await pagina.screenshot({ path: path.join(OUT, `${ENGINE_NAME}-${ancho}-1-antes.png`) });

  // 3 · salida cruzada real
  await pagina.evaluate((url) => { window.location.assign(url); }, EXTERNO);
  await pagina.waitForURL(/mercadopago\.com/, { timeout: 60_000 });
  console.log(`   salió a ${new URL(pagina.url()).origin}`);

  // 4 · «atrás»
  await pagina.goBack({ waitUntil: 'commit', timeout: 60_000 });
  await pagina.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 60_000 });
  await pagina.waitForTimeout(2_500);

  const despues = await pagina.evaluate(medir);
  const carritoDespues = await pagina.evaluate(async () => {
    const { getState } = await import('/js/state.js');
    return getState().cart.map((i) => `${i.productId}:${i.quantity}`).sort();
  });
  console.log(`   al volver     · fondo=${despues.fondo} imports=${despues.importsVivos}/${despues.importsTotales} nav=${despues.navPosicion} icono=${despues.iconoAncho}px carrito=${carritoDespues.length} navType=${despues.navType}`);
  await pagina.screenshot({ path: path.join(OUT, `${ENGINE_NAME}-${ancho}-2-al-volver.png`) });

  const etiqueta = `${ENGINE_NAME} ${ancho}px`;
  anota(etiqueta, despues.reglas > 0, `la hoja principal volvió con ${despues.reglas} reglas`);
  anota(etiqueta, despues.perdidas.length === 0, `hojas perdidas al volver: ${despues.perdidas.join(', ')}`);
  anota(etiqueta, despues.importsVivos === despues.importsTotales && despues.importsTotales > 0, `cadena de @import incompleta: ${despues.importsVivos}/${despues.importsTotales}`);
  anota(etiqueta, despues.fondo === FONDO_COMERCIAL, `se perdió la superficie de marca: ${despues.fondo}`);
  anota(etiqueta, despues.navPosicion === 'fixed', `la barra inferior quedó ${despues.navPosicion}`);
  anota(etiqueta, despues.barraSuperior === 'sticky', `la barra superior quedó ${despues.barraSuperior}`);
  anota(etiqueta, despues.iconoAncho > 0 && despues.iconoAncho <= 28, `iconos sobredimensionados: ${despues.iconoAncho}px`);
  anota(etiqueta, despues.marcaAncho > 0 && despues.marcaAncho <= 140, `la marca quedó en ${despues.marcaAncho}px`);
  anota(etiqueta, despues.scrollWidth <= despues.innerWidth, `desborde horizontal: ${despues.scrollWidth} sobre ${despues.innerWidth}`);
  anota(etiqueta, despues.arranque === 'ready', `la aplicación no arrancó (${despues.arranque})`);
  anota(etiqueta, despues.modo === 'production', `modo servido: ${despues.modo}`);
  anota(etiqueta, JSON.stringify(carritoDespues) === JSON.stringify(carritoAntes), `el carrito cambió: ${JSON.stringify(carritoAntes)} → ${JSON.stringify(carritoDespues)}`);

  // 5 · se puede seguir comprando y elegir otro medio de pago, sin recargar
  await pagina.evaluate(() => { window.location.hash = '#cart'; });
  await pagina.locator('[data-checkout-form]').waitFor({ state: 'visible', timeout: 30_000 });
  await pagina.waitForTimeout(2_500);
  const direccionDespues = await pagina.evaluate(leerDireccion);
  anota(
    etiqueta,
    JSON.stringify(direccionDespues) === JSON.stringify(direccionAntes),
    `el estado del checkout cambió al volver: ${JSON.stringify(direccionAntes)} → ${JSON.stringify(direccionDespues)}`,
  );

  const pago = pagina.getByLabel('Forma de pago');
  let medios = [];
  if (await pago.count()) {
    medios = await pago.locator('option').evaluateAll((os) => os.map((o) => o.value));
    const otro = medios.find((v) => v && v !== 'mercadopago');
    if (otro) {
      await pago.selectOption(otro);
      const elegido = await pago.inputValue();
      anota(etiqueta, elegido === otro, `no se pudo cambiar el medio de pago a ${otro}`);
    }
  }
  const checkoutIntacto = JSON.stringify(direccionDespues) === JSON.stringify(direccionAntes);
  console.log(`   medios de pago disponibles: ${medios.join(', ') || '(sin selector)'} · estado del checkout intacto=${checkoutIntacto}`);

  const cacheDespues = await pagina.evaluate(async () => {
    const claves = await caches.keys();
    return { claves, entradas: claves.length ? (await (await caches.open(claves[0])).keys()).length : 0 };
  });
  console.log(`   cachés al volver: ${JSON.stringify(cacheDespues.claves)} · ${cacheDespues.entradas} entradas`);
  anota(etiqueta, cacheDespues.entradas > 100, `la caché quedó en ${cacheDespues.entradas} entradas`);
  anota(etiqueta, cacheDespues.claves.length === 1, `quedaron ${cacheDespues.claves.length} cachés: mezcla`);
  anota(etiqueta, mutaciones.length === 0, `hubo mutaciones en el backend: ${mutaciones.join(", ")}`);
  anota(etiqueta, rotos.length === 0, `respuestas rotas del origen: ${rotos.join(', ')}`);
  await pagina.screenshot({ path: path.join(OUT, `${ENGINE_NAME}-${ancho}-3-checkout.png`) });

  await navegador.close();
}

for (const ancho of WIDTHS) await recorrido(ancho);

console.log(`\n${fallas.length ? `FALLAS (${fallas.length}):` : 'SIN FALLAS'}`);
fallas.forEach((linea) => console.log(`  ✗ ${linea}`));
process.exit(fallas.length ? 1 : 0);
