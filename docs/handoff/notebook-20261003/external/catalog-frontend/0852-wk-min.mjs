import { webkit } from '@playwright/test';

const BASE = process.env.BASE || 'http://127.0.0.1:8248';
const browser = await webkit.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', reducedMotion: 'reduce', locale: 'es-AR' });
const page = await context.newPage();
page.on('requestfailed', (r) => console.log('FALLÓ', r.url().slice(0, 90), r.failure()?.errorText));
try {
  await page.goto(`${BASE}/?reset=1&demo=1#tracking`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  console.log('commit ok');
  await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
  console.log('domcontentloaded ok, título:', await page.title());
} catch (error) {
  console.log('ERROR:', String(error).split('\n')[0]);
}
await browser.close();
