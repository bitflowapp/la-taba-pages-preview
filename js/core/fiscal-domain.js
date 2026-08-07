export const FISCAL_ENVIRONMENTS = Object.freeze(['disabled', 'homologation', 'production']);
export const FISCAL_DOCUMENT_STATES = Object.freeze(['draft', 'queued', 'claiming', 'authenticating', 'authorizing', 'authorized', 'observed', 'rejected', 'ambiguous', 'retry_wait', 'failed', 'manual_review', 'credited']);

// Las cinco palabras —y sólo esas cinco— que la UI puede decir sobre un
// comprobante. Espejo exacto de public.fiscal_public_state en la base: el
// servidor y la pantalla no pueden discrepar sobre qué pasó con una factura.
export const FISCAL_PUBLIC_STATES = Object.freeze(['pending', 'processing', 'authorized', 'rejected', 'attention']);

export const FISCAL_PUBLIC_STATE_LABELS = Object.freeze({
  pending: 'Pendiente',
  processing: 'Procesando',
  authorized: 'Autorizado',
  rejected: 'Rechazado',
  attention: 'Requiere atención',
});

const FISCAL_PUBLIC_STATE_TONES = Object.freeze({
  pending: 'warning',
  processing: 'warning',
  authorized: 'success',
  rejected: 'danger',
  attention: 'danger',
});

export function fiscalPublicState(state, cae) {
  const value = String(state || '');
  const authorization = String(cae || '');
  if (['authorized', 'credited', 'observed'].includes(value)) {
    // Sin CAE de catorce dígitos no hay autorización: hay un problema. Es la
    // única regla que impide que la pantalla diga "autorizado" por su cuenta.
    return /^\d{14}$/.test(authorization) ? 'authorized' : 'attention';
  }
  if (value === 'rejected') return 'rejected';
  if (['failed', 'manual_review'].includes(value)) return 'attention';
  if (['claiming', 'authenticating', 'authorizing', 'retry_wait', 'ambiguous'].includes(value)) return 'processing';
  if (['draft', 'queued'].includes(value)) return 'pending';
  return 'attention';
}

export function fiscalPublicStateTone(publicState) {
  return FISCAL_PUBLIC_STATE_TONES[publicState] || 'danger';
}

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
