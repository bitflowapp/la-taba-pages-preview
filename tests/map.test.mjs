import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canUseMapLibre,
  disposeMapViews,
  recenterMapViews,
  renderMapViews,
} from '../js/map/map_view.js';
import {
  MAPLIBRE_FALLBACK_COPY,
  MAPLIBRE_PUBLIC_STYLE_URL,
  MAPLIBRE_SANDBOX_ROUTE_LAYER_ID,
  MAPLIBRE_SANDBOX_ROUTE_SOURCE_ID,
  createMapLibreTrackingMap,
  shouldAnimateRiderMove,
} from '../js/map/maplibre_tracking_map.js';
import {
  createRiderMarkerElement,
  riderAvatarHelmetSvg,
  riderHelmetSvg,
  riderMarkerClass,
} from '../js/map/rider_marker.js';
import {
  chooseRiderLocation,
  distanceKm,
  getRoute,
  getStreetTestDestination,
  getStreetTestDestinations,
  hasFreshSharedGpsLocation,
  hasLiveRiderLocation,
  isLocationStale,
  isUsableGpsFix,
  isValidLocation,
  normalizeRiderLocation,
  pointOnRoute,
  routeDistanceKm,
  selectRouteForOrder,
  shouldAcceptGpsFix,
  shouldAcceptLocationUpdate,
  shouldPublishGpsFix,
  shouldRenderGpsFix,
  shouldRenderLocationUpdate,
} from '../js/map/route_geometry.js';
import { setState } from '../js/state.js';
import { resetState } from './helpers.mjs';

test('route selection covers Neuquén and Cipolletti demo routes', () => {
  assert.equal(selectRouteForOrder({ address: 'Roca 123, Neuquén' }).id, 'neuquen');
  assert.equal(selectRouteForOrder({ address: 'Cipolletti centro' }).id, 'cipolletti');
  assert.equal(selectRouteForOrder({ delivery: { demoDestinationId: 'alto-comahue' } }).id, 'alto-comahue');
});

test('street test destinations expose demo labels and route points', () => {
  const destinations = getStreetTestDestinations();
  assert.equal(destinations.length, 5);
  assert.equal(getStreetTestDestination('parque-norte-bardas').label, 'Parque Norte / Bardas');
  const route = getRoute('alto-comahue');
  assert.equal(route.destination.addressLabel, 'Destino demo · Alto Comahue');
  assert.ok(routeDistanceKm(route.points) > 1);
});

test('route progress interpolates through real coordinates', () => {
  const route = getRoute('cipolletti');
  const start = pointOnRoute(route.id, 0);
  const middle = pointOnRoute(route.id, 0.5);
  const end = pointOnRoute(route.id, 1);

  assert.ok(routeDistanceKm(route.points) > 5);
  assert.notDeepEqual(start, middle);
  assert.notDeepEqual(middle, end);
  assert.ok(Number.isFinite(middle.heading));
  assert.ok(distanceKm(start, end) > 5);
});

test('rider location parser normalizes GPS metadata and rejects invalid points', () => {
  const parsed = normalizeRiderLocation({
    lat: '-38.95',
    lng: '-68.05',
    accuracy: '18',
    heading: '-10',
    speed: '4',
    timestamp: 1780110000000,
    source: 'gps',
  });

  assert.equal(parsed.source, 'gps');
  assert.equal(parsed.accuracy, 18);
  assert.equal(parsed.heading, 350);
  assert.equal(parsed.speed, 4);
  assert.equal(normalizeRiderLocation({ lat: 500, lng: 0 }), null);
});

test('GPS quality filters reject invalid, stale, inaccurate and impossible fixes', () => {
  const now = 1_000_000;
  const previous = { lat: -38.951, lng: -68.061, source: 'gps', accuracy: 12, timestamp: now - 2_000 };
  const next = { lat: -38.9511, lng: -68.0611, source: 'gps', accuracy: 18, timestamp: now - 1_000 };
  const absurdJump = { lat: -38.40, lng: -68.80, source: 'gps', accuracy: 120, timestamp: now - 500 };

  assert.equal(isValidLocation({ lat: -38.95, lng: -68.05 }), true);
  assert.equal(isValidLocation({ lat: -91, lng: -68.05 }), false);
  assert.equal(isUsableGpsFix(next, { now }), true);
  assert.equal(isUsableGpsFix({ ...next, timestamp: now - 60_000 }, { now }), false);
  assert.equal(isUsableGpsFix({ ...next, accuracy: 400 }, { now }), false);
  assert.equal(shouldAcceptLocationUpdate(previous, next, { now }), true);
  assert.equal(shouldAcceptLocationUpdate(previous, absurdJump, { now }), false);
});

test('GPS policy reduces writes but still publishes max-age and status changes', () => {
  const now = 1_000_000;
  const previous = { lat: -38.951, lng: -68.061, source: 'gps', accuracy: 12, timestamp: now - 10_000, at: now - 2_000, orderStatus: 'on_the_way' };
  const tiny = { lat: -38.951001, lng: -68.061001, source: 'gps', accuracy: 14, timestamp: now };
  const moved = { lat: -38.95116, lng: -68.06116, source: 'gps', accuracy: 14, timestamp: now + 4_000 };

  assert.equal(shouldPublishGpsFix(null, tiny, { now, orderStatus: 'on_the_way' }), true);
  assert.equal(shouldPublishGpsFix(previous, tiny, { now, orderStatus: 'on_the_way' }), false);
  assert.equal(shouldPublishGpsFix({ ...previous, at: now - 15_000 }, tiny, { now, orderStatus: 'on_the_way' }), true);
  assert.equal(shouldPublishGpsFix({ ...previous, at: now - 8_000 }, moved, { now: now + 8_000, orderStatus: 'on_the_way' }), true);
  assert.equal(shouldPublishGpsFix(previous, tiny, { now, orderStatus: 'arriving', previousOrderStatus: 'on_the_way' }), true);
  assert.equal(shouldPublishGpsFix(previous, tiny, { now, orderStatus: 'delivered' }), false);
});

test('GPS policy accepts good fixes and rejects weak replacements or jumps', () => {
  const now = 1_000_000;
  const good = { lat: -38.951, lng: -68.061, source: 'gps', accuracy: 12, timestamp: now - 1_000 };
  const weak = { lat: -38.95101, lng: -68.06101, source: 'gps', accuracy: 180, timestamp: now };
  const jump = { lat: -38.75, lng: -68.30, source: 'gps', accuracy: 120, timestamp: now };

  assert.equal(shouldAcceptGpsFix(null, good, { now }), true);
  assert.equal(shouldAcceptGpsFix(good, weak, { now }), false);
  assert.equal(shouldAcceptGpsFix(good, jump, { now }), false);
});

test('map fallback is explicit for unsupported WebGL, style and tile failures', () => {
  assert.equal(canUseMapLibre({}), false);
  assert.equal(canUseMapLibre({
    maplibregl: { Map() {}, Marker() {} },
    document: createFakeDocument({ webgl: false }),
  }), false);
  assert.equal(canUseMapLibre({
    maplibregl: { Map() {}, Marker() {} },
    document: createFakeDocument(),
  }), true);

  const unsupportedDocument = createFakeDocument({ webgl: false });
  const unsupportedShell = createMapShell('LT-NO-WEBGL', { documentRef: unsupportedDocument });
  const unsupported = createMapLibreTrackingMap({
    root: { document: unsupportedDocument },
    documentRef: unsupportedDocument,
    maplibregl: { Map: class {}, Marker: class {} },
    webglSupported: () => false,
  });
  assert.equal(unsupported.mount({
    container: unsupportedShell.canvas,
    shell: unsupportedShell.shell,
    fallback: unsupportedShell.fallback,
    riderLocation: { lat: -38.95, lng: -68.05, source: 'gps' },
  }), false);
  assert.equal(unsupportedShell.shell.dataset.mapStatus, 'unavailable');
  assert.equal(unsupportedShell.fallbackCopy.textContent, MAPLIBRE_FALLBACK_COPY);
  unsupported.destroy();

  const styleEnvironment = installMapLibreStub();
  const styleShell = createMapShell('LT-STYLE-FAIL', { documentRef: styleEnvironment.document });
  const styleController = createMapLibreTrackingMap();
  try {
    assert.equal(styleController.mount({
      container: styleShell.canvas,
      shell: styleShell.shell,
      fallback: styleShell.fallback,
      riderLocation: { lat: -38.95, lng: -68.05, source: 'gps' },
      freshness: 'fresh',
    }), true);
    styleEnvironment.calls.maps[0].emit('error', { error: new Error('style failed to load') });
    assert.equal(styleShell.shell.dataset.mapStatus, 'unavailable');
    assert.equal(styleShell.fallbackCopy.textContent, MAPLIBRE_FALLBACK_COPY);
    assert.equal(styleEnvironment.calls.mapRemove, 1);
  } finally {
    styleController.destroy();
    styleEnvironment.restore();
  }

  const tileEnvironment = installMapLibreStub();
  const tileShell = createMapShell('LT-TILES-FAIL', { documentRef: tileEnvironment.document });
  const tileController = createMapLibreTrackingMap();
  try {
    tileController.mount({
      container: tileShell.canvas,
      shell: tileShell.shell,
      fallback: tileShell.fallback,
      riderLocation: { lat: -38.95, lng: -68.05, source: 'gps' },
      freshness: 'fresh',
    });
    tileEnvironment.calls.maps[0].emit('load');
    for (let index = 0; index < 3; index += 1) {
      tileEnvironment.calls.maps[0].emit('error', { error: new Error('failed to load tile') });
    }
    assert.equal(tileShell.shell.dataset.mapStatus, 'unavailable');
    assert.equal(tileShell.fallbackCopy.textContent, MAPLIBRE_FALLBACK_COPY);
  } finally {
    tileController.destroy();
    tileEnvironment.restore();
  }
});

test('MapLibre uses the public light OpenFreeMap style', () => {
  assert.equal(MAPLIBRE_PUBLIC_STYLE_URL, 'https://tiles.openfreemap.org/styles/positron');
});

test('rider marker class reflects status and source', () => {
  assert.match(riderMarkerClass('on_the_way', 'gps'), /on-the-way/);
  assert.match(riderMarkerClass('on_the_way', 'gps'), /source-gps/);
  assert.match(riderMarkerClass('preparing', 'simulation'), /preparing/);

  const marker = createRiderMarkerElement(createFakeDocument(), { status: 'on_the_way', source: 'gps' });
  assert.match(marker.className, /lt-rider-marker on-the-way source-gps/);
  assert.match(marker.innerHTML, /lt-rider-helmet-core/);
  assert.match(marker.innerHTML, /<svg[^>]*class="[^"]*\blt-rider-helmet-icon\b[^"]*"/);
  assert.doesNotMatch(marker.innerHTML, /\btaba-map-helmet\b/);
  assert.doesNotMatch(marker.innerHTML, /data-map-rider-helmet/);
  assert.doesNotMatch(marker.innerHTML, /taba-delivery-helmet/);
  assert.match(marker.innerHTML, /role="img"/);
  assert.match(marker.innerHTML, /aria-label="Casco del rider TABA"/);
  assert.match(marker.innerHTML, /<circle[^>]*fill="#c8101e"[^>]*stroke="#ffffff"[^>]*stroke-width="2\.5"/);
  assert.doesNotMatch(marker.innerHTML, />R</);
  assert.doesNotMatch(marker.innerHTML, /<text/);
  assert.doesNotMatch(marker.innerHTML, /(?:moto|scooter|emoji|<image\b|(?:src|href)=|https?:\/\/)/i);
  assert.doesNotMatch(marker.innerHTML, /[\u{1F300}-\u{1FAFF}]/u);
  assert.doesNotMatch(marker.innerHTML, /--heading/);
});

test('rider avatar keeps a profile helmet separate from the map marker', () => {
  const avatar = riderAvatarHelmetSvg({ className: 'tracking-rider-helmet', decorative: true });
  assert.match(avatar, /class="[^"]*\btracking-rider-helmet\b[^"]*"/);
  assert.match(avatar, /\btaba-delivery-helmet\b/);
  assert.doesNotMatch(avatar, /\btaba-rider-isotype\b/);
  assert.match(avatar, /viewBox="0 0 64 64"/);
  assert.match(avatar, /preserveAspectRatio="xMidYMid meet"/);
  assert.match(avatar, /aria-hidden="true"/);
  assert.match(avatar, /fill="currentColor"/);
  assert.match(avatar, /fill="var\(--delivery-helmet-contrast\)"/);
  assert.match(avatar, /<circle[^>]*cx="27\.5"[^>]*cy="31\.4"/);
  assert.doesNotMatch(avatar, /(?:moto|scooter|emoji|<image\b|(?:src|href)=|https?:\/\/)/i);
  assert.doesNotMatch(avatar, /(?:<filter|<linearGradient|<radialGradient|<image\b)/i);
});

test('chooseRiderLocation prioriza GPS real sobre simulación', () => {
  const now = 1_000_000;
  const sim = { lat: -38.95, lng: -68.05, source: 'simulation', timestamp: now };
  const trackedGps = { lat: -38.94, lng: -68.04, source: 'gps', timestamp: now - 5_000 };
  // Aunque el fix GPS sea más viejo, gana por ser ubicación real.
  const chosen = chooseRiderLocation(sim, trackedGps, { now });
  assert.equal(chosen.source, 'gps');
  assert.equal(chosen.lat, -38.94);
});

test('chooseRiderLocation returns to simulation only when GPS is stale', () => {
  const now = 1_000_000;
  const sim = { lat: -38.95, lng: -68.05, source: 'simulation', timestamp: now };
  const freshGps = { lat: -38.94, lng: -68.04, source: 'gps', timestamp: now - 5_000 };
  const staleGps = { ...freshGps, timestamp: now - 60_000 };

  assert.equal(chooseRiderLocation(sim, freshGps, { now }).source, 'gps');
  assert.equal(chooseRiderLocation(sim, staleGps, { now }).source, 'simulation');
});

test('chooseRiderLocation usa el fix más nuevo si la fuente es la misma', () => {
  const older = { lat: -38.95, lng: -68.05, source: 'gps', timestamp: 1000 };
  const newer = { lat: -38.94, lng: -68.04, source: 'gps', timestamp: 5000 };
  assert.equal(chooseRiderLocation(older, newer).timestamp, 5000);
  assert.equal(chooseRiderLocation(newer, older).timestamp, 5000);
});

test('chooseRiderLocation ignora coordenadas inválidas y soporta nulls', () => {
  const valid = { lat: -38.95, lng: -68.05, source: 'gps', timestamp: 1000 };
  const invalid = { lat: 999, lng: 999, source: 'gps', timestamp: 9999 };
  assert.equal(chooseRiderLocation(null, valid).source, 'gps');
  assert.equal(chooseRiderLocation(invalid, valid).lat, -38.95);
  assert.equal(chooseRiderLocation(invalid, null), null);
  assert.equal(chooseRiderLocation(null, null), null);
});

test('hasLiveRiderLocation solo es true con GPS real y reciente', () => {
  const now = 1_000_000;
  const freshGps = { lat: -38.95, lng: -68.05, source: 'gps', timestamp: now - 5_000 };
  const stoppedGps = { ...freshGps, gpsStatus: 'inactive' };
  const staleGps = { lat: -38.95, lng: -68.05, source: 'gps', timestamp: now - 60_000 };
  const sim = { lat: -38.95, lng: -68.05, source: 'simulation', timestamp: now };

  assert.equal(hasLiveRiderLocation(freshGps, { now }), true);
  assert.equal(hasLiveRiderLocation(stoppedGps, { now }), false);
  // Simulación / recorrido de apoyo NO cuenta como rider real.
  assert.equal(hasLiveRiderLocation(sim, { now }), false);
  // GPS viejo tampoco: ya no está "en vivo".
  assert.equal(hasLiveRiderLocation(staleGps, { now }), false);
  // Sin ubicación: no hay rider en vivo (pedido recién creado).
  assert.equal(hasLiveRiderLocation(null, { now }), false);
  assert.equal(hasLiveRiderLocation(undefined, { now }), false);
});

test('un último fix fresco se comparte sin presentarse como seguimiento activo', () => {
  const now = 1_000_000;
  const snapshot = {
    lat: -38.95,
    lng: -68.05,
    source: 'gps',
    gpsStatus: 'last_fix',
    timestamp: now - 5_000,
  };
  assert.equal(hasFreshSharedGpsLocation(snapshot, { now }), true);
  assert.equal(hasLiveRiderLocation(snapshot, { now }), false);
  assert.equal(hasFreshSharedGpsLocation({ ...snapshot, timestamp: now - 60_000 }, { now }), false);
});

test('isLocationStale marca como vieja una ubicación pasada el umbral', () => {
  const now = 1_000_000;
  assert.equal(isLocationStale({ timestamp: now - 5_000 }, 30_000, now), false);
  assert.equal(isLocationStale({ timestamp: now - 60_000 }, 30_000, now), true);
  assert.equal(isLocationStale(null, 30_000, now), true);
  assert.equal(isLocationStale({}, 30_000, now), true);
});

test('shouldRenderLocationUpdate throttles tiny visual updates', () => {
  const now = 1_000_000;
  const previous = { lat: -38.951, lng: -68.061, source: 'gps', timestamp: now - 100, renderedAt: now - 100 };
  const tiny = { lat: -38.951001, lng: -68.061001, source: 'gps', timestamp: now };
  const far = { lat: -38.9512, lng: -68.0612, source: 'gps', timestamp: now };

  assert.equal(shouldRenderLocationUpdate(previous, tiny, { now }), false);
  assert.equal(shouldRenderLocationUpdate({ ...previous, renderedAt: now - 1_000 }, tiny, { now }), true);
  assert.equal(shouldRenderLocationUpdate(previous, far, { now }), true);
});

test('shouldRenderGpsFix throttles noisy marker updates', () => {
  const now = 1_000_000;
  const previous = { lat: -38.951, lng: -68.061, source: 'gps', accuracy: 14, timestamp: now - 100, renderedAt: now - 100 };
  const tiny = { lat: -38.951001, lng: -68.061001, source: 'gps', accuracy: 14, timestamp: now };
  const oldEnough = { ...tiny, timestamp: now + 1_300 };
  const far = { lat: -38.9512, lng: -68.0612, source: 'gps', accuracy: 14, timestamp: now };

  assert.equal(shouldRenderGpsFix(previous, tiny, { now }), false);
  assert.equal(shouldRenderGpsFix({ ...previous, renderedAt: now - 1_300 }, oldEnough, { now: now + 1_300 }), true);
  assert.equal(shouldRenderGpsFix(previous, far, { now }), true);
  assert.equal(shouldAnimateRiderMove(previous, far, { freshness: 'fresh' }), true);
  assert.equal(shouldAnimateRiderMove(previous, far, { freshness: 'delayed' }), false);
  assert.equal(shouldAnimateRiderMove(previous, far, { freshness: 'lost' }), false);
  assert.equal(shouldAnimateRiderMove(previous, far, { freshness: 'fresh', reducedMotion: true }), false);
});

test('MapLibre keeps one map and one rider Marker node across GPS updates', async () => {
  const now = Date.now();
  resetState({
    orders: [deliveryOrderWithTracking('LT-MAP-1')],
    lastOrderId: 'LT-MAP-1',
    simulation: {
      orderId: 'LT-MAP-1',
      mode: 'gps',
      source: 'gps',
      gpsStatus: 'active',
      lat: -38.951,
      lng: -68.061,
      timestamp: now,
      lastFixAt: new Date(now).toISOString(),
    },
  });
  const environment = installMapLibreStub();
  const { shell } = createMapShell('LT-MAP-1', { documentRef: environment.document });

  try {
    renderMapViews({ querySelectorAll: () => [shell] });
    environment.calls.maps[0].emit('load');
    await waitForMapFrame();
    assert.equal(environment.calls.maps.length, 1);
    assert.equal(environment.calls.mapOptions[0].cooperativeGestures, true);
    // Mapa honesto: SÓLO el marcador del rider real. Sin marcador de local (LT),
    // sin marcador de cliente (CL) y sin polyline de ruta.
    assert.equal(environment.calls.markers.length, 1);
    assert.equal(environment.calls.addSource.length, 0);
    assert.equal(environment.calls.addLayer.length, 0);
    const initialMarker = environment.calls.markers[0];
    const initialMarkerNode = initialMarker.getElement();
    const initialSetLngLatCount = environment.calls.setLngLat.length;

    setState({
      simulation: {
        orderId: 'LT-MAP-1',
        mode: 'gps',
        source: 'gps',
        gpsStatus: 'active',
        lat: -38.9513,
        lng: -68.0613,
        timestamp: now + 2_000,
        lastFixAt: new Date(now + 2_000).toISOString(),
      },
    });
    renderMapViews({ querySelectorAll: () => [shell] });
    await waitForMapFrame();

    assert.equal(environment.calls.maps.length, 1);
    assert.equal(environment.calls.markers.length, 1);
    assert.ok(environment.calls.setLngLat.length > initialSetLngLatCount);
    assert.strictEqual(environment.calls.markers[0], initialMarker);
    assert.strictEqual(environment.calls.markers[0].getElement(), initialMarkerNode);

    assert.equal(recenterMapViews({ querySelectorAll: () => [shell] }), true);
    const cameraUpdate = environment.calls.jumpTo.at(-1);
    assert.deepEqual(cameraUpdate.center, [-68.0613, -38.9513]);
    assert.equal(Object.hasOwn(cameraUpdate, 'zoom'), false);
    assert.equal(Object.hasOwn(cameraUpdate, 'bearing'), false);

    const map = environment.calls.maps[0];
    assert.ok(map.listenerCount() > 0);
    assert.ok(environment.canvasListenerCount() > 0);
    disposeMapViews({ querySelectorAll: () => [shell] });
    assert.equal(environment.calls.mapRemove, 1);
    assert.equal(environment.calls.markerRemove, 1);
    assert.equal(map.listenerCount(), 0);
    assert.equal(environment.canvasListenerCount(), 0);
    assert.equal(environment.document.listenerCount(), 0);
  } finally {
    disposeMapViews({ querySelectorAll: () => [shell] });
    environment.restore();
  }
});

test('sandbox mounts one verified route source while production stays rider-only', () => {
  const environment = installMapLibreStub();
  const { shell, canvas, fallback } = createMapShell('LT-SANDBOX-MAP', {
    documentRef: environment.document,
  });
  const controller = createMapLibreTrackingMap();
  const route = [
    { lat: -38.95172, lng: -68.05942 },
    { lat: -38.94992, lng: -68.06102 },
    { lat: -38.94688, lng: -68.06678 },
  ];
  try {
    controller.mount({
      container: canvas,
      shell,
      fallback,
      riderLocation: { ...route[1], source: 'simulation' },
      freshness: 'fresh',
      status: 'on_the_way',
      source: 'simulation',
      sandbox: true,
      sandboxGeometryVerified: true,
      route,
      store: { ...route[0], label: 'Comercio TABA' },
      destination: { ...route[2], label: 'Destino sandbox' },
    });
    environment.calls.maps[0].emit('load');

    assert.equal(environment.calls.addSource.length, 1);
    assert.equal(environment.calls.addSource[0].id, MAPLIBRE_SANDBOX_ROUTE_SOURCE_ID);
    assert.equal(environment.calls.addLayer.length, 1);
    assert.equal(environment.calls.addLayer[0].id, MAPLIBRE_SANDBOX_ROUTE_LAYER_ID);
    assert.equal(environment.calls.markers.length, 3);
    assert.equal(environment.calls.fitBounds.length, 1);
    assert.equal(controller.getLifecycleState().hasSandboxRoute, true);
    assert.equal(controller.getLifecycleState().sandboxRouteVisible, true);

    assert.equal(controller.setSandboxRouteVisible(false), false);
    assert.deepEqual(environment.calls.setLayoutProperty.at(-1), {
      id: MAPLIBRE_SANDBOX_ROUTE_LAYER_ID,
      name: 'visibility',
      value: 'none',
    });
    assert.equal(controller.getLifecycleState().sandboxRouteVisible, false);

    assert.equal(controller.setSandboxRouteVisible(true), true);
    assert.deepEqual(environment.calls.setLayoutProperty.at(-1), {
      id: MAPLIBRE_SANDBOX_ROUTE_LAYER_ID,
      name: 'visibility',
      value: 'visible',
    });

    controller.updateRiderLocation(
      { lat: -38.9494, lng: -68.06472, source: 'simulation' },
      { freshness: 'fresh', status: 'on_the_way', source: 'simulation' },
    );
    assert.equal(environment.calls.addSource.length, 1);
    assert.equal(environment.calls.addLayer.length, 1);
  } finally {
    controller.destroy();
    environment.restore();
  }
});

test('rider map uses the light commercial MapLibre style', async () => {
  const now = Date.now();
  resetState({
    orders: [deliveryOrderWithTracking('LT-MAP-RIDER-LIGHT')],
    lastOrderId: 'LT-MAP-RIDER-LIGHT',
    simulation: {
      orderId: 'LT-MAP-RIDER-LIGHT',
      mode: 'gps',
      source: 'gps',
      gpsStatus: 'active',
      lat: -38.951,
      lng: -68.061,
      timestamp: now,
      lastFixAt: new Date(now).toISOString(),
    },
  });
  const environment = installMapLibreStub();
  const { shell } = createMapShell('LT-MAP-RIDER-LIGHT', {
    role: 'rider',
    documentRef: environment.document,
  });

  try {
    renderMapViews({ querySelectorAll: () => [shell] });
    environment.calls.maps[0].emit('load');
    await waitForMapFrame();
    assert.equal(shell.dataset.mapTheme, 'light');
    assert.equal(environment.calls.mapOptions[0].style, MAPLIBRE_PUBLIC_STYLE_URL);
    assert.equal(environment.calls.mapOptions[0].cooperativeGestures, false);
    assert.equal(environment.calls.markers.length, 1);
    assert.equal(environment.calls.controls[0].position, 'bottom-left');
  } finally {
    disposeMapViews({ querySelectorAll: () => [shell] });
    environment.restore();
  }
});

test('without a real GPS fix the map renders no rider marker', async () => {
  const now = Date.now();
  resetState({
    orders: [deliveryOrderWithTracking('LT-MAP-2')],
    lastOrderId: 'LT-MAP-2',
    // Simulación (source !== gps) NO debe pintar marcador en el cliente.
    simulation: {
      orderId: 'LT-MAP-2',
      mode: 'demo',
      source: 'simulation',
      lat: -38.951,
      lng: -68.061,
      timestamp: now,
      lastFixAt: new Date(now).toISOString(),
    },
  });
  const environment = installMapLibreStub();
  const { shell } = createMapShell('LT-MAP-2', { documentRef: environment.document });

  try {
    renderMapViews({ querySelectorAll: () => [shell] });
    await waitForMapFrame();
    assert.equal(environment.calls.maps.length, 0);
    assert.equal(environment.calls.markers.length, 0);
    assert.equal(shell.dataset.mapStatus, 'unavailable');
  } finally {
    disposeMapViews({ querySelectorAll: () => [shell] });
    environment.restore();
  }
});

function deliveryOrderWithTracking(id) {
  return {
    id,
    customerName: 'Mapa QA',
    customerPhone: '2995550000',
    address: 'Roca 123',
    deliveryMode: 'delivery',
    paymentMethod: 'Efectivo',
    notes: '',
    createdAt: new Date().toISOString(),
    status: 'on_the_way',
    items: [{ productId: 'qa-gaseosa-cola', name: 'Bebida QA', icon: '', quantity: 1, unitPrice: 11200, unit: 'unidad' }],
    statusHistory: [{ status: 'received', at: new Date().toISOString() }],
    delivery: { driverName: 'Juli', driverPhone: '2991112233', estimatedMinutes: 14, currentLocationLabel: 'En camino' },
  };
}

function createMapShell(orderId, { role = 'tracking', documentRef = createFakeDocument() } = {}) {
  const metaCopy = { textContent: '' };
  const meta = {
    textContent: '',
    querySelector(selector) {
      return selector === '[data-map-meta-text]' ? metaCopy : null;
    },
  };
  const fallbackCopy = { textContent: '' };
  const fallback = {
    hidden: false,
    setAttribute(name) {
      if (name === 'hidden') this.hidden = true;
    },
    removeAttribute(name) {
      if (name === 'hidden') this.hidden = false;
    },
    querySelector() {
      return fallbackCopy;
    },
  };
  const canvas = createEventTarget();
  canvas.removeAttribute = () => {};
  canvas.setAttribute = () => {};
  const shell = {
    dataset: { mapRole: role, orderId },
    isConnected: true,
    classList: createClassList(),
    querySelector(selector) {
      if (selector === '[data-map-meta]') return meta;
      if (selector === '[data-map-fallback]') return fallback;
      if (selector === '[data-map-canvas]') return canvas;
      return null;
    },
  };
  canvas.parentElement = shell;
  canvas.ownerDocument = documentRef;
  return { shell, meta, metaCopy, fallback, fallbackCopy, canvas };
}

function createClassList() {
  const classes = new Set();
  return {
    add(value) { classes.add(value); },
    remove(value) { classes.delete(value); },
    toggle(value, force) {
      if (force) classes.add(value);
      else classes.delete(value);
    },
    contains(value) { return classes.has(value); },
  };
}

function installMapLibreStub({ webgl = true, constructorError = false } = {}) {
  const originalMapLibre = globalThis.maplibregl;
  const originalDocument = globalThis.document;
  const originalMatchMedia = globalThis.matchMedia;
  const originalResizeObserver = globalThis.ResizeObserver;
  const documentRef = createFakeDocument({ webgl });
  const calls = {
    maps: [],
    mapOptions: [],
    markers: [],
    setLngLat: [],
    addSource: [],
    addLayer: [],
    controls: [],
    fitBounds: [],
    setLayoutProperty: [],
    jumpTo: [],
    easeTo: [],
    mapRemove: 0,
    markerRemove: 0,
    resize: 0,
    observerDisconnect: 0,
  };

  class FakeMap {
    constructor(options) {
      if (constructorError) throw new Error('map constructor failed');
      this.options = options;
      this.listeners = new Map();
      this.sources = new Map();
      this.layers = new Map();
      this.canvas = options.container;
      calls.maps.push(this);
      calls.mapOptions.push(options);
    }
    on(type, listener) {
      const listeners = this.listeners.get(type) || new Set();
      listeners.add(listener);
      this.listeners.set(type, listeners);
      return this;
    }
    off(type, listener) {
      this.listeners.get(type)?.delete(listener);
      return this;
    }
    emit(type, event = {}) {
      [...(this.listeners.get(type) || [])].forEach((listener) => listener(event));
    }
    listenerCount() {
      return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0);
    }
    addControl(control, position) {
      calls.controls.push({ control, position });
      return this;
    }
    addSource(id, definition) {
      const source = {
        ...definition,
        setData(data) {
          this.data = data;
        },
      };
      this.sources.set(id, source);
      calls.addSource.push({ id, definition });
    }
    getSource(id) {
      return this.sources.get(id);
    }
    addLayer(layer) {
      this.layers.set(layer.id, layer);
      calls.addLayer.push(layer);
    }
    getLayer(id) {
      return this.layers.get(id);
    }
    setLayoutProperty(id, name, value) {
      const layer = this.layers.get(id);
      if (layer) {
        layer.layout = { ...(layer.layout || {}), [name]: value };
      }
      calls.setLayoutProperty.push({ id, name, value });
    }
    fitBounds(bounds, options) {
      calls.fitBounds.push({ bounds, options });
    }
    getBounds() {
      return { contains: () => true };
    }
    jumpTo(options) {
      calls.jumpTo.push(options);
    }
    easeTo(options) {
      calls.easeTo.push(options);
    }
    getCanvas() {
      return this.canvas;
    }
    resize() {
      calls.resize += 1;
    }
    remove() {
      calls.mapRemove += 1;
    }
    dragRotate = { disable() {} };
    touchPitch = { disable() {} };
  }

  class FakeMarker {
    constructor(options = {}) {
      this.options = options;
      this.element = options.element;
      calls.markers.push(this);
    }
    setLngLat(next) {
      this.lngLat = [...next];
      calls.setLngLat.push([...next]);
      return this;
    }
    addTo(map) {
      this.map = map;
      return this;
    }
    getElement() {
      return this.element;
    }
    remove() {
      calls.markerRemove += 1;
    }
  }

  class FakeAttributionControl {
    constructor(options) {
      this.options = options;
    }
  }

  class FakeResizeObserver {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {}
    disconnect() {
      calls.observerDisconnect += 1;
    }
  }

  globalThis.document = documentRef;
  globalThis.maplibregl = {
    Map: FakeMap,
    Marker: FakeMarker,
    AttributionControl: FakeAttributionControl,
  };
  globalThis.matchMedia = () => ({ matches: true });
  globalThis.ResizeObserver = FakeResizeObserver;

  return {
    calls,
    document: documentRef,
    canvasListenerCount() {
      return calls.maps[0]?.canvas?.listenerCount?.() || 0;
    },
    restore() {
      if (originalMapLibre) globalThis.maplibregl = originalMapLibre;
      else delete globalThis.maplibregl;
      if (originalDocument) globalThis.document = originalDocument;
      else delete globalThis.document;
      if (originalMatchMedia) globalThis.matchMedia = originalMatchMedia;
      else delete globalThis.matchMedia;
      if (originalResizeObserver) globalThis.ResizeObserver = originalResizeObserver;
      else delete globalThis.ResizeObserver;
    },
  };
}

function createFakeDocument({ webgl = true } = {}) {
  const documentRef = createEventTarget();
  documentRef.hidden = false;
  documentRef.createElement = (tagName) => {
    const element = createEventTarget();
    element.tagName = String(tagName || '').toUpperCase();
    element.dataset = {};
    element.className = '';
    element.innerHTML = '';
    element.classList = createClassList();
    element.setAttribute = () => {};
    element.removeAttribute = () => {};
    element.getContext = tagName === 'canvas'
      ? () => (webgl ? { getParameter() {} } : null)
      : undefined;
    return element;
  };
  return documentRef;
}

function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      const bucket = listeners.get(type) || new Set();
      bucket.add(listener);
      listeners.set(type, bucket);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(type, event = {}) {
      [...(listeners.get(type) || [])].forEach((listener) => listener(event));
    },
    listenerCount() {
      return [...listeners.values()].reduce((total, bucket) => total + bucket.size, 0);
    },
  };
}

function waitForMapFrame() {
  return new Promise((resolve) => setTimeout(resolve, 5));
}
