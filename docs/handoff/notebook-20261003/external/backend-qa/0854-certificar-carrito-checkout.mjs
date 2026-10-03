// Contrato 10 sobre la URL pública: el carrito acepta un producto real, el
// número sobrevive a una recarga, y el checkout sigue en pie.
//
// NO confirma ningún pedido: se detiene en la pantalla de checkout. Nada de
// stock, nada de reservas, nada de dinero.
import path from 'node:path';
import { createRequire } from 'node:module';

const REPO = process.env.TABA_REPO;
const requireDelRepo = createRequire(path.join(REPO, 'package.json'));
const { chromium, devices } = requireDelRepo('@playwright/test');

const SITIO = process.env.TABA_SITIO || 'https://taba2-staging.pages.dev';
const SALIDA = process.env.TABA_SALIDA;

const resultados = [];
const check = (nombre, ok, detalle = '') => {
  resultados.push({ nombre, ok, detalle });
  console.log(`${ok ? 'OK  ' : 'FALLA'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
};

// Cuenta lo que el humano ve: el número del carrito en la pantalla.
const contador = (page) => page.evaluate(() => {
  const texto = document.body?.innerText || '';
  const m = texto.match(/carrito[^\d]{0,24}(\d+)/i);
  return m ? Number(m[1]) : null;
});

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  ...devices['iPhone 13'], locale: 'es-AR', serviceWorkers: 'allow',
});
const page = await context.newPage();
const errores = [];
page.on('pageerror', (e) => errores.push(String(e)));

await page.goto(`${SITIO}/#catalog`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(9000);

const vacio = await contador(page);
const cta = await page.evaluate(() => {
  const botones = [...document.querySelectorAll('button')]
    .filter((b) => /agregar/i.test(b.textContent || ''));
  if (!botones.length) return null;
  botones[0].click();
  return botones[0].textContent.trim().slice(0, 30);
});
await page.waitForTimeout(3500);
const conUno = await contador(page);

check('10 · el carrito acepta un producto real de la góndola',
  cta !== null && conUno !== null && (vacio === null || conUno > vacio),
  `CTA «${cta}» · contador ${vacio ?? '—'} → ${conUno ?? '—'}`);

// Segundo producto: que sume, no que reemplace.
await page.evaluate(() => {
  const botones = [...document.querySelectorAll('button')]
    .filter((b) => /agregar/i.test(b.textContent || ''));
  if (botones[1]) botones[1].click();
});
await page.waitForTimeout(3000);
const conDos = await contador(page);
check('10b · un segundo producto suma en vez de reemplazar',
  conDos !== null && conUno !== null && conDos > conUno, `${conUno} → ${conDos}`);

// La recarga: acá es donde la caché vieja rompería el carrito.
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(9000);
const trasRecarga = await contador(page);
check('10c · y el carrito sobrevive a la recarga',
  trasRecarga !== null && trasRecarga === conDos, `${conDos} → ${trasRecarga}`);

// El checkout: que abra y que sepa que hay algo que cobrar. Sin confirmar.
await page.goto(`${SITIO}/#checkout`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(9000);
const checkout = await page.evaluate(() => {
  const t = document.body?.innerText || '';
  return {
    abre: /checkout|finalizar|confirmar pedido|entrega|retiro/i.test(t),
    muestraTotal: /\$\s?[\d.]{3,}/.test(t),
    pideUbicacion: /ubicaci[oó]n|confirmar.*punto|direcci[oó]n/i.test(t),
    diceCeroPesos: /\$\s*0(?!\d)/.test(t),
    extracto: t.replace(/\s+/g, ' ').slice(0, 220),
  };
});
check('10d · el checkout abre sobre el carrito cargado', checkout.abre);
check('10e · y muestra un total real, no $ 0',
  checkout.muestraTotal && !checkout.diceCeroPesos);
check('8e · el checkout sigue exigiendo dónde entregar', checkout.pideUbicacion);
check('sin errores de página', errores.length === 0, errores.slice(0, 2).join(' | ') || 'ninguno');

console.log(`\nextracto del checkout: ${checkout.extracto}`);
await page.screenshot({ path: path.join(SALIDA, 'checkout-publico-v55.png'), fullPage: false });
await context.close();
await browser.close();

console.log('');
const fallidos = resultados.filter((r) => !r.ok);
console.log(`${resultados.length - fallidos.length}/${resultados.length} OK`);
if (fallidos.length) {
  for (const f of fallidos) console.log(`  - ${f.nombre}: ${f.detalle}`);
  process.exitCode = 1;
}
