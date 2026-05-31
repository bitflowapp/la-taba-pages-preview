import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isNewerTimestamp,
  mergeOrders,
  orderTimestamp,
  shouldReplaceOrder,
} from '../js/core/realtime-sync.js';

const t0 = '2026-05-29T10:00:00.000Z';
const t1 = '2026-05-29T10:05:00.000Z';
const t2 = '2026-05-29T10:10:00.000Z';

function order(id, createdAt, history = []) {
  return { id, createdAt, statusHistory: history };
}

test('orderTimestamp takes the most recent of createdAt and statusHistory', () => {
  assert.equal(orderTimestamp(order('LT-1', t0)), Date.parse(t0));
  assert.equal(
    orderTimestamp(order('LT-1', t0, [{ status: 'received', at: t0 }, { status: 'preparing', at: t2 }])),
    Date.parse(t2),
  );
  assert.equal(orderTimestamp({ ...order('LT-1', t0), delivery: { destinationUpdatedAt: t1 } }), Date.parse(t1));
  assert.equal(orderTimestamp(null), 0);
});

test('shouldReplaceOrder is true for missing local or newer incoming', () => {
  assert.equal(shouldReplaceOrder(null, order('LT-1', t0)), true);
  assert.equal(shouldReplaceOrder(order('LT-1', t0), order('LT-1', t2)), true);
  assert.equal(shouldReplaceOrder(order('LT-1', t2), order('LT-1', t0)), false);
  assert.equal(shouldReplaceOrder(order('LT-1', t0), { notAnOrder: true }), false);
});

test('mergeOrders adds new orders at the front and keeps locals', () => {
  const local = [order('LT-1', t1)];
  const { orders, changed } = mergeOrders(local, [order('LT-2', t2)]);
  assert.equal(changed, true);
  assert.deepEqual(orders.map((o) => o.id), ['LT-2', 'LT-1']);
});

test('mergeOrders replaces an existing order only when the incoming is newer', () => {
  const local = [order('LT-1', t0, [{ status: 'received', at: t0 }])];
  const newer = order('LT-1', t0, [{ status: 'on_the_way', at: t2 }]);
  const first = mergeOrders(local, [newer]);
  assert.equal(first.changed, true);
  assert.equal(orderTimestamp(first.orders[0]), Date.parse(t2));

  const stale = order('LT-1', t0, [{ status: 'received', at: t0 }]);
  const second = mergeOrders(first.orders, [stale]);
  assert.equal(second.changed, false);
  assert.equal(orderTimestamp(second.orders[0]), Date.parse(t2));
});

test('mergeOrders ignores malformed incoming entries', () => {
  const local = [order('LT-1', t1)];
  const { orders, changed } = mergeOrders(local, [null, { noId: true }, 42]);
  assert.equal(changed, false);
  assert.deepEqual(orders.map((o) => o.id), ['LT-1']);
});

test('isNewerTimestamp compares monotonic stamps with sane fallbacks', () => {
  assert.equal(isNewerTimestamp(2, 1), true);
  assert.equal(isNewerTimestamp(1, 2), false);
  assert.equal(isNewerTimestamp(5, undefined), true);
  assert.equal(isNewerTimestamp('nope', 1), false);
});
