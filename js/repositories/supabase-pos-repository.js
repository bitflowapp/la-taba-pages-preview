import { classifyRpcError } from './supabase-business-repository.js';

export function createSupabasePosRepository({ client, businessId }) {
  if (typeof client?.rpc !== 'function' || typeof client?.from !== 'function') throw new Error('Cliente Supabase inv\u00e1lido.');
  if (!businessId) throw new Error('El repositorio POS requiere businessId.');
  return Object.freeze({
    async checkout(intent) {
      const { data, error, status } = await client.rpc('checkout_pos_sale', {
        p_business_id: businessId,
        p_items: intent.items.map(({ productId, quantity }) => ({ productId, quantity })),
        p_payment_method: intent.paymentMethod,
        p_idempotency_key: intent.idempotencyKey,
        p_request_fiscal: intent.requestFiscal === true,
      });
      return error ? classifyRpcError(error, status) : { ok: true, data };
    },
    async listSales({ limit = 100 } = {}) {
      const { data, error, status } = await client.from('pos_sales').select('id,business_id,state,subtotal,discount_total,total,currency,fiscal_document_id,created_at,completed_at').eq('business_id', businessId).order('created_at', { ascending: false }).limit(Math.min(500, Math.max(1, limit)));
      return error ? classifyRpcError(error, status) : { ok: true, data: Array.isArray(data) ? data : [] };
    },
  });
}
