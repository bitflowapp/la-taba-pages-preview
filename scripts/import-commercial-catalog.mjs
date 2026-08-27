/*
 * Importador comercial: de la planilla del negocio al catálogo, sin inventar.
 *
 * POR QUÉ EXISTE
 * --------------
 * El importador técnico (`import-product-catalog.mjs`) da de alta productos
 * NUEVOS desde un CSV de veintiún columnas. No sirve para lo que hace falta
 * ahora, que es lo contrario: los productos ya existen, están identificados,
 * tienen foto y categoría, y lo único que les falta es lo que sólo el negocio
 * puede decidir —precio, stock y si se publican—.
 *
 * Este importador toma la planilla de cuatro columnas, la cruza contra el
 * catálogo técnico y produce un plan. NO INVENTA NINGÚN DATO: cada campo
 * técnico sale del catálogo que ya existe y cada campo comercial de la
 * planilla. Una celda vacía es «no lo decidí todavía», nunca un cero.
 *
 * FALLA CERRADO. Un solo error bloquea la importación ENTERA: no existe la
 * importación parcial. Cargar 60 precios y que 3 queden mal es peor que no
 * cargar ninguno, porque los 3 se descubren vendiendo.
 *
 *   node scripts/import-commercial-catalog.mjs planilla.csv              # dry-run
 *   node scripts/import-commercial-catalog.mjs planilla.csv --apply ...  # aplica
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseCsv, PRODUCT_PRICE_MAX, POSTGRES_INTEGER_MAX } from './validate-product-catalog.mjs';
import { rowsToObjects, PROCUREMENT_SUFFIX } from './catalog-readiness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRODUCTS_CSV = path.join(ROOT, 'catalog/products.csv');

export const SHEET_REQUIRED_COLUMNS = Object.freeze(['sku', 'precio', 'stock', 'publicar']);

// Un SKU de QA nunca puede entrar por acá. El 8 de agosto dos fixtures de
// staging llegaron a la góndola publicada y una persona real compró «QA TEST
// iPhone - compra de prueba» ×3. El catálogo técnico no los tiene, así que
// «SKU desconocido» ya los frenaría; esta regla existe igual para que el
// mensaje diga la verdad en vez de mandar a revisar un id que nadie escribió
// mal, y para cubrir el día que un fixture SÍ esté en el catálogo.
export const QA_SKU_PATTERNS = Object.freeze([
  /-staging-only$/i,
  /^qa[-_]/i,
  /\bqa\b/i,
  /\b(test|prueba|sintetic[ao]|synthetic|fixture|dummy)\b/i,
]);

export function looksLikeQaSku(sku, name = '') {
  const haystack = `${sku} ${name}`;
  return QA_SKU_PATTERNS.some((pattern) => pattern.test(haystack));
}

/**
 * Precio de planilla. Devuelve `{ value }`, `{ empty: true }` o `{ error }`.
 *
 * La distinción entre vacío y cero es la razón de ser de esta función. En
 * JavaScript `Number('')` es 0 y `Number(null)` es 0: cualquier conversión
 * ingenua convierte «todavía no lo decidí» en «vale cero pesos», y un cero
 * pasa cualquier validación de «es un número». Acá el vacío nunca llega a ser
 * un número.
 */
export function parseSheetPrice(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') return { empty: true };
  // Se rechaza explícitamente lo que un Excel en español produce sin avisar:
  // separador de miles, coma decimal, signo y notación científica.
  if (/[,$\s]/.test(text)) {
    return { error: `precio «${text}»: escribilo sin puntos de mil, sin coma y sin signo. Ej: 3900 o 3900.50` };
  }
  if (/e/i.test(text)) return { error: `precio «${text}»: notación científica no aceptada.` };
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    return { error: `precio «${text}»: sólo dígitos y hasta dos decimales.` };
  }
  const value = Number(text);
  if (!Number.isFinite(value)) return { error: `precio «${text}»: no es un número finito.` };
  if (value <= 0) return { error: `precio «${text}»: tiene que ser mayor a cero.` };
  if (value > PRODUCT_PRICE_MAX) return { error: `precio «${text}»: fuera de rango.` };
  return { value };
}

/** Stock de planilla. El cero SÍ es válido y significa agotado. */
export function parseSheetStock(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') return { empty: true };
  if (/^-/.test(text)) return { error: `stock «${text}»: no puede ser negativo.` };
  if (/[.,]/.test(text)) return { error: `stock «${text}»: tiene que ser un entero de unidades.` };
  if (/e/i.test(text)) return { error: `stock «${text}»: notación científica no aceptada.` };
  if (!/^\d+$/.test(text)) return { error: `stock «${text}»: sólo dígitos.` };
  const value = Number(text);
  if (!Number.isSafeInteger(value)) return { error: `stock «${text}»: no es un entero seguro.` };
  if (value > POSTGRES_INTEGER_MAX) return { error: `stock «${text}»: fuera de rango.` };
  return { value };
}

/** Publicar. Vacío es «no lo decidí»: nunca publica y nunca despublica. */
export function parseSheetPublish(raw) {
  const text = String(raw ?? '').trim().toLowerCase();
  if (text === '') return { empty: true };
  if (['si', 'sí', 'yes', 'true', '1', 'x'].includes(text)) return { value: true };
  if (['no', 'false', '0'].includes(text)) return { value: false };
  return { error: `publicar «${raw}»: escribí «si» o «no».` };
}

export function readCatalogIndex(productsCsv) {
  const index = new Map();
  for (const product of rowsToObjects(productsCsv)) {
    const sku = String(product.sku || '').trim();
    if (sku) index.set(sku, product);
  }
  return index;
}

/**
 * Construye el plan. Función pura: no lee disco ni red, así que se puede
 * probar entera sin base de datos.
 */
export function buildCommercialPlan(sheetCsv, {
  catalog,
  imageExists = () => true,
  alcoholHabilitado = false,
} = {}) {
  const errors = [];
  const rows = parseCsv(String(sheetCsv ?? ''));
  if (!rows.length) return { errors: ['La planilla no tiene encabezado.'], rows: [], summary: emptySummary() };

  const header = rows[0].map((value, index) => (
    index === 0 ? value.replace(/^﻿/, '').trim().toLowerCase() : value.trim().toLowerCase()
  ));
  for (const column of SHEET_REQUIRED_COLUMNS) {
    if (!header.includes(column)) errors.push(`Falta la columna obligatoria «${column}».`);
  }
  const duplicatedColumns = header.filter((column, index) => header.indexOf(column) !== index);
  for (const column of new Set(duplicatedColumns)) {
    errors.push(`La columna «${column}» está repetida.`);
  }
  if (errors.length) return { errors, rows: [], summary: emptySummary() };

  const entries = rows.slice(1).map((values, index) => ({
    line: index + 2,
    values: Object.fromEntries(header.map((column, columnIndex) => [column, (values[columnIndex] ?? '').trim()])),
  }));

  const seen = new Map();
  const planned = [];
  for (const { line, values } of entries) {
    const sku = String(values.sku || '').trim();
    if (!sku) {
      errors.push(`Línea ${line}: sku vacío.`);
      continue;
    }
    if (seen.has(sku)) {
      errors.push(`Línea ${line}: el SKU «${sku}» ya aparece en la línea ${seen.get(sku)}. Dejá una sola fila por producto.`);
      continue;
    }
    seen.set(sku, line);

    const product = catalog.get(sku);
    if (looksLikeQaSku(sku, product?.name || '')) {
      errors.push(`Línea ${line}: «${sku}» parece un producto de prueba. No entra al catálogo comercial.`);
      continue;
    }
    if (!product) {
      errors.push(`Línea ${line}: el SKU «${sku}» no existe en el catálogo. Un SKU desconocido no se da de alta por acá.`);
      continue;
    }
    if (PROCUREMENT_SUFFIX.test(sku)) {
      errors.push(`Línea ${line}: «${sku}» es un pack de abastecimiento, no un producto de góndola.`);
      continue;
    }

    const price = parseSheetPrice(values.precio);
    const stock = parseSheetStock(values.stock);
    const publish = parseSheetPublish(values.publicar);
    for (const parsed of [price, stock, publish]) {
      if (parsed.error) errors.push(`Línea ${line} (${sku}): ${parsed.error}`);
    }
    if (price.error || stock.error || publish.error) continue;

    const before = {
      price: normalizeStoredPrice(product.price),
      /*
       * El catálogo del REPOSITORIO no guarda unidades, así que acá vale null y
       * la planilla tiene que traer el stock para poder publicar. El catálogo de
       * PRODUCCIÓN sí las tiene, y entonces el «antes» es el de verdad y el diff
       * puede decir «stock 12 → 24» en vez de «— → 24».
       */
      stock: normalizeStoredStock(product.stock),
      published: String(product.publication_status || '').trim() === 'published',
    };
    const after = {
      price: price.empty ? before.price : price.value,
      stock: stock.empty ? before.stock : stock.value,
      published: publish.empty ? before.published : publish.value,
    };

    // Publicar exige las tres patas. Sin ellas el producto aparece en la
    // tienda y no se puede comprar, que es la peor de las dos opciones: ocupa
    // lugar en la góndola y frustra a quien lo toca.
    //
    // La compuerta corre sólo cuando la planilla PIDE publicar. Conservar una
    // publicación que ya existía no es pedirla: si corriera también ahí,
    // cambiarle el precio a un producto ya publicado lo bloquearía por «falta
    // stock», porque el stock no vive en el catálogo técnico. Lo encontró el
    // propio test de esta regla.
    if (publish.value === true) {
      /*
       * EL ALCOHOL NO SE PUBLICA POR PLANILLA.
       *
       * Publicar una bebida alcohólica no es cargar un dato: es afirmar que el
       * local tiene la habilitación de expendio acreditada. Esa decisión vive en
       * `businesses.alcohol_sales_enabled`, la toma una persona, y este camino
       * no puede tomarla por ella ni siquiera si la planilla lo pide. Con la
       * compuerta cerrada, una fila que intente publicar alcohol frena la
       * importación ENTERA —como cualquier otro error— en vez de colarse.
       */
      if (product.is_alcoholic === true && !alcoholHabilitado) {
        errors.push(`Línea ${line} (${sku}): es una bebida alcohólica y la venta de alcohol está cerrada `
          + '(alcohol_sales_enabled = false). Publicarla es una habilitación comercial, no un dato de planilla.');
        continue;
      }
      const faltan = [];
      if (after.price === null) faltan.push('precio');
      if (after.stock === null) faltan.push('stock');
      if (!imageExists(product)) faltan.push('foto');
      if (faltan.length) {
        errors.push(`Línea ${line} (${sku}): no se puede publicar sin ${faltan.join(', ')}.`);
        continue;
      }
      if (after.stock === 0) {
        errors.push(`Línea ${line} (${sku}): publicar con stock 0 deja un producto visible que nadie puede comprar. Cargá stock o poné publicar=no.`);
        continue;
      }
    }

    planned.push({
      line,
      sku,
      name: product.name || '',
      category: product.category_id || '',
      before,
      after,
      changes: describeChanges(before, after),
      // Lo que de verdad le importa al negocio: si después de esto se puede
      // comprar o no. Un cambio de precio que deja el producto igual de
      // invendible no es una mejora, y así se ve.
      comprabilidad: { antes: esComprable(before), despues: esComprable(after) },
      notes: values.notas || '',
    });
  }

  if (errors.length) return { errors, rows: [], summary: emptySummary() };

  const touched = planned.filter((row) => row.changes.length);
  return {
    errors: [],
    rows: planned,
    summary: {
      sheetRows: planned.length,
      changed: touched.length,
      unchanged: planned.length - touched.length,
      priceChanges: touched.filter((row) => row.changes.includes('precio')).length,
      stockChanges: touched.filter((row) => row.changes.includes('stock')).length,
      publishChanges: touched.filter((row) => row.changes.includes('publicacion')).length,
      // Los que NO están en la planilla no se tocan: no entran al payload.
      seVuelvenComprables: planned.filter((r) => !r.comprabilidad.antes && r.comprabilidad.despues).length,
      dejanDeSerComprables: planned.filter((r) => r.comprabilidad.antes && !r.comprabilidad.despues).length,
      siguenSinPoderVenderse: planned.filter((r) => !r.comprabilidad.antes && !r.comprabilidad.despues).length,
      untouchedCatalogSkus: catalog.size - planned.length,
      sheetSha256: sha256(String(sheetCsv ?? '')),
    },
  };
}

function emptySummary() {
  return {
    sheetRows: 0,
    changed: 0,
    unchanged: 0,
    priceChanges: 0,
    stockChanges: 0,
    publishChanges: 0,
    seVuelvenComprables: 0,
    dejanDeSerComprables: 0,
    siguenSinPoderVenderse: 0,
    untouchedCatalogSkus: 0,
    sheetSha256: '',
  };
}

/**
 * ¿Con estos tres valores se puede comprar? Es la misma regla que
 * `core/beverage-home-sections.isPurchasableBeverageProduct` aplica en la
 * tienda, reducida a lo que una planilla puede cambiar.
 */
export function esComprable(estado) {
  return Boolean(estado.published && estado.price !== null && estado.price > 0
    && estado.stock !== null && estado.stock > 0);
}

function describeChanges(before, after) {
  const changes = [];
  if (before.price !== after.price) changes.push('precio');
  if (before.stock !== after.stock) changes.push('stock');
  if (before.published !== after.published) changes.push('publicacion');
  return changes;
}

// El precio guardado se lee igual de estricto que el de la planilla: una fila
// del catálogo con `price` vacío vale `null`, no cero. Si esto devolviera 0, un
// producto sin precio se leería como «ya tenía precio 0» y la planilla parecería
// no cambiar nada.
export function normalizeStoredPrice(raw) {
  const text = String(raw ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Stock guardado. Ausente es `null` —«no lo sé»—, nunca 0: confundir los dos
 * haría que un producto sin dato pareciera «ya estaba en cero» y que la planilla
 * no cambia nada. Es la misma distinción que hace `normalizeStoredPrice`.
 */
export function normalizeStoredStock(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export function renderChangeReport(plan) {
  const lines = [];
  const money = (value) => (value === null ? '—' : `$ ${value}`);
  const stock = (value) => (value === null ? '—' : String(value));
  const flag = (value) => (value ? 'publicado' : 'oculto');

  for (const row of plan.rows) {
    if (!row.changes.length) continue;
    const parts = [];
    if (row.changes.includes('precio')) parts.push(`precio ${money(row.before.price)} → ${money(row.after.price)}`);
    if (row.changes.includes('stock')) parts.push(`stock ${stock(row.before.stock)} → ${stock(row.after.stock)}`);
    if (row.changes.includes('publicacion')) parts.push(`${flag(row.before.published)} → ${flag(row.after.published)}`);
    lines.push(`  ${row.sku.padEnd(38)} ${parts.join(' · ')}`);
  }
  return lines;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Convierte el plan en el payload del RPC. Sólo viajan las celdas que la
 * planilla DECIDIÓ: una celda vacía no viaja, y lo que no viaja no se toca.
 * Es la misma regla que impone el servidor, expresada acá para que el payload
 * no pueda contradecirla ni por accidente.
 */
export function planToRpcRows(plan) {
  return plan.rows
    .filter((row) => row.changes.length)
    .map((row) => {
      const payload = { sku: row.sku };
      if (row.changes.includes('precio')) payload.price = String(row.after.price);
      if (row.changes.includes('stock')) payload.stock = row.after.stock;
      if (row.changes.includes('publicacion')) payload.publish = row.after.published;
      return payload;
    });
}

export async function applyCommercialImport(client, plan, businessId) {
  if (!Array.isArray(plan?.errors) || plan.errors.length) {
    throw new Error('No se aplica un plan con errores.');
  }
  const rows = planToRpcRows(plan);
  if (!rows.length) throw new Error('El plan no cambia nada: no hay nada que aplicar.');
  if (!client?.rpc) throw new Error('Cliente Supabase inválido.');

  // Una llamada es una transacción. El servidor aplica las N filas o ninguna.
  const result = await client.rpc('apply_commercial_catalog_batch', {
    p_business_id: businessId,
    p_rows: rows,
  });
  if (result?.error) {
    throw new Error(`El servidor rechazó el lote y lo deshizo entero: ${result.error.message || 'error desconocido'}`);
  }
  const applied = Array.isArray(result?.data) ? result.data : [];
  if (applied.length !== rows.length) {
    throw new Error(`El servidor devolvió ${applied.length} de ${rows.length} filas esperadas.`);
  }
  return { applied: applied.length, rows: applied };
}

export const CATALOGOS = Object.freeze(['repo', 'produccion']);

export function parseCommercialImportArgs(args = []) {
  const known = ['--dry-run', '--apply', '--json', '--target', '--catalogo'];
  const unknown = args.filter((argument) => argument.startsWith('--') && !known.includes(argument));
  if (unknown.length) throw new Error(`Flag desconocido: ${unknown[0]}.`);
  const apply = args.includes('--apply');
  const targetIndex = args.indexOf('--target');
  const target = targetIndex >= 0 ? args[targetIndex + 1] : '';
  if (targetIndex >= 0 && (!target || target.startsWith('--'))) {
    throw new Error('--target requiere un destino.');
  }
  if (apply && !target) {
    throw new Error('--apply exige --target: aplicar sin decir a dónde es exactamente lo que este importador evita.');
  }
  /*
   * CONTRA QUÉ CATÁLOGO SE VALIDA.
   *
   * `repo` es el histórico y sigue siendo el valor por defecto para no cambiarle
   * el significado a ninguna invocación que ya exista. `produccion` es el que
   * sirve para una planilla real: medido el 2026-08-27, el CSV del repositorio y
   * la tienda publicada comparten 7 SKU de 72, así que validar contra el repo
   * rechaza casi todo lo que está vendiendo.
   */
  const catalogoIndex = args.indexOf('--catalogo');
  const catalogo = catalogoIndex >= 0 ? args[catalogoIndex + 1] : 'repo';
  if (!CATALOGOS.includes(catalogo)) {
    throw new Error(`--catalogo tiene que ser ${CATALOGOS.join(' o ')}, y llegó «${catalogo || '(vacío)'}».`);
  }
  const positionals = args.filter((argument, index) => (
    !argument.startsWith('--') && args[index - 1] !== '--target' && args[index - 1] !== '--catalogo'
  ));
  if (positionals.length !== 1) throw new Error('Indicá exactamente un archivo CSV.');
  return { file: positionals[0], mode: apply ? 'apply' : 'dry-run', target, catalogo };
}

async function main(args) {
  let options;
  try {
    options = parseCommercialImportArgs(args);
  } catch (error) {
    console.error(`ERROR ${error.message}`);
    console.error('Uso: node scripts/import-commercial-catalog.mjs planilla.csv [--apply --target <destino>]');
    process.exitCode = 2;
    return;
  }

  let sheetCsv;
  try {
    sheetCsv = fs.readFileSync(path.resolve(options.file), 'utf8');
  } catch (error) {
    console.error(`ERROR No se pudo leer ${options.file}: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  let catalog;
  let alcoholHabilitado = false;
  let imageExists;
  if (options.catalogo === 'produccion') {
    const modulo = await import('./comercial/catalogo-de-produccion.mjs');
    catalog = await modulo.leerCatalogoDeProduccion();
    alcoholHabilitado = await modulo.leerAlcoholHabilitado();
    imageExists = modulo.tieneImagen;
    console.log(`Catálogo: PRODUCCIÓN · ${catalog.size} SKU · alcohol_sales_enabled=${alcoholHabilitado}`);
  } else {
    catalog = readCatalogIndex(fs.readFileSync(PRODUCTS_CSV, 'utf8'));
    imageExists = (product) => {
      const master = String(product.image_master || '').trim();
      return Boolean(master) && fs.existsSync(path.join(ROOT, master));
    };
    console.log(`Catálogo: repositorio · ${catalog.size} SKU`);
  }

  const plan = buildCommercialPlan(sheetCsv, { catalog, imageExists, alcoholHabilitado });

  if (options.mode === 'dry-run' && args.includes('--json')) {
    console.log(JSON.stringify(plan, null, 2));
    if (plan.errors.length) process.exitCode = 1;
    return;
  }

  if (plan.errors.length) {
    console.error('');
    console.error('INVALID');
    console.error(`  ${plan.errors.length} fila(s) rechazada(s). NO SE ESCRIBIÓ NADA.`);
    console.error('');
    for (const error of plan.errors) console.error(`  ERROR ${error}`);
    console.error('');
    console.error('Falla cerrado a propósito: una importación a medias deja precios mal en la góndola.');
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log('VALID');
  console.log(`  productos encontrados ....... ${plan.summary.sheetRows}`);
  console.log(`  filas rechazadas ............ 0`);
  console.log(`  productos NO mencionados .... ${plan.summary.untouchedCatalogSkus} (quedan intactos)`);
  console.log(`  precios que cambian ......... ${plan.summary.priceChanges}`);
  console.log(`  stock que cambia ............ ${plan.summary.stockChanges}`);
  console.log(`  publicación que cambia ...... ${plan.summary.publishChanges}`);
  console.log('');
  console.log('  IMPACTO SOBRE COMPRABILIDAD');
  console.log(`    se vuelven comprables ..... ${plan.summary.seVuelvenComprables}`);
  console.log(`    dejan de ser comprables ... ${plan.summary.dejanDeSerComprables}`);
  console.log(`    siguen sin poder venderse . ${plan.summary.siguenSinPoderVenderse}`);
  console.log('');
  console.log(`  sha256 de la planilla ....... ${plan.summary.sheetSha256.slice(0, 16)}…`);
  console.log('');
  const report = renderChangeReport(plan);
  if (report.length) {
    console.log(`CAMBIOS (${plan.summary.changed}):`);
    for (const line of report) console.log(line);
  } else {
    console.log('CAMBIOS: ninguno. La planilla no mueve nada.');
  }
  console.log('');
  console.log(`  precio ....... ${plan.summary.priceChanges}`);
  console.log(`  stock ........ ${plan.summary.stockChanges}`);
  console.log(`  publicación .. ${plan.summary.publishChanges}`);
  console.log(`  sin cambios .. ${plan.summary.unchanged}`);
  console.log(`  intactos ..... ${plan.summary.untouchedCatalogSkus} SKU del catálogo que la planilla no menciona`);

  if (options.mode === 'dry-run') {
    console.log('');
    console.log('Dry-run: no se escribió nada. Para aplicar: --apply --target <destino>');
    return;
  }

  if (options.target !== 'supabase') {
    console.error('');
    console.error(`ERROR Destino «${options.target}» desconocido. El único destino de aplicación es --target supabase.`);
    console.error('  Para ejercitarlo contra una base descartable: node scripts/run-commercial-import-drill.mjs');
    process.exitCode = 2;
    return;
  }

  const rows = planToRpcRows(plan);
  if (!rows.length) {
    console.log('');
    console.log('No hay nada que aplicar: la planilla no cambia ningún valor.');
    return;
  }

  console.log('');
  console.log(`Aplicando ${rows.length} fila(s) en UNA transacción. Si una falla, no se aplica ninguna.`);
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const { url, publishableKey, accessToken, businessId } = readCommercialCredentials(process.env);
    const client = createClient(url, publishableKey, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const result = await applyCommercialImport(client, plan, businessId);
    console.log(`Aplicado: ${result.applied} fila(s).`);
    console.log('El resto del catálogo quedó intacto: sólo viajaron los SKU de la planilla.');
  } catch (error) {
    console.error(`ERROR ${error.message}`);
    process.exitCode = 1;
  }
}

export function readCommercialCredentials(env = {}) {
  const url = env.SUPABASE_URL || '';
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '';
  const accessToken = env.SUPABASE_ACCESS_TOKEN || '';
  const businessId = env.TABA_BUSINESS_ID || '';
  if (!/^https:\/\//i.test(url)) throw new Error('Falta SUPABASE_URL HTTPS.');
  if (!publishableKey) throw new Error('Falta SUPABASE_PUBLISHABLE_KEY o SUPABASE_ANON_KEY.');
  if (/^sb_secret_/i.test(publishableKey)) {
    throw new Error('No uses una clave secreta en este importador: alcanza con la publicable y el token del dueño.');
  }
  if (!accessToken) throw new Error('Falta SUPABASE_ACCESS_TOKEN de un owner/admin autenticado.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(businessId)) {
    throw new Error('Falta TABA_BUSINESS_ID con un UUID válido.');
  }
  return { url, publishableKey, accessToken, businessId };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  await main(process.argv.slice(2));
}
