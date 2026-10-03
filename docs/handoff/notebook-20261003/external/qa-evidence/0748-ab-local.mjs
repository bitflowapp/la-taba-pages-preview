// A/B en el MISMO entorno: mismo host, misma red emulada, mismo navegador.
// 8623 = base (da56ce9, lo que hoy sirve staging) · 8622 = candidata.
//
// Se corre varias veces cada uno y se reporta la MEDIANA, porque una sola
// corrida en esta máquina tiene ruido de sobra para contar cualquier historia.
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const REPO = process.env.TABA_REPO;
const req = createRequire(path.join(REPO, 'package.json'));
const { chromium, devices } = req('@playwright/test');

const CORRIDAS = Number(process.env.TABA_AB_RUNS || 5);
const RED = { download: 4 * 1024 * 1024 / 8, upload: 3 * 1024 * 1024 / 8, latency: 40 };

const SONDA = `
  window.__t = { lcp: 0, bloqueo: 0, primerProducto: null };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__t.lcp = Math.max(window.__t.lcp, e.startTime); })
      .observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__t.bloqueo += Math.max(0, e.duration - 50); })
      .observe({ type: 'longtask', buffered: true });
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
  await cdp.send('Network.emulateNetworkConditions', { offline: false, downloadThroughput: RED.download, uploadThroughput: RED.upload, latency: RED.latency });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.addInitScript(SONDA);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(13000);
  const m = await page.evaluate(() => {
    const rec = performance.getEntriesByType('resource');
    const js = rec.filter((r) => /\.js(\?|$)/.test(r.name));
    return {
      lcp: Math.round(window.__t.lcp || 0),
      bloqueo: Math.round(window.__t.bloqueo || 0),
      primerProducto: window.__t.primerProducto ? Math.round(window.__t.primerProducto) : null,
      fcp: Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0),
      modulos: js.length,
      kb: Math.round(js.reduce((a, r) => a + (r.transferSize || 0), 0) / 1024),
    };
  });
  await context.close();
  await browser.close();
  return m;
}

const mediana = (v) => { const o = [...v].filter((x) => x != null).sort((a, b) => a - b); return o.length ? o[Math.floor(o.length / 2)] : null; };

const resultados = {};
for (const [nombre, url] of [['ANTES (da56ce9)', 'http://127.0.0.1:8623/'], ['DESPUES', 'http://127.0.0.1:8622/']]) {
  const corridas = [];
  for (let i = 0; i < CORRIDAS; i += 1) {
    process.stdout.write(`${nombre} ${i + 1}/${CORRIDAS}... `);
    corridas.push(await unaCorrida(url));
    console.log('ok');
  }
  resultados[nombre] = {
    lcp: mediana(corridas.map((c) => c.lcp)),
    fcp: mediana(corridas.map((c) => c.fcp)),
    bloqueo: mediana(corridas.map((c) => c.bloqueo)),
    primerProducto: mediana(corridas.map((c) => c.primerProducto)),
    modulos: mediana(corridas.map((c) => c.modulos)),
    kb: mediana(corridas.map((c) => c.kb)),
    corridas,
  };
}

console.log('');
console.log('                    módulos      JS      FCP      LCP   bloqueo   1er-producto');
console.log('─'.repeat(80));
for (const [n, r] of Object.entries(resultados)) {
  console.log(`${n.padEnd(18)} ${String(r.modulos).padStart(6)} ${String(r.kb + ' KB').padStart(8)} `
    + `${String(r.fcp + ' ms').padStart(8)} ${String(r.lcp + ' ms').padStart(8)} `
    + `${String(r.bloqueo + ' ms').padStart(8)} ${String((r.primerProducto ?? '—') + ' ms').padStart(12)}`);
}
const a = resultados['ANTES (da56ce9)']; const d = resultados.DESPUES;
const delta = (x, y) => (x && y ? `${y - x > 0 ? '+' : ''}${y - x} (${(((y - x) / x) * 100).toFixed(0)}%)` : '—');
console.log('─'.repeat(80));
console.log(`diferencia         ${String(d.modulos - a.modulos).padStart(6)} ${String((d.kb - a.kb) + ' KB').padStart(8)} `
  + `${delta(a.fcp, d.fcp).padStart(8)} ${delta(a.lcp, d.lcp).padStart(8)} ${delta(a.bloqueo, d.bloqueo).padStart(8)} ${delta(a.primerProducto, d.primerProducto).padStart(12)}`);

fs.writeFileSync(process.env.TABA_AB_OUT || 'ab-local.json', JSON.stringify(resultados, null, 2));
