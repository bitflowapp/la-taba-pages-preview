// Controlador de la simulación de reparto en tiempo real (modo demo local).
// Maneja el setInterval (uno solo, sin duplicados), la persistencia vía estado
// y el GPS opcional. La lógica de cálculo vive en js/core/simulation.js.
//
// IMPORTANTE: es una simulación LOCAL. El movimiento del rider y el ETA se
// calculan en este dispositivo. Para tiempo real real entre el celular del
// cliente y el del repartidor hace falta un backend realtime
// (Supabase Realtime, Firebase o WebSocket). Ver README.
import { getState, setState } from './state.js';
import { getActiveDeliveryOrder, updateOrderStatus } from './orders.js';
import { getDeviceId } from './realtime.js';
import {
  DEMO_STORE_POINT,
  SIMULATION_TICK_MS,
  advanceSimulation,
  createSimulationState,
} from './core/simulation.js';
import { normalizeRiderLocation } from './map/route_geometry.js';

let timerId = null;
let gpsWatchId = null;

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
  let order = getActiveDeliveryOrder();
  if (!order) {
    return { ok: false, message: 'No hay un pedido de delivery asignado para simular. Marcá el pedido como listo en el panel del negocio.' };
  }

  // Si todavía está en el local, lo hacemos salir para empezar a moverse.
  if (order.status === 'ready') {
    const left = updateOrderStatus(order.id, 'on_the_way');
    if (!left.ok) return { ok: false, message: left.message };
    order = getActiveDeliveryOrder() || order;
  }

  const current = getState().simulation;
  const base = current && current.orderId === order.id
    ? { ...current, running: true }
    : createSimulationState(order, { running: true });
  // Este dispositivo pasa a ser el "dueño" que mueve el rider.
  const simulation = { ...base, owner: getDeviceId() };

  setState({ simulation });
  startTimer();
  return { ok: true, message: 'Simulación iniciada. El rider está en camino.' };
}

export function pauseSimulation() {
  const sim = getState().simulation;
  stopTimer();
  disableGpsTracking({ silent: true });
  if (!sim) return { ok: false, message: 'No hay simulación activa.' };
  setState({ simulation: { ...sim, running: false } });
  return { ok: true, message: 'Simulación en pausa.' };
}

export function resetSimulation() {
  stopTimer();
  disableGpsTracking({ silent: true });
  const order = getActiveDeliveryOrder();
  if (!order) {
    setState({ simulation: null });
    return { ok: true, message: 'Simulación reiniciada.' };
  }
  const base = createSimulationState(order, { running: false });
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
    },
  });
  return { ok: true, message: 'Simulación reiniciada al inicio del recorrido.' };
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
    return;
  }

  if (status === 'arriving') {
    const base = sim && sim.orderId === orderId ? sim : createSimulationState(order, { running: false });
    stopTimer();
    setState({
      simulation: { ...base, progress: Math.max(base.progress, 0.92), etaMinutes: 1, running: false },
    });
  }
}

// Reanuda el intervalo tras un reload si quedó una simulación en marcha,
// pero solo en el dispositivo dueño (el cliente nunca mueve el rider).
export function resumeSimulationIfNeeded() {
  const sim = getState().simulation;
  if (sim && sim.running && ownsSimulation(sim)) startTimer();
}

// ===== GPS opcional (solo a pedido del usuario, nunca se envía a un servidor) =====
export function enableGpsTracking() {
  const order = getActiveDeliveryOrder();
  if (!order) {
    return { ok: false, message: 'No hay un pedido asignado para usar tu ubicación.' };
  }

  if (globalThis.isSecureContext === false) {
    const current = getState().simulation;
    const base = current && current.orderId === order.id ? current : createSimulationState(order, { running: false });
    const gpsError = 'El GPS real suele requerir HTTPS o localhost. Podés seguir usando la simulación.';
    setState({ simulation: { ...base, mode: 'demo', source: 'simulation', gpsStatus: 'requires_secure_context', gpsError } });
    return { ok: false, message: gpsError };
  }

  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    const sim = getState().simulation;
    if (sim) setState({ simulation: { ...sim, gpsStatus: 'unavailable', gpsError: 'Este navegador no tiene geolocalización.' } });
    return { ok: false, message: 'Geolocalización no disponible en este navegador.' };
  }

  const current = getState().simulation;
  const base = current && current.orderId === order.id ? current : createSimulationState(order, { running: false });
  stopTimer();
  setState({ simulation: { ...base, mode: 'gps', source: 'gps', running: false, gpsStatus: 'requesting', gpsError: undefined, owner: getDeviceId() } });

  try {
    if (gpsWatchId !== null) navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = navigator.geolocation.watchPosition(onGpsPosition, onGpsError, {
      enableHighAccuracy: true,
      maximumAge: 5_000,
      timeout: 12_000,
    });
  } catch (_) {
    const sim = getState().simulation;
    if (sim) setState({ simulation: { ...sim, mode: 'demo', source: 'simulation', gpsStatus: 'unavailable', gpsError: 'No se pudo iniciar la ubicación.' } });
    return { ok: false, message: 'No se pudo iniciar la ubicación.' };
  }

  return { ok: true, message: 'Usando tu ubicación como rider.' };
}

export function disableGpsTracking({ silent = false } = {}) {
  if (gpsWatchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
    try { navigator.geolocation.clearWatch(gpsWatchId); } catch (_) { /* no-op */ }
  }
  gpsWatchId = null;
  const sim = getState().simulation;
  if (sim && sim.mode === 'gps') {
    setState({ simulation: { ...sim, mode: 'demo', source: 'simulation', gpsStatus: 'inactive' } });
  }
  return { ok: true, message: silent ? '' : 'Ubicación en vivo desactivada.' };
}

export function isGpsActive() {
  return gpsWatchId !== null;
}

function onGpsPosition(position) {
  const sim = getState().simulation;
  if (!sim) return;
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
  // La ubicación solo se publica por el estado de la app y el relay LAN configurado.
  setState({
    simulation: {
      ...sim,
      ...location,
      mode: 'gps',
      source: 'gps',
      gpsStatus: 'active',
      running: false,
      gpsError: undefined,
      owner: getDeviceId(),
    },
  });
}

function onGpsError(error) {
  const sim = getState().simulation;
  const message = error && error.code === 1
    ? 'Permiso de ubicación denegado.'
    : 'No se pudo obtener tu ubicación.';
  disableGpsTracking({ silent: true });
  if (sim) setState({ simulation: { ...sim, mode: 'demo', source: 'simulation', gpsStatus: error && error.code === 1 ? 'denied' : 'unavailable', gpsError: message } });
}

// Limpia el GPS al salir de la vista del rider (la simulación demo sigue).
export function handleViewChangeForSimulation(view) {
  if (view !== 'rider' && isGpsActive()) {
    disableGpsTracking({ silent: true });
  }
}
