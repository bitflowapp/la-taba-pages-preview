import { BUSINESS_CONFIG } from './config.js';
import {
  getActiveOrders as selectActiveOrders,
  getBusinessMetrics,
  getLowStockProducts as selectLowStockProducts,
} from './core/business-metrics.js';
import { toDomainOrder } from './core/domain.js';
import { isTerminalOrderStatus } from './core/order-status.js';
import { getNextWorkflowStatus } from './core/order-workflow.js';
import {
  dateTime,
  deliveryModeLabel,
  getState,
  money,
  setState,
  statusClass,
  statusLabel,
  updateState,
} from './state.js';
import {
  actionLabelForOrder,
  advanceOrderStatus,
  buildKitchenTicket,
  cancelOrder,
} from './orders.js';
import { getOrderRepository, isPersistentOrderRepository } from './repositories/repository_factory.js';
import { escapeHtml, productCode, stockPill } from './ui.js';

let seenOrderIds = null; // se inicializa en el primer render para detectar pedidos nuevos
let soundEnabled = readSoundPref();
let audioCtx = null;

function readSoundPref() {
  try { return globalThis.localStorage?.getItem('la_taba_business_sound') !== 'off'; } catch (_) { return true; }
}
function writeSoundPref(value) {
  try { globalThis.localStorage?.setItem('la_taba_business_sound', value ? 'on' : 'off'); } catch (_) { /* ignore */ }
}

function playNewOrderChime() {
  if (!soundEnabled) return;
  try {
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx || new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    [880, 1175].forEach((freq, index) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = now + index * 0.16;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.06, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + 0.18);
    });
  } catch (_) { /* audio bloqueado: no romper */ }
}

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

  // Detección de pedidos nuevos (received) para el aviso visual + sonido.
  const receivedOrders = state.orders.filter((order) => order.status === 'received');
  const receivedIds = receivedOrders.map((order) => order.id);
  const isFirstRender = seenOrderIds === null;
  const freshOrders = isFirstRender ? [] : receivedIds.filter((id) => !seenOrderIds.has(id));
  seenOrderIds = new Set(receivedIds);
  if (freshOrders.length > 0) playNewOrderChime();

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
        <div class="business-topbar">
          <div class="business-topbar-text">
            <h2>Consola de pedidos</h2>
            <span>Operá los pedidos del día en tiempo real.</span>
          </div>
          <button class="ghost-button compact sound-toggle ${soundEnabled ? 'on' : ''}" type="button" data-sound-toggle aria-pressed="${soundEnabled}">
            ${soundEnabled ? '🔔 Sonido activado' : '🔕 Sonido apagado'}
          </button>
        </div>

        ${receivedOrders.length
          ? `<div class="new-order-banner ${freshOrders.length ? 'is-fresh' : ''}" role="status">
              <span class="new-order-dot" aria-hidden="true"></span>
              <span class="new-order-text"><strong>${receivedOrders.length} ${receivedOrders.length === 1 ? 'pedido nuevo' : 'pedidos nuevos'} sin aceptar</strong><small>Revisalos y aceptá para empezar a preparar.</small></span>
              <button class="primary-button compact" type="button" data-scroll-orders>Ver pedidos</button>
            </div>`
          : ''}

        <div class="metrics-grid">
          <div class="metric-card accent"><span>Ventas de hoy</span><strong>${money(metrics.todayTotal)}</strong><small>Pedidos válidos del día</small></div>
          <div class="metric-card"><span>Pedidos de hoy</span><strong>${metrics.todayOrderCount}</strong><small>${metrics.ordersToHandle} pendientes</small></div>
          <div class="metric-card"><span>Ticket promedio</span><strong>${money(metrics.avgTicket)}</strong><small>Por pedido</small></div>
          <div class="metric-card"><span>Delivery / Retiro</span><strong>${metrics.todayDeliveryCount} / ${metrics.todayPickupCount}</strong><small>${newCustomers} clientes</small></div>
        </div>

        ${renderOpsBoard(state)}

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

        <section class="card stock-catalog-card">
          <h3>Productos y stock</h3>
          ${state.products.map(stockRow).join('')}
        </section>

        ${renderDemoGuide()}
      </div>
    </div>
  `;
}

const OPS_COLUMNS = [
  { id: 'received', title: 'Nuevos', hint: 'Recién llegados', match: (order) => order.status === 'received' },
  { id: 'preparing', title: 'En preparación', hint: 'Aceptados, cocinándose', match: (order) => order.status === 'preparing' },
  { id: 'reparto', title: 'Listos / En reparto', hint: 'Para entregar o en camino', match: (order) => ['ready', 'on_the_way', 'arriving'].includes(order.status) },
  { id: 'finalizados', title: 'Finalizados', hint: 'Entregados o cancelados', match: (order) => ['delivered', 'cancelled'].includes(order.status) },
];

function renderOpsBoard(state) {
  const columns = OPS_COLUMNS.map((column) => {
    let orders = state.orders.filter(column.match);
    if (column.id === 'finalizados') orders = orders.slice(0, 8);
    const cards = orders.length
      ? orders.map(opsOrderCard).join('')
      : '<div class="ops-empty">Sin pedidos acá.</div>';
    return `
      <section class="ops-column ops-${column.id}" data-ops-column="${column.id}">
        <header class="ops-column-head">
          <strong>${column.title}</strong>
          <span class="ops-count">${orders.length}</span>
          <small>${column.hint}</small>
        </header>
        <div class="ops-column-body">${cards}</div>
      </section>`;
  }).join('');
  return `<div class="ops-board" data-ops-board>${columns}</div>`;
}

function timeAgo(value) {
  const created = new Date(value).getTime();
  if (Number.isNaN(created)) return '';
  const mins = Math.max(0, Math.round((Date.now() - created) / 60000));
  if (mins < 1) return 'recién';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  return `hace ${hours} h`;
}

function opsOrderCard(order) {
  const terminal = isTerminalOrderStatus(order.status);
  const isPickup = order.deliveryMode === 'pickup';
  const itemsCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const itemsSummary = order.items.slice(0, 3).map((item) => `${item.quantity}× ${escapeHtml(item.name)}`).join(', ')
    + (order.items.length > 3 ? '…' : '');
  const phone = onlyDigits(order.customerPhone);
  const showRiderLink = order.deliveryMode === 'delivery' && ['ready', 'on_the_way', 'arriving'].includes(order.status);

  const primaryAction = terminal
    ? ''
    : `<button class="primary-button compact" type="button" data-order-advance="${order.id}">${escapeHtml(actionLabelForOrder(order))}</button>`;

  const cancelAction = terminal
    ? ''
    : `<button class="ghost-button compact danger-ghost" type="button" data-order-cancel="${order.id}">Cancelar</button>`;

  const trackLink = showRiderLink
    ? `<button class="ghost-button compact" type="button" data-order-track="${order.id}">Ver tracking</button>`
    : '';

  const waLink = phone
    ? `<a class="ghost-button compact" href="https://wa.me/${phone}" target="_blank" rel="noopener noreferrer">WhatsApp</a>`
    : '';

  const reason = order.status === 'cancelled' && order.cancelReason
    ? `<p class="ops-cancel-reason">Motivo: ${escapeHtml(order.cancelReason)}</p>`
    : '';

  return `
    <article class="ops-card accent-${statusClass(order.status)}">
      <div class="ops-card-top">
        <strong>${escapeHtml(order.id)}</strong>
        <span class="ops-type ${isPickup ? 'pickup' : 'delivery'}">${isPickup ? 'Retiro' : 'Delivery'}</span>
        <span class="ops-time">${escapeHtml(timeAgo(order.createdAt))}</span>
      </div>
      <div class="ops-card-customer">
        <strong>${escapeHtml(order.customerName)}</strong>
        <small>${escapeHtml(isPickup ? 'Retira en el local' : order.address)}</small>
      </div>
      <div class="ops-card-meta">
        <span>${itemsCount} ${itemsCount === 1 ? 'ítem' : 'ítems'}</span>
        <span>${escapeHtml(order.paymentMethod)}</span>
        <strong>${money(order.total)}</strong>
      </div>
      <p class="ops-items">${itemsSummary}</p>
      ${reason}
      <div class="ops-actions">
        ${primaryAction}
        ${trackLink}
        <button class="ghost-button compact" type="button" data-order-ticket="${order.id}">Copiar ticket</button>
        <button class="ghost-button compact" type="button" data-order-print="${order.id}">Imprimir</button>
        ${waLink}
        ${cancelAction}
      </div>
    </article>`;
}

function onlyDigits(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.startsWith('54') ? digits : `549${digits}`;
}

function renderDemoGuide() {
  return `
    <details class="demo-guide">
      <summary>Guía rápida para mostrar la demo</summary>
      <ol class="demo-guide-steps">
        <li>Creá un pedido desde la vista <strong>Cliente</strong>.</li>
        <li>Acá, en <strong>Negocio</strong>, aparece el pedido nuevo (con aviso).</li>
        <li>Tocá <strong>Aceptar pedido</strong> y luego <strong>Marcar listo</strong>.</li>
        <li>El <strong>rider</strong> toma el pedido y sale a repartir.</li>
        <li>El cliente sigue el reparto en <strong>Tracking</strong>.</li>
        <li>Marcás <strong>Entregado</strong> y las métricas se actualizan.</li>
      </ol>
      <p class="form-hint">Tip: usá “Copiar ticket” para pasarle el pedido a la cocina.</p>
    </details>`;
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
    return actionResponse(advanceOrder(advanceId), 'Estado del pedido actualizado.');
  }

  const ticketId = target.closest('[data-order-ticket]')?.dataset.orderTicket;
  if (ticketId) {
    const order = getState().orders.find((candidate) => candidate.id === ticketId);
    if (!order) return { handled: true, ok: false, message: 'Pedido no encontrado.' };
    copyTicketText(buildKitchenTicket(order));
    return { handled: true, ok: true, message: 'Ticket copiado para la cocina.' };
  }

  const printId = target.closest('[data-order-print]')?.dataset.orderPrint;
  if (printId) {
    const order = getState().orders.find((candidate) => candidate.id === printId);
    if (!order) return { handled: true, ok: false, message: 'Pedido no encontrado.' };
    printTicket(order);
    return { handled: true, ok: true, message: 'Preparando impresión del ticket.' };
  }

  const trackId = target.closest('[data-order-track]')?.dataset.orderTrack;
  if (trackId) {
    setState({ lastOrderId: trackId });
    return { handled: true, ok: true, message: '', navigate: 'tracking' };
  }

  if (target.closest('[data-sound-toggle]')) {
    soundEnabled = !soundEnabled;
    writeSoundPref(soundEnabled);
    if (soundEnabled) playNewOrderChime();
    if (typeof document !== 'undefined') renderBusinessDashboard();
    return { handled: true, ok: true, message: soundEnabled ? 'Sonido de pedidos activado.' : 'Sonido de pedidos apagado.' };
  }

  if (target.closest('[data-scroll-orders]')) {
    if (typeof document !== 'undefined') {
      document.querySelector('[data-ops-board]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    return { handled: true, ok: true, message: '' };
  }

  const cancelId = target.closest('[data-order-cancel]')?.dataset.orderCancel;
  if (cancelId) {
    return actionResponse(cancelBusinessOrder(cancelId), 'Pedido cancelado.');
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

function advanceOrder(orderId) {
  const repository = getOrderRepository();
  if (!isPersistentOrderRepository(repository)) return advanceOrderStatus(orderId);
  const order = getState().orders.find((candidate) => candidate.id === orderId);
  const domainOrder = toDomainOrder(order);
  const nextStatus = domainOrder ? getNextWorkflowStatus(domainOrder.status, domainOrder.fulfillmentType) : null;
  if (!nextStatus) return { ok: false, message: 'Sin próxima acción para este pedido.' };
  return repository.updateOrderStatus(orderId, nextStatus);
}

function cancelBusinessOrder(orderId) {
  const repository = getOrderRepository();
  if (!isPersistentOrderRepository(repository)) return cancelOrder(orderId);
  return repository.updateOrderStatus(orderId, 'canceled');
}

function actionResponse(result, successMessage) {
  if (typeof result?.then === 'function') {
    return result.then((resolved) => actionResponse(resolved, successMessage));
  }
  return {
    handled: true,
    ok: result.ok,
    message: result.ok ? successMessage : result.message,
  };
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

function copyTicketText(text) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
    }
  } catch (_) { /* clipboard no disponible: no romper */ }
}

function printTicket(order) {
  if (typeof document !== 'undefined') {
    const slot = document.querySelector('[data-print-ticket]');
    if (slot) slot.textContent = buildKitchenTicket(order);
  }
  try {
    if (typeof window !== 'undefined' && typeof window.print === 'function') window.print();
  } catch (_) { /* impresión no disponible: no romper */ }
}
