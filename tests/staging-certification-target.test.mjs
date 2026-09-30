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
      { message: 'STAGING_CERTIFICATION_IDENTITY_UNVERIFIED' });
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
        [business, payment, 'CERTIFIER_BEYOND_PREFLIGHT'],
      ]) {
        const result = spawnSync(process.execPath, ['--no-warnings', '--experimental-loader', pathToFileURL(loader).href,
          fileURLToPath(new URL(`../scripts/${script}`, import.meta.url)), 'LT-9999'], {
          encoding: 'utf8', timeout: 20_000, windowsHide: true,
          env: { ...process.env, SUPABASE_URL: staging.url, TABA_BUSINESS_ID: staging.businessId,
            TABA_CERTIFY_CONFIRM: confirmation, SUPABASE_SERVICE_ROLE_KEY: 'fake-no-real-key',
            SUPABASE_ANON_KEY: 'fake-no-real-key',
            TABA_TEST_IDENTITY_ROWS: JSON.stringify({ businesses: businessRow, business_payment_settings: paymentRow }) },
        });
        assert.ifError(result.error);
        assert.equal(result.status, 1, `${script}: ${result.stderr}`);
        assert.ok(result.stderr.includes(expected), result.stderr);
        if (expected !== 'CERTIFIER_BEYOND_PREFLIGHT') {
          assert.doesNotMatch(result.stderr, /CERTIFIER_BEYOND_PREFLIGHT/);
        }
      }
    }
  } finally {
    assert.equal(dirname(resolve(temporary)), testTemporaryRoot);
    rmSync(temporary, { recursive: true, force: true });
  }
});
