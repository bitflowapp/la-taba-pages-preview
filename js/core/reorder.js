import { isProductOrderable } from './catalog-store.js';
import {
  calculateTotals,
  normalizeDeliveryMode,
  normalizeMoneyValue,
  normalizeQuantity,
} from './pricing.js';
import { sanitizeText } from './validators.js';

export function buildReorderPreview(order, products = [], options = {}) {
  const deliveryMode = normalizeDeliveryMode(options.deliveryMode || order?.deliveryMode);
  const productMap = new Map((Array.isArray(products) ? products : []).map((product) => [product.id, product]));
  const items = [];
  const skipped = [];
  let priceChanged = false;

  for (const item of Array.isArray(order?.items) ? order.items : []) {
    const productId = sanitizeText(item?.productId, { fallback: '', maxLength: 80 });
    const quantity = normalizeQuantity(item?.quantity, 1);
    const product = productMap.get(productId);
    const fallbackName = sanitizeText(item?.name || product?.name, { fallback: 'Producto', maxLength: 100 });

    if (!product) {
      skipped.push({ productId, name: fallbackName, reason: 'ya no existe en el catalogo' });
      continue;
    }

    if (!isProductOrderable(product)) {
      skipped.push({ productId, name: fallbackName, reason: 'no disponible' });
      continue;
    }

    if (quantity > product.stock) {
      skipped.push({ productId, name: sanitizeText(product.name, { fallback: fallbackName, maxLength: 100 }), reason: `stock disponible: ${product.stock}` });
      continue;
    }

    const currentUnitPrice = normalizeMoneyValue(product.price, 0);
    const previousUnitPrice = normalizeMoneyValue(item?.unitPrice, currentUnitPrice);
    if (currentUnitPrice !== previousUnitPrice) priceChanged = true;
    items.push({
      productId,
      name: sanitizeText(product.name, { fallback: fallbackName, maxLength: 100 }),
      quantity,
      unitPrice: currentUnitPrice,
      previousUnitPrice,
      unit: sanitizeText(product.unit || item?.unit, { fallback: 'unidad', maxLength: 40 }),
      lineTotal: quantity * currentUnitPrice,
      previousLineTotal: quantity * previousUnitPrice,
    });
  }

  const totals = items.length
    ? calculateTotals(items, deliveryMode)
    : { subtotal: 0, discountTotal: 0, deliveryFee: 0, total: 0 };

  return {
    sourceOrderId: sanitizeText(order?.id, { fallback: '', maxLength: 80 }),
    sourceCreatedAt: normalizeIso(order?.createdAt, ''),
    deliveryMode,
    address: sanitizeText(order?.address, { fallback: '', maxLength: 180 }),
    addressDetails: order?.addressDetails && typeof order.addressDetails === 'object' ? {
      streetLine: sanitizeText(order.addressDetails.streetLine, { maxLength: 120 }),
      neighborhood: sanitizeText(order.addressDetails.neighborhood, { maxLength: 80 }),
      reference: sanitizeText(order.addressDetails.reference, { maxLength: 180 }),
      label: sanitizeText(order.addressDetails.label || order.address, { maxLength: 180 }),
      usesStructured: Boolean(order.addressDetails.usesStructured),
    } : null,
    items,
    skipped,
    priceChanged,
    previousTotal: normalizeMoneyValue(order?.total, 0),
    totals,
    canRepeat: items.length > 0,
  };
}

export function buildPendingReorder(order, preview = buildReorderPreview(order), now = new Date()) {
  const normalizedPreview = preview || buildReorderPreview(order);
  if (!normalizedPreview?.sourceOrderId || !normalizedPreview.canRepeat) return null;
  return {
    sourceOrderId: normalizedPreview.sourceOrderId,
    sourceCreatedAt: normalizedPreview.sourceCreatedAt || normalizeIso(order?.createdAt, ''),
    repeatedAt: normalizeIso(now),
    priceChanged: Boolean(normalizedPreview.priceChanged),
    skippedCount: normalizedPreview.skipped.length,
    items: normalizedPreview.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
    })),
  };
}

export function normalizePendingReorder(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const sourceOrderId = sanitizeText(raw.sourceOrderId, { fallback: '', maxLength: 80 });
  if (!sourceOrderId) return null;
  const items = Array.isArray(raw.items)
    ? raw.items.map((item) => {
      const productId = sanitizeText(item?.productId, { fallback: '', maxLength: 80 });
      const quantity = normalizeQuantity(item?.quantity, 1);
      return productId ? { productId, quantity } : null;
    }).filter(Boolean)
    : [];
  if (!items.length) return null;
  return {
    sourceOrderId,
    sourceCreatedAt: normalizeIso(raw.sourceCreatedAt, ''),
    repeatedAt: normalizeIso(raw.repeatedAt),
    priceChanged: Boolean(raw.priceChanged),
    skippedCount: Math.max(0, Math.floor(Number(raw.skippedCount) || 0)),
    items,
  };
}

export function cartMatchesPendingReorder(cart = [], pendingReorder = null) {
  const pending = normalizePendingReorder(pendingReorder);
  if (!pending || !Array.isArray(cart)) return false;
  return cartSignature(cart) === cartSignature(pending.items);
}

export function buildOrderReorderMetadata(pendingReorder, cart = [], now = new Date()) {
  const pending = normalizePendingReorder(pendingReorder);
  if (!pending) return null;
  return {
    sourceOrderId: pending.sourceOrderId,
    sourceCreatedAt: pending.sourceCreatedAt,
    repeatedAt: normalizeIso(now),
    priceChanged: Boolean(pending.priceChanged),
    skippedCount: pending.skippedCount,
    editedBeforeConfirm: !cartMatchesPendingReorder(cart, pending),
  };
}

function cartSignature(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      productId: sanitizeText(item?.productId, { fallback: '', maxLength: 80 }),
      quantity: Math.max(0, Math.floor(Number(item?.quantity) || 0)),
    }))
    .filter((item) => item.productId && item.quantity > 0)
    .sort((a, b) => a.productId.localeCompare(b.productId))
    .map((item) => `${item.productId}:${item.quantity}`)
    .join('|');
}

function normalizeIso(value, fallback = new Date().toISOString()) {
  if (!value && fallback === '') return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}
