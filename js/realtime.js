// Sincronización demo entre pestañas/equipos. El servidor es autoridad por sala:
// cada snapshot tiene revisión, ACK y recuperación explícita. Esto sigue siendo
// infraestructura de demostración; no reemplaza un backend operativo autenticado.
import { getState, setState, subscribe } from './state.js';
import {
  computeRelayBackoffMs,
  mergeRealtimeSnapshots,
  normalizeRealtimeSnapshot,
  realtimeSnapshotFingerprint,
} from './core/realtime-sync.js';

const DEVICE_STORAGE_KEY = 'la_taba_realtime_device';
const ROOM_STORAGE_KEY = 'la_taba_realtime_room';
const KEY_PATTERN = /^(?:[a-fA-F0-9]{64,128}|[a-zA-Z0-9_-]{43,128})$/;
const CONNECTED_POLL_MS = 20_000;
const RECOVERY_POLL_MS = 4_000;
const REQUEST_TIMEOUT_MS = 8_000;

let deviceId = '';
let room = 'demo';
let roomKey = '';
let relayBase = '';
let relayEnabled = false;
let relayState = 'offline';
let relayConnected = false;
let relayTransport = 'local';
let eventSource = null;
let channel = null;
let started = false;
let applyingRemote = false;
let lastSnapshotHash = '';
let lastServerRevision = 0;
let lastAckRevision = 0;
let lastSyncAt = null;
let lastAckAt = null;
let lastError = '';
let pendingSnapshot = null;
let publishInFlight = false;
let publishAttempt = 0;
let reconnectAttempt = 0;
let reconnectTimer = null;
let publishRetryTimer = null;
let pollTimer = null;
let recoveryPromise = null;
const statusListeners = new Set();

export function initRealtime() {
  if (started) return getRealtimeStatus();
  started = true;
  readParams();
  setupLifecycleRecovery();
  if (!relayEnabled) {
    relayState = relayBase ? 'offline' : 'local';
    notifyStatus();
    return getRealtimeStatus();
  }

  setupBroadcastChannel();
  subscribe(handleLocalChange);
  lastSnapshotHash = realtimeSnapshotFingerprint(currentSnapshot());
  setRelayState('connecting', false, 'initializing');
  openEventSource();
  void recoverFromRelay('startup');
  return getRealtimeStatus();
}

export function getRealtimeStatus() {
  return {
    room,
    roomKey,
    deviceId: getDeviceId(),
    relayBase,
    relayEnabled,
    relayConnected,
    relayState,
    relayTransport,
    revision: lastServerRevision,
    ackRevision: lastAckRevision,
    lastSyncAt,
    lastAckAt,
    lastError,
    pendingSnapshot: Boolean(pendingSnapshot),
    channel: Boolean(channel),
  };
}

export function onRealtimeStatusChange(listener) {
  if (typeof listener !== 'function') return () => undefined;
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

export function retryRelayConnection() {
  if (!relayEnabled) {
    return { ok: false, message: 'Esta sesión no tiene una sala compartida válida.' };
  }
  clearReconnectTimer();
  closeEventSource();
  setRelayState('reconnecting', false, 'manual_retry');
  openEventSource();
  void recoverFromRelay('manual');
  return { ok: true, message: 'Sincronizando la sala…' };
}

function readParams() {
  let params;
  try { params = new URLSearchParams(globalThis.location?.search || ''); } catch (_) { params = new URLSearchParams(); }
  room = sanitizeRoom(params.get('room') || safeStorageGet(ROOM_STORAGE_KEY) || 'demo');
  roomKey = String(params.get('key') || '').trim();
  relayBase = sanitizeRelayBase(params.get('relay'));
  relayEnabled = Boolean(relayBase && KEY_PATTERN.test(roomKey));
  if (room) safeStorageSet(ROOM_STORAGE_KEY, room);
  if (relayBase && !relayEnabled) lastError = 'missing_or_invalid_key';
}

function setupBroadcastChannel() {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    channel = new BroadcastChannel(`la-taba-rt-${room}`);
    channel.onmessage = (event) => applyIncoming(event.data, { source: 'channel' });
  } catch (_) {
    channel = null;
  }
}

function openEventSource() {
  if (!relayEnabled || typeof EventSource === 'undefined' || eventSource) return;
  try {
    eventSource = new EventSource(apiUrl('/events'));
    eventSource.addEventListener('ready', (event) => {
      reconnectAttempt = 0;
      markConnected('sse');
      try {
        const ready = JSON.parse(event.data || '{}');
        if (Number.isInteger(Number(ready.revision))) {
          lastServerRevision = Math.max(lastServerRevision, Number(ready.revision));
        }
      } catch (_) { /* malformed ready is recovered by snapshot */ }
      void recoverFromRelay('sse_ready');
    });
    eventSource.addEventListener('message', (event) => {
      try { applyIncoming(JSON.parse(event.data), { source: 'sse' }); } catch (_) { /* ignore malformed */ }
    });
    eventSource.onopen = () => markConnected('sse');
    eventSource.onerror = () => {
      closeEventSource();
      setRelayState(isOnline() ? 'reconnecting' : 'offline', false, 'sse_error');
      scheduleReconnect();
      schedulePoll(RECOVERY_POLL_MS);
    };
  } catch (_) {
    eventSource = null;
    setRelayState(isOnline() ? 'reconnecting' : 'offline', false, 'sse_open_failed');
    scheduleReconnect();
  }
}

function closeEventSource() {
  if (!eventSource) return;
  try { eventSource.close(); } catch (_) { /* ignore */ }
  eventSource = null;
}

function scheduleReconnect() {
  if (!relayEnabled || reconnectTimer || !isOnline()) return;
  reconnectAttempt += 1;
  const delay = computeRelayBackoffMs(reconnectAttempt);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    openEventSource();
    void recoverFromRelay('sse_reconnect');
  }, delay);
}

function clearReconnectTimer() {
  if (!reconnectTimer) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

async function recoverFromRelay(reason) {
  if (!relayEnabled) return false;
  if (!isOnline()) {
    setRelayState('offline', false, 'browser_offline');
    schedulePoll(RECOVERY_POLL_MS);
    return false;
  }
  if (recoveryPromise) return recoveryPromise;

  recoveryPromise = (async () => {
    if (!relayConnected) setRelayState(reason === 'startup' ? 'connecting' : 'reconnecting', false, reason);
    try {
      const response = await relayFetch(apiUrl('/snapshot'), { method: 'GET', cache: 'no-store' });
      if (!response.ok) throw relayHttpError(response.status);
      const envelope = await response.json();
      applyIncoming({ kind: 'state', ...envelope }, { source: 'snapshot' });
      markConnected(eventSource ? 'sse' : 'polling');
      queueSnapshot(currentSnapshot());
      await flushPendingSnapshot();
      schedulePoll(CONNECTED_POLL_MS);
      return true;
    } catch (error) {
      lastError = error?.code || error?.message || 'snapshot_failed';
      setRelayState(error?.status === 401 || error?.status === 403 ? 'offline' : 'reconnecting', false, lastError);
      schedulePoll(error?.status === 401 || error?.status === 403 ? 15_000 : RECOVERY_POLL_MS);
      return false;
    } finally {
      recoveryPromise = null;
    }
  })();
  return recoveryPromise;
}

function schedulePoll(delay) {
  if (!relayEnabled) return;
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(() => {
    pollTimer = null;
    void recoverFromRelay('poll');
  }, Math.max(500, Number(delay) || RECOVERY_POLL_MS));
}

function handleLocalChange() {
  if (applyingRemote || !relayEnabled) return;
  const snapshot = currentSnapshot();
  const hash = realtimeSnapshotFingerprint(snapshot);
  if (hash === lastSnapshotHash) return;
  lastSnapshotHash = hash;
  postToLocalPeers(snapshot);
  queueSnapshot(snapshot);
  void flushPendingSnapshot();
}

function queueSnapshot(snapshot) {
  const normalized = normalizeRealtimeSnapshot(snapshot);
  pendingSnapshot = {
    snapshot: normalized,
    hash: realtimeSnapshotFingerprint(normalized),
    queuedAt: Date.now(),
  };
  notifyStatus();
}

async function flushPendingSnapshot() {
  if (!relayEnabled || publishInFlight || !pendingSnapshot || !isOnline()) return false;
  const pending = pendingSnapshot;
  publishInFlight = true;
  try {
    const payload = {
      kind: 'state',
      sender: getDeviceId(),
      ts: Date.now(),
      snapshot: pending.snapshot,
      orders: pending.snapshot.orders,
      lastOrderId: pending.snapshot.lastOrderId,
      simulation: pending.snapshot.simulation,
    };
    const response = await relayFetch(apiUrl('/publish'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw relayHttpError(response.status);
    const ack = await response.json();
    if (!ack?.ok || !Number.isInteger(Number(ack.revision))) throw new Error('invalid_ack');
    lastAckRevision = Math.max(lastAckRevision, Number(ack.revision));
    lastServerRevision = Math.max(lastServerRevision, Number(ack.revision));
    lastAckAt = Date.now();
    lastSyncAt = Number(ack.updatedAt) || lastAckAt;
    lastError = '';
    publishAttempt = 0;
    if (pendingSnapshot?.hash === pending.hash) pendingSnapshot = null;
    markConnected(eventSource ? 'sse' : 'polling');
    notifyStatus();
    return true;
  } catch (error) {
    lastError = error?.code || error?.message || 'publish_failed';
    publishAttempt += 1;
    setRelayState(isOnline() ? 'reconnecting' : 'offline', false, lastError);
    schedulePublishRetry();
    return false;
  } finally {
    publishInFlight = false;
    if (pendingSnapshot && !publishRetryTimer) {
      queueMicrotask(() => void flushPendingSnapshot());
    }
  }
}

function schedulePublishRetry() {
  if (publishRetryTimer || !pendingSnapshot || !relayEnabled) return;
  const delay = computeRelayBackoffMs(publishAttempt, { baseMs: 750, maxMs: 15_000 });
  publishRetryTimer = setTimeout(() => {
    publishRetryTimer = null;
    void recoverFromRelay('publish_retry');
  }, delay);
}

function applyIncoming(message, { source } = {}) {
  if (!message || typeof message !== 'object') return;
  if (message.room && message.room !== room) return;
  if (source === 'channel' && message.sender === getDeviceId()) return;

  const revision = Number(message.revision);
  const hasRevision = Number.isInteger(revision) && revision >= 0;
  if (hasRevision && revision < lastServerRevision) return;

  if (message.kind === 'reset') {
    if (hasRevision && revision <= lastServerRevision) return;
    applyingRemote = true;
    setState({ orders: [], lastOrderId: null, simulation: null });
    applyingRemote = false;
    pendingSnapshot = null;
    lastSnapshotHash = realtimeSnapshotFingerprint(currentSnapshot());
    lastServerRevision = hasRevision ? revision : lastServerRevision;
    lastSyncAt = Number(message.updatedAt) || Date.now();
    notifyStatus();
    return;
  }
  if (message.kind && message.kind !== 'state') return;

  const incoming = normalizeRealtimeSnapshot(message.snapshot || message);
  const local = currentSnapshot();
  const merged = mergeRealtimeSnapshots(local, incoming);
  if (merged.changed) {
    applyingRemote = true;
    setState(merged.snapshot);
    applyingRemote = false;
    lastSnapshotHash = realtimeSnapshotFingerprint(currentSnapshot());
  }

  if (hasRevision) lastServerRevision = Math.max(lastServerRevision, revision);
  if (source !== 'channel') {
    lastSyncAt = Number(message.updatedAt) || Date.now();
    lastError = '';
    markConnected(source === 'sse' ? 'sse' : 'polling');
  }

  if (realtimeSnapshotFingerprint(merged.snapshot) !== realtimeSnapshotFingerprint(incoming)) {
    queueSnapshot(merged.snapshot);
    void flushPendingSnapshot();
  }
  notifyStatus();
}

function postToLocalPeers(snapshot) {
  if (!channel) return;
  try {
    channel.postMessage({
      kind: 'state',
      sender: getDeviceId(),
      room,
      snapshot,
      orders: snapshot.orders,
      lastOrderId: snapshot.lastOrderId,
      simulation: snapshot.simulation,
      ts: Date.now(),
    });
  } catch (_) { /* channel unavailable */ }
}

function setupLifecycleRecovery() {
  if (typeof window === 'undefined') return;
  window.addEventListener('online', () => {
    clearReconnectTimer();
    openEventSource();
    void recoverFromRelay('online');
  });
  window.addEventListener('offline', () => {
    closeEventSource();
    setRelayState('offline', false, 'browser_offline');
  });
  window.addEventListener('pageshow', () => void recoverFromRelay('pageshow'));
  window.addEventListener('taba:realtime-view-enter', () => void recoverFromRelay('view_enter'));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void recoverFromRelay('visible');
  });
}

function currentSnapshot() {
  const state = getState();
  return normalizeRealtimeSnapshot({
    orders: state.orders,
    lastOrderId: state.lastOrderId,
    simulation: state.simulation,
  });
}

function markConnected(transport) {
  relayTransport = transport || relayTransport;
  setRelayState('connected', true, '');
}

function setRelayState(nextState, connected, error) {
  const changed = relayState !== nextState || relayConnected !== Boolean(connected) || (error && lastError !== error);
  relayState = nextState;
  relayConnected = Boolean(connected);
  if (error) lastError = String(error);
  if (changed) notifyStatus();
}

function notifyStatus() {
  const status = getRealtimeStatus();
  for (const listener of statusListeners) {
    try { listener(status); } catch (_) { /* a renderer cannot break sync */ }
  }
}

async function relayFetch(url, options) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
  try {
    return await fetch(url, { ...options, ...(controller ? { signal: controller.signal } : {}) });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function apiUrl(pathname) {
  const separator = pathname.includes('?') ? '&' : '?';
  return `${relayBase}${pathname}${separator}room=${encodeURIComponent(room)}&key=${encodeURIComponent(roomKey)}`;
}

function relayHttpError(status) {
  const error = new Error(`relay_http_${status}`);
  error.status = status;
  error.code = status === 401 || status === 403 ? 'relay_auth_failed' : `relay_http_${status}`;
  return error;
}

function sanitizeRelayBase(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  try {
    const parsed = new URL(raw, globalThis.location?.href || 'http://localhost/');
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.origin + parsed.pathname.replace(/\/+$/, '');
  } catch (_) {
    return '';
  }
}

function sanitizeRoom(value) {
  const normalized = String(value || 'demo').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  return normalized || 'demo';
}

export function getDeviceId() {
  if (deviceId) return deviceId;
  const stored = safeStorageGet(DEVICE_STORAGE_KEY);
  if (stored) {
    deviceId = stored;
    return deviceId;
  }
  const random = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  deviceId = `device-${String(random).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60)}`;
  safeStorageSet(DEVICE_STORAGE_KEY, deviceId);
  return deviceId;
}

function safeStorageGet(key) {
  try { return globalThis.sessionStorage?.getItem(key) || ''; } catch (_) { return ''; }
}

function safeStorageSet(key, value) {
  try { globalThis.sessionStorage?.setItem(key, value); } catch (_) { /* storage optional */ }
}

function isOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}
