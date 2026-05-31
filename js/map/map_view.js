import { getState } from '../state.js';
import { getLastOrder } from '../orders.js';
import { DEFAULT_MAP_BOUNDS, RIDER_LOCATION_SOURCES, STORE_LOCATION, getMapTheme, getTileLayerForTheme } from './map_config.js';
import { chooseRiderLocation, distanceKm, getRoute, normalizeRiderLocation, pointOnRoute, selectRouteForOrder } from './route_geometry.js';
import { createRiderIcon, updateRiderMarker } from './rider_marker.js';

const mountedMaps = new Set();
const RIDER_GPS_ZOOM = 16;

export function canUseLeaflet(root = globalThis) {
  return Boolean(root?.L?.map && root?.L?.tileLayer);
}

function relativeAgeLabel(value) {
  if (!value) return 'sin datos';
  const time = Number(value) || new Date(value).getTime();
  if (Number.isNaN(time)) return 'sin datos';
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (seconds < 2) return 'ahora';
  if (seconds < 60) return `hace ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  return `hace ${minutes} min`;
}

// Limpia mapas Leaflet cuyo contenedor ya no está en el DOM (evita fugas y
// listeners colgados cuando el panel se vuelve a renderizar en cada tick).
function disposeDetachedMaps() {
  for (const entry of [...mountedMaps]) {
    if (!entry.container?.isConnected) {
      disposeMapEntry(entry);
    }
  }
}

function disposeMapEntry(entry) {
  if (!entry) return;
  if (entry.resizeTimer) {
    clearTimeout(entry.resizeTimer);
    entry.resizeTimer = null;
  }
  try { entry.map?.remove?.(); } catch (_) { /* no-op */ }
  mountedMaps.delete(entry);
}

function mapEntryFor(container) {
  for (const entry of mountedMaps) {
    if (entry.container === container) return entry;
  }
  return null;
}

export function disposeMapViews(root = document) {
  root.querySelectorAll?.('[data-real-map]').forEach((node) => {
    const entry = mapEntryFor(node);
    if (entry) {
      disposeMapEntry(entry);
    }
  });
}

export function renderMapViews(root = document) {
  disposeDetachedMaps();
  root.querySelectorAll?.('[data-real-map]').forEach((node) => renderMapView(node));
}

function renderMapView(container) {
  const fallback = container.querySelector('[data-map-fallback]');
  const canvas = container.querySelector('[data-map-canvas]');
  if (!canvas) return;

  // Datos del pedido/rider: se calculan SIEMPRE, haya o no Leaflet/tiles.
  const role = container.dataset.mapRole || 'tracking';
  const emptyMap = role === 'tracking-empty' || role === 'rider-empty';
  const order = emptyMap ? null : findOrder(container.dataset.orderId);
  const sim = order ? getOrderSimulation(order.id) : null;
  const route = order ? selectRouteForOrder(order, sim?.routeId || sim?.destinationId) : getRoute('cipolletti');
  const riderLocation = order ? getRiderLocation(order, sim, route.id, { role }) : null;
  const destination = route.destination;
  const points = route.points.map((point) => [point.lat, point.lng]);
  const preferredTheme = role.startsWith('rider') ? 'dark' : 'light';
  const tileLayer = getTileLayerForTheme(preferredTheme);
  const theme = getMapTheme(tileLayer.theme);
  container.dataset.mapTheme = theme;
  container.classList.toggle('map-theme-dark', theme === 'dark');
  container.classList.toggle('map-theme-light', theme === 'light');

  // La info textual (fuente, distancia, hora, precisión) se actualiza siempre,
  // así el seguimiento sigue siendo útil aunque el mapa con tiles no cargue.
  renderMapMeta(container, order, riderLocation, destination, sim);

  if (!canUseLeaflet(globalThis)) {
    container.classList.add('map-unavailable');
    fallback?.removeAttribute('hidden');
    return;
  }

  container.classList.remove('map-unavailable');
  fallback?.setAttribute('hidden', '');

  const existing = mapEntryFor(container);
  if (existing) {
    if (existing.routeId === route.id && existing.orderId === (order?.id || '') && existing.theme === theme) {
      updateMapEntry(existing, { order, role, points, riderLocation, theme });
      return;
    }
    disposeMapEntry(existing);
  }

  const L = globalThis.L;
  const map = L.map(canvas, {
    zoomControl: false,
    attributionControl: true,
    dragging: true,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    tap: true,
  });
  const entry = {
    container,
    map,
    resizeTimer: null,
    role,
    routeId: route.id,
    orderId: order?.id || '',
    theme,
    routeLine: null,
    progressLine: null,
    riderMarker: null,
    accuracyCircle: null,
    centeredOnGps: false,
    lastGpsTimestamp: null,
  };
  mountedMaps.add(entry);

  L.tileLayer(tileLayer.tilesUrl, {
    maxZoom: 18,
    attribution: tileLayer.attribution,
  }).addTo(map);
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  const routeStyle = routeLineStyle(theme);
  entry.routeLine = L.polyline(points, routeStyle).addTo(map);

  L.marker([STORE_LOCATION.lat, STORE_LOCATION.lng], { icon: labelIcon(L, 'LT', 'store') }).addTo(map);
  L.marker([destination.lat, destination.lng], { icon: labelIcon(L, 'CL', 'client') }).addTo(map);

  updateMapEntry(entry, { order, role, points, riderLocation, theme });
  fitInitialMap(entry, { points, riderLocation });
  entry.resizeTimer = setTimeout(() => {
    entry.resizeTimer = null;
    if (!container.isConnected || !mountedMaps.has(entry)) return;
    try { map.invalidateSize(); } catch (_) { /* Leaflet may race detached DOM */ }
  }, 0);
}

function updateMapEntry(entry, { order, role, points, riderLocation, theme }) {
  if (!entry?.map || !order) return;
  entry.role = role;
  syncProgressLine(entry, points, riderLocation, theme);
  syncRiderMarker(entry, order, riderLocation);
}

function syncProgressLine(entry, points, riderLocation, theme) {
  const L = globalThis.L;
  if (!L) return;
  if (!riderLocation || !points?.length) {
    if (entry.progressLine) {
      entry.map.removeLayer(entry.progressLine);
      entry.progressLine = null;
    }
    return;
  }
  const latLngs = [points[0], [riderLocation.lat, riderLocation.lng]];
  if (entry.progressLine) {
    entry.progressLine.setLatLngs(latLngs);
    return;
  }
  entry.progressLine = L.polyline(latLngs, progressLineStyle(theme)).addTo(entry.map);
}

function syncRiderMarker(entry, order, riderLocation) {
  const L = globalThis.L;
  if (!L) return;
  if (!riderLocation) {
    if (entry.riderMarker) {
      entry.map.removeLayer(entry.riderMarker);
      entry.riderMarker = null;
    }
    if (entry.accuracyCircle) {
      entry.map.removeLayer(entry.accuracyCircle);
      entry.accuracyCircle = null;
    }
    return;
  }

  if (!entry.riderMarker) {
    entry.riderMarker = L.marker([riderLocation.lat, riderLocation.lng], {
      icon: createRiderIcon(L, {
        status: order.status,
        source: riderLocation.source,
        heading: riderLocation.heading,
      }),
      title: riderLocation.source === 'gps' ? 'Tu ubicación real' : 'Rider',
    }).addTo(entry.map);
  }

  const moved = updateRiderMarker(entry.riderMarker, L, riderLocation, {
    status: order.status,
    source: riderLocation.source,
  });
  if (!moved) return;

  syncAccuracyCircle(entry, riderLocation);
  if (entry.role?.startsWith('rider') && riderLocation.source === 'gps') {
    const timestamp = riderLocation.timestamp || riderLocation.lastFixAt || Date.now();
    if (!entry.centeredOnGps) {
      entry.map.setView([riderLocation.lat, riderLocation.lng], Math.max(entry.map.getZoom?.() || 0, RIDER_GPS_ZOOM), { animate: true });
      entry.centeredOnGps = true;
    }
    entry.lastGpsTimestamp = timestamp;
  }
}

function syncAccuracyCircle(entry, riderLocation) {
  const L = globalThis.L;
  if (!L) return;
  if (riderLocation.source !== 'gps' || !Number.isFinite(Number(riderLocation.accuracy))) {
    if (entry.accuracyCircle) {
      entry.map.removeLayer(entry.accuracyCircle);
      entry.accuracyCircle = null;
    }
    return;
  }
  const latLng = [riderLocation.lat, riderLocation.lng];
  const radius = Math.max(5, Math.round(Number(riderLocation.accuracy)));
  if (entry.accuracyCircle) {
    entry.accuracyCircle.setLatLng(latLng);
    entry.accuracyCircle.setRadius(radius);
    return;
  }
  entry.accuracyCircle = L.circle(latLng, {
    radius,
    color: '#68b77c',
    weight: 1.5,
    opacity: 0.62,
    fillColor: '#68b77c',
    fillOpacity: 0.13,
  }).addTo(entry.map);
}

function fitInitialMap(entry, { points, riderLocation }) {
  if (entry.role?.startsWith('rider') && riderLocation?.source === 'gps') {
    entry.map.setView([riderLocation.lat, riderLocation.lng], RIDER_GPS_ZOOM, { animate: false });
    entry.centeredOnGps = true;
    entry.lastGpsTimestamp = riderLocation.timestamp || riderLocation.lastFixAt || Date.now();
    return;
  }
  const bounds = riderLocation
    ? [...points, [riderLocation.lat, riderLocation.lng]]
    : points;
  entry.map.fitBounds(bounds, { padding: [22, 22], maxZoom: 14 });
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

// Prioridad de ubicación del rider para el mapa:
//  1) GPS real propio en curso (sim.source === 'gps' en este dispositivo);
//  2) ubicación persistida del pedido (order.tracking.lastLocation), que en
//     modo Supabase llega por polling desde otro dispositivo (el rider real);
//  3) simulación local;
//  4) punto sintético sobre la ruta.
// Una ubicación GPS persistida le gana a la simulación, salvo que este mismo
// equipo tenga un fix GPS más nuevo.
function getRiderLocation(order, sim, routeId, { role = 'tracking' } = {}) {
  // GPS real (propio o persistido por el rider en Supabase) gana a la simulación.
  const chosen = chooseRiderLocation(sim, order?.tracking?.lastLocation);
  if (chosen) return chosen;

  const isRiderMap = role.startsWith('rider');
  const isWaitingForRealGps = sim?.mode === 'gps'
    && sim?.gpsStatus === 'requesting'
    && sim?.source !== 'gps';
  if (isRiderMap && isWaitingForRealGps) return null;

  const fallbackProgress = order.status === 'delivered' ? 1
    : order.status === 'arriving' ? 0.92
    : order.status === 'on_the_way' ? 0.45
    : order.status === 'ready' ? 0.04
    : 0;
  const point = pointOnRoute(routeId, fallbackProgress);
  return normalizeRiderLocation({ ...point, source: 'simulation', timestamp: Date.now() });
}

function renderMapMeta(container, order, location, destination, sim = null) {
  const meta = container.querySelector('[data-map-meta]');
  if (!meta) return;
  const role = container.dataset.mapRole || 'tracking';
  const isRiderMap = role.startsWith('rider');
  if (!order || !location) {
    if (isRiderMap && sim?.mode === 'gps' && sim?.gpsStatus === 'requesting') {
      meta.textContent = 'Buscando señal GPS...';
      return;
    }
    meta.textContent = 'Neuquén Capital y Cipolletti';
    return;
  }
  const km = distanceKm(location, destination);
  if (isRiderMap) {
    const updated = relativeAgeLabel(location.timestamp || location.lastFixAt);
    const isLiveGps = location.source === 'gps' && sim?.gpsStatus === 'active';
    const source = location.source === 'gps'
      ? (isLiveGps ? 'Tu ubicación real' : 'Última ubicación real')
      : 'Recorrido de prueba';
    const accuracy = location.source === 'gps' && Number.isFinite(location.accuracy)
      ? ` · precisión ${Math.round(location.accuracy)} m`
      : '';
    meta.textContent = `${source} · ${km.toFixed(1).replace('.', ',')} km aprox. · actualizado ${updated}${accuracy}`;
    return;
  }
  const source = RIDER_LOCATION_SOURCES[location.source] || RIDER_LOCATION_SOURCES.simulation;
  const updated = location.lastFixAt
    ? new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(location.lastFixAt))
    : 'sin hora';
  const showAccuracy = container.dataset.mapRole?.startsWith('rider');
  const accuracy = showAccuracy && Number.isFinite(location.accuracy) ? ` · precisión ${Math.round(location.accuracy)} m` : '';
  meta.textContent = `${source} · ${km.toFixed(1).replace('.', ',')} km aprox. · actualizado ${updated}${accuracy}`;
}
