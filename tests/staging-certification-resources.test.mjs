import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { STAGING_CERTIFICATION_TARGET as staging, STAGING_CERTIFICATION_CONFIRMATION as confirmation } from '../scripts/lib/staging-certification-target.mjs';
import {
  certificationCleanup, createCertificationActor, verifyCertificationFixtures,
  ownedCertificationCheckout, releaseCertificationCheckout, verifyCertificationCustomer,
  boundedCertificationClient, certificationInterruption,
  retireCertificationCircuitOrder,
} from '../scripts/lib/staging-certification-resources.mjs';

const target = { supabaseUrl: staging.url, businessId: staging.businessId, confirmation };
const userId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
const operationalProductId = '44444444-4444-4444-8444-444444444444';
const isolationProductId = '55555555-5555-4555-8555-555555555555';
const requestId = `cert_mp_${'ab'.repeat(12)}`;
const ok = data => ({ data, error: null });

function queryClient(read) {
  const queries = [];
  return { queries, from(table) {
    const record = { table, filters: [] };
    queries.push(record);
    return {
      select(columns) { record.columns = columns; return this; },
      eq(key, value) { record.filters.push([key, value]); return this; },
      abortSignal(signal) { assert.ok(signal instanceof AbortSignal); return this; },
      maybeSingle() { return Promise.resolve(read(record)); },
    };
  } };
}

test('cleanup runs once in reverse order and continues after an independent failure', async () => {
  const cleanup = certificationCleanup();
  const actions = [];
  cleanup.add('ban', async () => { actions.push('ban'); });
  cleanup.add('membership', async () => { actions.push('membership'); throw new Error('private backend detail'); });
  cleanup.add('close_session', async () => { actions.push('session'); });
  const failed = await cleanup.run();
  assert.deepEqual(failed, ['membership']);
  assert.deepEqual(actions, ['session', 'membership', 'ban']);
  assert.equal(await cleanup.run(), failed);
  assert.throws(() => cleanup.add('late', () => {}), /ALREADY_STARTED/);
});

function actorEnvironment(failAt) {
  const actions = [];
  const cleanup = certificationCleanup();
  const result = (phase, data) => failAt === phase ? { error: { message: 'private credential detail' } } : ok(data);
  const service = {
    auth: { admin: {
      async createUser() { actions.push('create'); return result('create', { user: { id: userId } }); },
      async updateUserById(id, patch) { actions.push('ban'); assert.equal(id, userId); assert.equal(patch.ban_duration, '876000h'); return result('ban', { user: { id: userId, banned_until: '2999-01-01T00:00:00Z' } }); },
    } },
    from(table) {
      assert.equal(table, 'business_members');
      return {
        async insert(row) { actions.push('member'); assert.equal(row.business_id, staging.businessId); return result('member', {}); },
        update(row) { assert.equal(row.is_active, false); return this; },
        eq(key, value) { assert.equal(value, key === 'business_id' ? staging.businessId : userId); return this; },
        async select() { actions.push('revoke'); return result('revoke', [{ user_id: userId, is_active: false }]); },
      };
    },
  };
  const clientFor = () => ({
    auth: {
      async signInWithPassword() { actions.push('login'); return result('login', { session: { access_token: 'fake-access', refresh_token: 'fake-refresh' } }); },
      async setSession() { actions.push('cleanup_session'); return result('cleanup_session', {}); },
      async signOut(options) { assert.equal(options.scope, 'local'); actions.push('logout'); return result('logout', {}); },
    },
    async rpc(name, args) {
      assert.equal(args.p_business_id, staging.businessId);
      actions.push(name);
      return result(name, { ok: true, session_id: sessionId });
    },
  });
  return { actions, cleanup, args: { service, cleanupService: service, clientFor, target, role: 'staff', cleanup } };
}

test('a membership insertion failure still bans the newly-created actor', async () => {
  const fixture = actorEnvironment('member');
  await assert.rejects(createCertificationActor(fixture.args), /MEMBERSHIP_CREATE_FAILED/);
  assert.deepEqual(await fixture.cleanup.run(), []);
  assert.deepEqual(fixture.actions, ['create', 'member', 'revoke', 'ban']);
});

test('login and session-registration failures retire already-created resources', async () => {
  for (const phase of ['login', 'cleanup_session', 'identity_register_session']) {
    const fixture = actorEnvironment(phase);
    await assert.rejects(createCertificationActor(fixture.args));
    assert.deepEqual(await fixture.cleanup.run(), []);
    assert.ok(fixture.actions.includes('revoke'));
    assert.ok(fixture.actions.includes('ban'));
    if (phase === 'identity_register_session') assert.ok(fixture.actions.includes('identity_close_own_session'));
  }
});

test('a failed session close or membership revoke is reported while the ban still runs', async () => {
  for (const phase of ['identity_close_own_session', 'revoke', 'ban', 'logout']) {
    const fixture = actorEnvironment(phase);
    const actor = await createCertificationActor(fixture.args);
    assert.equal(actor.userId, userId);
    const failed = await fixture.cleanup.run();
    assert.equal(failed.length, 1, phase);
    assert.ok(fixture.actions.includes('ban'), phase);
    assert.ok(fixture.actions.includes('identity_register_session'));
  }
});

const product = { business_id: staging.businessId, name: 'QA', price: 1, stock: 5,
  is_active: true, available: true, is_verified: true, merchant_available: true, price_status: 'confirmed' };
const realProduct = { ...product, id: operationalProductId, catalog_origin: 'commercial' };
const qaProduct = { ...product, id: isolationProductId, catalog_origin: 'test_only' };
const selection = { operationalProductId, isolationProductId };

test('missing or identical explicit product IDs cause no reads or writes', async () => {
  for (const choice of [{}, { ...selection, isolationProductId: operationalProductId }, { ...selection, operationalProductId: 'auto' }]) {
    const client = queryClient(() => { throw new Error('must not read'); });
    await assert.rejects(verifyCertificationFixtures(client, target, choice), /EXPLICIT_FIXTURES_REQUIRED/);
    assert.deepEqual(client.queries, []);
  }
});

test('explicit commercial operational and isolation fixtures are accepted without catalog mutation', async () => {
  const client = queryClient(query => ok(query.filters.some(([, id]) => id === operationalProductId) ? realProduct : qaProduct));
  assert.deepEqual(await verifyCertificationFixtures(client, target, selection), { realProduct, qaProduct });
  for (const query of client.queries) assert.ok(query.filters.some(([key, value]) => key === 'business_id' && value === staging.businessId));
});

test('wrong tenant, disabled, unavailable, unverified, changed-price and exhausted fixtures fail closed', async () => {
  for (const change of [{ business_id: 'other' }, { id: isolationProductId }, { catalog_origin: 'test_only' },
    { is_active: false }, { available: false }, { is_verified: false }, { merchant_available: false },
    { price_status: 'pending' }, { price: 0 }, { price: 'NaN' }, { stock: 0 }, { stock: 1 }, { stock: 1.5 }]) {
    await assert.rejects(verifyCertificationFixtures(queryClient(() => ok({ ...realProduct, ...change })), target, selection), /FIXTURE_UNAVAILABLE/);
  }
  await assert.rejects(verifyCertificationFixtures(queryClient(query => ok(query.filters.some(([, id]) => id === operationalProductId)
    ? realProduct : { ...qaProduct, catalog_origin: 'commercial' })), target, selection), /FIXTURE_UNAVAILABLE/);
});

const checkout = { id: sessionId, business_id: staging.businessId, customer_id: userId,
  client_request_id: requestId, status: 'created', created_at: '2026-01-01T00:00:00Z', expires_at: '2026-01-01T00:01:00Z' };

function checkoutClient(change = {}, rpcResult) {
  let row = { ...checkout, ...change };
  const client = queryClient(() => ok(row));
  client.calls = [];
  client.rpc = async (name, args) => {
    client.calls.push({ name, args });
    if (rpcResult) return rpcResult;
    const released = row.status === args.p_terminal_status ? 0 : 1;
    row = { ...row, status: args.p_terminal_status };
    return ok({ released, status: row.status });
  };
  return client;
}

test('checkout ownership includes tenant, customer and exact run request, before any release', async () => {
  const client = checkoutClient();
  await ownedCertificationCheckout(client, target, sessionId, userId, requestId);
  assert.deepEqual(client.queries[0].filters, [['id', sessionId], ['business_id', staging.businessId], ['customer_id', userId], ['client_request_id', requestId]]);
  for (const change of [{ id: operationalProductId }, { business_id: 'other' }, { customer_id: isolationProductId }, { client_request_id: 'other' }]) {
    const wrong = checkoutClient(change);
    await assert.rejects(releaseCertificationCheckout(wrong, target, sessionId, userId, requestId), /OWNERSHIP_REJECTED/);
    assert.deepEqual(wrong.calls, []);
  }
});

test('release refuses unrelated requests, non-expired and protected financial states', async () => {
  for (const status of ['payment_approved', 'finalizing_order', 'completed', 'manual_review_required']) {
    const client = checkoutClient({ status });
    await assert.rejects(releaseCertificationCheckout(client, target, sessionId, userId, requestId), /FINANCIAL_STATE_REJECTED/);
    assert.deepEqual(client.calls, []);
  }
  const client = checkoutClient({ expires_at: '2999-01-01T00:00:00Z' });
  await assert.rejects(releaseCertificationCheckout(client, target, sessionId, userId, requestId, 'expired'), /NOT_EXPIRED/);
  await assert.rejects(releaseCertificationCheckout(client, target, sessionId, userId, 'another-run'), /CHECKOUT_IDENTITY_REQUIRED/);
  assert.deepEqual(client.calls, []);
});

test('only the owned session is released; retries release zero and cleanup preserves expired', async () => {
  const client = checkoutClient();
  assert.equal((await releaseCertificationCheckout(client, target, sessionId, userId, requestId, 'expired')).released, 1);
  assert.equal((await releaseCertificationCheckout(client, target, sessionId, userId, requestId, 'expired')).released, 0);
  assert.equal((await releaseCertificationCheckout(client, target, sessionId, userId, requestId)).status, 'expired');
  assert.ok(client.calls.every(call => call.name === 'release_checkout_session_inventory'
    && call.args.p_checkout_session_id === sessionId && call.args.p_terminal_status === 'expired'));
});

test('an approval race, upstream error or incomplete release cannot become a green cleanup', async () => {
  for (const result of [{ error: { message: 'private detail' } }, ok({ released: 0, skipped: true, status: 'payment_approved' }), ok({ released: 1, status: 'created' })]) {
    await assert.rejects(releaseCertificationCheckout(checkoutClient({}, result), target, sessionId, userId, requestId), /RELEASE_(FAILED|UNVERIFIED)/);
  }
});

test('customer access must belong to the same anonymous, unidentified test customer', async () => {
  const customer = { id: userId, is_anonymous: true };
  assert.equal(await verifyCertificationCustomer({ auth: { getUser: async () => ok({ user: customer }) } }, 'fake', userId), customer);
  for (const user of [{ ...customer, id: isolationProductId }, { ...customer, is_anonymous: false }, { ...customer, email: 'identified@test.invalid' }, { ...customer, phone: '123' }]) {
    await assert.rejects(verifyCertificationCustomer({ auth: { getUser: async () => ok({ user }) } }, 'fake', userId), /SESSION_REJECTED/);
  }
  await assert.rejects(verifyCertificationCustomer({}, '', userId), /SESSION_REQUIRED/);
});

function circuitCleanupEnvironment({ initial = {}, cancel = 'apply', classify = 'apply' } = {}) {
  let row = { id: sessionId, customer_user_id: userId, business_id: staging.businessId,
    public_code: 'LT-9999', revision: 1, status: 'received', origin: 'production', ...initial };
  const service = queryClient(() => ok(row));
  const calls = [];
  const staffClient = { async rpc(name, args) {
    calls.push(name);
    assert.equal(args.p_order_id, sessionId);
    if (cancel === 'error') return { error: { message: 'private failure' } };
    if (cancel === 'apply') row = { ...row, status: 'cancelled' };
    return ok({ ok: true });
  } };
  service.rpc = async (name, args) => {
    calls.push(name);
    assert.equal(args.p_order_id, sessionId);
    if (classify === 'error') return { error: { message: 'private failure' } };
    if (classify === 'apply') row = { ...row, origin: 'qa' };
    return ok({ ok: true });
  };
  return { calls, service, get row() { return row; }, args: { service, staffClient, target,
    orderId: sessionId, customerId: userId, publicCode: 'LT-9999',
    idempotencyKey: `rc_retire_${'ab'.repeat(12)}` } };
}

test('circuit cleanup verifies scoped terminal and QA state while preserving completed orders', async () => {
  for (const status of ['received', 'delivered', 'cancelled']) {
    const fixture = circuitCleanupEnvironment({ initial: { status } });
    await retireCertificationCircuitOrder(fixture.args);
    assert.equal(fixture.row.status, status === 'received' ? 'cancelled' : status);
    assert.equal(fixture.row.origin, 'qa');
    assert.equal(fixture.calls.includes('transition_order'), status === 'received');
    for (const query of fixture.service.queries) assert.deepEqual(query.filters,
      [['business_id', staging.businessId], ['id', sessionId], ['customer_user_id', userId], ['public_code', 'LT-9999']]);
  }
});

test('a failed or falsely-successful cancellation still classifies QA and fails cleanup', async () => {
  for (const cancel of ['error', 'unchanged']) {
    const fixture = circuitCleanupEnvironment({ cancel });
    await assert.rejects(retireCertificationCircuitOrder(fixture.args), /ORDER_CLEANUP_FAILED/);
    assert.equal(fixture.row.origin, 'qa');
    assert.equal(fixture.row.status, 'received');
    assert.deepEqual(fixture.calls, ['transition_order', 'classify_order_as_qa']);
  }
});

test('circuit cleanup refuses foreign identity and reports a missing QA postcondition', async () => {
  for (const change of [{ id: operationalProductId }, { business_id: 'other' },
    { customer_user_id: isolationProductId }, { public_code: 'LT-other' }]) {
    const fixture = circuitCleanupEnvironment({ initial: change });
    await assert.rejects(retireCertificationCircuitOrder(fixture.args), /OWNERSHIP_REJECTED/);
    assert.deepEqual(fixture.calls, []);
  }
  for (const classify of ['error', 'unchanged']) {
    const fixture = circuitCleanupEnvironment({ classify });
    await assert.rejects(retireCertificationCircuitOrder(fixture.args), /ORDER_CLEANUP_FAILED/);
    assert.equal(fixture.row.status, 'cancelled');
    assert.equal(fixture.row.origin, 'production');
  }
});

test('requests have bounded transport and interruption does not cancel the cleanup transport', async () => {
  const oldFetch = globalThis.fetch;
  const options = [];
  const interruption = certificationInterruption();
  try {
    globalThis.fetch = async (_, init) => {
      assert.ok(init.signal instanceof AbortSignal);
      init.signal.throwIfAborted();
      return 'read-only-double';
    };
    const sdk = (_, __, option) => { options.push(option); return option; };
    boundedCertificationClient(sdk, staging.url, 'fake', {}, interruption.signal);
    boundedCertificationClient(sdk, staging.url, 'fake');
    assert.equal(await options[0].global.fetch(staging.url), 'read-only-double');
    process.emit('SIGINT');
    await assert.rejects(options[0].global.fetch(staging.url), /INTERRUPTED/);
    assert.equal(await options[1].global.fetch(staging.url), 'read-only-double');
  } finally { globalThis.fetch = oldFetch; interruption.close(); }
});

test('real entrypoints refuse missing isolation data and invalid customer access before actor creation', () => {
  const root = resolve(tmpdir());
  const temporary = mkdtempSync(join(root, 'taba-certifier-resources-'));
  try {
    const loader = join(temporary, 'loader.mjs');
    const sdk = `export function createClient() {
      const rows = JSON.parse(process.env.TABA_TEST_ROWS);
      return {
        from(table) {
          const filters = [];
          return {
            select() { return this; }, eq(k,v) { filters.push([k,v]); return this; },
            limit() { return this; }, abortSignal() { return this; },
            async maybeSingle() {
              const key = table === 'products' ? filters.find(([k]) => k === 'id')[1] : table;
              if (!(key in rows)) throw new Error('CERTIFIER_UNEXPECTED_QUERY');
              return { data: rows[key], error: null };
            },
          };
        },
        auth: {
          async getUser() { return process.env.TABA_TEST_TOKEN_EXPIRED === 'true'
            ? { error: { message: 'expired' } } : { data: { user: rows.tokenUser }, error: null }; },
          admin: {
            async getUserById() { return { data: { user: rows.authUser }, error: null }; },
            async createUser() { throw new Error('CERTIFIER_ACTOR_REACHED'); },
          },
        },
      };
    }`;
    writeFileSync(loader, `export async function resolve(specifier, context, nextResolve) {
      if (specifier === '@supabase/supabase-js') return { url: ${JSON.stringify(`data:text/javascript,${encodeURIComponent(sdk)}`)}, shortCircuit: true };
      return nextResolve(specifier, context);
    }`);
    const rows = { businesses: { id: staging.businessId, slug: staging.businessSlug, is_active: true },
      business_payment_settings: { business_id: staging.businessId, environment: 'test' },
      [operationalProductId]: realProduct, [isolationProductId]: qaProduct,
      orders: { id: sessionId, business_id: staging.businessId, status: 'received', customer_user_id: userId },
      business_members: null, authUser: { id: userId, is_anonymous: true }, tokenUser: { id: userId, is_anonymous: true } };
    const invoke = (script, args, changes = {}, rowChanges = {}) => spawnSync(process.execPath, [
      '--no-warnings', '--experimental-loader', pathToFileURL(loader).href,
      fileURLToPath(new URL(`../scripts/${script}`, import.meta.url)), ...args,
    ], { encoding: 'utf8', timeout: 20_000, windowsHide: true, env: { ...process.env,
      SUPABASE_URL: staging.url, TABA_BUSINESS_ID: staging.businessId, TABA_CERTIFY_CONFIRM: confirmation,
      SUPABASE_SERVICE_ROLE_KEY: 'fake', SUPABASE_ANON_KEY: 'fake',
      TABA_CERTIFY_OPERATIONAL_PRODUCT_ID: operationalProductId, TABA_CERTIFY_ISOLATION_PRODUCT_ID: isolationProductId,
      TABA_CERTIFY_CUSTOMER_ACCESS_TOKEN: '', TABA_TEST_TOKEN_EXPIRED: 'false',
      TABA_TEST_ROWS: JSON.stringify({ ...rows, ...rowChanges }), ...changes,
    } });
    for (const [changes, rowChanges, refusal] of [
      [{ TABA_CERTIFY_ISOLATION_PRODUCT_ID: '' }, {}, 'EXPLICIT_FIXTURES_REQUIRED'],
      [{}, { [isolationProductId]: null }, 'FIXTURE_UNAVAILABLE'],
      [{}, { [isolationProductId]: { ...qaProduct, catalog_origin: 'commercial' } }, 'FIXTURE_UNAVAILABLE'],
    ]) {
      const result = invoke('certify-real-order-pipeline.mjs', [], changes, rowChanges);
      assert.ifError(result.error);
      assert.equal(result.status, 2, result.stderr);
      assert.ok(result.stderr.includes(refusal), result.stderr);
      assert.doesNotMatch(result.stderr, /ACTOR_REACHED/);
    }
    const valid = invoke('certify-real-order-pipeline.mjs', ['--fixtures-preflight-only']);
    assert.ifError(valid.error);
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(JSON.parse(valid.stdout).scope, 'staging_identity_and_fixtures');
    for (const [changes, rowChanges, refusal] of [
      [{}, {}, 'CUSTOMER_SESSION_REQUIRED'],
      [{ TABA_CERTIFY_CUSTOMER_ACCESS_TOKEN: 'fake', TABA_TEST_TOKEN_EXPIRED: 'true' }, {}, 'CUSTOMER_SESSION_READ_FAILED'],
      [{ TABA_CERTIFY_CUSTOMER_ACCESS_TOKEN: 'fake' }, { tokenUser: { id: isolationProductId, is_anonymous: true } }, 'CUSTOMER_SESSION_REJECTED'],
      [{}, { orders: { ...rows.orders, status: 'assigned', assigned_rider_user_id: isolationProductId } }, 'FRESH_UNASSIGNED_QA_ORDER_REQUIRED'],
    ]) {
      const result = invoke('certify-order-operational-circuit.mjs', ['LT-9999'], changes, rowChanges);
      assert.ifError(result.error);
      assert.equal(result.status, 2, result.stderr);
      assert.ok(result.stderr.includes(refusal), result.stderr);
      assert.doesNotMatch(result.stderr, /ACTOR_REACHED/);
    }
  } finally {
    assert.equal(dirname(resolve(temporary)), root);
    rmSync(temporary, { recursive: true, force: true });
  }
});
