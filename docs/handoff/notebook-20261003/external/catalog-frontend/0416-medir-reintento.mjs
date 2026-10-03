/* ¿Cuánto cuesta, por visita, una publicación cuyo install falla? */
import { chromium } from 'playwright';
import fs from 'node:fs';
const leer = () => { try { return JSON.parse(fs.readFileSync('.local/contador.json', 'utf8')); } catch { return { n: 0, bytes: 0 }; } };
const ctx = await chromium.launchPersistentContext('.local/perfil-costo', { headless: true });
const page = await ctx.newPage();
fs.rmSync('.local/PUBLICACION', { force: true }); fs.rmSync('.local/ROTO', { force: true });
await page.goto('http://127.0.0.1:4599/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 30000 });
await page.waitForTimeout(4000);

// publicacion nueva ROTA
fs.writeFileSync('.local/PUBLICACION', 'v86'); fs.writeFileSync('.local/ROTO', '1');
for (let i = 1; i <= 3; i++) {
  await page.waitForTimeout(1200);
  const antes = leer();
  await page.goto('http://127.0.0.1:4599/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(9000);
  const desp = leer();
  const st = await page.evaluate(async () => ({
    caches: await caches.keys(),
    banner: !document.querySelector('[data-app-update-banner]')?.hidden,
  }));
  console.log(`visita ${i} con install roto: ${desp.n - antes.n} pedidos · ${((desp.bytes - antes.bytes) / 1024).toFixed(0)} KB · caches=${st.caches.length} · banner=${st.banner}`);
}
await ctx.close();
