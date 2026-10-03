// Mide el storefront como lo sufre un cliente: cuánto tarda en poder comprar.
//
// No mide "carga" en abstracto. Mide TIEMPO HASTA VER ALGO QUE SE PUEDE COMPRAR,
// que es la métrica que decide si una persona se queda o se va. Además saca
// LCP/CLS, el peso real por tipo de recurso y el tiempo bloqueado por JS.
//
// Corre tres escenarios sobre la MISMA URL pública:
//   fria-4g    · primera visita, sin service worker, red móvil típica
//   fria-lenta · primera visita, red mala (el peor caso realista en Neuquén)
//   tibia-4g   · segunda visita, con service worker ya instalado
//
//   node medir-storefront.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const REPO = process.env.TABA_REPO;
const requireDelRepo = createRequire(path.join(REPO, 'package.json'));
const { chromium, devices } = requireDelRepo('@playwright/test');

const SITIO = process.env.TABA_SITIO || 'https://taba2-staging.pages.dev';
const SALIDA = process.env.TABA_SALIDA || '.';
const ETIQUETA = process.env.TABA_ETIQUETA || 'antes';

// Perfiles de red. Los números son los de Chrome DevTools.
const REDES = {
  '4g':    { download: 4 * 1024 * 1024 / 8, upload: 3 * 1024 * 1024 / 8, latency: 20 },
  'lenta': { download: 400 * 1024 / 8, upload: 400 * 1024 / 8, latency: 400 },
};

const SONDA = `
  window.__taba = { lcp: 0, cls: 0, tareasLargas: 0, bloqueoMs: 0, primerProducto: null };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__taba.lcp = Math.max(window.__taba.lcp, e.startTime);
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (!e.hadRecentInput) window.__taba.cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        window.__taba.tareasLargas += 1;
        window.__taba.bloqueoMs += Math.max(0, e.duration - 50);
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
  // El instante en que aparece la primera cosa comprable en pantalla.
  (() => {
    const busca = () => {
      if (window.__taba.primerProducto !== null) return true;
      const hay = [...document.querySelectorAll('button')]
        .some((b) => /agregar/i.test(b.textContent || ''));
      if (hay) { window.__taba.primerProducto = performance.now(); return true; }
      return false;
    };
    // El script de init corre ANTES de que exista el documento: observar
    // document.documentElement acá tira «parameter 1 is not of type Node».
    // Se engancha cuando el DOM ya está, y se sondea igual por si el nodo
    // aparece sin mutación observable.
    const enganchar = () => {
      if (busca()) return;
      const mo = new MutationObserver(() => { if (busca()) mo.disconnect(); });
      mo.observe(document, { childList: true, subtree: true });
      const iv = setInterval(() => { if (busca()) clearInterval(iv); }, 100);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', enganchar, { once: true });
    } else { enganchar(); }
  })();
`;

async function escenario({ nombre, red, tibia }) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...devices['iPhone 13'], locale: 'es-AR', serviceWorkers: 'allow',
  });
  const page = await context.newPage();
  const errores = [];
  const fallos = [];
  page.on('pageerror', (e) => errores.push(String(e).slice(0, 160)));
  page.on('response', (r) => { if (r.status() >= 400) fallos.push(`${r.status()} ${r.url().slice(-70)}`); });

  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, downloadThroughput: red.download, uploadThroughput: red.upload, latency: red.latency,
  });
  // Un teléfono de gama baja no tiene el CPU de esta máquina.
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  if (tibia) {
    // Primera visita para que el service worker se instale y llene su caché.
    await page.goto(`${SITIO}/`, { waitUntil: 'load', timeout: 180000 });
    await page.waitForTimeout(12000);
  }

  await page.addInitScript(SONDA);
  const t0 = Date.now();
  await page.goto(`${SITIO}/`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForTimeout(tibia ? 9000 : 14000);

  const m = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const recursos = performance.getEntriesByType('resource').map((r) => ({
      tipo: r.initiatorType, nombre: r.name, bytes: r.transferSize || 0, ms: r.duration,
    }));
    const porTipo = {};
    for (const r of recursos) {
      const clave = /\.js(\?|$)/.test(r.nombre) ? 'js'
        : /\.css(\?|$)/.test(r.nombre) ? 'css'
        : /\.(webp|png|jpg|jpeg|svg|avif)(\?|$)/i.test(r.nombre) ? 'imagen'
        : /\.(woff2?|ttf)(\?|$)/i.test(r.nombre) ? 'fuente' : 'otro';
      porTipo[clave] = porTipo[clave] || { n: 0, bytes: 0 };
      porTipo[clave].n += 1;
      porTipo[clave].bytes += r.bytes;
    }
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0;
    return {
      ttfb: Math.round(nav.responseStart || 0),
      fcp: Math.round(fcp),
      lcp: Math.round(window.__taba?.lcp || 0),
      cls: Number((window.__taba?.cls || 0).toFixed(4)),
      bloqueoMs: Math.round(window.__taba?.bloqueoMs || 0),
      tareasLargas: window.__taba?.tareasLargas || 0,
      dcl: Math.round(nav.domContentLoadedEventEnd || 0),
      carga: Math.round(nav.loadEventEnd || 0),
      primerProducto: window.__taba?.primerProducto ? Math.round(window.__taba.primerProducto) : null,
      recursos: recursos.length,
      porTipo,
      swControla: Boolean(navigator.serviceWorker?.controller),
    };
  });

  // ¿Cuántos módulos JS distintos pide la primera pantalla?
  const modulos = await page.evaluate(() => performance.getEntriesByType('resource')
    .filter((r) => /\.js(\?|$)/.test(r.name)).length);

  const total = Object.values(m.porTipo).reduce((a, x) => a + x.bytes, 0);
  await page.screenshot({ path: path.join(SALIDA, `${ETIQUETA}-${nombre}.png`) });
  await context.close();
  await browser.close();

  return {
    nombre, ...m, modulosJs: modulos, bytesTotales: total,
    segundosReales: ((Date.now() - t0) / 1000).toFixed(1),
    errores, fallos: [...new Set(fallos)],
  };
}

const resultados = [];
for (const e of [
  { nombre: 'fria-4g', red: REDES['4g'], tibia: false },
  { nombre: 'fria-lenta', red: REDES.lenta, tibia: false },
  { nombre: 'tibia-4g', red: REDES['4g'], tibia: true },
]) {
  process.stdout.write(`midiendo ${e.nombre}... `);
  const r = await escenario(e);
  resultados.push(r);
  console.log('listo');
}

const kb = (b) => `${(b / 1024).toFixed(0)} KB`;
console.log('');
console.log('escenario     TTFB   FCP    LCP    CLS     bloqueo  1er-producto  JS      imgs    total');
console.log('─'.repeat(96));
for (const r of resultados) {
  console.log(
    `${r.nombre.padEnd(13)} ${String(r.ttfb).padStart(4)}ms ${String(r.fcp).padStart(5)}ms `
    + `${String(r.lcp).padStart(5)}ms ${String(r.cls).padStart(6)}  ${String(r.bloqueoMs).padStart(6)}ms  `
    + `${String(r.primerProducto ?? '—').padStart(10)}ms  `
    + `${String(r.porTipo.js?.n ?? 0).padStart(3)}/${kb(r.porTipo.js?.bytes ?? 0).padStart(7)} `
    + `${String(r.porTipo.imagen?.n ?? 0).padStart(3)}/${kb(r.porTipo.imagen?.bytes ?? 0).padStart(7)} `
    + `${kb(r.bytesTotales).padStart(8)}`,
  );
}
console.log('');
for (const r of resultados) {
  if (r.errores.length) console.log(`errores JS en ${r.nombre}: ${r.errores.slice(0, 3).join(' | ')}`);
  if (r.fallos.length) console.log(`respuestas 4xx/5xx en ${r.nombre}: ${r.fallos.slice(0, 5).join(' | ')}`);
}

fs.writeFileSync(path.join(SALIDA, `${ETIQUETA}-medicion.json`), JSON.stringify(resultados, null, 2));
console.log(`\nguardado en ${ETIQUETA}-medicion.json`);
