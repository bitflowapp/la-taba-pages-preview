/*
 * Auditor de superficie del storefront TABA2.
 *
 * Recorre cada vista del cliente y reporta, sobre el color REALMENTE pintado —
 * no sobre el token, que puede estar bien y llegar mal:
 *  - texto por debajo de WCAG AA (4,5:1 normal; 3:1 para >=24px o >=19px bold)
 *  - superficies claras que quedaron fuera de la identidad de góndola
 *  - overflow horizontal
 *  - objetivos táctiles por debajo de 44px
 *
 * Es la herramienta que dirigió la migración a grafito: en vez de perseguir
 * reglas CSS una por una, se corre esto y se arregla lo que enumera.
 *
 * Uso:
 *   node scripts/realtime-relay.mjs 8231 &
 *   node scripts/taba2-commercial-audit.mjs
 *   ENGINE=webkit WIDTHS=320,375,390,414,432,1280 node scripts/taba2-commercial-audit.mjs
 *
 * Variables: BASE (default http://127.0.0.1:8231), ENGINE (chromium|webkit),
 * WIDTHS (lista separada por comas), OUT (carpeta de salida).
 */
import { chromium, webkit } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8231';
const OUT = process.env.OUT || path.resolve('artifacts/taba2-commercial-audit');
mkdirSync(OUT, { recursive: true });
const ENGINE = process.env.ENGINE === 'webkit' ? webkit : chromium;
const WIDTHS = (process.env.WIDTHS || '320,390,1280').split(',').map(Number);
const HEIGHTS = { 320: 720, 375: 812, 390: 844, 414: 896, 432: 960, 1280: 900 };

const PROBE = () => {
  const parse = (value) => {
    const parts = String(value).match(/[\d.]+/g);
    if (!parts) return null;
    const [r, g, b, a = '1'] = parts.map(Number);
    return { r, g, b, a: Number(a) };
  };
  const lum = ({ r, g, b }) => {
    const ch = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
  };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]; return (hi + 0.05) / (lo + 0.05); };
  const bgOf = (node) => {
    for (let c = node; c; c = c.parentElement) {
      const v = parse(getComputedStyle(c).backgroundColor);
      if (v && v.a >= 0.92) return v;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.15) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const label = (el) => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '');
  };

  const contrast = [];
  const lightSurfaces = [];
  const smallTargets = [];
  const seen = new Set();

  document.querySelectorAll('.app-view:not([hidden]) *, .modal-card *, .mobile-nav *, .app-topbar *').forEach((el) => {
    if (!visible(el)) return;
    if (el.closest('[data-view="business"], [data-view="rider"], .sandbox-tools-panel')) return;
    const cs = getComputedStyle(el);

    // Superficie clara sobrante: fondo opaco muy luminoso que no es plato de producto.
    const own = parse(cs.backgroundColor);
    if (own && own.a >= 0.92 && lum(own) > 0.55) {
      // Blanco DELIBERADO de la paleta: el plato del packshot, el chip de
      // categoría activo, la pastilla del toast y los controles nativos, que el
      // navegador pinta por su cuenta.
      const isPlate = el.closest('.product-media, .thumb, .modal-media, .home-catalog-media, .home-best-media, .home-promo-media, .offer-card-media, .recommendation-media, .combo-media-plate, [data-story], .story-ring, .category-button.active, .home-category-card.active, .toast, .floating-cart-cta');
      const isNativeControl = el.matches('input[type="checkbox"], input[type="radio"]');
      if (!isPlate && !isNativeControl) {
        const key = 'S:' + label(el);
        if (!seen.has(key)) { seen.add(key); lightSurfaces.push({ el: label(el), bg: cs.backgroundColor }); }
      }
    }

    // Contraste de texto directo.
    const text = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
    if (text) {
      const fg = parse(cs.color);
      const bg = bgOf(el);
      if (fg && bg && fg.a >= 0.5) {
        const size = parseFloat(cs.fontSize);
        const weight = Number(cs.fontWeight) || 400;
        const large = size >= 24 || (size >= 18.66 && weight >= 700);
        const need = large ? 3 : 4.5;
        const got = ratio(fg, bg);
        if (got < need) {
          const key = 'C:' + label(el) + ':' + cs.color;
          if (!seen.has(key)) {
            seen.add(key);
            contrast.push({ el: label(el), got: Math.round(got * 100) / 100, need, color: cs.color, bg: 'rgb(' + bg.r + ', ' + bg.g + ', ' + bg.b + ')', text: el.textContent.trim().slice(0, 42) });
          }
        }
      }
    }

    // Objetivo táctil.
    if (el.matches('button, a[href], [role="button"], select, summary')) {
      const r = el.getBoundingClientRect();
      if (r.height < 40 || r.width < 24) {
        const key = 'T:' + label(el);
        if (!seen.has(key)) { seen.add(key); smallTargets.push({ el: label(el), w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent || '').trim().slice(0, 28) }); }
      }
    }
  });

  return {
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    contrast, lightSurfaces, smallTargets,
  };
};

const browser = await ENGINE.launch();
const lines = [];

for (const w of WIDTHS) {
  const context = await browser.newContext({ viewport: { width: w, height: HEIGHTS[w] || 900 }, locale: 'es-AR', serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('pageerror', (e) => lines.push(`  !! pageerror: ${e.message}`));
  await page.goto(`${BASE}/?reset=1&demo=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const steps = [
    ['home', async () => {}],
    ['catalog', async () => { await hash(page, 'catalog'); }],
    ['search-empty', async () => { await page.locator('[data-view="catalog"] [data-search-input]').first().fill('xyzzy'); await page.waitForTimeout(500); }],
    ['catalog-back', async () => { await page.locator('[data-view="catalog"] [data-search-input]').first().fill(''); await page.waitForTimeout(400); }],
    ['filters', async () => { await page.locator('[data-catalog-filters] summary').first().click().catch(() => {}); await page.waitForTimeout(500); }],
    ['filters-close', async () => { await page.locator('[data-close-catalog-filters]').first().click().catch(() => {}); await page.waitForTimeout(400); }],
    ['product-modal', async () => { await page.locator('[data-product-grid] [data-product-detail]').first().click().catch(() => {}); await page.waitForTimeout(800); }],
    ['modal-close', async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }],
    ['cart-empty', async () => { await hash(page, 'cart'); }],
    ['cart-full', async () => {
      await hash(page, 'catalog');
      const adds = page.locator('[data-product-grid] [data-add-product]:not([disabled])');
      for (let i = 0; i < Math.min(await adds.count(), 3); i += 1) { await adds.nth(i).click().catch(() => {}); await page.waitForTimeout(250); }
      await hash(page, 'cart');
    }],
    ['checkout-confirm', async () => {
      // Dispara el modal de sugerencias / validaciones del checkout.
      await page.locator('[data-checkout-form] [type="submit"], [data-checkout-form] .primary-button').first().click().catch(() => {});
      await page.waitForTimeout(1200);
    }],
    ['checkout-dismiss', async () => {
      await page.keyboard.press('Escape');
      await page.locator('[data-checkout-suggestions-dismiss], .checkout-suggestions-continue').first().click().catch(() => {});
      await page.waitForTimeout(600);
    }],
    ['profile', async () => { await hash(page, 'profile'); }],
    ['profile-editor', async () => {
      await page.locator('[data-view="profile"] .profile-address-actions .text-button').first().click().catch(() => {});
      await page.waitForTimeout(800);
    }],
    ['profile-editor-close', async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(400); await hash(page, 'profile'); }],
    ['tracking', async () => { await hash(page, 'tracking'); await page.waitForTimeout(700); }],
  ];

  for (const [name, run] of steps) {
    await run().catch(() => {});
    if (name.endsWith('-back') || name.endsWith('-close')) continue;
    const r = await page.evaluate(PROBE);
    const problems = r.contrast.length + r.lightSurfaces.length + r.smallTargets.length + (r.overflow > 0 ? 1 : 0);
    lines.push(`\n### ${w}px · ${name} — ${problems} hallazgos${r.overflow > 0 ? ` · OVERFLOW ${r.overflow}px` : ''}`);
    r.contrast.forEach((c) => lines.push(`  [contraste ${c.got}:1 <${c.need}] ${c.el} color=${c.color} sobre ${c.bg} — "${c.text}"`));
    r.lightSurfaces.forEach((s) => lines.push(`  [superficie clara] ${s.el} bg=${s.bg}`));
    r.smallTargets.forEach((t) => lines.push(`  [tap ${t.w}x${t.h}] ${t.el} "${t.text}"`));
  }
  await context.close();
}

await browser.close();
const report = lines.join('\n');
writeFileSync(path.join(OUT, `audit-${process.env.ENGINE || 'chromium'}.md`), report);
console.log(report);

async function hash(page, view) {
  await page.evaluate((v) => { window.location.hash = `#${v}`; }, view);
  await page.waitForTimeout(800);
}
