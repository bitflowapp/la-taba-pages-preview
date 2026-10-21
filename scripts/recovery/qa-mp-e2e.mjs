// Hosted Mercado Pago TEST harness for the recovery project (TABA2 Staging app only, QA tenant A).
// It drives TABA's side of the flow: panel session, single-use connect URL, checkout sessions and preferences,
// server-state inspection, forged-webhook rejection, cancellation/refund requests and on-demand worker runs.
// It never types Mercado Pago credentials and never enters card data: seller consent and buyer payments are
// done by a person in their own browser. Output never includes tokens, passwords or card data.
//
//   node scripts/recovery/qa-mp-e2e.mjs <command> [--flags]
//   commands: connect-url | status | verify | activation | window-open | window-close | checkout | session |
//             inspect | forged-webhooks | worker | cancel | refund | disconnect-preview | disconnect | counts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { RECOVERY_QA } from './provision-qa-ids.mjs';

const TEST_APPLICATION = '2691240967769590';
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const flag = name => process.argv.includes(name);
const command = process.argv[2];
const target = JSON.parse(fs.readFileSync(arg('--target', 'deploy/recovery-free-hosted.json'), 'utf8'));
// Hard stops: this harness only ever talks to the Free recovery project in TEST mode.
assert.equal(target.environment, 'test', 'test environment only');
assert.equal(target.mercadoPagoApplicationId, TEST_APPLICATION, 'TABA2 Staging application only');
assert.equal(target.commercialPaymentsEnabled, false, 'commercial payments must stay disabled');
assert.match(target.projectRef, /^[a-z]{20}$/);

const url = `https://${target.projectRef}.supabase.co`;
const origin = target.checkoutOrigin;
const A = RECOVERY_QA.a;
const O = { auth: { persistSession: false, autoRefreshToken: false } };
const key = name => {
  const stored = leerSecreto(name);
  assert.equal(stored?.usuario, target.projectRef, `${name}: credential not bound to the recovery project`);
  return stored.secreto;
};
const anonKey = key('RECOVERY SUPABASE ANON KEY');
let adminClient;
const admin = () => (adminClient ||= createClient(url, key('RECOVERY SUPABASE SERVICE KEY'), O));
const out = (value) => console.log(JSON.stringify(value, null, 1));
const evidenceFile = arg('--evidence');
const record = (value) => {
  if (!evidenceFile) return;
  fs.appendFileSync(evidenceFile, JSON.stringify({ at: new Date().toISOString(), command, ...value }) + '\n');
};

async function login(credential) {
  const stored = leerSecreto(credential);
  assert.ok(stored?.usuario && stored?.secreto, `${credential} unavailable`);
  const client = createClient(url, anonKey, O);
  const { error } = await client.auth.signInWithPassword({ email: stored.usuario, password: stored.secreto });
  assert.ifError(error);
  return client;
}

async function panelOwner() {
  const owner = await login('RECOVERY QA OWNER A');
  const reg = await owner.rpc('identity_register_session', { p_business_id: A, p_client: 'panel_web',
    p_device_label: 'recovery QA mercado pago', p_device_key_hash: null, p_app_version: 'recovery-qa-mp' });
  assert.ok(reg.data?.ok && ['owner', 'admin'].includes(reg.data.role), `panel session: ${reg.error?.code || reg.data?.code}`);
  return owner;
}

async function buyerClient() {
  if (arg('--buyer', 'qa') === 'anon') {
    // A fresh anonymous storefront identity, like a first-time visitor.
    const client = createClient(url, anonKey, O);
    const { error } = await client.auth.signInAnonymously();
    assert.ifError(error);
    return client;
  }
  return login('RECOVERY QA BUYER');
}

async function invoke(client, name, body, { originHeader = origin } = {}) {
  const { data: { session } } = await client.auth.getSession();
  const headers = { authorization: `Bearer ${session.access_token}`, apikey: anonKey, 'content-type': 'application/json' };
  if (originHeader) headers.origin = originHeader;
  const response = await fetch(`${url}/functions/v1/${name}`, { method: 'POST', headers, body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000) });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

function assertAuthorizationUrl(raw) {
  const parsed = new URL(raw);
  assert.ok(['https://auth.mercadopago.com.ar', 'https://auth.mercadopago.com'].includes(parsed.origin), 'official host');
  assert.equal(parsed.pathname, '/authorization');
  assert.equal(parsed.searchParams.get('client_id'), TEST_APPLICATION);
  assert.equal(parsed.searchParams.get('response_type'), 'code');
  assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256');
  assert.match(parsed.searchParams.get('code_challenge') || '', /^[A-Za-z0-9_-]{43}$/);
  assert.match(parsed.searchParams.get('state') || '', /^[A-Za-z0-9_-]{32,}$/);
  assert.equal(parsed.searchParams.get('redirect_uri'), `${url}/functions/v1/mercadopago-oauth-callback`);
  return parsed;
}

// Every forged notification must be refused before reaching the durable processor.
async function forgedWebhooks(paymentId) {
  const endpoint = `${url}/functions/v1/mercadopago-webhook`;
  const now = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ action: 'payment.updated', type: 'payment', data: { id: paymentId }, live_mode: false });
  const fake = createHmac('sha256', randomBytes(32)).update('x').digest('hex');
  const cases = [
    ['unsigned', {}, `?data.id=${paymentId}&type=payment`],
    ['garbage signature', { 'x-signature': 'garbage', 'x-request-id': randomUUID() }, `?data.id=${paymentId}&type=payment`],
    ['well-formed signature with a wrong key', { 'x-signature': `ts=${now},v1=${fake}`, 'x-request-id': randomUUID() }, `?data.id=${paymentId}&type=payment`],
    ['stale timestamp', { 'x-signature': `ts=${now - 3600},v1=${fake}`, 'x-request-id': randomUUID() }, `?data.id=${paymentId}&type=payment`],
    ['query/body id mismatch', { 'x-signature': `ts=${now},v1=${fake}`, 'x-request-id': randomUUID() }, `?data.id=${paymentId}1&type=payment`],
    ['missing request id', { 'x-signature': `ts=${now},v1=${fake}` }, `?data.id=${paymentId}&type=payment`],
  ];
  const results = [];
  for (const [name, headers, query] of cases) {
    const response = await fetch(endpoint + query, { method: 'POST', body,
      headers: { 'content-type': 'application/json', ...headers }, signal: AbortSignal.timeout(30000) });
    const json = await response.json().catch(() => ({}));
    results.push({ case: name, httpStatus: response.status, code: json.code || null, refused: response.status === 401 });
  }
  return results;
}

async function workerOnce() {
  const credential = leerSecreto('RECOVERY PAYMENT WORKER SECRET');
  assert.equal(credential?.usuario, target.projectRef, 'worker credential project mismatch');
  const timestamp = String(Math.floor(Date.now() / 1000)), nonce = randomUUID();
  const signature = createHmac('sha256', credential.secreto)
    .update(`${timestamp}.${nonce}.POST./functions/v1/mercadopago-payment-worker`).digest('hex');
  const response = await fetch(`${url}/functions/v1/mercadopago-payment-worker`, { method: 'POST', body: '{}',
    headers: { 'content-type': 'application/json', 'x-taba-worker-timestamp': timestamp,
      'x-taba-worker-nonce': nonce, 'x-taba-worker-signature': signature }, signal: AbortSignal.timeout(150000) });
  const body = await response.json().catch(() => ({}));
  return { httpStatus: response.status, ok: body.ok, claimed: body.claimed, completed: body.completed,
    retried: body.retried, failed: body.failed ?? null };
}

const pick = (row, fields) => row ? Object.fromEntries(fields.filter(f => f in row).map(f => [f, row[f]])) : null;

async function inspect(sessionId) {
  const db = admin();
  const session = (await db.from('checkout_sessions').select('*').eq('id', sessionId).maybeSingle()).data;
  assert.ok(session, 'checkout session not found');
  assert.equal(session.business_id, A, 'only QA tenant A is inspected');
  const intents = (await db.from('payment_intents').select('*').eq('checkout_session_id', sessionId)).data || [];
  const intentIds = intents.map(i => i.id);
  const attempts = intentIds.length ? (await db.from('payment_attempts').select('*').in('payment_intent_id', intentIds)).data || [] : [];
  const paymentIds = intents.map(i => i.provider_payment_id).filter(Boolean).map(String);
  const receipts = paymentIds.length ? (await db.from('payment_webhook_receipts').select('*').in('resource_id', paymentIds)).data || [] : [];
  const outbox = intentIds.length ? (await db.from('payment_outbox').select('*').in('payment_intent_id', intentIds)).data || [] : [];
  const orderIds = [session.completed_order_id, ...intents.map(i => i.order_id)].filter(Boolean);
  const orders = orderIds.length ? (await db.from('orders').select('*').in('id', [...new Set(orderIds)])).data || [] : [];
  const reservations = (await db.from('inventory_reservations').select('*').eq('checkout_session_id', sessionId)).data || [];
  const refunds = intentIds.length ? (await db.from('payment_refunds').select('*').in('payment_intent_id', intentIds)).data || [] : [];
  const cancellations = intentIds.length ? (await db.from('payment_cancellations').select('*').in('payment_intent_id', intentIds)).data || [] : [];
  const products = (await db.from('products').select('sku,stock').eq('business_id', A).order('sku')).data || [];
  return {
    session: pick(session, ['id', 'status', 'currency', 'subtotal', 'discount_total', 'delivery_fee', 'total', 'expires_at',
      'completed_order_id', 'manual_review_reason', 'created_at', 'updated_at']),
    intents: intents.map(i => pick(i, ['id', 'internal_status', 'environment', 'expected_amount', 'paid_amount', 'currency',
      'external_reference', 'provider_payment_id', 'provider_status', 'provider_status_detail', 'live_mode', 'approved_at',
      'rejected_at', 'refunded_amount', 'order_id', 'security_review_reason'])),
    attempts: attempts.map(a => pick(a, ['id', 'attempt_number', 'attempt_type', 'status', 'preference_id', 'last_error_code', 'created_at'])),
    receipts: receipts.map(r => pick(r, ['event_type', 'resource_id', 'signature_valid', 'processing_status', 'attempt_count',
      'received_at', 'processed_at', 'last_error'])),
    outbox: outbox.map(o => pick(o, ['id', 'topic', 'resource_id', 'status', 'attempts', 'last_error', 'next_attempt_at', 'completed_at'])),
    orders: orders.map(o => pick(o, ['id', 'public_code', 'status', 'payment_method', 'payment_status', 'manual_payment_status',
      'total', 'currency_code', 'created_at', 'cancelled_at'])),
    reservations: reservations.map(r => pick(r, ['product_id', 'quantity', 'status', 'expires_at', 'released_at', 'release_reason', 'converted_at'])),
    refunds: refunds.map(r => pick(r, ['id', 'status', 'amount', 'provider_refund_id', 'idempotency_key', 'requested_at', 'completed_at'])),
    cancellations: cancellations.map(c => pick(c, ['id', 'status', 'idempotency_key', 'requested_at', 'completed_at'])),
    stock: products,
  };
}

async function main() {
  if (command === 'connect-url') {
    const owner = await panelOwner();
    // The callback re-validates this session after consent; start with a fresh token lifetime.
    assert.ifError((await owner.auth.refreshSession()).error);
    await panelOwnerReregister(owner);
    const response = await invoke(owner, 'mercadopago-connect', { business_id: A, action: 'connect' });
    assert.equal(response.status, 200, `connect: ${response.status} ${response.body.code || ''}`);
    const parsed = assertAuthorizationUrl(response.body.authorization_url);
    record({ authorizationHost: parsed.origin, pkce: 'S256', redirectUri: parsed.searchParams.get('redirect_uri') });
    // The URL carries a single-use state that expires in 10 minutes; it is meant to be opened by the person.
    out({ authorization_url: parsed.toString(), expires_in_minutes: 10 });
    return;
  }
  if (['status', 'verify', 'disconnect-preview'].includes(command)) {
    const owner = await panelOwner();
    const response = await invoke(owner, 'mercadopago-connect', { business_id: A, action: command.replace('-', '_') });
    record({ httpStatus: response.status, body: response.body });
    out({ httpStatus: response.status, ...response.body });
    return;
  }
  if (command === 'disconnect') {
    const owner = await panelOwner();
    const response = await invoke(owner, 'mercadopago-connect', { business_id: A, action: 'disconnect',
      confirmation: arg('--confirmation', 'DISCONNECT_MERCADOPAGO') });
    record({ httpStatus: response.status, body: response.body });
    out({ httpStatus: response.status, ...response.body });
    return;
  }
  if (command === 'activation') {
    const owner = await panelOwner();
    const { data, error } = await owner.rpc('get_mercadopago_activation_status', { p_business_id: A });
    out(error ? { error: error.code } : data);
    return;
  }
  if (command === 'window-open' || command === 'window-close') {
    const owner = await panelOwner();
    const { data, error } = command === 'window-open'
      ? await owner.rpc('open_qa_window', { p_business_id: A, p_minutes: Number(arg('--minutes', '30')) })
      : await owner.rpc('close_qa_window', { p_business_id: A });
    record({ data, error: error?.code || null });
    out(error ? { error: error.code, message: error.message } : data);
    return;
  }
  if (command === 'checkout') {
    const buyer = await buyerClient();
    const sku = arg('--sku', 'QA-REC-001');
    const quantity = Number(arg('--qty', '1'));
    const product = (await admin().from('products').select('id,price,stock').eq('business_id', A).eq('sku', sku).single()).data;
    assert.ok(product, 'QA product not found');
    assert.ifError((await buyer.rpc('upsert_current_customer_profile', { p_name: 'QA Comprador', p_phone: '2995550811' })).error);
    const clientRequestId = arg('--client-request-id', randomUUID());
    const payload = { business_id: A, client_request_id: clientRequestId, items: [{ product_id: product.id, quantity }],
      fulfillment_type: 'pickup', contact: { name: 'QA Comprador', phone: '2995550811' }, address: {},
      age_confirmed: true, payment_method: 'mercadopago', notes: `QA ${arg('--scenario', 'manual')}: no entregar` };
    const session = await invoke(buyer, 'mercadopago-create-checkout-session', payload);
    const checkout = session.body.checkout || {};
    const sessionId = checkout.checkout_session_id || checkout.id;
    let preference = null;
    if (session.status === 200 && sessionId) {
      preference = await invoke(buyer, 'mercadopago-create-preference', { checkout_session_id: sessionId });
      if (flag('--double-click')) {
        // The same request again, as a second tap would send it.
        const again = await invoke(buyer, 'mercadopago-create-preference', { checkout_session_id: sessionId });
        preference.repeat = { status: again.status, same_init_point: again.body.init_point === preference.body.init_point };
      }
    }
    const result = { scenario: arg('--scenario', 'manual'), sku, quantity, unit_price: product.price,
      session_http: session.status, session_code: session.body.code || null, checkout_session_id: sessionId || null,
      total: checkout.total ?? null, currency: checkout.currency ?? null,
      preference_http: preference?.status ?? null, preference_code: preference?.body?.code || null,
      init_point: preference?.body?.init_point || null, expires_at: preference?.body?.expires_at || null,
      repeat: preference?.repeat || null };
    record(result);
    out(result);
    return;
  }
  if (command === 'session') {
    const buyer = await buyerClient();
    const response = await invoke(buyer, 'mercadopago-checkout-status', { checkout_session_id: arg('--session') });
    record({ httpStatus: response.status, body: response.body });
    out({ httpStatus: response.status, ...response.body });
    return;
  }
  if (command === 'inspect') {
    const snapshot = await inspect(arg('--session'));
    record({ snapshot });
    out(snapshot);
    return;
  }
  if (command === 'forged-webhooks') {
    const results = await forgedWebhooks(String(arg('--payment', '1')));
    record({ results });
    out({ results, allRefused: results.every(r => r.refused) });
    return;
  }
  if (command === 'worker') {
    const result = await workerOnce();
    record(result);
    out(result);
    return;
  }
  if (command === 'cancel' || command === 'refund') {
    const owner = await panelOwner();
    const intent = arg('--intent');
    const idempotencyKey = arg('--idempotency-key', randomUUID());
    const body = command === 'cancel'
      ? { payment_intent_id: intent, idempotency_key: idempotencyKey,
          confirmation: 'I_UNDERSTAND_THIS_REQUESTS_A_MERCADO_PAGO_CANCELLATION' }
      : { payment_intent_id: intent, idempotency_key: idempotencyKey, reason: arg('--reason', 'QA reembolso de prueba'),
          ...(arg('--amount') ? { amount: Number(arg('--amount')) } : {}),
          confirmation: 'I_UNDERSTAND_THIS_REQUESTS_A_MERCADO_PAGO_REFUND' };
    const fnName = command === 'cancel' ? 'mercadopago-cancel-payment' : 'mercadopago-refund';
    const first = await invoke(owner, fnName, body);
    const repeat = flag('--repeat') ? await invoke(owner, fnName, body) : null;
    const result = { intent, idempotencyKey, first: { status: first.status, body: first.body },
      repeat: repeat ? { status: repeat.status, body: repeat.body } : null };
    record(result);
    out(result);
    return;
  }
  if (command === 'counts') {
    const db = admin();
    const count = async (table, filter = q => q) =>
      (await filter(db.from(table).select('*', { count: 'exact', head: true }))).count;
    const result = {
      connections: await count('mp_seller_connections'),
      intents: await count('payment_intents'),
      intentsOutsideTest: await count('payment_intents', q => q.neq('environment', 'test')),
      receipts: await count('payment_webhook_receipts'),
      validReceipts: await count('payment_webhook_receipts', q => q.eq('signature_valid', true)),
      outbox: await count('payment_outbox'),
      ordersQA: await count('orders', q => q.eq('business_id', A)),
      historicBusinessOrders: await count('orders', q => q.eq('business_id', '00000000-0000-4000-8000-000000000001')),
    };
    out(result);
    return;
  }
  throw new Error(`Unknown command ${command}`);
}

async function panelOwnerReregister(owner) {
  const reg = await owner.rpc('identity_register_session', { p_business_id: A, p_client: 'panel_web',
    p_device_label: 'recovery QA mercado pago', p_device_key_hash: null, p_app_version: 'recovery-qa-mp' });
  assert.ok(reg.data?.ok, `panel session after refresh: ${reg.error?.code || reg.data?.code}`);
}

main().then(() => setTimeout(() => process.exit(process.exitCode || 0), 200)).catch(error => {
  console.error(String(error?.message || error).replace(/(?:sbp_|sb_secret_|APP_USR-|TEST-|eyJ)[A-Za-z0-9._-]+/g, '[redacted]'));
  process.exit(1);
});
