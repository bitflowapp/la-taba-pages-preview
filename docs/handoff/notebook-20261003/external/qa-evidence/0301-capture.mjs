/**
 * v2 — captura y medición de los prototipos focales.
 * Usa el Playwright del repositorio en modo LECTURA. No escribe nada allí.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('C:/1212/la-taba-catalog-checkout-premium/node_modules/playwright/index.js');

const BASE = 'C:/1212/artifacts/taba-opus-design-review/2026-07-31-v2';
const OUT = path.join(BASE, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const url = (file, params = {}) => {
  const u = pathToFileURL(path.join(BASE, 'prototypes', file));
  u.search = new URLSearchParams({ chrome: '0', ...params }).toString();
  return u.href;
};

/** [nombre, archivo, params, ancho, alto] */
const SHOTS = [
  // ── Flujo de compra (nuevo en v2) ────────────────────────────────────────
  ['checkout-cart-390x844',        'prototype-checkout-mobile.html', { view: 'cart' },     390, 844],
  ['checkout-cart-320x568',        'prototype-checkout-mobile.html', { view: 'cart' },     320, 568],
  ['checkout-empty-390x844',       'prototype-checkout-mobile.html', { view: 'empty' },    390, 844],
  ['checkout-form-390x844',        'prototype-checkout-mobile.html', { view: 'checkout' }, 390, 844],
  ['checkout-form-430x932',        'prototype-checkout-mobile.html', { view: 'checkout' }, 430, 932],
  ['checkout-invalid-390x844',     'prototype-checkout-mobile.html', { view: 'invalid' },  390, 844],
  ['checkout-noaddress-390x844',   'prototype-checkout-mobile.html', { view: 'noaddr' },   390, 844],
  ['checkout-pickup-390x844',      'prototype-checkout-mobile.html', { view: 'pickup' },   390, 844],
  ['checkout-success-390x844',     'prototype-checkout-mobile.html', { view: 'success' },  390, 844],
  // Teclado virtual abierto: proxy de altura reducida (iPhone con teclado ≈ 420px útiles)
  ['checkout-keyboard-390x420',    'prototype-checkout-mobile.html', { view: 'checkout' }, 390, 420],
  ['checkout-cart-keyboard-390x420','prototype-checkout-mobile.html',{ view: 'cart' },     390, 420],

  // ── Negocio desktop: hoja de detalle en tablet (hueco de v1) ─────────────
  ['business-tablet-768x1024',       'prototype-business-desktop.html', { state: 'queue' }, 768, 1024],
  ['business-tablet-sheet-768x1024', 'prototype-business-desktop.html', { state: 'queue', sheet: '1' }, 768, 1024],
  ['business-desktop-1440x1000',     'prototype-business-desktop.html', { state: 'queue' }, 1440, 1000],

  // ── Rider: pantallas nuevas + mapa ──────────────────────────────────────
  ['rider-on-the-way-390x844',   'prototype-rider-android.html', { screen: 'ontheway' },  390, 844],
  ['rider-expired-390x844',      'prototype-rider-android.html', { screen: 'expired' },   390, 844],
  ['rider-cancelled-390x844',    'prototype-rider-android.html', { screen: 'cancelled' }, 390, 844],
  ['rider-absent-390x844',       'prototype-rider-android.html', { screen: 'absent' },    390, 844],
  ['rider-history-390x844',      'prototype-rider-android.html', { screen: 'history' },   390, 844],
  ['rider-settings-390x844',     'prototype-rider-android.html', { screen: 'settings' },  390, 844],

  // ── Catálogo: correcciones focales ──────────────────────────────────────
  ['catalog-mobile-390x844',     'prototype-catalog-mobile.html', { state: 'default' }, 390, 844],
  ['catalog-mobile-cart-390x844','prototype-catalog-mobile.html', { state: 'cart' },    390, 844],
  ['catalog-mobile-320x568',     'prototype-catalog-mobile.html', { state: 'cart' },    320, 568],
  ['catalog-mobile-variants-390x844','prototype-catalog-mobile.html',{ state: 'variants' }, 390, 844],
];

const only = process.argv[2] || null;
const browser = await chromium.launch();
const results = [];

for (const [name, file, params, w, h] of SHOTS) {
  if (only && !name.includes(only)) continue;
  const target = path.join(BASE, 'prototypes', file);
  if (!fs.existsSync(target)) { console.log('skip (falta):', file); continue; }

  const ctx = await browser.newContext({
    viewport: { width: w, height: h }, deviceScaleFactor: 2,
    isMobile: w <= 500, hasTouch: w <= 820, reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await page.goto(url(file, params), { waitUntil: 'load' });
  await page.waitForTimeout(320);

  const audit = await page.evaluate(() => {
    const de = document.documentElement;
    const overflowPx = Math.max(0, de.scrollWidth - de.clientWidth);
    const small = [];
    document.querySelectorAll('button,a[href],input,select,textarea,[role="button"],[role="radio"]').forEach(el => {
      if (el.closest('[data-demo]')) return;
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) return;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') return;
      if (r.height < 43.5 || r.width < 23.5)
        small.push({ el: el.tagName.toLowerCase() + '.' + (el.className || '').toString().split(' ')[0],
          w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent || '').trim().slice(0, 22) });
    });
    const smallInputs = [...document.querySelectorAll('input,select,textarea')]
      .filter(el => parseFloat(getComputedStyle(el).fontSize) < 15.9).map(el => el.type || el.tagName);
    return { overflowPx, small: small.slice(0, 12), smallInputs };
  });

  // ¿El stack inferior tapa contenido al final del scroll?
  const bottomCover = await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    return new Promise(res => requestAnimationFrame(() => {
      const stack = [...document.querySelectorAll('.t-bottomnav,.t-sticky-cta,.b-actionbar,.f-action,.r-actions')]
        .filter(el => !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).position === 'fixed');
      if (!stack.length) return res({ checked: false, covered: [] });
      const top = Math.min(...stack.map(el => el.getBoundingClientRect().top));
      const covered = [];
      document.querySelectorAll('main *').forEach(el => {
        if (!el.textContent || !el.textContent.trim() || el.children.length) return;
        const r = el.getBoundingClientRect();
        if (r.height && r.top < innerHeight && r.bottom > top + 1 && r.top < top)
          covered.push(el.textContent.trim().slice(0, 30));
      });
      res({ checked: true, topOfStack: Math.round(top), covered: covered.slice(0, 5) });
    }));
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(120);

  await page.screenshot({ path: path.join(OUT, name + '.png') });
  results.push({ name, viewport: `${w}x${h}`, file, params, errors, ...audit, bottomCover });

  const bad = errors.length || audit.overflowPx > 0 || audit.small.length || audit.smallInputs.length || (bottomCover.covered || []).length;
  console.log((bad ? 'WARN ' : 'ok   ') + name +
    (audit.overflowPx ? ` overflow=${audit.overflowPx}` : '') +
    (audit.small.length ? ` small=${audit.small.length}` : '') +
    (audit.smallInputs.length ? ` inputFont<16=${audit.smallInputs.length}` : '') +
    ((bottomCover.covered || []).length ? ` covered=${bottomCover.covered.length}` : '') +
    (errors.length ? ' ERR=' + errors[0].slice(0, 80) : ''));
  if (audit.small.length) console.log('      small:', JSON.stringify(audit.small.slice(0, 4)));
  if ((bottomCover.covered || []).length) console.log('      covered:', bottomCover.covered.join(' | '));

  await ctx.close();
}

await browser.close();
fs.writeFileSync(path.join(BASE, 'diagnostics', 'v2-results.json'), JSON.stringify(results, null, 2));
console.log('\nCapturas v2:', results.length, '→', OUT);
