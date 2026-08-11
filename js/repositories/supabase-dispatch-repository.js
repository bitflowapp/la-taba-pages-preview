import { classifyRpcError } from './supabase-business-repository.js';

export function createSupabaseDispatchRepository({ client, businessId }) {
  if (typeof client?.rpc !== 'function') throw new Error('Cliente Supabase inválido.');
  if (!businessId) throw new Error('El control de dispatch requiere businessId.');

  async function rpc(name, args) {
    const { data, error, status } = await client.rpc(name, args);
    if (error) return classifyRpcError(error, status);
    return { ok: true, data };
  }

  return Object.freeze({
    getControl: () => rpc('get_business_dispatch_control', {
      p_business_id: businessId,
    }),
    manualOverride: ({ orderId, riderUserId, reason, idempotencyKey, expectedJobRevision }) => (
      rpc('manual_override_dispatch', {
        p_business_id: businessId,
        p_order_id: orderId,
        p_rider_user_id: riderUserId,
        p_reason: reason,
        p_idempotency_key: idempotencyKey,
        p_expected_job_revision: expectedJobRevision,
      })
    ),
  });
}
