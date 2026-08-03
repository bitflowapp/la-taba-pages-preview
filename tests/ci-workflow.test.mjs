import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ci = readFileSync(
  new URL('../.github/workflows/ci.yml', import.meta.url),
  'utf8',
);
const preview = readFileSync(
  new URL('../.github/workflows/preview-pages.yml', import.meta.url),
  'utf8',
);

test('release candidate CI validates pull requests without deploy permissions', () => {
  assert.match(ci, /pull_request:\s*\n\s+branches:\s*\n\s+- main/);
  assert.match(ci, /workflow_dispatch:/);
  assert.match(ci, /permissions:\s*\n\s+contents: read/);
  assert.match(ci, /NODE_VERSION: '22'/);
  assert.match(ci, /node-version: \$\{\{ env\.NODE_VERSION \}\}/);
  assert.match(ci, /npm ci --no-audit --no-fund/);
  assert.match(ci, /npm run vendor:build/);
  assert.match(ci, /npm run check/);
  assert.match(ci, /npm test/);
  assert.match(ci, /npm run migrations:validate/);
  assert.match(ci, /npm run catalog:images:verify/);
  assert.match(ci, /npm audit --omit=dev/);
  assert.match(ci, /npm --prefix services\/arca-fiscal-bridge audit --omit=dev/);
  assert.match(ci, /id: e2e[\s\S]*npm run test:e2e[\s\S]*--trace=retain-on-failure/);
  assert.match(
    ci,
    /if: \$\{\{ failure\(\) && steps\.e2e\.outcome == 'failure' \}\}[\s\S]*actions\/upload-artifact@[0-9a-f]{40} # v4/,
  );
  assert.doesNotMatch(ci, /uses:\s+[^\s]+@(?:v\d+|main|master)(?:\s|$)/m);
  assert.doesNotMatch(ci, /pages:\s*write|id-token:\s*write|deploy-pages|secrets\./);
});

test('Pages preview deployment is available only through manual dispatch', () => {
  assert.match(preview, /on:\s*\n\s+workflow_dispatch:/);
  assert.doesNotMatch(preview, /^\s+(?:push|pull_request|schedule):/m);
  assert.match(preview, /actions\/deploy-pages@v4/);
});
