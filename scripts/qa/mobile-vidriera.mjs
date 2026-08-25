/*
 * La tienda en un teléfono de verdad, medida en los dos motores.
 *
 * QUÉ MIDE QUE UN TEST NO PUEDE
 * -----------------------------
 * Un test dice si el nodo existe; esto dice si se puede TOCAR y si algo se sale
 * de la pantalla. Recorre las cinco superficies del cliente en tres anchos
 * reales (320, 390, 430) y en Chromium y WebKit, y devuelve tres hechos por
 * cada combinación: desborde horizontal, controles de compra por debajo de
 * 44x44 px, y texto por debajo de 12 px.
 *
 * WebKit no es un capricho: el lanzamiento apunta a iPhone/Safari primero, y es
 * el motor donde `:has()`, las áreas seguras y el desalojo de almacenamiento se
 * comportan distinto.
 *
 *   node scripts/qa/mobile-vidriera.mjs --origen http://127.0.0.1:8080
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium, webkit } from '@playwright/test';

const ROOT = path.resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const ORIGEN = arg('--origen', process.env.TABA_PUBLIC_ORIGIN || 'https://la-taba.pages.dev');
const SALIDA = path.resolve(ROOT, arg('--salida', 'artifacts/taba-premium-catalog/mobile.json'));

const ANCHOS = [
  { id: '320', width: 320, height: 568 },
  { id: '390', width: 390, height: 844 },
  { id: '430', width: 430, height: 932 },
];
const MOTORES = [
  { id: 'chromium', lanzar: chromium, ua: 'Mozilla/5.0 (Linux; Android 15; moto g15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36' },
  { id: 'webkit', lanzar: webkit, ua: undefined },
];
const VISTAS = ['home', 'catalog', 'cart', 'tracking', 'profile'];

/** Lo que una persona TOCA para comprar. Nada de esto puede medir menos de 44. */
const CONTROLES = '[data-add-product], [data-nav-view], [data-product-detail], [data-category-id], [data-cart-inc], [data-cart-dec], [data-checkout-submit], [data-open-cart], [data-favorite-toggle]';

const informe = { origen: ORIGEN, medidoEl: null, resultados: [] };

async function medirVista(pagina) {
  return pagina.evaluate((selector) => {
    const doc = document.documentElement;
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && el.offsetParent !== null;
    };
    const chicos = [...document.querySelectorAll(selector)]
      .filter(visible)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { alto: Math.round(r.height), ancho: Math.round(r.width), texto: (el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 44) };
      })
      .filter((c) => c.ancho < 44 || c.alto < 44);

    // Texto por debajo de 12 px: en un teléfono deja de leerse.
    const chico = [...document.querySelectorAll('p, span, small, strong, h1, h2, h3, h4, li, button, a')]
      .filter((el) => visible(el) && (el.textContent || '').trim().length > 2)
      .map((el) => ({ px: Number.parseFloat(getComputedStyle(el).fontSize), texto: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) }))
      .filter((t) => t.px > 0 && t.px < 12);

    return {
      desborde: doc.scrollWidth > doc.clientWidth,
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      controlesChicos: chicos.slice(0, 12),
      textoChico: [...new Map(chico.map((t) => [t.texto, t])).values()].slice(0, 12),
      viewport: document.querySelector('meta[name=viewport]')?.getAttribute('content') || '',
    };
  }, CONTROLES);
}

for (const motor of MOTORES) {
  const navegador = await motor.lanzar.launch();
  for (const ancho of ANCHOS) {
    const contexto = await navegador.newContext({
      viewport: { width: ancho.width, height: ancho.height },
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
      locale: 'es-AR',
      ...(motor.ua ? { userAgent: motor.ua } : {}),
    });
    const pagina = await contexto.newPage();
    await pagina.goto(ORIGEN, { waitUntil: 'networkidle', timeout: 120_000 });
    await pagina.waitForSelector('[data-add-product]', { timeout: 60_000 });
    await pagina.waitForTimeout(2500);
    // La invitación a instalar es un diálogo modal: mientras esté abierta nada
    // más se puede tocar, y su tamaño no es el de la tienda.
    for (const cerrar of ['[data-install-close]', '[data-install-decline]']) {
      const boton = pagina.locator(`${cerrar}:visible`).first();
      if (await boton.count()) {
        await boton.click({ timeout: 4000 }).catch(() => {});
        break;
      }
    }
    await pagina.keyboard.press('Escape').catch(() => {});

    for (const vista of VISTAS) {
      if (vista !== 'home') {
        const nav = pagina.locator(`.mobile-nav [data-nav-view="${vista}"]`).first();
        const destino = (await nav.count()) ? nav : pagina.locator(`[data-nav-view="${vista}"]:visible`).first();
        await destino.click({ timeout: 20_000 }).catch(() => {});
        await pagina.waitForTimeout(900);
      }
      const medida = await medirVista(pagina);
      informe.resultados.push({ motor: motor.id, ancho: ancho.id, vista, ...medida });
      const problemas = [
        medida.desborde ? `DESBORDE ${medida.scrollWidth}>${medida.clientWidth}` : '',
        medida.controlesChicos.length ? `${medida.controlesChicos.length} control(es) < 44px` : '',
        medida.textoChico.length ? `${medida.textoChico.length} texto(s) < 12px` : '',
      ].filter(Boolean);
      console.log(`  ${motor.id.padEnd(8)} ${ancho.id.padEnd(4)} ${vista.padEnd(9)} ${problemas.length ? problemas.join(' · ') : 'OK'}`);
    }
    await contexto.close();
  }
  await navegador.close();
}

const conProblemas = informe.resultados.filter((r) => r.desborde || r.controlesChicos.length || r.textoChico.length);
await fs.mkdir(path.dirname(SALIDA), { recursive: true });
await fs.writeFile(SALIDA, `${JSON.stringify(informe, null, 2)}\n`, 'utf8');
console.log(`\n${informe.resultados.length} combinaciones · ${conProblemas.length} con hallazgos`);
console.log(`informe: ${path.relative(ROOT, SALIDA).replaceAll('\\', '/')}`);
if (conProblemas.some((r) => r.desborde)) {
  console.error('\nHAY DESBORDE HORIZONTAL: la pantalla se mueve de costado.');
  process.exit(1);
}
