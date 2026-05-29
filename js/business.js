import { BUSINESS_CONFIG } from './config.js';
import {
  getActiveOrders as selectActiveOrders,
  getBusinessMetrics,
  getLowStockProducts as selectLowStockProducts,
} from './core/business-metrics.js';
import { isTerminalOrderStatus } from './core/order-status.js';
import {
  dateTime,
  getState,
  money,
  setState,
  statusClass,
  statusLabel,
  updateState,
} from './state.js';
import { actionLabelForOrder, advanceOrderStatus, cancelOrder } from './orders.js';
import { escapeHtml, stockPill } from './ui.js';

export function unlockAdmin(pin) {
  if (pin !== BUSINESS_CONFIG.adminPin) return false;
  setState({ adminUnlocked: true });
  return true;
}

export function lockAdmin() {
  setState({ adminUnlocked: false });
}

export function renderBusinessDashboard() {
  const container = document.querySelector('[data-business-dashboard]');
  if (!container) return;

  const state = getState();
  const metrics = getBusinessMetrics(state.orders, state.products);
  const activeOrders = metrics.activeOrders;
  const lowStock = metrics.lowStock;
  const deliveredToday = metrics.ordersByStatus.delivered;

  container.innerHTML = `
    <div class="metrics-grid">
      <div class="metric-card accent"><strong>${money(metrics.todayTotal)}</strong><span>Ventas de hoy</span></div>
      <div class="metric-card"><strong>${metrics.todayOrderCount}</strong><span>Pedidos de hoy</span></div>
      <div class="metric-card"><strong>${metrics.ordersToHandle}</strong><span>Para atender</span></div>
      <div class="metric-card"><strong>${lowStock.length}</strong><span>Bajo stock</span></div>
    </div>

    <div class="status-board">
      <span class="board-chip received">Nuevos <strong>${metrics.ordersByStatus.received}</strong></span>
      <span class="board-chip preparing">Preparando <strong>${metrics.ordersByStatus.preparing}</strong></span>
      <span class="board-chip ready">Listos <strong>${metrics.ordersByStatus.ready}</strong></span>
      <span class="board-chip way">En camino <strong>${metrics.ordersByStatus.on_the_way + metrics.ordersByStatus.arriving}</strong></span>
      <span class="board-chip done">Entregados <strong>${deliveredToday}</strong></span>
    </div>

    <div class="admin-grid">
      <div class="card">
        <h3>Pedidos para preparar</h3>
        ${activeOrders.length ? activeOrders.map(orderCard).join('') : '<div class="empty-state">No hay pedidos activos por ahora. Cuando entre uno nuevo, aparece acá con productos, total y datos del cliente.</div>'}
      </div>

      <div class="card">
        <h3>Stock del catálogo</h3>
        ${state.products.map(stockRow).join('')}
      </div>
    </div>
  `;
}

export function getActiveOrders(orders = getState().orders) {
  return selectActiveOrders(orders);
}

export function getLowStockProducts(products = getState().products) {
  return selectLowStockProducts(products);
}

function orderCard(order) {
  const items = order.items.map((item) => `
    <div class="order-line">
      <span>${item.icon} ${item.quantity} x ${escapeHtml(item.name)}</span>
      <strong>${money(item.quantity * item.unitPrice)}</strong>
    </div>
  `).join('');

  const canAdvance = !isTerminalOrderStatus(order.status);

  return `
    <article class="order-card accent-${statusClass(order.status)}">
      <div class="order-card-head">
        <div>
          <h3>${order.id} · ${escapeHtml(order.customerName)}</h3>
          <div class="order-meta-pills">
            <span>${escapeHtml(order.deliveryMode === 'pickup' ? 'Retiro en local' : 'Envío a domicilio')}</span>
            <span>${money(order.total)}</span>
            <span>${escapeHtml(order.paymentMethod)}</span>
          </div>
          <p>${escapeHtml(order.address)}</p>
          <p>Teléfono: ${escapeHtml(order.customerPhone)} · ${dateTime(order.createdAt)}</p>
        </div>
        <span class="status-chip ${statusClass(order.status)}">${statusLabel(order.status)}</span>
      </div>
      ${items}
      <div class="summary-row total"><span>Total</span><strong>${money(order.total)}</strong></div>
      <p><strong>Notas:</strong> ${escapeHtml(order.notes)}</p>
      <div class="order-actions">
        <button class="primary-button compact" type="button" data-order-advance="${order.id}" ${canAdvance ? '' : 'disabled'}>${actionLabelForOrder(order)}</button>
        <button class="danger-button compact" type="button" data-order-cancel="${order.id}" ${canAdvance ? '' : 'disabled'}>Cancelar</button>
      </div>
    </article>
  `;
}

function stockRow(product) {
  return `
    <div class="stock-row">
      <div>
        <div class="cart-title"><span class="stock-thumb">${product.icon}</span>${escapeHtml(product.name)}</div>
        <div class="cart-meta">${money(product.price)} · ${stockPill(product)}</div>
      </div>
      <div class="stock-actions">
        <button class="icon-button compact" type="button" data-stock-dec="${product.id}" aria-label="Restar stock de ${escapeHtml(product.name)}">−</button>
        <strong>${product.stock}</strong>
        <button class="icon-button compact" type="button" data-stock-inc="${product.id}" aria-label="Sumar stock de ${escapeHtml(product.name)}">+</button>
        <button class="ghost-button compact" type="button" data-product-toggle="${product.id}">${product.available ? 'Pausar' : 'Activar'}</button>
      </div>
    </div>
  `;
}

export function handleBusinessAction(target) {
  const advanceId = target.closest('[data-order-advance]')?.dataset.orderAdvance;
  if (advanceId) {
    const result = advanceOrderStatus(advanceId);
    return {
      handled: true,
      ok: result.ok,
      message: result.ok ? 'Estado del pedido actualizado.' : result.message,
    };
  }

  const cancelId = target.closest('[data-order-cancel]')?.dataset.orderCancel;
  if (cancelId) {
    const result = cancelOrder(cancelId);
    return {
      handled: true,
      ok: result.ok,
      message: result.ok ? 'Pedido cancelado.' : result.message,
    };
  }

  const stockInc = target.closest('[data-stock-inc]')?.dataset.stockInc;
  if (stockInc) {
    const ok = changeProductStock(stockInc, 1);
    return { handled: true, ok, message: ok ? 'Stock aumentado.' : 'Producto no encontrado.' };
  }

  const stockDec = target.closest('[data-stock-dec]')?.dataset.stockDec;
  if (stockDec) {
    const ok = changeProductStock(stockDec, -1);
    return { handled: true, ok, message: ok ? 'Stock reducido.' : 'Producto no encontrado.' };
  }

  const toggleId = target.closest('[data-product-toggle]')?.dataset.productToggle;
  if (toggleId) {
    const ok = toggleProductAvailability(toggleId);
    return { handled: true, ok, message: ok ? 'Disponibilidad actualizada.' : 'Producto no encontrado.' };
  }

  return { handled: false };
}

function changeProductStock(productId, delta) {
  if (!getState().products.some((product) => product.id === productId)) return false;
  let changed = false;
  updateState((draft) => {
    const product = draft.products.find((candidate) => candidate.id === productId);
    if (!product) return;
    product.stock = Math.max(0, product.stock + delta);
    changed = true;
  });
  return changed;
}

function toggleProductAvailability(productId) {
  if (!getState().products.some((product) => product.id === productId)) return false;
  let changed = false;
  updateState((draft) => {
    const product = draft.products.find((candidate) => candidate.id === productId);
    if (!product) return;
    product.available = !product.available;
    changed = true;
  });
  return changed;
}
