import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInventoryMovement, calculateBaseUnits, calculateStockCountAdjustment } from '../js/core/inventory-domain.js';
import {
  applyPackingScan, confirmPackingSession, createPackingCacheSnapshot, createPackingSession,
  createPackingSessionFromManifest, markPackingScanConfirmed, pendingPackingScanCount,
  restorePackingCacheSnapshot, revertPackingScanLocally, undoLastPackingScan,
} from '../js/business/business-packing-verification.js';
import { addPosItem, buildPosCheckoutIntent, createPosCart, presentPosCompletion, pricePosCart } from '../js/core/pos-domain.js';

test('inventario convierte packs a unidades base y conserva ledger auditable', () => {
  assert.equal(calculateBaseUnits(3, 6), 18);
  const movement = buildInventoryMovement({
    businessId: 'b1', productId: 'p1', barcodeId: 'bc-pack', movementType: 'purchase_receipt',
    packageQuantity: 3, unitFactor: 6, previousStock: 2, operatorId: 'u1', idempotencyKey: 'receive-1',
  }, { now: () => new Date('2026-08-02T10:00:00Z') });
  assert.equal(movement.quantityDelta, 18);
  assert.equal(movement.resultingStock, 20);
  assert.equal(movement.createdAt, '2026-08-02T10:00:00.000Z');
});

test('inventario bloquea stock negativo y exige motivo para merma/ajuste', () => {
  assert.throws(() => buildInventoryMovement({ businessId: 'b', productId: 'p', movementType: 'sale', packageQuantity: 2, previousStock: 1, direction: -1, operatorId: 'u', idempotencyKey: 'x' }), { code: 'NEGATIVE_STOCK_BLOCKED' });
  assert.throws(() => buildInventoryMovement({ businessId: 'b', productId: 'p', movementType: 'damage', packageQuantity: 1, previousStock: 2, direction: -1, operatorId: 'u', idempotencyKey: 'x' }), /motivo/i);
});

test('conteo f\u00edsico calcula diferencia pero nunca ajusta silenciosamente', () => {
  assert.deepEqual(calculateStockCountAdjustment(12, 9), { theoreticalStock: 12, physicalStock: 9, difference: -3 });
});

test('packing acepta unidad y pack sin contar de m\u00e1s', () => {
  const session = createPackingSession({ orderId: 'o1', orderRevision: 3, operatorId: 'staff', items: [{ productId: 'p1', name: 'Lata', quantity: 7, barcodes: [{ gtin: 'unit', unitFactor: 1 }, { gtin: 'pack', unitFactor: 6 }] }] });
  assert.equal(applyPackingScan(session, scan('pack')).ok, true);
  assert.equal(applyPackingScan(session, scan('pack')).code, 'EXCESS_QUANTITY');
  assert.equal(applyPackingScan(session, scan('unit')).code, 'QUANTITY_COMPLETE');
  assert.equal(confirmPackingSession(session).ok, true);
  assert.equal(session.state, 'confirmed');
});

test('packing detecta producto equivocado, faltante, deshacer y excepci\u00f3n autorizada', () => {
  const session = createPackingSession({ orderId: 'o2', orderRevision: 1, operatorId: 'staff', items: [{ productId: 'p1', quantity: 2, barcodes: [{ gtin: 'a', unitFactor: 1 }] }] });
  assert.equal(applyPackingScan(session, scan('wrong')).code, 'WRONG_PRODUCT');
  applyPackingScan(session, scan('a'));
  assert.equal(undoLastPackingScan(session).ok, true);
  assert.equal(confirmPackingSession(session).code, 'PACKING_INCOMPLETE');
  assert.equal(confirmPackingSession(session, { authorizedException: true, role: 'staff', reason: 'falta' }).ok, false);
  assert.equal(confirmPackingSession(session, { authorizedException: true, role: 'admin', reason: 'Faltante confirmado con cliente' }).ok, true);
});

test('packing recupera manifiesto autoritativo y no incluye datos de cliente en caché', () => {
  const manifest = {
    schemaVersion: 1,
    session: {
      id: 'session-1', businessId: 'business-1', orderId: 'order-1', orderRevision: 4,
      status: 'in_progress', operatorId: 'operator-1', updatedAt: '2026-08-02T10:00:00Z',
    },
    items: [{ productId: 'product-1', name: 'Producto', quantity: 2, barcodes: [{ gtin: '4006381333931', unitFactor: 1 }] }],
    scans: [{ scanKey: 'packing-scan:1', gtin: '4006381333931', productId: 'product-1', unitFactor: 1, createdAt: '2026-08-02T10:01:00Z', revertedAt: null }],
  };
  const session = createPackingSessionFromManifest(manifest, { operatorId: 'operator-1' });
  assert.equal(session.items[0].scanned, 1);
  assert.equal(session.scans[0].syncState, 'confirmed');
  const snapshot = createPackingCacheSnapshot(session, { businessId: 'business-1', now: () => new Date('2026-08-02T10:02:00Z') });
  assert.equal(JSON.stringify(snapshot).includes('customer'), false);
  assert.equal(JSON.stringify(snapshot).includes('deliveryCode'), false);
  const restored = restorePackingCacheSnapshot(snapshot, { businessId: 'business-1', operatorId: 'operator-1' });
  assert.equal(restored.serverSessionId, 'session-1');
  assert.equal(restored.items[0].scanned, 1);
  assert.throws(() => restorePackingCacheSnapshot(snapshot, { businessId: 'business-2' }), /negocio autenticado/i);
});

test('packing distingue scans pendientes, confirmados y reversiones exactas', () => {
  const session = createPackingSession({
    orderId: 'order-2', orderRevision: 1, operatorId: 'operator-1',
    items: [{ productId: 'product-1', name: 'Producto', quantity: 2, barcodes: [{ gtin: '4006381333931', unitFactor: 1 }] }],
  });
  applyPackingScan(session, scan('4006381333931'), { scanKey: 'packing-scan:a' });
  applyPackingScan(session, scan('4006381333931'), { scanKey: 'packing-scan:b' });
  assert.equal(pendingPackingScanCount(session), 2);
  assert.equal(markPackingScanConfirmed(session, 'packing-scan:a'), true);
  assert.equal(pendingPackingScanCount(session), 1);
  assert.equal(revertPackingScanLocally(session, 'packing-scan:a').ok, true);
  assert.equal(session.scans[0].scanKey, 'packing-scan:b');
  assert.equal(session.items[0].scanned, 1);
});

test('POS suma packs, calcula promoci\u00f3n y env\u00eda s\u00f3lo intenci\u00f3n al servidor', () => {
  const cart = createPosCart({ saleId: 's1', businessId: 'b1', operatorId: 'u1' });
  addPosItem(cart, { id: 'p1', name: 'Lata', price: 1000 }, { id: 'pack', unitFactor: 6 }, 1);
  addPosItem(cart, { id: 'p1', name: 'Lata', price: 1000 }, { id: 'unit', unitFactor: 1 }, 2);
  const pricing = pricePosCart(cart, [{ id: 'promo', active: true, discountAmount: 500 }]);
  assert.deepEqual(pricing, { subtotal: 8000, discount: 500, total: 7500, promotionIds: ['promo'] });
  const intent = buildPosCheckoutIntent(cart, { paymentMethod: 'cash', idempotencyKey: 'checkout-1', requestFiscal: true, promotions: [{ id: 'promo', active: true, discountAmount: 500 }] });
  assert.deepEqual(intent.items, [{ productId: 'p1', quantity: 8 }]);
  assert.equal(Object.hasOwn(intent, 'total'), false);
});

test('POS distingue venta confirmada de factura autorizada', () => {
  assert.equal(presentPosCompletion({ saleConfirmed: false }), 'Venta pendiente de confirmaci\u00f3n');
  assert.equal(presentPosCompletion({ saleConfirmed: true, fiscalStatus: 'queued' }), 'Venta registrada \u2014 comprobante pendiente');
  assert.equal(presentPosCompletion({ saleConfirmed: true, fiscalStatus: 'authorized', cae: '12345678901234' }), 'Venta registrada \u2014 factura autorizada');
});

function scan(normalizedValue) { return { isValid: true, normalizedValue }; }
