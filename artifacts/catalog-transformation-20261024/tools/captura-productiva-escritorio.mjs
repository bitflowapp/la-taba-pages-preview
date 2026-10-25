// Home del camino productivo (catálogo simulado) en tableta y escritorio, para ver el hero sin foto
// editorial. Sólo Playwright de escritorio; no toca ningún teléfono.
//   BASE=http://127.0.0.1:8262 node artifacts/catalog-transformation-20261024/tools/captura-productiva-escritorio.mjs
import path from 'node:path';
import { chromium } from '@playwright/test';
import { openRuntimeCatalog } from '../../../tests/e2e/catalog-runtime-fixture.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8262';
const out = path.resolve('artifacts/catalog-transformation-20261024/capturas/despues');
const browser = await chromium.launch();
for (const [nombre, vp] of [['tableta-768', { width: 768, height: 1024 }], ['escritorio-1280', { width: 1280, height: 800 }]]) {
  const context = await browser.newContext({ viewport: vp, baseURL: BASE, serviceWorkers: 'block' });
  const page = await context.newPage();
  await openRuntimeCatalog(page, { view: 'home', waitForCatalog: false });
  await page.screenshot({ path: path.join(out, `prod-home-${nombre}.png`) });
  await context.close();
}
await browser.close();
console.log('listo');
