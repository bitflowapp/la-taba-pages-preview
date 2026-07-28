import { normalizeWorkflowStatus } from '../core/order-workflow.js';
import {
  normalizeRiderLocation,
  shouldAcceptGpsFix,
  shouldPublishGpsFix,
} from '../map/route_geometry.js';

// `arrived` is the persisted workflow value; `arriving` is accepted as the
// presentation alias used by some clients while an order is approaching.
const ACTIVE_RIDER_STATUSES = new Set(['on_the_way', 'arriving', 'arrived']);
const AUTHORITY_ERRORS = /asignad|autentic|permiso|denegad|sesión/i;

export function canShareProductionRiderGps({ order, userId, role } = {}) {
  const status = normalizeWorkflowStatus(order?.workflowStatus || order?.status, '');
  const assignedRiderId = String(order?.assignedRiderId || order?.assigned_rider_user_id || '');
  return Boolean(
    userId
    && role === 'rider'
    && order?.deliveryMode === 'delivery'
    && assignedRiderId === String(userId)
    && ACTIVE_RIDER_STATUSES.has(status),
  );
}

export function createProductionRiderGpsController({
  repository,
  getAccess = () => ({}),
  getOrder = () => null,
  onChange = () => {},
  navigatorRef = globalThis.navigator,
  now = () => Date.now(),
} = {}) {
  let share = emptyShare();

  function snapshot() {
    return { ...share };
  }

  function start(orderId) {
    const order = getOrder(orderId);
    const access = getAccess() || {};
    const userId = access.user?.id || access.userId || '';
    const role = access.membership?.role || access.role || '';

    if (!navigatorRef?.geolocation?.watchPosition) {
      return failed('Este dispositivo no ofrece geolocalización.');
    }
    if (!canShareProductionRiderGps({ order, userId, role })) {
      return failed('Sólo el rider asignado puede compartir ubicación después de salir del local.');
    }
    if (share.watchId !== null && share.orderId === order.id) {
      return { ok: true, message: 'La ubicación ya está activa.' };
    }

    stop();
    share = {
      ...emptyShare(),
      orderId: order.id,
      watchId: null,
      state: 'requesting',
      message: 'Solicitando permiso de ubicación…',
      status: normalizeWorkflowStatus(order.workflowStatus || order.status, ''),
    };
    const watchId = navigatorRef.geolocation.watchPosition(
      (position) => { void publishPosition(order.id, position); },
      (error) => handlePositionError(error),
      {
        enableHighAccuracy: true,
        maximumAge: 4_000,
        timeout: 15_000,
      },
    );
    share = { ...share, watchId };
    emit();
    return { ok: true, message: 'GPS activado. La ubicación se publicará mientras sigas en reparto.' };
  }

  async function publishPosition(orderId, position) {
    if (share.orderId !== orderId || share.watchId === null || share.publishing) return;
    const order = getOrder(orderId);
    const access = getAccess() || {};
    const userId = access.user?.id || access.userId || '';
    const role = access.membership?.role || access.role || '';
    if (!canShareProductionRiderGps({ order, userId, role })) {
      stop();
      return;
    }

    const currentTime = now();
    const candidate = normalizeRiderLocation({
      lat: position?.coords?.latitude,
      lng: position?.coords?.longitude,
      accuracy: position?.coords?.accuracy,
      heading: position?.coords?.heading,
      speed: position?.coords?.speed,
      timestamp: position?.timestamp || currentTime,
      source: 'gps',
    });
    if (!candidate || !shouldAcceptGpsFix(share.lastAcceptedFix, candidate, { now: currentTime })) {
      return;
    }
    if (!shouldPublishGpsFix(share.lastPublishedFix, candidate, {
      now: currentTime,
      orderStatus: normalizeWorkflowStatus(order.workflowStatus || order.status, ''),
      previousOrderStatus: share.status,
      nearCustomer: ['arriving', 'arrived'].includes(
        normalizeWorkflowStatus(order.workflowStatus || order.status, ''),
      ),
    })) {
      share = { ...share, lastAcceptedFix: candidate };
      return;
    }

    const activeWatchId = share.watchId;
    share = { ...share, publishing: true, state: 'publishing', message: 'Actualizando ubicación…' };
    emit();
    let result;
    try {
      result = await repository?.updateRiderLocation?.(orderId, {
        lat: candidate.lat,
        lng: candidate.lng,
        accuracy: candidate.accuracy,
        heading: candidate.heading,
        speed: candidate.speed,
        source: 'gps',
      });
    } catch (_) {
      result = { ok: false, message: 'No pudimos publicar la ubicación. Verificá tu conexión.' };
    }
    if (share.orderId !== orderId || share.watchId !== activeWatchId) return;

    if (result?.ok) {
      const publishedAt = now();
      share = {
        ...share,
        publishing: false,
        state: 'live',
        status: normalizeWorkflowStatus(order.workflowStatus || order.status, ''),
        lastAcceptedFix: candidate,
        lastPublishedFix: {
          ...candidate,
          at: publishedAt,
          publishedAt,
          orderStatus: normalizeWorkflowStatus(order.workflowStatus || order.status, ''),
        },
        lastCapturedAt: candidate.lastFixAt,
        lastPublishedAt: publishedAt,
        message: `GPS compartido · ${timeLabel(publishedAt)}`,
      };
    } else {
      const message = result?.message || 'No pudimos publicar la ubicación. Verificá tu conexión.';
      share = { ...share, publishing: false, state: 'error', message };
      if (AUTHORITY_ERRORS.test(message)) {
        stop();
        return;
      }
    }
    emit();
  }

  function reconcile() {
    if (share.watchId === null || !share.orderId) return false;
    const access = getAccess() || {};
    const order = getOrder(share.orderId);
    const valid = canShareProductionRiderGps({
      order,
      userId: access.user?.id || access.userId || '',
      role: access.membership?.role || access.role || '',
    });
    if (!valid) return stop();
    return false;
  }

  function stop() {
    const previous = share;
    const stopped = previous.watchId !== null || Boolean(previous.orderId);
    if (previous.watchId !== null && navigatorRef?.geolocation?.clearWatch) {
      try { navigatorRef.geolocation.clearWatch(previous.watchId); } catch (_) { /* no-op */ }
    }
    share = emptyShare();
    if (stopped) emit();
    return stopped;
  }

  function destroy() {
    return stop();
  }

  function handlePositionError(error) {
    const message = gpsErrorMessage(error);
    const denied = Number(error?.code) === 1;
    share = { ...share, state: 'error', message };
    emit();
    if (denied) stop();
  }

  function emit() {
    onChange(snapshot());
  }

  return {
    destroy,
    getSnapshot: snapshot,
    reconcile,
    start,
    stop,
  };
}

function emptyShare() {
  return {
    watchId: null,
    orderId: '',
    state: 'idle',
    status: '',
    message: '',
    lastAcceptedFix: null,
    lastPublishedFix: null,
    lastCapturedAt: '',
    lastPublishedAt: 0,
    publishing: false,
  };
}

function failed(message) {
  return { ok: false, message };
}

function gpsErrorMessage(error) {
  if (error?.code === 1) return 'Permiso de ubicación denegado.';
  if (error?.code === 2) return 'El dispositivo no pudo obtener una ubicación.';
  if (error?.code === 3) return 'La ubicación tardó demasiado. Probá nuevamente.';
  return 'No pudimos iniciar el GPS.';
}

function timeLabel(timestamp) {
  try {
    return new Date(timestamp).toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch (_) {
    return '';
  }
}
