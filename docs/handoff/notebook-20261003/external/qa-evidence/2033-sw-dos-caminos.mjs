import { chromium } from 'playwright';
const URL_S = 'https://taba2-staging.pages.dev/';

async function medir(perfil, etiqueta, visitas) {
  const ctx = await chromium.launchPersistentContext(perfil, { headless: true, viewport: { width: 390, height: 844 } });
  const page = ctx.pages()[0] || await ctx.newPage();
  const err = []; page.on('pageerror', e => err.push(String(e).slice(0,150)));
  page.on('response', r => { if (r.status() >= 400) err.push(`${r.status()} ${r.url()}`); });
  for (let i = 0; i < visitas; i++) {
    await page.goto(URL_S, { waitUntil: 'load', timeout: 90000 });
    await page.evaluate(() => navigator.serviceWorker.ready).catch(()=>{});
    await page.waitForTimeout(2500);
  }
  const r = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return {
      caches: (await caches.keys()).sort(),
      controlando: Boolean(navigator.serviceWorker.controller),
      tieneWaiting: Boolean(reg?.waiting),
      tieneInstalling: Boolean(reg?.installing),
    };
  });
  console.log(`\n--- ${etiqueta} ---`);
  console.log(JSON.stringify({ ...r, errores: err.length ? err.slice(0,3) : 'ninguno' }, null, 2));
  await ctx.close();
  return r;
}

// A) cliente NUEVO, perfil limpio
await medir('D:/1212/_claude-tmp/rc1/perfil-limpio', 'A · instalacion limpia (cliente nuevo)', 2);
// B) el perfil que venia de v56, reabierto sin clientes previos vivos
await medir('D:/1212/_claude-tmp/rc1/perfil-sw', 'B · perfil que venia de v56, reabierto', 2);
