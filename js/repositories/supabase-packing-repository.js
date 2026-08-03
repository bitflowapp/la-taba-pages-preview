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
    manifest: async ({ sessionId }) => {
      const response = await rpc('get_packing_manifest', { p_session_id: sessionId });
      return response.ok ? { ...response, data: normalizeManifest(response.data) } : response;
    },
    revert: ({ sessionId, scanKey, idempotencyKey }) => rpc('revert_packing_scan', {
      p_session_id: sessionId,
      p_scan_key: scanKey,
      p_idempotency_key: idempotencyKey,
    }),
    confirm: ({ sessionId, exceptionReason = null, idempotencyKey }) => rpc('confirm_packing_session_once', {
      p_session_id: sessionId,
      p_exception_reason: exceptionReason,
      p_idempotency_key: idempotencyKey,
    }),
  });
}

function normalizeManifest(value) {
  const session = value?.session || {};
  return {
    schemaVersion: Number(value?.schema_version || 0),
    session: {
      id: String(session.id || ''),
      businessId: String(session.business_id || ''),
      orderId: String(session.order_id || ''),
      orderRevision: Number(session.order_revision || 0),
      status: String(session.status || ''),
      operatorId: String(session.operator_id || ''),
      updatedAt: String(session.updated_at || ''),
    },
    items: (Array.isArray(value?.items) ? value.items : []).map((item) => ({
      productId: String(item.product_id || ''),
      name: String(item.name || ''),
      quantity: Number(item.quantity || 0),
      barcodes: (Array.isArray(item.barcodes) ? item.barcodes : []).map((barcode) => ({
        gtin: String(barcode.gtin || ''),
        unitFactor: Number(barcode.unit_factor || 0),
      })),
    })),
    scans: (Array.isArray(value?.scans) ? value.scans : []).map((scan) => ({
      scanKey: String(scan.scan_key || ''),
      gtin: String(scan.gtin || ''),
      productId: String(scan.product_id || ''),
      unitFactor: Number(scan.unit_factor || 0),
      createdAt: String(scan.created_at || ''),
      revertedAt: scan.reverted_at ? String(scan.reverted_at) : null,
    })),
  };
}
