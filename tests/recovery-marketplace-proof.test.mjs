import test from 'node:test';
import assert from 'node:assert/strict';
import { completeChecks, providerSearchEmpty, proveIsolation, proveReplay } from '../scripts/recovery/marketplace-proof.mjs';

const fixture = () => ({
  baseline: { schemaVersion: 2, at: '2026-10-30T10:00:00Z', tenants: {
    a: { orders: 10, payment_intents: 17, stock: { a: 12 } },
    b: { orders: 0, payment_intents: 0, stock: { b: 5, c: 8 } },
  } },
  after: { a: { orders: 10, payment_intents: 17, stock: { a: 12 } },
    b: { orders: 1, payment_intents: 1, stock: { b: 3, c: 8 } } },
  session: { id: 'session', business_id: 'B', created_at: '2026-10-30T10:01:00Z', completed_order_id: 'order' },
  items: [{ product_id: 'b', quantity: 2 }],
  reservations: [{ product_id: 'b', quantity: 2, status: 'converted', checkout_session_id: 'session', business_id: 'B' }],
  order: { id: 'order', business_id: 'B' }, intent: { order_id: 'order' }, tenantA: 'A', tenantB: 'B',
});

test('unknown checks, empty reports and provider errors never certify isolation', () => {
  for (const checks of [{}, { paid: null }, { paid: true, isolation: undefined }, { paid: false }]) assert.equal(completeChecks(checks), false);
  assert.equal(completeChecks({ paid: true, isolated: true }), true);
  for (const response of [null, { http: 401, body: {} }, { http: 200, body: {} },
    { http: 200, body: { results: [], paging: {} } }, { http: 200, body: { results: [{}], paging: { total: 0 } } }]) {
    assert.equal(providerSearchEmpty(response), false);
  }
  assert.equal(providerSearchEmpty({ http: 200, body: { results: [], paging: { total: 0 } } }), true);
});
test('complete provider-backed purchase and exact stock delta can certify', () => {
  assert.equal(completeChecks(proveIsolation(fixture())), true);
});
for (const [name, change] of Object.entries({
  'missing baseline': f => { f.baseline = null; },
  'legacy baseline': f => { delete f.baseline.schemaVersion; },
  'baseline after checkout': f => { f.baseline.at = '2026-10-30T10:02:00Z'; },
  'failed count read': f => { f.after.a.orders = null; },
  'wrong quantity deducted': f => { f.after.b.stock.b = 4; },
  'unrelated product deducted': f => { f.after.b.stock.c = 7; },
  'new product in B': f => { f.after.b.stock.d = 1; },
  'stock missing from baseline': f => { delete f.baseline.tenants.b.stock.b; },
  'tenant A stock changed': f => { f.after.a.stock.a--; },
  'order in another business': f => { f.order.business_id = 'A'; },
  'nonexistent order': f => { f.order = null; },
  'unconverted reservation': f => { f.reservations[0].status = 'active'; },
  'reservation of another session': f => { f.reservations[0].checkout_session_id = 'other'; },
  'duplicated reservation': f => { f.reservations.push({ ...f.reservations[0] }); },
  'negative quantity': f => { f.items[0].quantity = -1; },
})) test(`does not certify ${name}`, () => {
  const f = fixture(); change(f); assert.equal(completeChecks(proveIsolation(f)), false);
});

test('replays need positive routing to the original tenant, duplicate evidence and unchanged original intent', () => {
  const before = { orders_a: 10, orders_b: 1, intents: [{ tenant: 'b', has_order: true, status: 'completed' }] };
  const after = { ...structuredClone(before), routed_to: ['b'] };
  const deliveries = [{ http: 201, receipt_id: 'receipt' }, { http: 201, receipt_id: 'receipt', duplicate: true }, { http: 201 }];
  const valid = { before, after, deliveries };
  assert.equal(completeChecks(proveReplay(valid)), true);
  for (const routes of [[], [null], ['a'], ['a', 'b'], ['b', null]]) {
    assert.equal(completeChecks(proveReplay({ ...valid, after: { ...after, routed_to: routes } })), false);
  }
  assert.equal(completeChecks(proveReplay({ ...valid, before: { ...before, orders_a: null }, after: { ...after, orders_a: null } })), false);
  assert.equal(completeChecks(proveReplay({ ...valid, after: { ...after, intents: [] } })), false);
  assert.equal(completeChecks(proveReplay({ ...valid, deliveries: [] })), false);
});
