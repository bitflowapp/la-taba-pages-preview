import { classifyRpcError } from './supabase-business-repository.js';

export function createSupabaseFiscalRepository({ client, businessId }) {
  if (typeof client?.rpc !== 'function' || typeof client?.from !== 'function') throw new Error('Cliente Supabase inválido.');
  if (!businessId) throw new Error('El repositorio fiscal requiere businessId.');

  async function rpc(name, args) {
    const { data, error, status } = await client.rpc(name, args);
    return error ? classifyRpcError(error, status) : { ok: true, data };
  }

  return Object.freeze({
    // Pedidos online: el servidor evalúa, congela el origen y pide la factura al core.
    // Si el pedido no se puede facturar, devuelve sus razones estructuradas (no se reinterpretan acá).
    async requestOrderInvoice({ orderId, idempotencyKey, commandSource = null, print = false }) {
      const { data, error, status } = await client.rpc('request_order_invoice', {
        p_business_id: businessId, p_order_id: orderId, p_idempotency_key: idempotencyKey, p_command_source: commandSource, p_print: print === true,
      });
      if (!error) return { ok: true, data };
      if (error.hint === 'ORDER_NOT_FISCALLY_READY') {
        return { ok: false, retryable: false, code: 'ORDER_NOT_FISCALLY_READY', reasons: parseReadinessReasons(error.details), message: 'El pedido todavía no se puede facturar.' };
      }
      return classifyRpcError(error, status);
    },
    getOrderFiscalStates: (orderIds) => rpc('get_order_fiscal_states', { p_business_id: businessId, p_order_ids: orderIds }),
    requestPrintJobReprint: ({ printJobId, reason, idempotencyKey }) => rpc('request_print_job_reprint', {
      p_job_id: printJobId, p_reason: reason, p_idempotency_key: idempotencyKey,
    }),
    getLocalPrintStatus: () => rpc('get_local_print_status', { p_business_id: businessId }),
    configureProfile: (profile) => rpc('configure_fiscal_profile', { p_business_id: businessId, p_profile: profile }),
    requestDocument: ({ sourceType, sourceId, documentIntent = 'invoice', idempotencyKey }) => rpc('request_fiscal_document', {
      p_business_id: businessId, p_source_type: sourceType, p_source_id: sourceId, p_document_intent: documentIntent, p_idempotency_key: idempotencyKey,
    }),
    requestCreditNote: ({ originalDocumentId, reason, creditKind = 'total', lines = [], idempotencyKey }) => rpc('request_credit_note', {
      p_original_document_id: originalDocumentId,
      p_reason: reason,
      p_credit_kind: creditKind,
      p_lines: lines,
      p_idempotency_key: idempotencyKey,
    }),
    requestFullCreditNote: ({ originalDocumentId, reason, idempotencyKey }) => rpc('request_full_credit_note', {
      p_original_document_id: originalDocumentId, p_reason: reason, p_idempotency_key: idempotencyKey,
    }),
    regenerateArtifact: (fiscalDocumentId) => rpc('request_fiscal_artifact_regeneration', { p_fiscal_document_id: fiscalDocumentId }),
    getActivationStatus: () => rpc('get_arca_activation_status', { p_business_id: businessId }),
    // La frase viaja tal cual la escribió el operador: el servidor es quien decide si vale.
    authorizeHomologation: (authorization) => rpc('authorize_arca_homologation', {
      p_business_id: businessId, p_authorization: authorization,
    }),
    recordVerification: (verification) => rpc('record_fiscal_verification', {
      p_business_id: businessId, p_verification: verification,
    }),
    listArtifacts: () => rpc('list_fiscal_document_artifacts', { p_business_id: businessId }),
    requestPrintJob: ({ fiscalDocumentId, artifactId, printerNameHash, format, copies, idempotencyKey }) => rpc('request_fiscal_print_job', {
      p_fiscal_document_id: fiscalDocumentId,
      p_artifact_id: artifactId,
      p_printer_name_hash: printerNameHash,
      p_format: format,
      p_copies: copies,
      p_idempotency_key: idempotencyKey,
    }),
    updatePrintJob: ({ printJobId, status, errorCode = null }) => rpc('update_fiscal_print_job', {
      p_print_job_id: printJobId,
      p_status: status,
      p_error_code: errorCode,
    }),
    async requestArtifactUrl({ artifactId, action }) {
      if (typeof client.functions?.invoke !== 'function') {
        return { ok: false, code: 'ARTIFACT_ACCESS_UNAVAILABLE', message: 'El acceso privado a documentos no está disponible.' };
      }
      const { data, error } = await client.functions.invoke('fiscal-artifact-access', { body: { artifactId, action } });
      if (error) return classifyRpcError(error, error?.context?.status);
      const signedUrl = String(data?.signedUrl || '');
      if (!/^https:\/\//i.test(signedUrl)) return { ok: false, code: 'ARTIFACT_ACCESS_INVALID', message: 'El acceso privado no devolvió una URL válida.' };
      return { ok: true, data: { signedUrl, expiresAt: data?.expiresAt || null, sha256: data?.sha256 || null } };
    },
    async getProfile() {
      const { data, error, status } = await client.from('fiscal_profiles').select('business_id,legal_name,cuit,tax_condition,business_address,environment,point_of_sale,default_currency,default_concept,invoice_policy,is_enabled,default_recipient_condition,accountant_review_status,production_gate_status,verified_at,updated_at').eq('business_id', businessId).maybeSingle();
      return error ? classifyRpcError(error, status) : { ok: true, data: data || null };
    },
    async listDocuments({ limit = 100 } = {}) {
      const { data, error, status } = await client.from('fiscal_documents').select('id,business_id,source_type,source_id,document_intent,environment,point_of_sale,document_type,document_number,issue_date,currency,total_amount,net_amount,tax_amount,exempt_amount,non_taxed_amount,other_taxes_amount,state,result,cae,cae_expiration,artifact_state,artifact_error_code,artifact_error_message,observations,errors,associated_document_id,credit_kind,credit_reason,created_at,authorized_at,fiscal_document_items(id,description,quantity,unit_price,net_amount,tax_amount,tax_code,exempt_amount,non_taxed_amount,other_taxes_amount)').eq('business_id', businessId).order('created_at', { ascending: false }).limit(Math.min(500, Math.max(1, limit)));
      return error ? classifyRpcError(error, status) : { ok: true, data: Array.isArray(data) ? data : [] };
    },
  });
}

// Razones de readiness que manda el servidor (P0001 ORDER_NOT_FISCALLY_READY, en `details`).
// Solo códigos y datos conocidos: nada del texto crudo del servidor llega a la pantalla.
const READINESS_CODES = new Set([
  'QA_ORDER_NOT_BILLABLE', 'ORDER_CANCELLED', 'FISCAL_PROFILE_DISABLED', 'HOMOLOGATION_NOT_AUTHORIZED', 'PRODUCTION_BLOCKED',
  'ACCOUNTING_POLICY_REQUIRED', 'ORDER_NOT_BILLABLE_YET', 'PAYMENT_REQUIRED', 'PAYMENT_METHOD_NOT_INVOICEABLE', 'INVALID_TOTAL',
  'INVALID_PRODUCT_REFERENCE', 'MISSING_TAX_CLASSIFICATION', 'DISCOUNT_NOT_INVOICEABLE', 'DELIVERY_NOT_INVOICEABLE',
  'FISCAL_PARAMETERS_REQUIRED', 'RECIPIENT_DATA_REQUIRED',
]);
const READINESS_FIELDS = ['code', 'scope', 'payment_state', 'payment_method', 'billing_moment', 'item', 'vat_code', 'threshold', 'detail'];

export function parseReadinessReasons(details) {
  let parsed = details;
  if (typeof details === 'string') {
    try { parsed = JSON.parse(details); } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.slice(0, 20)
    .filter((reason) => reason && typeof reason === 'object' && READINESS_CODES.has(reason.code))
    .map((reason) => Object.fromEntries(READINESS_FIELDS
      .filter((field) => ['string', 'number'].includes(typeof reason[field]))
      .map((field) => [field, typeof reason[field] === 'string' ? reason[field].slice(0, 80) : reason[field]])));
}
