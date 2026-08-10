import {
  createPlaceMarkerElement,
  createRiderMarkerElement,
  updateRiderMarkerElement,
} from './rider_marker.js';
import { applyTabaMapTheme } from './taba_map_theme.js';
import { createRiderMotion } from './rider_motion.js';

export const MAPLIBRE_PUBLIC_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
export const MAPLIBRE_ACCURACY_SOURCE_ID = 'taba-rider-accuracy';
export const MAPLIBRE_ACCURACY_FILL_LAYER_ID = 'taba-rider-accuracy-fill';
export const MAPLIBRE_ACCURACY_LINE_LAYER_ID = 'taba-rider-accuracy-line';

/** Zoom al que se vuelve cuando el cliente toca «Volver al Rider». */
export const MAPLIBRE_FOLLOW_ZOOM = 16.5;
/** Debajo de esta precisión el halo queda tapado por el marcador, y está bien. */
export const ACCURACY_CIRCLE_SIDES = 64;
export const MAPLIBRE_FALLBACK_COPY = 'Mapa no disponible. Seguimos actualizando el estado de tu pedido.';
export const MAPLIBRE_SANDBOX_ROUTE_SOURCE_ID = 'taba-sandbox-route';
export const MAPLIBRE_SANDBOX_ROUTE_LAYER_ID = 'taba-sandbox-route-line';
export const MAPLIBRE_SANDBOX_ROUTE_CASING_LAYER_ID = 'taba-sandbox-route-casing';

/*
 * La ruta sobre el lienzo nocturno se dibuja en dos capas del mismo source:
 * un casing casi negro que la despega de la trama de calles y la línea roja
 * TABA encima. El rojo es un paso más luminoso que el de la marca (#d0000d):
 * sobre grafito, el institucional se apaga; éste conserva la identidad y
 * gana la jerarquía que una ruta activa necesita.
 */
export const SANDBOX_ROUTE_CASING_PAINT = Object.freeze({
  'line-color': '#0a0b0d',
  'line-opacity': 0.85,
  'line-width': ['interpolate', ['linear'], ['zoom'], 12, 6.5, 16, 10],
});
export const SANDBOX_ROUTE_LINE_PAINT = Object.freeze({
  'line-color': '#e8273a',
  'line-opacity': 0.95,
  'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3.5, 16, 5.5],
});

const LOCATION_FRESHNESS = new Set(['fresh', 'delayed', 'lost', 'none']);
const DEFAULT_STYLE_TIMEOUT_MS = 10_000;

/**
 * Polígono geodésico que representa el círculo de precisión. Se calcula en
 * coordenadas reales —no en píxeles— para que el halo signifique siempre los
 * mismos metros, se acerque o se aleje el cliente.
 */
export function accuracyCircleFeature(point, accuracyMeters, {
  sides = ACCURACY_CIRCLE_SIDES,
} = {}) {
  const radius = Number(accuracyMeters);
  if (!isValidMapPoint(point) || !Number.isFinite(radius) || radius <= 0) return null;
  const lat = Number(point.lat);
  const lng = Number(point.lng);
  const latDelta = radius / 111_320;
  const cos = Math.cos((lat * Math.PI) / 180);
  const lngDelta = Math.abs(cos) < 1e-6 ? latDelta : radius / (111_320 * cos);
  const ring = [];
  for (let i = 0; i <= sides; i += 1) {
    const angle = (2 * Math.PI * i) / sides;
    ring.push([lng + (lngDelta * Math.cos(angle)), lat + (latDelta * Math.sin(angle))]);
  }
  return {
    type: 'Feature',
    properties: { accuracy: radius },
    geometry: { type: 'Polygon', coordinates: [ring] },
  };
}

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

export function createMapLibreTrackingMap({
  root = globalThis,
  documentRef = root?.document,
  maplibregl = root?.maplibregl,
  styleUrl = MAPLIBRE_PUBLIC_STYLE_URL,
  styleTimeoutMs = DEFAULT_STYLE_TIMEOUT_MS,
  requestFrame = defaultRequestFrame(root),
  cancelFrame = defaultCancelFrame(root),
  setTimer = defaultSetTimer(root),
  clearTimer = defaultClearTimer(root),
  ResizeObserverClass = root?.ResizeObserver,
  now = () => Date.now(),
  webglSupported = (options) => canUseMapLibre(options),
  onUnavailable = null,
  onCameraModeChange = null,
} = {}) {
  const state = {
    shell: null,
    canvas: null,
    fallback: null,
    map: null,
    riderMarker: null,
    riderElement: null,
    riderLocation: null,
    // El movimiento visual vive acá; la coordenada medida sigue en
    // `riderLocation` y es la única que se reporta hacia afuera.
    motion: null,
    motionFrame: null,
    cameraMode: 'follow',
    accuracyMeters: null,
    followZoom: MAPLIBRE_FOLLOW_ZOOM,
    storeMarker: null,
    destinationMarker: null,
    routeFeature: null,
    routeVisible: false,
    pendingSandboxPlaces: null,
    sandbox: false,
    sandboxGeometryVerified: false,
    freshness: 'none',
    ready: false,
    unavailable: false,
    destroyed: false,
    failureReason: null,
    userInteracted: false,
    resizeObserver: null,
    resizeFrame: null,
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
    center = null,
    zoom = 16,
    cooperativeGestures = false,
  } = {}) {
    if (state.destroyed || state.unavailable || !container) return false;
    if (state.map) {
      if (container !== state.canvas) return false;
      updateFreshness(freshness);
      if (isValidMapPoint(riderLocation)) {
        updateRiderLocation(riderLocation, { freshness, status, source });
      }
      return true;
    }

    state.shell = shell;
    state.canvas = container;
    state.fallback = fallback;
    state.sandbox = sandbox === true;
    state.sandboxGeometryVerified = state.sandbox && sandboxGeometryVerified === true;
    state.routeFeature = state.sandboxGeometryVerified ? sandboxRouteFeature(route) : null;
    state.routeVisible = Boolean(state.routeFeature);
    state.freshness = normalizeMapFreshness(freshness);
    // El destino ya no es exclusivo de la sandbox: un pedido real trae el punto
    // que confirmó el cliente, y dibujarlo es justamente lo que faltaba para
    // que el seguimiento mostrara a dónde va la entrega. El comercio, en
    // cambio, sigue siendo geometría de la sandbox.
    state.pendingSandboxPlaces = {
      store: state.sandboxGeometryVerified ? store : null,
      destination,
    };

    const initialCenter = firstValidPoint(
      riderLocation,
      center,
      state.sandboxGeometryVerified ? store : null,
      destination,
      firstRoutePoint(state.routeFeature),
    );
    if (!initialCenter) return markUnavailable('missing-location');

    const maplibreRef = maplibregl || root?.maplibregl;
    const supported = webglSupported({
      root,
      documentRef,
      maplibregl: maplibreRef,
      failIfMajorPerformanceCaveat: false,
    });
    if (!supported) return markUnavailable('unsupported-webgl');

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
        cooperativeGestures: cooperativeGestures === true,
      });
      if (maplibreRef.AttributionControl && state.map.addControl) {
        state.map.addControl(
          new maplibreRef.AttributionControl({ compact: true }),
          'bottom-left',
        );
      }
      // Zoom de escritorio. En táctil chico lo esconde el CSS: ahí mandan los
      // gestos y los botones sólo taparían mapa. Guardado por feature-detect
      // para que un runtime sin NavigationControl siga montando igual.
      if (maplibreRef.NavigationControl && state.map.addControl) {
        state.map.addControl(
          new maplibreRef.NavigationControl({ showCompass: false, showZoom: true }),
          'top-right',
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

  function ensureMotion() {
    if (!state.motion) {
      state.motion = createRiderMotion({
        now,
        reducedMotion: prefersReducedMotion(root),
      });
    }
    return state.motion;
  }

  /*
   * Entra una coordenada MEDIDA. Se guarda tal cual en `riderLocation` —esa es
   * la verdad y es la que se reporta— y se le entrega al motor de movimiento,
   * que decide dónde dibujar el marcador en cada frame mientras recorre el
   * tramo. El dato persistido no se toca nunca acá.
   */
  function updateRiderLocation(nextLocation, {
    freshness = state.freshness,
    status = 'received',
    source = nextLocation?.source || 'gps',
    animate = true,
  } = {}) {
    if (!state.map || state.unavailable || state.destroyed || !isValidMapPoint(nextLocation)) return null;
    const normalizedFreshness = normalizeMapFreshness(freshness);
    state.freshness = normalizedFreshness;
    state.riderLocation = normalizedPoint(nextLocation);
    const accuracy = Number(nextLocation?.accuracy);
    state.accuracyMeters = Number.isFinite(accuracy) && accuracy > 0 ? accuracy : null;

    const motion = ensureMotion();
    motion.pushFix(state.riderLocation, { instant: animate === false });

    if (!state.riderMarker) {
      state.riderElement = createRiderMarkerElement(documentRef, { status, source });
      if (!state.riderElement) return null;
      state.riderMarker = new (maplibregl || root?.maplibregl).Marker({
        element: state.riderElement,
        anchor: 'center',
      })
        .setLngLat(toLngLat(motion.visualPositionAt() || state.riderLocation))
        .addTo(state.map);
      renderAccuracyHalo();
      followCamera({ immediate: true });
      return state.riderMarker;
    }

    updateRiderMarkerElement(state.riderElement, { status, source });
    paintMotionFrame();
    startMotionLoop();
    return state.riderMarker;
  }

  /* Un frame del movimiento visual: marcador, halo y cámara van juntos. */
  function paintMotionFrame() {
    const visual = state.motion?.visualPositionAt();
    if (!visual || !state.riderMarker) return;
    state.riderMarker.setLngLat(toLngLat(visual));
    renderAccuracyHalo(visual);
    followCamera();
  }

  function startMotionLoop() {
    if (state.motionFrame !== null || !state.motion?.isMoving()) return;
    const step = () => {
      state.motionFrame = null;
      if (state.destroyed || state.unavailable || !state.riderMarker) return;
      paintMotionFrame();
      if (state.motion?.isMoving()) state.motionFrame = requestFrame(step);
    };
    state.motionFrame = requestFrame(step);
  }

  /*
   * En SEGUIR, la cámara va pegada a la posición visual del marcador: como esa
   * posición ya viene interpolada, el encuadre se desliza en lugar de dar
   * saltos. `setCenter` no dispara los eventos de gesto, así que seguir al
   * rider nunca se confunde con que el cliente tocó el mapa.
   */
  function followCamera({ immediate = false } = {}) {
    if (state.cameraMode !== 'follow' || !state.map) return;
    const visual = state.motion?.visualPositionAt() || state.riderLocation;
    if (!isValidMapPoint(visual)) return;
    state.programmaticMove = true;
    try {
      state.map.setCenter?.(toLngLat(visual));
    } finally {
      state.programmaticMove = false;
    }
    if (immediate) return;
  }

  /*
   * `force` reafirma el estado visible aunque internamente ya estuviéramos en
   * ese modo. Volver al rider lo usa: si por lo que fuera la pantalla quedó
   * mostrando la vuelta mientras el seguimiento seguía activo, tocarla tiene
   * que arreglar la pantalla igual, y no dejar el botón pegado.
   */
  function setCameraMode(mode, { force = false } = {}) {
    const next = mode === 'explore' ? 'explore' : 'follow';
    const changed = state.cameraMode !== next;
    if (!changed && !force) return next;
    state.cameraMode = next;
    if (state.shell?.dataset) state.shell.dataset.mapCamera = next;
    state.shell?.classList?.toggle?.('is-exploring', next === 'explore');
    if (typeof onCameraModeChange === 'function') onCameraModeChange(next);
    return next;
  }

  function renderAccuracyHalo(point = null) {
    if (!state.map || !state.ready) return;
    const center = point || state.motion?.visualPositionAt() || state.riderLocation;
    const feature = accuracyCircleFeature(center, state.accuracyMeters);
    const source = state.map.getSource?.(MAPLIBRE_ACCURACY_SOURCE_ID);
    const data = feature || { type: 'FeatureCollection', features: [] };
    if (source?.setData) {
      source.setData(data);
      return;
    }
    if (!feature) return;
    state.map.addSource?.(MAPLIBRE_ACCURACY_SOURCE_ID, { type: 'geojson', data });
    if (!state.map.getLayer?.(MAPLIBRE_ACCURACY_FILL_LAYER_ID)) {
      state.map.addLayer?.({
        id: MAPLIBRE_ACCURACY_FILL_LAYER_ID,
        type: 'fill',
        source: MAPLIBRE_ACCURACY_SOURCE_ID,
        paint: { 'fill-color': '#e8273a', 'fill-opacity': 0.1 },
      });
    }
    if (!state.map.getLayer?.(MAPLIBRE_ACCURACY_LINE_LAYER_ID)) {
      state.map.addLayer?.({
        id: MAPLIBRE_ACCURACY_LINE_LAYER_ID,
        type: 'line',
        source: MAPLIBRE_ACCURACY_SOURCE_ID,
        paint: { 'line-color': '#e8273a', 'line-opacity': 0.32, 'line-width': 1.1 },
      });
    }
  }

  /*
   * Perder frescura NO es perder al rider. Antes, cualquier lectura que llegara
   * con el fix por encima de los 15 s cortaba el movimiento a mitad de camino y
   * plantaba el marcador de golpe sobre la coordenada medida: un tirón cada vez
   * que la señal se demoraba un poco. Ahora el tramo en curso termina —viene de
   * dos puntos reales y sigue siendo cierto—, y el marcador se queda quieto
   * sobre la última coordenada conocida hasta que llegue una nueva.
   */
  function updateFreshness(value, { label = '' } = {}) {
    const freshness = normalizeMapFreshness(value);
    state.freshness = freshness;
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

  /*
   * «Volver al Rider»: la cámara vuelve sola, con un zoom en el que se entiende
   * la cuadra, y el seguimiento queda activo otra vez. Se centra en la posición
   * VISUAL —donde el cliente ve el marcador ahora mismo— para que el viaje de
   * vuelta termine justo encima de él y no a un tramo de distancia.
   */
  function recenter({ animate = true, zoom = state.followZoom } = {}) {
    if (!state.map || state.unavailable || state.destroyed) return false;
    const target = state.motion?.visualPositionAt() || state.riderLocation;
    if (!isValidMapPoint(target)) return false;
    const center = toLngLat(target);
    const nextZoom = finiteZoom(zoom);
    if (animate && !prefersReducedMotion(root) && state.map.easeTo) {
      state.map.easeTo({ center, zoom: nextZoom, duration: 520, essential: true });
    } else if (state.map.jumpTo) {
      state.map.jumpTo({ center, zoom: nextZoom });
    } else {
      state.map.setCenter?.(center);
      state.map.setZoom?.(nextZoom);
    }
    // El vuelo emite los mismos eventos que un gesto, pero sin `originalEvent`,
    // así que no se cancela a sí mismo y no hace falta ninguna bandera.
    state.userInteracted = false;
    setCameraMode('follow', { force: true });
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
      // El tema nocturno TABA2 se aplica ANTES de revelar el canvas (is-ready):
      // como este bloque es síncrono, el navegador no pinta ningún frame claro
      // en el medio. Si el tema no puede aplicarse, queda el estilo claro
      // original: un mapa legible, nunca uno roto.
      applyTabaMapTheme(state.map);
      ensureSandboxRoute();
      ensureSandboxPlaces(state.pendingSandboxPlaces);
      // El halo de precisión necesita el estilo cargado para poder agregar su
      // source: antes de `load` no hay dónde ponerlo.
      renderAccuracyHalo();
      fitSandboxGeometry();
      state.pendingSandboxPlaces = null;
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
    /*
     * Cualquier gesto del cliente —arrastrar, pellizcar, doble toque, rueda—
     * suspende el seguimiento en el acto. El mapa no le devuelve el manotazo:
     * deja de mover la cámara y ofrece el camino de vuelta.
     *
     * Lo que separa un gesto de un movimiento nuestro es `originalEvent`: sólo
     * un dedo o un mouse traen el evento del navegador que lo originó. Mirar
     * eso en vez de llevar una bandera nos ahorra tener que acertar el momento
     * exacto en que empieza y termina cada animación de cámara —el montaje, el
     * encuadre inicial y el vuelo de vuelta emiten los mismos eventos—.
     *
     * Y sólo cuenta con el mapa ya cargado: mientras el estilo viaja, un
     * puntero que apenas pasa por encima alcanza para que MapLibre anuncie un
     * arrastre. Medido: 61 ms después de abrir el seguimiento llegaba un
     * `dragstart` nacido de un `mousemove`, y el cliente aparecía explorando un
     * mapa que todavía no había visto.
     */
    for (const eventName of ['dragstart', 'zoomstart', 'rotatestart']) {
      addMapListener(eventName, (event) => {
        if (!state.ready || !isGestureEvent(event) || state.programmaticMove) return;
        state.userInteracted = true;
        setCameraMode('explore');
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
    if (
      !state.sandbox
      || !state.sandboxGeometryVerified
      || !state.routeFeature
      || !state.routeVisible
      || !state.map
    ) return;
    const existing = state.map.getSource?.(MAPLIBRE_SANDBOX_ROUTE_SOURCE_ID);
    if (existing?.setData) {
      existing.setData(state.routeFeature);
    } else {
      state.map.addSource?.(MAPLIBRE_SANDBOX_ROUTE_SOURCE_ID, {
        type: 'geojson',
        data: state.routeFeature,
      });
    }
    // Casing debajo, línea encima: el orden de inserción es la jerarquía.
    if (!state.map.getLayer?.(MAPLIBRE_SANDBOX_ROUTE_CASING_LAYER_ID)) {
      state.map.addLayer?.({
        id: MAPLIBRE_SANDBOX_ROUTE_CASING_LAYER_ID,
        type: 'line',
        source: MAPLIBRE_SANDBOX_ROUTE_SOURCE_ID,
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: { ...SANDBOX_ROUTE_CASING_PAINT },
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
        paint: { ...SANDBOX_ROUTE_LINE_PAINT },
      });
    }
  }

  function setSandboxRouteVisible(visible) {
    const nextVisible = visible === true && Boolean(state.routeFeature);
    state.routeVisible = nextVisible;
    if (!state.map || !state.ready) return nextVisible;
    const layer = state.map.getLayer?.(MAPLIBRE_SANDBOX_ROUTE_LAYER_ID);
    if (layer && state.map.setLayoutProperty) {
      // Las dos capas de la ruta (casing + línea) se muestran y ocultan juntas.
      for (const layerId of [MAPLIBRE_SANDBOX_ROUTE_CASING_LAYER_ID, MAPLIBRE_SANDBOX_ROUTE_LAYER_ID]) {
        if (state.map.getLayer?.(layerId)) {
          state.map.setLayoutProperty(layerId, 'visibility', nextVisible ? 'visible' : 'none');
        }
      }
    } else if (nextVisible) {
      ensureSandboxRoute();
    }
    return nextVisible;
  }

  function ensureSandboxPlaces(places) {
    if (!state.map || !places) return;
    if (state.sandbox && state.sandboxGeometryVerified && isValidMapPoint(places.store) && !state.storeMarker) {
      state.storeMarker = createPlaceMarker({
        point: places.store,
        kind: 'store',
        label: places.store.label || 'Comercio',
      });
    }
    if (isValidMapPoint(places.destination) && !state.destinationMarker) {
      state.destinationMarker = createPlaceMarker({
        point: places.destination,
        kind: 'destination',
        label: places.destination.label || 'Destino de entrega',
      });
    }
  }

  // Los pines de origen y destino se anclan por su punta y crecen hacia arriba,
  // y la superficie superpone la píldora de estado, el recentrado y la
  // atribución. El encuadre reserva ese alto real —proporcional al contenedor,
  // para que sirva igual en la vista cliente y en la del rider— y así ningún
  // marcador queda recortado contra los bordes del mapa.
  function sandboxFitPadding() {
    const width = Number(state.canvas?.clientWidth) || 0;
    const height = Number(state.canvas?.clientHeight) || 0;
    if (!(width > 0) || !(height > 0)) return 34;
    return {
      top: Math.round(Math.min(height * 0.24, 78)),
      bottom: Math.round(Math.min(height * 0.19, 66)),
      left: Math.round(Math.min(width * 0.13, 44)),
      right: Math.round(Math.min(width * 0.13, 44)),
    };
  }

  function fitSandboxGeometry() {
    const coordinates = state.routeFeature?.geometry?.coordinates;
    if (!state.map?.fitBounds || !Array.isArray(coordinates) || coordinates.length < 2) return;
    const lngs = coordinates.map((coordinate) => Number(coordinate[0])).filter(Number.isFinite);
    const lats = coordinates.map((coordinate) => Number(coordinate[1])).filter(Number.isFinite);
    if (lngs.length < 2 || lats.length < 2) return;
    state.programmaticMove = true;
    try {
      state.map.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        { padding: sandboxFitPadding(), maxZoom: 15.5, duration: 0 },
      );
    } finally {
      setTimer(() => {
        state.programmaticMove = false;
      }, 0);
    }
  }

  function createPlaceMarker({ point, kind, label }) {
    const element = createPlaceMarkerElement(documentRef, { kind, label });
    if (!element) return null;
    return new (maplibregl || root?.maplibregl).Marker({
      element,
      anchor: 'bottom',
    })
      .setLngLat(toLngLat(point))
      .addTo(state.map);
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
    state.destinationMarker = null;
    state.motion?.reset?.();
    state.motion = null;
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
    if (state.motionFrame === null) return;
    cancelFrame(state.motionFrame);
    state.motionFrame = null;
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
      hasSandboxRoute: Boolean(state.routeFeature),
      sandboxRouteVisible: state.routeVisible,
      userInteracted: state.userInteracted,
      cameraMode: state.cameraMode,
      moving: Boolean(state.motion?.isMoving()),
      accuracyMeters: state.accuracyMeters,
      // La coordenada MEDIDA, nunca la interpolada: lo que se reporta hacia
      // afuera es siempre el dato del backend.
      measuredLocation: state.riderLocation ? { ...state.riderLocation } : null,
    });
  }

  return Object.freeze({
    mount,
    updateRiderLocation,
    updateFreshness,
    setSandboxRouteVisible,
    recenter,
    resize,
    destroy,
    getLifecycleState,
    getCameraMode: () => state.cameraMode,
  });
}

/**
 * ¿Este evento de cámara lo produjo una persona? MapLibre adjunta el evento del
 * navegador que lo originó sólo cuando viene de un gesto; lo que movemos por
 * código llega sin él.
 */
export function isGestureEvent(event) {
  return Boolean(event?.originalEvent);
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
