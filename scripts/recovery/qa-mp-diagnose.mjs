// Read-only provider diagnosis of the QA Checkout Pro failure: who owns each credential and application, and what
// the provider recorded for the seller. Only GET requests; no credential, token or full payload is printed.
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';

const ref = 'ixewllzzuzpqrkxzmfzx', business = '7d1f0c52-3b1e-4c8a-9a67-2f5d0e6b1a01', app = '2691240967769590';
const credential = leerSecreto('RECOVERY SUPABASE SERVICE KEY');
assert.equal(credential.usuario, ref);
const db = createClient(`https://${ref}.supabase.co`, credential.secreto, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: connection, error } = await db.from('mp_seller_connections').select('seller_id,application_id,status,protected_tokens').eq('business_id', business).eq('environment', 'test').single();
assert.ifError(error); assert.equal(connection.application_id, app);
const [v, iv, ciphertext] = connection.protected_tokens.split('.'); assert.equal(v, 'v1');
const key = await crypto.subtle.importKey('raw', Buffer.from(leerSecreto('RECOVERY MERCADOPAGO TOKEN ENCRYPTION KEY').secreto, 'base64url'), 'AES-GCM', false, ['decrypt']);
const grant = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(iv, 'base64url'), additionalData: Buffer.from(`${ref}:test:${app}:${business}:tokens`) }, key, Buffer.from(ciphertext, 'base64url'))));

const tokens = { oauth: grant.access_token };
for (const [name, target] of [['direct_recovery', 'RECOVERY MP TEST ACCESS TOKEN'], ['direct_staging', 'MP STAGING ACCESS TOKEN']]) {
  try { const s = leerSecreto(target)?.secreto; if (s) tokens[name] = s; } catch { /* absent */ }
}
const out = { at: new Date().toISOString(), grant_fields: Object.keys(grant).sort(), grant_user_id: grant.user_id ?? null, grant_live_mode: grant.live_mode ?? null, credentials: {} };

async function get(token, path) {
  const r = await fetch(`https://api.mercadopago.com${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
  let body = null; try { body = await r.json(); } catch { /* not JSON */ }
  return { http: r.status, requestId: r.headers.get('x-request-id'), body };
}
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && o[k] !== undefined).map((k) => [k, o[k]]));
const tokenApp = (t) => (/^APP_USR-(\d+)-/.exec(t) || [])[1] ?? null; // the client id is the public part of the token

const payKeys = ['id', 'status', 'status_detail', 'payment_method_id', 'payment_type_id', 'operation_type', 'live_mode', 'collector_id', 'marketplace', 'marketplace_owner', 'sponsor_id', 'application_id', 'transaction_amount', 'external_reference', 'date_created', 'date_approved', 'processing_mode', 'merchant_account_id', 'pos_id', 'store_id', 'integrator_id', 'platform_id', 'corporation_id'];
for (const [name, token] of Object.entries(tokens)) {
  const me = await get(token, '/users/me');
  const entry = { token_client_id: tokenApp(token), users_me: { http: me.http, ...pick(me.body, ['id', 'site_id', 'tags', 'user_type', 'status']) } };
  const application = await get(token, `/applications/${app}`);
  entry.integrator_application = { http: application.http, requestId: application.requestId, ...pick(application.body, ['id', 'name', 'owner_id', 'site_id', 'scopes', 'certification_status', 'active', 'max_requests_per_hour', 'url', 'callback_url', 'short_name', 'catalog_product_id', 'domains']) };
  if (entry.token_client_id) {
    const own = await get(token, `/applications/${entry.token_client_id}`);
    entry.own_application = { http: own.http, ...pick(own.body, ['id', 'name', 'owner_id', 'site_id', 'catalog_product_id']) };
  }
  const recent = await get(token, `/v1/payments/search?${new URLSearchParams({ sort: 'date_created', criteria: 'desc', limit: '30', range: 'date_created', begin_date: 'NOW-40DAYS', end_date: 'NOW' })}`);
  entry.recent_payments = { http: recent.http, total: recent.body?.paging?.total ?? null, results: (recent.body?.results || []).map((p) => ({ ...pick(p, payKeys), payer_id: p.payer?.id ?? null })) };
  out.credentials[name] = entry;
}
const approved = await get(tokens.direct_recovery || tokens.direct_staging || tokens.oauth, '/v1/payments/179851082485');
out.sept_approved_payment = { http: approved.http, ...pick(approved.body, payKeys), payer_id: approved.body?.payer?.id ?? null };
console.log(JSON.stringify(out, null, 2));
