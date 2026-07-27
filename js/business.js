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
import { buildCustomerSignals } from './core/customer-profile.js';
import { renderOrderTimeline } from './core/order-timeline.js';
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
  formatDeliveryProofTime,
  hasDeliveryProof,
} from './core/delivery-proof.js';
import {
  formatDeliveryCodeTime,
  isDeliveryCodeConfirmed,
  normalizeDeliveryCode,
} from './core/delivery-code.js';
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
import { getOrderRepository, isPersistentOrderRepository, isSandboxOrderRepository } from './repositories/repository_factory.js';
import { escapeHtml, productCode, stockPill } from './ui.js';
import {
  findPromotionConflicts,
  isPromotionActive,
  normalizePromotion,
  validatePromotionForActivation,
} from './core/promotions.js';
import { isDemoMode } from './core/app-mode.js';

let seenOrderIds = null; // se inicializa en el primer render para detectar pedidos nuevos
let soundEnabled = readSoundPref();
let audioCtx = null;
let businessOrderFilter = 'all';
let businessOrderQuery = '';
let businessReportPeriod = 'today';
let businessReportCopyFallback = '';
let businessSetupFeedback = '';
// Una sola superficie de trabajo por vez: la cola operativa es la entrada y
// métricas, reportes, caja, catálogo, configuración y guía viven en vistas
// separadas para evitar un dashboard interminable.
let businessActiveView = 'orders';
// Pedido en espera de confirmación de cancelación (el primer tap NO cancela:
// abre el modal de confirmación con motivo obligatorio).
let pendingCancelOrderId = null;
let editingCatalogProductId = null;
// El formulario de alta/edición de productos arranca cerrado: se abre con
// "Nuevo producto" o "Editar" para que el panel no sea un formulario eterno.
let catalogFormVisible = false;
// La lista de productos muestra los primeros y se expande a pedido: con 38
// productos, la versión expandida convertía el panel en un scroll interminable.
let catalogListExpanded = false;
const CATALOG_LIST_PREVIEW_COUNT = 8;
// Último producto creado/editado: se muestra primero en la lista para que el
// comercio vea de inmediato lo que acaba de tocar (aunque la lista esté plegada).
let lastTouchedCatalogProductId = null;
let promotionFormVisible = false;
let editingPromotionId = null;
let promotionFeedback = '';
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
  const operationalOrders = state.orders.filter((order) => !order.internalSeed);
  const operationalState = { ...state, orders: operationalOrders };
  const metrics = getBusinessMetrics(operationalOrders, state.products);
  const report = buildBusinessReport(operationalOrders, { period: businessReportPeriod });
  const cashboxClosures = readCashboxClosures();

  // Detección de pedidos nuevos (received) para el aviso visual + sonido.
  const receivedOrders = operationalOrders.filter((order) => order.status === 'received');
  const receivedIds = receivedOrders.map((order) => order.id);
  const isFirstRender = seenOrderIds === null;
  const freshOrders = isFirstRender ? [] : receivedIds.filter((id) => !seenOrderIds.has(id));
  seenOrderIds = new Set(receivedIds);
  if (freshOrders.length > 0) playNewOrderChime();
  const freshOrderIds = new Set(freshOrders);

  const todayLabel = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long' }).format(new Date());

  container.innerHTML = `
    <div class="business-main business-inbox-main">
      <header class="business-main business-inbox-hero-stack">
        <div class="business-queue-toolbar">
          <div>
            <strong>Hoy, ${escapeHtml(todayLabel)}</strong>
            <span>${receivedOrders.length ? `${receivedOrders.length} pedido${receivedOrders.length === 1 ? '' : 's'} nuevo${receivedOrders.length === 1 ? '' : 's'}` : 'Cola al día'}</span>
          </div>
          <button
            class="ghost-button compact sound-toggle ${soundEnabled ? 'on' : ''}"
            type="button"
            data-sound-toggle
            aria-pressed="${soundEnabled}"
            aria-label="${soundEnabled ? 'Desactivar' : 'Activar'} aviso sonoro${receivedOrders.length ? `; ${receivedOrders.length} pedido${receivedOrders.length === 1 ? '' : 's'} nuevo${receivedOrders.length === 1 ? '' : 's'}` : ''}"
          >
            <span>${soundEnabled ? 'Sonido activo' : 'Sonido'}</span>
            ${receivedOrders.length ? `<strong class="sound-count" aria-hidden="true">${receivedOrders.length}</strong>` : ''}
          </button>
        </div>
        <div class="business-stat-grid" aria-label="Cola operativa">
          <article class="stat-tile"><span>Nuevos</span><strong>${metrics.ordersByStatus.received}</strong></article>
          <article class="stat-tile tone-amber"><span>En preparación</span><strong>${metrics.ordersByStatus.preparing}</strong></article>
          <article class="stat-tile"><span>Listos</span><strong>${metrics.ordersByStatus.ready}</strong></article>
          <article class="stat-tile tone-green"><span>En camino</span><strong>${metrics.ordersByStatus.on_the_way + metrics.ordersByStatus.arriving}</strong></article>
        </div>
        <nav class="business-jump-nav" aria-label="Secciones del negocio">
          ${renderBusinessViewButton('orders', 'Pedidos')}
          ${renderBusinessViewButton('metrics', 'Métricas')}
          ${renderBusinessViewButton('reports', 'Reportes')}
          ${renderBusinessViewButton('cashbox', 'Caja')}
          ${renderBusinessViewButton('catalog', 'Catálogo')}
          ${isDemoMode() ? renderBusinessViewButton('promotions', 'Promociones') : ''}
          ${renderBusinessViewButton('setup', 'Configuración')}
          ${renderBusinessViewButton('guide', 'Guía')}
        </nav>
      </header>

      <div class="business-workspace" data-business-workspace="${escapeHtml(businessActiveView)}">
        ${renderBusinessWorkspace({
          view: businessActiveView,
          state: operationalState,
          metrics,
          report,
          cashboxClosures,
          freshOrderIds,
        })}
      </div>
    </div>
  `;
}

function renderBusinessViewButton(view, label) {
  const active = businessActiveView === view;
  const legacyAttribute = {
    orders: 'data-scroll-orders',
    reports: 'data-scroll-reports',
    catalog: 'data-scroll-catalog',
    setup: 'data-scroll-business-setup',
  }[view] || '';
  return `
    <button class="${active ? 'primary-button' : 'secondary-button'} compact" type="button"
      data-business-view="${escapeHtml(view)}" ${legacyAttribute} aria-pressed="${active}">
      ${escapeHtml(label)}
    </button>`;
}

function renderBusinessWorkspace({ view, state, metrics, report, cashboxClosures, freshOrderIds }) {
  if (view === 'metrics') {
    return `${renderDirectOrderingMetrics(metrics)}${renderBusinessOverview(state, metrics)}`;
  }
  if (view === 'reports') return renderBusinessReportsPanel(report, cashboxClosures, { mode: 'reports' });
  if (view === 'cashbox') return renderBusinessReportsPanel(report, cashboxClosures, { mode: 'cashbox' });
  if (view === 'catalog') return renderCatalogManager(state);
  if (view === 'promotions' && isDemoMode()) return renderPromotionManager(state);
  if (view === 'setup') return renderBusinessSetupPanel();
  if (view === 'guide') return renderDemoGuide();
  return renderOrderInbox(state, metrics, freshOrderIds);
}

const INBOX_GROUPS = [
  { id: 'nuevos', title: 'Pedidos nuevos', hint: 'Atención inmediata', match: (order) => order.status === 'received' },
  { id: 'preparando', title: 'En preparación', hint: 'Preparación del pedido', match: (order) => order.status === 'preparing' },
  { id: 'listos', title: 'Listos', hint: 'Para retiro o reparto', match: (order) => order.status === 'ready' },
  { id: 'reparto', title: 'En reparto', hint: 'Seguimiento del reparto', match: (order) => ['on_the_way', 'arriving'].includes(order.status) },
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
        <strong>${query ? 'No hay pedidos que coincidan' : 'Sin pedidos en la cola'}</strong>
        <p>${query ? 'Probá buscar por código, cliente o dirección.' : 'Cuando un cliente confirme una compra, va a aparecer acá para aceptarla y prepararla.'}</p>
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

// Señales comerciales del canal propio (recompra, recurrencia, entregas
// validadas). Van DESPUÉS de los pedidos: primero lo operativo, después el dato.
function renderDirectOrderingMetrics(metrics) {
  const data = metrics.directOrdering || {};
  const hasAnyOrder = Number(data.createdOrders || 0) > 0;
  if (!hasAnyOrder) {
    return `
      <section class="business-growth-strip is-empty" data-direct-ordering-metrics>
        <div>
          <span>Tu canal propio</span>
          <strong>Sin pedidos directos todavía</strong>
          <small>Cuando entren pedidos, acá vas a ver recompra, clientes recurrentes y entregas validadas.</small>
        </div>
      </section>`;
  }
  return `
    <section class="business-growth-strip" data-direct-ordering-metrics aria-label="Señales del canal propio">
      <div class="growth-metric accent"><span>Pedidos creados</span><strong>${data.createdOrders || 0}</strong></div>
      <div class="growth-metric"><span>Ticket promedio</span><strong>${money(data.averageTicket || 0)}</strong></div>
      <div class="growth-metric"><span>Clientes recurrentes</span><strong>${data.recurringCustomers || 0}</strong></div>
      <div class="growth-metric"><span>Pedidos repetidos</span><strong>${data.repeatedOrders || 0}</strong></div>
      <div class="growth-metric"><span>Entregas validadas</span><strong>${data.deliveryCodesValidated || 0}</strong></div>
    </section>`;
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
        <input data-business-order-search type="search" value="${escapeHtml(businessOrderQuery)}" placeholder="ID, cliente o dirección" autocomplete="off" />
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

// Bloque "Ventas del día" + "Productos más vendidos" (referencia visual de la
// maqueta comercial). Sólo usa datos reales de los pedidos de la demo.
function renderBusinessOverview(state, metrics) {
  const topProducts = metrics.topProducts.slice(0, 4);
  const maxQuantity = Math.max(1, ...topProducts.map((item) => item.quantity));
  const topList = topProducts.length
    ? topProducts.map((item, index) => `
      <li>
        <span class="top-product-rank">${index + 1}.</span>
        <span class="top-product-name">${escapeHtml(item.name)}</span>
        <span class="top-product-bar" aria-hidden="true"><i style="--w:${Math.max(12, Math.round((item.quantity / maxQuantity) * 100))}%"></i></span>
        <strong class="top-product-qty">${item.quantity}</strong>
      </li>`).join('')
    : '<li class="muted"><span class="top-product-name">Sin ventas todavía hoy</span></li>';

  return `
    <section class="business-overview-grid" aria-label="Resumen del turno">
      <article class="business-overview-card sales-today-card">
        <span class="overview-kicker">Ventas del turno</span>
        <strong class="sales-today-amount">${money(metrics.todayTotal)}</strong>
        <small>Entregados hoy: ${metrics.directOrdering.deliveredOrders} · Ticket promedio: ${money(metrics.directOrdering.averageTicket || 0)}</small>
      </article>
      <article class="business-overview-card top-products-card">
        <span class="overview-kicker">Más vendidos del turno</span>
        <ul class="top-products-list">${topList}</ul>
      </article>
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
  const businessOwnsNextStep = ['received', 'preparing'].includes(order.status)
    || (isPickup && order.status === 'ready');
  const primaryAction = businessOwnsNextStep ? getBusinessOrderPrimaryAction(order) : null;
  const itemsList = order.items.map((item) => `
        <li><span>${item.quantity}× ${escapeHtml(item.name)}</span><strong>${money(item.quantity * item.unitPrice)}</strong></li>`).join('');
  const itemCount = order.items.reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0), 0);
  const showTrack = order.deliveryMode === 'delivery' && ['ready', 'on_the_way', 'arriving'].includes(order.status);
  const priorityClass = options.priority ? 'is-priority' : 'is-secondary';
  const freshClass = options.fresh ? 'is-fresh' : '';
  const prepMinutes = normalizePreparationMinutes(order.delivery?.estimatedPreparationMinutes, 0);
  const customerSignals = buildCustomerSignals(
    getState().orders.filter((candidate) => !candidate.internalSeed),
    order,
  );

  return `
    <article class="inbox-order ${priorityClass} ${freshClass} accent-${statusClass(order.status)}" data-inbox-order="${escapeHtml(order.id)}">
      <div class="inbox-order-top">
        <span class="inbox-state-dot" aria-hidden="true"></span>
        <span class="status-chip ${statusClass(order.status)}">${options.priority ? 'Pedido nuevo' : escapeHtml(statusMeta.shortLabel)}</span>
        ${statusMeta.label === (options.priority ? 'Pedido nuevo' : statusMeta.shortLabel) ? '' : `<span class="inbox-status-label">${escapeHtml(statusMeta.label)}</span>`}
        <span class="inbox-time">${escapeHtml(timeAgo(order.createdAt))}</span>
      </div>

      <div class="inbox-card-layout">
        <div class="inbox-card-main">
          <strong class="inbox-id">${escapeHtml(order.id)}</strong>
          <div class="inbox-order-customer">
            <strong>${escapeHtml(order.customerName)}</strong>
            <span class="inbox-type ${isPickup ? 'pickup' : 'delivery'}">${isPickup ? 'Retiro en local' : 'Delivery'}</span>
          </div>
          <p class="inbox-status-copy">${itemCount} ${itemCount === 1 ? 'unidad' : 'unidades'} · ${money(order.total)}</p>
          ${prepMinutes > 0 && !isTerminalOrderStatus(order.status) ? `<p class="inbox-prep-summary">Preparación estimada: <strong>${prepMinutes} min</strong></p>` : ''}
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
            ${!isPickup && order.status === 'ready' ? '<button class="primary-button compact main-order-action" type="button" data-open-admin-view="rider">Abrir reparto</button>' : ''}
            ${!isPickup && ['on_the_way', 'arriving'].includes(order.status) ? `<button class="primary-button compact main-order-action" type="button" data-order-track="${escapeHtml(order.id)}">Ver seguimiento</button>` : ''}
          </div>
        </div>

        <details class="order-detail inbox-card-details">
          <summary>Ver datos y productos</summary>
          <div class="order-detail-body">
            <p class="inbox-status-copy">${escapeHtml(statusMeta.copy)}</p>
            ${renderOrderTimeline(order.status, { className: 'tight inbox-order-timeline' })}
            ${renderCustomerSignals(customerSignals)}
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
            ${renderDeliveryCodeSummary(order)}
            ${renderDeliveryProofSummary(order)}
            ${renderInboxTrackingPanel(order)}
            <div class="inbox-actions">
              ${phone ? `<a class="ghost-button compact" href="https://wa.me/${phone}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : ''}
              ${order.customerPhone ? `<a class="ghost-button compact" href="tel:${encodeURIComponent(order.customerPhone)}">Llamar</a>` : ''}
              ${showTrack ? `<button class="ghost-button compact" type="button" data-order-track="${escapeHtml(order.id)}">Ver tracking</button>` : ''}
              <button class="ghost-button compact" type="button" data-order-ticket="${escapeHtml(order.id)}">Copiar ticket</button>
              ${canBusinessCancelOrder(order) ? `<button class="ghost-button compact danger-ghost" type="button" data-order-cancel="${escapeHtml(order.id)}">Cancelar pedido</button>` : ''}
            </div>
          </div>
        </details>
      </div>
    </article>`;
}

function renderCustomerSignals(signals) {
  if (!signals) return '';
  const tone = signals.isRecurringCustomer ? 'is-recurring' : 'is-new';
  const status = signals.isRecurringCustomer ? 'Cliente recurrente' : 'Cliente nuevo';
  const previousCopy = signals.previousOrderCount === 1
    ? '1 pedido previo'
    : `${signals.previousOrderCount || 0} pedidos previos`;
  const lastCopy = signals.lastPreviousOrderLabel
    ? `<span>Último pedido ${escapeHtml(signals.lastPreviousOrderLabel)}</span>`
    : '';
  const benefit = signals.benefitAvailable
    ? '<strong class="signal-benefit">Cliente frecuente: revisar beneficio</strong>'
    : '';
  const repeated = signals.isRepeatedOrder
    ? `<span>Pedido repetido${signals.repeatedFromOrderId ? ` desde ${escapeHtml(signals.repeatedFromOrderId)}` : ''}</span>`
    : '';
  return `
    <section class="customer-signal-panel ${tone}" aria-label="Señales de cliente">
      <span class="signal-chip">${status}</span>
      <span>${previousCopy}</span>
      <span>${signals.orderCount || 0} pedidos locales</span>
      ${lastCopy}
      ${benefit}
      ${repeated}
    </section>`;
}

function renderDeliveryProofSummary(order, { compact = false } = {}) {
  if (!hasDeliveryProof(order)) return '';
  const proof = order.deliveryProof;
  const proofTime = formatDeliveryProofTime(proof);
  return `
    <section class="inbox-delivery-proof ${compact ? 'is-compact' : ''}" data-delivery-proof-summary="${escapeHtml(order.id)}">
      <span class="proof-badge">Foto de entrega</span>
      <img class="proof-thumb" src="${escapeHtml(proof.photoDataUrl)}" alt="Foto de entrega del pedido ${escapeHtml(order.id)}" data-delivery-proof-thumb />
      <div class="proof-copy">
        <strong>Comprobante tomado${proofTime ? `: ${escapeHtml(proofTime)}` : ''}</strong>
        <small>Comprobante asociado al pedido. Evitá personas, DNI o datos privados.</small>
      </div>
      <button class="ghost-button compact" type="button" data-order-proof="${escapeHtml(order.id)}">Ver foto</button>
    </section>`;
}

function renderDeliveryCodeSummary(order, { compact = false } = {}) {
  if (order.deliveryMode !== 'delivery') return '';
  const deliveryCode = normalizeDeliveryCode(order.deliveryCode);
  if (!deliveryCode) return '';
  const confirmed = isDeliveryCodeConfirmed(deliveryCode);
  // En pedidos nuevos o en preparación el código todavía no juega: mostrarlo
  // ahí es ruido arriba del botón de aceptar. Aparece desde "listo" en adelante.
  const codeIsRelevant = confirmed || ['ready', 'on_the_way', 'arriving', 'delivered'].includes(order.status);
  if (!codeIsRelevant) return '';
  const confirmedTime = formatDeliveryCodeTime(deliveryCode);
  const isTerminal = order.status === 'delivered' || order.status === 'cancelled';
  const stateLabel = confirmed ? 'Código validado' : isTerminal ? 'Código no validado' : 'Código pendiente';
  const titleLabel = confirmed ? 'Recepción validada' : isTerminal ? 'Recepción sin validar' : 'Esperando validación del repartidor';
  const copyLabel = confirmed
    ? `Confirmado${confirmedTime ? `: ${escapeHtml(confirmedTime)}` : ''}`
    : isTerminal
      ? 'El pedido terminó sin validar el código.'
      : 'El cliente ve el código en Seguimiento.';
  return `
    <section class="inbox-delivery-code ${confirmed ? 'is-confirmed' : ''} ${compact ? 'is-compact' : ''}" data-delivery-code-summary="${escapeHtml(order.id)}">
      <span class="proof-badge">${stateLabel}</span>
      <div class="proof-copy">
        <strong>${titleLabel}</strong>
        <small>${escapeHtml(copyLabel)}</small>
      </div>
    </section>`;
}

function renderPrimaryOrderAction(order, action) {
  if (!action) return '';
  const prepControl = action.requiresPrepTime
    ? `
      <label class="prep-time-field">
        <span>Tiempo de preparación</span>
        <select data-prep-minutes aria-label="Tiempo estimado de preparación">
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
  const liveGps = false;
  const title = ['on_the_way', 'arriving'].includes(order.status) ? 'Pedido en reparto' : 'Pedido listo para reparto';
  const riderName = order.delivery?.driverName && order.delivery.driverName !== 'Sin asignar'
    ? order.delivery.driverName
    : '';
  const gpsText = 'Seguimiento por estados';
  const gpsDetail = 'No se usa GPS, ETA ni ubicación en vivo.';
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
      <button class="ghost-button compact inbox-tracking-action" type="button" data-order-track="${escapeHtml(order.id)}">${escapeHtml(actionLabel)}</button>
    </section>`;
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
      ${renderDeliveryCodeSummary(order, { compact: true })}
      ${renderDeliveryProofSummary(order, { compact: true })}
    </div>`;
}

function onlyDigits(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.startsWith('54') ? digits : `549${digits}`;
}

function renderBusinessReportsPanel(report, closures = [], { mode = 'reports' } = {}) {
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
  const showReports = mode === 'reports';

  // Caja legible para un comerciante: lo principal siempre, los medios de pago
  // sin movimiento no se muestran (un "$ 0 Sin especificar" no ayuda a nadie).
  const paymentTiles = [
    { label: 'Pago a coordinar', value: report.salesByPaymentMethod.unknown, always: true },
    { label: 'Descuentos', value: report.totalDiscounts },
  ]
    .filter((tile) => tile.always || Number(tile.value) > 0)
    .map((tile) => `<div class="day-metric"><span>${escapeHtml(tile.label)}</span><strong>${money(tile.value)}</strong></div>`)
    .join('');

  return `
    <section class="business-report-card" data-business-report aria-labelledby="business-report-title">
      <header class="business-report-head">
        <div>
          <span class="catalog-admin-kicker">${showReports ? 'Reportes' : 'Caja'}</span>
          <h3 id="business-report-title">${showReports ? 'Resumen del período' : 'Caja del día'}</h3>
          <p>${showReports ? 'Resultados y señales operativas del período elegido.' : 'Cierre y control local del turno.'}</p>
        </div>
        <div class="report-period-tabs" aria-label="Filtro temporal de reportes">
          ${reportPeriodButton('today', report.period)}
          ${reportPeriodButton('last7', report.period)}
          ${reportPeriodButton('all', report.period)}
        </div>
      </header>

      <div class="business-day-strip report-strip" aria-label="Caja del día">
        <div class="day-metric accent"><span>${report.period === 'today' ? 'Ventas de hoy' : 'Ventas netas'}</span><strong>${money(report.netSales)}</strong></div>
        ${paymentTiles}
        <div class="day-metric"><span>Entregados</span><strong>${report.deliveredOrders}</strong></div>
        <div class="day-metric"><span>Cancelados</span><strong>${report.cancelledOrders}</strong></div>
        <div class="day-metric"><span>Ticket promedio</span><strong>${money(report.ticketAverage)}</strong></div>
      </div>

      <div class="business-report-grid">
        ${showReports ? `<section class="report-panel" aria-label="Resumen operativo">
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
        </section>` : `<section class="report-panel" aria-label="Cierre de caja local">
          <div class="panel-head compact"><h3>Cierre de caja</h3><span>Se guarda en este equipo</span></div>
          <div class="cashbox-actions">
            <button class="primary-button compact" type="button" data-cashbox-close>Guardar cierre del día</button>
            <button class="secondary-button compact" type="button" data-copy-business-summary>Copiar resumen</button>
          </div>
          <p class="cashbox-note">Guarda una foto de la caja del período elegido, como control rápido. No bloquea pedidos ni reemplaza tu contabilidad.</p>
          ${summaryFallback}
          ${renderCashboxHistory(closures)}
        </section>`}
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
        <small>Pago a coordinar ${money(payment.unknown)}</small>
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
    <section class="demo-guide" aria-labelledby="business-guide-title">
      <h3 id="business-guide-title">Guía operativa</h3>
      <ol class="demo-guide-steps">
        <li>El pedido entra como <strong>Nuevo</strong> y queda pendiente de aceptación.</li>
        <li>El equipo lo acepta, prepara y marca <strong>Listo</strong>.</li>
        <li>El <strong>repartidor</strong> acepta la entrega y registra salida, llegada y recepción.</li>
        <li>El cliente sigue el estado desde <strong>Seguimiento</strong>.</li>
        <li>Al marcar <strong>Entregado</strong>, la caja y las métricas se actualizan.</li>
      </ol>
      <p class="form-hint">Tip: usá “Copiar ticket” para compartir el detalle con el equipo de preparación.</p>
    </section>`;
}

export function getActiveOrders(orders = getState().orders) {
  return selectActiveOrders(orders);
}

export function getLowStockProducts(products = getState().products) {
  return selectLowStockProducts(products);
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
  const showForm = catalogFormVisible || Boolean(editingProduct);

  return `
    <section class="business-catalog-card" data-business-catalog aria-labelledby="business-catalog-title">
      <header class="business-catalog-head">
        <div>
          <span class="catalog-admin-kicker">Catálogo editable · Productos y stock</span>
          <h3 id="business-catalog-title">Productos que ve el cliente</h3>
          <p>Creás, editás, pausás o archivás productos sin tocar pedidos ya confirmados.</p>
        </div>
        <div class="catalog-admin-top-actions">
          <button class="secondary-button compact" type="button" data-catalog-new>Nuevo producto</button>
          <button class="ghost-button compact" type="button" data-catalog-reset-demo>Restaurar catálogo base</button>
        </div>
      </header>

      ${showForm ? renderCatalogForm(editingProduct) : ''}
      ${renderCatalogRows(activeProducts)}
      ${renderArchivedCatalogRows(archivedProducts)}
    </section>`;
}

function renderPromotionManager(state) {
  const promotions = Array.isArray(state.promotions) ? state.promotions : [];
  let editingPromotion = editingPromotionId
    ? promotions.find((promotion) => promotion.promoId === editingPromotionId)
    : null;
  if (editingPromotionId && !editingPromotion) {
    editingPromotionId = null;
    editingPromotion = null;
  }
  const showForm = promotionFormVisible || Boolean(editingPromotion);
  const activeCount = promotions.filter((promotion) => isPromotionActive(promotion)).length;

  return `
    <section class="business-catalog-card promotion-manager" data-promotion-manager aria-labelledby="promotion-manager-title">
      <header class="business-catalog-head">
        <div>
          <span class="catalog-admin-kicker">Promociones por SKU</span>
          <h3 id="promotion-manager-title">Promociones comerciales</h3>
          <p>Solo se publican cuando tienen precio, vigencia y aprobación humana registrados.</p>
        </div>
        <div class="catalog-admin-top-actions">
          <span class="business-promo-count">${activeCount} activa${activeCount === 1 ? '' : 's'}</span>
          <button class="secondary-button compact" type="button" data-promotion-new>Nueva promoción</button>
        </div>
      </header>
      ${promotionFeedback ? `<p class="business-setup-feedback" role="status">${escapeHtml(promotionFeedback)}</p>` : ''}
      ${showForm ? renderPromotionForm(editingPromotion, state.products) : ''}
      <div class="catalog-admin-list promotion-list" aria-label="Promociones configuradas">
        ${promotions.length ? promotions.map((promotion) => renderPromotionRow(promotion, promotions)).join('') : `
          <div class="catalog-admin-empty"><strong>No hay promociones creadas.</strong><span>Las promociones confirmadas aparecerán aquí.</span></div>`}
      </div>
    </section>`;
}

function newPromotionDraft() {
  return normalizePromotion({
    promoId: `promo-${Date.now().toString(36)}`,
    title: '',
    promotionType: 'precio_promocional',
    includedSkus: [],
    requiredQuantity: 1,
    maximumUnits: null,
    active: false,
    priority: 0,
    previewOnly: true,
    approvalStatus: 'PENDIENTE',
  });
}

function renderPromotionForm(promotion, products = []) {
  const draft = promotion || newPromotionDraft();
  const validation = validatePromotionForActivation(draft);
  const conflicts = draft.active ? findPromotionConflicts(draft, getState().promotions) : [];
  const options = (products || [])
    .filter((product) => product && !product.archived)
    .map((product) => `<option value="${escapeHtml(product.id)}" ${draft.includedSkus.includes(product.id) ? 'selected' : ''}>${escapeHtml(product.name)}</option>`)
    .join('');
  const typeOptions = [
    ['precio_promocional', 'Precio promocional'],
    ['descuento_porcentaje', 'Descuento porcentual'],
    ['pack', 'Pack'],
    ['cantidad_fija', 'Cantidad fija'],
    ['envio_gratis', 'Envío gratis'],
  ].map(([value, label]) => `<option value="${value}" ${draft.promotionType === value ? 'selected' : ''}>${label}</option>`).join('');

  return `
    <form class="catalog-admin-form promotion-admin-form" data-promotion-form novalidate>
      <div class="catalog-form-title">
        <strong>${promotion ? 'Editar promoción' : 'Nueva promoción'}</strong>
        <span>La activación exige evidencia y aprobación registradas.</span>
      </div>
      <div class="catalog-form-grid">
        <label>ID
          <input name="promoId" maxlength="80" required value="${escapeHtml(draft.promoId)}" />
        </label>
        <label>Título
          <input name="title" maxlength="80" required value="${escapeHtml(draft.title)}" placeholder="Ej.: Precio especial" />
        </label>
        <label>Tipo
          <select name="promotionType">${typeOptions}</select>
        </label>
        <label>Prioridad
          <input name="priority" type="number" min="-999" max="999" value="${draft.priority}" />
        </label>
      </div>
      <label class="catalog-description-field">Productos incluidos
        <select name="includedSkus" multiple size="5" required aria-label="Productos incluidos">${options}</select>
        <small>Usá Ctrl o ⌘ para seleccionar más de un SKU.</small>
      </label>
      <div class="catalog-form-grid">
        <label>Precio regular confirmado
          <input name="regularPrice" type="number" min="0" step="1" value="${draft.regularPrice ?? ''}" />
        </label>
        <label>Precio promocional
          <input name="promotionalPrice" type="number" min="0" step="1" value="${draft.promotionalPrice ?? ''}" />
        </label>
        <label>Descuento %
          <input name="discountPercentage" type="number" min="0" max="100" step="1" value="${draft.discountPercentage ?? ''}" />
        </label>
        <label>Cantidad requerida
          <input name="requiredQuantity" type="number" min="1" max="999" value="${draft.requiredQuantity}" />
        </label>
        <label>Máximo de unidades
          <input name="maximumUnits" type="number" min="1" max="999" value="${draft.maximumUnits ?? ''}" />
        </label>
      </div>
      <div class="catalog-form-grid">
        <label>Válida desde
          <input name="validFrom" type="date" value="${escapeHtml(draft.validFrom.slice(0, 10))}" required />
        </label>
        <label>Válida hasta
          <input name="validUntil" type="date" value="${escapeHtml(draft.validUntil.slice(0, 10))}" required />
        </label>
        <label>Aprobación
          <select name="approvalStatus">
            <option value="PENDIENTE" ${draft.approvalStatus === 'PENDIENTE' ? 'selected' : ''}>Pendiente</option>
            <option value="APROBADA" ${draft.approvalStatus === 'APROBADA' ? 'selected' : ''}>Aprobada</option>
          </select>
        </label>
        <label>Referencia de aprobación
          <input name="approvalReference" maxlength="160" value="${escapeHtml(draft.approvalReference)}" />
        </label>
      </div>
      <div class="catalog-form-grid">
        <label>Subtítulo
          <input name="subtitle" maxlength="140" value="${escapeHtml(draft.subtitle)}" />
        </label>
        <label>Imagen exacta
          <input name="imagePath" maxlength="220" value="${escapeHtml(draft.imagePath)}" placeholder="Ruta del packshot integrado" />
        </label>
      </div>
      <label class="catalog-description-field">Términos claros
        <textarea name="terms" maxlength="240" rows="2">${escapeHtml(draft.terms)}</textarea>
      </label>
      <label class="catalog-description-field">Evidencia de la promoción
        <textarea name="sourceEvidence" maxlength="240" rows="2">${escapeHtml(draft.sourceEvidence)}</textarea>
      </label>
      <label class="catalog-availability-field"><input name="active" type="checkbox" ${draft.active ? 'checked' : ''} /> Activar al guardar</label>
      ${!validation.ok && draft.active ? `<p class="form-hint catalog-form-error">${escapeHtml(validation.errors.join(' '))}</p>` : ''}
      ${conflicts.length ? `<p class="form-hint catalog-form-error">Incompatible con: ${escapeHtml(conflicts.map((item) => item.title).join(', '))}.</p>` : ''}
      <p class="form-hint catalog-form-error hidden" data-promotion-form-error></p>
      <div class="catalog-form-actions">
        <button class="primary-button compact" type="button" data-promotion-save>Guardar promoción</button>
        <button class="ghost-button compact" type="button" data-promotion-form-close>Cancelar</button>
      </div>
    </form>`;
}

function renderPromotionRow(promotion, promotions) {
  const validation = validatePromotionForActivation(promotion);
  const conflicts = promotion.active ? findPromotionConflicts(promotion, promotions) : [];
  const validUntil = promotion.validUntil ? Date.parse(`${promotion.validUntil.slice(0, 10)}T23:59:59.999`) : NaN;
  const validFrom = promotion.validFrom ? Date.parse(promotion.validFrom) : NaN;
  const now = Date.now();
  const stateLabel = Number.isFinite(validUntil) && validUntil < now
    ? 'Vencida'
    : promotion.active && validation.ok && !conflicts.length && Number.isFinite(validFrom) && validFrom > now
      ? 'Programada'
      : promotion.active && validation.ok && !conflicts.length
        ? 'Activa'
        : 'No publicada';
  const products = promotion.includedSkus.length ? promotion.includedSkus.join(', ') : 'Sin productos';
  return `
    <article class="catalog-admin-row ${stateLabel === 'Activa' ? '' : 'is-disabled'}" data-promotion-row="${escapeHtml(promotion.promoId)}">
      <div class="catalog-admin-main">
        <strong>${escapeHtml(promotion.title || promotion.promoId)}</strong>
        <span>${escapeHtml(products)} · ${escapeHtml(promotion.promotionType)}</span>
        <div class="catalog-admin-tags"><span>${escapeHtml(stateLabel)}</span><span>${escapeHtml(promotion.validFrom || 'Sin inicio')} → ${escapeHtml(promotion.validUntil || 'Sin fin')}</span></div>
      </div>
      <div class="catalog-admin-price">${promotion.promotionalPrice != null ? money(promotion.promotionalPrice) : '—'}</div>
      <div class="catalog-admin-actions">
        <button class="ghost-button compact" type="button" data-promotion-edit="${escapeHtml(promotion.promoId)}">Editar</button>
        <button class="${promotion.active ? 'secondary-button' : 'primary-button'} compact" type="button" data-promotion-toggle="${escapeHtml(promotion.promoId)}" ${!promotion.active && (!validation.ok || conflicts.length) ? 'disabled' : ''}>${promotion.active ? 'Desactivar' : 'Activar'}</button>
      </div>
    </article>`;
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
          <span class="catalog-admin-kicker">Configuración del local</span>
          <h3 id="business-setup-title">Configuración del negocio</h3>
          <p>Cambiá identidad, contacto, horarios y reglas básicas. Se guarda sólo en este dispositivo.</p>
        </div>
        <button class="ghost-button compact" type="button" data-business-setup-reset-demo>Restaurar configuración base</button>
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
                <span>Subtítulo del local</span>
                <input name="subtitle" type="text" maxlength="80" value="${escapeHtml(config.subtitle)}" />
              </label>
              <label>
                <span>Prefijo de pedido</span>
                <input name="orderPrefix" type="text" maxlength="6" required value="${escapeHtml(config.orderPrefix)}" />
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend>Contacto</legend>
            <div class="catalog-form-grid">
              <label>
                <span>Dirección</span>
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
                <span>Hora de apertura</span>
                <input name="openHour" type="number" min="0" max="24" step="1" inputmode="numeric" required value="${escapeHtml(String(config.openHour))}" />
              </label>
              <label>
                <span>Hora de cierre</span>
                <input name="closeHour" type="number" min="0" max="24" step="1" inputmode="numeric" required value="${escapeHtml(String(config.closeHour))}" />
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend>Delivery y acceso operativo</legend>
            <div class="catalog-form-grid">
              <label>
                <span>Costo de envío</span>
                <input name="deliveryFee" type="number" min="0" step="1" inputmode="numeric" required value="${escapeHtml(String(config.deliveryFee))}" />
              </label>
              <label>
                <span>Pedido mínimo para envío</span>
                <input name="minDeliveryOrder" type="number" min="0" step="1" inputmode="numeric" required value="${escapeHtml(String(config.minDeliveryOrder))}" />
              </label>
              <label>
                <span>PIN del negocio</span>
                <input name="adminPin" type="text" inputmode="numeric" minlength="4" maxlength="6" required value="${escapeHtml(config.adminPin)}" />
              </label>
            </div>
          </fieldset>

          <p class="form-hint catalog-form-error hidden" data-business-setup-error></p>
          ${feedback}
          <div class="catalog-form-actions">
            <button class="primary-button compact" type="submit" data-business-setup-save>Guardar configuración</button>
            <button class="ghost-button compact" type="button" data-business-setup-reset-demo>Restaurar configuración base</button>
          </div>
        </form>

        ${preview}
      </div>
    </section>`;
}

function renderBusinessSetupPreview(config) {
  return `
    <aside class="business-setup-preview" data-business-setup-preview aria-label="Vista previa de configuración">
      <span class="catalog-admin-kicker">Vista previa</span>
      <strong data-setup-preview="businessName">${escapeHtml(config.businessName)}</strong>
      <p data-setup-preview="subtitle">${escapeHtml(config.subtitle)}</p>
      <dl>
        <div><dt>Dirección</dt><dd data-setup-preview="address">${escapeHtml(config.address)}</dd></div>
        <div><dt>WhatsApp</dt><dd data-setup-preview="whatsappNumber">${escapeHtml(config.whatsappNumber)}</dd></div>
        <div><dt>Horarios</dt><dd data-setup-preview="openingHoursLabel">${escapeHtml(config.openingHoursLabel)}</dd></div>
        <div><dt>Costo delivery</dt><dd data-setup-preview="deliveryFee">${money(config.deliveryFee)}</dd></div>
        <div><dt>Pedido mínimo</dt><dd data-setup-preview="minDeliveryOrder">${money(config.minDeliveryOrder)}</dd></div>
        <div><dt>Prefijo</dt><dd data-setup-preview="orderPrefix">${escapeHtml(config.orderPrefix)}</dd></div>
      </dl>
    </aside>`;
}

function renderCatalogForm(product = null) {
  const isEditing = Boolean(product);
  const categoryId = product?.categoryId || 'gaseosas';
  const badge = product?.badge || '';
  const available = !product || product.available;

  return `
    <form class="catalog-admin-form" data-catalog-form novalidate>
      <input type="hidden" name="productId" value="${isEditing ? escapeHtml(product.id) : ''}" />
      <div class="catalog-form-title">
        <strong>${isEditing ? 'Editar producto' : 'Crear producto'}</strong>
        <span>${isEditing ? escapeHtml(product.name) : 'Alta rápida para la vidriera del cliente'}</span>
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
          <span>Categoría</span>
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
          <span>Descripción breve</span>
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
        <button class="ghost-button compact" type="button" data-catalog-form-close>${isEditing ? 'Cancelar edición' : 'Cancelar'}</button>
      </div>
    </form>`;
}

function renderCatalogRows(products) {
  if (!products.length) {
    return `
      <div class="catalog-admin-empty">
        <strong>No hay productos visibles.</strong>
        <p>Agregá un producto para que aparezca en el catálogo del cliente.</p>
        <button class="secondary-button compact" type="button" data-catalog-new>Crear producto</button>
      </div>`;
  }

  const touchedIndex = lastTouchedCatalogProductId
    ? products.findIndex((product) => product.id === lastTouchedCatalogProductId)
    : -1;
  const ordered = touchedIndex > 0
    ? [products[touchedIndex], ...products.slice(0, touchedIndex), ...products.slice(touchedIndex + 1)]
    : products;
  const visible = catalogListExpanded ? ordered : ordered.slice(0, CATALOG_LIST_PREVIEW_COUNT);
  const hiddenCount = ordered.length - visible.length;
  const expander = hiddenCount > 0
    ? `<button class="secondary-button compact catalog-expand" type="button" data-catalog-expand>Ver los ${products.length} productos</button>`
    : catalogListExpanded && products.length > CATALOG_LIST_PREVIEW_COUNT
      ? '<button class="ghost-button compact catalog-expand" type="button" data-catalog-collapse>Mostrar menos</button>'
      : '';

  return `
    <div class="catalog-admin-list" aria-label="Productos del catálogo">
      ${visible.map(catalogProductRow).join('')}
      ${expander}
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
          <p>${escapeHtml(product.description || 'Sin descripción')}</p>
          <div class="catalog-admin-tags">
            <span>${escapeHtml(categoryName(product.categoryId))}</span>
            ${badgeChipForRow(product)}
            ${product.available ? stockPill(product) : ''}
          </div>
        </div>
      </div>
      <div class="catalog-admin-price">
        <strong>${money(product.price)}</strong>
        <small>${product.available ? 'Visible para cliente' : 'Pausado para clientes'}</small>
      </div>
      <div class="catalog-admin-actions">
        <div class="catalog-stock-actions" aria-label="Stock de ${escapeHtml(product.name)}">
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

// Chip de etiqueta de la fila: se omite cuando repite la categoría
// (ej. etiqueta "Combo" dentro de la categoría "Combos" no aporta nada).
function badgeChipForRow(product) {
  const badge = String(product.badge || '').trim();
  if (!badge) return '';
  const category = categoryName(product.categoryId).toLowerCase();
  if (category.includes(badge.toLowerCase())) return '';
  return `<span>${escapeHtml(badge)}</span>`;
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

export function handleBusinessAction(target) {
  const viewButton = target.closest('[data-business-view]');
  if (viewButton) {
    const nextView = viewButton.dataset.businessView;
    const allowedViews = new Set(['orders', 'metrics', 'reports', 'cashbox', 'catalog', 'setup', 'guide']);
    if (isDemoMode()) allowedViews.add('promotions');
    if (!allowedViews.has(nextView)) return { handled: true, ok: false, message: 'Vista no disponible.' };
    businessActiveView = nextView;
    if (typeof document !== 'undefined') renderBusinessDashboard();
    return { handled: true, ok: true, message: '' };
  }

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
    const report = buildBusinessReport(
      getState().orders.filter((order) => !order.internalSeed),
      { period: businessReportPeriod },
    );
    const result = saveCashboxClosure(report);
    businessReportCopyFallback = '';
    if (typeof document !== 'undefined') renderBusinessDashboard();
    return {
      handled: true,
      ok: result.ok,
      message: result.ok ? 'Cierre del turno guardado en este dispositivo.' : 'No se pudo guardar el cierre.',
    };
  }

  const advanceButton = target.closest('[data-order-advance]');
  const advanceId = advanceButton?.dataset.orderAdvance;
  if (advanceId) {
    const order = getState().orders.find((candidate) => candidate.id === advanceId);
    const businessOwnsNextStep = ['received', 'preparing'].includes(order?.status)
      || (order?.deliveryMode === 'pickup' && order?.status === 'ready');
    if (!businessOwnsNextStep) {
      return {
        handled: true,
        ok: false,
        message: order?.deliveryMode === 'delivery'
          ? 'El siguiente paso corresponde al repartidor.'
          : 'Este pedido no tiene una acción operativa disponible.',
      };
    }
    return actionResponse(advanceOrder(advanceId, {
      estimatedPreparationMinutes: readPrepMinutesForOrderAction(advanceButton),
    }), 'Estado del pedido actualizado.');
  }

  const ticketId = target.closest('[data-order-ticket]')?.dataset.orderTicket;
  if (ticketId) {
    const order = getState().orders.find((candidate) => candidate.id === ticketId);
    if (!order) return { handled: true, ok: false, message: 'Pedido no encontrado.' };
    copyTicketText(buildKitchenTicket(order));
    return { handled: true, ok: true, message: 'Ticket copiado para preparación.' };
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

  const proofId = target.closest('[data-order-proof]')?.dataset.orderProof;
  if (proofId) {
    const order = getState().orders.find((candidate) => candidate.id === proofId);
    if (!order || !hasDeliveryProof(order)) return { handled: true, ok: false, message: 'Foto de entrega no disponible.' };
    openDeliveryProofModal(order);
    return { handled: true, ok: true, message: '' };
  }

  if (target.closest('[data-sound-toggle]')) {
    soundEnabled = !soundEnabled;
    writeSoundPref(soundEnabled);
    if (soundEnabled) playNewOrderChime();
    if (typeof document !== 'undefined') renderBusinessDashboard();
    return { handled: true, ok: true, message: soundEnabled ? 'Sonido de pedidos activado.' : 'Sonido de pedidos apagado.' };
  }

  // Reinicio de demo para el presentador: recarga con ?reset=1 conservando
  // relay/room para no romper una sala realtime en curso. Vive detrás del PIN.
  if (target.closest('[data-demo-reset]')) {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      params.set('reset', '1');
      window.location.href = `${window.location.pathname}?${params.toString()}`;
    }
    return { handled: true, ok: true, message: 'Reiniciando la sesión…' };
  }

  if (target.closest('[data-scroll-orders]')) {
    businessActiveView = 'orders';
    if (typeof document !== 'undefined') renderBusinessDashboard();
    return { handled: true, ok: true, message: '' };
  }

  if (target.closest('[data-scroll-reports]')) {
    businessActiveView = 'reports';
    if (typeof document !== 'undefined') renderBusinessDashboard();
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

  if (target.closest('[data-promotion-new]')) {
    editingPromotionId = null;
    promotionFormVisible = true;
    promotionFeedback = '';
    if (typeof document !== 'undefined') {
      businessActiveView = 'promotions';
      renderBusinessDashboard();
      setTimeout(() => document.querySelector('[data-promotion-form] [name="title"]')?.focus(), 0);
    }
    return { handled: true, ok: true, message: '' };
  }

  const promotionEditId = target.closest('[data-promotion-edit]')?.dataset.promotionEdit;
  if (promotionEditId) {
    editingPromotionId = promotionEditId;
    promotionFormVisible = true;
    promotionFeedback = '';
    if (typeof document !== 'undefined') renderBusinessDashboard();
    return { handled: true, ok: true, message: '' };
  }

  if (target.closest('[data-promotion-form-close]')) {
    editingPromotionId = null;
    promotionFormVisible = false;
    promotionFeedback = '';
    if (typeof document !== 'undefined') renderBusinessDashboard();
    return { handled: true, ok: true, message: '' };
  }

  if (target.closest('[data-promotion-save]')) {
    return savePromotionFromForm();
  }

  const promotionToggleId = target.closest('[data-promotion-toggle]')?.dataset.promotionToggle;
  if (promotionToggleId) {
    return togglePromotion(promotionToggleId);
  }

  if (target.closest('[data-catalog-new]')) {
    editingCatalogProductId = null;
    catalogFormVisible = true;
    if (typeof document !== 'undefined') {
      renderBusinessDashboard();
      scrollCatalogManager();
      setTimeout(() => document.querySelector('[data-catalog-form] [name="name"]')?.focus(), 0);
    }
    return { handled: true, ok: true, message: '' };
  }

  if (target.closest('[data-catalog-form-close]')) {
    editingCatalogProductId = null;
    catalogFormVisible = false;
    if (typeof document !== 'undefined') renderBusinessDashboard();
    return { handled: true, ok: true, message: '' };
  }

  if (target.closest('[data-catalog-expand]')) {
    catalogListExpanded = true;
    if (typeof document !== 'undefined') renderBusinessDashboard();
    return { handled: true, ok: true, message: '' };
  }

  if (target.closest('[data-catalog-collapse]')) {
    catalogListExpanded = false;
    if (typeof document !== 'undefined') {
      renderBusinessDashboard();
      scrollCatalogManager();
    }
    return { handled: true, ok: true, message: '' };
  }

  const editId = target.closest('[data-product-edit]')?.dataset.productEdit;
  if (editId) {
    editingCatalogProductId = editId;
    catalogFormVisible = true;
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

export function submitBusinessSetupForm() {
  return saveBusinessSetupFromForm();
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
  catalogFormVisible = false;
  lastTouchedCatalogProductId = result.product?.id || null;
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

function readPromotionForm(form) {
  const formData = new FormData(form);
  return {
    promoId: formData.get('promoId'),
    title: formData.get('title'),
    subtitle: formData.get('subtitle'),
    includedSkus: formData.getAll('includedSkus'),
    promotionType: formData.get('promotionType'),
    regularPrice: formData.get('regularPrice'),
    promotionalPrice: formData.get('promotionalPrice'),
    discountPercentage: formData.get('discountPercentage'),
    requiredQuantity: formData.get('requiredQuantity'),
    maximumUnits: formData.get('maximumUnits'),
    validFrom: formData.get('validFrom'),
    validUntil: formData.get('validUntil'),
    active: formData.get('active') === 'on',
    priority: formData.get('priority'),
    imagePath: formData.get('imagePath'),
    terms: formData.get('terms'),
    previewOnly: true,
    approvalStatus: formData.get('approvalStatus'),
    approvalReference: formData.get('approvalReference'),
    sourceEvidence: formData.get('sourceEvidence'),
  };
}

function savePromotionFromForm() {
  if (!isDemoMode()) return { handled: true, ok: false, message: 'Promociones disponibles solo en sandbox.' };
  const form = typeof document !== 'undefined' ? document.querySelector('[data-promotion-form]') : null;
  if (!form) return { handled: true, ok: false, message: 'Formulario no disponible.' };
  const promotion = normalizePromotion(readPromotionForm(form));
  const validation = validatePromotionForActivation(promotion);
  const existing = getState().promotions || [];
  const conflicts = promotion.active ? findPromotionConflicts(promotion, existing) : [];
  if (promotion.active && (!validation.ok || conflicts.length)) {
    const message = conflicts.length
      ? `No se puede activar: se superpone con ${conflicts.map((item) => item.title).join(', ')}.`
      : validation.errors.join(' ');
    setPromotionFormError(message);
    return { handled: true, ok: false, message };
  }

  const promotions = [
    ...existing.filter((item) => item.promoId !== promotion.promoId),
    promotion,
  ];
  editingPromotionId = null;
  promotionFormVisible = false;
  promotionFeedback = promotion.active ? 'Promoción activada.' : 'Promoción guardada sin publicar.';
  setState({ promotions });
  return { handled: true, ok: true, message: promotionFeedback };
}

function togglePromotion(promoId) {
  if (!isDemoMode()) return { handled: true, ok: false, message: 'Promociones disponibles solo en sandbox.' };
  const existing = getState().promotions || [];
  const current = existing.find((item) => item.promoId === promoId);
  if (!current) return { handled: true, ok: false, message: 'Promoción no encontrada.' };
  const next = normalizePromotion({ ...current, active: !current.active });
  const validation = validatePromotionForActivation(next);
  const conflicts = next.active ? findPromotionConflicts(next, existing) : [];
  if (next.active && (!validation.ok || conflicts.length)) {
    promotionFeedback = conflicts.length
      ? `No se activó: se superpone con ${conflicts.map((item) => item.title).join(', ')}.`
      : validation.errors.join(' ');
    if (typeof document !== 'undefined') renderBusinessDashboard();
    return { handled: true, ok: false, message: promotionFeedback };
  }
  promotionFeedback = next.active ? 'Promoción activada.' : 'Promoción desactivada.';
  setState({ promotions: existing.map((item) => (item.promoId === promoId ? next : item)) });
  return { handled: true, ok: true, message: promotionFeedback };
}

function setPromotionFormError(message) {
  if (typeof document === 'undefined') return;
  const error = document.querySelector('[data-promotion-form-error]');
  if (!error) return;
  error.textContent = message;
  error.classList.remove('hidden');
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

  businessSetupFeedback = 'Configuración guardada.';
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
  businessActiveView = 'catalog';
  if (typeof document === 'undefined') return;
  if (!document.querySelector('[data-business-catalog]')) renderBusinessDashboard();
  document.querySelector('[data-business-catalog]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function scrollBusinessSetup() {
  businessActiveView = 'setup';
  if (typeof document === 'undefined') return;
  if (!document.querySelector('[data-business-setup]')) renderBusinessDashboard();
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
  if (!isPersistentOrderRepository(repository) && !isSandboxOrderRepository(repository)) return advanceOrderStatus(orderId, options);
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
        target.delivery.currentLocationLabel = `Pedido aceptado por el negocio. Preparación estimada: ${prepMinutes} min`;
      });
    }
    return result;
  });
}

function cancelBusinessOrder(orderId, reason = '') {
  const repository = getOrderRepository();
  if (!isPersistentOrderRepository(repository) && !isSandboxOrderRepository(repository)) return cancelOrder(orderId, reason);
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
        <strong>Este pedido ya está en reparto.</strong> Cancelar ahora corta la entrega en curso.
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
  businessSetupFeedback = 'Configuración base restaurada.';
  const result = restoreBusinessSetupDemo({ confirmed: true, updateConfig: updateBusinessConfig });
  closeBusinessSetupResetModal();
  if (typeof document !== 'undefined') {
    renderBusinessDashboard();
    scrollBusinessSetup();
  }
  return { ...result, message: result.ok ? 'Configuración base restaurada.' : result.message };
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
      <h2>Restaurar configuración base</h2>
      <p>Esto restaurará la configuración base del comercio. No borra pedidos, productos, carrito, historial de clientes ni cierres de caja.</p>
      <div class="button-row cancel-actions">
        <button class="secondary-button" type="button" data-business-setup-reset-dismiss>Cancelar</button>
        <button class="danger-button" type="button" data-business-setup-reset-confirm>Restaurar configuración base</button>
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
  catalogFormVisible = false;
  lastTouchedCatalogProductId = null;
  setState({ products: restoreDemoCatalog(), activeCategory: 'all' });
  closeCatalogResetModal();
  return { handled: true, ok: true, message: 'Catálogo base restaurado.' };
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
      <h2>Restaurar catálogo base</h2>
      <p>Esto reemplazará el catálogo actual por el catálogo base. Los productos cargados localmente se perderán.</p>
      <div class="button-row cancel-actions">
        <button class="secondary-button" type="button" data-catalog-reset-dismiss>Cancelar</button>
        <button class="danger-button" type="button" data-catalog-reset-confirm>Restaurar catálogo base</button>
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
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;
    const write = navigator.clipboard.writeText(text);
    if (write?.catch) write.catch(() => {});
  } catch (_) { /* clipboard no disponible: no romper */ }
}

async function copyBusinessReportSummary() {
  const report = buildBusinessReport(
    getState().orders.filter((order) => !order.internalSeed),
    { period: businessReportPeriod },
  );
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

function openDeliveryProofModal(order) {
  if (typeof document === 'undefined' || !hasDeliveryProof(order)) return;
  const modal = document.querySelector('[data-product-modal]');
  const content = document.querySelector('[data-modal-content]');
  if (!modal || !content) return;
  const proof = order.deliveryProof;
  const proofTime = formatDeliveryProofTime(proof);
  content.innerHTML = `
    <div class="modal-card delivery-proof-modal" data-delivery-proof-modal>
      <span class="proof-badge">Foto de entrega</span>
      <h2>Comprobante ${escapeHtml(order.id)}</h2>
      <p>Comprobante tomado${proofTime ? `: ${escapeHtml(proofTime)}` : ''}. Evidencia asociada a este pedido.</p>
      <img class="proof-modal-image" src="${escapeHtml(proof.photoDataUrl)}" alt="Foto de entrega del pedido ${escapeHtml(order.id)}" data-delivery-proof-modal-image />
      <p class="form-hint">Evitá fotografiar personas, DNI o datos privados. Esta foto no se sube a un backend en v1.</p>
      <div class="button-row" style="margin-top:16px">
        <button class="secondary-button" type="button" data-close-modal>Cerrar</button>
      </div>
    </div>`;
  if (typeof modal.showModal === 'function' && !modal.open) modal.showModal();
}
