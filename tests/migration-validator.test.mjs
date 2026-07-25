import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewMigrations } from '../scripts/validate-supabase-migrations.mjs';

test('migration review keeps timestamp order unique and has no blocking static errors', () => {
  const report = reviewMigrations();
  assert.ok(report.files.length >= 6);
  assert.deepEqual(
    [...report.files].sort(),
    report.files,
  );
  assert.deepEqual(
    report.issues.filter((issue) => issue.severity === 'error'),
    [],
  );
});
