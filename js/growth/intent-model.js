// ─────────────────────────────────────────────────────────────────────────────
// Growth engine · MODELO DE INTENCIÓN.
// -----------------------------------------------------------------------------
// Perfil compacto y determinista del interés del cliente. No guarda eventos:
// guarda, por categoría/marca/producto, un score con decay exponencial y la
// última vez que se tocó. Eso es todo lo que el ranking necesita y todo lo que
// se persiste — privacidad por diseño: `cervezas: 12` en lugar de una bitácora
// de 500 gestos.
//
// Es una HOJA: sin imports de state/ui/storage. Todas las funciones reciben el
// reloj (`now` en ms) y devuelven estructuras nuevas; ningún Date.now() ni
// Math.random() adentro. Los tests fijan el reloj y obtienen siempre lo mismo.
//
// La matemática del decay es la del "decayed sum": en vez de recalcular todo
// el historial, cada entrada guarda su score YA decaído a `t`. Para leer se
// decae de `t` a `now`; para sumar se decae y después se suma. O(1) por señal.
import {
  AFFINITY_NORM_PIVOT,
  INTENT_MAX_KEYS,
  INTENT_PRUNE_EPSILON,
  INTENT_SCHEMA_VERSION,
  INTENT_SCORE_CAP,
  SIGNAL_WEIGHTS,
} from './growth-config.js';

export const SIGNAL_TYPES = Object.freeze(Object.keys(SIGNAL_WEIGHTS));

export function emptyIntentState() {
  return {
    v: INTENT_SCHEMA_VERSION,
    categories: {},
    brands: {},
    products: {},
  };
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function cleanKey(value, maxLength = 80) {
  const key = String(value ?? '').trim().toLowerCase();
  return key && key.length <= maxLength ? key : '';
}

function normalizeEntry(raw) {
  if (!isPlainObject(raw)) return null;
  const score = Number(raw.s);
  const at = Number(raw.t);
  if (!Number.isFinite(score) || !Number.isFinite(at)) return null;
  if (score <= 0 || at <= 0) return null;
  return { s: Math.min(score, INTENT_SCORE_CAP), t: at };
}

function normalizeBucket(raw, maxKeys) {
  const bucket = {};
  if (!isPlainObject(raw)) return bucket;
  for (const [key, value] of Object.entries(raw)) {
    const cleaned = cleanKey(key);
    const entry = normalizeEntry(value);
    if (!cleaned || !entry) continue;
    bucket[cleaned] = entry;
    if (Object.keys(bucket).length >= maxKeys) break;
  }
  return bucket;
}

/**
 * Valida un perfil leído de storage. Cualquier cosa que no sea exactamente el
 * esquema esperado devuelve el perfil vacío: un JSON corrupto, de otra versión
 * o manipulado jamás llega al ranking (fail-safe del estado local).
 */
export function normalizeIntentState(raw) {
  if (!isPlainObject(raw) || raw.v !== INTENT_SCHEMA_VERSION) return emptyIntentState();
  return {
    v: INTENT_SCHEMA_VERSION,
    categories: normalizeBucket(raw.categories, INTENT_MAX_KEYS.categories),
    brands: normalizeBucket(raw.brands, INTENT_MAX_KEYS.brands),
    products: normalizeBucket(raw.products, INTENT_MAX_KEYS.products),
  };
}

/** Score efectivo de una entrada a tiempo `now`. */
export function decayedScore(entry, now, halfLifeMs) {
  if (!entry) return 0;
  const dt = Number(now) - Number(entry.t);
  if (!Number.isFinite(dt)) return 0;
  if (dt <= 0) return entry.s;
  return entry.s * (0.5 ** (dt / halfLifeMs));
}

function bumpEntry(entry, weight, now, halfLifeMs) {
  const current = decayedScore(entry, now, halfLifeMs);
  const next = Math.min(INTENT_SCORE_CAP, Math.max(0, current + weight));
  return next > 0 ? { s: next, t: now } : null;
}

function bumpBucket(bucket, key, weight, now, halfLifeMs) {
  const cleaned = cleanKey(key);
  if (!cleaned || !weight) return bucket;
  const next = { ...bucket };
  const bumped = bumpEntry(next[cleaned], weight, now, halfLifeMs);
  if (bumped) next[cleaned] = bumped;
  else delete next[cleaned];
  return next;
}

/**
 * Señal → nuevo estado. La señal declara sus destinos explícitos; el modelo no
 * adivina taxonomía (eso es del adaptador de catálogo, que sabe qué categoría
 * tiene cada producto).
 *
 *   { type: 'product_view', categoryId: 'cervezas', brand: 'heineken',
 *     productId: 'heineken-original-lata-473ml' }
 *
 * `weightMultiplier` existe para señales atenuadas (p. ej. cada categoría
 * extra que matchea una búsqueda amplia pesa menos que la primera).
 */
export function applySignal(state, signal, now, halfLifeMs, { weightMultiplier = 1 } = {}) {
  const base = normalizeIntentState(state);
  if (!isPlainObject(signal)) return base;
  const weight = (SIGNAL_WEIGHTS[signal.type] || 0) * weightMultiplier;
  if (!weight || !Number.isFinite(Number(now))) return base;

  let next = base;
  if (signal.categoryId) {
    next = { ...next, categories: bumpBucket(next.categories, signal.categoryId, weight, now, halfLifeMs) };
  }
  if (signal.brand) {
    next = { ...next, brands: bumpBucket(next.brands, signal.brand, weight, now, halfLifeMs) };
  }
  if (signal.productId) {
    next = { ...next, products: bumpBucket(next.products, signal.productId, weight, now, halfLifeMs) };
  }
  return next;
}

function topEntries(bucket, now, halfLifeMs, maxKeys) {
  return Object.entries(bucket)
    .map(([key, entry]) => [key, decayedScore(entry, now, halfLifeMs), entry])
    .filter(([, score]) => score >= INTENT_PRUNE_EPSILON)
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, maxKeys);
}

/**
 * Poda para persistir: conserva las claves de mayor score efectivo dentro de
 * la cota y descarta lo que ya no puede influir. Se llama al guardar, así el
 * storage queda acotado sin que ninguna lectura pague el costo.
 */
export function pruneIntentState(state, now, halfLifeMs) {
  const base = normalizeIntentState(state);
  const prune = (bucket, maxKeys) => Object.fromEntries(
    topEntries(bucket, now, halfLifeMs, maxKeys).map(([key, , entry]) => [key, entry]),
  );
  return {
    v: INTENT_SCHEMA_VERSION,
    categories: prune(base.categories, INTENT_MAX_KEYS.categories),
    brands: prune(base.brands, INTENT_MAX_KEYS.brands),
    products: prune(base.products, INTENT_MAX_KEYS.products),
  };
}

function mergeScores(target, bucket, now, halfLifeMs, multiplier) {
  for (const [key, entry] of Object.entries(bucket)) {
    const score = decayedScore(entry, now, halfLifeMs) * multiplier;
    if (score < INTENT_PRUNE_EPSILON) continue;
    target[key] = (target[key] || 0) + score;
  }
  return target;
}

/**
 * Afinidades combinadas (largo plazo + sesión) en scores CRUDOS. La sesión
 * multiplica por `sessionMultiplier`: lo que la persona hace ahora manda.
 */
export function combinedAffinity({
  longTerm,
  session,
  now,
  longHalfLifeMs,
  sessionHalfLifeMs,
  sessionMultiplier,
}) {
  const safeLong = normalizeIntentState(longTerm);
  const safeSession = normalizeIntentState(session);
  const combine = (key) => mergeScores(
    mergeScores({}, safeLong[key], now, longHalfLifeMs, 1),
    safeSession[key],
    now,
    sessionHalfLifeMs,
    sessionMultiplier,
  );
  return {
    categories: combine('categories'),
    brands: combine('brands'),
    products: combine('products'),
  };
}

/**
 * Normalización 0..1 con saturación suave. score/(score+PIVOT): los primeros
 * gestos mueven mucho la aguja, la acumulación infinita no la clava en 1.
 */
export function normalizedAffinity(score, pivot = AFFINITY_NORM_PIVOT) {
  const value = Number(score);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value / (value + pivot);
}

/** ¿El perfil combinado está efectivamente vacío? (cold start) */
export function isColdStart(affinity) {
  if (!isPlainObject(affinity)) return true;
  return ['categories', 'brands', 'products'].every((key) => (
    !isPlainObject(affinity[key]) || Object.keys(affinity[key]).length === 0
  ));
}
