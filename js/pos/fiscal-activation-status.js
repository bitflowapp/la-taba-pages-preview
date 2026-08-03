const NOT_REPORTED = 'no informado por worker privado';

export function buildFiscalActivationStatus(profile = {}, operationCenter = {}, bridgeHealth = {}) {
  const safeProfile = profile && typeof profile === 'object' ? profile : {};
  const safeCenter = operationCenter && typeof operationCenter === 'object' ? operationCenter : {};
  const safeBridge = bridgeHealth && typeof bridgeHealth === 'object' ? bridgeHealth : {};
  const metrics = safeCenter.metrics && typeof safeCenter.metrics === 'object' ? safeCenter.metrics : {};
  const environment = ['disabled', 'homologation', 'production'].includes(String(safeProfile.environment || 'disabled'))
    ? String(safeProfile.environment || 'disabled')
    : 'disabled';
  const cuitConfigured = /^\d{11}$/.test(String(safeProfile.cuit || '').replace(/\D/g, ''));
  const expiringSoon = safeBridge.expiringSoon === true ? 'sí' : safeBridge.expiringSoon === false ? 'no' : NOT_REPORTED;
  return Object.freeze({
    environment,
    cuitConfigured: cuitConfigured ? 'sí' : 'no',
    certificatePresent: triState(safeBridge.certificatePresent),
    privateKeyPresent: triState(safeBridge.privateKeyPresent),
    pairMatches: triState(safeBridge.pairMatches),
    certificateExpiresAt: safeBridge.expiresAt || NOT_REPORTED,
    wsaaRelation: safeBridge.wsaaRelation || 'pendiente',
    wsfev1Relation: safeBridge.wsfeRelation || safeBridge.wsfev1Relation || 'pendiente',
    pointOfSale: safeProfile.point_of_sale ? String(safeProfile.point_of_sale) : 'no configurado',
    taxCondition: safeProfile.tax_condition || 'no configurada',
    accountingPolicy: 'ACCOUNTANT_POLICY_APPROVAL_PENDING',
    arcaConnection: safeBridge.arcaConnection || (environment === 'disabled' ? 'deshabilitada' : 'no verificada'),
    lastTestAt: safeBridge.lastTestAt || 'no ejecutada',
    lastError: safeBridge.lastError || 'sin error sanitizado informado',
    outboxPending: Number.isFinite(Number(metrics.fiscal_documents_pending)) ? Number(metrics.fiscal_documents_pending) : 0,
    certificateExpiring: expiringSoon,
  });
}

function triState(value) {
  if (value === true) return 'sí';
  if (value === false) return 'no';
  return NOT_REPORTED;
}
