/*
 * A/B en el MISMO entorno: mismo host, misma red emulada, mismo navegador,
 * alternando ANTES y DESPUES en cada vuelta para que una máquina que se pone
 * lenta a mitad de la corrida no le regale la diferencia a uno de los dos.
 *
 *   8643 = ANTES (e59ac1c, la punta certificada de la que sale esta rama)
 *   8642 = DESPUES (esta rama)
 *
 * Se reporta la MEDIANA de N corridas: una sola tiene ruido de sobra para
 * contar cualquier historia.
 */
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const req = createRequire(path.join(process.env.TABA_REPO, 'package.json'));
const { chromium, devices } = req('@playwright/test');

const CORRIDAS = Number(process.env.TABA_AB_RUNS || 5);
const RED = { download: 4 * 1024 * 1024 / 8, upload: 3 * 1024 * 1024 / 8, latency: 40 };

const SONDA = `
  window.__t = { lcp: 0, cls: 0, bloqueo: 0, primerProducto: null, inp: 0 };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__t.lcp = Math.max(window.__t.lcp, e.startTime); })
      .observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__t.cls += e.value; })
      .observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__t.bloqueo += Math.max(0, e.duration - 50); })
      .observe({ type: 'longtask', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__t.inp = Math.max(window.__t.inp, e.duration); })
      .observe({ type: 'event', buffered: true, durationThreshold: 16 });
  } catch {}
  (() => {
    const busca = () => {
      if (window.__t.primerProducto !== null) return true;
      const hay = [...document.querySelectorAll('button')].some((b) => /agregar/i.test(b.textContent || ''));
      if (hay) { window.__t.primerProducto = performance.now(); return true; }
      return false;
    };
    const enganchar = () => { if (busca()) return; const iv = setInterval(() => { if (busca()) clearInterval(iv); }, 60); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enganchar, { once: true });
    else enganchar();
  })();
`;

async function unaCorrida(url) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...devices['iPhone 13'], locale: 'es-AR', serviceWorkers: 'block' });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, downloadThroughput: RED.download, uploadThroughput: RED.upload, latency: RED.latency,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.addInitScript(SONDA);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(13000);

  // INP real: se toca "Agregar" del primer producto comprable y se mide lo que
  // tarda el hilo en responder ese gesto, que es la interacción que importa.
  let tapMs = null;
  const agregar = page.locator('[data-add-product]:not([disabled])').first();
  if (await agregar.count()) {
    await agregar.scrollIntoViewIfNeeded().catch(() => {});
    const t0 = Date.now();
    await agregar.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(900);
    tapMs = Date.now() - t0;
  }

  const m = await page.evaluate(() => {
    const rec = performance.getEntriesByType('resource');
    const js = rec.filter((r) => /\.js(\?|$)/.test(r.name));
    const img = rec.filter((r) => /\.(webp|png|jpg|jpeg|svg|avif)(\?|$)/i.test(r.name));
    return {
      lcp: Math.round(window.__t.lcp || 0),
      cls: Number((window.__t.cls || 0).toFixed(4)),
      inp: Math.round(window.__t.inp || 0),
      bloqueo: Math.round(window.__t.bloqueo || 0),
      primerProducto: window.__t.primerProducto ? Math.round(window.__t.primerProducto) : null,
      fcp: Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0),
      modulos: js.length,
      kb: Math.round(js.reduce((a, r) => a + (r.transferSize || 0), 0) / 1024),
      imagenes: img.length,
      imagenesKb: Math.round(img.reduce((a, r) => a + (r.transferSize || 0), 0) / 1024),
    };
  });
  await context.close();
  await browser.close();
  return { ...m, tapMs };
}

const mediana = (v) => {
  const o = [...v].filter((x) => x != null).sort((a, b) => a - b);
  return o.length ? o[Math.floor(o.length / 2)] : null;
};

// `?demo=1` NO es un atajo: sin backend el storefront falla cerrado y muestra
// la compuerta "Pedidos online no disponibles". Medir esa pantalla es medir
// una tienda vacia, que es justo lo que no interesa. Los dos lados reciben
// exactamente la misma URL.
const lados = [
  ['ANTES (e59ac1c)', 'http://127.0.0.1:8643/?demo=1'],
  ['DESPUES', 'http://127.0.0.1:8642/?demo=1'],
];
const crudo = { 'ANTES (e59ac1c)': [], DESPUES: [] };

for (let i = 0; i < CORRIDAS; i += 1) {
  for (const [nombre, url] of lados) {
    process.stdout.write(`${nombre} ${i + 1}/${CORRIDAS}... `);
    crudo[nombre].push(await unaCorrida(url));
    console.log('ok');
  }
}

const resultados = {};
for (const [nombre, corridas] of Object.entries(crudo)) {
  resultados[nombre] = {
    modulos: mediana(corridas.map((c) => c.modulos)),
    kb: mediana(corridas.map((c) => c.kb)),
    imagenes: mediana(corridas.map((c) => c.imagenes)),
    imagenesKb: mediana(corridas.map((c) => c.imagenesKb)),
    fcp: mediana(corridas.map((c) => c.fcp)),
    lcp: mediana(corridas.map((c) => c.lcp)),
    cls: mediana(corridas.map((c) => c.cls)),
    inp: mediana(corridas.map((c) => c.inp)),
    bloqueo: mediana(corridas.map((c) => c.bloqueo)),
    primerProducto: mediana(corridas.map((c) => c.primerProducto)),
    tapMs: mediana(corridas.map((c) => c.tapMs)),
    corridas,
  };
}

const filas = [
  ['módulos JS', 'modulos', ''],
  ['JavaScript', 'kb', ' KB'],
  ['imágenes', 'imagenes', ''],
  ['peso imágenes', 'imagenesKb', ' KB'],
  ['FCP', 'fcp', ' ms'],
  ['LCP', 'lcp', ' ms'],
  ['CLS', 'cls', ''],
  ['INP (evento más lento)', 'inp', ' ms'],
  ['bloqueo de hilo', 'bloqueo', ' ms'],
  ['1er producto comprable', 'primerProducto', ' ms'],
  ['respuesta al "Agregar"', 'tapMs', ' ms'],
];

const a = resultados['ANTES (e59ac1c)'];
const d = resultados.DESPUES;
console.log('');
console.log('métrica                        ANTES        DESPUES     diferencia');
console.log('─'.repeat(72));
for (const [rotulo, clave, unidad] of filas) {
  const va = a[clave];
  const vd = d[clave];
  const delta = (va == null || vd == null) ? '—'
    : va === 0 ? `${vd - va > 0 ? '+' : ''}${(vd - va).toFixed(clave === 'cls' ? 4 : 0)}`
      : `${vd - va > 0 ? '+' : ''}${(vd - va).toFixed(clave === 'cls' ? 4 : 0)} (${(((vd - va) / va) * 100).toFixed(0)}%)`;
  console.log(
    `${rotulo.padEnd(28)} ${String(va + unidad).padStart(10)}  ${String(vd + unidad).padStart(10)}  ${delta.padStart(16)}`,
  );
}

fs.writeFileSync(process.env.TABA_AB_OUT || 'ab.json', JSON.stringify(resultados, null, 2));
