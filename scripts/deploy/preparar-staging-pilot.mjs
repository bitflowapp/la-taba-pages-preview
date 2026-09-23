// Build a Staging-only candidate. This prepares files; it never deploys.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import vm from 'node:vm';
import { checkRuntimeConfig } from '../check-runtime-config.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'dist_staging_pilot');
const STAGING_ORIGIN = 'https://taba2-staging.pages.dev';
const STAGING_REF = 'ucbtjcurawxjwjdvvcvj';
const QA_BUSINESS = 'a57b1c20-0f4e-4a6b-9d31-7c2e5f8a41d0';
const argIndex = process.argv.indexOf('--commit');
const commit = argIndex < 0 ? process.env.GITHUB_SHA : process.argv[argIndex + 1];
if (!/^[0-9a-f]{40}$/.test(commit || '')) throw new Error('EXACT_COMMIT_REQUIRED');

const published = await fetch(`${STAGING_ORIGIN}/runtime-config.js`, { cache: 'no-store' });
if (!published.ok) throw new Error(`STAGING_RUNTIME_UNAVAILABLE:${published.status}`);
const sandbox = { globalThis: {} };
vm.runInNewContext(await published.text(), sandbox, { timeout: 1000 });
const repository = sandbox.globalThis.__LA_TABA_RUNTIME_CONFIG__?.repository;
if (sandbox.globalThis.__LA_TABA_RUNTIME_CONFIG__?.mode !== 'production'
  || repository?.deploymentEnvironment !== 'staging'
  || repository?.provider !== 'supabase'
  || repository?.supabaseUrl !== `https://${STAGING_REF}.supabase.co`
  || repository?.businessId !== QA_BUSINESS
  || !String(repository?.publishableKey || '').startsWith('sb_publishable_')) {
  throw new Error('PUBLIC_STAGING_RUNTIME_IDENTITY_MISMATCH');
}

const config = {
  mode: 'production',
  repository: {
    provider: 'supabase',
    deploymentEnvironment: 'staging',
    supabaseUrl: `https://${STAGING_REF}.supabase.co`,
    publishableKey: repository.publishableKey,
    businessId: QA_BUSINESS,
    pollMs: 5000,
  },
};
const run = (script, args = []) => execFileSync(process.execPath, [script, ...args], {
  cwd: ROOT, stdio: 'inherit', windowsHide: true,
});
run('scripts/build-supabase-vendor.mjs');
run('scripts/create-release-folder.mjs', ['--out', 'dist_staging_pilot']);
fs.writeFileSync(path.join(OUT, 'runtime-config.js'),
  `globalThis.__LA_TABA_RUNTIME_CONFIG__ = Object.freeze(${JSON.stringify(config)});\n`, 'utf8');
const verified = await checkRuntimeConfig(path.join(OUT, 'runtime-config.js'));
if (!verified.ok || verified.environment !== 'staging'
  || verified.supabaseHost !== `${STAGING_REF}.supabase.co`
  || verified.businessId !== QA_BUSINESS) {
  throw new Error('STAGING_ARTIFACT_RUNTIME_REJECTED');
}
run('scripts/deploy/sellar-version.mjs', [OUT, '--commit', commit]);
run('scripts/scan-production-artifacts.mjs', [OUT,
  '--expect-host', `${STAGING_REF}.supabase.co`, '--business-id', QA_BUSINESS]);
console.log(JSON.stringify({ artifact: 'dist_staging_pilot', commit,
  project: STAGING_REF, business: QA_BUSINESS, runtime: 'PASS', secretScan: 'PASS', deployed: false }));
