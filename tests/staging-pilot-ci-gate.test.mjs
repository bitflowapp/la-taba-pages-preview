import assert from 'node:assert/strict';
import test from 'node:test';
import { hasPassingRun } from '../scripts/deploy/check-staging-pilot-ci.mjs';

const sha = 'a'.repeat(40);
const workflow = 'rider-android-ci.yml';
const passing = {
  head_sha: sha,
  path: `.github/workflows/${workflow}`,
  head_repository: { full_name: 'bitflowapp/la-taba-pages-preview' },
  head_branch: 'release/taba-commercial-pilot',
  event: 'push',
  status: 'completed',
  conclusion: 'success',
};

test('Staging CI gate requires exact successful branch run', () => {
  assert.equal(hasPassingRun([passing], { sha, workflow }), true);
  for (const change of [
    { head_sha: 'b'.repeat(40) }, { head_branch: 'main' },
    { path: '.github/workflows/ci.yml' }, { conclusion: 'failure' },
    { status: 'in_progress' }, { event: 'pull_request' },
    { head_repository: { full_name: 'someone/fork' } },
  ]) {
    assert.equal(hasPassingRun([{ ...passing, ...change }], { sha, workflow }), false);
  }
});
