/**
 * Capturas del microfix de lanzamiento: sólo las tres superficies que cambian.
 *
 *   node scripts/launch-ux-microfix-captures.mjs before|after
 *
 * Corre igual sobre el árbol anterior y sobre el nuevo, a propósito: la única
 * forma de que un antes/después signifique algo es que las dos corridas hagan
 * exactamente lo mismo. Por eso el perfil lento se instala envolviendo
 * `load()` del repositorio y reiniciando el checkout por su propia API, que es
 * un camino que existe en las dos versiones.
 *
 * No toca red externa, Supabase ni staging.
 */
import { chromium, devices, webkit } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const fase = (process.argv[2] || 'before').replace(/[^a-z]/g, '') || 'before';
const PORT = Number(process.env.TABA_UX_PORT || 8251);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.resolve('artifacts/launch-ux-microfix', fase);
mkdirSync(OUT, { recursive: true });

const medidas = {};
let server = null;

try {
  await levantarServidor();
  await recorrido('chromium-390', chromium, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await recorrido('webkit-iphone', webkit, { ...devices['iPhone 13'] });
} finally {
  await pararServidor();
}

writeFileSync(path.join(OUT, 'MEDIDAS.json'), `${JSON.stringify(medidas, null, 2)}\n`);
console.log(`Capturas en ${OUT}`);

async function recorrido(nombre, motor, opciones) {
  const browser = await motor.launch();
  try {
    const context = await browser.newContext({ ...opciones, serviceWorkers: 'block' });
    const page = await context.newPage();
    await abrir(page);
    await sembrarClienteRecurrente(page);
    await armarCarrito(page);
    await irACarrito(page);

    // 3 · el aviso del pedido, con el carrito ya armado
    await page.locator('[data-cart-inc] >> visible=true').first().click();
    await asentar(page);
    await shot(page, `${nombre}-aviso-carrito.png`);
    medidas[`${nombre}-aviso`] = await medirAviso(page);
    await page.waitForTimeout(2400);

    // 1 · el checkout recurrente MIENTRAS carga el perfil
    await instalarPerfilLento(page, 2600);
    await asentar(page);
    await shot(page, `${nombre}-checkout-cargando.png`);
    medidas[`${nombre}-cargando`] = await medirCheckout(page);

    // 2 · el mismo checkout ya resuelto
    await page.waitForTimeout(2800);
    await asentar(page);
    await shot(page, `${nombre}-checkout-resuelto.png`);
    medidas[`${nombre}-resuelto`] = await medirCheckout(page);

    await context.close();
  } finally {
    await browser.close();
  }
}

async function abrir(page) {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto(`${BASE}/?reset=1&demo=1`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForURL((url) => !url.searchParams.has('reset'), { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForLoadState('load');
  await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 30_000 });
  await asentar(page);
}

async function sembrarClienteRecurrente(page) {
  const pedido = await page.evaluate(async () => {
    const { getState } = await import(new URL('js/state.js', location.href).href);
    const { isProductOrderable } = await import(new URL('js/core/catalog-store.js', location.href).href);
    const comprables = getState().products.filter((p) => isProductOrderable(p) && Number(p.stock) >= 2).slice(0, 2);
    return {
      id: 'LT-0091',
      createdAt: '2026-08-07T21:12:00.000Z',
      status: 'delivered',
      deliveryMode: 'delivery',
      paymentMethod: 'Efectivo al recibir',
      paymentMethodCode: 'cash',
      address: 'Avenida Argentina 450, Neuquén Capital',
      items: comprables.map((p, i) => ({
        productId: p.id, name: p.name, quantity: i === 0 ? 2 : 1, unitPrice: Number(p.price), unit: p.unit || 'unidad',
      })),
      subtotal: 0,
      deliveryFee: 0,
      discountTotal: 0,
      total: 9000,
    };
  });
  await page.addInitScript(({ entrada, perfil }) => {
    localStorage.setItem('la_taba_customer_history_v1', JSON.stringify([entrada]));
    localStorage.setItem('la-taba-sandbox-profile:demo', JSON.stringify(perfil));
  }, {
    entrada: pedido,
    perfil: {
      profile: { id: 'demo-customer', name: 'Marco', phone: '2990000123', updatedAt: '' },
      addresses: [{
        id: 'demo-address-01',
        label: 'Casa',
        street: 'Avenida Argentina',
        streetNumber: '450',
        city: 'Neuquén Capital',
        reference: 'Portón negro, timbre 2',
        isDefault: true,
        latitude: -38.945584,
        longitude: -68.040579,
        geolocationAccuracy: 18,
        locationSource: 'map_pin',
        locationConfirmedAt: '2026-08-08T18:00:00.000Z',
      }],
    },
  });
  await page.reload({ waitUntil: 'load' });
  await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached' });
  await asentar(page);
}

async function armarCarrito(page) {
  await page.locator('[data-nav-view="catalog"] >> visible=true').first().click();
  await asentar(page);
  const agregar = page.locator('[data-product-grid] [data-add-product]:not([disabled]) >> visible=true').first();
  const productId = await agregar.getAttribute('data-add-product');
  await agregar.click();
  await page.locator(`[data-cart-inc="${productId}"] >> visible=true`).first().click();
}

async function irACarrito(page) {
  await page.locator('[data-nav-view="cart"] >> visible=true').first().click();
  await page.locator('body[data-active-view="cart"]').waitFor({ state: 'attached' });
  await asentar(page);
  const form = page.locator('[data-checkout-form]');
  if (await form.count()) await form.scrollIntoViewIfNeeded().catch(() => {});
  await asentar(page);
}

async function instalarPerfilLento(page, ms) {
  await page.evaluate(async (espera) => {
    const fabrica = await import(new URL('js/repositories/repository_factory.js', location.href).href);
    const repo = fabrica.getOrderRepository();
    const original = repo.customerProfiles.load.bind(repo.customerProfiles);
    repo.customerProfiles.load = async (...args) => {
      await new Promise((r) => setTimeout(r, espera));
      return original(...args);
    };
    const checkout = await import(new URL('js/customer-delivery.js', location.href).href);
    checkout.resetCustomerDeliveryForTests();
    checkout.refreshCustomerDeliveryCheckout();
  }, ms);
}

function medirCheckout(page) {
  return page.evaluate(() => {
    const seccion = document.querySelector('[data-profile-checkout]');
    const form = document.querySelector('[data-checkout-form]');
    const alto = (n) => (n ? Math.round(n.getBoundingClientRect().height) : -1);
    return {
      fase: seccion?.dataset.checkoutPhase || 'sin-fase',
      altoSeccion: alto(seccion),
      altoFormulario: alto(form),
      camposVisibles: form
        ? [...form.querySelectorAll('input, select, textarea')]
          .filter((n) => n.type !== 'hidden' && n.getBoundingClientRect().height > 0).length
        : -1,
    };
  });
}

function medirAviso(page) {
  return page.evaluate(() => {
    const caja = (n) => {
      if (!n) return null;
      const r = n.getBoundingClientRect();
      return { top: Math.round(r.top), alto: Math.round(r.height) };
    };
    const flotante = document.querySelector('[data-toast]');
    const banda = document.querySelector('[data-cart-notice]');
    const encabezado = document.querySelector('[data-view="cart"] .view-title');
    const visible = (n) => Boolean(n) && !n.hidden && getComputedStyle(n).display !== 'none'
      && !n.classList.contains('hidden');
    const rectos = (n) => (n ? n.getBoundingClientRect() : null);
    const a = visible(flotante) ? rectos(flotante) : (visible(banda) ? rectos(banda) : null);
    const c = rectos(encabezado);
    const cruza = Boolean(a && c) && !(a.bottom <= c.top || c.bottom <= a.top || a.right <= c.left || c.right <= a.left);
    return {
      flotanteVisible: visible(flotante),
      flotante: caja(flotante),
      bandaVisible: visible(banda),
      banda: caja(banda),
      encabezado: caja(encabezado),
      tapaElEncabezado: cruza,
    };
  });
}

async function asentar(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    // Con tope: `getAnimations()` incluye animaciones INFINITAS —el aro del
    // logo, por ejemplo— cuyo `finished` no resuelve nunca. Esperarlas a secas
    // cuelga el guion para siempre. Lo que hace falta es que las transiciones
    // de entrada terminen, y ésas duran como mucho `--motion-duration-slow`.
    await Promise.race([
      Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
      new Promise((r) => setTimeout(r, 400)),
    ]);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  await page.waitForTimeout(280);
}

async function shot(page, nombre) {
  await page.screenshot({ path: path.join(OUT, nombre), fullPage: false });
}

async function levantarServidor() {
  server = spawn(process.execPath, ['scripts/realtime-relay.mjs', String(PORT)], {
    cwd: path.resolve('.'),
    stdio: 'ignore',
    windowsHide: true,
  });
  for (let intento = 0; intento < 40; intento += 1) {
    try {
      const respuesta = await fetch(`${BASE}/`);
      if (respuesta.ok) return;
    } catch (_) { /* todavía no levantó */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('El servidor estático no respondió.');
}

async function pararServidor() {
  if (!server) return;
  server.kill();
  server = null;
}
