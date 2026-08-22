// READ-ONLY recon: home + catalogo + busqueda. Cliente anonimo.
// PROHIBIDO: confirmar pedido, registrarse, loguearse.
import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const BASE = 'https://la-taba.pages.dev';
const log = [];
const say = (...a) => { const s = a.join(' '); log.push(s); console.log(s); };

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  serviceWorkers: 'block',
  locale: 'es-AR',
});
// Estado de quien ya respondio a la invitacion de instalar (evita hoja modal).
await ctx.addInitScript(() => {
  try { localStorage.setItem('TABA_INSTALL_PROMPT_V1', JSON.stringify({ dismissedAt: Date.now(), choice: 'later' })); } catch (e) {}
});
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') say('[console.error]', m.text().slice(0, 200)); });

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(3000);

say('=== URL ===', page.url());
say('=== TITLE ===', await page.title());

// version del build
const ver = await page.evaluate(() => {
  const s = [...document.querySelectorAll('script[src]')].map((n) => n.getAttribute('src'));
  return s.filter((x) => x && x.includes('?v=')).slice(0, 5);
});
say('=== SCRIPTS VERSION ===', JSON.stringify(ver));

// Todas las secciones/vistas con id
const sections = await page.evaluate(() => [...document.querySelectorAll('section[id], main[id], div[id].view, [data-view]')]
  .map((n) => ({
    tag: n.tagName.toLowerCase(),
    id: n.id || null,
    cls: n.className && typeof n.className === 'string' ? n.className.slice(0, 90) : null,
    dataView: n.getAttribute('data-view'),
    hidden: n.hasAttribute('hidden') || getComputedStyle(n).display === 'none',
  })));
say('=== SECTIONS ===\n' + JSON.stringify(sections, null, 1));

// Inputs de busqueda
const inputs = await page.evaluate(() => [...document.querySelectorAll('input, select, textarea')].map((n) => ({
  tag: n.tagName.toLowerCase(),
  type: n.type || null,
  id: n.id || null,
  name: n.name || null,
  cls: typeof n.className === 'string' ? n.className.slice(0, 80) : null,
  placeholder: n.placeholder || null,
  ariaLabel: n.getAttribute('aria-label'),
  data: Object.keys(n.dataset || {}),
  visible: !!(n.offsetParent || n.getClientRects().length),
})));
say('=== INPUTS ===\n' + JSON.stringify(inputs, null, 1));

// Navegacion inferior
const nav = await page.evaluate(() => [...document.querySelectorAll('nav a, nav button, [class*="tabbar"] a, [class*="tabbar"] button, [data-nav], [data-go]')]
  .map((n) => ({
    tag: n.tagName.toLowerCase(),
    text: (n.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40),
    href: n.getAttribute('href'),
    cls: typeof n.className === 'string' ? n.className.slice(0, 70) : null,
    data: Object.entries(n.dataset || {}).map(([k, v]) => `${k}=${v}`),
    ariaCurrent: n.getAttribute('aria-current'),
  })));
say('=== NAV ===\n' + JSON.stringify(nav, null, 1));

// data-* unicos en toda la pagina
const datas = await page.evaluate(() => {
  const m = new Map();
  document.querySelectorAll('*').forEach((n) => {
    for (const k of Object.keys(n.dataset || {})) m.set(k, (m.get(k) || 0) + 1);
  });
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
});
say('=== DATA ATTRS (home) ===\n' + JSON.stringify(datas));

await page.screenshot({ path: `${OUT}/01-home.png`, fullPage: false });
await page.screenshot({ path: `${OUT}/01-home-full.png`, fullPage: true });

fs.writeFileSync(`${OUT}/recon-01-home.txt`, log.join('\n'), 'utf8');
await browser.close();
