import { classifyRpcError } from './supabase-business-repository.js';

/** Productos que el Panel pide por vez. Si la respuesta llega justo al tope, puede haber m\u00e1s. */
export const CATALOG_PANEL_LIMIT = 200;

export function createSupabaseInventoryRepository({ client, businessId }) {
  if (typeof client?.rpc !== 'function' || typeof client?.from !== 'function') throw new Error('Cliente Supabase inv\u00e1lido.');
  if (!businessId) throw new Error('El repositorio de inventario requiere businessId.');

  async function rpc(name, args) {
    const { data, error, status } = await client.rpc(name, args);
    return error ? classifyRpcError(error, status) : { ok: true, data };
  }

  /*
   * Costo y precio regular. `unit_cost` no tiene SELECT para nadie del lado del
   * navegador (20261005210000): lo lee `get_catalog_costs`, que exige due\u00f1o o
   * encargado. Que falle NUNCA tira el cat\u00e1logo: sin la funci\u00f3n (una base que
   * todav\u00eda no tiene la migraci\u00f3n) o sin permiso, el Panel sigue editando
   * precio y stock y no ofrece los campos de costo.
   */
  async function readCatalogCosts() {
    let response;
    try {
      response = await client.rpc('get_catalog_costs', { p_business_id: businessId });
    } catch (_) {
      return { ok: false, code: 'SERVER_UNAVAILABLE', reason: 'unavailable', message: CATALOG_COSTS_MESSAGES.unavailable };
    }
    const { data, error, status } = response || {};
    if (error) {
      const failure = classifyRpcError(error, status);
      const reason = catalogCostsFailureReason(error, failure, status);
      return { ...failure, reason, message: CATALOG_COSTS_MESSAGES[reason] };
    }
    if (!Array.isArray(data)) return { ok: false, code: 'UNEXPECTED', reason: 'unavailable', message: CATALOG_COSTS_MESSAGES.unavailable };
    return { ok: true, data };
  }

  return Object.freeze({
    async listCatalogProducts() {
      const [{ data, error, status }, costs] = await Promise.all([
        client.from('products')
          .select('id,sku,external_id,name,brand,variant,capacity,capacity_value,capacity_unit,packaging_type,category,subcategory,price,price_status,stock,available,merchant_available,is_verified,is_active,is_alcoholic,image_url,image_thumbnail_url,source_image_sha256,catalog_asset_id,catalog_origin,sort_order')
          .eq('business_id', businessId).eq('catalog_origin', 'commercial')
          .order('sort_order', { ascending: true }).order('name', { ascending: true }).limit(CATALOG_PANEL_LIMIT),
        readCatalogCosts(),
      ]);
      if (error) return classifyRpcError(error, status);
      const products = Array.isArray(data) ? data : [];
      return {
        ok: true,
        data: costs.ok ? mergeCatalogCosts(products, costs.data) : products,
        pricing: costs.ok
          ? { available: true, reason: '', message: '' }
          : { available: false, reason: costs.reason, message: costs.message },
        limitReached: products.length >= CATALOG_PANEL_LIMIT,
      };
    },
    // sku, price, unit_cost, compare_at_price de todo el cat\u00e1logo comercial.
    listCatalogCosts: () => readCatalogCosts(),
    // Precio, stock, publicaci\u00f3n y \u2014con la migraci\u00f3n 20261021234000\u2014 costo
    // (`unit_cost`) y precio regular (`compare_at_price`). Un lote es at\u00f3mico.
    // `message` conserva el texto del servidor (lo leen los traductores de
    // publicaci\u00f3n); `friendly` es la frase para el mostrador y `sku`, la fila
    // que lo fren\u00f3 cuando el servidor la nombra.
    async saveCommercialBatch(rows) {
      const response = await rpc('apply_commercial_catalog_batch', {
        p_business_id: businessId, p_rows: rows,
      });
      if (response.ok) return response;
      const described = describeCatalogBatchFailure(response);
      return { ...response, friendly: described.message, sku: described.sku };
    },
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

const CATALOG_COSTS_MESSAGES = Object.freeze({
  not_installed: 'Los costos y el precio regular todavía no se pueden cargar desde el Panel.',
  forbidden: 'Los costos los ve y los carga sólo el dueño o el encargado.',
  unavailable: 'No pudimos leer los costos ahora. Tocá «Actualizar» para volver a intentar.',
});

function catalogCostsFailureReason(error, failure, status) {
  const code = String(error?.code || '');
  // PGRST202: la API no conoce la función (la migración todavía no está aplicada).
  if (code === 'PGRST202' || code === '42883' || status === 404) return 'not_installed';
  if (failure.code === 'FORBIDDEN' || failure.code === 'SESSION_EXPIRED') return 'forbidden';
  return 'unavailable';
}

/** Suma `unit_cost` y `compare_at_price` a cada producto, por SKU. Lo que no vino queda en `null`. */
export function mergeCatalogCosts(products = [], costs = []) {
  const bySku = new Map((Array.isArray(costs) ? costs : []).map((row) => [String(row?.sku ?? ''), row]));
  return (Array.isArray(products) ? products : []).map((product) => {
    const cost = bySku.get(String(product?.sku ?? ''));
    return {
      ...product,
      unit_cost: cost?.unit_cost ?? null,
      compare_at_price: cost?.compare_at_price ?? null,
    };
  });
}

/*
 * Lo que contesta `apply_commercial_catalog_batch` cuando NO aplica el lote,
 * en castellano de mostrador. El servidor escribe sus motivos en inglés y
 * nombra el SKU; acá se traducen y se devuelve el SKU para marcar la fila.
 * Cualquier rechazo deshace el lote entero: por eso todas las frases dicen que
 * no se guardó nada.
 */
const BATCH_FAILURES = Object.freeze([
  [/Unknown sku (.+?) for this business/i, (sku) => `El SKU ${sku} no existe en el catálogo de este negocio: la planilla no crea productos. No se guardó ningún cambio del lote.`],
  [/Duplicated sku (.+?) in the same batch/i, (sku) => `El SKU ${sku} está repetido en el lote: dejá una sola fila. No se guardó ningún cambio del lote.`],
  [/QA-looking sku in the commercial catalog: (.+?)\.?$/i, (sku) => `El SKU ${sku} parece de prueba y no se carga en el catálogo del negocio. No se guardó ningún cambio del lote.`],
  [/Commercial row without sku/i, () => 'Hay una fila sin SKU. No se guardó ningún cambio del lote.'],
  [/Invalid price (?:format|value) for sku (.+?)(?:[.:]\s|\.?$)/i, (sku) => `${sku}: el precio de venta tiene que ser un importe mayor que cero, con hasta dos decimales. No se guardó ningún cambio del lote.`],
  [/Invalid stock (?:format|range) for sku (.+?)\.?$/i, (sku) => `${sku}: el stock tiene que ser un número entero de cero o más. No se guardó ningún cambio del lote.`],
  [/Invalid unit_cost (?:format|value) for sku (.+?)\.?$/i, (sku) => `${sku}: el costo tiene que ser un importe de cero o más, con hasta dos decimales. No se guardó ningún cambio del lote.`],
  [/Invalid compare_at_price (?:format|value) for sku (.+?)\.?$/i, (sku) => `${sku}: el precio regular tiene que ser un importe mayor que cero, con hasta dos decimales. No se guardó ningún cambio del lote.`],
  [/compare_at_price for sku (.+?) must be greater than the price/i, (sku) => `${sku}: el precio regular (antes) tiene que ser mayor que el precio de venta. No se guardó ningún cambio del lote.`],
  [/Commercial row for sku (.+?) does not decide anything/i, (sku) => `${sku}: la fila no cambia nada. No se guardó ningún cambio del lote.`],
  [/Row for sku (.+?) sets a price and marks it pending/i, (sku) => `${sku}: no se puede cargar un precio y dejarlo pendiente a la vez. No se guardó ningún cambio del lote.`],
  [/Invalid (?:price_pending|publish) flag for sku (.+?)\.?$/i, (sku) => `${sku}: la decisión de publicar no es válida. No se guardó ningún cambio del lote.`],
  [/Refusing to publish sku (.+?) without a (?:confirmed price state|price)/i, (sku) => `${sku}: no se puede publicar sin un precio confirmado. No se guardó ningún cambio del lote.`],
  [/Refusing to publish sku (.+?) without stock/i, (sku) => `${sku}: no se puede publicar sin stock. No se guardó ningún cambio del lote.`],
  [/Refusing to publish inactive sku (.+?)\.?$/i, (sku) => `${sku}: el producto está inactivo y no se puede publicar. No se guardó ningún cambio del lote.`],
  [/Refusing to publish sku (.+?): it must have no image/i, (sku) => `${sku}: la foto del producto está incompleta o no coincide con la aprobada, y así no se publica. No se guardó ningún cambio del lote.`],
  [/Refusing to publish sku (.+?): alcohol sales/i, (sku) => `${sku}: la venta de alcohol no está habilitada en este negocio. No se guardó ningún cambio del lote.`],
  [/1 to 500 entries|non-null JSON array/i, () => 'El lote tiene que tener entre 1 y 500 filas. No se guardó ningún cambio.'],
]);

export function describeCatalogBatchFailure(failure = {}) {
  const code = String(failure?.code || '');
  if (code === 'FORBIDDEN') return { message: 'Sólo el dueño o el encargado pueden cambiar precios y costos.', sku: '' };
  if (code === 'SESSION_EXPIRED') return { message: 'Tu sesión venció. Volvé a entrar y probá de nuevo: no se guardó ningún cambio.', sku: '' };
  const raw = String(failure?.message || '');
  for (const [pattern, describe] of BATCH_FAILURES) {
    const match = pattern.exec(raw);
    if (match) {
      const sku = String(match[1] || '').trim();
      return { message: describe(sku), sku };
    }
  }
  if (code === 'REVISION_CONFLICT') return { message: 'Otro cambio llegó antes. Actualizá el catálogo y volvé a intentar: no se guardó ningún cambio.', sku: '' };
  if (code === 'RATE_LIMITED') return { message: 'Hubo demasiados intentos seguidos. Esperá un momento: no se guardó ningún cambio.', sku: '' };
  if (code === 'SERVER_UNAVAILABLE' || failure?.retryable === true) {
    return { message: 'No hay conexión con el servidor. No se guardó ningún cambio: volvé a intentar en un momento.', sku: '' };
  }
  if (code === '23514') {
    return { message: 'El servidor rechazó el lote: algún producto no cumple las reglas del catálogo (por ejemplo, quedar publicado sin foto aprobada). No se guardó ningún cambio.', sku: '' };
  }
  return { message: 'El servidor no aceptó los cambios. No se guardó ningún cambio del lote.', sku: '' };
}
