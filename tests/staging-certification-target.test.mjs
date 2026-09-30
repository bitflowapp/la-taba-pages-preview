import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  STAGING_CERTIFICATION_TARGET as staging,
  STAGING_CERTIFICATION_CONFIRMATION as confirmation,
  assertStagingCertificationTarget,
  verifyStagingCertificationIdentity,
  verifyStagingCertificationOrder,
} from '../scripts/lib/staging-certification-target.mjs';

const target = { supabaseUrl: staging.url, businessId: staging.businessId, confirmation };
const business = { id: staging.businessId, slug: staging.businessSlug, is_active: true };
const payment = { business_id: staging.businessId, environment: 'test' };

function identityClient({ businessRow = business, paymentRow = payment, error = null, throws = false } = {}) {
  const queries = [];
  return {
    queries,
    from(table) {
      const query = { table };
      queries.push(query);
      return {
        select(columns) { query.columns = columns; return this; },
        eq(key, value) { query.key = key; query.value = value; return this; },
        abortSignal(signal) { assert.ok(signal instanceof AbortSignal); return this; },
        async maybeSingle() {
          if (throws) throw new Error('private backend detail');
          return { data: table === 'businesses' ? businessRow : paymentRow, error };
        },
      };
    },
  };
}

test('only the current staging project and its designated QA business are accepted', () => {
  assert.doesNotThrow(() => assertStagingCertificationTarget(target));
  for (const supabaseUrl of [
    'https://wwcpogltfgzgkrlilbcd.supabase.co',
    'https://tkanbadcglszlcyfjvpv.supabase.co',
    'https://ukxqbgswjlibmnjemrzd.supabase.co',
    'http://ucbtjcurawxjwjdvvcvj.supabase.co',
    `${staging.url}/`, `${staging.url}?target=production`,
    'https://ucbtjcurawxjwjdvvcvj.supabase.co.example.org',
    'https://user:password@ucbtjcurawxjwjdvvcvj.supabase.co',
  ]) {
    assert.throws(() => assertStagingCertificationTarget({ ...target, supabaseUrl }),
      /STAGING_CERTIFICATION_PROJECT_REJECTED/);
  }
  assert.throws(() => assertStagingCertificationTarget({ ...target, businessId: '00000000-0000-4000-8000-000000000001' }),
    /STAGING_CERTIFICATION_QA_BUSINESS_REJECTED/);
  assert.throws(() => assertStagingCertificationTarget({ ...target, confirmation: '' }),
    /STAGING_CERTIFICATION_CONFIRMATION_REQUIRED/);
});

test('invalid configuration is rejected before any privileged read', async () => {
  const client = identityClient();
  await assert.rejects(verifyStagingCertificationIdentity(client, { ...target, businessId: 'other-business' }),
    /QA_BUSINESS_REJECTED/);
  assert.deepEqual(client.queries, []);
});

test('read-only preflight verifies server identity and test payment mode', async () => {
  const client = identityClient();
  assert.equal(await verifyStagingCertificationIdentity(client, target), staging);
  assert.deepEqual(client.queries, [
    { table: 'businesses', columns: 'id,slug,is_active', key: 'id', value: staging.businessId },
    { table: 'business_payment_settings', columns: 'business_id,environment', key: 'business_id', value: staging.businessId },
  ]);
});

test('missing, renamed, inactive or cross-business identity fails closed', async () => {
  for (const businessRow of [null, { ...business, id: 'other-business' },
    { ...business, slug: 'la-taba' }, { ...business, is_active: false }]) {
    const client = identityClient({ businessRow });
    await assert.rejects(verifyStagingCertificationIdentity(client, target),
      /IDENTITY_UNVERIFIED|QA_IDENTITY_MISMATCH/);
    assert.equal(client.queries.length, 1);
  }
});

test('missing settings, production mode or cross-business payment settings fail closed', async () => {
  for (const paymentRow of [null, { ...payment, environment: 'production' },
    { ...payment, environment: null }, { ...payment, business_id: 'other-business' }]) {
    await assert.rejects(verifyStagingCertificationIdentity(identityClient({ paymentRow }), target),
      /IDENTITY_UNVERIFIED|TEST_PAYMENTS_REQUIRED/);
  }
});

test('backend read failures fail closed without echoing private error details', async () => {
  for (const options of [{ error: { message: 'private backend detail' } }, { throws: true }]) {
    await assert.rejects(verifyStagingCertificationIdentity(identityClient(options), target),
      { message: 'STAGING_CERTIFICATION_IDENTITY_UNVERIFIED:UPSTREAM_ERROR' });
  }
});

test('both certification entrypoints reject unsafe targets before constructing a client', () => {
  const testTemporaryRoot = resolve(tmpdir());
  const temporary = mkdtempSync(join(testTemporaryRoot, 'taba-certifier-guard-'));
  try {
    const loader = join(temporary, 'sdk-loader.mjs');
    writeFileSync(loader, `export async function resolve(specifier, context, nextResolve) {
      if (specifier === '@supabase/supabase-js') return {
        url: 'data:text/javascript,' + encodeURIComponent('export function createClient() { throw new Error("CERTIFIER_SDK_CLIENT_REACHED"); }'),
        shortCircuit: true,
      };
      return nextResolve(specifier, context);
    }`);
    for (const script of ['certify-real-order-pipeline.mjs', 'certify-order-operational-circuit.mjs']) {
      for (const [changes, code] of [
        [{ SUPABASE_URL: 'https://wwcpogltfgzgkrlilbcd.supabase.co' }, 'PROJECT_REJECTED'],
        [{ SUPABASE_URL: 'https://tkanbadcglszlcyfjvpv.supabase.co' }, 'PROJECT_REJECTED'],
        [{ SUPABASE_URL: 'https://ukxqbgswjlibmnjemrzd.supabase.co' }, 'PROJECT_REJECTED'],
        [{ TABA_BUSINESS_ID: '00000000-0000-4000-8000-000000000001' }, 'QA_BUSINESS_REJECTED'],
        [{ TABA_CERTIFY_CONFIRM: '' }, 'CONFIRMATION_REQUIRED'],
      ]) {
        const result = spawnSync(process.execPath, ['--no-warnings', '--experimental-loader', pathToFileURL(loader).href,
          fileURLToPath(new URL(`../scripts/${script}`, import.meta.url)), 'LT-9999'], {
          encoding: 'utf8', timeout: 20_000, windowsHide: true,
          env: { ...process.env, SUPABASE_URL: staging.url, TABA_BUSINESS_ID: staging.businessId,
            TABA_CERTIFY_CONFIRM: confirmation, SUPABASE_SERVICE_ROLE_KEY: 'fake-no-real-key',
            SUPABASE_ANON_KEY: 'fake-no-real-key', ...changes },
        });
        assert.ifError(result.error);
        assert.equal(result.status, 2, `${script}: ${result.stderr}`);
        assert.ok(result.stderr.includes(`STAGING_CERTIFICATION_${code}`), result.stderr);
        assert.doesNotMatch(result.stderr, /CERTIFIER_SDK_CLIENT_REACHED/);
      }
    }

    // Exercise the real entrypoints, including their async read-only gate.
    // The SDK double stops at the next query; no mutation API is available.
    writeFileSync(loader, `export async function resolve(specifier, context, nextResolve) {
      if (specifier === '@supabase/supabase-js') return {
        url: 'data:text/javascript,' + encodeURIComponent(\`export function createClient() {
          return { from(table) {
            if (!['businesses', 'business_payment_settings'].includes(table))
              throw new Error('CERTIFIER_BEYOND_PREFLIGHT');
            return {
              select() { return this; }, eq() { return this; }, abortSignal() { return this; },
              async maybeSingle() { return { data: JSON.parse(process.env.TABA_TEST_IDENTITY_ROWS)[table], error: null }; },
            };
          } };
        }\`), shortCircuit: true,
      };
      return nextResolve(specifier, context);
    }`);
    for (const script of ['certify-real-order-pipeline.mjs', 'certify-order-operational-circuit.mjs']) {
      for (const [businessRow, paymentRow, expected] of [
        [{ ...business, slug: 'la-taba' }, payment, 'QA_IDENTITY_MISMATCH'],
        [business, { ...payment, environment: 'production' }, 'TEST_PAYMENTS_REQUIRED'],
        [business, payment, 'PREFLIGHT_OK'],
      ]) {
        const result = spawnSync(process.execPath, ['--no-warnings', '--experimental-loader', pathToFileURL(loader).href,
          fileURLToPath(new URL(`../scripts/${script}`, import.meta.url)), '--preflight-only'], {
          encoding: 'utf8', timeout: 20_000, windowsHide: true,
          env: { ...process.env, SUPABASE_URL: staging.url, TABA_BUSINESS_ID: staging.businessId,
            TABA_CERTIFY_CONFIRM: confirmation, SUPABASE_SERVICE_ROLE_KEY: 'fake-no-real-key',
            SUPABASE_ANON_KEY: 'fake-no-real-key',
            TABA_TEST_IDENTITY_ROWS: JSON.stringify({ businesses: businessRow, business_payment_settings: paymentRow }) },
        });
        assert.ifError(result.error);
        assert.equal(result.status, expected === 'PREFLIGHT_OK' ? 0 : 2, `${script}: ${result.stderr}`);
        if (expected === 'PREFLIGHT_OK') {
          assert.deepEqual(JSON.parse(result.stdout), { ok: true, readOnly: true, scope: 'staging_identity_only',
            projectRef: staging.projectRef, businessId: staging.businessId, paymentEnvironment: 'test' });
        } else assert.ok(result.stderr.includes(expected), result.stderr);
        assert.doesNotMatch(result.stderr, /CERTIFIER_BEYOND_PREFLIGHT/);
      }
    }
  } finally {
    assert.equal(dirname(resolve(temporary)), testTemporaryRoot);
    rmSync(temporary, { recursive: true, force: true });
  }
});

const qaOrder = { id: 'qa-order', business_id: staging.businessId, status: 'received',
  customer_user_id: 'qa-anonymous-customer' };
const anonymousCustomer = { id: qaOrder.customer_user_id, is_anonymous: true, email: '', phone: '' };

function orderGuardClient({ order = qaOrder, customer = anonymousCustomer, membership = null, authError = null } = {}) {
  const queries = [];
  const authReads = [];
  return {
    queries, authReads,
    auth: { admin: { async getUserById(id) { authReads.push(id); return { data: { user: customer }, error: authError }; } } },
    from(table) {
      const query = { table, filters: [] };
      queries.push(query);
      return {
        select(columns) { query.columns = columns; return this; },
        eq(key, value) { query.filters.push([key, value]); return this; },
        limit(count) { query.limit = count; return this; },
        abortSignal() { return this; },
        async maybeSingle() { return { data: table === 'orders' ? order : membership, error: null }; },
      };
    },
  };
}

test('order preflight is scoped to the QA tenant and checks authoritative anonymous identity', async () => {
  const client = orderGuardClient();
  assert.equal(await verifyStagingCertificationOrder(client, target, 'LT-9999'), qaOrder);
  assert.deepEqual(client.queries[0].filters, [['business_id', staging.businessId], ['public_code', 'LT-9999']]);
  assert.deepEqual(client.authReads, [qaOrder.customer_user_id]);
  assert.deepEqual(client.queries[1].filters, [['user_id', qaOrder.customer_user_id]]);
  assert.equal(client.queries[1].limit, 1);
});

test('missing, foreign, terminal or customerless orders refuse before reading a customer', async () => {
  for (const [order, code] of [
    [null, 'QA_ORDER_NOT_FOUND'], [{ ...qaOrder, business_id: 'other-business' }, 'QA_BUSINESS_REJECTED'],
    ...['delivered', 'cancelled', 'rejected', 'unknown'].map(status => [{ ...qaOrder, status }, 'ORDER_STATE_REJECTED']),
    [{ ...qaOrder, customer_user_id: null }, 'QA_CUSTOMER_REQUIRED'],
  ]) {
    const client = orderGuardClient({ order });
    await assert.rejects(verifyStagingCertificationOrder(client, target, 'LT-9999'),
      new RegExp(`STAGING_CERTIFICATION_${code}`));
    assert.deepEqual(client.authReads, []);
  }
});

test('permanent, identified, mismatched or unreadable customers cannot be taken over', async () => {
  for (const customer of [null, { ...anonymousCustomer, is_anonymous: false },
    { ...anonymousCustomer, id: 'other-customer' }, { ...anonymousCustomer, email: 'qa@example.invalid' },
    { ...anonymousCustomer, phone: 'test-phone' }]) {
    const client = orderGuardClient({ customer });
    await assert.rejects(verifyStagingCertificationOrder(client, target, 'LT-9999'), /ANONYMOUS_CUSTOMER_REQUIRED/);
    assert.equal(client.queries.length, 1);
  }
  await assert.rejects(verifyStagingCertificationOrder(orderGuardClient({ authError: { message: 'private detail' } }),
    target, 'LT-9999'), { message: 'STAGING_CERTIFICATION_CUSTOMER_UNVERIFIED' });
});

test('even an anonymous customer with any business membership is rejected', async () => {
  await assert.rejects(verifyStagingCertificationOrder(orderGuardClient({ membership: { id: 'membership' } }),
    target, 'LT-9999'), /CUSTOMER_MEMBERSHIP_REJECTED/);
});

test('circuit entrypoint rejects a missing QA-scoped order before any actor or credential change', () => {
  const testTemporaryRoot = resolve(tmpdir());
  const temporary = mkdtempSync(join(testTemporaryRoot, 'taba-order-guard-'));
  try {
    const loader = join(temporary, 'sdk-loader.mjs');
    writeFileSync(loader, `export async function resolve(specifier, context, nextResolve) {
      if (specifier === '@supabase/supabase-js') return {
        url: 'data:text/javascript,' + encodeURIComponent(\`export function createClient() {
          const forbidden = () => { throw new Error('UNSAFE_MUTATION_REACHED'); };
          return { auth: { admin: { createUser: forbidden, updateUserById: forbidden } }, from(table) {
            const filters = [];
            return {
              select() { return this; }, eq(key, value) { filters.push([key, value]); return this; },
              abortSignal() { return this; },
              async maybeSingle() {
                if (table === 'orders') {
                  const values = Object.fromEntries(filters);
                  if (values.business_id !== '${staging.businessId}' || values.public_code !== 'LT-9999')
                    throw new Error('TENANT_FILTER_MISSING');
                  return { data: null, error: null };
                }
                if (!['businesses', 'business_payment_settings'].includes(table)) forbidden();
                return { data: JSON.parse(process.env.TABA_TEST_IDENTITY_ROWS)[table], error: null };
              },
            };
          } };
        }\`), shortCircuit: true,
      };
      return nextResolve(specifier, context);
    }`);
    const result = spawnSync(process.execPath, ['--no-warnings', '--experimental-loader', pathToFileURL(loader).href,
      fileURLToPath(new URL('../scripts/certify-order-operational-circuit.mjs', import.meta.url)), 'LT-9999'], {
      encoding: 'utf8', timeout: 20_000, windowsHide: true,
      env: { ...process.env, SUPABASE_URL: staging.url, TABA_BUSINESS_ID: staging.businessId,
        TABA_CERTIFY_CONFIRM: confirmation, SUPABASE_SERVICE_ROLE_KEY: 'fake-no-real-key',
        SUPABASE_ANON_KEY: 'fake-no-real-key',
        TABA_TEST_IDENTITY_ROWS: JSON.stringify({ businesses: business, business_payment_settings: payment }) },
    });
    assert.ifError(result.error);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /STAGING_CERTIFICATION_QA_ORDER_NOT_FOUND/);
    assert.doesNotMatch(result.stderr, /UNSAFE_MUTATION_REACHED|TENANT_FILTER_MISSING/);
  } finally {
    assert.equal(dirname(resolve(temporary)), testTemporaryRoot);
    rmSync(temporary, { recursive: true, force: true });
  }
});
