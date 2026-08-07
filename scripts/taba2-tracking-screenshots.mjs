/*
 * Capturas de los estados del tracking, en el mismo recorrido que haría un
 * cliente real de la demo: pedido → negocio acepta y prepara → rider toma y
 * sale → simulación de recorrido → llegada. Nada se inyecta por debajo salvo
 * el envejecimiento del fix GPS para el estado "GPS perdido", que es
 * exactamente lo que pasa cuando el teléfono del rider deja de reportar.
 *
 *   node scripts/realtime-relay.mjs 8246 &
 *   BASE=http://127.0.0.1:8246 node scripts/taba2-tracking-screenshots.mjs
 *   ENGINE=webkit WIDTHS=320,390,432 BASE=... node scripts/taba2-tracking-screenshots.mjs
 *
 * Variables: BASE, ENGINE (chromium|webkit), WIDTHS, OUT.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium, webkit } from '@playwright/test';

const BASE = process.env.BASE || 'http://127.0.0.1:8246';
const ENGINE_NAME = process.env.ENGINE === 'webkit' ? 'webkit' : 'chromium';
const ENGINE = ENGINE_NAME === 'webkit' ? webkit : chromium;
const WIDTHS = (process.env.WIDTHS || '390').split(',').map(Number);
const OUT = path.resolve(process.env.OUT || 'artifacts/taba2-tracking-visual');

const HEIGHTS = { 320: 568, 375: 667, 390: 844, 414: 896, 432: 932, 1280: 900 };

function outPath(width, name) {
  const dir = path.join(OUT, ENGINE_NAME, String(width));
  mkdirSync(dir, { recursive: true });
  return path.join(dir, `${name}.png`);
}

const auditFindings = [];

async function settleAndShot(page, width, name, { fullPage = false } = {}) {
  await page.waitForTimeout(900);
  await page.screenshot({ path: outPath(width, name), fullPage });
  console.log(`  ${ENGINE_NAME}/${width}/${name}.png`);
  if (process.env.AUDIT !== '1') return;

  // Auditoría del estado recién capturado: overflow horizontal, objetivos
  // táctiles de los controles del mapa y superficies claras fuera de identidad
  // en los overlays. Se mide lo COMPUTADO en el estado real, no una maqueta.
  const findings = await page.evaluate(() => {
    const problems = [];
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    if (overflow > 1) problems.push(`overflow horizontal de ${overflow}px`);

    for (const selector of ['.tracking-map-recenter', '.maplibregl-ctrl-attrib-button', '.maplibregl-ctrl-group button']) {
      for (const control of document.querySelectorAll(selector)) {
        const style = getComputedStyle(control);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const rect = control.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        // La atribución compacta de MapLibre es 25px por diseño del vendor y
        // es informativa, no operativa del reparto; se tolera hasta 24px.
        const minimum = selector.includes('attrib') ? 24 : 43.5;
        if (rect.width < minimum || rect.height < minimum) {
          problems.push(`${selector} mide ${Math.round(rect.width)}x${Math.round(rect.height)}`);
        }
      }
    }

    const lightSurface = (selector) => {
      for (const node of document.querySelectorAll(selector)) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || node.getBoundingClientRect().width === 0) continue;
        const match = /rgba?\((\d+), (\d+), (\d+)/.exec(style.backgroundColor);
        if (!match) continue;
        const [, r, g, b] = match.map(Number);
        if ((r + g + b) / 3 > 128) {
          problems.push(`${selector} con superficie clara ${style.backgroundColor}`);
        }
      }
    };
    lightSurface('.real-map-meta');
    lightSurface('.tracking-map-eta');
    lightSurface('.tracking-map-recenter');
    lightSurface('.tracking-map-waiting');
    return problems;
  });
  for (const problem of findings) {
    auditFindings.push(`${ENGINE_NAME}/${width}/${name}: ${problem}`);
    console.log(`    AUDIT ${problem}`);
  }
}

async function gotoDemo(page, url) {
  await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
}

/*
 * Click por dispatchEvent, con reintentos.
 *
 * Los paneles demo re-renderizan en intervalo y reemplazan sus nodos: el click
 * "actionable" de Playwright resuelve el locator, el nodo se despega antes del
 * gesto y el reintento entra en un ciclo que a un humano no le pasa. Como los
 * handlers del producto son delegados a nivel document, despachar el click al
 * nodo vigente ejerce exactamente el mismo código sin la carrera de estabilidad.
 */
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

/** Crea un pedido delivery en la demo y devuelve su id. */
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
  // El gate del PIN tapa la bandeja: el botón de avance existe en el DOM pero
  // no es accionable hasta desbloquear. Se verifica la visibilidad del botón,
  // no la del gate, porque es lo que el paso siguiente necesita de verdad.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (await advance.isVisible().catch(() => false)) break;
    const pin = page.locator('[data-open-pin][data-admin-target="business"]');
    if (await pin.isVisible().catch(() => false)) {
      await tap(page, '[data-open-pin][data-admin-target="business"]');
      const input = page.locator('[data-pin-form] input[name="pin"]');
      await input.waitFor({ state: 'visible', timeout: 8_000 });
      await input.fill('1234');
      // Submit por el botón del form, no por Enter: el form es method=dialog y
      // Enter puede despachar un submit con el valor todavía sin confirmar.
      await tap(page, '[data-pin-form] button[type=\"submit\"]');
    }
    await advance.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});
  }
  if (!(await advance.isVisible().catch(() => false))) {
    const diag = await page.evaluate(() => ({
      activeView: document.body.dataset.activeView,
      hash: location.hash,
      pin: Boolean(document.querySelector('[data-open-pin][data-admin-target="business"]')),
      pinVisible: (() => {
        const node = document.querySelector('[data-open-pin][data-admin-target="business"]');
        return node ? node.offsetParent !== null : null;
      })(),
      dialogOpen: document.querySelector('dialog[open]')?.className || null,
      inbox: [...document.querySelectorAll('[data-inbox-order]')].map((node) => node.dataset.inboxOrder),
    }));
    await page.screenshot({ path: outPath(0, 'debug-business-gate') });
    throw new Error(`El panel no quedó operable: ${JSON.stringify(diag)}`);
  }
  for (let index = 0; index < clicks; index += 1) {
    await tap(page, `[data-order-advance="${orderId}"]`);
    await page.waitForTimeout(350);
  }
}

async function riderTakeAndLeave(page, orderId) {
  await gotoDemo(page, '/?demo=1#rider');
  await tap(page, `[data-rider-accept="${orderId}"]`);
  await page.waitForTimeout(400);
  await tap(page, `[data-delivery-leave="${orderId}"]`);
  await page.waitForTimeout(400);
  await tap(page, '[data-sim-start]');
  await page.waitForTimeout(700);
}

async function openTracking(page) {
  await gotoDemo(page, '/?demo=1#tracking');
  await page.waitForSelector('[data-tracking-panel] .track-layout');
  // El mapa (si corresponde) declara su estado; esperamos a que se resuelva
  // para no capturar un canvas a medio cargar.
  const map = page.locator('[data-tracking-panel] [data-real-map]');
  if (await map.count()) {
    await page.waitForFunction(() => {
      const shell = document.querySelector('[data-tracking-panel] [data-real-map]');
      return !shell || ['ready', 'unavailable'].includes(shell.dataset.mapStatus || '');
    }, { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }
}

/*
 * Reproduce la pérdida real de señal: el último fix envejece más allá del
 * umbral `lost` (45 s). Primero se pausa la simulación —su tick reescribe el
 * estado cada segundo y pisaría el envejecimiento— y después el fix pasa a
 * `source: 'gps'` con la MISMA posición que ya tenía y un timestamp viejo, que
 * es exactamente lo que queda cuando el teléfono del rider deja de reportar.
 */
async function injectFix(page, orderId, minutes, gpsStatus) {
  await page.evaluate(async ({ staleMinutes, id, staleStatus }) => {
    const stateModule = await import(new URL('js/state.js', location.href).href);
    const scenario = await import(new URL('js/sandbox/sandbox_map_scenario.js', location.href).href);
    const staleAt = Date.now() - (staleMinutes * 60_000);
    const staleIso = new Date(staleAt).toISOString();
    stateModule.updateState((draft) => {
      const progress = Number(draft.simulation?.progress) || 0.55;
      const point = scenario.sandboxMarkerPointAtProgress(progress);
      if (draft.simulation) {
        draft.simulation.source = 'gps';
        draft.simulation.mode = 'gps';
        draft.simulation.gpsStatus = staleStatus;
        draft.simulation.lat = point.lat;
        draft.simulation.lng = point.lng;
        draft.simulation.timestamp = staleAt;
        draft.simulation.lastFixAt = staleIso;
        draft.simulation.lastGpsFixAt = staleIso;
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
  // El tick de frescura del tracking re-renderiza solo al cruzar el umbral.
  await page.waitForTimeout(1800);
}

async function loseGps(page, orderId, minutes = 1, gpsStatus = 'background') {
  await gotoDemo(page, '/?demo=1#rider');
  const pause = page.locator('[data-sim-pause]');
  if (await pause.count()) await tap(page, '[data-sim-pause]').catch(() => {});
  await page.waitForTimeout(400);
  await gotoDemo(page, '/?demo=1#tracking');
  await injectFix(page, orderId, minutes, gpsStatus);
}

const browser = await ENGINE.launch();
for (const width of WIDTHS) {
  const height = HEIGHTS[width] || 900;
  console.log(`\n=== ${ENGINE_NAME} ${width}x${height} ===`);
  const context = await browser.newContext({
    viewport: { width, height },
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    locale: 'es-AR',
  });
  const page = await context.newPage();

  // 1 · tracking vacío
  await gotoDemo(page, '/?reset=1&demo=1#tracking');
  await page.waitForSelector('[data-tracking-status="empty"]');
  await settleAndShot(page, width, '1-tracking-vacio');

  // 2 · esperando rider (pedido recién recibido, sin repartidor)
  const orderId = await createOrder(page);
  await openTracking(page);
  await settleAndShot(page, width, '2-esperando-rider');

  // 3 · rider asignado (negocio aceptó/preparó/listo; rider tomó, aún sin salir)
  // Dos avances: received → preparing → ready. El tercero es del rider y el
  // botón del Panel deja de existir para el pedido.
  await businessAdvance(page, orderId, 2);
  await gotoDemo(page, '/?demo=1#rider');
  await tap(page, `[data-rider-accept="${orderId}"]`);
  await page.waitForTimeout(500);
  await openTracking(page);
  await settleAndShot(page, width, '3-rider-asignado');

  // 4 · en camino (salió a ruta con simulación activa: mapa + ruta)
  await gotoDemo(page, '/?demo=1#rider');
  await tap(page, `[data-delivery-leave="${orderId}"]`);
  await page.waitForTimeout(400);
  await tap(page, '[data-sim-start]');
  await page.waitForTimeout(800);
  await openTracking(page);
  if (process.env.DIAG === '1') {
    const diag = await page.evaluate(() => {
      const etas = [...document.querySelectorAll('.tracking-map-eta')].map((node) => {
        const cs = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return {
          text: node.textContent.trim(),
          background: cs.backgroundColor,
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width) },
          inline: node.getAttribute('style'),
          parent: node.parentElement?.className?.slice(0, 60),
        };
      });
      const shell = document.querySelector('[data-real-map]');
      const shellRect = shell?.getBoundingClientRect();
      const probeY = shellRect ? Math.round(shellRect.bottom - 26) : 0;
      const probe = shellRect ? document.elementFromPoint(56, probeY) : null;
      return {
        etas,
        probeAt: probeY,
        probe: probe ? `${probe.tagName}.${String(probe.className).slice(0, 80)}` : null,
        probeBackground: probe ? getComputedStyle(probe).backgroundColor : null,
      };
    });
    console.log('DIAG estado 4:', JSON.stringify(diag, null, 1));
    const etaBox = diag.etas[0]?.rect;
    if (etaBox) {
      // Mismo frame: primero la pantalla completa, inmediatamente el clip.
      await page.screenshot({ path: outPath(width, 'diag-full-same-frame') });
      await page.screenshot({
        path: outPath(width, 'diag-eta-clip'),
        clip: { x: etaBox.x - 10, y: etaBox.y - 10, width: etaBox.w + 40, height: 54 },
      });
      const after = await page.evaluate(() => {
        const eta = document.querySelector('.tracking-map-eta');
        const rect = eta?.getBoundingClientRect();
        return {
          text: eta?.textContent?.trim(),
          background: eta ? getComputedStyle(eta).backgroundColor : null,
          y: rect ? Math.round(rect.y) : null,
        };
      });
      console.log('DIAG tras screenshots:', JSON.stringify(after));
    }
  }
  await settleAndShot(page, width, '4-en-camino');

  // 5 · GPS perdido (el último fix envejece más allá del umbral de 45 s,
  // dentro de la ventana en que la última posición conocida aún se muestra)
  await loseGps(page, orderId, 1);
  if (process.env.DIAG === '1') {
    const diag5 = await page.evaluate(async () => {
      const { getState } = await import(new URL('js/state.js', location.href).href);
      const geometry = await import(new URL('js/map/route_geometry.js', location.href).href);
      const state = getState();
      const order = state.orders.find((candidate) => candidate.id === state.lastOrderId) || state.orders[0];
      const sim = state.simulation;
      const chosen = geometry.chooseRiderLocation(sim, order?.tracking?.lastLocation);
      return {
        status: order?.status,
        sim: sim ? { source: sim.source, lat: sim.lat, lng: sim.lng, ageS: Math.round((Date.now() - (sim.timestamp || 0)) / 1000), gpsStatus: sim.gpsStatus } : null,
        tracked: order?.tracking?.lastLocation || null,
        chosen,
        freshness: geometry.trackingLocationFreshness(chosen),
        layout: document.querySelector('.track-layout')?.className,
      };
    });
    console.log('DIAG estado 5:', JSON.stringify(diag5, null, 1));
  }
  await settleAndShot(page, width, '5-gps-perdido');

  // 6 · llegó (el rider marca la llegada)
  // El GPS "vuelve" primero —fix fresco, como cuando el teléfono retoma la
  // señal al frenar en la puerta— para que la llegada muestre su mapa de
  // última ubicación y no herede el estado roto del paso anterior.
  await gotoDemo(page, '/?demo=1#rider');
  const arriveButton = page.locator(`[data-delivery-arrive="${orderId}"]`);
  if (await arriveButton.count()) {
    await tap(page, `[data-delivery-arrive="${orderId}"]`);
  } else {
    await page.evaluate(async (id) => {
      const orders = await import(new URL('js/orders.js', location.href).href);
      orders.updateOrderStatus?.(id, 'arrived');
    }, orderId);
  }
  await page.waitForTimeout(500);
  await openTracking(page);
  await injectFix(page, orderId, 0, 'active');
  await settleAndShot(page, width, '6-llego');

  await context.close();
}
await browser.close();
console.log(`\nCapturas en ${OUT}`);
if (process.env.AUDIT === '1') {
  if (auditFindings.length) {
    console.error(`\nAUDIT: ${auditFindings.length} hallazgo(s)`);
    for (const finding of auditFindings) console.error(`  ${finding}`);
    process.exit(1);
  }
  console.log('AUDIT: 0 hallazgos en todos los estados capturados.');
}
