import { createCommandOutbox } from './business-command-outbox.js';
import { createBusinessConnectivity, CONNECTIVITY_STATES } from './business-connectivity.js';
import { buildBusinessRuntimeViewModel } from './business-view-model.js';

export function createBusinessPanelController({
  platform,
  reconcileCommand,
  sendCommand,
  connectivity = createBusinessConnectivity(),
  onChange = () => {},
  setTimer = (fn, ms) => globalThis.setTimeout?.(fn, ms),
  clearTimer = (id) => globalThis.clearTimeout?.(id),
  now = () => Date.now(),
} = {}) {
  if (!platform?.commandStorage || typeof reconcileCommand !== 'function' || typeof sendCommand !== 'function') {
    throw new Error('El panel requiere plataforma, reconciliación y envío autorizados.');
  }
  let outbox = null;
  let commands = [];
  let initialized = false;
  let destroyed = false;
  let lastDrain = null;
  let retryTimer = null;
  let unsubscribeConnectivity = null;

  async function initialize() {
    if (initialized) return getSnapshot();
    await platform.initialize?.().catch(() => null);
    outbox = createCommandOutbox({ storage: await platform.commandStorage() });
    // La página recién cargó: ningún `sending` puede estar en vuelo en esta
    // pestaña. Sin `force`, un comando interrumpido a los 10 s del envío
    // quedaba varado 2 minutos (o para siempre, sin drain periódico).
    await outbox.recoverAbandoned({ force: true });
    initialized = true;
    // Al volver la conexión el outbox drena solo: antes el evento `online`
    // sólo re-renderizaba el chip y los reintentos programados no corrían nunca.
    unsubscribeConnectivity = connectivity.subscribe((snapshot) => {
      onChange(getSnapshot());
      if (snapshot.online && snapshot.state === CONNECTIVITY_STATES.RECONNECTING) {
        void drain();
      }
    });
    await refreshCommands();
    if (connectivity.getSnapshot().online) await drain();
    return getSnapshot();
  }

  async function queue(input) {
    if (!initialized) await initialize();
    const command = await outbox.enqueue(input);
    await refreshCommands();
    if (!connectivity.getSnapshot().online) {
      connectivity.markFailure('NETWORK_ERROR');
      return { ok: false, pending: true, command, message: 'Pendiente de sincronización.' };
    }
    await drain();
    const current = (await outbox.list()).find((item) => item.commandId === command.commandId);
    if (current?.state === 'confirmed') return { ok: true, command: current, message: 'Servidor confirmado.' };
    if (current?.state === 'conflicted') return { ok: false, conflict: true, command: current, message: current.lastErrorMessage };
    if (current?.state === 'failed') return { ok: false, command: current, message: current.lastErrorMessage };
    return { ok: false, pending: true, command: current, message: 'Pendiente de sincronización.' };
  }

  async function drain() {
    if (!initialized || destroyed || !connectivity.getSnapshot().online) return [];
    // Sin comandos vencidos no hay contacto con el servidor, así que tampoco
    // hay derecho a declarar "Conectado" ni a sellar una reconciliación.
    const dueAt = await outbox.nextDueAt();
    if (dueAt === null || dueAt > now()) {
      await scheduleRetry();
      return [];
    }
    connectivity.markSyncing();
    try {
      lastDrain = await outbox.drain({ reconcile: reconcileCommand, send: sendCommand });
      await refreshCommands();
      const sessionFailure = lastDrain.find((command) => command?.lastErrorCode === 'SESSION_EXPIRED');
      if (sessionFailure) connectivity.markFailure('SESSION_EXPIRED');
      else connectivity.markConnected();
      await scheduleRetry();
      return lastDrain;
    } catch (error) {
      connectivity.markFailure(error?.code || 'SERVER_UNAVAILABLE');
      await refreshCommands();
      await scheduleRetry();
      return [];
    }
  }

  // Un backoff que nadie despierta no es un backoff: acá se agenda el próximo
  // intento real al mínimo nextAttemptAt pendiente.
  async function scheduleRetry() {
    if (destroyed || !outbox) return;
    if (retryTimer !== null) { clearTimer(retryTimer); retryTimer = null; }
    const dueAt = await outbox.nextDueAt();
    if (dueAt === null) return;
    const delay = Math.max(250, dueAt - now());
    retryTimer = setTimer(() => {
      retryTimer = null;
      void drain();
    }, delay) ?? null;
  }

  async function refreshCommands() {
    commands = outbox ? await outbox.list() : [];
    onChange(getSnapshot());
    return commands;
  }

  async function cancelByIdempotencyKey(idempotencyKey) {
    if (!initialized) await initialize();
    const command = (await outbox.list()).find((item) => item.idempotencyKey === String(idempotencyKey || ''));
    if (!command || !['pending', 'failed', 'conflicted'].includes(command.state)) return false;
    const cancelled = await outbox.cancel(command.commandId);
    await refreshCommands();
    return cancelled;
  }

  function getSnapshot() {
    return {
      initialized,
      commands: commands.map((command) => ({ ...command })),
      lastDrain,
      ...buildBusinessRuntimeViewModel({ connectivity: connectivity.getSnapshot(), commands }),
    };
  }

  function destroy() {
    destroyed = true;
    if (retryTimer !== null) { clearTimer(retryTimer); retryTimer = null; }
    unsubscribeConnectivity?.();
    unsubscribeConnectivity = null;
    connectivity.destroy?.();
  }

  return Object.freeze({ initialize, queue, drain, refreshCommands, cancelByIdempotencyKey, getSnapshot, connectivity, destroy });
}
