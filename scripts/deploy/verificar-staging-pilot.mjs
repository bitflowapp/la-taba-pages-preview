import assert from 'node:assert/strict';
import vm from 'node:vm';

const ORIGIN = 'https://taba2-staging.pages.dev';
const REF = 'ucbtjcurawxjwjdvvcvj';
const BUSINESS = 'a57b1c20-0f4e-4a6b-9d31-7c2e5f8a41d0';
const argument = (flag) => {
  const i = process.argv.indexOf(flag);
  return i < 0 ? null : process.argv[i + 1];
};
const origin = argument('--host') || ORIGIN;
const commit = argument('--commit');
const runtime = argument('--runtime');
assert.equal(origin, ORIGIN, 'Only the Staging Pages origin is permitted');
assert.match(commit || '', /^[a-f0-9]{40}$/);
assert.match(runtime || '', /^la-taba-runtime-v[0-9]+[-a-z0-9]+$/);

const fetchText = async (pathname) => {
  const response = await fetch(`${origin}/${pathname}`, {
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10_000),
  });
  assert.equal(response.status, 200, `${pathname} unavailable`);
  return response.text();
};
const deadline = Date.now() + 180_000;
let version;
while (Date.now() < deadline) {
  try { version = JSON.parse(await fetchText('version.json')); } catch { /* wait for alias */ }
  if (version?.commit === commit && version?.runtime === runtime) break;
  await new Promise((resolve) => setTimeout(resolve, 5000));
}
assert.equal(version?.commit, commit, 'Staging Pages did not converge to exact SHA');
assert.equal(version?.runtime, runtime, 'Staging Pages runtime mismatch');
const sandbox = { globalThis: {} };
vm.runInNewContext(await fetchText('runtime-config.js'), sandbox, { timeout: 1000 });
const config = sandbox.globalThis.__LA_TABA_RUNTIME_CONFIG__;
assert.equal(config?.mode, 'production');
assert.equal(config?.repository?.deploymentEnvironment, 'staging');
assert.equal(config?.repository?.supabaseUrl, `https://${REF}.supabase.co`);
assert.equal(config?.repository?.businessId, BUSINESS);
assert.ok(String(config?.repository?.publishableKey || '').startsWith('sb_publishable_'));
const worker = await fetchText('sw.js');
assert.ok(worker.includes(`const CACHE_NAME = '${runtime}';`));
const html = await fetchText('');
assert.ok(/<html\b/i.test(html) && /La Taba/i.test(html));
console.log(JSON.stringify({ stagingPublicSmoke: 'PASS', commit, runtime,
  project: REF, business: BUSINESS, productionUntouched: true }));
