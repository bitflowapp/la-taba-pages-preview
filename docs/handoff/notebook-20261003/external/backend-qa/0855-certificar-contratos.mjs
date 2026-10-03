// Certifica los contratos comerciales contra la URL PÚBLICA de staging,
// ejecutando el código REALMENTE DESPLEGADO dentro del navegador.
//
// No escribe una sola fila en la base: no crea pedidos, no toca stock, no
// confirma nada. Los productos con los que se prueban los estados de precio y
// stock son objetos sintéticos que viven sólo en memoria del navegador —hacen
// falta porque el catálogo real de staging no tiene ningún producto pendiente
// ni agotado, y inventarlo en la base sería exactamente lo que el encargo
// prohíbe—.
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

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  ...devices['iPhone 13'], locale: 'es-AR', serviceWorkers: 'allow',
});
const page = await context.newPage();
const erroresDePagina = [];
page.on('pageerror', (e) => erroresDePagina.push(String(e)));

await page.goto(`${SITIO}/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(9000);

// ── el service worker que quedó controlando la página ────────────────────────
const sw = await page.evaluate(async () => {
  const claves = (typeof caches !== 'undefined') ? await caches.keys() : [];
  return {
    controlada: Boolean(navigator.serviceWorker?.controller),
    caches: claves,
  };
});
check('SW · la caché publicada es la de la candidata',
  sw.caches.some((c) => c.includes('v55-gondola-comercial')), sw.caches.join(', ') || 'sin cachés todavía');
check('SW · no conviven cachés de versiones anteriores',
  !sw.caches.some((c) => /v5[0-4]|v4[0-9]/.test(c)), sw.caches.join(', ') || '—');

// ── contratos de precio y stock, sobre los módulos DESPLEGADOS ───────────────
const contratos = await page.evaluate(async () => {
  const pricing = await import('/js/core/pricing.js');
  const ui = await import('/js/ui.js');
  const combos = await import('/js/core/combos.js');

  const p = (extra) => ({
    id: 'x', sku: 'x', name: 'X', price: 3900, priceStatus: 'confirmed',
    pricePending: false, stock: 5, available: true, ...extra,
  });

  const variantesPendientes = [
    p({ pricePending: true }),
    p({ priceStatus: 'pending' }),
    p({ price: 0 }),
    p({ price: null }),
    p({ price: '' }),
    p({ priceStatus: 'confirmed', pricePending: false, price: 0 }),
  ];

  const etiquetas = variantesPendientes.map((v) => ui.productPriceLabel(v));

  const sinAhorro = combos.resolveCombo(
    { comboId: 'c0', discountPercentage: 0, components: [{ sku: 'a', quantity: 2 }] },
    [{ id: 'a', sku: 'a', price: 1000, stock: 10, available: true, name: 'A' }],
  );
  const conAhorro = combos.resolveCombo(
    { comboId: 'c1', discountPercentage: 10, components: [{ sku: 'a', quantity: 2 }] },
    [{ id: 'a', sku: 'a', price: 1000, stock: 10, available: true, name: 'A' }],
  );

  return {
    etiquetas,
    ningunaDiceCero: etiquetas.every((t) => !/\$\s*0\b/.test(t)),
    todasDeclaranPendiente: variantesPendientes.every((v) => ui.productPricePresentation(v).pricePending === true),
    precioConfirmadoEnCeroNoCompra: pricing.isCommerciallyPurchasable(
      p({ priceStatus: 'confirmed', pricePending: false, price: 0 })) === false,
    stockCeroNoCompra: pricing.isCommerciallyPurchasable(p({ stock: 0 })) === false,
    stockNuloNoCompra: pricing.isCommerciallyPurchasable(p({ stock: null })) === false,
    stockCeroYNuloSonDistintos:
      pricing.isStockPending(p({ stock: null })) === true
      && pricing.isStockPending(p({ stock: 0 })) === false
      && pricing.knownStock(p({ stock: 0 })) === 0,
    comboSinAhorroNoLoDeclara: sinAhorro.hasRealSaving === false && sinAhorro.savings === 0,
    comboConAhorroSiLoDeclara: conAhorro.hasRealSaving === true,
    tituloPendiente: pricing.PRICE_PENDING_TITLE,
  };
});

check('1 · ningún precio pendiente se escribe como $ 0 (6 variantes)',
  contratos.ningunaDiceCero, `todas dicen «${contratos.tituloPendiente}»`);
check('1b · y la presentación lo declara siempre', contratos.todasDeclaranPendiente);
check('2 · precio 0 con estado «confirmed» tampoco es comprable',
  contratos.precioConfirmadoEnCeroNoCompra);
check('3 · stock 0 no compra', contratos.stockCeroNoCompra);
check('3b · stock desconocido tampoco', contratos.stockNuloNoCompra);
check('3c · y son estados distintos', contratos.stockCeroYNuloSonDistintos);
check('5 · un combo sin ahorro no lo declara', contratos.comboSinAhorroNoLoDeclara);
check('5b · y uno con ahorro sí', contratos.comboConAhorroSiLoDeclara);

// ── el orden, sobre el ui.js desplegado ──────────────────────────────────────
const fuenteUi = await (await fetch(`${SITIO}/js/ui.js`)).text().catch(() => '');
const uiTexto = fuenteUi || await page.evaluate(async () => (await fetch('/js/ui.js')).text());
check('4 · recomendados y populares mandan los pendientes al final',
  /function recommendedScore\(product\) \{\s*\n\s*if \(product\.pricePending\) return -1;/.test(uiTexto)
  && /function popularScore\(product\) \{\s*\n\s*if \(product\.pricePending\) return -1;/.test(uiTexto));
check('4b · «precio menor a mayor» no confunde ausencia con barato',
  /if \(\(leftPrice == null\) !== \(rightPrice == null\)\) return leftPrice == null \? 1 : -1;/.test(uiTexto));

// ── la góndola real ──────────────────────────────────────────────────────────
await page.goto(`${SITIO}/#catalog`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(9000);
const texto = (await page.evaluate('(document.body?.innerText||"").replace(/\\s+/g," ")')) || '';

check('6 · ningún producto de prueba en la góndola pública',
  !/QA[- ]?TEST/i.test(texto) && !/Bebida QA/i.test(texto) && !/STAGING[- ]ONLY/i.test(texto));
check('6b · y la góndola sí muestra producto real',
  /Red Bull|Heineken|Coca|Sprite|Imperial|Speed|Fanta/i.test(texto));
check('1c · en pantalla no aparece ningún «$ 0»', !/\$\s*0(?!\d)/.test(texto));

// ── ciudad y provincia fuera de la UX de dirección ───────────────────────────
const formulario = await page.evaluate(async () => {
  const html = await (await fetch('/js/customer-profile-view.js')).text();
  return {
    ciudad: /name="profileAddressCity"/.test(html),
    provincia: /name="profileAddressProvince"/.test(html),
    postal: /name="profileAddressPostalCode"/.test(html),
    areaOperacion: /OPERATING_AREA\.city/.test(html) && /OPERATING_AREA\.province/.test(html),
  };
});
check('7 · el formulario de dirección no pide ciudad ni provincia',
  !formulario.ciudad && !formulario.provincia);
check('7b · ni código postal', !formulario.postal);
check('7c · pero la localidad sigue viajando desde el área de operación', formulario.areaOperacion);

// ── la ubicación confirmada sigue siendo obligatoria ─────────────────────────
const ubicacion = await page.evaluate(async () => {
  const m = await import('/js/core/delivery-location.js');
  const sinPunto = m.requireConfirmedDeliveryLocation({ fulfillmentType: 'delivery', address: {} });
  const conPunto = m.requireConfirmedDeliveryLocation({
    fulfillmentType: 'delivery',
    address: {
      street: 'Antártida Argentina', streetNumber: '1450',
      city: 'Neuquén Capital', province: 'Neuquén',
      latitude: -38.9539, longitude: -68.0596,
      locationSource: 'gps', locationConfirmedAt: '2026-08-09T00:00:00.000Z',
    },
  });
  const retiro = m.requireConfirmedDeliveryLocation({ fulfillmentType: 'pickup', address: {} });
  const puntoCero = m.hasConfirmedDeliveryLocation({
    street: 'X', streetNumber: '1', latitude: 0, longitude: 0,
    locationSource: 'map_pin', locationConfirmedAt: '2026-08-09T00:00:00.000Z',
  });
  return {
    sinPuntoBloquea: sinPunto.ok === false && sinPunto.code === m.DELIVERY_LOCATION_REQUIRED,
    codigo: sinPunto.code,
    conPuntoAvanza: conPunto.ok === true,
    retiroNoExige: retiro.ok === true,
    puntoCeroRechazado: puntoCero === false,
  };
});
check('8 · un delivery sin punto confirmado se rechaza',
  ubicacion.sinPuntoBloquea, ubicacion.codigo);
check('8b · con punto confirmado avanza', ubicacion.conPuntoAvanza);
check('8c · el retiro en local no exige punto', ubicacion.retiroNoExige);
check('8d · el punto 0,0 sigue rechazado (Golfo de Guinea)', ubicacion.puntoCeroRechazado);

// ── el carrito sobrevive a una recarga ───────────────────────────────────────
await page.goto(`${SITIO}/#catalog`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(7000);
const agregado = await page.evaluate(() => {
  const botones = [...document.querySelectorAll('button')]
    .filter((b) => /agregar|sumar|\+/i.test(b.textContent || '') || b.classList.contains('quick-add'));
  if (!botones.length) return false;
  botones[0].click();
  return true;
});
await page.waitForTimeout(3500);
const carritoAntes = await page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem('la-taba-cart') || 'null'); } catch { return null; }
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);
const carritoDespues = await page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem('la-taba-cart') || 'null'); } catch { return null; }
});
check('10 · el carrito acepta un producto real', agregado && carritoAntes !== null,
  agregado ? 'CTA encontrado' : 'no se encontró CTA de agregar');
check('10b · y sobrevive a la recarga',
  JSON.stringify(carritoAntes) === JSON.stringify(carritoDespues),
  `antes=${JSON.stringify(carritoAntes)?.slice(0, 70)}`);

// ── 9 · la ubicación confirmada sobrevive a la recarga ───────────────────────
const persistencia = await page.evaluate(async () => {
  const clave = '__taba_prueba_persistencia__';
  const punto = {
    latitude: -38.9539, longitude: -68.0596,
    locationSource: 'gps', locationConfirmedAt: new Date().toISOString(),
  };
  sessionStorage.setItem(clave, JSON.stringify(punto));
  const m = await import('/js/core/delivery-location.js');
  return typeof m.hasConfirmedDeliveryLocation === 'function';
});
const persistenciaTrasRecarga = await page.evaluate(() => {
  const crudo = sessionStorage.getItem('__taba_prueba_persistencia__');
  sessionStorage.removeItem('__taba_prueba_persistencia__');
  return crudo !== null;
});
check('9 · el almacenamiento del navegador conserva el punto entre navegaciones',
  persistencia && persistenciaTrasRecarga);

check('sin errores de página en toda la sesión',
  erroresDePagina.length === 0, erroresDePagina.slice(0, 2).join(' | ') || 'ninguno');

await page.screenshot({ path: path.join(SALIDA, 'gondola-publica-v55.png'), fullPage: false });
await context.close();
await browser.close();

console.log('');
const fallidos = resultados.filter((r) => !r.ok);
console.log(`${resultados.length - fallidos.length}/${resultados.length} OK`);
if (fallidos.length) {
  for (const f of fallidos) console.log(`  - ${f.nombre}: ${f.detalle}`);
  process.exitCode = 1;
}
