import assert from 'node:assert/strict';
import test from 'node:test';

import { createBusinessOrderIntakeCoordinator } from '../js/core/business-order-intake.js';

// La cadencia del sondeo de seguridad según el estado de Realtime y de la
// pestaña. Cada vuelta del sondeo trae la bandeja entera con sus ítems: con el
// canal sano no hace falta cada cinco segundos, y con la pestaña oculta y el
// canal sano no hace falta en absoluto. Lo que NO puede pasar es que un pedido
// nuevo deje de avisarse.

const BUSINESS_ID = '22222222-2222-4222-8222-222222222222';

test('Realtime suscripto: el sondeo se espacia a 45 s', async () => {
  const harness = createHarness();
  await harness.start();
  harness.realtime.onStatus('SUBSCRIBED');
  await harness.settle();

  assert.equal(harness.pendingDelay(), 45_000);
  harness.stop();
});

test('antes de confirmar la suscripción, y con el canal caído, sigue cada 5 s', async () => {
  const harness = createHarness();
  await harness.start();
  assert.equal(harness.pendingDelay(), 5_000, 'conectando: todavía no hay canal en el que confiar');

  harness.realtime.onStatus('SUBSCRIBED');
  await harness.settle();
  assert.equal(harness.pendingDelay(), 45_000);

  harness.realtime.onStatus('CHANNEL_ERROR');
  await harness.settle();
  assert.equal(harness.pendingDelay(), 5_000, 'sin canal se acorta en el acto, sin esperar los 45 s');
  harness.stop();
});

test('pestaña oculta con el canal sano: no se sondea, y al volver hay una sola puesta al día', async () => {
  const harness = createHarness();
  await harness.start();
  harness.realtime.onStatus('SUBSCRIBED');
  await harness.settle();
  const before = harness.reads.length;

  harness.hide();
  assert.equal(harness.pendingDelay(), null, 'oculta y con Realtime sano no queda ningún sondeo programado');
  await harness.fireStaleTimers();
  assert.equal(harness.reads.length, before, 'un temporizador viejo que dispare igual no consulta');

  harness.show();
  await harness.settle();
  assert.deepEqual(harness.reads.slice(before), ['foreground'], 'una sola consulta al volver a primer plano');
  assert.equal(harness.pendingDelay(), 45_000, 'y el sondeo vuelve a contar desde ahí');
  harness.stop();
});

test('pestaña oculta con el canal caído: el sondeo sigue, espaciado, y el pedido nuevo avisa', async () => {
  const harness = createHarness();
  await harness.start();
  harness.realtime.onStatus('CHANNEL_ERROR');
  await harness.settle();

  harness.hide();
  assert.equal(harness.pendingDelay(), 45_000, 'oculta sin canal no se apaga: se espacia');

  harness.dbOrders = [order('llego-con-la-pestana-oculta', 1)];
  await harness.firePending();
  await harness.settle();
  assert.deepEqual(harness.alerts, ['llego-con-la-pestana-oculta']);
  assert.equal(harness.reads.at(-1), 'safety-poll');
  harness.stop();
});

test('pestaña oculta con el canal sano: el pedido que llega por Realtime avisa igual', async () => {
  const harness = createHarness();
  await harness.start();
  harness.realtime.onStatus('SUBSCRIBED');
  await harness.settle();
  harness.hide();

  harness.dbOrders = [order('llego-por-realtime', 1)];
  harness.realtime.onInvalidate({ new: { id: 'llego-por-realtime', revision: 1 } });
  await harness.settle();

  assert.deepEqual(harness.alerts, ['llego-por-realtime']);
  assert.equal(harness.pendingDelay(), null);
  harness.stop();
});

test('el sondeo sano nunca es más frecuente que el degradado', async () => {
  const harness = createHarness({ pollMs: 60_000 });
  await harness.start();
  harness.realtime.onStatus('SUBSCRIBED');
  await harness.settle();
  assert.equal(harness.pendingDelay(), 60_000);
  harness.stop();
});

test('stop no deja ningún sondeo programado', async () => {
  const harness = createHarness();
  await harness.start();
  harness.realtime.onStatus('SUBSCRIBED');
  await harness.settle();
  harness.stop();
  assert.equal(harness.pendingDelay(), null);
});

function createHarness({ pollMs = 5_000 } = {}) {
  const timers = new Map();
  let nextTimer = 1;
  const visibility = createEventTarget({ visibilityState: 'visible' });
  const harness = {
    dbOrders: [],
    state: [],
    alerts: [],
    reads: [],
    realtime: null,
  };
  harness.coordinator = createBusinessOrderIntakeCoordinator({
    businessId: BUSINESS_ID,
    fetchSnapshot: async ({ reason }) => {
      harness.reads.push(reason);
      return { ok: true, orders: structuredClone(harness.dbOrders), syncedAt: '2026-10-21T12:00:00.000Z' };
    },
    subscribeRealtime: (handlers) => {
      harness.realtime = handlers;
      return () => {};
    },
    getCurrentOrders: () => harness.state,
    applyOrders: (next) => { harness.state = structuredClone(next); },
    onOrderAlert: (nextOrder) => harness.alerts.push(nextOrder.id),
    pollMs,
    lifecycleTarget: createEventTarget(),
    visibilityTarget: visibility,
    broadcastFactory: () => null,
    storage: createStorage(),
    locks: null,
    instanceId: `polling-${Math.random()}`,
    isOnline: () => true,
    setTimer: (callback, delay) => {
      const id = nextTimer++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimer: (id) => { timers.delete(id); },
  });
  const staleCallbacks = [];
  harness.start = async () => {
    await harness.coordinator.start();
    await settleTasks(3);
  };
  harness.settle = () => settleTasks(4);
  harness.pendingDelay = () => {
    const pending = [...timers.values()];
    assert.ok(pending.length <= 1, `a lo sumo un sondeo programado, hay ${pending.length}`);
    return pending[0]?.delay ?? null;
  };
  harness.firePending = async () => {
    const [id, timer] = [...timers.entries()][0] || [];
    if (!timer) return;
    timers.delete(id);
    await timer.callback();
  };
  harness.hide = () => {
    // Un temporizador ya armado puede disparar igual en un navegador real.
    for (const timer of timers.values()) staleCallbacks.push(timer.callback);
    visibility.visibilityState = 'hidden';
    visibility.dispatch('visibilitychange');
  };
  harness.show = () => {
    visibility.visibilityState = 'visible';
    visibility.dispatch('visibilitychange');
  };
  harness.fireStaleTimers = async () => {
    for (const callback of staleCallbacks.splice(0)) await callback();
  };
  harness.stop = () => harness.coordinator.stop();
  return harness;
}

function order(id, revision, workflowStatus = 'submitted') {
  return {
    id,
    backendId: `22222222-2222-4222-8222-${id.length.toString().padStart(12, '0')}`,
    code: id,
    revision,
    workflowStatus,
    status: 'received',
    createdAt: '2026-10-21T12:00:01.000Z',
    updatedAt: '2026-10-21T12:00:01.000Z',
    customerName: 'Cliente prueba',
    deliveryMode: 'pickup',
    items: [{ productId: 'product-1', name: 'Agua', quantity: 1, unitPrice: 100 }],
    total: 100,
    currencyCode: 'ARS',
  };
}

function createEventTarget(overrides = {}) {
  const listeners = new Map();
  return {
    ...overrides,
    addEventListener(event, listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(listener);
    },
    removeEventListener(event, listener) {
      listeners.get(event)?.delete(listener);
    },
    dispatch(event, payload = {}) {
      for (const listener of listeners.get(event) || []) listener({ type: event, ...payload });
    },
  };
}

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

async function settleTasks(rounds = 1) {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}
