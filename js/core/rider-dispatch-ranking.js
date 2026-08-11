// Pure, deterministic mirror of the automated Rider dispatch ranking contract.
// Runtime authority lives in PostgreSQL; this module powers local simulation,
// explanation tests and reproducible operational drills.

export const DEFAULT_DISPATCH_RANKING_POLICY = Object.freeze({
  version: 1,
  baseScore: 100_000,
  maxDistanceMeters: 20_000,
  distanceDivisor: 50,
  loadPenalty: 250,
  maxIdleSeconds: 10_800,
  idleDivisor: 40,
  recentAssignmentPenalty: 60,
  heartbeatTtlSeconds: 90,
  gpsTtlSeconds: 120,
  maxGpsAccuracyMeters: 150,
});

export const DISPATCH_EXCLUSION_CODES = Object.freeze([
  'MEMBERSHIP_INACTIVE',
  'RIDER_BLOCKED',
  'NO_ACTIVE_SHIFT',
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

export function evaluateDispatchCandidate(candidate = {}, policy = DEFAULT_DISPATCH_RANKING_POLICY) {
  const normalized = normalizeCandidate(candidate);
  const effectivePolicy = normalizePolicy(policy);
  const exclusions = [];

  if (!normalized.membershipActive) exclusions.push('MEMBERSHIP_INACTIVE');
  if (normalized.blocked) exclusions.push('RIDER_BLOCKED');
  if (!normalized.hasShift) exclusions.push('NO_ACTIVE_SHIFT');
  else if (normalized.shiftStatus !== 'active' || normalized.availability !== 'available') {
    exclusions.push('PAUSED_OR_ENDED');
  }
  if (normalized.heartbeatAgeSeconds > effectivePolicy.heartbeatTtlSeconds) {
    exclusions.push('HEARTBEAT_STALE');
  }
  if (normalized.gpsAgeSeconds > effectivePolicy.gpsTtlSeconds) exclusions.push('GPS_STALE');
  if (
    !Number.isFinite(normalized.gpsAccuracyMeters)
    || normalized.gpsAccuracyMeters > effectivePolicy.maxGpsAccuracyMeters
    || normalized.isMock
  ) {
    exclusions.push('GPS_INACCURATE');
  }
  if (!zonesMatch(normalized.shiftZone, normalized.orderZone)) exclusions.push('ZONE_MISMATCH');
  if (normalized.activeOrders >= normalized.maxConcurrentOrders) exclusions.push('AT_CAPACITY');
  if (normalized.hasPendingOffer) exclusions.push('OFFER_ALREADY_PENDING');
  if (normalized.alreadyOffered) exclusions.push('ALREADY_OFFERED');
  if (!normalized.pickupLocationAvailable) exclusions.push('PICKUP_LOCATION_UNAVAILABLE');
  if (!normalized.destinationLocationAvailable) exclusions.push('DESTINATION_LOCATION_UNAVAILABLE');

  const components = scoreComponents(normalized, effectivePolicy);
  return Object.freeze({
    riderId: normalized.riderId,
    eligible: exclusions.length === 0,
    exclusions: Object.freeze(exclusions),
    score: components.score,
    components: Object.freeze(components),
    policyVersion: effectivePolicy.version,
    lastAssignedAtMs: normalized.lastAssignedAtMs,
  });
}

export function rankDispatchCandidates(candidates = [], policy = DEFAULT_DISPATCH_RANKING_POLICY) {
  const evaluations = candidates.map((candidate) => evaluateDispatchCandidate(candidate, policy));
  const eligible = evaluations.filter((evaluation) => evaluation.eligible).sort(compareEvaluations);
  const rankByRider = new Map(eligible.map((evaluation, index) => [evaluation.riderId, index + 1]));
  return evaluations
    .map((evaluation) => Object.freeze({ ...evaluation, rank: rankByRider.get(evaluation.riderId) ?? null }))
    .sort((left, right) => {
      if (left.rank !== null && right.rank !== null) return left.rank - right.rank;
      if (left.rank !== null) return -1;
      if (right.rank !== null) return 1;
      return left.riderId.localeCompare(right.riderId);
    });
}

export function selectDispatchCandidate(candidates = [], policy = DEFAULT_DISPATCH_RANKING_POLICY) {
  return rankDispatchCandidates(candidates, policy).find((candidate) => candidate.eligible) ?? null;
}

export function jainFairnessIndex(values = []) {
  const normalized = values.map(nonNegativeInteger);
  if (normalized.length === 0) return 1;
  const sum = normalized.reduce((total, value) => total + value, 0);
  if (sum === 0) return 1;
  const squares = normalized.reduce((total, value) => total + value * value, 0);
  return squares === 0 ? 1 : (sum * sum) / (normalized.length * squares);
}

export function giniCoefficient(values = []) {
  const normalized = values.map(nonNegativeInteger).sort((left, right) => left - right);
  if (normalized.length === 0) return 0;
  const sum = normalized.reduce((total, value) => total + value, 0);
  if (sum === 0) return 0;
  const weighted = normalized.reduce((total, value, index) => total + (index + 1) * value, 0);
  return (2 * weighted) / (normalized.length * sum) - (normalized.length + 1) / normalized.length;
}

function scoreComponents(candidate, policy) {
  const distancePenalty = Math.trunc(
    Math.min(candidate.distanceToPickupMeters, policy.maxDistanceMeters) / policy.distanceDivisor,
  );
  const loadPenalty = Math.round(
    policy.loadPenalty * candidate.activeOrders / candidate.maxConcurrentOrders,
  );
  const idleCredit = Math.trunc(
    Math.min(candidate.idleSinceAssignmentSeconds, policy.maxIdleSeconds) / policy.idleDivisor,
  );
  const recentAssignmentPenalty = policy.recentAssignmentPenalty * candidate.assignmentsLast4h;
  const heartbeatPenalty = Math.min(candidate.heartbeatAgeSeconds, policy.heartbeatTtlSeconds);
  const gpsPenalty = Math.min(candidate.gpsAgeSeconds, policy.gpsTtlSeconds);
  return {
    baseScore: policy.baseScore,
    distanceToPickupMeters: candidate.distanceToPickupMeters,
    distancePenalty,
    activeOrders: candidate.activeOrders,
    maxConcurrentOrders: candidate.maxConcurrentOrders,
    loadPenalty,
    idleSinceAssignmentSeconds: candidate.idleSinceAssignmentSeconds,
    idleCredit,
    assignmentsLast4h: candidate.assignmentsLast4h,
    recentAssignmentPenalty,
    heartbeatAgeSeconds: candidate.heartbeatAgeSeconds,
    heartbeatPenalty,
    gpsAgeSeconds: candidate.gpsAgeSeconds,
    gpsPenalty,
    score: policy.baseScore
      - distancePenalty
      - loadPenalty
      + idleCredit
      - recentAssignmentPenalty
      - heartbeatPenalty
      - gpsPenalty,
  };
}

function compareEvaluations(left, right) {
  if (left.score !== right.score) return right.score - left.score;
  if (left.lastAssignedAtMs === null && right.lastAssignedAtMs !== null) return -1;
  if (right.lastAssignedAtMs === null && left.lastAssignedAtMs !== null) return 1;
  if (left.lastAssignedAtMs !== right.lastAssignedAtMs) {
    return (left.lastAssignedAtMs ?? 0) - (right.lastAssignedAtMs ?? 0);
  }
  return left.riderId.localeCompare(right.riderId);
}

function normalizeCandidate(candidate) {
  const maxConcurrentOrders = Math.max(1, nonNegativeInteger(candidate.maxConcurrentOrders || 1));
  return {
    riderId: String(candidate.riderId || ''),
    membershipActive: candidate.membershipActive !== false,
    blocked: candidate.blocked === true,
    hasShift: candidate.hasShift !== false,
    shiftStatus: String(candidate.shiftStatus || 'active'),
    availability: String(candidate.availability || 'available'),
    shiftZone: normalizeZone(candidate.shiftZone),
    orderZone: normalizeZone(candidate.orderZone),
    activeOrders: Math.min(nonNegativeInteger(candidate.activeOrders), maxConcurrentOrders),
    maxConcurrentOrders,
    distanceToPickupMeters: nonNegativeInteger(candidate.distanceToPickupMeters),
    idleSinceAssignmentSeconds: nonNegativeInteger(
      candidate.idleSinceAssignmentSeconds ?? DEFAULT_DISPATCH_RANKING_POLICY.maxIdleSeconds,
    ),
    assignmentsLast4h: nonNegativeInteger(candidate.assignmentsLast4h),
    heartbeatAgeSeconds: nonNegativeInteger(candidate.heartbeatAgeSeconds),
    gpsAgeSeconds: nonNegativeInteger(candidate.gpsAgeSeconds),
    gpsAccuracyMeters: Number(candidate.gpsAccuracyMeters ?? 10),
    isMock: candidate.isMock === true,
    hasPendingOffer: candidate.hasPendingOffer === true,
    alreadyOffered: candidate.alreadyOffered === true,
    pickupLocationAvailable: candidate.pickupLocationAvailable !== false,
    destinationLocationAvailable: candidate.destinationLocationAvailable !== false,
    lastAssignedAtMs: candidate.lastAssignedAtMs !== null
      && candidate.lastAssignedAtMs !== undefined
      && Number.isFinite(Number(candidate.lastAssignedAtMs))
      ? Number(candidate.lastAssignedAtMs)
      : null,
  };
}

function normalizePolicy(policy) {
  const source = { ...DEFAULT_DISPATCH_RANKING_POLICY, ...(policy || {}) };
  return {
    version: Math.max(1, nonNegativeInteger(source.version)),
    baseScore: nonNegativeInteger(source.baseScore),
    maxDistanceMeters: Math.max(1, nonNegativeInteger(source.maxDistanceMeters)),
    distanceDivisor: Math.max(1, nonNegativeInteger(source.distanceDivisor)),
    loadPenalty: nonNegativeInteger(source.loadPenalty),
    maxIdleSeconds: Math.max(1, nonNegativeInteger(source.maxIdleSeconds)),
    idleDivisor: Math.max(1, nonNegativeInteger(source.idleDivisor)),
    recentAssignmentPenalty: nonNegativeInteger(source.recentAssignmentPenalty),
    heartbeatTtlSeconds: Math.max(1, nonNegativeInteger(source.heartbeatTtlSeconds)),
    gpsTtlSeconds: Math.max(1, nonNegativeInteger(source.gpsTtlSeconds)),
    maxGpsAccuracyMeters: Math.max(1, nonNegativeInteger(source.maxGpsAccuracyMeters)),
  };
}

function zonesMatch(shiftZone, orderZone) {
  return shiftZone === '*' || orderZone === '*' || shiftZone === orderZone;
}

function normalizeZone(value) {
  const normalized = String(value || '*').trim().toLowerCase();
  return normalized || '*';
}

function nonNegativeInteger(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : 0;
}
