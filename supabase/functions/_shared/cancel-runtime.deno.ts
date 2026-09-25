import { assertEquals } from 'jsr:@std/assert@1.0.19';
import { protect } from './seller-oauth.ts';

// The actual cancellation handler against a scripted Supabase and Mercado Pago:
// only a final provider answer may become a financial state.
const handlers: Array<(request: Request) => Promise<Response>> = [];
const serve = Deno.serve;
Deno.serve = ((fn: typeof handlers[number]) => { handlers.push(fn); return {}; }) as typeof Deno.serve;
try { await import('../mercadopago-cancel-payment/index.ts'); }
finally { Deno.serve = serve; }
const [cancelHandler] = handlers;
const bid = '97000000-0000-4000-8000-000000000001';
const iid = '97000000-0000-4000-8000-000000000002';
const cid = '97000000-0000-4000-8000-000000000003';
const key = '97000000-0000-4000-8000-000000000004';

async function run(scenario: 'cancelled' | 'final-rejection' | 'throttled' | 'in-flight' | 'lost-response') {
  for (const [name, value] of Object.entries({
    SUPABASE_URL: 'https://ukxqbgswjlibmnjemrzd.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
    SUPABASE_ANON_KEY: 'fixture-anon', MERCADOPAGO_ENVIRONMENT: 'test', MERCADOPAGO_OAUTH_ENVIRONMENT: 'test',
    MERCADOPAGO_CREDENTIAL_MODE: 'oauth', TABA_DEPLOYMENT_ENV: 'staging',
    MERCADOPAGO_OAUTH_PROJECT_REF: 'ukxqbgswjlibmnjemrzd', MERCADOPAGO_CLIENT_ID: '2691240967769590',
    MERCADOPAGO_OAUTH_PANEL_URL: 'https://taba2-staging.pages.dev/', TABA_CHECKOUT_BASE_URL: 'https://taba2-staging.pages.dev',
    TABA_ALLOWED_ORIGINS: 'https://taba2-staging.pages.dev', PAYMENT_LOG_HASH_SALT: 'fixture-log-salt',
    MERCADOPAGO_TOKEN_ENCRYPTION_KEY: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
  })) Deno.env.set(name, value);
  const seller = { business_id: bid, environment: 'test', status: 'connected',
    protected_tokens: await protect({ access_token: 'fixture-seller-token' }, bid),
    expires_at: new Date(Date.now() + 172800000).toISOString(), refresh_owner: null };
  const recordings: Record<string, unknown>[] = [], ambiguous: string[] = [];
  let puts = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input)), init = options as RequestInit | undefined;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.pathname === '/auth/v1/user') return Response.json({ id: bid });
    if (url.pathname.endsWith('/consume_payment_rate_limit')) return Response.json({ allowed: true });
    if (url.pathname.endsWith('/mp_seller_connections')) return Response.json(url.searchParams.get('select') === 'business_id' ? [] : seller);
    if (url.pathname.endsWith('/payment_intents')) return Response.json({ id: iid, business_id: bid, environment: 'test', provider_payment_id: '90001' });
    if (url.pathname.endsWith('/prepare_payment_cancellation')) return Response.json({ cancellation_id: cid, idempotency_key: key, provider_payment_id: '90001' });
    if (url.pathname.endsWith('/record_payment_cancellation_response')) { recordings.push(body); return Response.json(true); }
    if (url.pathname.endsWith('/mark_payment_cancellation_ambiguous')) { ambiguous.push(String(body.p_error_code)); return Response.json(true); }
    if (url.origin !== 'https://api.mercadopago.com') throw new Error('Unexpected test request: ' + url.pathname);
    puts++;
    assertEquals(init?.method, 'PUT'); assertEquals(url.pathname, '/v1/payments/90001');
    assertEquals(new Headers(init?.headers).get('x-idempotency-key'), key);
    if (scenario === 'lost-response') throw new Error('simulated lost provider response');
    if (scenario === 'throttled') return Response.json({ message: 'too many requests' }, { status: 429 });
    if (scenario === 'in-flight') return Response.json({ message: 'idempotency key in use' }, { status: 409 });
    if (scenario === 'final-rejection') return Response.json({ message: 'payment cannot be cancelled' }, { status: 400 });
    return Response.json({ id: 90001, status: 'cancelled' });
  };
  try {
    const res = await cancelHandler(new Request('https://ukxqbgswjlibmnjemrzd.supabase.co/functions/v1/mercadopago-cancel-payment', {
      method: 'POST', headers: { authorization: 'Bearer fixture-user', 'content-type': 'application/json' },
      body: JSON.stringify({ payment_intent_id: iid, idempotency_key: key, confirmation: 'I_UNDERSTAND_THIS_REQUESTS_A_MERCADO_PAGO_CANCELLATION' }),
    }));
    assertEquals(puts, 1, 'exactly one provider request');
    if (scenario === 'cancelled') {
      assertEquals(res.status, 200); assertEquals(recordings.map((r) => r.p_status), ['cancelled']); assertEquals(ambiguous, []);
    } else if (scenario === 'final-rejection') {
      assertEquals(res.status, 409); assertEquals(recordings.map((r) => r.p_status), ['rejected']); assertEquals(ambiguous, []);
    } else {
      // Throttled, in flight or lost: the provider decided nothing we can record.
      assertEquals(res.status, 202); assertEquals(recordings, []);
      assertEquals(ambiguous, [scenario === 'lost-response' ? 'network_or_timeout' : scenario === 'throttled' ? 'http_429' : 'http_409']);
    }
  } finally { globalThis.fetch = original; }
}

for (const scenario of ['cancelled', 'final-rejection', 'throttled', 'in-flight', 'lost-response'] as const) {
  Deno.test('cancellation POST: ' + scenario, () => run(scenario));
}
