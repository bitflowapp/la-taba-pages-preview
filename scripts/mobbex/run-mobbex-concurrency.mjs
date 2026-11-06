#!/usr/bin/env node
/**
 * REAL concurrency for the Mobbex ledger: independent PostgreSQL sessions that start at the same instant.
 *
 *   TABA_LOCAL_PAYMENT_DB=1 node scripts/mobbex/run-mobbex-concurrency.mjs --native [--workers=6] [--rounds=12]
 *
 * The transactional contract (mobbex_ledger.local.sql) runs inside ONE session and rolls back, so it can prove the rules but not the
 * races. This script needs COMMITTED data and several backends, so it:
 *   1. connects to the throwaway native cluster that `run-mobbex-db-tests.mjs --native --keep` leaves running
 *      (MOBBEX_NATIVE_PG_DIR / MOBBEX_NATIVE_PG_PORT, same defaults as the runner),
 *   2. copies it into a NEW database (`create database ... template`) and applies the Mobbex migrations there,
 *   3. for each scenario builds committed fixtures in one session, then opens N backends that all block on an advisory lock and are
 *      released together (a real simultaneous start, not N sequential calls),
 *   4. asserts the invariants on the final committed state and drops the database.
 *
 * It never touches a remote database and never starts Docker. A deadlock (SQLSTATE 40P01) or a serialization failure in any worker
 * fails the run: the ledger's lock order (payment -> session -> refund) is supposed to make them impossible.
 *
 * What it proves: the database serializes concurrent webhook/worker/browser callers. What it does NOT prove: Mobbex's own behaviour.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

assert.equal(process.env.TABA_LOCAL_PAYMENT_DB, '1', 'TABA_LOCAL_PAYMENT_DB=1 required');
assert.ok(process.argv.includes('--native'), 'only --native is supported (a throwaway local cluster); see the header');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.MOBBEX_NATIVE_PG_PORT || 54329);
const WORKERS = Number((process.argv.find((a) => a.startsWith('--workers=')) || '--workers=6').split('=')[1]);
const ROUNDS = Number((process.argv.find((a) => a.startsWith('--rounds=')) || '--rounds=12').split('=')[1]);
const DB = `mbx_conc_${process.pid}_${randomUUID().slice(0, 6)}`;
assert.match(DB, /^mbx_conc_\d+_[0-9a-f]{6}$/);
const STUBBED_EXTENSIONS = /^create extension if not exists (?:pg_cron|pg_net|supabase_vault)\b[^;]*;[ \t]*$/gim;
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const migration = (name) => read(`supabase/migrations/${name}`).replace(STUBBED_EXTENSIONS, '-- (stubbed in native mode)');
const args = (db) => ['-h', '127.0.0.1', '-p', String(PORT), '-U', 'postgres', '-d', db, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'];
const psql = (db, input, { stdoutOnly = false } = {}) => {
  const r = spawnSync('psql', args(db), { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true, cwd: os.tmpdir() });
  if (r.status !== 0) throw new Error(`psql failed on ${db}: ${String(r.stderr).split('\n').slice(-8).join('\n')}`);
  return stdoutOnly ? r.stdout : `${r.stdout}\n${r.stderr}`;
};

// The ledger contract's own helpers (pg_temp.make_tenant / new_checkout / snap / intent_of): same fixtures as the transactional test.
const HELPERS = read('supabase/tests/mobbex_ledger.local.sql').split('\nselect pg_temp.as_admin();')[0];
const IDS = (out, tag = 'IDS') => JSON.parse(new RegExp(`${tag}\\|(\\{.*\\})`).exec(out)?.[1] ?? 'null');
const USER_CLAIMS = (uuid) => `select set_config('request.jwt.claim.sub', '${uuid}', false), set_config('role', 'authenticated', false),
  set_config('request.jwt.claims', jsonb_build_object('sub', '${uuid}'::uuid, 'role', 'authenticated', 'session_id', md5('mbx-session-${uuid}')::uuid)::text, false);`;

/** Fixture session: committed tenant + a checkout (+ optionally an approved payment and a refund). Returns the ids. */
function fixture({ approve = false, quantity = 2, stock = 20 } = {}) {
  const tag = randomUUID().slice(0, 8);
  const out = psql(DB, `${HELPERS}
select pg_temp.as_admin();
do $$ declare t jsonb; c jsonb; s uuid; i uuid; ref text; r jsonb;
begin
  t := pg_temp.make_tenant('${tag}', ${stock});
  perform public.configure_mobbex_business((t ->> 'business')::uuid, true, 'test', 'not_requested', null, 'qa-concurrency');
  c := pg_temp.new_checkout(t, ${quantity}, 'mbxconc${tag}');
  s := (c ->> 'checkout_session_id')::uuid; i := pg_temp.intent_of(s); ref := c ->> 'reference';
  perform public.mobbex_prepare_checkout(s, (t ->> 'buyer')::uuid);
  perform public.mobbex_record_checkout_created(i, 'CHK:C${tag}', 'https://mobbex.com/p/checkout/v2/CHK:C${tag}', repeat('a', 64));
  ${approve ? `r := public.mobbex_record_provider_snapshot(i, pg_temp.snap(ref, 'approved', '200', 'OP-${tag}', '${quantity * 1250}.00', 0, '1'), 'webhook');` : ''}
  raise notice 'IDS|%', jsonb_build_object('tag', '${tag}', 'owner', t ->> 'owner', 'buyer', t ->> 'buyer', 'business', t ->> 'business',
    'product', t ->> 'product', 'session', s, 'intent', i, 'reference', ref, 'total', ${quantity * 1250});
end $$;`);
  const ids = IDS(out);
  assert.ok(ids?.intent, `fixture failed: ${out.slice(-400)}`);
  return ids;
}

/** Runs one SQL script per backend; all of them block on an advisory lock and are released at the same instant. */
async function race(scripts) {
  const key = 770000 + Math.floor(Math.random() * 9000);
  const gate = spawn('psql', args(DB), { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, cwd: os.tmpdir() });
  gate.stdin.write(`select pg_advisory_lock(${key});\nselect 'GATE_HELD';\n`);
  await new Promise((resolve, reject) => { gate.stdout.on('data', (d) => String(d).includes('GATE_HELD') && resolve()); gate.on('error', reject); setTimeout(() => reject(new Error('gate timeout')), 15000); });
  const workers = scripts.map((script, index) => {
    const child = spawn('psql', args(DB), { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, cwd: os.tmpdir() });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.stdin.write(`select pg_advisory_lock_shared(${key}); select pg_advisory_unlock_shared(${key});\nselect 'READY|${index}';\n`);
    return { child, script, index, get out() { return out; } };
  });
  // Wait until every worker is parked behind the gate (its lock request is waiting), then fire them all together.
  const deadline = Date.now() + 20000;
  for (;;) {
    const waiting = Number(psql(DB, `select count(*) from pg_locks where locktype = 'advisory' and not granted and objid = ${key};`).trim().split('\n')[0]);
    if (waiting >= scripts.length) break;
    if (Date.now() > deadline) throw new Error(`only ${waiting}/${scripts.length} workers reached the gate`);
    await new Promise((r) => setTimeout(r, 100));
  }
  for (const w of workers) w.child.stdin.write(`${w.script}\n\\q\n`);
  gate.stdin.end(); // closing the gate session releases the exclusive lock: everyone proceeds now
  await Promise.all(workers.map((w) => new Promise((resolve) => w.child.on('close', resolve))));
  const starts = workers.flatMap((w) => [...w.out.matchAll(/START\|([0-9.]+)/g)].map((m) => Number(m[1])));
  const spreadMs = starts.length ? Math.round((Math.max(...starts) - Math.min(...starts)) * 1e5) / 100 : -1;
  race.lastSpreadMs = spreadMs; if (process.env.MOBBEX_CONC_DEBUG) console.log(`race: ${starts.length} starts, spread ${spreadMs} ms`);
  race.worstSpreadMs = Math.max(race.worstSpreadMs || 0, spreadMs);
  return workers.map((w) => ({ index: w.index, lines: w.out.split('\n').filter((l) => l.includes('RESULT|')).map((l) => l.slice(l.indexOf('RESULT|') + 7).trim()), raw: w.out }));
}

/** A DO block that records the outcome of one call as RESULT|<tag>|OK <json> or RESULT|<tag>|ERR <sqlstate> <message>. */
const call = (tag, expression) => `do $$ declare r jsonb; begin
  raise notice 'START|%', extract(epoch from clock_timestamp());
  begin r := (${expression})::jsonb; raise notice 'RESULT|${tag}|OK %', coalesce(r::text, 'null');
  exception when others then raise notice 'RESULT|${tag}|ERR % %', sqlstate, sqlerrm; end;
end $$;`;
const asOwner = (ids) => `${USER_CLAIMS(ids.owner)}`;
const asService = 'select set_config(\'role\', \'service_role\', false), set_config(\'request.jwt.claims\', \'\', false);';
const snap = (ids, cls, code, pid, amount, hashChar) =>
  `jsonb_build_object('reference', '${ids.reference}', 'status_class', '${cls}', 'status_code', '${code}', 'provider_payment_id', '${pid}', 'amount', '${amount}', 'currency', 'ARS',
     'provider_occurred_at', clock_timestamp()::text, 'raw_response_hash', repeat('${hashChar}', 64), 'approved_operation_count', 1)`;
const q = (sql) => psql(DB, sql, { stdoutOnly: true }).trim().split('\n').pop().trim();
const results = (rs) => rs.flatMap((r) => r.lines);
const oks = (rs) => results(rs).filter((l) => /\|OK /.test(l));
const errs = (rs) => results(rs).filter((l) => /\|ERR /.test(l));
const noDeadlock = (rs, name) => {
  const bad = results(rs).filter((l) => /ERR (40P01|40001)/.test(l));
  assert.deepEqual(bad, [], `${name}: deadlock or serialization failure`);
  const crashed = rs.filter((r) => /server closed the connection|FATAL/i.test(r.raw));
  assert.deepEqual(crashed.map((r) => r.index), [], `${name}: a backend died`);
};
const report = [];
const pass = (name, detail) => { report.push(name); console.log(`ok - ${name}${detail ? ` (${detail})` : ''}`); };
const SIMULTANEOUS_MS = 1500;

let created = false;
try {
  // Fresh database from the kept base cluster (needs no other session on the template).
  psql('template1', `create database ${DB} template postgres;`);
  created = true;
  psql(DB, `set search_path=public,extensions;\n${migration('20261103010000_mobbex_checkout_foundation.sql')}`);
  psql(DB, `set search_path=public,extensions;\n${migration('20261105010000_mobbex_merchant_console.sql')}`);
  // Committed fixtures are created by the superuser: the three timing-sensitive grants the browser role needs are in the migrations.

  // ── C1 ─ two refund requests with DIFFERENT keys at the same instant: exactly one is accepted ──
  for (let round = 0; round < ROUNDS; round += 1) {
    const ids = fixture({ approve: true });
    const rs = await race(Array.from({ length: WORKERS }, (_, w) => `${asOwner(ids)}\n${call(`c1-${w}`, `public.mobbex_prepare_refund('${ids.intent}', 100, '${randomUUID()}', 'carrera c1')`)}`));
    noDeadlock(rs, 'C1');
    assert.equal(oks(rs).length, 1, `C1 round ${round}: exactly one refund request may win, got ${oks(rs).length}: ${results(rs).join(' || ')}`);
    assert.equal(errs(rs).length, WORKERS - 1);
    assert.ok(errs(rs).every((l) => /ya hay un reembolso en curso/.test(l)), `C1: losers must be told a refund is already in flight: ${errs(rs)[0]}`);
    assert.equal(q(`select count(*) from public.mobbex_refunds where payment_intent_id = '${ids.intent}';`), '1');
  }
  pass('C1 simultaneous refund requests with different keys', `${ROUNDS} rounds x ${WORKERS} sessions: one refund row each, losers refused`);

  // ── C2 ─ the SAME idempotency key from many sessions: one row, one fresh answer, the rest idempotent ──
  for (let round = 0; round < ROUNDS; round += 1) {
    const ids = fixture({ approve: true });
    const key = randomUUID();
    const rs = await race(Array.from({ length: WORKERS }, (_, w) => `${asOwner(ids)}\n${call(`c2-${w}`, `public.mobbex_prepare_refund('${ids.intent}', 700, '${key}', 'misma clave')`)}`));
    noDeadlock(rs, 'C2');
    const answers = oks(rs).map((l) => JSON.parse(l.replace(/^[^|]*\|OK /, '')));
    assert.equal(answers.length, WORKERS, `C2 round ${round}: every caller gets an answer: ${errs(rs).join(' || ')}`);
    assert.equal(new Set(answers.map((a) => a.refund_id)).size, 1, 'C2: all callers see the same refund');
    // A refund that never left TABA ('requested') may be re-sent with the same key (resend=true); what must hold is ONE row.
    assert.equal(q(`select count(*) from public.mobbex_refunds where payment_intent_id = '${ids.intent}';`), '1');
    assert.equal(answers.filter((a) => a.idempotent === false && a.resend !== true).length, 1, 'C2: exactly one caller created it');
  }
  pass('C2 same idempotency key from many sessions', 'one refund row, one creator');

  // ── C3 ─ marking a refund as sent: only one session may send it ──
  for (let round = 0; round < ROUNDS; round += 1) {
    const ids = fixture({ approve: true });
    const refundId = q(`${USER_CLAIMS(ids.owner)} select (public.mobbex_prepare_refund('${ids.intent}', 300, '${randomUUID()}', 'envio unico') ->> 'refund_id');`).split('|').pop();
    assert.match(refundId, /^[0-9a-f-]{36}$/);
    const rs = await race(Array.from({ length: WORKERS }, (_, w) => `${asService}\n${call(`c3-${w}`, `(select to_jsonb('sent'::text) from (select public.mobbex_mark_refund_sent('${refundId}')) x)`)}`));
    noDeadlock(rs, 'C3');
    assert.equal(oks(rs).length, 1, `C3 round ${round}: exactly one session may send the refund, got ${oks(rs).length}`);
    assert.ok(errs(rs).every((l) => /no enviable/.test(l)));
    assert.equal(q(`select status from public.mobbex_refunds where id = '${refundId}';`), 'processing');
    assert.equal(q(`select count(*) from public.mobbex_jobs where payment_intent_id = '${ids.intent}' and status in ('pending','claimed','retry_wait');`), '1', 'one re-read queued');
  }
  pass('C3 simultaneous "mark refund sent"', 'exactly one sender, one re-read job');

  // ── C4 ─ webhook + worker + return all read "approved" at once: one order, stock taken once ──
  for (let round = 0; round < ROUNDS; round += 1) {
    const ids = fixture({ approve: false, quantity: 2, stock: 10 });
    const source = ['webhook', 'reconciliation', 'webhook', 'reconciliation', 'browser_return', 'webhook'];
    const rs = await race(Array.from({ length: WORKERS }, (_, w) => `${asService}\n${call(`c4-${w}`,
      `public.mobbex_record_provider_snapshot('${ids.intent}', ${snap(ids, 'approved', '200', `OP-${ids.tag}`, ids.total + '.00', String(w % 9 + 1))}, '${source[w % source.length]}')`)}`));
    noDeadlock(rs, 'C4');
    assert.equal(oks(rs).length, WORKERS, `C4 round ${round}: all callers must succeed: ${errs(rs).join(' || ')}`);
    assert.equal(q(`select count(*) from public.orders where business_id = '${ids.business}';`), '1', 'C4: exactly one order');
    assert.equal(q(`select stock from public.products where id = '${ids.product}';`), '8', 'C4: stock decremented once (10 - 2)');
    assert.equal(q(`select internal_status from public.mobbex_payment_intents where id = '${ids.intent}';`), 'completed');
    assert.equal(oks(rs).filter((l) => /"finalized": ?true/.test(l)).length, 1, 'C4: only one session finalizes');
  }
  pass('C4 webhook/worker/return race on one approval', 'one order, stock once, one finalizer');

  // ── C5 ─ two DIFFERENT approved operations for the same checkout: one order, the second is flagged, never a second order ──
  for (let round = 0; round < ROUNDS; round += 1) {
    const ids = fixture({ approve: false, quantity: 1, stock: 10 });
    const rs = await race(['A', 'B'].map((tagLetter, w) => `${asService}\n${call(`c5-${w}`,
      `public.mobbex_record_provider_snapshot('${ids.intent}', ${snap(ids, 'approved', '200', `OP-${ids.tag}-${tagLetter}`, ids.total + '.00', String(w + 5))}, 'reconciliation')`)}`));
    noDeadlock(rs, 'C5');
    assert.equal(q(`select count(*) from public.orders where business_id = '${ids.business}';`), '1', 'C5: never two orders for one checkout');
    assert.equal(q(`select stock from public.products where id = '${ids.product}';`), '9');
    assert.equal(q(`select (attention_reason is not null or internal_status = 'security_review_required')::text from public.mobbex_payment_intents where id = '${ids.intent}';`), 'true',
      'C5: the second paid operation is flagged for a person');
  }
  pass('C5 two different approved operations for one checkout', 'one order; the duplicate is flagged');

  // ── C6 ─ lock order: a provider read and a refund result for the same payment, many rounds, no deadlock ──
  for (let round = 0; round < ROUNDS * 2; round += 1) {
    const ids = fixture({ approve: true, quantity: 1 });
    const refundId = q(`${USER_CLAIMS(ids.owner)} select (public.mobbex_prepare_refund('${ids.intent}', null, '${randomUUID()}', 'orden de bloqueo') ->> 'refund_id');`).split('|').pop();
    psql(DB, `${asService} select public.mobbex_mark_refund_sent('${refundId}');`);
    const scripts = [
      `${asService}\n${call('c6-snapshot', `public.mobbex_record_provider_snapshot('${ids.intent}', ${snap(ids, 'refunded', '602', `OP-${ids.tag}`, ids.total + '.00', 'c')}, 'reconciliation')`)}`,
      `${asService}\n${call('c6-result', `public.mobbex_record_refund_result('${refundId}', 'approved', repeat('d', 64))`)}`,
      `${asService}\n${call('c6-snapshot2', `public.mobbex_record_provider_snapshot('${ids.intent}', ${snap(ids, 'refunded', '602', `OP-${ids.tag}`, ids.total + '.00', 'e')}, 'webhook')`)}`,
    ];
    const rs = await race(scripts);
    noDeadlock(rs, 'C6');
    assert.equal(oks(rs).length, 3, `C6 round ${round}: ${errs(rs).join(' || ')}`);
    assert.equal(q(`select internal_status || '/' || refunded_amount from public.mobbex_payment_intents where id = '${ids.intent}';`), `refunded/${ids.total}.00`, 'C6: refunded exactly once');
    assert.equal(q(`select count(*) from public.mobbex_refunds where payment_intent_id = '${ids.intent}' and status = 'approved';`), '1');
  }
  pass('C6 provider read vs refund result (lock order)', `${ROUNDS * 2} rounds x 3 sessions: no deadlock, refunded once`);

  // ── C7 ─ merchant re-read requests: a stampede of clicks leaves a single open job ──
  for (let round = 0; round < ROUNDS; round += 1) {
    const ids = fixture({ approve: false });
    psql(DB, `delete from public.mobbex_jobs where payment_intent_id = '${ids.intent}';`);
    const rs = await race(Array.from({ length: WORKERS }, (_, w) => `${asOwner(ids)}\n${call(`c7-${w}`, `public.mobbex_request_business_reconcile('${ids.intent}')`)}`));
    noDeadlock(rs, 'C7');
    assert.equal(oks(rs).length, WORKERS, `C7: ${errs(rs).join(' || ')}`);
    assert.equal(q(`select count(*) from public.mobbex_jobs where payment_intent_id = '${ids.intent}' and status in ('pending','claimed','retry_wait');`), '1');
  }
  pass('C7 merchant "Consultar a Mobbex" stampede', 'a single open job');

  // ── C8 ─ a refund request racing the approval of the same payment: the refund never targets a payment that is not paid ──
  for (let round = 0; round < ROUNDS; round += 1) {
    const ids = fixture({ approve: false, quantity: 1 });
    const rs = await race([
      `${asService}\n${call('c8-approve', `public.mobbex_record_provider_snapshot('${ids.intent}', ${snap(ids, 'approved', '200', `OP-${ids.tag}`, ids.total + '.00', '1')}, 'webhook')`)}`,
      `${asOwner(ids)}\n${call('c8-refund', `public.mobbex_prepare_refund('${ids.intent}', null, '${randomUUID()}', 'antes de pagar')`)}`,
    ]);
    noDeadlock(rs, 'C8');
    const refunds = Number(q(`select count(*) from public.mobbex_refunds where payment_intent_id = '${ids.intent}';`));
    const paid = q(`select (paid_amount is not null)::text from public.mobbex_payment_intents where id = '${ids.intent}';`);
    assert.equal(paid, 'true');
    // Either the refund lost (refused: not refundable yet) or it ran after the approval and is a legitimate request.
    if (refunds === 0) assert.ok(errs(rs).some((l) => /no reembolsable/.test(l)), 'C8: a refund before the payment landed is refused with a reason');
    assert.ok(refunds <= 1);
  }
  pass('C8 refund request racing the approval', 'refused before payment, or a single legitimate refund after it');

  assert.ok(race.worstSpreadMs >= 0 && race.worstSpreadMs < SIMULTANEOUS_MS, `the sessions did not start together (worst start spread ${race.worstSpreadMs} ms)`);

  // ── Negative control: the harness must be able to SEE a broken ledger. mark_refund_sent without its status guard lets every
  //    session "send" the same refund; the C3 assertion has to fail. (Inside this throwaway database only.) ──
  psql(DB, `create or replace function public.mobbex_mark_refund_sent(p_refund_id uuid) returns void language plpgsql security definer
    set search_path = pg_catalog, public, pg_temp as $$ begin perform pg_sleep(0.05); update public.mobbex_refunds set status = 'processing' where id = p_refund_id; end $$;`);
  const control = fixture({ approve: true });
  const controlRefund = q(`${USER_CLAIMS(control.owner)} select (public.mobbex_prepare_refund('${control.intent}', 300, '${randomUUID()}', 'control') ->> 'refund_id');`);
  const controlRs = await race(Array.from({ length: WORKERS }, (_, w) => `${asService}
${call(`ctl-${w}`, `(select to_jsonb('sent'::text) from (select public.mobbex_mark_refund_sent('${controlRefund}')) x)`)}`));
  assert.ok(oks(controlRs).length > 1, 'NEGATIVE CONTROL FAILED: a broken mark_refund_sent was not detected by the race harness');
  console.log(`negative control - a ledger without the "already sent" guard lets ${oks(controlRs).length}/${WORKERS} sessions send the same refund; the harness sees it`);
  console.log(`MOBBEX_CONCURRENCY: ${report.length} scenarios PASS (workers=${WORKERS}, rounds=${ROUNDS}, worst start spread ${race.worstSpreadMs} ms, real simultaneous backends on a native PostgreSQL)`);
} finally {
  if (created) { try { psql('template1', `drop database ${DB} with (force);`); } catch (error) { console.error(`could not drop ${DB}: ${error.message}`); process.exitCode = 1; } }
}
