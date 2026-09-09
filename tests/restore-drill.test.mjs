import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const script = fs.readFileSync(new URL('../scripts/run-release-v5-db.mjs', import.meta.url), 'utf8');

test('drill aislado genera dump, restaura otra base y compara contratos críticos', () => {
  assert.match(script, /pg_dump[\s\S]*--format=custom/);
  assert.match(script, /pg_restore[\s\S]*--exit-on-error/);
  assert.match(script, /restoreDatabase/);
  assert.match(script, /TABA2_SYNTHETIC_RESTORE_DRILL_V1/);
  assert.match(script, /dumpSha256/);
  assert.match(script, /restoreDurationMs/);
  assert.match(script, /assert\.deepEqual\(restoredSummary,sourceSummary\)/);
  assert.match(script, /platform-incomplete restore must not authorize release/);
  assert.match(script, /productionDataUsed:\s*false/);
});

test('drill owns a network-isolated cluster and cannot borrow another project', () => {
  assert.match(script, /TABA_LOCAL_PAYMENT_DB/);
  assert.match(script, /'--network','none'/);
  assert.match(script, /assert.equal\(inspected.Name,'\/'\+container\)/);
  assert.doesNotMatch(script, /TABA_SUPABASE_DB_CONTAINER|docker\(\['restart'/);
  assert.doesNotMatch(script, /--if-exists',\s*'(?:postgres|template0|template1)'/i);
});
