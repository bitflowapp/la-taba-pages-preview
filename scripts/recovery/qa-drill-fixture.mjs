// Per-run, credential-free synthetic fixtures. All writes belong to the run;
// the receipt is saved BEFORE the first SQL call so cleanup survives a crash.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { committedFixtureSql } from '../../tests/db/harness.mjs';

const PROJECT = 'ixewllzzuzpqrkxzmfzx';
const ROOT = path.resolve(import.meta.dirname, '../..');
function uuid(run, kind) {
  const h = createHash('sha256').update(`${run}:${kind}`).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;
}
export function drillRun(kind, runId = randomUUID()) {
  if (!['recovery','late-changes'].includes(kind) || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(runId))
    throw Error('Invalid drill run');
  const tag = runId.replaceAll('-', '');
  return { version: 1, projectRef: PROJECT, kind, runId, tag,
    ids: Object.fromEntries(['user','business','product','asset'].map(k => [k, uuid(runId,k)])),
    slug: `qa-drill-${tag}`, email: `qa-drill-${tag}@example.invalid`,
    preference: `QA-DRILL-${tag}`, collector: `qa-drill-${tag}`,
    // Numeric resource IDs, unique to this run, never a real provider credential.
    payment: String(BigInt('0x'+tag.slice(0,15))), job: String(BigInt('0x'+tag.slice(0,15))+1n) };
}
export function validateRun(run) {
  if (JSON.stringify(run) !== JSON.stringify(drillRun(run.kind, run.runId))) throw Error('Drill receipt identity mismatch');
  return run;
}
export function saveRun(file, run) {
  const p = path.resolve(file), relative = path.relative(ROOT,p);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) throw Error('Store drill receipts outside the repository');
  fs.writeFileSync(p, JSON.stringify(validateRun(run),null,2)+'\n', { flag:'wx', mode:0o600 });
}
export function fixtureSql(run) {
  validateRun(run);
  let sql = committedFixtureSql(2);
  for (const [k,prefix] of Object.entries({user:'1',business:'2',product:'3',asset:'4'}))
    sql = sql.replaceAll(`${prefix}0000000-0000-4000-8000-0000000000fa`,run.ids[k]);
  sql = sql.replaceAll('forensic-fix-test@example.invalid',run.email)
    .replaceAll('forensic-fix-fixture',run.slug).replaceAll('forensic-fix',run.slug)
    .replaceAll('FORENSIC-PREF',run.preference).replaceAll('collector-retry',run.collector)
    .replaceAll('forensicfix000001',`qa${run.tag}`)
    .replace("'MP retry fixture'",`'QA drill ${run.tag}'`);
  // Bounded admission window, including after a hard kill. The separate tenant
  // is explicitly QA; no real seller connection or credential is ever created.
  sql = sql.replace('currency_code, pickup_enabled)', 'currency_code, pickup_enabled, qa_fixture, qa_window_until)')
    .replace("v_user, 'ARS', true);", "v_user, 'ARS', true, true, clock_timestamp()+interval '15 minutes');");
  return `begin; set local lock_timeout='5s'; set local statement_timeout='30s';
    select pg_advisory_xact_lock(hashtextextended('${run.runId}',0)); ${sql} commit;`;
}

export function cleanupSql(run) {
  validateRun(run);
  const { business:b,user:u }=run.ids;
  return `begin; set local lock_timeout='5s'; set local statement_timeout='30s';
  do $cleanup$ begin
    -- Locks serialize creation/cleanup and two cleanup attempts for the same run.
    perform pg_advisory_xact_lock(hashtextextended('${run.runId}',0));
    perform 1 from public.businesses where id='${b}' for update;
    if exists(select 1 from public.businesses where id='${b}' and
      (not qa_fixture or slug<>'${run.slug}' or name<>'QA drill ${run.tag}' or ordering_verified_by is distinct from '${u}'::uuid))
      or exists(select 1 from auth.users where id='${u}' and email is distinct from '${run.email}')
      or exists(select 1 from public.mp_seller_connections where business_id='${b}')
      or exists(select 1 from public.mp_oauth_states where business_id='${b}')
      or exists(select 1 from public.payment_intents where business_id='${b}' and environment<>'test')
      or exists(select 1 from public.checkout_sessions where business_id='${b}' and customer_id is distinct from '${u}'::uuid)
      or exists(select 1 from public.orders where business_id='${b}' and customer_user_id is distinct from '${u}'::uuid)
      or exists(select 1 from public.products where business_id='${b}' and id<>'${run.ids.product}')
      or exists(select 1 from public.catalog_assets where business_id='${b}' and id<>'${run.ids.asset}')
      or exists(select 1 from public.products where catalog_asset_id='${run.ids.asset}' and business_id<>'${b}')
      or exists(select 1 from public.order_items oi join public.orders o on o.id=oi.order_id
        where oi.product_uuid='${run.ids.product}' and o.business_id<>'${b}')
      or exists(select 1 from public.business_payment_settings where business_id='${b}' and
        (environment<>'test' or collector_id is distinct from '${run.collector}'))
    then raise exception 'Cleanup refused: run ownership or test-only boundary changed'; end if;
    -- Only rows generated by these drills. Unexpected dependencies fail and roll
    -- back the entire cleanup; never disable triggers, CASCADE, or audit retention.
    delete from public.operational_alert_events where business_id='${b}';
    delete from public.operational_alerts where business_id='${b}';
    delete from public.provider_ledger_cursors where business_id='${b}';
    delete from public.payment_discrepancies where business_id='${b}';
    delete from public.payment_outbox where payment_intent_id in (select id from public.payment_intents where business_id='${b}');
    delete from public.payment_provider_payments where payment_intent_id in (select id from public.payment_intents where business_id='${b}');
    delete from public.payment_refunds where payment_intent_id in (select id from public.payment_intents where business_id='${b}');
    delete from public.payment_cancellations where payment_intent_id in (select id from public.payment_intents where business_id='${b}');
    delete from public.payment_disputes where payment_intent_id in (select id from public.payment_intents where business_id='${b}');
    delete from public.payment_intents where business_id='${b}';
    delete from public.checkout_sessions where business_id='${b}';
    delete from public.orders where business_id='${b}';
    update public.catalog_assets set product_id=null where business_id='${b}';
    delete from public.products where business_id='${b}';
    delete from public.catalog_assets where business_id='${b}';
    delete from public.businesses where id='${b}';
    delete from auth.users where id='${u}';
  end $cleanup$; commit;`;
}

export async function withDrillFixture(query, run, action) {
  let failure, result;
  try { await query(fixtureSql(run)); result=await action(); }
  catch(error) {
    failure=error;
    // A persistent local connection can still be in an aborted transaction.
    // Roll it back before attempting the independent cleanup transaction.
    try { await query('rollback;'); } catch { /* reconnect/receipt recovery may be required */ }
  }
  try { await query(cleanupSql(run)); }
  catch(error) {
    if(failure) throw new AggregateError([failure,error],'Drill failed and cleanup requires its saved receipt');
    throw error;
  }
  if(failure) throw failure;
  return result;
}
