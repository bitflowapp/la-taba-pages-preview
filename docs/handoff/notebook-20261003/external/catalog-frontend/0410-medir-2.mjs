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

async function cerrarInvitacion(page) {
  for (let i = 0; i < 6; i += 1) {
    const cerrado = await page.evaluate(() => {
      const botones = [...document.querySelectorAll('button')];
      const b = botones.find((x) => /ahora no|no, gracias|cerrar|más tarde/i.test((x.textContent || '').trim()));
      if (b && b.offsetParent !== null) { b.click(); return true; }
      const x = document.querySelector('[data-pwa-dismiss], [data-install-dismiss], .install-sheet button[aria-label*="errar"]');
      if (x) { x.click(); return true; }
      return false;
    });
    if (!cerrado) break;
    await page.waitForTimeout(500);
  }
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(400);
}

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
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(2500);
  await cerrarInvitacion(page);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('[data-nav-view="catalog"]')].find((x) => !x.hasAttribute('data-nav-passive'));
    if (b) b.click();
  });
  await page.waitForSelector('.product-grid .product-card', { timeout: 60000 });
  await page.waitForTimeout(2000);
  await cerrarInvitacion(page);
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.8;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 150));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(1200);
  await cerrarInvitacion(page);

  // tinta real del packshot dentro de la caja de media
  const tinta = await page.evaluate(async () => {
    const cards = [...document.querySelectorAll('.product-grid .product-card')];
    const out = [];
    for (const card of cards.slice(0, 12)) {
      const img = card.querySelector('.thumb-img');
      const media = card.querySelector('.product-media');
      if (!img || !media || !img.naturalWidth) continue;
      const N = 200;
      const cv = document.createElement('canvas');
      cv.width = N; cv.height = N;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.fillStyle = '#ffffff';
      cx.fillRect(0, 0, N, N);
      // dibuja el bitmap con la MISMA geometría object-fit:contain dentro de N x N
      const ar = img.naturalWidth / img.naturalHeight;
      let w = N; let h = N;
      if (ar > 1) h = N / ar; else w = N * ar;
      cx.drawImage(img, (N - w) / 2, (N - h) / 2, w, h);
      let d;
      try { d = cx.getImageData(0, 0, N, N).data; } catch (e) { out.push({ error: String(e).slice(0, 60) }); continue; }
      let minX = N; let minY = N; let maxX = -1; let maxY = -1; let tintaPx = 0;
      for (let y = 0; y < N; y += 1) {
        for (let x = 0; x < N; x += 1) {
          const i = (y * N + x) * 4;
          const r = d[i]; const g = d[i + 1]; const b = d[i + 2];
          // "no es fondo claro": se aparta más de 18/255 del blanco en algún canal
          if (r < 237 || g < 237 || b < 237) {
            tintaPx += 1;
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
          }
        }
      }
      const bboxH = maxY >= 0 ? (maxY - minY + 1) / N : 0;
      const bboxW = maxX >= 0 ? (maxX - minX + 1) / N : 0;
      const mr = media.getBoundingClientRect();
      const ir = img.getBoundingClientRect();
      out.push({
        nombre: card.querySelector('h3').textContent.trim().slice(0, 32),
        placeholder: img.classList.contains('is-placeholder'),
        natural: img.naturalWidth + 'x' + img.naturalHeight,
        // alto del PRODUCTO visible, en px de pantalla
        productoPxAlto: Math.round(bboxH * ir.height),
        productoPxAncho: Math.round(bboxW * ir.width),
        mediaAlto: Math.round(mr.height),
        // fracción del alto del ÁREA DE MEDIA que ocupa el producto
        fracProductoMedia: Math.round((bboxH * ir.height / mr.height) * 1000) / 10,
        fracProductoTarjeta: Math.round((bboxH * ir.height / card.getBoundingClientRect().height) * 1000) / 10,
        cobertura: Math.round((tintaPx / (N * N)) * 1000) / 10,
      });
    }
    return out;
  });

  informe[vp.name] = { tinta };

  await page.evaluate(() => {
    const g = document.querySelector('.product-grid');
    if (g) g.scrollIntoView({ block: 'start' });
    window.scrollBy(0, -60);
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + '/limpia-grilla-' + vp.name + '.png' });
  await page.locator('.product-grid .product-card').first().screenshot({ path: OUT + '/limpia-tarjeta-' + vp.name + '.png' });
  // tarjeta con foto real, si existe
  const conFoto = page.locator('.product-grid .product-card').filter({ has: page.locator('.thumb.has-photo') }).first();
  if (await conFoto.count()) {
    await conFoto.screenshot({ path: OUT + '/limpia-tarjeta-foto-' + vp.name + '.png' });
  }
  await ctx.close();
  console.log('[' + vp.name + '] ' + JSON.stringify(tinta.slice(0, 3)));
}

fs.writeFileSync(OUT + '/tinta.json', JSON.stringify(informe, null, 1));
await browser.close();
for (const [k, v] of Object.entries(informe)) {
  const t = v.tinta.filter((x) => x.fracProductoMedia);
  const avg = (f) => Math.round((t.reduce((a, x) => a + x[f], 0) / t.length) * 10) / 10;
  console.log(k + ': producto/media=' + avg('fracProductoMedia') + '%  producto/tarjeta=' + avg('fracProductoTarjeta') + '%  cobertura=' + avg('cobertura') + '%');
}
