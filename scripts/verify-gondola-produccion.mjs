/*
 * La góndola de Neuquén, medida en el sitio PUBLICADO con un navegador real.
 *
 * `verify-production-storefront.mjs` mide que la tienda venda y que ninguna foto
 * de tercero siga alcanzable. Esto mide lo otro: que el surtido nuevo esté
 * completo, bien categorizado, que el alcohol se vea y NO se pueda comprar, que
 * el carrito funcione y que los pedidos sigan habilitados.
 *
 * No stubbea nada: habla con producción tal como la ve un cliente.
 */
import { chromium } from 'playwright';

/*
 * QUÉ VE EL CLIENTE, Y POR QUÉ NO SON LOS 56.
 *
 * La base tiene 56 productos: 4 previos + 52 nuevos. El cliente descarga 33.
 * No es un error: `loadCatalog()` consulta con `.eq('available', true)`, así que
 * un producto no disponible NO se descarga. Para el catálogo del cliente,
 * «visible» y «comprable» son la misma bandera.
 *
 * Esa es la consecuencia medida del LICENSE GATE: los 23 con alcohol quedan
 * cargados, verificados y en su categoría correcta —listos para el día que la
 * habilitación se acredite— y el cliente no los ve. No hay un estado intermedio
 * «se ve y no se compra» en esta superficie, y fabricarlo sería otro cambio de
 * producto, con su propio cartel explicando por qué no se puede comprar.
 *
 * El total de 56 se mide del lado del servidor, con
 * `aplicar-gondola-neuquen.mjs --verificar`, no desde el navegador.
 */
const HOST = process.env.TABA_HOST || 'https://la-taba.pages.dev';
const ESPERADO_COMPRABLES = 33;
// Con la compuerta cerrada el cliente no recibe ninguno con alcohol.
const ESPERADO_ALCOHOL_VISIBLE = 0;

let rojo = 0;
const medir = (nombre, ok, detalle = '') => {
  console.log(`  ${ok ? 'OK  ' : 'MAL '} ${nombre}${detalle ? ` · ${detalle}` : ''}`);
  if (!ok) rojo += 1;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const fallidas = [];
const errores = [];
page.on('requestfailed', (r) => fallidas.push(r.url()));
page.on('response', (r) => { if (r.status() >= 400) errores.push(`${r.status()} ${r.url()}`); });
page.on('pageerror', (e) => errores.push(`pageerror ${e.message}`));

await page.goto(`${HOST}/#home`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(async () => {
  const { getState } = await import('/js/state.js');
  return getState().products.length > 0;
}, null, { timeout: 30000 });

const catalogo = await page.evaluate(async () => {
  const { getState } = await import('/js/state.js');
  return getState().products.map((p) => ({
    sku: p.sku,
    name: p.name,
    categoryId: p.categoryId,
    categoryName: p.categoryName,
    price: p.price,
    available: p.available,
    alcoholic: p.alcoholic,
    minimumAge: p.minimumAge,
    unitsPerPack: p.unitsPerPack,
    procurementOnly: p.procurementOnly === true,
  }));
});

// ── 1 · el surtido comprable llegó entero ────────────────────────────────────
const comprables = catalogo.filter((p) => p.available);
const conAlcohol = catalogo.filter((p) => p.alcoholic);
medir('el cliente recibe los 33 comprables', catalogo.length === ESPERADO_COMPRABLES, `${catalogo.length}`);
medir('los 33 que recibe son todos comprables', comprables.length === catalogo.length, `${comprables.length}`);

// ── 2 · LICENSE GATE · el alcohol no llega ni se compra ──────────────────────
medir('la compuerta del alcohol está cerrada: no llega ninguno',
  conAlcohol.length === ESPERADO_ALCOHOL_VISIBLE, `${conAlcohol.length}`);
medir('ningún producto sin alcohol arrastra edad mínima',
  catalogo.every((p) => p.minimumAge === null));

// ── 3 · categorías bien puestas ──────────────────────────────────────────────
const huerfanas = catalogo.filter((p) => p.categoryName === p.categoryId);
medir('ninguna categoría queda con el slug crudo de nombre', huerfanas.length === 0,
  [...new Set(huerfanas.map((p) => p.categoryId))].join(', '));
const categorias = [...new Set(catalogo.map((p) => p.categoryName))].sort();
medir('están los seis estantes sin alcohol del surtido', categorias.length === 6, categorias.join(' · '));
for (const necesaria of ['Gaseosas', 'Aguas', 'Aguas saborizadas', 'Isotónicas', 'Energizantes', 'Mixers']) {
  medir(`existe el estante «${necesaria}»`, categorias.includes(necesaria));
}
for (const frenada of ['Cervezas', 'Fernet y amargos', 'Vinos', 'Destilados', 'Aperitivos']) {
  medir(`«${frenada}» NO se publica mientras la compuerta esté cerrada`, !categorias.includes(frenada));
}

// ── 4 · la home dibuja productos, que era el defecto ─────────────────────────
await page.waitForTimeout(1500);
const secciones = await page.evaluate(() => [...document.querySelectorAll('[data-home-sections] .home-category-section')]
  .map((s) => ({ titulo: s.querySelector('h2')?.textContent || '', tarjetas: s.querySelectorAll('.home-best-sellers > *').length })));
medir('la home dibuja carruseles con producto', secciones.length > 0 && secciones.every((s) => s.tarjetas > 0),
  secciones.map((s) => `${s.titulo}:${s.tarjetas}`).join(' · '));
const masPedido = await page.locator('[data-view="home"]').innerText();
medir('la home nombra productos reales', /Coca-Cola|Red Bull|Speed|Villa del Sur/.test(masPedido));

// ── 5 · combos: no se ofrece lo que no se puede cobrar ───────────────────────
const combos = await page.evaluate(async () => {
  const { customerCombos } = await import('/js/ui.js');
  return customerCombos().length;
});
const mercadoPago = await page.evaluate(() => Boolean(document.querySelector('option[value="mercadopago"]')));
medir('Mercado Pago sigue sin configurarse', mercadoPago === false);
medir('no se ofrece ningún combo que el checkout vaya a rechazar', combos === 0, `${combos}`);

// ── 6 · el catálogo y el carrito ─────────────────────────────────────────────
await page.goto(`${HOST}/#catalog`, { waitUntil: 'networkidle' });
await page.locator('[data-product-grid] .product-card').first().waitFor({ timeout: 30000 });
const tarjetas = await page.locator('[data-product-grid] .product-card').count();
medir('la grilla dibuja los 33 comprables', tarjetas === ESPERADO_COMPRABLES, `${tarjetas}`);
const textoCatalogo = await page.locator('[data-view="catalog"]').innerText();
medir('el pack se distingue de la unidad suelta', textoCatalogo.includes('Pack x6') || textoCatalogo.includes('Pack x12'));
medir('no aparece «Precio próximamente»', !textoCatalogo.includes('Precio próximamente'));

const primerComprable = comprables.find((p) => !p.alcoholic);
await page.evaluate(async (sku) => {
  const { getState } = await import('/js/state.js');
  const { addToCart } = await import('/js/cart.js');
  const producto = getState().products.find((p) => p.sku === sku);
  addToCart(producto.id, 2);
}, primerComprable.sku);
const carrito = await page.evaluate(async () => {
  const { getState } = await import('/js/state.js');
  return getState().cart.map((i) => `${i.productId}:${i.quantity}`);
});
medir('agregar al carrito funciona', carrito.length === 1 && carrito[0].endsWith(':2'), carrito.join(', '));

await page.goto(`${HOST}/#cart`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const lineas = await page.locator('[data-cart-list] .cart-item').count();
medir('el carrito muestra la línea', lineas === 1, `${lineas}`);

// ── 7 · el negocio sigue abierto ─────────────────────────────────────────────
await page.goto(`${HOST}/#home`, { waitUntil: 'networkidle' });
const portada = await page.locator('body').innerText();
medir('los pedidos siguen habilitados', portada.includes('Pedidos online habilitados'),
  portada.includes('no disponibles') ? 'dice NO disponibles' : '');

// ── 8 · higiene ──────────────────────────────────────────────────────────────
const erroresReales = errores.filter((e) => !/favicon/i.test(e));
medir('sin respuestas de error ni excepciones', erroresReales.length === 0, erroresReales.slice(0, 3).join(' | '));
medir('sin pedidos de red fallidos', fallidas.length === 0, fallidas.slice(0, 3).join(' | '));
const rotas = await page.evaluate(() => [...document.querySelectorAll('img')]
  .filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.currentSrc || i.src));
medir('ninguna imagen rota', rotas.length === 0, rotas.slice(0, 3).join(' '));

// ── 9 · evidencia para revisión humana ───────────────────────────────────────
// Recorre la página antes de capturar: con `fullPage` lo que todavía no entró
// al viewport sale en negro, y una evidencia que miente es peor que ninguna.
const despertar = async () => page.evaluate(async () => {
  const paso = window.innerHeight;
  for (let y = 0; y < document.body.scrollHeight; y += paso) {
    window.scrollTo(0, y);
    await new Promise((listo) => setTimeout(listo, 120));
  }
  window.scrollTo(0, 0);
  await new Promise((listo) => setTimeout(listo, 250));
});
const destino = 'artifacts/taba2-gondola-neuquen';
await despertar();
await page.screenshot({ path: `${destino}/vivo-01-home.png`, fullPage: true });
await page.goto(`${HOST}/#catalog`, { waitUntil: 'networkidle' });
await page.locator('[data-product-grid] .product-card').first().waitFor();
await despertar();
await page.screenshot({ path: `${destino}/vivo-02-catalogo.png`, fullPage: true });

await browser.close();
console.log('');
console.log(`capturas del sitio publicado en ${destino}/vivo-*.png`);
console.log(rojo === 0 ? 'GÓNDOLA PRODUCTIVA: VERDE' : `GÓNDOLA PRODUCTIVA: ${rojo} EN ROJO`);
process.exit(rojo === 0 ? 0 : 1);
