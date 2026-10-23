// Points the hosted recovery (QA) project at its TEST-owned integrator application, TestApp-ae01fd1d
// (RECOVERY_TEST_APPLICATION_ID): MERCADOPAGO_CLIENT_ID, MERCADOPAGO_CLIENT_SECRET and MERCADOPAGO_OAUTH_WEBHOOK_SECRET.
// TABA2 Staging, the previous integrator, belongs to a real account and can never take a test payment
// (2034 Invalid users involved). Secrets come from Windows Credential Manager and go to the Management API in this
// process' memory; only names, lengths and digest matches are printed.
//   node scripts/recovery/qa-mp-use-test-integrator.mjs [--apply] [--evidence file.jsonl]
// Before --apply the integrator owner is verified with the application's own client credentials (a test user).
// To return to TABA2 Staging: its client secret is kept as «RECOVERY MP TEST CLIENT SECRET» and its webhook
// signature is shown in its panel (Webhooks); the Edge binding would also have to name it again.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { withRecoveryProject } from './hosted-client.mjs';
import { RECOVERY_TEST_APPLICATION_ID } from './plan.mjs';

const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const apply = process.argv.includes('--apply');
const target = JSON.parse(fs.readFileSync(arg('--target') || 'deploy/recovery-free-hosted.json', 'utf8'));
assert.equal(target.environment, 'test');
assert.equal(target.commercialPaymentsEnabled, false);
assert.equal(target.mercadoPagoApplicationId, RECOVERY_TEST_APPLICATION_ID);
const record = (row) => {
  const line = JSON.stringify({ at: new Date().toISOString(), tool: 'qa-mp-use-test-integrator', ...row });
  if (arg('--evidence')) fs.appendFileSync(arg('--evidence'), line + '\n');
  console.log(line);
};

const clientSecret = leerSecreto('RECOVERY MP TESTAPP CLIENT SECRET');
const webhookSecret = leerSecreto('RECOVERY MP TESTAPP WEBHOOK SECRET');
assert.equal(clientSecret?.usuario, RECOVERY_TEST_APPLICATION_ID, 'client secret bound to another application');
assert.equal(webhookSecret?.usuario, RECOVERY_TEST_APPLICATION_ID, 'webhook secret bound to another application');
assert.match(clientSecret.secreto, /^[A-Za-z0-9]{20,64}$/);
assert.match(webhookSecret.secreto, /^[0-9a-f]{64}$/i);

// The owner of the application must be a test user: that is the whole point of the switch.
const grant = await fetch('https://api.mercadopago.com/oauth/token', {
  method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(15000),
  body: JSON.stringify({ grant_type: 'client_credentials', client_id: RECOVERY_TEST_APPLICATION_ID, client_secret: clientSecret.secreto }),
});
const grantBody = await grant.json().catch(() => ({}));
assert.ok(grant.ok && grantBody.access_token, `client credentials refused: HTTP ${grant.status}`);
const owner = await (await fetch('https://api.mercadopago.com/users/me', {
  headers: { Authorization: `Bearer ${grantBody.access_token}` }, signal: AbortSignal.timeout(15000),
})).json();
assert.ok(Array.isArray(owner.tags) && owner.tags.includes('test_user'), 'the integrator owner is not a test user');
assert.equal(owner.site_id, 'MLA');
record({ phase: 'integrator', application: RECOVERY_TEST_APPLICATION_ID, owner_id: String(owner.id), owner_test_user: true, request_id: grant.headers.get('x-request-id') });

const desired = {
  MERCADOPAGO_CLIENT_ID: RECOVERY_TEST_APPLICATION_ID,
  MERCADOPAGO_CLIENT_SECRET: clientSecret.secreto,
  MERCADOPAGO_OAUTH_WEBHOOK_SECRET: webhookSecret.secreto,
};
const digest = (value) => createHash('sha256').update(value).digest('hex');
await withRecoveryProject(target, async ({ request }) => {
  const compare = async () => {
    const current = await request('/secrets');
    return Object.fromEntries(Object.entries(desired).map(([name, value]) => {
      const found = (Array.isArray(current) ? current : []).find((item) => item.name === name);
      return [name, { present: Boolean(found), matches: found ? found.value === digest(value) : false }];
    }));
  };
  const before = await compare();
  record({ phase: 'secrets', projectRef: target.projectRef, before, apply });
  if (!apply) return;
  await request('/secrets', { method: 'POST', body: JSON.stringify(Object.entries(desired).map(([name, value]) => ({ name, value }))) });
  const after = await compare();
  record({ phase: 'secrets', projectRef: target.projectRef, after });
  assert.ok(Object.values(after).every((s) => s.present && s.matches), 'secrets not confirmed by digest');
});
