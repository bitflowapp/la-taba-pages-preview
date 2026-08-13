// Superficies del panel del negocio. Son funciones puras: reciben estado y devuelven HTML.
// El controlador (business-operations-center.js) mantiene el estado y despacha las acciones.

import { escapeHtml } from '../ui.js';
import { can, describeRoleScope, isElevated, roleLabel } from './business-capabilities.js';
import {
  describeMetrics, describeOperationalAlert, describeOperationalHealth,
  sortAlertsByUrgency, summarizeOperation,
} from './business-operation-language.js';
import {
  classifyBusinessPayment, evaluateMercadoPagoSetup, paymentActionsFor, REFUND_CONFIRMATION_PHRASE,
} from './business-payments-console.js';
import { ARCA_HOMOLOGATION_PHRASE, evaluateArcaActivation } from './business-fiscal-assistant.js';
import { DEVICE_CHECKS, summarizeDeviceChecks } from './business-device-check.js';
import {
  CLOSURE_CONFIRMATION_PHRASE, evaluateBusinessOpening, evaluateDailyClosure,
} from './business-day-control.js';
import {
  buildStorefrontPreview, CAPACITY_UNITS, describePublishReadiness, PACKAGE_TYPES, stepsForDraft,
} from './business-product-onboarding.js';

export function renderOperationCenterSurface({ snapshot, status, role, busy, support } = {}) {
  if (status?.phase === 'loading' && !snapshot) {
    return panel('Centro de operación', 'Mirando cómo viene el día.', '<p class="form-hint" aria-live="polite">Un segundo…</p>');
  }
  if (status?.phase === 'error' && !snapshot) {
    return panel('Centro de operación', 'No confirmamos nada que no hayamos podido leer.', `
      <p class="production-intake-error" role="alert">${escapeHtml(status.message || 'No pudimos leer el estado del negocio.')}</p>
      <button class="primary-button" type="button" data-operation-center-refresh>Reintentar</button>`);
  }
  const data = snapshot || { metrics: {}, alerts: [], recent_closures: [] };
  const summary = summarizeOperation(data);
  const cards = describeMetrics(data.metrics || {}).map((card) => `
    <button class="operation-metric tone-${escapeHtml(card.tone)}" type="button"
      data-business-ops-view="${escapeHtml(card.view)}" data-operation-metric="${escapeHtml(card.key)}">
      <strong>${escapeHtml(String(card.value))}</strong>
      <span>${escapeHtml(card.label)}</span>
      <small>${escapeHtml(card.hint)}</small>
    </button>`).join('');
  const alerts = sortAlertsByUrgency(data.alerts || []);
  const alertMarkup = alerts.length
    ? alerts.map((alert) => renderAlertCard(alert, { busy })).join('')
    : '<p class="form-hint">No hay nada pendiente que necesite una persona ahora mismo.</p>';

  return panel('Centro de operación', 'Lo que hay que mirar primero, en orden.', `
    <div class="operation-summary tone-${escapeHtml(summary.tone)}" role="status">
      <strong>${escapeHtml(summary.headline)}</strong>
      <span>${escapeHtml(summary.detail)}</span>
    </div>
    <div class="operation-center-toolbar">
      <span class="form-hint">Actualizado ${escapeHtml(formatTimestamp(data.generated_at))}</span>
      <button class="ghost-button compact" type="button" data-operation-center-refresh ${busy ? 'disabled' : ''}>Actualizar</button>
    </div>
    <div class="operation-metrics-grid" aria-label="Resumen del día">${cards}</div>
    <section class="operation-alerts" aria-labelledby="operation-alerts-title">
      <h3 id="operation-alerts-title">Qué resolver</h3>${alertMarkup}
    </section>
    ${renderOperationalHealth(data.health)}
    ${renderSupportSection(support, busy)}
    ${renderRoleFooter(role)}`);
}

/**
 * «Qué resolver» vacío puede querer decir dos cosas muy distintas: que no pasa
 * nada, o que hace seis horas que nadie mira. Esta sección es la que las separa,
 * y todo lo que dice sale de datos medidos en el servidor.
 */
function renderOperationalHealth(health) {
  const described = describeOperationalHealth(health);
  const rows = described.rows.map((row) => `
    <div class="operation-health-row tone-${escapeHtml(row.tone)}" data-operation-health="${escapeHtml(row.key)}">
      <dt>${escapeHtml(row.label)}</dt>
      <dd>
        <strong data-operation-health-value>${escapeHtml(row.value)}</strong>
        <small>${escapeHtml(row.detail)}</small>
      </dd>
    </div>`).join('');

  return `<section class="operation-health tone-${escapeHtml(described.tone)}"
    data-operation-health-section="${described.available ? 'medido' : 'sin-datos'}"
    aria-labelledby="operation-health-title">
    <h3 id="operation-health-title">Cómo viene el sistema</h3>
    <p class="operation-health-headline" role="status">
      <strong>${escapeHtml(described.headline)}</strong>
      <span>${escapeHtml(described.detail)}</span>
    </p>
    ${rows ? `<dl class="operation-health-grid">${rows}</dl>` : ''}
  </section>`;
}

function renderSupportSection(support, busy) {
  if (!support?.isNative) {
    return `<section class="operation-support">
      <h3>Respaldo y soporte</h3>
      <p class="form-hint">El respaldo del día y el diagnóstico para soporte se hacen desde TABA para Windows.</p>
    </section>`;
  }
  const update = support.signedUpdate;
  return `<section class="operation-support" aria-labelledby="operation-support-title">
    <h3 id="operation-support-title">Respaldo y soporte</h3>
    <p class="form-hint">El respaldo protege lo que todavía no se sincronizó. El diagnóstico no incluye datos de clientes.</p>
    <div class="button-row">
      <button class="secondary-button compact" type="button" data-local-backup-create ${busy ? 'disabled' : ''}>Guardar respaldo del día</button>
      <button class="ghost-button compact" type="button" data-support-diagnostic-export ${busy ? 'disabled' : ''}>Preparar diagnóstico</button>
      <button class="ghost-button compact" type="button" data-support-export-folder>Abrir la carpeta</button>
      <button class="ghost-button compact" type="button" data-signed-update-check ${busy ? 'disabled' : ''}>Buscar actualización</button>
      ${update?.available
        ? `<button class="primary-button compact" type="button" data-signed-update-install="${escapeHtml(String(update.version || ''))}">Instalar ${escapeHtml(String(update.version || ''))} y reiniciar</button>`
        : ''}
    </div>
  </section>`;
}

function renderAlertCard(alert, { busy } = {}) {
  const described = describeOperationalAlert(alert);
  const canAct = described.status === 'open';
  return `<article class="operation-alert severity-${escapeHtml(described.severity.toLowerCase())}" data-operational-alert="${escapeHtml(described.id)}">
    <header>
      <span class="operation-alert-severity">${escapeHtml(described.severityLabel)}</span>
      <span class="operation-alert-status">${escapeHtml(described.statusLabel)}</span>
    </header>
    <h4>${escapeHtml(described.happened)}</h4>
    <dl class="operation-alert-facts">
      <div><dt>Qué se conserva</dt><dd>${escapeHtml(described.preserved)}</dd></div>
      <div><dt>Riesgo</dt><dd>${escapeHtml(described.risk)}</dd></div>
      <div><dt>Qué conviene hacer</dt><dd>${escapeHtml(described.recommendation)}</dd></div>
    </dl>
    ${described.repeated ? `<p class="form-hint">${escapeHtml(described.repeated)}</p>` : ''}
    <div class="button-row">
      <button class="primary-button compact" type="button" data-business-ops-view="${escapeHtml(described.action.view)}">${escapeHtml(described.action.label)}</button>
      ${canAct ? `<button class="ghost-button compact" type="button" data-operational-alert-acknowledge="${escapeHtml(described.id)}" ${busy ? 'disabled' : ''}>Ya la vi</button>` : ''}
    </div>
    <details class="operation-alert-support">
      <summary>Detalle para soporte</summary>
      <p class="form-hint">Referencia ${escapeHtml(described.support.reference)}${described.support.trace ? ` · rastro ${escapeHtml(described.support.trace)}` : ''}</p>
      <label>Qué verificaste o corregiste
        <input name="operationalResolutionNote" maxlength="500" placeholder="Ej: reconcilié el pago y armé el pedido">
      </label>
      <button class="secondary-button compact" type="button" data-operational-alert-resolve="${escapeHtml(described.id)}" ${busy ? 'disabled' : ''}>Marcar como resuelta</button>
    </details>
  </article>`;
}

export function renderPaymentsSurface({ payments, status, role, activation, busy, refundTarget } = {}) {
  if (!can(role, 'payments.view')) return deniedPanel('Pagos', 'Tu rol no incluye la consulta de pagos.');
  const setup = evaluateMercadoPagoSetup(activation || {});
  const elevated = isElevated(role);
  const rows = Array.isArray(payments) ? payments : [];
  const body = rows.length
    ? rows.map((payment) => renderPaymentCard(payment, { elevated, busy, refundTarget })).join('')
    : status?.phase === 'loading'
      ? '<p class="form-hint">Buscando los pagos del día…</p>'
      : status?.phase === 'error'
        ? `<p class="production-intake-error">${escapeHtml(status.message || 'No pudimos leer los pagos.')}</p>`
        : '<p class="form-hint">Todavía no hay pagos para mostrar hoy.</p>';

  return panel('Pagos', 'Lo que entró hoy y qué hacer con cada caso.', `
    <div class="operation-summary tone-${setup.ready ? 'calm' : 'attention'}" role="status">
      <strong>${escapeHtml(setup.headline)}</strong>
      <span>Modo ${escapeHtml(setup.environment)}.</span>
      ${setup.ready ? '' : '<button class="primary-button compact" type="button" data-business-ops-view="payments-setup">Terminar de conectar</button>'}
    </div>
    ${setup.warnings.map((warning) => `<p class="production-intake-error">${escapeHtml(warning)}</p>`).join('')}
    <div class="operation-center-toolbar">
      <span class="form-hint">${rows.length} pago(s) listados</span>
      <button class="ghost-button compact" type="button" data-payments-refresh ${busy ? 'disabled' : ''}>Actualizar</button>
    </div>
    <div class="production-payment-list" aria-live="polite">${body}</div>`);
}

function renderPaymentCard(payment, { elevated, busy, refundTarget } = {}) {
  const classified = classifyBusinessPayment(payment);
  const id = String(payment.payment_intent_id || '');
  const actions = paymentActionsFor(payment, { elevated }).map((action) => `
    <button class="${action.kind === 'elevated' ? 'secondary-button' : 'ghost-button'} compact" type="button"
      data-payment-action="${escapeHtml(action.id)}" data-payment-intent="${escapeHtml(id)}"
      title="${escapeHtml(action.hint)}" ${busy ? 'disabled' : ''}>${escapeHtml(action.label)}</button>`).join('');
  const refundForm = refundTarget === id ? `
    <div class="business-ops-form payment-refund-form" data-payment-refund-form="${escapeHtml(id)}">
      <p class="production-intake-error">Devolver dinero no se puede deshacer.</p>
      <label>Importe a devolver <small>(vacío = todo)</small><input name="refundAmount" type="number" min="0" step="0.01" inputmode="decimal"></label>
      <label>Motivo<input name="refundReason" maxlength="200" placeholder="Ej: faltó un producto en la entrega"></label>
      <label>Escribí ${escapeHtml(REFUND_CONFIRMATION_PHRASE)} para confirmar<input name="refundConfirmation" maxlength="16" autocomplete="off"></label>
      <div class="button-row">
        <button class="secondary-button compact" type="button" data-payment-refund-confirm="${escapeHtml(id)}" ${busy ? 'disabled' : ''}>Devolver el dinero</button>
        <button class="ghost-button compact" type="button" data-payment-refund-cancel>Mejor no</button>
      </div>
    </div>` : '';

  return `<article class="production-payment-card tone-${escapeHtml(classified.tone)}" data-payment-card="${escapeHtml(id)}">
    <div class="production-order-head">
      <div>
        <span class="production-order-code">${escapeHtml(classified.orderLabel)}</span>
        <strong>${escapeHtml(classified.label)}</strong>
      </div>
      <span class="status-pill ${escapeHtml(classified.tone)}">${escapeHtml(formatMoney(payment.amount, payment.currency))}</span>
    </div>
    <p>${escapeHtml(classified.detail)}</p>
    <dl class="production-order-meta">
      <div><dt>Cuándo</dt><dd>${escapeHtml(formatTimestamp(payment.approved_at || payment.created_at))}</dd></div>
      <div><dt>Medio</dt><dd>${escapeHtml(String(payment.method || 'Mercado Pago'))}</dd></div>
      <div><dt>Devuelto</dt><dd>${escapeHtml(Number(payment.refunded_amount || 0) > 0 ? formatMoney(payment.refunded_amount, payment.currency) : 'Nada')}</dd></div>
    </dl>
    ${classified.blocksDelivery ? '<p class="production-intake-error">No entregues hasta resolver este pago.</p>' : ''}
    ${payment.documentation_required ? '<p class="production-intake-error">El cliente abrió un reclamo y hay que mandar documentación.</p>' : ''}
    ${actions ? `<div class="button-row">${actions}</div>` : '<p class="form-hint">No hay acciones disponibles para este estado.</p>'}
    ${refundForm}
    <details class="operation-alert-support">
      <summary>Detalle para soporte</summary>
      <p class="form-hint">Pago ${escapeHtml(payment.payment_id_short ? `••••${payment.payment_id_short}` : 'todavía sin identificar')}</p>
    </details>
  </article>`;
}

export function renderPaymentsSetupSurface({ activation, role, busy } = {}) {
  if (!can(role, 'payments.reconcile')) {
    return deniedPanel('Conectar Mercado Pago', 'La conexión de cobros la hace el dueño o el encargado.');
  }
  const setup = evaluateMercadoPagoSetup(activation || {});
  const steps = setup.steps.map((step) => renderWizardStep(step)).join('');
  return panel('Conectar Mercado Pago', 'Siete pasos. Cada uno se marca solo cuando se comprueba de verdad.', `
    <div class="operation-summary tone-${setup.ready ? 'calm' : 'attention'}" role="status">
      <strong>${escapeHtml(setup.headline)}</strong>
      <span>Modo ${escapeHtml(setup.environment)}. Las pruebas no mueven dinero real.</span>
    </div>
    ${setup.warnings.map((warning) => `<p class="production-intake-error">${escapeHtml(warning)}</p>`).join('')}
    <ol class="business-wizard">${steps}</ol>
    <section class="business-ops-form" aria-label="Datos de la cuenta">
      <p class="form-hint">El Access Token nunca se guarda ni se muestra en el panel: vive sólo en el servidor de cobros.</p>
      <label>Número de vendedor<input name="collectorId" inputmode="numeric" maxlength="32" placeholder="Sólo números"></label>
      <label>Número de aplicación<input name="applicationId" inputmode="numeric" maxlength="32" placeholder="Sólo números"></label>
      <button class="primary-button" type="button" data-mercadopago-settings-save ${busy ? 'disabled' : ''}>Guardar datos de la cuenta</button>
    </section>
    <div class="button-row">
      <button class="secondary-button compact" type="button" data-mercadopago-status-refresh ${busy ? 'disabled' : ''}>Volver a verificar</button>
      ${setup.ready ? '' : `<button class="ghost-button compact" type="button" data-mercadopago-enable ${busy ? 'disabled' : ''}>Activar cobros de prueba</button>`}
    </div>`);
}

export function renderFiscalSetupSurface({ activation, role, busy, authorizationDraft } = {}) {
  if (!can(role, 'fiscal.configure')) {
    return deniedPanel('Facturación', 'La configuración fiscal la define el dueño o el encargado con el contador.');
  }
  const arca = evaluateArcaActivation(activation || {});
  const board = arca.board.map((row) => `
    <article class="fiscal-board-card tone-${escapeHtml(row.tone)}">
      <span>${escapeHtml(row.label)}</span>
      <strong>${escapeHtml(row.value)}</strong>
      ${row.detail ? `<small>${escapeHtml(row.detail)}</small>` : ''}
    </article>`).join('');
  const gate = arca.homologationAuthorized
    ? '<p class="form-hint">Las pruebas con ARCA ya están autorizadas.</p>'
    : `<div class="business-ops-form">
        <p>Para empezar a probar con ARCA hace falta una autorización explícita.</p>
        <label>Escribí ${escapeHtml(ARCA_HOMOLOGATION_PHRASE)}
          <input name="arcaAuthorization" maxlength="40" autocomplete="off" value="${escapeHtml(String(authorizationDraft || ''))}">
        </label>
        <button class="primary-button" type="button" data-arca-authorize ${busy || !arca.readyToHomologate ? 'disabled' : ''}>Habilitar pruebas con ARCA</button>
        ${arca.readyToHomologate ? '' : '<p class="form-hint">Se habilita cuando los primeros cinco pasos estén completos.</p>'}
      </div>`;

  return panel('Facturación', 'Diez pasos para dejar la facturación lista, sin tocar la facturación real.', `
    <div class="operation-summary tone-${arca.homologationComplete ? 'calm' : 'attention'}" role="status">
      <strong>${escapeHtml(arca.headline)}</strong>
      <span>La facturación real se mantiene apagada desde el panel.</span>
    </div>
    ${arca.blockers.map((blocker) => `<p class="production-intake-error">${escapeHtml(blocker)}</p>`).join('')}
    <div class="fiscal-board" aria-label="Estado de la facturación">${board}</div>
    <ol class="business-wizard">${arca.steps.map((step) => renderWizardStep(step)).join('')}</ol>
    ${gate}
    <div class="button-row">
      <button class="secondary-button compact" type="button" data-arca-status-refresh ${busy ? 'disabled' : ''}>Volver a verificar</button>
      <button class="ghost-button compact" type="button" data-business-ops-view="fiscal-config">Editar datos fiscales</button>
      <button class="ghost-button compact" type="button" data-business-ops-view="fiscal-status">Ver comprobantes</button>
    </div>`);
}

export function renderDevicesSurface({ results, printers, isNative, busy } = {}) {
  const summary = summarizeDeviceChecks(results || {});
  const options = Array.isArray(printers) && printers.length
    ? printers.map((printer) => `<option value="${escapeHtml(String(printer.name || ''))}">${escapeHtml(String(printer.name || ''))}${printer.isDefault ? ' (predeterminada)' : ''}</option>`).join('')
    : '<option value="">Sin impresoras detectadas</option>';
  const rows = summary.rows.map((row) => `
    <article class="device-row tone-${escapeHtml(row.tone)}" data-device-check="${escapeHtml(row.id)}">
      <header><strong>${escapeHtml(row.label)}</strong><span class="status-pill ${escapeHtml(row.tone)}">${escapeHtml(row.stateLabel)}</span></header>
      <p>${escapeHtml(row.proves)}</p>
      <p class="form-hint">${escapeHtml(row.detail || row.meaning)}</p>
      <p class="form-hint">${escapeHtml(row.howTo)}</p>
      ${row.needsNative && !isNative
        ? '<p class="form-hint">Esta prueba necesita TABA para Windows.</p>'
        : `<button class="secondary-button compact" type="button" data-device-test="${escapeHtml(row.id)}" ${busy ? 'disabled' : ''}>Probar</button>`}
    </article>`).join('');

  return panel('Probar dispositivos', 'Se prueba de verdad. Si no se puede confirmar, se dice.', `
    <div class="operation-summary tone-${escapeHtml(summary.tone)}" role="status">
      <strong>${escapeHtml(summary.headline)}</strong>
      <span>Un trabajo aceptado por Windows no quiere decir que haya salido el papel.</span>
    </div>
    <div class="business-ops-form">
      <label>Impresora a probar<select name="deviceTestPrinter">${options}</select></label>
      <label>Formato<select name="deviceTestFormat"><option value="thermal">Térmica</option><option value="a4">A4</option></select></label>
    </div>
    <div class="business-scanner-input">
      <label>Prueba del lector<input data-barcode-input inputmode="numeric" autocomplete="off" maxlength="64" placeholder="Escaneá cualquier producto"></label>
      <button class="primary-button" type="button" data-business-scan-test ${busy ? 'disabled' : ''}>Procesar</button>
    </div>
    <div class="device-grid">${rows}</div>
    <p class="form-hint">Después de imprimir, mirá la impresora y confirmá si salió: es el único dato que vale.</p>
    <div class="button-row">
      ${DEVICE_CHECKS.filter((check) => check.paperName).map((check) => `
        <button class="ghost-button compact" type="button" data-device-confirm="${escapeHtml(check.id)}" ${busy ? 'disabled' : ''}>Salió el papel de ${escapeHtml(check.paperName)}</button>`).join('')}
    </div>`);
}

export function renderDayOpenSurface({ opening, businessStatus, role, busy } = {}) {
  const evaluated = evaluateBusinessOpening(opening || {});
  const rows = evaluated.checks.map((check) => `
    <article class="opening-check tone-${escapeHtml(check.tone)}">
      <header><strong>${escapeHtml(check.label)}</strong><span class="status-pill ${escapeHtml(check.tone)}">${escapeHtml(check.statusLabel)}</span></header>
      <p>${escapeHtml(check.detail)}</p>
      <small>${escapeHtml(check.why)}</small>
    </article>`).join('');
  const open = String(businessStatus || '') === 'open';

  return panel('Abrir el negocio', 'Una revisión antes de empezar a vender.', `
    <div class="operation-summary tone-${escapeHtml(evaluated.verdict.tone)}" role="status">
      <strong>${escapeHtml(evaluated.verdict.headline)}</strong>
      <span>${escapeHtml(evaluated.verdict.detail)}</span>
    </div>
    ${evaluated.blockers.map((blocker) => `<p class="production-intake-error">${escapeHtml(blocker)}</p>`).join('')}
    <div class="opening-grid">${rows}</div>
    <div class="button-row">
      <button class="secondary-button compact" type="button" data-opening-refresh ${busy ? 'disabled' : ''}>Volver a revisar</button>
      ${can(role, 'day.open') ? `
        <button class="primary-button compact" type="button" data-business-open-state="open" ${busy || open ? 'disabled' : ''}>Abrir el negocio</button>
        <button class="ghost-button compact" type="button" data-business-open-state="paused" ${busy || !open ? 'disabled' : ''}>Pausar pedidos</button>` : ''}
    </div>
    <p class="form-hint">El negocio está ${escapeHtml(businessStateLabel(businessStatus))}.</p>`);
}

export function renderDayCloseSurface({ run, alerts, role, busy, businessDate, timezone } = {}) {
  const closure = evaluateDailyClosure(run || {}, { alerts: alerts || [] });
  const sections = closure.sections.map((section) => `
    <article class="closure-section tone-${escapeHtml(section.tone)}">
      <span>${escapeHtml(section.label)}</span>
      <strong>${escapeHtml(section.value)}</strong>
      ${section.detail ? `<small>${escapeHtml(section.detail)}</small>` : ''}
    </article>`).join('');
  const elevated = can(role, 'day.close');

  return panel('Cerrar el día', 'Se firma una sola vez y queda registrado. Nada se cierra en silencio.', `
    <div class="business-ops-form daily-reconciliation-form">
      <label>Fecha<input name="dailyBusinessDate" type="date" value="${escapeHtml(String(businessDate || ''))}"></label>
      <input name="dailyTimezone" type="hidden" value="${escapeHtml(String(timezone || ''))}">
      <label>Efectivo contado<input name="dailyDeclaredCash" type="number" min="0" step="0.01" inputmode="decimal" value="0"></label>
      <label>Si la caja no coincide, explicá por qué<textarea name="dailyDifferenceNote" maxlength="500" placeholder="Obligatorio cuando hay diferencia"></textarea></label>
      <button class="secondary-button" type="button" data-daily-reconciliation-prepare ${busy ? 'disabled' : ''}>Calcular el cierre</button>
    </div>
    ${run?.id ? `
      <div class="closure-grid">${sections}</div>
      ${run.difference_note ? `<p class="closure-note"><strong>Explicación de la diferencia:</strong> ${escapeHtml(String(run.difference_note))}</p>` : ''}
      ${closure.blockers.map((blocker) => `
        <div class="production-intake-error"><strong>${escapeHtml(blocker.title)}</strong><p>${escapeHtml(blocker.detail)}</p></div>`).join('')}
      ${closure.closed ? '<p class="form-hint">Este día ya está cerrado.</p>' : renderClosureActions(closure, { run, elevated, busy })}
    ` : '<p class="form-hint">Calculá el cierre para ver las ventas, los cobros y las diferencias del día.</p>'}`);
}

function renderClosureActions(closure, { run, elevated, busy }) {
  if (!elevated) return '<p class="form-hint">El cierre lo firma el dueño o el encargado.</p>';
  const override = closure.criticalAlerts > 0 ? `
    <div class="business-ops-form">
      <label>Por qué cerrás con problemas abiertos<textarea name="closureOverrideNote" maxlength="500"></textarea></label>
      <label>Escribí ${escapeHtml(CLOSURE_CONFIRMATION_PHRASE)} para confirmar<input name="closureOverrideConfirmation" maxlength="24" autocomplete="off"></label>
    </div>` : '';
  return `${override}
    <button class="primary-button" type="button"
      data-daily-reconciliation-close="${escapeHtml(String(run.id || ''))}"
      data-daily-reconciliation-revision="${escapeHtml(String(run.revision || 0))}" ${busy ? 'disabled' : ''}>Cerrar el día</button>`;
}

export function renderProductOnboardingSurface({ plan, draft, readiness, preview, errors, role, busy } = {}) {
  const currentStep = plan?.step || 'scan';
  const steps = stepsForDraft(draft ? (readiness ? 'publish' : 'complete') : currentStep).map((step) => `
    <li class="business-wizard-step is-${escapeHtml(step.state)}">
      <span class="business-wizard-index">${escapeHtml(String(step.index))}</span>
      <div><strong>${escapeHtml(step.title)}</strong><p>${escapeHtml(step.detail)}</p></div>
    </li>`).join('');
  const errorList = Array.isArray(errors) && errors.length
    ? `<ul class="production-intake-error">${errors.map((error) => `<li>${escapeHtml(error.message)}</li>`).join('')}</ul>`
    : '';

  return panel('Alta de producto', 'Escaneás, completás y recién ahí se publica. No inventamos ningún dato.', `
    <ol class="business-wizard">${steps}</ol>
    <div class="business-scanner-input">
      <label>Código<input data-barcode-input inputmode="numeric" autocomplete="off" maxlength="64" placeholder="Escaneá el producto"></label>
      <button class="primary-button" type="button" data-business-scan-test ${busy ? 'disabled' : ''}>Procesar</button>
    </div>
    ${plan ? `
      <div class="operation-summary tone-${plan.outcome === 'unknown' ? 'attention' : plan.outcome === 'existing' ? 'calm' : 'critical'}">
        <strong>${escapeHtml(plan.headline)}</strong>
        <span>${escapeHtml(plan.detail)}</span>
      </div>` : ''}
    ${plan?.canCreateDraft ? `<button class="primary-button" type="button" data-create-product-draft ${busy ? 'disabled' : ''}>Abrir borrador para este código</button>` : ''}
    ${draft ? renderDraftForm(draft, { role, busy, errorList }) : ''}
    ${preview ? renderPreview(preview) : ''}
    ${readiness ? renderReadiness(readiness, { role, busy }) : ''}`);
}

function renderDraftForm(draft, { role, busy, errorList }) {
  const canPrice = can(role, 'products.price');
  return `<section class="business-ops-form product-draft-form" data-product-draft="${escapeHtml(draft.id)}">
    <header>
      <strong>Borrador ${escapeHtml(draft.gtin)}</strong>
      <span class="status-pill warning">${escapeHtml(draft.status)}</span>
      <small>${escapeHtml(draft.format)} · abierto ${escapeHtml(formatTimestamp(draft.createdAt))}${draft.createdBy ? ` por ${escapeHtml(draft.createdBy)}` : ''}</small>
    </header>
    ${draft.hasSuggestions ? '<p class="form-hint">Lo detectado es una sugerencia: confirmalo contra el envase antes de guardar.</p>' : ''}
    ${errorList}
    <label>Nombre<input name="productName" maxlength="160" value="${escapeHtml(draft.suggestions.name)}" placeholder="Como figura en el envase"></label>
    <label>Marca<input name="productBrand" maxlength="80" value="${escapeHtml(draft.suggestions.brand)}"></label>
    <label>Categoría<input name="productCategory" maxlength="80" value="${escapeHtml(draft.suggestions.category)}"></label>
    <label>Presentación<input name="productVariant" maxlength="80" value="${escapeHtml(draft.suggestions.presentation)}" placeholder="Ej: Botella 1,5 L"></label>
    <label>Contenido<input name="productCapacityValue" type="number" min="0" step="0.001" inputmode="decimal" placeholder="1.5"></label>
    <label>Unidad<select name="productCapacityUnit">${CAPACITY_UNITS.map((unit) => `<option value="${escapeHtml(unit)}">${escapeHtml(unit)}</option>`).join('')}</select></label>
    <label>Se vende como<select name="productPackageType">${PACKAGE_TYPES.map((type) => `<option value="${escapeHtml(type.value)}">${escapeHtml(type.label)}</option>`).join('')}</select></label>
    <label>Unidades por pack<input name="productUnitsPerPack" type="number" min="1" step="1" value="1"></label>
    <label>Stock de hoy<input name="productStock" type="number" min="0" step="1" value="0"></label>
    ${canPrice ? `
      <label>Precio de venta<input name="productPrice" type="number" min="0" step="0.01" inputmode="decimal"></label>
      <label>Costo <small>(opcional)</small><input name="productCost" type="number" min="0" step="0.01" inputmode="decimal"></label>
      <label class="business-ops-check"><input name="productPricePending" type="checkbox"> Precio pendiente: se ve en la web pero no se puede comprar</label>`
    : '<p class="form-hint">El precio lo carga el dueño o el encargado.</p>'}
    <div class="button-row">
      <button class="secondary-button" type="button" data-product-preview ${busy ? 'disabled' : ''}>Ver cómo queda</button>
      ${can(role, 'products.publish')
        ? `<button class="primary-button" type="button" data-product-complete ${busy ? 'disabled' : ''}>Guardar y publicar</button>`
        : '<p class="form-hint">Publicar lo confirma el dueño o el encargado.</p>'}
    </div>
  </section>`;
}

function renderPreview(preview) {
  return `<section class="product-preview" aria-label="Vista previa">
    <p class="eyebrow">Así lo va a ver el cliente</p>
    <article class="product-preview-card">
      <strong>${escapeHtml(preview.title)}</strong>
      <span>${escapeHtml(preview.subtitle)}</span>
      <p class="product-preview-price">${escapeHtml(preview.priceLabel)}</p>
      <span class="status-pill ${preview.purchasable ? 'success' : 'warning'}">${escapeHtml(preview.availabilityLabel)}</span>
    </article>
    ${preview.blockers.length
      ? `<ul class="form-hint">${preview.blockers.map((blocker) => `<li>${escapeHtml(blocker)}</li>`).join('')}</ul>`
      : '<p class="form-hint">No falta nada para ponerlo a la venta.</p>'}
  </section>`;
}

function renderReadiness(readiness, { role, busy }) {
  const described = describePublishReadiness(readiness);
  return `<section class="product-readiness" aria-label="Estado de publicación">
    <div class="operation-summary tone-${described.purchasable ? 'calm' : 'attention'}">
      <strong>${escapeHtml(described.headline)}</strong>
    </div>
    ${described.missing.length
      ? `<ul class="form-hint">${described.missing.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
      : ''}
    ${can(role, 'products.publish') && described.missing.length === 0 && !described.published
      ? `<button class="primary-button" type="button" data-product-publish ${busy ? 'disabled' : ''}>Publicar en la web</button>`
      : ''}
  </section>`;
}

export function renderRoleFooter(role) {
  const scope = describeRoleScope(role);
  if (!scope.role) return '';
  return `<p class="form-hint business-role-footer">Estás como ${escapeHtml(roleLabel(role))}.${scope.needsOwner.length ? ' Las acciones sobre dinero, precios, publicación y cierre las confirma el dueño o el encargado.' : ''}</p>`;
}

function renderWizardStep(step) {
  return `<li class="business-wizard-step is-${escapeHtml(step.state)}" data-wizard-step="${escapeHtml(step.id)}">
    <span class="business-wizard-index">${escapeHtml(String(step.index))}</span>
    <div>
      <strong>${escapeHtml(step.title)}</strong>
      <p>${escapeHtml(step.todo)}</p>
      <small>${escapeHtml(step.detail)}</small>
      <small class="business-wizard-why">${escapeHtml(step.why)}</small>
    </div>
  </li>`;
}

function deniedPanel(title, message) {
  return panel(title, 'Esta sección necesita otro permiso.', `<p class="form-hint">${escapeHtml(message)}</p>`);
}

function panel(title, subtitle, body) {
  return `<section class="business-ops-panel">
    <header><div><p class="eyebrow">Panel del negocio</p><h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div></header>
    ${body}
  </section>`;
}

function businessStateLabel(status) {
  return ({ open: 'abierto', paused: 'con pedidos pausados', closed: 'cerrado' })[String(status || '')] || 'sin estado confirmado';
}

// La hora del Panel se lee para conciliar plata, así que no puede ser ambigua.
//
// `toLocaleString('es-AR')` sin opciones imprime las 21:30 como «09:30:00»: el
// patrón por defecto de ese locale es de 12 horas y NO agrega marca de a.m. o
// p.m. O sea que las 21:30 y las 09:30 salían idénticas en pantalla, y el
// operador conciliaba pagos de Mercado Pago contra una hora que podía ser
// cualquiera de las dos.
//
// Se fija el reloj de 24 horas y la zona del negocio. La zona va explícita y no
// la del navegador: el Panel se abre desde el teléfono que haya, y la hora de un
// pedido no puede cambiar según qué aparato lo mire.
const PANEL_TIMEZONE = 'America/Argentina/Buenos_Aires';
const PANEL_TIMESTAMP_FORMAT = Object.freeze({
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: PANEL_TIMEZONE,
});

function formatTimestamp(value) {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime()) || !value) return 'sin hora confirmada';
  try {
    return date.toLocaleString('es-AR', PANEL_TIMESTAMP_FORMAT);
  } catch (_) {
    // Un runtime sin esa base de zonas horarias no puede dejar al Panel sin
    // fecha; el reloj de 24 horas es lo que de verdad quita la ambigüedad.
    return date.toLocaleString('es-AR', { hourCycle: 'h23' });
  }
}

function formatMoney(value, currency = 'ARS') {
  const amount = Number(value);
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: currency || 'ARS' })
    .format(Number.isFinite(amount) ? amount : 0);
}
