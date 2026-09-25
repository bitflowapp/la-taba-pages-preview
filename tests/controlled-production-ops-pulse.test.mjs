import assert from 'node:assert/strict';
import test from 'node:test';
import { publicChecks } from '../scripts/controlled-production/ops-pulse.mjs';

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
