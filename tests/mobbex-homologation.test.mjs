// Verificador de evidencia de homologación (sólo lectura): la evaluación es pura y se prueba con instantáneas sintéticas.
// El SQL de lectura y el caso feliz sobre el esquema real corren en scripts/mobbex/run-mobbex-db-tests.mjs (MOBBEX_HOMOLOGATION_VERIFIER).
import assert from 'node:assert/strict';
import test from 'node:test';
import { SNAPSHOT_SQL, evaluateHomologation } from '../scripts/mobbex/homologation-verify.mjs';

const intent = (extra = {}) => ({ id: crypto.randomUUID(), environment: 'test', internal_status: 'completed', expected_amount: 2500, paid_amount: 2500, refunded_amount: 0,
  order_id: crypto.randomUUID(), provider_payment_id_set: true, review_reason: null, attention_reason: null, ...extra });
const good = () => {
  const paid = intent({ internal_status: 'partially_refunded', refunded_amount: 500 });
  return {
    settings: { environment: 'test', enabled: true, entity_uid: 'ENT-1', production_review_status: 'not_requested' },
    intents: [paid, intent({ internal_status: 'rejected', paid_amount: null, order_id: null }), intent({ internal_status: 'pending', paid_amount: null, order_id: null })],
    refunds: [{ payment_intent_id: paid.id, status: 'approved', amount: 500 }],
    events: { 'payment.approved': 1, 'payment.rejected': 1, 'refund.requested': 1 },
    receipts: 3, dead_letter_jobs: 0, health: { needs_attention: false }, cron: [{ jobname: 'taba-mobbex-worker', active: true }],
  };
};
const statusOf = (report, id) => report.checks.find((check) => check.id === id).status;

test('a complete sandbox homologation is APPROVED, and says it is sandbox evidence only', () => {
  const report = evaluateHomologation(good());
  assert.equal(report.verdict, 'APPROVED');
  assert.deepEqual(report.failed, []);
  assert.match(report.note, /No habilita producción/);
});

test('missing evidence is INCOMPLETE, never approved: no rejected / pending / refund / cron yet', () => {
  const snap = good();
  snap.intents = [snap.intents[0]];
  snap.refunds = [];
  snap.cron = [];
  snap.receipts = 0;
  const report = evaluateHomologation(snap);
  assert.equal(report.verdict, 'INCOMPLETE');
  assert.deepEqual(['H06', 'H07', 'H09', 'H12', 'H15'].filter((id) => !report.pending.includes(id)), [], report.pending.join(','));
  assert.equal(evaluateHomologation({}).verdict, 'REJECTED', 'an empty / unreadable snapshot is rejected, not pending');
});

test('production, a foreign environment or a missing entity are REJECTED', () => {
  let snap = good(); snap.settings.environment = 'production';
  let report = evaluateHomologation(snap);
  assert.equal(report.verdict, 'REJECTED');
  assert.equal(statusOf(report, 'H02'), 'FAIL');
  assert.equal(statusOf(report, 'H04'), 'FAIL', 'test intents under a production business are foreign too');
  snap = good(); snap.intents.push(intent({ environment: 'production' }));
  assert.equal(statusOf(evaluateHomologation(snap), 'H04'), 'FAIL');
  snap = good(); snap.settings.entity_uid = null;
  assert.equal(statusOf(evaluateHomologation(snap), 'H03'), 'FAIL');
});

test('an approved payment without an order or with another amount is REJECTED; a rejected one with an order is REJECTED', () => {
  let snap = good(); snap.intents[0].order_id = null;
  assert.equal(statusOf(evaluateHomologation(snap), 'H05'), 'FAIL');
  snap = good(); snap.intents[0].paid_amount = 1;
  assert.equal(statusOf(evaluateHomologation(snap), 'H05'), 'FAIL');
  snap = good(); snap.intents[1].order_id = 'x';
  assert.equal(statusOf(evaluateHomologation(snap), 'H06'), 'FAIL');
  snap = good(); snap.intents[2].paid_amount = 2500;
  assert.equal(statusOf(evaluateHomologation(snap), 'H07'), 'FAIL');
});

test('refund evidence: an approved refund the payment does not show, an unresolved one, or no audit event all fail', () => {
  let snap = good(); snap.intents[0].refunded_amount = 0;
  assert.equal(statusOf(evaluateHomologation(snap), 'H10'), 'FAIL');
  snap = good(); snap.refunds.push({ payment_intent_id: snap.intents[0].id, status: 'ambiguous', amount: 100 });
  assert.equal(statusOf(evaluateHomologation(snap), 'H11'), 'FAIL');
  snap = good(); snap.events = { 'payment.approved': 1 };
  assert.equal(statusOf(evaluateHomologation(snap), 'H12'), 'FAIL');
});

test('open concerns, dead-letter jobs, health alarms and an inactive cron fail; a cron is optional only when asked', () => {
  let snap = good(); snap.intents[0].attention_reason = 'duplicate_approved_payment';
  assert.equal(statusOf(evaluateHomologation(snap), 'H13'), 'FAIL');
  snap = good(); snap.dead_letter_jobs = 2;
  assert.equal(statusOf(evaluateHomologation(snap), 'H14'), 'FAIL');
  snap = good(); snap.health.needs_attention = true;
  assert.equal(statusOf(evaluateHomologation(snap), 'H14'), 'FAIL');
  snap = good(); snap.cron[0].active = false;
  assert.equal(statusOf(evaluateHomologation(snap), 'H15'), 'FAIL');
  snap = good(); snap.cron = [];
  assert.equal(statusOf(evaluateHomologation(snap, { requireCron: false }), 'H15'), 'PASS');
});

test('the snapshot SQL is read-only (select only), scoped to one business and never exposes credentials or raw payloads', () => {
  const sql = SNAPSHOT_SQL('00000000-0000-4000-8000-000000000001');
  assert.doesNotMatch(sql, /\b(insert|update|delete|drop|alter|truncate|create|grant)\b/i);
  assert.match(sql, /business_id = '00000000-0000-4000-8000-000000000001'/);
  assert.doesNotMatch(sql, /payload|raw_response|checkout_url|access|secret|token/i, 'no payloads, hashes, urls or secrets');
  assert.doesNotMatch(sql, /provider_payment_id(?!_set| is not null)/, 'the operation id is reduced to a boolean');
  assert.match(sql, /- 'changed_by'/, 'the operator name is removed from the settings row');
});
