import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allowedBusinessOperationViews,
  BUSINESS_OPERATION_VIEWS,
  configureBusinessOperations,
  handleBusinessOperationsAction,
  renderBusinessOperations,
  resetBusinessOperationsForTests,
} from '../js/business/business-operations-center.js';
import { containsForbiddenVocabulary } from '../js/business/business-operation-language.js';

const READY_PAYMENTS = Object.freeze({
  settings_present: true, collector_configured: true, application_configured: true,
  collector_id_short: '8877', application_id_short: '2233', credentials_loaded: true,
  environment: 'test', signed_notice_at: '2026-08-04T10:00:00.000Z',
  test_payment_at: '2026-08-04T10:05:00.000Z', test_payment_order_created: true,
  test_payment_stock_applied: true, enabled: true, reserve_stock: true, storefront_ready: true,
});

function target(selector, dataset = {}, root = null) {
  const node = {
    dataset,
    closest(candidate) {
      if (candidate === selector) return node;
      if (candidate === '[data-business-ops-center]' && root) return root;
      if (candidate === '[data-payment-refund-form]' && root) return root;
      return null;
    },
  };
  return node;
}

function fieldRoot(values) {
  return {
    querySelector(selector) {
      const name = selector.match(/name="([^"]+)/)?.[1];
      return name && Object.hasOwn(values, name) ? values[name] : null;
    },
  };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('el panel sólo ofrece las pantallas que el rol puede usar', () => {
  const staff = allowedBusinessOperationViews('staff');
  assert.ok(staff.includes('packing'));
  assert.ok(staff.includes('payments'));
  assert.ok(staff.includes('day-open'));
  for (const restricted of ['payments-setup', 'fiscal-setup', 'fiscal-config', 'day-close']) {
    assert.equal(staff.includes(restricted), false, `staff no debería ver ${restricted}`);
  }
  assert.deepEqual(allowedBusinessOperationViews('owner'), [...BUSINESS_OPERATION_VIEWS]);
  assert.deepEqual(allowedBusinessOperationViews('rider'), []);
});

test('la pantalla de pagos muestra los estados del día y frena la entrega cuando corresponde', async () => {
  configureBusinessOperations({
    role: 'owner',
    listPayments: async () => ({
      ok: true,
      data: [
        { payment_intent_id: 'p-1', internal_status: 'approved_order_pending', amount: 5000, currency: 'ARS', can_reconcile: true },
        { payment_intent_id: 'p-2', internal_status: 'completed', order_public_code: 'LT-9', amount: 3200, currency: 'ARS', can_refund: true },
      ],
    }),
    getPaymentsActivation: async () => ({ ok: true, data: READY_PAYMENTS }),
    onChange() {},
  });
  renderBusinessOperations('payments');
  await settle();
  const markup = renderBusinessOperations('payments');
  assert.match(markup, /Aprobado sin pedido/);
  assert.match(markup, /No entregues hasta resolver este pago/);
  assert.match(markup, /Mercado Pago está listo para cobrar/);
  assert.match(markup, /Devolver el dinero/);
  assert.deepEqual(containsForbiddenVocabulary(markup.replace(/<[^>]+>/g, ' ')), []);
  resetBusinessOperationsForTests();
});

test('el equipo ve los pagos pero no la devolución', async () => {
  configureBusinessOperations({
    role: 'staff',
    listPayments: async () => ({
      ok: true,
      data: [{ payment_intent_id: 'p-2', internal_status: 'completed', order_public_code: 'LT-9', amount: 3200, can_refund: true, can_reconcile: true }],
    }),
    getPaymentsActivation: async () => ({ ok: true, data: READY_PAYMENTS }),
    onChange() {},
  });
  renderBusinessOperations('payments');
  await settle();
  const markup = renderBusinessOperations('payments');
  assert.doesNotMatch(markup, /Devolver el dinero/);
  assert.match(markup, /Actualizar desde Mercado Pago/);

  const denied = await handleBusinessOperationsAction(target('[data-payment-action]', { paymentAction: 'refund', paymentIntent: 'p-2' }));
  assert.equal(denied.ok, false);
  assert.match(denied.message, /dueño o el encargado/);
  resetBusinessOperationsForTests();
});

test('la devolución no se ejecuta sin motivo ni confirmación escrita', async () => {
  const requested = [];
  configureBusinessOperations({
    role: 'owner',
    listPayments: async () => ({ ok: true, data: [{ payment_intent_id: 'p-2', internal_status: 'completed', order_public_code: 'LT-9', amount: 3200, can_refund: true }] }),
    getPaymentsActivation: async () => ({ ok: true, data: READY_PAYMENTS }),
    refundPayment: async (input) => { requested.push(input); return { ok: true }; },
    onChange() {},
  });
  renderBusinessOperations('payments');
  await settle();

  const form = fieldRoot({
    refundAmount: { value: '' },
    refundReason: { value: 'no' },
    refundConfirmation: { value: 'DEVOLVER' },
  });
  const missingReason = await handleBusinessOperationsAction(
    target('[data-payment-refund-confirm]', { paymentRefundConfirm: 'p-2' }, form),
  );
  assert.equal(missingReason.ok, false);
  assert.equal(requested.length, 0);

  const goodForm = fieldRoot({
    refundAmount: { value: '1000' },
    refundReason: { value: 'Faltó un producto en la entrega' },
    refundConfirmation: { value: 'devolver' },
  });
  const done = await handleBusinessOperationsAction(
    target('[data-payment-refund-confirm]', { paymentRefundConfirm: 'p-2' }, goodForm),
  );
  assert.equal(done.ok, true);
  assert.equal(requested.length, 1);
  assert.equal(requested[0].amount, 1000);
  resetBusinessOperationsForTests();
});

test('el asistente de Mercado Pago no acepta datos que no sean de la cuenta', async () => {
  const saved = [];
  configureBusinessOperations({
    role: 'owner',
    getPaymentsActivation: async () => ({ ok: true, data: { ...READY_PAYMENTS, collector_configured: false } }),
    listPayments: async () => ({ ok: true, data: [] }),
    configurePaymentSettings: async (settings) => { saved.push(settings); return { ok: true }; },
    onChange() {},
  });
  renderBusinessOperations('payments-setup');
  await settle();
  const markup = renderBusinessOperations('payments-setup');
  assert.match(markup, /El Access Token nunca se guarda ni se muestra en el panel/);

  const badRoot = fieldRoot({ collectorId: { value: 'APP_USR-123' }, applicationId: { value: '112233' } });
  const rejected = await handleBusinessOperationsAction(target('[data-mercadopago-settings-save]', {}, badRoot));
  assert.equal(rejected.ok, false);
  assert.equal(saved.length, 0);

  const goodRoot = fieldRoot({ collectorId: { value: '998877' }, applicationId: { value: '112233' } });
  const accepted = await handleBusinessOperationsAction(target('[data-mercadopago-settings-save]', {}, goodRoot));
  assert.equal(accepted.ok, true);
  assert.deepEqual(saved[0], { collector_id: '998877', application_id: '112233' });
  resetBusinessOperationsForTests();
});

test('la facturación se habilita sólo con la frase exacta y nunca desde el equipo', async () => {
  const authorizations = [];
  configureBusinessOperations({
    role: 'owner',
    getArcaActivation: async () => ({
      ok: true,
      data: {
        legal_name: 'La Taba SRL', cuit: '30712345678', cuit_valid: true,
        tax_condition: 'Responsable Inscripto', business_address: 'Roca 123',
        accountant_review_status: 'approved', certificate_loaded: true,
        certificate_expires_at: new Date(Date.now() + 86_400_000 * 200).toISOString(),
        delegation_status: 'verified', point_of_sale: 4, environment: 'disabled',
      },
    }),
    authorizeArcaHomologation: async (phrase) => { authorizations.push(phrase); return { ok: true }; },
    onChange() {},
  });
  renderBusinessOperations('fiscal-setup');
  await settle();
  const markup = renderBusinessOperations('fiscal-setup');
  assert.match(markup, /I_AUTHORIZE_ARCA_HOMOLOGATION/);
  assert.match(markup, /La facturación real se mantiene apagada desde el panel/);
  assert.match(markup, /30-71234567-8/);

  const wrong = await handleBusinessOperationsAction(
    target('[data-arca-authorize]', {}, fieldRoot({ arcaAuthorization: { value: 'dale' } })),
  );
  assert.equal(wrong.ok, false);
  assert.equal(authorizations.length, 0);

  const right = await handleBusinessOperationsAction(
    target('[data-arca-authorize]', {}, fieldRoot({ arcaAuthorization: { value: 'I_AUTHORIZE_ARCA_HOMOLOGATION' } })),
  );
  assert.equal(right.ok, true);
  assert.deepEqual(authorizations, ['I_AUTHORIZE_ARCA_HOMOLOGATION']);
  resetBusinessOperationsForTests();
});

test('probar la impresora informa sin papel y jamás promete que salió el papel', async () => {
  const probes = [];
  configureBusinessOperations({
    role: 'owner',
    desktopPlatform: {
      isNative: true,
      listPrinters: async () => [{ name: 'EPSON TM-T20', isDefault: true }],
      probePrinter: async (name) => { probes.push(name); return { reachable: true, outOfPaper: true }; },
      print: async () => ({ status: 'sent_to_spooler' }),
    },
    onChange() {},
  });
  renderBusinessOperations('devices');
  await settle();

  const root = fieldRoot({ deviceTestPrinter: { value: 'EPSON TM-T20' }, deviceTestFormat: { value: 'thermal' } });
  const noPaper = await handleBusinessOperationsAction(target('[data-device-test]', { deviceTest: 'thermal' }, root));
  assert.equal(noPaper.ok, false);
  assert.deepEqual(probes, ['EPSON TM-T20']);
  assert.match(renderBusinessOperations('devices'), /Sin papel/);
  resetBusinessOperationsForTests();
});

test('un trabajo aceptado por Windows se muestra como enviado, no como impreso', async () => {
  configureBusinessOperations({
    role: 'owner',
    desktopPlatform: {
      isNative: true,
      listPrinters: async () => [{ name: 'EPSON TM-T20', isDefault: true }],
      probePrinter: async () => ({ reachable: true, outOfPaper: false, error: false, queuedJobs: 0 }),
      print: async () => ({ status: 'sent_to_spooler' }),
    },
    onChange() {},
  });
  renderBusinessOperations('devices');
  await settle();
  const root = fieldRoot({ deviceTestPrinter: { value: 'EPSON TM-T20' }, deviceTestFormat: { value: 'thermal' } });
  await handleBusinessOperationsAction(target('[data-device-test]', { deviceTest: 'thermal' }, root));
  const markup = renderBusinessOperations('devices');
  assert.match(markup, /Trabajo enviado/);
  assert.match(markup, /Un trabajo aceptado por Windows no quiere decir que haya salido el papel/);

  await handleBusinessOperationsAction(target('[data-device-confirm]', { deviceConfirm: 'thermal' }));
  assert.match(renderBusinessOperations('devices'), /Confirmaste que salió el papel/);
  resetBusinessOperationsForTests();
});

test('abrir el negocio da uno de los tres veredictos y no asume lo que no verificó', async () => {
  configureBusinessOperations({
    role: 'owner',
    getOpeningStatus: async () => ({
      ok: true,
      data: {
        business_status: 'paused',
        backend: { status: 'ok', detail: 'El sistema del negocio respondió.' },
        payments: { status: 'ok', detail: 'Los cobros por la web están activos.' },
        fiscal: { status: 'degraded', detail: 'La facturación está apagada.' },
        riders: { status: 'ok', detail: '2 repartidor(es) disponible(s).' },
        queues: { status: 'ok', detail: 'No quedó nada trabado de antes.' },
      },
    }),
    getOperationCenter: async () => ({ ok: true, data: { metrics: {}, alerts: [] } }),
    onChange() {},
  });
  renderBusinessOperations('day-open');
  await settle();
  const markup = renderBusinessOperations('day-open');
  assert.match(markup, /Podés vender, facturación pendiente/);
  // Lector e impresoras todavía no se probaron desde esta computadora.
  assert.match(markup, /Sin verificar/);
  assert.match(markup, /El negocio está con pedidos pausados/);
  assert.deepEqual(containsForbiddenVocabulary(markup.replace(/<[^>]+>/g, ' ')), []);
  resetBusinessOperationsForTests();
});

test('el cierre con problemas críticos exige explicación y confirmación escrita', async () => {
  let closed = null;
  configureBusinessOperations({
    role: 'owner',
    getOperationCenter: async () => ({
      ok: true,
      data: {
        metrics: {},
        alerts: [{ id: 'a-1', severity: 'CRITICAL', status: 'open', code: 'PAYMENT_APPROVED_WITHOUT_ORDER' }],
      },
    }),
    prepareDailyReconciliation: async () => ({
      ok: true,
      data: { reconciliation: { id: 'r-1', revision: 1, status: 'open', cash_difference: 0, declared_cash: 1000, snapshot: {} } },
    }),
    closeDailyReconciliation: async (input) => { closed = input; return { ok: true, data: {} }; },
    onChange() {},
  });
  renderBusinessOperations('operation-center');
  await settle();

  const prepareRoot = fieldRoot({
    dailyBusinessDate: { value: '2026-08-04' },
    dailyTimezone: { value: 'America/Argentina/Buenos_Aires' },
    dailyDeclaredCash: { value: '1000' },
    dailyDifferenceNote: { value: '' },
  });
  await handleBusinessOperationsAction(target('[data-daily-reconciliation-prepare]', {}, prepareRoot));

  const markup = renderBusinessOperations('day-close');
  assert.match(markup, /Hay 1 problema sin resolver/);
  assert.match(markup, /CERRAR IGUAL/);

  const blocked = await handleBusinessOperationsAction(target(
    '[data-daily-reconciliation-close]',
    { dailyReconciliationClose: 'r-1', dailyReconciliationRevision: '1' },
    fieldRoot({ closureOverrideNote: { value: 'corto' }, closureOverrideConfirmation: { value: '' } }),
  ));
  assert.equal(blocked.ok, false);
  assert.equal(closed, null);

  const allowed = await handleBusinessOperationsAction(target(
    '[data-daily-reconciliation-close]',
    { dailyReconciliationClose: 'r-1', dailyReconciliationRevision: '1' },
    fieldRoot({
      closureOverrideNote: { value: 'Se reconcilia mañana con el contador.' },
      closureOverrideConfirmation: { value: 'CERRAR IGUAL' },
    }),
  ));
  assert.equal(allowed.ok, true);
  assert.equal(closed.reconciliationId, 'r-1');
  resetBusinessOperationsForTests();
});

test('un código desconocido abre un borrador y no publica nada solo', async () => {
  const created = [];
  configureBusinessOperations({
    role: 'owner',
    operatorName: 'walter',
    lookupBarcode: async () => ({ ok: true, data: null }),
    createProductDraft: async (input) => {
      created.push(input);
      return { ok: true, data: { id: 'd-1', scanned_gtin: input.gtin, created_at: '2026-08-04T10:00:00.000Z' } };
    },
    onChange() {},
  });
  renderBusinessOperations('product-create');
  await settle();

  const scanRoot = { querySelector: () => ({ value: '7790895000997' }) };
  await handleBusinessOperationsAction(target('[data-business-scan-test]', {}, scanRoot));
  await settle();
  assert.match(renderBusinessOperations('product-create'), /Código nuevo/);

  const drafted = await handleBusinessOperationsAction(target('[data-create-product-draft]'));
  assert.equal(drafted.ok, true);
  assert.equal(created[0].gtin, '7790895000997');
  const markup = renderBusinessOperations('product-create');
  assert.match(markup, /Falta completar/);
  assert.match(markup, /7790895000997/);
  assert.match(markup, /por walter/);
  resetBusinessOperationsForTests();
});

test('publicar un producto exige los datos completos y avisa qué falta para que se vea', async () => {
  configureBusinessOperations({
    role: 'owner',
    lookupBarcode: async () => ({ ok: true, data: null }),
    createProductDraft: async () => ({ ok: true, data: { id: 'd-1', scanned_gtin: '7790895000997', created_at: '2026-08-04T10:00:00.000Z' } }),
    publishProductDraft: async () => ({ ok: true, data: { product_id: 'prod-1' } }),
    completeScannedProduct: async () => ({
      ok: true,
      data: {
        product_id: 'prod-1', details_complete: true, barcode_bound: true, image_bound: false,
        price_status: 'confirmed', stock_positive: true, published: false, visible: false, purchasable: false,
      },
    }),
    onChange() {},
  });
  renderBusinessOperations('product-create');
  await settle();
  const scanRoot = { querySelector: () => ({ value: '7790895000997' }) };
  await handleBusinessOperationsAction(target('[data-business-scan-test]', {}, scanRoot));
  await settle();
  await handleBusinessOperationsAction(target('[data-create-product-draft]'));

  const incomplete = fieldRoot({
    productName: { value: 'Gaseosa cola' },
    productBrand: { value: '' },
    productCategory: { value: 'Gaseosas' },
    productVariant: { value: 'Botella 1,5 L' },
    productCapacityValue: { value: '1.5' },
    productCapacityUnit: { value: 'l' },
    productPackageType: { value: 'unit' },
    productUnitsPerPack: { value: '1' },
    productStock: { value: '24' },
    productPrice: { value: '2500' },
    productCost: { value: '' },
    productPricePending: { checked: false },
  });
  const rejected = await handleBusinessOperationsAction(target('[data-product-complete]', {}, incomplete));
  assert.equal(rejected.ok, false);
  assert.match(renderBusinessOperations('product-create'), /Escribí la marca/);

  const complete = fieldRoot({
    productName: { value: 'Gaseosa cola' },
    productBrand: { value: 'Marca Norte' },
    productCategory: { value: 'Gaseosas' },
    productVariant: { value: 'Botella 1,5 L' },
    productCapacityValue: { value: '1.5' },
    productCapacityUnit: { value: 'l' },
    productPackageType: { value: 'unit' },
    productUnitsPerPack: { value: '1' },
    productStock: { value: '24' },
    productPrice: { value: '2500' },
    productCost: { value: '' },
    productPricePending: { checked: false },
  });
  const accepted = await handleBusinessOperationsAction(target('[data-product-complete]', {}, complete));
  assert.equal(accepted.ok, true);
  const markup = renderBusinessOperations('product-create');
  assert.match(markup, /Todavía no aparece en la web/);
  assert.match(markup, /Cargar la foto del producto/);
  resetBusinessOperationsForTests();
});

test('un precio pendiente deja el producto visible pero no comprable', async () => {
  configureBusinessOperations({
    role: 'owner',
    lookupBarcode: async () => ({ ok: true, data: null }),
    createProductDraft: async () => ({ ok: true, data: { id: 'd-1', scanned_gtin: '7790895000997', created_at: '2026-08-04T10:00:00.000Z' } }),
    publishProductDraft: async () => ({ ok: true, data: { product_id: 'prod-1' } }),
    completeScannedProduct: async () => ({
      ok: true,
      data: {
        product_id: 'prod-1', details_complete: true, barcode_bound: true, image_bound: true,
        price_status: 'pending', stock_positive: true, published: true, visible: true, purchasable: false,
      },
    }),
    onChange() {},
  });
  renderBusinessOperations('product-create');
  await settle();
  const scanRoot = { querySelector: () => ({ value: '7790895000997' }) };
  await handleBusinessOperationsAction(target('[data-business-scan-test]', {}, scanRoot));
  await settle();
  await handleBusinessOperationsAction(target('[data-create-product-draft]'));

  const pending = fieldRoot({
    productName: { value: 'Vino tinto' },
    productBrand: { value: 'Bodega Sur' },
    productCategory: { value: 'Vinos' },
    productVariant: { value: 'Botella 750 ml' },
    productCapacityValue: { value: '750' },
    productCapacityUnit: { value: 'ml' },
    productPackageType: { value: 'unit' },
    productUnitsPerPack: { value: '1' },
    productStock: { value: '6' },
    productPrice: { value: '' },
    productCost: { value: '' },
    productPricePending: { checked: true },
  });
  const done = await handleBusinessOperationsAction(target('[data-product-complete]', {}, pending));
  assert.equal(done.ok, true);
  const markup = renderBusinessOperations('product-create');
  assert.match(markup, /Se ve en la web, pero todavía no se puede comprar/);
  assert.match(markup, /Confirmar el precio para que se pueda comprar/);
  resetBusinessOperationsForTests();
});

test('ninguna pantalla del panel filtra el vocabulario interno', async () => {
  configureBusinessOperations({
    role: 'owner',
    getOperationCenter: async () => ({ ok: true, data: { metrics: {}, alerts: [] } }),
    getPaymentsActivation: async () => ({ ok: true, data: {} }),
    listPayments: async () => ({ ok: true, data: [] }),
    getArcaActivation: async () => ({ ok: true, data: {} }),
    getOpeningStatus: async () => ({ ok: true, data: {} }),
    onChange() {},
  });
  for (const view of BUSINESS_OPERATION_VIEWS.filter((candidate) => candidate !== 'orders')) {
    renderBusinessOperations(view);
    await settle();
    const text = renderBusinessOperations(view).replace(/<[^>]+>/g, ' ');
    assert.deepEqual(containsForbiddenVocabulary(text), [], `la pantalla ${view} filtró jerga`);
  }
  resetBusinessOperationsForTests();
});
