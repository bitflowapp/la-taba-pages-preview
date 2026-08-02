export function createBusinessOrderStore(seed = []) {
  let orders = normalizeOrders(seed);
  let lastSuccessfulSyncAt = null;
  const listeners = new Set();

  function applyAuthoritativeSnapshot(nextOrders, syncedAt = new Date().toISOString()) {
    if (!Array.isArray(nextOrders)) throw new TypeError('El snapshot de pedidos debe ser una lista.');
    const normalized = normalizeOrders(nextOrders);
    const byId = new Map(orders.map((order) => [identity(order), order]));
    orders = normalized.map((order) => {
      const previous = byId.get(identity(order));
      const previousRevision = revision(previous);
      const nextRevision = revision(order);
      return previous && previousRevision > nextRevision ? previous : order;
    });
    lastSuccessfulSyncAt = syncedAt;
    publish();
    return getSnapshot();
  }

  function publish() { for (const listener of listeners) listener(getSnapshot()); }
  function getSnapshot() { return { orders: structuredCloneSafe(orders), lastSuccessfulSyncAt }; }
  return Object.freeze({
    getSnapshot,
    applyAuthoritativeSnapshot,
    find(orderId) { return structuredCloneSafe(orders.find((order) => identity(order) === String(orderId)) || null); },
    subscribe(listener) { listeners.add(listener); listener(getSnapshot()); return () => listeners.delete(listener); },
  });
}

function normalizeOrders(value) {
  return value.filter((order) => order && identity(order)).map(structuredCloneSafe);
}
function identity(order) { return String(order?.backendId || order?.id || order?.code || ''); }
function revision(order) { const value = Number(order?.revision); return Number.isSafeInteger(value) && value > 0 ? value : 0; }
function structuredCloneSafe(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
