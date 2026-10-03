/*
 * Qué JS pide la HOME, en cada lado. El A/B dice "+2 módulos, +36 KB" pero no
 * cuáles: si los módulos del mapa se colaron al arranque, la integración se
 * comió parte de la transformación de performance de e59ac1c y hay que verlo
 * por nombre, no por total.
 */
import path from 'node:path';
import { createRequire } from 'node:module';

const req = createRequire(path.join(process.env.TABA_REPO, 'package.json'));
const { chromium, devices } = req('@playwright/test');

async function modulos(url) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...devices['iPhone 13'], locale: 'es-AR', serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(13000);
  const out = await page.evaluate(() => performance.getEntriesByType('resource')
    .filter((r) => /\.js(\?|$)/.test(r.name))
    .map((r) => ({ n: new URL(r.name).pathname, kb: Math.round((r.transferSize || 0) / 1024) })));
  await context.close();
  await browser.close();
  return out;
}

const antes = await modulos('http://127.0.0.1:8743/?demo=1');
const despues = await modulos('http://127.0.0.1:8742/?demo=1');

const setA = new Set(antes.map((m) => m.n));
const setD = new Set(despues.map((m) => m.n));
const nuevos = despues.filter((m) => !setA.has(m.n));
const idos = antes.filter((m) => !setD.has(m.n));

console.log(`ANTES ${antes.length} módulos · DESPUES ${despues.length} módulos`);
console.log('\nNUEVOS en la home de la candidata:');
for (const m of nuevos) console.log(`  + ${m.n}  ${m.kb} KB`);
console.log('\nYA NO se piden:');
for (const m of idos) console.log(`  - ${m.n}  ${m.kb} KB`);
