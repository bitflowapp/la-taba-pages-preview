/**
 * Capturas BEFORE/AFTER del pulido de lanzamiento.
 *
 * Un solo guion para las dos corridas: `node scripts/launch-ux-captures.mjs before`
 * y `... after`. Las capturas van a `artifacts/launch-ux-polish/<fase>/` y el
 * informe de medidas a `MEDIDAS.json` de esa misma carpeta, para poder comparar
 * geometría y color computados y no sólo mirar dos PNG uno al lado del otro.
 *
 * No toca red externa, Supabase ni staging: levanta el servidor estático del
 * repo y trabaja sobre el modo demo, igual que el gate E2E.
 */
import { chromium, devices, webkit } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const fase = (process.argv[2] || 'before').replace(/[^a-z]/g, '') || 'before';
const PORT = Number(process.env.TABA_UX_PORT || 8231);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.resolve('artifacts/launch-ux-polish', fase);
mkdirSync(OUT, { recursive: true });

const medidas = {};
let server = null;

try {
  await levantarServidor();
  const browser = await chromium.launch();
  try {
    await recorridoMovil(browser);
    await recorridoEscritorio(browser);
  } finally {
    await browser.close();
  }
  await recorridoWebKit();
} finally {
  await pararServidor();
}

writeFileSync(path.join(OUT, 'MEDIDAS.json'), `${JSON.stringify(medidas, null, 2)}\n`);
console.log(`Capturas en ${OUT}`);

async function recorridoMovil(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  await abrir(page);

  medidas.tokens = await leerTokens(page);
  await shot(page, 'm01-home.png');
  medidas.home = await medirHome(page);

  await irA(page, 'catalog');
  await asentar(page);
  await shot(page, 'm02-catalogo.png');
  medidas.tarjeta = await medirTarjeta(page);

  // Agregar: geometría del CTA antes y del control de cantidad después.
  const boton = page.locator('[data-product-grid] [data-add-product]:not([disabled]) >> visible=true').first();
  const productId = await boton.getAttribute('data-add-product');
  medidas.cta = await medirBoton(page, `[data-add-product="${productId}"]`);
  const cajaAntes = await cajaDe(page, `[data-product-card="${productId}"], [data-add-product="${productId}"]`);
  await boton.click();
  await asentar(page);
  await shot(page, 'm03-cantidad.png');
  medidas.cantidad = {
    ...(await medirCantidad(page, productId)),
    cajaAntes,
    cajaDespues: await cajaDe(page, `[data-product-card="${productId}"], [data-cart-inc="${productId}"]`),
  };
  medidas.barraCarrito = await medirBarraCarrito(page);
  await shot(page, 'm04-barra-carrito.png');

  await page.locator('[data-cart-inc] >> visible=true').first().click();
  await asentar(page);
  await page.locator('[data-open-cart] >> visible=true').first().click();
  await asentar(page);
  await shot(page, 'm05-carrito.png');

  const form = page.locator('[data-checkout-form]');
  if (await form.count()) {
    await form.scrollIntoViewIfNeeded().catch(() => {});
    await asentar(page);
    await shot(page, 'm06-checkout-nuevo.png');
    medidas.checkout = await medirCheckout(page);
  }

  await context.close();
  await recorridoRecurrente(browser);
}

/*
 * El cliente que VUELVE. La compuerta del resumen compacto es un pedido en el
 * historial local, así que la única forma honesta de capturarlo es sembrar ese
 * pedido —con los mismos SKU y precios que el catálogo demo tiene hoy— y dejar
 * que la app lo revalide sola. Nada de forzar la vista desde afuera.
 */
async function recorridoRecurrente(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  await abrir(page);

  const pedido = await page.evaluate(async () => {
    const { getState } = await import(new URL('js/state.js', location.href).href);
    // `isProductOrderable` es la MISMA compuerta que usa la revalidación de la
    // recompra. Filtrar por precio y stock a mano dejaba entrar productos que
    // la góndola no vende, y el pedido sembrado salía entero "no disponible".
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
        productId: p.id,
        name: p.name,
        quantity: i === 0 ? 2 : 1,
        // Precio HISTÓRICO deliberadamente distinto del vigente en el primer
        // renglón: es la única manera de capturar el aviso de cambio de precio.
        unitPrice: i === 0 ? Math.round(Number(p.price) * 0.86) : Number(p.price),
        unit: p.unit || 'unidad',
      })),
      subtotal: 0,
      deliveryFee: 0,
      discountTotal: 0,
      total: comprables.reduce((acc, p, i) => acc + (i === 0 ? 2 : 1) * Math.round(Number(p.price) * (i === 0 ? 0.86 : 1)), 0),
    };
  });
  // Como guion de inicialización y no con `evaluate`: `abrir()` deja instalado
  // un `addInitScript` que vacía el almacenamiento en CADA navegación, así que
  // un valor escrito antes de recargar se pierde. Los guiones se ejecutan en
  // orden de registro: primero el que limpia, después éste.
  await page.addInitScript((entrada) => {
    localStorage.setItem('la_taba_customer_history_v1', JSON.stringify([entrada]));
  }, pedido);
  await page.reload({ waitUntil: 'load' });
  await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached' });
  await asentar(page);
  await shot(page, 'm07-home-recurrente.png');
  medidas.reorder = await page.evaluate(() => {
    const card = document.querySelector('[data-customer-actions] .reorder-card');
    if (!card) return { presente: false };
    return {
      presente: true,
      avisos: [...card.querySelectorAll('[data-reorder-notices] li')].map((n) => n.textContent.trim()),
      totalAnterior: card.querySelector('[data-reorder-previous-total]')?.textContent.trim() || '',
      total: card.querySelector('.reorder-card-side > strong')?.textContent.trim() || '',
    };
  });

  await irA(page, 'catalog');
  await asentar(page);
  await page.locator('[data-product-grid] [data-add-product]:not([disabled]) >> visible=true').first().click();
  await page.locator('[data-cart-inc] >> visible=true').first().click();
  await page.locator('[data-open-cart] >> visible=true').first().click();
  await asentar(page);
  const form = page.locator('[data-checkout-form]');
  await form.scrollIntoViewIfNeeded().catch(() => {});
  await asentar(page);
  await shot(page, 'm08-checkout-recurrente.png');
  medidas.checkoutRecurrente = await medirCheckout(page);
  medidas.checkoutRecurrente.resumen = await page.evaluate(() => {
    const filas = [...document.querySelectorAll('[data-checkout-summary-row]')];
    return filas.map((f) => f.textContent.replace(/\s+/g, ' ').trim());
  });

  const cambiar = page.locator('[data-profile-checkout-action="expand-summary"]').first();
  if (await cambiar.count()) {
    await cambiar.click();
    await asentar(page);
    await shot(page, 'm09-checkout-expandido.png');
    medidas.checkoutExpandido = await medirCheckout(page);
  }
  await context.close();
}

async function recorridoEscritorio(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  await abrir(page);
  await shot(page, 'd01-home.png');
  await irA(page, 'catalog');
  await asentar(page);
  const boton = page.locator('[data-product-grid] [data-add-product]:not([disabled]) >> visible=true').first();
  await boton.click();
  await page.locator('[data-open-cart] >> visible=true').first().click();
  await asentar(page);
  await shot(page, 'd02-checkout.png');
  await context.close();
}

async function recorridoWebKit() {
  const browser = await webkit.launch();
  try {
    const context = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
    const page = await context.newPage();
    await abrir(page);
    await shot(page, 'w01-home-webkit.png');
    await irA(page, 'catalog');
    await asentar(page);
    await shot(page, 'w02-catalogo-webkit.png');
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

async function irA(page, vista) {
  await page.locator(`[data-nav-view="${vista}"] >> visible=true`).first().click();
  await page.locator(`body[data-active-view="${vista}"]`).waitFor({ state: 'attached' });
}

async function asentar(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  await page.waitForTimeout(320);
}

async function shot(page, nombre) {
  await page.screenshot({ path: path.join(OUT, nombre), fullPage: false });
}

function leerTokens(page) {
  return page.evaluate(() => {
    const raiz = getComputedStyle(document.documentElement);
    const nombres = [
      '--brand-bg', '--brand-bg-raised', '--brand-surface', '--brand-surface-hover',
      '--brand-border', '--brand-border-strong', '--brand-ink', '--brand-ink-muted',
      '--shelf', '--shelf-raised', '--shelf-sunken', '--shelf-line', '--shelf-line-strong',
      '--radius-sm', '--radius-md', '--radius-lg', '--radius-control', '--radius-pill',
    ];
    const salida = {};
    nombres.forEach((n) => { salida[n] = raiz.getPropertyValue(n).trim(); });
    salida.bodyBackground = getComputedStyle(document.body).backgroundColor;
    return salida;
  });
}

function medirHome(page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    precios: [...document.querySelectorAll('[data-view="home"] .home-best-card')]
      .filter((n) => n.getBoundingClientRect().top < window.innerHeight).length,
    reorder: !!document.querySelector('[data-customer-actions] .reorder-card'),
  }));
}

function medirTarjeta(page) {
  return page.evaluate(() => {
    const card = document.querySelector('[data-product-grid] .product-card, [data-product-grid] > *');
    if (!card) return null;
    const cs = getComputedStyle(card);
    return {
      background: cs.backgroundColor,
      borderRadius: cs.borderTopLeftRadius,
      border: cs.borderTopWidth + ' ' + cs.borderTopColor,
      boxShadow: cs.boxShadow.slice(0, 80),
    };
  });
}

function medirBoton(page, selector) {
  return page.evaluate((sel) => {
    const nodo = [...document.querySelectorAll(sel)].find((n) => n.getBoundingClientRect().width > 0);
    if (!nodo) return null;
    const cs = getComputedStyle(nodo);
    const r = nodo.getBoundingClientRect();
    return {
      radius: cs.borderTopLeftRadius,
      height: Math.round(r.height * 10) / 10,
      width: Math.round(r.width * 10) / 10,
      background: cs.backgroundColor,
      color: cs.color,
      fontWeight: cs.fontWeight,
      transition: cs.transitionProperty + ' ' + cs.transitionDuration,
    };
  }, selector);
}

function medirCantidad(page, productId) {
  return page.evaluate((id) => {
    const inc = [...document.querySelectorAll(`[data-cart-inc="${id}"]`)].find((n) => n.getBoundingClientRect().width > 0);
    if (!inc) return { presente: false };
    const cs = getComputedStyle(inc);
    const r = inc.getBoundingClientRect();
    return {
      presente: true,
      radius: cs.borderTopLeftRadius,
      height: Math.round(r.height * 10) / 10,
      width: Math.round(r.width * 10) / 10,
      background: cs.backgroundColor,
    };
  }, productId);
}

function medirBarraCarrito(page) {
  return page.evaluate(() => {
    const barra = document.querySelector('[data-floating-cart]');
    if (!barra) return { presente: false };
    const cs = getComputedStyle(barra);
    const r = barra.getBoundingClientRect();
    return {
      presente: true,
      hidden: barra.hidden,
      radius: cs.borderTopLeftRadius,
      height: Math.round(r.height * 10) / 10,
      background: cs.backgroundColor,
      bottom: Math.round(window.innerHeight - r.bottom),
    };
  });
}

function medirCheckout(page) {
  return page.evaluate(() => {
    const form = document.querySelector('[data-checkout-form]');
    if (!form) return { presente: false };
    const campos = [...form.querySelectorAll('input, select, textarea')]
      .filter((n) => n.type !== 'hidden' && n.getBoundingClientRect().height > 0);
    const submit = document.querySelector('[data-checkout-submit]');
    const cs = submit ? getComputedStyle(submit) : null;
    return {
      presente: true,
      camposVisibles: campos.length,
      etiquetas: campos.map((n) => (n.labels?.[0]?.textContent || n.name || n.id || '').trim()).filter(Boolean),
      alturaFormulario: Math.round(form.getBoundingClientRect().height),
      submit: cs ? { radius: cs.borderTopLeftRadius, background: cs.backgroundColor } : null,
    };
  });
}

function cajaDe(page, selector) {
  return page.evaluate((sel) => {
    const nodo = [...document.querySelectorAll(sel)].find((n) => n.getBoundingClientRect().width > 0);
    if (!nodo) return null;
    const contenedor = nodo.closest('.home-best-card, .product-card, article, li') || nodo;
    const r = contenedor.getBoundingClientRect();
    return { width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10 };
  }, selector);
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
