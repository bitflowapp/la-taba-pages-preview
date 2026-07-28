import {
  createOperationalPlaceMarkerElement,
  createOwnLocationMarkerElement,
  createPlaceMarkerElement,
  createRiderMarkerElement,
  updateOperationalPlaceMarkerElement,
  updateOwnLocationMarkerElement,
  updateRiderMarkerElement,
} from './rider_marker.js';

export const MAPLIBRE_PUBLIC_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
export const MAPLIBRE_FALLBACK_COPY = 'Mapa no disponible. Seguimos actualizando el estado de tu pedido.';
export const MAPLIBRE_SANDBOX_ROUTE_SOURCE_ID = 'taba-sandbox-route';
export const MAPLIBRE_SANDBOX_ROUTE_LAYER_ID = 'taba-sandbox-route-line';

const LOCATION_FRESHNESS = new Set(['fresh', 'delayed', 'lost', 'none']);
const DEFAULT_STYLE_TIMEOUT_MS = 10_000;
const DEFAULT_MARKER_ANIMATION_MS = 420;
const MAX_ANIMATED_DISTANCE_METERS = 1_000;

export function canUseMapLibre({
  root = globalThis,
  documentRef = root?.document,
  maplibregl = root?.maplibregl,
  failIfMajorPerformanceCaveat = false,
} = {}) {
  if (!maplibregl?.Map || !maplibregl?.Marker || !documentRef?.createElement) return false;
  const canvas = documentRef.createElement('canvas');
  if (!canvas?.getContext) return false;
  const contextOptions = { failIfMajorPerformanceCaveat };
  try {
    const context = canvas.getContext('webgl2', contextOptions)
      || canvas.getContext('webgl', contextOptions)
      || canvas.getContext('experimental-webgl', contextOptions);
    return Boolean(context && typeof context.getParameter === 'function');
  } catch (_) {
    return false;
  }
}

export function normalizeMapFreshness(value) {
  const normalized = String(value || '').toLowerCase();
  return LOCATION_FRESHNESS.has(normalized) ? normalized : 'none';
}

export function isValidMapPoint(point) {
  const lat = Number(point?.lat);
  const lng = Number(point?.lng);
  return Number.isFinite(lat)
    && Number.isFinite(lng)
    && lat >= -90
    && lat <= 90
    && lng >= -180
    && lng <= 180;
}

export function sandboxRouteFeature(points = []) {
  const coordinates = normalizeRouteCoordinates(points);
  if (coordinates.length < 2) return null;
  return {
    type: 'Feature',
    properties: { source: 'simulation' },
    geometry: {
      type: 'LineString',
      coordinates,
    },
  };
}

export function shouldAnimateRiderMove(previous, next, {
  freshness = 'none',
  reducedMotion = false,
  maxDistanceMeters = MAX_ANIMATED_DISTANCE_METERS,
} = {}) {
  if (normalizeMapFreshness(freshness) !== 'fresh' || reducedMotion) return false;
  if (!isValidMapPoint(previous) || !isValidMapPoint(next)) return false;
  const distance = distanceMeters(previous, next);
  return distance > 0 && distance <= maxDistanceMeters;
}

export function createMapLibreTrackingMap({
  root = globalThis,
  documentRef = root?.document,
  maplibregl = root?.maplibregl,
  styleUrl = MAPLIBRE_PUBLIC_STYLE_URL,
  styleTimeoutMs = DEFAULT_STYLE_TIMEOUT_MS,
  markerAnimationMs = DEFAULT_MARKER_ANIMATION_MS,
  requestFrame = defaultRequestFrame(root),
  cancelFrame = defaultCancelFrame(root),
  setTimer = defaultSetTimer(root),
  clearTimer = defaultClearTimer(root),
  ResizeObserverClass = root?.ResizeObserver,
  now = () => Date.now(),
  webglSupported = (options) => canUseMapLibre(options),
  onUnavailable = null,
} = {}) {
  const state = {
    shell: null,
    canvas: null,
    fallback: null,
    map: null,
    riderMarker: null,
    riderElement: null,
    riderLocation: null,
    storeMarker: null,
    storeElement: null,
    destinationMarker: null,
    destinationElement: null,
    routeFeature: null,
    places: null,
    pendingPlaces: null,
    role: 'tracking',
    sandbox: false,
    sandboxGeometryVerified: false,
    initialBoundsFitted: false,
    initialBoundsIncludedRider: false,
    freshness: 'none',
    ready: false,
    unavailable: false,
    destroyed: false,
    failureReason: null,
    userInteracted: false,
    resizeObserver: null,
    resizeFrame: null,
    movementFrame: null,
    styleTimer: null,
    tileErrorCount: 0,
    programmaticMove: false,
    mapListeners: [],
    domListeners: [],
  };

  function mount({
    container,
    shell = container?.closest?.('[data-real-map]') || container?.parentElement || null,
    fallback = shell?.querySelector?.('[data-map-fallback]') || null,
    riderLocation = null,
    freshness = 'none',
    status = 'received',
    source = riderLocation?.source || 'gps',
    sandbox = false,
    sandboxGeometryVerified = false,
    route = null,
    store = null,
    destination = null,
    priority = 'client',
    role = 'tracking',
    center = null,
    zoom = 16,
  } = {}) {
    if (state.destroyed || state.unavailable || !container) return false;
    if (state.map) {
      if (container !== state.canvas) return false;
      updateFreshness(freshness);
      if (isValidMapPoint(riderLocation)) {
        updateRiderLocation(riderLocation, { freshness, status, source });
      }
      updatePlaces({ store, destination, priority });
      return true;
    }

    state.shell = shell;
    state.canvas = container;
    state.fallback = fallback;
    state.role = String(role || 'tracking');
    state.sandbox = sandbox === true;
    state.sandboxGeometryVerified = state.sandbox && sandboxGeometryVerified === true;
    state.routeFeature = state.sandboxGeometryVerified ? sandboxRouteFeature(route) : null;
    state.freshness = normalizeMapFreshness(freshness);
    state.places = { store, destination, priority };
    state.pendingPlaces = state.role.startsWith('rider') || state.sandboxGeometryVerified
      ? state.places
      : null;

    const initialCenter = firstValidPoint(
      riderLocation,
      center,
      store,
      destination,
      firstRoutePoint(state.routeFeature),
    );
    if (!initialCenter) {
      return state.role.startsWith('rider')
        ? waitForInitialLocation()
        : markUnavailable('missing-location');
    }

    const maplibreRef = maplibregl || root?.maplibregl;
    const supported = webglSupported({
      root,
      documentRef,
      maplibregl: maplibreRef,
      failIfMajorPerformanceCaveat: false,
    });
    if (!supported) return markUnavailable('unsupported-webgl');

    state.failureReason = null;
    prepareMountDom();
    try {
      state.map = new maplibreRef.Map({
        container,
        style: styleUrl,
        center: toLngLat(initialCenter),
        zoom: finiteZoom(zoom),
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        maxPitch: 0,
        renderWorldCopies: false,
      });
      if (maplibreRef.AttributionControl && state.map.addControl) {
        state.map.addControl(
          new maplibreRef.AttributionControl({ compact: true }),
          'bottom-left',
        );
      }
    } catch (_) {
      state.map = null;
      return markUnavailable('constructor');
    }

    bindMapLifecycle();
    bindResizeLifecycle();
    if (!state.ready) {
      state.styleTimer = setTimer(() => {
        state.styleTimer = null;
        if (!state.ready && state.map) markUnavailable('initial-style-timeout');
      }, Math.max(1_000, Number(styleTimeoutMs) || DEFAULT_STYLE_TIMEOUT_MS));
    }

    updateFreshness(state.freshness);
    if (isValidMapPoint(riderLocation)) {
      updateRiderLocation(riderLocation, {
        freshness: state.freshness,
        status,
        source,
        animate: false,
      });
    }

    return true;
  }

  function updateRiderLocation(nextLocation, {
    freshness = state.freshness,
    status = 'received',
    source = nextLocation?.source || 'gps',
    animate = true,
  } = {}) {
    if (!state.map || state.unavailable || state.destroyed || !isValidMapPoint(nextLocation)) return null;
    const normalizedFreshness = normalizeMapFreshness(freshness);
    state.freshness = normalizedFreshness;
    const previous = state.riderLocation;
    state.riderLocation = normalizedPoint(nextLocation);

    if (!state.riderMarker) {
      state.riderElement = state.role.startsWith('rider')
        ? createOwnLocationMarkerElement(documentRef, {
          source,
          heading: state.riderLocation.heading,
        })
        : createRiderMarkerElement(documentRef, { status, source });
      if (!state.riderElement) return null;
      state.riderMarker = new (maplibregl || root?.maplibregl).Marker({
        element: state.riderElement,
        anchor: 'center',
      })
        .setLngLat(toLngLat(state.riderLocation))
        .addTo(state.map);
      maybeFitInitialGeometry();
      return state.riderMarker;
    }

    if (state.role.startsWith('rider')) {
      updateOwnLocationMarkerElement(state.riderElement, {
        source,
        heading: state.riderLocation.heading,
      });
    } else {
      updateRiderMarkerElement(state.riderElement, { status, source });
    }
    cancelMovement();
    const reducedMotion = prefersReducedMotion(root);
    const smooth = animate && shouldAnimateRiderMove(previous, state.riderLocation, {
      freshness: normalizedFreshness,
      reducedMotion,
    });
    if (!smooth) {
      state.riderMarker.setLngLat(toLngLat(state.riderLocation));
      maybeFollowRider(state.riderLocation, { reducedMotion });
      maybeFitInitialGeometry();
      return state.riderMarker;
    }

    const startedAt = now();
    const duration = Math.max(120, Number(markerAnimationMs) || DEFAULT_MARKER_ANIMATION_MS);
    const start = normalizedPoint(previous);
    const end = state.riderLocation;
    const step = () => {
      state.movementFrame = null;
      if (!state.riderMarker || state.destroyed || state.unavailable) return;
      const elapsed = Math.max(0, now() - startedAt);
      const progress = Math.min(1, elapsed / duration);
      const eased = 1 - ((1 - progress) ** 3);
      state.riderMarker.setLngLat([
        start.lng + ((end.lng - start.lng) * eased),
        start.lat + ((end.lat - start.lat) * eased),
      ]);
      if (progress < 1) {
        state.movementFrame = requestFrame(step);
      } else {
        maybeFollowRider(end, { reducedMotion: false });
        maybeFitInitialGeometry();
      }
    };
    state.movementFrame = requestFrame(step);
    return state.riderMarker;
  }

  function updateFreshness(value, { label = '' } = {}) {
    const freshness = normalizeMapFreshness(value);
    state.freshness = freshness;
    if (freshness !== 'fresh') {
      cancelMovement();
      if (state.riderMarker && isValidMapPoint(state.riderLocation)) {
        state.riderMarker.setLngLat(toLngLat(state.riderLocation));
      }
    }
    if (state.shell) {
      if (state.shell.dataset) state.shell.dataset.mapFreshness = freshness;
      for (const candidate of LOCATION_FRESHNESS) {
        state.shell.classList?.toggle?.(`is-location-${candidate}`, candidate === freshness);
      }
      if (label) {
        const copy = state.shell.querySelector?.('[data-map-meta-text]');
        if (copy) copy.textContent = String(label);
      }
    }
    return freshness;
  }

  function updatePlaces({
    store = state.places?.store || null,
    destination = state.places?.destination || null,
    priority = state.places?.priority || 'client',
  } = {}) {
    state.places = { store, destination, priority };
    if (
      !state.map
      || state.unavailable
      || state.destroyed
      || (!state.role.startsWith('rider') && !state.sandboxGeometryVerified)
    ) {
      state.pendingPlaces = state.places;
      return false;
    }
    syncPlaceMarkers(state.places);
    maybeFitInitialGeometry();
    return true;
  }

  function recenter({ animate = true } = {}) {
    if (!state.map || !isValidMapPoint(state.riderLocation) || state.unavailable || state.destroyed) return false;
    state.userInteracted = false;
    const center = toLngLat(state.riderLocation);
    const camera = state.role.startsWith('rider') ? { center, zoom: 16 } : { center };
    if (animate && !prefersReducedMotion(root) && state.map.easeTo) {
      state.map.easeTo({ ...camera, duration: 360, essential: false });
    } else if (state.map.jumpTo) {
      state.map.jumpTo(camera);
    } else {
      state.map.setCenter?.(center);
    }
    return true;
  }

  function resize() {
    if (!state.map || state.resizeFrame !== null || state.unavailable || state.destroyed) return false;
    state.resizeFrame = requestFrame(() => {
      state.resizeFrame = null;
      if (!state.map || state.unavailable || state.destroyed) return;
      try {
        state.map.resize?.();
      } catch (_) {
        markUnavailable('resize');
      }
    });
    return true;
  }

  function destroy() {
    if (state.destroyed) return;
    state.destroyed = true;
    cleanupResources();
    if (state.shell) {
      state.shell.classList?.remove?.('is-ready', 'map-unavailable');
      if (state.shell.dataset) {
        delete state.shell.dataset.mapStatus;
        delete state.shell.dataset.mapFreshness;
        delete state.shell.dataset.mapFailure;
        delete state.shell.dataset.mapEngine;
      }
    }
    state.shell = null;
    state.canvas = null;
    state.fallback = null;
  }

  function bindMapLifecycle() {
    addMapListener('load', () => {
      if (!state.map || state.unavailable || state.destroyed) return;
      state.ready = true;
      if (state.styleTimer !== null) {
        clearTimer(state.styleTimer);
        state.styleTimer = null;
      }
      ensureSandboxRoute();
      syncPlaceMarkers(state.pendingPlaces);
      state.pendingPlaces = null;
      maybeFitInitialGeometry();
      state.shell?.classList?.add?.('is-ready');
      state.shell?.classList?.remove?.('map-unavailable');
      if (state.shell?.dataset) state.shell.dataset.mapStatus = 'ready';
      state.fallback?.setAttribute?.('hidden', '');
      state.canvas?.removeAttribute?.('hidden');
      resize();
      collapseCompactAttribution();
    });
    addMapListener('error', (event) => {
      if (!state.ready && isCriticalMapLibreError(event, { ready: false })) {
        markUnavailable('initial-style');
      } else if (state.ready && isCriticalMapLibreError(event, { ready: true })) {
        markUnavailable('runtime-style');
      } else if (state.ready && isTileLoadError(event)) {
        state.tileErrorCount += 1;
        if (state.tileErrorCount >= 3) markUnavailable('tiles');
      }
    });
    addMapListener('idle', () => {
      state.tileErrorCount = 0;
    });
    addMapListener('webglcontextlost', () => markUnavailable('webgl-context-lost'));
    for (const eventName of ['dragstart', 'zoomstart', 'rotatestart']) {
      addMapListener(eventName, () => {
        if (!state.programmaticMove) state.userInteracted = true;
      });
    }
    state.map.dragRotate?.disable?.();
    state.map.touchPitch?.disable?.();

    const canvas = state.map.getCanvas?.();
    if (canvas?.addEventListener) {
      const onContextLost = (event) => {
        event?.preventDefault?.();
        markUnavailable('webgl-context-lost');
      };
      addDomListener(canvas, 'webglcontextlost', onContextLost);
    }
  }

  function bindResizeLifecycle() {
    if (typeof ResizeObserverClass === 'function') {
      state.resizeObserver = new ResizeObserverClass(() => resize());
      state.resizeObserver.observe?.(state.canvas);
    }
    if (documentRef?.addEventListener) {
      addDomListener(documentRef, 'visibilitychange', () => {
        if (!documentRef.hidden) resize();
      });
    }
    if (root?.addEventListener) {
      addDomListener(root, 'pageshow', resize);
      addDomListener(root, 'orientationchange', resize);
    }
  }

  function collapseCompactAttribution() {
    const attribution = state.canvas?.querySelector?.(
      '.maplibregl-ctrl-attrib.maplibregl-compact',
    );
    attribution?.classList?.remove?.('maplibregl-compact-show');
  }

  function ensureSandboxRoute() {
    if (!state.sandbox || !state.sandboxGeometryVerified || !state.routeFeature || !state.map) return;
    const existing = state.map.getSource?.(MAPLIBRE_SANDBOX_ROUTE_SOURCE_ID);
    if (existing?.setData) {
      existing.setData(state.routeFeature);
    } else {
      state.map.addSource?.(MAPLIBRE_SANDBOX_ROUTE_SOURCE_ID, {
        type: 'geojson',
        data: state.routeFeature,
      });
    }
    if (!state.map.getLayer?.(MAPLIBRE_SANDBOX_ROUTE_LAYER_ID)) {
      state.map.addLayer?.({
        id: MAPLIBRE_SANDBOX_ROUTE_LAYER_ID,
        type: 'line',
        source: MAPLIBRE_SANDBOX_ROUTE_SOURCE_ID,
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': '#c8101e',
          'line-width': 4,
          'line-opacity': 0.9,
        },
      });
    }
  }

  function syncPlaceMarkers(places) {
    if (!state.map || !places) return;
    const businessPriority = places.priority === 'business';
    const clientPriority = !businessPriority;
    if (isValidMapPoint(places.store)) {
      if (!state.storeMarker) {
        const created = createPlaceMarker({
          point: places.store,
          kind: state.role.startsWith('rider') ? 'business' : 'store',
          label: places.store.label || 'Negocio',
          priority: businessPriority,
        });
        state.storeMarker = created?.marker || null;
        state.storeElement = created?.element || null;
      } else {
        state.storeMarker.setLngLat(toLngLat(places.store));
        if (state.role.startsWith('rider')) {
          updateOperationalPlaceMarkerElement(state.storeElement, {
            kind: 'business',
            label: places.store.label || 'Negocio',
            priority: businessPriority,
          });
        }
      }
    } else if (state.storeMarker) {
      state.storeMarker.remove?.();
      state.storeMarker = null;
      state.storeElement = null;
    }

    if (isValidMapPoint(places.destination)) {
      if (!state.destinationMarker) {
        const created = createPlaceMarker({
          point: places.destination,
          kind: state.role.startsWith('rider') ? 'client' : 'destination',
          label: places.destination.label || 'Cliente',
          priority: clientPriority,
        });
        state.destinationMarker = created?.marker || null;
        state.destinationElement = created?.element || null;
      } else {
        state.destinationMarker.setLngLat(toLngLat(places.destination));
        if (state.role.startsWith('rider')) {
          updateOperationalPlaceMarkerElement(state.destinationElement, {
            kind: 'client',
            label: places.destination.label || 'Cliente',
            priority: clientPriority,
          });
        }
      }
    } else if (state.destinationMarker) {
      state.destinationMarker.remove?.();
      state.destinationMarker = null;
      state.destinationElement = null;
    }
  }

  function maybeFitInitialGeometry() {
    const hasRiderLocation = isValidMapPoint(state.riderLocation);
    const canIncludeFirstRider = state.role.startsWith('rider')
      && state.initialBoundsFitted
      && !state.initialBoundsIncludedRider
      && hasRiderLocation;
    if (
      (state.initialBoundsFitted && !canIncludeFirstRider)
      || !state.ready
      || !state.map?.fitBounds
      || state.userInteracted
    ) {
      return false;
    }
    const routeCoordinates = state.routeFeature?.geometry?.coordinates;
    const coordinates = Array.isArray(routeCoordinates) && routeCoordinates.length >= 2
      ? routeCoordinates
      : [
        state.riderLocation,
        state.places?.destination,
        state.places?.store,
      ].filter(isValidMapPoint).map(toLngLat);
    if (coordinates.length < 2) return false;
    const lngs = coordinates.map((coordinate) => Number(coordinate[0])).filter(Number.isFinite);
    const lats = coordinates.map((coordinate) => Number(coordinate[1])).filter(Number.isFinite);
    if (lngs.length < 2 || lats.length < 2) return false;
    state.initialBoundsFitted = true;
    state.initialBoundsIncludedRider = hasRiderLocation;
    state.programmaticMove = true;
    try {
      state.map.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        {
          padding: state.role.startsWith('rider')
            ? { top: 70, left: 45, right: 45, bottom: 220 }
            : 34,
          maxZoom: 15.5,
          duration: 0,
        },
      );
    } finally {
      setTimer(() => {
        state.programmaticMove = false;
      }, 0);
    }
    return true;
  }

  function createPlaceMarker({ point, kind, label, priority = false }) {
    const operational = state.role.startsWith('rider');
    const element = operational
      ? createOperationalPlaceMarkerElement(documentRef, { kind, label, priority })
      : createPlaceMarkerElement(documentRef, { kind, label });
    if (!element) return null;
    const marker = new (maplibregl || root?.maplibregl).Marker({
      element,
      anchor: 'bottom',
    })
      .setLngLat(toLngLat(point))
      .addTo(state.map);
    return { marker, element };
  }

  function maybeFollowRider(point, { reducedMotion = false } = {}) {
    if (!state.map || state.userInteracted || state.freshness !== 'fresh') return;
    const lngLat = toLngLat(point);
    const bounds = state.map.getBounds?.();
    if (!bounds || bounds.contains?.(lngLat) !== false) return;
    if (!reducedMotion && state.map.easeTo) {
      state.map.easeTo({ center: lngLat, duration: 320, essential: false });
    } else if (state.map.jumpTo) {
      state.map.jumpTo({ center: lngLat });
    }
  }

  function markUnavailable(reason) {
    if (state.destroyed) return false;
    state.failureReason = String(reason || 'unknown');
    state.unavailable = true;
    state.ready = false;
    cleanupResources();
    if (state.shell) {
      state.shell.classList?.remove?.('is-ready');
      state.shell.classList?.add?.('map-unavailable');
      if (state.shell.dataset) {
        state.shell.dataset.mapStatus = 'unavailable';
        state.shell.dataset.mapFailure = state.failureReason;
      }
    }
    presentFallback(state.fallback);
    state.canvas?.setAttribute?.('hidden', '');
    if (typeof onUnavailable === 'function') onUnavailable(state.failureReason);
    return false;
  }

  function waitForInitialLocation() {
    state.failureReason = 'missing-location';
    state.ready = false;
    if (state.shell) {
      state.shell.classList?.remove?.('is-ready', 'map-unavailable');
      if (state.shell.dataset) {
        state.shell.dataset.mapStatus = 'waiting-location';
        state.shell.dataset.mapFailure = state.failureReason;
      }
    }
    presentFallback(state.fallback);
    state.canvas?.setAttribute?.('hidden', '');
    return false;
  }

  function cleanupResources() {
    cancelMovement();
    if (state.resizeFrame !== null) {
      cancelFrame(state.resizeFrame);
      state.resizeFrame = null;
    }
    if (state.styleTimer !== null) {
      clearTimer(state.styleTimer);
      state.styleTimer = null;
    }
    state.resizeObserver?.disconnect?.();
    state.resizeObserver = null;
    for (const { target, type, listener, options } of state.domListeners.splice(0)) {
      target.removeEventListener?.(type, listener, options);
    }
    if (state.map) {
      for (const { type, listener } of state.mapListeners.splice(0)) {
        state.map.off?.(type, listener);
      }
    } else {
      state.mapListeners = [];
    }
    state.riderMarker?.remove?.();
    state.storeMarker?.remove?.();
    state.destinationMarker?.remove?.();
    state.riderMarker = null;
    state.riderElement = null;
    state.storeMarker = null;
    state.storeElement = null;
    state.destinationMarker = null;
    state.destinationElement = null;
    if (state.map) {
      try {
        state.map.remove?.();
      } catch (_) {
        // The WebGL context may already be gone.
      }
    }
    state.map = null;
  }

  function cancelMovement() {
    if (state.movementFrame === null) return;
    cancelFrame(state.movementFrame);
    state.movementFrame = null;
  }

  function addMapListener(type, listener) {
    state.map?.on?.(type, listener);
    state.mapListeners.push({ type, listener });
  }

  function addDomListener(target, type, listener, options) {
    target.addEventListener?.(type, listener, options);
    state.domListeners.push({ target, type, listener, options });
  }

  function prepareMountDom() {
    state.shell?.classList?.remove?.('map-unavailable', 'is-ready');
    if (state.shell?.dataset) {
      state.shell.dataset.mapEngine = 'maplibre';
      state.shell.dataset.mapStatus = 'loading';
      delete state.shell.dataset.mapFailure;
    }
    state.canvas?.removeAttribute?.('hidden');
  }

  function getLifecycleState() {
    return Object.freeze({
      mounted: Boolean(state.map),
      ready: state.ready,
      unavailable: state.unavailable,
      destroyed: state.destroyed,
      failureReason: state.failureReason,
      freshness: state.freshness,
      hasRiderMarker: Boolean(state.riderMarker),
      hasStoreMarker: Boolean(state.storeMarker),
      hasDestinationMarker: Boolean(state.destinationMarker),
      hasSandboxRoute: Boolean(state.routeFeature),
      initialBoundsFitted: state.initialBoundsFitted,
      userInteracted: state.userInteracted,
    });
  }

  return Object.freeze({
    mount,
    updateRiderLocation,
    updateFreshness,
    updatePlaces,
    recenter,
    resize,
    destroy,
    getLifecycleState,
  });
}

export function isCriticalMapLibreError(event, { ready = false } = {}) {
  if (!ready) return true;
  const message = String(event?.error?.message || event?.message || '');
  return /webgl|context\s+lost|style.+(?:invalid|parse|load)|failed\s+to\s+load\s+style/i.test(message);
}

export function isTileLoadError(event) {
  const message = String(event?.error?.message || event?.message || '');
  return /(?:failed|error|unable).*(?:tile|source)|(?:tile|source).*(?:failed|error|unavailable)/i.test(message);
}

function presentFallback(fallback) {
  if (!fallback) return;
  const copy = fallback.querySelector?.('[data-map-fallback-message], .map-fallback-note, p') || fallback;
  copy.textContent = MAPLIBRE_FALLBACK_COPY;
  fallback.removeAttribute?.('hidden');
}

function normalizeRouteCoordinates(points) {
  if (points?.type === 'Feature' && points.geometry?.type === 'LineString') {
    return (points.geometry.coordinates || [])
      .map((coordinate) => normalizeGeoJsonCoordinate(coordinate))
      .filter(Boolean);
  }
  if (points?.type === 'LineString') {
    return (points.coordinates || [])
      .map((coordinate) => normalizeGeoJsonCoordinate(coordinate))
      .filter(Boolean);
  }
  if (!Array.isArray(points)) return [];
  return points
    .map((point) => {
      if (isValidMapPoint(point)) return toLngLat(point);
      if (!Array.isArray(point) || point.length < 2) return null;
      const candidate = { lat: Number(point[0]), lng: Number(point[1]) };
      return isValidMapPoint(candidate) ? toLngLat(candidate) : null;
    })
    .filter(Boolean);
}

function normalizeGeoJsonCoordinate(coordinate) {
  if (!Array.isArray(coordinate) || coordinate.length < 2) return null;
  const candidate = { lng: Number(coordinate[0]), lat: Number(coordinate[1]) };
  return isValidMapPoint(candidate) ? [candidate.lng, candidate.lat] : null;
}

function firstRoutePoint(feature) {
  const coordinate = feature?.geometry?.coordinates?.[0];
  return coordinate ? { lng: coordinate[0], lat: coordinate[1] } : null;
}

function firstValidPoint(...points) {
  return points.find((point) => isValidMapPoint(point)) || null;
}

function normalizedPoint(point) {
  return {
    ...point,
    lat: Number(point.lat),
    lng: Number(point.lng),
  };
}

function toLngLat(point) {
  return [Number(point.lng), Number(point.lat)];
}

function finiteZoom(value) {
  const zoom = Number(value);
  return Number.isFinite(zoom) ? Math.min(20, Math.max(0, zoom)) : 16;
}

function prefersReducedMotion(root) {
  try {
    return Boolean(root?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  } catch (_) {
    return false;
  }
}

function distanceMeters(from, to) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const lat1 = radians(Number(from.lat));
  const lat2 = radians(Number(to.lat));
  const deltaLat = lat2 - lat1;
  const deltaLng = radians(Number(to.lng) - Number(from.lng));
  const a = (Math.sin(deltaLat / 2) ** 2)
    + (Math.cos(lat1) * Math.cos(lat2) * (Math.sin(deltaLng / 2) ** 2));
  const clamped = Math.min(1, Math.max(0, a));
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(clamped), Math.sqrt(1 - clamped));
}

function defaultRequestFrame(root) {
  return typeof root?.requestAnimationFrame === 'function'
    ? root.requestAnimationFrame.bind(root)
    : (callback) => setTimeout(() => callback(Date.now()), 16);
}

function defaultCancelFrame(root) {
  return typeof root?.cancelAnimationFrame === 'function'
    ? root.cancelAnimationFrame.bind(root)
    : clearTimeout;
}

function defaultSetTimer(root) {
  return typeof root?.setTimeout === 'function'
    ? root.setTimeout.bind(root)
    : setTimeout;
}

function defaultClearTimer(root) {
  return typeof root?.clearTimeout === 'function'
    ? root.clearTimeout.bind(root)
    : clearTimeout;
}
