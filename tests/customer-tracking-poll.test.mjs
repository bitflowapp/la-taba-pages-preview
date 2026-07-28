import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCustomerTrackingPollController,
  isTerminalCustomerTrackingStatus,
  shouldPollCustomerTracking,
} from '../js/tracking/customer_tracking_poll.js';

function eventTarget({ hidden = false } = {}) {
  const listeners = new Map();
  return {
    hidden,
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) {
      listeners.get(type)?.delete(callback);
    },
    emit(type) {
      listeners.get(type)?.forEach((callback) => callback());
    },
  };
}

function fakeTimers() {
  let nextId = 0;
  const tasks = new Map();
  return {
    set(callback, delay) {
      const id = ++nextId;
      tasks.set(id, { callback, delay });
      return id;
    },
    clear(id) { tasks.delete(id); },
    size() { return tasks.size; },
    nextDelay() { return [...tasks.values()][0]?.delay; },
    runNext() {
      const [id, task] = tasks.entries().next().value || [];
      if (!task) return false;
      tasks.delete(id);
      task.callback();
      return true;
    },
  };
}

function trackingOrder(status = 'on_the_way') {
  return { id: 'LT-100', workflowStatus: status, status };
}

test('poll tokenizado consulta de inmediato y conserva un único ciclo cada 5 s', async () => {
  const documentRef = eventTarget();
  const windowRef = eventTarget();
  const timers = fakeTimers();
  const calls = [];
  const controller = createCustomerTrackingPollController({
    documentRef,
    windowRef,
    setTimeoutImpl: timers.set,
    clearTimeoutImpl: timers.clear,
    fetchSnapshot: async (request) => {
      calls.push(request);
      return { kind: 'snapshot', order: trackingOrder() };
    },
  });

  controller.update({ orderId: 'LT-100', trackingToken: 'a'.repeat(32), status: 'on_the_way' });
  await tick();
  controller.update({ orderId: 'LT-100', trackingToken: 'a'.repeat(32), status: 'on_the_way' });
  assert.equal(calls.length, 1);
  assert.equal(timers.size(), 1);
  assert.equal(timers.nextDelay(), 5_000);

  timers.runNext();
  await tick();
  assert.equal(calls.length, 2);
  assert.equal(timers.size(), 1);
  controller.stop();
});

test('cancela la solicitud al abandonar, revocar acceso o alcanzar un estado terminal', async () => {
  const documentRef = eventTarget();
  const windowRef = eventTarget();
  let resolveRequest;
  let signal;
  const controller = createCustomerTrackingPollController({
    documentRef,
    windowRef,
    fetchSnapshot: ({ signal: requestSignal }) => {
      signal = requestSignal;
      return new Promise((resolve) => { resolveRequest = resolve; });
    },
  });

  controller.update({ orderId: 'LT-100', trackingToken: 'b'.repeat(32), status: 'on_the_way' });
  await tick();
  assert.equal(signal.aborted, false);
  controller.update({ orderId: 'LT-100', trackingToken: 'b'.repeat(32), status: 'delivered' });
  assert.equal(signal.aborted, true);
  resolveRequest({ kind: 'snapshot', order: trackingOrder('on_the_way') });
  await tick();
  assert.equal(controller.getSnapshot().inFlight, false);
  controller.stop();
});

test('reduce polling en segundo plano y reanuda inmediatamente al volver visible', async () => {
  const documentRef = eventTarget({ hidden: false });
  const windowRef = eventTarget();
  const timers = fakeTimers();
  const calls = [];
  const controller = createCustomerTrackingPollController({
    documentRef,
    windowRef,
    setTimeoutImpl: timers.set,
    clearTimeoutImpl: timers.clear,
    fetchSnapshot: async (request) => {
      calls.push(request);
      return { kind: 'snapshot', order: trackingOrder() };
    },
  });

  controller.update({ orderId: 'LT-100', trackingToken: 'c'.repeat(32), status: 'on_the_way' });
  await tick();
  documentRef.hidden = true;
  documentRef.emit('visibilitychange');
  assert.equal(timers.size(), 0);

  documentRef.hidden = false;
  documentRef.emit('visibilitychange');
  await tick();
  assert.equal(calls.length, 2);
  assert.equal(timers.nextDelay(), 5_000);
  controller.stop();
});

test('un ciclo nuevo aborta una consulta lenta y vuelve a calcular la frescura', async () => {
  const documentRef = eventTarget();
  const windowRef = eventTarget();
  const timers = fakeTimers();
  let firstSignal;
  let calls = 0;
  const ticks = [];
  const controller = createCustomerTrackingPollController({
    documentRef,
    windowRef,
    setTimeoutImpl: timers.set,
    clearTimeoutImpl: timers.clear,
    onTick: (value) => ticks.push(value.orderId),
    fetchSnapshot: ({ signal }) => {
      calls += 1;
      if (calls === 1) {
        firstSignal = signal;
        return new Promise(() => {});
      }
      return Promise.resolve({ kind: 'snapshot', order: trackingOrder() });
    },
  });

  controller.update({ orderId: 'LT-100', trackingToken: 'e'.repeat(32), status: 'on_the_way' });
  await tick();
  assert.equal(timers.nextDelay(), 5_000);
  assert.deepEqual(ticks, ['LT-100']);

  timers.runNext();
  await tick();
  assert.equal(firstSignal.aborted, true);
  assert.equal(calls, 2);
  assert.deepEqual(ticks, ['LT-100', 'LT-100']);
  controller.stop();
});

test('observa todas las transiciones no terminales y se corta al estado terminal', () => {
  assert.equal(shouldPollCustomerTracking('received'), true);
  assert.equal(shouldPollCustomerTracking('preparing'), true);
  assert.equal(shouldPollCustomerTracking('ready'), true);
  assert.equal(shouldPollCustomerTracking('on_the_way'), true);
  assert.equal(shouldPollCustomerTracking('arrived'), true);
  assert.equal(isTerminalCustomerTrackingStatus('delivered'), true);
  assert.equal(isTerminalCustomerTrackingStatus('cancelled'), true);
});

test('un pedido posterior no cambia el order_id ligado al token durante el polling', async () => {
  const calls = [];
  const controller = createCustomerTrackingPollController({
    fetchSnapshot: async ({ orderId }) => {
      calls.push(orderId);
      return { kind: 'snapshot', order: trackingOrder('on_the_way') };
    },
  });

  controller.update({ orderId: 'ORDER-A', trackingToken: 'f'.repeat(32), status: 'received' });
  await tick();
  controller.update({ orderId: 'ORDER-A', trackingToken: 'f'.repeat(32), status: 'on_the_way' });
  await tick();

  assert.deepEqual(calls, ['ORDER-A']);
  assert.equal(controller.getSnapshot().orderId, 'ORDER-A');
  controller.stop();
});

test('un token vencido o revocado vuelve el seguimiento a no disponible y se detiene', async () => {
  const unavailable = [];
  const controller = createCustomerTrackingPollController({
    fetchSnapshot: async () => ({ kind: 'unavailable' }),
    onUnavailable: (value) => unavailable.push(value),
  });
  controller.update({ orderId: 'LT-100', trackingToken: 'd'.repeat(32), status: 'on_the_way' });
  await tick();
  assert.deepEqual(unavailable, [{ orderId: 'LT-100' }]);
  assert.equal(controller.getSnapshot().active, false);
});

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}
