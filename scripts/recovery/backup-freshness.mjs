// "Is there a recent backup?" - the alarm that was missing (forensic finding F13). It reads only manifest metadata
// (never a dump, never a key) from the folders given and exits non-zero when the newest verified backup is too old,
// when none exists, or when the newest one was never restore-tested.
//   node scripts/recovery/backup-freshness.mjs --root <folder with snapshot folders> --max-hours 26 [--require-restore-test]
// Schedule it from any machine that can see the backup folder (Windows Task Scheduler, cron) and alert on exit code 1.
import fs from 'node:fs';
import path from 'node:path';

export function newestBackup(root) {
  const found = [];
  const visit = (dir, depth) => {
    if (depth > 3) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full, depth + 1);
      else if (entry.name === 'manifest.json') {
        try {
          const manifest = JSON.parse(fs.readFileSync(full, 'utf8'));
          const capturedAt = Date.parse(manifest.capturedAt);
          if (Number.isFinite(capturedAt) && manifest.encryptedSha256 && manifest.encryptionRoundtripVerified === true) {
            found.push({ file: full, capturedAt, restoreTestCompleted: manifest.restoreTestCompleted === true });
          }
        } catch { /* not a backup manifest */ }
      }
    }
  };
  visit(root, 0);
  return found.sort((a, b) => b.capturedAt - a.capturedAt)[0] || null;
}

export function evaluateFreshness(newest, { maxHours, requireRestoreTest = false, now = Date.now() }) {
  if (!newest) return { ok: false, reason: 'no verified backup found' };
  const ageHours = (now - newest.capturedAt) / 3_600_000;
  if (ageHours > maxHours) return { ok: false, reason: `newest backup is ${ageHours.toFixed(1)} h old (limit ${maxHours} h)`, ageHours };
  if (requireRestoreTest && !newest.restoreTestCompleted) return { ok: false, reason: 'newest backup was never restore-tested', ageHours };
  return { ok: true, ageHours };
}

const direct = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (direct) {
  const value = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
  const root = value('--root');
  if (!root) throw new Error('--root is required');
  const result = evaluateFreshness(newestBackup(path.resolve(root)), {
    maxHours: Number(value('--max-hours') || 26), requireRestoreTest: process.argv.includes('--require-restore-test'),
  });
  console.log(JSON.stringify(result));
  process.exit(result.ok ? 0 : 1);
}
