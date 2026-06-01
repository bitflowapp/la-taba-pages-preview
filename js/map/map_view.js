import { getState } from '../state.js';
import { getLastOrder } from '../orders.js';
import { RIDER_LOCATION_SOURCES, STORE_LOCATION, getMapTheme, getTileLayerForTheme } from './map_config.js';
import {
  chooseRiderLocation,
  distanceKm,
  getRoute,
  isLocationStale,
  normalizeRiderLocation,
  pointOnRoute,
  selectRouteForOrder,
  shouldRenderLocationUpdate,
} from './route_geometry.js';
import { createRiderIcon, updateRiderMarker } from './rider_marker.js';

const mountedMaps = new Set();
const TRACKING_STALE_MS = 30_000;

export function canUseLeaflet(root = globalThis) {
  return Boolean(root?.L?.map && root?.L?.tileLayer);
}

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
  if (entry.pendingFrame) {
    cancelFrame(entry.pendingFrame);
    entry.pendingFrame = null;
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
    if (entry) disposeMapEntry(entry);
  });
}

export function renderMapViews(root = document) {
  disposeDetachedMaps();
  root.querySelectorAll?.('[data-real-map]').forEach((node) => renderMapView(node));
}

function renderMapView(container) {
  const view = readMapViewState(container);
  if (!view.canvas) return;

  container.dataset.mapTheme = view.theme;
  container.classList.toggle('map-theme-dark', view.theme === 'dark');
  container.classList.toggle('map-theme-light', view.theme === 'light');
  updateTrackingStatusText(container, view);
  updateFallbackMap(container, view);

  if (!canUseLeaflet(globalThis)) {
    container.classList.add('map-unavailable');
    view.fallback?.removeAttribute('hidden');
    return;
  }

  container.classList.remove('map-unavailable');
  view.fallback?.setAttribute('hidden', '');
  const entry = ensureTrackingMap(container, view);
  scheduleTrackingVisualUpdate(entry, view);
}

function readMapViewState(container) {
  const fallback = container.querySelector('[data-map-fallback]');
  const canvas = container.querySelector('[data-map-canvas]');
  const emptyMap = container.dataset.mapRole === 'tracking-empty' || container.dataset.mapRole === 'rider-empty';
  const order = emptyMap ? null : findOrder(container.dataset.orderId);
  const sim = order ? getOrderSimulation(order.id) : null;
  const route = order ? selectRouteForOrder(order, sim?.routeId || sim?.destinationId) : getRoute('cipolletti');
  const riderLocation = order ? getRiderLocation(order, sim, route.id) : null;
  const destination = route.destination;
  const points = route.points.map((point) => [point.lat, point.lng]);
  const preferredTheme = container.dataset.mapRole?.startsWith('rider') ? 'dark' : 'light';
  const tileLayer = getTileLayerForTheme(preferredTheme);
  const theme = getMapTheme(tileLayer.theme);

  return {
    container,
    fallback,
    canvas,
    emptyMap,
    order,
    sim,
    route,
    riderLocation,
    destination,
    points,
    preferredTheme,
    tileLayer,
    theme,
  };
}

export function ensureTrackingMap(container, view) {
  const existing = mapEntryFor(container);
  if (existing) return existing;

  const L = globalThis.L;
  const map = L.map(view.canvas, {
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
    L,
    resizeTimer: null,
    pendingFrame: null,
    pendingView: null,
    routeId: null,
    routeLayer: null,
    progressLayer: null,
    destinationMarker: null,
    riderMarker: null,
    lastRenderedLocation: null,
    lastStatus: null,
    lastSource: null,
    userInteracted: false,
  };
  mountedMaps.add(entry);

  L.tileLayer(view.tileLayer.tilesUrl, {
    maxZoom: 18,
    attribution: view.tileLayer.attribution,
  }).addTo(map);
  L.control?.zoom?.({ position: 'bottomright' })?.addTo?.(map);
  map.on?.('dragstart', () => { entry.userInteracted = true; });
  map.on?.('zoomstart', () => { entry.userInteracted = true; });

  entry.routeLayer = L.polyline(view.points, routeLineStyle(view.theme)).addTo(map);
  entry.progressLayer = L.polyline([], progressLineStyle(view.theme)).addTo(map);
  L.marker([STORE_LOCATION.lat, STORE_LOCATION.lng], { icon: labelIcon(L, 'LT', 'store') }).addTo(map);
  entry.destinationMarker = L.marker([view.destination.lat, view.destination.lng], { icon: labelIcon(L, 'CL', 'client') }).addTo(map);
  entry.routeId = view.route.id;

  fitMapToView(entry, view);
  entry.resizeTimer = setTimeout(() => {
    entry.resizeTimer = null;
    if (!container.isConnected || !mountedMaps.has(entry)) return;
    try { map.invalidateSize(); } catch (_) { /* Leaflet may race detached DOM */ }
  }, 0);

  return entry;
}

export function scheduleTrackingVisualUpdate(entry, view) {
  if (!entry) return;
  entry.pendingView = view;
  if (entry.pendingFrame) return;
  entry.pendingFrame = requestFrame(() => {
    entry.pendingFrame = null;
    const nextView = entry.pendingView;
    entry.pendingView = null;
    if (!entry.container?.isConnected || !mountedMaps.has(entry)) return;
    applyTrackingVisualUpdate(entry, nextView);
  });
}

function applyTrackingVisualUpdate(entry, view) {
  if (!view) return;
  updateTrackingStatusText(entry.container, view);
  updateRouteLayers(entry, view);

  if (!view.riderLocation) {
    removeRiderMarker(entry);
    return;
  }

  ensureRiderMarker(entry, view);
  updateProgressLine(entry, view.riderLocation);
  updateRiderMarkerPosition(entry, view.riderLocation, {
    status: view.order?.status,
    source: view.riderLocation.source,
  });
}

function updateRouteLayers(entry, view) {
  if (entry.routeId === view.route.id) return;
  entry.routeId = view.route.id;
  entry.routeLayer?.setLatLngs?.(view.points);
  entry.destinationMarker?.setLatLng?.([view.destination.lat, view.destination.lng]);
  if (!entry.userInteracted) fitMapToView(entry, view);
}

export function ensureRiderMarker(entry, view) {
  if (!view.riderLocation) return null;
  if (entry.riderMarker) return entry.riderMarker;
  entry.riderMarker = entry.L.marker([view.riderLocation.lat, view.riderLocation.lng], {
    icon: createRiderIcon(entry.L, {
      status: view.order?.status,
      source: view.riderLocation.source,
      heading: view.riderLocation.heading,
    }),
  }).addTo(entry.map);
  entry.lastRenderedLocation = { ...view.riderLocation, renderedAt: Date.now() };
  entry.lastStatus = view.order?.status || null;
  entry.lastSource = view.riderLocation.source;
  return entry.riderMarker;
}

export function updateRiderMarkerPosition(entry, location, options = {}) {
  if (!entry?.riderMarker || !location) return null;
  const now = Date.now();
  const statusChanged = entry.lastStatus !== (options.status || null) || entry.lastSource !== location.source;
  if (!statusChanged && !shouldRenderLocationUpdate(entry.lastRenderedLocation, location, { now })) {
    return entry.riderMarker.getLatLng?.() || null;
  }

  const next = updateRiderMarker(entry.riderMarker, entry.L, location, options);
  entry.lastRenderedLocation = { ...location, renderedAt: now };
  entry.lastStatus = options.status || null;
  entry.lastSource = location.source;
  maybeFollowRider(entry, next);
  return next;
}

export function updateTrackingStatusText(container, view) {
  renderMapMeta(container, view.order, view.riderLocation, view.destination);
}

function updateProgressLine(entry, location) {
  if (!entry.progressLayer || !location) return;
  entry.progressLayer.setLatLngs?.([
    [STORE_LOCATION.lat, STORE_LOCATION.lng],
    [location.lat, location.lng],
  ]);
}

function updateFallbackMap(container, view) {
  const marker = container.querySelector?.('.map-marker.rider');
  if (!marker?.style || !view.order) return;
  const progress = Number.isFinite(Number(view.sim?.progress))
    ? view.sim.progress
    : view.order.status === 'delivered' ? 1
      : view.order.status === 'arriving' ? 0.92
        : view.order.status === 'on_the_way' ? 0.45
          : view.order.status === 'ready' ? 0.04
            : 0;
  marker.style.setProperty('--p', String(progress));
}

function removeRiderMarker(entry) {
  if (!entry.riderMarker) return;
  try { entry.map.removeLayer?.(entry.riderMarker); } catch (_) { /* no-op */ }
  entry.riderMarker = null;
  entry.lastRenderedLocation = null;
  if (entry.progressLayer) entry.progressLayer.setLatLngs?.([]);
}

function maybeFollowRider(entry, latLng) {
  if (!latLng || entry.userInteracted) return;
  const bounds = entry.map.getBounds?.();
  const innerBounds = bounds?.pad ? bounds.pad(-0.2) : bounds;
  if (innerBounds?.contains?.(latLng) === false) {
    try { entry.map.panTo?.(latLng, { animate: true, duration: 0.4 }); } catch (_) { /* no-op */ }
  }
}

function fitMapToView(entry, view) {
  const bounds = view.riderLocation
    ? [...view.points, [view.riderLocation.lat, view.riderLocation.lng]]
    : view.points;
  try { entry.map.fitBounds(bounds, { padding: [22, 22], maxZoom: 14 }); } catch (_) { /* no-op */ }
}

function requestFrame(callback) {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback);
  return setTimeout(callback, 0);
}

function cancelFrame(id) {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
  else clearTimeout(id);
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
  const chosen = chooseRiderLocation(sim, order?.tracking?.lastLocation);
  if (chosen) return chosen;

  const fallbackProgress = order.status === 'delivered' ? 1
    : order.status === 'arriving' ? 0.92
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
    meta.textContent = 'Neuquén Capital y Cipolletti';
    return;
  }

  const km = distanceKm(location, destination);
  const source = RIDER_LOCATION_SOURCES[location.source] || RIDER_LOCATION_SOURCES.simulation;
  const age = relativeAgeLabel(location.lastFixAt || location.timestamp);
  const gpsStale = location.source === 'gps' && isLocationStale(location, TRACKING_STALE_MS);
  const prefix = gpsStale ? 'Última ubicación rider' : source;
  const showAccuracy = container.dataset.mapRole?.startsWith('rider');
  const accuracy = showAccuracy && Number.isFinite(location.accuracy)
    ? ` · precisión ${Math.round(location.accuracy)} m`
    : '';
  meta.textContent = `${prefix} · actualizado ${age} · ${km.toFixed(1).replace('.', ',')} km aprox.${accuracy}`;
}

function relativeAgeLabel(value) {
  if (!value) return 'sin datos';
  const time = typeof value === 'number' ? value : new Date(value).getTime();
  if (Number.isNaN(time)) return 'sin datos';
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (seconds < 2) return 'ahora';
  if (seconds < 60) return `hace ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  return `hace ${minutes} min`;
}
