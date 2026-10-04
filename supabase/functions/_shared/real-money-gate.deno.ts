/*
 * EL INTERRUPTOR DE DINERO REAL (EDGE-03), medido.
 *
 *   1. La función pura: sólo con las tres llaves hay dinero real; sólo la
 *      palabra exacta `enabled` abre; en test no se pide; las razones nombran lo
 *      que falta y nunca un valor; y lee el entorno y la revisión igual que
 *      `providerEnvironment()`, para que no se separen.
 *   2. El entorno de prueba no puede mover dinero real ni con el interruptor
 *      puesto: lo impiden la credencial y la cuenta del vendedor, no el
 *      interruptor.
 *   3. LA PLATA QUE VUELVE NO SE TRABA. Con el interruptor apagado en un proyecto
 *      productivo —ausente, en otro valor, o con sólo la frase vieja de humo—
 *      el reembolso, la cancelación, el webhook, el worker y la pantalla de
 *      estado reales siguen funcionando: cerrar el dinero real nunca puede
 *      dejar a un cliente sin su devolución, ni a un pago aprobado sin pedido.
 *
 * El proveedor y la base son siempre de mentira: ninguna llamada sale a la red.
 */
import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1.0.19';
import {
  businessPaymentsEnabled,
  LEGACY_SMOKE_CONFIRMATION,
  REAL_MONEY_SWITCH,
  REAL_MONEY_SWITCH_OPEN_VALUE,
  realMoneyGateState,
  sellerConnected,
} from './real-money-gate.ts';
import { providerEnvironment, readRealMoneyGateState } from './payment-runtime.ts';
import { assertPaymentCreationGate, protect, sellerIdentity, tokenGrant } from './seller-oauth.ts';
import { signPaymentWorkerRequest } from './payment-worker-signature.ts';

// Deno.env es del proceso: lo que esta suite cambia se devuelve como estaba al final.
const TOUCHED = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'MERCADOPAGO_ENVIRONMENT',
  'MERCADOPAGO_OAUTH_ENVIRONMENT', 'MERCADOPAGO_CREDENTIAL_MODE', 'MERCADOPAGO_PRODUCTION_REVIEW_STATUS', 'TABA_DEPLOYMENT_ENV',
  'MERCADOPAGO_OAUTH_PROJECT_REF', 'MERCADOPAGO_CLIENT_ID', 'MERCADOPAGO_CLIENT_SECRET', 'MERCADOPAGO_OAUTH_PANEL_URL',
  'TABA_CHECKOUT_BASE_URL', 'TABA_ALLOWED_ORIGINS', 'PAYMENT_WORKER_SECRET', 'PAYMENT_LOG_HASH_SALT',
  'MERCADOPAGO_OAUTH_WEBHOOK_SECRET', 'MERCADOPAGO_TOKEN_ENCRYPTION_KEY', 'MERCADOPAGO_ACCESS_TOKEN',
  'MERCADOPAGO_REAL_MONEY_ENABLED', 'MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION'];
const ENVIRONMENT_BEFORE = Object.fromEntries(TOUCHED.map((name) => [name, Deno.env.get(name)]));

const handlers: Array<(request: Request) => Promise<Response>> = [];
const serve = Deno.serve;
Deno.serve = ((fn: typeof handlers[number]) => { handlers.push(fn); return {}; }) as typeof Deno.serve;
try {
  await import('../mercadopago-refund/index.ts');
  await import('../mercadopago-cancel-payment/index.ts');
  await import('../mercadopago-webhook/index.ts');
  await import('../mercadopago-payment-worker/index.ts');
  await import('../mercadopago-checkout-status/index.ts');
} finally { Deno.serve = serve; }
const [refundHandler, cancelHandler, webhookHandler, workerHandler, statusHandler] = handlers;

const bid = '98000000-0000-4000-8000-000000000001';
const iid = '98000000-0000-4000-8000-000000000002';
const rid = '98000000-0000-4000-8000-000000000003';
const key = '98000000-0000-4000-8000-000000000004';
const cid = '98000000-0000-4000-8000-000000000005';
const session = '98000000-0000-4000-8000-000000000006';
const owner = '98000000-0000-4000-8000-000000000007';
const CP = 'https://tkanbadcglszlcyfjvpv.supabase.co';
const APPLICATION = '7677852968049976';
const SMOKE_PHRASE = 'I_AUTHORIZE_REAL_MERCADOPAGO_PAYMENT_SMOKE';
// La clave con la que el «proveedor» de la prueba firma el aviso (no es de ningún proyecto).
const SIGNING_KEY = 'fixture-webhook-signing-key';

// ── 1 · La función pura ──────────────────────────────────────────────────────

const day = 86_400_000;
const NOW = Date.parse('2026-10-03T12:00:00Z');
const settingsRow = (environment = 'production', extra: Record<string, unknown> = {}) => ({
  business_id: bid, provider: 'mercadopago', enabled: true, environment, checkout_mode: 'checkout_pro', currency: 'ARS',
  reserve_stock: true, production_review_status: 'approved', collector_id: '123', application_id: APPLICATION, ...extra,
});
const sellerRow = (environment = 'production', extra: Record<string, unknown> = {}) => ({
  business_id: bid, environment, status: 'connected', protected_tokens: 'sealed', seller_id: '123', generation: 'g1',
  refresh_owner: null, expires_at: new Date(NOW + 2 * day).toISOString(), application_id: APPLICATION, ...extra,
});

Deno.test('dinero real sólo con las tres llaves: revisión, comercio con vendedor, interruptor', () => {
  for (const review of [true, false]) {
    for (const realMoney of [true, false]) {
      for (const businessEnabled of [true, false]) {
        for (const sellerReady of [true, false]) {
          const state = realMoneyGateState({
            environment: 'production',
            reviewStatus: review ? 'approved' : undefined,
            realMoneySwitch: realMoney ? REAL_MONEY_SWITCH_OPEN_VALUE : undefined,
            business: {
              businessId: bid, applicationId: APPLICATION, nowMs: NOW,
              settings: settingsRow('production', { enabled: businessEnabled }),
              seller: sellerRow('production', { status: sellerReady ? 'connected' : 'requires_reauthorization' }),
            },
          });
          const label = JSON.stringify({ review, realMoney, businessEnabled, sellerReady });
          assertEquals(state.money_movement_possible, review && realMoney && businessEnabled && sellerReady, label);
          assertEquals(state.creation_allowed, review && realMoney, label);
          assertEquals(state.real_money, review && realMoney, label);
          assertEquals(state.business_enabled, businessEnabled, label);
          assertEquals(state.seller_connected, sellerReady, label);
          assertEquals(state.reasons, [
            ...(review ? [] : ['PRODUCTION_REVIEW_NOT_APPROVED']),
            ...(realMoney ? [] : ['REAL_MONEY_SWITCH_ABSENT']),
            ...(businessEnabled ? [] : ['BUSINESS_PAYMENTS_NOT_ENABLED']),
            ...(sellerReady ? [] : ['SELLER_NOT_CONNECTED']),
          ], label);
        }
      }
    }
  }
});

Deno.test('sólo la palabra exacta `enabled` abre el interruptor', () => {
  assertEquals(REAL_MONEY_SWITCH, 'MERCADOPAGO_REAL_MONEY_ENABLED');
  assertEquals(REAL_MONEY_SWITCH_OPEN_VALUE, 'enabled');
  const open = realMoneyGateState({ environment: 'production', reviewStatus: 'approved', realMoneySwitch: 'enabled' });
  assertEquals([open.real_money_switch, open.creation_allowed, open.real_money, open.reasons], [true, true, true, []]);
  for (const value of [undefined, null, '']) {
    const state = realMoneyGateState({ environment: 'production', reviewStatus: 'approved', realMoneySwitch: value });
    assertEquals([state.real_money_switch, state.creation_allowed, state.reasons], [false, false, ['REAL_MONEY_SWITCH_ABSENT']], String(value));
  }
  for (const value of ['true', 'TRUE', 'ENABLED', 'Enabled', ' enabled', 'enabled ', 'enabled\n', '\tenabled', '1', 'yes', 'on',
    'enable', 'enabled=true', SMOKE_PHRASE]) {
    const state = realMoneyGateState({ environment: 'production', reviewStatus: 'approved', realMoneySwitch: value });
    assertEquals([state.real_money_switch, state.creation_allowed, state.real_money], [false, false, false], JSON.stringify(value));
    assertEquals(state.reasons, ['REAL_MONEY_SWITCH_NOT_ENABLED'], JSON.stringify(value));
  }
});

Deno.test('las razones nombran lo que falta y nunca un valor', () => {
  const valor = 'un-valor-que-no-puede-aparecer-en-ningun-log';
  const state = realMoneyGateState({ environment: 'production', reviewStatus: valor, realMoneySwitch: valor });
  assertEquals(state.reasons, ['PRODUCTION_REVIEW_NOT_APPROVED', 'REAL_MONEY_SWITCH_NOT_ENABLED']);
  assertEquals(JSON.stringify(state).includes(valor), false);
  const invalid = realMoneyGateState({ environment: valor });
  assertEquals(invalid.reasons, ['MERCADOPAGO_ENVIRONMENT_INVALID']);
  assertEquals(JSON.stringify(invalid).includes(valor), false);
});

Deno.test('en test no hay dinero real y el interruptor no se pide ni abre nada', () => {
  for (const realMoneySwitch of [undefined, 'enabled', 'true']) {
    const state = realMoneyGateState({
      environment: 'test', realMoneySwitch,
      business: { businessId: bid, applicationId: APPLICATION, nowMs: NOW, settings: settingsRow('test'), seller: sellerRow('test') },
    });
    assertEquals(state.environment, 'test');
    assertEquals(state.creation_allowed, true, String(realMoneySwitch));
    assertEquals(state.real_money, false, String(realMoneySwitch));
    assertEquals(state.money_movement_possible, false, String(realMoneySwitch));
    assertEquals(state.reasons, ['TEST_ENVIRONMENT']);
  }
  // Un comercio o un vendedor de producción no sirven en un proyecto de prueba.
  const crossed = realMoneyGateState({
    environment: 'test', realMoneySwitch: 'enabled',
    business: { businessId: bid, applicationId: APPLICATION, nowMs: NOW, settings: settingsRow('production'), seller: sellerRow('production') },
  });
  assertEquals([crossed.business_enabled, crossed.seller_connected, crossed.money_movement_possible], [false, false, false]);
});

Deno.test('sin entorno, o con uno que no es test ni production, no se crea nada', () => {
  for (const [environment, reason] of [[undefined, 'MERCADOPAGO_ENVIRONMENT_MISSING'], ['', 'MERCADOPAGO_ENVIRONMENT_MISSING'],
    ['sandbox', 'MERCADOPAGO_ENVIRONMENT_INVALID'], ['prod', 'MERCADOPAGO_ENVIRONMENT_INVALID']] as const) {
    const state = realMoneyGateState({ environment, reviewStatus: 'approved', realMoneySwitch: 'enabled' });
    assertEquals([state.environment, state.creation_allowed, state.real_money, state.reasons], [null, false, false, [reason]]);
  }
});

Deno.test('el comercio y el vendedor se juzgan con los predicados de validatePaymentAuthority', () => {
  const ok = (settings: Record<string, unknown>, seller: Record<string, unknown>) =>
    [businessPaymentsEnabled(settings, bid, 'production'), sellerConnected(seller, settings, bid, 'production', APPLICATION, NOW)];
  assertEquals(ok(settingsRow(), sellerRow()), [true, true]);
  for (const [field, value] of [['enabled', false], ['environment', 'test'], ['checkout_mode', 'checkout_api'], ['currency', 'USD'],
    ['reserve_stock', false], ['production_review_status', 'pending'], ['provider', 'otro'], ['business_id', owner]] as const) {
    assertEquals(businessPaymentsEnabled(settingsRow('production', { [field]: value }), bid, 'production'), false, field);
  }
  for (const [field, value] of [['status', 'disconnected'], ['environment', 'test'], ['protected_tokens', null], ['seller_id', ''],
    ['generation', null], ['refresh_owner', 'otro'], ['expires_at', new Date(NOW - 1).toISOString()], ['application_id', '2691240967769590'],
    ['seller_id', '999'], ['business_id', owner]] as const) {
    assertEquals(sellerConnected(sellerRow('production', { [field]: value }), settingsRow(), bid, 'production', APPLICATION, NOW), false, field);
  }
  // La configuración del comercio tiene que nombrar la misma aplicación y el mismo collector.
  assertEquals(sellerConnected(sellerRow(), settingsRow('production', { application_id: '2691240967769590' }), bid, 'production', APPLICATION, NOW), false);
  assertEquals(sellerConnected(sellerRow(), null, bid, 'production', APPLICATION, NOW), false);
  assertEquals(businessPaymentsEnabled(null, bid, 'production'), false);
  // En test no se pide la revisión productiva del comercio.
  assertEquals(businessPaymentsEnabled(settingsRow('test', { production_review_status: 'not_requested' }), bid, 'test'), true);
});

function setEnvironment(values: Record<string, string | null | undefined>) {
  for (const [name, value] of Object.entries(values)) {
    if (value === null || value === undefined) Deno.env.delete(name);
    else Deno.env.set(name, value);
  }
}

Deno.test('el entorno y la revisión se leen igual que providerEnvironment(): no se pueden separar', () => {
  const previous = { environment: Deno.env.get('MERCADOPAGO_ENVIRONMENT'), review: Deno.env.get('MERCADOPAGO_PRODUCTION_REVIEW_STATUS') };
  try {
    for (const environment of [undefined, '', 'test', 'TEST', ' test ', 'production', 'Production', ' production\n', 'sandbox']) {
      for (const review of [undefined, '', 'approved', ' approved ', 'APPROVED', 'pending']) {
        setEnvironment({ MERCADOPAGO_ENVIRONMENT: environment, MERCADOPAGO_PRODUCTION_REVIEW_STATUS: review });
        const state = realMoneyGateState({ environment, reviewStatus: review, realMoneySwitch: 'enabled' });
        const label = JSON.stringify({ environment, review });
        let read: string | null = null;
        try { read = providerEnvironment(); } catch (_) { read = null; }
        const expected = state.environment === null || (state.environment === 'production' && !state.review_approved)
          ? null : state.environment;
        assertEquals(read, expected, label);
      }
    }
  } finally {
    setEnvironment({ MERCADOPAGO_ENVIRONMENT: previous.environment, MERCADOPAGO_PRODUCTION_REVIEW_STATUS: previous.review });
  }
});

// ── Las variables del proyecto, como las lee la compuerta ────────────────────

/** Un proyecto productivo completo (CONTROLLED_PRODUCTION), con el interruptor como se pida. */
function productionProject(realMoney: Record<string, string | null> = {}) {
  setEnvironment({ [REAL_MONEY_SWITCH]: null, [LEGACY_SMOKE_CONFIRMATION]: null, MERCADOPAGO_ACCESS_TOKEN: null });
  setEnvironment({
    SUPABASE_URL: CP, SUPABASE_SERVICE_ROLE_KEY: 'fixture-service', SUPABASE_ANON_KEY: 'fixture-anon',
    MERCADOPAGO_ENVIRONMENT: 'production', MERCADOPAGO_OAUTH_ENVIRONMENT: 'production', MERCADOPAGO_CREDENTIAL_MODE: 'oauth',
    MERCADOPAGO_PRODUCTION_REVIEW_STATUS: 'approved', TABA_DEPLOYMENT_ENV: 'production',
    MERCADOPAGO_OAUTH_PROJECT_REF: 'tkanbadcglszlcyfjvpv', MERCADOPAGO_CLIENT_ID: APPLICATION,
    MERCADOPAGO_CLIENT_SECRET: 'fixture-client-secret',
    MERCADOPAGO_OAUTH_PANEL_URL: 'https://la-taba-commercial-pilot.pages.dev/',
    TABA_CHECKOUT_BASE_URL: 'https://la-taba-commercial-pilot.pages.dev',
    TABA_ALLOWED_ORIGINS: 'https://la-taba-commercial-pilot.pages.dev',
    PAYMENT_WORKER_SECRET: 'fixture-worker-secret', PAYMENT_LOG_HASH_SALT: 'fixture-log-salt',
    MERCADOPAGO_OAUTH_WEBHOOK_SECRET: SIGNING_KEY,
    MERCADOPAGO_TOKEN_ENCRYPTION_KEY: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
  });
  setEnvironment(realMoney);
}

/** Un proyecto de prueba completo (Staging). */
function stagingProject(realMoney: Record<string, string | null> = {}) {
  setEnvironment({ [REAL_MONEY_SWITCH]: null, [LEGACY_SMOKE_CONFIRMATION]: null, MERCADOPAGO_PRODUCTION_REVIEW_STATUS: null });
  setEnvironment({
    SUPABASE_URL: 'https://ucbtjcurawxjwjdvvcvj.supabase.co', MERCADOPAGO_OAUTH_PROJECT_REF: 'ucbtjcurawxjwjdvvcvj',
    TABA_DEPLOYMENT_ENV: 'staging', MERCADOPAGO_ENVIRONMENT: 'test', MERCADOPAGO_OAUTH_ENVIRONMENT: 'test',
    MERCADOPAGO_CREDENTIAL_MODE: 'oauth', MERCADOPAGO_CLIENT_ID: '2691240967769590', MERCADOPAGO_CLIENT_SECRET: 'fixture-client-secret',
    MERCADOPAGO_OAUTH_PANEL_URL: 'https://taba2-staging.pages.dev/', TABA_CHECKOUT_BASE_URL: 'https://taba2-staging.pages.dev',
    TABA_ALLOWED_ORIGINS: 'https://taba2-staging.pages.dev',
  });
  setEnvironment(realMoney);
}

Deno.test('la compuerta lee el interruptor crudo y no consulta la variable vieja de humo', () => {
  productionProject({ [REAL_MONEY_SWITCH]: 'enabled' });
  assertEquals(readRealMoneyGateState().creation_allowed, true);
  assertEquals(assertPaymentCreationGate().environment, 'production');
  productionProject({ [LEGACY_SMOKE_CONFIRMATION]: SMOKE_PHRASE });
  assertEquals(readRealMoneyGateState().creation_allowed, false);
  assertEquals(readRealMoneyGateState().reasons, ['REAL_MONEY_SWITCH_ABSENT']);
  assertThrows(() => assertPaymentCreationGate(), Error, 'REAL_MONEY_SWITCH_ABSENT');
  productionProject({ [REAL_MONEY_SWITCH]: ' enabled' });
  assertThrows(() => assertPaymentCreationGate(), Error, 'REAL_MONEY_SWITCH_NOT_ENABLED');
  // El motivo del rechazo nombra lo que falta, nunca el valor puesto.
  productionProject({ [REAL_MONEY_SWITCH]: 'valor-que-no-va-al-log' });
  assertThrows(() => assertPaymentCreationGate(), Error, 'Payment creation gate closed: REAL_MONEY_SWITCH_NOT_ENABLED');
  try { assertPaymentCreationGate(); } catch (error) { assertEquals(String(error).includes('valor-que-no-va-al-log'), false); }
  productionProject();
});

// ── 2 · El entorno de prueba no puede mover dinero real ──────────────────────

Deno.test('en test, ni con el interruptor puesto, una credencial real o una cuenta real sirven para cobrar', async () => {
  stagingProject({ [REAL_MONEY_SWITCH]: 'enabled' });
  const state = readRealMoneyGateState();
  assertEquals([state.environment, state.creation_allowed, state.real_money], ['test', true, false]);
  const original = globalThis.fetch;
  try {
    // El proyecto de prueba pide un token de prueba y rechaza uno de dinero real.
    let asked: Record<string, unknown> = {};
    globalThis.fetch = async (_input, options) => {
      asked = JSON.parse(String((options as RequestInit).body));
      return Response.json({ access_token: 'fixture', refresh_token: 'fixture', user_id: 123, expires_in: 3600,
        scope: 'read write offline_access', live_mode: true });
    };
    await assertRejects(() => tokenGrant({ grant_type: 'authorization_code', code: 'fixture' }));
    assertEquals(asked.test_token, true);
    // Y una cuenta de vendedor real (sin `test_user`) no se acepta en un proyecto de prueba.
    globalThis.fetch = async () => Response.json({ id: 123, site_id: 'MLA', tags: ['normal'] });
    await assertRejects(() => sellerIdentity('fixture-token', '123'), Error, 'Seller account environment mismatch');
  } finally {
    globalThis.fetch = original;
    productionProject();
  }
});

Deno.test('un proyecto productivo no se puede declarar de prueba para esquivar el interruptor', () => {
  productionProject({ MERCADOPAGO_ENVIRONMENT: 'test', MERCADOPAGO_OAUTH_ENVIRONMENT: 'test' });
  // El proyecto está atado a producción (DEPLOYMENT_BINDINGS): con otro entorno nada arranca.
  assertThrows(() => assertPaymentCreationGate(), Error, 'OAuth environment mismatch');
  productionProject();
});

// ── 3 · La plata que vuelve no depende del interruptor ───────────────────────
// Un proyecto productivo con la revisión aprobada y el interruptor apagado de
// las tres formas posibles. En cada caso se comprueba primero que el
// interruptor está de verdad cerrado (la compuerta de creación se niega) y
// después que el camino de vuelta hace su llamada al proveedor y asienta.

const SWITCH_OFF: Record<string, Record<string, string | null>> = {
  'sin el interruptor': {},
  'con el interruptor en «true»': { [REAL_MONEY_SWITCH]: 'true' },
  'con sólo la frase vieja de humo': { [LEGACY_SMOKE_CONFIRMATION]: SMOKE_PHRASE },
};

function assertSwitchClosed() {
  assertEquals(readRealMoneyGateState().creation_allowed, false);
  assertThrows(() => assertPaymentCreationGate());
}

const sellerConnection = async () => ({
  business_id: bid, seller_id: '123', application_id: APPLICATION, environment: 'production', status: 'connected',
  protected_tokens: await protect({ access_token: 'fixture-seller-token' }, bid),
  expires_at: new Date(Date.now() + 2 * day).toISOString(), refresh_owner: null, generation: 'fixture-generation',
});

const providerPayment = (status: string, extra: Record<string, unknown> = {}) => ({
  id: 90001, status, status_detail: status === 'approved' ? 'accredited' : status, external_reference: 'fixture-reference',
  collector_id: 123, currency_id: 'ARS', transaction_amount: 100, payment_method_id: 'visa', live_mode: true,
  order: { id: 555 }, date_created: '2026-10-03T11:00:00Z', date_last_updated: '2026-10-03T11:05:00Z', ...extra,
});

async function withFetch<T>(mock: typeof fetch, task: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try { return await task(); } finally { globalThis.fetch = original; }
}

for (const [name, realMoney] of Object.entries(SWITCH_OFF)) {
  Deno.test(`dinero real apagado (${name}): el reembolso sale una vez y se asienta`, async () => {
    productionProject(realMoney);
    assertSwitchClosed();
    const seller = await sellerConnection();
    const local = { id: rid, payment_intent_id: iid, idempotency_key: key, amount: 100,
      requested_at: new Date(Date.now() - 1000).toISOString(), provider_refund_id: null as string | null, status: 'requested' };
    const events: string[] = [], provider: string[] = [];
    const response = await withFetch(async (input, options) => {
      const url = new URL(String(input)), init = options as RequestInit | undefined;
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (url.pathname === '/auth/v1/user') return Response.json({ id: owner, aud: 'authenticated' });
      if (url.pathname.endsWith('/consume_payment_rate_limit')) return Response.json({ allowed: true });
      if (url.pathname.endsWith('/mp_seller_connections')) return Response.json(seller);
      if (url.pathname.endsWith('/payment_intents')) return Response.json({ id: iid, business_id: bid, environment: 'production', provider_payment_id: '90001' });
      if (url.pathname.endsWith('/payment_refunds')) return Response.json(local);
      if (url.pathname.endsWith('/prepare_payment_refund_v2')) {
        return Response.json({ refund_id: rid, idempotency_key: key, provider_payment_id: '90001', amount: 100, full_refund: false, idempotent: false });
      }
      if (url.pathname.endsWith('/record_payment_refund_identity')) {
        events.push('identity'); local.provider_refund_id = body.p_provider_refund_id; return Response.json(true);
      }
      if (url.pathname.endsWith('/record_payment_refund_response_v2')) { events.push(`record:${body.p_status}`); return Response.json({ ok: true }); }
      if (url.pathname.endsWith('/mark_payment_refund_ambiguous')) { events.push('ambiguous'); return Response.json(true); }
      if (url.origin !== 'https://api.mercadopago.com') throw new Error('Unexpected test request: ' + url.pathname);
      provider.push(`${init?.method || 'GET'} ${url.pathname}`);
      assertEquals(new Headers(init?.headers).get('authorization'), 'Bearer fixture-seller-token');
      assertEquals(new Headers(init?.headers).get('x-idempotency-key'), key);
      return Response.json({ id: 10001, payment_id: 90001, amount: 100, status: 'approved', date_created: new Date().toISOString() });
    }, () => refundHandler(new Request(`${CP}/functions/v1/mercadopago-refund`, {
      method: 'POST', headers: { authorization: 'Bearer fixture-owner', 'content-type': 'application/json' },
      body: JSON.stringify({ payment_intent_id: iid, idempotency_key: key, amount: 100,
        confirmation: 'I_UNDERSTAND_THIS_REQUESTS_A_MERCADO_PAGO_REFUND' }),
    })));
    assertEquals(response.status, 200);
    assertEquals((await response.json()).status, 'approved');
    assertEquals(provider, ['POST /v1/payments/90001/refunds']);
    assertEquals(events, ['identity', 'record:approved']);
  });

  Deno.test(`dinero real apagado (${name}): la cancelación de un cobro existente sale una vez y se asienta`, async () => {
    productionProject(realMoney);
    assertSwitchClosed();
    const seller = await sellerConnection();
    const recorded: string[] = [], provider: string[] = [];
    const response = await withFetch(async (input, options) => {
      const url = new URL(String(input)), init = options as RequestInit | undefined;
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (url.pathname === '/auth/v1/user') return Response.json({ id: owner, aud: 'authenticated' });
      if (url.pathname.endsWith('/consume_payment_rate_limit')) return Response.json({ allowed: true });
      if (url.pathname.endsWith('/mp_seller_connections')) return Response.json(seller);
      if (url.pathname.endsWith('/payment_intents')) return Response.json({ id: iid, business_id: bid, environment: 'production', provider_payment_id: '90001' });
      if (url.pathname.endsWith('/prepare_payment_cancellation')) {
        return Response.json({ cancellation_id: cid, idempotency_key: key, provider_payment_id: '90001' });
      }
      if (url.pathname.endsWith('/record_payment_cancellation_response')) {
        recorded.push(String(body.p_status)); return Response.json({ ok: true, payment_intent_id: iid, idempotent: false });
      }
      if (url.pathname.endsWith('/mark_payment_cancellation_ambiguous')) { recorded.push('ambiguous'); return Response.json(true); }
      if (url.origin !== 'https://api.mercadopago.com') throw new Error('Unexpected test request: ' + url.pathname);
      provider.push(`${init?.method || 'GET'} ${url.pathname}`);
      assertEquals(new Headers(init?.headers).get('x-idempotency-key'), key);
      return Response.json({ id: 90001, status: 'cancelled' });
    }, () => cancelHandler(new Request(`${CP}/functions/v1/mercadopago-cancel-payment`, {
      method: 'POST', headers: { authorization: 'Bearer fixture-owner', 'content-type': 'application/json' },
      body: JSON.stringify({ payment_intent_id: iid, idempotency_key: key,
        confirmation: 'I_UNDERSTAND_THIS_REQUESTS_A_MERCADO_PAGO_CANCELLATION' }),
    })));
    assertEquals(response.status, 200);
    assertEquals((await response.json()).status, 'cancelled');
    assertEquals(provider, ['PUT /v1/payments/90001']);
    assertEquals(recorded, ['cancelled']);
  });

  for (const [status, finalize] of [['approved', true], ['refunded', false]] as const) {
    Deno.test(`dinero real apagado (${name}): un aviso firmado de un pago ${status} entra, el worker lo asienta${finalize ? ' y arma el pedido' : ''}`, async () => {
      productionProject(realMoney);
      assertSwitchClosed();
      const seller = await sellerConnection();
      const receipts: Array<Record<string, unknown>> = [];
      const jobs: Array<Record<string, unknown>> = [];
      const snapshots: Array<Record<string, unknown>> = [], provider: string[] = [];
      let finalized = 0, completed = 0;
      const payment = providerPayment(status, status === 'refunded'
        ? { refunds: [{ id: 777001, payment_id: 90001, amount: 100, status: 'approved', date_created: '2026-10-03T11:05:00Z' }] } : {});
      const result = await withFetch(async (input, options) => {
        const url = new URL(String(input)), init = options as RequestInit | undefined;
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        if (url.pathname.endsWith('/consume_payment_rate_limit')) return Response.json({ allowed: true });
        if (url.pathname.endsWith('/mp_seller_connections')) return Response.json(url.searchParams.get('select') === 'business_id' ? [] : seller);
        if (url.pathname.endsWith('/payment_webhook_receipts')) return Response.json({ seller_business_id: bid, environment: 'production' });
        if (url.pathname.endsWith('/payment_intents')) {
          return Response.json({ id: iid, business_id: bid, environment: 'production', provider_payment_id: '90001',
            provider_status: 'approved', external_reference: 'fixture-reference' });
        }
        if (url.pathname.endsWith('/mp_record_seller_webhook')) {
          assertEquals(body.p_business_id, bid);
          assertEquals(body.p_environment, 'production');
          receipts.push(body);
          jobs.push({ id: key, topic: 'payment', resource_id: String(body.p_resource_id), webhook_receipt_id: rid, payment_intent_id: null, attempts: 0 });
          return Response.json({ receipt_id: rid, duplicate: false, queued: true });
        }
        if (url.pathname.endsWith('/claim_payment_outbox_v2')) return Response.json(jobs.splice(0).map((job) => ({ ...job, attempts: 1 })));
        if (url.pathname.endsWith('/start_payment_outbox_job')) return Response.json(true);
        if (url.pathname.endsWith('/complete_payment_outbox_job')) { completed++; return Response.json(true); }
        if (url.pathname.endsWith('/fail_payment_outbox_job')) throw new Error('el trabajo no tenía que fallar: ' + body.p_error_code);
        if (url.pathname.endsWith('/find_payment_intent_by_external_reference')) {
          return Response.json({ payment_intent_id: iid, checkout_session_id: session });
        }
        if (url.pathname.endsWith('/record_mercadopago_payment_snapshot')) {
          snapshots.push(body);
          return Response.json({ ok: true, payment_intent_id: iid, internal_status: status === 'approved' ? 'paid' : 'refunded',
            manual_review_required: false, finalize_required: finalize });
        }
        if (url.pathname.endsWith('/finalize_paid_checkout_session')) { finalized++; return Response.json({ ok: true }); }
        if (url.origin !== 'https://api.mercadopago.com') throw new Error('Unexpected test request: ' + url.pathname);
        provider.push(`${init?.method || 'GET'} ${url.pathname}`);
        if (url.pathname === '/v1/payments/90001') return Response.json(payment);
        if (url.pathname === '/merchant_orders/555') return Response.json({ id: 555, preference_id: 'fixture-preference' });
        throw new Error('Unexpected provider request: ' + url.pathname);
      }, async () => {
        const timestamp = String(Math.floor(Date.now() / 1000));
        const requestId = 'fixture-notification';
        const hmacKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(SIGNING_KEY),
          { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const signature = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey,
          new TextEncoder().encode(`id:90001;request-id:${requestId};ts:${timestamp};`))), (byte) => byte.toString(16).padStart(2, '0')).join('');
        const webhook = await webhookHandler(new Request(`${CP}/functions/v1/mercadopago-webhook?data.id=90001&type=payment`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-request-id': requestId, 'x-signature': `ts=${timestamp},v1=${signature}`,
            'cf-connecting-ip': '203.0.113.7' },
          body: JSON.stringify({ id: 'evt-1', type: 'payment', action: 'payment.updated', data: { id: '90001' }, user_id: 123 }),
        }));
        const workerTimestamp = String(Math.floor(Date.now() / 1000));
        const workerSignature = await signPaymentWorkerRequest('fixture-worker-secret', workerTimestamp, key);
        const worker = await workerHandler(new Request(`${CP}/functions/v1/mercadopago-payment-worker`, { method: 'POST', headers: {
          'x-taba-worker-timestamp': workerTimestamp, 'x-taba-worker-nonce': key, 'x-taba-worker-signature': workerSignature,
        } }));
        return { webhook: { status: webhook.status, body: await webhook.json() }, worker: { status: worker.status, body: await worker.json() } };
      });
      assertEquals(result.webhook.status, 201);
      assertEquals(result.webhook.body.queued, true);
      assertEquals(receipts.length, 1);
      assertEquals(result.worker.body, { ok: true, claimed: 1, completed: 1, retried: 0 });
      assertEquals(snapshots.length, 1);
      assertEquals((snapshots[0].p_snapshot as Record<string, unknown>).status, status);
      assertEquals((snapshots[0].p_snapshot as Record<string, unknown>).live_mode, true);
      assertEquals(finalized, finalize ? 1 : 0, 'un pago aprobado después de cerrar el interruptor igual tiene su pedido');
      assertEquals(completed, 1);
      // Ni el webhook ni el worker le escriben al proveedor: sólo leen.
      assertEquals(provider.every((call) => call.startsWith('GET ')), true);
    });
  }

  Deno.test(`dinero real apagado (${name}): el worker concilia un reembolso dudoso por su identidad`, async () => {
    productionProject(realMoney);
    assertSwitchClosed();
    const seller = await sellerConnection();
    const local = { id: rid, payment_intent_id: iid, idempotency_key: key, amount: 100,
      requested_at: new Date(Date.now() - 1000).toISOString(), provider_refund_id: '10001', status: 'ambiguous' };
    const recordings: string[] = [], provider: string[] = [];
    let failed = 0;
    const worker = await withFetch(async (input, options) => {
      const url = new URL(String(input)), init = options as RequestInit | undefined;
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (url.pathname.endsWith('/consume_payment_rate_limit')) return Response.json({ allowed: true });
      if (url.pathname.endsWith('/mp_seller_connections')) return Response.json(url.searchParams.get('select') === 'business_id' ? [] : seller);
      if (url.pathname.endsWith('/payment_intents')) return Response.json({ id: iid, business_id: bid, environment: 'production', provider_payment_id: '90001' });
      if (url.pathname.endsWith('/payment_refunds')) {
        if (url.searchParams.has('payment_intent_id')) return Response.json([]);
        return Response.json(local);
      }
      if (url.pathname.endsWith('/claim_payment_outbox_v2')) {
        return Response.json([{ id: key, payment_intent_id: iid, refund_id: rid, topic: 'refund_reconcile', attempts: 1 }]);
      }
      if (url.pathname.endsWith('/start_payment_outbox_job') || url.pathname.endsWith('/complete_payment_outbox_job')) return Response.json(true);
      if (url.pathname.endsWith('/fail_payment_outbox_job')) { failed++; return Response.json(true); }
      if (url.pathname.endsWith('/record_payment_refund_response_v2')) { recordings.push(String(body.p_status)); return Response.json({ ok: true }); }
      if (url.origin !== 'https://api.mercadopago.com') throw new Error('Unexpected test request: ' + url.pathname);
      provider.push(`${init?.method || 'GET'} ${url.pathname}`);
      return Response.json({ id: 10001, payment_id: 90001, amount: 100, status: 'approved', date_created: new Date().toISOString() });
    }, async () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = await signPaymentWorkerRequest('fixture-worker-secret', timestamp, key);
      const response = await workerHandler(new Request(`${CP}/functions/v1/mercadopago-payment-worker`, { method: 'POST', headers: {
        'x-taba-worker-timestamp': timestamp, 'x-taba-worker-nonce': key, 'x-taba-worker-signature': signature,
      } }));
      return { status: response.status, body: await response.json() };
    });
    assertEquals(worker.body, { ok: true, claimed: 1, completed: 1, retried: 0 });
    assertEquals(failed, 0);
    assertEquals(provider, ['GET /v1/payments/90001/refunds/10001']);
    assertEquals(recordings, ['approved']);
  });

  Deno.test(`dinero real apagado (${name}): la pantalla de estado lee el pago, lo asienta y arma el pedido`, async () => {
    productionProject(realMoney);
    assertSwitchClosed();
    const seller = await sellerConnection();
    const lastKnown = { checkout_session_id: session, status: 'redirected', payment_intent_id: iid };
    const snapshots: Array<Record<string, unknown>> = [];
    let reads = 0, finalized = 0;
    const result = await withFetch(async (input, options) => {
      const url = new URL(String(input)), init = options as RequestInit | undefined;
      if (url.pathname === '/auth/v1/user') return Response.json({ id: owner, aud: 'authenticated' });
      if (url.pathname.endsWith('/consume_payment_rate_limit')) return Response.json({ allowed: true });
      if (url.pathname.endsWith('/get_checkout_session_for_customer')) {
        reads++;
        return Response.json(reads === 1 ? lastKnown : { ...lastKnown, status: 'completed' });
      }
      if (url.pathname.endsWith('/payment_intents')) {
        return Response.json([{ id: iid, external_reference: 'fixture-reference', internal_status: 'redirected', business_id: bid }]);
      }
      if (url.pathname.endsWith('/mp_seller_connections')) return Response.json(seller);
      if (url.pathname.endsWith('/record_mercadopago_payment_snapshot')) {
        snapshots.push(JSON.parse(String(init?.body)));
        return Response.json({ ok: true, payment_intent_id: iid, finalize_required: true });
      }
      if (url.pathname.endsWith('/finalize_paid_checkout_session')) { finalized++; return Response.json({ ok: true }); }
      if (url.origin !== 'https://api.mercadopago.com') throw new Error('Unexpected test request: ' + url.pathname);
      assertEquals(init?.method ?? 'GET', 'GET');
      if (url.pathname === '/v1/payments/search') {
        return Response.json({ results: [{ id: 90001, status: 'approved', external_reference: 'fixture-reference' }] });
      }
      if (url.pathname === '/merchant_orders/555') return Response.json({ id: 555, preference_id: 'fixture-preference' });
      if (url.pathname === '/v1/payments/90001') return Response.json(providerPayment('approved'));
      throw new Error('Unexpected provider request: ' + url.pathname);
    }, async () => {
      const response = await statusHandler(new Request(`${CP}/functions/v1/mercadopago-checkout-status`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer fixture-customer-jwt' },
        body: JSON.stringify({ checkout_session_id: session }),
      }));
      return { status: response.status, body: await response.json() };
    });
    assertEquals(result.status, 200);
    assertEquals(result.body.reconciled, true);
    assertEquals(result.body.checkout.status, 'completed');
    assertEquals(snapshots.length, 1);
    assertEquals(snapshots[0].p_source, 'reconciliation');
    assertEquals(finalized, 1);
  });
}

Deno.test('el entorno del proceso queda como estaba antes de esta suite', () => {
  setEnvironment(ENVIRONMENT_BEFORE);
  for (const name of TOUCHED) assertEquals(Deno.env.get(name), ENVIRONMENT_BEFORE[name], name);
});
