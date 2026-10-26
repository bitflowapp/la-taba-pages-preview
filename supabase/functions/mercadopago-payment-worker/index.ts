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
  MercadoPagoApiError,
  disputeSnapshot,
  fetchChargeback,
  fetchClaim,
  fetchPayment,
  fetchRefund,
  findPaymentsByExternalReference,
  listPaymentRefunds,
  paymentSnapshot,
  searchPaymentsByLastUpdate,
} from '../_shared/mercadopago.ts';
import type { ProviderReadContext } from '../_shared/mercadopago.ts';
import { correlateProviderRefund, providerResourceId } from '../_shared/refund-correlation.ts';
import { paymentWorkerLimits } from '../_shared/recovery-deployment.ts';
import { Deadline, WorkerDeadlineExceeded, workerTimeBudget } from '../_shared/worker-deadline.ts';
import { sweepLedgerWindow } from '../_shared/ledger-sweep.ts';
import type { LedgerCursor, LedgerItemOutcome, LedgerWindow } from '../_shared/ledger-sweep.ts';

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

type Service = ReturnType<typeof createServiceClient>;
// What a job may use while it runs: the time that is left and a heartbeat that keeps its lease alive.
type JobContext = ProviderReadContext & { deadline: Deadline; beat: () => Promise<void> };

// A job lease only has to outlive the gap between two heartbeats (every provider call and every database step beats),
// so a worker that is killed frees its job within a minute, long before the platform's wall clock would matter.
const JOB_LEASE_SECONDS = 60;
const LEDGER_LEASE_SECONDS = 90;
// Time that must remain to START something: a job needs a provider read plus its persistence; the ledger a page.
const JOB_MIN_START_MS = 15_000;
const LEDGER_MIN_START_MS = 15_000;
const TOKEN_REFRESH_RESERVE_MS = 30_000;

class JobLeaseLost extends Error {
  constructor() {
    super('payment job lease lost');
    this.name = 'JobLeaseLost';
  }
}

Deno.serve(async (request) => {
  try {
    requirePost(request);
    await requireWorkerAuthorization(request);
    const service = createServiceClient();
    const limits = paymentWorkerLimits(name => Deno.env.get(name));
    // The platform kills this worker at a hard wall clock; everything below plans for a budget that ends before it.
    const budget = workerTimeBudget(name => Deno.env.get(name));
    const deadline = new Deadline(Date.now(), budget.budgetMs);
    if (oauthMode()) {
      const due = await service.from('mp_seller_connections').select('business_id').eq('environment',oauthConfig().environment).eq('status','connected').lt('expires_at',new Date(Date.now()+86400000).toISOString()).limit(limits.refreshLimit);
      for (const row of due.data || []) {
        if (deadline.expired(TOKEN_REFRESH_RESERVE_MS)) break;
        try { await sellerAccessToken(row.business_id); } catch (_) { /* Safe refresh failure is persisted for the panel. */ }
      }
    }
    await enforceRateLimit(service, request, 'worker', 30, 60, 'payment-worker');
    const owner = `edge:v2:${crypto.randomUUID()}`;

    // Jobs are claimed ONE at a time while there is time to run them, never in a batch whose lease would lapse
    // unstarted. A single job never takes more than its share, so the ledger sweep and the next jobs get their turn.
    const tally = { claimed: 0, completed: 0, retried: 0, released: 0 };
    const drain = (gate: Deadline) => drainJobs(service, owner, gate, budget.jobBudgetMs, limits.claimLimit, tally);
    await drain(deadline.slice(Math.floor(budget.budgetMs * 0.6)));
    // Independent of webhooks and of local intents: read the seller's provider ledger, resumably.
    const ledger = await runLedgerSweep(service, owner, deadline);
    // Nothing was due on the ledger: the rest of the budget goes back to the queue.
    if (ledger === null) await drain(deadline);
    return jsonResponse(request, { ok: true, ...tally, ledger });
  } catch (error) {
    return publicErrorResponse(request, error);
  }
});

type JobOutcome = 'completed' | 'retried' | 'released' | 'lost';

async function drainJobs(
  service: Service,
  owner: string,
  gate: Deadline,
  jobBudgetMs: number,
  claimLimit: number,
  tally: { claimed: number; completed: number; retried: number; released: number },
): Promise<void> {
  while (tally.claimed < claimLimit && !gate.expired(JOB_MIN_START_MS)) {
    const { data, error } = await service.rpc('claim_payment_outbox_v2', {
      p_owner: owner,
      p_limit: 1,
      p_lease_seconds: JOB_LEASE_SECONDS,
    });
    if (error) throw new Error('Unable to claim payment outbox jobs');
    const job = (Array.isArray(data) ? data as OutboxJob[] : [])[0];
    if (!job) return;
    tally.claimed += 1;
    // A job never outlives the gate it was started under, so the ledger keeps the time that was set aside for it.
    const outcome = await runJob(service, job, owner, gate.slice(jobBudgetMs));
    if (outcome === 'completed') tally.completed += 1;
    else if (outcome === 'retried') tally.retried += 1;
    else if (outcome === 'released') tally.released += 1;
  }
}

async function runJob(service: Service, job: OutboxJob, owner: string, deadline: Deadline): Promise<JobOutcome> {
  const started = await service.rpc('start_payment_outbox_job', {
    p_job_id: job.id,
    p_owner: owner,
  });
  // The lease lapsed or the job is no longer ours: nothing was done, the next claim recovers it.
  if (started.error || started.data !== true) return 'lost';
  const context: JobContext = {
    deadline,
    beat: async () => {
      deadline.assertTime(1_500);
      const alive = await service.rpc('extend_payment_outbox_lease', {
        p_job_id: job.id,
        p_owner: owner,
        p_lease_seconds: JOB_LEASE_SECONDS,
      });
      if (alive.error) throw new Error('Unable to extend the payment job lease');
      if (alive.data !== true) throw new JobLeaseLost();
    },
  };
  try {
    job.business_id = await jobBusiness(service, job);
    await processJob(service, job, context);
    const done = await service.rpc('complete_payment_outbox_job', {
      p_job_id: job.id,
      p_owner: owner,
    });
    if (done.error || done.data !== true) throw new Error('Unable to complete payment outbox job');
    return 'completed';
  } catch (error) {
    // Somebody else owns it now: touching it would only fight with the new owner.
    if (error instanceof JobLeaseLost) return 'lost';
    // Out of time is not a failure of the job: hand it back, keep its attempts, and stop taking work.
    if (error instanceof WorkerDeadlineExceeded) {
      await service.rpc('release_payment_outbox_job', {
        p_job_id: job.id,
        p_owner: owner,
        p_delay_seconds: 5,
        p_error_code: 'worker_time_budget',
      });
      return 'released';
    }
    const retry = await service.rpc('fail_payment_outbox_job', {
      p_job_id: job.id,
      p_owner: owner,
      p_error_code: safeFailureCode(error),
    });
    return retry.error ? 'lost' : 'retried';
  }
}

async function processJob(service: Service, job: OutboxJob, context: JobContext): Promise<void> {
  const { deadline } = context;
  if (job.topic === 'payment' || job.topic === 'payment_reconcile') {
    // Una sonda del barrido de verdad del proveedor llega sin identificador de
    // pago: el comprador se fue a Mercado Pago y nunca volvimos a saber de él.
    // Se resuelve por la referencia externa, que es lo único que tenemos, y se
    // miran TODOS los pagos de esa referencia: un rechazo conocido no puede
    // esconder el reintento aprobado.
    const payments = await paymentsForJob(service, job, context);
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
      await context.beat();
      const intent = await intentOfBusiness(service, payment, job.business_id);
      if (!intent) continue; // recorded for this business; the other business's checkout is not touched
      if (await persistPayment(service, intent, payment, job.business_id, source, job.webhook_receipt_id, deadline)) {
        finalize.add(intent.checkout_session_id);
      }
    }
    for (const sessionId of finalize) {
      await context.beat();
      await finalizeSession(service, sessionId);
    }
    // A probe (no payment id) that read the payments and recorded them is evidence: it spaces the next read and, after
    // the grace period, lets a checkout of rejected payments close instead of being read forever. Only AFTER they were
    // persisted: a read whose persistence failed proves nothing.
    if (job.topic === 'payment_reconcile' && !job.resource_id && job.payment_intent_id) {
      const seen = await service.rpc('record_provider_probe_seen', { p_payment_intent_id: job.payment_intent_id });
      if (seen.error) throw new Error('Unable to record a provider probe');
    }
    return;
  }

  if (job.topic === 'chargeback' || job.topic === 'claim') {
    if (!job.resource_id) throw new Error('Missing dispute resource ID');
    await context.beat();
    const dispute = job.topic === 'chargeback'
      ? await fetchChargeback(job.resource_id, job.business_id, deadline)
      : await fetchClaim(job.resource_id, job.business_id, deadline);
    const paymentId = disputePaymentId(dispute);
    if (!paymentId) throw new Error('Dispute has no payment ID');
    await context.beat();
    const payment = await fetchPayment(paymentId, job.business_id, deadline);
    const intent = await intentOfBusiness(service, payment, job.business_id);
    if (!intent) return; // a dispute about a payment that is not this business's checkout
    const persistedPayment = await service.rpc('record_mercadopago_payment_snapshot', {
      p_payment_intent_id: intent.payment_intent_id,
      p_snapshot: await paymentSnapshot(payment, job.business_id, deadline),
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
    await reconcileRefund(service, job, context);
    return;
  }
  if (job.topic === 'cancellation_reconcile') {
    await reconcileCancellation(service, job, context);
    return;
  }
  throw new Error('Unsupported payment outbox topic');
}

async function paymentIdForJob(service: Service, job: OutboxJob): Promise<string> {
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
  service: Service,
  job: OutboxJob,
  context: JobContext,
): Promise<Record<string, unknown>[]> {
  const { deadline } = context;
  if (job.topic === 'payment' && job.resource_id) {
    await context.beat();
    return [await fetchPayment(job.resource_id, job.business_id, deadline)];
  }
  if (!job.payment_intent_id) {
    if (job.resource_id) {
      await context.beat();
      return [await fetchPayment(job.resource_id, job.business_id, deadline)];
    }
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
    for (const payment of await findPaymentsByExternalReference(externalReference, job.business_id, context)) {
      byId.set(String(payment.id), payment);
    }
  }
  for (const id of known) {
    if (byId.has(id)) continue;
    await context.beat();
    byId.set(id, await fetchPayment(id, job.business_id, deadline));
  }
  return [...byId.values()];
}

// Records one verified provider payment. Returns whether the purchase must be finalized now.
async function persistPayment(
  service: Service,
  intent: { payment_intent_id: string; checkout_session_id: string },
  payment: Record<string, unknown>,
  businessId: string | undefined,
  source: string,
  webhookReceiptId: string | null,
  deadline?: Deadline,
): Promise<boolean> {
  const { data, error } = await service.rpc('record_mercadopago_payment_snapshot', {
    p_payment_intent_id: intent.payment_intent_id,
    p_snapshot: await paymentSnapshot(payment, businessId, deadline),
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

async function finalizeSession(service: Service, checkoutSessionId: string): Promise<void> {
  const finalized = await service.rpc('finalize_paid_checkout_session', { p_checkout_session_id: checkoutSessionId });
  if (finalized.error || !finalized.data) throw new Error('Unable to finalize verified payment');
  // Blocked by a financial hold or by missing stock: the database recorded a visible case, there is nothing to retry.
  if (finalized.data.ok !== true && finalized.data.manual_review_required !== true) {
    throw new Error('Unable to finalize verified payment');
  }
}

type IntentRef = { payment_intent_id: string; checkout_session_id: string; business_id: string | null };

async function findIntentOrNull(
  service: Service,
  externalReference: string,
): Promise<IntentRef | null> {
  const { data, error } = await service.rpc('find_payment_intent_by_external_reference', {
    p_environment: Deno.env.get('MERCADOPAGO_ENVIRONMENT')?.trim().toLowerCase(),
    p_external_reference: externalReference,
  });
  if (error) {
    if (String((error as { code?: unknown }).code || '') === 'P0002') return null;
    throw new Error('Unable to look up the checkout of a provider payment');
  }
  if (!data?.payment_intent_id || !data?.checkout_session_id) return null;
  return {
    payment_intent_id: String(data.payment_intent_id),
    checkout_session_id: String(data.checkout_session_id),
    business_id: data.business_id ? String(data.business_id) : null,
  };
}

async function findIntent(
  service: Service,
  externalReference: string,
): Promise<IntentRef> {
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
    business_id: data.business_id ? String(data.business_id) : null,
  };
}

// A payment read with ONE seller's token may only drive a checkout of THAT seller's business. A reference that points at
// another business's checkout (a payment made in some other seller's account that copies a customer's session id) is a
// finding for the business that read it and never a state change of the other one: applying it would mark the victim's
// purchase as a collector mismatch, an absorbing review state. `business_id` missing (a database that predates the lookup
// change) is "cannot tell", handled as before.
function belongsToAnotherBusiness(intent: IntentRef, businessId: string | null | undefined): boolean {
  return Boolean(businessId && intent.business_id && intent.business_id !== businessId);
}

async function recordForeignProviderPayment(service: Service, businessId: string, payment: Record<string, unknown>): Promise<void> {
  const recorded = await service.rpc('record_orphan_provider_payment', {
    p_business_id: businessId,
    p_environment: Deno.env.get('MERCADOPAGO_ENVIRONMENT')?.trim().toLowerCase(),
    p_payment: payment,
  });
  if (recorded.error) throw new Error('Unable to record a provider payment of another checkout');
}

async function intentOfBusiness(
  service: Service,
  payment: Record<string, unknown>,
  businessId: string | null | undefined,
): Promise<IntentRef | null> {
  const intent = await findIntent(service, String(payment.external_reference || ''));
  if (!belongsToAnotherBusiness(intent, businessId)) return intent;
  await recordForeignProviderPayment(service, String(businessId), payment);
  return null;
}

async function reconcileRefund(service: Service, job: OutboxJob, context: JobContext): Promise<void> {
  const { deadline } = context;
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
    let complete = false;
    try {
      await context.beat();
      const listed = await listPaymentRefunds(String(data.provider_payment_id), job.business_id, deadline);
      // A truncated list proves nothing about what is missing from it.
      complete = listed.length <= 20;
      seen = listed.slice(0, 20)
        .map((row) => ({ id: String(row.id ?? ''), amount: row.amount ?? null, status: row.status ?? null, date_created: row.date_created ?? null }));
    } catch (error) {
      // Evidence is optional; the parking is not. Running out of time or losing the lease is not "no evidence".
      if (error instanceof WorkerDeadlineExceeded || error instanceof JobLeaseLost) throw error;
    }
    const parked = await service.rpc('park_refund_identity_unknown', {
      p_refund_id: job.refund_id,
      p_evidence: { provider_refunds: seen },
    });
    if (parked.error) throw new Error('Unable to park refund with unknown identity');
    // The way out of "ambiguous" is provider evidence, decided by the database: a complete list in which every refund
    // is already recorded settles the request as not executed. Too early, or an unreadable list, is retried with the
    // outbox backoff; a refund the provider holds that we do not (adoptable by the owner) stays parked.
    const settled = await service.rpc('settle_ambiguous_refund_from_provider', {
      p_refund_id: job.refund_id,
      p_evidence: { provider_refunds: seen, list_complete: complete },
    });
    if (settled.error) throw new Error('Unable to evaluate provider refund evidence');
    if (settled.data === 'too_recent' || settled.data === 'incomplete_evidence') throw new Error('Refund outcome still unavailable');
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
  await context.beat();
  const resource = await fetchRefund(String(data.provider_payment_id), providerId, job.business_id, deadline);
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

async function reconcileCancellation(service: Service, job: OutboxJob, context: JobContext): Promise<void> {
  const { deadline } = context;
  if (!job.cancellation_id || !job.payment_intent_id) throw new Error('Missing cancellation reconciliation reference');
  const paymentId = await paymentIdForJob(service, job);
  await context.beat();
  const payment = await fetchPayment(paymentId, job.business_id, deadline);
  const intent = await intentOfBusiness(service, payment, job.business_id);
  if (!intent) throw new Error('Cancellation payment belongs to another checkout');
  const snapshot = await paymentSnapshot(payment, job.business_id, deadline);
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

/**
 * Reads the seller's provider ledger window by LAST UPDATE, independent of webhooks and of local intents, so it also
 * finds money that never became a purchase and changes made long after a payment was created. It is resumable at
 * any instant: the cursor is persisted every few items and when time runs out, and a window is only closed after
 * every row up to its end was handled (finding F08 and the second audit).
 */
async function runLedgerSweep(
  service: Service,
  owner: string,
  deadline: Deadline,
): Promise<Record<string, unknown> | null> {
  if (deadline.expired(LEDGER_MIN_START_MS)) return { ok: true, skipped: 'time_budget' };
  const claimed = await service.rpc('claim_provider_ledger_window', { p_owner: owner, p_lease_seconds: LEDGER_LEASE_SECONDS });
  if (claimed.error) return { ok: false, code: 'ledger_claim_failed' };
  const window = claimed.data as LedgerWindow | null;
  if (!window) return null;
  const checkpoint = async (cursor: LedgerCursor, seen: number, orphans: number, done: boolean, release: boolean) => {
    const recorded = await service.rpc('record_provider_ledger_checkpoint', {
      p_owner: owner,
      p_business_id: window.business_id,
      p_environment: window.environment,
      p_cursor_at: cursor.at,
      p_cursor_skip: cursor.skip,
      p_payments_seen: seen,
      p_orphans_found: orphans,
      p_done: done,
      p_error: null,
      p_release: release,
      p_lease_seconds: LEDGER_LEASE_SECONDS,
    });
    if (recorded.error) throw new Error('Unable to checkpoint the provider ledger cursor');
    return recorded.data === true;
  };
  try {
    const run = await sweepLedgerWindow({
      search: (w, cursor, limit) => searchPaymentsByLastUpdate(w.business_id, cursor.at, w.end, cursor.skip, limit, deadline),
      handle: (summary) => ledgerItemOrStepOver(service, owner, window, summary, deadline),
      finalize: (sessionId) => finalizeSession(service, sessionId),
      checkpoint: (c) => checkpoint(c.cursor, c.seen, c.orphans, c.done, c.release),
    }, window, deadline);
    return {
      ok: true, business_id: window.business_id, pages: run.pages, seen: run.seen, orphans: run.orphans,
      complete: run.stopped === 'complete', stopped: run.stopped,
    };
  } catch (error) {
    try {
      await service.rpc('record_provider_ledger_checkpoint', {
        p_owner: owner,
        p_business_id: window.business_id,
        p_environment: window.environment,
        p_cursor_at: null,
        p_cursor_skip: 0,
        p_payments_seen: 0,
        p_orphans_found: 0,
        p_done: false,
        p_error: safeFailureCode(error),
        p_release: true,
        p_lease_seconds: LEDGER_LEASE_SECONDS,
      });
    } catch (_) { /* The lease expires on its own and the window resumes where its last checkpoint left it. */ }
    return { ok: false, business_id: window.business_id, code: safeFailureCode(error) };
  }
}

// How many consecutive runs the SAME payment may fail (for a reason that is not the provider being unavailable) before
// it is recorded as a critical finding for a person and stepped over, so it cannot freeze the window forever.
const LEDGER_ITEM_FAILURE_LIMIT = 5;

function isTransientProviderFailure(error: unknown): boolean {
  if (error instanceof WorkerDeadlineExceeded || error instanceof JobLeaseLost) return true;
  const name = (error as { name?: string } | null)?.name;
  if (name === 'AbortError' || name === 'TimeoutError') return true;
  if (error instanceof MercadoPagoApiError) return error.status >= 500 || [401, 403, 408, 409, 425, 429].includes(error.status);
  return false;
}

async function ledgerItemOrStepOver(
  service: Service,
  owner: string,
  window: LedgerWindow,
  summary: Record<string, unknown>,
  deadline: Deadline,
): Promise<LedgerItemOutcome> {
  try {
    return await ledgerItem(service, window, summary, deadline);
  } catch (error) {
    // An outage, a throttle, an expired token or running out of time says nothing about THIS payment: try again later.
    if (isTransientProviderFailure(error)) throw error;
    const failures = await service.rpc('record_ledger_item_failure', {
      p_owner: owner,
      p_business_id: window.business_id,
      p_environment: window.environment,
      p_provider_payment_id: String(summary.id ?? ''),
    });
    if (failures.error || Number(failures.data) < LEDGER_ITEM_FAILURE_LIMIT) throw error;
    const parked = await service.rpc('record_ledger_item_unprocessable', {
      p_owner: owner,
      p_business_id: window.business_id,
      p_environment: window.environment,
      p_payment: summary,
      p_error_code: safeFailureCode(error),
    });
    if (parked.error) throw error;
    return { orphan: false, finalizeSessionId: null }; // stepped over, on record as a critical finding
  }
}

// One provider payment of the ledger. Idempotent: it is safe to handle the same payment again after a kill.
async function ledgerItem(
  service: Service,
  window: LedgerWindow,
  summary: Record<string, unknown>,
  deadline: Deadline,
): Promise<LedgerItemOutcome> {
  const reference = String(summary.external_reference || '').trim();
  if (!/^taba2:checkout:[0-9a-f-]{36}$/.test(reference)) return { orphan: false, finalizeSessionId: null }; // another commerce's payment: not ours
  const intent = await findIntentOrNull(service, reference);
  if (!intent || belongsToAnotherBusiness(intent, window.business_id)) {
    // No checkout of ours, or a checkout of ANOTHER business of the platform: either way a finding for the business that
    // read it, never a payment applied to somebody else's purchase.
    const recorded = await service.rpc('record_orphan_provider_payment', {
      p_business_id: window.business_id,
      p_environment: window.environment,
      p_payment: summary,
    });
    if (recorded.error) throw new Error('Unable to record an orphan provider payment');
    return { orphan: true, finalizeSessionId: null };
  }
  // The window overlaps on purpose; a payment we already hold in exactly this state is only "seen again".
  const unchanged = await service.rpc('provider_payment_unchanged', {
    p_environment: window.environment,
    p_seller_id: String(summary.collector_id ?? ''),
    p_provider_payment_id: String(summary.id),
    p_status: String(summary.status ?? ''),
    p_updated_at: typeof summary.date_last_updated === 'string' ? summary.date_last_updated : null,
  });
  if (unchanged.error) throw new Error('Unable to compare a provider payment with the stored one');
  if (unchanged.data === true) return { orphan: false, finalizeSessionId: null };
  const payment = await fetchPayment(String(summary.id), window.business_id, deadline);
  const finalize = await persistPayment(service, intent, payment, window.business_id, 'reconciliation', null, deadline);
  return { orphan: false, finalizeSessionId: finalize ? intent.checkout_session_id : null };
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

async function jobBusiness(service: Service, job: OutboxJob): Promise<string | undefined> {
  if (!oauthMode()) return undefined;
  if (job.payment_intent_id) return await businessForIntent(job.payment_intent_id);
  if (job.webhook_receipt_id) {
    const {data,error}=await service.from('payment_webhook_receipts').select('seller_business_id,environment').eq('id',job.webhook_receipt_id).single();
    if (!error && data?.seller_business_id && data.environment===oauthConfig().environment) return data.seller_business_id;
  }
  throw new Error('Missing seller routing context');
}
