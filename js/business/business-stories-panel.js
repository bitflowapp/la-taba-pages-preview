// ─────────────────────────────────────────────────────────────────────────────
// Marketing → Historias · la pantalla con la que el local maneja su vidriera.
// -----------------------------------------------------------------------------
// Ocho verbos y ni uno más: crear, editar, previsualizar, activar/desactivar,
// programar, ordenar, eliminar y ver estado. Todo lo demás —quién decide si una
// historia se publica, qué destinos existen, cómo se cuenta una impresión— vive
// en `core/`, y esta pantalla se limita a pintarlo.
//
// El módulo es de RENDER: recibe todo por parámetro y devuelve HTML. No lee
// storage, no toca `state.js` y no muta nada, así que el formulario y la lista
// se pueden verificar sin abrir un navegador. Las acciones viven en
// `business.js`, junto al resto del despacho del Panel.
import { escapeHtml } from '../ui.js';
import {
  STORY_BODY_MAX,
  STORY_CTA_TYPES,
  STORY_STATUS,
  STORY_TITLE_MAX,
  storyStatus,
  summarizeStories,
} from '../core/stories.js';
import {
  resolveStoryDestination,
  storyAgeRestriction,
  storyDestinationOptions,
} from '../core/story-destination.js';
import { validateStoryForActivation } from '../core/story-store.js';
import { STORY_EVENTS, STORY_EVENT_LABELS } from '../core/story-analytics.js';

const STATUS_CLASS = Object.freeze({
  [STORY_STATUS.active]: 'is-active',
  [STORY_STATUS.scheduled]: 'is-scheduled',
  [STORY_STATUS.draft]: 'is-draft',
  [STORY_STATUS.finished]: 'is-finished',
});

// Lo que significa cada estado, dicho una sola vez y en el idioma del local.
const STATUS_HINT = Object.freeze({
  [STORY_STATUS.active]: 'Se está viendo ahora',
  [STORY_STATUS.scheduled]: 'Empieza sola en la fecha de inicio',
  [STORY_STATUS.draft]: 'Guardada, no se ve',
  [STORY_STATUS.finished]: 'Venció y se apagó sola',
});

function dateTimeLabel(value) {
  if (value === null || value === undefined) return '';
  try {
    return new Intl.DateTimeFormat('es-AR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(new Date(value));
  } catch (_) {
    return '';
  }
}

/** Valor para un `<input type="datetime-local">`: hora LOCAL, sin zona. */
export function toLocalInputValue(value) {
  if (value === null || value === undefined || value === '') return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function windowLabel(story) {
  const from = dateTimeLabel(story.startsAt);
  const to = dateTimeLabel(story.expiresAt);
  if (!from && !to) return 'Sin programar: mientras esté activa';
  if (from && to) return `Del ${from} al ${to}`;
  if (from) return `Desde el ${from}`;
  return `Hasta el ${to}`;
}

function destinationLabel(story, catalog) {
  if (!story.cta) return 'Novedad sin acción';
  const destination = resolveStoryDestination(story.cta, catalog);
  if (!destination || !destination.exists) {
    return `${story.cta.label} · destino fuera del catálogo`;
  }
  return `${story.cta.label} · ${destination.label}`;
}

function metricsLine(counters) {
  const visible = counters ? STORY_EVENTS.filter((event) => counters[event] > 0) : [];
  // Una fila sin línea de métricas se lee como "acá no hay nada que medir". La
  // hay: todavía no pasó nada, que es un dato y no un hueco.
  if (!visible.length) return 'Todavía sin actividad medida.';
  return visible.map((event) => `${STORY_EVENT_LABELS[event]} ${counters[event]}`).join(' · ');
}

function storyRow(story, {
  catalog, index, total, metrics, pendingDeleteId, now,
}) {
  const status = storyStatus(story, { now });
  const age = storyAgeRestriction(story, resolveStoryDestination(story.cta, catalog));
  const validation = validateStoryForActivation(story, catalog);
  const pendingDelete = pendingDeleteId === story.id;
  const thumbnail = story.thumbnailUrl || story.mediaUrl;

  return `
    <article class="stories-admin-row ${STATUS_CLASS[status]}" data-story-row="${escapeHtml(story.id)}">
      <span class="stories-admin-thumb" aria-hidden="true" style="background-image:url(&quot;${escapeHtml(encodeURI(thumbnail))}&quot;)"></span>
      <div class="stories-admin-copy">
        <div class="stories-admin-headline">
          <strong>${escapeHtml(story.title || 'Historia sin título')}</strong>
          <span class="stories-admin-state ${STATUS_CLASS[status]}">${escapeHtml(status)}</span>
          ${age.restricted ? '<span class="stories-admin-age">+18</span>' : ''}
        </div>
        ${story.body ? `<small class="stories-admin-body">${escapeHtml(story.body)}</small>` : ''}
        <p class="stories-admin-meta">
          <span>${escapeHtml(STATUS_HINT[status])}</span>
          <span>${escapeHtml(destinationLabel(story, catalog))}</span>
          <span>${escapeHtml(windowLabel(story))}</span>
        </p>
        <p class="stories-admin-metrics">${escapeHtml(metricsLine(metrics))}</p>
        ${!validation.ok && status !== STORY_STATUS.finished
          ? `<p class="form-hint catalog-form-error">${escapeHtml(validation.errors.join(' '))}</p>`
          : ''}
      </div>
      <!--
        El orden se mueve con dos botones, no arrastrando. Arrastrar en una
        pantalla de 320 px con una mano ocupada es la interacción que primero se
        rompe; dos botones de 44 px funcionan con el pulgar, con teclado y con
        lector de pantalla sin ninguna adaptación.
      -->
      <div class="stories-admin-order" role="group" aria-label="Orden de ${escapeHtml(story.title || 'la historia')}">
        <button class="ghost-button compact" type="button" data-story-move="-1" data-story-id="${escapeHtml(story.id)}"
          ${index === 0 ? 'disabled' : ''} aria-label="Subir una posición">↑</button>
        <span class="stories-admin-position">${index + 1}/${total}</span>
        <button class="ghost-button compact" type="button" data-story-move="1" data-story-id="${escapeHtml(story.id)}"
          ${index >= total - 1 ? 'disabled' : ''} aria-label="Bajar una posición">↓</button>
      </div>
      <div class="stories-admin-actions">
        <button class="secondary-button compact" type="button" data-story-edit="${escapeHtml(story.id)}">Editar</button>
        <button class="ghost-button compact" type="button" data-story-preview="${escapeHtml(story.id)}">Vista previa</button>
        <button class="ghost-button compact" type="button" data-story-toggle="${escapeHtml(story.id)}">
          ${story.enabled ? 'Desactivar' : 'Activar'}
        </button>
        ${pendingDelete
          ? `<button class="danger-button compact" type="button" data-story-delete-confirm="${escapeHtml(story.id)}">Confirmar borrado</button>
             <button class="ghost-button compact" type="button" data-story-delete-cancel>No borrar</button>`
          : `<button class="ghost-button compact" type="button" data-story-delete="${escapeHtml(story.id)}">Eliminar</button>`}
      </div>
    </article>`;
}

function ctaOptions(selected) {
  const options = Object.entries(STORY_CTA_TYPES)
    .map(([type, definition]) => `<option value="${type}" ${selected === type ? 'selected' : ''}>${escapeHtml(definition.code)}</option>`)
    .join('');
  return `<option value="" ${selected ? '' : 'selected'}>Sin acción — novedad</option>${options}`;
}

function destinationOptions(story, catalog) {
  if (!story.cta && !story.pendingCtaType) return '';
  const type = story.cta?.type || story.pendingCtaType;
  const definition = STORY_CTA_TYPES[type];
  if (!definition) return '';
  const options = storyDestinationOptions(catalog)[definition.destination] || [];
  const selected = story.cta?.target || '';
  if (!options.length) return '';
  return options
    .map((option) => `<option value="${escapeHtml(option.id)}" ${selected === option.id ? 'selected' : ''}>${escapeHtml(option.label)}${option.ageRestricted ? ' · +18' : ''}</option>`)
    .join('');
}

function storyForm(story, { catalog, now }) {
  const type = story.cta?.type || story.pendingCtaType || '';
  const definition = STORY_CTA_TYPES[type];
  const options = destinationOptions(story, catalog);
  const destination = resolveStoryDestination(story.cta, catalog);
  const age = storyAgeRestriction(story, destination);
  const validation = validateStoryForActivation(story, catalog);
  const status = storyStatus(story, { now });

  return `
    <form class="catalog-admin-form stories-admin-form" data-story-form novalidate>
      <input type="hidden" name="id" value="${escapeHtml(story.id)}" />
      <div class="catalog-form-title">
        <strong>${story.isNew ? 'Nueva historia' : 'Editar historia'}</strong>
        <span>Estado actual: ${escapeHtml(status)}. Una historia se ve sólo cuando está ACTIVA.</span>
      </div>

      <div class="catalog-form-grid">
        <label>Título
          <input name="title" maxlength="${STORY_TITLE_MAX}" required value="${escapeHtml(story.title)}" placeholder="Ej.: Heineken bien fría" />
        </label>
        <label>Tipo de medio
          <select name="mediaType">
            <option value="image" ${story.mediaType === 'image' ? 'selected' : ''}>Imagen</option>
            <option value="video" ${story.mediaType === 'video' ? 'selected' : ''}>Video</option>
          </select>
        </label>
      </div>

      <label class="catalog-description-field">Imagen o video
        <input name="mediaUrl" maxlength="220" required value="${escapeHtml(story.mediaUrl)}" placeholder="assets/promos/mi-historia.webp" />
        <small>Ruta del archivo dentro del sitio. La historia no se puede activar con el marcador de posición.</small>
      </label>
      <label class="catalog-description-field">Miniatura
        <input name="thumbnailUrl" maxlength="220" value="${escapeHtml(story.thumbnailUrl === story.mediaUrl ? '' : story.thumbnailUrl)}" placeholder="Opcional: se usa en el acceso de la home" />
      </label>
      <label class="catalog-description-field">Texto breve
        <textarea name="body" maxlength="${STORY_BODY_MAX}" rows="2" placeholder="Una línea. Sin precios ni porcentajes: el precio lo dice el catálogo.">${escapeHtml(story.body)}</textarea>
      </label>

      <div class="catalog-form-grid">
        <label>Acción
          <select name="ctaType" data-story-cta-type>${ctaOptions(type)}</select>
        </label>
        <label>Destino
          ${definition
            ? (options
              ? `<select name="ctaTarget" data-story-cta-target>${options}</select>`
              : '<select name="ctaTarget" disabled><option>No hay destinos comprables de este tipo</option></select>')
            : '<select name="ctaTarget" disabled><option>La novedad no lleva a ningún lado</option></select>'}
          <small>Sólo se ofrece contenido real y comprable hoy. No se puede escribir un destino inventado.</small>
        </label>
      </div>

      <div class="catalog-form-grid">
        <label>Inicio
          <input name="startsAt" type="datetime-local" value="${escapeHtml(toLocalInputValue(story.startsAt))}" />
        </label>
        <label>Expiración
          <input name="expiresAt" type="datetime-local" value="${escapeHtml(toLocalInputValue(story.expiresAt))}" />
        </label>
      </div>

      <label class="catalog-availability-field">
        <input name="ageRestricted" type="checkbox" ${age.restricted ? 'checked' : ''} ${age.derived ? 'disabled' : ''} />
        Contenido +18
        ${age.derived
          ? '<small>Lo impone el catálogo: el destino es alcohólico. No se puede desmarcar.</small>'
          : '<small>Marcalo si la pieza muestra alcohol aunque el destino no lo sea.</small>'}
      </label>
      <label class="catalog-availability-field">
        <input name="enabled" type="checkbox" ${story.enabled ? 'checked' : ''} />
        Activar al guardar
        <small>Con inicio a futuro queda PROGRAMADA y se enciende sola.</small>
      </label>

      ${!validation.ok
        ? `<p class="form-hint catalog-form-error">Para activarla falta: ${escapeHtml(validation.errors.join(' '))}</p>`
        : ''}
      <p class="form-hint catalog-form-error hidden" data-story-form-error></p>

      <div class="catalog-form-actions">
        <button class="primary-button compact" type="button" data-story-save>Guardar historia</button>
        <button class="secondary-button compact" type="button" data-story-form-preview>Vista previa</button>
        <button class="ghost-button compact" type="button" data-story-form-close>Cancelar</button>
      </div>
    </form>`;
}

/**
 * Pantalla completa. `stories` llega ya normalizada y ordenada por el almacén;
 * acá no se reordena nada, para que lo que se ve sea exactamente lo que está
 * guardado.
 */
export function renderStoriesManager({
  stories = [],
  catalog = {},
  editing = null,
  feedback = '',
  metrics = {},
  pendingDeleteId = null,
  backendOwned = false,
  now = Date.now(),
} = {}) {
  const summary = summarizeStories(stories, { now });

  return `
    <section class="business-catalog-card stories-manager" data-stories-manager aria-labelledby="stories-manager-title">
      <header class="business-catalog-head">
        <div>
          <span class="catalog-admin-kicker">Marketing</span>
          <h3 id="stories-manager-title">Historias</h3>
          <p>La vidriera del local: promociones, productos, combos y novedades. Cada historia lleva a contenido real del catálogo.</p>
        </div>
        <div class="catalog-admin-top-actions">
          <span class="business-promo-count">${summary[STORY_STATUS.active]} activa${summary[STORY_STATUS.active] === 1 ? '' : 's'}</span>
          <button class="secondary-button compact" type="button" data-story-new>Nueva historia</button>
        </div>
      </header>

      ${feedback ? `<p class="business-setup-feedback" role="status">${escapeHtml(feedback)}</p>` : ''}

      ${backendOwned
        ? `<p class="form-hint catalog-form-error">
             El servidor está publicando historias y ese origen manda en la vidriera.
             Lo que edites acá queda guardado pero no se ve hasta que el servidor deje de publicarlas.
           </p>`
        : ''}

      <div class="stories-admin-summary" role="group" aria-label="Historias por estado">
        ${[STORY_STATUS.active, STORY_STATUS.scheduled, STORY_STATUS.draft, STORY_STATUS.finished]
          .map((status) => `
            <span class="stories-admin-chip ${STATUS_CLASS[status]}">
              <strong>${summary[status]}</strong>
              <small>${escapeHtml(status)}</small>
            </span>`).join('')}
      </div>

      ${editing ? storyForm(editing, { catalog, now }) : ''}

      <div class="catalog-admin-list stories-admin-list" aria-label="Historias del comercio">
        ${stories.length
          ? stories.map((story, index) => storyRow(story, {
            catalog,
            index,
            total: stories.length,
            metrics: metrics[story.id],
            pendingDeleteId,
            now,
          })).join('')
          : `<div class="catalog-admin-empty">
               <strong>Todavía no hay historias.</strong>
               <span>Mientras no haya ninguna activa, el aro del logo queda apagado y la clientela no ve un acceso vacío.</span>
             </div>`}
      </div>

      <!--
        Las dos verdades incómodas, dichas donde se toman las decisiones y no
        escondidas en un documento: dónde viven las historias y qué mide —y qué
        NO mide— la analítica.
      -->
      <p class="stories-admin-note">
        Las historias se guardan <strong>en este dispositivo</strong> hasta que el backend publique la tabla del canal:
        lo que cargues acá todavía no aparece en otro teléfono ni en la computadora del local.
      </p>
      <p class="stories-admin-note">
        Los números son de <strong>este dispositivo</strong> y llegan hasta el agregado al carrito.
        La compra la cierra el sistema de pedidos y no vuelve marcada con la historia que la originó,
        así que acá no se habla de conversión: se cuenta lo que se puede medir.
      </p>
    </section>`;
}

/** Lee el formulario. Devuelve valores crudos: normalizar es de `story-store.js`. */
export function readStoryForm(form) {
  const value = (name) => form.querySelector(`[name="${name}"]`)?.value ?? '';
  const checked = (name) => form.querySelector(`[name="${name}"]`)?.checked === true;
  return {
    id: value('id'),
    title: value('title'),
    body: value('body'),
    mediaType: value('mediaType'),
    mediaUrl: value('mediaUrl'),
    thumbnailUrl: value('thumbnailUrl'),
    ctaType: value('ctaType'),
    ctaTarget: value('ctaTarget'),
    startsAt: value('startsAt'),
    expiresAt: value('expiresAt'),
    ageRestricted: checked('ageRestricted'),
    enabled: checked('enabled'),
  };
}
