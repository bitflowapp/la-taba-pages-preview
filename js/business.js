import { getBusinessConfig } from './core/business-config-store.js';
import { formatAddressReference, normalizeOrderAddressDetails } from './core/address.js';
import {
  CATALOG_BADGE_OPTIONS,
  archiveCatalogProduct,
  getEditableCategories,
  restoreArchivedCatalogProduct,
  restoreDemoCatalog,
  toggleCatalogProductAvailability,
  upsertCatalogProduct,
} from './core/catalog-store.js';
import {
  getActiveOrders as selectActiveOrders,
  getBusinessMetrics,
  getLowStockProducts as selectLowStockProducts,
} from './core/business-metrics.js';
import {
  BUSINESS_CANCEL_REASONS,
  BUSINESS_ORDER_FILTERS,
  DEFAULT_PREP_MINUTES,
  PREP_TIME_OPTIONS,
  canBusinessCancelOrder,
  filterBusinessOrders,
  getBusinessOrderFilterCounts,
  getBusinessOrderPrimaryAction,
  getBusinessStatusMeta,
  normalizeBusinessOrderFilter,
  normalizePreparationMinutes,
} from './core/business-ops.js';
import {
  buildBusinessReport,
  formatBusinessReportSummary,
  periodLabel,
} from './core/business-reports.js';
import {
  buildBusinessSetupPatch,
  restoreBusinessSetupDemo,
  saveBusinessSetup,
} from './core/business-setup.js';
import { readCashboxClosures, saveCashboxClosure } from './core/cashbox-store.js';
import { toDomainOrder } from './core/domain.js';
import { isTerminalOrderStatus } from './core/order-status.js';
import { getNextWorkflowStatus, toDemoOrderStatus } from './core/order-workflow.js';
import {
  dateTime,
  deliveryModeLabel,
  getState,
  money,
  setState,
  statusClass,
  statusLabel,
  updateBusinessConfig,
  updateState,
} from './state.js';
import {
  actionLabelForOrder,
  advanceOrderStatus,
  buildKitchenTicket,
  cancelOrder,
} from './orders.js';
import { sanitizeText } from './core/validators.js';
import { getOrderRepository, isPersistentOrderRepository } from './repositories/repository_factory.js';
import { escapeHtml, productCode, stockPill } from './ui.js';
import { chooseRiderLocation, hasLiveRiderLocation } from './map/route_geometry.js';

let seenOrderIds = null; // se inicializa en el primer render para detectar pedidos nuevos
let soundEnabled = readSoundPref();
let audioCtx = null;
let businessOrderFilter = 'all';
let businessOrderQuery = '';
let businessReportPeriod = 'today';
let businessReportCopyFallback = '';
let businessSetupFeedback = '';
// Pedido en espera de confirmación de cancelación (el primer tap NO cancela:
// abre el modal de confirmación con motivo obligatorio).
let pendingCancelOrderId = null;
let editingCatalogProductId = null;
const CANCEL_REASON_PRESETS = BUSINESS_CANCEL_REASONS;

function readSoundPref() {
  try { return globalThis.localStorage?.getItem('la_taba_business_sound') === 'on'; } catch (_) { return false; }
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
    if (audioCtx.state === 'suspended') {
      const resume = audioCtx.resume();
      if (resume?.catch) resume.catch(() => {});
    }
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
  if (pin !== getBusinessConfig().adminPin) return false;
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
  const report = buildBusinessReport(state.orders, { period: businessReportPeriod });
  const cashboxClosures = readCashboxClosures();
  const lowStock = metrics.lowStock;
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
          <span>${soundEnabled ? 'Sonido activo' : 'Activar sonido'}</span>
          ${receivedOrders.length ? `<strong>${receivedOrders.length}</strong>` : ''}
        </button>
        <div class="business-topbar-text">
          <h2>Central de pedidos</h2>
          <span>Los pedidos confirmados aparecen acá. Aceptás, preparás y mandás a reparto sin perder el foco.</span>
        </div>
        <nav class="business-jump-nav" aria-label="Secciones del negocio">
          <button class="secondary-button compact" type="button" data-scroll-orders>Pedidos</button>
          <button class="secondary-button compact" type="button" data-scroll-reports>Reportes</button>
          <button class="secondary-button compact" type="button" data-scroll-catalog>Catalogo</button>
          <button class="secondary-button compact" type="button" data-scroll-business-setup>Configuracion</button>
        </nav>
      </header>

      ${renderOrderInbox(state, metrics, freshOrderIds)}

      ${renderDeliveredTodaySummary(state.orders)}

      ${renderBusinessReportsPanel(report, cashboxClosures)}

      ${renderCatalogManager(state)}

      ${renderBusinessSetupPanel()}

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
  { id: 'nuevos', title: 'Pedidos nuevos', hint: 'Atencion inmediata', match: (order) => order.status === 'received' },
  { id: 'preparando', title: 'En preparacion', hint: 'En cocina o mostrador', match: (order) => order.status === 'preparing' },
  { id: 'listos', title: 'Listos', hint: 'Para retiro o reparto', match: (order) => order.status === 'ready' },
  { id: 'reparto', title: 'En reparto', hint: 'Pedidos en calle', match: (order) => ['on_the_way', 'arriving'].includes(order.status) },
];

// Central de pedidos: lista vertical mobile-first con los pedidos REALES de la
// demo, agrupados por fase. No hay tarjetas decorativas: cada card es un pedido
// confirmado por un cliente. Las acciones publican el cambio de estado por
// realtime para que cliente y rider vean lo mismo.
function renderOrderInbox(state, metrics, freshOrderIds = new Set()) {
  const orders = Array.isArray(state.orders) ? state.orders : [];
  const activeFilter = normalizeBusinessOrderFilter(businessOrderFilter);
  const query = businessOrderQuery;
  const filtered = filterBusinessOrders(orders, { filter: activeFilter, query });
  const active = filtered.filter((order) => !isTerminalOrderStatus(order.status));
  const closed = filtered.filter((order) => ['delivered', 'cancelled'].includes(order.status));
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

  const historyBody = (activeFilter === 'done' || activeFilter === 'cancelled')
    ? renderHistoryList(closed)
    : '';

  const body = active.length
    ? `<div class="inbox-feed">${sections.join('')}</div>`
    : historyBody
      ? ''
    : `
      <div class="inbox-empty" data-inbox-empty>
        <strong>${query ? 'No hay pedidos que coincidan.' : 'Todavia no hay pedidos para este filtro.'}</strong>
        <p>${query ? 'Proba buscar por codigo, cliente o direccion.' : 'Cuando un cliente confirme una compra, va a aparecer aca para aceptarla y prepararla.'}</p>
      </div>`;

  const closedBlock = activeFilter === 'all' && closed.length
    ? `
      <details class="inbox-closed">
        <summary>Historial reciente (${closed.length})</summary>
        <div class="inbox-closed-list">${closed.slice(0, 10).map(inboxClosedRow).join('')}</div>
      </details>`
    : '';

  return `<div class="order-inbox" data-order-inbox data-ops-board>${renderInboxControls(orders, metrics)}${body}${historyBody}${closedBlock}</div>`;
}

function renderInboxControls(orders, metrics) {
  const counts = getBusinessOrderFilterCounts(orders);
  const pendingCount = metrics.ordersByStatus.received;
  return `
    <div class="inbox-ops-head">
      <div class="pending-counter ${pendingCount ? 'has-pending' : ''}" role="status">
        <span>Nuevos pendientes</span>
        <strong>${pendingCount}</strong>
      </div>
      <label class="business-search-field">
        <span>Buscar pedido</span>
        <input data-business-order-search type="search" value="${escapeHtml(businessOrderQuery)}" placeholder="ID, cliente o direccion" autocomplete="off" />
      </label>
    </div>
    <div class="inbox-tabs" aria-label="Filtros de pedidos">
      ${BUSINESS_ORDER_FILTERS.map((filter) => {
        const active = normalizeBusinessOrderFilter(businessOrderFilter) === filter.id;
        return `
          <button class="inbox-tab ${filterTone(filter.id)} ${active ? 'active' : ''} ${counts[filter.id] > 0 ? 'has-count' : ''}" type="button" data-order-filter="${filter.id}" aria-pressed="${active}">
            <span>${escapeHtml(filter.label)}</span>
            <strong>${counts[filter.id] || 0}</strong>
          </button>`;
      }).join('')}
    </div>`;
}

function renderHistoryList(orders) {
  if (!orders.length) return '';
  return `
    <section class="inbox-history" aria-label="Historial de pedidos">
      <header class="inbox-group-head">
        <strong>Historial</strong>
        <span class="inbox-count">${orders.length}</span>
        <small>Entregados y cancelados quedan accesibles.</small>
      </header>
      <div class="inbox-closed-list">${orders.map(inboxClosedRow).join('')}</div>
    </section>`;
}

function filterTone(filterId) {
  const tones = {
    all: 'all',
    new: 'received',
    preparing: 'preparing',
    ready: 'ready',
    delivery: 'way',
    done: 'done',
    cancelled: 'cancelled',
  };
  return tones[filterId] || 'all';
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
  const statusMeta = getBusinessStatusMeta(order.status);
  const primaryAction = getBusinessOrderPrimaryAction(order);
  const itemsList = order.items.map((item) => `
        <li><span>${item.quantity}× ${escapeHtml(item.name)}</span><strong>${money(item.quantity * item.unitPrice)}</strong></li>`).join('');
  const showTrack = order.deliveryMode === 'delivery' && ['ready', 'on_the_way', 'arriving'].includes(order.status);
  const priorityClass = options.priority ? 'is-priority' : 'is-secondary';
  const freshClass = options.fresh ? 'is-fresh' : '';
  const prepMinutes = normalizePreparationMinutes(order.delivery?.estimatedPreparationMinutes, 0);

  return `
    <article class="inbox-order ${priorityClass} ${freshClass} accent-${statusClass(order.status)}" data-inbox-order="${escapeHtml(order.id)}">
      <div class="inbox-order-top">
        <span class="inbox-state-dot" aria-hidden="true"></span>
        <span class="status-chip ${statusClass(order.status)}">${options.priority ? 'Pedido nuevo' : escapeHtml(statusMeta.shortLabel)}</span>
        <span class="inbox-status-label">${escapeHtml(statusMeta.label)}</span>
        <span class="inbox-time">${escapeHtml(timeAgo(order.createdAt))}</span>
      </div>

      <div class="inbox-card-layout">
        <div class="inbox-card-main">
          <strong class="inbox-id">${escapeHtml(order.id)}</strong>
          <div class="inbox-order-customer">
            <strong>${escapeHtml(order.customerName)}</strong>
            <span class="inbox-type ${isPickup ? 'pickup' : 'delivery'}">${isPickup ? 'Retiro en local' : 'Delivery'}</span>
          </div>
          <p class="inbox-status-copy">${escapeHtml(statusMeta.copy)}</p>
          ${prepMinutes > 0 && !isTerminalOrderStatus(order.status) ? `<p class="inbox-prep-summary">Preparacion estimada: <strong>${prepMinutes} min</strong></p>` : ''}
          ${renderInboxTrackingPanel(order)}
        </div>

        <div class="inbox-commerce-panel">
          <aside class="inbox-payment-panel">
            <span>Total a cobrar</span>
            <strong>${money(order.total)}</strong>
            <small>${escapeHtml(order.paymentMethod || 'Efectivo')}</small>
            ${Number(order.discountTotal || 0) > 0 ? `<em>${escapeHtml(order.coupon?.code || 'Promo')} -${money(order.discountTotal)}</em>` : ''}
          </aside>
          <div class="inbox-actions">
            ${renderPrimaryOrderAction(order, primaryAction)}
            ${phone ? `<a class="ghost-button compact" href="https://wa.me/${phone}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : ''}
            ${order.customerPhone ? `<a class="ghost-button compact" href="tel:${encodeURIComponent(order.customerPhone)}">Llamar</a>` : ''}
            ${showTrack ? `<button class="ghost-button compact" type="button" data-order-track="${order.id}">Ver tracking</button>` : ''}
            <button class="ghost-button compact" type="button" data-order-ticket="${order.id}">Copiar ticket</button>
            ${canBusinessCancelOrder(order) ? `<button class="ghost-button compact danger-ghost" type="button" data-order-cancel="${order.id}">Cancelar pedido</button>` : ''}
          </div>
        </div>

        <div class="inbox-card-details">
          <div class="inbox-detail-list">
            <p><span>Teléfono</span><strong>${escapeHtml(order.customerPhone)}</strong></p>
            <p><span>${isPickup ? 'Retiro' : 'Dirección'}</span><strong>${isPickup ? 'Retira en el local' : escapeHtml(address.label || order.address)}</strong></p>
            ${!isPickup && reference ? `<p><span>Referencia</span><strong>${escapeHtml(reference)}</strong></p>` : ''}
            <p><span>Pago</span><strong>${escapeHtml(order.paymentMethod)}</strong></p>
            ${order.cashChange ? `<p><span>Cambio efectivo</span><strong>${escapeHtml(order.cashChange)}</strong></p>` : ''}
            ${Number(order.discountTotal || 0) > 0 ? `<p><span>Cupón</span><strong>${escapeHtml(order.coupon?.code || 'Promo')} · -${money(order.discountTotal)}</strong></p>` : ''}
          </div>
          <div class="inbox-products-block">
            <span>Productos</span>
            <ul class="inbox-items">${itemsList}</ul>
          </div>
          ${order.notes && order.notes !== 'Sin notas' ? `<p class="inbox-notes">Observaciones del pedido: ${escapeHtml(order.notes)}</p>` : ''}
        </div>
      </div>
    </article>`;
}

function renderPrimaryOrderAction(order, action) {
  if (!action) return '';
  const prepControl = action.requiresPrepTime
    ? `
      <label class="prep-time-field">
        <span>Tiempo de preparacion</span>
        <select data-prep-minutes aria-label="Tiempo estimado de preparacion">
          ${PREP_TIME_OPTIONS.map((minutes) => `
            <option value="${minutes}" ${minutes === DEFAULT_PREP_MINUTES ? 'selected' : ''}>${minutes} min</option>`).join('')}
        </select>
      </label>`
    : '';
  return `
    <div class="primary-action-block">
      ${prepControl}
      <button class="primary-button compact main-order-action" type="button" data-order-advance="${escapeHtml(order.id)}">
        ${escapeHtml(action.label)}
      </button>
      <small>${escapeHtml(action.copy)}</small>
    </div>`;
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
  const gpsText = liveGps ? 'GPS del rider en vivo' : 'Sin ubicación en vivo';
  const liveAge = liveGps ? (timeAgo(riderLocation.lastFixAt || riderLocation.timestamp) || 'recién') : '';
  const gpsDetail = liveGps
    ? `Actualizado ${liveAge}`
    : 'Seguís el pedido por estado y dirección.';
  const actionLabel = 'Seguir reparto';

  return `
    <section class="inbox-tracking-panel ${liveGps ? 'is-live' : 'is-offline'}" data-business-tracking="${escapeHtml(order.id)}">
      <div class="inbox-tracking-head">
        <div>
          <span class="inbox-live-dot" aria-hidden="true"></span>
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(gpsText)}</span>
        </div>
        <em>${escapeHtml(gpsDetail)}</em>
      </div>
      <div class="inbox-tracking-grid">
        <span><small>Cliente</small><strong>${escapeHtml(order.customerName)}</strong></span>
        <span><small>Dirección</small><strong>${escapeHtml(address.label || order.address)}</strong></span>
        ${riderName ? `<span><small>Rider</small><strong>${escapeHtml(riderName)}</strong></span>` : ''}
        <span><small>Estado</small><strong>${escapeHtml(statusLabel(order.status))}</strong></span>
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
  const reason = order.status === 'cancelled' && order.cancelReason
    ? `<small class="inbox-closed-reason">Motivo: ${escapeHtml(order.cancelReason)}</small>`
    : '';
  return `
    <div class="inbox-closed-row">
      <span>${escapeHtml(order.id)} · ${escapeHtml(order.customerName)} · ${escapeHtml(order.paymentMethod || 'Efectivo')}${Number(order.discountTotal || 0) > 0 ? ` · ${escapeHtml(order.coupon?.code || 'Promo')} -${money(order.discountTotal)}` : ''}${reason}</span>
      <strong>${money(order.total)}</strong>
      <em class="status-chip ${statusClass(order.status)}">${statusLabel(order.status)}</em>
    </div>`;
}

function onlyDigits(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.startsWith('54') ? digits : `549${digits}`;
}

function renderBusinessReportsPanel(report, closures = []) {
  const status = report.ordersByStatus || {};
  const wayCount = Number(status.on_the_way || 0) + Number(status.arriving || 0);
  const topProduct = report.topProduct
    ? `${report.topProduct.name} (${report.topProduct.quantity})`
    : 'Sin ventas';
  const cancelReason = report.topCancellationReason
    ? `${report.topCancellationReason.reason} (${report.topCancellationReason.count})`
    : 'Sin cancelaciones';
  const summaryFallback = businessReportCopyFallback
    ? `<pre class="business-copy-fallback" data-business-copy-fallback>${escapeHtml(businessReportCopyFallback)}</pre>`
    : '';

  return `
    <section class="business-report-card" data-business-report aria-labelledby="business-report-title">
      <header class="business-report-head">
        <div>
          <span class="catalog-admin-kicker">Caja y reportes operativos</span>
          <h3 id="business-report-title">Caja del día</h3>
          <p>Métricas calculadas desde pedidos existentes y snapshots históricos.</p>
        </div>
        <div class="report-period-tabs" aria-label="Filtro temporal de reportes">
          ${reportPeriodButton('today', report.period)}
          ${reportPeriodButton('last7', report.period)}
          ${reportPeriodButton('all', report.period)}
        </div>
      </header>

      <div class="business-day-strip report-strip" aria-label="Caja del día">
        <div class="day-metric accent"><span>${report.period === 'today' ? 'Ventas de hoy' : 'Ventas netas'}</span><strong>${money(report.netSales)}</strong></div>
        <div class="day-metric"><span>Efectivo</span><strong>${money(report.salesByPaymentMethod.cash)}</strong></div>
        <div class="day-metric"><span>Transferencia</span><strong>${money(report.salesByPaymentMethod.transfer)}</strong></div>
        <div class="day-metric"><span>Mercado Pago/link</span><strong>${money(report.salesByPaymentMethod.mercadoPago)}</strong></div>
        <div class="day-metric"><span>Sin especificar</span><strong>${money(report.salesByPaymentMethod.unknown)}</strong></div>
        <div class="day-metric"><span>Descuentos</span><strong>${money(report.totalDiscounts)}</strong></div>
        <div class="day-metric"><span>Entregados</span><strong>${report.deliveredOrders}</strong></div>
        <div class="day-metric"><span>Cancelados</span><strong>${report.cancelledOrders}</strong></div>
        <div class="day-metric"><span>Ticket promedio con delivery</span><strong>${money(report.ticketAverage)}</strong></div>
      </div>

      <div class="business-report-grid">
        <section class="report-panel" aria-label="Resumen operativo">
          <div class="panel-head compact"><h3>Resumen operativo</h3><span>${escapeHtml(periodLabel(report.period))}</span></div>
          <div class="status-board report-status-board">
            <span class="board-chip received">Nuevos <strong>${status.received || 0}</strong></span>
            <span class="board-chip preparing">Preparando <strong>${status.preparing || 0}</strong></span>
            <span class="board-chip ready">Listos <strong>${status.ready || 0}</strong></span>
            <span class="board-chip way">En reparto <strong>${wayCount}</strong></span>
            <span class="board-chip done">Entregados <strong>${report.deliveredOrders}</strong></span>
            <span class="board-chip cancelled">Cancelados <strong>${report.cancelledOrders}</strong></span>
          </div>
          <div class="report-highlight-list">
            <p><span>Producto más vendido</span><strong>${escapeHtml(topProduct)}</strong></p>
            <p><span>Motivo frecuente de cancelación</span><strong>${escapeHtml(cancelReason)}</strong></p>
            <p><span>Clientes únicos</span><strong>${report.uniqueCustomers}</strong></p>
            <p><span>Último pedido</span><strong>${escapeHtml(report.latestOrder?.id || 'Sin pedidos')}${report.latestOrderTime ? ` - ${escapeHtml(report.latestOrderTime)}` : ''}</strong></p>
          </div>
        </section>

        <section class="report-panel" aria-label="Cierre de caja demo">
          <div class="panel-head compact"><h3>Cierre de caja</h3><span>Demo local</span></div>
          <div class="cashbox-actions">
            <button class="primary-button compact" type="button" data-cashbox-close>Cerrar caja demo</button>
            <button class="secondary-button compact" type="button" data-copy-business-summary>Copiar resumen</button>
          </div>
          <p class="cashbox-note">Cierre demo: guarda una foto del período seleccionado. No bloquea pedidos, no evita cierres repetidos y no es un cierre contable incremental.</p>
          ${summaryFallback}
          ${renderCashboxHistory(closures)}
        </section>
      </div>
    </section>`;
}

function reportPeriodButton(period, activePeriod) {
  const active = period === activePeriod;
  return `
    <button class="report-period-tab ${active ? 'active' : ''}" type="button" data-report-period="${period}" aria-pressed="${active}">
      ${escapeHtml(periodLabel(period))}
    </button>`;
}

function renderCashboxHistory(closures = []) {
  if (!closures.length) {
    return '<p class="cashbox-empty">Sin cierres guardados todavía.</p>';
  }
  const rows = closures.slice(0, 5).map((closure) => {
    const metrics = closure.metrics || {};
    const payment = metrics.salesByPaymentMethod || {};
    return `
      <div class="cashbox-history-row">
        <span>${escapeHtml(dateTime(closure.closedAt))}</span>
        <strong>${money(metrics.netSales)}</strong>
        <small>Efectivo ${money(payment.cash)} - Transferencia ${money(payment.transfer)} - MP/link ${money(payment.mercadoPago)} - Sin especificar ${money(payment.unknown)}</small>
        <em>${metrics.deliveredOrders || 0} entregados - ${metrics.cancelledOrders || 0} cancelados</em>
      </div>`;
  }).join('');
  return `
    <details class="cashbox-history" open>
      <summary>Historial de cierres (${closures.length})</summary>
      <div class="cashbox-history-list">${rows}</div>
    </details>`;
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
      ${Number(order.discountTotal || 0) > 0 ? `<div class="summary-row discount"><span>Cupón ${escapeHtml(order.coupon?.code || 'Promo')}</span><strong>-${money(order.discountTotal)}</strong></div>` : ''}
      <div class="summary-row total"><span>Total</span><strong>${money(order.total)}</strong></div>
      ${order.cashChange ? `<p><strong>Cambio efectivo:</strong> ${escapeHtml(order.cashChange)}</p>` : ''}
      <p><strong>Observaciones:</strong> ${escapeHtml(order.notes)}</p>
      <div class="order-actions">
        <button class="primary-button compact" type="button" data-order-advance="${order.id}" ${canAdvance ? '' : 'disabled'}>${actionLabelForOrder(order)}</button>
        <button class="danger-button compact" type="button" data-order-cancel="${order.id}" ${canAdvance ? '' : 'disabled'}>Cancelar</button>
      </div>
    </article>
  `;
}

function renderCatalogManager(state) {
  const allProducts = Array.isArray(state.products) ? state.products : [];
  const activeProducts = allProducts.filter((product) => !product.archived);
  const archivedProducts = allProducts.filter((product) => product.archived);
  let editingProduct = editingCatalogProductId
    ? allProducts.find((product) => product.id === editingCatalogProductId && !product.archived)
    : null;
  if (editingCatalogProductId && !editingProduct) {
    editingCatalogProductId = null;
    editingProduct = null;
  }

  return `
    <section class="business-catalog-card" data-business-catalog aria-labelledby="business-catalog-title">
      <header class="business-catalog-head">
        <div>
          <span class="catalog-admin-kicker">Catalogo editable · Productos y stock</span>
          <h3 id="business-catalog-title">Productos que ve el cliente</h3>
          <p>Creas, editas, pausas o archivas productos sin tocar pedidos ya confirmados.</p>
        </div>
        <div class="catalog-admin-top-actions">
          <button class="secondary-button compact" type="button" data-catalog-new>Nuevo producto</button>
          <button class="ghost-button compact" type="button" data-catalog-reset-demo>Restaurar catalogo demo</button>
        </div>
      </header>

      ${renderCatalogForm(editingProduct)}
      ${renderCatalogRows(activeProducts)}
      ${renderArchivedCatalogRows(archivedProducts)}
    </section>`;
}

function renderBusinessSetupPanel() {
  const config = getBusinessConfig();
  const preview = renderBusinessSetupPreview(config);
  const feedback = businessSetupFeedback
    ? `<p class="business-setup-feedback" role="status" data-business-setup-feedback>${escapeHtml(businessSetupFeedback)}</p>`
    : '';

  return `
    <section class="business-setup-card" data-business-setup aria-labelledby="business-setup-title">
      <header class="business-catalog-head business-setup-head">
        <div>
          <span class="catalog-admin-kicker">Autoservicio demo</span>
          <h3 id="business-setup-title">Configuracion del negocio</h3>
          <p>Cambia identidad, contacto, horarios y reglas basicas sin tocar codigo. Se guarda localmente en esta demo.</p>
        </div>
        <button class="ghost-button compact" type="button" data-business-setup-reset-demo>Restaurar configuracion demo</button>
      </header>

      <div class="business-setup-layout">
        <form class="business-setup-form" data-business-setup-form novalidate>
          <fieldset>
            <legend>Identidad</legend>
            <div class="catalog-form-grid">
              <label>
                <span>Comercio visible</span>
                <input name="businessName" type="text" maxlength="80" required value="${escapeHtml(config.businessName)}" />
              </label>
              <label>
                <span>Subtitulo del local</span>
                <input name="subtitle" type="text" maxlength="80" value="${escapeHtml(config.subtitle)}" />
              </label>
              <label>
                <span>Prefijo de pedido</span>
                <input name="orderPrefix" type="text" maxlength="5" required value="${escapeHtml(config.orderPrefix)}" />
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend>Contacto</legend>
            <div class="catalog-form-grid">
              <label>
                <span>Direccion</span>
                <input name="address" type="text" maxlength="180" required value="${escapeHtml(config.address)}" />
              </label>
              <label>
                <span>WhatsApp</span>
                <input name="whatsappNumber" type="tel" inputmode="tel" required value="${escapeHtml(config.whatsappNumber)}" />
              </label>
              <label class="catalog-description-field">
                <span>Zona de entrega</span>
                <input name="deliveryZone" type="text" maxlength="160" value="${escapeHtml(config.deliveryZone)}" />
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend>Horarios</legend>
            <div class="catalog-form-grid">
              <label class="catalog-description-field">
                <span>Texto visible de horarios</span>
                <input name="openingHoursLabel" type="text" maxlength="120" value="${escapeHtml(config.openingHoursLabel)}" />
              </label>
              <label>
                <span>Hora apertura</span>
                <input name="openHour" type="number" min="0" max="24" step="1" inputmode="numeric" required value="${escapeHtml(String(config.openHour))}" />
              </label>
              <label>
                <span>Hora cierre</span>
                <input name="closeHour" type="number" min="0" max="24" step="1" inputmode="numeric" required value="${escapeHtml(String(config.closeHour))}" />
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend>Delivery y acceso demo</legend>
            <div class="catalog-form-grid">
              <label>
                <span>Costo de envio</span>
                <input name="deliveryFee" type="number" min="0" step="1" inputmode="numeric" required value="${escapeHtml(String(config.deliveryFee))}" />
              </label>
              <label>
                <span>Pedido minimo para envio</span>
                <input name="minDeliveryOrder" type="number" min="0" step="1" inputmode="numeric" required value="${escapeHtml(String(config.minDeliveryOrder))}" />
              </label>
              <label>
                <span>PIN negocio</span>
                <input name="adminPin" type="text" inputmode="numeric" minlength="4" maxlength="6" required value="${escapeHtml(config.adminPin)}" />
              </label>
            </div>
          </fieldset>

          <p class="form-hint catalog-form-error hidden" data-business-setup-error></p>
          ${feedback}
          <div class="catalog-form-actions">
            <button class="primary-button compact" type="button" data-business-setup-save>Guardar configuracion</button>
            <button class="ghost-button compact" type="button" data-business-setup-reset-demo>Restaurar configuracion demo</button>
          </div>
        </form>

        ${preview}
      </div>
    </section>`;
}

function renderBusinessSetupPreview(config) {
  return `
    <aside class="business-setup-preview" data-business-setup-preview aria-label="Vista previa de configuracion">
      <span class="catalog-admin-kicker">Vista previa</span>
      <strong data-setup-preview="businessName">${escapeHtml(config.businessName)}</strong>
      <p data-setup-preview="subtitle">${escapeHtml(config.subtitle)}</p>
      <dl>
        <div><dt>Direccion</dt><dd data-setup-preview="address">${escapeHtml(config.address)}</dd></div>
        <div><dt>WhatsApp</dt><dd data-setup-preview="whatsappNumber">${escapeHtml(config.whatsappNumber)}</dd></div>
        <div><dt>Horarios</dt><dd data-setup-preview="openingHoursLabel">${escapeHtml(config.openingHoursLabel)}</dd></div>
        <div><dt>Costo delivery</dt><dd data-setup-preview="deliveryFee">${money(config.deliveryFee)}</dd></div>
        <div><dt>Pedido minimo</dt><dd data-setup-preview="minDeliveryOrder">${money(config.minDeliveryOrder)}</dd></div>
        <div><dt>Prefijo</dt><dd data-setup-preview="orderPrefix">${escapeHtml(config.orderPrefix)}</dd></div>
      </dl>
    </aside>`;
}

function renderCatalogForm(product = null) {
  const isEditing = Boolean(product);
  const categoryId = product?.categoryId || 'carnes';
  const badge = product?.badge || '';
  const available = !product || product.available;

  return `
    <form class="catalog-admin-form" data-catalog-form novalidate>
      <input type="hidden" name="productId" value="${isEditing ? escapeHtml(product.id) : ''}" />
      <div class="catalog-form-title">
        <strong>${isEditing ? 'Editar producto' : 'Crear producto'}</strong>
        <span>${isEditing ? escapeHtml(product.name) : 'Alta rapida para la vidriera del cliente'}</span>
      </div>

      <div class="catalog-form-grid">
        <label>
          <span>Producto a vender</span>
          <input name="name" type="text" maxlength="100" required value="${escapeHtml(product?.name || '')}" />
        </label>
        <label>
          <span>Precio</span>
          <input name="price" type="number" min="1" step="1" inputmode="decimal" required value="${product ? String(product.price) : ''}" />
        </label>
        <label>
          <span>Categoria</span>
          <select name="categoryId" required>
            ${categoryOptions(categoryId)}
          </select>
        </label>
        <label>
          <span>Etiqueta opcional</span>
          <select name="badge">
            ${badgeOptions(badge)}
          </select>
        </label>
        <label class="catalog-description-field">
          <span>Descripcion breve</span>
          <textarea name="description" rows="2" maxlength="180">${escapeHtml(product?.description || '')}</textarea>
        </label>
        <label class="catalog-availability-field">
          <input name="available" type="checkbox" ${available ? 'checked' : ''} />
          <span>Disponible para clientes</span>
        </label>
      </div>

      <p class="form-hint catalog-form-error hidden" data-catalog-form-error></p>
      <div class="catalog-form-actions">
        <button class="primary-button compact" type="button" data-catalog-save>${isEditing ? 'Guardar cambios' : 'Crear producto'}</button>
        ${isEditing ? '<button class="ghost-button compact" type="button" data-catalog-new>Cancelar edicion</button>' : ''}
      </div>
    </form>`;
}

function renderCatalogRows(products) {
  if (!products.length) {
    return `
      <div class="catalog-admin-empty">
        <strong>No hay productos visibles.</strong>
        <p>Agrega un producto para que aparezca en el catalogo del cliente.</p>
        <button class="secondary-button compact" type="button" data-catalog-new>Crear producto</button>
      </div>`;
  }

  return `
    <div class="catalog-admin-list" aria-label="Productos del catalogo">
      ${products.map(catalogProductRow).join('')}
    </div>`;
}

function renderArchivedCatalogRows(products) {
  if (!products.length) return '';
  return `
    <details class="catalog-archived">
      <summary>Archivados (${products.length})</summary>
      <div class="catalog-admin-list archived-list">
        ${products.map(archivedProductRow).join('')}
      </div>
    </details>`;
}

function catalogProductRow(product) {
  return `
    <article class="catalog-admin-row ${product.available ? '' : 'is-disabled'}" data-catalog-admin-row="${escapeHtml(product.id)}">
      <div class="catalog-admin-main">
        <span class="stock-thumb">${productCode(product)}</span>
        <div>
          <strong>${escapeHtml(product.name)}</strong>
          <p>${escapeHtml(product.description || 'Sin descripcion')}</p>
          <div class="catalog-admin-tags">
            <span>${escapeHtml(categoryName(product.categoryId))}</span>
            ${product.badge ? `<span>${escapeHtml(product.badge)}</span>` : ''}
            ${stockPill(product)}
          </div>
        </div>
      </div>
      <div class="catalog-admin-price">
        <strong>${money(product.price)}</strong>
        <small>${product.available ? 'Visible para cliente' : 'No disponible'}</small>
      </div>
      <div class="catalog-admin-actions">
        <div class="catalog-stock-actions" aria-label="Stock demo de ${escapeHtml(product.name)}">
          <button class="icon-button compact" type="button" data-stock-dec="${escapeHtml(product.id)}" aria-label="Restar stock de ${escapeHtml(product.name)}">−</button>
          <strong>${product.stock}</strong>
          <button class="icon-button compact" type="button" data-stock-inc="${escapeHtml(product.id)}" aria-label="Sumar stock de ${escapeHtml(product.name)}">+</button>
        </div>
        <button class="ghost-button compact" type="button" data-product-edit="${escapeHtml(product.id)}">Editar</button>
        <button class="ghost-button compact" type="button" data-product-toggle="${escapeHtml(product.id)}">${product.available ? 'Pausar' : 'Activar'}</button>
        <button class="ghost-button compact danger-ghost" type="button" data-product-archive="${escapeHtml(product.id)}">Archivar</button>
      </div>
    </article>`;
}

function archivedProductRow(product) {
  return `
    <article class="catalog-admin-row is-archived" data-catalog-admin-row="${escapeHtml(product.id)}">
      <div class="catalog-admin-main">
        <span class="stock-thumb">${productCode(product)}</span>
        <div>
          <strong>${escapeHtml(product.name)}</strong>
          <p>${escapeHtml(categoryName(product.categoryId))} · ${money(product.price)}</p>
        </div>
      </div>
      <div class="catalog-admin-actions">
        <button class="ghost-button compact" type="button" data-product-restore="${escapeHtml(product.id)}">Restaurar</button>
      </div>
    </article>`;
}

function categoryOptions(selectedId) {
  return getEditableCategories().map((category) => `
    <option value="${escapeHtml(category.id)}" ${category.id === selectedId ? 'selected' : ''}>${escapeHtml(categoryLabel(category))}</option>
  `).join('');
}

function badgeOptions(selectedBadge) {
  const options = CATALOG_BADGE_OPTIONS.includes(selectedBadge)
    ? CATALOG_BADGE_OPTIONS
    : [...CATALOG_BADGE_OPTIONS, selectedBadge];
  return options.map((badge) => `
    <option value="${escapeHtml(badge)}" ${badge === selectedBadge ? 'selected' : ''}>${badge ? escapeHtml(badge) : 'Sin etiqueta'}</option>
  `).join('');
}

function categoryName(categoryId) {
  return getEditableCategories().find((category) => category.id === categoryId)?.name || 'General';
}

function categoryLabel(category) {
  return category.id === 'retiro' ? 'Retiro local' : category.name;
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
  const filterButton = target.closest('[data-order-filter]');
  if (filterButton) {
    businessOrderFilter = normalizeBusinessOrderFilter(filterButton.dataset.orderFilter);
    if (typeof document !== 'undefined') renderBusinessDashboard();
    return { handled: true, ok: true, message: '' };
  }

  const reportPeriodButton = target.closest('[data-report-period]');
  if (reportPeriodButton) {
    businessReportPeriod = reportPeriodButton.dataset.reportPeriod || 'today';
    businessReportCopyFallback = '';
    if (typeof document !== 'undefined') renderBusinessDashboard();
    return { handled: true, ok: true, message: '' };
  }

  if (target.closest('[data-copy-business-summary]')) {
    return copyBusinessReportSummary();
  }

  if (target.closest('[data-cashbox-close]')) {
    const report = buildBusinessReport(getState().orders, { period: businessReportPeriod });
    const result = saveCashboxClosure(report);
    businessReportCopyFallback = '';
    if (typeof document !== 'undefined') renderBusinessDashboard();
    return {
      handled: true,
      ok: result.ok,
      message: result.ok ? 'Cierre de caja demo guardado.' : 'No se pudo guardar el cierre demo.',
    };
  }

  const advanceButton = target.closest('[data-order-advance]');
  const advanceId = advanceButton?.dataset.orderAdvance;
  if (advanceId) {
    return actionResponse(advanceOrder(advanceId, {
      estimatedPreparationMinutes: readPrepMinutesForOrderAction(advanceButton),
    }), 'Estado del pedido actualizado.');
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

  if (target.closest('[data-scroll-reports]')) {
    if (typeof document !== 'undefined') {
      document.querySelector('[data-business-report]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    return { handled: true, ok: true, message: '' };
  }

  if (target.closest('[data-scroll-catalog]')) {
    scrollCatalogManager();
    return { handled: true, ok: true, message: '' };
  }

  if (target.closest('[data-scroll-business-setup]')) {
    scrollBusinessSetup();
    return { handled: true, ok: true, message: '' };
  }

  if (target.closest('[data-business-setup-save]')) {
    return saveBusinessSetupFromForm();
  }

  if (target.closest('[data-business-setup-reset-demo]')) {
    return requestBusinessSetupReset();
  }

  if (target.closest('[data-business-setup-reset-dismiss]')) {
    closeBusinessSetupResetModal();
    return { handled: true, ok: true, message: '' };
  }

  if (target.closest('[data-business-setup-reset-confirm]')) {
    return confirmBusinessSetupReset();
  }

  if (target.closest('[data-catalog-new]')) {
    editingCatalogProductId = null;
    if (typeof document !== 'undefined') {
      renderBusinessDashboard();
      scrollCatalogManager();
      setTimeout(() => document.querySelector('[data-catalog-form] [name="name"]')?.focus(), 0);
    }
    return { handled: true, ok: true, message: '' };
  }

  const editId = target.closest('[data-product-edit]')?.dataset.productEdit;
  if (editId) {
    editingCatalogProductId = editId;
    if (typeof document !== 'undefined') {
      renderBusinessDashboard();
      scrollCatalogManager();
      setTimeout(() => document.querySelector('[data-catalog-form] [name="name"]')?.focus(), 0);
    }
    return { handled: true, ok: true, message: '' };
  }

  if (target.closest('[data-catalog-save]')) {
    return saveCatalogProductFromForm();
  }

  // Restaurar catálogo demo es destructivo (borra productos cargados por el
  // comercio). El primer tap NO restaura: abre el modal de confirmación.
  if (target.closest('[data-catalog-reset-demo]')) {
    return requestCatalogReset();
  }

  if (target.closest('[data-catalog-reset-dismiss]')) {
    closeCatalogResetModal();
    return { handled: true, ok: true, message: '' };
  }

  if (target.closest('[data-catalog-reset-confirm]')) {
    return confirmCatalogReset();
  }

  // Primer tap "Rechazar/Cancelar": NO cancela. Abre el modal de confirmación
  // con el motivo obligatorio, para evitar que un toque accidental pierda un
  // pedido real.
  const cancelId = target.closest('[data-order-cancel]')?.dataset.orderCancel;
  if (cancelId) {
    return requestOrderCancellation(cancelId);
  }

  if (target.closest('[data-cancel-dismiss]')) {
    closeCancelModal();
    return { handled: true, ok: true, message: '' };
  }

  const presetButton = target.closest('[data-cancel-preset]');
  if (presetButton) {
    applyCancelReasonPreset(presetButton.dataset.cancelPreset);
    return { handled: true, ok: true, message: '' };
  }

  if (target.closest('[data-cancel-confirm]')) {
    return submitOrderCancellation();
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

  const archiveId = target.closest('[data-product-archive]')?.dataset.productArchive;
  if (archiveId) {
    const result = archiveProduct(archiveId);
    return { handled: true, ok: result.ok, message: result.message };
  }

  const restoreId = target.closest('[data-product-restore]')?.dataset.productRestore;
  if (restoreId) {
    const result = restoreProduct(restoreId);
    return { handled: true, ok: result.ok, message: result.message };
  }

  return { handled: false };
}

export function handleBusinessInput(target) {
  const setupInput = target.closest?.('[data-business-setup-form] input, [data-business-setup-form] textarea');
  if (setupInput) {
    businessSetupFeedback = '';
    updateBusinessSetupPreview(setupInput.closest('[data-business-setup-form]'));
    clearBusinessSetupError();
    return { handled: true, ok: true, message: '' };
  }

  const searchInput = target.closest?.('[data-business-order-search]');
  if (!searchInput) return { handled: false };
  businessOrderQuery = sanitizeText(searchInput.value, { maxLength: 100 });
  if (typeof document !== 'undefined') {
    renderBusinessDashboard();
    const restored = document.querySelector('[data-business-order-search]');
    if (restored) {
      restored.focus();
      const end = restored.value.length;
      try { restored.setSelectionRange(end, end); } catch (_) { /* ignore */ }
    }
  }
  return { handled: true, ok: true, message: '' };
}

function saveCatalogProductFromForm() {
  const form = typeof document !== 'undefined' ? document.querySelector('[data-catalog-form]') : null;
  if (!form) return { handled: true, ok: false, message: 'Formulario no disponible.' };
  const values = readCatalogForm(form);
  const result = upsertCatalogProduct(getState().products, values, { productId: values.productId });
  if (!result.ok) {
    setCatalogFormError(result.message);
    return { handled: true, ok: false, message: result.message };
  }

  editingCatalogProductId = null;
  setState({ products: result.products });
  return { handled: true, ok: true, message: result.message };
}

function readCatalogForm(form) {
  const formData = new FormData(form);
  return {
    productId: sanitizeText(formData.get('productId'), { maxLength: 80 }),
    name: formData.get('name'),
    description: formData.get('description'),
    price: formData.get('price'),
    categoryId: formData.get('categoryId'),
    badge: formData.get('badge'),
    available: formData.get('available') === 'on',
  };
}

function readBusinessSetupForm(form) {
  const formData = new FormData(form);
  return {
    businessName: formData.get('businessName'),
    subtitle: formData.get('subtitle'),
    orderPrefix: formData.get('orderPrefix'),
    address: formData.get('address'),
    whatsappNumber: formData.get('whatsappNumber'),
    deliveryZone: formData.get('deliveryZone'),
    openingHoursLabel: formData.get('openingHoursLabel'),
    openHour: formData.get('openHour'),
    closeHour: formData.get('closeHour'),
    deliveryFee: formData.get('deliveryFee'),
    minDeliveryOrder: formData.get('minDeliveryOrder'),
    adminPin: formData.get('adminPin'),
  };
}

function saveBusinessSetupFromForm() {
  const form = typeof document !== 'undefined' ? document.querySelector('[data-business-setup-form]') : null;
  if (!form) return { handled: true, ok: false, message: 'Formulario no disponible.' };

  const result = saveBusinessSetup(readBusinessSetupForm(form), updateBusinessConfig);
  if (!result.ok) {
    setBusinessSetupError(result.errors?.join(' ') || result.message);
    businessSetupFeedback = '';
    return result;
  }

  businessSetupFeedback = 'Configuracion guardada.';
  if (typeof document !== 'undefined') {
    renderBusinessDashboard();
    scrollBusinessSetup();
  }
  return result;
}

function setBusinessSetupError(message) {
  if (typeof document === 'undefined') return;
  const error = document.querySelector('[data-business-setup-error]');
  if (!error) return;
  error.textContent = message;
  error.classList.remove('hidden');
}

function clearBusinessSetupError() {
  if (typeof document === 'undefined') return;
  const error = document.querySelector('[data-business-setup-error]');
  if (!error) return;
  error.textContent = '';
  error.classList.add('hidden');
}

function updateBusinessSetupPreview(form) {
  if (typeof document === 'undefined' || !form) return;
  const values = readBusinessSetupForm(form);
  const patch = buildBusinessSetupPatch(values);
  const preview = document.querySelector('[data-business-setup-preview]');
  if (!preview) return;
  const setPreview = (key, value) => {
    const node = preview.querySelector(`[data-setup-preview="${key}"]`);
    if (node) node.textContent = value;
  };
  setPreview('businessName', patch.businessName);
  setPreview('subtitle', patch.subtitle);
  setPreview('address', patch.address);
  setPreview('whatsappNumber', patch.whatsappNumber);
  setPreview('openingHoursLabel', patch.openingHoursLabel);
  setPreview('deliveryFee', money(patch.deliveryFee));
  setPreview('minDeliveryOrder', money(patch.minDeliveryOrder));
  setPreview('orderPrefix', patch.orderPrefix);
}

function setCatalogFormError(message) {
  if (typeof document === 'undefined') return;
  const error = document.querySelector('[data-catalog-form-error]');
  if (!error) return;
  error.textContent = message;
  error.classList.remove('hidden');
}

function scrollCatalogManager() {
  if (typeof document === 'undefined') return;
  document.querySelector('[data-business-catalog]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function scrollBusinessSetup() {
  if (typeof document === 'undefined') return;
  document.querySelector('[data-business-setup]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function archiveProduct(productId) {
  if (editingCatalogProductId === productId) editingCatalogProductId = null;
  const result = archiveCatalogProduct(getState().products, productId);
  if (result.ok) setState({ products: result.products });
  return result;
}

function restoreProduct(productId) {
  const result = restoreArchivedCatalogProduct(getState().products, productId);
  if (result.ok) setState({ products: result.products });
  return result;
}

function readPrepMinutesForOrderAction(button) {
  try {
    const field = button?.closest?.('[data-inbox-order]')?.querySelector?.('[data-prep-minutes]');
    return normalizePreparationMinutes(field?.value, DEFAULT_PREP_MINUTES);
  } catch (_) {
    return DEFAULT_PREP_MINUTES;
  }
}

function advanceOrder(orderId, options = {}) {
  const repository = getOrderRepository();
  if (!isPersistentOrderRepository(repository)) return advanceOrderStatus(orderId, options);
  const order = getState().orders.find((candidate) => candidate.id === orderId);
  const domainOrder = toDomainOrder(order);
  const nextStatus = domainOrder ? getNextWorkflowStatus(domainOrder.status, domainOrder.fulfillmentType) : null;
  if (!nextStatus) return { ok: false, message: 'Sin próxima acción para este pedido.' };

  // El tiempo estimado de preparación se elige al aceptar el pedido (paso que
  // mapea a "preparing"). Lo propagamos al repositorio —queda en el metadata del
  // evento persistente— y, como la tabla de pedidos todavía no tiene columna
  // propia, lo reflejamos en el espejo local para que el cliente vea
  // "Tiempo estimado de preparación: X min", igual que con el motivo de
  // cancelación en modo persistente.
  const isAcceptStep = toDemoOrderStatus(nextStatus) === 'preparing';
  const prepMinutes = isAcceptStep
    ? normalizePreparationMinutes(options.estimatedPreparationMinutes, DEFAULT_PREP_MINUTES)
    : null;
  const repoOptions = prepMinutes != null ? { estimatedPreparationMinutes: prepMinutes } : {};

  return Promise.resolve(repository.updateOrderStatus(orderId, nextStatus, repoOptions)).then((result) => {
    if (result?.ok && prepMinutes != null) {
      const now = new Date().toISOString();
      updateState((draft) => {
        const target = draft.orders.find((candidate) => candidate.id === orderId);
        if (!target) return;
        target.delivery = target.delivery || {};
        target.delivery.estimatedPreparationMinutes = prepMinutes;
        target.delivery.acceptedAt = target.delivery.acceptedAt || now;
        target.delivery.currentLocationLabel = `Pedido aceptado por el negocio. Preparacion estimada: ${prepMinutes} min`;
        if (target.deliveryMode === 'delivery') {
          target.delivery.estimatedMinutes = Math.max(prepMinutes, Number(target.delivery.estimatedMinutes || 0));
        }
      });
    }
    return result;
  });
}

function cancelBusinessOrder(orderId, reason = '') {
  const repository = getOrderRepository();
  if (!isPersistentOrderRepository(repository)) return cancelOrder(orderId, reason);
  // Modo persistente (opt-in): el backend cambia el estado; el motivo se
  // conserva localmente para que quede registrado/auditable en la demo.
  return Promise.resolve(repository.updateOrderStatus(orderId, 'canceled')).then((result) => {
    if (result?.ok && reason) {
      updateState((draft) => {
        const order = draft.orders.find((candidate) => candidate.id === orderId);
        if (order) order.cancelReason = reason;
      });
    }
    return result;
  });
}

// ===== Confirmación segura de cancelación/rechazo (sin window.confirm) =====

function requestOrderCancellation(orderId) {
  const order = getState().orders.find((candidate) => candidate.id === orderId);
  if (!order) return { handled: true, ok: false, message: 'Pedido no encontrado.' };
  if (isTerminalOrderStatus(order.status)) {
    return {
      handled: true,
      ok: false,
      message: order.status === 'delivered'
        ? 'Un pedido entregado no se puede cancelar.'
        : 'Este pedido ya está cerrado; no se puede cancelar de nuevo.',
    };
  }
  pendingCancelOrderId = orderId;
  openCancelModal(order);
  return { handled: true, ok: true, message: '' };
}

// Validación + cancelación efectiva. Exportada para poder testear la regla sin
// DOM (el primer tap solo abre el modal; esto es el "confirmar" real).
export function confirmOrderCancellation(orderId, reason) {
  const order = getState().orders.find((candidate) => candidate.id === orderId);
  if (!order) return { handled: true, ok: false, message: 'Pedido no encontrado.' };
  if (isTerminalOrderStatus(order.status)) {
    return { handled: true, ok: false, message: 'Este pedido ya está cerrado; no se puede cancelar.' };
  }
  const clean = sanitizeText(reason, { maxLength: 160 });
  if (!clean) return { handled: true, ok: false, message: 'Ingresá un motivo para cancelar el pedido.' };
  return actionResponse(cancelBusinessOrder(orderId, clean), `Pedido ${orderId} cancelado. Motivo: ${clean}.`);
}

// Lee el motivo del modal y confirma. Si falta motivo, no cancela y muestra la
// ayuda inline (no usa window.confirm ni cancela por un toque accidental).
function submitOrderCancellation() {
  const orderId = pendingCancelOrderId;
  if (!orderId) return { handled: true, ok: false, message: 'No hay un pedido para cancelar.' };
  const reasonField = typeof document !== 'undefined' ? document.querySelector('[data-cancel-reason]') : null;
  const reason = sanitizeText(reasonField?.value, { maxLength: 160 });
  if (!reason) {
    if (typeof document !== 'undefined') document.querySelector('[data-cancel-hint]')?.classList.remove('hidden');
    return { handled: true, ok: false, message: 'Ingresá un motivo para cancelar el pedido.' };
  }
  return finalizeCancellation(confirmOrderCancellation(orderId, reason));
}

function finalizeCancellation(result) {
  if (typeof result?.then === 'function') {
    return result.then((resolved) => {
      if (resolved.ok) closeCancelModal();
      return resolved;
    });
  }
  if (result.ok) closeCancelModal();
  return result;
}

function applyCancelReasonPreset(preset) {
  if (typeof document === 'undefined') return;
  const reasonField = document.querySelector('[data-cancel-reason]');
  if (!reasonField) return;
  reasonField.value = sanitizeText(preset, { maxLength: 160 });
  document.querySelector('[data-cancel-hint]')?.classList.add('hidden');
  reasonField.focus();
}

function openCancelModal(order) {
  if (typeof document === 'undefined') return;
  const modal = document.querySelector('[data-cancel-modal]');
  const content = modal?.querySelector('[data-cancel-content]');
  if (!modal || !content) return;
  content.innerHTML = renderCancelDialog(order);
  if (typeof modal.showModal === 'function' && !modal.open) modal.showModal();
}

function closeCancelModal() {
  pendingCancelOrderId = null;
  if (typeof document === 'undefined') return;
  const modal = document.querySelector('[data-cancel-modal]');
  if (modal?.open) modal.close();
}

function renderCancelDialog(order) {
  const onTheWay = order.status === 'on_the_way' || order.status === 'arriving';
  const presets = CANCEL_REASON_PRESETS
    .map((reason) => `<button class="ghost-button compact" type="button" data-cancel-preset="${escapeHtml(reason)}">${escapeHtml(reason)}</button>`)
    .join('');
  return `
    <div class="pin-card cancel-card ${onTheWay ? 'is-onway' : ''}" data-cancel-card>
      <h2>${onTheWay ? 'Cancelar un pedido en reparto' : 'Cancelar este pedido'}</h2>
      <p>Vas a cancelar el pedido <strong>${escapeHtml(order.id)}</strong> · ${escapeHtml(order.customerName)} · ${money(order.total)}.</p>
      ${onTheWay ? `
      <div class="warning-box cancel-onway-warning">
        <strong>Este pedido ya está en reparto.</strong> El rider está en camino y el cliente lo sigue en vivo: cancelar ahora corta la entrega.
      </div>` : ''}
      <span class="cancel-reason-label">Motivo de la cancelación</span>
      <div class="cancel-reasons">${presets}</div>
      <textarea class="cancel-reason-input" data-cancel-reason rows="2" maxlength="160" placeholder="Elegí un motivo o escribí uno propio (obligatorio)…" aria-label="Motivo de la cancelación"></textarea>
      <p class="form-hint cancel-hint hidden" data-cancel-hint>Ingresá un motivo para confirmar la cancelación.</p>
      <div class="button-row cancel-actions">
        <button class="secondary-button" type="button" data-cancel-dismiss>Volver</button>
        <button class="danger-button ${onTheWay ? 'is-strong' : ''}" type="button" data-cancel-confirm>${onTheWay ? 'Sí, cancelar el reparto' : 'Confirmar cancelación'}</button>
      </div>
    </div>`;
}

// ===== Confirmación segura de restauración del catálogo demo =====
// Igual que la cancelación de pedidos: el primer tap solo abre el modal; la
// restauración destructiva recién ocurre al confirmar.

function requestBusinessSetupReset() {
  restoreBusinessSetupDemo({ confirmed: false, updateConfig: updateBusinessConfig });
  openBusinessSetupResetModal();
  return { handled: true, ok: true, message: '' };
}

export function confirmBusinessSetupReset() {
  businessSetupFeedback = 'Configuracion demo restaurada.';
  const result = restoreBusinessSetupDemo({ confirmed: true, updateConfig: updateBusinessConfig });
  closeBusinessSetupResetModal();
  if (typeof document !== 'undefined') {
    renderBusinessDashboard();
    scrollBusinessSetup();
  }
  return result;
}

function openBusinessSetupResetModal() {
  if (typeof document === 'undefined') return;
  const modal = document.querySelector('[data-business-setup-reset-modal]');
  const content = modal?.querySelector('[data-business-setup-reset-content]');
  if (!modal || !content) return;
  content.innerHTML = renderBusinessSetupResetDialog();
  if (typeof modal.showModal === 'function' && !modal.open) modal.showModal();
}

function closeBusinessSetupResetModal() {
  if (typeof document === 'undefined') return;
  const modal = document.querySelector('[data-business-setup-reset-modal]');
  if (modal?.open) modal.close();
}

function renderBusinessSetupResetDialog() {
  return `
    <div class="pin-card cancel-card" data-business-setup-reset-card>
      <h2>Restaurar configuracion demo</h2>
      <p>Esto restaurara los datos demo del comercio. No borra pedidos ni productos.</p>
      <div class="button-row cancel-actions">
        <button class="secondary-button" type="button" data-business-setup-reset-dismiss>Cancelar</button>
        <button class="danger-button" type="button" data-business-setup-reset-confirm>Restaurar configuracion demo</button>
      </div>
    </div>`;
}

function requestCatalogReset() {
  openCatalogResetModal();
  return { handled: true, ok: true, message: '' };
}

// Exportada para poder testear la regla sin DOM: restaurar recién acá.
export function confirmCatalogReset() {
  editingCatalogProductId = null;
  setState({ products: restoreDemoCatalog(), activeCategory: 'all' });
  closeCatalogResetModal();
  return { handled: true, ok: true, message: 'Catalogo demo restaurado.' };
}

function openCatalogResetModal() {
  if (typeof document === 'undefined') return;
  const modal = document.querySelector('[data-catalog-reset-modal]');
  const content = modal?.querySelector('[data-catalog-reset-content]');
  if (!modal || !content) return;
  content.innerHTML = renderCatalogResetDialog();
  if (typeof modal.showModal === 'function' && !modal.open) modal.showModal();
}

function closeCatalogResetModal() {
  if (typeof document === 'undefined') return;
  const modal = document.querySelector('[data-catalog-reset-modal]');
  if (modal?.open) modal.close();
}

function renderCatalogResetDialog() {
  return `
    <div class="pin-card cancel-card" data-catalog-reset-card>
      <h2>Restaurar catalogo demo</h2>
      <p>Esto reemplazará el catálogo actual por el catálogo demo. Los productos cargados se perderán en esta demo.</p>
      <div class="button-row cancel-actions">
        <button class="secondary-button" type="button" data-catalog-reset-dismiss>Cancelar</button>
        <button class="danger-button" type="button" data-catalog-reset-confirm>Restaurar demo</button>
      </div>
    </div>`;
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
  const result = toggleCatalogProductAvailability(getState().products, productId);
  if (result.ok) setState({ products: result.products });
  return result.ok;
}

function copyTicketText(text) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
    }
  } catch (_) { /* clipboard no disponible: no romper */ }
}

async function copyBusinessReportSummary() {
  const report = buildBusinessReport(getState().orders, { period: businessReportPeriod });
  const text = formatBusinessReportSummary(report, { businessName: getBusinessConfig().businessName });
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      throw new Error('clipboard unavailable');
    }
    await navigator.clipboard.writeText(text);
    businessReportCopyFallback = '';
    if (typeof document !== 'undefined') renderBusinessDashboard();
    return { handled: true, ok: true, message: 'Resumen copiado al portapapeles.' };
  } catch (_) {
    businessReportCopyFallback = text;
    if (typeof document !== 'undefined') renderBusinessDashboard();
    return { handled: true, ok: true, message: 'Resumen listo para copiar en pantalla.' };
  }
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
