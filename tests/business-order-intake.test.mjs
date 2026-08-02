import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareBusinessInboxOrders,
  createBusinessOrderIntakeCoordinator,
  reconcileBusinessOrderSnapshot,
} from '../js/core/business-order-intake.js';

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';

test('pedido creado antes de abrir Negocio aparece en el snapshot inicial una sola vez', async () => {
  const harness = createHarness({ orders: [order('before-open', 1)] });
  await harness.startAndSettle();

  assert.deepEqual(harness.state.map((item) => item.id), ['before-open']);
  assert.equal(harness.alerts.length, 0, 'el snapshot inicial no debe disparar alertas históricas');
  harness.stop();
});

test('pedido creado durante la suscripción queda cubierto por el snapshot posterior a SUBSCRIBED', async () => {
  let reads = 0;
  const createdDuringSubscribe = order('during-subscribe', 1);
  const harness = createHarness({
    fetchSnapshot: async () => ({
      ok: true,
      orders: ++reads === 1 ? [] : [createdDuringSubscribe],
      syncedAt: iso(reads),
    }),
  });

  await harness.startAndSettle();

  assert.equal(reads >= 2, true);
  assert.deepEqual(harness.state.map((item) => item.id), ['during-subscribe']);
  assert.deepEqual(harness.alerts, ['during-subscribe']);
  harness.stop();
});

test('evento duplicado no crea tarjetas ni alertas duplicadas', async () => {
  const harness = createHarness({ orders: [] });
  await harness.startAndSettle();
  harness.dbOrders = [order('duplicate', 1)];

  harness.realtime.onInvalidate({ new: { id: 'duplicate', revision: 1 } });
  harness.realtime.onInvalidate({ new: { id: 'duplicate', revision: 1 } });
  await harness.settle();

  assert.deepEqual(harness.state.map((item) => item.id), ['duplicate']);
  assert.deepEqual(harness.alerts, ['duplicate']);
  harness.stop();
});

test('evento viejo después de uno nuevo no hace retroceder la revisión', async () => {
  const snapshots = [
    [order('revisioned', 1, 'submitted')],
    [order('revisioned', 3, 'preparing')],
    [order('revisioned', 2, 'accepted')],
  ];
  let read = 0;
  const harness = createHarness({
    fetchSnapshot: async () => ({
      ok: true,
      orders: snapshots[Math.min(read++, snapshots.length - 1)],
      syncedAt: iso(read),
    }),
    subscribeImmediately: false,
  });
  await harness.startAndSettle();
  await harness.coordinator.invalidate('newer-revision');
  await harness.coordinator.invalidate('stale-revision');

  assert.equal(harness.state[0].revision, 3);
  assert.equal(harness.state[0].workflowStatus, 'preparing');
  harness.stop();
});

test('Realtime perdido conserva la bandeja y recupera pedidos desde PostgreSQL', async () => {
  const harness = createHarness({ orders: [order('existing', 1)] });
  await harness.startAndSettle();
  harness.failNextSnapshot = 'network down';
  harness.realtime.onStatus('CHANNEL_ERROR');
  await settleTasks(4);

  assert.deepEqual(harness.state.map((item) => item.id), ['existing']);
  assert.equal(harness.coordinator.getStatus().phase, 'error');

  harness.dbOrders = [order('existing', 1), order('recovered', 1)];
  await harness.coordinator.invalidate('safety-poll');
  assert.deepEqual(harness.state.map((item) => item.id), ['existing', 'recovered']);
  assert.equal(harness.coordinator.getStatus().phase, 'connected');
  harness.stop();
});

test('offline/online no vacía datos y reconsulta al volver la red', async () => {
  const lifecycle = createEventTarget();
  let online = true;
  const harness = createHarness({
    orders: [order('offline-existing', 1)],
    lifecycleTarget: lifecycle,
    isOnline: () => online,
  });
  await harness.startAndSettle();

  online = false;
  lifecycle.dispatch('offline');
  harness.dbOrders = [order('offline-existing', 1), order('while-offline', 1)];
  await harness.coordinator.invalidate('offline-attempt');
  assert.deepEqual(harness.state.map((item) => item.id), ['offline-existing']);
  assert.equal(harness.coordinator.getStatus().phase, 'offline');

  online = true;
  lifecycle.dispatch('online');
  await harness.settle();
  assert.deepEqual(new Set(harness.state.map((item) => item.id)), new Set(['offline-existing', 'while-offline']));
  harness.stop();
});

test('cierre y reapertura reconstruye la bandeja sin depender de memoria local', async () => {
  const first = createHarness({ orders: [order('first-session', 1)] });
  await first.startAndSettle();
  first.stop();

  const reopened = createHarness({
    orders: [
      order('first-session', 1),
      order('created-while-closed', 1, 'submitted', { createdAt: iso(2) }),
    ],
  });
  await reopened.startAndSettle();

  assert.deepEqual(reopened.state.map((item) => item.id), ['first-session', 'created-while-closed']);
  reopened.stop();
});

test('dos y tres pestañas convergen y emiten una sola alerta compartida', async () => {
  const hub = createBroadcastHub();
  const storage = createStorage();
  const locks = createLockManager();
  const tabs = [0, 1, 2].map((index) => createHarness({
    orders: [],
    broadcastFactory: hub.factory,
    storage,
    locks,
    instanceId: `tab-${index + 1}`,
  }));
  await Promise.all(tabs.map((tab) => tab.startAndSettle()));

  for (const tab of tabs) tab.dbOrders = [order('multi-tab', 1)];
  tabs[0].realtime.onInvalidate({ new: { id: 'multi-tab' } });
  await settleTasks(8);
  await Promise.all(tabs.map((tab) => tab.settle()));

  for (const tab of tabs) assert.deepEqual(tab.state.map((item) => item.id), ['multi-tab']);
  assert.equal(tabs.flatMap((tab) => tab.alerts).length, 1);
  tabs.forEach((tab) => tab.stop());
});

test('cerrar una pestaña no deja un líder huérfano y las restantes siguen recuperando', async () => {
  const hub = createBroadcastHub();
  const tabs = [0, 1].map((index) => createHarness({
    orders: [],
    broadcastFactory: hub.factory,
    instanceId: `leaderless-${index}`,
  }));
  await Promise.all(tabs.map((tab) => tab.startAndSettle()));
  tabs[0].stop();

  tabs[1].dbOrders = [order('after-close', 1)];
  tabs[1].realtime.onInvalidate({ new: { id: 'after-close' } });
  await tabs[1].settle();

  assert.deepEqual(tabs[1].state.map((item) => item.id), ['after-close']);
  tabs[1].stop();
});

test('payload Realtime parcial sólo invalida y nunca reemplaza una tarjeta completa', async () => {
  const complete = order('partial-payload', 4, 'accepted', {
    customerName: 'Cliente completo',
    items: [{ productId: 'product-1', name: 'Agua', quantity: 2, unitPrice: 100 }],
  });
  const harness = createHarness({ orders: [complete] });
  await harness.startAndSettle();

  harness.realtime.onInvalidate({ new: { id: 'partial-payload', revision: 5 } });
  await harness.settle();

  assert.equal(harness.state[0].customerName, 'Cliente completo');
  assert.equal(harness.state[0].items.length, 1);
  assert.equal(harness.state[0].revision, 4);
  harness.stop();
});

test('50 pedidos consecutivos se deduplican y ordenan determinísticamente', async () => {
  const harness = createHarness({ orders: [] });
  await harness.startAndSettle();
  harness.dbOrders = Array.from({ length: 50 }, (_, index) => order(
    `order-${String(index + 1).padStart(2, '0')}`,
    1,
    index % 2 ? 'accepted' : 'submitted',
    { createdAt: iso((index % 5) + 1) },
  ));
  for (let index = 0; index < 50; index += 1) {
    harness.realtime.onInvalidate({ new: { id: `order-${index + 1}` } });
  }
  await harness.settle();

  assert.equal(harness.state.length, 50);
  assert.equal(new Set(harness.state.map((item) => item.id)).size, 50);
  assert.deepEqual(harness.state, [...harness.state].sort(compareBusinessInboxOrders));
  harness.stop();
});

test('submitted→accepted→preparing avanza por revisión y un snapshot viejo no lo revierte', () => {
  const watermarks = new Map();
  const inactive = new Set();
  let current = reconcileBusinessOrderSnapshot([], [order('flow', 1, 'submitted')], {
    revisionWatermarks: watermarks,
    inactiveOrderIds: inactive,
  }).orders;
  current = reconcileBusinessOrderSnapshot(current, [order('flow', 2, 'accepted')], {
    revisionWatermarks: watermarks,
    inactiveOrderIds: inactive,
  }).orders;
  current = reconcileBusinessOrderSnapshot(current, [order('flow', 3, 'preparing')], {
    revisionWatermarks: watermarks,
    inactiveOrderIds: inactive,
  }).orders;
  current = reconcileBusinessOrderSnapshot(current, [order('flow', 2, 'accepted')], {
    revisionWatermarks: watermarks,
    inactiveOrderIds: inactive,
  }).orders;

  assert.equal(current[0].workflowStatus, 'preparing');
  assert.equal(current[0].revision, 3);
});

test('un pedido que deja la bandeja activa se elimina y no reaparece con la misma revisión', () => {
  const watermarks = new Map();
  const inactive = new Set();
  let current = reconcileBusinessOrderSnapshot([], [order('terminal', 5, 'ready')], {
    revisionWatermarks: watermarks,
    inactiveOrderIds: inactive,
  }).orders;
  current = reconcileBusinessOrderSnapshot(current, [], {
    revisionWatermarks: watermarks,
    inactiveOrderIds: inactive,
  }).orders;
  current = reconcileBusinessOrderSnapshot(current, [order('terminal', 5, 'ready')], {
    revisionWatermarks: watermarks,
    inactiveOrderIds: inactive,
  }).orders;

  assert.deepEqual(current, []);
});

function createHarness({
  orders = [],
  fetchSnapshot = null,
  subscribeImmediately = true,
  lifecycleTarget = createEventTarget(),
  visibilityTarget = createEventTarget({ visibilityState: 'visible' }),
  broadcastFactory = () => null,
  storage = createStorage(),
  locks = null,
  instanceId = `tab-${Math.random()}`,
  isOnline = () => true,
} = {}) {
  const harness = {
    dbOrders: orders,
    state: [],
    alerts: [],
    failNextSnapshot: '',
    realtime: null,
  };
  const snapshot = fetchSnapshot || (async () => {
    if (harness.failNextSnapshot) {
      const message = harness.failNextSnapshot;
      harness.failNextSnapshot = '';
      return { ok: false, message };
    }
    return { ok: true, orders: structuredClone(harness.dbOrders), syncedAt: iso(10) };
  });
  harness.coordinator = createBusinessOrderIntakeCoordinator({
    businessId: BUSINESS_ID,
    fetchSnapshot: snapshot,
    subscribeRealtime: (handlers) => {
      harness.realtime = handlers;
      if (subscribeImmediately) queueMicrotask(() => handlers.onStatus('SUBSCRIBED'));
      return () => {};
    },
    getCurrentOrders: () => harness.state,
    applyOrders: (next) => { harness.state = structuredClone(next); },
    onOrderAlert: (nextOrder) => harness.alerts.push(nextOrder.id),
    pollMs: 60_000,
    lifecycleTarget,
    visibilityTarget,
    broadcastFactory,
    storage,
    locks,
    instanceId,
    isOnline,
    setTimer: () => 1,
    clearTimer: () => {},
  });
  harness.startAndSettle = async () => {
    await harness.coordinator.start();
    await harness.settle();
  };
  harness.settle = async () => {
    await settleTasks(3);
    await harness.coordinator.invalidate('test-drain');
    await settleTasks(3);
  };
  harness.stop = () => harness.coordinator.stop();
  return harness;
}

function order(id, revision, workflowStatus = 'submitted', overrides = {}) {
  return {
    id,
    backendId: `11111111-1111-4111-8111-${id.padStart(12, '0').slice(-12)}`,
    code: id,
    revision,
    workflowStatus,
    status: workflowStatus === 'submitted' || workflowStatus === 'accepted' ? 'received' : workflowStatus,
    createdAt: iso(1),
    updatedAt: iso(revision),
    customerName: 'Cliente prueba',
    customerPhone: '2995550000',
    deliveryMode: 'pickup',
    items: [{ productId: 'product-1', name: 'Agua', quantity: 1, unitPrice: 100 }],
    total: 100,
    currencyCode: 'ARS',
    ...overrides,
  };
}

function iso(second) {
  return `2026-08-02T12:00:${String(second).padStart(2, '0')}.000Z`;
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

function createBroadcastHub() {
  const channels = new Map();
  return {
    factory(name) {
      const peers = channels.get(name) || new Set();
      const channel = {
        onmessage: null,
        postMessage(message) {
          for (const peer of peers) {
            if (peer === channel) continue;
            queueMicrotask(() => peer.onmessage?.({ data: structuredClone(message) }));
          }
        },
        close() {
          peers.delete(channel);
        },
      };
      peers.add(channel);
      channels.set(name, peers);
      return channel;
    },
  };
}

function createLockManager() {
  const tails = new Map();
  return {
    async request(name, _options, callback) {
      const previous = tails.get(name) || Promise.resolve();
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const tail = previous.then(() => gate);
      tails.set(name, tail);
      await previous;
      try {
        return await callback({ name });
      } finally {
        release();
        if (tails.get(name) === tail) tails.delete(name);
      }
    },
  };
}

async function settleTasks(rounds = 1) {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}
