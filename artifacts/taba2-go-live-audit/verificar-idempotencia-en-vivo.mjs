/*
 * READ-ONLY contra el sitio publicado. Comprueba que el Panel SERVIDO genera
 * claves de idempotencia que el servidor acepta, ejecutando el módulo real
 * bajado de producción — sin iniciar sesión, sin recibir mercadería y sin
 * llamar a ninguna RPC que escriba.
 *
 * La recepción física la hace una persona en el Panel; esto sólo demuestra que
 * el motor de claves que va a usar ya no produce la forma que el backend
 * rechaza.
 */
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const HOST = process.env.TABA_HOST || 'https://la-taba.pages.dev';
// El contrato, copiado del servidor: doce funciones validan esta expresión.
const CONTRATO = /^[A-Za-z0-9_-]{8,128}$/;

let rojo = 0;
const medir = (nombre, ok, detalle = '') => {
  console.log(`  ${ok ? 'OK  ' : 'MAL '} ${nombre}${detalle ? ` · ${detalle}` : ''}`);
  if (!ok) rojo += 1;
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
const page = await context.newPage();
const escrituras = [];
page.on('request', (r) => {
  if (r.method() !== 'POST') return;
  const url = r.url();
  if (/\/rest\/v1\/rpc\/(get_|commerce_|resolve_)/.test(url)) return;
  if (/\/rest\/v1\/rpc\/apply_inventory_movement|\/rest\/v1\/products|\/auth\/v1\/signup/.test(url)) escrituras.push(`${r.method()} ${url}`);
});

await page.goto(`${HOST}/#business`, { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForTimeout(2500);

console.log('\n── el Panel servido ──');
const [sw, panel] = await Promise.all([
  page.evaluate(async (host) => (await fetch(`${host}/sw.js?nc=${Math.random()}`, { cache: 'no-store' })).text(), HOST),
  page.evaluate(async (host) => (await fetch(`${host}/js/business/business-operations-center.js`, { cache: 'no-store' })).text(), HOST),
]);
medir('el sitio sirve v84', /la-taba-runtime-v84-recepcion-idempotente/.test(sw), (sw.match(/CACHE_NAME = '([^']+)'/) || [])[1]);
medir('el Panel servido ya no arma claves con dos puntos', !/`\$\{prefix\}:\$\{/.test(panel));
medir('el Panel servido importa el contrato compartido', /core\/idempotency-key\.js/.test(panel));

console.log('\n── el motor de claves, ejecutado desde producción ──');
const resultado = await page.evaluate(async (host) => {
  const modulo = await import(`${host}/js/core/idempotency-key.js`);
  const panelModulo = await import(`${host}/js/business/business-operations-center.js`);
  const receta = {
    movementType: 'purchase_receipt',
    binding: { product_id: '30000000-0000-4000-8000-000000000001', id: '40000000-0000-4000-8000-000000000009' },
    quantity: 6,
    direction: 1,
    reason: '',
    salt: 'a1b2c3d4e5f6',
  };
  const claveRecepcion = panelModulo.inventoryOperationKey(receta);
  const claveOtroProducto = panelModulo.inventoryOperationKey({
    ...receta,
    binding: { product_id: '30000000-0000-4000-8000-000000000002', id: receta.binding.id },
  });
  const aleatorias = Array.from({ length: 100 }, () => modulo.randomOperationKey('inventory'));
  return {
    claveRecepcion,
    claveRepetida: panelModulo.inventoryOperationKey({ ...receta }),
    claveOtroProducto,
    claveOtraCantidad: panelModulo.inventoryOperationKey({ ...receta, quantity: 7 }),
    aleatorias,
    patronDelModulo: modulo.IDEMPOTENCY_KEY_PATTERN.source,
  };
}, HOST);

console.log(`       clave de la recepción de 6 unidades: ${resultado.claveRecepcion}`);
medir('la clave de la recepción cumple el contrato del servidor', CONTRATO.test(resultado.claveRecepcion), `${resultado.claveRecepcion.length} caracteres`);
medir('no contiene dos puntos', !resultado.claveRecepcion.includes(':'));
medir('el módulo servido declara el mismo contrato', resultado.patronDelModulo === CONTRATO.source, resultado.patronDelModulo);
medir('el doble click reusa la clave (no duplicaría el movimiento)', resultado.claveRepetida === resultado.claveRecepcion);
medir('otro producto genera otra clave', resultado.claveOtroProducto !== resultado.claveRecepcion);
medir('otra cantidad genera otra clave', resultado.claveOtraCantidad !== resultado.claveRecepcion);
medir('100 claves aleatorias, todas válidas y distintas',
  resultado.aleatorias.every((k) => CONTRATO.test(k)) && new Set(resultado.aleatorias).size === 100);

console.log('\n── no se tocó nada ──');
medir('cero llamadas de escritura durante la verificación', escrituras.length === 0, escrituras.join(' | '));

await browser.close();
writeFileSync('artifacts/taba2-go-live-audit/verificacion-idempotencia-en-vivo.json', `${JSON.stringify(resultado, null, 2)}\n`);
console.log(rojo === 0 ? '\nIDEMPOTENCIA EN VIVO: PASS' : `\nIDEMPOTENCIA EN VIVO: ${rojo} falla(s)`);
process.exit(rojo === 0 ? 0 : 1);
