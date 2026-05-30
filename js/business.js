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
import { escapeHtml, productCode, stockPill } from './ui.js';

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
  const newCustomers = uniqueCustomerCount(state.orders);
  const latestOrders = state.orders.slice(0, 5);

  const topProducts = metrics.topProducts.length
    ? metrics.topProducts.slice(0, 5).map((item) => `<li><span>${escapeHtml(item.name)}</span><strong>${item.quantity}</strong></li>`).join('')
    : '<li class="muted"><span>Sin ventas todavía hoy</span><strong>0</strong></li>';

  const lowStockList = lowStock.length
    ? lowStock.slice(0, 5).map((product) => `<li><span>${escapeHtml(product.name)}</span><strong>${product.stock}</strong></li>`).join('')
    : '<li class="muted"><span>Stock saludable</span><strong>OK</strong></li>';

  const latestOrdersList = latestOrders.length
    ? latestOrders.map((order) => `
      <li>
        <span>${escapeHtml(order.id)} · ${escapeHtml(order.customerName)}</span>
        <strong>${money(order.total)}</strong>
        <em class="${statusClass(order.status)}">${statusLabel(order.status)}</em>
      </li>`).join('')
    : '<li class="muted"><span>Sin pedidos cargados</span><strong>0</strong></li>';

  container.innerHTML = `
    <div class="business-dashboard-shell">
      <aside class="business-sidebar" aria-label="Secciones del negocio">
        <strong>La Taba</strong>
        <span class="sidebar-item active">Resumen</span>
        <span class="sidebar-item">Pedidos</span>
        <span class="sidebar-item">Productos</span>
        <span class="sidebar-item">Stock</span>
        <span class="sidebar-item">Clientes</span>
        <span class="sidebar-item">Reportes</span>
        <span class="sidebar-item">Configuración</span>
      </aside>

      <div class="business-main">
        <div class="metrics-grid">
          <div class="metric-card accent"><span>Ventas del día</span><strong>${money(metrics.todayTotal)}</strong><small>Pedidos entregados y activos</small></div>
          <div class="metric-card"><span>Pedidos</span><strong>${metrics.todayOrderCount}</strong><small>${metrics.ordersToHandle} para atender</small></div>
          <div class="metric-card"><span>Ticket promedio</span><strong>${money(metrics.avgTicket)}</strong><small>Sobre pedidos válidos</small></div>
          <div class="metric-card"><span>Clientes nuevos</span><strong>${newCustomers}</strong><small>Contactos del día</small></div>
        </div>

        <div class="dashboard-grid">
          <section class="dashboard-panel sales-panel">
            <div class="panel-head"><h3>Ventas</h3><span>Últimos 7 días</span></div>
            ${salesChart(state.orders)}
          </section>
          <section class="dashboard-panel">
            <div class="panel-head"><h3>Pedidos por estado</h3><span>${metrics.todayOrderCount} hoy</span></div>
            <div class="status-board">
              <span class="board-chip received">Nuevos <strong>${metrics.ordersByStatus.received}</strong></span>
              <span class="board-chip preparing">Preparando <strong>${metrics.ordersByStatus.preparing}</strong></span>
              <span class="board-chip ready">Listos <strong>${metrics.ordersByStatus.ready}</strong></span>
              <span class="board-chip way">En camino <strong>${metrics.ordersByStatus.on_the_way + metrics.ordersByStatus.arriving}</strong></span>
              <span class="board-chip done">Entregados <strong>${deliveredToday}</strong></span>
            </div>
          </section>
        </div>

        <div class="insight-grid">
          <section class="insight-card">
            <span class="insight-label">Productos más vendidos</span>
            <ul class="insight-list">${topProducts}</ul>
          </section>
          <section class="insight-card">
            <span class="insight-label">Stock bajo</span>
            <ul class="insight-list">${lowStockList}</ul>
          </section>
          <section class="insight-card">
            <span class="insight-label">Últimos pedidos</span>
            <ul class="insight-list latest-orders">${latestOrdersList}</ul>
          </section>
        </div>

        <div class="admin-grid">
          <section class="card">
            <h3>Pedidos para preparar</h3>
            ${activeOrders.length ? activeOrders.map(orderCard).join('') : '<div class="empty-state">No hay pedidos activos por ahora. Cuando entre uno nuevo, aparece acá con productos, total y datos del cliente.</div>'}
          </section>

          <section class="card stock-catalog-card">
            <h3>Stock del catálogo</h3>
            ${state.products.map(stockRow).join('')}
          </section>
        </div>
      </div>
    </div>
  `;
}

function uniqueCustomerCount(orders) {
  const today = new Date().toDateString();
  const customers = new Set(
    orders
      .filter((order) => new Date(order.createdAt).toDateString() === today && order.status !== 'cancelled')
      .map((order) => order.customerPhone || order.customerName)
      .filter(Boolean),
  );
  return customers.size;
}

function salesChart(orders) {
  const days = [];
  const now = new Date();
  for (let index = 6; index >= 0; index -= 1) {
    const date = new Date(now);
    date.setDate(now.getDate() - index);
    const key = date.toISOString().slice(0, 10);
    const label = new Intl.DateTimeFormat('es-AR', { weekday: 'short' }).format(date).slice(0, 3);
    const total = orders
      .filter((order) => order.status !== 'cancelled' && String(order.createdAt || '').slice(0, 10) === key)
      .reduce((sum, order) => sum + (Number(order.total) || 0), 0);
    days.push({ label, total });
  }
  const max = Math.max(1, ...days.map((day) => day.total));
  const bars = days.map((day) => {
    const height = Math.max(8, Math.round((day.total / max) * 92));
    const label = day.total > 0 ? money(day.total) : '';
    return `<span class="sales-bar" style="--h:${height}%"><i>${label}</i><b>${escapeHtml(day.label)}</b></span>`;
  }).join('');
  return `<div class="sales-chart">${bars}</div>`;
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
      <span>${item.quantity} x ${escapeHtml(item.name)}</span>
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
        <div class="cart-title"><span class="stock-thumb">${productCode(product)}</span><strong class="stock-name">${escapeHtml(product.name)}</strong></div>
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
