export const COMMAND_STATES = Object.freeze(['pending', 'sending', 'confirmed', 'conflicted', 'failed', 'cancelled']);
const RETRYABLE_CODES = new Set(['NETWORK_ERROR', 'TIMEOUT', 'SERVER_UNAVAILABLE', 'RATE_LIMITED', 'LEASE_EXPIRED']);

export function createBusinessCommand(input, { now = () => new Date(), randomId = defaultId } = {}) {
  const commandType = String(input?.commandType || '').trim();
  const idempotencyKey = String(input?.idempotencyKey || '').trim();
  if (!commandType || !idempotencyKey || !input?.businessId) throw new Error('El comando requiere tipo, negocio e idempotencia.');
  const expectedRevision = input.expectedRevision == null ? null : Number(input.expectedRevision);
  if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) {
    throw new RangeError('La revisi\u00f3n esperada no es v\u00e1lida.');
  }
  const createdAt = now().toISOString();
  return Object.freeze({
    commandId: String(input.commandId || randomId()), idempotencyKey,
    businessId: String(input.businessId), orderId: input.orderId ? String(input.orderId) : null,
    commandType, expectedRevision, payload: minimizePayload(input.payload), createdAt,
    attemptCount: 0, nextAttemptAt: createdAt, lastErrorCode: null,
    lastErrorMessage: null, state: 'pending', sendingStartedAt: null, confirmedAt: null,
  });
}

export function createCommandOutbox({
  storage, now = () => new Date(), random = Math.random,
  maxAttempts = 8, baseBackoffMs = 1000, maxBackoffMs = 5 * 60 * 1000,
  sendingLeaseMs = 2 * 60 * 1000,
} = {}) {
  if (!storage || typeof storage.put !== 'function' || typeof storage.list !== 'function') {
    throw new Error('La outbox requiere almacenamiento durable.');
  }
  let draining = null;
  let enqueueChain = Promise.resolve();

  // El encolado se serializa: dos clicks en el mismo tick hac\u00edan dos
  // read-then-write en paralelo y el segundo mor\u00eda contra el \u00edndice \u00fanico de
  // IndexedDB con una excepci\u00f3n sin manejar. En cadena, el segundo encuentra
  // el comando del primero y lo devuelve como replay.
  function enqueue(input) {
    const run = enqueueChain.then(async () => {
      const command = createBusinessCommand(input, { now });
      const existing = await storage.findByIdempotencyKey(command.idempotencyKey);
      if (existing) return existing;
      try {
        await storage.put(command);
      } catch (error) {
        /*
         * OTRA PESTAÑA GANÓ LA CARRERA, Y ESO NO ES UN ERROR.
         *
         * La cadena de arriba serializa el encolado DE ESTA pestaña. El
         * almacenamiento, en cambio, es de todo el origen: dos pestañas
         * abiertas en el mostrador tienen cada una su propia cadena y las dos
         * pueden pasar el `findByIdempotencyKey` antes de que cualquiera
         * escriba. La segunda choca contra el índice único de IndexedDB.
         *
         * Antes, ese choque viajaba como excepción hasta la acción del
         * operador: la pantalla decía que falló algo que en realidad ya estaba
         * encolado y en camino. La clave de idempotencia es determinista
         * -tipo, pedido, revisión y estado destino-, así que las dos pestañas
         * estaban pidiendo EXACTAMENTE lo mismo.
         *
         * Se relee y se devuelve el comando ganador: es el mismo replay que
         * devuelve el camino de arriba. Si no hay ganador, el error era otro y
         * viaja.
         */
        const ganador = await storage.findByIdempotencyKey(command.idempotencyKey);
        if (!ganador) throw error;
        return ganador;
      }
      return command;
    });
    enqueueChain = run.catch(() => {});
    return run;
  }

  // `force` existe para el arranque: la p\u00e1gina reci\u00e9n carg\u00f3, as\u00ed que ning\u00fan
  // `sending` puede estar realmente en vuelo EN ESTA pesta\u00f1a. Otra pesta\u00f1a
  // enviando en paralelo queda cubierta por el receipt idempotente del servidor.
  async function recoverAbandoned({ force = false } = {}) {
    const threshold = now().getTime() - sendingLeaseMs;
    const commands = await storage.list();
    const recovered = [];
    for (const command of commands) {
      if (command.state !== 'sending') continue;
      const started = Date.parse(command.sendingStartedAt || command.createdAt);
      if (!force && Number.isFinite(started) && started > threshold) continue;
      const next = { ...command, state: 'pending', nextAttemptAt: now().toISOString(), sendingStartedAt: null, lastErrorCode: 'LEASE_EXPIRED', lastErrorMessage: 'Env\u00edo anterior interrumpido.' };
      await storage.put(next);
      recovered.push(next);
    }
    return recovered;
  }

  async function list(options = {}) {
    const commands = await storage.list();
    return commands.filter((command) => !options.state || command.state === options.state);
  }

  async function drain({ reconcile, send }) {
    if (draining) return draining;
    if (typeof reconcile !== 'function' || typeof send !== 'function') throw new Error('El procesamiento requiere reconcile y send.');
    draining = processDue({ reconcile, send }).finally(() => { draining = null; });
    return draining;
  }

  // Cuándo hay que volver a intentar: el mínimo nextAttemptAt de los pendientes.
  // Devuelve null sin pendientes. Es lo que permite que un reintento programado
  // por backoff efectivamente ocurra en vez de esperar el próximo click.
  async function nextDueAt() {
    const commands = await storage.list();
    const pending = commands.filter((command) => command.state === 'pending');
    if (!pending.length) return null;
    return pending.reduce(
      (earliest, command) => Math.min(earliest, Date.parse(command.nextAttemptAt) || 0),
      Number.POSITIVE_INFINITY,
    );
  }

  async function processDue({ reconcile, send }) {
    await recoverAbandoned();
    const timestamp = now().getTime();
    const commands = (await storage.list())
      .filter((command) => command.state === 'pending' && Date.parse(command.nextAttemptAt) <= timestamp)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    const results = [];
    for (const command of commands) results.push(await processOne(command, { reconcile, send }));
    return results;
  }

  async function processOne(command, { reconcile, send }) {
    const current = await storage.get(command.commandId);
    if (!current || current.state !== 'pending') return current;
    const sending = { ...current, state: 'sending', sendingStartedAt: now().toISOString(), attemptCount: current.attemptCount + 1 };
    await storage.put(sending);
    try {
      const snapshot = await reconcile(sending);
      if (snapshot?.alreadyApplied) return confirm(sending, snapshot);
      if (snapshot?.conflict) return markConflict(sending, snapshot);
      const result = await send(sending, snapshot);
      if (result?.ok) return confirm(sending, result);
      if (result?.conflict) return markConflict(sending, result);
      return failOrRetry(sending, result || { code: 'UNKNOWN_ERROR', message: 'El servidor no confirm\u00f3 el comando.' });
    } catch (error) {
      return failOrRetry(sending, { code: error?.code || 'NETWORK_ERROR', message: error?.message || 'Error de red.' });
    }
  }

  async function confirm(command, result) {
    const next = { ...command, state: 'confirmed', sendingStartedAt: null, confirmedAt: now().toISOString(), lastErrorCode: null, lastErrorMessage: null, serverRevision: safeRevision(result?.revision) };
    await storage.put(next);
    return next;
  }

  async function markConflict(command, result) {
    const next = { ...command, state: 'conflicted', sendingStartedAt: null, lastErrorCode: String(result?.code || 'REVISION_CONFLICT'), lastErrorMessage: safeMessage(result?.message || 'El servidor cambi\u00f3 desde la lectura local.'), serverRevision: safeRevision(result?.revision) };
    await storage.put(next);
    return next;
  }

  async function failOrRetry(command, result) {
    const code = String(result?.code || 'UNKNOWN_ERROR');
    const retryable = result?.retryable === true || RETRYABLE_CODES.has(code);
    const exhausted = command.attemptCount >= maxAttempts;
    const state = retryable && !exhausted ? 'pending' : 'failed';
    const next = {
      ...command, state, sendingStartedAt: null, lastErrorCode: code,
      lastErrorMessage: safeMessage(result?.message),
      nextAttemptAt: state === 'pending' ? new Date(now().getTime() + backoff(command.attemptCount)).toISOString() : command.nextAttemptAt,
    };
    await storage.put(next);
    return next;
  }

  function backoff(attempt) {
    const ceiling = Math.min(maxBackoffMs, baseBackoffMs * (2 ** Math.max(0, attempt - 1)));
    return Math.max(baseBackoffMs, Math.round(ceiling * (0.75 + Math.max(0, Math.min(1, random())) * 0.5)));
  }

  async function cancel(commandId) {
    const command = await storage.get(commandId);
    if (!command || ['confirmed', 'cancelled'].includes(command.state)) return false;
    await storage.put({ ...command, state: 'cancelled', sendingStartedAt: null });
    return true;
  }

  async function archiveConfirmed(before) {
    const cutoff = before instanceof Date ? before.getTime() : Date.parse(before || '');
    if (!Number.isFinite(cutoff)) throw new Error('La fecha de archivo no es v\u00e1lida.');
    return storage.deleteWhere((command) => command.state === 'confirmed' && Date.parse(command.confirmedAt) < cutoff);
  }

  return Object.freeze({ enqueue, list, drain, recoverAbandoned, cancel, archiveConfirmed, nextDueAt });
}

export function createMemoryCommandStorage(seed = []) {
  const records = new Map(seed.map((item) => [item.commandId, structuredCloneSafe(item)]));
  return Object.freeze({
    // El índice único de `idempotencyKey` no es un detalle de IndexedDB: es la
    // garantía de que la misma acción no se encola dos veces. Este doble lo
    // respeta para que una prueba con almacenamiento en memoria signifique lo
    // mismo que el camino real; sin esto, la carrera entre dos pestañas pasaba
    // desapercibida acá y rompía en producción.
    async put(command) {
      for (const existente of records.values()) {
        if (existente.idempotencyKey !== command.idempotencyKey) continue;
        if (existente.commandId === command.commandId) continue;
        throw Object.assign(new Error('ConstraintError: idempotencyKey duplicada.'), { name: 'ConstraintError' });
      }
      records.set(command.commandId, structuredCloneSafe(command));
      return command;
    },
    async get(commandId) { return structuredCloneSafe(records.get(commandId) || null); },
    async list() { return [...records.values()].map(structuredCloneSafe); },
    async findByIdempotencyKey(key) { return structuredCloneSafe([...records.values()].find((command) => command.idempotencyKey === key) || null); },
    async deleteWhere(predicate) { let count = 0; for (const [id, command] of records) if (predicate(command)) { records.delete(id); count += 1; } return count; },
  });
}

function minimizePayload(payload) {
  if (payload == null) return Object.freeze({});
  if (typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('El payload minimizado debe ser un objeto.');
  const blocked = /password|secret|token|jwt|service.?role|private.?key|delivery.?code|certificate|full.?address|customer.?phone/i;
  const result = {};
  for (const [key, value] of Object.entries(payload)) {
    if (blocked.test(key) || value === undefined) continue;
    if (value !== null && typeof value === 'object') throw new TypeError(`El campo ${key} debe ser escalar.`);
    result[key] = typeof value === 'string' ? value.slice(0, 500) : value;
  }
  return Object.freeze(result);
}

function safeRevision(value) { const revision = Number(value); return Number.isSafeInteger(revision) && revision > 0 ? revision : null; }
function safeMessage(value) { return String(value || '').replace(/[\r\n\t]+/g, ' ').slice(0, 300); }
function defaultId() { return globalThis.crypto?.randomUUID?.() || `cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function structuredCloneSafe(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
