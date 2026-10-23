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
// A receipt prepared with --access-gate is read through the gate with the stored QA credential (never printed), and
// the gate itself is checked: no credential and a wrong one must both get 401.
// Exit 0 = the preview is exactly the prepared build. 1 = it is not.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';

const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const base = new URL(arg('--url') || '').origin;
assert.match(base, /^https:\/\/[a-z0-9-]+\.taba2-staging\.pages\.dev$/, 'Only the authorized QA preview may be inspected');
const receipt = JSON.parse(fs.readFileSync(arg('--receipt') || '', 'utf8'));
const expectedCommit = arg('--expect-commit') || receipt.commit;
const waitMs = Number(arg('--wait-ms') || 0);
const NOT_SERVED = new Set(['_headers', '_worker.js', '_redirects', '_routes.json']);
const gate = receipt.accessGate ? leerSecreto('RECOVERY PREVIEW ACCESS') : null;
assert.ok(!receipt.accessGate || (gate?.usuario && gate?.secreto), 'Gated preview: the QA access credential is unavailable');
const basic = (user, password) => `Basic ${Buffer.from(`${user}:${password}`, 'utf8').toString('base64')}`;
const authorization = gate ? basic(gate.usuario, gate.secreto) : null;

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
async function get(path, credential = authorization) {
  const headers = { 'cache-control': 'no-cache', ...(credential ? { authorization: credential } : {}) };
  const response = await fetch(base + path, { redirect: 'follow', signal: AbortSignal.timeout(60000), headers });
  return { status: response.status, headers: response.headers, bytes: Buffer.from(await response.arrayBuffer()) };
}

// The gate's cookie path, as a browser walks it: a navigation without access goes to the login form, the right
// password gives a session cookie, and the session serves the site (also what the service worker asks for).
async function inspectGate() {
  // node:https, not fetch: undici sets its own Sec-Fetch-Mode and would hide what a browser navigation looks like.
  const raw = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const request = https.request(base + path, { method, headers, timeout: 60000 }, response => {
      response.resume();
      resolve({ status: response.statusCode, headers: { get: name => [].concat(response.headers[name.toLowerCase()] ?? []).join(', ') || null } });
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', reject);
    request.end(body);
  });
  const form = password => raw('/__acceso', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-mode': 'navigate' },
    body: new URLSearchParams({ usuario: gate.usuario, clave: password, volver: '/' }).toString() });
  const navigation = await raw('/', { headers: { 'sec-fetch-mode': 'navigate', accept: 'text/html' } });
  const loginWrong = await form('x' + gate.secreto);
  const login = await form(gate.secreto);
  const setCookie = login.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0];
  const withSession = await raw('/', { headers: { 'sec-fetch-mode': 'navigate', cookie } });
  const swWithSession = await raw('/sw.js', { headers: { cookie } });
  return { anonymous: (await get('/', null)).status, wrong: (await get('/', basic(gate.usuario, 'x' + gate.secreto))).status,
    navigation: navigation.status, navigationTarget: navigation.headers.get('location'),
    loginWrong: loginWrong.status, loginWrongCookie: Boolean(loginWrong.headers.get('set-cookie')),
    login: login.status, sessionFlags: /^__Host-taba_qa=v1\./.test(setCookie) && ['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/'].every(flag => setCookie.includes(flag)),
    withSession: withSession.status, swWithSession: swWithSession.status };
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
  const gateStatus = gate ? await inspectGate() : null;
  const checks = {
    ...(gate ? { gateRefusesAnonymous: gateStatus.anonymous === 401, gateRefusesWrongPassword: gateStatus.wrong === 401,
      gateSendsNavigationToLogin: gateStatus.navigation === 302 && gateStatus.navigationTarget === '/__acceso?volver=%2F',
      gateLoginRefusesWrongPassword: gateStatus.loginWrong === 401 && !gateStatus.loginWrongCookie,
      gateLoginGivesSecureSession: gateStatus.login === 303 && gateStatus.sessionFlags,
      gateSessionServesSite: gateStatus.withSession === 200 && gateStatus.swWithSession === 200 } : {}),
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
    gate: gateStatus,
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
