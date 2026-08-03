export const CONNECTIVITY_STATES = Object.freeze({
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
  OFFLINE: 'offline',
  SYNCING: 'syncing',
  SERVER_UNAVAILABLE: 'server_unavailable',
  SESSION_EXPIRED: 'session_expired',
});

export function createBusinessConnectivity({
  online = () => globalThis.navigator?.onLine !== false,
  windowObject = globalThis.window,
  now = () => new Date(),
} = {}) {
  let snapshot = Object.freeze({
    state: online() ? CONNECTIVITY_STATES.RECONNECTING : CONNECTIVITY_STATES.OFFLINE,
    online: online(),
    lastReconciledAt: null,
    errorCode: null,
  });
  const listeners = new Set();

  const publish = (patch) => {
    snapshot = Object.freeze({ ...snapshot, ...patch });
    for (const listener of listeners) listener(snapshot);
    return snapshot;
  };
  const onOnline = () => publish({ state: CONNECTIVITY_STATES.RECONNECTING, online: true, errorCode: null });
  const onOffline = () => publish({ state: CONNECTIVITY_STATES.OFFLINE, online: false, errorCode: 'NETWORK_ERROR' });
  windowObject?.addEventListener?.('online', onOnline);
  windowObject?.addEventListener?.('offline', onOffline);

  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); listener(snapshot); return () => listeners.delete(listener); },
    markSyncing: () => publish({ state: CONNECTIVITY_STATES.SYNCING, online: online(), errorCode: null }),
    markConnected: () => publish({
      state: CONNECTIVITY_STATES.CONNECTED,
      online: true,
      lastReconciledAt: now().toISOString(),
      errorCode: null,
    }),
    markFailure(code = 'SERVER_UNAVAILABLE') {
      const state = code === 'SESSION_EXPIRED'
        ? CONNECTIVITY_STATES.SESSION_EXPIRED
        : online() ? CONNECTIVITY_STATES.SERVER_UNAVAILABLE : CONNECTIVITY_STATES.OFFLINE;
      return publish({ state, online: online(), errorCode: code });
    },
    destroy() {
      windowObject?.removeEventListener?.('online', onOnline);
      windowObject?.removeEventListener?.('offline', onOffline);
      listeners.clear();
    },
  });
}

export function connectivityLabel(snapshot = {}) {
  return ({
    connected: 'Conectado',
    reconnecting: 'Reconectando',
    offline: 'Sin conexión',
    syncing: 'Sincronizando',
    server_unavailable: 'Servidor no disponible',
    session_expired: 'Sesión vencida',
  })[snapshot.state] || 'Reconectando';
}
