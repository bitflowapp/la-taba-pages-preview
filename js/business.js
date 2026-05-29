import { BUSINESS_CONFIG } from './config.js';
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
  const orders = state.orders;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const isToday = (order) => {
    const created = new Date(order.createdAt);
    return !Number.isNaN(created.getTime()) && created >= startOfToday;
  };
  const activeOrders = getActiveOrders(orders);
  const todayOrders = orders.filter((order) => order.status !== 'cancelled' && isToday(order));
  const todayTotal = todayOrders.reduce((sum, order) => sum + order.total, 0);
  const lowStock = getLowStockProducts(state.products);
  const pending = orders.filter((order) => order.status === 'received').length;
  const preparing = orders.filter((order) => order.status === 'preparing').length;
  const ready = orders.filter((order) => order.status === 'ready').length;
  const onTheWay = orders.filter((order) => order.status === 'on_the_way').length;
  const deliveredToday = todayOrders.filter((order) => order.status === 'delivered').length;

  container.innerHTML = `
    <div class="metrics-grid">
      <div class="metric-card accent"><strong>${money(todayTotal)}</strong><span>Ventas de hoy</span></div>
      <div class="metric-card"><strong>${todayOrders.length}</strong><span>Pedidos de hoy</span></div>
      <div class="metric-card"><strong>${pending + preparing + ready + onTheWay}</strong><span>Para atender</span></div>
      <div class="metric-card"><strong>${lowStock.length}</strong><span>Bajo stock</span></div>
    </div>

    <div class="status-board">
      <span class="board-chip received">Nuevos <strong>${pending}</strong></span>
      <span class="board-chip preparing">Preparando <strong>${preparing}</strong></span>
      <span class="board-chip ready">Listos <strong>${ready}</strong></span>
      <span class="board-chip way">En camino <strong>${onTheWay}</strong></span>
      <span class="board-chip done">Entregados hoy <strong>${deliveredToday}</strong></span>
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
  return orders.filter((order) => !['delivered', 'cancelled'].includes(order.status));
}

export function getLowStockProducts(products = getState().products) {
  return products.filter((product) => product.available && product.stock > 0 && product.stock <= 4);
}

function orderCard(order) {
  const items = order.items.map((item) => `
    <div class="order-line">
      <span>${item.icon} ${item.quantity} x ${escapeHtml(item.name)}</span>
      <strong>${money(item.quantity * item.unitPrice)}</strong>
    </div>
  `).join('');

  const canAdvance = !['delivered', 'cancelled'].includes(order.status);

  return `
    <article class="order-card accent-${statusClass(order.status)}">
      <div class="order-card-head">
        <div>
          <h3>${order.id} · ${escapeHtml(order.customerName)}</h3>
          <p>${escapeHtml(order.deliveryMode === 'pickup' ? 'Retiro en local' : 'Envío a domicilio')} · ${escapeHtml(order.address)}</p>
          <p>Teléfono: ${escapeHtml(order.customerPhone)}</p>
          <p>${dateTime(order.createdAt)} · ${escapeHtml(order.paymentMethod)}</p>
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
        <div class="cart-title"><span>${product.icon}</span>${escapeHtml(product.name)}</div>
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
    advanceOrderStatus(advanceId);
    return { handled: true, message: 'Estado del pedido actualizado.' };
  }

  const cancelId = target.closest('[data-order-cancel]')?.dataset.orderCancel;
  if (cancelId) {
    cancelOrder(cancelId);
    return { handled: true, message: 'Pedido cancelado.' };
  }

  const stockInc = target.closest('[data-stock-inc]')?.dataset.stockInc;
  if (stockInc) {
    changeProductStock(stockInc, 1);
    return { handled: true, message: 'Stock aumentado.' };
  }

  const stockDec = target.closest('[data-stock-dec]')?.dataset.stockDec;
  if (stockDec) {
    changeProductStock(stockDec, -1);
    return { handled: true, message: 'Stock reducido.' };
  }

  const toggleId = target.closest('[data-product-toggle]')?.dataset.productToggle;
  if (toggleId) {
    toggleProductAvailability(toggleId);
    return { handled: true, message: 'Disponibilidad actualizada.' };
  }

  return { handled: false };
}

function changeProductStock(productId, delta) {
  updateState((draft) => {
    const product = draft.products.find((candidate) => candidate.id === productId);
    if (!product) return;
    product.stock = Math.max(0, product.stock + delta);
  });
}

function toggleProductAvailability(productId) {
  updateState((draft) => {
    const product = draft.products.find((candidate) => candidate.id === productId);
    if (!product) return;
    product.available = !product.available;
  });
}
