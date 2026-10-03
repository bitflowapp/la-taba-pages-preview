import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('C:/1212/la-taba-catalog-checkout-premium/node_modules/playwright/index.js');
const BASE = 'C:/1212/artifacts/taba-opus-design-review/2026-07-31-v2/closure';
const failures = [];
const results = {};
const visible = el => {
  const style = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return !el.hidden && style.display !== 'none' && style.visibility !== 'hidden' && r.width > 0 && r.height > 0;
};

async function run(name, file, params, width, height, options = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: width < 600, hasTouch: width < 600, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  const supabase = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('request', request => { if (/supabase/i.test(request.url())) supabase.push(request.url()); });
  const url = pathToFileURL(path.join(BASE, file));
  url.search = new URLSearchParams({ chrome: '0', ...params }).toString();
  await page.goto(url.href, { waitUntil: 'load' });
  const audit = await page.evaluate(({ kind }) => {
    const isVisible = el => {
      const style = getComputedStyle(el); const r = el.getBoundingClientRect();
      return !el.hidden && style.display !== 'none' && style.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    };
    const rect = el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
    const overflow = Math.max(0, Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth);
    const targets = [...document.querySelectorAll('button,a[href],input,select,textarea,[role="button"],[role="radio"]')].filter(isVisible).filter(el => !el.closest('[data-demo]')).map(el => ({ text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30), ...rect(el) })).filter(r => r.width < 44 || r.height < 44);
    const stack = [...document.querySelectorAll('.t-bottomnav,.t-sticky-cta,.f-action,.r-actions,.d-sheet-actions')].filter(isVisible).map(rect);
    const stackCovered = [];
    if (stack.length) {
      const top = Math.min(...stack.map(r => r.top));
      document.querySelectorAll('main *,.r-body *,.d-detail *').forEach(el => {
        if (!isVisible(el) || el.children.length || !(el.textContent || '').trim()) return;
        const r = el.getBoundingClientRect();
        if (r.top < top && r.bottom > top) stackCovered.push((el.textContent || '').trim().slice(0, 40));
      });
    }
    const bodyText = document.body.innerText || '';
    const query = document.querySelector('[data-search]')?.value || '';
    const queryTextCount = query ? (bodyText.match(new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length : 0;
    const actionNodes = [...document.querySelectorAll('[data-primary-order-action]')].filter(isVisible);
    const packMedia = document.querySelector('.p-media');
    const packImg = document.querySelector('.p-media img');
    const packRatio = packMedia && packImg ? rect(packImg).height / rect(packMedia).height : null;
    const sync = document.querySelector('[data-sync-label]');
    const syncClipped = sync ? sync.scrollWidth > sync.clientWidth : false;
    const codeLeak = /4\s*7\s*2\s*9/.test(bodyText);
    const codeInputs = [...document.querySelectorAll('[data-code] span')].map(el => (el.textContent || '').trim());
    const actionZone = document.querySelector('.r-actions');
    const primary = document.querySelector('.r-actions .t-btn--lg');
    const slider = document.querySelector('.r-slide');
    const secondaries = [...document.querySelectorAll('.r-actions .r-sec .t-btn')].filter(isVisible).map(rect);
    return { kind, viewport: `${innerWidth}x${innerHeight}`, overflow, targets, stackCovered, stack: stack.map(r => Math.round(r.height)), actionCount: actionNodes.length, actionRect: actionNodes[0] ? rect(actionNodes[0]) : null, packRatio, query, queryTextCount, syncClipped, codeLeak, codeInputs, actionZone: actionZone ? rect(actionZone) : null, primaryHeight: primary ? rect(primary).height : null, sliderHeight: slider ? rect(slider).height : null, secondaryHeights: secondaries.map(r => r.height) };
  }, { kind: options.kind || name });
  results[name] = { ...audit, errors, supabase };
  const fail = (condition, message) => { if (condition) failures.push(`${name}: ${message}`); };
  fail(errors.length > 0, errors.join(' | '));
  fail(supabase.length > 0, `requests Supabase=${supabase.length}`);
  fail(audit.overflow > 0, `overflow horizontal=${audit.overflow}px`);
  if (options.targets) fail(audit.targets.length > 0, `targets menores a 44px=${JSON.stringify(audit.targets.slice(0, 4))}`);
  if (options.stack) fail(audit.stackCovered.length > 0, `contenido tapado=${audit.stackCovered.join(' | ')}`);
  if (options.search) { fail(audit.query !== 'zzzzqqq', 'query sintética no llegó al input'); fail(audit.queryTextCount !== 1, `consulta repetida=${audit.queryTextCount}`); }
  if (options.pack) fail(audit.packRatio < 0.70 || audit.packRatio > 0.82, `packshot ratio=${audit.packRatio}`);
  if (options.business) { fail(audit.actionCount !== 1, `primarias visibles=${audit.actionCount}`); fail(audit.syncClipped, 'sincronización truncada'); fail(audit.codeLeak, 'código correcto visible'); }
  if (options.rider) { fail(audit.actionZone && audit.actionZone.height > 160, `zona rider=${audit.actionZone?.height}`); if (audit.primaryHeight !== null) fail(audit.primaryHeight < 56 || audit.primaryHeight > 64, `CTA primaria=${audit.primaryHeight}`); if (audit.sliderHeight !== null) fail(audit.sliderHeight < 64 || audit.sliderHeight > 72, `slider=${audit.sliderHeight}`); fail(audit.secondaryHeights.some(h => h < 48 || h > 56), `secundarias=${audit.secondaryHeights.join(',')}`); fail(audit.codeLeak, 'código correcto visible'); fail(audit.codeInputs.some(Boolean), 'entrada de código precargada'); }
  await ctx.close();
}
const browser = await chromium.launch();
await run('catalog-320-stack', 'prototype-catalog-mobile.html', { state: 'cart' }, 320, 568, { targets: true, stack: true });
await run('catalog-empty-search', 'prototype-catalog-mobile.html', { state: 'empty' }, 390, 844, { search: true, pack: true, targets: true });
for (const [name, width, height] of [['business-1024', 1024, 768], ['business-1280', 1280, 900], ['business-1440', 1440, 1000], ['business-1920', 1920, 1080]]) await run(name, 'prototype-business-desktop.html', { state: 'queue' }, width, height, { business: true });
await run('business-mobile-320', 'prototype-business-desktop.html', { state: 'queue', sheet: '1' }, 320, 700, { business: true, targets: true });
await run('business-mobile-360', 'prototype-business-desktop.html', { state: 'queue', sheet: '1' }, 360, 800, { business: true, targets: true });
await run('rider-login', 'prototype-rider-android.html', { screen: 'login' }, 390, 844, { rider: true, targets: true });
await run('rider-pickup', 'prototype-rider-android.html', { screen: 'pickup' }, 390, 844, { rider: true, targets: true });
await run('rider-code', 'prototype-rider-android.html', { screen: 'code' }, 390, 844, { rider: true, targets: true });
await run('rider-incident', 'prototype-rider-android.html', { screen: 'incident' }, 390, 844, { rider: true, targets: true });
await browser.close();
fs.writeFileSync(path.join(BASE, 'closure-validation.json'), JSON.stringify(results, null, 2));
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`escenarios=${Object.keys(results).length} fallos=0 supabase=0 pageerror=0 consola=0`);
