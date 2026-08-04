import { classifyRpcError } from './supabase-business-repository.js';

export function createSupabaseOperationsRepository({ client, businessId }) {
  if (typeof client?.rpc !== 'function') throw new Error('Cliente Supabase inválido.');
  if (!businessId) throw new Error('El Centro de operación requiere businessId.');

  async function rpc(name, args) {
    const { data, error, status } = await client.rpc(name, args);
    if (error) return classifyRpcError(error, status);
    return { ok: true, data };
  }

  return Object.freeze({
    getCenter: () => rpc('get_production_operation_center', { p_business_id: businessId }),
    acknowledgeAlert: (alertId) => rpc('transition_operational_alert', {
      p_alert_id: alertId,
      p_target_status: 'acknowledged',
      p_note: null,
    }),
    resolveAlert: ({ alertId, note }) => rpc('transition_operational_alert', {
      p_alert_id: alertId,
      p_target_status: 'resolved',
      p_note: note,
    }),
    prepareDailyReconciliation: ({ businessDate, timezone, declaredCash, differenceNote, idempotencyKey }) => rpc('prepare_daily_reconciliation', {
      p_business_id: businessId,
      p_business_date: businessDate,
      p_timezone: timezone,
      p_declared_cash: declaredCash,
      p_difference_note: differenceNote || null,
      p_idempotency_key: idempotencyKey,
    }),
    closeDailyReconciliation: ({ reconciliationId, expectedRevision, idempotencyKey }) => rpc('close_daily_reconciliation', {
      p_reconciliation_id: reconciliationId,
      p_expected_revision: expectedRevision,
      p_idempotency_key: idempotencyKey,
    }),
    getOpeningStatus: () => rpc('get_business_opening_status', { p_business_id: businessId }),
    setOpenState: (status) => rpc('set_business_open_state', { p_business_id: businessId, p_status: status }),
  });
}
