import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');
const migration = fs.readFileSync(
  path.join(
    ROOT,
    'supabase',
    'migrations',
    '20260725130000_fix_tracking_token_regex.sql',
  ),
  'utf8',
);
const tokenPattern = /^[A-Za-z0-9_-]{32,255}[A-Za-z0-9_-]?$/;

test('migration 13 redefines every active function containing the invalid PostgreSQL quantifier', () => {
  assert.match(migration, /public\.create_order_with_items_core\(jsonb\)/);
  assert.match(migration, /public\.issue_order_delivery_code\(uuid,text\)/);
  assert.match(migration, /public\.recover_order_tracking_access\(uuid,text\)/);
  assert.match(migration, /pg_get_functiondef/);
  assert.match(migration, /execute v_corrected/);
  assert.match(migration, /\^\[A-Za-z0-9_-\]\{32,255\}\[A-Za-z0-9_-\]\?\$/);
});

test('tracking token regex accepts exactly 32 through 256 safe characters', () => {
  assert.equal(tokenPattern.test('A'.repeat(31)), false);
  assert.equal(tokenPattern.test('A'.repeat(32)), true);
  assert.equal(tokenPattern.test('A'.repeat(255)), true);
  assert.equal(tokenPattern.test('A'.repeat(256)), true);
  assert.equal(tokenPattern.test('A'.repeat(257)), false);
});

test('tracking token regex rejects characters outside the public token alphabet', () => {
  for (const invalid of ['.', '/', '+', '=', ' ', 'á']) {
    assert.equal(tokenPattern.test(`${'A'.repeat(31)}${invalid}`), false);
  }
  assert.equal(tokenPattern.test(`${'A'.repeat(30)}-_`), true);
});
