import test from 'node:test';
import assert from 'node:assert/strict';

import { presentFiscalStatus } from '../js/pos/fiscal-status-presenter.js';
import { FISCAL_DOCUMENT_STATES } from '../js/core/fiscal-domain.js';
import { createCommandOutbox, createMemoryCommandStorage } from '../js/business/business-command-outbox.js';
import { createBusinessPanelController } from '../js/business/business-panel-controller.js';
import { CONNECTIVITY_STATES } from '../js/business/business-connectivity.js';
import { buildBusinessRuntimeViewModel } from '../js/business/business-view-model.js';

// ─── Presentador fiscal: ningún estado real cae al default engañoso ─────────

test('cada estado fiscal real tiene una etiqueta propia; ninguno se disfraza de "sin solicitud"', () => {
  for (const state of FISCAL_DOCUMENT_STATES) {
    const presented = presentFiscalStatus({ state, cae: state === 'authorized' ? '1'.repeat(14) : '' });
    assert.notEqual(
      presented.label,
      'Sin solicitud fiscal',
      `el estado real "${state}" no puede mostrarse como si nunca se hubiera pedido`,
    );
  }
});

test('failed y credited dicen la verdad; authorized sin CAE no imprime', () => {
  assert.match(presentFiscalStatus({ state: 'failed' }).label, /fallida|soporte/i);
  assert.equal(presentFiscalStatus({ state: 'failed' }).tone, 'danger');
  assert.match(presentFiscalStatus({ state: 'credited' }).label, /nota de crédito/i);
  const inconsistent = presentFiscalStatus({ state: 'authorized', cae: '123' });
  assert.equal(inconsistent.canPrintFiscal, false);
  assert.equal(inconsistent.tone, 'danger');
  const authorized = presentFiscalStatus({ state: 'authorized', cae: '1'.repeat(14) });
  assert.equal(authorized.canPrintFiscal, true);
});

// ─── Outbox: serialización, recuperación forzada y agenda de reintentos ─────

const COMMAND = (key = 'orden-accept-11111111') => ({
  businessId: 'b-1',
  orderId: 'order-1',
  commandType: 'transition_order',
  expectedRevision: 1,
  idempotencyKey: key,
  payload: { newStatus: 'accepted' },
});

test('dos encolados simultáneos de la misma clave devuelven UN solo comando', async () => {
  const outbox = createCommandOutbox({ storage: createMemoryCommandStorage() });
  const [first, second] = await Promise.all([
    outbox.enqueue(COMMAND()),
    outbox.enqueue(COMMAND()),
  ]);
  assert.equal(first.commandId, second.commandId);
  assert.equal((await outbox.list()).length, 1);
});

test('recoverAbandoned force rescata un sending con lease vigente (arranque de página)', async () => {
  const storage = createMemoryCommandStorage([{
    ...COMMAND(),
    commandId: 'cmd-varado',
    state: 'sending',
    attemptCount: 1,
    createdAt: new Date().toISOString(),
    nextAttemptAt: new Date().toISOString(),
    sendingStartedAt: new Date().toISOString(),
  }]);
  const outbox = createCommandOutbox({ storage });
  const untouched = await outbox.recoverAbandoned();
  assert.equal(untouched.length, 0, 'sin force respeta el lease de 2 minutos');
  const recovered = await outbox.recoverAbandoned({ force: true });
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].state, 'pending');
});

test('nextDueAt devuelve el mínimo nextAttemptAt pendiente y null sin pendientes', async () => {
  const outbox = createCommandOutbox({ storage: createMemoryCommandStorage() });
  assert.equal(await outbox.nextDueAt(), null);
  await outbox.enqueue(COMMAND('orden-accept-a1111111'));
  const dueAt = await outbox.nextDueAt();
  assert.equal(typeof dueAt, 'number');
  assert.ok(dueAt <= Date.now() + 1000);
});

// ─── Controller: drena al reconectar y el chip no miente ────────────────────

function fakePlatform(storage = createMemoryCommandStorage()) {
  return {
    isNative: false,
    commandStorage: async () => storage,
  };
}

function fakeConnectivity(initial = { state: CONNECTIVITY_STATES.RECONNECTING, online: true, lastReconciledAt: null, errorCode: null }) {
  let snapshot = { ...initial };
  const listeners = new Set();
  const publish = (patch) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener(snapshot);
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); listener(snapshot); return () => listeners.delete(listener); },
    markSyncing: () => publish({ state: CONNECTIVITY_STATES.SYNCING }),
    markConnected: () => publish({ state: CONNECTIVITY_STATES.CONNECTED, lastReconciledAt: new Date().toISOString() }),
    markFailure: (code) => publish({ state: CONNECTIVITY_STATES.SERVER_UNAVAILABLE, errorCode: code }),
    destroy() { listeners.clear(); },
    emit: publish,
  };
}

test('con la outbox vacía el controller no sella reconciliación ni dice Conectado', async () => {
  const connectivity = fakeConnectivity();
  const controller = createBusinessPanelController({
    platform: fakePlatform(),
    reconcileCommand: async () => ({ ok: true }),
    sendCommand: async () => ({ ok: true }),
    connectivity,
    setTimer: () => null,
    clearTimer: () => {},
  });
  const snapshot = await controller.initialize();
  assert.equal(snapshot.lastReconciledAt, null, 'un drain vacío no toca al servidor: no hay reconciliación que sellar');
  assert.notEqual(snapshot.connectionState, 'connected');
  controller.destroy();
});

test('al reconectar, el outbox drena solo y el comando pendiente se confirma', async () => {
  const storage = createMemoryCommandStorage();
  const connectivity = fakeConnectivity({ state: CONNECTIVITY_STATES.OFFLINE, online: false, lastReconciledAt: null, errorCode: null });
  let sends = 0;
  const controller = createBusinessPanelController({
    platform: fakePlatform(storage),
    reconcileCommand: async () => ({ revision: 1 }),
    sendCommand: async () => { sends += 1; return { ok: true, revision: 2 }; },
    connectivity,
    setTimer: () => null,
    clearTimer: () => {},
  });
  await controller.initialize();
  const queued = await controller.queue(COMMAND());
  assert.equal(queued.pending, true, 'sin red el comando queda pendiente');
  assert.equal(sends, 0);

  // Vuelve la conexión: el evento debe disparar el drain sin ninguna acción del operador.
  connectivity.getSnapshot().online = true;
  connectivity.emit({ state: CONNECTIVITY_STATES.RECONNECTING, online: true });
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(sends, 1, 'la reconexión drenó la cola sola');
  const commands = await storage.list();
  assert.equal(commands[0].state, 'confirmed');
  controller.destroy();
});

test('un fallo retryable agenda un reintento real que termina confirmando', async () => {
  const storage = createMemoryCommandStorage();
  const connectivity = fakeConnectivity();
  const timers = [];
  let attempts = 0;
  const controller = createBusinessPanelController({
    platform: fakePlatform(storage),
    reconcileCommand: async () => ({ revision: 1 }),
    sendCommand: async () => {
      attempts += 1;
      if (attempts === 1) return { ok: false, retryable: true, code: 'SERVER_UNAVAILABLE', message: 'caído' };
      return { ok: true, revision: 2 };
    },
    connectivity,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimer: () => {},
  });
  await controller.initialize();
  await controller.queue(COMMAND());
  assert.equal(attempts, 1);
  assert.ok(timers.length >= 1, 'el backoff quedó agendado con un timer real');

  // Cuando vence el backoff (~1 s), el timer agendado ejecuta el reintento.
  await new Promise((resolve) => setTimeout(resolve, 1600));
  const scheduled = timers.at(-1);
  await scheduled.fn();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(attempts, 2, 'el reintento corrió sin intervención del operador');
  const commands = await storage.list();
  assert.equal(commands[0].state, 'confirmed');
  controller.destroy();
});

// ─── View-model: el chip describe la evidencia, no el deseo ─────────────────

test('sin pendientes ni reconciliación previa, el chip no dice Reconectando', () => {
  const viewModel = buildBusinessRuntimeViewModel({
    connectivity: { state: 'reconnecting', online: true, lastReconciledAt: null },
    commands: [],
  });
  assert.equal(viewModel.connectionLabel, 'Sin comandos pendientes');
});

test('con pendientes reales el chip sí informa el estado de conexión', () => {
  const viewModel = buildBusinessRuntimeViewModel({
    connectivity: { state: 'reconnecting', online: true, lastReconciledAt: null },
    commands: [{ state: 'pending' }],
  });
  assert.equal(viewModel.connectionLabel, 'Reconectando');
  assert.equal(viewModel.pendingCount, 1);
});
