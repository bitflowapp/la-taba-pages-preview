import { createBarcodeScannerService, SCANNER_MODES } from '../catalog/barcode-scanner-service.js';
import { escapeHtml } from '../ui.js';
import {
  applyPackingScan, createPackingCacheSnapshot, createPackingSessionFromManifest,
  markPackingScanConfirmed, pendingPackingScanCount, restorePackingCacheSnapshot,
  revertPackingScanLocally, undoLastPackingScan,
} from './business-packing-verification.js';
import { presentFiscalStatus } from '../pos/fiscal-status-presenter.js';
import { can, isElevated } from './business-capabilities.js';
import { humanizeFailure } from './business-operation-language.js';
import { validateRefundRequest } from './business-payments-console.js';
import { validateHomologationAuthorization } from './business-fiscal-assistant.js';
import {
  classifyPrinterProbe, classifyPrintSubmission, classifyQrCheck, classifyScannerCheck, classifySpoolerCheck,
} from './business-device-check.js';
import { evaluateDailyClosure, validateClosureOverride } from './business-day-control.js';
import { normalizeAccessFilter, renderAccessInboxSurface } from './business-access-inbox.js';
import { buildStorefrontPreview, describeDraft, planScanOutcome, validateProductDraft } from './business-product-onboarding.js';
import {
  PANEL_TIMEZONE,
  renderDayCloseSurface, renderDayOpenSurface, renderDevicesSurface, renderFiscalSetupSurface,
  renderOperationCenterSurface, renderOperationsConfigSurface,
  renderPaymentsSetupSurface, renderPaymentsSurface, renderProductOnboardingSurface,
} from './business-panel-render.js';
import {
  normalizeOperationsConfig, validateWeeklyHours, validateZoneDraft,
} from './business-operations-config.js';

export const BUSINESS_OPERATION_VIEWS = Object.freeze([
  'operation-center', 'day-open', 'orders', 'operations-config', 'payments', 'payments-setup', 'scanner', 'product-create',
  'inventory-receive', 'inventory-adjust', 'stock-count', 'packing', 'pos',
  'fiscal-status', 'fiscal-setup', 'fiscal-config', 'devices', 'team-access', 'day-close',
]);

const VIEW_META = Object.freeze({
  'operation-center': ['Centro de operación', null],
  'day-open': ['Abrir el negocio', null],
  orders: ['Pedidos', null],
  'operations-config': ['Horarios y cobertura', null],
  payments: ['Pagos', null],
  'payments-setup': ['Conectar Mercado Pago', null],
  scanner: ['Escáner rápido', 'product_lookup'],
  'product-create': ['Alta de producto', 'product_create'],
  'inventory-receive': ['Recepción', 'inventory_receive'],
  'inventory-adjust': ['Ajuste', 'inventory_adjust'],
  'stock-count': ['Conteo físico', 'stock_count'],
  packing: ['Preparación', 'order_packing'],
  pos: ['Mostrador', 'pos_sale'],
  'fiscal-status': ['Comprobantes', null],
  'fiscal-setup': ['Facturación', null],
  'fiscal-config': ['Datos fiscales', null],
  devices: ['Dispositivos', 'product_lookup'],
  'team-access': ['Solicitudes de acceso', null],
  'day-close': ['Cerrar el día', null],
});

// Qué necesita cada pantalla para poder abrirse. Toda vista lleva permiso:
// así un rol ajeno al negocio (por ejemplo un repartidor) no recibe ninguna.
const VIEW_CAPABILITY = Object.freeze({
  'operation-center': 'orders.view',
  'day-open': 'day.open',
  orders: 'orders.view',
  // La pantalla la ve todo el equipo; editar lo autoriza la RPC mediante
  // `can_manage_commercial_settings`, incluida la delegación explícita.
  'operations-config': 'orders.view',
  payments: 'payments.view',
  'payments-setup': 'payments.reconcile',
  scanner: 'scanner.use',
  'product-create': 'products.draft',
  'inventory-receive': 'inventory.receive',
  'inventory-adjust': 'inventory.receive',
  'stock-count': 'inventory.count',
  packing: 'packing.run',
  pos: 'orders.advance',
  'fiscal-status': 'printing.run',
  'fiscal-setup': 'fiscal.configure',
  'fiscal-config': 'fiscal.configure',
  devices: 'devices.test',
  // Decidir quién entra al comercio es un acto de conducción, no de mostrador.
  // El servidor lo revalida con identity.members.write; esto sólo evita
  // ofrecerle la pantalla a quien no puede usarla.
  'team-access': 'team.manage',
  'day-close': 'day.close',
});

let context = defaultContext();
let currentView = 'scanner';
let scanner = null;
let unsubscribeScanner = null;
let scannerDraftValue = '';
let lastScan = null;
let lookup = null;
let pendingCommercialHide = false;
let feedback = '';
let busy = false;
let posItems = [];
let fiscalProfile = null;
let fiscalDocuments = [];
let fiscalArtifacts = [];
let fiscalPreview = null;
let fiscalPrinters = [];
let fiscalInitialRefreshStarted = false;
let fiscalCreditDrafts = new Map();
let packingSession = null;
let packingRestoreStarted = false;
let packingCacheStatus = '';
let productDraft = null;
let operationCenterSnapshot = null;
let operationCenterStatus = { phase: 'idle', message: '' };
let operationCenterRefreshStarted = false;
let operationCenterRefreshTimer = null;
let signedUpdateStatus = null;
let paymentsActivation = null;
let payments = [];
let paymentsStatus = { phase: 'idle', message: '' };
let paymentsLoadStarted = false;
let refundTarget = '';
let operationsConfig = null;
let operationsConfigStatus = { phase: 'idle', message: '' };
let operationsConfigLoadStarted = false;
let operationsConfigDraft = { slots: null, hoursErrors: [], zoneErrors: [], enforcementError: '' };
let operationsConfigGeneration = 0;
let arcaActivation = null;
let arcaLoadStarted = false;
let arcaAuthorizationDraft = '';
let openingSignals = null;
let openingStatusRaw = null;
let openingLoadStarted = false;
let deviceResults = {};
let deviceCheckPrinters = [];
let devicePrintersLoadStarted = false;
let productPlan = null;
let productDraftView = null;
let productPreview = null;
let productErrors = [];
let productReadiness = null;
let productId = '';
let dailyRun = null;
let accessRequests = [];
let accessRequestsStatus = { phase: 'idle', message: '' };
let accessRequestsFilter = 'pending';
let accessRequestsLoadStarted = false;

export function configureBusinessOperations(next = {}) {
  stopOperationCenterRefresh();
  context = { ...defaultContext(), ...next };
  pendingCommercialHide = false;
  resetOperationsConfigState();
  packingSession = null;
  packingRestoreStarted = false;
  packingCacheStatus = '';
  operationCenterSnapshot = null;
  operationCenterStatus = { phase: 'idle', message: '' };
  operationCenterRefreshStarted = false;
  signedUpdateStatus = null;
  paymentsActivation = null;
  payments = [];
  paymentsStatus = { phase: 'idle', message: '' };
  paymentsLoadStarted = false;
  refundTarget = '';
  arcaActivation = null;
  arcaLoadStarted = false;
  arcaAuthorizationDraft = '';
  openingSignals = null;
  openingStatusRaw = null;
  openingLoadStarted = false;
  deviceResults = {};
  deviceCheckPrinters = [];
  devicePrintersLoadStarted = false;
  resetProductOnboarding();
  dailyRun = null;
  accessRequests = [];
  accessRequestsStatus = { phase: 'idle', message: '' };
  accessRequestsFilter = 'pending';
  accessRequestsLoadStarted = false;
  return context;
}

export function renderBusinessOperations(view) {
  currentView = BUSINESS_OPERATION_VIEWS.includes(view) ? view : 'scanner';
  const content = ({
    'operation-center': () => renderOperationCenterSurface({
      snapshot: operationCenterSnapshot,
      status: operationCenterStatus,
      role: context.role,
      busy,
      support: { isNative: context.desktopPlatform?.isNative, signedUpdate: signedUpdateStatus },
    }),
    'day-open': () => renderDayOpenSurface({
      opening: openingSignals, businessStatus: openingStatusRaw?.business_status, role: context.role, busy,
    }),
    'operations-config': () => renderOperationsConfigSurface({
      config: operationsConfig, status: operationsConfigStatus, busy, draft: operationsConfigDraft,
    }),
    payments: () => renderPaymentsSurface({
      payments, status: paymentsStatus, role: context.role, activation: paymentsActivation, busy, refundTarget,
    }),
    'payments-setup': () => renderPaymentsSetupSurface({ activation: paymentsActivation, role: context.role, busy }),
    'fiscal-setup': () => renderFiscalSetupSurface({
      activation: arcaActivation, role: context.role, busy, authorizationDraft: arcaAuthorizationDraft,
    }),
    devices: () => renderDevicesSurface({
      results: deviceResults, printers: deviceCheckPrinters, isNative: context.desktopPlatform?.isNative, busy,
    }),
    'team-access': () => renderAccessInboxSurface({
      requests: accessRequests, status: accessRequestsStatus.message,
      role: context.role, busy, filter: accessRequestsFilter,
    }),
    'day-close': () => renderDayCloseSurface({
      run: dailyRun,
      alerts: operationCenterSnapshot?.alerts || [],
      role: context.role,
      busy,
      businessDate: operationBusinessDate(),
      timezone: operationTimezone(),
    }),
    scanner: renderScanner,
    'product-create': () => renderProductOnboardingSurface({
      plan: productPlan, draft: productDraftView, readiness: productReadiness,
      preview: productPreview, errors: productErrors, role: context.role, busy,
    }),
    'inventory-receive': () => renderInventory('purchase_receipt'),
    'inventory-adjust': () => renderInventory('manual_adjustment'),
    'stock-count': renderStockCount,
    packing: renderPacking,
    pos: renderPos,
    'fiscal-status': renderFiscalStatus,
    'fiscal-config': renderFiscalConfig,
    orders: () => '',
  })[currentView]();
  queueMicrotask(() => activateBusinessOperations(currentView));
  // La navegación la dibuja el contenedor: una sola fila para todo el panel, también en Pedidos.
  return `<section class="business-ops-center" data-business-ops-center="${escapeHtml(currentView)}">
    ${feedback ? `<p class="business-ops-feedback" role="status">${escapeHtml(feedback)}</p>` : ''}
    ${content}
  </section>`;
}

// El panel no ofrece pantallas que el rol no puede usar; el servidor igual revalida.
export function allowedBusinessOperationViews(role) {
  return BUSINESS_OPERATION_VIEWS.filter((view) => can(role, VIEW_CAPABILITY[view]));
}

export function activateBusinessOperations(view = currentView) {
  const mode = VIEW_META[view]?.[1];
  if (view !== 'operation-center') stopOperationCenterRefresh();
  if (view !== 'devices' && view !== 'product-create') productPreview = null;
  if (!mode) {
    scanner?.stop();
    if (view === 'operation-center' && !operationCenterRefreshStarted) {
      operationCenterRefreshStarted = true;
      void refreshOperationCenter();
    }
    if ((view === 'fiscal-status' || view === 'fiscal-config') && !fiscalInitialRefreshStarted) {
      fiscalInitialRefreshStarted = true;
      void refreshFiscal();
    }
    if (view === 'operations-config' && !operationsConfigLoadStarted) {
      operationsConfigLoadStarted = true;
      void refreshOperationsConfig();
    }
    if ((view === 'payments' || view === 'payments-setup') && !paymentsLoadStarted) {
      paymentsLoadStarted = true;
      void refreshPayments();
    }
    if (view === 'fiscal-setup' && !arcaLoadStarted) {
      arcaLoadStarted = true;
      void refreshArcaActivation();
    }
    if (view === 'day-open' && !openingLoadStarted) {
      openingLoadStarted = true;
      void refreshOpeningStatus();
    }
    if (view === 'team-access' && !accessRequestsLoadStarted) {
      accessRequestsLoadStarted = true;
      void refreshAccessRequests();
    }
    return;
  }
  scanner ||= createBarcodeScannerService();
  unsubscribeScanner ||= scanner.subscribe((event) => { void processScan(event); });
  scanner.start(mode);
  // El mostrador necesita saber si la facturación está habilitada para ofrecer
  // (o no) el comprobante fiscal; una sola consulta por sesión.
  if (view === 'pos' && !fiscalInitialRefreshStarted) {
    fiscalInitialRefreshStarted = true;
    void refreshFiscal();
  }
  // Una sola consulta por sesión: volver a pedirla en cada render encadena re-renders sin fin.
  if (view === 'devices' && !devicePrintersLoadStarted) {
    devicePrintersLoadStarted = true;
    void refreshDeviceCheckPrinters();
  }
  if (view === 'packing' && !packingRestoreStarted) {
    packingRestoreStarted = true;
    void restorePackingSession();
  }
}

export async function handleBusinessOperationsAction(target) {
  if (!target?.closest) return { handled: false };
  const viewButton = target.closest('[data-business-ops-view]');
  if (viewButton) return { handled: true, view: viewButton.dataset.businessOpsView };

  const accessFilter = target.closest('[data-access-inbox-filter]')?.dataset.accessInboxFilter;
  if (accessFilter) {
    accessRequestsFilter = normalizeAccessFilter(accessFilter);
    await refreshAccessRequests();
    return { handled: true, ok: true, message: '' };
  }

  if (target.closest('[data-access-inbox-refresh]')) {
    if (busy) return result(false, 'Ya hay algo en curso.');
    await refreshAccessRequests();
    return { handled: true, ok: accessRequestsStatus.phase !== 'error', message: '' };
  }

  const approveId = target.closest('[data-access-request-approve]')?.dataset.accessRequestApprove;
  if (approveId) {
    // El rol sale del selector de ESA tarjeta. El servidor igual lo revalida
    // contra lo que se pidió y contra lo que quien decide puede otorgar.
    //
    // `CSS.escape` no está en todas partes —falta en Node y en WebViews viejas—
    // y este módulo tiene que poder correr sin DOM en las pruebas. El
    // identificador viene del servidor como uuid, así que escapar comillas y
    // barras alcanza y no depende de una API opcional.
    const select = target.closest('[data-business-ops-center]')
      ?.querySelector(`[data-access-request-role="${cssAttributeValue(approveId)}"]`);
    return reviewAccessRequestAction(approveId, 'approve', select?.value || null);
  }

  const rejectId = target.closest('[data-access-request-reject]')?.dataset.accessRequestReject;
  if (rejectId) return reviewAccessRequestAction(rejectId, 'reject');

  if (target.closest('[data-business-scan-test]')) {
    const input = target.closest('[data-business-ops-center]')?.querySelector('[data-barcode-input]');
    if (!scanner?.isActive()) activateBusinessOperations(currentView);
    const event = scanner.test(input?.value || '', 'simulator');
    return { handled: true, ok: event.isValid, message: event.isValid ? '' : 'Código inválido.' };
  }

  if (target.closest('[data-create-product-draft]')) {
    if (!lastScan?.isValid) return result(false, 'Escaneá un código válido antes de abrir el borrador.');
    busy = true;
    const response = await context.createProductDraft({
      gtin: lastScan.normalizedValue,
      suggestion: lookup?.data || {},
      idempotencyKey: createKey('product-draft'),
    });
    busy = false;
    if (response?.ok) {
      productDraft = Array.isArray(response.data) ? response.data[0] : response.data;
      productDraftView = describeDraft(productDraft, { operatorName: context.operatorName });
      productErrors = [];
      productPreview = null;
    }
    feedback = response?.ok
      ? 'Borrador abierto. Falta completar los datos antes de publicarlo.'
      : humanizeFailure(response?.message, 'No se pudo abrir el borrador.');
    context.onChange();
    return result(Boolean(response?.ok), feedback);
  }

  if (target.closest('[data-product-preview]')) return previewProductDraft(target);
  if (target.closest('[data-product-complete]')) return completeProductDraft(target);
  if (target.closest('[data-product-publish]')) return refreshProductReadiness();

  if (target.closest('[data-payments-refresh]')) return refreshPaymentsAction();
  if (target.closest('[data-mercadopago-status-refresh]')) return refreshPaymentsAction();
  if (target.closest('[data-mercadopago-settings-save]')) return saveMercadoPagoSettings(target);
  if (target.closest('[data-mercadopago-enable]')) return enableMercadoPagoTestCharges();
  const paymentAction = target.closest('[data-payment-action]');
  if (paymentAction) return runPaymentAction(paymentAction);
  const refundConfirm = target.closest('[data-payment-refund-confirm]');
  if (refundConfirm) return confirmPaymentRefund(refundConfirm);
  if (target.closest('[data-payment-refund-cancel]')) {
    refundTarget = '';
    context.onChange();
    return result(true, 'Devolución cancelada. No se movió dinero.');
  }

  if (target.closest('[data-arca-status-refresh]')) {
    await refreshArcaActivation();
    return result(true, 'Estado de facturación actualizado.');
  }
  if (target.closest('[data-arca-authorize]')) return authorizeArcaHomologation(target);

  if (target.closest('[data-opening-refresh]')) {
    await refreshOpeningStatus();
    return result(true, 'Revisión de apertura actualizada.');
  }
  const openState = target.closest('[data-business-open-state]');
  if (openState) return setBusinessOpenState(openState);

  const deviceTest = target.closest('[data-device-test]');
  if (deviceTest) return runDeviceTest(deviceTest);
  const deviceConfirm = target.closest('[data-device-confirm]');
  if (deviceConfirm) return confirmDevicePrint(deviceConfirm);

  const inventoryButton = target.closest('[data-inventory-confirm]');
  if (inventoryButton) return confirmInventory(inventoryButton);
  if (target.closest('[data-stock-count-confirm]')) return confirmStockCount(target);
  if (target.closest('[data-commercial-publish-cancel]')) {
    pendingCommercialHide = false;
    feedback = 'Ocultamiento cancelado. No se modificó el stock.';
    context.onChange();
    return result(true, feedback);
  }
  const publicationConfirmation = target.closest('[data-commercial-publish-confirm]');
  if (publicationConfirmation) return confirmCommercialPublication(publicationConfirmation, { confirmed: true });
  const publicationButton = target.closest('[data-commercial-publish]');
  if (publicationButton) return confirmCommercialPublication(publicationButton);

  const remove = target.closest('[data-pos-remove]');
  if (remove) {
    posItems = posItems.filter((item) => item.productId !== remove.dataset.posRemove);
    context.onChange();
    return result(true, 'Producto quitado del borrador.');
  }
  if (target.closest('[data-pos-clear]')) {
    posItems = [];
    context.onChange();
    return result(true, 'Borrador de venta vacío.');
  }
  if (target.closest('[data-pos-checkout]')) return confirmPos(target);

  if (target.closest('[data-packing-start]')) return startPacking(target);
  if (target.closest('[data-packing-undo]')) {
    if (!packingSession) return result(false, 'No hay preparación activa.');
    const scan = packingSession.scans.at(-1);
    if (!scan) return result(false, 'No hay lecturas para deshacer.');
    let server;
    if (scan.syncState !== 'confirmed') {
      const cancelled = await context.cancelPackingScan(scan.scanKey);
      server = cancelled ? { ok: true, pendingCancelled: true } : { ok: false, message: 'La lectura pendiente ya cambió; reconciliá antes de deshacer.' };
    } else {
      const idempotencyKey = `packing-revert:${scan.scanKey}`;
      server = await context.revertPackingScan({ session: packingSession, scanKey: scan.scanKey, idempotencyKey });
    }
    if (!server?.ok && !server?.pending) return result(false, server?.message || 'El servidor no confirmó el deshacer.');
    const response = undoLastPackingScan(packingSession);
    await persistPackingSession();
    feedback = server?.pending ? 'Lectura revertida localmente; corrección pendiente en la cola durable.' : response.message;
    context.onChange();
    return result(response.ok, response.message);
  }
  if (target.closest('[data-packing-confirm]')) return confirmPacking(target);

  if (target.closest('[data-fiscal-refresh]')) {
    await refreshFiscal();
    return result(true, 'Estado fiscal actualizado.');
  }
  if (target.closest('[data-fiscal-preview-close]')) {
    fiscalPreview = null;
    context.onChange();
    return result(true, 'Vista previa cerrada.');
  }
  const preview = target.closest('[data-fiscal-preview]');
  if (preview) return previewFiscalArtifact(preview);
  const download = target.closest('[data-fiscal-download]');
  if (download) return downloadFiscalArtifact(download);
  const print = target.closest('[data-fiscal-print]');
  if (print) return printFiscalArtifact(print);
  const regenerate = target.closest('[data-fiscal-regenerate]');
  if (regenerate) return regenerateFiscalArtifact(regenerate);
  if (target.closest('[data-fiscal-open-cache]')) return openFiscalCacheFolder();
  if (target.closest('[data-fiscal-config-save]')) return saveFiscalConfiguration(target);
  const creditNote = target.closest('[data-fiscal-credit-note]');
  if (creditNote) return requestCreditNote(creditNote);
  if (target.closest('[data-operation-center-refresh]')) return refreshOperationCenterAction();
  if (target.closest('[data-operations-config-refresh]')) return refreshOperationsConfigAction();
  const addSlot = target.closest('[data-operations-hours-add]');
  if (addSlot) return addOperationsHoursSlot(addSlot);
  const clearDay = target.closest('[data-operations-hours-clear]');
  if (clearDay) return clearOperationsHoursDay(clearDay);
  if (target.closest('[data-operations-hours-save]')) return saveOperationsHours();
  const toggleZone = target.closest('[data-operations-zone-toggle]');
  if (toggleZone) return toggleOperationsZone(toggleZone);
  if (target.closest('[data-operations-zone-add]')) return addOperationsZone(target);
  if (target.closest('[data-operations-pricing-save]')) return saveOperationsPricing(target);
  if (target.closest('[data-operations-enforcement-save]')) return saveOperationsEnforcement(target);
  if (target.closest('[data-local-backup-create]')) return createLocalBackup();
  if (target.closest('[data-support-diagnostic-export]')) return exportSupportDiagnostic();
  if (target.closest('[data-support-export-folder]')) return openSupportExportFolder();
  if (target.closest('[data-signed-update-check]')) return checkForSignedUpdate();
  const installUpdate = target.closest('[data-signed-update-install]');
  if (installUpdate) return installSignedUpdate(installUpdate);
  const acknowledgeAlert = target.closest('[data-operational-alert-acknowledge]');
  if (acknowledgeAlert) return acknowledgeOperationalAlert(acknowledgeAlert);
  const resolveAlert = target.closest('[data-operational-alert-resolve]');
  if (resolveAlert) return resolveOperationalAlert(resolveAlert);
  if (target.closest('[data-daily-reconciliation-prepare]')) return prepareDailyReconciliation(target);
  const closeDaily = target.closest('[data-daily-reconciliation-close]');
  if (closeDaily) return closeDailyReconciliation(closeDaily);
  return { handled: false };
}

export function handleBusinessOperationsInput(target) {
  if (target?.matches?.('[data-barcode-input]')) {
    scannerDraftValue = String(target.value || '').slice(0, 64);
    return { handled: true };
  }
  // La frase de autorización se conserva para que un refresco no la borre a mitad de escribirla.
  if (target?.matches?.('[name="arcaAuthorization"]')) {
    arcaAuthorizationDraft = String(target.value || '').slice(0, 40);
    return { handled: true };
  }
  if (!target?.matches?.('[name="creditReason"], [name="creditKind"], [name="creditQuantity"], [name="creditNet"], [name="creditTax"]')) {
    return { handled: false };
  }
  const row = target.closest('[data-fiscal-document]');
  const details = target.closest('details.business-fiscal-credit');
  const documentId = String(row?.dataset?.fiscalDocument || '');
  if (!row || !details || !documentId) return { handled: false };
  fiscalCreditDrafts.set(documentId, readCreditDraft(row));
  return { handled: true };
}

export function resetBusinessOperationsForTests() {
  stopOperationCenterRefresh();
  unsubscribeScanner?.();
  scanner?.stop();
  scanner = null;
  unsubscribeScanner = null;
  scannerDraftValue = '';
  context = defaultContext();
  currentView = 'scanner';
  lastScan = null;
  lookup = null;
  pendingCommercialHide = false;
  feedback = '';
  busy = false;
  posItems = [];
  fiscalProfile = null;
  fiscalDocuments = [];
  fiscalArtifacts = [];
  fiscalPreview = null;
  fiscalPrinters = [];
  fiscalInitialRefreshStarted = false;
  fiscalCreditDrafts = new Map();
  packingSession = null;
  packingRestoreStarted = false;
  packingCacheStatus = '';
  productDraft = null;
  operationCenterSnapshot = null;
  operationCenterStatus = { phase: 'idle', message: '' };
  operationCenterRefreshStarted = false;
  signedUpdateStatus = null;
  paymentsActivation = null;
  payments = [];
  paymentsStatus = { phase: 'idle', message: '' };
  paymentsLoadStarted = false;
  refundTarget = '';
  resetOperationsConfigState();
  arcaActivation = null;
  arcaLoadStarted = false;
  arcaAuthorizationDraft = '';
  openingSignals = null;
  openingStatusRaw = null;
  openingLoadStarted = false;
  deviceResults = {};
  deviceCheckPrinters = [];
  devicePrintersLoadStarted = false;
  resetProductOnboarding();
  dailyRun = null;
}

function resetProductOnboarding() {
  productDraft = null;
  productDraftView = null;
  productPlan = null;
  productPreview = null;
  productErrors = [];
  productReadiness = null;
  productId = '';
}

async function processScan(event) {
  scannerDraftValue = '';
  lastScan = event;
  lookup = null;
  pendingCommercialHide = false;
  if (currentView === 'devices') {
    deviceResults = { ...deviceResults, scanner: classifyScannerCheck(event) };
    feedback = deviceResults.scanner.detail;
    context.onChange();
    return;
  }
  if (!event.isValid) {
    if (currentView === 'product-create') productPlan = planScanOutcome({ scan: event, lookup: null });
    feedback = event.reason === 'DUPLICATE_SCAN' ? 'Lectura duplicada ignorada.' : 'Código inválido.';
    context.onChange();
    return;
  }
  const packingBinding = currentView === 'packing' ? cachedPackingBinding(event.normalizedValue) : null;
  if (currentView === 'packing' && packingSession && !packingBinding && globalThis.navigator?.onLine === false) {
    feedback = 'Código fuera del manifiesto cacheado; no se contabilizó sin conexión.';
    context.onChange();
    return;
  }
  busy = true;
  lookup = packingBinding
    ? { ok: true, data: packingBinding }
    : await context.lookupBarcode(event.normalizedValue);
  busy = false;
  const binding = lookup?.data || null;
  if (currentView === 'product-create') {
    productPlan = planScanOutcome({ scan: event, lookup: binding });
    productDraftView = null;
    productPreview = null;
    productErrors = [];
    productReadiness = null;
    feedback = productPlan.headline;
    context.onChange();
    return;
  }
  if (!binding) {
    feedback = 'Este código todavía no está cargado. Abrilo como borrador desde Alta de producto.';
  } else if (currentView === 'pos') {
    addScannedPosItem(binding);
    feedback = 'Producto agregado al borrador de venta.';
  } else if (currentView === 'packing') {
    if (!packingSession) feedback = 'Seleccioná un pedido antes de escanear.';
    else {
      const item = packingSession.items.find((candidate) => candidate.productId === String(binding.product_id));
      if (item && !item.barcodes.some((barcode) => barcode.gtin === event.normalizedValue)) {
        item.barcodes.push({ gtin: event.normalizedValue, unitFactor: positiveInteger(binding.unit_factor, 1) });
      }
      const scanKey = createKey('packing-scan');
      const previewSession = clonePackingSession(packingSession);
      const response = applyPackingScan(previewSession, event, { scanKey });
      feedback = response.message;
      if (response.ok) {
        const server = await context.recordPackingScan({ session: packingSession, event, scanKey });
        if (server?.ok || server?.pending) {
          applyPackingScan(packingSession, event, { scanKey, syncState: server.ok ? 'confirmed' : 'pending' });
          if (server.ok) markPackingScanConfirmed(packingSession, scanKey);
          await persistPackingSession();
          feedback = server.pending
            ? 'Lectura guardada en la cola local durable; falta confirmación del servidor.'
            : response.message;
        } else feedback = server?.message || 'El servidor rechazó la lectura; no se contabilizó.';
      }
    }
  } else {
    feedback = Number(binding.unit_factor || 1) > 1 ? 'Pack detectado.' : 'Producto encontrado.';
  }
  context.onChange();
}

function addScannedPosItem(binding) {
  const product = normalizedProduct(binding);
  if (!product.id) return;
  const factor = positiveInteger(binding.unit_factor, 1);
  const existing = posItems.find((item) => item.productId === product.id);
  if (existing) existing.quantity += factor;
  else posItems.push({ productId: product.id, name: product.name, quantity: factor });
}

async function confirmInventory(button) {
  if (!lookup?.data) return result(false, 'Escaneá un producto conocido antes de registrar stock.');
  const root = button.closest('[data-business-ops-center]');
  const quantity = positiveInteger(root?.querySelector('[name="packageQuantity"]')?.value, 0);
  const reason = String(root?.querySelector('[name="reason"]')?.value || '').trim();
  const movementType = button.dataset.inventoryConfirm;
  if (!quantity) return result(false, 'Ingresá una cantidad entera mayor que cero.');
  if (movementType === 'manual_adjustment' && !reason) return result(false, 'El motivo es obligatorio para el ajuste.');
  const binding = lookup.data;
  const response = await context.applyInventoryMovement({
    productId: binding.product_id,
    barcodeId: binding.id,
    movementType,
    packageQuantity: quantity,
    direction: Number(root?.querySelector('[name="direction"]')?.value || 1),
    reason,
    idempotencyKey: createKey('inventory'),
  });
  feedback = response?.ok ? 'Stock actualizado por el servidor.' : response?.message || 'Stock pendiente de confirmación.';
  if (response?.ok) await refreshLookup();
  context.onChange();
  return result(Boolean(response?.ok), feedback);
}

/**
 * Vuelve a leer el mismo código después de un movimiento. `lookup.data.products`
 * quedaba con el stock ANTERIOR al que la Recepción acababa de cargar — la propia
 * etiqueta "(último conocido)" de renderScanResult lo decía. Sin esto, la
 * oportunidad de publicar recién aparecería en el próximo escaneo, no apenas se
 * guarda la recepción.
 */
async function refreshLookup() {
  const gtin = String(lastScan?.normalizedValue || '');
  if (!gtin) return;
  const refreshed = await context.lookupBarcode(gtin);
  if (refreshed?.ok) lookup = refreshed;
}

async function confirmCommercialPublication(button, { confirmed = false } = {}) {
  const guard = requireCapability('products.publish');
  if (!guard.ok) return guard.result;
  if (!lookup?.data) return result(false, 'Escaneá el producto antes de publicarlo.');
  const product = normalizedProduct(lookup.data);
  if (!product.sku) return result(false, 'El producto no tiene un SKU comercial.');
  const publish = button.dataset.commercialPublish === 'true';
  if (busy) return result(false, 'Ya hay una publicación en curso.');
  if (!publish && !confirmed) {
    pendingCommercialHide = true;
    feedback = '';
    context.onChange();
    return result(true, 'Confirmá si querés ocultarlo de la tienda.');
  }
  if (publish) {
    const localGate = commercialPublicationGate(product);
    if (!localGate.ok) return result(false, localGate.message);
  }
  pendingCommercialHide = false;
  busy = true;
  const response = await context.setCommercialPublication({ sku: product.sku, publish });
  busy = false;
  if (response?.ok) {
    await refreshLookup();
    feedback = publish ? 'Producto publicado: ya se ve y se puede comprar en la tienda.' : 'Producto oculto de la tienda.';
  } else {
    feedback = humanizeCommercialPublicationFailure(response?.message, { publish });
  }
  context.onChange();
  return result(Boolean(response?.ok), feedback);
}

function commercialPublicationGate(product) {
  if (product.stock <= 0) return { ok: false, message: 'No se puede publicar sin stock. Registrá primero la recepción física.' };
  if (product.catalogOrigin !== 'commercial') return { ok: false, message: 'Este producto todavía no pertenece al catálogo comercial.' };
  if (!product.isVerified) return { ok: false, message: 'Faltan verificar los datos maestros del producto.' };
  if (!product.isActive) return { ok: false, message: 'Este producto está inactivo y no se puede publicar.' };
  if (!product.priceConfirmed) return { ok: false, message: 'Falta confirmar un precio mayor que cero antes de publicar.' };
  if (product.imageStatus === 'partial') return { ok: false, message: 'La información de la imagen está incompleta. Corregila antes de publicar.' };
  if (product.isAlcoholic) return { ok: false, message: 'No se puede publicar hasta habilitar la venta de alcohol.' };
  return { ok: true, message: '' };
}

function humanizeCommercialPublicationFailure(message, { publish }) {
  const raw = String(message || '');
  if (/alcohol|license gate/i.test(raw)) return 'No se puede publicar hasta habilitar la venta de alcohol.';
  if (/stock|available|sin existencias/i.test(raw) && publish) return 'No se puede publicar sin stock. Registrá primero la recepción física.';
  if (/not verified|verif|master data/i.test(raw)) return 'Faltan verificar los datos maestros del producto.';
  if (/inactive|inactivo/i.test(raw)) return 'Este producto está inactivo y no se puede publicar.';
  if (/price|precio|confirmed/i.test(raw) && publish) return 'Falta confirmar un precio mayor que cero antes de publicar.';
  if (/image|asset|foto|imagen/i.test(raw) && publish) return 'La información de la imagen no cumple el contrato comercial.';
  if (/unknown sku|missing sku|producto.*existe/i.test(raw)) return 'No encontramos ese producto en este comercio.';
  return publish
    ? 'No se pudo publicar este producto. Revisá sus datos comerciales.'
    : 'No se pudo ocultar este producto. Intentá de nuevo.';
}

async function confirmStockCount(target) {
  if (!lookup?.data) return result(false, 'Escaneá un producto conocido antes del conteo.');
  const root = target.closest('[data-business-ops-center]');
  const physical = Number(root?.querySelector('[name="physicalStock"]')?.value);
  const product = normalizedProduct(lookup.data);
  if (!Number.isSafeInteger(physical) || physical < 0) return result(false, 'Ingresá el stock físico contado.');
  const difference = physical - product.stock;
  if (difference === 0) return result(true, 'Conteo sin diferencias; no se creó un movimiento.');
  const response = await context.applyInventoryMovement({
    productId: product.id,
    barcodeId: lookup.data.id,
    movementType: 'stock_count',
    packageQuantity: Math.abs(difference),
    direction: Math.sign(difference),
    reason: String(root?.querySelector('[name="reason"]')?.value || 'Conteo físico').trim(),
    idempotencyKey: createKey('stock-count'),
  });
  feedback = response?.ok ? 'Conteo conciliado por el servidor.' : response?.message || 'Conteo pendiente de revisión.';
  if (response?.ok) await refreshLookup();
  context.onChange();
  return result(Boolean(response?.ok), feedback);
}

async function confirmPos(target) {
  if (!posItems.length) return result(false, 'Escaneá al menos un producto.');
  if (globalThis.navigator?.onLine === false) return result(false, 'Borrador guardado. Pendiente de sincronización; la venta no está confirmada.');
  const root = target.closest('[data-business-ops-center]');
  const response = await context.checkoutPos({
    items: posItems.map(({ productId, quantity }) => ({ productId, quantity })),
    paymentMethod: root?.querySelector('[name="paymentMethod"]')?.value || 'cash',
    requestFiscal: root?.querySelector('[name="requestFiscal"]')?.checked === true,
    idempotencyKey: createKey('pos-sale'),
  });
  feedback = response?.ok
    ? (response.data?.fiscal_status === 'request_failed'
      ? 'Venta confirmada; la solicitud fiscal requiere revisión.'
      : response.data?.fiscal_document_id ? 'Venta confirmada; comprobante fiscal pendiente.' : 'Venta confirmada por el servidor.')
    : response?.message || 'La venta no fue confirmada.';
  if (response?.ok) posItems = [];
  context.onChange();
  return result(Boolean(response?.ok), feedback);
}

async function startPacking(target) {
  const root = target.closest('[data-business-ops-center]');
  const orderId = root?.querySelector('[name="packingOrder"]')?.value || '';
  const order = context.getOrders().find((candidate) => String(candidate.backendId || candidate.id) === orderId);
  if (!order) return result(false, 'Seleccioná un pedido activo.');
  try {
    const server = await context.startPacking({
      orderId,
      expectedRevision: Number(order.revision || 0),
      idempotencyKey: `packing:${orderId}:${order.revision}`,
    });
    if (!server?.ok) return result(false, server?.message || 'El servidor no inició la preparación.');
    const serverSession = Array.isArray(server.data) ? server.data[0] : server.data;
    const serverSessionId = serverSession?.id;
    if (!serverSessionId) throw new Error('El servidor no devolvió la sesión de preparación.');
    const manifest = await context.getPackingManifest(serverSessionId);
    if (!manifest?.ok) throw new Error(manifest?.message || 'La sesión comenzó, pero no se pudo recuperar su manifiesto seguro.');
    packingSession = createPackingSessionFromManifest(manifest.data, { operatorId: context.operatorId });
    await persistPackingSession();
    feedback = 'Preparación iniciada. Escaneá cada unidad o pack.';
    context.onChange();
    return result(true, feedback);
  } catch (error) {
    return result(false, error.message);
  }
}

async function confirmPacking(target) {
  if (!packingSession) return result(false, 'No hay preparación activa.');
  if (globalThis.navigator?.onLine === false) return result(false, 'La preparación queda guardada; reconectá para reconciliar y confirmar.');
  const root = target.closest('[data-business-ops-center]');
  const exceptionReason = String(root?.querySelector('[name="packingExceptionReason"]')?.value || '').trim();
  await context.drainPackingCommands();
  const blockedCommands = context.listPackingCommands().filter((command) => command.payload?.sessionId === packingSession.serverSessionId
    && ['pending', 'sending', 'failed', 'conflicted'].includes(command.state));
  if (blockedCommands.length) return result(false, 'Hay lecturas sin reconciliar; revisá la outbox antes de confirmar.');
  const reconciled = await context.getPackingManifest(packingSession.serverSessionId);
  if (!reconciled?.ok) return result(false, reconciled?.message || 'No se pudo reconciliar la preparación.');
  packingSession = createPackingSessionFromManifest(reconciled.data, { operatorId: context.operatorId });
  await persistPackingSession();
  const idempotencyKey = `packing-confirm:${packingSession.serverSessionId}`;
  let server = await context.confirmPacking({ session: packingSession, exceptionReason: exceptionReason || null, idempotencyKey });
  if (!server?.ok) {
    const afterAmbiguity = await context.getPackingManifest(packingSession.serverSessionId);
    if (afterAmbiguity?.ok && afterAmbiguity.data?.session?.status === 'confirmed') server = { ok: true, recovered: true };
  }
  if (server?.ok) {
    await context.desktopPlatform.deletePackingCache(context.businessId);
    packingSession = null;
  }
  feedback = server?.ok
    ? (server.recovered ? 'Preparación confirmada y recuperada tras una respuesta ambigua.' : 'Preparación confirmada por el servidor.')
    : server?.message || 'La preparación requiere revisión.';
  context.onChange();
  return result(Boolean(server?.ok), feedback);
}

async function restorePackingSession() {
  if (!context.businessId) return;
  try {
    const cached = await context.desktopPlatform.loadPackingCache(context.businessId);
    if (!cached) return;
    let restored = restorePackingCacheSnapshot(cached, {
      businessId: context.businessId,
      operatorId: context.operatorId,
    });
    if (globalThis.navigator?.onLine !== false) {
      const manifest = await context.getPackingManifest(restored.serverSessionId);
      if (manifest?.ok) restored = createPackingSessionFromManifest(manifest.data, { operatorId: context.operatorId });
      else packingCacheStatus = 'No se pudo reconciliar la caché; la confirmación permanece bloqueada.';
    } else packingCacheStatus = 'Sesión recuperada de la caché local; lecturas nuevas quedarán pendientes.';
    packingSession = mergePackingCommands(restored, context.listPackingCommands());
    await persistPackingSession();
    feedback = packingCacheStatus || 'Preparación recuperada y reconciliada.';
  } catch (error) {
    packingSession = null;
    packingCacheStatus = 'La caché local no superó la validación; reconectá para recuperar el manifiesto.';
    feedback = error?.message || packingCacheStatus;
  }
  context.onChange();
}

function mergePackingCommands(session, commands) {
  const relevant = (Array.isArray(commands) ? commands : [])
    .filter((command) => command.payload?.sessionId === session.serverSessionId)
    .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
  for (const command of relevant) {
    const active = ['pending', 'sending', 'confirmed'].includes(command.state);
    if (command.commandType === 'packing_scan') {
      const existing = session.scans.find((scan) => scan.scanKey === command.payload?.scanKey);
      if (!active) {
        if (existing?.syncState !== 'confirmed') revertPackingScanLocally(session, command.payload?.scanKey);
        continue;
      }
      if (!existing) {
        const response = applyPackingScan(session, { isValid: true, normalizedValue: command.payload?.gtin }, {
          scanKey: command.payload?.scanKey,
          syncState: command.state === 'confirmed' ? 'confirmed' : 'pending',
        });
        if (!response.ok) packingCacheStatus = 'Una lectura local no coincide con el manifiesto y requiere revisión.';
      } else if (command.state === 'confirmed') markPackingScanConfirmed(session, command.payload?.scanKey);
    }
    if (command.commandType === 'packing_scan_revert' && active) {
      revertPackingScanLocally(session, command.payload?.scanKey);
    }
  }
  return session;
}

async function persistPackingSession() {
  if (!packingSession || !context.businessId) return false;
  try {
    const snapshot = createPackingCacheSnapshot(packingSession, { businessId: context.businessId });
    await context.desktopPlatform.savePackingCache(snapshot);
    return true;
  } catch (error) {
    packingCacheStatus = 'La sesión sigue en PostgreSQL/outbox, pero falló la caché visual local.';
    return false;
  }
}

function cachedPackingBinding(gtin) {
  if (!packingSession) return null;
  for (const item of packingSession.items) {
    const barcode = item.barcodes.find((candidate) => candidate.gtin === String(gtin || ''));
    if (barcode) return {
      product_id: item.productId,
      name: item.name,
      unit_factor: barcode.unitFactor,
      presentation: barcode.unitFactor > 1 ? 'Pack' : 'Unidad',
    };
  }
  return null;
}

function clonePackingSession(session) { return JSON.parse(JSON.stringify(session)); }

async function refreshFiscal() {
  const [profile, documents, artifacts] = await Promise.all([context.getFiscalProfile(), context.listFiscalDocuments(), context.listFiscalArtifacts()]);
  fiscalProfile = profile?.ok ? profile.data : null;
  fiscalDocuments = documents?.ok && Array.isArray(documents.data) ? documents.data : [];
  fiscalArtifacts = artifacts?.ok && Array.isArray(artifacts.data) ? artifacts.data : [];
  await refreshFiscalPrinters();
  // The snapshot remains fresh after navigation, but a late fiscal request must
  // never redraw another operational surface and erase an in-progress scan.
  // El mostrador también se refresca: es lo que hace aparecer el checkbox
  // fiscal cuando la facturación está habilitada. El borrador de venta y la
  // última lectura viven en el estado del módulo, así que el redibujo no los pisa.
  if (['fiscal-status', 'fiscal-config', 'pos'].includes(currentView)) context.onChange();
}

async function refreshFiscalPrinters() {
  try {
    const printers = await context.desktopPlatform.listPrinters();
    fiscalPrinters = Array.isArray(printers) ? printers.filter((printer) => printer?.name) : [];
  } catch (_) {
    fiscalPrinters = [];
  }
}

async function saveFiscalConfiguration(target) {
  const root = target.closest('[data-business-ops-center]');
  // El RPC upsertea TODAS las columnas: mandar is_enabled=false fijo apagaba
  // en silencio una facturación ya autorizada al guardar un dato. Se preserva
  // el estado vigente del perfil; habilitar/deshabilitar es otra acción.
  const currentlyEnabled = fiscalProfile?.is_enabled === true;
  const profile = {
    legal_name: String(root?.querySelector('[name="legalName"]')?.value || '').trim(),
    cuit: String(root?.querySelector('[name="cuit"]')?.value || '').replace(/\D/g, ''),
    tax_condition: String(root?.querySelector('[name="taxCondition"]')?.value || '').trim(),
    business_address: String(root?.querySelector('[name="businessAddress"]')?.value || '').trim(),
    environment: 'homologation',
    point_of_sale: Number(root?.querySelector('[name="pointOfSale"]')?.value || 0),
    default_currency: 'PES',
    default_concept: [1, 2, 3].includes(Number(fiscalProfile?.default_concept)) ? Number(fiscalProfile.default_concept) : 1,
    invoice_policy: 'manual',
    default_recipient_condition: String(root?.querySelector('[name="defaultRecipientCondition"]')?.value || '').trim(),
    is_enabled: currentlyEnabled,
  };
  if (!/^\d{11}$/.test(profile.cuit) || !profile.legal_name || !profile.tax_condition || !profile.business_address || profile.point_of_sale < 1) {
    return result(false, 'Completá razón social, CUIT, condición, domicilio y punto de venta.');
  }
  const response = await context.configureFiscalProfile(profile);
  feedback = response?.ok
    ? currentlyEnabled
      ? 'Perfil actualizado; la facturación de prueba sigue habilitada y producción bloqueada.'
      : 'Perfil guardado en homologación; producción continúa bloqueada.'
    : response?.message || 'No se pudo guardar el perfil.';
  if (response?.ok) fiscalProfile = response.data || fiscalProfile;
  context.onChange();
  return result(Boolean(response?.ok), feedback);
}

async function requestCreditNote(button) {
  // El servidor también lo exige; acá se evita ofrecer un botón que va a fallar.
  const guard = requireCapability('fiscal.configure');
  if (!guard.ok) return result(false, 'Las notas de crédito las confirma el dueño o el encargado.');
  const row = button.closest('[data-fiscal-document]');
  const reason = String(row?.querySelector('[name="creditReason"]')?.value || '').trim();
  const creditKind = String(row?.querySelector('[name="creditKind"]')?.value || 'total');
  if (!reason) return result(false, 'Escribí por qué hacés la nota de crédito.');
  const lines = creditKind === 'total' ? [] : [...(row?.querySelectorAll('[data-credit-line]') || [])]
    .map((line) => {
      const quantity = Number(line.querySelector('[name="creditQuantity"]')?.value || 0);
      const input = { original_item_id: line.dataset.creditLine, quantity };
      if (creditKind === 'commercial_adjustment') {
        input.net_amount = Number(line.querySelector('[name="creditNet"]')?.value || 0);
        input.tax_amount = Number(line.querySelector('[name="creditTax"]')?.value || 0);
      }
      return input;
    })
    .filter((line) => line.quantity > 0);
  if (creditKind !== 'total' && !lines.length) return result(false, 'Indicá al menos un ítem y cantidad para la nota parcial.');
  const response = await context.requestCreditNote({
    originalDocumentId: button.dataset.fiscalCreditNote,
    reason,
    creditKind,
    lines,
    idempotencyKey: createKey('credit-note'),
  });
  feedback = response?.ok ? 'Nota de crédito solicitada; ARCA la procesará de forma idempotente.' : fiscalMessage(response, 'La solicitud requiere revisión.');
  if (response?.ok) fiscalCreditDrafts.delete(String(row?.dataset?.fiscalDocument || ''));
  context.onChange();
  return result(Boolean(response?.ok), feedback);
}

async function previewFiscalArtifact(button) {
  const access = await context.requestFiscalArtifactUrl({ artifactId: button.dataset.fiscalPreview, action: 'preview' });
  if (!access?.ok) return result(false, fiscalMessage(access, 'No se pudo abrir la vista previa privada.'));
  fiscalPreview = { artifactId: button.dataset.fiscalPreview, signedUrl: access.data.signedUrl, expiresAt: access.data.expiresAt || null };
  // Evidencia real del paso "QR, PDF e impresión" del asistente: el operador
  // abrió el PDF. Best-effort: si el rol no alcanza, el paso queda pendiente.
  try { await context.recordFiscalVerification?.('artifact'); } catch (_) { /* sin evidencia, sin paso */ }
  feedback = 'Vista previa privada abierta. El enlace vence en breve.';
  context.onChange();
  return result(true, feedback);
}

async function downloadFiscalArtifact(button) {
  const access = await context.requestFiscalArtifactUrl({ artifactId: button.dataset.fiscalDownload, action: 'download' });
  if (!access?.ok) return result(false, fiscalMessage(access, 'No se pudo preparar la descarga privada.'));
  const anchor = globalThis.document?.createElement?.('a');
  if (!anchor) return result(false, 'La descarga privada requiere una ventana del panel.');
  anchor.href = access.data.signedUrl;
  anchor.download = `comprobante-fiscal-${button.dataset.fiscalDocument || 'autorizado'}.pdf`;
  anchor.rel = 'noreferrer';
  anchor.style.display = 'none';
  globalThis.document.body?.append(anchor);
  anchor.click();
  anchor.remove();
  feedback = 'Descarga privada iniciada. Si el enlace vence, solicitá uno nuevo.';
  context.onChange();
  return result(true, feedback);
}

async function regenerateFiscalArtifact(button) {
  const response = await context.regenerateFiscalArtifact(button.dataset.fiscalRegenerate);
  feedback = response?.ok ? 'Regeneración auditada en cola; el PDF actual se conserva hasta que el nuevo esté listo.' : fiscalMessage(response, 'No tenés permiso para regenerar este documento.');
  if (response?.ok) await refreshFiscal();
  else context.onChange();
  return result(Boolean(response?.ok), feedback);
}

async function openFiscalCacheFolder() {
  try {
    await context.desktopPlatform.openFiscalCacheFolder();
    return result(true, 'Se abrió únicamente la caché local autorizada.');
  } catch (error) {
    return result(false, error?.message || 'La caché local sólo está disponible en Windows.');
  }
}

async function printFiscalArtifact(button) {
  const row = button.closest('article[data-fiscal-document]');
  const printerName = String(row?.querySelector('[name="fiscalPrinter"]')?.value || '').trim();
  const format = String(row?.querySelector('[name="fiscalPrintFormat"]')?.value || 'a4');
  const copies = Number(row?.querySelector('[name="fiscalPrintCopies"]')?.value || 1);
  if (!printerName || !['a4', 'thermal'].includes(format) || !Number.isSafeInteger(copies) || copies < 1 || copies > 5) {
    return result(false, 'Seleccioná impresora, formato y entre una y cinco copias.');
  }
  const confirmed = typeof globalThis.confirm === 'function'
    ? globalThis.confirm(`Enviar ${copies} copia(s) ${format === 'a4' ? 'A4' : 'térmica(s)'} a ${printerName}?`)
    : true;
  if (!confirmed) return result(false, 'Impresión cancelada antes de enviar al spooler.');
  const artifactId = button.dataset.fiscalPrint;
  const printerNameHash = await sha256Text(printerName);
  if (!printerNameHash) return result(false, 'No se pudo proteger el identificador local de impresora.');
  const requested = await context.requestFiscalPrintJob({
    fiscalDocumentId: button.dataset.fiscalDocument,
    artifactId,
    printerNameHash,
    format,
    copies,
    idempotencyKey: createKey('fiscal-print'),
  });
  if (!requested?.ok) return result(false, fiscalMessage(requested, 'No se pudo auditar la solicitud de impresión.'));
  const printJobId = requested.data?.print_job_id;
  const access = await context.requestFiscalArtifactUrl({ artifactId, action: 'print' });
  if (!access?.ok) {
    await context.updateFiscalPrintJob({ printJobId, status: 'failed', errorCode: 'PRIVATE_ACCESS_FAILED' });
    return result(false, fiscalMessage(access, 'No se pudo recuperar el PDF privado para imprimir.'));
  }
  try {
    const response = await fetch(access.data.signedUrl, { cache: 'no-store', credentials: 'omit', redirect: 'error' });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'El enlace privado venció; solicitá una nueva impresión.' : 'No se pudo descargar el PDF privado.');
    const pdf = new Uint8Array(await response.arrayBuffer());
    const outcome = await context.desktopPlatform.queueFiscalPrint({
      printJobId,
      fiscalDocumentId: button.dataset.fiscalDocument,
      artifactId,
      printerName,
      printerNameHash,
      format,
      copies,
      title: fiscalPrintTitle(row),
      pdfBase64: bytesToBase64(pdf),
      thermalContent: format === 'thermal' ? thermalContent(row) : '',
    });
    await context.updateFiscalPrintJob({ printJobId, status: outcome?.status || 'unknown', errorCode: outcome?.errorCode || null });
    // Sólo una impresión VERIFICADA cuenta como evidencia del asistente; un
    // trabajo aceptado por el spooler no prueba que salió el papel.
    if (outcome?.status === 'completed_when_verifiable') {
      try { await context.recordFiscalVerification?.('print'); } catch (_) { /* sin evidencia, sin paso */ }
    }
    feedback = printOutcomeMessage(outcome?.status);
    context.onChange();
    return result(true, feedback);
  } catch (error) {
    await context.updateFiscalPrintJob({ printJobId, status: 'failed', errorCode: 'LOCAL_SPOOL_FAILED' });
    return result(false, error?.message || 'La impresora no aceptó el trabajo.');
  }
}

async function refreshOperationCenter() {
  if (operationCenterRefreshTimer !== null) globalThis.clearTimeout?.(operationCenterRefreshTimer);
  operationCenterRefreshTimer = null;
  operationCenterStatus = { phase: 'loading', message: '' };
  if (currentView === 'operation-center') context.onChange();
  const response = await context.getOperationCenter();
  if (!response?.ok || !response.data || Array.isArray(response.data) || typeof response.data !== 'object') {
    operationCenterSnapshot = null;
    operationCenterStatus = {
      phase: 'error',
      message: response?.message || 'No se pudo obtener el estado autoritativo de la operación.',
    };
  } else {
    operationCenterSnapshot = response.data;
    operationCenterStatus = { phase: 'ready', message: '' };
  }
  if (currentView === 'operation-center') context.onChange();
  if (currentView === 'operation-center') {
    operationCenterRefreshTimer = globalThis.setTimeout?.(() => { void refreshOperationCenter(); }, 30_000) || null;
  }
  return response;
}

function stopOperationCenterRefresh() {
  if (operationCenterRefreshTimer !== null) globalThis.clearTimeout?.(operationCenterRefreshTimer);
  operationCenterRefreshTimer = null;
  operationCenterRefreshStarted = false;
}

async function refreshOperationCenterAction() {
  if (busy) return result(false, 'Ya hay una actualización en curso.');
  busy = true;
  const response = await refreshOperationCenter();
  busy = false;
  feedback = response?.ok
    ? 'Centro de operación reconciliado con PostgreSQL.'
    : operationCenterStatus.message;
  context.onChange();
  return result(Boolean(response?.ok), feedback);
}

async function acknowledgeOperationalAlert(button) {
  if (busy) return result(false, 'Ya hay una acción en curso.');
  busy = true;
  const response = await context.acknowledgeOperationalAlert(button.dataset.operationalAlertAcknowledge);
  busy = false;
  feedback = response?.ok ? 'Alerta reconocida; la causa continúa visible hasta resolverse.' : fiscalMessage(response, 'No se pudo reconocer la alerta.');
  if (response?.ok) await refreshOperationCenter();
  else context.onChange();
  return result(Boolean(response?.ok), feedback);
}

async function resolveOperationalAlert(button) {
  if (busy) return result(false, 'Ya hay una acción en curso.');
  const row = button.closest('[data-operational-alert]');
  const note = String(row?.querySelector('[name="operationalResolutionNote"]')?.value || '').trim();
  if (note.length < 5) return result(false, 'Indicá qué se verificó o corrigió antes de resolver.');
  busy = true;
  const response = await context.resolveOperationalAlert({
    alertId: button.dataset.operationalAlertResolve,
    note,
  });
  busy = false;
  feedback = response?.ok ? 'Resolución auditada. La alerta reaparecerá si la condición persiste.' : fiscalMessage(response, 'No se pudo resolver la alerta.');
  if (response?.ok) await refreshOperationCenter();
  else context.onChange();
  return result(Boolean(response?.ok), feedback);
}

async function prepareDailyReconciliation(target) {
  if (busy) return result(false, 'Ya hay un cierre en curso.');
  const root = target.closest('[data-business-ops-center]');
  const businessDate = String(root?.querySelector('[name="dailyBusinessDate"]')?.value || '');
  const timezone = String(root?.querySelector('[name="dailyTimezone"]')?.value || operationTimezone());
  const declaredCash = Number(root?.querySelector('[name="dailyDeclaredCash"]')?.value || 0);
  const differenceNote = String(root?.querySelector('[name="dailyDifferenceNote"]')?.value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate) || !Number.isFinite(declaredCash) || declaredCash < 0) {
    return result(false, 'Poné la fecha del día y cuánto efectivo contaste.');
  }
  const cents = Math.round(declaredCash * 100);
  const idempotencyKey = `daily-prepare:${businessDate}:${cents}:${shortTextFingerprint(differenceNote)}`;
  busy = true;
  const response = await context.prepareDailyReconciliation({
    businessDate,
    timezone,
    declaredCash,
    differenceNote,
    idempotencyKey,
  });
  busy = false;
  if (response?.ok) dailyRun = readReconciliation(response.data);
  feedback = response?.ok
    ? 'Cierre calculado con los números del servidor. Revisá las diferencias antes de firmar.'
    : humanizeFailure(fiscalMessage(response, ''), 'No se pudo calcular el cierre.');
  if (response?.ok) await refreshOperationCenter();
  else context.onChange();
  return result(Boolean(response?.ok), feedback);
}

async function closeDailyReconciliation(button) {
  if (busy) return result(false, 'Ya hay un cierre en curso.');
  const guard = requireCapability('day.close');
  if (!guard.ok) return result(false, 'El cierre del día lo firma el dueño o el encargado.');
  const reconciliationId = String(button.dataset.dailyReconciliationClose || '');
  const expectedRevision = Number(button.dataset.dailyReconciliationRevision || 0);
  if (!reconciliationId || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    return refuseClosure('El cierre cambió mientras lo mirabas. Volvé a calcularlo.');
  }
  // Con problemas críticos abiertos, el cierre exige explicación y confirmación escrita.
  const closure = evaluateDailyClosure(dailyRun || {}, { alerts: operationCenterSnapshot?.alerts || [] });
  const root = button.closest('[data-business-ops-center]');
  const override = validateClosureOverride({
    criticalAlerts: closure.criticalAlerts,
    note: root?.querySelector('[name="closureOverrideNote"]')?.value,
    confirmation: root?.querySelector('[name="closureOverrideConfirmation"]')?.value,
  });
  if (!override.ok) return refuseClosure(override.message);
  const cashBlocker = closure.blockers.find((blocker) => blocker.id === 'cash-difference');
  if (cashBlocker) return refuseClosure(cashBlocker.detail);
  busy = true;
  const response = await context.closeDailyReconciliation({
    reconciliationId,
    expectedRevision,
    idempotencyKey: `daily-close:${reconciliationId}`,
  });
  busy = false;
  if (response?.ok) dailyRun = readReconciliation(response.data);
  feedback = response?.ok
    ? 'Día cerrado. Queda registrado y ya no se puede modificar.'
    : humanizeFailure(fiscalMessage(response, ''), 'No se pudo cerrar el día.');
  if (response?.ok) await refreshOperationCenter();
  else context.onChange();
  return result(Boolean(response?.ok), feedback);
}

// Un cierre que no se firma tiene que decir en pantalla por qué; si no, es un cierre silencioso al revés.
function refuseClosure(message) {
  feedback = message;
  context.onChange();
  return result(false, message);
}

function readReconciliation(data) {
  const payload = data && typeof data === 'object' ? data : {};
  const run = payload.reconciliation && typeof payload.reconciliation === 'object' ? payload.reconciliation : payload;
  return run && run.id ? run : null;
}

async function createLocalBackup() {
  if (busy) return result(false, 'Ya hay una acción local en curso.');
  busy = true;
  try {
    const backup = await context.desktopPlatform.createLocalBackup();
    feedback = `Backup local consistente y verificado. SHA-256 ${shortHash(backup?.sha256)}.`;
    return result(true, feedback);
  } catch (error) {
    feedback = error?.message || 'No se pudo crear y verificar el backup local.';
    return result(false, feedback);
  } finally {
    busy = false;
    context.onChange();
  }
}

async function exportSupportDiagnostic() {
  if (busy) return result(false, 'Ya hay una accion local en curso.');
  const correlations = (operationCenterSnapshot?.alerts || [])
    .map((alert) => String(alert?.correlation_id || ''))
    .filter(isUuid)
    .slice(0, 20);
  const online = globalThis.navigator?.onLine;
  busy = true;
  try {
    const exported = await context.desktopPlatform.exportSupportDiagnostic({
      networkStatus: online === true ? 'online' : online === false ? 'offline' : 'unknown',
      activeView: currentView,
      correlationIds: correlations,
    });
    feedback = `Diagnóstico sanitizado exportado. SHA-256 ${shortHash(exported?.sha256)}.`;
    return result(true, feedback);
  } catch (error) {
    feedback = error?.message || 'No se pudo exportar el diagnóstico sanitizado.';
    return result(false, feedback);
  } finally {
    busy = false;
    context.onChange();
  }
}

async function openSupportExportFolder() {
  try {
    await context.desktopPlatform.openSupportExportFolder();
    return result(true, 'Carpeta privada de exportaciones abierta.');
  } catch (error) {
    return result(false, error?.message || 'No se pudo abrir la carpeta de exportaciones.');
  }
}

async function checkForSignedUpdate() {
  if (busy) return result(false, 'Ya hay una acción local en curso.');
  busy = true;
  try {
    signedUpdateStatus = await context.desktopPlatform.checkForSignedUpdate();
    feedback = !signedUpdateStatus?.configured
      ? 'Este build local no tiene un canal de actualizaciones firmado configurado.'
      : signedUpdateStatus.available
        ? `Actualización firmada ${signedUpdateStatus.version} disponible. Requiere confirmación para instalar.`
        : 'La versión instalada es la última publicada en el canal firmado.';
    return result(true, feedback);
  } catch (error) {
    signedUpdateStatus = null;
    feedback = error?.message || 'No se pudo consultar el canal de actualizaciones firmadas.';
    return result(false, feedback);
  } finally {
    busy = false;
    context.onChange();
  }
}

async function installSignedUpdate(button) {
  const expectedVersion = String(button.dataset.signedUpdateInstall || '');
  if (!signedUpdateStatus?.available || expectedVersion !== signedUpdateStatus.version) {
    return result(false, 'La actualización cambió; volvé a consultar antes de instalar.');
  }
  if (busy) return result(false, 'Ya hay una acción local en curso.');
  busy = true;
  try {
    await context.desktopPlatform.installSignedUpdate({ expectedVersion, confirmed: true });
    feedback = 'Actualización firmada instalada. Windows cerrará la aplicación para completar el cambio.';
    return result(true, feedback);
  } catch (error) {
    feedback = error?.message || 'No se pudo instalar la actualización firmada.';
    return result(false, feedback);
  } finally {
    busy = false;
    context.onChange();
  }
}

export function businessOperationViewLabel(view) {
  return VIEW_META[view]?.[0] || '';
}

function renderScanner() { return panel('Escáner rápido', 'Lectura HID tipo teclado, Enter o Tab para confirmar.', `${scannerInput()}${renderScanResult()}`); }
function renderInventory(type) {
  const adjustment = type === 'manual_adjustment';
  return panel(adjustment ? 'Ajuste de stock' : 'Recepción de mercadería', 'Todo cambio crea un movimiento de ledger auditable.', `${scannerInput()}${renderScanResult()}${renderCommercialPublicationStatus()}
    <div class="business-ops-form"><label>Cantidad de packs/unidades<input name="packageQuantity" type="number" min="1" step="1" value="1"></label>
    ${adjustment ? '<label>Dirección<select name="direction"><option value="1">Ingreso</option><option value="-1">Egreso</option></select></label><label>Motivo<input name="reason" maxlength="160" required></label>' : '<input name="direction" type="hidden" value="1"><label>Referencia<input name="reason" maxlength="160" placeholder="Factura o remito (opcional)"></label>'}
    <button class="primary-button" type="button" data-inventory-confirm="${type}">Confirmar con servidor</button></div>`);
}
function renderStockCount() { return panel('Conteo físico', 'La diferencia se muestra y requiere confirmación; nunca ajusta en silencio.', `${scannerInput()}${renderScanResult()}<div class="business-ops-form"><label>Stock físico<input name="physicalStock" type="number" min="0" step="1"></label><label>Motivo<input name="reason" value="Conteo físico" maxlength="160"></label><button class="primary-button" type="button" data-stock-count-confirm>Conciliar conteo</button></div>`); }
function renderPacking() {
  const orders = context.getOrders().filter((order) => !['delivered', 'cancelled', 'canceled'].includes(order.status));
  const options = orders.map((order) => `<option value="${escapeHtml(order.backendId || order.id)}">${escapeHtml(order.code || order.id)}</option>`).join('');
  const progress = packingSession ? packingSession.items.map((item) => `<li><strong>${escapeHtml(item.name)}</strong><span>${item.scanned}/${item.required}</span></li>`).join('') : '';
  const pending = pendingPackingScanCount(packingSession);
  const durability = packingSession
    ? `<p class="business-ops-feedback" data-packing-durability>${pending ? `${pending} lectura(s) en cola durable; no se puede confirmar todavía.` : 'Lecturas reconciliadas con PostgreSQL.'}${packingCacheStatus ? ` ${escapeHtml(packingCacheStatus)}` : ''}</p>`
    : '';
  return panel('Preparación de pedido', 'El manifiesto se cachea sin datos del cliente; los scans offline se encolan y la confirmación exige reconciliación.', `<div class="business-ops-form"><label>Pedido<select name="packingOrder">${options || '<option value="">Sin pedidos activos</option>'}</select></label><button class="secondary-button" type="button" data-packing-start>Iniciar</button></div>${scannerInput()}${renderScanResult()}${durability}${progress ? `<ul class="business-ops-progress">${progress}</ul><div class="business-ops-form"><label>Motivo de excepción si hay faltantes<input name="packingExceptionReason" maxlength="300"></label><div class="button-row"><button class="ghost-button" type="button" data-packing-undo>Deshacer última lectura</button><button class="primary-button" type="button" data-packing-confirm>Confirmar preparación</button></div></div>` : ''}`);
}
function renderPos() {
  const items = posItems.length ? posItems.map((item) => `<li><span>${item.quantity} × ${escapeHtml(item.name)}</span><button type="button" class="ghost-button compact" data-pos-remove="${escapeHtml(item.productId)}">Quitar</button></li>`).join('') : '<li class="empty-state">Escaneá productos para preparar la venta.</li>';
  // El checkbox fiscal sólo se ofrece con la facturación habilitada de verdad:
  // ofrecerlo antes era prometer un comprobante que el backend rechaza siempre.
  const fiscalReady = fiscalProfile?.is_enabled === true;
  const fiscalControl = fiscalReady
    ? '<label class="business-ops-check"><input name="requestFiscal" type="checkbox"> Solicitar comprobante fiscal</label>'
    : '<p class="form-hint">Comprobante fiscal no disponible: la facturación todavía no está habilitada (ver Facturación).</p><input name="requestFiscal" type="hidden" value="">';
  return panel('Venta de mostrador', 'El servidor revalora precios y stock; el cliente envía sólo IDs y cantidades.', `${scannerInput()}${renderScanResult()}<ul class="business-ops-cart">${items}</ul><div class="business-ops-form"><label>Medio de pago<select name="paymentMethod"><option value="cash">Efectivo</option><option value="debit_card">Débito</option><option value="credit_card">Crédito</option><option value="transfer">Transferencia</option><option value="qr">QR</option></select></label>${fiscalControl}<div class="button-row"><button class="primary-button" type="button" data-pos-checkout>Confirmar venta</button><button class="ghost-button" type="button" data-pos-clear>Vaciar borrador</button></div></div>`);
}
function renderFiscalStatus() {
  const rows = fiscalDocuments.length ? fiscalDocuments.map((document) => renderFiscalDocument(document)).join('') : '<div class="empty-state"><strong>Sin comprobantes</strong><p>No se inventan autorizaciones ni CAE.</p></div>';
  const preview = fiscalPreview ? `<section class="business-fiscal-preview" data-fiscal-preview-surface><div class="button-row"><strong>Vista previa privada</strong><button class="ghost-button compact" type="button" data-fiscal-preview-close>Cerrar</button></div><iframe title="Vista previa de comprobante fiscal" src="${escapeHtml(fiscalPreview.signedUrl)}" sandbox="allow-scripts allow-same-origin"></iframe><small>El acceso temporal vence automáticamente; el PDF no se guarda en el navegador.</small></section>` : '';
  return panel('Estado fiscal', 'Autorizado sólo cuando ARCA devolvió CAE válido. La autorización y el PDF se recuperan por separado.', `<div class="button-row"><button class="secondary-button compact" type="button" data-fiscal-refresh>Actualizar</button><button class="ghost-button compact" type="button" data-fiscal-open-cache>Abrir caché de impresión</button></div>${preview}${rows}`);
}

function renderFiscalDocument(document) {
  const status = presentFiscalStatus(document);
  const artifact = fiscalArtifacts.find((candidate) => candidate.fiscal_document_id === document.id && candidate.is_current);
  const artifactState = artifact ? 'PDF disponible' : artifactLabel(document.artifact_state);
  const stateDetail = document.artifact_error_code ? `<small class="business-fiscal-error">${escapeHtml(fiscalError(document))}</small>` : '';
  const identity = `${document.document_intent === 'credit_note' ? 'Nota de crédito' : 'Comprobante'} ${document.document_type || ''} ${document.document_number || ''}`.trim();
  const artifactControls = artifact ? `<div class="business-fiscal-actions"><span class="business-fiscal-hash" title="SHA-256">SHA-256 ${escapeHtml(shortHash(artifact.sha256))}</span><button class="ghost-button compact" type="button" data-fiscal-preview="${escapeHtml(artifact.artifact_id)}">Vista previa</button><button class="ghost-button compact" type="button" data-fiscal-download="${escapeHtml(artifact.artifact_id)}" data-fiscal-document="${escapeHtml(document.id)}">Descargar PDF</button>${renderPrintControls(document, artifact)}</div>` : '';
  const canCredit = document.document_intent === 'invoice' && ['authorized', 'credited'].includes(document.state) && /^\d{14}$/.test(String(document.cae || ''));
  const credit = canCredit ? renderCreditControls(document) : '';
  const association = document.associated_document_id ? `<small>Asociado a comprobante ${escapeHtml(String(document.associated_document_id).slice(0, 8))}</small>` : '';
  return `<article class="business-fiscal-row" data-fiscal-document="${escapeHtml(document.id)}"><div><strong>${escapeHtml(status.label)}</strong><small>${escapeHtml(identity)}</small>${association}</div><span class="business-status ${status.tone}">${escapeHtml(document.state || '')}</span><span class="business-status ${artifact ? 'success' : 'warning'}">${escapeHtml(artifactState)}</span>${stateDetail}${artifactControls}${!artifact && ['authorized', 'credited'].includes(document.state) ? `<button class="ghost-button compact" type="button" data-fiscal-regenerate="${escapeHtml(document.id)}">Regenerar PDF (permiso)</button>` : ''}${credit}</article>`;
}

function renderPrintControls(document, artifact) {
  const options = fiscalPrinters.length ? fiscalPrinters.map((printer) => `<option value="${escapeHtml(printer.name)}">${escapeHtml(printer.name)}${printer.isDefault ? ' (predeterminada)' : ''}</option>`).join('') : '<option value="">Abrí TABA Windows para listar impresoras</option>';
  return `<div class="business-ops-form business-fiscal-print"><label>Impresora<select name="fiscalPrinter">${options}</select></label><label>Formato<select name="fiscalPrintFormat"><option value="a4">A4 (PDF)</option><option value="thermal">Térmica</option></select></label><label>Copias<input name="fiscalPrintCopies" type="number" min="1" max="5" step="1" value="1"></label><button class="secondary-button compact" type="button" data-fiscal-print="${escapeHtml(artifact.artifact_id)}" data-fiscal-document="${escapeHtml(document.id)}">Imprimir / reimprimir</button></div>`;
}

function renderCreditControls(document) {
  const items = Array.isArray(document.fiscal_document_items) ? document.fiscal_document_items : [];
  const draft = fiscalCreditDrafts.get(String(document.id));
  const kind = creditKindValue(draft?.kind);
  const lines = items.map((item) => {
    const line = draft?.lines?.[String(item.id)] || {};
    return `<div class="business-fiscal-credit-line" data-credit-line="${escapeHtml(item.id)}"><span>${escapeHtml(item.description)} · máximo ${escapeHtml(item.quantity)}</span><label>Cantidad<input name="creditQuantity" type="number" min="0" max="${escapeHtml(item.quantity)}" step="0.001" value="${escapeHtml(line.quantity || '0')}"></label><label>Ajuste neto<input name="creditNet" type="number" min="0" step="0.01" value="${escapeHtml(line.netAmount || '0')}"></label><label>Ajuste IVA<input name="creditTax" type="number" min="0" step="0.01" value="${escapeHtml(line.taxAmount || '0')}"></label></div>`;
  }).join('');
  return `<details class="business-fiscal-credit"${draft ? ' open' : ''}><summary>Solicitar nota de crédito</summary><label>Motivo<input name="creditReason" maxlength="300" value="${escapeHtml(draft?.reason || '')}"></label><label>Tipo<select name="creditKind"><option value="total"${kind === 'total' ? ' selected' : ''}>Total del saldo acreditable</option><option value="partial"${kind === 'partial' ? ' selected' : ''}>Parcial por ítem/cantidad</option><option value="commercial_adjustment"${kind === 'commercial_adjustment' ? ' selected' : ''}>Ajuste comercial autorizado</option></select></label><small>Los importes parciales se calculan desde snapshots; el ajuste comercial exige política aprobada.</small>${lines}<button class="ghost-button compact" type="button" data-fiscal-credit-note="${escapeHtml(document.id)}">Solicitar nota</button></details>`;
}
function renderFiscalConfig() {
  const profile = fiscalProfile || {};
  return panel('Configuración fiscal', 'Sólo homologación desde el panel. Producción requiere revisión contable y activación del servidor.', `<div class="business-fiscal-lock"><strong>Producción fiscal deshabilitada</strong><span>Revisión contable: ${escapeHtml(profile.accountant_review_status || 'pendiente')}</span><span>Gate: ${escapeHtml(profile.production_gate_status || 'bloqueado')}</span></div><div class="business-ops-form"><label>Razón social<input name="legalName" value="${escapeHtml(profile.legal_name || '')}" maxlength="160"></label><label>CUIT<input name="cuit" value="${escapeHtml(profile.cuit || '')}" inputmode="numeric" maxlength="11"></label><label>Condición fiscal<input name="taxCondition" value="${escapeHtml(profile.tax_condition || '')}" maxlength="80"></label><label>Condición predeterminada del receptor<input name="defaultRecipientCondition" value="${escapeHtml(profile.default_recipient_condition || '')}" maxlength="80"></label><label>Domicilio comercial<input name="businessAddress" value="${escapeHtml(profile.business_address || '')}" maxlength="200"></label><label>Punto de venta<input name="pointOfSale" value="${escapeHtml(profile.point_of_sale || '')}" type="number" min="1"></label><button class="primary-button" type="button" data-fiscal-config-save>Guardar perfil de homologación</button></div>`);
}

function scannerInput() { return `<div class="business-scanner-input"><label>Código<input data-barcode-input inputmode="numeric" autocomplete="off" maxlength="64" value="${escapeHtml(scannerDraftValue)}" placeholder="Escaneá o ingresá un GTIN"></label><button class="primary-button" type="button" data-business-scan-test ${busy ? 'disabled' : ''}>Procesar</button></div>`; }
function renderScanResult() {
  if (!lastScan) return '<div class="business-scan-result is-idle"><strong>Esperando lectura</strong><span>EAN-8, UPC-A, EAN-13 o GTIN-14.</span></div>';
  const product = lookup?.data ? normalizedProduct(lookup.data) : null;
  return `<div class="business-scan-result ${lastScan.isValid ? 'is-valid' : 'is-invalid'}"><dl><div><dt>Código</dt><dd>${escapeHtml(lastScan.normalizedValue || lastScan.rawValue || '—')}</dd></div><div><dt>Formato</dt><dd>${escapeHtml(lastScan.format || 'Inválido')}</dd></div><div><dt>Producto</dt><dd>${escapeHtml(product?.name || (busy ? 'Buscando…' : 'Desconocido'))}</dd></div><div><dt>Presentación</dt><dd>${escapeHtml(product?.presentation || '—')}</dd></div><div><dt>Factor</dt><dd>${escapeHtml(lookup?.data?.unit_factor || 1)}</dd></div><div><dt>Stock actual</dt><dd>${product ? `${product.stock} (último conocido)` : '—'}</dd></div></dl></div>`;
}
function normalizedProduct(binding) {
  const product = Array.isArray(binding.products) ? binding.products[0] : binding.products || {};
  const imageFields = [
    product.image_url, product.image_sha256, product.image_thumbnail_url,
    product.image_thumbnail_sha256, product.source_image_sha256, product.catalog_asset_id,
  ].map((value) => String(value || '').trim());
  const imageFieldCount = imageFields.filter(Boolean).length;
  return {
    id: String(binding.product_id || product.id || ''),
    sku: String(product.sku || ''),
    name: String(product.name || 'Producto'),
    presentation: String(product.presentation || binding.package_type || ''),
    stock: Number.isInteger(product.stock) ? product.stock : Number(product.stock || 0),
    available: product.available === true,
    isVerified: product.is_verified === true,
    isActive: product.is_active !== false,
    catalogOrigin: String(product.catalog_origin || ''),
    priceConfirmed: String(product.price_status || '') === 'confirmed' && Number(product.price) > 0,
    isAlcoholic: product.is_alcoholic === true,
    imageStatus: imageFieldCount === 0 ? 'none' : imageFieldCount === imageFields.length ? 'complete' : 'partial',
    hasImage: imageFieldCount > 0,
  };
}

/**
 * Decisión explícita, nunca automática: la recepción de mercadería sube el
 * stock y nada más. Este bloque es lo único que ofrece "Publicar en tienda",
 * y sólo cuando el producto ya cumple lo que el servidor va a exigir de
 * nuevo — el gate real es `set_commercial_product_publication`, esto sólo
 * evita ofrecer un botón que ya se sabe que va a fallar.
 */
function renderCommercialPublicationStatus() {
  if (!lookup?.data) return '';
  const product = normalizedProduct(lookup.data);
  if (!product.sku) return '';
  const canPublish = can(context.role, 'products.publish');

  if (product.available) {
    return `<div class="business-commercial-publication is-published">
      <strong>Publicado</strong><span>Ya se ve y se puede comprar en la tienda.</span>
      ${canPublish && !pendingCommercialHide ? `<button class="secondary-button" type="button" data-commercial-publish="false">Ocultar de la tienda</button>` : ''}
      ${canPublish && pendingCommercialHide ? `<div class="business-commercial-confirm" role="alert"><strong>¿Ocultar ${escapeHtml(product.name)} de la tienda?</strong><span>No modifica el stock.</span><div class="button-row"><button class="secondary-button" type="button" data-commercial-publish-confirm="false">Sí, ocultar</button><button class="ghost-button" type="button" data-commercial-publish-cancel>Cancelar</button></div></div>` : ''}
    </div>`;
  }
  if (product.stock <= 0) {
    return `<div class="business-commercial-publication is-out-of-stock">
      <strong>Sin stock</strong><span>Cargá una recepción para poder publicarlo.</span>
    </div>`;
  }
  if (product.isAlcoholic) {
    return `<div class="business-commercial-publication is-not-ready is-alcohol-blocked">
      <strong>No se puede publicar</strong><span>No se puede publicar hasta habilitar la venta de alcohol.</span>
    </div>`;
  }
  if (product.imageStatus === 'partial') {
    return `<div class="business-commercial-publication is-not-ready">
      <strong>Imagen incompleta</strong><span>La metadata de la imagen no cumple el contrato comercial.</span>
    </div>`;
  }
  if (product.catalogOrigin !== 'commercial' || !product.isVerified || !product.isActive || !product.priceConfirmed) {
    return `<div class="business-commercial-publication is-not-ready">
      <strong>Todavía no está listo</strong><span>Le falta verificación de datos maestros o precio confirmado antes de poder publicarse. Usá la importación comercial primero.</span>
    </div>`;
  }
  return `<div class="business-commercial-publication is-ready">
    <strong>Listo para publicar</strong>
    <span>${product.hasImage ? 'Con foto propia.' : 'Sin foto: se va a mostrar con la imagen genérica de TABA.'}</span>
    ${canPublish ? `<button class="primary-button" type="button" data-commercial-publish="true">Publicar en tienda</button>` : ''}
  </div>`;
}
function panel(title, subtitle, body) { return `<section class="business-ops-panel"><header><div><p class="eyebrow">Centro operativo</p><h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div></header>${body}</section>`; }
function result(ok, message) { return { handled: true, ok, message }; }
// -- Configuracion operativa: horarios, zonas, envio y minimo ----------------
//
// Ninguna de estas funciones decide nada. Validan temprano para no mandar algo
// que el servidor va a rechazar, y muestran lo que el servidor contesto. La
// autorizacion la hace la RPC -owner, admin, o staff con delegacion explicita-,
// y si dice que no, aca se muestra el motivo y no se cambia el estado local.

async function refreshOperationsConfig() {
  const generation = operationsConfigGeneration;
  const load = context.getOperationsConfig;
  operationsConfigStatus = { phase: 'loading', message: '' };
  context.onChange();
  const response = await load();
  // Si cambió la sesión o el comercio mientras la RPC estaba en vuelo, la
  // respuesta pertenece al contexto anterior y no puede repoblar el nuevo.
  if (generation !== operationsConfigGeneration) {
    return { ok: false, staleContext: true, message: '' };
  }
  if (response?.ok && response.data) {
    operationsConfig = normalizeOperationsConfig(response.data);
    operationsConfigDraft = { slots: null, hoursErrors: [], zoneErrors: [], enforcementError: '' };
    operationsConfigStatus = { phase: 'ready', message: '' };
  } else {
    operationsConfigStatus = {
      phase: 'error',
      message: humanizeFailure(response?.message, 'No pudimos leer la configuracion operativa.'),
    };
  }
  context.onChange();
  return response;
}

// ── Solicitudes de acceso ──────────────────────────────────────────────────
// Quien decide es el servidor: la RPC exige identity.members.write sobre ESTE
// comercio y se niega a que alguien decida sobre su propia solicitud. Acá abajo
// no hay ninguna regla de autorización, sólo el estado de la pantalla.

async function refreshAccessRequests() {
  accessRequestsStatus = { phase: 'loading', message: '' };
  context.onChange();
  const response = await context.listAccessRequests(accessRequestsFilter);
  if (response?.ok) {
    accessRequests = Array.isArray(response.data) ? response.data : [];
    accessRequestsStatus = { phase: 'ready', message: '' };
  } else {
    accessRequests = [];
    accessRequestsStatus = {
      phase: 'error',
      message: humanizeFailure(response?.message, 'No pudimos leer las solicitudes de acceso.'),
    };
  }
  context.onChange();
  return response;
}

async function reviewAccessRequestAction(requestId, decision, role = null) {
  if (busy) return result(false, 'Ya hay algo en curso.');
  if (!requestId) return result(false, 'No encontramos esa solicitud.');
  busy = true;
  const response = await context.reviewAccessRequest({ requestId, decision, role });
  busy = false;

  if (!response?.ok) {
    accessRequestsStatus = {
      phase: 'error',
      message: humanizeFailure(response?.message, 'No pudimos registrar la decisión.'),
    };
    await refreshAccessRequests();
    return result(false, accessRequestsStatus.message);
  }

  const code = String(response.data?.code || '');
  const message = accessDecisionMessage(code, response.data);
  accessRequestsStatus = { phase: 'ready', message };
  // Se relee siempre, incluso cuando la decisión no fue la esperada: la lista
  // que se está mirando ya no describe el estado real del comercio.
  await refreshAccessRequests();
  return result(code === 'approved' || code === 'rejected', message);
}

function accessDecisionMessage(code, data) {
  switch (code) {
    case 'approved':
      return `Acceso aprobado como ${accessRoleLabel(data?.granted_role)}.`;
    case 'rejected':
      return 'Solicitud rechazada.';
    case 'already_decided':
      return 'Esa solicitud ya estaba decidida.';
    case 'already_member':
      return 'Esa persona ya pertenece al equipo.';
    case 'self_review':
      return 'No podés decidir sobre tu propia solicitud.';
    case 'role_above_actor':
      return 'Ese rol lo otorga el dueño.';
    case 'invalid_role':
      return 'Ese rol no corresponde a lo que se pidió.';
    case 'not_found':
      return 'No encontramos esa solicitud.';
    default:
      return 'No pudimos registrar la decisión.';
  }
}

function accessRoleLabel(role) {
  return ({ admin: 'encargado', staff: 'equipo', rider: 'repartidor' })[String(role || '')] || 'miembro';
}

function cssAttributeValue(value) {
  const raw = String(value || '');
  const escape = globalThis.CSS?.escape;
  return typeof escape === 'function' ? escape.call(globalThis.CSS, raw) : raw.replace(/["\\]/g, '\\$&');
}

function resetOperationsConfigState() {
  operationsConfigGeneration += 1;
  operationsConfig = null;
  operationsConfigStatus = { phase: 'idle', message: '' };
  operationsConfigLoadStarted = false;
  operationsConfigDraft = { slots: null, hoursErrors: [], zoneErrors: [], enforcementError: '' };
}

async function refreshOperationsConfigAction() {
  if (busy) return result(false, 'Ya hay algo en curso.');
  busy = true;
  const response = await refreshOperationsConfig();
  busy = false;
  feedback = response?.ok ? 'Configuracion actualizada.' : operationsConfigStatus.message;
  context.onChange();
  return result(Boolean(response?.ok), feedback);
}

// La grilla que se esta editando: la del servidor, mas lo que el operador toco
// en esta pantalla y todavia no guardo.
function currentHourSlots() {
  if (operationsConfigDraft.slots) return operationsConfigDraft.slots;
  return (operationsConfig?.hours || [])
    .filter((row) => row.channel === 'delivery')
    .map((row) => ({ weekday: row.weekday, opensAt: row.opensAt, closesAt: row.closesAt }));
}

function addOperationsHoursSlot(button) {
  const weekday = Number(button.dataset.operationsHoursAdd);
  const row = button.closest('[data-weekday]');
  const opensAt = String(row?.querySelector('[name="opensAt-' + weekday + '"]')?.value || '');
  const closesAt = String(row?.querySelector('[name="closesAt-' + weekday + '"]')?.value || '');
  const slots = [...currentHourSlots(), { weekday, opensAt, closesAt }];
  const validation = validateWeeklyHours(slots);
  operationsConfigDraft = { ...operationsConfigDraft, slots, hoursErrors: validation.errors };
  context.onChange();
  return result(validation.ok, validation.ok ? 'Tramo agregado. Falta guardar.' : validation.errors[0]);
}

function clearOperationsHoursDay(button) {
  const weekday = Number(button.dataset.operationsHoursClear);
  const slots = currentHourSlots().filter((slot) => slot.weekday !== weekday);
  operationsConfigDraft = { ...operationsConfigDraft, slots, hoursErrors: [] };
  context.onChange();
  return result(true, 'Dia vaciado. Falta guardar.');
}

async function saveOperationsHours() {
  const validation = validateWeeklyHours(currentHourSlots());
  if (!validation.ok) {
    operationsConfigDraft = { ...operationsConfigDraft, hoursErrors: validation.errors };
    context.onChange();
    return result(false, validation.errors[0]);
  }
  busy = true;
  const response = await context.setServiceHours({
    channel: 'delivery',
    hours: validation.slots.map((slot) => ({
      weekday: slot.weekday, opens_at: slot.opensAt, closes_at: slot.closesAt,
    })),
  });
  busy = false;
  if (response?.ok) {
    operationsConfigDraft = { slots: null, hoursErrors: [], zoneErrors: [], enforcementError: '' };
    await refreshOperationsConfig();
    feedback = 'Horarios guardados.';
  } else {
    feedback = humanizeFailure(response?.message, 'El servidor no acepto los horarios.');
    operationsConfigDraft = { ...operationsConfigDraft, hoursErrors: [feedback] };
  }
  context.onChange();
  return result(Boolean(response?.ok), feedback);
}

async function toggleOperationsZone(button) {
  const zoneId = String(button.dataset.operationsZoneToggle || '');
  const zone = (operationsConfig?.zones || []).find((row) => row.id === zoneId);
  if (!zone) return result(false, 'No encontramos esa zona.');
  busy = true;
  const response = await context.setDeliveryZoneActive({ zoneId, active: !zone.isActive });
  busy = false;
  if (response?.ok) await refreshOperationsConfig();
  feedback = response?.ok
    ? (zone.isActive ? 'Zona desactivada. Deja de recibir pedidos ahora mismo.' : 'Zona activada.')
    : humanizeFailure(response?.message, 'El servidor no acepto el cambio de zona.');
  context.onChange();
  return result(Boolean(response?.ok), feedback);
}

async function addOperationsZone(target) {
  const root = target.closest('[data-business-ops-center]');
  const validation = validateZoneDraft({
    name: String(root?.querySelector('[name="zoneName"]')?.value || ''),
    matchKind: 'declared_area',
    deliveryFee: String(root?.querySelector('[name="zoneFee"]')?.value || ''),
    minimumSubtotal: String(root?.querySelector('[name="zoneMinimum"]')?.value || ''),
  });
  if (!validation.ok) {
    operationsConfigDraft = { ...operationsConfigDraft, zoneErrors: validation.errors };
    context.onChange();
    return result(false, validation.errors[0]);
  }
  busy = true;
  const response = await context.upsertDeliveryZone({ zone: validation.zone });
  busy = false;
  if (response?.ok) {
    operationsConfigDraft = { ...operationsConfigDraft, zoneErrors: [] };
    await refreshOperationsConfig();
    feedback = 'Zona agregada.';
  } else {
    feedback = humanizeFailure(response?.message, 'El servidor no acepto la zona.');
    operationsConfigDraft = { ...operationsConfigDraft, zoneErrors: [feedback] };
  }
  context.onChange();
  return result(Boolean(response?.ok), feedback);
}

// Un campo vacio es NULL, no cero. <<Sin minimo>> y <<minimo de cero pesos>> se
// escriben distinto porque significan cosas distintas, y Number('') vale 0.
function optionalAmount(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { ok: true, value: null };
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric < 0) return { ok: false, value: null };
  return { ok: true, value: Math.round(numeric) };
}

async function saveOperationsPricing(target) {
  const root = target.closest('[data-business-ops-center]');
  const deliveryFee = optionalAmount(root?.querySelector('[name="businessFee"]')?.value);
  const minimumSubtotal = optionalAmount(root?.querySelector('[name="businessMinimum"]')?.value);
  if (!deliveryFee.ok || !minimumSubtotal.ok) {
    return result(false, 'El costo de envío y el pedido mínimo deben estar vacíos o ser números no negativos.');
  }
  busy = true;
  const response = await context.setDeliveryPricing({
    deliveryFee: deliveryFee.value,
    minimumSubtotal: minimumSubtotal.value,
    maxRadiusMeters: operationsConfig?.maxRadiusMeters ?? null,
  });
  busy = false;
  if (response?.ok) await refreshOperationsConfig();
  feedback = response?.ok
    ? 'Envio y minimo guardados.'
    : humanizeFailure(response?.message, 'El servidor no acepto el envio y el minimo.');
  context.onChange();
  return result(Boolean(response?.ok), feedback);
}

async function saveOperationsEnforcement(target) {
  const root = target.closest('[data-business-ops-center]');
  const hoursEnforced = Boolean(root?.querySelector('[name="hoursEnforced"]')?.checked);
  const coverageEnforced = Boolean(root?.querySelector('[name="coverageEnforced"]')?.checked);
  const timezone = String(root?.querySelector('[name="operatingTimezone"]')?.value || '').trim();
  busy = true;
  const response = await context.setServiceEnforcement({
    hoursEnforced, coverageEnforced, timezone: timezone || null,
  });
  busy = false;
  if (response?.ok) {
    operationsConfigDraft = { ...operationsConfigDraft, enforcementError: '' };
    await refreshOperationsConfig();
    feedback = 'Exigencia guardada.';
  } else {
    feedback = humanizeFailure(response?.message, 'El servidor no acepto el cambio de exigencia.');
    operationsConfigDraft = { ...operationsConfigDraft, enforcementError: feedback };
  }
  context.onChange();
  return result(Boolean(response?.ok), feedback);
}
function positiveInteger(value, fallback) { const number = Number(value); return Number.isSafeInteger(number) && number > 0 ? number : fallback; }
function createKey(prefix) { return `${prefix}:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`; }
function artifactLabel(state) { return ({ artifact_pending: 'PDF pendiente', artifact_generating: 'Generando PDF', artifact_ready: 'PDF disponible', artifact_failed: 'PDF fallido', artifact_superseded: 'PDF reemplazado' })[state] || 'PDF pendiente'; }
function shortHash(value) { const hash = String(value || ''); return hash.length === 64 ? `${hash.slice(0, 12)}…${hash.slice(-8)}` : 'no disponible'; }
function fiscalError(document) { return document.artifact_error_message || document.artifact_error_code || 'El PDF requiere revisión técnica.'; }
function fiscalMessage(response, fallback) { return String(response?.message || response?.error?.message || fallback).slice(0, 300); }
function readCreditDraft(row) {
  const lines = {};
  for (const line of row.querySelectorAll('[data-credit-line]')) {
    const itemId = String(line.dataset.creditLine || '');
    if (!itemId) continue;
    lines[itemId] = {
      quantity: String(line.querySelector('[name="creditQuantity"]')?.value || '0').slice(0, 32),
      netAmount: String(line.querySelector('[name="creditNet"]')?.value || '0').slice(0, 32),
      taxAmount: String(line.querySelector('[name="creditTax"]')?.value || '0').slice(0, 32),
    };
  }
  return {
    reason: String(row.querySelector('[name="creditReason"]')?.value || '').slice(0, 300),
    kind: creditKindValue(row.querySelector('[name="creditKind"]')?.value),
    lines,
  };
}
function creditKindValue(value) { return ['total', 'partial', 'commercial_adjustment'].includes(String(value)) ? String(value) : 'total'; }
function fiscalPrintTitle(row) { return `TABA fiscal ${String(row?.dataset?.fiscalDocument || '').slice(0, 12)}`; }
function printOutcomeMessage(status) { return ({ queued: 'Impresión en cola local durable.', sent_to_spooler: 'Trabajo enviado al spooler; todavía no se confirma impresión física.', completed_when_verifiable: 'Impresión verificada.', unknown: 'El spooler no permite verificar el resultado; confirmá físicamente antes de reintentar.' })[status] || 'No se pudo verificar el resultado de impresión.'; }
function thermalContent(row) {
  const document = fiscalDocuments.find((candidate) => candidate.id === row?.dataset?.fiscalDocument);
  if (!document) return '';
  const items = (document.fiscal_document_items || []).map((item) => `${item.quantity} x ${item.description} ${Number(item.net_amount || 0) + Number(item.tax_amount || 0)}`).join('\n');
  return ['TABA - COMPROBANTE FISCAL', `${document.document_intent === 'credit_note' ? 'NOTA DE CREDITO' : 'FACTURA'} ${document.document_type || ''} ${document.document_number || ''}`, `CAE ${document.cae || ''}`, `VTO CAE ${document.cae_expiration || ''}`, items, `TOTAL ${document.currency || 'PES'} ${Number(document.total_amount || 0).toFixed(2)}`].filter(Boolean).join('\n');
}
/*
 * El día comercial NO lo define el aparato que abre el Panel.
 *
 * Esto devolvía `Intl.DateTimeFormat().resolvedOptions().timeZone`, es decir la
 * zona del teléfono, y ese valor terminaba recortando la ventana del cierre de
 * caja: el único registro que este sistema congela para siempre. Un dispositivo
 * en UTC corría el día tres horas y dejaba la noche entera del día anterior
 * fuera de su propio cierre, firmada en un SHA-256 imposible de corregir.
 *
 * Desde 20260814020000 la ventana la decide el servidor con
 * `businesses.operating_timezone` y este valor ya no interviene en el cálculo.
 * Se sigue usando para PREFORMATEAR la fecha visible, y por eso también tiene
 * que ser la del negocio: si no, el formulario propone el día equivocado.
 * Se reusa la constante que el Panel ya declaraba para mostrar horas, en vez de
 * sumar una cuarta copia de la zona.
 */
function operationTimezone() {
  return PANEL_TIMEZONE;
}
function operationBusinessDate(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: operationTimezone(), year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch (_) {
    return date.toISOString().slice(0, 10);
  }
}
function isUuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || '')); }
function shortTextFingerprint(value) {
  let hash = 2166136261;
  for (const character of String(value || '')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
async function sha256Text(value) {
  if (!globalThis.crypto?.subtle || typeof TextEncoder !== 'function') return '';
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function bytesToBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return globalThis.btoa(binary);
}
// ===== Pagos =====

async function refreshPayments() {
  paymentsStatus = { phase: 'loading', message: '' };
  context.onChange();
  const [list, activation] = await Promise.all([context.listPayments(), context.getPaymentsActivation()]);
  payments = list?.ok && Array.isArray(list.data) ? list.data : [];
  paymentsActivation = activation?.ok && activation.data && typeof activation.data === 'object' ? activation.data : null;
  paymentsStatus = list?.ok
    ? { phase: 'ready', message: '' }
    : { phase: 'error', message: humanizeFailure(list?.message, 'No pudimos leer los pagos ahora.') };
  context.onChange();
  return list;
}

async function refreshPaymentsAction() {
  if (busy) return result(false, 'Ya hay algo en curso.');
  busy = true;
  const response = await refreshPayments();
  busy = false;
  feedback = response?.ok ? 'Pagos actualizados.' : paymentsStatus.message;
  context.onChange();
  return result(Boolean(response?.ok), feedback);
}

async function saveMercadoPagoSettings(target) {
  const guard = requireCapability('payments.reconcile');
  if (!guard.ok) return guard.result;
  const root = target.closest('[data-business-ops-center]');
  const collector = String(root?.querySelector('[name="collectorId"]')?.value || '').trim();
  const application = String(root?.querySelector('[name="applicationId"]')?.value || '').trim();
  if (!/^\d{6,32}$/.test(collector) || !/^\d{6,32}$/.test(application)) {
    return result(false, 'Los dos números de la cuenta tienen que ser numéricos, tal como figuran en Mercado Pago.');
  }
  busy = true;
  const response = await context.configurePaymentSettings({ collector_id: collector, application_id: application });
  busy = false;
  feedback = response?.ok
    ? 'Datos de la cuenta guardados. Ninguna clave secreta se guarda en el panel.'
    : humanizeFailure(response?.message, 'No se pudieron guardar los datos de la cuenta.');
  if (response?.ok) await refreshPayments();
  else context.onChange();
  return result(Boolean(response?.ok), feedback);
}

async function enableMercadoPagoTestCharges() {
  const guard = requireCapability('payments.reconcile');
  if (!guard.ok) return guard.result;
  busy = true;
  const response = await context.configurePaymentSettings({ enabled: true, reserve_stock: true });
  busy = false;
  feedback = response?.ok
    ? 'Cobros de prueba activados. No se mueve dinero real.'
    : humanizeFailure(response?.message, 'No se pudieron activar los cobros de prueba.');
  if (response?.ok) await refreshPayments();
  else context.onChange();
  return result(Boolean(response?.ok), feedback);
}

async function runPaymentAction(button) {
  const action = String(button.dataset.paymentAction || '');
  const paymentIntentId = String(button.dataset.paymentIntent || '');
  if (action === 'refund') {
    const guard = requireCapability('payments.refund');
    if (!guard.ok) return guard.result;
    refundTarget = paymentIntentId;
    context.onChange();
    return result(true, 'Revisá el importe y confirmá por escrito antes de devolver.');
  }
  if (action === 'diagnostic') return exportPaymentDiagnostic(paymentIntentId);
  if (action === 'refresh') return refreshPaymentsAction();
  // Rearmar el pedido NO es reconciliar: toma stock y crea el pedido. Sin esta
  // rama el click caía en el reconcile de abajo, que consulta a Mercado Pago y
  // contesta "en unos segundos se actualiza solo" sin haber armado nada.
  if (action === 'recover-order') return recoverPaymentOrder(paymentIntentId);
  const guard = requireCapability('payments.reconcile');
  if (!guard.ok) return guard.result;
  if (busy) return result(false, 'Ya hay algo en curso.');
  busy = true;
  const response = await context.reconcilePayment(paymentIntentId);
  busy = false;
  feedback = response?.ok
    ? 'Le pedimos el resultado a Mercado Pago. En unos segundos se actualiza solo.'
    : humanizeFailure(response?.message, 'No pudimos consultar el pago ahora.');
  if (response?.ok) await refreshPayments();
  else context.onChange();
  return result(Boolean(response?.ok), feedback);
}

/**
 * Rearma el pedido de un cobro que entró y se quedó sin reserva.
 *
 * El botón se ofrece sólo si el servidor levantó `can_recover_order`, pero el
 * permiso se vuelve a exigir acá: el markup se puede falsificar y esta acción
 * toma stock. Es la misma capacidad elevada que la reconciliación, así que el
 * equipo no la ejecuta aunque llegue a disparar el evento.
 *
 * Duplicar no depende de esta guarda: `recover_paid_checkout_order` es
 * idempotente y sobre un pedido ya armado contesta que ya estaba. `busy` sólo
 * evita el doble click mientras la primera llamada está en vuelo.
 */
async function recoverPaymentOrder(paymentIntentId) {
  const guard = requireCapability('payments.reconcile');
  if (!guard.ok) return guard.result;
  const payment = payments.find((candidate) => String(candidate.payment_intent_id) === paymentIntentId);
  const checkoutSessionId = String(payment?.checkout_session_id || '');
  if (!checkoutSessionId) {
    return result(false, 'Este cobro no tiene una compra asociada para rearmar. Prepará el diagnóstico y pasalo a soporte.');
  }
  if (busy) return result(false, 'Ya hay algo en curso.');
  busy = true;
  const response = await context.recoverOrder(checkoutSessionId);
  busy = false;
  // El mensaje del servidor es el que importa: cuando falta stock dice qué falta
  // y cuánto, y eso es lo que deja al operador decidir si devuelve el dinero.
  feedback = response?.ok
    ? humanizeFailure(response?.message, 'Listo: el pedido de este cobro quedó armado.')
    : humanizeFailure(response?.message, 'No pudimos armar el pedido de este cobro.');
  if (response?.ok) await refreshPayments();
  else context.onChange();
  return result(Boolean(response?.ok), feedback);
}

async function confirmPaymentRefund(button) {
  const guard = requireCapability('payments.refund');
  if (!guard.ok) return guard.result;
  const paymentIntentId = String(button.dataset.paymentRefundConfirm || '');
  const form = button.closest('[data-payment-refund-form]');
  const payment = payments.find((candidate) => String(candidate.payment_intent_id) === paymentIntentId);
  const validation = validateRefundRequest({
    amount: form?.querySelector('[name="refundAmount"]')?.value,
    reason: form?.querySelector('[name="refundReason"]')?.value,
    confirmation: form?.querySelector('[name="refundConfirmation"]')?.value,
    maximum: Number(payment?.amount || 0),
  });
  if (!validation.ok) return result(false, validation.message);
  if (busy) return result(false, 'Ya hay algo en curso.');
  busy = true;
  const response = await context.refundPayment({
    paymentIntentId,
    amount: validation.amount,
    reason: validation.reason,
    confirmation: 'CONFIRMED',
  });
  busy = false;
  refundTarget = response?.ok ? '' : refundTarget;
  feedback = response?.ok
    ? 'Devolución enviada. Cuando Mercado Pago la confirme, se ve acá.'
    : humanizeFailure(response?.message, 'No se pudo enviar la devolución.');
  if (response?.ok) await refreshPayments();
  else context.onChange();
  return result(Boolean(response?.ok), feedback);
}

async function exportPaymentDiagnostic(paymentIntentId) {
  const payment = payments.find((candidate) => String(candidate.payment_intent_id) === paymentIntentId);
  if (!payment) return result(false, 'No encontramos ese pago en la lista.');
  try {
    await context.desktopPlatform.exportSupportDiagnostic({
      networkStatus: globalThis.navigator?.onLine === false ? 'offline' : 'online',
      activeView: 'payments',
      correlationIds: [],
    });
    feedback = 'Diagnóstico preparado en la carpeta de exportaciones.';
    return result(true, feedback);
  } catch (error) {
    feedback = humanizeFailure(error?.message, 'Preparar el diagnóstico necesita TABA para Windows.');
    context.onChange();
    return result(false, feedback);
  }
}

// ===== Facturación =====

async function refreshArcaActivation() {
  const response = await context.getArcaActivation();
  arcaActivation = response?.ok && response.data && typeof response.data === 'object' ? response.data : null;
  if (!response?.ok) {
    feedback = humanizeFailure(response?.message, 'No pudimos leer el estado de la facturación.');
  }
  context.onChange();
  return response;
}

async function authorizeArcaHomologation(target) {
  const guard = requireCapability('fiscal.authorize');
  if (!guard.ok) return guard.result;
  const root = target.closest('[data-business-ops-center]');
  const phrase = String(root?.querySelector('[name="arcaAuthorization"]')?.value || '');
  const validation = validateHomologationAuthorization(phrase);
  if (!validation.ok) return result(false, validation.message);
  if (busy) return result(false, 'Ya hay algo en curso.');
  busy = true;
  const response = await context.authorizeArcaHomologation(phrase);
  busy = false;
  arcaAuthorizationDraft = response?.ok ? '' : arcaAuthorizationDraft;
  feedback = response?.ok
    ? 'Pruebas con ARCA habilitadas. La facturación real sigue apagada.'
    : humanizeFailure(response?.message, 'No se pudieron habilitar las pruebas con ARCA.');
  if (response?.ok) await refreshArcaActivation();
  else context.onChange();
  return result(Boolean(response?.ok), feedback);
}

// ===== Abrir el negocio =====

async function refreshOpeningStatus() {
  const opening = await context.getOpeningStatus();
  openingStatusRaw = opening?.ok && opening.data && typeof opening.data === 'object' ? opening.data : null;
  openingSignals = buildOpeningSignals(openingStatusRaw, Boolean(opening?.ok));
  if (!opening?.ok) feedback = humanizeFailure(opening?.message, 'No pudimos revisar todo antes de abrir.');
  context.onChange();
  return opening;
}

// Cruza lo que confirma el servidor con lo que sólo se puede ver desde esta computadora.
function buildOpeningSignals(status, serverAnswered) {
  // Que el servidor haya contestado es la prueba de que hay internet; el aviso del
  // navegador sólo se usa para detectar que se cayó.
  const online = globalThis.navigator?.onLine === false ? false : serverAnswered ? true : globalThis.navigator?.onLine;
  const scannerReady = deviceResults.scanner?.state === 'connected';
  const printersReady = deviceResults.spooler?.state === 'connected' || deviceCheckPrinters.length > 0;
  const scannerTested = Boolean(deviceResults.scanner);
  const printersTested = Boolean(deviceResults.spooler) || deviceCheckPrinters.length > 0;
  return {
    internet: {
      status: online === false ? 'failed' : online === true ? 'ok' : 'unknown',
      detail: online === false
        ? 'Esta computadora está sin internet.'
        : online === true ? 'Hay conexión.' : 'No se pudo determinar la conexión.',
    },
    backend: status?.backend || { status: serverAnswered ? 'ok' : 'unknown' },
    payments: status?.payments || { status: 'unknown' },
    fiscal: status?.fiscal || { status: 'unknown' },
    riders: status?.riders || { status: 'unknown' },
    queues: status?.queues || { status: 'unknown' },
    scanner: {
      status: !scannerTested ? 'unknown' : scannerReady ? 'ok' : 'failed',
      detail: !scannerTested ? 'Probalo desde Dispositivos.' : scannerReady ? 'El lector responde.' : 'El lector no entregó una lectura completa.',
    },
    printers: {
      status: !printersTested ? 'unknown' : printersReady ? 'ok' : 'failed',
      detail: !printersTested ? 'Probalas desde Dispositivos.' : printersReady ? 'Hay impresoras disponibles.' : 'No se detectaron impresoras.',
    },
  };
}

async function setBusinessOpenState(button) {
  const guard = requireCapability('day.open');
  if (!guard.ok) return guard.result;
  if (busy) return result(false, 'Ya hay algo en curso.');
  const next = String(button.dataset.businessOpenState || '');
  busy = true;
  const response = await context.setBusinessOpenState(next);
  busy = false;
  feedback = response?.ok
    ? next === 'open' ? 'Negocio abierto. Ya podés recibir pedidos.' : 'Pedidos pausados. La web deja de tomar nuevos.'
    : humanizeFailure(response?.message, 'No se pudo cambiar el estado del negocio.');
  if (response?.ok) await refreshOpeningStatus();
  else context.onChange();
  return result(Boolean(response?.ok), feedback);
}

// ===== Dispositivos =====

async function refreshDeviceCheckPrinters() {
  try {
    const list = await context.desktopPlatform.listPrinters();
    deviceCheckPrinters = Array.isArray(list) ? list : [];
  } catch (_) {
    deviceCheckPrinters = [];
  }
  context.onChange();
}

async function runDeviceTest(button) {
  const guard = requireCapability('devices.test');
  if (!guard.ok) return guard.result;
  const device = String(button.dataset.deviceTest || '');
  if (busy) return result(false, 'Ya hay una prueba en curso.');
  busy = true;
  try {
    if (device === 'scanner') {
      feedback = 'Escaneá cualquier producto con el lector para probarlo.';
      return result(true, feedback);
    }
    if (device === 'spooler') {
      await refreshDeviceCheckPrinters();
      deviceResults = { ...deviceResults, spooler: classifySpoolerCheck(deviceCheckPrinters) };
      feedback = deviceResults.spooler.detail;
      return result(deviceResults.spooler.state === 'connected', feedback);
    }
    if (device === 'qr') {
      const artifact = fiscalArtifacts.find((candidate) => candidate.is_current);
      deviceResults = { ...deviceResults, qr: classifyQrCheck(Boolean(artifact)) };
      feedback = deviceResults.qr.detail;
      return result(Boolean(artifact), feedback);
    }
    return runPrinterTest(button, device);
  } finally {
    busy = false;
    context.onChange();
  }
}

async function runPrinterTest(button, device) {
  const root = button.closest('[data-business-ops-center]');
  const printerName = String(root?.querySelector('[name="deviceTestPrinter"]')?.value || '');
  if (!printerName) {
    deviceResults = { ...deviceResults, [device]: { device, state: 'no-response', detail: 'Elegí una impresora de la lista.' } };
    return result(false, 'Elegí una impresora de la lista.');
  }
  try {
    const probe = await context.desktopPlatform.probePrinter(printerName);
    const probed = classifyPrinterProbe(probe);
    if (['no-response', 'no-paper', 'error'].includes(probed.state)) {
      deviceResults = { ...deviceResults, [device]: probed };
      feedback = probed.detail;
      return result(false, feedback);
    }
    const outcome = await context.desktopPlatform.print({
      printerName,
      title: 'TABA prueba de impresora',
      content: buildDeviceTestTicket(device),
      format: 'raw_text',
    });
    const submission = classifyPrintSubmission(outcome || { status: 'sent_to_spooler' });
    deviceResults = { ...deviceResults, [device]: submission };
    feedback = submission.detail;
    return result(true, feedback);
  } catch (error) {
    const detail = humanizeFailure(error?.message, 'La prueba de impresión necesita TABA para Windows.');
    deviceResults = { ...deviceResults, [device]: { device, state: 'error', detail } };
    feedback = detail;
    return result(false, detail);
  }
}

// La confirmación física es la única prueba real de que el papel salió.
function confirmDevicePrint(button) {
  const device = String(button.dataset.deviceConfirm || '');
  deviceResults = {
    ...deviceResults,
    [device]: { device, state: 'connected', detail: 'Confirmaste que salió el papel.' },
  };
  feedback = 'Impresión confirmada a mano.';
  context.onChange();
  return result(true, feedback);
}

function buildDeviceTestTicket(device) {
  return [
    'TABA - PRUEBA DE IMPRESORA',
    `Formato: ${device === 'a4' ? 'A4' : 'termica'}`,
    'Si lees esto, la impresora funciona.',
    'Volve al panel y confirma que salio el papel.',
    '',
    '',
  ].join('\n');
}

// ===== Alta de producto =====

function readProductFields(target) {
  const form = target.closest('[data-product-draft]') || target.closest('[data-business-ops-center]');
  const value = (name) => String(form?.querySelector(`[name="${name}"]`)?.value || '');
  return {
    name: value('productName'),
    brand: value('productBrand'),
    category: value('productCategory'),
    variant: value('productVariant'),
    capacityValue: value('productCapacityValue'),
    capacityUnit: value('productCapacityUnit'),
    packageType: value('productPackageType'),
    unitsPerPack: value('productUnitsPerPack'),
    stock: value('productStock'),
    price: value('productPrice'),
    cost: value('productCost'),
    pricePending: Boolean(form?.querySelector('[name="productPricePending"]')?.checked),
  };
}

function previewProductDraft(target) {
  const validation = validateProductDraft(readProductFields(target));
  productErrors = validation.ok ? [] : [...validation.errors];
  productPreview = validation.ok ? buildStorefrontPreview(validation.value, { imageReady: false }) : null;
  feedback = validation.ok ? 'Así lo va a ver el cliente.' : 'Revisá los datos marcados antes de seguir.';
  context.onChange();
  return result(validation.ok, feedback);
}

async function completeProductDraft(target) {
  const guard = requireCapability('products.publish');
  if (!guard.ok) return guard.result;
  const validation = validateProductDraft(readProductFields(target));
  productErrors = validation.ok ? [] : [...validation.errors];
  if (!validation.ok) {
    context.onChange();
    return result(false, 'Revisá los datos marcados antes de publicar.');
  }
  if (!productDraft?.id) return result(false, 'Abrí el borrador antes de guardar.');
  if (busy) return result(false, 'Ya hay algo en curso.');
  busy = true;
  const published = await context.publishProductDraft({
    draftId: productDraft.id,
    name: validation.value.name,
    category: validation.value.category,
    price: validation.value.pricePending ? 0 : validation.value.price,
    packageType: validation.value.packageType,
    unitFactor: validation.value.unitsPerPack,
  });
  if (!published?.ok) {
    busy = false;
    feedback = humanizeFailure(published?.message, 'No se pudo crear el producto.');
    context.onChange();
    return result(false, feedback);
  }
  productId = String(published.data?.product_id || '');
  const completed = await context.completeScannedProduct({
    productId,
    details: {
      name: validation.value.name,
      brand: validation.value.brand,
      category: validation.value.category,
      variant: validation.value.variant,
      capacity_value: validation.value.capacityValue,
      capacity_unit: validation.value.capacityUnit,
      units_per_pack: validation.value.unitsPerPack,
      price: validation.value.pricePending ? null : validation.value.price,
      price_pending: validation.value.pricePending,
      unit_cost: validation.value.cost,
      stock: validation.value.stock,
    },
  });
  busy = false;
  if (completed?.ok) {
    productReadiness = completed.data;
    productPreview = buildStorefrontPreview(validation.value, { imageReady: Boolean(completed.data?.image_bound) });
    feedback = validation.value.pricePending
      ? 'Producto guardado con precio pendiente: se ve en la web pero todavía no se puede comprar.'
      : 'Producto guardado. Abajo te decimos qué falta para que aparezca en la web.';
  } else {
    feedback = humanizeFailure(completed?.message, 'El producto se creó pero no se pudieron guardar todos los datos.');
  }
  context.onChange();
  return result(Boolean(completed?.ok), feedback);
}

async function refreshProductReadiness() {
  if (!productId) return result(false, 'Todavía no hay un producto para revisar.');
  if (busy) return result(false, 'Ya hay algo en curso.');
  busy = true;
  const response = await context.getScannedProductReadiness(productId);
  busy = false;
  if (response?.ok) productReadiness = response.data;
  feedback = response?.ok
    ? 'Estado de publicación actualizado.'
    : humanizeFailure(response?.message, 'No pudimos leer el estado de publicación.');
  context.onChange();
  return result(Boolean(response?.ok), feedback);
}

function requireCapability(capability) {
  if (can(context.role, capability)) return { ok: true };
  const message = capability === 'payments.refund'
    ? 'Devolver dinero lo confirma el dueño o el encargado.'
    : 'Esta acción la confirma el dueño o el encargado.';
  return { ok: false, result: result(false, message) };
}

function defaultContext() {
  return {
    role: 'staff',
    operatorName: '',
    getOperationsConfig: async () => ({ ok: false, message: 'La configuración operativa no está disponible.' }),
    setServiceHours: async () => ({ ok: false, message: 'La configuración operativa no está disponible.' }),
    upsertDeliveryZone: async () => ({ ok: false, message: 'La configuración operativa no está disponible.' }),
    setDeliveryZoneActive: async () => ({ ok: false, message: 'La configuración operativa no está disponible.' }),
    setDeliveryPricing: async () => ({ ok: false, message: 'La configuración operativa no está disponible.' }),
    setServiceEnforcement: async () => ({ ok: false, message: 'La configuración operativa no está disponible.' }),
    listPayments: async () => ({ ok: false, message: 'Los pagos no están disponibles.' }),
    getPaymentsActivation: async () => ({ ok: false, message: 'El estado de cobros no está disponible.' }),
    configurePaymentSettings: async () => ({ ok: false, message: 'La configuración de cobros no está disponible.' }),
    reconcilePayment: async () => ({ ok: false, message: 'La consulta de pagos no está disponible.' }),
    recoverOrder: async () => ({ ok: false, message: 'Rearmar el pedido no está disponible.' }),
    refundPayment: async () => ({ ok: false, message: 'Las devoluciones no están disponibles.' }),
    getArcaActivation: async () => ({ ok: false, message: 'El estado de facturación no está disponible.' }),
    authorizeArcaHomologation: async () => ({ ok: false, message: 'La autorización fiscal no está disponible.' }),
    getOpeningStatus: async () => ({ ok: false, message: 'La revisión de apertura no está disponible.' }),
    listAccessRequests: async () => ({ ok: false, message: 'Las solicitudes de acceso no están disponibles.' }),
    reviewAccessRequest: async () => ({ ok: false, message: 'Las solicitudes de acceso no están disponibles.' }),
    setBusinessOpenState: async () => ({ ok: false, message: 'No se puede cambiar el estado del negocio.' }),
    recordFiscalVerification: async () => ({ ok: false, message: 'La verificación fiscal no está disponible.' }),
    completeScannedProduct: async () => ({ ok: false, message: 'El alta de producto no está disponible.' }),
    getScannedProductReadiness: async () => ({ ok: false, message: 'El estado de publicación no está disponible.' }),
    businessId: '', operatorId: '', getOrders: () => [], lookupBarcode: async () => ({ ok: true, data: null }),
    createProductDraft: async () => ({ ok: false, message: 'Repositorio no disponible.' }), publishProductDraft: async () => ({ ok: false, message: 'Repositorio no disponible.' }),
    applyInventoryMovement: async () => ({ ok: false, message: 'Repositorio no disponible.' }), checkoutPos: async () => ({ ok: false, message: 'Repositorio no disponible.' }),
    setCommercialPublication: async () => ({ ok: false, message: 'Repositorio no disponible.' }),
    startPacking: async () => ({ ok: false, message: 'Repositorio no disponible.' }), getPackingManifest: async () => ({ ok: false, message: 'Repositorio no disponible.' }),
    recordPackingScan: async () => ({ ok: false, message: 'Repositorio no disponible.' }), revertPackingScan: async () => ({ ok: false, message: 'Repositorio no disponible.' }),
    cancelPackingScan: async () => false, drainPackingCommands: async () => [], listPackingCommands: () => [],
    confirmPacking: async () => ({ ok: false, message: 'Repositorio no disponible.' }),
    getFiscalProfile: async () => ({ ok: true, data: null }), listFiscalDocuments: async () => ({ ok: true, data: [] }), listFiscalArtifacts: async () => ({ ok: true, data: [] }),
    configureFiscalProfile: async () => ({ ok: false, message: 'Repositorio no disponible.' }), requestCreditNote: async () => ({ ok: false, message: 'Repositorio no disponible.' }),
    requestFiscalArtifactUrl: async () => ({ ok: false, message: 'Acceso privado no disponible.' }), regenerateFiscalArtifact: async () => ({ ok: false, message: 'Repositorio no disponible.' }),
    requestFiscalPrintJob: async () => ({ ok: false, message: 'Repositorio no disponible.' }), updateFiscalPrintJob: async () => ({ ok: false, message: 'Repositorio no disponible.' }),
    getOperationCenter: async () => ({ ok: false, message: 'Centro de operación no disponible.' }),
    acknowledgeOperationalAlert: async () => ({ ok: false, message: 'Repositorio no disponible.' }), resolveOperationalAlert: async () => ({ ok: false, message: 'Repositorio no disponible.' }),
    prepareDailyReconciliation: async () => ({ ok: false, message: 'Repositorio no disponible.' }), closeDailyReconciliation: async () => ({ ok: false, message: 'Repositorio no disponible.' }),
    desktopPlatform: {
      isNative: false,
      listPrinters: async () => [],
      probePrinter: async () => null,
      print: async () => { throw new Error('La prueba de impresión requiere TABA para Windows.'); },
      queueFiscalPrint: async () => { throw new Error('La impresión fiscal requiere TABA para Windows.'); },
      openFiscalCacheFolder: async () => { throw new Error('La caché local requiere TABA para Windows.'); },
      createLocalBackup: async () => { throw new Error('El backup local requiere TABA para Windows.'); },
      verifyLocalBackup: async () => { throw new Error('La verificación local requiere TABA para Windows.'); },
      exportSupportDiagnostic: async () => { throw new Error('El diagnóstico local requiere TABA para Windows.'); },
      openSupportExportFolder: async () => { throw new Error('Las exportaciones requieren TABA para Windows.'); },
      checkForSignedUpdate: async () => ({ configured: false, available: false }),
      installSignedUpdate: async () => { throw new Error('El canal firmado requiere TABA para Windows.'); },
      savePackingCache: async () => { throw new Error('La caché de packing requiere almacenamiento durable.'); },
      loadPackingCache: async () => null,
      deletePackingCache: async () => false,
    },
    onChange: () => {},
  };
}
