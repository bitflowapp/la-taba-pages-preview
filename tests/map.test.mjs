import assert from 'node:assert/strict';
import test from 'node:test';
import { canUseLeaflet } from '../js/map/map_view.js';
import { riderMarkerClass } from '../js/map/rider_marker.js';
import {
  distanceKm,
  getRoute,
  normalizeRiderLocation,
  pointOnRoute,
  routeDistanceKm,
  selectRouteForOrder,
} from '../js/map/route_geometry.js';

test('route selection covers Neuquén and Cipolletti demo routes', () => {
  assert.equal(selectRouteForOrder({ address: 'Roca 123, Neuquén' }).id, 'neuquen');
  assert.equal(selectRouteForOrder({ address: 'Cipolletti centro' }).id, 'cipolletti');
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

test('rider marker class reflects status and source', () => {
  assert.match(riderMarkerClass('on_the_way', 'gps'), /on-the-way/);
  assert.match(riderMarkerClass('on_the_way', 'gps'), /source-gps/);
  assert.match(riderMarkerClass('preparing', 'simulation'), /preparing/);
});

