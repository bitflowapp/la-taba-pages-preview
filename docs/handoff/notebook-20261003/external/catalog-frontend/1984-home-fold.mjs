/* Mide la PRIMERA PANTALLA real de producción como la ve un cliente nuevo. */
import { chromium, webkit, devices } from '@playwright/test';

const BASE = process.env.TABA_BASE || 'https://la-taba.pages.dev';
const OUT = process.env.TABA_OUT || 'artifacts/weekend-launch';
const { mkdirSync } = await import('node:fs');
mkdirSync(OUT, { recursive: true });

const PERFILES = [
  { nombre: 'android-390x664', motor: 'chromium', w: 390, h: 664, touch: true,
    ua: 'Mozilla/5.0 (Linux; Android 15; moto g15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36' },
  { nombre: 'iphone-390x664', motor: 'webkit', w: 390, h: 664, touch: true },
  { nombre: 'chico-320x568', motor: 'chromium', w: 320, h: 568, touch: true },
  { nombre: 'grande-430x740', motor: 'chromium', w: 430, h: 740, touch: true },
  { nombre: 'desktop-1440x900', motor: 'chromium', w: 1440, h: 900, touch: false },
];

const informe = [];

for (const p of PERFILES) {
  const motor = p.motor === 'webkit' ? webkit : chromium;
  const browser = await motor.launch();
  const ctx = await browser.newContext({
    viewport: { width: p.w, height: p.h },
    hasTouch: p.touch,
    isMobile: p.touch,
    deviceScaleFactor: p.touch ? 3 : 1,
    ...(p.ua ? { userAgent: p.ua } : {}),
    serviceWorkers: 'allow',
    locale: 'es-AR',
  });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errores.push('console: ' + m.text().slice(0, 200)); });
  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const tDom = Date.now() - t0;
  await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 90_000 });
  const tReady = Date.now() - t0;
  await page.waitForTimeout(2500);

  const m = await page.evaluate((vh) => {
    const fold = vh;
    const enFold = (el) => { const r = el.getBoundingClientRect(); return r.top < fold && r.bottom > 0 && r.width > 0 && r.height > 0; };
    const visible = (el) => { const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };

    // textos legibles arriba del pliegue
    const textosFold = [];
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el) || !enFold(el)) continue;
      if (el.children.length > 0) continue;
      const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
      if (t && t.length <= 120) textosFold.push(t);
    }

    // precios visibles arriba del pliegue
    const precios = textosFold.filter((t) => /\$\s?\d/.test(t));

    // imágenes de producto arriba del pliegue
    const imgsFold = [...document.querySelectorAll('img')].filter((i) => visible(i) && enFold(i))
      .map((i) => ({ src: (i.currentSrc || i.src || '').split('/').pop(), w: Math.round(i.getBoundingClientRect().width), h: Math.round(i.getBoundingClientRect().height), alt: i.alt }));

    // tarjetas de producto arriba del pliegue
    const tarjetas = [...document.querySelectorAll('[data-product-card], .product-card, .rail-card, .thumb')]
      .filter((e) => visible(e) && enFold(e)).length;

    // overflow horizontal
    const de = document.documentElement;
    const overflow = { scrollW: de.scrollWidth, clientW: de.clientWidth, hay: de.scrollWidth > de.clientWidth + 1 };
    const culpables = [];
    if (overflow.hay) {
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.right > de.clientWidth + 1 || r.left < -1)) {
          const s = getComputedStyle(el);
          if (s.overflowX === 'auto' || s.overflowX === 'scroll') continue;
          culpables.push(`${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ').slice(0,2).join('.') : ''} right=${Math.round(r.right)} w=${Math.round(r.width)}`);
        }
      }
    }

    // objetivos táctiles chicos
    const chicos = [];
    for (const el of document.querySelectorAll('button, a[href], [role="button"], input[type="checkbox"], select, [data-add-product], [data-open-cart]')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.top > fold * 3) continue;
      if (r.width < 44 || r.height < 44) chicos.push(`${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''} "${(el.textContent||el.getAttribute('aria-label')||'').trim().slice(0,26)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    }

    // altura total del documento
    return {
      textosFold, precios, imgsFold, tarjetas, overflow, culpables: [...new Set(culpables)].slice(0, 12),
      chicos: [...new Set(chicos)].slice(0, 20),
      alturaDoc: de.scrollHeight,
      titulo: document.title,
      h1: [...document.querySelectorAll('h1,h2')].filter(visible).slice(0,4).map((h)=>({tag:h.tagName, txt:(h.textContent||'').trim().slice(0,80), top: Math.round(h.getBoundingClientRect().top)})),
    };
  }, p.h);

  // dónde aparece el primer precio y la primera tarjeta, medido en píxeles desde el tope del documento
  const posiciones = await page.evaluate(() => {
    const visible = (el) => { const s = getComputedStyle(el); if (s.display==='none'||s.visibility==='hidden') return false; const r = el.getBoundingClientRect(); return r.width>0&&r.height>0; };
    const y = (el) => Math.round(el.getBoundingClientRect().top + window.scrollY);
    const primerPrecio = [...document.querySelectorAll('body *')].find((e)=>e.children.length===0&&visible(e)&&/\$\s?\d/.test(e.textContent||''));
    const primeraTarjeta = [...document.querySelectorAll('[data-product-card], .product-card, .rail-card, .thumb')].find(visible);
    const primerAgregar = [...document.querySelectorAll('[data-add-product]')].find(visible);
    return {
      primerPrecioY: primerPrecio ? y(primerPrecio) : null,
      primerPrecioTxt: primerPrecio ? (primerPrecio.textContent||'').trim().slice(0,40) : null,
      primeraTarjetaY: primeraTarjeta ? y(primeraTarjeta) : null,
      primerAgregarY: primerAgregar ? y(primerAgregar) : null,
    };
  });

  await page.screenshot({ path: `${OUT}/home-${p.nombre}.png` });
  await page.screenshot({ path: `${OUT}/home-${p.nombre}-completa.png`, fullPage: true });

  informe.push({ perfil: p.nombre, tDom, tReady, ...m, ...posiciones, errores: [...new Set(errores)].slice(0, 8) });
  await browser.close();
}

console.log(JSON.stringify(informe, null, 1));
