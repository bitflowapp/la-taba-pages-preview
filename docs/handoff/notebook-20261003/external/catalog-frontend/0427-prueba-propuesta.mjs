import { chromium } from '@playwright/test';
import fs from 'node:fs';

const BASE = 'https://la-taba.pages.dev';
const OUT = 'C:/1212/la-taba-premium-catalog-launch/.local/auditoria-tarjeta';

const PARCHE = `
/* 1 · el nombre no reserva un renglón que 33/33 no usan */
.product-body h3 { min-height: 0; }
.product-body { gap: 4px; }
.product-body p { margin: 2px 0 0; }

/* 2 · el packshot manda: el envase pasa de ~63% a ~78% del alto del plato */
.thumb .thumb-img:not(.is-placeholder) { height: 100%; margin: 0; scale: 1.22; }
.thumb .thumb-img.is-placeholder { padding: 4%; scale: 1; }

/* 3 · el pie en un renglón también en móvil: precio grande + acción compacta */
.product-foot { grid-template-columns: minmax(0, 1fr) auto; gap: 10px; padding-top: 8px; }
.product-action .add-button { width: 44px; flex: 0 0 44px; padding-inline: 0; }
.product-action .add-plus { display: inline; font-size: 24px; }
.product-action .add-text { display: none; }
.product-action .qty-stepper { width: 116px; min-width: 116px; }

/* 4 · precio dominante */
.price strong, .price-amounts strong { font-size: 22px; }
.product-body h3 { font-size: 14px; }
`;

const PARCHE_TABLET = `
@media (min-width: 560px) and (max-width: 820px) {
  .product-grid { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)) !important; gap: 14px !important; }
}`;

async function abrirCatalogo(page) {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(2000);
  for (let i = 0; i < 5; i += 1) {
    const c = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /ahora no|cerrar/i.test((x.textContent || '').trim()) && x.offsetParent !== null); if (b) { b.click(); return true; } return false; });
    if (!c) break; await page.waitForTimeout(400);
  }
  await page.evaluate(() => { const b = [...document.querySelectorAll('[data-nav-view="catalog"]')].find((x) => !x.hasAttribute('data-nav-passive')); if (b) b.click(); });
  await page.waitForSelector('.product-grid .product-card');
  await page.evaluate(async () => { const s = window.innerHeight * 0.8; for (let y = 0; y < document.body.scrollHeight; y += s) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 150)); } window.scrollTo(0, 0); });
  await page.waitForTimeout(1500);
}

const medir = () => {
  const cards = [...document.querySelectorAll('.product-grid .product-card')];
  const c0 = cards[0];
  const img = c0.querySelector('.thumb-img');
  const media = c0.querySelector('.product-media');
  const foto = cards.find((c) => c.querySelector('.thumb.has-photo'));
  const ink = (card) => {
    const im = card.querySelector('.thumb-img');
    const md = card.querySelector('.product-media');
    const N = 240; const cv = document.createElement('canvas'); cv.width = N; cv.height = N;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, N, N);
    const st = getComputedStyle(im);
    const s = parseFloat(st.scale) || 1;
    const ir = im.getBoundingClientRect();
    // dibuja el bitmap con contain dentro de N y aplica la escala efectiva
    const ar = im.naturalWidth / im.naturalHeight; let w = N; let h = N;
    if (ar > 1) h = N / ar; else w = N * ar;
    cx.drawImage(im, (N - w) / 2, (N - h) / 2, w, h);
    const d = cx.getImageData(0, 0, N, N).data;
    let minY = N; let maxY = -1;
    for (let y = 0; y < N; y += 1) for (let x = 0; x < N; x += 1) { const i = (y * N + x) * 4; if (d[i] < 237 || d[i + 1] < 237 || d[i + 2] < 237) { if (y < minY) minY = y; if (y > maxY) maxY = y; } }
    const fr = (maxY - minY + 1) / N;
    // ir.height ya incluye la escala CSS
    return Math.round((fr * ir.height / md.getBoundingClientRect().height) * 1000) / 10;
  };
  const vis = cards.filter((c) => { const r = c.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; }).length;
  return {
    cols: getComputedStyle(document.querySelector('.product-grid')).gridTemplateColumns.split(' ').length,
    cardH: Math.round(c0.getBoundingClientRect().height),
    mediaH: Math.round(media.getBoundingClientRect().height),
    fracMedia: Math.round((media.getBoundingClientRect().height / c0.getBoundingClientRect().height) * 1000) / 10,
    tintaPlaceholder: ink(c0),
    tintaFoto: foto ? ink(foto) : null,
    h3: Math.round(c0.querySelector('h3').getBoundingClientRect().height),
    foot: Math.round(c0.querySelector('.product-foot').getBoundingClientRect().height),
    fsPrecio: getComputedStyle(c0.querySelector('.price strong')).fontSize,
    fsNombre: getComputedStyle(c0.querySelector('h3')).fontSize,
    tarjetasEnteras: vis,
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
  };
};

const browser = await chromium.launch();
const res = {};
for (const [w, h] of [[390, 844], [768, 1024]]) {
  for (const modo of ['antes', 'despues']) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: w < 700, isMobile: w < 700, userAgent: w < 700 ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' : undefined });
    const page = await ctx.newPage();
    await abrirCatalogo(page);
    if (modo === 'despues') { await page.addStyleTag({ content: PARCHE + PARCHE_TABLET }); await page.waitForTimeout(800); }
    res[w + '-' + modo] = await page.evaluate(medir);
    await page.evaluate(() => { const g = document.querySelector('.product-grid'); if (g) g.scrollIntoView({ block: 'start' }); window.scrollBy(0, -60); });
    await page.waitForTimeout(500);
    await page.screenshot({ path: OUT + '/' + modo + '-' + w + '.png' });
    const foto = page.locator('.product-grid .product-card').filter({ has: page.locator('.thumb.has-photo') }).first();
    if (await foto.count()) await foto.screenshot({ path: OUT + '/' + modo + '-foto-' + w + '.png' });
    await ctx.close();
  }
}
console.log(JSON.stringify(res, null, 1));
fs.writeFileSync(OUT + '/propuesta.json', JSON.stringify(res, null, 1));
await browser.close();
