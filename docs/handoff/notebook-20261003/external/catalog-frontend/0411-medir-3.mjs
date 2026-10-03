import { chromium } from '@playwright/test';
import fs from 'node:fs';
const BASE = 'https://la-taba.pages.dev';
const OUT = 'C:/1212/la-taba-premium-catalog-launch/.local/auditoria-tarjeta';
const browser = await chromium.launch();

for (const [w, h, dpr] of [[390, 844, 3], [430, 932, 3], [320, 720, 2]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: true, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
  const page = await ctx.newPage();
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
  const r = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.product-grid .product-card')];
    const lineas = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); const rects = [...rg.getClientRects()].filter((x) => x.height > 1); const tops = new Set(rects.map((x) => Math.round(x.top))); return tops.size; };
    return {
      dpr: window.devicePixelRatio,
      cards: cards.map((c) => {
        const h3 = c.querySelector('h3');
        const img = c.querySelector('.thumb-img');
        const foot = c.querySelector('.product-foot');
        const price = c.querySelector('.price');
        const cond = c.querySelector('.price-condition');
        return {
          n: h3.textContent.trim(),
          alto: Math.round(c.getBoundingClientRect().height * 10) / 10,
          lineasReales: lineas(h3),
          h3Alto: Math.round(h3.getBoundingClientRect().height * 10) / 10,
          h3Sobrante: Math.round((h3.getBoundingClientRect().height - lineas(h3) * parseFloat(getComputedStyle(h3).lineHeight)) * 10) / 10,
          natural: img.naturalWidth + 'x' + img.naturalHeight,
          cssAncho: Math.round(img.getBoundingClientRect().width),
          necesarioDevice: Math.round(img.getBoundingClientRect().width * window.devicePixelRatio),
          escala: Math.round((img.getBoundingClientRect().width * window.devicePixelRatio / (img.naturalWidth || 1)) * 100) / 100,
          src: (img.currentSrc || '').split('/').pop(),
          foto: !!c.querySelector('.thumb.has-photo'),
          footAlto: Math.round(foot.getBoundingClientRect().height),
          priceAlto: Math.round(price.getBoundingClientRect().height),
          cond: cond ? cond.textContent.trim() : null,
          gapNombrePres: (() => {
            const p = c.querySelector('.product-body p');
            return Math.round((p.getBoundingClientRect().top - (h3.getBoundingClientRect().top + lineas(h3) * parseFloat(getComputedStyle(h3).lineHeight))) * 10) / 10;
          })(),
          gapPresPrecio: (() => {
            const p = c.querySelector('.product-body p');
            return Math.round((price.getBoundingClientRect().top - p.getBoundingClientRect().bottom) * 10) / 10;
          })(),
          gapPrecioCta: (() => {
            const a = c.querySelector('.product-action');
            return Math.round((a.getBoundingClientRect().top - price.getBoundingClientRect().bottom) * 10) / 10;
          })(),
          ctaAlto: Math.round(c.querySelector('.product-action > *').getBoundingClientRect().height),
          ctaAncho: Math.round(c.querySelector('.product-action > *').getBoundingClientRect().width),
          areaCta: Math.round(c.querySelector('.product-action > *').getBoundingClientRect().width * c.querySelector('.product-action > *').getBoundingClientRect().height),
          areaCard: Math.round(c.getBoundingClientRect().width * c.getBoundingClientRect().height),
        };
      }),
    };
  });
  fs.writeFileSync(OUT + '/detalle-' + w + '.json', JSON.stringify(r, null, 1));
  const cs = r.cards;
  console.log('\n### ' + w + 'px dpr=' + r.dpr);
  console.log(' alturas: ' + JSON.stringify([...new Set(cs.map((x) => x.alto))].sort((a, b) => a - b)));
  console.log(' altos distintos -> ' + cs.filter((x) => x.alto !== cs[0].alto).map((x) => x.n + ':' + x.alto + ' cond=' + x.cond).slice(0, 6).join(' | '));
  console.log(' nombres 2+ lineas REALES: ' + cs.filter((x) => x.lineasReales > 1).map((x) => x.n).join(', '));
  console.log(' h3 sobrante medio: ' + Math.round(cs.reduce((a, x) => a + x.h3Sobrante, 0) / cs.length * 10) / 10 + 'px  (en ' + cs.filter((x) => x.h3Sobrante > 5).length + '/' + cs.length + ' tarjetas)');
  console.log(' gaps: nombre->pres ' + cs[0].gapNombrePres + '  pres->precio ' + cs[0].gapPresPrecio + '  precio->cta ' + cs[0].gapPrecioCta);
  console.log(' cta ' + cs[0].ctaAncho + 'x' + cs[0].ctaAlto + ' = ' + Math.round(cs[0].areaCta / cs[0].areaCard * 1000) / 10 + '% del area de la tarjeta');
  console.log(' escala bitmap: ' + JSON.stringify([...new Set(cs.map((x) => x.natural + ' -> ' + x.cssAncho + 'css/' + x.necesarioDevice + 'dev  x' + x.escala))]));
  await ctx.close();
}
await browser.close();
