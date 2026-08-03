import { createBarcodeScannerService, SCANNER_MODES } from '../catalog/barcode-scanner-service.js';
import { escapeHtml } from '../ui.js';
import { applyPackingScan, createPackingSession, undoLastPackingScan } from './business-packing-verification.js';
import { presentFiscalStatus } from '../pos/fiscal-status-presenter.js';

export const BUSINESS_OPERATION_VIEWS = Object.freeze([
  'scanner', 'product-create', 'inventory-receive', 'inventory-adjust',
  'stock-count', 'packing', 'pos', 'fiscal-status', 'fiscal-config',
]);

const VIEW_META = Object.freeze({
  scanner: ['Escáner rápido', 'product_lookup'],
  'product-create': ['Alta de producto', 'product_create'],
  'inventory-receive': ['Recepción', 'inventory_receive'],
  'inventory-adjust': ['Ajuste', 'inventory_adjust'],
  'stock-count': ['Conteo físico', 'stock_count'],
  packing: ['Preparación', 'order_packing'],
  pos: ['Mostrador', 'pos_sale'],
  'fiscal-status': ['Estado fiscal', null],
  'fiscal-config': ['Configuración fiscal', null],
});

let context = defaultContext();
let currentView = 'scanner';
let scanner = null;
let unsubscribeScanner = null;
let scannerDraftValue = '';
let lastScan = null;
let lookup = null;
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
let productDraft = null;

export function configureBusinessOperations(next = {}) {
  context = { ...defaultContext(), ...next };
  packingSession = null;
  return context;
}

export function renderBusinessOperations(view) {
  currentView = BUSINESS_OPERATION_VIEWS.includes(view) ? view : 'scanner';
  const content = ({
    scanner: renderScanner,
    'product-create': renderProductCreate,
    'inventory-receive': () => renderInventory('purchase_receipt'),
    'inventory-adjust': () => renderInventory('manual_adjustment'),
    'stock-count': renderStockCount,
    packing: renderPacking,
    pos: renderPos,
    'fiscal-status': renderFiscalStatus,
    'fiscal-config': renderFiscalConfig,
  })[currentView]();
  queueMicrotask(() => activateBusinessOperations(currentView));
  return `<section class="business-ops-center" data-business-ops-center="${escapeHtml(currentView)}">
    ${renderNavigation()}
    ${feedback ? `<p class="business-ops-feedback" role="status">${escapeHtml(feedback)}</p>` : ''}
    ${content}
  </section>`;
}

export function activateBusinessOperations(view = currentView) {
  const mode = VIEW_META[view]?.[1];
  if (!mode) {
    scanner?.stop();
    if ((view === 'fiscal-status' || view === 'fiscal-config') && !fiscalInitialRefreshStarted) {
      fiscalInitialRefreshStarted = true;
      void refreshFiscal();
    }
    return;
  }
  scanner ||= createBarcodeScannerService();
  unsubscribeScanner ||= scanner.subscribe((event) => { void processScan(event); });
  scanner.start(mode);
}

export async function handleBusinessOperationsAction(target) {
  if (!target?.closest) return { handled: false };
  const viewButton = target.closest('[data-business-ops-view]');
  if (viewButton) return { handled: true, view: viewButton.dataset.businessOpsView };

  if (target.closest('[data-business-scan-test]')) {
    const input = target.closest('[data-business-ops-center]')?.querySelector('[data-barcode-input]');
    if (!scanner?.isActive()) activateBusinessOperations(currentView);
    const event = scanner.test(input?.value || '', 'simulator');
    return { handled: true, ok: event.isValid, message: event.isValid ? '' : 'Código inválido.' };
  }

  if (target.closest('[data-create-product-draft]')) {
    if (!lastScan?.isValid) return result(false, 'Escaneá un GTIN válido antes de crear el borrador.');
    busy = true;
    const response = await context.createProductDraft({
      gtin: lastScan.normalizedValue,
      suggestion: lookup?.data || {},
      idempotencyKey: createKey('product-draft'),
    });
    busy = false;
    if (response?.ok) productDraft = Array.isArray(response.data) ? response.data[0] : response.data;
    feedback = response?.ok ? 'Borrador creado. Requiere confirmación owner/admin.' : response?.message || 'No se pudo crear el borrador.';
    context.onChange();
    return result(Boolean(response?.ok), feedback);
  }

  if (target.closest('[data-publish-product-draft]')) return publishProductDraft(target);

  const inventoryButton = target.closest('[data-inventory-confirm]');
  if (inventoryButton) return confirmInventory(inventoryButton);
  if (target.closest('[data-stock-count-confirm]')) return confirmStockCount(target);

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
    const server = await context.undoPackingScan({ session: packingSession });
    if (!server?.ok) return result(false, server?.message || 'El servidor no confirmó el deshacer.');
    const response = undoLastPackingScan(packingSession);
    feedback = response.message;
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
  return { handled: false };
}

export function handleBusinessOperationsInput(target) {
  if (target?.matches?.('[data-barcode-input]')) {
    scannerDraftValue = String(target.value || '').slice(0, 64);
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
  unsubscribeScanner?.();
  scanner?.stop();
  scanner = null;
  unsubscribeScanner = null;
  scannerDraftValue = '';
  context = defaultContext();
  currentView = 'scanner';
  lastScan = null;
  lookup = null;
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
  productDraft = null;
}

async function processScan(event) {
  scannerDraftValue = '';
  lastScan = event;
  lookup = null;
  if (!event.isValid) {
    feedback = event.reason === 'DUPLICATE_SCAN' ? 'Lectura duplicada ignorada.' : 'Código inválido.';
    context.onChange();
    return;
  }
  busy = true;
  lookup = await context.lookupBarcode(event.normalizedValue);
  busy = false;
  const binding = lookup?.data || null;
  if (!binding) {
    feedback = 'Producto desconocido. Podés crear un borrador para revisión.';
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
      const response = applyPackingScan(packingSession, event);
      feedback = response.message;
      if (response.ok) {
        const server = await context.recordPackingScan({ session: packingSession, event });
        if (!server?.ok) {
          undoLastPackingScan(packingSession);
          feedback = server?.message || 'El servidor rechazó la lectura; no se contabilizó.';
        }
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
  context.onChange();
  return result(Boolean(response?.ok), feedback);
}

async function publishProductDraft(target) {
  if (!productDraft?.id) return result(false, 'No hay un borrador pendiente de revisión.');
  const root = target.closest('[data-business-ops-center]');
  const input = {
    draftId: productDraft.id,
    name: String(root?.querySelector('[name="productName"]')?.value || '').trim(),
    category: String(root?.querySelector('[name="productCategory"]')?.value || '').trim(),
    price: Number(root?.querySelector('[name="productPrice"]')?.value),
    packageType: String(root?.querySelector('[name="packageType"]')?.value || 'unit'),
    unitFactor: positiveInteger(root?.querySelector('[name="unitFactor"]')?.value, 0),
  };
  if (!input.name || !input.category || !Number.isFinite(input.price) || input.price < 0 || !input.unitFactor) {
    return result(false, 'Completá nombre, categoría, precio y factor.');
  }
  const response = await context.publishProductDraft(input);
  feedback = response?.ok
    ? 'Producto creado inactivo y no verificado; falta la verificación de catálogo antes de vender.'
    : response?.message || 'No se pudo publicar el borrador.';
  if (response?.ok) productDraft = null;
  context.onChange();
  return result(Boolean(response?.ok), feedback);
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
    packingSession = createPackingSession({
      orderId,
      orderRevision: Number(order.revision || 1),
      operatorId: context.operatorId || 'operator',
      items: (order.items || []).map((item) => ({
        productId: item.productId,
        name: item.name,
        quantity: item.quantity,
        barcodes: item.barcodes || [],
      })),
    });
    const serverSession = Array.isArray(server.data) ? server.data[0] : server.data;
    packingSession.serverSessionId = serverSession?.id;
    if (!packingSession.serverSessionId) throw new Error('El servidor no devolvió la sesión de preparación.');
    feedback = 'Preparación iniciada. Escaneá cada unidad o pack.';
    context.onChange();
    return result(true, feedback);
  } catch (error) {
    return result(false, error.message);
  }
}

async function confirmPacking(target) {
  if (!packingSession) return result(false, 'No hay preparación activa.');
  const root = target.closest('[data-business-ops-center]');
  const exceptionReason = String(root?.querySelector('[name="packingExceptionReason"]')?.value || '').trim();
  const server = await context.confirmPacking({ session: packingSession, exceptionReason: exceptionReason || null });
  feedback = server?.ok ? 'Preparación confirmada por el servidor.' : server?.message || 'La preparación requiere revisión.';
  context.onChange();
  return result(Boolean(server?.ok), feedback);
}

async function refreshFiscal() {
  const [profile, documents, artifacts] = await Promise.all([context.getFiscalProfile(), context.listFiscalDocuments(), context.listFiscalArtifacts()]);
  fiscalProfile = profile?.ok ? profile.data : null;
  fiscalDocuments = documents?.ok && Array.isArray(documents.data) ? documents.data : [];
  fiscalArtifacts = artifacts?.ok && Array.isArray(artifacts.data) ? artifacts.data : [];
  await refreshFiscalPrinters();
  // The snapshot remains fresh after navigation, but a late fiscal request must
  // never redraw another operational surface and erase an in-progress scan.
  if (currentView === 'fiscal-status' || currentView === 'fiscal-config') context.onChange();
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
  const profile = {
    legal_name: String(root?.querySelector('[name="legalName"]')?.value || '').trim(),
    cuit: String(root?.querySelector('[name="cuit"]')?.value || '').replace(/\D/g, ''),
    tax_condition: String(root?.querySelector('[name="taxCondition"]')?.value || '').trim(),
    business_address: String(root?.querySelector('[name="businessAddress"]')?.value || '').trim(),
    environment: 'homologation',
    point_of_sale: Number(root?.querySelector('[name="pointOfSale"]')?.value || 0),
    default_currency: 'PES',
    default_concept: 1,
    invoice_policy: 'manual',
    default_recipient_condition: String(root?.querySelector('[name="defaultRecipientCondition"]')?.value || '').trim(),
    is_enabled: false,
  };
  if (!/^\d{11}$/.test(profile.cuit) || !profile.legal_name || !profile.tax_condition || !profile.business_address || profile.point_of_sale < 1) {
    return result(false, 'Completá razón social, CUIT, condición, domicilio y punto de venta.');
  }
  const response = await context.configureFiscalProfile(profile);
  feedback = response?.ok ? 'Perfil guardado en homologación; producción continúa bloqueada.' : response?.message || 'No se pudo guardar el perfil.';
  context.onChange();
  return result(Boolean(response?.ok), feedback);
}

async function requestCreditNote(button) {
  const row = button.closest('[data-fiscal-document]');
  const reason = String(row?.querySelector('[name="creditReason"]')?.value || '').trim();
  const creditKind = String(row?.querySelector('[name="creditKind"]')?.value || 'total');
  if (!reason) return result(false, 'La nota de crédito requiere un motivo.');
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
    feedback = printOutcomeMessage(outcome?.status);
    context.onChange();
    return result(true, feedback);
  } catch (error) {
    await context.updateFiscalPrintJob({ printJobId, status: 'failed', errorCode: 'LOCAL_SPOOL_FAILED' });
    return result(false, error?.message || 'La impresora no aceptó el trabajo.');
  }
}

function renderNavigation() {
  return `<nav class="business-ops-nav" aria-label="Herramientas operativas">${BUSINESS_OPERATION_VIEWS.map((view) => `
    <button type="button" class="business-ops-nav-button ${view === currentView ? 'active' : ''}" data-business-ops-view="${view}" aria-pressed="${view === currentView}">${escapeHtml(VIEW_META[view][0])}</button>`).join('')}</nav>`;
}

function renderScanner() { return panel('Escáner rápido', 'Lectura HID tipo teclado, Enter o Tab para confirmar.', `${scannerInput()}${renderScanResult()}`); }
function renderProductCreate() {
  const review = productDraft ? `<div class="business-ops-form" data-product-draft-review><label>Nombre<input name="productName" value="${escapeHtml(productDraft.suggested_name || '')}" maxlength="160"></label><label>Categoría<input name="productCategory" value="${escapeHtml(productDraft.suggested_category || '')}" maxlength="80"></label><label>Precio<input name="productPrice" type="number" min="0" step="0.01"></label><label>Presentación<select name="packageType"><option value="unit">Unidad</option><option value="pack">Pack</option><option value="case">Caja</option></select></label><label>Factor en unidades<input name="unitFactor" type="number" min="1" step="1" value="1"></label><button class="primary-button" type="button" data-publish-product-draft>Confirmar borrador</button></div>` : '';
  return panel('Alta de producto', 'La detección asiste; un owner/admin confirma antes de publicar.', `${scannerInput()}${renderScanResult()}${lastScan?.isValid && !lookup?.data && !productDraft ? '<button class="primary-button" type="button" data-create-product-draft>Crear borrador para revisión</button>' : ''}${review}`);
}
function renderInventory(type) {
  const adjustment = type === 'manual_adjustment';
  return panel(adjustment ? 'Ajuste de stock' : 'Recepción de mercadería', 'Todo cambio crea un movimiento de ledger auditable.', `${scannerInput()}${renderScanResult()}
    <div class="business-ops-form"><label>Cantidad de packs/unidades<input name="packageQuantity" type="number" min="1" step="1" value="1"></label>
    ${adjustment ? '<label>Dirección<select name="direction"><option value="1">Ingreso</option><option value="-1">Egreso</option></select></label><label>Motivo<input name="reason" maxlength="160" required></label>' : '<input name="direction" type="hidden" value="1"><label>Referencia<input name="reason" maxlength="160" placeholder="Factura o remito (opcional)"></label>'}
    <button class="primary-button" type="button" data-inventory-confirm="${type}">Confirmar con servidor</button></div>`);
}
function renderStockCount() { return panel('Conteo físico', 'La diferencia se muestra y requiere confirmación; nunca ajusta en silencio.', `${scannerInput()}${renderScanResult()}<div class="business-ops-form"><label>Stock físico<input name="physicalStock" type="number" min="0" step="1"></label><label>Motivo<input name="reason" value="Conteo físico" maxlength="160"></label><button class="primary-button" type="button" data-stock-count-confirm>Conciliar conteo</button></div>`); }
function renderPacking() {
  const orders = context.getOrders().filter((order) => !['delivered', 'cancelled', 'canceled'].includes(order.status));
  const options = orders.map((order) => `<option value="${escapeHtml(order.backendId || order.id)}">${escapeHtml(order.code || order.id)}</option>`).join('');
  const progress = packingSession ? packingSession.items.map((item) => `<li><strong>${escapeHtml(item.name)}</strong><span>${item.scanned}/${item.required}</span></li>`).join('') : '';
  return panel('Preparación de pedido', 'Detecta producto equivocado, exceso, faltantes y packs.', `<div class="business-ops-form"><label>Pedido<select name="packingOrder">${options || '<option value="">Sin pedidos activos</option>'}</select></label><button class="secondary-button" type="button" data-packing-start>Iniciar</button></div>${scannerInput()}${renderScanResult()}${progress ? `<ul class="business-ops-progress">${progress}</ul><div class="business-ops-form"><label>Motivo de excepción si hay faltantes<input name="packingExceptionReason" maxlength="300"></label><div class="button-row"><button class="ghost-button" type="button" data-packing-undo>Deshacer última lectura</button><button class="primary-button" type="button" data-packing-confirm>Confirmar preparación</button></div></div>` : ''}`);
}
function renderPos() {
  const items = posItems.length ? posItems.map((item) => `<li><span>${item.quantity} × ${escapeHtml(item.name)}</span><button type="button" class="ghost-button compact" data-pos-remove="${escapeHtml(item.productId)}">Quitar</button></li>`).join('') : '<li class="empty-state">Escaneá productos para preparar la venta.</li>';
  return panel('Venta de mostrador', 'El servidor revalora precios y stock; el cliente envía sólo IDs y cantidades.', `${scannerInput()}${renderScanResult()}<ul class="business-ops-cart">${items}</ul><div class="business-ops-form"><label>Medio de pago<select name="paymentMethod"><option value="cash">Efectivo</option><option value="debit_card">Débito</option><option value="credit_card">Crédito</option><option value="transfer">Transferencia</option><option value="qr">QR</option></select></label><label class="business-ops-check"><input name="requestFiscal" type="checkbox"> Solicitar comprobante fiscal</label><div class="button-row"><button class="primary-button" type="button" data-pos-checkout>Confirmar venta</button><button class="ghost-button" type="button" data-pos-clear>Vaciar borrador</button></div></div>`);
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
function normalizedProduct(binding) { const product = Array.isArray(binding.products) ? binding.products[0] : binding.products || {}; return { id: String(binding.product_id || product.id || ''), name: String(product.name || 'Producto'), presentation: String(product.presentation || binding.package_type || ''), stock: Number.isInteger(product.stock) ? product.stock : Number(product.stock || 0) }; }
function panel(title, subtitle, body) { return `<section class="business-ops-panel"><header><div><p class="eyebrow">Centro operativo</p><h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div></header>${body}</section>`; }
function result(ok, message) { return { handled: true, ok, message }; }
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
function defaultContext() {
  return {
    operatorId: '', getOrders: () => [], lookupBarcode: async () => ({ ok: true, data: null }),
    createProductDraft: async () => ({ ok: false, message: 'Repositorio no disponible.' }), publishProductDraft: async () => ({ ok: false, message: 'Repositorio no disponible.' }),
    applyInventoryMovement: async () => ({ ok: false, message: 'Repositorio no disponible.' }), checkoutPos: async () => ({ ok: false, message: 'Repositorio no disponible.' }),
    startPacking: async () => ({ ok: false, message: 'Repositorio no disponible.' }), recordPackingScan: async () => ({ ok: false, message: 'Repositorio no disponible.' }),
    undoPackingScan: async () => ({ ok: false, message: 'Repositorio no disponible.' }), confirmPacking: async () => ({ ok: false, message: 'Repositorio no disponible.' }),
    getFiscalProfile: async () => ({ ok: true, data: null }), listFiscalDocuments: async () => ({ ok: true, data: [] }), listFiscalArtifacts: async () => ({ ok: true, data: [] }),
    configureFiscalProfile: async () => ({ ok: false, message: 'Repositorio no disponible.' }), requestCreditNote: async () => ({ ok: false, message: 'Repositorio no disponible.' }),
    requestFiscalArtifactUrl: async () => ({ ok: false, message: 'Acceso privado no disponible.' }), regenerateFiscalArtifact: async () => ({ ok: false, message: 'Repositorio no disponible.' }),
    requestFiscalPrintJob: async () => ({ ok: false, message: 'Repositorio no disponible.' }), updateFiscalPrintJob: async () => ({ ok: false, message: 'Repositorio no disponible.' }),
    desktopPlatform: { listPrinters: async () => [], queueFiscalPrint: async () => { throw new Error('La impresión fiscal requiere TABA para Windows.'); }, openFiscalCacheFolder: async () => { throw new Error('La caché local requiere TABA para Windows.'); } },
    onChange: () => {},
  };
}
