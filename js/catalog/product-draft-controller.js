export function createProductDraft(lookup, { businessId, operatorId, now = () => new Date() } = {}) {
  if (!businessId || !operatorId) throw new Error('El borrador requiere negocio y operador autenticado.');
  if (!lookup?.barcode?.isValid) throw new Error('El borrador requiere un GTIN v\u00e1lido.');
  return Object.freeze({
    businessId: String(businessId),
    scannedGtin: lookup.barcode.normalizedValue,
    suggestedName: String(lookup.suggestedName || ''),
    suggestedBrand: String(lookup.suggestedBrand || ''),
    suggestedPresentation: String(lookup.suggestedPresentation || ''),
    suggestedCategory: String(lookup.suggestedCategory || ''),
    suggestedImage: String(lookup.suggestedImage || ''),
    source: String(lookup.source || 'manual'),
    confidence: Number(lookup.confidence) || 0,
    status: 'pending_review',
    createdBy: String(operatorId),
    createdAt: now().toISOString(),
  });
}

export function approveProductDraft(draft, patch, { reviewerId, now = () => new Date() } = {}) {
  if (draft?.status !== 'pending_review') throw new Error('El borrador ya fue revisado.');
  if (!reviewerId) throw new Error('La aprobaci\u00f3n requiere un revisor autenticado.');
  const name = String(patch?.name || draft.suggestedName || '').trim();
  const category = String(patch?.category || draft.suggestedCategory || '').trim();
  const unitFactor = Number(patch?.unitFactor || 1);
  if (!name || !category || !Number.isSafeInteger(unitFactor) || unitFactor < 1) {
    throw new Error('Complet\u00e1 nombre, categor\u00eda y factor antes de publicar.');
  }
  return Object.freeze({
    ...draft,
    ...patch,
    name,
    category,
    unitFactor,
    status: 'approved',
    reviewedBy: String(reviewerId),
    reviewedAt: now().toISOString(),
  });
}
