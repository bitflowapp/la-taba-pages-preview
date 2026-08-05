// Backend sintético en memoria para la certificación de la jornada.
// No reemplaza a PostgreSQL: reproduce las invariantes que el servidor sí garantiza
// (idempotencia, revisión esperada, un pedido por pago, ledger de stock inmutable)
// para poder certificar el comportamiento del panel contra ellas.
//
// Cuando una invariante no se puede reproducir sin la base, el escenario la declara
// como no cubierta en vez de darla por buena.

import { QA_BUSINESS_ID, QA_ORDER, QA_PRODUCTS } from './qa-fixtures.mjs';

export function createSyntheticBackend({ now = () => new Date('2026-08-05T12:00:00.000Z') } = {}) {
  const state = {
    businessStatus: 'open',
    products: new Map(QA_PRODUCTS.map((product) => [product.id, { ...product, stock: product.stock }])),
    barcodes: new Map(),
    orders: new Map(),
    orderEvents: [],
    payments: new Map(),
    paymentEvents: [],
    inventoryLedger: [],
    idempotency: new Map(),
    packingSessions: new Map(),
    fiscalDocuments: new Map(),
    fiscalOutbox: [],
    printJobs: [],
    alerts: [],
    reconciliations: new Map(),
    drafts: new Map(),
    audit: [],
    locks: new Set(),
    fiscalFixture: null,
    openingOverrides: {},
  };

  for (const product of state.products.values()) {
    for (const barcode of product.barcodes) {
      state.barcodes.set(barcode.gtin, {
        product_id: product.id,
        gtin: barcode.gtin,
        unit_factor: barcode.unitFactor,
        package_type: barcode.packageType,
        is_active: true,
        products: [{ id: product.id, name: product.name, brand: product.brand, presentation: product.variant, stock: product.stock }],
      });
    }
  }

  // Toda mutación pasa por acá: una idempotency key repetida devuelve el mismo resultado.
  function once(key, produce) {
    if (!key) throw new Error('La operación sintética requiere una clave de idempotencia.');
    if (state.idempotency.has(key)) return { ...state.idempotency.get(key), idempotentReplay: true };
    const value = produce();
    state.idempotency.set(key, value);
    return value;
  }

  function moveStock({ productId, delta, reason, idempotencyKey }) {
    return once(`stock:${idempotencyKey}`, () => {
      const product = state.products.get(productId);
      if (!product) throw new Error('Producto sintético inexistente.');
      const next = product.stock + delta;
      if (next < 0) return { ok: false, message: 'No hay stock suficiente para ese movimiento.' };
      product.stock = next;
      state.inventoryLedger.push(Object.freeze({
        productId, delta, reason, at: now().toISOString(), idempotencyKey,
      }));
      const binding = [...state.barcodes.values()].find((entry) => entry.product_id === productId);
      if (binding) binding.products[0].stock = next;
      return { ok: true, stock: next };
    });
  }

  function emitOrderEvent(orderId, type) {
    const fingerprint = `${orderId}:${type}`;
    if (state.orderEvents.some((event) => event.fingerprint === fingerprint)) return false;
    state.orderEvents.push(Object.freeze({ orderId, type, fingerprint, at: now().toISOString() }));
    return true;
  }

  const api = {
    state,

    // ===== Pedidos =====
    createOrder({ code = QA_ORDER.code, items = QA_ORDER.items, paymentIntentId = null, idempotencyKey } = {}) {
      return once(`order:${idempotencyKey}`, () => {
        // Un pago sólo puede producir un pedido, como en finalize_paid_checkout_session.
        if (paymentIntentId) {
          const existing = [...state.orders.values()].find((order) => order.paymentIntentId === paymentIntentId);
          if (existing) return { ok: true, order: existing, alreadyFinalized: true };
        }
        const id = `qa-order-${state.orders.size + 1}`;
        for (const item of items) {
          const moved = moveStock({
            productId: item.productId,
            delta: -item.quantity,
            reason: 'venta sintética',
            idempotencyKey: `${idempotencyKey}:${item.productId}`,
          });
          if (!moved.ok) return { ok: false, message: moved.message };
        }
        const order = {
          id,
          backendId: id,
          code,
          status: 'submitted',
          revision: 1,
          paymentIntentId,
          items: items.map((item) => ({ ...item, name: state.products.get(item.productId)?.name || '' })),
          createdAt: now().toISOString(),
        };
        state.orders.set(id, order);
        emitOrderEvent(id, 'submitted');
        return { ok: true, order };
      });
    },

    advanceOrder({ orderId, next, expectedRevision, idempotencyKey }) {
      return once(`advance:${idempotencyKey}`, () => {
        const order = state.orders.get(orderId);
        if (!order) return { ok: false, message: 'Ese pedido no existe.' };
        if (order.revision !== expectedRevision) return { ok: false, message: 'El pedido cambió mientras lo mirabas.' };
        const allowed = ORDER_FLOW[order.status] || [];
        if (!allowed.includes(next)) return { ok: false, message: `No se puede pasar de ${order.status} a ${next}.` };
        order.status = next;
        order.revision += 1;
        emitOrderEvent(orderId, next);
        return { ok: true, order: { ...order } };
      });
    },

    listOrders() {
      return [...state.orders.values()].map((order) => ({ ...order }));
    },

    // ===== Pagos =====
    seedPayment(fixture) {
      state.payments.set(fixture.id, {
        payment_intent_id: fixture.id,
        internal_status: fixture.internal_status,
        order_public_code: fixture.orderCode || null,
        amount: fixture.amount,
        declared_amount: fixture.declaredAmount ?? fixture.amount,
        currency: 'ARS',
        method: 'QA',
        latest_refund_status: fixture.latest_refund_status || null,
        refunded_amount: 0,
        created_at: now().toISOString(),
        can_reconcile: !['completed', 'refunded'].includes(fixture.internal_status),
        can_refund: fixture.internal_status === 'completed' && Boolean(fixture.orderCode),
        payment_id_short: fixture.id.slice(-6),
      });
    },

    listPayments() {
      return [...state.payments.values()].map((payment) => ({ ...payment }));
    },

    // Reconciliar es idempotente: reintentar no crea otro pedido ni descuenta stock de nuevo.
    reconcilePayment(paymentIntentId) {
      const payment = state.payments.get(paymentIntentId);
      if (!payment) return { ok: false, message: 'Ese pago no existe.' };
      state.paymentEvents.push({ paymentIntentId, type: 'reconcile_requested', at: now().toISOString() });
      if (payment.internal_status !== 'approved_order_pending') return { ok: true, queued: true };
      const created = api.createOrder({
        code: `${QA_ORDER.code}-REC`,
        items: [{ productId: 'qa-product-agua', quantity: 1 }],
        paymentIntentId,
        idempotencyKey: `reconcile:${paymentIntentId}`,
      });
      if (!created.ok) return { ok: false, message: created.message };
      payment.internal_status = 'completed';
      payment.order_public_code = created.order.code;
      payment.can_refund = true;
      return { ok: true, queued: true, order: created.order, idempotentReplay: Boolean(created.idempotentReplay) };
    },

    refundPayment({ paymentIntentId, amount }) {
      const payment = state.payments.get(paymentIntentId);
      if (!payment) return { ok: false, message: 'Ese pago no existe.' };
      const value = amount === null || amount === undefined ? payment.amount : Number(amount);
      if (value > payment.amount) return { ok: false, message: 'No podés devolver más de lo que se cobró.' };
      payment.refunded_amount = value;
      payment.latest_refund_status = 'requested';
      payment.internal_status = value >= payment.amount ? 'refunded' : 'partially_refunded';
      return { ok: true };
    },

    paymentActivation() {
      return {
        settings_present: true, enabled: true, environment: 'test', currency: 'ARS', reserve_stock: true,
        collector_configured: true, application_configured: true,
        collector_id_short: '0001', application_id_short: '0002',
        credentials_loaded: true, signed_notice_at: now().toISOString(), rejected_notices_recent: 0,
        test_payment_at: now().toISOString(), test_payment_order_created: true, test_payment_stock_applied: true,
        storefront_ready: true, production_review_status: 'not_requested',
      };
    },

    // ===== Inventario y catálogo =====
    lookupBarcode(gtin) {
      const binding = state.barcodes.get(gtin);
      return binding ? { ...binding } : null;
    },

    createDraft({ gtin, idempotencyKey }) {
      return once(`draft:${idempotencyKey}`, () => {
        const existing = [...state.drafts.values()].find((draft) => draft.scanned_gtin === gtin && draft.status === 'pending_review');
        if (existing) return { ok: true, draft: existing };
        const draft = {
          id: `qa-draft-${state.drafts.size + 1}`,
          scanned_gtin: gtin,
          status: 'pending_review',
          created_at: now().toISOString(),
          suggested_name: '',
          suggested_brand: '',
          suggested_category: '',
        };
        state.drafts.set(draft.id, draft);
        return { ok: true, draft };
      });
    },

    publishDraft({ draftId, name, category, price, packageType, unitFactor }) {
      const draft = state.drafts.get(draftId);
      if (!draft) return { ok: false, message: 'Ese borrador no existe.' };
      if (draft.status !== 'pending_review') return { ok: false, message: 'Ese borrador ya se revisó.' };
      const productId = `qa-product-${draft.scanned_gtin}`;
      state.products.set(productId, {
        id: productId, name, category, price, priceStatus: 'confirmed', stock: 0,
        brand: '', variant: '', capacityValue: 0, capacityUnit: '', unitsPerPack: unitFactor,
        packageType, barcodes: [{ gtin: draft.scanned_gtin, unitFactor, packageType }],
        imageBound: false, verified: false,
      });
      state.barcodes.set(draft.scanned_gtin, {
        product_id: productId, gtin: draft.scanned_gtin, unit_factor: unitFactor,
        package_type: packageType, is_active: true,
        products: [{ id: productId, name, brand: '', presentation: '', stock: 0 }],
      });
      draft.status = 'approved';
      draft.product_id = productId;
      state.audit.push({ action: 'draft_published', productId, at: now().toISOString() });
      return { ok: true, data: { draft_id: draftId, product_id: productId, published: false, requires_catalog_verification: true } };
    },

    completeProduct({ productId, details }) {
      const product = state.products.get(productId);
      if (!product) return { ok: false, message: 'Ese producto no existe.' };
      Object.assign(product, {
        name: details.name, brand: details.brand, category: details.category,
        variant: details.variant, capacityValue: details.capacity_value, capacityUnit: details.capacity_unit,
        unitsPerPack: details.units_per_pack, price: details.price_pending ? 0 : details.price,
        priceStatus: details.price_pending ? 'pending' : 'confirmed', stock: details.stock,
        unitCost: details.unit_cost ?? null,
      });
      // La publicación QA vincula la imagen; sin ella el producto no llega al catálogo.
      product.imageBound = true;
      product.verified = true;
      product.available = !details.price_pending && details.stock > 0;
      state.audit.push({
        action: details.price_pending ? 'completed' : 'price_confirmed',
        productId, at: now().toISOString(),
      });
      return { ok: true, data: api.productReadiness(productId).data };
    },

    productReadiness(productId) {
      const product = state.products.get(productId);
      if (!product) return { ok: false, message: 'Ese producto no existe.' };
      const detailsComplete = Boolean(product.brand && product.variant && product.capacityValue > 0 && product.unitsPerPack > 0);
      const barcodeBound = [...state.barcodes.values()].some((entry) => entry.product_id === productId && entry.is_active);
      return {
        ok: true,
        data: {
          product_id: productId,
          details_complete: detailsComplete,
          barcode_bound: barcodeBound,
          image_bound: Boolean(product.imageBound),
          price_status: product.priceStatus,
          stock_positive: product.stock > 0,
          published: Boolean(product.verified),
          visible: detailsComplete && barcodeBound && Boolean(product.imageBound) && Boolean(product.verified),
          purchasable: Boolean(product.available) && product.priceStatus === 'confirmed' && product.stock > 0,
        },
      };
    },

    catalogVisibleProducts() {
      return [...state.products.values()]
        .filter((product) => product.verified && product.imageBound)
        .map((product) => ({
          id: product.id, name: product.name, priceStatus: product.priceStatus,
          purchasable: Boolean(product.available) && product.priceStatus === 'confirmed' && product.stock > 0,
        }));
    },

    // ===== Packing =====
    startPacking({ orderId, expectedRevision, idempotencyKey }) {
      return once(`packing:${idempotencyKey}`, () => {
        const order = state.orders.get(orderId);
        if (!order) return { ok: false, message: 'Ese pedido no existe.' };
        if (order.revision !== expectedRevision) return { ok: false, message: 'El pedido cambió mientras lo mirabas.' };
        const session = {
          id: `qa-packing-${state.packingSessions.size + 1}`,
          businessId: QA_BUSINESS_ID,
          orderId,
          orderRevision: order.revision,
          status: 'in_progress',
          updatedAt: now().toISOString(),
          scans: [],
        };
        state.packingSessions.set(session.id, session);
        return { ok: true, data: { id: session.id } };
      });
    },

    packingManifest(sessionId) {
      const session = state.packingSessions.get(sessionId);
      if (!session) return { ok: false, message: 'Esa preparación no existe.' };
      const order = state.orders.get(session.orderId);
      return {
        ok: true,
        data: {
          schemaVersion: 1,
          session: {
            id: session.id, businessId: session.businessId, orderId: session.orderId,
            orderRevision: session.orderRevision, status: session.status, updatedAt: session.updatedAt,
            operatorId: session.operatorId || '',
          },
          items: order.items.map((item) => ({
            productId: item.productId,
            name: item.name,
            quantity: item.quantity,
            barcodes: (state.products.get(item.productId)?.barcodes || []).map((barcode) => ({
              gtin: barcode.gtin, unitFactor: barcode.unitFactor,
            })),
          })),
          scans: session.scans.map((scan) => ({ ...scan })),
        },
      };
    },

    recordPackingScan({ sessionId, gtin, scanKey }) {
      const session = state.packingSessions.get(sessionId);
      if (!session) return { ok: false, message: 'Esa preparación no existe.' };
      if (session.scans.some((scan) => scan.scanKey === scanKey)) return { ok: true, idempotentReplay: true };
      const binding = state.barcodes.get(gtin);
      if (!binding) return { ok: false, message: 'Ese código no está cargado.' };
      // Como record_packing_scan: un producto que no está en el pedido es producto equivocado,
      // aunque el código exista en el catálogo.
      const order = state.orders.get(session.orderId);
      if (!order?.items.some((item) => item.productId === binding.product_id)) {
        return { ok: false, message: 'Ese producto no pertenece a este pedido.' };
      }
      const required = order.items
        .filter((item) => item.productId === binding.product_id)
        .reduce((total, item) => total + item.quantity, 0);
      const already = session.scans
        .filter((scan) => !scan.revertedAt && scan.productId === binding.product_id)
        .reduce((total, scan) => total + (state.barcodes.get(scan.gtin)?.unit_factor || 1), 0);
      if (already + binding.unit_factor > required) {
        return { ok: false, message: 'Ya escaneaste todas las unidades de ese producto.' };
      }
      session.scans.push({
        scanKey, gtin, productId: binding.product_id, createdAt: now().toISOString(), revertedAt: null,
      });
      session.updatedAt = now().toISOString();
      return { ok: true };
    },

    revertPackingScan({ sessionId, scanKey }) {
      const session = state.packingSessions.get(sessionId);
      const scan = session?.scans.find((candidate) => candidate.scanKey === scanKey);
      if (!scan) return { ok: false, message: 'Esa lectura ya no está.' };
      scan.revertedAt = now().toISOString();
      session.updatedAt = now().toISOString();
      return { ok: true };
    },

    confirmPacking({ sessionId, exceptionReason, idempotencyKey }) {
      return once(`packing-confirm:${idempotencyKey}`, () => {
        const session = state.packingSessions.get(sessionId);
        if (!session) return { ok: false, message: 'Esa preparación no existe.' };
        const order = state.orders.get(session.orderId);
        const required = order.items.reduce((total, item) => total + item.quantity, 0);
        const scanned = session.scans.filter((scan) => !scan.revertedAt)
          .reduce((total, scan) => total + (state.barcodes.get(scan.gtin)?.unit_factor || 1), 0);
        if (scanned < required && !exceptionReason) {
          return { ok: false, message: 'Faltan productos por escanear. Explicá la excepción o completá la preparación.' };
        }
        session.status = 'confirmed';
        session.updatedAt = now().toISOString();
        return { ok: true, exception: Boolean(exceptionReason) };
      });
    },

    // ===== Fiscal =====
    useFiscalFixture(fixture) {
      state.fiscalFixture = fixture;
    },

    fiscalActivation() {
      const fixture = state.fiscalFixture || { profile: {} };
      return { ...fixture.profile };
    },

    requestFiscalDocument({ orderId, idempotencyKey }) {
      return once(`fiscal:${idempotencyKey}`, () => {
        const fixture = state.fiscalFixture;
        const id = `qa-fiscal-${state.fiscalDocuments.size + 1}`;
        const base = {
          id, source_id: orderId, document_intent: 'invoice', environment: 'homologation',
          created_at: now().toISOString(), cae: null, state: 'queued', artifact_state: 'artifact_pending',
        };
        if (!fixture || fixture.behaviour === 'authorized') {
          Object.assign(base, { state: 'authorized', cae: '71234567890123', artifact_state: 'artifact_ready' });
        } else if (fixture.behaviour === 'unreachable') {
          Object.assign(base, { state: 'retry_wait', artifact_state: 'artifact_pending' });
          state.fiscalOutbox.push({ documentId: id, state: 'retry_wait', errorCode: fixture.errorCode });
        } else if (fixture.behaviour === 'blocked') {
          Object.assign(base, { state: 'failed', artifact_state: 'artifact_pending' });
          state.fiscalOutbox.push({ documentId: id, state: 'dead_letter', errorCode: fixture.errorCode });
        } else if (fixture.behaviour === 'ambiguous') {
          Object.assign(base, { state: 'ambiguous', artifact_state: 'artifact_pending' });
          state.fiscalOutbox.push({ documentId: id, state: 'retry_wait', errorCode: null });
        } else if (fixture.behaviour === 'queued') {
          state.fiscalOutbox.push({ documentId: id, state: 'pending', errorCode: null });
        } else if (fixture.behaviour === 'artifact_failed') {
          Object.assign(base, { state: 'authorized', cae: '71234567890124', artifact_state: 'artifact_failed' });
        }
        state.fiscalDocuments.set(id, base);
        return { ok: true, document: { ...base } };
      });
    },

    listFiscalDocuments() {
      return [...state.fiscalDocuments.values()].map((document) => ({ ...document }));
    },

    // ===== Impresión =====
    recordPrintJob({ status, errorCode = null }) {
      const job = { id: `qa-print-${state.printJobs.length + 1}`, status, errorCode, at: now().toISOString() };
      state.printJobs.push(job);
      return job;
    },

    // ===== Centro de operación =====
    pushAlert(alert) {
      state.alerts.push({ status: 'open', last_seen_at: now().toISOString(), occurrence_count: 1, ...alert });
    },

    operationCenter() {
      return {
        generated_at: now().toISOString(),
        business_id: QA_BUSINESS_ID,
        metrics: {
          new_orders: [...state.orders.values()].filter((order) => order.status === 'submitted').length,
          delayed_orders: 0,
          pending_payments: [...state.payments.values()].filter((payment) => ['in_process', 'created'].includes(payment.internal_status)).length,
          payments_in_review: [...state.payments.values()].filter((payment) => ['ambiguous', 'security_review_required', 'approved_order_pending'].includes(payment.internal_status)).length,
          orders_without_stock: 0,
          packing_incomplete: [...state.packingSessions.values()].filter((session) => session.status !== 'confirmed').length,
          active_deliveries: [...state.orders.values()].filter((order) => ['assigned', 'on_the_way'].includes(order.status)).length,
          riders_without_signal: 0,
          fiscal_documents_pending: [...state.fiscalDocuments.values()].filter((document) => document.state !== 'authorized' || document.artifact_state !== 'artifact_ready').length,
          failed_prints: state.printJobs.filter((job) => ['failed', 'unknown'].includes(job.status)).length,
          pending_credit_notes: 0,
          blocked_outboxes: state.fiscalOutbox.filter((entry) => entry.state === 'dead_letter').length,
          reconciliations_required: [...state.payments.values()].filter((payment) => ['ambiguous', 'security_review_required', 'approved_order_pending'].includes(payment.internal_status)).length,
        },
        alerts: state.alerts.filter((alert) => alert.status !== 'resolved').map((alert) => ({ ...alert })),
        recent_closures: [...state.reconciliations.values()].map((run) => ({ ...run })),
      };
    },

    acknowledgeAlert(alertId) {
      const alert = state.alerts.find((candidate) => candidate.id === alertId);
      if (!alert) return { ok: false, message: 'Esa alerta ya no está.' };
      alert.status = 'acknowledged';
      return { ok: true };
    },

    resolveAlert({ alertId }) {
      const alert = state.alerts.find((candidate) => candidate.id === alertId);
      if (!alert) return { ok: false, message: 'Esa alerta ya no está.' };
      alert.status = 'resolved';
      return { ok: true };
    },

    // ===== Apertura y cierre =====
    openingStatus() {
      return {
        generated_at: now().toISOString(),
        business_status: state.businessStatus,
        backend: { status: 'ok', detail: 'El sistema del negocio respondió.' },
        payments: { status: 'ok', detail: 'Los cobros por la web están activos.' },
        fiscal: { status: 'ok', detail: 'La facturación está activa.' },
        riders: { status: 'ok', detail: '1 repartidor(es) disponible(s).' },
        queues: { status: 'ok', detail: 'No quedó nada trabado de antes.' },
        ...state.openingOverrides,
      };
    },

    setOpeningOverrides(overrides) {
      state.openingOverrides = overrides || {};
    },

    setBusinessStatus(status) {
      state.businessStatus = status;
      return { ok: true, status };
    },

    prepareReconciliation({ businessDate, declaredCash, differenceNote, idempotencyKey }) {
      return once(`daily:${idempotencyKey}`, () => {
        const expected = state.expectedCash ?? 10_000;
        const run = {
          id: `qa-daily-${businessDate}`,
          business_date: businessDate,
          status: 'open',
          revision: 1,
          declared_cash: declaredCash,
          expected_cash: expected,
          cash_difference: Math.round((declaredCash - expected) * 100) / 100,
          difference_note: differenceNote || '',
          open_alerts: state.alerts.filter((alert) => alert.status !== 'resolved').length,
          critical_alerts: state.alerts.filter((alert) => alert.status !== 'resolved' && alert.severity === 'CRITICAL').length,
          snapshot: api.closureSnapshot(),
        };
        state.reconciliations.set(run.id, run);
        return { ok: true, data: { reconciliation: { ...run } } };
      });
    },

    setExpectedCash(value) {
      state.expectedCash = value;
    },

    closureSnapshot() {
      const approved = [...state.payments.values()].filter((payment) => ['completed', 'refunded', 'partially_refunded'].includes(payment.internal_status));
      return {
        sales: { total: approved.reduce((total, payment) => total + payment.amount, 0), count: approved.length },
        payments: {
          approved_total: approved.reduce((total, payment) => total + payment.amount, 0),
          approved_count: approved.length,
          refunded_total: [...state.payments.values()].reduce((total, payment) => total + payment.refunded_amount, 0),
          refunded_count: [...state.payments.values()].filter((payment) => payment.refunded_amount > 0).length,
        },
        cash: { expected: state.expectedCash ?? 10_000 },
        orders: {
          total: state.orders.size,
          open: [...state.orders.values()].filter((order) => !['delivered', 'canceled'].includes(order.status)).length,
        },
        inventory: {
          movements: state.inventoryLedger.length,
          negative: [...state.products.values()].filter((product) => product.stock < 0).length,
        },
        fiscal: {
          authorized: [...state.fiscalDocuments.values()].filter((document) => document.state === 'authorized').length,
          pending: [...state.fiscalDocuments.values()].filter((document) => document.state !== 'authorized').length,
        },
      };
    },

    closeReconciliation({ reconciliationId, expectedRevision, idempotencyKey }) {
      return once(`daily-close:${idempotencyKey}`, () => {
        const run = state.reconciliations.get(reconciliationId);
        if (!run) return { ok: false, message: 'Ese cierre no existe.' };
        if (run.revision !== expectedRevision) return { ok: false, message: 'El cierre cambió mientras lo mirabas.' };
        if (run.cash_difference !== 0 && String(run.difference_note || '').trim().length < 5) {
          return { ok: false, message: 'La diferencia de caja necesita una explicación.' };
        }
        run.status = 'closed';
        run.closed_at = now().toISOString();
        run.snapshot_sha256 = 'q'.repeat(64);
        return { ok: true, data: { reconciliation: { ...run } } };
      });
    },

    // ===== Limpieza =====
    cleanupReport() {
      return {
        activeQaOrders: [...state.orders.values()].filter((order) => !['delivered', 'canceled'].includes(order.status)).length,
        stockRestored: [...state.products.values()]
          .filter((product) => QA_PRODUCTS.some((seed) => seed.id === product.id))
          .every((product) => product.stock === QA_PRODUCTS.find((seed) => seed.id === product.id).stock),
        openLocks: state.locks.size,
        pendingQaOutbox: state.fiscalOutbox.filter((entry) => entry.state !== 'completed').length,
        archivedQaProducts: [...state.products.values()].filter((product) => product.archived).length,
        qaUsersIntact: true,
        humanOperationsTouched: 0,
      };
    },

    restoreStock() {
      for (const seed of QA_PRODUCTS) {
        const product = state.products.get(seed.id);
        if (product) product.stock = seed.stock;
      }
      for (const binding of state.barcodes.values()) {
        const seed = QA_PRODUCTS.find((candidate) => candidate.id === binding.product_id);
        if (seed) binding.products[0].stock = seed.stock;
      }
    },

    archiveQaProducts() {
      for (const product of state.products.values()) {
        if (!QA_PRODUCTS.some((seed) => seed.id === product.id)) {
          product.archived = true;
          product.available = false;
          product.verified = false;
        }
      }
      for (const entry of state.fiscalOutbox) entry.state = 'completed';
    },

    closeQaOrders() {
      for (const order of state.orders.values()) {
        if (!['delivered', 'canceled'].includes(order.status)) order.status = 'canceled';
      }
    },
  };

  return api;
}

const ORDER_FLOW = Object.freeze({
  submitted: ['accepted', 'canceled'],
  accepted: ['preparing', 'canceled'],
  preparing: ['ready', 'canceled'],
  ready: ['assigned', 'canceled'],
  assigned: ['delivered', 'canceled'],
  delivered: [],
  canceled: [],
});

export { ORDER_FLOW };
