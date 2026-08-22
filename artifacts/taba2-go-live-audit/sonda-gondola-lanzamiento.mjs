/*
 * Sonda READ-ONLY de la góndola de lanzamiento: qué ve y en qué orden un
 * cliente anónimo en el sitio publicado. No confirma ningún pedido, no
 * registra nada, no escribe en la base.
 *
 * Mide lo que la DB no dice:
 *   · el orden REAL de la grilla del catálogo (los 33, en el orden que se
 *     dibujan) y de cada categoría;
 *   · qué secciones arma la home y con qué productos abre cada una;
 *   · qué productos entran en «Lo más pedido» (el rail de recomendados);
 *   · si el slug del envase se sigue filtrando a la ficha o al carrito.
 */
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const HOST = process.env.TABA_HOST || 'https://la-taba.pages.dev';
const salida = { host: HOST };

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
const page = await context.newPage();
const mutaciones = [];
page.on('request', (r) => {
  if (/\/auth\/v1\/signup|\/rest\/v1\/orders/.test(r.url()) && r.method() === 'POST') mutaciones.push(`${r.method()} ${r.url()}`);
});

await page.goto(`${HOST}/#home`, { waitUntil: 'networkidle', timeout: 90000 });
await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 60000 });
await page.waitForFunction(async () => {
  const { getState } = await import('/js/state.js');
  return getState().products.length > 0;
}, null, { timeout: 30000 });

// ── El catálogo tal como lo entrega el estado del cliente ────────────────────
salida.estado = await page.evaluate(async () => {
  const { getState } = await import('/js/state.js');
  return getState().products.map((p) => ({
    sku: p.sku, name: p.name, categoryId: p.categoryId, categoryName: p.categoryName,
    price: p.price, stock: p.stock, sortOrder: p.sortOrder, popular: p.popular,
    featured: p.featured, image: p.image || '', alcoholic: p.alcoholic, available: p.available,
  }));
});

// ── La home: secciones en el orden en que se pintan ─────────────────────────
salida.home = await page.evaluate(() => {
  const secciones = [];
  for (const bloque of document.querySelectorAll('[data-view="home"] section, [data-view="home"] .home-section')) {
    const titulo = bloque.querySelector('h2, h3, .section-head strong, .section-title')?.textContent?.trim();
    if (!titulo) continue;
    const productos = [...bloque.querySelectorAll('.product-card .product-body h3, .thumb-card h3')]
      .map((n) => n.textContent.trim()).slice(0, 6);
    secciones.push({ titulo, productos, cantidad: bloque.querySelectorAll('.product-card, .thumb-card').length });
  }
  return secciones;
});

// ── La grilla del catálogo, en su orden real ────────────────────────────────
await page.evaluate(() => { window.location.hash = '#catalog'; });
await page.waitForSelector('[data-product-grid] .product-card', { timeout: 30000 });
await page.waitForTimeout(1200);
salida.grilla = await page.$$eval('[data-product-grid] .product-card', (cards) => cards.map((c, i) => ({
  posicion: i + 1,
  nombre: c.querySelector('.product-body h3')?.textContent?.trim() || '',
  linea: c.querySelector('.product-body p')?.textContent?.trim() || '',
  precio: c.querySelector('.price strong')?.textContent?.trim() || '',
})));

// ── Ficha de producto: ¿se filtra el slug del envase? ───────────────────────
// La ficha es un <dialog data-product-modal>: si queda abierto se come los
// clicks siguientes, así que se cierra siempre antes de devolver.
const cerrarModal = () => page.evaluate(() => {
  document.querySelector('dialog[open][data-product-modal]')?.close();
});
const abrirFichaPorNombre = async (patron) => {
  await cerrarModal();
  await page.evaluate(() => { window.location.hash = '#catalog'; });
  await page.waitForSelector('[data-product-grid] .product-card', { timeout: 20000 });
  const tarjeta = page.locator('[data-product-grid] .product-card').filter({ hasText: patron }).first();
  if (await tarjeta.count() === 0) return '';
  await tarjeta.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await tarjeta.locator('[data-product-detail]').first().click();
  await page.waitForTimeout(1500);
  const texto = await page.evaluate(() => {
    const vista = document.querySelector('dialog[open][data-product-modal]');
    return (vista?.innerText || '').replace(/\n{2,}/g, '\n');
  });
  await cerrarModal();
  await page.waitForTimeout(400);
  return texto;
};
const fichaPrimera = await abrirFichaPorNombre(/Coca-Cola/i);
// El pack, que es el que arrastra el `variant` sucio de la base.
const indicePack = salida.grilla.findIndex((c) => /Pack x/i.test(c.linea));
const fichaPack = indicePack >= 0 ? await abrirFichaPorNombre(/Pack x12/i) : '';
salida.fichas = {
  primera: { slugEnvase: /botella-pet|botella_pet/i.test(fichaPrimera), extracto: fichaPrimera.slice(0, 500) },
  pack: { indice: indicePack, slugEnvase: /botella-pet|botella_pet/i.test(fichaPack), crudoVariant: /Botella PET · \d+ ml · Pack/i.test(fichaPack), extracto: fichaPack.slice(0, 500) },
};

// ── Carrito: el mismo texto, del otro lado ──────────────────────────────────
await cerrarModal();
await page.evaluate(() => { window.location.hash = '#catalog'; });
await page.waitForSelector('[data-product-grid] .product-card', { timeout: 20000 });
for (const patron of [/Coca-Cola/i, /Pack x12/i]) {
  const tarjeta = page.locator('[data-product-grid] .product-card').filter({ hasText: patron }).first();
  if (await tarjeta.count() === 0) continue;
  await tarjeta.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await tarjeta.locator('[data-add-product]').first().click().catch(() => {});
  await page.waitForTimeout(600);
}
await page.evaluate(() => { window.location.hash = '#cart'; });
await page.waitForTimeout(2500);
const textoCarrito = await page.evaluate(() => document.querySelector('[data-view="cart"]')?.innerText || '');
salida.carrito = {
  slugEnvase: /botella-pet|botella_pet/i.test(textoCarrito),
  extracto: textoCarrito.slice(0, 700),
};
salida.mutacionesObservadas = mutaciones;

await page.screenshot({ path: 'artifacts/taba2-go-live-audit/lanzamiento-01-carrito.png' });
await page.evaluate(() => { window.location.hash = '#home'; });
await page.waitForTimeout(1500);
await page.screenshot({ path: 'artifacts/taba2-go-live-audit/lanzamiento-02-home.png', fullPage: true });
await browser.close();

writeFileSync('artifacts/taba2-go-live-audit/sonda-gondola-lanzamiento.json', `${JSON.stringify(salida, null, 2)}\n`);
console.log(`productos en estado: ${salida.estado.length} · populares: ${salida.estado.filter((p) => p.popular).length} · destacados: ${salida.estado.filter((p) => p.featured).length}`);
console.log(`secciones home: ${salida.home.map((s) => `${s.titulo}(${s.cantidad})`).join(' · ')}`);
console.log(`grilla: ${salida.grilla.length} tarjetas · primeras 6: ${salida.grilla.slice(0, 6).map((c) => `${c.nombre} ${c.linea}`).join(' | ')}`);
console.log(`ficha pack: slug=${salida.fichas.pack.slugEnvase} variantCrudo=${salida.fichas.pack.crudoVariant}`);
console.log(`carrito: slug=${salida.carrito.slugEnvase}`);
console.log(`mutaciones observadas: ${mutaciones.length}`);
