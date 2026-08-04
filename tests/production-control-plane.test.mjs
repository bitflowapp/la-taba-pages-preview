import assert from 'node:assert/strict';
import test from 'node:test';

import {
  configureBusinessOperations,
  handleBusinessOperationsAction,
  renderBusinessOperations,
  resetBusinessOperationsForTests,
} from '../js/business/business-operations-center.js';
import { createSupabaseOperationsRepository } from '../js/repositories/supabase-operations-repository.js';

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';

test('repositorio del control plane usa exclusivamente RPC autenticadas', async () => {
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: { ok: true }, error: null, status: 200 };
    },
  };
  const repository = createSupabaseOperationsRepository({ client, businessId: BUSINESS_ID });
  await repository.getCenter();
  await repository.acknowledgeAlert('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  await repository.resolveAlert({ alertId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', note: 'Worker reconciliado.' });
  await repository.prepareDailyReconciliation({
    businessDate: '2026-08-02', timezone: 'America/Argentina/Buenos_Aires',
    declaredCash: 1200, differenceNote: '', idempotencyKey: 'daily-prepare:test:120000',
  });
  await repository.closeDailyReconciliation({
    reconciliationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    expectedRevision: 3, idempotencyKey: 'daily-close:test',
  });
  assert.deepEqual(calls.map(({ name }) => name), [
    'get_production_operation_center',
    'transition_operational_alert',
    'transition_operational_alert',
    'prepare_daily_reconciliation',
    'close_daily_reconciliation',
  ]);
  assert.equal(calls[0].args.p_business_id, BUSINESS_ID);
  assert.equal(calls[3].args.p_declared_cash, 1200);
  assert.equal(calls[4].args.p_expected_revision, 3);
});

test('Centro de operación muestra las trece excepciones y diferencias sin ocultarlas', async () => {
  configureBusinessOperations({
    role: 'owner',
    getOperationCenter: async () => ({
      ok: true,
      data: {
        generated_at: '2026-08-02T12:00:00Z',
        metrics: {
          new_orders: 1, delayed_orders: 2, pending_payments: 3, payments_in_review: 4,
          orders_without_stock: 5, packing_incomplete: 6, active_deliveries: 7,
          riders_without_signal: 8, fiscal_documents_pending: 9, failed_prints: 10,
          pending_credit_notes: 11, blocked_outboxes: 12, reconciliations_required: 13,
        },
        alerts: [{
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', severity: 'CRITICAL',
          code: 'PAYMENT_APPROVED_WITHOUT_ORDER', status: 'open',
          summary: 'Pago aprobado sin pedido operativo.',
          required_action: 'Reconciliar sin cobrar nuevamente.',
          correlation_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        }],
        recent_closures: [{
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', business_date: '2026-08-02',
          status: 'open', revision: 2, expected_cash: 1000, declared_cash: 900,
          cash_difference: -100, difference_note: 'Falta de caja verificada.', open_alerts: 1,
          critical_alerts: 1,
        }],
      },
    }),
    onChange() {},
  });
  renderBusinessOperations('operation-center');
  await new Promise((resolve) => setTimeout(resolve, 0));
  const markup = renderBusinessOperations('operation-center');
  for (const label of [
    'Pedidos nuevos', 'Pedidos demorados', 'Pagos en camino', 'Pagos a revisar',
    'Pedidos sin stock', 'Preparaciones abiertas', 'Envíos en la calle', 'Repartidores sin señal',
    'Comprobantes pendientes', 'Impresiones con problema', 'Notas de crédito pendientes',
    'Envíos internos trabados', 'Para conciliar',
  ]) assert.match(markup, new RegExp(label));
  // La alerta se cuenta en castellano y con las cuatro respuestas que necesita el mostrador.
  assert.match(markup, /Entró un pago aprobado que todavía no tiene pedido armado/);
  assert.match(markup, /Qué se conserva/);
  assert.match(markup, /Riesgo/);
  assert.match(markup, /Qué conviene hacer/);
  assert.match(markup, /Ir a Pagos/);
  // El identificador técnico existe pero queda detrás del detalle para soporte.
  assert.match(markup, /Detalle para soporte[\s\S]*TABA-PAGO-01/);
  assert.doesNotMatch(markup, /PAYMENT_APPROVED_WITHOUT_ORDER/);
  resetBusinessOperationsForTests();
});

test('el cierre del día vive en su propia pantalla y muestra las nueve secciones', async () => {
  configureBusinessOperations({
    role: 'owner',
    prepareDailyReconciliation: async () => ({
      ok: true,
      data: {
        reconciliation: {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', business_date: '2026-08-02', status: 'open',
          revision: 2, expected_cash: 1000, declared_cash: 900, cash_difference: -100,
          difference_note: 'Falta de caja verificada.', snapshot: {},
        },
      },
    }),
    getOperationCenter: async () => ({ ok: true, data: { metrics: {}, alerts: [], recent_closures: [] } }),
    onChange() {},
  });
  const inputs = {
    dailyBusinessDate: { value: '2026-08-02' },
    dailyTimezone: { value: 'America/Argentina/Buenos_Aires' },
    dailyDeclaredCash: { value: '900' },
    dailyDifferenceNote: { value: 'Falta de caja verificada.' },
  };
  const root = { querySelector: (selector) => inputs[selector.match(/name="([^"]+)/)?.[1]] || null };
  const prepareTarget = {
    closest(selector) {
      if (selector === '[data-daily-reconciliation-prepare]') return prepareTarget;
      if (selector === '[data-business-ops-center]') return root;
      return null;
    },
  };
  assert.equal((await handleBusinessOperationsAction(prepareTarget)).ok, true);
  const markup = renderBusinessOperations('day-close');
  for (const label of [
    'Ventas del día', 'Cobrado por Mercado Pago', 'Efectivo', 'Devoluciones', 'Pedidos',
    'Movimientos de stock', 'Comprobantes', 'Diferencias', 'Quedó pendiente',
  ]) assert.match(markup, new RegExp(label));
  assert.match(markup, /Falta de caja verificada/);
  assert.match(markup, /Cerrar el día/);
  resetBusinessOperationsForTests();
});

test('staff puede preparar pero no finalizar un cierre desde el panel', async () => {
  let prepared = null;
  let closed = false;
  const inputs = {
    dailyBusinessDate: { value: '2026-08-02' },
    dailyTimezone: { value: 'America/Argentina/Buenos_Aires' },
    dailyDeclaredCash: { value: '1000.50' },
    dailyDifferenceNote: { value: 'Diferencia contada dos veces.' },
  };
  const root = { querySelector: (selector) => inputs[selector.match(/name="([^"]+)/)?.[1]] || null };
  configureBusinessOperations({
    role: 'staff',
    prepareDailyReconciliation: async (input) => { prepared = input; return { ok: true, data: {} }; },
    closeDailyReconciliation: async () => { closed = true; return { ok: true }; },
    getOperationCenter: async () => ({ ok: true, data: { metrics: {}, alerts: [], recent_closures: [] } }),
    onChange() {},
  });
  const prepareTarget = {
    closest(selector) {
      if (selector === '[data-daily-reconciliation-prepare]') return prepareTarget;
      if (selector === '[data-business-ops-center]') return root;
      return null;
    },
  };
  const preparedResult = await handleBusinessOperationsAction(prepareTarget);
  assert.equal(preparedResult.ok, true);
  assert.equal(prepared.declaredCash, 1000.5);
  assert.match(prepared.idempotencyKey, /^daily-prepare:/);

  const closeTarget = {
    dataset: { dailyReconciliationClose: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', dailyReconciliationRevision: '1' },
    closest(selector) { return selector === '[data-daily-reconciliation-close]' ? closeTarget : null; },
  };
  const closedResult = await handleBusinessOperationsAction(closeTarget);
  assert.equal(closedResult.ok, false);
  assert.equal(closed, false);
  assert.match(closedResult.message, /dueño o el encargado/);
  resetBusinessOperationsForTests();
});

test('Windows crea backup verificado y diagnóstico sanitizado desde el Centro de operación', async () => {
  const calls = [];
  const desktopPlatform = {
    isNative: true,
    async createLocalBackup() {
      calls.push({ name: 'backup' });
      return { backupId: 'backup-one', sha256: 'a'.repeat(64), integrityVerified: true };
    },
    async exportSupportDiagnostic(request) {
      calls.push({ name: 'diagnostic', request });
      return { exportId: 'diagnostic-one', sha256: 'b'.repeat(64) };
    },
    async openSupportExportFolder() { calls.push({ name: 'open' }); return true; },
  };
  configureBusinessOperations({
    role: 'owner',
    desktopPlatform,
    getOperationCenter: async () => ({
      ok: true,
      data: {
        generated_at: '2026-08-02T12:00:00Z', metrics: {}, recent_closures: [],
        alerts: [{ correlation_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }],
      },
    }),
    onChange() {},
  });
  renderBusinessOperations('operation-center');
  await new Promise((resolve) => setTimeout(resolve, 0));
  const markup = renderBusinessOperations('operation-center');
  assert.match(markup, /Guardar respaldo del día/);
  assert.match(markup, /Preparar diagnóstico/);

  const target = (selector) => ({ closest: (candidate) => candidate === selector ? {} : null });
  assert.equal((await handleBusinessOperationsAction(target('[data-local-backup-create]'))).ok, true);
  assert.equal((await handleBusinessOperationsAction(target('[data-support-diagnostic-export]'))).ok, true);
  assert.equal((await handleBusinessOperationsAction(target('[data-support-export-folder]'))).ok, true);
  assert.deepEqual(calls.map(({ name }) => name), ['backup', 'diagnostic', 'open']);
  assert.deepEqual(calls[1].request.correlationIds, ['cccccccc-cccc-4ccc-8ccc-cccccccccccc']);
  assert.equal(calls[1].request.activeView, 'operation-center');
  assert.match(calls[1].request.networkStatus, /^(online|offline|unknown)$/);
  resetBusinessOperationsForTests();
});
