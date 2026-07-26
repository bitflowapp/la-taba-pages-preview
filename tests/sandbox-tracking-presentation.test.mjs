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
    origin: 'local_gps', source: 'gps', running: true, progress: 0.4, etaMinutes: 11,
  });
  assert.equal(view.source, 'local_gps');
  assert.equal(view.activityLabel, 'Ubicación activa');
  assert.equal(view.showEta, false);
  assert.equal(view.canPause, false);
});
