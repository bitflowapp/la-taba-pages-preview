import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { validatePilotE2eInputs } from '../scripts/deploy/run-commercial-pilot-e2e.mjs';

const ref = 'abcdefghijklmnopqrst';
const businessId = '116d8f37-29f5-40f1-a692-81b86b69a72c';
const approvedSkus = ['one-sku', 'two-sku', 'three-sku', 'four-sku', 'five-sku'];
const config = { customerUrl: 'https://la-taba-commercial-pilot.pages.dev/',
  supabaseProjectRef: ref, businessId };
const plan = { projectRef: ref, businessId, approvedSkus };
const runtime = { mode: 'production', repository: {
  provider: 'supabase', deploymentEnvironment: 'pilot',
  supabaseUrl: `https://${ref}.supabase.co`, businessId,
  publishableKey: 'sb_publishable_TEST_ONLY_FOR_UNIT_TEST',
} };
const metadata = { environment: 'pilot', backendRef: ref, businessId, approvedSkus };

test('physical E2E refuses a non-PILOT public runtime or catalog', () => {
  assert.equal(validatePilotE2eInputs({ config, plan, runtime, metadata }),
    'https://la-taba-commercial-pilot.pages.dev');
  assert.throws(() => validatePilotE2eInputs({ config, plan, runtime: {
    ...runtime, repository: { ...runtime.repository, deploymentEnvironment: 'production' },
  }, metadata }), /NOT_PILOT_RUNTIME/);
  assert.throws(() => validatePilotE2eInputs({ config, plan, runtime,
    metadata: { ...metadata, approvedSkus: ['wrong-sku'] } }),
  /PILOT_DEPLOY_CATALOG_ALLOWLIST_MISMATCH/);
});

test('physical E2E without explicit configuration makes no order', () => {
  const result = spawnSync(process.execPath, ['scripts/deploy/run-commercial-pilot-e2e.mjs'], {
    encoding: 'utf8', windowsHide: true, timeout: 10_000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PILOT_CONFIG_AND_APPROVAL_REQUIRED/);
});
