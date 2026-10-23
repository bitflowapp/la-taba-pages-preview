// Read-only: one QA refund row (every column except token/secret/key-like ones) and the latest payment events of
// its intent, to see what La Taba recorded about a provider answer.
//   node scripts/recovery/qa-mp-refund-inspect.mjs <payment_refunds.id>
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';

const ref = 'ixewllzzuzpqrkxzmfzx';
const refundId = process.argv[2];
assert.match(refundId || '', /^[0-9a-f-]{36}$/);
const credential = leerSecreto('RECOVERY SUPABASE SERVICE KEY');
assert.equal(credential.usuario, ref);
const db = createClient(`https://${ref}.supabase.co`, credential.secreto, { auth: { persistSession: false, autoRefreshToken: false } });
const hide = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, /token|secret|key|payload|raw/i.test(k) && k !== 'idempotency_key' ? '[hidden]' : v]));
const { data: refund, error } = await db.from('payment_refunds').select('*').eq('id', refundId).single();
assert.ifError(error);
console.log(JSON.stringify({ refund: hide(refund) }, null, 1));
for (const table of ['payment_events', 'payment_audit_events']) {
  const { data, error: e } = await db.from(table).select('*').eq('payment_intent_id', refund.payment_intent_id).limit(20);
  console.log(JSON.stringify({ table, error: e?.message || null, rows: (data || []).map(hide).slice(-12) }, null, 1).slice(0, 6000));
}
