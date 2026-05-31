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
  const timestamp = Number(raw.timestamp) || Number(raw.lastFixAt) || Date.now();
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
  };
}

// Elige la ubicación del rider a mostrar, dadas la simulación local y la
// ubicación persistida del pedido (que en modo Supabase llega por polling
// desde el dispositivo del rider real). Reglas:
//  - el GPS real (source==='gps') tiene prioridad sobre la simulación;
//  - a igual jerarquía de fuente, gana el fix más reciente;
//  - coordenadas inválidas se descartan (normalizeRiderLocation devuelve null).
// Devuelve un TrackingLocation normalizado o null.
export function chooseRiderLocation(simRaw, trackedRaw) {
  const sim = simRaw ? normalizeRiderLocation(simRaw) : null;
  const tracked = trackedRaw ? normalizeRiderLocation(trackedRaw) : null;
  if (sim && tracked) {
    const simGps = sim.source === 'gps';
    const trackedGps = tracked.source === 'gps';
    if (trackedGps && !simGps) return tracked;
    if (simGps && !trackedGps) return sim;
    return tracked.timestamp > sim.timestamp ? tracked : sim;
  }
  return sim || tracked || null;
}

// Indica si un fix quedó "viejo" según un umbral (default 30s).
export function isLocationStale(location, maxAgeMs = 30_000, now = Date.now()) {
  if (!location) return true;
  const ts = Number(location.timestamp) || Date.parse(location.lastFixAt) || 0;
  if (!ts) return true;
  return now - ts > maxAgeMs;
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
