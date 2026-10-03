// Validador precommit. Mide con getBoundingClientRect:
//  - CTA dentro del viewport y no cubierta por la navegación;
//  - texto sin recorte (`text-overflow`/elipsis efectiva);
//  - "Confirmar pedido" posterior en el DOM al resumen de datos;
//  - cero desbordamiento horizontal y cero `pageerror`.
// Vive FUERA del repositorio de producto.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..');
const BASE = process.env.TABA_BASE || 'http://127.0.0.1:8099';

// Publica `shared` en el contexto de la página antes de cada `evaluate`.
const SHARED_SOURCE = `window.shared = ${sharedSource().toString()};`;

const browser = await chromium.launch();
const report = [];

await businessScene('business-mobile-320x700', 320, 700);
await businessScene('business-mobile-360x800', 360, 800);
await businessScene('business-desktop-1280x900', 1280, 900);
await checkoutScene('checkout-mobile-390x844', 390, 844);

await browser.close();

fs.writeFileSync(path.join(outDir, 'precommit-results.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
const failures = report.filter((r) => r.failures.length);
console.log(`escenarios=${report.length} fallos=${failures.length}`);
for (const r of report) {
  console.log(`\n${r.name}`);
  for (const [key, value] of Object.entries(r.checks)) {
    console.log(`  ${r.failures.includes(key) ? 'FALLA' : ' ok  '} ${key}: ${JSON.stringify(value)}`);
  }
}

async function newPage(width, height, seedPayload) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.addInitScript(SHARED_SOURCE);
  if (seedPayload) {
    await page.addInitScript((payload) => {
      try {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('la_taba_mvp_v4_state', JSON.stringify(payload.state));
        if (payload.admin) sessionStorage.setItem('la_taba_mvp_v4_admin_unlocked', 'true');
      } catch (_) { /* ignore */ }
    }, seedPayload);
  }
  return { context, page, consoleErrors, pageErrors };
}

async function businessScene(name, width, height) {
  const { context, page, consoleErrors, pageErrors } = await newPage(width, height, { state: seedState(), admin: true });
  await page.goto(`${BASE}/?demo=1#business`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-order-inbox]', { timeout: 20000 });
  await page.waitForTimeout(300);

  const checks = await page.evaluate(() => shared('[data-order-advance]', '.b-bottomnav'));
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  finish(name, checks, consoleErrors, pageErrors);
  await context.close();
}

async function checkoutScene(name, width, height) {
  const { context, page, consoleErrors, pageErrors } = await newPage(width, height, null);
  await page.goto(`${BASE}/?demo=1#catalog`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-product-grid] .product-card', { timeout: 20000 });
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.waitForTimeout(300);
  await page.locator('[data-floating-cart]').click();
  await page.waitForSelector('[data-checkout-form]:not([hidden])', { timeout: 20000 });
  await page.waitForTimeout(3200); // el aviso efímero se retira solo

  const checks = await page.evaluate(() => {
    const base = shared('[data-checkout-submit]', '.mobile-nav', { scrollToCta: true });
    // El botón de confirmar debe venir DESPUÉS, en orden de documento, de los
    // datos que el cliente tiene que revisar antes de decidir.
    const form = document.querySelector('[data-checkout-form]');
    const submit = form.querySelector('[data-checkout-submit]');
    const order = (node) => (node
      ? (submit.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING) !== 0
      : null);
    const summary = form.querySelector('[data-order-summary]');
    const prerequisites = {
      contacto: order(form.querySelector('[data-profile-summary]')),
      direccion: order(form.querySelector('[data-address-field]')),
      pago: order(form.querySelector('.checkout-payment-field')),
      indicaciones: order(form.querySelector('.checkout-instructions')),
      resumen: order(summary),
    };
    const summaryVisible = Boolean(summary) && summary.getBoundingClientRect().height > 0;
    return {
      ...base,
      confirmarDespuesDeDatos: prerequisites,
      confirmarDespuesDeTodo: Object.values(prerequisites).every((v) => v === true),
      resumenVisible: summaryVisible,
      // Perfil sigue siendo la autoridad: el checkout no edita cliente ni
      // direcciones, sólo lee.
      perfilEsAutoridad: form.querySelectorAll('input[name="customerName"]:not([type="hidden"]), input[name="customerPhone"]:not([type="hidden"])').length === 0,
      contratosData: [
        'data-checkout-form', 'data-checkout-submit', 'data-order-summary',
        'data-address-field', 'data-customer-addresses', 'data-checkout-warning',
        'data-age-confirmation', 'data-checkout-mode-note',
      ].filter((attr) => !document.querySelector(`[${attr}]`)),
    };
  });
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  finish(name, checks, consoleErrors, pageErrors);
  await context.close();
}

function finish(name, checks, consoleErrors, pageErrors) {
  const failures = [];
  if (checks.ctaEnViewport === false) failures.push('ctaEnViewport');
  if (checks.ctaCubiertaPorNav === true) failures.push('ctaCubiertaPorNav');
  if (checks.textosRecortados?.length) failures.push('textosRecortados');
  if (checks.targetsChicos?.length) failures.push('targetsChicos');
  if (checks.overflowHorizontal > 1) failures.push('overflowHorizontal');
  if (checks.confirmarDespuesDeTodo === false) failures.push('confirmarDespuesDeTodo');
  if (checks.resumenVisible === false) failures.push('resumenVisible');
  if (checks.perfilEsAutoridad === false) failures.push('perfilEsAutoridad');
  if (checks.contratosData?.length) failures.push('contratosData');
  if (checks.contenidoTapadoPorNav?.length) failures.push('contenidoTapadoPorNav');
  if (consoleErrors.length) failures.push('consola');
  if (pageErrors.length) failures.push('pageerror');
  report.push({
    name,
    checks: { ...checks, consola: consoleErrors, pageerror: pageErrors },
    failures,
  });
}

// Se inyecta en la página: mediciones comunes a todos los escenarios.
function sharedSource() {
  return function shared(ctaSelector, navSelector, options) {
    const scrollToCta = Boolean(options && options.scrollToCta);
    const isRendered = (node) => !node.closest('details:not([open]) > *:not(summary)')
      && !node.closest('.sr-only');
    const isVisible = (node) => {
      const r = node.getBoundingClientRect();
      const cs = getComputedStyle(node);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden'
        && cs.display !== 'none' && Number(cs.opacity) > 0 && isRendered(node);
    };
    const view = document.querySelector('.app-view:not([hidden])');
    const nav = document.querySelector(navSelector);
    const navRect = nav && isVisible(nav) ? nav.getBoundingClientRect() : null;
    const cta = [...document.querySelectorAll(ctaSelector)].filter(isVisible)[0] || null;
    // La decisión del panel tiene que verse sin desplazarse. La del checkout
    // vive al final del formulario, después de los datos: ahí lo que se mide
    // es que al llegar entre entera y no quede bajo la navegación.
    if (cta && scrollToCta) {
      cta.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
    const ctaRect = cta ? cta.getBoundingClientRect() : null;
    const navRectNow = nav && isVisible(nav) ? nav.getBoundingClientRect() : navRect;

    // Recorte real. Dos formas de detectarlo:
    //  a) hoja de texto cuyo contenido no entra en su caja;
    //  b) cualquier caja que declare `text-overflow: ellipsis` y esté
    //     desbordada — es donde vive la elipsis aunque el texto sea un hijo.
    const clipCandidates = [...document.querySelectorAll('.topbar *, .app-view:not([hidden]) *')]
      .filter(isVisible)
      .filter((n) => {
        const cs = getComputedStyle(n);
        if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') return false;
        const isLeafText = n.children.length === 0 && n.textContent.trim();
        const clipsWithEllipsis = cs.textOverflow === 'ellipsis'
          && (cs.overflow === 'hidden' || cs.overflowX === 'hidden');
        if (!isLeafText && !clipsWithEllipsis) return false;
        if (cs.webkitLineClamp && cs.webkitLineClamp !== 'none') {
          return n.scrollHeight > n.clientHeight + 1;
        }
        return n.scrollWidth > n.clientWidth + 1;
      });
    const clipped = clipCandidates
      .map((n) => `${n.className || n.tagName}|${n.textContent.trim().slice(0, 28)}|${n.scrollWidth}>${n.clientWidth}`);

    const targets = [...view.querySelectorAll('button, a[href], select, input:not([type="hidden"]), [role="button"]')]
      .concat(nav ? [...nav.querySelectorAll('button')] : [])
      .filter(isVisible)
      .map((n) => {
        const target = (n.type === 'radio' || n.type === 'checkbox') ? (n.closest('label') || n) : n;
        return { label: (n.getAttribute('aria-label') || n.textContent || n.name || '').trim().slice(0, 30), r: target.getBoundingClientRect() };
      })
      .filter((x) => x.r.height < 43.5 || x.r.width < 43.5)
      .map((x) => `${x.label}:${Math.round(x.r.width)}x${Math.round(x.r.height)}`);

    // Contenido tapado por la navegación al final del scroll.
    const root = document.scrollingElement ?? document.documentElement;
    window.scrollTo({ top: root.scrollHeight - root.clientHeight, behavior: 'instant' });
    const navBottomRect = nav && isVisible(nav) ? nav.getBoundingClientRect() : null;
    const covered = [];
    if (navBottomRect) {
      const walker = document.createTreeWalker(view, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const owner = node.parentElement;
        const text = node.textContent.trim();
        if (text && owner && isRendered(owner) && owner.offsetParent !== null && !nav.contains(owner)) {
          const range = document.createRange();
          range.selectNodeContents(node);
          const r = range.getBoundingClientRect();
          if (r.width > 0 && r.height > 0
            && r.bottom > navBottomRect.top + 1 && r.top < navBottomRect.bottom - 1
            && r.right > navBottomRect.left + 1 && r.left < navBottomRect.right - 1) {
            covered.push(text.slice(0, 26));
          }
        }
        node = walker.nextNode();
      }
    }
    window.scrollTo({ top: 0, behavior: 'instant' });

    return {
      ctaTexto: cta ? cta.textContent.trim().slice(0, 30) : null,
      ctaRect: ctaRect ? { top: Math.round(ctaRect.top), bottom: Math.round(ctaRect.bottom), h: Math.round(ctaRect.height) } : null,
      navRect: navRectNow ? { top: Math.round(navRectNow.top), bottom: Math.round(navRectNow.bottom) } : null,
      // Dentro del viewport: la CTA entera, no sólo su borde superior.
      ctaDesplazada: scrollToCta,
      ctaEnViewport: Boolean(ctaRect) && ctaRect.top >= 0 && ctaRect.bottom <= window.innerHeight + 0.5,
      ctaCubiertaPorNav: Boolean(ctaRect && navRectNow) && ctaRect.bottom > navRectNow.top + 0.5,
      textosRecortados: [...new Set(clipped)],
      targetsChicos: [...new Set(targets)],
      contenidoTapadoPorNav: [...new Set(covered)],
      overflowHorizontal: document.documentElement.scrollWidth - window.innerWidth,
    };
  };
}


function seedState() {
  const now = Date.now();
  const at = (min) => new Date(now - min * 60000).toISOString();
  const order = (id, name, status, total, mode) => ({
    id,
    customerName: name,
    customerPhone: '2990000001',
    address: 'Mendoza 851, Centro',
    addressDetails: { streetLine: 'Mendoza 851', neighborhood: 'Centro', reference: 'Porton gris', label: 'Mendoza 851, Centro' },
    deliveryMode: mode,
    paymentMethod: 'Efectivo al recibir',
    paymentMethodCode: 'cash',
    notes: 'Sin sal',
    createdAt: at(12),
    status,
    items: [
      { productId: 'red-bull-original-lata-250ml', name: 'Red Bull Energy Drink', icon: '', quantity: 2, unitPrice: 3576, unit: 'unidad' },
      { productId: 'heineken-original-lata-473ml', name: 'Heineken Original', icon: '', quantity: 4, unitPrice: 2900, unit: 'unidad' },
    ],
    subtotal: total,
    deliveryFee: 0,
    total,
    statusHistory: [{ status: 'received', at: at(12) }],
  });
  return {
    schemaVersion: 4,
    dataVersion: 'la-taba-runtime-v2',
    appMode: 'demo',
    orders: [
      order('LT-1042', 'M. Alvarez', 'received', 58900, 'delivery'),
      order('LT-1041', 'J. Perez', 'preparing', 21400, 'delivery'),
      order('LT-1040', 'C. Suarez', 'ready', 17100, 'pickup'),
      order('LT-1039', 'R. Gomez', 'on_the_way', 34200, 'delivery'),
    ],
    lastOrderId: 'LT-1042',
    cart: [],
  };
}
