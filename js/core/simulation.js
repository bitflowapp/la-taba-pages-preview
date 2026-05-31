// Motor puro de la simulación de reparto en tiempo real (modo demo local).
// No usa timers ni DOM: solo calcula el siguiente estado para que el
// controlador (js/simulation.js) lo aplique. Esto lo hace fácil de testear.
//
// IMPORTANTE: esto es una simulación local. Para tiempo real entre el celular
// del cliente y el del repartidor hace falta un backend realtime
// (Supabase Realtime, Firebase, WebSocket). Ver README.

import { STORE_LOCATION } from '../map/map_config.js';
import {
  pointOnRoute,
  selectRouteForOrder,
} from '../map/route_geometry.js';

// Duración total de un recorrido simulado, en milisegundos.
export const SIMULATION_TOTAL_MS = 24_000;
// Cadencia del intervalo del controlador.
export const SIMULATION_TICK_MS = 1_200;

// Coordenadas demo (Neuquén capital aprox.) para mover el marcador del rider.
export const DEMO_STORE_POINT = Object.freeze({ lat: STORE_LOCATION.lat, lng: STORE_LOCATION.lng });
export const DEMO_CLIENT_POINT = Object.freeze({ lat: -38.9402, lng: -68.0735 });

export function clampProgress(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  if (numeric < 0) return 0;
  if (numeric > 1) return 1;
  return numeric;
}

// Avanza el progreso 0..1 según el tiempo transcurrido en el tick.
export function nextProgress(progress, deltaMs = SIMULATION_TICK_MS, totalMs = SIMULATION_TOTAL_MS) {
  const safeTotal = Number(totalMs) > 0 ? Number(totalMs) : SIMULATION_TOTAL_MS;
  const step = Number(deltaMs) > 0 ? Number(deltaMs) / safeTotal : 0;
  return clampProgress(clampProgress(progress) + step);
}

// ETA restante en minutos en función del progreso y el ETA base del pedido.
export function progressToEta(progress, baseEta) {
  const base = Math.max(0, Math.floor(Number(baseEta) || 0));
  const remaining = base * (1 - clampProgress(progress));
  return Math.max(0, Math.round(remaining));
}

// Interpolación lineal de la posición demo del rider entre local y cliente.
export function interpolatePoint(progress, from = DEMO_STORE_POINT, to = DEMO_CLIENT_POINT) {
  const p = clampProgress(progress);
  return {
    lat: from.lat + (to.lat - from.lat) * p,
    lng: from.lng + (to.lng - from.lng) * p,
  };
}

// Estado inicial de la simulación para un pedido dado.
export function createSimulationState(order, { running = true, now = Date.now(), destinationId = null, routeId = null } = {}) {
  if (!order || typeof order.id !== 'string') return null;
  const route = selectRouteForOrder(order, routeId || destinationId);
  const baseEta = Math.max(1, Math.floor(Number(order?.delivery?.estimatedMinutes) || 12));
  const startProgress = order.status === 'arriving' ? 0.85
    : order.status === 'on_the_way' ? 0.08
    : 0;
  const point = pointOnRoute(route.id, startProgress);
  const timestamp = Number(now) || Date.now();
  return {
    orderId: order.id,
    running: Boolean(running),
    mode: 'demo',
    source: 'simulation',
    routeId: route.id,
    destinationId: route.destination?.id || route.id,
    progress: startProgress,
    baseEta,
    etaMinutes: progressToEta(startProgress, baseEta),
    startedAt: new Date(timestamp).toISOString(),
    timestamp,
    lastFixAt: new Date(timestamp).toISOString(),
    lat: point.lat,
    lng: point.lng,
    heading: point.heading,
  };
}

// Calcula el siguiente estado de simulación en un tick.
// Devuelve { simulation, reachedEnd } sin mutar la entrada.
export function advanceSimulation(simulation, deltaMs = SIMULATION_TICK_MS) {
  if (!simulation) return { simulation: null, reachedEnd: false };
  const progress = nextProgress(simulation.progress, deltaMs, SIMULATION_TOTAL_MS);
  const reachedEnd = progress >= 1;
  const point = simulation.mode === 'gps' && Number.isFinite(simulation.lat)
    ? { lat: simulation.lat, lng: simulation.lng, heading: simulation.heading }
    : pointOnRoute(simulation.routeId, progress);
  const timestamp = Date.now();
  return {
    simulation: {
      ...simulation,
      progress,
      source: simulation.mode === 'gps' ? 'gps' : 'simulation',
      etaMinutes: progressToEta(progress, simulation.baseEta),
      running: reachedEnd ? false : simulation.running,
      timestamp,
      lastFixAt: new Date(timestamp).toISOString(),
      lat: point.lat,
      lng: point.lng,
      ...(Number.isFinite(Number(point.heading)) ? { heading: point.heading } : {}),
    },
    reachedEnd,
  };
}

export function simulationProgressPercent(simulation) {
  return Math.round(clampProgress(simulation?.progress) * 100);
}
