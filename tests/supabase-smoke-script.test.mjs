import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const smokePath = path.join(root, 'scripts/smoke-supabase-phase1.mjs');

test('Supabase smoke test calls create_order_with_items with the payload jsonb signature', () => {
  const script = fs.readFileSync(smokePath, 'utf8');

  assert.match(script, /restRequest\(restBase,\s*['"]\/rpc\/create_order_with_items['"]/);
  assert.match(script, /body:\s*{\s*payload:\s*orderPayload,\s*}/s);
  assert.doesNotMatch(script, /business_id:\s*orderPayload\.business_id,\s*order:/);
  assert.doesNotMatch(script, /p_business_id:\s*orderPayload\.business_id/);
});

test('Supabase smoke test redacts anon key output', () => {
  const script = fs.readFileSync(smokePath, 'utf8');
  const keyLogLines = script
    .split(/\r?\n/)
    .filter((line) => line.includes('console.log') && line.includes('SUPABASE_ANON_KEY'));

  assert.match(script, /redactKey\(SUPABASE_ANON_KEY\)/);
  assert.ok(keyLogLines.length > 0);
  assert.ok(keyLogLines.every((line) => line.includes('redactKey(SUPABASE_ANON_KEY)')));
});
