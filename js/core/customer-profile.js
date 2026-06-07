import { STORAGE_KEYS } from '../config.js';
import { normalizeOrderAddressDetails } from './address.js';
import { calculateLoyaltyProgress, loyaltyProgressCopy } from './loyalty.js';
import { normalizeDeliveryMode, normalizeMoneyValue, normalizeQuantity } from './pricing.js';
import {
  getStorageArea,
  safeJsonParse,
  safeStorageGet,
  safeStorageSet,
} from './storage.js';
import { normalizePaymentMethod, sanitizeNotes, sanitizeText } from './validators.js';

export const CUSTOMER_PROFILE_VERSION = 1;
export const CUSTOMER_PROFILE_ORDER_LIMIT = 20;

let memoryProfile = null;

export function customerIdentityKey(value) {
  const phone = normalizePhone(value?.customerPhone || value?.phone || value?.customer?.phone);
  if (phone) return `phone:${phone}`;
  const name = sanitizeText(value?.customerName || value?.name || value?.customer?.name, { fallback: '', maxLength: 80 }).toLowerCase();
  return name ? `name:${name}` : '';
}

export function getCustomerProfile() {
  const stored = readProfileFromStorage();
  memoryProfile = stored;
  return stored;
}

export function getRememberedCheckoutValues(profile = getCustomerProfile()) {
  const normalized = normalizeCustomerProfile(profile);
  if (!normalized?.rememberCustomer) return null;
  return {
    customerName: normalized.name,
    customerPhone: normalized.phone,
    customerStreetAddress: normalized.addressDetails?.streetLine || '',
    customerNeighborhood: normalized.addressDetails?.neighborhood || '',
    customerReference: normalized.addressDetails?.reference || normalized.reference || '',
    customerAddress: normalized.address || '',
    addressDetails: normalized.addressDetails,
    rememberCustomer: true,
  };
}

export function rememberCustomerProfileFromOrder(order, options = {}) {
  if (!options.rememberCustomer) {
    return { ok: true, remembered: false, profile: getCustomerProfile() };
  }

  const snapshot = normalizeProfileOrder(order);
  if (!snapshot) return { ok: false, remembered: false, message: 'Pedido invalido.' };

  const current = getCustomerProfile();
  const currentOrders = current?.identityKey === snapshot.identityKey ? current.orders : [];
  const orders = [snapshot, ...currentOrders.filter((entry) => entry.id !== snapshot.id)]
    .map(normalizeProfileOrder)
    .filter(Boolean)
    .slice(0, CUSTOMER_PROFILE_ORDER_LIMIT);
  const profile = normalizeCustomerProfile({
    schemaVersion: CUSTOMER_PROFILE_VERSION,
    rememberCustomer: true,
    consentAcceptedAt: normalizeIso(options.consentAcceptedAt || new Date().toISOString()),
    identityKey: snapshot.identityKey,
    name: snapshot.customerName,
    phone: snapshot.customerPhone,
    address: snapshot.address,
    addressDetails: snapshot.addressDetails,
    reference: snapshot.addressDetails?.reference || '',
    orders,
    updatedAt: normalizeIso(options.updatedAt || new Date().toISOString()),
  });

  persistProfile(profile);
  return { ok: true, remembered: true, profile };
}

export function updateCustomerProfileOrderSnapshot(order) {
  const current = getCustomerProfile();
  if (!current?.rememberCustomer || !Array.isArray(current.orders)) return false;
  if (!current.orders.some((entry) => entry.id === order?.id)) return false;
  return rememberCustomerProfileFromOrder(order, {
    rememberCustomer: true,
    consentAcceptedAt: current.consentAcceptedAt,
  }).ok;
}

export function normalizeCustomerProfile(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const orders = Array.isArray(raw.orders)
    ? raw.orders.map(normalizeProfileOrder).filter(Boolean)
    : [];
  const latest = orders[0] || null;
  const identityKey = sanitizeText(raw.identityKey || latest?.identityKey || customerIdentityKey(raw), {
    fallback: '',
    maxLength: 120,
  });
  if (!identityKey && !orders.length) return null;

  const stats = summarizeCustomerOrders(orders);
  const addressDetails = normalizeProfileAddress(raw.addressDetails || latest?.addressDetails);
  return {
    schemaVersion: CUSTOMER_PROFILE_VERSION,
    rememberCustomer: raw.rememberCustomer !== false,
    consentAcceptedAt: normalizeIso(raw.consentAcceptedAt || raw.acceptedAt || latest?.createdAt),
    identityKey,
    name: sanitizeText(raw.name || latest?.customerName, { fallback: '', maxLength: 80 }),
    phone: sanitizeText(raw.phone || latest?.customerPhone, { fallback: '', maxLength: 40 }),
    address: sanitizeText(raw.address || latest?.address, { fallback: '', maxLength: 180 }),
    addressDetails,
    reference: sanitizeText(raw.reference || addressDetails?.reference || '', { fallback: '', maxLength: 180 }),
    orderCount: stats.orderCount,
    totalSpent: stats.totalSpent,
    lastOrderAt: stats.lastOrderAt,
    lastOrder: latest,
    topProducts: stats.topProducts,
    orders,
    loyalty: calculateLoyaltyProgress(stats.orderCount),
    loyaltyCopy: loyaltyProgressCopy(calculateLoyaltyProgress(stats.orderCount)),
    updatedAt: normalizeIso(raw.updatedAt || latest?.createdAt),
  };
}

export function normalizeProfileOrder(order) {
  if (!order || typeof order !== 'object' || Array.isArray(order)) return null;
  const id = sanitizeText(order.id || order.orderId, { fallback: '', maxLength: 80 });
  const items = Array.isArray(order.items) ? order.items.map(normalizeProfileOrderItem).filter(Boolean) : [];
  if (!id || !items.length) return null;
  const addressDetails = normalizeProfileAddress(order.addressDetails || normalizeOrderAddressDetails(order));
  const customerName = sanitizeText(order.customerName || order.name, { fallback: 'Cliente', maxLength: 80 });
  const customerPhone = sanitizeText(order.customerPhone || order.phone, { fallback: '', maxLength: 40 });
  const identityKey = customerIdentityKey({ customerName, customerPhone });

  return {
    id,
    identityKey,
    createdAt: normalizeIso(order.createdAt),
    status: sanitizeText(order.status, { fallback: 'received', maxLength: 40 }),
    customerName,
    customerPhone,
    address: sanitizeText(order.address || addressDetails?.label, { fallback: '', maxLength: 180 }),
    addressDetails,
    deliveryMode: normalizeDeliveryMode(order.deliveryMode),
    paymentMethod: sanitizeText(order.paymentMethod, { fallback: 'Efectivo', maxLength: 80 }),
    paymentMethodCode: normalizePaymentMethod(order.paymentMethodCode),
    notes: sanitizeNotes(order.notes, 'Sin notas'),
    total: normalizeMoneyValue(order.total, 0),
    subtotal: normalizeMoneyValue(order.subtotal, 0),
    deliveryFee: normalizeMoneyValue(order.deliveryFee, 0),
    discountTotal: normalizeMoneyValue(order.discountTotal, 0),
    items,
    ...(order.reorder?.sourceOrderId ? { reorder: normalizeOrderReorder(order.reorder) } : {}),
  };
}

export function buildCustomerSignals(orders = [], order = null, now = new Date()) {
  const normalizedOrder = normalizeProfileOrder(order);
  if (!normalizedOrder) return emptyCustomerSignals();
  const identityKey = normalizedOrder.identityKey;
  if (!identityKey) return emptyCustomerSignals();

  const matching = (Array.isArray(orders) ? orders : [])
    .map(normalizeProfileOrder)
    .filter((entry) => entry && entry.identityKey === identityKey && entry.status !== 'cancelled');
  if (!matching.some((entry) => entry.id === normalizedOrder.id) && normalizedOrder.status !== 'cancelled') {
    matching.push(normalizedOrder);
  }
  matching.sort((a, b) => orderTime(a) - orderTime(b) || a.id.localeCompare(b.id));

  const currentIndex = matching.findIndex((entry) => entry.id === normalizedOrder.id);
  const previousOrders = currentIndex >= 0
    ? matching.slice(0, currentIndex)
    : matching.filter((entry) => entry.id !== normalizedOrder.id);
  const orderCount = normalizedOrder.status === 'cancelled' ? previousOrders.length : previousOrders.length + 1;
  const lastPreviousOrder = previousOrders[previousOrders.length - 1] || null;
  const loyalty = calculateLoyaltyProgress(orderCount);

  return {
    identityKey,
    customerName: normalizedOrder.customerName,
    customerPhone: normalizedOrder.customerPhone,
    isNewCustomer: previousOrders.length === 0,
    isRecurringCustomer: previousOrders.length > 0,
    previousOrderCount: previousOrders.length,
    orderCount,
    totalSpent: summarizeCustomerOrders(matching).totalSpent,
    lastPreviousOrderAt: lastPreviousOrder?.createdAt || '',
    lastPreviousOrderLabel: formatDaysAgo(lastPreviousOrder?.createdAt, now),
    topProducts: summarizeCustomerOrders(matching).topProducts,
    loyalty,
    loyaltyCopy: loyaltyProgressCopy(loyalty),
    benefitAvailable: loyalty.benefitAvailable,
    isRepeatedOrder: Boolean(normalizedOrder.reorder?.sourceOrderId),
    repeatedFromOrderId: normalizedOrder.reorder?.sourceOrderId || '',
  };
}

export function clearCustomerProfileForTests() {
  persistProfile(null);
}

function summarizeCustomerOrders(orders = []) {
  const validOrders = (Array.isArray(orders) ? orders : [])
    .map(normalizeProfileOrder)
    .filter((order) => order && order.status !== 'cancelled');
  const productTally = new Map();
  let totalSpent = 0;
  let lastOrderAt = '';

  for (const order of validOrders) {
    totalSpent += normalizeMoneyValue(order.total, 0);
    if (!lastOrderAt || orderTime(order) > orderTime({ createdAt: lastOrderAt })) {
      lastOrderAt = order.createdAt;
    }
    for (const item of order.items) {
      const current = productTally.get(item.productId) || {
        productId: item.productId,
        name: item.name,
        quantity: 0,
        orderCount: 0,
      };
      current.quantity += item.quantity;
      current.orderCount += 1;
      productTally.set(item.productId, current);
    }
  }

  return {
    orderCount: validOrders.length,
    totalSpent,
    lastOrderAt,
    topProducts: [...productTally.values()]
      .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name))
      .slice(0, 5),
  };
}

function normalizeProfileOrderItem(item) {
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

function normalizeProfileAddress(addressDetails) {
  if (!addressDetails || typeof addressDetails !== 'object') return null;
  return {
    streetLine: sanitizeText(addressDetails.streetLine, { fallback: '', maxLength: 120 }),
    neighborhood: sanitizeText(addressDetails.neighborhood, { fallback: '', maxLength: 80 }),
    reference: sanitizeText(addressDetails.reference, { fallback: '', maxLength: 180 }),
    label: sanitizeText(addressDetails.label, { fallback: '', maxLength: 180 }),
    usesStructured: Boolean(addressDetails.usesStructured),
  };
}

function normalizeOrderReorder(reorder) {
  if (!reorder || typeof reorder !== 'object') return null;
  const sourceOrderId = sanitizeText(reorder.sourceOrderId, { fallback: '', maxLength: 80 });
  if (!sourceOrderId) return null;
  return {
    sourceOrderId,
    sourceCreatedAt: normalizeIso(reorder.sourceCreatedAt, ''),
    repeatedAt: normalizeIso(reorder.repeatedAt),
    priceChanged: Boolean(reorder.priceChanged),
    skippedCount: Math.max(0, Math.floor(Number(reorder.skippedCount) || 0)),
    editedBeforeConfirm: Boolean(reorder.editedBeforeConfirm),
  };
}

function emptyCustomerSignals() {
  const loyalty = calculateLoyaltyProgress(0);
  return {
    identityKey: '',
    customerName: '',
    customerPhone: '',
    isNewCustomer: true,
    isRecurringCustomer: false,
    previousOrderCount: 0,
    orderCount: 0,
    totalSpent: 0,
    lastPreviousOrderAt: '',
    lastPreviousOrderLabel: '',
    topProducts: [],
    loyalty,
    loyaltyCopy: loyaltyProgressCopy(loyalty),
    benefitAvailable: false,
    isRepeatedOrder: false,
    repeatedFromOrderId: '',
  };
}

function readProfileFromStorage() {
  const storage = getStorageArea('localStorage');
  const raw = safeStorageGet(storage, STORAGE_KEYS.customerProfile);
  if (raw == null) return memoryProfile;
  return normalizeCustomerProfile(safeJsonParse(raw, null));
}

function persistProfile(profile) {
  memoryProfile = normalizeCustomerProfile(profile);
  const storage = getStorageArea('localStorage');
  if (!memoryProfile) {
    try { storage?.removeItem(STORAGE_KEYS.customerProfile); } catch (_) { /* ignore */ }
    return true;
  }
  return safeStorageSet(storage, STORAGE_KEYS.customerProfile, JSON.stringify(memoryProfile));
}

function normalizePhone(value) {
  return sanitizeText(value, { fallback: '', maxLength: 40 }).replace(/\D/g, '');
}

function orderTime(order) {
  const date = new Date(order?.createdAt);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function formatDaysAgo(value, now = new Date()) {
  if (!value) return '';
  const date = new Date(value);
  const current = new Date(now);
  if (Number.isNaN(date.getTime()) || Number.isNaN(current.getTime())) return '';
  const diffMs = Math.max(0, current.getTime() - date.getTime());
  const days = Math.floor(diffMs / 86400000);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'hace 1 dia';
  return `hace ${days} dias`;
}

function normalizeIso(value, fallback = new Date().toISOString()) {
  if (!value && fallback === '') return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}
