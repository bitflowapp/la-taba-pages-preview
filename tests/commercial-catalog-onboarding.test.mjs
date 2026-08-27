import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  buildCommercialPlan,
  looksLikeQaSku,
  normalizeStoredPrice,
  parseCommercialImportArgs,
  parseSheetPrice,
  parseSheetPublish,
  parseSheetStock,
  readCatalogIndex,
} from '../scripts/import-commercial-catalog.mjs';
import { buildReadiness, usablePrice, usableStock } from '../scripts/catalog-readiness.mjs';
import { buildSheet, DECISION_COLUMNS, productLabel, SHEET_COLUMNS } from '../scripts/catalog-commercial-sheet.mjs';
import { resolveCombo } from '../js/core/combos.js';

const root = path.resolve(import.meta.dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

// Catálogo de prueba mínimo: dos productos reales de góndola y un pack de
// abastecimiento. No se toca el catálogo del repositorio.
const CATALOG_CSV = [
  'sku,brand,name,variant,presentation,category_id,price,age_restricted,image_master,image_thumbnail,publication_status',
  'heineken-lata-473ml,Heineken,Heineken,Original,Lata · 473 ml,cervezas,3900,true,assets/x/master.webp,assets/x/thumb.webp,published',
  'coca-cola-pet-1500ml,Coca-Cola,Coca-Cola Original,Original,Botella · 1,5 L,gaseosas,,false,assets/y/master.webp,assets/y/thumb.webp,',
  'coca-cola-pet-1500ml-pack-6,Coca-Cola,Coca-Cola Original,Original,Pack x6,gaseosas,17100,false,assets/z/master.webp,assets/z/thumb.webp,',
].join('\n');

const catalog = () => readCatalogIndex(CATALOG_CSV);
const sheet = (rows) => ['sku,precio,stock,publicar', ...rows].join('\n');
const plan = (rows, options = {}) => buildCommercialPlan(sheet(rows), {
  catalog: catalog(),
  imageExists: () => true,
  ...options,
});

// ─── PELIGRO 1 · un precio ausente convertido en cero ────────────────────────
//
// `Number('')` es 0 y `Number(null)` es 0. Cualquier conversión ingenua lee
// «todavía no lo decidí» como «vale cero pesos», y un cero pasa cualquier
// validación de «es un número». Es el peligro que más caro sale: un producto a
// $0 se vende gratis y nadie lo nota hasta el arqueo.

test('un precio vacío no es cero: no cambia nada y jamás llega como número', () => {
  assert.deepEqual(parseSheetPrice(''), { empty: true });
  assert.deepEqual(parseSheetPrice('   '), { empty: true });
  assert.deepEqual(parseSheetPrice(null), { empty: true });
  assert.deepEqual(parseSheetPrice(undefined), { empty: true });

  const result = plan(['heineken-lata-473ml,,10,']);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].after.price, 3900, 'el precio guardado se conserva');
  assert.equal(result.rows[0].changes.includes('precio'), false);
});

test('un precio cero se rechaza en vez de aceptarse como número válido', () => {
  assert.match(parseSheetPrice('0').error, /mayor a cero/);
  assert.match(parseSheetPrice('0.00').error, /mayor a cero/);
  const result = plan(['heineken-lata-473ml,0,10,']);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /mayor a cero/);
  assert.deepEqual(result.rows, [], 'falla cerrado: no queda ninguna fila aplicable');
});

test('un precio guardado vacío se lee como ausente, no como cero', () => {
  assert.equal(normalizeStoredPrice(''), null);
  assert.equal(normalizeStoredPrice(null), null);
  assert.equal(normalizeStoredPrice('0'), null);
  assert.equal(normalizeStoredPrice('3900'), 3900);
  assert.equal(usablePrice(''), null);
  assert.equal(usablePrice('0'), null);
});

test('lo que un Excel en español produce sin avisar se rechaza con su motivo', () => {
  assert.match(parseSheetPrice('3.900,50').error, /sin puntos de mil/);
  assert.match(parseSheetPrice('$ 3900').error, /sin puntos de mil/);
  assert.match(parseSheetPrice('3900,5').error, /sin puntos de mil/);
  assert.match(parseSheetPrice('3.9e3').error, /científica/);
  assert.match(parseSheetPrice('3900.555').error, /dos decimales/);
  assert.match(parseSheetPrice('-100').error, /sólo dígitos/);
});

// ─── PELIGRO 2 · publicación accidental ──────────────────────────────────────
//
// Publicar nunca puede ser un efecto secundario de cargar un precio. Y publicar
// algo que no se puede comprar es peor que no publicarlo: ocupa la góndola y
// frustra a quien lo toca.

test('publicar vacío no publica ni despublica', () => {
  assert.deepEqual(parseSheetPublish(''), { empty: true });
  const result = plan(['coca-cola-pet-1500ml,1200,5,']);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].after.published, false);
  assert.equal(result.rows[0].changes.includes('publicacion'), false);
});

test('cargar precio y stock no publica solo', () => {
  const result = plan(['coca-cola-pet-1500ml,1200,5,']);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].after.published, false, 'sigue oculto hasta que alguien diga que sí');
});

test('publicar sin precio, sin stock o sin foto se bloquea con el motivo', () => {
  const sinPrecio = plan(['coca-cola-pet-1500ml,,5,si']);
  assert.match(sinPrecio.errors[0], /no se puede publicar sin precio/);

  const sinStock = plan(['coca-cola-pet-1500ml,1200,,si']);
  assert.match(sinStock.errors[0], /no se puede publicar sin stock/);

  const sinFoto = plan(['coca-cola-pet-1500ml,1200,5,si'], { imageExists: () => false });
  assert.match(sinFoto.errors[0], /no se puede publicar sin foto/);
});

test('publicar con stock 0 se bloquea: sería un producto visible que nadie puede comprar', () => {
  const result = plan(['coca-cola-pet-1500ml,1200,0,si']);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /stock 0/);
});

test('un valor raro en publicar no se interpreta: se rechaza', () => {
  for (const value of ['tal vez', 'maybe', 'SI!', '2', 'sí no']) {
    const result = plan([`coca-cola-pet-1500ml,1200,5,${value}`]);
    assert.equal(result.errors.length, 1, `«${value}» tendría que bloquear`);
    assert.match(result.errors[0], /escribí «si» o «no»/);
  }
  assert.deepEqual(parseSheetPublish('si'), { value: true });
  assert.deepEqual(parseSheetPublish('sí'), { value: true });
  assert.deepEqual(parseSheetPublish('no'), { value: false });
});

// ─── PELIGRO 3 · promoción sin descuento real ────────────────────────────────

test('un combo que no ahorra un peso no se presenta como promoción', () => {
  const products = [
    { id: 'a', sku: 'a', price: 1000, stock: 10, available: true, name: 'A' },
  ];
  const sinDescuento = resolveCombo(
    { comboId: 'c0', discountPercentage: 0, components: [{ sku: 'a', quantity: 2 }] },
    products,
  );
  assert.equal(sinDescuento.savings, 0);
  assert.equal(sinDescuento.hasRealSaving, false, 'no puede anunciar «Ahorrás $ 0»');

  const conDescuento = resolveCombo(
    { comboId: 'c1', discountPercentage: 10, components: [{ sku: 'a', quantity: 2 }] },
    products,
  );
  assert.ok(conDescuento.savings > 0);
  assert.equal(conDescuento.hasRealSaving, true);
});

test('un combo con un componente sin precio no anuncia precio ni ahorro', () => {
  const combo = resolveCombo(
    { comboId: 'c2', discountPercentage: 15, components: [{ sku: 'a', quantity: 1 }] },
    [{ id: 'a', sku: 'a', price: 0, pricePending: true, stock: 10, available: true, name: 'A' }],
  );
  assert.equal(combo.promotionalPrice, null);
  assert.equal(combo.individualPrice, null);
  assert.equal(combo.savings, null);
  assert.equal(combo.hasRealSaving, false);
  assert.equal(combo.available, false);
  assert.ok(combo.blockers.length, 'y explica por qué');
});

test('la tarjeta de combo sólo dibuja el ahorro cuando el ahorro existe', () => {
  const ui = read('js/ui.js');
  assert.match(ui, /combo\.hasRealSaving \? `<span class="combo-save-badge">/);
});

// ─── PELIGRO 4 · stock corrupto ──────────────────────────────────────────────

test('el stock acepta cero y enteros, y nada más', () => {
  assert.deepEqual(parseSheetStock('0'), { value: 0 });
  assert.deepEqual(parseSheetStock('24'), { value: 24 });
  assert.deepEqual(parseSheetStock(''), { empty: true });
  assert.match(parseSheetStock('-1').error, /negativo/);
  assert.match(parseSheetStock('2.5').error, /entero/);
  assert.match(parseSheetStock('2,5').error, /entero/);
  assert.match(parseSheetStock('1e3').error, /científica/);
  assert.match(parseSheetStock('muchas').error, /dígitos/);
  assert.match(parseSheetStock('99999999999').error, /rango/);
  assert.equal(usableStock(''), null, 'vacío no es cero');
  assert.equal(usableStock('0'), 0);
});

test('un stock inválido bloquea la importación entera, no sólo su fila', () => {
  const result = plan([
    'heineken-lata-473ml,3900,10,',
    'coca-cola-pet-1500ml,1200,-3,',
  ]);
  assert.equal(result.errors.length, 1);
  assert.deepEqual(result.rows, [], 'la fila buena tampoco se aplica');
});

// ─── PELIGRO 5 · un SKU de QA visible ────────────────────────────────────────

test('un SKU con pinta de fixture nunca entra al catálogo comercial', () => {
  for (const sku of [
    'bebida-qa-sintetica-STAGING-ONLY',
    'qa-test-iphone',
    'QA_bebida',
    'producto-de-prueba',
    'coca-cola-dummy',
    'fixture-gaseosa',
  ]) {
    assert.equal(looksLikeQaSku(sku), true, `${sku} tendría que detectarse`);
    const result = buildCommercialPlan(sheet([`${sku},400,10,si`]), { catalog: catalog() });
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /producto de prueba/);
  }
});

test('un producto real no se confunde con un fixture', () => {
  for (const sku of ['heineken-lata-473ml', 'coca-cola-pet-1500ml', 'fernet-branca-750ml']) {
    assert.equal(looksLikeQaSku(sku), false, `${sku} es un producto real`);
  }
});

test('la migración impone la misma guarda del lado del servidor', () => {
  const migration = read('supabase/migrations/20260809050000_commercial_catalog_price_and_stock_batch.sql');
  assert.match(migration, /Refusing a QA-looking sku/);
  assert.match(migration, /Unknown sku .* Commercial import never creates products/);
  assert.match(migration, /must be greater than zero/);
  assert.match(migration, /Refusing to publish sku % without a price/);
  assert.match(migration, /Refusing to publish sku % without stock/);
  assert.match(migration, /Refusing to publish sku % without matching approved asset/);
});

// ─── Bloqueos que pide el encargo ────────────────────────────────────────────

test('un SKU desconocido bloquea y dice que por acá no se dan de alta', () => {
  const result = plan(['no-existe-en-el-catalogo,1000,5,']);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /no existe en el catálogo/);
});

test('un SKU duplicado bloquea y nombra las dos líneas', () => {
  const result = plan([
    'heineken-lata-473ml,3900,10,',
    'heineken-lata-473ml,4100,12,',
  ]);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /ya aparece en la línea 2/);
});

test('un pack de abastecimiento no se puede cargar como producto de góndola', () => {
  const result = plan(['coca-cola-pet-1500ml-pack-6,17100,5,si']);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /pack de abastecimiento/);
});

test('los productos que la planilla no menciona no entran al plan', () => {
  const result = plan(['heineken-lata-473ml,4100,10,']);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows.map((row) => row.sku), ['heineken-lata-473ml']);
  assert.equal(result.summary.untouchedCatalogSkus, 2, 'los otros dos quedan afuera del payload');
});

test('el reporte de cambios distingue lo que cambia de lo que no', () => {
  const result = plan([
    'heineken-lata-473ml,3900,,',
    'coca-cola-pet-1500ml,1200,5,',
  ]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.summary.changed, 1);
  assert.equal(result.summary.unchanged, 1);
  assert.equal(result.summary.priceChanges, 1);
  const heineken = result.rows.find((row) => row.sku === 'heineken-lata-473ml');
  assert.deepEqual(heineken.changes, [], 'mismo precio, sin stock ni publicación: no cambia nada');
});

test('una planilla sin las columnas obligatorias no llega a evaluarse', () => {
  const result = buildCommercialPlan('sku,precio\nheineken-lata-473ml,3900', { catalog: catalog() });
  assert.ok(result.errors.some((error) => /stock/.test(error)));
  assert.ok(result.errors.some((error) => /publicar/.test(error)));
});

test('aplicar exige decir a dónde', () => {
  assert.throws(() => parseCommercialImportArgs(['planilla.csv', '--apply']), /--apply exige --target/);
  // `catalogo` se sumó cuando el importador aprendió a validar contra
  // producción; el default sigue siendo el histórico para no cambiarle el
  // significado a ninguna invocación que ya existiera.
  assert.deepEqual(
    parseCommercialImportArgs(['planilla.csv']),
    { file: 'planilla.csv', mode: 'dry-run', target: '', catalogo: 'repo' },
  );
  assert.deepEqual(
    parseCommercialImportArgs(['planilla.csv', '--apply', '--target', 'local']),
    { file: 'planilla.csv', mode: 'apply', target: 'local', catalogo: 'repo' },
  );
});

// ─── La planilla del negocio ─────────────────────────────────────────────────

test('la planilla no expone un solo campo técnico', () => {
  const prohibidos = [
    'external_id', 'capacity_value', 'capacity_unit', 'package_type', 'units_per_pack',
    'sort_order', 'image_path', 'tags', 'subcategory', 'minimum_age', 'chilled', 'featured',
    'business_id', 'is_verified', 'catalog_asset_id',
  ];
  for (const column of prohibidos) {
    assert.equal(SHEET_COLUMNS.includes(column), false, `${column} no puede estar en la planilla`);
  }
  assert.deepEqual([...DECISION_COLUMNS], ['precio', 'stock', 'publicar', 'notas']);
});

test('la planilla committeada está al día con el catálogo', () => {
  const report = buildReadiness({
    productsCsv: read('catalog/products.csv'),
    combosCsv: read('data/combos.csv'),
    imageExists: (candidate) => fs.existsSync(path.join(root, candidate)),
  });
  assert.equal(read('catalog/planilla-negocio.csv'), buildSheet(report));
});

test('la planilla distingue dos variantes del mismo envase', () => {
  const conGas = productLabel({
    brand: 'Glaciar', name: 'Glaciar', variant: 'Con gas, baja en sodio', presentation: 'Botella PET · 1,5 L',
  });
  const sinGas = productLabel({
    brand: 'Glaciar', name: 'Glaciar', variant: 'Sin gas, baja en sodio', presentation: 'Botella PET · 1,5 L',
  });
  assert.notEqual(conGas, sinGas);
  assert.match(conGas, /Con gas/);
});

test('el reporte de readiness committeado está al día', () => {
  const report = buildReadiness({
    productsCsv: read('catalog/products.csv'),
    combosCsv: read('data/combos.csv'),
    imageExists: (candidate) => fs.existsSync(path.join(root, candidate)),
  });
  assert.ok(report.gondolaCount > 0);
  assert.equal(
    report.gondolaCount,
    report.entries.filter((entry) => !entry.procurementOnly).length,
  );
  // El invariante que importa: nada se cuenta como listo sin las tres patas.
  for (const entry of report.entries) {
    if (entry.bucket !== 'listo_para_publicar') continue;
    assert.ok(entry.price !== null, `${entry.sku} listo sin precio`);
    assert.ok(entry.stock !== null, `${entry.sku} listo sin stock`);
    assert.ok(entry.hasImageFile, `${entry.sku} listo sin foto`);
  }
});

// ─── PELIGRO · validar contra un catálogo que NO es el que está vendiendo ────
/*
 * Medido el 2026-08-27 contra la tienda publicada: 72 SKU en producción, 92 en
 * `catalog/products.csv`, SIETE en común, y de esos siete los siete precios
 * difieren. Con el CSV como fuente, una planilla con SKU reales se rechaza
 * entera: se probó con ocho productos vivos y salieron los ocho como «el SKU no
 * existe en el catálogo».
 *
 * Fallar cerrado estaba bien; medir contra la fuente equivocada, no.
 */
test('el catálogo de producción entra al planificador con la forma que ya esperaba', async () => {
  const { filaAEntradaDeCatalogo, tieneImagen } = await import('../scripts/comercial/catalogo-de-produccion.mjs');

  const publicado = filaAEntradaDeCatalogo({
    sku: 'coca-cola-pet-1500ml', name: 'Coca-Cola', category: 'gaseosas',
    price: '4990.00', price_status: 'confirmed', stock: 12, available: true,
    is_alcoholic: false, image_url: 'https://x/foto.webp',
  });
  assert.equal(publicado.publication_status, 'published');
  assert.equal(publicado.price, '4990.00');
  assert.equal(publicado.stock, 12);
  assert.equal(tieneImagen(publicado), true);

  // Un precio PENDIENTE no llega como número: si llegara, el diff diría que ya
  // valía algo y el aumento parecería más chico de lo que es.
  const pendiente = filaAEntradaDeCatalogo({
    sku: 'x', name: 'X', price: '0.00', price_status: 'pending', stock: 0, available: false,
  });
  assert.equal(pendiente.price, '');
  assert.equal(pendiente.publication_status, 'hidden');
  assert.equal(tieneImagen(pendiente), false);
});

test('el stock guardado distingue «no lo sé» de «cero»', async () => {
  const { normalizeStoredStock } = await import('../scripts/import-commercial-catalog.mjs');
  assert.equal(normalizeStoredStock(undefined), null, 'ausente es no sé, nunca cero');
  assert.equal(normalizeStoredStock(''), null);
  assert.equal(normalizeStoredStock(null), null);
  assert.equal(normalizeStoredStock(0), 0, 'cero cargado a mano SÍ es cero');
  assert.equal(normalizeStoredStock(12), 12);
  assert.equal(normalizeStoredStock(-3), null, 'un negativo no es un stock');
  assert.equal(normalizeStoredStock('2.5'), null, 'las unidades son enteras');
});

test('con el catálogo de producción el diff de stock deja de ser siempre «— → N»', () => {
  const catalogoVivo = new Map([['coca-cola-pet-1500ml', {
    sku: 'coca-cola-pet-1500ml', name: 'Coca-Cola', category_id: 'gaseosas',
    price: '4990.00', stock: 12, publication_status: 'published', is_alcoholic: false,
  }]]);
  const resultado = buildCommercialPlan(sheet(['coca-cola-pet-1500ml,4990.00,18,si']), {
    catalog: catalogoVivo, imageExists: () => true,
  });
  assert.deepEqual(resultado.errors, []);
  assert.equal(resultado.rows[0].before.stock, 12, 'el antes sale de producción, no es null');
  assert.equal(resultado.rows[0].after.stock, 18);
  assert.deepEqual(resultado.rows[0].changes, ['stock']);
});

// ─── PELIGRO · publicar alcohol desde una planilla ───────────────────────────
/*
 * Publicar una bebida alcohólica no es cargar un dato: es afirmar que el local
 * tiene la habilitación de expendio acreditada. El importador no tenía ninguna
 * regla al respecto, así que una planilla con `publicar=si` en un SKU alcohólico
 * lo habría publicado.
 */
test('una planilla NO puede habilitar alcohol, y el intento frena el lote entero', () => {
  const conAlcohol = new Map([
    ['gin-lata-473ml', {
      sku: 'gin-lata-473ml', name: 'Gin tonic', category_id: 'listos',
      price: '2200.00', stock: 10, publication_status: 'hidden', is_alcoholic: true,
    }],
    ['agua-500ml', {
      sku: 'agua-500ml', name: 'Agua', category_id: 'aguas',
      price: '1500.00', stock: 10, publication_status: 'hidden', is_alcoholic: false,
    }],
  ]);
  const cerrado = buildCommercialPlan(
    sheet(['agua-500ml,1500.00,10,si', 'gin-lata-473ml,2200.00,10,si']),
    { catalog: conAlcohol, imageExists: () => true, alcoholHabilitado: false },
  );
  assert.equal(cerrado.errors.length, 1);
  assert.match(cerrado.errors[0], /bebida alcohólica y la venta de alcohol está cerrada/);
  // Y no se aplica NADA: el agua, que estaba perfecta, tampoco entra.
  assert.deepEqual(cerrado.rows, [], 'un lote con alcohol rechazado no se aplica a medias');

  // Con la habilitación puesta por una persona, la misma planilla pasa.
  const abierto = buildCommercialPlan(
    sheet(['gin-lata-473ml,2200.00,10,si']),
    { catalog: conAlcohol, imageExists: () => true, alcoholHabilitado: true },
  );
  assert.deepEqual(abierto.errors, []);

  // Y el alcohol que NO se pide publicar no molesta: cambiarle el precio a algo
  // que sigue oculto es una corrección de datos, no una habilitación.
  const soloPrecio = buildCommercialPlan(
    sheet(['gin-lata-473ml,2500.00,10,no']),
    { catalog: conAlcohol, imageExists: () => true, alcoholHabilitado: false },
  );
  assert.deepEqual(soloPrecio.errors, []);
  assert.equal(soloPrecio.rows[0].after.published, false);
});

test('el plan dice si un producto se vuelve comprable, que es lo que le importa al negocio', () => {
  const catalogoVivo = new Map([['pack-x6', {
    sku: 'pack-x6', name: 'Pack x6', category_id: 'gaseosas',
    price: '19999.00', stock: 8, publication_status: 'hidden', is_alcoholic: false,
  }]]);
  const resultado = buildCommercialPlan(sheet(['pack-x6,19999.00,8,si']), {
    catalog: catalogoVivo, imageExists: () => true,
  });
  assert.deepEqual(resultado.errors, []);
  assert.equal(resultado.rows[0].comprabilidad.antes, false);
  assert.equal(resultado.rows[0].comprabilidad.despues, true);
  assert.equal(resultado.summary.seVuelvenComprables, 1);
  assert.equal(resultado.summary.dejanDeSerComprables, 0);
});

test('--catalogo elige la fuente, y sólo acepta las dos que existen', () => {
  assert.equal(parseCommercialImportArgs(['x.csv']).catalogo, 'repo', 'el default no cambia');
  assert.equal(parseCommercialImportArgs(['--catalogo', 'produccion', 'x.csv']).catalogo, 'produccion');
  // El archivo se sigue reconociendo aunque venga después del flag y su valor.
  assert.equal(parseCommercialImportArgs(['--catalogo', 'produccion', 'x.csv']).file, 'x.csv');
  assert.throws(() => parseCommercialImportArgs(['--catalogo', 'staging', 'x.csv']), /tiene que ser repo o produccion/);
  assert.throws(() => parseCommercialImportArgs(['--catalogo', 'x.csv']), /Indicá exactamente un archivo CSV|tiene que ser/);
});
