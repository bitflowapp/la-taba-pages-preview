import { classifyRpcError } from './supabase-business-repository.js';

export function createSupabasePackingRepository({ client } = {}) {
  if (typeof client?.rpc !== 'function') throw new Error('Cliente Supabase inválido.');
  async function rpc(name, args) {
    const { data, error, status } = await client.rpc(name, args);
    return error ? classifyRpcError(error, status) : { ok: true, data };
  }
  return Object.freeze({
    start: ({ orderId, expectedRevision, idempotencyKey }) => rpc('start_packing_session', {
      p_order_id: orderId,
      p_expected_revision: expectedRevision,
      p_idempotency_key: idempotencyKey,
    }),
    scan: ({ sessionId, gtin, scanKey }) => rpc('record_packing_scan', {
      p_session_id: sessionId,
      p_gtin: gtin,
      p_scan_key: scanKey,
    }),
    undo: ({ sessionId }) => rpc('undo_last_packing_scan', { p_session_id: sessionId }),
    confirm: ({ sessionId, exceptionReason = null }) => rpc('confirm_packing_session', {
      p_session_id: sessionId,
      p_exception_reason: exceptionReason,
    }),
  });
}
