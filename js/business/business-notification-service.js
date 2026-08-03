export function createBusinessNotificationService({ platform, sound }) {
  const notified = new Set();
  let muted = false;
  return Object.freeze({
    get muted() { return muted; },
    async setMuted(value) {
      muted = Boolean(value);
      sound?.setMuted?.(muted);
      await platform?.setMuted?.(muted);
      return muted;
    },
    async newOrder(order) {
      const id = String(order?.backendId || order?.id || '');
      if (!id || notified.has(id) || muted) return false;
      notified.add(id);
      await Promise.allSettled([
        sound?.playNewOrder?.(),
        platform?.notify?.({ title: 'Nuevo pedido', body: `Pedido ${order.code || order.id || ''}`.trim() }),
      ]);
      return true;
    },
  });
}
