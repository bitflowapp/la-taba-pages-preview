import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  TARGETS, assertReadOnlyStatement, findingName, parseArgs, runChecks, splitStatements,
} from '../scripts/release/run-readonly-checks.mjs';

const PREFLIGHT = new URL('../docs/migrations/checks/20261001_ecommerce_hardening_preflight.sql', import.meta.url);

test('la verificación previa se separa en sus 21 consultas, todas de lectura y con nombre propio', () => {
  const statements = splitStatements(fs.readFileSync(PREFLIGHT, 'utf8'));
  assert.equal(statements.length, 21);
  const names = statements.map(findingName);
  assert.equal(names.includes(null), false, 'cada consulta devuelve su columna finding');
  assert.equal(new Set(names).size, names.length, 'sin nombres repetidos');
  for (const statement of statements) assertReadOnlyStatement(statement);
  // Ninguna llama a una función del proyecto: el rol de sólo lectura no puede ejecutarlas.
  for (const statement of statements) assert.doesNotMatch(statement, /\bpublic\.[a-z_]+\s*\(/, findingName(statement));
});

const PREFLIGHT_2 = new URL('../docs/migrations/checks/20261002_ecommerce_hardening_preflight.sql', import.meta.url);

test('la verificación previa de la segunda tanda se separa en sus 12 consultas, todas de lectura y con nombre propio', () => {
  const statements = splitStatements(fs.readFileSync(PREFLIGHT_2, 'utf8'));
  assert.equal(statements.length, 12);
  const names = statements.map(findingName);
  assert.equal(names.includes(null), false, 'cada consulta devuelve su columna finding');
  assert.equal(new Set(names).size, names.length, 'sin nombres repetidos');
  const first = new Set(splitStatements(fs.readFileSync(PREFLIGHT, 'utf8')).map(findingName));
  assert.deepEqual(names.filter((name) => first.has(name)), [], 'ningún nombre repite uno de la primera tanda');
  for (const statement of statements) assertReadOnlyStatement(statement);
  for (const statement of statements) assert.doesNotMatch(statement, /\b(public|private)\.[a-z_]+\s*\(/, findingName(statement));
});

const PREFLIGHT_3 = new URL('../docs/migrations/checks/20261003_unverified_checkout_preflight.sql', import.meta.url);

test('la verificación previa de 20261003090000 se separa en sus 3 consultas, todas de lectura y con nombre propio', () => {
  const statements = splitStatements(fs.readFileSync(PREFLIGHT_3, 'utf8'));
  assert.equal(statements.length, 3);
  const names = statements.map(findingName);
  assert.equal(names.includes(null), false, 'cada consulta devuelve su columna finding');
  assert.equal(new Set(names).size, names.length, 'sin nombres repetidos');
  const earlier = new Set([PREFLIGHT, PREFLIGHT_2].flatMap((file) => splitStatements(fs.readFileSync(file, 'utf8')).map(findingName)));
  assert.deepEqual(names.filter((name) => earlier.has(name)), [], 'ningún nombre repite uno de las tandas anteriores');
  for (const statement of statements) assertReadOnlyStatement(statement);
  // El rol de sólo lectura no puede ejecutar funciones del proyecto, y la consulta tiene que correr antes de la migración.
  for (const statement of statements) assert.doesNotMatch(statement, /\b(public|private)\.[a-z_]+\s*\(/, findingName(statement));
  for (const statement of statements) assert.doesNotMatch(statement, /payment_safety_watermarks|unverified_checkout_/, findingName(statement));
});

test('una sentencia que no es de lectura no se manda', () => {
  for (const bad of ['update public.orders set status = 1', 'delete from public.products', 'do $$ begin end $$', 'call x()', 'set role postgres']) {
    assert.throws(() => assertReadOnlyStatement(bad), /NOT_A_READ_ONLY_STATEMENT/);
  }
  assert.equal(assertReadOnlyStatement('with x as (select 1) select * from x'), 'with x as (select 1) select * from x');
});

test('el destino se nombra siempre y sólo puede ser Staging o CONTROLLED PRODUCTION', () => {
  assert.deepEqual(Object.keys(TARGETS), ['staging', 'controlled-production']);
  assert.deepEqual(parseArgs(['--target', 'staging', '--file', 'x.sql']), { target: 'staging', ref: TARGETS.staging, file: 'x.sql', out: null });
  for (const bad of [[], ['--file', 'x.sql'], ['--target', 'production', '--file', 'x.sql'], ['--target', 'wwcpogltfgzgkrlilbcd', '--file', 'x.sql']]) {
    assert.throws(() => parseArgs(bad), /--target tiene que ser/);
  }
  assert.throws(() => parseArgs(['--target', 'staging']), /--file es obligatorio/);
  assert.throws(() => parseArgs(['--target', 'staging', '--file']), /requiere un valor/);
});

test('cada consulta se corre contra el proyecto pedido y un error no corta las demás', async () => {
  const seen = [];
  const report = await runChecks({
    ref: TARGETS.staging,
    statements: ["select 'a_check' as finding, 1 as x", "select 'b_check' as finding, 2 as x"],
    query: async (ref, statement) => { seen.push(ref); if (statement.includes('b_check')) throw new Error('HTTP_400 permission denied'); return [{ x: 1 }]; },
    log: () => {},
  });
  assert.deepEqual(seen, [TARGETS.staging, TARGETS.staging]);
  assert.deepEqual(report.checks.map((c) => [c.finding, c.rows ?? null, Boolean(c.error)]), [['a_check', 1, false], ['b_check', null, true]]);
});

test('el token no se imprime ni se escribe', () => {
  const source = fs.readFileSync(new URL('../scripts/release/run-readonly-checks.mjs', import.meta.url), 'utf8');
  assert.match(source, /database\/query\/read-only/);
  assert.doesNotMatch(source, /console\.(log|error)\([^)]*token/i);
  assert.doesNotMatch(source, /writeFileSync\([^)]*token/i);
});
