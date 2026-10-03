import { chromium } from '@playwright/test';
import fs from 'node:fs';

const BASE = process.env.BASE || 'https://la-taba.pages.dev';
const OUT = 'C:/1212/la-taba-premium-catalog-launch/.local/auditoria-tarjeta';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(2500);
for (let i = 0; i < 5; i += 1) {
  const c = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /ahora no|cerrar/i.test((x.textContent || '').trim()) && x.offsetParent !== null);
    if (b) { b.click(); return true; } return false;
  });
  if (!c) break;
  await page.waitForTimeout(400);
}
await page.evaluate(() => {
  const b = [...document.querySelectorAll('[data-nav-view="catalog"]')].find((x) => !x.hasAttribute('data-nav-passive'));
  if (b) b.click();
});
await page.waitForSelector('.product-grid .product-card');
await page.evaluate(async () => {
  const step = window.innerHeight * 0.8;
  for (let y = 0; y < document.body.scrollHeight; y += step) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 160)); }
  window.scrollTo(0, 0);
});
await page.waitForTimeout(2000);

const r = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.product-grid .product-card')];
  const conFoto = cards.filter((c) => c.querySelector('.thumb.has-photo'));
  const out = [];
  for (const card of conFoto) {
    const img = card.querySelector('.thumb-img');
    const media = card.querySelector('.product-media');
    const N = 300;
    const cv = document.createElement('canvas'); cv.width = N; cv.height = N;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, N, N);
    const ar = img.naturalWidth / img.naturalHeight;
    let w = N; let h = N;
    if (ar > 1) h = N / ar; else w = N * ar;
    cx.drawImage(img, (N - w) / 2, (N - h) / 2, w, h);
    let d; try { d = cx.getImageData(0, 0, N, N).data; } catch (e) { out.push({ err: String(e) }); continue; }
    let minX = N; let minY = N; let maxX = -1; let maxY = -1; let ink = 0;
    for (let y = 0; y < N; y += 1) for (let x = 0; x < N; x += 1) {
      const i = (y * N + x) * 4;
      if (d[i] < 237 || d[i + 1] < 237 || d[i + 2] < 237) { ink += 1; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    const ir = img.getBoundingClientRect(); const mr = media.getBoundingClientRect();
    out.push({
      nombre: card.querySelector('h3').textContent.trim(),
      presentacion: card.querySelector('.product-body p').textContent.trim(),
      natural: img.naturalWidth + 'x' + img.naturalHeight,
      src: img.currentSrc,
      bboxAltoPct: Math.round(((maxY - minY + 1) / N) * 1000) / 10,
      bboxAnchoPct: Math.round(((maxX - minX + 1) / N) * 1000) / 10,
      productoAltoPx: Math.round(((maxY - minY + 1) / N) * ir.height),
      mediaAltoPx: Math.round(mr.height),
      cardAltoPx: Math.round(card.getBoundingClientRect().height),
      fracProductoMedia: Math.round((((maxY - minY + 1) / N) * ir.height / mr.height) * 1000) / 10,
      fracProductoCard: Math.round((((maxY - minY + 1) / N) * ir.height / card.getBoundingClientRect().height) * 1000) / 10,
      cobertura: Math.round((ink / (N * N)) * 1000) / 10,
      margenSuperiorPct: Math.round((minY / N) * 1000) / 10,
      margenInferiorPct: Math.round(((N - 1 - maxY) / N) * 1000) / 10,
      badgeDom: card.querySelector('.product-pack-badge') ? card.querySelector('.product-pack-badge').textContent.trim() : null,
      badges: [...card.querySelectorAll('.offer-badge, .product-pack-badge, .stock-pill, .product-age-tag')].map((b) => b.textContent.trim()),
    });
  }
  // inventario global
  const inv = cards.map((c) => ({
    n: c.querySelector('h3').textContent.trim(),
    foto: !!c.querySelector('.thumb.has-photo'),
    pres: c.querySelector('.product-body p').textContent.trim(),
    precio: c.querySelector('.price strong') ? c.querySelector('.price strong').textContent.trim() : null,
    marca: c.querySelector('.product-brand') ? c.querySelector('.product-brand').textContent.trim() : null,
    lineasNombre: Math.round(c.querySelector('h3').scrollHeight / parseFloat(getComputedStyle(c.querySelector('h3')).lineHeight)),
    altoNombre: c.querySelector('h3').getBoundingClientRect().height,
    alto: Math.round(c.getBoundingClientRect().height),
    badges: [...c.querySelectorAll('.offer-badge, .product-pack-badge, .stock-pill, .product-age-tag')].map((b) => b.textContent.trim()),
  }));
  return { conFoto: out, inv, totalConFoto: conFoto.length, total: cards.length };
});

console.log(JSON.stringify(r.conFoto, null, 1));
console.log('con foto:', r.totalConFoto, '/', r.total);
console.log('alturas distintas:', [...new Set(r.inv.map((x) => x.alto))].sort((a, b) => a - b));
console.log('nombres 2 lineas:', r.inv.filter((x) => x.lineasNombre > 1).length, r.inv.filter((x) => x.lineasNombre > 1).map((x) => x.n));
console.log('sin presentacion:', r.inv.filter((x) => !x.pres).map((x) => x.n));
console.log('con marca:', r.inv.filter((x) => x.marca).map((x) => x.n + ' [' + x.marca + ']'));
console.log('badges:', JSON.stringify(r.inv.filter((x) => x.badges.length).map((x) => x.n + ' => ' + x.badges.join('|'))));
fs.writeFileSync(OUT + '/foto.json', JSON.stringify(r, null, 1));

const conFoto = page.locator('.product-grid .product-card').filter({ has: page.locator('.thumb.has-photo') });
for (let i = 0; i < await conFoto.count(); i += 1) {
  await conFoto.nth(i).screenshot({ path: OUT + '/foto-real-' + i + '.png' });
}
await browser.close();
