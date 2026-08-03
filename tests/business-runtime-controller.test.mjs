import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { createMemoryCommandStorage } from '../js/business/business-command-outbox.js';
import { createBusinessConnectivity } from '../js/business/business-connectivity.js';
import { createBusinessOrderStore } from '../js/business/business-order-store.js';
import { createBusinessPanelController } from '../js/business/business-panel-controller.js';
import { buildBusinessRuntimeViewModel } from '../js/business/business-view-model.js';
import {
  BUSINESS_OPERATION_VIEWS,
  renderBusinessOperations,
  resetBusinessOperationsForTests,
} from '../js/business/business-operations-center.js';
import { BrowserBusinessPlatform } from '../js/platform/browser-business-platform.js';
import { createBusinessPlatform } from '../js/platform/tauri-business-platform.js';
import { createPosCheckoutService } from '../js/pos/pos-checkout-service.js';

function fakeWindow() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name) { listeners.delete(name); },
  };
}

test('conectividad expone estados finitos y conserva última reconciliación', () => {
  let online = true;
  const windowObject = fakeWindow();
  const connectivity = createBusinessConnectivity({
    online: () => online,
    windowObject,
    now: () => new Date('2026-08-02T12:00:00Z'),
  });
  assert.equal(connectivity.getSnapshot().state, 'reconnecting');
  connectivity.markConnected();
  assert.equal(connectivity.getSnapshot().lastReconciledAt, '2026-08-02T12:00:00.000Z');
  online = false;
  windowObject.listeners.get('offline')();
  assert.equal(connectivity.getSnapshot().state, 'offline');
  connectivity.destroy();
  assert.equal(windowObject.listeners.size, 0);
});

test('store nunca reemplaza una revisión nueva por un snapshot atrasado', () => {
  const store = createBusinessOrderStore([{ id: 'o1', revision: 5, status: 'preparing' }]);
  store.applyAuthoritativeSnapshot([{ id: 'o1', revision: 4, status: 'accepted' }]);
  assert.equal(store.find('o1').revision, 5);
  assert.equal(store.find('o1').status, 'preparing');
});

test('controlador confirma comandos sólo después de reconciliar y enviar', async () => {
  const storage = createMemoryCommandStorage();
  const calls = [];
  const platform = { initialize: async () => ({}), commandStorage: async () => storage };
  const controller = createBusinessPanelController({
    platform,
    connectivity: createBusinessConnectivity({ online: () => true, windowObject: fakeWindow() }),
    reconcileCommand: async (command) => { calls.push(`reconcile:${command.commandId}`); return { revision: 1 }; },
    sendCommand: async (command) => { calls.push(`send:${command.commandId}`); return { ok: true, revision: 2 }; },
  });
  await controller.initialize();
  const response = await controller.queue({
    businessId: 'b1', orderId: 'o1', commandType: 'transition_order',
    expectedRevision: 1, idempotencyKey: 'transition:o1:revision:1', payload: { newStatus: 'accepted' },
  });
  assert.equal(response.ok, true);
  assert.equal(response.command.state, 'confirmed');
  assert.deepEqual(calls.map((call) => call.split(':')[0]), ['reconcile', 'send']);
  assert.equal(controller.getSnapshot().pendingCount, 0);
});

test('controlador offline conserva comando pendiente sin afirmar éxito', async () => {
  const storage = createMemoryCommandStorage();
  const controller = createBusinessPanelController({
    platform: { initialize: async () => ({}), commandStorage: async () => storage },
    connectivity: createBusinessConnectivity({ online: () => false, windowObject: fakeWindow() }),
    reconcileCommand: async () => { throw new Error('no debería ejecutarse'); },
    sendCommand: async () => { throw new Error('no debería ejecutarse'); },
  });
  const response = await controller.queue({
    businessId: 'b1', orderId: 'o1', commandType: 'transition_order',
    expectedRevision: 1, idempotencyKey: 'transition:o1:offline:1', payload: { newStatus: 'accepted' },
  });
  assert.equal(response.ok, false);
  assert.equal(response.pending, true);
  assert.equal(controller.getSnapshot().pendingCount, 1);
  assert.match(response.message, /Pendiente de sincronización/);
});

test('view model separa pendientes, conflictos y fallas permanentes', () => {
  const view = buildBusinessRuntimeViewModel({
    connectivity: { state: 'connected' },
    commands: [{ state: 'pending' }, { state: 'sending' }, { state: 'conflicted' }, { state: 'failed' }],
  });
  assert.equal(view.pendingCount, 2);
  assert.equal(view.conflictCount, 1);
  assert.equal(view.failedCount, 1);
  assert.equal(view.attentionRequired, 2);
});

test('fallback fuera de Tauri usa IndexedDB y no un almacenamiento volátil', () => {
  const previous = globalThis.__TAURI__;
  delete globalThis.__TAURI__;
  assert.ok(createBusinessPlatform() instanceof BrowserBusinessPlatform);
  globalThis.__TAURI__ = previous;
});

test('centro operativo contiene todas las pantallas mínimas', async () => {
  const expected = ['Escáner rápido', 'Alta de producto', 'Recepción de mercadería', 'Ajuste de stock', 'Conteo físico', 'Preparación de pedido', 'Venta de mostrador', 'Estado fiscal', 'Configuración fiscal'];
  const markup = BUSINESS_OPERATION_VIEWS.map((view) => renderBusinessOperations(view)).join('\n');
  await new Promise((resolve) => queueMicrotask(resolve));
  for (const label of expected) assert.match(markup, new RegExp(label));
  assert.match(markup, /Producción fiscal deshabilitada/);
  resetBusinessOperationsForTests();
});

test('POS offline devuelve borrador y nunca venta confirmada', async () => {
  let called = false;
  const service = createPosCheckoutService({ repository: { checkout: async () => { called = true; } }, isOnline: () => false });
  const response = await service.checkout({
    saleId: 's1', businessId: 'b1', operatorId: 'u1', state: 'draft',
    items: [{ productId: 'p1', quantity: 1, unitPrice: 1 }],
  }, { paymentMethod: 'cash', idempotencyKey: 'pos:offline:0001' });
  assert.equal(response.ok, false);
  assert.equal(response.pending, true);
  assert.equal(called, false);
  assert.match(response.message, /no está confirmada/);
});

test('producción no usa confirm modal y enruta comandos por outbox', () => {
  const source = fs.readFileSync(path.resolve(import.meta.dirname, '../js/production-operations.js'), 'utf8');
  assert.doesNotMatch(source, /globalThis\.confirm|window\.confirm/);
  assert.match(source, /businessCommandController\.queue/);
  assert.match(source, /idempotencyKey/);
  assert.match(source, /cancelBusinessOrder/);
});
