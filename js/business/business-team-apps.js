// Instaladores del equipo en el Panel: la app de repartidor y el agente de impresión.
// ---------------------------------------------------------------------------
// Viven en un bucket PRIVADO de CP (`team-apps/<comercio>/...`) que sólo puede
// leer el dueño o el encargado de ese comercio. Nada se publica: desde acá se
// crea un link firmado que vence en 7 días, para mandárselo a un repartidor o
// para instalar el agente en la PC del local. Si todavía no se cargaron, se
// dice y se pide a La Taba.
import { escapeHtml } from '../ui.js';

export const TEAM_APP_LINK_SECONDS = 7 * 24 * 60 * 60;

const COPY = Object.freeze({
  rider: {
    title: 'App de repartidor (Android)',
    missing: 'La app todavía no está cargada. Pedísela a La Taba.',
    note: 'Firmada por La Taba. En el teléfono hay que permitir instalar desde el navegador o desde WhatsApp.',
    share: (link) => `App de repartidor de La Taba (Android). Instalala y entrá con tu correo y tu contraseña: ${link}`,
  },
  agent: {
    title: 'Instalador del agente de impresión (Windows)',
    missing: 'El instalador todavía no está cargado. Pedíselo a La Taba.',
    note: 'Uso interno y SIN firma de código: Windows va a pedir confirmación al instalarlo. No se actualiza solo.',
    share: (link) => `Instalador interno del agente de impresión de La Taba (Windows): ${link}`,
  },
});

let manifest = null;
let status = { phase: 'idle', message: '' };
let loadStarted = false;
let generation = 0;
let links = {};

export function resetTeamApps() {
  generation += 1;
  manifest = null;
  status = { phase: 'idle', message: '' };
  loadStarted = false;
  links = {};
}

export function activateTeamApps(context) {
  if (loadStarted || typeof context?.readTeamAppsManifest !== 'function') return null;
  loadStarted = true;
  return refreshTeamApps(context);
}

export async function refreshTeamApps(context) {
  const current = generation;
  status = { phase: 'loading', message: '' };
  const response = await context.readTeamAppsManifest();
  if (current !== generation) return response;
  manifest = response?.ok && response.data && typeof response.data === 'object' ? response.data : null;
  status = { phase: 'ready', message: '' };
  context?.onChange?.();
  return response;
}

export async function handleTeamAppsAction(target, context) {
  if (!target?.closest) return null;
  const done = (ok, message) => ({ handled: true, ok, message });
  const create = target.closest('[data-team-app-link]');
  if (create) {
    const kind = create.dataset.teamAppLink;
    const entry = manifest?.[kind];
    if (!COPY[kind] || !entry?.path) return done(false, COPY[kind]?.missing || 'No hay instalador.');
    const response = await context.createTeamAppLink({ path: entry.path, seconds: TEAM_APP_LINK_SECONDS, fileName: entry.file });
    if (!response?.ok || !response.data) return done(false, 'No se pudo crear el link. Probá de nuevo en un momento.');
    links = { ...links, [kind]: { url: response.data, expiresAt: new Date(Date.now() + TEAM_APP_LINK_SECONDS * 1000).toISOString() } };
    context?.onChange?.();
    return done(true, 'Link creado. Vence en 7 días.');
  }
  const copy = target.closest('[data-team-app-copy]');
  if (copy) {
    const link = links[copy.dataset.teamAppCopy]?.url;
    if (!link) return done(false, 'No hay un link para copiar.');
    try { await globalThis.navigator?.clipboard?.writeText(link); return done(true, 'Link copiado.'); }
    catch (_) { return done(false, 'No se pudo copiar: seleccioná el link y copialo a mano.'); }
  }
  return null;
}

/** El bloque de descarga para una pantalla. `kind`: 'rider' o 'agent'. */
export function renderTeamAppBlock(kind, { elevated = false, data = manifest, created = links, state = status } = {}) {
  const copy = COPY[kind];
  if (!copy) return '';
  if (!elevated) return `<section class="business-config-block"><h3>${escapeHtml(copy.title)}</h3><p class="form-hint">El link de descarga lo crea el dueño o el encargado.</p></section>`;
  const entry = data?.[kind];
  const link = created?.[kind];
  const body = !entry
    ? `<p class="form-hint">${state.phase === 'loading' ? 'Buscando el instalador…' : escapeHtml(copy.missing)}</p>`
    : `<p><strong>Versión ${escapeHtml(entry.version || '—')}</strong>${entry.sha256 ? ` · huella ${escapeHtml(String(entry.sha256).slice(0, 12))}…` : ''}</p>
       <p class="form-hint">${escapeHtml(copy.note)}</p>
       ${link
    ? `<input type="text" readonly value="${escapeHtml(link.url)}" aria-label="Link de descarga" data-team-app-link-value="${escapeHtml(kind)}">
       <div class="button-row">
         <button class="primary-button compact" type="button" data-team-app-copy="${escapeHtml(kind)}">Copiar link</button>
         <a class="secondary-button compact" href="https://wa.me/?text=${escapeHtml(encodeURIComponent(copy.share(link.url)))}" target="_blank" rel="noopener noreferrer">Mandar por WhatsApp</a>
       </div>
       <p class="form-hint">El link vence en 7 días. Mandalo sólo a quien corresponde.</p>`
    : `<button class="secondary-button compact" type="button" data-team-app-link="${escapeHtml(kind)}">Crear link de descarga (7 días)</button>`}`;
  return `<section class="business-config-block team-invite-link" data-team-app="${escapeHtml(kind)}"><h3>${escapeHtml(copy.title)}</h3>${body}</section>`;
}
