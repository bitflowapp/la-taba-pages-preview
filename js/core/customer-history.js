import { STORAGE_KEYS } from '../config.js';
import { isProductOrderable } from './catalog-store.js';
import { normalizeMoneyValue, normalizeQuantity } from './pricing.js';
import {
  getStorageArea,
  safeJsonParse,
  safeStorageGet,
  safeStorageSet,
} from './storage.js';
import { normalizePaymentMethod, sanitizeNotes, sanitizeText } from './validators.js';

export const CUSTOMER_HISTORY_LIMIT = 8;

let memoryHistory = [];

export function recordCustomerOrder(order) {
  const snapshot = normalizeCustomerOrder(order);
  if (!snapshot) {
    return { ok: false, history: getCustomerOrderHistory(), message: 'Pedido inválido.' };
  }
  const current = getCustomerOrderHistory().filter((entry) => entry.id !== snapshot.id);
  const history = [snapshot, ...current].slice(0, CUSTOMER_HISTORY_LIMIT);
  persistHistory(history);
  return { ok: true, order: snapshot, history };
}

export function updateCustomerOrderSnapshot(order) {
  const current = getCustomerOrderHistory();
  if (!current.some((entry) => entry.id === order?.id)) return false;
  return recordCustomerOrder(order).ok;
}

export function getCustomerOrderHistory() {
  const stored = readHistoryFromStorage();
  memoryHistory = stored;
  return stored;
}

export function getLatestCustomerOrder() {
  return getCustomerOrderHistory()[0] || null;
}

export function findCustomerOrder(orderId) {
  const cleanOrderId = sanitizeText(orderId, { fallback: '', maxLength: 80 });
  if (!cleanOrderId) return null;
  return getCustomerOrderHistory().find((order) => order.id === cleanOrderId) || null;
}

export function resolveRepeatOrderItems(order, products = []) {
  const productMap = new Map((Array.isArray(products) ? products : []).map((product) => [product.id, product]));
  const cartItems = [];
  const skipped = [];

  const items = Array.isArray(order?.items) ? order.items : [];
  for (const item of items) {
    const productId = sanitizeText(item.productId, { fallback: '', maxLength: 80 });
    const quantity = normalizeQuantity(item.quantity, 1);
    const product = productMap.get(productId);

    if (!isProductOrderable(product)) {
      skipped.push({
        productId,
        name: sanitizeText(item.name || product?.name, { fallback: 'Producto', maxLength: 100 }),
        reason: 'no disponible',
      });
      continue;
    }
    if (quantity > product.stock) {
      skipped.push({
        productId,
        name: sanitizeText(product.name || item.name, { fallback: 'Producto', maxLength: 100 }),
        reason: `stock disponible: ${product.stock}`,
      });
      continue;
    }
    cartItems.push({ productId, quantity });
  }

  return { cartItems, skipped };
}

export function clearCustomerHistoryForTests() {
  persistHistory([]);
}

function normalizeCustomerOrder(order) {
  if (!order || typeof order !== 'object') return null;
  const id = sanitizeText(order.id, { fallback: '', maxLength: 80 });
  if (!id || !Array.isArray(order.items)) return null;
  const items = order.items.map(normalizeCustomerOrderItem).filter(Boolean);
  if (!items.length) return null;
  const coupon = normalizeHistoryCoupon(order);

  return {
    id,
    createdAt: normalizeIso(order.createdAt),
    status: sanitizeText(order.status, { fallback: 'received', maxLength: 40 }),
    customerName: sanitizeText(order.customerName, { maxLength: 80 }),
    deliveryMode: order.deliveryMode === 'pickup' ? 'pickup' : 'delivery',
    paymentMethod: sanitizeText(order.paymentMethod, { fallback: 'Efectivo', maxLength: 80 }),
    paymentMethodCode: normalizePaymentMethod(order.paymentMethodCode),
    notes: sanitizeNotes(order.notes, 'Sin notas'),
    address: sanitizeText(order.address, { maxLength: 180 }),
    addressDetails: normalizeHistoryAddress(order.addressDetails),
    cashChange: sanitizeText(order.cashChange, { fallback: '', maxLength: 80 }),
    items,
    subtotal: normalizeMoneyValue(order.subtotal, 0),
    deliveryFee: normalizeMoneyValue(order.deliveryFee, 0),
    discountTotal: normalizeMoneyValue(order.discountTotal, 0),
    total: normalizeMoneyValue(order.total, 0),
    ...(coupon ? { coupon } : {}),
    ...(order.cancelReason ? { cancelReason: sanitizeText(order.cancelReason, { maxLength: 160 }) } : {}),
  };
}

function normalizeCustomerOrderItem(item) {
  if (!item || typeof item !== 'object') return null;
  const productId = sanitizeText(item.productId, { fallback: '', maxLength: 80 });
  const name = sanitizeText(item.name, { fallback: 'Producto', maxLength: 100 });
  if (!productId || !name) return null;
  return {
    productId,
    name,
    quantity: normalizeQuantity(item.quantity, 1),
    unitPrice: normalizeMoneyValue(item.unitPrice, 0),
    unit: sanitizeText(item.unit, { fallback: 'unidad', maxLength: 40 }),
  };
}

function normalizeHistoryAddress(addressDetails) {
  if (!addressDetails || typeof addressDetails !== 'object') return null;
  return {
    streetLine: sanitizeText(addressDetails.streetLine, { maxLength: 120 }),
    neighborhood: sanitizeText(addressDetails.neighborhood, { maxLength: 80 }),
    reference: sanitizeText(addressDetails.reference, { maxLength: 180 }),
    label: sanitizeText(addressDetails.label, { maxLength: 180 }),
    usesStructured: Boolean(addressDetails.usesStructured),
  };
}

function normalizeHistoryCoupon(order) {
  const coupon = order?.coupon && typeof order.coupon === 'object' ? order.coupon : null;
  const code = sanitizeText(coupon?.code || order?.couponCode, { fallback: '', maxLength: 24 }).toUpperCase();
  const discountAmount = normalizeMoneyValue(coupon?.discountAmount ?? order?.discountTotal, 0);
  if (!code || discountAmount <= 0) return null;
  return {
    code,
    discountPercent: Math.max(0, Math.floor(Number(coupon?.discountPercent) || 0)),
    discountAmount,
  };
}

function readHistoryFromStorage() {
  const storage = getStorageArea('localStorage');
  const raw = safeStorageGet(storage, STORAGE_KEYS.customerHistory);
  if (raw == null) return memoryHistory.slice();
  const parsed = safeJsonParse(raw, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.map(normalizeCustomerOrder).filter(Boolean).slice(0, CUSTOMER_HISTORY_LIMIT);
}

function persistHistory(history) {
  memoryHistory = (Array.isArray(history) ? history : []).map(normalizeCustomerOrder).filter(Boolean).slice(0, CUSTOMER_HISTORY_LIMIT);
  safeStorageSet(
    getStorageArea('localStorage'),
    STORAGE_KEYS.customerHistory,
    JSON.stringify(memoryHistory),
  );
}

function normalizeIso(value, fallback = new Date().toISOString()) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}
