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
  findPaymentByExternalReference,
  paymentSnapshot,
} from '../_shared/mercadopago.ts';

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
    if (oauthMode()) {
      const due = await service.from('mp_seller_connections').select('business_id').eq('environment',oauthConfig().environment).eq('status','connected').lt('expires_at',new Date(Date.now()+86400000).toISOString()).limit(10);
      for (const row of due.data || []) { try { await sellerAccessToken(row.business_id); } catch (_) { /* Safe refresh failure is persisted for the panel. */ } }
    }
    await enforceRateLimit(service, request, 'worker', 30, 60, 'payment-worker');
    const owner = `edge:${crypto.randomUUID()}`;
    const { data, error } = await service.rpc('claim_payment_outbox', {
      p_owner: owner,
      p_limit: 20,
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
    return jsonResponse(request, { ok: true, claimed: jobs.length, completed, retried });
  } catch (error) {
    return publicErrorResponse(request, error);
  }
});

async function processJob(service: ReturnType<typeof createServiceClient>, job: OutboxJob): Promise<void> {
  if (job.topic === 'payment' || job.topic === 'payment_reconcile') {
    // Una sonda del barrido de verdad del proveedor llega sin identificador de
    // pago: el comprador se fue a Mercado Pago y nunca volvimos a saber de él.
    // Se resuelve por la referencia externa, que es lo único que tenemos.
    const payment = await paymentForJob(service, job);
    if (!payment) {
      // El proveedor no tiene ningún pago para esa referencia: el checkout se
      // abandonó de verdad. Se deja constancia para que la sonda termine.
      if (job.payment_intent_id) {
        const marked = await service.rpc('record_provider_probe_empty', {
          p_payment_intent_id: job.payment_intent_id,
        });
        if (marked.error) throw new Error('Unable to record an empty provider probe');
      }
      return;
    }
    const intent = await findIntent(service, String(payment.external_reference || ''));
    const { data, error } = await service.rpc('record_mercadopago_payment_snapshot', {
      p_payment_intent_id: intent.payment_intent_id,
      p_snapshot: await paymentSnapshot(payment, job.business_id),
      p_source: job.topic === 'payment' ? 'webhook' : 'reconciliation',
      p_webhook_receipt_id: job.webhook_receipt_id,
    });
    if (error || !data) throw new Error('Unable to persist verified payment snapshot');
    if (data.finalize_required === true) {
      const finalized = await service.rpc('finalize_paid_checkout_session', {
        p_checkout_session_id: intent.checkout_session_id,
      });
      if (finalized.error || !finalized.data?.ok) throw new Error('Unable to finalize verified payment');
    }
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
 * Resuelve el pago del proveedor para un trabajo de la cola.
 *
 * Devuelve `null` sólo cuando Mercado Pago responde que no existe ningún pago
 * para esa referencia externa —un checkout genuinamente abandonado—. Un fallo
 * de red o del proveedor propaga la excepción para que el trabajo reintente:
 * confundir «no hay pago» con «no pude preguntar» daría por abandonado un
 * checkout que sí se cobró, que es exactamente lo que esto viene a evitar.
 */
async function paymentForJob(
  service: ReturnType<typeof createServiceClient>,
  job: OutboxJob,
): Promise<Record<string, unknown> | null> {
  if (job.resource_id) return await fetchPayment(job.resource_id, job.business_id);
  if (!job.payment_intent_id) throw new Error('Missing payment intent reference');
  const { data, error } = await service
    .from('payment_intents')
    .select('provider_payment_id, external_reference')
    .eq('id', job.payment_intent_id)
    .maybeSingle();
  if (error || !data) throw new Error('Payment intent not found');
  if (data.provider_payment_id) return await fetchPayment(String(data.provider_payment_id), job.business_id);
  const externalReference = String(data.external_reference || '').trim();
  if (!externalReference) throw new Error('Payment is not reconcilable yet');
  return await findPaymentByExternalReference(externalReference, job.business_id);
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
  const payment = await fetchPayment(String(data.provider_payment_id), job.business_id);
  const refunds = Array.isArray(payment.refunds) ? payment.refunds : [];
  const { data: refund, error: refundError } = await service
    .from('payment_refunds')
    .select('amount,provider_refund_id')
    .eq('id', job.refund_id)
    .maybeSingle();
  if (refundError || !refund) throw new Error('Refund audit row not found');
  const match = refunds.find((candidate) => {
    const value = object(candidate);
    return value.id && (!refund.provider_refund_id || String(value.id) === String(refund.provider_refund_id));
  });
  if (!match) throw new Error('Refund outcome still unavailable');
  const outcome = object(match);
  const recorded = await service.rpc('record_payment_refund_response', {
    p_refund_id: job.refund_id,
    p_provider_refund_id: String(outcome.id || ''),
    p_status: String(outcome.status || '').toLowerCase() === 'approved' ? 'approved' : 'ambiguous',
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
