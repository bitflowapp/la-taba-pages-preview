// Dedicated PILOT-only Cloudflare Pages rollback drill. Do not run before two
// compatible successful deployments exist; preflight is read-only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { assertPilotIdentity } from '../import-pilot-catalog.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const PROJECT = 'la-taba-commercial-pilot';
const CERT = '2dcc9b0a0cf022ebf59c500331103ee31cec9e9142d5431553131877948ec1aa';
const ID = /^[a-f0-9-]{32,40}$/i;
const option = (flag) => { const i = process.argv.indexOf(flag); return i < 0 ? '' : process.argv[i + 1] || ''; };

export function validateRollbackPair(previous, candidate, config) {
  assert.equal(config.cloudflareProject, PROJECT, 'ROLLBACK_PROJECT_MUST_BE_PILOT');
  assert.equal(config.deploymentEnvironment, 'pilot', 'ROLLBACK_ENVIRONMENT_MUST_BE_PILOT');
  assertPilotIdentity(config.supabaseProjectRef, config.businessId);
  assert.ok(previous && candidate && previous.commit !== candidate.commit,
    'TWO_DISTINCT_PILOT_DEPLOYMENTS_REQUIRED');
  for (const item of [previous, candidate]) {
    assert.equal(item.metadata?.environment, 'pilot', 'ROLLBACK_METADATA_MUST_BE_PILOT');
    assert.equal(item.metadata?.backendRef, config.supabaseProjectRef,
      'ROLLBACK_BACKEND_MISMATCH');
    assert.equal(item.metadata?.businessId, config.businessId,
      'ROLLBACK_BUSINESS_MISMATCH');
    assert.match(item.metadata?.migrationGraphSha256 || '', /^[a-f0-9]{64}$/i,
      'ROLLBACK_MIGRATION_GRAPH_MISSING');
    assert.ok(item.version?.commit === item.commit && item.version?.runtime,
      'ROLLBACK_VERSION_MISMATCH');
  }
  assert.equal(previous.metadata.migrationGraphSha256,
    candidate.metadata.migrationGraphSha256, 'ROLLBACK_DB_GRAPH_INCOMPATIBLE');
  return true;
}

function cloudflareClient() {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  assert.match(account || '', /^[a-f0-9]{32}$/i, 'PILOT_CLOUDFLARE_ACCOUNT_REQUIRED');
  assert.ok(typeof token === 'string' && token.length >= 20, 'PILOT_CLOUDFLARE_TOKEN_REQUIRED');
  return async (suffix, method = 'GET') => {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${PROJECT}${suffix}`, {
      method, headers: { Authorization: `Bearer ${token}` }, redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
    assert.ok(response.ok, `PILOT_CLOUDFLARE_HTTP_${response.status}`);
    const payload = await response.json();
    assert.equal(payload.success, true, 'PILOT_CLOUDFLARE_API_REJECTED');
    return payload.result;
  };
}

async function publicJson(origin, file) {
  const response = await fetch(`${origin}/${file}`, {
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.status, 200, `PILOT_${file.toUpperCase()}_UNAVAILABLE`);
  return response.json();
}

async function runtime(origin, config) {
  const response = await fetch(`${origin}/runtime-config.js`, {
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.status, 200, 'PILOT_ROLLBACK_RUNTIME_UNAVAILABLE');
  const sandbox = { globalThis: {} };
  vm.runInNewContext(await response.text(), sandbox, { timeout: 1000 });
  const repository = sandbox.globalThis.__LA_TABA_RUNTIME_CONFIG__?.repository;
  assert.equal(repository?.deploymentEnvironment, 'pilot', 'ROLLBACK_RUNTIME_NOT_PILOT');
  assert.equal(repository?.supabaseUrl,
    `https://${config.supabaseProjectRef}.supabase.co`, 'ROLLBACK_RUNTIME_BACKEND_MISMATCH');
  assert.equal(repository?.businessId, config.businessId, 'ROLLBACK_RUNTIME_BUSINESS_MISMATCH');
}

async function deployment(cloudflare, id, config) {
  assert.match(id, ID, 'EXACT_PILOT_DEPLOYMENT_ID_REQUIRED');
  const value = await cloudflare(`/deployments/${id}`);
  assert.equal(value?.id, id, 'CLOUDFLARE_DEPLOYMENT_ID_MISMATCH');
  assert.equal(value?.project_name, PROJECT, 'CLOUDFLARE_DEPLOYMENT_PROJECT_MISMATCH');
  assert.equal(value?.environment, 'production', 'ROLLBACK_PREVIEW_DEPLOYMENT_FORBIDDEN');
  assert.equal(value?.latest_stage?.status, 'success', 'ROLLBACK_TARGET_NOT_SUCCESSFUL');
  const host = new URL(value.url).hostname;
  assert.ok(host.endsWith(`.${PROJECT}.pages.dev`) && host !== `${PROJECT}.pages.dev`,
    'ROLLBACK_IMMUTABLE_HOST_REQUIRED');
  const origin = `https://${host}`;
  const version = await publicJson(origin, 'version.json');
  const metadata = await publicJson(origin, 'pilot-deploy-metadata.json');
  await runtime(origin, config);
  return { id, commit: version.commit, version, metadata, origin };
}

function verifyPreviousApk(config) {
  assert.ok(config.previousApkFile && config.previousRiderReceiptFile,
    'PREVIOUS_PILOT_APK_AND_RECEIPT_REQUIRED');
  const apk = path.resolve(config.previousApkFile || '');
  const receiptFile = path.resolve(config.previousRiderReceiptFile || '');
  assert.ok(existsSync(apk) && existsSync(receiptFile)
    && statSync(apk).isFile() && statSync(receiptFile).isFile(),
  'PREVIOUS_PILOT_APK_AND_RECEIPT_REQUIRED');
  const receipt = JSON.parse(readFileSync(receiptFile, 'utf8'));
  assert.equal(receipt.target, 'pilot', 'PREVIOUS_APK_NOT_PILOT');
  assert.equal(receipt.backend, config.supabaseProjectRef, 'PREVIOUS_APK_BACKEND_MISMATCH');
  assert.equal(receipt.packageId, 'com.lataba.rider.pilot', 'PREVIOUS_APK_PACKAGE_MISMATCH');
  assert.equal(receipt.certificateSha256?.toLowerCase(), CERT, 'PREVIOUS_APK_SIGNER_MISMATCH');
  assert.equal(createHash('sha256').update(readFileSync(apk)).digest('hex'),
    receipt.apkSha256, 'PREVIOUS_APK_HASH_MISMATCH');
  return receipt.apkSha256;
}

async function aliasMatches(config, expected) {
  const origin = new URL(config.customerUrl).origin;
  assert.equal(new URL(origin).hostname, `${PROJECT}.pages.dev`, 'ROLLBACK_ALIAS_MUST_BE_PILOT');
  const version = await publicJson(origin, 'version.json');
  assert.equal(version.commit, expected.commit, 'PILOT_ALIAS_COMMIT_MISMATCH');
  assert.equal(version.runtime, expected.version.runtime, 'PILOT_ALIAS_RUNTIME_MISMATCH');
  const metadata = await publicJson(origin, 'pilot-deploy-metadata.json');
  assert.deepEqual(metadata, expected.metadata, 'PILOT_ALIAS_CONFIG_MISMATCH');
  await runtime(origin, config);
}

async function waitAlias(config, expected) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try { await aliasMatches(config, expected); return; }
    catch { await new Promise((resolve) => setTimeout(resolve, 5000)); }
  }
  throw Error('PILOT_ALIAS_DID_NOT_REACH_TARGET');
}

async function main() {
  const phase = option('--phase');
  assert.ok(['preflight', 'rollback', 'restore'].includes(phase), 'PILOT_ROLLBACK_PHASE_REQUIRED');
  assert.ok(option('--config'), 'PILOT_ROLLBACK_CONFIG_REQUIRED');
  const config = JSON.parse(readFileSync(path.resolve(option('--config')), 'utf8'));
  assert.equal(config.cloudflareProject, PROJECT, 'ROLLBACK_PROJECT_MUST_BE_PILOT');
  assertPilotIdentity(config.supabaseProjectRef, config.businessId);
  verifyPreviousApk(config);
  const cloudflare = cloudflareClient();
  const project = await cloudflare('');
  assert.equal(project?.name, PROJECT, 'CLOUDFLARE_PROJECT_MISMATCH');
  if (phase !== 'preflight') assert.ok(option('--receipt'), 'ROLLBACK_RECEIPT_REQUIRED');
  const receipt = phase === 'preflight' ? null
    : JSON.parse(readFileSync(path.resolve(option('--receipt')), 'utf8'));
  const previousId = option('--previous-id') || receipt?.previousId || config.previousDeploymentId;
  const candidateId = option('--candidate-id') || receipt?.candidateId || project.production_deployment?.id;
  assert.match(previousId || '', ID, 'PREVIOUS_DEPLOYMENT_ID_REQUIRED');
  assert.match(candidateId || '', ID, 'CANDIDATE_DEPLOYMENT_ID_REQUIRED');
  assert.notEqual(previousId, candidateId, 'ROLLBACK_REQUIRES_TWO_DEPLOYMENTS');
  const previous = await deployment(cloudflare, previousId, config);
  const candidate = await deployment(cloudflare, candidateId, config);
  validateRollbackPair(previous, candidate, config);
  if (phase === 'preflight') {
    assert.equal(project.production_deployment?.id, candidateId, 'CANDIDATE_NOT_CURRENT');
    await aliasMatches(config, candidate);
    assert.ok(option('--out'), 'ROLLBACK_RECEIPT_PATH_REQUIRED');
    const output = path.resolve(option('--out'));
    assert.ok(output.toLowerCase() !== ROOT.toLowerCase()
      && !output.toLowerCase().startsWith((ROOT + path.sep).toLowerCase()),
    'ROLLBACK_RECEIPT_OUTSIDE_REPO_REQUIRED');
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, JSON.stringify({ project: PROJECT, previousId, candidateId,
      previousCommit: previous.commit, candidateCommit: candidate.commit,
      migrationGraphSha256: previous.metadata.migrationGraphSha256,
      capturedAt: new Date().toISOString() }, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ pilotRollbackPreflight: 'PASS', cloudWrites: false,
      localReceiptCreated: true,
      previousCommit: previous.commit, candidateCommit: candidate.commit }));
    return;
  }
  assert.equal(receipt.project, PROJECT, 'ROLLBACK_RECEIPT_PROJECT_MISMATCH');
  assert.equal(receipt.previousId, previousId, 'ROLLBACK_PREVIOUS_ID_MISMATCH');
  assert.equal(receipt.candidateId, candidateId, 'ROLLBACK_CANDIDATE_ID_MISMATCH');
  assert.equal(receipt.migrationGraphSha256, previous.metadata.migrationGraphSha256,
    'ROLLBACK_MIGRATION_GRAPH_CHANGED');
  const from = phase === 'rollback' ? candidate : previous;
  const to = phase === 'rollback' ? previous : candidate;
  await aliasMatches(config, from);
  await cloudflare(`/deployments/${to.id}/rollback`, 'POST');
  await waitAlias(config, to);
  console.log(JSON.stringify({ pilotRollbackDrill: 'PASS', phase,
    restoredCommit: to.commit, backendUnchanged: true, configVerified: true }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => { console.error(`PILOT_ROLLBACK_BLOCKED:${error.message}`); process.exitCode = 1; });
}
