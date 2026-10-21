import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { BLOCKED_REFS, ROOT, assertRecoveryTarget, recoveryEnvironment, recoveryPlan } from '../scripts/recovery/plan.mjs';
import { bootstrapSchema, checkResumeLedger, migrationTransaction, quarantineSql } from '../scripts/recovery/bootstrap-hosted.mjs';
import { checkTestCredential } from '../scripts/recovery/check-mp-test-credentials.mjs';

const target = { purpose: 'la-taba-recovery-test', projectName: 'la-taba-recovery-test',
  environment: 'test', commercialPaymentsEnabled: false, mercadoPagoApplicationId: '2691240967769590',
  projectRef: 'abcdefghijklmnopqrst', organizationId: 'qdhfqytbvgpvhxbbcomv', region: 'sa-east-1',
  createdAt: '2026-10-21T02:00:00.000Z', checkoutOrigin: 'https://recovery-20261020.taba2-staging.pages.dev' };
const project = { id: target.projectRef, name: target.projectName, organization_id: target.organizationId,
  region: target.region, created_at: target.createdAt, status: 'ACTIVE_HEALTHY' };
const plan = recoveryPlan();

test('recovery inventories all existing migrations and function graphs without test-only modules', () => {
  assert.equal(plan.migrations.length, 159);
  assert.equal(plan.functions.length, 13);
  assert.equal(plan.commercialPaymentsEnabled, false);
  assert.equal(plan.applySeedSql, false);
  assert.ok(plan.functions.every(fn => fn.files.every(file => !/\.deno\.ts|\.test\./.test(file.path))));
  assert.equal(plan.functions.find(fn => fn.name === 'mercadopago-webhook').verifyJwt, false);
  assert.equal(plan.functions.find(fn => fn.name === 'mercadopago-refund').verifyJwt, true);
});

test('unbound template and all known existing projects are rejected before any hosted access', () => {
  assert.throws(() => assertRecoveryTarget(JSON.parse(fs.readFileSync('deploy/recovery-test.template.json', 'utf8'))));
  for (const projectRef of BLOCKED_REFS) assert.throws(() => assertRecoveryTarget({ ...target, projectRef }));
  assert.throws(() => assertRecoveryTarget({ ...target, createdAt: '2025-01-01T00:00:00Z' }));
});

test('recovery rejects a different organization, project identity, creation receipt or unhealthy instance', () => {
  for (const [key, value] of Object.entries({ id: 'other', name: 'other', organization_id: 'other',
    region: 'us-east-1', created_at: '2025-01-01T00:00:00Z', status: 'PAUSED' })) {
    assert.throws(() => assertRecoveryTarget(target, { ...project, [key]: value }));
  }
});

test('recovery environment contains only staging and test application settings', () => {
  const env = recoveryEnvironment(target);
  assert.equal(env.MERCADOPAGO_ENVIRONMENT, 'test');
  assert.equal(env.MERCADOPAGO_CLIENT_ID, '2691240967769590');
  assert.equal(env.MERCADOPAGO_OAUTH_PROJECT_REF, target.projectRef);
  assert.equal(env.MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION, undefined);
  assert.equal(env.MERCADOPAGO_PRODUCTION_REVIEW_STATUS, undefined);
  assert.equal(env.MERCADOPAGO_ACCESS_TOKEN, undefined);
});

test('changed migration bytes cannot be applied under an old reviewed manifest', () => {
  assert.throws(() => migrationTransaction(plan.migrations[0], 'select 1;'));
});

test('resume accepts only an exact ordered prefix and rejects tampering or unknown migrations', () => {
  const rows = plan.migrations.slice(0, 2).map(({ version, sha256 }) => ({ version, sha256 }));
  assert.equal(checkResumeLedger(plan, rows), 2);
  assert.throws(() => checkResumeLedger(plan, [...rows].reverse()));
  assert.throws(() => checkResumeLedger(plan, [{ ...rows[0], sha256: '0'.repeat(64) }]));
  assert.throws(() => checkResumeLedger(plan, [{ version: '20991231235959', sha256: '0'.repeat(64) }]));
});

test('a nonempty new target is never overwritten, including one with existing Auth users', async () => {
  for (const state of [{ application_tables: 1, auth_users: 0 }, { application_tables: 0, auth_users: 1 }]) {
    const calls = [];
    await assert.rejects(() => bootstrapSchema({ target, project, plan,
      query: async sql => { calls.push(sql); return [{ resumable: false, ...state }]; } }));
    assert.equal(calls.length, 1);
    assert.ok(calls[0].startsWith('select'));
  }
});

test('source drift aborts schema bootstrap before a database query', async () => {
  let calls = 0;
  const changed = structuredClone(plan); changed.migrations[0].sha256 = '0'.repeat(64);
  await assert.rejects(() => bootstrapSchema({ target, project, plan: changed, query: async () => { calls++; } }));
  assert.equal(calls, 0);
});

test('bootstrap transport encloses each original migration with cron pause and durable ledger entries', async () => {
  const mutations = [];
  const query = async sql => {
    if (sql.startsWith('select\n')) return [{ resumable: false, application_tables: 0, auth_users: 0 }];
    if (sql.startsWith('select project_ref')) return [{ project_ref: target.projectRef }];
    if (sql.startsWith('select version')) return [];
    mutations.push(sql); return [];
  };
  const result = await bootstrapSchema({ target, project, plan, query });
  assert.equal(result.migrationsApplied, 159);
  const transactions = mutations.filter(sql => sql.includes('RECOVERY_CONCURRENT_MIGRATION_RETRY'));
  assert.equal(transactions.length, 159);
  for (const [index, sql] of transactions.entries()) {
    assert.ok(sql.includes(fs.readFileSync(ROOT + '/' + plan.migrations[index].path, 'utf8')));
    assert.ok(sql.includes('active := false'));
    assert.ok(sql.includes('insert into supabase_migrations.schema_migrations'));
  }
  assert.ok(mutations.at(-1).includes('ordering_enabled=false'));
  assert.ok(mutations.at(-1).includes('set enabled=false'));
});

test('quarantine preserves original price and stock values privately without inventing history', () => {
  const source = { project_ref: 'wwcpogltfgzgkrlilbcd', data: {
    businesses: [{ id: 'fixture-business' }],
    products: [{ id: 'fixture-product', name: "Source 'quoted' value", price: '1234.50', stock: 7 }],
    orders_summary: [{ count: '20' }],
  } };
  const { sql, rowCount } = quarantineSql(Buffer.from(JSON.stringify(source)));
  assert.equal(rowCount, 3);
  assert.ok(sql.includes('"price":"1234.50","stock":7'));
  assert.ok(sql.includes("Source ''quoted'' value"));
  assert.match(sql, /revoke all .* from public,anon,authenticated,service_role/);
  assert.doesNotMatch(sql, /insert into (?:public\.(?:products|orders)|auth\.users)/i);
  assert.match(sql, /RECOVERY_SOURCE_ROW_MISMATCH/);
});

test('credential probe performs only the provider identity GET and omits private response fields', async () => {
  let calls = 0;
  const result = await checkTestCredential({ applicationId: '2691240967769590', source: 'test_access_token',
    testAccessToken: 'TEST-' + 'example'.repeat(5) }, async (url, init) => {
    calls++; assert.equal(url, 'https://api.mercadopago.com/users/me'); assert.equal(init.method, 'GET');
    return Response.json({ site_id: 'MLA', tags: ['test_user'], email: 'private@example.invalid' });
  });
  assert.equal(calls, 1); assert.equal(result.testUser, true); assert.equal(result.checkoutVerified, false);
  assert.doesNotMatch(JSON.stringify(result), /private|example@example|Authorization/);
});

test('credential probe refuses a production application or non-test source before network access', async () => {
  let calls = 0;
  for (const override of [{ applicationId: '7677852968049976' }, { source: 'access_token' }]) {
    await assert.rejects(() => checkTestCredential({ applicationId: '2691240967769590', source: 'test_access_token',
      testAccessToken: 'TEST-' + 'example'.repeat(5), ...override }, async () => { calls++; }));
  }
  assert.equal(calls, 0);
});
