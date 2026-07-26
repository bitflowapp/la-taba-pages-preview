import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('../supabase/migrations/20260725100000_tracking_handoff_recovery.sql', import.meta.url),
  'utf8',
);

test('customer GPS access stays behind the minimized tracking DTO', () => {
  assert.match(sql, /drop policy if exists "production rider locations readable with order"/i);
  assert.match(sql, /tracking rider locations readable by operators/i);
  assert.match(sql, /has_business_role\(\s*o\.business_id,\s*array\['owner', 'admin', 'staff'\]/i);
  assert.match(sql, /o\.assigned_rider_user_id = auth\.uid\(\)/i);
  assert.doesNotMatch(
    sql.match(/create policy "tracking rider locations readable by operators"([\s\S]*?)\);/i)?.[1] || '',
    /customer_user_id/i,
  );
  assert.match(sql, /revoke select on table public\.rider_locations from anon/i);
});

test('authenticated customer can rotate a lost token and handoff without plaintext storage', () => {
  assert.match(sql, /recover_order_tracking_access/i);
  assert.match(sql, /o\.customer_user_id = auth\.uid\(\)/i);
  assert.match(sql, /update public\.order_public_tokens[\s\S]*revoked_at/i);
  assert.match(sql, /digest\(p_new_tracking_token, 'sha256'\)/i);
  assert.match(sql, /pgp_sym_encrypt\(v_code, p_new_tracking_token/i);
  assert.match(sql, /on conflict \(order_id\) do update/i);
  assert.match(sql, /interval '48 hours'/i);
  assert.match(sql, /delete from public\.order_public_tokens[\s\S]*revoked_at is not null/i);
  assert.match(sql, /order\.tracking_access_recovered/i);
});

test('delivery confirmation is retry-safe and applies escalating locks', () => {
  assert.match(sql, /v_order\.status = 'delivered'[\s\S]*already_confirmed/i);
  assert.match(sql, /v_handoff\.confirmed_by_user_id = auth\.uid\(\)/i);
  assert.match(sql, /least\(1440,[\s\S]*v_attempts - 5/i);
  assert.match(sql, /make_interval\(mins => v_lock_minutes\)/i);
  assert.match(sql, /order\.delivery_code_locked/i);
  assert.match(sql, /order\.delivery_handoff_confirmed/i);
  assert.doesNotMatch(sql, /'order',\s*to_jsonb/i);
});

test('order reservation and delivery handoff issue in one transaction', () => {
  assert.match(sql, /rename to create_order_with_items_core/i);
  assert.match(sql, /v_result := public\.create_order_with_items_core\(payload\)/i);
  assert.match(sql, /v_handoff := public\.issue_order_delivery_code\(v_order_id, v_tracking_token\)/i);
  assert.match(sql, /revoke all on function public\.create_order_with_items_core\(jsonb\)/i);
  assert.match(sql, /grant execute on function public\.create_order_with_items\(jsonb\)[\s\S]*to authenticated/i);
});

test('business rider directory is authorized and deliberately minimal', () => {
  assert.match(sql, /list_active_business_riders/i);
  assert.match(sql, /array\['owner', 'admin', 'staff'\]/i);
  assert.match(sql, /bm\.role = 'rider'/i);
  assert.match(sql, /bm\.is_active = true/i);
  assert.match(sql, /returns table \(\s*rider_user_id uuid,\s*display_name text/i);
  assert.match(
    sql,
    /revoke all on function public\.list_active_business_riders\(uuid\)[\s\S]*grant execute[\s\S]*to authenticated/i,
  );
});

test('exact GPS history is purged on terminal transitions', () => {
  assert.match(sql, /purge_terminal_order_rider_locations/i);
  assert.match(sql, /new\.status in \('delivered', 'canceled', 'cancelled', 'rejected'\)/i);
  assert.match(sql, /delete from public\.rider_locations[\s\S]*where order_id = new\.id/i);
  assert.match(sql, /after update of status on public\.orders/i);
  assert.match(
    sql,
    /revoke execute on function public\.purge_terminal_order_rider_locations\(\)[\s\S]*from public, anon, authenticated/i,
  );
});
