import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const privacy = fs.readFileSync(
  new URL('../supabase/migrations/20260725050000_tracking_rider_privacy.sql', import.meta.url),
  'utf8',
);

test('public tracking uses a minimized RPC and removes token access from base tables', () => {
  assert.match(privacy, /function public\.get_public_order_tracking/);
  assert.match(privacy, /request_order_token_hash\(\)/);
  assert.match(privacy, /revoked_at is null/);
  assert.match(privacy, /expires_at > clock_timestamp\(\)/);
  const accessFunction = privacy.match(
    /function public\.can_access_order[\s\S]*?\$\$;/i,
  )?.[0] || '';
  assert.doesNotMatch(accessFunction, /order_public_tokens/);
});

test('public DTO does not contain prohibited PII or internal identifiers', () => {
  const dto = privacy.match(
    /return jsonb_strip_nulls\(jsonb_build_object\([\s\S]*?\)\);/i,
  )?.[0] || '';
  assert.ok(dto);
  for (const prohibited of [
    'customer_phone',
    'customer_whatsapp',
    'customer_street_address',
    'customer_reference',
    'customer_notes',
    'customer_user_id',
    'assigned_rider_user_id',
    'token_hash',
    'business_members',
  ]) {
    assert.doesNotMatch(dto, new RegExp(prohibited, 'i'));
  }
});

test('rider queue is minimized and assigned access ends outside active states', () => {
  const queue = privacy.match(
    /function public\.list_available_rider_orders[\s\S]*?\$\$;/i,
  )?.[0] || '';
  assert.ok(queue);
  for (const prohibited of ['customer_name', 'customer_phone', 'customer_street_address', 'customer_reference']) {
    assert.doesNotMatch(queue, new RegExp(prohibited, 'i'));
  }
  assert.match(privacy, /o\.assigned_rider_user_id = auth\.uid\(\)/);
  assert.match(privacy, /o\.status in \('assigned', 'picked_up', 'on_the_way', 'arrived'\)/);
});

test('tracking token can be revoked without exposing the token table', () => {
  assert.match(privacy, /function public\.revoke_public_tracking/);
  assert.match(privacy, /set revoked_at = coalesce\(revoked_at, clock_timestamp\(\)\)/);
  assert.match(privacy, /revoke all on function public\.revoke_public_tracking/);
});
