/*
 * Sonda mínima: ¿QUÉ paso del recorrido anónimo dispara POST /auth/v1/signup?
 * Fases: 1) home  2) catálogo  3) agregar 1 producto  4) abrir carrito.
 * Solo navegación + un tap de "Agregar" (permitido). Sin submit, sin perfil.
 */
import { chromium } from 'playwright';

const HOST = 'https://la-taba.pages.dev';
let faseActual = '1-home';
const eventos = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
page.on('request', (r) => {
  const url = r.url();
  if (/supabase\.co\/(auth|rest)/.test(url) && !['GET', 'HEAD', 'OPTIONS'].includes(r.method())) {
    eventos.push(`[${faseActual}] ${r.method()} ${url.replace(/^https:\/\/[^/]+/, '')}`);
  }
});

await page.goto(`${HOST}/#home`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(async () => {
  const { getState } = await import('/js/state.js');
  return getState().products.length > 0;
}, null, { timeout: 30000 });
await page.waitForTimeout(4000);

faseActual = '2-catalogo';
await page.goto(`${HOST}/#catalog`, { waitUntil: 'networkidle' });
await page.locator('[data-product-grid] .product-card').first().waitFor();
await page.waitForTimeout(3000);

faseActual = '3-agregar-al-carrito';
const boton = page.locator('[data-product-grid] [data-add-product]:not([disabled])').first();
await boton.click();
await page.waitForTimeout(4000);

faseActual = '4-abrir-carrito';
await page.locator('[data-open-cart] >> visible=true').first().click();
await page.waitForTimeout(5000);

console.log(eventos.length ? eventos.join('\n') : '(ningún request mutante a supabase)');
await browser.close();
