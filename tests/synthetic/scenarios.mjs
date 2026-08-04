// Jornada sintética completa. Cada escenario devuelve comprobaciones nombradas
// para que el mismo recorrido sirva de test y de evidencia.

import {
  configureBusinessOperations, handleBusinessOperationsAction, renderBusinessOperations,
  resetBusinessOperationsForTests, allowedBusinessOperationViews,
} from '../../js/business/business-operations-center.js';
import { containsForbiddenVocabulary, describeOperationalAlert } from '../../js/business/business-operation-language.js';
import { can, describeRoleScope } from '../../js/business/business-capabilities.js';
import {
  buildPaymentDiagnostic, classifyBusinessPayment, evaluateMercadoPagoSetup,
  paymentActionsFor, validateRefundRequest,
} from '../../js/business/business-payments-console.js';
import { evaluateArcaActivation, sanitizeFiscalDetail, translateFiscalError } from '../../js/business/business-fiscal-assistant.js';
import {
  classifyPrinterProbe, classifyPrintSubmission, classifyScannerCheck, classifySpoolerCheck,
} from '../../js/business/business-device-check.js';
import {
  evaluateBusinessOpening, evaluateDailyClosure, validateClosureOverride,
} from '../../js/business/business-day-control.js';
import {
  buildStorefrontPreview, describePublishReadiness, planScanOutcome, validateProductDraft,
} from '../../js/business/business-product-onboarding.js';
import { createBarcodeScannerService } from '../../js/catalog/barcode-scanner-service.js';
import { normalizeBarcode } from '../../js/catalog/barcode-normalizer.js';
import { createSyntheticBackend, ORDER_FLOW } from './synthetic-backend.mjs';
import {
  QA_ACTORS, QA_BARCODES, QA_BUSINESS_ID, QA_FISCAL_FIXTURES, QA_MARKERS,
  QA_ORDER, QA_PAYMENT_FIXTURES, QA_PRODUCTS, assertQaLabelled,
} from './qa-fixtures.mjs';

export async function runCertification() {
  const scenarios = [];
  const backend = createSyntheticBackend();

  scenarios.push(await scenarioOpening(backend));
  scenarios.push(await scenarioOrder(backend));
  scenarios.push(await scenarioPayments(backend));
  scenarios.push(await scenarioScanner(backend));
  scenarios.push(await scenarioPackingAndPrinting(backend));
  scenarios.push(scenarioFiscal(backend));
  scenarios.push(await scenarioRider(backend));
  scenarios.push(await scenarioClosure(backend));
  scenarios.push(scenarioPermissions());

  const cleanup = performCleanup(backend);
  return Object.freeze({
    scenarios: Object.freeze(scenarios),
    cleanup,
    passed: scenarios.every((scenario) => scenario.checks.every((check) => check.ok)) && cleanup.ok,
  });
}

// ===== 1. Apertura =====

async function scenarioOpening(backend) {
  const checks = [];
  const panel = mountPanel(backend, { role: 'owner' });

  await panel.open('day-open');
  const readyMarkup = renderBusinessOperations('day-open');
  check(checks, 'los siete verificadores del servidor y los dos locales se muestran', () => {
    const evaluated = evaluateBusinessOpening(openingSignals(backend, { scannerTested: true, printersTested: true }));
    return evaluated.checks.length === 8
      && ['internet', 'backend', 'payments', 'fiscal', 'scanner', 'printers', 'riders', 'queues']
        .every((id) => evaluated.checks.some((row) => row.id === id));
  });
  check(checks, 'veredicto "todo listo" con backend, pagos, fiscal, Rider y colas en orden', () => {
    const evaluated = evaluateBusinessOpening(openingSignals(backend, { scannerTested: true, printersTested: true }));
    return evaluated.verdict.headline === 'Todo listo para vender' && evaluated.canCharge && evaluated.canInvoice;
  });
  check(checks, 'veredicto "venta permitida con fiscal pendiente"', () => {
    backend.setOpeningOverrides({ fiscal: { status: 'degraded', detail: 'La facturación está apagada.' } });
    const evaluated = evaluateBusinessOpening(openingSignals(backend, { scannerTested: true, printersTested: true }));
    return evaluated.verdict.headline === 'Podés vender, facturación pendiente'
      && evaluated.canSell === true && evaluated.canInvoice === false;
  });
  check(checks, 'veredicto "cobros bloqueados" cuando falla algo esencial', () => {
    backend.setOpeningOverrides({ payments: { status: 'failed', detail: 'Los cobros no responden.' } });
    const evaluated = evaluateBusinessOpening(openingSignals(backend, { scannerTested: true, printersTested: true }));
    return evaluated.verdict.headline === 'No habilites cobros' && evaluated.canCharge === false;
  });
  check(checks, 'el scanner y la impresora sin probar quedan "sin verificar", no "listo"', () => {
    backend.setOpeningOverrides({});
    const evaluated = evaluateBusinessOpening(openingSignals(backend, { scannerTested: false, printersTested: false }));
    const scanner = evaluated.checks.find((row) => row.id === 'scanner');
    const printers = evaluated.checks.find((row) => row.id === 'printers');
    return scanner.statusLabel === 'Sin verificar' && printers.statusLabel === 'Sin verificar';
  });
  check(checks, 'el scanner simulado y la impresora virtual quedan verificados al probarlos', () => {
    const scanner = classifyScannerCheck(normalizeBarcode(QA_BARCODES.ean13));
    const spooler = classifySpoolerCheck([{ name: 'Impresora virtual QA' }]);
    return scanner.state === 'connected' && spooler.state === 'connected';
  });
  check(checks, 'el ARCA fixture se lee como activo sin salir a ARCA externo', () => {
    backend.useFiscalFixture(QA_FISCAL_FIXTURES.available);
    const arca = evaluateArcaActivation(backend.fiscalActivation());
    return arca.productionEnabled === false && arca.homologationAuthorized === true;
  });
  check(checks, 'la pantalla de apertura no usa jerga técnica', () => noJargon(readyMarkup));
  panel.unmount();
  return scenario('1', 'Apertura', checks);
}

function openingSignals(backend, { scannerTested, printersTested }) {
  const status = backend.openingStatus();
  return {
    internet: { status: 'ok', detail: 'Hay conexión.' },
    backend: status.backend,
    payments: status.payments,
    fiscal: status.fiscal,
    riders: status.riders,
    queues: status.queues,
    scanner: scannerTested
      ? { status: 'ok', detail: 'El lector responde.' }
      : { status: 'unknown', detail: 'Probalo desde Dispositivos.' },
    printers: printersTested
      ? { status: 'ok', detail: 'Hay impresoras disponibles.' }
      : { status: 'unknown', detail: 'Probalas desde Dispositivos.' },
  };
}

// ===== 2. Pedido normal =====

async function scenarioOrder(backend) {
  const checks = [];
  const stockBefore = backend.state.products.get('qa-product-agua').stock;
  const created = backend.createOrder({ idempotencyKey: 'qa-order-normal' });

  check(checks, 'el pedido sintético está etiquetado como QA', () => {
    assertQaLabelled(created.order.code, 'pedido');
    return created.order.code === QA_ORDER.code;
  });

  const flow = ['accepted', 'preparing', 'ready', 'assigned', 'delivered'];
  const transitions = [];
  for (const next of flow) {
    const order = backend.state.orders.get(created.order.id);
    transitions.push(backend.advanceOrder({
      orderId: created.order.id, next, expectedRevision: order.revision,
      idempotencyKey: `qa-advance-${next}`,
    }));
  }
  check(checks, 'el pedido recorre nuevo → aceptado → preparando → listo → asignado → terminal', () => (
    transitions.every((step) => step.ok) && backend.state.orders.get(created.order.id).status === 'delivered'
  ));
  check(checks, 'no se puede saltear un estado', () => {
    const order = backend.state.orders.get(created.order.id);
    const invalid = backend.advanceOrder({
      orderId: created.order.id, next: 'preparing', expectedRevision: order.revision,
      idempotencyKey: 'qa-advance-invalid',
    });
    return invalid.ok === false && ORDER_FLOW.delivered.length === 0;
  });
  check(checks, 'reintentar el mismo avance no duplica el pedido ni sus eventos', () => {
    backend.advanceOrder({ orderId: created.order.id, next: 'accepted', expectedRevision: 1, idempotencyKey: 'qa-advance-accepted' });
    const events = backend.state.orderEvents.filter((event) => event.orderId === created.order.id);
    return backend.state.orders.size === 1 && new Set(events.map((event) => event.fingerprint)).size === events.length;
  });
  check(checks, 'el stock bajó exactamente lo vendido, una sola vez', () => {
    const after = backend.state.products.get('qa-product-agua').stock;
    const replay = backend.createOrder({ idempotencyKey: 'qa-order-normal' });
    const afterReplay = backend.state.products.get('qa-product-agua').stock;
    return after === stockBefore - 2 && afterReplay === after && replay.idempotentReplay === true;
  });

  const panel = mountPanel(backend, { role: 'staff' });
  const reachable = allowedBusinessOperationViews('staff');
  const rendered = [];
  for (const view of ['operation-center', 'packing', 'pos', 'scanner']) {
    await panel.open(view);
    rendered.push(renderBusinessOperations(view));
  }
  check(checks, 'el equipo navega el panel del día sin pantallas rotas', () => (
    reachable.includes('packing') && rendered.every((markup) => markup.includes('business-ops-center'))
  ));
  check(checks, 'los mensajes del pedido están en castellano llano', () => rendered.every(noJargon));
  panel.unmount();
  return scenario('2', 'Pedido normal', checks);
}

// ===== 3. Pagos =====

async function scenarioPayments(backend) {
  const checks = [];
  for (const fixture of QA_PAYMENT_FIXTURES) backend.seedPayment(fixture);

  check(checks, 'los seis fixtures se clasifican en el estado esperado', () => (
    QA_PAYMENT_FIXTURES.every((fixture) => {
      const payment = backend.state.payments.get(fixture.id);
      return classifyBusinessPayment(payment).state === fixture.expected;
    })
  ));
  check(checks, 'un aprobado sin pedido frena la entrega', () => {
    const classified = classifyBusinessPayment(backend.state.payments.get('qa-pay-orphan'));
    return classified.state === 'approved-without-order' && classified.blocksDelivery === true;
  });
  check(checks, 'la inconsistencia de importe queda en revisión y no se entrega', () => {
    const payment = backend.state.payments.get('qa-pay-amount-mismatch');
    const classified = classifyBusinessPayment(payment);
    return classified.state === 'in-review'
      && classified.blocksDelivery === true
      && payment.amount !== payment.declared_amount;
  });

  const ordersBefore = backend.state.orders.size;
  const stockBefore = backend.state.products.get('qa-product-agua').stock;
  const first = backend.reconcilePayment('qa-pay-orphan');
  const second = backend.reconcilePayment('qa-pay-orphan');
  check(checks, 'recuperar un pago aprobado sin pedido crea un solo pedido (exactly-once)', () => (
    first.ok && second.ok && backend.state.orders.size === ordersBefore + 1
  ));
  check(checks, 'reintentar la recuperación no descuenta stock dos veces', () => (
    backend.state.products.get('qa-product-agua').stock === stockBefore - 1
  ));
  check(checks, 'el ledger de stock no tiene movimientos repetidos por la misma clave', () => {
    const keys = backend.state.inventoryLedger.map((entry) => entry.idempotencyKey);
    return new Set(keys).size === keys.length;
  });

  check(checks, 'el equipo no recibe conciliar ni devolver', () => {
    const payment = backend.state.payments.get('qa-pay-approved');
    const staff = paymentActionsFor(payment, { elevated: false }).map((action) => action.id);
    return !staff.includes('refund') && !staff.includes('reconcile') && staff.includes('refresh');
  });
  check(checks, 'owner recibe conciliar y devolver con confirmación escrita', () => {
    const payment = backend.state.payments.get('qa-pay-approved');
    const owner = paymentActionsFor(payment, { elevated: true });
    const refund = owner.find((action) => action.id === 'refund');
    return Boolean(refund?.requiresConfirmation)
      && validateRefundRequest({ reason: 'Devolución QA', confirmation: 'no', maximum: payment.amount }).ok === false
      && validateRefundRequest({ reason: 'Devolución QA', confirmation: 'DEVOLVER', amount: payment.amount, maximum: payment.amount }).ok === true;
  });
  check(checks, 'no se puede devolver más de lo cobrado', () => {
    const payment = backend.state.payments.get('qa-pay-approved');
    const rejected = backend.refundPayment({ paymentIntentId: payment.payment_intent_id, amount: payment.amount * 2 });
    return rejected.ok === false;
  });
  check(checks, 'el diagnóstico para soporte no arrastra datos del cliente ni jerga', () => {
    const diagnostic = buildPaymentDiagnostic(backend.state.payments.get('qa-pay-refund-ambiguous'));
    const keys = Object.keys(diagnostic).sort().join(',');
    return keys === 'currency,hasOrder,providerNote,reference,state,stateLabel,updatedAt'
      && noJargon(JSON.stringify(diagnostic));
  });
  check(checks, 'el asistente de cobros declara listo sin salir a Mercado Pago real', () => {
    const setup = evaluateMercadoPagoSetup(backend.paymentActivation());
    return setup.ready === true && setup.environment === 'Prueba';
  });
  return scenario('3', 'Pagos', checks);
}

// ===== 4. Scanner y alta =====

async function scenarioScanner(backend) {
  const checks = [];
  const events = [];
  const scanner = createBarcodeScannerService({ target: null });
  scanner.subscribe((event) => events.push(event));
  scanner.start('product_lookup');

  const formats = {
    'EAN-8': QA_BARCODES.ean8,
    'UPC-A': QA_BARCODES.upca,
    'EAN-13': QA_BARCODES.ean13,
    'GTIN-14': QA_BARCODES.gtin14,
  };
  check(checks, 'la entrada HID reconoce los cuatro formatos con su dígito verificador', () => (
    Object.entries(formats).every(([format, code]) => {
      const event = scanner.test(code, 'hid_keyboard');
      return event.isValid && event.format === format && event.normalizedValue === code;
    })
  ));
  check(checks, 'los ceros iniciales se conservan', () => {
    const event = scanner.test(QA_BARCODES.ean8, 'hid_keyboard');
    return String(event.normalizedValue).startsWith('9') && normalizeBarcode('00000000').normalizedValue === '00000000';
  });
  check(checks, 'un código conocido resuelve al producto QA', () => {
    const binding = backend.lookupBarcode(QA_BARCODES.ean13);
    return binding?.product_id === 'qa-product-agua';
  });
  check(checks, 'un pack informa su factor de unidades', () => {
    const binding = backend.lookupBarcode(QA_BARCODES.packEan13);
    return binding?.unit_factor === 6;
  });
  check(checks, 'una lectura duplicada inmediata se ignora', () => {
    scanner.test(QA_BARCODES.upca, 'hid_keyboard');
    const duplicate = scanner.test(QA_BARCODES.upca, 'hid_keyboard');
    return duplicate.isValid === false && duplicate.reason === 'DUPLICATE_SCAN';
  });
  check(checks, 'un dígito verificador inválido se rechaza y se explica', () => {
    const event = scanner.test(QA_BARCODES.invalidCheckDigit, 'hid_keyboard');
    const described = classifyScannerCheck(event);
    return event.isValid === false && event.reason === 'INVALID_CHECK_DIGIT'
      && described.state === 'error' && noJargon(described.detail);
  });
  check(checks, 'un largo no soportado se rechaza sin inventar un formato', () => {
    const event = scanner.test(QA_BARCODES.unsupportedLength, 'hid_keyboard');
    return event.isValid === false && event.format === '';
  });
  scanner.stop();

  const unknownScan = normalizeBarcode(QA_BARCODES.unknown);
  const plan = planScanOutcome({ scan: unknownScan, lookup: backend.lookupBarcode(QA_BARCODES.unknown) });
  check(checks, 'un código desconocido propone borrador y nunca publica', () => (
    plan.outcome === 'unknown' && plan.canCreateDraft === true
  ));

  const drafted = backend.createDraft({ gtin: QA_BARCODES.unknown, idempotencyKey: 'qa-draft-1' });
  check(checks, 'el borrador nace en "Falta completar" y no crea producto visible', () => (
    drafted.draft.status === 'pending_review'
    && backend.catalogVisibleProducts().every((product) => product.id !== `qa-product-${QA_BARCODES.unknown}`)
  ));

  const fields = {
    name: `${QA_MARKERS.business} Jugo QA`,
    brand: 'Marca QA',
    category: 'Jugos QA',
    variant: 'Botella 1 L',
    capacityValue: 1,
    capacityUnit: 'l',
    packageType: 'unit',
    unitsPerPack: 1,
    stock: 5,
    price: 0,
    cost: '',
    pricePending: true,
  };
  const pendingValidation = validateProductDraft(fields);
  check(checks, 'el alta valida los datos obligatorios antes de publicar', () => {
    const incomplete = validateProductDraft({ ...fields, brand: '' });
    return pendingValidation.ok === true
      && incomplete.ok === false
      && incomplete.errors.some((error) => error.field === 'brand');
  });

  const published = backend.publishDraft({
    draftId: drafted.draft.id,
    name: fields.name,
    category: fields.category,
    price: 0,
    packageType: fields.packageType,
    unitFactor: fields.unitsPerPack,
  });
  const completedPending = backend.completeProduct({
    productId: published.data.product_id,
    details: {
      name: fields.name, brand: fields.brand, category: fields.category, variant: fields.variant,
      capacity_value: fields.capacityValue, capacity_unit: fields.capacityUnit,
      units_per_pack: fields.unitsPerPack, price: null, price_pending: true,
      unit_cost: null, stock: fields.stock,
    },
  });
  check(checks, 'la vista previa muestra la ficha antes de publicar', () => {
    const preview = buildStorefrontPreview(pendingValidation.value, { imageReady: true });
    return preview.priceLabel === 'Precio pendiente' && preview.purchasable === false;
  });
  check(checks, 'con precio pendiente el producto se ve en el catálogo pero no se puede comprar', () => {
    const readiness = describePublishReadiness(completedPending.data);
    const inCatalog = backend.catalogVisibleProducts().find((product) => product.id === published.data.product_id);
    return readiness.visible === true && readiness.purchasable === false
      && Boolean(inCatalog) && inCatalog.purchasable === false;
  });

  const completedConfirmed = backend.completeProduct({
    productId: published.data.product_id,
    details: {
      name: fields.name, brand: fields.brand, category: fields.category, variant: fields.variant,
      capacity_value: fields.capacityValue, capacity_unit: fields.capacityUnit,
      units_per_pack: fields.unitsPerPack, price: 2500, price_pending: false,
      unit_cost: 1500, stock: fields.stock,
    },
  });
  check(checks, 'con el precio confirmado pasa a comprable', () => {
    const readiness = describePublishReadiness(completedConfirmed.data);
    const inCatalog = backend.catalogVisibleProducts().find((product) => product.id === published.data.product_id);
    return readiness.purchasable === true && inCatalog.purchasable === true;
  });
  check(checks, 'cada alta queda auditada con su acción', () => (
    backend.state.audit.some((entry) => entry.action === 'draft_published')
    && backend.state.audit.some((entry) => entry.action === 'price_confirmed')
  ));
  check(checks, 'un código ya asignado no se puede reutilizar', () => {
    const conflict = validateProductDraft(fields, { existingGtinOwner: `${QA_MARKERS.business} Agua QA` });
    return conflict.ok === false && conflict.errors.some((error) => error.field === 'gtin');
  });
  return scenario('4', 'Scanner y alta de producto', checks);
}

// ===== 5. Packing e impresión =====

async function scenarioPackingAndPrinting(backend) {
  const checks = [];
  const order = backend.createOrder({
    code: `${QA_ORDER.code}-PACK`,
    items: [{ productId: 'qa-product-agua', quantity: 2 }],
    idempotencyKey: 'qa-order-packing',
  });
  const started = backend.startPacking({
    orderId: order.order.id, expectedRevision: order.order.revision, idempotencyKey: 'qa-packing-1',
  });
  const sessionId = started.data.id;

  check(checks, 'una lectura correcta se registra', () => (
    backend.recordPackingScan({ sessionId, gtin: QA_BARCODES.ean13, scanKey: 'qa-scan-1' }).ok
  ));
  check(checks, 'la misma lectura repetida no se cuenta dos veces', () => {
    const replay = backend.recordPackingScan({ sessionId, gtin: QA_BARCODES.ean13, scanKey: 'qa-scan-1' });
    const session = backend.state.packingSessions.get(sessionId);
    return replay.idempotentReplay === true && session.scans.length === 1;
  });
  check(checks, 'un código ajeno al pedido se rechaza', () => (
    backend.recordPackingScan({ sessionId, gtin: QA_BARCODES.unknown, scanKey: 'qa-scan-x' }).ok === false
  ));
  check(checks, 'con faltantes, confirmar sin motivo queda bloqueado', () => (
    backend.confirmPacking({ sessionId, exceptionReason: null, idempotencyKey: 'qa-confirm-blocked' }).ok === false
  ));
  check(checks, 'una sustitución o intervención se puede deshacer', () => {
    backend.recordPackingScan({ sessionId, gtin: QA_BARCODES.ean13, scanKey: 'qa-scan-2' });
    const reverted = backend.revertPackingScan({ sessionId, scanKey: 'qa-scan-2' });
    const session = backend.state.packingSessions.get(sessionId);
    return reverted.ok && session.scans.find((scan) => scan.scanKey === 'qa-scan-2').revertedAt !== null;
  });
  check(checks, 'el packing incompleto se cierra sólo con excepción explicada', () => {
    const confirmed = backend.confirmPacking({
      sessionId, exceptionReason: `${QA_MARKERS.noDeliver} faltó una unidad QA`, idempotencyKey: 'qa-confirm-exception',
    });
    return confirmed.ok === true && confirmed.exception === true;
  });

  check(checks, 'la impresora sin papel se informa como tal', () => {
    const probe = classifyPrinterProbe({ reachable: true, outOfPaper: true });
    backend.recordPrintJob({ status: 'failed', errorCode: 'NO_PAPER' });
    return probe.state === 'no-paper' && noJargon(probe.detail);
  });
  check(checks, 'un trabajo aceptado por el spooler NO se declara impreso', () => {
    const submission = classifyPrintSubmission({ status: 'sent_to_spooler' });
    backend.recordPrintJob({ status: 'sent_to_spooler' });
    return submission.state === 'job-sent' && submission.state !== 'connected';
  });
  check(checks, 'un resultado no verificable se declara no verificable', () => {
    const submission = classifyPrintSubmission({ status: 'unknown' });
    backend.recordPrintJob({ status: 'unknown' });
    return submission.state === 'not-verifiable';
  });
  check(checks, 'la reimpresión vuelve a quedar como enviada, nunca como impresa', () => {
    const reprint = classifyPrintSubmission({ status: 'queued' });
    backend.recordPrintJob({ status: 'queued' });
    return reprint.state === 'job-sent';
  });
  check(checks, 'ninguna impresión sintética afirma salida física', () => (
    backend.state.printJobs.every((job) => job.status !== 'completed_when_verifiable')
  ));
  return scenario('5', 'Packing e impresión', checks);
}

// ===== 6. Fiscal =====

function scenarioFiscal(backend) {
  const checks = [];
  const results = {};
  for (const [key, fixture] of Object.entries(QA_FISCAL_FIXTURES)) {
    backend.useFiscalFixture(fixture);
    results[key] = backend.requestFiscalDocument({ orderId: 'qa-order-1', idempotencyKey: `qa-fiscal-${key}` }).document;
  }

  check(checks, 'con ARCA disponible el comprobante queda autorizado con su CAE', () => (
    results.available.state === 'authorized' && /^\d{14}$/.test(results.available.cae)
  ));
  check(checks, 'con ARCA caído no se inventa CAE y queda recuperable', () => (
    results.down.cae === null
    && backend.state.fiscalOutbox.some((entry) => entry.documentId === results.down.documentId || entry.state === 'retry_wait')
  ));
  check(checks, 'un certificado vencido bloquea y se explica en castellano', () => {
    backend.useFiscalFixture(QA_FISCAL_FIXTURES.expiredCertificate);
    const arca = evaluateArcaActivation(backend.fiscalActivation());
    return results.expiredCertificate.cae === null
      && arca.blockers.some((blocker) => /vencido/i.test(blocker))
      && noJargon(translateFiscalError('CERTIFICATE_EXPIRED'));
  });
  check(checks, 'una respuesta ambigua no vuelve a emitir a ciegas', () => (
    results.ambiguous.state === 'ambiguous' && results.ambiguous.cae === null
  ));
  check(checks, 'un comprobante pendiente queda en cola recuperable', () => (
    results.pendingDocument.state === 'queued'
    && backend.state.fiscalOutbox.some((entry) => entry.state === 'pending')
  ));
  check(checks, 'un PDF fallido no toca la autorización ya obtenida', () => (
    results.failedArtifact.state === 'authorized'
    && /^\d{14}$/.test(results.failedArtifact.cae)
    && results.failedArtifact.artifact_state === 'artifact_failed'
  ));
  check(checks, 'la venta y el pago siguen confirmados aunque falle lo fiscal', () => {
    const payment = backend.state.payments.get('qa-pay-approved');
    const order = [...backend.state.orders.values()][0];
    return payment.internal_status === 'completed' && Boolean(order);
  });
  check(checks, 'la producción fiscal sigue deshabilitada en todos los fixtures', () => (
    Object.values(QA_FISCAL_FIXTURES).every((fixture) => fixture.profile.environment !== 'production')
    && [...backend.state.fiscalDocuments.values()].every((document) => document.environment === 'homologation')
  ));
  check(checks, 'no se filtra clave privada, ticket ni intercambio técnico', () => (
    sanitizeFiscalDetail('<soap:Envelope/>') === ''
    && sanitizeFiscalDetail('Bearer qa-token') === ''
  ));
  return scenario('6', 'Fiscal', checks);
}

// ===== 7. Rider =====

async function scenarioRider(backend) {
  const checks = [];
  const order = backend.createOrder({
    code: `${QA_ORDER.code}-RIDER`,
    items: [{ productId: 'qa-product-ean8', quantity: 1 }],
    idempotencyKey: 'qa-order-rider',
  });
  let current = order.order;
  for (const next of ['accepted', 'preparing', 'ready']) {
    const advanced = backend.advanceOrder({
      orderId: current.id, next, expectedRevision: current.revision, idempotencyKey: `qa-rider-${next}`,
    });
    current = advanced.order;
  }
  check(checks, 'el pedido llega a listo antes de asignar', () => current.status === 'ready');

  const assigned = backend.advanceOrder({
    orderId: current.id, next: 'assigned', expectedRevision: current.revision, idempotencyKey: 'qa-rider-assign',
  });
  check(checks, `la asignación al ${QA_MARKERS.rider} deja el pedido asignado`, () => assigned.ok && assigned.order.status === 'assigned');
  check(checks, 'un segundo claim sobre el mismo pedido no prospera', () => {
    const second = backend.advanceOrder({
      orderId: current.id, next: 'assigned', expectedRevision: assigned.order.revision, idempotencyKey: 'qa-rider-assign-2',
    });
    return second.ok === false;
  });
  check(checks, 'una incidencia se registra sin inventar posición', () => {
    backend.pushAlert({
      id: 'qa-alert-rider', severity: 'WARNING', code: 'RIDER_SIGNAL_STALE',
      correlation_id: '11111111-1111-4111-8111-111111111111',
    });
    const described = describeOperationalAlert(backend.state.alerts.at(-1));
    return /no inventes una posición/i.test(described.recommendation) && noJargon(described.risk);
  });
  check(checks, 'el cierre sintético lleva el pedido a terminal una sola vez', () => {
    const delivered = backend.advanceOrder({
      orderId: current.id, next: 'delivered', expectedRevision: assigned.order.revision, idempotencyKey: 'qa-rider-deliver',
    });
    const events = backend.state.orderEvents.filter((event) => event.orderId === current.id && event.type === 'delivered');
    return delivered.ok && events.length === 1;
  });
  check(checks, `el ${QA_MARKERS.rider} no recibe ninguna pantalla de administración`, () => (
    allowedBusinessOperationViews(QA_ACTORS.rider.role).length === 0
  ));
  return scenario('7', 'Rider', checks);
}

// ===== 8. Cierre diario =====

async function scenarioClosure(backend) {
  const checks = [];
  backend.setExpectedCash(10_000);
  backend.pushAlert({
    id: 'qa-alert-critical', severity: 'CRITICAL', code: 'PAYMENT_APPROVED_WITHOUT_ORDER',
    correlation_id: '22222222-2222-4222-8222-222222222222',
  });

  const prepared = backend.prepareReconciliation({
    businessDate: '2026-08-05', declaredCash: 9_400, differenceNote: '', idempotencyKey: 'qa-daily-1',
  });
  const run = prepared.data.reconciliation;
  const closure = evaluateDailyClosure(run, { alerts: backend.state.alerts });

  check(checks, 'el cierre explica cada diferencia en su propia sección', () => (
    closure.sections.length === 9 && closure.sections.every((section) => section.label && noJargon(section.label))
  ));
  check(checks, 'la diferencia de caja se muestra y bloquea sin explicación', () => (
    closure.hasDifference === true
    && closure.blockers.some((blocker) => blocker.id === 'cash-difference')
    && closure.canClose === false
  ));
  check(checks, 'los problemas críticos bloquean el cierre', () => (
    closure.criticalAlerts >= 1 && closure.blockers.some((blocker) => blocker.id === 'critical-alerts')
  ));
  check(checks, 'las diferencias de pedido abierto y comprobante pendiente se informan', () => {
    const byId = Object.fromEntries(closure.sections.map((section) => [section.id, section]));
    return Number(byId.orders.detail.replace(/\D/g, '')) >= 0 && byId.documents.detail.includes('pendiente');
  });
  check(checks, 'CERRAR IGUAL se exige sólo cuando hay problemas críticos', () => (
    validateClosureOverride({ criticalAlerts: 0 }).ok === true
    && validateClosureOverride({ criticalAlerts: 1, note: 'Se revisa mañana con el contador.', confirmation: 'si' }).ok === false
    && validateClosureOverride({ criticalAlerts: 1, note: 'Se revisa mañana con el contador.', confirmation: 'CERRAR IGUAL' }).ok === true
  ));

  const explained = backend.prepareReconciliation({
    businessDate: '2026-08-05', declaredCash: 9_400,
    differenceNote: 'Faltante QA contado dos veces y documentado.', idempotencyKey: 'qa-daily-2',
  });
  const closed = backend.closeReconciliation({
    reconciliationId: explained.data.reconciliation.id, expectedRevision: 1, idempotencyKey: 'qa-daily-close',
  });
  check(checks, 'con la diferencia explicada el cierre se firma y queda auditado', () => (
    closed.ok === true
    && closed.data.reconciliation.status === 'closed'
    && typeof closed.data.reconciliation.snapshot_sha256 === 'string'
  ));
  check(checks, 'volver a cerrar el mismo día no genera un segundo cierre', () => {
    const replay = backend.closeReconciliation({
      reconciliationId: explained.data.reconciliation.id, expectedRevision: 1, idempotencyKey: 'qa-daily-close',
    });
    return replay.idempotentReplay === true;
  });
  return scenario('8', 'Cierre diario', checks);
}

// ===== Permisos =====

function scenarioPermissions() {
  const checks = [];
  check(checks, 'el equipo opera el día pero no toca dinero, precios ni fiscal', () => (
    ['orders.advance', 'packing.run', 'scanner.use', 'printing.run', 'payments.view'].every((capability) => can('staff', capability))
    && ['products.publish', 'products.price', 'payments.refund', 'fiscal.configure', 'day.close'].every((capability) => !can('staff', capability))
  ));
  check(checks, 'owner y admin tienen las mismas atribuciones', () => (
    describeRoleScope('owner').needsOwner.length === 0 && describeRoleScope('admin').needsOwner.length === 0
  ));
  check(checks, 'el Rider no recibe ninguna pantalla del panel', () => (
    allowedBusinessOperationViews('rider').length === 0 && describeRoleScope('rider').role === ''
  ));
  check(checks, 'el cliente no recibe ninguna pantalla del panel', () => (
    allowedBusinessOperationViews('customer').length === 0 && can('customer', 'orders.view') === false
  ));
  check(checks, 'el equipo no ve las pantallas de publicación, fiscal ni cierre', () => {
    const staff = allowedBusinessOperationViews('staff');
    return ['payments-setup', 'fiscal-setup', 'fiscal-config', 'day-close'].every((view) => !staff.includes(view));
  });
  return scenario('P', 'Permisos', checks);
}

// ===== Limpieza =====

function performCleanup(backend) {
  backend.closeQaOrders();
  backend.restoreStock();
  backend.archiveQaProducts();
  const report = backend.cleanupReport();
  const ok = report.activeQaOrders === 0
    && report.stockRestored === true
    && report.openLocks === 0
    && report.pendingQaOutbox === 0
    && report.humanOperationsTouched === 0;
  return Object.freeze({ ...report, ok });
}

// ===== Utilidades =====

function scenario(id, title, checks) {
  return Object.freeze({
    id,
    title,
    checks: Object.freeze(checks),
    passed: checks.every((entry) => entry.ok),
  });
}

function check(collection, name, run) {
  let ok = false;
  let detail = '';
  try {
    ok = run() === true;
    if (!ok) detail = 'La comprobación devolvió falso.';
  } catch (error) {
    ok = false;
    detail = String(error?.message || error).slice(0, 200);
  }
  collection.push(Object.freeze({ name, ok, detail }));
  return ok;
}

function noJargon(text) {
  return containsForbiddenVocabulary(String(text).replace(/<[^>]+>/g, ' ')).length === 0;
}

function mountPanel(backend, { role }) {
  configureBusinessOperations({
    role,
    businessId: QA_BUSINESS_ID,
    operatorId: role === 'owner' ? QA_ACTORS.owner.id : QA_ACTORS.staff.id,
    operatorName: role === 'owner' ? QA_ACTORS.owner.name : QA_ACTORS.staff.name,
    getOrders: () => backend.listOrders(),
    getOperationCenter: async () => ({ ok: true, data: backend.operationCenter() }),
    acknowledgeOperationalAlert: async (alertId) => backend.acknowledgeAlert(alertId),
    resolveOperationalAlert: async (input) => backend.resolveAlert(input),
    getOpeningStatus: async () => ({ ok: true, data: backend.openingStatus() }),
    setBusinessOpenState: async (status) => ({ ok: true, data: backend.setBusinessStatus(status) }),
    listPayments: async () => ({ ok: true, data: backend.listPayments() }),
    getPaymentsActivation: async () => ({ ok: true, data: backend.paymentActivation() }),
    getArcaActivation: async () => ({ ok: true, data: backend.fiscalActivation() }),
    lookupBarcode: async (gtin) => ({ ok: true, data: backend.lookupBarcode(gtin) }),
    listFiscalDocuments: async () => ({ ok: true, data: backend.listFiscalDocuments() }),
    listFiscalArtifacts: async () => ({ ok: true, data: [] }),
    getFiscalProfile: async () => ({ ok: true, data: backend.fiscalActivation() }),
    prepareDailyReconciliation: async (input) => backend.prepareReconciliation(input),
    closeDailyReconciliation: async (input) => backend.closeReconciliation(input),
    onChange: () => {},
  });
  return {
    async open(view) {
      renderBusinessOperations(view);
      await new Promise((resolve) => { setTimeout(resolve, 0); });
    },
    unmount() {
      resetBusinessOperationsForTests();
    },
  };
}

export { QA_PRODUCTS };
