// One synthetic pickup/cash order in QA tenant A through the real RPCs, watched by the owner's Realtime
// subscription on `orders` (exactly what the Panel subscribes to). The QA window is always closed.
// Order is cancelled and stock must return. No payment provider is involved.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { RECOVERY_QA } from './provision-qa-ids.mjs';

const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const target = JSON.parse(fs.readFileSync(arg('--target'), 'utf8'));
const O = { auth: { persistSession: false, autoRefreshToken: false } };
const url = `https://${target.projectRef}.supabase.co`;
const key = name => { const s = leerSecreto(name); assert.equal(s?.usuario, target.projectRef); return s.secreto; };
const admin = createClient(url, key('RECOVERY SUPABASE SERVICE KEY'), O);
const login = async credential => {
  const stored = leerSecreto(credential);
  const client = createClient(url, key('RECOVERY SUPABASE ANON KEY'), O);
  assert.ifError((await client.auth.signInWithPassword({ email: stored.usuario, password: stored.secreto })).error);
  return client;
};
const A = RECOVERY_QA.a;
const owner = await login('RECOVERY QA OWNER A');
const buyer = await login('RECOVERY QA BUYER');
const reg = await owner.rpc('identity_register_session', { p_business_id: A, p_client: 'panel_web',
  p_device_label: 'recovery QA order', p_device_key_hash: null, p_app_version: 'recovery-qa' });
assert.ok(reg.data?.ok, 'panel session');
await owner.realtime.setAuth((await owner.auth.getSession()).data.session.access_token);

const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: Boolean(ok), detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail); };
const product = (await admin.from('products').select('id,stock').eq('business_id', A).eq('sku', 'QA-REC-001').single()).data;
const stockOf = async () => Number((await admin.from('products').select('stock').eq('id', product.id).single()).data.stock);
const before = await stockOf();
let orderId = null; let channel;
const events = []; const buyerEvents = []; let buyerChannel;
try {
  const opened = await owner.rpc('open_qa_window', { p_business_id: A, p_minutes: 10 });
  check('QA window opens with server expiry', opened.data?.ok === true, opened.error?.code || opened.data?.qa_window_until);
  channel = owner.channel('recovery-orders-' + Date.now()).on('postgres_changes',
    { event: '*', schema: 'public', table: 'orders', filter: `business_id=eq.${A}` }, payload => events.push(payload.eventType));
  const status = await new Promise(r => { const t = setTimeout(() => r('TIMEOUT'), 20000);
    channel.subscribe(s => { if (['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(s)) { clearTimeout(t); r(s); } }); });
  check('owner subscribes to orders', status === 'SUBSCRIBED', status);
  await buyer.realtime.setAuth((await buyer.auth.getSession()).data.session.access_token);
  buyerChannel = buyer.channel('recovery-orders-buyer-' + Date.now()).on('postgres_changes',
    { event: '*', schema: 'public', table: 'orders', filter: `business_id=eq.${A}` }, payload => buyerEvents.push(payload.eventType));
  const buyerStatus = await new Promise(r => { const t = setTimeout(() => r('TIMEOUT'), 20000);
    buyerChannel.subscribe(s => { if (['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(s)) { clearTimeout(t); r(s); } }); });
  check('buyer subscribes to orders', buyerStatus === 'SUBSCRIBED', buyerStatus);

  assert.ifError((await buyer.rpc('upsert_current_customer_profile', { p_name: 'QA Comprador', p_phone: '2995550811' })).error);
  const created = await buyer.rpc('create_order_with_items', { payload: { business_id: A, client_request_id: randomUUID(),
    tracking_token: randomBytes(32).toString('base64url'), items: [{ product_id: product.id, quantity: 1 }],
    customer_name: 'QA Comprador', customer_phone: '2995550811', delivery_mode: 'pickup', payment_method: 'cash',
    age_confirmed: true, customer_notes: 'QA retiro, no entregar' } });
  const order = Array.isArray(created.data) ? created.data[0] : created.data;
  orderId = order?.id;
  check('buyer creates pickup/cash order', !created.error && Boolean(orderId), created.error?.code || created.error?.message);
  if (orderId) {
    check('stock reserved once', (await stockOf()) === before - 1, `before=${before} now=${await stockOf()}`);
    await new Promise(r => setTimeout(r, 8000));
    check('owner session receives the order via Realtime', events.length > 0, `events=${events.join(',') || 'none'}`);
    check('buyer session receives its own order via Realtime', buyerEvents.length > 0, `events=${buyerEvents.join(',') || 'none'}`);
    const panelRow = await owner.from('orders').select('id,status,revision').eq('id', orderId).maybeSingle();
    check('owner panel read shows the order', Boolean(panelRow.data), panelRow.error?.code || panelRow.data?.status);
    const cancelled = await owner.rpc('cancel_order', { p_order_id: orderId, p_expected_revision: panelRow.data?.revision,
      p_reason: 'QA recovery: sin despacho', p_idempotency_key: `rec_cancel_${orderId.replaceAll('-', '')}` });
    check('owner cancels the order', !cancelled.error, cancelled.error?.code || cancelled.error?.message);
    check('stock returned exactly once', (await stockOf()) === before, `now=${await stockOf()}`);
  }
} finally {
  const closed = await owner.rpc('close_qa_window', { p_business_id: A });
  check('QA window closed', closed.data?.ok === true && closed.data.status === 'closed', closed.error?.code || '');
  if (channel) await owner.removeChannel(channel);
  if (buyerChannel) await buyer.removeChannel(buyerChannel);
}
const result = { at: new Date().toISOString(), orderId, checks };
if (arg('--out')) fs.writeFileSync(arg('--out'), JSON.stringify(result, null, 2));
process.exitCode = checks.every(c => c.ok) ? 0 : 1;
setTimeout(() => process.exit(), 500);
