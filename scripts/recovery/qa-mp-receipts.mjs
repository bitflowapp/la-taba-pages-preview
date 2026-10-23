// Read-only: the most recent Mercado Pago webhook receipts of the QA project (no payload, no signature material):
// what arrived, whether its signature was valid and what the processor did with it.
//   node scripts/recovery/qa-mp-receipts.mjs [--since ISO] [--limit 30]
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';

const ref = 'ixewllzzuzpqrkxzmfzx';
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const credential = leerSecreto('RECOVERY SUPABASE SERVICE KEY');
assert.equal(credential.usuario, ref);
const db = createClient(`https://${ref}.supabase.co`, credential.secreto, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await db.from('payment_webhook_receipts').select('*')
  .gte('received_at', arg('--since', new Date(Date.now() - 3600_000).toISOString()))
  .order('received_at', { ascending: true }).limit(Number(arg('--limit', '30')));
assert.ifError(error);
const SAFE = ['received_at', 'processed_at', 'environment', 'event_type', 'resource_id', 'signature_valid', 'processing_status', 'request_id', 'seller_business_id', 'business_id', 'attempt_count', 'webhook_event_id'];
console.log(JSON.stringify({ count: data.length, columns: data[0] ? Object.keys(data[0]) : [],
  receipts: data.map((row) => Object.fromEntries(SAFE.filter((k) => k in row).map((k) => [k, row[k]]))) }, null, 1));
