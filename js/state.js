import { BUSINESS_CONFIG, STORAGE_KEYS } from './config.js';
import { categories, PREVIEW_CATALOG_VERSION, seedOrders } from './data.js';
import {
  buildDemoCatalog,
  isProductOrderable,
  isProductVisibleToCustomer,
  mergeCatalogProducts,
} from './core/catalog-store.js';
import { isPricePending } from './core/pricing.js';
import { resolveCombos } from './core/combos.js';
import { COMBO_MANIFEST } from './combos-data.js';
import { normalizeDeliveryProof } from './core/delivery-proof.js';
import { normalizeDeliveryCode } from './core/delivery-code.js';
import {
  buildDefaultBusinessConfig,
  getBusinessConfig,
  mergeBusinessConfig,
  normalizeBusinessConfig,
  setRuntimeBusinessConfig,
} from './core/business-config-store.js';
import {
  ORDER_STATUS_CLASSES,
  ORDER_STATUS_LABELS,
  isValidOrderStatus,
  normalizeOrderStatus,
} from './core/order-status.js';
import { normalizePreparationMinutes } from './core/business-ops.js';
import {
  calculateTotals,
  getDeliveryFeeForMode,
  normalizeDeliveryMode,
  normalizeMoneyValue,
} from './core/pricing.js';
import { normalizeOrderCoupon, normalizePromotionCollection } from './core/promotions.js';
import { PREVIEW_PROMOTION_SEED } from './preview-promotions-data.js';
import {
  getStorageArea,
  safeJsonParse,
  safeStorageGet,
  safeStorageRemove,
  safeStorageSet,
} from './core/storage.js';
import {
  APP_DATA_VERSION,
  APP_MODE_PRODUCTION,
  APP_MODE_UNAVAILABLE,
  getAppMode,
  isDemoMode,
} from './core/app-mode.js';
import { normalizePaymentMethod, sanitizeNotes, sanitizeText } from './core/validators.js';
import { clampProgress } from './core/simulation.js';
import { normalizeAddressDetails, normalizeOrderAddressDetails } from './core/address.js';
import { normalizePendingReorder } from './core/reorder.js';
import {
  mergeProductionCartMutation,
  readProductionCart,
  sanitizeProductionCartSnapshot,
  writeProductionCart,
} from './core/production-cart-storage.js';

// v5: incorpora versión de catálogo para actualizar identidades/packshots demo
// sin borrar pedidos, carrito ni preferencias locales compatibles.
export const STATE_SCHEMA_VERSION = 6;

export const SORT_OPTIONS = Object.freeze(['recommended', 'price_asc', 'popular']);

const listeners = new Set();
const STREET_DESTINATION_IDS = new Set(
  (BUSINESS_CONFIG.demoStreetTestDestinations || []).map((destination) => destination.id),
);
// Filtros virtuales del storefront: no dependen de una categoría persistida en
// el producto, pero deben sobrevivir al mismo saneamiento que los chips reales.
const CUSTOMER_CATEGORY_IDS = new Set(['favorites', 'popular', 'fernet']);

const defaultState = () => {
  const baseProducts = buildBaseProducts();
  const baseOrders = isDemoMode()
    ? seedOrders.map((order) => normalizeOrder(order)).filter(Boolean)
    : [];

  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    dataVersion: APP_DATA_VERSION,
    catalogVersion: isDemoMode() ? PREVIEW_CATALOG_VERSION : '',
    appMode: getAppMode(),
    activeCategory: 'all',
    searchQuery: '',
    sortBy: 'recommended',
    catalogFilters: defaultCatalogFilters(),
    cart: [],
    comboSelections: [],
    orders: baseOrders,
    products: baseProducts,
    lastOrderId: null,
    adminUnlocked: readAdminFlag(),
    lastCheckoutDraft: null,
    pendingReorder: null,
    simulation: null,
    businessConfig: buildBaseBusinessConfig(),
    promotions: isDemoMode() ? normalizePromotionCollection(PREVIEW_PROMOTION_SEED) : [],
  };
};

let productionCartBase = sanitizeProductionCartSnapshot(null);
let state = loadState();
setRuntimeBusinessConfig(state.businessConfig);
// Persistir también el arranque limpio: así una migración incompatible no deja
// el storage vacío ni permite que otro modo reaparezca en la próxima visita.
persist();

function readAdminFlag() {
  return safeStorageGet(getStorageArea('sessionStorage'), STORAGE_KEYS.adminUnlocked) === 'true';
}

function loadState() {
  const base = defaultState();
  const localStorage = getStorageArea('localStorage');
  if ([APP_MODE_PRODUCTION, APP_MODE_UNAVAILABLE].includes(getAppMode())) {
    // Pedidos, catálogo y PII productiva siguen viviendo sólo en memoria. El
    // carrito usa una clave separada que admite exclusivamente ids y cantidades.
    const savedCart = readProductionCart(localStorage, STORAGE_KEYS.productionCart);
    productionCartBase = savedCart;
    // Acá se le borraban los favoritos al cliente EN CADA CARGA DE PÁGINA.
    //
    // `loadState()` es efecto de módulo: corre al importar `state.js`. En la
    // rama de producción llamaba a `resetIncompatiblePersistence()` SIN
    // condición —comparar con la rama demo, donde el mismo reset sólo corre si
    // el estado guardado es incompatible—, y ese reset borra
    // `STORAGE_KEYS.customerFavorites` junto con el resto.
    //
    // Los favoritos SÍ se escriben en producción: `persistFavorites`
    // (js/core/customer-preferences.js:61) los guarda en esa misma clave de
    // localStorage. O sea que se guardaban y se borraban en el próximo arranque.
    //
    // Las dos cosas que este reset mezclaba son distintas: «no cachear PII
    // productiva» (correcto y obligatorio) y «tirar restos de un esquema
    // incompatible» (que en producción no aplica, porque acá no se hidrata
    // estado). Se conserva lo primero y se deja de hacer lo segundo: los
    // favoritos son ids de producto elegidos por la persona, no PII.
    clearProductionSensitivePersistence(localStorage, getStorageArea('sessionStorage'));
    return {
      ...base,
      cart: savedCart.cart,
      comboSelections: savedCart.comboSelections,
      adminUnlocked: false,
    };
  }
  const raw = safeStorageGet(localStorage, STORAGE_KEYS.state);
  const parsed = safeJsonParse(raw, null);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ...base, adminUnlocked: readAdminFlag() };
  }

  const compatible = isPersistedStateCompatible(parsed, base);
  const migratable = isDemoStateMigratable(parsed, base);
  if (!compatible && !migratable) {
    resetIncompatiblePersistence(localStorage, getStorageArea('sessionStorage'));
    return { ...base, adminUnlocked: false };
  }

  return {
    ...hydrateState(parsed, base, {
      refreshBaseCatalog: migratable || requiresCatalogRefresh(parsed, base),
    }),
    adminUnlocked: readAdminFlag(),
  };
}

export function isPersistedStateCompatible(savedState, baseState = defaultState()) {
  if (!isPlainObject(savedState)) return false;
  return savedState.schemaVersion === STATE_SCHEMA_VERSION
    && savedState.dataVersion === APP_DATA_VERSION
    && savedState.appMode === baseState.appMode;
}

// Sólo migra estados sandbox conocidos. Producción y configuraciones inválidas
// siguen cerradas y nunca recuperan datos locales de una sesión demo.
export function isDemoStateMigratable(savedState, baseState = defaultState()) {
  if (!isPlainObject(savedState) || baseState.appMode !== 'demo') return false;
  if (savedState.appMode !== 'demo') return false;
  return [4, 5].includes(Number(savedState.schemaVersion))
    && String(savedState.dataVersion || '') === 'la-taba-runtime-v2';
}

export function requiresCatalogRefresh(savedState, baseState = defaultState()) {
  if (!isPlainObject(savedState) || baseState.appMode !== 'demo') return false;
  return String(savedState.catalogVersion || '') !== PREVIEW_CATALOG_VERSION;
}

/**
 * Restos de un esquema que ya no se puede leer. Se usa SÓLO cuando el estado
 * guardado es incompatible o no migrable: ahí tirar todo es lo correcto porque
 * no se puede confiar en nada de lo que hay.
 */
function resetIncompatiblePersistence(localStorage, sessionStorage) {
  [
    STORAGE_KEYS.state,
    STORAGE_KEYS.customerFavorites,
    STORAGE_KEYS.customerHistory,
    STORAGE_KEYS.customerProfile,
    STORAGE_KEYS.cashboxClosures,
  ].forEach((key) => safeStorageRemove(localStorage, key));
  safeStorageRemove(sessionStorage, STORAGE_KEYS.adminUnlocked);
}

/**
 * Lo que NO puede quedar cacheado en un arranque productivo.
 *
 * En producción, pedidos, catálogo y datos personales viven sólo en memoria y
 * se reconstruyen desde Supabase: ese contrato se mantiene entero. Lo que se
 * saca de la lista son los FAVORITOS, que son ids de producto elegidos por la
 * persona —no son datos de nadie— y que antes se borraban en cada carga por
 * compartir función con la limpieza de esquemas incompatibles.
 *
 * `cashboxClosures` tampoco se toca acá: es del Panel, no del cliente, y en la
 * rama productiva del cliente no hay motivo para borrarlo.
 */
function clearProductionSensitivePersistence(localStorage, sessionStorage) {
  [
    STORAGE_KEYS.state,
    STORAGE_KEYS.customerHistory,
    STORAGE_KEYS.customerProfile,
  ].forEach((key) => safeStorageRemove(localStorage, key));
  safeStorageRemove(sessionStorage, STORAGE_KEYS.adminUnlocked);
}

export function hydrateState(savedState, baseState = defaultState(), { refreshBaseCatalog = false } = {}) {
  return sanitizeState(
    { ...baseState, ...(isPlainObject(savedState) ? savedState : {}) },
    baseState,
    { refreshBaseCatalog },
  );
}

export function sanitizeState(nextState, baseState = defaultState(), {
  refreshBaseCatalog = false,
  // `hydrate` es el valor por defecto a propósito: es el más restrictivo, así
  // que un llamador nuevo que se olvide de declararlo limpia de más, no de
  // menos. Sólo `commitState` pide `live`.
  reconcile = 'hydrate',
} = {}) {
  const source = isPlainObject(nextState) ? nextState : {};
  const baseProducts = buildBaseProducts();
  const mergedProducts = mergeProducts(
    baseProducts,
    Array.isArray(source.products) ? source.products : baseState.products,
    { refreshBaseCatalog },
  );
  const productMap = new Map(mergedProducts.map((product) => [product.id, product]));
  const orders = sanitizeOrders(Array.isArray(source.orders) ? source.orders : baseState.orders);
  const lastOrderId = normalizeLastOrderId(source.lastOrderId, orders);
  // Antes de que llegue el catálogo remoto sólo podemos sanear la forma del
  // carrito. La carga exitosa del catálogo valida ids, disponibilidad y stock.
  const defersProductionCartValidation = [APP_MODE_PRODUCTION, APP_MODE_UNAVAILABLE].includes(baseState.appMode)
    && mergedProducts.length === 0;
  const deferredCart = defersProductionCartValidation
    ? sanitizeProductionCartSnapshot({
      cart: source.cart,
      comboSelections: source.comboSelections,
    })
    : null;

  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    dataVersion: APP_DATA_VERSION,
    catalogVersion: baseState.appMode === 'demo' ? PREVIEW_CATALOG_VERSION : '',
    appMode: baseState.appMode || getAppMode(),
    activeCategory: normalizeCategoryId(source.activeCategory, baseState.activeCategory || 'all', mergedProducts),
    searchQuery: sanitizeText(source.searchQuery, { fallback: '', maxLength: 80 }),
    sortBy: normalizeSortBy(source.sortBy),
    catalogFilters: normalizeCatalogFilters(source.catalogFilters),
    cart: deferredCart?.cart || sanitizeCart(source.cart, productMap, { reconcile }),
    comboSelections: deferredCart?.comboSelections || sanitizeComboSelections(
      source.comboSelections,
      mergedProducts,
      { reconcile },
    ),
    orders,
    products: mergedProducts,
    lastOrderId,
    adminUnlocked: Boolean(source.adminUnlocked),
    lastCheckoutDraft: sanitizeCheckoutDraft(source.lastCheckoutDraft),
    pendingReorder: normalizePendingReorder(source.pendingReorder),
    simulation: sanitizeSimulation(source.simulation, orders),
    businessConfig: normalizeBusinessConfig(source.businessConfig, baseState.businessConfig || buildDefaultBusinessConfig()),
    promotions: baseState.appMode === 'demo'
      ? normalizePromotionCollection(Array.isArray(source.promotions) ? source.promotions : baseState.promotions)
      : [],
  };
}

function normalizeSortBy(value) {
  const candidate = sanitizeText(value, { fallback: 'recommended', maxLength: 24 });
  return SORT_OPTIONS.includes(candidate) ? candidate : 'recommended';
}

export function defaultCatalogFilters() {
  return {
    brand: 'all',
    capacity: 'all',
    presentation: 'all',
    pack: 'all',
    alcohol: 'all',
    availability: 'all',
    price: 'all',
    promotion: 'all',
  };
}

export function normalizeCatalogFilters(value) {
  const source = isPlainObject(value) ? value : {};
  const values = defaultCatalogFilters();
  const allowed = {
    pack: new Set(['all', 'unit', 'pack']),
    alcohol: new Set(['all', 'with', 'without']),
    availability: new Set(['all', 'available', 'unavailable']),
    price: new Set(['all', 'confirmed', 'pending']),
    promotion: new Set(['all', 'active']),
  };
  for (const key of ['brand', 'capacity', 'presentation']) {
    values[key] = sanitizeText(source[key], { fallback: 'all', maxLength: 100 }) || 'all';
  }
  for (const [key, allowedValues] of Object.entries(allowed)) {
    const candidate = sanitizeText(source[key], { fallback: 'all', maxLength: 24 });
    values[key] = allowedValues.has(candidate) ? candidate : 'all';
  }
  return values;
}

function normalizeStreetDestinationId(value) {
  const candidate = sanitizeText(value, { maxLength: 60 });
  return STREET_DESTINATION_IDS.has(candidate) ? candidate : null;
}

// La simulación solo se conserva si apunta a un pedido de delivery todavía activo.
function sanitizeSimulation(raw, orders) {
  if (!isPlainObject(raw)) return null;
  const orderId = sanitizeText(raw.orderId, { maxLength: 40 });
  if (!orderId) return null;
  const order = Array.isArray(orders) ? orders.find((candidate) => candidate.id === orderId) : null;
  if (!order || order.deliveryMode !== 'delivery') return null;
  if (order.status === 'delivered' || order.status === 'cancelled') return null;

  const baseEta = Math.max(0, Math.floor(Number(raw.baseEta) || 0));
  const userStarted = Boolean(raw.userStarted);
  const source = raw.source === 'gps' ? 'gps' : 'simulation';
  // Estados antiguos sembraban 8 % al pasar a reparto. Si el rider nunca
  // inició la ruta, volvemos al origen para que no sobrevivan ETA/avance
  // fantasma después de una recarga.
  const hasMovement = userStarted || source === 'gps';
  const progress = hasMovement ? clampProgress(raw.progress) : 0;
  const destinationId = normalizeStreetDestinationId(raw.destinationId || raw.demoDestinationId || raw.routeId);

  return {
    orderId,
    running: Boolean(raw.running),
    userStarted,
    mode: raw.mode === 'gps' ? 'gps' : 'demo',
    source,
    routeId: sanitizeText(raw.routeId, { fallback: destinationId || 'neuquen', maxLength: 60 }),
    ...(destinationId ? { destinationId } : {}),
    progress,
    baseEta,
    etaMinutes: hasMovement
      ? Math.max(0, Math.floor(Number(raw.etaMinutes) || 0))
      : baseEta,
    speed: Math.max(1, Math.min(8, Math.floor(Number(raw.speed) || 1))),
    startedAt: normalizeIsoDate(raw.startedAt),
    timestamp: Math.max(0, Number(raw.timestamp) || 0),
    lastFixAt: normalizeIsoDate(raw.lastFixAt || raw.timestamp || raw.startedAt),
    gpsStatus: sanitizeText(raw.gpsStatus, { fallback: 'inactive', maxLength: 40 }),
    ...(raw.gpsPaused ? { gpsPaused: true } : {}),
    ...(raw.gpsRequestedAt ? { gpsRequestedAt: normalizeIsoDate(raw.gpsRequestedAt) } : {}),
    ...(raw.lastGpsFixAt ? { lastGpsFixAt: normalizeIsoDate(raw.lastGpsFixAt) } : {}),
    ...(raw.lastGpsPublishedAt ? { lastGpsPublishedAt: normalizeIsoDate(raw.lastGpsPublishedAt) } : {}),
    ...(raw.lastPublishedAt ? { lastPublishedAt: normalizeIsoDate(raw.lastPublishedAt) } : {}),
    ...(raw.lastBackendPublishAt ? { lastBackendPublishAt: normalizeIsoDate(raw.lastBackendPublishAt) } : {}),
    ...(raw.lastSentSource ? { lastSentSource: raw.lastSentSource === 'gps' ? 'gps' : 'simulation' } : {}),
    ...(raw.streetMode ? { streetMode: true } : {}),
    ...(raw.sandboxMode ? { sandboxMode: true } : {}),
    ...(raw.origin === 'local_gps' || raw.origin === 'sandbox_route'
      ? { origin: raw.origin }
      : raw.source === 'gps' ? { origin: 'local_gps' } : {}),
    ...(raw.owner ? { owner: sanitizeText(raw.owner, { maxLength: 80 }) } : {}),
    ...(Number.isFinite(Number(raw.lat)) ? { lat: Number(raw.lat) } : {}),
    ...(Number.isFinite(Number(raw.lng)) ? { lng: Number(raw.lng) } : {}),
    ...(Number.isFinite(Number(raw.accuracy)) ? { accuracy: Math.max(0, Number(raw.accuracy)) } : {}),
    ...(Number.isFinite(Number(raw.heading)) ? { heading: ((Number(raw.heading) % 360) + 360) % 360 } : {}),
    ...(Number.isFinite(Number(raw.speed)) ? { speed: Math.max(0, Number(raw.speed)) } : {}),
    ...(raw.gpsError ? { gpsError: sanitizeText(raw.gpsError, { maxLength: 140 }) } : {}),
    ...(raw.backendError ? { backendError: sanitizeText(raw.backendError, { maxLength: 160 }) } : {}),
  };
}

function sanitizeOrders(rawOrders) {
  if (!Array.isArray(rawOrders)) return [];
  // Endurecimiento: descarta IDs de pedido duplicados (estado local corrupto o
  // importado) conservando la primera aparición. Como los pedidos nuevos se
  // insertan al frente (unshift), la primera aparición es la versión más reciente.
  const seen = new Set();
  const result = [];
  for (const raw of rawOrders) {
    const order = normalizeOrder(raw);
    if (!order || seen.has(order.id)) continue;
    seen.add(order.id);
    result.push(order);
  }
  return result;
}

/*
 * HIDRATAR NO ES RECONCILIAR
 *
 * Esta función hacía dos trabajos con las mismas reglas, y no son el mismo:
 *
 *   HIDRATAR  — el carrito viene del disco al arrancar. Puede ser de otra
 *               versión, de otro catálogo, de hace una semana. Nadie está
 *               mirando. Descartar y recortar es lo correcto.
 *   RECONCILIAR — el catálogo vivo cambió mientras la persona mira su carrito.
 *               Descartar acá es editarle el pedido a alguien que lo está
 *               viendo, y sin decírselo.
 *
 * Como `sanitizeCart` corre en CADA `commitState`, el segundo caso heredaba las
 * reglas del primero. En producción el catálogo se recarga por realtime cada vez
 * que alguien compra —la RPC descuenta stock—, así que una línea de 5 unidades
 * pasaba a 2 y el total bajaba de $17.880 a $7.152 sin una palabra; con stock 0
 * el carrito quedaba vacío.
 *
 * Y el daño mayor era silencioso: como después de cada commit siempre se cumplía
 * `quantity <= stock` y el producto estaba disponible, `cartItemIssue` devolvía
 * `null` SIEMPRE. Eso dejaba inalcanzables el aviso «Se agotó mientras armabas
 * el pedido», el botón «Quitar del pedido» y la rama de `validateCartForCheckout`
 * que los respalda —todo ya construido, todo muerto—.
 *
 * Lo que se descarta SIEMPRE, mire alguien o no, es lo que se COBRARÍA MAL: un
 * producto que ya no está en el catálogo, uno archivado o de abastecimiento, y
 * uno cuyo precio dejó de ser un número mayor a cero. Perder plata en silencio
 * es peor que perder una línea en silencio.
 */
function sanitizeCart(rawCart, productMap, { reconcile = 'hydrate' } = {}) {
  if (!Array.isArray(rawCart)) return [];
  const enVivo = reconcile === 'live';
  const byProduct = new Map();

  for (const item of rawCart) {
    if (!item || typeof item.productId !== 'string') continue;
    const product = productMap.get(item.productId);
    if (!product) continue;

    // La compuerta del contrato: precio vendible y producto que existe para el
    // cliente. Es la MISMA que usa `addToCart`, no una parecida.
    if (!isProductVisibleToCustomer(product) || isPricePending(product)) continue;

    // Y sólo al hidratar, además, lo que hoy no se puede servir.
    if (!enVivo && (!isProductOrderable(product) || !product.available || product.stock <= 0)) continue;

    const quantity = normalizeCartQuantity(item.quantity);
    if (quantity <= 0) continue;

    const current = byProduct.get(item.productId) || 0;
    const total = current + quantity;
    // En vivo la cantidad elegida no se toca: `cartItemIssue` la explica y
    // `validateCartForCheckout` impide confirmarla.
    byProduct.set(item.productId, enVivo ? total : Math.min(product.stock, total));
  }

  return [...byProduct.entries()].map(([productId, quantity]) => ({ productId, quantity }));
}

/*
 * Un combo guardado se rehidrata sólo si HOY se puede cobrar.
 *
 * Un carrito de ayer con un combo que perdió un componente, se quedó sin stock
 * o dejó de estar aprobado no se corrompe ni se completa con lo que quedó: esa
 * línea se descarta, igual que la de un producto archivado, y el resto del
 * carrito se conserva. Rearmar el combo con menos componentes sería cobrar un
 * combo que el mostrador no puede armar.
 */
function sanitizeComboSelections(rawSelections, products, { reconcile = 'hydrate' } = {}) {
  if (!Array.isArray(rawSelections) || !rawSelections.length) return [];
  const byCombo = new Map();
  const resolved = new Map(
    resolveCombos(COMBO_MANIFEST, products).map((combo) => [combo.comboId, combo]),
  );
  const live = reconcile === 'live';

  for (const selection of rawSelections) {
    const comboId = typeof selection?.comboId === 'string' ? selection.comboId : '';
    const combo = resolved.get(comboId);
    if (!combo || (!live && !combo.chargeable)) continue;
    const quantity = normalizeCartQuantity(selection.quantity);
    if (quantity <= 0) continue;
    const current = byCombo.get(comboId) || 0;
    byCombo.set(comboId, live ? current + quantity : Math.min(combo.stock, current + quantity));
  }

  return [...byCombo.entries()]
    .filter(([, quantity]) => quantity > 0)
    .map(([comboId, quantity]) => ({ comboId, quantity }));
}

function normalizeCartQuantity(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.floor(numeric));
}

function normalizeLastOrderId(candidate, orders) {
  if (typeof candidate === 'string' && orders.some((order) => order.id === candidate)) {
    return candidate;
  }
  return null;
}

function sanitizeCheckoutDraft(draft) {
  if (!isPlainObject(draft)) return null;
  const deliveryMode = normalizeDeliveryMode(draft.deliveryMode);
  const addressDetails = normalizeAddressDetails(draft);
  return {
    customerName: sanitizeText(draft.customerName, { maxLength: 80 }),
    customerPhone: sanitizeText(draft.customerPhone, { maxLength: 40 }),
    customerStreetAddress: addressDetails.streetLine,
    customerNeighborhood: addressDetails.neighborhood,
    customerReference: addressDetails.reference,
    customerAddress: addressDetails.label,
    addressDetails,
    deliveryMode,
    paymentMethod: normalizePaymentMethod(draft.paymentMethod),
    customerNotes: sanitizeNotes(draft.customerNotes, ''),
    cashChange: sanitizeText(draft.cashChange, { maxLength: 80 }),
    couponCode: sanitizeText(draft.couponCode, { maxLength: 24 }).toUpperCase(),
    rememberCustomer: Boolean(draft.rememberCustomer),
    previewOnly: Boolean(draft.previewOnly),
  };
}

function normalizeCategoryId(value, fallback = 'all', products = []) {
  const categoryId = sanitizeText(value, { fallback, maxLength: 40 });
  if (CUSTOMER_CATEGORY_IDS.has(categoryId)) return categoryId;
  if (products.some((product) => product.categoryId === categoryId)) return categoryId;
  return categories.some((category) => category.id === categoryId) ? categoryId : 'all';
}

function normalizeOrder(order) {
  if (!isPlainObject(order)) return null;

  const id = sanitizeText(order.id, { maxLength: 40 });
  if (!id || !Array.isArray(order.items)) return null;

  const deliveryMode = normalizeDeliveryMode(order.deliveryMode);
  const items = order.items.map(normalizeOrderItem).filter(Boolean);
  const status = normalizeOrderStatus(order.status);
  const createdAt = normalizeIsoDate(order.createdAt);
  const baseTotals = calculateTotals(items, deliveryMode);
  const coupon = normalizeOrderCoupon(order.coupon, baseTotals.subtotal, order.discountTotal);
  const totals = calculateTotals(items, deliveryMode, { discountAmount: coupon?.discountAmount || order.discountTotal || 0 });
  const paymentMethodCode = normalizeOrderPaymentMethodCode(order.paymentMethodCode, order.paymentMethod);
  const delivery = normalizeDelivery(order.delivery, deliveryMode, status);
  const promotionApplications = normalizePromotionApplications(order.promotionApplications);
  const reorder = normalizeOrderReorder(order.reorder);
  const deliveryProof = normalizeDeliveryProof(order.deliveryProof);
  const hasStoredDeliveryCode = order.deliveryCode !== undefined
    && order.deliveryCode !== null
    && order.deliveryCode !== '';
  const deliveryCode = deliveryMode === 'delivery' && hasStoredDeliveryCode
    ? normalizeDeliveryCode(order.deliveryCode)
    : null;
  const addressDetails = deliveryMode === 'pickup'
    ? null
    : normalizeOrderAddressDetails(order);

  const normalized = {
    ...order,
    id,
    customerName: sanitizeText(order.customerName, { fallback: 'Cliente', maxLength: 80 }),
    customerPhone: sanitizeText(order.customerPhone, { maxLength: 40 }),
    address: deliveryMode === 'pickup'
      ? getBusinessConfig().address
      : addressDetails.label || sanitizeText(order.address, { fallback: 'Sin dirección', maxLength: 180 }),
    addressDetails,
    deliveryMode,
    paymentMethodCode,
    paymentMethod: normalizeOrderPaymentLabel(order.paymentMethod, paymentMethodCode),
    notes: sanitizeNotes(order.notes),
    // Defensivo: el cambio en efectivo solo tiene sentido si el método es efectivo.
    // Evita que un estado viejo/corrupto muestre "cambio" con transferencia/MP.
    cashChange: paymentMethodCode === 'cash' ? sanitizeText(order.cashChange, { maxLength: 80 }) : '',
    coupon,
    promotionApplications,
    cancelReason: sanitizeText(order.cancelReason, { maxLength: 160 }),
    createdAt,
    status,
    previewOnly: Boolean(order.previewOnly),
    items,
    subtotal: totals.subtotal,
    discountTotal: totals.discountTotal,
    deliveryFee: totals.deliveryFee,
    total: totals.total,
    statusHistory: normalizeStatusHistory(order.statusHistory, status, createdAt),
    delivery,
  };
  if (reorder) normalized.reorder = reorder;
  else delete normalized.reorder;
  if (deliveryProof) normalized.deliveryProof = deliveryProof;
  else delete normalized.deliveryProof;
  if (deliveryCode) normalized.deliveryCode = deliveryCode;
  else delete normalized.deliveryCode;
  return normalized;
}

function normalizePromotionApplications(rawApplications) {
  if (!Array.isArray(rawApplications)) return [];
  return rawApplications.slice(0, 12).map((application) => {
    if (!isPlainObject(application)) return null;
    const promoId = sanitizeText(application.promoId, { maxLength: 80 });
    const title = sanitizeText(application.title, { maxLength: 80 });
    const discountAmount = normalizeMoneyValue(application.discountAmount, 0);
    if (!promoId || !title) return null;
    return {
      promoId,
      title,
      promotionType: sanitizeText(application.promotionType, { maxLength: 40 }),
      discountAmount,
      matchedQuantity: Math.max(0, Math.floor(Number(application.matchedQuantity) || 0)),
      terms: sanitizeText(application.terms, { maxLength: 240 }),
    };
  }).filter(Boolean);
}

function normalizeOrderItem(item) {
  if (!isPlainObject(item)) return null;
  const productId = sanitizeText(item.productId, { maxLength: 80 });
  const name = sanitizeText(item.name, { maxLength: 100 });
  const rawQuantity = Number(item.quantity);
  const quantity = Number.isFinite(rawQuantity) ? Math.floor(rawQuantity) : 0;
  const rawUnitPrice = Number(item.unitPrice);
  if (!productId || !name || quantity <= 0 || !Number.isFinite(rawUnitPrice) || rawUnitPrice < 0) return null;
  const unitPrice = normalizeMoneyValue(rawUnitPrice, 0);

  return {
    productId,
    name,
    icon: sanitizeText(item.icon, { maxLength: 20 }),
    quantity,
    unitPrice,
    unit: sanitizeText(item.unit, { fallback: 'unidad', maxLength: 40 }),
  };
}

function normalizeOrderReorder(reorder) {
  if (!isPlainObject(reorder)) return null;
  const sourceOrderId = sanitizeText(reorder.sourceOrderId, { fallback: '', maxLength: 80 });
  if (!sourceOrderId) return null;
  return {
    sourceOrderId,
    sourceCreatedAt: reorder.sourceCreatedAt ? normalizeIsoDate(reorder.sourceCreatedAt) : '',
    repeatedAt: normalizeIsoDate(reorder.repeatedAt),
    priceChanged: Boolean(reorder.priceChanged),
    skippedCount: Math.max(0, Math.floor(Number(reorder.skippedCount) || 0)),
    editedBeforeConfirm: Boolean(reorder.editedBeforeConfirm),
  };
}

function normalizeOrderPaymentMethodCode(...values) {
  for (const value of values) {
    const direct = normalizePaymentMethod(value, '');
    if (direct) return direct;
  }
  for (const value of values) {
    const inferred = inferPaymentMethodCode(value);
    if (inferred) return inferred;
  }
  return 'unknown';
}

function inferPaymentMethodCode(value) {
  const label = sanitizeText(value, { fallback: '', maxLength: 80 }).toLowerCase();
  if (!label || label === 'unknown' || label === 'sin especificar') return '';
  if (label.includes('transfer')) return 'transfer';
  if (label.includes('mercado')) return 'mercado_pago_future';
  if (label.includes('cash') || label.includes('efectivo')) return 'cash';
  if (label.includes('link')) return 'mercado_pago_future';
  return '';
}

function normalizeOrderPaymentLabel(value, paymentMethodCode) {
  const label = sanitizeText(value, { fallback: '', maxLength: 80 });
  const direct = normalizePaymentMethod(label, '');
  if (!label || label.toLowerCase() === 'unknown' || label.toLowerCase() === 'sin especificar') {
    return paymentLabel(paymentMethodCode);
  }
  return direct && label === direct ? paymentLabel(direct) : label;
}

function normalizeStatusHistory(history, currentStatus, createdAt) {
  const normalized = Array.isArray(history)
    ? history
        .filter((entry) => entry && isValidOrderStatus(entry.status))
        .map((entry) => ({ status: entry.status, at: normalizeIsoDate(entry.at, createdAt) }))
    : [];

  if (!normalized.length) {
    normalized.push({ status: 'received', at: createdAt });
  }

  if (!normalized.some((entry) => entry.status === currentStatus)) {
    normalized.push({ status: currentStatus, at: createdAt });
  }

  return normalized;
}

function normalizeDelivery(delivery, deliveryMode, status) {
  const source = isPlainObject(delivery) ? delivery : {};
  const delivered = status === 'delivered' || status === 'cancelled' || deliveryMode === 'pickup';
  const estimatedMinutes = delivered ? 0 : Math.max(0, Math.floor(Number(source.estimatedMinutes) || 0));
  const demoDestination = normalizeStreetDestinationId(source.demoDestinationId || source.destinationId);

  return {
    // Sin rider real: "Sin asignar" y teléfono vacío. Nunca un nombre/teléfono falso.
    driverName: sanitizeText(source.driverName, { fallback: 'Sin asignar', maxLength: 80 }),
    driverPhone: sanitizeText(source.driverPhone, { fallback: '', maxLength: 40 }),
    estimatedMinutes,
    estimatedPreparationMinutes: normalizePreparationMinutes(source.estimatedPreparationMinutes, 0),
    currentLocationLabel: sanitizeText(source.currentLocationLabel, {
      fallback: defaultLocationLabel(status, deliveryMode),
      maxLength: 120,
    }),
    ...(source.acceptedAt ? { acceptedAt: normalizeIsoDate(source.acceptedAt) } : {}),
    ...(Number.isFinite(Number(source.distanceKm)) && Number(source.distanceKm) >= 0
      ? { distanceKm: Number(source.distanceKm) }
      : {}),
    ...(demoDestination ? { demoDestinationId: demoDestination } : {}),
    ...(source.demoDestinationLabel ? { demoDestinationLabel: sanitizeText(source.demoDestinationLabel, { maxLength: 80 }) } : {}),
    ...(source.demoDestinationAddressLabel ? { demoDestinationAddressLabel: sanitizeText(source.demoDestinationAddressLabel, { maxLength: 120 }) } : {}),
    ...(source.demoDestinationCity ? { demoDestinationCity: sanitizeText(source.demoDestinationCity, { maxLength: 80 }) } : {}),
    ...(source.destinationUpdatedAt ? { destinationUpdatedAt: normalizeIsoDate(source.destinationUpdatedAt) } : {}),
    ...(Number.isFinite(Number(source.driverRating)) && Number(source.driverRating) > 0
      ? { driverRating: Number(source.driverRating) }
      : {}),
    ...(Number.isFinite(Number(source.driverTrips)) && Number(source.driverTrips) >= 0
      ? { driverTrips: Math.floor(Number(source.driverTrips)) }
      : {}),
    ...(source.leftStoreAt ? { leftStoreAt: normalizeIsoDate(source.leftStoreAt) } : {}),
    ...(source.deliveredAt ? { deliveredAt: normalizeIsoDate(source.deliveredAt) } : {}),
  };
}

function defaultLocationLabel(status, deliveryMode) {
  if (deliveryMode === 'pickup') return 'Pedido para retirar en local';
  if (status === 'ready') return 'Pedido listo en el local';
  if (status === 'on_the_way') return 'El repartidor salió del local';
  if (status === 'arriving') return 'El repartidor está llegando';
  if (status === 'delivered') return 'Pedido entregado';
  if (status === 'cancelled') return 'Pedido cancelado por el negocio';
  return 'Pedido recibido por el local';
}

function normalizeIsoDate(value, fallback = new Date().toISOString()) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function buildBaseProducts() {
  return isDemoMode() ? buildDemoCatalog() : [];
}

function mergeProducts(baseProducts, savedProducts, options = {}) {
  return mergeCatalogProducts(baseProducts, savedProducts, options);
}

function buildBaseBusinessConfig() {
  const base = buildDefaultBusinessConfig();
  if (![APP_MODE_PRODUCTION, APP_MODE_UNAVAILABLE].includes(getAppMode())) return base;
  return mergeBusinessConfig(base, {
    businessName: 'La Taba 2',
    name: 'La Taba 2',
    subtitle: 'Tienda de bebidas',
    address: 'Dirección no publicada',
    deliveryZone: 'Cobertura no publicada',
    openingHoursLabel: 'Horarios no publicados',
    openingHours: 'Horarios no publicados',
    whatsappNumber: '',
    whatsappVerified: false,
    deliveryFee: 0,
    minDeliveryOrder: 0,
    orderingDetailsVerified: false,
    deliveryEnabled: false,
    pickupEnabled: false,
  });
}

function persist() {
  if ([APP_MODE_PRODUCTION, APP_MODE_UNAVAILABLE].includes(getAppMode())) {
    const localStorage = getStorageArea('localStorage');
    safeStorageRemove(localStorage, STORAGE_KEYS.state);
    safeStorageRemove(getStorageArea('sessionStorage'), STORAGE_KEYS.adminUnlocked);
    const merged = mergeProductionCartMutation(productionCartBase, {
      cart: state.cart,
      comboSelections: state.comboSelections,
    }, readProductionCart(localStorage, STORAGE_KEYS.productionCart));
    state = {
      ...state,
      cart: merged.cart,
      comboSelections: merged.comboSelections,
    };
    const persisted = writeProductionCart(localStorage, STORAGE_KEYS.productionCart, merged);
    productionCartBase = merged;
    return persisted;
  }
  const serializable = { ...state, adminUnlocked: undefined };
  let encoded = '';
  try {
    encoded = JSON.stringify(serializable);
  } catch (_) {
    // Una sesión vieja/corrupta no puede impedir que el catálogo inicialice.
    safeStorageRemove(getStorageArea('localStorage'), STORAGE_KEYS.state);
    return false;
  }
  const persisted = safeStorageSet(getStorageArea('localStorage'), STORAGE_KEYS.state, encoded);
  safeStorageSet(getStorageArea('sessionStorage'), STORAGE_KEYS.adminUnlocked, state.adminUnlocked ? 'true' : 'false');
  return persisted;
}

function notify() {
  listeners.forEach((listener) => listener(state));
}

function commitState(nextState, { reconcile = 'live' } = {}) {
  // `live` por defecto: acá el carrito ya está en pantalla. Ver `sanitizeCart`.
  state = sanitizeState(nextState, defaultState(), { reconcile });
  // El holder del config-store refleja siempre la config ya saneada del estado.
  setRuntimeBusinessConfig(state.businessConfig);
  const persisted = persist();
  notify();
  return persisted;
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function normalizeOrderForStorage(order) {
  return normalizeOrder(order);
}

export function getState() {
  return state;
}

export function setState(patch) {
  return commitState({ ...state, ...patch });
}

export { getBusinessConfig };

// Mergea un patch parcial en la config del comercio, lo persiste y notifica.
// No muta productos ni pedidos.
export function updateBusinessConfig(patch) {
  const next = mergeBusinessConfig(state.businessConfig, isPlainObject(patch) ? patch : {});
  commitState({ ...state, businessConfig: next });
  return getBusinessConfig();
}

/**
 * `reconcile` existe por un solo caso, y conviene decirlo acá: en producción la
 * hidratación del carrito está DIFERIDA. Al arrancar todavía no hay catálogo,
 * así que `sanitizeState` no puede validar nada y se limita a la forma; la
 * validación real ocurre cuando llega el primer catálogo verificado, y ese
 * camino entra por acá. Sin poder pedir `hydrate` en ese commit, un carrito
 * guardado en disco con productos agotados volvería a la pantalla como si
 * fueran válidos.
 */
export function updateState(mutator, { reconcile = 'live' } = {}) {
  const draft = structuredCloneSafe(state);
  mutator(draft);
  return commitState(draft, { reconcile });
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function money(value) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: getBusinessConfig().currency,
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

export function dateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function statusLabel(status) {
  return ORDER_STATUS_LABELS[status] || status;
}

export function statusClass(status) {
  return ORDER_STATUS_CLASSES[status] || 'received';
}

export function paymentLabel(value) {
  const labels = {
    coordinate: 'Pago a coordinar con el local',
    cash: 'Efectivo',
    transfer: 'Transferencia',
    mercado_pago_future: 'Mercado Pago',
    unknown: 'Sin especificar',
  };
  return labels[value] || value;
}

export function deliveryModeLabel(value) {
  return normalizeDeliveryMode(value) === 'pickup' ? 'Retiro en local' : 'Envío a domicilio';
}

export function createOrderId() {
  const prefix = getBusinessConfig().orderPrefix;
  const highest = getState().orders.reduce((max, order) => {
    const match = typeof order.id === 'string' && order.id.startsWith(`${prefix}-`)
      ? Number.parseInt(order.id.slice(prefix.length + 1), 10)
      : NaN;
    return Number.isFinite(match) && match > max ? match : max;
  }, 0);
  return `${prefix}-${String(highest + 1).padStart(4, '0')}`;
}

export function getProductById(productId) {
  return getState().products.find((product) => product.id === productId) || null;
}

export { getDeliveryFeeForMode };
