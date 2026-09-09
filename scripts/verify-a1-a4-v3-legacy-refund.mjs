// Real deployed legacy refund handler against the V3 EXPAND database.
// Provider transport is mocked and every SQL decision is made by PostgreSQL.
import assert from 'node:assert/strict';
import path from 'node:path';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const container = process.argv[2];
if (process.env.TABA_LOCAL_PAYMENT_DB !== '1' || !/^taba-a1-a4-local-[\w-]+$/.test(container || '')) {
  throw new Error('Disposable local database required');
}
const inspection = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8' }))[0];
assert.equal(inspection.HostConfig.NetworkMode, 'none');
assert.equal(inspection.Mounts.some((mount) => mount.Type === 'bind'), false);
const args = ['exec', '-i', container, 'psql', '-h', '/tmp', '-U', 'postgres', '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'];
const sql = (query) => execFileSync('docker', args, { input: `set search_path=public,extensions;\n${query}`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const quote = (value) => value === null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
const fixture = JSON.parse(sql(`select json_build_object('iid',pi.id,'bid',pi.business_id,'uid',cs.customer_id)
  from payment_intents pi join checkout_sessions cs on cs.id=pi.checkout_session_id
  order by pi.created_at desc limit 1`));
assert.ok(fixture?.iid && fixture?.bid && fixture?.uid, 'payment fixture missing');
const { iid, bid, uid } = fixture;
const key = randomUUID(), sessionId = randomUUID();

sql(`begin; set local session_replication_role=replica;
  delete from payment_outbox where payment_intent_id=${quote(iid)};
  delete from payment_refunds where payment_intent_id=${quote(iid)};
  update payment_intents set internal_status='security_review_required',
    security_review_reason='approved_after_reservation_expired',provider_payment_id='90001',
    paid_amount=2500,refunded_amount=0,environment='test' where id=${quote(iid)};
  set local session_replication_role=origin;
  insert into business_members(business_id,user_id,role,is_active) values(${quote(bid)},${quote(uid)},'owner',true)
    on conflict(business_id,user_id) do update set role='owner',is_active=true;
  insert into identity_sessions(session_id,user_id,business_id,role_at_login,client)
    values(${quote(sessionId)},${quote(uid)},${quote(bid)},'owner','panel_web'); commit;`);

const claims = JSON.stringify({ sub: uid, session_id: sessionId });
const call = (name, params, actor = false) => JSON.parse(sql(`${actor ? `set request.jwt.claims=${quote(claims)};\n` : ''}
  select to_jsonb(public.${name}(${Object.entries(params).map(([keyName, value]) => `${keyName}=>${quote(value)}`).join(',')}))`));
const environment = new Map(Object.entries({
  SUPABASE_URL: 'https://ukxqbgswjlibmnjemrzd.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
  SUPABASE_ANON_KEY: 'fixture-anon', MERCADOPAGO_ENVIRONMENT: 'test', MERCADOPAGO_OAUTH_ENVIRONMENT: 'test',
  MERCADOPAGO_CREDENTIAL_MODE: 'oauth', TABA_DEPLOYMENT_ENV: 'staging',
  MERCADOPAGO_OAUTH_PROJECT_REF: 'ukxqbgswjlibmnjemrzd', MERCADOPAGO_CLIENT_ID: '2691240967769590',
  MERCADOPAGO_OAUTH_PANEL_URL: 'https://taba2-staging.pages.dev/', TABA_CHECKOUT_BASE_URL: 'https://taba2-staging.pages.dev',
  TABA_ALLOWED_ORIGINS: 'https://taba2-staging.pages.dev', PAYMENT_LOG_HASH_SALT: 'fixture-salt',
  MERCADOPAGO_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64url'),
}));
let handler, seller, providerPosts = 0, recorderCalls = 0;
const client = {
  auth: { getUser: async () => ({ data: { user: { id: uid } }, error: null }) },
  from(table) {
    const query = {
      select() { return query; }, eq() { return query; }, lt() { return query; }, limit() { return query; }, not() { return query; },
      async maybeSingle() {
        if (table === 'mp_seller_connections') return { data: seller, error: null };
        if (table === 'payment_intents') return { data: JSON.parse(sql(`select to_jsonb(i) from payment_intents i where id=${quote(iid)}`)), error: null };
        throw new Error(`Unexpected legacy table ${table}`);
      },
      async single() { return query.maybeSingle(); },
    };
    return query;
  },
  async rpc(name, params) {
    if (name === 'consume_payment_rate_limit') return { data: { allowed: true }, error: null };
    if (name === 'record_payment_refund_response') {
      recorderCalls += 1;
      return { data: null, error: { message: 'simulated post-approved persistence failure' } };
    }
    try {
      return { data: call(name, params, name === 'prepare_payment_refund'), error: null };
    } catch (_) {
      return { data: null, error: { message: 'fixture SQL rejected' } };
    }
  },
};
async function provider(input, init) {
  const url = new URL(String(input));
  assert.equal(url.origin, 'https://api.mercadopago.com');
  if (url.pathname === '/v1/payments/90001/refunds' && init?.method === 'POST') {
    providerPosts += 1;
    assert.equal(new Headers(init.headers).get('x-idempotency-key'), key);
    return Response.json({ id: 990001, payment_id: 90001, amount: 100, status: 'approved', date_created: new Date().toISOString() });
  }
  throw new Error(`Unexpected provider request ${url.pathname}`);
}

const cache = new Map();
const context = vm.createContext({
  URL, URLSearchParams, Headers, Request, Response, TextEncoder, TextDecoder,
  crypto: globalThis.crypto, AbortSignal, AbortController, Uint8Array,
  setTimeout, clearTimeout, btoa, atob, console: { info() {} },
  Deno: { env: { get: (name) => environment.get(name) }, serve: (fn) => { handler = fn; } }, fetch: provider,
});
function moduleFor(file) {
  if (cache.has(file)) return cache.get(file);
  const source = file.startsWith('npm:') ? '' : execFileSync('git', ['show', `a56a9c5:${path.relative(process.cwd(), file).replaceAll('\\', '/')}`], { encoding: 'utf8' });
  const module = file.startsWith('npm:')
    ? new vm.SyntheticModule(['createClient'], function () { this.setExport('createClient', () => client); }, { context, identifier: file })
    : new vm.SourceTextModule(stripTypeScriptTypes(source, { mode: 'transform' }), { context, identifier: file });
  cache.set(file, module); return module;
}
const entry = path.resolve('supabase/functions/mercadopago-refund/index.ts');
const module = moduleFor(entry);
await module.link((specifier, parent) => moduleFor(specifier.startsWith('npm:') ? specifier : path.resolve(path.dirname(parent.identifier), specifier)));
await module.evaluate();
const oauth = cache.get(path.resolve('supabase/functions/_shared/seller-oauth.ts')).namespace;
seller = {
  business_id: bid, environment: 'test', status: 'connected', seller_id: '123456789', application_id: '2691240967769590',
  protected_tokens: await oauth.protect({ access_token: 'fixture-token' }, bid), expires_at: new Date(Date.now() + 172800000).toISOString(),
  generation: randomUUID(), refresh_owner: null,
};
const request = () => new Request('https://ukxqbgswjlibmnjemrzd.supabase.co/functions/v1/mercadopago-refund', {
  method: 'POST', headers: { authorization: 'Bearer fixture-user', 'content-type': 'application/json', origin: 'https://taba2-staging.pages.dev' },
  body: JSON.stringify({ payment_intent_id: iid, idempotency_key: key, amount: 100, confirmation: 'I_UNDERSTAND_THIS_REQUESTS_A_MERCADO_PAGO_REFUND' }),
});

const first = await handler(request()), firstBody = await first.json();
assert.equal(first.status, 409, JSON.stringify({ firstBody, providerPosts, recorderCalls }));
assert.equal(firstBody.code, 'REFUND_NOT_AVAILABLE');
assert.equal(providerPosts, 1); assert.equal(recorderCalls, 1);
assert.equal(sql(`select status from payment_refunds where payment_intent_id=${quote(iid)} and idempotency_key=${quote(key)}`), 'requested');
const second = await handler(request()), secondBody = await second.json();
assert.equal(second.status, 202); assert.equal(secondBody.code, 'REFUND_RECONCILING');
assert.equal(providerPosts, 1, 'legacy retry issued a second provider POST');
assert.equal(recorderCalls, 1, 'legacy retry reached the result recorder again');
console.log('OLD_EDGE_EXPAND_DB_REAL_REFUND_HANDLER: PASS (approved, recorder failure, retry, one provider POST)');
