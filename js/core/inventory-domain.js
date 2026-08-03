export const INVENTORY_MOVEMENT_TYPES = Object.freeze([
  'purchase_receipt', 'manual_adjustment', 'stock_count', 'sale',
  'online_order_reservation', 'online_order_release', 'cancellation_return',
  'damage', 'loss', 'expiration', 'supplier_return',
]);

export function calculateBaseUnits(packageQuantity, unitFactor = 1) {
  const quantity = Number(packageQuantity);
  const factor = Number(unitFactor);
  if (!Number.isSafeInteger(quantity) || quantity < 0) throw new RangeError('La cantidad debe ser un entero no negativo.');
  if (!Number.isSafeInteger(factor) || factor < 1) throw new RangeError('El factor debe ser un entero positivo.');
  const result = quantity * factor;
  if (!Number.isSafeInteger(result)) throw new RangeError('La cantidad excede el l\u00edmite soportado.');
  return result;
}

export function buildInventoryMovement({
  businessId, productId, barcodeId = null, movementType, packageQuantity,
  unitFactor = 1, direction = 1, previousStock, referenceType = null,
  referenceId = null, reason = '', operatorId, idempotencyKey,
}, { allowNegativeStock = false, now = () => new Date() } = {}) {
  if (!businessId || !productId || !operatorId || !idempotencyKey) throw new Error('Faltan identificadores de auditor\u00eda.');
  if (!INVENTORY_MOVEMENT_TYPES.includes(movementType)) throw new Error('Tipo de movimiento no permitido.');
  const current = Number(previousStock);
  if (!Number.isSafeInteger(current)) throw new RangeError('El stock previo debe ser entero.');
  if (![1, -1].includes(direction)) throw new RangeError('La direcci\u00f3n debe ser 1 o -1.');
  const units = calculateBaseUnits(packageQuantity, unitFactor);
  if (units === 0) throw new RangeError('La cantidad del movimiento debe ser mayor que cero.');
  if (['manual_adjustment', 'stock_count', 'damage', 'loss', 'expiration', 'supplier_return'].includes(movementType) && !String(reason).trim()) {
    throw new Error('El motivo es obligatorio para este movimiento.');
  }
  const quantityDelta = units * direction;
  const resultingStock = current + quantityDelta;
  if (!allowNegativeStock && resultingStock < 0) {
    const error = new Error('El movimiento dejar\u00eda stock negativo.');
    error.code = 'NEGATIVE_STOCK_BLOCKED';
    throw error;
  }
  return Object.freeze({
    businessId: String(businessId), productId: String(productId), barcodeId,
    movementType, quantityDelta, previousStock: current, resultingStock,
    packageQuantity: Number(packageQuantity), direction, unitFactor: Number(unitFactor), referenceType, referenceId,
    reason: String(reason).trim(), operatorId: String(operatorId),
    idempotencyKey: String(idempotencyKey), createdAt: now().toISOString(),
  });
}

export function calculateStockCountAdjustment(theoreticalStock, physicalStock) {
  const theoretical = Number(theoreticalStock);
  const physical = Number(physicalStock);
  if (!Number.isSafeInteger(theoretical) || !Number.isSafeInteger(physical) || physical < 0) {
    throw new RangeError('El conteo f\u00edsico y el stock te\u00f3rico deben ser enteros v\u00e1lidos.');
  }
  return Object.freeze({ theoreticalStock: theoretical, physicalStock: physical, difference: physical - theoretical });
}
