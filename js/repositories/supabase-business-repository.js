export function createSupabaseBusinessRepository({ client, businessId }) {
  assertClient(client);
  if (!businessId) throw new Error('El repositorio de negocio requiere businessId.');

  async function rpc(name, args) {
    const { data, error, status } = await client.rpc(name, args);
    if (error) return classifyRpcError(error, status);
    return { ok: true, data };
  }

  return Object.freeze({
    // El RPC `business_order_snapshot` NUNCA existió en ninguna migración:
    // llamarlo devuelve PGRST202. El snapshot autoritativo de la bandeja es
    // la consulta PostgREST de supabase_order_repository.fetchBusinessOrderSnapshot;
    // este repositorio expone la misma consulta para no prometer un contrato roto.
    async snapshot() {
      const { data, error, status } = await client
        .from('orders')
        .select('*,order_items(*),order_events(*),order_combos(*)')
        .eq('business_id', businessId)
        .eq('origin', 'production')
        .order('created_at', { ascending: true })
        .limit(500);
      if (error) return classifyRpcError(error, status);
      return { ok: true, data: Array.isArray(data) ? data : [] };
    },
    acknowledgeOrder: ({ orderId, expectedRevision, idempotencyKey }) => rpc('acknowledge_order', {
      p_order_id: orderId, p_expected_revision: expectedRevision, p_idempotency_key: idempotencyKey,
    }),
    transitionOrder: ({ orderId, expectedRevision, newStatus, idempotencyKey }) => rpc('transition_order', {
      p_order_id: orderId, p_expected_revision: expectedRevision, p_new_status: newStatus, p_idempotency_key: idempotencyKey,
    }),
    setPreparationEstimate: ({ orderId, expectedRevision, minutes, idempotencyKey }) => rpc('set_preparation_estimate', {
      p_order_id: orderId, p_expected_revision: expectedRevision, p_minutes: minutes, p_idempotency_key: idempotencyKey,
    }),
    cancelOrder: ({ orderId, expectedRevision, reason, idempotencyKey }) => rpc('cancel_order', {
      p_order_id: orderId, p_expected_revision: expectedRevision, p_reason: reason, p_idempotency_key: idempotencyKey,
    }),
    listActiveRiders: () => rpc('list_active_business_riders', { p_business_id: businessId }),
  });
}

export function classifyRpcError(error, status = 0) {
  const code = String(error?.code || 'RPC_ERROR');
  const message = safeMessage(error?.message || 'La operaci\u00f3n no fue confirmada por el servidor.');
  if (code === '40001') return { ok: false, conflict: true, code: 'REVISION_CONFLICT', message };
  if (code === '42501' || status === 401 || status === 403) return { ok: false, retryable: false, code: status === 401 ? 'SESSION_EXPIRED' : 'FORBIDDEN', message };
  if (code === 'P0002') return { ok: false, retryable: false, code: 'NOT_FOUND', message };
  if (code === '22023' || code === '23514' || code === '23505' || code === 'P0001') return { ok: false, retryable: false, code, message };
  if (status === 429) return { ok: false, retryable: true, code: 'RATE_LIMITED', message };
  if (status >= 500 || status === 0) return { ok: false, retryable: true, code: 'SERVER_UNAVAILABLE', message };
  return { ok: false, retryable: false, code, message };
}

function assertClient(client) { if (typeof client?.rpc !== 'function') throw new Error('Cliente Supabase inv\u00e1lido.'); }
// PostgreSQL nombra la tabla y el constraint cuando rechaza una fila. El operador no tiene que leer eso.
const RAW_DATABASE_ERROR = /violates .*constraint|new row for relation|null value in column|duplicate key value|permission denied for|\bpg_[a-z_]+\b|invalid input syntax/i;
function safeMessage(value) {
  const flat = String(value || '').replace(/[\r\n\t]+/g, ' ').slice(0, 300);
  return RAW_DATABASE_ERROR.test(flat) ? 'La operación no fue aceptada por el servidor.' : flat;
}
