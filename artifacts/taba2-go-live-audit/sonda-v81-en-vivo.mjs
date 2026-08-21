/*
 * Sonda READ-ONLY de los dos fixes de v81 en el sitio publicado:
 *   A2 · las tarjetas del catálogo dicen el litraje;
 *   A1 · abrir el carrito NO dispara POST /auth/v1/signup.
 * Navega como cliente anónimo; no confirma nada.
 */
import { chromium } from 'playwright';

const HOST = process.env.TABA_HOST || 'https://la-taba.pages.dev';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
const page = await context.newPage();
const signups = [];
page.on('request', (r) => { if (/\/auth\/v1\/signup/.test(r.url())) signups.push(`${r.method()} ${r.url()}`); });

await page.goto(`${HOST}/#catalog`, { waitUntil: 'networkidle', timeout: 90000 });
await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 60000 });
await page.waitForSelector('[data-product-grid] .product-card', { timeout: 30000 });
const lineas = await page.$$eval('[data-product-grid] .product-card .product-body', (bodies) => bodies.slice(0, 40).map((b) => ({
  nombre: b.querySelector('h3')?.textContent?.trim() || '',
  linea: b.querySelector('p')?.textContent?.trim() || '',
})));
const conLitraje = lineas.filter((l) => /\d+(,\d+)?\s*(L|ml)\b/.test(l.linea));
const conSlug = lineas.filter((l) => /botella-pet|\bpet\b/i.test(l.linea));
console.log(`tarjetas leídas: ${lineas.length} · con litraje: ${conLitraje.length} · con slug de envase: ${conSlug.length}`);
for (const l of lineas.slice(0, 8)) console.log(`  · ${l.nombre} — «${l.linea}»`);

// A1: entrar al carrito como anónimo y mirar la red.
await page.evaluate(() => { window.location.hash = '#cart'; });
await page.waitForTimeout(4000);
console.log(`POST /auth/v1/signup al abrir el carrito: ${signups.length}`);
for (const s of signups) console.log(`  ! ${s}`);
await browser.close();
const ok = conLitraje.length === lineas.length && conSlug.length === 0 && signups.length === 0;
console.log(ok ? 'SONDA v81: PASS' : 'SONDA v81: FALLA');
process.exit(ok ? 0 : 1);
