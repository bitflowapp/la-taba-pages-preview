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

// Para la simulación usamos un sello de tiempo monótono del emisor.
export function isNewerTimestamp(incomingTs, lastTs) {
  const a = Number(incomingTs);
  const b = Number(lastTs);
  if (!Number.isFinite(a)) return false;
  if (!Number.isFinite(b)) return true;
  return a > b;
}
