import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('../supabase/migrations/20260802100000_rider_delivery_server_contracts.sql', import.meta.url),
  'utf8',
);
const handoffSql = readFileSync(
  new URL('../supabase/migrations/20260725100000_tracking_handoff_recovery.sql', import.meta.url),
  'utf8',
);

function functionSql(name) {
  const start = sql.search(new RegExp(`create or replace function public\\.${name}\\b`, 'i'));
  assert.notEqual(start, -1, `missing ${name}`);
  const tail = sql.slice(start);
  const end = tail.search(/\n\$[a-z_]+\$;/i);
  assert.notEqual(end, -1, `missing function terminator for ${name}`);
  return tail.slice(0, end + 4);
}

test('canonical Rider RPCs are security-definer, authenticated and explicitly granted', () => {
  for (const name of [
    'get_rider_queue', 'get_active_rider_delivery', 'claim_delivery_order',
    'mark_delivery_picked_up', 'start_rider_delivery', 'mark_rider_arrived',
    'publish_rider_location_receipt', 'confirm_delivery_code',
    'report_rider_delivery_issue', 'release_or_reassign_delivery',
  ]) {
    const body = functionSql(name);
    assert.match(body, /security definer/i, name);
    assert.match(body, /set search_path = pg_catalog, public, extensions, pg_temp/i, name);
  }
  assert.match(sql, /grant execute on function public\.confirm_delivery_code\(uuid, bigint, text, text\)\s+to authenticated/i);
  assert.match(sql, /do \$revoke_legacy_rider_functions\$/i);
  assert.match(sql, /to_regprocedure\('public\.claim_available_rider_order\(uuid,text,text,uuid\)'\)/i);
  assert.match(sql, /execute 'revoke all on function public\.claim_available_rider_order/i);
  assert.match(sql, /to_regprocedure\('public\.publish_rider_location\(uuid,double precision/i);
  assert.match(sql, /execute 'revoke all on function public\.confirm_order_delivery\(uuid, text, text\)/i);
});

test('queue is minimized and revision-aware', () => {
  const queue = functionSql('get_rider_queue');
  for (const prohibited of ['customer_name', 'customer_phone', 'customer_street_address', 'customer_reference', 'customer_notes', 'tracking_token']) {
    assert.doesNotMatch(queue, new RegExp(prohibited, 'i'));
  }
  assert.match(queue, /perform public\.rider_require_active_membership/i);
  assert.match(queue, /o\.status = 'ready'/i);
  assert.match(queue, /o\.assigned_rider_user_id is null/i);
  assert.match(queue, /o\.revision/i);
});

test('claim serializes two riders with revision CAS and persistent idempotency', () => {
  const claim = functionSql('claim_delivery_order');
  assert.match(claim, /from public\.orders o[\s\S]*for update/i);
  assert.match(claim, /v_order\.revision <> p_expected_revision/i);
  assert.match(claim, /active\.assigned_rider_user_id = auth\.uid\(\)/i);
  assert.match(claim, /v_order\.status <> 'ready'/i);
  assert.match(claim, /assigned_rider_user_id = auth\.uid\(\), status = 'assigned'/i);
  assert.match(claim, /rider_delivery_operations/i);
  assert.match(claim, /taken_by_other/i);
});

test('pickup, route and arrival cannot skip the canonical state order', () => {
  const pickup = functionSql('mark_delivery_picked_up');
  const start = functionSql('start_rider_delivery');
  const arrival = functionSql('mark_rider_arrived');
  assert.match(pickup, /v_order\.status <> 'assigned'/i);
  assert.match(pickup, /status = 'picked_up'/i);
  assert.match(start, /v_order\.status <> 'picked_up'/i);
  assert.match(start, /status = 'on_the_way'/i);
  assert.match(arrival, /v_order\.status <> 'on_the_way'/i);
  assert.match(arrival, /status = 'arrived', arrived_at = clock_timestamp\(\)/i);
  assert.match(sql, /prevent_rider_unverified_delivery/i);
  assert.match(sql, /confirmacion de codigo requerida para entregar/i);
});

test('GPS receipt is assignment-bound, revision-bound and classifies non-acceptance', () => {
  const gps = functionSql('publish_rider_location_receipt');
  for (const code of ['inaccurate', 'mock_location_rejected', 'not_assigned', 'terminal', 'not_active', 'stale', 'throttled', 'impossible_jump']) {
    assert.match(gps, new RegExp(`'${code}'`, 'i'));
  }
  assert.match(gps, /p_captured_at < v_now - interval '10 minutes'/i);
  assert.match(gps, /client_request_id = v_key/i);
  assert.match(gps, /receipt_sequence/i);
  assert.match(gps, /v_distance_meters > greatest/i);
});

test('code confirmation stores no code, rate-limits server-side and closes delivery transactionally', () => {
  const confirm = functionSql('confirm_delivery_code');
  assert.match(sql, /create table if not exists public\.delivery_confirmation_attempts/i);
  assert.doesNotMatch(sql.match(/create table if not exists public\.delivery_confirmation_attempts[\s\S]*?\n\);/i)?.[0] || '', /delivery_code/i);
  for (const code of ['incorrect_code', 'temporarily_locked', 'already_delivered', 'not_arrived', 'not_assigned', 'stale_revision']) {
    assert.match(confirm, new RegExp(`'${code}'`, 'i'));
  }
  assert.match(confirm, /crypt\(v_code, v_handoff\.code_hash\)/i);
  assert.match(confirm, /retry_after_seconds/i);
  assert.match(confirm, /delivery_confirmation_attempts/i);
  assert.match(confirm, /set_config\('taba\.delivery_code_confirmed', 'true', true\)/i);
  assert.match(confirm, /update public\.orders set status = 'delivered'/i);
  assert.match(confirm, /insert into public\.delivery_outbox/i);
  assert.doesNotMatch(confirm, /delivery_code',\s*v_code/i);
});

test('issues are controlled, audited and never cancel or release automatically', () => {
  const issue = functionSql('report_rider_delivery_issue');
  assert.match(sql, /create table if not exists public\.rider_delivery_issues/i);
  assert.match(sql, /event_key text not null/i);
  assert.match(sql, /unique \(order_id, event_type, event_key\)/i);
  assert.match(issue, /customer_unavailable/i);
  assert.match(issue, /wrong_address/i);
  assert.match(issue, /insert into public\.delivery_outbox/i);
  assert.match(issue, /order\.rider_issue_reported/i);
  assert.doesNotMatch(issue, /status = 'cancelled'/i);
  assert.doesNotMatch(issue, /assigned_rider_user_id = null/i);
});

test('terminal tracking is minimized and cannot reveal a delivery code', () => {
  const tracking = functionSql('get_public_order_tracking');
  assert.match(tracking, /opt\.revoked_at is null/i);
  assert.match(tracking, /v_order\.status in \('picked_up', 'on_the_way', 'arrived'\)/i);
  assert.doesNotMatch(tracking, /delivery_code/i);
  assert.doesNotMatch(tracking, /pgp_sym_decrypt/i);
  assert.match(handoffSql, /purge_terminal_order_rider_locations/i);
});
