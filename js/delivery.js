import { getActiveDeliveryOrder, updateOrderStatus } from './orders.js';
import {
  formatDemoDistance,
  formatDemoEta,
  getRiderActionState,
  getRiderStateLabel,
  getRouteProgress,
} from './core/rider.js';
import { deliveryModeLabel, money, statusClass, statusLabel } from './state.js';
import { escapeHtml } from './ui.js';

function riderWhatsAppUrl(order) {
  const digits = String(order.customerPhone || '').replace(/\D/g, '');
  const intl = digits.startsWith('54') ? digits : `549${digits}`;
  const text = `Hola ${order.customerName}, soy el repartidor de La Taba con tu pedido ${order.id}. Voy en camino.`;
  return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`;
}

export function renderDeliveryPanel() {
  const container = document.querySelector('[data-delivery-panel]');
  if (!container) return;
  const order = getActiveDeliveryOrder();

  if (!order) {
    container.innerHTML = '<div class="empty-state">No hay pedidos asignados al repartidor. Los pedidos de retiro en local no aparecen en esta vista.</div>';
    return;
  }

  const { canLeave, canArrive, canDeliver } = getRiderActionState(order);
  const arrived = order.status === 'arriving';
  const eta = formatDemoEta(order);
  const distance = formatDemoDistance(order);
  const instructions = order.notes && order.notes !== 'Sin notas' ? order.notes : 'Sin indicaciones especiales del cliente.';
  const statusHeadline = order.status === 'on_the_way'
    ? `Llegando en ${eta}`
    : arrived
      ? 'Llegando al domicilio'
      : order.status === 'ready'
        ? 'Listo para salir del local'
        : statusLabel(order.status);

  container.innerHTML = `
    <div class="delivery-status-hero">
      <span class="delivery-rider-icon">🛵</span>
      <div>
        <small>Repartidor asignado</small>
        <strong>${statusHeadline}</strong>
        <span>${distance} restantes · ${escapeHtml(order.delivery.driverName)}</span>
      </div>
      <span class="status-chip ${statusClass(order.status)}">${statusLabel(order.status)}</span>
    </div>

    <div class="delivery-layout">
      <div class="card rider-card">
        <div class="order-card-head">
          <div>
            <h3>${order.id} · ${escapeHtml(order.customerName)}</h3>
            <p>${deliveryModeLabel(order.deliveryMode)} · ${escapeHtml(order.address)}</p>
          </div>
          <span class="status-chip ${statusClass(order.status)}">${statusLabel(order.status)}</span>
        </div>

        <div class="rider-chips">
          <span class="rider-chip"><small>Distancia</small><strong>${distance}</strong></span>
          <span class="rider-chip"><small>Tiempo estimado</small><strong>${eta}</strong></span>
          <span class="rider-chip"><small>A cobrar</small><strong>${money(order.total)}</strong></span>
        </div>

        <div class="rider-meta">
          <span><small>Entrega</small>${deliveryModeLabel(order.deliveryMode)}</span>
          <span><small>Pago</small>${escapeHtml(order.paymentMethod)}</span>
        </div>

        <div class="rider-contact">
          <span class="rider-avatar">${escapeHtml(initials(order.customerName))}</span>
          <span class="rider-contact-text"><strong>${escapeHtml(order.customerName)}</strong><small>${escapeHtml(order.customerPhone)}</small></span>
          <a class="rider-icon-btn" href="tel:${encodeURIComponent(order.customerPhone)}" aria-label="Llamar al cliente">📞</a>
          <a class="rider-icon-btn wa" href="${riderWhatsAppUrl(order)}" target="_blank" rel="noopener noreferrer" aria-label="Escribir por WhatsApp">💬</a>
        </div>

        <div class="rider-block">
          <p class="rider-label">Pedido</p>
          ${order.items.map((item) => `
            <div class="order-line">
              <span>${item.icon} ${item.quantity} x ${escapeHtml(item.name)}</span>
              <strong>${money(item.quantity * item.unitPrice)}</strong>
            </div>
          `).join('')}
        </div>

        <div class="rider-instructions">
          <p class="rider-label">Indicaciones del cliente</p>
          <p>${escapeHtml(instructions)}</p>
        </div>

        <div class="rider-steps" style="margin-top:14px">
          <button class="primary-button" type="button" data-delivery-leave="${order.id}" ${canLeave ? '' : 'disabled'}>Salí del local</button>
          <button class="secondary-button" type="button" data-delivery-arrive="${order.id}" ${canArrive ? '' : 'disabled'}>Llegué al domicilio</button>
          <button class="secondary-button" type="button" data-delivery-done="${order.id}" ${canDeliver ? '' : 'disabled'}>Pedido entregado</button>
        </div>
      </div>

      <div class="delivery-map">
        ${renderDemoMap(order, distance, eta)}
      </div>
    </div>
  `;
}

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || '?';
}

function renderDemoMap(order, distance, eta) {
  // Progreso del rider sobre la ruta según el estado del pedido.
  const progress = getRouteProgress(order);
  // Ruta fija (demo) sobre el "mapa". Coordenadas en el viewBox 0..320 x 0..220.
  const path = 'M 44 176 C 96 150, 96 96, 150 92 S 240 70, 276 44';
  const stateLabel = getRiderStateLabel(order);

  return `
    <div class="demo-map" role="img" aria-label="Mapa de demostración del reparto">
      <div class="demo-map-overlay">
        <span class="map-eta">🛵 ${eta} · ${distance}</span>
        <span class="map-state">${stateLabel}</span>
      </div>
      <svg class="demo-map-svg" viewBox="0 0 320 220" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id="riderRoute" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#e0a066"/>
            <stop offset="1" stop-color="#b84f40"/>
          </linearGradient>
          <filter id="routeGlow">
            <feGaussianBlur stdDeviation="2.6" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        <g class="map-streets" stroke="rgba(255,255,255,0.06)" stroke-width="2">
          <line x1="0" y1="48" x2="320" y2="40"/>
          <line x1="0" y1="104" x2="320" y2="112"/>
          <line x1="0" y1="166" x2="320" y2="158"/>
          <line x1="60" y1="0" x2="48" y2="220"/>
          <line x1="150" y1="0" x2="158" y2="220"/>
          <line x1="244" y1="0" x2="236" y2="220"/>
          <line x1="20" y1="16" x2="300" y2="196"/>
          <line x1="28" y1="204" x2="292" y2="28"/>
        </g>
        <path d="${path}" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="8" stroke-linecap="round"/>
        <path class="map-route" d="${path}" fill="none" stroke="url(#riderRoute)" stroke-width="5" stroke-linecap="round" stroke-dasharray="6 7" filter="url(#routeGlow)"/>
      </svg>
      <span class="map-marker store" style="left:14%;top:80%"><span>🏪</span><small>La Taba</small></span>
      <span class="map-marker client" style="left:86%;top:20%"><span>📍</span><small>Cliente</small></span>
      <span class="map-marker rider rider-${order.status}" style="--p:${progress}"><span>🛵</span></span>
    </div>
  `;
}

export function handleDeliveryAction(target) {
  const leaveId = target.closest('[data-delivery-leave]')?.dataset.deliveryLeave;
  if (leaveId) {
    const result = updateOrderStatus(leaveId, 'on_the_way');
    return {
      handled: true,
      ok: result.ok,
      message: result.ok ? 'Pedido marcado como en camino.' : result.message,
    };
  }

  const arriveId = target.closest('[data-delivery-arrive]')?.dataset.deliveryArrive;
  if (arriveId) {
    const result = updateOrderStatus(arriveId, 'arriving');
    return {
      handled: true,
      ok: result.ok,
      message: result.ok ? 'Llegada al domicilio registrada.' : result.message,
    };
  }

  const doneId = target.closest('[data-delivery-done]')?.dataset.deliveryDone;
  if (doneId) {
    const result = updateOrderStatus(doneId, 'delivered');
    return {
      handled: true,
      ok: result.ok,
      message: result.ok ? 'Pedido marcado como entregado.' : result.message,
    };
  }

  return { handled: false };
}
