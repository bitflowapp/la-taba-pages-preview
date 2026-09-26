import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { validatePilotTarget } from '../scripts/deploy/smoke-commercial-pilot.mjs';

const ref = 'abcdefghijklmnopqrst';
const businessId = '116d8f37-29f5-40f1-a692-81b86b69a72c';
const valid = {
  origin: 'https://la-taba-commercial-pilot.pages.dev', ref, businessId,
  runtime: { mode: 'production', repository: { provider: 'supabase',
    deploymentEnvironment: 'pilot', supabaseUrl: `https://${ref}.supabase.co`,
    publishableKey: 'sb_publishable_test_public_key_for_unit_test', businessId } },
};

test('pilot smoke target accepts only isolated pilot runtime', () => {
  assert.equal(validatePilotTarget(valid), valid.origin);
  assert.throws(() => validatePilotTarget({ ...valid, origin: 'https://la-taba.pages.dev' }),
    /PILOT_HOST_MUST_BE_ISOLATED/);
  assert.throws(() => validatePilotTarget({ ...valid, ref: 'wwcpogltfgzgkrlilbcd' }),
    /PILOT_REF_MUST_BE_ISOLATED/);
  assert.throws(() => validatePilotTarget({ ...valid, ref: 'ucbtjcurawxjwjdvvcvj' }),
    /PILOT_REF_MUST_BE_ISOLATED/);
  assert.throws(() => validatePilotTarget({ ...valid, ref: 'yakhtrkukqlgzvxuvhzs' }),
    /PILOT_REF_MUST_BE_ISOLATED/);
  assert.throws(() => validatePilotTarget({ ...valid, origin: 'https://taba2-staging.pages.dev' }),
    /PILOT_HOST_MUST_BE_ISOLATED/);
  assert.throws(() => validatePilotTarget({ ...valid, runtime: {
    ...valid.runtime, repository: { ...valid.runtime.repository,
      businessId: 'a57b1c20-0f4e-4a6b-9d31-7c2e5f8a41d0' },
  } }), /PILOT_RUNTIME_INVALID/);
  assert.throws(() => validatePilotTarget({ ...valid, runtime: {
    ...valid.runtime, repository: { ...valid.runtime.repository, deploymentEnvironment: 'staging' },
  } }), /NOT_PILOT_RUNTIME/);
  assert.throws(() => validatePilotTarget({ ...valid, origin: 'http://la-taba-commercial-pilot.pages.dev' }),
    /PILOT_HTTPS_REQUIRED/);
});

test('pilot smoke never defaults to a deployed environment', () => {
  const result = spawnSync(process.execPath, ['scripts/deploy/smoke-commercial-pilot.mjs'], {
    encoding: 'utf8', windowsHide: true, timeout: 10_000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage: --origin/);
});
