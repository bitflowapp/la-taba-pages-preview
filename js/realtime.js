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
import {
  chooseActiveOrderId,
  isNewerTimestamp,
  mergeOrders,
  orderTimestamp,
} from './core/realtime-sync.js';

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
const RECENT_GPS_MS = 5 * 60 * 1000;

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
  return { orders: state.orders, lastOrderId: state.lastOrderId, simulation: state.simulation };
}

function hashSnapshot(snap) {
  const orders = (snap.orders || []).map((order) => `${order.id}:${order.status}:${orderTimestamp(order)}`).join('|');
  const sim = snap.simulation
    ? `${snap.simulation.orderId}:${snap.simulation.routeId || ''}:${snap.simulation.destinationId || ''}:${snap.simulation.progress}:${snap.simulation.running}:${snap.simulation.etaMinutes}:${snap.simulation.lat}:${snap.simulation.lng}:${snap.simulation.mode || ''}:${snap.simulation.source}:${snap.simulation.gpsStatus || ''}:${snap.simulation.timestamp || snap.simulation.lastFixAt || ''}`
    : 'none';
  return `${orders}#${snap.lastOrderId || ''}#${sim}`;
}

function handleLocalChange() {
  if (applyingRemote) return;
  const snap = snapshot();
  const hash = hashSnapshot(snap);
  if (hash === lastSnapshotHash) return;
  lastSnapshotHash = hash;
  publish({ kind: 'state', orders: snap.orders, lastOrderId: snap.lastOrderId, simulation: snap.simulation });
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
    const snap = snapshot();
    publish({ kind: 'state', orders: snap.orders, lastOrderId: snap.lastOrderId, simulation: snap.simulation });
    return;
  }
  if (message.kind !== 'state') return;

  const local = getState();
  const { orders, changed } = mergeOrders(local.orders, message.orders || []);
  const nextLastOrderId = chooseActiveOrderId(local.orders, local.lastOrderId, message.orders || [], message.lastOrderId);
  const lastOrderChanged = nextLastOrderId !== (local.lastOrderId || null);

  let nextSimulation = local.simulation;
  let simChanged = false;
  if (Object.prototype.hasOwnProperty.call(message, 'simulation')) {
    const incomingSimulation = message.simulation || null;
    const shouldApplySimulation = shouldApplyRemoteSimulation(local.simulation, incomingSimulation, message.ts);
    if (isNewerTimestamp(message.ts, lastRemoteSimTs)) lastRemoteSimTs = message.ts;
    if (shouldApplySimulation) {
      nextSimulation = incomingSimulation;
      simChanged = JSON.stringify(nextSimulation) !== JSON.stringify(local.simulation);
    }
  }

  if (!changed && !lastOrderChanged && !simChanged) return;

  applyingRemote = true;
  setState({
    orders: changed ? orders : local.orders,
    ...(lastOrderChanged ? { lastOrderId: nextLastOrderId } : {}),
    ...(simChanged ? { simulation: nextSimulation } : {}),
  });
  applyingRemote = false;
  lastSnapshotHash = hashSnapshot(snapshot());
}

function shouldApplyRemoteSimulation(localSimulation, incomingSimulation, messageTs) {
  if (!incomingSimulation) return isNewerTimestamp(messageTs, lastRemoteSimTs);
  const incomingIsGps = incomingSimulation.source === 'gps';
  const localIsGps = localSimulation?.source === 'gps';

  if (incomingIsGps && !localIsGps) return true;
  if (localIsGps && !incomingIsGps && isRecentOrActiveGps(localSimulation)) return false;

  if (incomingIsGps && localIsGps) {
    const incomingFix = simulationTime(incomingSimulation);
    const localFix = simulationTime(localSimulation);
    if (incomingFix !== localFix) return incomingFix > localFix;
  }

  return isNewerTimestamp(messageTs, lastRemoteSimTs);
}

function isRecentOrActiveGps(simulation) {
  if (!simulation || simulation.source !== 'gps') return false;
  if (simulation.gpsStatus === 'active' || simulation.gpsStatus === 'requesting') return true;
  if (['inactive', 'denied', 'unavailable', 'requires_secure_context'].includes(simulation.gpsStatus)) return false;
  const fixTime = simulationTime(simulation);
  return fixTime > 0 && Date.now() - fixTime <= RECENT_GPS_MS;
}

function simulationTime(simulation) {
  if (!simulation) return 0;
  const numeric = Number(simulation.timestamp);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const fix = Date.parse(simulation.lastGpsFixAt || simulation.lastFixAt || simulation.lastPublishedAt || '');
  return Number.isNaN(fix) ? 0 : fix;
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
