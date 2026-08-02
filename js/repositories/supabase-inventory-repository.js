import { classifyRpcError } from './supabase-business-repository.js';

export function createSupabaseInventoryRepository({ client, businessId }) {
  if (typeof client?.rpc !== 'function' || typeof client?.from !== 'function') throw new Error('Cliente Supabase inv\u00e1lido.');
  if (!businessId) throw new Error('El repositorio de inventario requiere businessId.');

  async function rpc(name, args) {
    const { data, error, status } = await client.rpc(name, args);
    return error ? classifyRpcError(error, status) : { ok: true, data };
  }

  return Object.freeze({
    async lookupBarcode(gtin) {
      const { data, error, status } = await client.from('product_barcodes')
        .select('id,business_id,product_id,gtin,barcode_type,package_type,unit_factor,is_primary,is_active,products(id,name,brand,presentation,stock,available,is_active,is_verified)')
        .eq('business_id', businessId).eq('gtin', gtin).eq('is_active', true).maybeSingle();
      return error ? classifyRpcError(error, status) : { ok: true, data: data || null };
    },
    createProductDraft: ({ gtin, suggestion, idempotencyKey }) => rpc('create_catalog_product_draft', {
      p_business_id: businessId, p_gtin: gtin, p_suggestion: suggestion, p_idempotency_key: idempotencyKey,
    }),
    publishProductDraft: ({ draftId, name, category, price, packageType, unitFactor }) => rpc('publish_catalog_product_draft', {
      p_draft_id: draftId, p_name: name, p_category: category, p_price: price, p_package_type: packageType, p_unit_factor: unitFactor,
    }),
    applyMovement: (intent) => rpc('apply_inventory_movement', {
      p_business_id: businessId,
      p_product_id: intent.productId,
      p_barcode_id: intent.barcodeId || null,
      p_movement_type: intent.movementType,
      p_package_quantity: intent.packageQuantity,
      p_direction: intent.direction,
      p_reference_type: intent.referenceType || null,
      p_reference_id: intent.referenceId || null,
      p_reason: intent.reason || null,
      p_idempotency_key: intent.idempotencyKey,
    }),
    async listMovements({ productId = null, limit = 100 } = {}) {
      let query = client.from('inventory_movements').select('*').eq('business_id', businessId).order('created_at', { ascending: false }).limit(Math.min(500, Math.max(1, limit)));
      if (productId) query = query.eq('product_id', productId);
      const { data, error, status } = await query;
      return error ? classifyRpcError(error, status) : { ok: true, data: Array.isArray(data) ? data : [] };
    },
  });
}
