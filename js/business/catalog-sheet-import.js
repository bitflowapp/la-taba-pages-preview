/*
 * IMPORTAR PLANILLA EN EL PANEL: de las filas leídas al lote que se aplica.
 *
 * Función pura: recibe las filas que devolvió `catalog-sheet-reader.js` y el
 * catálogo que el Panel ya tiene cargado, y arma un PLAN —qué cambia en cada
 * producto, qué filas no se pueden aplicar y por qué—. No llama a nadie. El
 * plan se muestra, y recién con «Aplicar» viaja al servidor en lotes de hasta
 * 500 filas por `apply_commercial_catalog_batch`, que vuelve a validar todo.
 *
 * EL CONTRATO DE LA PLANILLA (hoja «Productos»; el encabezado es la primera
 * fila cuya primera celda dice «SKU»; mayúsculas y acentos no importan y
 * cualquier otra columna se ignora):
 *
 *   SKU | Producto | Costo (ARS) | Precio de venta (ARS) |
 *   Precio regular antes de la promo (ARS) | Stock actual |
 *   ¿Disponible para vender? | Observaciones
 *
 * LAS REGLAS
 *   · Celda vacía = no se cambia nada. Nunca es cero.
 *   · Para BORRAR un costo o TERMINAR una promo se escribe «quitar» (o un
 *     guion) en esa celda: una celda vacía no puede significar dos cosas.
 *   · El SKU tiene que existir en el catálogo del negocio. Una fila con un SKU
 *     desconocido se informa y no se aplica: la planilla nunca crea productos.
 *   · Importes con punto o coma decimal; un separador seguido de exactamente
 *     tres dígitos («1.234») es ambiguo y se rechaza (ver `parseMoneyText`). Una
 *     celda numérica de Excel llega como número y se usa tal cual (redondeada
 *     a centavos, y la vista previa lo avisa si redondeó).
 *   · Stock: entero de cero o más.
 *   · «¿Disponible para vender?» Sí/No es la decisión de publicar. Las
 *     compuertas de publicación (precio, stock, foto aprobada, licencia de
 *     alcohol) deciden: un producto sin foto queda sin publicar y la vista
 *     previa dice por qué. El servidor las vuelve a exigir.
 *   · Una fila con un error no se aplica entera; las demás, sí.
 */
import { catalogPublicationReadiness, catalogStockLabel, normalizeCatalogProduct } from './business-catalog-editor.js';
import {
  centsToApiString, describePricing, formatMoney, fromCents, MONEY_MAX_CENTS, parseMoneyText, toCents,
} from './catalog-pricing.js';
import { MAX_SHEET_ROWS } from './catalog-sheet-reader.js';
import { humanizeFailure } from './business-operation-language.js';

/** Tope del servidor por llamada. Una planilla más larga viaja en varios lotes. */
export const CATALOG_BATCH_LIMIT = 500;
const STOCK_MAX = 2147483647;

export const SHEET_FIELDS = Object.freeze({
  sku: Object.freeze(['sku']),
  name: Object.freeze(['producto']),
  cost: Object.freeze(['costo ars', 'costo']),
  price: Object.freeze(['precio de venta ars', 'precio de venta', 'precio']),
  compareAt: Object.freeze(['precio regular antes de la promo ars', 'precio regular antes de la promo', 'precio regular']),
  stock: Object.freeze(['stock actual', 'stock']),
  publish: Object.freeze(['disponible para vender', 'publicar']),
  notes: Object.freeze(['observaciones', 'notas']),
});

const FIELD_BY_HEADER = new Map(Object.entries(SHEET_FIELDS).flatMap(([field, headers]) => headers.map((header) => [header, field])));
const EDITABLE_FIELDS = Object.freeze(['cost', 'price', 'compareAt', 'stock', 'publish']);
const CLEAR_WORDS = new Set(['quitar', 'borrar', 'sin costo', 'sin promo']);
const CLEAR_SYMBOLS = new Set(['-', '–', '—']);
const YES = new Set(['si', 's', 'yes', 'y', 'true', '1', 'x', 'verdadero']);
const NO = new Set(['no', 'n', 'false', '0', 'falso']);

// El mismo patrón que `apply_commercial_catalog_batch` usa para rechazar un SKU
// con pinta de fixture: si viaja, el servidor tira el lote ENTERO.
const QA_LOOKING_SKU = /(-staging-only$)|(^qa[-_])|(\bqa\b)|(\b(?:test|prueba|sintetica|sintetico|synthetic|fixture|dummy)\b)/i;

const MONEY_ERRORS = Object.freeze({
  format: (raw) => `«${raw}» no es un importe. Escribí sólo números, por ejemplo 1500 o 1500,50.`,
  negative: (raw) => `«${raw}» no puede ser negativo.`,
  ambiguous: (raw) => `«${raw}» es ambiguo: no se sabe si el separador es de miles o de decimales. Escribilo sin separador de miles, por ejemplo 1234 o 1234,50.`,
  decimals: (raw) => `«${raw}» tiene más de dos decimales.`,
  grouping: (raw) => `«${raw}» tiene los separadores de miles mal puestos. Escribilo sin separador de miles, por ejemplo 1234 o 1234,50.`,
  range: (raw) => `«${raw}» está fuera de rango.`,
});

/** Texto de encabezado o de celda, comparable: sin acentos, sin signos, en minúsculas. */
export function normalizeSheetText(value) {
  return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function cellText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return String(value.error || '');
  return String(value).trim();
}

function firstFilled(cells = []) {
  return cells.find((value) => value !== null && value !== undefined && cellText(value) !== '') ?? null;
}

function isClearToken(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return CLEAR_SYMBOLS.has(text) || CLEAR_WORDS.has(normalizeSheetText(text));
}

/** Importe de una celda: `{ empty }`, `{ clear }`, `{ cents, rounded }` o `{ error }` (texto sin la etiqueta). */
export function readMoneyCell(value, { allowZero = false, clearable = false } = {}) {
  if (value === null || value === undefined) return { empty: true };
  if (typeof value === 'object') return { error: `la celda tiene un error de fórmula (${cellText(value) || '#ERROR'}).` };
  if (typeof value === 'boolean') return { error: 'se esperaba un importe y la celda dice Sí/No.' };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { error: 'no es un importe.' };
    if (value < 0) return { error: 'no puede ser negativo.' };
    const cents = toCents(value);
    if (cents === null || cents > MONEY_MAX_CENTS) return { error: 'está fuera de rango.' };
    if (!allowZero && cents === 0) return { error: 'tiene que ser mayor que cero.' };
    return { cents, rounded: Math.abs(value * 100 - cents) > 1e-6 };
  }
  const text = String(value).trim();
  if (!text) return { empty: true };
  if (clearable && isClearToken(text)) return { clear: true };
  const parsed = parseMoneyText(text);
  if (parsed.empty) return { empty: true };
  if (parsed.error) return { error: MONEY_ERRORS[parsed.error](text) };
  if (!allowZero && parsed.cents === 0) return { error: 'tiene que ser mayor que cero.' };
  return { cents: parsed.cents, rounded: false };
}

/** Stock de una celda: `{ empty }`, `{ value }` o `{ error }`. El cero es válido: agotado. */
export function readStockCell(value) {
  if (value === null || value === undefined) return { empty: true };
  if (typeof value === 'object') return { error: 'la celda tiene un error de fórmula.' };
  if (typeof value === 'boolean') return { error: 'se esperaba una cantidad y la celda dice Sí/No.' };
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) return { error: `«${value}» tiene que ser un número entero de unidades.` };
    if (value < 0) return { error: 'no puede ser negativo.' };
    if (value > STOCK_MAX) return { error: 'está fuera de rango.' };
    return { value };
  }
  const text = String(value).trim();
  if (!text) return { empty: true };
  if (/^[-−]/.test(text)) return { error: 'no puede ser negativo.' };
  if (!/^\d+$/.test(text)) return { error: `«${text}» tiene que ser un número entero de unidades, sin puntos ni comas.` };
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number > STOCK_MAX) return { error: 'está fuera de rango.' };
  return { value: number };
}

/** «¿Disponible para vender?»: `{ empty }`, `{ value: true|false }` o `{ error }`. */
export function readPublishCell(value) {
  if (value === null || value === undefined) return { empty: true };
  if (typeof value === 'boolean') return { value };
  if (typeof value === 'number') {
    if (value === 1) return { value: true };
    if (value === 0) return { value: false };
    return { error: `«${value}» no se entiende. Escribí Sí o No.` };
  }
  if (typeof value === 'object') return { error: 'la celda tiene un error de fórmula.' };
  const text = normalizeSheetText(value);
  if (!text) return { empty: true };
  if (YES.has(text)) return { value: true };
  if (NO.has(text)) return { value: false };
  return { error: `«${String(value).trim()}» no se entiende. Escribí Sí o No.` };
}

function readSku(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  if (typeof value !== 'string') return null;
  return value.trim();
}

function moneyLabel(cents, empty) {
  return cents === null || cents === undefined ? empty : formatMoney(fromCents(cents));
}

function sheetFailure(error) {
  return Object.freeze({
    ok: false, error, headerRow: 0, columns: [], rows: [], patches: [],
    summary: { rows: 0, changes: 0, unchanged: 0, errors: 0, unknown: 0, blocked: 0 }, notices: [],
  });
}

/*
 * Las compuertas con las que el servidor REPUBLICA un producto publicado cuyo
 * precio cambió (el disparador de datos maestros lo despublica y la función lo
 * vuelve a publicar si todavía cumple). La foto no se puede juzgar acá: la
 * función acepta «sin foto» o «foto completa y aprobada».
 */
function republishBlocker(projected, alcoholEnabled) {
  if (!projected.active) return 'el producto está inactivo';
  if (projected.stock === null || projected.stock <= 0) return 'queda sin stock';
  if (projected.alcoholic && !alcoholEnabled) return 'la venta de alcohol no está habilitada';
  return '';
}

/**
 * Arma el plan. `products` son las filas del catálogo como las trae el Panel
 * (con `unit_cost` y `compare_at_price` cuando se pueden leer).
 */
export function buildCatalogSheetPlan(rows, {
  products = [],
  pricingAvailable = false,
  alcoholEnabled = false,
  imageUploads = [],
  catalogLimitReached = false,
} = {}) {
  const list = Array.isArray(rows) ? rows.filter((row) => row && Array.isArray(row.cells)) : [];
  const headerIndex = list.findIndex((row) => normalizeSheetText(firstFilled(row.cells)) === 'sku');
  if (headerIndex === -1) {
    return sheetFailure('No encontramos el encabezado de la planilla: tiene que haber una fila que empiece con «SKU».');
  }
  const header = list[headerIndex];
  const columns = {};
  for (const [index, value] of header.cells.entries()) {
    const field = FIELD_BY_HEADER.get(normalizeSheetText(value));
    if (!field) continue;
    if (columns[field] !== undefined) {
      return sheetFailure(`La columna «${cellText(value)}» aparece dos veces en el encabezado. Dejá una sola.`);
    }
    columns[field] = index;
  }
  const editable = EDITABLE_FIELDS.filter((field) => columns[field] !== undefined);
  if (!editable.length) {
    return sheetFailure('La planilla no tiene columnas para cambiar: hace falta al menos una de «Costo (ARS)», «Precio de venta (ARS)», «Precio regular antes de la promo (ARS)», «Stock actual» o «¿Disponible para vender?».');
  }
  const at = (row, field) => (columns[field] === undefined ? null : row.cells[columns[field]] ?? null);
  const dataRows = list.slice(headerIndex + 1).filter((row) => (
    at(row, 'sku') !== null || editable.some((field) => at(row, field) !== null)
  ));
  if (dataRows.length > MAX_SHEET_ROWS) {
    return sheetFailure(`La planilla tiene ${dataRows.length} filas de productos y el tope es ${MAX_SHEET_ROWS}. Dividila en partes.`);
  }

  const catalog = new Map();
  for (const raw of Array.isArray(products) ? products : []) {
    const product = normalizeCatalogProduct(raw);
    if (product.sku) catalog.set(product.sku, product);
  }
  const occurrences = new Map();
  for (const row of dataRows) {
    const sku = readSku(at(row, 'sku'));
    if (sku) occurrences.set(sku, [...(occurrences.get(sku) || []), row.number]);
  }

  const planRows = dataRows.map((row) => planRow(row, {
    at, catalog, occurrences, pricingAvailable, alcoholEnabled, imageUploads,
  }));
  const count = (status) => planRows.filter((row) => row.status === status).length;
  const notices = [];
  const costColumns = ['cost', 'compareAt'].filter((field) => columns[field] !== undefined);
  if (!pricingAvailable && costColumns.length) {
    notices.push('El Panel todavía no puede guardar costos ni precios regulares: esas columnas se muestran pero no se aplican.');
  }
  if (catalogLimitReached) {
    notices.push('El Panel cargó sólo los primeros productos del catálogo: un SKU que no esté en esa lista aparece como desconocido.');
  }
  return Object.freeze({
    ok: true,
    error: '',
    headerRow: header.number,
    columns: editable,
    rows: planRows,
    patches: planRows.filter((row) => row.patch).map((row) => row.patch),
    summary: {
      rows: planRows.length,
      changes: count('change'),
      unchanged: count('unchanged'),
      errors: count('error'),
      unknown: count('unknown'),
      blocked: count('blocked'),
    },
    notices,
  });
}

function planRow(row, { at, catalog, occurrences, pricingAvailable, alcoholEnabled, imageUploads }) {
  const sheetName = cellText(at(row, 'name'));
  const sku = readSku(at(row, 'sku'));
  const base = {
    line: row.number, sku: sku || '', name: sheetName, status: 'error',
    changes: [], errors: [], notes: [], patch: null, pricing: null,
  };
  if (sku === null) return { ...base, errors: ['SKU: escribilo como texto, tal como figura en el catálogo.'] };
  if (!sku) return { ...base, errors: ['Falta el SKU: sin él no se sabe qué producto cambiar.'] };
  const repeated = occurrences.get(sku) || [];
  if (repeated.length > 1) {
    return { ...base, errors: [`El SKU aparece en más de una fila (filas ${repeated.join(', ')}): dejá una sola.`] };
  }
  if (QA_LOOKING_SKU.test(sku)) {
    return { ...base, errors: ['Este SKU parece de prueba y no se carga en el catálogo del negocio.'] };
  }
  const product = catalog.get(sku);
  if (!product) {
    return { ...base, status: 'unknown', errors: ['Este SKU no está en el catálogo del negocio. La planilla no crea productos.'] };
  }
  const name = product.name || sheetName;
  const errors = [];
  const notes = [];
  const changes = [];
  const patch = { sku };

  const price = readMoneyCell(at(row, 'price'));
  const stock = readStockCell(at(row, 'stock'));
  const publish = readPublishCell(at(row, 'publish'));
  const costCell = at(row, 'cost');
  const compareCell = at(row, 'compareAt');
  const cost = pricingAvailable ? readMoneyCell(costCell, { allowZero: true, clearable: true }) : { empty: true };
  const compare = pricingAvailable ? readMoneyCell(compareCell, { clearable: true }) : { empty: true };
  if (!pricingAvailable && (costCell !== null || compareCell !== null)) {
    notes.push('Costo y precio regular: todavía no se pueden guardar desde el Panel.');
  }
  if (price.error) errors.push(`Precio de venta: ${price.error}`);
  if (cost.error) errors.push(`Costo: ${cost.error}`);
  if (compare.error) errors.push(`Precio regular: ${compare.error}`);
  if (stock.error) errors.push(`Stock: ${stock.error}`);
  if (publish.error) errors.push(`¿Disponible para vender?: ${publish.error}`);

  const confirmed = product.priceStatus === 'confirmed' && product.price > 0;
  const currentPrice = confirmed ? toCents(product.price) : null;
  const currentCost = toCents(product.unitCost);
  const currentRegular = toCents(product.compareAtPrice);
  const nextPrice = price.cents ?? currentPrice;
  const nextRegular = compare.clear ? null : (compare.cents ?? currentRegular);

  if (!errors.length && pricingAvailable && nextRegular !== null && nextRegular <= (nextPrice ?? toCents(product.price) ?? 0)) {
    errors.push(compare.cents !== undefined
      ? `Precio regular: tiene que ser mayor que el precio de venta (${moneyLabel(nextPrice, '$ 0')}).`
      : `Precio de venta: ${moneyLabel(nextPrice, '')} no es menor que el precio regular guardado (${moneyLabel(nextRegular, '')}). Para terminar la promo escribí «quitar» en «Precio regular antes de la promo».`);
  }
  if (errors.length) return { ...base, sku, name, errors };

  if (price.cents !== undefined && (!confirmed || price.cents !== currentPrice)) {
    patch.price = centsToApiString(price.cents);
    changes.push({ field: 'price', label: 'Precio de venta', before: confirmed ? moneyLabel(currentPrice, '') : 'Sin confirmar', after: moneyLabel(price.cents, '') });
    if (price.rounded) notes.push(`El precio de venta se redondeó a ${moneyLabel(price.cents, '')}.`);
  }
  if (cost.clear && currentCost !== null) {
    patch.unit_cost = null;
    changes.push({ field: 'cost', label: 'Costo', before: moneyLabel(currentCost, ''), after: 'Sin costo' });
  } else if (cost.cents !== undefined && cost.cents !== currentCost) {
    patch.unit_cost = centsToApiString(cost.cents);
    changes.push({ field: 'cost', label: 'Costo', before: moneyLabel(currentCost, 'Sin costo'), after: moneyLabel(cost.cents, '') });
    if (cost.rounded) notes.push(`El costo se redondeó a ${moneyLabel(cost.cents, '')}.`);
  }
  if (compare.clear && currentRegular !== null) {
    patch.compare_at_price = null;
    changes.push({ field: 'compareAt', label: 'Precio regular', before: moneyLabel(currentRegular, ''), after: 'Sin promo' });
  } else if (compare.cents !== undefined && compare.cents !== currentRegular) {
    patch.compare_at_price = centsToApiString(compare.cents);
    changes.push({ field: 'compareAt', label: 'Precio regular', before: moneyLabel(currentRegular, 'Sin promo'), after: moneyLabel(compare.cents, '') });
    if (compare.rounded) notes.push(`El precio regular se redondeó a ${moneyLabel(compare.cents, '')}.`);
  }
  if (stock.value !== undefined && stock.value !== product.stock) {
    patch.stock = stock.value;
    changes.push({ field: 'stock', label: 'Stock', before: catalogStockLabel(product.stock), after: catalogStockLabel(stock.value) });
  }

  const projected = {
    ...product,
    price: nextPrice === null ? product.price : fromCents(nextPrice),
    priceStatus: price.cents !== undefined ? 'confirmed' : product.priceStatus,
    stock: stock.value ?? product.stock,
  };
  let blocked = '';
  if (publish.value === true && !product.available) {
    const readiness = catalogPublicationReadiness({ ...projected, available: false }, { imageUploads, alcoholEnabled });
    if (readiness.ready) {
      patch.publish = true;
      changes.push({ field: 'publish', label: 'Publicación', before: 'Sin publicar', after: 'Publicar en la tienda' });
    } else {
      blocked = readiness.reason;
      notes.push(`No se publica: ${readiness.reason}`);
    }
  } else if (publish.value === false && (product.available || product.merchantAvailable)) {
    patch.publish = false;
    changes.push({ field: 'publish', label: 'Publicación', before: product.available ? 'Publicado' : 'Sin stock, se vuelve a mostrar al reponer', after: 'Oculto de la tienda' });
  }
  if (product.available && patch.publish === undefined) {
    if (patch.price !== undefined) {
      const reason = republishBlocker(projected, alcoholEnabled);
      if (reason) notes.push(`Puede dejar de estar publicado: ${reason}.`);
    } else if (patch.stock === 0) {
      notes.push('Con stock 0 deja de estar disponible hasta que repongas y lo vuelvas a publicar.');
    }
  }

  const pricing = pricingAvailable
    ? describePricing({ price: projected.priceStatus === 'confirmed' ? projected.price : null, cost: fromCents(cost.clear ? null : (cost.cents ?? currentCost)), compareAtPrice: fromCents(nextRegular) })
    : null;
  if (pricing?.belowCost) notes.push(pricing.warnings[0]);
  const hasChanges = Object.keys(patch).length > 1;
  return {
    ...base,
    sku,
    name,
    status: hasChanges ? 'change' : blocked ? 'blocked' : 'unchanged',
    changes,
    errors: [],
    notes,
    patch: hasChanges ? patch : null,
    pricing,
    wantsPublish: publish.value ?? null,
  };
}

// ── Aplicar ─────────────────────────────────────────────────────────────────

const NOT_APPLIED_BLOCK = 'No se aplicó: el servidor rechazó el bloque entero y no cambió ninguno de sus productos.';
const NOT_TRIED = 'No se intentó: un bloque anterior no se aplicó. Corregí la planilla y volvé a importarla.';

function failureMessage(response) {
  if (response?.friendly) return String(response.friendly);
  return humanizeFailure(response?.message, 'El servidor no aceptó los cambios. No se aplicó ningún cambio de este bloque.');
}

function describeAppliedRow(row, applied) {
  const parts = ['Guardado.'];
  const available = applied ? applied.applied_available === true : null;
  if (row.patch?.publish === true) parts.push(available === false ? 'Quedó sin publicar: el servidor no lo habilitó.' : 'Publicado en la tienda.');
  else if (row.patch?.publish === false) parts.push('Oculto de la tienda.');
  else if (applied?.applied_republished === true) parts.push('Sigue publicado con el precio nuevo.');
  else if (row.wasAvailable && available === false) parts.push('Dejó de estar publicado.');
  return { status: 'applied', message: parts.join(' '), available };
}

/**
 * Aplica el plan en lotes de hasta 500 filas, una llamada por lote. Cada lote
 * es atómico en el servidor. Si uno falla, los siguientes NO se intentan: lo
 * que ya se aplicó, se aplicó, y volver a importar la misma planilla es seguro
 * (lo aplicado aparece como «sin cambios»).
 *
 * `save(rows)` es `saveCommercialBatch` del Panel.
 */
export async function applyCatalogSheetPlan(plan, { save, chunkSize = CATALOG_BATCH_LIMIT, products = [] } = {}) {
  const size = Math.max(1, Math.min(CATALOG_BATCH_LIMIT, Number(chunkSize) || CATALOG_BATCH_LIMIT));
  const before = new Map((Array.isArray(products) ? products : []).map((raw) => {
    const product = normalizeCatalogProduct(raw);
    return [product.sku, product.available];
  }));
  const pending = (plan?.rows || []).filter((row) => row.patch).map((row) => ({ ...row, wasAvailable: before.get(row.sku) === true }));
  const results = new Map();
  let failure = '';
  let calls = 0;
  for (let start = 0; start < pending.length; start += size) {
    const chunk = pending.slice(start, start + size);
    if (failure) {
      for (const row of chunk) results.set(row.sku, { status: 'skipped', message: NOT_TRIED });
      continue;
    }
    let response;
    calls += 1;
    try {
      response = typeof save === 'function' ? await save(chunk.map((row) => row.patch)) : { ok: false };
    } catch (_) {
      response = { ok: false, friendly: 'No hubo respuesta del servidor. No se aplicó ningún cambio de este bloque: volvé a intentar en un momento.' };
    }
    if (response?.ok) {
      const applied = new Map((Array.isArray(response.data) ? response.data : []).map((item) => [String(item?.applied_sku ?? ''), item]));
      for (const row of chunk) results.set(row.sku, describeAppliedRow(row, applied.get(row.sku)));
      continue;
    }
    failure = failureMessage(response);
    const culprit = String(response?.sku || '');
    for (const row of chunk) {
      results.set(row.sku, { status: 'failed', message: row.sku === culprit ? failure : `${NOT_APPLIED_BLOCK}${culprit ? '' : ` ${failure}`}` });
    }
  }
  const rows = (plan?.rows || []).map((row) => ({ ...row, result: results.get(row.sku) && row.patch ? results.get(row.sku) : null }));
  const tally = (status) => rows.filter((row) => row.result?.status === status).length;
  const summary = { applied: tally('applied'), failed: tally('failed'), skipped: tally('skipped'), calls };
  let message;
  if (!pending.length) message = 'No había cambios para aplicar.';
  else if (!failure) message = `${summary.applied} ${summary.applied === 1 ? 'cambio aplicado' : 'cambios aplicados'}.`;
  else if (summary.applied) message = `Se aplicaron ${summary.applied} de ${pending.length} cambios. El resto no se aplicó: ${failure}`;
  else message = `No se aplicó ningún cambio. ${failure}`;
  return { ok: Boolean(pending.length) && !failure, message, summary, rows, publishedChanged: pending.some((row) => row.patch.publish !== undefined || row.patch.price !== undefined || row.patch.stock !== undefined) };
}
