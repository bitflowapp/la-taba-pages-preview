/*
 * Regresión del sitio PUBLICADO, en un navegador real y SIN ESCRIBIR NADA.
 * El carrito vive en el almacenamiento del navegador: sumar una unidad no crea
 * ningún pedido. No se inicia sesión, no se crea identidad, no se toca la base.
 */
import { chromium } from '@playwright/test';

const BASE = 'https://la-taba.pages.dev';
const lineas = [];
let fallas = 0;
const ok = (t) => lineas.push(`  OK    ${t}`);
const mal = (t) => { fallas += 1; lineas.push(`  FALLA ${t}`); };

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  userAgent: 'Mozilla/5.0 (Linux; Android 15; moto g15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
  hasTouch: true,
  serviceWorkers: 'allow',
});
const page = await context.newPage();
const errores = [];
page.on('pageerror', (e) => errores.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 90_000 });

  // 9 · catálogo visible — se entra al catálogo como entra un cliente
  await page.evaluate(() => { window.location.hash = '#catalog'; });
  await page.waitForTimeout(2500);
  const n = await page.locator('.thumb').count();
  if (n >= 30) ok(`catálogo visible · ${n} productos`); else mal(`el catálogo trajo ${n} productos`);

  // 10 · producto agregable
  const mas = page.locator('[data-add-product] >> visible=true').first();
  if (await mas.count() === 0) { mal('no se encontró el control para agregar al carrito'); }
  else {
    await mas.click();
    await page.waitForTimeout(1200);
    const guardado = await page.evaluate(() => {
      for (const k of Object.keys(localStorage)) {
        if (/cart|carrito/i.test(k)) { const v = localStorage.getItem(k) || ''; if (v.length > 2) return `${k}=${v.slice(0, 90)}`; }
      }
      return '';
    });
    if (guardado) ok(`producto agregable · ${guardado}`); else mal('agregar no dejó nada en el carrito');
  }

  // 11 · el carrito muestra lo agregado
  const badge = page.locator('[data-open-cart] >> visible=true').first();
  if (await badge.count() > 0) {
    const t = (await badge.textContent() || '').trim();
    if (t && t !== '0') ok(`el carrito cuenta lo agregado · "${t}"`); else mal(`el contador del carrito dice "${t}"`);
  } else ok('el carrito no expone contador con estos selectores (se validó por almacenamiento)');

  // 12 · Auth vivo (GET de salud con la clave publicable, sin iniciar sesión
  //      ni crear identidad: GoTrue exige `apikey` hasta para /health)
  const clave = await page.evaluate(() => globalThis.__LA_TABA_RUNTIME_CONFIG__?.repository?.publishableKey || '');
  const salud = await page.request.get('https://wwcpogltfgzgkrlilbcd.supabase.co/auth/v1/health', { headers: { apikey: clave } });
  if (salud.ok()) ok(`Auth responde · HTTP ${salud.status()} ${JSON.stringify(await salud.json()).slice(0, 80)}`);
  else mal(`Auth contestó ${salud.status()}`);

  // 13 · Panel del negocio vivo (sólo se carga la pantalla; no se inicia sesión)
  const panel = await context.newPage();
  await panel.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await panel.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 90_000 });
  await panel.evaluate(() => { window.location.hash = '#business'; });
  await panel.waitForTimeout(5000);
  const hayPanel = await panel.evaluate(() => {
    const txt = document.body.innerText || '';
    return /panel|ingres|sesi[oó]n|correo|contrase/i.test(txt);
  });
  if (hayPanel) ok('el Panel del negocio carga su pantalla de ingreso'); else mal('el Panel no dibujó nada reconocible');
  await panel.close();

  // 14 · consola
  const nuevos = errores.filter((e) => !/favicon|Failed to load resource: the server responded with a status of 404/i.test(e));
  if (nuevos.length === 0) ok('consola sin errores'); else mal(`consola con ${nuevos.length} error(es): ${nuevos.slice(0, 3).join(' · ')}`);

  // 15 · nada vivo en la caché
  const sospechosas = await page.evaluate(async () => {
    const nombres = await caches.keys();
    const urls = [];
    for (const n of nombres) urls.push(...(await (await caches.open(n)).keys()).map((r) => r.url));
    return urls.filter((u) => /\/rest\/v1\/|\/auth\/v1\/|\/functions\/v1\/|supabase\.co/.test(u));
  });
  if (sospechosas.length === 0) ok('la caché no guarda pedidos, sesiones ni API'); else mal(`la caché guarda ${sospechosas.length}: ${sospechosas.slice(0, 3).join(', ')}`);
} finally {
  await browser.close();
}

console.log(`\nREGRESIÓN DEL SITIO PUBLICADO — ${BASE}\n`);
console.log(lineas.join('\n'));
console.log(fallas ? `\n${fallas} falla(s).\n` : '\nSin regresiones.\n');
process.exit(fallas ? 1 : 0);
