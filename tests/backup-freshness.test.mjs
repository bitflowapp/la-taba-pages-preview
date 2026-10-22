import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluateFreshness, newestBackup } from '../scripts/recovery/backup-freshness.mjs';

function folder(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'taba-bf-'));
  for (const [name, manifest] of Object.entries(files)) {
    fs.mkdirSync(path.join(root, name), { recursive: true });
    fs.writeFileSync(path.join(root, name, 'manifest.json'), JSON.stringify(manifest));
  }
  return root;
}
const verified = (capturedAt, extra = {}) => ({ capturedAt, encryptedSha256: 'a'.repeat(64), encryptionRoundtripVerified: true, ...extra });

test('the newest verified manifest wins and a fresh one passes', () => {
  const root = folder({ old: verified('2026-10-01T00:00:00Z'), fresh: verified('2026-10-22T00:00:00Z') });
  const newest = newestBackup(root);
  assert.equal(path.basename(path.dirname(newest.file)), 'fresh');
  assert.equal(evaluateFreshness(newest, { maxHours: 26, now: Date.parse('2026-10-22T10:00:00Z') }).ok, true);
});

test('an old backup, no backup, an unverified manifest and a missing restore test all fail loudly', () => {
  const root = folder({ stale: verified('2026-10-01T00:00:00Z'), unverified: { capturedAt: '2026-10-22T00:00:00Z' } });
  const newest = newestBackup(root);
  assert.match(evaluateFreshness(newest, { maxHours: 26, now: Date.parse('2026-10-22T10:00:00Z') }).reason, /old/);
  assert.equal(evaluateFreshness(null, { maxHours: 26 }).ok, false);
  const fresh = newestBackup(folder({ one: verified('2026-10-22T00:00:00Z') }));
  assert.match(evaluateFreshness(fresh, { maxHours: 26, requireRestoreTest: true, now: Date.parse('2026-10-22T01:00:00Z') }).reason, /restore-tested/);
});
