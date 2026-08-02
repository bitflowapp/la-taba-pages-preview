import { classifyRpcError } from './supabase-business-repository.js';

export function createSupabaseFiscalRepository({ client, businessId }) {
  if (typeof client?.rpc !== 'function' || typeof client?.from !== 'function') throw new Error('Cliente Supabase inv\u00e1lido.');
  if (!businessId) throw new Error('El repositorio fiscal requiere businessId.');

  async function rpc(name, args) {
    const { data, error, status } = await client.rpc(name, args);
    return error ? classifyRpcError(error, status) : { ok: true, data };
  }

  return Object.freeze({
    configureProfile: (profile) => rpc('configure_fiscal_profile', { p_business_id: businessId, p_profile: profile }),
    requestDocument: ({ sourceType, sourceId, documentIntent = 'invoice', idempotencyKey }) => rpc('request_fiscal_document', {
      p_business_id: businessId, p_source_type: sourceType, p_source_id: sourceId, p_document_intent: documentIntent, p_idempotency_key: idempotencyKey,
    }),
    requestFullCreditNote: ({ originalDocumentId, reason, idempotencyKey }) => rpc('request_full_credit_note', {
      p_original_document_id: originalDocumentId, p_reason: reason, p_idempotency_key: idempotencyKey,
    }),
    async getProfile() {
      const { data, error, status } = await client.from('fiscal_profiles').select('business_id,legal_name,cuit,tax_condition,business_address,environment,point_of_sale,default_currency,default_concept,invoice_policy,is_enabled,accountant_review_status,production_gate_status,verified_at,updated_at').eq('business_id', businessId).maybeSingle();
      return error ? classifyRpcError(error, status) : { ok: true, data: data || null };
    },
    async listDocuments({ limit = 100 } = {}) {
      const { data, error, status } = await client.from('fiscal_documents').select('id,business_id,source_type,source_id,document_intent,environment,point_of_sale,document_type,document_number,issue_date,currency,total_amount,state,result,cae,cae_expiration,observations,errors,associated_document_id,created_at,authorized_at').eq('business_id', businessId).order('created_at', { ascending: false }).limit(Math.min(500, Math.max(1, limit)));
      return error ? classifyRpcError(error, status) : { ok: true, data: Array.isArray(data) ? data : [] };
    },
  });
}
