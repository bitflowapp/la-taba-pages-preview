/*
 * GATE DE CAMPAÑAS CONTRA EL CATÁLOGO VIVO.
 *
 * Lo que falló: las cuatro campañas publicadas apuntaban a SKU que sólo existían
 * en el snapshot CP de las pruebas (`heineken-710ml`, `aperol-750ml`,
 * `red-bull-energy-drink-355ml`, `coca-cola-original-2250ml-local`). El test
 * «cada candidata apunta a un producto que EXISTE» comparaba contra ESE snapshot,
 * así que pasaba, y en producción ninguna campaña encontraba su producto: la
 * home no habría mostrado una sola animación.
 *
 * Este gate no inventa nada: toma las filas tal como las devuelve la base, las
 * pasa por el MISMO cargador que usa la tienda (`loadCatalog` del repositorio de
 * pedidos, con un cliente que sólo contesta la consulta de productos) y evalúa
 * cada campaña ENCENDIDA y APROBADA con el mismo motor.
 *
 * Por campaña:
 *   TARGET_PRODUCT_EXISTS    el SKU está en el catálogo que ve el cliente
 *   BRAND_MATCH              la marca del producto es la de la identidad
 *   PRESENTATION_MATCH       variante y capacidad exactas (ni 355 por 250 ml)
 *   PACKAGING_MATCH          el envase del producto es el de la identidad y el de la escena
 *   REAL_IMAGE               foto oficial completa (original, miniatura y huella)
 *   ORDERABLE_WHEN_SHOWN     se puede comprar ahora (stock, precio confirmado, alcohol)
 *   SELECTED_BY_ENGINE       el motor la elige de verdad en alguna superficie
 */
import { campaignContainer } from '../../js/campaigns/campaign-product.js';
import { campaignProblems, normalizeCampaign, selectCampaigns } from '../../js/campaigns/campaign-engine.js';
import { getCustomerCatalogProducts, isProductOrderable } from '../../js/core/catalog-store.js';
import { productPhoto, productPhotoIsOfficial } from '../../js/core/product-photo.js';
import { createSupabaseOrderRepository } from '../../js/repositories/supabase_order_repository.js';

/** Las columnas que pide la tienda (`loadCatalog`): la vista pública del catálogo. */
export const STORE_COLUMNS = [
  'id', 'business_id', 'external_id', 'sku', 'name', 'brand', 'description', 'category', 'subcategory', 'variant',
  'presentation', 'capacity_value', 'capacity_unit', 'capacity', 'packaging_type', 'units_per_pack', 'sold_as_pack',
  'price', 'price_status', 'stock', 'available', 'chilled', 'is_alcoholic', 'minimum_age', 'image_url', 'image_sha256',
  'image_thumbnail_url', 'image_thumbnail_sha256', 'source_image_sha256', 'tags', 'sort_order', 'is_active', 'is_verified',
];

const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';

/** Lo que la consulta de la tienda le pide a la base: activo, verificado, a la venta o alcohol con foto. */
export function rowsVisibleToCustomers(rows) {
  return rows.filter((row) => row.is_active === true && row.is_verified === true
    && (row.available === true || (row.is_alcoholic === true && row.available === false && row.image_url != null)));
}

function storage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: (key) => { values.delete(key); },
  };
}

/** Productos con la forma que tienen en la tienda: las filas pasan por `rowToCatalogProduct`. */
export async function loadProductsLikeTheStore(rows, { businessId = BUSINESS_ID } = {}) {
  const visible = rowsVisibleToCustomers(rows);
  const query = {
    select: () => query, eq: () => query, or: () => query, order: () => query,
    then: (resolve, reject) => Promise.resolve({ data: visible, error: null, status: 200 }).then(resolve, reject),
  };
  const client = {
    from: () => query,
    // `loadCatalog` no autentica; el repositorio sólo exige que exista `auth`.
    auth: { getSession: async () => ({ data: { session: null }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    rpc: async () => ({ data: null, error: null, status: 200 }),
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: async () => 'ok',
  };
  const repository = createSupabaseOrderRepository({ client, businessId, storage: storage() });
  const result = await repository.loadCatalog();
  if (!result?.ok) throw new Error(`loadCatalog falló: ${result?.message || JSON.stringify(result)}`);
  return result.data?.products ?? result.products ?? [];
}

const ml = (product) => {
  const value = Number(product.capacityValue);
  const unit = String(product.capacityUnit || 'ml').toLowerCase();
  return unit === 'l' ? value * 1000 : unit === 'ml' ? value : NaN;
};
const norm = (value) => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** Una campaña encendida y aprobada es la que se publica: son las que el gate exige. */
export function isLiveCampaign(campaign) {
  const normalized = normalizeCampaign(campaign);
  return Boolean(normalized?.enabled) && normalized.approval.status === 'APROBADA';
}

export function evaluateCampaign(campaign, products, { supabaseUrl = '' } = {}) {
  const normalized = normalizeCampaign(campaign);
  const identity = normalized.identity || {};
  const product = normalized.skus.map((sku) => products.find((entry) => entry.sku === sku || entry.externalId === sku)).find(Boolean) || null;
  const photo = product ? productPhoto(product, supabaseUrl) : null;
  const flags = {
    TARGET_PRODUCT_EXISTS: Boolean(product),
    BRAND_MATCH: Boolean(product) && norm(product.brand) === norm(identity.brand),
    PRESENTATION_MATCH: Boolean(product) && norm(product.variant) === norm(identity.variant) && ml(product) === identity.volumeMl,
    PACKAGING_MATCH: Boolean(product)
      && campaignContainer(product) === identity.container && identity.container === normalized.creative.vessel,
    REAL_IMAGE: Boolean(product) && productPhotoIsOfficial(product, supabaseUrl) && Boolean(photo?.src) && Boolean(photo?.master),
    ORDERABLE_WHEN_SHOWN: Boolean(product) && isProductOrderable(product),
  };
  const selected = selectCampaigns({
    campaigns: [campaign], products: getCustomerCatalogProducts(products), isOrderable: isProductOrderable,
    catalog: { categoryId: 'all', searching: false, filtered: false, listSize: 99 },
  });
  flags.SELECTED_BY_ENGINE = Object.values(selected).some(Boolean);
  return {
    id: normalized.id,
    sku: product?.sku || normalized.skus.join('|'),
    problems: campaignProblems(normalized),
    product: product && {
      name: product.name, brand: product.brand, variant: product.variant, capacity: product.capacity,
      packagingType: product.packagingType, price: product.price, stock: product.stock, available: product.available,
    },
    flags,
    ok: Object.values(flags).every(Boolean) && campaignProblems(normalized).length === 0,
  };
}

/** Evalúa TODAS las campañas encendidas y aprobadas; informa aparte las apagadas. */
export async function evaluateCampaignsAgainstRows(rows, campaigns, options = {}) {
  const products = await loadProductsLikeTheStore(rows, options);
  const live = campaigns.filter(isLiveCampaign).map((campaign) => evaluateCampaign(campaign, products, options));
  const pending = campaigns.filter((campaign) => !isLiveCampaign(campaign)).map((campaign) => ({
    id: campaign.id, enabled: campaign.enabled, approval: campaign.approval?.status, reason: campaign.approval?.reference,
  }));
  return { catalogCount: products.length, rowCount: rows.length, live, pending };
}
