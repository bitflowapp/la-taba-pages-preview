import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const HARNESS = '../scripts/order-intake/stock-race.mjs';
const source = read(HARNESS);

test('the stock race runs in the canonical database gate, after the pgTAP list and the intake race', () => {
  const runner = read('../scripts/run-release-v5-db.mjs');
  assert.match(runner, /runStockRace\(\(\) => localClient\(container\)\)/);
  assert.ok(runner.indexOf('runStockRace(') > runner.indexOf('runOrderIntakeRace('), 'after the intake race');
  assert.ok(runner.indexOf('runStockRace(') > runner.indexOf('const canonicalTests='), 'after the canonical pgTAP list');
});

test('OVERSALE and NEGATIVE_STOCK are printed only after every product passed conservation', () => {
  const finals = source.indexOf('Invariantes finales');
  assert.notEqual(finals, -1);
  for (const line of ["log('OVERSALE: 0')", "log('NEGATIVE_STOCK: 0')"]) {
    assert.equal(source.split(line).length - 1, 1, `${line} appears once`);
    assert.ok(source.indexOf(line) > finals, `${line} comes after the final invariants`);
    assert.ok(source.indexOf(line) > source.lastIndexOf("assertConserved(productId, 'invariante final')"));
  }
  // The conservation check is the definition the database itself uses for reserved units.
  assert.match(source, /private\.pos_reserved_quantity\(p\.id\) as system_reserved/);
  assert.match(source, /state\.stock >= 0/);
});

test('a refused buyer must have been refused for lack of stock, and a deadlock is counted, never hidden', () => {
  assert.match(source, /todo rechazo es por stock y por nada mas/);
  assert.match(source, /results\[index\]\.code !== '40P01'/);
  assert.match(source, /log\(`DEADLOCKS: \$\{tally\.deadlocks\}/);
});

test('the harness never calls a payment function the release contract retires', () => {
  const contract = read('../supabase/migrations/20260909011239_a1_a4_durable_contract_control_v3.sql');
  const retired = [...contract.matchAll(/execute \$ddl\$\s*create or replace function public\.([a-z_0-9]+)\(/g)].map((m) => m[1]);
  assert.equal(retired.length, 6);
  for (const name of retired) {
    assert.doesNotMatch(source, new RegExp(`public\\.${name}\\(`), `${name} is retired in the gate`);
  }
});

test('it keeps within the connection budget of the gate and uses its own fixture ids', () => {
  const max = Number(/const MAX_AT_ONCE = (\d+);/.exec(source)[1]);
  assert.ok(max <= 50, 'at most 50 connections at once (the gate database allows 100)');
  // Prefixes of the other harnesses that write into the same disposable database.
  const intake = read('../scripts/order-intake/intake-race.mjs');
  for (const prefix of ['a7200000', 'b7200000', 'c7200000']) {
    assert.ok(intake.includes(prefix));
    assert.ok(!source.includes(prefix), `${prefix} belongs to the intake race`);
  }
});

test('run directly, it refuses anything but a disposable local database', () => {
  const script = fileURLToPath(new URL(HARNESS, import.meta.url));
  const env = { ...process.env };
  delete env.TABA_LOCAL_INTAKE_DB;
  const withoutFlag = spawnSync(process.execPath, [script, 'postgres://postgres@127.0.0.1:1/x'], { env, encoding: 'utf8' });
  assert.equal(withoutFlag.status, 2);
  assert.match(withoutFlag.stderr, /Refusing to run without TABA_LOCAL_INTAKE_DB=1/);
  const remote = spawnSync(process.execPath, [script, 'postgres://postgres@db.example.invalid:5432/postgres'],
    { env: { ...env, TABA_LOCAL_INTAKE_DB: '1' }, encoding: 'utf8' });
  assert.notEqual(remote.status, 0);
  assert.match(remote.stderr, /solo contra una base local descartable/);
});
