import { advanceOrderToReady, getRiderQueueOrder, updateOrderStatus } from './orders.js';
import {
  getRiderActionState,
  isAwaitingPreparation,
} from './core/rider.js';
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
import { normalizeOrderAddressDetails } from './core/address.js';
import { deliveryModeLabel, money, statusClass, statusLabel } from './state.js';
import { getDataMode, getOrderRepository, isPersistentOrderRepository } from './repositories/repository_factory.js';
import { bagGlyph, escapeHtml, renderWithStableRealMap } from './ui.js';
import {
  GPS_GOOD_ACCURACY_METERS,
  getStreetTestDestination,
  getStreetTestDestinations,
  hasLiveRiderLocation,
} from './map/route_geometry.js';

const riderSteps = [
  { key: 'ready', label: 'Listo' },
  { key: 'on_the_way', label: 'En camino' },
  { key: 'arriving', label: 'Llegando' },
  { key: 'delivered', label: 'Entregado' },
];

export function renderDeliveryPanel() {
  const container = document.querySelector('[data-delivery-panel]');
  if (!container) return;
  const order = getRiderQueueOrder();

  if (!order) {
    renderWithStableRealMap(container, `
      <div class="delivery-layout rider-map-experience is-empty no-map">
        <section class="delivery-bottom-sheet rider-sheet rider-card" data-bottom-sheet>
          <span class="sheet-handle" aria-hidden="true"></span>
          <div class="empty-state sheet-empty">
            <strong>No hay pedidos para repartir.</strong><br />
            Cuando un cliente confirme un pedido con envío, aparece acá con la dirección, el total a cobrar y los botones de reparto.
            <div class="empty-actions">
              <button class="secondary-button compact" type="button" data-nav-view="catalog">Ver catálogo</button>
            </div>
          </div>
          ${renderAdvancedDemo()}
        </section>
      </div>`, { rolePrefix: 'rider' });
    return;
  }

  const awaiting = isAwaitingPreparation(order);
  const { canLeave, canArrive, canDeliver } = getRiderActionState(order);
  const sim = orderSimulation(order);
  const gpsState = riderGpsShareState(sim);
  const gpsLive = gpsState.live;
  const instructions = order.notes && order.notes !== 'Sin notas' ? order.notes : 'Sin indicaciones especiales del cliente.';
  const address = normalizeOrderAddressDetails(order);
  const destinationLabel = displayDestinationLabel(address.label || order.address);
  const addressText = [destinationLabel, address.reference ? `Referencia: ${address.reference}` : ''].filter(Boolean).join('\n');
  const headline = awaiting
    ? 'Esperando preparación'
    : order.status === 'arriving'
    ? 'Llegando al domicilio'
    : order.status === 'on_the_way' ? 'En camino al cliente'
      : order.status === 'delivered' ? 'Pedido entregado'
      : 'Pedido listo para salir';
  const headSub = awaiting
    ? 'Esperando al local.'
    : gpsState.headSub;

  const stepIndex = riderStepIndex(order.status);
  const steps = riderSteps.map((step, index) => {
    let cls = 'pending';
    if (index < stepIndex) cls = 'done';
    if (index === stepIndex) cls = 'current';
    return `<div class="track-step ${cls}"><span class="track-dot"></span><small>${step.label}</small></div>`;
  }).join('');

  const waClient = `https://wa.me/${onlyDigits(order.customerPhone)}`;

  renderWithStableRealMap(container, `
    <div class="delivery-layout rider-map-experience ${gpsLive ? '' : 'no-map'}">
      ${gpsLive ? renderRiderMapStage(order) : ''}

      <section class="delivery-bottom-sheet rider-sheet rider-card ${gpsLive ? 'is-live' : 'is-offline'}" data-bottom-sheet>
        <span class="sheet-handle" aria-hidden="true"></span>
        <div class="sheet-head rider-head ${statusClass(order.status)}">
          <span class="track-head-ico">${bagGlyph()}</span>
          <div class="track-head-text">
            <small>${order.id} - Reparto</small>
            <strong>${headline}</strong>
            <span>${escapeHtml(headSub)}</span>
          </div>
          <span class="status-chip ${statusClass(order.status)}">${statusLabel(order.status)}</span>
        </div>

        <div class="rider-contact">
          <span class="rider-avatar">${escapeHtml(initials(order.customerName))}</span>
          <span class="rider-contact-text">
            <small>Cliente</small>
            <strong>${escapeHtml(order.customerName)}</strong>
            <em>${escapeHtml(order.customerPhone)}</em>
          </span>
          <a class="round-action call" href="tel:${encodeURIComponent(order.customerPhone)}" aria-label="Llamar al cliente">Tel</a>
          <a class="round-action whatsapp" href="${waClient}" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp del cliente">WA</a>
        </div>

        <div class="rider-address">
          <span class="rider-label">Dirección</span>
          <p>${escapeHtml(destinationLabel)}</p>
          ${address.reference ? `<p class="rider-reference">Referencia: ${escapeHtml(address.reference)}</p>` : ''}
          <div class="rider-copy-row">
            <button class="ghost-button compact" type="button" data-copy-address="${escapeHtml(addressText)}">Copiar dirección</button>
          </div>
        </div>

        <div class="sheet-metrics rider-metrics">
          <span class="metric-priority"><small>A cobrar</small><strong>${money(order.total)}</strong></span>
          <span><small>Pago</small><strong>${escapeHtml(order.paymentMethod)}</strong></span>
          <span><small>Estado</small><strong>${escapeHtml(statusLabel(order.status))}</strong></span>
        </div>

        ${awaiting ? `
        <div class="rider-waiting">
          <p>El pedido todavía está en preparación en el local.</p>
          <button class="primary-button" type="button" data-rider-ready="${order.id}">Marcar listo</button>
        </div>` : ''}

        ${renderRiderActions(order, { canLeave, canArrive, canDeliver })}
        <div class="track-steps tight rider-progress">${steps}</div>
        ${renderSimControls(order, sim)}

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

        ${renderAdvancedDemo()}
      </section>
    </div>
  `, { rolePrefix: 'rider', orderId: order.id });
}

function riderStepIndex(status) {
  if (status === 'delivered') return 3;
  if (status === 'arriving') return 2;
  if (status === 'on_the_way') return 1;
  if (status === 'ready') return 0;
  return -1; // received / preparing: todavía no arrancó el reparto
}

function renderRiderActions(order, { canLeave, canArrive, canDeliver }) {
  const actions = [];
  if (canLeave) {
    actions.push(`<button class="primary-button" type="button" data-delivery-leave="${order.id}">Salí del local</button>`);
  }
  if (canArrive) {
    actions.push(`<button class="primary-button" type="button" data-delivery-arrive="${order.id}">Llegué al domicilio</button>`);
  }
  if (canDeliver) {
    const cls = canArrive ? 'secondary-button' : 'primary-button';
    actions.push(`<button class="${cls}" type="button" data-delivery-done="${order.id}">Pedido entregado</button>`);
  }
  if (!actions.length) return '';
  return `<div class="button-row rider-actions">${actions.join('')}</div>`;
}

// Bloque avanzado: esconde relay/sala/equipo para que la vista principal sea operativa.
function renderAdvancedDemo() {
  const status = getRealtimeStatus();
  const connection = `${relayStatusLabel(status)}${status.relayEnabled ? ` · sala ${escapeHtml(status.room)}` : ''}`;
  const retryButton = status.relayEnabled && !status.relayConnected
    ? '<button class="ghost-button compact" type="button" data-retry-relay>Reintentar conexión</button>'
    : '';
  const linkButtons = status.relayEnabled
    ? `<div class="button-row demo-links">
        <button class="ghost-button compact" type="button" data-copy-client-link>Copiar link cliente</button>
        <button class="ghost-button compact" type="button" data-copy-rider-link>Copiar link rider</button>
        ${retryButton}
      </div>`
    : '<p class="form-hint">Para usar dos celulares, abrí la app con el enlace compartido del comercio.</p>';
  return `
    <details class="demo-advanced">
      <summary>Opciones avanzadas</summary>
      <div class="demo-advanced-body">
        <div class="summary-row"><span>Conexión</span><strong>${connection}</strong></div>
        <div class="summary-row"><span>Sala de reparto</span><strong>${escapeHtml(status.room)}</strong></div>
        <div class="summary-row"><span>ID de equipo</span><strong>${escapeHtml(String(status.deviceId).slice(0, 8))}</strong></div>
        ${linkButtons}
        <p class="form-hint">Los pedidos de esta sala se usan sólo para esta presentación comercial.</p>
      </div>
    </details>
  `;
}

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || '?';
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

// Panel de GPS real del rider. No hay ruta simulada ni recorrido de apoyo:
// el rider comparte su ubicación real (watchPosition) o no comparte nada.
function renderSimControls(order, sim) {
  const gpsWatching = isGpsActive();
  const gpsSession = gpsWatching || sim?.mode === 'gps' || sim?.gpsStatus === 'requesting' || sim?.gpsStatus === 'active';
  const gpsState = riderGpsShareState(sim);
  const gpsStatus = gpsProductStatusLabel(sim, gpsState.live);
  const signalStatus = gpsSignalStatusLabel(sim, gpsState.live);
  const lastGpsFixAt = sim?.lastGpsFixAt || (sim?.source === 'gps' ? sim?.lastFixAt : null);
  const lastFix = lastGpsFixAt ? relativeAgeLabel(lastGpsFixAt) : '';
  const gpsButtonLabel = sim?.gpsStatus === 'requesting'
    ? 'Esperando permiso…'
    : gpsSession && !gpsState.live && sim?.gpsStatus === 'active'
      ? 'Sin GPS en vivo'
      : gpsSession && sim?.gpsStatus === 'unavailable'
      ? 'Buscando señal…'
      : sim?.gpsStatus === 'active' && gpsSession && gpsState.live
      ? 'Compartiendo ubicación'
      : 'Compartir ubicación real';
  const gpsButtonDisabled = sim?.gpsStatus === 'requesting' || gpsSession;
  const secureHint = globalThis.isSecureContext === false
    ? '<span class="sim-gps-error">El GPS real requiere HTTPS o localhost seguro. Sin eso no se puede compartir ubicación en vivo.</span>'
    : '';

  return `
    <div class="sim-panel street-test-panel ${gpsState.live ? 'is-live' : 'is-offline'}" data-street-test>
      <div class="sim-head">
        <span class="rider-label">Ubicación del rider</span>
        <span class="sim-state ${gpsState.live ? 'live' : ''}">${escapeHtml(gpsStatus)}</span>
      </div>
      <p class="form-hint">${escapeHtml(gpsState.headSub)}</p>
      <div class="street-summary-grid">
        <span><small>Estado</small><strong>${escapeHtml(gpsStatus)}</strong></span>
        <span><small>Señal</small><strong>${escapeHtml(signalStatus)}</strong></span>
        <span><small>Última lectura</small><strong>${escapeHtml(lastFix || 'Sin datos')}</strong></span>
      </div>
      <div class="button-row street-primary-actions">
        <button class="primary-button" type="button" data-sim-gps ${gpsButtonDisabled ? 'disabled' : ''}>${escapeHtml(gpsButtonLabel)}</button>
        <button class="secondary-button" type="button" data-sim-gps-off ${gpsSession ? '' : 'disabled'}>Detener ubicación</button>
      </div>
      <div class="sim-gps">
        <span class="sim-gps-status">${escapeHtml(signalStatus)}${lastFix ? ` · actualizado ${escapeHtml(lastFix)}` : ''}</span>
        ${sim?.gpsError ? `<span class="sim-gps-error">${escapeHtml(sim.gpsError)}</span>` : ''}
        ${secureHint}
      </div>
      ${renderGpsDiagnostics(sim, gpsWatching)}
    </div>
  `;
}

function selectedStreetDestination(order, sim) {
  return getStreetTestDestination(
    sim?.destinationId
      || sim?.routeId
      || order?.delivery?.demoDestinationId,
  );
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
    return mode === 'supabase' ? 'Supabase' : mode === 'http' ? 'API propia' : mode === 'demo-realtime' ? 'Presentación en vivo' : 'Este equipo';
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

function renderRiderMapStage(order) {
  return `
    <div class="delivery-map-stage rider-map-stage" data-map-shell="rider">
      ${renderRealMapShell(order, '<p class="map-fallback-note">Mapa no disponible en este dispositivo.</p>', 'rider')}
      <span class="rider-map-live-chip" aria-label="GPS real compartido"><span aria-hidden="true"></span>GPS</span>
    </div>`;
}

function renderRealMapShell(order, fallback, role = 'rider') {
  const orderAttr = order?.id ? ` data-order-id="${escapeHtml(order.id)}"` : '';
  return `
    <div class="real-map-shell rider-map-shell" data-real-map data-map-role="${escapeHtml(role)}"${orderAttr}>
      <div class="real-map-canvas" data-map-canvas aria-label="Mapa real del reparto"></div>
      <div class="real-map-fallback" data-map-fallback>
        <p class="map-fallback-note">Mapa no disponible, usando vista simplificada.</p>
        ${fallback}
      </div>
      <div class="real-map-meta" data-map-meta>Mapa de reparto</div>
    </div>`;
}

export function handleDeliveryAction(target) {
  const readyId = target.closest('[data-rider-ready]')?.dataset.riderReady;
  if (readyId) {
    return deliveryActionResponse(readyOrderForDelivery(readyId), 'Pedido listo para reparto.');
  }

  const leaveId = target.closest('[data-delivery-leave]')?.dataset.deliveryLeave;
  if (leaveId) {
    return deliveryActionResponse(updateDeliveryOrderStatus(leaveId, 'on_the_way'), 'Pedido marcado como en camino.', () => {
      syncSimulationOnStatus(leaveId, 'on_the_way');
    });
  }

  const arriveId = target.closest('[data-delivery-arrive]')?.dataset.deliveryArrive;
  if (arriveId) {
    return deliveryActionResponse(updateDeliveryOrderStatus(arriveId, 'arriving'), 'Llegada al domicilio registrada.', () => {
      syncSimulationOnStatus(arriveId, 'arriving');
    });
  }

  const streetArriveId = target.closest('[data-street-arrive]')?.dataset.streetArrive;
  if (streetArriveId) {
    return deliveryActionResponse(updateDeliveryOrderStatus(streetArriveId, 'arriving'), 'Llegada al destino registrada.', () => {
      syncSimulationOnStatus(streetArriveId, 'arriving');
    });
  }

  const doneId = target.closest('[data-delivery-done]')?.dataset.deliveryDone;
  if (doneId) {
    return deliveryActionResponse(updateDeliveryOrderStatus(doneId, 'delivered'), 'Pedido marcado como entregado.', () => {
      syncSimulationOnStatus(doneId, 'delivered');
    });
  }

  const streetDoneId = target.closest('[data-street-done]')?.dataset.streetDone;
  if (streetDoneId) {
    return deliveryActionResponse(updateDeliveryOrderStatus(streetDoneId, 'delivered'), 'Pedido marcado como entregado.', () => {
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

function readyOrderForDelivery(orderId) {
  const repository = getOrderRepository();
  if (!isPersistentOrderRepository(repository)) return advanceOrderToReady(orderId);
  return repository.updateOrderStatus(orderId, 'preparing')
    .then((preparing) => (preparing.ok ? repository.updateOrderStatus(orderId, 'ready') : preparing));
}

function updateDeliveryOrderStatus(orderId, status) {
  const repository = getOrderRepository();
  if (!isPersistentOrderRepository(repository)) return updateOrderStatus(orderId, status);
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
  const destinationSelect = target.closest?.('[data-street-destination]');
  if (destinationSelect) {
    const result = selectStreetTestDestination(destinationSelect.value);
    return { handled: true, ok: result.ok, message: result.message };
  }
  return { handled: false };
}
