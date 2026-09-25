import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { classifyRpcError } from '../js/repositories/supabase-business-repository.js';

const MIGRATION = '20260924200000_revision_conflicts_answer_409.sql';

test('revision conflicts are classified as conflicts under PT409 and legacy 40001', () => {
  for (const code of ['PT409', '40001']) {
    const result = classifyRpcError({ code, message: 'revision desactualizada' }, 409);
    assert.equal(result.conflict, true);
    assert.equal(result.code, 'REVISION_CONFLICT');
  }
});

test('the forward migration rewrites every 40001 raise and fails closed if one survives', () => {
  const sql = readFileSync(new URL(`../supabase/migrations/${MIGRATION}`, import.meta.url), 'utf8');
  assert.match(sql, /pg_get_functiondef/);
  assert.match(sql, /'PT409'/);
  assert.match(sql, /revision conflicts are still raised as 40001/);
  const names = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort();
  const raisesAfter = names.slice(names.indexOf(MIGRATION) + 1)
    .filter((f) => /errcode\s*=\s*'40001'/.test(readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8')));
  assert.deepEqual(raisesAfter, [], 'a later migration reintroduced 40001 conflicts');
  const pgtap = readFileSync(new URL('../supabase/tests/business_self_delivery_test.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(pgtap, /'40001', null/);
});
