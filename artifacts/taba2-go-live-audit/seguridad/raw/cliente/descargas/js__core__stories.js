// ─────────────────────────────────────────────────────────────────────────────
// Historias comerciales · CONTRATO DE UI, sin backend.
// -----------------------------------------------------------------------------
// Esta tarea es visual: no crea tablas, migraciones ni Edge Functions. Lo que
// sí crea es el contrato que la home consume, de modo que el día que exista un
// origen real sólo haya que llenarlo.
//
// Regla única del módulo: FAIL-CLOSED. Si falta el origen, si un registro no
// está publicado, si venció, si todavía no empezó o si su medio no es válido,
// la historia NO existe para la interfaz. Sin historias no hay aro activo, no
// hay CTA y el logo deja de ser un botón: vuelve a ser una imagen.
//
// Contrato del registro (el mismo que deberá exponer el backend):
//   id, business_id, title, media_type, media_url, thumbnail_url,
//   starts_at, expires_at, priority, cta_type, cta_target, is_highlight,
//   published
//
// El módulo es una HOJA: sólo depende de storage.js y showcase-mode.js. No
// importa state.js ni ui.js, así que puede testearse sin DOM.
import { getStorageArea, safeJsonParse, safeStorageGet, safeStorageSet } from './storage.js';
import { isShowcaseMode } from './showcase-mode.js';

export const STORIES_SEEN_STORAGE_KEY = 'la_taba_stories_seen_v1';
export const STORIES_SEEN_SHOWCASE_KEY = 'la_taba_showcase_stories_seen_v1';

// Medios admitidos. Cualquier otro valor descarta el registro: no se renderiza
// un medio que la superficie no sabe presentar.
export const STORY_MEDIA_TYPES = Object.freeze(['image', 'video']);

// CTA admitidas. Deliberadamente NO incluye acciones sociales ("enviar
// mensaje", "responder"): la historia es una vidriera comercial, no un chat.
// Cada una se resuelve contra una acción que YA existe en el storefront.
export const STORY_CTA_TYPES = Object.freeze({
  product: { label: 'Ver producto', action: 'product' },
  offer: { label: 'Ver oferta', action: 'product' },
  category: { label: 'Ver categoría', action: 'category' },
  add_to_cart: { label: 'Agregar al carrito', action: 'add' },
});

// Esquemas que jamás pueden entrar en un `src` ni en un destino de CTA.
const UNSAFE_URL = /^\s*(?:javascript|data|vbscript|file)\s*:/i;

function text(value, maxLength = 160) {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > maxLength ? clean.slice(0, maxLength) : clean;
}

function safeUrl(value) {
  const clean = String(value ?? '').trim();
  if (!clean || UNSAFE_URL.test(clean)) return '';
  return clean;
}

function timestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

// Una CTA sin destino resoluble NO se conserva: un botón que no lleva a ningún
// lado es exactamente el "link muerto" que el diseño prohíbe.
function normalizeCta(raw) {
  const type = text(raw?.cta_type ?? raw?.ctaType, 32);
  const definition = STORY_CTA_TYPES[type];
  if (!definition) return null;
  const target = safeUrl(raw?.cta_target ?? raw?.ctaTarget);
  if (!target) return null;
  return { type, action: definition.action, label: definition.label, target };
}

/**
 * Normaliza un registro crudo. Devuelve `null` cuando el registro no puede
 * presentarse con honestidad.
 */
export function normalizeStory(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.published !== true) return null;

  const id = text(raw.id, 80);
  const mediaType = text(raw.media_type ?? raw.mediaType, 16).toLowerCase();
  const mediaUrl = safeUrl(raw.media_url ?? raw.mediaUrl);
  if (!id || !mediaUrl || !STORY_MEDIA_TYPES.includes(mediaType)) return null;

  return {
    id,
    businessId: text(raw.business_id ?? raw.businessId, 80),
    title: text(raw.title, 120),
    mediaType,
    mediaUrl,
    thumbnailUrl: safeUrl(raw.thumbnail_url ?? raw.thumbnailUrl) || mediaUrl,
    startsAt: timestamp(raw.starts_at ?? raw.startsAt),
    expiresAt: timestamp(raw.expires_at ?? raw.expiresAt),
    priority: integer(raw.priority, 0),
    isHighlight: (raw.is_highlight ?? raw.isHighlight) === true,
    cta: normalizeCta(raw),
  };
}

/**
 * Historias vigentes, ordenadas para el visor.
 * Orden: destacadas primero, luego mayor prioridad, luego la que empezó antes.
 */
export function publishedStories(rawList, { now = Date.now() } = {}) {
  if (!Array.isArray(rawList)) return [];
  return rawList
    .map(normalizeStory)
    .filter(Boolean)
    .filter((story) => (story.startsAt === null || story.startsAt <= now))
    .filter((story) => (story.expiresAt === null || story.expiresAt > now))
    .sort((a, b) => (
      Number(b.isHighlight) - Number(a.isHighlight)
      || b.priority - a.priority
      || (a.startsAt ?? 0) - (b.startsAt ?? 0)
    ));
}

/**
 * Estado de la entrada del logo. Es lo único que la home necesita para decidir
 * si el logo es un botón, si el aro se anima y qué dice el acceso.
 */
export function storyEntryState(stories, seenIds = []) {
  const list = Array.isArray(stories) ? stories : [];
  const seen = seenIds instanceof Set ? seenIds : new Set(seenIds || []);
  const unseen = list.filter((story) => !seen.has(story.id));
  if (!list.length) {
    return { state: 'empty', available: false, total: 0, unseen: 0, thumbnail: '', firstId: '' };
  }
  return {
    state: unseen.length ? 'unseen' : 'seen',
    available: true,
    total: list.length,
    unseen: unseen.length,
    thumbnail: (unseen[0] || list[0]).thumbnailUrl,
    firstId: (unseen[0] || list[0]).id,
  };
}

function seenStorageKey() {
  return isShowcaseMode() ? STORIES_SEEN_SHOWCASE_KEY : STORIES_SEEN_STORAGE_KEY;
}

export function readSeenStoryIds(storage = getStorageArea('localStorage')) {
  const parsed = safeJsonParse(safeStorageGet(storage, seenStorageKey()), []);
  return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []);
}

export function markStorySeen(id, storage = getStorageArea('localStorage')) {
  const storyId = text(id, 80);
  if (!storyId) return readSeenStoryIds(storage);
  const seen = readSeenStoryIds(storage);
  seen.add(storyId);
  // Cota dura: el registro de vistas no puede crecer sin límite en un
  // almacenamiento que el navegador puede desalojar.
  const bounded = [...seen].slice(-200);
  safeStorageSet(storage, seenStorageKey(), JSON.stringify(bounded));
  return new Set(bounded);
}

/**
 * Origen de datos. Hoy tiene UNA fuente productiva —el global que deberá
 * publicar el backend— y fixtures que sólo viven en el modo preview explícito
 * (`?showcase=1`). En runtime productivo, sin global, devuelve lista vacía.
 */
export function readStoriesSource({
  scope = globalThis,
  showcase = isShowcaseMode(),
  fixtures = null,
} = {}) {
  const injected = scope?.TABA2_STORIES;
  if (Array.isArray(injected)) return injected;
  if (showcase && Array.isArray(fixtures)) return fixtures;
  return [];
}
