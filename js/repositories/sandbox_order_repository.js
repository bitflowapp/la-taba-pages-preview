import { seedOrders } from '../data.js';
import {
  confirmDeliveryCode,
  getLastOrder,
} from '../orders.js';
import {
  getState,
  normalizeOrderForStorage,
  setState,
  subscribe,
} from '../state.js';
import { toDomainOrder } from '../core/domain.js';
import { createDemoOrderRepository } from './demo_order_repository.js';
import { repositoryResult } from './order_repository.js';

export const SANDBOX_DB_NAME = 'taba-sandbox';
export const SANDBOX_DB_VERSION = 2;
export const SANDBOX_STORE_NAME = 'snapshots';
export const SANDBOX_CLAIMS_STORE_NAME = 'claims';
export const SANDBOX_SNAPSHOT_KEY = 'active';
export const SANDBOX_SCHEMA_VERSION = 1;
export const SANDBOX_STATUS_FLOW = Object.freeze([
  'received',
  'preparing',
  'ready',
  'on_the_way',
  'arriving',
  'delivered',
  'cancelled',
]);

const SANDBOX_SYNC_KEY = 'taba-sandbox-sync-v1';
const SANDBOX_RIDER_KEY = 'taba-sandbox-rider-id';
const SANDBOX_CHANNEL = 'taba-sandbox-state-v1';

let memorySnapshot = null;

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function riderId() {
  try {
    const storage = globalThis.sessionStorage;
    const current = storage?.getItem(SANDBOX_RIDER_KEY);
    if (current) return current;
    const generated = `sandbox-rider-${Math.random().toString(36).slice(2, 10)}`;
    storage?.setItem(SANDBOX_RIDER_KEY, generated);
    return generated;
  } catch (_) {
    return 'sandbox-rider-local';
  }
}

function cloneStateForSnapshot(state = getState()) {
  return {
    schemaVersion: SANDBOX_SCHEMA_VERSION,
    savedAt: nowIso(),
    state: clone(state),
  };
}

function snapshotState(snapshot) {
  return snapshot?.state && typeof snapshot.state === 'object' ? snapshot.state : null;
}

function isValidSnapshot(snapshot) {
  return Boolean(
    snapshot
      && snapshot.schemaVersion === SANDBOX_SCHEMA_VERSION
      && snapshot.state
      && typeof snapshot.state === 'object'
      && !Array.isArray(snapshot.state),
  );
}

function sandboxSeedState() {
  const current = getState();
  return {
    ...clone(current),
    cart: [],
    orders: seedOrders.map((order) => normalizeOrderForStorage(order)).filter(Boolean),
    lastOrderId: null,
    lastCheckoutDraft: null,
    pendingReorder: null,
    simulation: null,
    adminUnlocked: false,
  };
}

function openDatabase() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SANDBOX_DB_NAME, SANDBOX_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SANDBOX_STORE_NAME)) {
        database.createObjectStore(SANDBOX_STORE_NAME);
      }
      if (!database.objectStoreNames.contains(SANDBOX_CLAIMS_STORE_NAME)) {
        database.createObjectStore(SANDBOX_CLAIMS_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('No se pudo abrir la base sandbox.'));
  });
}

function readFromDatabase(database) {
  if (!database) return Promise.resolve(memorySnapshot);
  return new Promise((resolve, reject) => {
    const request = database
      .transaction(SANDBOX_STORE_NAME, 'readonly')
      .objectStore(SANDBOX_STORE_NAME)
      .get(SANDBOX_SNAPSHOT_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('No se pudo leer la sesión sandbox.'));
  });
}

export function canTransitionSandboxStatus(currentStatus, nextStatus) {
  if (currentStatus === 'cancelled' || currentStatus === 'delivered') return false;
  if (nextStatus === 'cancelled') return true;
  const currentIndex = SANDBOX_STATUS_FLOW.indexOf(currentStatus);
  return currentIndex >= 0 && SANDBOX_STATUS_FLOW[currentIndex + 1] === nextStatus;
}

function writeToDatabase(database, snapshot) {
  memorySnapshot = clone(snapshot);
  if (!database) return Promise.resolve(true);
  return new Promise((resolve, reject) => {
    const request = database
      .transaction(SANDBOX_STORE_NAME, 'readwrite')
      .objectStore(SANDBOX_STORE_NAME)
      .put(snapshot, SANDBOX_SNAPSHOT_KEY);
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error || new Error('No se pudo guardar la sesión sandbox.'));
  });
}

function clearDatabase(database) {
  memorySnapshot = null;
  if (!database) return Promise.resolve(true);
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(
      [SANDBOX_STORE_NAME, SANDBOX_CLAIMS_STORE_NAME],
      'readwrite',
    );
    transaction.objectStore(SANDBOX_STORE_NAME).clear();
    transaction.objectStore(SANDBOX_CLAIMS_STORE_NAME).clear();
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error || new Error('No se pudo reiniciar la sesión sandbox.'));
  });
}

function publishStorageTick(lastStorageTickRef = null) {
  try {
    const tick = String(Date.now());
    if (lastStorageTickRef) lastStorageTickRef.value = tick;
    globalThis.localStorage?.setItem(SANDBOX_SYNC_KEY, tick);
  } catch (_) {
    // El canal BroadcastChannel sigue funcionando aunque storage esté bloqueado.
  }
}

function readStorageTick() {
  try {
    return globalThis.localStorage?.getItem(SANDBOX_SYNC_KEY) || '';
  } catch (_) {
    return '';
  }
}

export function createSandboxOrderRepository({ baseRepository = createDemoOrderRepository() } = {}) {
  let database = null;
  let started = false;
  let starting = null;
  let unsubState = null;
  let channel = null;
  let applyingRemote = false;
  let lastAppliedRevision = 0;
  const lastStorageTickRef = { value: readStorageTick() };

  async function persistAndPublish(state = getState()) {
    const snapshot = cloneStateForSnapshot(state);
    lastAppliedRevision = Math.max(lastAppliedRevision, Date.parse(snapshot.savedAt) || Date.now());
    await writeToDatabase(database, snapshot);
    if (channel) {
      try {
        channel.postMessage({
          type: 'state',
          revision: lastAppliedRevision,
          snapshot,
        });
      } catch (_) {
        // La persistencia local no depende del canal de sincronización.
      }
    }
    publishStorageTick(lastStorageTickRef);
    return snapshot;
  }

  async function applySnapshot(snapshot) {
    if (!isValidSnapshot(snapshot)) return false;
    const revision = Date.parse(snapshot.savedAt) || 0;
    if (revision && revision <= lastAppliedRevision) return false;
    lastAppliedRevision = revision || Date.now();
    applyingRemote = true;
    try {
      setState(snapshotState(snapshot));
      await writeToDatabase(database, snapshot);
    } finally {
      applyingRemote = false;
    }
    return true;
  }

  async function readAndApplyLatest() {
    const snapshot = await readFromDatabase(database);
    if (!isValidSnapshot(snapshot)) return false;
    return applySnapshot(snapshot);
  }

  async function claimRiderOrderAtomically(publicCode, assigned) {
    if (!database) return null;

    return new Promise((resolve, reject) => {
      let outcome = null;
      let committedSnapshot = null;
      const transaction = database.transaction(
        [SANDBOX_STORE_NAME, SANDBOX_CLAIMS_STORE_NAME],
        'readwrite',
      );
      const store = transaction.objectStore(SANDBOX_STORE_NAME);
      const claimStore = transaction.objectStore(SANDBOX_CLAIMS_STORE_NAME);
      const timestamp = nowIso();
      const claimRequest = claimStore.add({ riderId: assigned, claimedAt: timestamp }, publicCode);

      claimRequest.onerror = (event) => {
        event.preventDefault();
        outcome = repositoryResult(false, {
          code: 'CLAIM_CONFLICT',
          message: 'Otro rider ya tomó este pedido.',
        });
      };

      claimRequest.onsuccess = () => {
        const readRequest = store.get(SANDBOX_SNAPSHOT_KEY);
        readRequest.onsuccess = () => {
          const currentSnapshot = readRequest.result;
          const currentState = snapshotState(currentSnapshot);
          const order = currentState?.orders?.find((candidate) => candidate.id === publicCode);
          if (!isValidSnapshot(currentSnapshot) || !order
            || order.deliveryMode !== 'delivery'
            || order.status !== 'ready'
            || order.assignedRiderId) {
            claimStore.delete(publicCode);
            outcome = repositoryResult(false, {
              code: 'CLAIM_CONFLICT',
              message: 'Otro rider ya tomó este pedido.',
            });
            return;
          }

          const nextState = {
            ...clone(currentState),
            orders: currentState.orders.map((candidate) => candidate.id === publicCode
              ? {
                ...candidate,
                assignedRiderId: assigned,
                assignedAt: timestamp,
                riderStage: 'assigned',
              }
              : candidate),
          };
          committedSnapshot = {
            schemaVersion: SANDBOX_SCHEMA_VERSION,
            savedAt: timestamp,
            state: nextState,
          };
          store.put(committedSnapshot, SANDBOX_SNAPSHOT_KEY);
          outcome = repositoryResult(true, {
            message: 'Rider asignado.',
            order: toDomainOrder(nextState.orders.find((candidate) => candidate.id === publicCode)),
          });
        };
        readRequest.onerror = () => reject(readRequest.error || new Error('No se pudo leer el pedido.'));
      };

      transaction.oncomplete = () => {
        if (!outcome?.ok || !committedSnapshot) {
          resolve(outcome);
          return;
        }
        lastAppliedRevision = Math.max(
          lastAppliedRevision,
          Date.parse(committedSnapshot.savedAt) || Date.now(),
        );
        setState(committedSnapshot.state);
        if (channel) {
          try {
            channel.postMessage({
              type: 'state',
              revision: lastAppliedRevision,
              snapshot: committedSnapshot,
            });
          } catch (_) {
            // La persistencia local no depende del canal de sincronizaciÃ³n.
          }
        }
        publishStorageTick(lastStorageTickRef);
        resolve(outcome);
      };
      transaction.onerror = () => {
        if (outcome && !outcome.ok) {
          resolve(outcome);
          return;
        }
        reject(transaction.error || new Error('No se pudo asignar el pedido.'));
      };
      transaction.onabort = () => {
        if (outcome && !outcome.ok) {
          resolve(outcome);
          return;
        }
        reject(transaction.error || new Error('No se pudo asignar el pedido.'));
      };
    });
  }

  function receiveMessage(message) {
    if (!message || message.type !== 'state' || !isValidSnapshot(message.snapshot)) return;
    void applySnapshot(message.snapshot);
  }

  function bindSync() {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(SANDBOX_CHANNEL);
      channel.addEventListener('message', (event) => receiveMessage(event.data));
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', async (event) => {
        if (event.key !== SANDBOX_SYNC_KEY || !event.newValue || event.newValue === lastStorageTickRef.value) return;
        lastStorageTickRef.value = event.newValue;
        await readAndApplyLatest();
      });
    }
  }

  function unbindSync() {
    if (channel) {
      try { channel.close(); } catch (_) { /* no-op */ }
      channel = null;
    }
    if (unsubState) {
      unsubState();
      unsubState = null;
    }
  }

  async function startSync() {
    if (started) return () => unbindSync();
    if (starting) return starting;
    starting = (async () => {
      try {
        database = await openDatabase();
        const existing = await readFromDatabase(database);
        if (isValidSnapshot(existing)) {
          const local = getState();
          const localHasOperationalData = local.orders.some((order) => !order.internalSeed)
            || local.simulation?.source === 'gps'
            || local.orders.some((order) => order.tracking?.lastLocation?.source === 'gps');
          const existingState = snapshotState(existing);
          const localLooksNewer = localHasOperationalData
            && (local.lastOrderId !== existingState.lastOrderId
              || local.simulation?.source !== existingState.simulation?.source
              || local.orders.length !== existingState.orders.length
              || local.orders.some((order) => order.tracking?.lastLocation?.source === 'gps'));
          if (localLooksNewer) {
            await writeToDatabase(database, cloneStateForSnapshot(local));
          } else {
            lastAppliedRevision = Date.parse(existing.savedAt) || 0;
            setState({ ...existingState, adminUnlocked: local.adminUnlocked });
          }
        } else {
          await writeToDatabase(database, cloneStateForSnapshot(getState()));
        }
        bindSync();
        unsubState = subscribe((state) => {
          if (!started || applyingRemote) return;
          void persistAndPublish(state);
        });
        started = true;
        return () => unbindSync();
      } catch (error) {
        // Sandbox sigue usable en memoria si IndexedDB fue bloqueado por el navegador.
        database = null;
        await writeToDatabase(null, cloneStateForSnapshot(getState()));
        bindSync();
        unsubState = subscribe((state) => {
          if (!started || applyingRemote) return;
          void persistAndPublish(state);
        });
        started = true;
        return () => unbindSync();
      }
    })();
    const result = await starting;
    starting = null;
    return result;
  }

  async function resetSandbox() {
    const resetState = sandboxSeedState();
    if (!database) database = await openDatabase();
    await clearDatabase(database);
    setState(resetState);
    await writeToDatabase(database, cloneStateForSnapshot(getState()));
    if (started) await persistAndPublish(getState());
    return repositoryResult(true, { message: 'Sandbox reiniciada.' });
  }

  async function exportSandboxState() {
    const snapshot = cloneStateForSnapshot(getState());
    return {
      schemaVersion: SANDBOX_SCHEMA_VERSION,
      exportedAt: nowIso(),
      state: snapshot.state,
    };
  }

  async function importSandboxState(payload) {
    const candidate = typeof payload === 'string' ? JSON.parse(payload) : payload;
    const snapshot = candidate?.state
      ? { schemaVersion: SANDBOX_SCHEMA_VERSION, savedAt: nowIso(), state: candidate.state }
      : candidate;
    if (!isValidSnapshot(snapshot)) {
      return repositoryResult(false, { code: 'SANDBOX_IMPORT_INVALID', message: 'El archivo sandbox no es válido.' });
    }
    await applySnapshot(snapshot);
    if (started) await persistAndPublish(getState());
    return repositoryResult(true, { message: 'Estado sandbox importado.' });
  }

  const repository = {
    ...baseRepository,
    mode: 'sandbox',
    startSync,
    resetSandbox,
    exportSandboxState,
    importSandboxState,
    getRiderId: riderId,
    verifyDeliveryCode(orderId, code) {
      return confirmDeliveryCode(orderId, code);
    },
    async claimRiderOrder(publicCode, options = {}) {
      const order = getState().orders.find((candidate) => candidate.id === publicCode);
      if (!order || order.deliveryMode !== 'delivery' || order.status !== 'ready' || order.assignedRiderId) {
        return repositoryResult(false, {
          code: 'CLAIM_CONFLICT',
          message: 'Otro rider ya tomó este pedido.',
        });
      }
      const assigned = options.riderId || riderId();
      if (database && started) {
        const atomicResult = await claimRiderOrderAtomically(publicCode, assigned);
        if (atomicResult) return atomicResult;
      }
      const result = baseRepository.assignRider(publicCode, assigned);
      if (result?.ok) {
        const timestamp = nowIso();
        setState({
          orders: getState().orders.map((candidate) => candidate.id === publicCode
            ? { ...candidate, riderStage: 'assigned', assignedAt: timestamp }
            : candidate),
        });
      }
      return result;
    },
  };

  return repository;
}

export function isSandboxOrderRepository(repository) {
  return repository?.mode === 'sandbox';
}

export function sandboxSnapshotFromState(state) {
  return cloneStateForSnapshot(state);
}

export function isSandboxStorageAvailable() {
  return typeof indexedDB !== 'undefined';
}
