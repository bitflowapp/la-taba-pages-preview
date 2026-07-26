import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getSandboxMapScenario,
  sandboxMarkerPointAtProgress,
  sandboxPointAtProgress,
} from '../js/sandbox/sandbox_map_scenario.js';

test('sandbox map stays inside the fictitious Neuquén scenario', () => {
  const scenario = getSandboxMapScenario();
  assert.equal(scenario.city, 'Neuquén Capital');
  assert.equal(scenario.route[0].id, scenario.store.id);
  assert.equal(scenario.route.at(-1).id, scenario.destination.id);
  for (const point of scenario.route) {
    assert.ok(point.lat > -39 && point.lat < -38);
    assert.ok(point.lng > -69 && point.lng < -67);
  }
});

test('sandbox marker stays visibly separated from store and destination pins at route endpoints', () => {
  const scenario = getSandboxMapScenario();
  const start = sandboxMarkerPointAtProgress(0);
  const end = sandboxMarkerPointAtProgress(1);
  assert.equal(start.visualOffset, true);
  assert.equal(end.visualOffset, true);
  assert.notDeepEqual([start.lat, start.lng], [scenario.store.lat, scenario.store.lng]);
  assert.notDeepEqual([end.lat, end.lng], [scenario.destination.lat, scenario.destination.lng]);
});

test('sandbox route interpolation returns geographic rider positions', () => {
  const scenario = getSandboxMapScenario();
  const start = sandboxPointAtProgress(0);
  const middle = sandboxPointAtProgress(0.5);
  const end = sandboxPointAtProgress(1);
  assert.equal(start.source, 'sandbox_route');
  assert.equal(end.lat, scenario.destination.lat);
  assert.equal(end.lng, scenario.destination.lng);
  assert.notDeepEqual(start, middle);
  assert.notDeepEqual(middle, end);
  assert.ok(Number.isFinite(middle.heading));
});
