import { escapeHtml } from '../ui.js';
import { can } from './business-capabilities.js';

// Bandeja de solicitudes de alta del Panel.
//
// Es la contracara de business-access-registration.js: del otro lado del
// mostrador hay alguien esperando, y esta pantalla es donde se decide. Dos
// decisiones de diseño que importan:
//
//   · Es una LISTA DE TARJETAS, no una tabla. El dueño aprueba desde el
//     teléfono, parado, con una mano. Una tabla de escritorio comprimida a
//     390px es ilegible, y los botones quedan del tamaño de un grano de arroz.
//   · Los roles que se ofrecen NO los decide esta pantalla: vienen en
//     `roles_grantable`, calculado por el servidor según lo que quien mira
//     puede realmente otorgar. Un encargado no ve la opción "Encargado"
//     porque no puede crearla, no porque acá la escondamos.

export const ACCESS_INBOX_FILTERS = Object.freeze(['pending', 'approved', 'rejected']);

const ACCESS_LABELS = Object.freeze({
  panel: 'Panel del negocio',
  rider: 'Repartidor',
});

const ROLE_OPTION_LABELS = Object.freeze({
  admin: 'Encargado',
  staff: 'Equipo',
  rider: 'Repartidor',
});

const STATUS_LABELS = Object.freeze({
  pending: 'Esperando',
  approved: 'Aprobada',
  rejected: 'No aprobada',
});

const STATUS_TONES = Object.freeze({
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
});

export function normalizeAccessFilter(filter) {
  return ACCESS_INBOX_FILTERS.includes(filter) ? filter : 'pending';
}

export function normalizeAccessRequestRow(row) {
  if (!row || typeof row !== 'object') return null;
  const id = String(row.request_id || '');
  if (!id) return null;
  const roles = Array.isArray(row.roles_grantable) ? row.roles_grantable.filter((r) => ROLE_OPTION_LABELS[r]) : [];
  return Object.freeze({
    id,
    userId: String(row.user_id || ''),
    email: String(row.email || ''),
    fullName: String(row.full_name || ''),
    contactPhone: String(row.contact_phone || ''),
    requestedAccess: String(row.requested_access || ''),
    status: String(row.status || ''),
    attemptCount: Number(row.attempt_count || 1),
    requestedAt: row.requested_at || null,
    decidedAt: row.decided_at || null,
    grantedRole: row.granted_role || null,
    isMember: row.is_member === true,
    rolesGrantable: Object.freeze(roles),
  });
}

export function normalizeAccessRequests(rows) {
  return (Array.isArray(rows) ? rows : []).map(normalizeAccessRequestRow).filter(Boolean);
}

/**
 * Qué se puede hacer con una solicitud, en una sola respuesta.
 *
 * Aprobar a alguien que ya entró por otra vía no se puede: el servidor lo
 * rechaza para no pisarle el rol que ya tiene. La pantalla lo dice antes, en
 * vez de ofrecer un botón que va a fallar.
 */
export function accessRequestActions(request, role) {
  if (!request || request.status !== 'pending') {
    return Object.freeze({ canApprove: false, canReject: false, reason: '' });
  }
  if (!can(role, 'team.manage')) {
    return Object.freeze({
      canApprove: false,
      canReject: false,
      reason: 'Las solicitudes de acceso las decide el dueño o el encargado.',
    });
  }
  if (request.isMember) {
    return Object.freeze({
      canApprove: false,
      canReject: true,
      reason: 'Esta persona ya pertenece al equipo. Rechazá la solicitud para sacarla de la lista.',
    });
  }
  if (request.rolesGrantable.length === 0) {
    return Object.freeze({
      canApprove: false,
      canReject: true,
      reason: 'No hay ningún rol que puedas otorgar en esta solicitud.',
    });
  }
  return Object.freeze({ canApprove: true, canReject: true, reason: '' });
}

export function renderAccessInboxSurface({
  requests = [], status = '', role = '', busy = false, filter = 'pending',
} = {}) {
  const current = normalizeAccessFilter(filter);
  const rows = normalizeAccessRequests(requests);
  const tabs = ACCESS_INBOX_FILTERS.map((value) => `
    <button class="business-ops-nav-button ${value === current ? 'active' : ''}" type="button"
      aria-pressed="${value === current}" data-access-inbox-filter="${escapeHtml(value)}">
      ${escapeHtml(STATUS_LABELS[value])}
    </button>`).join('');

  const list = rows.length
    ? rows.map((request) => renderRequestCard(request, { role, busy })).join('')
    : `<p class="form-hint">${escapeHtml(emptyCopy(current))}</p>`;

  return `<section class="business-ops-panel">
    <header><div>
      <p class="eyebrow">Panel del negocio</p>
      <h2>Solicitudes de acceso</h2>
      <p>Gente que creó su cuenta y pide entrar. Hasta que no la apruebes, no ve nada.</p>
    </div></header>
    ${status ? `<p class="business-ops-feedback" role="status">${escapeHtml(status)}</p>` : ''}
    <div class="business-ops-nav access-inbox-tabs" role="group" aria-label="Estado de las solicitudes">${tabs}</div>
    <div class="access-inbox-list">${list}</div>
    <div class="button-row">
      <button class="secondary-button compact" type="button" data-access-inbox-refresh ${busy ? 'disabled' : ''}>
        Actualizar
      </button>
    </div>
  </section>`;
}

function renderRequestCard(request, { role, busy }) {
  const actions = accessRequestActions(request, role);
  const tone = STATUS_TONES[request.status] || 'warning';
  const access = ACCESS_LABELS[request.requestedAccess] || request.requestedAccess;
  const roleOptions = request.rolesGrantable
    .map((value, index) => `<option value="${escapeHtml(value)}" ${index === 0 ? 'selected' : ''}>
      ${escapeHtml(ROLE_OPTION_LABELS[value])}
    </option>`).join('');

  return `<article class="access-request-card tone-${escapeHtml(tone)}" data-access-request="${escapeHtml(request.id)}">
    <header>
      <div>
        <strong>${escapeHtml(request.fullName || 'Sin nombre')}</strong>
        <span class="access-request-kind">${escapeHtml(access)}</span>
      </div>
      <span class="access-request-status tone-${escapeHtml(tone)}">${escapeHtml(STATUS_LABELS[request.status] || request.status)}</span>
    </header>
    <dl class="access-request-facts">
      <div><dt>Email</dt><dd>${escapeHtml(request.email)}</dd></div>
      ${request.contactPhone ? `<div><dt>Teléfono</dt><dd>${escapeHtml(request.contactPhone)}</dd></div>` : ''}
      <div><dt>Enviada</dt><dd>${escapeHtml(formatMoment(request.requestedAt))}</dd></div>
      ${request.attemptCount > 1 ? `<div><dt>Intentos</dt><dd>${escapeHtml(String(request.attemptCount))}</dd></div>` : ''}
      ${request.grantedRole ? `<div><dt>Rol otorgado</dt><dd>${escapeHtml(ROLE_OPTION_LABELS[request.grantedRole] || request.grantedRole)}</dd></div>` : ''}
    </dl>
    ${actions.reason ? `<p class="form-hint">${escapeHtml(actions.reason)}</p>` : ''}
    ${request.status !== 'pending' ? '' : `
      <div class="access-request-actions">
        ${actions.canApprove ? `
          <label class="access-request-role">
            Rol al aprobar
            <select data-access-request-role="${escapeHtml(request.id)}">${roleOptions}</select>
          </label>
          <button class="primary-button" type="button"
            data-access-request-approve="${escapeHtml(request.id)}" ${busy ? 'disabled' : ''}>Aprobar</button>` : ''}
        ${actions.canReject ? `
          <button class="ghost-button" type="button"
            data-access-request-reject="${escapeHtml(request.id)}" ${busy ? 'disabled' : ''}>Rechazar</button>` : ''}
      </div>`}
  </article>`;
}

function emptyCopy(filter) {
  if (filter === 'pending') return 'No hay solicitudes esperando.';
  if (filter === 'approved') return 'Todavía no aprobaste ninguna solicitud.';
  return 'No rechazaste ninguna solicitud.';
}

function formatMoment(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
