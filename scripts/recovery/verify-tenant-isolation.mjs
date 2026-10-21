// Tenant isolation on the hosted recovery project, with REAL sessions (owner A, owner B, buyer, anon).
// The service key only seeds one marker product in tenant B and reads ground truth. Nothing is deleted
// except that marker. Output never includes credentials.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { RECOVERY_QA } from './provision-qa-ids.mjs';

const arg = name => process.argv[process.argv.indexOf(name) + 1];
const target = JSON.parse(fs.readFileSync(arg('--target'), 'utf8'));
const out = arg('--out');
const O = { auth: { persistSession: false, autoRefreshToken: false } };
const url = `https://${target.projectRef}.supabase.co`;
const key = name => { const s = leerSecreto(name); assert.equal(s?.usuario, target.projectRef); return s.secreto; };
const anonKey = key('RECOVERY SUPABASE ANON KEY');
const admin = createClient(url, key('RECOVERY SUPABASE SERVICE KEY'), O);
const session = async credential => {
  const stored = leerSecreto(credential);
  const client = createClient(url, anonKey, O);
  const { error } = await client.auth.signInWithPassword({ email: stored.usuario, password: stored.secreto });
  assert.ifError(error);
  return client;
};
const [A, B] = [RECOVERY_QA.a, RECOVERY_QA.b];
const ownerA = await session('RECOVERY QA OWNER A');
const ownerB = await session('RECOVERY QA OWNER B');
// Team authority also requires a registered panel session (identity_register_session).
for (const [client, businessId] of [[ownerA, RECOVERY_QA.a], [ownerB, RECOVERY_QA.b]]) {
  const reg = await client.rpc('identity_register_session', { p_business_id: businessId, p_client: 'panel_web',
    p_device_label: 'recovery QA isolation', p_device_key_hash: null, p_app_version: 'recovery-qa' });
  assert.ok(reg.data?.ok && reg.data.role === 'owner', `panel session: ${reg.error?.code || reg.data?.code}`);
}
const buyer = await session('RECOVERY QA BUYER');
const anon = createClient(url, anonKey, O);

const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: Boolean(ok), detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail); };

// Marker product in B, so cross-tenant reads have something to leak.
const marker = await admin.from('products').insert({ business_id: B, sku: 'QA-ISO-B', external_id: 'QA-ISO-B', name: 'QA marcador B',
  price: 100, stock: 5, brand: 'QA', category: 'Almacén', subcategory: 'QA', is_alcoholic: false, variant: 'unidad', presentation: 'unidad',
  capacity_value: 1, capacity_unit: 'unidad', capacity: '1 unidad', packaging_type: 'unidad', units_per_pack: 1, sort_order: 1,
  is_active: true, available: false, merchant_available: false, is_verified: false, catalog_origin: 'commercial', price_status: 'pending' }).select('id').single();
assert.ifError(marker.error);
try {
  // 1. Reads across tenants.
  const own = await ownerA.from('products').select('id,business_id').eq('business_id', A);
  check('owner A reads its own products', !own.error && own.data.length === 3, `rows=${own.data?.length}`);
  const cross = await ownerA.from('products').select('id').eq('business_id', B);
  check('owner A cannot read tenant B products', !cross.error && cross.data.length === 0, `rows=${cross.data?.length}`);
  const crossB = await ownerB.from('products').select('id').eq('business_id', A);
  check('owner B cannot read tenant A products', !crossB.error && crossB.data.length === 0, `rows=${crossB.data?.length}`);
  const members = await ownerA.from('business_members').select('user_id,business_id');
  check('owner A sees only its own membership rows', !members.error && members.data.every(m => m.business_id === A), `rows=${members.data?.length}`);

  // 2. Writes across tenants.
  const upd = await ownerA.from('products').update({ price: 1 }).eq('id', marker.data.id).select('id');
  check('owner A cannot update a tenant B product', upd.data?.length === 0 || Boolean(upd.error), upd.error?.code || `rows=${upd.data?.length}`);
  const ins = await ownerA.from('products').insert({ business_id: B, name: 'intruso', price: 1 });
  check('owner A cannot insert into tenant B', Boolean(ins.error), ins.error?.code || 'inserted');
  const bizUpd = await ownerA.from('businesses').update({ name: 'hijack' }).eq('id', B).select('id');
  check('owner A cannot rename tenant B', bizUpd.data?.length === 0 || Boolean(bizUpd.error), bizUpd.error?.code || `rows=${bizUpd.data?.length}`);
  const open = await ownerA.rpc('set_business_open_state', { p_business_id: B, p_status: 'open' });
  check('owner A cannot open tenant B', Boolean(open.error) || open.data?.ok !== true, open.error?.code || JSON.stringify(open.data).slice(0, 80));
  const promote = await ownerA.from('business_members').insert({ business_id: B, user_id: (await ownerA.auth.getUser()).data.user.id, role: 'owner' });
  check('owner A cannot self-grant owner in tenant B', Boolean(promote.error), promote.error?.code || 'inserted');

  // 3. Buyer and anon: no private tenant data, no payment tables, no QA catalogue while closed.
  const pub = await anon.from('products').select('id').in('business_id', [A, B]);
  check('anon sees no QA products while tenants are closed', !pub.error && pub.data.length === 0, `rows=${pub.data?.length}`);
  const buyerMembers = await buyer.from('business_members').select('id');
  check('buyer sees no staff membership', !buyerMembers.error && buyerMembers.data.length === 0, `rows=${buyerMembers.data?.length}`);
  for (const table of ['payment_intents', 'mp_seller_connections', 'mp_oauth_states', 'payment_webhook_receipts', 'payment_outbox']) {
    for (const [who, c] of [['anon', anon], ['buyer', buyer], ['owner A', ownerA]]) {
      const r = await c.from(table).select('*').limit(1);
      check(`${who} cannot read ${table}`, Boolean(r.error) || r.data.length === 0, r.error?.code || `rows=${r.data?.length}`);
    }
  }
  // 4. Sensitive columns of the product table stay private.
  const cost = await ownerA.from('products').select('unit_cost').eq('business_id', A).limit(1);
  check('unit_cost is not readable with a plain select', Boolean(cost.error), cost.error?.code || 'readable');
} finally {
  const del = await admin.from('products').delete().eq('id', marker.data.id);
  check('marker product cleanup', !del.error);
}
fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), projectRef: target.projectRef, checks }, null, 2));
if (checks.some(c => !c.ok)) process.exitCode = 1;
