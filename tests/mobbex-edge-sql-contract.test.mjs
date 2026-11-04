// Edge ↔ SQL contract for Mobbex. The behavioural tests (mobbex-core / mobbex-flows) inject FAKE ports, so they cannot
// notice an Edge Function that talks to the database in a way the database refuses. These checks read the real
// migrations and the real Edge sources and fail on exactly that class of mistake:
//   1. every `enforceRateLimit` scope must be accepted by `consume_payment_rate_limit` (otherwise: permanent 429);
//   2. every `rpc('name', { p_x })` must name a function created by the Mobbex migration, with its exact parameters.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const migrationsDir = path.join(root, 'supabase', 'migrations');
const functionsDir = path.join(root, 'supabase', 'functions');
const MOBBEX_MIGRATION = 'supabase/migrations/20261103010000_mobbex_checkout_foundation.sql';

function listFiles(dir, predicate) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, predicate));
    else if (predicate(full)) out.push(full);
  }
  return out;
}

const quotedList = (text) => [...text.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);

/** Scopes accepted by the LAST migration that defines `consume_payment_rate_limit` (the function is what runs). */
function allowedRateLimitScopes() {
  let scopes = null;
  for (const file of fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const definition = /create or replace function public\.consume_payment_rate_limit[\s\S]*?p_scope not in \(([^)]*)\)/i.exec(sql);
    if (definition) scopes = quotedList(definition[1]);
  }
  assert.ok(scopes?.length, 'consume_payment_rate_limit must define an allow-list of scopes');
  return new Set(scopes);
}

function edgeSources() {
  return listFiles(functionsDir, (file) => file.endsWith('.ts'));
}

test('every Edge enforceRateLimit scope is accepted by consume_payment_rate_limit', () => {
  const allowed = allowedRateLimitScopes();
  const seen = [];
  for (const file of edgeSources()) {
    const source = fs.readFileSync(file, 'utf8');
    for (const call of source.matchAll(/enforceRateLimit\(\s*[^,()]+(?:\([^)]*\))?,\s*[^,]+,\s*'([^']+)'/g)) {
      seen.push({ file: path.relative(root, file), scope: call[1] });
    }
  }
  assert.ok(seen.some((entry) => entry.file.includes('mobbex-webhook')), 'the Mobbex webhook must be rate limited');
  for (const entry of seen) {
    assert.ok(allowed.has(entry.scope), `${entry.file} uses rate limit scope "${entry.scope}", which the database rejects (allowed: ${[...allowed].join(', ')})`);
  }
});

test('the TypeScript scope union matches the database allow-list', () => {
  const allowed = allowedRateLimitScopes();
  const union = /scope:\s*((?:'[a-z_]+'\s*\|?\s*)+),/.exec(read('supabase/functions/_shared/payment-runtime.ts'));
  assert.ok(union, 'enforceRateLimit scope union not found');
  assert.deepEqual(new Set(quotedList(union[1])), allowed);
});

/** `name -> parameter names` for every `create function public.NAME(...)` of the Mobbex migration. */
function mobbexFunctionParameters() {
  const sql = read(MOBBEX_MIGRATION);
  const functions = new Map();
  for (const head of sql.matchAll(/create function public\.([a-z0-9_]+)\(/gi)) {
    let depth = 1;
    let index = head.index + head[0].length;
    const start = index;
    while (index < sql.length && depth > 0) {
      if (sql[index] === '(') depth += 1;
      if (sql[index] === ')') depth -= 1;
      index += 1;
    }
    const params = [];
    let level = 0;
    let current = '';
    for (const char of sql.slice(start, index - 1)) {
      if (char === '(') level += 1;
      if (char === ')') level -= 1;
      if (char === ',' && level === 0) { params.push(current); current = ''; } else current += char;
    }
    params.push(current);
    functions.set(head[1], params.map((param) => param.trim()).filter(Boolean).map((param) => param.split(/\s+/)[0]));
  }
  // `public.create_mobbex_checkout_session` is not written out: the migration DERIVES it (pg_get_functiondef + guarded
  // replace) from the Mercado Pago `create_checkout_session` in force, so it has that function's parameter names.
  assert.match(sql, /FUNCTION public\.create_mobbex_checkout_session\(/, 'derivation of create_mobbex_checkout_session not found');
  functions.set('create_mobbex_checkout_session', parametersOfLatestDefinition('create_checkout_session'));
  return functions;
}

function parametersOfLatestDefinition(name) {
  let latest = null;
  for (const file of fs.readdirSync(migrationsDir).filter((entry) => entry.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    for (const head of sql.matchAll(new RegExp(String.raw`create (?:or replace )?function public\.${name}\(([^)]*)\)`, 'gi'))) latest = head[1];
  }
  assert.ok(latest, `public.${name} is not defined by any migration`);
  return latest.split(',').map((param) => param.trim().split(/\s+/)[0]).filter(Boolean);
}

test('every Mobbex Edge rpc() call names an existing function with exactly its parameters', () => {
  const functions = mobbexFunctionParameters();
  assert.ok(functions.size >= 25, 'the Mobbex migration should expose its function catalogue');
  const calls = [];
  for (const file of edgeSources().filter((name) => /mobbex/.test(name))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const call of source.matchAll(/\brpc(?:<[^>]*>)?\(\s*'([a-z0-9_]+)'\s*(?:,\s*\{([^}]*)\})?/g)) {
      calls.push({
        file: path.relative(root, file),
        name: call[1],
        keys: [...(call[2] ?? '').matchAll(/\b(p_[a-z0-9_]+)\s*:/g)].map((key) => key[1]).sort(),
      });
    }
  }
  assert.ok(calls.length >= 15, `expected to see the Mobbex RPC calls, saw ${calls.length}`);
  for (const call of calls) {
    const declared = functions.get(call.name);
    assert.ok(declared, `${call.file} calls rpc("${call.name}") but the Mobbex migration does not create public.${call.name}`);
    assert.deepEqual(call.keys, [...declared].sort(), `${call.file}: rpc("${call.name}") arguments differ from the SQL signature`);
  }
});

test('browser-callable Mobbex RPCs are exactly the ones the migration grants to authenticated', () => {
  const sql = read(MOBBEX_MIGRATION);
  const granted = new Set([...sql.matchAll(/^grant execute on function public\.([a-z0-9_]+)\([^)]*\) to authenticated;/gim)].map((match) => match[1]));
  const userSession = new Set();
  for (const file of edgeSources().filter((name) => /mobbex-(refund|checkout-status|availability)/.test(name))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const call of source.matchAll(/\bclient\.rpc\(\s*'([a-z0-9_]+)'/g)) userSession.add(call[1]);
  }
  assert.ok(userSession.size >= 3);
  for (const name of userSession) assert.ok(granted.has(name), `${name} is called with the caller's session but is not granted to authenticated`);
});

// Audit session 5: the worker's mobbex_record_provider_snapshot locks the payment and THEN updates its refunds. Every refund
// function that touches both must take the payment lock first, or the edge's answer and the worker's read can deadlock.
test('refund functions lock the payment before the refund row (same order as the provider snapshot)', () => {
  const sql = read(MOBBEX_MIGRATION);
  const body = (name) => {
    const start = sql.indexOf(`create function public.${name}(`);
    assert.ok(start >= 0, name);
    return sql.slice(start, sql.indexOf('end $$;', start));
  };
  for (const name of ['mobbex_record_provider_snapshot', 'mobbex_prepare_refund', 'mobbex_record_refund_result']) {
    const text = body(name);
    const intentLock = text.search(/from public\.mobbex_payment_intents\b[^;]*for update/);
    const refundLock = text.search(/from public\.mobbex_refunds\b[^;]*for update/);
    assert.ok(intentLock >= 0, `${name} locks the payment`);
    if (refundLock >= 0) assert.ok(intentLock < refundLock, `${name}: payment lock must come before the refund lock`);
  }
});
