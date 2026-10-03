import { chromium } from 'playwright';
import fs from 'node:fs';
const leer = () => { try { return JSON.parse(fs.readFileSync('.local/contador.json', 'utf8')); } catch { return { n: 0, bytes: 0 }; } };
const ctx = await chromium.launchPersistentContext('.local/perfil-sano', { headless: true });
const page = await ctx.newPage();
fs.rmSync('.local/PUBLICACION', { force: true }); fs.rmSync('.local/ROTO', { force: true });
await page.goto('http://127.0.0.1:4599/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 30000 });
await page.waitForTimeout(5000);
for (let i = 1; i <= 2; i++) {
  await page.waitForTimeout(1200);
  const a = leer();
  await page.goto('http://127.0.0.1:4599/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(9000);
  const d = leer();
  console.log(`visita ${i} SIN publicacion nueva: ${d.n - a.n} pedidos · ${((d.bytes - a.bytes) / 1024).toFixed(0)} KB`);
}
await ctx.close();
