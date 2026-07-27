import assert from 'node:assert/strict';
import test from 'node:test';
import { sandboxTrackingPresentation } from '../js/core/sandbox-tracking-presentation.js';

test('tracking stays en camino while route progress is below 100 percent', () => {
  const view = sandboxTrackingPresentation({ status: 'on_the_way' }, {
    source: 'simulation', userStarted: true, running: true, progress: 0.56, etaMinutes: 8,
  });
  assert.equal(view.phaseLabel, 'En camino');
  assert.equal(view.progress, 56);
  assert.equal(view.etaLabel, '8 min');
  assert.equal(view.isActive, true);
  assert.equal(view.canStart, false);
});

test('leaving the store does not invent progress or ETA before the rider starts a route', () => {
  const view = sandboxTrackingPresentation({ status: 'on_the_way' }, {
    source: 'simulation', userStarted: false, running: false, progress: 0.08, etaMinutes: 11,
  });
  assert.equal(view.phaseLabel, 'En camino');
  assert.equal(view.activityLabel, 'Seguimiento por iniciar');
  assert.equal(view.progress, 0);
  assert.equal(view.showEta, false);
  assert.equal(view.etaLabel, 'Al iniciar');
  assert.equal(view.canStart, true);
  assert.equal(view.canReset, false);
});

test('arrival never renders 100 percent with en camino or zero minutes', () => {
  const view = sandboxTrackingPresentation({ status: 'on_the_way' }, {
    source: 'simulation', userStarted: true, running: false, progress: 1, etaMinutes: 0,
  });
  assert.equal(view.phaseLabel, 'Llegó al domicilio');
  assert.equal(view.activityLabel, 'Llegó al domicilio');
  assert.equal(view.progress, 100);
  assert.equal(view.etaLabel, 'Llegó');
  assert.equal(view.isActive, false);
  assert.equal(view.canStart, false);
  assert.equal(view.canReset, false);
});

test('paused and delivered tracking states are mutually exclusive and coherent', () => {
  const paused = sandboxTrackingPresentation({ status: 'on_the_way' }, {
    source: 'simulation', userStarted: true, running: false, progress: 0.2, etaMinutes: 16,
  });
  assert.equal(paused.activityLabel, 'Seguimiento pausado');
  assert.equal(paused.isActive, false);
  assert.equal(paused.canStart, true);

  const delivered = sandboxTrackingPresentation({ status: 'delivered' }, {
    source: 'simulation', userStarted: true, running: false, progress: 1, etaMinutes: 0,
  });
  assert.equal(delivered.phaseLabel, 'Entregado');
  assert.equal(delivered.showEta, false);
  assert.equal(delivered.etaLabel, '');
  assert.equal(delivered.canStart, false);
  assert.equal(delivered.canPause, false);
});

test('local GPS deliberately omits simulated ETA and exposes a live state', () => {
  const view = sandboxTrackingPresentation({ status: 'on_the_way' }, {
    origin: 'local_gps', source: 'gps', gpsStatus: 'active', lat: -38.95, lng: -68.06,
    running: true, progress: 0.4, etaMinutes: 11,
  });
  assert.equal(view.source, 'local_gps');
  assert.equal(view.activityLabel, 'Ubicación activa');
  assert.equal(view.showEta, false);
  assert.equal(view.canPause, false);
});

test('a denied GPS permission never renders as an active rider location', () => {
  const view = sandboxTrackingPresentation({ status: 'on_the_way' }, {
    origin: 'local_gps', source: 'simulation', mode: 'demo', gpsStatus: 'denied',
    userStarted: false, running: false, progress: 0, etaMinutes: 11,
  });
  assert.equal(view.gps, false);
  assert.equal(view.activityLabel, 'Seguimiento por iniciar');
  assert.equal(view.showEta, false);
  assert.equal(view.isActive, false);
  assert.equal(view.canStart, true);
});

test('a fresh paused GPS fix remains a clearly labelled snapshot', () => {
  const now = 1_000_000;
  const view = sandboxTrackingPresentation({ status: 'on_the_way' }, {
    origin: 'local_gps', source: 'gps', mode: 'gps', gpsStatus: 'last_fix', gpsPaused: true,
    lat: -38.95, lng: -68.06, timestamp: now - 5_000, running: false, progress: 0.4, etaMinutes: 11,
  }, { now });
  assert.equal(view.gps, true);
  assert.equal(view.gpsLive, false);
  assert.equal(view.gpsSnapshot, true);
  assert.equal(view.activityLabel, 'Última ubicación disponible');
  assert.equal(view.isActive, false);
  assert.equal(view.showEta, false);
});

test('a stale GPS fix never keeps an active location headline', () => {
  const now = 1_000_000;
  const view = sandboxTrackingPresentation({ status: 'on_the_way' }, {
    origin: 'local_gps', source: 'gps', mode: 'gps', gpsStatus: 'active',
    lat: -38.95, lng: -68.06, timestamp: now - 60_000, running: false,
  }, { now });
  assert.equal(view.gps, false);
  assert.equal(view.gpsStale, true);
  assert.equal(view.activityLabel, 'Ubicación no disponible');
  assert.equal(view.isActive, false);
});
