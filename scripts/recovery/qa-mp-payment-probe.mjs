// Diagnostic probe of the QA seller (test users only): one Payments API charge with the official public APRO test
// card, made with either the seller's OAuth grant through the integrator application (a marketplace payment) or the
// seller's own test credential (no marketplace). The provider answers with a machine-readable reason where Checkout
// Pro only shows «algo anduvo mal». An approved probe is refunded at once with the same credential.
//
//   node scripts/recovery/qa-mp-payment-probe.mjs --credential oauth|direct --payer-email <test buyer email>
//
// The reference `taba-diag:<uuid>` is deliberately outside `taba2:checkout:` so La Taba's worker ignores it.
// Prints no token, no card token and no payer data.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { RECOVERY_TEST_APPLICATION_ID } from './plan.mjs';

const ref = 'ixewllzzuzpqrkxzmfzx', business = '7d1f0c52-3b1e-4c8a-9a67-2f5d0e6b1a01', app = RECOVERY_TEST_APPLICATION_ID;
const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const mode = arg('--credential');
assert.ok(['oauth', 'direct'].includes(mode), '--credential oauth|direct');
// --payer-from-payment <id>: the payer is the QA test buyer, whose e-mail is read (in memory, never printed) from a
// payment that buyer already made to this seller. Otherwise an explicit @testuser.com address.
const payerPayment = arg('--payer-from-payment');
let payerEmail = arg('--payer-email');
if (!payerPayment) assert.match(payerEmail || '', /@testuser\.com$/, 'a test user e-mail (@testuser.com) only');

let token;
if (mode === 'direct') {
  token = leerSecreto('RECOVERY MP TEST ACCESS TOKEN')?.secreto;
} else {
  const credential = leerSecreto('RECOVERY SUPABASE SERVICE KEY');
  assert.equal(credential.usuario, ref);
  const db = createClient(`https://${ref}.supabase.co`, credential.secreto, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: connection, error } = await db.from('mp_seller_connections').select('application_id,seller_id,protected_tokens').eq('business_id', business).eq('environment', 'test').single();
  assert.ifError(error); assert.equal(connection.application_id, app); assert.equal(connection.seller_id, '3594962708');
  const [, iv, ciphertext] = connection.protected_tokens.split('.');
  const key = await crypto.subtle.importKey('raw', Buffer.from(leerSecreto('RECOVERY MERCADOPAGO TOKEN ENCRYPTION KEY').secreto, 'base64url'), 'AES-GCM', false, ['decrypt']);
  token = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(iv, 'base64url'), additionalData: Buffer.from(`${ref}:test:${app}:${business}:tokens`) }, key, Buffer.from(ciphertext, 'base64url')))).access_token;
}
assert.ok(token?.startsWith('APP_USR-'));

async function call(method, path, body, idempotencyKey) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;
  const r = await fetch(`https://api.mercadopago.com${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  let json = null; try { json = await r.json(); } catch { /* not JSON */ }
  return { http: r.status, requestId: r.headers.get('x-request-id'), body: json };
}
const errorOf = (b) => b && ({ message: b.message, error: b.error, status: b.status, cause: b.cause });

// Users of the probe: the seller must be the QA test seller, whatever credential is used.
const me = await call('GET', '/users/me');
assert.equal(String(me.body?.id), '3594962708'); assert.ok(me.body.tags.includes('test_user'));
if (payerPayment) {
  const prior = await call('GET', `/v1/payments/${encodeURIComponent(payerPayment)}`);
  assert.equal(String(prior.body?.payer?.id), '3594962710', 'the prior payment must belong to the QA test buyer');
  payerEmail = prior.body.payer.email;
  assert.match(payerEmail || '', /@/, 'the prior payment has no payer e-mail');
}

const card = await call('POST', '/v1/card_tokens', {
  card_number: '5031755734530604', expiration_month: 11, expiration_year: 2030, security_code: '123',
  cardholder: { name: 'APRO', identification: { type: 'DNI', number: '12345678' } },
});
const out = { at: new Date().toISOString(), credential: mode, client_id: /^APP_USR-(\d+)-/.exec(token)[1], card_token: { http: card.http, requestId: card.requestId, ok: Boolean(card.body?.id), error: card.body?.id ? null : errorOf(card.body) } };
if (card.body?.id) {
  const reference = `taba-diag:${randomUUID()}`;
  const payment = await call('POST', '/v1/payments', {
    transaction_amount: 100, token: card.body.id, description: 'La Taba QA diagnostico', installments: 1,
    payment_method_id: 'master', payer: { email: payerEmail }, external_reference: reference, binary_mode: true,
  }, randomUUID());
  const p = payment.body || {};
  out.payment = { http: payment.http, requestId: payment.requestId, external_reference: reference, id: p.id ?? null, status: p.status ?? null, status_detail: p.status_detail ?? null,
    live_mode: p.live_mode ?? null, collector_id: p.collector_id ?? null, marketplace_owner: p.marketplace_owner ?? null, marketplace: p.marketplace ?? null,
    payer_id: p.payer?.id ?? null, payer_type: p.payer?.type ?? null, error: p.id ? null : errorOf(p) };
  if (p.status === 'approved') {
    const refund = await call('POST', `/v1/payments/${p.id}/refunds`, {}, randomUUID());
    out.refund = { http: refund.http, requestId: refund.requestId, id: refund.body?.id ?? null, status: refund.body?.status ?? null, error: refund.body?.id ? null : errorOf(refund.body) };
  }
}
console.log(JSON.stringify(out, null, 1));
