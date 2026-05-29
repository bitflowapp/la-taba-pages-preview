import { getActiveDeliveryOrder, updateOrderStatus } from './orders.js';
import { deliveryModeLabel, money, statusClass, statusLabel } from './state.js';
import { escapeHtml } from './ui.js';

export function renderDeliveryPanel() {
  const container = document.querySelector('[data-delivery-panel]');
  if (!container) return;
  const order = getActiveDeliveryOrder();

  if (!order) {
    container.innerHTML = '<div class="empty-state">No hay pedidos asignados al repartidor.</div>';
    return;
  }

  const canLeave = order.status === 'ready';
  const canDeliver = order.status === 'on_the_way';

  container.innerHTML = `
    <div class="delivery-layout">
      <div class="card">
        <div class="order-card-head">
          <div>
            <h3>${order.id} · ${escapeHtml(order.customerName)}</h3>
            <p>${deliveryModeLabel(order.deliveryMode)} · ${escapeHtml(order.address)}</p>
            <p>Teléfono: ${escapeHtml(order.customerPhone)}</p>
          </div>
          <span class="status-chip ${statusClass(order.status)}">${statusLabel(order.status)}</span>
        </div>

        ${order.items.map((item) => `
          <div class="order-line">
            <span>${item.icon} ${item.quantity} x ${escapeHtml(item.name)}</span>
            <strong>${money(item.quantity * item.unitPrice)}</strong>
          </div>
        `).join('')}

        <div class="summary-box" style="margin-top:14px">
          <div class="summary-row"><span>Repartidor</span><strong>${escapeHtml(order.delivery.driverName)}</strong></div>
          <div class="summary-row"><span>Ubicación</span><strong>${escapeHtml(order.delivery.currentLocationLabel)}</strong></div>
          <div class="summary-row total"><span>Total a entregar</span><strong>${money(order.total)}</strong></div>
        </div>

        <div class="button-row" style="margin-top:14px">
          <button class="primary-button" type="button" data-delivery-leave="${order.id}" ${canLeave ? '' : 'disabled'}>Salí del local</button>
          <button class="secondary-button" type="button" data-delivery-done="${order.id}" ${canDeliver ? '' : 'disabled'}>Pedido entregado</button>
        </div>
      </div>

      <div class="delivery-map">
        <div>
          <div class="map-pin">📍</div>
          <h3>Mapa mock preparado</h3>
          <p>Acá después se conecta Google Maps o Mapbox con GPS real. Por ahora mantiene flujo de reparto sin backend.</p>
        </div>
      </div>
    </div>
  `;
}

export function handleDeliveryAction(target) {
  const leaveId = target.closest('[data-delivery-leave]')?.dataset.deliveryLeave;
  if (leaveId) {
    updateOrderStatus(leaveId, 'on_the_way');
    return { handled: true, message: 'Pedido marcado como en camino.' };
  }

  const doneId = target.closest('[data-delivery-done]')?.dataset.deliveryDone;
  if (doneId) {
    updateOrderStatus(doneId, 'delivered');
    return { handled: true, message: 'Pedido marcado como entregado.' };
  }

  return { handled: false };
}
