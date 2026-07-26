import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('../supabase/migrations/20260725090000_delivery_handoff_code.sql', import.meta.url),
  'utf8',
);

test('delivery handoff stores no plaintext code and is token-scoped', () => {
  assert.match(sql, /code_hash text not null/i);
  assert.match(sql, /code_ciphertext bytea not null/i);
  assert.match(sql, /crypt\(v_code, gen_salt\('bf'/i);
  assert.match(sql, /pgp_sym_encrypt\(v_code, p_tracking_token/i);
  assert.match(sql, /token_hash = digest\(p_tracking_token, 'sha256'\)/i);
  const tableDefinition = sql.match(
    /create table if not exists public\.order_delivery_handoffs \(([\s\S]*?)\n\);/i,
  )?.[1] || '';
  assert.doesNotMatch(tableDefinition, /\bdelivery_code\b/i);
});

test('delivery confirmation is assigned-rider only, locked and rate limited', () => {
  assert.match(sql, /for update/i);
  assert.match(sql, /assigned_rider_user_id is distinct from auth\.uid\(\)/i);
  assert.match(sql, /has_business_role\(v_order\.business_id, array\['rider'\]\)/i);
  assert.match(sql, /failed_attempts = v_attempts/i);
  assert.match(sql, /interval '5 minutes'/i);
  assert.match(sql, /status = 'delivered'/i);
  assert.match(sql, /orders_require_verified_delivery_code/i);
  assert.doesNotMatch(sql, /'order',\s*to_jsonb\(v_order\)/i);
});

test('public tracking reveals code only at arrival and remains minimized', () => {
  assert.match(sql, /v_order\.status = 'arrived' and h\.confirmed_at is null/i);
  assert.match(sql, /pgp_sym_decrypt\(h\.code_ciphertext, v_raw_token\)/i);
  for (const forbidden of [
    "'customer_phone'",
    "'customer_name'",
    "'customer_email'",
    "'assigned_rider_user_id'",
    "'address_label'",
    "'notes'",
  ]) {
    assert.equal(sql.includes(forbidden), false, `DTO must omit ${forbidden}`);
  }
});
