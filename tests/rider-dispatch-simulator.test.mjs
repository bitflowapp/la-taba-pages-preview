import assert from 'node:assert/strict';
import test from 'node:test';

import { runDispatchSimulationSuite } from '../scripts/simulate-rider-dispatch.mjs';

test('dispatch matrix is deterministic and satisfies every invariant', () => {
  const first = runDispatchSimulationSuite();
  const second = runDispatchSimulationSuite();

  assert.equal(first.scenarios.length, 44);
  assert.equal(first.passed, true);
  assert.deepEqual(first.invariantFailures, []);
  assert.equal(first.deterministicSha256, second.deterministicSha256);
  assert.deepEqual(first, second);
});

test('duplicate events and double taps converge without duplicate claims or rewards', () => {
  const report = runDispatchSimulationSuite();
  const duplicateScenarios = report.scenarios.filter((scenario) => scenario.id.endsWith('duplicate-ready-event'));

  assert.equal(duplicateScenarios.length, 4);
  for (const scenario of duplicateScenarios) {
    assert.equal(scenario.metrics.duplicateJobAttempts, 1);
    assert.equal(scenario.metrics.duplicateClaimAttempts, 1);
    assert.equal(scenario.metrics.duplicateClaims, 0);
    assert.equal(scenario.metrics.duplicateRewards, 0);
    assert.equal(scenario.metrics.claims, 1);
    assert.equal(scenario.metrics.completed, 1);
  }
});

test('burst scenarios drain with capacity one and do not starve eligible riders', () => {
  const report = runDispatchSimulationSuite();
  const bursts = report.scenarios.filter((scenario) => scenario.id.endsWith('simultaneous-burst'));

  for (const scenario of bursts) {
    assert.equal(scenario.metrics.completed, scenario.orderCount);
    assert.equal(scenario.metrics.unassigned, 0);
    assert.deepEqual(scenario.metrics.starvedRiders, []);
    assert.ok(scenario.metrics.jainFairness >= 0.9);
  }
});

test('negative availability scenarios expose explicit blocking outcomes', () => {
  const report = runDispatchSimulationSuite();
  for (const scenario of report.scenarios.filter((entry) => entry.id.endsWith('all-at-capacity'))) {
    assert.equal(scenario.metrics.claims, 0);
    assert.equal(scenario.metrics.unassigned, 1);
    assert.equal(Object.values(scenario.finalJobs)[0].failure, 'ALL_AT_CAPACITY');
  }
  for (const scenario of report.scenarios.filter((entry) => entry.id.endsWith('reconnect'))) {
    assert.equal(scenario.metrics.completed, 1);
    assert.equal(scenario.metrics.unassigned, 0);
  }
});

test('leases expire and all-reject rounds terminate without looping or assigning', () => {
  const report = runDispatchSimulationSuite();
  for (const scenario of report.scenarios.filter((entry) => entry.id.endsWith('first-offer-times-out'))) {
    assert.ok(scenario.metrics.expiredOffers >= 1);
    assert.equal(scenario.metrics.duplicateClaims, 0);
  }
  for (const scenario of report.scenarios.filter((entry) => entry.id.endsWith('all-reject'))) {
    assert.equal(scenario.metrics.claims, 0);
    assert.equal(scenario.metrics.unassigned, scenario.orderCount);
    assert.ok(scenario.metrics.rejectedOffers >= scenario.riderCount);
    assert.ok(Object.values(scenario.finalJobs).every((job) => job.failure === 'ALL_OFFERS_EXHAUSTED'));
  }
});

test('ending a shift never abandons the delivery already accepted', () => {
  const report = runDispatchSimulationSuite();
  for (const scenario of report.scenarios.filter((entry) => entry.id.endsWith('shift-ends-during-delivery'))) {
    assert.equal(scenario.metrics.claims, 1);
    assert.equal(scenario.metrics.completed, 1);
    assert.equal(Object.values(scenario.finalJobs)[0].state, 'completed');
  }
});
