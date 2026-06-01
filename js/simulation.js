// Controlador de la simulación de reparto en tiempo real (modo demo local).
// Maneja el setInterval (uno solo, sin duplicados), la persistencia vía estado
// y el GPS opcional. La lógica de cálculo vive en js/core/simulation.js.
//
// IMPORTANTE: es una simulación LOCAL. El movimiento del rider y el ETA se
// calculan en este dispositivo. Para tiempo real real entre el celular del
// cliente y el del repartidor hace falta un backend realtime
// (Supabase Realtime, Firebase o WebSocket). Ver README.
import { getState, setState } from './state.js';
import {
  getActiveDeliveryOrder,
  getRiderQueueOrder,
  updateOrderDemoDestination,
  updateOrderStatus,
} from './orders.js';
import { getDeviceId } from './realtime.js';
import {
  DEMO_STORE_POINT,
  SIMULATION_TICK_MS,
  advanceSimulation,
  createSimulationState,
} from './core/simulation.js';
import {
  GPS_FIX_STALE_MS,
  distanceKm,
  getStreetTestDestination,
  locationTimestamp,
  normalizeRiderLocation,
  selectRouteForOrder,
  shouldAcceptGpsFix,
  shouldPublishGpsFix as shouldPublishGpsFixPolicy,
} from './map/route_geometry.js';
import { STORE_LOCATION } from './map/map_config.js';
import { getOrderRepository, isPersistentOrderRepository } from './repositories/repository_factory.js';

let timerId = null;
let gpsWatchId = null;
let gpsWatchPolicyKey = null;

// Control de eficiencia GPS: separa fixes aceptados, compartidos y reintentos
// del backend para evitar writes y renders innecesarios.
const GPS_BACKEND_RETRY_BASE_MS = 15_000;
const GPS_BACKEND_RETRY_MAX_MS = 60_000;
const GPS_NEAR_CUSTOMER_METERS = 180;
const TERMINAL_DELIVERY_STATUSES = new Set(['delivered', 'cancelled']);

let lastAcceptedFix = null;
let lastPublishedFix = null;
let backendRetryAfter = 0;
let backendFailureCount = 0;

// Pura y testeable: decide si publicar el fix dado el último publicado.
export function shouldPublishLocation(prev, next, now = Date.now()) {
  return shouldPublishGpsFixPolicy(prev, next, { now });
}

// Solo el dispositivo que arrancó la simulación (owner) mueve el rider.
// Los demás (p. ej. el cliente) solo muestran el progreso que reciben por realtime.
function ownsSimulation(sim) {
  return Boolean(sim) && (!sim.owner || sim.owner === getDeviceId());
}

function startTimer() {
  // Garantiza un único intervalo activo: nunca se duplican.
  if (timerId !== null) return;
  timerId = setInterval(tick, SIMULATION_TICK_MS);
}

function stopTimer() {
  if (timerId === null) return;
  clearInterval(timerId);
  timerId = null;
}

export function getSimulation() {
  return getState().simulation;
}

export function isSimulationRunning() {
  return Boolean(getState().simulation?.running);
}

function getStreetTestOrder() {
  return getRiderQueueOrder() || getActiveDeliveryOrder();
}

function routePreferenceForOrder(order) {
  const sim = getState().simulation;
  if (sim && sim.orderId === order?.id) return sim.destinationId || sim.routeId;
  return order?.delivery?.demoDestinationId || null;
}

function orderWithDestination(order, destination) {
  return {
    ...order,
    delivery: {
      ...(order.delivery || {}),
      demoDestinationId: destination.id,
      demoDestinationLabel: destination.label || destination.name,
      demoDestinationAddressLabel: destination.addressLabel || destination.name || destination.label,
      demoDestinationCity: destination.city || '',
      distanceKm: Number(distanceKm(STORE_LOCATION, destination).toFixed(1)),
    },
  };
}

export function activateStreetTestMode(destinationId = null) {
  const order = getStreetTestOrder();
  if (!order) {
    return { ok: false, message: 'Creá o usá un pedido de delivery para activar el modo calle.' };
  }
  return applyStreetTestDestination(order, destinationId || routePreferenceForOrder(order), {
    message: 'Referencia visual del recorrido actualizada.',
  });
}

export function selectStreetTestDestination(destinationId) {
  const order = getStreetTestOrder();
  if (!order) {
    return { ok: false, message: 'Creá o usá un pedido de delivery para elegir referencia visual.' };
  }
  return applyStreetTestDestination(order, destinationId, {
    message: 'Referencia visual actualizada.',
  });
}

function applyStreetTestDestination(order, destinationId, { message }) {
  const destination = getStreetTestDestination(destinationId);
  const destinationResult = updateOrderDemoDestination(order.id, destination.id);
  if (!destinationResult.ok) return destinationResult;

  const current = getState().simulation;
  const gpsActive = current?.orderId === order.id && current.mode === 'gps' && gpsWatchId !== null;
  const nextOrder = orderWithDestination(order, destination);
  const base = current && current.orderId === order.id
    ? current
    : createSimulationState(nextOrder, { running: false, destinationId: destination.id });
  const freshRoute = createSimulationState(nextOrder, { running: false, destinationId: destination.id });

  if (!gpsActive) stopTimer();

  const timestamp = Date.now();
  setState({
    simulation: {
      ...(gpsActive ? base : freshRoute),
      routeId: destination.id,
      destinationId: destination.id,
      streetMode: true,
      owner: getDeviceId(),
      timestamp,
      lastFixAt: gpsActive ? base.lastFixAt : new Date(timestamp).toISOString(),
      gpsStatus: base?.gpsStatus || 'inactive',
      ...(base?.gpsError ? { gpsError: base.gpsError } : {}),
    },
  });

  return { ok: true, message: `${message} ${destination.label || destination.name}.`, destination };
}

function tick() {
  const sim = getState().simulation;
  if (!sim || !sim.running || !ownsSimulation(sim)) {
    stopTimer();
    return;
  }

  const order = getState().orders.find((candidate) => candidate.id === sim.orderId);
  if (!order || order.deliveryMode !== 'delivery' || order.status === 'delivered' || order.status === 'cancelled') {
    clearSimulation();
    return;
  }

  const { simulation: next, reachedEnd } = advanceSimulation(sim, SIMULATION_TICK_MS);

  if (reachedEnd && order.status === 'on_the_way') {
    // Al completar el recorrido el rider queda "llegando" al domicilio.
    updateOrderStatus(order.id, 'arriving');
  }

  setState({ simulation: next });
  if (!next.running) stopTimer();
}

export function startSimulation() {
  if (isGpsActive()) {
    return { ok: false, message: 'Detené el GPS real antes de iniciar la ruta estimada.' };
  }

  let order = getActiveDeliveryOrder();
  if (!order) {
    return { ok: false, message: 'No hay un pedido de delivery asignado. Marcá el pedido como listo en el panel del negocio.' };
  }

  // Si todavía está en el local, lo hacemos salir para empezar a moverse.
  if (order.status === 'ready') {
    const left = updateOrderStatus(order.id, 'on_the_way');
    if (!left.ok) return { ok: false, message: left.message };
    order = getActiveDeliveryOrder() || order;
  }

  const current = getState().simulation;
  const base = current && current.orderId === order.id && current.source !== 'gps'
    ? { ...current, running: true }
    : createSimulationState(order, { running: true, destinationId: routePreferenceForOrder(order) });
  // Este dispositivo pasa a ser el "dueño" que mueve el rider.
  const simulation = {
    ...base,
    mode: 'demo',
    source: 'simulation',
    gpsStatus: 'inactive',
    lastSentSource: 'simulation',
    owner: getDeviceId(),
  };

  setState({ simulation });
  startTimer();
  return { ok: true, message: 'Recorrido guiado iniciado. El rider está en camino.' };
}

export function pauseSimulation() {
  const sim = getState().simulation;
  stopTimer();
  if (!sim) return { ok: false, message: 'No hay recorrido activo.' };
  setState({ simulation: { ...sim, running: false } });
  return { ok: true, message: 'Recorrido en pausa.' };
}

export function resetSimulation() {
  stopTimer();
  disableGpsTracking({ silent: true });
  const order = getActiveDeliveryOrder();
  if (!order) {
    setState({ simulation: null });
    return { ok: true, message: 'Recorrido reiniciado.' };
  }
  const preferredDestinationId = routePreferenceForOrder(order);
  const base = createSimulationState(order, { running: false, destinationId: preferredDestinationId });
  setState({
    simulation: {
      ...base,
      progress: 0,
      etaMinutes: base.baseEta,
      running: false,
      lat: DEMO_STORE_POINT.lat,
      lng: DEMO_STORE_POINT.lng,
      source: 'simulation',
      gpsStatus: 'inactive',
      streetMode: Boolean(preferredDestinationId),
    },
  });
  return { ok: true, message: 'Recorrido reiniciado al inicio.' };
}

function clearSimulation() {
  stopTimer();
  disableGpsTracking({ silent: true });
  if (getState().simulation) setState({ simulation: null });
}

// Mantiene la simulación coherente cuando el rider cambia el estado a mano.
export function syncSimulationOnStatus(orderId, status) {
  const sim = getState().simulation;

  if (status === 'delivered' || status === 'cancelled') {
    clearSimulation();
    return;
  }

  const order = getState().orders.find((candidate) => candidate.id === orderId);
  if (!order || order.deliveryMode !== 'delivery') return;

  if (status === 'on_the_way') {
    const next = sim && sim.orderId === orderId
      ? sim
      : createSimulationState(order, { running: false });
    setState({ simulation: next });
    syncGpsWatchPolicyForOrder({ ...order, status }, next);
    return;
  }

  if (status === 'arriving') {
    const base = sim && sim.orderId === orderId
      ? sim
      : createSimulationState(order, { running: false, destinationId: order.delivery?.demoDestinationId });
    stopTimer();
    setState({
      simulation: { ...base, progress: Math.max(base.progress, 0.92), etaMinutes: 1, running: false },
    });
    syncGpsWatchPolicyForOrder({ ...order, status }, base);
  }
}

// Reanuda el intervalo tras un reload si quedó una simulación en marcha,
// pero solo en el dispositivo dueño (el cliente nunca mueve el rider).
export function resumeSimulationIfNeeded() {
  const sim = getState().simulation;
  if (sim && sim.running && ownsSimulation(sim)) startTimer();
}

// ===== GPS opcional (solo a pedido del usuario, compartido por el relay demo configurado) =====
function hasSecureGpsContext() {
  if (globalThis.isSecureContext === true) return true;
  if (globalThis.isSecureContext === false) return false;
  const protocol = globalThis.location?.protocol;
  const hostname = globalThis.location?.hostname;
  return protocol === 'https:' || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function gpsUnavailableResult(order, gpsStatus, gpsError) {
  const current = getState().simulation;
  const preferredDestinationId = routePreferenceForOrder(order);
  if (current?.orderId !== order.id) resetGpsPublishThrottle();
  const base = current && current.orderId === order.id
    ? current
    : createSimulationState(order, { running: false, destinationId: preferredDestinationId });
  setState({
    simulation: {
      ...base,
      mode: 'demo',
      source: 'simulation',
      running: false,
      gpsStatus,
      gpsError,
      streetMode: Boolean(preferredDestinationId || base?.streetMode),
      lastSentSource: 'simulation',
    },
  });
  return { ok: false, message: gpsError };
}

export function gpsDeliveryPhaseForOrder(order = {}, location = null) {
  if (!order || order.deliveryMode !== 'delivery' || TERMINAL_DELIVERY_STATUSES.has(order.status)) return 'STOPPED';
  if (order.status === 'arriving') return 'NEAR_CUSTOMER';
  if (order.status === 'on_the_way') {
    return isNearCustomerLocation(order, location) ? 'NEAR_CUSTOMER' : 'ACTIVE_DELIVERY';
  }
  return 'IDLE';
}

export function gpsWatchOptionsForOrder(order = {}, location = null) {
  const phase = gpsDeliveryPhaseForOrder(order, location);
  if (phase === 'NEAR_CUSTOMER') {
    return { enableHighAccuracy: true, maximumAge: 2_000, timeout: 8_000 };
  }
  if (phase === 'ACTIVE_DELIVERY') {
    return { enableHighAccuracy: true, maximumAge: 3_000, timeout: 10_000 };
  }
  return { enableHighAccuracy: false, maximumAge: 10_000, timeout: 15_000 };
}

function gpsWatchPolicyKeyForOrder(order, location = null) {
  return gpsDeliveryPhaseForOrder(order, location);
}

function startGpsWatchForOrder(order, location = null) {
  const options = gpsWatchOptionsForOrder(order, location);
  gpsWatchPolicyKey = gpsWatchPolicyKeyForOrder(order, location);
  gpsWatchId = navigator.geolocation.watchPosition(onGpsPosition, onGpsError, options);
}

function syncGpsWatchPolicyForOrder(order, location = null) {
  if (gpsWatchId === null || typeof navigator === 'undefined' || !navigator.geolocation) return;
  const nextKey = gpsWatchPolicyKeyForOrder(order, location);
  if (nextKey === 'STOPPED') {
    disableGpsTracking({ silent: true });
    return;
  }
  if (nextKey === gpsWatchPolicyKey) return;
  try { navigator.geolocation.clearWatch(gpsWatchId); } catch (_) { /* no-op */ }
  startGpsWatchForOrder(order, location);
}

function gpsPublishContext(order, location, now = Date.now()) {
  const phase = gpsDeliveryPhaseForOrder(order, location);
  return {
    now,
    orderStatus: order?.status || '',
    previousOrderStatus: lastPublishedFix?.orderStatus || '',
    nearCustomer: phase === 'NEAR_CUSTOMER',
  };
}

function isNearCustomerLocation(order, location) {
  if (!location || !Number.isFinite(Number(location.lat)) || !Number.isFinite(Number(location.lng))) return false;
  const route = selectRouteForOrder(order, routePreferenceForOrder(order));
  if (!route?.destination) return false;
  return distanceKm(location, route.destination) * 1000 <= GPS_NEAR_CUSTOMER_METERS;
}

function rememberPublishedFix(order, location, now = Date.now()) {
  lastPublishedFix = {
    ...location,
    at: now,
    orderId: order?.id || '',
    orderStatus: order?.status || '',
  };
}

export function enableGpsTracking() {
  const order = getStreetTestOrder();
  if (!order) {
    return { ok: false, message: 'No hay un pedido asignado para usar tu ubicación.' };
  }

  if (!hasSecureGpsContext()) {
    const gpsError = 'El GPS real requiere una conexión segura (HTTPS o localhost). No se puede compartir ubicación en vivo sin eso.';
    return gpsUnavailableResult(order, 'requires_secure_context', gpsError);
  }

  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    return gpsUnavailableResult(order, 'unavailable', 'Geolocalización no disponible en este navegador.');
  }

  const currentSim = getState().simulation;
  if (gpsWatchId !== null && currentSim?.orderId === order.id) {
    syncGpsWatchPolicyForOrder(order, currentSim);
    return {
      ok: true,
      message: currentSim.gpsStatus === 'active' ? 'GPS real activo.' : 'Solicitando ubicación GPS.',
    };
  }

  const current = getState().simulation;
  const preferredDestinationId = routePreferenceForOrder(order);
  const base = current && current.orderId === order.id
    ? current
    : createSimulationState(order, { running: false, destinationId: preferredDestinationId });
  const requestedAt = new Date().toISOString();
  stopTimer();
  setState({
    simulation: {
      ...base,
      mode: 'gps',
      // Hasta recibir un fix real, no publicamos source="gps" con una posición demo.
      source: base?.source === 'gps' ? 'gps' : 'simulation',
      running: false,
      gpsStatus: 'requesting',
      gpsRequestedAt: requestedAt,
      gpsError: undefined,
      owner: getDeviceId(),
      streetMode: Boolean(preferredDestinationId || base?.streetMode),
      lastSentSource: base?.source === 'gps' ? 'gps' : 'simulation',
    },
  });

  try {
    if (gpsWatchId !== null) navigator.geolocation.clearWatch(gpsWatchId);
    startGpsWatchForOrder(order, base);
  } catch (_) {
    gpsWatchId = null;
    gpsWatchPolicyKey = null;
    const sim = getState().simulation;
    if (sim) setState({ simulation: { ...sim, mode: 'demo', source: sim.source === 'gps' ? 'gps' : 'simulation', gpsStatus: 'unavailable', gpsError: 'No se pudo iniciar la ubicación.' } });
    return { ok: false, message: 'No se pudo iniciar la ubicación.' };
  }

  return { ok: true, message: 'Solicitando ubicación GPS.' };
}

export function disableGpsTracking({ silent = false } = {}) {
  if (gpsWatchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
    try { navigator.geolocation.clearWatch(gpsWatchId); } catch (_) { /* no-op */ }
  }
  gpsWatchId = null;
  gpsWatchPolicyKey = null;
  resetGpsPublishThrottle();
  const sim = getState().simulation;
  if (sim && sim.mode === 'gps') {
    setState({
      simulation: {
        ...sim,
        mode: 'demo',
        source: sim.source === 'gps' ? 'gps' : 'simulation',
        running: false,
        gpsStatus: 'inactive',
      },
    });
  }
  return { ok: true, message: silent ? '' : 'Ubicación en vivo desactivada.' };
}

export function isGpsActive() {
  return gpsWatchId !== null;
}

function onGpsPosition(position) {
  const sim = getState().simulation;
  if (!sim) return;
  const order = getState().orders.find((candidate) => candidate.id === sim.orderId);
  if (!order || TERMINAL_DELIVERY_STATUSES.has(order.status)) {
    disableGpsTracking({ silent: true });
    return;
  }
  const coords = position.coords || {};
  const timestamp = Number(position.timestamp) || Date.now();
  const location = normalizeRiderLocation({
    lat: coords.latitude,
    lng: coords.longitude,
    accuracy: coords.accuracy,
    heading: coords.heading,
    speed: coords.speed,
    timestamp,
    source: 'gps',
  });
  if (!location) return;
  const now = Date.now();
  const previousLocation = lastAcceptedFix || (sim.source === 'gps' ? sim : null);
  if (!shouldAcceptGpsFix(previousLocation, location, { now })) {
    return;
  }
  lastAcceptedFix = { ...location, acceptedAt: now, orderId: order.id };

  const publishContext = gpsPublishContext(order, location, now);
  const shouldPublish = shouldPublishGpsFixPolicy(lastPublishedFix, location, publishContext);
  const statusChanged = sim.gpsStatus !== 'active' || sim.source !== 'gps';
  if (!shouldPublish && !statusChanged) return;

  const publishedAt = new Date().toISOString();
  // La ubicación se publica por el estado de la app y el relay demo configurado.
  setState({
    simulation: {
      ...sim,
      ...location,
      mode: 'gps',
      source: 'gps',
      gpsStatus: 'active',
      running: false,
      gpsError: undefined,
      lastGpsFixAt: location.lastFixAt,
      lastGpsPublishedAt: publishedAt,
      lastPublishedAt: publishedAt,
      lastSentSource: 'gps',
      owner: getDeviceId(),
    },
  });
  rememberPublishedFix(order, location, now);
  persistRiderLocation(sim.orderId, location);
  syncGpsWatchPolicyForOrder(order, location);
}

function onGpsError(error) {
  const sim = getState().simulation;
  const denied = Number(error?.code) === 1;
  const recentFix = sim?.source === 'gps' && Date.now() - locationTimestamp(sim) <= GPS_FIX_STALE_MS;
  const message = error && error.code === 1
    ? 'Permiso de ubicación denegado.'
    : 'No se pudo obtener tu ubicación.';
  if (!denied && sim) {
    setState({
      simulation: {
        ...sim,
        mode: 'gps',
        source: recentFix ? 'gps' : (sim.source === 'gps' ? 'gps' : 'simulation'),
        running: false,
        gpsStatus: 'unavailable',
        gpsError: recentFix ? 'Señal baja, usando última ubicación.' : message,
      },
    });
    return;
  }
  disableGpsTracking({ silent: true });
  if (sim) {
    setState({
      simulation: {
        ...sim,
        mode: 'demo',
        source: sim.source === 'gps' ? 'gps' : 'simulation',
        running: false,
        gpsStatus: denied ? 'denied' : 'unavailable',
        gpsError: message,
      },
    });
  }
}

// Limpia el GPS al salir de la vista del rider (la simulación demo sigue).
export function handleViewChangeForSimulation(view) {
  if (view !== 'rider' && isGpsActive()) {
    disableGpsTracking({ silent: true });
  }
}

function persistRiderLocation(orderId, location) {
  try {
    const repository = getOrderRepository();
    if (!isPersistentOrderRepository(repository)) return;
    const now = Date.now();
    if (backendRetryAfter && now < backendRetryAfter) return;
    Promise.resolve(repository.updateRiderLocation(orderId, location))
      .then((result) => {
        const sim = getState().simulation;
        if (sim && sim.orderId === orderId) {
          if (result && result.ok === false) {
            registerBackendPublishFailure(orderId, result.message);
            return;
          }
          backendFailureCount = 0;
          backendRetryAfter = 0;
          setState({ simulation: { ...sim, lastBackendPublishAt: new Date().toISOString(), backendError: undefined } });
        }
      })
      .catch(() => {
        registerBackendPublishFailure(orderId, 'No se pudo enviar la ubicación al backend.');
      });
  } catch (_) {
    // La app conserva el fix local aunque el backend opcional no responda.
  }
}

function registerBackendPublishFailure(orderId, message) {
  backendFailureCount += 1;
  const delay = Math.min(
    GPS_BACKEND_RETRY_MAX_MS,
    GPS_BACKEND_RETRY_BASE_MS * (2 ** Math.min(backendFailureCount - 1, 2)),
  );
  backendRetryAfter = Date.now() + delay;
  const sim = getState().simulation;
  if (sim && sim.orderId === orderId) {
    setState({ simulation: { ...sim, backendError: message || 'No se pudo enviar la ubicación al backend.' } });
  }
}

// Reset del throttle al detener GPS, para que el próximo arranque publique ya.
function resetGpsPublishThrottle() {
  lastAcceptedFix = null;
  lastPublishedFix = null;
  backendRetryAfter = 0;
  backendFailureCount = 0;
}
