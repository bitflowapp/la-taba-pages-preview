import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync('.github/workflows/deploy-staging-pilot.yml', 'utf8');
const runner = readFileSync('scripts/deploy/drill-staging-pages-rollback.mjs', 'utf8');

test('rollback drill requires a second exact-SHA arm and stays in Staging', () => {
  assert.match(workflow, /vars\.STAGING_DEPLOY_SHA == github\.sha/);
  assert.match(workflow, /vars\.STAGING_ROLLBACK_DRILL_SHA == github\.sha/);
  assert.match(workflow, /branches:\s*\n\s*- 'release\/taba-commercial-pilot'/);
  assert.match(workflow, /--project-name taba2-staging --branch staging/);
  assert.doesNotMatch(workflow, /--project-name la-taba(?:\s|$)/);
  assert.match(workflow, /steps\.rollback_preflight\.outcome == 'success'/);
  assert.match(runner, /PREVIOUS_SHA = 'bcea25fd8d3ffe088dbf6ea6f3bfa2dbc3b79852'/);
  assert.match(runner, /production_branch, 'staging'/);
  assert.match(runner, /cloudflare\('\/deployments'\)/);
  assert.doesNotMatch(runner, /cloudflare\('\/deployments\?/);
  assert.match(runner, /previousTarget\(id\)/);
  assert.match(runner, /cloudflare\(`\/deployments\/\$\{exactId\}`\)/);
  assert.match(runner, /taba2-staging\.pages\.dev/);
  assert.doesNotMatch(runner, /wwcpogltfgzgkrlilbcd/);
});
