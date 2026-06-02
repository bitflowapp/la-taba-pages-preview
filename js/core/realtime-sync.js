// Lógica pura de reconciliación realtime (sin DOM ni timers, fácil de testear).
// Estrategia: "last-write-wins" por pedido, usando como versión la marca de
// tiempo más reciente entre createdAt y el último cambio de estado.
//
// Esto permite que el celular del cliente y el del rider converjan al mismo
// estado aunque los mensajes lleguen desordenados o duplicados.

export function orderTimestamp(order) {
  if (!order || typeof order !== 'object') return 0;
  const candidates = [order.createdAt];
  if (order.delivery?.destinationUpdatedAt) candidates.push(order.delivery.destinationUpdatedAt);
  if (Array.isArray(order.statusHistory)) {
    for (const entry of order.statusHistory) {
      if (entry && entry.at) candidates.push(entry.at);
    }
  }
  let max = 0;
  for (const value of candidates) {
    const time = Date.parse(value);
    if (Number.isFinite(time) && time > max) max = time;
  }
  return max;
}

const ACTIVE_ORDER_PRIORITY = Object.freeze({
  on_the_way: 0,
  arriving: 1,
  ready: 2,
  preparing: 3,
  received: 4,
});

export function chooseActiveLiveOrderId(orders = []) {
  if (!Array.isArray(orders)) return null;
  return orders
    .filter((order) => order?.id && Object.prototype.hasOwnProperty.call(ACTIVE_ORDER_PRIORITY, order.status))
    .sort((a, b) => {
      const priorityDiff = ACTIVE_ORDER_PRIORITY[a.status] - ACTIVE_ORDER_PRIORITY[b.status];
      if (priorityDiff !== 0) return priorityDiff;
      return orderTimestamp(b) - orderTimestamp(a);
    })[0]?.id || null;
}

// Devuelve true si `incoming` debe reemplazar a `local` (es más nuevo o el local no existe).
export function shouldReplaceOrder(localOrder, incomingOrder) {
  if (!incomingOrder || typeof incomingOrder.id !== 'string') return false;
  if (!localOrder) return true;
  return orderTimestamp(incomingOrder) > orderTimestamp(localOrder);
}

// Reconcilia una lista local con pedidos entrantes. No muta las entradas.
// Devuelve { orders, changed }. Los pedidos nuevos se agregan al frente.
export function mergeOrders(localOrders, incomingOrders) {
  const local = Array.isArray(localOrders) ? localOrders.slice() : [];
  const incoming = Array.isArray(incomingOrders) ? incomingOrders : [];
  const indexById = new Map(local.map((order, index) => [order.id, index]));
  let changed = false;

  for (const incomingOrder of incoming) {
    if (!incomingOrder || typeof incomingOrder.id !== 'string') continue;
    const existingIndex = indexById.get(incomingOrder.id);
    if (existingIndex == null) {
      local.unshift(incomingOrder);
      // Recalcular índices tras el unshift.
      for (const [id, idx] of indexById) indexById.set(id, idx + 1);
      indexById.set(incomingOrder.id, 0);
      changed = true;
    } else if (shouldReplaceOrder(local[existingIndex], incomingOrder)) {
      local[existingIndex] = incomingOrder;
      changed = true;
    }
  }

  return { orders: local, changed };
}

// El pedido activo de tracking/rider viaja aparte de la lista de pedidos. Lo
// aceptamos solo si apunta a un pedido entrante mas nuevo que el activo local.
export function chooseActiveOrderId(localOrders, localLastOrderId, incomingOrders, incomingLastOrderId) {
  const incoming = Array.isArray(incomingOrders) ? incomingOrders : [];
  const local = Array.isArray(localOrders) ? localOrders : [];
  const hasLocalLastOrder = typeof localLastOrderId === 'string'
    && local.some((order) => order?.id === localLastOrderId);
  const hasIncomingLastOrder = typeof incomingLastOrderId === 'string'
    && incoming.some((order) => order?.id === incomingLastOrderId);
  const currentId = hasLocalLastOrder
    ? localLastOrderId
    : chooseActiveLiveOrderId(local);
  const candidateId = hasIncomingLastOrder
    ? incomingLastOrderId
    : chooseActiveLiveOrderId(incoming);
  if (!candidateId) return currentId || null;

  const candidate = incoming.find((order) => order?.id === candidateId);
  if (!candidate) return currentId || null;

  const current = typeof currentId === 'string'
    ? local.find((order) => order?.id === currentId)
    : null;
  if (!current) return candidateId;
  if (candidateId === currentId) return currentId;
  return orderTimestamp(candidate) > orderTimestamp(current) ? candidateId : currentId;
}

// Para la simulación usamos un sello de tiempo monótono del emisor.
export function isNewerTimestamp(incomingTs, lastTs) {
  const a = Number(incomingTs);
  const b = Number(lastTs);
  if (!Number.isFinite(a)) return false;
  if (!Number.isFinite(b)) return true;
  return a > b;
}
