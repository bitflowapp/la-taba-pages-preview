import { getBusinessConfig } from './business-config-store.js';
import { calculateTotals, normalizeDeliveryMode, normalizeMoneyValue } from './pricing.js';
import { sanitizeNotes, sanitizeText } from './validators.js';
import { normalizeAddressDetails, normalizeOrderAddressDetails } from './address.js';
import {
  normalizeWorkflowStatus,
  toDemoOrderStatus,
} from './order-workflow.js';

export const DOMAIN_MODEL_VERSION = 1;
export const FULFILLMENT_TYPES = Object.freeze(['delivery', 'pickup']);
export const TRACKING_LOCATION_SOURCES = Object.freeze(['gps', 'simulation', 'manual']);

export function normalizeFulfillmentType(value) {
  return normalizeDeliveryMode(value);
}

export function normalizeTrackingSource(source) {
  return TRACKING_LOCATION_SOURCES.includes(source) ? source : 'simulation';
}

export function normalizeTrackingLocation(location = {}) {
  const lat = Number(location.lat);
  const lng = Number(location.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const timestamp = normalizeTimestamp(location.timestamp || location.lastFixAt || Date.now(), new Date().toISOString());
  const source = normalizeTrackingSource(location.source);
  return {
    lat,
    lng,
    ...(Number.isFinite(Number(location.accuracy)) ? { accuracy: Math.max(0, Number(location.accuracy)) } : {}),
    ...(Number.isFinite(Number(location.heading)) ? { heading: normalizeHeading(location.heading) } : {}),
    ...(Number.isFinite(Number(location.speed)) ? { speed: Math.max(0, Number(location.speed)) } : {}),
    timestamp: Date.parse(timestamp),
    lastFixAt: timestamp,
    source,
  };
}

export function toDomainOrderItem(item = {}) {
  const quantity = Math.max(0, Math.floor(Number(item.quantity) || 0));
  const unitPrice = normalizeMoneyValue(item.unitPrice, 0);
  return {
    productId: sanitizeText(item.productId, { maxLength: 80 }),
    name: sanitizeText(item.name, { fallback: 'Producto', maxLength: 100 }),
    quantity,
    unit: sanitizeText(item.unit, { fallback: 'unidad', maxLength: 40 }),
    unitPrice,
    subtotal: normalizeMoneyValue(item.subtotal ?? quantity * unitPrice, 0),
  };
}

export function toDomainOrder(order = {}) {
  if (!order || typeof order !== 'object' || !order.id) return null;

  const fulfillmentType = normalizeFulfillmentType(order.fulfillmentType || order.deliveryMode);
  const items = Array.isArray(order.items) ? order.items.map(toDomainOrderItem).filter((item) => item.productId) : [];
  const totals = normalizeTotals(order, items, fulfillmentType);
  const status = normalizeWorkflowStatus(order.workflowStatus || order.status);
  const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];
  const tracking = normalizeOrderTracking(order.tracking, order.delivery);
  const addressDetails = fulfillmentType === 'pickup' ? null : normalizeOrderAddressDetails(order);

  return {
    modelVersion: DOMAIN_MODEL_VERSION,
    id: sanitizeText(order.id, { maxLength: 40 }),
    code: sanitizeText(order.code || order.id, { maxLength: 40 }),
    status,
    demoStatus: toDemoOrderStatus(status),
    fulfillmentType,
    customer: {
      name: sanitizeText(order.customer?.name || order.customerName, { fallback: 'Cliente', maxLength: 80 }),
      phone: sanitizeText(order.customer?.phone || order.customerPhone, { maxLength: 40 }),
      whatsapp: sanitizeText(order.customer?.whatsapp || order.customerPhone, { maxLength: 40 }),
    },
    address: fulfillmentType === 'pickup'
      ? getBusinessConfig().address
      : addressDetails.label || sanitizeText(order.address, { fallback: 'Sin dirección', maxLength: 180 }),
    addressDetails,
    items,
    totals,
    paymentMethod: sanitizeText(order.paymentMethod, { fallback: 'Efectivo', maxLength: 80 }),
    notes: sanitizeNotes(order.notes),
    createdAt: normalizeTimestamp(order.createdAt),
    updatedAt: normalizeTimestamp(order.updatedAt || lastHistoryAt(history) || order.createdAt),
    acceptedAt: normalizeTimestamp(order.acceptedAt || statusAt(history, 'preparing'), null),
    readyAt: normalizeTimestamp(order.readyAt || statusAt(history, 'ready'), null),
    pickedUpAt: normalizeTimestamp(order.pickedUpAt || statusAt(history, 'on_the_way'), null),
    deliveredAt: normalizeTimestamp(order.deliveredAt || order.delivery?.deliveredAt || statusAt(history, 'delivered'), null),
    canceledAt: normalizeTimestamp(order.canceledAt || statusAt(history, 'cancelled'), null),
    assignedRiderId: sanitizeText(order.assignedRiderId, { maxLength: 80 }),
    tracking,
  };
}

export function normalizeOrderDraft(draft = {}) {
  const fulfillmentType = normalizeFulfillmentType(draft.fulfillmentType || draft.deliveryMode);
  const addressDetails = normalizeAddressDetails(draft);
  return {
    customerName: sanitizeText(draft.customerName || draft.customer?.name, { maxLength: 80 }),
    customerPhone: sanitizeText(draft.customerPhone || draft.customer?.phone, { maxLength: 40 }),
    customerStreetAddress: addressDetails.streetLine,
    customerNeighborhood: addressDetails.neighborhood,
    customerReference: addressDetails.reference,
    customerAddress: addressDetails.label,
    addressDetails,
    deliveryMode: fulfillmentType,
    paymentMethod: sanitizeText(draft.paymentMethod, { fallback: 'cash', maxLength: 40 }),
    customerNotes: sanitizeNotes(draft.customerNotes || draft.notes, ''),
    cashChange: sanitizeText(draft.cashChange, { fallback: '', maxLength: 80 }),
    couponCode: sanitizeText(draft.couponCode, { fallback: '', maxLength: 24 }).toUpperCase(),
  };
}

export function toDomainRider(rider = {}) {
  return {
    id: sanitizeText(rider.id || rider.assignedRiderId || 'demo-rider', { maxLength: 80 }),
    name: sanitizeText(rider.name || rider.driverName || 'Rider demo', { maxLength: 80 }),
    phone: sanitizeText(rider.phone || rider.driverPhone, { maxLength: 40 }),
    whatsapp: sanitizeText(rider.whatsapp || rider.driverPhone || rider.phone, { maxLength: 40 }),
    status: sanitizeText(rider.status || 'available', { maxLength: 40 }),
    lastLocation: normalizeTrackingLocation(rider.lastLocation || rider.location),
  };
}

export function toDomainBusiness(config = getBusinessConfig()) {
  return {
    id: sanitizeText(config.id || 'la-taba', { maxLength: 80 }),
    name: sanitizeText(config.name || config.businessName, { fallback: 'La Taba', maxLength: 100 }),
    status: sanitizeText(config.status || 'open', { maxLength: 40 }),
    deliveryZones: Array.isArray(config.defaultDeliveryZones) ? config.defaultDeliveryZones.map((zone) => ({
      id: sanitizeText(zone.id, { maxLength: 80 }),
      name: sanitizeText(zone.name, { maxLength: 100 }),
      center: zone.center ? { lat: Number(zone.center.lat), lng: Number(zone.center.lng) } : null,
    })) : [],
    openingHours: sanitizeText(config.openingHours || config.openingHoursLabel, { maxLength: 120 }),
  };
}

function normalizeTotals(order, items, fulfillmentType) {
  const computed = calculateTotals(items, fulfillmentType);
  return {
    subtotal: normalizeMoneyValue(order.totals?.subtotal ?? order.subtotal ?? computed.subtotal, computed.subtotal),
    deliveryFee: normalizeMoneyValue(order.totals?.deliveryFee ?? order.deliveryFee ?? computed.deliveryFee, computed.deliveryFee),
    total: normalizeMoneyValue(order.totals?.total ?? order.total ?? computed.total, computed.total),
  };
}

function normalizeOrderTracking(tracking = {}, delivery = {}) {
  const lastLocation = normalizeTrackingLocation(tracking.lastLocation || tracking.location || delivery.lastLocation);
  return {
    lastLocation,
    source: lastLocation?.source || normalizeTrackingSource(tracking.source),
    updatedAt: normalizeTimestamp(tracking.updatedAt || lastLocation?.lastFixAt, null),
  };
}

function statusAt(history, status) {
  const entry = history.find((candidate) => candidate?.status === status);
  return entry?.at || null;
}

function lastHistoryAt(history) {
  return history.length ? history[history.length - 1]?.at : null;
}

function normalizeTimestamp(value, fallback = new Date().toISOString()) {
  if (value == null || value === '') return fallback;
  const date = typeof value === 'number' ? new Date(value) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function normalizeHeading(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return ((numeric % 360) + 360) % 360;
}
