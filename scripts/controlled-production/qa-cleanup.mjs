// Cleanup of synthetic QA orders through the same RPCs the panel uses:
// reverse a confirmed manual payment (owner), cancel (stock returns once),
// restore stock of a delivered QA order with an audited inventory movement,
// then classify the order as QA. Never writes order state by SQL.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { loadTargetKeys } from './target-keys.mjs';
import { signIn } from './accounts.mjs';

const TERMINAL = new Set(['delivered', 'canceled', 'cancelled', 'rejected']);
const OPTIONS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const compact = (id) => id.replaceAll('-', '');

export async function cleanupQaOrder({ admin, owner, staff, businessId, orderId, reason }) {
  const read = async () => {
    const { data, error } = await staff.from('orders').select('id,status,revision,manual_payment_status,origin,picked_up_at')
      .eq('id', orderId).single();
    if (error) throw Error(`READ:${error.code}`);
    return data;
  };
  const done = { reversed: false, cancelled: false, restoredUnits: 0, classified: false };
  let cur = await read();
  if (cur.manual_payment_status === 'confirmed') {
    const r = await owner.rpc('reverse_manual_order_payment', { p_order_id: orderId, p_expected_revision: cur.revision,
      p_reason: `${reason}: sin dinero real`, p_idempotency_key: `qa_reverse_${compact(orderId)}_${cur.revision}` });
    if (r.error) throw Error(`REVERSE:${r.error.code}`);
    done.reversed = true; cur = await read();
  }
  if (!TERMINAL.has(cur.status)) {
    const r = await staff.rpc('cancel_order', { p_order_id: orderId, p_expected_revision: cur.revision,
      p_reason: `${reason}: limpieza`, p_idempotency_key: `qa_cancel_${compact(orderId)}_${cur.revision}` });
    if (r.error) throw Error(`CANCEL:${r.error.code}`);
    done.cancelled = true; cur = await read();
  }
  // Stock only returns by itself when an order is cancelled before it left the
  // store. A delivered QA order, or one cancelled after pickup, gets its units
  // back through an audited movement (idempotent per order and product).
  if (cur.status === 'delivered' || (['canceled', 'cancelled'].includes(cur.status) && cur.picked_up_at)) {
    const items = await admin.from('order_items').select('product_id,quantity').eq('order_id', orderId);
    if (items.error) throw Error(`ITEMS:${items.error.code}`);
    for (const item of items.data) {
      if (!item.product_id) continue;
      const r = await owner.rpc('apply_inventory_movement', { p_business_id: businessId, p_product_id: item.product_id,
        p_barcode_id: null, p_movement_type: 'manual_adjustment', p_package_quantity: Number(item.quantity),
        p_direction: 1, p_reference_type: 'pilot_qa_return', p_reference_id: orderId,
        p_reason: `${reason}: mercadería no entregada físicamente`,
        p_idempotency_key: `qa_restore_${compact(orderId)}_${compact(item.product_id).slice(0, 12)}` });
      if (r.error) throw Error(`RESTORE:${r.error.code}`);
      done.restoredUnits += Number(item.quantity);
    }
  }
  if (cur.origin !== 'qa') {
    const snake = reason.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const q = await admin.rpc('classify_order_as_qa', { p_order_id: orderId, p_reason: snake.slice(0, 60) || 'qa_cleanup' });
    if (q.error) throw Error(`CLASSIFY:${q.error.code}`);
  }
  done.classified = true;
  return done;
}

export async function operatorClient(keys, credentialName, businessId, label) {
  const stored = leerSecreto(credentialName);
  assert.ok(stored?.secreto, `QA_CREDENTIAL_REQUIRED:${credentialName}`);
  const c = createClient(keys.url, keys.publishable, OPTIONS);
  await signIn(c, stored.usuario, stored.secreto);
  const reg = await c.rpc('identity_register_session', { p_business_id: businessId, p_client: 'panel_web',
    p_device_label: `QA cleanup ${label}`, p_device_key_hash: null, p_app_version: 'cp-qa-cleanup' });
  if (reg.error || !reg.data?.ok) throw Error(`OPERATOR_SESSION_REFUSED:${label}`);
  return c;
}

async function main(args) {
  const opt = (name) => { const i = args.indexOf(name); return i < 0 ? '' : args[i + 1]; };
  const target = opt('--target');
  const keys = await loadTargetKeys(target);
  const businessId = opt('--business-id');
  const notes = opt('--notes');
  const since = opt('--since');
  assert.ok(notes.length >= 8 && Number.isFinite(Date.parse(since)), 'NOTES_AND_SINCE_REQUIRED');
  const admin = createClient(keys.url, keys.secret, OPTIONS);
  const owner = await operatorClient(keys, opt('--owner-credential'), businessId, 'owner');
  const staff = await operatorClient(keys, opt('--staff-credential'), businessId, 'staff');
  const found = await admin.from('orders').select('id,public_code,status,origin').eq('business_id', businessId)
    .eq('customer_notes', notes).gte('created_at', since);
  if (found.error) throw Error(`FIND:${found.error.code}`);
  const results = [];
  for (const order of found.data) {
    try {
      results.push({ code: order.public_code, ...(await cleanupQaOrder({ admin, owner, staff, businessId,
        orderId: order.id, reason: opt('--reason') || 'QA controlada' })) });
    } catch (error) { results.push({ code: order.public_code, error: error.message }); }
  }
  console.log(JSON.stringify({ target, ref: keys.ref, orders: results.length, results }));
  if (results.some((r) => r.error)) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((error) => { console.error(`QA_CLEANUP_BLOCKED:${error.message}`); process.exitCode = 1; });
}
