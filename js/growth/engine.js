// ─────────────────────────────────────────────────────────────────────────────
// Growth engine · FACHADA.
// -----------------------------------------------------------------------------
// Une los módulos puros (intención, elegibilidad, ranking, exposición) con la
// persistencia local y expone la API que consumen el bridge de señales y los
// placements de la UI.
//
// Contratos de esta fachada:
//   · FAIL-SAFE TOTAL: ninguna función pública puede tirar. Si algo revienta,
//     devuelve el valor neutro (lista vacía, null) y la tienda sigue como si
//     el motor no existiera. La personalización es un extra, no una columna.
//   · RELOJ ÚNICO: el reloj es inyectable (`configureGrowthEngine({ now })`).
//     Producción usa Date.now; los tests fijan el tiempo.
//   · PRIVACIDAD: persiste agregados compactos (score+timestamp por clave) y
//     contadores de exposición. Nada de PII, nada de bitácoras de gestos.
//     Claves propias, versionadas, con variante showcase aislada, igual que
//     STORAGE_KEYS de config.js.
//   · ESTABILIDAD DE RENDER: las selecciones se memoizan por "época de vista"
//     (renderEpoch). Tocar el carrito re-renderiza la home, pero NO puede
//     reordenar la vidriera bajo el dedo: la selección sólo cambia al volver
//     a entrar a la vista o ante señales nuevas.
import {
  GROWTH_SHOWCASE_STORAGE_KEYS,
  GROWTH_STORAGE_KEYS,
  LONG_TERM_HALF_LIFE_MS,
  SESSION_BLEND_MULTIPLIER,
  SESSION_HALF_LIFE_MS,
} from './growth-config.js';
import {
  applySignal,
  combinedAffinity,
  emptyIntentState,
  isColdStart,
  normalizeIntentState,
  pruneIntentState,
} from './intent-model.js';
import {
  emptyExposureState,
  normalizeExposureState,
  recordClick,
  recordDismissal,
  recordImpression,
} from './exposure-store.js';
import { eligibleCampaigns } from './campaign-eligibility.js';
import { rankCampaigns } from './ranking.js';
import { trackGrowthEvent } from './analytics.js';
import {
  getStorageArea,
  safeJsonParse,
  safeStorageGet,
  safeStorageRemove,
  safeStorageSet,
} from '../core/storage.js';
import { isShowcaseMode } from '../core/showcase-mode.js';

let clock = () => Date.now();
let storageKeys = null;

// Caches en memoria: el estado persistido se lee una vez y se mantiene acá;
// cada mutación escribe de vuelta. Si el storage está bloqueado, el motor
// funciona igual en memoria durante la sesión.
let longTermCache = null;
let sessionCache = null;
let exposureCache = null;

// Memo de selecciones por (placement + huella de entradas).
let selectionMemo = new Map();
let renderEpoch = 0;

function keys() {
  if (!storageKeys) {
    storageKeys = isShowcaseMode() ? GROWTH_SHOWCASE_STORAGE_KEYS : GROWTH_STORAGE_KEYS;
  }
  return storageKeys;
}

export function configureGrowthEngine({ now } = {}) {
  if (typeof now === 'function') clock = now;
}

export function growthNow() {
  try {
    const value = Number(clock());
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch (_) {
    return 0;
  }
}

function readStore(area, key, normalize, empty) {
  const raw = safeStorageGet(getStorageArea(area), key);
  if (raw === null) return empty();
  const parsed = safeJsonParse(raw, null);
  const normalized = normalize(parsed);
  // Estado ilegible → se descarta el registro para no re-parsear basura en
  // cada arranque. El motor arranca frío, la tienda ni se entera.
  if (parsed !== null && JSON.stringify(normalized) !== JSON.stringify(parsed)) {
    safeStorageRemove(getStorageArea(area), key);
  }
  return normalized;
}

function longTermState() {
  if (!longTermCache) {
    longTermCache = readStore('localStorage', keys().longTermIntent, normalizeIntentState, emptyIntentState);
  }
  return longTermCache;
}

function sessionState() {
  if (!sessionCache) {
    sessionCache = readStore('sessionStorage', keys().sessionIntent, normalizeIntentState, emptyIntentState);
  }
  return sessionCache;
}

function exposureState() {
  if (!exposureCache) {
    exposureCache = readStore('localStorage', keys().exposure, normalizeExposureState, emptyExposureState);
  }
  return exposureCache;
}

function persistLongTerm(now) {
  longTermCache = pruneIntentState(longTermCache, now, LONG_TERM_HALF_LIFE_MS);
  safeStorageSet(getStorageArea('localStorage'), keys().longTermIntent, JSON.stringify(longTermCache));
}

function persistSession(now) {
  sessionCache = pruneIntentState(sessionCache, now, SESSION_HALF_LIFE_MS);
  safeStorageSet(getStorageArea('sessionStorage'), keys().sessionIntent, JSON.stringify(sessionCache));
}

function persistExposure() {
  exposureCache = normalizeExposureState(exposureCache);
  safeStorageSet(getStorageArea('localStorage'), keys().exposure, JSON.stringify(exposureCache));
}

/**
 * Registra una señal de intención. `signal`:
 *   { type, categoryId?, brand?, productId?, weightMultiplier? }
 * Escribe en los DOS stores (largo plazo y sesión) e invalida el memo de
 * selección: una señal nueva sí puede cambiar la próxima vidriera.
 */
export function recordGrowthSignal(signal) {
  try {
    const now = growthNow();
    if (!now) return;
    const options = { weightMultiplier: Number(signal?.weightMultiplier) || 1 };
    longTermCache = applySignal(longTermState(), signal, now, LONG_TERM_HALF_LIFE_MS, options);
    sessionCache = applySignal(sessionState(), signal, now, SESSION_HALF_LIFE_MS, options);
    persistLongTerm(now);
    persistSession(now);
    // A propósito NO se invalida el memo de selección: una señal emitida
    // mientras la vidriera está en pantalla (agregar al carrito desde la
    // home) no puede reordenar las piezas bajo el dedo. La intención nueva
    // manda en la PRÓXIMA época (próxima entrada a la vista).
  } catch (_) {
    // Señal perdida ≠ tienda rota.
  }
}

/** Afinidades combinadas (largo plazo + sesión·multiplicador), scores crudos. */
export function getGrowthAffinity() {
  try {
    const now = growthNow();
    return combinedAffinity({
      longTerm: longTermState(),
      session: sessionState(),
      now,
      longHalfLifeMs: LONG_TERM_HALF_LIFE_MS,
      sessionHalfLifeMs: SESSION_HALF_LIFE_MS,
      sessionMultiplier: SESSION_BLEND_MULTIPLIER,
    });
  } catch (_) {
    return { categories: {}, brands: {}, products: {} };
  }
}

export function isGrowthColdStart() {
  try {
    return isColdStart(getGrowthAffinity());
  } catch (_) {
    return true;
  }
}

/**
 * Nueva época de render: se llama al ENTRAR a una vista (home/catálogo). Todo
 * lo seleccionado durante la época anterior queda invalidado; dentro de una
 * misma época las selecciones son estables aunque la vista se re-renderice
 * veinte veces por toques del carrito.
 */
export function bumpGrowthRenderEpoch() {
  renderEpoch += 1;
  selectionMemo = new Map();
  return renderEpoch;
}

export function getGrowthRenderEpoch() {
  return renderEpoch;
}

// La clave del memo NO incluye el carrito ni la afinidad: dentro de una
// época, la primera selección de cada superficie es LA selección. Cambia el
// set de campañas elegibles (catálogo/stock en vivo) o cambia la época, y
// recién ahí se recalcula.
function memoKey(placement, { campaigns, slots }) {
  const ids = campaigns.map((campaign) => campaign.id).join('|');
  return `${renderEpoch}#${placement}#${slots}#${ids}`;
}

/**
 * Selección para un placement. Entradas vivas (campañas + vista de catálogo +
 * promociones + carrito) las arma el llamador; acá se filtra elegibilidad,
 * se rankea con la intención actual y se memoiza por época.
 *
 * Devuelve SIEMPRE un array (vacío si no hay nada digno): el fallback visual
 * es responsabilidad del placement, que sabe qué mostraba antes del motor.
 */
export function selectGrowthCampaigns({
  placement,
  campaigns = [],
  catalogView,
  promotions = [],
  cartCategoryIds = [],
  slots = 1,
} = {}) {
  try {
    const now = growthNow();
    const eligible = eligibleCampaigns({ campaigns, placement, catalogView, promotions, now });
    if (!eligible.length) return [];
    const key = memoKey(placement, { campaigns: eligible, slots });
    if (selectionMemo.has(key)) return selectionMemo.get(key);
    const ranked = rankCampaigns({
      campaigns: eligible,
      affinity: getGrowthAffinity(),
      cartCategoryIds,
      exposure: exposureState(),
      now,
      slots,
    });
    selectionMemo.set(key, ranked);
    return ranked;
  } catch (_) {
    return [];
  }
}

// ── Exposición + eventos ─────────────────────────────────────────────────────
// La impresión se registra cuando la pieza estuvo realmente EN PANTALLA (el
// bridge usa IntersectionObserver); resta prioridad futura. El click suma a
// favor y alimenta la intención de la categoría destino.

const impressionsThisEpoch = new Set();

export function recordCampaignImpression(campaign, placement) {
  try {
    if (!campaign?.id) return;
    // Una impresión por pieza por época de vista: re-renders no inflan.
    const dedupeKey = `${renderEpoch}#${placement}#${campaign.id}`;
    if (impressionsThisEpoch.has(dedupeKey)) return;
    impressionsThisEpoch.add(dedupeKey);
    if (impressionsThisEpoch.size > 400) impressionsThisEpoch.clear();
    const now = growthNow();
    exposureCache = recordImpression(exposureState(), campaign.id, now);
    persistExposure();
    trackGrowthEvent('promo_impression', {
      campaignId: campaign.id,
      placement,
      categoryId: campaign.categoryIds?.[0] || '',
    }, now);
  } catch (_) { /* nunca romper */ }
}

export function recordCampaignClick(campaign, placement) {
  try {
    if (!campaign?.id) return;
    const now = growthNow();
    exposureCache = recordClick(exposureState(), campaign.id, now);
    persistExposure();
    trackGrowthEvent('promo_click', {
      campaignId: campaign.id,
      placement,
      categoryId: campaign.categoryIds?.[0] || '',
    }, now);
    recordGrowthSignal({
      type: 'promo_click',
      categoryId: campaign.categoryIds?.[0] || '',
      brand: campaign.brand || '',
    });
  } catch (_) { /* nunca romper */ }
}

export function recordCampaignDismissal(campaign, placement) {
  try {
    if (!campaign?.id) return;
    const now = growthNow();
    exposureCache = recordDismissal(exposureState(), campaign.id, now);
    persistExposure();
    trackGrowthEvent('promo_dismiss', { campaignId: campaign.id, placement }, now);
    recordGrowthSignal({
      type: 'promo_dismiss',
      categoryId: campaign.categoryIds?.[0] || '',
    });
  } catch (_) { /* nunca romper */ }
}

// ── Utilidades de harness/tests ──────────────────────────────────────────────

export function getGrowthExposureSnapshot() {
  try {
    return normalizeExposureState(exposureState());
  } catch (_) {
    return emptyExposureState();
  }
}

export function resetGrowthEngineForTests({ clearStorage = true } = {}) {
  longTermCache = null;
  sessionCache = null;
  exposureCache = null;
  selectionMemo = new Map();
  impressionsThisEpoch.clear();
  renderEpoch = 0;
  clock = () => Date.now();
  storageKeys = null;
  if (clearStorage) {
    for (const area of ['localStorage', 'sessionStorage']) {
      for (const key of Object.values(GROWTH_STORAGE_KEYS)) {
        safeStorageRemove(getStorageArea(area), key);
      }
      for (const key of Object.values(GROWTH_SHOWCASE_STORAGE_KEYS)) {
        safeStorageRemove(getStorageArea(area), key);
      }
    }
  }
}

/**
 * Siembra directa de intención para el harness de personas (demo). No forma
 * parte del flujo productivo: la usa el modo debug para demostrar Persona A
 * (fría), B (cervecera) y C (carrito de fernet) sin fabricar navegación.
 */
export function seedGrowthIntentForDemo(signals = []) {
  for (const signal of Array.isArray(signals) ? signals : []) {
    recordGrowthSignal(signal);
  }
}
