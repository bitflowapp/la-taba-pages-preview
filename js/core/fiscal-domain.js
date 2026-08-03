export const FISCAL_ENVIRONMENTS = Object.freeze(['disabled', 'homologation', 'production']);
export const FISCAL_DOCUMENT_STATES = Object.freeze(['draft', 'queued', 'claiming', 'authenticating', 'authorizing', 'authorized', 'observed', 'rejected', 'ambiguous', 'retry_wait', 'failed', 'credited']);

export function validateFiscalActivation(profile, { operationalConfirmation = false } = {}) {
  const errors = [];
  if (!profile || !FISCAL_ENVIRONMENTS.includes(profile.environment)) errors.push('Ambiente fiscal inv\u00e1lido.');
  if (profile?.environment === 'disabled') errors.push('La facturaci\u00f3n est\u00e1 deshabilitada.');
  if (profile?.environment === 'production') {
    if (profile.accountantReviewStatus !== 'approved') errors.push('Falta aprobaci\u00f3n contable.');
    if (profile.productionGate !== 'approved') errors.push('Falta el gate de producci\u00f3n.');
    if (!operationalConfirmation) errors.push('Falta confirmaci\u00f3n operativa.');
  }
  for (const field of ['cuit', 'pointOfSale', 'taxCondition', 'legalName']) {
    if (!String(profile?.[field] || '').trim()) errors.push(`Falta ${field}.`);
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

export function classifyFiscalResult(response) {
  const result = String(response?.result || '').toUpperCase();
  const cae = String(response?.cae || '').replace(/\D/g, '');
  const observations = Array.isArray(response?.observations) ? response.observations : [];
  if (result === 'A' && cae.length === 14) return observations.length ? 'authorized_with_observations' : 'authorized';
  if (result === 'R') return 'rejected';
  if (response?.ambiguous) return 'ambiguous';
  if (response?.transportError) return 'transport_error';
  if (response?.configurationError) return 'configuration_error';
  return 'service_error';
}

export function canRenderFiscalDocument(document) {
  return document?.state === 'authorized' && /^\d{14}$/.test(String(document?.cae || ''));
}

export function buildFiscalIntentKey({ businessId, sourceType, sourceId, documentIntent }) {
  const parts = [businessId, sourceType, sourceId, documentIntent].map((value) => String(value || '').trim());
  if (parts.some((value) => !value)) throw new Error('La intenci\u00f3n fiscal requiere una clave completa.');
  return parts.join(':');
}
