import { BUSINESS_CONFIG, STORAGE_KEYS } from './config.js';
import { categories, seedOrders } from './data.js';
import { buildDemoCatalog, mergeCatalogProducts } from './core/catalog-store.js';
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
import { normalizeOrderCoupon } from './core/promotions.js';
import {
  getStorageArea,
  safeJsonParse,
  safeStorageGet,
  safeStorageSet,
} from './core/storage.js';
import { normalizePaymentMethod, sanitizeNotes, sanitizeText } from './core/validators.js';
import { clampProgress } from './core/simulation.js';
import { normalizeAddressDetails, normalizeOrderAddressDetails } from './core/address.js';

export const STATE_SCHEMA_VERSION = 1;

export const SORT_OPTIONS = Object.freeze(['recommended', 'price_asc', 'popular']);

const listeners = new Set();
const STREET_DESTINATION_IDS = new Set(
  (BUSINESS_CONFIG.demoStreetTestDestinations || []).map((destination) => destination.id),
);
const CUSTOMER_CATEGORY_IDS = new Set(['favorites']);

const defaultState = () => {
  const baseProducts = buildBaseProducts();
  const baseOrders = seedOrders.map((order) => normalizeOrder(order)).filter(Boolean);

  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    activeCategory: 'all',
    searchQuery: '',
    sortBy: 'recommended',
    cart: [],
    orders: baseOrders,
    products: baseProducts,
    lastOrderId: null,
    adminUnlocked: readAdminFlag(),
    lastCheckoutDraft: null,
    simulation: null,
  };
};

let state = loadState();

function readAdminFlag() {
  return safeStorageGet(getStorageArea('sessionStorage'), STORAGE_KEYS.adminUnlocked) === 'true';
}

function loadState() {
  const base = defaultState();
  const raw = safeStorageGet(getStorageArea('localStorage'), STORAGE_KEYS.state);
  const parsed = safeJsonParse(raw, null);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ...base, adminUnlocked: readAdminFlag() };
  }

  return { ...hydrateState(parsed, base), adminUnlocked: readAdminFlag() };
}

export function hydrateState(savedState, baseState = defaultState()) {
  return sanitizeState({ ...baseState, ...(isPlainObject(savedState) ? savedState : {}) }, baseState);
}

export function sanitizeState(nextState, baseState = defaultState()) {
  const source = isPlainObject(nextState) ? nextState : {};
  const baseProducts = buildBaseProducts();
  const mergedProducts = mergeProducts(baseProducts, Array.isArray(source.products) ? source.products : baseState.products);
  const productMap = new Map(mergedProducts.map((product) => [product.id, product]));
  const orders = sanitizeOrders(Array.isArray(source.orders) ? source.orders : baseState.orders);
  const lastOrderId = normalizeLastOrderId(source.lastOrderId, orders);

  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    activeCategory: normalizeCategoryId(source.activeCategory, baseState.activeCategory || 'all'),
    searchQuery: sanitizeText(source.searchQuery, { fallback: '', maxLength: 80 }),
    sortBy: normalizeSortBy(source.sortBy),
    cart: sanitizeCart(source.cart, productMap),
    orders,
    products: mergedProducts,
    lastOrderId,
    adminUnlocked: Boolean(source.adminUnlocked),
    lastCheckoutDraft: sanitizeCheckoutDraft(source.lastCheckoutDraft),
    simulation: sanitizeSimulation(source.simulation, orders),
  };
}

function normalizeSortBy(value) {
  const candidate = sanitizeText(value, { fallback: 'recommended', maxLength: 24 });
  return SORT_OPTIONS.includes(candidate) ? candidate : 'recommended';
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
  const progress = clampProgress(raw.progress);
  const destinationId = normalizeStreetDestinationId(raw.destinationId || raw.demoDestinationId || raw.routeId);

  return {
    orderId,
    running: Boolean(raw.running),
    mode: raw.mode === 'gps' ? 'gps' : 'demo',
    source: raw.source === 'gps' ? 'gps' : 'simulation',
    routeId: sanitizeText(raw.routeId, { fallback: destinationId || 'neuquen', maxLength: 60 }),
    ...(destinationId ? { destinationId } : {}),
    progress,
    baseEta,
    etaMinutes: Math.max(0, Math.floor(Number(raw.etaMinutes) || 0)),
    startedAt: normalizeIsoDate(raw.startedAt),
    timestamp: Math.max(0, Number(raw.timestamp) || 0),
    lastFixAt: normalizeIsoDate(raw.lastFixAt || raw.timestamp || raw.startedAt),
    gpsStatus: sanitizeText(raw.gpsStatus, { fallback: 'inactive', maxLength: 40 }),
    ...(raw.gpsRequestedAt ? { gpsRequestedAt: normalizeIsoDate(raw.gpsRequestedAt) } : {}),
    ...(raw.lastGpsFixAt ? { lastGpsFixAt: normalizeIsoDate(raw.lastGpsFixAt) } : {}),
    ...(raw.lastGpsPublishedAt ? { lastGpsPublishedAt: normalizeIsoDate(raw.lastGpsPublishedAt) } : {}),
    ...(raw.lastPublishedAt ? { lastPublishedAt: normalizeIsoDate(raw.lastPublishedAt) } : {}),
    ...(raw.lastBackendPublishAt ? { lastBackendPublishAt: normalizeIsoDate(raw.lastBackendPublishAt) } : {}),
    ...(raw.lastSentSource ? { lastSentSource: raw.lastSentSource === 'gps' ? 'gps' : 'simulation' } : {}),
    ...(raw.streetMode ? { streetMode: true } : {}),
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
  };
}

function normalizeCategoryId(value, fallback = 'all') {
  const categoryId = sanitizeText(value, { fallback, maxLength: 40 });
  if (CUSTOMER_CATEGORY_IDS.has(categoryId)) return categoryId;
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
  const delivery = normalizeDelivery(order.delivery, deliveryMode, status);
  const addressDetails = deliveryMode === 'pickup'
    ? null
    : normalizeOrderAddressDetails(order);

  return {
    ...order,
    id,
    customerName: sanitizeText(order.customerName, { fallback: 'Cliente', maxLength: 80 }),
    customerPhone: sanitizeText(order.customerPhone, { maxLength: 40 }),
    address: deliveryMode === 'pickup'
      ? BUSINESS_CONFIG.address
      : addressDetails.label || sanitizeText(order.address, { fallback: 'Sin dirección', maxLength: 180 }),
    addressDetails,
    deliveryMode,
    paymentMethodCode: normalizeOrderPaymentMethodCode(order.paymentMethodCode || order.paymentMethod),
    paymentMethod: sanitizeText(order.paymentMethod, { fallback: paymentLabel(normalizePaymentMethod(order.paymentMethod)), maxLength: 80 }),
    notes: sanitizeNotes(order.notes),
    cashChange: sanitizeText(order.cashChange, { maxLength: 80 }),
    coupon,
    cancelReason: sanitizeText(order.cancelReason, { maxLength: 160 }),
    createdAt,
    status,
    items,
    subtotal: totals.subtotal,
    discountTotal: totals.discountTotal,
    deliveryFee: totals.deliveryFee,
    total: totals.total,
    statusHistory: normalizeStatusHistory(order.statusHistory, status, createdAt),
    delivery,
  };
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

function normalizeOrderPaymentMethodCode(value) {
  const direct = normalizePaymentMethod(value, '');
  if (direct) return direct;
  const label = sanitizeText(value, { fallback: '', maxLength: 80 }).toLowerCase();
  if (label.includes('transfer')) return 'transfer';
  if (label.includes('mercado')) return 'mercado_pago_future';
  return 'cash';
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
  return buildDemoCatalog();
}

function mergeProducts(baseProducts, savedProducts) {
  return mergeCatalogProducts(baseProducts, savedProducts);
}

function persist() {
  const serializable = { ...state, adminUnlocked: undefined };
  safeStorageSet(getStorageArea('localStorage'), STORAGE_KEYS.state, JSON.stringify(serializable));
  safeStorageSet(getStorageArea('sessionStorage'), STORAGE_KEYS.adminUnlocked, state.adminUnlocked ? 'true' : 'false');
}

function notify() {
  listeners.forEach((listener) => listener(state));
}

function commitState(nextState) {
  state = sanitizeState(nextState, defaultState());
  persist();
  notify();
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
  commitState({ ...state, ...patch });
}

export function updateState(mutator) {
  const draft = structuredCloneSafe(state);
  mutator(draft);
  commitState(draft);
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function money(value) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: BUSINESS_CONFIG.currency,
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
    cash: 'Efectivo',
    transfer: 'Transferencia',
    mercado_pago_future: 'Mercado Pago',
  };
  return labels[value] || value;
}

export function deliveryModeLabel(value) {
  return normalizeDeliveryMode(value) === 'pickup' ? 'Retiro en local' : 'Envío a domicilio';
}

export function createOrderId() {
  const prefix = BUSINESS_CONFIG.orderPrefix;
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
