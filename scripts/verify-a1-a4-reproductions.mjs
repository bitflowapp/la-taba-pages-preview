// Dedicated local reproduction, not a deployment command.
// Usage: TABA_LOCAL_PAYMENT_DB=1 node --experimental-vm-modules
//   scripts/verify-a1-a4-reproductions.mjs <disposable-container>
// Requires the complete migration set in a network-disabled PostgreSQL and
// exercises old/current handlers against actual authoritative SQL snapshots.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const container = process.argv[2];
if (process.env.TABA_LOCAL_PAYMENT_DB !== '1' || !/^taba-a1-a4-local-[\w-]+$/.test(container || '')) {
  throw new Error('Only an explicitly authorized disposable local database is allowed');
}
const inspection = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8' }))[0];
assert.equal(inspection.HostConfig.NetworkMode, 'none');
assert.equal(inspection.Mounts.some(m => m.Type === 'bind'), false);
const args = ['exec', '-i', container, 'psql', '-h', '/tmp', '-U', 'postgres', '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'];
const sql = query => execFileSync('docker', args, { input: 'set search_path=public,extensions;\n' + query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const BASELINE = 'a56a9c54c155d6b0c1eb088c3dbe93edbfd10b7f';
const MIGRATION = 'supabase/migrations/20260908164550_current_payment_authority_and_refund_identity.sql';
const uid = randomUUID(), bid = randomUUID(), product = randomUUID(), asset = randomUUID();
const lifecycle = fs.readFileSync('supabase/tests/mercadopago_checkout_pro.local.sql', 'utf8');
let fixture = lifecycle.slice(0, lifecycle.indexOf('  v_prepare := public.prepare_mercadopago_preference')) + '\nend; $$; commit;';
for (const [old, value] of [['10000000-0000-4000-8000-000000000001', uid], ['20000000-0000-4000-8000-000000000001', bid],
  ['30000000-0000-4000-8000-000000000001', product], ['40000000-0000-4000-8000-000000000001', asset]]) fixture = fixture.replaceAll(old, value);
fixture = fixture.replaceAll('mp-lifecycle-fixture', 'mp-local-' + bid).replaceAll('mp-checkout-test@example.invalid', uid + '@example.invalid');
sql(fixture);
const { sid, iid } = JSON.parse(sql(`select json_build_object('sid',cs.id,'iid',pi.id) from checkout_sessions cs
  join payment_intents pi on pi.checkout_session_id=cs.id where cs.business_id=${quote(bid)}`));
sql(`update payment_intents set environment='production',provider_payment_id='90001' where id=${quote(iid)};
  update business_payment_settings set environment='production',production_review_status='approved',
  collector_id='123456789',application_id='7677852968049976' where business_id=${quote(bid)};`);

let mode, route, mutation, handler, refundResource;
const env = new Map(Object.entries({
  SUPABASE_URL: 'https://wwcpogltfgzgkrlilbcd.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
  SUPABASE_ANON_KEY: 'fixture-anon', MERCADOPAGO_ENVIRONMENT: 'production', MERCADOPAGO_OAUTH_ENVIRONMENT: 'production',
  MERCADOPAGO_CREDENTIAL_MODE: 'oauth', MERCADOPAGO_PRODUCTION_REVIEW_STATUS: 'approved',
  MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION: 'I_AUTHORIZE_REAL_MERCADOPAGO_PAYMENT_SMOKE',
  TABA_DEPLOYMENT_ENV: 'production', MERCADOPAGO_OAUTH_PROJECT_REF: 'wwcpogltfgzgkrlilbcd',
  MERCADOPAGO_CLIENT_ID: '7677852968049976', MERCADOPAGO_OAUTH_PANEL_URL: 'https://la-taba.pages.dev/',
  TABA_CHECKOUT_BASE_URL: 'https://la-taba.pages.dev', TABA_ALLOWED_ORIGINS: 'https://la-taba.pages.dev',
  PAYMENT_LOG_HASH_SALT: 'fixture-salt', MERCADOPAGO_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64url'),
}));
const copy = value => structuredClone(value);
const client = {
  auth: { getUser: async () => ({ data: { user: { id: uid } }, error: null }) },
  from(table) {
    assert.ok(['businesses', 'business_payment_settings', 'mp_seller_connections', 'payment_intents'].includes(table));
    const filters = [];
    const query = { select() { return query; }, eq(key, value) { assert.match(key, /^\w+$/); filters.push(key + '=' + quote(value)); return query; },
      async maybeSingle() { return { data: JSON.parse(sql(`select coalesce((select to_jsonb(t) from ${table} t where ${filters.join(' and ')}),'null'::jsonb)`)), error: null }; },
      async single() { return query.maybeSingle(); } };
    return query;
  },
  async rpc(name, body) {
    if (name === 'consume_payment_rate_limit') return { data: { allowed: true }, error: null };
    if (name === 'get_mercadopago_payment_authority') return { data: JSON.parse(sql(`select public.get_mercadopago_payment_authority(${[bid, 'production', sid, uid].map(quote).join(',')})`)), error: null };
    if (name === 'prepare_mercadopago_preference') {
      assert.equal(body.p_customer_id, uid);
      return { data: { checkout_session_id: sid, payment_intent_id: iid, payment_attempt_id: iid,
        attempt_status: route === 'stored' ? 'created' : 'prepared', init_point: route === 'stored' ? 'https://www.mercadopago.com.ar/fixture' : null,
        currency: 'ARS', environment: 'production', total: 2500, external_reference: 'fixture-reference', idempotency_key: iid,
        expires_at: new Date(Date.now() + 600000).toISOString(), items: [{ id: product, quantity: 2, unit_price: 1250, currency_id: 'ARS', title: 'Fixture' }],
      }, error: null };
    }
    if (name.startsWith('record_mercadopago_preference')) return { data: true, error: null };
    throw new Error('Unexpected SQL transport request: ' + name);
  },
};
let ciphertext, rotated;
async function provider(input) {
  const url = new URL(String(input));
  assert.equal(url.origin, 'https://api.mercadopago.com');
  if (url.pathname === '/users/me') {
    if (mutation === 'disable') sql(`update business_payment_settings set enabled=false where business_id=${quote(bid)}`);
    if (mutation === 'close') sql(`update businesses set status='closed',ordering_enabled=false where id=${quote(bid)}`);
    if (mutation === 'credential') sql(`update mp_seller_connections set protected_tokens=${quote(rotated)} where business_id=${quote(bid)}`);
    if (mutation === 'generation') sql(`update mp_seller_connections set generation=gen_random_uuid() where business_id=${quote(bid)}`);
    return Response.json({ id: 123456789, site_id: 'MLA', tags: ['normal'] });
  }
  if (url.pathname === '/checkout/preferences/search') return Response.json({ elements: route === 'recovered' ? [{ id: 'fixture', external_reference: 'fixture-reference' }] : [] });
  if (url.pathname.startsWith('/checkout/preferences')) return Response.json({ id: 'fixture', init_point: 'https://www.mercadopago.com.ar/fixture' });
  throw new Error('Unmocked provider I/O is forbidden');
}
async function load(relative, baseline) {
  const cache = new Map();
  const context = vm.createContext({ URL, URLSearchParams, Headers, Request, Response, TextEncoder, TextDecoder,
    crypto: globalThis.crypto, AbortSignal, AbortController, Uint8Array, setTimeout, clearTimeout, btoa, atob,
    console: { info() {} }, Deno: { env: { get: key => env.get(key) }, serve: fn => { handler = fn; } }, fetch: provider });
  function moduleFor(file) {
    if (cache.has(file)) return cache.get(file);
    const source = file.startsWith('npm:') ? '' : baseline
      ? execFileSync('git', ['show', BASELINE + ':' + path.relative(process.cwd(), file).replaceAll('\\', '/')], { encoding: 'utf8' })
      : fs.readFileSync(file, 'utf8');
    const module = file.startsWith('npm:') ? new vm.SyntheticModule(['createClient'], function () { this.setExport('createClient', () => client); }, { context, identifier: file })
      : new vm.SourceTextModule(stripTypeScriptTypes(source, { mode: 'transform' }), { context, identifier: file });
    cache.set(file, module); return module;
  }
  const module = moduleFor(path.resolve(relative));
  await module.link((specifier, parent) => moduleFor(specifier.startsWith('npm:') ? specifier : path.resolve(path.dirname(parent.identifier), specifier)));
  await module.evaluate(); return { exports: module.namespace, cache };
}

for (mode of ['old', 'new']) {
  const modules = await load('supabase/functions/mercadopago-create-preference/index.ts', mode === 'old');
  const oauth = modules.cache.get(path.resolve('supabase/functions/_shared/seller-oauth.ts')).namespace;
  ciphertext = await oauth.protect({ access_token: 'fixture-verified-token' }, bid);
  rotated = await oauth.protect({ access_token: 'fixture-rotated-token' }, bid);
  sql(`insert into mp_seller_connections(business_id,environment,seller_id,application_id,status,protected_tokens,expires_at)
    values(${quote(bid)},'production','123456789','7677852968049976','connected',${quote(ciphertext)},now()+interval '2 days')
    on conflict(business_id,environment) do update set protected_tokens=excluded.protected_tokens;`);
  for (route of ['stored', 'recovered', 'new']) for (mutation of ['none', 'disable', 'close', 'credential', 'generation']) {
    sql(`update businesses set status='open',ordering_enabled=true where id=${quote(bid)};
      update business_payment_settings set enabled=true where business_id=${quote(bid)};
      update mp_seller_connections set protected_tokens=${quote(ciphertext)} where business_id=${quote(bid)};`);
    const response = await handler(new Request('https://wwcpogltfgzgkrlilbcd.supabase.co/functions/v1/mercadopago-create-preference', {
      method: 'POST', headers: { authorization: 'Bearer fixture-user', 'content-type': 'application/json' }, body: JSON.stringify({ checkout_session_id: sid }),
    }));
    const result = await response.json();
    const expected = mutation === 'none' || (mode === 'old' && mutation !== 'generation');
    assert.equal(Boolean(result.init_point), expected, JSON.stringify({ mode, route, mutation, result }));
    console.log(JSON.stringify({ mode, route, mutation, urlReleased: Boolean(result.init_point), status: response.status }));
  }
}

// Run the exact refund misassociation inputs against each correlation version
// and the corresponding actual SQL recorder, not a JS imitation of PostgreSQL.
for (mode of ['old', 'new']) {
  if (mode === 'old') {
    const migration = fs.readFileSync('supabase/migrations/20260908070341_astra_p2_webhook_retry_and_refund_identity.sql', 'utf8');
    const start = migration.indexOf('create or replace function public.record_payment_refund_response(');
    sql(migration.slice(start, migration.indexOf('revoke all', start)));
  } else sql(fs.readFileSync(MIGRATION, 'utf8'));
  const { exports: correlation } = await load('supabase/functions/_shared/refund-correlation.ts', mode === 'old');
  for (const scenario of ['missing-date', 'prior', 'future', 'two-candidates']) {
    const rid = randomUUID(), id = String(100000 + Math.floor(Math.random() * 900000000));
    const requested = new Date().toISOString();
    refundResource = { id, amount: 100, status: 'approved', payment_id: '90001' };
    if (scenario === 'prior') refundResource.date_created = new Date(Date.now() - 60000).toISOString();
    if (scenario === 'future') refundResource.date_created = '2099-01-01T00:00:00Z';
    const candidates = scenario === 'two-candidates' ? [refundResource, { ...refundResource, id: id + '1' }] : [refundResource];
    sql(`insert into payment_refunds(id,payment_intent_id,amount,status,requested_at) values(${quote(rid)},${quote(iid)},100,'ambiguous',${quote(requested)})`);
    const result = correlation.correlateProviderRefund(copy(candidates), { amount: 100, requestedAt: requested }, new Set());
    if (result.kind === 'matched') sql(`select record_payment_refund_response(${[rid, result.outcome.id, 'approved', 100, 'a'.repeat(64)].map(quote).join(',')})`);
    const status = sql(`select status from payment_refunds where id=${quote(rid)}`);
    assert.equal(status, mode === 'old' && scenario !== 'two-candidates' ? 'approved' : 'ambiguous');
    console.log(JSON.stringify({ mode, scenario, correlation: result.kind, persistedStatus: status }));
  }
}

function asyncSql(query) {
  return new Promise((resolve, reject) => {
    const proc = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] }); let output = '', error = '';
    proc.stdout.on('data', chunk => { output += chunk; }); proc.stderr.on('data', chunk => { error += chunk; });
    proc.on('close', code => code ? reject(new Error(error)) : resolve(output)); proc.stdin.end(query);
  });
}
const rid = randomUUID(), key = randomUUID();
sql(`insert into payment_refunds(id,payment_intent_id,idempotency_key,amount,status) values(${[rid, iid, key].map(quote).join(',')},100,'ambiguous');
  select record_payment_refund_identity(${[rid, iid, '90001', key, '99000001'].map(quote).join(',')});`);
await Promise.all(Array.from({ length: 8 }, (_, i) => asyncSql(`begin;
  select public.record_payment_refund_response(${[rid, '99000001', 'approved', 100, String(i + 1).repeat(64)].map(quote).join(',')});
  select pg_sleep(0.05); commit;`)));
assert.equal(Number(sql(`select count(*) from payment_events where details->>'refund_id'=${quote(rid)}`)), 1);
console.log('A4_CONCURRENT_RECORDINGS: 8 requests, 1 financial event');
console.log('OLD_REPRODUCTION: FAILS_AS_EXPECTED_BEFORE_FIX');
console.log('NEW_REPRODUCTION: BLOCKED_AFTER_FIX');
