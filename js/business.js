import { BUSINESS_CONFIG } from './config.js';
import { formatAddressReference, normalizeOrderAddressDetails } from './core/address.js';
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
import { chooseRiderLocation, hasLiveRiderLocation } from './map/route_geometry.js';

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
  const lowStock = metrics.lowStock;
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
  const freshOrderIds = new Set(freshOrders);

  container.innerHTML = `
    <div class="business-main business-inbox-main">
      <header class="business-inbox-hero">
        <button class="ghost-button compact sound-toggle ${soundEnabled ? 'on' : ''}" type="button" data-sound-toggle aria-pressed="${soundEnabled}">
          <span>Alertas</span>
          ${receivedOrders.length ? `<strong>${receivedOrders.length}</strong>` : ''}
        </button>
        <div class="business-topbar-text">
          <h2>Central de pedidos</h2>
          <span>Los pedidos confirmados aparecen acá. Aceptás, preparás y mandás a reparto sin perder el foco.</span>
        </div>
      </header>

      ${renderOrderInbox(state, metrics, freshOrderIds)}

      ${renderDeliveredTodaySummary(state.orders)}

      <section class="business-day-strip" aria-label="Resumen operativo del día">
        <div class="day-metric accent"><span>Ventas de hoy</span><strong>${money(metrics.todayTotal)}</strong></div>
        <div class="day-metric"><span>Pedidos activos</span><strong>${metrics.ordersToHandle}</strong></div>
        <div class="day-metric"><span>Ticket promedio</span><strong>${money(metrics.avgTicket)}</strong></div>
        <div class="day-metric"><span>Delivery / Retiro</span><strong>${metrics.todayDeliveryCount} / ${metrics.todayPickupCount}</strong><small>${newCustomers} clientes</small></div>
      </section>

      <section class="card stock-catalog-card business-stock-card">
        <h3>Productos y stock</h3>
        ${state.products.map(stockRow).join('')}
      </section>

      <details class="business-extra">
        <summary>Más métricas del día</summary>
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
              <span class="board-chip done">Entregados <strong>${metrics.ordersByStatus.delivered}</strong></span>
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
      </details>

      ${renderDemoGuide()}
    </div>
  `;
}

const INBOX_GROUPS = [
  { id: 'nuevos', title: 'Pedidos nuevos', hint: 'Atención inmediata', match: (order) => order.status === 'received' },
  { id: 'preparando', title: 'Preparando', hint: 'En cocina', match: (order) => order.status === 'preparing' },
  { id: 'reparto', title: 'Reparto', hint: 'Listos o en calle', match: (order) => ['ready', 'on_the_way', 'arriving'].includes(order.status) },
];

// Central de pedidos: lista vertical mobile-first con los pedidos REALES de la
// demo, agrupados por fase. No hay tarjetas decorativas: cada card es un pedido
// confirmado por un cliente. Las acciones publican el cambio de estado por
// realtime para que cliente y rider vean lo mismo.
function renderOrderInbox(state, metrics, freshOrderIds = new Set()) {
  const orders = Array.isArray(state.orders) ? state.orders : [];
  const active = orders.filter((order) => !isTerminalOrderStatus(order.status));
  const closed = orders.filter((order) => ['delivered', 'cancelled'].includes(order.status)).slice(0, 6);
  const received = active.filter((order) => order.status === 'received');
  const priorityOrder = received[0] || null;
  const sections = [];

  if (priorityOrder) {
    sections.push(`
      <section class="inbox-priority" data-inbox-group="nuevos">
        <header class="inbox-section-head">
          <span>Pedidos nuevos</span>
          <strong>Pedido nuevo</strong>
          <small>Revisá datos, total y notas antes de aceptar.</small>
        </header>
        ${inboxOrderCard(priorityOrder, { priority: true, fresh: freshOrderIds.has(priorityOrder.id) })}
      </section>`);
  }

  for (const group of INBOX_GROUPS) {
    const list = active
      .filter(group.match)
      .filter((order) => order.id !== priorityOrder?.id);
    if (!list.length) continue;
    sections.push(`
      <section class="inbox-group" data-inbox-group="${group.id}">
        <header class="inbox-group-head">
          <strong>${group.title}</strong>
          <span class="inbox-count">${list.length}</span>
          <small>${group.hint}</small>
        </header>
        <div class="inbox-group-body">
          ${list.map((order) => inboxOrderCard(order, { fresh: freshOrderIds.has(order.id) })).join('')}
        </div>
      </section>`);
  }

  const body = active.length
    ? `<div class="inbox-feed">${sections.join('')}</div>`
    : `
      <div class="inbox-empty" data-inbox-empty>
        <strong>Todavía no entraron pedidos.</strong>
        <p>Cuando un cliente confirme una compra, va a aparecer acá para aceptarla y prepararla.</p>
      </div>`;

  const closedBlock = closed.length
    ? `
      <details class="inbox-closed">
        <summary>Entregados / cerrados de hoy (${closed.length})</summary>
        <div class="inbox-closed-list">${closed.map(inboxClosedRow).join('')}</div>
      </details>`
    : '';

  return `<div class="order-inbox" data-order-inbox data-ops-board>${renderInboxTabs(metrics)}${body}${closedBlock}</div>`;
}

function renderInboxTabs(metrics) {
  const counts = metrics.ordersByStatus;
  const reparto = counts.ready + counts.on_the_way + counts.arriving;
  const tabs = [
    { label: 'Nuevos', count: counts.received, tone: 'received' },
    { label: 'Preparando', count: counts.preparing, tone: 'preparing' },
    { label: 'Reparto', count: reparto, tone: 'way' },
    { label: 'Entregados', count: counts.delivered, tone: 'done' },
  ];
  return `
    <div class="inbox-tabs" aria-label="Estados de pedidos">
      ${tabs.map((tab) => `
        <span class="inbox-tab ${tab.tone} ${tab.count > 0 ? 'has-count' : ''}">
          <span>${tab.label}</span>
          <strong>${tab.count}</strong>
        </span>`).join('')}
    </div>`;
}

function renderDeliveredTodaySummary(orders) {
  const today = new Date().toDateString();
  const delivered = orders.filter((order) => {
    const created = new Date(order.createdAt);
    return order.status === 'delivered'
      && !Number.isNaN(created.getTime())
      && created.toDateString() === today;
  });
  const total = delivered.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
  return `
    <section class="delivered-today-card" aria-label="Entregados de hoy">
      <span class="delivered-icon" aria-hidden="true">✓</span>
      <div>
        <strong>Entregados de hoy</strong>
        <p>${delivered.length} ${delivered.length === 1 ? 'pedido' : 'pedidos'} · ${money(total)}</p>
      </div>
      <span class="delivered-chevron" aria-hidden="true">›</span>
    </section>`;
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

function inboxOrderCard(order, options = {}) {
  const isPickup = order.deliveryMode === 'pickup';
  const address = normalizeOrderAddressDetails(order);
  const reference = formatAddressReference(order);
  const phone = onlyDigits(order.customerPhone);
  const nextLabel = actionLabelForOrder(order);
  const itemsList = order.items.map((item) => `
        <li><span>${item.quantity}× ${escapeHtml(item.name)}</span><strong>${money(item.quantity * item.unitPrice)}</strong></li>`).join('');
  const showTrack = order.deliveryMode === 'delivery' && ['ready', 'on_the_way', 'arriving'].includes(order.status);
  const priorityClass = options.priority ? 'is-priority' : 'is-secondary';
  const freshClass = options.fresh ? 'is-fresh' : '';

  return `
    <article class="inbox-order ${priorityClass} ${freshClass} accent-${statusClass(order.status)}" data-inbox-order="${escapeHtml(order.id)}">
      <div class="inbox-order-top">
        <span class="inbox-state-dot" aria-hidden="true"></span>
        <span class="status-chip ${statusClass(order.status)}">${options.priority ? 'Pedido nuevo' : statusLabel(order.status)}</span>
        <span class="inbox-status-label">${statusLabel(order.status)}</span>
        <span class="inbox-time">${escapeHtml(timeAgo(order.createdAt))}</span>
      </div>

      <div class="inbox-card-layout">
        <div class="inbox-card-main">
          <strong class="inbox-id">${escapeHtml(order.id)}</strong>
          <div class="inbox-order-customer">
            <strong>${escapeHtml(order.customerName)}</strong>
            <span class="inbox-type ${isPickup ? 'pickup' : 'delivery'}">${isPickup ? 'Retiro en local' : 'Delivery'}</span>
          </div>
          ${renderInboxTrackingPanel(order)}
        </div>

        <div class="inbox-commerce-panel">
          <aside class="inbox-payment-panel">
            <span>Total a cobrar</span>
            <strong>${money(order.total)}</strong>
          </aside>
          <div class="inbox-actions">
            ${nextLabel !== 'Sin acción' ? `<button class="primary-button compact" type="button" data-order-advance="${order.id}">${escapeHtml(nextLabel)}</button>` : ''}
            ${phone ? `<a class="ghost-button compact" href="https://wa.me/${phone}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : ''}
            ${order.customerPhone ? `<a class="ghost-button compact" href="tel:${encodeURIComponent(order.customerPhone)}">Llamar</a>` : ''}
            ${showTrack ? `<button class="ghost-button compact" type="button" data-order-track="${order.id}">Ver tracking</button>` : ''}
            <button class="ghost-button compact" type="button" data-order-ticket="${order.id}">Copiar ticket</button>
            <button class="ghost-button compact danger-ghost" type="button" data-order-cancel="${order.id}">Rechazar</button>
          </div>
        </div>

        <div class="inbox-card-details">
          <div class="inbox-detail-list">
            <p><span>Teléfono</span><strong>${escapeHtml(order.customerPhone)}</strong></p>
            <p><span>${isPickup ? 'Retiro' : 'Dirección'}</span><strong>${isPickup ? 'Retira en el local' : escapeHtml(address.label || order.address)}</strong></p>
            ${!isPickup && reference ? `<p><span>Referencia</span><strong>${escapeHtml(reference)}</strong></p>` : ''}
            <p><span>Pago</span><strong>${escapeHtml(order.paymentMethod)}</strong></p>
          </div>
          <div class="inbox-products-block">
            <span>Productos</span>
            <ul class="inbox-items">${itemsList}</ul>
          </div>
          ${order.notes && order.notes !== 'Sin notas' ? `<p class="inbox-notes">Nota del cliente: ${escapeHtml(order.notes)}</p>` : ''}
        </div>
      </div>
    </article>`;
}

function renderInboxTrackingPanel(order) {
  if (order.deliveryMode !== 'delivery' || !['ready', 'on_the_way', 'arriving'].includes(order.status)) return '';

  const address = normalizeOrderAddressDetails(order);
  const riderLocation = chooseRiderLocation(orderSimulation(order), order.tracking?.lastLocation);
  const liveGps = hasLiveRiderLocation(riderLocation);
  const title = ['on_the_way', 'arriving'].includes(order.status) ? 'Pedido en reparto' : 'Pedido listo para reparto';
  const riderName = order.delivery?.driverName && order.delivery.driverName !== 'Sin asignar'
    ? order.delivery.driverName
    : '';
  const gpsText = liveGps ? 'GPS en vivo' : 'Sin ubicación en vivo';
  const liveAge = liveGps ? (timeAgo(riderLocation.lastFixAt || riderLocation.timestamp) || 'recién') : '';
  const gpsDetail = liveGps
    ? `Última actualización ${liveAge}`
    : 'El negocio sigue el pedido por estado y dirección.';
  const actionLabel = 'Seguir reparto';

  return `
    <section class="inbox-tracking-panel ${liveGps ? 'is-live' : 'is-offline'}" data-business-tracking="${escapeHtml(order.id)}">
      <div class="inbox-tracking-head">
        <div>
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(gpsText)}</span>
        </div>
        <em>${escapeHtml(gpsDetail)}</em>
      </div>
      <div class="inbox-tracking-grid">
        <span><small>Pedido</small><strong>${escapeHtml(order.id)}</strong></span>
        <span><small>Cliente</small><strong>${escapeHtml(order.customerName)}</strong></span>
        <span><small>Dirección</small><strong>${escapeHtml(address.label || order.address)}</strong></span>
        ${riderName ? `<span><small>Rider</small><strong>${escapeHtml(riderName)}</strong></span>` : ''}
      </div>
      ${liveGps ? renderBusinessTrackingMap(order) : ''}
      <button class="ghost-button compact inbox-tracking-action" type="button" data-order-track="${escapeHtml(order.id)}">${escapeHtml(actionLabel)}</button>
    </section>`;
}

function orderSimulation(order) {
  const sim = getState().simulation;
  return sim && sim.orderId === order.id ? sim : null;
}

function renderBusinessTrackingMap(order) {
  return `
    <div class="business-tracking-map">
      <div class="real-map-shell business-map-shell" data-real-map data-map-role="business-tracking" data-order-id="${escapeHtml(order.id)}">
        <div class="real-map-canvas" data-map-canvas aria-label="Mapa del rider en vivo"></div>
        <div class="real-map-fallback" data-map-fallback>
          <p class="map-fallback-note">Mapa no disponible en este dispositivo.</p>
        </div>
        <div class="real-map-meta" data-map-meta>Ubicación del repartidor en vivo</div>
      </div>
    </div>`;
}

function inboxClosedRow(order) {
  return `
    <div class="inbox-closed-row">
      <span>${escapeHtml(order.id)} · ${escapeHtml(order.customerName)}</span>
      <strong>${money(order.total)}</strong>
      <em class="status-chip ${statusClass(order.status)}">${statusLabel(order.status)}</em>
    </div>`;
}

function onlyDigits(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.startsWith('54') ? digits : `549${digits}`;
}

function renderDemoGuide() {
  return `
    <details class="demo-guide">
      <summary>Flujo operativo sugerido</summary>
      <ol class="demo-guide-steps">
        <li>El pedido entra como <strong>Nuevo</strong> y queda pendiente de aceptación.</li>
        <li>El equipo lo acepta, prepara y marca <strong>Listo</strong> cuando sale del local.</li>
        <li>El <strong>rider</strong> registra salida, llegada y entrega.</li>
        <li>El cliente sigue el estado desde <strong>Seguimiento</strong>.</li>
        <li>Al marcar <strong>Entregado</strong>, las métricas se actualizan.</li>
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
  const address = normalizeOrderAddressDetails(order);
  const reference = formatAddressReference(order);

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
          <p>${escapeHtml(order.deliveryMode === 'pickup' ? order.address : address.label || order.address)}</p>
          ${order.deliveryMode !== 'pickup' && reference ? `<p>Referencia: ${escapeHtml(reference)}</p>` : ''}
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
