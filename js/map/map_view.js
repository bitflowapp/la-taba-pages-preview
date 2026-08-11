import { getState } from '../state.js';
import { getActiveOrder } from '../orders.js';
import { getBusinessConfig } from '../core/business-config-store.js';
import { getOrderRepository, isSandboxOrderRepository } from '../repositories/repository_factory.js';
import { getSandboxMapScenario, sandboxMarkerPointAtProgress } from '../sandbox/sandbox_map_scenario.js';
import { RIDER_LOCATION_SOURCES } from './map_config.js';
import { normalizeOrderAddressDetails } from '../core/address.js';
import { plottableDeliveryPoint } from '../core/delivery-location.js';
import {
  chooseRiderLocation,
  hasKnownSharedGpsLocation,
  shouldRenderGpsFix,
  trackingLocationFreshness,
} from './route_geometry.js';
import {
  MAPLIBRE_IDLE_ZOOM,
  areaCenterPoint,
  canUseMapLibre as supportsMapLibre,
  createMapLibreTrackingMap,
} from './maplibre_tracking_map.js';
import { trackingStatus } from './tracking_status.js';

const mountedMaps = new Set();

export function canUseMapLibre(root = globalThis) {
  return supportsMapLibre({
    root,
    documentRef: root?.document,
    maplibregl: root?.maplibregl,
  });
}

function disposeInactiveMaps() {
  for (const entry of [...mountedMaps]) {
    if (!entry.container?.isConnected || !isMapInActiveView(entry.container)) {
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
  disposeInactiveMaps();
  root.querySelectorAll?.('[data-real-map]').forEach((node) => {
    if (isMapInActiveView(node)) renderMapView(node);
  });
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

/*
 * El estado de la cámara se publica en el contenedor y el CSS decide el resto.
 * Mientras el cliente explora, el CTA de vuelta aparece; en cuanto vuelve a
 * seguir, se va. Nada de esto toca la posición del rider.
 */
function applyCameraMode(container, mode) {
  const camera = mode === 'explore' ? 'explore' : 'follow';
  if (!container) return camera;
  if (container.dataset) container.dataset.mapCamera = camera;
  const stage = container.closest?.('[data-map-shell]') || container.parentElement;
  if (stage?.dataset) stage.dataset.mapCamera = camera;
  const cta = stage?.querySelector?.('[data-map-follow-cta]');
  if (cta) {
    cta.hidden = camera !== 'explore';
    cta.setAttribute('aria-hidden', camera === 'explore' ? 'false' : 'true');
  }
  return camera;
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

function isMapInActiveView(container) {
  const view = container?.closest?.('[data-view]');
  if (!view) return true;
  return view.hidden !== true && view.getAttribute?.('aria-hidden') !== 'true';
}

/*
 * Estados en los que el rider ya salió del local. A partir de acá el
 * protagonista del mapa es él, y el pin del comercio deja de aportar: la
 * entrega ya no depende de dónde está la tienda.
 */
const OUT_FOR_DELIVERY_STATUSES = new Set(['picked_up', 'on_the_way', 'arrived', 'arriving']);
const TERMINAL_STATUSES = new Set(['delivered', 'cancelled']);

function readMapViewState(container) {
  const fallback = container.querySelector('[data-map-fallback]');
  const canvas = container.querySelector('[data-map-canvas]');
  // «Seguir» sin pedido es un estado válido del producto, no una vista rota:
  // el mapa se monta igual y muestra la zona operativa con el pin del local.
  // `idle` lo declara la vista; sin esa marca `findOrder` volvería a caer en
  // el último pedido del navegador y el mapa mostraría algo que ya terminó.
  const idle = container.dataset.mapMode === 'idle';
  const emptyMap = idle
    || container.dataset.mapRole === 'tracking-empty'
    || container.dataset.mapRole === 'rider-empty';
  const order = emptyMap ? null : findOrder(container.dataset.orderId);
  const sim = order ? getOrderSimulation(order.id) : null;
  const role = container.dataset.mapRole?.startsWith('rider') ? 'rider' : 'tracking';
  const sandbox = isSandboxOrderRepository(getOrderRepository()) && container.dataset.mapSource === 'sandbox';
  const sandboxScenario = sandbox ? getSandboxMapScenario() : null;
  const riderLocation = order && !TERMINAL_STATUSES.has(order.status)
    ? getRiderLocation(order, sim, sandbox)
    : null;
  // El destino real del pedido. Antes sólo existía en la sandbox, así que el
  // seguimiento de un pedido de verdad no podía dibujar a dónde iba la entrega
  // aunque el cliente hubiera confirmado el punto.
  const destination = sandboxScenario?.destination || orderDestinationPoint(order);
  const store = sandboxScenario?.store || businessStorePoint(order);
  const area = sandboxScenario ? null : operatingAreaBounds();
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
    idle,
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
    area,
    sandboxScenario,
  };
}

/**
 * Pin del comercio con la coordenada PUBLICADA del contrato. Nunca se estima:
 * si el contrato no la declara ploteable, no hay pin.
 */
function businessStorePoint(order) {
  const config = getBusinessConfig();
  if (config.businessLocationVerified !== true) return null;
  const point = config.businessLocation;
  const lat = Number(point?.lat);
  const lng = Number(point?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // En retiro por el local el comercio ES el punto de entrega, así que se
  // queda en pantalla todo el recorrido del pedido.
  const isPickup = order?.deliveryMode === 'pickup';
  if (order && !isPickup && OUT_FOR_DELIVERY_STATUSES.has(order.status)) return null;
  return { lat, lng, label: config.businessName || 'Comercio' };
}

/** Área de reparto declarada por el comercio, para el encuadre sin pedido. */
function operatingAreaBounds() {
  const bounds = getBusinessConfig().defaultMapBounds;
  return Array.isArray(bounds) && bounds.length === 2 ? bounds : null;
}

/*
 * ENCUADRE CUANDO NO HAY RIDER. Mientras el pedido se prepara, lo que el
 * cliente necesita ver es de dónde sale y a dónde va. Centrar en el local a
 * zoom fijo dejaba el destino fuera de pantalla —medido: 1 km entre los dos
 * puntos, contra unos 500 m de ancho visible—, así que el pin existía y no se
 * veía. Con los dos puntos se arma un encuadre que los contiene a ambos.
 *
 * Con un solo punto no hay área que armar y manda el centro; el `maxZoom` más
 * alto que el del área operativa evita que una entrega a la vuelta de la
 * esquina se muestre desde demasiado lejos.
 */
function placesArea(store, destination) {
  const points = [store, destination].filter((point) => (
    Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lng))
  ));
  if (points.length < 2) return null;
  return [
    [Number(points[0].lat), Number(points[0].lng)],
    [Number(points[1].lat), Number(points[1].lng)],
  ];
}

/** Identidad del encuadre sin rider: si cambia, hay que volver a encuadrar. */
function framingKey(view) {
  return JSON.stringify([
    view.store ? [view.store.lat, view.store.lng] : null,
    view.destination ? [view.destination.lat, view.destination.lng] : null,
  ]);
}

/**
 * Punto de entrega del pedido en la forma que consume el mapa. Sólo se dibuja
 * un punto que el pedido TRAE: acá no se geocodifica ni se estima nada.
 */
function orderDestinationPoint(order) {
  if (!order || order.deliveryMode === 'pickup') return null;
  // Un pedido cancelado no tiene entrega, así que tampoco tiene a dónde
  // apuntar: dejar el pin dibujado sería afirmar una entrega que no va a pasar.
  if (order.status === 'cancelled') return null;
  const point = plottableDeliveryPoint(normalizeOrderAddressDetails(order));
  if (!point) return null;
  return { lat: point.latitude, lng: point.longitude, label: 'Destino de entrega' };
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
    /*
     * El pedido avanza y el mapa NO se vuelve a construir: se le cambian las
     * capas. Sin pedido hay sólo local; cuando el cliente compra aparece su
     * punto de entrega confirmado; cuando el rider sale, el local se va y el
     * rider toma la escena. Un mapa que se desmonta y se rearma pierde el
     * encuadre, parpadea y vuelve a pedir tiles que ya tenía.
     */
    existing.adapter.updatePlaces?.({ store: view.store, destination: view.destination });
    // Sin rider que seguir —no hay pedido, o el pedido terminó— el marcador y
    // su halo se retiran. Dejarlos sería dibujar un reparto que no existe.
    const hadRider = Boolean(existing.adapter.getLifecycleState?.()?.hasRiderMarker);
    if (!view.riderLocation && hadRider) {
      existing.adapter.clearRider?.();
      existing.lastRenderedLocation = null;
      existing.lastStatus = null;
      existing.lastSource = null;
    }
    /*
     * Mientras no hay rider, la cámara la manda el encuadre de los lugares. Se
     * reaplica sólo cuando ese conjunto CAMBIA —aparece el destino, se va el
     * local, termina el pedido—; hacerlo en cada render pisaría el gesto del
     * cliente cada pocos segundos.
     */
    const nextFraming = view.riderLocation ? null : framingKey(view);
    if (nextFraming && (nextFraming !== existing.lastFraming || hadRider)) {
      existing.lastFraming = nextFraming;
      const framed = existing.adapter.frameArea?.(
        placesArea(view.store, view.destination),
        { maxZoom: 15.4 },
      );
      if (!framed && !existing.adapter.focusOn?.({ point: view.store })) {
        existing.adapter.frameArea?.(view.area);
      }
    }
    if (view.riderLocation) existing.lastFraming = null;
    if (!showSandboxRoute && view.order?.status === 'arriving') {
      existing.adapter.recenter?.({ animate: false });
    }
    existing.adapter.updateFreshness(view.freshness);
    return existing;
  }

  const adapter = createMapLibreTrackingMap({
    // El CTA de volver al rider vive en el DOM de la vista, no en el mapa: el
    // adaptador sólo avisa cuándo el cliente pasó a explorar y cuándo volvió.
    onCameraModeChange: (mode) => applyCameraMode(container, mode),
  });
  const entry = {
    container,
    adapter,
    pendingFrame: null,
    pendingView: null,
    lastRenderedLocation: null,
    lastStatus: null,
    lastSource: null,
    // Qué lugares encuadró la cámara la última vez que no había rider.
    lastFraming: view.riderLocation ? null : framingKey(view),
  };
  mountedMaps.add(entry);
  applyCameraMode(container, 'follow');

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
    // El pin del local sale del contrato de ubicación publicado, así que ya no
    // depende de estar en la sandbox: es lo único que el mapa puede mostrar
    // con honestidad cuando todavía no hay ningún pedido.
    store: view.store,
    // El destino se dibuja también fuera de la sandbox cuando el pedido trae su
    // punto: es un dato del cliente, no geometría inventada.
    destination: view.destination,
    /*
     * Sin pedido no hay a quién seguir. Si el local se puede plotear, la
     * cámara abre sobre él: es el punto que le da sentido al mapa y el barrio
     * se reconoce. El encuadre del área completa queda como respaldo para
     * cuando NO hay pin del local, porque ahí sí conviene mostrar la cobertura
     * entera antes que un centro sin nada que lo justifique.
     */
    area: placesArea(view.store, view.destination)
      || (view.store ? null : view.area),
    areaMaxZoom: placesArea(view.store, view.destination) ? 15.4 : 14.2,
    center: view.riderLocation
      || view.store
      || view.destination
      || (view.idle ? areaCenterPoint(view.area) : null),
    zoom: view.idle ? MAPLIBRE_IDLE_ZOOM : view.sandbox ? 14.5 : 16,
    /*
     * El seguimiento del cliente monta con `cooperativeGestures`, y se queda
     * así a propósito. Se probó sacarlo —para que arrastrar con un dedo moviera
     * el mapa— y rompe algo más importante: la vista de seguimiento es una
     * página larga, el mapa ocupa media pantalla, y sin esta opción MapLibre le
     * pone `touch-action: none` al lienzo y se queda con el arrastre vertical.
     * El cliente deja de poder scrollear su propio pedido con el dedo sobre el
     * mapa. Ese contrato está fijado en tracking-arriving.spec.mjs.
     *
     * O sea que explorar el mapa se hace con DOS dedos —arrastrar y pellizcar—,
     * que es la convención de cualquier mapa embebido en una página. El gesto
     * de dos dedos sí suspende el seguimiento y ofrece la vuelta.
     */
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
  renderMapMeta(container, view.order, view.riderLocation, view.destination, view);
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

function renderMapMeta(container, order, location, destination, view = null) {
  const meta = container.querySelector('[data-map-meta]');
  if (!meta) return;
  const copy = meta.querySelector?.('[data-map-meta-text]') || meta;
  delete container.dataset.mapPresentation;
  /*
   * Sin pedido no falta ninguna ubicación: no hay ninguna que buscar. La
   * píldora dice de qué es este mapa —la zona en la que reparte el local— en
   * vez de anunciar una falla que no ocurrió.
   */
  if (view?.idle) {
    container.dataset.mapFreshness = 'none';
    container.dataset.mapPresentation = 'idle';
    copy.textContent = idleMapMetaLabel();
    return;
  }
  if (!order || !location) {
    container.dataset.mapFreshness = 'none';
    /*
     * En el seguimiento del cliente, «no hay ubicación del rider» casi nunca es
     * una falla: el pedido se está preparando, o ya se entregó. Anunciar
     * «Ubicación temporalmente no disponible» sobre un pedido ENTREGADO es
     * inventar un problema encima de un final feliz. La píldora dice entonces
     * qué es este mapa, y el porqué —cuando hace falta decirlo— lo explica la
     * tarjeta de espera, que es su lugar. La vista del Rider conserva su copy.
     */
    if (container.dataset.mapRole === 'tracking') {
      container.dataset.mapPresentation = 'places-only';
      copy.textContent = idleMapMetaLabel();
      return;
    }
    copy.textContent = 'Ubicación temporalmente no disponible';
    return;
  }

  const age = relativeAgeLabel(location.lastFixAt || location.timestamp);
  const freshness = location.source === 'gps'
    ? trackingLocationFreshness(location)
    : 'fresh';
  container.dataset.mapFreshness = freshness;
  if (container.dataset.mapRole === 'tracking') {
    // Llegar y estar en un recorrido de muestra siguen mandando sobre el estado
    // de la señal: en la puerta el rider ya frenó, y una demo no es seguimiento.
    if (['arrived', 'arriving'].includes(order.status)) {
      container.dataset.mapPresentation = 'last-location';
      copy.textContent = `Última ubicación · ${age === 'ahora' ? 'hace 0 s' : age}`;
      return;
    }
    if (location.origin === 'sandbox_route' || location.source === 'simulation') {
      copy.textContent = `Recorrido de muestra · ${age}`;
      return;
    }
    // Y en camino, los cuatro estados que el cliente necesita distinguir, con
    // la antigüedad a la vista para que pueda decidir si esperar.
    const status = trackingStatus(location, { online: navigatorIsOnline() });
    container.dataset.mapSignal = status.state;
    copy.textContent = status.label;
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

/*
 * Etiqueta del mapa sin pedido. Habla del comercio, que es lo único cierto en
 * ese momento; si el comercio todavía no publicó su zona, se dice el nombre y
 * nada más, en vez de inventar una cobertura.
 */
function idleMapMetaLabel() {
  const config = getBusinessConfig();
  const name = String(config.businessName || '').trim();
  const zone = String(config.deliveryZone || '').trim();
  const declaredZone = zone && !/a confirmar/i.test(zone) ? zone : '';
  if (name && declaredZone) return `${name} · ${declaredZone}`;
  return name || 'Zona de reparto';
}

/* Un runtime sin `navigator` (los tests, el SSR de nadie) se asume conectado. */
function navigatorIsOnline() {
  const online = globalThis.navigator?.onLine;
  return online === undefined ? true : online !== false;
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
