import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/deploy-staging-pilot.yml', import.meta.url), 'utf8');
const riderCi = readFileSync(new URL('../.github/workflows/rider-android-ci.yml', import.meta.url), 'utf8');

test('Staging deploy stays disarmed without exact SHA and project variables', () => {
  assert.match(workflow, /vars\.STAGING_DEPLOY_SHA == github\.sha/);
  assert.match(workflow, /vars\.STAGING_DEPLOY_PROJECT == 'taba2-staging'/);
  assert.match(workflow, /branches:\s*\n\s*- 'release\/taba-commercial-pilot'/);
  assert.doesNotMatch(workflow, /workflow_dispatch:/);
});

test('Staging deploy checks CI and Cloudflare target before writing', () => {
  const ci = workflow.indexOf('check-staging-pilot-ci.mjs');
  const target = workflow.indexOf('check-cloudflare-staging-target.mjs');
  const deploy = workflow.indexOf('wrangler@4 pages deploy');
  assert.ok(ci > 0 && target > ci && deploy > target);
  assert.match(workflow, /--project-name taba2-staging --branch main/);
  assert.doesNotMatch(workflow, /--project-name la-taba\b/);
  assert.match(workflow, /verificar-staging-pilot\.mjs/);
  assert.match(workflow, /verify-staging-served\.mjs/);
});

test('Rider CI runs for every release push so exact-SHA deployment gate can pass', () => {
  const pushTrigger = riderCi.split('  pull_request:')[0];
  assert.match(pushTrigger, /- 'release\/\*\*'/);
  assert.doesNotMatch(pushTrigger, /\bpaths:/);
});
