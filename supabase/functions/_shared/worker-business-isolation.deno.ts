import { assertEquals } from 'jsr:@std/assert@1.0.19';
import { protect } from './seller-oauth.ts';
import { signPaymentWorkerRequest } from './payment-worker-signature.ts';

// 2026-10-23 review: a payment read with seller B's token whose external reference points at business A's checkout
// must never be applied to A's checkout (the snapshot would judge it a collector mismatch and put A's real purchase
// in an absorbing review state). It is recorded as a finding of B and A's checkout is not touched.
let worker: (request: Request) => Promise<Response>;
const serve = Deno.serve;
Deno.serve = ((fn: typeof worker) => { worker = fn; return {}; }) as typeof Deno.serve;
try { await import('../mercadopago-payment-worker/index.ts'); } finally { Deno.serve = serve; }

const sellerBusiness = '98000000-0000-4000-8000-000000000001';
const otherBusiness = '98000000-0000-4000-8000-000000000002';
const intent = '98000000-0000-4000-8000-000000000003';
const session = '98000000-0000-4000-8000-000000000004';
const jobId = '98000000-0000-4000-8000-000000000005';
const receipt = '98000000-0000-4000-8000-000000000006';
const nonce = '98000000-0000-4000-8000-000000000007';
const base = 'https://ukxqbgswjlibmnjemrzd.supabase.co/functions/v1/';

async function run(owner: string | undefined) {
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
  const reference = `taba2:checkout:${session}`;
  const payment = { id: 777, external_reference: reference, status: 'approved', transaction_amount: 100, currency_id: 'ARS',
    collector_id: 321, live_mode: false, preference_id: 'fixture-pref', date_created: '2026-10-23T10:00:00.000-04:00',
    date_last_updated: '2026-10-23T10:00:01.000-04:00' };
  const seller = { business_id: sellerBusiness, environment: 'test', status: 'connected', seller_id: '321',
    protected_tokens: await protect({ access_token: 'APP_USR-seller-fixture' }, sellerBusiness),
    expires_at: new Date(Date.now() + 172800000).toISOString(), refresh_owner: null };
  const recorded = { orphans: [] as Record<string, unknown>[], snapshots: 0, completed: 0, failed: 0, claims: 0 };
  const original = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input)), init = options as RequestInit | undefined;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.pathname.endsWith('/consume_payment_rate_limit')) return Response.json({ allowed: true });
    if (url.pathname.endsWith('/mp_seller_connections')) return Response.json(url.searchParams.get('select') === 'business_id' ? [] : seller);
    if (url.pathname.endsWith('/payment_webhook_receipts')) return Response.json({ seller_business_id: sellerBusiness, environment: 'test' });
    if (url.pathname.endsWith('/claim_payment_outbox_v2')) {
      if (recorded.claims++ > 0) return Response.json([]);
      return Response.json([{ id: jobId, topic: 'payment', resource_id: '777', webhook_receipt_id: receipt, payment_intent_id: null,
        refund_id: null, cancellation_id: null, attempts: 1 }]);
    }
    if (url.pathname.endsWith('/start_payment_outbox_job') || url.pathname.endsWith('/extend_payment_outbox_lease')) return Response.json(true);
    if (url.pathname.endsWith('/complete_payment_outbox_job')) { recorded.completed++; return Response.json(true); }
    if (url.pathname.endsWith('/fail_payment_outbox_job')) { recorded.failed++; return Response.json(true); }
    if (url.pathname.endsWith('/claim_provider_ledger_window')) return Response.json(null);
    if (url.pathname.endsWith('/find_payment_intent_by_external_reference')) {
      return owner === undefined ? Response.json({ payment_intent_id: intent, checkout_session_id: session })
        : Response.json({ payment_intent_id: intent, checkout_session_id: session, business_id: owner });
    }
    if (url.pathname.endsWith('/record_orphan_provider_payment')) { recorded.orphans.push(body); return Response.json('orphan-id'); }
    if (url.pathname.endsWith('/record_mercadopago_payment_snapshot')) { recorded.snapshots++; return Response.json({ ok: true, finalize_required: false }); }
    if (url.origin === 'https://api.mercadopago.com') {
      if (url.pathname === '/v1/payments/777') return Response.json(payment);
      if (url.pathname === '/v1/payments/search') return Response.json({ results: [payment], paging: { total: 1, limit: 50, offset: 0 } });
    }
    if (url.pathname.endsWith('/provider_payment_unchanged')) return Response.json(false);
    return Response.json(null);
  };
  try {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = await signPaymentWorkerRequest('fixture-worker-secret', timestamp, nonce);
    const response = await worker(new Request(base + 'mercadopago-payment-worker', { method: 'POST', headers: {
      'x-taba-worker-timestamp': timestamp, 'x-taba-worker-nonce': nonce, 'x-taba-worker-signature': signature } }));
    await response.text();
    return recorded;
  } finally { globalThis.fetch = original; }
}

Deno.test('a webhook job of seller B never applies its payment to the checkout of business A', async () => {
  const result = await run(otherBusiness);
  assertEquals(result.snapshots, 0, "A's checkout is not touched");
  assertEquals(result.orphans.length, 1);
  assertEquals(result.orphans[0].p_business_id, sellerBusiness, 'the finding belongs to the business whose token read the payment');
  assertEquals(result.orphans[0].p_environment, 'test');
  assertEquals(result.completed, 1, 'the job is handled, not retried forever');
  assertEquals(result.failed, 0);
});

Deno.test('control: the same job for the seller\'s own checkout is applied as before', async () => {
  const result = await run(sellerBusiness);
  assertEquals(result.snapshots, 1);
  assertEquals(result.orphans.length, 0);
  assertEquals(result.completed, 1);
});

Deno.test('a lookup that does not say the business (a database that predates the change) behaves as before', async () => {
  const result = await run(undefined);
  assertEquals(result.snapshots, 1);
  assertEquals(result.orphans.length, 0);
});
