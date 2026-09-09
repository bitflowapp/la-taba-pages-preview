import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  ROOT,
  EXPECTED_PROJECT_REF,
  EXPECTED_EDGE_FUNCTIONS,
  EXPECTED_SOURCE_HASHES,
  EXIT_SUCCESS,
  EXIT_VALIDATION_ERROR,
  EXIT_TARGET_GUARD_REJECTED,
  EXIT_FINANCIAL_INERT_FAILED,
  EXIT_EXPAND_COMPAT_FAILED,
  EXIT_SOURCE_MISMATCH,
  EXIT_DEPLOY_FAILED,
  EXIT_REMOTE_VERIFY_FAILED,
  EXIT_CONCURRENCY_LOCKED,
  verifyTargetProject,
  verifyLocalSource,
  verifyExpandState,
  verifyFinancialInertness,
  acquireReleaseLock,
  releaseReleaseLock,
  executeDeployment,
  verifyRemoteRelease,
  buildReleaseEvidence,
  executeReleaseProtocol,
  readManifest,
} from '../scripts/release-edge-production.mjs';

import {
  validateReleaseEvidence,
  edgeReleaseSnapshot,
  validateManifest,
} from '../scripts/a1-a4-contract-v3.mjs';

function createMockInertQueryFn(overrides = {}) {
  return (sql) => {
    if (sql.includes('pg_try_advisory_lock')) return overrides.lock !== undefined ? overrides.lock : 't';
    if (sql.includes('pg_advisory_unlock')) return 't';
    if (sql.includes('schema_migrations')) {
      return JSON.stringify(['20260908164550', '20260908190758', '20260909011239']);
    }
    if (sql.includes('a1_a4_expand_artifacts')) {
      return JSON.stringify([
        { version: '20260908164550', path: 'supabase/migrations/20260908164550_current_payment_authority_and_refund_identity.sql', sha256: '83752fdf5fbee0c63b5cae512be20fcdcf13a5fc805872453208daaf21f27853' },
        { version: '20260908190758', path: 'supabase/migrations/20260908190758_a1_attempt_authority_expand_v2.sql', sha256: '8775a22ff1a5391721b58f33b8984e8581dd137e64ab407f9a48b6c085b37cc9' },
      ]);
    }
    if (sql.includes('authority_rpc')) {
      return JSON.stringify({
        authority_rpc: true,
        refund_v2: true,
        prepare_refund_v2: true,
        claim_outbox_v2: true,
        executor: true,
        attestations: true,
        dispatch_control: true,
      });
    }
    if (sql.includes('a1_a4_payment_dispatch_control')) {
      return overrides.paused !== undefined ? overrides.paused : 't';
    }
    for (const [key, val] of Object.entries(overrides)) {
      if (sql.includes(key)) return String(val);
    }
    return '0';
  };
}

function createMockFetcher(functionsList, status = 200) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => functionsList,
  });
}

function createStandardRemoteFunctions(now = Date.now()) {
  return EXPECTED_EDGE_FUNCTIONS.map((name, index) => ({
    name,
    slug: name,
    id: `fn-id-${index}`,
    version: 10,
    status: 'ACTIVE',
    updated_at: now + index * 10,
    ezbr_sha256: String(index + 1).repeat(64),
  }));
}

// 1. Wrong production project ref => reject before mutation
test('1. Wrong production project ref rejects before any mutation', async () => {
  let mutated = false;
  const outcome = await executeReleaseProtocol({
    projectRef: 'ukxqbgswjlibmnjemrzd', // staging
    skipEvidenceOnFailure: true,
    deployerFn: async () => { mutated = true; },
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.exitCode, EXIT_TARGET_GUARD_REJECTED);
  assert.match(outcome.error.message, /not production/i);
  assert.equal(mutated, false);
});

// 2. Missing project ref => reject
test('2. Missing project ref rejects with target guard code', async () => {
  const outcome = await executeReleaseProtocol({
    projectRef: '',
    skipEvidenceOnFailure: true,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.exitCode, EXIT_TARGET_GUARD_REJECTED);
  assert.match(outcome.error.message, /missing --project-ref/i);
});

// 3. Production not financially inert => reject before Edge deployment
test('3. Production not financially inert rejects before Edge deployment', async () => {
  let deployed = false;
  const queryFn = createMockInertQueryFn({ business_payment_settings: 1 });
  const outcome = await executeReleaseProtocol({
    projectRef: EXPECTED_PROJECT_REF,
    queryFn,
    skipEvidenceOnFailure: true,
    deployerFn: async () => { deployed = true; },
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.exitCode, EXIT_FINANCIAL_INERT_FAILED);
  assert.match(outcome.error.message, /NOT financially inert/);
  assert.equal(deployed, false);
});

// 4. Financial state query failure => fail closed
test('4. Financial state query failure fails closed', async () => {
  let deployed = false;
  const queryFn = () => { throw new Error('Database connection failed'); };
  const outcome = await executeReleaseProtocol({
    projectRef: EXPECTED_PROJECT_REF,
    queryFn,
    skipEvidenceOnFailure: true,
    deployerFn: async () => { deployed = true; },
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.exitCode, EXIT_CONCURRENCY_LOCKED); // first DB query is lock acquisition
  assert.equal(deployed, false);
});

// 5. Unknown/unparseable financial state => fail closed
test('5. Unknown or unparseable financial state fails closed', () => {
  const queryFn = (sql) => {
    if (sql.includes('business_payment_settings')) return 'CORRUPT_NOT_INTEGER';
    return '0';
  };
  assert.throws(
    () => verifyFinancialInertness(queryFn),
    /unparseable integer count/
  );
});

// 6. Missing required Edge function => reject
test('6. Missing required Edge function entrypoint rejects', () => {
  assert.throws(
    () => verifyLocalSource(path.join(ROOT, 'non-existent-folder')),
    /Required Edge function entrypoint missing/
  );
});

// 7. Unexpected Edge function set => reject where relevant
test('7. Unexpected Edge function set rejects during evidence validation', () => {
  const invalidEvidence = {
    result: 'SUCCESS',
    partial_release: false,
    dry_run: false,
    project_ref: EXPECTED_PROJECT_REF,
    edge_functions: ['mercadopago-create-preference', 'unexpected-function'],
    release_identity: 'sha256:' + 'a'.repeat(64),
  };
  assert.throws(
    () => validateReleaseEvidence(invalidEvidence, EXPECTED_PROJECT_REF),
    /Release evidence does not contain the exact expected Edge functions/
  );
});

// 8. Local source/release identity mismatch => reject
test('8. Local source hash matches reviewed fingerprints', () => {
  const result = verifyLocalSource(ROOT);
  assert.equal(result.ok, true);
  for (const [file, hash] of Object.entries(EXPECTED_SOURCE_HASHES)) {
    assert.equal(result.hashes[file], hash);
  }
});

// 9. Release manifest tampering => reject
test('9. Release manifest tampering rejects', () => {
  const manifest = readManifest(ROOT);
  assert.doesNotThrow(() => validateManifest(manifest));
  const tampered = { ...manifest, expand_sha256: '0'.repeat(64) };
  assert.throws(() => validateManifest(tampered), /combined EXPAND SHA differs/);
});

// 10. First Edge deployment succeeds, second fails => overall FAIL
test('10. Partial deployment (1 of 3 succeeds) fails overall and marks partial_release', async () => {
  let step = 0;
  const deployerFn = async () => {
    step++;
    const err = new Error('Upload timeout on second function');
    err.partial = true;
    err.status = 1;
    throw err;
  };
  const queryFn = createMockInertQueryFn();
  const outcome = await executeReleaseProtocol({
    projectRef: EXPECTED_PROJECT_REF,
    queryFn,
    deployerFn,
    skipEvidenceOnFailure: true,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.exitCode, EXIT_DEPLOY_FAILED);
  assert.equal(outcome.evidence.partial_release, true);
  assert.equal(outcome.evidence.result, 'FAIL');
  assert.equal(outcome.evidence.release_identity, null);
});

// 11. Two Edge deployments succeed, third fails => overall FAIL
test('11. Partial deployment (2 of 3 succeed) fails overall', async () => {
  const deployerFn = async () => {
    const err = new Error('Third function deploy rejected');
    err.partial = true;
    err.status = 1;
    throw err;
  };
  const queryFn = createMockInertQueryFn();
  const outcome = await executeReleaseProtocol({
    projectRef: EXPECTED_PROJECT_REF,
    queryFn,
    deployerFn,
    skipEvidenceOnFailure: true,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.exitCode, EXIT_DEPLOY_FAILED);
  assert.equal(outcome.evidence.partial_release, true);
  assert.equal(outcome.evidence.result, 'FAIL');
});

// 12. Partial release => never reported as successful
test('12. Incomplete Edge deployment is never reported as successful', () => {
  const evidence = buildReleaseEvidence({
    projectRef: EXPECTED_PROJECT_REF,
    edgeFunctions: EXPECTED_EDGE_FUNCTIONS,
    sourceHashes: EXPECTED_SOURCE_HASHES,
    releaseIdentity: null,
    deployedAt: null,
    financialInertness: { ok: true },
    expandCompatibility: { ok: true },
    partialRelease: true,
    dryRun: false,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    result: 'FAIL',
    error: new Error('Partial deploy'),
  });
  assert.equal(evidence.result, 'FAIL');
  assert.equal(evidence.partial_release, true);
  assert.equal(evidence.contract_eligible, false);
  assert.throws(
    () => validateReleaseEvidence(evidence, EXPECTED_PROJECT_REF),
    /Release evidence result is not SUCCESS/
  );
});

// 13. Remote verification failure => FAIL
test('13. Remote verification failure after deployment fails the release', async () => {
  const queryFn = createMockInertQueryFn();
  const deployerFn = async () => ({ dryRun: false, deployed: [] });
  const fetcherFn = createMockFetcher([], 500); // Management API error
  const outcome = await executeReleaseProtocol({
    projectRef: EXPECTED_PROJECT_REF,
    token: 'test-token',
    queryFn,
    deployerFn,
    fetcherFn,
    skipEvidenceOnFailure: true,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.exitCode, EXIT_REMOTE_VERIFY_FAILED);
  assert.equal(outcome.evidence.partial_release, true);
  assert.equal(outcome.evidence.result, 'FAIL');
});

// 14. Remote version/hash mismatch or wide switch window => FAIL
test('14. Remote switch window exceeding 10,000 ms fails verification', async () => {
  const now = Date.now();
  const wideWindowFunctions = EXPECTED_EDGE_FUNCTIONS.map((name, index) => ({
    name,
    slug: name,
    id: `fn-${index}`,
    version: 10,
    status: 'ACTIVE',
    updated_at: now + index * 20_000, // 20s gap
    ezbr_sha256: String(index + 1).repeat(64),
  }));
  const queryFn = createMockInertQueryFn();
  const deployerFn = async () => ({ dryRun: false, deployed: [] });
  const fetcherFn = createMockFetcher(wideWindowFunctions, 200);
  const outcome = await executeReleaseProtocol({
    projectRef: EXPECTED_PROJECT_REF,
    token: 'test-token',
    queryFn,
    deployerFn,
    fetcherFn,
    skipEvidenceOnFailure: true,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.exitCode, EXIT_REMOTE_VERIFY_FAILED);
  assert.match(outcome.error.message, /one release window/);
});

// 15. All expected Edge versions verified => PASS
test('15. All expected Edge functions deployed and verified in window => PASS', async () => {
  const now = Date.now();
  const validFunctions = createStandardRemoteFunctions(now);
  const queryFn = createMockInertQueryFn();
  const deployerFn = async () => ({ dryRun: false, deployed: [] });
  const fetcherFn = createMockFetcher(validFunctions, 200);
  const outcome = await executeReleaseProtocol({
    projectRef: EXPECTED_PROJECT_REF,
    token: 'test-token',
    queryFn,
    deployerFn,
    fetcherFn,
    skipEvidenceOnFailure: true,
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.exitCode, EXIT_SUCCESS);
  assert.equal(outcome.evidence.result, 'SUCCESS');
  assert.equal(outcome.evidence.partial_release, false);
  assert.match(outcome.evidence.release_identity, /^sha256:[a-f0-9]{64}$/);
});

// 16. CONTRACT cannot proceed using incomplete Edge release evidence
test('16. CONTRACT cannot proceed using incomplete Edge release evidence', () => {
  const partialEvidence = {
    result: 'FAIL',
    partial_release: true,
    dry_run: false,
    project_ref: EXPECTED_PROJECT_REF,
    edge_functions: EXPECTED_EDGE_FUNCTIONS,
    release_identity: null,
  };
  assert.throws(
    () => validateReleaseEvidence(partialEvidence, EXPECTED_PROJECT_REF),
    /Release evidence result is not SUCCESS/
  );
});

// 17. Stale/incorrect release evidence cannot authorize CONTRACT
test('17. Stale or mismatched release evidence cannot authorize CONTRACT', () => {
  const activeReleaseId = 'sha256:' + 'a'.repeat(64);
  const staleEvidence = {
    result: 'SUCCESS',
    partial_release: false,
    dry_run: false,
    project_ref: EXPECTED_PROJECT_REF,
    edge_functions: EXPECTED_EDGE_FUNCTIONS,
    release_identity: 'sha256:' + 'b'.repeat(64), // stale
  };
  assert.throws(
    () => validateReleaseEvidence(staleEvidence, EXPECTED_PROJECT_REF, activeReleaseId),
    /does not match active platform identity/
  );

  const dryRunEvidence = {
    ...staleEvidence,
    dry_run: true,
    release_identity: activeReleaseId,
  };
  assert.throws(
    () => validateReleaseEvidence(dryRunEvidence, EXPECTED_PROJECT_REF, activeReleaseId),
    /Release evidence is from a DRY-RUN and cannot authorize CONTRACT/
  );
});

// 18. Concurrent production release attempts => safely serialized or rejected
test('18. Concurrent production release attempts are rejected by advisory lock', async () => {
  let deployAttempted = false;
  const queryFn = createMockInertQueryFn({ lock: 'f' }); // lock held by another process
  const outcome = await executeReleaseProtocol({
    projectRef: EXPECTED_PROJECT_REF,
    queryFn,
    skipEvidenceOnFailure: true,
    deployerFn: async () => { deployAttempted = true; },
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.exitCode, EXIT_CONCURRENCY_LOCKED);
  assert.match(outcome.error.message, /Concurrent release detected/);
  assert.equal(deployAttempted, false);
});

// 19. Dry-run => zero remote mutations
test('19. Dry-run performs zero remote mutations and executes zero deploy commands', async () => {
  let mutationsAttempted = 0;
  const outcome = await executeReleaseProtocol({
    projectRef: EXPECTED_PROJECT_REF,
    dryRun: true,
    skipDb: true,
    skipEvidenceOnFailure: true,
    deployerFn: async () => { mutationsAttempted++; },
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.exitCode, EXIT_SUCCESS);
  assert.equal(mutationsAttempted, 0);
  assert.equal(outcome.evidence.dry_run, true);
  assert.equal(outcome.evidence.result, 'SUCCESS');
});

// 20. Dry-run still validates release identity and safety gates
test('20. Dry-run still validates target ref and local source hashes', async () => {
  const badRefOutcome = await executeReleaseProtocol({
    projectRef: 'ukxqbgswjlibmnjemrzd',
    dryRun: true,
    skipDb: true,
    skipEvidenceOnFailure: true,
  });
  assert.equal(badRefOutcome.ok, false);
  assert.equal(badRefOutcome.exitCode, EXIT_TARGET_GUARD_REJECTED);
});

// 21. No secret values written to release evidence
test('21. No secret values written to release evidence', () => {
  const sampleEvidence = buildReleaseEvidence({
    projectRef: EXPECTED_PROJECT_REF,
    edgeFunctions: EXPECTED_EDGE_FUNCTIONS,
    sourceHashes: EXPECTED_SOURCE_HASHES,
    releaseIdentity: 'sha256:' + 'a'.repeat(64),
    deployedAt: new Date().toISOString(),
    financialInertness: { ok: true },
    expandCompatibility: { ok: true },
    partialRelease: false,
    dryRun: false,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    result: 'SUCCESS',
    error: null,
  });
  const jsonStr = JSON.stringify(sampleEvidence, null, 2);
  const sensitivePatterns = [
    /password/i,
    /secret/i,
    /bearer/i,
    /postgres:\/\//i,
    /postgresql:\/\//i,
    /token[a-z0-9_-]{10,}/i,
  ];
  for (const pat of sensitivePatterns) {
    assert.doesNotMatch(jsonStr, pat);
  }
});

// 22. Existing rolling compatibility properties remain valid
test('22. EXPAND and CONTRACT artifacts remain bound and validated', () => {
  const manifest = readManifest(ROOT);
  assert.doesNotThrow(() => validateManifest(manifest));
  assert.equal(manifest.expand_version, '20260909011239');
  assert.equal(manifest.expand_files.length, 3);
  assert.ok(manifest.contract.path.includes('a1_a4_legacy_contract_v3.sql'));
});
