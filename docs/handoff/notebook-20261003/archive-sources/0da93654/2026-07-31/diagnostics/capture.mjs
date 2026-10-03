/**
 * Captura y validación de los prototipos de la propuesta.
 * Usa el Playwright ya instalado en node_modules del repositorio (sólo lectura).
 * No escribe absolutamente nada dentro del repositorio.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('C:/1212/la-taba-catalog-checkout-premium/node_modules/playwright/index.js');

const BASE = 'C:/1212/artifacts/taba-opus-design-review/2026-07-31';
const OUT = path.join(BASE, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const url = (file, params = {}) => {
  const u = pathToFileURL(path.join(BASE, 'prototypes', file));
  u.search = new URLSearchParams({ chrome: '0', ...params }).toString();
  return u.href;
};

/** name, file, params, width, height, fullPage */
const SHOTS = [
  // ── Negocio ───────────────────────────────────────────────────────────────
  ['business-mobile-home-390x844',        'prototype-business-mobile.html', { state: 'queue' },   390, 844],
  ['business-mobile-home-430x932',        'prototype-business-mobile.html', { state: 'queue' },   430, 932],
  ['business-mobile-order-detail-390x844','prototype-business-mobile.html', { state: 'detail' },  390, 844],
  ['business-mobile-offline-390x844',     'prototype-business-mobile.html', { state: 'offline' }, 390, 844],
  ['business-mobile-empty-390x844',       'prototype-business-mobile.html', { state: 'empty' },   390, 844],
  ['business-mobile-sections-390x844',    'prototype-business-mobile.html', { state: 'queue', view: 'local' }, 390, 844],
  ['business-tablet-768x1024',            'prototype-business-desktop.html',{ state: 'queue' },   768, 1024],
  ['business-desktop-1280x900',           'prototype-business-desktop.html',{ state: 'queue' },  1280, 900],
  ['business-desktop-1440x1000',          'prototype-business-desktop.html',{ state: 'queue' },  1440, 1000],
  ['business-desktop-1920x1080',          'prototype-business-desktop.html',{ state: 'queue' },  1920, 1080],
  ['business-desktop-1024x768',           'prototype-business-desktop.html',{ state: 'queue' },  1024, 768],
  // ── Catálogo ──────────────────────────────────────────────────────────────
  ['catalog-mobile-320x568',        'prototype-catalog-mobile.html', { state: 'cart' },    320, 568],
  ['catalog-mobile-390x844',        'prototype-catalog-mobile.html', { state: 'default' }, 390, 844],
  ['catalog-mobile-cart-390x844',   'prototype-catalog-mobile.html', { state: 'cart' },    390, 844],
  ['catalog-mobile-430x932',        'prototype-catalog-mobile.html', { state: 'cart' },    430, 932],
  ['catalog-mobile-home-390x844',   'prototype-catalog-mobile.html', { state: 'default', view: 'home' }, 390, 844],
  ['catalog-mobile-detail-390x844', 'prototype-catalog-mobile.html', { state: 'detail' },  390, 844],
  ['catalog-mobile-empty-390x844',  'prototype-catalog-mobile.html', { state: 'empty' },   390, 844],
  ['catalog-mobile-pending-390x844','prototype-catalog-mobile.html', { state: 'pending' }, 390, 844],
  ['catalog-mobile-loading-390x844','prototype-catalog-mobile.html', { state: 'loading' }, 390, 844],
  ['catalog-tablet-768x1024',       'prototype-catalog-desktop.html',{ state: 'cart' },    768, 1024],
  ['catalog-desktop-1024x768',      'prototype-catalog-desktop.html',{ state: 'cart' },   1024, 768],
  ['catalog-desktop-1280x900',      'prototype-catalog-desktop.html',{ state: 'cart' },   1280, 900],
  ['catalog-desktop-1440x1000',     'prototype-catalog-desktop.html',{ state: 'cart' },  1440, 1000],
  ['catalog-desktop-1920x1080',     'prototype-catalog-desktop.html',{ state: 'cart' },  1920, 1080],
  // ── Rider Android ─────────────────────────────────────────────────────────
  ['rider-login-390x844',         'prototype-rider-android.html', { screen: 'login' },     390, 844],
  ['rider-home-390x844',          'prototype-rider-android.html', { screen: 'home' },      390, 844],
  ['rider-orders-390x844',        'prototype-rider-android.html', { screen: 'orders' },    390, 844],
  ['rider-order-detail-390x844',  'prototype-rider-android.html', { screen: 'detail' },    390, 844],
  ['rider-at-store-390x844',      'prototype-rider-android.html', { screen: 'atstore' },   390, 844],
  ['rider-pickup-390x844',        'prototype-rider-android.html', { screen: 'pickup' },    390, 844],
  ['rider-on-the-way-390x844',    'prototype-rider-android.html', { screen: 'ontheway' },  390, 844],
  ['rider-arriving-390x844',      'prototype-rider-android.html', { screen: 'arriving' },  390, 844],
  ['rider-delivery-code-390x844', 'prototype-rider-android.html', { screen: 'code' },      390, 844],
  ['rider-code-error-390x844',    'prototype-rider-android.html', { screen: 'codeerror' }, 390, 844],
  ['rider-incident-390x844',      'prototype-rider-android.html', { screen: 'incident' },  390, 844],
  ['rider-offline-390x844',       'prototype-rider-android.html', { screen: 'offline' },   390, 844],
  ['rider-recovered-390x844',     'prototype-rider-android.html', { screen: 'recovered' }, 390, 844],
  ['rider-shiftend-390x844',      'prototype-rider-android.html', { screen: 'shiftend' },  390, 844],
];

const only = process.argv[2] || null;

const browser = await chromium.launch();
const results = [];

for (const [name, file, params, w, h] of SHOTS) {
  if (only && !name.includes(only)) continue;
  const target = path.join(BASE, 'prototypes', file);
  if (!fs.existsSync(target)) { console.log('skip (falta prototipo):', file); continue; }

  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 2,
    isMobile: w <= 500,
    hasTouch: w <= 820,
    reducedMotion: 'reduce',
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
    const offenders = [];
    if (overflowPx > 0) {
      document.querySelectorAll('*').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width && (r.right > de.clientWidth + 1 || r.left < -1)) {
          offenders.push(el.tagName.toLowerCase() + '.' + (el.className || '').toString().split(' ')[0] +
            ' [' + Math.round(r.left) + '→' + Math.round(r.right) + ']');
        }
      });
    }
    // objetivos táctiles interactivos visibles
    const small = [];
    document.querySelectorAll('button,a[href],input,select,[role="button"]').forEach(el => {
      if (el.closest('[data-demo]')) return;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') return;
      if (r.height < 43.5 || r.width < 23.5) {
        small.push({ el: el.tagName.toLowerCase() + '.' + (el.className || '').toString().split(' ')[0],
          w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent || '').trim().slice(0, 22) });
      }
    });
    // inputs con tipografía < 16px (zoom en iOS)
    const smallInputs = [...document.querySelectorAll('input,select,textarea')]
      .filter(el => parseFloat(getComputedStyle(el).fontSize) < 15.9)
      .map(el => el.name || el.type);
    // el stack inferior no debe tapar contenido en el fondo del scroll
    const fixed = [...document.querySelectorAll('*')].filter(el => {
      const cs = getComputedStyle(el);
      return (cs.position === 'fixed' || cs.position === 'sticky') && el.getBoundingClientRect().height > 0
        && !el.closest('[data-demo]');
    }).map(el => {
      const r = el.getBoundingClientRect();
      return { el: el.tagName.toLowerCase() + '.' + (el.className || '').toString().split(' ')[0],
        pos: getComputedStyle(el).position, z: getComputedStyle(el).zIndex,
        top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) };
    });
    return { overflowPx, offenders: offenders.slice(0, 8), small: small.slice(0, 12), smallInputs, fixed };
  });

  // ¿El stack inferior tapa contenido al final del scroll?
  const bottomCover = await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    return new Promise(res => requestAnimationFrame(() => {
      const stack = [...document.querySelectorAll('.t-bottomnav,.t-sticky-cta,.b-actionbar')]
        .filter(el => getComputedStyle(el).display !== 'none');
      if (!stack.length) return res({ checked: false });
      const topOfStack = Math.min(...stack.map(el => el.getBoundingClientRect().top));
      const covered = [];
      document.querySelectorAll('main *').forEach(el => {
        if (!el.textContent || !el.textContent.trim() || el.children.length) return;
        const r = el.getBoundingClientRect();
        if (r.height && r.top < window.innerHeight && r.bottom > topOfStack + 1 && r.top < topOfStack)
          covered.push((el.textContent || '').trim().slice(0, 30));
      });
      res({ checked: true, topOfStack: Math.round(topOfStack), covered: covered.slice(0, 5) });
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
    (errors.length ? ' ERR=' + errors[0].slice(0, 90) : ''));
  if (audit.small.length) console.log('      small:', JSON.stringify(audit.small.slice(0, 4)));
  if (audit.offenders.length) console.log('      overflow:', audit.offenders.join(' | '));
  if ((bottomCover.covered || []).length) console.log('      covered:', bottomCover.covered.join(' | '));

  await ctx.close();
}

await browser.close();
fs.writeFileSync(path.join(BASE, 'diagnostics', 'prototype-results.json'), JSON.stringify(results, null, 2));
console.log('\nCapturas:', results.length, '→', OUT);
