export function createIndexedDbCommandStorage({
  indexedDB = globalThis.indexedDB,
  databaseName = 'taba-business',
  storeName = 'command_outbox',
  version = 2,
} = {}) {
  if (!indexedDB?.open) throw new Error('IndexedDB no est\u00e1 disponible.');
  let databasePromise = null;

  function open() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, version);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(storeName)) {
          const store = database.createObjectStore(storeName, { keyPath: 'commandId' });
          store.createIndex('idempotencyKey', 'idempotencyKey', { unique: true });
          store.createIndex('stateNextAttempt', ['state', 'nextAttemptAt'], { unique: false });
        }
        ensurePackingCacheStore(database);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('No se pudo abrir IndexedDB.'));
      request.onblocked = () => reject(new Error('La actualizaci\u00f3n de IndexedDB est\u00e1 bloqueada por otra pesta\u00f1a.'));
    });
    return databasePromise;
  }

  async function request(mode, operation) {
    const database = await open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      const result = operation(store);
      result.onsuccess = () => resolve(result.result);
      result.onerror = () => reject(result.error || transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Transacci\u00f3n IndexedDB abortada.'));
    });
  }

  return Object.freeze({
    async put(command) { await request('readwrite', (store) => store.put(command)); return command; },
    async get(commandId) { return request('readonly', (store) => store.get(commandId)); },
    async list() { return request('readonly', (store) => store.getAll()); },
    async findByIdempotencyKey(key) { return request('readonly', (store) => store.index('idempotencyKey').get(key)); },
    async deleteWhere(predicate) {
      const commands = await this.list();
      let count = 0;
      for (const command of commands) if (predicate(command)) { await request('readwrite', (store) => store.delete(command.commandId)); count += 1; }
      return count;
    },
  });
}

export function createIndexedDbPackingCache({
  indexedDB = globalThis.indexedDB,
  databaseName = 'taba-business',
  storeName = 'packing_cache',
  version = 2,
} = {}) {
  if (!indexedDB?.open) throw new Error('IndexedDB no está disponible.');
  let databasePromise = null;

  function open() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, version);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('command_outbox')) {
          const commands = database.createObjectStore('command_outbox', { keyPath: 'commandId' });
          commands.createIndex('idempotencyKey', 'idempotencyKey', { unique: true });
          commands.createIndex('stateNextAttempt', ['state', 'nextAttemptAt'], { unique: false });
        }
        ensurePackingCacheStore(database, storeName);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('No se pudo abrir IndexedDB.'));
      request.onblocked = () => reject(new Error('La actualización de IndexedDB está bloqueada por otra pestaña.'));
    });
    return databasePromise;
  }

  async function request(mode, operation) {
    const database = await open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      const result = operation(store);
      result.onsuccess = () => resolve(result.result);
      result.onerror = () => reject(result.error || transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Transacción IndexedDB abortada.'));
    });
  }

  return Object.freeze({
    async save(snapshot) {
      validatePackingCache(snapshot);
      await request('readwrite', (store) => store.put(structuredCloneSafe(snapshot)));
      return snapshot;
    },
    async load(businessId) {
      const key = safeBusinessId(businessId);
      return request('readonly', (store) => store.get(key));
    },
    async delete(businessId) {
      const key = safeBusinessId(businessId);
      await request('readwrite', (store) => store.delete(key));
      return true;
    },
  });
}

function ensurePackingCacheStore(database, storeName = 'packing_cache') {
  if (!database.objectStoreNames.contains(storeName)) {
    const store = database.createObjectStore(storeName, { keyPath: 'businessId' });
    store.createIndex('savedAt', 'savedAt', { unique: false });
  }
}

function validatePackingCache(snapshot) {
  const businessId = safeBusinessId(snapshot?.businessId);
  if (Number(snapshot?.schemaVersion) !== 1 || !businessId || !snapshot?.serverSessionId || !snapshot?.orderId) {
    throw new Error('La caché de packing es inválida.');
  }
  const serialized = JSON.stringify(snapshot);
  if (serialized.length > 2_000_000 || hasSensitiveKey(snapshot)) {
    throw new Error('La caché de packing contiene datos no permitidos.');
  }
}

function hasSensitiveKey(value) {
  if (!value || typeof value !== 'object') return false;
  const blocked = /password|secret|token|jwt|service.?role|private.?key|delivery.?code|customer.?phone|address/i;
  return Object.entries(value).some(([key, nested]) => blocked.test(key)
    || (typeof nested === 'object' && hasSensitiveKey(nested)));
}

function safeBusinessId(value) {
  const normalized = String(value || '');
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(normalized)) throw new Error('Negocio de caché inválido.');
  return normalized;
}

function structuredCloneSafe(value) { return JSON.parse(JSON.stringify(value)); }
