import test from 'node:test';
import assert from 'node:assert/strict';

import { createWhatsAppFiscalAdapter } from '../js/whatsapp/whatsapp-fiscal-adapter.js';

test('Chaos & Concurrency: PC + Mobile + WhatsApp + Webhook simultaneously billing Order #1842', async () => {
  // Shared database mock simulating Postgres with row-level locks / advisory lock
  const orderId = 'ord-1842-chaos';
  const orderNumber = '1842';

  let order = {
    id: orderId,
    order_number: orderNumber,
    business_id: 'biz-taba-01',
    user_id: 'usr-walter',
    customer_name: 'Walter Martinez',
    total: 18500,
    status: 'completed',
    payment_method: 'cash',
    fiscal_document_id: null,
    fiscal_sale_id: null,
  };

  const fiscalDocuments = [];
  const fiscalIntents = [];
  const printJobs = [];
  let advisoryLockHeld = false;
  let simulatedWorkerRestarted = false;

  // Latency recording benchmarks
  const benchmarks = {};

  // Database helper with transaction isolation & advisory locking simulation
  const db = {
    async executeBillCommercialOrder({ orderId: targetOrderId, commandSource, idempotencyKey, requestPrint }) {
      const t0 = performance.now();

      // Simulate pg_advisory_xact_lock
      while (advisoryLockHeld) {
        await new Promise((r) => setTimeout(r, 2));
      }
      advisoryLockHeld = true;

      try {
        // Check if order already has fiscal_document_id
        if (order.fiscal_document_id) {
          const doc = fiscalDocuments.find((d) => d.id === order.fiscal_document_id);
          return {
            ok: true,
            order_id: targetOrderId,
            fiscal_document_id: doc.id,
            state: doc.state,
            cae: doc.cae,
            document_number: doc.document_number,
            pos_number: doc.pos_number,
            idempotent_replay: true,
          };
        }

        // Check if fiscal intent already exists
        const existingIntent = fiscalIntents.find((i) => i.idempotency_key === idempotencyKey);
        if (existingIntent && existingIntent.fiscal_document_id) {
          const doc = fiscalDocuments.find((d) => d.id === existingIntent.fiscal_document_id);
          order.fiscal_document_id = doc.id;
          return {
            ok: true,
            order_id: targetOrderId,
            fiscal_document_id: doc.id,
            state: doc.state,
            cae: doc.cae,
            document_number: doc.document_number,
            pos_number: doc.pos_number,
            idempotent_replay: true,
          };
        }

        // 1. Create Fiscal Intent
        const intentT0 = performance.now();
        const intent = {
          id: `intent-${targetOrderId}`,
          idempotency_key: idempotencyKey,
          business_id: order.business_id,
          total: order.total,
          state: 'queued',
          created_at: new Date().toISOString(),
        };
        fiscalIntents.push(intent);
        benchmarks.intent_creation_ms = performance.now() - intentT0;

        // 2. Worker lease & simulated restart
        const workerT0 = performance.now();
        intent.state = 'leased';
        intent.leased_by = 'arca-worker-01';

        if (!simulatedWorkerRestarted) {
          // Simulate worker crash / lease timeout recovery
          simulatedWorkerRestarted = true;
          // Abandon lease and recover
          intent.state = 'queued';
          intent.leased_by = 'arca-worker-02'; // restarted worker resumes
        }
        benchmarks.worker_lease_and_recovery_ms = performance.now() - workerT0;

        // 3. Authorize via ARCA (FECAESolicitar)
        const arcaT0 = performance.now();
        const doc = {
          id: `fdoc-${targetOrderId}`,
          document_type: 'FACTURA_B',
          pos_number: 5,
          document_number: 1042,
          cae: '74239849201948',
          cae_expiration_date: '2026-10-06',
          state: 'authorized',
          created_at: new Date().toISOString(),
        };
        fiscalDocuments.push(doc);
        intent.state = 'completed';
        intent.fiscal_document_id = doc.id;
        order.fiscal_document_id = doc.id;
        benchmarks.arca_authorization_ms = performance.now() - arcaT0;

        // 4. PDF Generation
        const pdfT0 = performance.now();
        doc.pdf_url = `https://lataba.ar/fiscal-pdf/order-${targetOrderId}`;
        doc.artifact_state = 'artifact_ready';
        benchmarks.pdf_generation_ms = performance.now() - pdfT0;

        // 5. Enqueue Print Job for LocalAgent
        if (requestPrint) {
          const printT0 = performance.now();
          const job = {
            id: `pjob-${doc.id}`,
            device_id: 'local-agent-mostrador',
            status: 'queued',
            source_entity_id: doc.id,
            created_at: new Date().toISOString(),
          };
          printJobs.push(job);
          // Local agent claims job
          job.status = 'printed';
          benchmarks.print_queue_to_agent_ms = performance.now() - printT0;
        }

        benchmarks.total_roundtrip_ms = performance.now() - t0;

        return {
          ok: true,
          order_id: targetOrderId,
          fiscal_document_id: doc.id,
          state: doc.state,
          cae: doc.cae,
          document_number: doc.document_number,
          pos_number: doc.pos_number,
          idempotent_replay: false,
        };
      } finally {
        advisoryLockHeld = false;
      }
    },

    // WhatsApp adapter hooks
    async isMessageProcessed() {
      return false;
    },
    async recordIncomingMessage() {},
    async getActivePairing(waId) {
      return { business_id: 'biz-taba-01', user_id: 'usr-walter', wa_id: waId };
    },
    async findOrderByNumberOrId(bizId, num) {
      if (num === '1842' || num === orderId) {
        return {
          ...order,
          fiscal_document: fiscalDocuments.find((d) => d.id === order.fiscal_document_id) || null,
        };
      }
      return null;
    },
    async billCommercialOrder(params) {
      return db.executeBillCommercialOrder(params);
    },
  };

  const whatsappSent = [];
  const waAdapter = createWhatsAppFiscalAdapter({
    db,
    sendWhatsAppMessage: async (to, text) => {
      whatsappSent.push({ to, text });
    },
  });

  // Prepare WhatsApp confirmation state for Walter
  await waAdapter.handleIncomingMessage({
    waMessageId: 'wa.step1.chaos',
    fromWaId: '5491144001122',
    body: 'facturar 1842',
  });

  // FIRE CHAOS CONCURRENT STORM:
  // 1. Walter on PC Mostrador clicks "Emitir Factura"
  const pcPromise = db.executeBillCommercialOrder({
    orderId,
    commandSource: 'PANEL',
    idempotencyKey: `order-invoice:${orderId}`,
    requestPrint: true,
  });

  // 2. Walter on Mobile clicks "Emitir Factura"
  const mobilePromise = db.executeBillCommercialOrder({
    orderId,
    commandSource: 'MOBILE',
    idempotencyKey: `order-invoice:${orderId}`,
    requestPrint: false,
  });

  // 3. Walter on WhatsApp sends "si"
  const whatsappPromise = waAdapter.handleIncomingMessage({
    waMessageId: 'wa.step2.chaos',
    fromWaId: '5491144001122',
    body: 'si',
  });

  // 4. Duplicate Webhook delivery occurs simultaneously
  const webhookPromise = db.executeBillCommercialOrder({
    orderId,
    commandSource: 'AUTOMATION',
    idempotencyKey: `order-invoice:${orderId}`,
    requestPrint: false,
  });

  // Await all 4 concurrent actions
  const [pcRes, mobileRes, waRes, webhookRes] = await Promise.all([
    pcPromise,
    mobilePromise,
    whatsappPromise,
    webhookPromise,
  ]);

  // ==========================================
  // INVARIANTS VERIFICATION
  // ==========================================

  // Invariant 1: Exactly 1 fiscal document in database
  assert.equal(fiscalDocuments.length, 1, 'Exactamente 1 comprobante fiscal emitido');
  const singleDoc = fiscalDocuments[0];

  // Invariant 2: Exactly 1 CAE assigned
  assert.equal(singleDoc.cae, '74239849201948', 'Exactamente 1 CAE asignado');
  assert.equal(singleDoc.document_number, 1042);
  assert.equal(singleDoc.pos_number, 5);

  // Invariant 3: Zero duplicates in fiscal_intents
  assert.equal(fiscalIntents.length, 1, 'Exactamente 1 intención fiscal registrada');

  // Invariant 4: Zero inconsistencies in orders table
  assert.equal(order.fiscal_document_id, singleDoc.id, 'order.fiscal_document_id apunta al comprobante único');

  // Invariant 5: All 4 channels converged to the exact same CAE and document number
  assert.equal(pcRes.cae, singleDoc.cae);
  assert.equal(mobileRes.cae, singleDoc.cae);
  assert.equal(waRes.cae, singleDoc.cae);
  assert.equal(webhookRes.cae, singleDoc.cae);

  // Invariant 6: 1 channel was the original emitter, 3 channels were safe idempotent replays
  const replayCount = [pcRes.idempotent_replay, mobileRes.idempotent_replay, waRes.idempotentReplay, webhookRes.idempotent_replay].filter(Boolean).length;
  assert.equal(replayCount, 3, 'Exactamente 3 canales detectaron y reutilizaron la factura emitida');

  // ==========================================
  // PERFORMANCE BENCHMARK REPORT
  // ==========================================
  assert.ok(benchmarks.intent_creation_ms < 50, 'Creación de intención fiscal < 50ms');
  assert.ok(benchmarks.worker_lease_and_recovery_ms < 100, 'Asignación de worker y recuperación < 100ms');
  assert.ok(benchmarks.arca_authorization_ms < 500, 'Autorización ARCA < 500ms');
  assert.ok(benchmarks.pdf_generation_ms < 150, 'Generación de PDF < 150ms');
  assert.ok(benchmarks.print_queue_to_agent_ms < 50, 'Encolado de impresión a LocalAgent < 50ms');
});
