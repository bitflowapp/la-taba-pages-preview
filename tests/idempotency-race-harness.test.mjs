import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const HARNESS = '../scripts/order-intake/idempotency-race.mjs';
const source = read(HARNESS);

test('the idempotency race runs in the canonical database gate, right after the stock race', () => {
  const runner = read('../scripts/run-release-v5-db.mjs');
  const call = 'runIdempotencyRace(() => localClient(container));';
  const stock = 'await runStockRace(() => localClient(container));';
  // `assert.ok` with a message, not `assert.match`: a failure here must say what is missing, not print the runner.
  assert.ok(runner.includes(call),
    'scripts/run-release-v5-db.mjs must import ./order-intake/idempotency-race.mjs and call runIdempotencyRace(() => localClient(container))');
  assert.ok(runner.includes(stock), 'the stock race is still wired');
  const at = runner.indexOf(call);
  assert.ok(at > runner.indexOf('const canonicalTests='), 'after the canonical pgTAP list');
  assert.ok(at > runner.indexOf(stock), 'after the stock race');
  // Right after it: between the two calls there may be comments and the import of this harness, nothing else.
  const between = runner.slice(runner.indexOf(stock) + stock.length, at)
    .replace(/\/\/[^\n]*/g, '')
    .replace("const { runIdempotencyRace } = await import('./order-intake/idempotency-race.mjs');", '')
    .replace(/\bawait\s*$/, '');
  assert.equal(between.trim(), '', 'nothing runs between the stock race and the idempotency race');
  // The rollback drills run on what the races left behind: the idempotency race goes before them.
  assert.ok(at < runner.indexOf('const rollbackSql='), 'before the rollback drills');
});

test('GLOBAL_IDEMPOTENCY: PASS is printed once, after the final invariants and only without defects', () => {
  const finals = source.indexOf('Invariantes finales');
  assert.notEqual(finals, -1);
  const pass = "log('GLOBAL_IDEMPOTENCY: PASS')";
  assert.equal(source.split(pass).length - 1, 1, 'the verdict appears once');
  assert.ok(source.indexOf(pass) > finals, 'after the final invariants');
  assert.ok(source.indexOf(pass) > source.indexOf('if (defects.length) {'), 'after the defect gate');
  assert.match(source, /throw new Error\(`GLOBAL_IDEMPOTENCY: FAIL/);
  // The conservation check is the definition the database itself uses for reserved units.
  assert.match(source, /private\.pos_reserved_quantity\(p\.id\) as system_reserved/);
  assert.ok(source.indexOf(pass) > source.lastIndexOf("assertConserved(productId, 'invariante final')"));
});

test('a known defect is reported and fails the run: it is never downgraded to a log line', () => {
  // `defect()` records the id (and the races a lock-order defect explains); the verdict throws when any id was recorded.
  assert.match(source, /const defect = \(id, text, explains = \[\]\) => \{\s*defects\.push\(id\);\s*for \(const site of explains\) explained\.add\(site\);\s*log\(`IDEMPOTENCY_DEFECT: \$\{id\}: \$\{text\}`\);/);
  const ids = [...source.matchAll(/\bdefect\('([A-Z_]+)'/g)].map((match) => match[1]);
  assert.deepEqual([...ids].sort(), [
    'BUSINESS_DELIVERY_WRONG_CODE_RETRY',
    'CUSTOMER_ADDRESS_ARCHIVE_DEADLOCK',
    'CUSTOMER_ADDRESS_SAVE_NOT_SERIALIZED',
    'CUSTOMER_DEFAULT_ADDRESS_RAW_UNIQUE_VIOLATION',
    'PAYMENT_CANCELLATION_AMBIGUOUS_LOCK_ORDER',
    'PAYMENT_CANCELLATION_LOCK_ORDER',
    'RIDER_OFFER_ACCEPT_LOCK_ORDER',
    'UNEXPECTED_DEADLOCK',
  ], 'one block per defect the race knows how to recognise, plus the deadlock nobody expected');
  // Each block sits under its `// DEFECTO:` comment, which says what the database must do instead.
  assert.ok(source.split('// DEFECTO:').length - 1 >= ids.length - 1, 'every known defect block is explained');
});

test('a deadlock that no known defect explains fails the run; a lock timeout is reported with its race', () => {
  const unexpected = source.indexOf("defect('UNEXPECTED_DEADLOCK'");
  assert.ok(unexpected > source.indexOf('log(`DEADLOCKS: '), 'checked after the DEADLOCKS line is printed');
  assert.ok(unexpected < source.indexOf('if (defects.length) {'), 'and before the verdict');
  assert.match(source, /key\.endsWith\(' 40P01'\) && !explained\.has\(/);
  // Every race a lock-order defect claims to explain is a race the harness really runs: a renamed race would
  // otherwise leave a dead entry here (and its deadlock would show up as unexpected, which is the safe side).
  const sites = new Set([...source.matchAll(/\b(?:race|staged|mustCall|mustAll)\(\s*'([^']+)'/g)].map((match) => match[1]));
  const explains = [...source.matchAll(/defect\('[A-Z_]+',[\s\S]*?\[('[^\]]*')\]\);/g)]
    .flatMap((match) => [...match[1].matchAll(/'([^']+)'/g)].map((site) => site[1]));
  assert.ok(explains.length >= 7, 'the lock-order defects say which races they explain');
  for (const site of explains) assert.ok(sites.has(site), `explained race exists in the harness: ${site}`);
  assert.match(source, /log\(`LOCK_TIMEOUTS: \$\{tally\.lockTimeouts\}\$\{tally\.lockTimeouts \? ` \(\$\{sitesOf\('55P03'\)\}\)` : ''\}`\)/);
});

test('a lock-order inversion is proven with the arrival order fixed, not left to luck', () => {
  // Each inversion this race pins down has a staged probe (the administrative connection holds a row lock, the
  // calls arrive one after the other, then the lock is released), next to its free rounds where there are any.
  for (const site of [
    'cancelacion: pedido duplicado contra la respuesta del proveedor',
    'cancelacion: respuesta del proveedor contra aviso de pago aprobado',
    'cancelacion: pedido duplicado contra la marca dudosa',
    'oferta: el comercio ofrece a otro repartidor contra la aceptacion del primero',
    'oferta: la aceptacion contra el retiro de la oferta',
    'direccion principal: dos pedidos distintos',
    'direccion: archivar la principal contra elegir otra',
  ]) {
    assert.ok(source.includes(`staged('${site}'`), `staged probe: ${site}`);
  }
  // `staged` waits until each call is really blocked before firing the next one.
  assert.match(source, /from pg_locks where pid = \$1 and not granted/);
  // The second rider exists so that the business can offer the order to someone else while the first one accepts.
  assert.match(source, /const RIDER_B = 'a7500000-/);
  assert.match(source, /public\.accept_rider_order_offer\(/);
  assert.match(source, /public\.offer_order_to_rider\(/);
  assert.match(source, /public\.withdraw_rider_order_offer\(/);
});

test('deadlocks and lock timeouts are counted and reported, never hidden', () => {
  assert.match(source, /code !== '40P01' && code !== '55P03'/);
  assert.match(source, /log\(`DEADLOCKS: \$\{tally\.deadlocks\}/);
  assert.match(source, /log\(`LOCK_TIMEOUTS: \$\{tally\.lockTimeouts\}/);
});

test('the harness never calls a payment function the release contract retires', () => {
  const contract = read('../supabase/migrations/20260909011239_a1_a4_durable_contract_control_v3.sql');
  const retired = [...contract.matchAll(/execute \$ddl\$\s*create or replace function public\.([a-z_0-9]+)\(/g)].map((m) => m[1]);
  assert.equal(retired.length, 6);
  for (const name of retired) {
    assert.doesNotMatch(source, new RegExp(`public\\.${name}\\(`), `${name} is retired in the gate`);
    assert.doesNotMatch(source, new RegExp(`['"\`]${name}['"\`]`), `${name} is not passed by name either`);
  }
});

test('it keeps within the connection budget of the gate and uses its own fixture ids', () => {
  const max = Number(/const MAX_AT_ONCE = (\d+);/.exec(source)[1]);
  assert.ok(max <= 50, 'at most 50 connections at once (the gate database allows 100)');
  // Prefixes of the other harnesses that write into the same disposable database.
  for (const prefix of ['7100000', '7200000', '7300000', '7400000', '0f10000', '0f20000']) {
    assert.ok(!source.includes(prefix), `${prefix} belongs to another harness`);
  }
  assert.match(source, /const BUSINESS = 'b7500000-/);
  assert.match(source, /'taba-carrera-idempotencia'/);
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
