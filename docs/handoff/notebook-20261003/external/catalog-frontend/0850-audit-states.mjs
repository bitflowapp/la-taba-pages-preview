/*
 * AUDITORÍA DE «SEGUIR» COMO MAPA PERMANENTE
 *
 * Recorre el flujo real de la demo y, en cada estado, mide el DOM: que el mapa
 * esté, que las capas sean las de ese estado y que no aparezca nada que no sea
 * cierto. No saca capturas — eso lo hace scripts/taba2-tracking-screenshots.mjs.
 *
 * Vive en `.local-staging/` (ignorado por git) y NO en `test-results/`, porque
 * Playwright vacía ese directorio al arrancar y se lleva puesto el arnés.
 *
 *   BASE=http://127.0.0.1:8246 WIDTHS=320,360,390,432 node .local-staging/probe/audit-states.mjs
 *   BASE=http://127.0.0.1:8247 IDLE_STATE=empty ...      (para medir la BASE)
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { chromium, webkit } from '@playwright/test';

const BASE = process.env.BASE || 'http://127.0.0.1:8246';
const ENGINE_NAME = process.env.ENGINE === 'webkit' ? 'webkit' : 'chromium';
const ENGINE = ENGINE_NAME === 'webkit' ? webkit : chromium;
const WIDTHS = (process.env.WIDTHS || '320,360,390,432').split(',').map(Number);
const OUT = process.env.OUT || '.local-staging/probe';
const HEIGHTS = { 320: 568, 360: 740, 390: 844, 432: 932 };

const findings = [];
const rows = [];

function note(width, state, message) {
  findings.push(`${ENGINE_NAME}/${width}/${state}: ${message}`);
}

async function gotoDemo(page, url) {
  await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.dataset.activeView !== undefined, { timeout: 20_000 });
  await page.waitForTimeout(250);
}

async function tap(page, selector, { timeout = 10_000 } = {}) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: 'attached', timeout });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await locator.dispatchEvent('click', {}, { timeout: 2_000 });
      return;
    } catch (error) {
      if (attempt === 3) throw error;
      await page.waitForTimeout(250);
    }
  }
}

async function createOrder(page) {
  await gotoDemo(page, '/?reset=1&demo=1');
  await page.evaluate(async () => {
    const cart = await import(new URL('js/cart.js', location.href).href);
    const state = await import(new URL('js/state.js', location.href).href);
    const beers = state.getState().products.filter((p) => p.available && p.stock > 0 && !p.pricePending);
    let subtotal = 0;
    for (const product of beers) {
      if (subtotal >= 6000) break;
      const result = cart.addToCart(product.id, 2);
      if (result.ok) subtotal += product.price * 2;
    }
  });
  await page.evaluate(async () => {
    const orders = await import(new URL('js/orders.js', location.href).href);
    const result = orders.createOrderFromCheckout({
      customerName: 'Cliente Tracking',
      customerPhone: '2995551212',
      streetLine: 'Roca 222',
      neighborhood: 'Neuquén Capital',
      reference: 'Portón negro',
      deliveryMode: 'delivery',
      paymentMethod: 'cash',
      ageConfirmed: true,
      deliveryLatitude: -38.9539,
      deliveryLongitude: -68.0596,
      deliveryGeolocationAccuracy: 12,
      deliveryLocationSource: 'gps',
      deliveryLocationConfirmedAt: new Date().toISOString(),
    });
    if (!result.ok) throw new Error(`No se pudo crear el pedido: ${result.message}`);
  });
  return page.evaluate(async () => {
    const { getActiveOrder } = await import(new URL('js/orders.js', location.href).href);
    return getActiveOrder()?.id || '';
  });
}

async function businessAdvance(page, orderId, clicks) {
  await gotoDemo(page, '/?demo=1#business');
  const advance = page.locator(`[data-order-advance="${orderId}"]`);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (await advance.isVisible().catch(() => false)) break;
    const pin = page.locator('[data-open-pin][data-admin-target="business"]');
    if (await pin.isVisible().catch(() => false)) {
      await tap(page, '[data-open-pin][data-admin-target="business"]');
      const input = page.locator('[data-pin-form] input[name="pin"]');
      await input.waitFor({ state: 'visible', timeout: 8_000 });
      await input.fill('1234');
      await tap(page, '[data-pin-form] button[type="submit"]');
    }
    await advance.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});
  }
  for (let index = 0; index < clicks; index += 1) {
    await tap(page, `[data-order-advance="${orderId}"]`);
    await page.waitForTimeout(350);
  }
}

async function openTracking(page) {
  await gotoDemo(page, '/?demo=1#tracking');
  await page.waitForSelector('[data-tracking-panel] .track-layout');
  const map = page.locator('[data-tracking-panel] [data-real-map]');
  if (await map.count()) {
    await page.waitForFunction(() => {
      const shell = document.querySelector('[data-tracking-panel] [data-real-map]');
      return !shell || ['ready', 'unavailable'].includes(shell.dataset.mapStatus || '');
    }, { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(3800);
  }
}

async function ageFix(page, orderId, minutes, gpsStatus) {
  await gotoDemo(page, '/?demo=1#rider');
  const pause = page.locator('[data-sim-pause]');
  if (await pause.count()) await tap(page, '[data-sim-pause]').catch(() => {});
  await page.waitForTimeout(400);
  await gotoDemo(page, '/?demo=1#tracking');
  await page.evaluate(async ({ staleMinutes, id, staleStatus }) => {
    const stateModule = await import(new URL('js/state.js', location.href).href);
    const scenario = await import(new URL('js/sandbox/sandbox_map_scenario.js', location.href).href);
    const staleAt = Date.now() - (staleMinutes * 60_000);
    const staleIso = new Date(staleAt).toISOString();
    stateModule.updateState((draft) => {
      const progress = Number(draft.simulation?.progress) || 0.55;
      const point = scenario.sandboxMarkerPointAtProgress(progress);
      if (draft.simulation) {
        Object.assign(draft.simulation, {
          source: 'gps',
          mode: 'gps',
          gpsStatus: staleStatus,
          lat: point.lat,
          lng: point.lng,
          timestamp: staleAt,
          lastFixAt: staleIso,
          lastGpsFixAt: staleIso,
        });
      }
      const order = draft.orders.find((candidate) => candidate.id === id) || draft.orders[0];
      if (order) {
        order.tracking = order.tracking || {};
        order.tracking.lastLocation = {
          ...(order.tracking.lastLocation || {}),
          lat: point.lat,
          lng: point.lng,
          source: 'gps',
          gpsStatus: staleStatus,
          timestamp: staleAt,
          lastFixAt: staleIso,
        };
      }
    });
  }, { staleMinutes: minutes, id: orderId, staleStatus: gpsStatus });
  await page.waitForTimeout(3000);
}

/** Fotografía del estado del DOM que le importa a este encargo. */
async function inspect(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('[data-tracking-panel]');
    const layout = panel?.querySelector('[data-tracking-status]');
    const shell = panel?.querySelector('[data-real-map]');
    const nav = document.querySelector('.mobile-nav');
    const navRect = nav?.getBoundingClientRect();
    const navStyle = nav ? getComputedStyle(nav) : null;
    const exits = [...document.querySelectorAll('[data-nav-view]')].filter((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    }).map((node) => node.dataset.navView);
    return {
      status: layout?.dataset.trackingStatus || null,
      freshness: layout?.dataset.trackingFreshness || null,
      mapPresent: Boolean(shell),
      mapMode: shell?.dataset.mapMode || null,
      mapStatus: shell?.dataset.mapStatus || null,
      mapFailure: shell?.dataset.mapFailure || null,
      orderId: shell?.dataset.orderId || null,
      metaText: panel?.querySelector('[data-map-meta-text]')?.textContent?.trim() || null,
      store: document.querySelectorAll('.lt-place-marker.is-store').length,
      destination: document.querySelectorAll('.lt-place-marker.is-destination').length,
      rider: document.querySelectorAll('.lt-rider-marker').length,
      recenter: [...document.querySelectorAll('[data-map-recenter]')]
        .filter((node) => node.getBoundingClientRect().height > 0).length,
      waiting: panel?.querySelector('[data-tracking-map-placeholder] strong')?.textContent?.trim() || null,
      title: panel?.querySelector('[data-tracking-title], .tracking-idle-title')?.textContent?.trim() || null,
      navVisible: Boolean(navRect && navRect.height > 0 && navStyle.display !== 'none'),
      exits: [...new Set(exits)].sort(),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      rawHtml: /^\s*</.test(panel?.textContent || ''),
    };
  });
}

async function record(page, width, state, expectations) {
  const seen = await inspect(page);
  rows.push({ width, state, ...seen });
  for (const [key, expected] of Object.entries(expectations)) {
    const actual = seen[key];
    if (actual !== expected) note(width, state, `${key} = ${JSON.stringify(actual)}, esperado ${JSON.stringify(expected)}`);
  }
  if (seen.overflow > 1) note(width, state, `overflow horizontal de ${seen.overflow}px`);
  if (seen.mapFailure) note(width, state, `mapa caído: ${seen.mapFailure}`);
  if (!seen.navVisible) note(width, state, 'la barra inferior no está: el cliente puede quedar sin salida');
  if (seen.rawHtml) note(width, state, 'HTML crudo en pantalla');
  // Ninguna superficie del cliente puede anunciar una falla que no ocurrió.
  if (/no disponible|error|falló/i.test(seen.metaText || '')) {
    note(width, state, `la píldora del mapa anuncia una falla: «${seen.metaText}»`);
  }
  return seen;
}

const browser = await ENGINE.launch();
for (const width of WIDTHS) {
  const height = HEIGHTS[width] || 844;
  const context = await browser.newContext({
    viewport: { width, height },
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    locale: 'es-AR',
  });
  const page = await context.newPage();
  const errors = [];
  const badResponses = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
  });

  console.log(`\n=== ${ENGINE_NAME} ${width}x${height} ===`);

  // A · sin pedido. `IDLE_STATE=empty` corre el mismo arnés contra la BASE,
  // donde este estado todavía se llama «empty» y no tiene mapa.
  const idleState = process.env.IDLE_STATE || 'idle';
  await gotoDemo(page, '/?reset=1&demo=1#tracking');
  await page.waitForSelector(`[data-tracking-status="${idleState}"]`);
  await page.waitForTimeout(4200);
  await record(page, width, 'A-sin-pedido', idleState === 'idle' ? {
    status: 'idle', mapPresent: true, mapMode: 'idle',
    store: 1, destination: 0, rider: 0, recenter: 0, orderId: null,
  } : {});
  console.log('  A sin pedido ✓');

  // B · preparando
  const orderId = await createOrder(page);
  await businessAdvance(page, orderId, 1);
  await openTracking(page);
  await record(page, width, 'B-preparando', {
    status: 'preparing', mapPresent: true, mapMode: null,
    store: 1, destination: 1, rider: 0, recenter: 0,
  });
  console.log('  B preparando ✓');

  // C · rider asignado, todavía sin salir (sin fix)
  await businessAdvance(page, orderId, 1);
  await gotoDemo(page, '/?demo=1#rider');
  await tap(page, `[data-rider-accept="${orderId}"]`);
  await page.waitForTimeout(500);
  await openTracking(page);
  await record(page, width, 'C-rider-asignado', {
    mapPresent: true, store: 1, destination: 1, rider: 0, recenter: 0,
  });
  console.log('  C rider asignado ✓');

  /*
   * D · en camino. `store: 1` NO contradice la regla «en camino el local se
   * retira»: en la demo este estado corre sobre el recorrido de muestra de la
   * sandbox, cuya geometría declarada es local → ruta → destino, y borrar el
   * origen dejaría una línea que empieza en la nada. En el camino productivo
   * el pin sí desaparece, y eso lo demuestra el estado E, que cae a ese camino
   * en cuanto el fix deja de ser fresco y mide `store: 0`.
   */
  await gotoDemo(page, '/?demo=1#rider');
  await tap(page, `[data-delivery-leave="${orderId}"]`);
  await page.waitForTimeout(400);
  await tap(page, '[data-sim-start]');
  await page.waitForTimeout(900);
  await openTracking(page);
  await record(page, width, 'D-en-camino', {
    status: 'on_the_way', mapPresent: true, store: 1, destination: 1, rider: 1, recenter: 1,
  });
  console.log('  D en camino ✓');

  // H · recarga en pleno reparto
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openTracking(page);
  await record(page, width, 'H-recarga', {
    status: 'on_the_way', mapPresent: true, rider: 1,
  });
  console.log('  H recarga ✓');

  // E · señal perdida
  await ageFix(page, orderId, 3, 'background');
  await openTracking(page);
  await record(page, width, 'E-senal-perdida', { mapPresent: true, destination: 1, store: 0 });
  console.log('  E señal perdida ✓');

  // F · entregado. Se avanza por el mismo módulo que usa el Rider; lo que se
  // audita es cómo QUEDA la vista del cliente, no el flujo del repartidor.
  await gotoDemo(page, '/?demo=1#tracking');
  await page.evaluate(async (id) => {
    const orders = await import(new URL('js/orders.js', location.href).href);
    orders.updateOrderStatus(id, 'arrived');
    orders.updateOrderStatus(id, 'delivered');
  }, orderId);
  await page.waitForTimeout(700);
  await openTracking(page);
  await record(page, width, 'F-entregado', { mapPresent: true, rider: 0, recenter: 0 });
  console.log('  F entregado ✓');

  if (errors.length) note(width, 'consola', errors.join(' | '));
  if (badResponses.length) note(width, 'red', badResponses.join(' | '));
  await context.close();
}
await browser.close();

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/audit-${ENGINE_NAME}.json`, JSON.stringify({ rows, findings }, null, 2));

console.log('\n──────── RESUMEN ────────');
for (const row of rows) {
  console.log(
    `${String(row.width).padEnd(4)} ${row.state.padEnd(18)} `
    + `estado=${String(row.status).padEnd(11)} mapa=${row.mapPresent ? 'sí' : 'NO'} `
    + `local=${row.store} destino=${row.destination} rider=${row.rider} `
    + `recentrar=${row.recenter} nav=${row.navVisible ? 'sí' : 'NO'} of=${row.overflow}`,
  );
}
console.log(`\nhallazgos: ${findings.length}`);
for (const finding of findings) console.log(`  · ${finding}`);
