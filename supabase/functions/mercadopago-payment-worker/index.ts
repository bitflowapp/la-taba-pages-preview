import { businessForIntent, oauthMode, oauthConfig, sellerAccessToken } from '../_shared/seller-oauth.ts';
import {
  createServiceClient,
  enforceRateLimit,
  jsonResponse,
  publicErrorResponse,
  requirePost,
  requireWorkerAuthorization,
} from '../_shared/payment-runtime.ts';
import {
  disputeSnapshot,
  fetchChargeback,
  fetchClaim,
  fetchPayment,
  fetchRefund,
  findPaymentsByExternalReference,
  listPaymentRefunds,
  paymentSnapshot,
  searchPaymentsInWindow,
} from '../_shared/mercadopago.ts';
import { correlateProviderRefund, providerResourceId } from '../_shared/refund-correlation.ts';
import { paymentWorkerLimits } from '../_shared/recovery-deployment.ts';

type OutboxJob = {
  id: string;
  business_id?: string;
  topic: 'payment' | 'chargeback' | 'claim' | 'payment_reconcile' | 'refund_reconcile' | 'cancellation_reconcile';
  resource_id: string | null;
  webhook_receipt_id: string | null;
  payment_intent_id: string | null;
  refund_id: string | null;
  cancellation_id: string | null;
  attempts: number;
};

Deno.serve(async (request) => {
  try {
    requirePost(request);
    await requireWorkerAuthorization(request);
    const service = createServiceClient();
    const limits = paymentWorkerLimits(name => Deno.env.get(name));
    if (oauthMode()) {
      const due = await service.from('mp_seller_connections').select('business_id').eq('environment',oauthConfig().environment).eq('status','connected').lt('expires_at',new Date(Date.now()+86400000).toISOString()).limit(limits.refreshLimit);
      for (const row of due.data || []) { try { await sellerAccessToken(row.business_id); } catch (_) { /* Safe refresh failure is persisted for the panel. */ } }
    }
    await enforceRateLimit(service, request, 'worker', 30, 60, 'payment-worker');
    const owner = `edge:v2:${crypto.randomUUID()}`;
    const { data, error } = await service.rpc('claim_payment_outbox_v2', {
      p_owner: owner,
      p_limit: limits.claimLimit,
      p_lease_seconds: 90,
    });
    if (error) throw new Error('Unable to claim payment outbox jobs');

    const jobs = Array.isArray(data) ? data as OutboxJob[] : [];
    let completed = 0;
    let retried = 0;
    for (const job of jobs) {
      const started = await service.rpc('start_payment_outbox_job', {
        p_job_id: job.id,
        p_owner: owner,
      });
      if (started.error || started.data !== true) continue;
      try {
        job.business_id = await jobBusiness(service, job);
        await processJob(service, job);
        const done = await service.rpc('complete_payment_outbox_job', {
          p_job_id: job.id,
          p_owner: owner,
        });
        if (done.error || done.data !== true) throw new Error('Unable to complete payment outbox job');
        completed += 1;
      } catch (error) {
        const retry = await service.rpc('fail_payment_outbox_job', {
          p_job_id: job.id,
          p_owner: owner,
          p_error_code: safeFailureCode(error),
        });
        if (!retry.error) retried += 1;
      }
    }
    // Independent of webhooks and of local intents: read the seller's provider ledger page by page.
    const ledger = await runLedgerSweep(service, owner);
    return jsonResponse(request, { ok: true, claimed: jobs.length, completed, retried, ledger });
  } catch (error) {
    return publicErrorResponse(request, error);
  }
});

async function processJob(service: ReturnType<typeof createServiceClient>, job: OutboxJob): Promise<void> {
  if (job.topic === 'payment' || job.topic === 'payment_reconcile') {
    // Una sonda del barrido de verdad del proveedor llega sin identificador de
    // pago: el comprador se fue a Mercado Pago y nunca volvimos a saber de él.
    // Se resuelve por la referencia externa, que es lo único que tenemos, y se
    // miran TODOS los pagos de esa referencia: un rechazo conocido no puede
    // esconder el reintento aprobado.
    const payments = await paymentsForJob(service, job);
    if (!payments.length) {
      // El proveedor no tiene ningún pago para esa referencia. Una consulta
      // vacía no cierra nada por sí sola: la base decide cuándo la evidencia
      // alcanza (record_provider_probe_empty / enqueue_checkout_provider_probes).
      if (job.payment_intent_id) {
        const marked = await service.rpc('record_provider_probe_empty', {
          p_payment_intent_id: job.payment_intent_id,
        });
        if (marked.error) throw new Error('Unable to record an empty provider probe');
      }
      return;
    }
    const source = job.topic === 'payment' ? 'webhook' : 'reconciliation';
    const finalize = new Set<string>();
    for (const payment of payments) {
      const intent = await findIntent(service, String(payment.external_reference || ''));
      if (await persistPayment(service, intent, payment, job.business_id, source, job.webhook_receipt_id)) {
        finalize.add(intent.checkout_session_id);
      }
    }
    for (const sessionId of finalize) await finalizeSession(service, sessionId);
    return;
  }

  if (job.topic === 'chargeback' || job.topic === 'claim') {
    if (!job.resource_id) throw new Error('Missing dispute resource ID');
    const dispute = job.topic === 'chargeback'
      ? await fetchChargeback(job.resource_id, job.business_id)
      : await fetchClaim(job.resource_id, job.business_id);
    const paymentId = disputePaymentId(dispute);
    if (!paymentId) throw new Error('Dispute has no payment ID');
    const payment = await fetchPayment(paymentId, job.business_id);
    const intent = await findIntent(service, String(payment.external_reference || ''));
    const persistedPayment = await service.rpc('record_mercadopago_payment_snapshot', {
      p_payment_intent_id: intent.payment_intent_id,
      p_snapshot: await paymentSnapshot(payment, job.business_id),
      p_source: 'webhook',
      p_webhook_receipt_id: job.webhook_receipt_id,
    });
    if (persistedPayment.error || !persistedPayment.data) throw new Error('Unable to verify disputed payment');
    const persistedDispute = await service.rpc('record_mercadopago_dispute_snapshot', {
      p_payment_intent_id: intent.payment_intent_id,
      p_dispute_type: job.topic,
      p_snapshot: await disputeSnapshot(dispute, paymentId),
    });
    if (persistedDispute.error || !persistedDispute.data) throw new Error('Unable to persist payment dispute');
    return;
  }

  if (job.topic === 'refund_reconcile') {
    await reconcileRefund(service, job);
    return;
  }
  if (job.topic === 'cancellation_reconcile') {
    await reconcileCancellation(service, job);
    return;
  }
  throw new Error('Unsupported payment outbox topic');
}

async function paymentIdForJob(service: ReturnType<typeof createServiceClient>, job: OutboxJob): Promise<string> {
  if (job.resource_id) return job.resource_id;
  if (!job.payment_intent_id) throw new Error('Missing payment intent reference');
  const { data, error } = await service
    .from('payment_intents')
    .select('provider_payment_id')
    .eq('id', job.payment_intent_id)
    .maybeSingle();
  if (error || !data?.provider_payment_id) throw new Error('Payment is not reconcilable yet');
  return String(data.provider_payment_id);
}

/**
 * Resuelve los pagos del proveedor para un trabajo de la cola.
 *
 * Devuelve una lista vacía sólo cuando Mercado Pago responde que no existe
 * ningún pago para esa referencia externa. Un fallo de red o del proveedor
 * propaga la excepción para que el trabajo reintente: confundir «no hay pago»
 * con «no pude preguntar» daría por abandonado un checkout que sí se cobró.
 *
 * Un trabajo de conciliación mira la referencia completa (todas las páginas) y
 * además los identificadores ya conocidos; uno de webhook, el pago que avisa.
 */
async function paymentsForJob(
  service: ReturnType<typeof createServiceClient>,
  job: OutboxJob,
): Promise<Record<string, unknown>[]> {
  if (job.topic === 'payment' && job.resource_id) return [await fetchPayment(job.resource_id, job.business_id)];
  if (!job.payment_intent_id) {
    if (job.resource_id) return [await fetchPayment(job.resource_id, job.business_id)];
    throw new Error('Missing payment intent reference');
  }
  const { data, error } = await service
    .from('payment_intents')
    .select('provider_payment_id, external_reference')
    .eq('id', job.payment_intent_id)
    .maybeSingle();
  if (error || !data) throw new Error('Payment intent not found');
  const known = new Set<string>();
  if (job.resource_id) known.add(job.resource_id);
  if (data.provider_payment_id) known.add(String(data.provider_payment_id));
  const stored = await service.from('payment_provider_payments').select('provider_payment_id').eq('payment_intent_id', job.payment_intent_id);
  if (stored.error) throw new Error('Payment identity inventory unavailable');
  for (const row of stored.data || []) known.add(String(row.provider_payment_id));
  const externalReference = String(data.external_reference || '').trim();
  if (!externalReference && !known.size) throw new Error('Payment is not reconcilable yet');

  const byId = new Map<string, Record<string, unknown>>();
  if (externalReference) {
    for (const payment of await findPaymentsByExternalReference(externalReference, job.business_id)) {
      byId.set(String(payment.id), payment);
    }
  }
  for (const id of known) {
    if (!byId.has(id)) byId.set(id, await fetchPayment(id, job.business_id));
  }
  return [...byId.values()];
}

// Records one verified provider payment. Returns whether the purchase must be finalized now.
async function persistPayment(
  service: ReturnType<typeof createServiceClient>,
  intent: { payment_intent_id: string; checkout_session_id: string },
  payment: Record<string, unknown>,
  businessId: string | undefined,
  source: string,
  webhookReceiptId: string | null,
): Promise<boolean> {
  const { data, error } = await service.rpc('record_mercadopago_payment_snapshot', {
    p_payment_intent_id: intent.payment_intent_id,
    p_snapshot: await paymentSnapshot(payment, businessId),
    p_source: source,
    p_webhook_receipt_id: webhookReceiptId,
  });
  if (error || !data) throw new Error('Unable to persist verified payment snapshot');
  // The provider fact could not be verified yet (for example its preference): nothing was decided, try again.
  if (data.retryable === true) throw new Error('Payment snapshot not verifiable yet; retry');
  // A persisted review / discrepancy is a handled outcome. Anything else that is not ok is unexpected.
  if (data.ok === false && data.manual_review_required !== true && data.discrepancy !== true) {
    throw new Error('Payment snapshot was refused unexpectedly');
  }
  return data.finalize_required === true;
}

async function finalizeSession(service: ReturnType<typeof createServiceClient>, checkoutSessionId: string): Promise<void> {
  const finalized = await service.rpc('finalize_paid_checkout_session', { p_checkout_session_id: checkoutSessionId });
  if (finalized.error || !finalized.data) throw new Error('Unable to finalize verified payment');
  // Blocked by a financial hold or by missing stock: the database recorded a visible case, there is nothing to retry.
  if (finalized.data.ok !== true && finalized.data.manual_review_required !== true) {
    throw new Error('Unable to finalize verified payment');
  }
}

async function findIntentOrNull(
  service: ReturnType<typeof createServiceClient>,
  externalReference: string,
): Promise<{ payment_intent_id: string; checkout_session_id: string } | null> {
  const { data, error } = await service.rpc('find_payment_intent_by_external_reference', {
    p_environment: Deno.env.get('MERCADOPAGO_ENVIRONMENT')?.trim().toLowerCase(),
    p_external_reference: externalReference,
  });
  if (error) {
    if (String((error as { code?: unknown }).code || '') === 'P0002') return null;
    throw new Error('Unable to look up the checkout of a provider payment');
  }
  if (!data?.payment_intent_id || !data?.checkout_session_id) return null;
  return { payment_intent_id: String(data.payment_intent_id), checkout_session_id: String(data.checkout_session_id) };
}

async function findIntent(
  service: ReturnType<typeof createServiceClient>,
  externalReference: string,
): Promise<{ payment_intent_id: string; checkout_session_id: string }> {
  if (!externalReference) throw new Error('Provider payment has no external reference');
  const { data, error } = await service.rpc('find_payment_intent_by_external_reference', {
    p_environment: Deno.env.get('MERCADOPAGO_ENVIRONMENT')?.trim().toLowerCase(),
    p_external_reference: externalReference,
  });
  if (error || !data?.payment_intent_id || !data?.checkout_session_id) {
    throw new Error('Provider payment does not match a checkout session');
  }
  return {
    payment_intent_id: String(data.payment_intent_id),
    checkout_session_id: String(data.checkout_session_id),
  };
}

async function reconcileRefund(service: ReturnType<typeof createServiceClient>, job: OutboxJob): Promise<void> {
  if (!job.refund_id || !job.payment_intent_id) throw new Error('Missing refund reconciliation reference');
  const { data, error } = await service
    .from('payment_intents')
    .select('provider_payment_id')
    .eq('id', job.payment_intent_id)
    .maybeSingle();
  if (error || !data?.provider_payment_id) throw new Error('Refund payment not found');
  const { data: refund, error: refundError } = await service
    .from('payment_refunds')
    .select('amount,provider_refund_id,requested_at,payment_intent_id,status')
    .eq('id', job.refund_id)
    .maybeSingle();
  if (refundError || !refund) throw new Error('Refund audit row not found');
  if (refund.payment_intent_id !== job.payment_intent_id) throw new Error('Refund payment identity mismatch');
  const providerId = providerResourceId(refund.provider_refund_id);
  if (!job.business_id) throw new Error('Refund seller context required');
  if (!providerId) {
    // The provider executed (or not) a refund whose id never reached us. Guessing it from amount and time is
    // unsafe, and Mercado Pago does not document a replay window for refund idempotency keys. Park it: the refund
    // stays ambiguous (recovery and full-refund orders stay blocked), a critical discrepancy is opened with the
    // provider's own list as read-only evidence, and an owner/admin resolves it with proof.
    let seen: Array<Record<string, unknown>> = [];
    try {
      seen = (await listPaymentRefunds(String(data.provider_payment_id), job.business_id)).slice(0, 20)
        .map((row) => ({ id: String(row.id ?? ''), amount: row.amount ?? null, status: row.status ?? null, date_created: row.date_created ?? null }));
    } catch (_) { /* Evidence is optional; the parking is not. */ }
    const parked = await service.rpc('park_refund_identity_unknown', {
      p_refund_id: job.refund_id,
      p_evidence: { provider_refunds: seen },
    });
    if (parked.error) throw new Error('Unable to park refund with unknown identity');
    return;
  }
  const associated = await service.from('payment_refunds')
    .select('id,provider_refund_id')
    .eq('payment_intent_id', job.payment_intent_id)
    .not('provider_refund_id', 'is', null);
  if (associated.error) throw new Error('Refund identity inventory unavailable');
  const ownedByOthers = new Set((associated.data || [])
    .filter((candidate) => candidate.id !== job.refund_id)
    .map((candidate) => String(candidate.provider_refund_id || '').trim())
    .filter(Boolean));
  if (ownedByOthers.has(providerId)) throw new Error('Refund provider identity already associated');
  const resource = await fetchRefund(String(data.provider_payment_id), providerId, job.business_id);
  const correlation = correlateProviderRefund([resource], {
    amount: Number(refund.amount),
    providerRefundId: refund.provider_refund_id,
    paymentId: String(data.provider_payment_id),
    requestedAt: String(refund.requested_at || ''),
  }, ownedByOthers);
  if (correlation.kind === 'ambiguous') throw new Error('Refund outcome remains ambiguous');
  if (correlation.kind === 'unavailable') throw new Error('Refund outcome still unavailable');
  if (correlation.kind === 'rejected') throw new Error('Refund identity mismatch');
  const outcome = correlation.outcome;
  const recorded = await service.rpc('record_payment_refund_response_v2', {
    p_refund_id: job.refund_id,
    p_provider_refund_id: String(outcome.id || ''),
    p_status: String(outcome.status),
    p_amount: Number(outcome.amount),
    p_response_hash: await cryptoHash(outcome),
  });
  if (recorded.error) throw new Error('Unable to reconcile refund outcome');
}

async function reconcileCancellation(service: ReturnType<typeof createServiceClient>, job: OutboxJob): Promise<void> {
  if (!job.cancellation_id || !job.payment_intent_id) throw new Error('Missing cancellation reconciliation reference');
  const paymentId = await paymentIdForJob(service, job);
  const payment = await fetchPayment(paymentId, job.business_id);
  const intent = await findIntent(service, String(payment.external_reference || ''));
  const snapshot = await paymentSnapshot(payment, job.business_id);
  const persistedPayment = await service.rpc('record_mercadopago_payment_snapshot', {
    p_payment_intent_id: intent.payment_intent_id,
    p_snapshot: snapshot,
    p_source: 'cancellation',
    p_webhook_receipt_id: null,
  });
  if (persistedPayment.error || !persistedPayment.data) throw new Error('Unable to reconcile cancellation payment');
  const rawStatus = String(payment.status || '').toLowerCase();
  if (!['cancelled', 'canceled', 'rejected'].includes(rawStatus)) {
    throw new Error('Cancellation outcome still unavailable');
  }
  const recorded = await service.rpc('record_payment_cancellation_response', {
    p_cancellation_id: job.cancellation_id,
    p_status: rawStatus === 'rejected' ? 'rejected' : 'cancelled',
    p_response_hash: String(snapshot.raw_response_hash),
  });
  if (recorded.error) throw new Error('Unable to reconcile cancellation outcome');
}

const LEDGER_PAGES_PER_RUN = 2;
const LEDGER_TIME_BUDGET_MS = 70_000;

/**
 * Reads the seller's provider ledger window by window. Independent of webhooks
 * and of local intents, so it also finds money that never became a purchase.
 * The cursor only advances after a whole page was handled; any error leaves it
 * where it was and the lease expires (finding F08).
 */
async function runLedgerSweep(
  service: ReturnType<typeof createServiceClient>,
  owner: string,
): Promise<Record<string, unknown> | null> {
  const claimed = await service.rpc('claim_provider_ledger_window', { p_owner: owner });
  if (claimed.error) return { ok: false, code: 'ledger_claim_failed' };
  const window = claimed.data as { business_id: string; environment: string; begin: string; end: string; offset: number } | null;
  if (!window) return null;
  const started = Date.now();
  let offset = Number(window.offset) || 0;
  let pages = 0;
  let seen = 0;
  let orphans = 0;
  try {
    while (pages < LEDGER_PAGES_PER_RUN && Date.now() - started < LEDGER_TIME_BUDGET_MS) {
      const page = await searchPaymentsInWindow(window.business_id, window.begin, window.end, offset);
      const finalize = new Set<string>();
      let pageOrphans = 0;
      for (const summary of page.results) {
        const reference = String(summary.external_reference || '').trim();
        if (!/^taba2:checkout:[0-9a-f-]{36}$/.test(reference)) continue; // another commerce's payment: not ours
        const intent = await findIntentOrNull(service, reference);
        if (!intent) {
          const recorded = await service.rpc('record_orphan_provider_payment', {
            p_business_id: window.business_id,
            p_environment: window.environment,
            p_payment: summary,
          });
          if (recorded.error) throw new Error('Unable to record an orphan provider payment');
          pageOrphans += 1;
          continue;
        }
        const payment = await fetchPayment(String(summary.id), window.business_id);
        if (await persistPayment(service, intent, payment, window.business_id, 'reconciliation', null)) {
          finalize.add(intent.checkout_session_id);
        }
      }
      for (const sessionId of finalize) await finalizeSession(service, sessionId);
      offset += page.results.length;
      seen += page.results.length;
      orphans += pageOrphans;
      pages += 1;
      const done = offset >= page.total || page.results.length === 0;
      const recorded = await service.rpc('record_provider_ledger_page', {
        p_owner: owner,
        p_business_id: window.business_id,
        p_environment: window.environment,
        p_next_offset: offset,
        p_done: done,
        p_payments_seen: page.results.length,
        p_orphans_found: pageOrphans,
        p_error: null,
      });
      if (recorded.error || recorded.data !== true) throw new Error('Unable to advance the provider ledger cursor');
      if (done) return { ok: true, business_id: window.business_id, pages, seen, orphans, complete: true };
    }
    return { ok: true, business_id: window.business_id, pages, seen, orphans, complete: false };
  } catch (error) {
    await service.rpc('record_provider_ledger_page', {
      p_owner: owner,
      p_business_id: window.business_id,
      p_environment: window.environment,
      p_next_offset: offset,
      p_done: false,
      p_payments_seen: 0,
      p_orphans_found: 0,
      p_error: safeFailureCode(error),
    });
    return { ok: false, business_id: window.business_id, code: safeFailureCode(error) };
  }
}

function disputePaymentId(dispute: Record<string, unknown>): string {
  const direct = String(dispute.payment_id || '').trim();
  if (direct) return direct;
  const payment = object(dispute.payment);
  const nested = String(payment.id || payment.payment_id || '').trim();
  if (nested) return nested;
  const payments = Array.isArray(dispute.payments) ? dispute.payments : [];
  return String(object(payments[0]).id || object(payments[0]).payment_id || '').trim();
}

async function cryptoHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeFailureCode(error: unknown): string {
  if (error instanceof Error && /payment|provider|refund|dispute/i.test(error.message)) {
    return error.message.replace(/[^a-z0-9_.-]/gi, '_').slice(0, 120);
  }
  return 'payment_worker_failed';
}

async function jobBusiness(service: ReturnType<typeof createServiceClient>, job: OutboxJob): Promise<string | undefined> {
  if (!oauthMode()) return undefined;
  if (job.payment_intent_id) return await businessForIntent(job.payment_intent_id);
  if (job.webhook_receipt_id) {
    const {data,error}=await service.from('payment_webhook_receipts').select('seller_business_id,environment').eq('id',job.webhook_receipt_id).single();
    if (!error && data?.seller_business_id && data.environment===oauthConfig().environment) return data.seller_business_id;
  }
  throw new Error('Missing seller routing context');
}
