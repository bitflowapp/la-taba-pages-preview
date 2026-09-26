// Live certification of 20260926160000 (local print agents + print_jobs) and of
// the print-agent-gateway Edge Function on CONTROLLED_PRODUCTION.
//
// Only real paths: QA sessions (owner, staff, isolation owner, rider) through
// the Panel RPCs, anonymous storefront customers for the QA orders, and the
// gateway exactly as the Windows agent calls it (device credential, no Origin,
// no service_role on this side). No secret key and no SQL. Everything it
// creates lives in the QA tenants: devices end revoked, jobs end printed,
// failed or cancelled, the QA orders are cancelled (stock returns once), the
// print settings are restored and the QA window is left closed. Nothing secret
// is printed or written: no pairing code, device secret or token.
//
//   node scripts/controlled-production/verify-cp-printing.mjs --target controlled-production [--out file]
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadTargetKeys } from './target-keys.mjs';
import { readQaCredential } from './qa-credentials.mjs';
import { signIn } from './accounts.mjs';
import { cleanupQaOrder } from './qa-cleanup.mjs';
import { QA_CONTROL_BUSINESS, REAL_BUSINESS, openQaWindow } from './qa-window.mjs';

const CP_REF = 'tkanbadcglszlcyfjvpv';
const QA_ISOLATION_BUSINESS = 'dd515bdd-33bc-4a72-9e70-72d2ab8ae1f0';
const AGENT_VERSION = '0.1.0';
const PANEL_ORIGIN = 'https://la-taba-commercial-pilot.pages.dev';
const ADDRESS = { neighborhood: 'Centro', city: 'Neuquén Capital', lat: -38.9516, lng: -68.0591 };
const CUSTOMER_NAME = 'QA Impresion Cliente';
const CUSTOMER_PHONE = '2995550777';
const CUSTOMER_STREET = 'Calle QA Impresion';
const OPTIONS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const RUN = randomBytes(4).toString('hex');
const T0 = Date.now();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (msg) => process.stderr.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${msg}\n`);

const args = process.argv.slice(2);
const opt = (name, fallback = '') => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
assert.equal(opt('--target'), 'controlled-production', 'EXPLICIT_TARGET_REQUIRED');
const OUT = opt('--out', `artifacts/controlled-production/verify-cp-printing-${Date.now()}.json`);
const keys = await loadTargetKeys('controlled-production', { requireSecret: false });
assert.equal(keys.ref, CP_REF, 'NOT_CONTROLLED_PRODUCTION');
const GATEWAY = `${keys.url}/functions/v1/print-agent-gateway`;
const client = () => createClient(keys.url, keys.publishable, OPTIONS);
const anon = client();

const report = { at: new Date().toISOString(), target: 'controlled-production', ref: keys.ref, run: RUN,
  businesses: { qaControl: QA_CONTROL_BUSINESS, qaIsolation: QA_ISOLATION_BUSINESS }, checks: {}, codes: {}, counts: {} };
const pass = (name, ok, code) => {
  report.checks[name] = ok ? 'PASS' : 'FAIL';
  if (code !== undefined) report.codes[name] = code;
  log(`${name}: ${report.checks[name]}${code !== undefined ? ` (${typeof code === 'string' ? code : JSON.stringify(code)})` : ''}`);
};
const codeOf = (r) => r?.error?.code || (r?.data?.ok === false ? (r.data.code || 'refused') : 'ok');

async function operator(credential, businessId, label, clientKind = 'panel_web') {
  const stored = readQaCredential(credential);
  assert.ok(stored?.secreto, `QA_CREDENTIAL_REQUIRED:${credential}`);
  const c = client();
  const user = await signIn(c, stored.usuario, stored.secreto);
  const reg = await c.rpc('identity_register_session', { p_business_id: businessId, p_client: clientKind,
    p_device_label: `CP printing verify ${label}`, p_device_key_hash: null, p_app_version: 'cp-printing-verify' });
  assert.ok(reg.data?.ok, `SESSION_REFUSED:${label}:${codeOf(reg)}`);
  return { c, id: user.id, role: reg.data.role };
}

// ── The gateway, exactly as the Windows agent calls it ─────────────────────
async function gateway(body, { token = null, origin = null, method = 'POST' } = {}) {
  const headers = { apikey: keys.publishable, 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (origin) headers.origin = origin;
  const response = await fetch(GATEWAY, { method, headers, body: method === 'POST' ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000) });
  let json = null;
  try { json = await response.json(); } catch { json = null; }
  return { status: response.status, body: json };
}
const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
class Device {
  constructor(label) { this.label = label; this.secret = randomBytes(32).toString('base64url'); this.id = null; }
  token() { return `tla1.${this.id}.${this.secret}`; }
  call(body) { return gateway(body, { token: this.token() }); }
  async register(code) {
    const r = await gateway({ action: 'register', pairing_code: code, secret_hash: sha256(this.secret),
      device_name: `QA ${this.label} ${RUN}`, platform: 'windows', agent_version: AGENT_VERSION });
    if (r.status === 200) { this.id = r.body.device_id; this.business = r.body.business_id; }
    return r;
  }
  heartbeat(extra = {}) {
    return this.call({ action: 'heartbeat', report: { agent_version: AGENT_VERSION, queue_depth: 0,
      printers: [{ name: `QA Termica ${this.label}`, role: 'kitchen', status: 'READY' }], ...extra } });
  }
  claim(types = ['order_ticket', 'kitchen_ticket'], limit = 5) { return this.call({ action: 'claim', document_types: types, limit }); }
  update(job, transition, { token = job.claim_token, error = null } = {}) {
    return this.call({ action: 'update', job_id: job.id, claim_token: token, transition,
      ...(error ? { error_code: error } : {}), duration_ms: 25 });
  }
}

let owner; let staff; let ownerB; let rider;
const devices = [];
const orders = [];
const jobsOfRun = new Set();
let window = null;
let settingsTouched = false;

const jobRow = async (id) => (await owner.c.from('print_jobs')
  .select('id,status,attempt_count,claimed_by_device_id,reprint_of,requested_by,reprint_reason,request_source,last_error,next_attempt_at,payload')
  .eq('id', id).single()).data;
const eventsOf = async (id) => (await owner.c.from('print_job_events').select('event_type,actor_kind,from_status,to_status,detail')
  .eq('print_job_id', id).order('created_at')).data || [];
const count = (events, type) => events.filter((e) => e.event_type === type).length;
async function enqueue(orderId, type, key, who = owner) {
  const r = await who.c.rpc('request_order_print_job', { p_order_id: orderId, p_document_type: type, p_idempotency_key: key });
  if (r.data?.print_job_id) jobsOfRun.add(r.data.print_job_id);
  return r;
}
async function claimUntil(device, jobId, types, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await device.claim(types, 10);
    const found = (r.body?.jobs || []).find((j) => j.id === jobId);
    for (const other of (r.body?.jobs || [])) {
      if (other.id !== jobId) await device.update(other, 'not_printed', { error: 'QA_NOT_THIS_ONE' });
    }
    if (found) return found;
    await sleep(2000);
  }
  return null;
}

async function newCustomer(k) {
  const c = client();
  const s = await c.auth.signInAnonymously({ options: { data: { taba_actor: 'customer' } } });
  assert.ok(s.data?.session, `ANON_SIGNIN_FAILED:${s.error?.code}`);
  assert.ifError((await c.rpc('upsert_current_customer_profile', { p_name: `${CUSTOMER_NAME} ${k}`, p_phone: CUSTOMER_PHONE })).error);
  const saved = await c.rpc('upsert_current_customer_address', { p_address: { label: 'Casa', street: CUSTOMER_STREET,
    streetNumber: String(700 + k), city: ADDRESS.city, neighborhood: ADDRESS.neighborhood, latitude: ADDRESS.lat,
    longitude: ADDRESS.lng, geolocationAccuracy: 10, source: 'gps', locationSource: 'map_pin',
    locationConfirmedAt: new Date().toISOString(), isDefault: true } });
  const addressId = saved.data?.address?.id || saved.data?.id;
  assert.ok(!saved.error && addressId, `ADDRESS_FAILED:${saved.error?.code}`);
  return { c, addressId, k };
}
// Above the QA tenant's delivery minimum: the stock comes back on cancel.
const unitsFor = (product) => Math.max(1, Math.ceil(20_000 / Number(product.price)));
async function createQaOrder(k, product) {
  const cust = await newCustomer(k);
  const payload = { business_id: QA_CONTROL_BUSINESS, client_request_id: randomUUID(),
    tracking_token: randomBytes(32).toString('base64url'), items: [{ product_id: product.id, quantity: unitsFor(product) }],
    customer_name: `${CUSTOMER_NAME} ${k}`, customer_phone: CUSTOMER_PHONE, delivery_mode: 'delivery',
    payment_method: 'cash', age_confirmed: true, customer_address_id: cust.addressId,
    customer_street_address: `${CUSTOMER_STREET} ${700 + k}`, customer_neighborhood: ADDRESS.neighborhood,
    customer_notes: 'QA certificación impresión — no despachar' };
  const r = await cust.c.rpc('create_order_with_items', { payload });
  const row = Array.isArray(r.data) ? r.data[0] : r.data;
  assert.ok(row?.id, `QA_ORDER_FAILED:${r.error?.code || 'no id'}`);
  orders.push(row.id);
  return { id: row.id, customer: cust };
}

try {
  owner = await operator('CP QA OWNER', QA_CONTROL_BUSINESS, 'owner');
  staff = await operator('CP QA STAFF', QA_CONTROL_BUSINESS, 'staff');
  ownerB = await operator('CP QA B OWNER', QA_ISOLATION_BUSINESS, 'owner B');
  rider = await operator('CP QA RIDER 1', QA_CONTROL_BUSINESS, 'rider1', 'rider_android');
  assert.notEqual(QA_CONTROL_BUSINESS, REAL_BUSINESS);

  // ── 1. The gateway refuses everything that is not a device ─────────────
  const g1 = await gateway({ action: 'claim', document_types: ['kitchen_ticket'], limit: 1 }, { origin: PANEL_ORIGIN });
  pass('GATEWAY_REJECTS_BROWSER_ORIGIN', g1.status === 403 && g1.body?.code === 'BROWSER_NOT_ALLOWED', g1.status);
  const g2 = await gateway(null, { method: 'GET' });
  pass('GATEWAY_REJECTS_GET', g2.status === 405, g2.status);
  const g3 = await gateway({ action: 'claim', document_types: ['kitchen_ticket'], limit: 1 });
  pass('GATEWAY_UNAUTHENTICATED_DENIED', g3.status === 401 && g3.body?.code === 'DEVICE_UNAUTHORIZED', g3.status);
  const forged = new Device('forged'); forged.id = randomUUID();
  const g4 = await forged.claim();
  pass('GATEWAY_FORGED_CREDENTIAL_DENIED', g4.status === 401 && g4.body?.code === 'DEVICE_UNAUTHORIZED', g4.status);
  const g5 = await new Device('nocode').register('ABCDE-FGHJK');
  pass('GATEWAY_UNKNOWN_PAIRING_CODE_DENIED', g5.status === 401, g5.status);
  const g6 = await gateway({ action: 'drop_tables' }, { token: forged.token() });
  pass('GATEWAY_UNKNOWN_ACTION_WITHOUT_VALID_DEVICE_DENIED', g6.status === 400 || g6.status === 401, g6.status);

  // ── 2. Pairing: only owner/admin of the business ───────────────────────
  const pStaff = await staff.c.rpc('create_local_device_pairing', { p_business_id: QA_CONTROL_BUSINESS, p_device_name: 'QA staff' });
  pass('PAIRING_STAFF_DENIED', pStaff.error?.code === '42501', codeOf(pStaff));
  const pForeign = await ownerB.c.rpc('create_local_device_pairing', { p_business_id: QA_CONTROL_BUSINESS, p_device_name: 'QA foreign' });
  pass('PAIRING_FOREIGN_OWNER_DENIED', pForeign.error?.code === '42501', codeOf(pForeign));
  const pRider = await rider.c.rpc('create_local_device_pairing', { p_business_id: QA_CONTROL_BUSINESS, p_device_name: 'QA rider' });
  pass('PAIRING_RIDER_DENIED', Boolean(pRider.error), codeOf(pRider));
  const pAnon = await anon.rpc('create_local_device_pairing', { p_business_id: QA_CONTROL_BUSINESS, p_device_name: 'QA anon' });
  pass('PAIRING_ANON_DENIED', Boolean(pAnon.error), codeOf(pAnon));

  const pairing = async (who, businessId, name) => {
    const r = await who.c.rpc('create_local_device_pairing', { p_business_id: businessId, p_device_name: name });
    assert.ok(r.data?.pairing_code && !r.error, `PAIRING_FAILED:${codeOf(r)}`);
    return r.data.pairing_code;
  };
  const a1 = new Device('A1'); const a2 = new Device('A2'); const b1 = new Device('B1');
  const code1 = await pairing(owner, QA_CONTROL_BUSINESS, `QA A1 ${RUN}`);
  const r1 = await a1.register(code1);
  devices.push([a1, owner]);
  pass('DEVICE_REGISTER', r1.status === 200 && a1.business === QA_CONTROL_BUSINESS, r1.status);
  const reuse = await new Device('reuse').register(code1);
  pass('PAIRING_CODE_SINGLE_USE', reuse.status === 401, reuse.status);
  const r2 = await a2.register(await pairing(owner, QA_CONTROL_BUSINESS, `QA A2 ${RUN}`));
  devices.push([a2, owner]);
  const r3 = await b1.register(await pairing(ownerB, QA_ISOLATION_BUSINESS, `QA B1 ${RUN}`));
  devices.push([b1, ownerB]);
  pass('DEVICE_REGISTER_SECOND_AND_FOREIGN', r2.status === 200 && r3.status === 200 && b1.business === QA_ISOLATION_BUSINESS,
    `${r2.status}/${r3.status}`);

  const hb = await a1.heartbeat();
  const status = await owner.c.rpc('get_local_print_status', { p_business_id: QA_CONTROL_BUSINESS });
  const mine = (status.data?.devices || []).find((d) => d.id === a1.id);
  pass('DEVICE_HEARTBEAT_VISIBLE_IN_PANEL', hb.status === 200 && mine?.agent === 'ONLINE'
    && mine?.printers?.[0]?.name === `QA Termica A1`, `${hb.status}/${mine?.agent}`);
  const statusForeign = await ownerB.c.rpc('get_local_print_status', { p_business_id: QA_CONTROL_BUSINESS });
  pass('STATUS_FOREIGN_OWNER_DENIED', statusForeign.error?.code === '42501', codeOf(statusForeign));
  const statusStaff = await staff.c.rpc('get_local_print_status', { p_business_id: QA_CONTROL_BUSINESS });
  pass('STATUS_STAFF_ALLOWED', !statusStaff.error && Array.isArray(statusStaff.data?.devices), codeOf(statusStaff));
  const tableRead = await owner.c.from('local_devices').select('id').limit(1);
  pass('DEVICE_TABLE_NOT_READABLE_DIRECTLY', Boolean(tableRead.error), codeOf(tableRead));

  // ── 3. Rotation: two phases, the old secret dies on first use of the new ─
  const oldToken = a1.token();
  const next = randomBytes(32).toString('base64url');
  const rot = await a1.call({ action: 'rotate', new_secret_hash: sha256(next) });
  const oldStillValid = (await a1.heartbeat()).status === 200;
  a1.secret = next;
  const promoted = await a1.heartbeat();
  const oldAfter = await gateway({ action: 'heartbeat', report: { agent_version: AGENT_VERSION } }, { token: oldToken });
  pass('DEVICE_ROTATE', rot.status === 200 && oldStillValid && promoted.status === 200 && oldAfter.status === 401,
    `${rot.status}/${oldStillValid}/${promoted.status}/${oldAfter.status}`);

  // ── 4. QA order (anonymous customer, cash, QA tenant) ──────────────────
  window = await openQaWindow(owner.c, QA_CONTROL_BUSINESS, { log, minutes: 30 });
  const products = ((await staff.c.from('products').select('id,stock,available,is_active,price')
    .eq('business_id', QA_CONTROL_BUSINESS).eq('is_active', true).eq('available', true).gt('stock', 3).limit(10)).data || [])
    .filter((p) => Number(p.price) > 0 && Number(p.stock) >= 2 * unitsFor(p));
  assert.ok(products.length > 0, 'QA_PRODUCT_WITH_STOCK_REQUIRED');
  const order = await createQaOrder(1, products[0]);
  pass('QA_ORDER_CREATED', Boolean(order.id));

  // ── 5. Jobs by the normal contract (Panel) ─────────────────────────────
  const eOrder = await enqueue(order.id, 'order_ticket', `cpverify:${RUN}:order`);
  const replay = await enqueue(order.id, 'order_ticket', `cpverify:${RUN}:order`);
  pass('ENQUEUE_ORDER_TICKET', eOrder.data?.status === 'queued' && eOrder.data?.idempotent_replay === false, codeOf(eOrder));
  pass('ENQUEUE_IDEMPOTENT_REPLAY', replay.data?.print_job_id === eOrder.data?.print_job_id && replay.data?.idempotent_replay === true);
  const conflict = await enqueue(order.id, 'kitchen_ticket', `cpverify:${RUN}:order`);
  pass('ENQUEUE_KEY_REUSED_FOR_OTHER_REQUEST_REFUSED', conflict.error?.code === '23505', codeOf(conflict));
  const eKitchen = await enqueue(order.id, 'kitchen_ticket', `cpverify:${RUN}:kitchen`, staff);
  pass('ENQUEUE_KITCHEN_TICKET_BY_STAFF', eKitchen.data?.status === 'queued', codeOf(eKitchen));
  const eRider = await enqueue(order.id, 'order_ticket', `cpverify:${RUN}:rider`, rider);
  const eForeign = await enqueue(order.id, 'order_ticket', `cpverify:${RUN}:foreign`, ownerB);
  const eAnon = await anon.rpc('request_order_print_job', { p_order_id: order.id, p_document_type: 'order_ticket', p_idempotency_key: `cpverify:${RUN}:anon` });
  const eFiscal = await enqueue(order.id, 'fiscal_receipt', `cpverify:${RUN}:fiscal`);
  pass('ENQUEUE_DENIED_RIDER_FOREIGN_ANON', eRider.error?.code === '42501' && eForeign.error?.code === '42501' && Boolean(eAnon.error),
    `${codeOf(eRider)}/${codeOf(eForeign)}/${codeOf(eAnon)}`);
  pass('ENQUEUE_FISCAL_FROM_PANEL_REFUSED', eFiscal.error?.code === '22023', codeOf(eFiscal));

  const orderJob = await jobRow(eOrder.data.print_job_id);
  const kitchenJob = await jobRow(eKitchen.data.print_job_id);
  const orderText = JSON.stringify(orderJob.payload);
  const kitchenText = JSON.stringify(kitchenJob.payload);
  pass('PAYLOAD_WITHOUT_CUSTOMER_PII', ![CUSTOMER_NAME, CUSTOMER_PHONE, CUSTOMER_STREET].some((s) => orderText.includes(s) || kitchenText.includes(s)));
  pass('KITCHEN_PAYLOAD_WITHOUT_PRICES_OR_PAYMENT', !/unit_price|subtotal|"total"|payment/.test(kitchenText) && /"total"/.test(orderText));

  // Claims: only the business's own devices, one winner, exact token.
  const foreignClaim = await b1.claim();
  pass('FOREIGN_DEVICE_CLAIMS_NOTHING_OF_A', foreignClaim.status === 200
    && !(foreignClaim.body?.jobs || []).some((j) => j.id === orderJob.id || j.id === kitchenJob.id), foreignClaim.status);
  const c1 = await a1.claim();
  const claimed = new Map((c1.body?.jobs || []).map((j) => [j.id, j]));
  for (const j of claimed.values()) jobsOfRun.add(j.id);
  pass('CLAIM_RETURNS_QUEUED_JOBS', claimed.has(orderJob.id) && claimed.has(kitchenJob.id), c1.status);
  pass('STATE_CLAIMED', (await jobRow(orderJob.id)).status === 'claimed');
  const oj = claimed.get(orderJob.id); const kj = claimed.get(kitchenJob.id);
  const fUpd = await b1.update(oj, 'printing');
  pass('FOREIGN_DEVICE_CANNOT_TOUCH_A_JOB', fUpd.status === 404, fUpd.status);
  const otherDev = await a2.update(oj, 'printing');
  pass('OTHER_DEVICE_OF_SAME_BUSINESS_CANNOT_TOUCH_A_CLAIM', otherDev.status === 409, otherDev.status);
  const wrongToken = await a1.update(oj, 'printing', { token: randomUUID() });
  pass('WRONG_CLAIM_TOKEN_REJECTED', wrongToken.status === 409, wrongToken.status);
  const [p1, p2] = await Promise.all([a1.update(oj, 'printing'), a1.update(oj, 'printing')]);
  pass('STATE_PRINTING', (await jobRow(orderJob.id)).status === 'printing' && p1.status === 200 && p2.status === 200);
  const done1 = await a1.update(oj, 'printed');
  const done1Replay = await a1.update(oj, 'printed');
  pass('STATE_PRINTED', done1.status === 200 && (await jobRow(orderJob.id)).status === 'printed' && done1Replay.body?.idempotent_replay === true);
  await a1.update(kj, 'printing'); await a1.update(kj, 'printed');
  const ev = await eventsOf(orderJob.id);
  pass('AUDIT_TRAIL_QUEUED_CLAIMED_PRINTING_PRINTED', count(ev, 'queued') === 1 && count(ev, 'claimed') === 1
    && count(ev, 'printing') === 1 && count(ev, 'printed') === 1, ev.map((e) => e.event_type).join(','));
  pass('KITCHEN_TICKET_PRINTED', (await jobRow(kitchenJob.id)).status === 'printed');

  // ── 6. NEEDS_REVIEW: outcome unknown, late confirmation, crash, network loss ─
  const uJob = (await enqueue(order.id, 'order_ticket', `cpverify:${RUN}:unknown`)).data.print_job_id;
  const lJob = (await enqueue(order.id, 'order_ticket', `cpverify:${RUN}:late`)).data.print_job_id;
  const cJob = (await enqueue(order.id, 'kitchen_ticket', `cpverify:${RUN}:crash`)).data.print_job_id;
  const nJob = (await enqueue(order.id, 'kitchen_ticket', `cpverify:${RUN}:netloss`)).data.print_job_id;
  const batch = new Map(((await a1.claim(['order_ticket', 'kitchen_ticket'], 10)).body?.jobs || []).map((j) => [j.id, j]));
  assert.ok([uJob, lJob, cJob, nJob].every((id) => batch.has(id)), 'REVIEW_BATCH_NOT_CLAIMED');
  await a1.update(batch.get(uJob), 'printing');
  await a1.update(batch.get(uJob), 'unknown', { error: 'SPOOLER_ERROR' });
  pass('STATE_NEEDS_REVIEW_ON_UNKNOWN', (await jobRow(uJob)).status === 'needs_review');
  const resolvedU = await owner.c.rpc('resolve_print_job_review', { p_job_id: uJob, p_resolution: 'printed', p_note: 'QA: salió bien' });
  pass('REVIEW_RESOLVED_BY_OPERATOR', resolvedU.data?.status === 'printed', codeOf(resolvedU));
  await a1.update(batch.get(lJob), 'printing');
  await a1.update(batch.get(lJob), 'unknown', { error: 'SPOOLER_TIMEOUT' });
  const late = await a1.update(batch.get(lJob), 'printed');
  pass('LATE_CONFIRMATION_ACCEPTED', late.status === 200 && (await jobRow(lJob)).status === 'printed', late.status);
  // cJob: printing then the agent "crashes"; nJob: claimed, network lost before printing.
  await a1.update(batch.get(cJob), 'printing');
  log('waiting 125 s: printing lease (120 s) and claim lease (60 s) expire');
  await sleep(125_000);
  const recovered = new Map(((await a2.claim(['kitchen_ticket'], 10)).body?.jobs || []).map((j) => [j.id, j]));
  const cRow = await jobRow(cJob);
  pass('CRASH_WHILE_PRINTING_GOES_TO_REVIEW_NOT_REPRINT', cRow.status === 'needs_review' && !recovered.has(cJob)
    && cRow.last_error === 'PRINT_OUTCOME_UNKNOWN', cRow.status);
  pass('LEASE_EXPIRED_BEFORE_PRINTING_REQUEUED_ONCE', recovered.has(nJob) && recovered.get(nJob).attempt === 2);
  const stale = await a1.update(batch.get(nJob), 'printing');
  pass('STALE_CLAIM_AFTER_NETWORK_LOSS_REJECTED', stale.status === 409, stale.status);
  await a2.update(recovered.get(nJob), 'printing'); await a2.update(recovered.get(nJob), 'printed');
  pass('RECOVERED_JOB_PRINTED_ONCE', count(await eventsOf(nJob), 'printed') === 1);
  for (const j of recovered.values()) if (j.id !== nJob) await a2.update(j, 'not_printed', { error: 'QA_NOT_THIS_ONE' });
  const autoReprints = (await owner.c.from('print_jobs').select('id').eq('reprint_of', cJob)).data || [];
  pass('NO_AUTOMATIC_REPRINT_OF_AMBIGUOUS_JOB', autoReprints.length === 0);
  const resolvedC = await owner.c.rpc('resolve_print_job_review', { p_job_id: cJob, p_resolution: 'not_printed', p_note: 'QA: no salió' });
  pass('REVIEW_NOT_PRINTED_ENDS_FAILED', resolvedC.data?.status === 'failed', codeOf(resolvedC));

  // ── 7. Explicit reprint: a NEW job, with who / when / why ─────────────
  const rp = await owner.c.rpc('request_print_job_reprint', { p_job_id: cJob, p_reason: 'QA: la comanda no salió', p_idempotency_key: `cpverify:${RUN}:rp` });
  const rpReplay = await owner.c.rpc('request_print_job_reprint', { p_job_id: cJob, p_reason: 'QA: la comanda no salió', p_idempotency_key: `cpverify:${RUN}:rp` });
  const rpRow = rp.data?.print_job_id ? await jobRow(rp.data.print_job_id) : null;
  if (rpRow) jobsOfRun.add(rpRow.id);
  pass('REPRINT_CREATES_NEW_JOB', rpRow && rpRow.id !== cJob && rpRow.reprint_of === cJob && rpRow.requested_by === owner.id
    && rpRow.reprint_reason === 'QA: la comanda no salió' && rpRow.status === 'queued', codeOf(rp));
  pass('REPRINT_IDEMPOTENT', rpReplay.data?.print_job_id === rp.data?.print_job_id && rpReplay.data?.idempotent_replay === true);
  const rpEvents = await eventsOf(rpRow.id);
  pass('REPRINT_AUDITED', count(rpEvents, 'reprint_queued') === 1 && rpEvents[0]?.detail?.reason === 'QA: la comanda no salió'
    && rpEvents[0]?.detail?.reprint_of === cJob);
  const rpStaff = await staff.c.rpc('request_print_job_reprint', { p_job_id: orderJob.id, p_reason: 'QA: copia para el repartidor', p_idempotency_key: `cpverify:${RUN}:rpstaff` });
  if (rpStaff.data?.print_job_id) jobsOfRun.add(rpStaff.data.print_job_id);
  const rpRider = await rider.c.rpc('request_print_job_reprint', { p_job_id: orderJob.id, p_reason: 'QA rider', p_idempotency_key: `cpverify:${RUN}:rprider` });
  const rpForeign = await ownerB.c.rpc('request_print_job_reprint', { p_job_id: orderJob.id, p_reason: 'QA ajeno', p_idempotency_key: `cpverify:${RUN}:rpforeign` });
  pass('REPRINT_ROLES', Boolean(rpStaff.data?.print_job_id) && rpRider.error?.code === '42501' && rpForeign.error?.code === '42501',
    `${codeOf(rpStaff)}/${codeOf(rpRider)}/${codeOf(rpForeign)}`);
  const rpAgent = await a2.call({ action: 'reprint', job_id: kitchenJob.id, reason: 'QA: reimpresión desde el mostrador', operator_label: 'Caja QA', idempotency_key: `cpverify:${RUN}:rpagent` });
  const rpAgentRow = rpAgent.body?.print_job_id ? await jobRow(rpAgent.body.print_job_id) : null;
  if (rpAgentRow) jobsOfRun.add(rpAgentRow.id);
  pass('REPRINT_FROM_AGENT_IS_NEW_AUDITED_JOB', rpAgent.status === 200 && rpAgentRow?.reprint_of === kitchenJob.id, rpAgent.status);
  for (const id of [rpRow.id, rpStaff.data?.print_job_id, rpAgentRow?.id].filter(Boolean)) {
    const j = await claimUntil(a2, id, ['order_ticket', 'kitchen_ticket'], 30_000);
    if (j) { await a2.update(j, 'printing'); await a2.update(j, 'printed'); }
  }
  pass('REPRINTS_PRINTED', (await jobRow(rpRow.id)).status === 'printed');

  // ── 8. FAILED: retried with backoff, failed after 5 attempts ───────────
  const fJob = (await enqueue(order.id, 'order_ticket', `cpverify:${RUN}:failed`)).data.print_job_id;
  let attempts = 0; let backoffRespected = true;
  for (let i = 0; i < 5; i++) {
    const j = await claimUntil(a1, fJob, ['order_ticket'], 200_000);
    if (!j) break;
    attempts = j.attempt;
    const r = await a1.update(j, 'not_printed', { error: 'PRINTER_OFFLINE' });
    if (i < 4) {
      const row = await jobRow(fJob);
      backoffRespected &&= row.status === 'queued' && new Date(row.next_attempt_at).getTime() > Date.now() + 5_000;
      const early = await a1.claim(['order_ticket'], 10);
      backoffRespected &&= !(early.body?.jobs || []).some((x) => x.id === fJob);
      for (const other of (early.body?.jobs || [])) await a1.update(other, 'not_printed', { error: 'QA_NOT_THIS_ONE' });
    } else {
      pass('STATE_FAILED_AFTER_5_ATTEMPTS', r.status === 200 && (await jobRow(fJob)).status === 'failed' && attempts === 5,
        `${(await jobRow(fJob)).status}/${attempts}`);
    }
  }
  pass('RETRY_BACKOFF_RESPECTED', backoffRespected && attempts === 5, attempts);

  // ── 9. Concurrency: 12 simultaneous claims from 2 agents ─────────────
  const raceIds = [];
  for (let i = 0; i < 20; i++) raceIds.push((await enqueue(order.id, 'kitchen_ticket', `cpverify:${RUN}:race:${i}`)).data.print_job_id);
  const claims = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? a2 : a1).claim(['kitchen_ticket'], 3)
    .then((r) => ({ device: i % 2 ? a2 : a1, jobs: r.body?.jobs || [], status: r.status }))));
  const winners = claims.flatMap((c) => c.jobs.map((j) => ({ device: c.device, job: j })));
  const raceWinners = winners.filter((w) => raceIds.includes(w.job.id));
  const unique = new Set(raceWinners.map((w) => w.job.id));
  report.counts.race = { claimsRequests: 12, statusesOk: claims.every((c) => c.status === 200), jobs: raceIds.length,
    claimed: raceWinners.length, unique: unique.size };
  pass('CLAIM_RACE', claims.every((c) => c.status === 200) && raceWinners.length === unique.size && unique.size === raceIds.length,
    report.counts.race);
  await Promise.all(winners.map(async (w) => {
    if (!raceIds.includes(w.job.id)) return w.device.update(w.job, 'not_printed', { error: 'QA_NOT_THIS_ONE' });
    await Promise.all([w.device.update(w.job, 'printing'), w.device.update(w.job, 'printing')]);
    return w.device.update(w.job, 'printed');
  }));
  const raceEvents = (await owner.c.from('print_job_events').select('print_job_id,event_type').in('print_job_id', raceIds)).data || [];
  const perJob = (type) => raceIds.map((id) => raceEvents.filter((e) => e.print_job_id === id && e.event_type === type).length);
  const doublePrints = perJob('printed').filter((n) => n !== 1).length;
  report.counts.doubleAutoPrint = doublePrints;
  pass('ONE_CLAIM_ONE_PRINTING_ONE_PRINTED_PER_JOB', perJob('claimed').every((n) => n === 1) && perJob('printing').every((n) => n === 1)
    && doublePrints === 0, { claimed: perJob('claimed'), printed: perJob('printed') });

  // ── 10. Automatic printing on a new order (trigger), cancelled with it ─
  const before = await owner.c.rpc('get_local_print_status', { p_business_id: QA_CONTROL_BUSINESS });
  report.counts.settingsBefore = before.data?.settings || null;
  const firstStatus = (await owner.c.from('orders').select('status').eq('id', order.id).single()).data?.status;
  // `received` is the public name of `submitted` (normalize_order_status_vocabulary).
  const autoOn = ['received', 'submitted', 'pending', 'new'].includes(firstStatus) ? 'submitted' : null;
  if (autoOn) {
    settingsTouched = true;
    const set = await owner.c.rpc('configure_business_print_settings', { p_business_id: QA_CONTROL_BUSINESS,
      p_settings: { auto_print_enabled: true, kitchen_ticket_on: autoOn, order_ticket_on: null } });
    const staffSet = await staff.c.rpc('configure_business_print_settings', { p_business_id: QA_CONTROL_BUSINESS, p_settings: { auto_print_enabled: false } });
    pass('SETTINGS_OWNER_ONLY', !set.error && staffSet.error?.code === '42501', `${codeOf(set)}/${codeOf(staffSet)}`);
    const order2 = await createQaOrder(2, products[0]);
    const auto = (await owner.c.from('print_jobs').select('id,status,request_source,document_type').eq('source_entity_id', order2.id)).data || [];
    auto.forEach((j) => jobsOfRun.add(j.id));
    pass('AUTO_PRINT_ENQUEUED_ON_NEW_ORDER', auto.length === 1 && auto[0].document_type === 'kitchen_ticket'
      && auto[0].request_source === 'automatic' && auto[0].status === 'queued', JSON.stringify(auto.map((j) => j.status)));
    await cleanupQaOrder({ admin: owner.c, owner: owner.c, staff: staff.c, businessId: QA_CONTROL_BUSINESS, orderId: order2.id, reason: 'QA certificación impresión' });
    const afterCancel = auto[0] ? await jobRow(auto[0].id) : null;
    pass('AUTO_TICKET_CANCELLED_WITH_THE_ORDER', afterCancel?.status === 'cancelled' && afterCancel?.last_error === 'ORDER_CANCELLED', afterCancel?.status);
  } else {
    pass('AUTO_PRINT_ENQUEUED_ON_NEW_ORDER', false, `unexpected first status ${firstStatus}`);
  }

  // ── 11. RLS on the jobs and their audit ───────────────────────────────
  const ownSees = (await owner.c.from('print_jobs').select('id').eq('business_id', QA_CONTROL_BUSINESS).in('id', [...jobsOfRun])).data || [];
  const staffSees = (await staff.c.from('print_jobs').select('id').in('id', [...jobsOfRun])).data || [];
  const foreignSees = await ownerB.c.from('print_jobs').select('id').in('id', [...jobsOfRun]);
  const foreignEvents = await ownerB.c.from('print_job_events').select('id').eq('business_id', QA_CONTROL_BUSINESS).limit(5);
  const riderSees = await rider.c.from('print_jobs').select('id').in('id', [...jobsOfRun]);
  const anonSees = await anon.from('print_jobs').select('id').limit(1);
  const customerSees = await order.customer.c.from('print_jobs').select('id').in('id', [...jobsOfRun]);
  report.counts.rls = { owner: ownSees.length, staff: staffSees.length, foreign: foreignSees.data?.length ?? foreignSees.error?.code,
    foreignEvents: foreignEvents.data?.length ?? foreignEvents.error?.code, rider: riderSees.data?.length ?? riderSees.error?.code,
    anon: anonSees.error?.code || anonSees.data?.length, customer: customerSees.data?.length ?? customerSees.error?.code };
  pass('PRINT_JOB_RLS', ownSees.length === jobsOfRun.size && staffSees.length === jobsOfRun.size
    && (foreignSees.data || []).length === 0 && (foreignEvents.data || []).length === 0 && (riderSees.data || []).length === 0
    && Boolean(anonSees.error) && (customerSees.data || []).length === 0, report.counts.rls);

  // ── 12. Revoke: stops the device at once, claimed work goes back ───────
  const vJob = (await enqueue(order.id, 'order_ticket', `cpverify:${RUN}:revoke`)).data.print_job_id;
  const vClaim = await claimUntil(a2, vJob, ['order_ticket'], 30_000);
  const staffRevoke = await staff.c.rpc('revoke_local_device', { p_device_id: a2.id, p_reason: 'QA staff' });
  const foreignRevoke = await ownerB.c.rpc('revoke_local_device', { p_device_id: a2.id, p_reason: 'QA ajeno' });
  pass('REVOKE_ONLY_OWNER_OF_THE_BUSINESS', staffRevoke.error?.code === '42501' && foreignRevoke.error?.code === '42501',
    `${codeOf(staffRevoke)}/${codeOf(foreignRevoke)}`);
  const revoked = await owner.c.rpc('revoke_local_device', { p_device_id: a2.id, p_reason: 'QA certificación: baja' });
  const afterRevoke = await a2.heartbeat();
  const claimAfterRevoke = await a2.claim();
  pass('DEVICE_REVOKE', !revoked.error && afterRevoke.status === 401 && claimAfterRevoke.status === 401,
    `${codeOf(revoked)}/${afterRevoke.status}/${claimAfterRevoke.status}`);
  pass('REVOKE_RETURNS_CLAIMED_WORK_TO_THE_QUEUE', Boolean(vClaim) && (await jobRow(vJob)).status === 'queued');
  const vAgain = await claimUntil(a1, vJob, ['order_ticket'], 30_000);
  if (vAgain) { await a1.update(vAgain, 'printing'); await a1.update(vAgain, 'printed'); }
  pass('REQUEUED_WORK_PRINTED_BY_ANOTHER_AGENT', (await jobRow(vJob)).status === 'printed');
} catch (error) {
  pass('RUN_COMPLETED', false, String(error.message).slice(0, 200));
} finally {
  // Cleanup through the same RPCs: queued leftovers cancelled, devices revoked,
  // settings restored, QA orders cancelled, QA window closed.
  try {
    if (owner) {
      for (const id of jobsOfRun) {
        const row = await jobRow(id).catch(() => null);
        if (row?.status === 'queued') await owner.c.rpc('cancel_print_job', { p_job_id: id, p_reason: 'QA certificación: limpieza' });
        if (row?.status === 'needs_review') await owner.c.rpc('resolve_print_job_review', { p_job_id: id, p_resolution: 'not_printed', p_note: 'QA limpieza' });
      }
      if (settingsTouched) {
        await owner.c.rpc('configure_business_print_settings', { p_business_id: QA_CONTROL_BUSINESS,
          p_settings: { auto_print_enabled: false, kitchen_ticket_on: null, order_ticket_on: null } });
      }
    }
    for (const [device, who] of devices) {
      if (device.id) await who.c.rpc('revoke_local_device', { p_device_id: device.id, p_reason: 'QA certificación: fin' });
    }
    for (const id of orders) {
      await cleanupQaOrder({ admin: owner.c, owner: owner.c, staff: staff.c, businessId: QA_CONTROL_BUSINESS, orderId: id,
        reason: 'QA certificación impresión' }).catch((e) => log(`order cleanup ${id}: ${e.message}`));
    }
    if (window) await window.close();
    if (owner) {
      const finalStatus = await owner.c.rpc('get_local_print_status', { p_business_id: QA_CONTROL_BUSINESS });
      const activeOfRun = (finalStatus.data?.devices || []).filter((d) => devices.some(([dev]) => dev.id === d.id) && d.status === 'active');
      const finalB = await ownerB.c.rpc('get_local_print_status', { p_business_id: QA_ISOLATION_BUSINESS });
      const activeB = (finalB.data?.devices || []).filter((d) => devices.some(([dev]) => dev.id === d.id) && d.status === 'active');
      const business = (await owner.c.from('businesses').select('status').eq('id', QA_CONTROL_BUSINESS).single()).data;
      report.cleanup = { devicesStillActive: activeOfRun.length + activeB.length, qaBusiness: business?.status,
        settings: finalStatus.data?.settings || null, queue: finalStatus.data?.queue || null };
      pass('CLEANUP_LEFT_NOTHING_ACTIVE', activeOfRun.length + activeB.length === 0 && business?.status === 'closed'
        && finalStatus.data?.settings?.auto_print_enabled !== true && (finalStatus.data?.queue?.queued ?? 0) === 0
        && (finalStatus.data?.queue?.in_flight ?? 0) === 0 && (finalStatus.data?.queue?.needs_review ?? 0) === 0, report.cleanup);
    }
  } catch (error) {
    pass('CLEANUP_COMPLETED', false, String(error.message).slice(0, 200));
  }
  const failed = Object.entries(report.checks).filter(([, v]) => v !== 'PASS').map(([k]) => k);
  report.verdict = failed.length === 0 ? 'PASS' : 'FAIL';
  report.failed = failed;
  report.jobs = jobsOfRun.size;
  report.durationSeconds = Math.round((Date.now() - T0) / 1000);
  mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ out: OUT, verdict: report.verdict, failed, jobs: report.jobs, durationSeconds: report.durationSeconds }));
  process.exitCode = report.verdict === 'PASS' ? 0 : 1;
}
