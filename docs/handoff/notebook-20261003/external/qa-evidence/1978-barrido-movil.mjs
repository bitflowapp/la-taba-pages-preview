/*
 * Barrido móvil de las siete superficies del cliente, en Chromium y WebKit, a
 * 320 / 390 / 430 px. Sólo lee: no inicia sesión, no crea identidad, no confirma
 * ningún pedido. El carrito vive en el navegador.
 *
 * Mide lo que el lanzamiento exige: desborde horizontal, objetivos táctiles y
 * errores de consola, superficie por superficie.
 */
import { chromium, webkit } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.env.TABA_BASE || 'https://la-taba.pages.dev';
const OUT = process.env.TABA_OUT || 'artifacts/weekend-launch';
mkdirSync(OUT, { recursive: true });

const ANCHOS = [320, 390, 430];
const MOTORES = [
  { nombre: 'chromium', lanzar: chromium, ua: 'Mozilla/5.0 (Linux; Android 15; moto g15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36' },
  { nombre: 'webkit', lanzar: webkit, ua: null },
];
const SUPERFICIES = ['home', 'catalog', 'cart', 'tracking', 'profile'];

const informe = [];

async function medir(page, alto) {
  return page.evaluate((fold) => {
    const de = document.documentElement;
    /*
     * UN CONTROL DENTRO DE UN <details> CERRADO NO ESTÁ EN PANTALLA.
     *
     * La primera versión de esta guarda miraba estilo calculado y caja, y con
     * eso contó como «objetivo táctil chico» el botón «Limpiar» del panel de
     * filtros: 33 × 44 px a 320 px de ancho, en seis mediciones. Medido después
     * a mano, el panel estaba CERRADO —su hoja mide 117 × 388 y desborda fuera
     * de un <details> de 119 × 50— y el botón no se puede tocar. Con el panel
     * abierto, que es la única forma de llegar a él, mide 116 × 44.
     *
     * O sea que la herramienta reportaba un defecto que no existe. Una medición
     * que miente hacia el rojo cuesta lo mismo que una que miente hacia el
     * verde: manda a alguien a arreglar lo que ya está bien.
     */
    const vis = (el) => {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
      const detalle = el.closest('details');
      if (detalle && !detalle.open && el !== detalle && !el.closest('summary')) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const culpables = [];
    if (de.scrollWidth > de.clientWidth + 1) {
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width <= 0) continue;
        if (r.right <= de.clientWidth + 1 && r.left >= -1) continue;
        const s = getComputedStyle(el);
        if (s.overflowX === 'auto' || s.overflowX === 'scroll') continue;
        if (el.closest('[style*="overflow"], .rail, [data-rail], .scroller')) continue;
        culpables.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} right=${Math.round(r.right)}`);
      }
    }
    const chicos = [];
    for (const el of document.querySelectorAll('button, a[href], [role="button"], select, input[type="checkbox"], [data-add-product], [data-open-cart], [data-nav-view]')) {
      if (!vis(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.top > fold * 4) continue;
      if (r.width >= 44 && r.height >= 44) continue;
      chicos.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 22)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return {
      desborde: de.scrollWidth > de.clientWidth + 1,
      scrollW: de.scrollWidth,
      clientW: de.clientWidth,
      culpables: [...new Set(culpables)].slice(0, 8),
      chicos: [...new Set(chicos)].slice(0, 10),
      alturaDoc: de.scrollHeight,
    };
  }, alto);
}

for (const motor of MOTORES) {
  const navegador = await motor.lanzar.launch();
  for (const ancho of ANCHOS) {
    const alto = Math.round(ancho * 1.9);
    const ctx = await navegador.newContext({
      viewport: { width: ancho, height: alto },
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 2,
      locale: 'es-AR',
      serviceWorkers: 'allow',
      ...(motor.ua ? { userAgent: motor.ua } : {}),
    });
    const page = await ctx.newPage();
    const errores = [];
    page.on('pageerror', (e) => errores.push(`pageerror: ${e.message.slice(0, 120)}`));
    page.on('console', (m) => { if (m.type() === 'error') errores.push(`console: ${m.text().slice(0, 120)}`); });

    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 90_000 });
    await page.waitForTimeout(2500);

    // una bebida en el carrito, para que el carrito y el checkout tengan qué dibujar
    const agregar = page.locator('[data-add-product] >> visible=true').first();
    if (await agregar.count()) { await agregar.click(); await page.waitForTimeout(900); }

    for (const superficie of SUPERFICIES) {
      await page.evaluate((vista) => { window.location.hash = `#${vista}`; }, superficie);
      await page.waitForTimeout(2200);
      const medida = await medir(page, alto);
      informe.push({ motor: motor.nombre, ancho, superficie, ...medida, errores: [...new Set(errores)].slice(0, 4) });
      if (ancho === 390) {
        await page.screenshot({ path: `${OUT}/movil-${motor.nombre}-390-${superficie}.png` });
      }
    }

    // la búsqueda, que es una superficie propia y sólo existe con el buscador abierto
    await page.evaluate(() => { window.location.hash = '#home'; });
    await page.waitForTimeout(1500);
    const buscador = page.locator('[data-search-input] >> visible=true').first();
    if (await buscador.count()) {
      await buscador.fill('coca');
      await page.waitForTimeout(2000);
      const medida = await medir(page, alto);
      informe.push({ motor: motor.nombre, ancho, superficie: 'busqueda', ...medida, errores: [...new Set(errores)].slice(0, 4) });
      if (ancho === 390) await page.screenshot({ path: `${OUT}/movil-${motor.nombre}-390-busqueda.png` });
    }

    // la ficha del producto, que es un modal y por eso no tiene hash propio
    await page.evaluate(() => { window.location.hash = '#catalog'; });
    await page.waitForTimeout(2000);
    const ficha = page.locator('[data-product-detail] >> visible=true').first();
    if (await ficha.count()) {
      await ficha.click();
      await page.waitForTimeout(1800);
      const medida = await medir(page, alto);
      informe.push({ motor: motor.nombre, ancho, superficie: 'ficha', ...medida, errores: [...new Set(errores)].slice(0, 4) });
      if (ancho === 390) await page.screenshot({ path: `${OUT}/movil-${motor.nombre}-390-ficha.png` });
    }

    await ctx.close();
  }
  await navegador.close();
}

const conDesborde = informe.filter((f) => f.desborde);
const conChicos = informe.filter((f) => f.chicos.length);
const conErrores = informe.filter((f) => f.errores.length);

console.log(`BARRIDO MÓVIL · ${informe.length} mediciones (${MOTORES.length} motores × ${ANCHOS.length} anchos × ${SUPERFICIES.length + 2} superficies)\n`);
console.log(`  desborde horizontal ....... ${conDesborde.length}`);
console.log(`  objetivos < 44 px ......... ${conChicos.length}`);
console.log(`  con errores de consola .... ${conErrores.length}\n`);
for (const fila of conDesborde) console.log(`  DESBORDE ${fila.motor}/${fila.ancho}/${fila.superficie} · ${fila.scrollW}>${fila.clientW} · ${fila.culpables.join(' | ')}`);
for (const fila of conChicos) console.log(`  CHICO    ${fila.motor}/${fila.ancho}/${fila.superficie} · ${fila.chicos.join(' | ')}`);
for (const fila of conErrores) console.log(`  ERROR    ${fila.motor}/${fila.ancho}/${fila.superficie} · ${fila.errores.join(' | ')}`);
if (!conDesborde.length && !conChicos.length && !conErrores.length) console.log('  todo limpio');
