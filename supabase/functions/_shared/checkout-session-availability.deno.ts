import { assertEquals, assertThrows } from 'jsr:@std/assert@1.0.19';
import { assertPaymentCreationGate, protect } from './seller-oauth.ts';

// The real handlers, with Supabase answered by a fixture transport.
const handlers: Array<(request: Request) => Promise<Response>> = [];
const serve = Deno.serve;
Deno.serve = ((handler: unknown) => {
  handlers.push(handler as typeof handlers[number]);
  return {};
}) as typeof Deno.serve;
try {
  await import('../mercadopago-create-checkout-session/index.ts');
  await import('../mercadopago-checkout-status/index.ts');
} finally {
  Deno.serve = serve;
}
const [handle, statusHandle] = handlers;

const business = '97000000-0000-4000-8000-000000000001';
const customer = '97000000-0000-4000-8000-000000000002';
const session = '97000000-0000-4000-8000-000000000003';
const product = '97000000-0000-4000-8000-000000000004';

type Deployment = 'staging' | 'production';
type Scenario = {
  deployment?: Deployment;
  /** Variables a cambiar sobre la configuración completa; `null` la borra. */
  environment?: Record<string, string | null>;
  available?: boolean | 'error';
  availabilityEnvironment?: string;
  /** Respuesta de PostgREST a `create_checkout_session`. */
  creation?: { status?: number; body: unknown };
  payload?: Record<string, unknown>;
  headers?: Record<string, string>;
  user?: string;
  /** Qué responde el cupo según (scope, limit). */
  rateLimit?: (call: RateLimitCall) => { status?: number; body: unknown };
};
type RateLimitCall = { p_scope: string; p_subject_hash: string; p_limit: number; p_window_seconds: number };

// Las dos configuraciones completas de despliegue. La función lee ahora el mismo
// conjunto que `mercadopago-create-preference`, así que cada prueba lo fija
// entero: lo que otra suite haya dejado en el proceso no decide nada acá.
const DEPLOYMENTS: Record<Deployment, { host: string; variables: Record<string, string> }> = {
  staging: {
    host: 'https://ucbtjcurawxjwjdvvcvj.supabase.co',
    variables: {
      SUPABASE_URL: 'https://ucbtjcurawxjwjdvvcvj.supabase.co', MERCADOPAGO_OAUTH_PROJECT_REF: 'ucbtjcurawxjwjdvvcvj',
      TABA_DEPLOYMENT_ENV: 'staging', MERCADOPAGO_ENVIRONMENT: 'test', MERCADOPAGO_OAUTH_ENVIRONMENT: 'test',
      MERCADOPAGO_CLIENT_ID: '2691240967769590', MERCADOPAGO_OAUTH_PANEL_URL: 'https://taba2-staging.pages.dev/',
      TABA_CHECKOUT_BASE_URL: 'https://taba2-staging.pages.dev', TABA_ALLOWED_ORIGINS: 'https://taba2-staging.pages.dev',
    },
  },
  production: {
    host: 'https://wwcpogltfgzgkrlilbcd.supabase.co',
    variables: {
      SUPABASE_URL: 'https://wwcpogltfgzgkrlilbcd.supabase.co', MERCADOPAGO_OAUTH_PROJECT_REF: 'wwcpogltfgzgkrlilbcd',
      TABA_DEPLOYMENT_ENV: 'production', MERCADOPAGO_ENVIRONMENT: 'production', MERCADOPAGO_OAUTH_ENVIRONMENT: 'production',
      MERCADOPAGO_CLIENT_ID: '7677852968049976', MERCADOPAGO_OAUTH_PANEL_URL: 'https://la-taba.pages.dev/',
      TABA_CHECKOUT_BASE_URL: 'https://la-taba.pages.dev', TABA_ALLOWED_ORIGINS: 'https://la-taba.pages.dev',
      MERCADOPAGO_PRODUCTION_REVIEW_STATUS: 'approved',
      MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION: 'I_AUTHORIZE_REAL_MERCADOPAGO_PAYMENT_SMOKE',
    },
  },
};

function configure(deployment: Deployment, overrides: Record<string, string | null> = {}) {
  for (const name of ['MERCADOPAGO_PRODUCTION_REVIEW_STATUS', 'MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION']) Deno.env.delete(name);
  for (const [name, value] of Object.entries({
    SUPABASE_SERVICE_ROLE_KEY: 'fixture-service', SUPABASE_ANON_KEY: 'fixture-anon',
    PAYMENT_LOG_HASH_SALT: 'fixture-log-salt', MERCADOPAGO_CREDENTIAL_MODE: 'oauth',
    MERCADOPAGO_TOKEN_ENCRYPTION_KEY: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
    ...DEPLOYMENTS[deployment].variables,
  })) Deno.env.set(name, value);
  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) Deno.env.delete(name);
    else Deno.env.set(name, value);
  }
}

async function run(scenario: Scenario = {}) {
  const deployment = scenario.deployment || 'staging';
  configure(deployment, scenario.environment);
  const calls: string[] = [], rateLimits: RateLimitCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const init = options as RequestInit | undefined;
    calls.push(url.pathname.split('/').pop() || '');
    if (url.pathname === '/auth/v1/user') return Response.json({ id: scenario.user || customer, aud: 'authenticated' });
    if (url.pathname.endsWith('/consume_payment_rate_limit')) {
      const call = JSON.parse(String(init?.body)) as RateLimitCall;
      rateLimits.push(call);
      const answer = scenario.rateLimit ? scenario.rateLimit(call) : { body: { allowed: true } };
      return Response.json(answer.body, { status: answer.status || 200 });
    }
    if (url.pathname.endsWith('/get_mercadopago_checkout_availability')) {
      if (scenario.available === 'error') return Response.json({ message: 'boom' }, { status: 500 });
      return Response.json({
        available: scenario.available ?? true,
        environment: scenario.availabilityEnvironment || DEPLOYMENTS[deployment].variables.MERCADOPAGO_ENVIRONMENT,
        checkout_mode: 'checkout_pro', allow_offline_payment_methods: false, installments_limit: 3,
      });
    }
    if (url.pathname.endsWith('/create_checkout_session')) {
      const answer = scenario.creation || { body: { checkout_session_id: session } };
      return Response.json(answer.body, { status: answer.status || 200 });
    }
    throw new Error(`Unexpected test request: ${url.pathname}`);
  };
  try {
    const response = await handle(new Request(`${DEPLOYMENTS[deployment].host}/functions/v1/mercadopago-create-checkout-session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer fixture-customer-jwt', ...(scenario.headers || {}) },
      body: JSON.stringify({
        business_id: business, client_request_id: 'fixture-request-0001', items: [], payment_method: 'mercadopago',
        ...(scenario.payload || {}),
      }),
    }));
    const text = await response.text();
    return { status: response.status, body: JSON.parse(text), text, calls, rateLimits };
  } finally {
    globalThis.fetch = original;
    configure('staging');
  }
}

const reservations = (result: { calls: string[] }) => result.calls.filter((call) => call === 'create_checkout_session').length;

Deno.test('a seller that cannot charge never gets a checkout: no stock is reserved', async () => {
  const result = await run({ available: false });
  assertEquals(result.status, 409);
  assertEquals(result.body.code, 'PAYMENTS_NOT_ENABLED');
  assertEquals(result.calls.includes('create_checkout_session'), false);
});

Deno.test('an availability lookup failure fails closed before reserving stock', async () => {
  const result = await run({ available: 'error' });
  assertEquals(result.status, 409);
  assertEquals(result.calls.includes('create_checkout_session'), false);
});

Deno.test('a connected seller keeps the normal checkout path', async () => {
  const result = await run({ available: true });
  assertEquals(result.status, 200);
  assertEquals(result.body.ok, true);
  assertEquals(result.calls.filter((call) => call === 'create_checkout_session').length, 1);
});

// ── EDGE-03: la compuerta de la preferencia se evalúa ANTES de reservar ──────
// Con la compuerta de producción cerrada la sesión se creaba igual, el stock
// quedaba reservado quince minutos y recién la preferencia respondía que no.

const gateClosed: Record<string, { deployment: Deployment; environment: Record<string, string | null> }> = {
  'producción sin la autorización de cobro real': {
    deployment: 'production', environment: { MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION: null },
  },
  'producción con otra frase de autorización': {
    deployment: 'production', environment: { MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION: 'yes' },
  },
  'producción sin revisión aprobada': {
    deployment: 'production', environment: { MERCADOPAGO_PRODUCTION_REVIEW_STATUS: 'pending' },
  },
  'sin modo de credencial del vendedor': {
    deployment: 'staging', environment: { MERCADOPAGO_CREDENTIAL_MODE: null },
  },
  'con la aplicación de otro despliegue': {
    deployment: 'staging', environment: { MERCADOPAGO_CLIENT_ID: '7677852968049976' },
  },
  'sin entorno de pagos configurado': {
    deployment: 'staging', environment: { MERCADOPAGO_ENVIRONMENT: null },
  },
};

for (const [name, closed] of Object.entries(gateClosed)) {
  Deno.test(`EDGE-03: ${name} no se crea la sesión ni se reserva stock`, async () => {
    const result = await run({ ...closed, available: true });
    assertEquals(result.status, 409);
    assertEquals(result.body, {
      ok: false,
      code: 'PAYMENTS_NOT_ENABLED',
      message: 'Mercado Pago no está disponible para este comercio en este momento.',
    });
    assertEquals(reservations(result), 0);
    // Es la MISMA compuerta que evalúa la preferencia: con esta configuración
    // `mercadopago-create-preference` tampoco habría emitido nada.
    configure(closed.deployment, closed.environment);
    assertThrows(() => assertPaymentCreationGate());
    configure('staging');
  });
}

Deno.test('EDGE-03: producción con la compuerta abierta sigue igual (no se afloja ni se endurece nada)', async () => {
  const result = await run({ deployment: 'production' });
  assertEquals(result.status, 200);
  assertEquals(result.body, { ok: true, checkout: { checkout_session_id: session } });
  assertEquals(reservations(result), 1);
});

Deno.test('EDGE-03: el entorno de prueba no cambia', async () => {
  const result = await run({ deployment: 'staging' });
  assertEquals(result.status, 200);
  assertEquals(reservations(result), 1);
});

Deno.test('EDGE-03: si la configuración del negocio es de otro entorno, tampoco se reserva', async () => {
  // La preferencia rechaza «environment does not match payment settings».
  const result = await run({ deployment: 'staging', availabilityEnvironment: 'production' });
  assertEquals(result.status, 409);
  assertEquals(result.body.code, 'PAYMENTS_NOT_ENABLED');
  assertEquals(reservations(result), 0);
});

Deno.test('EDGE-03: la pregunta de disponibilidad responde con la misma compuerta, sin crear nada', async () => {
  const open = await run({ payload: { availability_only: true } });
  assertEquals(open.status, 200);
  assertEquals(open.body, { ok: true, availability: { available: true, environment: 'test', checkout_mode: 'checkout_pro',
    allow_offline_payment_methods: false, installments_limit: 3 } });
  assertEquals(reservations(open), 0);

  const closed = await run({ deployment: 'production', environment: { MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION: null },
    payload: { availability_only: true } });
  assertEquals(closed.status, 200);
  assertEquals(closed.body.availability.available, false);
  assertEquals(reservations(closed), 0);

  const sellerless = await run({ available: false, payload: { availability_only: true } });
  assertEquals(sellerless.body.availability.available, false);
  assertEquals(reservations(sellerless), 0);

  // No gasta el cupo de crear checkouts: es una consulta, como la de estado.
  assertEquals(open.rateLimits.every((call) => call.p_scope === 'checkout_status'), true);
});

// ── CS-06 / F-04: el rechazo de la base llega con su motivo, no con su texto ──

const refusals: Array<[string, { status: number; body: Record<string, unknown> }, number, Record<string, unknown>]> = [
  ['comercio cerrado',
    { status: 400, body: { code: '55000', message: 'BUSINESS_CLOSED', details: 'el comercio no esta abierto para este canal', hint: 'reintentar dentro del horario de atencion' } },
    409, { code: 'BUSINESS_CLOSED' }],
  ['ventana de alcohol cerrada',
    { status: 400, body: { code: '55000', message: 'ALCOHOL_WINDOW_CLOSED', details: 'la venta de alcohol esta fuera de la ventana configurada', hint: null } },
    409, { code: 'ALCOHOL_WINDOW_CLOSED' }],
  ['alcohol fuera del horario general',
    { status: 400, body: { code: '55000', message: 'venta de alcohol fuera de horario', details: null, hint: null } },
    409, { code: 'ALCOHOL_WINDOW_CLOSED' }],
  ['fuera de la zona de envío',
    { status: 400, body: { code: '55000', message: 'OUT_OF_DELIVERY_ZONE', details: 'la direccion no esta dentro de la cobertura declarada', hint: 'ofrecer retiro en el local' } },
    409, { code: 'OUT_OF_DELIVERY_ZONE' }],
  ['falta confirmar la ubicación',
    { status: 400, body: { code: '22023', message: 'DELIVERY_LOCATION_REQUIRED', details: 'la entrega necesita un punto confirmado por el cliente', hint: 'confirmar la ubicacion en el mapa antes de pagar' } },
    409, { code: 'DELIVERY_LOCATION_REQUIRED' }],
  ['debajo del mínimo de envío',
    { status: 400, body: { code: '23514', message: 'configuracion o minimo de delivery no valido', details: null, hint: null } },
    409, { code: 'BELOW_MINIMUM' }],
  ['sin stock, con el producto',
    { status: 400, body: { code: '23514', message: `stock insuficiente para producto: ${product}`, details: null, hint: null } },
    409, { code: 'OUT_OF_STOCK', product_id: product }],
  ['pedido demasiado grande',
    { status: 400, body: { code: '22023', message: 'ORDER_TOO_LARGE', details: 'un pedido sin cobrar acepta hasta 60 unidades', hint: 'reducir las cantidades o coordinar el pedido con el comercio' } },
    409, { code: 'ORDER_TOO_LARGE' }],
  ['freno de la base respondido por PostgREST como 429',
    { status: 429, body: { code: '54000', message: 'demasiados intentos de checkout; reintenta mas tarde', details: 'customer_rate', hint: 'reintentar en 420 segundos' } },
    429, { code: 'RATE_LIMITED', retry_after_seconds: 420 }],
  ['freno de la base levantado como excepción',
    { status: 400, body: { code: '54000', message: 'demasiados intentos de checkout; reintenta mas tarde', details: null, hint: null } },
    429, { code: 'RATE_LIMITED' }],
  ['misma solicitud con otro carrito',
    { status: 409, body: { code: '23505', message: 'client_request_id reutilizado con un checkout diferente', details: null, hint: null } },
    409, { code: 'IDEMPOTENCY_CONFLICT' }],
];

for (const [name, creation, status, expected] of refusals) {
  Deno.test(`CS-06: ${name} → ${expected.code}`, async () => {
    const result = await run({ creation });
    assertEquals(result.status, status);
    assertEquals(result.body.ok, false);
    for (const [field, value] of Object.entries(expected)) assertEquals(result.body[field], value, field);
    assertEquals(typeof result.body.message, 'string');
    // Sólo las claves públicas; ni el mensaje, ni el detalle, ni la pista de la base.
    assertEquals(Object.keys(result.body).sort(), ['code', 'message', 'ok', ...Object.keys(expected).filter((field) => field !== 'code')].sort());
    for (const raw of [creation.body.message, creation.body.details, creation.body.hint]) {
      if (typeof raw === 'string' && raw !== expected.code) assertEquals(result.text.includes(raw), false, `se reenvió «${raw}»`);
    }
  });
}

// La base levanta ESE texto por tres razones y sólo una es del cliente (el
// carrito no llega al mínimo); las otras dos son del comercio (la zona no tiene
// costo de envío cargado, o no tiene mínimo). Decirle al cliente «no alcanza el
// mínimo» como un hecho lo mandaba a sumar productos que no iban a cambiar nada.
Deno.test('CS-06: el rechazo del mínimo no afirma lo que la base no distingue', async () => {
  const result = await run({ creation: { status: 400, body: { code: '23514', message: 'configuracion o minimo de delivery no valido', details: null, hint: null } } });
  assertEquals(result.body.code, 'BELOW_MINIMUM');
  const message = String(result.body.message);
  assertEquals(/no alcanza el mínimo/i.test(message), false, message);
  assertEquals(/puede que/i.test(message) && /retiro en el local/i.test(message), true, message);
});

for (const [name, body] of Object.entries({
  'un rechazo que no está en la lista': { code: '55000', message: 'negocio no habilitado para pagos online' },
  'un identificador conocido con otro SQLSTATE': { code: '22023', message: 'BUSINESS_CLOSED' },
  'un texto parecido al de stock, sin un producto': { code: '23514', message: 'stock insuficiente para producto: <script>' },
  'un error sin código': { message: 'OUT_OF_DELIVERY_ZONE' },
  'una caída de la base': { code: 'XX000', message: 'internal error at 10.0.0.5' },
} as Record<string, Record<string, unknown>>)) {
  Deno.test(`CS-06: ${name} conserva el código genérico`, async () => {
    const result = await run({ creation: { status: 400, body: { details: null, hint: null, ...body } } });
    assertEquals(result.status, 409);
    assertEquals(result.body, {
      ok: false,
      code: 'CHECKOUT_NOT_AVAILABLE',
      message: 'No podemos preparar este pago. Revisá el carrito y volvé a intentar.',
    });
  });
}

Deno.test('CS-06: una respuesta 200 que no trae una sesión no se entrega como checkout', async () => {
  const blocked = await run({ creation: { body: { code: '54000', message: 'demasiados intentos de checkout; reintenta mas tarde', details: 'customer_pending', hint: 'esperar a que el comercio confirme los pedidos anteriores' } } });
  assertEquals(blocked.status, 429);
  assertEquals(blocked.body.code, 'RATE_LIMITED');
  const empty = await run({ creation: { body: { unexpected: true } } });
  assertEquals(empty.status, 409);
  assertEquals(empty.body.code, 'CHECKOUT_NOT_AVAILABLE');
});

// ── EDGE-05 / F5: dos cupos independientes, por persona y por dirección ──────

const bucket = (result: { rateLimits: RateLimitCall[] }, limit: number) =>
  result.rateLimits.filter((call) => call.p_limit === limit).map((call) => call.p_subject_hash);

Deno.test('EDGE-05: cada pedido gasta un cupo por persona y otro, más grande, por dirección', async () => {
  const result = await run({ headers: { 'cf-connecting-ip': '203.0.113.7' } });
  assertEquals(result.rateLimits.map((call) => [call.p_scope, call.p_limit, call.p_window_seconds]).sort(),
    [['checkout_session', 12, 600], ['checkout_session', 60, 600]]);
  assertEquals(new Set(result.rateLimits.map((call) => call.p_subject_hash)).size, 2);
});

Deno.test('EDGE-05: cambiar de dirección no le estrena el cupo a la misma persona', async () => {
  const first = await run({ headers: { 'cf-connecting-ip': '203.0.113.7' } });
  const second = await run({ headers: { 'cf-connecting-ip': '198.51.100.9' } });
  assertEquals(bucket(first, 12), bucket(second, 12));
  assertEquals(bucket(first, 60)[0] === bucket(second, 60)[0], false);
});

Deno.test('EDGE-05: un x-forwarded-for inventado no cambia ningún cupo', async () => {
  const honest = await run({ headers: { 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '203.0.113.7, 10.0.0.1' } });
  const forged = await run({ headers: { 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '192.0.2.55, 10.0.0.1', 'sb-forwarded-for': '192.0.2.56' } });
  assertEquals(bucket(honest, 12), bucket(forged, 12));
  assertEquals(bucket(honest, 60), bucket(forged, 60));
});

Deno.test('EDGE-05: otra persona desde la misma dirección comparte sólo el cupo de la dirección', async () => {
  const first = await run({ headers: { 'cf-connecting-ip': '203.0.113.7' } });
  const second = await run({ headers: { 'cf-connecting-ip': '203.0.113.7' }, user: '97000000-0000-4000-8000-000000000009' });
  assertEquals(bucket(first, 60), bucket(second, 60));
  assertEquals(bucket(first, 12)[0] === bucket(second, 12)[0], false);
});

Deno.test('EDGE-05: sin dirección conocida no se arma un cupo común para todos', async () => {
  const result = await run({});
  assertEquals(result.rateLimits.map((call) => call.p_limit), [12]);
  assertEquals(result.status, 200);
});

for (const [name, exhausted] of Object.entries({ 'el de la persona': 12, 'el de la dirección': 60 })) {
  Deno.test(`EDGE-05: agotado ${name}, responde 429 y no reserva`, async () => {
    const result = await run({
      headers: { 'cf-connecting-ip': '203.0.113.7' },
      rateLimit: (call) => ({ body: { allowed: call.p_limit !== exhausted } }),
    });
    assertEquals(result.status, 429);
    assertEquals(result.body.code, 'RATE_LIMITED');
    assertEquals(reservations(result), 0);
  });
}

Deno.test('EDGE-05: si el cupo no se puede consultar, se cierra (429) y no reserva', async () => {
  const result = await run({
    headers: { 'cf-connecting-ip': '203.0.113.7' },
    rateLimit: (call) => (call.p_limit === 60 ? { status: 500, body: { message: 'boom' } } : { body: { allowed: true } }),
  });
  assertEquals(result.status, 429);
  assertEquals(reservations(result), 0);
});

// ── La pantalla de estado del cliente (mercadopago-checkout-status) ──────────
// También lee el pago del proveedor y lo asienta, así que tiene el mismo
// cuidado que el worker: una lectura fallida no puede terminar escrita.

const intentId = '97000000-0000-4000-8000-000000000005';
type StatusScript = {
  internalStatus?: string;
  search?: { status?: number; body: unknown };
  payments?: Record<string, Record<string, unknown>>;
  merchantOrder?: { status?: number; body: unknown };
  snapshotResult?: { status?: number; body: unknown };
};

async function pollStatus(script: StatusScript) {
  configure('staging');
  const seller = { business_id: business, environment: 'test', status: 'connected',
    protected_tokens: await protect({ access_token: 'fixture-seller-token' }, business),
    expires_at: new Date(Date.now() + 172800000).toISOString(), refresh_owner: null };
  const lastKnown = { checkout_session_id: session, status: 'redirected', payment_intent_id: intentId };
  const snapshots: Array<{ p_snapshot: Record<string, unknown>; p_source: string }> = [];
  const providerRequests: string[] = [];
  let finalized = 0, reads = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const init = options as RequestInit | undefined;
    if (url.pathname === '/auth/v1/user') return Response.json({ id: customer, aud: 'authenticated' });
    if (url.pathname.endsWith('/consume_payment_rate_limit')) return Response.json({ allowed: true });
    if (url.pathname.endsWith('/get_checkout_session_for_customer')) {
      reads++;
      return Response.json(reads === 1 ? lastKnown : { ...lastKnown, status: 'completed' });
    }
    if (url.pathname.endsWith('/payment_intents')) {
      return Response.json([{ id: intentId, external_reference: 'fixture-reference',
        internal_status: script.internalStatus || 'redirected', business_id: business }]);
    }
    if (url.pathname.endsWith('/mp_seller_connections')) return Response.json(seller);
    if (url.pathname.endsWith('/record_mercadopago_payment_snapshot')) {
      snapshots.push(JSON.parse(String(init?.body)));
      const answer = script.snapshotResult || { body: { ok: true, payment_intent_id: intentId, finalize_required: true } };
      return Response.json(answer.body, { status: answer.status || 200 });
    }
    if (url.pathname.endsWith('/finalize_paid_checkout_session')) { finalized++; return Response.json({ ok: true }); }
    if (url.origin !== 'https://api.mercadopago.com') throw new Error(`Unexpected test request: ${url.pathname}`);
    providerRequests.push(url.pathname);
    if (url.pathname === '/v1/payments/search') {
      const answer = script.search || { body: { results: [{ id: 90001, status: 'approved', external_reference: 'fixture-reference' }] } };
      return Response.json(answer.body, { status: answer.status || 200 });
    }
    if (url.pathname.startsWith('/merchant_orders/')) {
      const answer = script.merchantOrder || { body: { id: 555, preference_id: 'fixture-preference' } };
      return Response.json(answer.body, { status: answer.status || 200 });
    }
    const payment = (script.payments || { '90001': { id: 90001, status: 'approved', external_reference: 'fixture-reference',
      collector_id: 123, currency_id: 'ARS', transaction_amount: 100, live_mode: false, order: { id: 555 } } })[url.pathname.replace('/v1/payments/', '')];
    if (payment) return Response.json(payment);
    throw new Error(`Unexpected provider request: ${url.pathname}`);
  };
  try {
    const response = await statusHandle(new Request(`${DEPLOYMENTS.staging.host}/functions/v1/mercadopago-checkout-status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer fixture-customer-jwt' },
      body: JSON.stringify({ checkout_session_id: session }),
    }));
    return { status: response.status, body: await response.json(), snapshots, providerRequests, finalized };
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test('estado del checkout: un pago aprobado se asienta con su preferencia y arma el pedido', async () => {
  const result = await pollStatus({});
  assertEquals(result.status, 200);
  assertEquals(result.body.reconciled, true);
  assertEquals(result.body.checkout.status, 'completed');
  assertEquals(result.snapshots.length, 1);
  assertEquals(result.snapshots[0].p_snapshot.preference_id, 'fixture-preference');
  assertEquals(result.snapshots[0].p_source, 'reconciliation');
  assertEquals(result.finalized, 1);
});

for (const status of [429, 500]) {
  Deno.test(`EDGE-01 estado del checkout: orden del proveedor en ${status} no asienta nada y responde el último estado conocido`, async () => {
    const result = await pollStatus({ merchantOrder: { status, body: { message: 'provider unavailable' } } });
    assertEquals(result.status, 200);
    assertEquals(result.body, { ok: true, checkout: { checkout_session_id: session, status: 'redirected', payment_intent_id: intentId } });
    assertEquals(result.snapshots, []);
    assertEquals(result.finalized, 0);
  });
}

Deno.test('estado del checkout: si la búsqueda del pago falla, responde el último estado conocido', async () => {
  const result = await pollStatus({ search: { status: 503, body: { message: 'provider unavailable' } } });
  assertEquals(result.status, 200);
  assertEquals(result.body.reconciled, undefined);
  assertEquals(result.snapshots, []);
});

Deno.test('estado del checkout: sin ningún pago en el proveedor no se asienta nada', async () => {
  const result = await pollStatus({ search: { body: { results: [] } } });
  assertEquals(result.status, 200);
  assertEquals(result.snapshots, []);
});

Deno.test('estado del checkout: de un rechazado y un aprobado de la misma referencia se asienta el aprobado', async () => {
  const result = await pollStatus({
    search: { body: { results: [{ id: 90002, status: 'rejected', external_reference: 'fixture-reference' },
      { id: 90001, status: 'approved', external_reference: 'fixture-reference' }] } },
  });
  assertEquals(result.snapshots.map((row) => row.p_snapshot.provider_payment_id), ['90001']);
});

for (const internalStatus of ['completed', 'refunded', 'charged_back', 'security_review_required']) {
  Deno.test(`estado del checkout: un cobro ${internalStatus} no vuelve a consultar al proveedor`, async () => {
    const result = await pollStatus({ internalStatus });
    assertEquals(result.status, 200);
    assertEquals(result.providerRequests, []);
    assertEquals(result.snapshots, []);
  });
}

Deno.test('estado del checkout: si el asiento falla, la pantalla sigue respondiendo', async () => {
  const result = await pollStatus({ snapshotResult: { status: 400, body: { code: '22023', message: 'snapshot de pago invalido' } } });
  assertEquals(result.status, 200);
  assertEquals(result.body.reconciled, undefined);
  assertEquals(result.finalized, 0);
});
