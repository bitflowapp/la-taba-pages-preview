/*
 * Los ocho invariantes de la candidata comercial, verificados juntos.
 *
 * POR QUÉ EXISTE
 * --------------
 * Las tres declaraciones que componen esta candidata se certificaron por
 * separado y cada una probó lo suyo. Lo que ninguna probó es que conviven: que
 * el contrato de precio no rompió la UX pulida, que el importador no aflojó la
 * ubicación obligatoria, que la góndola sigue ordenando como quedó.
 *
 * Esto no reemplaza a las suites. Es la lista corta de lo que NO puede fallar
 * después de juntarlas, escrita como ocho preguntas concretas y verificada
 * contra los módulos reales —no contra una copia del contrato—.
 *
 *   node scripts/verify-commercial-candidate.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK  ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const {
  isPricePending, confirmedPrice, isStockPending, knownStock, isCommerciallyPurchasable,
  PRICE_PENDING_TITLE,
} = await import('../js/core/pricing.js');
const { isProductOrderable } = await import('../js/core/catalog-store.js');
const { productPriceLabel, productPricePresentation } = await import('../js/ui.js');
const { resolveCombo } = await import('../js/core/combos.js');
const { OPERATING_AREA } = await import('../js/core/business-location.js');
const {
  requireConfirmedDeliveryLocation, hasConfirmedDeliveryLocation, DELIVERY_LOCATION_REQUIRED,
} = await import('../js/core/delivery-location.js');
const { buildCommercialPlan, readCatalogIndex } = await import('./import-commercial-catalog.mjs');

const producto = (extra = {}) => ({
  id: 'p', sku: 'p', name: 'P', price: 3900, priceStatus: 'confirmed',
  pricePending: false, stock: 5, available: true, ...extra,
});

// ── 1. un precio pendiente nunca se escribe como $ 0 ─────────────────────────
{
  const variantes = [
    producto({ pricePending: true }),
    producto({ priceStatus: 'pending' }),
    producto({ price: 0 }),
    producto({ price: null }),
    producto({ price: '' }),
    producto({ priceStatus: 'confirmed', pricePending: false, price: 0 }),
  ];
  const escapes = variantes.filter((p) => /\$\s*0\b/.test(productPriceLabel(p)));
  check('1 · ningún precio pendiente se escribe como $ 0', escapes.length === 0,
    escapes.length ? `${escapes.length} variantes escaparon` : `${variantes.length} variantes, todas dicen «${PRICE_PENDING_TITLE}»`);
  check('1b · y la presentación lo declara siempre',
    variantes.every((p) => productPricePresentation(p).pricePending === true));
  check('1c · confirmedPrice devuelve null, nunca cero por ausencia',
    variantes.every((p) => confirmedPrice(p) === null));
}

// ── 2. el orden no prioriza pendientes ───────────────────────────────────────
{
  const ui = read('js/ui.js');
  const pendientesAlFinal = /function recommendedScore\(product\) \{\s*\n\s*if \(product\.pricePending\) return -1;/.test(ui)
    && /function popularScore\(product\) \{\s*\n\s*if \(product\.pricePending\) return -1;/.test(ui);
  check('2 · recomendados y populares mandan los pendientes al final', pendientesAlFinal);
  const precioAsc = /if \(leftPrice == null\) return 0;/.test(ui)
    && /if \(\(leftPrice == null\) !== \(rightPrice == null\)\) return leftPrice == null \? 1 : -1;/.test(ui);
  check('2b · «precio menor a mayor» no confunde ausencia con barato', precioAsc);
}

// ── 3. un combo sin descuento real no se promociona ──────────────────────────
{
  const base = [{ id: 'a', sku: 'a', price: 1000, stock: 10, available: true, name: 'A' }];
  const sinDescuento = resolveCombo({ comboId: 'c0', discountPercentage: 0, components: [{ sku: 'a', quantity: 2 }] }, base);
  const conDescuento = resolveCombo({ comboId: 'c1', discountPercentage: 10, components: [{ sku: 'a', quantity: 2 }] }, base);
  check('3 · un combo que no ahorra no declara ahorro',
    sinDescuento.hasRealSaving === false && sinDescuento.savings === 0, `savings=${sinDescuento.savings}`);
  check('3b · y uno que sí ahorra lo declara', conDescuento.hasRealSaving === true, `savings=${conDescuento.savings}`);
  const ui = read('js/ui.js');
  check('3c · la tarjeta sólo dibuja el ahorro si existe',
    /combo\.hasRealSaving \? `<span class="combo-save-badge">/.test(ui));
  const roto = resolveCombo({ comboId: 'c2', discountPercentage: 15, components: [{ sku: 'a', quantity: 1 }] },
    [{ id: 'a', sku: 'a', price: 0, stock: 10, available: true, name: 'A' }]);
  check('3d · un componente sin precio no deja anunciar ningún número',
    roto.individualPrice === null && roto.promotionalPrice === null && roto.chargeable === false);
}

// ── 4. cambiar el precio no publica ni despublica mal ────────────────────────
{
  const batch = read('supabase/migrations/20260809070000_commercial_batch_price_status.sql');
  check('4 · cargar un precio lo confirma', /when v_price is not null then 'confirmed'/.test(batch));
  check('4b · un valor omitido preserva el estado', /else v_product\.price_status/.test(batch));
  check('4c · publicar exige estado confirmado', /Refusing to publish sku % without a confirmed price state/.test(batch));
  check('4d · la republicación exige TODAS las compuertas',
    /if applied_price_status = 'confirmed'\s*\n\s*and applied_price > 0\s*\n\s*and coalesce\(applied_stock, 0\) > 0\s*\n\s*and v_product\.is_active\s*\n\s*and v_asset_ok then/.test(batch));
  check('4e · y nada queda disponible sin precio confirmado',
    /and v_next_price_status = 'confirmed'\s*\n\s*and coalesce\(v_next_price, 0\) > 0,/.test(batch));
}

// ── 5. stock 0 impide comprar; y null no es 0 ────────────────────────────────
{
  check('5 · stock 0 no se puede comprar', isCommerciallyPurchasable(producto({ stock: 0 })) === false);
  check('5b · stock desconocido tampoco', isCommerciallyPurchasable(producto({ stock: null })) === false);
  check('5c · y son estados distintos',
    isStockPending(producto({ stock: null })) === true
    && isStockPending(producto({ stock: 0 })) === false
    && knownStock(producto({ stock: 0 })) === 0);
  check('5d · la compuerta del carrito usa el contrato completo',
    isProductOrderable(producto({ stock: 0 })) === false
    && isProductOrderable(producto({ price: 0 })) === false
    && isProductOrderable(producto()) === true);
  const contrato = read('supabase/migrations/20260809060000_commercial_price_and_stock_contract.sql');
  check('5e · y la tabla lo impone del lado del servidor',
    /and stock is not null\s*\n\s*and stock > 0/.test(contrato)
    && /and price_status = 'confirmed'\s*\n\s*and price > 0/.test(contrato));
}

// ── 6. la ubicación confirmada sigue siendo obligatoria ──────────────────────
{
  const sinPunto = requireConfirmedDeliveryLocation({ fulfillmentType: 'delivery', address: {} });
  check('6 · un delivery sin punto confirmado se rechaza',
    sinPunto.ok === false && sinPunto.code === DELIVERY_LOCATION_REQUIRED, sinPunto.code || '');
  const conPunto = {
    street: 'Antártida Argentina', streetNumber: '1450', city: OPERATING_AREA.city,
    province: OPERATING_AREA.province, latitude: -38.9539, longitude: -68.0596,
    locationSource: 'gps', locationConfirmedAt: '2026-08-09T00:00:00.000Z',
  };
  check('6b · con punto confirmado avanza',
    requireConfirmedDeliveryLocation({ fulfillmentType: 'delivery', address: conPunto }).ok === true);
  check('6c · editar la calle invalida la confirmación',
    hasConfirmedDeliveryLocation({
      ...conPunto,
      locationConfirmedAddress: 'otra calle 1 neuquen capital neuquen',
    }) === false);
  check('6d · retiro en local no exige punto',
    requireConfirmedDeliveryLocation({ fulfillmentType: 'pickup', address: {} }).ok === true);
}

// ── 7. ciudad y provincia no volvieron a la UX ───────────────────────────────
{
  const perfil = read('js/customer-profile-view.js');
  check('7 · el formulario no pide ciudad ni provincia',
    !/name="profileAddressCity"/.test(perfil) && !/name="profileAddressProvince"/.test(perfil));
  check('7b · ni código postal', !/name="profileAddressPostalCode"/.test(perfil));
  check('7c · pero el dato sigue viajando desde el área de operación',
    /OPERATING_AREA\.city/.test(perfil) && /OPERATING_AREA\.province/.test(perfil));
  check('7d · con valores canónicos declarados',
    OPERATING_AREA.city === 'Neuquén Capital' && OPERATING_AREA.province === 'Neuquén',
    `${OPERATING_AREA.city} · ${OPERATING_AREA.province}`);
}

// ── 8. los productos de QA no vuelven a la góndola ───────────────────────────
{
  const catalogo = readCatalogIndex(read('catalog/products.csv'));
  const sospechosos = [...catalogo.keys()].filter((sku) => /(-staging-only$)|(^qa[-_])|(\bqa\b)|(\b(test|prueba|dummy|fixture)\b)/i.test(sku));
  check('8 · el catálogo committeado no tiene un solo SKU de prueba',
    sospechosos.length === 0, sospechosos.join(', ') || `${catalogo.size} SKU revisados`);
  const plan = buildCommercialPlan(
    'sku,precio,stock,publicar\nbebida-qa-sintetica-STAGING-ONLY,400,10,si',
    { catalog: catalogo },
  );
  check('8b · y el importador los rechaza con su motivo',
    plan.errors.length === 1 && /producto de prueba/.test(plan.errors[0]), plan.errors[0] || '');
  const batch = read('supabase/migrations/20260809070000_commercial_batch_price_status.sql');
  check('8c · el servidor impone la misma guarda',
    /Refusing a QA-looking sku in the commercial catalog/.test(batch));
}

console.log('');
const fallidos = results.filter((entry) => !entry.ok);
console.log(`${results.length - fallidos.length}/${results.length} OK`);
if (fallidos.length) {
  for (const entry of fallidos) console.log(`  - ${entry.name}: ${entry.detail}`);
  process.exitCode = 1;
}
