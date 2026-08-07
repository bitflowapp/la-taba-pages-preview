// ─────────────────────────────────────────────────────────────────────────────
// Historias comerciales · CONTRATO ÚNICO del canal.
// -----------------------------------------------------------------------------
// Las historias dejaron de ser una vidriera decorativa: son el canal por el que
// el local anuncia promociones, productos, combos y novedades, y se administran
// desde el Panel (Marketing → Historias). Este módulo fija el contrato que
// comparten las tres puntas —el Panel que escribe, el almacén que persiste y la
// home que muestra— para que ninguna pueda inventar una regla propia.
//
// Regla única del módulo: FAIL-CLOSED. Si falta el origen, si la historia está
// apagada, si venció, si todavía no empezó o si su medio no es válido, la
// historia NO existe para la interfaz. Sin historias no hay aro activo, no hay
// CTA y el logo deja de ser un botón: vuelve a ser una imagen.
//
// Contrato del registro (el mismo que deberá exponer el backend cuando exista
// la tabla; ver STORIES-COMMERCIAL-HANDOFF.md §3):
//   id, business_id, title, body, media_type, media_url, thumbnail_url,
//   starts_at, expires_at, sort_order, cta_type, cta_target, age_restricted,
//   enabled
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

// Los cuatro estados que ve el Panel. Son DERIVADOS: no se guardan en el
// registro, se calculan contra el reloj cada vez que se pregunta. Un estado
// guardado envejece en silencio —una historia "ACTIVA" en la base que venció
// hace tres días— y eso es exactamente lo que hace que una historia vencida no
// desaparezca sola.
export const STORY_STATUS = Object.freeze({
  draft: 'BORRADOR',
  scheduled: 'PROGRAMADA',
  active: 'ACTIVA',
  finished: 'FINALIZADA',
});

export const STORY_STATUS_ORDER = Object.freeze([
  STORY_STATUS.active,
  STORY_STATUS.scheduled,
  STORY_STATUS.draft,
  STORY_STATUS.finished,
]);

// CTA admitidas. Deliberadamente NO incluye acciones sociales ("enviar
// mensaje", "responder"): la historia es una vidriera comercial, no un chat.
// Cada una se resuelve contra una acción que YA existe en el storefront y
// contra contenido REAL del catálogo; ninguna abre una pantalla vacía.
//
// `code` es el nombre canónico del brief comercial (VER PRODUCTO, VER COMBO,
// COMPRAR, VER CATEGORÍA). `label` es lo que se pinta en el botón: el lenguaje
// visual TABA2 escribe en caja de oración, así que el código y la etiqueta se
// declaran por separado en vez de gritarle a la persona que compra.
export const STORY_CTA_TYPES = Object.freeze({
  product: Object.freeze({
    code: 'VER PRODUCTO', label: 'Ver producto', action: 'product', destination: 'product',
  }),
  combo: Object.freeze({
    code: 'VER COMBO', label: 'Ver combo', action: 'combo', destination: 'combo',
  }),
  buy: Object.freeze({
    code: 'COMPRAR', label: 'Comprar', action: 'buy', destination: 'product',
  }),
  category: Object.freeze({
    code: 'VER CATEGORÍA', label: 'Ver categoría', action: 'category', destination: 'category',
  }),
});

// Nombres viejos del contrato anterior. Se traducen en vez de romperse: las
// historias que ya existían siguen abriendo lo mismo que abrían.
const STORY_CTA_ALIASES = Object.freeze({
  offer: 'product',
  add_to_cart: 'buy',
  add: 'buy',
});

// Esquemas que jamás pueden entrar en un `src`.
const UNSAFE_URL = /^\s*(?:javascript|data|vbscript|file)\s*:/i;

// Un destino es un IDENTIFICADOR del catálogo, no una URL. Aceptar sólo este
// alfabeto es más fuerte que una lista negra de esquemas: por construcción no
// existe un `cta_target` que pueda ser `javascript:`, una ruta absoluta ni un
// host externo. Cubre los tres formatos reales del árbol: uuid de producto,
// slug de categoría (`cervezas`) y slug de combo (`combo-previa-imperial-x6`).
const DESTINATION_ID = /^[A-Za-z0-9._-]{1,80}$/;

export const STORY_TITLE_MAX = 120;
export const STORY_BODY_MAX = 220;

function text(value, maxLength = 160) {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > maxLength ? clean.slice(0, maxLength) : clean;
}

function safeUrl(value) {
  const clean = String(value ?? '').trim();
  if (!clean || UNSAFE_URL.test(clean)) return '';
  return clean;
}

function destinationId(value) {
  const clean = String(value ?? '').trim();
  return DESTINATION_ID.test(clean) ? clean : '';
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

// Booleano ESTRICTO. `"true"` no es `true`: un registro que llega con el
// interruptor en texto está mal formado, y aceptarlo sería publicar una
// historia porque una cadena parecía verdadera. La traducción desde el
// formulario —donde una casilla vale `"on"`— la hace `storyFromForm`, que es
// el único lugar que sabe que está leyendo un formulario.
function boolean(value, fallback = false) {
  return value === true || value === false ? value : fallback;
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

/**
 * Traduce el tipo declarado al tipo canónico. Devuelve `''` cuando no existe:
 * una CTA desconocida no se aproxima a la más parecida, se descarta.
 */
export function normalizeCtaType(value) {
  const raw = text(value, 32).toLowerCase();
  const canonical = STORY_CTA_ALIASES[raw] || raw;
  return STORY_CTA_TYPES[canonical] ? canonical : '';
}

// Una CTA sin destino resoluble NO se conserva: un botón que no lleva a ningún
// lado es exactamente el "link muerto" que el diseño prohíbe.
//
// Lee las TRES formas en las que puede llegar una CTA: la columna de la tabla
// (`cta_type`), su versión camel y la forma ya normalizada (`cta.type`). La
// tercera no es un lujo: el almacén vuelve a normalizar sus propias listas en
// cada alta, baja y reordenamiento, y sin ella cada una de esas operaciones
// borraba en silencio la CTA de todas las historias — se guardaba una vidriera
// sin botones sin que nada fallara.
function normalizeCta(raw) {
  const type = normalizeCtaType(firstDefined(raw?.cta_type, raw?.ctaType, raw?.cta?.type));
  if (!type) return null;
  const definition = STORY_CTA_TYPES[type];
  const target = destinationId(firstDefined(raw?.cta_target, raw?.ctaTarget, raw?.cta?.target));
  if (!target) return null;
  return {
    type,
    code: definition.code,
    action: definition.action,
    label: definition.label,
    destination: definition.destination,
    target,
  };
}

// El orden lo manda `sort_order` y se lee de menor a mayor, que es como lo
// escribe una persona en el Panel ("primera, segunda, tercera"). Los registros
// viejos no lo tienen: se deriva de `is_highlight` + `priority` para que la
// intención con la que se cargaron sobreviva intacta al cambio de contrato.
function normalizeSortOrder(raw) {
  const explicit = firstDefined(raw?.sort_order, raw?.sortOrder, raw?.order);
  if (explicit !== undefined) return integer(explicit, 0);
  const priority = integer(raw?.priority, 0);
  const highlight = boolean(firstDefined(raw?.is_highlight, raw?.isHighlight), false);
  return (highlight ? -1000 : 0) - priority;
}

/**
 * Normaliza un registro crudo a la forma que usan Panel, almacén y visor.
 *
 * Devuelve `null` sólo cuando el registro no puede EXISTIR —sin id o sin medio
 * presentable—. Un borrador, una historia apagada o una vencida sí se
 * devuelven: el Panel tiene que poder verlas y editarlas. Quien decide qué
 * llega a la vidriera es `publishedStories`, no esta función.
 */
export function normalizeStoryRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const id = text(raw.id, 80);
  const mediaType = text(firstDefined(raw.media_type, raw.mediaType), 16).toLowerCase();
  const mediaUrl = safeUrl(firstDefined(raw.media_url, raw.mediaUrl));
  if (!id || !mediaUrl || !STORY_MEDIA_TYPES.includes(mediaType)) return null;

  return {
    id,
    businessId: text(firstDefined(raw.business_id, raw.businessId), 80),
    title: text(raw.title, STORY_TITLE_MAX),
    // Texto breve: una sola línea de copy editorial. No admite precios ni
    // porcentajes inventados; lo que promete un número lo tiene que sostener el
    // catálogo, y el catálogo se muestra en el destino, no acá.
    body: text(firstDefined(raw.body, raw.text, raw.subtitle), STORY_BODY_MAX),
    mediaType,
    mediaUrl,
    thumbnailUrl: safeUrl(firstDefined(raw.thumbnail_url, raw.thumbnailUrl)) || mediaUrl,
    startsAt: timestamp(firstDefined(raw.starts_at, raw.startsAt)),
    expiresAt: timestamp(firstDefined(raw.expires_at, raw.expiresAt)),
    sortOrder: normalizeSortOrder(raw),
    // El interruptor de "activar / desactivar" del Panel. `published` es el
    // nombre que usaba el contrato anterior y sigue valiendo.
    enabled: boolean(firstDefined(raw.enabled, raw.published, raw.is_enabled), false),
    // +18 DECLARADO. Es un piso, no un techo: el visor vuelve a derivarlo del
    // destino real y la restricción del catálogo siempre gana. Declararlo en
    // `false` no desactiva nada (ver `storyAgeRestriction` en
    // core/story-destination.js).
    ageRestricted: boolean(firstDefined(raw.age_restricted, raw.ageRestricted, raw.is_age_restricted), false),
    createdAt: timestamp(firstDefined(raw.created_at, raw.createdAt)),
    cta: normalizeCta(raw),
  };
}

/**
 * Estado comercial de una historia, calculado contra el reloj.
 *
 * Precedencia, y el porqué de cada escalón:
 *   1. apagada          → BORRADOR    (nunca salió; su ventana es irrelevante)
 *   2. venció           → FINALIZADA  (salió y terminó)
 *   3. todavía no llega → PROGRAMADA
 *   4. resto            → ACTIVA
 */
export function storyStatus(story, { now = Date.now() } = {}) {
  if (!story) return STORY_STATUS.draft;
  if (!story.enabled) return STORY_STATUS.draft;
  if (story.expiresAt !== null && story.expiresAt <= now) return STORY_STATUS.finished;
  if (story.startsAt !== null && story.startsAt > now) return STORY_STATUS.scheduled;
  return STORY_STATUS.active;
}

/** ¿Esta historia se está mostrando ahora mismo en la vidriera? */
export function isStoryLive(story, options) {
  return storyStatus(story, options) === STORY_STATUS.active;
}

/**
 * Compara dos historias por el orden que se ve en la vidriera y en el Panel.
 * `sortOrder` manda; los empates los rompe la fecha de inicio y después el id,
 * para que el orden sea TOTAL y no dependa de cómo llegó la lista.
 */
export function compareStories(a, b) {
  return (a.sortOrder - b.sortOrder)
    || ((a.startsAt ?? 0) - (b.startsAt ?? 0))
    || String(a.id).localeCompare(String(b.id));
}

/**
 * Colección normalizada y ordenada, con TODOS los estados. Es lo que administra
 * el Panel.
 */
export function normalizeStoryCollection(rawList) {
  if (!Array.isArray(rawList)) return [];
  const seen = new Set();
  return rawList
    .map(normalizeStoryRecord)
    .filter(Boolean)
    // Un id repetido rompería el registro de vistas y la analítica: gana el
    // primero, que es el orden en el que la fuente los declaró.
    .filter((story) => (seen.has(story.id) ? false : seen.add(story.id)))
    .sort(compareStories);
}

/**
 * Historias vigentes, ordenadas para el visor. Sólo ACTIVA llega acá: una
 * historia vencida desaparece sola porque la vigencia se recalcula en cada
 * render contra `now`, sin caché y sin nadie que tenga que apagarla a mano.
 */
export function publishedStories(rawList, { now = Date.now() } = {}) {
  return normalizeStoryCollection(rawList).filter((story) => isStoryLive(story, { now }));
}

/**
 * Reparte una colección por estado. El Panel lo usa para el resumen y para no
 * tener que recorrer la lista cuatro veces.
 */
export function summarizeStories(stories, { now = Date.now() } = {}) {
  const summary = {
    [STORY_STATUS.draft]: 0,
    [STORY_STATUS.scheduled]: 0,
    [STORY_STATUS.active]: 0,
    [STORY_STATUS.finished]: 0,
    total: 0,
  };
  for (const story of Array.isArray(stories) ? stories : []) {
    summary[storyStatus(story, { now })] += 1;
    summary.total += 1;
  }
  return summary;
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
    return { state: 'empty', available: false, total: 0, unseen: 0, thumbnail: '', firstId: '', firstIndex: 0 };
  }
  const first = unseen[0] || list[0];
  return {
    state: unseen.length ? 'unseen' : 'seen',
    available: true,
    total: list.length,
    unseen: unseen.length,
    thumbnail: first.thumbnailUrl,
    firstId: first.id,
    // El visor abre en la primera NO vista, no siempre en la primera: quien ya
    // vio las dos de arriba entra donde dejó.
    firstIndex: Math.max(0, list.indexOf(first)),
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
 * Cuánto video precargar.
 *
 * En una conexión declarada lenta o con ahorro de datos, un `preload="metadata"`
 * compite con la imagen que la persona está tratando de ver, y el visor queda en
 * blanco justo el tiempo que dura la paciencia de alguien mirando una vidriera.
 * Ahí no se precarga nada y el video empieza cuando lo piden.
 *
 * Recibe `navigator.connection` por parámetro para poder probarse sin navegador.
 */
export function storyVideoPreload(connection) {
  if (!connection) return 'metadata';
  const slow = connection.saveData === true
    || ['slow-2g', '2g'].includes(String(connection.effectiveType || ''));
  return slow ? 'none' : 'metadata';
}

/**
 * Origen de datos, en orden de autoridad:
 *
 *   1. `globalThis.TABA2_STORIES` — lo que publique el backend. Siempre gana.
 *   2. El almacén del Panel (`local`) — lo que administró el comercio en este
 *      dispositivo. `null` significa "nunca se administró"; `[]` significa "se
 *      administró y quedó vacío", y ese vacío se respeta: borrar la última
 *      historia no puede resucitar las fixtures.
 *   3. Fixtures — sólo en el modo preview explícito (`?showcase=1` / `?demo=1`).
 *
 * En runtime productivo, sin global y sin almacén, devuelve lista vacía.
 */
export function readStoriesSource({
  scope = globalThis,
  showcase = isShowcaseMode(),
  local = null,
  fixtures = null,
} = {}) {
  const injected = scope?.TABA2_STORIES;
  if (Array.isArray(injected)) return injected;
  if (Array.isArray(local)) return local;
  if (showcase && Array.isArray(fixtures)) return fixtures;
  return [];
}
