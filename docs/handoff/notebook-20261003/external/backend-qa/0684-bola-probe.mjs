import crypto from 'node:crypto';

const base = 'http://127.0.0.1:55421/rest/v1';
const anonKey = process.env.TABA_LOCAL_ANON_KEY;
const jwtSecret = process.env.TABA_LOCAL_JWT_SECRET;
if (!anonKey || !jwtSecret) throw new Error('missing local Supabase probe credentials');

const ids = {
  businessA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  businessB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  ownerA: '10000000-0000-4000-8000-00000000aa01',
  adminA: '10000000-0000-4000-8000-00000000aa02',
  staffA: '10000000-0000-4000-8000-00000000aa03',
  riderA: '10000000-0000-4000-8000-00000000aa04',
  customerA: '10000000-0000-4000-8000-00000000aa05',
  ownerB: '10000000-0000-4000-8000-00000000bb01',
  riderB: '10000000-0000-4000-8000-00000000bb04',
  orderA: '60000000-0000-4000-8000-00000000aa01',
  orderB: '60000000-0000-4000-8000-00000000bb01',
  paymentA: '50000000-0000-4000-8000-00000000aa01',
  paymentB: '50000000-0000-4000-8000-00000000bb01',
  sessionOwnerA: '20000000-0000-4000-8000-00000000aa01',
  sessionAdminA: '20000000-0000-4000-8000-00000000aa02',
  sessionStaffA: '20000000-0000-4000-8000-00000000aa03',
  sessionRiderA: '20000000-0000-4000-8000-00000000aa04',
  sessionOwnerB: '20000000-0000-4000-8000-00000000bb01',
  sessionRevoked: '20000000-0000-4000-8000-00000000aa09',
};

function b64(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function token(sub, sessionId) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({
    iss: 'supabase-demo', aud: 'authenticated', role: 'authenticated',
    sub, email: `${sub}@example.invalid`, iat: now, exp: now + 3600,
    ...(sessionId ? { session_id: sessionId } : {}),
  });
  const input = `${header}.${payload}`;
  const signature = crypto.createHmac('sha256', jwtSecret).update(input).digest('base64url');
  return `${input}.${signature}`;
}

const actors = {
  anon: null,
  ownerA: token(ids.ownerA, ids.sessionOwnerA),
  adminA: token(ids.adminA, ids.sessionAdminA),
  staffA: token(ids.staffA, ids.sessionStaffA),
  riderA: token(ids.riderA, ids.sessionRiderA),
  customerA: token(ids.customerA),
  ownerB: token(ids.ownerB, ids.sessionOwnerB),
  revokedA: token(ids.ownerA, ids.sessionRevoked),
  random: token('10000000-0000-4000-8000-00000000cc01', '20000000-0000-4000-8000-00000000cc01'),
};

async function request(actor, method, path, body) {
  const headers = { apikey: anonKey, Accept: 'application/json' };
  if (actor && actors[actor]) headers.Authorization = `Bearer ${actors[actor]}`;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers.Prefer = 'return=representation';
  }
  const response = await fetch(`${base}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = text;
  try { parsed = text ? JSON.parse(text) : null; } catch {}
  return { status: response.status, body: parsed, text };
}

function isEmptyRows(result) {
  return result.status === 200 && Array.isArray(result.body) && result.body.length === 0;
}

function noPrivateAccess(result) {
  return isEmptyRows(result) || [401, 403].includes(result.status);
}

function noPrivateLeak(result) {
  const forbidden = ['BOLA-B-0001', 'Customer B', '2994000012', 'BOLA private product B', '"private":"B"', '50000000-0000-4000-8000-00000000bb01'];
  return !forbidden.some((needle) => result.text.includes(needle));
}

const results = [];
async function check(name, actor, method, path, body, predicate = noPrivateAccess) {
  const result = await request(actor, method, path, body);
  const pass = predicate(result) && noPrivateLeak(result);
  results.push({ name, actor: actor ?? 'anon', method, status: result.status, pass, body: result.body });
}

const b = ids.businessB;
const o = ids.orderB;
const p = ids.paymentB;

for (const actor of ['ownerA', 'adminA', 'staffA', 'riderA', 'customerA', 'revokedA', 'random', 'anon']) {
  await check(`${actor} cannot read B orders`, actor, 'GET', `/orders?id=eq.${o}`);
  await check(`${actor} cannot read B order items`, actor, 'GET', `/order_items?order_id=eq.${o}`);
  await check(`${actor} cannot read B order events`, actor, 'GET', `/order_events?order_id=eq.${o}`);
  await check(`${actor} cannot read B rider locations`, actor, 'GET', `/rider_locations?order_id=eq.${o}`);
  await check(`${actor} cannot read B payments`, actor, 'GET', `/payment_intents?id=eq.${p}`);
  await check(`${actor} cannot read B payment attempts`, actor, 'GET', `/payment_attempts?payment_intent_id=eq.${p}`);
  await check(`${actor} cannot read B private service hours`, actor, 'GET', `/business_service_hours?business_id=eq.${b}`);
  await check(`${actor} cannot read B private remediation`, actor, 'GET', `/commercial_contract_remediation?business_id=eq.${b}`);
}

await check('owner A cannot read B products', 'ownerA', 'GET', `/products?business_id=eq.${b}`);
await check('rider A cannot read B assigned order', 'riderA', 'GET', `/orders?assigned_rider_user_id=eq.${ids.riderB}`);
await check('customer A cannot read B customer order', 'customerA', 'GET', `/orders?customer_user_id=eq.10000000-0000-4000-8000-00000000bb05`);

await check('owner A cannot insert B order with adulterated JSON', 'ownerA', 'POST', '/orders', {
  business_id: ids.businessB, code: 'BOLA-TAMPER-ORDER', status: 'received', fulfillment_type: 'pickup',
  customer_name: 'ADULTERATED-CROSS-TENANT', payment_method: 'qa_no_charge', subtotal: 1,
  delivery_fee: 0, total: 1, public_code: 'BOLA-TAMPER-PUBLIC', delivery_mode: 'pickup',
  customer_user_id: ids.customerA, client_request_id: 'bola-tamper-order', origin: 'qa',
  origin_reason: 'tamper', origin_classified_at: new Date().toISOString(), discount_total: 0,
  correlation_id: crypto.randomUUID(), revision: 1, delivery_code_required: false,
}, (r) => [400, 401, 403].includes(r.status) || (r.status === 201 && Array.isArray(r.body) && r.body.length === 0));
await check('owner A cannot update B order by id param', 'ownerA', 'PATCH', `/orders?id=eq.${o}`, { notes: 'ADULTERATED-CROSS-TENANT' }, (r) => [200, 204, 400, 401, 403].includes(r.status) && (!Array.isArray(r.body) || r.body.length === 0));
await check('owner A cannot delete B order by id param', 'ownerA', 'DELETE', `/orders?id=eq.${o}`, undefined, (r) => [200, 204, 400, 401, 403].includes(r.status) && (!Array.isArray(r.body) || r.body.length === 0));
await check('owner A cannot insert B order event with mismatched business id', 'ownerA', 'POST', '/order_events', {
  order_id: ids.orderB, business_id: ids.businessA, type: 'tamper', event_type: 'tamper',
  actor_role: 'business', payload: { private: 'ADULTERATED-CROSS-TENANT' }, metadata: {},
}, (r) => [400, 401, 403].includes(r.status) || (r.status === 201 && Array.isArray(r.body) && r.body.length === 0));
await check('rider A cannot insert GPS for B order with adulterated ids', 'riderA', 'POST', '/rider_locations', {
  order_id: ids.orderB, rider_id: '70000000-0000-4000-8000-00000000bb01', business_id: ids.businessB,
  rider_user_id: ids.riderA, lat: -38.9, lng: -68.1, accuracy: 5, source: 'gps', order_revision: 1,
}, (r) => [400, 401, 403].includes(r.status) || (r.status === 201 && Array.isArray(r.body) && r.body.length === 0));
await check('owner A cannot insert B payment attempt', 'ownerA', 'POST', '/payment_attempts', {
  payment_intent_id: ids.paymentB, attempt_number: 2, attempt_type: 'preference', status: 'created',
}, (r) => [400, 401, 403].includes(r.status) || (r.status === 201 && Array.isArray(r.body) && r.body.length === 0));
await check('owner A cannot update B payment intent', 'ownerA', 'PATCH', `/payment_intents?id=eq.${p}`, { provider_status: 'approved' }, (r) => [200, 204, 400, 401, 403].includes(r.status) && (!Array.isArray(r.body) || r.body.length === 0));
await check('owner A cannot create B service hour', 'ownerA', 'POST', '/business_service_hours', {
  business_id: ids.businessB, channel: 'delivery', weekday: 2, opens_at: '09:00', closes_at: '18:00',
}, (r) => [400, 401, 403].includes(r.status) || (r.status === 201 && Array.isArray(r.body) && r.body.length === 0));

await check('owner A cannot assign B order to A rider via RPC', 'ownerA', 'POST', '/rpc/assign_order_rider', {
  p_order_id: ids.orderB, p_expected_status: 'received', p_expected_rider_user_id: ids.riderB,
  p_new_rider_user_id: ids.riderA,
}, (r) => [400, 401, 403].includes(r.status));
await check('owner A cannot transition B order via RPC', 'ownerA', 'POST', '/rpc/transition_order', {
  p_order_id: ids.orderB, p_expected_revision: 1, p_new_status: 'accepted', p_idempotency_key: 'bola-rpc-transition-b',
}, (r) => [400, 401, 403].includes(r.status));
await check('owner A cannot cancel B order via RPC', 'ownerA', 'POST', '/rpc/cancel_order', {
  p_order_id: ids.orderB, p_expected_revision: 1, p_reason: 'tamper', p_idempotency_key: 'bola-rpc-cancel-b',
}, (r) => [400, 401, 403].includes(r.status));
await check('rider A cannot require active membership for B via RPC', 'riderA', 'POST', '/rpc/rider_require_active_membership', {
  p_business_id: ids.businessB,
}, (r) => [400, 401, 403].includes(r.status) || (r.status === 200 && !r.text.includes(ids.businessB)));
await check('owner A cannot create checkout for B customer via RPC', 'ownerA', 'POST', '/rpc/create_checkout_session', {
  p_customer_id: '10000000-0000-4000-8000-00000000bb05',
  p_payload: { business_id: ids.businessB, items: [], fulfillment_type: 'pickup', total: 100 },
}, (r) => [400, 401, 403].includes(r.status));
await check('owner A cannot create B order through adulterated JSON RPC', 'ownerA', 'POST', '/rpc/create_order_with_items_core', {
  payload: { business_id: ids.businessB, customer_user_id: ids.customerA, items: [], total: 1, payment_method: 'qa_no_charge' },
}, (r) => [400, 401, 403].includes(r.status));
await check('owner A has no B identity context', 'ownerA', 'POST', '/rpc/identity_current_context', { p_business_id: ids.businessB }, (r) => r.status === 200 && r.body?.role === null && Array.isArray(r.body?.permissions) && r.body.permissions.length === 0);

const publicBusiness = await request('anon', 'GET', `/businesses?id=eq.${b}&select=id,name,slug`);
results.push({ name: 'B business base table is not exposed to anon without a public grant', actor: 'anon', method: 'GET', status: publicBusiness.status, pass: [401, 403].includes(publicBusiness.status) || (publicBusiness.status === 200 && Array.isArray(publicBusiness.body) && publicBusiness.body.length === 0), body: publicBusiness.body, deliberatelyPublic: false });
const publicTracking = await request('anon', 'POST', '/rpc/get_public_order_tracking', { p_public_id: 'BOLA-PUBLIC-B' });
results.push({ name: 'public tracking exposes only deliberate tracking DTO', actor: 'anon', method: 'RPC', status: publicTracking.status, pass: publicTracking.status === 200 && noPrivateLeak(publicTracking), body: publicTracking.body, deliberatelyPublic: true });

const ownerBOrder = await request('ownerB', 'GET', `/orders?id=eq.${ids.orderB}&select=id,code,notes,business_id,assigned_rider_user_id`);
const ownerBPayments = await request('ownerB', 'GET', `/payment_attempts?payment_intent_id=eq.${ids.paymentB}&select=id,payment_intent_id`);
const ownerBHours = await request('ownerB', 'GET', `/business_service_hours?business_id=eq.${ids.businessB}&select=id`);
results.push({ name: 'B order unchanged after cross-tenant writes', actor: 'ownerB', method: 'verification', status: ownerBOrder.status, pass: ownerBOrder.status === 200 && Array.isArray(ownerBOrder.body) && ownerBOrder.body.length === 1 && ownerBOrder.body[0].code === 'BOLA-B-0001' && ownerBOrder.body[0].notes === null && ownerBOrder.body[0].assigned_rider_user_id === ids.riderB, body: ownerBOrder.body });
results.push({ name: 'B payment attempts remain inaccessible to web roles after cross-tenant writes', actor: 'ownerB', method: 'verification', status: ownerBPayments.status, pass: ownerBPayments.status === 403 || (ownerBPayments.status === 200 && Array.isArray(ownerBPayments.body) && ownerBPayments.body.length === 1), body: ownerBPayments.body });
results.push({ name: 'B private service data unchanged after cross-tenant writes', actor: 'ownerB', method: 'verification', status: ownerBHours.status, pass: ownerBHours.status === 200 && Array.isArray(ownerBHours.body) && ownerBHours.body.length === 1, body: ownerBHours.body });

const failures = results.filter((r) => !r.pass);
console.log(JSON.stringify({
  total: results.length,
  passed: results.length - failures.length,
  failed: failures.length,
  deliberatelyPublicChecks: results.filter((r) => r.deliberatelyPublic).length,
  failedNames: failures.map((r) => r.name),
}));
if (failures.length) process.exitCode = 1;
