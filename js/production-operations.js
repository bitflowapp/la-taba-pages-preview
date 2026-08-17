import { APP_MODE_PRODUCTION, getAppMode } from './core/app-mode.js';
import { createBusinessOrderIntakeCoordinator } from './core/business-order-intake.js';
import { normalizeWorkflowStatus } from './core/order-workflow.js';
import { isMercadoPagoOrder } from './core/business-ops.js';
import { createProductionRiderGpsController } from './tracking/production_rider_gps.js';
import { getOrderRepository } from './repositories/repository_factory.js';
import { createSupabaseInventoryRepository } from './repositories/supabase-inventory-repository.js';
import { createSupabasePosRepository } from './repositories/supabase-pos-repository.js';
import { createSupabaseFiscalRepository } from './repositories/supabase-fiscal-repository.js';
import { createSupabasePackingRepository } from './repositories/supabase-packing-repository.js';
import { createSupabaseOperationsRepository } from './repositories/supabase-operations-repository.js';
import { createSupabaseBusinessRepository } from './repositories/supabase-business-repository.js';
import { createSupabasePaymentsRepository } from './repositories/supabase-payments-repository.js';
import { getSupabaseClient } from './services/supabase-client.js';
import {
  deliveryDestinationSearchUrl,
  deliveryLocationAccuracyLabel,
  plottableDeliveryPoint,
} from './core/delivery-location.js';
import { resolveRuntimeConfig } from './core/runtime-config.js';
import { createBusinessPlatform } from './platform/tauri-business-platform.js';
import { createBusinessPanelController } from './business/business-panel-controller.js';
import {
  allowedBusinessOperationViews,
  businessOperationViewLabel,
  BUSINESS_OPERATION_VIEWS,
  configureBusinessOperations,
  handleBusinessOperationsAction,
  handleBusinessOperationsInput,
  renderBusinessOperations,
  resetBusinessOperationsForTests,
} from './business/business-operations-center.js';
import {
  PAYMENT_ACTION_OUTCOMES,
  PAYMENT_RECOVERY_STATES,
  buildPaymentSupportDiagnostic,
  paymentActionOutcome,
  paymentRecoveryActions,
  paymentRecoveryCopy,
  paymentRecoveryState,
  paymentWorkerState,
  serializePaymentSupportDiagnostic,
} from './payments/payment-recovery.js';
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
// El último markup pintado por vista, para no reemplazar el DOM cuando el
// contenido es idéntico. Se limpia en `resetProductionOperationsForTests`.
const lastWorkspaceMarkup = new Map();
let notify = () => {};
let notifyOrderAlert = () => {};
let refreshSequence = 0;
let availableRiderOrders = [];
let activeBusinessRiders = [];
// Estado de las ofertas a riders. El Panel lo dibuja; la autoridad sigue siendo
// el servidor, que recuenta la capacidad en cada aceptación.
let riderOrderOffers = [];
let gpsController = null;
let businessIntake = null;
let businessIntakeStatus = emptyBusinessIntakeStatus();
let businessCommandController = null;
let businessCommandStatus = null;
let businessOperationsView = 'operation-center';
/**
 * ¿Está abierta la hoja de «Más»?
 *
 * Vive en el módulo y no en el DOM a propósito. El workspace se vuelve a pintar
 * cada vez que llega un pedido por realtime, y un estado guardado en el marcado
 * se perdería en ese repintado: la hoja se cerraría sola en la mano de quien la
 * acababa de abrir, justo cuando entra trabajo. Ver B19.
 */
let panelMoreSheetOpen = false;
let inventoryRepository = null;
let posRepository = null;
let fiscalRepository = null;
let packingRepository = null;
let operationsRepository = null;
let businessConfigRepository = null;
let paymentsRepository = null;
let businessPayments = [];
let businessPaymentsStatus = { phase: 'idle', message: '' };
let paymentRefreshTimer = null;
const paymentActionsInFlight = new Set();
const orderActionsInFlight = new Set();
const paymentActionMessages = new Map();
const paymentDiagnostics = new Map();
const REFUND_CONFIRMATION = 'I_UNDERSTAND_THIS_REQUESTS_A_MERCADO_PAGO_REFUND';
const FRIENDLY_REFUND_CONFIRMATION = 'DEVOLVER';
const CANCELLATION_CONFIRMATION = 'I_UNDERSTAND_THIS_REQUESTS_A_MERCADO_PAGO_CANCELLATION';
const FRIENDLY_CANCELLATION_CONFIRMATION = 'CANCELAR';
let access = {
  status: 'signed_out',
  user: null,
  membership: null,
  message: '',
};
let gpsShare = emptyGpsShare();

export function initProductionOperations({
  onChange = () => {},
  onOrderAlert = () => {},
} = {}) {
  notify = typeof onChange === 'function' ? onChange : () => {};
  notifyOrderAlert = typeof onOrderAlert === 'function' ? onOrderAlert : () => {};
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

  // EL EVENTO IMPORTA, Y ACÁ SE DESCARTABA.
  //
  // Este callback ignoraba `event`, `session` y `user`, así que CUALQUIER señal
  // de Auth reiniciaba el acceso del Panel. Dos de esas señales son rutina y no
  // cambian a nadie:
  //
  //   · TOKEN_REFRESHED — el cliente se crea con `autoRefreshToken: true`, así
  //     que el token se renueva solo cada tanto;
  //   · SIGNED_IN — al volver a la pestaña, supabase-js corre
  //     `_recoverAndRefresh()` por `visibilitychange` y, si la sesión guardada
  //     sigue válida, emite SIGNED_IN. O sea: mirar otra pestaña y volver.
  //
  // Con `refreshProductionAccessNow()` blanqueando el acceso a «Verificando
  // sesión…» ANTES de preguntar, cada una de esas señales le mostraba al
  // operador el formulario de login y le vaciaba la bandeja durante el viaje de
  // red, y de paso reconstruía la suscripción realtime. En un turno con pedidos
  // entrando, eso es perder de vista la cola cada vez que se cambia de pestaña.
  //
  // Si la identidad no cambió, no hay nada que revalidar.
  authStop = auth.onAuthStateChange(({ event, user } = {}) => {
    const mismaPersona = Boolean(user?.id) && user.id === access.user?.id;
    const eventoDeRutina = event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED' || event === 'SIGNED_IN';
    if (access.status === 'authenticated' && mismaPersona && eventoDeRutina) return;
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
  // La activación va por la MISMA cola que el evento SIGNED_IN: un solo camino
  // serializado. Activar directo acá era la mitad de la carrera.
  await refreshProductionAccess();
  return { handled: true, ok: true, message: 'Acceso seguro iniciado.' };
}

export async function handleProductionOperationsAction(target) {
  if (getAppMode() !== APP_MODE_PRODUCTION || !target?.closest) {
    return { handled: false };
  }

  if (target.closest('[data-production-sign-out]')) {
    stopGpsShare();
    stopBusinessIntake();
    stopBusinessCommandRuntime();
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

  // La hoja de «Más» se abre y se cierra antes que nada: es chrome, no una
  // acción del negocio, y no puede quedar tapada por otro `closest`.
  if (target.closest('[data-panel-more-toggle]')) {
    panelMoreSheetOpen = !panelMoreSheetOpen;
    notify();
    return { handled: true, ok: true, message: '' };
  }
  if (target.closest('[data-panel-more-close]')) {
    panelMoreSheetOpen = false;
    notify();
    return { handled: true, ok: true, message: '' };
  }

  const operationsResult = await handleBusinessOperationsAction(target);
  if (operationsResult.handled) {
    if (operationsResult.view) {
      const nextView = operationsResult.view;
      if (!BUSINESS_OPERATION_VIEWS.includes(nextView)) {
        return { handled: true, ok: false, message: 'Esa pantalla no existe en el panel.' };
      }
      const guard = requireViewAccess('business');
      if (!guard.ok) return { handled: true, ...guard };
      // El panel no muestra estas pantallas, pero el cambio de vista también se valida.
      if (nextView !== 'orders' && !allowedBusinessOperationViews(access.membership?.role).includes(nextView)) {
        return { handled: true, ok: false, message: 'Esa pantalla la abre el dueño o el encargado.' };
      }
      businessOperationsView = nextView;
      // Elegir un destino cierra la hoja: dejarla abierta encima de la pantalla
      // que se acaba de pedir obliga a un segundo gesto para ver lo que se pidió.
      panelMoreSheetOpen = false;
      notify();
      return { handled: true, ok: true, message: '' };
    }
    notify();
    return operationsResult;
  }

  if (target.closest('[data-production-orders-view]')) {
    const guard = requireViewAccess('business');
    if (!guard.ok) return { handled: true, ...guard };
    businessOperationsView = 'orders';
    panelMoreSheetOpen = false;
    notify();
    return { handled: true, ok: true, message: '' };
  }

  const paymentRefreshAll = target.closest('[data-production-payment-refresh-all]');
  if (paymentRefreshAll) {
    const guard = requirePaymentConsultationAccess();
    if (!guard.ok) return { handled: true, ...guard };
    await refreshBusinessPayments();
    notify();
    return { handled: true, ok: true, message: 'Estado actualizado.' };
  }

  const paymentView = target.closest('[data-production-payment-view]');
  if (paymentView) {
    const details = paymentView.closest('.production-payment-card')?.querySelector('details');
    if (details) {
      details.open = true;
      details.querySelector('summary')?.focus?.();
    }
    return { handled: true, ok: true };
  }

  const paymentSupport = target.closest('[data-production-payment-support]');
  if (paymentSupport) {
    const guard = requirePaymentAdminAccess();
    if (!guard.ok) return { handled: true, ...guard };
    return preparePaymentSupport(paymentSupport.dataset.productionPaymentSupport);
  }

  // Rearmar el pedido de un cobro que entró y se quedó sin reserva. Es la
  // salida que faltaba: hasta acá la única alternativa era devolver el dinero.
  const paymentRecover = target.closest('[data-production-payment-recover]');
  if (paymentRecover) {
    const guard = requirePaymentAdminAccess();
    if (!guard.ok) return { handled: true, ...guard };
    const checkoutSessionId = paymentRecover.dataset.productionPaymentRecover;
    const payment = businessPayments.find((row) => (
      String(row.checkout_session_id) === String(checkoutSessionId)
    ));
    const paymentIntentId = String(payment?.payment_intent_id || checkoutSessionId);
    if (paymentActionsInFlight.has(paymentIntentId)) {
      return { handled: true, ok: false, message: 'Ya estamos procesando este pago.' };
    }
    paymentActionsInFlight.add(paymentIntentId);
    notify();
    try {
      const result = await repository.recoverPaidCheckoutOrder(checkoutSessionId);
      await refreshBusinessPayments();
      paymentActionMessages.set(paymentIntentId, result.message || PAYMENT_ACTION_OUTCOMES.AUTOMATION_FAILED);
      notify();
      return { handled: true, ...result };
    } catch (_) {
      paymentActionMessages.set(paymentIntentId, PAYMENT_ACTION_OUTCOMES.AUTOMATION_FAILED);
      notify();
      return { handled: true, ok: false, message: PAYMENT_ACTION_OUTCOMES.AUTOMATION_FAILED };
    } finally {
      paymentActionsInFlight.delete(paymentIntentId);
      notify();
    }
  }

  const paymentReconcile = target.closest('[data-production-payment-reconcile], [data-production-payment-reactivate]');
  if (paymentReconcile) {
    const guard = requirePaymentAdminAccess();
    if (!guard.ok) return { handled: true, ...guard };
    const paymentIntentId = paymentReconcile.dataset.productionPaymentReconcile
      || paymentReconcile.dataset.productionPaymentReactivate;
    if (paymentActionsInFlight.has(paymentIntentId)) {
      return { handled: true, ok: false, message: 'Ya estamos procesando este pago.' };
    }
    paymentActionsInFlight.add(paymentIntentId);
    paymentActionMessages.set(paymentIntentId, PAYMENT_ACTION_OUTCOMES.RETRYING);
    notify();
    const hadOrderBeforeRetry = Boolean(businessPayments.find((payment) => (
      String(payment.payment_intent_id) === String(paymentIntentId)
    ))?.order_id);
    try {
      const result = await repository.reconcileMercadoPagoPayment(paymentIntentId);
      await refreshBusinessPayments();
      const current = businessPayments.find((payment) => String(payment.payment_intent_id) === String(paymentIntentId));
      const message = result.ok
        ? (current
          ? paymentActionOutcome({ ...current, order_was_existing: hadOrderBeforeRetry })
          : result.message || PAYMENT_ACTION_OUTCOMES.RETRYING)
        : PAYMENT_ACTION_OUTCOMES.AUTOMATION_FAILED;
      paymentActionMessages.set(paymentIntentId, message);
      notify();
      return { handled: true, ...result, message };
    } catch (_) {
      paymentActionMessages.set(paymentIntentId, PAYMENT_ACTION_OUTCOMES.AUTOMATION_FAILED);
      notify();
      return { handled: true, ok: false, message: PAYMENT_ACTION_OUTCOMES.AUTOMATION_FAILED };
    } finally {
      paymentActionsInFlight.delete(paymentIntentId);
      notify();
    }
  }

  const paymentRefresh = target.closest('[data-production-payment-refresh]');
  if (paymentRefresh) {
    const guard = requirePaymentConsultationAccess();
    if (!guard.ok) return { handled: true, ...guard };
    const paymentIntentId = paymentRefresh.dataset.productionPaymentRefresh;
    await refreshBusinessPayments();
    const current = businessPayments.find((payment) => String(payment.payment_intent_id) === String(paymentIntentId));
    const message = paymentActionOutcome(current || {});
    paymentActionMessages.set(paymentIntentId, message);
    notify();
    return { handled: true, ok: true, message };
  }

  const paymentRefund = target.closest('[data-production-payment-refund]');
  if (paymentRefund) {
    const guard = requirePaymentAdminAccess();
    if (!guard.ok) return { handled: true, ...guard };
    const paymentIntentId = paymentRefund.dataset.productionPaymentRefund;
    if (paymentActionsInFlight.has(paymentIntentId)) {
      return { handled: true, ok: false, message: 'Ya estamos procesando este pago.' };
    }
    const amountInput = globalThis.prompt?.(
      'Importe a devolver en ARS. Dejá vacío para devolver el total autorizado.',
      '',
    );
    if (amountInput === null) return { handled: true, ok: false, message: 'Devolución no solicitada.' };
    const confirmationInput = globalThis.prompt?.(
      'Esto enviará una devolución a Mercado Pago. Escribí DEVOLVER para confirmar.',
      '',
    ) || '';
    const confirmation = String(confirmationInput).trim().toUpperCase() === FRIENDLY_REFUND_CONFIRMATION
      ? REFUND_CONFIRMATION
      : '';
    const amount = String(amountInput).trim() === '' ? null : Number(String(amountInput).replace(',', '.'));
    paymentActionsInFlight.add(paymentIntentId);
    paymentActionMessages.set(paymentIntentId, 'Preparando la devolución…');
    notify();
    try {
    const result = await repository.requestMercadoPagoRefund({
        paymentIntentId,
        amount,
        confirmation,
        reason: businessPayments.find((payment) => String(payment.payment_intent_id) === String(paymentIntentId))?.order_id
          ? 'operator_requested_refund'
          : 'approved_payment_without_active_reservation',
      });
      await refreshBusinessPayments();
      const message = result.ok
        ? (result.status === 'approved' ? 'Reembolso confirmado.' : 'Reembolso en proceso.')
        : (result.code === 'REFUND_RECONCILING' ? 'Reembolso en proceso.' : 'Se necesita revisión del responsable.');
      paymentActionMessages.set(paymentIntentId, message);
      notify();
      return { handled: true, ...result, message };
    } catch (_) {
      paymentActionMessages.set(paymentIntentId, 'Se necesita revisión del responsable.');
      notify();
      return { handled: true, ok: false, message: 'Se necesita revisión del responsable.' };
    } finally {
      paymentActionsInFlight.delete(paymentIntentId);
      notify();
    }
  }

  const paymentCancel = target.closest('[data-production-payment-cancel]');
  if (paymentCancel) {
    const guard = requirePaymentAdminAccess();
    if (!guard.ok) return { handled: true, ...guard };
    const cancelIntentId = paymentCancel.dataset.productionPaymentCancel;
    if (paymentActionsInFlight.has(cancelIntentId)) {
      return { handled: true, ok: false, message: 'Ya estamos procesando este pago.' };
    }
    const confirmationInput = globalThis.prompt?.(
      'Esto cancelará el pago pendiente en Mercado Pago. Escribí CANCELAR para confirmar.',
      '',
    ) || '';
    const confirmation = String(confirmationInput).trim().toUpperCase() === FRIENDLY_CANCELLATION_CONFIRMATION
      ? CANCELLATION_CONFIRMATION
      : '';
    paymentActionsInFlight.add(cancelIntentId);
    notify();
    try {
      const result = await repository.requestMercadoPagoCancellation({
        paymentIntentId: cancelIntentId,
        confirmation,
      });
      await refreshBusinessPayments();
      return { handled: true, ...result };
    } finally {
      paymentActionsInFlight.delete(cancelIntentId);
      notify();
    }
  }

  const paymentDispute = target.closest('[data-production-payment-dispute]');
  if (paymentDispute) {
    const guard = requirePaymentAdminAccess();
    if (!guard.ok) return { handled: true, ...guard };
    const row = businessPayments.find((payment) => (
      String(payment.payment_intent_id) === String(paymentDispute.dataset.productionPaymentDispute)
    ));
    return {
      handled: true,
      ok: Boolean(row?.dispute_type),
      message: row?.documentation_required
        ? 'La disputa requiere documentación. Conservá evidencia y seguí el procedimiento de contracargos.'
        : row?.dispute_type
          ? `Disputa ${row.dispute_type}: ${row.dispute_status || 'en revisión'}.`
          : 'No hay una disputa abierta para este pago.',
    };
  }

  const businessNext = target.closest('[data-production-business-next]');
  if (businessNext) {
    const guard = requireViewAccess('business');
    if (!guard.ok) return { handled: true, ...guard };
    const orderId = businessNext.dataset.productionBusinessNext;
    const order = getState().orders.find((candidate) => (
      candidate.id === orderId
      || candidate.backendId === orderId
      || candidate.code === orderId
    ));
    if (!canAdvanceProductionBusinessOrder(order, businessPayments)) {
      return {
        handled: true,
        ok: false,
        message: isProductionOrderPaymentReversed(order, businessPayments)
          ? 'El pago fue revertido. Cancelá el pedido para cerrarlo sin preparar mercadería.'
          : 'Este pedido ya no admite ese avance.',
      };
    }
    return updateOrderFromAction(
      orderId,
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
    if (!canAssignBusinessRider(order, businessPayments)) {
      return {
        handled: true,
        ok: false,
        message: 'Este pedido ya no admite asignación de rider.',
      };
    }
    const card = businessAssign.closest('.production-order-card');
    const riderId = card?.querySelector('[data-production-rider-select]')?.value || '';
    // Con el contrato de oferta el Panel propone y el rider decide. Sin él
    // (demo, sandbox) sigue asignando directo, como siempre.
    const useOffer = supportsRiderOffers() && current === 'ready';
    const result = useOffer
      ? await repository.offerOrderToRider(order.backendId || order.id, riderId, {
        expectedStatus: current,
        expectedRiderId: order.assignedRiderId || null,
      })
      : await repository.assignRider(order.backendId || order.id, riderId, {
        expectedStatus: current,
        expectedRiderId: order.assignedRiderId || null,
      });
    if (result.ok) {
      await businessIntake?.invalidate?.(useOffer ? 'rider-offered' : 'rider-assigned');
      await Promise.all([refreshRiderOrderOffers(), refreshActiveBusinessRiders()]);
    }
    notify();
    return {
      handled: true,
      ok: result.ok,
      message: result.message,
    };
  }

  const offerWithdraw = target.closest('[data-production-offer-withdraw]');
  if (offerWithdraw) {
    const guard = requireViewAccess('business');
    if (!guard.ok) return { handled: true, ...guard };
    if (!supportsRiderOffers()) {
      return { handled: true, ok: false, message: 'Este entorno no maneja ofertas a riders.' };
    }
    const result = await repository.withdrawRiderOffer(offerWithdraw.dataset.productionOfferWithdraw);
    if (result.ok) await Promise.all([refreshRiderOrderOffers(), refreshActiveBusinessRiders()]);
    notify();
    return { handled: true, ok: result.ok, message: result.message };
  }

  const businessCancel = target.closest('[data-production-business-cancel]');
  if (businessCancel) {
    const guard = requireViewAccess('business');
    if (!guard.ok) return { handled: true, ...guard };
    const orderId = businessCancel.dataset.productionBusinessCancel;
    const order = getState().orders.find((candidate) => (
      candidate.id === orderId
      || candidate.backendId === orderId
      || candidate.code === orderId
    ));
    if (!canCancelProductionBusinessOrder(order, businessPayments)) {
      return {
        handled: true,
        ok: false,
        message: isMercadoPagoOrder(order)
          ? 'Este pedido ya fue cobrado por Mercado Pago. Abrí Pagos y gestioná el reembolso antes de cancelar.'
          : 'Este pedido ya no admite cancelación.',
      };
    }
    const card = businessCancel.closest('.production-order-card');
    const reason = String(card?.querySelector('[data-production-cancel-reason]')?.value || '').trim();
    if (!reason) return { handled: true, ok: false, message: 'Ingresá un motivo antes de cancelar.' };
    return updateOrderFromAction(
      orderId,
      'canceled',
      { commandType: 'cancel_order', reason },
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
    if (orderActionsInFlight.has(orderId)) {
      return { handled: true, ok: false, message: 'Ya estamos procesando este pedido.' };
    }
    const container = riderConfirm.closest('.production-order-card');
    const code = container?.querySelector('[data-production-delivery-code]')?.value || '';
    const currentOrder = getState().orders.find((order) => (
      order.id === orderId || order.backendId === orderId || order.code === orderId
    ));
    orderActionsInFlight.add(orderId);
    notify();
    let result;
    try {
      result = await repository.confirmDelivery(orderId, code, {
        expectedRevision: currentOrder?.revision,
      });
      if (result.ok) {
        stopGpsShare();
        await refreshRiderOrders();
      }
    } finally {
      orderActionsInFlight.delete(orderId);
      notify();
    }
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
    const publicCode = riderClaim.dataset.productionRiderClaim;
    if (orderActionsInFlight.has(publicCode)) {
      return { handled: true, ok: false, message: 'Ya estamos procesando esta entrega.' };
    }
    // El claim canónico exige la revisión que la cola devolvió: si el pedido
    // cambió entre el render y el click, el servidor lo dice en vez de asignar
    // sobre datos viejos.
    const queued = availableRiderOrders.find((candidate) => candidate.publicCode === publicCode);
    orderActionsInFlight.add(publicCode);
    notify();
    let result;
    try {
      result = await repository.claimRiderOrder(publicCode, {
        expectedRevision: queued?.revision ?? Number(riderClaim.dataset.expectedRevision || 0) ?? null,
      });
      if (result.ok || result.conflict) await refreshRiderOrders();
    } finally {
      orderActionsInFlight.delete(publicCode);
      notify();
    }
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

export function handleProductionOperationsInput(target) {
  if (getAppMode() !== APP_MODE_PRODUCTION || !target?.closest) return { handled: false };
  return handleBusinessOperationsInput(target);
}

export function isRoleAuthorizedForView(role, view) {
  if (view === 'business') return BUSINESS_ROLES.has(String(role || ''));
  if (view === 'rider') return role === 'rider';
  return false;
}

function requirePaymentAdminAccess() {
  if (
    access.status !== 'authenticated'
    || !['owner', 'admin'].includes(access.membership?.role)
  ) {
    return { ok: false, message: 'Sólo owner o administrador puede operar pagos.' };
  }
  return { ok: true };
}

function requirePaymentConsultationAccess() {
  if (
    access.status === 'authenticated'
    && BUSINESS_ROLES.has(access.membership?.role)
  ) {
    return { ok: true };
  }
  return { ok: false, message: 'Tu sesión no tiene permiso para consultar pagos.' };
}

export function nextBusinessStatus(order = {}) {
  const current = workflowStatus(order);
  if (current === 'submitted') return 'accepted';
  if (current === 'accepted') return 'preparing';
  if (current === 'preparing') return 'ready';
  if (current === 'ready' && order.deliveryMode === 'pickup') return 'delivered';
  return null;
}

// La cadena canónica del servidor: assigned → picked_up → on_the_way → arrived,
// y de arrived se sale SOLO con el código del cliente (confirm_delivery_code).
// Saltear picked_up era prometer un avance que el backend rechaza.
export function nextRiderStatus(order = {}) {
  const current = workflowStatus(order);
  if (current === 'assigned') return 'picked_up';
  if (current === 'picked_up') return 'on_the_way';
  if (current === 'on_the_way') return 'arrived';
  return null;
}

export function canAssignBusinessRider(order = {}, payments = []) {
  return order.deliveryMode === 'delivery'
    && ['ready', 'assigned'].includes(workflowStatus(order))
    && !isProductionOrderPaymentReversed(order, payments);
}

export function isProductionOrderPaymentReversed(order, payments = []) {
  const orderIds = new Set([
    order?.id,
    order?.backendId,
    order?.code,
  ].filter(Boolean).map(String));
  if (!orderIds.size) return false;
  const linked = payments.filter((payment) => orderIds.has(String(payment?.order_id || '')));
  const isFullRefund = (payment) => (
    String(payment?.internal_status || '').toLowerCase() === 'refunded'
    && Number(payment?.refunded_amount || 0) >= Number(payment?.amount || 0)
    && Number(payment?.amount || 0) > 0
  );
  const isReversed = (payment) => (
    isFullRefund(payment)
    || String(payment?.internal_status || '').toLowerCase() === 'charged_back'
  );
  const safelyClosed = new Set(['rejected', 'cancelled', 'canceled', 'expired', 'failed']);
  return linked.some(isReversed) && linked.every((payment) => (
    isReversed(payment)
    || safelyClosed.has(String(payment?.internal_status || '').toLowerCase())
  ));
}

export function canCancelProductionBusinessOrder(order, payments = []) {
  return Boolean(
    order
    && !TERMINAL_STATUSES.has(workflowStatus(order))
    && (!isMercadoPagoOrder(order) || isProductionOrderPaymentReversed(order, payments))
  );
}

export function canAdvanceProductionBusinessOrder(order, payments = []) {
  return Boolean(
    order
    && nextBusinessStatus(order)
    && !isProductionOrderPaymentReversed(order, payments)
  );
}

export function getBusinessIntakeStatus() {
  return { ...businessIntakeStatus };
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
  stopBusinessIntake();
  stopBusinessCommandRuntime();
  resetBusinessOperationsForTests();
  stopPaymentRefresh();
  gpsController?.destroy();
  gpsController = null;
  authStop?.();
  authStop = null;
  accessRefreshChain = Promise.resolve();
  lastWorkspaceMarkup.clear();
  initialized = false;
  repository = null;
  auth = null;
  notify = () => {};
  notifyOrderAlert = () => {};
  refreshSequence = 0;
  availableRiderOrders = [];
  activeBusinessRiders = [];
  businessOperationsView = 'operation-center';
  panelMoreSheetOpen = false;
  inventoryRepository = null;
  posRepository = null;
  fiscalRepository = null;
  packingRepository = null;
  businessIntakeStatus = emptyBusinessIntakeStatus();
  businessPayments = [];
  businessPaymentsStatus = { phase: 'idle', message: '' };
  paymentActionsInFlight.clear();
  orderActionsInFlight.clear();
  paymentActionMessages.clear();
  paymentDiagnostics.clear();
  gpsShare = emptyGpsShare();
  access = {
    status: 'signed_out',
    user: null,
    membership: null,
    message: '',
  };
}

// TODAS las activaciones de acceso (evento de auth o submit del formulario)
// pasan por una cola de una sola corrida. Sin esto, el submit y el evento
// SIGNED_IN corrían activateAuthorizedAccess en paralelo y el PERDEDOR
// ejecutaba stopBusinessIntake() al entrar, matando el intake del ganador:
// panel autenticado con la bandeja congelada en "Error recuperable".
// Medido contra staging real; en tests locales la latencia lo escondía.
let accessRefreshChain = Promise.resolve();

function refreshProductionAccess() {
  const run = accessRefreshChain.then(() => refreshProductionAccessNow());
  accessRefreshChain = run.catch(() => {});
  return run;
}

async function refreshProductionAccessNow() {
  if (!auth) return;
  const sequence = ++refreshSequence;
  // Revalidar en SILENCIO cuando ya hay una sesión de equipo.
  //
  // Esto blanqueaba el acceso siempre, así que la pantalla pasaba por
  // «Verificando sesión…» —o sea, el formulario de login y la bandeja vacía—
  // durante todo el viaje de red, incluso cuando la respuesta iba a ser la
  // misma persona con el mismo rol. El operador veía parpadear su turno.
  //
  // Si todavía no hay sesión, el estado de comprobación es correcto y se
  // conserva: ahí sí no hay nada que mostrar todavía.
  if (access.status !== 'authenticated') {
    access = {
      status: 'checking',
      user: null,
      membership: null,
      message: 'Verificando sesión…',
    };
    notify();
  }

  const result = await auth.getTeamAccess();
  if (sequence !== refreshSequence) return;
  if (!result.ok) {
    stopGpsShare();
    stopBusinessIntake();
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
  businessPayments = [];
  businessPaymentsStatus = { phase: 'idle', message: '' };
  paymentActionsInFlight.clear();
  paymentActionMessages.clear();
  paymentDiagnostics.clear();
  stopPaymentRefresh();
  updateState((draft) => {
    draft.orders = [];
    draft.lastOrderId = null;
    draft.simulation = null;
  });
}

async function activateAuthorizedAccess(result, expectedSequence = null) {
  const sequence = expectedSequence ?? ++refreshSequence;
  stopBusinessIntake();
  repository?.stopSync?.();
  if (result.membership?.role === 'rider') {
    repository?.startSync?.();
    activeBusinessRiders = [];
    riderOrderOffers = [];
    await refreshRiderOrders();
  } else {
    availableRiderOrders = [];
    const [intakeResult, ridersResult] = await Promise.all([
      startBusinessIntake(result.membership?.business_id),
      repository.listActiveRiders(),
      refreshRiderOrderOffers(),
    ]);
    if (!intakeResult?.ok && businessIntakeStatus.phase === 'idle') {
      businessIntakeStatus = {
        ...businessIntakeStatus,
        phase: 'error',
        error: intakeResult?.message || 'No pudimos recuperar los pedidos.',
      };
    }
    activeBusinessRiders = ridersResult?.ok && Array.isArray(ridersResult.riders)
      ? ridersResult.riders
      : [];
    await configureBusinessRuntime(result);
  }
  if (expectedSequence !== null && sequence !== refreshSequence) {
    stopBusinessIntake();
    return;
  }
  access = {
    status: 'authenticated',
    user: result.user,
    membership: result.membership,
    message: '',
  };
  if (BUSINESS_ROLES.has(access.membership?.role)) {
    await refreshBusinessPayments();
    startPaymentRefresh();
  } else {
    businessPayments = [];
    businessPaymentsStatus = { phase: 'idle', message: '' };
    stopPaymentRefresh();
  }
  notify();
}

async function startBusinessIntake(businessId) {
  if (
    typeof repository?.fetchBusinessOrderSnapshot !== 'function'
    || typeof repository?.watchBusinessOrderInvalidations !== 'function'
  ) {
    return {
      ok: false,
      message: 'El repositorio no ofrece recepción autoritativa de pedidos.',
    };
  }
  businessIntake = createBusinessOrderIntakeCoordinator({
    businessId,
    // Lo que el Panel YA tenía en pantalla. Si el coordinador se reconstruye
    // —al volver a la pestaña, al recuperar la sesión, al reconectar— la línea
    // de base es esto y no «todo lo que traiga el primer snapshot», así que un
    // pedido que entró durante la reconstrucción se anuncia en vez de aparecer
    // mudo en la bandeja. La identidad es la misma que usa el coordinador
    // (`businessOrderIdentity`): backendId primero, id después.
    knownOrderIds: getState().orders.map((order) => order.backendId || order.id).filter(Boolean),
    fetchSnapshot: () => repository.fetchBusinessOrderSnapshot(),
    subscribeRealtime: (handlers) => repository.watchBusinessOrderInvalidations(handlers),
    getCurrentOrders: () => getState().orders,
    applyOrders: (orders) => {
      updateState((draft) => {
        draft.orders = orders;
        draft.lastOrderId = null;
        draft.simulation = null;
      });
      // La respuesta del rider llega por fuera del Panel, así que el estado de
      // la oferta y la capacidad se releen con cada foto de pedidos. Sin esto,
      // «Esperando respuesta» se quedaba puesto hasta el próximo click.
      if (supportsRiderOffers()) {
        Promise.all([refreshRiderOrderOffers(), refreshActiveBusinessRiders()])
          .then(notify)
          .catch(() => {});
      }
    },
    onStatusChange: (nextStatus) => {
      businessIntakeStatus = nextStatus;
      notify();
    },
    onOrderAlert: (order) => {
      notifyOrderAlert(`Nuevo pedido ${order?.id || ''}`.trim());
    },
    pollMs: repository.pollMs || 5000,
  });
  return businessIntake.start();
}

function stopBusinessIntake() {
  businessIntake?.stop?.();
  businessIntake = null;
  businessIntakeStatus = emptyBusinessIntakeStatus();
}

async function configureBusinessRuntime(result) {
  stopBusinessCommandRuntime();
  const businessId = String(result.membership?.business_id || '');
  const operatorId = String(result.user?.id || '');
  if (!businessId || !operatorId) return;

  const runtime = resolveRuntimeConfig();
  const client = getSupabaseClient(runtime.repository);
  inventoryRepository = createSupabaseInventoryRepository({ client, businessId });
  paymentsRepository = createSupabasePaymentsRepository({ client, businessId });
  posRepository = createSupabasePosRepository({ client, businessId });
  fiscalRepository = createSupabaseFiscalRepository({ client, businessId });
  packingRepository = createSupabasePackingRepository({ client });
  operationsRepository = createSupabaseOperationsRepository({ client, businessId });
  businessConfigRepository = createSupabaseBusinessRepository({ client, businessId });
  const desktopPlatform = createBusinessPlatform();
  configureBusinessOperations({
    businessId,
    operatorId,
    getOrders: () => getState().orders,
    lookupBarcode: (gtin) => inventoryRepository.lookupBarcode(gtin),
    createProductDraft: (input) => inventoryRepository.createProductDraft(input),
    publishProductDraft: (input) => inventoryRepository.publishProductDraft(input),
    applyInventoryMovement: (input) => inventoryRepository.applyMovement(input),
    checkoutPos: (input) => posRepository.checkout(input),
    getFiscalProfile: () => fiscalRepository.getProfile(),
    listFiscalDocuments: () => fiscalRepository.listDocuments(),
    configureFiscalProfile: (profile) => fiscalRepository.configureProfile(profile),
    requestCreditNote: (input) => fiscalRepository.requestCreditNote(input),
    listFiscalArtifacts: () => fiscalRepository.listArtifacts(),
    requestFiscalArtifactUrl: (input) => fiscalRepository.requestArtifactUrl(input),
    regenerateFiscalArtifact: (fiscalDocumentId) => fiscalRepository.regenerateArtifact(fiscalDocumentId),
    requestFiscalPrintJob: (input) => fiscalRepository.requestPrintJob(input),
    updateFiscalPrintJob: (input) => fiscalRepository.updatePrintJob(input),
    desktopPlatform,
    startPacking: (input) => packingRepository.start(input),
    getPackingManifest: (sessionId) => packingRepository.manifest({ sessionId }),
    recordPackingScan: ({ session, event, scanKey }) => businessCommandController.queue({
      businessId,
      orderId: session.orderId,
      commandType: 'packing_scan',
      expectedRevision: session.orderRevision,
      idempotencyKey: scanKey,
      payload: {
        sessionId: session.serverSessionId,
        gtin: event.normalizedValue,
        scanKey,
      },
    }),
    revertPackingScan: ({ session, scanKey, idempotencyKey }) => businessCommandController.queue({
      businessId,
      orderId: session.orderId,
      commandType: 'packing_scan_revert',
      expectedRevision: session.orderRevision,
      idempotencyKey,
      payload: { sessionId: session.serverSessionId, scanKey },
    }),
    cancelPackingScan: (scanKey) => businessCommandController.cancelByIdempotencyKey(scanKey),
    drainPackingCommands: () => businessCommandController.drain(),
    listPackingCommands: () => businessCommandController.getSnapshot().commands
      .filter((command) => command.commandType.startsWith('packing_')),
    confirmPacking: ({ session, exceptionReason, idempotencyKey }) => packingRepository.confirm({
      sessionId: session.serverSessionId,
      exceptionReason,
      idempotencyKey,
    }),
    role: result.membership?.role,
    operatorName: String(result.user?.email || '').split('@')[0],
    // Configuracion operativa. El Panel no escribe estas tablas: no tiene
    // permiso de tabla. Cada cambio pasa por una RPC que autoriza, valida y
    // audita en la misma transaccion, y contesta 42501 a quien no corresponde.
    getOperationsConfig: () => businessConfigRepository.operationsConfig(),
    setServiceHours: (input) => businessConfigRepository.setServiceHours(input),
    upsertDeliveryZone: (input) => businessConfigRepository.upsertDeliveryZone(input),
    setDeliveryZoneActive: (input) => businessConfigRepository.setDeliveryZoneActive(input),
    setDeliveryPricing: (input) => businessConfigRepository.setDeliveryPricing(input),
    setServiceEnforcement: (input) => businessConfigRepository.setServiceEnforcement(input),
    getOperationCenter: () => operationsRepository.getCenter(),
    acknowledgeOperationalAlert: (alertId) => operationsRepository.acknowledgeAlert(alertId),
    resolveOperationalAlert: (input) => operationsRepository.resolveAlert(input),
    prepareDailyReconciliation: (input) => operationsRepository.prepareDailyReconciliation(input),
    closeDailyReconciliation: (input) => operationsRepository.closeDailyReconciliation(input),
    getOpeningStatus: () => operationsRepository.getOpeningStatus(),
    setBusinessOpenState: (status) => operationsRepository.setOpenState(status),
    // Los pagos siguen pasando por el repositorio existente: acá sólo se los presenta.
    listPayments: async () => {
      const response = await repository.listMercadoPagoBusinessPayments();
      return response?.ok
        ? { ok: true, data: response.payments || [] }
        : { ok: false, message: response?.message || '' };
    },
    getPaymentsActivation: () => paymentsRepository.getActivationStatus(),
    configurePaymentSettings: (settings) => paymentsRepository.configureSettings(settings),
    reconcilePayment: (paymentIntentId) => repository.reconcileMercadoPagoPayment(paymentIntentId),
    recoverOrder: (checkoutSessionId) => repository.recoverPaidCheckoutOrder(checkoutSessionId),
    refundPayment: (input) => repository.requestMercadoPagoRefund(input),
    getArcaActivation: () => fiscalRepository.getActivationStatus(),
    authorizeArcaHomologation: (phrase) => fiscalRepository.authorizeHomologation(phrase),
    recordFiscalVerification: (verification) => fiscalRepository.recordVerification(verification),
    completeScannedProduct: (input) => inventoryRepository.completeScannedProduct(input),
    getScannedProductReadiness: (productId) => inventoryRepository.getScannedProductReadiness(productId),
    onChange: () => notify(),
  });

  businessCommandController = createBusinessPanelController({
    platform: desktopPlatform,
    reconcileCommand: reconcileBusinessCommand,
    sendCommand: sendBusinessCommand,
    onChange: (snapshot) => {
      businessCommandStatus = snapshot;
      notify();
    },
  });
  try {
    businessCommandStatus = await businessCommandController.initialize();
  } catch (error) {
    // Sin persistencia local (IndexedDB bloqueada o modo privado) el panel
    // sigue operable en modo directo: los comandos van sin outbox y se dice.
    businessCommandController?.destroy?.();
    businessCommandController = null;
    businessCommandStatus = {
      initialized: false,
      commands: [],
      lastDrain: null,
      connectionLabel: 'Sin persistencia local',
      connectionState: 'server_unavailable',
      lastReconciledAt: null,
      pendingCount: 0,
      conflictCount: 0,
      failedCount: 0,
      muted: false,
      attentionRequired: 0,
      storageError: error?.message || 'El almacenamiento local no está disponible.',
    };
    notify();
  }
}

function stopBusinessCommandRuntime() {
  businessCommandController?.destroy?.();
  businessCommandController = null;
  businessCommandStatus = null;
  inventoryRepository = null;
  posRepository = null;
  fiscalRepository = null;
  packingRepository = null;
  operationsRepository = null;
}

async function reconcileBusinessCommand(command) {
  if (command.commandType === 'packing_scan' || command.commandType === 'packing_scan_revert') {
    const response = await packingRepository.manifest({ sessionId: command.payload?.sessionId });
    if (!response?.ok) {
      const error = new Error(response?.message || 'No se pudo reconciliar la preparación.');
      error.code = response?.code || 'SERVER_UNAVAILABLE';
      throw error;
    }
    const manifest = response.data;
    if (manifest.session.businessId !== command.businessId || manifest.session.orderId !== command.orderId) {
      return { conflict: true, code: 'PACKING_SCOPE_MISMATCH', message: 'La sesión de packing pertenece a otro pedido o negocio.' };
    }
    const scan = manifest.scans.find((candidate) => candidate.scanKey === command.payload?.scanKey);
    if (command.commandType === 'packing_scan') {
      if (scan && !scan.revertedAt && scan.gtin === command.payload?.gtin) {
        return { alreadyApplied: true, revision: manifest.session.orderRevision };
      }
      if (scan) return { conflict: true, code: 'PACKING_SCAN_CONFLICT', message: 'La clave de lectura ya existe con otro estado o código.' };
      if (!['in_progress', 'complete'].includes(manifest.session.status)) {
        return { conflict: true, code: 'PACKING_SESSION_CLOSED', message: 'La sesión de packing ya no acepta lecturas.' };
      }
    } else {
      if (scan?.revertedAt) return { alreadyApplied: true, revision: manifest.session.orderRevision };
      if (!scan) return { conflict: true, code: 'PACKING_SCAN_NOT_FOUND', message: 'La lectura a revertir no existe en el servidor.' };
      if (!['in_progress', 'complete'].includes(manifest.session.status)) {
        return { conflict: true, code: 'PACKING_SESSION_CLOSED', message: 'La sesión de packing ya no admite correcciones.' };
      }
    }
    return { manifest, revision: manifest.session.orderRevision };
  }
  const snapshot = await repository.fetchBusinessOrderSnapshot();
  if (!snapshot?.ok) {
    const error = new Error(snapshot?.message || 'No se pudo reconciliar el pedido.');
    error.code = snapshot?.code || 'SERVER_UNAVAILABLE';
    throw error;
  }
  const order = (snapshot.orders || []).find((candidate) => [candidate.id, candidate.backendId, candidate.code]
    .map(String).includes(String(command.orderId)));
  if (!order) return { conflict: true, code: 'NOT_FOUND', message: 'El pedido ya no está en el snapshot autoritativo.' };
  const targetStatus = normalizeWorkflowStatus(command.payload?.newStatus || '');
  const currentStatus = workflowStatus(order);
  if (targetStatus && currentStatus === targetStatus) return { alreadyApplied: true, revision: order.revision };
  if (Number(order.revision) !== Number(command.expectedRevision)) {
    return { conflict: true, code: 'REVISION_CONFLICT', message: 'El pedido cambió en otro dispositivo.', revision: order.revision };
  }
  return { order, revision: order.revision };
}

async function sendBusinessCommand(command) {
  if (command.commandType === 'packing_scan') {
    return packingCommandResult(await packingRepository.scan({
      sessionId: command.payload.sessionId,
      gtin: command.payload.gtin,
      scanKey: command.payload.scanKey,
    }), command.expectedRevision);
  }
  if (command.commandType === 'packing_scan_revert') {
    return packingCommandResult(await packingRepository.revert({
      sessionId: command.payload.sessionId,
      scanKey: command.payload.scanKey,
      idempotencyKey: command.idempotencyKey,
    }), command.expectedRevision);
  }
  const options = {
    expectedRevision: command.expectedRevision,
    idempotencyKey: command.idempotencyKey,
  };
  const response = command.commandType === 'cancel_order'
    ? await repository.cancelBusinessOrder(command.orderId, { ...options, reason: command.payload.reason })
    : await repository.updateOrderStatus(command.orderId, command.payload.newStatus, options);
  return response?.ok
    ? { ok: true, revision: response.order?.revision }
    : {
      ok: false,
      // El conflicto real llega como SQLSTATE 40001 en errorCode; el texto en
      // español queda sólo como red de seguridad si el código no viaja.
      conflict: response?.errorCode === '40001'
        || response?.code === 'ORDER_REVISION_CONFLICT'
        || response?.conflict === true
        || /cambi|revision|revisi/i.test(response?.message || ''),
      retryable: Number(response?.status || 0) === 0 || Number(response?.status || 0) >= 500,
      code: response?.code || response?.errorCode || 'RPC_ERROR',
      message: response?.message,
    };
}

function packingCommandResult(response, revision) {
  return response?.ok
    ? { ok: true, revision }
    : {
      ok: false,
      conflict: ['23505', '23514', '42501', 'P0001', 'P0002'].includes(String(response?.code || '')),
      retryable: Number(response?.status || 0) === 0 || Number(response?.status || 0) >= 500,
      code: response?.code || 'PACKING_RPC_ERROR',
      message: response?.message,
    };
}

async function refreshBusinessPayments() {
  if (!BUSINESS_ROLES.has(access.membership?.role)) return;
  if (typeof repository?.listMercadoPagoBusinessPayments !== 'function') {
    businessPayments = [];
    businessPaymentsStatus = { phase: 'error', message: 'El repositorio no ofrece monitoreo de pagos.' };
    return;
  }
  businessPaymentsStatus = { phase: 'loading', message: '' };
  const result = await repository.listMercadoPagoBusinessPayments();
  if (!result?.ok) {
    businessPayments = [];
    businessPaymentsStatus = { phase: 'error', message: result?.message || 'No pudimos cargar los pagos.' };
    return;
  }
  businessPayments = Array.isArray(result.payments) ? result.payments : [];
  businessPaymentsStatus = { phase: 'ready', message: '' };
}

function startPaymentRefresh() {
  stopPaymentRefresh();
  paymentRefreshTimer = globalThis.setInterval?.(() => {
    refreshBusinessPayments().then(notify).catch(() => {});
  }, 15_000) || null;
}

function stopPaymentRefresh() {
  if (paymentRefreshTimer !== null) globalThis.clearInterval?.(paymentRefreshTimer);
  paymentRefreshTimer = null;
}

function preparePaymentSupport(paymentIntentId) {
  const payment = businessPayments.find((candidate) => (
    String(candidate.payment_intent_id) === String(paymentIntentId)
  ));
  if (!payment) return { handled: true, ok: false, message: 'No encontramos ese pago.' };
  const diagnostic = serializePaymentSupportDiagnostic(payment);
  paymentDiagnostics.set(paymentIntentId, diagnostic);
  const clipboard = globalThis.navigator?.clipboard;
  if (typeof clipboard?.writeText === 'function') {
    clipboard.writeText(diagnostic).catch(() => {});
  }
  notify();
  return {
    handled: true,
    ok: true,
    message: 'Diagnóstico preparado para soporte.',
  };
}

function emptyBusinessIntakeStatus() {
  return {
    phase: 'idle',
    realtime: 'idle',
    lastSuccessfulSyncAt: null,
    error: '',
    reason: '',
  };
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
  const markup = view === 'business' ? businessWorkspaceMarkup() : riderWorkspaceMarkup();
  // Si no cambió nada, no se toca el DOM. El ciclo de sondeo repinta el Panel
  // varias veces por vuelta y muchas de esas veces el contenido es idéntico.
  if (lastWorkspaceMarkup.get(view) === markup) return;

  // Lo que el operador está escribiendo o eligiendo no le pertenece al render:
  // se rescata antes de reemplazar el DOM y se devuelve después.
  //
  // El motivo de cancelación se tipea en un `<input>` SIN atributo `value`, así
  // que el `innerHTML` lo borraba. Y el rider elegido vivía sólo en el `select`:
  // el único `selected` del markup sale de `order.assignedRiderId`, que en una
  // asignación inicial está vacío, así que el navegador volvía a la primera
  // opción de la lista. Con pedidos entrando cada pocos segundos, elegir un
  // rider o escribir un motivo era una carrera contra el repintado.
  const borradores = capturarBorradoresDelOperador(workspace);
  const foco = describirFoco(workspace);

  lastWorkspaceMarkup.set(view, markup);
  workspace.innerHTML = markup;

  restaurarBorradoresDelOperador(workspace, borradores);
  restaurarFoco(workspace, foco);
}

/** El id del pedido de una tarjeta, tomado de sus propias acciones. */
function idDeLaTarjeta(card) {
  return card.querySelector('[data-production-business-cancel]')?.dataset.productionBusinessCancel
    || card.querySelector('[data-production-business-assign]')?.dataset.productionBusinessAssign
    || '';
}

function capturarBorradoresDelOperador(workspace) {
  const borradores = new Map();
  workspace.querySelectorAll('.production-order-card').forEach((card) => {
    const id = idDeLaTarjeta(card);
    if (!id) return;
    const motivo = card.querySelector('[data-production-cancel-reason]')?.value || '';
    const rider = card.querySelector('[data-production-rider-select]')?.value || '';
    if (motivo || rider) borradores.set(id, { motivo, rider });
  });
  return borradores;
}

function restaurarBorradoresDelOperador(workspace, borradores) {
  if (!borradores.size) return;
  workspace.querySelectorAll('.production-order-card').forEach((card) => {
    const guardado = borradores.get(idDeLaTarjeta(card));
    if (!guardado) return;
    const motivo = card.querySelector('[data-production-cancel-reason]');
    if (motivo && guardado.motivo) motivo.value = guardado.motivo;
    const rider = card.querySelector('[data-production-rider-select]');
    // Sólo si la opción sigue existiendo: un rider que salió de turno no puede
    // quedar seleccionado de forma fantasma.
    if (rider && guardado.rider
      && Array.from(rider.options || []).some((option) => option.value === guardado.rider)) {
      rider.value = guardado.rider;
    }
  });
}

/**
 * Dónde estaba el cursor. Perder el foco a mitad de una palabra es peor que
 * perder el texto: la persona sigue tecleando y las letras no van a ningún lado.
 */
function describirFoco(workspace) {
  const activo = document.activeElement;
  if (!activo || !workspace.contains(activo)) return null;
  const card = activo.closest?.('.production-order-card');
  const campo = activo.matches?.('[data-production-cancel-reason]')
    ? 'motivo'
    : activo.matches?.('[data-production-rider-select]') ? 'rider' : '';
  if (card && campo) {
    return {
      id: idDeLaTarjeta(card),
      campo,
      inicio: activo.selectionStart ?? null,
      fin: activo.selectionEnd ?? null,
    };
  }
  // Todo lo DEMÁS del panel también pierde el foco cuando el repintado
  // reemplaza el DOM, y hasta acá no se rescataba nada: sólo el motivo de
  // cancelación y el selector de rider.
  //
  // Lo encontró una prueba que se puso intermitente. «El foco recorre la
  // navegación con teclado» pasaba sola y fallaba dentro de la suite, y la
  // diferencia era el tiempo: el markup del workspace incluye la marca de la
  // última sincronización, así que cambia por su cuenta, y cuando cambiaba
  // entre el `focus()` y el `Tab` el foco se había ido al `body`.
  //
  // O sea que quien recorre el Panel con teclado pierde el lugar cada vez que
  // el reloj avanza. No es un problema de la prueba.
  const selector = selectorEstable(activo);
  return selector ? { selector } : null;
}

/**
 * Un selector con el que volver a encontrar este control después del repintado.
 *
 * Se arma con los `data-*` del propio elemento porque son los que el marcado
 * vuelve a escribir igual: `data-business-ops-view="payments"` identifica al
 * mismo destino antes y después. Si el control desapareció —una acción que ya
 * no corresponde, un pedido que avanzó— el selector no encuentra nada y el foco
 * NO se restaura, que es lo correcto: devolverlo a otro botón sería peor que
 * perderlo.
 */
function selectorEstable(nodo) {
  if (nodo.id) return `[id="${nodo.id}"]`;
  const atributos = Array.from(nodo.attributes || [])
    .filter((atributo) => atributo.name.startsWith('data-'))
    // Un valor con comillas o barras rompería el selector; ninguno de los que
    // usa el Panel las tiene, y si algún día las tuviera es mejor no restaurar
    // el foco que construir un selector inválido.
    .filter((atributo) => !/["\\]/.test(atributo.value))
    .map((atributo) => (atributo.value ? `[${atributo.name}="${atributo.value}"]` : `[${atributo.name}]`));
  if (!atributos.length) return '';
  return `${nodo.tagName.toLowerCase()}${atributos.join('')}`;
}

function restaurarFoco(workspace, foco) {
  if (foco?.selector) {
    const candidato = workspace.querySelector(foco.selector);
    // `preventScroll` sólo en este camino. El campo de texto se restaura sin
    // él a propósito -quien está escribiendo quiere verlo- pero un botón que
    // recupera el foco por un repintado del reloj no tiene por qué arrastrar
    // la página adonde estaba hace un minuto.
    if (candidato) candidato.focus({ preventScroll: true });
    return;
  }
  if (!foco?.id) return;
  const card = Array.from(workspace.querySelectorAll('.production-order-card'))
    .find((candidate) => idDeLaTarjeta(candidate) === foco.id);
  const selector = foco.campo === 'motivo'
    ? '[data-production-cancel-reason]'
    : '[data-production-rider-select]';
  const destino = card?.querySelector(selector);
  if (!destino) return;
  destino.focus();
  if (foco.campo === 'motivo' && foco.inicio != null && typeof destino.setSelectionRange === 'function') {
    try {
      destino.setSelectionRange(foco.inicio, foco.fin ?? foco.inicio);
    } catch (_) {
      // Un input que no admite selección no puede romper el render.
    }
  }
}

// El orden del día: abrir, mirar, atender, preparar, cobrar, cerrar.
const BUSINESS_VIEW_ORDER = Object.freeze([
  'day-open', 'operation-center', 'orders', 'payments', 'packing', 'pos', 'scanner',
  'product-create', 'inventory-receive', 'inventory-adjust', 'stock-count',
  'fiscal-status', 'fiscal-setup', 'fiscal-config', 'payments-setup', 'devices', 'day-close',
]);

const BUSINESS_VIEW_SHORT_LABELS = Object.freeze({
  'day-open': 'Abrir', 'operation-center': 'Qué pasa', orders: 'Pedidos', payments: 'Pagos',
  'product-create': 'Alta', 'inventory-receive': 'Recepción', 'day-close': 'Cerrar',
});

/**
 * Los cuatro destinos que van abajo en un teléfono, por orden de preferencia.
 *
 * En escritorio los diecisiete destinos entran en una fila que se desplaza y
 * eso funciona. En 390px la misma fila se envolvía en SEIS renglones de
 * píldoras: medido, 290px de navegación antes del primer pedido, con la primera
 * tarjeta empezando en y≈715 de 844. Quien atiende desde el mostrador tenía que
 * pasar una pantalla entera de botones para ver que entró un pedido.
 *
 * Cuatro y no nueve. La barra inferior es para lo que se toca durante el turno
 * —lo que entra, lo que hay que mirar, lo que se cobra, lo que se vende en el
 * mostrador—; todo lo demás es configuración o cierre y vive en la hoja de
 * «Más», que se abre desde la misma barra.
 *
 * Es una preferencia, no una lista fija: se filtra por lo que el rol tiene
 * permitido, así que un `staff` sin acceso a pagos recibe el siguiente de la
 * lista en vez de un botón que no puede usar.
 */
const BUSINESS_PRIMARY_MOBILE_VIEWS = Object.freeze([
  'orders', 'operation-center', 'payments', 'pos', 'packing', 'day-open',
]);
const BUSINESS_MOBILE_NAV_SLOTS = 4;

/** Los destinos de la barra inferior y los que quedan en la hoja de «Más». */
export function splitBusinessMobileNavigation(allowedViews, {
  slots = BUSINESS_MOBILE_NAV_SLOTS,
  preferred = BUSINESS_PRIMARY_MOBILE_VIEWS,
  order = BUSINESS_VIEW_ORDER,
} = {}) {
  const allowed = new Set(allowedViews);
  const primary = preferred.filter((view) => allowed.has(view)).slice(0, slots);
  const primarySet = new Set(primary);
  const rest = order.filter((view) => allowed.has(view) && !primarySet.has(view));
  return { primary, rest };
}

function businessViewLabel(view) {
  return BUSINESS_VIEW_SHORT_LABELS[view] || businessOperationViewLabel(view);
}

/** El atributo con el que cada destino se despacha. `orders` tiene el suyo. */
function businessViewTrigger(view) {
  return view === 'orders'
    ? 'data-production-orders-view'
    : `data-business-ops-view="${escapeAttribute(view)}"`;
}

function businessWorkspaceMarkup() {
  const role = access.membership?.role;
  const allowedList = allowedBusinessOperationViews(role);
  const allowed = new Set(allowedList);
  const paymentMonitor = BUSINESS_ROLES.has(access.membership?.role)
    ? businessPaymentsMarkup()
    : '';
  const orders = getState().orders;
  const rows = orders.length
    ? orders.map(businessOrderMarkup).join('')
    : emptyMarkup('Todavía no hay pedidos visibles para este comercio.');
  const operations = businessOperationsView === 'orders'
    ? `<div class="production-order-list" aria-live="polite">${rows}</div>`
    : renderBusinessOperations(businessOperationsView);
  // Una sola navegación para todo el panel: dos filas con los mismos destinos confunden.
  const shortcuts = BUSINESS_VIEW_ORDER
    .filter((view) => allowed.has(view))
    .map((view) => `
      <button type="button" class="business-ops-nav-button ${businessOperationsView === view ? 'active' : ''}"
        aria-pressed="${businessOperationsView === view}"
        ${businessViewTrigger(view)}>${escapeHtml(businessViewLabel(view))}</button>`)
    .join('');

  const { primary, rest } = splitBusinessMobileNavigation(allowedList);
  const enLaHoja = rest.includes(businessOperationsView);
  const bottomNav = primary.map((view) => `
      <button type="button" class="panel-nav-item ${businessOperationsView === view ? 'is-active' : ''}"
        aria-pressed="${businessOperationsView === view}"
        ${businessViewTrigger(view)}>
        <span class="panel-nav-ico" aria-hidden="true">${BUSINESS_VIEW_ICONS[view] || BUSINESS_VIEW_ICONS.default}</span>
        <span class="panel-nav-label">${escapeHtml(businessViewLabel(view))}</span>
      </button>`).join('');
  const restLinks = rest.map((view) => `
      <button type="button" class="panel-more-item ${businessOperationsView === view ? 'is-active' : ''}"
        aria-pressed="${businessOperationsView === view}"
        ${businessViewTrigger(view)}>${escapeHtml(businessViewLabel(view))}</button>`).join('');

  return `
    <div class="production-ops-head">
      <div class="production-ops-identity">
        <p class="eyebrow">Panel del negocio</p>
        <h1>Tu día, en un solo lugar</h1>
        <p class="production-ops-role">${escapeHtml(roleLabel(role))} · sesión verificada</p>
      </div>
      <button class="ghost-button compact production-ops-signout" type="button" data-production-sign-out>Cerrar sesión</button>
    </div>
    <div class="production-ops-status">
      ${businessIntakeStatusMarkup()}
      ${businessCommandStatusMarkup()}
    </div>
    <nav class="production-operations-shortcuts" aria-label="Atajos del día">${shortcuts}</nav>
    ${operations}
    <nav class="panel-bottom-nav" aria-label="Secciones del panel" data-panel-bottom-nav>
      ${bottomNav}
      <button type="button" class="panel-nav-item panel-nav-more ${enLaHoja ? 'is-active' : ''}"
        aria-expanded="${panelMoreSheetOpen}" aria-controls="panel-more-sheet" data-panel-more-toggle>
        <span class="panel-nav-ico" aria-hidden="true">${BUSINESS_VIEW_ICONS.more}</span>
        <span class="panel-nav-label">Más</span>
      </button>
    </nav>
    <div class="panel-more-backdrop" data-panel-more-close ${panelMoreSheetOpen ? '' : 'hidden'}></div>
    <section class="panel-more-sheet" id="panel-more-sheet" data-panel-more-sheet
      role="dialog" aria-label="Más secciones del panel" ${panelMoreSheetOpen ? '' : 'hidden'}>
      <div class="panel-more-head">
        <strong>Más secciones</strong>
        <button class="ghost-button compact" type="button" data-panel-more-close>Cerrar</button>
      </div>
      <div class="panel-more-grid">${restLinks}</div>
    </section>
  `;
}

/**
 * Un glifo por destino. Son caracteres, no un set de iconos: el proyecto no
 * sirve ninguna fuente que no sea del sistema y agregar una por la barra
 * inferior sería pagar una descarga por decoración. Cada uno va con
 * `aria-hidden` y su etiqueta de texto al lado, así que no cargan significado.
 */
const BUSINESS_VIEW_ICONS = Object.freeze({
  orders: '▦',
  'operation-center': '◎',
  payments: '$',
  pos: '▤',
  packing: '▣',
  'day-open': '▲',
  more: '⋯',
  default: '•',
});

function businessCommandStatusMarkup() {
  const status = businessCommandStatus;
  if (!status) return '<p class="production-command-status">Persistencia local iniciando…</p>';
  const attention = Number(status.attentionRequired || 0);
  const lastSync = status.lastReconciledAt ? dateTime(status.lastReconciledAt) : 'sin reconciliación confirmada';
  // `is-quiet` = no hay nada que hacer: conectado, sin comandos esperando y sin
  // nada que requiera intervención. Es lo que le permite al teléfono mostrar
  // una palabra en vez de tres datos; el marcado no cambia, sólo deja de ocupar
  // la pantalla mientras la respuesta sea «todo bien». Se calcula acá y no en
  // CSS porque la hoja de estilo no puede saber si el contador está en cero.
  const quiet = status.connectionState === 'connected'
    && Number(status.pendingCount || 0) === 0
    && attention === 0;
  const pending = Number(status.pendingCount || 0);
  // El recuento en cero no se escribe: la etiqueta de al lado ya dice «Sin
  // comandos pendientes», así que «0 comandos pendientes» es la misma frase dos
  // veces. Con uno o más, el número es el dato y se muestra siempre —también en
  // escritorio—, porque ahí sí hay algo esperando.
  const pendingSpan = pending > 0
    ? `<span>${pending} comando${pending === 1 ? '' : 's'} pendiente${pending === 1 ? '' : 's'}</span>`
    : '';
  return `<div class="production-command-status is-${escapeAttribute(status.connectionState)}${quiet ? ' is-quiet' : ''}" data-business-command-status>
    <strong>${escapeHtml(status.connectionLabel)}</strong>
    <span>Última reconciliación: ${escapeHtml(lastSync)}</span>
    ${pendingSpan}
    ${attention ? `<span class="production-intake-error">${attention} requiere${attention === 1 ? '' : 'n'} intervención</span>` : ''}
  </div>`;
}

function businessPaymentsMarkup() {
  const body = businessPayments.length
    ? businessPayments.map(businessPaymentMarkup).join('')
    : businessPaymentsStatus.phase === 'loading'
      ? '<p class="form-hint">Cargando pagos verificados…</p>'
      : businessPaymentsStatus.phase === 'error'
        ? `<p class="production-intake-error">${escapeHtml(businessPaymentsStatus.message)}</p>`
        : '<p class="form-hint">Todavía no hay pagos de Mercado Pago para mostrar.</p>';
  return `
    <section class="production-payments-section" aria-labelledby="production-payments-title">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Recuperación segura</p>
          <h2 id="production-payments-title">Pagos y pedidos</h2>
        </div>
        <div class="button-row">
          <span class="form-hint">Consulta para el equipo</span>
          <button class="ghost-button compact" type="button" data-production-payment-refresh-all>Actualizar ahora</button>
        </div>
      </div>
      <div class="production-payment-list" aria-live="polite">${body}</div>
    </section>
  `;
}

function businessPaymentMarkup(payment) {
  const copy = paymentRecoveryCopy(payment);
  const state = paymentRecoveryState(payment);
  const paymentIntentId = String(payment.payment_intent_id || '');
  const busy = paymentActionsInFlight.has(paymentIntentId);
  const canOperate = ['owner', 'admin'].includes(access.membership?.role) && payment.can_operate !== false;
  const recoveryActions = canOperate
    ? paymentRecoveryActions(payment)
    : [{ kind: 'view', label: 'Ver pago' }];
  const actions = recoveryActions.map((action) => paymentActionMarkup(payment, action, busy)).join('');
  const actionMessage = paymentActionMessages.get(paymentIntentId) || '';
  const diagnostic = paymentDiagnostics.get(paymentIntentId);
  const worker = payment.processing_state || paymentWorkerState(payment);
  const order = payment.order_public_code || 'Pedido todavía no confirmado';
  const method = payment.method || 'Mercado Pago';
  const technical = [
    ['Estado interno', payment.internal_status],
    ['Estado del proveedor', payment.provider_status],
    ['Detalle técnico', payment.provider_status_detail],
    ['Motivo de revisión', payment.security_review_reason],
    ['Sesión de checkout', payment.checkout_session_id],
    ['ID de correlación', payment.correlation_id],
    ['Procesamiento', payment.worker_status],
    ['Intentos del procesamiento', payment.worker_attempts],
    ['Último error sanitizado', payment.worker_last_error],
  ].filter(([, value]) => value !== null && value !== undefined && value !== '').map(([label, value]) => `
    <div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>
  `).join('');
  return `
    <article class="production-payment-card" data-payment-recovery-state="${escapeAttribute(state)}">
      <div class="production-order-head">
        <div>
          <span class="production-order-code">${escapeHtml(order)}</span>
          <strong>${escapeHtml(copy.title)}</strong>
        </div>
        <span class="status-pill ${escapeAttribute(paymentStatusClass(payment))}">${escapeHtml(copy.label)}</span>
      </div>
      <p class="form-hint">${escapeHtml(copy.message)}</p>
      <dl class="production-order-meta">
        <div><dt>Importe</dt><dd>${escapeHtml(formatOrderMoney(payment.amount, payment.currency))}</dd></div>
        <div><dt>Método</dt><dd>${escapeHtml(method)}</dd></div>
        <div><dt>Cliente</dt><dd>${escapeHtml(payment.customer_label || 'No informado')}</dd></div>
        <div><dt>Hora</dt><dd>${escapeHtml(dateTime(payment.approved_at || payment.created_at))}</dd></div>
        <div><dt>Intentos</dt><dd>${escapeHtml(String(payment.attempt_count ?? 0))}</dd></div>
        <div><dt>Última actualización</dt><dd>${escapeHtml(dateTime(payment.last_update_at || payment.created_at))}</dd></div>
        <div><dt>Pago</dt><dd>${escapeHtml(payment.payment_id_short ? `••••${payment.payment_id_short}` : 'Aún sin ID')}</dd></div>
      </dl>
      <p class="form-hint">${escapeHtml(worker)}</p>
      ${payment.documentation_required ? '<p class="production-intake-error">Se necesita intervención del responsable para una disputa.</p>' : ''}
      ${actionMessage ? `<p class="form-hint" role="status" aria-live="polite">${escapeHtml(actionMessage)}</p>` : ''}
      ${actions ? `<div class="button-row">${actions}</div>` : '<p class="form-hint">No hay una acción disponible para este estado.</p>'}
      <details>
        <summary>Ver información técnica</summary>
        <dl class="production-order-meta">${technical || '<div><dd>No hay información técnica adicional.</dd></div>'}</dl>
        ${diagnostic ? `<pre class="form-hint">${escapeHtml(diagnostic)}</pre>` : ''}
      </details>
    </article>
  `;
}

function paymentActionMarkup(payment, action, busy) {
  const id = escapeAttribute(payment.payment_intent_id);
  const disabled = busy ? ' disabled aria-disabled="true"' : '';
  if (action.kind === 'reconcile') {
    return `<button class="${action.primary ? 'primary-button' : 'ghost-button'} compact" type="button" data-production-payment-reconcile="${id}"${disabled}>${escapeHtml(busy ? 'Reintentando…' : action.label)}</button>`;
  }
  if (action.kind === 'reactivate') {
    return `<button class="${action.primary ? 'primary-button' : 'ghost-button'} compact" type="button" data-production-payment-reactivate="${id}"${disabled}>${escapeHtml(busy ? 'Reintentando…' : action.label)}</button>`;
  }
  if (action.kind === 'refresh') {
    return `<button class="${action.primary ? 'primary-button' : 'ghost-button'} compact" type="button" data-production-payment-refresh="${id}"${disabled}>${escapeHtml(action.label)}</button>`;
  }
  if (action.kind === 'refund') {
    return `<button class="${action.primary ? 'primary-button' : 'ghost-button'} compact" type="button" data-production-payment-refund="${id}"${disabled}>${escapeHtml(action.label)}</button>`;
  }
  if (action.kind === 'cancel') {
    return `<button class="ghost-button compact" type="button" data-production-payment-cancel="${id}"${disabled}>${escapeHtml(action.label)}</button>`;
  }
  if (action.kind === 'support') {
    return `<button class="ghost-button compact" type="button" data-production-payment-support="${id}"${disabled}>${escapeHtml(action.label)}</button>`;
  }
  return `<button class="ghost-button compact" type="button" data-production-payment-view="${id}"${disabled}>${escapeHtml(action.label)}</button>`;
}

function paymentStatusClass(payment) {
  const state = paymentRecoveryState(payment);
  if ([PAYMENT_RECOVERY_STATES.NEEDS_REVIEW, PAYMENT_RECOVERY_STATES.NEEDS_OWNER_INTERVENTION].includes(state)) return 'received';
  if ([PAYMENT_RECOVERY_STATES.REJECTED].includes(state)) return 'canceled';
  if ([PAYMENT_RECOVERY_STATES.ORDER_CONFIRMED, PAYMENT_RECOVERY_STATES.REFUND_CONFIRMED].includes(state)) return 'delivered';
  return 'submitted';
}

function businessIntakeStatusMarkup() {
  const hasRecentSnapshot = Boolean(businessIntakeStatus.lastSuccessfulSyncAt);
  const label = businessIntakeStatus.phase === 'offline'
    ? 'Sin conexión'
    : businessIntakeStatus.phase === 'error'
      ? 'Error recuperable'
      : businessIntakeStatus.phase === 'connected' && hasRecentSnapshot
        ? 'Conectado'
        : 'Recuperando pedidos';
  const lastSync = hasRecentSnapshot
    ? `Última sincronización: ${dateTime(businessIntakeStatus.lastSuccessfulSyncAt)}`
    : 'Todavía sin una sincronización exitosa';
  const error = businessIntakeStatus.phase === 'error' && businessIntakeStatus.error
    ? `<span class="production-intake-error">${escapeHtml(businessIntakeStatus.error)}</span>`
    : '';
  // Ver `businessCommandStatusMarkup`: `is-quiet` es «no hay nada que mirar».
  const quiet = businessIntakeStatus.phase === 'connected' && hasRecentSnapshot;
  return `
    <div class="production-intake-status is-${escapeAttribute(businessIntakeStatus.phase)}${quiet ? ' is-quiet' : ''}" data-business-intake-status>
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(lastSync)}</span>
      ${error}
    </div>
  `;
}

/** «Marco · 2/3». La capacidad se dice al lado del nombre, donde se elige. */
function riderOptionLabel(rider) {
  if (!Number.isFinite(rider?.activeOrders) || !Number.isFinite(rider?.maxActiveOrders)) {
    return rider?.displayName || 'Rider';
  }
  const capacity = `${rider.activeOrders}/${rider.maxActiveOrders}`;
  return rider.atCapacity
    ? `${rider.displayName} · ${capacity} (sin cupo)`
    : `${rider.displayName} · ${capacity}`;
}

function riderAssignmentLabel(current) {
  if (!supportsRiderOffers()) return current === 'assigned' ? 'Reasignar rider' : 'Asignar rider';
  return current === 'assigned' ? 'Reasignar rider' : 'Ofrecer a un rider';
}

function riderAssignmentAction(current) {
  if (!supportsRiderOffers()) return current === 'assigned' ? 'Reasignar' : 'Asignar';
  return current === 'assigned' ? 'Reasignar' : 'Ofrecer';
}

const RIDER_OFFER_REASONS = Object.freeze({
  too_far: 'queda lejos',
  vehicle_problem: 'problema con el vehículo',
  load_too_big: 'la carga no le entra',
  ending_shift: 'está terminando',
  other: 'otro motivo',
});

/**
 * El paso que antes no existía: entre «asignado» y «en camino» ahora hay una
 * respuesta del rider, y el Panel tiene que poder verla sin adivinarla.
 */
function riderOfferMarkup(offer) {
  if (!offer) return '';
  if (offer.status === 'pending') {
    return `
      <div class="production-rider-offer is-pending" role="status">
        <p><strong>Esperando respuesta del rider</strong> · ${escapeHtml(offer.riderDisplayName)}</p>
        <p class="form-hint">Ofrecido ${escapeHtml(dateTime(offer.offeredAt))}. El pedido sigue disponible hasta que acepte.</p>
        <button
          class="ghost-button compact"
          type="button"
          data-production-offer-withdraw="${escapeAttribute(offer.offerId)}"
        >Retirar oferta</button>
      </div>
    `;
  }
  if (offer.status === 'rejected') {
    const reason = RIDER_OFFER_REASONS[offer.reasonCode];
    return `
      <div class="production-rider-offer is-rejected" role="status">
        <p><strong>Rechazado por el rider</strong> · ${escapeHtml(offer.riderDisplayName)}${reason ? ` (${escapeHtml(reason)})` : ''}</p>
        <p class="form-hint">Elegí otro rider: a éste ya no se le puede volver a ofrecer este pedido.</p>
      </div>
    `;
  }
  if (offer.status === 'accepted') {
    return `
      <div class="production-rider-offer is-accepted" role="status">
        <p><strong>Aceptado</strong> · ${escapeHtml(offer.riderDisplayName)}</p>
      </div>
    `;
  }
  if (offer.status === 'withdrawn') {
    return `
      <div class="production-rider-offer is-withdrawn" role="status">
        <p><strong>Oferta retirada</strong> · ${escapeHtml(offer.riderDisplayName)}</p>
      </div>
    `;
  }
  return '';
}

/**
 * ¿El cliente escribió algo, o es el relleno del saneador?
 *
 * `sanitizeNotes()` devuelve 'Sin notas' cuando el campo viene vacío, así que
 * `order.notes` SIEMPRE es verdadero y la tarjeta imprimía «Observaciones: Sin
 * notas» en todos los pedidos que no tenían ninguna. Un renglón por tarjeta que
 * no dice nada, multiplicado por la cola entera.
 *
 * El relleno se compara acá y no se cambia en el saneador: hay superficies del
 * cliente —el historial, el perfil— donde «Sin notas» es la respuesta correcta
 * a «¿qué aclaró?». Lo que no corresponde es ocupar una línea del tablero para
 * decirlo.
 */
function hasCustomerNotes(order) {
  const notes = String(order?.notes || '').trim();
  return notes.length > 0 && notes.toLowerCase() !== 'sin notas';
}

function businessOrderMarkup(order) {
  const next = canAdvanceProductionBusinessOrder(order, businessPayments)
    ? nextBusinessStatus(order)
    : null;
  const current = workflowStatus(order);
  const terminal = TERMINAL_STATUSES.has(current);
  const canCancel = canCancelProductionBusinessOrder(order, businessPayments);
  const itemCount = (order.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const items = (order.items || []).map((item) => `
    <li>
      <strong>${escapeHtml(String(item.quantity || 0))} × ${escapeHtml(item.name || 'Producto')}</strong>
      ${item.unit ? `<span>${escapeHtml(item.unit)}</span>` : ''}
    </li>
  `).join('');
  const canAssignRider = canAssignBusinessRider(order, businessPayments);
  const offer = riderOfferForOrder(order);
  // Con una oferta viva el pedido no se vuelve a ofrecer: primero se retira.
  const offerPending = offer?.status === 'pending';
  const riderOptions = activeBusinessRiders.map((rider) => `
    <option
      value="${escapeAttribute(rider.id)}"
      ${rider.id === order.assignedRiderId ? 'selected' : ''}
      ${rider.atCapacity ? 'disabled' : ''}
    >${escapeHtml(riderOptionLabel(rider))}</option>
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
        ${Number(order.discountTotal || 0) > 0 ? `
        <div><dt>Combo del local</dt><dd>−${escapeHtml(formatOrderMoney(order.discountTotal, order.currencyCode))}</dd></div>
        ` : ''}
        <div><dt>Total</dt><dd>${escapeHtml(formatOrderMoney(order.total, order.currencyCode))}</dd></div>
      </dl>
      ${(order.combos || []).length ? `
      <ul class="production-order-items" aria-label="Combos del pedido">${order.combos.map((combo) => `
        <li>
          <strong>${escapeHtml(String(combo.quantity))} × ${escapeHtml(combo.name)} (combo)</strong>
          <span>a ${escapeHtml(formatOrderMoney(combo.promotionalPrice, order.currencyCode))} c/u — los productos de abajo son sus componentes</span>
        </li>
      `).join('')}</ul>
      ` : ''}
      <ul class="production-order-items" aria-label="Detalle de productos">${items}</ul>
      <dl class="production-order-contact">
        <div><dt>Teléfono</dt><dd>${escapeHtml(order.customerPhone || 'No informado')}</dd></div>
        <div><dt>Pago</dt><dd>${escapeHtml(order.paymentMethod || 'No informado')}</dd></div>
      </dl>
      <p class="production-order-address">${escapeHtml(order.address || 'Sin dirección publicada')}</p>
      ${order.addressDetails?.reference
        ? `<p class="form-hint">Referencia: ${escapeHtml(order.addressDetails.reference)}</p>`
        : ''}
      ${order.deliveryMode === 'pickup' ? '' : renderDeliveryPoint(order.addressDetails)}
      ${hasCustomerNotes(order)
        ? `<p class="production-order-notes"><strong>Observaciones:</strong> ${escapeHtml(order.notes)}</p>`
        : ''}
      <div class="button-row">
        ${next ? `
          <button
            class="primary-button compact"
            type="button"
            data-production-business-next="${escapeAttribute(order.id)}"
            data-next-status="${escapeAttribute(next)}"
            ${orderActionsInFlight.has(order.id) ? 'disabled aria-disabled="true"' : ''}
          >${orderActionsInFlight.has(order.id) ? 'Confirmando…' : escapeHtml(actionLabel(next, 'business'))}</button>
        ` : ''}
        ${canCancel ? `
          <label class="production-cancel-control">
            <span class="sr-only">Motivo de cancelación</span>
            <input type="text" maxlength="160" placeholder="Motivo obligatorio" data-production-cancel-reason>
          </label>
          <button
            class="ghost-button compact"
            type="button"
            data-production-business-cancel="${escapeAttribute(order.id)}"
          >Cancelar con motivo</button>
        ` : (!terminal && isMercadoPagoOrder(order)
          ? '<p class="form-hint">Pedido cobrado por Mercado Pago: completá la devolución total desde Pagos para habilitar la cancelación.</p>'
          : '')}
      </div>
      ${riderOfferMarkup(offer)}
      ${canAssignRider && !offerPending ? `
        <div class="production-rider-assignment">
          ${riderOptions ? `
            <label>
              <span>${riderAssignmentLabel(current)}</span>
              <select data-production-rider-select>
                ${riderOptions}
              </select>
            </label>
            <button
              class="secondary-button compact"
              type="button"
              data-production-business-assign="${escapeAttribute(order.id)}"
            >${riderAssignmentAction(current)}</button>
          ` : '<p class="form-hint">No hay riders activos habilitados para asignar.</p>'}
          ${activeBusinessRiders.length && activeBusinessRiders.every((rider) => rider.atCapacity)
            ? '<p class="form-hint">Todos los riders están con 3 entregas activas. Esperá a que liberen una.</p>'
            : ''}
        </div>
      ` : ''}
    </article>
  `;
}

function riderWorkspaceMarkup() {
  // "Mis entregas" son las asignadas a esta cuenta. Un pedido `ready` sin
  // asignar pertenece a la cola de claim, no acá: mostrarlo como entrega
  // activa ofrecía un avance que el servidor rechaza.
  const orders = getState().orders.filter((order) => (
    order.deliveryMode === 'delivery'
    && ['assigned', 'picked_up', 'on_the_way', 'arrived'].includes(workflowStatus(order))
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
        data-expected-revision="${escapeAttribute(String(order.revision ?? ''))}"
        ${orderActionsInFlight.has(order.publicCode) ? 'disabled aria-disabled="true"' : ''}
      >${orderActionsInFlight.has(order.publicCode) ? 'Asignando…' : 'Aceptar entrega'}</button>
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
      ${showPrivateDelivery ? renderDeliveryPoint(order.addressDetails) : ''}
      <div class="button-row">
        ${next ? `
          <button
            class="primary-button compact"
            type="button"
            data-production-rider-next="${escapeAttribute(order.id)}"
            data-next-status="${escapeAttribute(next)}"
            ${orderActionsInFlight.has(order.id) ? 'disabled aria-disabled="true"' : ''}
          >${orderActionsInFlight.has(order.id) ? 'Confirmando…' : escapeHtml(actionLabel(next, 'rider'))}</button>
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

// El contrato de oferta es opcional a propósito: los repositorios de demo y de
// sandbox no lo tienen, y el Panel tiene que seguir funcionando ahí con la
// asignación directa de siempre.
function supportsRiderOffers() {
  return typeof repository?.offerOrderToRider === 'function'
    && typeof repository?.listRiderOrderOffers === 'function';
}

async function refreshActiveBusinessRiders() {
  if (typeof repository?.listActiveRiders !== 'function') return;
  const result = await repository.listActiveRiders();
  activeBusinessRiders = result?.ok && Array.isArray(result.riders) ? result.riders : activeBusinessRiders;
}

async function refreshRiderOrderOffers() {
  if (!supportsRiderOffers()) {
    riderOrderOffers = [];
    return;
  }
  const result = await repository.listRiderOrderOffers();
  riderOrderOffers = result?.ok && Array.isArray(result.offers) ? result.offers : [];
}

/** Oferta vigente de un pedido: la pendiente si la hay, si no la última resuelta. */
function riderOfferForOrder(order) {
  if (!order) return null;
  const matches = riderOrderOffers.filter((offer) => (
    offer.orderId === order.backendId
    || offer.orderId === order.id
    || offer.publicCode === order.code
    || offer.publicCode === order.id
  ));
  if (!matches.length) return null;
  return matches.find((offer) => offer.status === 'pending') || matches[0];
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

// Las claves NO llevan dos puntos: el contrato del servidor valida
// `^[A-Za-z0-9_-]{8,128}$` y una clave con `:` muere en 22023 antes de tocar
// el pedido. Guion como separador, determinístico por (comando, pedido,
// revisión, destino) para que el reintento sea replay y el doble click no-op.
function orderCommandKey(commandType, backendId, revision, nextStatus) {
  return `${commandType}-${backendId}-${revision}-${nextStatus}`.replace(/[^A-Za-z0-9_-]/g, '-');
}

async function updateOrderFromAction(orderId, nextStatus, { commandType = 'transition_order', reason = '' } = {}) {
  if (!orderId || !nextStatus) {
    return { handled: true, ok: false, message: 'Acción de pedido inválida.' };
  }
  if (orderActionsInFlight.has(orderId)) {
    return { handled: true, ok: false, message: 'Ya estamos procesando este pedido.' };
  }
  const currentOrder = getState().orders.find((order) => (
    order.id === orderId || order.backendId === orderId || order.code === orderId
  ));
  orderActionsInFlight.add(orderId);
  notify();
  try {
    const isRider = access.membership?.role === 'rider';
    const result = businessCommandController && !isRider
      ? await businessCommandController.queue({
        businessId: access.membership.business_id,
        orderId,
        commandType,
        expectedRevision: currentOrder?.revision,
        idempotencyKey: orderCommandKey(commandType, currentOrder?.backendId || orderId, currentOrder?.revision, nextStatus),
        payload: { newStatus: nextStatus, ...(reason ? { reason } : {}) },
      })
      : isRider
        ? await repository.advanceRiderDelivery(orderId, nextStatus, {
          expectedRevision: currentOrder?.revision,
          idempotencyKey: orderCommandKey('rider', currentOrder?.backendId || orderId, currentOrder?.revision, nextStatus),
        })
        : await repository.updateOrderStatus(orderId, nextStatus, {
          expectedRevision: currentOrder?.revision,
          idempotencyKey: orderCommandKey('direct', currentOrder?.backendId || orderId, currentOrder?.revision, nextStatus),
        });
    if (result.ok) {
      if (isRider) await refreshRiderOrders();
      else await businessIntake?.invalidate?.('status-transition');
    }
    return {
      handled: true,
      ok: result.ok,
      message: result.ok ? 'Estado confirmado por el servidor.' : result.message,
    };
  } finally {
    orderActionsInFlight.delete(orderId);
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
  if (role === 'owner') return 'Dueño';
  if (role === 'admin') return 'Encargado';
  if (role === 'staff') return 'Equipo';
  if (role === 'rider') return 'Repartidor';
  return 'Cuenta';
}

// El punto de entrega en el Panel del negocio y en la vista del repartidor.
//
// Este es el Panel que el comercio usa de verdad: mostraba sólo el texto de la
// dirección, así que la coordenada que el cliente confirmó quedaba guardada en
// el pedido sin que nadie pudiera verla ni abrirla. El enlace va POR
// COORDENADAS; mandarle el texto a Google es pedirle que adivine, y con
// «Mendoza 827» ya resolvió una vez a 175 km.
//
// Un pedido anterior al contrato no tiene punto, y eso se dice.
function renderDeliveryPoint(addressDetails) {
  const point = plottableDeliveryPoint(addressDetails || {});
  if (!point) {
    return '<p class="production-order-point" data-delivery-point="missing">Punto de entrega: sin confirmar</p>';
  }
  const confirmado = Boolean(addressDetails?.locationConfirmedAt);
  const precision = deliveryLocationAccuracyLabel({ accuracyMeters: addressDetails?.geolocationAccuracy });
  const par = `${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}`;
  const detalle = [confirmado ? 'confirmado por el cliente' : 'sin confirmación del cliente', precision]
    .filter(Boolean)
    .join(' · ');
  return `<p class="production-order-point" data-delivery-point="${confirmado ? 'confirmed' : 'unconfirmed'}">
    Punto de entrega:
    <a href="${escapeAttribute(deliveryDestinationSearchUrl(addressDetails))}" target="_blank" rel="noopener noreferrer" data-delivery-point-map>${escapeHtml(par)}</a>
    <span class="form-hint">${escapeHtml(detalle)}</span>
  </p>`;
}

function actionLabel(status, actor) {
  if (status === 'accepted') return 'Aceptar pedido';
  if (status === 'preparing') return 'Iniciar preparación';
  if (status === 'ready') return 'Marcar listo';
  if (status === 'picked_up') return 'Registrar retiro';
  if (status === 'on_the_way') return actor === 'rider' ? 'Salir en camino' : 'En camino';
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

function createRuntimeKey(prefix) {
  return `${prefix}:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}
