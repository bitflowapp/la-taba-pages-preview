import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migrationUrl = new URL(
  '../supabase/migrations/20260729210000_tracking_terminal_visibility.sql',
  import.meta.url,
);

const sql = readFileSync(migrationUrl, 'utf8');

function functionSql(name) {
  const start = sql.search(new RegExp(
    `create or replace function public\\.${name}\\b`,
    'i',
  ));
  assert.notEqual(start, -1, `No se encontró ${name}`);
  const tail = sql.slice(start);
  const end = tail.search(/\n\$\$;/);
  assert.notEqual(end, -1, `No se encontró el cierre de ${name}`);
  return tail.slice(0, end + 4);
}

test('regresión reproducida: delivered conserva una ventana pública de sólo lectura', () => {
  const terminal = functionSql('set_order_terminal_tracking_visibility');
  const tracking = functionSql('get_public_order_tracking');

  assert.match(sql, /add column if not exists terminal_visible_until timestamptz/i);
  assert.match(terminal, /new\.status = 'delivered'/i);
  assert.match(terminal, /old\.status is distinct from 'delivered'/i);
  assert.match(terminal, /interval '30 minutes'/i);
  assert.doesNotMatch(terminal, /set\s+revoked_at/i);

  assert.match(tracking, /opt\.revoked_at is null/i);
  assert.match(tracking, /opt\.expires_at > clock_timestamp\(\)/i);
  assert.match(tracking, /o\.status = 'delivered'[\s\S]*terminal_visible_until > clock_timestamp\(\)/i);
  assert.match(tracking, /o\.status not in \('delivered', 'canceled', 'cancelled', 'rejected'\)/i);
});

test('la RPC terminal mantiene el DTO mínimo y no reintroduce GPS ni PII', () => {
  const tracking = functionSql('get_public_order_tracking');
  const dto = tracking.match(
    /return jsonb_strip_nulls\(jsonb_build_object\([\s\S]*?\)\);/i,
  )?.[0] || '';

  assert.match(tracking, /v_order\.status in \('picked_up', 'on_the_way', 'arrived'\)/i);
  assert.match(dto, /'public_code', v_order\.public_code/i);
  assert.match(dto, /'status', v_order\.status/i);
  assert.match(dto, /'delivered_at', v_order\.delivered_at/i);
  assert.match(dto, /'delivery_code', v_delivery_code/i);
  for (const prohibited of [
    'customer_phone',
    'customer_email',
    'customer_street_address',
    'customer_reference',
    'customer_user_id',
    'assigned_rider_user_id',
    'token_hash',
    'rider_locations',
  ]) {
    assert.doesNotMatch(dto, new RegExp(prohibited, 'i'));
  }
});

test('revocación manual prevalece y delivered repetido no extiende la ventana', () => {
  const terminal = functionSql('set_order_terminal_tracking_visibility');
  const tracking = functionSql('get_public_order_tracking');

  assert.match(terminal, /coalesce\(\s*old\.terminal_visible_until,/i);
  assert.match(tracking, /opt\.revoked_at is null/i);
  assert.match(tracking, /return null/i);
});
