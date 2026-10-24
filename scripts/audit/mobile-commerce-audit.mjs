// Auditoría móvil de la experiencia de compra, medida (no opinada), en tres teléfonos.
//
//   node scripts/audit/mobile-commerce-audit.mjs --base http://127.0.0.1:8080 --out <directorio nuevo> [--query ?demo=1]
//
// Recorre inicio → catálogo → agregar → carrito → checkout (lo envía VACÍO: no crea pedidos) → seguimiento → panel
// y deja por pantalla: desborde horizontal, desplazamiento acumulado del diseño (CLS), objetivos táctiles de menos de
// 44 px, controles sin nombre accesible, imágenes sin `alt`, campos sin etiqueta, errores de consola, precios visibles
// sin desplazar y qué pasa al confirmar un formulario vacío. Capturas en --out. Sólo lee; en modo demo no hay red.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const base = arg('--base', 'http://127.0.0.1:8080');
const query = arg('--query', '?demo=1');
const out = path.resolve(arg('--out', ''));
if (!arg('--out') || fs.existsSync(out)) throw new Error('--out debe ser un directorio nuevo');
fs.mkdirSync(out, { recursive: true });

const VIEWPORTS = [
  { name: 'android-360', width: 360, height: 740 },
  { name: 'iphone-390', width: 390, height: 844 },
  { name: 'chico-320', width: 320, height: 568 },
];

/** Lo que se mide en cada pantalla, dentro de la página. */
function measure() {
  const visible = (el) => {
    const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };
  const inViewport = (el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; };
  const nameOf = (el) => (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.textContent
    || el.textContent || el.getAttribute('title') || el.querySelector('img[alt]')?.getAttribute('alt') || '').trim();
  const controls = [...document.querySelectorAll('button, a[href], [role=button], input, select, textarea, summary')].filter(visible);
  const tappable = controls.filter((el) => !['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) || ['checkbox', 'radio', 'submit', 'button'].includes(el.type));
  const small = tappable.filter((el) => { const r = el.getBoundingClientRect(); return (r.width < 44 || r.height < 44) && inViewport(el); });
  const unnamed = controls.filter((el) => !['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) && !nameOf(el));
  const fields = [...document.querySelectorAll('input:not([type=hidden]), select, textarea')].filter(visible);
  const unlabeled = fields.filter((f) => !(f.labels?.length || f.getAttribute('aria-label') || f.getAttribute('aria-labelledby') || f.getAttribute('title')));
  const imgs = [...document.images].filter(visible);
  const prices = [...document.querySelectorAll('body *')].filter((el) => el.children.length === 0 && /\$\s?\d/.test(el.textContent || '') && visible(el));
  return {
    url: location.hash || location.pathname,
    hScroll: document.documentElement.scrollWidth > innerWidth + 1 ? document.documentElement.scrollWidth - innerWidth : 0,
    smallTargets: small.length,
    smallSample: small.slice(0, 8).map((el) => { const r = el.getBoundingClientRect(); return `${(nameOf(el) || el.tagName).slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`; }),
    unnamedControls: unnamed.length,
    unnamedSample: unnamed.slice(0, 5).map((el) => el.outerHTML.slice(0, 120)),
    fields: fields.length,
    unlabeledFields: unlabeled.length,
    unlabeledSample: unlabeled.slice(0, 5).map((f) => f.outerHTML.slice(0, 120)),
    imagesWithoutAlt: imgs.filter((i) => !i.hasAttribute('alt')).length,
    brokenImages: imgs.filter((i) => i.complete && i.naturalWidth === 0).length,
    pricesAboveFold: prices.filter((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }).length,
    previewBadge: /PREVIEW INTERNA/i.test(document.body.innerText),
    cls: Math.round((window.__tabaCls || 0) * 1000) / 1000,
    text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 300),
  };
}

const report = { at: new Date().toISOString(), base, query, viewports: [] };
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 2,
      isMobile: true, hasTouch: true, locale: 'es-AR', serviceWorkers: 'block' });
    await context.addInitScript(() => {
      window.__tabaCls = 0;
      try {
        new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__tabaCls += e.value; })
          .observe({ type: 'layout-shift', buffered: true });
      } catch { /* sin soporte */ }
    });
    const page = await context.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 200)));
    const screens = [];
    const capture = async (name) => {
      await page.waitForTimeout(900);
      const data = await page.evaluate(measure);
      await page.screenshot({ path: path.join(out, `${viewport.name}-${name}.png`), fullPage: false });
      screens.push({ name, ...data, errorsSoFar: errors.length });
    };
    const step = async (name, action) => {
      try { await action(); await capture(name); } catch (error) { screens.push({ name, failed: error.message.split('\n')[0].slice(0, 200) }); }
    };

    await step('inicio', async () => { await page.goto(`${base}/${query}#home`, { waitUntil: 'networkidle', timeout: 60000 }); await page.waitForTimeout(2500); });
    await step('catalogo', async () => { await page.goto(`${base}/${query}#catalog`, { waitUntil: 'networkidle', timeout: 60000 }); await page.waitForTimeout(1500); });
    await step('agregar', async () => { await page.getByRole('button', { name: /^Agregar/ }).first().click({ timeout: 8000 }); });
    await step('carrito', async () => { await page.goto(`${base}/${query}#cart`, { waitUntil: 'networkidle', timeout: 60000 }); });
    await step('checkout', async () => {
      await page.getByRole('button', { name: /Continuar|Ir a pagar|Finalizar|Hacer pedido|Pedir/i }).first().click({ timeout: 8000 });
    });
    await step('checkout-vacio-enviado', async () => {
      const before = page.url();
      await page.getByRole('button', { name: /Confirmar pedido/i }).first().click({ timeout: 8000 });
      await page.waitForTimeout(800);
      const state = await page.evaluate(() => ({
        invalid: [...document.querySelectorAll('[aria-invalid=true], :invalid')].filter((el) => el.matches('input,select,textarea')).length,
        alerts: [...document.querySelectorAll('[role=alert], [aria-live]')].map((el) => el.textContent.trim()).filter(Boolean).slice(0, 4),
        focused: document.activeElement ? `${document.activeElement.tagName}#${document.activeElement.id || ''}[${document.activeElement.getAttribute('name') || ''}]` : null,
      }));
      screens.push({ name: 'checkout-vacio-estado', ...state, stayedOnCheckout: page.url() === before });
    });
    await step('seguimiento', async () => { await page.goto(`${base}/${query}#tracking`, { waitUntil: 'networkidle', timeout: 60000 }); });
    await step('panel', async () => { await page.goto(`${base}/${query}#business`, { waitUntil: 'networkidle', timeout: 60000 }); await page.waitForTimeout(1500); });
    report.viewports.push({ viewport, screens, consoleErrors: [...new Set(errors)].slice(0, 20) });
    await context.close();
  }
} finally {
  await browser.close();
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
const summary = report.viewports.map(({ viewport, screens, consoleErrors }) => ({ viewport: viewport.name, consoleErrors: consoleErrors.length,
  screens: screens.map((s) => s.failed ? `${s.name}: FALLÓ ${s.failed}` : `${s.name}: hScroll ${s.hScroll ?? '-'} cls ${s.cls ?? '-'} chicos ${s.smallTargets ?? '-'} sinNombre ${s.unnamedControls ?? '-'} sinEtiqueta ${s.unlabeledFields ?? '-'} precios ${s.pricesAboveFold ?? '-'}${s.previewBadge ? ' PREVIEW' : ''}`) }));
console.log(JSON.stringify(summary, null, 1));
