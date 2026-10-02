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
  fetchRefundList,
  findPaymentByExternalReference,
  MercadoPagoApiError,
  paymentSnapshot,
} from '../_shared/mercadopago.ts';
import { correlateProviderRefund, locateRefundWithLostResponse, providerResourceId } from '../_shared/refund-correlation.ts';

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
    // El llamador ya está autenticado por firma y es uno solo (el despachador
    // de la base): alcanza con su cupo, sin el de la dirección.
    await enforceRateLimit(service, request, 'worker', 30, 60, 'payment-worker', 0);
    const owner = `edge:v2:${crypto.randomUUID()}`;
    const startedAt = Date.now();
    let claimed = 0;
    let completed = 0;
    let retried = 0;
    for (let batch = 0; batch < MAX_CLAIM_BATCHES; batch += 1) {
      const { data, error } = await service.rpc('claim_payment_outbox_v2', {
        p_owner: owner,
        p_limit: CLAIM_BATCH_SIZE,
        p_lease_seconds: CLAIM_LEASE_SECONDS,
      });
      if (error) {
        // Si ni la primera tanda se pudo reclamar la corrida falló. Después, lo
        // ya procesado está asentado y se informa: la próxima corrida sigue.
        if (batch === 0) throw new Error('Unable to claim payment outbox jobs');
        break;
      }
      const jobs = Array.isArray(data) ? data as OutboxJob[] : [];
      claimed += jobs.length;
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
      // Una tanda incompleta dice que la cola quedó vacía. Y si el proveedor
      // viene lento no se reclama otra: esos trabajos esperan a la corrida
      // siguiente sin gastar un intento.
      if (jobs.length < CLAIM_BATCH_SIZE || Date.now() - startedAt > CLAIM_MORE_WITHIN_MS) break;
    }
    return jsonResponse(request, { ok: true, claimed, completed, retried });
  } catch (error) {
    return publicErrorResponse(request, error);
  }
});

// CÓMO SE VACÍA LA COLA.
//
// El reclamo suma un intento a TODOS los trabajos que toma, y se procesan de a
// uno con hasta 12 s por llamada al proveedor. Con 20 trabajos bajo un solo
// plazo de 90 s, en una lentitud de Mercado Pago los últimos quedaban sin
// empezar con el plazo vencido: gastaban un intento sin haberse probado y
// volvían a reclamarse sin espera, camino a `dead_letter`. Cinco trabajos con
// 150 s entran en el plazo aun con dos lecturas lentas cada uno. (Contar el
// intento al empezar y no al reclamar es de la base: `claim_payment_outbox_v2` /
// `start_payment_outbox_job`.)
//
// Cinco por corrida, a secas, vaciaba la cola cuatro veces más despacio que
// antes, y la cola es FIFO: las sondas que `enqueue_checkout_provider_probes`
// vuelve a encolar cada minuto para cada cobro con un pago no final podían
// tener esperando a la notificación de un pago real. Por eso una corrida sigue
// reclamando tandas de cinco —cada una con su propio plazo, contado desde SU
// reclamo— mientras el proveedor responde rápido, hasta las mismas veinte de
// antes. En cuanto lo procesado se lleva más de veinte segundos no reclama
// más: con el proveedor lento vuelve a ser una tanda por corrida.
//
// Un trabajo que falla espera como mínimo 30 s (`fail_payment_outbox_job`), más
// que esa ventana: una misma corrida no lo vuelve a reclamar.
const CLAIM_BATCH_SIZE = 5;
const CLAIM_LEASE_SECONDS = 150;
const MAX_CLAIM_BATCHES = 4;
const CLAIM_MORE_WITHIN_MS = 20_000;

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
    await recordVerifiedPayment(
      service, job, payment,
      job.topic === 'payment' ? 'webhook' : 'reconciliation',
      job.webhook_receipt_id,
      'Unable to persist verified payment snapshot',
    );
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
    const { intent } = await recordVerifiedPayment(
      service, job, payment, 'webhook', job.webhook_receipt_id, 'Unable to verify disputed payment',
    );
    const persistedDispute = await service.rpc('record_mercadopago_dispute_snapshot', {
      p_payment_intent_id: intent.payment_intent_id,
      p_dispute_type: job.topic,
      p_snapshot: await disputeSnapshot(dispute, paymentId),
    });
    if (disputeIsNotOnPinnedPayment(persistedDispute.error)) {
      // El cobro guarda UN pago (el que cobró). Una disputa sobre otro pago de la
      // misma referencia —el cobro duplicado, casi siempre— la base la rechaza en
      // cada intento, así que reintentar hasta `dead_letter` no la iba a volver
      // válida: el trabajo termina y queda el aviso para quien opera, que la
      // atiende en Mercado Pago.
      //
      // Pero la base levanta ese mismo rechazo cuando el cobro NO tiene ningún
      // pago guardado (el que quedó en revisión de seguridad nunca lo guarda), y
      // ahí la disputa es sobre el único pago del checkout. Por eso se lee qué
      // pago tiene el cobro: sólo con uno guardado y distinto el trabajo termina.
      // Sin pago guardado, o sin poder leerlo, falla como antes y su `dead_letter`
      // levanta la alerta de la cola de pagos.
      const pinned = await service
        .from('payment_intents')
        .select('provider_payment_id')
        .eq('id', intent.payment_intent_id)
        .maybeSingle();
      const pinnedPaymentId = pinned.error ? '' : String(pinned.data?.provider_payment_id || '').trim();
      if (pinnedPaymentId && pinnedPaymentId !== paymentId) {
        reportWorkerOutcome('payment_dispute_not_on_pinned_payment', job, {
          payment_intent_id: intent.payment_intent_id,
          dispute_type: job.topic,
          provider_dispute_id: String(dispute.id ?? ''),
          provider_payment_id: paymentId,
          operational_review_required: true,
        });
        return;
      }
      throw new Error(pinned.error || pinnedPaymentId
        ? 'Unable to persist payment dispute'
        : 'Dispute is on a payment the intent has not pinned');
    }
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
    .select('provider_payment_id, provider_status, external_reference')
    .eq('id', job.payment_intent_id)
    .maybeSingle();
  if (error || !data) throw new Error('Payment intent not found');
  const storedPaymentId = String(data.provider_payment_id || '').trim();
  // Un pago rechazado o cancelado no es el que hay que volver a leer: en la
  // misma preferencia el comprador pudo pagar con otro medio, y ese pago tiene
  // otro identificador. `enqueue_checkout_provider_probes` ya encola sin
  // `resource_id` en ese caso; ésta es la otra mitad. La búsqueda por
  // referencia prefiere un pago aprobado.
  const storedPaymentIsOver = ['rejected', 'cancelled', 'canceled']
    .includes(String(data.provider_status || '').trim().toLowerCase());
  if (storedPaymentId && !storedPaymentIsOver) return await fetchPayment(storedPaymentId, job.business_id);
  const externalReference = String(data.external_reference || '').trim();
  if (!externalReference) {
    if (storedPaymentId) return await fetchPayment(storedPaymentId, job.business_id);
    throw new Error('Payment is not reconcilable yet');
  }
  const found = await findPaymentByExternalReference(externalReference, job.business_id);
  // La búsqueda no devolvió nada pero hay un pago conocido: «el proveedor no
  // tiene ningún pago» sería falso, y la sonda lo anotaría como abandono.
  if (!found && storedPaymentId) return await fetchPayment(storedPaymentId, job.business_id);
  return found;
}

/**
 * Asienta el snapshot de un pago ya leído del proveedor y, si el asiento lo
 * pide, arma el pedido. Los tres caminos que leen un pago (notificación o
 * sonda, disputa, cancelación) pasan por acá: antes sólo el primero miraba
 * `finalize_required`, y un pago que resultaba aprobado mientras se conciliaba
 * una cancelación esperaba a que otra notificación viniera a finalizarlo.
 */
async function recordVerifiedPayment(
  service: ReturnType<typeof createServiceClient>,
  job: OutboxJob,
  payment: Record<string, unknown>,
  source: 'webhook' | 'reconciliation' | 'cancellation',
  webhookReceiptId: string | null,
  failure: string,
): Promise<{
  intent: { payment_intent_id: string; checkout_session_id: string };
  snapshot: Record<string, unknown>;
}> {
  const intent = await findIntent(service, String(payment.external_reference || ''));
  const snapshot = await paymentSnapshot(payment, job.business_id);
  const { data, error } = await service.rpc('record_mercadopago_payment_snapshot', {
    p_payment_intent_id: intent.payment_intent_id,
    p_snapshot: snapshot,
    p_source: source,
    p_webhook_receipt_id: webhookReceiptId,
  });
  if (error || !data) throw new Error(failure);
  // `secondary_payment`, `duplicate_approved` y `post_completion` no son fallos
  // del trabajo: el asiento ya dejó su evento y volver a mandar el mismo
  // snapshot no cambia nada. Lo que sí hace falta es que se vea: hoy ninguna
  // alerta operativa lee esos eventos.
  const anomaly = data.duplicate_approved === true ? 'payment_duplicate_approved'
    : data.secondary_payment === true ? 'payment_secondary_payment'
    : data.post_completion === true ? 'payment_post_completion_anomaly'
    : '';
  if (anomaly) {
    reportWorkerOutcome(anomaly, job, {
      payment_intent_id: intent.payment_intent_id,
      provider_payment_id: String(snapshot.provider_payment_id || ''),
      refund_review_required: data.refund_review_required === true,
      operational_review_required: data.operational_review_required === true || data.duplicate_approved === true,
      reason: /^[a-z_]{1,60}$/.test(String(data.reason || '')) ? String(data.reason) : undefined,
    });
  }
  if (data.finalize_required === true) {
    const finalized = await service.rpc('finalize_paid_checkout_session', {
      p_checkout_session_id: intent.checkout_session_id,
    });
    if (finalized.error || !finalized.data?.ok) throw new Error('Unable to finalize verified payment');
  }
  return { intent, snapshot };
}

// El rechazo exacto de `record_mercadopago_dispute_snapshot` cuando la disputa
// habla de un pago que no es el guardado en el cobro. Se compara el mensaje
// entero: ningún otro 22023 de esa función (un snapshot mal formado, por
// ejemplo) puede pasar por acá.
function disputeIsNotOnPinnedPayment(error: unknown): boolean {
  const refusal = object(error);
  return refusal.code === '22023' && refusal.message === 'disputa no coincide con el pago';
}

// Una línea de registro por resultado que alguien tiene que mirar. Sólo lleva
// identificadores: ni importes del comprador, ni correos, ni credenciales.
function reportWorkerOutcome(event: string, job: OutboxJob, details: Record<string, unknown>): void {
  console.warn(JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    business_id: job.business_id || null,
    job_id: job.id,
    topic: job.topic,
    ...details,
  }));
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
    .select('amount,provider_refund_id,requested_at,payment_intent_id,status,idempotency_key,resolution_mode,provider_payment_id,last_provider_attempt_at')
    .eq('id', job.refund_id)
    .maybeSingle();
  if (refundError || !refund) throw new Error('Refund audit row not found');
  if (refund.payment_intent_id !== job.payment_intent_id) throw new Error('Refund payment identity mismatch');
  let providerId = providerResourceId(refund.provider_refund_id);
  // Sin identidad guardada no se elige nada de una lista. La única excepción es
  // la búsqueda que pidió una persona con `resolve_stuck_payment_refund`
  // (`provider_lookup`): la base ya comprobó que el proveedor informa devuelto
  // exactamente el importe de ESTA solicitud y nada más sin asentar.
  if (!providerId && refund.resolution_mode !== 'provider_lookup') {
    throw new Error('Refund identity unknown; reconciliation required');
  }
  if (!job.business_id) throw new Error('Refund seller context required');
  const associated = await service.from('payment_refunds')
    .select('id,provider_refund_id')
    .eq('payment_intent_id', job.payment_intent_id)
    .not('provider_refund_id', 'is', null);
  if (associated.error) throw new Error('Refund identity inventory unavailable');
  const ownedByOthers = new Set((associated.data || [])
    .filter((candidate) => candidate.id !== job.refund_id)
    .map((candidate) => String(candidate.provider_refund_id || '').trim())
    .filter(Boolean));
  if (!providerId) {
    // La solicitud recuerda contra qué pago salió. Si el cobro hoy apunta a
    // otro pago no se busca nada: `record_payment_refund_identity` compara
    // contra el del cobro y lo rechazaría, y la devolución de otro pago no es
    // la de esta solicitud.
    const requestPaymentId = providerResourceId(refund.provider_payment_id);
    if (!requestPaymentId || requestPaymentId !== String(data.provider_payment_id)) {
      throw new Error('Refund payment changed; identity lookup refused');
    }
    const located = locateRefundWithLostResponse(
      await fetchRefundList(requestPaymentId, job.business_id),
      {
        amount: Number(refund.amount),
        paymentId: requestPaymentId,
        requestedAt: String(refund.requested_at || ''),
        lastAttemptAt: refund.last_provider_attempt_at ? String(refund.last_provider_attempt_at) : null,
      },
      ownedByOthers,
    );
    if (located.kind === 'none') throw new Error('Refund not found at provider; reconciliation required');
    if (located.kind !== 'matched') throw new Error('Refund identity lookup remains ambiguous');
    providerId = providerResourceId(located.outcome.id);
    const captured = await service.rpc('record_payment_refund_identity', {
      p_refund_id: job.refund_id,
      p_payment_intent_id: job.payment_intent_id,
      p_provider_payment_id: requestPaymentId,
      p_idempotency_key: refund.idempotency_key,
      p_provider_refund_id: providerId,
    });
    if (captured.error || captured.data !== true) throw new Error('Unable to bind refund identity');
    reportWorkerOutcome('payment_refund_identity_recovered', job, {
      payment_intent_id: job.payment_intent_id,
      refund_id: job.refund_id,
      provider_refund_id: providerId,
    });
    // Con la identidad ya guardada sigue el camino de siempre: el resultado se
    // lee del recurso propio de esa devolución, no del renglón de la lista.
  }
  if (ownedByOthers.has(providerId)) throw new Error('Refund provider identity already associated');
  const resource = await fetchRefund(String(data.provider_payment_id), providerId, job.business_id);
  const correlation = correlateProviderRefund([resource], {
    amount: Number(refund.amount),
    providerRefundId: providerId,
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
  const { snapshot } = await recordVerifiedPayment(
    service, job, payment, 'cancellation', null, 'Unable to reconcile cancellation payment',
  );
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
  // El estado HTTP del proveedor es lo que distingue, en un trabajo que terminó
  // en `dead_letter`, un freno (429) de una caída (5xx) o de un recurso que no
  // existe (404). El mensaje de esa excepción es siempre el mismo y no lo decía.
  if (error instanceof MercadoPagoApiError) return `provider_http_${error.status || 0}`;
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
