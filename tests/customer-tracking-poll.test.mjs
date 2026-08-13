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
    listenerCount(type) {
      return listeners.get(type)?.size || 0;
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

test('delivered agenda una única revalidación al llegar terminal_visible_until', async () => {
  const documentRef = eventTarget();
  const windowRef = eventTarget();
  const timers = fakeTimers();
  let clock = Date.parse('2026-07-29T20:00:00.000Z');
  const calls = [];
  const unavailable = [];
  const ticks = [];
  const controller = createCustomerTrackingPollController({
    documentRef,
    windowRef,
    now: () => clock,
    setTimeoutImpl: timers.set,
    clearTimeoutImpl: timers.clear,
    onTick: (value) => ticks.push(value),
    onUnavailable: (value) => unavailable.push(value),
    fetchSnapshot: async (request) => {
      calls.push(request);
      return { kind: 'unavailable' };
    },
  });
  const terminalVisibleUntil = new Date(clock + 30_000).toISOString();

  controller.update({
    orderId: 'LT-100',
    trackingToken: 't'.repeat(32),
    status: 'delivered',
    terminalVisibleUntil,
  });

  assert.equal(controller.getSnapshot().active, false);
  assert.equal(controller.getSnapshot().terminal, true);
  assert.equal(timers.size(), 1);
  assert.equal(timers.nextDelay(), 30_000);
  assert.deepEqual(calls, []);
  assert.deepEqual(ticks, []);

  clock += 30_000;
  timers.runNext();
  await tick();

  assert.equal(calls.length, 1);
  assert.deepEqual(unavailable, [{ orderId: 'LT-100' }]);
  assert.equal(controller.getSnapshot().terminal, false);
  assert.equal(timers.size(), 0);
});

test('el vencimiento terminal coalesce el timer y un evento de ciclo de vida', async () => {
  const documentRef = eventTarget();
  const windowRef = eventTarget();
  const timers = fakeTimers();
  let clock = Date.parse('2026-07-29T20:00:00.000Z');
  const calls = [];
  const controller = createCustomerTrackingPollController({
    documentRef,
    windowRef,
    now: () => clock,
    setTimeoutImpl: timers.set,
    clearTimeoutImpl: timers.clear,
    fetchSnapshot: async (request) => {
      calls.push(request);
      return { kind: 'unavailable' };
    },
  });

  controller.update({
    orderId: 'LT-100',
    trackingToken: 'z'.repeat(32),
    status: 'delivered',
    terminalVisibleUntil: new Date(clock + 30_000).toISOString(),
  });
  clock += 30_000;
  timers.runNext();
  windowRef.emit('focus');
  windowRef.emit('online');
  await tick();

  assert.equal(calls.length, 1);
  assert.equal(controller.getSnapshot().terminal, false);
});

test('focus, online, pageshow y visibilitychange deduplican una revalidación terminal concurrente', async () => {
  const documentRef = eventTarget({ hidden: false });
  const windowRef = eventTarget();
  const timers = fakeTimers();
  let resolveRequest;
  const calls = [];
  const controller = createCustomerTrackingPollController({
    documentRef,
    windowRef,
    setTimeoutImpl: timers.set,
    clearTimeoutImpl: timers.clear,
    fetchSnapshot: (request) => {
      calls.push(request);
      return new Promise((resolve) => { resolveRequest = resolve; });
    },
  });
  const terminalVisibleUntil = new Date(Date.now() + 60_000).toISOString();

  controller.update({
    orderId: 'LT-100',
    trackingToken: 'u'.repeat(32),
    status: 'delivered',
    terminalVisibleUntil,
  });
  windowRef.emit('focus');
  windowRef.emit('online');
  windowRef.emit('pageshow');
  documentRef.emit('visibilitychange');
  await tick();

  assert.equal(calls.length, 1);
  assert.equal(controller.getSnapshot().inFlight, true);

  resolveRequest({
    kind: 'snapshot',
    order: {
      ...trackingOrder('delivered'),
      terminalVisibleUntil,
    },
  });
  await tick();

  assert.equal(controller.getSnapshot().terminal, true);
  assert.equal(timers.size(), 1);
  controller.stop();
});

test('una pestaña oculta revalida al volver visible aunque su timer haya quedado suspendido', async () => {
  const documentRef = eventTarget({ hidden: false });
  const windowRef = eventTarget();
  const timers = fakeTimers();
  let clock = Date.parse('2026-07-29T20:00:00.000Z');
  const calls = [];
  const controller = createCustomerTrackingPollController({
    documentRef,
    windowRef,
    now: () => clock,
    setTimeoutImpl: timers.set,
    clearTimeoutImpl: timers.clear,
    fetchSnapshot: async (request) => {
      calls.push(request);
      return { kind: 'unavailable' };
    },
  });

  controller.update({
    orderId: 'LT-100',
    trackingToken: 'v'.repeat(32),
    status: 'delivered',
    terminalVisibleUntil: new Date(clock + 30_000).toISOString(),
  });
  documentRef.hidden = true;
  documentRef.emit('visibilitychange');
  clock += 30_000;
  documentRef.hidden = false;
  documentRef.emit('visibilitychange');
  await tick();

  assert.equal(calls.length, 1);
  assert.equal(controller.getSnapshot().terminal, false);
});

test('un DTO terminal vencido devuelto por el servidor no crea un timer de demora cero', async () => {
  const documentRef = eventTarget();
  const windowRef = eventTarget();
  const timers = fakeTimers();
  let clock = Date.parse('2026-07-29T20:00:00.000Z');
  const terminalVisibleUntil = new Date(clock + 1_000).toISOString();
  let calls = 0;
  const controller = createCustomerTrackingPollController({
    documentRef,
    windowRef,
    now: () => clock,
    setTimeoutImpl: timers.set,
    clearTimeoutImpl: timers.clear,
    fetchSnapshot: async () => {
      calls += 1;
      return {
        kind: 'snapshot',
        order: {
          ...trackingOrder('delivered'),
          terminalVisibleUntil,
        },
      };
    },
  });

  controller.update({
    orderId: 'LT-100',
    trackingToken: 'w'.repeat(32),
    status: 'delivered',
    terminalVisibleUntil,
  });
  clock += 1_000;
  timers.runNext();
  await tick();

  assert.equal(calls, 1);
  assert.equal(controller.getSnapshot().terminal, true);
  assert.equal(timers.size(), 0);
  controller.stop();
});

test('si la revalidación al vencer falla por red, reintenta y finalmente retira el tracking', async () => {
  const documentRef = eventTarget();
  const windowRef = eventTarget();
  const timers = fakeTimers();
  const clock = Date.parse('2026-07-29T20:00:00.000Z');
  let calls = 0;
  const controller = createCustomerTrackingPollController({
    documentRef,
    windowRef,
    now: () => clock,
    setTimeoutImpl: timers.set,
    clearTimeoutImpl: timers.clear,
    fetchSnapshot: async () => {
      calls += 1;
      return calls === 1 ? { kind: 'network-error' } : { kind: 'unavailable' };
    },
  });

  controller.update({
    orderId: 'LT-100',
    trackingToken: 'r'.repeat(32),
    status: 'delivered',
    terminalVisibleUntil: new Date(clock).toISOString(),
  });
  await tick();
  assert.equal(calls, 1);
  assert.equal(controller.getSnapshot().terminal, true);
  assert.equal(timers.size(), 1, 'el error de red debe dejar un reintento positivo');
  assert.equal(timers.nextDelay(), 5_000);

  timers.runNext();
  await tick();
  assert.equal(calls, 2);
  assert.equal(controller.getSnapshot().terminal, false);
});

test('detener o reemplazar tracking cancela timers, requests y listeners terminales', async () => {
  const documentRef = eventTarget();
  const windowRef = eventTarget();
  const timers = fakeTimers();
  const controller = createCustomerTrackingPollController({
    documentRef,
    windowRef,
    setTimeoutImpl: timers.set,
    clearTimeoutImpl: timers.clear,
    fetchSnapshot: async () => ({ kind: 'snapshot', order: trackingOrder() }),
  });

  controller.update({
    orderId: 'ORDER-A',
    trackingToken: 'x'.repeat(32),
    status: 'delivered',
    terminalVisibleUntil: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.equal(timers.size(), 1);
  for (const type of ['focus', 'online', 'pageshow']) {
    assert.equal(windowRef.listenerCount(type), 1);
  }
  assert.equal(documentRef.listenerCount('visibilitychange'), 1);

  controller.update({
    orderId: 'ORDER-B',
    trackingToken: 'y'.repeat(32),
    status: 'on_the_way',
  });
  await tick();
  assert.equal(controller.getSnapshot().orderId, 'ORDER-B');
  assert.equal(controller.getSnapshot().terminal, false);
  assert.equal(timers.size(), 1);

  controller.stop();
  assert.equal(timers.size(), 0);
  assert.equal(controller.getSnapshot().inFlight, false);
  for (const type of ['focus', 'online', 'pageshow']) {
    assert.equal(windowRef.listenerCount(type), 0);
  }
  assert.equal(documentRef.listenerCount('visibilitychange'), 0);
});

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}
