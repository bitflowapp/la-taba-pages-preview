import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const withoutComments = (sql) => sql.replace(/--[^\n]*/g, '');

// The A1-A4 contract leaves these as stubs that raise "retired; use V2". CI runs the canonical pgTAP list
// after that contract, so a fixture that still calls one of them passes on a plain local database and
// fails in CI.
const contract = read('../supabase/migrations/20260909011239_a1_a4_durable_contract_control_v3.sql');
const retired = [...contract.matchAll(/execute \$ddl\$\s*create or replace function public\.([a-z_0-9]+)\(/g)].map((m) => m[1]);

const runner = read('../scripts/run-release-v5-db.mjs');
const canonical = /const canonicalTests=\[([\s\S]*?)\];/.exec(runner)[1].match(/'([^']+)'/g).map((name) => name.slice(1, -1));

test('the contract retires six legacy payment functions and the canonical list is found', () => {
  assert.equal(retired.length, 6);
  assert.ok(retired.includes('record_mercadopago_preference_created'));
  assert.ok(canonical.length >= 50);
});

test('no canonical pgTAP file calls a payment function the contract retires', () => {
  const calls = [];
  for (const file of canonical) {
    withoutComments(read(`../supabase/tests/${file}`)).split('\n').forEach((line, index) => {
      for (const name of retired) {
        // A call, not a signature inside a regprocedure literal: reading the stub's source is fine.
        const call = new RegExp(`(^|[^a-z_0-9'])(public\\.)?${name}\\s*\\((?!\\s*(uuid|text|numeric|integer|boolean)\\b)`);
        if (call.test(line)) calls.push(`${file}:${index + 1} ${name}`);
      }
    });
  }
  assert.deepEqual(calls, []);
});
