import { assertEquals } from 'jsr:@std/assert@1.0.19';
import { protect } from './seller-oauth.ts';
import { signPaymentWorkerRequest } from './payment-worker-signature.ts';
import { isFinalProviderRejection, providerRejectionFacts } from './mercadopago.ts';

const handlers: Array<(request: Request) => Promise<Response>> = [];
const serve = Deno.serve;
Deno.serve = ((fn: typeof handlers[number]) => { handlers.push(fn); return {}; }) as typeof Deno.serve;
try { await import('../mercadopago-payment-worker/index.ts'); await import('../mercadopago-refund/index.ts'); }
finally { Deno.serve = serve; }
const [worker, refundHandler] = handlers;
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
    protected_tokens: await protect({ access_token: 'APP_USR-seller-fixture' }, bid),
    expires_at: new Date(Date.now() + 172800000).toISOString(), refresh_owner: null };
  const requests: string[] = [], events: string[] = [], recordings: Record<string, unknown>[] = [];
  let posted = 0, settledEvents = 0, failedJobs = 0, claimedThisRun = false;
  // What the provider's refund list looks like and what the database decides about it (its own tests cover the SQL).
  const providerListed = !scenario.startsWith('unknown-settled') && scenario !== 'unknown-list-not-a-list';
  const settleVerdict = scenario === 'unknown-settled' ? 'settled_not_executed'
    : scenario === 'unknown-too-recent' ? 'too_recent'
    : scenario === 'unknown-list-not-a-list' ? 'incomplete_evidence' : 'unaccounted';
  const settleEvidence: Array<{ list_complete: boolean; provider_refunds: unknown[] }> = [];
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
    if (url.pathname.endsWith('/claim_payment_outbox_v2')) {
      if (claimedThisRun) return Response.json([]);
      claimedThisRun = true;
      return Response.json([{ id: key, business_id: bid, payment_intent_id: iid, refund_id: rid, topic: 'refund_reconcile', attempts: 1 }]);
    }
    if (url.pathname.endsWith('/extend_payment_outbox_lease')) return Response.json(true);
    if (url.pathname.endsWith('/claim_provider_ledger_window')) return Response.json(null);
    if (url.pathname.endsWith('/park_refund_identity_unknown')) {
      assertEquals(body.p_refund_id, rid);
      assertEquals(body.p_evidence.provider_refunds.map((r: { id: string }) => r.id), providerListed ? ['10001'] : []);
      events.push('parked'); return Response.json({ ok: true });
    }
    if (url.pathname.endsWith('/settle_ambiguous_refund_from_provider')) {
      assertEquals(body.p_refund_id, rid);
      settleEvidence.push(body.p_evidence);
      events.push('settle'); return Response.json(settleVerdict);
    }
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
      if (scenario === 'live-credentials-401') return Response.json({ message: 'Unauthorized use of live credentials', error: 'unauthorized', status: 401,
        cause: [{ code: 7, description: 'Unauthorized use of live credentials', data: '23-10-2026T19:58:57UTC;secret-looking-value' }] },
        { status: 401, headers: { 'x-request-id': '1f619ac9-66fb-446e-9739-3cad2740969a' } });
      return Response.json(resource);
    }
    // Since the financial-integrity migration, the list is evidence for the
    // parked case ONLY. It must never identify or settle an unknown refund.
    if (url.pathname === '/v1/payments/90001/refunds') {
      // An empty list is a legitimate answer; an object (an error body with 200) is NOT "no refunds".
      if (scenario === 'unknown-list-not-a-list') return Response.json({ message: 'temporarily unavailable' });
      return Response.json(providerListed ? [resource] : []);
    }
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
      else if (scenario === 'final-rejection' || scenario === 'live-credentials-401') { assertEquals(res.status, 409); assertEquals(recordings.map((r) => r.p_status), ['rejected']); }
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
        // A second queued observation, after the previous job was completed.
        claimedThisRun = false;
        await worker(request());
        assertEquals(settledEvents, 1); assertEquals(failedJobs, 0);
        assertEquals(requests, ['/v1/payments/90001/refunds/10001', '/v1/payments/90001/refunds/10001']);
      } else {
        assertEquals(recordings.length, 0);
        if (scenario.startsWith('unknown')) {
          // Still too early, or a list that could not be read, is retried by the outbox; every other verdict ends the job.
          assertEquals(failedJobs, scenario === 'unknown-too-recent' || scenario === 'unknown-list-not-a-list' ? 1 : 0);
          assertEquals(events, ['parked', 'settle']);
          assertEquals(local.provider_refund_id, null);
          assertEquals(requests, ['/v1/payments/90001/refunds']);
          // Only a list that was read completely may be offered as proof, and a list that was not read is never "empty".
          assertEquals(settleEvidence.length, 1);
          assertEquals(settleEvidence[0].list_complete, scenario !== 'unknown-list-not-a-list');
        } else assertEquals(failedJobs, 1);
      }
      if (scenario === 'known-owned') assertEquals(requests.length, 0);
      assertEquals(posted, 0);
    }
  } finally { globalThis.fetch = original; }
}

for (const scenario of ['unknown-missing-time', 'unknown-prior', 'unknown-future', 'unknown-plausible',
  'unknown-settled', 'unknown-too-recent', 'unknown-list-not-a-list',
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

// 2026-10-23: a refund refused with 401 «Unauthorized use of live credentials» (cause 7) was recorded only as a hash.
// The operator now reads the status, the request id and the provider's own codes, and never its body.
Deno.test('a refused refund leaves its provider status, request id and cause codes in the log, never the body', async () => {
  const warn = console.warn, lines: string[] = [];
  console.warn = (line?: unknown) => { lines.push(String(line)); };
  try { await run('live-credentials-401', true); } finally { console.warn = warn; }
  const logged = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((l) => l?.event === 'provider_rejection');
  assertEquals(logged?.operation, 'refund');
  assertEquals(logged?.http_status, 401);
  assertEquals(logged?.final, true);
  assertEquals(logged?.provider_request_id, '1f619ac9-66fb-446e-9739-3cad2740969a');
  assertEquals(logged?.provider_error, 'unauthorized');
  assertEquals(logged?.provider_cause_codes, [7]);
  assertEquals(logged?.business_id, bid);
  assertEquals(logged?.payment_intent_id, iid);
  const text = JSON.stringify(logged);
  assertEquals(/live credentials|secret-looking-value|description|message/i.test(text), false);
});
Deno.test('provider rejection facts keep only shape-checked fields', () => {
  const facts = providerRejectionFacts({
    response: new Response(null, { status: 400 }), requestId: 'not an id <script>',
    body: { error: 'x'.repeat(200), message: 'free text', cause: [{ code: 2063, description: 'text' }, { code: { nested: true } }, { code: 'bad code!' }, 'junk', null] },
  });
  assertEquals(facts, { http_status: 400, provider_request_id: undefined, provider_error: undefined, provider_cause_codes: [2063] });
  assertEquals(providerRejectionFacts({ response: new Response(null, { status: 503 }), requestId: '', body: null }),
    { http_status: 503, provider_request_id: undefined, provider_error: undefined, provider_cause_codes: undefined });
});
