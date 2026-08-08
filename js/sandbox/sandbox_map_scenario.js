// Escenario del mapa en modo demo (?demo=1). Tiene dos mitades con reglas
// distintas, y la distinción importa:
//
//   - el ORIGEN es la ubicación REAL del comercio, y sale del contrato central
//     `js/core/business-location.js`. Antes había acá una copia a mano que caía
//     sobre Avenida Argentina, junto a Parque Central, a 793 m de la puerta: es
//     lo que la demo venía mostrando como «el local»;
//   - el DESTINO es sintético y público a propósito. Una plaza no es el
//     domicilio de nadie, así que la demo nunca expone dónde vive una persona.
//
// La ruta que los une no está dibujada a ojo: es el recorrido real por calles
// que devuelve OSRM sobre la red de OpenStreetMap, simplificado a 12 vértices.
import { BUSINESS_LOCATION, DEMO_CUSTOMER_DESTINATION } from '../core/business-location.js';

const STORE = Object.freeze({
  id: 'taba-sandbox-store',
  name: BUSINESS_LOCATION.name,
  label: `${BUSINESS_LOCATION.name} · ${BUSINESS_LOCATION.address}`,
  lat: BUSINESS_LOCATION.latitude,
  lng: BUSINESS_LOCATION.longitude,
});

const DESTINATION = Object.freeze({
  id: 'taba-sandbox-destination',
  name: DEMO_CUSTOMER_DESTINATION.name,
  label: DEMO_CUSTOMER_DESTINATION.label,
  lat: DEMO_CUSTOMER_DESTINATION.lat,
  lng: DEMO_CUSTOMER_DESTINATION.lng,
});

// Recorrido real por calles públicas: Mendoza -> Diagonal España -> Basavilbaso
// -> General Villegas -> Florentino Ameghino -> Basavilbaso -> La Fraternidad.
// 1441 m, ~4 min en auto.
const ROUTE_POINTS = Object.freeze([
  STORE,
  Object.freeze({ lat: -38.946389, lng: -68.053414 }),
  Object.freeze({ lat: -38.945561, lng: -68.052328 }),
  Object.freeze({ lat: -38.945507, lng: -68.049228 }),
  Object.freeze({ lat: -38.945300, lng: -68.048828 }),
  Object.freeze({ lat: -38.944430, lng: -68.048825 }),
  Object.freeze({ lat: -38.944424, lng: -68.046436 }),
  Object.freeze({ lat: -38.944676, lng: -68.046098 }),
  Object.freeze({ lat: -38.944686, lng: -68.041125 }),
  Object.freeze({ lat: -38.945015, lng: -68.041068 }),
  Object.freeze({ lat: -38.945208, lng: -68.040059 }),
  DESTINATION,
]);

export const SANDBOX_MAP_SCENARIO = Object.freeze({
  id: 'taba-sandbox-neuquen',
  city: 'Neuquén Capital',
  store: STORE,
  destination: DESTINATION,
  route: ROUTE_POINTS,
  routeLabel: 'Recorrido de muestra',
});

export function getSandboxMapScenario() {
  return SANDBOX_MAP_SCENARIO;
}

export function sandboxPointAtProgress(progress = 0) {
  const points = SANDBOX_MAP_SCENARIO.route;
  const numeric = Number(progress);
  const ratio = Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0;
  if (points.length < 2) return { ...points[0], source: 'sandbox_route' };

  const lengths = [];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const length = planarDistance(points[index - 1], points[index]);
    lengths.push(length);
    total += length;
  }
  const target = total * ratio;
  let travelled = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const segment = lengths[index - 1] || 0;
    if (travelled + segment >= target) {
      const local = segment ? (target - travelled) / segment : 0;
      return {
        lat: from.lat + (to.lat - from.lat) * local,
        lng: from.lng + (to.lng - from.lng) * local,
        heading: Math.atan2(to.lng - from.lng, to.lat - from.lat) * 180 / Math.PI,
        source: 'sandbox_route',
      };
    }
    travelled += segment;
  }
  return { ...points.at(-1), heading: 0, source: 'sandbox_route' };
}

export function sandboxRouteProgressPoint(progress = 0) {
  return sandboxPointAtProgress(progress);
}

// El rider se despega unos metros de origen/destino sólo en el render del
// marcador. Así los tres hitos siguen siendo reales y no quedan superpuestos.
export function sandboxMarkerPointAtProgress(progress = 0) {
  const numeric = Number(progress);
  const ratio = Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0;
  const point = sandboxPointAtProgress(ratio);
  const edgeRatio = ratio <= 0.025
    ? (0.025 - ratio) / 0.025
    : ratio >= 0.975
      ? (ratio - 0.975) / 0.025
      : 0;
  if (edgeRatio <= 0) return point;

  const route = SANDBOX_MAP_SCENARIO.route;
  const from = ratio < 0.5 ? route[0] : route.at(-2);
  const to = ratio < 0.5 ? route[1] : route.at(-1);
  const deltaLat = Number(to.lat) - Number(from.lat);
  const deltaLng = Number(to.lng) - Number(from.lng);
  const length = Math.hypot(deltaLat, deltaLng) || 1;
  // El pin de destino mide 54 px y la moto 52 px: una separación visual de
  // ~70 m evita que se toquen en móviles sin alterar las coordenadas reales
  // del escenario ni la ruta usada para el cálculo de progreso.
  const offset = 0.00062 * edgeRatio;
  return {
    ...point,
    lat: point.lat - (deltaLng / length) * offset,
    lng: point.lng + (deltaLat / length) * offset,
    visualOffset: true,
  };
}

function planarDistance(a, b) {
  const latScale = 111_000;
  const lngScale = 111_000 * Math.cos((Number(a.lat) * Math.PI) / 180);
  return Math.hypot((b.lat - a.lat) * latScale, (b.lng - a.lng) * lngScale);
}
