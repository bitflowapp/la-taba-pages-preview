import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const smokePath = path.join(root, 'scripts/smoke-supabase-production.mjs');

test('smoke productivo usa Auth y el RPC con intención mínima', () => {
  const script = fs.readFileSync(smokePath, 'utf8');

  assert.match(script, /auth\.signInAnonymously/);
  assert.match(script, /auth\.signInWithPassword/);
  assert.match(script, /rpc\('create_order_with_items',\s*{\s*payload:/);
  assert.match(script, /items:\s*\[\{\s*product_id:\s*productId,\s*quantity:\s*1\s*}]/);
  assert.doesNotMatch(script, /unit_price\s*:/);
  assert.doesNotMatch(script, /subtotal\s*:/);
  assert.doesNotMatch(script, /status\s*:\s*['"]submitted/);
});

test('smoke exige guard explícito y nunca imprime la key completa', () => {
  const script = fs.readFileSync(smokePath, 'utf8');

  assert.match(script, /I_UNDERSTAND_THIS_CREATES_AN_ORDER/);
  assert.match(script, /TABA_SMOKE_CONFIRM/);
  assert.match(script, /redact\(publishableKey\)/);
  assert.match(script, /normalizeBrowserSupabaseKey\(publishableKey\)/);
  assert.match(script, /no uses service_role ni sb_secret_/);
  assert.doesNotMatch(script, /console\.(?:log|error)\([^)]*staffPassword/);
});

test('smoke sin confirmación falla antes de conectarse y explica el bloqueo', () => {
  const result = spawnSync(process.execPath, [smokePath], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      TABA_SMOKE_CONFIRM: '',
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Definí TABA_SMOKE_CONFIRM=I_UNDERSTAND_THIS_CREATES_AN_ORDER/);
  assert.doesNotMatch(result.stderr, /Falla inesperada/);
});

test('smoke cubre idempotencia, RLS, Realtime, estados y restauración de stock', () => {
  const script = fs.readFileSync(smokePath, 'utf8');

  assert.ok((script.match(/create_order_with_items/g) || []).length >= 3);
  assert.match(script, /x-order-token/);
  assert.match(script, /\.update\(\{\s*status:\s*'delivered'\s*}\)/);
  assert.match(script, /postgres_changes/);
  assert.match(script, /change_order_status/);
  assert.match(script, /restauró exactamente el stock reservado/);
  assert.doesNotMatch(script, /source:\s*['"]simulation['"]/);
});

test('smoke autentica al operador antes de reservar stock y reintenta Auth al limpiar', () => {
  const script = fs.readFileSync(smokePath, 'utf8');
  const mainBody = script.slice(
    script.indexOf('async function main()'),
    script.indexOf('function validateEnvironment()'),
  );
  assert.ok(
    mainBody.indexOf('staff.auth.signInWithPassword') < mainBody.indexOf("rpc('create_order_with_items'"),
    'el operador debe estar autenticado antes de crear el pedido',
  );

  const cleanupBody = script.slice(
    script.indexOf('async function bestEffortCancel'),
    script.indexOf('function orderFrom'),
  );
  assert.match(cleanupBody, /staff\.auth\.getSession/);
  assert.match(cleanupBody, /staff\.auth\.signInWithPassword/);
  assert.match(cleanupBody, /change_order_status/);
});
