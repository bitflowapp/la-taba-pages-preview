import {
  advanceOrderToReady,
  attachDeliveryProof,
  confirmDeliveryCode,
  getRiderQueueOrder,
  removeDeliveryProof,
  updateOrderStatus,
} from './orders.js';
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
import { getDataMode, getOrderRepository, isPersistentOrderRepository } from './repositories/repository_factory.js';
import { bagGlyph, escapeHtml, renderWithStableRealMap } from './ui.js';
import {
  GPS_GOOD_ACCURACY_METERS,
  getStreetTestDestination,
  getStreetTestDestinations,
  hasLiveRiderLocation,
} from './map/route_geometry.js';
import { renderOrderTimeline } from './core/order-timeline.js';

export function renderDeliveryPanel() {
  const container = document.querySelector('[data-delivery-panel]');
  if (!container) return;
  const order = getRiderQueueOrder();
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
            <strong>No hay pedidos para repartir.</strong><br />
            Cuando un cliente confirme un pedido con envío, aparece acá con la dirección, el total a cobrar y los botones de reparto.
            <div class="empty-actions">
              <button class="secondary-button compact" type="button" data-nav-view="catalog">Ver catálogo</button>
            </div>
          </div>
          ${renderRiderHistory()}
          ${renderAdvancedDemo()}
        </section>
      </div>`, { rolePrefix: 'rider' });
    return;
  }

  const awaiting = isAwaitingPreparation(order);
  const { canLeave, canArrive, canDeliver } = getRiderActionState(order);
  const sim = orderSimulation(order);
  const gpsState = riderGpsShareState(sim);
  const gpsLive = false;
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
    ? 'Esperando el siguiente estado de la presentación.'
    : 'Recorrido local por estados, sin GPS ni ubicación en vivo.';

  const waClient = `https://wa.me/${onlyDigits(order.customerPhone)}`;

  renderWithStableRealMap(container, `
    <div class="delivery-layout rider-map-experience ${gpsLive ? '' : 'no-map'}">
      ${gpsLive ? renderRiderMapStage(order) : ''}

      <section class="delivery-bottom-sheet rider-sheet rider-card ${gpsLive ? 'is-live' : 'is-offline'}" data-bottom-sheet>
        <span class="sheet-handle" aria-hidden="true"></span>
        ${renderRiderSheetTopbar()}
        <div class="sheet-head rider-head ${statusClass(order.status)}">
          <span class="track-head-ico">${bagGlyph()}</span>
          <div class="track-head-text">
            <small>Entrega actual · ${order.id}</small>
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

        ${renderRiderQuickActions(order, destinationLabel, address)}

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

        ${renderDeliveryProofPanel(order)}
        ${renderDeliveryCodePanel(order)}
        ${renderRiderActions(order, { canLeave, canArrive, canDeliver })}
        ${renderOrderTimeline(order.status, { className: 'tight rider-progress' })}
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

        ${renderRiderHistory(order)}

        ${renderAdvancedDemo()}
      </section>
    </div>
  `, { rolePrefix: 'rider', orderId: order.id });
  restoreDeliveryCodeDraft(container, codeDraft);
}

function renderRiderSheetTopbar() {
  return `
    <div class="rider-sheet-topbar">
      <div class="rider-sheet-title">
        <strong>Mis entregas</strong>
        <span class="rider-online-chip is-local"><i aria-hidden="true"></i>Modo demo local</span>
      </div>
      <div class="rider-sheet-actions">
        <button class="ghost-button compact" type="button" data-open-admin-view="business">Panel negocio</button>
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

// Historial corto de entregas del rider: pedidos de delivery ya entregados.
// Datos reales de la demo, sin viajes inventados.
function renderRiderHistory(currentOrder = null) {
  const delivered = (getState().orders || [])
    .filter((order) => order.status === 'delivered' && order.deliveryMode === 'delivery')
    .filter((order) => order.id !== currentOrder?.id)
    .slice(0, 3);
  if (!delivered.length) return '';
  return `
    <section class="rider-history" aria-label="Entregas de ejemplo">
      <p class="rider-label">Entregas de ejemplo · Simulación</p>
      ${delivered.map((order) => `
        <div class="rider-history-row">
          <span class="rider-history-check" aria-hidden="true">✓</span>
          <div class="rider-history-text">
            <strong>${escapeHtml(order.id)} · ${escapeHtml(order.customerName)}</strong>
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
  if (canDeliver) {
    const cls = canArrive ? 'secondary-button' : 'primary-button';
    actions.push(`<button class="${cls}" type="button" data-delivery-done="${order.id}">Pedido entregado</button>`);
  }
  if (!actions.length) return '';
  return `<div class="button-row rider-actions">${actions.join('')}</div>`;
}

function renderDeliveryProofPanel(order) {
  if (!['ready', 'on_the_way', 'arriving'].includes(order.status)) return '';
  const proof = order.deliveryProof || null;
  const proofTime = proof ? formatDeliveryProofTime(proof) : '';
  const input = `
    <input class="delivery-proof-input" data-delivery-proof-input="${escapeHtml(order.id)}" type="file" accept="image/*" capture="environment" aria-label="Adjuntar foto de entrega" />`;

  return `
    <section class="delivery-proof-panel ${proof ? 'has-proof' : ''}" data-delivery-proof-panel>
      <div class="delivery-proof-copy">
        <strong>Foto de entrega</strong>
        <p>Sacá una foto del pedido entregado. Evitá fotografiar personas, DNI o datos privados.</p>
        ${proof ? `<small>Comprobante tomado: ${escapeHtml(proofTime || 'sin hora')}</small>` : '<small>Podés adjuntar una foto como comprobante antes de entregar.</small>'}
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
  if (!['on_the_way', 'arriving'].includes(order.status)) return '';
  const deliveryCode = normalizeDeliveryCode(order.deliveryCode, { seed: order.id });
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
        <small>Si el cliente no lo encuentra, podés entregar igual y dejar foto como respaldo.</small>`}
    </section>`;
}

// Bloque avanzado: esconde relay/sala/equipo para que la vista principal sea operativa.
function renderAdvancedDemo() {
  return '';
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
  return `
    <div class="sim-panel street-test-panel is-offline" data-street-test>
      <div class="sim-head">
        <span class="rider-label">Seguimiento de la presentación</span>
        <span class="sim-state">Local</span>
      </div>
      <p class="form-hint">Los avances se confirman con los botones de estado. No se usa GPS, ETA ni ubicación en vivo.</p>
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

// Escenario de mapa del rider. SÓLO se monta con GPS real en vivo (lo decide
// renderDeliveryPanel), así que los overlays flotantes —pill de estado con punto
// vivo, botón de centrar y de navegar— son honestos por construcción: no existen
// sin ubicación real. "Navegar" abre el mapa nativo con la dirección textual del
// cliente (búsqueda real, sin ruta inventada dentro de la app).
function renderRiderMapStage(order) {
  const address = normalizeOrderAddressDetails(order);
  const destination = displayDestinationLabel(address.label || order.address);
  const navQuery = encodeURIComponent([destination, address.reference].filter(Boolean).join(' '));
  const navUrl = navQuery ? `https://www.google.com/maps/dir/?api=1&destination=${navQuery}` : '';
  const supportDigits = onlyDigits(getBusinessConfig().whatsappNumber);
  const supportUrl = supportDigits ? `https://wa.me/${supportDigits}` : '';

  return `
    <div class="delivery-map-stage rider-map-stage" data-map-shell="rider">
      ${renderRealMapShell(order, '<p class="map-fallback-note">Mapa no disponible en este dispositivo.</p>', 'rider')}
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

// Pill de estado flotante (referencia visual: "Estado / Repartiendo"). El punto
// vivo es honesto: este pill sólo se renderiza dentro del mapa con GPS real.
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

function riderPillStatusLabel(order) {
  if (isAwaitingPreparation(order)) return 'Esperando';
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
  const codeButton = target.closest('[data-delivery-code-confirm]');
  const codeOrderId = codeButton?.dataset.deliveryCodeConfirm;
  if (codeOrderId) {
    const panel = codeButton.closest('[data-delivery-code-panel]');
    const input = panel?.querySelector?.('[data-delivery-code-input]');
    const result = confirmDeliveryCode(codeOrderId, input?.value || '');
    if (result.ok && input) input.value = '';
    return { handled: true, ok: result.ok, message: result.message };
  }

  const removeProofId = target.closest('[data-delivery-proof-remove]')?.dataset.deliveryProofRemove;
  if (removeProofId) {
    return { handled: true, ...removeDeliveryProof(removeProofId) };
  }

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
