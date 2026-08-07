// ─────────────────────────────────────────────────────────────────────────────
// Almacén de historias · lo que el Panel escribe y la vidriera lee.
// -----------------------------------------------------------------------------
// Hoy la fuente productiva de historias es un global que publica el backend
// (`TABA2_STORIES`), y ese global sigue GANANDO siempre. Pero el backend
// todavía no tiene tabla de historias, y sin un lugar donde escribir, "Marketing
// → Historias" sería un formulario que no guarda nada.
//
// Este módulo es ese lugar: una colección normalizada, ordenada y persistida en
// el dispositivo, con el MISMO contrato de registro que expondrá la tabla. El
// día que exista, se cambia el origen y no se toca ni el Panel ni el visor
// —ambos hablan `core/stories.js`, no este archivo—.
//
// Lo que esto NO es, y el handoff lo dice con todas las letras: un almacén
// compartido entre dispositivos. Lo que se carga en un teléfono no aparece en
// otro hasta que exista la tabla. Es una limitación declarada, no un descuido.
//
// Todas las operaciones son PURAS sobre listas: reciben una colección y
// devuelven otra. La persistencia es una capa fina encima, así que el CRUD
// entero se testea sin navegador.
import { getStorageArea, safeJsonParse, safeStorageGet, safeStorageSet } from './storage.js';
import { isShowcaseMode } from './showcase-mode.js';
import {
  STORY_BODY_MAX,
  STORY_MEDIA_TYPES,
  STORY_TITLE_MAX,
  compareStories,
  normalizeCtaType,
  normalizeStoryCollection,
  normalizeStoryRecord,
} from './stories.js';
import { resolveStoryDestination } from './story-destination.js';

export const STORIES_ADMIN_STORAGE_KEY = 'la_taba_stories_admin_v1';
export const STORIES_ADMIN_SHOWCASE_KEY = 'la_taba_showcase_stories_admin_v1';

function adminStorageKey() {
  return isShowcaseMode() ? STORIES_ADMIN_SHOWCASE_KEY : STORIES_ADMIN_STORAGE_KEY;
}

/**
 * Colección administrada, o `null` cuando NUNCA se administró.
 *
 * La distinción importa: `null` deja que el modo demo siga mostrando sus
 * fixtures, y `[]` significa que alguien borró la última historia a propósito.
 * Devolver `[]` en los dos casos haría reaparecer las fixtures justo después de
 * vaciar el Panel, que es la forma más rápida de que nadie vuelva a confiar en
 * el botón de eliminar.
 */
export function readStoredStories(storage = getStorageArea('localStorage')) {
  const parsed = safeJsonParse(safeStorageGet(storage, adminStorageKey()), null);
  if (!Array.isArray(parsed)) return null;
  return normalizeStoryCollection(parsed);
}

export function writeStoredStories(stories, storage = getStorageArea('localStorage')) {
  const collection = normalizeStoryCollection(stories);
  return safeStorageSet(storage, adminStorageKey(), JSON.stringify(collection.map(toStoredRecord)));
}

/**
 * Forma persistida: `snake_case`, exactamente las columnas que tendrá la tabla.
 * Guardar ya en el idioma del backend evita una traducción el día de la
 * migración y hace que un `JSON.stringify` del almacén sea un `INSERT` legible.
 */
export function toStoredRecord(story) {
  return {
    id: story.id,
    business_id: story.businessId,
    title: story.title,
    body: story.body,
    media_type: story.mediaType,
    media_url: story.mediaUrl,
    thumbnail_url: story.thumbnailUrl,
    starts_at: story.startsAt === null ? null : new Date(story.startsAt).toISOString(),
    expires_at: story.expiresAt === null ? null : new Date(story.expiresAt).toISOString(),
    sort_order: story.sortOrder,
    cta_type: story.cta?.type || '',
    cta_target: story.cta?.target || '',
    age_restricted: story.ageRestricted,
    enabled: story.enabled,
    created_at: story.createdAt === null ? null : new Date(story.createdAt).toISOString(),
  };
}

/**
 * Reasigna `sort_order` como 1, 2, 3… respetando el orden actual. Se llama
 * después de cada alta, baja o movimiento para que el orden nunca dependa de
 * números arbitrarios ni deje huecos que después haya que interpretar.
 */
export function resequenceStories(stories) {
  return [...(Array.isArray(stories) ? stories : [])]
    .sort(compareStories)
    .map((story, index) => ({ ...story, sortOrder: index + 1 }));
}

/** Alta o edición. La identidad es el `id`; nunca se duplica. */
export function upsertStory(stories, record) {
  const story = normalizeStoryRecord(record);
  if (!story) return normalizeStoryCollection(stories);
  const list = normalizeStoryCollection(stories);
  const index = list.findIndex((candidate) => candidate.id === story.id);
  if (index === -1) {
    // Una historia nueva entra al FINAL: la que ya está publicada no cambia de
    // posición porque alguien creó un borrador.
    const last = list.length ? list[list.length - 1].sortOrder : 0;
    return resequenceStories([...list, { ...story, sortOrder: last + 1 }]);
  }
  const next = [...list];
  // La edición conserva la posición: cambiar el título no puede reordenar la
  // vidriera. El orden se mueve sólo con los controles de orden.
  next[index] = { ...story, sortOrder: list[index].sortOrder };
  return resequenceStories(next);
}

export function removeStory(stories, id) {
  const wanted = String(id);
  return resequenceStories(normalizeStoryCollection(stories).filter((story) => story.id !== wanted));
}

export function setStoryEnabled(stories, id, enabled) {
  const wanted = String(id);
  return normalizeStoryCollection(stories)
    .map((story) => (story.id === wanted ? { ...story, enabled: Boolean(enabled) } : story));
}

/**
 * Mueve una historia `delta` posiciones. Devuelve la lista intacta cuando el
 * movimiento se sale de los extremos: el botón se deshabilita en la UI, y acá
 * se vuelve a verificar por si alguien llama la función directamente.
 */
export function moveStory(stories, id, delta) {
  const list = resequenceStories(normalizeStoryCollection(stories));
  const index = list.findIndex((story) => story.id === String(id));
  const target = index + Math.trunc(Number(delta) || 0);
  if (index === -1 || target < 0 || target >= list.length || target === index) return list;
  const next = [...list];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next.map((story, position) => ({ ...story, sortOrder: position + 1 }));
}

let draftCounter = 0;

/** Id nuevo, legible y estable dentro de una sesión. */
export function nextStoryId(now = Date.now()) {
  draftCounter += 1;
  return `story-${now.toString(36)}-${draftCounter.toString(36)}`;
}

/** Borrador vacío: apagado, sin ventana y sin CTA. Nace en BORRADOR. */
export function createStoryDraft({ businessId = '', now = Date.now() } = {}) {
  return normalizeStoryRecord({
    id: nextStoryId(now),
    business_id: businessId,
    title: '',
    body: '',
    media_type: 'image',
    // Marcador de posición para que el borrador exista antes de tener arte. No
    // se puede activar así: `validateStoryForActivation` exige un medio propio.
    media_url: 'assets/products/beverage-placeholder.svg',
    thumbnail_url: '',
    starts_at: null,
    expires_at: null,
    sort_order: 0,
    cta_type: '',
    cta_target: '',
    age_restricted: false,
    enabled: false,
    created_at: new Date(now).toISOString(),
  });
}

const PLACEHOLDER_MEDIA = 'assets/products/beverage-placeholder.svg';

/**
 * Qué le falta a una historia para poder ACTIVARSE.
 *
 * Se valida sólo al activar, nunca al guardar: un borrador incompleto tiene que
 * poder guardarse a medias, y eso es exactamente para lo que existe el estado
 * BORRADOR. Lo que no puede pasar es que una historia incompleta llegue a la
 * vidriera.
 */
export function validateStoryForActivation(story, context = {}) {
  const errors = [];
  if (!story) return { ok: false, errors: ['La historia no existe.'] };

  if (!story.mediaUrl || story.mediaUrl === PLACEHOLDER_MEDIA) {
    errors.push('Falta la imagen o el video de la historia.');
  }
  if (!STORY_MEDIA_TYPES.includes(story.mediaType)) {
    errors.push('El tipo de medio no es imagen ni video.');
  }
  if (!story.title) {
    errors.push('Falta el título.');
  }
  if (story.startsAt !== null && story.expiresAt !== null && story.expiresAt <= story.startsAt) {
    errors.push('La expiración tiene que ser posterior al inicio.');
  }
  if (story.cta) {
    const destination = resolveStoryDestination(story.cta, context);
    if (!destination || !destination.exists) {
      errors.push('El destino de la CTA no está en el catálogo publicado.');
    } else if (!destination.purchasable) {
      errors.push(destination.kind === 'category'
        ? 'El rubro de destino no tiene ningún producto comprable ahora.'
        : 'El destino no tiene precio confirmado o no tiene stock.');
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Traduce el formulario del Panel al contrato del registro.
 *
 * Los tres campos que este paso NO deja pasar en falso:
 *   · una CTA sin destino queda como historia editorial, no como botón muerto;
 *   · un destino que no está entre las opciones reales se descarta en
 *     `normalizeStoryRecord` (alfabeto de identificador) o en la validación;
 *   · el +18 declarado se conserva tal cual, pero jamás se usa para APAGAR el
 *     que deriva del catálogo (eso lo resuelve `storyAgeRestriction`).
 */
export function storyFromForm(values = {}, { previous = null, now = Date.now() } = {}) {
  const ctaType = normalizeCtaType(values.ctaType);
  const ctaTarget = ctaType ? String(values.ctaTarget || '').trim() : '';
  return normalizeStoryRecord({
    id: String(values.id || previous?.id || nextStoryId(now)),
    business_id: String(values.businessId ?? previous?.businessId ?? ''),
    title: String(values.title || '').slice(0, STORY_TITLE_MAX),
    body: String(values.body || '').slice(0, STORY_BODY_MAX),
    media_type: String(values.mediaType || 'image'),
    media_url: String(values.mediaUrl || '').trim(),
    thumbnail_url: String(values.thumbnailUrl || '').trim(),
    starts_at: values.startsAt || null,
    expires_at: values.expiresAt || null,
    sort_order: values.sortOrder ?? previous?.sortOrder ?? 0,
    cta_type: ctaType,
    cta_target: ctaTarget,
    age_restricted: values.ageRestricted === true || values.ageRestricted === 'on',
    enabled: values.enabled === true || values.enabled === 'on',
    created_at: previous?.createdAt ? new Date(previous.createdAt).toISOString() : new Date(now).toISOString(),
  });
}
