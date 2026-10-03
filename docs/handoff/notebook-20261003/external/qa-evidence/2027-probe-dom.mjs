import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
await p.goto('https://taba2-staging.pages.dev/', { waitUntil: 'load', timeout: 90000 });
await p.waitForFunction(() => { const g = document.querySelector('[data-production-catalog-gate]'); return g && g.hidden === true; }, null, { timeout: 60000 });
await p.waitForTimeout(2500);
const r = await p.evaluate(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const grids = [...document.querySelectorAll('[data-product-grid]')].map((g, i) => ({
    i, visible: vis(g), enSeccion: g.closest('[data-view]')?.dataset.view || '(sin vista)',
    ocultaPorSeccion: Boolean(g.closest('[hidden]')),
    botones: g.querySelectorAll('[data-add-product]').length,
    botonesVisibles: [...g.querySelectorAll('[data-add-product]')].filter(vis).length,
  }));
  const todos = [...document.querySelectorAll('[data-add-product]')];
  return {
    grids,
    totalBotones: todos.length,
    totalVisibles: todos.filter(vis).length,
    vistaActiva: document.querySelector('.app-view.is-active')?.dataset.view,
    buscadores: [...document.querySelectorAll('[data-search-input]')].map(e => ({ vis: vis(e), en: e.closest('[data-view]')?.dataset.view })),
    categorias: [...document.querySelectorAll('[data-category-id]')].filter(vis).slice(0,6).map(e => e.textContent.trim().slice(0,24)),
    cartCount: [...document.querySelectorAll('[data-cart-count]')].map(e => ({ vis: vis(e), txt: e.textContent.trim() })),
  };
});
console.log(JSON.stringify(r, null, 2));
await b.close();
