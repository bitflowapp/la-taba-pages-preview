import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const gateUrl = new URL(
  '../supabase/migrations/20260725080000_rider_assignment_tracking_gate.sql',
  import.meta.url,
);
const gate = fs.readFileSync(gateUrl, 'utf8');

function functionSql(name) {
  const start = gate.search(new RegExp(
    `create or replace function public\\.${name}\\b`,
    'i',
  ));
  assert.notEqual(start, -1, `No se encontró ${name}`);
  const tail = gate.slice(start);
  const end = tail.search(/\n\$\$;/);
  assert.notEqual(end, -1, `No se encontró el cierre de ${name}`);
  return tail.slice(0, end + 4);
}

test('claim rider serializa la carrera y compara estado + asignado', () => {
  const claim = functionSql('claim_available_rider_order');

  assert.match(claim, /has_business_role\(p_business_id,\s*array\['rider'\]\)/i);
  assert.match(claim, /from public\.orders o[\s\S]*for update/i);
  assert.match(claim, /v_order\.status <> v_expected_status/i);
  assert.match(
    claim,
    /v_order\.assigned_rider_user_id is distinct from p_expected_rider_user_id/i,
  );
  assert.match(claim, /v_order\.assigned_rider_user_id is not null/i);
  assert.match(claim, /using errcode = '40001'/i);
  assert.match(claim, /assigned_rider_user_id = v_user_id/i);
  assert.match(claim, /status = 'assigned'/i);
  assert.match(claim, /order\.rider_claimed/i);
});

test('asignación de negocio valida rol, rider activo y limita reasignación al pre-pickup', () => {
  const assignment = functionSql('assign_order_rider');

  assert.match(assignment, /bm\.role in \('owner', 'admin', 'staff'\)/i);
  assert.match(assignment, /from public\.business_members bm/i);
  assert.match(assignment, /bm\.role = 'rider'/i);
  assert.match(assignment, /bm\.is_active = true/i);
  assert.match(assignment, /for share/i);
  assert.match(assignment, /v_order\.status not in \('ready', 'assigned'\)/i);
  assert.match(
    assignment,
    /v_order\.assigned_rider_user_id is distinct from p_expected_rider_user_id/i,
  );
  assert.match(assignment, /using errcode = '40001'/i);
  assert.match(assignment, /order\.rider_reassigned/i);
  assert.doesNotMatch(assignment, /picked_up'\s*,\s*'on_the_way/i);
});

test('cola rider permanece minimizada y no inventa ETA', () => {
  const queue = functionSql('list_available_rider_orders');

  for (const prohibited of [
    'customer_name',
    'customer_phone',
    'customer_street_address',
    'customer_reference',
    'customer_notes',
    'customer_user_id',
  ]) {
    assert.doesNotMatch(queue, new RegExp(prohibited, 'i'));
  }
  assert.match(queue, /o\.status = 'ready'/i);
  assert.match(queue, /o\.assigned_rider_user_id is null/i);
  assert.match(queue, /estimated_arrival_source in \('business', 'routing'\)/i);
  assert.match(queue, /estimated_arrival_updated_at >= statement_timestamp\(\) - interval '15 minutes'/i);
  assert.doesNotMatch(queue, /,\s*25\s*,/i);
});

test('GPS sólo entra por RPC, exige rider asignado y limita precisión/frecuencia', () => {
  const gps = functionSql('publish_rider_location');

  assert.match(gps, /from public\.business_members bm[\s\S]*bm\.role = 'rider'/i);
  assert.match(gps, /for share/i);
  assert.match(gps, /from public\.orders o[\s\S]*for update/i);
  assert.match(gps, /v_order\.assigned_rider_user_id is distinct from v_user_id/i);
  assert.match(gps, /v_order\.status not in \('assigned', 'picked_up', 'on_the_way', 'arrived'\)/i);
  assert.match(gps, /p_accuracy > 250/i);
  assert.match(gps, /p_speed > 70/i);
  assert.match(gps, /clock_timestamp\(\) - interval '5 seconds'/i);
  assert.match(gate, /revoke insert on table public\.rider_locations from authenticated/i);
  assert.match(gate, /grant execute on function public\.publish_rider_location[\s\S]*to authenticated/i);
});

test('payload operativo del rider explicita campos y omite secretos internos', () => {
  const payload = functionSql('rider_order_rpc_payload');

  assert.doesNotMatch(payload, /to_jsonb\(o\)/i);
  assert.doesNotMatch(payload, /client_request_id/i);
  assert.doesNotMatch(payload, /client_request_fingerprint/i);
  assert.doesNotMatch(payload, /abuse_fingerprint_hash/i);
  assert.doesNotMatch(payload, /customer_user_id/i);
  assert.match(payload, /'customer_name', o\.customer_name/i);
  assert.match(payload, /'assigned_rider_user_id', o\.assigned_rider_user_id/i);
  assert.match(payload, /limit 1/i);
});

test('DTO tokenizado liga GPS al rider actual y descarta fixes vencidos o imprecisos', () => {
  const tracking = functionSql('get_public_order_tracking');
  const dto = tracking.match(
    /return jsonb_strip_nulls\(jsonb_build_object\([\s\S]*?\)\);/i,
  )?.[0] || '';

  assert.match(tracking, /request_order_token_hash\(\)/i);
  assert.match(tracking, /opt\.revoked_at is null/i);
  assert.match(tracking, /opt\.expires_at > clock_timestamp\(\)/i);
  assert.match(tracking, /v_order\.status in \('picked_up', 'on_the_way', 'arrived'\)/i);
  assert.match(tracking, /rl\.order_id = v_order\.id/i);
  assert.match(tracking, /rl\.rider_user_id = v_order\.assigned_rider_user_id/i);
  assert.match(tracking, /rl\.accuracy between 0 and 250/i);
  assert.match(tracking, /rl\.created_at >= clock_timestamp\(\) - interval '3 minutes'/i);
  assert.match(tracking, /estimated_arrival_source in \('business', 'routing'\)/i);
  assert.match(dto, /'delivery_mode', v_order\.delivery_mode/i);
  assert.match(dto, /'updated_at', v_order\.updated_at/i);
  assert.doesNotMatch(tracking, /else\s+25/i);
  for (const prohibited of [
    'customer_phone',
    'customer_street_address',
    'customer_reference',
    'customer_notes',
    'customer_user_id',
    'assigned_rider_user_id',
    'token_hash',
  ]) {
    assert.doesNotMatch(dto, new RegExp(prohibited, 'i'));
  }
});

test('arrived_at se sella y auditoría de asignación queda dentro del negocio', () => {
  const timestamps = functionSql('set_order_status_timestamps');

  assert.match(timestamps, /new\.status in \('arrived', 'arriving'\)/i);
  assert.match(timestamps, /new\.arrived_at := clock_timestamp\(\)/i);
  assert.match(gate, /create policy "production order events readable by business"/i);
  assert.match(gate, /array\['owner', 'admin', 'staff'\]/i);
  assert.match(gate, /revoke select on table public\.order_events from anon/i);
});
