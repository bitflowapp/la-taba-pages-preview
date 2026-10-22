import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { recoveryPlan } from '../scripts/recovery/plan.mjs';
import { withRecoveryProject } from '../scripts/recovery/hosted-client.mjs';

test('hardening migration fixes the four inspected functions without changing grants or business data', () => {
  const migration = recoveryPlan().migrations.find(({ path }) => path.endsWith('_recovery_rpc_hardening.sql'));
  assert.ok(migration, 'the recovery RPC hardening migration remains in the plan');
  const sql = fs.readFileSync(migration.path, 'utf8');
  for (const name of ['set_order_operational_defaults', 'set_updated_at', 'next_order_public_code', 'request_order_token']) {
    assert.ok(sql.includes(`alter function public.${name}()\n  set search_path = pg_catalog, public, pg_temp;`));
  }
  assert.equal((sql.match(/alter function/g) || []).length, 4);
  assert.doesNotMatch(sql, /\b(?:insert|update|delete|drop|grant|revoke)\b/i);
});

test('paid launch proposal is declined and cannot open the hosted recovery client', async () => {
  const proposal = JSON.parse(fs.readFileSync('deploy/launch-cost-proposal.json', 'utf8'));
  assert.equal(proposal.costAuthorization, 'explicitly_declined');
  await assert.rejects(() => withRecoveryProject(proposal, () => assert.fail('must not connect')));
});

test('hosted API tests bind saved keys to the exact new project and distinguish webhook rejection from provider validation', () => {
  const source = fs.readFileSync('scripts/recovery/verify-hosted-api.mjs', 'utf8');
  assert.ok(source.includes('publicCredential?.usuario!==target.projectRef'));
  assert.ok(source.includes('serviceCredential?.usuario!==target.projectRef'));
  assert.ok(source.includes('providerTransactionsExecuted:false'));
  assert.ok(source.includes("record('Synthetic Auth identity cleanup'"));
});
