import { getState } from '../state.js';
import { getActiveOrder } from '../orders.js';
import { getOrderRepository, isSandboxOrderRepository } from '../repositories/repository_factory.js';
import { getSandboxMapScenario, sandboxMarkerPointAtProgress } from '../sandbox/sandbox_map_scenario.js';
import { RIDER_LOCATION_SOURCES } from './map_config.js';
import {
  chooseRiderLocation,
  hasKnownSharedGpsLocation,
  shouldRenderGpsFix,
  trackingLocationFreshness,
} from './route_geometry.js';
import {
  canUseMapLibre as supportsMapLibre,
  createMapLibreTrackingMap,
} from './maplibre_tracking_map.js';

const mountedMaps = new Set();

export function canUseMapLibre(root = globalThis) {
  return supportsMapLibre({
    root,
    documentRef: root?.document,
    maplibregl: root?.maplibregl,
  });
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
  if (entry.pendingFrame) {
    cancelFrame(entry.pendingFrame);
    entry.pendingFrame = null;
  }
  entry.adapter?.destroy?.();
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

// Vuelve a centrar el mapa en la ubicación REAL del rider y reanuda el
// auto-seguimiento. Si no hay fix real montado, no hace nada (no inventa centro).
export function recenterMapViews(root = document) {
  let recentered = false;
  root.querySelectorAll?.('[data-real-map]').forEach((node) => {
    const entry = mapEntryFor(node);
    if (!entry) return;
    recentered = entry.adapter?.recenter?.() || recentered;
  });
  return recentered;
}

function renderMapView(container) {
  const view = readMapViewState(container);
  if (!view.canvas) return;

  container.dataset.mapTheme = view.theme;
  container.classList.toggle('map-theme-dark', view.theme === 'dark');
  container.classList.toggle('map-theme-light', view.theme === 'light');
  updateTrackingStatusText(container, view);
  const entry = ensureTrackingMap(container, view);
  entry?.adapter?.resize?.();
  scheduleTrackingVisualUpdate(entry, view);
}

function readMapViewState(container) {
  const fallback = container.querySelector('[data-map-fallback]');
  const canvas = container.querySelector('[data-map-canvas]');
  const emptyMap = container.dataset.mapRole === 'tracking-empty' || container.dataset.mapRole === 'rider-empty';
  const order = emptyMap ? null : findOrder(container.dataset.orderId);
  const sim = order ? getOrderSimulation(order.id) : null;
  const role = container.dataset.mapRole?.startsWith('rider') ? 'rider' : 'tracking';
  const sandbox = isSandboxOrderRepository(getOrderRepository()) && container.dataset.mapSource === 'sandbox';
  const sandboxScenario = sandbox ? getSandboxMapScenario() : null;
  const riderLocation = order ? getRiderLocation(order, sim, sandbox) : null;
  const destination = sandboxScenario?.destination || null;
  const store = sandboxScenario?.store || null;
  const points = sandboxScenario?.route || [];
  const preferredTheme = 'light';
  const theme = 'light';
  const freshness = sandbox && riderLocation?.source === 'simulation'
    ? 'fresh'
    : trackingLocationFreshness(riderLocation);

  return {
    container,
    fallback,
    canvas,
    emptyMap,
    role,
    order,
    sim,
    riderLocation,
    destination,
    points,
    preferredTheme,
    theme,
    freshness,
    sandbox,
    store,
    sandboxScenario,
  };
}

export function ensureTrackingMap(container, view) {
  const sandboxGeometryVerified = Boolean(view.sandbox && view.sandboxScenario);
  const showSandboxRoute = sandboxGeometryVerified
    && view.riderLocation?.origin !== 'local_gps'
    && view.order?.status !== 'arriving';
  const existing = mapEntryFor(container);
  if (existing) {
    if (showSandboxRoute) container.dataset.routeSource = 'simulation';
    else delete container.dataset.routeSource;
    existing.adapter.setSandboxRouteVisible?.(showSandboxRoute);
    if (!showSandboxRoute && view.order?.status === 'arriving') {
      existing.adapter.recenter?.({ animate: false });
    }
    existing.adapter.updateFreshness(view.freshness);
    return existing;
  }

  const adapter = createMapLibreTrackingMap();
  const entry = {
    container,
    adapter,
    pendingFrame: null,
    pendingView: null,
    lastRenderedLocation: null,
    lastStatus: null,
    lastSource: null,
  };
  mountedMaps.add(entry);

  container.dataset.mapEngine = 'maplibre';
  if (showSandboxRoute) container.dataset.routeSource = 'simulation';
  else delete container.dataset.routeSource;

  // La vista productiva sólo monta el mapa con GPS real y no inventa origen,
  // destino ni ruta. La sandbox sí usa sus coordenadas ficticias aisladas.
  adapter.mount({
    container: view.canvas,
    shell: container,
    fallback: view.fallback,
    riderLocation: view.riderLocation,
    freshness: view.freshness,
    status: view.order?.status,
    source: view.riderLocation?.source,
    sandbox: view.sandbox,
    sandboxGeometryVerified,
    route: showSandboxRoute ? view.points : null,
    store: sandboxGeometryVerified ? view.store : null,
    destination: sandboxGeometryVerified ? view.destination : null,
    center: view.riderLocation || (sandboxGeometryVerified ? view.store : null),
    zoom: view.sandbox ? 14.5 : 16,
    cooperativeGestures: view.role === 'tracking',
  });
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
  entry.adapter.updateFreshness(view.freshness);
  if (!view.riderLocation) return;
  updateRiderMarkerPosition(entry, view.riderLocation, {
    status: view.order?.status,
    source: view.riderLocation.source,
    freshness: view.freshness,
  });
}

export function ensureRiderMarker(entry, view) {
  if (!entry?.adapter || !view?.riderLocation) return null;
  const marker = entry.adapter.updateRiderLocation(view.riderLocation, {
    freshness: view.freshness,
    status: view.order?.status,
    source: view.riderLocation.source,
    animate: false,
  });
  entry.lastRenderedLocation = { ...view.riderLocation, renderedAt: Date.now() };
  entry.lastStatus = view.order?.status || null;
  entry.lastSource = view.riderLocation.source;
  return marker;
}

export function updateRiderMarkerPosition(entry, location, options = {}) {
  if (!entry?.adapter || !location) return null;
  const now = Date.now();
  const statusChanged = entry.lastStatus !== (options.status || null) || entry.lastSource !== location.source;
  if (!statusChanged && !shouldRenderGpsFix(entry.lastRenderedLocation, location, { now })) {
    return null;
  }

  const next = entry.adapter.updateRiderLocation(location, options);
  entry.lastRenderedLocation = { ...location, renderedAt: now };
  entry.lastStatus = options.status || null;
  entry.lastSource = location.source;
  return next;
}

export function updateTrackingStatusText(container, view) {
  renderMapMeta(container, view.order, view.riderLocation, view.destination);
}

function requestFrame(callback) {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback);
  return setTimeout(callback, 0);
}

function cancelFrame(id) {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
  else clearTimeout(id);
}

function findOrder(orderId) {
  if (!orderId) return getActiveOrder();
  return getState().orders.find((order) => order.id === orderId) || getActiveOrder();
}

function getOrderSimulation(orderId) {
  const sim = getState().simulation;
  return sim && sim.orderId === orderId ? sim : null;
}

function getRiderLocation(order, sim, sandbox = false) {
  // Producción conserva el último fix GPS conocido, incluso demorado o perdido,
  // para no reemplazarlo por una posición inventada. Sandbox mantiene sus
  // coordenadas ficticias estrictamente aisladas.
  const chosen = chooseRiderLocation(sim, order?.tracking?.lastLocation);
  if (!sandbox) return hasKnownSharedGpsLocation(chosen) ? chosen : null;
  if (sim?.source === 'gps' && Number.isFinite(Number(sim.lat)) && Number.isFinite(Number(sim.lng))) {
    return {
      ...sim,
      source: 'gps',
      origin: 'local_gps',
      lastFixAt: sim.lastFixAt || sim.lastGpsFixAt || new Date().toISOString(),
    };
  }
  if (sim?.source === 'simulation' && (sim.userStarted || ['on_the_way', 'arriving'].includes(order?.status))) {
    const progress = order?.status === 'arriving' ? 1 : sim.progress;
    const point = sandboxMarkerPointAtProgress(progress);
    return {
      ...point,
      source: 'simulation',
      origin: 'sandbox_route',
      timestamp: Number(sim.timestamp) || Date.now(),
      lastFixAt: sim.lastFixAt || new Date(Number(sim.timestamp) || Date.now()).toISOString(),
    };
  }
  return null;
}

function renderMapMeta(container, order, location, destination) {
  const meta = container.querySelector('[data-map-meta]');
  if (!meta) return;
  const copy = meta.querySelector?.('[data-map-meta-text]') || meta;
  delete container.dataset.mapPresentation;
  if (!order || !location) {
    container.dataset.mapFreshness = 'none';
    copy.textContent = 'Ubicación temporalmente no disponible';
    return;
  }

  const age = relativeAgeLabel(location.lastFixAt || location.timestamp);
  const freshness = location.source === 'gps'
    ? trackingLocationFreshness(location)
    : 'fresh';
  container.dataset.mapFreshness = freshness;
  if (container.dataset.mapRole === 'tracking') {
    if (['arrived', 'arriving'].includes(order.status)) {
      container.dataset.mapPresentation = 'last-location';
      copy.textContent = `Última ubicación · ${age === 'ahora' ? 'hace 0 s' : age}`;
    } else if (location.origin === 'sandbox_route' || location.source === 'simulation') {
      copy.textContent = `Recorrido de muestra · ${age}`;
    } else if (freshness === 'lost') {
      copy.textContent = 'Ubicación temporalmente no disponible';
    } else if (freshness === 'delayed') {
      copy.textContent = `Última ubicación · ${age}`;
    } else {
      copy.textContent = `Ubicación en vivo · ${age}`;
    }
    return;
  }

  const source = location.source === 'gps'
    ? 'Ubicación real del repartidor'
    : (RIDER_LOCATION_SOURCES[location.source] || RIDER_LOCATION_SOURCES.simulation);
  const displaySource = location.origin === 'local_gps'
    ? 'GPS local activo'
    : location.origin === 'sandbox_route'
      ? 'Recorrido de muestra'
      : source;
  const gpsStale = location.source === 'gps' && ['delayed', 'lost'].includes(freshness);
  const prefix = gpsStale ? 'Última ubicación' : displaySource;
  const showAccuracy = container.dataset.mapRole?.startsWith('rider');
  const accuracy = showAccuracy && Number.isFinite(location.accuracy)
    ? ` · precisión ${Math.round(location.accuracy)} m`
    : '';
  // Sin coordenadas reales del cliente no calculamos distancia: no se inventan km.
  copy.textContent = gpsStale
    ? `${prefix} ${age}${accuracy}`
    : `${prefix} · última actualización: ${age}${accuracy}`;
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
