import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  QA_CONTROL_BUSINESS, REAL_BUSINESS, foreignPublicTenants, openQaWindow, publicCatalogTenants,
} from '../scripts/controlled-production/qa-window.mjs';

function fakeOwner(status) {
  const calls = [];
  const state = { status };
  return {
    calls,
    state,
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { status: state.status }, error: null }) }) }) }),
    rpc: async (name, args) => {
      calls.push([name, args.p_status]);
      state.status = args.p_status;
      return { data: { ok: true, status: args.p_status }, error: null };
    },
  };
}

test('QA window opens a closed QA tenant and always leaves it closed', async () => {
  const owner = fakeOwner('closed');
  const window = await openQaWindow(owner, QA_CONTROL_BUSINESS);
  assert.equal(window.previous, 'closed');
  assert.equal(owner.state.status, 'open');
  await window.close();
  await window.close();
  assert.equal(owner.state.status, 'closed');
  assert.deepEqual(owner.calls, [['set_business_open_state', 'open'], ['set_business_open_state', 'closed']]);
});

test('QA window closes a QA tenant that a crashed run left open', async () => {
  const owner = fakeOwner('open');
  const window = await openQaWindow(owner, QA_CONTROL_BUSINESS);
  assert.equal(window.previous, 'open');
  await window.close();
  assert.equal(owner.state.status, 'closed');
  assert.deepEqual(owner.calls, [['set_business_open_state', 'closed']]);
});

test('QA window never touches the real business', async () => {
  const owner = fakeOwner('closed');
  await assert.rejects(openQaWindow(owner, REAL_BUSINESS), /QA_WINDOW_REFUSES_REAL_BUSINESS/);
  assert.deepEqual(owner.calls, []);
});

test('QA window fails loudly when the server refuses to close', async () => {
  const owner = fakeOwner('closed');
  const window = await openQaWindow(owner, QA_CONTROL_BUSINESS);
  owner.rpc = async () => ({ data: null, error: { code: '42501' } });
  await assert.rejects(window.close(), /QA_WINDOW_CLOSED_FAILED:42501/);
});

test('public exposure probe flags any tenant other than the real business', async () => {
  const rows = [{ business_id: QA_CONTROL_BUSINESS }, { business_id: QA_CONTROL_BUSINESS }];
  const publicClient = { from: () => ({ select: () => ({ limit: async () => ({ data: rows, error: null }) }) }) };
  const tenants = await publicCatalogTenants(publicClient);
  assert.deepEqual(tenants, [QA_CONTROL_BUSINESS]);
  assert.deepEqual(foreignPublicTenants(tenants, REAL_BUSINESS), [QA_CONTROL_BUSINESS]);
  assert.deepEqual(foreignPublicTenants([REAL_BUSINESS], REAL_BUSINESS), []);
  assert.deepEqual(foreignPublicTenants([], REAL_BUSINESS), []);
});

test('every CP harness that orders on the QA tenant opens and closes the window', () => {
  for (const file of ['scripts/controlled-production/capacity-30.mjs', 'scripts/controlled-production/rls-final.mjs',
    'scripts/controlled-production/stock-edges.mjs', 'scripts/controlled-production/physical-rider-e2e.mjs',
    'tests/controlled-production/cp-order-e2e.spec.mjs']) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /openQaWindow\(/, `${file} must open the QA window`);
    assert.match(source, /finally \{[\s\S]*qaWindow\.close\(\)/, `${file} must close the QA window in finally`);
  }
});

test('public pilot smoke fails when another tenant has a public catalog', () => {
  const source = readFileSync('scripts/deploy/smoke-commercial-pilot.mjs', 'utf8');
  assert.match(source, /foreignPublicTenants\(await publicCatalogTenants\(client\), businessId\)/);
  assert.match(source, /PUBLIC_CATALOG_OF_ANOTHER_TENANT_VISIBLE/);
});
