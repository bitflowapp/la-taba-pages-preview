import { BUSINESS_CONFIG, STORAGE_KEYS } from './config.js';
import { categories, PREVIEW_CATALOG_VERSION, seedOrders } from './data.js';
import { buildDemoCatalog, mergeCatalogProducts } from './core/catalog-store.js';
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
    // Pedidos, carrito y catálogo productivos sólo viven en memoria y se
    // reconstruyen desde Supabase. Nunca renderizar PII operativa cacheada.
    resetIncompatiblePersistence(localStorage, getStorageArea('sessionStorage'));
    return { ...base, adminUnlocked: false };
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

export function hydrateState(savedState, baseState = defaultState(), { refreshBaseCatalog = false } = {}) {
  return sanitizeState(
    { ...baseState, ...(isPlainObject(savedState) ? savedState : {}) },
    baseState,
    { refreshBaseCatalog },
  );
}

export function sanitizeState(nextState, baseState = defaultState(), { refreshBaseCatalog = false } = {}) {
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

  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    dataVersion: APP_DATA_VERSION,
    catalogVersion: baseState.appMode === 'demo' ? PREVIEW_CATALOG_VERSION : '',
    appMode: baseState.appMode || getAppMode(),
    activeCategory: normalizeCategoryId(source.activeCategory, baseState.activeCategory || 'all', mergedProducts),
    searchQuery: sanitizeText(source.searchQuery, { fallback: '', maxLength: 80 }),
    sortBy: normalizeSortBy(source.sortBy),
    catalogFilters: normalizeCatalogFilters(source.catalogFilters),
    cart: sanitizeCart(source.cart, productMap),
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

function sanitizeCart(rawCart, productMap) {
  if (!Array.isArray(rawCart)) return [];
  const byProduct = new Map();

  for (const item of rawCart) {
    if (!item || typeof item.productId !== 'string') continue;
    const product = productMap.get(item.productId);
    if (!product || product.archived || !product.available || product.stock <= 0) continue;

    const quantity = normalizeCartQuantity(item.quantity);
    if (quantity <= 0) continue;

    const current = byProduct.get(item.productId) || 0;
    byProduct.set(item.productId, Math.min(product.stock, current + quantity));
  }

  return [...byProduct.entries()].map(([productId, quantity]) => ({ productId, quantity }));
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
    safeStorageRemove(getStorageArea('localStorage'), STORAGE_KEYS.state);
    safeStorageRemove(getStorageArea('sessionStorage'), STORAGE_KEYS.adminUnlocked);
    return true;
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

function commitState(nextState) {
  state = sanitizeState(nextState, defaultState());
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

export function updateState(mutator) {
  const draft = structuredCloneSafe(state);
  mutator(draft);
  return commitState(draft);
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
