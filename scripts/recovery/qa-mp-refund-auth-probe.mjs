// Diagnostic of WHY the QA refund API answers 401 «Unauthorized use of live credentials» (cause 7), without any way to
// move money: the refund endpoint is called on a payment that Mercado Pago itself reports as REJECTED (nothing was
// ever charged, so there is nothing to refund) and the answer is read.
//   - 401 code 7 again  -> the endpoint refuses this credential before it looks at the payment (authorization/product
//                          restriction of the credential: not fixable from La Taba's request).
//   - 400 2063 / 404 ... -> authorization passed; the earlier 401 depends on the payment (or its live/test nature).
// The call uses the QA seller's stored OAuth grant, a fresh idempotency key, no body (full refund, like La Taba) and
// is refused locally unless the payment is rejected or cancelled and belongs to the QA seller and application.
// Also reads (GET) the refund list of an approved payment, which only needs read permission.
//   node scripts/recovery/qa-mp-refund-auth-probe.mjs <rejected_payment_id> [<approved_payment_id>]
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { RECOVERY_TEST_APPLICATION_ID } from './plan.mjs';

const ref = 'ixewllzzuzpqrkxzmfzx', business = '7d1f0c52-3b1e-4c8a-9a67-2f5d0e6b1a01', app = RECOVERY_TEST_APPLICATION_ID;
const [rejectedId, approvedId] = process.argv.slice(2);
assert.match(rejectedId || '', /^\d+$/, 'a rejected payment id is required');
const credential = leerSecreto('RECOVERY SUPABASE SERVICE KEY');
assert.equal(credential.usuario, ref);
const db = createClient(`https://${ref}.supabase.co`, credential.secreto, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: connection, error } = await db.from('mp_seller_connections').select('application_id,protected_tokens').eq('business_id', business).eq('environment', 'test').single();
assert.ifError(error); assert.equal(connection.application_id, app);
const [, iv, ciphertext] = connection.protected_tokens.split('.');
const key = await crypto.subtle.importKey('raw', Buffer.from(leerSecreto('RECOVERY MERCADOPAGO TOKEN ENCRYPTION KEY').secreto, 'base64url'), 'AES-GCM', false, ['decrypt']);
const token = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(iv, 'base64url'), additionalData: Buffer.from(`${ref}:test:${app}:${business}:tokens`) }, key, Buffer.from(ciphertext, 'base64url')))).access_token;

async function call(method, path, headers = {}) {
  const r = await fetch(`https://api.mercadopago.com${path}`, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(20000) });
  const text = await r.text();
  let body = null; try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { http: r.status, requestId: r.headers.get('x-request-id'), body };
}
const shape = (b) => (b ? { id: b.id ?? null, status: b.status ?? null, message: b.message ?? null, error: b.error ?? null, cause: b.cause ?? null } : null);

const rejected = await call('GET', `/v1/payments/${rejectedId}`);
assert.equal(rejected.http, 200);
assert.ok(['rejected', 'cancelled'].includes(rejected.body.status), `refusing to probe a payment that is ${rejected.body.status}`);
assert.equal(String(rejected.body.collector_id), '3594962708');
assert.equal(rejected.body.transaction_amount_refunded ?? 0, 0);
const out = { at: new Date().toISOString(), application: app,
  rejected_payment: { id: rejectedId, status: rejected.body.status, status_detail: rejected.body.status_detail, live_mode: rejected.body.live_mode } };
const attempt = await call('POST', `/v1/payments/${rejectedId}/refunds`, { 'X-Idempotency-Key': randomUUID() });
out.refund_on_rejected = { http: attempt.http, requestId: attempt.requestId, answer: shape(attempt.body) };
if (approvedId) {
  const list = await call('GET', `/v1/payments/${approvedId}/refunds`);
  out.read_refunds_of_approved = { http: list.http, requestId: list.requestId, count: Array.isArray(list.body) ? list.body.length : null, answer: Array.isArray(list.body) ? null : shape(list.body) };
}
console.log(JSON.stringify(out, null, 1));
