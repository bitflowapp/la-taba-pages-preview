import { BUSINESS_CONFIG, STORAGE_KEYS } from './config.js';
import { categories, products, seedOrders } from './data.js';
import {
  ORDER_STATUS_CLASSES,
  ORDER_STATUS_LABELS,
  isValidOrderStatus,
  normalizeOrderStatus,
} from './core/order-status.js';
import {
  calculateTotals,
  getDeliveryFeeForMode,
  normalizeDeliveryMode,
  normalizeMoneyValue,
  normalizeStock,
} from './core/pricing.js';
import {
  getStorageArea,
  safeJsonParse,
  safeStorageGet,
  safeStorageSet,
} from './core/storage.js';
import { normalizePaymentMethod, sanitizeNotes, sanitizeText } from './core/validators.js';

export const STATE_SCHEMA_VERSION = 1;

const listeners = new Set();

const defaultState = () => {
  const baseProducts = buildBaseProducts();
  const baseOrders = seedOrders.map((order) => normalizeOrder(order)).filter(Boolean);

  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    activeCategory: 'all',
    searchQuery: '',
    cart: [],
    orders: baseOrders,
    products: baseProducts,
    lastOrderId: baseOrders[0]?.id || null,
    adminUnlocked: readAdminFlag(),
    lastCheckoutDraft: null,
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
    cart: sanitizeCart(source.cart, productMap),
    orders,
    products: mergedProducts,
    lastOrderId,
    adminUnlocked: Boolean(source.adminUnlocked),
    lastCheckoutDraft: sanitizeCheckoutDraft(source.lastCheckoutDraft),
  };
}

function sanitizeOrders(rawOrders) {
  if (!Array.isArray(rawOrders)) return [];
  return rawOrders.map((order) => normalizeOrder(order)).filter(Boolean);
}

function sanitizeCart(rawCart, productMap) {
  if (!Array.isArray(rawCart)) return [];
  const byProduct = new Map();

  for (const item of rawCart) {
    if (!item || typeof item.productId !== 'string') continue;
    const product = productMap.get(item.productId);
    if (!product || !product.available || product.stock <= 0) continue;

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
  return orders[0]?.id || null;
}

function sanitizeCheckoutDraft(draft) {
  if (!isPlainObject(draft)) return null;
  const deliveryMode = normalizeDeliveryMode(draft.deliveryMode);
  return {
    customerName: sanitizeText(draft.customerName, { maxLength: 80 }),
    customerPhone: sanitizeText(draft.customerPhone, { maxLength: 40 }),
    customerAddress: sanitizeText(draft.customerAddress, { maxLength: 180 }),
    deliveryMode,
    paymentMethod: normalizePaymentMethod(draft.paymentMethod),
    customerNotes: sanitizeNotes(draft.customerNotes, ''),
  };
}

function normalizeCategoryId(value, fallback = 'all') {
  const categoryId = sanitizeText(value, { fallback, maxLength: 40 });
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
  const totals = calculateTotals(items, deliveryMode);
  const delivery = normalizeDelivery(order.delivery, deliveryMode, status);

  return {
    ...order,
    id,
    customerName: sanitizeText(order.customerName, { fallback: 'Cliente', maxLength: 80 }),
    customerPhone: sanitizeText(order.customerPhone, { maxLength: 40 }),
    address: deliveryMode === 'pickup'
      ? BUSINESS_CONFIG.address
      : sanitizeText(order.address, { fallback: 'Sin dirección', maxLength: 180 }),
    deliveryMode,
    paymentMethod: sanitizeText(order.paymentMethod, { fallback: paymentLabel(normalizePaymentMethod(order.paymentMethod)), maxLength: 80 }),
    notes: sanitizeNotes(order.notes),
    createdAt,
    status,
    items,
    subtotal: totals.subtotal,
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

  return {
    driverName: sanitizeText(source.driverName, { fallback: deliveryMode === 'pickup' ? 'Sin asignar' : 'Juli', maxLength: 80 }),
    driverPhone: sanitizeText(source.driverPhone, { fallback: deliveryMode === 'pickup' ? '' : '2991112233', maxLength: 40 }),
    estimatedMinutes,
    currentLocationLabel: sanitizeText(source.currentLocationLabel, {
      fallback: defaultLocationLabel(status, deliveryMode),
      maxLength: 120,
    }),
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
  return products.map(normalizeBaseProduct);
}

function normalizeBaseProduct(product) {
  return {
    ...product,
    price: normalizeMoneyValue(product.price, 0),
    oldPrice: product.oldPrice == null ? undefined : normalizeMoneyValue(product.oldPrice, 0),
    stock: normalizeStock(product.stock),
    available: product.available !== false,
    featured: Boolean(product.featured),
  };
}

function mergeProducts(baseProducts, savedProducts) {
  const savedById = new Map(
    (Array.isArray(savedProducts) ? savedProducts : [])
      .filter((item) => item && typeof item.id === 'string')
      .map((item) => [item.id, item]),
  );

  return baseProducts.map((baseProduct) => {
    const saved = savedById.get(baseProduct.id);
    if (!saved) return { ...baseProduct };
    return {
      ...baseProduct,
      stock: normalizeStock(saved.stock ?? baseProduct.stock),
      available: typeof saved.available === 'boolean' ? saved.available : baseProduct.available,
    };
  });
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
    mercado_pago_future: 'Mercado Pago a futuro',
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
