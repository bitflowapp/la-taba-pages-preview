import { APP_MODE_PRODUCTION, getAppMode } from './core/app-mode.js';
import { normalizeWorkflowStatus } from './core/order-workflow.js';
import { createProductionRiderGpsController } from './tracking/production_rider_gps.js';
import { getOrderRepository } from './repositories/repository_factory.js';
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
    const result = await updateOrderFromAction(
      riderNext.dataset.productionRiderNext,
      riderNext.dataset.nextStatus,
    );
    if (result.ok && riderNext.dataset.nextStatus === 'delivered') stopGpsShare();
    return result;
  }

  const riderConfirm = target.closest('[data-production-rider-confirm]');
  if (riderConfirm) {
    const guard = requireViewAccess('rider');
    if (!guard.ok) return { handled: true, ...guard };
    const orderId = riderConfirm.dataset.productionRiderConfirm;
    const container = riderConfirm.closest('.production-order-card');
    const code = container?.querySelector('[data-production-delivery-code]')?.value || '';
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
    workspace.replaceChildren();
    return;
  }
  workspace.innerHTML = view === 'business'
    ? businessWorkspaceMarkup()
    : riderWorkspaceMarkup();
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
  const orders = getState().orders.filter((order) => (
    order.deliveryMode === 'delivery'
    && ['ready', 'assigned', 'picked_up', 'on_the_way', 'arrived'].includes(workflowStatus(order))
  ));
  const rows = orders.map(riderOrderMarkup).join('');
  const queue = availableRiderOrders.map(availableRiderOrderMarkup).join('');
  return `
    <div class="production-ops-head">
      <div>
        <p class="eyebrow">Rider autenticado</p>
        <h1>Mis entregas</h1>
        <p>La ubicación sólo se publica cuando activás GPS.</p>
      </div>
      <button class="ghost-button compact" type="button" data-production-sign-out>Cerrar sesión</button>
    </div>
    ${rows ? `
      <section class="production-rider-section" aria-labelledby="production-rider-active-title">
        <div class="panel-head"><h3 id="production-rider-active-title">Entrega activa</h3></div>
        <div class="production-order-list" aria-live="polite">${rows}</div>
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
    ${!rows && !queue ? emptyMarkup('No hay entregas disponibles o asignadas a esta cuenta.') : ''}
  `;
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

function riderOrderMarkup(order) {
  const current = workflowStatus(order);
  const next = current === 'arrived' ? null : nextRiderStatus(order);
  const sharing = gpsShare.watchId !== null && gpsShare.orderId === order.id;
  const canShare = ['on_the_way', 'arriving', 'arrived'].includes(current);
  const showPrivateDelivery = ['on_the_way', 'arrived'].includes(current);
  return `
    <article class="production-order-card">
      <div class="production-order-head">
        <div>
          <span class="production-order-code">${escapeHtml(order.id)}</span>
          <strong>${showPrivateDelivery ? escapeHtml(order.customerName) : 'Retiro en sucursal'}</strong>
        </div>
        <span class="status-pill ${escapeHtml(order.status)}">${escapeHtml(statusLabel(order.status))}</span>
      </div>
      <p class="production-order-address">${showPrivateDelivery
        ? escapeHtml(order.address || 'Sin dirección publicada')
        : 'Retirá el pedido en la sucursal indicada.'}</p>
      ${showPrivateDelivery && order.addressDetails?.reference
        ? `<p class="form-hint">Referencia: ${escapeHtml(order.addressDetails.reference)}</p>`
        : ''}
      <div class="button-row">
        ${next ? `
          <button
            class="primary-button compact"
            type="button"
            data-production-rider-next="${escapeAttribute(order.id)}"
            data-next-status="${escapeAttribute(next)}"
          >${escapeHtml(actionLabel(next, 'rider'))}</button>
        ` : ''}
        ${canShare && !sharing ? `
          <button
            class="secondary-button compact"
            type="button"
            data-production-gps-start="${escapeAttribute(order.id)}"
          >Compartir GPS</button>
        ` : ''}
        ${sharing ? `
          <button class="secondary-button compact" type="button" data-production-gps-stop>
            Detener GPS
          </button>
        ` : ''}
      </div>
      ${current === 'arrived' ? `
        <div class="production-delivery-code">
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
        </div>` : ''}
      ${sharing || gpsShare.orderId === order.id
        ? `<p class="production-gps-status" role="status">${escapeHtml(gpsShare.message || 'Esperando ubicación GPS…')}</p>`
        : ''}
    </article>
  `;
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
  if (status === 'arrived') return 'Marcar llegada';
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
