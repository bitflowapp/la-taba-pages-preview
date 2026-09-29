// Full delivery with the PHYSICAL rider phone and Caja Clara on CONTROLLED_PRODUCTION (QA control business):
// web customer → Caja Clara accepts, prepares, marks ready and offers → the signed pilot Rider APK on the Moto G15
// (its own instrumentation test, PilotReleasePhysicalTest) accepts, picks up, goes on the way with REAL GPS, survives a
// Wi-Fi cut, refuses a wrong code and delivers with the right one → Caja Clara and the Panel see it delivered.
//
// Differences with physical-rider-e2e.mjs: the business side is Caja Clara's real engine (CajaClara.TabaAgent), not
// the Panel; and the screen stays on (`svc power stayon usb`, restored at the end) because the phone has a PIN lock
// that only a person can open after a screen-off. The screen-off GPS phase stays a separate, human-assisted check.
//
//   node scripts/controlled-production/caja-clara-physical-rider-e2e.mjs --agent <CajaClara.TabaAgent.dll> [report.json]
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import readline from 'node:readline';
import { createClient } from '@supabase/supabase-js';
import { loadTargetKeys } from './target-keys.mjs';
import { readQaCredential } from './qa-credentials.mjs';
import { cleanupQaOrder, operatorClient } from './qa-cleanup.mjs';
import { openQaWindow, QA_CONTROL_BUSINESS, REAL_BUSINESS } from './qa-window.mjs';

const SERIAL = 'ZY32LHS6PS';
const BUSINESS = QA_CONTROL_BUSINESS;
const STORE_URL = 'https://la-taba-commercial-pilot.pages.dev';
const ADDRESS = { neighborhood: 'Centro', city: 'Neuquén Capital', lat: -38.9516, lng: -68.0591 };
const OPTIONS = { auth: { persistSession: false, autoRefreshToken: false } };
const args = process.argv.slice(2);
const agentPath = args[args.indexOf('--agent') + 1];
const out = args.find((a) => a.endsWith('.json')) || `artifacts/controlled-production/caja-clara-physical-rider-${Date.now()}.json`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (a, timeout = 20_000) => spawnSync('adb', ['-s', SERIAL, ...a], { encoding: 'utf8', windowsHide: true, timeout });
const log = (m) => process.stderr.write(`[${new Date().toISOString().slice(11, 19)}] ${m}\n`);
const report = { at: new Date().toISOString(), device: SERIAL, business: 'QA control', checks: {}, latency: {} };
const check = (name, ok, detail) => { report.checks[name] = ok ? 'PASS' : 'FAIL'; log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ` (${JSON.stringify(detail)})` : ''}`); };

assert.ok(agentPath?.endsWith('.dll'), 'AGENT_DLL_REQUIRED');
assert.equal(adb(['get-state']).stdout.trim(), 'device', 'MOTO_G15_REQUIRED');
const pkg = adb(['shell', 'dumpsys', 'package', 'com.lataba.rider.pilot']).stdout;
report.installedVersion = { code: Number(pkg.match(/versionCode=(\d+)/)?.[1]), name: pkg.match(/versionName=(\S+)/)?.[1] };
assert.equal(report.installedVersion.code, 4, 'RIDER_V4_NOT_INSTALLED');
assert.match(adb(['shell', 'dumpsys', 'trust']).stdout, /deviceLocked=0/, 'PHONE_LOCKED_NEEDS_A_PERSON');

function startAgent() {
  const child = spawn('dotnet', [agentPath], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const lines = readline.createInterface({ input: child.stdout });
  const waiting = [];
  lines.on('line', (line) => { const next = waiting.shift(); if (next) next(JSON.parse(line)); });
  child.stderr.on('data', () => {});
  return {
    async send(cmd, body = {}, { expectOk = true } = {}) {
      const reply = new Promise((resolve) => waiting.push(resolve));
      child.stdin.write(`${JSON.stringify({ cmd, ...body })}\n`);
      const result = await Promise.race([reply, sleep(120_000).then(() => ({ ok: false, error: 'TIMEOUT' }))]);
      if (expectOk && !result.ok) throw Error(`AGENT_${cmd.toUpperCase()}:${result.error}:${result.message || ''}`);
      return result;
    },
    async quit() { try { await this.send('quit'); } catch { /* ignore */ } child.kill(); },
  };
}

const keys = await loadTargetKeys('controlled-production');
assert.equal(keys.ref, 'tkanbadcglszlcyfjvpv', 'WRONG_TARGET');
const admin = createClient(keys.url, keys.secret, OPTIONS);
const owner = await operatorClient(keys, 'CP QA OWNER', BUSINESS, 'owner');
const staff = await operatorClient(keys, 'CP QA STAFF', BUSINESS, 'staff');
const riderCred = readQaCredential('CP QA RIDER 1');
const riderId = (await admin.auth.admin.listUsers({ page: 1, perPage: 200 })).data.users.find((u) => u.email === riderCred.usuario).id;

const customer = createClient(keys.url, keys.publishable, OPTIONS);
assert.ok((await customer.auth.signInAnonymously({ options: { data: { taba_actor: 'customer' } } })).data?.session);
assert.ifError((await customer.rpc('upsert_current_customer_profile', { p_name: 'QA Caja Clara Físico', p_phone: '2995550840' })).error);
const saved = await customer.rpc('upsert_current_customer_address', { p_address: { label: 'Casa', street: 'Calle Física', streetNumber: '840',
  city: ADDRESS.city, neighborhood: ADDRESS.neighborhood, latitude: ADDRESS.lat, longitude: ADDRESS.lng, geolocationAccuracy: 10,
  source: 'gps', locationSource: 'map_pin', locationConfirmedAt: new Date().toISOString(), isDefault: true } });
assert.ifError(saved.error);
const product = (await staff.from('products').select('id,sku,name,price,stock').eq('business_id', BUSINESS).eq('available', true)
  .not('sku', 'is', null).gt('stock', 12).order('price', { ascending: false }).limit(1)).data[0];
const initialStock = Number(product.stock);
const quantity = Math.ceil(6001 / Number(product.price));
const stayOnBefore = adb(['shell', 'settings', 'get', 'global', 'stay_on_while_plugged_in']).stdout.trim();

const agent = startAgent();
let order; let instrument; let server; let port;
const seen = new Map();
const locations = async () => {
  if (!order) return [];
  const rows = (await admin.from('rider_locations').select('created_at,accuracy,source').eq('order_id', order.id).order('created_at')).data || [];
  for (const row of rows) seen.set(row.created_at, row);
  return rows;
};
let watcher;
try {
  adb(['shell', 'svc', 'power', 'stayon', 'usb']);
  adb(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP']);
  await agent.send('init');
  const ownerCred = readQaCredential('CP QA OWNER');
  const connected = await agent.send('connect', { storeUrl: STORE_URL, email: ownerCred.usuario, password: ownerCred.secreto, business: BUSINESS });
  check('CAJA_CONNECTED', connected.connected === true, connected.role);
  await agent.send('sync', { full: true });
  await agent.send('product', { name: product.name, sku: product.sku, price: Number(product.price), stock: initialStock });
  await agent.send('link', { sku: product.sku });

  const tracking = randomBytes(32).toString('base64url');
  const window = await openQaWindow(owner, BUSINESS, { log, minutes: 10 });
  let created;
  try {
    created = await customer.rpc('create_order_with_items', { payload: { business_id: BUSINESS, client_request_id: randomUUID(), tracking_token: tracking,
      items: [{ product_id: product.id, quantity }], customer_name: 'QA Caja Clara Físico', customer_phone: '2995550840', delivery_mode: 'delivery',
      payment_method: 'coordinate', age_confirmed: true, customer_address_id: saved.data.address.id, customer_street_address: 'Calle Física 840',
      customer_neighborhood: ADDRESS.neighborhood, customer_notes: 'QA Caja Clara físico — no despachar' } });
  } finally { await window.close(); }
  assert.ifError(created.error);
  order = Array.isArray(created.data) ? created.data[0] : created.data;
  order.tracking = tracking;
  report.order = order.public_code;
  const code = String(order.delivery_code || (await customer.rpc('issue_order_delivery_code', { p_order_id: order.id, p_tracking_token: tracking })).data.delivery_code);
  const t0 = Date.now();
  for (let i = 0; i < 60; i += 1) {
    await agent.send('sync');
    if ((await agent.send('orders')).orders.some((o) => o.id === order.id)) break;
    await sleep(500);
  }
  report.latency.orderVisibleInCajaMs = Date.now() - t0;
  for (const action of ['accept', 'prepare', 'ready']) {
    const r = await agent.send('act', { order: order.id, action });
    check(`CAJA_${action.toUpperCase()}`, r.state === 'Confirmed', r.state);
  }

  // One-time loopback bridge: the instrumentation test reads the QA credentials once.
  for (let i = 0; i < 8 && !server; i += 1) {
    const candidate = randomInt(40_000, 60_001); const s = net.createServer();
    try { await new Promise((ok, ko) => { s.once('error', ko); s.listen(candidate, '127.0.0.1', ok); }); server = s; port = candidate; } catch { s.close(); }
  }
  server.on('connection', (socket) => {
    socket.end(`${JSON.stringify({ email: riderCred.usuario, password: riderCred.secreto, businessId: BUSINESS, publicCode: order.public_code, deliveryCode: code })}\n`);
    server.close();
  });
  assert.equal(adb(['reverse', `tcp:${port}`, `tcp:${port}`]).status, 0, 'ADB_REVERSE_FAILED');
  adb(['logcat', '-c']);
  instrument = spawn('adb', ['-s', SERIAL, 'shell', 'am', 'instrument', '-w', '-e', 'qaPilot', 'true', '-e', 'qaPort', String(port),
    '-e', 'holdSeconds', '75', '-e', 'class', 'com.lataba.rider.PilotReleasePhysicalTest',
    'com.lataba.rider.pilot.test/androidx.test.runner.AndroidJUnitRunner'], { windowsHide: true });
  let instrumentOut = '';
  instrument.stdout.on('data', (d) => { instrumentOut += d; });
  const instrumentDone = new Promise((resolve) => instrument.on('close', resolve));
  watcher = setInterval(() => { void locations(); }, 4000);

  // Caja Clara offers as soon as the phone reports the rider available (presence required in this tenant).
  const deadline = Date.now() + 180_000;
  let available = false;
  while (Date.now() < deadline && !available) {
    const av = (await staff.rpc('list_business_rider_availability', { p_business_id: BUSINESS })).data;
    available = Boolean(av?.riders?.some((r) => r.rider_user_id === riderId && r.available));
    if (!available) await sleep(3000);
  }
  check('PHYSICAL_RIDER_AVAILABLE_BY_HEARTBEAT', available);
  await agent.send('sync', { full: true });
  const offered = await agent.send('offer', { order: order.id, rider: riderId });
  check('CAJA_OFFERS_TO_PHYSICAL_RIDER', offered.state === 'Confirmed', offered.message);

  // Real GPS while on the way; the customer sees the rider.
  const gpsDeadline = Date.now() + 240_000;
  while (Date.now() < gpsDeadline && !(await locations()).length) await sleep(3000);
  const first = await locations();
  check('REAL_GPS_RECEIPT', first.length > 0 && first[0].source === 'gps', first[0] && { accuracy: Number(first[0].accuracy) });
  const trackingClient = createClient(keys.url, keys.publishable, { ...OPTIONS, global: { headers: { 'x-order-token': tracking } } });
  const trackingOnTheWay = (await trackingClient.rpc('get_public_order_tracking', { p_public_id: order.public_code })).data;
  check('CUSTOMER_TRACKING_SHOWS_RIDER_ON_THE_WAY', /on_the_way/.test(JSON.stringify(trackingOnTheWay)));
  await agent.send('sync');
  const inCaja = (await agent.send('orders')).orders.find((o) => o.id === order.id);
  check('CAJA_SEES_ON_THE_WAY_AND_TAKES_UNITS_ONCE', inCaja?.status === 'on_the_way' && inCaja.stock_consumed === true, inCaja?.status);

  // Wi-Fi cut while delivering: the phone reconnects and keeps publishing without duplicating the mission.
  adb(['shell', 'cmd', 'wifi', 'set-wifi-enabled', 'disabled']);
  const cutAt = new Date().toISOString();
  await sleep(12_000);
  adb(['shell', 'cmd', 'wifi', 'set-wifi-enabled', 'enabled']);
  const restoredAt = new Date().toISOString();
  let afterRecovery = 0;
  const recDeadline = Date.now() + 110_000;
  while (Date.now() < recDeadline && !afterRecovery) { await sleep(2000); afterRecovery = (await locations()).filter((l) => l.created_at > restoredAt).length; }
  report.networkCut = { seconds: 12, receiptsWhileOffline: (await locations()).filter((l) => l.created_at > cutAt && l.created_at <= restoredAt).length, receiptsAfterRecovery: afterRecovery };
  check('RIDER_OFFLINE_RECONNECT_RESUMES_GPS', afterRecovery > 0, report.networkCut);
  const offers = (await admin.from('rider_order_offers').select('id,status').eq('order_id', order.id)).data || [];
  check('NO_DUPLICATE_MISSION', offers.filter((o) => o.status === 'accepted').length === 1, offers.map((o) => o.status));

  const exit = await Promise.race([instrumentDone, sleep(420_000).then(() => 'TIMEOUT')]);
  clearInterval(watcher);
  report.instrumentation = { exit, ok: /OK \(1 test\)/.test(instrumentOut), summary: instrumentOut.split('\n').filter((l) => /OK|FAIL|Tests run|INSTRUMENTATION_CODE/.test(l)).slice(-3).join(' | ') };
  check('SIGNED_RIDER_APK_WRONG_CODE_THEN_RIGHT_CODE', report.instrumentation.ok, report.instrumentation.summary);
  const final = (await staff.from('orders').select('status').eq('id', order.id).single()).data.status;
  let cajaFinal;
  for (let i = 0; i < 20; i += 1) { await agent.send('sync'); cajaFinal = (await agent.send('orders')).orders.find((o) => o.id === order.id)?.status; if (cajaFinal === 'delivered') break; await sleep(500); }
  check('DELIVERED_IN_CAJA_AND_PANEL', final === 'delivered' && cajaFinal === 'delivered', { panel: final, caja: cajaFinal });
  report.gpsTrailPurgedAfterDelivery = (await locations()).length === 0;
  const all = [...seen.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
  report.gps = { receipts: all.length, maxGapSeconds: Math.round(Math.max(0, ...all.slice(1).map((l, i) => (Date.parse(l.created_at) - Date.parse(all[i].created_at)) / 1000))) };
} catch (error) {
  report.error = error.message;
  log(`ERROR ${error.message}`);
} finally {
  clearInterval(watcher);
  adb(['shell', 'cmd', 'wifi', 'set-wifi-enabled', 'enabled']);
  if (port) adb(['reverse', '--remove', `tcp:${port}`]);
  if (instrument && instrument.exitCode === null) instrument.kill();
  adb(['shell', 'settings', 'put', 'global', 'stay_on_while_plugged_in', stayOnBefore || '0']);
  try { await agent.send('disconnect', {}, { expectOk: false }); } catch { /* ignore */ }
  if (order) {
    try { report.cleanup = await cleanupQaOrder({ admin, owner, staff, businessId: BUSINESS, orderId: order.id, reason: 'QA Caja Clara Rider físico' }); }
    catch (error) { report.cleanup = { error: error.message }; }
  }
  const now = (await admin.from('products').select('stock,available').eq('id', product.id).single()).data;
  if (now.stock !== initialStock) {
    await owner.rpc('apply_inventory_movement', { p_business_id: BUSINESS, p_product_id: product.id, p_barcode_id: null, p_movement_type: 'stock_count',
      p_package_quantity: Math.abs(initialStock - now.stock), p_direction: initialStock > now.stock ? 1 : -1, p_reference_type: 'pilot_qa_return', p_reference_id: null,
      p_reason: 'QA Caja Clara Rider físico: restitución', p_idempotency_key: `qa_cc_phys_${Date.now()}` });
  }
  if (!(await admin.from('products').select('available').eq('id', product.id).single()).data.available)
    await owner.rpc('set_commercial_product_publication', { p_business_id: BUSINESS, p_sku: product.sku, p_publish: true });
  const after = (await admin.from('products').select('stock,available').eq('id', product.id).single()).data;
  report.stockRestored = after.stock === initialStock && after.available === true;
  report.qaBusinessClosed = (await admin.from('businesses').select('status').eq('id', BUSINESS).single()).data.status === 'closed';
  report.realStoreUntouched = (await admin.from('businesses').select('status').eq('id', REAL_BUSINESS).single()).data.status === 'closed';
  report.stayOnRestored = adb(['shell', 'settings', 'get', 'global', 'stay_on_while_plugged_in']).stdout.trim() === (stayOnBefore || '0');
  await agent.quit();
}
const failed = Object.entries(report.checks).filter(([, v]) => v !== 'PASS').map(([k]) => k);
report.failed = failed;
report.verdict = !report.error && failed.length === 0 && report.stockRestored && report.qaBusinessClosed && report.realStoreUntouched && !report.cleanup?.error ? 'PASS' : 'FAIL';
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ verdict: report.verdict, failed, error: report.error, gps: report.gps, networkCut: report.networkCut }, null, 1));
process.exit(report.verdict === 'PASS' ? 0 : 1);
