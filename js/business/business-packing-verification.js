export function createPackingSession({ orderId, orderRevision, operatorId, items, now = () => new Date() }) {
  if (!orderId || !operatorId || !Number.isSafeInteger(Number(orderRevision))) throw new Error('La sesi\u00f3n requiere pedido, revisi\u00f3n y operador.');
  const normalizedItems = (Array.isArray(items) ? items : []).map((item) => ({
    productId: String(item.productId || item.id || ''),
    name: String(item.name || ''),
    required: positiveInteger(item.quantity),
    scanned: 0,
    barcodes: normalizeBarcodeBindings(item.barcodes),
  }));
  if (!normalizedItems.length || normalizedItems.some((item) => !item.productId || !item.required)) {
    throw new Error('El pedido no contiene items verificables.');
  }
  return {
    orderId: String(orderId), orderRevision: Number(orderRevision), operatorId: String(operatorId),
    state: 'in_progress', items: normalizedItems, scans: [], createdAt: now().toISOString(), updatedAt: now().toISOString(),
  };
}

export function applyPackingScan(session, barcodeEvent, { now = () => new Date() } = {}) {
  assertMutableSession(session);
  if (!barcodeEvent?.isValid) return packingResult(false, 'INVALID_BARCODE', 'C\u00f3digo inv\u00e1lido.', session);
  const code = String(barcodeEvent.normalizedValue || '');
  const match = session.items.find((item) => item.barcodes.some((barcode) => barcode.gtin === code));
  if (!match) return packingResult(false, 'WRONG_PRODUCT', 'Producto equivocado.', session);
  const binding = match.barcodes.find((barcode) => barcode.gtin === code);
  if (match.scanned + binding.unitFactor > match.required) {
    return packingResult(false, 'EXCESS_QUANTITY', 'La lectura excede la cantidad pedida.', session);
  }
  match.scanned += binding.unitFactor;
  session.scans.push({ gtin: code, productId: match.productId, unitFactor: binding.unitFactor, at: now().toISOString() });
  session.updatedAt = now().toISOString();
  const complete = session.items.every((item) => item.scanned === item.required);
  session.state = complete ? 'complete' : 'in_progress';
  return packingResult(true, complete ? 'QUANTITY_COMPLETE' : 'SCAN_ACCEPTED', complete ? 'Cantidad completa.' : 'Producto verificado.', session);
}

export function undoLastPackingScan(session, { now = () => new Date() } = {}) {
  assertMutableSession(session);
  const scan = session.scans.pop();
  if (!scan) return packingResult(false, 'NOTHING_TO_UNDO', 'No hay lecturas para deshacer.', session);
  const item = session.items.find((candidate) => candidate.productId === scan.productId);
  if (item) item.scanned = Math.max(0, item.scanned - scan.unitFactor);
  session.state = 'in_progress';
  session.updatedAt = now().toISOString();
  return packingResult(true, 'SCAN_REVERTED', '\u00daltima lectura deshecha.', session);
}

export function confirmPackingSession(session, { authorizedException = false, reason = '', role = '' } = {}) {
  assertMutableSession(session);
  const complete = session.items.every((item) => item.scanned === item.required);
  if (!complete && !(authorizedException && ['owner', 'admin'].includes(role) && String(reason).trim())) {
    session.state = 'exception_required';
    return packingResult(false, 'PACKING_INCOMPLETE', 'Falta mercader\u00eda; requiere una excepci\u00f3n autorizada.', session);
  }
  session.state = 'confirmed';
  session.exception = complete ? null : { authorized: true, role, reason: String(reason).trim() };
  return packingResult(true, complete ? 'PACKING_CONFIRMED' : 'PACKING_EXCEPTION_CONFIRMED', 'Preparaci\u00f3n confirmada.', session);
}

function normalizeBarcodeBindings(barcodes) {
  return (Array.isArray(barcodes) ? barcodes : []).map((binding) => ({
    gtin: String(binding.gtin || binding.code || ''),
    unitFactor: positiveInteger(binding.unitFactor, 1),
  })).filter((binding) => binding.gtin);
}

function positiveInteger(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function assertMutableSession(session) {
  if (!session || ['confirmed', 'cancelled'].includes(session.state)) throw new Error('La sesi\u00f3n de packing est\u00e1 cerrada.');
}

function packingResult(ok, code, message, session) {
  return Object.freeze({ ok, code, message, state: session.state, session });
}
