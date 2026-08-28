import { normalizeWorkflowStatus } from './order-workflow.js';

export const BUSINESS_INBOX_STATUSES = Object.freeze([
  'submitted',
  'accepted',
  'preparing',
  'ready',
  'assigned',
  'picked_up',
  'on_the_way',
  'arrived',
]);

// La base conserva vocabulario histórico (`received`, `arriving`) por
// compatibilidad. La consulta debe incluirlo y normalizarlo en el adaptador.
export const BUSINESS_INBOX_DATABASE_STATUSES = Object.freeze([
  ...BUSINESS_INBOX_STATUSES,
  'received',
  'arriving',
]);

const ACTIVE_STATUS_SET = new Set(BUSINESS_INBOX_STATUSES);
const STATUS_PRIORITY = new Map(BUSINESS_INBOX_STATUSES.map((status, index) => [status, index]));
const ALERT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const ALERT_RECORD_LIMIT = 500;

export function businessOrderIdentity(order = {}) {
  return String(order.backendId || order.order_id || order.id || '').trim();
}

export function businessOrderRevision(order = {}) {
  const revision = Number(order.revision);
  return Number.isSafeInteger(revision) && revision > 0 ? revision : null;
}

export function isBusinessInboxOrder(order = {}) {
  return ACTIVE_STATUS_SET.has(normalizeWorkflowStatus(order.workflowStatus || order.status, ''));
}

export function compareBusinessInboxOrders(a, b) {
  const aStatus = normalizeWorkflowStatus(a?.workflowStatus || a?.status, '');
  const bStatus = normalizeWorkflowStatus(b?.workflowStatus || b?.status, '');
  const statusDifference = (STATUS_PRIORITY.get(aStatus) ?? 999) - (STATUS_PRIORITY.get(bStatus) ?? 999);
  if (statusDifference !== 0) return statusDifference;

  const aTime = Date.parse(a?.createdAt || '');
  const bTime = Date.parse(b?.createdAt || '');
  const safeATime = Number.isFinite(aTime) ? aTime : Number.MAX_SAFE_INTEGER;
  const safeBTime = Number.isFinite(bTime) ? bTime : Number.MAX_SAFE_INTEGER;
  if (safeATime !== safeBTime) return safeATime - safeBTime;

  return businessOrderIdentity(a).localeCompare(businessOrderIdentity(b), 'en');
}

export function reconcileBusinessOrderSnapshot(currentOrders = [], snapshotOrders = [], {
  revisionWatermarks = new Map(),
  inactiveOrderIds = new Set(),
} = {}) {
  const currentById = new Map();
  for (const order of Array.isArray(currentOrders) ? currentOrders : []) {
    const id = businessOrderIdentity(order);
    const revision = businessOrderRevision(order);
    if (!id || revision === null) continue;
    currentById.set(id, order);
    revisionWatermarks.set(id, Math.max(revisionWatermarks.get(id) || 0, revision));
  }

  const incomingById = new Map();
  for (const order of Array.isArray(snapshotOrders) ? snapshotOrders : []) {
    const id = businessOrderIdentity(order);
    const revision = businessOrderRevision(order);
    if (!id || revision === null) continue;
    const duplicate = incomingById.get(id);
    if (!duplicate || revision > businessOrderRevision(duplicate)) incomingById.set(id, order);
  }

  const nextOrders = [];
  const newOrderIds = [];
  const updatedOrderIds = [];
  const acceptedIds = new Set();

  for (const [id, incoming] of incomingById) {
    const incomingRevision = businessOrderRevision(incoming);
    const knownRevision = revisionWatermarks.get(id) || 0;
    const current = currentById.get(id);

    if (incomingRevision < knownRevision) {
      if (current && isBusinessInboxOrder(current)) {
        nextOrders.push(current);
        acceptedIds.add(id);
      }
      continue;
    }
    if (incomingRevision === knownRevision && inactiveOrderIds.has(id) && !current) continue;

    revisionWatermarks.set(id, Math.max(knownRevision, incomingRevision));
    if (!isBusinessInboxOrder(incoming)) {
      inactiveOrderIds.add(id);
      continue;
    }

    inactiveOrderIds.delete(id);
    nextOrders.push(incoming);
    acceptedIds.add(id);
    if (!current && knownRevision === 0) newOrderIds.push(id);
    else if (!current || incomingRevision > businessOrderRevision(current)) updatedOrderIds.push(id);
  }

  const removedOrderIds = [];
  for (const [id, current] of currentById) {
    if (acceptedIds.has(id)) continue;
    const revision = businessOrderRevision(current);
    revisionWatermarks.set(id, Math.max(revisionWatermarks.get(id) || 0, revision || 0));
    inactiveOrderIds.add(id);
    removedOrderIds.push(id);
  }

  nextOrders.sort(compareBusinessInboxOrders);
  return {
    orders: nextOrders,
    newOrderIds,
    updatedOrderIds,
    removedOrderIds,
    revisionWatermarks,
    inactiveOrderIds,
  };
}

export function createBusinessOrderIntakeCoordinator({
  businessId,
  fetchSnapshot,
  subscribeRealtime,
  getCurrentOrders,
  applyOrders,
  onStatusChange = () => {},
  onOrderAlert = () => {},
  // Los pedidos que el Panel YA tenía en pantalla antes de armar este
  // coordinador. Sin esto, la supresión de alertas es «primera sincronización»
  // en vez de «lo que ya sabíamos»: un coordinador nuevo siembra `seenOrderIds`
  // con TODO el snapshot sin avisar de nada, así que un pedido que entra justo
  // mientras el coordinador se reconstruye —al volver a la pestaña, al
  // recuperar la sesión, al reconectar— entra a la bandeja MUDO.
  knownOrderIds = null,
  pollMs = 5000,
  lifecycleTarget = defaultLifecycleTarget(),
  visibilityTarget = defaultVisibilityTarget(),
  broadcastFactory = defaultBroadcastFactory,
  storage = defaultStorage(),
  locks = defaultLocks(),
  now = () => Date.now(),
  setTimer = globalThis.setTimeout?.bind(globalThis),
  clearTimer = globalThis.clearTimeout?.bind(globalThis),
  instanceId = createInstanceId(),
  isOnline = defaultIsOnline,
} = {}) {
  if (!businessId) throw new Error('El coordinador de pedidos requiere businessId.');
  if (typeof fetchSnapshot !== 'function') throw new Error('El coordinador de pedidos requiere fetchSnapshot.');
  if (typeof subscribeRealtime !== 'function') throw new Error('El coordinador de pedidos requiere subscribeRealtime.');
  if (typeof getCurrentOrders !== 'function') throw new Error('El coordinador de pedidos requiere getCurrentOrders.');
  if (typeof applyOrders !== 'function') throw new Error('El coordinador de pedidos requiere applyOrders.');

  const channelName = `la-taba-business-intake:${businessId}`;
  const storageInvalidationKey = `${channelName}:invalidate`;
  const storageAlertKey = `${channelName}:alerts`;
  const revisionWatermarks = new Map();
  const inactiveOrderIds = new Set();
  // Si el llamador sabe qué pedidos ya estaban en pantalla, la línea de base es
  // exactamente esa y no «lo que venga en el primer snapshot»: así un pedido
  // llegado durante la reconstrucción sí se anuncia.
  const seedOrderIds = Array.isArray(knownOrderIds)
    ? knownOrderIds.map((id) => String(id || '')).filter(Boolean)
    : null;
  const seenOrderIds = new Set(seedOrderIds || []);
  const lifecycleStops = [];
  const normalizedPollMs = Math.max(1000, Number(pollMs) || 5000);
  let running = false;
  let realtimeStop = null;
  let realtimeState = 'idle';
  let broadcastChannel = null;
  let pollTimer = null;
  let syncPromise = null;
  let syncQueued = false;
  // Con una semilla explícita, la línea de base ya está establecida antes del
  // primer snapshot: lo que no venga en esa semilla es nuevo y se anuncia.
  let baselineEstablished = Boolean(seedOrderIds);
  let status = freezeStatus({
    phase: 'idle',
    realtime: 'idle',
    lastSuccessfulSyncAt: null,
    error: '',
    reason: '',
  });

  function getStatus() {
    return status;
  }

  function setStatus(patch) {
    const next = freezeStatus({ ...status, ...patch, realtime: realtimeState });
    if (statusFingerprint(next) === statusFingerprint(status)) return;
    status = next;
    try {
      onStatusChange(status);
    } catch (_) {
      // La UI no puede romper la recepción de pedidos.
    }
  }

  async function start() {
    if (running) return syncPromise || Promise.resolve({ ok: true, alreadyRunning: true });
    running = true;
    setupPeerInvalidation();
    setupLifecycleRecovery();
    setStatus({
      phase: isOnline() ? 'recovering' : 'offline',
      reason: 'startup',
      error: '',
    });

    // Orden deliberado: snapshot, suscripción, snapshot al confirmar la
    // suscripción. El segundo snapshot cierra la ventana intermedia.
    const initial = await synchronize('startup-snapshot');
    if (!running) return initial;
    realtimeState = 'connecting';
    setStatus({ realtime: realtimeState });
    realtimeStop = subscribeRealtime({
      onInvalidate: () => {
        broadcastInvalidation('realtime-change');
        void invalidate('realtime-change');
      },
      onStatus: handleRealtimeStatus,
    }) || null;
    schedulePoll();
    return initial;
  }

  function stop() {
    if (!running) return false;
    running = false;
    realtimeStop?.();
    realtimeStop = null;
    realtimeState = 'idle';
    if (pollTimer !== null && clearTimer) clearTimer(pollTimer);
    pollTimer = null;
    for (const stopLifecycle of lifecycleStops.splice(0)) stopLifecycle();
    try {
      broadcastChannel?.close?.();
    } catch (_) {
      // Un canal ya cerrado no necesita recuperación.
    }
    broadcastChannel = null;
    setStatus({ phase: 'idle', realtime: realtimeState, reason: 'stopped', error: '' });
    return true;
  }

  async function invalidate(reason = 'manual') {
    if (!running) return { ok: false, stopped: true };
    if (syncPromise) {
      syncQueued = true;
      return syncPromise;
    }
    return synchronize(reason);
  }

  async function synchronize(reason) {
    if (!running) return { ok: false, stopped: true };
    if (!isOnline()) {
      setStatus({ phase: 'offline', reason, error: '' });
      return { ok: false, offline: true };
    }
    if (syncPromise) {
      syncQueued = true;
      return syncPromise;
    }

    syncPromise = (async () => {
      let lastResult = { ok: false };
      do {
        syncQueued = false;
        /*
         * «Recuperando» sólo cuando de verdad hay algo que recuperar.
         *
         * Esto anunciaba `recovering` en CADA sincronización, también en la del
         * sondeo de seguridad, que corre cada cinco segundos y no es una
         * recuperación: es el latido normal. En pantalla eso son doce
         * parpadeos por minuto de «Recuperando pedidos» sobre una bandeja que
         * está perfectamente al día, y en el DOM es un cambio de marcado que
         * REEMPLAZA el tablero entero dos veces por vuelta.
         *
         * Medido con 300 pedidos a 390px: 29 reemplazos del workspace en
         * treinta segundos sin que el servidor cambiara nada, cada uno de
         * 864 KB de marcado y 15.298 nodos.
         *
         * Estando ya conectado, un refresco en curso no cambia la respuesta a
         * «¿la bandeja está al día?»: se anuncia el resultado, no el intento.
         * Cuando el estado NO es conectado —arranque, error, vuelta de sin
         * conexión— «Recuperando» sí dice algo y se sigue anunciando.
         */
        if (status.phase !== 'connected') setStatus({ phase: 'recovering', reason, error: '' });
        try {
          const result = await fetchSnapshot({ reason });
          if (!running) return { ok: false, stopped: true };
          if (!result?.ok || !Array.isArray(result.orders)) {
            const message = String(result?.message || 'No pudimos recuperar los pedidos.');
            setStatus({ phase: isOnline() ? 'error' : 'offline', reason, error: message });
            lastResult = { ok: false, message, code: result?.code || 'SNAPSHOT_FAILED' };
            continue;
          }

          const previousOrders = getCurrentOrders();
          const reconciled = reconcileBusinessOrderSnapshot(previousOrders, result.orders, {
            revisionWatermarks,
            inactiveOrderIds,
          });
          const previousIds = new Set((Array.isArray(previousOrders) ? previousOrders : [])
            .map(businessOrderIdentity)
            .filter(Boolean));
          applyOrders(reconciled.orders, {
            reason,
            syncedAt: result.syncedAt || new Date(now()).toISOString(),
            ...reconciled,
          });

          const currentIds = reconciled.orders.map(businessOrderIdentity).filter(Boolean);
          if (baselineEstablished) {
            for (const id of currentIds) {
              if (!previousIds.has(id) && !seenOrderIds.has(id)) {
                const order = reconciled.orders.find((candidate) => businessOrderIdentity(candidate) === id);
                void alertOnce(order);
              }
            }
          }
          currentIds.forEach((id) => seenOrderIds.add(id));
          baselineEstablished = true;

          const syncedAt = result.syncedAt || new Date(now()).toISOString();
          setStatus({ phase: 'connected', lastSuccessfulSyncAt: syncedAt, reason, error: '' });
          lastResult = { ok: true, orders: reconciled.orders, syncedAt };
        } catch (error) {
          if (!running) return { ok: false, stopped: true };
          const message = String(error?.message || 'No pudimos recuperar los pedidos.');
          setStatus({ phase: isOnline() ? 'error' : 'offline', reason, error: message });
          lastResult = { ok: false, message, code: 'SNAPSHOT_EXCEPTION' };
        }
      } while (running && syncQueued);
      return lastResult;
    })();

    try {
      return await syncPromise;
    } finally {
      syncPromise = null;
    }
  }

  function handleRealtimeStatus(nextStatus) {
    if (!running) return;
    const normalized = String(nextStatus || '').toUpperCase();
    if (normalized === 'SUBSCRIBED') {
      realtimeState = 'connected';
      setStatus({ phase: isOnline() ? 'recovering' : 'offline', reason: 'realtime-connected', error: '' });
      void invalidate('realtime-connected');
      return;
    }
    if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(normalized)) {
      realtimeState = 'error';
      setStatus({
        phase: isOnline() ? 'error' : 'offline',
        reason: 'realtime-error',
        error: 'Realtime interrumpido; recuperamos desde PostgreSQL.',
      });
      void invalidate('realtime-error');
      return;
    }
    realtimeState = normalized ? normalized.toLowerCase() : 'connecting';
    setStatus({ realtime: realtimeState });
  }

  function schedulePoll() {
    if (!running || !setTimer) return;
    if (pollTimer !== null && clearTimer) clearTimer(pollTimer);
    pollTimer = setTimer(async () => {
      pollTimer = null;
      await invalidate('safety-poll');
      schedulePoll();
    }, normalizedPollMs);
  }

  function setupLifecycleRecovery() {
    addLifecycleListener(lifecycleTarget, 'online', () => {
      setStatus({ phase: 'recovering', reason: 'online', error: '' });
      broadcastInvalidation('online');
      void invalidate('online');
    });
    addLifecycleListener(lifecycleTarget, 'offline', () => {
      setStatus({ phase: 'offline', reason: 'offline', error: '' });
    });
    addLifecycleListener(lifecycleTarget, 'pageshow', () => {
      broadcastInvalidation('pageshow');
      void invalidate('pageshow');
    });
    addLifecycleListener(visibilityTarget, 'visibilitychange', () => {
      if (visibilityTarget?.visibilityState !== 'visible') return;
      broadcastInvalidation('foreground');
      void invalidate('foreground');
    });
  }

  function addLifecycleListener(target, event, handler) {
    if (!target?.addEventListener) return;
    target.addEventListener(event, handler);
    lifecycleStops.push(() => target.removeEventListener?.(event, handler));
  }

  function setupPeerInvalidation() {
    try {
      broadcastChannel = broadcastFactory?.(channelName) || null;
      if (broadcastChannel) {
        broadcastChannel.onmessage = (event) => {
          const message = event?.data;
          if (message?.type !== 'invalidate' || message.sender === instanceId) return;
          void invalidate('peer-invalidation');
        };
      }
    } catch (_) {
      broadcastChannel = null;
    }
    addLifecycleListener(lifecycleTarget, 'storage', (event) => {
      if (event?.key !== storageInvalidationKey || !event?.newValue) return;
      try {
        const message = JSON.parse(event.newValue);
        if (message.sender !== instanceId) void invalidate('peer-storage-invalidation');
      } catch (_) {
        // Una invalidación corrupta se ignora; el polling sigue siendo autoridad.
      }
    });
  }

  function broadcastInvalidation(reason) {
    if (!running) return;
    const message = { type: 'invalidate', sender: instanceId, reason, at: now() };
    try {
      broadcastChannel?.postMessage?.(message);
    } catch (_) {
      // El fallback storage y el polling siguen activos.
    }
    try {
      storage?.setItem?.(storageInvalidationKey, JSON.stringify(message));
    } catch (_) {
      // La indisponibilidad de storage no impide snapshots por pestaña.
    }
  }

  async function alertOnce(order) {
    const orderId = businessOrderIdentity(order);
    if (!orderId) return false;
    const lockName = `${channelName}:alert:${orderId}`;
    const claim = () => claimAlertRecord(storage, storageAlertKey, orderId, instanceId, now);
    let won = false;
    try {
      if (locks?.request) {
        await locks.request(lockName, { mode: 'exclusive' }, async () => {
          won = await claim();
        });
      } else {
        won = await claim();
      }
    } catch (_) {
      won = false;
    }
    if (!won || !running) return false;
    try {
      onOrderAlert(order);
    } catch (_) {
      // Una alerta visual fallida no puede invalidar la bandeja.
    }
    return true;
  }

  return {
    getStatus,
    invalidate,
    start,
    stop,
  };
}

async function claimAlertRecord(storage, key, orderId, instanceId, now) {
  if (!storage?.getItem || !storage?.setItem) return true;
  const timestamp = now();
  let records = readAlertRecords(storage, key, timestamp);
  if (records.some((record) => record.orderId === orderId)) return false;
  records.push({ orderId, owner: instanceId, at: timestamp });
  records = records.slice(-ALERT_RECORD_LIMIT);
  storage.setItem(key, JSON.stringify(records));
  await Promise.resolve();
  const confirmed = readAlertRecords(storage, key, timestamp)
    .find((record) => record.orderId === orderId);
  return confirmed?.owner === instanceId;
}

function readAlertRecords(storage, key, now) {
  try {
    const parsed = JSON.parse(storage.getItem(key) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((record) => (
        record
        && typeof record.orderId === 'string'
        && Number(record.at) >= now - ALERT_RETENTION_MS
      ))
      .slice(-ALERT_RECORD_LIMIT);
  } catch (_) {
    return [];
  }
}

function freezeStatus(value) {
  return Object.freeze({
    phase: value.phase,
    realtime: value.realtime,
    lastSuccessfulSyncAt: value.lastSuccessfulSyncAt,
    error: value.error,
    reason: value.reason,
  });
}

function statusFingerprint(value) {
  return JSON.stringify(value);
}

function defaultLifecycleTarget() {
  return typeof window !== 'undefined' ? window : null;
}

function defaultVisibilityTarget() {
  return typeof document !== 'undefined' ? document : null;
}

function defaultStorage() {
  try {
    return globalThis.localStorage || null;
  } catch (_) {
    return null;
  }
}

function defaultLocks() {
  try {
    return globalThis.navigator?.locks || null;
  } catch (_) {
    return null;
  }
}

function defaultBroadcastFactory(name) {
  return typeof globalThis.BroadcastChannel === 'function'
    ? new globalThis.BroadcastChannel(name)
    : null;
}

function defaultIsOnline() {
  try {
    return globalThis.navigator?.onLine !== false;
  } catch (_) {
    return true;
  }
}

function createInstanceId() {
  return globalThis.crypto?.randomUUID?.()
    || `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
