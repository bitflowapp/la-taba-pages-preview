import {
  DEFAULT_STREET_TEST_DESTINATION_ID,
  DEMO_DESTINATIONS,
  DEMO_STREET_TEST_DESTINATIONS,
  STORE_LOCATION,
} from './map_config.js';

const BASE_ROUTES = Object.freeze({
  neuquen: {
    id: 'neuquen',
    name: 'Ruta demo · Neuquén Capital',
    destination: DEMO_DESTINATIONS.neuquen,
    points: [
      { lat: STORE_LOCATION.lat, lng: STORE_LOCATION.lng },
      { lat: -38.9498, lng: -68.0648 },
      { lat: -38.9467, lng: -68.0691 },
      { lat: -38.9431, lng: -68.0718 },
      { lat: DEMO_DESTINATIONS.neuquen.lat, lng: DEMO_DESTINATIONS.neuquen.lng },
    ],
  },
  cipolletti: {
    id: 'cipolletti',
    name: 'Ruta demo · Neuquén a Cipolletti',
    destination: DEMO_DESTINATIONS.cipolletti,
    points: [
      { lat: STORE_LOCATION.lat, lng: STORE_LOCATION.lng },
      { lat: -38.9482, lng: -68.0436 },
      { lat: -38.9438, lng: -68.0258 },
      { lat: -38.9395, lng: -68.0074 },
      { lat: DEMO_DESTINATIONS.cipolletti.lat, lng: DEMO_DESTINATIONS.cipolletti.lng },
    ],
  },
});

const STREET_ROUTES = Object.freeze(Object.fromEntries(
  DEMO_STREET_TEST_DESTINATIONS.map((destination, index) => [
    destination.id,
    buildStreetRoute(destination, index),
  ]),
));

const ROUTES = Object.freeze({
  ...BASE_ROUTES,
  ...STREET_ROUTES,
});

export const GPS_FIX_STALE_MS = 30_000;
export const GPS_MAX_ACCURACY_METERS = 250;
export const GPS_BAD_ACCURACY_METERS = 150;
export const GPS_GOOD_ACCURACY_METERS = 80;
export const GPS_MAX_REASONABLE_SPEED_MPS = 45;
export const GPS_HARD_MAX_SPEED_MPS = 80;
export const TRACKING_RENDER_MIN_MS = 800;
export const TRACKING_RENDER_MIN_METERS = 5;
export const GPS_PUBLISH_MIN_MS = 7_500;
export const GPS_PUBLISH_MIN_METERS = 20;
export const GPS_PUBLISH_MAX_MS = 15_000;
export const GPS_NEAR_CUSTOMER_PUBLISH_MIN_MS = 2_500;
export const GPS_NEAR_CUSTOMER_PUBLISH_MIN_METERS = 6;
export const GPS_NEAR_CUSTOMER_PUBLISH_MAX_MS = 8_000;
export const GPS_RENDER_MIN_MS = 1_200;
export const GPS_RENDER_MIN_METERS = 6;
export const GPS_HEADING_CHANGE_DEGREES = 45;

export function getDemoRoutes() {
  return ROUTES;
}

export function getStreetTestDestinations() {
  return DEMO_STREET_TEST_DESTINATIONS;
}

export function getStreetTestDestination(destinationId = DEFAULT_STREET_TEST_DESTINATION_ID) {
  const candidate = DEMO_STREET_TEST_DESTINATIONS.find((destination) => destination.id === destinationId);
  return candidate || DEMO_STREET_TEST_DESTINATIONS[0] || DEMO_DESTINATIONS.neuquen;
}

export function isStreetTestDestinationId(destinationId) {
  return DEMO_STREET_TEST_DESTINATIONS.some((destination) => destination.id === destinationId);
}

export function selectRouteForOrder(order = {}, preferredRouteId = null) {
  const explicitRoute = preferredRouteId || order?.delivery?.demoDestinationId;
  if (explicitRoute && ROUTES[explicitRoute]) return ROUTES[explicitRoute];
  const address = String(order.address || '').toLowerCase();
  if (address.includes('cipolletti') || address.includes('cipo')) return ROUTES.cipolletti;
  return ROUTES.neuquen;
}

export function getRoute(routeId = 'neuquen') {
  return ROUTES[routeId] || ROUTES.neuquen;
}

function buildStreetRoute(destination, index) {
  const offset = index % 2 === 0 ? 0.0028 : -0.0028;
  const closeToStore = distanceKm(STORE_LOCATION, destination) < 0.12;
  const points = closeToStore
    ? [
        { lat: STORE_LOCATION.lat, lng: STORE_LOCATION.lng },
        { lat: STORE_LOCATION.lat + 0.0018, lng: STORE_LOCATION.lng - 0.0014 },
        { lat: destination.lat, lng: destination.lng },
      ]
    : [
        { lat: STORE_LOCATION.lat, lng: STORE_LOCATION.lng },
        {
          lat: STORE_LOCATION.lat + (destination.lat - STORE_LOCATION.lat) * 0.35 + offset,
          lng: STORE_LOCATION.lng + (destination.lng - STORE_LOCATION.lng) * 0.35 - offset,
        },
        {
          lat: STORE_LOCATION.lat + (destination.lat - STORE_LOCATION.lat) * 0.7 - offset,
          lng: STORE_LOCATION.lng + (destination.lng - STORE_LOCATION.lng) * 0.7 + offset,
        },
        { lat: destination.lat, lng: destination.lng },
      ];

  return {
    id: destination.id,
    name: `Ruta calle demo · ${destination.label}`,
    destination: {
      id: destination.id,
      name: destination.addressLabel || destination.label,
      label: destination.label,
      addressLabel: destination.addressLabel,
      city: destination.city,
      lat: destination.lat,
      lng: destination.lng,
    },
    points,
  };
}

export function clampProgress(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

export function distanceKm(a, b) {
  if (!isLatLng(a) || !isLatLng(b)) return 0;
  const r = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function routeDistanceKm(points = []) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += distanceKm(points[i - 1], points[i]);
  }
  return total;
}

export function bearingDegrees(a, b) {
  if (!isLatLng(a) || !isLatLng(b)) return null;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2)
    - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function pointOnRoute(routeId, progress) {
  const route = getRoute(routeId);
  const points = route.points;
  if (points.length <= 1) return { ...points[0], heading: 0 };

  const total = routeDistanceKm(points);
  const target = total * clampProgress(progress);
  let travelled = 0;

  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1];
    const to = points[i];
    const segment = distanceKm(from, to);
    if (travelled + segment >= target) {
      const local = segment > 0 ? (target - travelled) / segment : 0;
      return {
        lat: from.lat + (to.lat - from.lat) * local,
        lng: from.lng + (to.lng - from.lng) * local,
        heading: bearingDegrees(from, to) ?? 0,
      };
    }
    travelled += segment;
  }

  const last = points.at(-1);
  const before = points.at(-2);
  return { ...last, heading: bearingDegrees(before, last) ?? 0 };
}

export function normalizeRiderLocation(raw = {}, fallback = {}) {
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }
  const rawTimestamp = Number(raw.timestamp);
  const rawFixTimestamp = Number(raw.lastFixAt);
  const parsedTimestamp = Date.parse(raw.timestamp || raw.lastFixAt || '');
  const timestamp = Number.isFinite(rawTimestamp) && rawTimestamp > 0
    ? rawTimestamp
    : Number.isFinite(rawFixTimestamp) && rawFixTimestamp > 0
      ? rawFixTimestamp
      : Number.isNaN(parsedTimestamp) ? Date.now() : parsedTimestamp;
  const source = raw.source === 'gps' ? 'gps' : raw.source === 'simulation' ? 'simulation' : (fallback.source || 'simulation');
  return {
    lat,
    lng,
    source,
    timestamp,
    lastFixAt: new Date(timestamp).toISOString(),
    ...(Number.isFinite(Number(raw.accuracy)) ? { accuracy: Math.max(0, Number(raw.accuracy)) } : {}),
    ...(Number.isFinite(Number(raw.heading)) ? { heading: ((Number(raw.heading) % 360) + 360) % 360 } : {}),
    ...(Number.isFinite(Number(raw.speed)) ? { speed: Math.max(0, Number(raw.speed)) } : {}),
    ...(typeof raw.gpsStatus === 'string' ? { gpsStatus: raw.gpsStatus } : {}),
    ...(raw.origin === 'local_gps' || raw.origin === 'sandbox_route' ? { origin: raw.origin } : {}),
  };
}

// Elige la ubicación del rider a mostrar, dadas la simulación local y la
// ubicación persistida del pedido (que en modo Supabase llega por polling
// desde el dispositivo del rider real). Reglas:
//  - el GPS real (source==='gps') tiene prioridad sobre la simulación;
//  - a igual jerarquía de fuente, gana el fix más reciente;
//  - coordenadas inválidas se descartan (normalizeRiderLocation devuelve null).
// Devuelve un TrackingLocation normalizado o null.
export function isValidLocation(location) {
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  return Number.isFinite(lat)
    && Number.isFinite(lng)
    && lat >= -90
    && lat <= 90
    && lng >= -180
    && lng <= 180;
}

export function locationTimestamp(location) {
  if (!location) return 0;
  const numeric = Number(location.timestamp);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(location.lastFixAt || location.createdAt || '');
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function isUsableGpsFix(location, {
  now = Date.now(),
  maxAgeMs = GPS_FIX_STALE_MS,
  maxAccuracyMeters = GPS_MAX_ACCURACY_METERS,
} = {}) {
  const normalized = normalizeRiderLocation(location, { source: 'gps' });
  if (!normalized || normalized.source !== 'gps') return false;
  const timestamp = locationTimestamp(normalized);
  if (!timestamp || timestamp > now + 10_000) return false;
  if (now - timestamp > maxAgeMs) return false;
  if (Number.isFinite(normalized.accuracy) && normalized.accuracy > maxAccuracyMeters) return false;
  return true;
}

export function shouldAcceptLocationUpdate(previousRaw, nextRaw, {
  now = Date.now(),
  staleMs = GPS_FIX_STALE_MS,
} = {}) {
  const next = normalizeRiderLocation(nextRaw);
  if (!next) return false;

  const previous = previousRaw ? normalizeRiderLocation(previousRaw) : null;
  if (!previous) {
    return next.source !== 'gps' || isUsableGpsFix(next, { now, maxAgeMs: staleMs });
  }

  const nextGps = next.source === 'gps';
  const previousGps = previous.source === 'gps';
  if (nextGps && !isUsableGpsFix(next, { now, maxAgeMs: staleMs })) return false;
  if (previousGps && !nextGps && !isLocationStale(previous, staleMs, now)) return false;
  if (nextGps && !previousGps) return !isImpossibleJump(previous, next);
  if (!nextGps && previousGps && isLocationStale(previous, staleMs, now)) return true;

  const previousTime = locationTimestamp(previous);
  const nextTime = locationTimestamp(next);
  if (previousTime && nextTime && nextTime < previousTime) return false;
  if (isImpossibleJump(previous, next)) return false;

  const previousFresh = !isLocationStale(previous, staleMs, now);
  const previousAccuracy = Number(previous.accuracy);
  const nextAccuracy = Number(next.accuracy);
  if (
    previousFresh
    && Number.isFinite(previousAccuracy)
    && Number.isFinite(nextAccuracy)
    && previousAccuracy <= GPS_GOOD_ACCURACY_METERS
    && nextAccuracy >= GPS_BAD_ACCURACY_METERS
  ) {
    return false;
  }

  return true;
}

export function shouldAcceptGpsFix(previousRaw, nextRaw, options = {}) {
  return shouldAcceptLocationUpdate(previousRaw, nextRaw, options);
}

export function shouldPublishGpsFix(previousPublishedRaw, nextRaw, {
  now = Date.now(),
  orderStatus = '',
  previousOrderStatus = '',
  nearCustomer = false,
  force = false,
  minMs = nearCustomer ? GPS_NEAR_CUSTOMER_PUBLISH_MIN_MS : GPS_PUBLISH_MIN_MS,
  minMeters = nearCustomer ? GPS_NEAR_CUSTOMER_PUBLISH_MIN_METERS : GPS_PUBLISH_MIN_METERS,
  maxMs = nearCustomer ? GPS_NEAR_CUSTOMER_PUBLISH_MAX_MS : GPS_PUBLISH_MAX_MS,
} = {}) {
  const status = String(orderStatus || '').toLowerCase();
  if (status === 'delivered' || status === 'cancelled') return false;
  if (!nextRaw) return false;

  const next = normalizeRiderLocation(nextRaw, { source: 'gps' });
  if (!next || next.source !== 'gps') return false;
  if (!isUsableGpsFix(next, { now })) return false;

  const previous = previousPublishedRaw
    ? normalizeRiderLocation(previousPublishedRaw, { source: 'gps' })
    : null;
  if (!previous) return true;
  if (force) return true;
  if (previousOrderStatus && orderStatus && previousOrderStatus !== orderStatus) return true;

  const previousPublishedAt = Number(previousPublishedRaw.at || previousPublishedRaw.publishedAt || 0)
    || locationTimestamp(previous);
  const elapsedMs = previousPublishedAt ? now - previousPublishedAt : 0;
  if (elapsedMs < 0) return false;

  const meters = distanceKm(previous, next) * 1000;
  if (elapsedMs >= minMs && meters >= minMeters) return true;
  if (elapsedMs >= maxMs) return true;

  return elapsedMs >= minMs
    && meters >= Math.min(3, minMeters)
    && hasSignificantHeadingChange(previous.heading, next.heading);
}

export function shouldRenderLocationUpdate(previousRenderedRaw, nextRaw, {
  now = Date.now(),
  minMs = TRACKING_RENDER_MIN_MS,
  minMeters = TRACKING_RENDER_MIN_METERS,
} = {}) {
  if (!nextRaw) return false;
  const next = normalizeRiderLocation(nextRaw);
  if (!next) return false;
  const previous = previousRenderedRaw ? normalizeRiderLocation(previousRenderedRaw) : null;
  if (!previous) return true;
  if (previous.source !== next.source) return true;

  const meters = distanceKm(previous, next) * 1000;
  if (meters >= minMeters) return true;

  const previousRenderAt = Number(previousRenderedRaw.renderedAt || previousRenderedRaw.renderedAtMs || 0);
  if (previousRenderAt && now - previousRenderAt >= minMs) return true;

  const previousTime = locationTimestamp(previous);
  const nextTime = locationTimestamp(next);
  return Boolean(previousTime && nextTime && nextTime - previousTime >= minMs);
}

export function shouldRenderGpsFix(previousRenderedRaw, nextRaw, {
  now = Date.now(),
  minMs = GPS_RENDER_MIN_MS,
  minMeters = GPS_RENDER_MIN_METERS,
} = {}) {
  if (!nextRaw) return false;
  const next = normalizeRiderLocation(nextRaw);
  if (!next) return false;
  return shouldRenderLocationUpdate(previousRenderedRaw, next, { now, minMs, minMeters });
}

export function chooseRiderLocation(simRaw, trackedRaw, { now = Date.now(), staleMs = GPS_FIX_STALE_MS } = {}) {
  const sim = simRaw ? normalizeRiderLocation(simRaw) : null;
  const tracked = trackedRaw ? normalizeRiderLocation(trackedRaw) : null;
  if (sim && tracked) {
    const simGps = sim.source === 'gps';
    const trackedGps = tracked.source === 'gps';
    if (trackedGps && !simGps) return isLocationStale(tracked, staleMs, now) ? sim : tracked;
    if (simGps && !trackedGps) return isLocationStale(sim, staleMs, now) ? tracked : sim;
    return tracked.timestamp > sim.timestamp ? tracked : sim;
  }
  return sim || tracked || null;
}

// ¿Hay un repartidor "en vivo" para este pedido? Sólo cuenta una ubicación GPS
// REAL y reciente. La simulación / recorrido de apoyo NO es un rider real, así
// que el tracking del cliente no debe presentarla como tal.
export function hasLiveRiderLocation(location, { now = Date.now(), staleMs = GPS_FIX_STALE_MS } = {}) {
  const normalized = location ? normalizeRiderLocation(location) : null;
  if (!normalized || normalized.source !== 'gps') return false;
  if (['inactive', 'denied', 'unavailable', 'requires_secure_context'].includes(normalized.gpsStatus)) return false;
  return !isLocationStale(normalized, staleMs, now);
}

// Estado de "vivacidad" del seguimiento de un pedido. Sirve para que la UI
// vuelva a un fallback honesto cuando el GPS real se enfría, SIN depender de que
// llegue un nuevo evento de estado (p. ej. el rider pierde señal o cierra la
// pestaña y deja de publicar). Es puro (sin DOM ni timers) para poder testearlo.
//   - 'none'     : no hay pedido.
//   - 'terminal' : pedido entregado/cancelado (no se sigue).
//   - 'live'     : hay un fix GPS real y fresco del rider.
//   - 'idle'     : hay pedido activo pero sin GPS real fresco (fallback honesto).
export function activeTrackingLiveness(order, sim = null, { now = Date.now(), staleMs = GPS_FIX_STALE_MS } = {}) {
  if (!order || !order.id) return 'none';
  if (order.status === 'delivered' || order.status === 'cancelled') return 'terminal';
  const simForOrder = sim && sim.orderId === order.id ? sim : null;
  const location = chooseRiderLocation(simForOrder, order?.tracking?.lastLocation, { now, staleMs });
  return hasLiveRiderLocation(location, { now, staleMs }) ? 'live' : 'idle';
}

// Indica si un fix quedó "viejo" según un umbral (default 30s).
export function isLocationStale(location, maxAgeMs = 30_000, now = Date.now()) {
  if (!location) return true;
  const ts = locationTimestamp(location);
  if (!ts) return true;
  return now - ts > maxAgeMs;
}

function isImpossibleJump(previous, next) {
  if (!previous || !next) return false;
  const previousTime = locationTimestamp(previous);
  const nextTime = locationTimestamp(next);
  if (!previousTime || !nextTime || nextTime <= previousTime) return false;
  const seconds = (nextTime - previousTime) / 1000;
  if (seconds <= 0) return false;

  const meters = distanceKm(previous, next) * 1000;
  const inferredSpeed = meters / seconds;
  if (inferredSpeed >= GPS_HARD_MAX_SPEED_MPS) return true;

  const nextAccuracy = Number(next.accuracy);
  return inferredSpeed >= GPS_MAX_REASONABLE_SPEED_MPS
    && Number.isFinite(nextAccuracy)
    && nextAccuracy >= GPS_GOOD_ACCURACY_METERS;
}

function hasSignificantHeadingChange(previousHeading, nextHeading) {
  const previous = Number(previousHeading);
  const next = Number(nextHeading);
  if (!Number.isFinite(previous) || !Number.isFinite(next)) return false;
  const diff = Math.abs(((next - previous + 540) % 360) - 180);
  return diff >= GPS_HEADING_CHANGE_DEGREES;
}

function isLatLng(value) {
  return value && Number.isFinite(Number(value.lat)) && Number.isFinite(Number(value.lng));
}

function toRad(value) {
  return (Number(value) * Math.PI) / 180;
}

function toDeg(value) {
  return (Number(value) * 180) / Math.PI;
}
