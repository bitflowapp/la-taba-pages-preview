export const POS_PAYMENT_METHODS = Object.freeze(['cash', 'debit_card', 'credit_card', 'transfer', 'qr']);

export function createPosCart({ saleId, businessId, operatorId, now = () => new Date() }) {
  if (!saleId || !businessId || !operatorId) throw new Error('La venta requiere identificadores completos.');
  return { saleId: String(saleId), businessId: String(businessId), operatorId: String(operatorId), state: 'draft', items: [], createdAt: now().toISOString(), updatedAt: now().toISOString() };
}

export function addPosItem(cart, product, barcode, quantity = 1, { now = () => new Date() } = {}) {
  assertOpenCart(cart);
  const requested = positiveInteger(quantity);
  const factor = positiveInteger(barcode?.unitFactor || 1);
  const baseUnits = requested * factor;
  const unitPrice = Number(product?.price);
  if (!product?.id || !Number.isFinite(unitPrice) || unitPrice < 0) throw new Error('Producto o precio inv\u00e1lido.');
  const existing = cart.items.find((item) => item.productId === String(product.id) && item.unitPrice === unitPrice);
  if (existing) existing.quantity += baseUnits;
  else cart.items.push({ productId: String(product.id), name: String(product.name || ''), quantity: baseUnits, unitPrice, taxCategory: String(product.taxCategory || ''), barcodeId: barcode?.id || null });
  cart.updatedAt = now().toISOString();
  return cart;
}

export function pricePosCart(cart, promotions = []) {
  assertOpenCart(cart);
  const subtotal = roundMoney(cart.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0));
  const validPromotions = (Array.isArray(promotions) ? promotions : []).filter((promotion) => promotion?.active === true && Number(promotion.discountAmount) > 0);
  const discount = roundMoney(Math.min(subtotal, validPromotions.reduce((sum, promotion) => sum + Number(promotion.discountAmount), 0)));
  const total = roundMoney(subtotal - discount);
  return Object.freeze({ subtotal, discount, total, promotionIds: validPromotions.map((promotion) => String(promotion.id)) });
}

export function buildPosCheckoutIntent(cart, { paymentMethod, idempotencyKey, requestFiscal = false, recipient = null, promotions = [] } = {}) {
  assertOpenCart(cart);
  if (!cart.items.length) throw new Error('La venta no tiene productos.');
  if (!POS_PAYMENT_METHODS.includes(paymentMethod)) throw new Error('Medio de pago no permitido.');
  if (!idempotencyKey) throw new Error('La confirmaci\u00f3n requiere idempotencia.');
  return Object.freeze({
    saleId: cart.saleId, businessId: cart.businessId, paymentMethod,
    idempotencyKey: String(idempotencyKey), requestFiscal: requestFiscal === true,
    recipient: recipient ? sanitizeRecipient(recipient) : null,
    promotionIds: pricePosCart(cart, promotions).promotionIds,
    items: Object.freeze(cart.items.map((item) => Object.freeze({ productId: item.productId, quantity: item.quantity }))),
  });
}

export function presentPosCompletion({ saleConfirmed, fiscalStatus, cae }) {
  if (!saleConfirmed) return 'Venta pendiente de confirmaci\u00f3n';
  if (fiscalStatus === 'authorized' && String(cae || '').length === 14) return 'Venta registrada \u2014 factura autorizada';
  return 'Venta registrada \u2014 comprobante pendiente';
}

function sanitizeRecipient(value) {
  return Object.freeze({ type: String(value.type || ''), documentType: String(value.documentType || ''), documentNumber: String(value.documentNumber || '').replace(/\D/g, '').slice(0, 20), legalName: String(value.legalName || '').trim().slice(0, 160) });
}

function assertOpenCart(cart) {
  if (!cart || !['draft', 'pricing', 'awaiting_payment'].includes(cart.state)) throw new Error('La venta no se puede modificar.');
}

function positiveInteger(value) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 1) throw new RangeError('La cantidad debe ser un entero positivo.');
  return numeric;
}

function roundMoney(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }
