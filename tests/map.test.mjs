import assert from 'node:assert/strict';
import test from 'node:test';
import { canUseLeaflet, disposeMapViews, renderMapViews } from '../js/map/map_view.js';
import { getMapTheme, getTileLayerForTheme } from '../js/map/map_config.js';
import { createRiderIcon, riderMarkerClass } from '../js/map/rider_marker.js';
import {
  chooseRiderLocation,
  distanceKm,
  getRoute,
  getStreetTestDestination,
  getStreetTestDestinations,
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
  assert.equal(shouldPublishGpsFix({ ...previous, at: now - 12_000 }, tiny, { now, orderStatus: 'on_the_way' }), true);
  assert.equal(shouldPublishGpsFix({ ...previous, at: now - 4_500 }, moved, { now: now + 4_500, orderStatus: 'on_the_way' }), true);
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

test('map fallback is explicit when Leaflet is unavailable', () => {
  assert.equal(canUseLeaflet({}), false);
  assert.equal(canUseLeaflet({ L: { map() {}, tileLayer() {} } }), true);
});

test('map config selects clean light and dark tile themes', () => {
  const dark = getTileLayerForTheme('dark');
  const light = getTileLayerForTheme('light');

  assert.equal(getMapTheme('bad-theme'), 'light');
  assert.equal(dark.theme, 'dark');
  assert.equal(light.theme, 'light');
  assert.match(dark.tilesUrl, /cartocdn\.com\/dark_all/);
  assert.match(light.tilesUrl, /cartocdn\.com\/light_all/);
  assert.match(dark.attribution, /OpenStreetMap/);
});

test('rider marker class reflects status and source', () => {
  assert.match(riderMarkerClass('on_the_way', 'gps'), /on-the-way/);
  assert.match(riderMarkerClass('on_the_way', 'gps'), /source-gps/);
  assert.match(riderMarkerClass('preparing', 'simulation'), /preparing/);

  const icon = createRiderIcon({ divIcon: (options) => options }, { status: 'on_the_way', source: 'gps', heading: 95 });
  assert.match(icon.html, /lt-rider-helmet-core/);
  assert.match(icon.html, /lt-rider-marker-halo/);
  assert.match(icon.html, /lt-rider-helmet-icon/);
  assert.match(icon.html, /--heading:95deg/);
  assert.deepEqual(icon.iconSize, [52, 52]);
  assert.deepEqual(icon.iconAnchor, [26, 34]);
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
});

test('map renders only the real rider marker (no route/store/client) and reuses it', async () => {
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
  const { shell } = createMapShell('LT-MAP-1');
  const { calls, restore } = installLeafletStub();

  try {
    renderMapViews({ querySelectorAll: () => [shell] });
    await waitForMapFrame();
    assert.equal(calls.map, 1);
    // Mapa honesto: SÓLO el marcador del rider real. Sin marcador de local (LT),
    // sin marcador de cliente (CL) y sin polyline de ruta.
    assert.equal(calls.marker, 1);

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

    assert.equal(calls.map, 1);
    assert.equal(calls.marker, 1);
    assert.ok(calls.setLatLng >= 1);
  } finally {
    disposeMapViews({ querySelectorAll: () => [shell] });
    restore();
  }
});

test('rider map uses the light commercial tile theme', async () => {
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
  const { shell } = createMapShell('LT-MAP-RIDER-LIGHT', { role: 'rider' });
  const { calls, restore } = installLeafletStub();

  try {
    renderMapViews({ querySelectorAll: () => [shell] });
    await waitForMapFrame();
    assert.equal(shell.dataset.mapTheme, 'light');
    assert.match(calls.tileUrls[0], /cartocdn\.com\/light_all/);
    assert.equal(calls.marker, 1);
  } finally {
    disposeMapViews({ querySelectorAll: () => [shell] });
    restore();
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
  const { shell } = createMapShell('LT-MAP-2');
  const { calls, restore } = installLeafletStub();

  try {
    renderMapViews({ querySelectorAll: () => [shell] });
    await waitForMapFrame();
    assert.equal(calls.marker, 0);
  } finally {
    disposeMapViews({ querySelectorAll: () => [shell] });
    restore();
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
    items: [{ productId: 'p-vacio', name: 'Vacio', icon: '', quantity: 1, unitPrice: 11200, unit: 'kg' }],
    statusHistory: [{ status: 'received', at: new Date().toISOString() }],
    delivery: { driverName: 'Juli', driverPhone: '2991112233', estimatedMinutes: 14, currentLocationLabel: 'En camino' },
  };
}

function createMapShell(orderId, { role = 'tracking' } = {}) {
  const meta = { textContent: '' };
  const fallback = {
    setAttribute() {},
    removeAttribute() {},
  };
  const canvas = {};
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
  return { shell, meta, fallback, canvas };
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

function installLeafletStub() {
  const originalL = globalThis.L;
  const calls = { map: 0, marker: 0, setLatLng: 0, tileUrls: [] };
  class FakeMarker {
    constructor(latLng, options = {}) {
      calls.marker += 1;
      this.latLng = normalizeLatLng(latLng);
      this.options = options;
      this.element = {
        className: options.icon?.className || '',
        querySelector: () => ({ style: { setProperty() {} } }),
      };
    }
    addTo() { return this; }
    getLatLng() { return this.latLng; }
    setLatLng(next) {
      calls.setLatLng += 1;
      this.latLng = normalizeLatLng(next);
    }
    setIcon(icon) { this.options.icon = icon; }
    getElement() { return this.element; }
  }
  class FakeLine {
    constructor(points) { this.points = points; }
    addTo() { return this; }
    setLatLngs(points) { this.points = points; }
  }
  globalThis.L = {
    map() {
      calls.map += 1;
      return {
        fitBounds() {},
        invalidateSize() {},
        on() {},
        remove() {},
        removeLayer() {},
        getBounds: () => ({ pad() { return this; }, contains: () => true }),
        panTo() {},
      };
    },
    tileLayer: (url) => {
      calls.tileUrls.push(url);
      return { addTo() { return this; } };
    },
    control: { zoom: () => ({ addTo() { return this; } }) },
    polyline: (points) => new FakeLine(points),
    marker: (latLng, options) => new FakeMarker(latLng, options),
    divIcon: (options) => options,
    latLng: (lat, lng) => ({ lat, lng }),
  };
  return {
    calls,
    restore() {
      if (originalL) globalThis.L = originalL;
      else delete globalThis.L;
    },
  };
}

function normalizeLatLng(value) {
  if (Array.isArray(value)) return { lat: value[0], lng: value[1] };
  return value;
}

function waitForMapFrame() {
  return new Promise((resolve) => setTimeout(resolve, 5));
}
