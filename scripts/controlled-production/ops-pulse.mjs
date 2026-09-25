// Operational pulse for CONTROLLED_PRODUCTION. READ ONLY. Answers, without
// opening the panel, what an operator needs during the controlled rollout:
// is the backend the right one, did orders come in, is anything stuck, is
// money pending registration, are riders and GPS alive, are there open alerts,
// is stock sane, can Mercado Pago charge and is its queue moving. No PII,
// tokens or delivery codes are printed.
//
//   node scripts/controlled-production/ops-pulse.mjs --target controlled-production --business-id <uuid> [--hours 24]
//   ... --public   only the publishable key (scheduler, realtime, public exposure,
//                  other tenants open): runs from CI or the cloud without secrets.
//
// Exit 0 = healthy, 1 = something to look at, 2 = could not ask.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { loadTargetKeys } from './target-keys.mjs';
import { foreignPublicTenants, publicCatalogTenants } from './qa-window.mjs';

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

// Mercado Pago signals for one business. The rows come from the service role,
// but the selects never include credentials (protected_tokens), account ids or
// payer data: the pulse says WHAT is wrong, the panel and the runbook say how.
export const MP_TOKEN_EXPIRY_WARNING_DAYS = 7;
const MP_STALL_MS = 5 * 60_000;
export function classifyMercadoPago({ settings = [], connections = [], outbox = [], intents = [], refunds = [], receipts = [] }, now = Date.now()) {
  const warn = [];
  const setting = settings[0] || null;
  const enabled = Boolean(setting?.enabled);
  const environment = setting?.environment || null;
  const connection = connections.find((row) => row.environment === environment) || connections[0] || null;
  if (enabled && connection?.status !== 'connected') warn.push(`MP_SELLER_CANNOT_CHARGE:${connection?.status || 'missing'}`);
  if (connection?.status === 'connected' && connection.expires_at
    && Date.parse(connection.expires_at) - now < MP_TOKEN_EXPIRY_WARNING_DAYS * 86_400_000) warn.push('MP_SELLER_TOKEN_EXPIRING');
  const due = outbox.filter((row) => (['pending', 'retry_wait'].includes(row.status) && Date.parse(row.next_attempt_at) < now - MP_STALL_MS)
    || (['claimed', 'processing'].includes(row.status) && Date.parse(row.lease_expires_at) < now - MP_STALL_MS)).length;
  const dead = outbox.filter((row) => ['failed', 'dead_letter'].includes(row.status)).length;
  if (due) warn.push(`MP_OUTBOX_STALLED:${due}`);
  if (dead) warn.push(`MP_OUTBOX_DEAD_LETTER:${dead}`);
  const inReview = intents.filter((row) => ['ambiguous', 'security_review_required', 'approved_order_pending'].includes(row.internal_status)).length;
  const paidWithoutOrder = intents.filter((row) => ['approved', 'approved_order_pending'].includes(row.internal_status)
    && !row.order_id && Date.parse(row.updated_at) < now - MP_STALL_MS).length;
  if (inReview) warn.push(`MP_PAYMENTS_NEED_RECONCILIATION:${inReview}`);
  if (paidWithoutOrder) warn.push(`MP_PAID_WITHOUT_ORDER:${paidWithoutOrder}`);
  const ambiguousRefunds = refunds.filter((row) => row.status === 'ambiguous').length;
  if (ambiguousRefunds) warn.push(`MP_REFUND_RECONCILIATION:${ambiguousRefunds}`);
  const webhookRejected = receipts.filter((row) => row.processing_status === 'rejected_signature').length;
  const webhookValid = receipts.filter((row) => row.signature_valid === true).length;
  if (webhookRejected) warn.push(`MP_WEBHOOK_SIGNATURE_REJECTED:${webhookRejected}${webhookValid ? '' : ':NONE_VALID'}`);
  return {
    summary: { enabled, environment, reviewStatus: setting?.production_review_status ?? null, connection: connection?.status ?? 'none',
      outboxDue: due, outboxDead: dead, inReview, paidWithoutOrder, ambiguousRefunds, webhookRejected, webhookValid },
    warn,
  };
}

// Checks that need only the publishable key: runnable from any machine, CI or
// the cloud without secrets. Nothing private is read or printed.
export async function publicChecks({ anon, businessId, check, warn, realtimeTimeoutMs = 10_000 }) {
  await check('scheduler', async () => {
    const { data, error } = await anon.rpc('scheduler_heartbeat');
    if (error) throw Error(error.code || error.message);
    if (!data?.healthy) warn.push(`SCHEDULER_STALE:${data?.age_seconds ?? 'never'}`);
    return { healthy: Boolean(data?.healthy), ageSeconds: data?.age_seconds ?? null };
  });
  // Only the real business may have a public catalog; an open QA tenant takes
  // anonymous orders and exposes QA products.
  await check('publicExposure', async () => {
    const foreign = foreignPublicTenants(await publicCatalogTenants(anon), businessId);
    if (foreign.length) warn.push(`FOREIGN_TENANT_PUBLIC:${foreign.length}`);
    return { foreignPublicTenants: foreign.length };
  });
  await check('tenants', async () => {
    const { data, error } = await anon.from('businesses').select('id,status').limit(100);
    if (error) throw Error(error.code || error.message);
    const otherOpen = (data || []).filter((row) => row.id !== businessId && row.status !== 'closed').length;
    if (otherOpen) warn.push(`OTHER_TENANT_OPEN:${otherOpen}`);
    const own = (data || []).find((row) => row.id === businessId);
    return { businessStatus: own?.status ?? 'not_visible', otherTenantsOpen: otherOpen };
  });
  await check('realtime', async () => {
    const started = Date.now();
    const channel = anon.channel(`ops-pulse-${Math.random().toString(36).slice(2, 10)}`);
    const status = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve('TIMED_OUT'), realtimeTimeoutMs);
      channel.subscribe((value) => {
        if (['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(value)) { clearTimeout(timer); resolve(value); }
      });
    });
    await anon.removeChannel(channel).catch(() => {});
    anon.realtime?.disconnect?.();
    if (status !== 'SUBSCRIBED') warn.push(`REALTIME_UNAVAILABLE:${status}`);
    return { status, ms: Date.now() - started };
  });
}

async function main(args) {
  const opt = (name, fallback = '') => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
  const target = opt('--target');
  const businessId = opt('--business-id');
  const hours = Number(opt('--hours', '24'));
  assert.match(businessId, /^[0-9a-f-]{36}$/, 'BUSINESS_ID_REQUIRED');
  const publicOnly = args.includes('--public');
  let keys;
  try { keys = await loadTargetKeys(target, { requireSecret: !publicOnly }); } catch (error) {
    console.error(`OPS_PULSE_UNREACHABLE:${error.message}`); process.exit(2);
  }
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const anon = createClient(keys.url, keys.publishable, options);
  const db = publicOnly ? null : createClient(keys.url, keys.secret, options);
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const report = { at: new Date().toISOString(), target, ref: keys.ref, mode: publicOnly ? 'public' : 'full', windowHours: hours, checks: {} };
  const warn = [];
  const check = async (name, fn) => {
    try { report.checks[name] = await fn(); } catch (error) { report.checks[name] = { error: error.message }; warn.push(`${name}:UNKNOWN`); }
  };
  const q = async (promise) => { const { data, error } = await promise; if (error) throw Error(error.code || error.message); return data; };
  await publicChecks({ anon, businessId, check, warn });
  if (publicOnly) return finish(report, warn);

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
  await check('mercadopago', async () => {
    const settings = await q(db.from('business_payment_settings').select('enabled,environment,production_review_status')
      .eq('business_id', businessId).eq('provider', 'mercadopago'));
    const connections = await q(db.from('mp_seller_connections').select('environment,status,expires_at').eq('business_id', businessId));
    const intents = await q(db.from('payment_intents').select('id,internal_status,order_id,updated_at').eq('business_id', businessId)
      .or(`updated_at.gte.${since},internal_status.in.(ambiguous,security_review_required,approved_order_pending,approved)`).limit(1000));
    const ids = intents.map((row) => row.id);
    const outbox = [
      ...(ids.length ? await q(db.from('payment_outbox').select('status,next_attempt_at,lease_expires_at')
        .in('payment_intent_id', ids).neq('status', 'completed')) : []),
      // Notification jobs not yet tied to an intent belong to no business but
      // stall everyone's payments just the same.
      ...await q(db.from('payment_outbox').select('status,next_attempt_at,lease_expires_at')
        .is('payment_intent_id', null).neq('status', 'completed').limit(1000)),
    ];
    const refunds = ids.length ? await q(db.from('payment_refunds').select('status').in('payment_intent_id', ids).eq('status', 'ambiguous')) : [];
    const receipts = await q(db.from('payment_webhook_receipts').select('processing_status,signature_valid').gte('received_at', since).limit(5000));
    const result = classifyMercadoPago({ settings, connections, outbox, intents, refunds, receipts });
    warn.push(...result.warn);
    return result.summary;
  });
  await check('stock', async () => {
    const rows = await q(db.from('products').select('sku,stock,available,is_verified,is_active').eq('business_id', businessId));
    const negative = rows.filter((row) => Number(row.stock) < 0).length;
    const publishedOut = rows.filter((row) => row.available && row.is_verified && row.is_active && Number(row.stock) <= 0).length;
    if (negative) warn.push(`NEGATIVE_STOCK:${negative}`);
    return { products: rows.length, published: rows.filter((row) => row.available && row.is_verified && row.is_active).length,
      negative, publishedOutOfStock: publishedOut };
  });
  finish(report, warn);
}

function finish(report, warn) {
  report.status = warn.length ? 'LOOK' : 'HEALTHY';
  report.attention = warn;
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = warn.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((error) => { console.error(`OPS_PULSE_FAILED:${error.message}`); process.exitCode = 2; });
}
