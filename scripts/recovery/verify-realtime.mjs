// Realtime delivery check on the QA tenant (never the historic business): a real owner session
// subscribes to its own tenant's products and must receive the stock change made by the service key.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { RECOVERY_QA } from './provision-qa-ids.mjs';

const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const target = JSON.parse(fs.readFileSync(arg('--target'), 'utf8'));
const O = { auth: { persistSession: false, autoRefreshToken: false } };
const url = `https://${target.projectRef}.supabase.co`;
const key = name => { const s = leerSecreto(name); assert.equal(s?.usuario, target.projectRef); return s.secreto; };
const admin = createClient(url, key('RECOVERY SUPABASE SERVICE KEY'), O);
const owner = createClient(url, key('RECOVERY SUPABASE ANON KEY'), O);
const stored = leerSecreto('RECOVERY QA OWNER A');
assert.ifError((await owner.auth.signInWithPassword({ email: stored.usuario, password: stored.secreto })).error);
const reg = await owner.rpc('identity_register_session', { p_business_id: RECOVERY_QA.a, p_client: 'panel_web',
  p_device_label: 'recovery QA realtime', p_device_key_hash: null, p_app_version: 'recovery-qa' });
assert.ok(reg.data?.ok, 'panel session');
await owner.realtime.setAuth((await owner.auth.getSession()).data.session.access_token);

const sku = 'QA-REC-002';
const row = (await admin.from('products').select('id,stock').eq('business_id', RECOVERY_QA.a).eq('sku', sku).single()).data;
let resolve; const received = new Promise(r => { resolve = r; });
const listener = process.argv.includes('--service') ? admin : owner;
const channel = listener.channel('recovery-realtime-' + Date.now())
  .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'products', filter: `business_id=eq.${RECOVERY_QA.a}` },
    payload => { if (payload.new?.id === row.id) resolve(payload.new.stock); });
const status = await new Promise(r => { const t = setTimeout(() => r('TIMEOUT'), 20000);
  channel.subscribe(s => { if (['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(s)) { clearTimeout(t); r(s); } }); });
let delivered = false; let value = null;
if (status === 'SUBSCRIBED') {
  const next = row.stock + 1;
  await admin.from('products').update({ stock: next }).eq('id', row.id);
  value = await Promise.race([received, new Promise(r => setTimeout(() => r(null), 15000))]);
  delivered = value === next;
  await admin.from('products').update({ stock: row.stock }).eq('id', row.id); // restore
}
await listener.removeChannel(channel);
const result = { at: new Date().toISOString(), subscription: status, listener: process.argv.includes('--service') ? 'service' : 'owner', delivered };
console.log(JSON.stringify(result));
process.exitCode = delivered ? 0 : 1;
setTimeout(() => process.exit(), 500);
if (arg('--out')) fs.writeFileSync(arg('--out'), JSON.stringify(result, null, 2));
if (!delivered) process.exitCode = 1;
