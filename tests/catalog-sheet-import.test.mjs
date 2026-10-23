/*
 * IMPORTAR PLANILLA: del archivo al lote (js/business/catalog-sheet-import.js).
 *
 * El plan es puro: filas leídas + catálogo cargado → qué cambia, qué no se
 * aplica y por qué. Aplicar manda lotes de hasta 500 filas y frena en el
 * primero que el servidor rechaza.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readCatalogSheetBytes } from '../js/business/catalog-sheet-reader.js';
import {
  applyCatalogSheetPlan, buildCatalogSheetPlan, CATALOG_BATCH_LIMIT, normalizeSheetText, readMoneyCell, readPublishCell,
  readStockCell,
} from '../js/business/catalog-sheet-import.js';
import { containsForbiddenVocabulary, humanizeFailure } from '../js/business/business-operation-language.js';

const IMAGE = { image_url: 'assets/products/x.webp', catalog_asset_id: 'asset-1' };
const base = { catalog_origin: 'commercial', is_active: true, is_alcoholic: false, merchant_available: false };
const PRODUCTS = [
  { ...base, ...IMAGE, id: 'p1', sku: 'coca-cola-2250ml', name: 'Coca-Cola 2,25 L', price: 1400, price_status: 'confirmed',
    stock: 10, available: false, is_verified: false, unit_cost: 900, compare_at_price: null },
  { ...base, ...IMAGE, id: 'p2', sku: 'agua-glaciar-1500ml', name: 'Agua Glaciar 1,5 L', price: 1000, price_status: 'confirmed',
    stock: 20, available: true, merchant_available: true, is_verified: true, unit_cost: null },
  { ...base, id: 'p3', sku: 'fernet-branca-750ml', name: 'Fernet Branca 750 ml', price: 0, price_status: 'pending',
    stock: null, available: false, is_verified: false, is_alcoholic: true, unit_cost: null, compare_at_price: null },
  { ...base, ...IMAGE, id: 'p4', sku: 'hielo-bolsa-2kg', name: 'Hielo 2 kg', price: 2500, price_status: 'confirmed',
    stock: 8, available: true, merchant_available: true, is_verified: true },
  { ...base, id: 'p5', sku: 'sprite-1500ml', name: 'Sprite 1,5 L', price: 1300, price_status: 'confirmed',
    stock: 6, available: false, is_verified: false },
];
const HEADER = ['SKU', 'Producto', 'Costo (ARS)', 'Precio de venta (ARS)', 'Precio regular antes de la promo (ARS)',
  'Stock actual', '¿Disponible para vender?', 'Observaciones'];

const sheet = (...rows) => [{ number: 1, cells: HEADER }, ...rows.map((cells, index) => ({ number: index + 2, cells }))];
const plan = (rows, options = {}) => buildCatalogSheetPlan(rows, { products: PRODUCTS, pricingAvailable: true, ...options });
const rowOf = (built, sku) => built.rows.find((row) => row.sku === sku);
const fixture = async (name) => {
  const read = await readCatalogSheetBytes(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)), { fileName: name });
  assert.equal(read.ok, true, read.message);
  return read.rows;
};

function assertOperatorCopy(texts) {
  for (const text of texts.filter(Boolean)) {
    assert.deepEqual(containsForbiddenVocabulary(text), [], text);
    assert.equal(humanizeFailure(text, 'FALLBACK'), text.replace(/\s+/g, ' ').trim(), `humanizeFailure lo dejaría pasar: ${text}`);
  }
}

test('la planilla .xlsx de la otra punta se convierte en un plan fila por fila', async () => {
  const built = plan(await fixture('catalog-planilla-productos.xlsx'));
  assert.equal(built.ok, true, built.error);
  assert.equal(built.headerRow, 3, 'el encabezado es la primera fila cuya primera celda dice SKU');
  assert.deepEqual(built.summary, { rows: 6, changes: 4, unchanged: 0, errors: 1, unknown: 1, blocked: 0 });

  const coca = rowOf(built, 'coca-cola-2250ml');
  assert.equal(coca.line, 4);
  assert.equal(coca.status, 'change');
  assert.deepEqual(coca.patch, { sku: 'coca-cola-2250ml', price: '1500', unit_cost: '1000', stock: 12, publish: true });
  assert.deepEqual(coca.changes.map((change) => change.field), ['price', 'cost', 'stock', 'publish']);
  assert.equal(coca.pricing.margin, 1 / 3, 'el plan ya trae el margen que deja el precio nuevo');

  const agua = rowOf(built, 'agua-glaciar-1500ml');
  assert.equal(agua.status, 'error');
  assert.equal(agua.patch, null, 'una fila con un error no se aplica ni en parte');
  assert.deepEqual(agua.errors, ['Stock: «abc» tiene que ser un número entero de unidades, sin puntos ni comas.']);

  const fernet = rowOf(built, 'fernet-branca-750ml');
  assert.deepEqual(fernet.patch, { sku: 'fernet-branca-750ml', price: '9800.50', compare_at_price: '11000' });
  assert.equal(fernet.name, 'Fernet Branca 750 ml');

  const unknown = rowOf(built, 'sku-que-no-existe');
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.patch, null);
  assert.match(unknown.errors[0], /no está en el catálogo del negocio\. La planilla no crea productos/);
  assert.equal(unknown.name, 'Producto desconocido', 'sin producto en el catálogo se muestra el nombre de la planilla');

  const hielo = rowOf(built, 'hielo-bolsa-2kg');
  assert.deepEqual(hielo.patch, { sku: 'hielo-bolsa-2kg', stock: 0, publish: false });

  const sprite = rowOf(built, 'sprite-1500ml');
  assert.deepEqual(sprite.patch, { sku: 'sprite-1500ml', price: '1400' }, 'el booleano Sí no alcanza: falta la foto');
  assert.ok(sprite.notes.includes('No se publica: Falta una imagen aprobada.'));

  assert.deepEqual(built.patches, built.rows.filter((row) => row.patch).map((row) => row.patch));
  assertOperatorCopy(built.rows.flatMap((row) => [...row.errors, ...row.notes, ...row.changes.flatMap((c) => [c.label, c.before, c.after])]));
});

test('el .csv da el mismo plan (todo llega como texto)', async () => {
  const built = plan(await fixture('catalog-planilla-productos.csv'));
  assert.equal(built.ok, true, built.error);
  assert.equal(built.headerRow, 2);
  assert.deepEqual(built.summary, { rows: 5, changes: 3, unchanged: 0, errors: 1, unknown: 1, blocked: 0 });
  assert.deepEqual(rowOf(built, 'coca-cola-2250ml').patch, { sku: 'coca-cola-2250ml', price: '1500', unit_cost: '1000', stock: 12, publish: true });
  assert.deepEqual(rowOf(built, 'fernet-branca-750ml').patch, { sku: 'fernet-branca-750ml', price: '9800.50', compare_at_price: '11000' });
  assert.equal(rowOf(built, 'agua-glaciar-1500ml').status, 'error');
});

test('encabezados: sin acentos, sin mayúsculas y las demás columnas se ignoran', () => {
  const built = buildCatalogSheetPlan([
    { number: 1, cells: ['Planilla'] },
    { number: 2, cells: [null, 'sku', 'PRECIO DE VENTA (ars)', 'Margen calculado', 'disponible para vender', 'costo (ARS)', 'stock actual'] },
    { number: 3, cells: [null, 'coca-cola-2250ml', 1450, 0.35, 'no', '950', 10] },
  ], { products: PRODUCTS, pricingAvailable: true });
  assert.equal(built.ok, true, built.error);
  assert.deepEqual(built.columns, ['cost', 'price', 'stock', 'publish']);
  assert.deepEqual(rowOf(built, 'coca-cola-2250ml').patch, { sku: 'coca-cola-2250ml', price: '1450', unit_cost: '950' },
    'stock igual y «No» sobre algo que no estaba publicado no son cambios');
  assert.equal(normalizeSheetText('¿Disponible para vender?'), 'disponible para vender');
  assert.equal(normalizeSheetText('Precio regular antes de la promo (ARS)'), 'precio regular antes de la promo ars');
});

test('la planilla entera se rechaza si no hay encabezado, hay columnas repetidas o nada para cambiar', () => {
  assert.match(plan([{ number: 1, cells: ['Producto', 'Precio'] }]).error, /fila que empiece con «SKU»/);
  assert.match(plan([{ number: 1, cells: ['SKU', 'Costo (ARS)', 'costo'] }]).error, /aparece dos veces/);
  assert.match(plan([{ number: 1, cells: ['SKU', 'Producto', 'Observaciones'] }]).error, /no tiene columnas para cambiar/);
  const many = [{ number: 1, cells: ['SKU', 'Stock actual'] }];
  for (let index = 0; index < 2001; index += 1) many.push({ number: index + 2, cells: [`otro-${index}`, 1] });
  assert.match(plan(many).error, /2001 filas de productos y el tope es 2000/);
  assert.deepEqual(plan(many).patches, []);
});

test('celda vacía = no cambia nada; una fila sólo con SKU queda «sin cambios»', () => {
  const built = plan(sheet(['agua-glaciar-1500ml', 'Agua', null, null, null, null, null, 'nada que hacer'], [null, 'Sólo una nota']));
  assert.equal(built.summary.rows, 1, 'una fila sin SKU ni valores para cambiar se ignora');
  const agua = rowOf(built, 'agua-glaciar-1500ml');
  assert.equal(agua.status, 'unchanged');
  assert.equal(agua.patch, null);
  assert.deepEqual(built.patches, []);
});

test('SKU: falta, repetido, con pinta de prueba o numérico', () => {
  const built = plan(sheet(
    [null, 'Sin SKU', null, 1500],
    ['coca-cola-2250ml', 'Coca', null, 1500],
    ['coca-cola-2250ml', 'Coca otra vez', null, 1600],
    ['agua-test-1l', 'Agua', null, 900],
    [7790895000997, 'Con código', null, 100],
    [12.5, 'Raro', null, 100],
  ));
  assert.match(built.rows[0].errors[0], /Falta el SKU/);
  assert.match(rowOf(built, 'coca-cola-2250ml').errors[0], /más de una fila \(filas 3, 4\)/);
  assert.equal(built.rows.filter((row) => row.sku === 'coca-cola-2250ml').every((row) => row.status === 'error'), true,
    'las dos filas repetidas quedan afuera: no se sabe cuál vale');
  assert.match(rowOf(built, 'agua-test-1l').errors[0], /parece de prueba/);
  assert.equal(rowOf(built, '7790895000997').status, 'unknown', 'un código numérico se busca como texto');
  assert.match(built.rows[5].errors[0], /escribilo como texto/);
  assert.deepEqual(built.patches, []);
});

test('importes: celdas numéricas tal cual, texto con la regla de separadores', () => {
  assert.deepEqual(readMoneyCell(1500.1), { cents: 150010, rounded: false });
  assert.deepEqual(readMoneyCell(1234.567), { cents: 123457, rounded: true });
  assert.deepEqual(readMoneyCell('1.234,50'), { cents: 123450, rounded: false });
  assert.match(readMoneyCell('1.234').error, /ambiguo/);
  assert.match(readMoneyCell('0').error, /mayor que cero/);
  assert.deepEqual(readMoneyCell('0', { allowZero: true }), { cents: 0, rounded: false });
  assert.deepEqual(readMoneyCell(0, { allowZero: true }), { cents: 0, rounded: false });
  assert.match(readMoneyCell(-5).error, /negativo/);
  assert.match(readMoneyCell(true).error, /Sí\/No/);
  assert.match(readMoneyCell({ error: '#N/A' }).error, /error de fórmula \(#N\/A\)/);
  assert.deepEqual(readMoneyCell('quitar', { clearable: true }), { clear: true });
  assert.deepEqual(readMoneyCell('-', { clearable: true }), { clear: true });
  assert.deepEqual(readMoneyCell('Sin promo', { clearable: true }), { clear: true });
  assert.match(readMoneyCell('quitar').error, /no es un importe/, 'el precio de venta no se borra');
  const built = plan(sheet(['sprite-1500ml', null, null, '1.234'], ['hielo-bolsa-2kg', null, null, 1234.567]));
  assert.match(rowOf(built, 'sprite-1500ml').errors[0], /^Precio de venta: «1\.234» es ambiguo/);
  assert.ok(rowOf(built, 'hielo-bolsa-2kg').notes.some((note) => /se redondeó a \$\s1\.234,57/.test(note)));
});

test('stock: entero de cero o más; publicar: Sí o No', () => {
  assert.deepEqual(readStockCell(12), { value: 12 });
  assert.deepEqual(readStockCell('0'), { value: 0 });
  assert.match(readStockCell(12.5).error, /entero/);
  assert.match(readStockCell('-1').error, /negativo/);
  assert.match(readStockCell('1.000').error, /sin puntos ni comas/);
  assert.deepEqual(readStockCell(null), { empty: true });
  for (const yes of ['Sí', 'SI', 'si', 'x', 'true', 1, true]) assert.deepEqual(readPublishCell(yes), { value: true }, String(yes));
  for (const no of ['No', 'NO', 'n', 0, false]) assert.deepEqual(readPublishCell(no), { value: false }, String(no));
  assert.match(readPublishCell('quizás').error, /Escribí Sí o No/);
  assert.deepEqual(readPublishCell('  '), { empty: true });
});

test('publicar: deciden las compuertas, y la vista previa dice por qué no', () => {
  const built = plan(sheet(
    ['coca-cola-2250ml', null, null, null, null, 0, 'Sí'],
    ['fernet-branca-750ml', null, null, 9000, null, 5, 'Sí'],
    ['sprite-1500ml', null, null, null, null, null, 'Sí'],
    ['agua-glaciar-1500ml', null, null, null, null, null, 'Sí'],
  ));
  const coca = rowOf(built, 'coca-cola-2250ml');
  assert.deepEqual(coca.patch, { sku: 'coca-cola-2250ml', stock: 0 });
  assert.ok(coca.notes.includes('No se publica: El producto está agotado.'));
  const fernet = rowOf(built, 'fernet-branca-750ml');
  assert.equal(fernet.patch.publish, undefined);
  assert.ok(fernet.notes.includes('No se publica: Falta una imagen aprobada.'));
  const sprite = rowOf(built, 'sprite-1500ml');
  assert.equal(sprite.status, 'blocked', 'sólo pedía publicar y no se puede');
  assert.equal(sprite.patch, null);
  assert.equal(rowOf(built, 'agua-glaciar-1500ml').status, 'unchanged', 'ya publicado: Sí no cambia nada');
  const alcohol = buildCatalogSheetPlan(sheet(['fernet-branca-750ml', null, null, 9000, null, 5, 'Sí']), {
    products: PRODUCTS.map((product) => (product.sku === 'fernet-branca-750ml' ? { ...product, ...IMAGE } : product)),
    pricingAvailable: true,
  });
  assert.ok(rowOf(alcohol, 'fernet-branca-750ml').notes.includes('No se publica: La venta de alcohol requiere habilitación comercial.'));
  const licensed = buildCatalogSheetPlan(sheet(['fernet-branca-750ml', null, null, 9000, null, 5, 'Sí']), {
    products: PRODUCTS.map((product) => (product.sku === 'fernet-branca-750ml' ? { ...product, ...IMAGE } : product)),
    pricingAvailable: true, alcoholEnabled: true,
  });
  assert.equal(rowOf(licensed, 'fernet-branca-750ml').patch.publish, true);
});

test('ocultar y avisos sobre lo publicado', () => {
  const products = PRODUCTS.map((product) => (product.sku === 'coca-cola-2250ml' ? { ...product, merchant_available: true } : product));
  const built = buildCatalogSheetPlan(sheet(
    ['coca-cola-2250ml', null, null, null, null, null, 'No'],
    ['agua-glaciar-1500ml', null, null, 1100, null, 0],
    ['hielo-bolsa-2kg', null, null, null, null, 0],
  ), { products, pricingAvailable: true });
  assert.deepEqual(rowOf(built, 'coca-cola-2250ml').patch, { sku: 'coca-cola-2250ml', publish: false },
    'la intención encendida de un producto sin stock también se apaga');
  assert.ok(rowOf(built, 'agua-glaciar-1500ml').notes.includes('Puede dejar de estar publicado: queda sin stock.'));
  assert.ok(rowOf(built, 'hielo-bolsa-2kg').notes.some((note) => /Con stock 0 deja de estar disponible/.test(note)));
});

test('precio regular: tiene que quedar por encima del precio de venta', () => {
  const withPromo = PRODUCTS.map((product) => (product.sku === 'hielo-bolsa-2kg' ? { ...product, compare_at_price: 3000, unit_cost: 1500 } : product));
  const built = buildCatalogSheetPlan(sheet(
    ['coca-cola-2250ml', null, null, null, 1400],
    ['hielo-bolsa-2kg', null, null, 3200],
    ['agua-glaciar-1500ml', null, null, null, 1300],
  ), { products: withPromo, pricingAvailable: true });
  assert.match(rowOf(built, 'coca-cola-2250ml').errors[0], /Precio regular: tiene que ser mayor que el precio de venta \(\$\s1\.400\)/);
  assert.match(rowOf(built, 'hielo-bolsa-2kg').errors[0], /no es menor que el precio regular guardado .*escribí «quitar»/);
  const agua = rowOf(built, 'agua-glaciar-1500ml');
  assert.deepEqual(agua.patch, { sku: 'agua-glaciar-1500ml', compare_at_price: '1300' });
  assert.match(agua.pricing.labels.promo, /Antes \$\s1\.300 · 23,08 % menos/);

  const ended = buildCatalogSheetPlan(sheet(['hielo-bolsa-2kg', null, 'quitar', 3200, 'quitar'], ['agua-glaciar-1500ml', null, '-', null, '-']),
    { products: withPromo, pricingAvailable: true });
  assert.deepEqual(rowOf(ended, 'hielo-bolsa-2kg').patch, { sku: 'hielo-bolsa-2kg', price: '3200', unit_cost: null, compare_at_price: null });
  assert.equal(rowOf(ended, 'agua-glaciar-1500ml').status, 'unchanged', 'borrar lo que no había no es un cambio');
});

test('precio menor al costo: se avisa, no se bloquea', () => {
  const built = plan(sheet(['coca-cola-2250ml', null, 1000, 800]));
  const coca = rowOf(built, 'coca-cola-2250ml');
  assert.equal(coca.status, 'change');
  assert.ok(coca.notes.some((note) => /^Precio menor al costo: perdés \$\s200 por unidad\.$/.test(note)));
});

test('sin lectura de costos, las columnas de costo y promo no viajan', () => {
  const built = plan(sheet(['coca-cola-2250ml', null, 1000, 1500, 2000]), { pricingAvailable: false });
  assert.deepEqual(rowOf(built, 'coca-cola-2250ml').patch, { sku: 'coca-cola-2250ml', price: '1500' });
  assert.ok(built.notices[0].startsWith('El Panel todavía no puede guardar costos'));
  assert.equal(rowOf(built, 'coca-cola-2250ml').pricing, null);
  const limited = plan(sheet(['coca-cola-2250ml', null, null, 1500]), { catalogLimitReached: true });
  assert.ok(limited.notices.some((notice) => /primeros productos del catálogo/.test(notice)));
  assertOperatorCopy([...built.notices, ...limited.notices, ...built.rows.flatMap((row) => row.notes)]);
});

// ── Aplicar ──────────────────────────────────────────────────────────────────

function bigCatalog(count) {
  const products = [];
  const rows = [{ number: 1, cells: ['SKU', 'Stock actual'] }];
  for (let index = 0; index < count; index += 1) {
    products.push({ ...base, id: `p${index}`, sku: `producto-${index}`, name: `Producto ${index}`, price: 100, price_status: 'confirmed', stock: 1, available: false, is_verified: false });
    rows.push({ number: index + 2, cells: [`producto-${index}`, 5] });
  }
  return { products, rows };
}

test('aplicar: lotes de hasta 500, una llamada por lote', async () => {
  const { products, rows } = bigCatalog(1200);
  const built = buildCatalogSheetPlan(rows, { products, pricingAvailable: true });
  assert.equal(built.patches.length, 1200);
  const calls = [];
  const outcome = await applyCatalogSheetPlan(built, {
    products,
    save: async (batch) => {
      calls.push(batch.length);
      return { ok: true, data: batch.map((row) => ({ applied_sku: row.sku, applied_available: false })) };
    },
  });
  assert.equal(CATALOG_BATCH_LIMIT, 500);
  assert.deepEqual(calls, [500, 500, 200]);
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.summary, { applied: 1200, failed: 0, skipped: 0, calls: 3 });
  assert.equal(outcome.message, '1200 cambios aplicados.');
});

test('aplicar: el primer lote rechazado frena los siguientes y dice cuál fila lo frenó', async () => {
  const { products, rows } = bigCatalog(1200);
  const built = buildCatalogSheetPlan(rows, { products, pricingAvailable: true });
  let call = 0;
  const outcome = await applyCatalogSheetPlan(built, {
    products,
    save: async (batch) => {
      call += 1;
      if (call === 2) return { ok: false, code: 'P0001', message: 'Refusing to publish sku producto-700 without stock.', friendly: 'producto-700: no se puede publicar sin stock. No se guardó ningún cambio del lote.', sku: 'producto-700' };
      return { ok: true, data: batch.map((row) => ({ applied_sku: row.sku, applied_available: false })) };
    },
  });
  assert.equal(call, 2, 'el tercer lote no se intenta');
  assert.deepEqual(outcome.summary, { applied: 500, failed: 500, skipped: 200, calls: 2 });
  assert.equal(outcome.ok, false);
  assert.match(outcome.message, /^Se aplicaron 500 de 1200 cambios\. El resto no se aplicó: producto-700: no se puede publicar sin stock/);
  const byLine = new Map(outcome.rows.map((row) => [row.sku, row.result]));
  assert.equal(byLine.get('producto-700').message, 'producto-700: no se puede publicar sin stock. No se guardó ningún cambio del lote.');
  assert.match(byLine.get('producto-600').message, /rechazó el bloque entero/);
  assert.match(byLine.get('producto-1100').message, /No se intentó/);
  assert.equal(byLine.get('producto-1').status, 'applied');
  assertOperatorCopy(outcome.rows.map((row) => row.result?.message));
});

test('aplicar: lo que contesta el servidor se cuenta fila por fila', async () => {
  const built = plan(sheet(
    ['coca-cola-2250ml', null, null, 1500, null, 12, 'Sí'],
    ['hielo-bolsa-2kg', null, null, null, null, 0, 'No'],
    ['agua-glaciar-1500ml', null, null, 1100],
    ['sku-que-no-existe', null, null, 100],
  ));
  const outcome = await applyCatalogSheetPlan(built, {
    products: PRODUCTS,
    save: async () => ({ ok: true, data: [
      { applied_sku: 'coca-cola-2250ml', applied_available: false, applied_republished: false },
      { applied_sku: 'hielo-bolsa-2kg', applied_available: false, applied_republished: false },
      { applied_sku: 'agua-glaciar-1500ml', applied_available: true, applied_republished: true },
    ] }),
  });
  const result = (sku) => outcome.rows.find((row) => row.sku === sku).result;
  assert.equal(result('coca-cola-2250ml').message, 'Guardado. Quedó sin publicar: el servidor no lo habilitó.');
  assert.equal(result('hielo-bolsa-2kg').message, 'Guardado. Oculto de la tienda.');
  assert.equal(result('agua-glaciar-1500ml').message, 'Guardado. Sigue publicado con el precio nuevo.');
  assert.equal(result('sku-que-no-existe'), null, 'lo que no viajó no tiene resultado');
  assert.equal(outcome.publishedChanged, true);
});

test('aplicar: una excepción o un plan vacío no mienten', async () => {
  const built = plan(sheet(['coca-cola-2250ml', null, null, 1500]));
  const broken = await applyCatalogSheetPlan(built, { products: PRODUCTS, save: async () => { throw new Error('socket hang up'); } });
  assert.equal(broken.ok, false);
  assert.match(broken.message, /^No se aplicó ningún cambio\. No hubo respuesta del servidor/);
  assert.doesNotMatch(broken.message, /socket/);
  const empty = await applyCatalogSheetPlan(plan(sheet(['agua-glaciar-1500ml'])), { save: async () => assert.fail('no tiene que llamar') });
  assert.equal(empty.ok, false);
  assert.equal(empty.message, 'No había cambios para aplicar.');
  const raw = await applyCatalogSheetPlan(built, { products: PRODUCTS, save: async () => ({ ok: false, message: 'permission denied for function apply_commercial_catalog_batch' }) });
  assert.doesNotMatch(raw.message, /permission|function/, 'sin frase amigable, el texto crudo del motor no llega a la pantalla');
});
