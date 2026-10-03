// Certificador e-commerce: los tres destinos y sus resguardos. Lo primero que hace este archivo es instalar el
// cerrojo de salida del certificador, así nada de lo que corre acá (ni un error del código bajo prueba) puede
// abrir un socket fuera de loopback. Las «claves» del stack se arman en la prueba con un rol y sin `ref`, como
// las que genera la CLI para un stack local: ninguna es una credencial.
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';

import { egressLockIsInstalled, installEgressLock, isLoopbackHost, offMachine } from '../scripts/e2e-staging/ecommerce/egress.mjs';

const egress = installEgressLock({ errorPrefix: 'TEST_EGRESS_REFUSED' });
const env = await import('../scripts/e2e-staging/ecommerce/env.mjs');
const { createStackGuard, resolveStackInputs, STACK_INPUTS } = await import('../scripts/e2e-staging/ecommerce/stack-target.mjs');
const { createLocalTarget, LOCAL_KEYS, LOCAL_LABEL } = await import('../scripts/e2e-staging/ecommerce/local-target.mjs');

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
// Una «clave» con la forma de las del stack local: encabezado, carga con el rol y una firma cualquiera.
const localKey = (claims) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase-demo', exp: 1983812996, ...claims })}.firma-de-prueba`;
const stackEnv = (overrides = {}) => ({
  [STACK_INPUTS.apiUrl]: 'http://127.0.0.1:54321',
  [STACK_INPUTS.anonKey]: localKey({ role: 'anon' }),
  [STACK_INPUTS.serviceKey]: localKey({ role: 'service_role' }),
  [STACK_INPUTS.dbUrl]: 'postgresql://postgres:clave-local@127.0.0.1:54322/postgres',
  ...overrides,
});

test('el cerrojo de salida frena antes de conectar todo lo que no es loopback', async () => {
  assert.ok(egressLockIsInstalled());
  for (const host of ['127.0.0.1', '::1', 'localhost', '[::1]']) assert.ok(isLoopbackHost(host), host);
  for (const host of ['192.0.2.1', 'example.invalid', '10.0.0.1', '', null]) assert.ok(!isLoopbackHost(host), String(host));
  assert.throws(() => new net.Socket().connect(443, '192.0.2.1'), /TEST_EGRESS_REFUSED:192\.0\.2\.1/);
  await assert.rejects(() => fetch('https://192.0.2.1/'), (error) => /TEST_EGRESS_REFUSED/.test(error.cause?.message));
  assert.deepEqual(offMachine({ destinations: { '127.0.0.1:1': 1, '192.0.2.1:443': 1 } }), ['192.0.2.1:443']);
});

test('Staging: los mismos resguardos de siempre, en cualquier destino', () => {
  assert.throws(() => env.assertGuardedRequest('https://tkanbadcglszlcyfjvpv.supabase.co/rest/v1/x'), /FORBIDDEN_REF/);
  assert.throws(() => env.assertGuardedRequest('https://example.com/'), /TARGET_HOST_NOT_ALLOWED/);
  assert.throws(() => env.assertGuardedRequest(`http://${env.STAGING_REF}.supabase.co/rest/v1/x`), /TARGET_NOT_HTTPS/);
  assert.throws(() => env.assertGuardedRequest(`https://api.supabase.com/v1/projects/${env.STAGING_REF}/secrets`), /MANAGEMENT_CALL_NOT_ALLOWED/);
  assert.throws(() => env.assertGuardedRequest(`${env.STAGING_URL}/rest/v1/businesses?id=eq.${env.PROTECTED_BUSINESS_IDS[0]}`), /PROTECTED_BUSINESS_REFERENCED/);
  assert.throws(() => env.assertGuardedRequest(`${env.STAGING_URL}/rest/v1/rpc/x`, { method: 'POST', body: JSON.stringify({ p_business_id: env.PROTECTED_BUSINESS_IDS[1] }) }),
    /PROTECTED_BUSINESS_REFERENCED/);
  assert.equal(env.assertGuardedRequest(`${env.STAGING_URL}/rest/v1/rpc/x`).hostname, `${env.STAGING_REF}.supabase.co`);
  for (const message of ['FORBIDDEN_REF:x', 'PROTECTED_BUSINESS_REFERENCED:x', 'WRITE_OUTSIDE_TENANT_REFUSED', 'TARGET_NOT_HTTPS', 'LOCAL_TARGET_REFUSED:x',
    'LOCAL_TARGET_EGRESS_REFUSED:x', 'STACK_TARGET_HOST_NOT_ALLOWED:x', 'STACK_TARGET_EGRESS_REFUSED:x', 'NETWORK_ORIGIN_CANNOT_BE_CHOSEN_ON_STAGING']) {
    assert.ok(env.isGuardStop(Error(message)), message);
    assert.ok(env.isGuardStop(Object.assign(TypeError('fetch failed'), { cause: Error(message) })), `cause ${message}`);
  }
  assert.ok(!env.isGuardStop(Error('fetch failed')) && !env.isGuardStop(Error('MGMT_HTTP_500')));
});

test('el resguardo de tenant: sólo los negocios que creó la corrida, nunca uno protegido', () => {
  const own = '11111111-2222-4333-8444-555555555555';
  const second = '66666666-7777-4888-9999-000000000000';
  const guard = env.createTenantGuard(own);
  assert.ok(guard.assertWrite(own));
  assert.throws(() => guard.assertWrite(second), /WRITE_OUTSIDE_TENANT_REFUSED/);
  guard.adopt(second);
  assert.ok(guard.assertWrite(second) && guard.owns(second));
  const decoy = guard.decoy();
  assert.throws(() => guard.assertWrite(decoy), /WRITE_OUTSIDE_TENANT_REFUSED/);
  assert.ok(guard.assertWrite(decoy, { allowDecoy: true }));
  assert.throws(() => guard.adopt(env.PROTECTED_BUSINESS_IDS[0]), /PROTECTED_BUSINESS_WRITE_REFUSED/);
  assert.throws(() => guard.assertWrite(env.PROTECTED_BUSINESS_IDS[1]), /PROTECTED_BUSINESS_WRITE_REFUSED/);
  assert.equal(guard.assertParams({ p_business_id: own, payload: { business_id: second, items: [] } }), 2);
  assert.throws(() => guard.assertParams({ payload: { business_id: '99999999-9999-4999-8999-999999999999' } }), /WRITE_OUTSIDE_TENANT_REFUSED/);
  assert.throws(() => env.createTenantGuard(env.PROTECTED_BUSINESS_IDS[0]), /TENANT_CANNOT_BE_A_PROTECTED_BUSINESS/);
  assert.throws(() => env.createTenantGuard('no-es-un-uuid'), /TENANT_ID_REQUIRED/);
});

test('el redactor borra secretos, tokens, URL de base con contraseña y rutas de disco', () => {
  const redactor = env.createRedactor();
  redactor.secret('un-secreto-largo');
  // Las rutas se arman acá: el control de higiene del repo no admite una ruta de disco escrita en un archivo.
  const drivePath = ['C:', 'Usuarios', 'alguien', 'archivo'].join('\\');
  const homePath = ['', 'home', 'alguien', 'archivo'].join('/');
  const text = redactor.scrub(`a un-secreto-largo b ${localKey({ role: 'service_role' })} postgresql://postgres:clave@127.0.0.1:54322/postgres ${drivePath} ${homePath}`);
  assert.ok(!text.includes('un-secreto-largo') && !text.includes('clave@') && !text.includes(drivePath) && !text.includes(homePath), text);
  assert.match(text, /<redacted:[0-9a-f]{10}>/);
  assert.match(env.createRedactor().redact({ access_token: 'x', password: 'y', nested: { apikey: 'z' } }), /"access_token": "<redacted>"[\s\S]*"apikey": "<redacted>"/);
});

test('Staging: identidad, lo que no puede probar y el origen que no se elige', async () => {
  const t = env.STAGING_TARGET;
  assert.deepEqual([t.kind, t.confirmation, t.runIdPrefix, t.canChooseOrigin, t.database], ['staging', 'STAGING_MUTATION_OK', 'ecom-cert-', false, null]);
  assert.equal(t.lacks('gotrue'), null);
  assert.equal(t.lacks('cloudflare'), null);
  assert.match(t.lacks('database_ownership'), /no es de esta herramienta/);
  assert.match(t.lacks('edge_function_probes'), /no las llama/);
  assert.throws(() => t.lacks('typo'), /UNKNOWN_PLATFORM_PIECE/);
  assert.throws(() => t.fromOrigin('203.0.113.9', () => 1), /NETWORK_ORIGIN_CANNOT_BE_CHOSEN_ON_STAGING/);
  assert.throws(() => t.originHeaders('203.0.113.9'), /NETWORK_ORIGIN_CANNOT_BE_CHOSEN_ON_STAGING/);
  assert.deepEqual(t.originHeaders(), {});
  const seen = [];
  const repoLedger = ['1_a', '2_b', '3_c'];
  const good = await t.assertIdentity({ check: (name, pass) => seen.push([name, pass]), project: { name: 'la-taba-staging', ref: env.STAGING_REF },
    db: { usr: 'supabase_read_only_user', migrations: 200, head: '2', ledger: ['1_a', '2_b'] }, repoLedger, keys: { ref: env.STAGING_REF, url: env.STAGING_URL } });
  assert.deepEqual(seen, [['MGMT_PROJECT_IS_LA_TABA_STAGING', true], ['KEYS_BOUND_TO_STAGING_REF', true], ['OBSERVER_IS_READ_ONLY_ROLE', true], ['STAGING_LEDGER_IS_KNOWN_TO_THE_REPO', true]]);
  assert.deepEqual(good, { ledger: { notDeployedYet: ['3_c'], unknownOnStaging: [] }, facts: null });
  seen.length = 0;
  await t.assertIdentity({ check: (name, pass) => seen.push([name, pass]), project: { name: 'otro', ref: 'x' },
    db: { usr: 'postgres', migrations: 10, head: '9', ledger: ['1_a', '9_z'] }, repoLedger, keys: { ref: 'x', url: 'https://x.supabase.co' } });
  assert.deepEqual(seen.map(([, pass]) => pass), [false, false, false, false]);
  assert.deepEqual([env.LOAD_PROFILES.staging.levels, env.LOAD_PROFILES.staging.maxConcurrency], [[10, 30], 30], 'Staging es compartido: nunca el nivel 100');
  assert.deepEqual([env.LOAD_PROFILES.stack.levels, env.LOAD_PROFILES.local.levels], [[10, 30, 100], [10, 30, 100]]);
});

test('stack: sus cuatro entradas vienen del entorno y nada que no sea loopback llega a abrir una conexión', () => {
  const inputs = resolveStackInputs(stackEnv());
  assert.deepEqual([inputs.apiUrl, inputs.apiHost, inputs.apiPort, inputs.dbHost, inputs.dbPort, inputs.dbName, inputs.keyIssuer],
    ['http://127.0.0.1:54321', '127.0.0.1', 54321, '127.0.0.1', 54322, 'postgres', 'supabase-demo']);
  assert.equal(resolveStackInputs(stackEnv({ [STACK_INPUTS.apiUrl]: 'http://localhost:54321/' })).apiUrl, 'http://localhost:54321');
  assert.throws(() => resolveStackInputs({}), new RegExp(`STACK_TARGET_INPUT_MISSING:${Object.values(STACK_INPUTS).join(',')}`));
  const refusedWith = (overrides, pattern) => assert.throws(() => resolveStackInputs(stackEnv(overrides)), pattern, JSON.stringify(overrides).slice(0, 80));
  refusedWith({ [STACK_INPUTS.apiUrl]: 'http://10.0.0.5:54321' }, /STACK_TARGET_API_URL_IS_NOT_LOOPBACK/);
  refusedWith({ [STACK_INPUTS.apiUrl]: 'http://127.0.0.1' }, /STACK_TARGET_API_URL_IS_NOT_LOOPBACK/);
  refusedWith({ [STACK_INPUTS.apiUrl]: 'http://127.0.0.1:54321/rest/v1' }, /STACK_TARGET_API_URL_IS_NOT_LOOPBACK/);
  refusedWith({ [STACK_INPUTS.apiUrl]: 'http://usuario:clave@127.0.0.1:54321' }, /STACK_TARGET_API_URL_IS_NOT_LOOPBACK/);
  refusedWith({ [STACK_INPUTS.apiUrl]: 'no es una url' }, /STACK_TARGET_API_URL_INVALID/);
  refusedWith({ [STACK_INPUTS.apiUrl]: `https://${env.STAGING_REF}.supabase.co` }, /STACK_TARGET_INPUT_NAMES_A_HOSTED_PROJECT/);
  refusedWith({ [STACK_INPUTS.apiUrl]: 'https://tkanbadcglszlcyfjvpv.supabase.co' }, /FORBIDDEN_REF/);
  refusedWith({ [STACK_INPUTS.dbUrl]: 'postgresql://postgres:x@db.example.invalid:5432/postgres' }, /STACK_TARGET_DB_URL_IS_NOT_LOOPBACK/);
  refusedWith({ [STACK_INPUTS.dbUrl]: 'postgresql://postgres:x@aws-0-sa-east-1.pooler.supabase.com:5432/postgres' }, /STACK_TARGET_INPUT_NAMES_A_HOSTED_PROJECT/);
  refusedWith({ [STACK_INPUTS.dbUrl]: 'mysql://127.0.0.1:3306/x' }, /STACK_TARGET_DB_URL_IS_NOT_LOOPBACK/);
  refusedWith({ [STACK_INPUTS.anonKey]: 'no-es-un-token' }, /STACK_TARGET_KEY_IS_NOT_A_LOCAL_JWT/);
  refusedWith({ [STACK_INPUTS.serviceKey]: localKey({ role: 'service_role', ref: 'unproyectoalojado' }) }, /STACK_TARGET_KEY_BELONGS_TO_A_HOSTED_PROJECT/);
  refusedWith({ [STACK_INPUTS.anonKey]: localKey({ role: 'service_role' }) }, /STACK_TARGET_KEY_ROLE_MISMATCH/);
  const same = localKey({ role: 'anon' });
  refusedWith({ [STACK_INPUTS.anonKey]: same, [STACK_INPUTS.serviceKey]: same }, /STACK_TARGET_KEY_ROLE_MISMATCH/);
});

test('stack: el resguardo deja pasar sólo el origen del stack y sus tres prefijos', () => {
  const guard = createStackGuard('http://127.0.0.1:54321');
  for (const pathname of ['/rest/v1/rpc/x', '/rest/v1', '/auth/v1/token?grant_type=password', '/functions/v1/mercadopago-webhook?data.id=1']) {
    assert.equal(guard(`http://127.0.0.1:54321${pathname}`).origin, 'http://127.0.0.1:54321', pathname);
  }
  assert.throws(() => guard('http://127.0.0.1:54322/rest/v1/'), /STACK_TARGET_HOST_NOT_ALLOWED/);
  assert.throws(() => guard('http://localhost:54321/rest/v1/'), /STACK_TARGET_HOST_NOT_ALLOWED/);
  assert.throws(() => guard(`https://${env.STAGING_REF}.supabase.co/rest/v1/`), /STACK_TARGET_HOST_NOT_ALLOWED/);
  assert.throws(() => guard('http://127.0.0.1:54321/storage/v1/object/x'), /STACK_TARGET_PATH_NOT_ALLOWED/);
  assert.throws(() => guard('http://127.0.0.1:54321/rest/v1x'), /STACK_TARGET_PATH_NOT_ALLOWED/);
  assert.throws(() => guard('http://127.0.0.1:54321/rest/v1/tkanbadcglszlcyfjvpv'), /FORBIDDEN_REF/);
  assert.throws(() => guard(`http://127.0.0.1:54321/rest/v1/businesses?id=eq.${env.PROTECTED_BUSINESS_IDS[0]}`), /PROTECTED_BUSINESS_REFERENCED/);
  assert.throws(() => guard('http://127.0.0.1:54321/rest/v1/rpc/x', { body: JSON.stringify({ p_business_id: env.PROTECTED_BUSINESS_IDS[1] }) }), /PROTECTED_BUSINESS_REFERENCED/);
});

test('local: lo que llega a PostgREST es lo que dejaría pasar la puerta de Supabase', async (t) => {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => { received.push({ method: req.method, url: req.url, headers: req.headers, body }); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  process.env.FAKE_GATE_PORT = String(server.address().port);
  process.env.TABA_LOCAL_GATE = path.join(import.meta.dirname, 'fixtures', 'ecommerce-certifier-fake-gate.mjs');
  const target = await createLocalTarget();
  t.after(() => target.close());
  const decode = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  assert.deepEqual([target.kind, target.label, target.confirmation, target.apiUrl, target.canChooseOrigin], ['local', LOCAL_LABEL, 'LOCAL_MUTATION_OK', `http://127.0.0.1:${server.address().port}`, true]);
  assert.match(target.lacks('gotrue'), /GoTrue no existe/);
  assert.match(target.lacks('scheduler'), /pg_cron no corre/);
  assert.equal(target.lacks('database_ownership'), null);
  const rest = (suffix, init) => target.fetch(`${env.STAGING_URL}/rest/v1/${suffix}`, init);
  const keyHeaders = (key, extra = {}) => ({ apikey: key, Authorization: `Bearer ${key}`, ...extra });
  await assert.rejects(() => rest('products?select=id', { headers: keyHeaders(LOCAL_KEYS.publishable) }), /LOCAL_TARGET_RUN_NOT_BOUND/);
  target.bindRun('ecom-cert-local-20261003-041500');
  await rest('products?select=id&business_id=eq.x', { headers: keyHeaders(LOCAL_KEYS.publishable, { Prefer: 'count=exact' }) });
  let last = received.at(-1);
  assert.equal(last.url, '/products?select=id&business_id=eq.x');
  assert.equal(last.headers.apikey, undefined);
  assert.equal(decode(last.headers.authorization.slice(7)).role, 'anon');
  assert.match(last.headers['cf-connecting-ip'], /^203\.0\.113\.[0-9]{1,3}$/);
  assert.equal(last.headers.prefer, 'count=exact, timezone=UTC');
  const runOrigin = last.headers['cf-connecting-ip'];
  await rest('rpc/f', { method: 'POST', headers: keyHeaders(LOCAL_KEYS.secret), body: '{}' });
  assert.equal(decode(received.at(-1).headers.authorization.slice(7)).role, 'service_role');
  // Un cf-connecting-ip escrito por el cliente se rechaza como en el borde real; x-forwarded-for llega «falso, real».
  const count = received.length;
  const forged = await rest('rpc/f', { method: 'POST', headers: keyHeaders(LOCAL_KEYS.publishable, { 'CF-Connecting-IP': '198.51.100.9' }), body: '{}' });
  assert.deepEqual([forged.status, received.length], [403, count]);
  await rest('rpc/f', { method: 'POST', headers: keyHeaders(LOCAL_KEYS.publishable, { 'X-Forwarded-For': '198.51.100.9' }), body: '{}' });
  assert.deepEqual([received.at(-1).headers['x-forwarded-for'], received.at(-1).headers['cf-connecting-ip']], [`198.51.100.9, ${runOrigin}`, runOrigin]);
  const other = target.originOf('otra-red');
  await target.fromOrigin(other, () => rest('rpc/f', { method: 'POST', headers: keyHeaders(LOCAL_KEYS.publishable), body: '{}' }));
  assert.equal(received.at(-1).headers['cf-connecting-ip'], other);
  assert.throws(() => target.fromOrigin('8.8.8.8', () => 1), /LOCAL_TARGET_ORIGIN_IS_NOT_A_DOCUMENTATION_ADDRESS/);
  const edge = await target.fetch(`${env.STAGING_URL}/functions/v1/x`, { method: 'POST', body: '{}' });
  assert.equal(edge.status, 404);
  const before = received.length;
  await assert.rejects(() => rest('rpc/f', { method: 'POST', body: '{}' }), /LOCAL_TARGET_REFUSED:request without the project key/);
  await assert.rejects(() => target.fetch(`${env.STAGING_URL}/storage/v1/object/x`), /LOCAL_TARGET_REFUSED/);
  await assert.rejects(() => target.fetch('https://example.com/'), /TARGET_HOST_NOT_ALLOWED/);
  assert.equal(received.length, before, 'nada de lo rechazado llegó al backend');
  assert.ok(Object.keys(egress.destinations).every((destination) => destination.startsWith('127.0.0.1:')), JSON.stringify(egress.destinations));
});
