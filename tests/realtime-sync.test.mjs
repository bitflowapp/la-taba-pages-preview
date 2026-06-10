import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chooseActiveOrderId,
  chooseActiveLiveOrderId,
  computeRelayBackoffMs,
  isNewerTimestamp,
  mergeOrders,
  orderTimestamp,
  relayStatusLabel,
  shouldReplaceOrder,
} from '../js/core/realtime-sync.js';

const t0 = '2026-05-29T10:00:00.000Z';
const t1 = '2026-05-29T10:05:00.000Z';
const t2 = '2026-05-29T10:10:00.000Z';

function order(id, createdAt, history = [], status = history.at(-1)?.status || 'received') {
  return { id, createdAt, status, statusHistory: history };
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

// Confirmar el código de entrega (o adjuntar la foto) no agrega statusHistory,
// pero debe subir la versión del pedido: si no, esos cambios nunca se publican
// ni se aceptan en los otros dispositivos de la sala realtime.
test('orderTimestamp cuenta el código confirmado y la foto de entrega como versión nueva', () => {
  const base = order('LT-1', t0, [{ status: 'arriving', at: t1 }]);
  const withCode = { ...base, deliveryCode: { code: '1234', confirmedAt: t2 } };
  assert.equal(orderTimestamp(withCode), Date.parse(t2));
  assert.equal(shouldReplaceOrder(base, withCode), true);

  const withProof = { ...base, deliveryProof: { photoDataUrl: 'data:image/png;base64,x', capturedAt: t2 } };
  assert.equal(orderTimestamp(withProof), Date.parse(t2));
  assert.equal(shouldReplaceOrder(base, withProof), true);
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

test('chooseActiveOrderId accepts a newer active order from the room', () => {
  const local = [order('LT-OLD', t1, [{ status: 'on_the_way', at: t1 }])];
  const incoming = [order('LT-NEW', t2, [{ status: 'received', at: t2 }])];
  assert.equal(chooseActiveOrderId(local, 'LT-OLD', incoming, 'LT-NEW'), 'LT-NEW');
});

test('chooseActiveOrderId keeps the local active order when remote is stale', () => {
  const local = [order('LT-NEW', t2, [{ status: 'received', at: t2 }])];
  const incoming = [order('LT-OLD', t0, [{ status: 'on_the_way', at: t0 }])];
  assert.equal(chooseActiveOrderId(local, 'LT-NEW', incoming, 'LT-OLD'), 'LT-NEW');
});

test('chooseActiveLiveOrderId keeps an in-progress delivery visible by priority', () => {
  const orders = [
    order('LT-RECEIVED', t2, [{ status: 'received', at: t2 }]),
    order('LT-READY', t2, [{ status: 'ready', at: t2 }]),
    order('LT-WAY', t0, [{ status: 'on_the_way', at: t0 }]),
  ];
  assert.equal(chooseActiveLiveOrderId(orders), 'LT-WAY');
});

test('chooseActiveLiveOrderId lets a newer arriving order beat an older on the way order', () => {
  const orders = [
    order('LT-OLD-WAY', t0, [{ status: 'on_the_way', at: t0 }]),
    order('LT-NEW-ARRIVING', t2, [{ status: 'arriving', at: t2 }]),
  ];
  assert.equal(chooseActiveLiveOrderId(orders), 'LT-NEW-ARRIVING');
});

test('chooseActiveOrderId falls back to a room live order without lastOrderId', () => {
  const local = [order('LT-LOCAL', t0, [{ status: 'received', at: t0 }])];
  const incoming = [order('LT-ROOM', t1, [{ status: 'on_the_way', at: t1 }])];
  assert.equal(chooseActiveOrderId(local, null, incoming, null), 'LT-ROOM');
});

test('chooseActiveOrderId ignores a stale missing local lastOrderId', () => {
  const local = [order('LT-LIVE', t1, [{ status: 'ready', at: t1 }])];
  assert.equal(chooseActiveOrderId(local, 'LT-MISSING', [], null), 'LT-LIVE');
});

// Finding del PR #36: un fallback "live" entrante NO debe reemplazar un
// lastOrderId local válido si no vino un incomingLastOrderId explícito.
test('chooseActiveOrderId NO reemplaza un activo local válido por un fallback live entrante', () => {
  const local = [order('LT-VALID', t1, [{ status: 'on_the_way', at: t1 }])];
  const incoming = [order('LT-NEW-ARRIVING', t2, [{ status: 'arriving', at: t2 }])];
  assert.equal(chooseActiveOrderId(local, 'LT-VALID', incoming, null), 'LT-VALID');
});

test('chooseActiveOrderId acepta un incomingLastOrderId explícito más nuevo sobre un activo local válido', () => {
  const local = [order('LT-VALID', t0, [{ status: 'on_the_way', at: t0 }])];
  const incoming = [order('LT-HANDOFF', t2, [{ status: 'received', at: t2 }])];
  assert.equal(chooseActiveOrderId(local, 'LT-VALID', incoming, 'LT-HANDOFF'), 'LT-HANDOFF');
});

test('chooseActiveOrderId mantiene el activo local si el incomingLastOrderId explícito es más viejo', () => {
  const local = [order('LT-VALID', t2, [{ status: 'received', at: t2 }])];
  const incoming = [order('LT-OLDER', t0, [{ status: 'on_the_way', at: t0 }])];
  assert.equal(chooseActiveOrderId(local, 'LT-VALID', incoming, 'LT-OLDER'), 'LT-VALID');
});

test('chooseActiveOrderId con lastOrderId local terminal permite el fallback live entrante más nuevo', () => {
  const local = [order('LT-DONE', t0, [{ status: 'delivered', at: t0 }])];
  const incoming = [order('LT-LIVE-NEW', t2, [{ status: 'on_the_way', at: t2 }])];
  assert.equal(chooseActiveOrderId(local, 'LT-DONE', incoming, null), 'LT-LIVE-NEW');
});

test('chooseActiveOrderId sin lastOrderId válido deja ganar arriving nuevo sobre on_the_way viejo', () => {
  const local = [order('LT-OLD-WAY', t0, [{ status: 'on_the_way', at: t0 }])];
  const incoming = [order('LT-NEW-ARRIVING', t2, [{ status: 'arriving', at: t2 }])];
  assert.equal(chooseActiveOrderId(local, null, incoming, null), 'LT-NEW-ARRIVING');
});

test('isNewerTimestamp compares monotonic stamps with sane fallbacks', () => {
  assert.equal(isNewerTimestamp(2, 1), true);
  assert.equal(isNewerTimestamp(1, 2), false);
  assert.equal(isNewerTimestamp(5, undefined), true);
  assert.equal(isNewerTimestamp('nope', 1), false);
});

// ===== Reconexión del relay =====
test('computeRelayBackoffMs crece exponencial y queda acotado', () => {
  assert.equal(computeRelayBackoffMs(1), 1000);
  assert.equal(computeRelayBackoffMs(2), 2000);
  assert.equal(computeRelayBackoffMs(3), 4000);
  assert.equal(computeRelayBackoffMs(4), 8000);
  // 16000 superaría el tope: se queda en 15000.
  assert.equal(computeRelayBackoffMs(5), 15000);
  assert.equal(computeRelayBackoffMs(10), 15000);
  // Entradas inválidas se tratan como el primer intento.
  assert.equal(computeRelayBackoffMs(0), 1000);
  assert.equal(computeRelayBackoffMs(-3), 1000);
  assert.equal(computeRelayBackoffMs('nope'), 1000);
  // Base/tope configurables.
  assert.equal(computeRelayBackoffMs(1, { baseMs: 500, maxMs: 4000 }), 500);
  assert.equal(computeRelayBackoffMs(4, { baseMs: 500, maxMs: 4000 }), 4000);
});

test('relayStatusLabel describe la conexión con la sala sin inventar', () => {
  assert.equal(relayStatusLabel({ relayEnabled: false }), 'Sólo este equipo');
  assert.equal(relayStatusLabel({ relayEnabled: true, relayState: 'connected' }), 'En vivo entre equipos');
  assert.equal(relayStatusLabel({ relayEnabled: true, relayState: 'connecting' }), 'Conectando con la sala…');
  assert.equal(relayStatusLabel({ relayEnabled: true, relayState: 'offline' }), 'Sin conexión con la sala');
  assert.equal(relayStatusLabel({ relayEnabled: true, relayState: 'reconnecting' }), 'Reconectando con la sala…');
  // Defensa: reconnecting pero ya reconectado => no muestra "reconectando".
  assert.equal(relayStatusLabel({ relayEnabled: true, relayState: 'reconnecting', relayConnected: true }), 'En vivo entre equipos');
});
