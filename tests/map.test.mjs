import assert from 'node:assert/strict';
import test from 'node:test';
import { canUseLeaflet } from '../js/map/map_view.js';
import { getMapTheme, getTileLayerForTheme } from '../js/map/map_config.js';
import { riderMarkerClass } from '../js/map/rider_marker.js';
import {
  chooseRiderLocation,
  distanceKm,
  getRoute,
  getStreetTestDestination,
  getStreetTestDestinations,
  isLocationStale,
  normalizeRiderLocation,
  pointOnRoute,
  routeDistanceKm,
  selectRouteForOrder,
} from '../js/map/route_geometry.js';

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
});

test('chooseRiderLocation prioriza GPS real sobre simulación', () => {
  const sim = { lat: -38.95, lng: -68.05, source: 'simulation', timestamp: 2000 };
  const trackedGps = { lat: -38.94, lng: -68.04, source: 'gps', timestamp: 1000 };
  // Aunque el fix GPS sea más viejo, gana por ser ubicación real.
  const chosen = chooseRiderLocation(sim, trackedGps);
  assert.equal(chosen.source, 'gps');
  assert.equal(chosen.lat, -38.94);
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

test('isLocationStale marca como vieja una ubicación pasada el umbral', () => {
  const now = 1_000_000;
  assert.equal(isLocationStale({ timestamp: now - 5_000 }, 30_000, now), false);
  assert.equal(isLocationStale({ timestamp: now - 60_000 }, 30_000, now), true);
  assert.equal(isLocationStale(null, 30_000, now), true);
  assert.equal(isLocationStale({}, 30_000, now), true);
});
