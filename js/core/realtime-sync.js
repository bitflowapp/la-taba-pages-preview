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
  // Confirmar el código o adjuntar la foto de entrega no cambia el status, pero
  // sí la versión del pedido: sin esto, esos cambios nunca se publican ni se
  // aceptan en los otros dispositivos de la sala.
  if (order.deliveryCode?.confirmedAt) candidates.push(order.deliveryCode.confirmedAt);
  if (order.deliveryProof?.capturedAt) candidates.push(order.deliveryProof.capturedAt);
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
  arriving: 0,
  ready: 1,
  preparing: 2,
  received: 3,
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

// Versión monótona que asigna PostgreSQL (orders.revision). Devuelve null
// cuando el pedido no proviene de Supabase (demo, relay, sandbox) o es anterior
// a la migración que agregó la columna.
export function orderRevision(order) {
  if (!order || typeof order !== 'object') return null;
  const revision = Number(order.revision);
  return Number.isSafeInteger(revision) && revision > 0 ? revision : null;
}

// Devuelve true si `incoming` debe reemplazar a `local` (es más nuevo o el local no existe).
//
// La revisión manda sobre la marca de tiempo. Motivo medido en staging: now()
// es constante durante toda una transacción de PostgreSQL, así que dos
// escrituras de la misma transacción comparten created_at al microsegundo (3
// de 19 eventos reales). Con la comparación por timestamp y `>` estricto, la
// segunda actualización se descartaba en silencio. orders.revision, en cambio,
// crece con CADA UPDATE efectivo, así que nunca empata.
//
// Cuando alguno de los dos lados no tiene revisión se conserva el criterio por
// marca de tiempo: los pedidos de demo/relay/sandbox no tienen versión de
// servidor y deben seguir reconciliándose como antes.
export function shouldReplaceOrder(localOrder, incomingOrder) {
  if (!incomingOrder || typeof incomingOrder.id !== 'string') return false;
  if (!localOrder) return true;

  const incomingRevision = orderRevision(incomingOrder);
  const localRevision = orderRevision(localOrder);
  if (incomingRevision !== null && localRevision !== null) {
    return incomingRevision > localRevision;
  }
  // Un lado versionado y el otro no: el versionado proviene del servidor y es
  // la autoridad. Adoptarlo evita quedar pegado a una copia local sin versión.
  if (incomingRevision !== null) return true;
  if (localRevision !== null) return false;

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

const TERMINAL_SYNC_STATUSES = Object.freeze(['delivered', 'cancelled', 'canceled']);
function isTerminalSyncStatus(status) {
  return TERMINAL_SYNC_STATUSES.includes(status);
}

// El pedido activo de tracking/rider viaja aparte de la lista de pedidos.
// Regla: un activo local VÁLIDO (presente y no terminal) manda. Un fallback
// "live" entrante NO puede desplazarlo solo por timestamp; únicamente un
// incomingLastOrderId EXPLÍCITO y más nuevo puede reemplazarlo. Si el activo
// local no existe / es terminal / no había lastOrderId, recién ahí elegimos el
// pedido activo por estado + timestamp entre lo local y lo entrante.
export function chooseActiveOrderId(localOrders, localLastOrderId, incomingOrders, incomingLastOrderId) {
  const incoming = Array.isArray(incomingOrders) ? incomingOrders : [];
  const local = Array.isArray(localOrders) ? localOrders : [];

  const localActive = typeof localLastOrderId === 'string'
    ? local.find((order) => order?.id === localLastOrderId)
    : null;
  const localHolds = Boolean(localActive) && !isTerminalSyncStatus(localActive.status);

  const incomingExplicit = typeof incomingLastOrderId === 'string' && incomingLastOrderId
    ? incoming.find((order) => order?.id === incomingLastOrderId)
    : null;

  // Caso 1: hay un activo local válido. Solo un handoff explícito y más nuevo lo reemplaza.
  if (localHolds) {
    if (incomingExplicit
      && incomingExplicit.id !== localLastOrderId
      && orderTimestamp(incomingExplicit) > orderTimestamp(localActive)) {
      return incomingExplicit.id;
    }
    return localLastOrderId;
  }

  // Caso 2: sin activo local válido (no existe, terminal o no había lastOrderId).
  // Handoff explícito, o pedido live por estado + timestamp entre local y entrante.
  const currentId = chooseActiveLiveOrderId(local);
  const candidateId = incomingExplicit ? incomingExplicit.id : chooseActiveLiveOrderId(incoming);
  if (!candidateId) return currentId || null;

  const candidate = incoming.find((order) => order?.id === candidateId);
  if (!candidate) return currentId || null;

  const current = currentId ? local.find((order) => order?.id === currentId) : null;
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

// ===== Conexión con el relay (puro y testeable, sin EventSource ni DOM) =====

// Backoff exponencial acotado para reabrir el stream SSE cuando el relay cae.
// attempt empieza en 1: 1s, 2s, 4s, 8s, … hasta `maxMs`. Mantiene los reintentos
// frecuentes al principio y espaciados después, sin martillar el servidor.
export function computeRelayBackoffMs(attempt, { baseMs = 1000, maxMs = 15_000 } = {}) {
  const safeAttempt = Math.max(1, Math.floor(Number(attempt) || 1));
  const safeBase = Math.max(1, Number(baseMs) || 1000);
  const safeMax = Math.max(safeBase, Number(maxMs) || 15_000);
  const raw = safeBase * (2 ** (safeAttempt - 1));
  return Math.min(safeMax, raw);
}

// Etiqueta honesta del estado de conexión con la sala, para que la UI muestre
// "conectado / reconectando / sin conexión / sólo este equipo" sin inventar.
export function relayStatusLabel(status = {}) {
  if (!status.relayEnabled) return 'Sólo este equipo';
  switch (status.relayState) {
    case 'connected':
      return status.pendingSnapshot ? 'Reconectando' : 'Sincronizado';
    case 'connecting':
      return 'Reconectando';
    case 'offline':
      return 'Sin conexión';
    case 'reconnecting':
    default:
      return status.relayConnected && !status.pendingSnapshot ? 'Sincronizado' : 'Reconectando';
  }
}

export function normalizeRealtimeSnapshot(value = {}) {
  const orders = Array.isArray(value?.orders)
    ? value.orders.filter((order) => order && typeof order === 'object' && String(order.id || '').trim())
    : [];
  const lastOrderId = typeof value?.lastOrderId === 'string' && value.lastOrderId.trim()
    ? value.lastOrderId.trim()
    : null;
  const simulation = value?.simulation && typeof value.simulation === 'object'
    ? value.simulation
    : null;
  return { orders, lastOrderId, simulation };
}

// El relay nunca reemplaza ciegamente una sala. Fusiona cada pedido por su
// timestamp de dominio, conserva entidades ausentes en un emisor atrasado y
// sólo cambia la simulación cuando trae un sello más reciente.
export function mergeRealtimeSnapshots(authoritativeValue = {}, incomingValue = {}) {
  const authoritative = normalizeRealtimeSnapshot(authoritativeValue);
  const incoming = normalizeRealtimeSnapshot(incomingValue);
  const mergedOrders = mergeOrders(authoritative.orders, incoming.orders).orders;
  const lastOrderId = chooseActiveOrderId(
    authoritative.orders,
    authoritative.lastOrderId,
    incoming.orders,
    incoming.lastOrderId,
  );
  const simulation = chooseRealtimeSimulation(authoritative.simulation, incoming.simulation);
  const snapshot = {
    orders: mergedOrders,
    lastOrderId: mergedOrders.some((order) => order.id === lastOrderId) ? lastOrderId : null,
    simulation,
  };
  return {
    snapshot,
    changed: realtimeSnapshotFingerprint(snapshot) !== realtimeSnapshotFingerprint(authoritative),
  };
}

export function realtimeSnapshotFingerprint(value = {}) {
  return JSON.stringify(normalizeRealtimeSnapshot(value));
}

function chooseRealtimeSimulation(authoritative, incoming) {
  if (!incoming) return authoritative || null;
  if (!authoritative) return incoming;
  const incomingTime = realtimeSimulationTimestamp(incoming);
  const authoritativeTime = realtimeSimulationTimestamp(authoritative);
  return incomingTime > authoritativeTime ? incoming : authoritative;
}

function realtimeSimulationTimestamp(value) {
  if (!value) return 0;
  const numeric = Number(value.timestamp);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(
    value.lastGpsFixAt
      || value.lastFixAt
      || value.lastPublishedAt
      || value.updatedAt
      || '',
  );
  return Number.isNaN(parsed) ? 0 : parsed;
}
