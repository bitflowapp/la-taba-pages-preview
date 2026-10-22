// Shared fixture for scenarios that drive the REAL payment worker against REAL PostgreSQL with a SIMULATED
// Mercado Pago. Each fixture is a throw-away database cloned from TABA_LOCAL_DB (default taba_local_work).
import { psqlRaw } from '../../scripts/local-db/lib.mjs';
import { committedFixtureSql, FIXTURE_IDS } from '../db/harness.mjs';
import { createPgServiceClient } from './pg-service-client.mjs';
import { ProviderSim } from './provider-sim.mjs';
import { VirtualClock } from './virtual-clock.mjs';
import { loadWorker } from './worker-sandbox.mjs';

export const TEMPLATE = process.env.TABA_LOCAL_DB || 'taba_local_work';
export const REFERENCE = id => `taba2:checkout:${id}`;
export { FIXTURE_IDS };

const created = [];
export function newDatabase(label) {
  const db = `taba_local_it_${label}_${process.pid}`.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 62);
  created.push(db);
  psqlRaw('postgres', `drop database if exists ${db} with (force); create database ${db} template ${TEMPLATE};`);
  return db;
}
export function dropDatabases() {
  for (const db of created) psqlRaw('postgres', `drop database if exists ${db} with (force);`, { check: false });
}
export const query = (db, sql) => {
  const r = psqlRaw(db, sql, { tuples: true });
  const line = r.stdout.split('\n').map(s => s.trim()).filter(Boolean).pop();
  return line ? JSON.parse(line) : null;
};

/** The environment of the recovery deployment: one job per invocation (see paymentWorkerLimits). */
export const RECOVERY_ENV = Object.freeze({
  TABA_RECOVERY_PROJECT_REF: 'ixewllzzuzpqrkxzmfzx',
  TABA_RECOVERY_CHECKOUT_ORIGIN: 'https://recovery-20261020.taba2-staging.pages.dev',
  SUPABASE_URL: 'https://ixewllzzuzpqrkxzmfzx.supabase.co',
  MERCADOPAGO_OAUTH_PROJECT_REF: 'ixewllzzuzpqrkxzmfzx',
  MERCADOPAGO_CLIENT_ID: '2691240967769590',
  MERCADOPAGO_CREDENTIAL_MODE: 'oauth',
  TABA_DEPLOYMENT_ENV: 'staging',
  MERCADOPAGO_OAUTH_ENVIRONMENT: 'test',
});

export async function createFixture(label, { quantity = 2, connect = false, env = {}, providerOptions = {} } = {}) {
  const db = newDatabase(label);
  psqlRaw(db, committedFixtureSql(quantity));
  const ids = query(db, `select jsonb_build_object('session',cs.id,'intent',pi.id,'reference',pi.external_reference) from public.payment_intents pi join public.checkout_sessions cs on cs.id=pi.checkout_session_id where pi.business_id='${FIXTURE_IDS.business}'`);
  if (connect) {
    psqlRaw(db, `insert into public.mp_seller_connections(business_id,environment,seller_id,application_id,status,protected_tokens,expires_at) values('${FIXTURE_IDS.business}','test','collector-retry','application-retry','connected','SYNTHETIC_NONCREDENTIAL',clock_timestamp()+interval '30 days');`);
  }
  const sql = text => psqlRaw(db, text);
  const clock = new VirtualClock();
  const raw = createPgServiceClient(db);
  const provider = new ProviderSim({ clock, ...providerOptions });
  // Virtual time that passes inside an invocation ages every database lease by the same amount.
  const ageLeases = ms => sql(`set session_replication_role = replica;
    update public.payment_outbox set lease_expires_at = lease_expires_at - interval '${Math.round(ms)} milliseconds' where lease_expires_at is not null;
    update public.provider_ledger_cursors set lease_expires_at = lease_expires_at - interval '${Math.round(ms)} milliseconds' where lease_expires_at is not null;`);
  const worker = await loadWorker({ service: raw, provider, businessId: FIXTURE_IDS.business, clock, onShift: ageLeases, env });
  const has = table => query(db, `select to_jsonb(to_regclass('public.${table}') is not null)`) === true;
  const hasPayments = has('payment_provider_payments');
  const hasDisc = has('payment_discrepancies');
  const hasCursor = has('provider_ledger_cursors');
  const state = () => query(db, `select jsonb_build_object(
    'orders',(select count(*) from public.orders where business_id='${FIXTURE_IDS.business}'),
    'stock',(select stock from public.products where id='${FIXTURE_IDS.product}'),
    'intent',(select jsonb_build_object('status',internal_status,'provider_id',provider_payment_id,'provider_status',provider_status,'review',security_review_reason,'refunded',refunded_amount,'paid',paid_amount,'order_id',order_id) from public.payment_intents where id='${ids.intent}'),
    'payments',${hasPayments ? `(select coalesce(jsonb_agg((jsonb_build_object('id',provider_payment_id,'financing',is_financing) || (to_jsonb(p) - 'raw_response_hash' - 'id' - 'payment_intent_id')) order by provider_payment_id),'[]') from public.payment_provider_payments p where payment_intent_id='${ids.intent}')` : 'null'},
    'discrepancies',${hasDisc ? `(select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'status',status,'severity',severity,'blocks',blocks_recovery,'occ',occurrences,'pid',provider_payment_id) order by kind,provider_payment_id),'[]') from public.payment_discrepancies where business_id='${FIXTURE_IDS.business}')` : 'null'},
    'jobs',(select coalesce(jsonb_agg((jsonb_build_object('error',last_error) || (to_jsonb(j) - 'id' - 'owner' - 'webhook_receipt_id' - 'payment_intent_id')) order by created_at, topic, resource_id),'[]') from public.payment_outbox j),
    'reservations',(select coalesce(jsonb_agg(jsonb_build_object('status',status,'qty',quantity)),'[]') from public.inventory_reservations where checkout_session_id='${ids.session}'),
    'cursor',${hasCursor ? `(select to_jsonb(c) from public.provider_ledger_cursors c where business_id='${FIXTURE_IDS.business}')` : 'null'})`);
  const enqueueReconcile = (resourceId = null) => sql(`insert into public.payment_outbox(payment_intent_id,topic${resourceId ? ',resource_id' : ''}) values('${ids.intent}','payment_reconcile'${resourceId ? `,'${resourceId}'` : ''});`);
  const enqueuePaymentJob = resourceId => sql(`insert into public.payment_outbox(payment_intent_id,topic,resource_id) values('${ids.intent}','payment','${resourceId}');`);
  const dueNow = () => sql(`update public.payment_outbox set next_attempt_at=clock_timestamp()-interval '1 second' where status in ('retry_wait','pending');`);
  /** The ledger sweep is due again (its 10-minute period elapsed) and any backoff is over. */
  const ledgerDue = () => sql(`update public.provider_ledger_cursors set last_completed_at = clock_timestamp() - interval '11 minutes', updated_at = clock_timestamp() - interval '2 hours' where lease_expires_at is null;`);
  const expireLeases = () => sql(`set session_replication_role = replica; update public.payment_outbox set lease_expires_at = clock_timestamp() - interval '1 second' where lease_expires_at is not null;
    update public.provider_ledger_cursors set lease_expires_at = clock_timestamp() - interval '1 second' where lease_expires_at is not null;`);
  const snapshot = (payment, source = 'webhook') => query(db, `select to_jsonb(public.record_mercadopago_payment_snapshot('${ids.intent}','${JSON.stringify({
    provider_payment_id: String(payment.id), external_reference: payment.external_reference, preference_id: 'FORENSIC-PREF', merchant_order_id: payment.order.id,
    collector_id: payment.collector_id, currency: 'ARS', transaction_amount: Number(payment.transaction_amount).toFixed(2), status: payment.status,
    payment_method: 'visa', live_mode: true, provider_occurred_at: payment.date_last_updated, refunded_amount: '0.00', raw_response_hash: 'a'.repeat(64),
  })}'::jsonb,'${source}',null))`);
  return {
    db, ids, provider, worker, clock, sql, state, enqueueReconcile, enqueuePaymentJob, dueNow, ledgerDue, expireLeases, snapshot, service: raw,
    has, ageLeases,
  };
}
