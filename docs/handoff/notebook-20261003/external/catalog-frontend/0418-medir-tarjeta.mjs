import { chromium } from '@playwright/test';
import fs from 'node:fs';

const BASE = process.env.BASE || 'https://la-taba.pages.dev';
const OUT = 'C:/1212/la-taba-premium-catalog-launch/.local/auditoria-tarjeta';
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: '320', width: 320, height: 720, mobile: true },
  { name: '390', width: 390, height: 844, mobile: true },
  { name: '430', width: 430, height: 932, mobile: true },
  { name: '768', width: 768, height: 1024, mobile: false },
  { name: '1440', width: 1440, height: 900, mobile: false },
];

const browser = await chromium.launch();
const informe = {};

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    hasTouch: vp.mobile,
    isMobile: vp.mobile,
    userAgent: vp.mobile
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
      : undefined,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('[data-nav-view="catalog"]')].find((x) => !x.hasAttribute('data-nav-passive'));
    if (b) b.click();
  });
  await page.waitForSelector('.product-grid .product-card', { timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.8;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(1500);

  const data = await page.evaluate(() => {
    const px = (v) => Math.round(parseFloat(v) * 100) / 100;
    const grid = document.querySelector('.product-grid');
    const gcs = getComputedStyle(grid);
    const columnas = gcs.gridTemplateColumns.split(' ').filter(Boolean).length;
    const cards = [...document.querySelectorAll('.product-grid .product-card')];
    const filas = new Map();
    const medidas = cards.slice(0, 40).map((card, i) => {
      const r = card.getBoundingClientRect();
      const media = card.querySelector('.product-media');
      const frame = card.querySelector('.product-media-frame');
      const img = card.querySelector('.thumb-img');
      const h3 = card.querySelector('h3');
      const pres = card.querySelector('.product-body p');
      const marca = card.querySelector('.product-brand');
      const precio = card.querySelector('.price strong');
      const cta = card.querySelector('[data-add-product], .qty-stepper');
      const body = card.querySelector('.product-body');
      const foot = card.querySelector('.product-foot');
      const mr = media ? media.getBoundingClientRect() : null;
      const fr = frame ? frame.getBoundingClientRect() : null;
      const ir = img ? img.getBoundingClientRect() : null;
      const cs = (el) => (el ? getComputedStyle(el) : null);
      const h3s = cs(h3);
      const ps = cs(precio);
      const prs = cs(pres);
      const cortado = h3 ? h3.scrollHeight - h3.clientHeight > 1 : false;
      const key = Math.round(r.top);
      filas.set(key, (filas.get(key) || 0) + 1);
      return {
        i,
        nombre: h3 ? h3.textContent.trim() : '',
        presentacion: pres ? pres.textContent.trim() : '',
        marca: marca ? marca.textContent.trim() : null,
        precio: precio ? precio.textContent.trim() : '',
        cta: cta ? cta.textContent.replace(/\s+/g, ' ').trim() : null,
        ctaClase: cta ? cta.className : null,
        cardW: px(r.width),
        cardH: px(r.height),
        frameH: fr ? px(fr.height) : null,
        mediaW: mr ? px(mr.width) : null,
        mediaH: mr ? px(mr.height) : null,
        imgW: ir ? px(ir.width) : null,
        imgH: ir ? px(ir.height) : null,
        imgNatural: img ? img.naturalWidth + 'x' + img.naturalHeight : null,
        imgSrc: img ? img.currentSrc.split('/').pop().slice(0, 60) : null,
        esPlaceholder: img ? img.classList.contains('is-placeholder') : null,
        fracMediaCard: mr ? Math.round((mr.height / r.height) * 1000) / 10 : null,
        fracFrameCard: fr ? Math.round((fr.height / r.height) * 1000) / 10 : null,
        fracImgCard: ir ? Math.round((ir.height / r.height) * 1000) / 10 : null,
        fracImgMedia: ir && mr ? Math.round((ir.height / mr.height) * 1000) / 10 : null,
        bodyH: body ? px(body.getBoundingClientRect().height) : null,
        footH: foot ? px(foot.getBoundingClientRect().height) : null,
        fsNombre: h3s ? px(h3s.fontSize) : null,
        lhNombre: h3s ? h3s.lineHeight : null,
        h3ClientH: h3 ? px(h3.clientHeight) : null,
        h3ScrollH: h3 ? px(h3.scrollHeight) : null,
        nombreCortado: cortado,
        fsPresentacion: prs ? px(prs.fontSize) : null,
        fsPrecio: ps ? px(ps.fontSize) : null,
        pesoPrecio: ps ? ps.fontWeight : null,
        colorPrecio: ps ? ps.color : null,
        colorNombre: h3s ? h3s.color : null,
        ratioPrecioNombre: ps && h3s ? Math.round((parseFloat(ps.fontSize) / parseFloat(h3s.fontSize)) * 100) / 100 : null,
        bgCard: getComputedStyle(card).backgroundColor,
        bgMedia: media ? getComputedStyle(media).backgroundColor : null,
        gapBody: body ? getComputedStyle(body).gap : null,
        padBody: body ? getComputedStyle(body).padding : null,
        padFrame: frame ? getComputedStyle(frame).padding : null,
        badge: card.querySelector('.offer-badge') ? card.querySelector('.offer-badge').textContent.trim() : null,
        stockTag: card.querySelector('.stock-pill') ? card.querySelector('.stock-pill').textContent.trim() : null,
        packBadge: card.querySelector('.product-pack-badge') ? card.querySelector('.product-pack-badge').textContent.trim() : null,
        age: card.querySelector('.product-age-tag') ? card.querySelector('.product-age-tag').textContent.trim() : null,
        clases: card.className,
      };
    });
    return {
      columnasComputadas: columnas,
      gridTemplate: gcs.gridTemplateColumns,
      gap: gcs.gap,
      anchoGrid: px(grid.getBoundingClientRect().width),
      totalCards: cards.length,
      cardsPorFila: [...filas.entries()].slice(0, 4).map(([, n]) => n),
      medidas,
      docScrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
    };
  });

  informe[vp.name] = { ...data, errores: errs };

  await page.evaluate(() => {
    const g = document.querySelector('.product-grid');
    if (g) g.scrollIntoView({ block: 'start' });
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: OUT + '/grilla-' + vp.name + '.png' });
  const first = page.locator('.product-grid .product-card').first();
  await first.screenshot({ path: OUT + '/tarjeta-' + vp.name + '.png' });
  await ctx.close();
  console.log('[' + vp.name + '] cols=' + data.columnasComputadas + ' cards=' + data.totalCards + ' scrollW=' + data.docScrollW + '/' + data.innerW);
}

fs.writeFileSync(OUT + '/medidas.json', JSON.stringify(informe, null, 1));
await browser.close();

for (const [k, v] of Object.entries(informe)) {
  const m = v.medidas;
  const avg = (f) => Math.round((m.reduce((a, x) => a + (x[f] || 0), 0) / m.length) * 10) / 10;
  console.log('\n=== ' + k + 'px  cols=' + v.columnasComputadas + ' gap=' + v.gap + ' template=' + v.gridTemplate);
  console.log(' cardW=' + m[0].cardW + ' cardH med=' + avg('cardH') + ' min=' + Math.min(...m.map((x) => x.cardH)) + ' max=' + Math.max(...m.map((x) => x.cardH)));
  console.log(' mediaH=' + avg('mediaH') + ' imgH=' + avg('imgH') + ' img/card=' + avg('fracImgCard') + '% img/media=' + avg('fracImgMedia') + '%');
  console.log(' bodyH=' + avg('bodyH') + ' footH=' + avg('footH'));
  console.log(' fsNombre=' + m[0].fsNombre + ' fsPrecio=' + m[0].fsPrecio + ' ratio=' + m[0].ratioPrecioNombre + ' fsPres=' + m[0].fsPresentacion);
  console.log(' cortados: ' + m.filter((x) => x.nombreCortado).length + '/' + m.length + ' -> ' + m.filter((x) => x.nombreCortado).map((x) => x.nombre.slice(0, 36)).slice(0, 8).join(' | '));
  console.log(' placeholders: ' + m.filter((x) => x.esPlaceholder).length + '/' + m.length);
  console.log(' errores: ' + v.errores.length);
}
