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
    // Superficie operativa del piloto. El servidor es el único que decide;
    // el Panel no recalcula ni completa nada que el servidor no haya medido.
    getPilotDashboard: (timezone) => rpc('get_pilot_operations_dashboard', {
      p_business_id: businessId,
      p_timezone: timezone || 'America/Argentina/Buenos_Aires',
    }),
    getPilotServiceHealth: () => rpc('get_pilot_service_health', { p_business_id: businessId }),
    tracePilotOrder: (reference) => rpc('trace_pilot_order', {
      p_business_id: businessId,
      p_reference: String(reference || ''),
    }),
    getPilotCommercialReport: ({ from, to, timezone } = {}) => rpc('get_pilot_commercial_report', {
      p_business_id: businessId,
      p_from: from,
      p_to: to,
      p_timezone: timezone || 'America/Argentina/Buenos_Aires',
    }),
    configurePilotThresholds: (thresholds) => rpc('configure_pilot_ops_thresholds', {
      p_business_id: businessId,
      p_thresholds: thresholds,
    }),
  });
}
