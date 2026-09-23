import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import vm from 'node:vm';

const PROJECT = 'taba2-staging';
const ORIGIN = 'https://taba2-staging.pages.dev';
const BACKEND = 'ucbtjcurawxjwjdvvcvj';
const PREVIOUS_SHA = 'bcea25fd8d3ffe088dbf6ea6f3bfa2dbc3b79852';
const PREVIOUS_RUNTIME = 'la-taba-runtime-v114-commercial-pilot';
const PREVIOUS_DEPLOYMENT_HOST = 'fdb5a1ec.taba2-staging.pages.dev';
const phase = process.argv[2];
assert.ok(['preflight', 'rollback'].includes(phase), 'Expected preflight or rollback');
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
assert.ok(account && token, 'Staging Cloudflare credentials required');

async function cloudflare(path, { method = 'GET' } = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${PROJECT}${path}`, {
    method, headers: { Authorization: `Bearer ${token}` }, redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  });
  assert.ok(response.ok, `Cloudflare ${method} ${path.split('?')[0]} HTTP ${response.status}`);
  const payload = await response.json();
  assert.equal(payload.success, true, `Cloudflare ${method} rejected`);
  return payload.result;
}

async function version(origin) {
  const response = await fetch(`${origin}/version.json`, {
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12_000),
  });
  assert.equal(response.status, 200, 'Staging version unavailable');
  return response.json();
}

async function assertStagingConfig(origin) {
  const response = await fetch(`${origin}/runtime-config.js`, {
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12_000),
  });
  assert.equal(response.status, 200, 'Staging runtime configuration unavailable');
  const sandbox = { globalThis: {} };
  vm.runInNewContext(await response.text(), sandbox, { timeout: 1000 });
  const config = sandbox.globalThis.__LA_TABA_RUNTIME_CONFIG__;
  assert.equal(config?.repository?.deploymentEnvironment, 'staging');
  assert.equal(config?.repository?.supabaseUrl, `https://${BACKEND}.supabase.co`);
}

async function previousTarget() {
  const project = await cloudflare('');
  assert.equal(project?.name, PROJECT);
  assert.equal(project?.production_branch, 'staging');
  // Project details may include the active production deployment directly.
  // Otherwise use the unfiltered list. This account rejects optional list
  // pagination parameters with HTTP 400, so neither path sends them.
  const current = project.production_deployment;
  const deployments = current?.id && current?.short_id && current?.url
    ? [current] : await cloudflare('/deployments');
  assert.ok(Array.isArray(deployments), 'Production deployment metadata unavailable');
  const target = deployments.find((deployment) => (
    (deployment === current || deployment?.environment === 'production')
    && deployment?.short_id === 'fdb5a1ec'
    && typeof deployment.url === 'string'
    && new URL(deployment.url).hostname === PREVIOUS_DEPLOYMENT_HOST
  ));
  assert.ok(target?.id, 'Known compatible Staging rollback target missing');
  const immutable = await version(`https://${PREVIOUS_DEPLOYMENT_HOST}`);
  assert.equal(immutable.commit, PREVIOUS_SHA);
  assert.equal(immutable.runtime, PREVIOUS_RUNTIME);
  await assertStagingConfig(`https://${PREVIOUS_DEPLOYMENT_HOST}`);
  return { project, target };
}

if (phase === 'preflight') {
  const alias = await version(ORIGIN);
  assert.equal(alias.commit, PREVIOUS_SHA, 'Current Staging alias changed; no drill');
  assert.equal(alias.runtime, PREVIOUS_RUNTIME);
  await assertStagingConfig(ORIGIN);
  const { project, target } = await previousTarget();
  if (project.production_deployment?.id) {
    assert.equal(project.production_deployment.id, target.id,
      'Rollback target is not the current Staging production deployment');
  }
  assert.ok(process.env.GITHUB_OUTPUT, 'GitHub step output required');
  appendFileSync(process.env.GITHUB_OUTPUT, `rollback_id=${target.id}\n`);
  console.log(JSON.stringify({ stagingRollbackPreflight: 'PASS', project: PROJECT,
    previousCommit: PREVIOUS_SHA, targetEnvironment: 'production',
    targetShortId: target.short_id, productionProjectUntouched: true }));
} else {
  const id = process.env.ROLLBACK_DEPLOYMENT_ID;
  assert.match(id || '', /^[a-f0-9-]{32,40}$/, 'Exact rollback deployment ID required');
  const { target } = await previousTarget();
  assert.equal(id, target.id, 'Rollback target changed');
  await cloudflare(`/deployments/${id}/rollback`, { method: 'POST' });
  const deadline = Date.now() + 180_000;
  let alias;
  while (Date.now() < deadline) {
    try { alias = await version(ORIGIN); } catch { /* alias propagation */ }
    if (alias?.commit === PREVIOUS_SHA && alias?.runtime === PREVIOUS_RUNTIME) break;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  assert.equal(alias?.commit, PREVIOUS_SHA, 'Staging alias did not return to prior SHA');
  assert.equal(alias?.runtime, PREVIOUS_RUNTIME);
  await assertStagingConfig(ORIGIN);
  console.log(JSON.stringify({ stagingPagesRollbackDrill: 'PASS', project: PROJECT,
    restoredCommit: PREVIOUS_SHA, runtime: PREVIOUS_RUNTIME,
    productionProjectUntouched: true }));
}
