import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateDispatchCandidate,
  giniCoefficient,
  jainFairnessIndex,
  rankDispatchCandidates,
  selectDispatchCandidate,
} from '../js/core/rider-dispatch-ranking.js';

function candidate(overrides = {}) {
  return {
    riderId: 'rider-a',
    membershipActive: true,
    blocked: false,
    hasShift: true,
    shiftStatus: 'active',
    availability: 'available',
    shiftZone: 'centro',
    orderZone: 'centro',
    activeOrders: 0,
    maxConcurrentOrders: 1,
    distanceToPickupMeters: 1_000,
    idleSinceAssignmentSeconds: 3_600,
    assignmentsLast4h: 0,
    heartbeatAgeSeconds: 5,
    gpsAgeSeconds: 7,
    gpsAccuracyMeters: 12,
    isMock: false,
    hasPendingOffer: false,
    alreadyOffered: false,
    pickupLocationAvailable: true,
    destinationLocationAvailable: true,
    lastAssignedAtMs: null,
    ...overrides,
  };
}

test('ranking produces an explainable integer score', () => {
  const result = evaluateDispatchCandidate(candidate());

  assert.equal(result.eligible, true);
  assert.equal(result.score, 100_058);
  assert.deepEqual(result.exclusions, []);
  assert.equal(result.components.distancePenalty, 20);
  assert.equal(result.components.idleCredit, 90);
  assert.equal(result.components.heartbeatPenalty, 5);
  assert.equal(result.components.gpsPenalty, 7);
});

test('eligibility fails closed for shift, freshness, zone, capacity, offer and location gates', () => {
  const result = evaluateDispatchCandidate(candidate({
    shiftStatus: 'paused',
    heartbeatAgeSeconds: 91,
    gpsAgeSeconds: 121,
    gpsAccuracyMeters: 151,
    orderZone: 'norte',
    activeOrders: 1,
    hasPendingOffer: true,
    alreadyOffered: true,
    pickupLocationAvailable: false,
    destinationLocationAvailable: false,
  }));

  assert.equal(result.eligible, false);
  assert.deepEqual(result.exclusions, [
    'PAUSED_OR_ENDED',
    'HEARTBEAT_STALE',
    'GPS_STALE',
    'GPS_INACCURATE',
    'ZONE_MISMATCH',
    'AT_CAPACITY',
    'OFFER_ALREADY_PENDING',
    'ALREADY_OFFERED',
    'PICKUP_LOCATION_UNAVAILABLE',
    'DESTINATION_LOCATION_UNAVAILABLE',
  ]);
});

test('ranking is deterministic and uses never-assigned then rider id as stable tie breakers', () => {
  const ranked = rankDispatchCandidates([
    candidate({ riderId: 'rider-c', lastAssignedAtMs: 100 }),
    candidate({ riderId: 'rider-b', lastAssignedAtMs: null }),
    candidate({ riderId: 'rider-a', lastAssignedAtMs: null }),
  ]);

  assert.deepEqual(ranked.map((entry) => entry.riderId), ['rider-a', 'rider-b', 'rider-c']);
  assert.deepEqual(ranked.map((entry) => entry.rank), [1, 2, 3]);
  assert.equal(selectDispatchCandidate(ranked.map((entry) => candidate({ riderId: entry.riderId }))).riderId, 'rider-a');
});

test('load and recent assignments can outweigh a small distance advantage', () => {
  const selected = selectDispatchCandidate([
    candidate({ riderId: 'near-busy', distanceToPickupMeters: 100, assignmentsLast4h: 4 }),
    candidate({ riderId: 'far-idle', distanceToPickupMeters: 2_000, idleSinceAssignmentSeconds: 10_800 }),
  ]);

  assert.equal(selected.riderId, 'far-idle');
});

test('fairness metrics handle zero work and known distributions', () => {
  assert.equal(jainFairnessIndex([]), 1);
  assert.equal(jainFairnessIndex([0, 0]), 1);
  assert.equal(jainFairnessIndex([2, 2, 2]), 1);
  assert.equal(jainFairnessIndex([3, 0]), 0.5);
  assert.equal(giniCoefficient([]), 0);
  assert.equal(giniCoefficient([0, 0]), 0);
  assert.equal(giniCoefficient([2, 2, 2]), 0);
  assert.equal(giniCoefficient([3, 0]), 0.5);
});
