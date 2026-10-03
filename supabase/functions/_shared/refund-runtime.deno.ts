import { assertEquals } from 'jsr:@std/assert@1.0.19';
import { protect } from './seller-oauth.ts';
import { signPaymentWorkerRequest } from './payment-worker-signature.ts';
import { isFinalProviderRejection } from './mercadopago.ts';

const handlers: Array<(request: Request) => Promise<Response>> = [];
const serve = Deno.serve;
Deno.serve = ((fn: typeof handlers[number]) => { handlers.push(fn); return {}; }) as typeof Deno.serve;
try {
  await import('../mercadopago-payment-worker/index.ts'); await import('../mercadopago-refund/index.ts');
  await import('../mercadopago-webhook/index.ts');
} finally { Deno.serve = serve; }
const [worker, refundHandler, webhookHandler] = handlers;
const bid = '96000000-0000-4000-8000-000000000001';
const iid = '96000000-0000-4000-8000-000000000002';
const rid = '96000000-0000-4000-8000-000000000003';
const key = '96000000-0000-4000-8000-000000000004';
const base = 'https://ukxqbgswjlibmnjemrzd.supabase.co/functions/v1/';

async function run(scenario: string, creation = false) {
  for (const [name, value] of Object.entries({
    SUPABASE_URL: 'https://ukxqbgswjlibmnjemrzd.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
    SUPABASE_ANON_KEY: 'fixture-anon', MERCADOPAGO_ENVIRONMENT: 'test', MERCADOPAGO_OAUTH_ENVIRONMENT: 'test',
    MERCADOPAGO_CREDENTIAL_MODE: 'oauth', TABA_DEPLOYMENT_ENV: 'staging',
    MERCADOPAGO_OAUTH_PROJECT_REF: 'ukxqbgswjlibmnjemrzd', MERCADOPAGO_CLIENT_ID: '2691240967769590',
    MERCADOPAGO_OAUTH_PANEL_URL: 'https://taba2-staging.pages.dev/', TABA_CHECKOUT_BASE_URL: 'https://taba2-staging.pages.dev',
    TABA_ALLOWED_ORIGINS: 'https://taba2-staging.pages.dev', PAYMENT_WORKER_SECRET: 'fixture-worker-secret',
    PAYMENT_LOG_HASH_SALT: 'fixture-log-salt',
    MERCADOPAGO_TOKEN_ENCRYPTION_KEY: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
  })) Deno.env.set(name, value);
  const requestedAt = new Date(Date.now() - 1000).toISOString();
  const local = { id: rid, payment_intent_id: iid, idempotency_key: key, amount: 100,
    requested_at: requestedAt, provider_refund_id: creation || scenario.startsWith('unknown') ? null as string | null : '10001', status: 'ambiguous' };
  const resource: Record<string, unknown> = { id: 10001, payment_id: 90001, amount: 100,
    status: 'approved', date_created: new Date().toISOString() };
  if (scenario === 'known-wrong-payment') resource.payment_id = 90002;
  if (scenario === 'known-wrong-amount') resource.amount = 200;
  if (scenario === 'unknown-missing-time' || scenario === 'partial-response') delete resource.date_created;
  if (scenario === 'unknown-prior') resource.date_created = new Date(Date.now() - 60000).toISOString();
  if (scenario === 'unknown-future') resource.date_created = '2099-01-01T00:00:00Z';
  const seller = { business_id: bid, environment: 'test', status: 'connected',
    protected_tokens: await protect({ access_token: 'fixture-seller-token' }, bid),
    expires_at: new Date(Date.now() + 172800000).toISOString(), refresh_owner: null };
  const requests: string[] = [], events: string[] = [], recordings: Record<string, unknown>[] = [];
  let posted = 0, settledEvents = 0, failedJobs = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input)), init = options as RequestInit | undefined;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.pathname === '/auth/v1/user') return Response.json({ id: bid });
    if (url.pathname.endsWith('/consume_payment_rate_limit')) return Response.json({ allowed: true });
    if (url.pathname.endsWith('/mp_seller_connections')) return Response.json(url.searchParams.get('select') === 'business_id' ? [] : seller);
    if (url.pathname.endsWith('/payment_intents')) return Response.json({ id: iid, business_id: bid, environment: 'test', provider_payment_id: '90001' });
    if (url.pathname.endsWith('/payment_refunds')) {
      if (url.searchParams.has('payment_intent_id')) return Response.json(scenario === 'known-owned' ? [{ id: 'other-local-refund', provider_refund_id: '10001' }] : []);
      return Response.json(local);
    }
    if (url.pathname.endsWith('/prepare_payment_refund_v2')) return Response.json({ refund_id: rid, idempotency_key: key,
      provider_payment_id: '90001', amount: 100, full_refund: false, idempotent: false });
    if (url.pathname.endsWith('/claim_payment_outbox_v2')) return Response.json([{ id: key, payment_intent_id: iid, refund_id: rid, topic: 'refund_reconcile', attempts: 1 }]);
    if (url.pathname.endsWith('/start_payment_outbox_job') || url.pathname.endsWith('/complete_payment_outbox_job')) return Response.json(true);
    if (url.pathname.endsWith('/fail_payment_outbox_job')) { failedJobs++; return Response.json(true); }
    if (url.pathname.endsWith('/record_payment_refund_identity')) {
      assertEquals(body.p_payment_intent_id, iid); assertEquals(body.p_idempotency_key, key);
      assertEquals(body.p_provider_payment_id, '90001'); events.push('identity');
      local.provider_refund_id = body.p_provider_refund_id; return Response.json(true);
    }
    if (url.pathname.endsWith('/mark_payment_refund_ambiguous')) { events.push('ambiguous'); return Response.json(true); }
    if (url.pathname.endsWith('/record_payment_refund_response_v2')) {
      events.push('record'); recordings.push(body);
      if (body.p_status === 'approved') {
        assertEquals(local.provider_refund_id, body.p_provider_refund_id, 'ID must be persisted before approval');
        if (local.status !== 'approved') settledEvents++;
        local.status = 'approved';
      }
      return Response.json({ ok: true });
    }
    if (url.origin !== 'https://api.mercadopago.com') throw new Error('Unexpected test request: ' + url.pathname);
    requests.push(url.pathname);
    if (init?.method === 'POST') {
      posted++; assertEquals(url.pathname, '/v1/payments/90001/refunds');
      assertEquals(new Headers(init.headers).get('x-idempotency-key'), key);
      if (scenario === 'lost-response') throw new Error('simulated lost provider response');
      if (scenario === 'throttled') return Response.json({ message: 'too many requests' }, { status: 429 });
      if (scenario === 'final-rejection') return Response.json({ message: 'invalid refund amount' }, { status: 400 });
      return Response.json(resource);
    }
    // The list is an adversarial trap: the new worker must never use it to
    // associate an unknown refund, even if only one plausible entry exists.
    if (url.pathname === '/v1/payments/90001') return Response.json({ id: 90001, refunds: [resource] });
    assertEquals(url.pathname, '/v1/payments/90001/refunds/10001');
    return Response.json(resource);
  };
  try {
    if (creation) {
      const res = await refundHandler(new Request(base + 'mercadopago-refund', { method: 'POST',
        headers: { authorization: 'Bearer fixture-user', 'content-type': 'application/json' },
        body: JSON.stringify({ payment_intent_id: iid, idempotency_key: key, amount: 100,
          confirmation: 'I_UNDERSTAND_THIS_REQUESTS_A_MERCADO_PAGO_REFUND' }),
      }));
      if (scenario === 'valid') { assertEquals(res.status, 200); assertEquals(events, ['identity', 'record']); }
      else if (scenario === 'final-rejection') { assertEquals(res.status, 409); assertEquals(recordings.map((r) => r.p_status), ['rejected']); }
      else { assertEquals(res.status, 202); assertEquals(recordings.length, 0); }
      // A throttled POST is not Mercado Pago rejecting the refund: nothing
      // financial is recorded and the refund goes to reconciliation.
      if (scenario === 'throttled') assertEquals(events, ['ambiguous']);
      if (scenario === 'partial-response') assertEquals(local.provider_refund_id, '10001');
      if (scenario === 'lost-response') assertEquals(local.provider_refund_id, null);
      assertEquals(posted, 1);
    } else {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = await signPaymentWorkerRequest('fixture-worker-secret', timestamp, key);
      const request = () => new Request(base + 'mercadopago-payment-worker', { method: 'POST', headers: {
        'x-taba-worker-timestamp': timestamp, 'x-taba-worker-nonce': key, 'x-taba-worker-signature': signature,
      } });
      await worker(request());
      if (scenario === 'valid') {
        await worker(request());
        assertEquals(settledEvents, 1); assertEquals(failedJobs, 0);
        assertEquals(requests, ['/v1/payments/90001/refunds/10001', '/v1/payments/90001/refunds/10001']);
      } else { assertEquals(recordings.length, 0); assertEquals(failedJobs, 1); }
      if (scenario.startsWith('unknown') || scenario === 'known-owned') assertEquals(requests.length, 0);
      assertEquals(posted, 0);
    }
  } finally { globalThis.fetch = original; }
}

for (const scenario of ['unknown-missing-time', 'unknown-prior', 'unknown-future', 'unknown-plausible',
  'known-wrong-payment', 'known-wrong-amount', 'known-owned', 'valid']) {
  Deno.test('A4 actual worker: ' + scenario, () => run(scenario));
}
for (const scenario of ['valid', 'partial-response', 'lost-response', 'known-wrong-payment', 'known-wrong-amount',
  'throttled', 'final-rejection']) {
  Deno.test('A4 actual refund POST: ' + scenario, () => run(scenario, true));
}

Deno.test('provider 4xx: only final answers become rejections', () => {
  for (const status of [400, 401, 403, 404, 422]) assertEquals(isFinalProviderRejection(status), true, String(status));
  for (const status of [200, 408, 409, 425, 429, 500, 502, 503]) assertEquals(isFinalProviderRejection(status), false, String(status));
});

// ── El worker real en el camino de PAGOS ────────────────────────────────────
// Mismo criterio que arriba: el handler de verdad, con Supabase y Mercado Pago
// respondidos por un transporte de prueba. Lo que se mide es qué se asienta en
// la base y si el trabajo termina, reintenta o se da por resuelto.

const sessionId = '96000000-0000-4000-8000-000000000005';
const receiptId = '96000000-0000-4000-8000-000000000006';
const cancellationId = '96000000-0000-4000-8000-000000000007';

type WorkerJob = Record<string, unknown> & { topic: string };
type ProviderAnswer = { status?: number; body: unknown };
type RecordedSnapshot = { p_snapshot: Record<string, unknown>; p_source: string; p_webhook_receipt_id: string | null };
type WorkerScript = {
  job: WorkerJob;
  intent?: Record<string, unknown>;
  payments?: Record<string, Record<string, unknown>>;
  merchantOrder?: () => ProviderAnswer;
  search?: Record<string, unknown>[];
  snapshotResult?: Record<string, unknown>;
  dispute?: Record<string, unknown>;
  disputeAnswer?: ProviderAnswer;
  /** Estado HTTP de la lectura del pago fijado que hace el worker tras un rechazo de disputa. */
  pinnedLookupStatus?: number;
  /** Lo que devuelve cada reclamo de la cola, en orden; sin esto, un solo trabajo por reclamo. */
  claims?: WorkerJob[][];
  /** Cuánto «tarda» cada lectura del proveedor, en el reloj que ve el worker. */
  providerLatencyMs?: number;
  /** Estado HTTP de los reclamos que siguen a los de `claims`. */
  laterClaimStatus?: number;
  /** Lo que contesta la búsqueda del cobro por la referencia del pago; sin esto, lo encuentra. */
  intentLookup?: ProviderAnswer;
};

function workerEnvironment() {
  for (const [name, value] of Object.entries({
    SUPABASE_URL: 'https://ukxqbgswjlibmnjemrzd.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
    SUPABASE_ANON_KEY: 'fixture-anon', MERCADOPAGO_ENVIRONMENT: 'test', MERCADOPAGO_OAUTH_ENVIRONMENT: 'test',
    MERCADOPAGO_CREDENTIAL_MODE: 'oauth', TABA_DEPLOYMENT_ENV: 'staging',
    MERCADOPAGO_OAUTH_PROJECT_REF: 'ukxqbgswjlibmnjemrzd', MERCADOPAGO_CLIENT_ID: '2691240967769590',
    MERCADOPAGO_OAUTH_PANEL_URL: 'https://taba2-staging.pages.dev/', TABA_CHECKOUT_BASE_URL: 'https://taba2-staging.pages.dev',
    TABA_ALLOWED_ORIGINS: 'https://taba2-staging.pages.dev', PAYMENT_WORKER_SECRET: 'fixture-worker-secret',
    PAYMENT_LOG_HASH_SALT: 'fixture-log-salt',
    MERCADOPAGO_TOKEN_ENCRYPTION_KEY: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
  })) Deno.env.set(name, value);
  Deno.env.delete('MERCADOPAGO_PRODUCTION_REVIEW_STATUS');
}

function providerPayment(id: number, status: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, status, status_detail: status === 'approved' ? 'accredited' : 'cc_rejected_other_reason',
    external_reference: 'fixture-reference', collector_id: 123, currency_id: 'ARS', transaction_amount: 100,
    payment_method_id: 'visa', live_mode: false, order: { id: 555 }, date_created: '2026-10-01T12:00:00Z', ...extra };
}

async function runWorker(script: WorkerScript, runs = 1, expectedStatus = 200) {
  workerEnvironment();
  const seller = { business_id: bid, environment: 'test', status: 'connected',
    protected_tokens: await protect({ access_token: 'fixture-seller-token' }, bid),
    expires_at: new Date(Date.now() + 172800000).toISOString(), refresh_owner: null };
  const intent = { id: iid, business_id: bid, environment: 'test', provider_payment_id: null,
    provider_status: null, external_reference: 'fixture-reference', ...(script.intent || {}) };
  const snapshots: RecordedSnapshot[] = [], providerRequests: string[] = [], failures: string[] = [];
  const disputes: Array<{ p_snapshot: Record<string, unknown> }> = [], cancellations: Record<string, unknown>[] = [];
  const claimRequests: Array<{ p_limit: number; p_lease_seconds: number }> = [], startedJobs: string[] = [];
  let finalized = 0, completed = 0, emptyProbes = 0, intentLookups = 0;
  // El worker decide con el reloj si le queda tiempo para otra tanda: la prueba
  // lo adelanta en cada lectura del proveedor en vez de esperar de verdad.
  const realNow = Date.now;
  let elapsedMs = 0;
  if (script.providerLatencyMs) Date.now = () => realNow() + elapsedMs;
  const original = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input)), init = options as RequestInit | undefined;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.pathname.endsWith('/consume_payment_rate_limit')) return Response.json({ allowed: true });
    if (url.pathname.endsWith('/mp_seller_connections')) return Response.json(url.searchParams.get('select') === 'business_id' ? [] : seller);
    if (url.pathname.endsWith('/payment_webhook_receipts')) return Response.json({ seller_business_id: bid, environment: 'test' });
    if (url.pathname.endsWith('/payment_intents')) {
      if (script.pinnedLookupStatus && url.searchParams.get('select') === 'provider_payment_id') {
        return Response.json({ message: 'boom' }, { status: script.pinnedLookupStatus });
      }
      return Response.json(intent);
    }
    if (url.pathname.endsWith('/claim_payment_outbox_v2')) {
      claimRequests.push(body);
      if (script.claims && script.laterClaimStatus && claimRequests.length > script.claims.length) {
        return Response.json({ message: 'boom' }, { status: script.laterClaimStatus });
      }
      if (script.claims) return Response.json(script.claims[claimRequests.length - 1] || []);
      return Response.json([{ id: key, attempts: 1, ...script.job }]);
    }
    if (url.pathname.endsWith('/start_payment_outbox_job')) { startedJobs.push(String(body.p_job_id)); return Response.json(true); }
    if (url.pathname.endsWith('/complete_payment_outbox_job')) { completed++; return Response.json(true); }
    if (url.pathname.endsWith('/fail_payment_outbox_job')) { failures.push(String(body.p_error_code)); return Response.json('retry_wait'); }
    if (url.pathname.endsWith('/find_payment_intent_by_external_reference')) {
      intentLookups++;
      assertEquals(body.p_external_reference, 'fixture-reference');
      assertEquals(body.p_environment, 'test');
      if (script.intentLookup) return Response.json(script.intentLookup.body, { status: script.intentLookup.status || 200 });
      return Response.json({ payment_intent_id: iid, checkout_session_id: sessionId });
    }
    if (url.pathname.endsWith('/record_mercadopago_payment_snapshot')) {
      snapshots.push(body);
      return Response.json(script.snapshotResult || { ok: true, payment_intent_id: iid, internal_status: 'approved_order_pending',
        manual_review_required: false, finalize_required: body.p_snapshot.status === 'approved' });
    }
    if (url.pathname.endsWith('/finalize_paid_checkout_session')) {
      assertEquals(body.p_checkout_session_id, sessionId); finalized++; return Response.json({ ok: true });
    }
    if (url.pathname.endsWith('/record_provider_probe_empty')) { emptyProbes++; return new Response(null, { status: 204 }); }
    if (url.pathname.endsWith('/record_mercadopago_dispute_snapshot')) {
      disputes.push(body);
      const answer = script.disputeAnswer || { body: { ok: true, dispute_id: 'fixture-dispute' } };
      return Response.json(answer.body, { status: answer.status || 200 });
    }
    if (url.pathname.endsWith('/record_payment_cancellation_response')) { cancellations.push(body); return Response.json({ ok: true }); }
    if (url.origin !== 'https://api.mercadopago.com') throw new Error('Unexpected test request: ' + url.pathname);
    providerRequests.push(url.pathname);
    elapsedMs += script.providerLatencyMs || 0;
    assertEquals(new Headers(init?.headers).get('authorization'), 'Bearer fixture-seller-token');
    if (url.pathname === '/v1/payments/search') {
      assertEquals(url.searchParams.get('external_reference'), 'fixture-reference');
      return Response.json({ results: script.search || [] });
    }
    if (url.pathname.startsWith('/merchant_orders/')) {
      const answer = script.merchantOrder ? script.merchantOrder() : { body: { id: 555, preference_id: 'fixture-preference' } };
      return Response.json(answer.body, { status: answer.status || 200 });
    }
    if (url.pathname.startsWith('/v1/chargebacks/')) return Response.json(script.dispute || {});
    const payment = (script.payments || {})[url.pathname.replace('/v1/payments/', '')];
    if (payment) return Response.json(payment);
    throw new Error('Unexpected provider request: ' + url.pathname);
  };
  try {
    for (let index = 0; index < runs; index++) {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = await signPaymentWorkerRequest('fixture-worker-secret', timestamp, key);
      const response = await worker(new Request(base + 'mercadopago-payment-worker', { method: 'POST', headers: {
        'x-taba-worker-timestamp': timestamp, 'x-taba-worker-nonce': key, 'x-taba-worker-signature': signature,
      } }));
      assertEquals(response.status, expectedStatus);
      await response.text();
    }
    return { snapshots, providerRequests, failures, finalized, completed, emptyProbes, disputes, cancellations,
      claimRequests, startedJobs, intentLookups };
  } finally { globalThis.fetch = original; Date.now = realNow; }
}

// EDGE-01. Un pago de Checkout Pro no trae `preference_id`: sale de su orden.
// Si esa lectura falla y el snapshot se asienta con la preferencia vacía, la
// base lo declara `preference_mismatch` y un cobro legítimo queda en revisión.
for (const status of [429, 500]) {
  Deno.test(`EDGE-01 worker: orden del proveedor en ${status} no asienta nada y el trabajo reintenta`, async () => {
    let merchantOrderAnswers = 0;
    const result = await runWorker({
      job: { topic: 'payment', resource_id: '90001', webhook_receipt_id: receiptId, payment_intent_id: null },
      payments: { '90001': providerPayment(90001, 'approved') },
      merchantOrder: () => (++merchantOrderAnswers === 1
        ? { status, body: { message: 'provider unavailable' } }
        : { body: { id: 555, preference_id: 'fixture-preference' } }),
    }, 2);
    // Primera corrida: nada asentado, el trabajo falla y queda para reintento
    // (con el estado del proveedor anotado como motivo). Segunda: las dos
    // lecturas responden y el snapshot lleva la preferencia.
    assertEquals(result.failures, [`provider_http_${status}`]);
    assertEquals(result.snapshots.length, 1);
    assertEquals(result.snapshots[0].p_snapshot.preference_id, 'fixture-preference');
    assertEquals(result.snapshots[0].p_snapshot.provider_payment_id, '90001');
    assertEquals(result.snapshots[0].p_webhook_receipt_id, receiptId);
    assertEquals(result.completed, 1);
    assertEquals(result.finalized, 1);
  });
}

Deno.test('EDGE-01 worker: orden que responde 200 sin preferencia tampoco asienta un snapshot vacío', async () => {
  const result = await runWorker({
    job: { topic: 'payment', resource_id: '90001', webhook_receipt_id: receiptId, payment_intent_id: null },
    payments: { '90001': providerPayment(90001, 'approved') },
    merchantOrder: () => ({ body: { id: 555 } }),
  });
  assertEquals(result.snapshots.length, 0);
  assertEquals(result.failures.length, 1);
});

// EDGE-02. Tarjeta rechazada y después aprobada en la misma preferencia: la
// sonda no puede seguir leyendo el pago rechazado que quedó guardado.
Deno.test('EDGE-02 worker: con el pago guardado rechazado, la sonda encuentra el aprobado por referencia', async () => {
  const result = await runWorker({
    job: { topic: 'payment_reconcile', resource_id: null, webhook_receipt_id: null, payment_intent_id: iid },
    intent: { provider_payment_id: '90001', provider_status: 'rejected' },
    payments: { '90001': providerPayment(90001, 'rejected'), '90002': providerPayment(90002, 'approved') },
    search: [{ id: 90001, status: 'rejected', external_reference: 'fixture-reference' },
      { id: 90002, status: 'approved', external_reference: 'fixture-reference' }],
  });
  assertEquals(result.failures, []);
  assertEquals(result.snapshots.length, 1);
  assertEquals(result.snapshots[0].p_snapshot.provider_payment_id, '90002');
  assertEquals(result.snapshots[0].p_snapshot.status, 'approved');
  assertEquals(result.snapshots[0].p_source, 'reconciliation');
  assertEquals(result.finalized, 1);
  assertEquals(result.providerRequests.includes('/v1/payments/90001'), false, 'el pago rechazado no se vuelve a leer');
});

for (const pinned of ['cancelled', 'canceled']) {
  Deno.test(`EDGE-02 worker: un pago guardado ${pinned} también se busca por referencia`, async () => {
    const result = await runWorker({
      job: { topic: 'payment_reconcile', resource_id: null, webhook_receipt_id: null, payment_intent_id: iid },
      intent: { provider_payment_id: '90001', provider_status: pinned },
      payments: { '90002': providerPayment(90002, 'approved') },
      search: [{ id: 90002, status: 'approved', external_reference: 'fixture-reference' }],
    });
    assertEquals(result.snapshots.map((row) => row.p_snapshot.provider_payment_id), ['90002']);
  });
}

Deno.test('EDGE-02 worker: un pago guardado pendiente se sigue leyendo por su identificador', async () => {
  const result = await runWorker({
    job: { topic: 'payment_reconcile', resource_id: null, webhook_receipt_id: null, payment_intent_id: iid },
    intent: { provider_payment_id: '90001', provider_status: 'in_process' },
    payments: { '90001': providerPayment(90001, 'approved') },
  });
  assertEquals(result.providerRequests.includes('/v1/payments/search'), false);
  assertEquals(result.snapshots.map((row) => row.p_snapshot.provider_payment_id), ['90001']);
});

Deno.test('EDGE-02 worker: rechazado guardado y búsqueda vacía no se anota como checkout abandonado', async () => {
  const result = await runWorker({
    job: { topic: 'payment_reconcile', resource_id: null, webhook_receipt_id: null, payment_intent_id: iid },
    intent: { provider_payment_id: '90001', provider_status: 'rejected' },
    payments: { '90001': providerPayment(90001, 'rejected') },
    search: [],
  });
  // Hay un pago conocido: «el proveedor no tiene nada» sería falso.
  assertEquals(result.emptyProbes, 0);
  assertEquals(result.snapshots.map((row) => row.p_snapshot.provider_payment_id), ['90001']);
  assertEquals(result.failures, []);
});

Deno.test('worker: sin ningún pago para la referencia la sonda queda anotada como vacía', async () => {
  const result = await runWorker({
    job: { topic: 'payment_reconcile', resource_id: null, webhook_receipt_id: null, payment_intent_id: iid },
    search: [],
  });
  assertEquals(result.emptyProbes, 1);
  assertEquals(result.snapshots.length, 0);
  assertEquals(result.completed, 1);
});

// Las claves nuevas del asiento (20261001200000) no son un fallo del trabajo:
// el asiento ya dejó el evento que corresponde y reintentar no cambia nada.
for (const [name, snapshotResult] of Object.entries({
  secondary_payment: { ok: true, payment_intent_id: iid, internal_status: 'completed', manual_review_required: false,
    finalize_required: false, secondary_payment: true, duplicate_approved: false, refund_review_required: false },
  duplicate_approved: { ok: true, payment_intent_id: iid, internal_status: 'completed', manual_review_required: false,
    finalize_required: false, secondary_payment: true, duplicate_approved: true, refund_review_required: true },
  post_completion: { ok: false, manual_review_required: false, reason: 'preference_mismatch', finalize_required: false,
    post_completion: true, operational_review_required: true },
})) {
  Deno.test(`worker: el asiento responde ${name} y el trabajo termina sin reintento`, async () => {
    const result = await runWorker({
      job: { topic: 'payment', resource_id: '90002', webhook_receipt_id: receiptId, payment_intent_id: null },
      payments: { '90002': providerPayment(90002, 'approved') },
      snapshotResult,
    });
    assertEquals(result.failures, []);
    assertEquals(result.completed, 1);
    assertEquals(result.finalized, 0);
  });
}

// Una disputa sobre un pago que no es el fijado la base la rechaza SIEMPRE
// (22023 «disputa no coincide con el pago»): reintentar ocho veces hasta
// dead_letter no la va a volver válida.
Deno.test('worker: disputa sobre un pago que no es el fijado termina, anotada, sin reintentos', async () => {
  const result = await runWorker({
    job: { topic: 'chargeback', resource_id: '7001', webhook_receipt_id: receiptId, payment_intent_id: iid },
    intent: { provider_payment_id: '90001', provider_status: 'approved' },
    dispute: { id: 7001, payment_id: 90002, status: 'opened', date_created: '2026-10-01T13:00:00Z' },
    payments: { '90002': providerPayment(90002, 'approved') },
    snapshotResult: { ok: true, payment_intent_id: iid, internal_status: 'completed', manual_review_required: false,
      finalize_required: false, secondary_payment: true, duplicate_approved: true, refund_review_required: true },
    disputeAnswer: { status: 400, body: { code: '22023', message: 'disputa no coincide con el pago', details: null, hint: null } },
  });
  assertEquals(result.disputes.length, 1);
  assertEquals(result.failures, []);
  assertEquals(result.completed, 1);
});

// La base levanta ESE MISMO rechazo cuando el cobro no tiene ningún pago fijado
// (un cobro que quedó en revisión de seguridad nunca lo guarda). Ahí la disputa
// es sobre el único pago del checkout: darla por resuelta con una línea de
// registro escondía un contracargo. Sigue fallando, reintenta y termina en
// `dead_letter`, que es lo que levanta la alerta de la cola de pagos.
Deno.test('worker: una disputa sobre un cobro SIN pago fijado no se da por resuelta', async () => {
  const result = await runWorker({
    job: { topic: 'chargeback', resource_id: '7001', webhook_receipt_id: receiptId, payment_intent_id: iid },
    intent: { provider_payment_id: null, provider_status: null },
    dispute: { id: 7001, payment_id: 90001, status: 'opened', date_created: '2026-10-01T13:00:00Z' },
    payments: { '90001': providerPayment(90001, 'approved') },
    snapshotResult: { ok: false, manual_review_required: true, reason: 'amount_mismatch', finalize_required: false },
    disputeAnswer: { status: 400, body: { code: '22023', message: 'disputa no coincide con el pago', details: null, hint: null } },
  });
  assertEquals(result.disputes.length, 1);
  assertEquals(result.completed, 0);
  assertEquals(result.failures, ['Dispute_is_on_a_payment_the_intent_has_not_pinned']);
});

Deno.test('worker: si el rechazo llega aunque el pago fijado ES el disputado, tampoco se da por resuelta', async () => {
  const result = await runWorker({
    job: { topic: 'chargeback', resource_id: '7001', webhook_receipt_id: receiptId, payment_intent_id: iid },
    intent: { provider_payment_id: '90001', provider_status: 'approved' },
    dispute: { id: 7001, payment_id: 90001, status: 'opened' },
    payments: { '90001': providerPayment(90001, 'approved') },
    snapshotResult: { ok: true, payment_intent_id: iid, internal_status: 'completed', manual_review_required: false, finalize_required: false },
    disputeAnswer: { status: 400, body: { code: '22023', message: 'disputa no coincide con el pago', details: null, hint: null } },
  });
  assertEquals(result.completed, 0);
  assertEquals(result.failures.length, 1);
});

Deno.test('worker: si no se puede leer qué pago tiene fijado el cobro, la disputa reintenta', async () => {
  const result = await runWorker({
    job: { topic: 'chargeback', resource_id: '7001', webhook_receipt_id: receiptId, payment_intent_id: iid },
    intent: { provider_payment_id: '90001', provider_status: 'approved' },
    pinnedLookupStatus: 500,
    dispute: { id: 7001, payment_id: 90002, status: 'opened' },
    payments: { '90002': providerPayment(90002, 'approved') },
    snapshotResult: { ok: true, payment_intent_id: iid, internal_status: 'completed', manual_review_required: false,
      finalize_required: false, secondary_payment: true, duplicate_approved: true, refund_review_required: true },
    disputeAnswer: { status: 400, body: { code: '22023', message: 'disputa no coincide con el pago', details: null, hint: null } },
  });
  assertEquals(result.completed, 0);
  assertEquals(result.failures.length, 1);
});

Deno.test('worker: cualquier otro 22023 de la disputa sigue siendo un fallo que reintenta', async () => {
  const result = await runWorker({
    job: { topic: 'chargeback', resource_id: '7001', webhook_receipt_id: receiptId, payment_intent_id: iid },
    dispute: { id: 7001, payment_id: 90001, status: 'opened' },
    payments: { '90001': providerPayment(90001, 'approved') },
    snapshotResult: { ok: true, payment_intent_id: iid, internal_status: 'completed', manual_review_required: false, finalize_required: false },
    disputeAnswer: { status: 400, body: { code: '22023', message: 'snapshot de disputa invalido', details: null, hint: null } },
  });
  assertEquals(result.failures.length, 1);
  assertEquals(result.completed, 0);
});

Deno.test('worker: una disputa sobre el pago fijado se asienta como siempre', async () => {
  const result = await runWorker({
    job: { topic: 'chargeback', resource_id: '7001', webhook_receipt_id: receiptId, payment_intent_id: iid },
    dispute: { id: 7001, payment_id: 90001, status: 'opened' },
    payments: { '90001': providerPayment(90001, 'approved') },
    snapshotResult: { ok: true, payment_intent_id: iid, internal_status: 'completed', manual_review_required: false, finalize_required: false },
  });
  assertEquals(result.disputes.length, 1);
  assertEquals(result.disputes[0].p_snapshot.provider_payment_id, '90001');
  assertEquals(result.failures, []);
  assertEquals(result.completed, 1);
});

// EDGE-10. Si al conciliar una cancelación el pago resulta aprobado, el pedido
// no puede quedar esperando a que otra notificación lo finalice.
Deno.test('EDGE-10 worker: una cancelación que encuentra el pago aprobado finaliza el pedido', async () => {
  const result = await runWorker({
    job: { topic: 'cancellation_reconcile', resource_id: '90001', webhook_receipt_id: null, payment_intent_id: iid, cancellation_id: cancellationId },
    intent: { provider_payment_id: '90001', provider_status: 'in_process' },
    payments: { '90001': providerPayment(90001, 'approved') },
  });
  assertEquals(result.snapshots.length, 1);
  assertEquals(result.snapshots[0].p_source, 'cancellation');
  assertEquals(result.finalized, 1);
  // La cancelación en sí no ocurrió: su resultado sigue sin asentarse.
  assertEquals(result.cancellations, []);
  assertEquals(result.failures.length, 1);
});

// EDGE-13. Cada reclamo toma pocos trabajos para que todos empiecen dentro de su
// plazo; para que eso no vacíe la cola cuatro veces más despacio, una corrida
// sigue reclamando MIENTRAS el proveedor responde rápido.
const queued = (count: number, from = 0): WorkerJob[] => Array.from({ length: count }, (_, index) => ({
  id: `96000000-0000-4000-8000-0000000001${String(from + index).padStart(2, '0')}`, attempts: 1,
  topic: 'payment', resource_id: '90001', webhook_receipt_id: receiptId, payment_intent_id: null,
}));
const approvedOnly = { job: { topic: 'payment' }, payments: { '90001': providerPayment(90001, 'approved') } };

Deno.test('EDGE-13 worker: con el proveedor rápido una corrida sigue reclamando hasta vaciar la cola', async () => {
  const result = await runWorker({ ...approvedOnly, claims: [queued(5), queued(5, 5), queued(2, 10)] });
  assertEquals(result.claimRequests.length, 3);
  assertEquals(result.completed, 12);
  assertEquals(new Set(result.startedJobs).size, 12);
  // Cada tanda es chica y trae su propio plazo: ningún trabajo se reclama
  // mucho antes de empezarse.
  for (const claim of result.claimRequests) assertEquals([claim.p_limit, claim.p_lease_seconds], [5, 150]);
});

Deno.test('EDGE-13 worker: una tanda incompleta es la última (no se pregunta de nuevo por una cola vacía)', async () => {
  const result = await runWorker({ ...approvedOnly, claims: [queued(3), queued(5, 5)] });
  assertEquals(result.claimRequests.length, 1);
  assertEquals(result.completed, 3);
});

Deno.test('EDGE-13 worker: una corrida tiene un tope de tandas aunque la cola no se termine', async () => {
  const result = await runWorker({ ...approvedOnly, claims: Array.from({ length: 12 }, (_, index) => queued(5, index * 5)) });
  assertEquals(result.claimRequests.length, 4);
  assertEquals(result.completed, 20);
});

Deno.test('EDGE-13 worker: con el proveedor lento no se reclama una segunda tanda', async () => {
  // Dos lecturas de 3 s por trabajo: la primera tanda consume 30 s del reloj.
  const result = await runWorker({ ...approvedOnly, providerLatencyMs: 3000, claims: [queued(5), queued(5, 5)] });
  assertEquals(result.claimRequests.length, 1);
  assertEquals(result.completed, 5);
});

Deno.test('EDGE-13 worker: si un reclamo posterior falla, lo ya procesado se informa igual', async () => {
  const result = await runWorker({ ...approvedOnly, claims: [queued(5)], laterClaimStatus: 500 });
  assertEquals(result.claimRequests.length, 2);
  assertEquals(result.completed, 5);
});

Deno.test('EDGE-13 worker: si el PRIMER reclamo falla, la corrida lo dice (503) y no procesa nada', async () => {
  const result = await runWorker({ ...approvedOnly, claims: [], laterClaimStatus: 500 }, 1, 503);
  assertEquals(result.claimRequests.length, 1);
  assertEquals(result.completed, 0);
});

// ── Reembolsos: importe, reintento autorizado y respuesta perdida ───────────
// Lo que la base dejó disponible con `resolve_stuck_payment_refund`
// (20261001204000): `provider_retry` reenvía la MISMA solicitud con la MISMA
// clave; `provider_lookup` pide buscar la identidad de una devolución que el
// proveedor ya ejecutó.

type RefundScript = {
  amount?: unknown;
  prepared?: Record<string, unknown>;
  localRefund?: Record<string, unknown>;
  othersOwned?: Array<{ id: string; provider_refund_id: string }>;
  providerRefunds?: (requestedAt: string) => unknown;
  listStatus?: number;
  job?: Record<string, unknown>;
  intentPaymentId?: string;
  /** La confirmación que manda el Panel; `null` = no la manda. Sin esto, la frase exacta. */
  confirmation?: string | null;
  /** Lo que contesta `prepare_payment_refund_v2` cuando la base rechaza el pedido. */
  prepareAnswer?: ProviderAnswer;
  /** El proveedor no contesta: la llamada queda abierta hasta que la corta la propia función. */
  providerHangs?: boolean;
};

function refundResource(id: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, payment_id: 90001, amount: 100, status: 'approved', date_created: new Date().toISOString(), ...extra };
}

async function runRefund(script: RefundScript, mode: 'handler' | 'worker' = 'handler') {
  workerEnvironment();
  const requestedAt = new Date(Date.now() - 2000).toISOString();
  const seller = { business_id: bid, environment: 'test', status: 'connected',
    protected_tokens: await protect({ access_token: 'fixture-seller-token' }, bid),
    expires_at: new Date(Date.now() + 172800000).toISOString(), refresh_owner: null };
  const local: Record<string, unknown> = { id: rid, payment_intent_id: iid, idempotency_key: key, amount: 100,
    requested_at: requestedAt, provider_refund_id: null, status: 'ambiguous', resolution_mode: null,
    provider_payment_id: '90001', last_provider_attempt_at: null, ...(script.localRefund || {}) };
  const events: string[] = [], providerRequests: string[] = [], prepares: Record<string, unknown>[] = [];
  const posts: Array<{ key: string | null; body: unknown }> = [], failures: string[] = [];
  // El cuerpo del POST tal como salió (`null` = sin cuerpo) y si llevaba content-type.
  const postBodies: Array<string | null> = [], postContentTypes: Array<string | null> = [];
  let completed = 0, userLookups = 0, aborted = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input)), init = options as RequestInit | undefined;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.pathname === '/auth/v1/user') { userLookups++; return Response.json({ id: bid }); }
    if (url.pathname.endsWith('/consume_payment_rate_limit')) return Response.json({ allowed: true });
    if (url.pathname.endsWith('/mp_seller_connections')) return Response.json(url.searchParams.get('select') === 'business_id' ? [] : seller);
    if (url.pathname.endsWith('/payment_intents')) {
      return Response.json({ id: iid, business_id: bid, environment: 'test', provider_payment_id: script.intentPaymentId || '90001' });
    }
    if (url.pathname.endsWith('/payment_refunds')) {
      if (url.searchParams.has('payment_intent_id')) return Response.json(script.othersOwned || []);
      return Response.json(local);
    }
    if (url.pathname.endsWith('/prepare_payment_refund_v2')) {
      prepares.push(body);
      if (script.prepareAnswer) return Response.json(script.prepareAnswer.body, { status: script.prepareAnswer.status || 200 });
      return Response.json({ refund_id: rid, idempotency_key: key, provider_payment_id: '90001',
        amount: body.p_amount ?? 100, full_refund: false, idempotent: false, ...(script.prepared || {}) });
    }
    if (url.pathname.endsWith('/claim_payment_outbox_v2')) {
      return Response.json([{ id: key, payment_intent_id: iid, refund_id: rid, topic: 'refund_reconcile', attempts: 1, ...(script.job || {}) }]);
    }
    if (url.pathname.endsWith('/start_payment_outbox_job')) return Response.json(true);
    if (url.pathname.endsWith('/complete_payment_outbox_job')) { completed++; return Response.json(true); }
    if (url.pathname.endsWith('/fail_payment_outbox_job')) { failures.push(String(body.p_error_code)); return Response.json('retry_wait'); }
    if (url.pathname.endsWith('/record_payment_refund_identity')) {
      assertEquals(body.p_refund_id, rid); assertEquals(body.p_payment_intent_id, iid);
      assertEquals(body.p_idempotency_key, key); assertEquals(body.p_provider_payment_id, '90001');
      events.push('identity:' + body.p_provider_refund_id);
      local.provider_refund_id = body.p_provider_refund_id; return Response.json(true);
    }
    if (url.pathname.endsWith('/mark_payment_refund_ambiguous')) { events.push('ambiguous:' + body.p_error_code); return Response.json(true); }
    if (url.pathname.endsWith('/record_payment_refund_response_v2')) {
      assertEquals(local.provider_refund_id, body.p_provider_refund_id, 'la identidad se guarda antes que el resultado');
      events.push('record:' + body.p_status); return Response.json({ ok: true });
    }
    if (url.origin !== 'https://api.mercadopago.com') throw new Error('Unexpected test request: ' + url.pathname);
    providerRequests.push(`${init?.method || 'GET'} ${url.pathname}`);
    if (init?.method === 'POST') {
      assertEquals(url.pathname, '/v1/payments/90001/refunds');
      posts.push({ key: new Headers(init.headers).get('x-idempotency-key'), body });
      postBodies.push(init.body === undefined || init.body === null ? null : String(init.body));
      postContentTypes.push(new Headers(init.headers).get('content-type'));
      if (script.providerHangs) {
        // No contesta nunca: lo único que la termina es el corte de la propia función.
        return await new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => {
          aborted++; reject(new DOMException('The operation was aborted.', 'AbortError'));
        }));
      }
      return Response.json(refundResource(10009, { amount: body.amount ?? 100 }));
    }
    if (url.pathname === '/v1/payments/90001/refunds') {
      if (script.listStatus) return Response.json({ message: 'provider unavailable' }, { status: script.listStatus });
      return Response.json(script.providerRefunds ? script.providerRefunds(requestedAt) : []);
    }
    const single = /^\/v1\/payments\/90001\/refunds\/(\d+)$/.exec(url.pathname);
    if (single) return Response.json(refundResource(Number(single[1])));
    throw new Error('Unexpected provider request: ' + url.pathname);
  };
  try {
    let status = 0, code = '';
    if (mode === 'handler') {
      const response = await refundHandler(new Request(base + 'mercadopago-refund', { method: 'POST',
        headers: { authorization: 'Bearer fixture-user', 'content-type': 'application/json' },
        body: JSON.stringify({ payment_intent_id: iid, idempotency_key: key, amount: script.amount,
          ...(script.confirmation === null ? {} : { confirmation: script.confirmation ?? 'I_UNDERSTAND_THIS_REQUESTS_A_MERCADO_PAGO_REFUND' }) }),
      }));
      status = response.status;
      code = String((await response.json()).code || '');
    } else {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = await signPaymentWorkerRequest('fixture-worker-secret', timestamp, key);
      const response = await worker(new Request(base + 'mercadopago-payment-worker', { method: 'POST', headers: {
        'x-taba-worker-timestamp': timestamp, 'x-taba-worker-nonce': key, 'x-taba-worker-signature': signature,
      } }));
      status = response.status;
      await response.text();
    }
    return { status, code, events, providerRequests, prepares, posts, postBodies, postContentTypes, failures, completed, userLookups, aborted };
  } finally { globalThis.fetch = original; }
}

// EDGE-11. `1.15 * 100` no es un entero en coma flotante.
for (const amount of [1.15, 0.07, 0.29, 0.57, 16.1, '1.15', 2500, '2500.5']) {
  Deno.test(`EDGE-11 reembolso: ${JSON.stringify(amount)} es un importe válido y llega igual a la base y al proveedor`, async () => {
    const result = await runRefund({ amount });
    assertEquals(result.status, 200);
    assertEquals(result.prepares.length, 1);
    assertEquals(result.prepares[0].p_amount, Number(amount));
    assertEquals(result.posts, [{ key, body: { amount: Number(amount) } }]);
  });
}

for (const amount of ['abc', 0, -5, 1.005, 0.001, true, [5], { value: 5 }, '1e3', '12.345', ' ', 10000000.01]) {
  Deno.test(`EDGE-11 reembolso: ${JSON.stringify(amount)} se rechaza como pedido inválido, no como caída del servicio`, async () => {
    const result = await runRefund({ amount });
    assertEquals(result.status, 400);
    assertEquals(result.code, 'INVALID_REQUEST');
    assertEquals(result.prepares, []);
    assertEquals(result.posts, []);
  });
}

// EDGE-09, reintento autorizado. Antes de reenviar se mira qué devoluciones
// tiene el pago: si el primer envío sí se ejecutó, no sale un segundo.
Deno.test('EDGE-09 reintento autorizado: sin devoluciones en el proveedor sale UN envío con la misma clave', async () => {
  const result = await runRefund({ amount: 100, prepared: { provider_retry: true }, providerRefunds: () => [] });
  assertEquals(result.status, 200);
  assertEquals(result.providerRequests, ['GET /v1/payments/90001/refunds', 'POST /v1/payments/90001/refunds']);
  assertEquals(result.posts.map((post) => post.key), [key]);
  assertEquals(result.events, ['identity:10009', 'record:approved']);
});

Deno.test('EDGE-09 reintento autorizado: si el proveedor ya tiene la devolución, se adopta y no se envía otra', async () => {
  const result = await runRefund({ amount: 100, prepared: { provider_retry: true },
    providerRefunds: () => [refundResource(10001)] });
  assertEquals(result.status, 200);
  assertEquals(result.posts, []);
  assertEquals(result.events, ['identity:10001', 'record:approved']);
});

Deno.test('EDGE-09 reintento autorizado: una devolución de otra solicitud local no cuenta como la perdida', async () => {
  const result = await runRefund({ amount: 100, prepared: { provider_retry: true },
    othersOwned: [{ id: 'other-local-refund', provider_refund_id: '10001' }],
    providerRefunds: (requestedAt) => [refundResource(10001),
      refundResource(10002, { date_created: new Date(Date.parse(requestedAt) - 3600000).toISOString() })] });
  assertEquals(result.posts.map((post) => post.key), [key]);
  assertEquals(result.events, ['identity:10009', 'record:approved']);
});

Deno.test('EDGE-09 reintento autorizado: dos candidatas no se adivinan ni se reenvía', async () => {
  const result = await runRefund({ amount: 100, prepared: { provider_retry: true },
    providerRefunds: () => [refundResource(10001), refundResource(10002)] });
  assertEquals(result.status, 202);
  assertEquals(result.posts, []);
  assertEquals(result.events, ['ambiguous:refund_retry_precheck_ambiguous']);
});

// La dirección que saca plata tiene que cerrar: un renglón del mismo importe,
// vivo, que no es de otra solicitud y al que no se le pudo leer un dato puede
// ser el primer envío ya ejecutado. Tratarlo como «no está» mandaba el segundo.
for (const [name, unreadable] of Object.entries({
  'sin fecha': { date_created: undefined },
  'con la fecha en null': { date_created: null },
  'con la fecha como número': { date_created: Date.now() },
  'con una fecha ilegible': { date_created: 'no es una fecha' },
  'sin identificador': { id: undefined },
  'sin importe': { amount: undefined },
} as Record<string, Record<string, unknown>>)) {
  Deno.test(`EDGE-09 reintento autorizado: una devolución ${name} en la lista frena el reenvío`, async () => {
    const result = await runRefund({ amount: 100, prepared: { provider_retry: true },
      providerRefunds: () => [refundResource(10001, unreadable)] });
    assertEquals(result.status, 202);
    assertEquals(result.code, 'REFUND_RECONCILING');
    assertEquals(result.posts, []);
    assertEquals(result.events, ['ambiguous:refund_retry_precheck_ambiguous']);
  });
}

Deno.test('EDGE-09 reintento autorizado: un renglón sin fecha pero de otro importe no frena el reenvío', async () => {
  const result = await runRefund({ amount: 100, prepared: { provider_retry: true },
    providerRefunds: () => [refundResource(10001, { amount: 60, date_created: undefined })] });
  assertEquals(result.status, 200);
  assertEquals(result.posts.map((post) => post.key), [key]);
});

for (const listStatus of [429, 500]) {
  Deno.test(`EDGE-09 reintento autorizado: si la lista responde ${listStatus} no se reenvía a ciegas`, async () => {
    const result = await runRefund({ amount: 100, prepared: { provider_retry: true }, listStatus });
    assertEquals(result.status, 202);
    assertEquals(result.posts, []);
    assertEquals(result.events, ['ambiguous:refund_retry_precheck_unavailable']);
  });
}

Deno.test('reembolso nuevo: el primer envío no consulta la lista (nada que buscar todavía)', async () => {
  const result = await runRefund({ amount: 100 });
  assertEquals(result.providerRequests, ['POST /v1/payments/90001/refunds']);
});

// EDGE-09, respuesta perdida. Sólo con `provider_lookup` pedido por una persona.
Deno.test('EDGE-09 worker: con provider_lookup y una sola candidata, guarda la identidad y asienta el resultado', async () => {
  const result = await runRefund({ localRefund: { resolution_mode: 'provider_lookup' },
    providerRefunds: () => [refundResource(10001)] }, 'worker');
  assertEquals(result.providerRequests, ['GET /v1/payments/90001/refunds', 'GET /v1/payments/90001/refunds/10001']);
  assertEquals(result.events, ['identity:10001', 'record:approved']);
  assertEquals(result.failures, []);
  assertEquals(result.completed, 1);
});

Deno.test('EDGE-09 worker: sin provider_lookup la lista ni se consulta', async () => {
  const result = await runRefund({ providerRefunds: () => [refundResource(10001)] }, 'worker');
  assertEquals(result.providerRequests, []);
  assertEquals(result.events, []);
  assertEquals(result.failures.length, 1);
});

for (const [name, script] of Object.entries({
  'dos candidatas': { providerRefunds: () => [refundResource(10001), refundResource(10002)] },
  'la única es de otra solicitud local': { othersOwned: [{ id: 'other-local-refund', provider_refund_id: '10001' }],
    providerRefunds: () => [refundResource(10001)] },
  'otro importe': { providerRefunds: () => [refundResource(10001, { amount: 60 })] },
  'anterior a la solicitud': { providerRefunds: (requestedAt: string) => [
    refundResource(10001, { date_created: new Date(Date.parse(requestedAt) - 600000).toISOString() })] },
  'la lista no responde': { listStatus: 503 },
  'lista vacía': { providerRefunds: () => [] },
  'la única no trae fecha': { providerRefunds: () => [refundResource(10001, { date_created: undefined })] },
  'una legible y otra sin fecha': { providerRefunds: () => [refundResource(10001), refundResource(10002, { date_created: null })] },
} as Record<string, RefundScript>)) {
  Deno.test(`EDGE-09 worker: provider_lookup no adivina (${name})`, async () => {
    const result = await runRefund({ localRefund: { resolution_mode: 'provider_lookup' }, ...script }, 'worker');
    assertEquals(result.events, []);
    assertEquals(result.failures.length, 1);
    assertEquals(result.completed, 0);
  });
}

Deno.test('EDGE-09 worker: si el cobro hoy apunta a otro pago, provider_lookup no consulta ni asienta nada', async () => {
  const result = await runRefund({ localRefund: { resolution_mode: 'provider_lookup' }, intentPaymentId: '90002',
    providerRefunds: () => [refundResource(10001)] }, 'worker');
  assertEquals(result.providerRequests, []);
  assertEquals(result.events, []);
  assertEquals(result.failures.length, 1);
});

Deno.test('EDGE-09 worker: una solicitud anterior a la columna (sin pago anotado) tampoco se busca', async () => {
  const result = await runRefund({ localRefund: { resolution_mode: 'provider_lookup', provider_payment_id: null },
    providerRefunds: () => [refundResource(10001)] }, 'worker');
  assertEquals(result.providerRequests, []);
  assertEquals(result.failures.length, 1);
});

// ── Lo que `mercadopago-refund` hacía y nadie había ejecutado ───────────────
// Cuatro comportamientos que estaban «leídos en el código»: el POST sin cuerpo
// del reembolso total, el 202 sin envío cuando la base ya tiene una solicitud,
// el rechazo sin la confirmación explícita y el corte de la llamada al proveedor.

Deno.test('reembolso total: importe vacío del Panel, total según la base, POST SIN cuerpo y con la clave guardada', async () => {
  const result = await runRefund({ prepared: { full_refund: true, amount: 100 } });
  assertEquals(result.status, 200);
  // A la base le llega «sin importe»: el saldo lo calcula ella.
  assertEquals(result.prepares.length, 1);
  assertEquals(result.prepares[0].p_amount, null);
  // Y a Mercado Pago, un POST sin cuerpo (su forma de pedir el total) con la clave de la solicitud.
  assertEquals(result.postBodies, [null]);
  assertEquals(result.postContentTypes, [null]);
  assertEquals(result.posts.map((post) => post.key), [key]);
  assertEquals(result.providerRequests, ['POST /v1/payments/90001/refunds']);
  assertEquals(result.events, ['identity:10009', 'record:approved']);
});

Deno.test('reembolso total: lo decide la base aunque el Panel haya escrito el importe', async () => {
  const result = await runRefund({ amount: 100, prepared: { full_refund: true, amount: 100 } });
  assertEquals(result.status, 200);
  assertEquals(result.prepares[0].p_amount, 100);
  assertEquals(result.postBodies, [null]);
});

Deno.test('reembolso parcial: importe vacío del Panel pero la base dice que NO es el total (ya hubo otro): va con cuerpo y con el importe de la base', async () => {
  const result = await runRefund({ prepared: { full_refund: false, amount: 60 } });
  assertEquals(result.status, 200);
  assertEquals(result.prepares[0].p_amount, null);
  assertEquals(result.postBodies, [JSON.stringify({ amount: 60 })]);
  assertEquals(result.postContentTypes, ['application/json']);
});

Deno.test('reembolso: con una base anterior que no informa full_refund, importe vacío sigue siendo el total', async () => {
  const result = await runRefund({ prepared: { full_refund: undefined, amount: 100 } });
  assertEquals(result.status, 200);
  assertEquals(result.postBodies, [null]);
});

// Una solicitud ya existe (la misma clave, u otra abierta del mismo cobro): la
// base contesta `reconciliation_required` y la función no le manda nada a nadie.
Deno.test('reembolso: si la base contesta reconciliation_required responde 202 y no sale ningún POST', async () => {
  const result = await runRefund({ amount: 100, prepared: { idempotent: true, reconciliation_required: true } });
  assertEquals(result.status, 202);
  assertEquals(result.code, 'REFUND_RECONCILING');
  assertEquals(result.posts, []);
  assertEquals(result.providerRequests, []);
  // Ni siquiera toca la solicitud: no la vuelve a marcar ni le asienta nada.
  assertEquals(result.events, []);
});

Deno.test('reembolso: una solicitud que ya existía (idempotent) y sigue sin resultado va a conciliación, sin POST', async () => {
  const result = await runRefund({ amount: 100, prepared: { idempotent: true }, localRefund: { status: 'requested' } });
  assertEquals(result.status, 202);
  assertEquals(result.code, 'REFUND_RECONCILING');
  assertEquals(result.posts, []);
  assertEquals(result.providerRequests, []);
  assertEquals(result.events, ['ambiguous:existing_refund_requires_reconciliation']);
});

Deno.test('reembolso: una solicitud con identidad del proveedor ya guardada tampoco se reenvía, aunque la base no diga idempotent', async () => {
  const result = await runRefund({ amount: 100, localRefund: { status: 'ambiguous', provider_refund_id: '10001' } });
  assertEquals(result.status, 202);
  assertEquals(result.posts, []);
  assertEquals(result.events, ['ambiguous:existing_refund_requires_reconciliation']);
});

for (const [stored, expected] of [['approved', 200], ['rejected', 409]] as const) {
  Deno.test(`reembolso: repetir una solicitud ya ${stored} contesta su resultado (${expected}) sin POST`, async () => {
    const result = await runRefund({ amount: 100, prepared: { idempotent: true }, localRefund: { status: stored } });
    assertEquals(result.status, expected);
    assertEquals(result.posts, []);
    assertEquals(result.providerRequests, []);
    assertEquals(result.events, []);
  });
}

Deno.test('reembolso: si la solicitud leída no es la que la base preparó (otro cobro u otra clave) no se envía nada', async () => {
  for (const localRefund of [{ payment_intent_id: '96000000-0000-4000-8000-0000000000ff' },
    { idempotency_key: '96000000-0000-4000-8000-0000000000fe' }]) {
    const result = await runRefund({ amount: 100, localRefund });
    assertEquals(result.status, 409);
    assertEquals(result.code, 'REFUND_NOT_AVAILABLE');
    assertEquals(result.posts, []);
  }
});

Deno.test('reembolso: si la base no lo acepta (pago no reembolsable) responde 409 sin llamar al proveedor', async () => {
  const result = await runRefund({ amount: 100,
    prepareAnswer: { status: 400, body: { code: '55000', message: 'pago no reembolsable en su estado actual' } } });
  assertEquals(result.status, 409);
  assertEquals(result.code, 'REFUND_NOT_AVAILABLE');
  assertEquals(result.prepares.length, 1);
  assertEquals(result.posts, []);
  assertEquals(result.providerRequests, []);
});

// Sin la frase exacta no pasa nada: ni se mira quién es, ni se prepara, ni se envía.
for (const [name, confirmation] of Object.entries({
  'sin confirmación': null,
  'con la confirmación de la cancelación': 'I_UNDERSTAND_THIS_REQUESTS_A_MERCADO_PAGO_CANCELLATION',
  'con un true': 'true',
  'con la frase en minúsculas': 'i_understand_this_requests_a_mercado_pago_refund',
} as Record<string, string | null>)) {
  Deno.test(`reembolso ${name}: se rechaza (409) antes de identificar al usuario, preparar o enviar`, async () => {
    const result = await runRefund({ amount: 100, confirmation });
    assertEquals(result.status, 409);
    assertEquals(result.code, 'EXPLICIT_REFUND_CONFIRMATION_REQUIRED');
    assertEquals(result.userLookups, 0);
    assertEquals(result.prepares, []);
    assertEquals(result.posts, []);
    assertEquals(result.events, []);
  });
}

// El corte de verdad: el proveedor no contesta y quien termina la llamada es el
// temporizador de la propia función (12 s). La prueba no espera doce segundos:
// adelanta ESE temporizador y deja que el corte ocurra por su camino real.
Deno.test('reembolso: si el proveedor no contesta, la función corta la llamada a los 12 s y la solicitud queda dudosa (202), con un solo POST', async () => {
  const realSetTimeout = globalThis.setTimeout;
  const delays: number[] = [];
  globalThis.setTimeout = ((handler: () => void, delay?: number, ...rest: unknown[]) => {
    delays.push(Number(delay));
    return realSetTimeout(handler, delay === 12_000 ? 5 : delay, ...rest);
  }) as typeof setTimeout;
  try {
    const result = await runRefund({ amount: 100, providerHangs: true });
    assertEquals(delays.includes(12_000), true, 'el corte es de doce segundos');
    assertEquals(result.aborted, 1, 'la llamada la termina el corte, no una respuesta');
    assertEquals(result.status, 202);
    assertEquals(result.code, 'REFUND_RECONCILING');
    assertEquals(result.posts.length, 1);
    // Nada financiero asentado y ninguna identidad inventada: sólo queda dudosa.
    assertEquals(result.events, ['ambiguous:network_or_timeout']);
  } finally { globalThis.setTimeout = realSetTimeout; }
});

// ── Un pago que no es de ningún checkout ────────────────────────────────────
// El worker lee el pago del aviso y busca el cobro por la referencia que trae.
// Si esa referencia no es de ningún checkout no hay dónde asentarlo: no se crea
// nada, el trabajo falla con ese motivo y reintenta hasta `dead_letter`, que es
// el rastro que queda a la vista.
Deno.test('worker: un pago cuya referencia no es de ningún checkout no asienta nada y el trabajo falla con ese motivo', async () => {
  const result = await runWorker({
    job: { topic: 'payment', resource_id: '90001', webhook_receipt_id: receiptId, payment_intent_id: null },
    payments: { '90001': providerPayment(90001, 'approved') },
    intentLookup: { status: 400, body: { code: 'P0002', message: 'referencia de pago desconocida', details: null, hint: null } },
  });
  assertEquals(result.intentLookups, 1);
  assertEquals(result.snapshots, []);
  assertEquals(result.finalized, 0);
  assertEquals(result.completed, 0);
  assertEquals(result.failures, ['Provider_payment_does_not_match_a_checkout_session']);
});

Deno.test('worker: un pago que no trae referencia tampoco se asienta, ni se busca', async () => {
  const result = await runWorker({
    job: { topic: 'payment', resource_id: '90001', webhook_receipt_id: receiptId, payment_intent_id: null },
    payments: { '90001': providerPayment(90001, 'approved', { external_reference: null }) },
  });
  assertEquals(result.intentLookups, 0);
  assertEquals(result.snapshots, []);
  assertEquals(result.completed, 0);
  assertEquals(result.failures, ['Provider_payment_has_no_external_reference']);
});

// ── El aviso de un reembolso, del webhook al asiento ────────────────────────
// La devolución se hizo en Mercado Pago (o es el aviso tardío de la nuestra). El
// aviso no trae el estado: el webhook deja el recibo y el trabajo, y el worker
// relee el pago y asienta lo que el proveedor dice que se devolvió. Los dos
// handlers reales, con una base y un proveedor de prueba compartidos.

type NotificationWorld = {
  /** El pago como lo devuelve el proveedor en cada lectura. */
  payment: Record<string, unknown>;
  /** Lo que contesta el asiento del pago. */
  snapshotResult?: Record<string, unknown>;
};

async function runRefundNotification(world: NotificationWorld, deliveries = 1) {
  workerEnvironment();
  const signingKey = 'fixture-webhook-signing-key';
  Deno.env.set('MERCADOPAGO_OAUTH_WEBHOOK_SECRET', signingKey);
  const seller = { business_id: bid, seller_id: '123', application_id: '2691240967769590', environment: 'test', status: 'connected',
    protected_tokens: await protect({ access_token: 'fixture-seller-token' }, bid),
    expires_at: new Date(Date.now() + 172800000).toISOString(), refresh_owner: null };
  // La «base»: los recibos con su clave única y la cola, lo justo para unir los dos handlers.
  const receipts: Array<Record<string, unknown> & { id: string; job: WorkerJob | null }> = [];
  const snapshots: RecordedSnapshot[] = [], providerRequests: string[] = [], failures: string[] = [];
  let finalized = 0, completed = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input)), init = options as RequestInit | undefined;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.pathname.endsWith('/consume_payment_rate_limit')) return Response.json({ allowed: true });
    if (url.pathname.endsWith('/mp_seller_connections')) return Response.json(url.searchParams.get('select') === 'business_id' ? [] : seller);
    if (url.pathname.endsWith('/payment_webhook_receipts')) return Response.json({ seller_business_id: bid, environment: 'test' });
    if (url.pathname.endsWith('/payment_intents')) {
      return Response.json({ id: iid, business_id: bid, environment: 'test', provider_payment_id: '90001',
        provider_status: 'approved', external_reference: 'fixture-reference' });
    }
    if (url.pathname.endsWith('/mp_record_seller_webhook')) {
      assertEquals(body.p_business_id, bid);
      const existing = receipts.find((receipt) => receipt.p_webhook_event_id === body.p_webhook_event_id
        && receipt.p_event_type === body.p_event_type && receipt.p_resource_id === body.p_resource_id);
      if (existing) return Response.json({ receipt_id: existing.id, duplicate: true, queued: false, signature_valid: true });
      const id = `96000000-0000-4000-8000-0000000002${String(receipts.length).padStart(2, '0')}`;
      receipts.push({ ...body, id, job: { id: `96000000-0000-4000-8000-0000000003${String(receipts.length).padStart(2, '0')}`,
        topic: 'payment', resource_id: String(body.p_resource_id), webhook_receipt_id: id, payment_intent_id: null, attempts: 0 } });
      return Response.json({ receipt_id: id, duplicate: false, queued: true, promoted: false });
    }
    if (url.pathname.endsWith('/claim_payment_outbox_v2')) {
      const due = receipts.map((receipt) => receipt.job).filter((job): job is WorkerJob => job !== null);
      for (const receipt of receipts) receipt.job = null;
      return Response.json(due.map((job) => ({ ...job, attempts: 1 })));
    }
    if (url.pathname.endsWith('/start_payment_outbox_job')) return Response.json(true);
    if (url.pathname.endsWith('/complete_payment_outbox_job')) { completed++; return Response.json(true); }
    if (url.pathname.endsWith('/fail_payment_outbox_job')) { failures.push(String(body.p_error_code)); return Response.json('retry_wait'); }
    if (url.pathname.endsWith('/find_payment_intent_by_external_reference')) {
      assertEquals(body.p_external_reference, 'fixture-reference');
      return Response.json({ payment_intent_id: iid, checkout_session_id: sessionId });
    }
    if (url.pathname.endsWith('/record_mercadopago_payment_snapshot')) {
      snapshots.push(body);
      return Response.json(world.snapshotResult || { ok: true, payment_intent_id: iid, internal_status: 'refunded',
        manual_review_required: false, finalize_required: false });
    }
    if (url.pathname.endsWith('/finalize_paid_checkout_session')) { finalized++; return Response.json({ ok: true }); }
    if (url.origin !== 'https://api.mercadopago.com') throw new Error('Unexpected test request: ' + url.pathname);
    providerRequests.push(`${init?.method || 'GET'} ${url.pathname}`);
    assertEquals(init?.method ?? 'GET', 'GET', 'ni el webhook ni el worker le escriben al proveedor');
    assertEquals(new Headers(init?.headers).get('authorization'), 'Bearer fixture-seller-token');
    if (url.pathname === '/v1/payments/90001') return Response.json(world.payment);
    if (url.pathname === '/merchant_orders/555') return Response.json({ id: 555, preference_id: 'fixture-preference' });
    throw new Error('Unexpected provider request: ' + url.pathname);
  };
  try {
    const answers: Array<{ status: number; body: Record<string, unknown> }> = [];
    for (let index = 0; index < deliveries; index++) {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const requestId = `fixture-refund-notification-${index}`;
      const hmacKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(signingKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const signature = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey,
        new TextEncoder().encode(`id:90001;request-id:${requestId};ts:${timestamp};`))), (byte) => byte.toString(16).padStart(2, '0')).join('');
      const response = await webhookHandler(new Request(base + 'mercadopago-webhook?data.id=90001&type=payment', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-request-id': requestId, 'x-signature': `ts=${timestamp},v1=${signature}`,
          'cf-connecting-ip': '203.0.113.7' },
        // El MISMO aviso cada vez: Mercado Pago reentrega con otro x-request-id y otra firma.
        body: JSON.stringify({ id: 'evt-payment-updated-1', type: 'payment', action: 'payment.updated', data: { id: '90001' }, user_id: 123 }),
      }));
      answers.push({ status: response.status, body: await response.json() });
    }
    const queued = receipts.filter((receipt) => receipt.job !== null).length;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const workerSignature = await signPaymentWorkerRequest('fixture-worker-secret', timestamp, key);
    const run = await worker(new Request(base + 'mercadopago-payment-worker', { method: 'POST', headers: {
      'x-taba-worker-timestamp': timestamp, 'x-taba-worker-nonce': key, 'x-taba-worker-signature': workerSignature,
    } }));
    return { answers, receipts, queued, workerStatus: run.status, workerBody: await run.json(), snapshots, providerRequests,
      failures, finalized, completed };
  } finally {
    globalThis.fetch = original;
    Deno.env.delete('MERCADOPAGO_OAUTH_WEBHOOK_SECRET');
  }
}

const refundedPayment = (extra: Record<string, unknown> = {}) => providerPayment(90001, 'refunded', {
  status_detail: 'refunded', date_last_updated: '2026-10-02T15:00:00Z',
  refunds: [{ id: 777001, payment_id: 90001, amount: 100, status: 'approved', date_created: '2026-10-02T15:00:00Z' }], ...extra });

Deno.test('aviso de un reembolso: el webhook deja recibo y trabajo, y el worker asienta el pago devuelto sin pedir finalizar', async () => {
  const result = await runRefundNotification({ payment: refundedPayment() });
  // El webhook: 201 recién después de guardar, con su recibo en la cola.
  assertEquals(result.answers.map((answer) => answer.status), [201]);
  assertEquals(result.answers[0].body.queued, true);
  assertEquals(result.answers[0].body.duplicate, false);
  assertEquals(result.receipts.length, 1);
  assertEquals(result.receipts[0].p_event_type, 'payment');
  assertEquals(result.receipts[0].p_resource_id, '90001');
  assertEquals(result.receipts[0].p_signature_valid, true);
  // El worker: relee el pago (el aviso no trae el estado) y asienta lo que dice el proveedor.
  assertEquals(result.workerBody, { ok: true, claimed: 1, completed: 1, retried: 0 });
  assertEquals(result.snapshots.length, 1);
  assertEquals(result.snapshots[0].p_source, 'webhook');
  assertEquals(result.snapshots[0].p_webhook_receipt_id, result.receipts[0].id);
  assertEquals(result.snapshots[0].p_snapshot.status, 'refunded');
  assertEquals(result.snapshots[0].p_snapshot.refunded_amount, '100.00');
  assertEquals(result.snapshots[0].p_snapshot.transaction_amount, '100.00');
  assertEquals(result.snapshots[0].p_snapshot.provider_payment_id, '90001');
  assertEquals(result.snapshots[0].p_snapshot.preference_id, 'fixture-preference');
  assertEquals(result.snapshots[0].p_snapshot.provider_occurred_at, '2026-10-02T15:00:00Z');
  // Un pago devuelto no arma un pedido, y nadie le escribe al proveedor.
  assertEquals(result.finalized, 0);
  assertEquals(result.failures, []);
  // Tres lecturas: la del webhook para confirmar de quién es el pago, y las dos del worker.
  assertEquals(result.providerRequests, ['GET /v1/payments/90001', 'GET /v1/payments/90001', 'GET /merchant_orders/555']);
});

Deno.test('aviso de un reembolso parcial: el importe devuelto es la suma de las devoluciones que informa el proveedor', async () => {
  const result = await runRefundNotification({
    payment: providerPayment(90001, 'approved', { date_last_updated: '2026-10-02T15:00:00Z',
      refunds: [{ id: 777001, amount: 30.5, status: 'approved' }, { id: 777002, amount: 19.5, status: 'approved' }] }),
    snapshotResult: { ok: true, payment_intent_id: iid, internal_status: 'partially_refunded', manual_review_required: false, finalize_required: false },
  });
  assertEquals(result.snapshots.length, 1);
  assertEquals(result.snapshots[0].p_snapshot.status, 'approved');
  assertEquals(result.snapshots[0].p_snapshot.refunded_amount, '50.00');
  // El asiento contestó que no hay nada que finalizar (el pedido ya existe): el worker no lo pide.
  assertEquals(result.finalized, 0);
  assertEquals(result.completed, 1);
});

Deno.test('aviso de un reembolso entregado tres veces: un recibo, un trabajo, una lectura asentada', async () => {
  const result = await runRefundNotification({ payment: refundedPayment() }, 3);
  assertEquals(result.answers.map((answer) => answer.status), [201, 201, 201]);
  assertEquals(result.answers.map((answer) => answer.body.duplicate), [false, true, true]);
  assertEquals(result.answers.map((answer) => answer.body.queued), [true, false, false]);
  assertEquals(new Set(result.answers.map((answer) => answer.body.receipt_id)).size, 1);
  assertEquals(result.receipts.length, 1);
  assertEquals(result.queued, 1);
  assertEquals(result.workerBody, { ok: true, claimed: 1, completed: 1, retried: 0 });
  assertEquals(result.snapshots.length, 1);
});

Deno.test('aviso de un contracargo que llega como estado del pago: se asienta charged_back y no se finaliza nada', async () => {
  const result = await runRefundNotification({
    payment: providerPayment(90001, 'charged_back', { status_detail: 'settled', date_last_updated: '2026-10-02T16:00:00Z' }),
    snapshotResult: { ok: true, payment_intent_id: iid, internal_status: 'charged_back', manual_review_required: false, finalize_required: false },
  });
  assertEquals(result.snapshots.map((row) => row.p_snapshot.status), ['charged_back']);
  assertEquals(result.snapshots[0].p_snapshot.refunded_amount, '0.00');
  assertEquals(result.finalized, 0);
  assertEquals(result.completed, 1);
});
