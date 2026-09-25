import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { validateRollbackPair } from '../scripts/deploy/drill-commercial-pilot-rollback.mjs';

const ref = 'abcdefghijklmnopqrst';
const businessId = '116d8f37-29f5-40f1-a692-81b86b69a72c';
const config = { cloudflareProject: 'la-taba-commercial-pilot',
  deploymentEnvironment: 'pilot', supabaseProjectRef: ref, businessId };
const metadata = { environment: 'pilot', backendRef: ref, businessId,
  migrationGraphSha256: 'a'.repeat(64) };
const previous = { commit: 'b'.repeat(40), version: { commit: 'b'.repeat(40), runtime: 'v1' }, metadata };
const candidate = { commit: 'c'.repeat(40), version: { commit: 'c'.repeat(40), runtime: 'v2' }, metadata };

test('rollback plan requires two compatible isolated PILOT deployments', () => {
  assert.equal(validateRollbackPair(previous, candidate, config), true);
  assert.throws(() => validateRollbackPair(previous, candidate,
    { ...config, cloudflareProject: 'taba2-staging' }), /ROLLBACK_PROJECT_MUST_BE_PILOT/);
  assert.throws(() => validateRollbackPair(previous,
    { ...candidate, metadata: { ...metadata, backendRef: 'wwcpogltfgzgkrlilbcd' } }, config),
  /ROLLBACK_BACKEND_MISMATCH/);
  assert.throws(() => validateRollbackPair(previous,
    { ...candidate, metadata: { ...metadata, migrationGraphSha256: 'd'.repeat(64) } }, config),
  /ROLLBACK_DB_GRAPH_INCOMPATIBLE/);
});

test('rollback script without explicit phase cannot make a Cloudflare call', () => {
  const result = spawnSync(process.execPath,
    ['scripts/deploy/drill-commercial-pilot-rollback.mjs'], {
      encoding: 'utf8', windowsHide: true, timeout: 10_000,
    });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PILOT_ROLLBACK_PHASE_REQUIRED/);
});
