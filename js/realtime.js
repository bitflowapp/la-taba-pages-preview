// Puente realtime de demostración para La Taba.
//
// Dos transportes, misma lógica de aplicación:
//   1) BroadcastChannel  -> sincroniza pestañas/ventanas en el MISMO navegador
//      (ideal para probar en una compu o en los tests e2e). Siempre activo.
//   2) Relay SSE opcional -> sincroniza DOS dispositivos distintos en la misma
//      Wi-Fi, si la página se abre con ?relay=...&room=... (ver scripts/realtime-relay.mjs).
//
// Si no hay relay, la app funciona igual en modo local (un solo equipo).
// Nunca se envía nada a internet: el relay es un proceso propio en la LAN.
//
// IMPORTANTE: esto es una demo. El tiempo real "de verdad" entre clientes
// remotos necesita backend gestionado (Supabase Realtime, Firebase, WebSocket).
import { getState, setState, subscribe } from './state.js';
import { isNewerTimestamp, mergeOrders, orderTimestamp } from './core/realtime-sync.js';

const DEVICE_KEY = 'la_taba_device_id';
const ROOM_KEY = 'la_taba_rt_room';

let deviceId = null;
let room = 'demo';
let relayBase = null;
let channel = null;
let eventSource = null;
let relayConnected = false;
let applyingRemote = false;
let lastSnapshotHash = '';
let lastRemoteSimTs = 0;
let started = false;

export function getDeviceId() {
  if (deviceId) return deviceId;
  let stored = safeGet(DEVICE_KEY);
  if (!stored) {
    stored = (globalThis.crypto?.randomUUID?.() || `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    safeSet(DEVICE_KEY, stored);
  }
  deviceId = stored;
  return deviceId;
}

function safeGet(key) {
  try { return globalThis.localStorage?.getItem(key) ?? null; } catch (_) { return null; }
}
function safeSet(key, value) {
  try { globalThis.localStorage?.setItem(key, value); } catch (_) { /* ignore */ }
}

function readParams() {
  let search = '';
  try { search = globalThis.location?.search || ''; } catch (_) { search = ''; }
  const params = new URLSearchParams(search);
  const paramRoom = params.get('room');
  room = sanitizeRoom(paramRoom || safeGet(ROOM_KEY) || 'demo');
  safeSet(ROOM_KEY, room);
  const relay = params.get('relay');
  relayBase = relay ? relay.replace(/\/+$/, '') : null;
}

function sanitizeRoom(value) {
  return String(value || 'demo').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60) || 'demo';
}

export function initRealtime() {
  if (started) return;
  started = true;
  getDeviceId();
  readParams();
  setupBroadcastChannel();
  if (relayBase) setupRelay();
  // Publicamos cuando cambian los pedidos o la simulación.
  subscribe(handleLocalChange);
  lastSnapshotHash = hashSnapshot(snapshot());
  // Pedimos a los pares su estado actual (un rider recién abierto recibe el pedido del cliente).
  publish({ kind: 'hello' });
}

function setupBroadcastChannel() {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    channel = new BroadcastChannel(`la-taba-rt-${room}`);
    channel.onmessage = (event) => applyRemote(event.data);
  } catch (_) {
    channel = null;
  }
}

function setupRelay() {
  if (typeof EventSource === 'undefined') return;
  try {
    eventSource = new EventSource(`${relayBase}/events?room=${encodeURIComponent(room)}`);
    eventSource.addEventListener('ready', () => { relayConnected = true; rerenderStatus(); });
    eventSource.addEventListener('message', (event) => {
      try { applyRemote(JSON.parse(event.data)); } catch (_) { /* ignore malformed */ }
    });
    eventSource.onopen = () => { relayConnected = true; rerenderStatus(); };
    eventSource.onerror = () => { relayConnected = false; rerenderStatus(); };
  } catch (_) {
    eventSource = null;
  }
}

function snapshot() {
  const state = getState();
  return { orders: state.orders, simulation: state.simulation };
}

function hashSnapshot(snap) {
  const orders = (snap.orders || []).map((order) => `${order.id}:${order.status}:${orderTimestamp(order)}`).join('|');
  const sim = snap.simulation
    ? `${snap.simulation.orderId}:${snap.simulation.routeId || ''}:${snap.simulation.destinationId || ''}:${snap.simulation.progress}:${snap.simulation.running}:${snap.simulation.etaMinutes}:${snap.simulation.lat}:${snap.simulation.lng}:${snap.simulation.source}:${snap.simulation.timestamp || snap.simulation.lastFixAt || ''}`
    : 'none';
  return `${orders}#${sim}`;
}

function handleLocalChange() {
  if (applyingRemote) return;
  const snap = snapshot();
  const hash = hashSnapshot(snap);
  if (hash === lastSnapshotHash) return;
  lastSnapshotHash = hash;
  publish({ kind: 'state', orders: snap.orders, simulation: snap.simulation });
}

function publish(message) {
  const payload = { ...message, sender: getDeviceId(), room, ts: Date.now() };
  if (channel) {
    try { channel.postMessage(payload); } catch (_) { /* ignore */ }
  }
  if (relayBase && typeof fetch === 'function') {
    try {
      fetch(`${relayBase}/publish?room=${encodeURIComponent(room)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => { /* relay caído: seguimos en local */ });
    } catch (_) { /* ignore */ }
  }
}

function applyRemote(message) {
  if (!message || typeof message !== 'object') return;
  if (message.sender && message.sender === getDeviceId()) return; // no aplicar el propio eco
  if (message.room && message.room !== room) return;

  if (message.kind === 'hello') {
    // Un par pide el estado actual: se lo mandamos.
    publish({ kind: 'state', orders: getState().orders, simulation: getState().simulation });
    return;
  }
  if (message.kind !== 'state') return;

  const local = getState();
  const { orders, changed } = mergeOrders(local.orders, message.orders || []);

  let nextSimulation = local.simulation;
  let simChanged = false;
  if (Object.prototype.hasOwnProperty.call(message, 'simulation') && isNewerTimestamp(message.ts, lastRemoteSimTs)) {
    lastRemoteSimTs = message.ts;
    nextSimulation = message.simulation || null;
    simChanged = JSON.stringify(nextSimulation) !== JSON.stringify(local.simulation);
  }

  if (!changed && !simChanged) return;

  applyingRemote = true;
  setState({
    orders: changed ? orders : local.orders,
    ...(simChanged ? { simulation: nextSimulation } : {}),
  });
  applyingRemote = false;
  lastSnapshotHash = hashSnapshot(snapshot());
}

let statusListener = null;
export function onRealtimeStatusChange(listener) {
  statusListener = typeof listener === 'function' ? listener : null;
}
function rerenderStatus() {
  if (statusListener) {
    try { statusListener(getRealtimeStatus()); } catch (_) { /* ignore */ }
  }
}

export function getRealtimeStatus() {
  return {
    room,
    deviceId: getDeviceId(),
    relayEnabled: Boolean(relayBase),
    relayBase,
    relayConnected,
    channelEnabled: Boolean(channel),
  };
}
