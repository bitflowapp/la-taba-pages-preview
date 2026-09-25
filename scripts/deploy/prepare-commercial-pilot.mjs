// Package only; it NEVER publishes. Requires the complete PILOT_PREFLIGHT.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPilotPreflight } from './pilot-preflight.mjs';
import { checkRuntimeConfig } from '../check-runtime-config.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'dist_pilot');
function option(flag) { const at = process.argv.indexOf(flag); return at < 0 ? '' : process.argv[at + 1] || ''; }
function run(script, args = []) {
  execFileSync(process.execPath, [script, ...args], { cwd: ROOT, stdio: 'inherit', windowsHide: true });
}
function migrationGraphSha256() {
  const dir = path.join(ROOT, 'supabase', 'migrations');
  const hash = createHash('sha256');
  for (const name of readdirSync(dir).filter((item) => item.endsWith('.sql')).sort()) {
    hash.update(name).update('\0').update(readFileSync(path.join(dir, name))).update('\0');
  }
  return hash.digest('hex');
}

async function main() {
  const configFile = option('--config');
  const approvalFile = option('--approval');
  const commit = option('--commit');
  assert.match(commit, /^[a-f0-9]{40}$/, 'PILOT_EXACT_COMMIT_REQUIRED');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const branch = execFileSync('git', ['branch', '--show-current'], { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.equal(commit, head, 'PILOT_COMMIT_NOT_HEAD');
  assert.ok(['release/taba-commercial-pilot', 'release/taba-controlled-production'].includes(branch),
    'PILOT_RELEASE_BRANCH_REQUIRED');
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim(), '',
    'PILOT_PACKAGE_REQUIRES_CLEAN_CHECKOUT');
  const { report, plan, ownerCredentials } = loadPilotPreflight({ configFile,
    approvalFile: approvalFile || undefined, phase: 'deploy' });
  assert.equal(report.status, 'PASS', 'PILOT_PREFLIGHT_REQUIRED');
  run('scripts/build-supabase-vendor.mjs');
  run('scripts/create-release-folder.mjs', ['--out', 'dist_pilot']);
  const config = JSON.parse(readFileSync(path.resolve(configFile), 'utf8'));
  const runtime = { mode: 'production', repository: {
    provider: 'supabase', deploymentEnvironment: 'pilot',
    supabaseUrl: `https://${plan.projectRef}.supabase.co`,
    publishableKey: ownerCredentials.publishableKey, businessId: plan.businessId,
    pollMs: 5000,
  } };
  writeFileSync(path.join(OUT, 'runtime-config.js'),
    `globalThis.__LA_TABA_RUNTIME_CONFIG__ = Object.freeze(${JSON.stringify(runtime)});\n`);
  const checked = await checkRuntimeConfig(path.join(OUT, 'runtime-config.js'));
  assert.ok(checked.ok && checked.environment === 'pilot'
    && checked.supabaseHost === `${plan.projectRef}.supabase.co`
    && checked.businessId === plan.businessId, 'PILOT_ARTIFACT_RUNTIME_REJECTED');
  run('scripts/deploy/sellar-version.mjs', [OUT, '--commit', commit]);
  const rider = JSON.parse(readFileSync(path.resolve(ROOT, config.rider.buildReceiptFile), 'utf8'));
  writeFileSync(path.join(OUT, 'pilot-deploy-metadata.json'), JSON.stringify({
    environment: 'pilot', catalogMode: report.catalogMode, commit, backendRef: plan.projectRef,
    businessId: plan.businessId, approvedSkus: plan.approvedSkus, migrationGraphSha256: migrationGraphSha256(),
    riderApkSha256: rider.apkSha256, riderVersion: rider.versionName,
  }, null, 2) + '\n');
  run('scripts/scan-production-artifacts.mjs', [OUT,
    '--expect-host', `${plan.projectRef}.supabase.co`, '--business-id', plan.businessId]);
  console.log(JSON.stringify({ pilotPackage: 'PASS', deployed: false, commit,
    projectRef: plan.projectRef, businessId: plan.businessId,
    approvedSkus: plan.approvedSkus, artifact: 'dist_pilot', secretsPrinted: false }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => { console.error(`PILOT_PACKAGE_BLOCKED:${error.message}`); process.exitCode = 1; });
}
