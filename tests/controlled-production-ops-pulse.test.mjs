import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { classifyMercadoPago, publicChecks } from '../scripts/controlled-production/ops-pulse.mjs';

const REAL = 'e7850ad2-a447-402c-8375-3fd74e9466ba';
const QA = 'e1d2c342-da14-421e-884f-ff38bb55f642';

function fakeAnon({ heartbeat = { healthy: true, age_seconds: 5 }, products = [], businesses = [{ id: REAL, status: 'closed' }],
  realtime = 'SUBSCRIBED', rpcError = null } = {}) {
  return {
    rpc: async () => (rpcError ? { data: null, error: rpcError } : { data: heartbeat, error: null }),
    from: (table) => ({ select: () => ({ limit: async () => ({ data: table === 'products' ? products : businesses, error: null }) }) }),
    channel: () => ({ subscribe: (cb) => { if (realtime) setTimeout(() => cb(realtime), 1); } }),
    removeChannel: async () => {},
    realtime: { disconnect: () => {} },
  };
}

async function pulse(anon) {
  const report = {}; const warn = [];
  const check = async (name, fn) => {
    try { report[name] = await fn(); } catch (error) { report[name] = { error: error.message }; warn.push(`${name}:UNKNOWN`); }
  };
  await publicChecks({ anon, businessId: REAL, check, warn, realtimeTimeoutMs: 50 });
  return { report, warn };
}

test('public pulse is healthy with a closed QA tenant and live realtime', async () => {
  const { warn, report } = await pulse(fakeAnon({ businesses: [{ id: REAL, status: 'open' }, { id: QA, status: 'closed' }],
    products: [{ business_id: REAL }] }));
  assert.deepEqual(warn, []);
  assert.equal(report.realtime.status, 'SUBSCRIBED');
});

test('public pulse flags an exposed QA catalog and an open foreign tenant', async () => {
  const { warn } = await pulse(fakeAnon({ businesses: [{ id: REAL, status: 'closed' }, { id: QA, status: 'open' }],
    products: [{ business_id: QA }] }));
  assert.deepEqual(warn, ['FOREIGN_TENANT_PUBLIC:1', 'OTHER_TENANT_OPEN:1']);
});

test('public pulse flags a degraded scheduler', async () => {
  const { warn } = await pulse(fakeAnon({ heartbeat: { healthy: false, age_seconds: 900 } }));
  assert.deepEqual(warn, ['SCHEDULER_STALE:900']);
});

test('public pulse flags realtime that never subscribes', async () => {
  const timedOut = await pulse(fakeAnon({ realtime: null }));
  assert.deepEqual(timedOut.warn, ['REALTIME_UNAVAILABLE:TIMED_OUT']);
  const refused = await pulse(fakeAnon({ realtime: 'CHANNEL_ERROR' }));
  assert.deepEqual(refused.warn, ['REALTIME_UNAVAILABLE:CHANNEL_ERROR']);
});

test('public pulse reports an unreachable RPC as unknown, never as healthy', async () => {
  const { warn } = await pulse(fakeAnon({ rpcError: { code: 'PGRST301' } }));
  assert.deepEqual(warn, ['scheduler:UNKNOWN']);
});

const NOW = Date.parse('2026-09-26T12:00:00Z');
const minutesAgo = (minutes) => new Date(NOW - minutes * 60_000).toISOString();

test('Mercado Pago pulse: off and quiet says nothing', () => {
  const { warn, summary } = classifyMercadoPago({}, NOW);
  assert.deepEqual(warn, []);
  assert.equal(summary.enabled, false);
  assert.equal(summary.connection, 'none');
});

test('Mercado Pago pulse: turned on with a seller that cannot charge', () => {
  const settings = [{ enabled: true, environment: 'production', production_review_status: 'approved' }];
  assert.deepEqual(classifyMercadoPago({ settings }, NOW).warn, ['MP_SELLER_CANNOT_CHARGE:missing']);
  assert.deepEqual(classifyMercadoPago({ settings, connections: [{ environment: 'production', status: 'requires_reauthorization' }] }, NOW).warn,
    ['MP_SELLER_CANNOT_CHARGE:requires_reauthorization']);
  assert.deepEqual(classifyMercadoPago({ settings, connections: [{ environment: 'production', status: 'disconnected' }] }, NOW).warn,
    ['MP_SELLER_CANNOT_CHARGE:disconnected']);
  const healthy = classifyMercadoPago({ settings, connections: [{ environment: 'production', status: 'connected',
    expires_at: new Date(NOW + 90 * 86_400_000).toISOString() }] }, NOW);
  assert.deepEqual(healthy.warn, []);
  assert.equal(healthy.summary.connection, 'connected');
});

test('Mercado Pago pulse: a connected seller whose credential is about to expire', () => {
  const { warn } = classifyMercadoPago({ settings: [{ enabled: true, environment: 'production' }],
    connections: [{ environment: 'production', status: 'connected', expires_at: new Date(NOW + 3 * 86_400_000).toISOString() }] }, NOW);
  assert.deepEqual(warn, ['MP_SELLER_TOKEN_EXPIRING']);
});

test('Mercado Pago pulse: a queue nobody consumes and dead letters', () => {
  const outbox = [
    { status: 'pending', next_attempt_at: minutesAgo(12) },
    { status: 'retry_wait', next_attempt_at: minutesAgo(1) },
    { status: 'claimed', lease_expires_at: minutesAgo(9) },
    { status: 'dead_letter' },
  ];
  assert.deepEqual(classifyMercadoPago({ outbox }, NOW).warn, ['MP_OUTBOX_STALLED:2', 'MP_OUTBOX_DEAD_LETTER:1']);
});

test('Mercado Pago pulse: money that needs a person', () => {
  const intents = [
    { internal_status: 'approved', order_id: null, updated_at: minutesAgo(10) },
    { internal_status: 'approved', order_id: null, updated_at: minutesAgo(1) },
    { internal_status: 'approved', order_id: 'o-1', updated_at: minutesAgo(30) },
    { internal_status: 'ambiguous', order_id: null, updated_at: minutesAgo(30) },
  ];
  const { warn } = classifyMercadoPago({ intents, refunds: [{ status: 'ambiguous' }, { status: 'approved' }] }, NOW);
  assert.deepEqual(warn, ['MP_PAYMENTS_NEED_RECONCILIATION:1', 'MP_PAID_WITHOUT_ORDER:1', 'MP_REFUND_RECONCILIATION:1']);
});

test('Mercado Pago pulse: notifications whose signature never validates', () => {
  const rejected = [{ processing_status: 'rejected_signature', signature_valid: false }, { processing_status: 'rejected_signature', signature_valid: false }];
  assert.deepEqual(classifyMercadoPago({ receipts: rejected }, NOW).warn, ['MP_WEBHOOK_SIGNATURE_REJECTED:2:NONE_VALID']);
  assert.deepEqual(classifyMercadoPago({ receipts: [...rejected, { processing_status: 'processed', signature_valid: true }] }, NOW).warn,
    ['MP_WEBHOOK_SIGNATURE_REJECTED:2']);
});

test('Mercado Pago pulse never selects a credential, an account id or payer data', () => {
  const source = fs.readFileSync(new URL('../scripts/controlled-production/ops-pulse.mjs', import.meta.url), 'utf8');
  const selects = [...source.matchAll(/\.select\('([^']*)'/g)].map((match) => match[1]).join(',');
  assert.ok(selects.includes('enabled,environment,production_review_status'), 'the Mercado Pago selects are the ones inspected');
  for (const forbidden of ['protected_tokens', 'seller_id', 'collector_id', 'payer', 'access_token', 'email']) {
    assert.equal(selects.includes(forbidden), false, forbidden);
  }
});
