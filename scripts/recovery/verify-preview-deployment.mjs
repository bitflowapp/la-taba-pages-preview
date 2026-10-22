// What EXACTLY does the QA preview serve, and is it the build that was prepared?
//
//   node scripts/recovery/verify-preview-deployment.mjs --url https://recovery-20261020.taba2-staging.pages.dev \
//        --receipt <artifact-dir>-receipt.json [--expect-commit <sha>] [--wait-ms 180000]
//
// READ ONLY: it only issues GET requests to the preview. It compares, byte for byte (SHA-256), every file the
// prepared artifact contains against what Cloudflare serves, then reads the three identities that decide whether a
// PWA client will update: version.json (commit + runtime), the CACHE_NAME declared by the served sw.js, and the
// caching headers that let the browser notice a new service worker. With --wait-ms it polls until the preview
// converges on the expected build (Pages publishes asynchronously) and fails if it does not.
// Exit 0 = the preview is exactly the prepared build. 1 = it is not.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';

const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const base = new URL(arg('--url') || '').origin;
assert.match(base, /^https:\/\/[a-z0-9-]+\.taba2-staging\.pages\.dev$/, 'Only the authorized QA preview may be inspected');
const receipt = JSON.parse(fs.readFileSync(arg('--receipt') || '', 'utf8'));
const expectedCommit = arg('--expect-commit') || receipt.commit;
const waitMs = Number(arg('--wait-ms') || 0);
const NOT_SERVED = new Set(['_headers', '_worker.js', '_redirects', '_routes.json']);

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
async function get(path) {
  const response = await fetch(base + path, { redirect: 'follow', signal: AbortSignal.timeout(60000), headers: { 'cache-control': 'no-cache' } });
  return { status: response.status, headers: response.headers, bytes: Buffer.from(await response.arrayBuffer()) };
}

async function inspect() {
  const version = await get('/version.json');
  const served = version.status === 200 ? JSON.parse(version.bytes.toString('utf8')) : null;
  const files = receipt.files.filter(file => !NOT_SERVED.has(file.path));
  const different = [];
  const missing = [];
  let identical = 0;
  const queue = [...files];
  await Promise.all(Array.from({ length: 12 }, async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      const response = await get('/' + file.path.split('/').map(encodeURIComponent).join('/'));
      if (response.status !== 200) missing.push({ path: file.path, status: response.status });
      else if (sha256(response.bytes) !== file.sha256) different.push(file.path);
      else identical += 1;
    }
  }));
  const sw = await get('/sw.js');
  const servedCache = /const CACHE_NAME = '([^']+)';/.exec(sw.bytes.toString('utf8'))?.[1] || null;
  const headerOf = async path => {
    const response = await get(path);
    return { status: response.status, cacheControl: response.headers.get('cache-control'), robots: response.headers.get('x-robots-tag') };
  };
  const headers = { sw: await headerOf('/sw.js'), index: await headerOf('/'), version: await headerOf('/version.json'), runtimeConfig: await headerOf('/runtime-config.js') };
  const revalidates = value => /no-cache|no-store|max-age=0|must-revalidate/i.test(value || '');
  const checks = {
    versionServed: served !== null,
    commitMatches: served?.commit === expectedCommit,
    runtimeMatches: served?.runtime === receipt.runtime,
    builtAtMatches: served?.builtAt === receipt.builtAt,
    serviceWorkerCacheMatches: servedCache === receipt.runtime,
    everyFileIdentical: different.length === 0 && missing.length === 0,
    serviceWorkerRevalidates: revalidates(headers.sw.cacheControl),
    shellRevalidates: revalidates(headers.index.cacheControl),
    versionRevalidates: revalidates(headers.version.cacheControl),
    noindex: /noindex/i.test(headers.index.robots || ''),
  };
  return {
    url: base,
    expected: { commit: expectedCommit, runtime: receipt.runtime, builtAt: receipt.builtAt },
    served: { commit: served?.commit ?? null, runtime: served?.runtime ?? null, builtAt: served?.builtAt ?? null, serviceWorkerCache: servedCache },
    files: { expected: files.length, identical, different, missing },
    headers,
    checks,
    passed: Object.values(checks).every(Boolean),
  };
}

const startedAt = Date.now();
let result = await inspect();
// Pages publishes asynchronously: converge, but never wait forever and never call a stale preview good.
while (!result.passed && Date.now() - startedAt < waitMs) {
  await new Promise(resolve => setTimeout(resolve, 15000));
  result = await inspect();
}
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
