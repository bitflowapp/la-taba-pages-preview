import { APP_MODE_PRODUCTION, getAppMode } from './core/app-mode.js';
import { getBusinessConfig } from './core/business-config-store.js';
import { normalizeWorkflowStatus } from './core/order-workflow.js';
import {
  buildExternalNavigationUrl,
  buildRiderMapContext,
  clearRiderMapContexts,
  formatRiderDeliveryAddress,
  retainRiderMapContexts,
  riderDistanceAndEtaLabel,
  setRiderMapContext,
  shortOrderLabel,
} from './map/rider_operational_map.js';
import { createProductionRiderGpsController } from './tracking/production_rider_gps.js';
import { getOrderRepository } from './repositories/repository_factory.js';
import { renderWithStableRealMap } from './ui.js';
import {
  dateTime,
  getState,
  statusLabel,
  updateState,
} from './state.js';

const BUSINESS_ROLES = new Set(['owner', 'admin', 'staff']);
const TERMINAL_STATUSES = new Set(['delivered', 'canceled', 'cancelled']);

let initialized = false;
let repository = null;
let auth = null;
let authStop = null;
let notify = () => {};
let refreshSequence = 0;
let availableRiderOrders = [];
let activeBusinessRiders = [];
let gpsController = null;
const pendingRiderActions = new Set();
let access = {
  status: 'signed_out',
  user: null,
  membership: null,
  message: '',
};
let gpsShare = emptyGpsShare();

export function initProductionOperations({ onChange = () => {} } = {}) {
  notify = typeof onChange === 'function' ? onChange : () => {};
  if (getAppMode() !== APP_MODE_PRODUCTION || initialized) return;
  initialized = true;
  repository = getOrderRepository();
  auth = repository?.auth || null;
  configureGpsController();

  if (!auth) {
    access = {
      status: 'error',
      user: null,
      membership: null,
      message: 'La autenticación productiva no está disponible.',
    };
    notify();
    return;
  }

  authStop = auth.onAuthStateChange(() => {
    refreshProductionAccess();
  });
  refreshProductionAccess();
}

export function renderProductionOperations() {
  if (typeof document === 'undefined' || getAppMode() !== APP_MODE_PRODUCTION) return;
  gpsController?.reconcile();
  renderAccessSurface('business');
  renderAccessSurface('rider');
}

export async function handleProductionAuthSubmit(form) {
  if (
    getAppMode() !== APP_MODE_PRODUCTION
    || !form?.matches?.('[data-production-auth-form]')
  ) {
    return { handled: false };
  }
  if (!auth?.signInTeam) {
    const message = 'La autenticación productiva no está disponible.';
    access = {
      status: 'error',
      user: null,
      membership: null,
      message,
    };
    notify();
    return { handled: true, ok: false, message };
  }

  const view = form.dataset.productionAuthForm;
  const formData = new FormData(form);
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '');
  access = {
    status: 'checking',
    user: null,
    membership: null,
    message: 'Verificando acceso…',
  };
  notify();

  const result = await auth.signInTeam({ email, password });
  if (!result.ok) {
    access = {
      status: 'signed_out',
      user: null,
      membership: null,
      message: result.message,
    };
    notify();
    return { handled: true, ok: false, message: result.message };
  }

  if (!isRoleAuthorizedForView(result.membership?.role, view)) {
    await auth.signOut();
    const message = view === 'rider'
      ? 'Esta cuenta no tiene rol de rider.'
      : 'Esta cuenta no tiene rol de owner, administrador o empleado.';
    access = {
      status: 'signed_out',
      user: null,
      membership: null,
      message,
    };
    notify();
    return { handled: true, ok: false, message };
  }

  form.reset();
  await activateAuthorizedAccess(result);
  return { handled: true, ok: true, message: 'Acceso seguro iniciado.' };
}

export async function handleProductionOperationsAction(target) {
  if (getAppMode() !== APP_MODE_PRODUCTION || !target?.closest) {
    return { handled: false };
  }

  if (target.closest('[data-production-sign-out]')) {
    stopGpsShare();
    repository?.stopSync?.();
    const result = await auth.signOut();
    clearProductionOrders();
    access = {
      status: 'signed_out',
      user: null,
      membership: null,
      message: result.ok ? 'Sesión cerrada.' : result.message,
    };
    repository?.startSync?.();
    notify();
    return { handled: true, ok: result.ok, message: access.message };
  }

  const businessNext = target.closest('[data-production-business-next]');
  if (businessNext) {
    const guard = requireViewAccess('business');
    if (!guard.ok) return { handled: true, ...guard };
    return updateOrderFromAction(
      businessNext.dataset.productionBusinessNext,
      businessNext.dataset.nextStatus,
    );
  }

  const businessAssign = target.closest('[data-production-business-assign]');
  if (businessAssign) {
    const guard = requireViewAccess('business');
    if (!guard.ok) return { handled: true, ...guard };
    const orderId = businessAssign.dataset.productionBusinessAssign;
    const order = getState().orders.find((candidate) => (
      candidate.id === orderId
      || candidate.backendId === orderId
      || candidate.code === orderId
    ));
    const current = workflowStatus(order);
    if (!canAssignBusinessRider(order)) {
      return {
        handled: true,
        ok: false,
        message: 'Este pedido ya no admite asignación de rider.',
      };
    }
    const card = businessAssign.closest('.production-order-card');
    const riderId = card?.querySelector('[data-production-rider-select]')?.value || '';
    const result = await repository.assignRider(
      order.backendId || order.id,
      riderId,
      {
        expectedStatus: current,
        expectedRiderId: order.assignedRiderId || null,
      },
    );
    if (result.ok) await repository.listOrders();
    notify();
    return {
      handled: true,
      ok: result.ok,
      message: result.message,
    };
  }

  const businessCancel = target.closest('[data-production-business-cancel]');
  if (businessCancel) {
    const guard = requireViewAccess('business');
    if (!guard.ok) return { handled: true, ...guard };
    const confirmed = typeof globalThis.confirm === 'function'
      && globalThis.confirm('¿Confirmás la cancelación de este pedido?');
    if (!confirmed) {
      return { handled: true, ok: false, message: 'Cancelación no realizada.' };
    }
    return updateOrderFromAction(
      businessCancel.dataset.productionBusinessCancel,
      'canceled',
    );
  }

  const riderNext = target.closest('[data-production-rider-next]');
  if (riderNext) {
    const guard = requireViewAccess('rider');
    if (!guard.ok) return { handled: true, ...guard };
    const orderId = riderNext.dataset.productionRiderNext;
    const nextStatus = riderNext.dataset.nextStatus;
    return runRiderActionOnce(
      `status:${orderId}:${nextStatus}`,
      riderNext,
      async () => {
        const result = await updateOrderFromAction(orderId, nextStatus);
        if (result.ok && nextStatus === 'delivered') stopGpsShare();
        return result;
      },
    );
  }

  const riderConfirm = target.closest('[data-production-rider-confirm]');
  if (riderConfirm) {
    const guard = requireViewAccess('rider');
    if (!guard.ok) return { handled: true, ...guard };
    const orderId = riderConfirm.dataset.productionRiderConfirm;
    const container = riderConfirm.closest('[data-rider-operational-order], .production-order-card');
    const code = container?.querySelector('[data-production-delivery-code]')?.value || '';
    return runRiderActionOnce(`confirm:${orderId}`, riderConfirm, async () => {
      const result = await repository.confirmDelivery(orderId, code, {
        expectedStatus: 'arrived',
      });
      if (result.ok) {
        stopGpsShare();
        await refreshRiderOrders();
      }
      notify();
      return {
        handled: true,
        ok: result.ok,
        message: result.message,
      };
    });
  }

  const riderClaim = target.closest('[data-production-rider-claim]');
  if (riderClaim) {
    const guard = requireViewAccess('rider');
    if (!guard.ok) return { handled: true, ...guard };
    const result = await repository.claimRiderOrder(
      riderClaim.dataset.productionRiderClaim,
      {
        expectedStatus: riderClaim.dataset.expectedStatus || 'ready',
        expectedRiderId: null,
      },
    );
    if (result.ok) await refreshRiderOrders();
    notify();
    return {
      handled: true,
      ok: result.ok,
      message: result.ok ? 'Entrega asignada a tu cuenta.' : result.message,
    };
  }

  const gpsStart = target.closest('[data-production-gps-start]');
  if (gpsStart) {
    const guard = requireViewAccess('rider');
    if (!guard.ok) return { handled: true, ...guard };
    return startGpsShare(gpsStart.dataset.productionGpsStart);
  }

  if (target.closest('[data-production-gps-stop]')) {
    const guard = requireViewAccess('rider');
    if (!guard.ok) return { handled: true, ...guard };
    stopGpsShare();
    notify();
    return { handled: true, ok: true, message: 'Ubicación GPS detenida.' };
  }

  return { handled: false };
}

export function isRoleAuthorizedForView(role, view) {
  if (view === 'business') return BUSINESS_ROLES.has(String(role || ''));
  if (view === 'rider') return role === 'rider';
  return false;
}

export function nextBusinessStatus(order = {}) {
  const current = workflowStatus(order);
  if (current === 'submitted') return 'accepted';
  if (current === 'accepted') return 'preparing';
  if (current === 'preparing') return 'ready';
  if (current === 'ready' && order.deliveryMode === 'pickup') return 'delivered';
  return null;
}

export function nextRiderStatus(order = {}) {
  const current = workflowStatus(order);
  if (current === 'ready' || current === 'assigned' || current === 'picked_up') return 'on_the_way';
  if (current === 'on_the_way') return 'arrived';
  if (current === 'arrived') return 'delivered';
  return null;
}

export function canAssignBusinessRider(order = {}) {
  return order.deliveryMode === 'delivery'
    && ['ready', 'assigned'].includes(workflowStatus(order));
}

// El permiso de geolocalización no implica compartir fuera de la superficie
// operativa del rider. Este corte es idempotente y lo invoca app.js tanto al
// abandonar #rider como cuando la página deja de existir.
export function handleProductionOperationsViewChange(view) {
  if (String(view || '') === 'rider') return false;
  return stopGpsShare();
}

export function handleProductionOperationsPageHide() {
  return stopGpsShare();
}

export function resetProductionOperationsForTests() {
  gpsController?.destroy();
  gpsController = null;
  authStop?.();
  authStop = null;
  initialized = false;
  repository = null;
  auth = null;
  notify = () => {};
  refreshSequence = 0;
  availableRiderOrders = [];
  activeBusinessRiders = [];
  pendingRiderActions.clear();
  clearRiderMapContexts();
  gpsShare = emptyGpsShare();
  access = {
    status: 'signed_out',
    user: null,
    membership: null,
    message: '',
  };
}

async function refreshProductionAccess() {
  if (!auth) return;
  const sequence = ++refreshSequence;
  access = {
    status: 'checking',
    user: null,
    membership: null,
    message: 'Verificando sesión…',
  };
  notify();

  const result = await auth.getTeamAccess();
  if (sequence !== refreshSequence) return;
  if (!result.ok) {
    stopGpsShare();
    // El cliente productivo usa una sesión Auth anónima válida para ser dueño
    // de su pedido. Ese evento no es un cierre de sesión del equipo y no debe
    // borrar el pedido recién espejado en memoria.
    if (!result.customerSession) clearProductionOrders();
    access = {
      status: 'signed_out',
      user: null,
      membership: null,
      message: '',
    };
    notify();
    return;
  }
  await activateAuthorizedAccess(result, sequence);
}

function clearProductionOrders() {
  availableRiderOrders = [];
  activeBusinessRiders = [];
  clearRiderMapContexts();
  updateState((draft) => {
    draft.orders = [];
    draft.lastOrderId = null;
    draft.simulation = null;
  });
}

async function activateAuthorizedAccess(result, expectedSequence = null) {
  const sequence = expectedSequence ?? ++refreshSequence;
  repository?.stopSync?.();
  repository?.startSync?.();
  if (result.membership?.role === 'rider') {
    activeBusinessRiders = [];
    await refreshRiderOrders();
  } else {
    availableRiderOrders = [];
    const [, ridersResult] = await Promise.all([
      repository.listOrders(),
      repository.listActiveRiders(),
    ]);
    activeBusinessRiders = ridersResult?.ok && Array.isArray(ridersResult.riders)
      ? ridersResult.riders
      : [];
  }
  if (expectedSequence !== null && sequence !== refreshSequence) return;
  access = {
    status: 'authenticated',
    user: result.user,
    membership: result.membership,
    message: '',
  };
  notify();
}

function renderAccessSurface(view) {
  const card = document.querySelector(`[data-production-auth-card="${view}"]`);
  const workspace = document.querySelector(`[data-production-workspace="${view}"]`);
  if (!card || !workspace) return;

  const authorized = access.status === 'authenticated'
    && isRoleAuthorizedForView(access.membership?.role, view);
  card.hidden = authorized;
  card.setAttribute('aria-hidden', String(authorized));
  workspace.hidden = !authorized;
  workspace.setAttribute('aria-hidden', String(!authorized));

  const form = card.querySelector('[data-production-auth-form]');
  const button = form?.querySelector('[type="submit"]');
  if (button) button.disabled = ['checking', 'error'].includes(access.status);
  const message = card.querySelector('[data-production-auth-message]');
  if (message) {
    const wrongRole = access.status === 'authenticated' && !authorized;
    message.textContent = wrongRole
      ? roleMismatchMessage(access.membership?.role, view)
      : access.message;
    message.hidden = !message.textContent;
  }

  if (!authorized) {
    if (view === 'rider') clearRiderMapContexts();
    workspace.replaceChildren();
    return;
  }
  if (view === 'business') {
    workspace.innerHTML = businessWorkspaceMarkup();
    return;
  }
  const primaryOrder = selectPrimaryRiderOrder(riderOperationalOrders());
  renderWithStableRealMap(workspace, riderWorkspaceMarkup(), {
    rolePrefix: 'rider',
    orderId: primaryOrder?.id || '',
  });
}

function businessWorkspaceMarkup() {
  const orders = getState().orders;
  const rows = orders.length
    ? orders.map(businessOrderMarkup).join('')
    : emptyMarkup('Todavía no hay pedidos visibles para este comercio.');
  return `
    <div class="production-ops-head">
      <div>
        <p class="eyebrow">Operación segura</p>
        <h1>Pedidos del negocio</h1>
        <p>${escapeHtml(roleLabel(access.membership?.role))} · sesión verificada</p>
      </div>
      <button class="ghost-button compact" type="button" data-production-sign-out>Cerrar sesión</button>
    </div>
    <div class="production-order-list" aria-live="polite">${rows}</div>
  `;
}

function businessOrderMarkup(order) {
  const next = nextBusinessStatus(order);
  const current = workflowStatus(order);
  const terminal = TERMINAL_STATUSES.has(current);
  const itemCount = (order.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const items = (order.items || []).map((item) => `
    <li>
      <strong>${escapeHtml(String(item.quantity || 0))} × ${escapeHtml(item.name || 'Producto')}</strong>
      ${item.unit ? `<span>${escapeHtml(item.unit)}</span>` : ''}
    </li>
  `).join('');
  const canAssignRider = canAssignBusinessRider(order);
  const riderOptions = activeBusinessRiders.map((rider) => `
    <option
      value="${escapeAttribute(rider.id)}"
      ${rider.id === order.assignedRiderId ? 'selected' : ''}
    >${escapeHtml(rider.displayName)}</option>
  `).join('');
  return `
    <article class="production-order-card">
      <div class="production-order-head">
        <div>
          <span class="production-order-code">${escapeHtml(order.id)}</span>
          <strong>${escapeHtml(order.customerName)}</strong>
        </div>
        <span class="status-pill ${escapeHtml(order.status)}">${escapeHtml(statusLabel(order.status))}</span>
      </div>
      <dl class="production-order-meta">
        <div><dt>Hora</dt><dd>${escapeHtml(dateTime(order.createdAt))}</dd></div>
        <div><dt>Entrega</dt><dd>${order.deliveryMode === 'pickup' ? 'Retiro' : 'Delivery'}</dd></div>
        <div><dt>Productos</dt><dd>${itemCount}</dd></div>
        <div><dt>Total</dt><dd>${escapeHtml(formatOrderMoney(order.total, order.currencyCode))}</dd></div>
      </dl>
      <ul class="production-order-items" aria-label="Detalle de productos">${items}</ul>
      <dl class="production-order-contact">
        <div><dt>Teléfono</dt><dd>${escapeHtml(order.customerPhone || 'No informado')}</dd></div>
        <div><dt>Pago</dt><dd>${escapeHtml(order.paymentMethod || 'No informado')}</dd></div>
      </dl>
      <p class="production-order-address">${escapeHtml(order.address || 'Sin dirección publicada')}</p>
      ${order.addressDetails?.reference
        ? `<p class="form-hint">Referencia: ${escapeHtml(order.addressDetails.reference)}</p>`
        : ''}
      ${order.notes
        ? `<p class="production-order-notes"><strong>Observaciones:</strong> ${escapeHtml(order.notes)}</p>`
        : ''}
      <div class="button-row">
        ${next ? `
          <button
            class="primary-button compact"
            type="button"
            data-production-business-next="${escapeAttribute(order.id)}"
            data-next-status="${escapeAttribute(next)}"
          >${escapeHtml(actionLabel(next, 'business'))}</button>
        ` : ''}
        ${!terminal ? `
          <button
            class="ghost-button compact"
            type="button"
            data-production-business-cancel="${escapeAttribute(order.id)}"
          >Cancelar</button>
        ` : ''}
      </div>
      ${canAssignRider ? `
        <div class="production-rider-assignment">
          ${riderOptions ? `
            <label>
              <span>${current === 'assigned' ? 'Reasignar rider' : 'Asignar rider'}</span>
              <select data-production-rider-select>
                ${riderOptions}
              </select>
            </label>
            <button
              class="secondary-button compact"
              type="button"
              data-production-business-assign="${escapeAttribute(order.id)}"
            >${current === 'assigned' ? 'Reasignar' : 'Asignar'}</button>
          ` : '<p class="form-hint">No hay riders activos habilitados para asignar.</p>'}
        </div>
      ` : ''}
    </article>
  `;
}

function riderWorkspaceMarkup() {
  const orders = riderOperationalOrders();
  const primaryOrder = selectPrimaryRiderOrder(orders);
  const secondaryOrders = primaryOrder
    ? orders.filter((order) => order.id !== primaryOrder.id)
    : [];
  const queue = availableRiderOrders.map(availableRiderOrderMarkup).join('');
  let activeMarkup = '';
  if (primaryOrder) {
    const localLocation = gpsShare.orderId === primaryOrder.id
      ? gpsShare.lastAcceptedFix || gpsShare.lastPublishedFix
      : null;
    const context = setRiderMapContext(
      primaryOrder.id,
      buildRiderMapContext(primaryOrder, {
        businessConfig: getBusinessConfig(),
        localLocation,
      }),
    );
    retainRiderMapContexts([primaryOrder.id]);
    activeMarkup = riderOperationalOrderMarkup(primaryOrder, context);
  } else {
    retainRiderMapContexts([]);
  }

  return `
    <div class="production-rider-workspace ${primaryOrder ? 'has-active-map' : ''}">
      ${activeMarkup}
      ${secondaryOrders.length ? `
        <section class="production-rider-section rider-secondary-orders" aria-labelledby="production-rider-secondary-title">
          <div class="panel-head"><h3 id="production-rider-secondary-title">Otras entregas asignadas</h3></div>
          <div class="production-order-list">${secondaryOrders.map(riderCompactOrderMarkup).join('')}</div>
        </section>` : ''}
    ${queue ? `
      <section class="production-rider-section" aria-labelledby="production-rider-queue-title">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Para tomar</p>
            <h3 id="production-rider-queue-title">Pedidos listos</h3>
          </div>
          <span class="mini-badge">${availableRiderOrders.length}</span>
        </div>
        <div class="production-order-list">${queue}</div>
      </section>` : ''}
    ${!primaryOrder && !queue ? `
      <div class="production-ops-head">
        <div>
          <p class="eyebrow">Rider autenticado</p>
          <h1>Mis entregas</h1>
          <p>No hay entregas disponibles o asignadas a esta cuenta.</p>
        </div>
        <button class="ghost-button compact" type="button" data-production-sign-out>Cerrar sesión</button>
      </div>
      ${emptyMarkup('Cuando haya un pedido listo, aparecerá acá para que puedas aceptarlo.')}` : ''}
    </div>
  `;
}

function riderOperationalOrders() {
  return getState().orders.filter((order) => (
    order.deliveryMode === 'delivery'
    && ['ready', 'assigned', 'picked_up', 'on_the_way', 'arrived'].includes(workflowStatus(order))
  ));
}

export function selectPrimaryRiderOrder(orders = []) {
  const rank = {
    arrived: 0,
    on_the_way: 1,
    picked_up: 2,
    assigned: 3,
    ready: 4,
  };
  return [...orders].sort((left, right) => {
    const statusDelta = (rank[workflowStatus(left)] ?? 99) - (rank[workflowStatus(right)] ?? 99);
    if (statusDelta) return statusDelta;
    return Date.parse(right.updatedAt || right.createdAt || 0)
      - Date.parse(left.updatedAt || left.createdAt || 0);
  })[0] || null;
}

function availableRiderOrderMarkup(order) {
  return `
    <article class="production-order-card is-available">
      <div class="production-order-head">
        <div>
          <span class="production-order-code">${escapeHtml(order.publicCode)}</span>
          <strong>${escapeHtml(order.pickupBranch || 'Sucursal asignada')}</strong>
        </div>
        <span class="status-pill ready">Listo</span>
      </div>
      <dl class="production-order-meta">
        <div><dt>Zona</dt><dd>${escapeHtml(order.generalZone || 'Zona general')}</dd></div>
        <div><dt>Paquetes</dt><dd>${escapeHtml(order.approximatePackages)}</dd></div>
        <div><dt>Cobro</dt><dd>${escapeHtml(order.paymentMethod || 'A coordinar')}</dd></div>
        ${order.collectionAmount == null
          ? ''
          : `<div><dt>Importe</dt><dd>${escapeHtml(String(order.collectionAmount))}</dd></div>`}
      </dl>
      ${order.operationalRestrictions
        ? `<p class="form-hint">${escapeHtml(order.operationalRestrictions)}</p>`
        : ''}
      <button
        class="primary-button"
        type="button"
        data-production-rider-claim="${escapeAttribute(order.publicCode)}"
        data-expected-status="${escapeAttribute(order.expectedStatus || 'ready')}"
      >Aceptar entrega</button>
    </article>`;
}

export function riderOperationalOrderMarkup(order, context) {
  const current = workflowStatus(order);
  const sharing = gpsShare.watchId !== null && gpsShare.orderId === order.id;
  const canShare = ['on_the_way', 'arrived'].includes(current);
  const showPrivateDelivery = ['picked_up', 'on_the_way', 'arrived'].includes(current);
  const beforePickup = ['ready', 'assigned'].includes(current);
  const address = showPrivateDelivery
    ? formatRiderDeliveryAddress(order)
    : {
      primary: cleanOperationalText(getBusinessConfig().address) || 'Sucursal asignada',
      secondary: [],
      hasAddress: true,
    };
  const navigationTarget = beforePickup ? context?.store : context?.destination;
  const navigationUrl = buildExternalNavigationUrl({
    destination: navigationTarget,
    address: address.primary,
  });
  const distance = riderDistanceAndEtaLabel(order, context?.riderLocation, navigationTarget);
  const arrivalPending = pendingRiderActions.has(`status:${order.id}:arrived`);
  const departurePending = pendingRiderActions.has(`status:${order.id}:on_the_way`);
  const customerPhone = cleanOperationalText(order.customerPhone);

  return `
    <article class="rider-operational-view" data-rider-operational-order="${escapeAttribute(order.id)}">
      <header class="rider-operational-header">
        <button class="rider-header-action" type="button" data-nav-view="home" aria-label="Volver al inicio">
          ${backGlyph()}
        </button>
        <div class="rider-operational-heading">
          <span>Entrega en curso</span>
          <strong>Pedido ${escapeHtml(shortOrderLabel(order))}</strong>
        </div>
        <span class="rider-operational-status">${escapeHtml(statusLabel(order.status))}</span>
        <button class="rider-header-action" type="button" data-production-sign-out aria-label="Cerrar sesión">
          ${logoutGlyph()}
        </button>
      </header>

      <div class="rider-operational-map-stage" data-map-shell="rider">
        <div
          class="real-map-shell rider-operational-map-shell"
          data-real-map
          data-map-role="rider-operational"
          data-order-id="${escapeAttribute(order.id)}"
        >
          <div class="real-map-canvas" data-map-canvas aria-label="Mapa operativo de la entrega"></div>
          <div class="real-map-fallback rider-operational-map-fallback" data-map-fallback>
            <p data-map-fallback-message>El mapa no está disponible en este dispositivo.</p>
          </div>
          <span class="real-map-tile-error" data-map-tile-error hidden>Mapa base no disponible</span>
          <div class="real-map-meta rider-operational-map-meta sr-only" data-map-meta aria-live="polite">
            Buscando tu ubicación…
          </div>
        </div>
        <button
          class="rider-recenter-control"
          type="button"
          data-map-recenter
          aria-label="Centrar mi ubicación"
          title="Centrar mi ubicación"
          ${context?.riderLocation ? '' : 'disabled'}
        >${locateGlyph()}</button>
      </div>

      <section class="rider-operational-sheet" aria-labelledby="rider-delivery-address-${escapeAttribute(order.id)}">
        <span class="rider-sheet-handle" aria-hidden="true"></span>
        <div class="rider-destination-copy">
          <span class="rider-operational-eyebrow">${beforePickup ? 'RETIRÁ EN' : 'ENTREGA EN'}</span>
          <h1 id="rider-delivery-address-${escapeAttribute(order.id)}">${escapeHtml(address.primary)}</h1>
          ${address.secondary.length ? `
            <div class="rider-address-details">
              ${address.secondary.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}
            </div>` : ''}
          ${distance ? `<p class="rider-distance">${escapeHtml(distance)}</p>` : ''}
          ${!beforePickup && !context?.destination
            ? '<p class="rider-location-warning" role="status">No pudimos ubicar esta dirección en el mapa.</p>'
            : ''}
        </div>

        ${renderOperationalGpsState(order, context, { canShare, sharing })}

        <div class="rider-primary-actions ${current === 'on_the_way' ? 'has-arrival' : ''}">
          ${navigationUrl ? `
            <a
              class="primary-button rider-navigation-button"
              href="${escapeAttribute(navigationUrl)}"
              target="_blank"
              rel="noopener noreferrer"
              data-rider-navigation
            >${navigationGlyph()}<span>Abrir navegación</span></a>
          ` : `
            <button class="primary-button rider-navigation-button" type="button" disabled>
              ${navigationGlyph()}<span>Abrir navegación</span>
            </button>
          `}
          ${current === 'on_the_way' ? `
            <button
              class="secondary-button rider-arrival-button"
              type="button"
              data-production-rider-next="${escapeAttribute(order.id)}"
              data-next-status="arrived"
              ${arrivalPending ? 'disabled aria-busy="true"' : ''}
            >${arrivalPending ? 'Registrando…' : 'Llegué'}</button>
          ` : ''}
        </div>

        ${['ready', 'assigned', 'picked_up'].includes(current) ? `
          <button
            class="primary-button rider-departure-button"
            type="button"
            data-production-rider-next="${escapeAttribute(order.id)}"
            data-next-status="on_the_way"
            ${departurePending ? 'disabled aria-busy="true"' : ''}
          >${departurePending
            ? 'Registrando…'
            : current === 'picked_up'
              ? 'Iniciar recorrido'
              : 'Retiré el pedido'}</button>
        ` : ''}

        ${current === 'arrived' ? `
          <div class="rider-arrival-confirmation" role="status">
            <span aria-hidden="true">✓</span>
            <div><strong>Llegada registrada</strong><p>El pedido sigue abierto hasta validar la recepción.</p></div>
          </div>
          <div class="production-delivery-code rider-operational-delivery-code">
            <label>
              Código de entrega
              <input
                type="text"
                inputmode="numeric"
                autocomplete="one-time-code"
                maxlength="4"
                pattern="[0-9]{4}"
                data-production-delivery-code
                aria-label="Código de entrega de 4 dígitos"
              />
            </label>
            <button
              class="primary-button"
              type="button"
              data-production-rider-confirm="${escapeAttribute(order.id)}"
            >Confirmar entrega</button>
          </div>
        ` : ''}

        <details class="rider-operational-more">
          <summary>Datos de la entrega</summary>
          <dl>
            ${showPrivateDelivery ? `
              <div><dt>Cliente</dt><dd>${escapeHtml(order.customerName || 'Cliente')}</dd></div>
              ${customerPhone ? `<div><dt>Teléfono</dt><dd><a href="tel:${encodeURIComponent(customerPhone)}">${escapeHtml(customerPhone)}</a></dd></div>` : ''}
            ` : '<div><dt>Próximo paso</dt><dd>Retirar el pedido en el negocio</dd></div>'}
            <div><dt>Pago</dt><dd>${escapeHtml(order.paymentMethod || 'A coordinar')}</dd></div>
            <div><dt>Total</dt><dd>${escapeHtml(formatOrderMoney(order.total, order.currencyCode))}</dd></div>
          </dl>
        </details>
      </section>
    </article>
  `;
}

function riderCompactOrderMarkup(order) {
  const current = workflowStatus(order);
  const next = current === 'arrived' ? null : nextRiderStatus(order);
  return `
    <article class="production-order-card rider-compact-order">
      <div class="production-order-head">
        <div>
          <span class="production-order-code">${escapeHtml(shortOrderLabel(order))}</span>
          <strong>${['on_the_way', 'arrived'].includes(current) ? escapeHtml(order.customerName) : 'Retiro en sucursal'}</strong>
        </div>
        <span class="status-pill ${escapeHtml(order.status)}">${escapeHtml(statusLabel(order.status))}</span>
      </div>
      ${next ? `
        <div class="button-row">
          <button
            class="primary-button compact"
            type="button"
            data-production-rider-next="${escapeAttribute(order.id)}"
            data-next-status="${escapeAttribute(next)}"
          >${escapeHtml(actionLabel(next, 'rider'))}</button>
        </div>` : ''}
    </article>
  `;
}

function renderOperationalGpsState(order, context, { canShare, sharing }) {
  const sameOrder = gpsShare.orderId === order.id;
  const requesting = sameOrder && ['requesting', 'publishing'].includes(gpsShare.state);
  const failed = sameOrder && gpsShare.state === 'error';
  const hasLocation = Boolean(context?.riderLocation);
  const copy = failed
    ? cleanOperationalText(gpsShare.message) || 'No pudimos obtener tu ubicación.'
    : sharing
      ? cleanOperationalText(gpsShare.message) || 'Compartiendo tu ubicación en vivo.'
      : requesting
        ? cleanOperationalText(gpsShare.message) || 'Buscando tu ubicación…'
      : canShare
        ? hasLocation
          ? 'Seguimiento pausado. El mapa muestra tu última ubicación.'
          : 'Activá la ubicación para verte en el mapa.'
        : 'Tu ubicación estará disponible cuando salgas del negocio.';
  if (!canShare && hasLocation && !failed) return '';
  return `
    <div class="rider-gps-state ${failed ? 'is-error' : ''}" role="status">
      <span class="rider-gps-state-icon" aria-hidden="true">${locateGlyph()}</span>
      <p>${escapeHtml(copy)}</p>
      ${sharing ? `
        <button
          class="ghost-button compact"
          type="button"
          data-production-gps-stop
        >Detener GPS</button>
      ` : ''}
      ${canShare && !requesting && !sharing ? `
        <button
          class="ghost-button compact"
          type="button"
          data-production-gps-start="${escapeAttribute(order.id)}"
        >${failed ? 'Reintentar' : hasLocation ? 'Reactivar GPS' : 'Activar ubicación'}</button>
      ` : ''}
    </div>`;
}

function backGlyph() {
  return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
    <path d="M14.5 6.5 9 12l5.5 5.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function logoutGlyph() {
  return `<svg viewBox="0 0 24 24" width="21" height="21" fill="none" aria-hidden="true">
    <path d="M10 5H6.5A2.5 2.5 0 0 0 4 7.5v9A2.5 2.5 0 0 0 6.5 19H10M14.5 8.5 18 12l-3.5 3.5M18 12H9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function locateGlyph() {
  return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.8"/>
    <circle cx="12" cy="12" r="1.6" fill="currentColor"/>
    <path d="M12 2.6v3M12 18.4v3M2.6 12h3M18.4 12h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`;
}

function navigationGlyph() {
  return `<svg viewBox="0 0 24 24" width="21" height="21" fill="none" aria-hidden="true">
    <path d="M20.5 4.2 4 11l6.4 2.6L13 20l7.5-15.8Z" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
  </svg>`;
}

function cleanOperationalText(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return /^(?:null|undefined|nan)$/i.test(text) ? '' : text;
}

async function refreshRiderOrders() {
  const [assigned, available] = await Promise.all([
    repository.listOrders(),
    repository.listAvailableRiderOrders(),
  ]);
  availableRiderOrders = available?.ok && Array.isArray(available.orders)
    ? available.orders
    : [];
  return assigned;
}

async function updateOrderFromAction(orderId, nextStatus) {
  if (!orderId || !nextStatus) {
    return { handled: true, ok: false, message: 'Acción de pedido inválida.' };
  }
  const result = await repository.updateOrderStatus(orderId, nextStatus);
  if (result.ok) {
    if (access.membership?.role === 'rider') await refreshRiderOrders();
    else await repository.listOrders();
  }
  notify();
  return {
    handled: true,
    ok: result.ok,
    message: result.ok ? 'Estado del pedido actualizado.' : result.message,
  };
}

async function runRiderActionOnce(key, control, task) {
  if (pendingRiderActions.has(key)) {
    return {
      handled: true,
      ok: false,
      message: 'La actualización ya está en curso.',
    };
  }
  pendingRiderActions.add(key);
  const originalLabel = control?.textContent || '';
  if (control) {
    control.disabled = true;
    control.setAttribute?.('aria-busy', 'true');
  }
  try {
    return await task();
  } finally {
    pendingRiderActions.delete(key);
    if (control?.isConnected) {
      control.disabled = false;
      control.removeAttribute?.('aria-busy');
      if (originalLabel) control.textContent = originalLabel;
    }
    // updateOrderFromAction puede haber renderizado mientras la clave seguía
    // pendiente. Este segundo pulso deja el control nuevo habilitado también
    // cuando la solicitud falla y el nodo original ya fue reemplazado.
    notify();
  }
}

function startGpsShare(orderId) {
  if (!gpsController) configureGpsController();
  const result = gpsController?.start(orderId) || {
    ok: false,
    message: 'El controlador de ubicación no está disponible.',
  };
  gpsShare = gpsController?.getSnapshot?.() || emptyGpsShare();
  return { handled: true, ...result };
}

function stopGpsShare() {
  const stopped = gpsController?.stop?.() || false;
  gpsShare = gpsController?.getSnapshot?.() || emptyGpsShare();
  return stopped;
}

function configureGpsController() {
  gpsController?.destroy?.();
  gpsController = createProductionRiderGpsController({
    repository,
    getAccess: () => access,
    getOrder: (orderId) => getState().orders.find((order) => (
      order.id === orderId || order.backendId === orderId || order.code === orderId
    )) || null,
    onChange: (snapshot) => {
      gpsShare = snapshot;
      notify();
    },
  });
  gpsShare = gpsController.getSnapshot();
}

function emptyGpsShare() {
  return {
    watchId: null,
    orderId: '',
    state: 'idle',
    message: '',
    lastAcceptedFix: null,
    lastPublishedFix: null,
    lastPublishedAt: 0,
    publishing: false,
  };
}

function requireViewAccess(view) {
  if (
    access.status === 'authenticated'
    && isRoleAuthorizedForView(access.membership?.role, view)
  ) {
    return { ok: true };
  }
  return {
    ok: false,
    message: 'Tu sesión no tiene permiso para esta acción.',
  };
}

function workflowStatus(order) {
  return normalizeWorkflowStatus(order?.workflowStatus || order?.status);
}

function roleMismatchMessage(role, view) {
  if (role === 'rider' && view === 'business') {
    return 'La sesión actual es de rider. Abrí la vista Repartidor.';
  }
  if (BUSINESS_ROLES.has(role) && view === 'rider') {
    return 'La sesión actual pertenece al equipo del negocio, no a un rider.';
  }
  return 'La cuenta no tiene acceso a esta vista.';
}

function roleLabel(role) {
  if (role === 'owner') return 'Owner';
  if (role === 'admin') return 'Administrador';
  if (role === 'staff') return 'Empleado';
  if (role === 'rider') return 'Rider';
  return 'Cuenta';
}

function actionLabel(status, actor) {
  if (status === 'accepted') return 'Aceptar pedido';
  if (status === 'preparing') return 'Iniciar preparación';
  if (status === 'ready') return 'Marcar listo';
  if (status === 'on_the_way') return actor === 'rider' ? 'Tomar y salir' : 'En camino';
  if (status === 'arrived') return 'Llegué';
  if (status === 'delivered') return 'Confirmar entrega';
  return 'Actualizar';
}

function formatOrderMoney(value, currencyCode = '') {
  const currency = /^[A-Z]{3}$/.test(String(currencyCode || '')) ? currencyCode : '';
  if (!currency) return 'Moneda no informada';
  try {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(Number(value || 0));
  } catch (_) {
    return `${currency} ${Number(value || 0).toFixed(2)}`;
  }
}

function emptyMarkup(message) {
  return `<div class="empty-state"><strong>Sin actividad</strong><p>${escapeHtml(message)}</p></div>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
