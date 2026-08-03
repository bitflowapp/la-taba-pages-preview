export function createIndexedDbCommandStorage({
  indexedDB = globalThis.indexedDB,
  databaseName = 'taba-business',
  storeName = 'command_outbox',
  version = 1,
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
