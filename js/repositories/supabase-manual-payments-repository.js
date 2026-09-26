// Cobros fuera de línea de pedidos online. Nunca llama a Mercado Pago ni escribe tablas directamente.
export function createSupabaseManualPaymentsRepository({ client, businessId }) {
  if (!client?.rpc || !client?.from || !businessId) throw new Error('Cobros manuales requieren cliente y negocio.');

  async function command(name, args) {
    const { data, error, status } = await client.rpc(name, args);
    if (error) return { ok: false, code: String(error.code || 'RPC_ERROR'), status, message: 'No se confirmó el cobro. Actualizá y reintentá.' };
    if (data?.ok !== true) return { ok: false, code: String(data?.code || 'NOT_CONFIRMED'), message: 'El servidor no confirmó el cobro.' };
    return { ok: true, data };
  }

  return Object.freeze({
    async list() {
      const { data, error, status } = await client.from('orders')
        .select('id,public_code,status,revision,total,currency_code,payment_method,manual_payment_status,manual_payment_method,created_at')
        .eq('business_id', businessId).eq('origin', 'production')
        .in('payment_method', ['cash', 'coordinate'])
        .order('created_at', { ascending: false }).limit(50);
      if (error) return { ok: false, status, message: 'No pudimos leer los cobros manuales.' };
      return { ok: true, data: Array.isArray(data) ? data : [] };
    },
    confirm({ orderId, expectedRevision, actualMethod, idempotencyKey }) {
      return command('confirm_manual_order_payment', {
        p_order_id: orderId, p_expected_revision: expectedRevision,
        p_actual_method: actualMethod, p_idempotency_key: idempotencyKey,
      });
    },
    reverse({ orderId, expectedRevision, reason, idempotencyKey }) {
      return command('reverse_manual_order_payment', {
        p_order_id: orderId, p_expected_revision: expectedRevision,
        p_reason: reason, p_idempotency_key: idempotencyKey,
      });
    },
  });
}
