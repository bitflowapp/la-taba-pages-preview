import { advanceOrderToReady, getRiderQueueOrder, updateOrderStatus } from './orders.js';
import {
  formatDemoDistance,
  formatDemoEta,
  getRiderActionState,
  getRiderStateLabel,
  getRouteProgress,
  isAwaitingPreparation,
} from './core/rider.js';
import { simulationProgressPercent } from './core/simulation.js';
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
import { deliveryModeLabel, money, statusClass, statusLabel } from './state.js';
import { escapeHtml } from './ui.js';
import {
  distanceKm,
  getStreetTestDestination,
  getStreetTestDestinations,
} from './map/route_geometry.js';
import { STORE_LOCATION } from './map/map_config.js';

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
    container.innerHTML = `
      <div class="delivery-layout rider-map-experience is-empty">
        ${renderRiderMapStage(null, 'Sin ruta activa', 'Sin ETA', 'No repartiendo')}
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
      </div>`;
    return;
  }

  const awaiting = isAwaitingPreparation(order);
  const { canLeave, canArrive, canDeliver } = getRiderActionState(order);
  const sim = orderSimulation(order);
  const eta = sim ? `${sim.etaMinutes} min` : formatDemoEta(order);
  const distance = formatDemoDistance(order);
  const instructions = order.notes && order.notes !== 'Sin notas' ? order.notes : 'Sin indicaciones especiales del cliente.';
  const destinationLabel = order.delivery?.demoDestinationAddressLabel || order.address;
  const headline = awaiting
    ? 'Esperando preparación'
    : order.status === 'arriving'
    ? 'Llegando al domicilio'
    : order.status === 'on_the_way'
      ? (order.delivery.estimatedMinutes ? `Llegando en ${order.delivery.estimatedMinutes} min` : 'En camino al cliente')
      : order.status === 'delivered' ? 'Pedido entregado'
      : 'Pedido listo para salir';

  const stepIndex = riderStepIndex(order.status);
  const steps = riderSteps.map((step, index) => {
    let cls = 'pending';
    if (index < stepIndex) cls = 'done';
    if (index === stepIndex) cls = 'current';
    return `<div class="track-step ${cls}"><span class="track-dot"></span><small>${step.label}</small></div>`;
  }).join('');

  const waClient = `https://wa.me/${onlyDigits(order.customerPhone)}`;

  container.innerHTML = `
    <div class="delivery-layout rider-map-experience">
      ${renderRiderMapStage(order, distance, eta, headline)}

      <section class="delivery-bottom-sheet rider-sheet rider-card" data-bottom-sheet>
        <span class="sheet-handle" aria-hidden="true"></span>
        <div class="sheet-head rider-head ${statusClass(order.status)}">
          <span class="track-head-ico">REP</span>
          <div class="track-head-text">
            <small>${order.id} · ${escapeHtml(deliveryModeLabel(order.deliveryMode))}</small>
            <strong>${headline}</strong>
            <span>${awaiting ? 'El negocio está preparando el pedido.' : `${distance} · ${eta} estimado`}</span>
          </div>
          <span class="status-chip ${statusClass(order.status)}">${statusLabel(order.status)}</span>
        </div>

        <div class="sheet-metrics rider-metrics">
          <span><small>Distancia</small><strong>${distance}</strong></span>
          <span><small>Tiempo</small><strong>${eta}</strong></span>
          <span><small>A cobrar</small><strong>${money(order.total)}</strong></span>
        </div>

        <div class="track-steps tight">${steps}</div>

          <div class="rider-contact">
            <span class="rider-avatar">${escapeHtml(initials(order.customerName))}</span>
            <span class="rider-contact-text">
              <strong>${escapeHtml(order.customerName)}</strong>
              <small>${escapeHtml(order.customerPhone)} · ${escapeHtml(order.paymentMethod)}</small>
            </span>
            <a class="round-action call" href="tel:${encodeURIComponent(order.customerPhone)}" aria-label="Llamar al cliente">Tel</a>
            <a class="round-action whatsapp" href="${waClient}" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp del cliente">WA</a>
          </div>

          <div class="rider-address">
            <span class="rider-label">Dirección de entrega</span>
            <p>${escapeHtml(destinationLabel)}</p>
          </div>

          <div class="rider-block">
            <p class="rider-label">Pedido</p>
            ${order.items.map((item) => `
              <div class="order-line">
                <span>${item.quantity} × ${escapeHtml(item.name)}</span>
                <strong>${money(item.quantity * item.unitPrice)}</strong>
              </div>
            `).join('')}
            <div class="summary-row total"><span>Total a cobrar</span><strong>${money(order.total)}</strong></div>
          </div>

          <div class="rider-instructions">
            <p class="rider-label">Indicaciones del cliente</p>
            <p>${escapeHtml(instructions)}</p>
          </div>

          ${awaiting ? `
          <div class="rider-waiting">
            <p>El pedido todavía está en preparación en el local.</p>
            <button class="primary-button" type="button" data-rider-ready="${order.id}">Marcar listo</button>
          </div>` : ''}

          <div class="button-row rider-actions">
            <button class="primary-button" type="button" data-delivery-leave="${order.id}" ${canLeave ? '' : 'disabled'}>Salí del local</button>
            <button class="secondary-button" type="button" data-delivery-arrive="${order.id}" ${canArrive ? '' : 'disabled'}>Llegué al domicilio</button>
            <button class="secondary-button" type="button" data-delivery-done="${order.id}" ${canDeliver ? '' : 'disabled'}>Pedido entregado</button>
          </div>

          ${renderSimControls(order, sim)}
          ${renderAdvancedDemo()}
      </section>
    </div>
  `;
}

function riderStepIndex(status) {
  if (status === 'delivered') return 3;
  if (status === 'arriving') return 2;
  if (status === 'on_the_way') return 1;
  if (status === 'ready') return 0;
  return -1; // received / preparing: todavía no arrancó el reparto
}

// Bloque avanzado: esconde relay/sala/equipo para que la vista principal sea operativa.
function renderAdvancedDemo() {
  const status = getRealtimeStatus();
  const connection = status.relayEnabled
    ? (status.relayConnected ? `En vivo entre equipos · sala ${escapeHtml(status.room)}` : `Relay configurado (reconectando) · sala ${escapeHtml(status.room)}`)
    : 'Solo este equipo (sin relay)';
  const linkButtons = status.relayEnabled
    ? `<div class="button-row demo-links">
        <button class="ghost-button compact" type="button" data-copy-client-link>Copiar link cliente</button>
        <button class="ghost-button compact" type="button" data-copy-rider-link>Copiar link rider</button>
      </div>`
    : '<p class="form-hint">Sin relay activo: abrí la app con <code>?relay=…&room=…</code> para probar en dos celulares.</p>';
  return `
    <details class="demo-advanced">
      <summary>Opciones avanzadas</summary>
      <div class="demo-advanced-body">
        <div class="summary-row"><span>Conexión</span><strong>${connection}</strong></div>
        <div class="summary-row"><span>Sala realtime</span><strong>${escapeHtml(status.room)}</strong></div>
        <div class="summary-row"><span>ID de equipo</span><strong>${escapeHtml(String(status.deviceId).slice(0, 8))}</strong></div>
        ${linkButtons}
        <p class="form-hint">Prueba local por LAN: nada se guarda en servidores externos. El tiempo real entre celulares usa el relay propio.</p>
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

function renderSimControls(order, sim) {
  const percent = sim ? simulationProgressPercent(sim) : 0;
  const running = Boolean(sim?.running);
  const canStart = !running && (order.status === 'ready' || order.status === 'on_the_way');
  const canReset = Boolean(sim) && order.status !== 'delivered';
  const gpsOn = isGpsActive();
  const destination = selectedStreetDestination(order, sim);
  const distanceToDestination = currentDistanceToDestination(sim, destination);
  const sourceLabel = sim?.source === 'gps' ? 'GPS real' : 'simulación';
  const gpsCoords = sim && sim.mode === 'gps' && Number.isFinite(sim.lat)
    ? `${sim.lat.toFixed(4)}, ${sim.lng.toFixed(4)}`
    : '';
  const gpsStatus = gpsStatusLabel(sim, gpsOn);
  const lastFix = sim?.lastFixAt
    ? new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(sim.lastFixAt))
    : '';
  const accuracy = Number.isFinite(sim?.accuracy) ? `${Math.round(sim.accuracy)} m` : 'Sin precisión';
  const destinationOptions = getStreetTestDestinations().map((item) => `
    <option value="${escapeHtml(item.id)}" ${item.id === destination.id ? 'selected' : ''}>${escapeHtml(item.label)}</option>
  `).join('');
  const secureHint = globalThis.isSecureContext === false
    ? '<span class="sim-gps-error">El GPS real suele requerir HTTPS o localhost. Podés seguir usando simulación.</span>'
    : '';

  return `
    <div class="sim-panel street-test-panel" data-street-test>
      <div class="sim-head">
        <span class="rider-label">Modo prueba en calle</span>
        <span class="sim-state ${gpsOn ? 'live' : ''}">GPS: ${escapeHtml(gpsStatus)}</span>
      </div>
      <label class="street-destination-field">
        <span>Destino ficticio</span>
        <select data-street-destination aria-label="Destino ficticio de prueba">
          ${destinationOptions}
        </select>
      </label>
      <div class="street-summary-grid">
        <span><small>Destino</small><strong>${escapeHtml(destination.addressLabel || destination.label)}</strong></span>
        <span><small>Distancia</small><strong>${escapeHtml(distanceToDestination)}</strong></span>
        <span><small>Fuente</small><strong>${escapeHtml(sourceLabel)}</strong></span>
        <span><small>Precisión</small><strong>${escapeHtml(accuracy)}</strong></span>
      </div>
      <div class="sim-progress">
        <div class="sim-bar"><span style="width:${percent}%"></span></div>
        <strong data-sim-progress>${percent}%</strong>
      </div>
      <div class="button-row street-primary-actions">
        <button class="primary-button" type="button" data-sim-gps>Usar mi ubicación real</button>
        <button class="secondary-button" type="button" data-sim-gps-off ${gpsOn ? '' : 'disabled'}>Detener GPS</button>
      </div>
      <div class="button-row sim-actions">
        <button class="ghost-button compact" type="button" data-street-activate="${escapeHtml(destination.id)}">Activar modo calle</button>
        <button class="secondary-button compact" type="button" data-sim-start ${canStart ? '' : 'disabled'}>Iniciar simulación</button>
        <button class="ghost-button compact" type="button" data-sim-reset ${canReset ? '' : 'disabled'}>Reiniciar prueba</button>
      </div>
      <div class="button-row street-delivery-actions">
        <button class="secondary-button compact" type="button" data-street-arrive="${order.id}" ${canArriveForStreet(order) ? '' : 'disabled'}>Llegué al destino</button>
        <button class="secondary-button compact" type="button" data-street-done="${order.id}" ${canDeliverForStreet(order) ? '' : 'disabled'}>Pedido entregado</button>
      </div>
      <div class="sim-gps">
        <span class="sim-gps-status">GPS: ${escapeHtml(gpsStatus)}${lastFix ? ` · última actualización ${escapeHtml(lastFix)}` : ''}</span>
        ${gpsCoords ? `<span class="sim-gps-coords">Ubicación rider: ${escapeHtml(gpsCoords)} · ${escapeHtml(sourceLabel)}</span>` : ''}
        ${sim?.gpsError ? `<span class="sim-gps-error">${escapeHtml(sim.gpsError)}</span>` : ''}
        ${secureHint}
      </div>
      <p class="form-hint sim-note">Tu ubicación se comparte sólo en esta demo y mientras el GPS esté activo.</p>
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

function currentDistanceToDestination(sim, destination) {
  const current = sim && Number.isFinite(sim.lat) && Number.isFinite(sim.lng)
    ? { lat: sim.lat, lng: sim.lng }
    : STORE_LOCATION;
  return `${distanceKm(current, destination).toFixed(1).replace('.', ',')} km`;
}

function canArriveForStreet(order) {
  return order?.status === 'on_the_way';
}

function canDeliverForStreet(order) {
  return order?.status === 'on_the_way' || order?.status === 'arriving';
}

function gpsStatusLabel(sim, active) {
  if (active) return 'Activo';
  const labels = {
    inactive: 'Inactivo',
    requesting: 'Pidiendo permiso',
    active: 'Activo',
    denied: 'Permiso denegado',
    unavailable: 'No disponible',
    requires_secure_context: 'Requiere HTTPS/localhost',
  };
  return labels[sim?.gpsStatus || 'inactive'] || 'Inactivo';
}

function renderDemoMap(order, distance, eta) {
  const sim = orderSimulation(order);
  const progress = sim ? sim.progress : getRouteProgress(order);
  const path = 'M 44 176 C 96 150, 96 96, 150 92 S 240 70, 276 44';
  const stateLabel = getRiderStateLabel(order);

  return `
    <div class="demo-map rider-demo-map" role="img" aria-label="Mapa operativo del reparto">
      <div class="demo-map-overlay">
        <span class="map-eta">${eta} · ${distance}</span>
        <span class="map-state">${stateLabel}</span>
      </div>
      <svg class="demo-map-svg" viewBox="0 0 320 220" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id="riderRoute" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#6a5a4d"/>
            <stop offset="1" stop-color="#c9aa84"/>
          </linearGradient>
        </defs>
        <rect width="320" height="220" rx="18" fill="#161616"/>
        <g class="map-streets" stroke="rgba(255,255,255,0.10)" stroke-width="2">
          <line x1="0" y1="48" x2="320" y2="40"/>
          <line x1="0" y1="104" x2="320" y2="112"/>
          <line x1="0" y1="166" x2="320" y2="158"/>
          <line x1="60" y1="0" x2="48" y2="220"/>
          <line x1="150" y1="0" x2="158" y2="220"/>
          <line x1="244" y1="0" x2="236" y2="220"/>
        </g>
        <path d="${path}" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="8" stroke-linecap="round"/>
        <path class="map-route" d="${path}" fill="none" stroke="url(#riderRoute)" stroke-width="4" stroke-linecap="round" stroke-dasharray="6 7"/>
      </svg>
      <span class="map-marker store" style="left:14%;top:80%"><span>LT</span><small>La Taba</small></span>
      <span class="map-marker client" style="left:86%;top:20%"><span>CL</span><small>Cliente</small></span>
      <span class="map-marker rider rider-${order.status}" style="--p:${progress}"><span>R</span></span>
    </div>
  `;
}

function renderIdleMap() {
  return `
    <div class="demo-map rider-demo-map" role="img" aria-label="Mapa operativo sin reparto activo">
      <div class="demo-map-overlay">
        <span class="map-eta">Neuquén · Cipolletti</span>
        <span class="map-state">Sin reparto</span>
      </div>
      <svg class="demo-map-svg" viewBox="0 0 320 220" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <rect width="320" height="220" rx="18" fill="#161616"/>
        <g class="map-streets" stroke="rgba(255,255,255,0.10)" stroke-width="2">
          <line x1="0" y1="58" x2="320" y2="44"/><line x1="0" y1="128" x2="320" y2="116"/>
          <line x1="70" y1="0" x2="54" y2="220"/><line x1="184" y1="0" x2="170" y2="220"/>
        </g>
        <path d="M 44 150 C 94 112, 134 98, 184 82 S 248 64, 284 48" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="8" stroke-linecap="round"/>
        <path d="M 44 150 C 94 112, 134 98, 184 82 S 248 64, 284 48" fill="none" stroke="#6a5a4d" stroke-width="4" stroke-linecap="round" stroke-dasharray="7 8"/>
      </svg>
      <span class="map-marker store" style="left:18%;top:68%"><span>LT</span><small>Neuquén</small></span>
      <span class="map-marker client" style="left:84%;top:24%"><span>CI</span><small>Cipolletti</small></span>
    </div>`;
}

function renderRiderMapStage(order, distance, eta, headline) {
  const status = getRealtimeStatus();
  const connection = status.relayEnabled
    ? (status.relayConnected ? 'Realtime activo' : 'Reconectando relay')
    : 'Modo local';
  return `
    <div class="delivery-map-stage rider-map-stage" data-map-shell="rider">
      ${renderRealMapShell(order, order ? renderDemoMap(order, distance, eta) : renderIdleMap(), order ? 'rider' : 'rider-empty')}
      <div class="map-floating-top">
        <span class="map-status-pill ${order ? statusClass(order.status) : 'idle'}"><small>Estado</small><strong>${escapeHtml(headline)}</strong></span>
        <span class="map-connection-pill">${escapeHtml(connection)}</span>
      </div>
      <div class="map-floating-bottom">
        <span class="map-stat-pill"><small>Distancia</small><strong>${escapeHtml(distance)}</strong></span>
        <span class="map-stat-pill"><small>Tiempo</small><strong>${escapeHtml(eta)}</strong></span>
      </div>
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
      <div class="real-map-meta" data-map-meta>Ubicación estimada</div>
    </div>`;
}

export function handleDeliveryAction(target) {
  const readyId = target.closest('[data-rider-ready]')?.dataset.riderReady;
  if (readyId) {
    const result = advanceOrderToReady(readyId);
    return {
      handled: true,
      ok: result.ok,
      message: result.ok ? 'Pedido listo para reparto.' : result.message,
    };
  }

  const leaveId = target.closest('[data-delivery-leave]')?.dataset.deliveryLeave;
  if (leaveId) {
    const result = updateOrderStatus(leaveId, 'on_the_way');
    if (result.ok) syncSimulationOnStatus(leaveId, 'on_the_way');
    return {
      handled: true,
      ok: result.ok,
      message: result.ok ? 'Pedido marcado como en camino.' : result.message,
    };
  }

  const arriveId = target.closest('[data-delivery-arrive]')?.dataset.deliveryArrive;
  if (arriveId) {
    const result = updateOrderStatus(arriveId, 'arriving');
    if (result.ok) syncSimulationOnStatus(arriveId, 'arriving');
    return {
      handled: true,
      ok: result.ok,
      message: result.ok ? 'Llegada al domicilio registrada.' : result.message,
    };
  }

  const streetArriveId = target.closest('[data-street-arrive]')?.dataset.streetArrive;
  if (streetArriveId) {
    const result = updateOrderStatus(streetArriveId, 'arriving');
    if (result.ok) syncSimulationOnStatus(streetArriveId, 'arriving');
    return {
      handled: true,
      ok: result.ok,
      message: result.ok ? 'Llegada al destino registrada.' : result.message,
    };
  }

  const doneId = target.closest('[data-delivery-done]')?.dataset.deliveryDone;
  if (doneId) {
    const result = updateOrderStatus(doneId, 'delivered');
    if (result.ok) syncSimulationOnStatus(doneId, 'delivered');
    return {
      handled: true,
      ok: result.ok,
      message: result.ok ? 'Pedido marcado como entregado.' : result.message,
    };
  }

  const streetDoneId = target.closest('[data-street-done]')?.dataset.streetDone;
  if (streetDoneId) {
    const result = updateOrderStatus(streetDoneId, 'delivered');
    if (result.ok) syncSimulationOnStatus(streetDoneId, 'delivered');
    return {
      handled: true,
      ok: result.ok,
      message: result.ok ? 'Pedido marcado como entregado.' : result.message,
    };
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

export function handleDeliveryChange(target) {
  const destinationSelect = target.closest?.('[data-street-destination]');
  if (destinationSelect) {
    const result = selectStreetTestDestination(destinationSelect.value);
    return { handled: true, ok: result.ok, message: result.message };
  }
  return { handled: false };
}
