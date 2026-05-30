import { getState } from '../state.js';
import { getLastOrder } from '../orders.js';
import { DEFAULT_MAP_BOUNDS, RIDER_LOCATION_SOURCES, STORE_LOCATION, getMapTheme, getTileLayerForTheme } from './map_config.js';
import { distanceKm, getRoute, normalizeRiderLocation, pointOnRoute, selectRouteForOrder } from './route_geometry.js';
import { createRiderIcon, updateRiderMarker } from './rider_marker.js';

const mounted = new WeakMap();

export function canUseLeaflet(root = globalThis) {
  return Boolean(root?.L?.map && root?.L?.tileLayer);
}

export function disposeMapViews(root = document) {
  root.querySelectorAll?.('[data-real-map]').forEach((node) => {
    const current = mounted.get(node);
    if (current?.map?.remove) current.map.remove();
    mounted.delete(node);
  });
}

export function renderMapViews(root = document) {
  root.querySelectorAll?.('[data-real-map]').forEach((node) => renderMapView(node));
}

function renderMapView(container) {
  const L = globalThis.L;
  const fallback = container.querySelector('[data-map-fallback]');
  const canvas = container.querySelector('[data-map-canvas]');
  if (!canvas) return;

  if (!canUseLeaflet(globalThis)) {
    container.classList.add('map-unavailable');
    fallback?.removeAttribute('hidden');
    return;
  }

  container.classList.remove('map-unavailable');
  fallback?.setAttribute('hidden', '');

  const emptyMap = container.dataset.mapRole === 'tracking-empty' || container.dataset.mapRole === 'rider-empty';
  const order = emptyMap ? null : findOrder(container.dataset.orderId);
  const route = order ? selectRouteForOrder(order) : getRoute('cipolletti');
  const sim = order ? getOrderSimulation(order.id) : null;
  const riderLocation = order ? getRiderLocation(order, sim, route.id) : null;
  const destination = route.destination;
  const points = route.points.map((point) => [point.lat, point.lng]);
  const tileLayer = getTileLayerForTheme();
  const theme = getMapTheme(tileLayer.theme);
  container.dataset.mapTheme = theme;
  container.classList.toggle('map-theme-dark', theme === 'dark');
  container.classList.toggle('map-theme-light', theme === 'light');

  const map = L.map(canvas, {
    zoomControl: false,
    attributionControl: true,
    dragging: true,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    tap: true,
  });
  mounted.set(container, { map });

  L.tileLayer(tileLayer.tilesUrl, {
    maxZoom: 18,
    attribution: tileLayer.attribution,
  }).addTo(map);
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  const routeStyle = routeLineStyle(theme);
  const progressStyle = progressLineStyle(theme);
  L.polyline(points, routeStyle).addTo(map);
  if (riderLocation) {
    const progressPoint = [riderLocation.lat, riderLocation.lng];
    L.polyline([points[0], progressPoint], progressStyle).addTo(map);
  }

  L.marker([STORE_LOCATION.lat, STORE_LOCATION.lng], { icon: labelIcon(L, 'LT', 'store') }).addTo(map);
  L.marker([destination.lat, destination.lng], { icon: labelIcon(L, 'CL', 'client') }).addTo(map);

  if (riderLocation) {
    const marker = L.marker([riderLocation.lat, riderLocation.lng], {
      icon: createRiderIcon(L, {
        status: order.status,
        source: riderLocation.source,
        heading: riderLocation.heading,
      }),
    }).addTo(map);
    updateRiderMarker(marker, L, riderLocation, { status: order.status, source: riderLocation.source });
  }

  const bounds = riderLocation
    ? [...points, [riderLocation.lat, riderLocation.lng]]
    : points;
  map.fitBounds(bounds, { padding: [22, 22], maxZoom: 14 });
  setTimeout(() => map.invalidateSize(), 0);

  renderMapMeta(container, order, riderLocation, destination);
}

function labelIcon(L, label, kind) {
  return L.divIcon({
    className: `lt-map-marker ${kind}`,
    html: `<span>${label}</span>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

function routeLineStyle(theme) {
  return theme === 'light'
    ? { color: '#5e5045', weight: 4, opacity: 0.72, lineCap: 'round', lineJoin: 'round' }
    : { color: '#d6b08a', weight: 4, opacity: 0.86, lineCap: 'round', lineJoin: 'round' };
}

function progressLineStyle(theme) {
  return theme === 'light'
    ? { color: '#2f8052', weight: 5, opacity: 0.88, lineCap: 'round', lineJoin: 'round' }
    : { color: '#82d49a', weight: 5, opacity: 0.9, lineCap: 'round', lineJoin: 'round' };
}

function findOrder(orderId) {
  if (!orderId) return getLastOrder();
  return getState().orders.find((order) => order.id === orderId) || getLastOrder();
}

function getOrderSimulation(orderId) {
  const sim = getState().simulation;
  return sim && sim.orderId === orderId ? sim : null;
}

function getRiderLocation(order, sim, routeId) {
  if (sim) {
    const normalized = normalizeRiderLocation(sim);
    if (normalized) return normalized;
  }
  const fallbackProgress = order.status === 'arriving' ? 0.92
    : order.status === 'on_the_way' ? 0.45
    : order.status === 'ready' ? 0.04
    : 0;
  const point = pointOnRoute(routeId, fallbackProgress);
  return normalizeRiderLocation({ ...point, source: 'simulation', timestamp: Date.now() });
}

function renderMapMeta(container, order, location, destination) {
  const meta = container.querySelector('[data-map-meta]');
  if (!meta) return;
  if (!order || !location) {
    meta.textContent = 'Mapa demo Neuquén Capital y Cipolletti';
    return;
  }
  const km = distanceKm(location, destination);
  const source = RIDER_LOCATION_SOURCES[location.source] || RIDER_LOCATION_SOURCES.simulation;
  const updated = location.lastFixAt
    ? new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(location.lastFixAt))
    : 'sin hora';
  const accuracy = Number.isFinite(location.accuracy) ? ` · precisión ${Math.round(location.accuracy)} m` : '';
  meta.textContent = `${source} · ${km.toFixed(1).replace('.', ',')} km aprox. · actualizado ${updated}${accuracy}`;
}
