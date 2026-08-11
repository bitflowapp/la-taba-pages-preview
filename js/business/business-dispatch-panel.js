import { escapeHtml } from '../ui.js';
import { can } from './business-capabilities.js';

const JOB_STATE_LABELS = Object.freeze({
  queued: 'En cola',
  ranking: 'Buscando Rider',
  offering: 'Oferta enviada',
  no_rider_available: 'Sin Rider disponible',
  claimed: 'Asignado',
  completed: 'Completado',
  cancelled: 'Cancelado',
});

const SHIFT_STATE_LABELS = Object.freeze({
  scheduled: 'Turno programado',
  active: 'Turno activo',
  paused: 'Turno pausado',
  ended: 'Turno finalizado',
});

const AVAILABILITY_LABELS = Object.freeze({
  available: 'Disponible',
  unavailable: 'No disponible',
  at_capacity: 'Capacidad completa',
});

const PRESENCE_STATE_LABELS = Object.freeze({
  fresh: 'Señal vigente',
  stale: 'Señal vencida',
  missing: 'Sin señal',
  unavailable: 'Señal no disponible',
});

const BLOCK_REASON_LABELS = Object.freeze({
  NO_ACTIVE_RIDERS: 'No hay Riders con turno activo.',
  NO_ACTIVE_SHIFT: 'El Rider no tiene un turno activo.',
  PAUSED_OR_ENDED: 'El turno está pausado o finalizado.',
  MEMBERSHIP_INACTIVE: 'La membresía Rider no está activa.',
  RIDER_BLOCKED: 'El Rider tiene un bloqueo operativo.',
  HEARTBEAT_STALE: 'La señal de actividad del Rider está vencida.',
  GPS_STALE: 'La ubicación operativa privada está vencida.',
  GPS_INACCURATE: 'La ubicación operativa no tiene precisión suficiente.',
  ZONE_MISMATCH: 'No hay cobertura activa para la zona del pedido.',
  ZONE_UNCOVERED: 'No hay cobertura activa para la zona del pedido.',
  AT_CAPACITY: 'Los Riders disponibles alcanzaron su capacidad.',
  CAPACITY_FULL: 'Los Riders disponibles alcanzaron su capacidad.',
  OFFER_ALREADY_PENDING: 'El Rider ya tiene otra oferta pendiente.',
  ALREADY_OFFERED: 'Los Riders elegibles ya recibieron una oferta en esta ronda.',
  PICKUP_LOCATION_UNAVAILABLE: 'Falta confirmar la ubicación operativa del retiro.',
  DESTINATION_LOCATION_UNAVAILABLE: 'Falta confirmar la ubicación operativa de destino.',
  ALL_REJECTED: 'Todos los Riders elegibles rechazaron la oferta.',
  OFFER_TIMEOUTS: 'Las ofertas vencieron sin aceptación.',
  WORKER_STALLED: 'El procesador automático no está avanzando.',
});

const EVENT_LABELS = Object.freeze({
  job_queued: 'Pedido listo: se creó el trabajo de asignación.',
  queued: 'El trabajo quedó en cola.',
  ranking_started: 'El servidor evaluó y ordenó candidatos.',
  ranking: 'El servidor evaluó y ordenó candidatos.',
  offer_created: 'Se envió una oferta temporal.',
  offered: 'Se envió una oferta temporal.',
  offer_rejected: 'El Rider rechazó la oferta.',
  rejected: 'El Rider rechazó la oferta.',
  offer_expired: 'La oferta venció sin aceptación.',
  expired: 'La oferta venció sin aceptación.',
  offer_revoked: 'La oferta fue revocada por un cambio operativo.',
  revoked: 'La oferta fue revocada por un cambio operativo.',
  no_rider_available: 'No hubo un Rider elegible en esta ronda.',
  offer_accepted: 'Un Rider aceptó la oferta.',
  accepted: 'Un Rider aceptó la oferta.',
  claimed: 'El pedido quedó asignado.',
  manual_override: 'La asignación se resolvió mediante override manual auditado.',
  completed: 'La entrega cerró el trabajo de asignación.',
  cancelled: 'El trabajo de asignación fue cancelado.',
});

const ALERT_LABELS = Object.freeze({
  DISPATCH_WORKER_STALE: 'El procesador automático no está enviando señal.',
  DISPATCH_JOB_STALLED: 'Hay un pedido listo que no avanza en la asignación.',
  NO_ELIGIBLE_RIDER: 'No hay Riders elegibles para uno o más pedidos.',
  OFFER_TIMEOUT_BURST: 'Varias ofertas vencieron sin respuesta.',
  DISPATCH_INVARIANT_BREACH: 'El servidor detectó una inconsistencia de asignación.',
  RIDER_HEARTBEAT_STALE: 'Uno o más Riders dejaron de enviar señal de actividad.',
});

const TERMINAL_JOB_STATES = new Set(['claimed', 'completed', 'cancelled']);

export function renderBusinessDispatchPanel({ snapshot, status, role, busy = false, overrideDrafts } = {}) {
  if (status?.phase === 'loading' && !snapshot) {
    return panel('Riders ahora', 'Estado autoritativo de turnos y asignaciones.', '<p class="form-hint" aria-live="polite">Consultando al servidor…</p>');
  }
  if (status?.phase === 'error' && !snapshot) {
    return panel('Riders ahora', 'Estado autoritativo de turnos y asignaciones.', `
      <p class="production-intake-error" role="alert">${escapeHtml(status.message || 'No pudimos leer el control de dispatch.')}</p>
      <button class="primary-button" type="button" data-dispatch-refresh>Reintentar</button>`);
  }

  const control = normalizeBusinessDispatchControl(snapshot);
  const staleWarning = status?.phase === 'error'
    ? `<p class="production-intake-error" role="alert">La última actualización falló. Estos datos pueden estar vencidos. ${escapeHtml(status.message || '')}</p>`
    : '';

  return panel('Riders ahora', 'Turnos, asignaciones y bloqueos calculados por el servidor.', `
    <div class="business-dispatch-toolbar">
      <span class="form-hint">Actualizado ${escapeHtml(formatTimestamp(control.generatedAt || control.serverNow))}</span>
      <button class="ghost-button compact" type="button" data-dispatch-refresh ${busy ? 'disabled' : ''}>Actualizar</button>
    </div>
    ${staleWarning}
    ${renderDispatchMetrics(control.metrics)}
    <section class="business-dispatch-section" aria-labelledby="business-dispatch-riders-title">
      <header><h3 id="business-dispatch-riders-title">Riders ahora</h3><span>${control.riders.length}</span></header>
      ${renderRiders(control.riders)}
    </section>
    <section class="business-dispatch-section" aria-labelledby="business-dispatch-jobs-title">
      <header><h3 id="business-dispatch-jobs-title">Asignación de pedidos</h3><span>${control.jobs.length}</span></header>
      ${renderJobs(control, { role, busy, overrideDrafts })}
    </section>
    ${renderDispatchAlerts(control.alerts)}
  `);
}

export function normalizeBusinessDispatchControl(snapshot) {
  const source = snapshot && !Array.isArray(snapshot) && typeof snapshot === 'object' ? snapshot : {};
  return Object.freeze({
    serverNow: safeTimestamp(source.server_now),
    generatedAt: safeTimestamp(source.generated_at),
    riders: Object.freeze(safeArray(source.riders).map(normalizeRider)),
    jobs: Object.freeze(safeArray(source.jobs).map(normalizeJob)),
    metrics: source.metrics && !Array.isArray(source.metrics) && typeof source.metrics === 'object' ? source.metrics : {},
    alerts: Object.freeze(safeArray(source.alerts).map(normalizeAlert)),
    overrideCandidates: Object.freeze(safeArray(source.override_candidates).map(normalizeCandidate).filter((candidate) => candidate.id)),
  });
}

function normalizeRider(row, index) {
  const source = row && typeof row === 'object' ? row : {};
  const id = safeIdentifier(source.rider_user_id || source.user_id || source.id);
  const eligibility = explicitEligibility(source);
  return Object.freeze({
    id,
    reference: riderReference(id, index),
    shiftStatus: safeCode(source.shift_status || source.shift?.status),
    availability: safeCode(source.availability || source.shift?.availability),
    eligibility,
    exclusionCodes: Object.freeze(reasonCodes(source.exclusion_codes || source.blocking_reasons || source.eligibility?.exclusion_codes)),
    activeOrders: safeInteger(source.current_active_orders ?? source.active_orders ?? source.shift?.current_active_orders),
    capacity: safeInteger(source.max_concurrent_orders ?? source.capacity ?? source.shift?.max_concurrent_orders),
    assignmentCount: safeInteger(source.assignments_in_window ?? source.assignments_last_4h),
    heartbeatStatus: safeCode(source.heartbeat_status || source.presence_status || source.presence?.heartbeat_state),
    canReceiveOverride: source.can_receive_override === true || source.manual_override_allowed === true || eligibility === true,
  });
}

function normalizeJob(row, index) {
  const source = row && typeof row === 'object' ? row : {};
  const orderId = safeIdentifier(source.order_id);
  const id = safeIdentifier(source.job_id || source.id);
  const state = safeCode(source.state || source.status || source.job_status);
  return Object.freeze({
    id,
    orderId,
    reference: orderReference(source.order_code || source.public_code, orderId, index),
    revision: safeInteger(source.revision ?? source.job_revision),
    state,
    round: safeInteger(source.round ?? source.round_number ?? source.round_no),
    readyAt: safeTimestamp(source.ready_at),
    createdAt: safeTimestamp(source.created_at || source.queued_at),
    nextAttemptAt: safeTimestamp(source.next_attempt_at),
    leaseExpiresAt: safeTimestamp(source.lease_expires_at || source.active_offer?.lease_expires_at || source.offer?.lease_expires_at),
    offeredRiderId: safeIdentifier(source.offered_rider_user_id || source.active_offer?.rider_user_id || source.offer?.rider_user_id),
    assignedRiderId: safeIdentifier(source.assigned_rider_user_id),
    blockingCodes: Object.freeze(reasonCodes(source.blocking_reasons || source.last_failure_code || source.block_reason_code)),
    timeline: Object.freeze(safeArray(source.timeline || source.events || source.dispatch_events).map(normalizeTimelineEvent)),
    overrideCandidates: Object.freeze([
      ...safeArray(source.override_candidates),
      ...safeArray(source.candidates).filter((candidate) => candidate?.eligible === true),
    ].map(normalizeCandidate).filter((candidate) => candidate.id)),
    manualOverrideAllowed: source.manual_override_allowed !== false && !TERMINAL_JOB_STATES.has(state),
  });
}

function normalizeTimelineEvent(row) {
  const source = row && typeof row === 'object' ? row : {};
  return Object.freeze({
    code: safeCode(source.event_type || source.type || source.status || source.code),
    at: safeTimestamp(source.occurred_at || source.created_at || source.at),
    reasonCodes: Object.freeze(reasonCodes(
      source.reason_codes || source.reason_code || source.failure_code
      || source.detail?.reason_codes || source.detail?.reason_code || source.detail?.failure_code,
    )),
  });
}

function normalizeCandidate(row) {
  if (typeof row === 'string') return Object.freeze({ id: safeIdentifier(row) });
  const source = row && typeof row === 'object' ? row : {};
  return Object.freeze({ id: safeIdentifier(source.rider_user_id || source.user_id || source.id) });
}

function normalizeAlert(row) {
  const source = row && typeof row === 'object' ? row : {};
  return Object.freeze({
    code: safeCode(source.code),
    severity: safeCode(source.severity).toLowerCase(),
    occurredAt: safeTimestamp(source.last_occurred_at || source.last_seen_at || source.created_at),
    occurrenceCount: safeInteger(source.occurrence_count),
  });
}

function renderDispatchMetrics(metrics) {
  const cards = [
    metricCard('backlog', 'Trabajos en cola', integerMetric(metrics, ['backlog', 'backlog_jobs', 'queued_jobs'])),
    metricCard('no-rider', 'Sin Rider', integerMetric(metrics, ['no_rider', 'no_rider_jobs', 'no_rider_available'])),
    metricCard('active-riders', 'Riders activos', integerMetric(metrics, ['active_riders', 'riders_active'])),
    metricCard('stale-riders', 'Riders sin señal', integerMetric(metrics, ['stale_riders', 'riders_stale'])),
    metricCard('ready-job-p95', 'Listo → trabajo p95', durationMetric(metrics, ['ready_to_job_p95_ms'], ['ready_to_job_seconds_p95'])),
    metricCard('first-offer-p95', 'Trabajo → oferta p95', durationMetric(metrics, ['job_to_first_offer_p95_ms', 'ready_to_first_offer_p95_ms', 'first_offer_p95_ms'], ['job_to_first_offer_seconds_p95'])),
    metricCard('accept-p95', 'Oferta → aceptación p95', durationMetric(metrics, ['offer_to_accept_p95_ms', 'accept_p95_ms'], ['offer_to_accept_seconds_p95'])),
    metricCard('fairness', 'Equidad Jain', decimalMetric(metrics, ['jain_fairness', 'fairness_jain'], 3)),
  ].join('');
  return `<section class="business-dispatch-metrics" aria-label="Métricas de dispatch">${cards}</section>`;
}

function metricCard(key, label, value) {
  return `<article data-dispatch-metric="${escapeHtml(key)}"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></article>`;
}

function renderRiders(riders) {
  if (!riders.length) return '<p class="form-hint">El servidor no informó Riders para este negocio.</p>';
  return `<div class="business-dispatch-riders">${riders.map((rider) => {
    const eligibility = rider.eligibility === true
      ? '<span class="business-status success">Elegible</span>'
      : rider.eligibility === false
        ? '<span class="business-status warning">No elegible</span>'
        : '<span class="business-status">Sin evaluación</span>';
    const reasons = rider.exclusionCodes.length
      ? `<ul>${rider.exclusionCodes.map((code) => `<li>${escapeHtml(blockReasonText(code))}</li>`).join('')}</ul>`
      : '';
    const load = rider.activeOrders === null || rider.capacity === null ? 'Carga no informada' : `${rider.activeOrders}/${rider.capacity} entregas`;
    return `<article class="business-dispatch-rider" data-dispatch-rider="${escapeHtml(rider.id)}">
      <header><strong>${escapeHtml(rider.reference)}</strong>${eligibility}</header>
      <p>${escapeHtml(codeLabel(SHIFT_STATE_LABELS, rider.shiftStatus, 'Turno sin informar'))} · ${escapeHtml(codeLabel(AVAILABILITY_LABELS, rider.availability, 'Disponibilidad sin informar'))}</p>
      <small>${escapeHtml(codeLabel(PRESENCE_STATE_LABELS, rider.heartbeatStatus, 'Señal sin informar'))}</small>
      <small>${escapeHtml(load)}${rider.assignmentCount === null ? '' : ` · ${escapeHtml(String(rider.assignmentCount))} asignaciones recientes`}</small>
      ${reasons}
    </article>`;
  }).join('')}</div>`;
}

function renderJobs(control, options) {
  if (!control.jobs.length) return '<p class="form-hint">No hay trabajos de asignación para mostrar.</p>';
  return `<div class="business-dispatch-jobs">${control.jobs.map((job) => renderJob(control, job, options)).join('')}</div>`;
}

function renderJob(control, job, { role, busy, overrideDrafts }) {
  const stateLabel = codeLabel(JOB_STATE_LABELS, job.state, 'Estado confirmado por servidor');
  const blocking = job.blockingCodes.length
    ? `<div class="business-dispatch-block" role="status"><strong>Por qué no avanza</strong><ul>${job.blockingCodes.map((code) => `<li>${escapeHtml(blockReasonText(code))}</li>`).join('')}</ul>${job.nextAttemptAt ? `<small>Próximo intento ${escapeHtml(formatTimestamp(job.nextAttemptAt))}</small>` : ''}</div>`
    : '';
  const offer = job.leaseExpiresAt
    ? `<p class="business-dispatch-offer">Oferta a ${escapeHtml(riderReference(job.offeredRiderId))} · vence ${escapeHtml(formatTimestamp(job.leaseExpiresAt))}</p>`
    : job.assignedRiderId
      ? `<p class="business-dispatch-offer">Asignado a ${escapeHtml(riderReference(job.assignedRiderId))}</p>`
      : '';
  const timeline = renderTimeline(job);
  const override = renderManualOverride(control, job, { role, busy, overrideDrafts });
  return `<article class="business-dispatch-job tone-${escapeHtml(job.state || 'unknown')}" data-dispatch-job="${escapeHtml(job.id || job.orderId)}">
    <header><div><span class="eyebrow">${escapeHtml(job.reference)}</span><h4>${escapeHtml(stateLabel)}</h4></div><span class="business-status">Ronda ${escapeHtml(String(job.round ?? '—'))}</span></header>
    <p class="form-hint">Listo ${escapeHtml(formatTimestamp(job.readyAt || job.createdAt))}</p>
    ${offer}${blocking}${timeline}${override}
  </article>`;
}

function renderTimeline(job) {
  const entries = job.timeline.length
    ? job.timeline
    : [{ code: job.state, at: job.createdAt || job.readyAt, reasonCodes: job.blockingCodes }];
  return `<ol class="business-dispatch-timeline" aria-label="Historial de asignación">${entries.map((entry) => {
    const label = EVENT_LABELS[entry.code] || JOB_STATE_LABELS[entry.code] || 'Actualización registrada por el servidor.';
    const reason = entry.reasonCodes.length ? ` ${entry.reasonCodes.map(blockReasonText).join(' ')}` : '';
    return `<li><span aria-hidden="true"></span><div><strong>${escapeHtml(label)}</strong><small>${escapeHtml(formatTimestamp(entry.at))}${escapeHtml(reason)}</small></div></li>`;
  }).join('')}</ol>`;
}

function renderManualOverride(control, job, { role, busy, overrideDrafts }) {
  if (!can(role, 'orders.advance') || !job.manualOverrideAllowed || !job.orderId || job.revision === null) return '';
  const candidates = job.overrideCandidates.length
    ? job.overrideCandidates
    : control.overrideCandidates.length
      ? control.overrideCandidates
      : control.riders.filter((rider) => rider.canReceiveOverride).map((rider) => ({ id: rider.id }));
  const uniqueCandidates = [...new Map(candidates.filter((candidate) => candidate.id).map((candidate) => [candidate.id, candidate])).values()];
  const draft = draftFor(overrideDrafts, job.orderId);
  const options = uniqueCandidates.map((candidate, index) => `<option value="${escapeHtml(candidate.id)}"${draft.riderUserId === candidate.id ? ' selected' : ''}>${escapeHtml(riderReference(candidate.id, index))}</option>`).join('');
  return `<details class="business-dispatch-override" data-dispatch-override-form="${escapeHtml(job.orderId)}">
    <summary>Override manual</summary>
    <p class="form-hint">Fallback auditado: el servidor vuelve a validar turno, señal, zona y capacidad.</p>
    <div class="business-dispatch-override-form">
      <label>Rider<select name="dispatchOverrideRider" ${options ? '' : 'disabled'}>${options || '<option value="">No hay candidatos autorizados por el servidor</option>'}</select></label>
      <label>Motivo<input name="dispatchOverrideReason" minlength="8" maxlength="500" autocomplete="off" value="${escapeHtml(draft.reason)}" placeholder="Explicá por qué intervenís"></label>
      <button class="secondary-button compact" type="button" data-dispatch-manual-override="${escapeHtml(job.orderId)}" data-dispatch-job-revision="${escapeHtml(String(job.revision))}" ${busy || !options ? 'disabled' : ''}>Asignar manualmente</button>
    </div>
  </details>`;
}

function renderDispatchAlerts(alerts) {
  if (!alerts.length) return '';
  return `<section class="business-dispatch-section" aria-labelledby="business-dispatch-alerts-title"><header><h3 id="business-dispatch-alerts-title">Alertas de dispatch</h3><span>${alerts.length}</span></header><div class="business-dispatch-alerts">${alerts.map((alert) => `<article class="business-dispatch-alert severity-${escapeHtml(alert.severity || 'warning')}"><strong>${escapeHtml(ALERT_LABELS[alert.code] || 'El servidor registró una alerta de asignación.')}</strong><small>${escapeHtml(formatTimestamp(alert.occurredAt))}${alert.occurrenceCount && alert.occurrenceCount > 1 ? ` · ${escapeHtml(String(alert.occurrenceCount))} veces` : ''}</small></article>`).join('')}</div></section>`;
}

function explicitEligibility(source) {
  const value = source.is_eligible ?? source.eligible ?? source.eligibility?.is_eligible ?? source.eligibility_status;
  if (value === true || value === 'eligible') return true;
  if (value === false || value === 'excluded' || value === 'ineligible') return false;
  return null;
}

function reasonCodes(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(values.map((entry) => safeCode(typeof entry === 'object' ? entry?.code : entry)).filter(Boolean))];
}

function blockReasonText(code) {
  return BLOCK_REASON_LABELS[code] || 'El servidor registró un bloqueo operativo.';
}

function riderReference(id, index = null) {
  const suffix = String(id || '').replace(/[^A-Za-z0-9]/g, '').slice(-6).toUpperCase();
  if (suffix) return `Rider · ${suffix}`;
  return index === null ? 'Rider' : `Rider ${index + 1}`;
}

function orderReference(code, orderId, index) {
  const safeCodeValue = /^[A-Za-z0-9_-]{1,32}$/.test(String(code || '')) ? String(code) : '';
  if (safeCodeValue) return `Pedido ${safeCodeValue}`;
  const suffix = String(orderId || '').replace(/[^A-Za-z0-9]/g, '').slice(-8).toUpperCase();
  return suffix ? `Pedido · ${suffix}` : `Pedido ${index + 1}`;
}

function draftFor(drafts, orderId) {
  const value = drafts?.get?.(orderId) || drafts?.[orderId] || {};
  return {
    riderUserId: safeIdentifier(value.riderUserId || value.rider_user_id),
    reason: String(value.reason || '').slice(0, 500),
  };
}

function integerMetric(metrics, aliases) {
  const value = metric(metrics, aliases);
  return Number.isFinite(value) ? String(Math.max(0, Math.trunc(value))) : '—';
}

function decimalMetric(metrics, aliases, digits = 2) {
  const value = metric(metrics, aliases);
  return Number.isFinite(value) ? value.toFixed(digits).replace(/\.?0+$/, '') : '—';
}

function durationMetric(metrics, millisecondAliases, secondAliases = []) {
  let value = metric(metrics, millisecondAliases);
  if (!Number.isFinite(value)) {
    const seconds = metric(metrics, secondAliases);
    value = Number.isFinite(seconds) ? seconds * 1000 : NaN;
  }
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} s`;
  return `${(value / 60_000).toFixed(1)} min`;
}

function metric(metrics, aliases) {
  for (const key of aliases) {
    if (!Object.hasOwn(metrics || {}, key) || metrics[key] === null || metrics[key] === '') continue;
    const value = Number(metrics?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return NaN;
}

function safeArray(value) { return Array.isArray(value) ? value : []; }
function safeCode(value) { return /^[A-Za-z0-9_-]{1,80}$/.test(String(value || '')) ? String(value) : ''; }
function safeIdentifier(value) { return /^[A-Za-z0-9_-]{1,128}$/.test(String(value || '')) ? String(value) : ''; }
function safeInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}
function safeTimestamp(value) { const text = String(value || ''); return text && Number.isFinite(Date.parse(text)) ? text : ''; }
function codeLabel(library, code, fallback) { return library[code] || fallback; }
function formatTimestamp(value) {
  if (!value) return 'sin hora confirmada';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'sin hora confirmada';
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}
function panel(title, subtitle, body) {
  return `<section class="business-ops-panel business-dispatch-panel" data-business-dispatch><header><div><p class="eyebrow">Centro operativo</p><h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div></header>${body}</section>`;
}
