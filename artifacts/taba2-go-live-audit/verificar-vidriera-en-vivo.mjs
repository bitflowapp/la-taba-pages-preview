/*
 * READ-ONLY contra el sitio publicado: la vidriera curada, el naming comercial
 * en carrito y ficha, y que el checkout siga en pie. Cliente anónimo; no
 * confirma ningún pedido ni registra nada (se mide y se declara).
 */
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const HOST = process.env.TABA_HOST || 'https://la-taba.pages.dev';
const APROBADOS = [
  'Coca-Cola', 'Coca-Cola Zero', 'Sprite', 'Fanta Naranja', 'Pepsi', 'Benedictino',
  'Villavicencio', 'Coca-Cola Original', 'Paso de los Toros Tónica', 'Aquarius Pomelo',
  'Red Bull', 'Speed',
];
const TECNICO = /botella-pet|pack-pet|botella_pet|\b\d{4,} ?ml\b|·\s*\d+\s*ml\s*·\s*[a-z-]+pet/i;

let rojo = 0;
const medir = (nombre, ok, detalle = '') => {
  console.log(`  ${ok ? 'OK  ' : 'MAL '} ${nombre}${detalle ? ` · ${detalle}` : ''}`);
  if (!ok) rojo += 1;
};
const salida = { host: HOST };

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
const page = await context.newPage();
const escrituras = [];
const errores = [];
// PostgREST manda TODA rpc por POST, incluidas las de sólo lectura, así que un
// POST a /rpc/get_… no es una escritura. Se miran las que sí lo serían.
page.on('request', (r) => {
  if (r.method() !== 'POST') return;
  const url = r.url();
  if (/\/rest\/v1\/rpc\/(get_|commerce_|resolve_)/.test(url)) return;
  if (/\/auth\/v1\/signup|\/rest\/v1\/orders|\/rest\/v1\/rpc\/(create|submit|apply|set_|assign|cancel)/.test(url)) escrituras.push(`${r.method()} ${url}`);
});
page.on('pageerror', (e) => errores.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });

await page.goto(`${HOST}/#home`, { waitUntil: 'networkidle', timeout: 90000 });
await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 60000 });
await page.waitForFunction(async () => {
  const { getState } = await import('/js/state.js');
  return getState().products.length > 0;
}, null, { timeout: 30000 });
await page.waitForTimeout(2500);

console.log('\n── catálogo servido ──');
const estado = await page.evaluate(async () => {
  const { getState } = await import('/js/state.js');
  return getState().products.map((p) => ({ sku: p.sku, name: p.name, alcoholic: p.alcoholic, tags: p.tags || [] }));
});
salida.catalogo = estado.length;
medir('el cliente recibe 32 comprables', estado.length === 32, `${estado.length}`);
medir('ningún alcohólico llega al cliente', estado.filter((p) => p.alcoholic).length === 0);
medir('el pack x6 de Fanta ya no se sirve', !estado.some((p) => p.sku === 'fanta-naranja-botella-pet-1500-ml-pack-x6'));

console.log('\n── la vidriera ──');
const seccion = await page.evaluate(() => {
  const bloques = [...document.querySelectorAll('[data-view="home"] section')];
  for (const bloque of bloques) {
    const titulo = bloque.querySelector('h2, h3, .section-head strong')?.textContent?.trim() || '';
    if (!/recomendados|más pedido|destacados/i.test(titulo)) continue;
    const caja = bloque.getBoundingClientRect();
    return {
      titulo,
      top: Math.round(caja.top + window.scrollY),
      // El nombre de cada tarjeta de la vidriera vive en el <strong> de
      // `.home-best-copy`, no en un encabezado.
      productos: [...bloque.querySelectorAll('.home-best-card .home-best-copy strong')].map((n) => n.textContent.trim()).filter(Boolean),
      lineas: [...bloque.querySelectorAll('.home-best-card .home-best-copy small')].map((n) => n.textContent.trim()).filter(Boolean),
    };
  }
  return null;
});
salida.vidriera = seccion;
medir('la primera sección de productos es «Recomendados del local»', seccion?.titulo === 'Recomendados del local', seccion?.titulo || '(no se encontró)');
medir('no dice «Lo más pedido» en ningún lado', !(await page.content()).includes('Lo más pedido'));
const visibles = seccion?.productos || [];
console.log(`       orden servido: ${visibles.join(' > ')}`);
medir('la vidriera sirve las 8 tarjetas del rail', visibles.length === 8, `${visibles.length} tarjetas`);
medir('la vidriera abre con los aprobados, en su orden', visibles.length > 0
  && APROBADOS.slice(0, visibles.length).every((esperado, i) => visibles[i] === esperado),
  visibles.join(' > ') || '(vacía)');
medir('ninguna línea de la vidriera muestra metadata técnica', !(seccion?.lineas || []).some((l) => TECNICO.test(l)),
  (seccion?.lineas || []).slice(0, 3).join(' | '));

console.log('\n── ficha y carrito ──');
await page.evaluate(() => { window.location.hash = '#catalog'; });
await page.waitForSelector('[data-product-grid] .product-card', { timeout: 30000 });
await page.waitForTimeout(1000);
const grilla = await page.$$eval('[data-product-grid] .product-card', (cards) => cards.map((c) => ({
  nombre: c.querySelector('.product-body h3')?.textContent?.trim() || '',
  linea: c.querySelector('.product-body p')?.textContent?.trim() || '',
})));
salida.grilla = grilla;
medir('la grilla sirve 32 tarjetas', grilla.length === 32, `${grilla.length}`);
medir('ninguna tarjeta repite la capacidad ni muestra slugs', !grilla.some((c) => TECNICO.test(c.linea) || /(\b[\d,]+ ?(ml|L)\b).*\1/i.test(c.linea)),
  grilla.slice(0, 2).map((c) => c.linea).join(' | '));

const abrirFicha = async (patron) => {
  await page.evaluate(() => document.querySelector('dialog[open][data-product-modal]')?.close());
  await page.evaluate(() => { window.location.hash = '#catalog'; });
  await page.waitForSelector('[data-product-grid] .product-card', { timeout: 20000 });
  const tarjeta = page.locator('[data-product-grid] .product-card').filter({ hasText: patron }).first();
  await tarjeta.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await tarjeta.locator('[data-product-detail]').first().click();
  await page.waitForTimeout(1200);
  const texto = await page.evaluate(() => (document.querySelector('dialog[open][data-product-modal]')?.innerText || '').replace(/\n{2,}/g, '\n'));
  await page.evaluate(() => document.querySelector('dialog[open][data-product-modal]')?.close());
  await page.waitForTimeout(300);
  return texto;
};
const fichaPack = await abrirFicha(/Pack x12/i);
salida.fichaPack = fichaPack;
console.log(`       ficha del pack:\n${fichaPack.split('\n').slice(0, 5).map((l) => `         ${l}`).join('\n')}`);
medir('la ficha del pack no muestra el slug del envase', !TECNICO.test(fichaPack));
medir('la ficha no repite la ficha técnica como descripción', !/Botella PET · \d+ ml · Pack/i.test(fichaPack));

await page.evaluate(() => { window.location.hash = '#catalog'; });
await page.waitForSelector('[data-product-grid] .product-card', { timeout: 20000 });
for (const patron of [/Coca-Cola/i, /Pack x12/i]) {
  const tarjeta = page.locator('[data-product-grid] .product-card').filter({ hasText: patron }).first();
  await tarjeta.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await tarjeta.locator('[data-add-product]').first().click().catch(() => {});
  await page.waitForTimeout(500);
}
await page.evaluate(() => { window.location.hash = '#cart'; });
await page.waitForTimeout(2500);
const carrito = await page.evaluate(() => document.querySelector('[data-view="cart"]')?.innerText || '');
salida.carrito = carrito;
console.log(`       carrito:\n${carrito.split('\n').slice(0, 8).map((l) => `         ${l}`).join('\n')}`);
medir('el carrito no muestra el slug ni la capacidad cruda', !TECNICO.test(carrito));
medir('el carrito suma y ofrece los dos medios de pago', /Subtotal/i.test(carrito) && /Efectivo al recibir/i.test(carrito) && /coordinar/i.test(carrito));
medir('el checkout sigue pidiendo perfil y dirección antes de confirmar', /Completar Perfil|Agregar dirección/i.test(carrito));

console.log('\n── higiene ──');
// El 401 de la consulta de disponibilidad de Mercado Pago es CONOCIDO y está
// declarado: la RPC está concedida sólo a `authenticated` y el cliente anónimo
// la pregunta igual —cortar esa llamada dejaría sin Mercado Pago a quien
// todavía no tiene sesión—. Se cuenta aparte para no esconderlo ni fabricar un
// verde: se cierra concediendo la RPC a `anon`, que es una migración.
const ruidoConocido = errores.filter((e) => /401/.test(e));
const erroresReales = errores.filter((e) => !/401/.test(e));
salida.consola = { erroresReales, ruidoConocido };
medir('cero errores de consola (fuera del 401 declarado de Mercado Pago)', erroresReales.length === 0, erroresReales.slice(0, 2).join(' | '));
console.log(`       ruido conocido: ${ruidoConocido.length} línea(s) de 401 por la RPC de Mercado Pago`);
medir('cero escrituras disparadas por la visita', escrituras.length === 0, escrituras.join(' | '));

await page.evaluate(() => { window.location.hash = '#home'; });
await page.waitForTimeout(1500);
await page.screenshot({ path: 'artifacts/taba2-go-live-audit/vidriera-curada-home.png', fullPage: true });
await browser.close();
writeFileSync('artifacts/taba2-go-live-audit/verificacion-vidriera-en-vivo.json', `${JSON.stringify(salida, null, 2)}\n`);
console.log(rojo === 0 ? '\nVERIFICACIÓN EN VIVO: PASS' : `\nVERIFICACIÓN EN VIVO: ${rojo} fallas`);
process.exit(rojo === 0 ? 0 : 1);
