// Operational pulse for CONTROLLED_PRODUCTION. READ ONLY. Answers, without
// opening the panel, what an operator needs during the controlled rollout:
// is the backend the right one, did orders come in, is anything stuck, is
// money pending registration, are riders and GPS alive, are there open alerts,
// is stock sane. No PII, tokens or delivery codes are printed.
//
//   node scripts/controlled-production/ops-pulse.mjs --target controlled-production --business-id <uuid> [--hours 24]
//
// Exit 0 = healthy, 1 = something to look at, 2 = could not ask.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { loadTargetKeys } from './target-keys.mjs';

const TERMINAL = ['delivered', 'canceled', 'cancelled', 'rejected'];
// Minutes after which a non-terminal order counts as stuck, per stored status.
export const STUCK_AFTER_MINUTES = Object.freeze({
  received: 10, submitted: 10, accepted: 20, preparing: 40, ready: 20,
  assigned: 30, picked_up: 45, on_the_way: 60, arrived: 20,
});
export const GPS_STALE_SECONDS = 120;

export function classifyOrders(rows, now = Date.now()) {
  const byStatus = {};
  const stuck = [];
  const unpaidDelivered = [];
  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] || 0) + 1;
    const ageMinutes = (now - Date.parse(row.updated_at || row.created_at)) / 60_000;
    const limit = STUCK_AFTER_MINUTES[row.status];
    if (!TERMINAL.includes(row.status) && limit && ageMinutes > limit) {
      stuck.push({ code: row.public_code, status: row.status, minutes: Math.round(ageMinutes) });
    }
    if (row.status === 'delivered' && row.manual_payment_status === 'pending') {
      unpaidDelivered.push(row.public_code);
    }
  }
  return { byStatus, stuck, unpaidDelivered };
}

async function main(args) {
  const opt = (name, fallback = '') => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
  const target = opt('--target');
  const businessId = opt('--business-id');
  const hours = Number(opt('--hours', '24'));
  assert.match(businessId, /^[0-9a-f-]{36}$/, 'BUSINESS_ID_REQUIRED');
  let keys;
  try { keys = await loadTargetKeys(target); } catch (error) {
    console.error(`OPS_PULSE_UNREACHABLE:${error.message}`); process.exit(2);
  }
  const db = createClient(keys.url, keys.secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const report = { at: new Date().toISOString(), target, ref: keys.ref, windowHours: hours, checks: {} };
  const warn = [];
  const check = async (name, fn) => {
    try { report.checks[name] = await fn(); } catch (error) { report.checks[name] = { error: error.message }; warn.push(`${name}:UNKNOWN`); }
  };
  const q = async (promise) => { const { data, error } = await promise; if (error) throw Error(error.code || error.message); return data; };

  await check('business', async () => {
    const row = await q(db.from('businesses').select('status,ordering_enabled,is_active').eq('id', businessId).single());
    return row;
  });
  await check('orders', async () => {
    const rows = await q(db.from('orders').select('public_code,status,manual_payment_status,origin,created_at,updated_at')
      .eq('business_id', businessId).or(`created_at.gte.${since},status.not.in.(${TERMINAL.join(',')})`)
      .neq('origin', 'qa').limit(1000));
    const created = rows.filter((row) => row.created_at >= since).length;
    const result = { createdInWindow: created, ...classifyOrders(rows) };
    if (result.stuck.length) warn.push(`STUCK_ORDERS:${result.stuck.length}`);
    if (result.unpaidDelivered.length) warn.push(`DELIVERED_WITH_PAYMENT_PENDING:${result.unpaidDelivered.length}`);
    return result;
  });
  await check('manualPayments', async () => {
    const events = await q(db.from('order_events').select('event_type').eq('business_id', businessId)
      .gte('created_at', since).in('event_type', ['order.manual_payment_confirmed', 'order.manual_payment_reversed', 'business_cancel_reason']));
    const count = (type) => events.filter((row) => row.event_type === type).length;
    return { confirmed: count('order.manual_payment_confirmed'), reversed: count('order.manual_payment_reversed'),
      cancellations: count('business_cancel_reason') };
  });
  await check('riders', async () => {
    const presence = await q(db.from('rider_availability').select('rider_user_id,available,last_seen_at').eq('business_id', businessId));
    const fresh = presence.filter((row) => row.available && Date.now() - Date.parse(row.last_seen_at || 0) < 90_000).length;
    const active = await q(db.from('orders').select('id,public_code,status').eq('business_id', businessId)
      .in('status', ['assigned', 'picked_up', 'on_the_way', 'arrived']).neq('origin', 'qa'));
    const staleGps = [];
    for (const order of active.filter((row) => ['picked_up', 'on_the_way'].includes(row.status))) {
      const last = await q(db.from('rider_locations').select('created_at').eq('order_id', order.id)
        .order('created_at', { ascending: false }).limit(1));
      const age = last[0] ? (Date.now() - Date.parse(last[0].created_at)) / 1000 : Infinity;
      if (age > GPS_STALE_SECONDS) staleGps.push({ code: order.public_code, seconds: Number.isFinite(age) ? Math.round(age) : null });
    }
    if (staleGps.length) warn.push(`GPS_STALE:${staleGps.length}`);
    if (active.length && !fresh) warn.push('ACTIVE_DELIVERIES_WITHOUT_AVAILABLE_RIDER');
    return { availableNow: fresh, members: presence.length, activeDeliveries: active.length, staleGps };
  });
  await check('alerts', async () => {
    const rows = await q(db.from('operational_alerts').select('severity,alert_code,status')
      .eq('business_id', businessId).not('status', 'in', '(resolved,closed)'));
    if (rows.length) warn.push(`OPEN_ALERTS:${rows.length}`);
    return { open: rows.length, codes: [...new Set(rows.map((row) => row.alert_code))] };
  });
  await check('stock', async () => {
    const rows = await q(db.from('products').select('sku,stock,available,is_verified,is_active').eq('business_id', businessId));
    const negative = rows.filter((row) => Number(row.stock) < 0).length;
    const publishedOut = rows.filter((row) => row.available && row.is_verified && row.is_active && Number(row.stock) <= 0).length;
    if (negative) warn.push(`NEGATIVE_STOCK:${negative}`);
    return { products: rows.length, published: rows.filter((row) => row.available && row.is_verified && row.is_active).length,
      negative, publishedOutOfStock: publishedOut };
  });
  report.status = warn.length ? 'LOOK' : 'HEALTHY';
  report.attention = warn;
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = warn.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((error) => { console.error(`OPS_PULSE_FAILED:${error.message}`); process.exitCode = 2; });
}
