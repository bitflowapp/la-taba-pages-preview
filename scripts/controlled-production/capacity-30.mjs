// Capacity + concurrency certification for the controlled rollout
// (1 business, <= 3 riders, ~30 customers). Real Supabase project, real
// sessions: anonymous customers, password QA operators and QA riders. The
// secret key is used ONLY for final integrity reads, QA classification and
// provisioning QA riders through the domain path; it never simulates a client.
//
// Workload: 30 browsing visitors with realtime, 10 carts, 8 near-simultaneous
// orders (incl. double click, retry after a lost response and a last-units
// stock race), 2 operators on the same order (two tabs), up to 3 riders, a
// contested offer hand-over, GPS samples, wrong/right delivery codes, double
// delivery confirmation, double manual payment confirmation and double
// cancellation. Everything created is reversed/cancelled through RPCs,
// classified as QA and its stock restored, also when the run fails midway.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { readQaCredential } from './qa-credentials.mjs';
import { loadTargetKeys } from './target-keys.mjs';
import { ensureQaMember, signIn } from './accounts.mjs';
import { cleanupQaOrder } from './qa-cleanup.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback = '') => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const TARGET = opt('--target');
assert.ok(['staging', 'controlled-production'].includes(TARGET), 'EXPLICIT_TARGET_REQUIRED');
const PROFILES = {
  staging: {
    business: 'a57b1c20-0f4e-4a6b-9d31-7c2e5f8a41d0',
    owner: 'STAGING PILOT OWNER QA 20260923', staff: 'STAGING PILOT STAFF QA 20260923',
    riderPrefix: 'STAGING CP CAPACITY RIDER', riderEmail: (n) => `cp.capacity.rider${n}@qa.lataba.invalid`,
    address: { neighborhood: 'Centro', city: 'Neuquén Capital', lat: -38.9516, lng: -68.0591 },
  },
  'controlled-production': {
    business: opt('--business-id'),
    owner: 'CP QA OWNER', staff: 'CP QA STAFF',
    riderPrefix: 'CP QA RIDER', riderEmail: (n) => `cp.qa.rider${n}@qa.lataba.invalid`,
    address: { neighborhood: opt('--neighborhood'), city: opt('--city', 'Neuquén Capital'),
      lat: Number(opt('--lat')), lng: Number(opt('--lng')) },
  },
};
const P = PROFILES[TARGET];
const VISITORS = Number(opt('--visitors', '30'));
const CARTS = Number(opt('--carts', '10'));
const ORDERS = Number(opt('--orders', '8'));
const RIDERS = Number(opt('--riders', '3'));
const BROWSE_SECONDS = Number(opt('--browse-seconds', '150'));
const NOTES = 'QA capacidad — no despachar';
// --no-secret: CI mode. Integrity reads and QA classification run with the QA
// owner session (owner/admin may classify); riders must already be members.
const NO_SECRET = args.includes('--no-secret');
const OUT = opt('--out', `artifacts/controlled-production/capacity-${TARGET}-${Date.now()}.json`);
const OPTIONS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (a, b) => a + Math.floor(Math.random() * (b - a));
const T0 = Date.now();
const log = (msg) => process.stderr.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${msg}\n`);

// ---------- metrics ----------
const samples = new Map();
const unexpected = [];
const findings = [];
function record(name, ms, ok, detail = '') {
  const bucket = samples.get(name) || { ms: [], errors: 0 };
  bucket.ms.push(ms);
  if (!ok) { bucket.errors += 1; unexpected.push({ name, detail: String(detail).slice(0, 160) }); }
  samples.set(name, bucket);
}
// `allow`: error codes that are the correct answer of a concurrency probe
// (a losing tab, a lost race). They are measured, not counted as errors.
async function timed(name, fn, { allow = [] } = {}) {
  const t = performance.now();
  try {
    const result = await fn();
    const error = result?.error;
    const ok = !error || allow.includes(error.code) || allow.includes('*');
    record(name, performance.now() - t, ok, error ? `${error.code || ''} ${error.message || ''}` : '');
    return result;
  } catch (error) {
    record(name, performance.now() - t, false, error.message);
    return { error: { code: 'EXCEPTION', message: error.message } };
  }
}
function summary() {
  const out = {}; let total = 0; let errors = 0; const all = [];
  for (const [name, b] of samples) {
    const s = [...b.ms].sort((x, y) => x - y);
    const pct = (p) => Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]);
    out[name] = { n: s.length, errors: b.errors, avg: Math.round(s.reduce((a, x) => a + x, 0) / s.length),
      p50: pct(0.5), p95: pct(0.95), max: Math.round(s[s.length - 1]) };
    total += s.length; errors += b.errors; all.push(...s);
  }
  all.sort((x, y) => x - y);
  return { perOperation: out, totalRequests: total, errors, errorRate: total ? +(errors / total).toFixed(4) : 0,
    avgMs: Math.round(all.reduce((a, x) => a + x, 0) / (all.length || 1)),
    p95Ms: Math.round(all[Math.floor(0.95 * all.length)] || 0) };
}
function finding(severity, code, detail) { findings.push({ severity, code, detail }); log(`FINDING ${severity} ${code} ${detail}`); }
const codeOf = (r) => r?.error?.code || r?.data?.code || (r?.data?.ok === false ? 'refused' : 'ok');

// ---------- setup ----------
const keys = await loadTargetKeys(TARGET, { requireSecret: !NO_SECRET });
const business = P.business;
assert.match(business || '', /^[0-9a-f-]{36}$/, 'BUSINESS_ID_REQUIRED');
assert.ok(Number.isFinite(P.address.lat) && Number.isFinite(P.address.lng) && P.address.neighborhood, 'QA_ADDRESS_REQUIRED');
let admin = NO_SECRET ? null : createClient(keys.url, keys.secret, OPTIONS);
const client = (headers) => createClient(keys.url, keys.publishable, headers ? { ...OPTIONS, global: { headers } } : OPTIONS);
const rpc = (c, name, a, opts) => timed(name, () => c.rpc(name, a), opts);
const report = { timestamp: new Date().toISOString(), target: TARGET, project: keys.ref,
  businessType: 'QA', config: { VISITORS, CARTS, ORDERS, RIDERS, BROWSE_SECONDS } };
const journalFile = path.join('.local', `capacity-journal-${T0}.json`);
mkdirSync('.local', { recursive: true });
const journal = (orders) => writeFileSync(journalFile, JSON.stringify({ target: TARGET, business, since: new Date(T0).toISOString(),
  notes: NOTES, orders: orders.map((o) => ({ id: o.id, label: o.label })) }));

async function operator(credentialName, label) {
  const stored = readQaCredential(credentialName);
  assert.ok(stored?.secreto, `QA_CREDENTIAL_REQUIRED:${credentialName}`);
  const c = client();
  const user = await signIn(c, stored.usuario, stored.secreto);
  const reg = await rpc(c, 'identity_register_session', { p_business_id: business, p_client: 'panel_web',
    p_device_label: `Capacity ${label}`, p_device_key_hash: null, p_app_version: 'cp-capacity' });
  assert.ok(reg.data?.ok, `OPERATOR_SESSION_REFUSED:${label}:${codeOf(reg)}:${reg.error?.message || ''}`);
  return { c, id: user.id, role: reg.data.role, label };
}
const owner = await operator(P.owner, 'owner');
const staff = await operator(P.staff, 'staff');
assert.ok(['owner', 'admin'].includes(owner.role), 'OWNER_ROLE_REQUIRED');
admin ||= owner.c;

const availability = (await rpc(staff.c, 'commerce_availability',
  { p_business_id: business, p_channel: 'delivery', p_context: {} })).data;
assert.ok(availability?.is_open && availability.ordering_ready, 'BUSINESS_NOT_OPEN_FOR_QA');
const area = availability.areas?.find((a) => a.name === P.address.neighborhood);
assert.ok(area, 'QA_NEIGHBORHOOD_NOT_IN_COVERAGE');
const minimum = Number(area.minimum_subtotal || 0);

const productsRead = await staff.c.from('products').select('id,name,price,stock')
  .eq('business_id', business).eq('available', true).eq('is_active', true)
  .eq('is_verified', true).eq('is_alcoholic', false).gt('stock', 0).gt('price', 0)
  .order('stock', { ascending: false });
assert.ifError(productsRead.error);
const products = productsRead.data;
const initialStock = new Map(products.map((p) => [p.id, Number(p.stock)]));
const qtyFor = (p) => Math.max(1, Math.ceil((minimum + 1) / Number(p.price)));
const race = products[0];
const raceQty = Math.floor(Number(race.stock) / 2) + 1;
assert.ok(raceQty * Number(race.price) > minimum && raceQty <= Number(race.stock), 'RACE_PRODUCT_UNSUITABLE');
const others = products.slice(1).filter((p) => Number(p.stock) >= qtyFor(p));
assert.ok(others.length >= 3, 'NEED_3_MORE_PRODUCTS_WITH_ENOUGH_STOCK');
report.stock = { products: products.length, raceProductStockBefore: Number(race.stock), raceQty };

// Riders: QA identities through request/approve, sessions as Android, available.
const riders = [];
for (let n = 1; n <= RIDERS; n += 1) {
  const member = NO_SECRET ? await (async () => {
    const stored = readQaCredential(`${P.riderPrefix} ${n}`);
    assert.ok(stored?.secreto, `QA_RIDER_CREDENTIAL_REQUIRED:${n}`);
    const c = client();
    const user = await signIn(c, stored.usuario, stored.secreto);
    return { client: c, userId: user.id };
  })() : await ensureQaMember({ keys, businessId: business, reviewerClient: owner.c,
    credentialName: `${P.riderPrefix} ${n}`, email: P.riderEmail(n), fullName: `QA Rider capacidad ${n}`,
    access: 'rider', role: 'rider', phone: `29955501${String(n).padStart(2, '0')}` });
  const reg = await rpc(member.client, 'identity_register_session', { p_business_id: business,
    p_client: 'rider_android', p_device_label: `Capacity rider ${n}`, p_device_key_hash: null,
    p_app_version: 'cp-capacity' });
  assert.ok(reg.data?.ok && reg.data.role === 'rider', `RIDER_SESSION_REFUSED:${n}:${codeOf(reg)}:${reg.error?.message || ''}`);
  const board = (await rpc(member.client, 'get_rider_delivery_board', {})).data;
  assert.ok(board, `RIDER_BOARD_UNAVAILABLE:${n}`);
  assert.equal((board.orders || []).length, 0, `RIDER_HAS_ACTIVE_ORDERS:${n}`);
  const set = await rpc(member.client, 'set_rider_availability', { p_business_id: business, p_available: true,
    p_expected_version: board.availability_version || 0, p_idempotency_key: `cap-on-${randomUUID()}` });
  assert.ok(set.data?.ok, `RIDER_AVAILABILITY_REFUSED:${n}:${codeOf(set)}`);
  await rpc(member.client, 'heartbeat_rider_availability', { p_business_id: business });
  riders.push({ n, c: member.client, id: member.userId, handled: new Set(), accepted: 0 });
}
log(`setup ok: ${products.length} products, ${riders.length} riders, minimum ${minimum}`);
// Presence expires without heartbeats (90 s): keep riders available like the app.
const heartbeat = setInterval(() => {
  for (const r of riders) void rpc(r.c, 'heartbeat_rider_availability', { p_business_id: business });
}, 20_000);

const orders = [];
const channels = [];
const operatorBoards = [];
const trackers = [];
const realtime = { attempted: 0, subscribed: 0, errors: 0, closed: 0, events: 0, operatorEvents: 0 };
const anonOrderRows = { requests: 0, rowsVisible: 0 };
let trackingStop = false;
let ridersStop = false;
let visitorsDone = Promise.resolve();
let raceOrder = null;
let deliverable = [];

const read = async (c, id) => (await c.from('orders').select('id,status,revision,manual_payment_status,assigned_rider_user_id').eq('id', id).single()).data;
const key = (op, id, rev) => `cap_${op}_${id.replaceAll('-', '')}_${rev}`.slice(0, 120);

try {
  // ---------- phase 1: visitors ----------
  const stopAt = Date.now() + BROWSE_SECONDS * 1000;
  const visitor = async (i) => {
    await sleep(i * 400);
    const c = client();
    await Promise.all([
      timed('browse.businesses', () => c.from('businesses').select('id,name,ordering_enabled,delivery_fee,minimum_delivery_subtotal,status').eq('id', business).limit(1)),
      timed('browse.products', () => c.from('products').select('id,sku,name,price,stock,available,category,image_url').eq('business_id', business).eq('available', true).eq('is_active', true)),
      (async () => {
        const r = await timed('browse.orders_anon', () => c.from('orders').select('id').eq('business_id', business).limit(100));
        anonOrderRows.requests += 1; anonOrderRows.rowsVisible += (r.data || []).length;
      })(),
      rpc(c, 'commerce_availability', { p_business_id: business, p_channel: 'delivery', p_context: {} }),
      rpc(c, 'get_public_business_contact', { p_business_id: business }),
    ]);
    realtime.attempted += 1;
    const channel = c.channel(`cap-visitor-${i}-${randomBytes(3).toString('hex')}`);
    for (const [table, filter] of [['orders', `business_id=eq.${business}`], ['products', `business_id=eq.${business}`], ['businesses', `id=eq.${business}`]]) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table, filter }, () => { realtime.events += 1; });
    }
    const subscribedAt = performance.now();
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') { realtime.subscribed += 1; record('realtime.subscribe', performance.now() - subscribedAt, true); }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { realtime.errors += 1; record('realtime.subscribe', performance.now() - subscribedAt, false, status); }
      else if (status === 'CLOSED') realtime.closed += 1;
    });
    channels.push({ c, channel });
    while (Date.now() < stopAt) {
      await sleep(jitter(15_000, 30_000));
      if (Date.now() >= stopAt) break;
      await Promise.all([
        timed('browse.products', () => c.from('products').select('id,sku,name,price,stock,available').eq('business_id', business).eq('available', true).eq('is_active', true)),
        rpc(c, 'commerce_availability', { p_business_id: business, p_channel: 'delivery', p_context: {} }),
      ]);
    }
  };
  visitorsDone = Promise.all(Array.from({ length: VISITORS }, (_, i) => visitor(i)));

  // Operators: realtime-driven board refresh like the panel.
  for (const op of [owner, staff]) {
    const channel = op.c.channel(`cap-panel-${op.label}-${randomBytes(3).toString('hex')}`);
    let pending = null;
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `business_id=eq.${business}` }, () => {
      realtime.operatorEvents += 1;
      if (pending) return;
      pending = setTimeout(async () => {
        pending = null;
        await timed('panel.list_orders', () => op.c.from('orders').select('*,order_items(*)').eq('business_id', business).order('created_at', { ascending: false }).limit(100));
      }, 400);
    });
    channel.subscribe();
    operatorBoards.push({ op, channel });
  }

  // ---------- phase 2: carts and near-simultaneous orders ----------
  await sleep(20_000);
  log('carts');
  await Promise.all(Array.from({ length: CARTS }, async () => {
    const c = client();
    await rpc(c, 'commerce_availability', { p_business_id: business, p_channel: 'delivery', p_context: {} });
    await timed('cart.products_recheck', () => c.from('products').select('id,price,stock,available').eq('business_id', business).in('id', products.slice(0, 4).map((p) => p.id)));
    await sleep(jitter(500, 3000));
  }));
  report.carts = { built: CARTS, checkout: ORDERS, abandoned: CARTS - ORDERS };
  const prepareCustomer = async (k) => {
    const c = client();
    const anon = await timed('customer.sign_in_anonymous', () => c.auth.signInAnonymously({ options: { data: { taba_actor: 'customer' } } }));
    if (anon.error || !anon.data?.session) throw Error(`ANON_SIGNIN_FAILED:${anon.error?.code || anon.error?.status}`);
    const profile = await rpc(c, 'upsert_current_customer_profile', { p_name: `QA Carga ${k}`, p_phone: `29955502${String(k).padStart(2, '0')}` });
    if (profile.error) throw Error(`PROFILE_FAILED:${profile.error.code}`);
    const saved = await rpc(c, 'upsert_current_customer_address', { p_address: {
      label: 'Casa', street: 'Calle QA', streetNumber: String(100 + k), city: P.address.city,
      neighborhood: P.address.neighborhood, latitude: +(P.address.lat + (Math.random() - 0.5) * 0.004).toFixed(6),
      longitude: +(P.address.lng + (Math.random() - 0.5) * 0.004).toFixed(6), geolocationAccuracy: 12,
      source: 'gps', locationSource: 'map_pin', locationConfirmedAt: new Date().toISOString(), isDefault: true } });
    const addressId = saved.data?.address?.id || saved.data?.id;
    if (saved.error || !addressId) throw Error(`ADDRESS_FAILED:${saved.error?.code || 'NO_ID'}`);
    return { c, addressId, k };
  };
  const customers = await Promise.all(Array.from({ length: ORDERS }, (_, i) => prepareCustomer(i + 1)));
  const plan = customers.map((cust, idx) => {
    if (idx === 2 || idx === 3) return { cust, label: idx === 2 ? 'race_a' : 'race_b', productId: race.id, qty: raceQty };
    const p = others[idx % others.length];
    return { cust, label: idx === 0 ? 'double_click' : idx === 1 ? 'retry_after_loss' : `normal_${idx}`, productId: p.id, qty: qtyFor(p) };
  });
  for (const item of plan) {
    item.payload = { business_id: business, client_request_id: randomUUID(), tracking_token: randomBytes(32).toString('base64url'),
      items: [{ product_id: item.productId, quantity: item.qty }], customer_name: `QA Carga ${item.cust.k}`,
      customer_phone: `29955502${String(item.cust.k).padStart(2, '0')}`, delivery_mode: 'delivery',
      payment_method: item.label === 'normal_4' ? 'coordinate' : 'cash', age_confirmed: true,
      customer_address_id: item.cust.addressId, customer_street_address: `Calle QA ${100 + item.cust.k}`,
      customer_neighborhood: P.address.neighborhood, customer_notes: NOTES };
  }
  report.plannedRequestIds = plan.length;
  log('orders: firing simultaneously');
  const create = (item, name = 'order.create', allow = []) => timed(name, () => item.cust.c.rpc('create_order_with_items', { payload: item.payload }), { allow });
  const results = await Promise.all(plan.map(async (item) => {
    if (item.label === 'double_click') {
      const [a, b] = await Promise.all([create(item), create(item, 'order.create_double_click')]);
      const ids = [a.data?.id, b.data?.id].filter(Boolean);
      report.doubleClick = { codes: [codeOf(a), codeOf(b)], distinctIds: new Set(ids).size };
      if (new Set(ids).size !== 1) finding('P0', 'DOUBLE_CLICK_DUPLICATE_OR_FAILED', JSON.stringify(report.doubleClick));
      return { item, res: a.data?.id ? a : b };
    }
    if (item.label.startsWith('race_')) return { item, res: await create(item, 'order.create_race', ['23514', 'P0001', '22023', '55000']) };
    const res = await create(item);
    if (item.label === 'retry_after_loss') {
      const retry = await create(item, 'order.create_retry');
      report.retryAfterLoss = { sameOrder: retry.data?.id === res.data?.id, code: codeOf(retry) };
      if (retry.error || retry.data?.id !== res.data?.id) finding('P0', 'RETRY_CREATED_DUPLICATE_OR_FAILED', codeOf(retry));
    }
    return { item, res };
  }));
  const raceResults = results.filter((r) => r.item.label.startsWith('race_'));
  report.stockRace = { attempts: raceResults.length, accepted: raceResults.filter((r) => r.res.data?.id).length,
    rejectionCodes: raceResults.filter((r) => r.res.error).map((r) => r.res.error.code) };
  if (report.stockRace.accepted !== 1) finding('P0', 'STOCK_RACE_NOT_EXACTLY_ONE_WINNER', JSON.stringify(report.stockRace));
  for (const { item, res } of results) {
    if (!res.data?.id) { if (!item.label.startsWith('race_')) finding('P1', 'ORDER_CREATE_FAILED', `${item.label}:${codeOf(res)}`); continue; }
    const row = Array.isArray(res.data) ? res.data[0] : res.data;
    const order = { label: item.label, id: row.id, publicCode: row.public_code, clientRequestId: item.payload.client_request_id,
      tracking: item.payload.tracking_token, productId: item.productId, qty: item.qty,
      code: row.delivery_code ? String(row.delivery_code) : null };
    if (!order.code) {
      const issued = await rpc(item.cust.c, 'issue_order_delivery_code', { p_order_id: order.id, p_tracking_token: order.tracking });
      order.code = issued.data?.delivery_code ? String(issued.data.delivery_code) : null;
    }
    if (!/^[0-9]{4}$/.test(order.code || '')) finding('P1', 'DELIVERY_CODE_NOT_ISSUED', order.label);
    orders.push(order);
  }
  journal(orders);
  report.orders = { attempted: plan.length, created: orders.length };
  report.requestIds = plan.map((p) => p.payload.client_request_id);
  log(`orders created: ${orders.length}`);

  // Customer tracking: polling with the order token, like the web.
  for (const o of orders) {
    const tc = client({ 'x-order-token': o.tracking });
    trackers.push((async () => {
      while (!trackingStop) {
        const r = await rpc(tc, 'get_public_order_tracking', { p_public_id: o.publicCode });
        if (r.data?.status) o.lastPublicStatus = r.data.status;
        await sleep(5000);
      }
    })());
  }

  // ---------- phase 3: business operation ----------
  deliverable = orders.filter((o) => !o.label.startsWith('race_'));
  raceOrder = orders.find((o) => o.label.startsWith('race_')) || null;
  const transition = async (op, o, next) => {
    const cur = await read(op.c, o.id);
    const r = await rpc(op.c, 'transition_order', { p_order_id: o.id, p_expected_revision: cur.revision, p_new_status: next, p_idempotency_key: key(next, o.id, cur.revision) });
    if (r.error || r.data?.ok === false) finding('P1', 'TRANSITION_FAILED', `${o.label}:${cur.status}->${next}:${codeOf(r)}`);
  };
  if (deliverable[0]) {
    const cur = await read(staff.c, deliverable[0].id);
    const [a, b] = await Promise.all([owner, staff].map((op) => rpc(op.c, 'transition_order', {
      p_order_id: deliverable[0].id, p_expected_revision: cur.revision, p_new_status: 'accepted',
      p_idempotency_key: key(`accept_${op.label}`, deliverable[0].id, cur.revision) }, { allow: ['40001'] })));
    const after = await read(staff.c, deliverable[0].id);
    report.twoTabs = { codes: [codeOf(a), codeOf(b)], finalStatus: after.status, revisionDelta: after.revision - cur.revision };
    const wins = [a, b].filter((r) => !r.error && r.data?.ok !== false).length;
    if (wins !== 1 || after.status !== 'accepted') finding('P0', 'TWO_TABS_NOT_EXACTLY_ONE_TRANSITION', JSON.stringify(report.twoTabs));
  }
  await Promise.all(deliverable.map(async (o, i) => {
    const op = i % 2 ? owner : staff;
    const cur = await read(op.c, o.id);
    if (['received', 'submitted', 'draft'].includes(cur.status)) await transition(op, o, 'accepted');
    await transition(op, o, 'preparing');
    await transition(op, o, 'ready');
  }));
  log('transitions done');

  // Manual payment twice (same key, concurrent) + a second key at the same revision.
  report.manualPayment = [];
  for (const o of deliverable.filter((x) => x.label !== 'normal_4').slice(0, 2)) {
    const cur = await read(staff.c, o.id);
    const k = key('pay', o.id, cur.revision);
    const pay = () => rpc(staff.c, 'confirm_manual_order_payment', { p_order_id: o.id, p_expected_revision: cur.revision, p_actual_method: 'cash', p_idempotency_key: k });
    const [a, b] = await Promise.all([pay(), pay()]);
    const third = await rpc(owner.c, 'confirm_manual_order_payment', { p_order_id: o.id, p_expected_revision: cur.revision, p_actual_method: 'cash', p_idempotency_key: key('pay2', o.id, cur.revision) }, { allow: ['40001', '55000', 'P0001'] });
    const events = await admin.from('order_events').select('id').eq('order_id', o.id).eq('event_type', 'order.manual_payment_confirmed');
    const state = await read(staff.c, o.id);
    const entry = { label: o.label, codes: [codeOf(a), codeOf(b), codeOf(third)], replays: [a, b].filter((r) => r.data?.idempotent_replay).length, events: events.data?.length, status: state.manual_payment_status };
    report.manualPayment.push(entry);
    if (entry.events !== 1 || state.manual_payment_status !== 'confirmed') finding('P0', 'MANUAL_PAYMENT_NOT_EXACTLY_ONCE', JSON.stringify(entry));
  }

  // Double cancellation of the stock-race winner: its stock must come back once.
  if (raceOrder) {
    const stockOf = async () => Number((await staff.c.from('products').select('stock').eq('id', race.id).single()).data.stock);
    const before = await stockOf();
    const cur = await read(staff.c, raceOrder.id);
    const argsCancel = { p_order_id: raceOrder.id, p_expected_revision: cur.revision, p_reason: 'QA capacidad: cancelación doble', p_idempotency_key: key('cancel', raceOrder.id, cur.revision) };
    const [a, b] = await Promise.all([rpc(staff.c, 'cancel_order', argsCancel), rpc(staff.c, 'cancel_order', argsCancel)]);
    const other = await rpc(owner.c, 'cancel_order', { ...argsCancel, p_idempotency_key: key('cancel2', raceOrder.id, cur.revision) }, { allow: ['40001', 'P0001', '55000'] });
    const after = await stockOf();
    report.doubleCancel = { restored: after - before, expected: raceOrder.qty, codes: [codeOf(a), codeOf(b), codeOf(other)],
      replays: [a, b].filter((r) => r.data?.idempotent_replay).length };
    if (after - before !== raceOrder.qty) finding('P0', 'DOUBLE_STOCK_RETURN_OR_MISSING_RETURN', JSON.stringify(report.doubleCancel));
    raceOrder.cancelled = true;
  }

  // Offers: each deliverable order to one rider.
  for (const [i, o] of deliverable.entries()) {
    const rider = riders[i % riders.length];
    const r = await rpc(staff.c, 'offer_order_to_rider', { p_order_id: o.id, p_expected_status: 'ready', p_expected_rider_user_id: null, p_new_rider_user_id: rider.id });
    if (r.error || r.data?.ok === false) finding('P1', 'OFFER_FAILED', `${o.label}->rider${rider.n}:${codeOf(r)}`);
  }
  // Contested hand-over: rider A accepts while the business withdraws A's offer
  // and offers the same order to rider B, who accepts too. Exactly one wins.
  if (riders.length > 1 && deliverable[0]) {
    const o = deliverable[0]; const a = riders[0]; const b = riders[1];
    const second = await rpc(staff.c, 'offer_order_to_rider', { p_order_id: o.id, p_expected_status: 'ready', p_expected_rider_user_id: null, p_new_rider_user_id: b.id });
    const boardA = (await rpc(a.c, 'get_rider_delivery_board', {})).data;
    const offerA = (boardA?.offers || []).find((x) => x.order_id === o.id);
    if (!offerA) finding('P1', 'OFFER_NOT_VISIBLE_TO_RIDER', `${o.label}:board_offers=${(boardA?.offers || []).length}`);
    else {
      a.handled.add(offerA.offer_id);
      const [acceptA, handover] = await Promise.all([
        rpc(a.c, 'accept_rider_order_offer', { p_offer_id: offerA.offer_id, p_expected_version: offerA.version, p_idempotency_key: `cap-${offerA.offer_id}-${offerA.version}` }),
        (async () => {
          const w = await rpc(staff.c, 'withdraw_rider_order_offer', { p_offer_id: offerA.offer_id });
          const re = await rpc(staff.c, 'offer_order_to_rider', { p_order_id: o.id, p_expected_status: 'ready', p_expected_rider_user_id: null, p_new_rider_user_id: b.id }, { allow: ['40001', '42501', 'P0001'] });
          const boardB = (await rpc(b.c, 'get_rider_delivery_board', {})).data;
          const offerB = (boardB?.offers || []).find((x) => x.order_id === o.id);
          if (offerB) b.handled.add(offerB.offer_id);
          const acceptB = offerB ? await rpc(b.c, 'accept_rider_order_offer', { p_offer_id: offerB.offer_id, p_expected_version: offerB.version, p_idempotency_key: `cap-${offerB.offer_id}-${offerB.version}` }) : null;
          return { withdraw: codeOf(w), reoffer: codeOf(re), acceptB: acceptB ? codeOf(acceptB) : 'no_offer' };
        })(),
      ]);
      const assigned = (await read(staff.c, o.id)).assigned_rider_user_id;
      const winners = [codeOf(acceptA) === 'accepted', handover.acceptB === 'accepted'].filter(Boolean).length;
      report.offerRace = { secondOfferWhilePending: codeOf(second), acceptA: codeOf(acceptA), ...handover, winners,
        assignedTo: assigned === a.id ? 'A' : assigned === b.id ? 'B' : assigned ? 'OTHER' : 'NONE' };
      if (winners !== 1 || !['A', 'B'].includes(report.offerRace.assignedTo)) finding('P0', 'CONTESTED_OFFER_NOT_EXACTLY_ONE_RIDER', JSON.stringify(report.offerRace));
    }
  }
  log('offers done; riders delivering');

  // ---------- riders ----------
  const riderLoop = async (rider) => {
    while (!ridersStop) {
      const board = (await rpc(rider.c, 'get_rider_delivery_board', {})).data;
      for (const offer of board?.offers || []) {
        if (rider.handled.has(offer.offer_id)) continue;
        rider.handled.add(offer.offer_id);
        const r = await rpc(rider.c, 'accept_rider_order_offer', { p_offer_id: offer.offer_id, p_expected_version: offer.version, p_idempotency_key: `cap-${offer.offer_id}-${offer.version}` });
        if (codeOf(r) === 'accepted') rider.accepted += 1;
        else finding('P1', 'RIDER_ACCEPT_REFUSED', `rider${rider.n}:${codeOf(r)}`);
      }
      for (const o of board?.orders || []) {
        const order = orders.find((x) => x.id === o.id);
        if (!order || order.delivered) continue;
        const step = { assigned: 'mark_delivery_picked_up', picked_up: 'start_rider_delivery', on_the_way: 'mark_rider_arrived' }[o.status];
        if (step) {
          const r = await rpc(rider.c, step, { p_order_id: o.id, p_expected_revision: o.revision, p_idempotency_key: `cap-${step}-${o.id}-${o.revision}` });
          if (r.error || r.data?.ok === false) finding('P1', 'RIDER_STEP_FAILED', `${order.label}:${step}:${codeOf(r)}`);
          if (step !== 'mark_rider_arrived') {
            for (let s = 0; s < 2; s += 1) {
              const g = await rpc(rider.c, 'publish_rider_location_fanout', { p_lat: P.address.lat + s * 0.0005, p_lng: P.address.lng, p_accuracy: 8, p_heading: null, p_speed: 4, p_captured_at: new Date().toISOString(), p_idempotency_key: randomUUID(), p_is_mock: false });
              if (g.error || g.data?.ok === false) finding('P1', 'GPS_PUBLISH_REFUSED', `${order.label}:${codeOf(g)}`);
            }
          }
        } else if (o.status === 'arrived') {
          const wrong = String((Number(order.code) + 1) % 10000).padStart(4, '0');
          const bad = await rpc(rider.c, 'confirm_delivery_code', { p_order_id: o.id, p_expected_revision: o.revision, p_delivery_code: wrong, p_idempotency_key: `cap-wrong-${o.id}-${o.revision}` }, { allow: ['*'] });
          const still = await read(staff.c, o.id);
          order.wrongCode = codeOf(bad);
          if (still.status === 'delivered') finding('P0', 'WRONG_CODE_DELIVERED', order.label);
          const argsOk = { p_order_id: o.id, p_expected_revision: still.revision, p_delivery_code: order.code, p_idempotency_key: `cap-code-${o.id}-${still.revision}` };
          const [x, y] = await Promise.all([rpc(rider.c, 'confirm_delivery_code', argsOk), rpc(rider.c, 'confirm_delivery_code', argsOk)]);
          order.confirmCodes = [codeOf(x), codeOf(y)];
          const done = await read(staff.c, o.id);
          if (done.status !== 'delivered') finding('P1', 'DELIVERY_NOT_COMPLETED', `${order.label}:${order.confirmCodes}`);
          else order.delivered = true;
        }
      }
      await sleep(3000);
    }
  };
  const riderLoops = riders.map(riderLoop);
  const deadline = Date.now() + 360_000;
  while (Date.now() < deadline && deliverable.some((o) => !o.delivered)) await sleep(3000);
  ridersStop = true; await Promise.all(riderLoops);
  for (const o of deliverable.filter((x) => !x.delivered)) finding('P1', 'ORDER_NOT_DELIVERED_IN_TIME', o.label);
  report.delivery = { deliverable: deliverable.length, delivered: deliverable.filter((o) => o.delivered).length,
    wrongCodeAnswers: [...new Set(deliverable.map((o) => o.wrongCode).filter(Boolean))],
    doubleConfirm: deliverable.filter((o) => o.confirmCodes).map((o) => o.confirmCodes.join('/')),
    riders: riders.map((r) => ({ n: r.n, accepted: r.accepted })) };
  log(`delivered ${report.delivery.delivered}/${deliverable.length}`);
  await sleep(6000);
} catch (error) {
  finding('P1', 'HARNESS_EXCEPTION', error.message);
} finally {
  ridersStop = true;
  trackingStop = true;
  clearInterval(heartbeat);
  await Promise.all(trackers);
  report.tracking = orders.map((o) => ({ label: o.label, lastPublicStatus: o.lastPublicStatus || null }));
  for (const o of deliverable.filter((x) => x.delivered)) if (o.lastPublicStatus !== 'delivered') finding('P1', 'CUSTOMER_TRACKING_STALE', `${o.label}:${o.lastPublicStatus}`);
  await visitorsDone;
  for (const { c, channel } of channels) await c.removeChannel(channel).catch(() => {});
  for (const { op, channel } of operatorBoards) await op.c.removeChannel(channel).catch(() => {});
  report.realtime = realtime;
  report.anonExposure = anonOrderRows;
  if (anonOrderRows.rowsVisible > 0) finding('P0', 'ANON_CAN_READ_ORDERS', `${anonOrderRows.rowsVisible}`);
  if (realtime.subscribed < realtime.attempted) finding('P1', 'REALTIME_SUBSCRIPTIONS_FAILED', `${realtime.subscribed}/${realtime.attempted}`);
  if (orders.length && realtime.operatorEvents === 0) finding('P1', 'PANEL_RECEIVED_NO_REALTIME_EVENTS', '0');

  // ---------- integrity (secret key: reads only) ----------
  const created = report.requestIds
    ? await admin.from('orders').select('id,client_request_id').in('client_request_id', report.requestIds)
    : { data: [] };
  const perRequest = new Map();
  for (const row of created.data || []) perRequest.set(row.client_request_id, (perRequest.get(row.client_request_id) || 0) + 1);
  const duplicates = [...perRequest.values()].filter((n) => n > 1).length;
  if (duplicates) finding('P0', 'DUPLICATE_ORDERS', `${duplicates}`);
  const stockNow = await admin.from('products').select('id,stock').in('id', products.map((p) => p.id));
  const negative = (stockNow.data || []).filter((p) => Number(p.stock) < 0).length;
  if (negative) finding('P0', 'NEGATIVE_STOCK', `${negative}`);
  const stockMismatch = [];
  for (const p of stockNow.data || []) {
    const held = orders.filter((o) => o.productId === p.id && !o.cancelled).reduce((a, o) => a + o.qty, 0);
    if (Number(p.stock) !== initialStock.get(p.id) - held) stockMismatch.push({ product: p.id.slice(0, 8), expected: initialStock.get(p.id) - held, actual: Number(p.stock) });
  }
  if (stockMismatch.length) finding('P0', 'STOCK_ACCOUNTING_MISMATCH', JSON.stringify(stockMismatch));
  report.integrity = { orderRows: (created.data || []).length, duplicates, negativeStock: negative, stockMismatch };

  // ---------- cleanup through RPCs ----------
  const cleanup = { orders: orders.length, results: [], failures: [] };
  for (const o of orders) {
    try { cleanup.results.push({ label: o.label, ...(await cleanupQaOrder({ admin, owner: owner.c, staff: staff.c, businessId: business, orderId: o.id, reason: 'QA capacidad controlada' })) }); }
    catch (error) { cleanup.failures.push(`${o.label}:${error.message}`); }
  }
  for (const r of riders) {
    const board = (await r.c.rpc('get_rider_delivery_board')).data;
    if (board?.available) await r.c.rpc('set_rider_availability', { p_business_id: business, p_available: false, p_expected_version: board.availability_version || 0, p_idempotency_key: `cap-off-${randomUUID()}` });
  }
  const finalStock = await admin.from('products').select('id,stock').in('id', products.map((p) => p.id));
  cleanup.stockRestored = (finalStock.data || []).every((p) => Number(p.stock) === initialStock.get(p.id));
  if (!cleanup.stockRestored) finding('P1', 'QA_STOCK_NOT_RESTORED', 'final stock differs from initial');
  if (cleanup.failures.length) finding('P1', 'QA_CLEANUP_FAILED', cleanup.failures.join(';'));
  report.cleanup = cleanup;
  delete report.requestIds;

  // ---------- verdict ----------
  report.metrics = summary();
  report.unexpectedErrors = unexpected.slice(0, 40);
  report.findings = findings;
  const p0 = findings.filter((f) => f.severity === 'P0').length;
  const p1 = findings.filter((f) => f.severity === 'P1').length;
  report.verdict = {
    LOAD_30_USERS: realtime.subscribed >= VISITORS && report.metrics.errorRate <= 0.01 && !p0 && !p1 ? 'PASS' : 'FAIL',
    CONCURRENT_CARTS: `${CARTS} carts (${ORDERS} checkout, ${CARTS - ORDERS} abandoned)`,
    CONCURRENT_ORDERS: `${report.orders?.created ?? 0} created from ${ORDERS} simultaneous checkouts (1 race loser expected)`,
    ERROR_RATE: report.metrics.errorRate, P95_APPROX_MS: report.metrics.p95Ms,
    DATA_INTEGRITY: !duplicates && !negative && !stockMismatch.length && cleanup.stockRestored && !cleanup.failures.length ? 'PASS' : 'FAIL',
    P0: p0, P1: p1,
  };
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ out: OUT, verdict: report.verdict, total: report.metrics.totalRequests, errors: report.metrics.errors, avgMs: report.metrics.avgMs, findings }, null, 1));
  process.exit(p0 || p1 ? 1 : 0);
}
