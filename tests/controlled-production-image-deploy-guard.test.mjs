import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflow = fs.readFileSync(new URL('../.github/workflows/deploy-controlled-production.yml', import.meta.url), 'utf8');

test('manual CP deploy remains armed to exact release HEAD and exact push CI', () => {
  assert.match(workflow, /^\s+workflow_dispatch:\s*$/m);
  assert.match(workflow, /vars\.CP_DEPLOY_SHA == github\.sha/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/release\/taba-controlled-production'/);
  assert.match(workflow, /git rev-parse origin\/release\/taba-controlled-production\)" == "\$GITHUB_SHA/);
  assert.match(workflow, /node scripts\/deploy\/check-staging-pilot-ci\.mjs/);
  assert.match(workflow, /RELEASE_BRANCH: release\/taba-controlled-production/);
  assert.match(workflow, /npx --yes wrangler@4 pages deploy dist_pilot --project-name la-taba-commercial-pilot/);
});
