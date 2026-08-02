import { buildInventoryMovement, calculateStockCountAdjustment } from '../core/inventory-domain.js';

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

function createKey(prefix) {
  return `${prefix}:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}
