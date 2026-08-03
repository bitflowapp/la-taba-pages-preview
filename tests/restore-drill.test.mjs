import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const script = fs.readFileSync(new URL('../scripts/run-mercadopago-local-db.mjs', import.meta.url), 'utf8');

test('drill aislado genera dump, restaura otra base y compara contratos críticos', () => {
  assert.match(script, /pg_dump[\s\S]*--format=custom/);
  assert.match(script, /pg_restore[\s\S]*--exit-on-error/);
  assert.match(script, /restoreDatabase/);
  assert.match(script, /TABA2_SYNTHETIC_RESTORE_DRILL_V1/);
  assert.match(script, /dumpSha256/);
  assert.match(script, /restoreDurationMs/);
  assert.match(script, /JSON\.stringify\(sourceSummary\) !== JSON\.stringify\(restoredSummary\)/);
  assert.match(script, /productionDataUsed:\s*false/);
});

test('drill conserva el guard local-only y limpia sólo sus dos bases temporales', () => {
  assert.match(script, /TABA_LOCAL_PAYMENT_DB/);
  assert.match(script, /for \(const temporaryDatabase of \[restoreDatabase, database\]\)/);
  assert.doesNotMatch(script, /--if-exists',\s*'(?:postgres|template0|template1)'/i);
});
