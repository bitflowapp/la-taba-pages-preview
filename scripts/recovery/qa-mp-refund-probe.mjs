// Diagnostic replay of a QA refund request exactly as mercadopago-refund sends it (seller OAuth grant, POST to
// /v1/payments/<id>/refunds, the SAME X-Idempotency-Key La Taba used, and no body for a full refund), to read the
// provider's reason, which La Taba stores only as a hash. With the original key the provider answers the original
// request instead of creating another one. Prints status, request id and the error shape only.
//   node scripts/recovery/qa-mp-refund-probe.mjs <payment_id> <idempotency_key> [--json-body]
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { RECOVERY_TEST_APPLICATION_ID } from './plan.mjs';

const ref = 'ixewllzzuzpqrkxzmfzx', business = '7d1f0c52-3b1e-4c8a-9a67-2f5d0e6b1a01', app = RECOVERY_TEST_APPLICATION_ID;
const [paymentId, idempotencyKey] = process.argv.slice(2);
assert.match(paymentId || '', /^\d+$/);
assert.match(idempotencyKey || '', /^[0-9a-f-]{36}$/);
const credential = leerSecreto('RECOVERY SUPABASE SERVICE KEY');
assert.equal(credential.usuario, ref);
const db = createClient(`https://${ref}.supabase.co`, credential.secreto, { auth: { persistSession: false, autoRefreshToken: false } });
// Only a refund La Taba already requested for this payment can be replayed.
const { data: intent } = await db.from('payment_intents').select('id').eq('business_id', business).eq('provider_payment_id', paymentId).single();
const { data: refund } = await db.from('payment_refunds').select('id,status').eq('payment_intent_id', intent?.id).eq('idempotency_key', idempotencyKey).single();
assert.ok(refund, 'no La Taba refund with that key for that payment');
const { data: connection, error } = await db.from('mp_seller_connections').select('application_id,protected_tokens').eq('business_id', business).eq('environment', 'test').single();
assert.ifError(error); assert.equal(connection.application_id, app);
const [, iv, ciphertext] = connection.protected_tokens.split('.');
const key = await crypto.subtle.importKey('raw', Buffer.from(leerSecreto('RECOVERY MERCADOPAGO TOKEN ENCRYPTION KEY').secreto, 'base64url'), 'AES-GCM', false, ['decrypt']);
const token = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(iv, 'base64url'), additionalData: Buffer.from(`${ref}:test:${app}:${business}:tokens`) }, key, Buffer.from(ciphertext, 'base64url')))).access_token;
const jsonBody = process.argv.includes('--json-body');
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-Idempotency-Key': idempotencyKey };
if (jsonBody) headers['Content-Type'] = 'application/json';
const r = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}/refunds`, { method: 'POST', headers, body: jsonBody ? '{}' : undefined, signal: AbortSignal.timeout(20000) });
const text = await r.text();
let body = null; try { body = JSON.parse(text); } catch { /* not JSON */ }
console.log(JSON.stringify({ at: new Date().toISOString(), la_taba_refund: refund, request: { content_type: jsonBody ? 'application/json' : null, body: jsonBody ? '{}' : null },
  http: r.status, requestId: r.headers.get('x-request-id'),
  provider: body ? { id: body.id ?? null, status: body.status ?? null, amount: body.amount ?? null, message: body.message ?? null, error: body.error ?? null, cause: body.cause ?? null } : { text: text.slice(0, 300) } }, null, 1));
