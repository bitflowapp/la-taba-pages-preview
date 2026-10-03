import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';

const MIGRATION = '20261001010000_delivery_location_guard_runs_as_owner.sql';
const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const migrations = () => readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort();

test('the delivery-location guard runs as its owner and stays out of client roles', () => {
  const sql = read(`../supabase/migrations/${MIGRATION}`);
  assert.match(sql, /alter function public\.enforce_confirmed_delivery_location\(\) security definer;/);
  assert.match(sql, /revoke all on function public\.enforce_confirmed_delivery_location\(\)\s+from public, anon, authenticated;/);
  // The body is not copied: the contract of the confirmed point must stay exactly the original one.
  assert.doesNotMatch(sql, /create (or replace )?function/i);
  assert.match(sql, /deferred constraint triggers must run as their owner/);
});

test('no later migration puts the guard back under the session role', () => {
  const names = migrations();
  const later = names.slice(names.indexOf(MIGRATION) + 1);
  const offenders = later.filter((f) => {
    const sql = read(`../supabase/migrations/${f}`);
    return /enforce_confirmed_delivery_location\(\)\s+security invoker/i.test(sql)
      || (/create or replace function public\.enforce_confirmed_delivery_location/i.test(sql) && !/security definer/i.test(sql));
  });
  assert.deepEqual(offenders, [], 'a later migration made the deferred guard depend on the committing role again');
});

test('deferred constraint triggers added after the fix declare a SECURITY DEFINER function in the same migration', () => {
  // A deferred trigger fires at COMMIT with the session role: its function may not rely on that role.
  const names = migrations();
  const later = names.slice(names.indexOf(MIGRATION) + 1);
  const offenders = [];
  for (const f of later) {
    const sql = read(`../supabase/migrations/${f}`);
    for (const match of sql.matchAll(/create constraint trigger[\s\S]*?execute function\s+([a-z_.]+)\s*\(/gi)) {
      const fn = match[1].replace(/^public\./, '');
      const definedAsDefiner = new RegExp(`function\\s+(public\\.)?${fn}\\s*\\([\\s\\S]*?security definer`, 'i').test(sql)
        || new RegExp(`alter function\\s+(public\\.)?${fn}\\s*\\([^)]*\\)\\s+security definer`, 'i').test(sql);
      if (!definedAsDefiner) offenders.push(`${f}:${fn}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('the regression suite is part of the canonical database gate', () => {
  const runner = read('../scripts/run-release-v5-db.mjs');
  assert.match(runner, /'customer_deletion_delivery_order_test\.sql'/);
  const pgtap = read('../supabase/tests/customer_deletion_delivery_order_test.sql');
  assert.match(pgtap, /select plan\(12\);/);
  assert.match(pgtap, /set constraints all immediate;/);
  assert.match(pgtap, /not has_table_privilege\('taba_qa_baja_sin_orders', 'public\.orders', 'SELECT'\)/);
});
