import { classifyRpcError } from './supabase-business-repository.js';

export function createSupabaseInventoryRepository({ client, businessId }) {
  if (typeof client?.rpc !== 'function' || typeof client?.from !== 'function') throw new Error('Cliente Supabase inv\u00e1lido.');
  if (!businessId) throw new Error('El repositorio de inventario requiere businessId.');

  async function rpc(name, args) {
    const { data, error, status } = await client.rpc(name, args);
    return error ? classifyRpcError(error, status) : { ok: true, data };
  }

  return Object.freeze({
    async listCatalogProducts() {
      const { data, error, status } = await client.from('products')
        .select('id,sku,external_id,name,brand,variant,capacity,capacity_value,capacity_unit,packaging_type,category,subcategory,price,price_status,stock,available,merchant_available,is_verified,is_active,is_alcoholic,image_url,image_thumbnail_url,source_image_sha256,catalog_asset_id,catalog_origin,sort_order')
        .eq('business_id', businessId).eq('catalog_origin', 'commercial')
        .order('sort_order', { ascending: true }).order('name', { ascending: true }).limit(200);
      return error ? classifyRpcError(error, status) : { ok: true, data: Array.isArray(data) ? data : [] };
    },
    saveCommercialBatch: (rows) => rpc('apply_commercial_catalog_batch', {
      p_business_id: businessId, p_rows: rows,
    }),
    // Vuelve el producto a borrador de verdad (oculto y sin verificar): es lo
    // que permite cambiarle la foto. Contrato existente, owner/admin.
    unpublishCatalogProduct: (externalId) => rpc('unpublish_catalog_product', {
      p_business_id: businessId, p_external_id: externalId,
    }),
    async lookupBarcode(gtin) {
      const { data, error, status } = await client.from('product_barcodes')
        .select('id,business_id,product_id,gtin,barcode_type,package_type,unit_factor,is_primary,is_active,products(id,sku,name,brand,presentation,stock,available,is_active,is_verified,price,price_status,is_alcoholic,catalog_origin,image_url,image_sha256,image_thumbnail_url,image_thumbnail_sha256,source_image_sha256,catalog_asset_id)')
        .eq('business_id', businessId).eq('gtin', gtin).eq('is_active', true).maybeSingle();
      return error ? classifyRpcError(error, status) : { ok: true, data: data || null };
    },
    createProductDraft: ({ gtin, suggestion, idempotencyKey }) => rpc('create_catalog_product_draft', {
      p_business_id: businessId, p_gtin: gtin, p_suggestion: suggestion, p_idempotency_key: idempotencyKey,
    }),
    publishProductDraft: ({ draftId, name, category, price, packageType, unitFactor }) => rpc('publish_catalog_product_draft', {
      p_draft_id: draftId, p_name: name, p_category: category, p_price: price, p_package_type: packageType, p_unit_factor: unitFactor,
    }),
    completeScannedProduct: ({ productId, details }) => rpc('complete_scanned_product', {
      p_product_id: productId, p_details: details,
    }),
    getScannedProductReadiness: (productId) => rpc('get_scanned_product_readiness', { p_product_id: productId }),
    setCommercialPublication: ({ sku, publish }) => rpc('set_commercial_product_publication', {
      p_business_id: businessId,
      p_sku: sku,
      p_publish: publish,
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
