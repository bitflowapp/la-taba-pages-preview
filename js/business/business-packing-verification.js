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

export function createPackingSessionFromManifest(manifest, { operatorId = '', now = () => new Date() } = {}) {
  if (Number(manifest?.schemaVersion) !== 1) throw new Error('Versión de manifiesto de packing no compatible.');
  const server = manifest?.session || {};
  if (!server.id || !server.businessId || !server.orderId || !Number.isSafeInteger(server.orderRevision) || server.orderRevision < 1) {
    throw new Error('El manifiesto de packing está incompleto.');
  }
  if (!['in_progress', 'complete', 'exception_required', 'confirmed'].includes(server.status)) {
    throw new Error('El manifiesto de packing está cerrado o no es recuperable.');
  }
  const session = createPackingSession({
    orderId: server.orderId,
    orderRevision: server.orderRevision,
    operatorId: operatorId || server.operatorId,
    items: manifest.items,
    now,
  });
  session.serverSessionId = String(server.id);
  session.businessId = String(server.businessId);
  session.authoritativeUpdatedAt = String(server.updatedAt || '');
  for (const scan of Array.isArray(manifest.scans) ? manifest.scans : []) {
    if (scan?.revertedAt) continue;
    const applied = applyPackingScan(session, {
      isValid: true,
      normalizedValue: scan.gtin,
    }, {
      now: () => validDate(scan.createdAt) || now(),
      scanKey: scan.scanKey,
      syncState: 'confirmed',
    });
    if (!applied.ok || String(applied.session.scans.at(-1)?.productId) !== String(scan.productId)) {
      throw new Error('El manifiesto autoritativo contiene una lectura inconsistente.');
    }
  }
  session.state = server.status;
  return session;
}

export function createPackingCacheSnapshot(session, { businessId, now = () => new Date() } = {}) {
  if (!session?.serverSessionId || String(session.businessId || businessId) !== String(businessId || session.businessId)) {
    throw new Error('La caché de packing requiere una sesión y negocio válidos.');
  }
  return {
    schemaVersion: 1,
    businessId: String(businessId || session.businessId),
    serverSessionId: String(session.serverSessionId),
    orderId: String(session.orderId),
    orderRevision: Number(session.orderRevision),
    operatorId: String(session.operatorId),
    state: String(session.state),
    items: session.items.map((item) => ({
      productId: String(item.productId),
      name: String(item.name).slice(0, 100),
      required: item.required,
      barcodes: item.barcodes.map((barcode) => ({ gtin: barcode.gtin, unitFactor: barcode.unitFactor })),
    })),
    scans: session.scans.map((scan) => ({
      scanKey: String(scan.scanKey || ''),
      gtin: String(scan.gtin),
      productId: String(scan.productId),
      unitFactor: scan.unitFactor,
      at: String(scan.at),
      syncState: scan.syncState === 'confirmed' ? 'confirmed' : 'pending',
    })),
    savedAt: now().toISOString(),
  };
}

export function restorePackingCacheSnapshot(snapshot, { businessId, operatorId = '', now = () => new Date() } = {}) {
  if (Number(snapshot?.schemaVersion) !== 1 || String(snapshot?.businessId || '') !== String(businessId || '')) {
    throw new Error('La caché de packing no corresponde al negocio autenticado.');
  }
  const session = createPackingSession({
    orderId: snapshot.orderId,
    orderRevision: Number(snapshot.orderRevision),
    operatorId: operatorId || snapshot.operatorId,
    items: (Array.isArray(snapshot.items) ? snapshot.items : []).map((item) => ({ ...item, quantity: item.required })),
    now,
  });
  session.serverSessionId = String(snapshot.serverSessionId || '');
  session.businessId = String(snapshot.businessId);
  if (!session.serverSessionId) throw new Error('La caché de packing no identifica la sesión remota.');
  for (const scan of Array.isArray(snapshot.scans) ? snapshot.scans : []) {
    const applied = applyPackingScan(session, { isValid: true, normalizedValue: scan.gtin }, {
      now: () => validDate(scan.at) || now(),
      scanKey: scan.scanKey,
      syncState: scan.syncState,
    });
    if (!applied.ok || String(applied.session.scans.at(-1)?.productId) !== String(scan.productId)) {
      throw new Error('La caché de packing no supera la validación de integridad.');
    }
  }
  if (snapshot.state === 'exception_required') session.state = 'exception_required';
  return session;
}

export function applyPackingScan(session, barcodeEvent, { now = () => new Date(), scanKey = '', syncState = 'pending' } = {}) {
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
  session.scans.push({
    scanKey: String(scanKey || ''), gtin: code, productId: match.productId,
    unitFactor: binding.unitFactor, at: now().toISOString(),
    syncState: syncState === 'confirmed' ? 'confirmed' : 'pending',
  });
  session.updatedAt = now().toISOString();
  const complete = session.items.every((item) => item.scanned === item.required);
  session.state = complete ? 'complete' : 'in_progress';
  return packingResult(true, complete ? 'QUANTITY_COMPLETE' : 'SCAN_ACCEPTED', complete ? 'Cantidad completa.' : 'Producto verificado.', session);
}

export function markPackingScanConfirmed(session, scanKey) {
  const scan = session?.scans?.find((candidate) => candidate.scanKey === String(scanKey || ''));
  if (!scan) return false;
  scan.syncState = 'confirmed';
  return true;
}

export function pendingPackingScanCount(session) {
  return Array.isArray(session?.scans)
    ? session.scans.filter((scan) => scan.syncState !== 'confirmed').length
    : 0;
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

export function revertPackingScanLocally(session, scanKey, { now = () => new Date() } = {}) {
  assertMutableSession(session);
  const index = session.scans.findIndex((scan) => scan.scanKey === String(scanKey || ''));
  if (index < 0) return packingResult(false, 'SCAN_NOT_FOUND', 'La lectura no está en la sesión local.', session);
  const [scan] = session.scans.splice(index, 1);
  const item = session.items.find((candidate) => candidate.productId === scan.productId);
  if (item) item.scanned = Math.max(0, item.scanned - scan.unitFactor);
  session.state = session.items.every((candidate) => candidate.scanned === candidate.required) ? 'complete' : 'in_progress';
  session.updatedAt = now().toISOString();
  return packingResult(true, 'SCAN_REVERTED', 'Lectura revertida.', session);
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

function validDate(value) {
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? null : date;
}
