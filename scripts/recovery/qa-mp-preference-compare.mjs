// Read-only: the provider's view of a QA preference, every field except payer data, read with the seller's OAuth
// grant (or, with --direct, with the test application's own credential). Used to compare the preferences that
// the provider accepted for payment with those it did not.
//   node scripts/recovery/qa-mp-preference-compare.mjs <preference_id> [--direct]
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { RECOVERY_TEST_APPLICATION_ID } from './plan.mjs';

const ref = 'ixewllzzuzpqrkxzmfzx', business = '7d1f0c52-3b1e-4c8a-9a67-2f5d0e6b1a01', app = RECOVERY_TEST_APPLICATION_ID;
const preferenceId = process.argv[2];
assert.match(preferenceId || '', /^3594962708-[0-9a-f-]{36}$/, 'QA seller preference id required');
let token;
if (process.argv.includes('--direct')) {
  token = leerSecreto('RECOVERY MP TEST ACCESS TOKEN')?.secreto;
} else {
  const credential = leerSecreto('RECOVERY SUPABASE SERVICE KEY');
  assert.equal(credential.usuario, ref);
  const db = createClient(`https://${ref}.supabase.co`, credential.secreto, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: connection, error } = await db.from('mp_seller_connections').select('application_id,protected_tokens').eq('business_id', business).eq('environment', 'test').single();
  assert.ifError(error); assert.equal(connection.application_id, app);
  const [, iv, ciphertext] = connection.protected_tokens.split('.');
  const key = await crypto.subtle.importKey('raw', Buffer.from(leerSecreto('RECOVERY MERCADOPAGO TOKEN ENCRYPTION KEY').secreto, 'base64url'), 'AES-GCM', false, ['decrypt']);
  token = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(iv, 'base64url'), additionalData: Buffer.from(`${ref}:test:${app}:${business}:tokens`) }, key, Buffer.from(ciphertext, 'base64url')))).access_token;
}
assert.ok(token?.startsWith('APP_USR-'));
const response = await fetch(`https://api.mercadopago.com/checkout/preferences/${encodeURIComponent(preferenceId)}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
const body = await response.json();
const { payer: _payer, ...rest } = body; // payer data is never printed
console.log(JSON.stringify({ http: response.status, requestId: response.headers.get('x-request-id'), preference: rest }, null, 1));
