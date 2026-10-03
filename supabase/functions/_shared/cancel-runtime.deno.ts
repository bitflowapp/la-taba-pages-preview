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

type Scenario = 'cancelled' | 'final-rejection' | 'throttled' | 'in-flight' | 'lost-response';
type World = {
  /** Cuántas veces seguidas la base rechaza el asiento de la respuesta del proveedor. */
  recordFailures?: number;
  /** La base tampoco acepta marcar la solicitud como dudosa. */
  ambiguousFails?: boolean;
  /** Lo que contesta `prepare_payment_cancellation`. */
  prepared?: Record<string, unknown> | null;
  confirmation?: string;
};

async function deliver(scenario: Scenario, world: World = {}) {
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
  // `recordings`: lo que la base asentó. `recordAttempts`: cada intento de asentar, también los rechazados.
  const recordings: Record<string, unknown>[] = [], recordAttempts: Record<string, unknown>[] = [];
  const ambiguous: string[] = [], ambiguousAttempts: Record<string, unknown>[] = [], prepares: Record<string, unknown>[] = [];
  let puts = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input)), init = options as RequestInit | undefined;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.pathname === '/auth/v1/user') return Response.json({ id: bid });
    if (url.pathname.endsWith('/consume_payment_rate_limit')) return Response.json({ allowed: true });
    if (url.pathname.endsWith('/mp_seller_connections')) return Response.json(url.searchParams.get('select') === 'business_id' ? [] : seller);
    if (url.pathname.endsWith('/payment_intents')) return Response.json({ id: iid, business_id: bid, environment: 'test', provider_payment_id: '90001' });
    if (url.pathname.endsWith('/prepare_payment_cancellation')) {
      prepares.push(body);
      if (world.prepared === null) return Response.json({ code: '55000', message: 'pago no cancelable en su estado actual' }, { status: 400 });
      return Response.json({ cancellation_id: cid, idempotency_key: key, provider_payment_id: '90001', ...(world.prepared || {}) });
    }
    if (url.pathname.endsWith('/record_payment_cancellation_response')) {
      recordAttempts.push(body);
      if (recordAttempts.length <= (world.recordFailures || 0)) {
        return Response.json({ code: '40P01', message: 'deadlock detected' }, { status: 500 });
      }
      recordings.push(body);
      return Response.json({ ok: true, payment_intent_id: iid, idempotent: false });
    }
    if (url.pathname.endsWith('/mark_payment_cancellation_ambiguous')) {
      ambiguousAttempts.push(body);
      if (world.ambiguousFails) return Response.json({ code: '57014', message: 'canceling statement due to statement timeout' }, { status: 500 });
      ambiguous.push(String(body.p_error_code));
      return Response.json(true);
    }
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
      body: JSON.stringify({ payment_intent_id: iid, idempotency_key: key,
        confirmation: world.confirmation ?? 'I_UNDERSTAND_THIS_REQUESTS_A_MERCADO_PAGO_CANCELLATION' }),
    }));
    const answer = await res.json();
    return { status: res.status, code: String(answer.code || ''), ok: answer.ok, recordings, recordAttempts, ambiguous,
      ambiguousAttempts, prepares, puts };
  } finally { globalThis.fetch = original; }
}

async function run(scenario: Scenario) {
  const result = await deliver(scenario);
  assertEquals(result.puts, 1, 'exactly one provider request');
  if (scenario === 'cancelled') {
    assertEquals(result.status, 200); assertEquals(result.recordings.map((r) => r.p_status), ['cancelled']); assertEquals(result.ambiguous, []);
  } else if (scenario === 'final-rejection') {
    assertEquals(result.status, 409); assertEquals(result.recordings.map((r) => r.p_status), ['rejected']); assertEquals(result.ambiguous, []);
  } else {
    // Throttled, in flight or lost: the provider decided nothing we can record.
    assertEquals(result.status, 202); assertEquals(result.recordings, []);
    assertEquals(result.ambiguous, [scenario === 'lost-response' ? 'network_or_timeout' : scenario === 'throttled' ? 'http_429' : 'http_409']);
  }
}

for (const scenario of ['cancelled', 'final-rejection', 'throttled', 'in-flight', 'lost-response'] as const) {
  Deno.test('cancellation POST: ' + scenario, () => run(scenario));
}

// ── El proveedor contestó y la base no pudo asentarlo ────────────────────────
// La función respondía «no disponible» y dejaba la solicitud en `requested` sin
// ningún trabajo de conciliación. El pedido siguiente, con otra clave, recibía
// «en verificación» (hay una solicitud abierta) y nada la verificaba nunca: el
// pago quedaba cancelado en Mercado Pago y pendiente acá.

Deno.test('cancelación: si el asiento falla UNA vez se reintenta y queda asentada, con una sola llamada al proveedor', async () => {
  const result = await deliver('cancelled', { recordFailures: 1 });
  assertEquals(result.status, 200);
  assertEquals(result.ok, true);
  assertEquals(result.recordAttempts.map((r) => r.p_status), ['cancelled', 'cancelled']);
  // El reintento es el MISMO asiento: misma solicitud y mismo hash de la respuesta.
  assertEquals(result.recordAttempts[0], result.recordAttempts[1]);
  assertEquals(result.recordAttempts[0].p_cancellation_id, cid);
  assertEquals(result.recordings.map((r) => r.p_status), ['cancelled']);
  assertEquals(result.ambiguous, []);
  assertEquals(result.puts, 1, 'el reintento es del asiento: al proveedor no se le pide nada otra vez');
});

Deno.test('cancelación: si el asiento falla DOS veces la solicitud queda dudosa y en conciliación (202), con una sola llamada al proveedor', async () => {
  const result = await deliver('cancelled', { recordFailures: 2 });
  assertEquals(result.status, 202);
  assertEquals(result.code, 'CANCELLATION_RECONCILING');
  assertEquals(result.recordAttempts.length, 2, 'un reintento, no un bucle');
  assertEquals(result.recordings, []);
  // `mark_payment_cancellation_ambiguous` es lo que deja la solicitud `ambiguous`
  // y encola su trabajo `cancellation_reconcile`: de ahí la levanta el worker.
  assertEquals(result.ambiguous, ['cancellation_response_not_persisted']);
  assertEquals(result.ambiguousAttempts[0].p_cancellation_id, cid);
  assertEquals(/^[a-f0-9]{64}$/.test(String(result.ambiguousAttempts[0].p_request_hash)), true);
  assertEquals(result.puts, 1, 'nunca sale una segunda cancelación');
});

Deno.test('cancelación: el rechazo final del proveedor también se reintenta una vez y queda asentado', async () => {
  const result = await deliver('final-rejection', { recordFailures: 1 });
  assertEquals(result.status, 409);
  assertEquals(result.code, 'CANCELLATION_REJECTED');
  assertEquals(result.recordAttempts.map((r) => r.p_status), ['rejected', 'rejected']);
  assertEquals(result.recordings.map((r) => r.p_status), ['rejected']);
  assertEquals(result.ambiguous, []);
  assertEquals(result.puts, 1);
});

Deno.test('cancelación: un rechazo final que no se pudo asentar no queda en requested: dudosa y 202', async () => {
  const result = await deliver('final-rejection', { recordFailures: 2 });
  // No se contesta «rechazada»: acá no quedó escrito, y decirlo dejaría al Panel
  // mostrando un resultado que la base no tiene.
  assertEquals(result.status, 202);
  assertEquals(result.code, 'CANCELLATION_RECONCILING');
  assertEquals(result.recordings, []);
  assertEquals(result.ambiguous, ['cancellation_response_not_persisted']);
  assertEquals(result.puts, 1);
});

Deno.test('cancelación: si tampoco se puede marcar dudosa la respuesta sigue siendo 202 y no se reenvía nada', async () => {
  const result = await deliver('cancelled', { recordFailures: 2, ambiguousFails: true });
  assertEquals(result.status, 202);
  assertEquals(result.ambiguousAttempts.length, 1);
  assertEquals(result.puts, 1);
});

// ── Lo que ya hacía y no tenía prueba ejecutada ──────────────────────────────

Deno.test('cancelación: con una solicitud abierta la base contesta reconciliation_required y no sale nada al proveedor', async () => {
  const result = await deliver('cancelled', { prepared: { idempotent: true, reconciliation_required: true } });
  assertEquals(result.status, 202);
  assertEquals(result.code, 'CANCELLATION_RECONCILING');
  assertEquals(result.puts, 0);
  assertEquals(result.recordAttempts, []);
});

Deno.test('cancelación: sin la confirmación explícita no se prepara ni se envía nada', async () => {
  const result = await deliver('cancelled', { confirmation: 'si' });
  assertEquals(result.status, 409);
  assertEquals(result.code, 'EXPLICIT_CANCELLATION_CONFIRMATION_REQUIRED');
  assertEquals(result.prepares, []);
  assertEquals(result.puts, 0);
});

Deno.test('cancelación: si la base no acepta prepararla (pago no cancelable) responde 409 sin llamar al proveedor', async () => {
  const result = await deliver('cancelled', { prepared: null });
  assertEquals(result.status, 409);
  assertEquals(result.code, 'CANCELLATION_NOT_AVAILABLE');
  assertEquals(result.puts, 0);
});
