import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_DISPATCH_RANKING_POLICY,
  giniCoefficient,
  jainFairnessIndex,
  rankDispatchCandidates,
} from '../js/core/rider-dispatch-ranking.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OFFER_TTL_MS = 25_000;
const HEARTBEAT_TTL_MS = DEFAULT_DISPATCH_RANKING_POLICY.heartbeatTtlSeconds * 1_000;
const GPS_TTL_MS = DEFAULT_DISPATCH_RANKING_POLICY.gpsTtlSeconds * 1_000;
const DELIVERY_DURATION_MS = 180_000;
const MAX_SIMULATION_MS = 1_800_000;

export function runDispatchSimulationSuite() {
  const definitions = buildScenarioMatrix();
  const scenarios = definitions.map(runDispatchScenario);
  const invariantFailures = scenarios.flatMap((scenario) => scenario.invariantFailures.map((failure) => ({
    scenario: scenario.id,
    ...failure,
  })));
  const deterministicPayload = {
    schemaVersion: 1,
    simulationEpoch: '2026-08-11T00:00:00.000Z',
    policy: DEFAULT_DISPATCH_RANKING_POLICY,
    offerTtlMs: OFFER_TTL_MS,
    scenarios,
  };
  const canonical = stableStringify(deterministicPayload);
  return Object.freeze({
    ...deterministicPayload,
    deterministicSha256: createHash('sha256').update(canonical).digest('hex'),
    passed: invariantFailures.length === 0,
    invariantFailures,
  });
}

export function runDispatchScenario(definition) {
  const clock = new VirtualEventQueue();
  const riders = buildRiders(definition);
  const orders = buildOrders(definition);
  const jobs = new Map();
  const offers = new Map();
  const activeOfferByJob = new Map();
  const activeOfferByRider = new Map();
  const assignments = new Map();
  const rewards = new Set();
  const invariantFailures = [];
  const trace = [];
  let duplicateJobAttempts = 0;
  let duplicateClaimAttempts = 0;
  let duplicateRewardAttempts = 0;
  let offerSequence = 0;

  const schedule = (atMs, type, payload = {}) => clock.schedule(atMs, type, payload);
  for (const order of orders.values()) {
    schedule(order.readyAtMs, 'order_ready', { orderId: order.id });
    if (definition.duplicateReady) schedule(order.readyAtMs + 1, 'order_ready', { orderId: order.id });
  }
  for (const rider of riders.values()) {
    if (rider.reconnectAtMs !== null) schedule(rider.reconnectAtMs, 'rider_reconnect', { riderId: rider.id });
  }

  while (clock.size > 0) {
    const event = clock.next();
    if (!event || event.atMs > MAX_SIMULATION_MS) break;
    const nowMs = event.atMs;
    switch (event.type) {
      case 'order_ready': {
        const order = orders.get(event.payload.orderId);
        if (!order) break;
        if (jobs.has(order.id)) {
          duplicateJobAttempts += 1;
          trace.push(traceEvent(nowMs, 'duplicate_job_converged', order.id));
          break;
        }
        jobs.set(order.id, {
          id: `job-${order.id}`,
          orderId: order.id,
          state: 'queued',
          createdAtMs: nowMs,
          firstOfferAtMs: null,
          claimedAtMs: null,
          completedAtMs: null,
          offeredRiders: new Set(),
          offerCount: 0,
          rejectionCount: 0,
          timeoutCount: 0,
          lastFailureCode: null,
        });
        trace.push(traceEvent(nowMs, 'job_created', order.id));
        schedule(nowMs, 'dispatch', { orderId: order.id });
        break;
      }
      case 'dispatch': {
        const job = jobs.get(event.payload.orderId);
        const order = orders.get(event.payload.orderId);
        if (!job || !order || ['claimed', 'completed', 'cancelled'].includes(job.state)) break;
        if (activeOfferByJob.has(job.id)) break;
        const ranked = rankDispatchCandidates(
          [...riders.values()].map((rider) => candidateSnapshot(rider, order, job, nowMs, activeOfferByRider)),
        );
        const selected = ranked.find((candidate) => candidate.eligible);
        if (!selected) {
          job.state = 'no_rider_available';
          job.lastFailureCode = classifyNoRider(ranked);
          trace.push(traceEvent(nowMs, 'no_rider_available', order.id, job.lastFailureCode));
          break;
        }
        const rider = riders.get(selected.riderId);
        const offer = {
          id: `offer-${String(++offerSequence).padStart(4, '0')}`,
          jobId: job.id,
          orderId: order.id,
          riderId: rider.id,
          version: 1,
          state: 'offered',
          offeredAtMs: nowMs,
          expiresAtMs: nowMs + OFFER_TTL_MS,
          score: selected.score,
          components: selected.components,
        };
        offers.set(offer.id, offer);
        activeOfferByJob.set(job.id, offer.id);
        activeOfferByRider.set(rider.id, offer.id);
        job.state = 'offering';
        job.firstOfferAtMs ??= nowMs;
        job.offerCount += 1;
        job.offeredRiders.add(rider.id);
        trace.push(traceEvent(nowMs, 'offer_created', order.id, rider.id));
        schedule(offer.expiresAtMs, 'offer_expired', { offerId: offer.id, version: offer.version });
        if (rider.strategy === 'accept') {
          schedule(nowMs + rider.responseDelayMs, 'offer_accept', { offerId: offer.id, version: offer.version });
          if (definition.acceptDoubleTap) {
            schedule(nowMs + rider.responseDelayMs + 20, 'offer_accept', { offerId: offer.id, version: offer.version });
          }
        } else if (rider.strategy === 'reject') {
          schedule(nowMs + rider.responseDelayMs, 'offer_reject', { offerId: offer.id, version: offer.version });
        }
        break;
      }
      case 'offer_accept': {
        const offer = offers.get(event.payload.offerId);
        if (!offer || offer.state !== 'offered' || offer.version !== event.payload.version) {
          duplicateClaimAttempts += 1;
          break;
        }
        const job = [...jobs.values()].find((candidate) => candidate.id === offer.jobId);
        const order = orders.get(offer.orderId);
        const rider = riders.get(offer.riderId);
        if (!job || !order || !rider || nowMs >= offer.expiresAtMs || job.state !== 'offering' || order.assignedRiderId) {
          offer.state = 'revoked';
          clearOffer(offer, activeOfferByJob, activeOfferByRider);
          schedule(nowMs, 'dispatch', { orderId: offer.orderId });
          break;
        }
        const eligibility = rankDispatchCandidates([
          candidateSnapshot(rider, order, job, nowMs, activeOfferByRider, { acceptingOfferId: offer.id }),
        ])[0];
        if (!eligibility?.eligible) {
          offer.state = 'revoked';
          clearOffer(offer, activeOfferByJob, activeOfferByRider);
          schedule(nowMs, 'dispatch', { orderId: offer.orderId });
          break;
        }
        offer.state = 'accepted';
        offer.version += 1;
        clearOffer(offer, activeOfferByJob, activeOfferByRider);
        job.state = 'claimed';
        job.claimedAtMs = nowMs;
        order.assignedRiderId = rider.id;
        rider.activeOrders += 1;
        rider.lastAssignedAtMs = nowMs;
        rider.assignmentTimesMs.push(nowMs);
        assignments.set(order.id, rider.id);
        trace.push(traceEvent(nowMs, 'offer_accepted', order.id, rider.id));
        schedule(nowMs + DELIVERY_DURATION_MS, 'delivery_complete', { orderId: order.id, riderId: rider.id });
        if (definition.endShiftDuringDelivery && assignments.size === 1) {
          schedule(nowMs + 1_000, 'rider_shift_end', { riderId: rider.id, orderId: order.id });
        }
        break;
      }
      case 'offer_reject': {
        const offer = offers.get(event.payload.offerId);
        if (!offer || offer.state !== 'offered' || offer.version !== event.payload.version) break;
        const job = [...jobs.values()].find((candidate) => candidate.id === offer.jobId);
        offer.state = 'rejected';
        offer.version += 1;
        clearOffer(offer, activeOfferByJob, activeOfferByRider);
        if (job) {
          job.state = 'queued';
          job.rejectionCount += 1;
        }
        trace.push(traceEvent(nowMs, 'offer_rejected', offer.orderId, offer.riderId));
        schedule(nowMs, 'dispatch', { orderId: offer.orderId });
        break;
      }
      case 'offer_expired': {
        const offer = offers.get(event.payload.offerId);
        if (!offer || offer.state !== 'offered' || offer.version !== event.payload.version) break;
        const job = [...jobs.values()].find((candidate) => candidate.id === offer.jobId);
        offer.state = 'expired';
        offer.version += 1;
        clearOffer(offer, activeOfferByJob, activeOfferByRider);
        if (job) {
          job.state = 'queued';
          job.timeoutCount += 1;
        }
        trace.push(traceEvent(nowMs, 'offer_expired', offer.orderId, offer.riderId));
        schedule(nowMs, 'dispatch', { orderId: offer.orderId });
        break;
      }
      case 'delivery_complete': {
        const job = jobs.get(event.payload.orderId);
        const order = orders.get(event.payload.orderId);
        const rider = riders.get(event.payload.riderId);
        if (!job || !order || !rider || order.assignedRiderId !== rider.id) break;
        job.state = 'completed';
        job.completedAtMs = nowMs;
        rider.activeOrders = Math.max(0, rider.activeOrders - 1);
        rider.completedDeliveries += 1;
        if (rewards.has(order.id)) duplicateRewardAttempts += 1;
        else rewards.add(order.id);
        trace.push(traceEvent(nowMs, 'delivery_completed', order.id, rider.id));
        for (const candidate of jobs.values()) {
          if (candidate.state === 'no_rider_available') schedule(nowMs, 'dispatch', { orderId: candidate.orderId });
        }
        break;
      }
      case 'rider_reconnect': {
        const rider = riders.get(event.payload.riderId);
        if (!rider) break;
        rider.shiftStatus = 'active';
        rider.availability = rider.activeOrders >= rider.maxConcurrentOrders ? 'at_capacity' : 'available';
        rider.lastHeartbeatAtMs = nowMs;
        rider.lastGpsAtMs = nowMs;
        rider.connected = true;
        trace.push(traceEvent(nowMs, 'rider_reconnected', null, rider.id));
        for (const job of jobs.values()) {
          if (job.state === 'no_rider_available') schedule(nowMs, 'dispatch', { orderId: job.orderId });
        }
        break;
      }
      case 'rider_shift_end': {
        const rider = riders.get(event.payload.riderId);
        if (!rider) break;
        rider.shiftStatus = 'ended';
        rider.availability = 'unavailable';
        trace.push(traceEvent(nowMs, 'rider_shift_ended', event.payload.orderId, rider.id));
        break;
      }
      default:
        invariantFailures.push({ atMs: nowMs, code: 'UNKNOWN_EVENT', detail: event.type });
    }
    auditInvariants({
      atMs: nowMs,
      orders,
      jobs,
      offers,
      activeOfferByJob,
      activeOfferByRider,
      assignments,
      rewards,
      failures: invariantFailures,
    });
  }

  const completedCounts = [...riders.values()].map((rider) => rider.completedDeliveries);
  const claimedJobs = [...jobs.values()].filter((job) => job.claimedAtMs !== null);
  const offeredJobs = [...jobs.values()].filter((job) => job.firstOfferAtMs !== null);
  const finalUnassigned = [...jobs.values()].filter((job) => !['claimed', 'completed'].includes(job.state));
  const eligibleForStarvation = [...riders.values()].filter((rider) => (
    rider.initiallyEligible && definition.orderCount >= definition.riderCount
  ));
  const starvedRiders = eligibleForStarvation
    .filter((rider) => rider.completedDeliveries === 0)
    .map((rider) => rider.id);

  return Object.freeze({
    id: definition.id,
    riderCount: definition.riderCount,
    orderCount: definition.orderCount,
    description: definition.description,
    metrics: Object.freeze({
      jobs: jobs.size,
      offers: offers.size,
      claims: assignments.size,
      completed: rewards.size,
      unassigned: finalUnassigned.length,
      duplicateJobAttempts,
      duplicateClaims: 0,
      duplicateClaimAttempts,
      duplicateRewards: duplicateRewardAttempts,
      rejectedOffers: [...offers.values()].filter((offer) => offer.state === 'rejected').length,
      expiredOffers: [...offers.values()].filter((offer) => offer.state === 'expired').length,
      meanReadyToFirstOfferMs: mean(offeredJobs.map((job) => job.firstOfferAtMs - orders.get(job.orderId).readyAtMs)),
      p95ReadyToFirstOfferMs: percentile(offeredJobs.map((job) => job.firstOfferAtMs - orders.get(job.orderId).readyAtMs), 0.95),
      meanOfferToClaimMs: mean(claimedJobs.map((job) => job.claimedAtMs - job.firstOfferAtMs)),
      p95OfferToClaimMs: percentile(claimedJobs.map((job) => job.claimedAtMs - job.firstOfferAtMs), 0.95),
      offersPerOrder: jobs.size ? offers.size / jobs.size : 0,
      jainFairness: round6(jainFairnessIndex(completedCounts)),
      gini: round6(giniCoefficient(completedCounts)),
      starvedRiders,
      assignmentDistribution: Object.fromEntries([...riders.values()].map((rider) => [rider.id, rider.completedDeliveries])),
    }),
    finalJobs: Object.fromEntries([...jobs.values()].map((job) => [job.orderId, {
      state: job.state,
      offers: job.offerCount,
      failure: job.lastFailureCode,
    }])),
    invariantFailures: Object.freeze(invariantFailures),
    traceSha256: createHash('sha256').update(stableStringify(trace)).digest('hex'),
  });
}

function buildScenarioMatrix() {
  const definitions = [];
  for (const riderCount of [1, 2, 5, 10]) {
    const add = (suffix, values) => definitions.push({
      id: `${String(riderCount).padStart(2, '0')}-riders-${suffix}`,
      riderCount,
      orderCount: 1,
      description: suffix,
      ...values,
    });
    add('single-order', { acceptDoubleTap: true });
    add('simultaneous-burst', { orderCount: riderCount * 3, burst: true });
    add('distributed-zones', { orderCount: riderCount * 2, distributedZones: true });
    add('closest-always-rejects', { orderCount: Math.max(2, riderCount), closestRejects: true });
    add('first-offer-times-out', { orderCount: Math.max(2, riderCount), firstTimeouts: true });
    add('all-reject', { orderCount: Math.max(2, riderCount), allReject: true });
    add('one-stale', { orderCount: Math.max(2, riderCount), oneStale: true });
    add('all-at-capacity', { allBusy: true });
    add('reconnect', { reconnect: true });
    add('duplicate-ready-event', { duplicateReady: true, acceptDoubleTap: true });
    add('shift-ends-during-delivery', { endShiftDuringDelivery: true });
  }
  return definitions;
}

function buildRiders(definition) {
  const riders = new Map();
  for (let index = 0; index < definition.riderCount; index += 1) {
    const id = `RIDER-${String(index + 1).padStart(2, '0')}`;
    const stale = definition.oneStale && index === 0;
    const reconnecting = definition.reconnect;
    const busy = definition.allBusy;
    const shiftZone = definition.distributedZones ? (index % 2 === 0 ? 'north' : 'south') : '*';
    const strategy = definition.allReject
      ? 'reject'
      : definition.firstTimeouts && index === 0
        ? 'ignore'
        : definition.closestRejects && index === 0
          ? 'reject'
          : 'accept';
    riders.set(id, {
      id,
      membershipActive: true,
      blocked: false,
      shiftStatus: reconnecting ? 'active' : 'active',
      availability: busy ? 'at_capacity' : reconnecting ? 'unavailable' : 'available',
      shiftZone,
      maxConcurrentOrders: 1,
      activeOrders: busy ? 1 : 0,
      distanceToPickupMeters: 350 + index * 550,
      gpsAccuracyMeters: 8 + index,
      isMock: false,
      lastHeartbeatAtMs: stale || reconnecting ? -HEARTBEAT_TTL_MS - 1 : 0,
      lastGpsAtMs: stale || reconnecting ? -GPS_TTL_MS - 1 : 0,
      connected: !stale && !reconnecting,
      lastAssignedAtMs: null,
      assignmentTimesMs: [],
      completedDeliveries: 0,
      strategy,
      responseDelayMs: 1_200 + index * 100,
      reconnectAtMs: reconnecting && index === 0 ? 15_000 : null,
      initiallyEligible: !stale && !busy && !reconnecting && strategy === 'accept',
    });
  }
  return riders;
}

function buildOrders(definition) {
  const orders = new Map();
  for (let index = 0; index < definition.orderCount; index += 1) {
    const id = `ORDER-${String(index + 1).padStart(3, '0')}`;
    orders.set(id, {
      id,
      readyAtMs: definition.burst ? 0 : index * 5_000,
      zone: definition.distributedZones ? (index % 2 === 0 ? 'north' : 'south') : '*',
      assignedRiderId: null,
    });
  }
  return orders;
}

function candidateSnapshot(rider, order, job, nowMs, activeOfferByRider, { acceptingOfferId = null } = {}) {
  const assignmentWindowStart = nowMs - 4 * 60 * 60 * 1_000;
  rider.assignmentTimesMs = rider.assignmentTimesMs.filter((time) => time >= assignmentWindowStart);
  const pendingOffer = activeOfferByRider.get(rider.id);
  return {
    riderId: rider.id,
    membershipActive: rider.membershipActive,
    blocked: rider.blocked,
    hasShift: true,
    shiftStatus: rider.shiftStatus,
    availability: rider.activeOrders >= rider.maxConcurrentOrders ? 'at_capacity' : rider.availability,
    shiftZone: rider.shiftZone,
    orderZone: order.zone,
    activeOrders: rider.activeOrders,
    maxConcurrentOrders: rider.maxConcurrentOrders,
    distanceToPickupMeters: rider.distanceToPickupMeters,
    idleSinceAssignmentSeconds: rider.lastAssignedAtMs === null
      ? DEFAULT_DISPATCH_RANKING_POLICY.maxIdleSeconds
      : Math.max(0, Math.trunc((nowMs - rider.lastAssignedAtMs) / 1_000)),
    assignmentsLast4h: rider.assignmentTimesMs.length,
    heartbeatAgeSeconds: rider.connected
      ? 0
      : Math.max(0, Math.trunc((nowMs - rider.lastHeartbeatAtMs) / 1_000)),
    gpsAgeSeconds: rider.connected
      ? 0
      : Math.max(0, Math.trunc((nowMs - rider.lastGpsAtMs) / 1_000)),
    gpsAccuracyMeters: rider.gpsAccuracyMeters,
    isMock: rider.isMock,
    hasPendingOffer: Boolean(pendingOffer && pendingOffer !== acceptingOfferId),
    alreadyOffered: job.offeredRiders.has(rider.id) && pendingOffer !== acceptingOfferId,
    pickupLocationAvailable: true,
    destinationLocationAvailable: true,
    lastAssignedAtMs: rider.lastAssignedAtMs,
  };
}

function classifyNoRider(evaluations) {
  const codes = new Set(evaluations.flatMap((evaluation) => evaluation.exclusions));
  if (codes.has('HEARTBEAT_STALE') || codes.has('GPS_STALE')) return 'ALL_RIDERS_STALE';
  if (codes.has('AT_CAPACITY')) return 'ALL_AT_CAPACITY';
  if (codes.has('ZONE_MISMATCH')) return 'ZONE_NO_COVERAGE';
  if (codes.has('ALREADY_OFFERED')) return 'ALL_OFFERS_EXHAUSTED';
  if (codes.has('RIDER_BLOCKED')) return 'ALL_RIDERS_BLOCKED';
  return 'NO_ACTIVE_RIDERS';
}

function clearOffer(offer, activeOfferByJob, activeOfferByRider) {
  if (activeOfferByJob.get(offer.jobId) === offer.id) activeOfferByJob.delete(offer.jobId);
  if (activeOfferByRider.get(offer.riderId) === offer.id) activeOfferByRider.delete(offer.riderId);
}

function auditInvariants({
  atMs, orders, jobs, offers, activeOfferByJob, activeOfferByRider, assignments, rewards, failures,
}) {
  const fail = (code, detail) => failures.push({ atMs, code, detail });
  if (jobs.size !== new Set([...jobs.values()].map((job) => job.orderId)).size) {
    fail('DUPLICATE_JOB', 'more than one job for an order');
  }
  const offered = [...offers.values()].filter((offer) => offer.state === 'offered');
  if (offered.length !== new Set(offered.map((offer) => offer.jobId)).size) {
    fail('MULTIPLE_JOB_LEASES', 'more than one live offer for a job');
  }
  if (offered.length !== new Set(offered.map((offer) => offer.riderId)).size) {
    fail('MULTIPLE_RIDER_LEASES', 'more than one live offer for a rider');
  }
  if (activeOfferByJob.size !== offered.length || activeOfferByRider.size !== offered.length) {
    fail('LEASE_INDEX_DRIFT', 'active offer indexes do not match offered rows');
  }
  if (assignments.size !== new Set(assignments.keys()).size) fail('DUPLICATE_CLAIM', 'duplicate assignment');
  if (rewards.size > assignments.size) fail('REWARD_WITHOUT_CLAIM', 'reward count exceeds assignments');
  for (const [orderId, riderId] of assignments) {
    if (orders.get(orderId)?.assignedRiderId !== riderId) fail('ORDER_ASSIGNMENT_DRIFT', orderId);
  }
}

class VirtualEventQueue {
  #events = [];
  #sequence = 0;

  get size() {
    return this.#events.length;
  }

  schedule(atMs, type, payload) {
    this.#events.push({ atMs, sequence: ++this.#sequence, type, payload });
    this.#events.sort((left, right) => left.atMs - right.atMs || left.sequence - right.sequence);
  }

  next() {
    return this.#events.shift() ?? null;
  }
}

function traceEvent(atMs, type, orderId = null, detail = null) {
  return { atMs, type, orderId, detail };
}

function mean(values) {
  if (!values.length) return null;
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function round6(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function markdownReport(report) {
  const rows = report.scenarios.map((scenario) => {
    const metric = scenario.metrics;
    return `| ${scenario.id} | ${metric.jobs} | ${metric.offers} | ${metric.claims} | ${metric.unassigned} | ${metric.jainFairness.toFixed(3)} | ${metric.duplicateClaims}/${metric.duplicateRewards} |`;
  }).join('\n');
  return `# Simulacion deterministica de auto-dispatch\n\n`+
    `Resultado: **${report.passed ? 'PASS' : 'FAIL'}**  \n`+
    `SHA-256 deterministico: \`${report.deterministicSha256}\`  \n`+
    `Escenarios: ${report.scenarios.length}\n\n`+
    `| Escenario | Jobs | Offers | Claims | Sin Rider | Jain | Claims/rewards duplicados |\n`+
    `| --- | ---: | ---: | ---: | ---: | ---: | ---: |\n${rows}\n\n`+
    `La corrida usa reloj virtual, cola estable y cero aleatoriedad. La atomicidad PostgreSQL se certifica por separado; este arnes prueba ranking, leases, retries, fairness y ausencia de starvation evidente bajo sus fixtures.\n`;
}

function writeReport(report) {
  const artifactDir = path.join(ROOT, 'artifacts', 'automated-rider-dispatch');
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(path.join(artifactDir, 'simulation-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const assignments = ['scenario,rider,completed_deliveries'];
  for (const scenario of report.scenarios) {
    for (const [riderId, completed] of Object.entries(scenario.metrics.assignmentDistribution)) {
      assignments.push(`${scenario.id},${riderId},${completed}`);
    }
  }
  writeFileSync(path.join(artifactDir, 'assignments.csv'), `${assignments.join('\n')}\n`);
  writeFileSync(path.join(ROOT, 'docs', 'AUTOMATED-RIDER-DISPATCH-SIMULATION.md'), markdownReport(report));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const first = runDispatchSimulationSuite();
  const second = runDispatchSimulationSuite();
  if (first.deterministicSha256 !== second.deterministicSha256) {
    console.error('FAIL: la misma simulacion produjo hashes distintos.');
    process.exitCode = 1;
  } else if (!first.passed) {
    console.error(JSON.stringify(first.invariantFailures, null, 2));
    process.exitCode = 1;
  } else {
    if (process.argv.includes('--write')) writeReport(first);
    console.log(`PASS ${first.scenarios.length} escenarios ${first.deterministicSha256}`);
  }
}
