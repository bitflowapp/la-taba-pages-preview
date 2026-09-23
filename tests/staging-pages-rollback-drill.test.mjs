import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync('.github/workflows/drill-staging-pages-rollback.yml', 'utf8');
const runner = readFileSync('scripts/deploy/drill-staging-pages-rollback.mjs', 'utf8');

test('rollback drill is manual, isolated to the exact Staging Pages project', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /inputs\.confirm == 'staging-only'/);
  assert.match(workflow, /github\.ref_name == 'release\/taba-commercial-pilot'/);
  assert.match(workflow, /--project-name taba2-staging --branch staging/);
  assert.doesNotMatch(workflow, /--project-name la-taba(?:\s|$)/);
  assert.match(workflow, /steps\.preflight\.outcome == 'success'/);
  assert.match(runner, /PREVIOUS_SHA = 'bcea25fd8d3ffe088dbf6ea6f3bfa2dbc3b79852'/);
  assert.match(runner, /production_branch, 'staging'/);
  assert.match(runner, /taba2-staging\.pages\.dev/);
  assert.doesNotMatch(runner, /wwcpogltfgzgkrlilbcd/);
});
