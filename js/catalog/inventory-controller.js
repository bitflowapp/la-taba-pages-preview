import { buildInventoryMovement, calculateStockCountAdjustment } from '../core/inventory-domain.js';
import { randomOperationKey } from '../core/idempotency-key.js';

export function createInventoryController({ repository, businessId, operatorId, now = () => new Date() } = {}) {
  if (!repository || !businessId || !operatorId) throw new Error('Inventario requiere repositorio y sesión operativa.');
  const drafts = new Map();

  return Object.freeze({
    prepareMovement(input) {
      const movement = buildInventoryMovement({
        ...input,
        businessId,
        operatorId,
        idempotencyKey: input.idempotencyKey || createKey('inventory'),
      }, { now });
      drafts.set(movement.idempotencyKey, movement);
      return movement;
    },
    prepareStockCount({ productId, theoreticalStock, physicalStock, reason, idempotencyKey }) {
      const count = calculateStockCountAdjustment(theoreticalStock, physicalStock);
      if (count.difference === 0) return Object.freeze({ ...count, movement: null });
      const movement = buildInventoryMovement({
        businessId,
        productId,
        movementType: 'stock_count',
        packageQuantity: Math.abs(count.difference),
        direction: Math.sign(count.difference),
        previousStock: theoreticalStock,
        reason,
        operatorId,
        idempotencyKey: idempotencyKey || createKey('stock-count'),
      }, { now });
      drafts.set(movement.idempotencyKey, movement);
      return Object.freeze({ ...count, movement });
    },
    listDrafts: () => [...drafts.values()],
    discard(idempotencyKey) { return drafts.delete(idempotencyKey); },
    async confirm(idempotencyKey) {
      const movement = drafts.get(idempotencyKey);
      if (!movement) return { ok: false, message: 'Borrador de inventario no encontrado.' };
      const result = await repository.applyMovement(movement);
      if (result?.ok) drafts.delete(idempotencyKey);
      return result;
    },
  });
}

// Mismo contrato del servidor que el resto: `^[A-Za-z0-9_-]{8,128}$`. Acá
// también se pegaba el prefijo con un UUID usando dos puntos, y ese separador
// no pertenece al alfabeto que el backend acepta.
function createKey(prefix) {
  return randomOperationKey(prefix);
}
