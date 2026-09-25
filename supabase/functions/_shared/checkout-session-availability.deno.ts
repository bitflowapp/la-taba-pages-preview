import { assertEquals } from 'jsr:@std/assert@1.0.19';

// The real handler, with Supabase answered by a fixture transport.
let handle: (request: Request) => Promise<Response>;
const serve = Deno.serve;
Deno.serve = ((handler: unknown) => {
  handle = handler as typeof handle;
  return {};
}) as typeof Deno.serve;
try {
  await import('../mercadopago-create-checkout-session/index.ts');
} finally {
  Deno.serve = serve;
}

const business = '97000000-0000-4000-8000-000000000001';

async function run(available: boolean | 'error') {
  for (const [name, value] of Object.entries({
    SUPABASE_URL: 'https://ucbtjcurawxjwjdvvcvj.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
    SUPABASE_ANON_KEY: 'fixture-anon', PAYMENT_LOG_HASH_SALT: 'fixture-log-salt',
    TABA_ALLOWED_ORIGINS: 'https://taba2-staging.pages.dev',
  })) Deno.env.set(name, value);
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    calls.push(url.pathname.split('/').pop() || '');
    if (url.pathname === '/auth/v1/user') return Response.json({ id: '97000000-0000-4000-8000-000000000002', aud: 'authenticated' });
    if (url.pathname.endsWith('/consume_payment_rate_limit')) return Response.json({ allowed: true });
    if (url.pathname.endsWith('/get_mercadopago_checkout_availability')) {
      if (available === 'error') return Response.json({ message: 'boom' }, { status: 500 });
      return Response.json({ available, environment: 'test', checkout_mode: 'checkout_pro' });
    }
    if (url.pathname.endsWith('/create_checkout_session')) {
      return Response.json({ checkout_session_id: '97000000-0000-4000-8000-000000000003' });
    }
    throw new Error(`Unexpected test request: ${url.pathname}`);
  };
  try {
    const response = await handle(new Request('https://ucbtjcurawxjwjdvvcvj.supabase.co/functions/v1/mercadopago-create-checkout-session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer fixture-customer-jwt' },
      body: JSON.stringify({ business_id: business, client_request_id: 'fixture-request-0001', items: [], payment_method: 'mercadopago' }),
    }));
    return { status: response.status, body: await response.json(), calls };
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test('a seller that cannot charge never gets a checkout: no stock is reserved', async () => {
  const result = await run(false);
  assertEquals(result.status, 409);
  assertEquals(result.body.code, 'PAYMENTS_NOT_ENABLED');
  assertEquals(result.calls.includes('create_checkout_session'), false);
});

Deno.test('an availability lookup failure fails closed before reserving stock', async () => {
  const result = await run('error');
  assertEquals(result.status, 409);
  assertEquals(result.calls.includes('create_checkout_session'), false);
});

Deno.test('a connected seller keeps the normal checkout path', async () => {
  const result = await run(true);
  assertEquals(result.status, 200);
  assertEquals(result.body.ok, true);
  assertEquals(result.calls.filter((call) => call === 'create_checkout_session').length, 1);
});
