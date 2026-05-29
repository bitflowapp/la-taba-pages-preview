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

const riderSteps = [
  { key: 'ready', label: 'Listo' },
  { key: 'on_the_way', label: 'En camino' },
  { key: 'arriving', label: 'Llegando' },
  { key: 'delivered', label: 'Entregado' },
];

export function renderDeliveryPanel() {
  const container = document.querySelector('[data-delivery-panel]');
  if (!container) return;
  const order = getActiveDeliveryOrder();

  if (!order) {
    container.innerHTML = '<div class="empty-state">No hay pedidos asignados al repartidor. Los pedidos de retiro en local no aparecen en esta vista.</div>';
    return;
  }

  const { canLeave, canArrive, canDeliver } = getRiderActionState(order);
  const eta = formatDemoEta(order);
  const distance = formatDemoDistance(order);
  const instructions = order.notes && order.notes !== 'Sin notas' ? order.notes : 'Sin indicaciones especiales del cliente.';
  const headline = order.status === 'arriving'
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
    <div class="delivery-layout">
      <div class="rider-col">
        <div class="card rider-head ${statusClass(order.status)}">
          <span class="track-head-ico">REP</span>
          <div class="track-head-text">
            <small>${order.id} · ${escapeHtml(deliveryModeLabel(order.deliveryMode))}</small>
            <strong>${headline}</strong>
            <span>${distance} · ${eta} estimado</span>
          </div>
          <span class="status-chip ${statusClass(order.status)}">${statusLabel(order.status)}</span>
        </div>

        <div class="card rider-card">
          <div class="track-steps tight">${steps}</div>

          <div class="rider-chips">
            <span class="rider-chip"><small>Distancia</small><strong>${distance}</strong></span>
            <span class="rider-chip"><small>Tiempo estimado</small><strong>${eta}</strong></span>
            <span class="rider-chip"><small>A cobrar</small><strong>${money(order.total)}</strong></span>
          </div>

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
            <p>${escapeHtml(order.address)}</p>
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

          <div class="button-row rider-actions">
            <button class="primary-button" type="button" data-delivery-leave="${order.id}" ${canLeave ? '' : 'disabled'}>Salí del local</button>
            <button class="secondary-button" type="button" data-delivery-arrive="${order.id}" ${canArrive ? '' : 'disabled'}>Llegué al domicilio</button>
            <button class="secondary-button" type="button" data-delivery-done="${order.id}" ${canDeliver ? '' : 'disabled'}>Pedido entregado</button>
          </div>
        </div>
      </div>

      <div class="delivery-map">
        ${renderDemoMap(order, distance, eta)}
      </div>
    </div>
  `;
}

function riderStepIndex(status) {
  if (status === 'delivered') return 3;
  if (status === 'arriving') return 2;
  if (status === 'on_the_way') return 1;
  return 0;
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

function renderDemoMap(order, distance, eta) {
  const progress = getRouteProgress(order);
  const path = 'M 44 176 C 96 150, 96 96, 150 92 S 240 70, 276 44';
  const stateLabel = getRiderStateLabel(order);

  return `
    <div class="demo-map" role="img" aria-label="Mapa de demostración del reparto">
      <div class="demo-map-overlay">
        <span class="map-eta">${eta} · ${distance}</span>
        <span class="map-state">${stateLabel}</span>
      </div>
      <svg class="demo-map-svg" viewBox="0 0 320 220" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id="riderRoute" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#e0a066"/>
            <stop offset="1" stop-color="#b84f40"/>
          </linearGradient>
        </defs>
        <g class="map-streets" stroke="rgba(255,255,255,0.06)" stroke-width="2">
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
