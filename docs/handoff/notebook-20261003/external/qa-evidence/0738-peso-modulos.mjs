/*
 * Dónde están los +36 KB, módulo por módulo. Importa distinguir dos cosas muy
 * distintas: que la integración haya ARRASTRADO capas nuevas al arranque, o
 * que una capa que YA estaba en la home haya crecido.
 */
import path from 'node:path';
import { createRequire } from 'node:module';

const req = createRequire(path.join(process.env.TABA_REPO, 'package.json'));
const { chromium, devices } = req('@playwright/test');

async function pesos(url) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...devices['iPhone 13'], locale: 'es-AR', serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(13000);
  const out = await page.evaluate(() => Object.fromEntries(performance.getEntriesByType('resource')
    .filter((r) => /\.js(\?|$)/.test(r.name))
    .map((r) => [new URL(r.name).pathname, r.transferSize || 0])));
  await context.close();
  await browser.close();
  return out;
}

const a = await pesos('http://127.0.0.1:8743/?demo=1');
const d = await pesos('http://127.0.0.1:8742/?demo=1');

const nombres = new Set([...Object.keys(a), ...Object.keys(d)]);
const filas = [...nombres]
  .map((n) => ({ n, a: a[n] || 0, d: d[n] || 0, delta: (d[n] || 0) - (a[n] || 0) }))
  .filter((f) => f.delta !== 0)
  .sort((x, y) => y.delta - x.delta);

const total = filas.reduce((s, f) => s + f.delta, 0);
console.log('módulos que cambian de peso en la home:\n');
for (const f of filas) {
  console.log(`  ${f.delta > 0 ? '+' : ''}${(f.delta / 1024).toFixed(1)} KB  ${f.n}  (${(f.a / 1024).toFixed(1)} → ${(f.d / 1024).toFixed(1)})`);
}
console.log(`\n  TOTAL ${total > 0 ? '+' : ''}${(total / 1024).toFixed(1)} KB`);
