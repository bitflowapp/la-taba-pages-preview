import { assertEquals } from 'jsr:@std/assert@1.0.19';
import { protect } from './seller-oauth.ts';
import { randomSecret } from './seller-oauth-crypto.ts';

let handle: (request: Request) => Promise<Response>;
const serve = Deno.serve;
Deno.serve = ((handler: unknown) => {
  handle = handler as typeof handle;
  return {};
}) as typeof Deno.serve;
try {
  await import('../mercadopago-webhook/index.ts');
} finally {
  Deno.serve = serve;
}

const business = '92000000-0000-4000-8000-000000000001';
const secret = 'fixture-webhook-signing-key';
async function run(valid: boolean, wrongReference = false) {
  for (const [name, value] of Object.entries({
    SUPABASE_URL: 'https://ukxqbgswjlibmnjemrzd.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture-server-key',
    MERCADOPAGO_ENVIRONMENT: 'test', MERCADOPAGO_OAUTH_ENVIRONMENT: 'test', MERCADOPAGO_CREDENTIAL_MODE: 'oauth',
    TABA_DEPLOYMENT_ENV: 'staging', MERCADOPAGO_OAUTH_PROJECT_REF: 'ukxqbgswjlibmnjemrzd',
    MERCADOPAGO_OAUTH_PANEL_URL: 'https://taba2-staging.pages.dev/', MERCADOPAGO_CLIENT_ID: '2691240967769590',
    TABA_CHECKOUT_BASE_URL: 'https://taba2-staging.pages.dev', TABA_ALLOWED_ORIGINS: 'https://taba2-staging.pages.dev',
    MERCADOPAGO_TOKEN_ENCRYPTION_KEY: randomSecret(), MERCADOPAGO_OAUTH_WEBHOOK_SECRET: secret,
    PAYMENT_LOG_HASH_SALT: 'fixture-log-salt',
  })) Deno.env.set(name, value);
  const row = {
    business_id: business, seller_id: '123', application_id: '2691240967769590', environment: 'test', status: 'connected',
    protected_tokens: await protect({access_token: 'fixture-seller-token'}, business),
    expires_at: new Date(Date.now() + 3 * 86400000).toISOString(), refresh_owner: null,
  };
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`id:987;request-id:fixture-request;ts:${timestamp};`)));
  const hex = Array.from(signature, byte => byte.toString(16).padStart(2, '0')).join('');
  const original = globalThis.fetch;
  const receipts: Record<string, unknown>[] = [];
  let providerCalls = 0, connectionCalls = 0;
  globalThis.fetch = async (request, options) => {
    const url = new URL(String(request));
    const init = options as {headers?: Record<string, string>; body?: unknown} | undefined;
    if (url.pathname.endsWith('/consume_payment_rate_limit')) return Response.json({allowed: true});
    if (url.pathname.endsWith('/mp_seller_connections')) {
      connectionCalls++;
      if (url.searchParams.has('seller_id')) {
        assertEquals(url.searchParams.get('application_id'), 'eq.2691240967769590');
        assertEquals(url.searchParams.get('environment'), 'eq.test');
      }
      return Response.json(row);
    }
    if (url.origin === 'https://api.mercadopago.com') {
      providerCalls++;
      assertEquals(url.pathname, '/v1/payments/987');
      assertEquals(new Headers(init?.headers).get('authorization'), 'Bearer fixture-seller-token');
      return Response.json({id: 987, collector_id: 123, live_mode: false, external_reference: 'server-reference'});
    }
    if (url.pathname.endsWith('/payment_intents')) {
      assertEquals(url.searchParams.get('external_reference'), 'eq.server-reference');
      return Response.json({business_id: wrongReference ? 'different-business' : business, environment: 'test'});
    }
    if (url.pathname.endsWith('/mp_record_seller_webhook') || url.pathname.endsWith('/record_mercadopago_webhook_receipt')) {
      receipts.push(JSON.parse(String(init?.body)));
      return Response.json({receipt_id: 'fixture-receipt', duplicate: false, queued: valid});
    }
    throw new Error('Unexpected test request');
  };
  try {
    const response = await handle(new Request('https://ukxqbgswjlibmnjemrzd.supabase.co/functions/v1/mercadopago-webhook?data.id=987&business_id=ignored-attacker-value', {
      method: 'POST', headers: {'content-type': 'application/json', 'x-request-id': 'fixture-request', 'x-signature': `ts=${timestamp},v1=${valid ? hex : '0'.repeat(64)}`},
      body: JSON.stringify({id: 'fixture-event', type: 'payment', data: {id: '987'}, user_id: 123}),
    }));
    await response.text();
    return {status: response.status, receipts, providerCalls, connectionCalls};
  } finally {
    globalThis.fetch = original;
    Deno.env.delete('MERCADOPAGO_CREDENTIAL_MODE');
  }
}
Deno.test('OAuth webhook validates HMAC and routes a provider-verified payment without trusting business_id', async () => {
  const result = await run(true);
  assertEquals(result.status, 201);
  assertEquals(result.providerCalls, 1);
  assertEquals(result.receipts[0].p_business_id, business);
  assertEquals(result.receipts[0].p_signature_valid, true);
});
Deno.test('OAuth webhook rejects invalid HMAC before seller lookup or provider access', async () => {
  const result = await run(false);
  assertEquals(result.status, 401);
  assertEquals(result.providerCalls, 0);
  assertEquals(result.connectionCalls, 0);
  assertEquals(result.receipts[0].p_signature_valid, false);
});
Deno.test('OAuth webhook cannot queue a verified payment against another business reference', async () => {
  const result = await run(true, true);
  assertEquals(result.status, 503);
  assertEquals(result.receipts.length, 0);
});

// ── EDGE-05: el webhook no escribe por cada pedido sin firma ─────────────────
// Es el único endpoint sin autenticación previa. Antes gastaba un cupo ANTES de
// mirar la firma y guardaba un recibo por cada pedido rechazado: cualquiera
// podía hacer crecer dos tablas sin límite, y con la dirección de Mercado Pago
// escrita en `x-forwarded-for`, agotarle el cupo a las notificaciones reales.

type WebhookAttempt = {
  signed?: boolean;
  eventId?: string;
  headers?: Record<string, string>;
  query?: string;
  secret?: string | null;
  /** El `x-request-id` de la entrega; la firma se calcula con él. Sin esto, el de siempre. */
  requestId?: string;
  /** El `type` del cuerpo; por defecto `payment`. */
  type?: string;
  /** El `data.id` del cuerpo; por defecto el mismo recurso que firma la query. */
  bodyDataId?: string;
  method?: string;
  /** El cuerpo tal cual, cuando no es el JSON de un aviso. */
  rawBody?: string;
};
type WebhookWorld = {
  /** Respuesta del cupo; por defecto hay lugar. */
  rateLimit?: (call: { p_scope: string; p_subject_hash: string; p_limit: number; p_window_seconds: number }) => { status?: number; body: unknown };
  receiptStatus?: number;
  /** Lo que contesta la base al guardar el recibo número `index` (desde 0); por defecto, uno nuevo en la cola. */
  receipt?: (call: Record<string, unknown>, index: number) => Record<string, unknown>;
  /** Estado HTTP de la lectura del pago que confirma de qué comercio es. */
  providerStatus?: number;
};

async function deliver(attempts: WebhookAttempt[], world: WebhookWorld = {}) {
  for (const [name, value] of Object.entries({
    SUPABASE_URL: 'https://ukxqbgswjlibmnjemrzd.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture-server-key',
    MERCADOPAGO_ENVIRONMENT: 'test', MERCADOPAGO_OAUTH_ENVIRONMENT: 'test', MERCADOPAGO_CREDENTIAL_MODE: 'oauth',
    TABA_DEPLOYMENT_ENV: 'staging', MERCADOPAGO_OAUTH_PROJECT_REF: 'ukxqbgswjlibmnjemrzd',
    MERCADOPAGO_OAUTH_PANEL_URL: 'https://taba2-staging.pages.dev/', MERCADOPAGO_CLIENT_ID: '2691240967769590',
    TABA_CHECKOUT_BASE_URL: 'https://taba2-staging.pages.dev', TABA_ALLOWED_ORIGINS: 'https://taba2-staging.pages.dev',
    MERCADOPAGO_TOKEN_ENCRYPTION_KEY: randomSecret(), MERCADOPAGO_OAUTH_WEBHOOK_SECRET: secret,
    PAYMENT_LOG_HASH_SALT: 'fixture-log-salt',
  })) Deno.env.set(name, value);
  const row = {
    business_id: business, seller_id: '123', application_id: '2691240967769590', environment: 'test', status: 'connected',
    protected_tokens: await protect({access_token: 'fixture-seller-token'}, business),
    expires_at: new Date(Date.now() + 3 * 86400000).toISOString(), refresh_owner: null,
  };
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  // La firma cubre el recurso de la query, el x-request-id y el ts. Nada del cuerpo.
  const sign = async (requestId: string) => Array.from(
    new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`id:987;request-id:${requestId};ts:${timestamp};`))),
    byte => byte.toString(16).padStart(2, '0')).join('');
  // Todo lo que queda escrito en la base, en orden.
  const writes: string[] = [];
  const rateLimits: Array<{ p_scope: string; p_subject_hash: string; p_limit: number; p_window_seconds: number }> = [];
  const receipts: Record<string, unknown>[] = [];
  let providerCalls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    const init = options as RequestInit | undefined;
    if (url.pathname.endsWith('/consume_payment_rate_limit')) {
      const call = JSON.parse(String(init?.body));
      rateLimits.push(call);
      writes.push('cupo:' + call.p_scope);
      const answer = world.rateLimit ? world.rateLimit(call) : { body: { allowed: true } };
      return Response.json(answer.body, { status: answer.status || 200 });
    }
    if (url.pathname.endsWith('/mp_seller_connections')) return Response.json(row);
    if (url.origin === 'https://api.mercadopago.com') {
      providerCalls++;
      if (world.providerStatus) return Response.json({ message: 'provider unavailable' }, { status: world.providerStatus });
      return Response.json({id: 987, collector_id: 123, live_mode: false, external_reference: 'server-reference'});
    }
    if (url.pathname.endsWith('/payment_intents')) return Response.json({business_id: business, environment: 'test'});
    if (url.pathname.endsWith('/mp_record_seller_webhook') || url.pathname.endsWith('/record_mercadopago_webhook_receipt')) {
      writes.push('recibo');
      if (world.receiptStatus) return Response.json({ message: 'boom' }, { status: world.receiptStatus });
      const call = JSON.parse(String(init?.body));
      receipts.push(call);
      if (world.receipt) return Response.json(world.receipt(call, receipts.length - 1));
      return Response.json({receipt_id: 'fixture-receipt', duplicate: false, queued: true});
    }
    throw new Error('Unexpected test request: ' + url.pathname);
  };
  try {
    const statuses: number[] = [];
    const bodies: Record<string, unknown>[] = [];
    for (const attempt of attempts) {
      if (attempt.secret === null) Deno.env.delete('MERCADOPAGO_OAUTH_WEBHOOK_SECRET');
      else Deno.env.set('MERCADOPAGO_OAUTH_WEBHOOK_SECRET', attempt.secret ?? secret);
      const requestId = attempt.requestId ?? 'fixture-request';
      const method = attempt.method ?? 'POST';
      const response = await handle(new Request(`https://ukxqbgswjlibmnjemrzd.supabase.co/functions/v1/mercadopago-webhook${attempt.query ?? '?data.id=987'}`, {
        method,
        headers: {'content-type': 'application/json', 'x-request-id': requestId,
          'x-signature': `ts=${timestamp},v1=${attempt.signed ? await sign(requestId) : '0'.repeat(64)}`, ...(attempt.headers || {})},
        body: method === 'GET' ? undefined : attempt.rawBody ?? JSON.stringify({id: attempt.eventId || 'fixture-event',
          type: attempt.type ?? 'payment', data: {id: attempt.bodyDataId ?? '987'}, user_id: 123}),
      }));
      const text = await response.text();
      statuses.push(response.status);
      try { bodies.push(JSON.parse(text)); } catch (_) { bodies.push({}); }
    }
    return {statuses, bodies, writes, rateLimits, receipts, providerCalls};
  } finally {
    globalThis.fetch = original;
    Deno.env.delete('MERCADOPAGO_CREDENTIAL_MODE');
  }
}

const fromMercadoPago = {'cf-connecting-ip': '203.0.113.7'};

// Un cupo de verdad: cuenta por (scope, clave) y deja pasar hasta `p_limit`.
function countingRateLimit(): NonNullable<WebhookWorld['rateLimit']> {
  const counters = new Map<string, number>();
  return (call) => {
    const bucket = `${call.p_scope}:${call.p_subject_hash}`, count = (counters.get(bucket) || 0) + 1;
    counters.set(bucket, count);
    return {body: {allowed: count <= call.p_limit, count, limit: call.p_limit}};
  };
}
// Los cupos que gastó una corrida, agrupados por clave y en orden de aparición.
function buckets(result: {rateLimits: Array<{p_subject_hash: string; p_limit: number}>}) {
  const seen = new Map<string, {limit: number; uses: number}>();
  for (const call of result.rateLimits) {
    const entry = seen.get(call.p_subject_hash) || {limit: call.p_limit, uses: 0};
    entry.uses++;
    seen.set(call.p_subject_hash, entry);
  }
  return [...seen.values()];
}

Deno.test('EDGE-05 webhook: una firma inválida no gasta el cupo de las notificaciones reales', async () => {
  const result = await deliver([{headers: fromMercadoPago}]);
  assertEquals(result.statuses, [401]);
  // Lo único que se escribe son los dos cupos acotados de rechazos (el de todas
  // las direcciones y el de ésta) y, con lugar en los dos, su recibo.
  assertEquals(result.writes, ['cupo:webhook_rejected', 'cupo:webhook_rejected', 'recibo']);
  assertEquals(new Set(result.rateLimits.map((call) => call.p_subject_hash)).size, 2);
  assertEquals(result.receipts[0].p_signature_valid, false);
  assertEquals(result.providerCalls, 0);
});

Deno.test('EDGE-05 webhook: los recibos rechazados de una dirección tienen tope, y el 401 no', async () => {
  const result = await deliver(
    Array.from({length: 60}, (_, index) => ({eventId: `forged-event-${index}`, headers: fromMercadoPago})),
    {rateLimit: countingRateLimit()},
  );
  assertEquals(result.statuses, Array.from({length: 60}, () => 401));
  assertEquals(new Set(result.rateLimits.map((call) => call.p_scope)), new Set(['webhook_rejected']));
  assertEquals(buckets(result).length, 2);
  const [everyAddress, thisAddress] = buckets(result);
  assertEquals(thisAddress.limit < everyAddress.limit, true);
  assertEquals(result.receipts.length, thisAddress.limit);
  assertEquals(thisAddress.limit <= 30, true, `tope de recibos rechazados por dirección: ${thisAddress.limit}`);
});

// La salud del e-commerce marca `webhook_processing` degradado con cinco
// rechazos en la hora y ninguna notificación válida. Mercado Pago reintenta la
// misma notificación varias veces, y cada reintento gasta el cupo sin dejar
// fila nueva: con un tope de cinco, un secreto mal cargado en producción podía
// quedar por debajo del umbral que lo delata.
Deno.test('EDGE-05 webhook: el tope por dirección deja ver un secreto mal cargado aunque el proveedor reintente', async () => {
  // Seis notificaciones distintas, cada una entregada tres veces seguidas.
  const result = await deliver(
    Array.from({length: 18}, (_, index) => ({eventId: `real-notification-${Math.floor(index / 3)}`, headers: fromMercadoPago})),
    {rateLimit: countingRateLimit()},
  );
  assertEquals(result.statuses, Array.from({length: 18}, () => 401));
  const stored = new Set(result.receipts.map((receipt) => receipt.p_webhook_event_id));
  assertEquals(stored.size, 6, 'las seis notificaciones quedan con su recibo: por encima del umbral de cinco');
});

// El tope por dirección acota lo que escribe UNA dirección. Quien tiene muchas
// (un /48 de IPv6 son 65.536 redes /64) estrenaba un cupo y sus recibos con
// cada una: el total por hora no tenía techo.
Deno.test('EDGE-05 webhook: los rechazos de TODAS las direcciones juntas también tienen tope', async () => {
  const result = await deliver(
    Array.from({length: 260}, (_, index) => ({
      eventId: `forged-event-${index}`,
      headers: {'cf-connecting-ip': `198.51.${100 + Math.floor(index / 250)}.${index % 250 + 1}`},
    })),
    {rateLimit: countingRateLimit()},
  );
  assertEquals(result.statuses, Array.from({length: 260}, () => 401));
  const all = buckets(result);
  const everyAddress = all[0];
  assertEquals(everyAddress.uses, 260, 'el cupo común se consulta siempre, y primero');
  assertEquals(everyAddress.limit <= 300, true, `tope de recibos rechazados por hora: ${everyAddress.limit}`);
  // Agotado el cupo común no se escribe nada más: ni el recibo ni el cupo de
  // la dirección nueva.
  assertEquals(result.receipts.length, everyAddress.limit);
  assertEquals(all.length - 1, everyAddress.limit);
  assertEquals(result.writes.length, 260 + 2 * everyAddress.limit);
});

Deno.test('EDGE-05 webhook: si el cupo de rechazos no responde, no se guarda nada y sigue siendo 401', async () => {
  const result = await deliver([{headers: fromMercadoPago}], {rateLimit: () => ({status: 500, body: {message: 'boom'}})});
  assertEquals(result.statuses, [401]);
  assertEquals(result.receipts, []);
  assertEquals(result.writes, ['cupo:webhook_rejected']);
});

Deno.test('EDGE-05 webhook: si el recibo rechazado no se pudo guardar, la respuesta sigue siendo 401', async () => {
  const result = await deliver([{headers: fromMercadoPago}], {receiptStatus: 500});
  assertEquals(result.statuses, [401]);
});

Deno.test('EDGE-05 webhook: sin dirección conocida los rechazos igual tienen un tope (uno solo, compartido)', async () => {
  const result = await deliver([{eventId: 'forged-a'}, {eventId: 'forged-b', headers: {'sb-forwarded-for': '198.51.100.9'}}]);
  assertEquals(result.statuses, [401, 401]);
  assertEquals(result.rateLimits.map((call) => call.p_scope), Array.from({length: 4}, () => 'webhook_rejected'));
  // Los dos pedidos gastan el cupo común y el MISMO cupo «sin dirección».
  assertEquals(buckets(result).map((bucket) => bucket.uses), [2, 2]);
});

Deno.test('EDGE-05 webhook: sin el secreto de firma no se escribe nada antes de fallar', async () => {
  const result = await deliver([{signed: true, headers: fromMercadoPago, secret: null}]);
  assertEquals(result.statuses, [503]);
  assertEquals(result.writes, []);
});

Deno.test('EDGE-05 webhook: un pedido sin recurso es un rechazo más, con el mismo tope', async () => {
  const result = await deliver([{signed: true, headers: fromMercadoPago, query: ''}]);
  assertEquals(result.statuses, [401]);
  assertEquals(result.writes, ['cupo:webhook_rejected', 'cupo:webhook_rejected', 'recibo']);
  assertEquals(result.receipts[0].p_signature_valid, false);
});

Deno.test('EDGE-05 webhook: la firma válida gasta el cupo de su dirección recién después de verificada', async () => {
  const result = await deliver([{signed: true, headers: fromMercadoPago}]);
  assertEquals(result.statuses, [201]);
  assertEquals(result.writes, ['cupo:webhook', 'recibo']);
  assertEquals([result.rateLimits[0].p_limit, result.rateLimits[0].p_window_seconds], [240, 60]);
  assertEquals(result.receipts[0].p_signature_valid, true);
});

Deno.test('EDGE-05 webhook: el cupo es de la dirección real; un x-forwarded-for inventado no lo cambia', async () => {
  const result = await deliver([
    {signed: true, headers: fromMercadoPago},
    {signed: true, headers: {...fromMercadoPago, 'x-forwarded-for': '192.0.2.55, 10.0.0.1'}},
    {signed: true, headers: {'cf-connecting-ip': '198.51.100.9', 'x-forwarded-for': '203.0.113.7'}},
  ]);
  const [honest, forged, other] = result.rateLimits.map((call) => call.p_subject_hash);
  assertEquals(honest, forged);
  assertEquals(honest === other, false);
});

Deno.test('EDGE-05 webhook: con el cupo de la dirección agotado responde 429 sin consultar al proveedor', async () => {
  const result = await deliver([{signed: true, headers: fromMercadoPago}], {rateLimit: () => ({body: {allowed: false}})});
  assertEquals(result.statuses, [429]);
  assertEquals(result.providerCalls, 0);
  assertEquals(result.receipts, []);
});

Deno.test('EDGE-05 webhook: una notificación firmada sin dirección conocida se procesa igual', async () => {
  const result = await deliver([{signed: true}]);
  assertEquals(result.statuses, [201]);
  assertEquals(result.writes, ['recibo']);
});

// ── Lo que el webhook contesta cuando el recibo ya existía ───────────────────
// Mercado Pago reentrega la misma notificación (el mismo id) con otro
// x-request-id y otra firma. La base contesta `duplicate` y la función lo dice
// tal cual, con 201: el aviso está guardado, no hace falta que lo manden otra vez.
Deno.test('webhook: ante un recibo duplicado contesta 201 con duplicate y sin queued, sobre el mismo recibo', async () => {
  const result = await deliver([
    {signed: true, headers: fromMercadoPago, requestId: 'fixture-request-1'},
    {signed: true, headers: fromMercadoPago, requestId: 'fixture-request-2'},
  ], {receipt: (_call, index) => index === 0
    ? {receipt_id: 'fixture-receipt', duplicate: false, queued: true, promoted: false}
    : {receipt_id: 'fixture-receipt', duplicate: true, queued: false, signature_valid: true}});
  assertEquals(result.statuses, [201, 201]);
  assertEquals(result.bodies[0], {ok: true, receipt_id: 'fixture-receipt', duplicate: false, queued: true});
  assertEquals(result.bodies[1], {ok: true, receipt_id: 'fixture-receipt', duplicate: true, queued: false});
  // Las dos entregas llevan la MISMA clave de recibo (id, tipo y recurso) y cada una su x-request-id.
  assertEquals(result.receipts.map((receipt) => [receipt.p_webhook_event_id, receipt.p_event_type, receipt.p_resource_id]),
    [['fixture-event', 'payment', '987'], ['fixture-event', 'payment', '987']]);
  assertEquals(result.receipts.map((receipt) => receipt.p_request_id), ['fixture-request-1', 'fixture-request-2']);
  // Cada entrega se confirma contra el proveedor antes de guardar: no se confía en la anterior.
  assertEquals(result.providerCalls, 2);
});

Deno.test('webhook: un recibo rechazado que la entrega válida promueve se informa duplicate y queued a la vez', async () => {
  const result = await deliver([{signed: true, headers: fromMercadoPago}],
    {receipt: () => ({receipt_id: 'fixture-receipt', duplicate: true, queued: true, promoted: true})});
  assertEquals(result.statuses, [201]);
  assertEquals(result.bodies[0], {ok: true, receipt_id: 'fixture-receipt', duplicate: true, queued: true});
});

// ── RESIDUAL 3: la firma no cubre el id del cuerpo ───────────────────────────
// Firmado: el `data.id` de la query, el x-request-id y el ts. El `id` del
// cuerpo, que forma la clave del recibo, no. Esto es lo que hace el handler con
// una entrega válida repetida, dentro de la ventana de la firma, con otros ids:
// las acepta todas (no tiene con qué distinguirlas) y las manda a la base con
// veintiuna claves distintas. Que de ahí salga UN recibo y UN trabajo lo decide
// la base, que reconoce la entrega por lo que SÍ está firmado (el recurso y el
// x-request-id): 20261002022000, probado en payment_queue_and_receipts_test.sql.
Deno.test('webhook, entrega firmada repetida con otros ids: el handler las acepta todas y cada una llega a la base con otra clave', async () => {
  const result = await deliver([
    {signed: true, headers: fromMercadoPago, eventId: 'evt-original'},
    ...Array.from({length: 20}, (_, index) => ({signed: true, headers: fromMercadoPago, eventId: `evt-forjado-${index}`})),
  ]);
  // La firma es la misma en las 21 (mismo recurso, mismo x-request-id, mismo ts) y vale en las 21.
  assertEquals(result.statuses, Array.from({length: 21}, () => 201));
  assertEquals(result.receipts.length, 21);
  assertEquals(result.receipts.every((receipt) => receipt.p_signature_valid === true), true);
  // 21 ids de evento distintos: con la clave única del recibo sola, 21 recibos y 21 trabajos.
  assertEquals(new Set(result.receipts.map((receipt) => receipt.p_webhook_event_id)).size, 21);
  // Lo que la base usa para reconocerlas como UNA entrega llega intacto e idéntico en las 21.
  assertEquals(new Set(result.receipts.map((receipt) => `${receipt.p_environment}|${receipt.p_resource_id}|${receipt.p_request_id}`)),
    new Set(['test|987|fixture-request']));
  assertEquals(new Set(result.receipts.map((receipt) => receipt.p_business_id)), new Set([business]));
  // El cupo de la dirección se gasta en cada una: es lo único que las acota antes de la base.
  assertEquals(result.rateLimits.filter((call) => call.p_scope === 'webhook').length, 21);
});

Deno.test('webhook, entrega firmada repetida: cuando la base la reconoce, el handler contesta duplicate y lo que la base diga de la cola', async () => {
  const result = await deliver([
    {signed: true, headers: fromMercadoPago, eventId: 'evt-original'},
    {signed: true, headers: fromMercadoPago, eventId: 'evt-forjado-1'},
    {signed: true, headers: fromMercadoPago, eventId: 'evt-forjado-2'},
  ], {receipt: (_call, index) => index === 0
    ? {receipt_id: 'fixture-receipt', duplicate: false, queued: true, promoted: false}
    // Lo que contesta la base desde 20261002022000: el mismo recibo; `queued` sólo si puso a releer su trabajo.
    : {receipt_id: 'fixture-receipt', duplicate: true, queued: index === 2, signature_valid: true, signed_replay: true}});
  assertEquals(result.statuses, [201, 201, 201]);
  assertEquals(result.bodies.map((body) => [body.receipt_id, body.duplicate, body.queued]),
    [['fixture-receipt', false, true], ['fixture-receipt', true, false], ['fixture-receipt', true, true]]);
});

Deno.test('webhook: si el cuerpo trae OTRO data.id que el firmado en la query, la firma no vale (401) y no entra a la cola', async () => {
  const result = await deliver([{signed: true, headers: fromMercadoPago, bodyDataId: '988'}]);
  assertEquals(result.statuses, [401]);
  assertEquals(result.providerCalls, 0);
  assertEquals(result.receipts.map((receipt) => receipt.p_signature_valid), [false]);
});

Deno.test('webhook: una entrega firmada con otro tipo en el cuerpo no fabrica un trabajo de otro tema: se ignora (200) sin recibo', async () => {
  const result = await deliver([
    {signed: true, headers: fromMercadoPago, type: 'chargebacks'},
    {signed: true, headers: fromMercadoPago, type: 'merchant_order'},
    {signed: true, headers: fromMercadoPago, type: 'payment.updated'},
  ]);
  assertEquals(result.statuses, [200, 200, 200]);
  assertEquals(result.bodies, [{ok: true, ignored: true}, {ok: true, ignored: true}, {ok: true, ignored: true}]);
  assertEquals(result.receipts, []);
  assertEquals(result.providerCalls, 0);
  // Lo único que gasta es el cupo de su dirección.
  assertEquals(result.writes, ['cupo:webhook', 'cupo:webhook', 'cupo:webhook']);
});

// ── Firma válida que no deja rastro ──────────────────────────────────────────
Deno.test('webhook: si el proveedor no contesta la lectura que confirma el comercio, responde 503 y no guarda recibo', async () => {
  for (const providerStatus of [429, 500, 404]) {
    const result = await deliver([{signed: true, headers: fromMercadoPago}], {providerStatus});
    assertEquals(result.statuses, [503]);
    assertEquals(result.bodies[0].code, 'PAYMENT_UNAVAILABLE');
    assertEquals(result.providerCalls, 1);
    assertEquals(result.receipts, []);
    assertEquals(result.writes, ['cupo:webhook']);
  }
});

Deno.test('webhook: si el recibo de una entrega válida no se pudo guardar responde 503 (el proveedor reintenta)', async () => {
  const result = await deliver([{signed: true, headers: fromMercadoPago}], {receiptStatus: 500});
  assertEquals(result.statuses, [503]);
  assertEquals(result.receipts, []);
});

// ── Los cortes antes de mirar la firma: nada escrito ─────────────────────────
Deno.test('webhook: sólo POST (405), sólo HTTPS (400), cuerpo acotado (413) y JSON válido (400): ninguno escribe nada', async () => {
  const oversized = JSON.stringify({id: 'fixture-event', type: 'payment', data: {id: '987'}, user_id: 123, relleno: 'a'.repeat(16_000)});
  const result = await deliver([
    {signed: true, headers: fromMercadoPago, method: 'GET'},
    {signed: true, headers: {...fromMercadoPago, 'x-forwarded-proto': 'http'}},
    {signed: true, headers: fromMercadoPago, rawBody: oversized},
    {signed: true, headers: fromMercadoPago, rawBody: '{esto no es json'},
    {signed: true, headers: fromMercadoPago, rawBody: '[1, 2, 3]'},
  ]);
  assertEquals(result.statuses, [405, 400, 413, 400, 400]);
  assertEquals(result.bodies.map((body) => body.code), ['METHOD_NOT_ALLOWED', 'HTTPS_REQUIRED', 'PAYLOAD_TOO_LARGE', 'INVALID_JSON', 'INVALID_PAYLOAD']);
  assertEquals(result.writes, []);
  assertEquals(result.providerCalls, 0);
});
