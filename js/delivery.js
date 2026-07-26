import {
  attachDeliveryProof,
  confirmDeliveryCode,
  getRiderQueueOrder,
  removeDeliveryProof,
  updateOrderStatus,
} from './orders.js';
import { getRiderActionState } from './core/rider.js';
import {
  activateStreetTestMode,
  disableGpsTracking,
  enableGpsTracking,
  getSimulation,
  isGpsActive,
  pauseSimulation,
  resetSimulation,
  selectStreetTestDestination,
  startSimulation,
  syncSimulationOnStatus,
} from './simulation.js';
import { getRealtimeStatus } from './realtime.js';
import { relayStatusLabel } from './core/realtime-sync.js';
import { getBusinessConfig } from './core/business-config-store.js';
import {
  buildDeliveryProof,
  compressDeliveryProofImage,
  formatDeliveryProofTime,
} from './core/delivery-proof.js';
import {
  formatDeliveryCodeTime,
  isDeliveryCodeConfirmed,
  normalizeDeliveryCode,
} from './core/delivery-code.js';
import { normalizeOrderAddressDetails } from './core/address.js';
import { dateTime, getState, money, statusClass, statusLabel } from './state.js';
import { getDataMode, getOrderRepository, isPersistentOrderRepository, isSandboxOrderRepository } from './repositories/repository_factory.js';
import { bagGlyph, escapeHtml, renderWithStableRealMap } from './ui.js';
import {
  GPS_GOOD_ACCURACY_METERS,
  getStreetTestDestination,
  getStreetTestDestinations,
  hasLiveRiderLocation,
} from './map/route_geometry.js';
import { renderOrderTimeline } from './core/order-timeline.js';
import { sandboxTrackingPresentation } from './core/sandbox-tracking-presentation.js';

// Revelado progresivo del preview privado. En producción esta superficie se
// reemplaza por production-operations.js, que reclama el pedido mediante el
// repositorio autenticado y su compare-and-swap server-side.
const acceptedDeliveryIds = new Set();

export function renderDeliveryPanel() {
  const container = document.querySelector('[data-delivery-panel]');
  if (!container) return;
  const repository = getOrderRepository();
  const queueOrder = getRiderQueueOrder();
  const currentRiderId = isSandboxOrderRepository(repository) && typeof repository.getRiderId === 'function'
    ? repository.getRiderId()
    : 'preview-rider';
  const order = queueOrder?.assignedRiderId
    && queueOrder.assignedRiderId !== currentRiderId
    ? getState().orders.find((candidate) => candidate.status === 'ready' && !candidate.assignedRiderId) || null
    : queueOrder;
  // En una sala realtime, un sync entrante re-renderiza este panel mientras el
  // rider tipea el código de entrega. Conservamos el valor y el foco del input
  // entre renders (mismo criterio que el mapa estable de renderWithStableRealMap).
  const codeDraft = captureDeliveryCodeDraft(container);

  if (!order) {
    renderWithStableRealMap(container, `
      <div class="delivery-layout rider-map-experience is-empty no-map">
        <section class="delivery-bottom-sheet rider-sheet rider-card" data-bottom-sheet>
          <span class="sheet-handle" aria-hidden="true"></span>
          ${renderRiderSheetTopbar()}
          <div class="empty-state sheet-empty">
            <strong>Sin entregas disponibles</strong>
            <p class="empty-state-copy">Cuando haya un pedido listo para repartir, aparecerá acá con sus acciones operativas.</p>
            <div class="empty-actions">
              <button class="secondary-button compact" type="button" data-open-admin-view="business">Ir al panel del negocio</button>
            </div>
          </div>
          ${renderRiderHistory()}
          ${renderAdvancedDemo()}
        </section>
      </div>`, { rolePrefix: 'rider' });
    return;
  }

  if (order.status === 'ready' && !acceptedDeliveryIds.has(order.id) && order.assignedRiderId !== currentRiderId) {
    renderRiderAssignmentPreview(container, order);
    return;
  }

  const { canLeave, canArrive, canDeliver } = getRiderActionState(order);
  const sim = orderSimulation(order);
  const gpsState = riderGpsShareState(sim);
  const gpsLive = gpsState.live;
  const sandboxMapActive = isSandboxOrderRepository(repository)
    && ['on_the_way', 'arriving'].includes(order.status)
    && ((sim?.source === 'simulation' && sim?.userStarted === true)
      || (sim?.source === 'gps' && Number.isFinite(Number(sim?.lat))));
  const mapActive = gpsLive || sandboxMapActive;
  const instructions = order.notes && order.notes !== 'Sin notas' ? order.notes : 'Sin indicaciones especiales del cliente.';
  const address = normalizeOrderAddressDetails(order);
  const destinationLabel = displayDestinationLabel(address.label || order.address);
  const addressText = [destinationLabel, address.reference ? `Referencia: ${address.reference}` : ''].filter(Boolean).join('\n');
  const headline = order.status === 'arriving'
    ? 'Llegando al domicilio'
    : order.status === 'on_the_way' ? 'En camino al cliente'
      : order.status === 'delivered' ? 'Pedido entregado'
      : 'Pedido listo para salir';
  const headSub = order.status === 'ready'
    ? 'Entrega aceptada. Confirmá cuando salgas del local.'
    : order.status === 'on_the_way'
      ? 'Usá “Llegué al domicilio” cuando estés en el punto de entrega.'
      : 'Confirmá la recepción para completar la entrega.';

  const waClient = `https://wa.me/${onlyDigits(order.customerPhone)}`;

  renderWithStableRealMap(container, `
    <div class="delivery-layout rider-map-experience ${mapActive ? '' : 'no-map'}">
      ${mapActive ? renderRiderMapStage(order, { sandbox: sandboxMapActive }) : ''}

      <section class="delivery-bottom-sheet rider-sheet rider-card ${mapActive ? 'is-live' : 'is-offline'}" data-bottom-sheet>
        <span class="sheet-handle" aria-hidden="true"></span>
        ${renderRiderSheetTopbar()}
        <div class="rider-delivery-head ${statusClass(order.status)}">
          <small>Entrega actual · ${order.id}</small>
          <h2>${headline}</h2>
          <p>${escapeHtml(headSub)}</p>
        </div>

        <div class="rider-contact">
          <span class="rider-contact-icon" aria-hidden="true">${bagGlyph()}</span>
          <span class="rider-contact-text">
            <small>Cliente</small>
            <strong>${escapeHtml(order.customerName)}</strong>
            <em>${escapeHtml(order.customerPhone)}</em>
          </span>
          <a class="round-action call" href="tel:${encodeURIComponent(order.customerPhone)}" aria-label="Llamar al cliente">${phoneGlyph()}</a>
          <a class="round-action whatsapp" href="${waClient}" target="_blank" rel="noopener noreferrer" aria-label="Enviar WhatsApp al cliente">${messageGlyph()}</a>
        </div>

        <div class="rider-address">
          <span class="rider-label">Dirección</span>
          <p>${escapeHtml(destinationLabel)}</p>
          ${address.reference ? `<p class="rider-reference">Referencia: ${escapeHtml(address.reference)}</p>` : ''}
          <div class="rider-copy-row">
            <button class="ghost-button compact" type="button" data-copy-address="${escapeHtml(addressText)}">Copiar dirección</button>
          </div>
        </div>

        ${renderRiderQuickActions(order, destinationLabel, address)}

        <div class="sheet-metrics rider-metrics">
          <span class="metric-priority"><small>A cobrar</small><strong>${money(order.total)}</strong></span>
          <span><small>Pago</small><strong>${escapeHtml(order.paymentMethod)}</strong></span>
          <span><small>Estado</small><strong>${escapeHtml(statusLabel(order.status))}</strong></span>
        </div>

        ${renderDeliveryProofPanel(order)}
        ${renderDeliveryCodePanel(order)}
        ${renderSandboxSimControls(order, sim)}
        ${renderRiderActions(order, { canLeave, canArrive, canDeliver })}
        ${renderOrderTimeline(order.status, { className: 'tight rider-progress' })}

        <details class="order-detail rider-order-detail">
          <summary>Ver pedido · ${order.id}</summary>
          <div class="order-detail-body">
            ${order.items.map((item) => `
              <div class="order-line">
                <span>${item.quantity} × ${escapeHtml(item.name)}</span>
                <strong>${money(item.quantity * item.unitPrice)}</strong>
              </div>
            `).join('')}
            <div class="summary-row total"><span>Total a cobrar</span><strong>${money(order.total)}</strong></div>
          </div>
        </details>

        <div class="rider-instructions">
          <p class="rider-label">Indicaciones del cliente</p>
          <p>${escapeHtml(instructions)}</p>
        </div>

        ${renderRiderHistory(order)}

        ${renderAdvancedDemo()}
      </section>
    </div>
  `, { rolePrefix: 'rider', orderId: order.id });
  restoreDeliveryCodeDraft(container, codeDraft);
}

function renderRiderAssignmentPreview(container, order) {
  const itemCount = (order.items || []).reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0), 0);
  const businessName = getBusinessConfig().businessName || 'TABA';
  const generalZone = normalizeOrderAddressDetails(order).neighborhood;
  renderWithStableRealMap(container, `
    <div class="delivery-layout rider-map-experience is-empty no-map">
      <section class="delivery-bottom-sheet rider-sheet rider-card" data-bottom-sheet data-rider-assignment-preview="${escapeHtml(order.id)}">
        <span class="sheet-handle" aria-hidden="true"></span>
        ${renderRiderSheetTopbar()}
        <div class="rider-delivery-head ${statusClass(order.status)}">
          <small>Entrega disponible · ${escapeHtml(order.id)}</small>
          <h2>Pedido listo para repartir</h2>
          <p>Revisá el resumen y aceptá la entrega para ver los datos del cliente.</p>
        </div>
        <div class="rider-assignment-context">
          <span><small>Retirás en</small><strong>${escapeHtml(businessName)}</strong></span>
          ${generalZone ? `<span><small>Zona</small><strong>${escapeHtml(generalZone)}</strong></span>` : ''}
        </div>
        <div class="sheet-metrics rider-metrics">
          <span><small>Cobro</small><strong>${escapeHtml(order.paymentMethod || 'A coordinar')}</strong></span>
          <span><small>Unidades</small><strong>${itemCount}</strong></span>
          <span class="metric-priority"><small>A cobrar</small><strong>${money(order.total)}</strong></span>
        </div>
        <div class="button-row rider-actions">
          <button class="primary-button" type="button" data-rider-accept="${escapeHtml(order.id)}">Aceptar entrega</button>
        </div>
        <p class="empty-state-copy">El nombre, teléfono, domicilio y detalle se habilitan después de aceptar.</p>
        ${renderRiderHistory(order)}
      </section>
    </div>`, { rolePrefix: 'rider', orderId: order.id });
}

function renderRiderSheetTopbar() {
  return `
    <div class="rider-sheet-topbar">
      <span class="rider-online-chip is-local" aria-label="Operación activa"><i aria-hidden="true"></i>En servicio</span>
      <div class="rider-sheet-actions">
        <button class="ghost-button compact" type="button" data-open-admin-view="business" aria-label="Volver al panel del negocio">Negocio</button>
        <button class="ghost-button compact" type="button" data-lock-admin>Salir</button>
      </div>
    </div>`;
}

// Accesos rápidos del rider (referencia visual de la maqueta): abrir la ruta en
// el mapa nativo (búsqueda real por la dirección textual, sin ruta inventada
// dentro de la app) y llamar al cliente.
function renderRiderQuickActions(order, destinationLabel, address) {
  const navQuery = encodeURIComponent([destinationLabel, address?.reference].filter(Boolean).join(' '));
  const navUrl = navQuery ? `https://www.google.com/maps/dir/?api=1&destination=${navQuery}` : '';
  const phone = String(order.customerPhone || '').trim();
  if (!navUrl && !phone) return '';
  return `
    <div class="rider-quick-actions">
      ${navUrl ? `
      <a class="secondary-button rider-quick-button" href="${navUrl}" target="_blank" rel="noopener noreferrer">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true"><path d="M20.5 4.2 4 11l6.4 2.6L13 20l7.5-15.8Z" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
        Abrir ruta
      </a>` : ''}
      ${phone ? `
      <a class="secondary-button rider-quick-button" href="tel:${encodeURIComponent(phone)}">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true"><path d="M6.8 3.8 9 3.2c.6-.1 1.2.2 1.4.8l1 2.6c.2.5 0 1.1-.4 1.4l-1.3 1a12.9 12.9 0 0 0 5.3 5.3l1-1.3c.3-.4.9-.6 1.4-.4l2.6 1c.6.2.9.8.8 1.4l-.6 2.2a1.6 1.6 0 0 1-1.6 1.2C10.9 18.2 5.8 13.1 5.6 5.4c0-.7.5-1.4 1.2-1.6Z" fill="currentColor" fill-opacity="0.16" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
        Llamar al cliente
      </a>` : ''}
    </div>`;
}

// Historial corto sin PII: una entrega cerrada ya no necesita conservar el
// nombre ni ningún dato de contacto visible en la operación del rider.
function renderRiderHistory(currentOrder = null) {
  const delivered = (getState().orders || [])
    .filter((order) => !order.internalSeed && order.status === 'delivered' && order.deliveryMode === 'delivery')
    .filter((order) => order.id !== currentOrder?.id)
    .slice(0, 3);
  if (!delivered.length) return '';
  return `
    <section class="rider-history" aria-label="Entregas recientes">
      <p class="rider-label">Entregas recientes</p>
      ${delivered.map((order) => `
        <div class="rider-history-row">
          <span class="rider-history-check" aria-hidden="true">✓</span>
          <div class="rider-history-text">
            <strong>${escapeHtml(order.id)} · Entrega completada</strong>
            <small>${escapeHtml(dateTime(order.delivery?.deliveredAt || order.createdAt))}</small>
          </div>
          <strong class="rider-history-total">${money(order.total)}</strong>
        </div>`).join('')}
    </section>`;
}

function captureDeliveryCodeDraft(container) {
  const input = container.querySelector('[data-delivery-code-input]');
  if (!input || !input.value) return null;
  return {
    orderId: input.dataset.deliveryCodeInput || '',
    value: input.value,
    focused: document.activeElement === input,
  };
}

function restoreDeliveryCodeDraft(container, draft) {
  if (!draft) return;
  const input = container.querySelector(`[data-delivery-code-input="${draft.orderId}"]`);
  if (!input || input.value) return;
  input.value = draft.value;
  if (draft.focused) {
    input.focus();
    try { input.setSelectionRange(input.value.length, input.value.length); } catch (_) { /* inputs sin selección */ }
  }
}

function renderRiderActions(order, { canLeave, canArrive, canDeliver }) {
  const actions = [];
  if (canLeave) {
    actions.push(`<button class="primary-button" type="button" data-delivery-leave="${order.id}">Salí del local</button>`);
  }
  if (canArrive) {
    actions.push(`<button class="primary-button" type="button" data-delivery-arrive="${order.id}">Llegué al domicilio</button>`);
  }
  if (canDeliver && isDeliveryCodeConfirmed(order)) {
    actions.push(`<button class="primary-button" type="button" data-delivery-done="${order.id}">Pedido entregado</button>`);
  }
  if (!actions.length) return '';
  return `<div class="button-row rider-actions">${actions.join('')}</div>`;
}

function renderDeliveryProofPanel(order) {
  if (order.status !== 'arriving') return '';
  const proof = order.deliveryProof || null;
  const proofTime = proof ? formatDeliveryProofTime(proof) : '';
  const input = `
    <input class="delivery-proof-input" data-delivery-proof-input="${escapeHtml(order.id)}" type="file" accept="image/*" capture="environment" aria-label="Adjuntar foto de entrega" />`;

  return `
    <section class="delivery-proof-panel ${proof ? 'has-proof' : ''}" data-delivery-proof-panel>
      <div class="delivery-proof-copy">
        <strong>Foto de entrega</strong>
        <p>Sacá una foto del pedido entregado. Evitá fotografiar personas, DNI o datos privados.</p>
        ${proof ? `<small>Comprobante tomado: ${escapeHtml(proofTime || 'sin hora')}</small>` : '<small>Podés adjuntar una foto como comprobante en el domicilio.</small>'}
      </div>
      ${proof ? `
        <div class="delivery-proof-preview">
          <img src="${escapeHtml(proof.photoDataUrl)}" alt="Foto de entrega adjunta" data-delivery-proof-preview />
        </div>` : ''}
      <div class="button-row delivery-proof-actions">
        <label class="secondary-button compact delivery-proof-upload">
          ${proof ? 'Reemplazar foto' : 'Adjuntar foto'}
          ${input}
        </label>
        ${proof ? `<button class="ghost-button compact" type="button" data-delivery-proof-remove="${escapeHtml(order.id)}">Quitar foto</button>` : ''}
      </div>
    </section>`;
}

function renderDeliveryCodePanel(order) {
  if (order.status !== 'arriving') return '';
  const deliveryCode = normalizeDeliveryCode(order.deliveryCode);
  if (!deliveryCode) return '';
  const confirmed = isDeliveryCodeConfirmed(deliveryCode);
  const confirmedTime = formatDeliveryCodeTime(deliveryCode);
  return `
    <section class="delivery-code-panel ${confirmed ? 'is-confirmed' : ''}" data-delivery-code-panel>
      <div class="delivery-code-panel-copy">
        <strong>${confirmed ? 'Código de entrega confirmado' : 'Confirmar recepción'}</strong>
        <p>${confirmed ? `Confirmado${confirmedTime ? ` a las ${escapeHtml(confirmedTime)}` : ''}.` : 'Pedile al cliente el código de 4 dígitos que ve en Seguimiento.'}</p>
      </div>
      ${confirmed ? '' : `
        <div class="delivery-code-controls">
          <input data-delivery-code-input="${escapeHtml(order.id)}" type="text" inputmode="numeric" maxlength="4" pattern="[0-9]*" autocomplete="one-time-code" placeholder="0000" aria-label="Código de entrega del cliente" />
          <button class="secondary-button compact" type="button" data-delivery-code-confirm="${escapeHtml(order.id)}">Confirmar código</button>
        </div>
        <small>La entrega se habilita únicamente después de validar el código.</small>`}
    </section>`;
}

// Bloque avanzado: esconde relay/sala/equipo para que la vista principal sea operativa.
function renderAdvancedDemo() {
  return '';
}

function onlyDigits(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.startsWith('54') ? digits : `549${digits}`;
}

function orderSimulation(order) {
  const sim = getSimulation();
  return sim && sim.orderId === order.id ? sim : null;
}

// Panel operativo productivo: el rider comparte su ubicación real o no se
// muestra un mapa. La sandbox agrega explícitamente su modo de recorrido aparte.
function renderSimControls(order, sim) {
  return `
    <div class="sim-panel street-test-panel is-offline" data-street-test>
      <div class="sim-head">
        <span class="rider-label">Seguimiento operativo</span>
        <span class="sim-state">Local</span>
      </div>
      <p class="form-hint">Los avances se confirman con los botones de estado. No se usa GPS, ETA ni ubicación en vivo.</p>
    </div>
  `;
}

function renderSandboxSimControls(order, sim) {
  if (!isSandboxOrderRepository(getOrderRepository())) return '';
  return renderSandboxMapControls(order, sim);
}

function renderSandboxMapControls(order, sim) {
  const presentation = sandboxTrackingPresentation(order, sim);
  const running = presentation.running;
  const gpsMode = presentation.gps;
  const gpsActive = isGpsActive();
  const gpsLabel = sim?.gpsStatus === 'denied'
    ? 'Permiso de ubicación denegado'
    : sim?.gpsStatus === 'unavailable'
      ? 'Ubicación no disponible'
      : sim?.gpsStatus === 'requesting'
        ? 'Solicitando ubicación…'
        : gpsMode && sim?.source === 'gps'
          ? `Ubicación activa · ${relativeAgeLabel(sim.lastFixAt || sim.timestamp)}`
          : 'Activá ubicación o usá el recorrido de muestra';
  return `
    <div class="sim-panel street-test-panel sandbox-route-panel ${running ? 'is-running' : ''}" data-street-test data-sandbox-route>
      <div class="sim-head">
        <span class="rider-label">Seguimiento del pedido</span>
        <span class="sim-state">${escapeHtml(presentation.activityLabel)}</span>
      </div>
      <div class="sandbox-route-meta">
        <span><small>Modo</small><strong>${gpsMode && sim?.source === 'gps' ? 'GPS local' : 'Recorrido de muestra'}</strong></span>
        <span><small>Avance</small><strong data-sandbox-progress>${gpsMode && sim?.source === 'gps' ? '—' : `${presentation.progress}%`}</strong></span>
        ${presentation.showEta ? `<span><small>ETA</small><strong data-sandbox-eta>${escapeHtml(presentation.etaLabel)}</strong></span>` : ''}
      </div>
      <p class="sandbox-gps-status" data-sandbox-gps-status>${escapeHtml(gpsLabel)}${sim?.accuracy ? ` · precisión aprox. ${Math.round(sim.accuracy)} m` : ''}</p>
      <div class="button-row">
        ${gpsActive
          ? '<button class="secondary-button compact" type="button" data-sim-gps-off>Desactivar ubicación</button>'
          : '<button class="secondary-button compact" type="button" data-sim-gps>Activar ubicación</button>'}
        ${gpsMode && sim?.source === 'gps' ? '' : presentation.canPause
          ? '<button class="secondary-button compact" type="button" data-sim-pause>Pausar recorrido</button>'
          : presentation.canStart ? `<button class="primary-button compact" type="button" data-sim-start>${presentation.paused ? 'Reanudar recorrido' : 'Iniciar recorrido'}</button>` : ''}
        ${presentation.canReset ? '<button class="ghost-button compact" type="button" data-sim-reset>Reiniciar ruta</button>' : ''}
      </div>
      <p class="form-hint">${gpsMode && sim?.source === 'gps' ? 'El mapa usa la última ubicación compartida desde este iPhone.' : 'El recorrido de muestra usa calles de Neuquén Capital.'}</p>
    </div>
  `;
}

function displayDestinationLabel(value) {
  return String(value || '')
    .replace(/^Destino demo\s*·\s*/i, 'Destino · ')
    .replace(/^Local demo\s*·\s*/i, 'Local · ');
}

function canArriveForStreet(order) {
  return order?.status === 'on_the_way';
}

function canDeliverForStreet(order) {
  return order?.status === 'on_the_way' || order?.status === 'arriving';
}

function gpsProductStatusLabel(sim, active) {
  const labels = {
    inactive: 'Ubicación detenida',
    requesting: 'Permiso requerido',
    active: active ? 'Compartiendo ubicación' : 'Sin GPS en vivo',
    denied: 'Permiso requerido',
    unavailable: sim?.source === 'gps' ? 'Señal baja, usando última ubicación' : 'Señal baja',
    requires_secure_context: 'Requiere HTTPS',
  };
  return labels[sim?.gpsStatus || 'inactive'] || 'Ubicación detenida';
}

function gpsSignalStatusLabel(sim, active) {
  if (!sim || sim.gpsStatus === 'inactive') return 'Ubicación detenida';
  if (sim.gpsStatus === 'requesting') return 'Permiso requerido';
  if (sim.gpsStatus === 'denied') return 'Permiso requerido';
  if (sim.gpsStatus === 'requires_secure_context') return 'Permiso requerido';
  if (sim.gpsStatus === 'unavailable') {
    return sim.source === 'gps' ? 'Señal baja, usando última ubicación' : 'Señal baja';
  }
  if (sim.gpsStatus === 'active') {
    if (!active) return 'Sin GPS en vivo';
    const accuracy = Number(sim.accuracy);
    if (Number.isFinite(accuracy) && accuracy > GPS_GOOD_ACCURACY_METERS) {
      return 'Señal baja, usando última ubicación';
    }
    return 'Buena señal';
  }
  return 'Ubicación detenida';
}

function gpsStatusLabel(sim, active) {
  const labels = {
    inactive: 'Detenida',
    requesting: 'Esperando permiso',
    active: active ? 'GPS real activo' : 'Último GPS real',
    denied: 'Bloqueada',
    unavailable: 'No disponible',
    requires_secure_context: 'Requiere HTTPS',
  };
  return labels[sim?.gpsStatus || 'inactive'] || 'Detenida';
}

function renderGpsDiagnostics(sim, gpsOn) {
  const status = getRealtimeStatus();
  const relay = status.relayEnabled
    ? (status.relayConnected ? 'activa' : status.relayState === 'offline' ? 'sin conexión' : 'reconectando')
    : 'este equipo';
  const backendMode = getRepositoryDataMode();
  const backendSend = sim?.backendError
    ? `Error: ${sim.backendError}`
    : (sim?.lastBackendPublishAt ? relativeAgeLabel(sim.lastBackendPublishAt) : 'Sin envíos');
  const source = sim?.source === 'gps' ? 'GPS real' : 'Recorrido guiado';
  const fixAt = sim?.lastGpsFixAt || (sim?.source === 'gps' ? sim?.lastFixAt : null);
  const publishedAt = sim?.lastPublishedAt || sim?.lastGpsPublishedAt || sim?.timestamp || null;
  const coords = sim?.source === 'gps' && Number.isFinite(sim?.lat) && Number.isFinite(sim?.lng)
    ? `${sim.lat.toFixed(6)}, ${sim.lng.toFixed(6)}`
    : 'Sin fix real';
  const precision = sim?.source === 'gps' && Number.isFinite(sim?.accuracy)
    ? `±${Math.round(sim.accuracy)} m`
    : 'Sin precisión';
  return `
    <details class="gps-diagnostics">
      <summary>Detalles de ubicación</summary>
      <div class="gps-diagnostics-grid">
        <span><small>Contexto seguro</small><strong>${secureContextLabel()}</strong></span>
        <span><small>Permiso del navegador</small><strong>${geolocationLabel()}</strong></span>
        <span><small>Estado GPS</small><strong>${escapeHtml(diagnosticGpsState(sim))}</strong></span>
        <span><small>Seguimiento activo</small><strong>${gpsOn ? 'Sí' : 'No'}</strong></span>
        <span><small>Última lectura</small><strong>${escapeHtml(relativeAgeLabel(fixAt))}</strong></span>
        <span><small>Coordenadas</small><strong>${escapeHtml(coords)}</strong></span>
        <span><small>Precisión</small><strong>${escapeHtml(precision)}</strong></span>
        <span><small>Fuente de ubicación</small><strong>${escapeHtml(source)}</strong></span>
        <span><small>Conexión entre equipos</small><strong>${escapeHtml(relay)}</strong></span>
        <span><small>Sala de reparto</small><strong>${escapeHtml(status.room)}</strong></span>
        <span><small>Última actualización compartida</small><strong>${escapeHtml(relativeAgeLabel(publishedAt))}</strong></span>
        <span><small>Origen de datos</small><strong>${escapeHtml(backendMode)}</strong></span>
        <span><small>Última actualización servidor</small><strong>${escapeHtml(backendSend)}</strong></span>
      </div>
    </details>`;
}

function getRepositoryDataMode() {
  try {
    const mode = getDataMode();
    return mode === 'supabase' ? 'Supabase' : mode === 'http' ? 'API propia' : mode === 'demo-realtime' ? 'Sesión compartida' : 'Este equipo';
  } catch (_) {
    return 'Este equipo';
  }
}

function secureContextLabel() {
  if (globalThis.isSecureContext === true) return 'Sí';
  if (globalThis.isSecureContext === false) return 'No';
  const protocol = globalThis.location?.protocol;
  const hostname = globalThis.location?.hostname;
  return protocol === 'https:' || hostname === 'localhost' || hostname === '127.0.0.1' ? 'Sí' : 'No';
}

function geolocationLabel() {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator ? 'Sí' : 'No';
}

function diagnosticGpsState(sim) {
  if (sim?.gpsStatus === 'requesting') return 'Pidiendo permiso';
  if (sim?.gpsStatus === 'active') return hasLiveRiderLocation(sim) ? 'Activo' : 'Sin GPS en vivo';
  if (sim?.gpsStatus === 'denied' || sim?.gpsStatus === 'unavailable' || sim?.gpsStatus === 'requires_secure_context') return 'Error';
  return 'Inactivo';
}

export function riderGpsShareState(sim, { now = Date.now() } = {}) {
  const live = hasLiveRiderLocation(sim, { now });
  if (!sim) {
    return {
      live: false,
      headSub: 'Compartí ubicación real cuando salgas a reparto.',
    };
  }

  if (live) {
    return {
      live: true,
      headSub: 'El cliente puede seguir tu ubicación mientras el pedido esté en reparto.',
    };
  }

  if (sim.gpsStatus === 'inactive') {
    return {
      live: false,
      headSub: 'Ubicación pausada. Compartí ubicación real cuando salgas a reparto.',
    };
  }

  return {
    live: false,
    headSub: 'Sin GPS en vivo. El cliente verá el fallback honesto hasta que vuelvas a compartir.',
  };
}

function relativeAgeLabel(value) {
  if (!value) return 'Sin datos';
  const date = new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) return 'Sin datos';
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (seconds < 2) return 'ahora';
  if (seconds < 60) return `hace ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  return `hace ${minutes} min`;
}

// Escenario de mapa del rider. En producción sólo se monta con GPS real; en
// sandbox también se habilita con el recorrido geográfico aislado. "Navegar"
// abre el mapa nativo con la dirección textual del cliente.
function renderRiderMapStage(order, { sandbox = false } = {}) {
  const address = normalizeOrderAddressDetails(order);
  const destination = displayDestinationLabel(address.label || order.address);
  const navQuery = encodeURIComponent([destination, address.reference].filter(Boolean).join(' '));
  const navUrl = navQuery ? `https://www.google.com/maps/dir/?api=1&destination=${navQuery}` : '';
  const supportDigits = onlyDigits(getBusinessConfig().whatsappNumber);
  const supportUrl = supportDigits ? `https://wa.me/${supportDigits}` : '';

  return `
    <div class="delivery-map-stage rider-map-stage" data-map-shell="rider">
      ${renderRealMapShell(order, '<p class="map-fallback-note">Mapa no disponible en este dispositivo.</p>', 'rider', sandbox ? 'sandbox' : '')}
      <div class="rider-map-overlay-top">
        <button class="rider-fab" type="button" data-nav-view="home" aria-label="Volver al inicio">${chevronBackGlyph()}</button>
        ${renderRiderStatusPill(order)}
        ${supportUrl
          ? `<a class="rider-fab" href="${supportUrl}" target="_blank" rel="noopener noreferrer" aria-label="Soporte por WhatsApp">${headsetGlyph()}</a>`
          : `<span class="rider-fab is-ghost" aria-hidden="true">${headsetGlyph()}</span>`}
      </div>
      <div class="rider-map-actions">
        <button class="rider-fab" type="button" data-map-recenter aria-label="Centrar en mi ubicación">${locateGlyph()}</button>
        ${navUrl
          ? `<a class="rider-fab accent" href="${navUrl}" target="_blank" rel="noopener noreferrer" aria-label="Navegar al domicilio del cliente">${navigateGlyph()}</a>`
          : ''}
      </div>
    </div>`;
}

// Pill de estado flotante (referencia visual: "Estado / Repartiendo").
function renderRiderStatusPill(order) {
  const label = riderPillStatusLabel(order);
  return `
    <span class="rider-status-pill ${statusClass(order.status)}">
      <span class="rider-pill-text">
        <small>Estado</small>
        <strong>${escapeHtml(label)}</strong>
      </span>
      <span class="rider-pill-dot" aria-hidden="true"></span>
    </span>`;
}

export function riderPillStatusLabel(order) {
  if (['received', 'preparing'].includes(order?.status)) return 'Esperando';
  switch (order.status) {
    case 'ready': return 'Listo';
    case 'on_the_way': return 'En camino';
    case 'arriving': return 'Llegando';
    case 'delivered': return 'Entregado';
    default: return 'En reparto';
  }
}

// Glyphs de los botones flotantes (heredan currentColor, igual que los de ui.js).
function chevronBackGlyph() {
  return `<svg class="rider-fab-ico" viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true" focusable="false">
    <path d="M14.5 6.5 9 12l5.5 5.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function headsetGlyph() {
  return `<svg class="rider-fab-ico" viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true" focusable="false">
    <path d="M5 13.5v-1.2a7 7 0 0 1 14 0v1.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <rect x="3.4" y="13" width="3.6" height="5.6" rx="1.8" fill="currentColor"/>
    <rect x="17" y="13" width="3.6" height="5.6" rx="1.8" fill="currentColor"/>
    <path d="M19 18.4v.5a2.6 2.6 0 0 1-2.6 2.6H13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`;
}

function locateGlyph() {
  return `<svg class="rider-fab-ico" viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.8"/>
    <circle cx="12" cy="12" r="1.6" fill="currentColor"/>
    <path d="M12 2.6v3M12 18.4v3M2.6 12h3M18.4 12h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`;
}

function navigateGlyph() {
  return `<svg class="rider-fab-ico" viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true" focusable="false">
    <path d="M20.5 4.2 4 11l6.4 2.6L13 20l7.5-15.8Z" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
  </svg>`;
}

function phoneGlyph() {
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true" focusable="false">
    <path d="M7.2 3.8 9.5 7 8.1 9.1c1.3 2.5 3.3 4.5 5.8 5.8l2.1-1.4 3.2 2.3-.6 3c-.2 1-1.1 1.7-2.1 1.6A14.6 14.6 0 0 1 3.6 7.5c-.1-1 .6-1.9 1.6-2.1l2-.4Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function messageGlyph() {
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true" focusable="false">
    <path d="M20 11.5a8 8 0 0 1-11.7 7.1L4 20l1.4-4.1A8 8 0 1 1 20 11.5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M8.2 8.4c.7 2.8 2.6 4.7 5.4 5.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`;
}

function renderRealMapShell(order, fallback, role = 'rider', mapSource = '') {
  const orderAttr = order?.id ? ` data-order-id="${escapeHtml(order.id)}"` : '';
  const sourceAttr = mapSource ? ` data-map-source="${escapeHtml(mapSource)}"` : '';
  return `
    <div class="real-map-shell rider-map-shell" data-real-map data-map-role="${escapeHtml(role)}"${sourceAttr}${orderAttr}>
      <div class="real-map-canvas" data-map-canvas aria-label="Mapa real del reparto"></div>
      <div class="real-map-fallback" data-map-fallback>
        <p class="map-fallback-note">Mapa no disponible, usando vista simplificada.</p>
        ${fallback}
      </div>
      <span class="real-map-tile-error" data-map-tile-error hidden>Mapa base no disponible</span>
      <div class="real-map-meta" data-map-meta>Mapa de reparto</div>
    </div>`;
}

export function handleDeliveryAction(target) {
  const acceptId = target.closest('[data-rider-accept]')?.dataset.riderAccept;
  if (acceptId) {
    const repository = getOrderRepository();
    const order = findDeliveryOrder(acceptId);
    if (!order || order.status !== 'ready' || order.deliveryMode !== 'delivery') {
      return { handled: true, ok: false, message: 'La entrega ya no está disponible para aceptar.' };
    }
    if (isSandboxOrderRepository(repository)) {
      const claim = repository.claimRiderOrder(acceptId, { riderId: repository.getRiderId?.() });
      if (claim?.then) {
        return Promise.resolve(claim).then((result) => {
          if (!result.ok) return { handled: true, ok: false, message: result.message };
          acceptedDeliveryIds.add(acceptId);
          if (typeof document !== 'undefined') renderDeliveryPanel();
          return {
            handled: true,
            ok: true,
            message: 'Entrega aceptada. Ya podés ver los datos del pedido.',
          };
        });
      }
      if (!claim.ok) return { handled: true, ok: false, message: claim.message };
    }
    acceptedDeliveryIds.add(acceptId);
    if (typeof document !== 'undefined') renderDeliveryPanel();
    return { handled: true, ok: true, message: 'Entrega aceptada. Ya podés ver los datos del pedido.' };
  }

  const codeButton = target.closest('[data-delivery-code-confirm]');
  const codeOrderId = codeButton?.dataset.deliveryCodeConfirm;
  if (codeOrderId) {
    if (findDeliveryOrder(codeOrderId)?.status !== 'arriving') {
      return { handled: true, ok: false, message: 'El código se confirma al llegar al domicilio.' };
    }
    const panel = codeButton.closest('[data-delivery-code-panel]');
    const input = panel?.querySelector?.('[data-delivery-code-input]');
    const repository = getOrderRepository();
    const result = isSandboxOrderRepository(repository) && typeof repository.verifyDeliveryCode === 'function'
      ? repository.verifyDeliveryCode(codeOrderId, input?.value || '')
      : confirmDeliveryCode(codeOrderId, input?.value || '');
    if (result.ok && input) input.value = '';
    return { handled: true, ok: result.ok, message: result.message };
  }

  const removeProofId = target.closest('[data-delivery-proof-remove]')?.dataset.deliveryProofRemove;
  if (removeProofId) {
    if (findDeliveryOrder(removeProofId)?.status !== 'arriving') {
      return { handled: true, ok: false, message: 'La foto de entrega se gestiona en el domicilio.' };
    }
    return { handled: true, ...removeDeliveryProof(removeProofId) };
  }

  const leaveId = target.closest('[data-delivery-leave]')?.dataset.deliveryLeave;
  if (leaveId) {
    const order = findDeliveryOrder(leaveId);
    if (order?.status !== 'ready') {
      return invalidRiderTransition('La salida solo se registra desde un pedido listo.');
    }
    if (!acceptedDeliveryIds.has(leaveId)) {
      return invalidRiderTransition('Aceptá la entrega antes de registrar la salida.');
    }
    return deliveryActionResponse(updateDeliveryOrderStatus(leaveId, 'on_the_way'), 'Pedido marcado como en camino.', () => {
      syncSimulationOnStatus(leaveId, 'on_the_way');
    });
  }

  const arriveId = target.closest('[data-delivery-arrive]')?.dataset.deliveryArrive;
  if (arriveId) {
    if (findDeliveryOrder(arriveId)?.status !== 'on_the_way') {
      return invalidRiderTransition('La llegada se registra después de iniciar el reparto.');
    }
    return deliveryActionResponse(updateDeliveryOrderStatus(arriveId, 'arriving'), 'Llegada al domicilio registrada.', () => {
      syncSimulationOnStatus(arriveId, 'arriving');
    });
  }

  const streetArriveId = target.closest('[data-street-arrive]')?.dataset.streetArrive;
  if (streetArriveId) {
    if (findDeliveryOrder(streetArriveId)?.status !== 'on_the_way') {
      return invalidRiderTransition('La llegada se registra después de iniciar el reparto.');
    }
    return deliveryActionResponse(updateDeliveryOrderStatus(streetArriveId, 'arriving'), 'Llegada al destino registrada.', () => {
      syncSimulationOnStatus(streetArriveId, 'arriving');
    });
  }

  const doneId = target.closest('[data-delivery-done]')?.dataset.deliveryDone;
  if (doneId) {
    const order = findDeliveryOrder(doneId);
    if (order?.status !== 'arriving') {
      return invalidRiderTransition('Confirmá que llegaste al domicilio antes de entregar.');
    }
    if (!isDeliveryCodeConfirmed(order)) {
      return invalidRiderTransition('Validá el código del cliente antes de confirmar la entrega.');
    }
    return deliveryActionResponse(updateDeliveryOrderStatus(doneId, 'delivered'), 'Pedido marcado como entregado.', () => {
      acceptedDeliveryIds.delete(doneId);
      syncSimulationOnStatus(doneId, 'delivered');
    });
  }

  const streetDoneId = target.closest('[data-street-done]')?.dataset.streetDone;
  if (streetDoneId) {
    const order = findDeliveryOrder(streetDoneId);
    if (order?.status !== 'arriving') {
      return invalidRiderTransition('Confirmá que llegaste al domicilio antes de entregar.');
    }
    if (!isDeliveryCodeConfirmed(order)) {
      return invalidRiderTransition('Validá el código del cliente antes de confirmar la entrega.');
    }
    return deliveryActionResponse(updateDeliveryOrderStatus(streetDoneId, 'delivered'), 'Pedido marcado como entregado.', () => {
      acceptedDeliveryIds.delete(streetDoneId);
      syncSimulationOnStatus(streetDoneId, 'delivered');
    });
  }

  if (target.closest('[data-sim-start]')) {
    const result = startSimulation();
    return { handled: true, ok: result.ok, message: result.message };
  }

  const streetActivate = target.closest('[data-street-activate]');
  if (streetActivate) {
    const result = activateStreetTestMode(streetActivate.dataset.streetActivate);
    return { handled: true, ok: result.ok, message: result.message };
  }

  if (target.closest('[data-sim-pause]')) {
    const result = pauseSimulation();
    return { handled: true, ok: result.ok, message: result.message };
  }

  if (target.closest('[data-sim-reset]')) {
    const result = resetSimulation();
    return { handled: true, ok: result.ok, message: result.message };
  }

  if (target.closest('[data-sim-gps]')) {
    const result = enableGpsTracking();
    return { handled: true, ok: result.ok, message: result.message };
  }

  if (target.closest('[data-sim-gps-off]')) {
    const result = disableGpsTracking();
    return { handled: true, ok: result.ok, message: result.message };
  }

  return { handled: false };
}

function findDeliveryOrder(orderId) {
  return getState().orders.find((order) => order.id === orderId) || null;
}

function invalidRiderTransition(message) {
  return { handled: true, ok: false, message };
}

function updateDeliveryOrderStatus(orderId, status) {
  const repository = getOrderRepository();
  if (!isPersistentOrderRepository(repository) && !isSandboxOrderRepository(repository)) return updateOrderStatus(orderId, status);
  return repository.updateOrderStatus(orderId, status);
}

function deliveryActionResponse(result, successMessage, onSuccess = null) {
  if (typeof result?.then === 'function') {
    return result.then((resolved) => deliveryActionResponse(resolved, successMessage, onSuccess));
  }
  if (result.ok && typeof onSuccess === 'function') onSuccess();
  return {
    handled: true,
    ok: result.ok,
    message: result.ok ? successMessage : result.message,
  };
}

export function handleDeliveryChange(target) {
  const proofInput = target.closest?.('[data-delivery-proof-input]');
  if (proofInput) {
    return attachProofFromInput(proofInput);
  }

  const destinationSelect = target.closest?.('[data-street-destination]');
  if (destinationSelect) {
    const result = selectStreetTestDestination(destinationSelect.value);
    return { handled: true, ok: result.ok, message: result.message };
  }
  return { handled: false };
}

async function attachProofFromInput(input) {
  const orderId = input.dataset.deliveryProofInput;
  if (findDeliveryOrder(orderId)?.status !== 'arriving') {
    input.value = '';
    return { handled: true, ok: false, message: 'La foto de entrega se adjunta al llegar al domicilio.' };
  }
  const file = input.files?.[0];
  if (!file) return { handled: true, ok: false, message: 'Seleccioná una foto del pedido entregado.' };

  const compressed = await compressDeliveryProofImage(file);
  input.value = '';
  if (!compressed.ok) return { handled: true, ok: false, message: compressed.message };

  const proof = buildDeliveryProof(compressed.dataUrl, {
    capturedAt: new Date().toISOString(),
    source: 'file',
  });
  const result = attachDeliveryProof(orderId, proof);
  return { handled: true, ok: result.ok, message: result.message };
}
