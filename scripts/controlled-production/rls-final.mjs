// Final authorization certification for the controlled rollout, run with REAL
// sessions of each role (the secret key only provisions/cleans QA data):
// anon sees nothing private; a customer cannot touch price/total/status nor
// read another customer's order; rider A cannot act on rider B's delivery;
// staff cannot escalate; business A cannot read or act on business B.
//
//   node scripts/controlled-production/rls-final.mjs --target staging|controlled-production
//        --business-id <A> [--other-business-id <B> --other-staff-credential <name>]
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadTargetKeys } from './target-keys.mjs';
import { openQaWindow } from './qa-window.mjs';
import { readQaCredential } from './qa-credentials.mjs';
import { signIn } from './accounts.mjs';
import { cleanupQaOrder } from './qa-cleanup.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback = '') => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const TARGET = opt('--target');
const PROFILE = {
  staging: { owner: 'STAGING PILOT OWNER QA 20260923', staff: 'STAGING PILOT STAFF QA 20260923', rider: 'STAGING CP CAPACITY RIDER',
    address: { neighborhood: 'Centro', city: 'Neuquén Capital', lat: -38.9516, lng: -68.0591 } },
  'controlled-production': { owner: 'CP QA OWNER', staff: 'CP QA STAFF', rider: 'CP QA RIDER',
    address: { neighborhood: opt('--neighborhood'), city: opt('--city', 'Neuquén Capital'), lat: Number(opt('--lat')), lng: Number(opt('--lng')) } },
}[TARGET];
assert.ok(PROFILE, 'EXPLICIT_TARGET_REQUIRED');
const A = opt('--business-id', TARGET === 'staging' ? 'a57b1c20-0f4e-4a6b-9d31-7c2e5f8a41d0' : '');
const B = opt('--other-business-id');
const OUT = opt('--out', `artifacts/controlled-production/rls-${TARGET}-${Date.now()}.json`);
const OPTIONS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const keys = await loadTargetKeys(TARGET);
const admin = createClient(keys.url, keys.secret, OPTIONS);
const client = (headers) => createClient(keys.url, keys.publishable, headers ? { ...OPTIONS, global: { headers } } : OPTIONS);
const checks = {};
const failures = [];
const check = (name, ok, detail = '') => { checks[name] = ok ? 'PASS' : 'FAIL'; if (!ok) failures.push(`${name}${detail ? `:${detail}` : ''}`); };
// A missing function or wrong argument list (PGRST202/203) is a broken probe,
// not a denial: it must never count as a PASS.
const denied = (r) => (r.error ? !['PGRST202', 'PGRST203'].includes(r.error.code) : r.data?.ok === false);
const noRows = (r) => Boolean(r.error) || (Array.isArray(r.data) && r.data.length === 0);

async function member(credentialName, clientKind, label, businessId = A) {
  const stored = readQaCredential(credentialName);
  assert.ok(stored?.secreto, `QA_CREDENTIAL_REQUIRED:${credentialName}`);
  const c = client();
  const user = await signIn(c, stored.usuario, stored.secreto);
  const reg = await c.rpc('identity_register_session', { p_business_id: businessId, p_client: clientKind,
    p_device_label: `RLS ${label}`, p_device_key_hash: null, p_app_version: 'cp-rls' });
  assert.ok(reg.data?.ok, `SESSION_REFUSED:${label}`);
  return { c, id: user.id, role: reg.data.role };
}
async function anonymousCustomer(k) {
  const c = client();
  const s = await c.auth.signInAnonymously({ options: { data: { taba_actor: 'customer' } } });
  assert.ok(s.data?.session, `ANON_SIGNIN_FAILED:${s.error?.code || s.error?.status}`);
  const p = await c.rpc('upsert_current_customer_profile', { p_name: `QA RLS ${k}`, p_phone: `29955503${k}0` });
  assert.ifError(p.error);
  const a = await c.rpc('upsert_current_customer_address', { p_address: { label: 'Casa', street: 'Calle RLS', streetNumber: `${k}00`,
    city: PROFILE.address.city, neighborhood: PROFILE.address.neighborhood, latitude: PROFILE.address.lat, longitude: PROFILE.address.lng,
    geolocationAccuracy: 10, source: 'gps', locationSource: 'map_pin', locationConfirmedAt: new Date().toISOString(), isDefault: true } });
  assert.ifError(a.error);
  return { c, id: s.data.user.id, addressId: a.data.address.id, k };
}

const owner = await member(PROFILE.owner, 'panel_web', 'owner');
const staff = await member(PROFILE.staff, 'panel_web', 'staff');
const riderA = await member(`${PROFILE.rider} 1`, 'rider_android', 'riderA');
const riderB = await member(`${PROFILE.rider} 2`, 'rider_android', 'riderB');
const createdOrders = [];
// CP: the QA tenant is closed outside QA runs; open it here, close it below
// and prove that, closed, its catalog is invisible to the public again.
const qaWindow = TARGET === 'controlled-production' ? await openQaWindow(owner.c, A) : null;
try {
  // ---------- anon ----------
  const anon = client();
  const privateTables = ['orders', 'order_items', 'order_events', 'customers', 'customer_addresses', 'business_members',
    'staff_profiles', 'rider_profiles', 'rider_locations', 'rider_availability', 'payment_intents',
    'business_command_receipts', 'business_access_requests', 'inventory_movements', 'operational_alerts', 'identity_sessions'];
  for (const table of privateTables) check(`ANON_NO_ROWS_${table}`, noRows(await anon.from(table).select('*').limit(5)));
  for (const [fn, a] of [['transition_order', { p_order_id: randomUUID(), p_expected_revision: 1, p_new_status: 'accepted', p_idempotency_key: 'rls_anon_0001' }],
    ['get_rider_delivery_board', {}], ['list_business_payments', { p_business_id: A }],
    ['identity_list_access_requests', { p_business_id: A, p_status: 'pending' }],
    ['confirm_manual_order_payment', { p_order_id: randomUUID(), p_expected_revision: 1, p_actual_method: 'cash', p_idempotency_key: 'rls_anon_0002' }]]) {
    check(`ANON_RPC_DENIED_${fn}`, denied(await anon.rpc(fn, a)));
  }
  const anonWrite = await anon.from('products').update({ price: 1 }).eq('business_id', A).select('id');
  check('ANON_CANNOT_UPDATE_PRODUCTS', noRows(anonWrite));

  // ---------- customers ----------
  const x = await anonymousCustomer(1);
  const y = await anonymousCustomer(2);
  const product = (await staff.c.from('products').select('id,price,stock').eq('business_id', A).eq('available', true)
    .eq('is_active', true).eq('is_verified', true).eq('is_alcoholic', false).gt('stock', 5).order('price', { ascending: false }).limit(1)).data?.[0];
  assert.ok(product, 'QA_PRODUCT_WITH_STOCK_REQUIRED');
  const availability = (await staff.c.rpc('commerce_availability', { p_business_id: A, p_channel: 'delivery', p_context: {} })).data;
  const minimum = Number(availability?.areas?.find((a) => a.name === PROFILE.address.neighborhood)?.minimum_subtotal || 0);
  const qty = Math.max(1, Math.ceil((minimum + 1) / Number(product.price)));
  const token = randomBytes(32).toString('base64url');
  const created = await x.c.rpc('create_order_with_items', { payload: { business_id: A, client_request_id: randomUUID(), tracking_token: token,
    items: [{ product_id: product.id, quantity: qty }], customer_name: 'QA RLS 1', customer_phone: '2995550310', delivery_mode: 'delivery',
    payment_method: 'cash', age_confirmed: true, customer_address_id: x.addressId, customer_street_address: 'Calle RLS 100',
    customer_neighborhood: PROFILE.address.neighborhood, customer_notes: 'QA RLS — no despachar' } });
  assert.ifError(created.error);
  const order = Array.isArray(created.data) ? created.data[0] : created.data;
  createdOrders.push(order.id);
  const before = (await admin.from('orders').select('status,total,subtotal,revision').eq('id', order.id).single()).data;
  check('CUSTOMER_SEES_OWN_ORDER', ((await x.c.from('orders').select('id').eq('id', order.id)).data || []).length === 1);
  check('CUSTOMER_CANNOT_READ_OTHER_ORDER', noRows(await y.c.from('orders').select('id').eq('id', order.id)));
  check('CUSTOMER_CANNOT_READ_OTHER_ITEMS', noRows(await y.c.from('order_items').select('id').eq('order_id', order.id)));
  await x.c.from('orders').update({ total: 1, subtotal: 1, status: 'delivered' }).eq('id', order.id);
  await x.c.from('order_items').update({ unit_price: 1 }).eq('order_id', order.id);
  const afterTamper = (await admin.from('orders').select('status,total,subtotal,revision').eq('id', order.id).single()).data;
  check('CUSTOMER_CANNOT_CHANGE_PRICE_TOTAL_STATUS', JSON.stringify(afterTamper) === JSON.stringify(before), JSON.stringify(afterTamper));
  check('CUSTOMER_CANNOT_TRANSITION', denied(await x.c.rpc('transition_order', { p_order_id: order.id, p_expected_revision: before.revision, p_new_status: 'accepted', p_idempotency_key: 'rls_customer_transition' })));
  check('CUSTOMER_CANNOT_CONFIRM_PAYMENT', denied(await x.c.rpc('confirm_manual_order_payment', { p_order_id: order.id, p_expected_revision: before.revision, p_actual_method: 'cash', p_idempotency_key: 'rls_customer_pay01' })));
  const productBefore = (await admin.from('products').select('price').eq('id', product.id).single()).data.price;
  await x.c.from('products').update({ price: 1 }).eq('id', product.id);
  check('CUSTOMER_CANNOT_CHANGE_PRODUCT_PRICE', Number((await admin.from('products').select('price').eq('id', product.id).single()).data.price) === Number(productBefore));
  const tracking = await client({ 'x-order-token': 'wrong-token' }).rpc('get_public_order_tracking', { p_public_id: order.public_code });
  check('TRACKING_REQUIRES_ORDER_TOKEN', denied(tracking) || !tracking.data?.status);

  // ---------- staff escalation ----------
  check('STAFF_CANNOT_SELF_PROMOTE', denied(await staff.c.rpc('identity_set_member_role', { p_business_id: A, p_user_id: staff.id, p_role: 'owner' })));
  check('STAFF_CANNOT_PROMOTE_TO_ADMIN', denied(await staff.c.rpc('identity_set_member_role', { p_business_id: A, p_user_id: staff.id, p_role: 'admin' })));
  check('STAFF_CANNOT_DEACTIVATE_OWNER', denied(await staff.c.rpc('identity_set_member_active', { p_business_id: A, p_user_id: owner.id, p_is_active: false, p_reason: 'rls' })));
  check('STAFF_CANNOT_CHANGE_PRESENCE_POLICY', denied(await staff.c.rpc('set_business_rider_presence_policy', { p_business_id: A, p_required: false })));
  check('STAFF_MEMBERSHIP_UNCHANGED', ((await admin.from('business_members').select('role').eq('business_id', A).eq('user_id', staff.id).single()).data?.role) === 'staff');

  // ---------- riders ----------
  for (const r of [riderA, riderB]) {
    const board = (await r.c.rpc('get_rider_delivery_board')).data;
    if (!board?.available) await r.c.rpc('set_rider_availability', { p_business_id: A, p_available: true, p_expected_version: board?.availability_version || 0, p_idempotency_key: `rls-on-${randomUUID()}` });
    await r.c.rpc('heartbeat_rider_availability', { p_business_id: A });
  }
  for (const next of ['accepted', 'preparing', 'ready']) {
    const cur = (await staff.c.from('orders').select('revision').eq('id', order.id).single()).data;
    const t = await staff.c.rpc('transition_order', { p_order_id: order.id, p_expected_revision: cur.revision, p_new_status: next, p_idempotency_key: `rls_${next}_${order.id.replaceAll('-', '')}` });
    assert.ifError(t.error);
  }
  const offer = await staff.c.rpc('offer_order_to_rider', { p_order_id: order.id, p_expected_status: 'ready', p_expected_rider_user_id: null, p_new_rider_user_id: riderA.id });
  assert.ok(offer.data?.ok, `OFFER_FAILED:${offer.data?.code || offer.error?.code}`);
  const offerA = ((await riderA.c.rpc('get_rider_delivery_board')).data?.offers || []).find((o) => o.order_id === order.id);
  assert.ok(offerA, 'OFFER_NOT_VISIBLE');
  check('RIDER_B_CANNOT_ACCEPT_A_OFFER', denied(await riderB.c.rpc('accept_rider_order_offer', { p_offer_id: offerA.offer_id, p_expected_version: offerA.version, p_idempotency_key: `rls-b-${offerA.offer_id}` })));
  const accepted = await riderA.c.rpc('accept_rider_order_offer', { p_offer_id: offerA.offer_id, p_expected_version: offerA.version, p_idempotency_key: `rls-a-${offerA.offer_id}` });
  assert.equal(accepted.data?.code, 'accepted', 'RIDER_A_ACCEPT_FAILED');
  const assigned = (await admin.from('orders').select('revision,assigned_rider_user_id').eq('id', order.id).single()).data;
  check('RIDER_B_BOARD_HAS_NO_A_DELIVERY', !((await riderB.c.rpc('get_rider_delivery_board')).data?.orders || []).some((o) => o.id === order.id));
  check('RIDER_B_CANNOT_PICK_UP_A_DELIVERY', denied(await riderB.c.rpc('mark_delivery_picked_up', { p_order_id: order.id, p_expected_revision: assigned.revision, p_idempotency_key: `rls-b-pick-${order.id}` })));
  check('RIDER_B_CANNOT_READ_A_ORDER', noRows(await riderB.c.from('orders').select('id,total').eq('id', order.id)));
  check('RIDER_B_CANNOT_READ_A_LOCATIONS', noRows(await riderB.c.from('rider_locations').select('id').eq('order_id', order.id)));
  await riderA.c.from('products').update({ price: 1 }).eq('id', product.id);
  check('RIDER_CANNOT_CHANGE_PRICE', Number((await admin.from('products').select('price').eq('id', product.id).single()).data.price) === Number(productBefore));
  check('RIDER_CANNOT_CONFIRM_PAYMENT', denied(await riderA.c.rpc('confirm_manual_order_payment', { p_order_id: order.id, p_expected_revision: assigned.revision, p_actual_method: 'cash', p_idempotency_key: 'rls_rider_pay_001' })));
  check('RIDER_CANNOT_COMPLETE_WITHOUT_CODE', denied(await riderA.c.rpc('confirm_delivery_code', { p_order_id: order.id, p_expected_revision: assigned.revision, p_delivery_code: '0000', p_idempotency_key: `rls-a-code-${order.id}` })));
  check('ASSIGNED_TO_RIDER_A', assigned.assigned_rider_user_id === riderA.id);

  // ---------- business A vs B ----------
  if (B) {
    for (const table of ['orders', 'business_members', 'order_events', 'business_access_requests', 'operational_alerts', 'inventory_movements']) {
      check(`STAFF_A_NO_ROWS_OF_B_${table}`, noRows(await staff.c.from(table).select('*').eq('business_id', B).limit(5)));
    }
    check('STAFF_A_CANNOT_LIST_B_REQUESTS', denied(await staff.c.rpc('identity_list_access_requests', { p_business_id: B, p_status: 'pending' })));
    check('OWNER_A_CANNOT_LIST_B_PAYMENTS', denied(await owner.c.rpc('list_business_payments', { p_business_id: B })));
    check('OWNER_A_CANNOT_SET_B_POLICY', denied(await owner.c.rpc('set_business_rider_presence_policy', { p_business_id: B, p_required: false })));
    check('STAFF_A_CANNOT_REGISTER_IN_B', denied(await staff.c.rpc('identity_register_session', { p_business_id: B, p_client: 'panel_web', p_device_label: 'rls', p_device_key_hash: null, p_app_version: 'cp-rls' })));
    const otherCredential = opt('--other-staff-credential');
    if (otherCredential) {
      const staffB = await member(otherCredential, 'panel_web', 'staffB', B);
      check('STAFF_B_CANNOT_READ_A_ORDER', noRows(await staffB.c.from('orders').select('id').eq('id', order.id)));
      check('STAFF_B_CANNOT_TRANSITION_A_ORDER', denied(await staffB.c.rpc('transition_order', { p_order_id: order.id, p_expected_revision: assigned.revision, p_new_status: 'on_the_way', p_idempotency_key: 'rls_staffb_0001' })));
      check('STAFF_B_CANNOT_CANCEL_A_ORDER', denied(await staffB.c.rpc('cancel_order', { p_order_id: order.id, p_expected_revision: assigned.revision, p_reason: 'rls cruzado', p_idempotency_key: 'rls_staffb_0002' })));
    }
  }
} finally {
  for (const id of createdOrders) {
    try { await cleanupQaOrder({ admin, owner: owner.c, staff: staff.c, businessId: A, orderId: id, reason: 'QA RLS final' }); }
    catch (error) { failures.push(`CLEANUP:${error.message}`); }
  }
  for (const r of [riderA, riderB]) {
    const board = (await r.c.rpc('get_rider_delivery_board')).data;
    if (board?.available) await r.c.rpc('set_rider_availability', { p_business_id: A, p_available: false, p_expected_version: board.availability_version || 0, p_idempotency_key: `rls-off-${randomUUID()}` });
  }
  if (qaWindow) {
    try { await qaWindow.close(); } catch (error) { failures.push(`QA_WINDOW:${error.message}`); }
    check('ANON_NO_PRODUCTS_OF_CLOSED_QA_TENANT', noRows(await client().from('products').select('id').eq('business_id', A).limit(1)));
  }
}
const report = { timestamp: new Date().toISOString(), target: TARGET, project: keys.ref, crossTenant: Boolean(B),
  checks, failures, verdict: failures.length ? 'FAIL' : 'PASS' };
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ out: OUT, verdict: report.verdict, passed: Object.values(checks).filter((v) => v === 'PASS').length, failures }, null, 1));
process.exit(failures.length ? 1 : 0);
