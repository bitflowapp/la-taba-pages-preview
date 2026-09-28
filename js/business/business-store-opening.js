// Panel › Preparar apertura: qué falta para abrir, según el sistema.
// ---------------------------------------------------------------------------
// La lista la arma la base (`get_store_opening_readiness`) con los mismos
// contratos que deciden si un pedido nace, si un producto se publica y si la
// plataforma puede verificar el comercio. Esta pantalla no decide nada: dibuja
// la respuesta traducida por `core/store-opening-readiness.js` —la misma que
// imprime `npm run opening:check`— y lleva a la pantalla donde se arregla cada
// cosa. Así no quedan pasos que sólo conoce quien leyó el código.
import { escapeHtml } from '../ui.js';
import { openingItemMark, presentOpeningReadiness } from '../core/store-opening-readiness.js';
import { humanizeFailure } from './business-operation-language.js';

const STATUS_LABEL = Object.freeze({
  pass: ['Listo', 'success'],
  pending: ['Falta', 'danger'],
  warn: ['Conviene', 'warning'],
  info: ['Para saber', 'neutral'],
  na: ['No aplica', 'neutral'],
});

let readiness = null;
let status = { phase: 'idle', message: '' };
let loadStarted = false;
let generation = 0;

export function resetStoreOpening() {
  generation += 1;
  readiness = null;
  status = { phase: 'idle', message: '' };
  loadStarted = false;
}

/**
 * Algo cambió en otra pantalla (horarios, entrega, catálogo, estado del local):
 * la próxima vez que se mire, se vuelve a preguntar. No se borra lo último
 * leído: se sigue mostrando hasta que llegue la respuesta nueva.
 */
export function markStoreOpeningStale() {
  loadStarted = false;
}

/** Se pide una vez por sesión del Panel al entrar; después, con «Volver a revisar». */
export function activateStoreOpening(context) {
  if (loadStarted) return null;
  loadStarted = true;
  return refreshStoreOpening(context);
}

export async function refreshStoreOpening(context) {
  const current = generation;
  status = { phase: 'loading', message: '' };
  context?.onChange?.();
  const response = typeof context?.getStoreOpeningReadiness === 'function'
    ? await context.getStoreOpeningReadiness()
    : { ok: false, message: '' };
  if (current !== generation) return { ok: false, staleContext: true };
  if (response?.ok && response.data && typeof response.data === 'object') {
    readiness = response.data;
    status = { phase: 'ready', message: '' };
  } else {
    status = { phase: 'error', message: humanizeFailure(response?.message, 'No pudimos leer qué falta para abrir.') };
  }
  context?.onChange?.();
  return response;
}

/** Para otras pantallas (por ejemplo «Abrir el negocio»): el veredicto ya leído, o `null`. */
export function storeOpeningVerdict() {
  if (!readiness) return null;
  const presented = presentOpeningReadiness(readiness);
  return presented.known ? presented : null;
}

export async function handleStoreOpeningAction(target, context) {
  if (!target?.closest?.('[data-store-opening-refresh]')) return null;
  const response = await refreshStoreOpening(context);
  return {
    handled: true,
    ok: Boolean(response?.ok),
    message: response?.ok ? 'Revisión actualizada.' : status.message,
  };
}

export function renderStoreOpeningSurface({ allowedViews = [], data = readiness, state = status } = {}) {
  const header = `<header><div><p class="eyebrow">Panel del negocio</p><h2>Preparar apertura</h2>
    <p>Qué falta para abrir, según el sistema. Cada paso dice dónde se completa.</p></div></header>`;
  if (!data) {
    const body = state.phase === 'error'
      ? `<p class="production-intake-error" role="alert">${escapeHtml(state.message)}</p>`
      : '<p class="form-hint" aria-live="polite">Revisando qué falta para abrir…</p>';
    return `<section class="business-ops-panel business-store-opening">${header}${body}
      <div class="button-row"><button class="secondary-button compact" type="button" data-store-opening-refresh>Volver a revisar</button></div>
    </section>`;
  }

  const presented = presentOpeningReadiness(data);
  const allowed = new Set(allowedViews);
  const blocking = presented.items.filter((item) => item.blocking);
  const done = blocking.filter((item) => item.status === 'pass').length;
  const tone = presented.accepting || presented.canOpen ? 'calm' : presented.commercialReady ? 'attention' : 'critical';

  const groups = presented.groups.map((group) => `
    <section class="store-opening-group" aria-label="${escapeHtml(group.label)}">
      <h3>${escapeHtml(group.label)}</h3>
      <ol class="store-opening-list">${group.items.map((item) => renderStep(item, allowed)).join('')}</ol>
    </section>`).join('');

  return `<section class="business-ops-panel business-store-opening">${header}
    <div class="operation-summary tone-${tone}" role="status" data-store-opening-verdict="${presented.canOpen ? 'can-open' : presented.commercialReady ? 'needs-platform' : 'blocked'}">
      <strong>${escapeHtml(presented.headline)}</strong>
      <span>${escapeHtml(presented.detail)}</span>
      <span class="store-opening-progress">${done} de ${blocking.length} pasos obligatorios listos.</span>
    </div>
    ${state.phase === 'error' ? `<p class="production-intake-error" role="alert">${escapeHtml(state.message)}</p>` : ''}
    ${groups}
    <p class="form-hint">La verificación de plataforma la hace La Taba cuando todo lo demás está listo. Abrir el local es siempre una decisión del dueño, desde «Abrir el negocio».</p>
    <div class="button-row">
      <button class="secondary-button compact" type="button" data-store-opening-refresh ${state.phase === 'loading' ? 'disabled' : ''}>Volver a revisar</button>
    </div>
  </section>`;
}

function renderStep(item, allowed) {
  const [label, tone] = STATUS_LABEL[item.status] || STATUS_LABEL.pending;
  const shownLabel = item.status === 'pending' && !item.blocking ? 'Conviene' : label;
  const go = item.view && allowed.has(item.view)
    ? `<button class="text-button" type="button" data-business-ops-view="${escapeHtml(item.view)}">Ir a completarlo</button>`
    : item.where ? `<small>${escapeHtml(item.where)}</small>` : '';
  return `<li class="store-opening-step is-${escapeHtml(item.status)}${item.blocking ? ' is-blocking' : ''}" data-opening-code="${escapeHtml(item.code)}">
    <span class="store-opening-mark" aria-hidden="true">${escapeHtml(openingItemMark(item))}</span>
    <div class="store-opening-body">
      <strong>${escapeHtml(item.title)}</strong>
      <p>${escapeHtml(item.reason)}</p>
      ${item.action ? `<p class="store-opening-action">${escapeHtml(item.action)}</p>` : ''}
      ${go}
    </div>
    <span class="status-pill ${escapeHtml(tone)}">${escapeHtml(shownLabel)}</span>
  </li>`;
}
