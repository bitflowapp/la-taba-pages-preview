import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('PILOT packager refuses to build or deploy without exact commit and preflight', () => {
  const result = spawnSync(process.execPath,
    ['scripts/deploy/prepare-commercial-pilot.mjs'], {
      encoding: 'utf8', windowsHide: true, timeout: 10_000,
    });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PILOT_EXACT_COMMIT_REQUIRED/);
});
