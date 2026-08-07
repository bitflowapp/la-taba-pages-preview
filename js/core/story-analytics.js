// ─────────────────────────────────────────────────────────────────────────────
// Analítica de historias · CONTADORES, sin una sola persona adentro.
// -----------------------------------------------------------------------------
// Qué se guarda: seis contadores por historia. Nada más.
// Qué NO se guarda, y no por olvido: identificador de persona, de sesión o de
// dispositivo; dirección; teléfono; carrito; pedido; user agent; IP; y ninguna
// marca de tiempo por evento. Un contador no distingue a nadie; una secuencia
// de timestamps sí, así que no existe. El único dato temporal es el DÍA en que
// el almacén empezó a contar, a nivel colección, para que el Panel pueda decir
// "desde cuándo" sin poder reconstruir el recorrido de una persona.
//
// Los seis eventos son exactamente los seis pasos que la superficie puede
// observar por sí sola:
//
//   impression    la historia se mostró en el visor
//   open          alguien abrió el visor
//   advance       pasó de una historia a la siguiente
//   cta           tocó el botón de la historia
//   product_open  la CTA abrió la ficha de un producto o de un combo
//   add_to_cart   la CTA agregó el producto al carrito
//
// Lo que NO se mide, y por eso no se nombra: la COMPRA. El pedido lo cierra el
// backend y no vuelve marcado con la historia que lo originó. Llamar
// "conversión" a `add_to_cart` sería ponerle nombre de venta a un agregado al
// carrito. El Panel dice "agregado al carrito" y ahí termina la cadena medible.
//
// HOJA pura sobre `storage.js`: sin DOM, sin red, sin state.
import { getStorageArea, safeJsonParse, safeStorageGet, safeStorageSet } from './storage.js';

export const STORY_METRICS_STORAGE_KEY = 'la_taba_story_metrics_v1';
export const STORY_METRICS_VERSION = 1;

export const STORY_EVENTS = Object.freeze([
  'impression',
  'open',
  'advance',
  'cta',
  'product_open',
  'add_to_cart',
]);

export const STORY_EVENT_LABELS = Object.freeze({
  impression: 'Impresiones',
  open: 'Aperturas',
  advance: 'Avances',
  cta: 'Toques en la CTA',
  product_open: 'Destino abierto',
  add_to_cart: 'Agregado al carrito',
});

const EVENT_SET = new Set(STORY_EVENTS);

// Cota dura: el almacén no puede crecer sin límite en un espacio que el
// navegador puede desalojar entero. Al pasarse, se descartan las historias con
// menos actividad, no las más viejas: perder el registro de la historia que
// nadie miró cuesta menos que perder el de la que se está midiendo.
const MAX_TRACKED_STORIES = 300;

function emptyCounters() {
  return STORY_EVENTS.reduce((counters, event) => ({ ...counters, [event]: 0 }), {});
}

function count(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

function storyId(value) {
  const clean = String(value ?? '').trim();
  return clean.length > 0 && clean.length <= 80 ? clean : '';
}

// Día en formato ISO corto, en UTC. No lleva hora: no hace falta y una hora
// local es un dato más del que se puede prescindir.
function today(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function normalizeStoryCounters(raw) {
  const counters = emptyCounters();
  if (!raw || typeof raw !== 'object') return counters;
  for (const event of STORY_EVENTS) counters[event] = count(raw[event]);
  return counters;
}

/** Lee el almacén completo. Un JSON roto devuelve un almacén vacío, no rompe. */
export function readStoryMetrics(storage = getStorageArea('localStorage')) {
  const parsed = safeJsonParse(safeStorageGet(storage, STORY_METRICS_STORAGE_KEY), null);
  const stories = parsed && typeof parsed === 'object' && parsed.stories && typeof parsed.stories === 'object'
    ? parsed.stories
    : {};
  const normalized = {};
  for (const [id, counters] of Object.entries(stories)) {
    const clean = storyId(id);
    if (clean) normalized[clean] = normalizeStoryCounters(counters);
  }
  return {
    version: STORY_METRICS_VERSION,
    since: typeof parsed?.since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.since) ? parsed.since : '',
    stories: normalized,
  };
}

function totalActivity(counters) {
  return STORY_EVENTS.reduce((total, event) => total + count(counters[event]), 0);
}

function writeStoryMetrics(metrics, storage) {
  const entries = Object.entries(metrics.stories);
  const bounded = entries.length <= MAX_TRACKED_STORIES
    ? entries
    : entries
      .sort((a, b) => totalActivity(b[1]) - totalActivity(a[1]))
      .slice(0, MAX_TRACKED_STORIES);
  return safeStorageSet(storage, STORY_METRICS_STORAGE_KEY, JSON.stringify({
    version: STORY_METRICS_VERSION,
    since: metrics.since,
    stories: Object.fromEntries(bounded),
  }));
}

/**
 * Suma uno a un contador. Un evento desconocido o un id vacío no escriben nada:
 * el almacén no se ensucia con nombres que el Panel después no sabe mostrar.
 */
export function recordStoryEvent(id, event, {
  storage = getStorageArea('localStorage'),
  now = Date.now(),
} = {}) {
  const clean = storyId(id);
  if (!clean || !EVENT_SET.has(event)) return false;
  const metrics = readStoryMetrics(storage);
  const counters = metrics.stories[clean] || emptyCounters();
  counters[event] = count(counters[event]) + 1;
  metrics.stories[clean] = counters;
  if (!metrics.since) metrics.since = today(now);
  return writeStoryMetrics(metrics, storage);
}

/** Contadores de UNA historia, siempre con las seis claves presentes. */
export function storyMetricsFor(id, storage = getStorageArea('localStorage')) {
  return readStoryMetrics(storage).stories[storyId(id)] || emptyCounters();
}

/**
 * Totales del canal. `stories` es cuántas historias registraron actividad, no
 * cuántas existen: una historia que nadie vio no infla el denominador.
 */
export function summarizeStoryMetrics(storage = getStorageArea('localStorage')) {
  const metrics = readStoryMetrics(storage);
  const totals = emptyCounters();
  let stories = 0;
  for (const counters of Object.values(metrics.stories)) {
    if (totalActivity(counters) > 0) stories += 1;
    for (const event of STORY_EVENTS) totals[event] += count(counters[event]);
  }
  return { ...totals, stories, since: metrics.since };
}

/** Borra el registro de una historia. Se llama al eliminarla desde el Panel. */
export function forgetStoryMetrics(id, storage = getStorageArea('localStorage')) {
  const clean = storyId(id);
  if (!clean) return false;
  const metrics = readStoryMetrics(storage);
  if (!(clean in metrics.stories)) return false;
  delete metrics.stories[clean];
  return writeStoryMetrics(metrics, storage);
}

/**
 * Contador de impresiones por apertura del visor.
 *
 * Una impresión es "la historia se mostró", no "el visor se volvió a pintar".
 * El visor se repinta al avanzar, al cerrar un menú o al cambiar el catálogo, y
 * contar cada repintado inflaría el número hasta volverlo inútil. Este colador
 * vive mientras el visor está abierto y se descarta al cerrarlo: entrar de
 * nuevo vuelve a contar, que es lo que significa una impresión nueva.
 */
export function createImpressionGate() {
  const counted = new Set();
  return {
    shouldCount(id) {
      const clean = storyId(id);
      if (!clean || counted.has(clean)) return false;
      counted.add(clean);
      return true;
    },
    reset() {
      counted.clear();
    },
  };
}
