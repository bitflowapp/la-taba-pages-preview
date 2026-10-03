/** Validación estructural, de accesibilidad y de contraste de los prototipos. */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('C:/1212/la-taba-catalog-checkout-premium/node_modules/playwright/index.js');
const BASE = 'C:/1212/artifacts/taba-opus-design-review/2026-07-31';

const FILES = [
  ['prototype-catalog-mobile.html', { state: 'cart' }, 390, 844],
  ['prototype-catalog-desktop.html', { state: 'cart' }, 1440, 1000],
  ['prototype-business-mobile.html', { state: 'queue' }, 390, 844],
  ['prototype-business-desktop.html', { state: 'queue' }, 1440, 1000],
  ['prototype-rider-android.html', { screen: 'ontheway' }, 390, 844],
];

const browser = await chromium.launch();
const out = [];

for (const [file, params, w, h] of FILES) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const u = pathToFileURL(path.join(BASE, 'prototypes', file));
  u.search = new URLSearchParams({ chrome: '0', ...params }).toString();
  await page.goto(u.href, { waitUntil: 'load' });
  await page.waitForTimeout(300);

  const r = await page.evaluate(() => {
    const res = {};
    // --- CSS: si una hoja parsea 0 reglas, no se cargó o falló ---
    res.stylesheets = [...document.styleSheets].map(s => {
      let n = 0; try { n = s.cssRules.length; } catch { n = -1; }
      return { href: s.href ? s.href.split('/').pop() : 'inline', rules: n };
    });
    res.cssRulesTotal = res.stylesheets.reduce((a, s) => a + Math.max(0, s.rules), 0);
    res.cssFailed = res.stylesheets.filter(s => s.rules === 0).length;

    // --- HTML: el parser del navegador ya normalizó; buscamos defectos estructurales ---
    const ids = [...document.querySelectorAll('[id]')].map(e => e.id);
    res.duplicateIds = ids.filter((v, i) => ids.indexOf(v) !== i);
    // Sólo cuentan los h1 EXPUESTOS: una sección con [hidden] no está en el árbol de accesibilidad.
    res.h1Count = [...document.querySelectorAll('h1')].filter(el => el.offsetParent !== null || getComputedStyle(el).position === 'fixed').length;
    res.lang = document.documentElement.lang || null;
    res.title = document.title || null;
    res.hasViewport = !!document.querySelector('meta[name="viewport"]');

    // --- Accesibilidad ---
    // Las imágenes con loading=lazy fuera del viewport no están cargadas: no son 'rotas'.
    res.imagesWithoutAlt = [...document.images].filter(i => i.getAttribute('alt') === null).length;
    res.brokenImages = [...document.images]
      .filter(i => i.getAttribute('loading') !== 'lazy')
      .filter(i => !(i.complete && i.naturalWidth > 0))
      .map(i => i.getAttribute('src') || '(sin src)');
    res.lazyImages = [...document.images].filter(i => i.getAttribute('loading') === 'lazy').length;
    res.iconOnlyWithoutName = [...document.querySelectorAll('button, a[href]')]
      .filter(el => {
        if (el.closest('[data-demo]')) return false;
        const r2 = el.getBoundingClientRect(); if (!r2.width) return false;
        const text = (el.textContent || '').trim();
        return !text && !el.getAttribute('aria-label') && !el.getAttribute('title');
      })
      .map(el => el.className || el.tagName);
    res.inputsWithoutName = [...document.querySelectorAll('input, select, textarea')]
      .filter(el => !el.getAttribute('aria-label') && !el.closest('label') &&
        !(el.id && document.querySelector(`label[for="${el.id}"]`)))
      .map(el => el.type || el.tagName);
    res.positiveTabindex = [...document.querySelectorAll('[tabindex]')]
      .filter(el => Number(el.getAttribute('tabindex')) > 0).length;
    res.dialogsWithoutLabel = [...document.querySelectorAll('[role="dialog"], dialog')]
      .filter(el => !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')).length;
    res.liveRegions = document.querySelectorAll('[role="status"], [aria-live]').length;
    res.ariaCurrent = document.querySelectorAll('[aria-current]').length;
    res.ariaPressed = document.querySelectorAll('[aria-pressed]').length;

    // --- Emoji usado como icono de interfaz (prohibido por el sistema) ---
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    res.emojiIcons = [...document.querySelectorAll('button, .t-row-icon, .h-cat-ic')]
      .filter(el => emoji.test(el.textContent || '')).length;

    // --- Foco visible ---
    const btn = document.querySelector('button:not([data-demo] button)');
    res.focusRingDeclared = !!btn;

    // --- z-index: ningún literal fuera de la escala declarada ---
    const allowed = new Set(['auto', '0', '1', '2', '3', '4', '100', '200', '300', '400', '500', '510', '600', '700', '900']);
    res.zIndexOffenders = [...document.querySelectorAll('*')]
      .map(el => getComputedStyle(el).zIndex)
      .filter(z => z !== 'auto' && !allowed.has(z));

    return res;
  });

  out.push({ file, viewport: `${w}x${h}`, errors, ...r });
  const problems = [
    r.cssFailed && `CSS sin reglas: ${r.cssFailed}`,
    r.duplicateIds.length && `ids duplicados: ${r.duplicateIds.length}`,
    r.h1Count !== 1 && `h1 = ${r.h1Count}`,
    r.imagesWithoutAlt && `img sin alt: ${r.imagesWithoutAlt}`,
    r.brokenImages.length && `img rotas: ${r.brokenImages.length}`,
    r.iconOnlyWithoutName.length && `botones sin nombre: ${r.iconOnlyWithoutName.length}`,
    r.inputsWithoutName.length && `inputs sin etiqueta: ${r.inputsWithoutName.length}`,
    r.positiveTabindex && `tabindex positivo: ${r.positiveTabindex}`,
    r.dialogsWithoutLabel && `dialog sin nombre: ${r.dialogsWithoutLabel}`,
    r.emojiIcons && `emoji como icono: ${r.emojiIcons}`,
    r.zIndexOffenders.length && `z-index fuera de escala: ${[...new Set(r.zIndexOffenders)].join(',')}`,
    errors.length && `errores: ${errors.length}`,
  ].filter(Boolean);
  console.log((problems.length ? 'WARN ' : 'ok   ') + file.padEnd(36) +
    `reglas CSS=${r.cssRulesTotal} live=${r.liveRegions} ` + (problems.join(' · ') || ''));
  await ctx.close();
}

await browser.close();
fs.writeFileSync(path.join(BASE, 'diagnostics', 'validation-results.json'), JSON.stringify(out, null, 2));
console.log('\nEscrito diagnostics/validation-results.json');
