import {
  safeJsonParse,
  safeStorageGet,
  safeStorageRemove,
  safeStorageSet,
} from './storage.js';

export const PRODUCTION_CART_SCHEMA_VERSION = 2;

/*
 * Cuánto sobrevive un carrito que nadie tocó.
 *
 * Setenta y dos horas cubren el caso real —se arma el carrito una noche y se
 * pide al día siguiente, o el viernes y se pide el domingo— sin que un carrito
 * quede latente por meses esperando a alguien que ya no vuelve. Pasado el
 * plazo la clave se borra en la lectura, no se "ignora": un dato vencido que
 * sigue en el disco del cliente es un dato que alguien va a terminar leyendo.
 *
 * El reloj se reinicia cuando el CONTENIDO cambia, no en cada guardado. La
 * aplicación persiste en cada cambio de estado —abrir un filtro, buscar— y si
 * cada uno refrescara la marca de tiempo el vencimiento no llegaría nunca.
 */
export const PRODUCTION_CART_MAX_AGE_MS = 72 * 60 * 60 * 1000;

const MAX_LINES = 100;
const MAX_QUANTITY_PER_LINE = 999;
const SAFE_ID = /^[a-z0-9][a-z0-9:_-]{0,127}$/i;

/**
 * Persistencia deliberadamente mínima para producción.
 *
 * Sólo conserva identificadores de catálogo y cantidades. No admite nombres,
 * teléfono, dirección, notas, precios, pedidos, tokens ni datos del checkout.
 * El catálogo verificado vuelve a validar cada línea antes de mostrarla: acá
 * no se decide si un producto existe, se decide qué forma puede tener el dato.
 */
export function sanitizeProductionCartSnapshot(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    schemaVersion: PRODUCTION_CART_SCHEMA_VERSION,
    cart: sanitizeLines(source.cart, 'productId'),
    comboSelections: sanitizeLines(source.comboSelections, 'comboId'),
  };
}

/**
 * Aplica solamente la mutación hecha por esta pestaña sobre la última
 * instantánea del disco. `local - base` es el delta propio; `remote` contiene
 * lo que otras pestañas alcanzaron a guardar desde que esta pestaña abrió.
 *
 * localStorage es sincrónico: leer, fusionar y escribir no deja un `await` en
 * el medio. No convierte al navegador en una base de datos, pero evita el
 * last-write-wins que borraba una línea ajena con una instantánea vieja.
 */
export function mergeProductionCartMutation(baseValue, localValue, remoteValue) {
  const base = sanitizeProductionCartSnapshot(baseValue);
  const local = sanitizeProductionCartSnapshot(localValue);
  const remote = sanitizeProductionCartSnapshot(remoteValue);
  return {
    schemaVersion: PRODUCTION_CART_SCHEMA_VERSION,
    cart: mergeLineMutation(base.cart, local.cart, remote.cart, 'productId'),
    comboSelections: mergeLineMutation(
      base.comboSelections,
      local.comboSelections,
      remote.comboSelections,
      'comboId',
    ),
  };
}

export function readProductionCart(storage, key, { now = Date.now() } = {}) {
  const raw = safeStorageGet(storage, key);
  if (!raw) return sanitizeProductionCartSnapshot(null);

  const parsed = safeJsonParse(raw, null);
  if (!parsed
    || Number(parsed.schemaVersion) !== PRODUCTION_CART_SCHEMA_VERSION
    || isExpired(parsed.savedAt, now)) {
    // Un esquema viejo, una marca de tiempo ilegible o un carrito vencido no
    // se reinterpretan: se descartan y se borran.
    safeStorageRemove(storage, key);
    return sanitizeProductionCartSnapshot(null);
  }

  const snapshot = sanitizeProductionCartSnapshot(parsed);
  if (!snapshot.cart.length && !snapshot.comboSelections.length) safeStorageRemove(storage, key);
  return snapshot;
}

export function writeProductionCart(storage, key, value, { now = Date.now() } = {}) {
  const snapshot = sanitizeProductionCartSnapshot(value);
  if (!snapshot.cart.length && !snapshot.comboSelections.length) {
    return safeStorageRemove(storage, key);
  }
  return safeStorageSet(storage, key, JSON.stringify({
    ...snapshot,
    savedAt: new Date(keptTimestamp(storage, key, snapshot, now)).toISOString(),
  }));
}

/*
 * La marca de tiempo del guardado anterior sobrevive mientras las líneas sean
 * exactamente las mismas. Cualquier cambio real —agregar, quitar, cambiar una
 * cantidad— reinicia el plazo.
 */
function keptTimestamp(storage, key, snapshot, now) {
  const previous = safeJsonParse(safeStorageGet(storage, key), null);
  if (!previous || Number(previous.schemaVersion) !== PRODUCTION_CART_SCHEMA_VERSION) return now;
  const previousAt = Date.parse(String(previous.savedAt || ''));
  if (!Number.isFinite(previousAt) || isExpired(previous.savedAt, now)) return now;
  const unchanged = JSON.stringify(sanitizeProductionCartSnapshot(previous)) === JSON.stringify(snapshot);
  return unchanged ? previousAt : now;
}

function isExpired(savedAt, now) {
  const timestamp = Date.parse(String(savedAt || ''));
  if (!Number.isFinite(timestamp)) return true;
  // Un reloj adelantado y devuelto a hora deja marcas en el futuro. Se aceptan
  // dentro del mismo plazo en vez de tirar el carrito de alguien que sólo tenía
  // la hora mal puesta.
  return Math.abs(now - timestamp) > PRODUCTION_CART_MAX_AGE_MS;
}

function sanitizeLines(lines, idField) {
  if (!Array.isArray(lines)) return [];
  const quantities = new Map();

  for (const line of lines.slice(0, MAX_LINES * 2)) {
    const id = String(line?.[idField] || '').trim();
    if (!SAFE_ID.test(id)) continue;
    const quantity = Math.floor(Number(line?.quantity));
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    const current = quantities.get(id) || 0;
    quantities.set(id, Math.min(MAX_QUANTITY_PER_LINE, current + quantity));
    if (quantities.size >= MAX_LINES) break;
  }

  return [...quantities.entries()].map(([id, quantity]) => ({ [idField]: id, quantity }));
}

function mergeLineMutation(baseLines, localLines, remoteLines, idField) {
  const quantities = (lines) => new Map(lines.map((line) => [line[idField], line.quantity]));
  const base = quantities(baseLines);
  const local = quantities(localLines);
  const remote = quantities(remoteLines);
  const orderedIds = [...new Set([
    ...remote.keys(),
    ...local.keys(),
    ...base.keys(),
  ])];
  const merged = [];

  for (const id of orderedIds) {
    const before = base.get(id) || 0;
    const mine = local.get(id) || 0;
    const theirs = remote.get(id) || 0;
    const quantity = mine === before
      ? theirs
      : Math.max(0, Math.min(MAX_QUANTITY_PER_LINE, theirs + mine - before));
    if (quantity > 0) merged.push({ [idField]: id, quantity });
    if (merged.length >= MAX_LINES) break;
  }
  return merged;
}
