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

  function getSnapshot() {
    return {
      active: session.active,
      inFlight: Boolean(requestController),
      orderId: session.orderId,
      status: session.status,
    };
  }

  function update(next = {}) {
    const orderId = String(next.orderId || '').trim();
    const trackingToken = String(next.trackingToken || '').trim();
    const status = normalizeWorkflowStatus(next.status, '');
    const changedAccess = orderId !== session.orderId || trackingToken !== session.trackingToken;

    if (!orderId || !trackingToken || isTerminalCustomerTrackingStatus(status)) {
      stop();
      return getSnapshot();
    }

    if (changedAccess) {
      abortRequest();
      hasStartedCurrentAccess = false;
    }
    session = { active: true, orderId, trackingToken, status };
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
          session.status = normalizeWorkflowStatus(
            result.order.workflowStatus || result.order.status || session.status,
            session.status,
          );
          onSnapshot(result.order);
          if (isTerminalCustomerTrackingStatus(session.status)) {
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

  function onLifecycleResume() {
    if (!session.active || documentRef?.hidden) return;
    void pollNow();
  }

  function onVisibilityChange() {
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
  }

  function unbindLifecycle() {
    if (!lifecycleBound) return;
    lifecycleBound = false;
    documentRef?.removeEventListener?.('visibilitychange', onVisibilityChange);
    windowRef?.removeEventListener?.('focus', onLifecycleResume);
    windowRef?.removeEventListener?.('pageshow', onLifecycleResume);
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

  return { getSnapshot, pollNow, stop, update };
}

function emptySession() {
  return { active: false, orderId: '', trackingToken: '', status: '' };
}

function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
}
