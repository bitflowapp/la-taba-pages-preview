import { createCommandOutbox } from './business-command-outbox.js';
import { createBusinessConnectivity } from './business-connectivity.js';
import { buildBusinessRuntimeViewModel } from './business-view-model.js';

export function createBusinessPanelController({
  platform,
  reconcileCommand,
  sendCommand,
  connectivity = createBusinessConnectivity(),
  onChange = () => {},
} = {}) {
  if (!platform?.commandStorage || typeof reconcileCommand !== 'function' || typeof sendCommand !== 'function') {
    throw new Error('El panel requiere plataforma, reconciliación y envío autorizados.');
  }
  let outbox = null;
  let commands = [];
  let initialized = false;
  let lastDrain = null;

  async function initialize() {
    if (initialized) return getSnapshot();
    await platform.initialize?.().catch(() => null);
    outbox = createCommandOutbox({ storage: await platform.commandStorage() });
    await outbox.recoverAbandoned();
    initialized = true;
    connectivity.subscribe(() => onChange(getSnapshot()));
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
    if (!initialized || !connectivity.getSnapshot().online) return [];
    connectivity.markSyncing();
    try {
      lastDrain = await outbox.drain({ reconcile: reconcileCommand, send: sendCommand });
      await refreshCommands();
      const sessionFailure = lastDrain.find((command) => command?.lastErrorCode === 'SESSION_EXPIRED');
      if (sessionFailure) connectivity.markFailure('SESSION_EXPIRED');
      else connectivity.markConnected();
      return lastDrain;
    } catch (error) {
      connectivity.markFailure(error?.code || 'SERVER_UNAVAILABLE');
      await refreshCommands();
      return [];
    }
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

  return Object.freeze({ initialize, queue, drain, refreshCommands, cancelByIdempotencyKey, getSnapshot, connectivity });
}
