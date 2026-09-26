// Physical Rider v4 certification on CONTROLLED_PRODUCTION (QA control
// business) with the Moto G15: the signed release APK is driven by its signed
// instrumentation test (PilotReleasePhysicalTest) — login, availability,
// accept, pickup, on the way with REAL GPS, wrong code refused, right code
// delivers. While the rider holds the active delivery this runner turns the
// screen off and cuts Wi-Fi, and measures GPS receipts before, during and
// after. Credentials travel once over a loopback adb-reverse bridge.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadTargetKeys } from './target-keys.mjs';
import { readQaCredential } from './qa-credentials.mjs';
import { cleanupQaOrder, operatorClient } from './qa-cleanup.mjs';
import { openQaWindow } from './qa-window.mjs';

const SERIAL = 'ZY32LHS6PS';
const BUSINESS = 'e1d2c342-da14-421e-884f-ff38bb55f642';
const ADDRESS = { neighborhood: 'Centro', city: 'Neuquén Capital', lat: -38.9516, lng: -68.0591 };
const OPTIONS = { auth: { persistSession: false, autoRefreshToken: false } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (args, timeout = 20_000) => spawnSync('adb', ['-s', SERIAL, ...args], { encoding: 'utf8', windowsHide: true, timeout });
const log = (m) => process.stderr.write(`[${new Date().toISOString().slice(11, 19)}] ${m}\n`);

const report = { at: new Date().toISOString(), device: SERIAL, business: 'QA control' };
assert.equal(adb(['get-state']).stdout.trim(), 'device', 'MOTO_G15_REQUIRED');
const pkg = adb(['shell', 'dumpsys', 'package', 'com.lataba.rider.pilot']).stdout;
report.installedVersion = { code: Number(pkg.match(/versionCode=(\d+)/)?.[1]), name: pkg.match(/versionName=(\S+)/)?.[1] };
assert.equal(report.installedVersion.code, 4, 'RIDER_V4_NOT_INSTALLED');

const keys = await loadTargetKeys('controlled-production');
const admin = createClient(keys.url, keys.secret, OPTIONS);
const owner = await operatorClient(keys, 'CP QA OWNER', BUSINESS, 'owner');
const staff = await operatorClient(keys, 'CP QA STAFF', BUSINESS, 'staff');
const riderCred = readQaCredential('CP QA RIDER 1');
const riderId = (await admin.auth.admin.listUsers({ page: 1, perPage: 200 })).data.users.find((u) => u.email === riderCred.usuario).id;

// QA order from an anonymous customer (payment to coordinate: no cash here).
const customer = createClient(keys.url, keys.publishable, OPTIONS);
assert.ok((await customer.auth.signInAnonymously({ options: { data: { taba_actor: 'customer' } } })).data?.session);
assert.ifError((await customer.rpc('upsert_current_customer_profile', { p_name: 'QA Físico', p_phone: '2995550800' })).error);
const saved = await customer.rpc('upsert_current_customer_address', { p_address: { label: 'Casa', street: 'Calle Física', streetNumber: '800',
  city: ADDRESS.city, neighborhood: ADDRESS.neighborhood, latitude: ADDRESS.lat, longitude: ADDRESS.lng, geolocationAccuracy: 10,
  source: 'gps', locationSource: 'map_pin', locationConfirmedAt: new Date().toISOString(), isDefault: true } });
assert.ifError(saved.error);
const product = (await staff.from('products').select('id,price,stock').eq('business_id', BUSINESS).eq('available', true)
  .gt('stock', 5).order('price', { ascending: false }).limit(1)).data[0];
const quantity = Math.ceil(6001 / Number(product.price));
const tracking = randomBytes(32).toString('base64url');
// The QA business is closed outside QA runs: open it only to take this order.
// Orders already taken keep operating with the business closed.
const qaWindow = await openQaWindow(owner, BUSINESS, { log });
let created;
try {
  created = await customer.rpc('create_order_with_items', { payload: { business_id: BUSINESS, client_request_id: randomUUID(),
    tracking_token: tracking, items: [{ product_id: product.id, quantity }], customer_name: 'QA Físico', customer_phone: '2995550800',
    delivery_mode: 'delivery', payment_method: 'coordinate', age_confirmed: true, customer_address_id: saved.data.address.id,
    customer_street_address: 'Calle Física 800', customer_neighborhood: ADDRESS.neighborhood, customer_notes: 'QA físico — no despachar' } });
} finally {
  await qaWindow.close();
}
assert.ifError(created.error);
const order = Array.isArray(created.data) ? created.data[0] : created.data;
const code = String(order.delivery_code || (await customer.rpc('issue_order_delivery_code', { p_order_id: order.id, p_tracking_token: tracking })).data.delivery_code);
for (const next of ['accepted', 'preparing', 'ready']) {
  const cur = (await staff.from('orders').select('revision').eq('id', order.id).single()).data;
  assert.ifError((await staff.rpc('transition_order', { p_order_id: order.id, p_expected_revision: cur.revision, p_new_status: next, p_idempotency_key: `phys_${next}_${order.id.replaceAll('-', '')}` })).error);
}
report.order = order.public_code;
log(`order ${order.public_code} ready`);

// One-time loopback bridge for the instrumentation test.
let port; let server;
for (let i = 0; i < 8 && !server; i += 1) {
  const candidate = randomInt(40_000, 60_001); const s = net.createServer();
  try { await new Promise((ok, ko) => { s.once('error', ko); s.listen(candidate, '127.0.0.1', ok); }); server = s; port = candidate; } catch { s.close(); }
}
server.on('connection', (socket) => {
  socket.end(JSON.stringify({ email: riderCred.usuario, password: riderCred.secreto, businessId: BUSINESS,
    publicCode: order.public_code, deliveryCode: code }) + '\n');
  server.close();
});
assert.equal(adb(['reverse', `tcp:${port}`, `tcp:${port}`]).status, 0, 'ADB_REVERSE_FAILED');
adb(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP']);
const HOLD = Number(process.env.RIDER_HOLD_SECONDS || 180);
adb(['logcat', '-c']);
const instrument = spawn('adb', ['-s', SERIAL, 'shell', 'am', 'instrument', '-w', '-e', 'qaPilot', 'true', '-e', 'qaPort', String(port),
  '-e', 'holdSeconds', String(HOLD),
  '-e', 'class', 'com.lataba.rider.PilotReleasePhysicalTest', 'com.lataba.rider.pilot.test/androidx.test.runner.AndroidJUnitRunner'], { windowsHide: true });
let instrumentOut = '';
instrument.stdout.on('data', (d) => { instrumentOut += d; });
const instrumentDone = new Promise((resolve) => instrument.on('close', resolve));

// Terminal orders purge their GPS trail (privacy), so receipts are accumulated
// while the delivery is active.
const seen = new Map();
const locations = async () => {
  const rows = (await admin.from('rider_locations').select('created_at,accuracy,source').eq('order_id', order.id).order('created_at')).data || [];
  for (const row of rows) seen.set(row.created_at, row);
  return rows;
};
const watcher = setInterval(() => { void locations(); }, 4000);
const statusOf = async () => (await admin.from('orders').select('status,assigned_rider_user_id').eq('id', order.id).single()).data;
try {
  // Offer as soon as the phone reports the rider available.
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const av = (await staff.rpc('list_business_rider_availability', { p_business_id: BUSINESS })).data;
    if (av?.riders?.some((r) => r.rider_user_id === riderId && r.available)) break;
    await sleep(3000);
  }
  const offered = await staff.rpc('offer_order_to_rider', { p_order_id: order.id, p_expected_status: 'ready', p_expected_rider_user_id: null, p_new_rider_user_id: riderId });
  report.offer = offered.data?.code || offered.error?.code;
  log(`offer ${report.offer}`);
  // First real GPS receipt while on the way.
  const gpsDeadline = Date.now() + 240_000;
  while (Date.now() < gpsDeadline && !(await locations()).length) await sleep(3000);
  const first = await locations();
  assert.ok(first.length, 'NO_REAL_GPS_RECEIPT');
  report.firstGpsAt = first[0].created_at; report.firstGpsAccuracyM = Number(first[0].accuracy); report.gpsSource = first[0].source;
  log('gps receipts flowing; screen off');
  adb(['shell', 'input', 'keyevent', 'KEYCODE_SLEEP']);
  const screenOffAt = new Date().toISOString();
  await sleep(30_000);
  const screenOff = (await locations()).filter((l) => l.created_at > screenOffAt).length;
  log(`screen-off receipts ${screenOff}; cutting wifi`);
  adb(['shell', 'cmd', 'wifi', 'set-wifi-enabled', 'disabled']);
  const cutAt = new Date().toISOString();
  await sleep(12_000);
  adb(['shell', 'cmd', 'wifi', 'set-wifi-enabled', 'enabled']);
  const restoredAt = new Date().toISOString();
  // A person unlocks the phone after the screen was off; so does the runner,
  // otherwise the keyguard keeps the rider Activity stopped.
  adb(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP']);
  adb(['shell', 'wm', 'dismiss-keyguard']);
  // Time until Wi-Fi is back and until the first GPS receipt after that.
  let wifiBackAt = null;
  let afterRecovery = 0;
  const recDeadline = Date.now() + 110_000;
  while (Date.now() < recDeadline && !afterRecovery) {
    await sleep(2000);
    if (!wifiBackAt && /connected to/i.test(adb(['shell', 'cmd', 'wifi', 'status']).stdout)) wifiBackAt = new Date().toISOString();
    afterRecovery = (await locations()).filter((l) => l.created_at > restoredAt).length;
  }
  const firstAfter = [...seen.values()].map((l) => l.created_at).filter((t) => t > restoredAt).sort()[0] || null;
  report.recovery = { wifiReenabledAt: restoredAt, wifiConnectedAt: wifiBackAt,
    firstReceiptAfterRecoveryAt: firstAfter,
    secondsFromWifiToReceipt: wifiBackAt && firstAfter ? Math.round((Date.parse(firstAfter) - Date.parse(wifiBackAt)) / 1000) : null };
  const during = (await locations()).filter((l) => l.created_at > cutAt && l.created_at <= restoredAt).length;
  report.screenOff = { receipts: screenOff, seconds: 30 };
  report.networkCut = { seconds: 12, receiptsWhileOffline: during, receiptsAfterRecovery: afterRecovery };
  log(`after recovery receipts ${afterRecovery}; waiting instrumentation`);
  const exit = await Promise.race([instrumentDone, sleep(360_000).then(() => 'TIMEOUT')]);
  clearInterval(watcher);
  report.instrumentation = { exit, ok: /OK \(1 test\)/.test(instrumentOut), summary: instrumentOut.split('\n').filter((l) => /OK|FAIL|Tests run|INSTRUMENTATION_CODE/.test(l)).slice(-3).join(' | '),
    failure: /FAILURES/.test(instrumentOut) ? instrumentOut.split('\n').filter((l) => /Error|Exception|at com\.lataba/.test(l)).slice(0, 6).join(' | ').slice(0, 900) : null };
  const appLog = adb(['logcat', '-d', '-t', '3000']).stdout.split('\n').filter((l) => /lataba|okhttp|RiderLocation/i.test(l) && /Exception|Error|failed/i.test(l));
  report.appLogErrors = appLog.slice(-8).map((l) => l.slice(0, 200));
  const final = await statusOf();
  const all = [...seen.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
  report.gpsTrailPurgedAfterDelivery = (await locations()).length === 0;
  const gaps = all.slice(1).map((l, i) => (Date.parse(l.created_at) - Date.parse(all[i].created_at)) / 1000);
  report.final = { status: final.status, assignedToRider1: final.assigned_rider_user_id === riderId };
  report.gps = { receipts: all.length, maxGapSeconds: Math.round(Math.max(0, ...gaps)), medianAccuracyM: Number(all.map((l) => Number(l.accuracy)).sort((a, b) => a - b)[Math.floor(all.length / 2)] || 0) };
} finally {
  clearInterval(watcher);
  adb(['shell', 'cmd', 'wifi', 'set-wifi-enabled', 'enabled']);
  adb(['reverse', '--remove', `tcp:${port}`]);
  if (!instrument.killed && instrument.exitCode === null) instrument.kill();
  try { report.cleanup = await cleanupQaOrder({ admin, owner, staff, businessId: BUSINESS, orderId: order.id, reason: 'QA Rider físico' }); }
  catch (error) { report.cleanup = { error: error.message }; }
  report.stockRestored = Number((await admin.from('products').select('stock').eq('id', product.id).single()).data.stock) === Number(product.stock);
}
report.verdict = report.instrumentation?.ok && report.final?.status === 'delivered' && report.gps?.receipts > 0
  && report.screenOff?.receipts > 0 && report.networkCut?.receiptsAfterRecovery > 0 && report.stockRestored ? 'PASS' : 'FAIL';
const out = process.argv[2] || `artifacts/controlled-production/rider-physical-cp-${Date.now()}.json`;
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
process.exit(report.verdict === 'PASS' ? 0 : 1);
