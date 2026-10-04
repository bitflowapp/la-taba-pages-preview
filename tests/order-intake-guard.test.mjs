import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';

const MIGRATION = '20261001180000_order_intake_guard.sql';
const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const migrations = () => readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort();
const withoutComments = (sql) => sql.replace(/--[^\n]*/g, '');
const functionBody = (sql, name) => {
  const start = sql.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} is defined`);
  const open = sql.indexOf('as $$', start);
  return sql.slice(open, sql.indexOf('$$;', open + 5));
};

test('both order doors pass through the intake guard and the previous layers leave client reach', () => {
  const sql = read(`../supabase/migrations/${MIGRATION}`);
  // The previous functions become inner layers by rename: no body is copied.
  assert.match(sql, /alter function public\.create_order_with_items\(jsonb\) rename to create_order_with_items_confirmed_location;/);
  assert.match(sql, /alter function public\.create_checkout_session\(uuid, jsonb\) rename to create_checkout_session_reserving;/);
  assert.match(sql, /revoke all on function public\.create_order_with_items_confirmed_location\(jsonb\) from public, anon, authenticated;/);
  assert.match(sql, /revoke all on function public\.create_checkout_session_reserving\(uuid, jsonb\) from public, anon, authenticated;/);
  for (const door of ['public.create_order_with_items', 'public.create_checkout_session']) {
    assert.match(functionBody(sql, door), /private\.order_intake_guard\(/, `${door} consults the guard`);
  }
  // The checkout door keeps the code and message the Edge Function already knows.
  assert.match(functionBody(sql, 'public.create_checkout_session'), /'54000', 'demasiados intentos de checkout; reintenta mas tarde'/);
  assert.match(functionBody(sql, 'public.create_order_with_items'), /'PT429', 'ORDER_RATE_LIMITED'/);
});

test('the network origin comes only from the header the client cannot choose', () => {
  const body = withoutComments(functionBody(read(`../supabase/migrations/${MIGRATION}`), 'private.order_intake_client_fingerprint'));
  assert.match(body, /->> 'cf-connecting-ip'/);
  // Measured on staging: the first x-forwarded-for hop and sb-forwarded-for are client-controlled.
  assert.doesNotMatch(body, /forwarded-for|x-real-ip/i);
  // Never the address itself: a keyed hash.
  assert.match(body, /return hmac\(/);
});

test('a blocked attempt through PostgREST is recorded: the guard answers 429 instead of raising', () => {
  const body = withoutComments(functionBody(read(`../supabase/migrations/${MIGRATION}`), 'private.order_intake_guard'));
  assert.match(body, /set_config\('response\.status', '429', true\)/);
  assert.match(body, /Retry-After/);
  // Outside PostgREST it is an ordinary exception with the caller's code.
  assert.match(body, /raise exception '%', p_error_message using errcode = p_error_code/);
  // A guard failure never stops the store.
  assert.match(body, /when others then[\s\S]*return null;/);
});

test('NULL limits fall back to defaults: there is no "unlimited" by omission', () => {
  const sql = read(`../supabase/migrations/${MIGRATION}`);
  const evaluate = withoutComments(functionBody(sql, 'private.order_intake_evaluate'));
  for (const column of ['order_rate_limit_per_10_minutes', 'max_pending_orders_per_customer',
    'order_ip_rate_limit_per_10_minutes', 'max_pending_orders_per_ip', 'order_business_rate_limit_per_10_minutes']) {
    assert.match(evaluate, new RegExp(`coalesce\\(p_business\\.${column},`), `${column} has a default`);
  }
  // The owner tunes the limits; switching the guard off is not an owner column.
  const grant = /grant update \(([\s\S]*?)\) on public\.businesses to authenticated;/.exec(sql);
  assert.ok(grant, 'the limit columns are granted');
  assert.doesNotMatch(grant[1], /order_intake_guard_mode/);
});

test('no later migration reopens a door around the guard', () => {
  const names = migrations();
  const later = names.slice(names.indexOf(MIGRATION) + 1);
  const offenders = [];
  for (const f of later) {
    const sql = withoutComments(read(`../supabase/migrations/${f}`));
    if (/grant[^;]*on function public\.(create_order_with_items_confirmed_location|create_checkout_session_reserving|create_order_with_items_core)\b[^;]*\bto\b[^;]*\b(authenticated|anon|public)\b/i.test(sql)) {
      offenders.push(`${f}: an inner layer is granted to a client role`);
    }
    for (const door of ['public.create_order_with_items', 'public.create_checkout_session']) {
      const redefinition = new RegExp(`create (or replace )?function ${door.replace('.', '\\.')}\\(`, 'i');
      if (redefinition.test(sql) && !/private\.order_intake_guard\(/.test(sql)) offenders.push(`${f}: ${door} redefined without the guard`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('the guard suite is part of the canonical database gate, with its race harness and its rollback', () => {
  const runner = read('../scripts/run-release-v5-db.mjs');
  assert.match(runner, /'order_intake_guard_test\.sql'/);
  assert.match(runner, /runOrderIntakeRace\(\(\) => localClient\(container\)\)/);
  assert.match(read('../supabase/tests/order_intake_guard_test.sql'), /^select plan\(62\);$/m);
  const rollback = read(`../docs/migrations/rollback/${MIGRATION.replace('.sql', '.rollback.sql')}`);
  assert.match(rollback, /ROLLBACK_BLOCKED/);
  assert.match(rollback, /rename to create_order_with_items;/);
  assert.match(rollback, /rename to create_checkout_session;/);
});
