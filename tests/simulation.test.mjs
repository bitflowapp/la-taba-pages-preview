import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceSimulation,
  clampProgress,
  createSimulationState,
  nextProgress,
  progressToEta,
  simulationProgressPercent,
} from '../js/core/simulation.js';
import { hydrateState } from '../js/state.js';

test('clampProgress keeps values within 0..1', () => {
  assert.equal(clampProgress(-1), 0);
  assert.equal(clampProgress(0.42), 0.42);
  assert.equal(clampProgress(2), 1);
  assert.equal(clampProgress('nope'), 0);
});

test('nextProgress advances and never exceeds 1', () => {
  const advanced = nextProgress(0, 1200, 24000);
  assert.ok(advanced > 0 && advanced < 1);
  assert.equal(nextProgress(0.99, 24000, 24000), 1);
});

test('progressToEta scales the base ETA down with progress', () => {
  assert.equal(progressToEta(0, 20), 20);
  assert.equal(progressToEta(0.5, 20), 10);
  assert.equal(progressToEta(1, 20), 0);
});

test('createSimulationState seeds a coherent state for a delivery order', () => {
  const sim = createSimulationState({
    id: 'LT-9001',
    status: 'on_the_way',
    deliveryMode: 'delivery',
    delivery: { estimatedMinutes: 18 },
  });
  assert.equal(sim.orderId, 'LT-9001');
  assert.equal(sim.running, true);
  assert.equal(sim.baseEta, 18);
  assert.ok(sim.progress > 0 && sim.progress < 1);
  assert.ok(Number.isFinite(sim.lat) && Number.isFinite(sim.lng));
});

test('advanceSimulation stops when the route is complete', () => {
  const start = { orderId: 'LT-9002', running: true, mode: 'demo', progress: 0.98, baseEta: 12, etaMinutes: 1 };
  const { simulation, reachedEnd } = advanceSimulation(start, 24000);
  assert.equal(reachedEnd, true);
  assert.equal(simulation.progress, 1);
  assert.equal(simulation.running, false);
  assert.equal(simulation.etaMinutes, 0);
  assert.equal(simulationProgressPercent(simulation), 100);
});

test('hydrateState keeps a simulation only for an active delivery order', () => {
  const baseOrder = {
    id: 'LT-9100',
    customerName: 'Cliente',
    customerPhone: '2990000000',
    address: 'Roca 123',
    deliveryMode: 'delivery',
    paymentMethod: 'Efectivo',
    notes: '',
    createdAt: new Date().toISOString(),
    status: 'on_the_way',
    items: [{ productId: 'p-vacio', name: 'Vacío', icon: '', quantity: 1, unitPrice: 11200, unit: 'kg' }],
    statusHistory: [{ status: 'received', at: new Date().toISOString() }],
    delivery: { driverName: 'Juli', driverPhone: '2991112233', estimatedMinutes: 14, currentLocationLabel: 'En camino' },
  };

  const kept = hydrateState({
    orders: [baseOrder],
    simulation: { orderId: 'LT-9100', running: true, mode: 'demo', progress: 0.4, baseEta: 14, etaMinutes: 8 },
  });
  assert.ok(kept.simulation);
  assert.equal(kept.simulation.orderId, 'LT-9100');
  assert.equal(kept.simulation.running, true);

  const droppedMissing = hydrateState({
    orders: [baseOrder],
    simulation: { orderId: 'LT-0000', running: true, progress: 0.4 },
  });
  assert.equal(droppedMissing.simulation, null);

  const droppedDelivered = hydrateState({
    orders: [{ ...baseOrder, status: 'delivered' }],
    simulation: { orderId: 'LT-9100', running: true, progress: 0.9 },
  });
  assert.equal(droppedDelivered.simulation, null);
});
