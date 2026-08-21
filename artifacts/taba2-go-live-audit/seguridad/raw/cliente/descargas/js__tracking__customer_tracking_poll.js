import { normalizeWorkflowStatus } from '../core/order-workflow.js';

export const CUSTOMER_TRACKING_POLL_MS = 5_000;
export const CUSTOMER_TRACKING_BACKGROUND_POLL_MS = 15_000;

const ACTIVE_TRACKING_STATUSES = new Set([
  'submitted',
  'accepted',
  'preparing',
  'ready',
  'assigned',
  'picked_up',
  'on_the_way',
  'arrived',
]);
const TERMINAL_TRACKING_STATUSES = new Set(['delivered', 'canceled']);

export function shouldPollCustomerTracking(status) {
  return ACTIVE_TRACKING_STATUSES.has(normalizeWorkflowStatus(status, ''));
}

export function isTerminalCustomerTrackingStatus(status) {
  return TERMINAL_TRACKING_STATUSES.has(normalizeWorkflowStatus(status, ''));
}

// A token-scoped GPS DTO cannot safely use the shared Realtime subscription:
// WebSocket headers cannot carry the per-order public tracking token. This
// controller owns one abortable request/timer pair for the active customer
// tracking screen, so it neither polls globally nor leaves a request running
// after a customer exits the view.
export function createCustomerTrackingPollController({
  fetchSnapshot,
  onSnapshot = () => {},
  onUnavailable = () => {},
  onError = () => {},
  onTick = () => {},
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout,
  AbortControllerImpl = globalThis.AbortController,
  now = () => Date.now(),
  pollMs = CUSTOMER_TRACKING_POLL_MS,
  backgroundPollMs = CUSTOMER_TRACKING_BACKGROUND_POLL_MS,
} = {}) {
  if (typeof fetchSnapshot !== 'function') {
    throw new Error('El polling de tracking requiere una consulta tokenizada.');
  }

  const normalPollMs = Math.max(CUSTOMER_TRACKING_POLL_MS, Number(pollMs) || CUSTOMER_TRACKING_POLL_MS);
  const reducedPollMs = Math.max(normalPollMs, Number(backgroundPollMs) || CUSTOMER_TRACKING_BACKGROUND_POLL_MS);
  let session = emptySession();
  let timerId = null;
  let requestController = null;
  let lifecycleBound = false;
  let hasStartedCurrentAccess = false;
  // Once the terminal visibility deadline is reached, a timeout and a browser
  // lifecycle event can land in the same event-loop turn. Keep that expiry
  // check single-flight even if the first network response settles quickly.
  let terminalExpiryRevalidationStarted = false;

  function getSnapshot() {
    return {
      active: session.active,
      terminal: session.terminal,
      inFlight: Boolean(requestController),
      orderId: session.orderId,
      status: session.status,
    };
  }

  function update(next = {}) {
    const orderId = String(next.orderId || '').trim();
    const trackingToken = String(next.trackingToken || '').trim();
    const status = normalizeWorkflowStatus(next.status, '');
    const terminalVisibleUntil = normalizeTerminalVisibleUntil(next.terminalVisibleUntil);
    const changedAccess = orderId !== session.orderId || trackingToken !== session.trackingToken;

    if (!orderId || !trackingToken) {
      stop();
      return getSnapshot();
    }
    if (status === 'delivered') {
      startTerminalVisibility({
        orderId,
        trackingToken,
        terminalVisibleUntil,
        changedAccess,
      });
      return getSnapshot();
    }
    if (isTerminalCustomerTrackingStatus(status)) {
      stop();
      return getSnapshot();
    }

    if (changedAccess) {
      abortRequest();
      hasStartedCurrentAccess = false;
    }
    session = {
      active: true,
      terminal: false,
      orderId,
      trackingToken,
      status,
      terminalVisibleUntil: '',
    };
    bindLifecycle();

    if (!shouldPollCustomerTracking(status)) {
      clearTimer();
      abortRequest();
      return getSnapshot();
    }

    if (!hasStartedCurrentAccess) {
      if (documentRef?.hidden) schedule();
      else void pollNow();
    }
    return getSnapshot();
  }

  function stop() {
    clearTimer();
    abortRequest();
    session = emptySession();
    hasStartedCurrentAccess = false;
    terminalExpiryRevalidationStarted = false;
    unbindLifecycle();
    return getSnapshot();
  }

  function pollNow() {
    if (!session.active || !shouldPollCustomerTracking(session.status)) return;
    if (documentRef?.hidden) {
      schedule();
      return;
    }
    clearTimer();
    abortRequest();
    const request = AbortControllerImpl ? new AbortControllerImpl() : null;
    requestController = request;
    hasStartedCurrentAccess = true;
    const current = { ...session, request };
    // The next cadence starts now, not after a slow network response. This
    // bounds a normal foreground cycle to five seconds and lets a new cycle
    // abort a request that is still pending.
    schedule();
    onTick({ orderId: current.orderId });

    Promise.resolve(fetchSnapshot({
      orderId: current.orderId,
      trackingToken: current.trackingToken,
      signal: request?.signal,
    }))
      .then((result) => {
        if (!isCurrentRequest(current)) return;
        requestController = null;
        if (result?.kind === 'aborted') return;
        if (result?.kind === 'unavailable') {
          onUnavailable({ orderId: current.orderId });
          stop();
          return;
        }
        if (result?.kind === 'snapshot' && result.order) {
          const nextStatus = normalizeWorkflowStatus(
            result.order.workflowStatus || result.order.status || session.status,
            session.status,
          );
          session.status = nextStatus;
          onSnapshot(result.order);
          if (nextStatus === 'delivered') {
            startTerminalVisibility({
              orderId: current.orderId,
              trackingToken: current.trackingToken,
              terminalVisibleUntil: normalizeTerminalVisibleUntil(
                result.order.terminalVisibleUntil,
              ),
              changedAccess: false,
            });
            return;
          }
          if (isTerminalCustomerTrackingStatus(nextStatus)) {
            stop();
            return;
          }
          if (!shouldPollCustomerTracking(session.status)) clearTimer();
          return;
        }
        onError({ orderId: current.orderId, error: result?.error || null });
      })
      .catch((error) => {
        if (!isCurrentRequest(current) || isAbortError(error)) return;
        requestController = null;
        onError({ orderId: current.orderId, error });
      });
  }

  function schedule() {
    clearTimer();
    if (!session.active || !shouldPollCustomerTracking(session.status)) return;
    const delay = documentRef?.hidden ? reducedPollMs : normalPollMs;
    timerId = setTimeoutImpl(() => {
      timerId = null;
      pollNow();
    }, delay);
  }

  function startTerminalVisibility({
    orderId,
    trackingToken,
    terminalVisibleUntil,
    changedAccess,
  }) {
    if (!terminalVisibleUntil) {
      // Acá se le borraba la pantalla al cliente EN EL MOMENTO DE LA ENTREGA.
      //
      // `onUnavailable` significa una sola cosa —el token fue revocado o
      // venció, que es `result.kind === 'unavailable'`— y dispara
      // `markTrackingUnavailable`: borra el acceso de sessionStorage, saca el
      // pedido del estado si venía por enlace público y suprime el fallback, así
      // que Seguir cae al estado vacío «Cuando hagas una compra vas a poder
      // seguir el recorrido». Justo cuando la persona iba a ver su confirmación.
      //
      // Y no se recuperaba: `recoverCustomerTrackingAccess` descarta los pedidos
      // terminales y `unavailableTrackingOrderId` bloquea el reintento. Ni
      // recargando volvía.
      //
      // Que falte `terminal_visible_until` NO es un token revocado: hoy es que
      // la RPC vigente dejó de emitir la clave. Ante la duda se hace lo mismo
      // que con el resto de los estados terminales veinte líneas más arriba
      // —`stop()` y nada más—: se deja de consultar y el pedido entregado se
      // queda a la vista. Degradar es correcto; borrar no.
      stop();
      return;
    }
    const unchangedTerminal = session.terminal
      && !changedAccess
      && session.terminalVisibleUntil === terminalVisibleUntil;
    if (unchangedTerminal) {
      if (terminalExpiresAt() > now()) scheduleTerminalRevalidation();
      return;
    }

    clearTimer();
    abortRequest();
    hasStartedCurrentAccess = false;
    terminalExpiryRevalidationStarted = false;
    session = {
      active: false,
      terminal: true,
      orderId,
      trackingToken,
      status: 'delivered',
      terminalVisibleUntil,
    };
    bindLifecycle();
    if (terminalExpiresAt() <= now()) {
      void revalidateTerminal();
      return;
    }
    scheduleTerminalRevalidation();
  }

  function scheduleTerminalRevalidation() {
    clearTimer();
    if (!session.terminal) return;
    const delay = terminalExpiresAt() - now();
    if (delay <= 0) return;
    timerId = setTimeoutImpl(() => {
      timerId = null;
      void revalidateTerminal();
    }, delay);
  }

  function scheduleTerminalRetry() {
    clearTimer();
    if (!session.terminal) return;
    terminalExpiryRevalidationStarted = false;
    timerId = setTimeoutImpl(() => {
      timerId = null;
      void revalidateTerminal();
    }, normalPollMs);
  }

  function revalidateTerminal() {
    if (!session.terminal || requestController) return;
    const revalidatingAtExpiry = terminalExpiresAt() <= now();
    if (revalidatingAtExpiry && terminalExpiryRevalidationStarted) return;
    if (revalidatingAtExpiry) terminalExpiryRevalidationStarted = true;
    clearTimer();
    const request = AbortControllerImpl ? new AbortControllerImpl() : null;
    requestController = request;
    const current = { ...session, request };

    Promise.resolve(fetchSnapshot({
      orderId: current.orderId,
      trackingToken: current.trackingToken,
      signal: request?.signal,
    }))
      .then((result) => {
        if (!isCurrentTerminalRequest(current)) return;
        requestController = null;
        if (result?.kind === 'aborted') return;
        if (result?.kind === 'unavailable') {
          onUnavailable({ orderId: current.orderId });
          stop();
          return;
        }
        if (result?.kind === 'snapshot' && result.order) {
          const nextStatus = normalizeWorkflowStatus(
            result.order.workflowStatus || result.order.status || current.status,
            current.status,
          );
          onSnapshot(result.order);
          if (nextStatus !== 'delivered') {
            onUnavailable({ orderId: current.orderId });
            stop();
            return;
          }
          startTerminalVisibility({
            orderId: current.orderId,
            trackingToken: current.trackingToken,
            terminalVisibleUntil: normalizeTerminalVisibleUntil(
              result.order.terminalVisibleUntil,
            ),
            changedAccess: false,
          });
          return;
        }
        onError({ orderId: current.orderId, error: result?.error || null });
        scheduleTerminalRetry();
      })
      .catch((error) => {
        if (!isCurrentTerminalRequest(current) || isAbortError(error)) return;
        requestController = null;
        onError({ orderId: current.orderId, error });
        scheduleTerminalRetry();
      });
  }

  function onLifecycleResume() {
    if (session.terminal) {
      void revalidateTerminal();
      return;
    }
    if (!session.active || documentRef?.hidden) return;
    void pollNow();
  }

  function onVisibilityChange() {
    if (session.terminal) {
      if (!documentRef?.hidden) onLifecycleResume();
      return;
    }
    if (!session.active) return;
    if (documentRef?.hidden) {
      clearTimer();
      abortRequest();
      return;
    }
    onLifecycleResume();
  }

  function bindLifecycle() {
    if (lifecycleBound) return;
    lifecycleBound = true;
    documentRef?.addEventListener?.('visibilitychange', onVisibilityChange);
    windowRef?.addEventListener?.('focus', onLifecycleResume);
    windowRef?.addEventListener?.('pageshow', onLifecycleResume);
    windowRef?.addEventListener?.('online', onLifecycleResume);
  }

  function unbindLifecycle() {
    if (!lifecycleBound) return;
    lifecycleBound = false;
    documentRef?.removeEventListener?.('visibilitychange', onVisibilityChange);
    windowRef?.removeEventListener?.('focus', onLifecycleResume);
    windowRef?.removeEventListener?.('pageshow', onLifecycleResume);
    windowRef?.removeEventListener?.('online', onLifecycleResume);
  }

  function clearTimer() {
    if (timerId !== null) clearTimeoutImpl(timerId);
    timerId = null;
  }

  function abortRequest() {
    if (requestController) requestController.abort();
    requestController = null;
  }

  function isCurrentRequest(request) {
    return session.active
      && session.orderId === request.orderId
      && session.trackingToken === request.trackingToken
      && requestController === request.request;
  }

  function isCurrentTerminalRequest(request) {
    return session.terminal
      && session.orderId === request.orderId
      && session.trackingToken === request.trackingToken
      && session.terminalVisibleUntil === request.terminalVisibleUntil
      && requestController === request.request;
  }

  function terminalExpiresAt() {
    return Date.parse(session.terminalVisibleUntil);
  }

  return { getSnapshot, pollNow, stop, update };
}

function emptySession() {
  return {
    active: false,
    terminal: false,
    orderId: '',
    trackingToken: '',
    status: '',
    terminalVisibleUntil: '',
  };
}

function normalizeTerminalVisibleUntil(value) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
}
