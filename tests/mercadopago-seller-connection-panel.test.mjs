import assert from 'node:assert/strict';
import test from 'node:test';

import {
  blockingPendingCount,
  SESSION_MIN_REMAINING_MS,
  sellerAccountLabel,
  sessionExpiresAtMs,
  verificationFailure,
} from '../supabase/functions/_shared/seller-connection-panel.ts';
import { readFunctionFailure } from '../js/repositories/function-failure.js';
import { createSupabasePaymentsRepository } from '../js/repositories/supabase-payments-repository.js';

const jwt = (payload) => ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'firma'].join('.');

test('el vencimiento de la sesión se lee del JWT sin confiar en nada más', () => {
  assert.equal(sessionExpiresAtMs(`Bearer ${jwt({ exp: 1_800_000_000 })}`), 1_800_000_000_000);
  for (const value of [null, '', 'Bearer', 'Bearer a.b', `Bearer ${jwt({})}`, `Bearer ${jwt({ exp: 'mañana' })}`, 'Bearer x.###.y']) {
    assert.equal(sessionExpiresAtMs(value), null, String(value));
  }
  // El estado OAuth dura 10 minutos: el margen exigido tiene que superarlo.
  assert.ok(SESSION_MIN_REMAINING_MS > 10 * 60 * 1000);
});

test('sólo lo que necesita a Mercado Pago bloquea la desvinculación', () => {
  assert.equal(blockingPendingCount({ open_payments: 2, refunds_in_progress: 1, cancellations_in_progress: 0, queued_jobs: 4, approved_last_180_days: 90 }), 7);
  assert.equal(blockingPendingCount({ approved_last_180_days: 12 }), 0);
  assert.equal(blockingPendingCount(null), 0);
  assert.equal(blockingPendingCount({ open_payments: -3, queued_jobs: 'x' }), 0);
});

test('una verificación fallida se cuenta con un código, nunca con el mensaje interno', () => {
  const missing = verificationFailure(new Error('Missing required server configuration: MERCADOPAGO_OAUTH_WEBHOOK_SECRET'), 'connected');
  assert.equal(missing.blocking_reason, 'server_configuration_incomplete');
  assert.equal(missing.online_payments_enabled, false);
  assert.doesNotMatch(JSON.stringify(missing), /MERCADOPAGO|SECRET|Missing/);
  assert.equal(verificationFailure(new Error('Seller refresh unavailable'), 'requires_reauthorization').blocking_reason, 'reauthorization_required');
  assert.equal(verificationFailure(new Error('x'), 'disconnected').blocking_reason, 'not_connected');
  // Never linked: the token lookup says «reauthorize», the stored state says «not connected».
  assert.equal(verificationFailure(Object.assign(new Error('x'), { code: 'SELLER_REAUTHORIZATION_REQUIRED' }), 'disconnected').blocking_reason, 'not_connected');
  assert.equal(verificationFailure(Object.assign(new Error('x'), { code: 'SELLER_REAUTHORIZATION_REQUIRED' }), undefined).blocking_reason, 'not_connected');
  assert.equal(verificationFailure(Object.assign(new Error('x'), { code: 'SELLER_REFRESHING' }), 'connected').blocking_reason, 'refreshing');
  assert.equal(verificationFailure(new Error('Seller permissions unavailable'), 'connected').blocking_reason, 'permissions_missing');
  assert.equal(verificationFailure(new Error('timeout'), 'connected').blocking_reason, 'provider_unavailable');
});

test('el nombre de la cuenta vinculada es legible y enmascara el correo', () => {
  assert.equal(sellerAccountLabel({ nickname: 'TESTUSER2708', email: 'test_user_2708@testuser.com', id: 3594962708 }), 'TESTUSER2708 · t•••@testuser.com');
  assert.equal(sellerAccountLabel({ nickname: 'ALMACENLATABA' }), 'ALMACENLATABA');
  assert.equal(sellerAccountLabel({ email: 'walter@gmail.com' }), 'w•••@gmail.com');
  assert.equal(sellerAccountLabel({ email: 'sin-arroba' }), null);
  assert.equal(sellerAccountLabel({}), null);
  assert.ok(sellerAccountLabel({ nickname: 'N'.repeat(500), email: 'a@' + 'b'.repeat(500) + '.com' }).length <= 120);
});

test('el cuerpo de una respuesta no 2xx se recupera de functions.invoke', async () => {
  const response = new Response(JSON.stringify({ ok: false, code: 'RATE_LIMITED', message: 'Demasiados intentos.' }), { status: 429 });
  assert.deepEqual(await readFunctionFailure({ context: response }),
    { code: 'RATE_LIMITED', status: 429, body: { ok: false, code: 'RATE_LIMITED', message: 'Demasiados intentos.' } });
  assert.deepEqual(await readFunctionFailure({ context: new Response('no es json', { status: 502 }) }), { code: '', status: 502, body: null });
  assert.deepEqual(await readFunctionFailure(new Error('red caída')), { code: '', status: 0, body: null });
});

test('conectar renueva la sesión antes y reintenta una vez si el servidor lo pide', async () => {
  const calls = [];
  let refreshes = 0;
  const answers = [
    { data: null, error: { context: new Response(JSON.stringify({ ok: false, code: 'SESSION_REFRESH_REQUIRED' }), { status: 409 }) } },
    { data: { ok: true, authorization_url: 'https://auth.mercadopago.com.ar/authorization?x=1' }, error: null },
  ];
  const client = {
    rpc: async () => ({ data: null, error: null }),
    auth: { refreshSession: async () => { refreshes += 1; return { data: {}, error: null }; } },
    functions: { invoke: async (name, { body }) => { calls.push([name, body.action]); return answers.shift(); } },
  };
  const repository = createSupabasePaymentsRepository({ client, businessId: '7d1f0c52-3b1e-4c8a-9a67-2f5d0e6b1a01' });
  const result = await repository.connectionAction('connect');
  assert.equal(result.ok, true);
  assert.equal(refreshes, 2);
  assert.deepEqual(calls, [['mercadopago-connect', 'connect'], ['mercadopago-connect', 'connect']]);

  const failing = createSupabasePaymentsRepository({ businessId: 'b', client: { ...client, functions: { invoke: async () => ({
    data: null, error: { context: new Response(JSON.stringify({ ok: false, code: 'DISCONNECT_PENDING_OPERATIONS', pending: { open_payments: 1 } }), { status: 409 }) },
  }) } } });
  const blocked = await failing.connectionAction('disconnect', 'DISCONNECT_MERCADOPAGO');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'DISCONNECT_PENDING_OPERATIONS');
  assert.deepEqual(blocked.data.pending, { open_payments: 1 });
});
