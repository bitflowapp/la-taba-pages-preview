// Ensayo del camino del CLIENTE, sin crear el pedido.
//
// Abre el storefront publicado en un navegador con forma de telefono, busca el
// producto, lo agrega y llega hasta el formulario de checkout. AHI SE PLANTA:
// no envia nada. Sirve para dos cosas: confirmar que el camino existe y saber
// exactamente que campos le van a pedir a la persona.
import fs from 'node:fs';
import path from 'node:path';
import { requireDelRepo, SITIO, evidencia } from './entorno.mjs';

const { chromium, devices } = requireDelRepo('@playwright/test');
const PRODUCTO = process.env.QA_PRODUCTO || 'Speed Unlimited';
const EV = evidencia('gate-cliente');

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({
  ...devices['Pixel 7'],
  locale: 'es-AR',
  timezoneId: 'America/Argentina/Buenos_Aires',
  serviceWorkers: 'allow',
});
const page = await context.newPage();
const errores = [];
page.on('pageerror', (e) => errores.push(String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errores.push(`console: ${m.text().slice(0, 200)}`); });

await page.goto(`${SITIO}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(9000);
await page.screenshot({ path: path.join(EV, 'm2-01-tienda.png'), fullPage: false });

const productos = await page.locator('[data-product-id], .product-card, article:has([data-add-to-cart])').count();
console.log(`tarjetas de producto visibles: ${productos}`);
console.log(`errores de JS al arrancar: ${errores.length ? errores.join(' | ') : 'ninguno'}`);

// buscador, si existe
// El buscador vive detrás de un control y puede estar oculto: si no se deja
// escribir, no importa — el catálogo entero entra en la pantalla.
const buscador = page.locator('input[type="search"], [data-catalog-search]').first();
if (await buscador.count()) {
  await buscador.fill(PRODUCTO.split(' ')[0], { timeout: 4000 })
    .then(() => page.waitForTimeout(2500))
    .catch(() => console.log('el buscador está oculto; sigo con el catálogo completo'));
}
// El control real es `[data-add-product="<uuid>"]`, con el nombre en su
// aria-label. Se elige por ahí y no por el texto de un contenedor cualquiera.
const agregar = page.locator(`[data-add-product][aria-label*="${PRODUCTO}"]`).first();
const visible = await agregar.count();
console.log(`«${PRODUCTO}» con botón de agregar: ${visible > 0}`);
if (visible) {
  await agregar.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(EV, 'm2-02-producto.png') });
  await agregar.click({ timeout: 10000 }).catch((e) => console.log('no pude agregar:', String(e).slice(0, 120)));
  await page.waitForTimeout(3000);
  console.log('producto agregado al carrito (sólo local, todavía no hay pedido)');
}
await page.screenshot({ path: path.join(EV, 'm2-03-carrito.png'), fullPage: false });

await page.locator('[data-open-cart]').first().click({ timeout: 8000 }).catch(() => {});
await page.waitForTimeout(3500);
await page.screenshot({ path: path.join(EV, 'm2-04-checkout.png'), fullPage: true });

const texto = await page.evaluate('(document.body?.innerText||"").replace(/\\s+/g," ")');
console.log(`\n--- lo que muestra la pantalla ---\n${texto.slice(0, 1400)}`);

const campos = await page.evaluate(`[...document.querySelectorAll('input,select,textarea')]
  .filter((el) => el.offsetParent !== null)
  .map((el) => ({ name: el.name || el.id || el.getAttribute('data-field') || '', tipo: el.type || el.tagName, requerido: el.required, etiqueta: (el.labels?.[0]?.textContent || el.placeholder || '').trim().slice(0,60) }))`);
console.log('\n--- campos visibles del formulario ---');
for (const c of campos) console.log(`  ${c.requerido ? '*' : ' '} ${String(c.name).padEnd(28)} ${String(c.tipo).padEnd(10)} ${c.etiqueta}`);

const pagos = await page.evaluate(`[...document.querySelectorAll('input[name*="pay" i],input[name*="pago" i],[data-payment-method],label')]
  .map((el)=> (el.textContent||el.value||'').trim()).filter((t)=>/efectivo|mercado|transfer|tarjeta/i.test(t)).slice(0,10)`);
console.log('\nmedios de pago que ofrece:', JSON.stringify(pagos));

console.log(`\nerrores de JS totales: ${errores.length ? errores.join(' | ') : 'ninguno'}`);
fs.writeFileSync(path.join(EV, 'm2-ensayo-storefront.json'),
  JSON.stringify({ productos, producto: PRODUCTO, visible: visible > 0, campos, pagos, errores, texto: texto.slice(0, 3000) }, null, 2), 'utf8');

console.log('\nEL ENSAYO NO ENVIA EL PEDIDO. Cierro sin tocar «confirmar».');
await context.close();
await browser.close();
