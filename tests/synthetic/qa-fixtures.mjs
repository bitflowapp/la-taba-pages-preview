// Datos de la jornada sintética. Todo lleva una etiqueta QA inequívoca para que,
// si alguno se filtrara a una pantalla real, se vea de inmediato que no es una venta.

export const QA_MARKERS = Object.freeze({
  business: 'NEGOCIO QA',
  customer: 'CLIENTE QA',
  rider: 'RIDER QA',
  noCharge: 'NO COBRAR',
  noInvoice: 'NO FACTURAR',
  noDeliver: 'NO ENTREGAR',
});

export const QA_BUSINESS_ID = '00000000-0000-4000-8000-0000000000a1';
export const QA_OWNER_ID = '00000000-0000-4000-8000-0000000000b1';
export const QA_STAFF_ID = '00000000-0000-4000-8000-0000000000c1';
export const QA_RIDER_ID = '00000000-0000-4000-8000-0000000000d1';
export const QA_CUSTOMER_ID = '00000000-0000-4000-8000-0000000000e1';

export const QA_ACTORS = Object.freeze({
  owner: Object.freeze({ id: QA_OWNER_ID, role: 'owner', name: `${QA_MARKERS.business} · Walter QA` }),
  staff: Object.freeze({ id: QA_STAFF_ID, role: 'staff', name: `${QA_MARKERS.business} · Empleado QA` }),
  rider: Object.freeze({ id: QA_RIDER_ID, role: 'rider', name: QA_MARKERS.rider }),
  customer: Object.freeze({ id: QA_CUSTOMER_ID, role: 'customer', name: QA_MARKERS.customer }),
});

// Códigos con dígito verificador correcto, uno por formato soportado.
export const QA_BARCODES = Object.freeze({
  ean8: '96385074',
  upca: '036000291452',
  ean13: '7790895000997',
  gtin14: '17790895000994',
  packEan13: '7790895001000',
  invalidCheckDigit: '7790895000998',
  unknown: '4006381333931',
  nonNumeric: 'QA-CODIGO-INTERNO',
  unsupportedLength: '12345',
});

export const QA_PRODUCTS = Object.freeze([
  Object.freeze({
    id: 'qa-product-agua',
    name: `${QA_MARKERS.business} Agua QA`,
    brand: 'Marca QA',
    category: 'Aguas QA',
    variant: 'Botella 500 ml',
    capacityValue: 500,
    capacityUnit: 'ml',
    unitsPerPack: 1,
    packageType: 'unit',
    price: 1200,
    priceStatus: 'confirmed',
    stock: 40,
    barcodes: [{ gtin: QA_BARCODES.ean13, unitFactor: 1, packageType: 'unit' }],
    imageBound: true,
    verified: true,
  }),
  Object.freeze({
    id: 'qa-product-gaseosa-pack',
    name: `${QA_MARKERS.business} Gaseosa QA pack`,
    brand: 'Marca QA',
    category: 'Gaseosas QA',
    variant: 'Pack 6 x 350 ml',
    capacityValue: 350,
    capacityUnit: 'ml',
    unitsPerPack: 6,
    packageType: 'pack',
    price: 6000,
    priceStatus: 'confirmed',
    stock: 24,
    barcodes: [{ gtin: QA_BARCODES.packEan13, unitFactor: 6, packageType: 'pack' }],
    imageBound: true,
    verified: true,
  }),
  Object.freeze({
    id: 'qa-product-ean8',
    name: `${QA_MARKERS.business} Snack QA`,
    brand: 'Marca QA',
    category: 'Snacks QA',
    variant: 'Bolsa 80 g',
    capacityValue: 80,
    capacityUnit: 'g',
    unitsPerPack: 1,
    packageType: 'unit',
    price: 900,
    priceStatus: 'confirmed',
    stock: 15,
    barcodes: [
      { gtin: QA_BARCODES.ean8, unitFactor: 1, packageType: 'unit' },
      { gtin: QA_BARCODES.upca, unitFactor: 1, packageType: 'unit' },
      { gtin: QA_BARCODES.gtin14, unitFactor: 12, packageType: 'case' },
    ],
    imageBound: true,
    verified: true,
  }),
]);

export const QA_ORDER = Object.freeze({
  code: 'LT-QA-0001',
  customerName: QA_MARKERS.customer,
  note: `${QA_MARKERS.noDeliver} · pedido sintético de certificación`,
  items: Object.freeze([
    Object.freeze({ productId: 'qa-product-agua', quantity: 2 }),
    Object.freeze({ productId: 'qa-product-ean8', quantity: 1 }),
  ]),
});

// Los seis casos de pago que el panel tiene que saber contar.
export const QA_PAYMENT_FIXTURES = Object.freeze([
  Object.freeze({
    id: 'qa-pay-pending',
    label: `${QA_MARKERS.noCharge} pendiente`,
    internal_status: 'in_process',
    expected: 'pending',
    amount: 4200,
  }),
  Object.freeze({
    id: 'qa-pay-approved',
    label: `${QA_MARKERS.noCharge} aprobado`,
    internal_status: 'completed',
    orderCode: QA_ORDER.code,
    expected: 'approved',
    amount: 3300,
  }),
  Object.freeze({
    id: 'qa-pay-rejected',
    label: `${QA_MARKERS.noCharge} rechazado`,
    internal_status: 'rejected',
    expected: 'rejected',
    amount: 2100,
  }),
  Object.freeze({
    id: 'qa-pay-orphan',
    label: `${QA_MARKERS.noCharge} aprobado sin pedido`,
    internal_status: 'approved_order_pending',
    expected: 'approved-without-order',
    amount: 5400,
  }),
  Object.freeze({
    id: 'qa-pay-refund-ambiguous',
    label: `${QA_MARKERS.noCharge} devolución dudosa`,
    internal_status: 'ambiguous',
    latest_refund_status: 'ambiguous',
    expected: 'in-review',
    amount: 1800,
  }),
  Object.freeze({
    id: 'qa-pay-amount-mismatch',
    label: `${QA_MARKERS.noCharge} importe distinto`,
    internal_status: 'security_review_required',
    expected: 'in-review',
    amount: 9900,
    declaredAmount: 8800,
  }),
]);

export const QA_FISCAL_FIXTURES = Object.freeze({
  available: Object.freeze({
    id: 'arca-available',
    label: 'ARCA disponible',
    behaviour: 'authorized',
    profile: baseFiscalProfile(),
  }),
  down: Object.freeze({
    id: 'arca-down',
    label: 'ARCA caído',
    behaviour: 'unreachable',
    errorCode: 'SERVICE_UNAVAILABLE',
    profile: { ...baseFiscalProfile(), last_error_code: 'SERVICE_UNAVAILABLE' },
  }),
  expiredCertificate: Object.freeze({
    id: 'arca-cert-expired',
    label: 'Certificado vencido',
    behaviour: 'blocked',
    errorCode: 'CERTIFICATE_EXPIRED',
    profile: {
      ...baseFiscalProfile(),
      certificate_expires_at: new Date(Date.now() - 86_400_000).toISOString(),
      last_error_code: 'CERTIFICATE_EXPIRED',
    },
  }),
  ambiguous: Object.freeze({
    id: 'arca-ambiguous',
    label: 'Respuesta ambigua',
    behaviour: 'ambiguous',
    profile: baseFiscalProfile(),
  }),
  pendingDocument: Object.freeze({
    id: 'arca-pending',
    label: 'Comprobante pendiente',
    behaviour: 'queued',
    profile: { ...baseFiscalProfile(), pending_documents: 1 },
  }),
  failedArtifact: Object.freeze({
    id: 'arca-pdf-failed',
    label: 'PDF fallido',
    behaviour: 'artifact_failed',
    profile: baseFiscalProfile(),
  }),
});

function baseFiscalProfile() {
  return {
    legal_name: `${QA_MARKERS.business} SRL`,
    cuit: '30712345678',
    cuit_valid: true,
    tax_condition: 'Responsable Inscripto',
    business_address: 'Calle QA 123',
    accountant_review_status: 'approved',
    environment: 'homologation',
    point_of_sale: 9,
    certificate_loaded: true,
    certificate_expires_at: new Date(Date.now() + 120 * 86_400_000).toISOString(),
    certificate_cuit_mismatch: false,
    delegation_status: 'verified',
    connection_ok_at: new Date().toISOString(),
    homologation_authorized_at: new Date().toISOString(),
    homologated_invoices: 1,
    homologated_credit_notes: 1,
    artifact_verified_at: new Date().toISOString(),
    print_verified_at: new Date().toISOString(),
    pending_documents: 0,
    stalled_documents: 0,
    last_error_code: null,
    last_error_at: null,
  };
}

// Ninguna etiqueta QA debe poder confundirse con una operación real.
export function assertQaLabelled(value, label = 'valor') {
  const text = String(value ?? '');
  if (!Object.values(QA_MARKERS).some((marker) => text.includes(marker)) && !/QA/i.test(text)) {
    throw new Error(`El ${label} sintético no está etiquetado como QA: ${text}`);
  }
  return true;
}
